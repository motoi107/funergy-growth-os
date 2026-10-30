-- v1121 の確認（読むだけ・何も変えない）。1 行ずつ name と ok を見る。
select 'guard function' as name, (to_regprocedure('public.vendors_keep_state()') is not null) as ok, '' as note
union all
select 'guard trigger on vendors', exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relname = 'vendors' and t.tgname = 'vendors_keep_state' and not t.tgisinternal and t.tgenabled <> 'D'), ''
union all
select 'browser roles cannot run the guard directly', not (has_function_privilege('anon', 'public.vendors_keep_state()', 'execute') or has_function_privilege('authenticated', 'public.vendors_keep_state()', 'execute')), ''
union all
select 'vendors (all rows)', true, count(*)::text from public.vendors
union all
select 'deleted (kept as a mark)', true, count(*) filter (where data ->> 'vst' = 'deleted')::text from public.vendors
union all
select 'inactive', true, count(*) filter (where data ->> 'vst' = 'inactive')::text from public.vendors
union all
select 'category purchase / construction / none / not set', true,
  count(*) filter (where data ->> 'vcat' = 'purchase')::text || ' / ' || count(*) filter (where data ->> 'vcat' = 'construction')::text || ' / ' ||
  count(*) filter (where data ->> 'vcat' = 'none')::text || ' / ' || count(*) filter (where coalesce(data ->> 'vcat', '') not in ('purchase', 'construction', 'none'))::text
  from public.vendors;
