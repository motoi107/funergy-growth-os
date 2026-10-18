-- 紐づけ 段階 1（Moto 2026-10-18・UI案55 決まったこと 1〜8）：Drive 取込の invoice の品目を、今の食材マスター（棚卸表の品目）の
-- コードに結ぶ。このファイルは Invoice取込の分（画面はアプリ v1093 の 食材マスター › 紐づけ）。
--
-- A link is a row of the Drive intake's mapping table (invoice_item_maps): a vendor's item (its item code, or else its printed name
-- with its pack) → a code of the current master (public.ingredients). An item linked gets its latest price per current code from then
-- on (invoice_price_history, through the intake as before), and the lines already taken in (to check and posted) get the code at once
-- (invoice_link_apply). The current master, the stores' inventory lists, past inventories and past costs are never changed here
-- (decision 1). A closed month's purchase summary stays as it was (the lines' links are not what it is kept by).
--
-- Changes (the function invoice-intake and the screen do the rest):
--   invoice_item_maps.retired_at/by : a link taken back (戻す). Nothing is deleted: a link taken back is no longer used by the intake
--                             (invoice_worker_context leaves it out) nor for prices (invoice_price_insert), and linking the same item
--                             again uses the same row.
--   invoice_link_members    : Head Chef and AM accounts (decision 5). They may link (and take a link back, and mark an item) and
--                             nothing else of the intake (invoice_actor_role is unchanged). Refused as soon as the employee master
--                             says they left the role or 退職 (the employee master only takes access away, never gives it).
--   invoice_link_marks      : an item marked 対象外 (not stocked: supplies, equipment), 新しい品目 (not in the current master yet),
--                             あとで, or an item of a non-food vendor taken back into linking (decision 6: those are left out at first).
--   invoice_code_key        : a vendor item code as the intake compares it (rules.mjs codeKey: NFKC, trimmed, upper case).
--   invoice_link_hr_ok / invoice_link_role / invoice_link_whoami : who may link.
--   invoice_link_data       : what the screen shows (the lines of the invoices, the links, the marks, the vendors, the names).
--   invoice_link_lines      : the lines of some vendors (for the function to bring the lines in line with the links).
--   invoice_link_save       : link items (300 at most), under the lock of the other mapping writes; the master code must exist.
--   invoice_link_retire     : take links back.
--   invoice_link_mark       : mark items.
--   invoice_link_apply      : the lines' links and the reasons about the link, as the function worked them out; a posted line's price
--                             history follows (the old row voided, a new one when the line is clean). Nothing else of a line or an
--                             invoice changes (amounts, versions, posting, reconciliation, QuickBooks).
--   invoice_price_insert, invoice_worker_context, invoice_map_save : (replaced) a link taken back is not used; accounting's own
--                             mapping screen uses a taken-back row again rather than failing on it.
-- The new tables and functions are for the service role only (the replaced ones keep who may run them). No invoice amount, posting,
-- reconciliation, QuickBooks row, Drive file or setting is changed by running this file. Running it twice changes nothing.

do $$ begin
 if to_regprocedure('public.invoice_vendor_register(jsonb)') is null then
  raise exception '先に 20261024090000_invoice_vendor_register.sql（新しい業者を決める）を流してください（この SQL はそのあとに流します）';
 end if;
end $$;

-- ---------------------------------------------------------------- 1) tables
alter table public.invoice_item_maps add column if not exists retired_at timestamptz;
alter table public.invoice_item_maps add column if not exists retired_by text;

