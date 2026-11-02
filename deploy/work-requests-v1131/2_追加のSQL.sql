-- v1131：ワークセンターの申請（11/02 の依頼の ①〜⑥⑧・UI案68 の決めてほしいこと 1〜10 はおすすめ A で進める）。仕様：docs/WORK_REQUESTS_V1131_JA.md
-- 1 段目：経費 3 種（ガソリン代 mileage・建て替え経費 reimburse・事前経費 expense_pre）。評価の変更 3 種（skill・cs・tiprate）は 2 段目（種類の名前だけ先に入れる）。
--
-- 守ること
--   ・表と関数はサーバーの鍵（service_role）だけ。アプリの鍵（anon）・ログイン（authenticated）では読めない・書けない・呼べない。
--   ・入り方は Edge Function work-requests だけ。PIN のログインの印をそこで確かめ、社員 ID をこの関数に渡す（アプリが送る役割・名前は使わない）。
--   ・役割は、CEO・GM・経理・事務Crew＝manager_auth（サーバーだけの表）の社員とつながったアカウント。AM＝社員の表の役割 am。ほか＝社員の表の肩書き・役割からのグレード。
--   ・同じ送信は 1 回だけ（client_key・wr_events の一意の索引）。同時の変更は rev（読んだ版）で止める（違えば conflict・何も書かない）。
--   ・段階：① 承認（ガソリン代＝その店の AM・AM のいない店は GM。建て替え・事前経費＝GM。CEO・GM はいつも）→ ② 経理の確認（経理・事務Crew）→ ③ 支払・精算（経理・事務Crew・GM・CEO。事前経費は ② で完了）。
--   ・自分の申請は承認・確認・支払・却下できない（取り下げだけ）。却下はその段階を決められる人だけ。経理は差し戻しだけ。
--   ・前の版の承認・確認は履歴に残し、出し直した版にはもう一度もらう。
--   ・重複の候補は自動で消さない・まとめない。申請した人の理由と、承認か経理が「別の経費と確かめた」記録が無いと ③ に進めない。
--   ・前からの申請（app_state の mileage_requests・reimbursements・expense_requests）は wr_legacy_import で写す（2 回流しても同じ・写したあとは新しい表が正）。
--     承認した人・日時・精算の記録が無いものは作り足さない（画面は「記録なし」）。通知・承認の依頼は出し直さない。
--   ・app_state・社員の表・店の表は読むだけ。何も書き換えない。
-- 2 回流しても同じ。止める：update public.wr_settings set live = false;（申請の記録は残る・アプリは前の画面に戻る）

