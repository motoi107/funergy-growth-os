-- v1185 メールとパスワードのログイン：入れたあとに確かめる（読むだけ・何も変えない）。result に NG が 1 つも無ければ OK。
with
 tb as (select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'dl_email_devices' and c.relkind = 'r'),
 fn as (select p.oid, p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('dl_email_login','dl_email_notice','dl_email_stage'))
select 1 as no, '表 dl_email_devices' as check_item, case when (select count(*) from tb) = 1 then 'OK' else 'NG' end as result, '' as detail
union all select 2, '表は RLS ON', case when coalesce((select bool_and(relrowsecurity) from tb), false) then 'OK' else 'NG' end, ''
union all select 3, '公開の鍵（anon・authenticated）で表を読めない・書けない',
  case when (select count(*) from tb) = 0 then 'NG'
       when exists (select 1 from tb, unnest(array['anon','authenticated']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE']) pr where has_table_privilege(r, 'public.' || tb.relname, pr)) then 'NG' else 'OK' end, ''
union all select 4, '関数が 3 つ（dl_email_login・dl_email_notice・dl_email_stage）', case when (select count(*) from fn) = 3 then 'OK' else 'NG' end, (select count(*) from fn)::text
union all select 5, '公開の鍵で関数を呼べない',
  case when (select count(*) from fn) = 0 then 'NG'
       when exists (select 1 from fn, unnest(array['anon','authenticated']) r where has_function_privilege(r, fn.oid, 'EXECUTE')) then 'NG' else 'OK' end, ''
union all select 6, 'サーバーの鍵（service_role）で関数を呼べる', case when coalesce((select bool_and(has_function_privilege('service_role', fn.oid, 'EXECUTE')) from fn), false) then 'OK' else 'NG' end, ''
union all select 7, '関数は security invoker・search_path 固定', case when coalesce((select bool_and(not prosecdef and array_to_string(proconfig, ',') like '%search_path%') from fn), false) then 'OK' else 'NG' end, ''
union all select 8, '（参考）GM・CEO・経理のアカウントのうち社員と結ばれている数', 'info',
  (xpath('/row/c/text()', query_to_xml('select (select count(*) from public.manager_auth m where m.role in (''ceo'',''gm'',''office'') and exists (select 1 from public.employees e where e.id::text = m.emp_id::text))::text || '' / '' || (select count(*) from public.manager_auth where role in (''ceo'',''gm'',''office''))::text as c', false, true, '')))[1]::text
union all select 9, '（参考）メールで入った回数・覚えた端末', 'info',
  case when (select count(*) from tb) = 1 then (xpath('/row/c/text()', query_to_xml('select (select count(*) from public.dl_events where kind in (''email_start'',''email_refresh'') and result = ''ok'')::text || '' 回・'' || (select count(*) from public.dl_email_devices)::text || '' 台'' as c', false, true, '')))[1]::text else '—' end
order by 1;
