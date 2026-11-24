-- v1212 Payroll 別のガソリン代・立替経費（B-2）：入れたあとの確かめ（読むだけ・何も変えない）。result に NG が無ければ OK。
-- 7〜10 は次の支給日（土日・祝日をよけた日）。本当の Payroll の日と違えば、アプリの「支給日の決まり」で休日を足す・外す（CEO・GM・経理）。
with
 f as (select count(*) as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'pe\_%'),
 tb as (select count(*) as n from unnest(array['pe_settings','pe_alloc','pe_exports','pe_paid','pe_paid_req']) x where to_regclass('public.' || x) is not null),
 pv as (select
   bool_or(has_table_privilege(r, 'public.' || x, 'select')) as tab,
   bool_or(has_function_privilege(r, 'public.pe_get(jsonb)', 'execute') or has_function_privilege(r, 'public.pe_mark_paid(jsonb)', 'execute')) as fn
   from unnest(array['anon','authenticated']) r, unnest(array['pe_settings','pe_alloc','pe_exports','pe_paid','pe_paid_req']) x),
 cur as (select to_char((now() at time zone 'Pacific/Honolulu')::date, 'YYYY-MM') ym)
select 1 as no, '表 5 つ' as check_item, case when (select n from tb) = 5 then 'OK' else 'NG' end as result, (select n from tb)::text as detail
union all select 2, '関数（pe_）', case when (select n from f) >= 26 then 'OK' else 'NG' end, (select n from f)::text
union all select 3, 'ブラウザの鍵（anon・authenticated）から表を読めない', case when (select tab from pv) then 'NG' else 'OK' end, ''
union all select 4, 'ブラウザの鍵から関数を呼べない', case when (select fn from pv) then 'NG' else 'OK' end, ''
union all select 5, '支給日の決まり', case when exists (select 1 from public.pe_settings where id = 1) then 'OK' else 'NG' end,
  (select '1〜15 日 → ' || day_first || ' 日・16 日〜末日 → 翌月 ' || day_second || ' 日' from public.pe_settings where id = 1)
union all select 6, '（参考）割当のある申請', 'info', (select count(distinct request_id)::text || ' 件（アプリで区画を開くと、精算確定・精算済みの申請に入る）' from public.pe_alloc where off_at is null)
union all select 7, '（参考）今月 1〜15 日の支給日', 'info', (select public.pe_pay_day(ym || '-1')::text from cur)
union all select 8, '（参考）今月 16 日〜末日の支給日', 'info', (select public.pe_pay_day(ym || '-2')::text from cur)
union all select 9, '（参考）来月 1〜15 日の支給日', 'info', (select public.pe_pay_day(to_char((ym || '-01')::date + interval '1 month', 'YYYY-MM') || '-1')::text from cur)
union all select 10, '（参考）来月 16 日〜末日の支給日', 'info', (select public.pe_pay_day(to_char((ym || '-01')::date + interval '1 month', 'YYYY-MM') || '-2')::text from cur)
order by 1;
