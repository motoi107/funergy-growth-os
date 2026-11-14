-- v1159：ワークセンターの申請/承認 段階 3（UI案74 の答え・Moto さん 11/13 18:42 HST「1 はい 2 はい 3 B 4 はい」）。仕様：docs/WORKCENTER_APPROVALS_STAGE3_JA.md
-- 先に段階 2（20261120090000）を流してから。2 回流しても同じ。
--
-- 前の「承認」タブ（共通データ approvals）の記録を、ワークセンターの申請に写す（1A：承認待ちと 2026 年に決まったもの）。
--   承認待ち（2A）：ワークセンターの承認待ちにする（番号は LV・SS などの新しい番号・承認の順は段階 2 と同じ・承認すると今までの画面で 1 回だけ反映）。
--   決まったもの（4：読むだけ）：履歴に写す（承認＝applied・却下＝rejected・取り下げ＝withdrawn。ボタンは無い・もう一度は反映しない）。
--   写すのは GM・CEO の端末（ログインのたびに自動・3B）。端末は前の記録の id と表示用の中身を送る。
--     状態・種類・店・申請した人・決めた人はサーバーが共通データ（app_state の approvals）から読む（端末の言うことは使わない）。
--   もうワークセンターにあるもの（段階 2 の印 wrq・同じ前の記録の id）・2025 年までに決まったもの・消したものは写さない。前の記録は消さない。
--   予算：写した履歴（決まったもの）は、そのあとの予算の申請の版の元にしない（wr_s3_hist）。
--   wr_stage は 6（アプリは 6 のとき前の「承認」タブを閉じる）。
-- 段階 2 の SQL（20261120090000）をあとで流し直すと wr_submit_s2・wr_stage が前に戻るので、この SQL も流し直す。

do $$ begin
 if to_regprocedure('public.wr_s2_steps(text,text,text)') is null or to_regprocedure('public.wr_submit_s2(jsonb)') is null then
  raise exception 'STOP: 先に段階 2 の SQL（deploy/work-requests-v1155）を流してください（何も変えていません）';
 end if;
end $$;

-- 前の記録を写した印（legacy_ref）を見つけやすく
create index if not exists wr_requests_s3_idx on public.wr_requests((legacy_info->>'src')) where legacy;

-- ---------------------------------------------------------------- 前の記録
-- 種類：前の承認タブの type → 段階 2 の kind（アプリの S2_TYPE と同じ）
create or replace function public.wr_s3_kind(p_type text) returns text
language sql immutable security invoker set search_path = public, pg_temp as $$
 select case p_type when '予算' then 'budget' when '休暇' then 'leave' when 'シフト変更' then 'shift' when '採用' then 'hire' when '退職' then 'resign'
  when 'Leadership' then 'promo' when 'TipRate' then 'tip_self' when 'スキル' then 'skill_self' when 'プレップ認定' then 'prep' when '月間行動計画' then 'plan' end;
$$;
-- 前の記録 1 つ（分割の行を先に・新しい印）。無ければ null
create or replace function public.wr_s3_src(p_id text) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select w.x from public.wr_state_rows('approvals') w where jsonb_typeof(w.x) = 'object' and w.x->>'id' = p_id
  order by w.prio, coalesce(case when jsonb_typeof(w.x->'_stT') = 'number' then (w.x->>'_stT')::numeric end,
   case when jsonb_typeof(w.x->'_mut') = 'number' then (w.x->>'_mut')::numeric end, 0) desc
  limit 1;
$$;
-- 決まった日（ハワイ）：decidedAt（ISO）→ 状態の印（_stT・ミリ秒）→ 申請の日（id のミリ秒）
create or replace function public.wr_s3_day(x jsonb) returns date
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v timestamptz;
begin
 if coalesce(x->>'decidedAt', '') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' then
  begin v := (x->>'decidedAt')::timestamptz; exception when others then v := null; end;
 end if;
 if v is null and jsonb_typeof(x->'_stT') = 'number' and (x->>'_stT')::numeric between 1500000000000 and 4102444800000 then
  v := to_timestamp((x->>'_stT')::numeric / 1000.0);
 end if;
 if v is null then v := public.wr_ms_time(x->>'id'); end if;
 return case when v is null then null else (timezone('Pacific/Honolulu', v))::date end;
end $$;
-- 写した履歴（決まったものを写した行）か
create or replace function public.wr_s3_hist(r public.wr_requests) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
 select coalesce(r.legacy, false) and coalesce(r.legacy_info->>'src', '') = 'approvals' and coalesce(r.legacy_info->>'hist', '') = 'true';
$$;
-- 店：端末が送った店の id が、前の記録の店（id か名前・本部の書き方）と同じか
create or replace function public.wr_s3_store_ok(p_store text, p_rec text) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select case
  when p_store = '---' then coalesce(p_rec, '') in ('', '---', '本部', 'office', 'OFFICE', 'HQ')
  else exists (select 1 from public.stores s where s.id::text = p_store and (s.id::text = coalesce(p_rec, '') or btrim(coalesce(s.name, '')) = btrim(coalesce(p_rec, ''))))
 end;
