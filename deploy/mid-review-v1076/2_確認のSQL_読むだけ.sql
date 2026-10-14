-- 中間レビュー：入れたあとの確認（読むだけ。何も書き換えません）
-- すべての行が OK になることを確かめてください（注意・参考は、その人・その店を設定で確かめる）。メールやトークンは出しません。
with t as (
  select c.relname, c.relrowsecurity,
    has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete') as anon_any,
    has_table_privilege('authenticated', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'update') or has_table_privilege('authenticated', c.oid, 'delete') as auth_any
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('mr_settings','mr_members','mr_stores','mr_reviews','mr_submissions','mr_replies','mr_events')
), fn(name) as (
  values ('mr_setting'),('mr_am_hr_ok'),('mr_am_master_ok'),('mr_auth'),('mr_sees'),('mr_event'),('mr_arr'),('mr_reserved_level'),('mr_blank'),('mr_date_ok'),('mr_written'),('mr_item_at'),('mr_reply_outdated'),('mr_decided'),('mr_targets_at'),('mr_summary'),
   ('mr_whoami'),('mr_list'),('mr_settings_save'),('mr_members_list'),('mr_stores_save'),('mr_demo_reset'),
   ('mr_view_body'),('mr_actor_name'),('mr_missing'),('mr_get'),('mr_save'),('mr_submit'),
   ('mr_required_targets'),('mr_open_waits'),('mr_target_final'),('mr_recompute'),('mr_reply_review'),('mr_reply_save'),('mr_reply_delete'),
   ('mr_reply_missing'),('mr_reply_send'),('mr_complete'),('mr_deadline_save'),('mr_result_save'),
   -- v2 (20261015090000)
   ('mr_in_service'),('mr_chef_hr_ok'),('mr_staff_hr_ok'),('mr_viewer_hr_ok'),('mr_input_kind'),('mr_emp_name'),('mr_member_role'),('mr_need_email'),('mr_pin_actor'),('mr_today'),
   ('mr_can'),('mr_store'),('mr_legacy'),('mr_status_v2'),('mr_txt_ok'),('mr_date_or_empty'),('mr_eval_v'),('mr_obj'),('mr_body_check_v2'),('mr_missing_v2'),
   ('mr_snap_check_v2'),('mr_overdue'),('mr_counts_v2'),('mr_input_info'),('mr_review_summary'),('mr_row_v2'),('mr_post'),('mr_confirm'),('mr_unconfirm'),
   ('mr_review_row'),('mr_ensure_member'),('mr_is_input_somewhere'),('mr_cand_json'),('mr_access_get'),('mr_access_save'),('mr_month_input_save'),('mr_chef_save'),
   -- v1073 (20261016090000)
   ('mr_ver'),('mr_settings_bump'),('mr_stores_bump')
), f as (
  select p.oid, p.proname, has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') as open_to_browser,
   has_function_privilege('service_role', p.oid, 'execute') as service_ok, p.prosecdef,
   coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=public%' as fixed_path
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (select name from fn)
), src as (
  select p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
   and p.proname in ('mr_auth','mr_member_role','mr_reply_send','mr_access_save','mr_settings_save','mr_stores_save','mr_row_v2')
), v2 as (
  select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mr_stores' and column_name = 'input_emp')
   and exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mr_replies' and column_name = 'client_id')
   and exists(select 1 from f where proname = 'mr_missing_v2') and exists(select 1 from f where proname = 'mr_can')
   and exists(select 1 from src where proname = 'mr_reply_send' and position('gone' in prosrc) > 0)
   and to_regclass('public.mr_members_one_per_emp') is not null and to_regclass('public.mr_replies_client') is not null as ok
), v3 as (
  -- v1073: the versions are there, the triggers move them, and the two saves compare them (a second run of v2 would put back saves without it)
  select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mr_settings' and column_name = 'version')
   and exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mr_stores' and column_name = 'access_version')
   and exists(select 1 from pg_trigger g where g.tgname = 'mr_settings_bump' and g.tgrelid = 'public.mr_settings'::regclass and not g.tgisinternal and g.tgenabled <> 'D')
   and exists(select 1 from pg_trigger g where g.tgname = 'mr_stores_bump' and g.tgrelid = 'public.mr_stores'::regclass and not g.tgisinternal and g.tgenabled <> 'D')
   and exists(select 1 from src where proname = 'mr_access_save' and position('expect_version' in prosrc) > 0 and position('conflict' in prosrc) > 0)
   and exists(select 1 from src where proname = 'mr_settings_save' and position('expect_version' in prosrc) > 0 and position('conflict' in prosrc) > 0)
   and exists(select 1 from src where proname = 'mr_stores_save' and position('expect_version' in prosrc) > 0 and position('conflict' in prosrc) > 0)
   and exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mr_stores' and column_name = 'am_version') as ok
), v4 as (
  -- the stores_save fix (20261017090000): the write itself requires the version read (a store put in after the compare is not written over)
  select exists(select 1 from src where proname = 'mr_stores_save' and position('and am_version = public.mr_ver(s->''expect_version'')' in prosrc) > 0) as ok
), v5 as (
  -- the store oversight may be a GM too (20261018090000): the save takes a GM, and the list row says whose role it is
  select exists(select 1 from src where proname = 'mr_stores_save' and position('public.mr_member_role(x) in (''am'',''gm'')' in prosrc) > 0)
   and exists(select 1 from src where proname = 'mr_row_v2' and position('''am_role''' in prosrc) > 0) as ok
), m as (
  -- the role each enabled person has now (the same rule as mr_member_role; written out so this check also runs before v2)
  select x.*, case
    when x.role in ('ceo','gm') then (select case when count(*) = 0 then null when x.role = 'gm' or bool_or(a.role = 'gm') then 'gm' else 'ceo' end
      from public.manager_auth a where a.user_id = x.user_id and a.role in ('ceo','gm'))
    when x.role = 'am' then case when exists(select 1 from public.employees e where e.id::text = x.emp_id and e.role = 'am' and coalesce(e.status, '') <> '退職') then 'am' end
    when x.role = 'chef' then case when exists(select 1 from public.employees e where e.id::text = x.emp_id and coalesce(e.status, '') <> '退職'
      and (e.role = 'chef' or btrim(coalesce(to_jsonb(e)->>'title', '')) in ('Head Chef','Corporate Chef'))) then 'chef' end
    when x.role = 'staff' then case when exists(select 1 from public.employees e where e.id::text = x.emp_id and coalesce(e.status, '') <> '退職') then 'staff' end
   end as role_now
  from public.mr_members x where x.enabled
)
select 'tables' as check_name, (select count(*) from t)::text as value, case when (select count(*) from t) = 7 then 'OK' else 'NG：表が 7 つない' end as result
union all select 'row level security', (select count(*) filter (where relrowsecurity) from t)::text, case when (select bool_and(relrowsecurity) from t) then 'OK' else 'NG' end
union all select 'browser can read or write tables', (select count(*) filter (where anon_any or auth_any) from t)::text, case when (select count(*) filter (where anon_any or auth_any) from t) = 0 then 'OK' else 'NG：ブラウザから触れる表がある' end
union all select 'browser can use the event sequence', (select (has_sequence_privilege('anon', 'public.mr_events_id_seq', 'usage') or has_sequence_privilege('authenticated', 'public.mr_events_id_seq', 'usage'))::text),
  case when not (has_sequence_privilege('anon', 'public.mr_events_id_seq', 'usage') or has_sequence_privilege('authenticated', 'public.mr_events_id_seq', 'usage')) then 'OK' else 'NG' end
