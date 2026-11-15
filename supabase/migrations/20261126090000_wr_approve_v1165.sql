-- v1165：ワークセンター「申請/承認」（UI案77・Moto さんの答え 11/14 09:29 HST：1A・2A・3A・4B・5A・6A）
-- 仕様：docs/WR_APPROVE_V1165_JA.md
--
-- 1. 事前経費（EX・事前承認済み）のあとの実費（建て替え経費 RB）を、経理が元の番号に結ぶ（4B）。
--    結ぶのは RB を「経理の確認」できる人（経理・事務Crew）が、RB が GM 承認済み（approved）のあいだだけ。
--    EX は同じ申請した人の「事前承認済み（done）」で、ほかの実費（取り下げ・却下を除く）にまだ結んでいないものだけ。
--    実費が予定額より多いとき（5A）：RB を GM の承認待ちに戻す（承認の記録は履歴に残す）。GM が承認し直したら、また経理の確認待ち。
--    精算するのは RB の実費だけ（EX は今までどおり支払に入れない）。
-- 2. 1 件の答え（wr_row）に足す：前の版の金額 prev_amount_cents（一覧の「金額（変更前後）」）・RB が結んだ EX（link_pre・予定を超えたか link_over）・EX の実費（actual）。
-- 3. wr_stage を 7 に（関数 work-requests は whoami の sql でこの SQL があるかを見る）。
--
-- 前提：段階 3（20261123090000）と v1164（20261125090000）の SQL。無ければ何も変えずに止める。2 回流しても同じ。
-- 気をつけること：20261104090000・20261120090000 をあとで流し直すと wr_row が前の形に戻る（この SQL をもう一度流す）。

do $$ begin
 if to_regprocedure('public.wr_s3_kind(text)') is null or to_regprocedure('public.wr_exp_kinds(jsonb)') is null or to_regprocedure('public.wr_row(jsonb,public.wr_requests)') is null then
  raise exception 'STOP: 先に段階 3（deploy/work-requests-v1159）と v1164（deploy/expense-g2-v1164）の SQL を流してください（何も変えていません）';
 end if;
end $$;

-- ---------------------------------------------------------------- 実費 → 事前経費
alter table public.wr_requests add column if not exists pre_id uuid references public.wr_requests(id);
alter table public.wr_requests add column if not exists pre_by text;
alter table public.wr_requests add column if not exists pre_emp text;
alter table public.wr_requests add column if not exists pre_at timestamptz;
create index if not exists wr_requests_pre_idx on public.wr_requests(pre_id) where pre_id is not null;
-- 1 つの事前経費に結べる実費は 1 つ（取り下げ・却下になったものは数えない）。関数の中でも確かめる（ここは最後の守り）
create unique index if not exists wr_requests_pre_one on public.wr_requests(pre_id) where pre_id is not null and status not in ('rejected','withdrawn');

-- 同じ申請した人か（社員 ID が両方あればそれで。どちらかが無ければ名前で＝前の画面から写した申請）
create or replace function public.wr_same_requester(r public.wr_requests, x public.wr_requests) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
 select case when r.requester_emp is not null and x.requester_emp is not null then r.requester_emp = x.requester_emp
  else btrim(coalesce(r.requester_name, '')) <> '' and btrim(coalesce(r.requester_name, '')) = btrim(coalesce(x.requester_name, '')) end;
$$;

create or replace function public.wr_cents_text(c bigint) returns text
language sql immutable security invoker set search_path = public, pg_temp as $$
 select case when c is null then '—' else '$' || to_char(c / 100.0, 'FM999,999,990.00') end;
$$;