create table if not exists public.wr_settings (
  id smallint primary key default 1 check (id = 1),
  live boolean not null default false,
  live_at timestamptz,
  live_by text,
  rev integer not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.wr_settings(id) values (1) on conflict (id) do nothing;

create table if not exists public.wr_counters (
  prefix text not null,
  ym text not null,
  n integer not null default 0,
  primary key (prefix, ym)
);

create table if not exists public.wr_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  kind text not null check (kind in ('mileage','reimburse','expense_pre','skill','cs','tiprate')),
  status text not null check (status in ('pending','returned','approved','checked','paid','done','rejected','withdrawn','applied','apply_error')),
  store_id text not null,
  requester_emp text,
  requester_name text not null,
  target_emp text,
  target_name text,
  payload jsonb not null default '{}'::jsonb,
  amount_cents bigint,
  use_date date,
  effective_date date,
  version integer not null default 1,
  rev integer not null default 1,
  dup_codes text[] not null default '{}'::text[],
  dup_reason text,
  dup_ok_by text, dup_ok_emp text, dup_ok_at timestamptz, dup_ok_note text,
  approved_by text, approved_emp text, approved_at timestamptz,
  checked_by text, checked_emp text, checked_at timestamptz,
  paid_by text, paid_emp text, paid_at timestamptz, pay_date date, pay_method text,
  returned_by text, returned_at timestamptz, return_reason text,
  closed_by text, closed_at timestamptz, close_reason text,
  legacy boolean not null default false,
  legacy_ref text unique,
  legacy_info jsonb,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wr_requests_status_idx on public.wr_requests(status);
create index if not exists wr_requests_requester_idx on public.wr_requests(requester_emp);
create index if not exists wr_requests_store_idx on public.wr_requests(store_id);

create table if not exists public.wr_versions (
  request_id uuid not null references public.wr_requests(id) on delete cascade,
  version integer not null,
  payload jsonb not null,
  amount_cents bigint,
  use_date date,
  effective_date date,
  by_emp text,
  by_name text,
  at timestamptz not null default now(),
  note text,
  primary key (request_id, version)
);

create table if not exists public.wr_events (
  id bigserial primary key,
  request_id uuid not null references public.wr_requests(id) on delete cascade,
  at timestamptz not null default now(),
  action text not null,
  from_status text,
  to_status text,
  version integer,
  rev integer,
  by_emp text,
  by_name text,
  by_role text,
  note text,
  client_key text unique
);
create index if not exists wr_events_request_idx on public.wr_events(request_id, id);

alter table public.wr_settings enable row level security;
alter table public.wr_counters enable row level security;
alter table public.wr_requests enable row level security;
alter table public.wr_versions enable row level security;
alter table public.wr_events enable row level security;
revoke all on public.wr_settings, public.wr_counters, public.wr_requests, public.wr_versions, public.wr_events from public, anon, authenticated;
grant select, insert, update, delete on public.wr_settings, public.wr_counters, public.wr_requests, public.wr_versions, public.wr_events to service_role;
revoke all on sequence public.wr_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.wr_events_id_seq to service_role;

-- ---------------------------------------------------------------- 人
-- 肩書きと役割からのグレード（アプリの GRADE_TITLES・empGrade・myGradeNum と同じ。大きいほう）
create or replace function public.wr_grade(p_title text, p_role text) returns integer
language sql immutable security invoker set search_path = public, pg_temp as $$
 select greatest(
  case btrim(coalesce(p_title, ''))
   when 'General Manager' then 6
   when 'Area Manager' then 5 when 'Corporate Chef' then 5 when 'Customer Service Manager' then 5
   when 'Store Manager' then 4 when 'Head Chef' then 4 when 'Office Manager' then 4 when 'Accountant' then 4
   when 'Server Leader' then 3 when 'Kitchen Leader' then 3 when 'Operation Leader' then 3 when 'Store Leader' then 3 when 'Accounting Leader' then 3
   when 'Crew Leader' then 2 when 'Office Crew Leader' then 2
   when 'Crew' then 1 when 'Office Crew' then 1 when 'Office Staff' then 1 when 'Prep' then 1 when 'Prep Specialist' then 1
   else 0 end,
  case coalesce(p_role, '') when 'ceo' then 7 when 'gm' then 6 when 'am' then 5 when 'g4' then 4 when 'chef' then 4 when 'sl' then 3 when 'g2' then 2 else 1 end);
$$;

-- 呼んだ人。p：{ emp_id, name }（Edge Function が PIN のログインの印から入れる。名前だけのときは在籍の同じ名前が 1 人のときだけ）。
-- 返す：{ emp, name, role(ceo|gm|office|office_crew|am|staff), grade, stores[], am_stores[] }。退職・OS の無効は forbidden。
create or replace function public.wr_actor(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_emp text := nullif(p->>'emp_id', ''); v_name text := p->>'name'; v_n integer; e public.employees; v_mgr text; v_role text;
 v_stores text[]; v_am text[];
begin
 if v_emp is null then
  if v_name is null or btrim(v_name) = '' or length(v_name) > 80 then raise exception 'forbidden'; end if;
  select count(*), min(x.id::text) into v_n, v_emp from public.employees x where x.name = v_name and coalesce(x.status, '') <> '退職';
  if v_n <> 1 then raise exception 'forbidden'; end if;
 elsif length(v_emp) > 64 then raise exception 'forbidden';
 end if;
 select * into e from public.employees x where x.id::text = v_emp;
 if not found or coalesce(e.status, '') = '退職' or coalesce(e.data->>'status', '') = '退職' or coalesce(e.data->>'osDisabled', '') = 'true' then
  raise exception 'forbidden';
 end if;
 select a.role into v_mgr from public.manager_auth a where a.emp_id::text = v_emp and a.role in ('ceo','gm','office','office_crew')
  order by case a.role when 'gm' then 1 when 'ceo' then 2 when 'office' then 3 else 4 end limit 1;
 v_role := coalesce(v_mgr, case when e.role = 'am' then 'am' else 'staff' end);
 select coalesce(array_agg(distinct s), '{}'::text[]) into v_stores from (
  select nullif(btrim(e.store), '') as s
  union all
  select nullif(btrim(x), '') from jsonb_array_elements_text(case when jsonb_typeof(to_jsonb(e.support)) = 'array' then to_jsonb(e.support) else '[]'::jsonb end) x
 ) q where s is not null;
 if v_role = 'am' then
  select coalesce(array_agg(st.id::text order by st.id::text), '{}'::text[]) into v_am from public.stores st
   where coalesce(st.am, '') <> '' and st.am = e.name and coalesce(st.active, true);
 else v_am := '{}'::text[];
 end if;
 return jsonb_build_object('emp', v_emp, 'name', e.name, 'role', v_role, 'grade', public.wr_grade(e.title, e.role),
  'stores', to_jsonb(v_stores), 'am_stores', to_jsonb(v_am));
end $$;

create or replace function public.wr_arr(j jsonb) returns text[]
language sql immutable security invoker set search_path = public, pg_temp as $$
 select coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end)), '{}'::text[]);