union all select 'functions', (select count(*) from f)::text, case when (select count(*) from f) = (select count(*) from fn) and (select count(distinct proname) from f) = (select count(*) from fn) then 'OK' else 'NG：関数の数が違う' end
union all select 'functions with a fixed search_path', (select count(*) filter (where fixed_path) from f)::text, case when (select bool_and(fixed_path) from f) then 'OK' else 'NG' end
union all select 'browser can run functions', (select count(*) filter (where open_to_browser) from f)::text, case when (select count(*) filter (where open_to_browser) from f) = 0 then 'OK' else 'NG' end
union all select 'service role can run functions', (select count(*) filter (where service_ok) from f)::text, case when (select bool_and(service_ok) from f) then 'OK' else 'NG' end
union all select 'security definer functions', (select count(*) filter (where prosecdef) from f)::text, case when (select count(*) filter (where prosecdef) from f) = 0 then 'OK' else 'NG' end
union all select 'mid-review v2 (20261015090000)', (select ok::text from v2), case when (select ok from v2) then 'OK' else 'NG：20261015090000_mid_review_v2.sql がまだ（関数 v2 はこれが要る）' end
union all select 'mid-review versions (20261016090000)', (select ok::text from v3),
  case when (select ok from v3) then 'OK' else 'NG：20261016090000_mid_review_v2_versions.sql がまだ（20261015090000 を流し直したときも、続けてもう一度流す）' end
union all select 'mid-review stores_save fix (20261017090000)', (select ok::text from v4),
  case when (select ok from v4) then 'OK' else 'NG：20261017090000_mid_review_stores_save_fix.sql がまだ（20261016090000 を流し直したときも、続けてもう一度流す）' end
union all select 'mid-review scope GM (20261018090000)', (select ok::text from v5),
  case when (select ok from v5) then 'OK' else 'NG：20261018090000_mid_review_scope_gm.sql がまだ（20261016090000・20261017090000 を流し直したときも、続けてもう一度流す）' end
union all select 'flags', (select value::text from public.mr_settings where key = 'flags'),
  case when (select (value->>'store_publish')::boolean = false and (value->>'notify')::boolean = false from public.mr_settings where key = 'flags') then 'OK（店舗公開・通知は OFF）' else 'NG' end
union all select 'live input', (select coalesce(value->>'live_input', 'null') from public.mr_settings where key = 'flags'),
  case when (select value->>'live_input' from public.mr_settings where key = 'flags') = 'true' then 'OK（本番の店の入力は ON）'
   when (select value->>'live_input' from public.mr_settings where key = 'flags') = 'false' then 'OK（本番の店の入力は OFF）' else 'NG：live_input が無い' end
