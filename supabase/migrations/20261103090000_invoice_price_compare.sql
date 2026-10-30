-- 仕入れの単価を比べる（10/30 の依頼 ②・Moto さん 10/30「単位あたりで比べる案で進める」）。
-- Run after 20261029100000_invoice_purchase_posted.sql. Running it twice is the same as once. Nothing is changed in the invoices,
-- their lines, the price history, the confirmation, the ledger or Drive: this only reads them and writes one row the app reads
-- (app_state 'invoice_purchase_prices', like the purchase summaries).
--  * Which invoices: the ones accounting confirmed (the purchase summary's rule, 2026-10-29): posted by a person (not a possible
--    duplicate of the app's own entry) or reconciled; a difference found in reconciling waits. Auto-posted ones wait for reconciling.
--  * What is compared: a line's own unit price (the price of one purchase unit, before tax, shipping and the invoice's discounts),
--    per one common unit: 1 LB (weight), 1 L (volume) or 1 piece / one count unit — from the spec of the mapping (pack size,
--    content) or from the purchase unit itself when it is a weight, volume or piece. The quantity bought never changes it
--    (2 cases or 4 cases of the same item at $60 a case is the same price).
--  * Only the same store, vendor, product, spec and purchase unit are compared (another spec is another row, never compared).
--  * Not comparable: no spec and the purchase unit is not a measure (比較不可). Two prices for the same product and spec on one
--    invoice: the link is checked first (結びの確認). A change of more than ±50 %: shown, marked 要確認.
do $$ begin
 if to_regprocedure('public.invoice_purchase_month(text,jsonb)') is null or to_regclass('public.invoice_price_history') is null
    or to_regclass('public.invoice_purchase_snapshots') is null then
  raise exception '先に 20261029100000_invoice_purchase_posted.sql を流してください（この SQL はそのあとに流します）';
 end if;
end $$;

-- One line's unit price per a common unit: {"v": price, "u": "LB" | "L" | "EA" | count unit, "by": "base" | "count" | "unit"}, or null.
create or replace function public.invoice_price_cmp(p_ppp numeric, p_pc numeric, p_cu text, p_pb numeric, p_bu text, p_pu text) returns jsonb
language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare u text := lower(btrim(normalize(coalesce(p_pu, ''), NFKC))); cu text := btrim(coalesce(p_cu, ''));
begin
 -- the mapping's spec gives a base unit (g, ml, ea): per 1 LB, 1 L or 1 piece
 if p_pb is not null and p_pb > 0 then
  if p_bu = 'g' then return jsonb_build_object('v', round(p_pb * 453.59237, 6), 'u', 'LB', 'by', 'base'); end if;
  if p_bu = 'ml' then return jsonb_build_object('v', round(p_pb * 1000, 6), 'u', 'L', 'by', 'base'); end if;
  if p_bu = 'ea' then return jsonb_build_object('v', round(p_pb, 6), 'u', 'EA', 'by', 'base'); end if;
 end if;
 -- the mapping says how many count units a purchase unit holds (12 bags a case): per one of them
 if p_pc is not null and p_pc > 0 and cu <> '' then
  return jsonb_build_object('v', round(p_pc, 6), 'u', upper(cu), 'by', 'count');
 end if;
 if p_ppp is null or p_ppp <= 0 then return null; end if;
 -- no spec: the purchase unit itself, when it is a measure
 u := rtrim(u, '.');
 if u in ('lb','lbs','#','pound','pounds') then return jsonb_build_object('v', round(p_ppp, 6), 'u', 'LB', 'by', 'unit'); end if;
 if u in ('kg','kgs','kilo') then return jsonb_build_object('v', round(p_ppp * 0.45359237, 6), 'u', 'LB', 'by', 'unit'); end if;
 if u in ('g','gr','gram','grams') then return jsonb_build_object('v', round(p_ppp * 453.59237, 6), 'u', 'LB', 'by', 'unit'); end if;
 if u in ('oz','ounce') then return jsonb_build_object('v', round(p_ppp * 16, 6), 'u', 'LB', 'by', 'unit'); end if;
 if u in ('l','lt','ltr','liter','litre') then return jsonb_build_object('v', round(p_ppp, 6), 'u', 'L', 'by', 'unit'); end if;
 if u in ('ml','cc') then return jsonb_build_object('v', round(p_ppp * 1000, 6), 'u', 'L', 'by', 'unit'); end if;
 if u in ('gal','gallon') then return jsonb_build_object('v', round(p_ppp / 3.785411784, 6), 'u', 'L', 'by', 'unit'); end if;
 if u in ('qt','quart') then return jsonb_build_object('v', round(p_ppp / 0.946352946, 6), 'u', 'L', 'by', 'unit'); end if;
 if u in ('ea','each','pc','pcs','piece','ct','count','個','本') then return jsonb_build_object('v', round(p_ppp, 6), 'u', 'EA', 'by', 'unit'); end if;
 return null;
