-- v1155：ワークセンターの申請/承認 段階 2（UI案72 の答え・Moto さん 11/13 09:48 HST）。仕様：docs/WORKCENTER_APPROVALS_STAGE2_JA.md
-- 先に 1 段目〜v1135（20261104090000・20261105090000・20261106090000・20261107090000）を流してから。2 回流しても同じ。
--
-- 前の「承認」タブの種類と予算を、同じ番号の申請としてサーバーに置く（1A・9B＝まとめて）。
--   種類（kind・番号の頭）：予算 budget（BG）・休暇 leave（LV）・シフト変更 shift（SH）・採用 hire（HR）・退職 resign（RS）・
--     Leadership promo（LD）・Tip Rate（本人）tip_self（TP）・スキル（本人）skill_self（SS）・プレップ認定 prep（PR）・月間行動計画 plan（MP）。
--   出すのはアプリ（前の画面で申請したとき、その記録をここに写す）。中身は申請したときの写し（payload）。正式な値は今までどおりアプリの共通データ。
--   承認の順（2A）：前段 → GM。AM の段がある種類（休暇・シフト変更・採用・退職・Tip Rate・スキル）は、その店の AM（GM・CEO が確かめた写し）。
--     その店に AM がいなければ GM から。休暇は AM で決まる（7B：GM の要対応にも出る・GM も承認できる）。
--     GM・CEO はどの段でも承認でき、残りの段もまとめて決まる（前の承認タブの「代理で全承認」と同じ・記録に「GM が代わりに」）。
--   承認のあと：承認した端末が今までの画面の処理（予算の承認・休暇・退職手続き など）を 1 回だけ行う（反映の押さえ apply_start → apply_done）。
--     経理の確認がある種類（6A）：予算＝「予算反映済み」・休暇・採用・退職・Leadership・Tip Rate・スキル・プレップ認定＝「確認完了」。
--       反映のあと「経理の確認待ち」（acct）→ 経理・事務Crew が check → done。シフト変更・月間行動計画は反映で終わる（applied）。
--   予算（3A・4A）：金額＝その月の売上予算の合計（セント）。同じ店・同じ月の 2 回目からは同じ番号の新しい版（予算変更）。
--     前に反映した版の金額を prev_cents に残す（差額を出す）。反映中（押さえて 30 分以内）は新しい版を断る（conflict）。
--   差し戻し（return）は予算だけ（前の画面と同じ）。ほかは承認か却下。
--   使い始めるのは GM・CEO（wr_settings.s2_live）。アプリの端末が全部 v1155 になってから（前の版の端末は前の承認タブで決めてしまう）。
--   wr_stage は 5。
-- 1 段目〜v1135 の SQL をあとで流し直すと振り分け（wr_submit・wr_actions・wr_act・wr_next・wr_list・wr_row）が前に戻るので、この SQL も流し直す。

do $$ begin
 if to_regprocedure('public.wr_apply_fresh(public.wr_requests)') is null or to_regprocedure('public.wr_act_eval(jsonb)') is null
    or to_regclass('public.wr_store_views') is null then
  raise exception 'STOP: 先に 1 段目〜v1135 の SQL（deploy/work-requests-v1135 まで）を流してください（何も変えていません）';
 end if;
end $$;

-- ---------------------------------------------------------------- 表
alter table public.wr_settings add column if not exists s2_live boolean not null default false;
alter table public.wr_settings add column if not exists s2_at timestamptz;
alter table public.wr_settings add column if not exists s2_by text;

alter table public.wr_requests drop constraint if exists wr_requests_kind_check;
alter table public.wr_requests add constraint wr_requests_kind_check check (kind in ('mileage','reimburse','expense_pre','skill','cs','tiprate',
  'budget','leave','shift','hire','resign','promo','tip_self','skill_self','prep','plan'));
alter table public.wr_requests drop constraint if exists wr_requests_status_check;
alter table public.wr_requests add constraint wr_requests_status_check check (status in ('pending','returned','approved','checked','paid','done','rejected','withdrawn',
  'applied','apply_error','acct'));
-- 段階 2：承認の順（steps）・今の段（step：承認待ちのあいだだけ）・承認の記録（signoffs）・前の画面の記録の id（ap_id）
alter table public.wr_requests add column if not exists step text;
alter table public.wr_requests add column if not exists steps text[];
alter table public.wr_requests add column if not exists signoffs jsonb not null default '[]'::jsonb;
alter table public.wr_requests add column if not exists ap_id text;
-- 前の画面の記録 1 つに申請 1 つ（予算は同じ店・同じ月で 1 つの申請に版を重ねるので除く）
create unique index if not exists wr_requests_ap_idx on public.wr_requests(kind, ap_id) where ap_id is not null and kind <> 'budget';
create index if not exists wr_requests_budget_idx on public.wr_requests(store_id, (payload->>'ym')) where kind = 'budget';

