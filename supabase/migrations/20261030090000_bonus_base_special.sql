-- v1116（Moto さん 10/29 18:42 HST「ボーナスの基準額支給と個人別特別報酬の追加」）：ボーナスの締め（v1109）に、人ごとの
--   ・支給方式「無条件で基準額」（評価の計算をせず、その人の基準額（日割り）をそのまま通常賞与額にする）
--   ・特別報酬（金額と理由・メモ。CEO・GM だけが足す・直す・消す）
-- を足す。Spec: docs/BONUS_BASE_SPECIAL_V1116_JA.md.
--
-- Moto さんの回答（10/29）：
--   ・基準額支給の人は原資から先に取る（原資の調整で減らさない）。残りの原資を、評価で決まる人に今までどおり同じ割合で配る。
--   ・特別報酬は原資の中から払う（減らさない）。足りなければ不足額に入り、「不足分を補う」で特別原資に足せる。特別報酬のためにほかの人の額を
--     減らさない（指示書 4）：評価で決まる人に配る残りは、基準額支給の額だけを引いたもの。
--
-- What this adds: one column (bc_quarters.pay: per quarter, per employee — base mode and the special reward with its reason, who and when),
-- two writes (bc_pay_mode: base mode on / off, CEO / GM like every other bonus-close write; bc_sp_save: the special reward, CEO / GM checked
-- by their own role, not by the write flag), a log (bc_events: pay_mode / sp / pay_reset with the values before and after), and new checks:
--   ・a saved version (bc_save) must carry exactly the base modes and special rewards of the quarter (bc_pay_match). An older app that does
--     not know them cannot drop them: its save is refused (pay_mismatch). A draft save never touches them.
--   ・bc_snap_check: final = regular + special for everyone; a base-mode person's regular amount is their raw (base) amount; the pool left
--     after the base amounts (R = max(0, cap − base)) is shared by the evaluated people as before (k = min(1, R / S_eval); $1 units; each
--     person the floor of raw × R / S_eval or one dollar more). Special rewards are paid on top and never reduce anyone else; they count in
--     the total (which may then be more than the cap — the shortfall the screen shows). With no base mode and no special reward this is
--     exactly the v1109 check.
--   ・修正を開始 / 修正をやめる put back the base modes and special rewards of the version the correction starts from — from the server's own
--     copy kept with the version (bc_versions.pay, Codex P2 on PR #106), never from the snapshot the app sent; and a version must carry the
--     same who / when (bAt, bBy, spAt, spBy) as the server's record, so a saved version cannot show made-up ones either.
--   ・a base-mode person's regular amount must be the prorated base of the grade periods the snapshot lists (bc_base_ok), so the total
--     cannot be any number (the grade base itself is in the app's settings).
--   ・nobody changes their own base mode or special reward (the same rule as the bonus edit screens: another CEO / GM does it). An account
--     whose manager_auth row has no emp_id cannot change them at all (no_emp: the server could not tell whether it is their own; Codex P2).
--   ・the chosen values of a person on base mode are kept in the version (keep) and come back to the draft, so 「通常の評価計算に戻す」 after
--     a version gives the same result as before.
-- Pay and special rewards can be changed only while the draft can be changed (no version yet, or while correcting) — the same rule as the
-- chosen values. Confirmed versions are never rewritten (a re-confirm after paid makes adjustment records, as before).
-- What this never does: pay, deduct or send anything to payroll; change evaluations, Career Score, settings or the bonus formula.

do $$ begin
 if to_regclass('public.bc_quarters') is null or to_regclass('public.bc_versions') is null then
  raise exception 'STOP: 先に 20261028090000_bonus_close.sql（v1109 のボーナスの締め）を流してください。何も変えていません';
 end if;
end $$;

alter table public.bc_quarters add column if not exists pay jsonb not null default '{}'::jsonb;
-- The server's base modes and special rewards at the time a version was saved (bc_quarters.pay, after bc_pay_match). 修正を開始 / 修正をやめる
-- put these back. Null for versions saved before v1116 (they have none).
alter table public.bc_versions add column if not exists pay jsonb;
-- An earlier draft of this file restored them from the snapshot the app sent (bc_pay_from_snap); not used any more.
drop function if exists public.bc_pay_from_snap(jsonb);

-- ---------------------------------------------------------------- small checks
create or replace function public.bc_emp(p jsonb) returns text
language plpgsql immutable security invoker set search_path=public,pg_temp as $$
begin
 if jsonb_typeof(p->'emp_id') is distinct from 'string' or (p->>'emp_id') !~ '^[A-Za-z0-9_.:@-]{1,64}$' then raise exception 'bad_value'; end if;
 return p->>'emp_id';
end $$;

-- A whole-dollar amount 0 … 100,000,000 (the bonus is paid in $1 units). nul: JSON null / missing is allowed (returns null).
create or replace function public.bc_amt(v jsonb, nul boolean) returns bigint
language plpgsql immutable security invoker set search_path=public,pg_temp as $$
begin
 if v is null or jsonb_typeof(v) = 'null' then
  if nul then return null; end if;
  raise exception 'bad_value';
 end if;
 if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{1,9}$' or (v #>> '{}')::bigint > 100000000 then raise exception 'bad_value'; end if;
 return (v #>> '{}')::bigint;
end $$;

create or replace function public.bc_now_txt() returns text
language sql stable security invoker set search_path=public,pg_temp as $$
 select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
$$;

-- Nobody changes their own base mode or special reward (the bonus edit screens never let anyone edit themselves either).
-- Fail closed (Codex P2 on PR #106): an account without an employee link (manager_auth.emp_id empty) cannot change them at all — the
-- server could not tell whether the person is their own.
create or replace function public.bc_not_self(a jsonb, id text) returns void
language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.manager_auth m where m.user_id = (a->>'uid')::uuid and coalesce(btrim(m.emp_id::text), '') <> '') then
  raise exception 'no_emp';
 end if;
 if exists(select 1 from public.manager_auth m where m.user_id = (a->>'uid')::uuid and btrim(m.emp_id::text) = id) then
  raise exception 'own_pay';
 end if;
end $$;

-- A base-mode person's regular amount is the prorated base of the grade periods the snapshot lists, not any number:
-- segs: [{from, to, days, gb, amount}] inside the quarter, not overlapping, days = to − from + 1, amount = gb × days ÷ the days of the
-- quarter rounded to whole dollars (a small margin for the app's floating point), raw = Σ amount. (The grade base gb itself is in the
-- app's settings; the server cannot check that number.)
create or replace function public.bc_base_ok(q text, pe jsonb, raw numeric) returns void
language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare qs date; qe date; qn integer; x jsonb; f date; t date; d integer; gb numeric; amt numeric; tot numeric := 0; last date := null;
begin
 qs := make_date(left(q, 4)::integer, (right(q, 1)::integer - 1) * 3 + 1, 1);
 qe := (qs + interval '3 months')::date - 1; qn := qe - qs + 1;
 if jsonb_typeof(pe->'segs') is distinct from 'array' or jsonb_array_length(pe->'segs') < 1 or jsonb_array_length(pe->'segs') > 12 then raise exception 'bad_amounts'; end if;
 for x in select value from jsonb_array_elements(pe->'segs') order by value->>'from' loop
  if jsonb_typeof(x) <> 'object' or coalesce(x->>'from', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(x->>'to', '') !~ '^\d{4}-\d{2}-\d{2}$'
     or jsonb_typeof(x->'days') <> 'number' or (x->>'days') !~ '^[0-9]{1,3}$' or jsonb_typeof(x->'gb') <> 'number' or jsonb_typeof(x->'amount') <> 'number' then
   raise exception 'bad_amounts';
  end if;
  begin f := (x->>'from')::date; t := (x->>'to')::date; exception when others then raise exception 'bad_amounts'; end;
  d := (x->>'days')::integer; gb := (x->>'gb')::numeric; amt := (x->>'amount')::numeric;
  if f < qs or t > qe or f > t or d <> t - f + 1 or (last is not null and f <= last) then raise exception 'bad_amounts'; end if;
  if gb < 0 or gb > 100000000 or amt <> trunc(amt) or abs(amt - gb * d / qn) > 0.500001 then raise exception 'bad_amounts'; end if;
  tot := tot + amt; last := t;
 end loop;
 if tot <> raw then raise exception 'bad_amounts'; end if;
end $$;

-- A version must carry exactly the base modes and special rewards of the quarter (the reason, and who set them and when, too: the app copies
-- them from the server's record, so a version cannot carry made-up ones — Codex P2 on PR #106). Someone with a base mode or a special
-- reward who is not in the version (left the list) stops the save as well: nothing is dropped silently.
create or replace function public.bc_pay_match(s jsonb, pay jsonb) returns void
language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare id text; pe jsonb; pm jsonb; k text; ssp numeric; psp numeric;
begin
 pay := coalesce(pay, '{}'::jsonb);
 for id in select jsonb_array_elements_text(s->'order') loop
  pe := coalesce(s->'people'->id, '{}'::jsonb); pm := coalesce(pay->id, '{}'::jsonb);
  if (coalesce(pe->>'mode', '') = 'base') <> (coalesce(pm->>'b', '') = 'true') then raise exception 'pay_mismatch'; end if;
  if coalesce(pe->>'mode', '') = 'base' and (coalesce(pe->>'bAt', '') <> left(coalesce(pm->>'bAt', ''), 40) or coalesce(pe->>'bBy', '') <> left(coalesce(pm->>'bBy', ''), 80)) then
   raise exception 'pay_mismatch';
  end if;
  ssp := case when jsonb_typeof(pe->'sp') = 'number' then (pe->>'sp')::numeric else 0 end;
  psp := case when jsonb_typeof(pm->'sp') = 'number' then (pm->>'sp')::numeric else 0 end;
  if ssp <> psp then raise exception 'pay_mismatch'; end if;
  if ssp > 0 and (coalesce(pe->>'spWhy', '') <> coalesce(pm->>'why', '') or coalesce(pe->>'spAt', '') <> left(coalesce(pm->>'at', ''), 40)
     or coalesce(pe->>'spBy', '') <> left(coalesce(pm->>'by', ''), 80)) then raise exception 'pay_mismatch'; end if;
 end loop;
 for k in select jsonb_object_keys(pay) loop
  if not (s->'order' ? k) and (coalesce(pay->k->>'b', '') = 'true' or (jsonb_typeof(pay->k->'sp') = 'number' and (pay->k->>'sp')::numeric > 0)) then
   raise exception 'pay_mismatch';
  end if;
 end loop;
end $$;

-- ---------------------------------------------------------------- the snapshot adds up (v1116: base mode and special rewards)
-- people[id]: raw (the regular amount before the pool: for base mode the base amount), final (= finals[id], what is paid), sp (special
-- reward, whole dollars, default 0), mode ('base' or none), reg (optional: final − sp), spWhy (≤ 300).
-- F = Σ raw of base mode, SP = Σ sp, S_eval = Σ raw of the others, S = Σ raw (everyone), paid = Σ final. R = max(0, cap − F).
-- Base mode: reg = raw. Evaluated: k = min(1, R / S_eval) (S_eval = 0 → k = 1, nothing); Σ reg = min(S_eval, floor(R)); each the floor of
-- raw × R / S_eval or one dollar more. Special rewards are on top (they do not reduce anyone). The total may be more than the cap (the
-- specified amounts are not reduced; the screen shows the shortfall).
create or replace function public.bc_snap_check(q text, s jsonb) returns integer
language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare ids text[]; id text; n integer; raw numeric; fin numeric; sp numeric; reg numeric; isb boolean; pe jsonb;
 sraw numeric := 0; spaid numeric := 0; f numeric := 0; spt numeric := 0; se numeric := 0; sreg numeric := 0;
 cap numeric; k double precision; tgt numeric; prov integer; ex numeric; r numeric;
begin
 if jsonb_typeof(s) is distinct from 'object' or length(s::text) > 6000000 then raise exception 'bad_snapshot'; end if;
 if coalesce(s->>'q','') <> q then raise exception 'bad_snapshot'; end if;
 if jsonb_typeof(s->'order') <> 'array' or jsonb_typeof(s->'people') <> 'object' or jsonb_typeof(s->'finals') <> 'object' then raise exception 'bad_snapshot'; end if;
 if jsonb_typeof(s->'unsel') <> 'number' or (s->>'unsel') <> '0' then raise exception 'unselected'; end if;
 if jsonb_typeof(s->'prov') <> 'number' or (s->>'prov') !~ '^[0-9]{1,6}$' then raise exception 'bad_snapshot'; end if;
 prov := (s->>'prov')::integer;
 if not public.bc_choices_ok(s->'choices', s->'bulk') then raise exception 'bad_snapshot'; end if;
 select array_agg(value #>> '{}') into ids from jsonb_array_elements(s->'order');
 ids := coalesce(ids, array[]::text[]);
 n := cardinality(ids);
 if n > 1000 or n <> (select count(distinct x) from unnest(ids) x) then raise exception 'bad_snapshot'; end if;
 if (select count(*) from jsonb_array_elements(s->'order') v where jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[A-Za-z0-9_.:@-]{1,64}$') > 0 then raise exception 'bad_snapshot'; end if;
 if (select count(*) from jsonb_object_keys(s->'people')) <> n or (select count(*) from jsonb_object_keys(s->'finals')) <> n then raise exception 'bad_snapshot'; end if;
 foreach id in array ids loop
  if not (s->'people' ? id) or not (s->'finals' ? id) then raise exception 'bad_snapshot'; end if;
  pe := s->'people'->id;
  if jsonb_typeof(pe) <> 'object' or jsonb_typeof(pe->'raw') <> 'number' or jsonb_typeof(s->'finals'->id) <> 'number' then raise exception 'bad_snapshot'; end if;
  if pe ? 'sp' and jsonb_typeof(pe->'sp') <> 'number' then raise exception 'bad_snapshot'; end if;
  if pe ? 'mode' and jsonb_typeof(pe->'mode') <> 'null' and coalesce(pe->>'mode', '') <> 'base' then raise exception 'bad_snapshot'; end if;
  if not public.bc_txt_ok(pe->'spWhy', 300, false) then raise exception 'bad_snapshot'; end if;
  raw := (pe->>'raw')::numeric; fin := (s->'finals'->>id)::numeric; sp := coalesce((pe->>'sp')::numeric, 0); isb := coalesce(pe->>'mode', '') = 'base';
  if raw <> trunc(raw) or fin <> trunc(fin) or sp <> trunc(sp) or raw < 0 or fin < 0 or sp < 0 or raw > 100000000 or sp > 100000000 then raise exception 'bad_amounts'; end if;
  reg := fin - sp;
  if reg < 0 or reg > raw then raise exception 'bad_amounts'; end if;
  if isb and reg <> raw then raise exception 'bad_amounts'; end if;
  if isb then perform public.bc_base_ok(q, pe, raw); end if;
  if jsonb_typeof(pe->'final') = 'number' and (pe->>'final')::numeric <> fin then raise exception 'bad_amounts'; end if;
  if pe ? 'reg' and (jsonb_typeof(pe->'reg') <> 'number' or (pe->>'reg')::numeric <> reg) then raise exception 'bad_amounts'; end if;
  sraw := sraw + raw; spaid := spaid + fin; spt := spt + sp;
  if isb then f := f + raw; else se := se + raw; sreg := sreg + reg; end if;
 end loop;
 -- keep: the chosen values of the people on base mode (not used in this version; they come back to the draft)
 if s ? 'keep' and jsonb_typeof(s->'keep') <> 'null' then
  if not public.bc_choices_ok(s->'keep', null) then raise exception 'bad_snapshot'; end if;
  for id in select jsonb_object_keys(s->'keep') loop
   if not (id = any(ids)) or coalesce(s->'people'->id->>'mode', '') <> 'base' or coalesce(s->'choices', '{}'::jsonb) ? id then raise exception 'bad_snapshot'; end if;
  end loop;
 end if;
 if jsonb_typeof(s->'S') <> 'number' or (s->>'S')::numeric <> sraw then raise exception 'bad_amounts'; end if;
 if jsonb_typeof(s->'paid') <> 'number' or (s->>'paid')::numeric <> spaid then raise exception 'bad_amounts'; end if;
 if s ? 'F' and (jsonb_typeof(s->'F') <> 'number' or (s->>'F')::numeric <> f) then raise exception 'bad_amounts'; end if;
 if s ? 'SP' and (jsonb_typeof(s->'SP') <> 'number' or (s->>'SP')::numeric <> spt) then raise exception 'bad_amounts'; end if;
 if s ? 'Se' and (jsonb_typeof(s->'Se') <> 'number' or (s->>'Se')::numeric <> se) then raise exception 'bad_amounts'; end if;
 if jsonb_typeof(s->'cap') <> 'number' or (s->>'cap')::numeric < 0 then raise exception 'no_pool'; end if;
 cap := (s->>'cap')::numeric;
 if round(cap, 2) <> cap then raise exception 'bad_amounts'; end if;
 if jsonb_typeof(s->'k') <> 'number' then raise exception 'bad_amounts'; end if;
 k := (s->>'k')::double precision;
 r := greatest(0::numeric, cap - f);   -- special rewards do not reduce the evaluated (指示書 4)
 -- the evaluated people share R: k = min(1, R / S_eval); S_eval = 0 → k = 1 and nothing. The total is the whole dollars of R, or S_eval.
 if se = 0 then
  if k <> 1 or sreg <> 0 then raise exception 'bad_amounts'; end if;
 else
  if abs(k - least(1::double precision, r::double precision / se::double precision)) > 1e-9 then raise exception 'bad_amounts'; end if;
  tgt := least(se, floor(r));
  if sreg <> tgt then raise exception 'bad_amounts'; end if;
  -- each evaluated person: the floor of raw × R / S_eval, or one dollar more (the app's largest remainders; a small margin for the app's
  -- floating point on very large amounts)
  if r < se then
   foreach id in array ids loop
    pe := s->'people'->id;
    if coalesce(pe->>'mode', '') = 'base' then continue; end if;
    raw := (pe->>'raw')::numeric; reg := (s->'finals'->>id)::numeric - coalesce((pe->>'sp')::numeric, 0); ex := raw * r / se;
    if reg < floor(ex - 0.000001) or reg > floor(ex + 0.000001) + 1 then raise exception 'bad_amounts'; end if;
   end loop;
  end if;
 end if;
 return prov;
end $$;

-- ---------------------------------------------------------------- reading: the quarter now also returns pay and its log
create or replace function public.bc_get(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare a jsonb := public.bc_actor(p); q text := public.bc_q(p); r public.bc_quarters; lv public.bc_versions; ef public.bc_versions;
begin
 select * into r from public.bc_quarters where quarter = q;
 select * into lv from public.bc_versions where quarter = q order by ver desc limit 1;
 select * into ef from public.bc_versions where quarter = q and status = 'effective';
 return jsonb_build_object('me', a, 'quarter', q, 'rev', coalesce(r.rev, 0), 'draft', coalesce(r.draft, '{}'::jsonb), 'draft_at', r.draft_at, 'draft_by', r.draft_by,
  'fixing', r.fixing, 'fix_at', r.fix_at, 'fix_by', r.fix_by,
  'pay', coalesce(r.pay, '{}'::jsonb),
  'paylog', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'at', x.at, 'by', x.by_name, 'role', x.by_role, 'action', x.action, 'detail', x.detail) order by x.id desc)
     from (select * from public.bc_events e where e.quarter = q and e.action in ('pay_mode','sp','pay_reset') order by e.id desc limit 500) x), '[]'::jsonb),
  'versions', coalesce((select jsonb_agg(public.bc_vrow(v) order by v.ver) from public.bc_versions v where v.quarter = q), '[]'::jsonb),
  'adjust', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'emp_id', x.emp_id, 'emp_name', x.emp_name, 'paid_ver', x.paid_ver, 'prev_ver', x.prev_ver, 'new_ver', x.new_ver,
     'prev_amount', x.prev_amount, 'new_amount', x.new_amount, 'diff', x.diff, 'state', x.state, 'memo', x.memo, 'made_at', x.made_at, 'made_by', x.made_by, 'done_at', x.done_at, 'done_by', x.done_by) order by x.id)
     from public.bc_adjust x where x.quarter = q), '[]'::jsonb),
  'latest', case when lv.ver is null then null else jsonb_build_object('ver', lv.ver, 'snap', lv.snap) end,
  'effective', case when ef.ver is null then null when ef.ver = lv.ver then jsonb_build_object('ver', ef.ver, 'same', true) else jsonb_build_object('ver', ef.ver, 'snap', ef.snap) end);
end $$;

-- ---------------------------------------------------------------- writing
-- 「無条件で基準額」／「通常の評価計算に戻す」 (CEO / GM: the same as every bonus-close write). No reason is required (one may be given).
-- amt0 / amt1: the regular amounts the screen showed before and after (for the log only; the server does not use them).
create or replace function public.bc_pay_mode(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare a jsonb := public.bc_writer(p); q text := public.bc_q(p); er integer := public.bc_rev(p); id text := public.bc_emp(p);
 md text := p->>'mode'; r public.bc_quarters; cur jsonb; was text; nx jsonb; a0 bigint; a1 bigint; nm text;
begin
 if md is null or md not in ('base','normal') then raise exception 'bad_value'; end if;
 if not (public.bc_txt_ok(p->'why', 300, false) and public.bc_txt_ok(p->'emp_name', 80, false)) then raise exception 'bad_value'; end if;
 a0 := public.bc_amt(p->'amt0', true); a1 := public.bc_amt(p->'amt1', true);
 perform public.bc_not_self(a, id);
 nm := left(coalesce(p->>'emp_name', ''), 80);
 r := public.bc_lock(q, er);
 if r.fixing is null and exists(select 1 from public.bc_versions v where v.quarter = q) then raise exception 'not_editable'; end if;
 cur := coalesce(r.pay->id, '{}'::jsonb);
 was := case when coalesce(cur->>'b', '') = 'true' then 'base' else 'normal' end;
 if was = md then return jsonb_build_object('ok', true, 'rev', r.rev, 'same', true); end if;
 if md = 'base' then nx := cur || jsonb_build_object('b', true, 'bAt', public.bc_now_txt(), 'bBy', a->>'name');
 else nx := cur - 'b' - 'bAt' - 'bBy'; end if;
 if nm <> '' then nx := nx || jsonb_build_object('nm', nm); end if;
 update public.bc_quarters set
   pay = case when coalesce(nx->>'b', '') = 'true' or (jsonb_typeof(nx->'sp') = 'number' and (nx->>'sp')::numeric > 0) then pay || jsonb_build_object(id, nx) else pay - id end,
   rev = rev + 1, updated_at = now()
 where quarter = q returning * into r;
 perform public.bc_event(q, a, 'pay_mode', jsonb_build_object('emp', id, 'name', nm, 'from', was, 'to', md, 'why', coalesce(p->>'why', ''), 'amt0', a0, 'amt1', a1));
 return jsonb_build_object('ok', true, 'rev', r.rev);
end $$;

-- 特別報酬 (CEO or GM only — checked by the role itself, so a wider write permission later never opens it). amount 0 removes it (and its
-- reason). The reason / memo may be empty.
create or replace function public.bc_sp_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare a jsonb := public.bc_actor(p); q text := public.bc_q(p); er integer := public.bc_rev(p); id text := public.bc_emp(p);
 amt bigint; w1 text; r public.bc_quarters; cur jsonb; a0 bigint; w0 text; nx jsonb; nm text;
begin
 if coalesce(a->>'role', '') not in ('ceo','gm') then raise exception 'forbidden'; end if;
 amt := public.bc_amt(p->'amount', false);
 perform public.bc_not_self(a, id);
 if not (public.bc_txt_ok(p->'why', 300, false) and public.bc_txt_ok(p->'emp_name', 80, false)) then raise exception 'bad_value'; end if;
 w1 := case when amt = 0 then '' else coalesce(p->>'why', '') end;
 nm := left(coalesce(p->>'emp_name', ''), 80);
 r := public.bc_lock(q, er);
 if r.fixing is null and exists(select 1 from public.bc_versions v where v.quarter = q) then raise exception 'not_editable'; end if;
 cur := coalesce(r.pay->id, '{}'::jsonb);
 a0 := case when jsonb_typeof(cur->'sp') = 'number' then (cur->>'sp')::bigint else 0 end;
 w0 := coalesce(cur->>'why', '');
 if a0 = amt and w0 = w1 then return jsonb_build_object('ok', true, 'rev', r.rev, 'same', true); end if;
 nx := cur - 'sp' - 'why' - 'at' - 'by';
 if amt > 0 then nx := nx || jsonb_build_object('sp', amt, 'why', w1, 'at', public.bc_now_txt(), 'by', a->>'name'); end if;
 if nm <> '' then nx := nx || jsonb_build_object('nm', nm); end if;
 update public.bc_quarters set
   pay = case when coalesce(nx->>'b', '') = 'true' or (jsonb_typeof(nx->'sp') = 'number' and (nx->>'sp')::numeric > 0) then pay || jsonb_build_object(id, nx) else pay - id end,
   rev = rev + 1, updated_at = now()
 where quarter = q returning * into r;
 perform public.bc_event(q, a, 'sp', jsonb_build_object('emp', id, 'name', nm, 'from', a0, 'to', amt, 'why0', w0, 'why1', w1));
 return jsonb_build_object('ok', true, 'rev', r.rev);
end $$;

-- Save a version (as v1109) — and it must carry the quarter's base modes and special rewards exactly (an older app cannot drop them).
create or replace function public.bc_save(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare a jsonb := public.bc_writer(p); q text := public.bc_q(p); er integer := public.bc_rev(p); r public.bc_quarters;
 kind text := p->>'kind'; s jsonb := p->'snap'; why text := coalesce(p->>'why', ''); ef public.bc_versions; ver integer; prov integer;
 paid public.bc_versions; x record; nv public.bc_versions;
begin
 if kind not in ('provisional','final') then raise exception 'bad_value'; end if;
 if length(why) > 500 then raise exception 'bad_value'; end if;
 r := public.bc_lock(q, er);
 select * into ef from public.bc_versions where quarter = q and status = 'effective';
 if kind = 'provisional' then
  if ef.ver is not null then raise exception 'not_editable'; end if;
  if r.fixing is null and exists(select 1 from public.bc_versions v where v.quarter = q) then raise exception 'not_editable'; end if;
 else
  if ef.ver is null or r.fixing is distinct from ef.ver then raise exception 'not_editable'; end if;
  if btrim(why) = '' then raise exception 'why_required'; end if;
 end if;
 prov := public.bc_snap_check(q, s);
 perform public.bc_pay_match(s, r.pay);   -- v1116
 select coalesce(max(v.ver), 0) + 1 into ver from public.bc_versions v where v.quarter = q;
 -- The server names the version (the app's copy of the effective final carries it).
 s := s || jsonb_build_object('lid', 'BC-' || q || '-v' || ver, 'vid', ver, 'kind', kind, 'lt', floor(extract(epoch from clock_timestamp()) * 1000)::bigint);
 if kind = 'final' then
  update public.bc_versions bv set status = 'replaced', replaced_at = now(), replaced_by = a->>'name' where bv.quarter = q and bv.ver = ef.ver;
 end if;
 insert into public.bc_versions(quarter, ver, kind, status, snap, n, total_raw, cap, k, paid_total, has_prov, base_ver, why, made_by, made_uid, made_role, pay)
 values (q, ver, kind, case when kind = 'final' then 'effective' else 'kept' end, s, jsonb_array_length(s->'order'), (s->>'S')::bigint, (s->>'cap')::numeric,
  (s->>'k')::double precision, (s->>'paid')::bigint, prov > 0, r.fixing, why, a->>'name', (a->>'uid')::uuid, a->>'role', coalesce(r.pay, '{}'::jsonb)) returning * into nv;   -- v1116: the server's pay
 -- Paid already: the differences become adjustment records against the previous effective final (paid amounts stay).
 select * into paid from public.bc_versions where quarter = q and paid_at is not null;
 if kind = 'final' and paid.ver is not null then
  for x in
   select coalesce(o.id, nn.id) as id, coalesce((ef.snap->'finals'->>coalesce(o.id, nn.id))::bigint, 0) as a0, coalesce((s->'finals'->>coalesce(o.id, nn.id))::bigint, 0) as a1,
     coalesce(s->'people'->coalesce(o.id, nn.id)->>'name', ef.snap->'people'->coalesce(o.id, nn.id)->>'name', '') as nm
   from (select jsonb_object_keys(ef.snap->'finals') as id) o full join (select jsonb_object_keys(s->'finals') as id) nn on nn.id = o.id
  loop
   if x.a1 <> x.a0 then
    insert into public.bc_adjust(quarter, emp_id, emp_name, paid_ver, prev_ver, new_ver, prev_amount, new_amount, diff, made_by)
    values (q, x.id, left(x.nm, 80), paid.ver, ef.ver, ver, x.a0, x.a1, x.a1 - x.a0, a->>'name');
   end if;
  end loop;
 end if;
 update public.bc_quarters set fixing = null, fix_at = null, fix_by = null,
  draft = jsonb_strip_nulls(jsonb_build_object('choices', case when jsonb_typeof(s->'keep') = 'object' then coalesce(s->'choices', '{}'::jsonb) || (s->'keep') else s->'choices' end,
   'bulk', s->'bulk')), draft_at = now(), draft_by = a->>'name', rev = rev + 1, updated_at = now()
 where quarter = q returning * into r;
 perform public.bc_event(q, a, 'save', jsonb_build_object('ver', ver, 'kind', kind, 'n', nv.n, 'S', nv.total_raw, 'paid', nv.paid_total, 'prov', prov, 'replaced', ef.ver,
   'F', s->'F', 'SP', s->'SP'));
 return jsonb_build_object('ok', true, 'rev', r.rev, 'ver', ver, 'lid', s->>'lid', 'lt', s->'lt');
end $$;

-- 支給額を確定: as v1109; the final keeps the provisional's copy of the base modes and special rewards (bc_versions.pay).
create or replace function public.bc_confirm(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare a jsonb := public.bc_writer(p); q text := public.bc_q(p); er integer := public.bc_rev(p); r public.bc_quarters; lv public.bc_versions; ver integer; s jsonb;
begin
 if jsonb_typeof(p->'ver') <> 'number' or (p->>'ver') !~ '^[0-9]{1,6}$' then raise exception 'bad_value'; end if;
 r := public.bc_lock(q, er);
 if r.fixing is not null then raise exception 'not_editable'; end if;
 if exists(select 1 from public.bc_versions v where v.quarter = q and v.kind = 'final') then raise exception 'not_editable'; end if;
 select * into lv from public.bc_versions bv where bv.quarter = q order by bv.ver desc limit 1;
 if lv.ver is null or lv.kind <> 'provisional' or lv.ver <> (p->>'ver')::integer then raise exception 'not_editable'; end if;
 if lv.has_prov and btrim(coalesce(p->>'why', '')) = '' then raise exception 'why_required'; end if;
 if length(coalesce(p->>'why', '')) > 500 then raise exception 'bad_value'; end if;
 ver := lv.ver + 1;
 s := lv.snap || jsonb_build_object('lid', 'BC-' || q || '-v' || ver, 'vid', ver, 'kind', 'final', 'from', lv.ver, 'lt', floor(extract(epoch from clock_timestamp()) * 1000)::bigint);
 insert into public.bc_versions(quarter, ver, kind, status, snap, n, total_raw, cap, k, paid_total, has_prov, base_ver, from_ver, why, made_by, made_uid, made_role, pay)
 values (q, ver, 'final', 'effective', s, lv.n, lv.total_raw, lv.cap, lv.k, lv.paid_total, lv.has_prov, lv.ver, lv.ver, coalesce(p->>'why', ''), a->>'name', (a->>'uid')::uuid, a->>'role',
  coalesce(lv.pay, '{}'::jsonb));   -- v1116: the provisional's copy (pay cannot change between a provisional and its confirm)
 update public.bc_quarters set rev = rev + 1, updated_at = now() where quarter = q returning * into r;
 perform public.bc_event(q, a, 'confirm', jsonb_build_object('ver', ver, 'from', lv.ver, 'prov', lv.has_prov));
 return jsonb_build_object('ok', true, 'rev', r.rev, 'ver', ver, 'lid', s->>'lid', 'lt', s->'lt');
end $$;

-- 修正を開始 / 確定版から修正: as v1109, and the base modes and special rewards start from that version (the server's copy, bc_versions.pay).
create or replace function public.bc_fix_start(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare a jsonb := public.bc_writer(p); q text := public.bc_q(p); er integer := public.bc_rev(p); r public.bc_quarters; b public.bc_versions; np jsonb; op jsonb;
begin
 r := public.bc_lock(q, er);
 if r.fixing is not null then raise exception 'not_editable'; end if;
 select * into b from public.bc_versions where quarter = q and status = 'effective';
 if b.ver is null then
  select * into b from public.bc_versions where quarter = q order by ver desc limit 1;
  if b.ver is null then raise exception 'not_editable'; end if;
 end if;
 op := coalesce(r.pay, '{}'::jsonb); np := coalesce(b.pay, '{}'::jsonb);
 update public.bc_quarters set fixing = b.ver, fix_at = now(), fix_by = a->>'name',
  draft = jsonb_strip_nulls(jsonb_build_object('choices', case when jsonb_typeof(b.snap->'keep') = 'object' then coalesce(b.snap->'choices', '{}'::jsonb) || (b.snap->'keep') else b.snap->'choices' end,
   'bulk', b.snap->'bulk')), draft_at = now(), draft_by = a->>'name',
  pay = np, rev = rev + 1, updated_at = now()
 where quarter = q returning * into r;
 perform public.bc_event(q, a, 'fix_start', jsonb_build_object('base', b.ver));
 if op is distinct from np then perform public.bc_event(q, a, 'pay_reset', jsonb_build_object('base', b.ver, 'why', 'fix_start', 'from', op, 'to', np)); end if;
 return jsonb_build_object('ok', true, 'rev', r.rev, 'fixing', b.ver);
end $$;

-- 修正をやめる: back to the version the correction started from (its chosen values; base modes and special rewards from bc_versions.pay).
create or replace function public.bc_fix_cancel(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare a jsonb := public.bc_writer(p); q text := public.bc_q(p); er integer := public.bc_rev(p); r public.bc_quarters; b public.bc_versions; np jsonb; op jsonb;
begin
 r := public.bc_lock(q, er);
 if r.fixing is null then raise exception 'not_editable'; end if;
 select * into b from public.bc_versions where quarter = q and ver = r.fixing;
 op := coalesce(r.pay, '{}'::jsonb); np := coalesce(b.pay, '{}'::jsonb);
 update public.bc_quarters set fixing = null, fix_at = null, fix_by = null,
  draft = jsonb_strip_nulls(jsonb_build_object('choices', case when jsonb_typeof(b.snap->'keep') = 'object' then coalesce(b.snap->'choices', '{}'::jsonb) || (b.snap->'keep') else b.snap->'choices' end,
   'bulk', b.snap->'bulk')), draft_at = now(), draft_by = a->>'name',
  pay = np, rev = rev + 1, updated_at = now()
 where quarter = q returning * into r;
 perform public.bc_event(q, a, 'fix_cancel', jsonb_build_object('base', b.ver));
 if op is distinct from np then perform public.bc_event(q, a, 'pay_reset', jsonb_build_object('base', b.ver, 'why', 'fix_cancel', 'from', op, 'to', np)); end if;
 return jsonb_build_object('ok', true, 'rev', r.rev);
end $$;

do $$ declare f text; begin
 foreach f in array array['bc_emp(jsonb)','bc_amt(jsonb,boolean)','bc_now_txt()','bc_not_self(jsonb,text)','bc_base_ok(text,jsonb,numeric)','bc_pay_match(jsonb,jsonb)','bc_snap_check(text,jsonb)',
  'bc_get(jsonb)','bc_pay_mode(jsonb)','bc_sp_save(jsonb)','bc_save(jsonb)','bc_confirm(jsonb)','bc_fix_start(jsonb)','bc_fix_cancel(jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  execute format('grant execute on function public.%s to service_role', f);
 end loop;
end $$;