create table if not exists public.invoice_link_members(
 user_id uuid primary key,
 emp_id text not null check (length(emp_id) between 1 and 64),
 role text not null check (role in ('am','chef')),
 enabled boolean not null default true,
 note text,
 added_by text,
 added_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists invoice_link_members_emp on public.invoice_link_members(emp_id) where enabled;

create table if not exists public.invoice_link_marks(
 id uuid primary key default gen_random_uuid(),
 vendor_key text not null,
 vendor_item_code text,
 alias_key text,
 spec_key text not null default '',
 state text not null check (state in ('excluded','new_item','later','included','none')),
 note text,
 version integer not null default 1,
 by_actor text not null,
 by_role text not null,
 at timestamptz not null default now(),
 check (vendor_item_code is not null or alias_key is not null)
);
create unique index if not exists invoice_link_marks_key on public.invoice_link_marks(vendor_key, coalesce(vendor_item_code,''), coalesce(alias_key,''), spec_key);

do $$ declare t text; begin
 foreach t in array array['invoice_link_members','invoice_link_marks'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from public, anon, authenticated', t);
  execute format('grant select, insert, update on public.%I to service_role', t);
 end loop;
end $$;

-- ---------------------------------------------------------------- 2) replaced: a link taken back is not used
-- Price history row for one line, only from a verified mapping and clean values.
-- Credit memos, statements and receipts never set prices.
create or replace function public.invoice_price_insert(p_doc uuid, p_line uuid, p_who text, p_reason text) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.invoice_docs; l public.invoice_lines; im public.invoice_item_maps;
begin
 select * into d from public.invoice_docs where id=p_doc;
 select * into l from public.invoice_lines where id=p_line and doc_id=p_doc;
 if d.doc_type<>'invoice' or l.id is null or l.ingredient_code is null or l.price_per_purchase is null or d.effective_date is null then return false; end if;
 -- A link taken back (紐づけを戻した, 2026-10-18) is never a source of prices.
 select * into im from public.invoice_item_maps where id=l.map_id and verified and retired_at is null and vendor_key=d.vendor_key and (store_id is null or store_id=d.store_id);
 if im.id is null or im.ingredient_code<>l.ingredient_code then return false; end if;
 if l.reasons ?| array['catch_weight','line_math','zero_price','negative_line','line_value_missing','line_qty_price_missing','line_amount_missing','unit_mismatch','unit_unverified','spec_changed','map_ambiguous','unmapped'] then return false; end if;
 insert into public.invoice_price_history(store_id, vendor_key, ingredient_code, spec_key, purchase_unit, doc_id, line_id, effective_date,
  effective_basis, invoice_date, invoice_no_norm, price_per_purchase, price_per_count, count_unit, price_per_base, base_unit, conversion, created_by, reason)
 values(d.store_id, d.vendor_key, l.ingredient_code, coalesce(nullif(im.spec_key,''), l.spec_key, ''), coalesce(nullif(im.purchase_unit,''), l.purchase_unit, ''),
  d.id, l.id, d.effective_date, d.effective_basis, d.invoice_date, d.invoice_no_norm, l.price_per_purchase, l.price_per_count, im.count_unit,
  l.price_per_base, im.base_unit, jsonb_build_object('map_id', im.id, 'count_per_purchase', im.count_per_purchase, 'base_per_purchase', im.base_per_purchase,
   'count_unit', im.count_unit, 'base_unit', im.base_unit), p_who, p_reason);
 return true;
end $$;

create or replace function public.invoice_worker_context(p jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'settings', jsonb_build_object('mode', public.invoice_setting('mode'), 'rules', public.invoice_setting('rules'), 'qb', public.invoice_setting('qb')),
  'stores', (select coalesce(jsonb_agg(to_jsonb(s) order by s.store_id), '[]') from public.invoice_stores s where s.active),
  'all_stores', (select coalesce(jsonb_agg(to_jsonb(s) order by s.store_id), '[]') from public.invoice_stores s),
  'vendors', (select coalesce(jsonb_agg(to_jsonb(v)), '[]') from public.invoice_vendor_rules v),
  -- the links in use (a link taken back is kept as a record only, 2026-10-18)
  'maps', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.invoice_item_maps m where m.retired_at is null));
$$;

create or replace function public.invoice_map_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; m jsonb := p->'map'; r public.invoice_item_maps; rl text; old public.invoice_item_maps;
 v_reuse boolean := false;
