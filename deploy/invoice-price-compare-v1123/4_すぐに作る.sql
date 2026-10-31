-- 仕入れの単価の比較を今すぐ作る（ふだんは Invoice取込が 5 分ごとに作ります）。invoice・明細・単価の記録・設定は変えません。何度流しても同じ。
select public.invoice_price_compare_publish('{"force":true}'::jsonb) as result;
