-- v1212 Payroll 別のガソリン代・立替経費（B-2）：入れる前に確かめる（読むだけ・何も変えない）。Supabase の SQL Editor に貼って Run。
-- 「STOP」が 1 つも無ければ 2 へ。名前は出さない（数だけ）。表は Claude との会話にだけ貼ってください。
with
 t as (select
   to_regclass('public.wr_requests') is not null and to_regclass('public.wr_events') is not null and to_regprocedure('public.wr_actor(jsonb)') is not null as wr,
   to_regprocedure('public.wr_legacy_paid(public.wr_requests)') is not null as legacy,
   coalesce(pg_get_functiondef(to_regprocedure('public.wr_actor(jsonb)')) like '%crew_grant%', false) as v1211,
   to_regclass('public.employees') is not null as emps,
   to_regclass('public.pe_alloc') is not null as staged)
select 1 as no, '申請の SQL（wr_requests・wr_events・wr_actor）' as check_item, case when wr then 'OK' else 'STOP' end as result,
  case when wr then '' else '先に申請の SQL（deploy/work-requests-v1131 から）を。Claude に' end as detail from t
union all select 2, '前の画面の記録の確かめ（wr_legacy_paid）', case when legacy then 'OK' else 'STOP' end, case when legacy then '' else '申請の SQL が古い。Claude に' end from t
union all select 3, '社員の表', case when emps then 'OK' else 'STOP' end, '' from t
union all select 4, 'B-1（v1211・確かめた PIN の事務Crew）', case when v1211 then 'OK' else '注意' end,
  case when v1211 then '' else 'まだ（v1211 の ② を先に流すと、PIN だけの事務Crew もこの区画を使える。今のままでもメールのアカウントの事務Crew・経理・GM・CEO は使える）' end from t
union all select 5, 'もう入っているか', case when staged then 'もう入っています（2 をもう一度流しても同じ・割当・版・支給の記録は消さない）' else 'まだ（初めて）' end, '' from t
union all select 6, '（参考）精算確定（経理が確認した）のガソリン代・立替経費', 'info',
  case when wr then (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.wr_requests r where r.kind in ('mileage','reimburse') and r.status = 'checked' and r.amount_cents is not null$q$, false, true, '')))[1]::text
    || ' 件（2 のあと、精算確定の日の期間に自動で入る。時刻の無い前の画面の記録は「支給期間要確認」）' else '—' end from t
union all select 7, '（参考）精算済み（支払・精算を記録した）のガソリン代・立替経費', 'info',
  case when wr then (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.wr_requests r where r.kind in ('mileage','reimburse') and r.status = 'paid' and r.amount_cents is not null and coalesce(r.pay_method, '') <> '月末処理'$q$, false, true, '')))[1]::text
    || ' 件（支払日の期間の「既払・他経路支給額」）' else '—' end from t
union all select 8, '（参考）ガソリン代の「月末処理」', 'info',
  case when wr then (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.wr_requests r where r.kind = 'mileage' and r.status = 'paid' and coalesce(r.pay_method, '') = '月末処理'$q$, false, true, '')))[1]::text
    || ' 件（「支払状況要確認」：支給に入れない）' else '—' end from t
order by 1;
