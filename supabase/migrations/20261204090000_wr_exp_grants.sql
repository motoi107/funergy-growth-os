-- v1184：経費の申請の権限（Moto さんの依頼 11/16 の 3）。事務Crew にガソリン代・立替経費を出せるように・ほかの G1 は人ごとに ON／OFF。
-- 仕様：docs/THREE_FIXES_V1184_JA.md の 3。
--
-- 【前】G1 は経費の申請を出せない（v1164）。経理・事務Crew は、manager_auth（メールのアカウント）の役割で決まるときだけ建て替え経費。
--   PIN だけでログインする事務Crew（従業員マスターの役割 office_crew・肩書き Office Crew／Office Staff）は wr_actor が staff・G1 になり、何も出せなかった。
-- 【いま】G2 以上・AM・GM・CEO は今までどおり 3 種（この設定は効かない）。G2 より下の人は：
--   ・事務Crew（manager_auth の役割 office_crew、または従業員マスターの役割 office_crew・肩書き Office Crew／Office Staff で GM・CEO が「事務Crew と確かめた」人）：初期値はガソリン代・立替経費とも ON
--     従業員マスターは公開の鍵でも書けるので、従業員マスターだけで事務Crew に見える人は、GM・CEO が確かめるまで初期値 OFF（区分 crew_wait）。
--     確かめたあとも、従業員マスターで事務Crew でなくなれば初期値 OFF（確かめと今の従業員マスターの狭いほう。Codex #182 の P1）
--   ・経理（manager_auth の役割 office）で G2 より下：初期値は立替経費だけ ON（今までの権限を残す）
--   ・そのほかの G1：初期値は両方 OFF
--   GM・CEO が人ごとに「ON」「OFF」「初期値」を決められる（表 wr_exp_grants・社員 ID ごと）。明示の OFF は初期値で戻らない。事前経費は今までどおり G2 以上だけ。
--   名前・グレードだけで決めない（社員 ID・manager_auth・GM・CEO の確かめ・従業員マスターの役割と肩書き）。変えた人・対象・項目・日時は wr_exp_grant_log に残す（消さない）。
--   新しい申請・承認待ちを直す（edit）・差し戻しを出し直す（resubmit）は、送ったときにサーバーがこの権限を確かめる（開いている画面・ほかの端末も、次に送るときに効く）。
--   同じ鍵（client_key）の送り直しは今までどおり 1 件だけ（前の答えを返す）。出した申請・履歴は消さない。承認・経理の権限は足さない。
--   本部所属（従業員マスターの所属が本部）の人は、本部（---）でも出せる（店に自動で割り当てない）。
-- 先に 20261125090000_wr_expense_g2.sql（wr_exp_kinds）と 20261120090000（段階 2）を流してから。2 回流しても同じ（表・記録は残る）。
-- 気をつけること：20261104090000・20261120090000・20261125090000 をあとで流し直すと前の決まりに戻る（この SQL をもう一度流す）。

do $$ begin
 if to_regprocedure('public.wr_exp_kinds(jsonb)') is null or to_regprocedure('public.wr_is_s2(text)') is null or to_regprocedure('public.wr_submit_exp(jsonb)') is null
    or to_regprocedure('public.wr_act_exp(jsonb)') is null or to_regprocedure('public.wr_actor(jsonb)') is null then
  raise exception 'STOP: 先に経費の申請の SQL（deploy/expense-g2-v1164 の 2）を流してください（何も変えていません）';
 end if;
end $$;

