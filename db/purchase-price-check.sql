-- ② 仕入れの単価：経理が確認した invoice の単価の記録を、店 × 業者 × 食材 × 規格 × 仕入単位 ごとに、
-- いちばん新しい invoice と、その前の別の invoice で比べる（読むだけ。何も書き換えません）。変わった割合の大きい順に 80 行。そのまま Claude に貼ってください。
--   確認済み … 仕入れ集計と同じ決まり（反映済みの invoice で、照合済みか、人が反映して「アプリと同じかもしれない」の印が無いもの・差異ありは除く）
--   比べる単価（cmp）… 仕入分析（v1123 の invoice_price_cmp）と同じ順で 1 つ選ぶ：
--     規格の基本の単位があれば 1 LB・1 L・1 個 → 数の単位があれば 1 袋など → 仕入単位が量（LB・kg・L・gal など）なら 1 LB・1 L・1 個
--   chg_pct ……… 両方が同じ比べる単位（cmp_unit）のときだけ出す（片方だけ規格がある・単位が違うときは出さず note に書く）
--   note ………… first（前の invoice が無い）・no_spec（比べる単価が決まらない）・unit_changed（比べる単位が違う）・
--                 check_link（同じ invoice に同じ品が違う単価で 2 つ）・check_jump（50% を超える変化）
--   per_purchase … 仕入単位（ケースなど）1 つの単価。per_count … 1 個（数の単位）の単価。per_base … 1 g・1 ml・1 個（基本の単位）の単価
--   line_check …… その明細の「数量 × 単価」と金額の差（$0.05 を超えると要確認）
with conf as (
  select d.id
    from public.invoice_docs d
   where d.status = 'posted' and d.doc_type = 'invoice' and d.recon_status <> 'discrepancy'
     and (d.recon_status = 'reconciled'
          or (d.posted_mode = 'manual'
              and not exists (select 1 from jsonb_array_elements(coalesce(d.reasons, '[]'::jsonb)) r where r->>'code' = 'app_duplicate_candidate')))
),
h as (
  select p.*, x.v, x.u,
         row_number() over w as rn,
         min(p.price_per_purchase) over (partition by p.store_id, p.vendor_key, p.ingredient_code, p.spec_key, p.purchase_unit, p.doc_id)
           <> max(p.price_per_purchase) over (partition by p.store_id, p.vendor_key, p.ingredient_code, p.spec_key, p.purchase_unit, p.doc_id) as two
    from public.invoice_price_history p
    join conf c on c.id = p.doc_id
    cross join lateral (select rtrim(lower(btrim(normalize(coalesce(p.purchase_unit, ''), NFKC))), '.') as pu) q
    left join lateral (
      -- the first of: per base unit, per count unit, per purchase unit when it is a measure (a price with none of them still shows)
      select n.v, n.u
        from (values
          (1, case when p.price_per_base > 0 then case p.base_unit when 'g' then round(p.price_per_base * 453.59237, 6)
                                                                    when 'ml' then round(p.price_per_base * 1000, 6)
                                                                    when 'ea' then round(p.price_per_base, 6) end end,
              case p.base_unit when 'g' then 'LB' when 'ml' then 'L' when 'ea' then 'EA' end),
          (2, case when p.price_per_count > 0 and btrim(coalesce(p.count_unit, '')) <> '' then round(p.price_per_count, 6) end,
              upper(btrim(coalesce(p.count_unit, '')))),
          (3, case when p.price_per_purchase > 0 then round(case
                    when q.pu in ('lb','lbs','#','pound','pounds') then p.price_per_purchase
                    when q.pu in ('kg','kgs','kilo') then p.price_per_purchase * 0.45359237
                    when q.pu in ('g','gr','gram','grams') then p.price_per_purchase * 453.59237
                    when q.pu in ('oz','ounce') then p.price_per_purchase * 16
                    when q.pu in ('l','lt','ltr','liter','litre') then p.price_per_purchase
                    when q.pu in ('ml','cc') then p.price_per_purchase * 1000
                    when q.pu in ('gal','gallon') then p.price_per_purchase / 3.785411784
                    when q.pu in ('qt','quart') then p.price_per_purchase / 0.946352946
                    when q.pu in ('ea','each','pc','pcs','piece','count','個','本') then p.price_per_purchase end, 6) end,
              case when q.pu in ('lb','lbs','#','pound','pounds','kg','kgs','kilo','g','gr','gram','grams','oz','ounce') then 'LB'
                   when q.pu in ('l','lt','ltr','liter','litre','ml','cc','gal','gallon','qt','quart') then 'L'
                   when q.pu in ('ea','each','pc','pcs','piece','count','個','本') then 'EA' end)
        ) n(o, v, u)
       where n.v is not null
       order by n.o
       limit 1
    ) x on true
   where p.status = 'active'
  window w as (partition by p.store_id, p.vendor_key, p.ingredient_code, p.spec_key, p.purchase_unit
               order by p.effective_date desc, lpad(coalesce(p.invoice_no_norm, ''), 40, '0') desc, p.id desc)
),
pair as (
  select a.store_id, a.vendor_key, a.ingredient_code, a.spec_key, a.purchase_unit,
         a.effective_date as d, a.invoice_no_norm as inv, a.price_per_purchase as pp, a.price_per_count as pc, a.count_unit as cu,
         a.price_per_base as pb, a.base_unit as bu, a.line_id, a.v, a.u,
         b.effective_date as prev_d, b.invoice_no_norm as prev_inv, b.price_per_purchase as prev_pp, b.price_per_base as prev_pb, b.v as prev_v, b.u as prev_u,
         case when a.u = b.u and b.v > 0 and not (a.two or coalesce(b.two, false)) then 100 * (a.v / b.v - 1) end as chg,
         case when a.two or coalesce(b.two, false) then 'check_link'
              when a.v is null then 'no_spec'
              when b.id is null then 'first'
              when b.v is null then 'no_spec'
              when a.u is distinct from b.u then 'unit_changed'
              when b.v > 0 and abs(a.v / b.v - 1) > 0.5 then 'check_jump' end as note
    from h a
    left join lateral (
      -- the price before: the newest price of another invoice in the same group
      select b.* from h b
       where b.store_id = a.store_id and b.vendor_key = a.vendor_key and b.ingredient_code = a.ingredient_code
         and b.spec_key is not distinct from a.spec_key and b.purchase_unit is not distinct from a.purchase_unit
         and b.doc_id <> a.doc_id
       order by b.rn
       limit 1
    ) b on true
   where a.rn = 1
)
select pair.store_id, pair.vendor_key, pair.ingredient_code, coalesce(nullif(pair.spec_key, ''), '-') as spec, coalesce(nullif(pair.purchase_unit, ''), '-') as unit,
       pair.prev_d, pair.prev_inv, round(pair.prev_pp, 4) as prev_per_purchase, round(pair.prev_pb, 6) as prev_per_base, pair.prev_v as prev_cmp, pair.prev_u as prev_cmp_unit,
       pair.d, pair.inv, round(pair.pp, 4) as per_purchase, round(pair.pc, 6) as per_count, pair.cu as count_unit, round(pair.pb, 6) as per_base, pair.bu as base_unit,
       pair.v as cmp, pair.u as cmp_unit, round(pair.chg, 1) as chg_pct, pair.note,
       l.qty, round(l.unit_price, 4) as unit_price, l.amount_cents,
       round(abs(coalesce(l.qty, 0) * coalesce(l.unit_price, 0) * 100 - coalesce(l.amount_cents, 0) - coalesce(l.line_discount_cents, 0)) / 100, 2) as line_check
  from pair left join public.invoice_lines l on l.id = pair.line_id
 order by abs(coalesce(pair.chg, 0)) desc nulls last, (pair.note is null), pair.store_id, pair.vendor_key, pair.ingredient_code
 limit 80;
