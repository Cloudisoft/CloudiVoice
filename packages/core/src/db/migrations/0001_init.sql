-- CloudiVoice initial schema.
-- Every tenant-owned table carries org_id and is protected by row-level
-- security. Tenant requests switch to the non-owner cloudivoice_app role per
-- transaction (see db/client.ts withTenant), so policies always apply to
-- them; trusted system code (auth, workers, webhooks) runs as the owner.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cloudivoice_app') then
    create role cloudivoice_app nologin;
  end if;
end$$;

do $$
begin
  execute format('grant cloudivoice_app to %I', current_user);
exception when others then
  raise notice 'could not grant cloudivoice_app to current user: %', sqlerrm;
end$$;

grant usage on schema public to cloudivoice_app;

-- Helper used in every policy.
create or replace function app_org_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.org_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  industry text,
  website text,
  team_size text,
  timezone text not null default 'Asia/Kolkata',
  default_language text not null default 'hi-IN',
  calling_window_start time not null default '09:00',
  calling_window_end time not null default '21:00',
  calling_days int[] not null default '{1,2,3,4,5,6}',
  record_calls boolean not null default false,
  recording_disclosure text not null default 'This call may be recorded for quality purposes.',
  retention_days int not null default 90 check (retention_days between 1 and 3650),
  max_concurrency int not null default 5 check (max_concurrency between 1 and 500),
  monthly_spend_limit_paise bigint,
  onboarding_step text not null default 'business',
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index users_email_key on users (lower(email));

create table memberships (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('admin','manager','operator','viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on memberships (user_id);

create table sessions (
  id text primary key,                         -- sha256 of the cookie token
  user_id uuid not null references users(id) on delete cascade,
  active_org_id uuid references organizations(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  ip text,
  user_agent text
);
create index sessions_user_idx on sessions (user_id);

create table password_resets (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin','manager','operator','viewer')),
  token_hash text not null unique,
  invited_by uuid references users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index invitations_org_idx on invitations (org_id);

create table audit_logs (
  id bigserial primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  actor_user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_org_idx on audit_logs (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Integrations (credentials encrypted at rest; provider names never shown)
-- ---------------------------------------------------------------------------
create table provider_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('telephony','speech','reasoning','email')),
  provider_key text not null,                  -- internal identifier only
  display_name text not null,                  -- customer-facing neutral label
  credentials_encrypted text,
  config jsonb not null default '{}',
  status text not null default 'unverified' check (status in ('unverified','healthy','degraded','failed')),
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (org_id, kind)
);

-- ---------------------------------------------------------------------------
-- Agents, versions, knowledge
-- ---------------------------------------------------------------------------
create table agents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  use_case text not null default 'receptionist',
  status text not null default 'draft' check (status in ('draft','active','inactive')),
  current_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agents_org_idx on agents (org_id);

create table agent_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  version int not null,
  config jsonb not null,
  note text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (agent_id, version)
);

create table knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  filename text not null,
  mime_type text not null,
  size_bytes int not null,
  status text not null default 'processing' check (status in ('processing','ready','failed')),
  error text,
  chunk_count int not null default 0,
  created_at timestamptz not null default now()
);
create index knowledge_documents_org_idx on knowledge_documents (org_id);

create table knowledge_chunks (
  id bigserial primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  idx int not null,
  content text not null,
  tsv tsvector generated always as (to_tsvector('simple', content)) stored
);
create index knowledge_chunks_tsv_idx on knowledge_chunks using gin (tsv);
create index knowledge_chunks_doc_idx on knowledge_chunks (document_id);

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------
create table custom_fields (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null,
  created_at timestamptz not null default now(),
  unique (org_id, key)
);

create table lead_lists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index lead_lists_org_idx on lead_lists (org_id);

create table leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  first_name text,
  last_name text,
  email text,
  phone_e164 text not null,
  phone_digits text not null,                  -- national significant number, for any-format search
  city text,
  state text,
  pincode text,
  language text,
  timezone text,
  custom jsonb not null default '{}',
  status text not null default 'new',
  last_outcome text,
  attempts int not null default 0,
  dnc boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, phone_e164)
);
create index leads_org_digits_idx on leads (org_id, phone_digits);
create index leads_org_created_idx on leads (org_id, created_at desc);
create index leads_org_outcome_idx on leads (org_id, last_outcome);

create table lead_list_members (
  list_id uuid not null references lead_lists(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (list_id, lead_id)
);
create index lead_list_members_lead_idx on lead_list_members (lead_id);

create table dnc_entries (
  org_id uuid not null references organizations(id) on delete cascade,
  phone_e164 text not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (org_id, phone_e164)
);

-- ---------------------------------------------------------------------------
-- Numbers, campaigns
-- ---------------------------------------------------------------------------
create table phone_numbers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  e164 text not null,
  label text,
  provider_ref text,                           -- internal; never rendered
  region text,
  number_type text,
  voice_inbound boolean not null default true,
  voice_outbound boolean not null default true,
  status text not null default 'active' check (status in ('active','inactive')),
  inbound_agent_id uuid references agents(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, e164)
);
create unique index phone_numbers_e164_global on phone_numbers (e164);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  agent_id uuid references agents(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','running','paused','stopped','completed')),
  number_ids uuid[] not null default '{}',
  transfer_number text,
  intro_name text,
  voicemail_message text,
  max_concurrency int not null default 2 check (max_concurrency between 1 and 100),
  calls_per_minute int not null default 10 check (calls_per_minute between 1 and 120),
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  retry_rules jsonb not null default '{"no_answer":{"retry":true,"delay_minutes":120},"busy":{"retry":true,"delay_minutes":30},"voicemail":{"retry":true,"delay_minutes":240},"failed":{"retry":true,"delay_minutes":60}}',
  window_start time,
  window_end time,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  stopped_at timestamptz
);
create index campaigns_org_idx on campaigns (org_id);

