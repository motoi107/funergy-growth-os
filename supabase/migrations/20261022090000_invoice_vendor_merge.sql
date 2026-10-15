-- 業者の統合（Moto 2026-10-15「アプリでインボイスを取り込んでいた時や今も複数の業者名（同じ業者なのに読み取りで若干違う）この複数いる
-- 同じ業者を統合したいです」・UI案51 決めてほしいこと 1〜7 はすべて A）。同じ業者の名前を 1 つにまとめる：アプリ（業者マスター・請求書・
-- 商品・発注・小切手・食材の原価）と Invoice取込を一度に（1A）。このファイルは Invoice取込の分。
--
-- Changes (the worker and the screen do the rest):
--   invoice_vendor_rules   : merged_into / merged_at / merged_by (a vendor merged into another one; its names go with it)
--   invoice_vendor_merges  : one row per merge: what was moved, to take it back exactly (service role only)
--   invoice_vendor_final   : the vendor a key ends at (following merges)
--   invoice_vendor_usage   : per vendor, how many invoices; printed names no vendor has yet; the merges in force (for the screen)
--   invoice_vendor_merge   : merges vendors by their names. The kept vendor takes the others' names (a later invoice with any of them
--                            is that vendor) and, in months not closed, their invoices, statement checks, product mappings and price
--                            history (3A). Closed months stay as they are (posted with the same number under the kept vendor: left
--                            where it is, and listed). Nothing is renamed in Drive and nothing is sent again to QuickBooks
--                            (the invoices keep their version). preview: nothing is changed, what would change is returned.
--   invoice_vendor_unmerge : takes a merge back (the latest one of its vendor first)
--   invoice_vendor_save    : a merged vendor is not edited any more (its names live in the kept vendor)
--   invoice_purchase_check : a statement check given for a merged vendor is kept for the vendor it ended at
--   invoice_vendor_seed, invoice_map_seed : a card whose name a vendor already has is not added again; seeds go to vendors not merged
-- Replaced functions keep their names and arguments, so their grants (service_role only) stay. The new ones are for the service
-- role only. No invoice, line, setting or Drive file is changed by running this file. Running it twice changes nothing.

do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='invoice_docs' and column_name='merged_into')
  or to_regprocedure('public.invoice_merge(jsonb)') is null then
  raise exception '先に 20261021090000_invoice_multi_file.sql（段階 3）を流してください（この SQL はそのあとに流します）';
 end if;
end $$;

alter table public.invoice_vendor_rules add column if not exists merged_into text references public.invoice_vendor_rules(vendor_key);
alter table public.invoice_vendor_rules add column if not exists merged_at timestamptz;
alter table public.invoice_vendor_rules add column if not exists merged_by text;

create table if not exists public.invoice_vendor_merges(
 id uuid primary key default gen_random_uuid(),
 to_key text not null references public.invoice_vendor_rules(vendor_key),
 from_keys text[] not null default '{}',
 names text[] not null default '{}',
 group_id text,                         -- the app's record of the same merge
 before jsonb not null default '{}',    -- the kept vendor before (display_name, food_kind) and what the merge set (name, kind)
 added_aliases text[] not null default '{}',
 moved jsonb not null default '{}',     -- {docs:[{id,k,n}], maps:[{id,k}], prices:[{id,k}], checks:[{id,k}]}: where each one was
 kept jsonb not null default '[]',      -- posted invoices left with their vendor (the kept vendor has one with the same number)
 merged_by text not null,
 merged_at timestamptz not null default now(),
 undone_by text,
 undone_at timestamptz
);
create index if not exists invoice_vendor_merges_to on public.invoice_vendor_merges(to_key, merged_at desc);

do $$ begin
 alter table public.invoice_vendor_merges enable row level security;
 revoke all on public.invoice_vendor_merges from public, anon, authenticated;
 grant select, insert, update on public.invoice_vendor_merges to service_role;
end $$;