begin
 rl := public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 if coalesce((m->>'auto_post')::boolean,false) and not coalesce((m->>'verified')::boolean,false) then raise exception 'bad_value'; end if;
 if coalesce((m->>'auto_post')::boolean,false) and rl not in ('ceo','gm')
    and not (m ? 'id' and coalesce((select auto_post from public.invoice_item_maps where id=(m->>'id')::uuid), false)) then raise exception 'forbidden'; end if;
 -- the same lock as linking (one change of the mapping table at a time: a link taken back is used again by one of them only)
 perform pg_advisory_xact_lock(hashtext('invoice_vendor_rules'));
 -- A link taken back (2026-10-18) is changed only by linking it again: here it is refused, or (a new mapping with the same key)
 -- used again with the values given.
 if not (m ? 'id') then
  select * into old from public.invoice_item_maps x where x.vendor_key=m->>'vendor_key' and x.retired_at is not null
   and coalesce(x.store_id,'')=coalesce(m->>'store_id','') and coalesce(x.vendor_item_code,'')=coalesce(m->>'vendor_item_code','')
   and coalesce(x.alias_key,'')=coalesce(m->>'alias_key','') and x.spec_key=coalesce(m->>'spec_key','') and x.purchase_unit=coalesce(m->>'purchase_unit','') for update;
  if old.id is not null then m := m || jsonb_build_object('id', old.id, 'version', old.version); v_reuse := true; end if;
 end if;
 if m ? 'id' then
  update public.invoice_item_maps set ingredient_code=m->>'ingredient_code', count_unit=m->>'count_unit', count_per_purchase=(m->>'count_per_purchase')::numeric,
   base_unit=m->>'base_unit', base_per_purchase=(m->>'base_per_purchase')::numeric, verified=coalesce((m->>'verified')::boolean,false),
   verified_by=case when coalesce((m->>'verified')::boolean,false) then actor::text end, verified_at=case when coalesce((m->>'verified')::boolean,false) then now() end,
   auto_post=coalesce((m->>'auto_post')::boolean,false), note=m->>'note', version=version+1, updated_at=now(), retired_at=null, retired_by=null,
   -- a link made by linking that accounting changes here becomes accounting's own (a Head Chef / AM no longer changes it)
   source=case when source='review' then 'manual' else source end
  where id=(m->>'id')::uuid and version=(m->>'version')::int and (retired_at is null or v_reuse) returning * into r;
  if r.id is null then raise exception 'conflict'; end if;
 else
  insert into public.invoice_item_maps(vendor_key, store_id, vendor_item_code, alias_key, spec_key, purchase_unit, ingredient_code, count_unit,
   count_per_purchase, base_unit, base_per_purchase, verified, verified_by, verified_at, auto_post, source, note)
  values(m->>'vendor_key', m->>'store_id', m->>'vendor_item_code', m->>'alias_key', coalesce(m->>'spec_key',''), coalesce(m->>'purchase_unit',''),
   m->>'ingredient_code', m->>'count_unit', (m->>'count_per_purchase')::numeric, m->>'base_unit', (m->>'base_per_purchase')::numeric,
   coalesce((m->>'verified')::boolean,false), case when coalesce((m->>'verified')::boolean,false) then actor::text end,
   case when coalesce((m->>'verified')::boolean,false) then now() end, coalesce((m->>'auto_post')::boolean,false), coalesce(m->>'source','manual'), m->>'note')
  returning * into r;
 end if;
 perform public.invoice_event(null, null, actor::text, 'map_saved', to_jsonb(r));
 return to_jsonb(r);
end $$;

-- ---------------------------------------------------------------- 3) who may link
-- A vendor item code as the intake compares it (invoice/dedupe.mjs codeKey: NFKC, trimmed, upper case). Null for none.
create or replace function public.invoice_code_key(p text) returns text
language sql immutable security invoker set search_path=public,pg_temp as $$
 select nullif(upper(btrim(normalize(coalesce(p,''), NFKC), E' \t\n\r\f\v')), '');
$$;

-- Still an AM / a Head Chef (or Corporate Chef), and in service, in the employee master (退職 or OS off: refused). Read only.
create or replace function public.invoice_link_hr_ok(p_emp text, p_role text) returns boolean
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare x jsonb; v_role text; v_title text;
begin
 if coalesce(p_emp,'') = '' or to_regclass('public.employees') is null then return false; end if;
 execute 'select to_jsonb(e) from public.employees e where e.id::text = $1 limit 1' into x using p_emp;
 if x is null then return false; end if;
 if coalesce(nullif(x->'data'->>'status',''), x->>'status', '') = '退職' then return false; end if;
 if coalesce(x->'data'->'osDisabled' = 'true'::jsonb, false) then return false; end if;
 v_role := coalesce(nullif(x->>'role',''), x->'data'->>'role', '');
 v_title := btrim(coalesce(nullif(x->>'title',''), x->'data'->>'title', ''));
 if p_role = 'am' then return v_role = 'am' or v_title = 'Area Manager'; end if;
 if p_role = 'chef' then return v_role = 'chef' or v_title in ('Head Chef','Corporate Chef'); end if;
 return false;
end $$;

-- The role a signed-in person links with, or null: accounting, 事務Crew, GM, CEO (manager_auth, as the rest of the intake), or a
-- Head Chef / AM account (invoice_link_members) that the employee master still says is one.
create or replace function public.invoice_link_role(p_actor uuid) returns text
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare r text; m public.invoice_link_members;
begin
 if p_actor is null then return null; end if;
 r := public.invoice_actor_role(p_actor);
 if r is not null then return r; end if;
 select * into m from public.invoice_link_members where user_id=p_actor and enabled;
 if m.user_id is null or not public.invoice_link_hr_ok(m.emp_id, m.role) then return null; end if;
 return m.role;
end $$;

