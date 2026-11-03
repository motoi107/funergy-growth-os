-- v1133：評価の変更の「反映」を、書く前にサーバーで押さえる（#124 の Codex のレビュー P2）。仕様：docs/WORK_REQUESTS_V1133_JA.md
-- 先に 20261104090000（1 段目）と 20261105090000（2 段目）を流してから。2 回流しても同じ。
--
-- 前（v1132）：GM・CEO の端末が正式な値を書いてから「反映した（apply）」を記録した。書くまでのあいだ（読み込み・Tip Rate の確かめの画面）に
--   ほかの端末が「反映しないで閉じる」を押しても止まらず、閉じた申請の値が書かれた。
-- これから：
--   ・書く前に apply_start（押さえる）。押さえた端末だけが書き、apply_done（反映した）・apply_fail（反映できなかった）・apply_cancel（やめた・何も変えていない）を記録する。
--     この 3 つは押さえたときの鍵（claim）が合うときだけ。
--   ・押さえているあいだ（30 分）、ほかの人・ほかの端末は押さえられない・閉じられない。30 分たっても終わっていなければ、やり直す（押さえ直す）か閉じられる。
--   ・前の版（v1132）の「apply」はもう出さない（前の版の端末は書かない）。
-- 2 段目の SQL をあとで流し直したら、この SQL も流し直す（振り分けの関数が 2 段目のものに戻るため）。

do $$ begin
 if to_regprocedure('public.wr_act_eval(jsonb)') is null or to_regprocedure('public.wr_actions_eval(jsonb,public.wr_requests)') is null then
  raise exception 'STOP: 先に 20261105090000_work_requests_eval.sql（2 段目）を流してください（何も変えていません）';
 end if;
end $$;

-- 押さえ（反映中）。鍵＝apply_start の client_key（アプリだけが知っている）
alter table public.wr_requests add column if not exists apply_key text;
alter table public.wr_requests add column if not exists apply_emp text;
alter table public.wr_requests add column if not exists apply_by text;
alter table public.wr_requests add column if not exists apply_at timestamptz;

-- まだ押さえているか（30 分）
create or replace function public.wr_apply_fresh(r public.wr_requests) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select r.apply_key is not null and r.apply_at is not null and r.apply_at > now() - interval '30 minutes';
$$;

-- ---------------------------------------------------------------- できること（評価の変更）
create or replace function public.wr_actions_eval(a jsonb, r public.wr_requests) returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare o text[] := '{}'; v_mine boolean := public.wr_is_mine(a, r); v_own boolean := public.wr_is_owner(a, r); v_gm boolean := (a->>'role') in ('ceo','gm');
begin
 if v_own and r.status = 'pending' then o := o || 'edit'::text; end if;
 if v_own and r.status = 'returned' then o := o || 'resubmit'::text; end if;
 if v_own and r.status in ('pending','returned') then o := o || 'withdraw'::text; end if;
 if r.status = 'pending' and v_gm and not v_mine then o := o || array['approve','return','reject']; end if;
 if r.status in ('approved','apply_error') and v_gm then
  -- だれも押さえていない（または 30 分たった）ときだけ、押さえる・反映しないで閉じる
  if not public.wr_apply_fresh(r) then o := o || array['apply_start','reject']; end if;
  -- 押さえた人の操作（鍵が合うときだけ通る。合わなければ conflict）
  if r.apply_key is not null and (a->>'emp') is not distinct from r.apply_emp then o := o || array['apply_done','apply_fail','apply_cancel']; end if;
 end if;
 return o;
end $$;