union all select 'members (enabled, by role)', (select string_agg(role || ' ' || n, ', ' order by role) from (select role, count(*) n from m group by role) x),
  case when exists(select 1 from m where role in ('ceo','gm')) then 'OK' else 'NG：CEO・GM がいない' end
union all select 'one enabled row per employee', (select count(*)::text from (select emp_id from m where coalesce(emp_id, '') <> '' group by emp_id having count(*) > 1) x),
  case when (select count(*) from (select emp_id from m where coalesce(emp_id, '') <> '' group by emp_id having count(*) > 1) x) = 0 then 'OK' else 'NG' end
union all select 'ceo / gm not in manager_auth', (select count(*)::text from m where m.role in ('ceo','gm')
   and not exists(select 1 from public.manager_auth a where a.user_id = m.user_id and a.role in ('ceo','gm'))),
  case when (select count(*) from m where m.role in ('ceo','gm')
   and not exists(select 1 from public.manager_auth a where a.user_id = m.user_id and a.role in ('ceo','gm'))) = 0 then 'OK' else '注意：この人は入れない（manager_auth で CEO・GM ではない）' end
union all select 'ceo here but gm in manager_auth', (select count(*)::text from m where m.role = 'ceo'
   and exists(select 1 from public.manager_auth a where a.user_id = m.user_id and a.role = 'gm')),
  case when (select count(*) from m where m.role = 'ceo'
   and exists(select 1 from public.manager_auth a where a.user_id = m.user_id and a.role = 'gm')) = 0 then 'OK' else '注意：この人はここでは GM として扱う（manager_auth が GM）' end
union all select 'gm here but ceo in manager_auth', (select count(*)::text from m where m.role = 'gm'
   and exists(select 1 from public.manager_auth a where a.user_id = m.user_id and a.role = 'ceo') and not exists(select 1 from public.manager_auth a where a.user_id = m.user_id and a.role = 'gm')),
  case when (select count(*) from m where m.role = 'gm'
   and exists(select 1 from public.manager_auth a where a.user_id = m.user_id and a.role = 'ceo') and not exists(select 1 from public.manager_auth a where a.user_id = m.user_id and a.role = 'gm')) = 0 then 'OK'
   else '注意：この人はここでは GM のまま（役職は自動では広げない。CEO にするかは Claude に相談）' end
union all select 'role narrowing (v1068)', (select bool_or(position('bool_or' in prosrc) > 0)::text from src where proname in ('mr_auth','mr_member_role')),
  case when (select bool_or(position('bool_or' in prosrc) > 0) from src where proname in ('mr_auth','mr_member_role')) then 'OK' else 'NG：20261013090000 か 20261015090000 がまだ' end
union all select 'members without employee id', (select count(*)::text from m where coalesce(emp_id, '') = ''),
  case when (select count(*) from m where coalesce(emp_id, '') = '') = 0 then 'OK' else '注意：この人は PIN では入れない（メールだけ）。AM は入れない' end
union all select 'am not an am in the employee master', (select count(*)::text from m where m.role = 'am' and m.role_now is null),
  case when (select count(*) from m where m.role = 'am' and m.role_now is null) = 0 then 'OK'
   else '注意：この AM は入れない（社員の表に無い・AM ではない・退職）。止めるなら mid-review-disable-member.sql' end
union all select 'chef no longer Head Chef / Corporate Chef', (select count(*)::text from m where m.role = 'chef' and m.role_now is null),
  case when (select count(*) from m where m.role = 'chef' and m.role_now is null) = 0 then 'OK'
   else '注意：この人は入れない（退職・肩書きが変わった）。担当・閲覧設定で外す' end
union all select 'staff not in service', (select count(*)::text from m where m.role = 'staff' and m.role_now is null),
  case when (select count(*) from m where m.role = 'staff' and m.role_now is null) = 0 then 'OK' else '注意：この人は入れない（退職・社員の表に無い）' end
union all select 'live stores the saved AM cannot see', (select count(*)::text from public.mr_stores s where s.env = 'live' and s.active and s.am_user is not null
   and not public.mr_am_master_ok(s.am_user, s.store_id)),
  case when (select count(*) from public.mr_stores s where s.env = 'live' and s.active and s.am_user is not null and not public.mr_am_master_ok(s.am_user, s.store_id)) = 0 then 'OK'
   else '注意：店舗マスターの AM 欄と違う店がある（アプリの設定で担当を確かめて保存）' end
union all select 'live stores without an input person', (select count(*)::text from public.mr_stores s where s.env = 'live' and s.active and to_jsonb(s)->>'input_emp' is null),
  case when (select count(*) from public.mr_stores s where s.env = 'live' and s.active and to_jsonb(s)->>'input_emp' is null) = 0 then 'OK'
   else '参考：入力担当が未設定の店がある（担当・閲覧設定で選ぶ。未設定の店はだれも入力できない）' end;