$$;

-- その店の AM の名前（店の表の am 欄・止めた店は無し）。空：AM のいない店（ガソリン代は GM が承認）。
create or replace function public.wr_store_am(p_store text) returns text
language sql stable security invoker set search_path = public, pg_temp as $$
 select nullif(btrim(st.am), '') from public.stores st where st.id::text = p_store and coalesce(st.active, true) limit 1;
$$;

-- 見られるか：申請した人・CEO・GM・経理・事務Crew（全部）・AM（担当の店）・G4（自分の店）。
create or replace function public.wr_visible(a jsonb, r public.wr_requests) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select (r.requester_emp is not null and r.requester_emp = a->>'emp')
  or (r.requester_emp is null and r.requester_name = a->>'name')
  or (a->>'role') in ('ceo','gm','office','office_crew')
  or ((a->>'role') = 'am' and r.store_id = any(public.wr_arr(a->'am_stores')))
  or ((a->>'role') = 'staff' and (a->>'grade')::int >= 4 and r.store_id = any(public.wr_arr(a->'stores')));
$$;

create or replace function public.wr_is_mine(a jsonb, r public.wr_requests) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select (r.requester_emp is not null and r.requester_emp = a->>'emp') or (r.requester_emp is null and r.requester_name = a->>'name');
$$;

-- ① の承認ができる人か（自分の申請は不可）
create or replace function public.wr_can_approve(a jsonb, r public.wr_requests) returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_am text;
begin
 if public.wr_is_mine(a, r) then return false; end if;
 if (a->>'role') in ('ceo','gm') then return true; end if;
 if r.kind = 'mileage' and (a->>'role') = 'am' then
  v_am := public.wr_store_am(r.store_id);
  return v_am is not null and v_am = a->>'name' and r.store_id = any(public.wr_arr(a->'am_stores'));
 end if;
 return false;
end $$;

create or replace function public.wr_is_acct(a jsonb) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$ select (a->>'role') in ('office','office_crew'); $$;

-- 次にだれが動くか（画面の「次の対応」）
create or replace function public.wr_next(r public.wr_requests) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select case
  when r.status = 'pending' and r.kind = 'mileage' and public.wr_store_am(r.store_id) is not null
   then jsonb_build_object('step', 'approve', 'who', 'am', 'name', public.wr_store_am(r.store_id))
  when r.status = 'pending' then jsonb_build_object('step', 'approve', 'who', 'gm')
  when r.status = 'returned' then jsonb_build_object('step', 'fix', 'who', 'requester', 'name', r.requester_name)
  when r.status = 'approved' and r.kind in ('mileage','reimburse','expense_pre') then jsonb_build_object('step', 'check', 'who', 'acct')
  when r.status = 'checked' and r.kind in ('mileage','reimburse') then jsonb_build_object('step', 'pay', 'who', 'acct')
  else null end;