-- ---------------------------------------------------------------- 操作（評価の変更）
create or replace function public.wr_act_eval(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v_act text := p->>'action'; v_key text := p->>'client_key'; v_note text := nullif(btrim(coalesce(p->>'note', '')), '');
 r public.wr_requests; v_rid uuid; v_ract text; v_from text; v_to text; v_can text[]; n jsonb; v_now timestamptz := now(); v_ver integer;
begin
 if v_key is null or v_key !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'bad_value'; end if;
 if v_note is not null and length(v_note) > 400 then raise exception 'bad_value'; end if;
 perform pg_advisory_xact_lock(hashtext('wr_key:' || v_key));
 select e.request_id, e.action into v_rid, v_ract from public.wr_events e where e.client_key = v_key;
 if v_rid is not null then
  select * into r from public.wr_requests x where x.id = v_rid;
  if not public.wr_visible(a, r) or v_ract is distinct from v_act
     or not (coalesce(p->>'id', '') = r.id::text or coalesce(p->>'code', '') = r.code) then raise exception 'conflict'; end if;
  return public.wr_row(a, r) || jsonb_build_object('replay', true);
 end if;
 r := public.wr_find(a, p);
 select * into r from public.wr_requests x where x.id = r.id for update;
 if not (jsonb_typeof(p->'expect_rev') = 'number' and (p->>'expect_rev')::int = r.rev) then raise exception 'conflict'; end if;
 v_can := public.wr_actions(a, r);
 if v_act is null or not (v_act = any(v_can)) then raise exception 'forbidden'; end if;
 -- 押さえた端末の鍵でなければ通さない（同じ人のほかの端末・ほかのタブも）
 if v_act in ('apply_done','apply_fail','apply_cancel') and (r.apply_key is null or coalesce(p->>'claim', '') is distinct from r.apply_key) then raise exception 'conflict'; end if;
 if not public.wr_live() and v_act in ('edit','resubmit') then raise exception 'not_live'; end if;
 if v_act in ('return','reject','apply_fail') and v_note is null then raise exception 'reason_required'; end if;
 v_from := r.status; v_ver := r.version;

 if v_act in ('edit','resubmit') then
  -- 対象・店は変えない（別の人・別の店なら新しく出す）。対象・店・グレードは今の決まりでもう一度確かめる。
  if not public.wr_can_submit_eval(a, r.store_id) then raise exception 'forbidden'; end if;
  n := public.wr_norm_eval(a, r.kind, r.store_id, p->'payload');
  if n->>'target_emp' is distinct from r.target_emp then raise exception 'bad_value'; end if;
  v_ver := r.version + 1;
  update public.wr_requests set payload = n->'payload', effective_date = (n->>'effective_date')::date, target_name = n->>'target_name', version = v_ver,
    status = 'pending', approved_by = null, approved_emp = null, approved_at = null,
    submitted_at = case when v_act = 'resubmit' then v_now else submitted_at end where id = r.id;
  insert into public.wr_versions(request_id, version, payload, use_date, effective_date, by_emp, by_name, at, note)
   values (r.id, v_ver, n->'payload', r.use_date, (n->>'effective_date')::date, a->>'emp', a->>'name', v_now, v_note);
  v_to := 'pending';
 elsif v_act = 'withdraw' then
  update public.wr_requests set status = 'withdrawn', closed_by = a->>'name', closed_at = v_now, close_reason = v_note where id = r.id;
  v_to := 'withdrawn';
 elsif v_act = 'approve' then
  update public.wr_requests set status = 'approved', approved_by = a->>'name', approved_emp = a->>'emp', approved_at = v_now where id = r.id;
  v_to := 'approved';
 elsif v_act = 'return' then
  update public.wr_requests set status = 'returned', returned_by = a->>'name', returned_at = v_now, return_reason = v_note,
    approved_by = null, approved_emp = null, approved_at = null where id = r.id;
  v_to := 'returned';
 elsif v_act = 'reject' then
  update public.wr_requests set status = 'rejected', closed_by = a->>'name', closed_at = v_now, close_reason = v_note,
    apply_key = null, apply_emp = null, apply_by = null, apply_at = null where id = r.id;
  v_to := 'rejected';
 elsif v_act = 'apply_start' then
  -- 押さえる（状態は変えない）。鍵はこの操作の client_key
  update public.wr_requests set apply_key = v_key, apply_emp = a->>'emp', apply_by = a->>'name', apply_at = v_now where id = r.id;
  v_to := r.status;
 elsif v_act = 'apply_cancel' then
  update public.wr_requests set apply_key = null, apply_emp = null, apply_by = null, apply_at = null where id = r.id;
  v_to := r.status;
 elsif v_act = 'apply_done' then
  -- アプリの正式な値に反映した記録（1 回だけ）。note＝反映した中身の要約。
  update public.wr_requests set status = 'applied', closed_by = a->>'name', closed_at = v_now, close_reason = v_note,
    apply_key = null, apply_emp = null, apply_by = null, apply_at = null where id = r.id;
  v_to := 'applied';
 elsif v_act = 'apply_fail' then
  update public.wr_requests set status = 'apply_error', apply_key = null, apply_emp = null, apply_by = null, apply_at = null where id = r.id;
  v_to := 'apply_error';
 else raise exception 'forbidden';
 end if;

 update public.wr_requests set rev = r.rev + 1, updated_at = v_now where id = r.id returning * into r;
 insert into public.wr_events(request_id, at, action, from_status, to_status, version, rev, by_emp, by_name, by_role, note, client_key)
  values (r.id, v_now, v_act, v_from, v_to, v_ver, r.rev, a->>'emp', a->>'name', a->>'role', v_note, v_key);
 return public.wr_row(a, r);
end $$;

-- ---------------------------------------------------------------- 一覧（2 段目と同じ。「要対応」は apply_start・apply_done）
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
    and case v_state when 'open' then r.status in ('pending','returned','approved','checked','apply_error')
                     when 'closed' then r.status in ('paid','done','rejected','withdrawn','applied') else true end
    and case v_scope when 'mine' then public.wr_is_mine(a, r)
                     when 'todo' then cardinality(array(select x from unnest(public.wr_actions(a, r)) x where x in ('approve','check','pay','resubmit','dup_ok','apply_start','apply_done'))) > 0
                     else true end
   order by r.submitted_at desc, r.code desc limit v_lim) r;
 select jsonb_build_object(
   'todo', count(*) filter (where cardinality(array(select x from unnest(public.wr_actions(a, r)) x where x in ('approve','check','pay','resubmit','dup_ok','apply_start','apply_done'))) > 0),
   'returned', count(*) filter (where r.status = 'returned'),
   'waiting_pay', count(*) filter (where r.status in ('approved','checked') and r.kind in ('mileage','reimburse','expense_pre')),
   'stuck7', count(*) filter (where r.status in ('pending','returned','approved','checked','apply_error') and r.updated_at < now() - interval '7 days'),
   'mine_open', count(*) filter (where public.wr_is_mine(a, r)))
  into v_counts
  from public.wr_requests r where public.wr_visible(a, r) and r.status in ('pending','returned','approved','checked','apply_error');
 return jsonb_build_object('rows', v_rows, 'counts', v_counts, 'me', a, 'live', public.wr_live());
end $$;

-- SQL の段（関数 work-requests の whoami が見る。3 でなければアプリは「SQL が前の版」と出す）
create or replace function public.wr_stage(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$ select jsonb_build_object('stage', 3) $$;

-- 呼べるのはサーバーの鍵だけ
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'wr\_%' loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;

notify pgrst, 'reload schema';
