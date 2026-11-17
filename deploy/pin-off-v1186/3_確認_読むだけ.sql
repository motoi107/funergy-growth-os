-- v1186 GM・CEO・経理は PIN でログインしない：入れたあとに確かめる（読むだけ・何も変えない）。result に NG が 1 つも無ければ OK。
with
 tb as (select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'dl_flags' and c.relkind = 'r'),
 fn as (select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('dl_top_pin_off','dl_top_pin_info','dl_pin_blocked','dl_pin_stage','dl_emp','dl_email_notice')),
 sw as (select case when (select count(*) from tb) = 1 and to_regprocedure('public.dl_top_pin_off()') is not null
   then (xpath('/row/c/text()', query_to_xml('select public.dl_top_pin_off()::text as c', false, true, '')))[1]::text end as on_now)
select 1 as no, '表 dl_flags' as check_item, case when (select count(*) from tb) = 1 then 'OK' else 'NG' end as result, '' as detail
union all select 2, '表は RLS ON', case when coalesce((select bool_and(relrowsecurity) from tb), false) then 'OK' else 'NG' end, ''
union all select 3, '公開の鍵（anon・authenticated）で表を読めない・書けない',
  case when (select count(*) from tb) = 0 then 'NG'
       when exists (select 1 from tb, unnest(array['anon','authenticated']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE']) pr where has_table_privilege(r, 'public.' || tb.relname, pr)) then 'NG' else 'OK' end, ''
union all select 4, '関数が 6 つ（dl_top_pin_off・dl_top_pin_info・dl_pin_blocked・dl_pin_stage と置き換えた dl_emp・dl_email_notice）',
  case when (select count(*) from fn) = 6 then 'OK' else 'NG' end, (select count(*) from fn)::text
union all select 5, '公開の鍵で dl_ の関数をどれも呼べない',
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace, unnest(array['anon','authenticated']) r
                    where n.nspname = 'public' and p.proname like 'dl\_%' and has_function_privilege(r, p.oid, 'EXECUTE')) then 'NG'
       when (select count(*) from fn) = 0 then 'NG' else 'OK' end, ''
union all select 6, 'サーバーの鍵（service_role）で関数を呼べる', case when coalesce((select bool_and(has_function_privilege('service_role', fn.oid, 'EXECUTE')) from fn), false) then 'OK' else 'NG' end, ''
union all select 7, '関数は security invoker・search_path 固定', case when coalesce((select bool_and(not prosecdef and array_to_string(proconfig, ',') like '%search_path%') from fn), false) then 'OK' else 'NG' end, ''
union all select 8, 'スイッチが入っている（GM・CEO・経理は PIN で入れない）',
  case when (select on_now from sw) = 'true' then 'OK' else 'NG' end,
  case when (select on_now from sw) = 'false' then '外れています（PIN_を戻す.sql を流したか、v1185 の止める.sql でメールのログインを外した）。止めるなら 2 をもう一度' else '' end
union all select 9, '新しい端末の知らせを時刻の順に並べてから 500 件にする（dl_email_notice）',
  case when coalesce((select prosrc like '%collate "C"%' from fn where proname = 'dl_email_notice'), false) then 'OK' else 'NG' end, ''
union all select 10, '（参考）PIN を止めた・戻した記録', 'info',
  case when to_regclass('public.dl_events') is not null then (xpath('/row/c/text()', query_to_xml($q$ select (select count(*) from public.dl_events where kind = 'pin_off')::text || ' 回・戻した ' || (select count(*) from public.dl_events where kind = 'pin_on')::text || ' 回' as c $q$, false, true, '')))[1]::text else '—' end
order by 1;