$$;

-- その人がこの申請で今できること
create or replace function public.wr_actions(a jsonb, r public.wr_requests) returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare o text[] := '{}'; v_mine boolean := public.wr_is_mine(a, r); v_dup boolean := cardinality(r.dup_codes) > 0 and r.dup_ok_at is null;
begin
 if r.kind not in ('mileage','reimburse','expense_pre') then return o; end if;
 if v_mine and r.status = 'pending' and not r.legacy then o := o || 'edit'::text; end if;
 if v_mine and r.status = 'returned' and not r.legacy then o := o || 'resubmit'::text; end if;
 if v_mine and r.status in ('pending','returned') then o := o || 'withdraw'::text; end if;
 if r.status = 'pending' and public.wr_can_approve(a, r) then o := o || array['approve','return','reject']; end if;
 if r.status = 'approved' and public.wr_is_acct(a) and not v_mine then o := o || array['check','return']; end if;
 if r.status = 'checked' and r.kind in ('mileage','reimburse') and ((a->>'role') in ('ceo','gm') or public.wr_is_acct(a)) and not v_mine and not v_dup then
  o := o || 'pay'::text;
 end if;
 if v_dup and r.status in ('pending','approved','checked') and not v_mine
    and ((r.status = 'pending' and public.wr_can_approve(a, r)) or ((a->>'role') in ('ceo','gm') or public.wr_is_acct(a))) then
  o := o || 'dup_ok'::text;
 end if;
 -- 1 つ前に戻す：支払 → 経理（経理・事務Crew・GM・CEO）／経理の確認 → 承認（経理・事務Crew）／承認 → 承認待ち（GM・CEO）
 if not v_mine and ((r.status = 'paid' and ((a->>'role') in ('ceo','gm') or public.wr_is_acct(a)))
    or (r.status in ('checked','done') and r.kind in ('mileage','reimburse','expense_pre') and r.checked_at is not null and public.wr_is_acct(a))
    or (r.status = 'approved' and (a->>'role') in ('ceo','gm'))) then
  o := o || 'undo'::text;
 end if;
 return o;
end $$;

-- 画面に返す 1 件（要約）
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
  'next', public.wr_next(r), 'mine', public.wr_is_mine(a, r), 'can', to_jsonb(public.wr_actions(a, r)));
$$;

-- ---------------------------------------------------------------- 番号・重複
create or replace function public.wr_prefix(p_kind text) returns text
language sql immutable security invoker set search_path = public, pg_temp as $$
 select case p_kind when 'mileage' then 'GS' when 'reimburse' then 'RB' when 'expense_pre' then 'EX' when 'skill' then 'SK' when 'cs' then 'CS' when 'tiprate' then 'TR' end;
$$;

-- RB-2611-0007（年月はハワイの日付・月ごとに 1 から）
create or replace function public.wr_new_code(p_kind text, p_at timestamptz) returns text
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_px text := public.wr_prefix(p_kind); v_ym text := to_char(timezone('Pacific/Honolulu', p_at), 'YYMM'); v_n integer;
begin
 if v_px is null then raise exception 'bad_value'; end if;
 insert into public.wr_counters(prefix, ym, n) values (v_px, v_ym, 1)
  on conflict (prefix, ym) do update set n = public.wr_counters.n + 1 returning n into v_n;
 return v_px || '-' || v_ym || '-' || lpad(v_n::text, 4, '0');
end $$;

-- 重複の候補（取り下げ・却下は除く）。ガソリン代・事前経費＝同じ人・同じ日・同じ金額。建て替え＝同じ店・同じ日・同じ金額（だれが出しても）。
create or replace function public.wr_dups(p_kind text, p_store text, p_emp text, p_name text, p_date date, p_cents bigint, p_except uuid) returns text[]
language sql stable security invoker set search_path = public, pg_temp as $$
 select coalesce(array_agg(r.code order by r.code), '{}'::text[]) from public.wr_requests r
  where r.kind = p_kind and r.status not in ('rejected','withdrawn') and (p_except is null or r.id <> p_except)
   and p_date is not null and p_cents is not null and r.use_date = p_date and r.amount_cents = p_cents
   and case when p_kind = 'reimburse' then r.store_id = p_store
            else (p_emp is not null and r.requester_emp = p_emp) or (r.requester_emp is null and r.requester_name = p_name) end;
