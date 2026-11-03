-- v1132 ワークセンターの申請 2 段目（評価の変更 3 種・スキルマトリクスの表示）：入れる前の確認（読むだけ・何も変えない）。
-- STOP があれば止めて、結果を Claude に。
select '1 段目（v1131）の表 7 つ' as check_name,
  case when (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('wr_settings','wr_counters','wr_requests','wr_versions','wr_events','wr_people','wr_people_log')) = 7 then 'OK' else 'STOP（先に deploy/work-requests-v1131 の手順）' end as result
union all select '1 段目の関数 wr_submit',
  case when to_regprocedure('public.wr_submit(jsonb)') is not null then 'OK' else 'STOP（先に deploy/work-requests-v1131 の手順）' end
union all select '2 段目がもう入っている（0 = 初めて）',
  case when to_regclass('public.wr_views') is null then '0' else '1（流し直しても同じ）' end
union all select 'wr_ functions now (44 = 1 段目だけ・54 = 2 段目も)',
  (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'wr\_%')
union all select 'live（参考：使い始めたか）',
  case when to_regclass('public.wr_settings') is null then '—'
    else coalesce((xpath('/table/row/v/text()', query_to_xml('select live::text as v from public.wr_settings where id = 1', false, false, '')))[1]::text, '—') end
union all select 'G4 以上として確かめた人（参考：この人たちだけが評価の変更を出せる）',
  case when to_regclass('public.wr_people') is null then '—'
    else coalesce((xpath('/table/row/v/text()', query_to_xml('select count(*)::text as v from public.wr_people where role = ''staff'' and grade >= 4', false, false, '')))[1]::text, '0') end;