create table campaign_lists (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  list_id uuid not null references lead_lists(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  primary key (campaign_id, list_id)
);

create table campaign_leads (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending','in_progress','retry_wait','completed','exhausted','skipped')),
  attempts int not null default 0,
  next_eligible_at timestamptz not null default now(),
  last_outcome text,
  last_call_id uuid,
  updated_at timestamptz not null default now(),
  primary key (campaign_id, lead_id)
);
create index campaign_leads_due_idx on campaign_leads (campaign_id, state, attempts, next_eligible_at);

-- ---------------------------------------------------------------------------
-- Calls
-- ---------------------------------------------------------------------------
create table calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  agent_id uuid references agents(id) on delete set null,
  agent_version int,
  lead_id uuid references leads(id) on delete set null,
  direction text not null check (direction in ('outbound','inbound','test')),
  from_e164 text,
  to_e164 text,
  state text not null default 'queued' check (state in ('queued','ringing','answered','in_progress','voicemail','transferring','transferred','completed','failed')),
  provider_call_id text,
  outcome text,
  outcome_confidence real,
  outcome_reason text,
  outcome_overridden boolean not null default false,
  end_reason text,
  transfer_status text,
  summary text,
  qa jsonb,
  recording_key text,
  recording_status text,
  duration_sec int,
  cost_paise bigint not null default 0,
  created_at timestamptz not null default now(),
  ringing_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz
);
create index calls_org_created_idx on calls (org_id, created_at desc);
create index calls_org_state_idx on calls (org_id, state);
create unique index calls_provider_id_idx on calls (provider_call_id) where provider_call_id is not null;
create index calls_campaign_idx on calls (campaign_id, created_at desc);
create index calls_lead_idx on calls (lead_id, created_at desc);

create table call_events (
  id bigserial primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  call_id uuid not null references calls(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index call_events_call_idx on call_events (call_id, id);

create table transcript_lines (
  id bigserial primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  call_id uuid not null references calls(id) on delete cascade,
  speaker text not null check (speaker in ('agent','caller','system')),
  text text not null,
  language text,
  at_ms int not null default 0,
  created_at timestamptz not null default now()
);
create index transcript_lines_call_idx on transcript_lines (call_id, id);

create table callbacks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  call_id uuid references calls(id) on delete set null,
  scheduled_for timestamptz not null,
  reason text,
  status text not null default 'scheduled' check (status in ('scheduled','dialing','done','cancelled','failed')),
  created_by text not null default 'ai',
  created_at timestamptz not null default now()
);
create index callbacks_due_idx on callbacks (status, scheduled_for);
create index callbacks_org_idx on callbacks (org_id, scheduled_for);

create table usage_ledger (
  id bigserial primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  call_id uuid references calls(id) on delete set null,
  category text not null check (category in ('telephony','speech_to_text','reasoning','text_to_speech','storage','platform','credit','number_rental')),
  quantity numeric not null default 0,
  unit text not null,
  amount_paise bigint not null,                -- negative for credits
  description text,
  created_at timestamptz not null default now()
);
create index usage_ledger_org_idx on usage_ledger (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- System tables (no tenant RLS; only reachable from server code)
-- ---------------------------------------------------------------------------
create table webhook_events (
  id bigserial primary key,
  source text not null,
  kind text not null,
  dedupe_key text not null unique,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts int not null default 0,
  error text
);
create index webhook_events_pending_idx on webhook_events (processed_at) where processed_at is null;

create table worker_leases (
  name text primary key,
  holder text not null,
  expires_at timestamptz not null
);

create table demo_sessions (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  language text not null,
  scenario text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  seconds int not null default 0,
  end_reason text
);
create index demo_sessions_ip_idx on demo_sessions (ip_hash, started_at desc);

create table rate_limits (
  key text primary key,
  count int not null,
  window_ends_at timestamptz not null
);

-- ---------------------------------------------------------------------------
-- Row-level security for every tenant-owned table
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'audit_logs','provider_connections','agents','agent_versions','knowledge_documents',
    'knowledge_chunks','custom_fields','lead_lists','leads','lead_list_members','dnc_entries',
    'phone_numbers','campaigns','campaign_lists','campaign_leads','calls','call_events',
    'transcript_lines','callbacks','usage_ledger','invitations'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (org_id = app_org_id()) with check (org_id = app_org_id())', t);
    execute format('grant select, insert, update, delete on %I to cloudivoice_app', t);
  end loop;
end$$;

-- organizations: a tenant can only see / update itself.
alter table organizations enable row level security;
create policy org_self on organizations using (id = app_org_id()) with check (id = app_org_id());
grant select, update on organizations to cloudivoice_app;

-- memberships are readable within the tenant (team page) and managed there.
alter table memberships enable row level security;
create policy tenant_isolation on memberships using (org_id = app_org_id()) with check (org_id = app_org_id());
grant select, insert, update, delete on memberships to cloudivoice_app;

-- users: tenants may read names/emails of their own members only.
grant select (id, email, name, created_at, last_login_at) on users to cloudivoice_app;
alter table users enable row level security;
create policy users_in_tenant on users for select to cloudivoice_app
  using (exists (select 1 from memberships m where m.user_id = users.id and m.org_id = app_org_id()));

grant usage, select on all sequences in schema public to cloudivoice_app;
