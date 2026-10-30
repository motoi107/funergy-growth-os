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

-- (CT is not taken as a piece: on food invoices it is often a carton. FL OZ and DZ are not measures here.)
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
 if u in ('ea','each','pc','pcs','piece','count','個','本') then return jsonb_build_object('v', round(p_ppp, 6), 'u', 'EA', 'by', 'unit'); end if;
 return null;
end $$;

-- What the app shows (read only). One group = store × vendor × product × spec × purchase unit; its last 6 confirmed prices (newest
-- first) and the comparison of the newest invoice with the one before it. Window functions only (one pass over the rows, no
-- per-group scans), so it stays quick as the history grows.
-- Confirmed lines with a product but no price record (catch weight, quantity / price unreadable, a quantity × price difference that
-- was accepted, a link not checked, ...) are not compared: a group made only of them is 「記録なし」(比較不可), and a group whose
-- newest purchase is such a line says so (nr / nrd), so an older price is never shown as the latest without a word.
create or replace function public.invoice_price_compare_data() returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 with conf as materialized (
  -- accounting-confirmed invoices (the purchase summary's rule, 2026-10-29)
  select d.id, d.store_id, d.vendor_key, d.effective_date, d.invoice_no, d.vendor_name, f.drive_file_id
  from public.invoice_docs d join public.invoice_files f on f.id=d.file_id
  where d.status='posted' and d.doc_type='invoice' and d.recon_status<>'discrepancy'
   and (d.recon_status='reconciled' or (d.posted_mode='manual'
        and not exists(select 1 from jsonb_array_elements(d.reasons) r where r->>'code'='app_duplicate_candidate')))
 ),
 allr as (
  -- p: a confirmed price record
  select 'p'::text kind, h.id, h.store_id, h.vendor_key, h.ingredient_code, h.spec_key, h.purchase_unit, h.effective_date, h.invoice_no_norm, h.doc_id,
   h.price_per_purchase ppp, c.invoice_no, c.drive_file_id, c.vendor_name, l.page, l.qty, l.amount_cents,
   public.invoice_price_cmp(h.price_per_purchase, h.price_per_count, h.count_unit, h.price_per_base, h.base_unit, h.purchase_unit) cmp,
   h.store_id || '|' || h.vendor_key || '|' || h.ingredient_code || '|' || h.spec_key || '|' || h.purchase_unit k
  from public.invoice_price_history h join conf c on c.id=h.doc_id join public.invoice_lines l on l.id=h.line_id
  where h.status='active'
  union all
  -- u: a confirmed line with a product and no price record (catch weight, quantity or price unreadable, an accepted
  --    quantity × price difference, a link to check, ...): never compared, but never hidden either
  select 'u', null::bigint, c.store_id, c.vendor_key, l.ingredient_code, coalesce(nullif(im.spec_key, ''), l.spec_key, ''),
   coalesce(nullif(im.purchase_unit, ''), l.purchase_unit, ''), c.effective_date, null, c.id, l.unit_price, c.invoice_no, c.drive_file_id, c.vendor_name,
   l.page, l.qty, l.amount_cents, null::jsonb,
   c.store_id || '|' || c.vendor_key || '|' || l.ingredient_code || '|' || coalesce(nullif(im.spec_key, ''), l.spec_key, '') || '|'
    || coalesce(nullif(im.purchase_unit, ''), l.purchase_unit, '')
  from conf c join public.invoice_lines l on l.doc_id=c.id
  left join public.invoice_item_maps im on im.id=l.map_id and im.verified and im.retired_at is null
  where coalesce(l.ingredient_code, '') <> '' and coalesce(l.amount_cents, 0) > 0 and c.effective_date is not null and c.vendor_key is not null
   and c.effective_date >= (now() at time zone 'Pacific/Honolulu')::date - 400
   and not exists(select 1 from public.invoice_price_history h where h.line_id=l.id and h.status='active')
 ),
 r as (
  select a.*,
   row_number() over w rn,
   first_value(a.doc_id) over w last_doc,
   max(a.effective_date) filter (where a.kind='p') over (partition by a.k) last_p,
   -- the same product and spec twice on one invoice at different prices: the link is checked first
   (min(a.ppp) over (partition by a.k, a.kind, a.doc_id) <> max(a.ppp) over (partition by a.k, a.kind, a.doc_id)) two
  from allr a
  window w as (partition by a.k, a.kind order by a.effective_date desc, lpad(coalesce(a.invoice_no_norm, ''), 40, '0') desc, a.id desc nulls last, a.invoice_no desc)
 ),
 r2 as (   -- prn = 1: the newest row of another invoice than the newest (the price before)
  select r.*, row_number() over (partition by r.k, r.kind, r.doc_id <> r.last_doc order by r.rn) prn from r
 ),
 g as (   -- one pass: every group's newest price, the price before, its last 6 prices and the lines without a record
  select r2.k, bool_or(r2.kind='p') has_p,
   max(r2.effective_date) filter (where r2.kind='p') last_d, max(r2.effective_date) filter (where r2.kind='u') u_d,
   min(r2.store_id) store_id, min(r2.vendor_key) vendor_key, min(r2.ingredient_code) ingredient_code, min(r2.spec_key) spec_key, min(r2.purchase_unit) purchase_unit,
   (array_agg(r2.vendor_name order by r2.kind, r2.rn))[1] vendor_name,
   (array_agg(r2.cmp) filter (where r2.kind='p' and r2.rn=1))[1] ac,
   coalesce(bool_or(r2.two) filter (where r2.kind='p' and r2.rn=1), false) a_two,
   (array_agg(r2.id) filter (where r2.kind='p' and r2.doc_id<>r2.last_doc and r2.prn=1))[1] b_id,
   (array_agg(r2.effective_date) filter (where r2.kind='p' and r2.doc_id<>r2.last_doc and r2.prn=1))[1] b_d,
   (array_agg(r2.cmp) filter (where r2.kind='p' and r2.doc_id<>r2.last_doc and r2.prn=1))[1] bc,
   coalesce(bool_or(r2.two) filter (where r2.kind='p' and r2.doc_id<>r2.last_doc and r2.prn=1), false) b_two,
   count(*) filter (where r2.kind='u' and r2.effective_date >= r2.last_p) nr_n,
   max(r2.effective_date) filter (where r2.kind='u' and r2.effective_date >= r2.last_p) nr_d,
   count(*) filter (where r2.kind='u') u_n,
   jsonb_agg(jsonb_build_object('d', r2.effective_date, 'inv', r2.invoice_no, 'id', r2.doc_id, 'f', r2.drive_file_id, 'pg', r2.page,
     'q', r2.qty, 'amt', r2.amount_cents, 'ppp', r2.ppp, 'v', (r2.cmp->>'v')::numeric, 'u', r2.cmp->>'u', 'two', r2.two) order by r2.rn)
     filter (where r2.kind='p' and r2.rn <= 6) obs,
   jsonb_agg(jsonb_build_object('d', r2.effective_date, 'inv', r2.invoice_no, 'id', r2.doc_id, 'f', r2.drive_file_id, 'pg', r2.page,
     'q', r2.qty, 'amt', r2.amount_cents, 'ppp', r2.ppp, 'nr', true) order by r2.rn)
     filter (where r2.kind='u' and r2.rn <= 6) uobs
  from r2 group by r2.k
 ),
 st as (
  select g.*,
   case
    when not g.has_p then 'not_recorded'
    when g.a_two or g.b_two then 'check_link'
    when g.ac is null then 'no_spec'
    when g.b_id is null then 'first'
    when g.bc is null then 'no_spec'
    when g.bc->>'u' is distinct from g.ac->>'u' then 'unit_changed'
    when abs((g.ac->>'v')::numeric / nullif((g.bc->>'v')::numeric, 0) - 1) > 0.5 then 'check_jump'
    when abs((g.ac->>'v')::numeric - (g.bc->>'v')::numeric) < 0.000001 then 'same'
    when (g.ac->>'v')::numeric > (g.bc->>'v')::numeric then 'up'
    else 'down' end status,
   coalesce(g.last_d, g.u_d) d
  from g
  -- the groups with a confirmed purchase in the last 13 months
  where coalesce(g.last_d, g.u_d) >= (now() at time zone 'Pacific/Honolulu')::date - 400
 )
 select jsonb_build_object('v', 1, 'rule', 'confirmed_unit_price',
  'stats', (select jsonb_build_object('groups', count(*),
    'up', count(*) filter (where status='up'), 'down', count(*) filter (where status='down'),
    'check_jump', count(*) filter (where status='check_jump'), 'check_link', count(*) filter (where status='check_link'),
    'no_spec', count(*) filter (where status in ('no_spec','unit_changed')), 'unit_changed', count(*) filter (where status='unit_changed'),
    'not_recorded', count(*) filter (where status='not_recorded'), 'not_recorded_lines', coalesce(sum(u_n), 0),
    -- prices of posted invoices accounting has not confirmed yet (not compared; they come in once confirmed)
    'waiting', (select count(*) from public.invoice_price_history h join public.invoice_docs d on d.id=h.doc_id
                 where h.status='active' and d.status='posted' and h.doc_id not in (select c.id from conf c))) from st),
  'groups', coalesce((select jsonb_agg(case when st.status='not_recorded' then
       jsonb_build_object('k', st.k, 's', st.store_id, 'vk', st.vendor_key, 'vn', st.vendor_name, 'c', st.ingredient_code,
        'sp', st.spec_key, 'pu', st.purchase_unit, 'st', st.status, 'd', st.d, 'nr', st.u_n, 'nrd', st.u_d, 'obs', st.uobs)
     else jsonb_build_object(
       'k', st.k, 's', st.store_id, 'vk', st.vendor_key, 'vn', st.vendor_name, 'c', st.ingredient_code,
       'sp', st.spec_key, 'pu', st.purchase_unit, 'st', st.status, 'd', st.d,
       'u', st.ac->>'u', 'by', st.ac->>'by', 'v', (st.ac->>'v')::numeric,
       'pd', st.b_d, 'pv', case when st.bc->>'u' = st.ac->>'u' then (st.bc->>'v')::numeric end,
       'dv', case when st.status in ('up','down','same','check_jump') then round((st.ac->>'v')::numeric - (st.bc->>'v')::numeric, 6) end,
       'pct', case when st.status in ('up','down','same','check_jump') then round(100 * ((st.ac->>'v')::numeric / nullif((st.bc->>'v')::numeric, 0) - 1), 1) end,
       'nr', nullif(st.nr_n, 0), 'nrd', st.nr_d, 'obs', st.obs) end
     order by st.d desc, st.k) from st), '[]'::jsonb));
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