$$;

-- ---------------------------------------------------------------- 中身（Edge Function が形を整え、ここでもう一度確かめる）
-- ガソリン代の単価：app_state の mileage_config.ratePerMile（読むだけ）。無い・おかしい：no_rate。
create or replace function public.wr_mileage_rate() returns numeric
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v jsonb; x numeric;
begin
 select a.value::jsonb into v from public.app_state a where a.key = 'mileage_config';
 if v is not null and jsonb_typeof(v) = 'object' and v->>'__st' = '1' then v := v->'v'; end if;
 if v is null or jsonb_typeof(v) <> 'object' or jsonb_typeof(v->'ratePerMile') <> 'number' then return null; end if;
 x := (v->>'ratePerMile')::numeric;
 if x <= 0 or x > 5 then return null; end if;
 return x;
end $$;

-- 中身から 金額（セント）・利用日 を決める。返す：{ payload, amount_cents, use_date }
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
 else raise exception 'bad_value';
 end if;
 if v_cents is null or v_cents <= 0 or v_cents > 100000000 then raise exception 'bad_value'; end if;
 return jsonb_build_object('payload', o, 'amount_cents', v_cents, 'use_date', v_date);
end $$;

-- 出せるか：ガソリン代＝G3 以上・AM・GM・CEO。事前経費＝G4 以上・AM・GM・CEO。建て替え＝G2 以上・AM・GM・CEO・経理・事務Crew（今の画面と同じ）。
-- 店：自分の店（所属・応援）。AM は担当の店も。CEO・GM・経理・事務Crew はどの店・本部（---）も。
create or replace function public.wr_can_submit(a jsonb, p_kind text, p_store text) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select case
   when p_kind = 'mileage' then (a->>'role') in ('ceo','gm','am') or (a->>'grade')::int >= 3
   when p_kind = 'expense_pre' then (a->>'role') in ('ceo','gm','am') or (a->>'grade')::int >= 4
   when p_kind = 'reimburse' then (a->>'role') in ('ceo','gm','am','office','office_crew') or (a->>'grade')::int >= 2
   else false end
  and coalesce(p_store, '') <> '' and length(p_store) <= 30
  and ((a->>'role') in ('ceo','gm','office','office_crew') or p_store = any(public.wr_arr(a->'stores'))
       or ((a->>'role') = 'am' and p_store = any(public.wr_arr(a->'am_stores'))));
$$;

create or replace function public.wr_live() returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$ select coalesce((select live from public.wr_settings where id = 1), false); $$;

-- ---------------------------------------------------------------- 読む
create or replace function public.wr_whoami(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); s public.wr_settings;
begin
 select * into s from public.wr_settings where id = 1;
 return jsonb_build_object('me', a, 'live', coalesce(s.live, false), 'settings_rev', coalesce(s.rev, 1), 'live_at', s.live_at,
  'rate', public.wr_mileage_rate());
end $$;

-- p.scope：todo（今わたしが動くもの）・mine（自分の申請）・team（見られる範囲の全部）。p.state：open・closed・all。p.kind・p.store・p.from・p.to（申請日）。
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
                     when 'todo' then cardinality(array(select x from unnest(public.wr_actions(a, r)) x where x in ('approve','check','pay','resubmit','dup_ok'))) > 0
                     else true end
   order by r.submitted_at desc, r.code desc limit v_lim) r;
 -- 上のタイルの数（見られる範囲・未完了）
 select jsonb_build_object(
   'todo', count(*) filter (where cardinality(array(select x from unnest(public.wr_actions(a, r)) x where x in ('approve','check','pay','resubmit','dup_ok'))) > 0),
   'returned', count(*) filter (where r.status = 'returned'),
   'waiting_pay', count(*) filter (where r.status in ('approved','checked')),
   'stuck7', count(*) filter (where r.status in ('pending','returned','approved','checked') and r.updated_at < now() - interval '7 days'),
   'mine_open', count(*) filter (where public.wr_is_mine(a, r)))
  into v_counts
  from public.wr_requests r where public.wr_visible(a, r) and r.status in ('pending','returned','approved','checked','apply_error');
 return jsonb_build_object('rows', v_rows, 'counts', v_counts, 'me', a, 'live', public.wr_live());
