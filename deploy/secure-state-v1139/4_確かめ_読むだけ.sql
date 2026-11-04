-- 読むだけ（v1139・2b-1）。20261108090000_secure_state_rls.sql を入れた「あと」に、Supabase の SQL Editor で流す。
-- 最後に rollback するので何も変わりません。全部の行が OK なら入っています。NG があったら、表をそのまま Claude に貼ってください（中身は出ません）。
begin;
create temp table ss_chk(n int, what text, value text, ok text) on commit drop;
grant insert on ss_chk to anon;   -- 下で anon として結果を書くため（この一時表だけ。rollback で消える）
insert into ss_chk
select 1, 'app_state の RLS', case when c.relrowsecurity then 'ON' else 'OFF' end, case when c.relrowsecurity then 'OK' else 'NG' end
  from pg_class c where c.oid = 'public.app_state'::regclass;
insert into ss_chk
select 2, '決まり ss_secret（restrictive・anon と authenticated）', count(*)::text,
       case when count(*) = 1 and bool_and(p.permissive = 'RESTRICTIVE' and p.roles @> array['anon', 'authenticated']::name[] and p.cmd = 'ALL') then 'OK' else 'NG' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname = 'ss_secret';
insert into ss_chk
select 3, '決まり ss_secret_key（対象のキーか）', count(*)::text, case when count(*) = 1 then 'OK' else 'NG' end
  from pg_proc p where p.proname = 'ss_secret_key' and p.pronamespace = 'public'::regnamespace;
insert into ss_chk
select 4, '対象のキーの判定（9 つ）', (select count(*) from unnest(array['growth_karte','karte_pin','karte_bonus_config','bonus_q','bonus_eval','bonus_store_q','bonus_rules','bonus_pool_extra','spl_bonus_q_2026-Q3']) k where public.ss_secret_key(k))::text,
       case when (select count(*) from unnest(array['growth_karte','karte_pin','karte_bonus_config','bonus_q','bonus_eval','bonus_store_q','bonus_rules','bonus_pool_extra','spl_bonus_q_2026-Q3']) k where public.ss_secret_key(k)) = 9
             and not public.ss_secret_key('spl_bonus_q_') and not public.ss_secret_key('bonus_eval_rule') and not public.ss_secret_key('tasks_all') then 'OK' else 'NG' end;
-- ここから公開の鍵（anon）として読む
set local role anon;
insert into ss_chk
select 5, 'anon で読める対象のキーの行', count(*)::text, case when count(*) = 0 then 'OK' else 'NG' end
  from public.app_state where public.ss_secret_key(key::text);
insert into ss_chk
select 6, 'anon で読めるほかの行（今までどおり）', count(*)::text, case when count(*) > 0 then 'OK' else 'NG' end
  from public.app_state where not public.ss_secret_key(key::text);
reset role;
insert into ss_chk
select 7, 'サーバーの鍵・postgres で読める対象のキーの行（関数 secure-state が使う）', count(*)::text, 'info'
  from public.app_state where public.ss_secret_key(key::text);
select n, what, value, ok from ss_chk order by n;
rollback;
