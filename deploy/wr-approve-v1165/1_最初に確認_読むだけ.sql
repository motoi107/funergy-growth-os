-- v1165 申請/承認（事前経費と実費を結ぶ）：入れる前の確認（読むだけ・何も変えない）。STOP が無ければ 2 へ。（参考）は数を見るだけ。
select '1. 段階 3 と v1164 の SQL が入っている' as check_name,
  case when to_regprocedure('public.wr_s3_kind(text)') is not null and to_regprocedure('public.wr_exp_kinds(jsonb)') is not null
    and to_regprocedure('public.wr_row(jsonb,public.wr_requests)') is not null then 'OK' else 'STOP（先に deploy/work-requests-v1159 の ② と deploy/expense-g2-v1164 の 2）' end as result
union all select '2. もう入っている（入っていれば 1。もう一度流しても同じ）',
  case when to_regprocedure('public.wr_link_pre(jsonb)') is not null then '1' else '0' end
union all select '3. 前からある列とぶつからない（pre_id が無いか、uuid）',
  case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'wr_requests' and column_name = 'pre_id')
    or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'wr_requests' and column_name = 'pre_id' and data_type = 'uuid') then 'OK' else 'STOP（Claude に）' end
union all select '（参考）事前承認済みの事前経費（実費に結べるもの）',
  (select count(*)::text from public.wr_requests where kind = 'expense_pre' and status = 'done')
union all select '（参考）経理の確認待ちの建て替え経費（結ぶ相手を選べるもの）',
  (select count(*)::text from public.wr_requests where kind = 'reimburse' and status = 'approved');
