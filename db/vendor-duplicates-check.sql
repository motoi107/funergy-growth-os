-- ③ 業者マスター：重複の候補と、それぞれに結びついている記録の数（読むだけ。何も書き換えません）。そのまま Claude に貼ってください。
-- 1 行 ＝ 業者マスター（vendors）の 1 枚。名前をそろえたキー（小文字・記号と空白・Inc／LLC などを外したもの）が同じ業者を same_key に数えます。
--   same_key > 1 …… 名前のゆれの候補（同じ会社とは限りません。支店・別会社かは人が決めます）
--   app_invoices …… アプリで登録した請求書（spl_invoices_<店>）でその名前を使っている数
--   drive_docs …… Invoice取込の書類（反映済み・確認待ち）で、業者の表示名がその名前の数
--   ingredients …… 食材マスターでその業者名の食材の数
--   intake_rule …… Invoice取込の業者（invoice_vendor_rules）で、表示名か別名がその名前のもの（統合先があれば → で）
--   flags …… カードの印（kind＝食材／食材以外、deleted・inactive など、data にあるもの）
with v as (
  select id::text as id, coalesce(name, '') as name, coalesce(data, '{}'::jsonb) as d from public.vendors
),
k as (
  select id, name, d,
    regexp_replace(regexp_replace(lower(name), '\y(inc|llc|co|corp|corporation|ltd|company|the|hawaii)\y', '', 'g'), '[[:space:][:punct:]（）・、。]+', '', 'g') as key
    from v
),
inv as (
  select e.value ->> 'vendor' as vendor
    from public.app_state a,
         jsonb_array_elements(case when jsonb_typeof(a.value::jsonb) = 'array' then a.value::jsonb
                                   when jsonb_typeof(a.value::jsonb -> 'v') = 'array' then a.value::jsonb -> 'v'
                                   else '[]'::jsonb end) e
   where a.key like 'spl\_invoices\_%' escape '\' and jsonb_typeof(e.value) = 'object'
),
inv_n as (select lower(btrim(vendor)) as n, count(*) as c from inv group by 1),
doc_n as (select lower(btrim(coalesce(vendor_name, ''))) as n, count(*) as c from public.invoice_docs where status in ('posted', 'review') group by 1),
ing_n as (select lower(btrim(coalesce(vendor, ''))) as n, count(*) as c from public.ingredients group by 1),
rule as (
  select lower(btrim(r.display_name)) as n, r.vendor_key || coalesce(' → ' || r.merged_into, '') as label from public.invoice_vendor_rules r
  union
  select lower(btrim(a)), r.vendor_key || coalesce(' → ' || r.merged_into, '') from public.invoice_vendor_rules r, unnest(r.aliases) a
)
select count(*) over (partition by k.key) as same_key, k.key, k.id, k.name,
       coalesce((select c from inv_n where n = lower(btrim(k.name))), 0) as app_invoices,
       coalesce((select c from doc_n where n = lower(btrim(k.name))), 0) as drive_docs,
       coalesce((select c from ing_n where n = lower(btrim(k.name))), 0) as ingredients,
       (select string_agg(distinct label, ', ') from rule where rule.n = lower(btrim(k.name))) as intake_rule,
       concat_ws(' ', 'kind=' || (k.d ->> 'kind'), 'cat=' || (k.d ->> 'cat'),
                 case when (k.d ->> 'deleted') = 'true' or (k.d ->> '_deleted') = 'true' then 'deleted' end,
                 case when (k.d ->> 'active') = 'false' or (k.d ->> 'inactive') = 'true' then 'inactive' end) as flags
  from k
 order by same_key desc, k.key, k.name;
