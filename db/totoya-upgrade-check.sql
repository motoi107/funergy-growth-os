-- Totoya のアップグレード率の元データを見る（読むだけ・何も変えない）。結果の表は Claude との会話にだけ貼ってください（お客様の情報・金額は出ません）。
-- 期間はハワイ時間の今日から 45 日前まで（day は 14 日前まで）。店は stores の id が F04 で始まる店。
-- part の見方：
--   cols    … toast_item_modifier_sales の列と、toast_sales の味噌汁・日付・取り込みの時刻の列（a＝表・b＝列・c＝型）
--   sales   … 店ごとの toast_sales（b＝行のある日・味噌汁の値のある日／c＝分母 miso_total_count の合計・分子 miso_upgrade_count の合計／d＝率／e＝最初と最後の日・最後に取り込んだ時刻）
--   modall  … 店ごとのモディファイヤーの行（b＝行の数／c＝日数／d＝モディファイヤーの名前の数・商品の数）。0 なら商品別・日別の内訳を出す元データが無い
--   modname … 店ごと・名前ごと（aosa・crab・today・udon・chazuke・miso・味噌・茶漬を含む名前だけ。a＝名前／b＝数量の合計／c＝日数・商品の数／d＝商品の名前（列があれば））
--   day     … 店ごと・日ごと（b＝toast_sales の分母／分子、c＝モディファイヤーから数えた分母／分子（aosa・crab・today・udon・chazuke）、d＝一致するか）
with hst as (select (now() at time zone 'Pacific/Honolulu')::date as today),
toto as (select id, name, toast_guid from public.stores where id like 'F04%' and coalesce(toast_guid, '') <> ''),
ts as (
  select t.id sid, r.j, left(coalesce(r.j->>'business_date', r.j->>'date', ''), 10) d
  from toto t join (select to_jsonb(x) j from public.toast_sales x) r on r.j->>'restaurant_guid' = t.toast_guid
),
tsr as (select * from ts, hst where d <> '' and d::date between hst.today - 45 and hst.today),
mm as (
  select t.id sid, r.j, left(coalesce(r.j->>'business_date', r.j->>'date', ''), 10) d,
    lower(btrim(coalesce(r.j->>'modifier_name', ''))) mn,
    coalesce(nullif(r.j->>'qty', '')::numeric, 0) q
  from toto t join (select to_jsonb(x) j from public.toast_item_modifier_sales x) r on r.j->>'restaurant_guid' = t.toast_guid
),
mmr as (select * from mm, hst where d <> '' and d::date between hst.today - 45 and hst.today)
select 'cols' part, '' store, table_name a, column_name b, data_type c, '' d, '' e
from information_schema.columns
where table_schema = 'public' and (table_name = 'toast_item_modifier_sales'
  or (table_name = 'toast_sales' and column_name ~* 'miso|date|fetch|updat|synced|chazuke'))
union all
select 'sales', t.id, t.name,
  'days ' || count(distinct s.d)::text || ' / miso_days ' || (count(distinct s.d) filter (where s.j->>'miso_total_count' is not null))::text,
  'total ' || coalesce(sum(nullif(s.j->>'miso_total_count', '')::numeric), 0)::text || ' / upgrade ' || coalesce(sum(nullif(s.j->>'miso_upgrade_count', '')::numeric), 0)::text,
  case when coalesce(sum(nullif(s.j->>'miso_total_count', '')::numeric), 0) > 0
    then round(sum(nullif(s.j->>'miso_upgrade_count', '')::numeric) / sum(nullif(s.j->>'miso_total_count', '')::numeric) * 100, 1)::text || '%' else '—' end,
  coalesce(min(s.d), '') || ' 〜 ' || coalesce(max(s.d), '') || ' / last ' ||
    coalesce(max(greatest(coalesce(s.j->>'fetched_at', ''), coalesce(s.j->>'updated_at', ''), coalesce(s.j->>'synced_at', ''))), '')
from toto t left join tsr s on s.sid = t.id
group by t.id, t.name
union all
select 'modall', t.id, t.name, 'rows ' || count(m.sid)::text, 'days ' || count(distinct m.d)::text,
  'names ' || count(distinct m.mn)::text || ' / items ' || count(distinct m.j->>'item_guid')::text, ''
from toto t left join mmr m on m.sid = t.id
group by t.id, t.name
union all
select 'modname', m.sid, m.mn, 'qty ' || sum(m.q)::text,
  'days ' || count(distinct m.d)::text || ' / items ' || count(distinct m.j->>'item_guid')::text,
  left(coalesce(string_agg(distinct nullif(m.j->>'item_name', ''), ' ／ '), ''), 300), ''
from mmr m
where m.mn ~ '(aosa|crab|today|udon|chazuke|miso|味噌|茶漬)'
group by m.sid, m.mn
union all
select 'day', s.sid, s.d,
  'toast ' || coalesce(s.j->>'miso_total_count', '—') || ' / ' || coalesce(s.j->>'miso_upgrade_count', '—'),
  'mod ' || coalesce(x.al::text, '—') || ' / ' || coalesce(x.up::text, '—'),
  case when x.al is null then 'モディファイヤーの行なし'
    when x.al = nullif(s.j->>'miso_total_count', '')::numeric and x.up = nullif(s.j->>'miso_upgrade_count', '')::numeric then '一致'
    else 'ちがう' end,
  ''
from tsr s
left join (
  select sid, d,
    sum(q) filter (where mn ~ '(aosa|crab|today|udon|chazuke)') al,
    sum(q) filter (where mn ~ '(crab|today|udon|chazuke)') up
  from mmr group by sid, d
) x on x.sid = s.sid and x.d = s.d, hst
where s.d::date >= hst.today - 14
order by 1, 2, 3;
