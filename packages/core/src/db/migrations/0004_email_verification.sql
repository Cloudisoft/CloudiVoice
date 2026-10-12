-- Email verification at sign-up. Accounts that already exist are treated as verified.
alter table users add column if not exists email_verified_at timestamptz;
update users set email_verified_at = coalesce(last_login_at, created_at) where email_verified_at is null;

create table if not exists email_verifications (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists email_verifications_user_idx on email_verifications (user_id);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on email_verifications from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on email_verifications from authenticated;
  end if;
end $$;