$$;

-- ---------------------------------------------------------------- 写す
-- p.items：[{ ap_id, kind, store_id, payload }]（100 件まで）。返す：{ items:[{ ap_id, result, code? }], known:[写した前の記録の id] }
-- result：pending（承認待ちにした）・history（履歴にした）・known（もうある）・in_wc（段階 2 で出したもの）・old（2025 年までに決まった）・
--   missing（前の記録が無い）・deleted・kind（種類が違う）・store（店が違う）・status（状態が分からない）
create or replace function public.wr_s3_import(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); it jsonb; x jsonb; v_ap text; v_kind text; v_store text; v_st text; v_res text; v_day date; n jsonb; v_pl jsonb;
 v_cents bigint; v_name text; v_emp text; v_steps text[]; v_at timestamptz; v_now timestamptz := now(); r public.wr_requests; v_hist boolean;
 o jsonb := '[]'::jsonb; v_known jsonb;
begin
 if (a->>'role') not in ('ceo','gm') then raise exception 'forbidden'; end if;
 if not public.wr_s2_live() then raise exception 'not_live'; end if;
 if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') > 100 then raise exception 'bad_value'; end if;
 perform pg_advisory_xact_lock(hashtext('wr_s3_import'));
 for it in select jsonb_array_elements(p->'items') loop
  if jsonb_typeof(it) <> 'object' then raise exception 'bad_value'; end if;
  v_ap := it->>'ap_id';
  if coalesce(v_ap, '') !~ '^ap[0-9]{6,20}$' then raise exception 'bad_value'; end if;
  v_res := null; v_hist := false; r := null;
  x := public.wr_s3_src(v_ap);
  v_kind := public.wr_s3_kind(x->>'type');
  v_store := it->>'store_id';
  if x is null then v_res := 'missing';
  elsif coalesce(x->'_deleted' = 'true'::jsonb, false) then v_res := 'deleted';
  elsif v_kind is null or v_kind is distinct from (it->>'kind') then v_res := 'kind';
  elsif coalesce(x->>'wrq', '') in ('1', 'true') then v_res := 'in_wc';
  elsif exists (select 1 from public.wr_requests q where q.ap_id = v_ap or q.legacy_ref = 'ap:' || v_ap) then v_res := 'known';
  elsif coalesce(v_store, '') !~ '^[A-Za-z0-9_-]{1,30}$' or not public.wr_s3_store_ok(v_store, x->>'store') then v_res := 'store';
  else
   v_st := case x->>'status' when 'pending' then 'pending' when 'approved' then 'applied' when 'rejected' then 'rejected' when 'withdrawn' then 'withdrawn' end;
   if v_st is null then v_res := 'status';
   elsif v_st <> 'pending' then
    v_day := public.wr_s3_day(x);
    if v_day is null or v_day < date '2026-01-01' then v_res := 'old'; else v_hist := true; end if;
   end if;
  end if;
  if v_res is null then
   n := public.wr_s2_norm(v_kind, it->'payload');
   v_pl := n->'payload'; v_cents := (n->>'amount_cents')::bigint;
   if v_pl->>'ap_id' is distinct from v_ap then raise exception 'bad_value'; end if;
   -- 履歴の予算：いまの予算の額は承認したときの額と違うことがある → 額と日ごとは残さない
   if v_hist then v_pl := v_pl - 'days' - 'total_cents' - 'basis' - 'focus'; v_cents := null; end if;
   -- 承認待ちの予算：同じ店・同じ月にもう申請があれば、そちら（段階 2 で出た新しい版）を使う
   if v_kind = 'budget' and not v_hist and exists (select 1 from public.wr_requests q where q.kind = 'budget' and q.store_id = v_store
       and q.payload->>'ym' = v_pl->>'ym' and q.status not in ('withdrawn','rejected') and not public.wr_s3_hist(q)) then v_res := 'known'; end if;
  end if;
  if v_res is null then
   v_name := coalesce(nullif(btrim(coalesce(x->>'from', '')), ''), nullif(v_pl->>'from_name', ''), '（記録なし）');
   v_emp := public.wr_emp_by_name(v_name);
   v_steps := case when v_hist then null else public.wr_s2_steps(v_kind, v_store, v_emp) end;
   v_at := coalesce(public.wr_ms_time(v_ap), v_now);
   insert into public.wr_requests(code, kind, status, store_id, requester_emp, requester_name, target_name, payload, amount_cents, use_date,
     steps, step, ap_id, approved_by, closed_by, close_reason, legacy, legacy_ref, legacy_info, submitted_at, created_at, updated_at)
    values (public.wr_new_code(v_kind, v_at), v_kind, v_st, v_store, v_emp, v_name, nullif(btrim(coalesce(v_pl->>'target_name', '')), ''), v_pl, v_cents,
     (timezone('Pacific/Honolulu', v_at))::date, v_steps, v_steps[1], case when v_kind = 'budget' and v_hist then null else v_ap end,
     case when v_st = 'applied' then nullif(x->>'decidedBy', '') end,
     case when v_st in ('rejected','withdrawn') then nullif(x->>'decidedBy', '') end,
     case when v_st = 'rejected' then nullif(left(coalesce(x->>'rejectReason', ''), 400), '') end,
     true, 'ap:' || v_ap,
     jsonb_strip_nulls(jsonb_build_object('src', 'approvals', 'id', v_ap, 'type', x->>'type', 'status', x->>'status', 'hist', case when v_hist then 'true' end,
      'from', x->>'from', 'date', x->>'date', 'decidedBy', x->>'decidedBy', 'decidedAt', x->>'decidedAt', 'decidedDay', v_day, 'rejectReason', left(coalesce(x->>'rejectReason', ''), 400),
      'via', x->>'via', 'by', a->>'name', 'at', v_now)),
     v_at, v_now, v_now)
    returning * into r;
   insert into public.wr_versions(request_id, version, payload, amount_cents, use_date, by_emp, by_name, at, note)
    values (r.id, 1, r.payload, r.amount_cents, r.use_date, v_emp, v_name, v_at, '前の承認タブの記録を写した');
   insert into public.wr_events(request_id, at, action, from_status, to_status, version, rev, by_emp, by_name, by_role, note)
    values (r.id, v_now, 'legacy_import', null, v_st, 1, 1, a->>'emp', a->>'name', a->>'role',
     '前の承認タブの記録（' || case x->>'status' when 'pending' then '承認待ち' when 'approved' then '承認' when 'rejected' then '却下' else '取り下げ' end || '）を写した');
   v_res := case when v_hist then 'history' else 'pending' end;
  end if;
  o := o || jsonb_strip_nulls(jsonb_build_object('ap_id', v_ap, 'result', v_res, 'code', r.code));
 end loop;
 select coalesce(jsonb_agg(q.legacy_info->>'id' order by q.legacy_info->>'id'), '[]'::jsonb) into v_known
  from public.wr_requests q where q.legacy and q.legacy_info->>'src' = 'approvals';
 return jsonb_build_object('items', o, 'known', v_known);
