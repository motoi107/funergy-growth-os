-- ② 仕入れの単価：経理が確認した invoice（Invoice取込で反映済み）の明細から、同じ食材・同じ規格・同じ単位で前回と比べる（読むだけ。何も書き換えません）。
-- 1 行 ＝ 店 × 業者 × 食材 × 規格 × 仕入単位 の、いちばん新しい単価と前回の単価。変わった割合の大きい順に 80 行。そのまま Claude に貼ってください。
--   per_purchase … 仕入単位（ケースなど）1 つの単価。per_count … 1 個（数の単位）の単価。per_base … 1 g・1 ml・1 個（基本の単位）の単価
--   chg_pct ……… 基本の単位の単価（無ければ 1 個 → 仕入単位）で比べた変わった割合
--   line_check …… その明細の「数量 × 単価」と金額の差（$0.05 を超えると要確認）
with h as (
  select p.*, row_number() over (partition by store_id, vendor_key, ingredient_code, spec_key, purchase_unit order by effective_date desc, id desc) as rn
    from public.invoice_price_history p where p.status = 'active'
),
pair as (
  select a.store_id, a.vendor_key, a.ingredient_code, a.spec_key, a.purchase_unit,
         a.effective_date as d, a.invoice_no_norm as inv, a.price_per_purchase as pp, a.price_per_count as pc, a.count_unit as cu, a.price_per_base as pb, a.base_unit as bu, a.line_id,
         b.effective_date as prev_d, b.invoice_no_norm as prev_inv, b.price_per_purchase as prev_pp, b.price_per_count as prev_pc, b.price_per_base as prev_pb, b.base_unit as prev_bu,
         -- the change shown (chg_pct) and the order of the 80 rows use the same price: per base unit when both have the same base unit
         100 * (coalesce(case when a.base_unit = b.base_unit then a.price_per_base end, a.price_per_purchase)
                / nullif(coalesce(case when a.base_unit = b.base_unit then b.price_per_base end, b.price_per_purchase), 0) - 1) as chg
    from h a left join h b on b.store_id = a.store_id and b.vendor_key = a.vendor_key and b.ingredient_code = a.ingredient_code
                          and b.spec_key = a.spec_key and b.purchase_unit = a.purchase_unit and b.rn = 2
   where a.rn = 1
)
select pair.store_id, pair.vendor_key, pair.ingredient_code, coalesce(nullif(pair.spec_key, ''), '-') as spec, coalesce(nullif(pair.purchase_unit, ''), '-') as unit,
       pair.prev_d, pair.prev_inv, round(pair.prev_pp, 4) as prev_per_purchase, round(pair.prev_pb, 6) as prev_per_base,
       pair.d, pair.inv, round(pair.pp, 4) as per_purchase, round(pair.pc, 6) as per_count, pair.cu as count_unit, round(pair.pb, 6) as per_base, pair.bu as base_unit,
       round(pair.chg, 1) as chg_pct,
       l.qty, round(l.unit_price, 4) as unit_price, l.amount_cents,
       round(abs(coalesce(l.qty, 0) * coalesce(l.unit_price, 0) * 100 - coalesce(l.amount_cents, 0) - coalesce(l.line_discount_cents, 0)) / 100, 2) as line_check
  from pair left join public.invoice_lines l on l.id = pair.line_id
 order by abs(coalesce(pair.chg, 0)) desc nulls last
 limit 80;
