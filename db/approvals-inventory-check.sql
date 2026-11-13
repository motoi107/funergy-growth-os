-- 読むだけ（何も変えない）：前の「承認」タブの申請（app_state の approvals）と、承認ルートの設定（approval_routing）
-- ワークセンター「申請/承認」段階 2 の前に、本番で使っている種類・状態・件数と承認者の設定を見るためのもの。
-- 名前・タイトル・金額は出しません（種類・状態・件数・日付の幅・役割の名前だけ）。

with raw as (
  select value::jsonb as v from public.app_state where key = 'approvals'
), arr as (
  select case when jsonb_typeof(v) = 'object' and v ? 'v' then v -> 'v' else v end as a from raw
), items as (
  select e from arr, jsonb_array_elements(case when jsonb_typeof(a) = 'array' then a else '[]'::jsonb end) as e
  where jsonb_typeof(e) = 'object'
), counted as (
  select coalesce(nullif(e ->> 'type', ''), '(種類なし)') as type,
         coalesce(nullif(e ->> 'status', ''), '(状態なし)') as status,
         count(*) as n,
         count(*) filter (where jsonb_typeof(e -> 'acct') = 'object' and coalesce(e -> 'acct' ->> 'off', '') <> 'true') as acct_checked,
         count(*) filter (where jsonb_typeof(e -> 'signoffs') = 'array' and jsonb_array_length(e -> 'signoffs') > 0) as with_signoffs,
         min(e ->> 'date') as oldest,
         max(e ->> 'date') as newest
  from items
  group by 1, 2
)
select '1 申請' as part, type, status, n::text as n, acct_checked::text as acct_checked, with_signoffs::text as with_signoffs,
       coalesce(oldest, '') as oldest, coalesce(newest, '') as newest
from counted
union all
select '2 承認ルートの設定' as part, r.key as type,
       coalesce((select string_agg(x, '・' order by ord) from jsonb_array_elements_text(case when jsonb_typeof(r.value) = 'array' then r.value else '[]'::jsonb end) with ordinality as t(x, ord)), '(なし)') as status,
       '' , '', '', '', ''
from (
  select key, value from (
    select case when jsonb_typeof(v) = 'object' and v ? 'v' and jsonb_typeof(v -> 'v') = 'object' then v -> 'v' else v end as m
    from (select value::jsonb as v from public.app_state where key = 'approval_routing') s
  ) w, jsonb_each(case when jsonb_typeof(m) = 'object' then m else '{}'::jsonb end)
) r
union all
select '2 承認ルートの設定', '(保存なし＝初期値)', '', '', '', '', '', ''
where not exists (select 1 from public.app_state where key = 'approval_routing')
order by 1, 2, 3;
