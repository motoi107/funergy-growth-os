-- 中間レビュー：入れたあとの確認（読むだけ。何も書き換えません）
-- すべての行が OK になることを確かめてください。メールやトークンは出しません。
with t as (
  select c.relname, c.relrowsecurity,
    has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete') as anon_any,
    has_table_privilege('authenticated', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'update') or has_table_privilege('authenticated', c.oid, 'delete') as auth_any
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('mr_settings','mr_members','mr_stores','mr_reviews','mr_submissions','mr_replies','mr_events')
), fn(name) as (
  values ('mr_setting'),('mr_am_hr_ok'),('mr_am_master_ok'),('mr_auth'),('mr_sees'),('mr_event'),('mr_arr'),('mr_blank'),('mr_date_ok'),('mr_written'),('mr_item_at'),('mr_reply_outdated'),('mr_decided'),('mr_targets_at'),('mr_summary'),
   ('mr_whoami'),('mr_list'),('mr_settings_save'),('mr_members_list'),('mr_stores_save'),('mr_demo_reset'),
   ('mr_view_body'),('mr_actor_name'),('mr_missing'),('mr_get'),('mr_save'),('mr_submit'),
   ('mr_required_targets'),('mr_open_waits'),('mr_target_final'),('mr_recompute'),('mr_reply_review'),('mr_reply_save'),('mr_reply_delete'),
   ('mr_reply_missing'),('mr_reply_send'),('mr_complete'),('mr_deadline_save'),('mr_result_save')
), f as (
  select p.oid, p.proname, has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') as open_to_browser, p.prosecdef,
   coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=public%' as fixed_path
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (select name from fn)
)
select 'tables' as check_name, (select count(*) from t)::text as value, case when (select count(*) from t) = 7 then 'OK' else 'NG：表が 7 つない' end as result
union all select 'row level security', (select count(*) filter (where relrowsecurity) from t)::text, case when (select bool_and(relrowsecurity) from t) then 'OK' else 'NG' end
union all select 'browser can read or write tables', (select count(*) filter (where anon_any or auth_any) from t)::text, case when (select count(*) filter (where anon_any or auth_any) from t) = 0 then 'OK' else 'NG：ブラウザから触れる表がある' end
union all select 'browser can use the event sequence', (select (has_sequence_privilege('anon', 'public.mr_events_id_seq', 'usage') or has_sequence_privilege('authenticated', 'public.mr_events_id_seq', 'usage'))::text),
  case when not (has_sequence_privilege('anon', 'public.mr_events_id_seq', 'usage') or has_sequence_privilege('authenticated', 'public.mr_events_id_seq', 'usage')) then 'OK' else 'NG' end
union all select 'functions', (select count(*) from f)::text, case when (select count(*) from f) = (select count(*) from fn) and (select count(distinct proname) from f) = (select count(*) from fn) then 'OK' else 'NG：関数の数が違う' end
union all select 'functions with a fixed search_path', (select count(*) filter (where fixed_path) from f)::text, case when (select bool_and(fixed_path) from f) then 'OK' else 'NG' end
union all select 'browser can run functions', (select count(*) filter (where open_to_browser) from f)::text, case when (select count(*) filter (where open_to_browser) from f) = 0 then 'OK' else 'NG' end
union all select 'security definer functions', (select count(*) filter (where prosecdef) from f)::text, case when (select count(*) filter (where prosecdef) from f) = 0 then 'OK' else 'NG' end
union all select 'flags', (select value::text from public.mr_settings where key = 'flags'),
  case when (select (value->>'store_publish')::boolean = false and (value->>'notify')::boolean = false from public.mr_settings where key = 'flags') then 'OK（店舗公開・通知は OFF）' else 'NG' end
union all select 'members (ceo / gm / am)', (select string_agg(role || ' ' || n, ', ' order by role) from (select role, count(*) n from public.mr_members where enabled group by role) x),
  case when exists(select 1 from public.mr_members where enabled and role in ('ceo','gm')) then 'OK' else 'NG：CEO・GM がいない' end
union all select 'ceo / gm not in manager_auth', (select count(*)::text from public.mr_members m where m.enabled and m.role in ('ceo','gm')
   and not exists(select 1 from public.manager_auth a where a.user_id = m.user_id and a.role in ('ceo','gm'))),
  case when (select count(*) from public.mr_members m where m.enabled and m.role in ('ceo','gm')
   and not exists(select 1 from public.manager_auth a where a.user_id = m.user_id and a.role in ('ceo','gm'))) = 0 then 'OK' else '注意：この人は入れない（manager_auth で CEO・GM ではない）' end
union all select 'members without employee id', (select count(*)::text from public.mr_members where enabled and coalesce(emp_id, '') = ''),
  case when (select count(*) from public.mr_members where enabled and coalesce(emp_id, '') = '') = 0 then 'OK' else '注意：この人は「この端末で覚える」が使えない（毎回メール認証）。AM は入れない' end
union all select 'am not an am in the employee master', (select count(*)::text from public.mr_members m where m.enabled and m.role = 'am' and not public.mr_am_hr_ok(m.emp_id)),
  case when (select count(*) from public.mr_members m where m.enabled and m.role = 'am' and not public.mr_am_hr_ok(m.emp_id)) = 0 then 'OK'
   else '注意：この AM は入れない（社員の表に無い・AM ではない・退職）。止めるなら mid-review-disable-member.sql' end
union all select 'live stores the saved AM cannot see', (select count(*)::text from public.mr_stores s where s.env = 'live' and s.active and s.am_user is not null
   and not public.mr_am_master_ok(s.am_user, s.store_id)),
  case when (select count(*) from public.mr_stores s where s.env = 'live' and s.active and s.am_user is not null and not public.mr_am_master_ok(s.am_user, s.store_id)) = 0 then 'OK'
   else '注意：店舗マスターの AM 欄と違う店がある（アプリの設定で担当を確かめて保存）' end;
