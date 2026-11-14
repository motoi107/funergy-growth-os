-- 読むだけ（何も変えない）：v1165（UI案77 の 2A）「承認」タブを無くして「申請/承認」1 つにする前と後の件数
-- 入れる前に 1 回・入れたあとにもう 1 回流して、数を比べる（同じ記録が両方に数えられていないか・どこにも出なくなったものが無いか）。
-- 出すのは 種類・状態・件数・番号の数だけ（名前・タイトル・金額・理由は出さない）。
-- 前の承認タブの記録（app_state の approvals と分割の行）は、同じ id は 1 回だけ数える（分割の行を先に＝アプリ・サーバーと同じ）。
-- v1165 の SQL（20261126090000）の前でも流せる（pre_id の列は to_jsonb で読む）。

with old_rows as (
  select distinct on (w.x->>'id') w.x
  from public.wr_state_rows('approvals') w
  where jsonb_typeof(w.x) = 'object' and coalesce(w.x->>'id', '') <> ''
  order by w.x->>'id', w.prio
), old as (
  select coalesce(nullif(x->>'type', ''), '(種類なし)') as type,
         coalesce(nullif(x->>'status', ''), '(状態なし)') as status,
         coalesce(x->>'wrq', '') not in ('', '0', 'false') as marked,
         nullif(x->>'wrc', '') as wrc
  from old_rows
), wr as (
  select r.kind, r.status, r.code, coalesce(r.legacy, false) as legacy, coalesce(r.legacy_info->>'src', '') as src,
         nullif(to_jsonb(r)->>'pre_id', '') as pre_id
  from public.wr_requests r
), wr_kind as (
  select kind, count(*) as n from wr group by kind
)
-- 1 前の「承認」タブの記録：種類 × 状態 × ワークセンターに写した印（wrq）
select '1 前の承認タブ' as part, type as kind, status,
       case when marked then 'ワークセンターへ写した印あり' else '印なし' end as note, count(*)::text as n
from old group by type, status, marked
union all
-- 2 ワークセンターの申請：種類 × 状態 × どこから来たか
select '2 ワークセンター', kind, status,
       case when legacy then '前から写した（' || coalesce(nullif(src, ''), '元の記録なし') || '）' else '新しく出した' end, count(*)::text
from wr group by kind, status, legacy, src
union all
-- 3 切り替えのあと「申請/承認 › 前の承認の画面を開く」で処理する承認待ち（印なしの承認待ち）。段階 3 を使い始めていれば 0 になるはず
select '3 前の承認の画面に残る承認待ち', type, 'pending', '切り替えのあと 申請/承認 から開く', count(*)::text
from old where status = 'pending' and not marked group by type
union all
select '3 前の承認の画面に残る承認待ち', '(合計)', 'pending', case when (select count(*) from old where status = 'pending' and not marked) = 0 then 'OK（0）' else '数を見る' end,
       (select count(*) from old where status = 'pending' and not marked)::text
union all
-- 4 印（wrq）はあるのに、その番号（wrc）がワークセンターに無い記録（どちらの画面にも出ない）→ 0 でなければ Claude に
select '4 印があるのにワークセンターに無い', '(合計)', '', case when count(*) = 0 then 'OK（0）' else 'NG：Claude に' end, count(*)::text
from old o where o.marked and (o.wrc is null or not exists (select 1 from wr where wr.code = o.wrc))
union all
-- 5 同じ前の記録を 2 回写していないか（前の承認タブの id ごと）→ 0 でなければ Claude に
select '5 同じ前の記録を 2 回写した', '(合計)', '', case when count(*) = 0 then 'OK（0）' else 'NG：Claude に' end, count(*)::text
from (select r.legacy_info->>'id' as id from public.wr_requests r where coalesce(r.legacy, false) and r.legacy_info->>'src' = 'approvals' and coalesce(r.legacy_info->>'id', '') <> ''
      group by 1 having count(*) > 1) d
union all
-- 6 v1165（4B・5A）：事前経費に結んだ実費（建て替え経費）の数。SQL の前は 0
select '6 事前経費に結んだ実費', 'reimburse', status, '予定を超えて GM に戻したものも含む', count(*)::text
from wr where pre_id is not null group by status
union all
-- 7 ワークセンターの申請の種類ごとの合計（入れる前と後で減っていないこと）
select '7 ワークセンターの合計', kind, '', '', n::text from wr_kind
order by 1, 2, 3, 4;
