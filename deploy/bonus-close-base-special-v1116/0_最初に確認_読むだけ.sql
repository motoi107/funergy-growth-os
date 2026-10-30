-- v1116 ボーナスの締め：無条件で基準額・特別報酬。入れる前の確認（読むだけ・何も変えません）。結果の表をそのまま Claude に貼ってください（名前・金額は出ません）。
select 'v1109 bonus close is installed (bc_quarters, bc_versions)' as check_item,
  case when to_regclass('public.bc_quarters') is not null and to_regclass('public.bc_versions') is not null then 'OK' else 'STOP: 先に v1109 の SQL' end as result
union all
select 'bc_ functions (21 = v1109 / 29 = v1116 already)',
  (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'bc\_%')
union all
select 'pay column (0 = not yet)',
  (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'bc_quarters' and column_name = 'pay')
union all
select 'GM・CEO accounts with an employee link (emp_id)',
  case when (select count(*) from public.manager_auth m where m.role in ('ceo','gm') and coalesce(btrim(m.emp_id::text), '') = '') = 0 then 'OK'
    else 'NG: ' || (select count(*) from public.manager_auth m where m.role in ('ceo','gm') and coalesce(btrim(m.emp_id::text), '') = '')::text
      || '（この人は無条件で基準額・特別報酬を変えられません。db/invoice-signin-emp-check.sql で確かめて emp_id を入れる）' end
union all
select 'versions saved so far',
  case when to_regclass('public.bc_versions') is null then '-' else (select count(*)::text from public.bc_versions) end;
