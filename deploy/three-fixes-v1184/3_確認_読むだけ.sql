-- v1184 経費の申請の権限：入れたあとに確かめる（読むだけ・何も変えない）。result に NG が 1 つも無ければ OK。
with
 tb as (select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('wr_exp_grants','wr_exp_grant_log') and c.relkind = 'r'),
 fn as (select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('wr_exp_crew','wr_exp_hq_store','wr_exp_base','wr_exp_default','wr_exp_kinds','wr_exp_hq','wr_can_submit',
          'wr_exp_right','wr_submit','wr_act','wr_whoami','wr_exp_grant_row','wr_exp_grant_list','wr_exp_grant_save'))
select 1 as no, '表が 2 つ（wr_exp_grants・wr_exp_grant_log）' as check_item, case when (select count(*) from tb) = 2 then 'OK' else 'NG' end as result, (select count(*) from tb)::text as detail
union all select 2, '表は RLS ON', case when (select count(*) from tb) = 2 and (select bool_and(relrowsecurity) from tb) then 'OK' else 'NG' end, ''
union all select 3, '公開の鍵（anon・authenticated）で表を読めない・書けない',
  case when (select count(*) from tb) < 2 then 'NG' when exists (select 1 from tb, unnest(array['anon','authenticated']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE']) pr where has_table_privilege(r, 'public.' || tb.relname, pr)) then 'NG' else 'OK' end, ''
union all select 4, '関数が 14', case when (select count(distinct proname) from fn) = 14 then 'OK' else 'NG' end, (select count(distinct proname) from fn)::text
union all select 5, '公開の鍵で関数を呼べない',
  case when (select count(*) from fn) = 0 then 'NG' when exists (select 1 from fn, unnest(array['anon','authenticated']) r where has_function_privilege(r, fn.oid, 'EXECUTE')) then 'NG' else 'OK' end, ''
union all select 6, '関数は security invoker・search_path 固定', case when (select count(*) from fn) > 0 and (select bool_and(not prosecdef and array_to_string(proconfig, ',') like '%search_path%') from fn) then 'OK' else 'NG' end, ''
union all select 7, '出せる種類は人ごとの権限を見る（wr_exp_kinds）', case when exists (select 1 from fn where proname = 'wr_exp_kinds' and prosrc like '%wr_exp_grants%') then 'OK' else 'NG' end, '前の SQL（v1164）を流し直したら 2 をもう一度'
union all select 8, '送る・直す・出し直すときにサーバーが確かめる（wr_submit・wr_act）',
  case when exists (select 1 from fn where proname = 'wr_submit' and prosrc like '%wr_exp_right%') and exists (select 1 from fn where proname = 'wr_act' and prosrc like '%wr_exp_right%') then 'OK' else 'NG' end, '段階 2・段階 3 の SQL を流し直したら 2 をもう一度'
union all select 9, '本部（---）で出せる決まり（wr_can_submit・wr_whoami）',
  case when exists (select 1 from fn where proname = 'wr_can_submit' and prosrc like '%wr_exp_hq%') and exists (select 1 from fn where proname = 'wr_whoami' and prosrc like '%exp_hq%') then 'OK' else 'NG' end, ''
union all select 10, '事務Crew は GM・CEO の確かめで決める（従業員マスターの肩書きだけでは出せない）',
  case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'wr_exp_grants' and column_name = 'crew')
    and exists (select 1 from fn where proname = 'wr_exp_base' and prosrc like '%wr_exp_grants%' and prosrc like '%crew_wait%') then 'OK' else 'NG' end, 'NG なら 2 をもう一度（前に渡した v1184 の 2 を流した場合も）'
union all select 11, '（参考）人ごとに決めた人・変更の記録', 'info',
  case when (select count(*) from tb) = 2 then (xpath('/row/c/text()', query_to_xml('select (select count(*) from public.wr_exp_grants)::text || '' 人・'' || (select count(*) from public.wr_exp_grant_log)::text || '' 件'' as c', false, true, '')))[1]::text else '—' end
order by 1;
