-- Findr: migrate custom users to Supabase Auth while preserving profile IDs and reports.
-- Run once in Supabase SQL Editor after taking a database backup.
-- Existing public.users.id values remain unchanged so reports.user_id foreign keys stay valid.

alter table public.users
  add column if not exists auth_user_id uuid;

alter table public.users
  alter column password_hash drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'users_auth_user_id_fkey'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_auth_user_id_fkey
      foreign key (auth_user_id) references auth.users(id) on delete restrict;
  end if;
end $$;

create unique index if not exists users_auth_user_id_uidx
  on public.users(auth_user_id)
  where auth_user_id is not null;

alter table public.users enable row level security;
-- No browser policies are added: application profile access is performed by
-- the Express backend using its server-only service-role client.

-- These tables belonged only to the retired manual recovery-code workflow.
drop table if exists public.password_recovery_requests;
drop table if exists public.password_reset_codes;

-- Legacy password_hash values are intentionally retained (nullable) for a
-- controlled migration/audit window. New Supabase Auth users have NULL here.
-- Do not copy bcrypt hashes into auth.users: Supabase cannot import them as
-- usable Supabase Auth passwords through this application migration.
