-- ============================================================================
--  Healthbook database setup
--  Paste this whole file into the SQL Editor and run it.
--
--  Safe to run again at any time. It never drops a table or deletes data, and
--  every constraint it adds is applied to new writes only, so running it over a
--  database that already has data in it cannot fail part-way through.
--
--  The security model, in one line: a signed-in person can read and write their
--  own rows and nothing else, and a signed-out visitor cannot reach these tables
--  at all.
-- ============================================================================

-- ---------------------------------------------------------------- tables ----

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  birth_year int check (birth_year between 1900 and 2100),
  sex text check (sex in ('female','male','other','unspecified')),
  height_cm numeric check (height_cm between 50 and 260),
  weight_kg numeric check (weight_kg between 20 and 400),
  units text not null default 'metric' check (units in ('metric','imperial')),
  goals text[] not null default '{}',
  wake_time text,
  bed_time text,
  devices text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The app's whole state (tasks, logs, XP) as one JSON document per person
create table if not exists public.app_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  month text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month)
);

alter table public.reports add column if not exists updated_at timestamptz not null default now();

-- ------------------------------------------------------------ row limits ----
-- Bounds on what a single account can store. Without these, one account could
-- push an unbounded blob and exhaust the project's storage for everyone.
-- Added NOT VALID so existing rows are never rejected; all new writes are checked.

alter table public.app_state drop constraint if exists app_state_data_is_object;
alter table public.app_state add constraint app_state_data_is_object
  check (jsonb_typeof(data) = 'object') not valid;

alter table public.app_state drop constraint if exists app_state_data_size;
alter table public.app_state add constraint app_state_data_size
  check (octet_length(data::text) <= 4194304) not valid;   -- 4 MB

alter table public.reports drop constraint if exists reports_data_is_object;
alter table public.reports add constraint reports_data_is_object
  check (jsonb_typeof(data) = 'object') not valid;

alter table public.reports drop constraint if exists reports_data_size;
alter table public.reports add constraint reports_data_size
  check (octet_length(data::text) <= 524288) not valid;    -- 512 KB

alter table public.reports drop constraint if exists reports_month_format;
alter table public.reports add constraint reports_month_format
  check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') not valid;

alter table public.profiles drop constraint if exists profiles_name_len;
alter table public.profiles add constraint profiles_name_len
  check (name is null or char_length(name) <= 80) not valid;

