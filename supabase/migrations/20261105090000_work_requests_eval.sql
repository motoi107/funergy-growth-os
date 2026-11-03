-- v1132：ワークセンターの申請 2 段目（11/02 の依頼の ⑨⑩）。仕様：docs/WORK_REQUESTS_V1132_JA.md
-- 先に 20261104090000_work_requests.sql（1 段目）を流してから。2 回流しても同じ。
--
-- 守ること（1 段目と同じ：サーバーの鍵だけ・PIN の印で入る・同じ送信は 1 回・読んだ版で止める）
--   ・評価の変更 3 種（skill＝スキル Lv・cs＝Career Score・tiprate＝Tip Rate）を出せるのは、GM・CEO が確かめた G4 以上（staff）だけ。
--     AM・GM・CEO は今までどおり直接変える（UI案68 の 6A）。対象は自分の店の、自分より下のグレードの在籍の人（自分・CEO・GM・経理・事務Crew は不可）。
--   ・同じ人・同じ種類の決まっていない申請（承認待ち・差し戻し中・承認済みで反映前・反映エラー）があれば新しく出さない（open_same）。
--   ・決めるのは GM・CEO（承認・差し戻し・却下＝7A）。承認のあと、GM・CEO の端末がアプリの正式な値に反映し、反映の記録（apply）は 1 回だけ。
--     反映できなかったら apply_fail（理由）＝反映エラー。もう一度反映できる。
--   ・スキルマトリクスの「自分の表示設定」（人 × 店・非表示の人の社員 ID・版。9A）は wr_views。自分の分だけ読める・書ける。
--   ・1 段目の wr_submit・wr_act・wr_actions は名前を _exp に変えて残し、種類で振り分ける（1 段目の中身は変えない）。
--     1 段目の SQL をあとで流し直したら、この SQL も流し直す（振り分けが 1 段目の関数で上書きされるため）。

do $$ begin
 if to_regclass('public.wr_requests') is null or (to_regprocedure('public.wr_submit(jsonb)') is null and to_regprocedure('public.wr_submit_exp(jsonb)') is null) then
  raise exception 'STOP: 先に 20261104090000_work_requests.sql（1 段目）を流してください（何も変えていません）';
 end if;
end $$;

create table if not exists public.wr_views (
  emp_id text not null,
  store_id text not null,
  hidden text[] not null default '{}'::text[],
  rev integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (emp_id, store_id)
);
alter table public.wr_views enable row level security;
revoke all on public.wr_views from public, anon, authenticated;
grant select, insert, update, delete on public.wr_views to service_role;

-- 1 段目の関数を 1 回だけ _exp に（2 回目は何もしない）
do $$ begin
 if to_regprocedure('public.wr_submit_exp(jsonb)') is null then alter function public.wr_submit(jsonb) rename to wr_submit_exp; end if;
 if to_regprocedure('public.wr_act_exp(jsonb)') is null then alter function public.wr_act(jsonb) rename to wr_act_exp; end if;
 if to_regprocedure('public.wr_actions_exp(jsonb,public.wr_requests)') is null then alter function public.wr_actions(jsonb, public.wr_requests) rename to wr_actions_exp; end if;
end $$;

