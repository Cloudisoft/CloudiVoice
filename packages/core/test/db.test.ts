/**
 * Integration tests against a real Postgres (not a fake): tenant isolation,
 * auth, lead import/search, redial resets, finalization and dialler order.
 * Requires TEST_DATABASE_URL (a database the tests may wipe).
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setDb, withSystem, withTenant, type Sql } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import { getSession, signIn, signUp } from "../src/services/auth";
import { importLeads, listLeads, resetLeadsForRedial, bulkDnc } from "../src/services/leads";
import { createCall, finalizeCall, transition, addTranscriptLine } from "../src/services/calls";
import { saveCampaign } from "../src/services/campaigns";
import { createAgent } from "../src/services/agents";
import { acquireLease } from "../src/services/system";

const url = process.env.TEST_DATABASE_URL;
const run = url ? describe : describe.skip;

let sql: Sql;
let orgA: string, orgB: string, userA: string;

run("database", () => {
  beforeAll(async () => {
    sql = postgres(url!, { onnotice: () => {}, max: 5 }) as unknown as Sql;
    await sql.unsafe(`drop schema public cascade; create schema public;`);
    await migrate(sql);
    setDb(sql);
    const a = await signUp({ name: "Asha Rao", email: "asha@example.com", password: "password123", company: "Alpha Clinic" });
    const b = await signUp({ name: "Bilal Khan", email: "bilal@example.com", password: "password123", company: "Beta Realty" });
    orgA = a.orgId;
    orgB = b.orgId;
    userA = a.userId;
  });

  afterAll(async () => {
    setDb(undefined);
    await sql?.end();
  });

  it("signs in and resolves the session with role", async () => {
    const { token } = await signIn("ASHA@example.com", "password123");
    const s = await getSession(token);
    expect(s?.orgId).toBe(orgA);
    expect(s?.role).toBe("admin");
    await expect(signIn("asha@example.com", "nope")).rejects.toThrow(/don't match/);
  });

  it("denies cross-tenant reads and writes (row-level security)", async () => {
    await withTenant(orgA, (tx) => tx`insert into leads (org_id, phone_e164, phone_digits, first_name) values (${orgA}, '+919800000001', '9800000001', 'Secret')`);
    const seenByB = await withTenant(orgB, (tx) => tx`select * from leads`);
    expect(seenByB).toHaveLength(0);
    // Even an unfiltered update/delete from tenant B touches nothing in A.
    const upd = await withTenant(orgB, (tx) => tx`update leads set first_name = 'pwned'`);
    expect(upd.count).toBe(0);
    const del = await withTenant(orgB, (tx) => tx`delete from leads`);
    expect(del.count).toBe(0);
    // And B cannot insert rows claiming to belong to A.
    await expect(withTenant(orgB, (tx) => tx`insert into leads (org_id, phone_e164, phone_digits) values (${orgA}, '+919800000002', '9800000002')`)).rejects.toThrow(
      /row-level security/,
    );
    const orgsSeenByB = await withTenant(orgB, (tx) => tx`select id from organizations`);
    expect(orgsSeenByB.map((r) => r.id)).toEqual([orgB]);
    const usersSeenByB = await withTenant(orgB, (tx) => tx`select email from users`);
    expect(usersSeenByB.map((r) => r.email)).toEqual(["bilal@example.com"]);
  });

  it("imports leads with normalization, dedupe and any-format search", async () => {
    const res = await withTenant(orgA, (tx) =>
      importLeads(
        tx,
        orgA,
        userA,
        {
          headers: ["Name", "Mobile", "City"],
          rows: [
            ["Ravi Kumar", "98765 43210", "Pune"],
            ["Ravi Again", "+91-98765-43210", "Pune"],
            ["Meera Shah", "09123456780", "Ahmedabad"],
            ["Bad Row", "12345", "X"],
          ],
        },
        { Name: "full_name", Mobile: "phone", City: "city" },
        { listName: "October leads" },
      ),
    );
    expect(res).toMatchObject({ imported: 2, duplicatesInFile: 1, invalidPhones: 1 });
    for (const q of ["987-654-3210", "+919876543210", "09876543210", "ravi"]) {
      const { rows } = await withTenant(orgA, (tx) => listLeads(tx, { q }));
      expect(rows.map((r) => r.first_name)).toContain("Ravi");
    }
  });

  it("finalizes a never-connected call as No Answer and schedules a retry", async () => {
    const { agentId, campaignId, leadId } = await withTenant(orgA, async (tx) => {
      const agentId = await createAgent(tx, orgA, userA, "Reception", { company_name: "Alpha Clinic" });
      const [list] = await tx<{ id: string }[]>`select id from lead_lists limit 1`;
      const campaignId = await saveCampaign(tx, orgA, userA, {
        name: "Recall",
        agent_id: agentId,
        list_ids: [list!.id],
        number_ids: [],
        transfer_number: "",
        intro_name: "",
        voicemail_message: "",
        max_concurrency: 2,
        calls_per_minute: 10,
        max_attempts: 3,
        window_start: null,
        window_end: null,
      });
      const [lead] = await tx<{ id: string }[]>`select id from leads where first_name = 'Ravi'`;
      await tx`update campaign_leads set state = 'in_progress', attempts = 1 where lead_id = ${lead!.id}`;
      return { agentId, campaignId, leadId: lead!.id };
    });
    await withTenant(orgA, async (tx) => {
      const callId = await createCall(tx, { orgId: orgA, direction: "outbound", agentId, agentVersion: 1, leadId, campaignId, from: "+912200000000", to: "+919876543210" });
      expect(await transition(tx, callId, "ringing")).toBe(true);
      expect(await transition(tx, callId, "completed", { endReason: "never_connected", durationSec: 0 })).toBe(true);
      expect(await transition(tx, callId, "in_progress")).toBe(false); // late event rejected
      await finalizeCall(tx, callId);
      await finalizeCall(tx, callId); // idempotent
      const [call] = await tx`select outcome, outcome_reason from calls where id = ${callId}`;
      expect(call!.outcome).toBe("no_answer");
      const [cl] = await tx`select state, next_eligible_at from campaign_leads where lead_id = ${leadId}`;
      expect(cl!.state).toBe("retry_wait");
      expect(new Date(cl!.next_eligible_at as string).getTime()).toBeGreaterThan(Date.now());
    });
  });

  it("charges connected time and records an answered call's outcome", async () => {
    await withTenant(orgA, async (tx) => {
      const callId = await createCall(tx, { orgId: orgA, direction: "test", agentId: null, agentVersion: null, from: null, to: "+919876543210" });
      await transition(tx, callId, "answered");
      await transition(tx, callId, "in_progress");
      await addTranscriptLine(tx, orgA, callId, "caller", "Not interested, thank you", 2000);
      await transition(tx, callId, "completed", { endReason: "caller_hung_up", durationSec: 90 });
      await finalizeCall(tx, callId);
      const [c] = await tx`select outcome, cost_paise from calls where id = ${callId}`;
      expect(c!.outcome).toBe("not_interested");
      expect(Number(c!.cost_paise)).toBeGreaterThan(0);
    });
  });

  it("never resets permanent outcomes when redialling a list", async () => {
    await withTenant(orgA, async (tx) => {
      const [list] = await tx<{ id: string }[]>`select id from lead_lists limit 1`;
      await tx`update leads set last_outcome = 'not_interested', attempts = 2 where first_name = 'Meera'`;
      await tx`update leads set last_outcome = 'no_answer', attempts = 2 where first_name = 'Ravi'`;
      const n = await resetLeadsForRedial(tx, orgA, userA, { listId: list!.id });
      expect(n).toBe(1);
      const rows = await tx`select first_name, attempts from leads order by first_name`;
      expect(rows.find((r) => r.first_name === "Meera")!.attempts).toBe(2);
      expect(rows.find((r) => r.first_name === "Ravi")!.attempts).toBe(0);
    });
  });

  it("DNC removes leads from campaign queues", async () => {
    await withTenant(orgA, async (tx) => {
      const [lead] = await tx<{ id: string }[]>`select id from leads where first_name = 'Ravi'`;
      await tx`update campaign_leads set state = 'pending' where lead_id = ${lead!.id}`;
      await bulkDnc(tx, orgA, userA, [lead!.id]);
      const [cl] = await tx`select state from campaign_leads where lead_id = ${lead!.id}`;
      expect(cl!.state).toBe("skipped");
    });
  });

  it("worker lease is exclusive", async () => {
    expect(await acquireLease("t", "w1", 30)).toBe(true);
    expect(await acquireLease("t", "w2", 30)).toBe(false);
    expect(await acquireLease("t", "w1", 30)).toBe(true);
    await withSystem((tx) => tx`update worker_leases set expires_at = now() - interval '1 second' where name = 't'`);
    expect(await acquireLease("t", "w2", 30)).toBe(true);
  });
});