-- ---------------------------------------------------------------- 種類
create or replace function public.wr_s2_kinds() returns text[]
language sql immutable security invoker set search_path = public, pg_temp as $$
 select array['budget','leave','shift','hire','resign','promo','tip_self','skill_self','prep','plan']::text[];
$$;
create or replace function public.wr_is_s2(p_kind text) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$ select coalesce(p_kind, '') = any(public.wr_s2_kinds()); $$;
-- 経理の確認がある種類（6A）
create or replace function public.wr_s2_acct(p_kind text) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
 select p_kind in ('budget','leave','hire','resign','promo','tip_self','skill_self','prep');
$$;
-- AM の段がある種類（2A：前段 → GM。「全員」の種類は AM → GM）。休暇は AM で決まる
create or replace function public.wr_s2_am_kind(p_kind text) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
 select p_kind in ('leave','shift','hire','resign','tip_self','skill_self');
$$;

create or replace function public.wr_prefix(p_kind text) returns text
language sql immutable security invoker set search_path = public, pg_temp as $$
 select case p_kind when 'mileage' then 'GS' when 'reimburse' then 'RB' when 'expense_pre' then 'EX' when 'skill' then 'SK' when 'cs' then 'CS' when 'tiprate' then 'TR'
  when 'budget' then 'BG' when 'leave' then 'LV' when 'shift' then 'SH' when 'hire' then 'HR' when 'resign' then 'RS' when 'promo' then 'LD'
  when 'tip_self' then 'TP' when 'skill_self' then 'SS' when 'prep' then 'PR' when 'plan' then 'MP' end;
$$;

-- その店に AM の段を回せるか：GM・CEO が確かめた写しで AM・その店の担当・今も在籍の AM で、店の表の AM 欄もその人。申請した本人は除く
-- （社員の表・店の表は狭めることにだけ使う。wr_approver_am の前の決まりと同じ・1 人でなくてもよい：担当の AM ならだれでも承認できる）
create or replace function public.wr_s2_store_has_am(p_store text, p_req_emp text) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select exists (select 1 from public.wr_people c join public.employees e on e.id::text = c.emp_id
  where c.role = 'am' and p_store = any(c.am_stores) and e.role = 'am' and not public.wr_emp_out(e)
   and exists (select 1 from public.stores st where st.id::text = p_store and coalesce(st.active, true) and btrim(coalesce(st.am, '')) = btrim(coalesce(e.name, '')))
   and c.emp_id is distinct from p_req_emp);
$$;
create or replace function public.wr_s2_steps(p_kind text, p_store text, p_req_emp text) returns text[]
language sql stable security invoker set search_path = public, pg_temp as $$
 select case when public.wr_s2_am_kind(p_kind) and public.wr_s2_store_has_am(p_store, p_req_emp)
   then case when p_kind = 'leave' then array['am']::text[] else array['am','gm']::text[] end
   else array['gm']::text[] end;
$$;

create or replace function public.wr_s2_live() returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$ select coalesce((select live and s2_live from public.wr_settings where id = 1), false); $$;

-- 出せる店：CEO・GM・経理・事務Crew はどの店・本部（---）も。AM は担当の店・自分の店・本部。ほかは自分の店（所属・応援）・本部。
-- 前の画面で申請できた人がそのまま出す（休暇・Tip Rate・スキルの本人の申請は G1 からある）。決めるのは承認する人。
create or replace function public.wr_s2_can_submit(a jsonb, p_store text) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select coalesce(p_store, '') <> '' and length(p_store) <= 30 and (
  (a->>'role') in ('ceo','gm','office','office_crew') or p_store = '---'
  or p_store = any(public.wr_arr(a->'stores')) or ((a->>'role') = 'am' and p_store = any(public.wr_arr(a->'am_stores'))));
$$;