-- Who the signed-in person is here (the screen keeps the sign-in on the device only for the employee it belongs to).
create or replace function public.invoice_link_whoami(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; rl text; v_emp text;
begin
 rl := public.invoice_link_role(actor);
 if rl is null then return jsonb_build_object('role', null, 'emp_id', null); end if;
 if rl in ('am','chef') then select emp_id into v_emp from public.invoice_link_members where user_id=actor and enabled;
 else select emp_id::text into v_emp from public.manager_auth where user_id=actor; end if;
 return jsonb_build_object('role', rl, 'emp_id', v_emp);
end $$;

-- ---------------------------------------------------------------- 4) what the screen shows
-- The lines of the invoices and credit memos (to check and posted; purchases with a vendor), newest first, and of some vendors only
-- when p.vendor_keys is given. Values as text, as stored. A page of p.limit (20000 at most) from p.offset: the function reads page
-- by page until a page is not full, so no line is left out without saying so.
create or replace function public.invoice_link_lines(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; v_keys text[];
begin
 if actor is null then raise exception 'actor_required'; end if;
 if public.invoice_link_role(actor) is null then raise exception 'forbidden'; end if;
 if jsonb_typeof(p->'vendor_keys') = 'array' then v_keys := array(select jsonb_array_elements_text(p->'vendor_keys')); end if;
 return (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
  select l.id, l.doc_id, l.line_no, l.item_code, l.raw_name, l.spec, l.spec_key, l.purchase_unit, l.qty::text qty, l.unit_price::text unit_price,
   l.amount_cents, l.map_id, l.ingredient_code, l.count_unit, l.count_per_purchase::text count_per_purchase, l.base_unit,
   l.base_per_purchase::text base_per_purchase, l.reasons, d.store_id, d.vendor_key, d.status, d.doc_type,
   coalesce(d.effective_date, d.invoice_date) as day
  from public.invoice_lines l join public.invoice_docs d on d.id=l.doc_id
  where d.status in ('review','posted') and d.doc_type in ('invoice','credit_memo') and d.posting_kind='purchase' and d.vendor_key is not null
   and (v_keys is null or d.vendor_key = any(v_keys))
  order by coalesce(d.effective_date, d.invoice_date) desc nulls last, l.doc_id, l.line_no
  limit least(greatest(coalesce((p->>'limit')::int, 20000), 1), 20000) offset greatest(coalesce((p->>'offset')::int, 0), 0)) x);
end $$;

