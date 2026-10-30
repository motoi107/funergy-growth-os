-- v1118 キャッシュチップ：全期間の未登録に 0 を書く（1 回だけ。2 回流しても同じ）
-- 書くのは「終わった営業日（売上かクレジットチップのある日）」の「まだ入っていない側」だけ。入っている値・0・不正な値は変えません。
-- 結果の run_id は控えてください（戻すとき：戻す_埋めた0.sql）。結果を Claude に貼ってください。
select public.cash_tip_autofill(null, null, true) as result;

-- 確認：もう一度見込みを出す（期待：filled_days 0）
select public.cash_tip_autofill(null, null, false) as remaining;
