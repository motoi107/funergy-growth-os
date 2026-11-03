-- v1131：ワークセンターの申請（11/02 の依頼の ①〜⑥⑧・UI案68 の決めてほしいこと 1〜10 はおすすめ A で進める）。仕様：docs/WORK_REQUESTS_V1131_JA.md
-- 1 段目：経費 3 種（ガソリン代 mileage・建て替え経費 reimburse・事前経費 expense_pre）。評価の変更 3 種（skill・cs・tiprate）は 2 段目（種類の名前だけ先に入れる）。
--
-- 守ること
--   ・表と関数はサーバーの鍵（service_role）だけ。アプリの鍵（anon）・ログイン（authenticated）では読めない・書けない・呼べない。
--   ・入り方は Edge Function work-requests だけ。PIN のログインの印をそこで確かめ、社員 ID をこの関数に渡す（アプリが送る役割・名前は使わない）。
--   ・役割は、CEO・GM・経理・事務Crew＝manager_auth（サーバーだけの表）の社員とつながったアカウント。
--     AM・G4 以上と担当の店（承認・店の申請を見ることに関わる権限）は、GM・CEO が確かめた写し wr_people（サーバーだけの表）と、今の社員の表の狭いほう。
--     社員の表は公開の鍵で書けるので、社員の表で権限が増えても GM・CEO が確かめる（wr_people_sync）まで効かない。減るほうはすぐ効く（#123 のレビュー P1）。
--     写しの無い人は G3 まで（自分の申請を出すだけ・店の申請は見られない）。
--   ・同じ送信は 1 回だけ（client_key・wr_events の一意の索引）。同時の変更は rev（読んだ版）で止める（違えば conflict・何も書かない）。
--   ・段階：① 承認（ガソリン代＝その店の AM・AM のいない店は GM。建て替え・事前経費＝GM。CEO・GM はいつも）→ ② 経理の確認（経理・事務Crew）→ ③ 支払・精算（経理・事務Crew・GM・CEO。事前経費は ② で完了）。
--   ・自分の申請は承認・確認・支払・却下できない（取り下げだけ）。却下はその段階を決められる人だけ。経理は差し戻しだけ。
--   ・前の版の承認・確認は履歴に残し、出し直した版にはもう一度もらう。
--   ・重複の候補は自動で消さない・まとめない。申請した人の理由と、承認か経理が「別の経費と確かめた」記録が無いと ③ に進めない。
--   ・前からの申請（app_state の mileage_requests・reimbursements・expense_requests）は wr_legacy_import で写す（2 回流しても同じ・写したあとは新しい表が正）。
--     承認した人・日時・精算の記録が無いものは作り足さない（画面は「記録なし」）。通知・承認の依頼は出し直さない。
--   ・重複の確かめは、同じ種類・日付・金額の送信を 1 本ずつ（advisory lock）にしてから探す。精算の前にもう一度探す（#123 のレビュー P2）。
--   ・前からの申請で社員 ID の分かるものは、差し戻し → 本人が直して出し直す（同じ番号・版が上がる）。分からないものは差し戻せない（承認か却下）。
--     前の画面で精算済みになったものを精算するときは止めて確かめる（legacy_paid）。
--   ・app_state・社員の表・店の表は読むだけ。書くのは app_state の wr_live（使い始めた／止めたの印）1 行だけ。
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
-- 同じ鍵の 2 回目は同じ操作・同じ申請のときだけ「同じ 1 回」とみなす（ほかの操作の鍵を使い回すと conflict）

create index if not exists wr_events_request_idx on public.wr_events(request_id, id);

-- 承認・閲覧の権限の写し（GM・CEO が確かめたもの）。AM か・グレード・所属と応援の店・AM の担当の店。
-- 社員の表（公開の鍵で書ける）で権限が増えても、ここを GM・CEO が更新するまで効かない（#123 のレビュー P1）。
create table if not exists public.wr_people (
  emp_id text primary key,
  name text not null,
  role text not null check (role in ('am','staff')),
  grade integer not null,
  stores text[] not null default '{}'::text[],
  am_stores text[] not null default '{}'::text[],
  confirmed_by text, confirmed_emp text,
  confirmed_at timestamptz not null default now()
);
create table if not exists public.wr_people_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  emp_id text not null,
  before jsonb,
  after jsonb,
  by_emp text, by_name text
);

