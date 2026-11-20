-- v1202（紛失届をサーバーの申請へ）：② のあとに流す。読むだけ。全部 OK なら次へ（関数 work-requests）。
select 1 as 番号, '申請の SQL の段が 9' as 項目, case when public.wr_stage('{}'::jsonb)->>'stage' = '9' then 'OK' else 'NG' end as 結果
union all
select 2, '申請の種類に紛失届（lost）がある', case when exists (select 1 from pg_constraint where conname = 'wr_requests_kind_check' and pg_get_constraintdef(oid) like '%''lost''%') then 'OK' else 'NG' end
union all
select 3, '承認・閲覧の共通ルールの種類に紛失届がある', case when 'lost' = any(public.ar_kinds()) then 'OK' else 'NG' end
union all
select 4, '紛失届の番号は LR', case when public.wr_prefix('lost') = 'LR' then 'OK' else 'NG' end
union all
select 5, '前からの経費 3 種はそのまま', case when public.wr_prefix('reimburse') = 'RB' and 'reimburse' = any(public.ar_kinds()) then 'OK' else 'NG' end
order by 1;