-- ---------------------------------------------------------------- 表
create table if not exists public.wr_exp_grants (
  emp_id text primary key,
  mileage boolean,              -- null＝初期値
  reimburse boolean,            -- null＝初期値
  crew boolean,                 -- true＝GM・CEO が事務Crew と確かめた・null＝確かめていない
  rev integer not null default 1,
  updated_by text, updated_emp text,
  updated_at timestamptz not null default now()
);
create table if not exists public.wr_exp_grant_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  emp_id text not null,
  emp_name text,
  kind text not null,           -- mileage・reimburse・crew（事務Crew の確かめ）
  before_set boolean, after_set boolean,   -- 設定（null＝初期値）
  before_eff boolean, after_eff boolean,   -- 実際に出せるか
  by_emp text, by_name text, by_role text,
  note text
);
-- 前に流した形（crew の列が無い・kind の決まりが 2 つだけ）にも足す（2 回流しても同じ）
alter table public.wr_exp_grants add column if not exists crew boolean;
alter table public.wr_exp_grant_log drop constraint if exists wr_exp_grant_log_kind_check;
alter table public.wr_exp_grant_log add constraint wr_exp_grant_log_kind_check check (kind in ('mileage','reimburse','crew'));
create index if not exists wr_exp_grant_log_emp on public.wr_exp_grant_log(emp_id, id desc);
alter table public.wr_exp_grants enable row level security;
alter table public.wr_exp_grant_log enable row level security;
revoke all on public.wr_exp_grants, public.wr_exp_grant_log from public, anon, authenticated;
grant select, insert, update, delete on public.wr_exp_grants, public.wr_exp_grant_log to service_role;
revoke all on sequence public.wr_exp_grant_log_id_seq from public, anon, authenticated;
grant usage, select on sequence public.wr_exp_grant_log_id_seq to service_role;

-- ---------------------------------------------------------------- 決まり
-- 事務Crew か（従業員マスターの役割・肩書き。アプリの ROLE office_crew と肩書き Office Crew／Office Staff と同じ）
create or replace function public.wr_exp_crew(p_role text, p_title text) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
 select coalesce(p_role, '') = 'office_crew' or btrim(coalesce(p_title, '')) in ('Office Crew','Office Staff');
$$;

-- 所属が本部か（アプリの EMP_HQ_STORE と同じ。全店・空・分からない所属は本部にしない）
create or replace function public.wr_exp_hq_store(p_store text) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
 select lower(btrim(coalesce(p_store, ''))) in ('office','本部','hq','---');
$$;

-- この人の区分：full（G2 以上・AM・GM・CEO＝3 種・この設定は効かない）・office_crew・office・crew_wait・g1
--   office_crew：manager_auth の役割（サーバーの鍵だけが書ける）か、GM・CEO が確かめた（wr_exp_grants.crew）うえで今も従業員マスターで事務Crew の人
--   crew_wait：従業員マスターでは事務Crew だが GM・CEO の確かめがまだ（従業員マスターは公開の鍵でも書けるので、それだけでは出せない）。初期値は OFF
--   （G2 以上は前からの決まりのまま＝確かめた写しと従業員マスターの狭いほうで、写しの無い人は G3 まで。Moto さん 11/16「今のまま」）
create or replace function public.wr_exp_base(a jsonb) returns text
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare e public.employees; v_ok boolean;
begin
 if a is null or jsonb_typeof(a) <> 'object' then return 'g1'; end if;
 if (a->>'role') in ('ceo','gm','am') or coalesce((a->>'grade')::int, 0) >= 2 then return 'full'; end if;
 if (a->>'role') = 'office_crew' then return 'office_crew'; end if;
 if (a->>'role') = 'office' then return 'office'; end if;
 select * into e from public.employees x where x.id::text = a->>'emp';
 if found and public.wr_exp_crew(e.role, e.title) then
  select g.crew into v_ok from public.wr_exp_grants g where g.emp_id = a->>'emp';
  return case when coalesce(v_ok, false) then 'office_crew' else 'crew_wait' end;
 end if;
 return 'g1';
end $$;

-- 区分ごとの初期値
create or replace function public.wr_exp_default(p_base text, p_kind text) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
 select case coalesce(p_base, '')
   when 'full' then p_kind in ('mileage','reimburse','expense_pre')
   when 'office_crew' then p_kind in ('mileage','reimburse')
   when 'office' then p_kind = 'reimburse'
   else false end;
$$;