alter table public.wr_settings enable row level security;
alter table public.wr_counters enable row level security;
alter table public.wr_requests enable row level security;
alter table public.wr_versions enable row level security;
alter table public.wr_events enable row level security;
alter table public.wr_people enable row level security;
alter table public.wr_people_log enable row level security;
revoke all on public.wr_settings, public.wr_counters, public.wr_requests, public.wr_versions, public.wr_events, public.wr_people, public.wr_people_log from public, anon, authenticated;
grant select, insert, update, delete on public.wr_settings, public.wr_counters, public.wr_requests, public.wr_versions, public.wr_events, public.wr_people, public.wr_people_log to service_role;
revoke all on sequence public.wr_events_id_seq, public.wr_people_log_id_seq from public, anon, authenticated;
grant usage, select on sequence public.wr_events_id_seq, public.wr_people_log_id_seq to service_role;

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

-- 退職・OS の無効
create or replace function public.wr_emp_out(e public.employees) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
 select coalesce(e.status, '') = '退職' or coalesce(e.data->>'status', '') = '退職' or coalesce(e.data->>'osDisabled', '') = 'true';
$$;

create or replace function public.wr_arr(j jsonb) returns text[]
language sql immutable security invoker set search_path = public, pg_temp as $$
 select coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end)), '{}'::text[]);
$$;

-- 2 つの店の並びの重なり（並べて返す）
create or replace function public.wr_meet(a text[], b text[]) returns text[]
language sql immutable security invoker set search_path = public, pg_temp as $$
 select coalesce(array(select x from unnest(coalesce(a, '{}'::text[])) x where x = any(coalesce(b, '{}'::text[])) group by x order by x), '{}'::text[]);
$$;

-- 今の社員の表と店の表から見た人（公開の鍵で書ける表なので、権限を増やすことには使わない）。
-- 返す：{ emp, name, role(am|staff), grade, stores[], am_stores[] }。いない・退職・OS の無効は null。
create or replace function public.wr_person_live(p_emp text) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare e public.employees; v_stores text[]; v_am text[];
begin
 select * into e from public.employees x where x.id::text = p_emp;
 if not found or public.wr_emp_out(e) then return null; end if;
 select coalesce(array_agg(distinct s order by s), '{}'::text[]) into v_stores from (
  select nullif(btrim(e.store), '') as s
  union all
  select nullif(btrim(x), '') from jsonb_array_elements_text(case when jsonb_typeof(to_jsonb(e.support)) = 'array' then to_jsonb(e.support) else '[]'::jsonb end) x
 ) q where s is not null;
 if e.role = 'am' then
  select coalesce(array_agg(st.id::text order by st.id::text), '{}'::text[]) into v_am from public.stores st
   where btrim(coalesce(st.am, '')) <> '' and btrim(st.am) = btrim(e.name) and coalesce(st.active, true);
 else v_am := '{}'::text[];
 end if;
 return jsonb_build_object('emp', p_emp, 'name', btrim(coalesce(e.name, '')), 'role', case when e.role = 'am' then 'am' else 'staff' end,
  'grade', public.wr_grade(e.title, e.role), 'stores', to_jsonb(v_stores), 'am_stores', to_jsonb(v_am));
end $$;

-- 承認・店の申請を見ることに関わる権限があるか（AM か G4 以上）
create or replace function public.wr_elevated(x jsonb) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
 select x is not null and jsonb_typeof(x) = 'object' and ((x->>'role') = 'am' or coalesce((x->>'grade')::int, 0) >= 4);
$$;

-- GM・CEO が確かめた写し（同じ形）。無ければ null。
create or replace function public.wr_person_conf(p_emp text) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select jsonb_build_object('emp', c.emp_id, 'name', c.name, 'role', c.role, 'grade', c.grade, 'stores', to_jsonb(c.stores), 'am_stores', to_jsonb(c.am_stores))
  from public.wr_people c where c.emp_id = p_emp;
$$;

-- 写し（before）より今（after）のほうが権限が増えるか（AM になる・グレードが上がる・店が増える・名前が変わる）
create or replace function public.wr_up(b jsonb, a jsonb) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
 select public.wr_elevated(a) and (b is null
  or ((a->>'role') = 'am' and (b->>'role') <> 'am')
  or (a->>'grade')::int > (b->>'grade')::int
  or not (public.wr_arr(a->'stores') <@ public.wr_arr(b->'stores'))
  or not (public.wr_arr(a->'am_stores') <@ public.wr_arr(b->'am_stores'))
  or (a->>'name') is distinct from (b->>'name'));
