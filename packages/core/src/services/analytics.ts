import type { Tx } from "../db/client";

/** Dashboard overview — one grouped query per widget. */
export async function overview(tx: Tx, days = 7) {
  const since = tx`now() - ${`${days} days`}::interval`;
  const [totals] = await tx<{
    calls: number;
    connected: number;
    transferred: number;
    avg_duration: number | null;
    minutes: number;
    cost_paise: string | null;
    today: number;
  }[]>`
    select count(*)::int as calls,
      count(*) filter (where answered_at is not null)::int as connected,
      count(*) filter (where outcome = 'transferred')::int as transferred,
      round(avg(duration_sec) filter (where duration_sec > 0))::int as avg_duration,
      coalesce(sum(duration_sec), 0)::int / 60 as minutes,
      sum(cost_paise)::text as cost_paise,
      count(*) filter (where created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')::int as today
    from calls where created_at > ${since}`;
  const outcomes = await tx<{ outcome: string; n: number }[]>`
    select coalesce(outcome, 'in_progress') as outcome, count(*)::int as n from calls where created_at > ${since} group by 1 order by 2 desc`;
  const daily = await tx<{ day: string; calls: number; connected: number }[]>`
    select to_char(d.day, 'YYYY-MM-DD') as day,
      coalesce(count(c.id), 0)::int as calls,
      coalesce(count(c.id) filter (where c.answered_at is not null), 0)::int as connected
    from generate_series(date_trunc('day', now() at time zone 'Asia/Kolkata') - ${`${days - 1} days`}::interval,
                         date_trunc('day', now() at time zone 'Asia/Kolkata'), interval '1 day') as d(day)
    left join calls c on date_trunc('day', c.created_at at time zone 'Asia/Kolkata') = d.day
    group by d.day order by d.day`;
  const recent = await tx<{ id: string; to_e164: string | null; from_e164: string | null; direction: string; outcome: string | null; state: string; created_at: Date; lead_name: string | null; duration_sec: number | null }[]>`
    select c.id, c.to_e164, c.from_e164, c.direction, c.outcome, c.state, c.created_at, c.duration_sec,
      nullif(trim(coalesce(l.first_name,'') || ' ' || coalesce(l.last_name,'')), '') as lead_name
    from calls c left join leads l on l.id = c.lead_id order by c.created_at desc limit 8`;
  const [balance] = await tx<{ spent: string; credits: string }[]>`
    select coalesce(sum(amount_paise) filter (where amount_paise > 0), 0)::text as spent,
           coalesce(-sum(amount_paise) filter (where amount_paise < 0), 0)::text as credits
    from usage_ledger`;
  return { totals: totals!, outcomes, daily, recent, balance: balance! };
}

export async function campaignReport(tx: Tx) {
  return tx<{ id: string; name: string; calls: number; connected: number; transferred: number; positive: number; avg_duration: number | null; avg_qa: number | null; cost_paise: string }[]>`
    select cp.id, cp.name, count(c.id)::int as calls,
      count(c.id) filter (where c.answered_at is not null)::int as connected,
      count(c.id) filter (where c.outcome = 'transferred')::int as transferred,
      count(c.id) filter (where c.outcome in ('interested','qualified','appointment_booked','callback_requested'))::int as positive,
      round(avg(c.duration_sec) filter (where c.duration_sec > 0))::int as avg_duration,
      round(avg((c.qa->>'score')::numeric))::int as avg_qa,
      coalesce(sum(c.cost_paise), 0)::text as cost_paise
    from campaigns cp left join calls c on c.campaign_id = cp.id
    group by cp.id order by cp.created_at desc limit 100`;
}

/** Connect rate per caller number — one bad number can sink a campaign. */
export async function numberReport(tx: Tx) {
  return tx<{ e164: string; calls: number; connected: number; never_connected: number; avg_duration: number | null }[]>`
    select n.e164, count(c.id)::int as calls,
      count(c.id) filter (where c.answered_at is not null)::int as connected,
      count(c.id) filter (where c.end_reason in ('never_connected','dial_timeout','network_error'))::int as never_connected,
      round(avg(c.duration_sec) filter (where c.duration_sec > 0))::int as avg_duration
    from phone_numbers n left join calls c on c.from_e164 = n.e164 and c.direction = 'outbound' and c.created_at > now() - interval '30 days'
    group by n.e164 order by calls desc`;
}

export async function qaList(tx: Tx, limit = 50) {
  return tx<{ id: string; created_at: Date; outcome: string | null; outcome_confidence: number | null; outcome_reason: string | null; outcome_overridden: boolean; qa: { score: number; notes: string } | null; summary: string | null; agent_name: string | null }[]>`
    select c.id, c.created_at, c.outcome, c.outcome_confidence, c.outcome_reason, c.outcome_overridden, c.qa, c.summary, a.name as agent_name
    from calls c left join agents a on a.id = c.agent_id
    where c.answered_at is not null and c.state = 'completed'
    order by c.created_at desc limit ${limit}`;
}

export async function usageSummary(tx: Tx) {
  const byCategory = await tx<{ category: string; amount: string; quantity: string }[]>`
    select category, sum(amount_paise)::text as amount, sum(quantity)::text as quantity
    from usage_ledger where created_at > date_trunc('month', now()) group by category order by category`;
  const ledger = await tx<{ id: number; category: string; amount_paise: string; description: string | null; created_at: Date; quantity: string; unit: string }[]>`
    select id, category, amount_paise::text, description, created_at, quantity::text, unit from usage_ledger order by id desc limit 50`;
  const [bal] = await tx<{ balance: string }[]>`select (-coalesce(sum(amount_paise), 0))::text as balance from usage_ledger`;
  return { byCategory, ledger, balance: Number(bal?.balance ?? 0) };
}
