-- 中間レビュー：入れたあとの確認（読むだけ。何も書き換えません）
-- すべての行が OK になることを確かめてください。メールやトークンは出しません。
with t as (
  select c.relname, c.relrowsecurity,
    has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete') as anon_any,
    has_table_privilege('authenticated', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'update') or has_table_privilege('authenticated', c.oid, 'delete') as auth_any
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('mr_settings','mr_members','mr_stores','mr_reviews','mr_submissions','mr_replies','mr_events')
), f as (
  select p.oid, p.proname, has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') as open_to_browser, p.prosecdef
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'mr\_%'
)
select 'tables' as check_name, (select count(*) from t)::text as value, case when (select count(*) from t) = 7 then 'OK' else 'NG：表が 7 つない' end as result
union all select 'row level security', (select count(*) filter (where relrowsecurity) from t)::text, case when (select bool_and(relrowsecurity) from t) then 'OK' else 'NG' end
union all select 'browser can read or write tables', (select count(*) filter (where anon_any or auth_any) from t)::text, case when (select count(*) filter (where anon_any or auth_any) from t) = 0 then 'OK' else 'NG：ブラウザから触れる表がある' end
union all select 'functions', (select count(*) from f)::text, case when (select count(*) from f) = 12 then 'OK' else 'NG：関数が 12 個ない' end
union all select 'browser can run functions', (select count(*) filter (where open_to_browser) from f)::text, case when (select count(*) filter (where open_to_browser) from f) = 0 then 'OK' else 'NG' end
union all select 'security definer functions', (select count(*) filter (where prosecdef) from f)::text, case when (select count(*) filter (where prosecdef) from f) = 0 then 'OK' else 'NG' end
union all select 'flags', (select value::text from public.mr_settings where key = 'flags'),
  case when (select (value->>'store_publish')::boolean = false and (value->>'notify')::boolean = false from public.mr_settings where key = 'flags') then 'OK（店舗公開・通知は OFF）' else 'NG' end
union all select 'members (ceo / gm / am)', (select string_agg(role || ' ' || n, ', ' order by role) from (select role, count(*) n from public.mr_members where enabled group by role) x),
  case when exists(select 1 from public.mr_members where enabled and role in ('ceo','gm')) then 'OK' else 'NG：CEO・GM がいない' end
union all select 'members without employee id', (select count(*)::text from public.mr_members where enabled and coalesce(emp_id, '') = ''),
  case when (select count(*) from public.mr_members where enabled and coalesce(emp_id, '') = '') = 0 then 'OK' else '注意：この人は「この端末で覚える」が使えない（毎回メール認証）' end;
