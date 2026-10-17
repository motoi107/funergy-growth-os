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
--                             20261022090000, unchanged), after checking under the same lock that nothing else is merged
-- The new functions are for the service role only. No invoice, line, vendor, setting or Drive file is changed by running this
-- file. Running it twice changes nothing.

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
-- that name (vendor not chosen, in review), in months not closed, and the one on screen (p.doc_id, if it is waiting). For an
-- invoice read before its name became a vendor's (a name added in the settings, or merged or registered on another screen): the
-- caller gives them the vendor when exactly one has the name. Nothing is changed here.
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
  where d.vendor_key is null and d.status='review'
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
-- waiting) comes first among the invoices to work out again, also in a closed month; the waiting ones with the name in closed
-- months are counted (closed_left) and left as they are. p.preview: nothing is changed.
create or replace function public.invoice_vendor_merge_into(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid := nullif(p->>'actor','')::uuid; v_key text := p->>'vendor_key'; v_name text := btrim(coalesce(p->>'name', ''));
 v_prev boolean := coalesce((p->>'preview')::boolean, false); v_doc uuid; v_k text; v_tk text; tgt public.invoice_vendor_rules;
 v_closed text := public.invoice_setting('rules')->>'closed_through'; r jsonb; v_ids jsonb; v_left int := 0; v_here boolean := false; v_extra int := 0;
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
