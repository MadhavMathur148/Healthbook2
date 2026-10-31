-- Healthbook database. Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Every table has row-level security: a signed-in user can only read and write their own rows.

-- Profile answers from sign-up
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

-- The app's full state (tasks, logs, XP) as one JSON document per user
create table if not exists public.app_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Monthly summaries
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  month text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, month)
);

alter table public.profiles enable row level security;
alter table public.app_state enable row level security;
alter table public.reports enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "own state" on public.app_state;
create policy "own state" on public.app_state for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own reports" on public.reports;
create policy "own reports" on public.reports for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Lets a user delete their own account and, through the cascades above, all their data
create or replace function public.delete_my_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = (select auth.uid());
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