-- この人が出せる経費の種類（店に関係なく）。v1164 の決まりに、G2 より下の人の初期値と人ごとの設定を足す
create or replace function public.wr_exp_kinds(a jsonb) returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare b text := public.wr_exp_base(a); g public.wr_exp_grants; o text[] := '{}'::text[];
begin
 if b = 'full' then return array['mileage','reimburse','expense_pre']::text[]; end if;
 select * into g from public.wr_exp_grants x where x.emp_id = a->>'emp';
 if coalesce(g.mileage, public.wr_exp_default(b, 'mileage')) then o := o || 'mileage'::text; end if;
 if coalesce(g.reimburse, public.wr_exp_default(b, 'reimburse')) then o := o || 'reimburse'::text; end if;
 return o;
end $$;

-- 本部（---）で出せるか：CEO・GM・経理・事務Crew（manager_auth）は今までどおり。PIN の人は所属が本部か、事務Crew で所属が空のとき
create or replace function public.wr_exp_hq(a jsonb) returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_st text[] := public.wr_arr(a->'stores');
begin
 if (a->>'role') in ('ceo','gm','office','office_crew') then return true; end if;
 if exists (select 1 from unnest(v_st) s where public.wr_exp_hq_store(s)) then return true; end if;
 return cardinality(v_st) = 0 and public.wr_exp_base(a) = 'office_crew';
end $$;

-- 出せるか：種類（wr_exp_kinds）と店（今までどおり。本部（---）は wr_exp_hq）
create or replace function public.wr_can_submit(a jsonb, p_kind text, p_store text) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select coalesce(p_kind = any(public.wr_exp_kinds(a)), false)
  and coalesce(p_store, '') <> '' and length(p_store) <= 30
  and ((a->>'role') in ('ceo','gm','office','office_crew') or p_store = any(public.wr_arr(a->'stores'))
       or ((a->>'role') = 'am' and p_store = any(public.wr_arr(a->'am_stores')))
       or (p_store = '---' and public.wr_exp_hq(a)));
$$;

-- 送る前の確かめ（新しい申請・直す・出し直す）。同じ鍵の送り直し（もう記録がある）・使い始める前・鍵の形が違うときは、今までどおり後ろの関数に任せる
create or replace function public.wr_exp_right(p jsonb, p_kind text) returns void
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb; v_key text := p->>'client_key';
begin
 if coalesce(p_kind, '') not in ('mileage','reimburse','expense_pre') then return; end if;
 if v_key is null or v_key !~ '^[A-Za-z0-9_-]{8,80}$' then return; end if;
 if exists (select 1 from public.wr_events e where e.client_key = v_key) then return; end if;
 if not public.wr_live() then return; end if;
 a := public.wr_actor(p);
 if not (p_kind = any(public.wr_exp_kinds(a))) then raise exception 'no_exp_right'; end if;
end $$;