end $$;

create or replace function public.wr_find(a jsonb, p jsonb) returns public.wr_requests
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare r public.wr_requests; v_id uuid;
begin
 if nullif(p->>'id', '') is not null then
  begin v_id := (p->>'id')::uuid; exception when others then raise exception 'not_found'; end;
  select * into r from public.wr_requests x where x.id = v_id;
 elsif nullif(p->>'code', '') is not null then
  select * into r from public.wr_requests x where x.code = p->>'code';
 end if;
 if r.id is null or not public.wr_visible(a, r) then raise exception 'not_found'; end if;
 return r;
end $$;

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
   from public.wr_requests d where d.code = any(r.dup_codes)));
end $$;

-- ---------------------------------------------------------------- 出す
-- p：{ emp_id, name, kind, store_id, payload, client_key, dup_reason }。重複の候補があって理由が無い：{ duplicate:[...] }（何も書かない）。
create or replace function public.wr_submit(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v_kind text := p->>'kind'; v_store text := p->>'store_id'; v_key text := p->>'client_key';
 n jsonb; v_dups text[]; v_reason text := nullif(btrim(coalesce(p->>'dup_reason', '')), ''); r public.wr_requests; v_now timestamptz := now(); v_rid uuid;
begin
 if v_key is null or v_key !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'bad_value'; end if;
 select e.request_id into v_rid from public.wr_events e where e.client_key = v_key;
 if v_rid is not null then
  select * into r from public.wr_requests x where x.id = v_rid;
  if not public.wr_is_mine(a, r) then raise exception 'conflict'; end if;
  return public.wr_row(a, r) || jsonb_build_object('replay', true);
 end if;
 if not public.wr_live() then raise exception 'not_live'; end if;
 if v_kind not in ('mileage','reimburse','expense_pre') then raise exception 'bad_value'; end if;
 if not public.wr_can_submit(a, v_kind, v_store) then raise exception 'forbidden'; end if;
 if v_reason is not null and length(v_reason) > 400 then raise exception 'bad_value'; end if;
 n := public.wr_norm(v_kind, p->'payload');
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

-- ---------------------------------------------------------------- 動かす
-- p：{ emp_id, name, id|code, action, expect_rev, client_key, note, payload, dup_reason, pay_date, pay_method }
--   edit（承認待ちの中身を直す）・resubmit（差し戻しを直して出し直す）・withdraw（取り下げ）・approve・return（差し戻し・理由）・reject（却下・理由）
--   check（経理の確認）・pay（支払・精算：日付と方法）・dup_ok（別の経費と確かめた・理由）・undo（1 つ前に戻す・理由）
create or replace function public.wr_act(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v_act text := p->>'action'; v_key text := p->>'client_key'; v_note text := nullif(btrim(coalesce(p->>'note', '')), '');
 r public.wr_requests; v_rid uuid; v_from text; v_to text; v_can text[]; n jsonb; v_now timestamptz := now(); v_dups text[]; v_reason text;
 v_pd date; v_pm text; v_ver integer;
begin
 if v_key is null or v_key !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'bad_value'; end if;
 if v_note is not null and length(v_note) > 400 then raise exception 'bad_value'; end if;
 select e.request_id into v_rid from public.wr_events e where e.client_key = v_key;
 if v_rid is not null then
  select * into r from public.wr_requests x where x.id = v_rid;
  if not public.wr_visible(a, r) then raise exception 'conflict'; end if;
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
  v_to := case when r.kind = 'expense_pre' then 'done' else 'checked' end;
  update public.wr_requests set status = v_to, checked_by = a->>'name', checked_emp = a->>'emp', checked_at = v_now where id = r.id;
 elsif v_act = 'pay' then
  begin v_pd := (p->>'pay_date')::date; exception when others then raise exception 'bad_value'; end;
  v_pm := nullif(btrim(coalesce(p->>'pay_method', '')), '');
  if v_pd is null or v_pd < date '2020-01-01' or v_pd > (timezone('Pacific/Honolulu', v_now))::date + 31 or v_pm is null or length(v_pm) > 60 then raise exception 'bad_value'; end if;
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

-- ---------------------------------------------------------------- 前からの申請を写す（GM・CEO・2 回流しても同じ）
create or replace function public.wr_state_rows(p_base text) returns setof jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select x from public.app_state s,
  lateral (select case when jsonb_typeof(s.value::jsonb) = 'object' and s.value::jsonb->>'__st' = '1' then s.value::jsonb->'v' else s.value::jsonb end as v) w,
  lateral jsonb_array_elements(case when jsonb_typeof(w.v) = 'array' then w.v else '[]'::jsonb end) x
 where s.key = p_base or s.key like 'spl\_' || replace(p_base, '_', '\_') || '\_%';
$$;

-- 経理の確認（承認センターの approvals の acct・取り消していないもの）：記録の id → { by, at }
create or replace function public.wr_legacy_acct() returns table(ref text, by_name text, at_text text)
language sql stable security invoker set search_path = public, pg_temp as $$
 select distinct on (x->>'ref') x->>'ref', x->'acct'->>'by', x->'acct'->>'at' from public.wr_state_rows('approvals') x
  where coalesce(x->>'ref', '') <> '' and jsonb_typeof(x->'acct') = 'object' and coalesce((x->'acct'->>'off')::boolean, false) = false
  order by x->>'ref', (x->'acct'->>'t') desc nulls last;
$$;

create or replace function public.wr_ms_time(p_id text) returns timestamptz
language sql immutable security invoker set search_path = public, pg_temp as $$
 select case when p_id ~ '^[a-z]{2}[0-9]{13}' then to_timestamp(substring(p_id from 3 for 13)::bigint / 1000.0) end;
$$;

create or replace function public.wr_safe_date(t text) returns date
language plpgsql immutable security invoker set search_path = public, pg_temp as $$
begin
 if t is null or t !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then return null; end if;
 return t::date;
exception when others then return null;
end $$;

create or replace function public.wr_emp_by_name(p_name text) returns text
language sql stable security invoker set search_path = public, pg_temp as $$
 select case when count(*) = 1 then min(e.id::text) end from public.employees e where coalesce(p_name, '') <> '' and e.name = p_name;
$$;

create or replace function public.wr_legacy_import(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); x jsonb; v_kind text; v_ref text; v_st text; v_accts jsonb; v_acct jsonb; v_at timestamptz; v_ins integer := 0; v_skip integer := 0;
 v_name text; v_cents bigint; r public.wr_requests;
begin
 if (a->>'role') not in ('ceo','gm') then raise exception 'forbidden'; end if;
 perform pg_advisory_xact_lock(hashtext('wr_legacy_import'));
 select coalesce(jsonb_object_agg(l.ref, jsonb_build_object('by', l.by_name, 'at', l.at_text)), '{}'::jsonb) into v_accts from public.wr_legacy_acct() l;
 for v_kind, x in
  select 'mileage', y from public.wr_state_rows('mileage_requests') y
  union all select 'reimburse', y from public.wr_state_rows('reimbursements') y
  union all select 'expense_pre', y from public.wr_state_rows('expense_requests') y
 loop
  if jsonb_typeof(x) <> 'object' or coalesce(x->>'id', '') = '' or coalesce((x->>'_deleted')::boolean, false) then v_skip := v_skip + 1; continue; end if;
  v_ref := public.wr_prefix(v_kind) || ':' || (x->>'id');
  if exists (select 1 from public.wr_requests q where q.legacy_ref = v_ref) then v_skip := v_skip + 1; continue; end if;
  v_acct := v_accts->(x->>'id');
  v_cents := case when jsonb_typeof(case when v_kind = 'expense_pre' then x->'total' else x->'amount' end) = 'number'
   then round((case when v_kind = 'expense_pre' then x->>'total' else x->>'amount' end)::numeric * 100) end;
  v_st := case
   when x->>'status' = '却下' then 'rejected'
   when x->>'status' = '申請中' then 'pending'
   when x->>'status' = '承認' and v_kind = 'mileage' and coalesce((x->>'archived')::boolean, false) then 'paid'
   when x->>'status' = '承認' and v_kind = 'reimburse' and x->>'payStatus' = '支払済' then 'paid'
   when x->>'status' = '承認' and v_acct is not null then case when v_kind = 'expense_pre' then 'done' else 'checked' end
   when x->>'status' = '承認' then 'approved'
   else null end;
  if v_st is null then v_skip := v_skip + 1; continue; end if;
  v_name := coalesce(nullif(case when v_kind = 'reimburse' then coalesce(nullif(x->>'byUser', ''), x->>'payer') else x->>'employee' end, ''), '（記録なし）');
  v_at := coalesce(public.wr_ms_time(x->>'id'), now());
  insert into public.wr_requests(code, kind, status, store_id, requester_emp, requester_name, payload, amount_cents, use_date,
    approved_by, checked_by, paid_by, pay_method, closed_by, close_reason, legacy, legacy_ref, legacy_info, submitted_at, created_at, updated_at)
   values (public.wr_new_code(v_kind, v_at), v_kind, v_st, coalesce(nullif(x->>'storeId', ''), '---'), public.wr_emp_by_name(v_name), v_name, x, v_cents,
    public.wr_safe_date(x->>'date'),
    case when v_st not in ('pending','rejected') then nullif(x->>'approvedBy', '') end, case when v_acct is not null and v_st in ('checked','done','paid') then v_acct->>'by' end,
    case when v_st = 'paid' then coalesce(nullif(x->>'paidBy', ''), nullif(x->>'archivedBy', '')) end,
    case when v_st = 'paid' then coalesce(nullif(x->>'payMethodNote', ''), case when v_kind = 'mileage' then '月末処理' end) end,
    case when v_st = 'rejected' then nullif(x->>'approvedBy', '') end, case when v_st = 'rejected' then nullif(x->>'rejectReason', '') end,
    true, v_ref,
    jsonb_build_object('src', case v_kind when 'mileage' then 'mileage_requests' when 'reimburse' then 'reimbursements' else 'expense_requests' end,
     'id', x->>'id', 'status', x->>'status', 'approvedBy', x->>'approvedBy', 'approvedAt', x->>'approvedAt', 'createdAt', x->>'createdAt',
     'acctBy', v_acct->>'by', 'acctAt', v_acct->>'at', 'payStatus', x->>'payStatus', 'paidBy', coalesce(nullif(x->>'paidBy', ''), x->>'archivedBy'),
     'paidAt', coalesce(nullif(x->>'paidAt', ''), x->>'archivedAt'), 'archivedMonth', x->>'archivedMonth', 'rejectReason', x->>'rejectReason',
     'rejectedButPaid', (x->>'status' = '却下' and x->>'payStatus' = '支払済')),
    v_at, now(), now())
   returning * into r;
  insert into public.wr_versions(request_id, version, payload, amount_cents, use_date, by_name, at, note)
   values (r.id, 1, r.payload, r.amount_cents, r.use_date, v_name, v_at, '前からの申請を写した');
  insert into public.wr_events(request_id, at, action, from_status, to_status, version, rev, by_emp, by_name, by_role, note)
   values (r.id, now(), 'legacy_import', null, v_st, 1, 1, a->>'emp', a->>'name', a->>'role', '前の画面の記録（' || coalesce(x->>'status', '') || '）を写した');
  v_ins := v_ins + 1;
 end loop;
 return jsonb_build_object('inserted', v_ins, 'skipped', v_skip);
end $$;

-- 使い始め・止める（GM・CEO・読んだ版で）。使い始めるときは前からの申請を写してから。
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
 return jsonb_build_object('live', s.live, 'settings_rev', s.rev, 'live_at', s.live_at, 'imported', v_imp);
end $$;

-- 呼べるのはサーバーの鍵だけ
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'wr\_%' loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;

notify pgrst, 'reload schema';
