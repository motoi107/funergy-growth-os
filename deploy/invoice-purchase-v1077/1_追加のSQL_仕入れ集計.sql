-- 確認済み invoice の全店仕入れ集計（Moto 2026-10-14・UI案48）。
-- 確認済み仕入れ＝反映済み・経理の照合済み（recon_status='reconciled'）・QuickBooks へ原本を送った記録がある。
-- QuickBooks の台帳（qb.since）より前に Drive に入った原本は台帳に送った記録が無い（前の経路で送られた）ので、照合済みだけで入れる（Moto 10/14）。
-- 予実管理の原価率は 2026 年 10 月から、この確認済みの数字で出す（アプリ v1077。Moto 10/14「① B」「10 月から」）。
--
-- What this adds (service_role only, like every other invoice_ object):
--   invoice_purchase_checks     : per store, vendor and month, "the vendor's statement was compared: everything is here" (or
--                                 what is missing). Insert-only; the latest row is the current state.
--   invoice_purchase_published  : which month was published with which content (hash, and the content itself, to write rows
--                                 changed from outside again), whether it was written as closed, and when it was last checked.
--   invoice_purchase_classes    : the class (food / liquor / beverage / supply) of product master codes, the way the app reads it.
--   invoice_purchase_month      : one month's summary per store, vendor and invoice, and each invoice's lines with their share
--                                 of tax, shipping and discounts (prorated by line amount, in whole cents, nothing lost).
--   invoice_purchase_publish    : writes the summaries to app_state (invoice_purchase_<YYYY-MM>, invoice_purchase_lines_<YYYY-MM>_<store>,
--                                 invoice_purchase_status) for the app to read without signing in (Moto 10/14: anyone using the
--                                 app may see it). A closed month (rules.closed_through) is written again only when its
--                                 invoices change (for example reconciled or sent after closing), not when a master changes.
--   invoice_purchase_check      : records the statement check (accounting, 事務Crew, GM, CEO).
-- Nothing here changes an invoice, a line, the QuickBooks ledger, the app's invoice copies or a Drive file.
-- To stop it (the app goes back to its own count): db/invoice-purchase-stop.sql. Running this file twice changes nothing.

do $$ begin
 if to_regprocedure('public.invoice_qb_since_at()') is null then
  raise exception '先に 20261012120000_invoice_rename_after_post.sql を流してください（この SQL はそのあとに流します）';
 end if;
end $$;

