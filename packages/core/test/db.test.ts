/**
 * Integration tests against a real Postgres (not a fake): tenant isolation,
 * auth, lead import/search, redial resets, finalization and dialler order.
 * Requires TEST_DATABASE_URL (a database the tests may wipe).
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setDb, withSystem, withTenant, type Sql } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import { createEmailVerification, createPasswordReset, getSession, resetPassword, signIn, signUp, verifyEmail } from "../src/services/auth";
import { addDnc, addLead, importLeads, listLeads, resetLeadsForRedial, bulkDnc } from "../src/services/leads";
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

  it("requires email confirmation before signing in", async () => {
    const r = await signUp({ name: "Chitra Iyer", email: "chitra@example.com", password: "password123", company: "Gamma Labs" }, {}, { verified: false });
    expect(r.token).toBeNull();
    await expect(signIn("chitra@example.com", "password123")).rejects.toMatchObject({ code: "unverified" });
    await expect(signIn("chitra@example.com", "wrong-password1")).rejects.not.toMatchObject({ code: "unverified" });

    const v = await createEmailVerification("Chitra@Example.com");
    expect(v?.email).toBe("chitra@example.com");
    const s1 = await verifyEmail(v!.token);
    expect((await getSession(s1.token))?.orgName).toBe("Gamma Labs");
    // A mail scanner opening the link first doesn't break it for the person.
    expect((await verifyEmail(v!.token)).userId).toBe(r.userId);
    await expect(verifyEmail("x".repeat(40))).rejects.toThrow(/invalid/);
    expect(await createEmailVerification("chitra@example.com")).toBeNull(); // already confirmed
    await expect(signIn("chitra@example.com", "password123")).resolves.toMatchObject({ userId: r.userId });

    // Resetting the password through the emailed link also confirms the address.
    await signUp({ name: "Dev Mehta", email: "dev@example.com", password: "password123", company: "Delta Co" }, {}, { verified: false });
    const reset = await createPasswordReset("dev@example.com");
    await resetPassword(reset!.token, "newpassword456");
    await expect(signIn("dev@example.com", "newpassword456")).resolves.toBeTruthy();
  });

  it("scopes the very first query of a tenant transaction", async () => {
    const [r] = await withTenant(orgA, (tx) => tx<{ role: string; org: string }[]>`select current_user as role, current_setting('app.org_id') as org`);
    expect(r).toEqual({ role: "cloudivoice_app", org: orgA });
    // Concurrent queries inside the same transaction are scoped too.
    const both = await withTenant(orgB, (tx) => Promise.all([tx`select current_user as role`, tx`select current_setting('app.org_id') as org`]));
    expect(both[0][0]!.role).toBe("cloudivoice_app");
    expect(both[1][0]!.org).toBe(orgB);
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

  it("adds a lead by hand with cleaning, duplicate and DNC checks", async () => {
    const r = await withTenant(orgA, (tx) => addLead(tx, orgA, userA, { firstName: "Asha", phone: "098765 43219", email: "Asha@Example.com", pincode: "560 001", listName: "Walk-ins", custom: { budget: "50 lakh" } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [lead] = await withTenant(orgA, (tx) => tx`select phone_e164, email, pincode, custom, dnc from leads where id = ${r.id}`);
    expect(lead).toMatchObject({ phone_e164: "+919876543219", email: "asha@example.com", pincode: "560001", custom: { budget: "50 lakh" }, dnc: false });
    const members = await withTenant(orgA, (tx) => tx`select 1 from lead_list_members m join lead_lists l on l.id = m.list_id where m.lead_id = ${r.id} and l.name = 'Walk-ins'`);
    expect(members).toHaveLength(1);

    const dup = await withTenant(orgA, (tx) => addLead(tx, orgA, userA, { phone: "+91-98765-43219" }));
    expect(dup).toMatchObject({ ok: false, field: "phone", existingId: r.id });
    expect(await withTenant(orgA, (tx) => addLead(tx, orgA, userA, { phone: "12345" }))).toMatchObject({ ok: false, field: "phone" });
    expect(await withTenant(orgA, (tx) => addLead(tx, orgA, userA, { phone: "9876500001", email: "nope" }))).toMatchObject({ ok: false, field: "email" });

    await withTenant(orgA, (tx) => addDnc(tx, orgA, "9876500002", "asked"));
    const d = await withTenant(orgA, (tx) => addLead(tx, orgA, userA, { phone: "9876500002" }));
    expect(d).toMatchObject({ ok: true, dnc: true });
    // Same number in another organization is a separate lead.
    expect(await withTenant(orgB, (tx) => addLead(tx, orgB, userA, { phone: "9876543219" }))).toMatchObject({ ok: true });
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
