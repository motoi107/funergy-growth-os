-- v1190 を戻す：承認・閲覧の共通ルールの前の関数に戻す（20261209090000_approval_rules.sql を入れたあと、困ったときだけ）。
-- 戻すと：今までの決まり（GM・CEO が残りの段も代わりに承認する・wr_visible の今までの見える人）。
-- 残すもの：ルール（ar_rules）・代理（ar_delegates）・一括承認の記録（ar_bulk）・申請の記録（wr_events）・使い始めのスイッチの記録。
-- 承認待ちの申請のルート（wr_requests.route）は記録（wr_events の route_stop）に写してから外す。
-- もう一度 20261209090000 を流したら、CEO・GM が「共通ルールで動かす」をもう一度押すまで今までの決まりのまま。
-- 2 回流しても同じ。
begin;
drop trigger if exists ar_route_trg on public.wr_requests;
do $$ begin
 if to_regclass('public.ar_settings') is not null then
  update public.ar_settings set live = false, rev = rev + 1, updated_at = now() where id = 1 and live;
 end if;
 if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'wr_requests' and column_name = 'route') then
  insert into public.wr_events(request_id, at, action, from_status, to_status, version, rev, by_name, by_role, note, detail)
  select x.id, now(), 'route_stop', x.status, x.status, x.version, x.rev, 'sql', 'sql', '共通ルールを戻した', jsonb_build_object('route', x.route)
   from public.wr_requests x where x.status = 'pending' and x.route is not null;
  update public.wr_requests set route = null where status = 'pending' and route is not null;
 end if;
end $$;
-- wr_visible を戻す（20261104090000_work_requests.sql）
create or replace function public.wr_visible(a jsonb, r public.wr_requests) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select (r.requester_emp is not null and r.requester_emp = a->>'emp')
  or (r.requester_emp is null and r.requester_name = a->>'name')
  or (a->>'role') in ('ceo','gm','office','office_crew')
  or ((a->>'role') = 'am' and r.store_id = any(public.wr_arr(a->'am_stores')))
  or ((a->>'role') = 'staff' and (a->>'grade')::int >= 4 and r.store_id = any(public.wr_arr(a->'stores')));
$$;

-- wr_actions を戻す（20261120090000_work_requests_stage2.sql）
create or replace function public.wr_actions(a jsonb, r public.wr_requests) returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
 if public.wr_is_s2(r.kind) then return public.wr_actions_s2(a, r); end if;
 if r.kind in ('skill','cs','tiprate') then return public.wr_actions_eval(a, r); end if;
 return public.wr_actions_exp(a, r);
end $$;

-- wr_next を戻す（20261120090000_work_requests_stage2.sql）
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

-- wr_row を戻す（20261126090000_wr_approve_v1165.sql）
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

-- wr_act を戻す（20261204090000_wr_exp_grants.sql）
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
 -- 承認待ちを直す・差し戻しを出し直すは、出す権限が今もあるときだけ（取り下げ・承認・経理の操作は変えない）
 if coalesce(p->>'action', '') in ('edit','resubmit') then perform public.wr_exp_right(p, v_kind); end if;
 return public.wr_act_exp(p);
end $$;

-- wr_get を戻す（20261104090000_work_requests.sql）
create or replace function public.wr_get(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); r public.wr_requests;
begin
 r := public.wr_find(a, p);
 return public.wr_row(a, r) || jsonb_build_object(
  'versions', (select coalesce(jsonb_agg(jsonb_build_object('version', v.version, 'payload', v.payload, 'amount_cents', v.amount_cents, 'use_date', v.use_date,
     'by', v.by_name, 'at', v.at, 'note', v.note) order by v.version), '[]'::jsonb) from public.wr_versions v where v.request_id = r.id),
  'events', (select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'action', e.action, 'from', e.from_status, 'to', e.to_status, 'version', e.version,
     'by', e.by_name, 'role', e.by_role, 'note', e.note) order by e.id), '[]'::jsonb) from public.wr_events e where e.request_id = r.id),
  -- 重複の候補（見られるものだけ中身を出す）
  'dups', (select coalesce(jsonb_agg(case when public.wr_visible(a, d) then jsonb_build_object('code', d.code, 'status', d.status, 'requester_name', d.requester_name,
     'amount_cents', d.amount_cents, 'use_date', d.use_date, 'store_id', d.store_id) else jsonb_build_object('code', d.code) end order by d.code), '[]'::jsonb)
   from public.wr_requests d where d.code = any(r.dup_codes)),
  -- 前からの申請：前の画面の今の状態（写したあとに前の画面で変わったか）
  'legacy_now', case when r.legacy then (select case when v is null then jsonb_build_object('found', false)
     else jsonb_build_object('found', true, 'status', v->>'status', 'payStatus', v->>'payStatus', 'archived', coalesce(v->'archived' = 'true'::jsonb, false),
      'deleted', coalesce(v->'_deleted' = 'true'::jsonb, false), 'paid', public.wr_legacy_paid(r)) end from (select public.wr_legacy_src(r) v) z) end);
end $$;

-- wr_whoami を戻す（20261204090000_wr_exp_grants.sql）
create or replace function public.wr_whoami(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); s public.wr_settings;
begin
 select * into s from public.wr_settings where id = 1;
 return jsonb_build_object('me', a, 'live', coalesce(s.live, false), 'settings_rev', coalesce(s.rev, 1), 'live_at', s.live_at, 'settings_at', s.updated_at,
  'rate', public.wr_mileage_rate(),
  's2', coalesce(s.live, false) and coalesce(s.s2_live, false), 's2_at', s.s2_at, 's2_by', s.s2_by,
  'exp_kinds', to_jsonb(public.wr_exp_kinds(a)), 'exp_hq', public.wr_exp_hq(a), 'exp_grants', true, 'exp_base', public.wr_exp_base(a),
  'people', case when (a->>'role') in ('ceo','gm') then (select jsonb_build_object('up', count(*) filter (where x->'up' = 'true'::jsonb), 'changes', count(*),
     'confirmed', (select count(*) from public.wr_people)) from jsonb_array_elements(public.wr_people_items()) x) end);
end $$;

-- wr_stage を戻す（20261126090000_wr_approve_v1165.sql）
create or replace function public.wr_stage(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$ select jsonb_build_object('stage', 7) $$;
notify pgrst, 'reload schema';
commit;