$$;

-- 呼んだ人。p：{ emp_id, name }（Edge Function が PIN のログインの印から入れる）。社員 ID の無いものは断る（名前は社員の表＝公開の鍵で書ける表で引くことになるため。独立レビュー 272b159 の B）。
-- 返す：{ emp, name, role(ceo|gm|office|office_crew|am|staff), grade, stores[], am_stores[], confirmed, pending }。退職・OS の無効は forbidden。
-- AM・G4 以上と担当の店は、GM・CEO が確かめた写し（wr_people）と今の社員の表の狭いほう（#123 のレビュー P1）：
--   ・role am：写しも今も am のとき。am_stores：写しと今の重なり。grade：小さいほう。G4 以上の stores：写しと今の重なり。
--   ・写しの無い人：staff・grade は 3 まで・stores は今の社員の表（自分の申請を出すだけ。店の申請は見られない）。
--   ・名前：写しの名前、無ければ PIN の印の名前（印は auth-pin が署名したもの）、無ければ社員の表。
create or replace function public.wr_actor(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_emp text := nullif(p->>'emp_id', ''); e public.employees; v_mgr text;
 live jsonb; conf jsonb; v_role text; v_grade integer; v_stores text[]; v_am text[]; v_nm text;
begin
 if v_emp is null or length(v_emp) > 64 then raise exception 'forbidden'; end if;
 select * into e from public.employees x where x.id::text = v_emp;
 if not found or public.wr_emp_out(e) then raise exception 'forbidden'; end if;
 v_nm := coalesce(nullif(btrim(coalesce(p->>'name', '')), ''), btrim(coalesce(e.name, '')));
 select a.role into v_mgr from public.manager_auth a where a.emp_id::text = v_emp and a.role in ('ceo','gm','office','office_crew')
  order by case a.role when 'gm' then 1 when 'ceo' then 2 when 'office' then 3 else 4 end limit 1;
 if v_mgr is not null then
  return jsonb_build_object('emp', v_emp, 'name', v_nm, 'role', v_mgr, 'grade', public.wr_grade(e.title, v_mgr),
   'stores', '[]'::jsonb, 'am_stores', '[]'::jsonb, 'confirmed', true, 'pending', false);
 end if;
 live := public.wr_person_live(v_emp);
 conf := public.wr_person_conf(v_emp);
 if conf is not null then
  v_role := case when (conf->>'role') = 'am' and (live->>'role') = 'am' then 'am' else 'staff' end;
  v_grade := least((conf->>'grade')::int, (live->>'grade')::int);
  v_am := case when v_role = 'am' then public.wr_meet(public.wr_arr(conf->'am_stores'), public.wr_arr(live->'am_stores')) else '{}'::text[] end;
  v_stores := case when v_role = 'am' or v_grade >= 4 then public.wr_meet(public.wr_arr(conf->'stores'), public.wr_arr(live->'stores')) else public.wr_arr(live->'stores') end;
  v_nm := conf->>'name';
 else
  v_role := 'staff'; v_grade := least((live->>'grade')::int, 3); v_stores := public.wr_arr(live->'stores'); v_am := '{}'::text[];
 end if;
 return jsonb_build_object('emp', v_emp, 'name', v_nm, 'role', v_role, 'grade', v_grade, 'stores', to_jsonb(v_stores), 'am_stores', to_jsonb(v_am),
  'confirmed', conf is not null, 'pending', public.wr_up(conf, live));
end $$;


-- 前の版（19227fd まで）の関数の形が違うので作り直す（返す形が text → jsonb）。wr_store_am はもう使わない。
drop function if exists public.wr_approver_am(public.wr_requests);
drop function if exists public.wr_store_am(text);

-- ガソリン代の ① を決める AM：GM・CEO が確かめた写しで AM・その店の担当で、今も在籍の AM（社員の表の役割 am）で、
-- 今も店の表の AM 欄がその人で、申請した本人でない人が 1 人だけのとき。ほかは GM（null）。返す：{ emp, name }。
-- 画面の「次の対応」・知らせ・承認できるかを同じ決まりで決める（独立レビュー P2-2・#123 のレビュー P1：社員の表・店の表は狭めることにだけ使う）。
create or replace function public.wr_approver_am(r public.wr_requests) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select case when count(*) = 1 then jsonb_build_object('emp', min(c.emp_id), 'name', min(c.name)) end
  from public.wr_people c join public.employees e on e.id::text = c.emp_id
  where c.role = 'am' and r.store_id = any(c.am_stores)
   and e.role = 'am' and not public.wr_emp_out(e)
   and exists (select 1 from public.stores st where st.id::text = r.store_id and coalesce(st.active, true) and btrim(coalesce(st.am, '')) = btrim(coalesce(e.name, '')))
   and c.emp_id is distinct from r.requester_emp
   and btrim(c.name) <> btrim(coalesce(r.requester_name, ''));
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

-- 本人として直す・取り下げる：社員 ID が同じときだけ（前からの申請で社員 ID の無いものは、名前を変えた人が取れないように本人の操作はできない）
create or replace function public.wr_is_owner(a jsonb, r public.wr_requests) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select r.requester_emp is not null and r.requester_emp = a->>'emp';
$$;

-- ① の承認ができる人か（自分の申請は不可）
create or replace function public.wr_can_approve(a jsonb, r public.wr_requests) returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_am jsonb;
begin
 if public.wr_is_mine(a, r) then return false; end if;
 if (a->>'role') in ('ceo','gm') then return true; end if;
 if r.kind = 'mileage' and (a->>'role') = 'am' then
  v_am := public.wr_approver_am(r);
  return v_am is not null and (v_am->>'emp') = (a->>'emp') and r.store_id = any(public.wr_arr(a->'am_stores'));
 end if;
 return false;
end $$;

create or replace function public.wr_is_acct(a jsonb) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$ select (a->>'role') in ('office','office_crew'); $$;

-- 次にだれが動くか（画面の「次の対応」）
create or replace function public.wr_next(r public.wr_requests) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select case
  when r.status = 'pending' and r.kind = 'mileage' and public.wr_approver_am(r) is not null
   then jsonb_build_object('step', 'approve', 'who', 'am', 'name', public.wr_approver_am(r)->>'name')
  when r.status = 'pending' then jsonb_build_object('step', 'approve', 'who', 'gm')
  when r.status = 'returned' then jsonb_build_object('step', 'fix', 'who', 'requester', 'name', r.requester_name)
  when r.status = 'approved' and r.kind in ('mileage','reimburse','expense_pre') then jsonb_build_object('step', 'check', 'who', 'acct')
  when r.status = 'checked' and r.kind in ('mileage','reimburse') then jsonb_build_object('step', 'pay', 'who', 'acct')
  else null end;
$$;

-- その人がこの申請で今できること
create or replace function public.wr_actions(a jsonb, r public.wr_requests) returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare o text[] := '{}'; v_mine boolean := public.wr_is_mine(a, r); v_own boolean := public.wr_is_owner(a, r);
 v_dup boolean := cardinality(r.dup_codes) > 0 and r.dup_ok_at is null;
begin
 if r.kind not in ('mileage','reimburse','expense_pre') then return o; end if;
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
    or (r.status in ('checked','done') and r.kind in ('mileage','reimburse','expense_pre') and public.wr_is_acct(a))
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
 return v_px || '-' || v_ym || '-' || lpad(v_n::text, greatest(4, length(v_n::text)), '0');
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

-- 重複を探す前に、同じ種類・日付・金額の送信を 1 本ずつにする（別の client_key の 2 本が同時に来ても、2 本目は 1 本目を見てから探す・#123 のレビュー P2）。
-- READ COMMITTED なので、鍵を取ったあとの問い合わせは 1 本目がコミットした行を見る。鍵はトランザクションの終わりまで。
create or replace function public.wr_dup_lock(p_kind text, p_date date, p_cents bigint) returns void
language sql volatile security invoker set search_path = public, pg_temp as $$
 select pg_advisory_xact_lock(hashtext('wr_dup:' || coalesce(p_kind, '') || ':' || coalesce(p_date::text, '') || ':' || coalesce(p_cents::text, '')));
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
 return jsonb_build_object('me', a, 'live', coalesce(s.live, false), 'settings_rev', coalesce(s.rev, 1), 'live_at', s.live_at, 'settings_at', s.updated_at,
  'rate', public.wr_mileage_rate(),
  -- GM・CEO だけ：権限の写しと社員の表の違い（増える人・違う人の数）
  'people', case when (a->>'role') in ('ceo','gm') then (select jsonb_build_object('up', count(*) filter (where x->'up' = 'true'::jsonb), 'changes', count(*),
     'confirmed', (select count(*) from public.wr_people)) from jsonb_array_elements(public.wr_people_items()) x) end);
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
   from public.wr_requests d where d.code = any(r.dup_codes)),
  -- 前からの申請：前の画面の今の状態（写したあとに前の画面で変わったか）
  'legacy_now', case when r.legacy then (select case when v is null then jsonb_build_object('found', false)
     else jsonb_build_object('found', true, 'status', v->>'status', 'payStatus', v->>'payStatus', 'archived', coalesce(v->'archived' = 'true'::jsonb, false),
      'deleted', coalesce(v->'_deleted' = 'true'::jsonb, false), 'paid', public.wr_legacy_paid(r)) end from (select public.wr_legacy_src(r) v) z) end);
