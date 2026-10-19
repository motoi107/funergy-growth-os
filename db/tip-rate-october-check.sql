-- 読むだけ（何も変えない）：10 月の Tip Rate の決定（承認・却下・引き上げ）と変更履歴（v1095 の調べ・Moto さん 10/19「%チップ率タブで変えた率が 10 月後半に反映されない」）。
-- Supabase → SQL Editor に貼って Run。結果の表を Claude に（写真でも）。名前が出るので、GitHub には貼らない。
-- 見るところ：
--   ・「効く日」＝チップの配分にその率を使い始める日（ハワイの日付）。10/16 からの配分は、その日以降だけ新しい率になる。
--   ・10/1〜10/15 の配分は Tip Rate ではなく従業員マスターの評価係数（v1092 からの決まり）。
-- 1) Tip Rate の申請・決定（人ごとの行 spl_tip_requests_<名前> の中身）
with rows_ as (
  select a.key, a.updated_at,
    case when jsonb_typeof(a.value) = 'array' then a.value
         when jsonb_typeof(a.value) = 'object' and jsonb_typeof(a.value->'v') = 'array' then a.value->'v'
         else '[]'::jsonb end as arr
  from public.app_state a
  where a.key like 'spl_tip_requests_%'
), recs as (
  select r.key, x.value as rec from rows_ r cross join lateral jsonb_array_elements(r.arr) x
)
select
  rec->>'name'                                   as "名前",
  rec->>'store'                                  as "店舗",
  rec->>'status'                                 as "状態",
  rec->>'rate'                                   as "率",
  case rec->>'basis' when 'manual' then '引き上げ（直接）' when 'skill' then 'スキルからの申請' else coalesce(rec->>'basis', '申請') end as "種類",
  rec->>'date'                                   as "申請した日（端末）",
  rec->>'approver'                               as "決めた人",
  rec->>'approvedDate'                           as "決めた日（端末）",
  rec->>'decDay'                                 as "効く日（ハワイ）",
  case when (rec->>'decAt') ~ '^\d+$' then to_char(to_timestamp((rec->>'decAt')::bigint / 1000.0) at time zone 'Pacific/Honolulu', 'YYYY-MM-DD HH24:MI') end as "決めた時刻（ハワイ）",
  rec->>'id'                                     as "id"
from recs
where coalesce(rec->>'decDay', '') >= '2026-10-01'
   or replace(coalesce(rec->>'approvedDate', ''), '-', '/') >= '2026/10/01'
   or replace(coalesce(rec->>'date', ''), '-', '/') >= '2026/10/01'
order by "決めた時刻（ハワイ）" desc nulls last, "名前";

-- 2) Tip Rate 変更履歴（人ごとの行 spl_tip_history_<名前>。画面の「Tip Rate 変更履歴」と同じもの）
with rows_ as (
  select a.key,
    case when jsonb_typeof(a.value) = 'array' then a.value
         when jsonb_typeof(a.value) = 'object' and jsonb_typeof(a.value->'v') = 'array' then a.value->'v'
         else '[]'::jsonb end as arr
  from public.app_state a
  where a.key like 'spl_tip_history_%'
)
select x.value->>'name' as "名前", x.value->>'store' as "店舗", x.value->>'rate' as "率", x.value->>'status' as "状態",
       x.value->>'by' as "変えた人", x.value->>'date' as "日（端末）", x.value->>'basis' as "種類"
from rows_ r cross join lateral jsonb_array_elements(r.arr) x
where replace(coalesce(x.value->>'date', ''), '-', '/') >= '2026/10/01'
order by "日（端末）" desc, "名前";