-- 中身（Edge Function が形を整え、ここでもう一度確かめる）。返す：{ payload, amount_cents }
create or replace function public.wr_s2_norm(p_kind text, p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare o jsonb := coalesce(p, '{}'::jsonb); v_cents bigint; v_ym text; k text;
begin
 if jsonb_typeof(o) <> 'object' or not public.wr_is_s2(p_kind) then raise exception 'bad_value'; end if;
 if coalesce(o->>'ap_id', '') !~ '^ap[0-9]{6,20}$' then raise exception 'bad_value'; end if;
 if btrim(coalesce(o->>'title', '')) = '' or length(o->>'title') > 200 then raise exception 'bad_value'; end if;
 v_ym := nullif(o->>'ym', '');
 if v_ym is not null and v_ym !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'bad_value'; end if;
 if p_kind in ('budget','plan') and v_ym is null then raise exception 'bad_value'; end if;
 if p_kind = 'budget' then
  if jsonb_typeof(o->'total_cents') <> 'number' then raise exception 'bad_value'; end if;
  v_cents := (o->>'total_cents')::bigint;
  if v_cents < 0 or v_cents > 100000000000 then raise exception 'bad_value'; end if;
  if o ? 'days' then
   if jsonb_typeof(o->'days') <> 'object' or (select count(*) from jsonb_object_keys(o->'days')) > 31 then raise exception 'bad_value'; end if;
   for k in select jsonb_object_keys(o->'days') loop
    if k !~ ('^' || v_ym || '-(0[1-9]|[12][0-9]|3[01])$') or jsonb_typeof(o->'days'->k) <> 'number' then raise exception 'bad_value'; end if;
   end loop;
  end if;
 end if;
 return jsonb_build_object('payload', o, 'amount_cents', v_cents);
end $$;

-- ---------------------------------------------------------------- 出す
-- 予算は同じ店・同じ月の申請があれば、同じ番号の新しい版（予算変更）。ほかは前の画面の記録 1 つに 1 つ（同じ記録なら前の申請を返す）。
create or replace function public.wr_submit_s2(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v_kind text := p->>'kind'; v_store text := p->>'store_id'; v_key text := p->>'client_key';
 n jsonb; r public.wr_requests; o public.wr_requests; v_now timestamptz := now(); v_rid uuid; v_ract text; v_remp text;
 v_steps text[]; v_pl jsonb; v_prev bigint; v_prevv integer; v_ver integer; v_act text; v_from text;
begin
 if v_key is null or v_key !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'bad_value'; end if;
 perform pg_advisory_xact_lock(hashtext('wr_key:' || v_key));
 select e.request_id, e.action, e.by_emp into v_rid, v_ract, v_remp from public.wr_events e where e.client_key = v_key;
 if v_rid is not null then
  select * into r from public.wr_requests x where x.id = v_rid;
  if v_ract not in ('submit','revise','resubmit') or v_remp is distinct from (a->>'emp') or r.kind <> coalesce(v_kind, '') then raise exception 'conflict'; end if;
  return public.wr_row(a, r) || jsonb_build_object('replay', true);
 end if;
 if not public.wr_s2_live() then raise exception 'not_live'; end if;
 if not public.wr_is_s2(v_kind) then raise exception 'bad_value'; end if;
 if not public.wr_s2_can_submit(a, v_store) then raise exception 'forbidden'; end if;
 n := public.wr_s2_norm(v_kind, p->'payload');
 v_pl := n->'payload';
 v_steps := public.wr_s2_steps(v_kind, v_store, a->>'emp');

 if v_kind = 'budget' then
  perform pg_advisory_xact_lock(hashtext('wr_bg:' || v_store || ':' || (v_pl->>'ym')));
  select * into o from public.wr_requests x where x.kind = 'budget' and x.store_id = v_store and x.payload->>'ym' = v_pl->>'ym'
   and x.status not in ('withdrawn','rejected') order by x.created_at desc limit 1 for update;
  if o.id is not null then
   -- 反映中（押さえて 30 分以内）は待ってもらう（反映している版と違う版を重ねない）
   if o.status in ('approved','apply_error') and public.wr_apply_fresh(o) then raise exception 'conflict'; end if;
   if o.status in ('acct','done','applied') then v_prev := o.amount_cents; v_prevv := o.version;
   else v_prev := nullif(o.payload->>'prev_cents', '')::bigint; v_prevv := nullif(o.payload->>'prev_version', '')::int; end if;
   v_pl := (v_pl - 'prev_cents' - 'prev_version') || jsonb_strip_nulls(jsonb_build_object('prev_cents', v_prev, 'prev_version', v_prevv));
   v_ver := o.version + 1; v_from := o.status;
   v_act := case when o.status = 'returned' then 'resubmit' else 'revise' end;
   update public.wr_requests set payload = v_pl, amount_cents = (n->>'amount_cents')::bigint, version = v_ver, status = 'pending',
     steps = v_steps, step = v_steps[1], signoffs = '[]'::jsonb, ap_id = v_pl->>'ap_id',
     requester_emp = a->>'emp', requester_name = a->>'name',
     approved_by = null, approved_emp = null, approved_at = null, checked_by = null, checked_emp = null, checked_at = null,
     closed_by = null, closed_at = null, close_reason = null, apply_key = null, apply_emp = null, apply_by = null, apply_at = null,
     submitted_at = v_now, rev = o.rev + 1, updated_at = v_now
    where id = o.id returning * into r;
   insert into public.wr_versions(request_id, version, payload, amount_cents, use_date, by_emp, by_name, at, note)
    values (r.id, v_ver, v_pl, r.amount_cents, (timezone('Pacific/Honolulu', v_now))::date, a->>'emp', a->>'name', v_now, case when v_act = 'revise' then '予算変更' end);
   insert into public.wr_events(request_id, at, action, from_status, to_status, version, rev, by_emp, by_name, by_role, note, client_key)
    values (r.id, v_now, v_act, v_from, 'pending', v_ver, r.rev, a->>'emp', a->>'name', a->>'role', case when v_act = 'revise' then '予算変更（新しい版）' end, v_key);
   return public.wr_row(a, r);
  end if;
 else
  -- 同じ前の画面の記録は 1 つ（端末が送り直したとき・2 台が同時に写したとき）
  perform pg_advisory_xact_lock(hashtext('wr_ap:' || v_kind || ':' || (v_pl->>'ap_id')));
  select * into o from public.wr_requests x where x.kind = v_kind and x.ap_id = v_pl->>'ap_id';
  if o.id is not null then return public.wr_row(a, o) || jsonb_build_object('replay', true); end if;
 end if;

 insert into public.wr_requests(code, kind, status, store_id, requester_emp, requester_name, target_name, payload, amount_cents, use_date,
   steps, step, ap_id, submitted_at, created_at, updated_at)
  values (public.wr_new_code(v_kind, v_now), v_kind, 'pending', v_store, a->>'emp', a->>'name', nullif(btrim(coalesce(v_pl->>'target_name', '')), ''), v_pl,
   (n->>'amount_cents')::bigint, (timezone('Pacific/Honolulu', v_now))::date, v_steps, v_steps[1], v_pl->>'ap_id', v_now, v_now, v_now)
  returning * into r;
 insert into public.wr_versions(request_id, version, payload, amount_cents, use_date, by_emp, by_name, at)
  values (r.id, 1, r.payload, r.amount_cents, r.use_date, a->>'emp', a->>'name', v_now);
 insert into public.wr_events(request_id, at, action, from_status, to_status, version, rev, by_emp, by_name, by_role, client_key)
  values (r.id, v_now, 'submit', null, 'pending', 1, 1, a->>'emp', a->>'name', a->>'role', v_key);
 return public.wr_row(a, r);
end $$;

-- ---------------------------------------------------------------- できること
create or replace function public.wr_actions_s2(a jsonb, r public.wr_requests) returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare o text[] := '{}'; v_mine boolean := public.wr_is_mine(a, r); v_gm boolean := (a->>'role') in ('ceo','gm');
 v_am boolean := (a->>'role') = 'am' and r.store_id = any(public.wr_arr(a->'am_stores'));
begin
 if r.status = 'pending' and not v_mine and (v_gm or (r.step = 'am' and v_am)) then
  o := o || 'approve'::text;
  if r.kind = 'budget' then o := o || 'return'::text; end if;
  o := o || 'reject'::text;
 end if;
 -- 取り下げ：申請した本人（前の画面で取り下げたときにアプリが送る）。決まる前だけ
 if r.status in ('pending','returned') and public.wr_is_owner(a, r) then o := o || 'withdraw'::text; end if;
 -- 反映：GM・CEO（休暇は担当の AM も：AM で決まるため）
 if r.status in ('approved','apply_error') and (v_gm or (r.kind = 'leave' and v_am and not v_mine)) then
  if not public.wr_apply_fresh(r) then o := o || array['apply_start','reject']; end if;
  if r.apply_key is not null and (a->>'emp') is not distinct from r.apply_emp then o := o || array['apply_done','apply_fail','apply_cancel']; end if;
 end if;
 if r.status = 'acct' and public.wr_is_acct(a) and not v_mine then o := o || 'check'::text; end if;
 if r.status = 'done' and public.wr_is_acct(a) and not v_mine then o := o || 'undo'::text; end if;
 return o;
end $$;

-- ---------------------------------------------------------------- 動かす
create or replace function public.wr_act_s2(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v_act text := p->>'action'; v_key text := p->>'client_key'; v_note text := nullif(btrim(coalesce(p->>'note', '')), '');
 r public.wr_requests; v_rid uuid; v_ract text; v_from text; v_to text; v_can text[]; v_now timestamptz := now(); v_gm boolean := (a->>'role') in ('ceo','gm');
 v_so jsonb; v_rest text[]; v_i integer; v_s text;
begin
 if v_key is null or v_key !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'bad_value'; end if;
 if v_note is not null and length(v_note) > 400 then raise exception 'bad_value'; end if;
 perform pg_advisory_xact_lock(hashtext('wr_key:' || v_key));
 select e.request_id, e.action into v_rid, v_ract from public.wr_events e where e.client_key = v_key;
 if v_rid is not null then
  select * into r from public.wr_requests x where x.id = v_rid;
  if not public.wr_visible(a, r) or v_ract is distinct from v_act
     or not (coalesce(p->>'id', '') = r.id::text or coalesce(p->>'code', '') = r.code) then raise exception 'conflict'; end if;
  if v_act = 'apply_start' and (r.apply_key is distinct from v_key or r.status not in ('approved','apply_error') or not public.wr_apply_fresh(r)) then raise exception 'conflict'; end if;
  return public.wr_row(a, r) || jsonb_build_object('replay', true);
 end if;
 r := public.wr_find(a, p);
 select * into r from public.wr_requests x where x.id = r.id for update;
 if not (jsonb_typeof(p->'expect_rev') = 'number' and (p->>'expect_rev')::int = r.rev) then raise exception 'conflict'; end if;
 v_can := public.wr_actions(a, r);
 if v_act is null or not (v_act = any(v_can)) then raise exception 'forbidden'; end if;
 if v_act in ('apply_done','apply_fail','apply_cancel') and (r.apply_key is null or coalesce(p->>'claim', '') is distinct from r.apply_key) then raise exception 'conflict'; end if;
 if v_act in ('return','reject','apply_fail') and v_note is null then raise exception 'reason_required'; end if;
 v_from := r.status;

 if v_act = 'approve' then
  v_so := coalesce(r.signoffs, '[]'::jsonb);
  v_i := coalesce(array_position(r.steps, r.step), 1);
  if v_gm then
   -- GM・CEO：残りの段もまとめて（AM の段は「GM が代わりに」）
   v_rest := coalesce(r.steps[v_i:coalesce(array_length(r.steps, 1), 1)], array['gm']::text[]);
   if cardinality(v_rest) = 0 then v_rest := array['gm']::text[]; end if;
   foreach v_s in array v_rest loop
    v_so := v_so || jsonb_build_array(jsonb_build_object('step', v_s, 'by', a->>'name', 'emp', a->>'emp', 'role', a->>'role', 'at', v_now, 'proxy', v_s <> 'gm', 'note', v_note));
   end loop;
   update public.wr_requests set status = 'approved', step = null, signoffs = v_so, approved_by = a->>'name', approved_emp = a->>'emp', approved_at = v_now where id = r.id;
   v_to := 'approved';
  else
   v_so := v_so || jsonb_build_array(jsonb_build_object('step', r.step, 'by', a->>'name', 'emp', a->>'emp', 'role', a->>'role', 'at', v_now, 'proxy', false, 'note', v_note));
   if v_i < coalesce(array_length(r.steps, 1), 1) then
    update public.wr_requests set step = r.steps[v_i + 1], signoffs = v_so where id = r.id;
    v_to := 'pending';
   else
    update public.wr_requests set status = 'approved', step = null, signoffs = v_so, approved_by = a->>'name', approved_emp = a->>'emp', approved_at = v_now where id = r.id;
    v_to := 'approved';
   end if;
  end if;
 elsif v_act = 'return' then
  update public.wr_requests set status = 'returned', returned_by = a->>'name', returned_at = v_now, return_reason = v_note,
    step = r.steps[1], signoffs = '[]'::jsonb, approved_by = null, approved_emp = null, approved_at = null where id = r.id;
  v_to := 'returned';
 elsif v_act = 'reject' then
  update public.wr_requests set status = 'rejected', step = null, closed_by = a->>'name', closed_at = v_now, close_reason = v_note,
    apply_key = null, apply_emp = null, apply_by = null, apply_at = null where id = r.id;
  v_to := 'rejected';
 elsif v_act = 'withdraw' then
  update public.wr_requests set status = 'withdrawn', step = null, closed_by = a->>'name', closed_at = v_now, close_reason = v_note where id = r.id;
  v_to := 'withdrawn';
 elsif v_act = 'apply_start' then
  update public.wr_requests set apply_key = v_key, apply_emp = a->>'emp', apply_by = a->>'name', apply_at = v_now where id = r.id;
  v_to := r.status;
 elsif v_act = 'apply_cancel' then
  update public.wr_requests set apply_key = null, apply_emp = null, apply_by = null, apply_at = null where id = r.id;
  v_to := r.status;
 elsif v_act = 'apply_done' then
  -- 今までの画面の処理をした記録（1 回だけ）。経理の確認がある種類は経理の確認待ち（acct）へ
  v_to := case when public.wr_s2_acct(r.kind) then 'acct' else 'applied' end;
  update public.wr_requests set status = v_to, closed_by = a->>'name', closed_at = v_now, close_reason = v_note,
    apply_key = null, apply_emp = null, apply_by = null, apply_at = null where id = r.id;
 elsif v_act = 'apply_fail' then
  update public.wr_requests set status = 'apply_error', apply_key = null, apply_emp = null, apply_by = null, apply_at = null where id = r.id;
  v_to := 'apply_error';
 elsif v_act = 'check' then
  -- 経理の確認（予算＝予算反映済み・ほか＝確認完了）
  update public.wr_requests set status = 'done', checked_by = a->>'name', checked_emp = a->>'emp', checked_at = v_now where id = r.id;
  v_to := 'done';
 elsif v_act = 'undo' then
  update public.wr_requests set status = 'acct', checked_by = null, checked_emp = null, checked_at = null where id = r.id;
  v_to := 'acct';
 else raise exception 'forbidden';
 end if;

 update public.wr_requests set rev = r.rev + 1, updated_at = v_now where id = r.id returning * into r;
 insert into public.wr_events(request_id, at, action, from_status, to_status, version, rev, by_emp, by_name, by_role, note, client_key)
  values (r.id, v_now, v_act, v_from, v_to, r.version, r.rev, a->>'emp', a->>'name', a->>'role', v_note, v_key);
 return public.wr_row(a, r);
end $$;

-- ---------------------------------------------------------------- 振り分け（段階 2 の種類を先に）
create or replace function public.wr_submit(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
begin
 if public.wr_is_s2(p->>'kind') then return public.wr_submit_s2(p); end if;
 if coalesce(p->>'kind', '') in ('skill','cs','tiprate') then return public.wr_submit_eval(p); end if;
 return public.wr_submit_exp(p);
end $$;

create or replace function public.wr_actions(a jsonb, r public.wr_requests) returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
 if public.wr_is_s2(r.kind) then return public.wr_actions_s2(a, r); end if;
 if r.kind in ('skill','cs','tiprate') then return public.wr_actions_eval(a, r); end if;
 return public.wr_actions_exp(a, r);
end $$;

create or replace function public.wr_act(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_kind text; v_id uuid;
begin
 if nullif(p->>'id', '') is not null then
  begin v_id := (p->>'id')::uuid; exception when others then v_id := null; end;
  select x.kind into v_kind from public.wr_requests x where x.id = v_id;
 elsif nullif(p->>'code', '') is not null then
  select x.kind into v_kind from public.wr_requests x where x.code = p->>'code';
 end if;
 if public.wr_is_s2(v_kind) then return public.wr_act_s2(p); end if;
 if v_kind in ('skill','cs','tiprate') then return public.wr_act_eval(p); end if;
 return public.wr_act_exp(p);
end $$;

create or replace function public.wr_next(r public.wr_requests) returns jsonb
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
  when r.status = 'approved' and r.kind in ('mileage','reimburse','expense_pre') then jsonb_build_object('step', 'check', 'who', 'acct')
  when r.status = 'checked' and r.kind in ('mileage','reimburse') then jsonb_build_object('step', 'pay', 'who', 'acct')
  else null end;
$$;

-- 画面に返す 1 件（1 段目の形に、段階 2 の承認の順・記録・前の画面の記録の id を足した）
create or replace function public.wr_row(a jsonb, r public.wr_requests) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select jsonb_build_object('id', r.id, 'code', r.code, 'kind', r.kind, 'status', r.status, 'store_id', r.store_id,
  'requester_emp', r.requester_emp, 'requester_name', r.requester_name, 'target_emp', r.target_emp, 'target_name', r.target_name,
  'payload', r.payload, 'amount_cents', r.amount_cents, 'use_date', r.use_date, 'effective_date', r.effective_date,
  'version', r.version, 'rev', r.rev, 'dup_codes', to_jsonb(r.dup_codes), 'dup_reason', r.dup_reason,
  'dup_ok', case when r.dup_ok_at is null then null else jsonb_build_object('by', r.dup_ok_by, 'at', r.dup_ok_at, 'note', r.dup_ok_note) end,
  'approved', case when r.approved_at is null and r.approved_by is null then null else jsonb_build_object('by', r.approved_by, 'at', r.approved_at) end,
  'checked', case when r.checked_at is null and r.checked_by is null then null else jsonb_build_object('by', r.checked_by, 'at', r.checked_at) end,
  'paid', case when r.paid_at is null and r.paid_by is null then null else jsonb_build_object('by', r.paid_by, 'at', r.paid_at, 'date', r.pay_date, 'method', r.pay_method) end,
  'returned', case when r.returned_at is null then null else jsonb_build_object('by', r.returned_by, 'at', r.returned_at, 'reason', r.return_reason) end,
  'closed', case when r.closed_at is null and r.closed_by is null then null else jsonb_build_object('by', r.closed_by, 'at', r.closed_at, 'reason', r.close_reason) end,
  'legacy', r.legacy, 'legacy_info', r.legacy_info, 'submitted_at', r.submitted_at, 'updated_at', r.updated_at,
  'step', r.step, 'steps', to_jsonb(r.steps), 'signoffs', r.signoffs, 'ap_id', r.ap_id,
  'next', public.wr_next(r), 'mine', public.wr_is_mine(a, r), 'can', to_jsonb(public.wr_actions(a, r)));
$$;

-- 一覧（v1133 と同じ。経理の確認待ち acct を「未完了」に）
create or replace function public.wr_list(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v_scope text := coalesce(p->>'scope', 'todo'); v_state text := coalesce(p->>'state', 'open');
 v_kind text := nullif(p->>'kind', ''); v_store text := nullif(p->>'store', ''); v_from date; v_to date; v_lim integer;
 v_rows jsonb; v_counts jsonb;
begin
 if v_scope not in ('todo','mine','team') or v_state not in ('open','closed','all') then raise exception 'bad_value'; end if;
 begin v_from := nullif(p->>'from', '')::date; v_to := nullif(p->>'to', '')::date; exception when others then raise exception 'bad_value'; end;
 v_lim := least(greatest(coalesce((p->>'limit')::int, 300), 1), 1000);
 select coalesce(jsonb_agg(public.wr_row(a, r) order by r.submitted_at desc, r.code desc), '[]'::jsonb) into v_rows from (
  select r.* from public.wr_requests r
   where public.wr_visible(a, r)
    and (v_kind is null or r.kind = v_kind) and (v_store is null or r.store_id = v_store)
    and (v_from is null or timezone('Pacific/Honolulu', r.submitted_at)::date >= v_from)
    and (v_to is null or timezone('Pacific/Honolulu', r.submitted_at)::date <= v_to)
    and case v_state when 'open' then r.status in ('pending','returned','approved','checked','apply_error','acct')
                     when 'closed' then r.status in ('paid','done','rejected','withdrawn','applied') else true end
    and case v_scope when 'mine' then public.wr_is_mine(a, r)
                     when 'todo' then cardinality(array(select x from unnest(public.wr_actions(a, r)) x where x in ('approve','check','pay','resubmit','dup_ok','apply_start','apply_done'))) > 0
                     else true end
   order by r.submitted_at desc, r.code desc limit v_lim) r;
 select jsonb_build_object(
   'todo', count(*) filter (where cardinality(array(select x from unnest(public.wr_actions(a, r)) x where x in ('approve','check','pay','resubmit','dup_ok','apply_start','apply_done'))) > 0),
   'returned', count(*) filter (where r.status = 'returned'),
   'waiting_pay', count(*) filter (where r.status in ('approved','checked') and r.kind in ('mileage','reimburse','expense_pre')),
   'acct2', count(*) filter (where r.status = 'acct'),
   'stuck7', count(*) filter (where r.status in ('pending','returned','approved','checked','apply_error','acct') and r.updated_at < now() - interval '7 days'),
   'mine_open', count(*) filter (where public.wr_is_mine(a, r)))
  into v_counts
  from public.wr_requests r where public.wr_visible(a, r) and r.status in ('pending','returned','approved','checked','apply_error','acct');
 return jsonb_build_object('rows', v_rows, 'counts', v_counts, 'me', a, 'live', public.wr_live(), 's2', public.wr_s2_live());
end $$;

-- ---------------------------------------------------------------- 使い始める（GM・CEO）
create or replace function public.wr_whoami(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); s public.wr_settings;
begin
 select * into s from public.wr_settings where id = 1;
 return jsonb_build_object('me', a, 'live', coalesce(s.live, false), 'settings_rev', coalesce(s.rev, 1), 'live_at', s.live_at, 'settings_at', s.updated_at,
  'rate', public.wr_mileage_rate(),
  's2', coalesce(s.live, false) and coalesce(s.s2_live, false), 's2_at', s.s2_at, 's2_by', s.s2_by,
  'people', case when (a->>'role') in ('ceo','gm') then (select jsonb_build_object('up', count(*) filter (where x->'up' = 'true'::jsonb), 'changes', count(*),
     'confirmed', (select count(*) from public.wr_people)) from jsonb_array_elements(public.wr_people_items()) x) end);
end $$;

-- 共通データの 1 行 wr_live（アプリはログインのたびに読む）に段階 2 も書く
create or replace function public.wr_live_row(s public.wr_settings) returns void
language sql volatile security invoker set search_path = public, pg_temp as $$
 insert into public.app_state(key, value, updated_at) values ('wr_live', jsonb_build_object('live', s.live, 'at', s.updated_at, 's2', s.live and s.s2_live), now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
$$;

create or replace function public.wr_settings_save(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); s public.wr_settings; v_live boolean; v_imp jsonb;
begin
 if (a->>'role') not in ('ceo','gm') then raise exception 'forbidden'; end if;
 if jsonb_typeof(p->'live') <> 'boolean' then raise exception 'bad_value'; end if;
 v_live := (p->>'live')::boolean;
 select * into s from public.wr_settings where id = 1 for update;
 if not (jsonb_typeof(p->'expect_rev') = 'number' and (p->>'expect_rev')::int = s.rev) then raise exception 'conflict'; end if;
 if v_live and not s.live then v_imp := public.wr_legacy_import(p); end if;
 update public.wr_settings set live = v_live, live_at = case when v_live then now() else live_at end, live_by = case when v_live then a->>'name' else live_by end,
   rev = s.rev + 1, updated_at = now() where id = 1 returning * into s;
 perform public.wr_live_row(s);
 return jsonb_build_object('live', s.live, 'settings_rev', s.rev, 'live_at', s.live_at, 'settings_at', s.updated_at, 'imported', v_imp, 's2', s.live and s.s2_live);
end $$;

-- 段階 2 を使い始める／止める（GM・CEO）。1 段目（live）が使われているときだけ始められる。止めても記録は残る（アプリは前の承認タブに戻る）
create or replace function public.wr_s2_save(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); s public.wr_settings; v_on boolean;
begin
 if (a->>'role') not in ('ceo','gm') then raise exception 'forbidden'; end if;
 if jsonb_typeof(p->'s2') <> 'boolean' then raise exception 'bad_value'; end if;
 v_on := (p->>'s2')::boolean;
 select * into s from public.wr_settings where id = 1 for update;
 if not (jsonb_typeof(p->'expect_rev') = 'number' and (p->>'expect_rev')::int = s.rev) then raise exception 'conflict'; end if;
 if v_on and not s.live then raise exception 'not_live'; end if;
 update public.wr_settings set s2_live = v_on, s2_at = case when v_on then now() else s2_at end, s2_by = case when v_on then a->>'name' else s2_by end,
   rev = s.rev + 1, updated_at = now() where id = 1 returning * into s;
 perform public.wr_live_row(s);
 return jsonb_build_object('s2', s.live and s.s2_live, 'settings_rev', s.rev, 's2_at', s.s2_at, 'settings_at', s.updated_at);
end $$;

-- SQL の段（関数 work-requests の whoami が見る。5 でなければアプリは段階 2 を使わない）
create or replace function public.wr_stage(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$ select jsonb_build_object('stage', 5) $$;

-- 呼べるのはサーバーの鍵だけ
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'wr\_%' loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;

notify pgrst, 'reload schema';
