-- v1171 の戻し：アップグレードの明細の表を外す（toast_sales・日次実績・アプリの率は変わらない）。
-- 先に hyper-worker を v1160 の 1 ファイルに戻してから流す（v1171 の hyper-worker は表が無いと「明細を書けませんでした」を返すだけ・売上は保存する）。
drop table if exists public.toast_upgrade_lines;
drop table if exists public.toast_upgrade_days;
select 'rolled back' as result;
