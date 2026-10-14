-- 確認済みの仕入れ集計を止める（使うのは「やめて元に戻す」ときだけ）。
-- アプリ（v1077 以降）は、予実管理の原価率などをすべての月で今までの数え方（Drive の写しを含む invoice の合計）に戻し、
-- 「仕入れ」タブには「止めてあります」と出します。
-- 消すものはありません：invoice・明細・照合・QuickBooks の台帳・そろったかの記録・Drive のファイルは、どれもそのままです。
-- 再開するときは、下の 2 行目のかわりに db/invoice-purchase-start.sql を流します。
insert into public.invoice_settings(key, value) values('purchase', '{"off": true}')
on conflict(key) do update set value = public.invoice_settings.value || '{"off": true}', updated_at = now();
select public.invoice_purchase_publish('{}') as result;