end $$;

-- What the app shows (read only). One group = store × vendor × product × spec × purchase unit; its last 6 confirmed prices (newest
-- first) and the comparison of the newest invoice with the one before it.
create or replace function public.invoice_price_compare_data() returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 with conf as (
  -- accounting-confirmed invoices (the purchase summary's rule, 2026-10-29)
  select d.id, d.invoice_no, d.vendor_name, f.drive_file_id
  from public.invoice_docs d join public.invoice_files f on f.id=d.file_id
  where d.status='posted' and d.doc_type='invoice' and d.recon_status<>'discrepancy'
   and (d.recon_status='reconciled' or (d.posted_mode='manual'
        and not exists(select 1 from jsonb_array_elements(d.reasons) r where r->>'code'='app_duplicate_candidate')))
 ),
 o as (
  select h.id, h.store_id, h.vendor_key, h.ingredient_code, h.spec_key, h.purchase_unit, h.effective_date, h.invoice_no_norm, h.doc_id, h.line_id,
   h.price_per_purchase ppp, c.invoice_no, c.drive_file_id, c.vendor_name, l.page, l.qty, l.amount_cents,
   public.invoice_price_cmp(h.price_per_purchase, h.price_per_count, h.count_unit, h.price_per_base, h.base_unit, h.purchase_unit) cmp,
   h.store_id || '|' || h.vendor_key || '|' || h.ingredient_code || '|' || h.spec_key || '|' || h.purchase_unit k
  from public.invoice_price_history h join conf c on c.id=h.doc_id join public.invoice_lines l on l.id=h.line_id
  where h.status='active'
 ),
 r as (
  select o.*, row_number() over (partition by o.k order by o.effective_date desc, lpad(coalesce(o.invoice_no_norm, ''), 40, '0') desc, o.id desc) rn,
   -- the same product and spec twice on one invoice at different prices: the link is checked first
   (min(o.ppp) over (partition by o.k, o.doc_id) <> max(o.ppp) over (partition by o.k, o.doc_id)) two
  from o
 ),
 g as (
  select r.k, max(r.effective_date) last_d,
   (array_agg(r.doc_id order by r.rn))[1] last_doc
  from r group by r.k
  -- the groups with a confirmed price in the last 13 months
  having max(r.effective_date) >= (now() at time zone 'Pacific/Honolulu')::date - 400
 ),
 st0 as (   -- the newest invoice's price and the price on the invoice before it (another invoice)
  select g.k, g.last_d, a.store_id, a.vendor_key, a.vendor_name, a.ingredient_code, a.spec_key, a.purchase_unit, a.cmp ac, a.two a_two,
   b.id b_id, b.effective_date b_d, b.cmp bc, b.two b_two
  from g
  join lateral (select * from r x where x.k=g.k and x.rn=1) a on true
  left join lateral (select * from r x where x.k=g.k and x.doc_id<>g.last_doc order by x.rn limit 1) b on true
 ),
 st as (
  select st0.*,
   case
    when st0.a_two or coalesce(st0.b_two, false) then 'check_link'
    when st0.ac is null then 'no_spec'
    when st0.b_id is null then 'first'
    when st0.bc is null or st0.bc->>'u' is distinct from st0.ac->>'u' then 'no_spec'
    when abs((st0.ac->>'v')::numeric / nullif((st0.bc->>'v')::numeric, 0) - 1) > 0.5 then 'check_jump'
    when abs((st0.ac->>'v')::numeric - (st0.bc->>'v')::numeric) < 0.000001 then 'same'
    when (st0.ac->>'v')::numeric > (st0.bc->>'v')::numeric then 'up'
    else 'down' end status
  from st0
 )
 select jsonb_build_object('v', 1, 'rule', 'confirmed_unit_price',
  'stats', jsonb_build_object(
    'groups', (select count(*) from st),
    'up', (select count(*) from st where status='up'), 'down', (select count(*) from st where status='down'),
    'check_jump', (select count(*) from st where status='check_jump'), 'check_link', (select count(*) from st where status='check_link'),
    'no_spec', (select count(*) from st where status='no_spec'),
    -- prices of posted invoices accounting has not confirmed yet (not compared; they come in once confirmed)
    'waiting', (select count(*) from public.invoice_price_history h join public.invoice_docs d on d.id=h.doc_id
                 where h.status='active' and d.status='posted' and not exists(select 1 from conf c where c.id=h.doc_id))),
  'groups', coalesce((select jsonb_agg(jsonb_build_object(
     'k', st.k, 's', st.store_id, 'vk', st.vendor_key, 'vn', st.vendor_name, 'c', st.ingredient_code,
     'sp', st.spec_key, 'pu', st.purchase_unit, 'st', st.status, 'd', st.last_d,
     'u', st.ac->>'u', 'by', st.ac->>'by', 'v', (st.ac->>'v')::numeric,
     'pd', st.b_d, 'pv', case when st.bc->>'u' = st.ac->>'u' then (st.bc->>'v')::numeric end,
     'dv', case when st.status in ('up','down','same','check_jump') then round((st.ac->>'v')::numeric - (st.bc->>'v')::numeric, 6) end,
     'pct', case when st.status in ('up','down','same','check_jump') then round(100 * ((st.ac->>'v')::numeric / nullif((st.bc->>'v')::numeric, 0) - 1), 1) end,
     'obs', (select jsonb_agg(jsonb_build_object('d', x.effective_date, 'inv', x.invoice_no, 'id', x.doc_id, 'f', x.drive_file_id, 'pg', x.page,
         'q', x.qty, 'amt', x.amount_cents, 'ppp', x.ppp, 'v', (x.cmp->>'v')::numeric, 'u', x.cmp->>'u', 'two', x.two) order by x.rn)
       from r x where x.k=st.k and x.rn <= 6)
    ) order by st.last_d desc, st.k) from st), '[]'::jsonb));
$$;

-- Writes the rows the app reads when what they show changed (or p.force). Never touches anything else. One at a time.
--   invoice_purchase_prices         : every group with its last prices (the 仕入分析 tab reads it when opened)
--   invoice_purchase_prices_alerts  : only the changes of the last 30 days, without the prices list (small: the dashboards read it)
create or replace function public.invoice_price_compare_publish(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_j jsonb; v_a jsonb; v_h text; v_old text; v_now timestamptz := now();
begin
 perform pg_advisory_xact_lock(hashtext('invoice_price_compare_publish'));
 -- Stopped with the purchase summary (db/invoice-purchase-stop.sql): the app is told so and shows nothing from it.
 if coalesce((public.invoice_setting('purchase')->>'off')::boolean, false) then
  v_j := jsonb_build_object('v', 1, 'off', true); v_a := v_j;
 else
  v_j := public.invoice_price_compare_data();
  v_a := jsonb_build_object('v', 1, 'stats', v_j->'stats', 'groups', coalesce((select jsonb_agg(g - 'obs' order by g->>'d' desc, g->>'k')
    from jsonb_array_elements(v_j->'groups') g
    where g->>'st' in ('up','down','check_jump') and (g->>'d')::date >= (v_now at time zone 'Pacific/Honolulu')::date - 30), '[]'::jsonb));
 end if;
 v_h := md5(v_j::text);
 select a.value->>'hash' into v_old from public.app_state a where a.key='invoice_purchase_prices';
 if v_old is not distinct from v_h and not coalesce((p->>'force')::boolean, false)
    and exists(select 1 from public.app_state a where a.key='invoice_purchase_prices_alerts') then
  return jsonb_build_object('ok', true, 'changed', false);
 end if;
 insert into public.app_state(key, value, updated_at) values('invoice_purchase_prices', v_j || jsonb_build_object('hash', v_h, 'generated_at', v_now), v_now)
 on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at;
 insert into public.app_state(key, value, updated_at) values('invoice_purchase_prices_alerts', v_a || jsonb_build_object('hash', v_h, 'generated_at', v_now), v_now)
 on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at;
 return jsonb_build_object('ok', true, 'changed', true);
end $$;

revoke all on function public.invoice_price_cmp(numeric, numeric, text, numeric, text, text) from public, anon, authenticated;
revoke all on function public.invoice_price_compare_data() from public, anon, authenticated;
revoke all on function public.invoice_price_compare_publish(jsonb) from public, anon, authenticated;
grant execute on function public.invoice_price_cmp(numeric, numeric, text, numeric, text, text) to service_role;
grant execute on function public.invoice_price_compare_data() to service_role;
grant execute on function public.invoice_price_compare_publish(jsonb) to service_role;
