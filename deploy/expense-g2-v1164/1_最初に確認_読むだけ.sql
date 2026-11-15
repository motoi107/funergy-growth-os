-- v1164 経費の申請（G2〜G6）：入れる前の確認（読むだけ・何も変えない）。STOP が無ければ 2 へ。（参考）は数を見るだけ。
select '1. 申請の SQL（段階 2 まで）が入っている' as check_name,
  case when to_regprocedure('public.wr_can_submit(jsonb,text,text)') is not null and to_regprocedure('public.wr_s2_live()') is not null
    and to_regprocedure('public.wr_people_items()') is not null then 'OK' else 'STOP（先に deploy/work-requests-v1155 の ②）' end as result
union all select '2. もう入っている（入っていれば 1。もう一度流しても同じ）',
  case when to_regprocedure('public.wr_exp_kinds(jsonb)') is not null then '1' else '0' end
union all select '（参考）経費の承認待ち（ガソリン代・建て替え・事前経費）',
  (select count(*)::text from public.wr_requests where kind in ('mileage','reimburse','expense_pre') and status = 'pending')
union all select '（参考）経費の申請を出したことのある人の数（G2 以上の人）',
  (select count(distinct requester_emp)::text from public.wr_requests where kind in ('mileage','reimburse','expense_pre'));