-- ---------------------------------------------------------------- 振り分け（20261120090000 の形に、経費の権限の確かめを足す）
create or replace function public.wr_submit(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
begin
 if public.wr_is_s2(p->>'kind') then return public.wr_submit_s2(p); end if;
 if coalesce(p->>'kind', '') in ('skill','cs','tiprate') then return public.wr_submit_eval(p); end if;
 perform public.wr_exp_right(p, p->>'kind');
 return public.wr_submit_exp(p);
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
 -- 承認待ちを直す・差し戻しを出し直すは、出す権限が今もあるときだけ（取り下げ・承認・経理の操作は変えない）
 if coalesce(p->>'action', '') in ('edit','resubmit') then perform public.wr_exp_right(p, v_kind); end if;
 return public.wr_act_exp(p);
end $$;

-- whoami（20261125090000 の形に exp_hq を足す）
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

-- ---------------------------------------------------------------- 設定の画面（GM・CEO）
-- 1 人分：G2 より下の在籍の人だけ（それ以外は null）
create or replace function public.wr_exp_grant_row(p_emp text) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare e public.employees; a jsonb; b text; g public.wr_exp_grants;
begin
 select * into e from public.employees x where x.id::text = p_emp;
 if not found or public.wr_emp_out(e) then return null; end if;
 a := public.wr_actor(jsonb_build_object('emp_id', p_emp));
 b := public.wr_exp_base(a);
 if b = 'full' then return null; end if;
 select * into g from public.wr_exp_grants x where x.emp_id = p_emp;
 return jsonb_build_object('emp', p_emp, 'name', btrim(coalesce(e.name, '')), 'title', e.title, 'emp_role', e.role, 'store', e.store,
  'hq', public.wr_exp_hq_store(e.store), 'base', b, 'login_role', a->>'role', 'grade', (a->>'grade')::int,
  'crew_master', public.wr_exp_crew(e.role, e.title), 'crew_ok', coalesce(g.crew, false),
  'rev', coalesce(g.rev, 0),
  'mileage', jsonb_build_object('set', g.mileage, 'def', public.wr_exp_default(b, 'mileage'), 'eff', coalesce(g.mileage, public.wr_exp_default(b, 'mileage'))),
  'reimburse', jsonb_build_object('set', g.reimburse, 'def', public.wr_exp_default(b, 'reimburse'), 'eff', coalesce(g.reimburse, public.wr_exp_default(b, 'reimburse'))),
  'updated_by', g.updated_by, 'updated_at', g.updated_at);
end $$;

-- 一覧と変更の記録（GM・CEO だけ）。p：{ emp_id, name }
create or replace function public.wr_exp_grant_list(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v_rows jsonb := '[]'::jsonb; e public.employees; x jsonb;
begin
 if (a->>'role') not in ('ceo','gm') then raise exception 'forbidden'; end if;
 for e in select * from public.employees order by btrim(coalesce(name, '')), id::text loop
  if public.wr_emp_out(e) then continue; end if;
  x := public.wr_exp_grant_row(e.id::text);
  if x is not null then v_rows := v_rows || jsonb_build_array(x); end if;
 end loop;
 return jsonb_build_object('rows', v_rows, 'at', now(),
  'log', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'at', l.at, 'emp', l.emp_id, 'emp_name', l.emp_name, 'kind', l.kind,
     'before_set', l.before_set, 'after_set', l.after_set, 'before_eff', l.before_eff, 'after_eff', l.after_eff,
     'by_emp', l.by_emp, 'by_name', l.by_name, 'by_role', l.by_role, 'note', l.note) order by l.id desc)
   from (select * from public.wr_exp_grant_log order by id desc limit 200) l), '[]'::jsonb));
end $$;

