-- v1202（紛失届をサーバーの申請へ）：② の前に流す。読むだけ（何も変えない）。
select 1 as 番号, '承認・閲覧の共通ルールの SQL（20261209090000）が入っている' as 項目,
  case when to_regprocedure('public.ar_kinds()') is not null and to_regprocedure('public.wr_stage(jsonb)') is not null then 'OK' else 'NG：先に deploy/approval-rules-v1190 の ②' end as 結果
union all
select 2, '今の申請の SQL の段（8＝初めて・9＝もう入っている）',
  case when to_regprocedure('public.wr_stage(jsonb)') is null then 'NG' else coalesce(public.wr_stage('{}'::jsonb)->>'stage', '?') end
union all
select 3, '紛失届（lost）の申請の数（初めてなら 0）', (select count(*)::text from public.wr_requests where kind = 'lost')
order by 1;
