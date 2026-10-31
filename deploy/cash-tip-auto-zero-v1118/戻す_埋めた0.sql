-- v1118 キャッシュチップ：ある回に書いた自動の0 を戻す（その回で書いた側のうち、まだ自動の0 のままの側だけ。人があとで入れた値は変えません）
-- 先に 止める.sql を流してください（毎日の回がまた書くため）。
-- ① 回の一覧（run_id ごとの日数と最初・最後の日）
select run_id, min(at) as at, count(*) as days, min(business_date) as first_day, max(business_date) as last_day, bool_and(undone_at is not null) as undone
  from public.cash_tip_autofill_log group by run_id order by min(at);
-- ② 戻す：下の '00000000-0000-0000-0000-000000000000' を戻したい run_id にして流す
-- select public.cash_tip_autofill_undo('00000000-0000-0000-0000-000000000000');