-- 結べる事前経費の候補（RB を経理が確認できるときだけ）。同じ申請した人の「事前承認済み」・ほかの実費に結んでいないもの・見られるもの
create or replace function public.wr_pre_candidates(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); r public.wr_requests;
begin
 r := public.wr_find(a, p);
 if r.kind <> 'reimburse' or not ('check' = any(public.wr_actions(a, r))) then raise exception 'forbidden'; end if;
 return jsonb_build_object('rb', r.id, 'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'amount_cents', x.amount_cents,
    'use_date', x.use_date, 'store_id', x.store_id, 'purpose', x.payload->>'purpose', 'checked_at', x.checked_at, 'linked', r.pre_id is not distinct from x.id)
    order by x.checked_at desc nulls last, x.code desc), '[]'::jsonb)
  from (select x.* from public.wr_requests x
    where x.kind = 'expense_pre' and x.status = 'done' and public.wr_same_requester(r, x) and public.wr_visible(a, x)
     and not exists (select 1 from public.wr_requests y where y.pre_id = x.id and y.id <> r.id and y.status not in ('rejected','withdrawn'))
    order by x.checked_at desc nulls last, x.code desc limit 50) x));
end $$;

-- 結ぶ・外す。p：{ id|code（RB）, pre（EX の id・null で外す）, expect_rev, client_key }
create or replace function public.wr_link_pre(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v_key text := p->>'client_key'; r public.wr_requests; x public.wr_requests; v_rid uuid; v_ract text;
 v_pre uuid; v_now timestamptz := now(); v_from text; v_to text; v_act text; v_note text; v_over boolean := false;
begin
 if v_key is null or v_key !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'bad_value'; end if;
 if p ? 'pre' and jsonb_typeof(p->'pre') not in ('string','null') then raise exception 'bad_value'; end if;
 if nullif(p->>'pre', '') is not null then
  begin v_pre := (p->>'pre')::uuid; exception when others then raise exception 'bad_value'; end;
 end if;
 perform pg_advisory_xact_lock(hashtext('wr_key:' || v_key));
 select e.request_id, e.action into v_rid, v_ract from public.wr_events e where e.client_key = v_key;
 if v_rid is not null then
  select * into r from public.wr_requests y where y.id = v_rid;
  if not public.wr_visible(a, r) or v_ract not in ('link_pre','link_pre_over','unlink_pre')
     or not (coalesce(p->>'id', '') = r.id::text or coalesce(p->>'code', '') = r.code) then raise exception 'conflict'; end if;
  return public.wr_row(a, r) || jsonb_build_object('replay', true, 'over', v_ract = 'link_pre_over');
 end if;
 r := public.wr_find(a, p);
 -- 2 つの行は id の順に押さえる（逆の順で同時に結んでも止まらない）
 if v_pre is not null then
  perform 1 from public.wr_requests y where y.id in (r.id, v_pre) order by y.id for update;
 end if;
 select * into r from public.wr_requests y where y.id = r.id for update;
 if not (jsonb_typeof(p->'expect_rev') = 'number' and (p->>'expect_rev')::int = r.rev) then raise exception 'conflict'; end if;
 if r.kind <> 'reimburse' or not ('check' = any(public.wr_actions(a, r))) then raise exception 'forbidden'; end if;
 v_from := r.status; v_to := r.status;
 if v_pre is null then
  if r.pre_id is null then raise exception 'bad_value'; end if;
  select * into x from public.wr_requests y where y.id = r.pre_id;
  update public.wr_requests set pre_id = null, pre_by = null, pre_emp = null, pre_at = null where id = r.id;
  v_act := 'unlink_pre'; v_note := '事前経費 ' || coalesce(x.code, '') || ' から外した';
 else
  if r.pre_id is not distinct from v_pre then return public.wr_row(a, r) || jsonb_build_object('same', true); end if;
  select * into x from public.wr_requests y where y.id = v_pre;
  if x.id is null or x.kind <> 'expense_pre' or x.status <> 'done' or not public.wr_same_requester(r, x) or not public.wr_visible(a, x) then raise exception 'pre_bad'; end if;
  if exists (select 1 from public.wr_requests y where y.pre_id = x.id and y.id <> r.id and y.status not in ('rejected','withdrawn')) then raise exception 'pre_taken'; end if;
  v_over := coalesce(r.amount_cents, 0) > coalesce(x.amount_cents, 0);
  if v_over then
   -- 5A：予定を超えた実費は GM の承認をもう一度（承認・確認の記録は履歴に残る）
   update public.wr_requests set pre_id = x.id, pre_by = a->>'name', pre_emp = a->>'emp', pre_at = v_now,
     status = 'pending', approved_by = null, approved_emp = null, approved_at = null where id = r.id;
   v_to := 'pending'; v_act := 'link_pre_over';
   v_note := '事前経費 ' || x.code || '（予定 ' || public.wr_cents_text(x.amount_cents) || '）に結んだ。実費 ' || public.wr_cents_text(r.amount_cents)
     || ' が予定を ' || public.wr_cents_text(coalesce(r.amount_cents, 0) - coalesce(x.amount_cents, 0)) || ' 超えるので、GM の承認をもう一度';
  else
   update public.wr_requests set pre_id = x.id, pre_by = a->>'name', pre_emp = a->>'emp', pre_at = v_now where id = r.id;
   v_act := 'link_pre';
   v_note := '事前経費 ' || x.code || '（予定 ' || public.wr_cents_text(x.amount_cents) || '）に結んだ（実費 ' || public.wr_cents_text(r.amount_cents) || '）';
  end if;
  -- 事前経費の側の履歴にも 1 行（状態・版は変えない）
  insert into public.wr_events(request_id, at, action, from_status, to_status, version, rev, by_emp, by_name, by_role, note)
   values (x.id, v_now, 'actual_linked', x.status, x.status, x.version, x.rev, a->>'emp', a->>'name', a->>'role',
    '実費 ' || r.code || '（' || public.wr_cents_text(r.amount_cents) || '）を結んだ' || case when v_over then '・予定を超えたので GM の承認をもう一度' else '' end);
 end if;
 update public.wr_requests set rev = r.rev + 1, updated_at = v_now where id = r.id returning * into r;
 insert into public.wr_events(request_id, at, action, from_status, to_status, version, rev, by_emp, by_name, by_role, note, client_key)
  values (r.id, v_now, v_act, v_from, v_to, r.version, r.rev, a->>'emp', a->>'name', a->>'role', v_note, v_key);
 return public.wr_row(a, r) || jsonb_build_object('over', v_over);
end $$;

-- ---------------------------------------------------------------- 1 件の答え（20261120090000 の形に足した）
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
  'next', public.wr_next(r), 'mine', public.wr_is_mine(a, r), 'can', to_jsonb(public.wr_actions(a, r)))
  || jsonb_strip_nulls(jsonb_build_object(
   'prev_amount_cents', case when r.version > 1 then (select v.amount_cents from public.wr_versions v where v.request_id = r.id and v.version = r.version - 1) end,
   'link_pre', case when r.pre_id is not null then (select jsonb_build_object('id', x.id, 'code', x.code, 'amount_cents', x.amount_cents, 'status', x.status,
      'purpose', x.payload->>'purpose', 'by', r.pre_by, 'at', r.pre_at) from public.wr_requests x where x.id = r.pre_id) end,
   'link_over', case when r.pre_id is not null then (select coalesce(r.amount_cents, 0) > coalesce(x.amount_cents, 0) from public.wr_requests x where x.id = r.pre_id) end,
   'actual', case when r.kind = 'expense_pre' then (select jsonb_build_object('id', y.id, 'code', y.code, 'amount_cents', y.amount_cents, 'status', y.status)
      from public.wr_requests y where y.pre_id = r.id and y.status not in ('rejected','withdrawn') order by y.created_at desc limit 1) end));
$$;

-- SQL の段（関数 work-requests の whoami が見る。7 ならアプリは「事前経費に結ぶ」を出す）
create or replace function public.wr_stage(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$ select jsonb_build_object('stage', 7) $$;

-- 呼べるのはサーバーの鍵だけ
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('wr_same_requester','wr_cents_text','wr_pre_candidates','wr_link_pre','wr_row','wr_stage') loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;

notify pgrst, 'reload schema';
