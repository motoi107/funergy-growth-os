-- v1202（段階 3 の残り・決めてほしいこと 8 の A「8B と一緒に経理レビューへ」・Moto さん 11/18）：紛失届をサーバーの申請へ。
-- 仕様：docs/UNIFIED_UI_V1191_JA.md の 25。
--
-- 【前】紛失届は端末の共通データ（lost_receipts）で、GM・CEO が今の画面で承認していた。経理は一覧を見るだけ。
-- 【いま】申請の種類 lost（番号 LR-…）。中身は今と同じ（買った日・店（業者）・金額・カードを使った人・品目・メモ。カードの番号は持たない）。
--   出せる人：ログインしたすべての人（今の画面と同じ・経費の申請の権限 wr_exp_kinds にはかけない）。店の決まりは経費と同じ。
--   承認：GM（承認・閲覧の共通ルールがあればそのルート＝ar_kinds に lost）→ 経理の確認で完了（事前経費と同じ・精算は無い）。重複の確かめは経費と同じ。
--   前の紛失届（lost_receipts）はサーバーに写さない（前の画面で、前からの申請中のものの承認・差し戻しだけ）。
--   SQL の段は 9（wr_stage）。アプリは段 9・関数 fn 14 のときだけ新しい紛失届を出す。
-- 中身は前の版の関数の写しに、lost を足しただけ（どの関数も 1 か所〜2 か所。生成：scripts/gen-wr-lost.py と同じ手順）。
-- 先に 20261209090000_approval_rules.sql（承認・閲覧の共通ルール）までを流してから。2 回流しても同じ。
-- 気をつけること：20261104090000・20261120090000・20261204090000・20261209090000 をあとで流し直すと lost が消える（この SQL をもう一度流す）。

do $$ begin
 if to_regprocedure('public.ar_kinds()') is null or to_regprocedure('public.wr_submit_exp(jsonb)') is null or to_regprocedure('public.wr_act_exp(jsonb)') is null
    or to_regprocedure('public.wr_actions_exp(jsonb,public.wr_requests)') is null or to_regprocedure('public.wr_next_v0(public.wr_requests)') is null
    or to_regprocedure('public.wr_can_submit(jsonb,text,text)') is null or to_regprocedure('public.wr_stage(jsonb)') is null then
  raise exception 'STOP: 先に承認・閲覧の共通ルールの SQL（20261209090000_approval_rules.sql）までを流してください（何も変えていません）';
 end if;
end $$;

alter table public.wr_requests drop constraint if exists wr_requests_kind_check;
alter table public.wr_requests add constraint wr_requests_kind_check check (kind in ('mileage','reimburse','expense_pre','skill','cs','tiprate',
  'budget','leave','shift','hire','resign','promo','tip_self','skill_self','prep','plan',
  'lost'));

create or replace function public.wr_prefix(p_kind text) returns text
language sql immutable security invoker set search_path = public, pg_temp as $$
 select case p_kind when 'mileage' then 'GS' when 'reimburse' then 'RB' when 'expense_pre' then 'EX' when 'skill' then 'SK' when 'cs' then 'CS' when 'tiprate' then 'TR'
  when 'budget' then 'BG' when 'leave' then 'LV' when 'shift' then 'SH' when 'hire' then 'HR' when 'resign' then 'RS' when 'promo' then 'LD'
  when 'tip_self' then 'TP' when 'skill_self' then 'SS' when 'prep' then 'PR' when 'plan' then 'MP' when 'lost' then 'LR' end;
$$;