create table if not exists public.invoice_purchase_checks(
 id bigint generated always as identity primary key,
 store_id text not null references public.invoice_stores(store_id),
 vendor_key text not null,
 ym text not null check (ym ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 state text not null check (state in ('complete','missing','none')),
 note text,
 statement_cents bigint,
 checked_by text not null,
 checked_at timestamptz not null default now()
);
create index if not exists invoice_purchase_checks_key on public.invoice_purchase_checks(store_id, ym, vendor_key, id desc);

create table if not exists public.invoice_purchase_published(
 ym text primary key check (ym ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 hash text not null,
 published_at timestamptz not null,
 checked_at timestamptz not null,
 closed boolean not null default false,   -- written as a closed month
 summary jsonb,                           -- what was written: rows changed or removed from outside are written again from this
 lines jsonb,
 inputs text                              -- what the month's invoices were (versions, states, ledger, copies) when it was written
);

do $$ declare t text; begin
 foreach t in array array['invoice_purchase_checks','invoice_purchase_published'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from public, anon, authenticated', t);
  execute format('grant select, insert, update on public.%I to service_role', t);
 end loop;
end $$;

-- The class of product master codes (public.ingredients, the app's m_ingredients): the item's own class when it has one,
-- otherwise its category's class (public.categories; the app's default categories when that table is empty or missing).
-- Codes not in the master are left out (their lines are classed by the vendor, provisionally).
create or replace function public.invoice_purchase_classes(p_codes text[]) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_cats jsonb := '{}'; v_out jsonb := '{}';
begin
 if p_codes is null or cardinality(p_codes) = 0 or to_regclass('public.ingredients') is null then return v_out; end if;
 if to_regclass('public.categories') is not null then
  begin
   execute $q$ select coalesce(jsonb_object_agg(x->>'code', lower(coalesce(nullif(x->>'cls',''), x->'data'->>'cls', ''))), '{}'::jsonb)
    from (select to_jsonb(c) x from public.categories c) q where coalesce(x->>'code','') <> '' $q$ into v_cats;
  exception when others then v_cats := '{}';
  end;
 end if;
 execute $q$
  select coalesce(jsonb_object_agg(z.code, z.cls), '{}'::jsonb) from (
   select q.code,
    case when q.own in ('food','liquor','beverage','supply') then q.own
     when $3 then case when lower($2->>q.cat) in ('food','liquor','beverage','supply') then lower($2->>q.cat) else 'food' end
     when q.cat in ('20000','21000','22000','23000','24000') then 'liquor'
     when q.cat in ('30000','31000') then 'beverage'
     when q.cat = '40000' then 'supply'
     else 'food' end cls
   from (select x->>'code' code, lower(coalesce(x->'data'->>'cls', x->>'cls', '')) own,
          case coalesce(nullif(x->'data'->>'cat',''), nullif(x->>'cat',''))
           when '6100' then '6000' when '6200' then '6000' when '6300' then '6000' when '14000' then '11000'
           else coalesce(nullif(x->'data'->>'cat',''), nullif(x->>'cat','')) end cat
         from (select to_jsonb(i) x from public.ingredients i) r where x->>'code' = any($1)) q) z $q$
  using p_codes, v_cats, v_cats <> '{}'::jsonb into v_out;
 return coalesce(v_out, '{}');
end $$;

-- One month (the invoice date's month, Hawaii) of purchase documents, put in one place each:
--   A 確認済み：posted, reconciled, and the original's content sent to QuickBooks (or it came in before the ledger started)
--   B 確認済み・未転送：the same, not sent yet (pending / sending / error / unknown / not queued yet)
--   C 確認待ち：not posted yet (review), or posted and not reconciled (unreconciled / discrepancy)
--   D 除外：rejected / duplicate / superseded (kept for the history)
--   E 集計保留：taken in before the start (the app's own entry counts it), its app copy deleted in the app, several stores on one
--     page (no allocation), not USD, a closed-month adjustment, an amount with no class (vendor class not set)
-- Amounts are whole cents; a credit memo counts negative. Lines take tax, shipping, discounts and other charges in proportion
-- to their amounts (largest remainder, so the shares add up to the total exactly).
create or replace function public.invoice_purchase_month(p_ym text, p_cls jsonb default null) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_start timestamptz; v_since timestamptz := public.invoice_qb_since_at();
 v_closed text := public.invoice_setting('rules')->>'closed_through'; v_cls jsonb := p_cls; v_names jsonb := '{}'; v_res jsonb;
 -- The ledger is kept per content and destination: a send to the QuickBooks address in use counts (as the ledger itself checks).
 v_to text := public.invoice_setting('qb')->>'to';
 v_mirror boolean := coalesce((public.invoice_setting('mode')->>'mirror')::boolean, false);
begin
 if p_ym is null or p_ym !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'bad_value'; end if;
 begin v_start := (public.invoice_setting('mode')->>'start_at')::timestamptz; exception when others then v_start := null; end;
 if v_cls is null then
  select public.invoice_purchase_classes(coalesce(array_agg(distinct l.ingredient_code), '{}')) into v_cls
  from public.invoice_lines l join public.invoice_docs d on d.id=l.doc_id join public.invoice_files f on f.id=d.file_id
  where l.ingredient_code is not null
   and to_char(coalesce(d.invoice_date, d.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM') = p_ym;
 end if;
 -- Who reconciled or checked: the employee's name when the account is linked to one (manager_auth.emp_id).
 if to_regclass('public.employees') is not null then
  begin
   execute $q$ select coalesce(jsonb_object_agg(a.user_id::text, e.name), '{}'::jsonb) from public.manager_auth a
    join public.employees e on e.id::text = a.emp_id where coalesce(e.name, '') <> '' $q$ into v_names;
  exception when others then v_names := '{}';
  end;
 end if;
 with
 d0 as (
  select d.id, d.internal_no, d.store_id, d.doc_type, d.status, d.vendor_key, coalesce(v.display_name, d.vendor_name, d.vendor_raw) vname,
   d.invoice_no, d.invoice_date, d.delivery_date, d.currency, d.total_cents, d.subtotal_cents, d.discount_cents, d.tax_cents, d.shipping_cents,
   d.other_cents, d.food_kind, d.reasons, d.recon_status, d.recon_by, d.recon_at, d.posted_mode, d.posted_at, d.needs_adjustment,
   d.related_doc_id, d.relation, d.duplicate_of, (select x.invoice_no from public.invoice_docs x where x.id=d.related_doc_id) rno,
   f.drive_file_id, f.current_name, f.source fsource, f.drive_created_at, f.ingested_at, m.state mstate,
   -- 'held' (a closed month or an adjustment met when copying): the copy may or may not be in the app. Look at the app's list.
   case when m.state='held' then exists(select 1 from public.app_state a
     cross join lateral jsonb_array_elements(case when jsonb_typeof(a.value::jsonb)='array' then a.value::jsonb else '[]'::jsonb end) e
     where a.key='spl_invoices_' || m.store_id and e->>'id' = m.app_inv_id and coalesce(e->>'_deleted', '') <> 'true') end hcopy,
   (d.invoice_date is null and d.effective_date is null) nodate,
   -- The QuickBooks ledger is kept per original content and address: a send of the same content to the address in use counts,
   -- whatever the file is called now.
   (select o.state from public.invoice_qb_outbox o where o.sha256=d.sha256 and o.to_address=v_to and o.state<>'cancelled'
     order by (o.state='sent') desc, o.updated_at desc, o.id limit 1) qbs,
   (select max(o.sent_at) from public.invoice_qb_outbox o where o.sha256=d.sha256 and o.to_address=v_to and o.state='sent') qbat
  from public.invoice_docs d
  join public.invoice_files f on f.id=d.file_id
  left join public.invoice_app_mirror m on m.doc_id=d.id
  left join public.invoice_vendor_rules v on v.vendor_key=d.vendor_key
  where (d.posting_kind='purchase' or (d.status='review' and d.doc_type='unknown'))
   and to_char(coalesce(d.invoice_date, d.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM') = p_ym
 ),
 d1 as (
  select d0.*, (d0.doc_type='credit_memo') credit, case when d0.total_cents < 0 then -1 else 1 end f,
   -- Counted here when the app's cost would have it through the copy (invoice_mirror_apply): copied, or due to be copied.
   -- Taken in before the start or while the copies are off (not copied: the store entered it in the app), or its copy deleted
   -- in the app: the app's own entry counts it, so it is held here (never counted twice).
   case when d0.mstate='mirrored' then true when d0.mstate='tombstoned' then false when d0.mstate='error' then true
    when d0.mstate='held' then coalesce(d0.hcopy, false)
    else v_mirror and coalesce(d0.ingested_at >= v_start, false) end link,
   -- Counted through the store's own app entry instead (not in "not in yet"). A held original with no copy is not: whether the
   -- store entered it is not known (copies may have been off, or the month closed before it was copied), so it stays to check.
   (d0.mstate is distinct from 'held') appentry,
   -- Not a ledger target (put in Drive before qb.since, or not a Drive original): no ledger row is expected.
   (v_since is not null and not (d0.fsource='drive' and coalesce(d0.drive_created_at >= v_since, false))) preledger,
   exists(select 1 from jsonb_array_elements(d0.reasons) r where r->>'code'='multi_store') multi,
   exists(select 1 from jsonb_array_elements(d0.reasons) r where r->>'code'='app_duplicate_candidate') appdup
  from d0
 ),
 l0 as (
  select l.doc_id, l.line_no, l.raw_name, l.qty, l.purchase_unit, l.amount_cents, l.ingredient_code, d1.food_kind,
   d1.f * coalesce(l.amount_cents, 0) a,
   case when l.ingredient_code is not null and (v_cls->>l.ingredient_code) in ('food','liquor','beverage','supply') then v_cls->>l.ingredient_code end mcls
  from public.invoice_lines l join d1 on d1.id=l.doc_id
 ),
 w as (
  select d1.id doc_id, case when d1.total_cents is null then null else abs(d1.total_cents) end tp,
   coalesce(sum(greatest(l0.a, 0)), 0) wpos, coalesce(sum(abs(l0.a)), 0) wabs, coalesce(sum(l0.a), 0) asum
  from d1 left join l0 on l0.doc_id=d1.id group by d1.id, d1.total_cents
 ),
 l1 as (
  select l0.*, w.tp, (w.tp - w.asum) rem, case when w.wpos > 0 then w.wpos else w.wabs end wsum,
   case when w.wpos > 0 then greatest(l0.a, 0) else abs(l0.a) end wt
  from l0 join w on w.doc_id=l0.doc_id
 ),
 l2 as (
  select l1.*, case when l1.tp is null or l1.wsum = 0 then 0::numeric
   else div(l1.rem::numeric * l1.wt, l1.wsum) - case when mod(l1.rem::numeric * l1.wt, l1.wsum) < 0 then 1 else 0 end end fl
  from l1
 ),
 l3 as (
  select l2.*, case when l2.tp is null or l2.wsum = 0 then 0::numeric else l2.rem::numeric * l2.wt - l2.fl * l2.wsum end frn,
   sum(l2.fl) over (partition by l2.doc_id) flsum
  from l2
 ),
 l4 as (select l3.*, row_number() over (partition by l3.doc_id order by l3.frn desc, l3.line_no) rn from l3),
 ls as (
  select l4.doc_id, l4.line_no, l4.raw_name, l4.qty, l4.purchase_unit, l4.amount_cents, l4.ingredient_code,
   case when l4.tp is null then null
    else (l4.a + l4.fl + case when l4.wsum > 0 and l4.rn <= l4.rem - l4.flsum then 1 else 0 end)::bigint end share,
   coalesce(l4.mcls, case l4.food_kind when 'food' then 'food' when 'nonfood' then 'nonfood' end, 'unclass') c,
   case when l4.mcls is not null then 'm' when l4.food_kind in ('food','nonfood') then 'v' else 'u' end b
  from l4
 ),
 da as (
  select d1.id, coalesce(sum(ls.share), 0) alloc,
   coalesce(sum(ls.share) filter (where ls.c='food'), 0) s_food, coalesce(sum(ls.share) filter (where ls.c='liquor'), 0) s_liquor,
   coalesce(sum(ls.share) filter (where ls.c='beverage'), 0) s_beverage, coalesce(sum(ls.share) filter (where ls.c='supply'), 0) s_supply,
   coalesce(sum(ls.share) filter (where ls.c='nonfood'), 0) s_nonfood, coalesce(sum(ls.share) filter (where ls.c='unclass'), 0) s_unclass,
   coalesce(sum(ls.share) filter (where ls.b='v' and ls.c='food'), 0) s_vfood, coalesce(sum(ls.share) filter (where ls.b='v' and ls.c='nonfood'), 0) s_vnon
  from d1 left join ls on ls.doc_id=d1.id group by d1.id
 ),
 dd0 as (
  select d1.*, w.tp, case when d1.credit then -1 else d1.f end mul,
   -- What no line carries (no lines, or only zero lines) goes by the vendor's class.
   case when w.tp is null then 0 else w.tp - da.alloc end ua,
   da.s_food, da.s_liquor, da.s_beverage, da.s_supply, da.s_nonfood, da.s_unclass, da.s_vfood, da.s_vnon
  from d1 join w on w.doc_id=d1.id join da on da.id=d1.id
 ),
 dd1 as (
  select dd0.*,
   s_food + case when food_kind='food' then ua else 0 end food_m, s_liquor liquor_m, s_beverage beverage_m, s_supply supply_m,
   s_nonfood + case when food_kind='nonfood' then ua else 0 end nonfood_m,
   s_unclass + case when coalesce(food_kind,'') not in ('food','nonfood') then ua else 0 end unclass_m,
   s_vfood + case when food_kind='food' then ua else 0 end vfood_m, s_vnon + case when food_kind='nonfood' then ua else 0 end vnon_m
  from dd0
 ),
 dd2 as (
  select dd1.*,
   case
    when status in ('rejected','duplicate','superseded') then 'D'
    when not link then 'E'
    when status='review' then 'C'
    when multi or coalesce(currency,'USD')<>'USD' or needs_adjustment or unclass_m<>0 or tp is null then 'E'
    when recon_status<>'reconciled' then 'C'
    when qbs='sent' or preledger then 'A'
    else 'B' end cat
  from dd1
 ),
 dd as (
  select dd2.*, case when tp is null then null else mul * tp end cents,
   mul * (food_m + liquor_m + beverage_m) cost, mul * (supply_m + nonfood_m) non, mul * unclass_m unc,
   mul * vfood_m pc, mul * vnon_m pn,
   case cat
    when 'D' then array[status]
    when 'E' then case when not link then array[case when mstate='tombstoned' then 'deleted_in_app' when mstate='held' then 'held_no_copy'
      when not v_mirror then 'no_copy' else 'before_start' end]
     else array_remove(array[case when multi then 'multi_store' end, case when coalesce(currency,'USD')<>'USD' then 'currency' end,
      case when needs_adjustment then 'closed_adjustment' end, case when unclass_m<>0 then 'no_class' end, case when tp is null then 'no_amount' end], null) end
    when 'C' then case when status='review' then array_remove(array['review', case when doc_type='unknown' then 'unreadable' end,
      case when nodate then 'no_date' end, case when tp is null then 'no_amount' end], null) else array[recon_status] end
    when 'B' then array['qb_' || coalesce(qbs, 'none')]
    else case when qbs is distinct from 'sent' then array['pre_ledger'] else array[]::text[] end end why
  from dd2
 ),
 sto as (
  select s.store_id from public.invoice_stores s where s.active
  union select dd.store_id from dd
  union select c.store_id from public.invoice_purchase_checks c where c.ym=p_ym
 ),
 ck as (
  select distinct on (c.store_id, c.vendor_key) c.* from public.invoice_purchase_checks c where c.ym=p_ym
  order by c.store_id, c.vendor_key, c.id desc
 ),
 vd as (
  select dd.store_id, coalesce(dd.vendor_key, '?' || lower(coalesce(dd.vname, ''))) gk, max(dd.vendor_key) vk, max(dd.vname) vn,
   count(*) filter (where cat='A') a_n, coalesce(sum(cents) filter (where cat='A'), 0) a_c, coalesce(sum(cost) filter (where cat='A'), 0) a_cost,
   coalesce(sum(non) filter (where cat='A'), 0) a_non, coalesce(sum(pc + pn) filter (where cat='A'), 0) a_prov,
   coalesce(sum(mul * food_m) filter (where cat='A'), 0) a_food, coalesce(sum(mul * liquor_m) filter (where cat='A'), 0) a_liquor,
   coalesce(sum(mul * beverage_m) filter (where cat='A'), 0) a_beverage, coalesce(sum(mul * supply_m) filter (where cat='A'), 0) a_supply,
   coalesce(sum(mul * nonfood_m) filter (where cat='A'), 0) a_nonfood,
   count(*) filter (where cat='A' and credit) cr_n, coalesce(sum(cents) filter (where cat='A' and credit), 0) cr_c,
   -- not in yet: B, C and E, except what the app's own entry counts (E without a copy)
   count(*) filter (where cat in ('B','C') or (cat='E' and not (not link and appentry))) p_n,
   coalesce(sum(cents) filter (where (cat in ('B','C') or (cat='E' and not (not link and appentry))) and cents is not null), 0) p_c,
   count(*) filter (where (cat in ('B','C') or (cat='E' and not (not link and appentry))) and cents is null) p_u, count(*) filter (where cat='D') d_n
  from dd group by 1, 2
 ),
 vj as (
  select vd.store_id, vd.a_c ord, vd.vn, jsonb_build_object('k', vd.vk, 'n', vd.vn,
    'a', jsonb_build_object('n', a_n, 'c', a_c, 'cost', a_cost, 'non', a_non, 'prov', a_prov,
     'cls', jsonb_build_object('food', a_food, 'liquor', a_liquor, 'beverage', a_beverage, 'supply', a_supply, 'nonfood', a_nonfood)),
    'cr', jsonb_build_object('n', cr_n, 'c', cr_c), 'p', jsonb_build_object('n', p_n, 'c', p_c, 'u', p_u), 'dn', d_n,
    'chk', (select jsonb_build_object('s', ck.state, 'at', ck.checked_at, 'by', v_names->>ck.checked_by, 'note', ck.note, 'sc', ck.statement_cents,
       'after', (select count(*) from dd x where x.store_id=vd.store_id and x.vendor_key=vd.vk and x.cat<>'D' and x.ingested_at > ck.checked_at))
      from ck where ck.store_id=vd.store_id and ck.vendor_key=vd.vk and ck.state<>'none')) j
  from vd
  union all
  select ck.store_id, 0, coalesce(v.display_name, ck.vendor_key), jsonb_build_object('k', ck.vendor_key, 'n', coalesce(v.display_name, ck.vendor_key),
    'chk', jsonb_build_object('s', ck.state, 'at', ck.checked_at, 'by', v_names->>ck.checked_by, 'note', ck.note, 'sc', ck.statement_cents, 'after', 0))
  from ck left join public.invoice_vendor_rules v on v.vendor_key=ck.vendor_key
  where ck.state<>'none' and not exists(select 1 from vd where vd.store_id=ck.store_id and vd.vk=ck.vendor_key)
 ),
 dj as (
  select dd.store_id, dd.id, dd.invoice_date, jsonb_build_object('id', dd.id, 'in', internal_no, 'no', invoice_no, 'vk', vendor_key, 'vn', vname,
    't', case when credit then 'c' when doc_type='unknown' then 'u' else 'i' end, 'd', invoice_date, 'dl', delivery_date,
    'cat', cat, 'why', to_jsonb(why), 'c', cents, 'cost', cost, 'non', non, 'unc', unc, 'pc', pc, 'pn', pn,
    'cls', jsonb_build_object('food', mul * food_m, 'liquor', mul * liquor_m, 'beverage', mul * beverage_m, 'supply', mul * supply_m, 'nonfood', mul * nonfood_m),
    'st', status, 'rc', recon_status, 'rat', recon_at, 'rby', v_names->>recon_by, 'qb', qbs, 'qat', qbat, 'pm', posted_mode, 'pat', posted_at,
    'rel', relation, 'rid', related_doc_id, 'rno', rno, 'dup', duplicate_of, 'ad', appdup, 'fn', current_name, 'fid', drive_file_id, 'iat', ingested_at) j
  from dd
 ),
 tj as (
  select g.store_id, g.cat, jsonb_build_object('n', count(*), 'c', coalesce(sum(g.cents) filter (where g.cents is not null), 0),
    'u', count(*) filter (where g.cents is null), 'cost', coalesce(sum(g.cost), 0), 'non', coalesce(sum(g.non), 0), 'unc', coalesce(sum(g.unc), 0),
    'pc', coalesce(sum(g.pc), 0), 'pn', coalesce(sum(g.pn), 0),
    'by', (select coalesce(jsonb_object_agg(z.k, jsonb_build_object('n', z.n, 'c', z.c, 'u', z.u)), '{}'::jsonb) from (
      select coalesce(y.why[1], '-') k, count(*) n, coalesce(sum(y.cents) filter (where y.cents is not null), 0) c, count(*) filter (where y.cents is null) u
      from dd y where y.store_id=g.store_id and y.cat=g.cat group by 1) z)) j
  from dd g group by g.store_id, g.cat
 ),
 lg as (
  select ls.doc_id, jsonb_agg(jsonb_build_array(ls.line_no, ls.raw_name, trim_scale(ls.qty), ls.purchase_unit, ls.amount_cents,
    case when ls.share is null then null else dd.mul * ls.share end, ls.c, ls.b, ls.ingredient_code) order by ls.line_no) l
  from ls join dd on dd.id=ls.doc_id group by ls.doc_id
 ),
 lj as (
  select dd.store_id, dd.id, jsonb_build_object(
    'h', jsonb_build_object('sub', subtotal_cents, 'disc', discount_cents, 'tax', tax_cents, 'ship', shipping_cents, 'oth', other_cents, 'tot', total_cents),
    'u', case when tp is null or ua = 0 then null else mul * ua end,
    'uc', case when food_kind in ('food','nonfood') then food_kind else 'unclass' end,
    'l', coalesce(lg.l, '[]'::jsonb)) j
  from dd left join lg on lg.doc_id=dd.id
 )
 select jsonb_build_object(
  'summary', jsonb_build_object('v', 1, 'ym', p_ym, 'closed', v_closed is not null and p_ym <= v_closed,
   'start_at', v_start, 'qb_since', v_since,
   'stores', coalesce((select jsonb_object_agg(s.store_id, jsonb_build_object(
     'tot', coalesce((select jsonb_object_agg(tj.cat, tj.j) from tj where tj.store_id=s.store_id), '{}'::jsonb),
     'cls', (select jsonb_build_object('food', coalesce(sum(mul * food_m), 0), 'liquor', coalesce(sum(mul * liquor_m), 0), 'beverage', coalesce(sum(mul * beverage_m), 0),
        'supply', coalesce(sum(mul * supply_m), 0), 'nonfood', coalesce(sum(mul * nonfood_m), 0)) from dd where dd.store_id=s.store_id and dd.cat='A'),
     'cr', (select jsonb_build_object('n', count(*), 'c', coalesce(sum(cents), 0)) from dd where dd.store_id=s.store_id and dd.cat='A' and dd.credit),
     'pre', (select jsonb_build_object('n', count(*), 'c', coalesce(sum(cents), 0)) from dd where dd.store_id=s.store_id and dd.cat='A' and 'pre_ledger' = any(dd.why)),
     'ad', (select jsonb_build_object('n', count(*), 'c', coalesce(sum(cents) filter (where cents is not null), 0)) from dd where dd.store_id=s.store_id and dd.cat in ('A','B','C') and dd.appdup),
     -- held because the app's own entry counts them (taken in before the start, no copy, copy deleted): not "not in yet"
     'ap', (select jsonb_build_object('n', count(*), 'c', coalesce(sum(cents) filter (where cents is not null), 0), 'u', count(*) filter (where cents is null))
        from dd where dd.store_id=s.store_id and dd.cat='E' and not dd.link and dd.appentry),
     'last', (select jsonb_build_object('a', max(invoice_date) filter (where cat='A'), 'in', max(ingested_at)) from dd where dd.store_id=s.store_id),
     'vendors', coalesce((select jsonb_agg(vj.j order by vj.ord desc, vj.vn) from vj where vj.store_id=s.store_id), '[]'::jsonb),
     'docs', coalesce((select jsonb_agg(dj.j order by dj.invoice_date desc nulls first, dj.id) from dj where dj.store_id=s.store_id), '[]'::jsonb)))
    from sto s), '{}'::jsonb)),
  'lines', coalesce((select jsonb_object_agg(q.store_id, q.j) from (
    select lj.store_id, jsonb_object_agg(lj.id::text, lj.j) j from lj group by lj.store_id) q), '{}'::jsonb))
 into v_res;
 return v_res;
end $$;

-- Writes the months whose content changed: every month that has purchase documents, a statement check or an earlier summary
-- (the worker, on every run), or only the months of the invoices, file or ledger row a person's action touched (p.doc_ids,
-- p.file_id, p.outbox_id, p.months). A closed month (rules.closed_through) is written once more when it is closed; after that
-- only when its invoices change (reconciled or sent to QuickBooks after closing, corrected, marked), not for a change of the
-- masters or settings alone (p.force writes it again anyway). Rows changed or removed from outside (app_state can be written
-- from a browser) are written again from what was written here.
create or replace function public.invoice_purchase_publish(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_closed text := public.invoice_setting('rules')->>'closed_through'; v_months text[]; v_ym text; v_j jsonb; v_h text;
 v_pub public.invoice_purchase_published; v_changed text[] := '{}'; v_frozen text[] := '{}'; v_repaired text[] := '{}';
 v_now timestamptz := now(); v_sid text; v_cls jsonb; v_closedm boolean; v_sum jsonb; v_lines jsonb; v_at timestamptz; v_exp jsonb; v_in text;
 v_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; v_ids text[] := '{}';
begin
 -- One at a time: a later run starts after an earlier one ends and sees what was saved meanwhile.
 perform pg_advisory_xact_lock(hashtext('invoice_purchase_publish'));
 -- Stopped (db/invoice-purchase-stop.sql): the app is told so and goes back to its own count everywhere.
 if coalesce((public.invoice_setting('purchase')->>'off')::boolean, false) then
  insert into public.app_state(key, value, updated_at) values('invoice_purchase_status', jsonb_build_object('v', 1, 'off', true, 'checked_at', v_now), v_now)
  on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at;
  return jsonb_build_object('ok', true, 'off', true, 'changed', '[]'::jsonb, 'frozen', '[]'::jsonb, 'repaired', '[]'::jsonb);
 end if;
 if p ? 'months' or p ? 'doc_ids' or p ? 'file_id' or p ? 'outbox_id' then
  -- the invoices the action touched: their month now, and every month an earlier summary showed them in (a changed date moves one)
  v_ids := array(select d.id::text from public.invoice_docs d
    where d.id::text in (select x from jsonb_array_elements_text(case when jsonb_typeof(p->'doc_ids') = 'array' then p->'doc_ids' else '[]'::jsonb end) x where x ~ v_uuid)
     or d.file_id = case when p->>'file_id' ~ v_uuid then (p->>'file_id')::uuid end
     or d.sha256 in (select o.sha256 from public.invoice_qb_outbox o where o.id = case when p->>'outbox_id' ~ v_uuid then (p->>'outbox_id')::uuid end));
  v_months := array(select distinct q.m from (
    select x m from jsonb_array_elements_text(case when jsonb_typeof(p->'months') = 'array' then p->'months' else '[]'::jsonb end) x
    union
    select to_char(coalesce(d.invoice_date, d.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM')
    from public.invoice_docs d join public.invoice_files f on f.id=d.file_id
    where d.id::text = any(v_ids) and (d.posting_kind='purchase' or (d.status='review' and d.doc_type='unknown'))
    union
    select x.ym from public.invoice_purchase_published x
    where cardinality(v_ids) > 0 and exists (select 1 from jsonb_each(coalesce(x.summary->'stores', '{}'::jsonb)) st,
      jsonb_array_elements(case when jsonb_typeof(st.value->'docs') = 'array' then st.value->'docs' else '[]'::jsonb end) e where e->>'id' = any(v_ids))
   ) q where q.m ~ '^\d{4}-(0[1-9]|1[0-2])$' order by 1);
 else
  v_months := array(select distinct q.m from (
    select to_char(coalesce(d.invoice_date, d.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM') m
    from public.invoice_docs d join public.invoice_files f on f.id=d.file_id
    where d.posting_kind='purchase' or (d.status='review' and d.doc_type='unknown')
    union select c.ym from public.invoice_purchase_checks c
    union select x.ym from public.invoice_purchase_published x) q where q.m is not null order by 1);
 end if;
 -- The classes of every product any line maps to, once for all months.
 select public.invoice_purchase_classes(coalesce(array_agg(distinct l.ingredient_code), '{}')) into v_cls from public.invoice_lines l where l.ingredient_code is not null;
 foreach v_ym in array v_months loop
  select * into v_pub from public.invoice_purchase_published x where x.ym=v_ym;
  v_closedm := v_closed is not null and v_ym <= v_closed;
  -- What the month's invoices are now: every version (a reconcile, a correction, a mark), state, store, QuickBooks ledger row and
  -- app copy. A closed month is written again when this changed (an invoice reconciled or sent after closing reaches its cost),
  -- but not for a change of the masters or settings alone (classes, vendor names): those leave a closed month as it was.
  select md5(coalesce(string_agg(q.x, '|' order by q.x), '')) into v_in from (
   select d.id::text || ':' || d.version || ':' || d.status || ':' || d.recon_status || ':' || f.store_id || ':' || coalesce(m.state, '') || ':'
     || coalesce((select string_agg(o.to_address || '/' || o.state, ',' order by o.id) from public.invoice_qb_outbox o where o.sha256=d.sha256), '') x
   from public.invoice_docs d join public.invoice_files f on f.id=d.file_id left join public.invoice_app_mirror m on m.doc_id=d.id
   where (d.posting_kind='purchase' or (d.status='review' and d.doc_type='unknown'))
    and to_char(coalesce(d.invoice_date, d.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM') = v_ym) q;
  if v_closedm and v_pub.ym is not null and v_pub.closed and v_pub.inputs is not distinct from v_in and not coalesce((p->>'force')::boolean, false) then
   v_frozen := v_frozen || v_ym;
   v_sum := v_pub.summary; v_lines := v_pub.lines; v_at := v_pub.published_at;
   update public.invoice_purchase_published x set checked_at=v_now where x.ym=v_ym;
  else
   v_j := public.invoice_purchase_month(v_ym, v_cls);
   v_h := md5(v_j::text);
   if v_pub.ym is null or v_pub.hash <> v_h or v_pub.closed is distinct from v_closedm or v_pub.summary is null then
    insert into public.app_state(key, value, updated_at) values('invoice_purchase_' || v_ym, (v_j->'summary') || jsonb_build_object('generated_at', v_now), v_now)
    on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at;
    for v_sid in select jsonb_object_keys(v_j->'lines') union select jsonb_object_keys(coalesce(v_pub.lines, '{}'::jsonb)) loop
     -- a store whose last invoice of the month moved elsewhere gets an empty row (never the old invoices)
     insert into public.app_state(key, value, updated_at) values('invoice_purchase_lines_' || v_ym || '_' || v_sid,
       jsonb_build_object('v', 1, 'ym', v_ym, 'store', v_sid, 'generated_at', v_now, 'docs', coalesce(v_j->'lines'->v_sid, '{}'::jsonb)), v_now)
     on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at;
    end loop;
    insert into public.invoice_purchase_published(ym, hash, published_at, checked_at, closed, summary, lines, inputs)
    values(v_ym, v_h, v_now, v_now, v_closedm, v_j->'summary', v_j->'lines', v_in)
    on conflict(ym) do update set hash=excluded.hash, published_at=excluded.published_at, checked_at=excluded.checked_at,
     closed=excluded.closed, summary=excluded.summary, lines=excluded.lines, inputs=excluded.inputs;
    v_changed := v_changed || v_ym;
    continue;
   end if;
   v_sum := v_pub.summary; v_lines := v_pub.lines; v_at := v_pub.published_at;
   update public.invoice_purchase_published x set checked_at=v_now, inputs=v_in where x.ym=v_ym;
  end if;
  -- Unchanged here: the rows the app reads must still be what was written.
  if v_sum is not null and coalesce((select md5((a.value::jsonb - 'generated_at')::text) from public.app_state a where a.key='invoice_purchase_' || v_ym), '') <> md5(v_sum::text) then
   insert into public.app_state(key, value, updated_at) values('invoice_purchase_' || v_ym, v_sum || jsonb_build_object('generated_at', v_at), v_now)
   on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at;
   v_repaired := v_repaired || v_ym;
  end if;
  for v_sid in select jsonb_object_keys(coalesce(v_lines, '{}'::jsonb)) loop
   v_exp := jsonb_build_object('v', 1, 'ym', v_ym, 'store', v_sid, 'docs', v_lines->v_sid);
   if coalesce((select md5((a.value::jsonb - 'generated_at')::text) from public.app_state a where a.key='invoice_purchase_lines_' || v_ym || '_' || v_sid), '') <> md5(v_exp::text) then
    insert into public.app_state(key, value, updated_at) values('invoice_purchase_lines_' || v_ym || '_' || v_sid, v_exp || jsonb_build_object('generated_at', v_at), v_now)
    on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at;
    if not (v_ym = any(v_repaired)) then v_repaired := v_repaired || v_ym; end if;
   end if;
  end loop;
 end loop;
 -- The app shows when the summaries were last checked (and warns when that is old: the worker may have stopped).
 insert into public.app_state(key, value, updated_at) values('invoice_purchase_status', jsonb_build_object('v', 1, 'checked_at', v_now,
   'closed_through', v_closed, 'months', coalesce((select jsonb_object_agg(x.ym, jsonb_build_object('at', x.published_at, 'checked', x.checked_at,
     'closed', x.closed)) from public.invoice_purchase_published x), '{}'::jsonb)), v_now)
 on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at;
 return jsonb_build_object('ok', true, 'changed', to_jsonb(v_changed), 'frozen', to_jsonb(v_frozen), 'repaired', to_jsonb(v_repaired));
end $$;

-- "This month of this vendor is all here" (compared with the vendor's statement), or what is missing. Accounting, 事務Crew,
-- GM and CEO, like reconciling. Never for a closed month. Kept as history: the latest row is the current state ('none' clears it).
create or replace function public.invoice_purchase_check(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_actor uuid := nullif(p->>'actor','')::uuid; v_state text := p->>'state'; v_ym text := p->>'ym';
 v_closed text := public.invoice_setting('rules')->>'closed_through'; v_sc bigint; v_row public.invoice_purchase_checks;
begin
 perform public.invoice_require(v_actor, array['ceo','gm','office','office_crew']);
 if v_state is null or v_state not in ('complete','missing','none') then raise exception 'bad_value'; end if;
 if v_ym is null or v_ym !~ '^\d{4}-(0[1-9]|1[0-2])$' or v_ym > to_char(now() at time zone 'Pacific/Honolulu', 'YYYY-MM') then raise exception 'bad_value'; end if;
 if not exists(select 1 from public.invoice_stores where store_id=p->>'store_id') then raise exception 'not_found'; end if;
 if not exists(select 1 from public.invoice_vendor_rules where vendor_key=p->>'vendor_key') then raise exception 'not_found'; end if;
 if v_closed is not null and v_ym <= v_closed then raise exception 'closed_month'; end if;
 if v_state='missing' and length(btrim(coalesce(p->>'note',''))) = 0 then raise exception 'note_required'; end if;
 if jsonb_typeof(p->'statement_cents') = 'number' then
  if (p->>'statement_cents')::numeric <> trunc((p->>'statement_cents')::numeric) or abs((p->>'statement_cents')::numeric) > 100000000000 then raise exception 'bad_value'; end if;
  v_sc := (p->>'statement_cents')::bigint;
 elsif p->'statement_cents' is not null and jsonb_typeof(p->'statement_cents') <> 'null' then raise exception 'bad_value';
 end if;
 insert into public.invoice_purchase_checks(store_id, vendor_key, ym, state, note, statement_cents, checked_by)
 values(p->>'store_id', p->>'vendor_key', v_ym, v_state, nullif(left(btrim(coalesce(p->>'note','')), 500), ''), v_sc, v_actor::text)
 returning * into v_row;
 perform public.invoice_event(null, null, v_actor::text, 'purchase_check', jsonb_build_object('store_id', v_row.store_id, 'vendor_key', v_row.vendor_key,
  'ym', v_ym, 'state', v_state, 'note', v_row.note, 'statement_cents', v_sc));
 return jsonb_build_object('ok', true, 'id', v_row.id, 'checked_at', v_row.checked_at);
end $$;

do $$ declare f text; begin
 foreach f in array array['invoice_purchase_classes(text[])','invoice_purchase_month(text,jsonb)','invoice_purchase_publish(jsonb)','invoice_purchase_check(jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;