create or replace function public.invoice_vendor_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; v jsonb := p->'vendor'; cur public.invoice_vendor_rules;
 k text; known text[] := array['vendor_key','display_name','aliases','food_kind','auto_post','expect_updated_at'];
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 if coalesce(v->>'vendor_key','') !~ '^[A-Za-z0-9_.:@-]{1,80}$' then raise exception 'bad_value'; end if;
 if v ? 'display_name' and length(coalesce(v->>'display_name','')) = 0 then raise exception 'bad_value'; end if;
 for k in select jsonb_object_keys(v) loop if not (k = any(known)) then raise exception 'bad_value'; end if; end loop;
 -- One writer at a time with the alias learning in invoice_edit (no name is taught twice or lost between a read and a write).
 perform pg_advisory_xact_lock(hashtext('invoice_vendor_rules'));
 select * into cur from public.invoice_vendor_rules where vendor_key=v->>'vendor_key' for update;
 -- A vendor merged into another one (業者の統合, Moto 2026-10-15) is not edited: its names live in the kept vendor now.
 if cur.merged_into is not null then raise exception 'merged'; end if;
 -- A screen sends the time it read the vendor; if someone saved it since (or a name was learned), nothing is overwritten.
 if v ? 'expect_updated_at' and (cur.vendor_key is null or cur.updated_at is distinct from (v->>'expect_updated_at')::timestamptz) then raise exception 'conflict'; end if;
 if coalesce((v->>'auto_post')::boolean,false) and public.invoice_actor_role(actor) not in ('ceo','gm')
    and not coalesce(cur.auto_post, false) then raise exception 'forbidden'; end if;
 if cur.vendor_key is null then
  if length(coalesce(v->>'display_name','')) = 0 then raise exception 'bad_value'; end if;
  insert into public.invoice_vendor_rules(vendor_key, display_name, aliases, food_kind, auto_post, verified_by, verified_at)
  values(v->>'vendor_key', v->>'display_name', coalesce(array(select jsonb_array_elements_text(v->'aliases')),'{}'), v->>'food_kind',
   coalesce((v->>'auto_post')::boolean,false), actor::text, now());
 else
  -- Only the keys that were sent change (a switch on its own leaves the names and the kind as they are now).
  update public.invoice_vendor_rules x set
   display_name=case when v ? 'display_name' then v->>'display_name' else x.display_name end,
   aliases=case when v ? 'aliases' then coalesce(array(select jsonb_array_elements_text(v->'aliases')),'{}') else x.aliases end,
   food_kind=case when v ? 'food_kind' then v->>'food_kind' else x.food_kind end,
   auto_post=case when v ? 'auto_post' then coalesce((v->>'auto_post')::boolean,false) else x.auto_post end,
   verified_by=actor::text, verified_at=now(), updated_at=now()
  where x.vendor_key=cur.vendor_key;
 end if;
 perform public.invoice_event(null, null, actor::text, 'vendor_saved', v);
 return (select to_jsonb(x) from public.invoice_vendor_rules x where vendor_key=v->>'vendor_key');
end $$;