end $$;

-- ---------------------------------------------------------------- 予算の版（段階 2 の wr_submit_s2 に 1 行：写した履歴を版の元にしない）
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
  if v_ract not in ('submit','revise','resubmit') or v_remp is distinct from (a->>'emp') or r.kind <> coalesce(v_kind, '')
     or r.store_id is distinct from v_store then raise exception 'conflict'; end if;
  return public.wr_row(a, r) || jsonb_build_object('replay', true);
 end if;
 if not public.wr_s2_live() then raise exception 'not_live'; end if;
 if not public.wr_is_s2(v_kind) then raise exception 'bad_value'; end if;
 if not public.wr_s2_can_submit(a, v_store) then raise exception 'forbidden'; end if;
 if v_kind = 'budget' and not ((a->>'role') in ('ceo','gm','office','am')
     or ((a->>'role') = 'staff' and coalesce((a->>'grade')::int, 0) >= 3)) then raise exception 'forbidden'; end if;
 n := public.wr_s2_norm(v_kind, p->'payload');
 v_pl := n->'payload';
 v_steps := public.wr_s2_steps(v_kind, v_store, a->>'emp');

 if v_kind = 'budget' then
  perform pg_advisory_xact_lock(hashtext('wr_bg:' || v_store || ':' || (v_pl->>'ym')));
  select * into o from public.wr_requests x where x.kind = 'budget' and x.store_id = v_store and x.payload->>'ym' = v_pl->>'ym'
   and x.status not in ('withdrawn','rejected') and not public.wr_s3_hist(x) order by x.created_at desc limit 1 for update;
  if o.id is not null then
   -- 承認したあとの版を新しい版にできるのは GM・CEO だけ（前の画面の「承認済みは GM 以上」と同じ）
   if o.status in ('approved','apply_error','acct','done','applied') and (a->>'role') not in ('ceo','gm') then raise exception 'forbidden'; end if;
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
  if o.id is not null then
   if o.requester_emp is distinct from (a->>'emp') or o.store_id is distinct from v_store or not public.wr_visible(a, o) then raise exception 'conflict'; end if;
   return public.wr_row(a, o) || jsonb_build_object('replay', true);
  end if;
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

-- SQL の段（関数 work-requests の whoami が見る。6 ならアプリは前の「承認」タブを閉じて写す）
create or replace function public.wr_stage(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$ select jsonb_build_object('stage', 6) $$;

-- 呼べるのはサーバーの鍵だけ
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'wr\_%' loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;

notify pgrst, 'reload schema';
