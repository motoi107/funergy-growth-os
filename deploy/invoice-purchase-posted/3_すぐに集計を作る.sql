-- 確認済みの仕入れ集計を、いま作り直す（20261029100000 を入れた直後に。流さなくても 5 分ごとの取込で作られる）。
-- 止めた・再開の設定（purchase の off）は変えない。invoice・明細・照合・QuickBooks の台帳・アプリの invoice・Drive は変えない。
-- 何度流しても同じ（内容が変わった月だけ書き直す）。結果の changed は書き直した月、frozen は締め済みで前のまま残した月。
select public.invoice_purchase_publish('{}') as result;