create or replace function public.invoice_vendor_seed(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; rows jsonb; n int := 0;
begin
 perform public.invoice_require(actor, array['ceo','gm']);
 -- A card whose name a vendor already has (its own name or one of its names, also a vendor merged into another one) is not
 -- added again (業者の統合, Moto 2026-10-15): the name would belong to two vendors and match neither.
 select coalesce(jsonb_agg(jsonb_build_object('vendor_key', v.id::text, 'display_name', v.name,
   'food_kind', case when v.data->>'kind' in ('food','nonfood') then v.data->>'kind' end,
   'exists', exists(select 1 from public.invoice_vendor_rules r where r.vendor_key=v.id::text
     or exists(select 1 from unnest(array[r.display_name] || r.aliases) a(n)
       where nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') = nullif(btrim(regexp_replace(lower(normalize(v.name, NFKC)), '\s+', ' ', 'g')), '')))) order by v.name), '[]')
 into rows from public.vendors v where coalesce(v.name,'') <> '' and v.id::text ~ '^[A-Za-z0-9_.:@-]{1,80}$';
 if coalesce((p->>'apply')::boolean,false) then
  insert into public.invoice_vendor_rules(vendor_key, display_name, food_kind, auto_post)
  select x->>'vendor_key', x->>'display_name', x->>'food_kind', false from jsonb_array_elements(rows) x
  where not coalesce((x->>'exists')::boolean, false)
  on conflict(vendor_key) do nothing;
  get diagnostics n = row_count;
  perform public.invoice_event(null, null, actor::text, 'vendor_seed', jsonb_build_object('added', n));
 end if;
 return jsonb_build_object('vendors', rows, 'added', n);
end $$;

-- Product master rows that carry a vendor product code (LaLa's imported items do) -> unverified mappings.
-- Case vs bag/bottle comes from the master's own "qty per purchase unit"; grams only where the master counts in g.
create or replace function public.invoice_map_seed(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; rows jsonb; n int := 0;
begin
 perform public.invoice_require(actor, array['ceo','gm']);
 with src as (
  select i.code::text code, coalesce(i.data->>'name', i.name) name, coalesce(i.data->>'vendor', i.vendor) vendor, i.data->>'sku' sku,
   upper(regexp_replace(coalesce(i.data->>'orderUnit',''), '[\s.]', '', 'g')) order_unit, coalesce(i.data->>'unit', i.unit) count_unit,
   coalesce(nullif(i.data->>'qty','')::numeric, i.qty) qty, i.data->>'pack' pack
  from public.ingredients i
  where coalesce(i.data->>'sku','') <> '' and (not coalesce((p->>'only_ext')::boolean,true) or coalesce(i.data->>'extId','') <> '')),
 cand as (
  -- a vendor merged into another one is found through the kept vendor, which has its names (業者の統合, Moto 2026-10-15)
  select s.*, (select r.vendor_key from public.invoice_vendor_rules r where r.merged_into is null and (lower(r.display_name)=lower(s.vendor)
     or lower(s.vendor) in (select lower(a) from unnest(r.aliases) a)) limit 1) vendor_key from src s)
 select coalesce(jsonb_agg(jsonb_build_object('ingredient_code', code, 'name', name, 'vendor', vendor, 'vendor_key', vendor_key, 'vendor_item_code', sku,
   'purchase_unit', order_unit, 'count_unit', count_unit, 'count_per_purchase', case when qty > 0 then qty end,
   'base_unit', case when lower(count_unit) in ('g','ml') then lower(count_unit) end,
   'base_per_purchase', case when lower(count_unit) in ('g','ml') and qty > 0 then qty end, 'pack', pack) order by vendor, name), '[]')
 into rows from cand;
 if coalesce((p->>'apply')::boolean,false) then
  insert into public.invoice_item_maps(vendor_key, store_id, vendor_item_code, spec_key, purchase_unit, ingredient_code, count_unit, count_per_purchase,
   base_unit, base_per_purchase, verified, auto_post, source, note)
  select x->>'vendor_key', p->>'store_id', x->>'vendor_item_code', '', coalesce(x->>'purchase_unit',''), x->>'ingredient_code', x->>'count_unit',
   (x->>'count_per_purchase')::numeric, x->>'base_unit', (x->>'base_per_purchase')::numeric, false, false, 'master_seed', x->>'pack'
  from jsonb_array_elements(rows) x where x->>'vendor_key' is not null
   and not exists(select 1 from public.invoice_item_maps m where m.vendor_key=x->>'vendor_key' and m.vendor_item_code=x->>'vendor_item_code')
  on conflict do nothing;
  get diagnostics n = row_count;
  perform public.invoice_event(null, null, actor::text, 'map_seed', jsonb_build_object('added', n, 'store', p->>'store_id'));
 end if;
 return jsonb_build_object('candidates', rows, 'added', n,
  'vendor_unmatched', (select coalesce(jsonb_agg(distinct x->>'vendor'), '[]') from jsonb_array_elements(rows) x where x->>'vendor_key' is null));
end $$;

-- "This month of this vendor is all here" (compared with the vendor's statement), or what is missing. Accounting, 事務Crew,
-- GM and CEO, like reconciling. Never for a closed month. Kept as history: the latest row is the current state ('none' clears it).
-- A screen opened before a merge may still name a merged vendor: the check is kept for the vendor it ended at (業者の統合).
create or replace function public.invoice_purchase_check(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_actor uuid := nullif(p->>'actor','')::uuid; v_state text := p->>'state'; v_ym text := p->>'ym';
 v_closed text := public.invoice_setting('rules')->>'closed_through'; v_sc bigint; v_row public.invoice_purchase_checks;
 v_vk text := public.invoice_vendor_final(p->>'vendor_key');
begin
 perform public.invoice_require(v_actor, array['ceo','gm','office','office_crew']);
 if v_state is null or v_state not in ('complete','missing','none') then raise exception 'bad_value'; end if;
 if v_ym is null or v_ym !~ '^\d{4}-(0[1-9]|1[0-2])$' or v_ym > to_char(now() at time zone 'Pacific/Honolulu', 'YYYY-MM') then raise exception 'bad_value'; end if;
 if not exists(select 1 from public.invoice_stores where store_id=p->>'store_id') then raise exception 'not_found'; end if;
 if v_vk is null then raise exception 'not_found'; end if;
 if v_closed is not null and v_ym <= v_closed then raise exception 'closed_month'; end if;
 if v_state='missing' and length(btrim(coalesce(p->>'note',''))) = 0 then raise exception 'note_required'; end if;
 if jsonb_typeof(p->'statement_cents') = 'number' then
  if (p->>'statement_cents')::numeric <> trunc((p->>'statement_cents')::numeric) or abs((p->>'statement_cents')::numeric) > 100000000000 then raise exception 'bad_value'; end if;
  v_sc := (p->>'statement_cents')::bigint;
 elsif p->'statement_cents' is not null and jsonb_typeof(p->'statement_cents') <> 'null' then raise exception 'bad_value';
 end if;
 insert into public.invoice_purchase_checks(store_id, vendor_key, ym, state, note, statement_cents, checked_by)
 values(p->>'store_id', v_vk, v_ym, v_state, nullif(left(btrim(coalesce(p->>'note','')), 500), ''), v_sc, v_actor::text)
 returning * into v_row;
 perform public.invoice_event(null, null, v_actor::text, 'purchase_check', jsonb_build_object('store_id', v_row.store_id, 'vendor_key', v_row.vendor_key,
  'ym', v_ym, 'state', v_state, 'note', v_row.note, 'statement_cents', v_sc));
 return jsonb_build_object('ok', true, 'id', v_row.id, 'checked_at', v_row.checked_at);
end $$;

-- The vendor a key ends at: itself, or the vendor it was merged into (and so on). Null for a key no vendor has.
create or replace function public.invoice_vendor_final(p_key text) returns text
language sql stable security invoker set search_path=public,pg_temp as $$
 with recursive c(k, n) as (
  select r.vendor_key, 0 from public.invoice_vendor_rules r where r.vendor_key=p_key
  union all
  select r.merged_into, c.n + 1 from c join public.invoice_vendor_rules r on r.vendor_key=c.k where r.merged_into is not null and c.n < 20)
 select k from c order by n desc limit 1;
$$;

-- For the vendor master's 業者の統合 (accounting, 事務Crew, GM, CEO): every vendor with its names and how many invoices it has,
-- the printed names no vendor has yet (invoices waiting for a person), and the merges in force.
create or replace function public.invoice_vendor_usage(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 return jsonb_build_object(
  'vendors', (select coalesce(jsonb_agg(jsonb_build_object('vendor_key', v.vendor_key, 'display_name', v.display_name, 'aliases', to_jsonb(v.aliases),
     'merged_into', v.merged_into, 'food_kind', v.food_kind, 'auto_post', v.auto_post,
     'docs', (select count(*) from public.invoice_docs d where d.vendor_key=v.vendor_key and d.status <> 'merged')) order by v.display_name, v.vendor_key), '[]')
   from public.invoice_vendor_rules v),
  'unknown', (select coalesce(jsonb_agg(jsonb_build_object('name', q.name, 'docs', q.n) order by q.n desc, q.name), '[]') from (
    select min(d.vendor_raw) name, count(*) n from public.invoice_docs d
    where d.vendor_key is null and d.status='review' and coalesce(btrim(d.vendor_raw), '') <> ''
    group by nullif(btrim(regexp_replace(lower(normalize(d.vendor_raw, NFKC)), '\s+', ' ', 'g')), '')) q),
  'merges', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'to_key', m.to_key, 'from_keys', to_jsonb(m.from_keys), 'names', to_jsonb(m.names),
     'group_id', m.group_id, 'merged_at', m.merged_at) order by m.merged_at desc), '[]')
   from public.invoice_vendor_merges m where m.undone_at is null));
end $$;

-- 業者の統合 (Moto 2026-10-15・UI案51 1A・2A・3A): the vendors any of the names belongs to become one. The kept vendor is the one
-- called by the name to keep (p.to), else the one that has it as a name, else the one with the most invoices; it is called p.to
-- from now on and takes every other name (its old name too), so a later invoice printed with any of them is that vendor. The
-- others are marked merged into it (not removed: the merge can be taken back). In months not closed (rules.closed_through) their
-- invoices (each page too), statement checks and product mappings (where the kept vendor has none for the same key) go to the
-- kept vendor, with its name; their price history goes to it in every month (it is what later prices are compared with). A
-- posted invoice whose number the kept vendor already has posted in the same store stays where it is and is listed (a double
-- posting for a person to look at). Invoices keep their version: no original is renamed again in Drive and nothing is sent to
-- QuickBooks again. Invoices waiting for review (also those whose printed name no vendor had) are returned for the caller to
-- work out again with the kept vendor. p.food_kind sets the kept vendor's kind (for invoices read from now on). p.preview:
-- nothing is changed; what would change is returned.
create or replace function public.invoice_vendor_merge(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; v_to text := btrim(coalesce(p->>'to','')); v_prev boolean := coalesce((p->>'preview')::boolean, false);
 v_kind text := nullif(p->>'food_kind', ''); v_gid text := nullif(btrim(coalesce(p->>'group_id', '')), '');
 v_closed text := public.invoice_setting('rules')->>'closed_through';
 v_names text[]; v_keys text[]; v_tok text; v_match text[]; v_tk text; v_from text[]; tgt public.invoice_vendor_rules;
 v_have text[]; v_added text[] := '{}'; v_name text; v_k text; v_rename boolean; r record; v_id uuid;
 v_docs jsonb := '[]'; v_kept jsonb := '[]'; v_maps jsonb := '[]'; v_prices jsonb := '[]'; v_checks jsonb := '[]';
 v_review uuid[] := '{}'; v_unknown uuid[] := '{}'; v_months text[] := '{}'; v_pk text[] := '{}'; v_posted int := 0; v_left int := 0;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 if jsonb_typeof(p->'names') is distinct from 'array' then raise exception 'bad_value'; end if;
 v_names := array(select n from (select distinct on (btrim(x)) btrim(x) n, i from jsonb_array_elements_text(p->'names') with ordinality q(x, i)
   where btrim(x) <> '' order by btrim(x), i) z order by i);
 if length(v_to) = 0 or length(v_to) > 200 or cardinality(v_names) = 0 or cardinality(v_names) > 50
    or exists(select 1 from unnest(v_names) n where length(n) > 200) then raise exception 'bad_value'; end if;
 if v_kind is not null and v_kind not in ('food','nonfood') then raise exception 'bad_value'; end if;
 if v_gid is not null and v_gid !~ '^[A-Za-z0-9_.:-]{1,80}$' then raise exception 'bad_value'; end if;
 v_tok := nullif(btrim(regexp_replace(lower(normalize(v_to, NFKC)), '\s+', ' ', 'g')), '');
 v_keys := array(select distinct k from (select nullif(btrim(regexp_replace(lower(normalize(x, NFKC)), '\s+', ' ', 'g')), '') k
   from unnest(v_names || v_to) x) q where k is not null);
 -- One writer at a time with the vendor edits and the name learning (invoice_vendor_save, invoice_edit) and other merges.
 perform pg_advisory_xact_lock(hashtext('invoice_vendor_rules'));
 v_match := array(select v.vendor_key from public.invoice_vendor_rules v where v.merged_into is null
   and exists(select 1 from unnest(array[v.display_name] || v.aliases) a(n)
     where nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') = any(v_keys)) order by v.vendor_key);
 if cardinality(v_match) = 0 then
  -- No vendor of invoice intake has any of these names: nothing to merge here (the app merges its own records).
  return jsonb_build_object('ok', true, 'preview', v_prev, 'matched', 0, 'merge_id', null, 'target', null, 'from', '[]'::jsonb,
   'unknown', (select count(*) from public.invoice_docs d where d.vendor_key is null and d.status='review'
     and nullif(btrim(regexp_replace(lower(normalize(coalesce(d.vendor_raw, ''), NFKC)), '\s+', ' ', 'g')), '') = any(v_keys)));
 end if;
 select v.vendor_key into v_tk from public.invoice_vendor_rules v where v.vendor_key = any(v_match)
 order by (v.display_name = v_to) desc,
  (nullif(btrim(regexp_replace(lower(normalize(v.display_name, NFKC)), '\s+', ' ', 'g')), '') = v_tok) desc,
  exists(select 1 from unnest(v.aliases) a(n) where nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') = v_tok) desc,
  (select count(*) from public.invoice_docs d where d.vendor_key=v.vendor_key) desc, v.vendor_key
 limit 1;
 perform 1 from public.invoice_vendor_rules where vendor_key = any(v_match) for update;
 select * into tgt from public.invoice_vendor_rules where vendor_key=v_tk;
 v_from := array(select x from unnest(v_match) x where x <> v_tk order by x);
 v_rename := tgt.display_name is distinct from v_to;
 -- Invoices: the other vendors' (and the kept vendor's when it is called by another name now), month by month.
 for r in select d.id, d.file_id, d.vendor_key, d.vendor_name, d.status, d.store_id, d.doc_type, d.invoice_no_norm, d.invoice_no, d.internal_no,
   to_char(coalesce(d.invoice_date, d.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM') ym
  from public.invoice_docs d join public.invoice_files f on f.id=d.file_id
  where d.vendor_key = any(v_from) or (d.vendor_key = v_tk and d.vendor_name is distinct from v_to)
  order by (d.status='posted') desc, d.posted_at nulls last, d.created_at, d.id
 loop
  if v_closed is not null and r.ym <= v_closed then
   if r.vendor_key <> v_tk then v_left := v_left + 1; end if;
   continue;
  end if;
  if r.status='posted' and r.vendor_key <> v_tk and r.invoice_no_norm is not null
     and (r.store_id || '|' || r.doc_type || '|' || r.invoice_no_norm = any(v_pk)
      or exists(select 1 from public.invoice_docs x where x.status='posted' and x.id<>r.id and x.store_id=r.store_id and x.vendor_key=v_tk
       and x.doc_type=r.doc_type and x.invoice_no_norm=r.invoice_no_norm)) then
   v_kept := v_kept || jsonb_build_object('id', r.id, 'internal_no', r.internal_no, 'invoice_no', r.invoice_no, 'store_id', r.store_id, 'vendor_key', r.vendor_key);
   continue;
  end if;
  if not v_prev then
   update public.invoice_docs set vendor_key=v_tk, vendor_name=v_to, updated_at=now() where id=r.id;
   perform public.invoice_event(r.id, r.file_id, actor::text, 'vendor_merged', jsonb_build_object('from', r.vendor_key, 'to', v_tk, 'name', v_to));
  end if;
  v_docs := v_docs || jsonb_build_object('id', r.id, 'k', r.vendor_key, 'n', r.vendor_name);
  if r.status='review' then v_review := v_review || r.id; end if;
  if r.status='posted' then
   v_posted := v_posted + 1;
   if r.invoice_no_norm is not null then v_pk := v_pk || (r.store_id || '|' || r.doc_type || '|' || r.invoice_no_norm); end if;
  end if;
  v_months := v_months || r.ym;
 end loop;
 -- Invoices waiting for a person because their printed name was no vendor's: they get the kept vendor (the caller does it).
 for r in select d.id, to_char(coalesce(d.invoice_date, d.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM') ym
  from public.invoice_docs d join public.invoice_files f on f.id=d.file_id
  where d.vendor_key is null and d.status='review'
   and nullif(btrim(regexp_replace(lower(normalize(coalesce(d.vendor_raw, ''), NFKC)), '\s+', ' ', 'g')), '') = any(v_keys)
  order by d.created_at, d.id
 loop
  if v_closed is not null and r.ym <= v_closed then continue; end if;
  v_unknown := v_unknown || r.id; v_months := v_months || r.ym;
 end loop;
 -- Product mappings: to the kept vendor, unless it has one for the same product code, name, spec and unit (that one stays).
 for r in select m.id, m.vendor_key, m.store_id, m.vendor_item_code, m.alias_key, m.spec_key, m.purchase_unit from public.invoice_item_maps m
  where m.vendor_key = any(v_from) order by m.updated_at, m.id
 loop
  if exists(select 1 from public.invoice_item_maps x where x.vendor_key=v_tk and coalesce(x.store_id,'')=coalesce(r.store_id,'')
     and coalesce(x.vendor_item_code,'')=coalesce(r.vendor_item_code,'') and coalesce(x.alias_key,'')=coalesce(r.alias_key,'')
     and x.spec_key=r.spec_key and x.purchase_unit=r.purchase_unit) then continue; end if;
  if not v_prev then update public.invoice_item_maps set vendor_key=v_tk, updated_at=now() where id=r.id; end if;
  v_maps := v_maps || jsonb_build_object('id', r.id, 'k', r.vendor_key);
 end loop;
 -- The kept vendor's names: its own (also the old one when it is called by another name now), the merged vendors' and the given ones.
 v_have := array(select nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') from unnest(tgt.aliases || v_to) a(n));
 for v_name in
  select x.n from (
   select tgt.display_name n, 0 o, ''::text kk, 0::bigint i where v_rename
   union all
   select a.n, 1, v.vendor_key, a.i from public.invoice_vendor_rules v, unnest(array[v.display_name] || v.aliases) with ordinality a(n, i) where v.vendor_key = any(v_from)
   union all
   select u.n, 2, '', u.i from unnest(v_names) with ordinality u(n, i)) x
  order by x.o, x.kk, x.i
 loop
  v_k := nullif(btrim(regexp_replace(lower(normalize(coalesce(v_name, ''), NFKC)), '\s+', ' ', 'g')), '');
  if v_k is null or v_k = any(v_have) then continue; end if;
  v_added := v_added || v_name; v_have := v_have || v_k;
 end loop;
 if cardinality(v_from) = 0 and not v_rename and cardinality(v_added) = 0 and cardinality(v_unknown) = 0 then
  -- The names are already the kept vendor's, as it is called: nothing to merge here (no record either).
  return jsonb_build_object('ok', true, 'preview', v_prev, 'matched', cardinality(v_match), 'merge_id', null,
   'target', jsonb_build_object('vendor_key', v_tk, 'display_name', v_to, 'before', tgt.display_name, 'auto_post', tgt.auto_post, 'food_kind', tgt.food_kind),
   'from', '[]'::jsonb, 'docs', 0, 'review', 0, 'posted', 0, 'kept', '[]'::jsonb, 'closed_left', 0, 'unknown', 0, 'maps', 0, 'prices', 0, 'checks', 0,
   'added_aliases', '[]'::jsonb, 'months', '[]'::jsonb);
 end if;
 if v_prev then
  return jsonb_build_object('ok', true, 'preview', true, 'merge_id', null, 'matched', cardinality(v_match),
   'target', jsonb_build_object('vendor_key', v_tk, 'display_name', v_to, 'before', tgt.display_name, 'auto_post', tgt.auto_post,
     'food_kind', coalesce(v_kind, tgt.food_kind), 'kind_before', tgt.food_kind),
   'from', (select coalesce(jsonb_agg(jsonb_build_object('vendor_key', v.vendor_key, 'display_name', v.display_name, 'food_kind', v.food_kind,
     'auto_post', v.auto_post) order by v.vendor_key), '[]') from public.invoice_vendor_rules v where v.vendor_key = any(v_from)),
   'docs', jsonb_array_length(v_docs), 'review', cardinality(v_review), 'posted', v_posted, 'kept', v_kept, 'closed_left', v_left,
   'unknown', cardinality(v_unknown), 'maps', jsonb_array_length(v_maps),
   'prices', (select count(*) from public.invoice_price_history h where h.vendor_key = any(v_from)),
   'checks', (select count(*) from public.invoice_purchase_checks c where c.vendor_key = any(v_from) and (v_closed is null or c.ym > v_closed)),
   'added_aliases', to_jsonb(v_added), 'months', to_jsonb(array(select distinct m from unnest(v_months) m order by 1)));
 end if;
 with s as (select h.id, h.vendor_key k from public.invoice_price_history h where h.vendor_key = any(v_from)),
 u as (update public.invoice_price_history h set vendor_key=v_tk from s where h.id=s.id returning h.id, s.k)
 select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'k', u.k) order by u.id), '[]') into v_prices from u;
 with s as (select c.id, c.vendor_key k, c.ym from public.invoice_purchase_checks c where c.vendor_key = any(v_from) and (v_closed is null or c.ym > v_closed)),
 u as (update public.invoice_purchase_checks c set vendor_key=v_tk from s where c.id=s.id returning c.id, s.k, s.ym)
 select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'k', u.k, 'ym', u.ym) order by u.id), '[]') into v_checks from u;
 v_months := v_months || array(select e->>'ym' from jsonb_array_elements(v_checks) e);
 update public.invoice_vendor_rules set display_name=v_to, aliases=aliases || v_added, food_kind=coalesce(v_kind, food_kind), updated_at=now() where vendor_key=v_tk;
 update public.invoice_vendor_rules set merged_into=v_tk, merged_at=now(), merged_by=actor::text, updated_at=now() where vendor_key = any(v_from);
 insert into public.invoice_vendor_merges(to_key, from_keys, names, group_id, before, added_aliases, moved, kept, merged_by)
 values(v_tk, v_from, v_names, v_gid, jsonb_build_object('display_name', tgt.display_name, 'food_kind', tgt.food_kind, 'name', v_to, 'kind', v_kind), v_added,
  jsonb_build_object('docs', v_docs, 'maps', v_maps, 'prices', v_prices, 'checks', v_checks), v_kept, actor::text)
 returning id into v_id;
 perform public.invoice_event(null, null, actor::text, 'vendors_merged', jsonb_build_object('merge_id', v_id, 'to', v_tk, 'name', v_to, 'from', to_jsonb(v_from),
  'names', to_jsonb(v_names), 'docs', jsonb_array_length(v_docs), 'kept', v_kept, 'group_id', v_gid));
 return jsonb_build_object('ok', true, 'preview', false, 'merge_id', v_id, 'matched', cardinality(v_match),
  'target', jsonb_build_object('vendor_key', v_tk, 'display_name', v_to, 'before', tgt.display_name, 'auto_post', tgt.auto_post, 'food_kind', coalesce(v_kind, tgt.food_kind)),
  'from', to_jsonb(v_from), 'docs', jsonb_array_length(v_docs), 'review', cardinality(v_review), 'posted', v_posted, 'kept', v_kept, 'closed_left', v_left,
  'unknown', cardinality(v_unknown), 'maps', jsonb_array_length(v_maps), 'prices', jsonb_array_length(v_prices), 'checks', jsonb_array_length(v_checks),
  'added_aliases', to_jsonb(v_added), 'review_doc_ids', to_jsonb(v_review || v_unknown),
  'months', to_jsonb(array(select distinct m from unnest(v_months) m order by 1)));
end $$;

-- Takes a merge back: the merged vendors are vendors of their own again with their names, and what the merge moved goes back
-- where it was, as long as it is still with the kept vendor (an invoice corrected since stays). Invoices read after the merge stay
-- with the kept vendor. The latest merge of a vendor is taken back first (a later one could rest on the names this one added).
-- p.preview: nothing is changed; what would change is returned.
create or replace function public.invoice_vendor_unmerge(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; v_prev boolean := coalesce((p->>'preview')::boolean, false);
 m public.invoice_vendor_merges; tgt public.invoice_vendor_rules; e jsonb; d public.invoice_docs;
 v_back int := 0; v_stay int := 0; v_review uuid[] := '{}'; v_months text[] := '{}';
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 if coalesce(p->>'merge_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_value'; end if;
 perform pg_advisory_xact_lock(hashtext('invoice_vendor_rules'));
 select * into m from public.invoice_vendor_merges where id=(p->>'merge_id')::uuid for update;
 if m.id is null then raise exception 'not_found'; end if;
 if m.undone_at is not null then raise exception 'invalid_state'; end if;
 select * into tgt from public.invoice_vendor_rules where vendor_key=m.to_key for update;
 if tgt.merged_into is not null or exists(select 1 from public.invoice_vendor_merges x where x.undone_at is null and x.id<>m.id
    and x.to_key=m.to_key and x.merged_at > m.merged_at) then raise exception 'later_merge'; end if;
 for e in select x from jsonb_array_elements(coalesce(m.moved->'docs', '[]'::jsonb)) x loop
  select * into d from public.invoice_docs where id=(e->>'id')::uuid for update;
  if d.id is null or d.vendor_key is distinct from m.to_key then v_stay := v_stay + 1; continue; end if;
  if d.status='posted' and d.invoice_no_norm is not null and (e->>'k') is distinct from m.to_key and exists(select 1 from public.invoice_docs x
     where x.status='posted' and x.id<>d.id and x.store_id=d.store_id and x.vendor_key=e->>'k' and x.doc_type=d.doc_type and x.invoice_no_norm=d.invoice_no_norm) then
   v_stay := v_stay + 1; continue;
  end if;
  if not v_prev then
   update public.invoice_docs set vendor_key=e->>'k', vendor_name=e->>'n', updated_at=now() where id=d.id;
   perform public.invoice_event(d.id, d.file_id, actor::text, 'vendor_unmerged', jsonb_build_object('from', m.to_key, 'to', e->>'k'));
  end if;
  v_back := v_back + 1;
  if d.status='review' then v_review := v_review || d.id; end if;
  v_months := v_months || to_char(coalesce(d.invoice_date, d.effective_date,
   (select (f.ingested_at at time zone 'Pacific/Honolulu')::date from public.invoice_files f where f.id=d.file_id)), 'YYYY-MM');
 end loop;
 v_months := v_months || array(select y->>'ym' from jsonb_array_elements(coalesce(m.moved->'checks', '[]'::jsonb)) y);
 if v_prev then
  return jsonb_build_object('ok', true, 'preview', true, 'merge_id', m.id, 'docs', v_back, 'stay', v_stay, 'review', cardinality(v_review),
   'from', to_jsonb(m.from_keys), 'months', to_jsonb(array(select distinct x from unnest(v_months) x where x is not null order by 1)));
 end if;
 update public.invoice_item_maps x set vendor_key=q.k, updated_at=now()
 from (select (y->>'id')::uuid id, y->>'k' k from jsonb_array_elements(coalesce(m.moved->'maps', '[]'::jsonb)) y) q
 where x.id=q.id and x.vendor_key=m.to_key and not exists(select 1 from public.invoice_item_maps z where z.vendor_key=q.k and z.id<>x.id
  and coalesce(z.store_id,'')=coalesce(x.store_id,'') and coalesce(z.vendor_item_code,'')=coalesce(x.vendor_item_code,'')
  and coalesce(z.alias_key,'')=coalesce(x.alias_key,'') and z.spec_key=x.spec_key and z.purchase_unit=x.purchase_unit);
 update public.invoice_price_history x set vendor_key=q.k
 from (select (y->>'id')::bigint id, y->>'k' k from jsonb_array_elements(coalesce(m.moved->'prices', '[]'::jsonb)) y) q
 where x.id=q.id and x.vendor_key=m.to_key;
 update public.invoice_purchase_checks x set vendor_key=q.k
 from (select (y->>'id')::bigint id, y->>'k' k from jsonb_array_elements(coalesce(m.moved->'checks', '[]'::jsonb)) y) q
 where x.id=q.id and x.vendor_key=m.to_key;
 update public.invoice_vendor_rules set merged_into=null, merged_at=null, merged_by=null, updated_at=now()
 where vendor_key = any(m.from_keys) and merged_into=m.to_key;
 update public.invoice_vendor_rules set
  aliases=array(select a from unnest(aliases) with ordinality u(a, i) where not (a = any(m.added_aliases)) order by i),
  display_name=case when display_name = m.before->>'name' then m.before->>'display_name' else display_name end,
  food_kind=case when m.before->>'kind' is not null and food_kind is not distinct from m.before->>'kind' then m.before->>'food_kind' else food_kind end,
  updated_at=now()
 where vendor_key=m.to_key;
 update public.invoice_vendor_merges set undone_by=actor::text, undone_at=now() where id=m.id;
 perform public.invoice_event(null, null, actor::text, 'vendors_unmerged', jsonb_build_object('merge_id', m.id, 'to', m.to_key, 'from', to_jsonb(m.from_keys),
  'docs', v_back, 'stayed', v_stay));
 return jsonb_build_object('ok', true, 'preview', false, 'merge_id', m.id, 'docs', v_back, 'stay', v_stay, 'review', cardinality(v_review),
  'from', to_jsonb(m.from_keys), 'review_doc_ids', to_jsonb(v_review),
  'months', to_jsonb(array(select distinct x from unnest(v_months) x where x is not null order by 1)));
end $$;

do $$ declare f text; begin
 foreach f in array array['invoice_vendor_final(text)','invoice_vendor_usage(jsonb)','invoice_vendor_merge(jsonb)','invoice_vendor_unmerge(jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;