create or replace function public.wr_norm(p_kind text, p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_date date; v_cents bigint; v_miles numeric; v_rate numeric; o jsonb := coalesce(p, '{}'::jsonb);
begin
 if jsonb_typeof(o) <> 'object' then raise exception 'bad_value'; end if;
 begin v_date := (o->>'date')::date; exception when others then raise exception 'bad_value'; end;
 if v_date is null or v_date < date '2020-01-01' or v_date > (timezone('Pacific/Honolulu', now()))::date + 366 then raise exception 'bad_value'; end if;
 if p_kind = 'mileage' then
  if jsonb_typeof(o->'one_way_miles') <> 'number' then raise exception 'bad_value'; end if;
  v_miles := round((o->>'one_way_miles')::numeric * case when (o->>'round_trip')::boolean then 2 else 1 end, 1);
  if v_miles <= 0 or v_miles > 2000 then raise exception 'bad_value'; end if;
  v_rate := public.wr_mileage_rate();
  if v_rate is null then raise exception 'no_rate'; end if;
  v_cents := round(v_miles * v_rate * 100);
  o := o || jsonb_build_object('miles', v_miles, 'rate', v_rate);
 elsif p_kind = 'reimburse' then
  if jsonb_typeof(o->'amount_cents') <> 'number' then raise exception 'bad_value'; end if;
  v_cents := (o->>'amount_cents')::bigint;
  if btrim(coalesce(o->>'payer', '')) = '' or btrim(coalesce(o->>'vendor', '')) = '' then raise exception 'bad_value'; end if;
 elsif p_kind = 'expense_pre' then
  if jsonb_typeof(o->'total_cents') <> 'number' then raise exception 'bad_value'; end if;
  v_cents := (o->>'total_cents')::bigint;
  if btrim(coalesce(o->>'purpose', '')) = '' then raise exception 'bad_value'; end if;
 elsif p_kind = 'lost' then   -- v1202：紛失届。店（業者）・カードを使った人は必ず。金額はセント
  if jsonb_typeof(o->'amount_cents') <> 'number' then raise exception 'bad_value'; end if;
  v_cents := (o->>'amount_cents')::bigint;
  if btrim(coalesce(o->>'vendor', '')) = '' or btrim(coalesce(o->>'cardholder', '')) = '' then raise exception 'bad_value'; end if;
 else raise exception 'bad_value';
 end if;
 if v_cents is null or v_cents <= 0 or v_cents > 100000000 then raise exception 'bad_value'; end if;
 return jsonb_build_object('payload', o, 'amount_cents', v_cents, 'use_date', v_date);
end $$;

create or replace function public.wr_can_submit(a jsonb, p_kind text, p_store text) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select (p_kind = 'lost' or coalesce(p_kind = any(public.wr_exp_kinds(a)), false))   -- v1202：紛失届はだれでも（今の画面と同じ）。店の決まりは経費と同じ
  and coalesce(p_store, '') <> '' and length(p_store) <= 30
  and ((a->>'role') in ('ceo','gm','office','office_crew') or p_store = any(public.wr_arr(a->'stores'))
       or ((a->>'role') = 'am' and p_store = any(public.wr_arr(a->'am_stores')))
       or (p_store = '---' and public.wr_exp_hq(a)));
$$;

create or replace function public.wr_submit_exp(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v_kind text := p->>'kind'; v_store text := p->>'store_id'; v_key text := p->>'client_key';
 n jsonb; v_dups text[]; v_reason text := nullif(btrim(coalesce(p->>'dup_reason', '')), ''); r public.wr_requests; v_now timestamptz := now(); v_rid uuid; v_ract text;
begin
 if v_key is null or v_key !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'bad_value'; end if;
 -- 同じ鍵が同時に 2 本来ても 1 本ずつ（2 本目は 1 本目の結果を返す）
 perform pg_advisory_xact_lock(hashtext('wr_key:' || v_key));
 select e.request_id, e.action into v_rid, v_ract from public.wr_events e where e.client_key = v_key;
 if v_rid is not null then
  select * into r from public.wr_requests x where x.id = v_rid;
  if v_ract <> 'submit' or not public.wr_is_owner(a, r) or r.kind <> coalesce(v_kind, '') then raise exception 'conflict'; end if;
  return public.wr_row(a, r) || jsonb_build_object('replay', true);
 end if;
 if not public.wr_live() then raise exception 'not_live'; end if;
 if v_kind not in ('mileage','reimburse','expense_pre','lost') then raise exception 'bad_value'; end if;   -- v1202：紛失届（lost）
 if not public.wr_can_submit(a, v_kind, v_store) then raise exception 'forbidden'; end if;
 if v_reason is not null and length(v_reason) > 400 then raise exception 'bad_value'; end if;
 n := public.wr_norm(v_kind, p->'payload');
 perform public.wr_dup_lock(v_kind, (n->>'use_date')::date, (n->>'amount_cents')::bigint);
 v_dups := public.wr_dups(v_kind, v_store, a->>'emp', a->>'name', (n->>'use_date')::date, (n->>'amount_cents')::bigint, null);
 if cardinality(v_dups) > 0 and v_reason is null then
  return jsonb_build_object('duplicate', (select coalesce(jsonb_agg(case when public.wr_visible(a, d) then jsonb_build_object('code', d.code, 'status', d.status,
    'requester_name', d.requester_name, 'amount_cents', d.amount_cents, 'use_date', d.use_date) else jsonb_build_object('code', d.code) end order by d.code), '[]'::jsonb)
    from public.wr_requests d where d.code = any(v_dups)));
 end if;
 insert into public.wr_requests(code, kind, status, store_id, requester_emp, requester_name, payload, amount_cents, use_date, dup_codes, dup_reason, submitted_at, created_at, updated_at)
  values (public.wr_new_code(v_kind, v_now), v_kind, 'pending', v_store, a->>'emp', a->>'name', n->'payload', (n->>'amount_cents')::bigint, (n->>'use_date')::date,
   v_dups, case when cardinality(v_dups) > 0 then v_reason end, v_now, v_now, v_now)
  returning * into r;
 insert into public.wr_versions(request_id, version, payload, amount_cents, use_date, by_emp, by_name, at)
  values (r.id, 1, r.payload, r.amount_cents, r.use_date, a->>'emp', a->>'name', v_now);
 insert into public.wr_events(request_id, at, action, from_status, to_status, version, rev, by_emp, by_name, by_role, note, client_key)
  values (r.id, v_now, 'submit', null, 'pending', 1, 1, a->>'emp', a->>'name', a->>'role', case when cardinality(v_dups) > 0 then '重複の候補：' || array_to_string(v_dups, ', ') || ' · 理由：' || v_reason end, v_key);
 return public.wr_row(a, r);
end $$;

create or replace function public.wr_act_exp(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v_act text := p->>'action'; v_key text := p->>'client_key'; v_note text := nullif(btrim(coalesce(p->>'note', '')), '');
 r public.wr_requests; v_rid uuid; v_ract text; v_from text; v_to text; v_can text[]; n jsonb; v_now timestamptz := now(); v_dups text[]; v_reason text;
 v_pd date; v_pm text; v_ver integer;
begin
 if v_key is null or v_key !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'bad_value'; end if;
 if v_note is not null and length(v_note) > 400 then raise exception 'bad_value'; end if;
 perform pg_advisory_xact_lock(hashtext('wr_key:' || v_key));
 select e.request_id, e.action into v_rid, v_ract from public.wr_events e where e.client_key = v_key;
 if v_rid is not null then
  select * into r from public.wr_requests x where x.id = v_rid;
  -- 同じ申請・同じ操作の鍵のときだけ「同じ 1 回」。ほかの操作・ほかの申請の鍵の使い回しは conflict（独立レビュー P3）
  if not public.wr_visible(a, r) or v_ract is distinct from v_act
     or not (coalesce(p->>'id', '') = r.id::text or coalesce(p->>'code', '') = r.code) then raise exception 'conflict'; end if;
  return public.wr_row(a, r) || jsonb_build_object('replay', true);
 end if;
 r := public.wr_find(a, p);
 select * into r from public.wr_requests x where x.id = r.id for update;
 if not (jsonb_typeof(p->'expect_rev') = 'number' and (p->>'expect_rev')::int = r.rev) then raise exception 'conflict'; end if;
 v_can := public.wr_actions(a, r);
 if v_act = 'pay' and r.status = 'checked' and cardinality(r.dup_codes) > 0 and r.dup_ok_at is null and not ('pay' = any(v_can)) and 'dup_ok' = any(v_can) then
  raise exception 'dup_unresolved';
 end if;
 if v_act is null or not (v_act = any(v_can)) then raise exception 'forbidden'; end if;
 if not public.wr_live() and v_act in ('edit','resubmit') then raise exception 'not_live'; end if;
 v_from := r.status; v_ver := r.version;
 if v_act in ('return','reject','undo','dup_ok') and v_note is null then raise exception 'reason_required'; end if;

 if v_act in ('edit','resubmit') then
  n := public.wr_norm(r.kind, p->'payload');
  v_reason := nullif(btrim(coalesce(p->>'dup_reason', '')), '');
  if v_reason is not null and length(v_reason) > 400 then raise exception 'bad_value'; end if;
  perform public.wr_dup_lock(r.kind, (n->>'use_date')::date, (n->>'amount_cents')::bigint);
  v_dups := public.wr_dups(r.kind, r.store_id, r.requester_emp, r.requester_name, (n->>'use_date')::date, (n->>'amount_cents')::bigint, r.id);
  if cardinality(v_dups) > 0 and v_reason is null and not (r.dup_reason is not null and r.dup_codes @> v_dups) then
   return jsonb_build_object('duplicate', (select coalesce(jsonb_agg(case when public.wr_visible(a, d) then jsonb_build_object('code', d.code, 'status', d.status,
     'requester_name', d.requester_name, 'amount_cents', d.amount_cents, 'use_date', d.use_date) else jsonb_build_object('code', d.code) end order by d.code), '[]'::jsonb)
     from public.wr_requests d where d.code = any(v_dups)));
  end if;
  v_ver := r.version + 1;
  update public.wr_requests set payload = n->'payload', amount_cents = (n->>'amount_cents')::bigint, use_date = (n->>'use_date')::date, version = v_ver,
    dup_codes = v_dups, dup_reason = case when cardinality(v_dups) = 0 then null else coalesce(v_reason, r.dup_reason) end,
    dup_ok_by = null, dup_ok_emp = null, dup_ok_at = null, dup_ok_note = null,
    status = 'pending', approved_by = null, approved_emp = null, approved_at = null, checked_by = null, checked_emp = null, checked_at = null,
    submitted_at = case when v_act = 'resubmit' then v_now else submitted_at end
   where id = r.id;
  insert into public.wr_versions(request_id, version, payload, amount_cents, use_date, by_emp, by_name, at, note)
   values (r.id, v_ver, n->'payload', (n->>'amount_cents')::bigint, (n->>'use_date')::date, a->>'emp', a->>'name', v_now, v_note);
  v_to := 'pending';
 elsif v_act = 'withdraw' then
  update public.wr_requests set status = 'withdrawn', closed_by = a->>'name', closed_at = v_now, close_reason = v_note where id = r.id;
  v_to := 'withdrawn';
 elsif v_act = 'approve' then
  update public.wr_requests set status = 'approved', approved_by = a->>'name', approved_emp = a->>'emp', approved_at = v_now where id = r.id;
  v_to := 'approved';
 elsif v_act = 'return' then
  -- 前の承認・確認は履歴（wr_events）に残し、出し直した版にはもう一度もらう
  update public.wr_requests set status = 'returned', returned_by = a->>'name', returned_at = v_now, return_reason = v_note,
    approved_by = null, approved_emp = null, approved_at = null where id = r.id;
  v_to := 'returned';
 elsif v_act = 'reject' then
  update public.wr_requests set status = 'rejected', closed_by = a->>'name', closed_at = v_now, close_reason = v_note where id = r.id;
  v_to := 'rejected';
 elsif v_act = 'check' then
  v_to := case when r.kind in ('expense_pre','lost') then 'done' else 'checked' end;   -- v1202：紛失届は経理の確認で完了（精算は無い）
  update public.wr_requests set status = v_to, checked_by = a->>'name', checked_emp = a->>'emp', checked_at = v_now where id = r.id;
 elsif v_act = 'pay' then
  begin v_pd := (p->>'pay_date')::date; exception when others then raise exception 'bad_value'; end;
  v_pm := nullif(btrim(coalesce(p->>'pay_method', '')), '');
  if v_pd is null or v_pd < date '2020-01-01' or v_pd > (timezone('Pacific/Honolulu', v_now))::date + 31 or v_pm is null or length(v_pm) > 60 then raise exception 'bad_value'; end if;
  -- 精算の前にもう一度重複を探す（出したあとに出た候補・同時の送信で見えなかった候補）。新しい候補があれば精算せず、印を付けて止める（#123 のレビュー P2）。
  perform public.wr_dup_lock(r.kind, r.use_date, r.amount_cents);
  v_dups := array(select x from unnest(public.wr_dups(r.kind, r.store_id, r.requester_emp, r.requester_name, r.use_date, r.amount_cents, r.id)) x
   where not (x = any(r.dup_codes)) order by x);
  if cardinality(v_dups) > 0 then
   update public.wr_requests set dup_codes = array(select y from unnest(r.dup_codes || v_dups) y group by y order by y),
     dup_ok_by = null, dup_ok_emp = null, dup_ok_at = null, dup_ok_note = null, rev = r.rev + 1, updated_at = v_now where id = r.id returning * into r;
   insert into public.wr_events(request_id, at, action, from_status, to_status, version, rev, by_emp, by_name, by_role, note)
    values (r.id, v_now, 'dup_found', r.status, r.status, r.version, r.rev, a->>'emp', a->>'name', a->>'role', '精算の前に重複の候補が見つかった：' || array_to_string(v_dups, ', '));
   return public.wr_row(a, r) || jsonb_build_object('dup_found', to_jsonb(v_dups));
  end if;
  -- 前の画面で精算済み（建て替えの支払済・ガソリン代の月末処理）になった前からの申請は、確かめてからでないと記録しない（二重に払わない）
  if r.legacy and public.wr_legacy_paid(r) and not coalesce(p->'legacy_ack' = 'true'::jsonb, false) then raise exception 'legacy_paid'; end if;
  update public.wr_requests set status = 'paid', paid_by = a->>'name', paid_emp = a->>'emp', paid_at = v_now, pay_date = v_pd, pay_method = v_pm where id = r.id;
  v_to := 'paid';
 elsif v_act = 'dup_ok' then
  update public.wr_requests set dup_ok_by = a->>'name', dup_ok_emp = a->>'emp', dup_ok_at = v_now, dup_ok_note = v_note where id = r.id;
  v_to := r.status;
 elsif v_act = 'undo' then
  if r.status = 'paid' then
   update public.wr_requests set status = 'checked', paid_by = null, paid_emp = null, paid_at = null, pay_date = null, pay_method = null where id = r.id; v_to := 'checked';
  elsif r.status in ('checked','done') then
   update public.wr_requests set status = 'approved', checked_by = null, checked_emp = null, checked_at = null where id = r.id; v_to := 'approved';
  else
   update public.wr_requests set status = 'pending', approved_by = null, approved_emp = null, approved_at = null where id = r.id; v_to := 'pending';
  end if;
 else raise exception 'forbidden';
 end if;

 update public.wr_requests set rev = r.rev + 1, updated_at = v_now where id = r.id returning * into r;
 insert into public.wr_events(request_id, at, action, from_status, to_status, version, rev, by_emp, by_name, by_role, note, client_key)
  values (r.id, v_now, v_act, v_from, v_to, v_ver, r.rev, a->>'emp', a->>'name', a->>'role', v_note, v_key);
 return public.wr_row(a, r);
end $$;

create or replace function public.wr_actions_exp(a jsonb, r public.wr_requests) returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare o text[] := '{}'; v_mine boolean := public.wr_is_mine(a, r); v_own boolean := public.wr_is_owner(a, r);
 v_dup boolean := cardinality(r.dup_codes) > 0 and r.dup_ok_at is null;
begin
 if r.kind not in ('mileage','reimburse','expense_pre','lost') then return o; end if;   -- v1202：紛失届（lost）
 -- 前からの申請も、社員 ID の分かるものは差し戻されたら本人が直して出し直す（同じ番号・版が上がる）。分からないものは差し戻せない（#123 のレビュー P2）。
 -- 前からの申請の本人は前の画面の名前から決めた（社員の表は公開の鍵で書ける）ので、承認する人が差し戻したときだけ直せる。承認待ちのまま直すのは不可（独立レビュー 272b159 の E）。
 if v_own and r.status = 'pending' and not r.legacy then o := o || 'edit'::text; end if;
 if v_own and r.status = 'returned' then o := o || 'resubmit'::text; end if;
 if v_own and r.status in ('pending','returned') then o := o || 'withdraw'::text; end if;
 if r.status = 'pending' and public.wr_can_approve(a, r) then
  o := o || 'approve'::text;
  if not r.legacy or r.requester_emp is not null then o := o || 'return'::text; end if;
  o := o || 'reject'::text;
 end if;
 if r.status = 'approved' and public.wr_is_acct(a) and not v_mine then
  o := o || 'check'::text;
  if not r.legacy or r.requester_emp is not null then o := o || 'return'::text; end if;
 end if;
 if r.status = 'checked' and r.kind in ('mileage','reimburse') and ((a->>'role') in ('ceo','gm') or public.wr_is_acct(a)) and not v_mine and not v_dup then
  o := o || 'pay'::text;
 end if;
 if v_dup and r.status in ('pending','approved','checked') and not v_mine
    and ((r.status = 'pending' and public.wr_can_approve(a, r)) or ((a->>'role') in ('ceo','gm') or public.wr_is_acct(a))) then
  o := o || 'dup_ok'::text;
 end if;
 -- 1 つ前に戻す：支払 → 経理（経理・事務Crew・GM・CEO）／経理の確認 → 承認（経理・事務Crew）／承認 → 承認待ち（GM・CEO）
 if not v_mine and ((r.status = 'paid' and ((a->>'role') in ('ceo','gm') or public.wr_is_acct(a)))
    or (r.status in ('checked','done') and r.kind in ('mileage','reimburse','expense_pre','lost') and public.wr_is_acct(a))
    or (r.status = 'approved' and (a->>'role') in ('ceo','gm'))) then
  o := o || 'undo'::text;
 end if;
 return o;
end $$;

create or replace function public.wr_actions(a jsonb, r public.wr_requests) returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare o text[] := public.wr_actions_v0(a, r); c boolean; v_gm boolean := (a->>'role') in ('ceo','gm'); v_mine boolean;
begin
 if not public.ar_on(r) or r.status <> 'pending' then return o; end if;
 -- 承認待ちの承認・差し戻し・却下・重複の確認は、ルートで決める（今までの「GM が残りの段を代わりに」はしない）
 o := array(select x from unnest(o) x where x not in ('approve','return','reject','dup_ok'));
 v_mine := public.wr_is_mine(a, r);
 c := public.ar_can_approve(a, r) is not null;
 if c then o := o || 'approve'::text; end if;
 if (c or v_gm) and not v_mine then
  if public.ar_can_return(r) then o := o || 'return'::text; end if;
  o := o || 'reject'::text;
 end if;
 if cardinality(r.dup_codes) > 0 and r.dup_ok_at is null and not v_mine and r.kind in ('mileage','reimburse','expense_pre','lost')
    and (c or v_gm or public.wr_is_acct(a)) then o := o || 'dup_ok'::text; end if;
 return o;
end $$;

create or replace function public.wr_next_v0(r public.wr_requests) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select case
  when public.wr_is_s2(r.kind) then case
    when r.status = 'pending' and r.step = 'am' then jsonb_build_object('step', 'approve', 'who', 'am', 'gm_too', true)
    when r.status = 'pending' then jsonb_build_object('step', 'approve', 'who', 'gm')
    when r.status = 'returned' then jsonb_build_object('step', 'fix', 'who', 'requester', 'name', r.requester_name)
    when r.status in ('approved','apply_error') then jsonb_build_object('step', 'apply', 'who', case when r.kind = 'leave' and r.approved_emp is not null
       and not exists (select 1 from public.manager_auth m where m.emp_id::text = r.approved_emp and m.role in ('ceo','gm')) then 'am' else 'gm' end,
       'name', r.approved_by)
    when r.status = 'acct' then jsonb_build_object('step', 'check', 'who', 'acct')
    else null end
  when r.kind in ('skill','cs','tiprate') then case
    when r.status = 'pending' then jsonb_build_object('step', 'approve', 'who', 'gm')
    when r.status = 'returned' then jsonb_build_object('step', 'fix', 'who', 'requester', 'name', r.requester_name)
    when r.status in ('approved','apply_error') then jsonb_build_object('step', 'apply', 'who', 'gm')
    else null end
  when r.status = 'pending' and r.kind = 'mileage' and public.wr_approver_am(r) is not null
   then jsonb_build_object('step', 'approve', 'who', 'am', 'name', public.wr_approver_am(r)->>'name')
  when r.status = 'pending' then jsonb_build_object('step', 'approve', 'who', 'gm')
  when r.status = 'returned' then jsonb_build_object('step', 'fix', 'who', 'requester', 'name', r.requester_name)
  when r.status = 'approved' and r.kind in ('mileage','reimburse','expense_pre','lost') then jsonb_build_object('step', 'check', 'who', 'acct')
  when r.status = 'checked' and r.kind in ('mileage','reimburse') then jsonb_build_object('step', 'pay', 'who', 'acct')
  else null end;
$$;

create or replace function public.ar_visible(a jsonb, r public.wr_requests) returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare rt jsonb := r.route; v_me text := a->>'emp'; v_cur integer; i integer; s jsonb; v_el text[]; v jsonb; v_from text; v_n integer; v_del boolean;
begin
 if public.wr_is_mine(a, r) then return true; end if;
 if (a->>'role') in ('ceo','gm') then return true; end if;                                       -- 4A
 if (a->>'role') = 'staff' and coalesce((a->>'grade')::int, 0) >= 4 and r.store_id = any(public.wr_arr(a->'stores')) then return true; end if;   -- 5A（店の G4 以上）
 if public.wr_is_acct(a) and rt ? 'final' and (r.kind in ('mileage','reimburse','expense_pre','lost') or public.wr_s2_acct(r.kind)) then return true; end if;   -- 6A（承認のあとの経理）
 if v_me is null or rt is null then return false; end if;
 if v_me = any(public.ar_signed(rt)) then return true; end if;
 v_cur := coalesce((rt->>'cur')::int, 0);
 v_n := jsonb_array_length(coalesce(rt->'stages', '[]'::jsonb));
 for i in 0 .. least(v_cur, v_n - 1) loop
  for s in select x from jsonb_array_elements(rt->'stages'->i->'slots') x loop
   v_el := public.ar_slot_elig(s, r, rt->>'self');
   if v_me = any(v_el) then return true; end if;
   if v_del is null then v_del := public.ar_has_delegate(v_me); end if;
   if v_del and exists (select 1 from unnest(v_el) f where public.ar_delegate_ok(v_me, f, r)) then return true; end if;
  end loop;
 end loop;
 for v in select x from jsonb_array_elements(coalesce(rt->'viewers', '[]'::jsonb)) x loop
  v_from := coalesce(v->>'from', 'submit');
  if v_from = 'submit' or (v_from = 'final' and rt ? 'final')
     or (v_from ~ '^stage:[1-5]$' and (rt ? 'final' or v_cur + 1 >= substr(v_from, 7)::int)) then
   if v_me = any(public.ar_slot_people(v->'who', r)) then return true; end if;
  end if;
 end loop;
 return false;
end $$;

create or replace function public.ar_kinds() returns text[]
language sql immutable security invoker set search_path = public, pg_temp as $$
 select array['mileage','reimburse','expense_pre','lost','skill','cs','tiprate']::text[] || public.wr_s2_kinds();
$$;

create or replace function public.wr_stage(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$ select jsonb_build_object('stage', 9) $$;

create or replace function public.wr_whoami(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v jsonb := public.wr_whoami_v0(p); s public.ar_settings;
begin
 select * into s from public.ar_settings where id = 1;
 return v || jsonb_build_object('ar', jsonb_strip_nulls(jsonb_build_object('live', coalesce(s.live, false), 'rev', coalesce(s.rev, 1), 'live_at', s.live_at,
  'lost_rule', exists (select 1 from public.ar_rules x where x.kind = 'lost' and x.status = 'active'),   -- v1202（Codex #207）
  'admin', (v->'me'->>'role') in ('ceo','gm'),
  'roles', (select jsonb_agg(distinct g.role) from public.ar_role_rows() g where g.emp_id = v->'me'->>'emp' and public.ar_emp_ok(g.emp_id)))));
end $$;

-- Codex #207/#209（P1）：紛失届の承認ルールは「下書き」だけを用意する（20261209090000 の初めの下書きと同じ形＝GM・CEO の 1 段・閲覧者は担当 AM と経理の 3 役・本人は GM）。
-- 有効にはしない（承認の経路は CEO・GM が 設定 › 承認・閲覧設定 で確かめて有効にする）。共通ルールで動かしているあいだ、有効にするまでアプリは新しい紛失届を出さない（今の紛失届の画面）。
-- もう lost の行があれば何もしない（2 回流しても同じ）。回数は今の作り方（ar_rule_rev_next）で。
do $$
declare
 v_gmo jsonb := jsonb_build_object('t', 'role', 'role', 'gm', 'scope', 'all');
 v_ceo jsonb := jsonb_build_object('t', 'role', 'role', 'ceo', 'scope', 'all');
 v_amo jsonb := jsonb_build_object('t', 'role', 'role', 'am', 'scope', 'mine');
 v_view jsonb; d jsonb;
begin
 perform pg_advisory_xact_lock(hashtext('ar_rule:lost'));
 if exists (select 1 from public.ar_rules x where x.kind = 'lost') then return; end if;
 v_view := jsonb_build_array(jsonb_build_object('who', v_amo, 'from', 'submit'),
  jsonb_build_object('who', jsonb_build_object('t', 'role', 'role', 'acct_mgr', 'scope', 'all'), 'from', 'submit'),
  jsonb_build_object('who', jsonb_build_object('t', 'role', 'role', 'acct_lead', 'scope', 'all'), 'from', 'submit'),
  jsonb_build_object('who', jsonb_build_object('t', 'role', 'role', 'office_crew', 'scope', 'all'), 'from', 'submit'));
 d := jsonb_build_object('default', jsonb_build_object('label', 'GM・CEO', 'stages', jsonb_build_array(jsonb_build_object('mode', 'any', 'slots', jsonb_build_array(v_gmo, v_ceo)))))
  || jsonb_build_object('viewers', v_view, 'self', 'gm');
 insert into public.ar_rules(kind, ver, status, def, note, rev, created_by, updated_by)
  values ('lost', 1, 'draft', d, '初めの下書き（v1202・紛失届）', public.ar_rule_rev_next('lost'), 'sql', 'sql');
end $$;