end $$;

-- ---------------------------------------------------------------- 承認・閲覧の権限の写し（GM・CEO が確かめる・#123 のレビュー P1）
-- 写し（before）と今の社員の表・店の表（after。AM・G4 以上でなければ null＝写しから外す）の違い。up＝権限が増える（確かめるまで効かない）。
create or replace function public.wr_people_items() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 -- CEO・GM・経理・事務Crew は manager_auth（サーバーだけの表）で決まるので、写しには入れない。
 -- 社員 ID は英数字と _ . : - だけ（社員の表は公開の鍵で書けるので、画面に出す前に形を決める：独立レビュー 272b159 の A）
 with live as (select x.id::text emp, public.wr_person_live(x.id::text) j from public.employees x
   where x.id::text ~ '^[A-Za-z0-9_.:-]{1,64}$'
    and not exists (select 1 from public.manager_auth m where m.emp_id::text = x.id::text and m.role in ('ceo','gm','office','office_crew'))),
 keys as (select emp from live where public.wr_elevated(j) union select emp_id from public.wr_people)
 select coalesce(jsonb_agg(jsonb_build_object('emp', k.emp, 'before', z.b, 'after', z.af, 'up', public.wr_up(z.b, z.af)) order by k.emp), '[]'::jsonb)
  from keys k left join live l on l.emp = k.emp
   cross join lateral (select public.wr_person_conf(k.emp) b, case when public.wr_elevated(l.j) then l.j end af) z
  where z.b is distinct from z.af;