-- 1 人の設定を変える（GM・CEO だけ）。p：{ emp_id, name, target, mileage, reimburse（true／false／null＝初期値）, crew（任意：true＝事務Crew と確かめる・null＝確かめを外す）, expect_rev, note }
--   crew を送らなければ今のまま。true は従業員マスターで今も事務Crew の人だけ（違えば not_crew）。
--   今の設定と同じなら何もしない（same: true・記録も足さない＝二度押し・送り直しで増えない）。違えば expect_rev が今の rev と同じときだけ書く（違えば conflict）。
--   記録は項目ごと（設定が変わったか、実際に出せるかが変わったとき。事務Crew の確かめは kind＝crew）
create or replace function public.wr_exp_grant_save(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v_t text := nullif(btrim(coalesce(p->>'target', '')), ''); v_m boolean; v_r boolean; v_c boolean;
 v_note text := nullif(btrim(coalesce(p->>'note', '')), ''); e public.employees; g public.wr_exp_grants; v_rev integer; b0 text; b1 text; v_now timestamptz := now();
 ta jsonb;
begin
 if (a->>'role') not in ('ceo','gm') then raise exception 'forbidden'; end if;
 if v_t is null or length(v_t) > 64 then raise exception 'bad_value'; end if;
 if not (p ? 'mileage') or not (p ? 'reimburse') or jsonb_typeof(p->'mileage') not in ('boolean','null') or jsonb_typeof(p->'reimburse') not in ('boolean','null') then raise exception 'bad_value'; end if;
 if p ? 'crew' and not (jsonb_typeof(p->'crew') = 'null' or p->'crew' = 'true'::jsonb) then raise exception 'bad_value'; end if;
 if v_note is not null and length(v_note) > 200 then raise exception 'bad_value'; end if;
 v_m := case when jsonb_typeof(p->'mileage') = 'boolean' then (p->>'mileage')::boolean end;
 v_r := case when jsonb_typeof(p->'reimburse') = 'boolean' then (p->>'reimburse')::boolean end;
 perform pg_advisory_xact_lock(hashtext('wr_exp_grant:' || v_t));
 select * into e from public.employees x where x.id::text = v_t;
 if not found or public.wr_emp_out(e) then raise exception 'not_found'; end if;
 ta := public.wr_actor(jsonb_build_object('emp_id', v_t));
 b0 := public.wr_exp_base(ta);
 if b0 = 'full' then raise exception 'bad_value'; end if;   -- G2 以上・AM・GM・CEO はこの設定を使わない
 select * into g from public.wr_exp_grants x where x.emp_id = v_t for update;
 v_rev := coalesce(g.rev, 0);
 v_c := case when p ? 'crew' then (case when p->'crew' = 'true'::jsonb then true end) else g.crew end;
 if g.mileage is not distinct from v_m and g.reimburse is not distinct from v_r and g.crew is not distinct from v_c then
  return public.wr_exp_grant_row(v_t) || jsonb_build_object('same', true);
 end if;
 if not (jsonb_typeof(p->'expect_rev') = 'number' and (p->>'expect_rev')::int = v_rev) then raise exception 'conflict'; end if;
 if v_c is true and g.crew is distinct from true and not public.wr_exp_crew(e.role, e.title) then raise exception 'not_crew'; end if;
 insert into public.wr_exp_grants as t (emp_id, mileage, reimburse, crew, rev, updated_by, updated_emp, updated_at)
  values (v_t, v_m, v_r, v_c, v_rev + 1, a->>'name', a->>'emp', v_now)
  on conflict (emp_id) do update set mileage = excluded.mileage, reimburse = excluded.reimburse, crew = excluded.crew, rev = excluded.rev,
   updated_by = excluded.updated_by, updated_emp = excluded.updated_emp, updated_at = excluded.updated_at;
 b1 := public.wr_exp_base(ta);
 if g.crew is distinct from v_c then
  insert into public.wr_exp_grant_log(at, emp_id, emp_name, kind, before_set, after_set, before_eff, after_eff, by_emp, by_name, by_role, note)
   values (v_now, v_t, btrim(coalesce(e.name, '')), 'crew', g.crew, v_c, b0 = 'office_crew', b1 = 'office_crew', a->>'emp', a->>'name', a->>'role', v_note);
 end if;
 if g.mileage is distinct from v_m or coalesce(g.mileage, public.wr_exp_default(b0, 'mileage')) is distinct from coalesce(v_m, public.wr_exp_default(b1, 'mileage')) then
  insert into public.wr_exp_grant_log(at, emp_id, emp_name, kind, before_set, after_set, before_eff, after_eff, by_emp, by_name, by_role, note)
   values (v_now, v_t, btrim(coalesce(e.name, '')), 'mileage', g.mileage, v_m, coalesce(g.mileage, public.wr_exp_default(b0, 'mileage')), coalesce(v_m, public.wr_exp_default(b1, 'mileage')),
    a->>'emp', a->>'name', a->>'role', v_note);
 end if;
 if g.reimburse is distinct from v_r or coalesce(g.reimburse, public.wr_exp_default(b0, 'reimburse')) is distinct from coalesce(v_r, public.wr_exp_default(b1, 'reimburse')) then
  insert into public.wr_exp_grant_log(at, emp_id, emp_name, kind, before_set, after_set, before_eff, after_eff, by_emp, by_name, by_role, note)
   values (v_now, v_t, btrim(coalesce(e.name, '')), 'reimburse', g.reimburse, v_r, coalesce(g.reimburse, public.wr_exp_default(b0, 'reimburse')), coalesce(v_r, public.wr_exp_default(b1, 'reimburse')),
    a->>'emp', a->>'name', a->>'role', v_note);
 end if;
 return public.wr_exp_grant_row(v_t);
end $$;

-- 呼べるのはサーバーの鍵だけ
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('wr_exp_crew','wr_exp_hq_store','wr_exp_base','wr_exp_default','wr_exp_kinds','wr_exp_hq','wr_can_submit',
     'wr_exp_right','wr_submit','wr_act','wr_whoami','wr_exp_grant_row','wr_exp_grant_list','wr_exp_grant_save') loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;

notify pgrst, 'reload schema';
