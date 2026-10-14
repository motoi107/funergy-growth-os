-- 確認済みの仕入れ集計をすぐに作る（入れた直後・止めたあとに再開するとき）。
-- いつもは Invoice取込 の 5 分ごとの動きと、反映・照合などの操作のあとに自動で作り直すので、流さなくてもかまいません。
-- 何も消しません・invoice や台帳は変えません。何度流しても同じです（内容が変わった月だけ書き直します）。
-- 結果の changed は書き直した月、frozen は締め済みで前のまま残した月です。
insert into public.invoice_settings(key, value) values('purchase', '{"off": false}')
on conflict(key) do update set value = public.invoice_settings.value || '{"off": false}', updated_at = now();
select public.invoice_purchase_publish('{}') as result;
