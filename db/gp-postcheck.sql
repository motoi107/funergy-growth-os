-- 読むだけ（キャリア・育成 A-2）。20261219090000_gp_plan.sql を入れた「あと」と、旧の記録を写したあとに流す。最後に rollback するので何も変わりません。
-- 全部 OK なら進めます。NG があれば止めて、表を Claude との会話に貼ってください（数だけ・名前は出ません）。
begin;
create temp table gp_post(n int, what text, value text, ok text) on commit drop;
do $$
declare n bigint; m bigint;
begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and c.relname in ('gp_plans', 'gp_tasks', 'gp_notes', 'gp_log', 'gp_runs', 'gp_legacy');
  insert into gp_post values (1, '表 6 つ', n::text, case when n = 6 then 'OK' else 'NG' end);
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'gp\_%';
  insert into gp_post values (2, '関数（gp_*）', n::text, case when n >= 7 then 'OK' else 'NG' end);
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'gp\_%' and grantee in ('anon', 'authenticated', 'PUBLIC');
  insert into gp_post values (3, '公開の鍵の権限（表）', n::text, case when n = 0 then 'OK' else 'NG' end);
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'gp\_%' and grantee = 'service_role' and privilege_type in ('DELETE', 'TRUNCATE');
  insert into gp_post values (4, 'サーバーの鍵で消す・空にする権限', n::text, case when n = 0 then 'OK' else 'NG' end);
  select count(*) into n from information_schema.role_routine_grants
   where routine_schema = 'public' and routine_name like 'gp\_%' and grantee in ('anon', 'authenticated', 'PUBLIC');
  insert into gp_post values (5, '公開の鍵の権限（関数）', n::text, case when n = 0 then 'OK' else 'NG' end);
  select count(*), count(*) filter (where c.relrowsecurity) into n, m from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and c.relname like 'gp\_%';
  insert into gp_post values (6, 'RLS が有効な表', m::text || ' / ' || n::text, case when n = m then 'OK' else 'NG' end);
  select count(*) into n from (select emp_id from public.gp_plans where status = 'active' group by emp_id having count(*) > 1) x;
  insert into gp_post values (7, '開いている計画が 2 つ以上の人', n::text, case when n = 0 then 'OK' else 'NG' end);
  select count(*) into n from public.gp_tasks where state = 'mastered' and (mastered_basis is null or mastered_by_emp is null);
  insert into gp_post values (8, '根拠の無い習得確認', n::text, case when n = 0 then 'OK' else 'NG' end);
  select count(*), count(*) filter (where decision = 'saved_as_old' and reason <> '') into n, m from public.gp_legacy;
  insert into gp_post values (9, '旧の記録の写し（旧として保存・理由つき）', m::text || ' / ' || n::text, case when n = m then 'OK' else 'NG' end);
  select count(*) into n from public.gp_legacy_source() c where not exists (select 1 from public.gp_legacy h where h.src_key = c.src_key and h.src_part = c.src_part and h.src_hash = c.src_hash);
  insert into gp_post values (10, 'まだ写していない旧の記録（写したあとは 0）', n::text, case when n = 0 then 'OK' else 'info（写す前）' end);
end $$;
select n, what, value, ok from gp_post order by n;
rollback;