-- What the screen shows besides the lines (the function reads those page by page with invoice_link_lines).
create or replace function public.invoice_link_data(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; rl text; v_people jsonb := '{}';
begin
 if actor is null then raise exception 'actor_required'; end if;
 rl := public.invoice_link_role(actor);
 if rl is null then raise exception 'forbidden'; end if;
 -- The names of the people who linked or marked (the employee whose account it is). Nothing else of the employee master.
 if to_regclass('public.employees') is not null then
  begin
   execute $q$ select coalesce(jsonb_object_agg(q.u, q.nm), '{}'::jsonb) from (
     select a.user_id::text u, to_jsonb(e)->>'name' nm from public.manager_auth a join public.employees e on e.id::text = a.emp_id::text
     union all select m.user_id::text, to_jsonb(e)->>'name' from public.invoice_link_members m join public.employees e on e.id::text = m.emp_id) q
     where coalesce(q.nm, '') <> '' $q$ into v_people;
  exception when others then v_people := '{}';
  end;
 end if;
 return jsonb_build_object('role', rl,
  'maps', (select coalesce(jsonb_agg(to_jsonb(m) order by m.vendor_key, m.updated_at desc), '[]') from (select * from public.invoice_item_maps order by updated_at desc limit 20000) m),
  'marks', (select coalesce(jsonb_agg(to_jsonb(k)), '[]') from public.invoice_link_marks k where k.state <> 'none'),
  'vendors', (select coalesce(jsonb_agg(jsonb_build_object('vendor_key', v.vendor_key, 'display_name', v.display_name, 'food_kind', v.food_kind,
     'merged_into', v.merged_into) order by v.display_name), '[]') from public.invoice_vendor_rules v),
  'people', coalesce(v_people, '{}'));
end $$;

-- ---------------------------------------------------------------- 5) link, take back, mark
-- p.links: [{ vendor_key, vendor_item_code | alias_key (+ spec_key), ingredient_code, map_id, version, note }], 300 at most.
-- One item = the vendor-wide links of the vendor's item code, or else of the printed name with its pack (as the intake finds them).
-- map_id/version: the link the screen showed (changed in place); none: the item had no link (a new one, or the item's link taken
-- back before, used again). The screen being out of date is a conflict. A Head Chef / AM changes only links made by linking or not
-- verified yet (accounting's own verified mappings stay as they are). The master codes must be in the current master.
create or replace function public.invoice_link_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; rl text; e jsonb; v public.invoice_vendor_rules; m public.invoice_item_maps; r public.invoice_item_maps;
 v_codes text[]; n int; v_code text; v_alias text; v_spec text; v_ing text; v_prev jsonb; out jsonb := '[]';
begin
 if actor is null then raise exception 'actor_required'; end if;
 rl := public.invoice_link_role(actor);
 if rl is null then raise exception 'forbidden'; end if;
 if jsonb_typeof(p->'links') is distinct from 'array' or jsonb_array_length(p->'links') = 0 or jsonb_array_length(p->'links') > 300 then raise exception 'bad_value'; end if;
 -- the same lock as the other writes of vendors and their names (one change of the mapping table at a time)
 perform pg_advisory_xact_lock(hashtext('invoice_vendor_rules'));
 v_codes := array(select distinct x->>'ingredient_code' from jsonb_array_elements(p->'links') x);
 if exists(select 1 from unnest(v_codes) c where coalesce(c,'') = '' or length(c) > 64) then raise exception 'bad_value'; end if;
 if to_regclass('public.ingredients') is null then raise exception 'not_found'; end if;
 execute 'select count(distinct q.c) from (select to_jsonb(i)->>''code'' c from public.ingredients i) q where q.c = any($1)' into n using v_codes;
 if n <> cardinality(v_codes) then raise exception 'unknown_ingredient'; end if;
 for e in select * from jsonb_array_elements(p->'links') loop
  v_code := public.invoice_code_key(e->>'vendor_item_code');
  v_alias := nullif(e->>'alias_key', '');
  v_spec := case when v_code is null then coalesce(e->>'spec_key', '') else '' end;
  v_ing := e->>'ingredient_code';
  if (v_code is null) = (v_alias is null) or length(coalesce(v_alias,'')) > 300 or length(v_spec) > 200 or length(coalesce(v_code,'')) > 100 then raise exception 'bad_value'; end if;
  select * into v from public.invoice_vendor_rules where vendor_key=e->>'vendor_key';
  if v.vendor_key is null then raise exception 'not_found'; end if;
  if v.merged_into is not null then raise exception 'merged'; end if;
  m := null;
  if nullif(e->>'map_id','') is not null then
   select * into m from public.invoice_item_maps where id=(e->>'map_id')::uuid for update;
   if m.id is null or m.version is distinct from (e->>'version')::int or m.retired_at is not null or m.vendor_key <> v.vendor_key or m.store_id is not null
      or not (case when v_code is not null then public.invoice_code_key(m.vendor_item_code) = v_code
               else m.alias_key = v_alias and m.spec_key = v_spec end) then raise exception 'conflict'; end if;
   if rl in ('am','chef') and m.verified and m.source <> 'review' then raise exception 'forbidden'; end if;
  else
   -- the screen showed no link: there must still be none
   if exists(select 1 from public.invoice_item_maps x where x.vendor_key=v.vendor_key and x.store_id is null and x.retired_at is null
      and (case when v_code is not null then public.invoice_code_key(x.vendor_item_code) = v_code else x.alias_key = v_alias and x.spec_key = v_spec end)) then
    raise exception 'conflict';
   end if;
   -- the item's link taken back before is used again (the same row: the mapping table keeps one row per key)
   select * into m from public.invoice_item_maps x where x.vendor_key=v.vendor_key and x.store_id is null and x.retired_at is not null
    and coalesce(x.vendor_item_code,'') = coalesce(v_code,'') and coalesce(x.alias_key,'') = coalesce(v_alias,'') and x.spec_key = v_spec and x.purchase_unit = ''
    for update;
  end if;
  v_prev := case when m.id is null then null else to_jsonb(m) end;
  if m.id is not null then
   update public.invoice_item_maps set ingredient_code=v_ing, verified=true, verified_by=actor::text, verified_at=now(),
    auto_post=case when m.ingredient_code = v_ing and m.retired_at is null then m.auto_post else false end, source='review',
    note=coalesce(nullif(e->>'note',''), m.note), retired_at=null, retired_by=null, version=version+1, updated_at=now()
   where id=m.id returning * into r;
  else
   insert into public.invoice_item_maps(vendor_key, store_id, vendor_item_code, alias_key, spec_key, purchase_unit, ingredient_code, verified, verified_by, verified_at,
    auto_post, source, note)
   values(v.vendor_key, null, v_code, case when v_code is null then v_alias end, v_spec, '', v_ing, true, actor::text, now(), false, 'review', nullif(e->>'note',''))
   returning * into r;
  end if;
  perform public.invoice_event(null, null, actor::text, 'map_linked', jsonb_build_object('map', to_jsonb(r), 'prev', v_prev, 'role', rl));
  out := out || jsonb_build_array(to_jsonb(r));
 end loop;
 return jsonb_build_object('maps', out, 'role', rl);
end $$;

-- p.maps: [{ id, version }], 300 at most. A Head Chef / AM takes back only links made by linking or not verified yet.
create or replace function public.invoice_link_retire(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; rl text; e jsonb; m public.invoice_item_maps; r public.invoice_item_maps; out jsonb := '[]';
begin
 if actor is null then raise exception 'actor_required'; end if;
 rl := public.invoice_link_role(actor);
 if rl is null then raise exception 'forbidden'; end if;
 if jsonb_typeof(p->'maps') is distinct from 'array' or jsonb_array_length(p->'maps') = 0 or jsonb_array_length(p->'maps') > 300 then raise exception 'bad_value'; end if;
 perform pg_advisory_xact_lock(hashtext('invoice_vendor_rules'));
 for e in select * from jsonb_array_elements(p->'maps') loop
  select * into m from public.invoice_item_maps where id=(e->>'id')::uuid for update;
  if m.id is null or m.version is distinct from (e->>'version')::int or m.retired_at is not null then raise exception 'conflict'; end if;
  if rl in ('am','chef') and m.verified and m.source <> 'review' then raise exception 'forbidden'; end if;
  update public.invoice_item_maps set retired_at=now(), retired_by=actor::text, auto_post=false, version=version+1, updated_at=now()
  where id=m.id returning * into r;
  perform public.invoice_event(null, null, actor::text, 'map_retired', jsonb_build_object('map', to_jsonb(r), 'prev', to_jsonb(m), 'role', rl));
  out := out || jsonb_build_array(to_jsonb(r));
 end loop;
 return jsonb_build_object('maps', out, 'role', rl);
end $$;

-- p.marks: [{ vendor_key, vendor_item_code | alias_key (+ spec_key), state, version, note }], 300 at most. version: the mark the
-- screen showed (none: the item had none). 'none' clears a mark (the row stays as a record).
create or replace function public.invoice_link_mark(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; rl text; e jsonb; k public.invoice_link_marks; r public.invoice_link_marks;
 v_code text; v_alias text; v_spec text; out jsonb := '[]';
begin
 if actor is null then raise exception 'actor_required'; end if;
 rl := public.invoice_link_role(actor);
 if rl is null then raise exception 'forbidden'; end if;
 if jsonb_typeof(p->'marks') is distinct from 'array' or jsonb_array_length(p->'marks') = 0 or jsonb_array_length(p->'marks') > 300 then raise exception 'bad_value'; end if;
 perform pg_advisory_xact_lock(hashtext('invoice_vendor_rules'));
 for e in select * from jsonb_array_elements(p->'marks') loop
  v_code := public.invoice_code_key(e->>'vendor_item_code');
  v_alias := nullif(e->>'alias_key', '');
  v_spec := case when v_code is null then coalesce(e->>'spec_key', '') else '' end;
  if (v_code is null) = (v_alias is null) or coalesce(e->>'state','') not in ('excluded','new_item','later','included','none')
     or length(coalesce(e->>'note','')) > 300 or length(coalesce(v_alias,'')) > 300 or length(v_spec) > 200 then raise exception 'bad_value'; end if;
  if not exists(select 1 from public.invoice_vendor_rules where vendor_key=e->>'vendor_key') then raise exception 'not_found'; end if;
  select * into k from public.invoice_link_marks x where x.vendor_key=e->>'vendor_key' and coalesce(x.vendor_item_code,'') = coalesce(v_code,'')
   and coalesce(x.alias_key,'') = coalesce(case when v_code is null then v_alias end,'') and x.spec_key = v_spec for update;
  if k.id is not null then
   if k.version is distinct from coalesce((e->>'version')::int, case when k.state = 'none' then k.version end) then raise exception 'conflict'; end if;
   update public.invoice_link_marks set state=e->>'state', note=nullif(e->>'note',''), version=version+1, by_actor=actor::text, by_role=rl, at=now()
   where id=k.id returning * into r;
  else
   if nullif(e->>'version','') is not null then raise exception 'conflict'; end if;
   insert into public.invoice_link_marks(vendor_key, vendor_item_code, alias_key, spec_key, state, note, by_actor, by_role)
   values(e->>'vendor_key', v_code, case when v_code is null then v_alias end, v_spec, e->>'state', nullif(e->>'note',''), actor::text, rl)
   returning * into r;
  end if;
  perform public.invoice_event(null, null, actor::text, 'link_marked', jsonb_build_object('mark', to_jsonb(r), 'prev', case when k.id is null then null else to_jsonb(k) end));
  out := out || jsonb_build_array(to_jsonb(r));
 end loop;
 return jsonb_build_object('marks', out, 'role', rl);
end $$;

-- ---------------------------------------------------------------- 6) the lines follow the links
-- p.updates: [{ line_id, from_map, unit_price, purchase_unit, map_id, ingredient_code, count_unit, count_per_purchase, base_unit,
--   base_per_purchase, price_per_count, price_per_base, reasons }], 1000 at most, as the function worked them out with the links in use
-- (invoice/link.mjs: the intake's own mapping step), and maps_fp: the vendor's links in use as the function read them (their ids and
-- versions). Under the lock of the mapping table, a line whose vendor's links changed since (linked again, taken back, a conversion
-- changed: Codex P2 on PR #77), or that changed since it was read (its link, unit price, purchase unit or any other reason), or whose
-- invoice is being changed now, is passed over, never fails the others: the next action or そろえる does it with the links as they are.
-- Only the link and the reasons about it change. The line's price per purchase unit is its unit price when it has a
-- link. A posted line's active price history row is voided and a new one written when the line is clean (invoice_price_insert).
-- No amount, version, posting, reconciliation or QuickBooks row of an invoice changes.
create or replace function public.invoice_link_apply(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; rl text; u jsonb; l public.invoice_lines; d public.invoice_docs; mp public.invoice_item_maps;
 map_codes text[] := array['unmapped','map_ambiguous','map_unverified','mode_review_item','spec_changed','unit_mismatch','unit_unverified','no_price_ref','price_jump'];
 v_new_map uuid; v_new_code text; v_same boolean; v_fps jsonb := '{}'; v_fp text; n int := 0; v_prices int := 0; v_skipped int := 0; v_voided int := 0; v_docs jsonb := '{}';
 v_months text[] := '{}'; v_doc uuid;
 -- the line reasons that keep a line from giving a price (the same list as invoice_price_insert)
 no_price text[] := array['catch_weight','line_math','zero_price','negative_line','line_value_missing','line_qty_price_missing','line_amount_missing',
  'unit_mismatch','unit_unverified','spec_changed','map_ambiguous','unmapped'];
begin
 if actor is null then raise exception 'actor_required'; end if;
 rl := public.invoice_link_role(actor);
 if rl is null then raise exception 'forbidden'; end if;
 if jsonb_typeof(p->'updates') is distinct from 'array' or jsonb_array_length(p->'updates') > 1000 then raise exception 'bad_value'; end if;
 -- the lock of the mapping table first (nothing else is held yet): no link changes until this is done
 perform pg_advisory_xact_lock(hashtext('invoice_vendor_rules'));
 -- invoices locked in one order (the invoice, then its line); an invoice someone is changing now is passed over (never waited for while
 -- this holds the lock of the mapping table)
 for u in select e.value from jsonb_array_elements(p->'updates') e
   left join public.invoice_lines il on il.id = nullif(e.value->>'line_id','')::uuid
   order by il.doc_id, il.line_no loop
  select doc_id into v_doc from public.invoice_lines where id=nullif(u->>'line_id','')::uuid;
  if v_doc is null then v_skipped := v_skipped + 1; continue; end if;
  d := null;
  select * into d from public.invoice_docs where id=v_doc for update skip locked;
  if d.id is null then v_skipped := v_skipped + 1; continue; end if;
  select * into l from public.invoice_lines where id=(u->>'line_id')::uuid for update;
  if jsonb_typeof(u->'reasons') is distinct from 'array' then raise exception 'bad_value'; end if;
  -- an invoice left on a vendor merged into another (a closed month's, or one kept apart) is not linked here: its vendor's links moved
  if d.status not in ('review','posted') or d.doc_type not in ('invoice','credit_memo') or d.posting_kind <> 'purchase' or d.vendor_key is null
     or exists(select 1 from public.invoice_vendor_rules v where v.vendor_key=d.vendor_key and v.merged_into is not null)
     or l.map_id is distinct from nullif(u->>'from_map','')::uuid
     or l.unit_price::text is distinct from (u->>'unit_price') or l.purchase_unit is distinct from (u->>'purchase_unit') then
   v_skipped := v_skipped + 1; continue;
  end if;
  -- the vendor's links in use are the ones the function worked the update out with
  if not (v_fps ? d.vendor_key) then
   select encode(sha256(convert_to(coalesce(string_agg(m.id::text || ':' || m.version, ',' order by m.id::text collate "C"), ''), 'UTF8')), 'hex') into v_fp
   from public.invoice_item_maps m where m.vendor_key=d.vendor_key and m.retired_at is null;
   v_fps := v_fps || jsonb_build_object(d.vendor_key, v_fp);
  end if;
  if (v_fps->>d.vendor_key) is distinct from (u->>'maps_fp') then v_skipped := v_skipped + 1; continue; end if;
  -- only the reasons about the link change: a line whose other reasons changed meanwhile (a correction) is passed over
  if (select coalesce(array_agg(distinct c order by c), '{}') from jsonb_array_elements_text(l.reasons) c where not (c = any(map_codes)))
     is distinct from (select coalesce(array_agg(distinct c order by c), '{}') from jsonb_array_elements_text(u->'reasons') c where not (c = any(map_codes))) then
   v_skipped := v_skipped + 1; continue;
  end if;
  v_new_map := nullif(u->>'map_id','')::uuid;
  if v_new_map is not null then
   select * into mp from public.invoice_item_maps where id=v_new_map;
   if mp.id is null or mp.retired_at is not null or mp.vendor_key <> d.vendor_key or (mp.store_id is not null and mp.store_id <> d.store_id)
      or mp.ingredient_code is distinct from u->>'ingredient_code' then v_skipped := v_skipped + 1; continue; end if;
  end if;
  v_new_code := case when v_new_map is null then null else mp.ingredient_code end;
  -- the price history is written again only when what it records changes (the link, its code or its conversion); a change of the
  -- reasons alone keeps a posted line's row, voids it when the line may no longer give a price, or writes one when it now may
  v_same := l.map_id is not distinct from v_new_map and l.ingredient_code is not distinct from v_new_code
   and l.count_unit is not distinct from (case when v_new_map is null then null else u->>'count_unit' end)
   and l.base_unit is not distinct from (case when v_new_map is null then null else u->>'base_unit' end)
   and l.count_per_purchase is not distinct from (case when v_new_map is null then null else (u->>'count_per_purchase')::numeric end)
   and l.base_per_purchase is not distinct from (case when v_new_map is null then null else (u->>'base_per_purchase')::numeric end);
  if d.status = 'posted' and (not v_same or (u->'reasons') ?| no_price or (v_new_map is not null and not mp.verified)) then
   update public.invoice_price_history set status='voided', voided_by=actor::text, voided_at=now(), void_reason='link'
   where line_id=l.id and status='active';
   get diagnostics n = row_count; v_voided := v_voided + n;
  end if;
  update public.invoice_lines set map_id=v_new_map,
   ingredient_code=case when v_new_map is null then null else mp.ingredient_code end,
   count_unit=case when v_new_map is null then null else u->>'count_unit' end,
   count_per_purchase=case when v_new_map is null then null else (u->>'count_per_purchase')::numeric end,
   base_unit=case when v_new_map is null then null else u->>'base_unit' end,
   base_per_purchase=case when v_new_map is null then null else (u->>'base_per_purchase')::numeric end,
   price_per_purchase=case when v_new_map is null then null else l.unit_price end,
   price_per_count=case when v_new_map is null then null else (u->>'price_per_count')::numeric end,
   price_per_base=case when v_new_map is null then null else (u->>'price_per_base')::numeric end,
   prev_price=case when v_same then l.prev_price end,
   reasons=(select coalesce(jsonb_agg(distinct c), '[]') from jsonb_array_elements_text(u->'reasons') c)
  where id=l.id;
  -- the invoice's own list of reasons follows the line's (the reasons about the link of this line only)
  update public.invoice_docs set reasons=(
    select coalesce(jsonb_agg(r), '[]') from jsonb_array_elements(d.reasons) r
    where not ((r->>'code') = any(map_codes) and r->>'line_no' = l.line_no::text))
   || (select coalesce(jsonb_agg(jsonb_build_object('code', c, 'line_no', l.line_no)), '[]')
       from (select distinct c from jsonb_array_elements_text(u->'reasons') c where c = any(map_codes)) q)
  where id=d.id;
  if d.status = 'posted' and v_new_map is not null and not exists(select 1 from public.invoice_price_history h where h.line_id=l.id and h.status='active')
     and public.invoice_price_insert(d.id, l.id, actor::text, 'link') then v_prices := v_prices + 1; end if;
  v_docs := jsonb_set(v_docs, array[d.id::text], coalesce(v_docs->d.id::text, '[]'::jsonb) || to_jsonb(l.line_no));
  v_months := v_months || to_char(coalesce(d.invoice_date, d.effective_date), 'YYYY-MM');
 end loop;
 for v_doc in select k::uuid from jsonb_object_keys(v_docs) k loop
  perform public.invoice_event(v_doc, null, actor::text, 'link_applied', jsonb_build_object('lines', v_docs->v_doc::text, 'role', rl));
 end loop;
 return jsonb_build_object('lines', (select count(*) from jsonb_each(v_docs) e, jsonb_array_elements(e.value)), 'prices', v_prices, 'voided', v_voided,
  'skipped', v_skipped, 'doc_ids', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(v_docs) k),
  'months', (select coalesce(jsonb_agg(distinct m), '[]') from unnest(v_months) m where m is not null));
end $$;

do $$ declare f text; begin
 foreach f in array array['invoice_code_key(text)','invoice_link_hr_ok(text,text)','invoice_link_role(uuid)','invoice_link_whoami(jsonb)',
   'invoice_link_lines(jsonb)','invoice_link_data(jsonb)','invoice_link_save(jsonb)','invoice_link_retire(jsonb)','invoice_link_mark(jsonb)',
   'invoice_link_apply(jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;