-- ---------------------------------------------------------------- 評価の変更の中身
-- 返す：{ payload, target_emp, target_name, effective_date }。a は出す人（G4）。
create or replace function public.wr_norm_eval(a jsonb, p_kind text, p_store text, p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare o jsonb := coalesce(p, '{}'::jsonb); v_t text; e public.employees; live jsonb; v_eff date; x jsonb; n integer; v_top integer;
 v_today date := (timezone('Pacific/Honolulu', now()))::date;
begin
 if jsonb_typeof(o) <> 'object' then raise exception 'bad_value'; end if;
 v_t := o->>'target_emp';
 if v_t is null or v_t !~ '^[A-Za-z0-9_.:-]{1,64}$' then raise exception 'bad_value'; end if;
 if v_t = a->>'emp' then raise exception 'forbidden'; end if;
 select * into e from public.employees y where y.id::text = v_t;
 if not found or public.wr_emp_out(e) then raise exception 'bad_value'; end if;
 if exists (select 1 from public.manager_auth m where m.emp_id::text = v_t and m.role in ('ceo','gm','office','office_crew')) then raise exception 'forbidden'; end if;
 live := public.wr_person_live(v_t);
 if live is null or not (coalesce(p_store, '') = any(public.wr_arr(live->'stores'))) then raise exception 'forbidden'; end if;
 if (live->>'role') = 'am' or (live->>'grade')::int >= (a->>'grade')::int then raise exception 'forbidden'; end if;
 if btrim(coalesce(o->>'reason', '')) = '' or length(o->>'reason') > 600 then raise exception 'bad_value'; end if;
 if p_kind in ('skill','cs') then
  if jsonb_typeof(o->'items') <> 'array' then raise exception 'bad_value'; end if;
  n := jsonb_array_length(o->'items');
  if n < 1 or n > (case when p_kind = 'skill' then 30 else 200 end) then raise exception 'bad_value'; end if;
  v_top := case when p_kind = 'skill' then 5 else 3 end;
  for x in select value from jsonb_array_elements(o->'items') loop
   if jsonb_typeof(x) <> 'object' then raise exception 'bad_value'; end if;
   -- Career Score は「未採点に戻す」（to が null）もある。数ならその範囲の整数
   if not (jsonb_typeof(x->'to') = 'number' or (p_kind = 'cs' and jsonb_typeof(x->'to') = 'null')) then raise exception 'bad_value'; end if;
   if jsonb_typeof(x->'to') = 'number' and ((x->>'to')::numeric not between 0 and v_top or (x->>'to')::numeric <> trunc((x->>'to')::numeric)) then raise exception 'bad_value'; end if;
   if btrim(coalesce(x->>(case when p_kind = 'skill' then 'pos' else 'key' end), '')) = '' then raise exception 'bad_value'; end if;
  end loop;
  if p_kind = 'cs' and btrim(coalesce(o->>'lss_req', '')) = '' then raise exception 'bad_value'; end if;
  v_eff := null;
 elsif p_kind = 'tiprate' then
  if jsonb_typeof(o->'rate_to') <> 'number' or (o->>'rate_to')::numeric not in (80, 90, 100) then raise exception 'bad_value'; end if;
  begin v_eff := (o->>'from_day')::date; exception when others then raise exception 'bad_value'; end;
  if v_eff is null or v_eff < v_today - 31 or v_eff > v_today + 366 then raise exception 'bad_value'; end if;
 else raise exception 'bad_value';
 end if;
 return jsonb_build_object('payload', o || jsonb_build_object('target_name', btrim(coalesce(e.name, ''))), 'target_emp', v_t,
  'target_name', btrim(coalesce(e.name, '')), 'effective_date', v_eff);
end $$;

-- 出せる人：GM・CEO が確かめた G4 以上（staff）で、その店が自分の店
create or replace function public.wr_can_submit_eval(a jsonb, p_store text) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select (a->>'role') = 'staff' and coalesce((a->>'grade')::int, 0) >= 4 and coalesce(a->'confirmed' = 'true'::jsonb, false)
  and coalesce(p_store, '') <> '' and p_store = any(public.wr_arr(a->'stores'));
$$;

-- ---------------------------------------------------------------- 出す（振り分け）
create or replace function public.wr_submit_eval(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v_kind text := p->>'kind'; v_store text := p->>'store_id'; v_key text := p->>'client_key';
 n jsonb; r public.wr_requests; v_now timestamptz := now(); v_rid uuid; v_ract text; v_open text;
begin
 if v_key is null or v_key !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'bad_value'; end if;
 perform pg_advisory_xact_lock(hashtext('wr_key:' || v_key));
 select e.request_id, e.action into v_rid, v_ract from public.wr_events e where e.client_key = v_key;
 if v_rid is not null then
  select * into r from public.wr_requests x where x.id = v_rid;
  if v_ract <> 'submit' or not public.wr_is_owner(a, r) or r.kind <> coalesce(v_kind, '') then raise exception 'conflict'; end if;
  return public.wr_row(a, r) || jsonb_build_object('replay', true);
 end if;
 if not public.wr_live() then raise exception 'not_live'; end if;
 if not public.wr_can_submit_eval(a, v_store) then raise exception 'forbidden'; end if;
 n := public.wr_norm_eval(a, v_kind, v_store, p->'payload');
 -- 同じ人・同じ種類は 1 本ずつ確かめる（同時の 2 本目は 1 本目を見てから）
 perform pg_advisory_xact_lock(hashtext('wr_eval:' || v_kind || ':' || (n->>'target_emp')));
 select x.code into v_open from public.wr_requests x
  where x.kind = v_kind and x.target_emp = n->>'target_emp' and x.status in ('pending','returned','approved','apply_error') order by x.code limit 1;
 if v_open is not null then return jsonb_build_object('open_same', v_open); end if;
 insert into public.wr_requests(code, kind, status, store_id, requester_emp, requester_name, target_emp, target_name, payload, use_date, effective_date,
   submitted_at, created_at, updated_at)
  values (public.wr_new_code(v_kind, v_now), v_kind, 'pending', v_store, a->>'emp', a->>'name', n->>'target_emp', n->>'target_name', n->'payload',
   (timezone('Pacific/Honolulu', v_now))::date, (n->>'effective_date')::date, v_now, v_now, v_now)
  returning * into r;
 insert into public.wr_versions(request_id, version, payload, use_date, effective_date, by_emp, by_name, at)
  values (r.id, 1, r.payload, r.use_date, r.effective_date, a->>'emp', a->>'name', v_now);
 insert into public.wr_events(request_id, at, action, from_status, to_status, version, rev, by_emp, by_name, by_role, client_key)
  values (r.id, v_now, 'submit', null, 'pending', 1, 1, a->>'emp', a->>'name', a->>'role', v_key);
 return public.wr_row(a, r);
end $$;

create or replace function public.wr_submit(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
begin
 if coalesce(p->>'kind', '') in ('skill','cs','tiprate') then return public.wr_submit_eval(p); end if;
 return public.wr_submit_exp(p);
end $$;

-- ---------------------------------------------------------------- できること（振り分け）
create or replace function public.wr_actions_eval(a jsonb, r public.wr_requests) returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare o text[] := '{}'; v_mine boolean := public.wr_is_mine(a, r); v_own boolean := public.wr_is_owner(a, r); v_gm boolean := (a->>'role') in ('ceo','gm');
begin
 if v_own and r.status = 'pending' then o := o || 'edit'::text; end if;
 if v_own and r.status = 'returned' then o := o || 'resubmit'::text; end if;
 if v_own and r.status in ('pending','returned') then o := o || 'withdraw'::text; end if;
 if r.status = 'pending' and v_gm and not v_mine then o := o || array['approve','return','reject']; end if;
 -- 承認のあと反映しない（反映できない・別の値にした など）ときは、理由を書いて閉じる（reject）。閉じないと同じ人・同じ種類を新しく出せない（独立レビュー P2-1）
 if r.status in ('approved','apply_error') and v_gm then o := o || array['apply','apply_fail','reject']; end if;
 return o;
end $$;

create or replace function public.wr_actions(a jsonb, r public.wr_requests) returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
 if r.kind in ('skill','cs','tiprate') then return public.wr_actions_eval(a, r); end if;
 return public.wr_actions_exp(a, r);
end $$;

-- 次にだれが動くか（1 段目の決まり＋評価の変更）
create or replace function public.wr_next(r public.wr_requests) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select case
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

-- ---------------------------------------------------------------- 操作（振り分け）
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
  update public.wr_requests set status = 'rejected', closed_by = a->>'name', closed_at = v_now, close_reason = v_note where id = r.id;
  v_to := 'rejected';
 elsif v_act = 'apply' then
  -- アプリの正式な値に反映した記録（1 回だけ：反映済みになると apply はもう出ない）。note＝反映した中身の要約。
  update public.wr_requests set status = 'applied', closed_by = a->>'name', closed_at = v_now, close_reason = v_note where id = r.id;
  v_to := 'applied';
 elsif v_act = 'apply_fail' then
  update public.wr_requests set status = 'apply_error' where id = r.id;
  v_to := 'apply_error';
 else raise exception 'forbidden';
 end if;

 update public.wr_requests set rev = r.rev + 1, updated_at = v_now where id = r.id returning * into r;
 insert into public.wr_events(request_id, at, action, from_status, to_status, version, rev, by_emp, by_name, by_role, note, client_key)
  values (r.id, v_now, v_act, v_from, v_to, v_ver, r.rev, a->>'emp', a->>'name', a->>'role', v_note, v_key);
 return public.wr_row(a, r);
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
 if v_kind in ('skill','cs','tiprate') then return public.wr_act_eval(p); end if;
 return public.wr_act_exp(p);
end $$;

-- ---------------------------------------------------------------- 一覧（1 段目と同じ。「要対応」に反映（apply）を足した）
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
                     when 'todo' then cardinality(array(select x from unnest(public.wr_actions(a, r)) x where x in ('approve','check','pay','resubmit','dup_ok','apply'))) > 0
                     else true end
   order by r.submitted_at desc, r.code desc limit v_lim) r;
 select jsonb_build_object(
   'todo', count(*) filter (where cardinality(array(select x from unnest(public.wr_actions(a, r)) x where x in ('approve','check','pay','resubmit','dup_ok','apply'))) > 0),
   'returned', count(*) filter (where r.status = 'returned'),
   'waiting_pay', count(*) filter (where r.status in ('approved','checked') and r.kind in ('mileage','reimburse','expense_pre')),
   'stuck7', count(*) filter (where r.status in ('pending','returned','approved','checked','apply_error') and r.updated_at < now() - interval '7 days'),
   'mine_open', count(*) filter (where public.wr_is_mine(a, r)))
  into v_counts
  from public.wr_requests r where public.wr_visible(a, r) and r.status in ('pending','returned','approved','checked','apply_error');
 return jsonb_build_object('rows', v_rows, 'counts', v_counts, 'me', a, 'live', public.wr_live());
end $$;

-- 2 段目の SQL が入っているか（関数 work-requests の whoami が見る。1 段目だけなら呼べない＝前の版と分かる）
create or replace function public.wr_stage(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$ select jsonb_build_object('stage', 2) $$;

-- ---------------------------------------------------------------- スキルマトリクスの「自分の表示設定」（人 × 店）
create or replace function public.wr_view_get(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v_store text := p->>'store'; v public.wr_views;
begin
 if v_store is null or v_store !~ '^[A-Za-z0-9_-]{1,30}$' then raise exception 'bad_value'; end if;
 select * into v from public.wr_views x where x.emp_id = a->>'emp' and x.store_id = v_store;
 return jsonb_build_object('store', v_store, 'hidden', to_jsonb(coalesce(v.hidden, '{}'::text[])), 'rev', coalesce(v.rev, 0), 'updated_at', v.updated_at);
end $$;

create or replace function public.wr_view_save(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v_store text := p->>'store'; v public.wr_views; v_hidden text[]; v_exp integer;
begin
 if v_store is null or v_store !~ '^[A-Za-z0-9_-]{1,30}$' then raise exception 'bad_value'; end if;
 if jsonb_typeof(p->'hidden') <> 'array' or jsonb_array_length(p->'hidden') > 500 or jsonb_typeof(p->'expect_rev') <> 'number' then raise exception 'bad_value'; end if;
 select coalesce(array_agg(distinct x order by x), '{}'::text[]) into v_hidden from jsonb_array_elements_text(p->'hidden') x;
 if exists (select 1 from unnest(v_hidden) x where x !~ '^[A-Za-z0-9_.:-]{1,64}$') then raise exception 'bad_value'; end if;
 v_exp := (p->>'expect_rev')::int;
 select * into v from public.wr_views x where x.emp_id = a->>'emp' and x.store_id = v_store for update;
 if not found then
  if v_exp <> 0 then raise exception 'conflict'; end if;
  insert into public.wr_views(emp_id, store_id, hidden, rev, updated_at) values (a->>'emp', v_store, v_hidden, 1, now())
   on conflict (emp_id, store_id) do nothing returning * into v;
  if v.emp_id is null then raise exception 'conflict'; end if;
 else
  if v.rev <> v_exp then raise exception 'conflict'; end if;
  update public.wr_views set hidden = v_hidden, rev = v.rev + 1, updated_at = now() where emp_id = v.emp_id and store_id = v.store_id returning * into v;
 end if;
 return jsonb_build_object('store', v.store_id, 'hidden', to_jsonb(v.hidden), 'rev', v.rev, 'updated_at', v.updated_at);
end $$;

-- 呼べるのはサーバーの鍵だけ（名前を変えた関数も含めてもう一度）
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'wr\_%' loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;

notify pgrst, 'reload schema';
