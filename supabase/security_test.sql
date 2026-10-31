\set ON_ERROR_STOP off
\pset pager off
-- two accounts
insert into auth.users (id,email) values
  ('11111111-1111-1111-1111-111111111111','a@x.co'),
  ('22222222-2222-2222-2222-222222222222','b@x.co') on conflict do nothing;

\echo '--- A writes its own rows (should all SUCCEED) ---'
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.profiles (id,name,units,goals,wake_time,bed_time,devices,updated_at)
  values ('11111111-1111-1111-1111-111111111111','Alice','metric','{sleep}','07:00','23:00','{ring}',now());
insert into public.app_state (user_id,data,updated_at)
  values ('11111111-1111-1111-1111-111111111111','{"v":1}'::jsonb, now());
insert into public.reports (user_id,month,data) values
  ('11111111-1111-1111-1111-111111111111','2026-10','{"x":1}'::jsonb);

\echo '--- B writes its own rows ---'
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into public.app_state (user_id,data,updated_at)
  values ('22222222-2222-2222-2222-222222222222','{"secret":"B only"}'::jsonb, now());

\echo '--- B tries to READ A (expect 0 rows) ---'
select count(*) as a_rows_visible_to_b from public.app_state
  where user_id='11111111-1111-1111-1111-111111111111';
select count(*) as total_state_rows_b_can_see from public.app_state;
select count(*) as profiles_b_can_see from public.profiles;
select count(*) as reports_b_can_see from public.reports;

\echo '--- B tries to WRITE INTO A (expect failures) ---'
insert into public.app_state (user_id,data) values ('11111111-1111-1111-1111-111111111111','{"evil":1}'::jsonb);
update public.app_state set data='{"evil":1}'::jsonb where user_id='11111111-1111-1111-1111-111111111111';
delete from public.app_state where user_id='11111111-1111-1111-1111-111111111111';

\echo '--- B tries to MOVE its row to A (expect failure) ---'
update public.app_state set user_id='11111111-1111-1111-1111-111111111111'
  where user_id='22222222-2222-2222-2222-222222222222';

\echo '--- B tries to forge created_at / id (expect permission denied) ---'
insert into public.reports (user_id,month,data,created_at) values
  ('22222222-2222-2222-2222-222222222222','2026-09','{}'::jsonb,'2000-01-01');
update public.profiles set created_at='2000-01-01' where id='22222222-2222-2222-2222-222222222222';
reset role;
\pset pager off
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\echo '--- normal writes still work ---'
insert into public.profiles (id,name,units,goals,wake_time,bed_time,devices,updated_at)
  values ('22222222-2222-2222-2222-222222222222','Bob','metric','{move}','08:00','00:00','{watch}',now())
  on conflict (id) do update set name=excluded.name, updated_at=excluded.updated_at;
insert into public.app_state (user_id,data,updated_at) values ('22222222-2222-2222-2222-222222222222','{"v":2}'::jsonb,now())
  on conflict (user_id) do update set data=excluded.data, updated_at=excluded.updated_at;
insert into public.reports (user_id,month,data) values ('22222222-2222-2222-2222-222222222222','2026-08','{"ok":1}'::jsonb)
  on conflict (user_id,month) do update set data=excluded.data;
\echo '--- forging created_at (expect DENIED now) ---'
insert into public.reports (user_id,month,data,created_at) values ('22222222-2222-2222-2222-222222222222','2026-07','{}'::jsonb,'2000-01-01');
\echo '--- forging id on reports (expect DENIED) ---'
insert into public.reports (id,user_id,month,data) values (gen_random_uuid(),'22222222-2222-2222-2222-222222222222','2026-06','{}'::jsonb);
\echo '--- bad month format (expect DENIED) ---'
insert into public.reports (user_id,month,data) values ('22222222-2222-2222-2222-222222222222','oct-2026','{}'::jsonb);
\echo '--- non-object json (expect DENIED) ---'
insert into public.app_state (user_id,data) values ('33333333-3333-3333-3333-333333333333','[1,2]'::jsonb);
\echo '--- oversized state (expect DENIED) ---'
update public.app_state set data = jsonb_build_object('blob', repeat('x', 5000000)) where user_id='22222222-2222-2222-2222-222222222222';
\echo '--- bad wake_time (expect DENIED) ---'
update public.profiles set wake_time='25:99' where id='22222222-2222-2222-2222-222222222222';
\echo '--- updated_at is server-stamped, not client-chosen ---'
update public.app_state set data='{"v":3}'::jsonb, updated_at='2099-01-01' where user_id='22222222-2222-2222-2222-222222222222';
select updated_at < now() + interval '1 min' as updated_at_is_sane from public.app_state where user_id='22222222-2222-2222-2222-222222222222';
reset role;
\pset pager off
\echo '=== anon (signed out) tries everything — expect permission denied ==='
set role anon;
select count(*) from public.app_state;
select count(*) from public.profiles;
insert into public.app_state (user_id,data) values ('22222222-2222-2222-2222-222222222222','{}'::jsonb);
select public.delete_my_account();
reset role;

\echo '=== delete_my_account with no session — expect "Not signed in" ==='
set role authenticated;
set request.jwt.claim.sub = '';
select public.delete_my_account();

\echo '=== A deletes own account; B must be untouched ==='
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.delete_my_account();
reset role;
select
  (select count(*) from auth.users)        as users_left,
  (select count(*) from public.profiles)   as profiles_left,
  (select count(*) from public.app_state)  as state_left,
  (select count(*) from public.reports)    as reports_left;
select id from auth.users;