alter table public.profiles drop constraint if exists profiles_times;
alter table public.profiles add constraint profiles_times
  check ((wake_time is null or wake_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
     and (bed_time  is null or bed_time  ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')) not valid;

alter table public.profiles drop constraint if exists profiles_arrays;
alter table public.profiles add constraint profiles_arrays
  check (array_length(goals,1) is null or array_length(goals,1) <= 24) not valid;

alter table public.profiles drop constraint if exists profiles_devices;
alter table public.profiles add constraint profiles_devices
  check (array_length(devices,1) is null or array_length(devices,1) <= 24) not valid;

-- ----------------------------------------------------- row-level security ----
-- FORCE matters: without it the table owner is exempt from these policies, so
-- anything that ends up running as the owner would quietly see every row.

alter table public.profiles  enable row level security;
alter table public.app_state enable row level security;
alter table public.reports   enable row level security;

alter table public.profiles  force row level security;
alter table public.app_state force row level security;
alter table public.reports   force row level security;

-- One policy per operation rather than one blanket policy, so what is allowed
-- is readable at a glance and can be tightened individually later.

drop policy if exists "own profile" on public.profiles;
drop policy if exists "profiles select own" on public.profiles;
drop policy if exists "profiles insert own" on public.profiles;
drop policy if exists "profiles update own" on public.profiles;
drop policy if exists "profiles delete own" on public.profiles;
create policy "profiles select own" on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy "profiles insert own" on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);
create policy "profiles update own" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "profiles delete own" on public.profiles for delete to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "own state" on public.app_state;
drop policy if exists "state select own" on public.app_state;
drop policy if exists "state insert own" on public.app_state;
drop policy if exists "state update own" on public.app_state;
drop policy if exists "state delete own" on public.app_state;
create policy "state select own" on public.app_state for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "state insert own" on public.app_state for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "state update own" on public.app_state for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "state delete own" on public.app_state for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "own reports" on public.reports;
drop policy if exists "reports select own" on public.reports;
drop policy if exists "reports insert own" on public.reports;
drop policy if exists "reports update own" on public.reports;
drop policy if exists "reports delete own" on public.reports;
create policy "reports select own" on public.reports for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "reports insert own" on public.reports for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "reports update own" on public.reports for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "reports delete own" on public.reports for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ------------------------------------------------------- table privileges ----
-- RLS decides which rows; these decide who may reach the table at all. Granting
-- only the exact columns means a client cannot rewrite its own created_at, move
-- a row to another account, or write a column added here in future.

-- Revoke from `authenticated` too, not just anon. A fresh project grants this
-- role ALL on new tables in this schema, and a table-level grant overrides the
-- per-column grants below, which would silently leave them doing nothing.
revoke all on table public.profiles  from anon, public, authenticated;
revoke all on table public.app_state from anon, public, authenticated;
revoke all on table public.reports   from anon, public, authenticated;

grant select, delete on table public.profiles to authenticated;
grant insert (id, name, birth_year, sex, height_cm, weight_kg, units,
              goals, wake_time, bed_time, devices, updated_at)
  on table public.profiles to authenticated;
grant update (name, birth_year, sex, height_cm, weight_kg, units,
              goals, wake_time, bed_time, devices, updated_at)
  on table public.profiles to authenticated;

grant select, delete on table public.app_state to authenticated;
grant insert (user_id, data, updated_at) on table public.app_state to authenticated;
grant update (data, updated_at)          on table public.app_state to authenticated;

grant select, delete on table public.reports to authenticated;
grant insert (user_id, month, data, updated_at) on table public.reports to authenticated;
grant update (data, updated_at)                 on table public.reports to authenticated;

-- Anything added to this schema later starts closed rather than open.
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- --------------------------------------------------- server-side stamping ----
-- The client sends updated_at, but a device with a wrong or deliberately skewed
-- clock could claim a future time. The server overwrites it either way, so the
-- stored timestamp is always the real one.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch  on public.profiles;
drop trigger if exists app_state_touch on public.app_state;
drop trigger if exists reports_touch   on public.reports;
create trigger profiles_touch  before insert or update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger app_state_touch before insert or update on public.app_state
  for each row execute function public.touch_updated_at();
create trigger reports_touch   before insert or update on public.reports
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------ report cap ----
-- One summary a month needs a few hundred rows over a lifetime. A much larger
-- number means something is wrong, so stop it rather than let it grow.

create or replace function public.cap_reports()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare n integer;
begin
  select count(*) into n from public.reports where user_id = new.user_id;
  if n >= 600 then
    raise exception 'Too many stored summaries for this account';
  end if;
  return new;
end;
$$;

drop trigger if exists reports_cap on public.reports;
create trigger reports_cap before insert on public.reports
  for each row execute function public.cap_reports();

-- -------------------------------------------------------- account deletion ----
-- Runs as the function owner so it can reach auth.users, which is why the
-- search_path is pinned empty and every name below is schema-qualified: that
-- closes the usual way a definer function gets hijacked. The guard makes a
-- missing session an error rather than a silent no-op.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid;
begin
  uid := (select auth.uid());
  if uid is null then
    raise exception 'Not signed in';
  end if;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

revoke all on function public.touch_updated_at() from public, anon;
revoke all on function public.cap_reports()      from public, anon;

-- ---------------------------------------------------------------- indexes ----
create index if not exists reports_user_month_idx on public.reports (user_id, month desc);
