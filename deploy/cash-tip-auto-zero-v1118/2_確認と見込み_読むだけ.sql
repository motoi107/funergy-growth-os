-- v1118 キャッシュチップ：確認と見込み（読むだけ。何も書き換えません。名前・金額は出しません）
-- 1_追加のSQL のあとに流します。結果の 3 つの表を Claude に貼ってください。

-- ① 入ったか（期待：4 つとも true）
select
  to_regclass('public.cash_tip_autofill_log') is not null                                          as log_table,
  to_regprocedure('public.cash_tip_autofill(date,date,boolean)') is not null                       as fill_fn,
  to_regprocedure('public.cash_tip_autofill_undo(uuid)') is not null                               as undo_fn,
  not has_function_privilege('anon', 'public.cash_tip_autofill(date,date,boolean)', 'execute')
    and not has_function_privilege('authenticated', 'public.cash_tip_autofill(date,date,boolean)', 'execute')
    and not has_table_privilege('anon', 'public.cash_tip_autofill_log', 'select')                 as browser_cannot_run;

-- ② 今の「未登録」の形（店ごと・側ごとの数。終わった営業日だけ）
--   entered_number / entered_zero …… 入っている（人が入れた値。0 も正しい値）
--   auto_zero ……………………………… 自動の0（v1118 で書いたもの）。undone … 戻した側（もう書かない）
--   no_record ……………………………… その日の記録が無い（売上かクレジットチップのある日だけ数える）→ 0 を書く
--   flag_off_or_missing …………… 記録はあるが、その側の「入力済み」の印が無く、値が空・null・0 → 0 を書く
--   flag_off_nonzero ……………… 「入力済み」の印は無いが 0 でない金額がある → 書かない（その金額のまま計算される）
--   value_null / value_blank … 「入力済み」なのに値が null・空の文字（0 として計算される）
--   invalid …………………………………… 数でない値・マイナス（エラーのまま。自動では直さない）
with today as (select (now() at time zone 'Pacific/Honolulu')::date as d),
stores as (
  select x.store_id, max(x.guid) as guid from (
    select c.store_id::text as store_id, c.restaurant_guid::text as guid from public.store_config c
    union all
    select substr(a.key, 15), null from public.app_state a where a.key like 'daily\_actuals\_%' escape '\' and position('_' in substr(a.key, 15)) = 0
  ) x where coalesce(x.store_id, '') <> '' and x.store_id not in ('F03', 'F03-G') group by x.store_id
),
da as (
  select s.store_id, case when a.value::jsonb ->> '__st' = '1' then a.value::jsonb -> 'v' else a.value::jsonb end as v
    from stores s left join public.app_state a on a.key = 'daily_actuals_' || s.store_id
),
days as (
  select distinct s.store_id, t.business_date::date as d from stores s join public.toast_sales t on t.restaurant_guid = s.guid
   where (t.lunch_credit_tip is not null or t.dinner_credit_tip is not null or coalesce(t.net_sales, 0) > 0)
  union
  select da.store_id, public.cash_tip_try_date(e.key) from da, jsonb_each(case when jsonb_typeof(da.v) = 'object' then da.v else '{}'::jsonb end) e
   where public.cash_tip_try_date(e.key) is not null and jsonb_typeof(e.value) = 'object'
     and ((case when jsonb_typeof(e.value -> 'actual') = 'number' then (e.value ->> 'actual')::numeric > 0 else false end)
       or coalesce(jsonb_typeof(e.value -> 'lunchCreditTip'), 'null') <> 'null'
       or coalesce(jsonb_typeof(e.value -> 'dinnerCreditTip'), 'null') <> 'null')
),
ct as (
  select s.store_id, case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb end as v
    from stores s left join public.app_state a on a.key = 'cash_tips_' || s.store_id
),
sides as (
  select dy.store_id, dy.d, sd.side, ct.v -> dy.d::text as r
    from days dy cross join (values ('lunch'), ('dinner')) sd(side) join ct on ct.store_id = dy.store_id, today
   where dy.d < today.d
),
k as (
  select store_id, d, side, r,
    case when r is null or jsonb_typeof(r) <> 'object' then null
         when r ? (side || 'Entered') then (r -> (side || 'Entered')) = 'true'::jsonb
         else (r -> 'entered') = 'true'::jsonb end as entered,
    r -> side as val
    from sides
),
c as (
  select store_id, d, side,
    case
      when r is null then 'no_record'
      when jsonb_typeof(r) <> 'object' then 'invalid'
      when coalesce(entered, false) then
        case when val is null or jsonb_typeof(val) = 'null' then 'value_null'
             when jsonb_typeof(val) = 'string' and btrim(val #>> '{}') = '' then 'value_blank'
             when jsonb_typeof(val) = 'number' then case when (val #>> '{}')::numeric < 0 then 'invalid' when (val #>> '{}')::numeric = 0 then 'entered_zero' else 'entered_number' end
             when jsonb_typeof(val) = 'string' and btrim(val #>> '{}') ~ '^([0-9]+\.?[0-9]*|\.[0-9]+)$' then 'entered_number'
             else 'invalid' end
      when (r -> (side || 'Auto')) = 'false'::jsonb then 'undone'
      when val is null or jsonb_typeof(val) = 'null' then case when (r -> (side || 'Auto')) = 'true'::jsonb then 'auto_zero' else 'flag_off_or_missing' end
      when jsonb_typeof(val) = 'string' and btrim(val #>> '{}') = '' then 'flag_off_or_missing'
      when jsonb_typeof(val) = 'number' then
        case when (val #>> '{}')::numeric = 0 then case when (r -> (side || 'Auto')) = 'true'::jsonb then 'auto_zero' else 'flag_off_or_missing' end
             when (val #>> '{}')::numeric > 0 then 'flag_off_nonzero'
             else 'invalid' end
      when jsonb_typeof(val) = 'string' and btrim(val #>> '{}') ~ '^([0-9]+\.?[0-9]*|\.[0-9]+)$' then 'flag_off_nonzero'
      else 'invalid' end as kind
    from k
)
select store_id, kind, count(*) as sides, count(distinct d) as days, min(d) as first_day, max(d) as last_day
  from c group by store_id, kind order by store_id, kind;

-- ③ 見込み（何も書きません）：全期間で 0 を書く日と側の数。filled_days／filled_sides が「埋める数」
select public.cash_tip_autofill(null, null, false) as preview;