$$;

-- GM・CEO：違いの一覧と、その中身の印（digest）。同じ印で wr_people_sync を呼ぶと、その中身だけを写しに入れる。
create or replace function public.wr_people_diff(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v jsonb;
begin
 if (a->>'role') not in ('ceo','gm') then raise exception 'forbidden'; end if;
 v := public.wr_people_items();
 return jsonb_build_object('items', v, 'digest', md5(v::text),
  'up', (select count(*) from jsonb_array_elements(v) x where x->'up' = 'true'::jsonb),
  'confirmed', (select count(*) from public.wr_people));
end $$;

-- GM・CEO：見た一覧（digest）のとおりに写しを更新する。一覧を見たあとに社員の表・店の表が変わっていたら conflict（何も書かない）。
-- p.emps（任意）：合わせる人だけ（見覚えのない変更は選ばない＝写しのまま）。無ければ一覧の全部。
create or replace function public.wr_people_sync(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v jsonb; x jsonb; n integer := 0; af jsonb; v_pick text[];
begin
 if (a->>'role') not in ('ceo','gm') then raise exception 'forbidden'; end if;
 if coalesce(p->>'digest', '') !~ '^[0-9a-f]{32}$' then raise exception 'bad_value'; end if;
 if p ? 'emps' and jsonb_typeof(p->'emps') <> 'array' then raise exception 'bad_value'; end if;
 v_pick := case when jsonb_typeof(p->'emps') = 'array' then public.wr_arr(p->'emps') end;
 perform pg_advisory_xact_lock(hashtext('wr_people'));
 v := public.wr_people_items();
 if md5(v::text) <> p->>'digest' then raise exception 'conflict'; end if;
 for x in select * from jsonb_array_elements(v) where v_pick is null or value->>'emp' = any(v_pick) loop
  af := x->'after';
  if jsonb_typeof(af) = 'object' then
   insert into public.wr_people(emp_id, name, role, grade, stores, am_stores, confirmed_by, confirmed_emp, confirmed_at)
    values (x->>'emp', af->>'name', af->>'role', (af->>'grade')::int, public.wr_arr(af->'stores'), public.wr_arr(af->'am_stores'), a->>'name', a->>'emp', now())
    on conflict (emp_id) do update set name = excluded.name, role = excluded.role, grade = excluded.grade, stores = excluded.stores,
     am_stores = excluded.am_stores, confirmed_by = excluded.confirmed_by, confirmed_emp = excluded.confirmed_emp, confirmed_at = excluded.confirmed_at;
  else
   delete from public.wr_people where emp_id = x->>'emp';
  end if;
  insert into public.wr_people_log(emp_id, before, after, by_emp, by_name)
   values (x->>'emp', case when jsonb_typeof(x->'before') = 'object' then x->'before' end, case when jsonb_typeof(af) = 'object' then af end, a->>'emp', a->>'name');
  n := n + 1;
 end loop;
 return jsonb_build_object('applied', n, 'confirmed', (select count(*) from public.wr_people));
end $$;

-- ---------------------------------------------------------------- 出す
-- p：{ emp_id, name, kind, store_id, payload, client_key, dup_reason }。重複の候補があって理由が無い：{ duplicate:[...] }（何も書かない）。
create or replace function public.wr_submit(p jsonb) returns jsonb
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
 if v_kind not in ('mileage','reimburse','expense_pre') then raise exception 'bad_value'; end if;
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

-- ---------------------------------------------------------------- 動かす
-- p：{ emp_id, name, id|code, action, expect_rev, client_key, note, payload, dup_reason, pay_date, pay_method }
--   edit（承認待ちの中身を直す）・resubmit（差し戻しを直して出し直す）・withdraw（取り下げ）・approve・return（差し戻し・理由）・reject（却下・理由）
--   check（経理の確認）・pay（支払・精算：日付と方法）・dup_ok（別の経費と確かめた・理由）・undo（1 つ前に戻す・理由）
create or replace function public.wr_act(p jsonb) returns jsonb
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
  v_to := case when r.kind = 'expense_pre' then 'done' else 'checked' end;
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

-- ---------------------------------------------------------------- 前からの申請を写す（GM・CEO・2 回流しても同じ）
-- prio 0＝分割の行（spl_…・アプリが正とする）、1＝前の統合行（分割の行に無い記録だけ使う。アプリの _applyKvRows と同じ）
drop function if exists public.wr_state_rows(text);
create or replace function public.wr_state_rows(p_base text) returns table(x jsonb, prio integer)
language sql stable security invoker set search_path = public, pg_temp as $$
 select x, case when s.key = p_base then 1 else 0 end from public.app_state s,
  lateral (select case when jsonb_typeof(s.value::jsonb) = 'object' and s.value::jsonb->>'__st' = '1' then s.value::jsonb->'v' else s.value::jsonb end as v) w,
  lateral jsonb_array_elements(case when jsonb_typeof(w.v) = 'array' then w.v else '[]'::jsonb end) x
 where s.key = p_base or s.key like 'spl\_' || replace(p_base, '_', '\_') || '\_%';
$$;

-- 経理の確認（承認センターの approvals の acct）：記録の id → { by, at }。いちばん新しい記録が「取り消し」なら確認なし（独立レビュー P3）
create or replace function public.wr_legacy_acct() returns table(ref text, by_name text, at_text text)
language sql stable security invoker set search_path = public, pg_temp as $$
 select ref, by_name, at_text from (
  select distinct on (w.x->>'ref') w.x->>'ref' as ref, w.x->'acct'->>'by' as by_name, w.x->'acct'->>'at' as at_text, (w.x->'acct'->'off' = 'true'::jsonb) as off
   from public.wr_state_rows('approvals') w
   where coalesce(w.x->>'ref', '') <> '' and jsonb_typeof(w.x->'acct') = 'object'
   order by w.x->>'ref', w.prio, case when jsonb_typeof(w.x->'acct'->'t') = 'number' then (w.x->'acct'->>'t')::numeric end desc nulls last
 ) q where not coalesce(q.off, false);
$$;

-- 前からの申請の元の記録（今の app_state）。写すときと同じ選び方（分割の行を先に・新しい印）。無ければ null。
create or replace function public.wr_legacy_src(r public.wr_requests) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_base text := r.legacy_info->>'src'; v jsonb;
begin
 if not r.legacy or v_base is null or v_base not in ('mileage_requests','reimbursements','expense_requests') then return null; end if;
 select w.x into v from public.wr_state_rows(v_base) w where jsonb_typeof(w.x) = 'object' and w.x->>'id' = r.legacy_info->>'id'
  order by w.prio, coalesce(case when jsonb_typeof(w.x->'_stT') = 'number' then (w.x->>'_stT')::numeric end, case when jsonb_typeof(w.x->'_mut') = 'number' then (w.x->>'_mut')::numeric end, 0) desc
  limit 1;
 return v;
end $$;

-- 写したあとに前の画面で精算済み（建て替えの支払済・ガソリン代の月末処理）になったか。精算の前に確かめる（二重に払わない）。
create or replace function public.wr_legacy_paid(r public.wr_requests) returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v jsonb := public.wr_legacy_src(r);
begin
 if v is null or coalesce(v->'_deleted' = 'true'::jsonb, false) then return false; end if;
 return (r.kind = 'reimburse' and v->>'payStatus' = '支払済') or (r.kind = 'mileage' and coalesce(v->'archived' = 'true'::jsonb, false));
end $$;

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
 -- 1 つの記録は 1 回だけ：分割の行を先に（同じ id が前の統合行にもあれば分割の行のほう）、同じ優先なら新しい印（_stT・_mut）。
 -- 選んだ写しが消したもの（_deleted）なら写さない（前の統合行の古い写しで戻さない・独立レビュー P2-1）。
 for v_kind, x in
  select z.k, z.y from (
   select distinct on (q.k, q.y->>'id') q.k, q.y from (
    select 'mileage' as k, w.x as y, w.prio from public.wr_state_rows('mileage_requests') w
    union all select 'reimburse', w.x, w.prio from public.wr_state_rows('reimbursements') w
    union all select 'expense_pre', w.x, w.prio from public.wr_state_rows('expense_requests') w
   ) q where jsonb_typeof(q.y) = 'object' and coalesce(q.y->>'id', '') <> ''
   order by q.k, q.y->>'id', q.prio,
    coalesce(case when jsonb_typeof(q.y->'_stT') = 'number' then (q.y->>'_stT')::numeric end, case when jsonb_typeof(q.y->'_mut') = 'number' then (q.y->>'_mut')::numeric end, 0) desc
  ) z
 loop
  if coalesce(x->'_deleted' = 'true'::jsonb, false) then v_skip := v_skip + 1; continue; end if;
  v_ref := public.wr_prefix(v_kind) || ':' || (x->>'id');
  if exists (select 1 from public.wr_requests q where q.legacy_ref = v_ref) then v_skip := v_skip + 1; continue; end if;
  v_acct := v_accts->(x->>'id');
  v_cents := case when jsonb_typeof(case when v_kind = 'expense_pre' then x->'total' else x->'amount' end) = 'number'
    and abs((case when v_kind = 'expense_pre' then x->>'total' else x->>'amount' end)::numeric) < 10000000
   then round((case when v_kind = 'expense_pre' then x->>'total' else x->>'amount' end)::numeric * 100) end;
  v_st := case
   when x->>'status' = '却下' then 'rejected'
   -- 月末処理で締めたガソリン代は、申請中のまま締めたものも精算済み（もう一度精算しない・印を残す）
   when v_kind = 'mileage' and x->>'status' in ('申請中','承認') and coalesce(x->'archived' = 'true'::jsonb, false) then 'paid'
   when x->>'status' = '申請中' then 'pending'
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
     'rejectedButPaid', (x->>'status' = '却下' and x->>'payStatus' = '支払済'),
     'archivedWhilePending', (v_kind = 'mileage' and x->>'status' = '申請中' and coalesce(x->'archived' = 'true'::jsonb, false))),
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
 -- 使い始めた／止めたを共通データの 1 行 wr_live にも書く（アプリはログインのたびに読むので、申請を開いていない端末・店舗の共有ログインも前の画面を止められる・独立レビュー P2-3）。
 -- app_state に書くのはこの 1 行だけ。
 insert into public.app_state(key, value, updated_at) values ('wr_live', jsonb_build_object('live', s.live, 'at', s.updated_at), now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
 return jsonb_build_object('live', s.live, 'settings_rev', s.rev, 'live_at', s.live_at, 'settings_at', s.updated_at, 'imported', v_imp);
end $$;

-- 呼べるのはサーバーの鍵だけ
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'wr\_%' loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;

notify pgrst, 'reload schema';

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
