-- v1183 ログインの試し：入れたあとに確かめる（読むだけ・何も変えない）。result に NG が 1 つも無ければ OK。
with
 tb as (select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('dl_trial','dl_invites','dl_devices','dl_challenges','dl_events') and c.relkind = 'r'),
 fn as (select p.oid, p.oid::regprocedure as sig, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'dl\_%')
select 1 as no, '表が 5 つ' as check_item, case when (select count(*) from tb) = 5 then 'OK' else 'NG' end as result, (select count(*) from tb)::text as detail
union all select 2, '表は RLS ON', case when (select bool_and(relrowsecurity) from tb) then 'OK' else 'NG' end, ''
union all select 3, '公開の鍵（anon・authenticated）で表を読めない・書けない',
  case when exists (select 1 from tb, unnest(array['anon','authenticated']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE']) pr where has_table_privilege(r, 'public.' || tb.relname, pr)) then 'NG' else 'OK' end, ''
union all select 4, '関数が 25（v1185 の dl_email_・v1186 の dl_top_pin_・dl_pin_ は数えない）', case when (select count(*) from fn where fn.sig::text not like 'dl\_email\_%' and fn.sig::text not like 'dl\_top\_pin\_%' and fn.sig::text not like 'dl\_pin\_%') = 25 then 'OK' else 'NG' end, (select count(*) from fn where fn.sig::text not like 'dl\_email\_%' and fn.sig::text not like 'dl\_top\_pin\_%' and fn.sig::text not like 'dl\_pin\_%')::text
union all select 5, '公開の鍵で関数を呼べない',
  case when exists (select 1 from fn, unnest(array['anon','authenticated']) r where has_function_privilege(r, fn.oid, 'EXECUTE')) then 'NG' else 'OK' end, ''
union all select 6, 'サーバーの鍵（service_role）で関数を呼べる', case when (select bool_and(has_function_privilege('service_role', fn.oid, 'EXECUTE')) from fn) then 'OK' else 'NG' end, ''
union all select 7, '関数は security invoker・search_path 固定', case when (select bool_and(not prosecdef and array_to_string(proconfig, ',') like '%search_path%') from fn) then 'OK' else 'NG' end, ''
union all select 8, 'dl_stage() = 1', case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'dl_stage' and btrim(p.prosrc) = 'select 1') then 'OK' else 'NG' end, ''
union all select 9, '（参考）試す人・使える端末', 'info',
  case when (select count(*) from tb) = 5 then (xpath('/row/c/text()', query_to_xml('select (select count(*) from public.dl_trial)::text || '' 人・'' || (select count(*) from public.dl_devices where revoked_at is null and expires_at > now())::text || '' 台'' as c', false, true, '')))[1]::text else '—' end
order by 1;
