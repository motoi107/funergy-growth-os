-- 新しい業者を決める（Moto 2026-10-16 ③「インボイス取り込みで、新しい業者を検知した場合に、統合（読み間違い等で）か新規登録かを選択して
-- 選べるようにしたい」・UI案52 決めてほしいこと 9〜11 はすべて A）。このファイルは Invoice取込の分（画面はアプリ v1089）。
--
-- Changes (the screen and the function invoice-intake do the rest):
--   invoice_vendor_register : a new vendor from an invoice whose printed vendor name is no vendor's (accounting, 事務Crew, GM, CEO:
--                             10A). It takes the printed name as one of its names; a name some vendor has already is refused and
--                             that vendor is named (the screen offers the merge instead). The invoices waiting with the name (9A)
--                             are returned to be worked out again with the vendor.
--   invoice_vendor_waiting  : the vendors a printed name belongs to now and the invoices waiting with it (nothing is changed)
--   invoice_vendor_merge_into : the printed name merged into a vendor that exists, through invoice_vendor_merge (業者の統合,
--                             20261022090000), after checking under the same lock that nothing else is merged
--   invoice_vendor_merge    : (replaced) the invoices waiting because their printed name was no vendor's get the kept vendor
--                             in the merge itself, and the merge records them (moved.unknown); they come first among the
--                             invoices to work out again
--   invoice_vendor_unmerge  : (replaced) taking a merge back makes those invoices wait for a vendor again, unless they were posted,
--                             given another vendor or a person chose their vendor since (Codex P2 on PR #72)
-- The new functions are for the service role only (the replaced ones keep who may run them). No invoice, line, vendor, setting
-- or Drive file is changed by running this file. Running it twice changes nothing.

do $$ begin
 if to_regprocedure('public.invoice_vendor_merge(jsonb)') is null or to_regprocedure('public.invoice_vendor_final(text)') is null then
  raise exception '先に 20261022090000_invoice_vendor_merge.sql（業者の統合）を流してください（この SQL はそのあとに流します）';
 end if;
end $$;

-- 新しい業者を決める (Moto 2026-10-16・UI案52 ③ 9A・10A・11A): an invoice whose printed vendor name is no vendor's becomes a new
-- vendor's (accounting, 事務Crew, GM, CEO). The vendor is called p.vendor.display_name (the printed name, or the name a person
-- typed) and takes the printed name (p.printed) as one of its names when it differs, so a later invoice printed with it is this
-- vendor; it starts in review mode like every new vendor. A name some vendor has already (its own or one of its names; also a
-- key in use) is not registered: { ok:false, taken } names that vendor, for the screen to offer the merge instead (業者の統合).
-- One writer at a time with the other vendor writes (invoice_vendor_save, invoice_edit's name learning, invoice_vendor_merge).
-- The invoices waiting for a person with either name (vendor not chosen, in review), in months not closed, and the one on screen
-- (p.doc_id, if it is waiting) are returned for the caller to work out again with the new vendor (as a person's correction would).
create or replace function public.invoice_vendor_register(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; v jsonb := p->'vendor';
 v_key text; v_name text; v_kind text; v_printed text; v_doc uuid; v_keys text[]; v_aliases text[] := '{}';
 v_closed text := public.invoice_setting('rules')->>'closed_through';
 t record; r record; v_ids uuid[] := '{}'; v_months text[] := '{}'; v_left int := 0;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 if jsonb_typeof(v) is distinct from 'object' then raise exception 'bad_value'; end if;
 v_key := v->>'vendor_key'; v_name := btrim(coalesce(v->>'display_name', '')); v_kind := v->>'food_kind';
 v_printed := nullif(btrim(coalesce(p->>'printed', '')), '');
 if coalesce(v_key, '') !~ '^[A-Za-z0-9_.:@-]{1,80}$' or length(v_name) = 0 or length(v_name) > 200 or length(coalesce(v_printed, '')) > 200
    or v_kind is null or v_kind not in ('food','nonfood') then raise exception 'bad_value'; end if;
 if coalesce(p->>'doc_id', '') <> '' then
  if p->>'doc_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_value'; end if;
  v_doc := (p->>'doc_id')::uuid;
 end if;
 v_keys := array(select distinct k from (select nullif(btrim(regexp_replace(lower(normalize(x, NFKC)), '\s+', ' ', 'g')), '') k
   from unnest(array[v_name, v_printed]) x) q where k is not null);
 perform pg_advisory_xact_lock(hashtext('invoice_vendor_rules'));
 select x.vendor_key, x.display_name, x.merged_into into t from public.invoice_vendor_rules x where x.vendor_key=v_key;
 if found then
  return jsonb_build_object('ok', false, 'taken', jsonb_build_object('why', 'key', 'vendor_key', coalesce(public.invoice_vendor_final(t.vendor_key), t.vendor_key),
   'display_name', (select y.display_name from public.invoice_vendor_rules y where y.vendor_key=coalesce(public.invoice_vendor_final(t.vendor_key), t.vendor_key)),
   'name', t.display_name));
 end if;
 select x.vendor_key, x.display_name, a.n into t from public.invoice_vendor_rules x, unnest(array[x.display_name] || x.aliases) a(n)
 where x.merged_into is null and nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') = any(v_keys)
 order by (a.n = x.display_name) desc, x.display_name, x.vendor_key limit 1;
 if found then
  return jsonb_build_object('ok', false, 'taken', jsonb_build_object('why', 'name', 'vendor_key', t.vendor_key, 'display_name', t.display_name, 'name', t.n));
 end if;
 if v_printed is not null and nullif(btrim(regexp_replace(lower(normalize(v_printed, NFKC)), '\s+', ' ', 'g')), '')
    is distinct from nullif(btrim(regexp_replace(lower(normalize(v_name, NFKC)), '\s+', ' ', 'g')), '') then v_aliases := array[v_printed]; end if;
 insert into public.invoice_vendor_rules(vendor_key, display_name, aliases, food_kind, auto_post, verified_by, verified_at)
 values(v_key, v_name, v_aliases, v_kind, false, actor::text, now());
 for r in select d.id, (d.id = v_doc) here, to_char(coalesce(d.invoice_date, d.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM') ym
  from public.invoice_docs d join public.invoice_files f on f.id=d.file_id
  where d.vendor_key is null and d.status='review'
   and (d.id = v_doc or nullif(btrim(regexp_replace(lower(normalize(coalesce(d.vendor_raw, ''), NFKC)), '\s+', ' ', 'g')), '') = any(v_keys))
  order by (d.id = v_doc) desc, d.created_at, d.id
 loop
  if not coalesce(r.here, false) and v_closed is not null and r.ym <= v_closed then v_left := v_left + 1; continue; end if;
  v_ids := v_ids || r.id; v_months := v_months || r.ym;
 end loop;
 perform public.invoice_event(v_doc, null, actor::text, 'vendor_registered', jsonb_build_object('vendor_key', v_key, 'display_name', v_name,
  'printed', v_printed, 'food_kind', v_kind, 'docs', cardinality(v_ids), 'closed_left', v_left));
 return jsonb_build_object('ok', true, 'vendor', (select to_jsonb(x) from public.invoice_vendor_rules x where x.vendor_key=v_key),
  'doc_ids', to_jsonb(v_ids), 'closed_left', v_left, 'months', to_jsonb(array(select distinct m from unnest(v_months) m where m is not null order by 1)));
end $$;

-- The vendors a printed name belongs to now (vendors not merged into another one), and the invoices waiting for a person with
-- that name (vendor not chosen, in review; also one a merge gave the vendor that was not worked out again yet, beyond what one
-- call works out: it still says no vendor has its name), in months not closed, and the one on screen (p.doc_id, if it is
-- waiting). For an invoice read before its name became a vendor's (a name added in the settings, or merged or registered on
-- another screen): the caller gives them the vendor when exactly one has the name. Nothing is changed here.
create or replace function public.invoice_vendor_waiting(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; v_name text := btrim(coalesce(p->>'name', '')); v_k text; v_doc uuid;
 v_closed text := public.invoice_setting('rules')->>'closed_through'; r record; v_ids uuid[] := '{}'; v_months text[] := '{}'; v_left int := 0;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 if length(v_name) = 0 or length(v_name) > 200 then raise exception 'bad_value'; end if;
 if coalesce(p->>'doc_id', '') <> '' then
  if p->>'doc_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_value'; end if;
  v_doc := (p->>'doc_id')::uuid;
 end if;
 v_k := nullif(btrim(regexp_replace(lower(normalize(v_name, NFKC)), '\s+', ' ', 'g')), '');
 for r in select d.id, (d.id = v_doc) here, to_char(coalesce(d.invoice_date, d.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM') ym
  from public.invoice_docs d join public.invoice_files f on f.id=d.file_id
  where ((d.vendor_key is null and d.status='review') or (d.status='review' and d.reasons @> '[{"code":"vendor_unknown"}]'::jsonb))
   and (d.id = v_doc or nullif(btrim(regexp_replace(lower(normalize(coalesce(d.vendor_raw, ''), NFKC)), '\s+', ' ', 'g')), '') = v_k)
  order by (d.id = v_doc) desc, d.created_at, d.id
 loop
  if not coalesce(r.here, false) and v_closed is not null and r.ym <= v_closed then v_left := v_left + 1; continue; end if;
  v_ids := v_ids || r.id; v_months := v_months || r.ym;
 end loop;
 return jsonb_build_object(
  'vendors', (select coalesce(jsonb_agg(jsonb_build_object('vendor_key', x.vendor_key, 'display_name', x.display_name, 'food_kind', x.food_kind) order by x.display_name, x.vendor_key), '[]')
   from public.invoice_vendor_rules x where x.merged_into is null
    and exists(select 1 from unnest(array[x.display_name] || x.aliases) a(n) where nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') = v_k)),
  'doc_ids', to_jsonb(v_ids), 'closed_left', v_left, 'months', to_jsonb(array(select distinct m from unnest(v_months) m where m is not null order by 1)));
end $$;

-- 今の業者に統合 from an invoice (業者を決める): the printed name (p.name) joins the vendor p.vendor_key through 業者の統合
-- (invoice_vendor_merge: its record can be taken back from the vendor master). Under the lock of the vendor writes it is first
-- checked that nothing else is merged: the vendor is called by its name as it is now (a screen that read an older name never
-- renames it back), no other vendor has that name, and the printed name is no vendor's yet (if it is, the waiting invoices are
-- given that vendor instead: vendor_apply). Refused: { ok:false, why, vendors }. The invoice on screen (p.doc_id, if it is
-- waiting) gets the vendor and comes first among the invoices to work out again, also in a closed month (the merge records it,
-- like the others it gives the vendor, so taking it back makes it wait again); the waiting ones with the name in closed months
-- are counted (closed_left) and left as they are. p.preview: nothing is changed.
create or replace function public.invoice_vendor_merge_into(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; v_key text := p->>'vendor_key'; v_name text := btrim(coalesce(p->>'name', ''));
 v_prev boolean := coalesce((p->>'preview')::boolean, false); v_doc uuid; v_k text; v_tk text; tgt public.invoice_vendor_rules;
 v_closed text := public.invoice_setting('rules')->>'closed_through'; r jsonb; v_ids jsonb; v_left int := 0; v_here boolean := false; v_extra int := 0;
 hd public.invoice_docs;
begin
 perform public.invoice_require(actor, array['ceo','gm','office','office_crew']);
 if coalesce(v_key, '') !~ '^[A-Za-z0-9_.:@-]{1,80}$' or length(v_name) = 0 or length(v_name) > 200 then raise exception 'bad_value'; end if;
 if coalesce(p->>'doc_id', '') <> '' then
  if p->>'doc_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_value'; end if;
  v_doc := (p->>'doc_id')::uuid;
 end if;
 v_k := nullif(btrim(regexp_replace(lower(normalize(v_name, NFKC)), '\s+', ' ', 'g')), '');
 perform pg_advisory_xact_lock(hashtext('invoice_vendor_rules'));
 select * into tgt from public.invoice_vendor_rules where vendor_key=v_key;
 if tgt.vendor_key is null or tgt.merged_into is not null then
  return jsonb_build_object('ok', false, 'why', 'gone', 'vendors', '[]'::jsonb);
 end if;
 if exists(select 1 from public.invoice_vendor_rules x, unnest(array[x.display_name] || x.aliases) a(n) where x.merged_into is null and nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') = v_k) then
  return jsonb_build_object('ok', false, 'why', 'owned', 'vendors', (select coalesce(jsonb_agg(jsonb_build_object('vendor_key', x.vendor_key, 'display_name', x.display_name)
   order by x.display_name, x.vendor_key), '[]') from public.invoice_vendor_rules x where x.merged_into is null
    and exists(select 1 from unnest(array[x.display_name] || x.aliases) a(n) where nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') = v_k)));
 end if;
 v_tk := nullif(btrim(regexp_replace(lower(normalize(tgt.display_name, NFKC)), '\s+', ' ', 'g')), '');
 if exists(select 1 from public.invoice_vendor_rules x, unnest(array[x.display_name] || x.aliases) a(n) where x.merged_into is null and x.vendor_key <> tgt.vendor_key and nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') = v_tk) then
  return jsonb_build_object('ok', false, 'why', 'shared', 'vendors', (select coalesce(jsonb_agg(jsonb_build_object('vendor_key', x.vendor_key, 'display_name', x.display_name)
   order by x.display_name, x.vendor_key), '[]') from public.invoice_vendor_rules x where x.merged_into is null and x.vendor_key <> tgt.vendor_key
    and exists(select 1 from unnest(array[x.display_name] || x.aliases) a(n) where nullif(btrim(regexp_replace(lower(normalize(a.n, NFKC)), '\s+', ' ', 'g')), '') = v_tk)));
 end if;
 select count(*) into v_left from public.invoice_docs d join public.invoice_files f on f.id=d.file_id
 where d.vendor_key is null and d.status='review' and d.id is distinct from v_doc and nullif(btrim(regexp_replace(lower(normalize(coalesce(d.vendor_raw, ''), NFKC)), '\s+', ' ', 'g')), '') = v_k and v_closed is not null
  and to_char(coalesce(d.invoice_date, d.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM') <= v_closed;
 v_here := v_doc is not null and exists(select 1 from public.invoice_docs d where d.id=v_doc and d.vendor_key is null and d.status='review');
 -- The one on screen is given the vendor even when the merge would not reach it (a closed month): counted on top.
 if v_here and not exists(select 1 from public.invoice_docs d join public.invoice_files f on f.id=d.file_id where d.id=v_doc and nullif(btrim(regexp_replace(lower(normalize(coalesce(d.vendor_raw, ''), NFKC)), '\s+', ' ', 'g')), '') = v_k
    and not (v_closed is not null and to_char(coalesce(d.invoice_date, d.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM') <= v_closed)) then v_extra := 1; end if;
 r := public.invoice_vendor_merge(jsonb_build_object('actor', p->>'actor', 'to', tgt.display_name, 'names', jsonb_build_array(tgt.display_name, v_name),
  'preview', v_prev, 'group_id', p->'group_id'));
 if v_prev then return r || jsonb_build_object('ok', true, 'closed_left', v_left, 'here', v_here, 'waiting', coalesce((r->>'unknown')::int, 0) + v_extra); end if;
 -- The one on screen that the merge did not reach gets the vendor here, in the merge's record.
 if v_extra = 1 and r->>'merge_id' is not null then
  select * into hd from public.invoice_docs where id=v_doc and vendor_key is null and status='review' for update;
  if hd.id is not null then
   update public.invoice_docs set vendor_key=tgt.vendor_key, vendor_name=tgt.display_name, updated_at=now() where id=hd.id;
   perform public.invoice_event(hd.id, hd.file_id, actor::text, 'vendor_merged', jsonb_build_object('from', null, 'to', tgt.vendor_key, 'name', tgt.display_name));
   update public.invoice_vendor_merges set moved=jsonb_set(moved, '{unknown}', coalesce(moved->'unknown', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('id', hd.id, 'n', hd.vendor_name)))
   where id=(r->>'merge_id')::uuid;
  end if;
 end if;
 -- The invoices waiting for a vendor come first in what the merge returns (the vendor's own invoices whose name the merge brought
 -- up to date come after them), so they are the ones worked out within the limit of one call.
 v_ids := coalesce(r->'review_doc_ids', '[]'::jsonb);
 if v_here then
  v_ids := jsonb_build_array(v_doc::text) || coalesce((select jsonb_agg(e) from jsonb_array_elements(v_ids) e where e #>> '{}' <> v_doc::text), '[]'::jsonb);
 end if;
 return r || jsonb_build_object('ok', true, 'review_doc_ids', v_ids, 'closed_left', v_left, 'here', v_here, 'waiting', coalesce((r->>'unknown')::int, 0) + v_extra);
end $$;

do $$ declare f text; begin
 foreach f in array array['invoice_vendor_register(jsonb)','invoice_vendor_waiting(jsonb)','invoice_vendor_merge_into(jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;

-- 業者の統合（20261022090000）の 2 つを置き換える（v1089・Codex の PR #72 のレビューの P2）。
-- 業者の統合 (Moto 2026-10-15・UI案51 1A・2A・3A): the vendors any of the names belongs to become one. The kept vendor is the one
-- called by the name to keep (p.to), else the one that has it as a name, else the one with the most invoices; it is called p.to
-- from now on and takes every other name (its old name too), so a later invoice printed with any of them is that vendor. The
-- others are marked merged into it (not removed: the merge can be taken back). In months not closed (rules.closed_through) their
-- invoices (each page too), statement checks and product mappings (where the kept vendor has none for the same key) go to the
-- kept vendor, with its name; their price history goes to it in every month (it is what later prices are compared with). A
-- posted invoice whose number the kept vendor already has posted in the same store stays where it is and is listed (a double
-- posting for a person to look at). Invoices keep their version: no original is renamed again in Drive and nothing is sent to
-- QuickBooks again. Invoices waiting for a person because their printed name was no vendor's (in months not closed) get the kept
-- vendor here, and the merge records them (moved.unknown: taking it back makes them wait for a vendor again). Invoices waiting
-- for review are returned for the caller to work out again with the kept vendor (those that had no vendor first). p.food_kind
-- sets the kept vendor's kind (for invoices read from now on). p.preview: nothing is changed; what would change is returned.
create or replace function public.invoice_vendor_merge(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; v_to text := btrim(coalesce(p->>'to','')); v_prev boolean := coalesce((p->>'preview')::boolean, false);
 v_kind text := nullif(p->>'food_kind', ''); v_gid text := nullif(btrim(coalesce(p->>'group_id', '')), '');
 v_closed text := public.invoice_setting('rules')->>'closed_through';
 v_names text[]; v_keys text[]; v_tok text; v_match text[]; v_tk text; v_from text[]; tgt public.invoice_vendor_rules;
 v_have text[]; v_added text[] := '{}'; v_name text; v_k text; v_rename boolean; r record; v_id uuid;
 v_docs jsonb := '[]'; v_kept jsonb := '[]'; v_maps jsonb := '[]'; v_prices jsonb := '[]'; v_checks jsonb := '[]';
 v_review uuid[] := '{}'; v_unknown uuid[] := '{}'; v_unk jsonb := '[]'; v_months text[] := '{}'; v_pk text[] := '{}'; v_posted int := 0; v_left int := 0;
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
 -- Invoices waiting for a person because their printed name was no vendor's: they get the kept vendor, and what they had is kept
 -- in the record (moved.unknown) so that taking the merge back makes them wait for a vendor again (Codex P2 on PR #72).
 for r in select d.id, d.file_id, d.vendor_name, to_char(coalesce(d.invoice_date, d.effective_date, (f.ingested_at at time zone 'Pacific/Honolulu')::date), 'YYYY-MM') ym
  from public.invoice_docs d join public.invoice_files f on f.id=d.file_id
  where d.vendor_key is null and d.status='review'
   and nullif(btrim(regexp_replace(lower(normalize(coalesce(d.vendor_raw, ''), NFKC)), '\s+', ' ', 'g')), '') = any(v_keys)
  order by d.created_at, d.id
 loop
  if v_closed is not null and r.ym <= v_closed then continue; end if;
  if not v_prev then
   update public.invoice_docs set vendor_key=v_tk, vendor_name=v_to, updated_at=now() where id=r.id;
   perform public.invoice_event(r.id, r.file_id, actor::text, 'vendor_merged', jsonb_build_object('from', null, 'to', v_tk, 'name', v_to));
  end if;
  v_unk := v_unk || jsonb_build_object('id', r.id, 'n', r.vendor_name);
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
  jsonb_build_object('docs', v_docs, 'unknown', v_unk, 'maps', v_maps, 'prices', v_prices, 'checks', v_checks), v_kept, actor::text)
 returning id into v_id;
 perform public.invoice_event(null, null, actor::text, 'vendors_merged', jsonb_build_object('merge_id', v_id, 'to', v_tk, 'name', v_to, 'from', to_jsonb(v_from),
  'names', to_jsonb(v_names), 'docs', jsonb_array_length(v_docs), 'kept', v_kept, 'group_id', v_gid));
 return jsonb_build_object('ok', true, 'preview', false, 'merge_id', v_id, 'matched', cardinality(v_match),
  'target', jsonb_build_object('vendor_key', v_tk, 'display_name', v_to, 'before', tgt.display_name, 'auto_post', tgt.auto_post, 'food_kind', coalesce(v_kind, tgt.food_kind)),
  'from', to_jsonb(v_from), 'docs', jsonb_array_length(v_docs), 'review', cardinality(v_review), 'posted', v_posted, 'kept', v_kept, 'closed_left', v_left,
  'unknown', cardinality(v_unknown), 'maps', jsonb_array_length(v_maps), 'prices', jsonb_array_length(v_prices), 'checks', jsonb_array_length(v_checks),
  'added_aliases', to_jsonb(v_added), 'review_doc_ids', to_jsonb(v_unknown || v_review),
  'months', to_jsonb(array(select distinct m from unnest(v_months) m order by 1)));
end $$;

-- Takes a merge back: the merged vendors are vendors of their own again with their names, and what the merge moved goes back
-- where it was, as long as it is still with the kept vendor (an invoice corrected since stays). An invoice the merge gave the kept
-- vendor because its printed name was no vendor's waits for a vendor again, as long as it still waits for review with the kept
-- vendor and no person chose its vendor since (one posted, given another vendor or whose vendor a person chose stays; the rest
-- of what people corrected stays either way). Invoices read after the merge stay with the kept vendor. The latest merge of a
-- vendor is taken back first (a later one could rest on the names this one added). p.preview: nothing is changed; what would
-- change is returned.
create or replace function public.invoice_vendor_unmerge(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; v_prev boolean := coalesce((p->>'preview')::boolean, false);
 m public.invoice_vendor_merges; tgt public.invoice_vendor_rules; e jsonb; d public.invoice_docs;
 v_back int := 0; v_stay int := 0; v_unk int := 0; v_review uuid[] := '{}'; v_months text[] := '{}';
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
 for e in select x from jsonb_array_elements(coalesce(m.moved->'unknown', '[]'::jsonb)) x loop
  select * into d from public.invoice_docs where id=(e->>'id')::uuid for update;
  if d.id is null or d.vendor_key is distinct from m.to_key or d.status <> 'review'
     or coalesce((d.overrides->'vendor_key'->>'at')::timestamptz > m.merged_at, false) then v_stay := v_stay + 1; continue; end if;
  if not v_prev then
   update public.invoice_docs set vendor_key=null, vendor_name=e->>'n', updated_at=now() where id=d.id;
   perform public.invoice_event(d.id, d.file_id, actor::text, 'vendor_unmerged', jsonb_build_object('from', m.to_key, 'to', null));
  end if;
  v_unk := v_unk + 1;
  v_review := v_review || d.id;
  v_months := v_months || to_char(coalesce(d.invoice_date, d.effective_date,
   (select (f.ingested_at at time zone 'Pacific/Honolulu')::date from public.invoice_files f where f.id=d.file_id)), 'YYYY-MM');
 end loop;
 v_months := v_months || array(select y->>'ym' from jsonb_array_elements(coalesce(m.moved->'checks', '[]'::jsonb)) y);
 if v_prev then
  return jsonb_build_object('ok', true, 'preview', true, 'merge_id', m.id, 'docs', v_back, 'unknown', v_unk, 'stay', v_stay, 'review', cardinality(v_review),
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
  'docs', v_back, 'unknown', v_unk, 'stayed', v_stay));
 return jsonb_build_object('ok', true, 'preview', false, 'merge_id', m.id, 'docs', v_back, 'unknown', v_unk, 'stay', v_stay, 'review', cardinality(v_review),
  'from', to_jsonb(m.from_keys), 'review_doc_ids', to_jsonb(v_review),
  'months', to_jsonb(array(select distinct x from unnest(v_months) x where x is not null order by 1)));
end $$;
