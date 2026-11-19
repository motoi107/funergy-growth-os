-- v1190：承認・閲覧の共通ルール（Moto さんの依頼 11/17・UI案93）。
-- 仕様：docs/APPROVAL_RULES_JA.md。
--
-- 【前】申請の種類ごとに、だれが承認するか・だれが見られるかがコードに書いてあった（wr_actions_s2・wr_can_approve・wr_visible など）。
--   GM・CEO は残りの段（AM の段も）をまとめて承認していた。
-- 【いま】
--   ・承認上の役割（CEO・GM・AM・Head Chef・経理マネージャー・経理リーダー・事務Crew）は従業員マスターとアカウントから毎回決める（決めてほしいこと 1B）。
--     CEO・GM・経理・事務Crew＝アカウント（manager_auth）。経理リーダー＝経理のアカウントで肩書きが Accounting Leader。
--     AM・Head Chef＝今の社員の表と、GM・CEO が確かめた写し（wr_people）の両方（公開の鍵で書ける社員の表だけでは役割を得ない）。
--     事務Crew は GM・CEO が経費の画面で事務Crew と確かめた人も。兼任できる。
--   ・申請の種類ごとのルール（ar_rules）：条件の枝・段・各段の方式（誰か 1 人／全員）・承認者（役割＋範囲 か 個人）・閲覧者と見え始め・自分の申請のとき。下書き → 確かめ → 有効。
--   ・申請ごとに、出したときのルールの版・枝・段・承認の記録を wr_requests.route に残す。中身（金額・店）が変わる直し・出し直しは同じ版で選び直す。
--   ・承認：今の段で当てはまる人（と代理）だけ。本人は承認しない（GM の申請は GM 本人も承認できる＝決めてほしいこと 3）。
--     同じ人は 1 つの段で 1 回だけ（兼任でも同じ段の 2 枠を埋めない）。段が違えば同じ人でもよい（7B）。だれも当てはまらない段は止まる（自動で通さない）。
--   ・閲覧：申請した本人・CEO・GM・店の G4 以上（今のまま）・承認のあとの経理（今のまま）・今の段までの承認者と代理・閲覧者（見え始めのあと）。一覧・詳細・数・添付・申請のチャットは同じ wr_visible を通る。
--   ・GM・CEO の一括承認（ar_bulk）：1 件ずつ版を確かめ、今の段で承認できるものだけ。ほかの人の段を代わりに承認しない。結果は 1 件ずつ・同じ操作の送り直しは前の結果。
--   ・例外（1 件の申請の段・閲覧者を変える）・代理・進行中の案件への新しい版の適用は CEO・GM だけ・理由が要る・前後を残す。
-- 【使い始め】ar_settings.live が false のあいだは今までと同じ（この SQL を入れただけでは何も変わらない）。
--   初めのルールは今の決まりを写した「下書き」。CEO・GM が確かめて有効にし、16 種類すべてが有効になってから「共通ルールで動かす」（ar_go_live）。
-- 先に 20261204090000_wr_exp_grants.sql（と段階 2・3）を流してから。2 回流しても同じ（表・ルール・記録は残る）。
-- 気をつけること：20261104〜20261204 の申請の SQL をあとで流し直すと、包んだ関数（wr_visible・wr_actions・wr_next・wr_row・wr_act・wr_get）が前に戻る（この SQL をもう一度流す）。
-- 戻す：db/approval-rules-rollback.sql（記録は残す・関数を前の中身に戻す）。

do $$ begin
 if to_regprocedure('public.wr_exp_grant_save(jsonb)') is null or to_regprocedure('public.wr_act_s2(jsonb)') is null
    or to_regprocedure('public.wr_s2_store_has_am(text,text)') is null or to_regclass('public.wr_people') is null then
  raise exception 'STOP: 先に申請の SQL（20261204090000_wr_exp_grants.sql まで）を流してください（何も変えていません）';
 end if;
 if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'wr_exp_grants' and column_name = 'crew') then
  raise exception 'STOP: 経費の申請の権限の SQL（20261204090000_wr_exp_grants.sql）が前の版のままです。今の版をもう一度流してから（何も変えていません）';
 end if;
end $$;

-- ---------------------------------------------------------------- 表
create table if not exists public.ar_settings (
  id integer primary key default 1 check (id = 1),
  live boolean not null default false,
  rev integer not null default 1,
  live_at timestamptz, live_by text, live_emp text,
  updated_at timestamptz not null default now()
);
insert into public.ar_settings(id) values (1) on conflict (id) do nothing;

create table if not exists public.ar_rules (
  kind text not null,
  ver integer not null check (ver >= 1),
  status text not null check (status in ('draft','active','old','discarded')),
  def jsonb not null,
  note text,
  rev integer not null default 1,
  created_by text, created_emp text, created_at timestamptz not null default now(),
  updated_by text, updated_emp text, updated_at timestamptz not null default now(),
  activated_by text, activated_emp text, activated_at timestamptz,
  primary key (kind, ver)
);
-- 捨てた下書きは消さずに discarded で残す（版の番号を使い直さない＝古い画面の版と回数が新しい下書きに当たらない・PR #191／#192 の Codex の P2）。
-- 前の ② で作った表は状態の決まりが 3 つだけなので、ここで 4 つに直す（2 回流しても同じ）
do $$ declare v_con record; begin
 if not exists (select 1 from pg_constraint c where c.conrelid = 'public.ar_rules'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%discarded%') then
  for v_con in select x.conname from pg_constraint x where x.conrelid = 'public.ar_rules'::regclass and x.contype = 'c'
     and pg_get_constraintdef(x.oid) like '%status%' and pg_get_constraintdef(x.oid) like '%''old''%' loop
   execute format('alter table public.ar_rules drop constraint %I', v_con.conname);
  end loop;
  alter table public.ar_rules add constraint ar_rules_status_check check (status in ('draft','active','old','discarded'));
 end if;
end $$;
create unique index if not exists ar_rules_one_active on public.ar_rules(kind) where status = 'active';
create unique index if not exists ar_rules_one_draft on public.ar_rules(kind) where status = 'draft';
create table if not exists public.ar_delegates (
  id uuid primary key default gen_random_uuid(),
  from_emp text not null, to_emp text not null,
  kinds text[] not null default '{}',           -- 空＝すべての種類
  stores text[] not null default '{}',          -- 空＝すべての店
  starts date not null, ends date not null,     -- ハワイの日付（両端を含む）
  active boolean not null default true,
  note text,
  created_by text, created_emp text, created_at timestamptz not null default now(),
  ended_by text, ended_emp text, ended_at timestamptz,
  check (from_emp <> to_emp), check (ends >= starts)
);
create table if not exists public.ar_bulk (
  id text primary key,                          -- 一括承認の操作の番号（端末の client_key）
  by_emp text not null, by_name text, by_role text,
  at timestamptz not null default now(),
  items jsonb not null, results jsonb not null
);
alter table public.wr_requests add column if not exists route jsonb;
alter table public.wr_events add column if not exists bulk_id text;
alter table public.wr_events add column if not exists detail jsonb;
create index if not exists wr_events_bulk_idx on public.wr_events(bulk_id) where bulk_id is not null;

alter table public.ar_settings enable row level security;
alter table public.ar_rules enable row level security;
alter table public.ar_delegates enable row level security;
alter table public.ar_bulk enable row level security;
revoke all on public.ar_settings, public.ar_rules, public.ar_delegates, public.ar_bulk from public, anon, authenticated;
grant select, insert, update, delete on public.ar_settings, public.ar_rules, public.ar_delegates, public.ar_bulk to service_role;
-- 今までの wr_visible（20261104090000_work_requests.sql と同じ中身）
create or replace function public.wr_visible_v0(a jsonb, r public.wr_requests) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select (r.requester_emp is not null and r.requester_emp = a->>'emp')
  or (r.requester_emp is null and r.requester_name = a->>'name')
  or (a->>'role') in ('ceo','gm','office','office_crew')
  or ((a->>'role') = 'am' and r.store_id = any(public.wr_arr(a->'am_stores')))
  or ((a->>'role') = 'staff' and (a->>'grade')::int >= 4 and r.store_id = any(public.wr_arr(a->'stores')));
$$;

-- 今までの wr_actions（20261120090000_work_requests_stage2.sql と同じ中身）
create or replace function public.wr_actions_v0(a jsonb, r public.wr_requests) returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
 if public.wr_is_s2(r.kind) then return public.wr_actions_s2(a, r); end if;
 if r.kind in ('skill','cs','tiprate') then return public.wr_actions_eval(a, r); end if;
 return public.wr_actions_exp(a, r);
end $$;

-- 今までの wr_next（20261120090000_work_requests_stage2.sql と同じ中身）
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
  when r.status = 'approved' and r.kind in ('mileage','reimburse','expense_pre') then jsonb_build_object('step', 'check', 'who', 'acct')
  when r.status = 'checked' and r.kind in ('mileage','reimburse') then jsonb_build_object('step', 'pay', 'who', 'acct')
  else null end;
$$;

-- 今までの wr_row（20261126090000_wr_approve_v1165.sql と同じ中身）
create or replace function public.wr_row_v0(a jsonb, r public.wr_requests) returns jsonb
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

-- 今までの wr_act（20261204090000_wr_exp_grants.sql と同じ中身）
create or replace function public.wr_act_v0(p jsonb) returns jsonb
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

-- 今までの wr_get（20261104090000_work_requests.sql と同じ中身）
create or replace function public.wr_get_v0(p jsonb) returns jsonb
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

-- 今までの wr_whoami（20261204090000_wr_exp_grants.sql と同じ中身）
create or replace function public.wr_whoami_v0(p jsonb) returns jsonb
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

-- ---------------------------------------------------------------- 基本
-- 一覧で何千回も呼ぶ小さな関数は plpgsql にする（search_path を決めた SQL の関数は、呼ぶたびに計画を作り直すため・PR #191 のレビュー）
create or replace function public.ar_live() returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin return coalesce((select live from public.ar_settings where id = 1), false); end $$;

-- この申請は共通ルールで動くか（スイッチが入っていて、出したときのルールの記録がある）
create or replace function public.ar_on(r public.wr_requests) returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin return r.route is not null and public.ar_live(); end $$;

create or replace function public.ar_today() returns date
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin return timezone('Pacific/Honolulu', now())::date; end $$;

create or replace function public.ar_kinds() returns text[]
language sql immutable security invoker set search_path = public, pg_temp as $$
 select array['mileage','reimburse','expense_pre','skill','cs','tiprate']::text[] || public.wr_s2_kinds();
$$;

-- 在籍で利用停止でない人
create or replace function public.ar_emp_ok(p_emp text) returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin return p_emp is not null and exists (select 1 from public.employees e where e.id::text = p_emp and not public.wr_emp_out(e)); end $$;

create or replace function public.ar_emp_name(p_emp text) returns text
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin return coalesce((select btrim(coalesce(e.name, '')) from public.employees e where e.id::text = p_emp limit 1), ''); end $$;

create or replace function public.ar_role_label(p_role text) returns text
language plpgsql immutable security invoker set search_path = public, pg_temp as $$
begin return case p_role when 'ceo' then 'CEO' when 'gm' then 'GM' when 'am' then 'AM' when 'chef' then 'Head Chef'
  when 'acct_mgr' then '経理マネージャー' when 'acct_lead' then '経理リーダー' when 'office_crew' then '事務Crew' else coalesce(p_role, '') end; end $$;

-- 承認上の役割（決めてほしいこと 1B：従業員マスターとアカウントから毎回決める・別の欄は持たない）
--   CEO・GM＝アカウント（manager_auth の ceo・gm）。
--   AM＝GM・CEO が「承認・閲覧の権限の確かめ」で確かめた写し（wr_people）で AM・今の社員の表でも AM。担当店舗は写しと店の表（AM 欄）の重なり。
--   Head Chef＝確かめた写しの Head Chef の印と今の社員の表の両方。
--   経理＝経理のアカウント（office）。肩書きが Accounting Leader なら経理リーダー、ほかは経理マネージャー。
--   事務Crew＝事務Crew のアカウント（office_crew）か、GM・CEO が経費の画面で事務Crew と確かめた人（wr_exp_grants.crew）。
--   公開の鍵で書ける社員の表を書き換えるだけでは役割を得ない（どれもアカウントか GM・CEO の確かめが要る）。退職・利用停止は ar_holders で外す。
create or replace function public.ar_role_rows() returns table(emp_id text, role text, stores text[], src text)
language sql stable security invoker set search_path = public, pg_temp as $$
 select m.emp_id::text, m.role::text, '{}'::text[], 'account' from public.manager_auth m where m.role in ('ceo','gm') and m.emp_id is not null
 union all
 select c.emp_id, 'am', public.wr_meet(c.am_stores, public.wr_arr(q.l->'am_stores')), 'confirmed'
  from public.wr_people c cross join lateral (select public.wr_person_live(c.emp_id) as l) q
  where c.role = 'am' and q.l is not null and (q.l->>'role') = 'am' and cardinality(public.wr_meet(c.am_stores, public.wr_arr(q.l->'am_stores'))) > 0
 union all
 select c.emp_id, 'chef', '{}'::text[], 'confirmed'
  from public.wr_people c cross join lateral (select public.wr_person_live(c.emp_id) as l) q
  where c.chef and q.l is not null and coalesce((q.l->>'chef')::boolean, false)
 union all
 select distinct e.id::text, case when btrim(coalesce(e.title, '')) = 'Accounting Leader' then 'acct_lead' else 'acct_mgr' end, '{}'::text[], 'account'
  from public.manager_auth m join public.employees e on e.id::text = m.emp_id::text where m.role = 'office'
 union all
 select x.emp, 'office_crew', '{}'::text[], min(x.src) from (
   select m.emp_id::text as emp, 'account' as src from public.manager_auth m where m.role = 'office_crew' and m.emp_id is not null
   union all
   select g.emp_id, 'confirmed' from public.wr_exp_grants g where g.crew is true
  ) x group by x.emp;
$$;

-- 承認上の役割の一覧（在籍で利用停止でない人だけ）を、1 回の呼び出し（取引）の中で 1 回だけ作る（PR #191 のレビュー：一覧のたびに何百回も作っていた）。
-- 取引の中だけの設定（ar.role_cache）に置く。元の表（アカウント・写し・社員・店・経費の権限）が書き換わったら、同じ取引の中でもトリガーが消して作り直す。
create or replace function public.ar_role_cache_reset() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
 perform set_config('ar.role_cache', '', true);
 return null;
end $$;
do $$ declare t text; begin
 foreach t in array array['manager_auth','wr_people','employees','stores','wr_exp_grants'] loop
  if to_regclass('public.' || t) is not null then
   execute format('drop trigger if exists ar_role_cache_reset on public.%I', t);
   execute format('create trigger ar_role_cache_reset after insert or update or delete or truncate on public.%I for each statement execute function public.ar_role_cache_reset()', t);
  end if;
 end loop;
end $$;

create or replace function public.ar_role_cache() returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v text := current_setting('ar.role_cache', true); j jsonb;
begin
 if v is not null and v <> '' then return v::jsonb; end if;
 -- 役割ごとに {e: 社員 ID, s: 受け持ちの店} を社員 ID の順に
 select coalesce(jsonb_object_agg(t.role, t.rows), '{}'::jsonb) into j from (
   select y.role, jsonb_agg(jsonb_build_object('e', y.emp_id, 's', to_jsonb(coalesce(y.stores, '{}'::text[]))) order by y.emp_id) as rows
    from public.ar_role_rows() y where public.ar_emp_ok(y.emp_id) group by y.role) t;
 perform set_config('ar.role_cache', j::text, true);
 return j;
end $$;

-- その役割を今持っている人（社員 ID）。範囲：all＝全社・mine＝申請の店を受け持つ人・stores＝指定の店のどれかを受け持つ人
-- CEO・GM はいつも全社。AM 以外で受け持ちの店が空の人は全社とみなす。退職・利用停止の人は入らない（ar_role_cache で外している）。
-- plpgsql にしたのは、呼ぶたびに計画を作り直さないため（一覧で何千回も呼ぶ）。
create or replace function public.ar_holders(p_role text, p_scope text, p_store text, p_stores text[]) returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare o text[] := '{}'::text[]; y jsonb; v_scope text := coalesce(p_scope, 'all'); v_any boolean;
begin
 for y in select x from jsonb_array_elements(coalesce(public.ar_role_cache()->p_role, '[]'::jsonb)) x loop
  v_any := p_role <> 'am' and jsonb_array_length(y->'s') = 0;
  if p_role in ('ceo','gm') or (case v_scope
     when 'all' then true
     when 'mine' then (p_store is not null and jsonb_exists(y->'s', p_store)) or v_any
     when 'stores' then jsonb_exists_any(y->'s', coalesce(p_stores, '{}'::text[])) or v_any
     else false end) then
   if not ((y->>'e') = any(o)) then o := o || (y->>'e'); end if;
  end if;
 end loop;
 return o;
end $$;

-- 代理：p_to が今日 p_from の代わりに、この申請を承認できるか
-- この人に今日効いている代理があるか（一覧で 1 件ごとに枠を全部見る前に、無い人はすぐ飛ばす）
create or replace function public.ar_has_delegate(p_to text) returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin return p_to is not null and exists (select 1 from public.ar_delegates d where d.active and d.to_emp = p_to and public.ar_today() between d.starts and d.ends); end $$;

create or replace function public.ar_delegate_ok(p_to text, p_from text, r public.wr_requests) returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
 -- 先に代理の記録を見る（ほとんどの人には無い）・そのあと代理の人が在籍か
 if p_to is null or p_from is null or not exists (select 1 from public.ar_delegates d where d.active and d.to_emp = p_to and d.from_emp = p_from
   and public.ar_today() between d.starts and d.ends
   and (cardinality(d.kinds) = 0 or r.kind = any(d.kinds)) and (cardinality(d.stores) = 0 or r.store_id = any(d.stores))) then return false; end if;
 return public.ar_emp_ok(p_to);
end $$;

-- 枠に当てはまる人（今の状態）
-- 「役割の全員」を出したときに 1 人ずつに分けた枠（of あり）は、その人が今もその役割・範囲にいるときだけ（役割を外した・担当の店が変わった人は承認できない）。
-- 名前で決めた枠（of なし）は在籍・利用停止だけを見る。
create or replace function public.ar_slot_people(s jsonb, r public.wr_requests) returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
 if s->>'t' = 'emp' then
  if public.ar_emp_ok(s->>'emp')
     and (s->'of' is null or (jsonb_typeof(s->'of') = 'object' and (s->'of'->>'t') = 'role'
       and (s->>'emp') = any(public.ar_holders(s->'of'->>'role', s->'of'->>'scope', r.store_id,
             case when s->'of'->>'scope' = 'stores' then public.wr_arr(s->'of'->'stores') end)))) then
   return array[s->>'emp'];
  end if;
  return '{}'::text[];
 elsif s->>'t' = 'role' then
  return public.ar_holders(s->>'role', s->>'scope', r.store_id, case when s->>'scope' = 'stores' then public.wr_arr(s->'stores') end);
 end if;
 return '{}'::text[];
end $$;

-- 自分の申請を本人が承認できるか（決めてほしいこと 3：GM の申請は GM 本人が承認できる＝ルールの self が gm のとき）
create or replace function public.ar_self_ok(r public.wr_requests, p_self text) returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin return coalesce(p_self, 'ceo') = 'gm' and r.requester_emp is not null and r.requester_emp = any(public.ar_holders('gm', 'all', null, null)); end $$;

-- 承認できる人。申請した本人は除く（self が gm で本人が GM なら除かない）。
-- 本人しか当てはまらないときは、self が ceo か gm なら CEO に回す（block なら止まる）
create or replace function public.ar_slot_elig(s jsonb, r public.wr_requests, p_self text) returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v text[] := public.ar_slot_people(s, r); o text[];
begin
 if public.ar_self_ok(r, p_self) then return v; end if;
 o := array(select x from unnest(v) x where x is distinct from r.requester_emp);
 if cardinality(o) = 0 and r.requester_emp is not null and r.requester_emp = any(v) and coalesce(p_self, 'ceo') in ('ceo','gm') then
  o := array(select x from unnest(public.ar_holders('ceo', 'all', r.store_id, '{}'::text[])) x where x is distinct from r.requester_emp);
 end if;
 return o;
end $$;

-- 1 つの申請で承認に使った人（本人と「〇〇の代理」の〇〇）。見られる人の判定に使う
create or replace function public.ar_signed(rt jsonb) returns text[]
language sql immutable security invoker set search_path = public, pg_temp as $$
 select coalesce(array(select distinct z.x from (
   select g->>'emp' as x from jsonb_array_elements(coalesce(rt->'stages', '[]'::jsonb)) st, jsonb_array_elements(coalesce(st->'signs', '[]'::jsonb)) g
   union all
   select g->>'for_emp' from jsonb_array_elements(coalesce(rt->'stages', '[]'::jsonb)) st, jsonb_array_elements(coalesce(st->'signs', '[]'::jsonb)) g
  ) z where z.x is not null), '{}'::text[]);
$$;

-- 1 つの段で承認に使った人。同じ人は同じ段で 1 回だけ（兼任でも 2 枠を埋めない）。段が違えば同じ人でもよい（決めてほしいこと 7B）
create or replace function public.ar_stage_signed(st jsonb) returns text[]
language plpgsql immutable security invoker set search_path = public, pg_temp as $$
begin return coalesce(array(select distinct z.x from (
   select g->>'emp' as x from jsonb_array_elements(coalesce(st->'signs', '[]'::jsonb)) g
   union all
   select g->>'for_emp' from jsonb_array_elements(coalesce(st->'signs', '[]'::jsonb)) g
  ) z where z.x is not null), '{}'::text[]); end $$;

-- まだ埋まっていない枠
create or replace function public.ar_open_slots(st jsonb) returns setof jsonb
language plpgsql immutable security invoker set search_path = public, pg_temp as $$
begin return query select x from jsonb_array_elements(coalesce(st->'slots', '[]'::jsonb)) x
  where not exists (select 1 from jsonb_array_elements(coalesce(st->'signs', '[]'::jsonb)) g where g->>'k' = x->>'k'); end $$;

-- 段が済んだか（誰か 1 人：1 人の承認・全員：すべての枠）
create or replace function public.ar_stage_done(st jsonb) returns boolean
language plpgsql immutable security invoker set search_path = public, pg_temp as $$
begin return case when coalesce(st->>'mode', 'any') = 'all' then not exists (select 1 from public.ar_open_slots(st))
  else jsonb_array_length(coalesce(st->'signs', '[]'::jsonb)) > 0 end; end $$;

-- 枠ごとの「埋められる人」の組（jsonb の配列の配列）から、すべての枠に別々の人を 1 人ずつ当てられるか（組み合わせ・増加路）。
-- 空の枠があれば false。「全員」の段で、同じ人しか当てはまらない枠が 2 つあると false（兼任の 1 人は 1 段で 1 回だけ＝7B）
create or replace function public.ar_sdr_ok(p_sets jsonb) returns boolean
language plpgsql immutable security invoker set search_path = public, pg_temp as $$
declare n integer := coalesce(jsonb_array_length(p_sets), 0); i integer; j integer; h integer; q integer[]; p text; v_end text; v_slot integer;
 m jsonb := '{}'::jsonb; par jsonb; via jsonb;
begin
 if p_sets is null or jsonb_typeof(p_sets) <> 'array' then return false; end if;
 for i in 0 .. n - 1 loop
  par := '{}'::jsonb; via := '{}'::jsonb; q := array[i]; h := 1; v_end := null;
  while h <= cardinality(q) and v_end is null loop
   j := q[h]; h := h + 1;
   for p in select distinct x from jsonb_array_elements_text(case when jsonb_typeof(p_sets->j) = 'array' then p_sets->j else '[]'::jsonb end) x loop
    continue when par ? p;
    par := par || jsonb_build_object(p, j);
    if not (m ? p) then v_end := p; exit; end if;
    v_slot := (m->>p)::int;
    if not (via ? v_slot::text) then via := via || jsonb_build_object(v_slot::text, p); q := q || v_slot; end if;
   end loop;
  end loop;
  if v_end is null then return false; end if;
  p := v_end;
  while p is not null loop
   j := (par->>p)::int;
   m := m || jsonb_build_object(p, j);
   p := via->>(j::text);
  end loop;
 end loop;
 return true;
end $$;

-- 「全員」の段で、まだ埋まっていない枠（p_skip の枠を除く）に、承認に使っていない人（p_used）を 1 人ずつ当てられるか
create or replace function public.ar_open_ok(r public.wr_requests, st jsonb, p_used text[], p_skip text) returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
 return public.ar_sdr_ok((select coalesce(jsonb_agg(to_jsonb(array(select y from unnest(public.ar_slot_elig(o, r, r.route->>'self')) y where not (y = any(p_used))))), '[]'::jsonb)
   from public.ar_open_slots(st) o where (o->>'k') is distinct from p_skip));
end $$;

-- この人が今の段で承認できるか。できるなら {k（枠）, via（self／self_ceo／delegate）, for_emp, for_name}
-- 当てはまる枠が 2 つ以上（兼任・「全員」の段）なら、残りの枠をほかの人で埋められる枠を先に（埋められない枠を取らない）。同じなら、ほかに埋められる人の少ない枠
create or replace function public.ar_can_approve(a jsonb, r public.wr_requests) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare rt jsonb := r.route; v_cur integer; st jsonb; s jsonb; v_used text[]; v_el text[]; f text; v_me text := a->>'emp'; v_cand jsonb := '[]'::jsonb; c jsonb;
 v_best jsonb; v_bn integer; v_bok boolean; v_ok boolean; v_all boolean; v_first jsonb;
begin
 if rt is null or r.status <> 'pending' or v_me is null or (public.wr_is_mine(a, r) and not public.ar_self_ok(r, rt->>'self')) then return null; end if;
 v_cur := coalesce((rt->>'cur')::int, 0);
 st := rt->'stages'->v_cur;
 if st is null or public.ar_stage_done(st) then return null; end if;
 v_used := public.ar_stage_signed(st);
 if v_me = any(v_used) then return null; end if;
 v_all := coalesce(st->>'mode', 'any') = 'all';
 for s in select x from public.ar_open_slots(st) x loop
  v_el := public.ar_slot_elig(s, r, rt->>'self');
  if v_me = any(v_el) then
   v_cand := v_cand || jsonb_build_array(jsonb_build_object('k', s->>'k',
     'via', case when v_me = r.requester_emp then 'own' when v_me = any(public.ar_slot_people(s, r)) then 'self' else 'self_ceo' end,
     'n', cardinality(array(select x from unnest(v_el) x where x <> v_me and not (x = any(v_used))))));
  end if;
 end loop;
 if jsonb_array_length(v_cand) = 1 then return (v_cand->0) - 'n'; end if;
 for c in select x from jsonb_array_elements(v_cand) x loop
  v_ok := not v_all or public.ar_open_ok(r, st, v_used || v_me, c->>'k');
  if v_best is null or (v_ok and not v_bok) or (v_ok = v_bok and (c->>'n')::int < v_bn) then v_best := c; v_bn := (c->>'n')::int; v_bok := v_ok; end if;
 end loop;
 if v_best is not null then return v_best - 'n'; end if;
 if not public.ar_has_delegate(v_me) then return null; end if;
 for s in select x from public.ar_open_slots(st) x loop
  foreach f in array public.ar_slot_elig(s, r, rt->>'self') loop
   if not (f = any(v_used)) and public.ar_delegate_ok(v_me, f, r) then
    c := jsonb_build_object('k', s->>'k', 'via', 'delegate', 'for_emp', f, 'for_name', public.ar_emp_name(f));
    if not v_all or public.ar_open_ok(r, st, v_used || f, s->>'k') then return c; end if;
    if v_first is null then v_first := c; end if;
   end if;
  end loop;
 end loop;
 return v_first;
end $$;

-- 今の段で承認できる人がいない（止まっている）。自動では通さない。CEO・GM が代理か例外で直す
-- 「全員」の段は、残りの枠に別々の人を 1 人ずつ当てられないときも止まっている（兼任の 1 人しかいない枠が 2 つ）
create or replace function public.ar_stuck(r public.wr_requests) returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare rt jsonb := r.route; st jsonb; s jsonb; v_used text[];
begin
 if rt is null or r.status <> 'pending' then return false; end if;
 st := rt->'stages'->coalesce((rt->>'cur')::int, 0);
 if st is null then return true; end if;
 if public.ar_stage_done(st) then return false; end if;
 v_used := public.ar_stage_signed(st);
 if coalesce(st->>'mode', 'any') = 'all' then return not public.ar_open_ok(r, st, v_used, null); end if;
 for s in select x from public.ar_open_slots(st) x loop
  if exists (select 1 from unnest(public.ar_slot_elig(s, r, rt->>'self')) x where not (x = any(v_used))) then return false; end if;
 end loop;
 return true;
end $$;

-- ---------------------------------------------------------------- ルール → 申請ごとの承認ルート
-- 枝の条件（書いてある条件がすべて合う）。金額はセント・min は以上・max は未満
create or replace function public.ar_match(w jsonb, r public.wr_requests) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select w is null or jsonb_typeof(w) <> 'object' or (
  (w->'min_cents' is null or (r.amount_cents is not null and r.amount_cents >= (w->>'min_cents')::bigint))
  and (w->'max_cents' is null or (r.amount_cents is not null and r.amount_cents < (w->>'max_cents')::bigint))
  and (w->'stores' is null or r.store_id = any(public.wr_arr(w->'stores')))
  and (w->'hq' is null or ((coalesce(r.store_id, '') = '---') = (w->>'hq')::boolean))
  and (w->'has_am' is null or ((cardinality(array(select x from unnest(public.ar_holders('am', 'mine', r.store_id, '{}'::text[])) x
        where x is distinct from r.requester_emp)) > 0) = (w->>'has_am')::boolean)));
$$;

-- 定義から 1 件の承認ルートを作る。「役割の全員」は出したときのその役割の人ごとに 1 枠（本人を除く。だれもいなければ役割の枠のまま＝止まる）
create or replace function public.ar_route_from_def(d jsonb, p_kind text, p_ver integer, r public.wr_requests, p_why text) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare b jsonb; v_bi integer := -1; i integer; v_stages jsonb := '[]'::jsonb; st jsonb; s jsonb; v_slots jsonb; k integer := 0; e text; v_who text[];
begin
 for i in 0 .. coalesce(jsonb_array_length(d->'branches'), 0) - 1 loop
  if public.ar_match(d->'branches'->i->'when', r) then b := d->'branches'->i; v_bi := i; exit; end if;
 end loop;
 if b is null then
  b := d->'default';
  if b is null or jsonb_typeof(b) <> 'object' or coalesce(b->>'block', '') = 'true' or jsonb_typeof(b->'stages') <> 'array' then raise exception 'no_route'; end if;
 end if;
 for st in select x from jsonb_array_elements(b->'stages') x loop
  v_slots := '[]'::jsonb;
  for s in select x from jsonb_array_elements(st->'slots') x loop
   if s->>'t' = 'role' and coalesce(s->>'each', '') = 'true' then
    v_who := array(select x from unnest(public.ar_slot_people(s, r)) x where x is distinct from r.requester_emp);
    if cardinality(v_who) > 0 then
     foreach e in array v_who loop
      k := k + 1;
      v_slots := v_slots || jsonb_build_array(jsonb_build_object('k', k::text, 't', 'emp', 'emp', e, 'of', s - 'each'));
     end loop;
    else
     k := k + 1; v_slots := v_slots || jsonb_build_array((s - 'k') || jsonb_build_object('k', k::text));
    end if;
   else
    k := k + 1; v_slots := v_slots || jsonb_build_array((s - 'k') || jsonb_build_object('k', k::text));
   end if;
  end loop;
  v_stages := v_stages || jsonb_build_array(jsonb_build_object('mode', coalesce(st->>'mode', 'any'), 'slots', v_slots, 'signs', '[]'::jsonb));
 end loop;
 if jsonb_array_length(v_stages) = 0 then raise exception 'no_route'; end if;
 return jsonb_build_object('rule', jsonb_build_object('kind', p_kind, 'ver', p_ver), 'branch', v_bi,
  'label', coalesce(nullif(b->>'label', ''), case when v_bi < 0 then '既定' else '条件 ' || (v_bi + 1) end),
  'self', coalesce(d->>'self', 'ceo'), 'cur', 0, 'stages', v_stages, 'viewers', coalesce(d->'viewers', '[]'::jsonb),
  'ex', '[]'::jsonb, 'at', now(), 'why', p_why);
end $$;

-- 有効なルール（p_ver があればその版）でルートを作る
create or replace function public.ar_route_build(r public.wr_requests, p_ver integer, p_why text) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare g public.ar_rules;
begin
 if p_ver is not null then select * into g from public.ar_rules x where x.kind = r.kind and x.ver = p_ver and x.status in ('active','old'); end if;
 if g.kind is null then select * into g from public.ar_rules x where x.kind = r.kind and x.status = 'active'; end if;
 if g.kind is null then raise exception 'no_route'; end if;
 return public.ar_route_from_def(g.def, g.kind, g.ver, r, p_why);
end $$;

-- 申請を出した・中身（版・店・金額）が変わった・承認待ちに戻ったとき、出したときの版で承認ルートを選び直す（承認は取り直し）。スイッチが入っているときだけ
create or replace function public.ar_route_trg() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_ver integer; v_old jsonb;
begin
 if not public.ar_live() then
  -- 止めているあいだに承認待ちに戻る申請は、前のルート（前の中身への承認）を持たない（止めたときに外しているはず・念のため）
  if tg_op = 'UPDATE' and new.status = 'pending' and old.status is distinct from 'pending' and new.route is not null then new.route := null; end if;
  return new;
 end if;
 if tg_op = 'INSERT' then
  if new.status = 'pending' and new.route is null then new.route := public.ar_route_build(new, null, 'submit'); end if;
  return new;
 end if;
 if new.status = 'pending' and new.route is not distinct from old.route
    and (old.status is distinct from 'pending' or new.version is distinct from old.version or new.store_id is distinct from old.store_id
         or new.amount_cents is distinct from old.amount_cents or new.kind is distinct from old.kind) then
  v_old := old.route;
  v_ver := case when v_old is not null and v_old->'rule'->>'kind' = new.kind then (v_old->'rule'->>'ver')::int end;
  new.route := public.ar_route_build(new, v_ver, case when old.status = 'pending' then 'edit' else coalesce(old.status, '') || '>pending' end);
  if v_old is not null and jsonb_array_length(coalesce(v_old->'ex', '[]'::jsonb)) > 0 then
   new.route := new.route || jsonb_build_object('ex_prev', v_old->'ex');
  end if;
 end if;
 return new;
end $$;
drop trigger if exists ar_route_trg on public.wr_requests;
create trigger ar_route_trg before insert or update on public.wr_requests for each row execute function public.ar_route_trg();

-- 差し戻しにできる種類（今の決まりと同じ：段階 2 は予算だけ・前からの申請で社員の分からないものはできない）
create or replace function public.ar_can_return(r public.wr_requests) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select case when public.wr_is_s2(r.kind) then r.kind = 'budget'
  when r.kind in ('skill','cs','tiprate') then true
  else not coalesce(r.legacy, false) or r.requester_emp is not null end;
$$;

-- ---------------------------------------------------------------- 閲覧（決めてほしいこと 4A・5A・6A）
create or replace function public.ar_visible(a jsonb, r public.wr_requests) returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare rt jsonb := r.route; v_me text := a->>'emp'; v_cur integer; i integer; s jsonb; v_el text[]; v jsonb; v_from text; v_n integer; v_del boolean;
begin
 if public.wr_is_mine(a, r) then return true; end if;
 if (a->>'role') in ('ceo','gm') then return true; end if;                                       -- 4A
 if (a->>'role') = 'staff' and coalesce((a->>'grade')::int, 0) >= 4 and r.store_id = any(public.wr_arr(a->'stores')) then return true; end if;   -- 5A（店の G4 以上）
 if public.wr_is_acct(a) and rt ? 'final' and (r.kind in ('mileage','reimburse','expense_pre') or public.wr_s2_acct(r.kind)) then return true; end if;   -- 6A（承認のあとの経理）
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

-- ---------------------------------------------------------------- 画面に返すルート
create or replace function public.ar_slot_label(s jsonb) returns text
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin return case s->>'t'
  when 'emp' then case when s->'of' is not null then public.ar_slot_label(s->'of') || '：' else '' end || public.ar_emp_name(s->>'emp')
  when 'role' then public.ar_role_label(s->>'role') || case s->>'scope' when 'mine' then '（担当店舗）'
     when 'stores' then '（' || array_to_string(public.wr_arr(s->'stores'), '・') || '）' else '' end
     || case when coalesce(s->>'each', '') = 'true' then '（全員）' else '' end
  else '' end; end $$;

create or replace function public.ar_route_view(a jsonb, r public.wr_requests) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare rt jsonb := r.route; v_used text[]; st jsonb; s jsonb; i integer := 0; v_cur integer; v_stages jsonb := '[]'::jsonb; v_slots jsonb; v_el text[];
 c jsonb; v_final boolean := false; st2 jsonb; v_after text; v_left integer;
begin
 if rt is null then return null; end if;
 v_cur := coalesce((rt->>'cur')::int, 0);
 for st in select x from jsonb_array_elements(rt->'stages') x loop
  v_slots := '[]'::jsonb;
  for s in select x from jsonb_array_elements(st->'slots') x loop
   v_el := case when r.status = 'pending' and i >= v_cur then array(select x from unnest(public.ar_slot_elig(s, r, rt->>'self')) x where not (x = any(public.ar_stage_signed(st)))) else '{}'::text[] end;
   v_slots := v_slots || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('k', s->>'k', 'label', public.ar_slot_label(s), 't', s->>'t',
     'role', coalesce(s->>'role', s->'of'->>'role'), 'scope', s->>'scope', 'emp', s->>'emp',
     'filled', exists (select 1 from jsonb_array_elements(coalesce(st->'signs', '[]'::jsonb)) g where g->>'k' = s->>'k'),
     'names', case when cardinality(v_el) > 0 then (select jsonb_agg(public.ar_emp_name(x) order by public.ar_emp_name(x)) from unnest(v_el) x) end)));
  end loop;
  v_stages := v_stages || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('n', i + 1, 'mode', st->>'mode', 'done', st->'done', 'slots', v_slots,
    'signs', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('k', g->>'k', 'name', g->>'name', 'role', g->>'role', 'at', g->'at', 'via', g->>'via',
       'for_name', g->>'for_name', 'bulk', g->>'bulk', 'note', g->>'note'))), '[]'::jsonb) from jsonb_array_elements(coalesce(st->'signs', '[]'::jsonb)) g))));
  i := i + 1;
 end loop;
 c := public.ar_can_approve(a, r);
 if c is not null then
  -- この人が承認すると最終承認になるか・次の段に進むか・同じ段でほかの人を待つか（一括承認の確かめの画面）
  -- after：final（最終承認）／next（次の段へ）／same（この段のほかの枠を待つ＝「全員」の段）。left：承認したあと、この段に残る枠の数
  st2 := rt->'stages'->v_cur;
  st2 := jsonb_set(st2, '{signs}', coalesce(st2->'signs', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('k', c->>'k')));
  v_final := public.ar_stage_done(st2) and v_cur + 1 >= jsonb_array_length(rt->'stages');
  v_after := case when not public.ar_stage_done(st2) then 'same' when v_final then 'final' else 'next' end;
  v_left := case when v_after = 'same' then (select count(*) from public.ar_open_slots(st2)) else 0 end;
 end if;
 return jsonb_strip_nulls(jsonb_build_object('rule', rt->'rule', 'label', rt->>'label', 'branch', rt->'branch', 'cur', v_cur + 1,
  'final', rt->'final', 'stuck', public.ar_stuck(r), 'stages', v_stages,
  'viewers', (select coalesce(jsonb_agg(jsonb_build_object('label', public.ar_slot_label(v->'who'), 'from', coalesce(v->>'from', 'submit'))), '[]'::jsonb)
     from jsonb_array_elements(coalesce(rt->'viewers', '[]'::jsonb)) v),
  'ex', case when jsonb_array_length(coalesce(rt->'ex', '[]'::jsonb)) > 0 then rt->'ex' end,
  'my', case when c is not null then c || jsonb_build_object('final', v_final, 'after', v_after, 'left', v_left) end));
end $$;

-- ---------------------------------------------------------------- 包む（スイッチが切れている・ルートの無い申請は今までの関数そのまま）
create or replace function public.wr_visible(a jsonb, r public.wr_requests) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
 select case when public.ar_on(r) then public.ar_visible(a, r) else public.wr_visible_v0(a, r) end;
$$;

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
 if cardinality(r.dup_codes) > 0 and r.dup_ok_at is null and not v_mine and r.kind in ('mileage','reimburse','expense_pre')
    and (c or v_gm or public.wr_is_acct(a)) then o := o || 'dup_ok'::text; end if;
 return o;
end $$;

create or replace function public.wr_next(r public.wr_requests) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare rt jsonb := r.route; v_cur integer; st jsonb; s jsonb; v_am boolean := false; v_emps text[] := '{}'::text[]; v_used text[];
begin
 if not public.ar_on(r) or r.status <> 'pending' then return public.wr_next_v0(r); end if;
 v_cur := coalesce((rt->>'cur')::int, 0); st := rt->'stages'->v_cur; v_used := public.ar_stage_signed(st);
 for s in select x from public.ar_open_slots(st) x loop
  if coalesce(s->>'role', s->'of'->>'role') = 'am' then v_am := true; end if;
  v_emps := v_emps || array(select x from unnest(public.ar_slot_elig(s, r, rt->>'self')) x where not (x = any(v_used)) and not (x = any(v_emps)));
 end loop;
 return jsonb_strip_nulls(jsonb_build_object('step', 'approve', 'who', case when v_am then 'am' else 'gm' end,
  'stage', v_cur + 1, 'stages', jsonb_array_length(rt->'stages'), 'mode', st->>'mode', 'label', rt->>'label',
  'emps', to_jsonb(v_emps), 'names', (select jsonb_agg(public.ar_emp_name(x) order by public.ar_emp_name(x)) from unnest(v_emps) x),
  'stuck', public.ar_stuck(r)));
end $$;

create or replace function public.wr_row(a jsonb, r public.wr_requests) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select public.wr_row_v0(a, r) || case when public.ar_on(r) then jsonb_build_object('route', public.ar_route_view(a, r)) else '{}'::jsonb end;
$$;

-- 詳しい画面の記録に、一括承認の番号と承認の段・代理を足す
create or replace function public.wr_get(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v jsonb := public.wr_get_v0(p);
begin
 return v || jsonb_build_object('events', (select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'action', e.action, 'from', e.from_status, 'to', e.to_status,
    'version', e.version, 'by', e.by_name, 'role', e.by_role, 'note', e.note) || jsonb_strip_nulls(jsonb_build_object('bulk', e.bulk_id, 'detail', e.detail)) order by e.id), '[]'::jsonb)
   from public.wr_events e where e.request_id = (v->>'id')::uuid));
end $$;

create or replace function public.wr_whoami(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v jsonb := public.wr_whoami_v0(p); s public.ar_settings;
begin
 select * into s from public.ar_settings where id = 1;
 return v || jsonb_build_object('ar', jsonb_strip_nulls(jsonb_build_object('live', coalesce(s.live, false), 'rev', coalesce(s.rev, 1), 'live_at', s.live_at,
  'admin', (v->'me'->>'role') in ('ceo','gm'),
  'roles', (select jsonb_agg(distinct g.role) from public.ar_role_rows() g where g.emp_id = v->'me'->>'emp' and public.ar_emp_ok(g.emp_id)))));
end $$;

create or replace function public.wr_stage(p jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$ select jsonb_build_object('stage', 8) $$;

-- ---------------------------------------------------------------- 承認（ルートの今の段）
create or replace function public.ar_do_approve(a jsonb, r public.wr_requests, c jsonb, p_note text, p_key text, p_bulk text) returns public.wr_requests
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare rt jsonb := r.route; v_cur integer := coalesce((r.route->>'cur')::int, 0); st jsonb; v_now timestamptz := now(); v_n integer; v_final boolean := false;
 v_to text; v_so jsonb := coalesce(r.signoffs, '[]'::jsonb); v_slot jsonb; v_s2 boolean := public.wr_is_s2(r.kind);
begin
 st := rt->'stages'->v_cur;
 select x into v_slot from jsonb_array_elements(st->'slots') x where x->>'k' = c->>'k';
 st := jsonb_set(st, '{signs}', coalesce(st->'signs', '[]'::jsonb) || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
   'k', c->>'k', 'emp', a->>'emp', 'name', a->>'name', 'role', a->>'role', 'at', v_now, 'via', c->>'via',
   'for_emp', c->>'for_emp', 'for_name', c->>'for_name', 'bulk', p_bulk, 'note', p_note))));
 v_n := jsonb_array_length(rt->'stages');
 if public.ar_stage_done(st) then
  st := st || jsonb_build_object('done', v_now);
  if v_cur + 1 < v_n then rt := jsonb_set(rt, '{cur}', to_jsonb(v_cur + 1)); else v_final := true; end if;
 end if;
 rt := jsonb_set(rt, array['stages', v_cur::text], st);
 if v_s2 then
  v_so := v_so || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('step', case when coalesce(v_slot->>'role', v_slot->'of'->>'role') = 'am' then 'am' else 'gm' end,
    'stage', v_cur + 1, 'by', a->>'name', 'emp', a->>'emp', 'role', a->>'role', 'at', v_now, 'proxy', false, 'via', c->>'via', 'for', c->>'for_name', 'note', p_note)));
 end if;
 if v_final then
  rt := rt || jsonb_build_object('final', v_now);
  update public.wr_requests set route = rt, status = 'approved', approved_by = a->>'name', approved_emp = a->>'emp', approved_at = v_now,
    step = case when v_s2 then null else step end, signoffs = case when v_s2 then v_so else signoffs end,
    rev = r.rev + 1, updated_at = v_now where id = r.id returning * into r;
  v_to := 'approved';
 else
  -- 段階 2 の step は次の段に合わせる（スイッチを切ったときに今までの決まりで続けられるように）
  update public.wr_requests set route = rt, signoffs = case when v_s2 then v_so else signoffs end,
    step = case when v_s2 and (rt->>'cur')::int > v_cur then
      case when 'am' = any(steps) and exists (select 1 from jsonb_array_elements(rt->'stages'->(v_cur + 1)->'slots') x where coalesce(x->>'role', x->'of'->>'role') = 'am')
       then 'am' else coalesce(steps[cardinality(steps)], step) end else step end,
    rev = r.rev + 1, updated_at = v_now
   where id = r.id returning * into r;
  v_to := 'pending';
 end if;
 insert into public.wr_events(request_id, at, action, from_status, to_status, version, rev, by_emp, by_name, by_role, note, client_key, bulk_id, detail)
  values (r.id, v_now, 'approve', 'pending', v_to, r.version, r.rev, a->>'emp', a->>'name', a->>'role', p_note, p_key, p_bulk,
   jsonb_strip_nulls(jsonb_build_object('stage', v_cur + 1, 'stages', v_n, 'k', c->>'k', 'via', c->>'via', 'for_emp', c->>'for_emp', 'for_name', c->>'for_name',
    'rule_ver', rt->'rule'->'ver', 'final', v_final)));
 return r;
end $$;

create or replace function public.ar_act_approve(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v_key text := p->>'client_key'; v_note text := nullif(btrim(coalesce(p->>'note', '')), '');
 v_bulk text := nullif(p->>'bulk_id', ''); r public.wr_requests; v_rid uuid; v_ract text; c jsonb;
begin
 if v_key is null or v_key !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'bad_value'; end if;
 if v_note is not null and length(v_note) > 400 then raise exception 'bad_value'; end if;
 perform pg_advisory_xact_lock(hashtext('wr_key:' || v_key));
 select e.request_id, e.action into v_rid, v_ract from public.wr_events e where e.client_key = v_key;
 if v_rid is not null then
  select * into r from public.wr_requests x where x.id = v_rid;
  if not public.wr_visible(a, r) or v_ract is distinct from 'approve'
     or not (coalesce(p->>'id', '') = r.id::text or coalesce(p->>'code', '') = r.code) then raise exception 'conflict'; end if;
  return public.wr_row(a, r) || jsonb_build_object('replay', true);
 end if;
 r := public.wr_find(a, p);
 select * into r from public.wr_requests x where x.id = r.id for update;
 if not (jsonb_typeof(p->'expect_rev') = 'number' and (p->>'expect_rev')::int = r.rev) then raise exception 'conflict'; end if;
 if r.status <> 'pending' or r.route is null or not public.ar_live() then raise exception 'conflict'; end if;
 c := public.ar_can_approve(a, r);
 if c is null then raise exception 'forbidden'; end if;
 r := public.ar_do_approve(a, r, c, v_note, v_key, v_bulk);
 return public.wr_row(a, r);
end $$;

create or replace function public.wr_act(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v_id uuid; r public.wr_requests;
begin
 if coalesce(p->>'action', '') = 'approve' and public.ar_live() then
  if nullif(p->>'id', '') is not null then
   begin v_id := (p->>'id')::uuid; exception when others then v_id := null; end;
   select * into r from public.wr_requests x where x.id = v_id;
  elsif nullif(p->>'code', '') is not null then
   select * into r from public.wr_requests x where x.code = p->>'code';
  end if;
  if r.id is not null and r.route is not null
     and (r.status = 'pending' or exists (select 1 from public.wr_events e where e.client_key = p->>'client_key' and e.request_id = r.id)) then
   return public.ar_act_approve(p);
  end if;
 end if;
 return public.wr_act_v0(p);
end $$;

-- ---------------------------------------------------------------- GM・CEO の一括承認
-- 選んだ申請の id と見たときの版（rev）。1 件ずつ別の小さな取引（1 件が通らなくてもほかは進む）。今の段で承認できるものだけ（ほかの人の段を代わりに承認しない）。
-- 同じ操作の番号（client_key）の送り直しは前の結果を返す。反映・経理の確認・支払は含めない。
create or replace function public.ar_bulk_counts(res jsonb) returns jsonb
language sql immutable security invoker set search_path = public, pg_temp as $$
 select jsonb_build_object('final', count(*) filter (where x->>'outcome' = 'final'), 'next', count(*) filter (where x->>'outcome' = 'next'),
  'stage', count(*) filter (where x->>'outcome' = 'stage'),
  'skip', count(*) filter (where x->>'outcome' = 'skip'), 'failed', count(*) filter (where x->>'outcome' = 'failed'))
  from jsonb_array_elements(coalesce(res, '[]'::jsonb)) x;
$$;

create or replace function public.ar_bulk(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p); v_id text := p->>'client_key'; b public.ar_bulk; it jsonb; r public.wr_requests; v_res jsonb := '[]'::jsonb;
 v_out text; v_why text; v_key text; res jsonb; v_seen text[] := '{}'::text[]; v_items jsonb := p->'items'; v_base jsonb; v_now timestamptz := now(); v_pre integer;
begin
 if (a->>'role') not in ('ceo','gm') then raise exception 'forbidden'; end if;
 if v_id is null or v_id !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'bad_value'; end if;
 if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items) < 1 or jsonb_array_length(v_items) > 200 then raise exception 'bad_value'; end if;
 for it in select x from jsonb_array_elements(v_items) x loop
  if jsonb_typeof(it) <> 'object' or jsonb_typeof(it->'rev') is distinct from 'number' or coalesce(it->>'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or (it->>'id') = any(v_seen) then raise exception 'bad_value'; end if;
  v_seen := v_seen || (it->>'id');
 end loop;
 perform pg_advisory_xact_lock(hashtext('ar_bulk:' || v_id));
 select * into b from public.ar_bulk x where x.id = v_id;
 if b.id is not null then
  if b.by_emp is distinct from a->>'emp' or b.items is distinct from v_items then raise exception 'conflict'; end if;
  return jsonb_build_object('bulk_id', b.id, 'at', b.at, 'results', b.results, 'counts', public.ar_bulk_counts(b.results), 'replay', true);
 end if;
 v_base := p - 'items' - 'client_key' - 'note' - 'action' - 'id' - 'code' - 'expect_rev' - 'bulk_id';
 for it in select x from jsonb_array_elements(v_items) x loop
  v_out := null; v_why := null; res := null;
  select * into r from public.wr_requests x where x.id = (it->>'id')::uuid;
  if r.id is null or not public.wr_visible(a, r) then v_out := 'skip'; v_why := 'not_found'; r := null;
  elsif r.rev <> (it->>'rev')::int then v_out := 'skip'; v_why := 'stale';
  elsif r.status <> 'pending' then v_out := 'skip'; v_why := 'not_pending';
  elsif public.wr_is_mine(a, r) and not (public.ar_on(r) and public.ar_self_ok(r, r.route->>'self')) then v_out := 'skip'; v_why := 'own';
  elsif not public.ar_on(r) and public.wr_is_s2(r.kind) and r.step is distinct from 'gm' then v_out := 'skip'; v_why := 'not_your_stage';
  elsif not ('approve' = any(public.wr_actions(a, r))) then v_out := 'skip'; v_why := case when public.ar_on(r) then 'not_your_stage' else 'not_allowed' end;
  end if;
  if v_out is null then
   v_key := 'bk-' || substr(md5(v_id || ':' || (it->>'id')), 1, 28);
   v_pre := case when r.route is not null and public.ar_on(r) then coalesce((r.route->>'cur')::int, 0) end;
   begin
    res := public.wr_act(v_base || jsonb_build_object('id', it->>'id', 'action', 'approve', 'expect_rev', (it->>'rev')::int, 'client_key', v_key, 'bulk_id', v_id));
    update public.wr_events set bulk_id = v_id where client_key = v_key and bulk_id is null;
    v_out := case when res->>'status' = 'approved' then 'final' else 'next' end;
    -- 「全員」の段で、まだほかの枠が残っている（段は進んでいない）＝ stage
    if v_out = 'next' and v_pre is not null then
     select * into r from public.wr_requests x where x.id = (it->>'id')::uuid;
     if r.status = 'pending' and r.route is not null and coalesce((r.route->>'cur')::int, 0) = v_pre then v_out := 'stage'; end if;
    end if;
   exception when others then
    v_why := case when sqlerrm in ('conflict','forbidden','not_found','bad_value') then sqlerrm else 'error' end;
    v_out := case when v_why in ('conflict','forbidden','not_found') then 'skip' else 'failed' end;
    if v_why = 'conflict' then v_why := 'stale'; elsif v_why = 'forbidden' then v_why := 'not_allowed'; end if;
   end;
   select * into r from public.wr_requests x where x.id = (it->>'id')::uuid;
  end if;
  v_res := v_res || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', it->>'id', 'code', r.code, 'kind', r.kind, 'outcome', v_out, 'reason', v_why,
    'status', r.status, 'rev', r.rev, 'next', case when v_out in ('next','stage') then public.wr_next(r) end)));
 end loop;
 insert into public.ar_bulk(id, by_emp, by_name, by_role, at, items, results) values (v_id, a->>'emp', a->>'name', a->>'role', v_now, v_items, v_res);
 return jsonb_build_object('bulk_id', v_id, 'at', v_now, 'results', v_res, 'counts', public.ar_bulk_counts(v_res));
end $$;

-- ---------------------------------------------------------------- 設定（CEO・GM だけ）
create or replace function public.ar_admin(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.wr_actor(p);
begin
 if (a->>'role') not in ('ceo','gm') then raise exception 'forbidden'; end if;
 return a;
end $$;

create or replace function public.ar_note(p jsonb, p_need boolean) returns text
language plpgsql immutable security invoker set search_path = public, pg_temp as $$
declare v text := nullif(btrim(coalesce(p->>'note', '')), '');
begin
 if v is not null and length(v) > 400 then raise exception 'bad_value'; end if;
 if p_need and v is null then raise exception 'reason_required'; end if;
 return v;
end $$;

-- 枠の形（承認者・閲覧者）
create or replace function public.ar_slot_errors(s jsonb, p_viewer boolean) returns text[]
language plpgsql immutable security invoker set search_path = public, pg_temp as $$
declare o text[] := '{}'::text[];
begin
 if jsonb_typeof(s) is distinct from 'object' then return array['slot']; end if;
 if exists (select 1 from jsonb_object_keys(s) k where k not in ('t','role','scope','stores','each','emp')) then o := o || 'slot_key'::text; end if;
 if s->>'t' = 'role' then
  if coalesce(s->>'role', '') not in ('ceo','gm','am','chef','acct_mgr','acct_lead','office_crew') then o := o || 'slot_role'::text; end if;
  if coalesce(s->>'scope', 'all') not in ('all','mine','stores') then o := o || 'slot_scope'::text; end if;
  if s->>'scope' = 'stores' and (jsonb_typeof(s->'stores') is distinct from 'array' or jsonb_array_length(s->'stores') = 0 or jsonb_array_length(s->'stores') > 50
     or exists (select 1 from jsonb_array_elements(s->'stores') x where jsonb_typeof(x) <> 'string' or length(x #>> '{}') > 40)) then o := o || 'slot_stores'::text; end if;
  if s ? 'each' and (jsonb_typeof(s->'each') <> 'boolean' or p_viewer) then o := o || 'slot_each'::text; end if;
  if s ? 'emp' then o := o || 'slot_key'::text; end if;
 elsif s->>'t' = 'emp' then
  if coalesce(s->>'emp', '') !~ '^[A-Za-z0-9_.:-]{1,64}$' then o := o || 'slot_emp'::text; end if;
  if s ?| array['role','scope','stores','each'] then o := o || 'slot_key'::text; end if;
 else o := o || 'slot'::text;
 end if;
 return o;
end $$;

create or replace function public.ar_stages_errors(st jsonb) returns text[]
language plpgsql immutable security invoker set search_path = public, pg_temp as $$
declare o text[] := '{}'::text[]; x jsonb; s jsonb;
begin
 if jsonb_typeof(st) is distinct from 'array' or jsonb_array_length(st) < 1 or jsonb_array_length(st) > 5 then return array['stages']; end if;
 for x in select y from jsonb_array_elements(st) y loop
  if jsonb_typeof(x) is distinct from 'object' or coalesce(x->>'mode', '') not in ('any','all')
     or exists (select 1 from jsonb_object_keys(x) k where k not in ('mode','slots')) then o := o || 'stage'::text; continue; end if;
  if jsonb_typeof(x->'slots') is distinct from 'array' or jsonb_array_length(x->'slots') < 1 or jsonb_array_length(x->'slots') > 8 then o := o || 'slots'::text; continue; end if;
  for s in select y from jsonb_array_elements(x->'slots') y loop o := o || public.ar_slot_errors(s, false); end loop;
 end loop;
 return o;
end $$;

-- 定義の形（保存できるか）
create or replace function public.ar_def_errors(d jsonb) returns text[]
language plpgsql immutable security invoker set search_path = public, pg_temp as $$
declare o text[] := '{}'::text[]; b jsonb; w jsonb; v jsonb;
begin
 if jsonb_typeof(d) is distinct from 'object' or length(d::text) > 20000 then return array['def']; end if;
 if exists (select 1 from jsonb_object_keys(d) k where k not in ('branches','default','viewers','self')) then o := o || 'def_key'::text; end if;
 if d ? 'self' and coalesce(d->>'self', '') not in ('ceo','gm','block') then o := o || 'self'::text; end if;
 if d ? 'branches' then
  if jsonb_typeof(d->'branches') <> 'array' or jsonb_array_length(d->'branches') > 10 then o := o || 'branches'::text;
  else
   for b in select y from jsonb_array_elements(d->'branches') y loop
    if jsonb_typeof(b) is distinct from 'object' or exists (select 1 from jsonb_object_keys(b) k where k not in ('label','when','stages'))
       or (b ? 'label' and (jsonb_typeof(b->'label') <> 'string' or length(b->>'label') > 60)) then o := o || 'branch'::text; continue; end if;
    w := b->'when';
    if jsonb_typeof(w) is distinct from 'object' or (select count(*) from jsonb_object_keys(w)) = 0
       or exists (select 1 from jsonb_object_keys(w) k where k not in ('min_cents','max_cents','stores','hq','has_am'))
       or (w ? 'min_cents' and (jsonb_typeof(w->'min_cents') <> 'number' or (w->>'min_cents') !~ '^[0-9]{1,12}$'))
       or (w ? 'max_cents' and (jsonb_typeof(w->'max_cents') <> 'number' or (w->>'max_cents') !~ '^[0-9]{1,12}$'))
       or (w ? 'min_cents' and w ? 'max_cents' and (w->>'min_cents')::bigint >= (w->>'max_cents')::bigint)
       or (w ? 'stores' and (jsonb_typeof(w->'stores') <> 'array' or jsonb_array_length(w->'stores') = 0 or jsonb_array_length(w->'stores') > 50
           or exists (select 1 from jsonb_array_elements(w->'stores') x where jsonb_typeof(x) <> 'string' or length(x #>> '{}') > 40)))
       or (w ? 'hq' and jsonb_typeof(w->'hq') <> 'boolean') or (w ? 'has_am' and jsonb_typeof(w->'has_am') <> 'boolean') then o := o || 'when'::text; end if;
    o := o || public.ar_stages_errors(b->'stages');
   end loop;
  end if;
 end if;
 if jsonb_typeof(d->'default') is distinct from 'object' then o := o || 'default'::text;
 elsif coalesce(d->'default'->>'block', '') = 'true' then
  if exists (select 1 from jsonb_object_keys(d->'default') k where k not in ('block')) then o := o || 'default'::text; end if;
 else
  if exists (select 1 from jsonb_object_keys(d->'default') k where k not in ('label','stages'))
     or (d->'default' ? 'label' and (jsonb_typeof(d->'default'->'label') <> 'string' or length(d->'default'->>'label') > 60)) then o := o || 'default'::text; end if;
  o := o || public.ar_stages_errors(d->'default'->'stages');
 end if;
 if d ? 'viewers' then
  if jsonb_typeof(d->'viewers') <> 'array' or jsonb_array_length(d->'viewers') > 20 then o := o || 'viewers'::text;
  else
   for v in select y from jsonb_array_elements(d->'viewers') y loop
    if jsonb_typeof(v) is distinct from 'object' or exists (select 1 from jsonb_object_keys(v) k where k not in ('who','from'))
       or coalesce(v->>'from', 'submit') !~ '^(submit|final|stage:[1-5])$' then o := o || 'viewer'::text; continue; end if;
    o := o || public.ar_slot_errors(v->'who', true);
   end loop;
  end if;
 end if;
 return array(select distinct x from unnest(o) x order by x);
end $$;

-- 中身の確かめ（有効にする前）：承認する人のいない段・退職した人・届かない枝・同じ 1 人だけの 2 つの段
create or replace function public.ar_rule_check(p_kind text, d jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_err text[] := public.ar_def_errors(d); errs jsonb := '[]'::jsonb; warns jsonb := '[]'::jsonb; v_all text[]; v_br jsonb := '[]'::jsonb; b jsonb; w jsonb;
 i integer; j integer; v_st text[]; st jsonb; s jsonb; v_store text; r public.wr_requests; v_union text[];
 v_bad text[]; v_lbl text; v_sole text[]; v_catch boolean := false; v_seen jsonb := '[]'::jsonb;
begin
 if not (p_kind = any(public.ar_kinds())) then return jsonb_build_object('errors', jsonb_build_array(jsonb_build_object('code', 'kind')), 'warnings', '[]'::jsonb); end if;
 if cardinality(v_err) > 0 then
  return jsonb_build_object('errors', (select jsonb_agg(jsonb_build_object('code', x)) from unnest(v_err) x), 'warnings', '[]'::jsonb);
 end if;
 v_all := array(select st2.id::text from public.stores st2 where coalesce(st2.active, true) order by st2.id::text) || array['---']::text[];
 for i in 0 .. coalesce(jsonb_array_length(d->'branches'), 0) - 1 loop v_br := v_br || jsonb_build_array(d->'branches'->i || jsonb_build_object('_i', i)); end loop;
 if coalesce(d->'default'->>'block', '') <> 'true' then v_br := v_br || jsonb_build_array(d->'default' || jsonb_build_object('_i', -1)); end if;
 for b in select x from jsonb_array_elements(v_br) x loop
  i := (b->>'_i')::int;
  v_lbl := coalesce(nullif(b->>'label', ''), case when i < 0 then '既定' else '条件 ' || (i + 1) end);
  w := b->'when';
  if i >= 0 then
   if v_catch or exists (select 1 from jsonb_array_elements(v_seen) x where x = w) then
    errs := errs || jsonb_build_array(jsonb_build_object('code', 'unreachable', 'branch', v_lbl));
   end if;
   v_seen := v_seen || jsonb_build_array(w);
   if not (w ?| array['min_cents','max_cents','stores','hq','has_am']) then v_catch := true; end if;
  elsif v_catch then
   warns := warns || jsonb_build_array(jsonb_build_object('code', 'default_unused', 'branch', v_lbl));
  end if;
  -- この枝に当たりうる店
  v_st := array(select x from unnest(v_all) x where (w is null or (
     (w->'stores' is null or x = any(public.wr_arr(w->'stores')))
     and (w->'hq' is null or ((x = '---') = (w->>'hq')::boolean))
     and (w->'has_am' is null or ((cardinality(public.ar_holders('am', 'mine', x, '{}'::text[])) > 0) = (w->>'has_am')::boolean)))));
  for j in 0 .. jsonb_array_length(b->'stages') - 1 loop
   st := b->'stages'->j;
   for s in select x from jsonb_array_elements(st->'slots') x loop
    if s->>'t' = 'emp' and not public.ar_emp_ok(s->>'emp') then
     errs := errs || jsonb_build_array(jsonb_build_object('code', 'emp_out', 'branch', v_lbl, 'stage', j + 1, 'emp', s->>'emp', 'name', public.ar_emp_name(s->>'emp')));
    end if;
   end loop;
   if (select count(*) from jsonb_array_elements(st->'slots') x) <> (select count(distinct x) from jsonb_array_elements(st->'slots') x) then
    warns := warns || jsonb_build_array(jsonb_build_object('code', 'dup_slot', 'branch', v_lbl, 'stage', j + 1));
   end if;
   v_bad := '{}'::text[];
   foreach v_store in array v_st loop
    r := null; r.kind := p_kind; r.store_id := v_store; r.status := 'pending';
    if st->>'mode' = 'all' then
     if exists (select 1 from jsonb_array_elements(st->'slots') x where cardinality(public.ar_slot_people(x - 'each', r)) = 0) then v_bad := v_bad || v_store; end if;
    else
     if not exists (select 1 from jsonb_array_elements(st->'slots') x where cardinality(public.ar_slot_people(x - 'each', r)) > 0) then v_bad := v_bad || v_store; end if;
    end if;
   end loop;
   if cardinality(v_bad) > 0 then
    errs := errs || jsonb_build_array(jsonb_build_object('code', 'no_approver', 'branch', v_lbl, 'stage', j + 1, 'stores', to_jsonb(v_bad)));
   end if;
   -- 「全員」の段で、枠に別々の人を 1 人ずつ当てられない（兼任の 1 人が 2 枠を埋められない）。
   -- 「役割の全員」は出したときと同じく 1 人ずつの枠に分けてから数える（GM 全員の枠と GM 本人の名前の枠が同じ 1 人＝止まる）。だれもいない枠は no_approver で出す
   if st->>'mode' = 'all' then
    v_bad := '{}'::text[];
    foreach v_store in array v_st loop
     r := null; r.kind := p_kind; r.store_id := v_store; r.status := 'pending';
     if not public.ar_sdr_ok((select coalesce(jsonb_agg(z.v), '[]'::jsonb) from (
        select to_jsonb(array[y]) as v from jsonb_array_elements(st->'slots') x, unnest(public.ar_slot_people(x - 'each', r)) y
         where coalesce(x->>'each', '') = 'true'
        union all
        select to_jsonb(public.ar_slot_people(x - 'each', r)) from jsonb_array_elements(st->'slots') x
         where coalesce(x->>'each', '') <> 'true' and cardinality(public.ar_slot_people(x - 'each', r)) > 0) z)) then v_bad := v_bad || v_store; end if;
    end loop;
    if cardinality(v_bad) > 0 then
     errs := errs || jsonb_build_array(jsonb_build_object('code', 'same_person', 'branch', v_lbl, 'stage', j + 1, 'stores', to_jsonb(v_bad)));
    end if;
   end if;
  end loop;
 end loop;
 return jsonb_build_object('errors', errs, 'warnings', warns);
end $$;

-- 試す：店・金額・申請した人を選ぶと、使う枝・段ごとの名前・閲覧できる人
create or replace function public.ar_rule_preview(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.ar_admin(p); v_kind text := p->>'kind'; d jsonb := p->'def'; v_ver integer; r public.wr_requests; rt jsonb; v jsonb; v_view jsonb := '[]'::jsonb;
begin
 if not (coalesce(v_kind, '') = any(public.ar_kinds())) then raise exception 'bad_value'; end if;
 if d is null or jsonb_typeof(d) = 'null' then
  select x.def, x.ver into d, v_ver from public.ar_rules x where x.kind = v_kind and x.status in ('draft','active') order by case x.status when 'draft' then 0 else 1 end limit 1;
 end if;
 if d is null or cardinality(public.ar_def_errors(d)) > 0 then raise exception 'rule_invalid'; end if;
 r.kind := v_kind; r.status := 'pending'; r.rev := 1; r.version := 1;
 r.store_id := nullif(btrim(coalesce(p->>'store_id', '')), '');
 if p->>'amount_cents' is not null then
  if (p->>'amount_cents') !~ '^[0-9]{1,12}$' then raise exception 'bad_value'; end if;
  r.amount_cents := (p->>'amount_cents')::bigint;
 end if;
 r.requester_emp := nullif(p->>'requester', '');
 if r.requester_emp is not null then r.requester_name := public.ar_emp_name(r.requester_emp); end if;
 begin
  rt := public.ar_route_from_def(d, v_kind, coalesce(v_ver, 0), r, 'preview');
 exception when others then
  if sqlerrm = 'no_route' then return jsonb_build_object('blocked', true); end if;
  raise;
 end;
 r.route := rt;
 for v in select x from jsonb_array_elements(coalesce(rt->'viewers', '[]'::jsonb)) x loop
  v_view := v_view || jsonb_build_array(jsonb_build_object('label', public.ar_slot_label(v->'who'), 'from', coalesce(v->>'from', 'submit'),
   'names', (select coalesce(jsonb_agg(public.ar_emp_name(y) order by public.ar_emp_name(y)), '[]'::jsonb) from unnest(public.ar_slot_people(v->'who', r)) y)));
 end loop;
 return jsonb_build_object('route', public.ar_route_view('{}'::jsonb, r) - 'my', 'viewers', v_view, 'requester_name', r.requester_name);
end $$;

-- ---------------------------------------------------------------- ルールの状態・保存・有効化
create or replace function public.ar_rule_row(g public.ar_rules) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
 select case when g.kind is null then null else jsonb_build_object('kind', g.kind, 'ver', g.ver, 'status', g.status, 'def', g.def, 'note', g.note, 'rev', g.rev,
  'created_by', g.created_by, 'created_at', g.created_at, 'updated_by', g.updated_by, 'updated_at', g.updated_at,
  'activated_by', g.activated_by, 'activated_at', g.activated_at) end;
$$;

create or replace function public.ar_state(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.ar_admin(p); s public.ar_settings; v_kinds jsonb := '[]'::jsonb; k text; ga public.ar_rules; gd public.ar_rules;
begin
 select * into s from public.ar_settings where id = 1;
 foreach k in array public.ar_kinds() loop
  ga := null; gd := null;
  select * into ga from public.ar_rules x where x.kind = k and x.status = 'active';
  select * into gd from public.ar_rules x where x.kind = k and x.status = 'draft';
  v_kinds := v_kinds || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('kind', k, 'active', public.ar_rule_row(ga), 'draft', public.ar_rule_row(gd),
   'draft_check', case when gd.kind is not null then public.ar_rule_check(k, gd.def) end,
   'history', (select coalesce(jsonb_agg(jsonb_build_object('ver', x.ver, 'status', x.status, 'note', x.note, 'at', coalesce(x.activated_at, x.updated_at),
       'by', coalesce(x.activated_by, x.updated_by)) order by x.ver desc), '[]'::jsonb) from public.ar_rules x where x.kind = k),
   'old_routes', case when ga.kind is not null then (select count(*) from public.wr_requests r where r.kind = k and r.status = 'pending' and r.route is not null
       and (r.route->'rule'->>'ver')::int < ga.ver) end)));
 end loop;
 return jsonb_build_object('me', a, 'live', coalesce(s.live, false), 'rev', coalesce(s.rev, 1), 'live_at', s.live_at, 'live_by', s.live_by, 'kinds', v_kinds,
  'stuck', case when coalesce(s.live, false) then (select count(*) from public.wr_requests r where r.status = 'pending' and r.route is not null and public.ar_stuck(r)) else 0 end,
  'delegates', (select count(*) from public.ar_delegates d where d.active and public.ar_today() between d.starts and d.ends),
  'ready', not exists (select 1 from unnest(public.ar_kinds()) k2 where not exists (select 1 from public.ar_rules x where x.kind = k2 and x.status = 'active')));
end $$;

-- 新しい下書きの変更の回数（rev）の始まり：その種類のいちばん大きい回数（捨てた・前の版も）と 1000000 の大きいほう ＋ 1。
-- 前の ②（8b1ddec まで）は捨てた下書きの行を消していたので、消えた版の番号（v N）がまた使われ、回数も 1 から始まっていた。
-- 消える前から開いていた画面の「v N・回数 k（k は小さい）」が、作り直した別の中身の下書きに当たって有効にできた（#191・#192 の Codex の P2）。
-- 回数を 1000001 から始めれば、前の画面の小さな回数とは二度と当たらない（関数は 1〜10 億を受ける・画面は回数を見せずにそのまま送り返す）。
create or replace function public.ar_rule_rev_next(p_kind text) returns integer
language sql stable security invoker set search_path = public, pg_temp as $$
 select greatest(1000000, coalesce(max(x.rev), 0)) + 1 from public.ar_rules x where x.kind = p_kind;
$$;

-- 画面が見た下書きを、版（expect_ver）と変更の回数（expect_rev）の両方で確かめる。
-- 下書きが無いとき（expect_ver・expect_rev が 0）は、画面が見た有効な版（base_ver・無ければ 0）が今と同じときだけ新しい下書きを作る（回数は ar_rule_rev_next）。
create or replace function public.ar_rule_save(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.ar_admin(p); v_kind text := p->>'kind'; d jsonb := p->'def'; g public.ar_rules; v_note text := public.ar_note(p, false); v_now timestamptz := now(); v_ver integer;
 v_active integer;
begin
 if not (coalesce(v_kind, '') = any(public.ar_kinds())) or jsonb_typeof(p->'expect_rev') is distinct from 'number'
    or jsonb_typeof(p->'expect_ver') is distinct from 'number' or jsonb_typeof(p->'base_ver') is distinct from 'number' then raise exception 'bad_value'; end if;
 if cardinality(public.ar_def_errors(d)) > 0 then raise exception 'rule_invalid'; end if;
 perform pg_advisory_xact_lock(hashtext('ar_rule:' || v_kind));
 select * into g from public.ar_rules x where x.kind = v_kind and x.status = 'draft' for update;
 if g.kind is null then
  select coalesce(max(x.ver), 0) into v_active from public.ar_rules x where x.kind = v_kind and x.status = 'active';
  if (p->>'expect_rev')::int <> 0 or (p->>'expect_ver')::int <> 0 or (p->>'base_ver')::int <> v_active then raise exception 'conflict'; end if;
  select coalesce(max(x.ver), 0) + 1 into v_ver from public.ar_rules x where x.kind = v_kind;
  insert into public.ar_rules(kind, ver, status, def, note, rev, created_by, created_emp, created_at, updated_by, updated_emp, updated_at)
   values (v_kind, v_ver, 'draft', d, v_note, public.ar_rule_rev_next(v_kind), a->>'name', a->>'emp', v_now, a->>'name', a->>'emp', v_now) returning * into g;
 else
  if (p->>'expect_rev')::int <> g.rev or (p->>'expect_ver')::int <> g.ver then raise exception 'conflict'; end if;
  update public.ar_rules set def = d, note = v_note, rev = g.rev + 1, updated_by = a->>'name', updated_emp = a->>'emp', updated_at = v_now
   where kind = g.kind and ver = g.ver returning * into g;
 end if;
 return jsonb_build_object('draft', public.ar_rule_row(g), 'check', public.ar_rule_check(v_kind, d));
end $$;

create or replace function public.ar_rule_activate(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.ar_admin(p); v_kind text := p->>'kind'; g public.ar_rules; v_note text := public.ar_note(p, true); c jsonb; v_now timestamptz := now();
begin
 if not (coalesce(v_kind, '') = any(public.ar_kinds())) or jsonb_typeof(p->'expect_rev') is distinct from 'number'
    or jsonb_typeof(p->'expect_ver') is distinct from 'number' then raise exception 'bad_value'; end if;
 perform pg_advisory_xact_lock(hashtext('ar_rule:' || v_kind));
 select * into g from public.ar_rules x where x.kind = v_kind and x.status = 'draft' for update;
 if g.kind is null or (p->>'expect_rev')::int <> g.rev or (p->>'expect_ver')::int <> g.ver then raise exception 'conflict'; end if;
 c := public.ar_rule_check(v_kind, g.def);
 if jsonb_array_length(c->'errors') > 0 then raise exception 'rule_invalid'; end if;
 update public.ar_rules set status = 'old' where kind = v_kind and status = 'active';
 update public.ar_rules set status = 'active', note = coalesce(v_note, note), activated_by = a->>'name', activated_emp = a->>'emp', activated_at = v_now
  where kind = g.kind and ver = g.ver returning * into g;
 return jsonb_build_object('active', public.ar_rule_row(g), 'check', c);
end $$;

create or replace function public.ar_rule_discard(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.ar_admin(p); v_kind text := p->>'kind'; g public.ar_rules;
begin
 if not (coalesce(v_kind, '') = any(public.ar_kinds())) or jsonb_typeof(p->'expect_rev') is distinct from 'number'
    or jsonb_typeof(p->'expect_ver') is distinct from 'number' then raise exception 'bad_value'; end if;
 perform pg_advisory_xact_lock(hashtext('ar_rule:' || v_kind));
 select * into g from public.ar_rules x where x.kind = v_kind and x.status = 'draft' for update;
 if g.kind is null or (p->>'expect_rev')::int <> g.rev or (p->>'expect_ver')::int <> g.ver then raise exception 'conflict'; end if;
 -- 消さずに discarded で残す（次の下書きは新しい版の番号＝古い画面の版と回数では当たらない）
 update public.ar_rules set status = 'discarded', updated_by = a->>'name', updated_emp = a->>'emp', updated_at = now() where kind = g.kind and ver = g.ver;
 return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- 承認上の役割（見るだけ：従業員マスターとアカウントから決まる・1B）
-- people：今の役割。wait：社員の表ではその役割に見えるが、まだ役割にならない人（GM・CEO の確かめ・経理のアカウントが要る）。
create or replace function public.ar_role_list(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.ar_admin(p);
begin
 return jsonb_build_object('people', (select coalesce(jsonb_agg(jsonb_build_object('emp', e.id::text, 'name', btrim(coalesce(e.name, '')), 'title', e.title,
   'store', e.store, 'out', public.wr_emp_out(e),
   'roles', (select coalesce(jsonb_agg(jsonb_build_object('role', g.role, 'label', public.ar_role_label(g.role), 'stores', to_jsonb(g.stores), 'src', g.src) order by g.role), '[]'::jsonb)
     from public.ar_role_rows() g where g.emp_id = e.id::text)) order by btrim(coalesce(e.name, ''))), '[]'::jsonb)
   from public.employees e where exists (select 1 from public.ar_role_rows() g where g.emp_id = e.id::text)),
  'wait', (select coalesce(jsonb_agg(jsonb_build_object('emp', x.emp, 'name', public.ar_emp_name(x.emp), 'role', x.role, 'label', public.ar_role_label(x.role), 'why', x.why)
     order by public.ar_emp_name(x.emp), x.role), '[]'::jsonb) from (
    select e.id::text as emp, 'am' as role, 'confirm' as why from public.employees e cross join lateral (select public.wr_person_live(e.id::text) as l) q
     where not public.wr_emp_out(e) and q.l is not null and (q.l->>'role') = 'am'
      and not exists (select 1 from public.ar_role_rows() g where g.emp_id = e.id::text and g.role = 'am')
    union all
    select e.id::text, 'chef', 'confirm' from public.employees e cross join lateral (select public.wr_person_live(e.id::text) as l) q
     where not public.wr_emp_out(e) and q.l is not null and coalesce((q.l->>'chef')::boolean, false)
      and not exists (select 1 from public.ar_role_rows() g where g.emp_id = e.id::text and g.role = 'chef')
    union all
    select e.id::text, case when btrim(coalesce(e.title, '')) = 'Accounting Leader' then 'acct_lead' else 'acct_mgr' end, 'account' from public.employees e
     where not public.wr_emp_out(e) and btrim(coalesce(e.title, '')) in ('Accounting Leader','Office Manager','Accounting Manager','Accountant')
      and not exists (select 1 from public.ar_role_rows() g where g.emp_id = e.id::text and g.role in ('acct_mgr','acct_lead'))
   ) x),
  'stores', (select coalesce(jsonb_agg(jsonb_build_object('id', st.id::text, 'name', st.name, 'am', st.am) order by st.id::text), '[]'::jsonb) from public.stores st where coalesce(st.active, true)));
end $$;

-- ---------------------------------------------------------------- 代理
create or replace function public.ar_delegate_list(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.ar_admin(p);
begin
 return jsonb_build_object('delegates', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'from', d.from_emp, 'from_name', public.ar_emp_name(d.from_emp),
   'to', d.to_emp, 'to_name', public.ar_emp_name(d.to_emp), 'kinds', to_jsonb(d.kinds), 'stores', to_jsonb(d.stores), 'starts', d.starts, 'ends', d.ends,
   'active', d.active, 'now', d.active and public.ar_today() between d.starts and d.ends, 'note', d.note, 'by', d.created_by, 'at', d.created_at,
   'ended_by', d.ended_by, 'ended_at', d.ended_at) order by d.starts desc, d.created_at desc), '[]'::jsonb)
  from public.ar_delegates d where d.active or d.ended_at > now() - interval '60 days' or d.ends >= public.ar_today() - 60));
end $$;

create or replace function public.ar_delegate_save(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.ar_admin(p); v_from text := p->>'from'; v_to text := p->>'to'; v_k text[]; v_st text[]; v_s date; v_e date; d public.ar_delegates;
 v_note text := public.ar_note(p, true);
begin
 if coalesce(v_from, '') !~ '^[A-Za-z0-9_.:-]{1,64}$' or coalesce(v_to, '') !~ '^[A-Za-z0-9_.:-]{1,64}$' or v_from = v_to
    or jsonb_typeof(coalesce(p->'kinds', '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p->'stores', '[]'::jsonb)) <> 'array' then raise exception 'bad_value'; end if;
 begin v_s := (p->>'starts')::date; v_e := (p->>'ends')::date; exception when others then raise exception 'bad_value'; end;
 if v_s is null or v_e is null or v_e < v_s or v_e > v_s + 366 or v_e < public.ar_today() then raise exception 'bad_value'; end if;
 v_k := array(select distinct x from unnest(public.wr_arr(p->'kinds')) x order by x);
 v_st := array(select distinct x from unnest(public.wr_arr(p->'stores')) x order by x);
 if exists (select 1 from unnest(v_k) x where not (x = any(public.ar_kinds())))
    or exists (select 1 from unnest(v_st) x where x <> '---' and not exists (select 1 from public.stores st where st.id::text = x)) then raise exception 'bad_value'; end if;
 if not public.ar_emp_ok(v_from) or not public.ar_emp_ok(v_to) then raise exception 'bad_value'; end if;
 perform pg_advisory_xact_lock(hashtext('ar_delegate'));
 -- 循環（A → B → … → A が同じ日に重なる）を止める
 if exists (with recursive c(emp, path) as (
    select v_to, array[v_from, v_to]
    union all
    select d2.to_emp, c.path || d2.to_emp from c join public.ar_delegates d2 on d2.from_emp = c.emp and d2.active and d2.starts <= v_e and d2.ends >= v_s
     where not (d2.to_emp = any(c.path[2:]))
   ) select 1 from c where c.emp = v_from) then raise exception 'delegate_cycle'; end if;
 insert into public.ar_delegates(from_emp, to_emp, kinds, stores, starts, ends, active, note, created_by, created_emp)
  values (v_from, v_to, v_k, v_st, v_s, v_e, true, v_note, a->>'name', a->>'emp') returning * into d;
 return jsonb_build_object('id', d.id);
end $$;

create or replace function public.ar_delegate_end(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.ar_admin(p); v_id uuid; d public.ar_delegates; v_note text := public.ar_note(p, false);
begin
 begin v_id := (p->>'id')::uuid; exception when others then raise exception 'bad_value'; end;
 update public.ar_delegates set active = false, ended_by = a->>'name', ended_emp = a->>'emp', ended_at = now(), note = coalesce(v_note, note)
  where id = v_id and active returning * into d;
 if d.id is null then raise exception 'conflict'; end if;
 return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- 承認する人のいない案件・例外（1 件の申請だけ・CEO・GM・理由が要る）
create or replace function public.ar_stuck_list(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.ar_admin(p);
begin
 return jsonb_build_object('rows', (select coalesce(jsonb_agg(public.wr_row(a, r) order by r.submitted_at), '[]'::jsonb)
  from public.wr_requests r where public.ar_live() and r.status = 'pending' and r.route is not null and public.ar_stuck(r)));
end $$;

-- 1 つの段を定義から作る（「全員」は今の人ごとに枠・枠の番号は p_k0 の次から）
create or replace function public.ar_stage_make(sd jsonb, r public.wr_requests, p_k0 integer) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare st jsonb; v_slots jsonb := '[]'::jsonb; s jsonb;
begin
 if cardinality(public.ar_stages_errors(jsonb_build_array(sd))) > 0 then raise exception 'rule_invalid'; end if;
 st := public.ar_route_from_def(jsonb_build_object('default', jsonb_build_object('stages', jsonb_build_array(sd))), r.kind, 0, r, 'exception')->'stages'->0;
 for s in select x from jsonb_array_elements(st->'slots') x loop
  v_slots := v_slots || jsonb_build_array(jsonb_set(s, '{k}', to_jsonb(((s->>'k')::int + p_k0)::text)));
 end loop;
 return jsonb_set(st, '{slots}', v_slots);
end $$;

create or replace function public.ar_max_k(rt jsonb) returns integer
language sql immutable security invoker set search_path = public, pg_temp as $$
 select coalesce(max((s->>'k')::int), 0) from jsonb_array_elements(coalesce(rt->'stages', '[]'::jsonb)) st, jsonb_array_elements(coalesce(st->'slots', '[]'::jsonb)) s;
$$;

-- 段 idx から後の承認を取り直す・今の段を決め直す
create or replace function public.ar_reset_from(rt jsonb, idx integer) returns jsonb
language plpgsql immutable security invoker set search_path = public, pg_temp as $$
declare o jsonb := '[]'::jsonb; st jsonb; i integer := 0; v_cur integer := null;
begin
 for st in select x from jsonb_array_elements(rt->'stages') x loop
  if i >= idx then st := jsonb_set(st, '{signs}', '[]'::jsonb) - 'done'; end if;
  if v_cur is null and not public.ar_stage_done(st) then v_cur := i; end if;
  o := o || jsonb_build_array(st); i := i + 1;
 end loop;
 return jsonb_set(jsonb_set(rt, '{stages}', o), '{cur}', to_jsonb(coalesce(v_cur, greatest(i - 1, 0))));
end $$;

create or replace function public.ar_exception(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.ar_admin(p); v_note text := public.ar_note(p, true); v_op text := p->>'op'; r public.wr_requests; rt jsonb; v_cur integer; v_n integer;
 idx integer; v_before jsonb; v_after jsonb; v_now timestamptz := now(); st jsonb; x jsonb; v_list jsonb; i integer; t public.wr_requests;
begin
 if coalesce(v_op, '') not in ('set_stage','add_stage','remove_stage','add_viewer','remove_viewer') or jsonb_typeof(p->'expect_rev') is distinct from 'number' then raise exception 'bad_value'; end if;
 r := public.wr_find(a, p);
 select * into r from public.wr_requests y where y.id = r.id for update;
 if (p->>'expect_rev')::int <> r.rev then raise exception 'conflict'; end if;
 if not public.ar_on(r) or r.status <> 'pending' then raise exception 'conflict'; end if;
 if public.wr_is_mine(a, r) then raise exception 'forbidden'; end if;     -- 自分の申請の承認者は変えない
 rt := r.route; v_cur := coalesce((rt->>'cur')::int, 0); v_n := jsonb_array_length(rt->'stages');
 if v_op in ('set_stage','add_stage','remove_stage') then
  if jsonb_typeof(p->'stage') is distinct from 'number' then raise exception 'bad_value'; end if;
  idx := (p->>'stage')::int - 1;
  if idx < v_cur or idx > v_n - (case when v_op = 'add_stage' then 0 else 1 end) then raise exception 'bad_value'; end if;   -- 済んだ段は変えない
  v_before := rt->'stages'->idx;
  v_list := '[]'::jsonb; i := 0;
  if v_op = 'set_stage' then
   v_after := public.ar_stage_make(p->'def', r, public.ar_max_k(rt));
   for st in select y from jsonb_array_elements(rt->'stages') y loop
    v_list := v_list || jsonb_build_array(case when i = idx then v_after else st end); i := i + 1;
   end loop;
  elsif v_op = 'add_stage' then
   v_after := public.ar_stage_make(p->'def', r, public.ar_max_k(rt));
   if v_n >= 5 then raise exception 'bad_value'; end if;
   for st in select y from jsonb_array_elements(rt->'stages') y loop
    if i = idx then v_list := v_list || jsonb_build_array(v_after); end if;
    v_list := v_list || jsonb_build_array(st); i := i + 1;
   end loop;
   if idx = v_n then v_list := v_list || jsonb_build_array(v_after); end if;
  else
   if v_n - 1 - v_cur < 1 then raise exception 'bad_value'; end if;                 -- 承認の済んでいない段を 1 つは残す（例外で最終承認にしない）
   for st in select y from jsonb_array_elements(rt->'stages') y loop
    if i <> idx then v_list := v_list || jsonb_build_array(st); end if; i := i + 1;
   end loop;
  end if;
  rt := public.ar_reset_from(jsonb_set(rt, '{stages}', v_list), idx);
  t := r; t.route := rt;
  if public.ar_stuck(t) then raise exception 'no_approver'; end if;                -- 本人だけ・だれもいない段にはしない
 else
  v_before := rt->'viewers';
  if v_op = 'add_viewer' then
   x := jsonb_build_object('who', p->'who', 'from', coalesce(p->>'from', 'submit'));
   if cardinality(public.ar_slot_errors(p->'who', true)) > 0 or (x->>'from') !~ '^(submit|final|stage:[1-5])$' or jsonb_array_length(coalesce(rt->'viewers', '[]'::jsonb)) >= 20 then raise exception 'bad_value'; end if;
   rt := jsonb_set(rt, '{viewers}', coalesce(rt->'viewers', '[]'::jsonb) || jsonb_build_array(x));
  else
   if jsonb_typeof(p->'viewer') is distinct from 'number' or (p->>'viewer')::int < 1 or (p->>'viewer')::int > jsonb_array_length(coalesce(rt->'viewers', '[]'::jsonb)) then raise exception 'bad_value'; end if;
   rt := jsonb_set(rt, '{viewers}', (rt->'viewers') - ((p->>'viewer')::int - 1));
  end if;
  v_after := rt->'viewers';
 end if;
 rt := jsonb_set(rt, '{ex}', coalesce(rt->'ex', '[]'::jsonb) || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('at', v_now, 'by', a->>'name', 'emp', a->>'emp', 'role', a->>'role',
   'op', v_op, 'stage', case when idx is not null then idx + 1 end, 'before', v_before, 'after', v_after, 'note', v_note))));
 update public.wr_requests set route = rt, rev = r.rev + 1, updated_at = v_now where id = r.id returning * into r;
 insert into public.wr_events(request_id, at, action, from_status, to_status, version, rev, by_emp, by_name, by_role, note, detail)
  values (r.id, v_now, 'route_exception', r.status, r.status, r.version, r.rev, a->>'emp', a->>'name', a->>'role', v_note,
   jsonb_strip_nulls(jsonb_build_object('op', v_op, 'stage', case when idx is not null then idx + 1 end, 'before', v_before, 'after', v_after)));
 return public.wr_row(a, r);
end $$;

-- ---------------------------------------------------------------- 進行中の案件に新しい版を当てる（明示の操作）
-- 同じ中身の段（前から順に）は承認を残す。違う段から後は取り直す。
create or replace function public.ar_apply_route(r public.wr_requests, p_ver integer) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare o jsonb := r.route; nw jsonb; i integer := 0; v_keep integer := 0; v_n integer; st jsonb;
begin
 nw := public.ar_route_build(r, p_ver, 'apply');
 v_n := jsonb_array_length(nw->'stages');
 while i < least(v_n, jsonb_array_length(o->'stages')) loop
  st := o->'stages'->i;
  exit when not (st ? 'done') or (st->>'mode') is distinct from (nw->'stages'->i->>'mode') or (st->'slots') is distinct from (nw->'stages'->i->'slots');
  nw := jsonb_set(nw, array['stages', i::text], st);
  i := i + 1;
 end loop;
 v_keep := i;
 nw := jsonb_set(nw, '{cur}', to_jsonb(least(v_keep, v_n - 1)));
 return nw || jsonb_build_object('keep', v_keep, 'ex', coalesce(o->'ex', '[]'::jsonb));
end $$;

create or replace function public.ar_apply_preview(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.ar_admin(p); v_kind text := p->>'kind'; g public.ar_rules; r public.wr_requests; nw jsonb; v_rows jsonb := '[]'::jsonb;
begin
 if not (coalesce(v_kind, '') = any(public.ar_kinds())) then raise exception 'bad_value'; end if;
 select * into g from public.ar_rules x where x.kind = v_kind and x.status = 'active';
 if g.kind is null then raise exception 'rules_missing'; end if;
 for r in select * from public.wr_requests x where x.kind = v_kind and x.status = 'pending' and x.route is not null and (x.route->'rule'->>'ver')::int < g.ver order by x.submitted_at loop
  begin
   nw := public.ar_apply_route(r, g.ver);
   v_rows := v_rows || jsonb_build_array(jsonb_build_object('id', r.id, 'code', r.code, 'rev', r.rev, 'store_id', r.store_id, 'amount_cents', r.amount_cents,
    'requester_name', r.requester_name, 'from_ver', (r.route->'rule'->>'ver')::int, 'from_label', r.route->>'label', 'to_label', nw->>'label',
    'from_stages', jsonb_array_length(r.route->'stages'), 'to_stages', jsonb_array_length(nw->'stages'), 'keep', (nw->>'keep')::int,
    'final', (nw->>'keep')::int >= jsonb_array_length(nw->'stages')));
  exception when others then
   v_rows := v_rows || jsonb_build_array(jsonb_build_object('id', r.id, 'code', r.code, 'rev', r.rev, 'blocked', true));
  end;
 end loop;
 return jsonb_build_object('kind', v_kind, 'ver', g.ver, 'rows', v_rows);
end $$;

create or replace function public.ar_apply(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.ar_admin(p); v_kind text := p->>'kind'; v_note text := public.ar_note(p, true); g public.ar_rules; it jsonb; r public.wr_requests; nw jsonb;
 v_res jsonb := '[]'::jsonb; v_out text; v_now timestamptz := now(); v_last jsonb; v_from integer; v_n integer;
begin
 if not (coalesce(v_kind, '') = any(public.ar_kinds())) or jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') < 1 or jsonb_array_length(p->'items') > 200
    or jsonb_typeof(p->'ver') is distinct from 'number' then raise exception 'bad_value'; end if;
 perform pg_advisory_xact_lock(hashtext('ar_rule:' || v_kind));   -- 有効にする操作と重ならない
 select * into g from public.ar_rules x where x.kind = v_kind and x.status = 'active';
 if g.kind is null then raise exception 'rules_missing'; end if;
 -- 確かめの画面で見た版（ar_apply_preview の ver）と今の有効な版が違えば何もしない（確かめていないルールを当てない）
 if (p->>'ver')::int <> g.ver then raise exception 'conflict'; end if;
 for it in select x from jsonb_array_elements(p->'items') x loop
  v_out := null; r := null;
  begin
   if jsonb_typeof(it->'rev') is distinct from 'number' then raise exception 'bad_value'; end if;
   select * into r from public.wr_requests x where x.id = (it->>'id')::uuid and x.kind = v_kind for update;
   if r.id is null or r.status <> 'pending' or r.route is null or r.rev <> (it->>'rev')::int or (r.route->'rule'->>'ver')::int >= g.ver then raise exception 'conflict'; end if;
   v_from := (r.route->'rule'->>'ver')::int;
   nw := public.ar_apply_route(r, g.ver);
   v_n := jsonb_array_length(nw->'stages');
   nw := jsonb_set(nw - 'keep', '{ex}', coalesce(nw->'ex', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', v_now, 'by', a->>'name', 'emp', a->>'emp', 'role', a->>'role',
     'op', 'apply', 'from_ver', v_from, 'to_ver', g.ver, 'note', v_note)));
   if (nw->'stages'->(v_n - 1)) ? 'done' then
    -- 新しい版の段がすべて同じ中身で済んでいる（段が減った）→ 承認済み
    select y into v_last from jsonb_array_elements(nw->'stages'->(v_n - 1)->'signs') y order by y->>'at' desc limit 1;
    nw := nw || jsonb_build_object('final', v_now);
    update public.wr_requests set route = nw, status = 'approved', approved_by = v_last->>'name', approved_emp = v_last->>'emp', approved_at = v_now,
      step = case when public.wr_is_s2(kind) then null else step end, rev = r.rev + 1, updated_at = v_now where id = r.id returning * into r;
    v_out := 'final';
   else
    update public.wr_requests set route = nw, rev = r.rev + 1, updated_at = v_now where id = r.id returning * into r;
    v_out := 'applied';
   end if;
   insert into public.wr_events(request_id, at, action, from_status, to_status, version, rev, by_emp, by_name, by_role, note, detail)
    values (r.id, v_now, 'route_apply', 'pending', r.status, r.version, r.rev, a->>'emp', a->>'name', a->>'role', v_note,
     jsonb_build_object('from_ver', v_from, 'to_ver', g.ver));
  exception when others then
   v_out := case when sqlerrm in ('conflict','bad_value') then 'stale' else 'failed' end;
  end;
  v_res := v_res || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', it->>'id', 'code', r.code, 'outcome', v_out)));
 end loop;
 return jsonb_build_object('kind', v_kind, 'ver', g.ver, 'results', v_res);
end $$;

-- ---------------------------------------------------------------- 使い始め・止める
create or replace function public.ar_go_live(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.ar_admin(p); s public.ar_settings; r public.wr_requests; rt jsonb; so jsonb; st jsonb; v_slot jsonb; v_n integer := 0;
 v_blocked jsonb := '[]'::jsonb; v_now timestamptz := now(); v_note text := public.ar_note(p, false); t public.wr_requests;
begin
 if jsonb_typeof(p->'expect_rev') is distinct from 'number' then raise exception 'bad_value'; end if;
 select * into s from public.ar_settings where id = 1 for update;
 if s.rev <> (p->>'expect_rev')::int then raise exception 'conflict'; end if;
 if s.live then raise exception 'conflict'; end if;
 if exists (select 1 from unnest(public.ar_kinds()) k where not exists (select 1 from public.ar_rules x where x.kind = k and x.status = 'active')) then raise exception 'rules_missing'; end if;
 update public.ar_settings set live = true, rev = s.rev + 1, live_at = v_now, live_by = a->>'name', live_emp = a->>'emp', updated_at = v_now where id = 1;
 for r in select * from public.wr_requests x where x.status = 'pending' and x.route is null order by x.submitted_at for update loop
  begin
   rt := public.ar_route_build(r, null, 'start');
  exception when others then
   v_blocked := v_blocked || to_jsonb(r.code); continue;
  end;
  -- 今までの AM の承認（代わりでないもの）を同じ段に写す（していない承認は作らない）
  st := rt->'stages'->0;
  t := r; t.route := rt;
  for so in select y from jsonb_array_elements(coalesce(r.signoffs, '[]'::jsonb)) y where y->>'step' = 'am' and coalesce(y->>'proxy', 'false') <> 'true' and y->>'emp' is not null loop
   select x into v_slot from public.ar_open_slots(st) x where coalesce(x->>'role', x->'of'->>'role') = 'am' and (so->>'emp') = any(public.ar_slot_elig(x, t, rt->>'self')) limit 1;
   if v_slot is not null then
    st := jsonb_set(st, '{signs}', coalesce(st->'signs', '[]'::jsonb) || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('k', v_slot->>'k', 'emp', so->>'emp',
      'name', so->>'by', 'role', so->>'role', 'at', so->'at', 'via', 'copied', 'note', so->>'note'))));
   end if;
  end loop;
  if public.ar_stage_done(st) and jsonb_array_length(rt->'stages') > 1 then
   rt := jsonb_set(jsonb_set(rt, '{stages,0}', st || jsonb_build_object('done', v_now)), '{cur}', '1'::jsonb);
  end if;
  update public.wr_requests set route = rt, rev = r.rev + 1, updated_at = v_now where id = r.id returning * into r;
  insert into public.wr_events(request_id, at, action, from_status, to_status, version, rev, by_emp, by_name, by_role, note, detail)
   values (r.id, v_now, 'route_start', r.status, r.status, r.version, r.rev, a->>'emp', a->>'name', a->>'role', v_note,
    jsonb_build_object('rule_ver', rt->'rule'->'ver', 'cur', (rt->>'cur')::int + 1));
  v_n := v_n + 1;
 end loop;
 return jsonb_build_object('live', true, 'rev', s.rev + 1, 'attached', v_n, 'blocked', v_blocked);
end $$;

create or replace function public.ar_go_off(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare a jsonb := public.ar_admin(p); s public.ar_settings; v_note text := public.ar_note(p, true);
begin
 if jsonb_typeof(p->'expect_rev') is distinct from 'number' then raise exception 'bad_value'; end if;
 select * into s from public.ar_settings where id = 1 for update;
 if s.rev <> (p->>'expect_rev')::int or not s.live then raise exception 'conflict'; end if;
 update public.ar_settings set live = false, rev = s.rev + 1, updated_at = now() where id = 1;
 -- 承認待ち・差し戻し中の申請のルートを外す（切れているあいだの直し・出し直しで、前の中身への承認が残らないように）。記録は wr_events に残す。
 -- もう一度「共通ルールで動かす」を押すと、そのときの有効なルールで付け直す（段の途中の承認は、今までの AM の承認だけ写す）。
 -- 差し戻し中だったものは、出し直したとき（共通ルールで動いていれば）段 1 から取り直す。
 insert into public.wr_events(request_id, at, action, from_status, to_status, version, rev, by_emp, by_name, by_role, note, detail)
 select x.id, now(), 'route_stop', x.status, x.status, x.version, x.rev, a->>'emp', a->>'name', a->>'role', v_note, jsonb_build_object('route', x.route)
  from public.wr_requests x where x.status in ('pending','returned') and x.route is not null;
 update public.wr_requests set route = null where status in ('pending','returned') and route is not null;
 return jsonb_build_object('live', false, 'rev', s.rev + 1);
end $$;
-- ---------------------------------------------------------------- 初めの写し（2 回流しても足さない）
-- 承認上の役割は表に写さない（決めてほしいこと 1B：従業員マスターとアカウントから毎回決める・ar_role_rows）。

-- ルール：初めの下書き（版 1）。どの種類もまだルールが無いときだけ。CEO・GM が確かめて有効にするまで何も変わらない。
-- 決めてほしいことの答え（11/17）：2B＝AM → GM の種類（シフト変更・採用・退職・Tip Rate・スキル）は GM・CEO の 1 段で、AM は閲覧者。
--   休暇は今と同じ（担当 AM・GM・CEO の誰か 1 人）。3＝GM の申請は GM 本人も承認できる（self: gm）。
-- 閲覧者（申請時から）：担当 AM と経理の 3 役（経理マネージャー・経理リーダー・事務Crew）＝今の wr_visible と同じ人。
do $$
declare
 v_gmo jsonb := jsonb_build_object('t', 'role', 'role', 'gm', 'scope', 'all');
 v_ceo jsonb := jsonb_build_object('t', 'role', 'role', 'ceo', 'scope', 'all');
 v_amo jsonb := jsonb_build_object('t', 'role', 'role', 'am', 'scope', 'mine');
 v_gm jsonb; v_lv jsonb; v_view jsonb; k text; d jsonb;
begin
 v_gm := jsonb_build_object('mode', 'any', 'slots', jsonb_build_array(v_gmo, v_ceo));
 v_lv := jsonb_build_object('mode', 'any', 'slots', jsonb_build_array(v_amo, v_gmo, v_ceo));
 v_view := jsonb_build_array(jsonb_build_object('who', v_amo, 'from', 'submit'),
  jsonb_build_object('who', jsonb_build_object('t', 'role', 'role', 'acct_mgr', 'scope', 'all'), 'from', 'submit'),
  jsonb_build_object('who', jsonb_build_object('t', 'role', 'role', 'acct_lead', 'scope', 'all'), 'from', 'submit'),
  jsonb_build_object('who', jsonb_build_object('t', 'role', 'role', 'office_crew', 'scope', 'all'), 'from', 'submit'));
 foreach k in array public.ar_kinds() loop
  if exists (select 1 from public.ar_rules x where x.kind = k) then continue; end if;
  if k = 'leave' then d := jsonb_build_object('default', jsonb_build_object('label', '担当 AM・GM・CEO の誰か', 'stages', jsonb_build_array(v_lv)));
  else d := jsonb_build_object('default', jsonb_build_object('label', 'GM・CEO', 'stages', jsonb_build_array(v_gm)));
  end if;
  d := d || jsonb_build_object('viewers', v_view, 'self', 'gm');
  insert into public.ar_rules(kind, ver, status, def, note, created_by, updated_by) values (k, 1, 'draft', d, '初めの下書き（11/17 の答え）', 'sql', 'sql');
 end loop;
end $$;

-- 今ある下書きの回数を 1 回だけ繰り上げる（回数が 1000000 以下＝前の作り方の下書きだけ・2 回流しても同じ）。
-- 前の ② のときに捨てて（行が消えて）作り直した下書きは、消える前から開いていた画面と版も回数も同じになっている。どれがそうかは表から分からないので、全部の下書きを繰り上げる。
-- 開いていた設定の画面は、次に押したとき「ほかの人が先に変えました」になり、入れていた変更を残したまま読み直す（何も書き換えない）。
do $$ declare g record; begin
 for g in select x.kind, x.ver from public.ar_rules x where x.status = 'draft' and x.rev <= 1000000 order by x.kind loop
  perform pg_advisory_xact_lock(hashtext('ar_rule:' || g.kind));
  update public.ar_rules set rev = public.ar_rule_rev_next(g.kind)
   where kind = g.kind and ver = g.ver and status = 'draft' and rev <= 1000000;
 end loop;
end $$;

-- ---------------------------------------------------------------- 呼べるのはサーバーの鍵だけ
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'ar\_%' or p.proname in ('wr_visible','wr_actions','wr_next','wr_row','wr_act','wr_get','wr_whoami','wr_stage',
     'wr_visible_v0','wr_actions_v0','wr_next_v0','wr_row_v0','wr_act_v0','wr_get_v0','wr_whoami_v0')) loop
  execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  execute format('grant execute on function %s to service_role', f.sig);
 end loop;
end $$;

notify pgrst, 'reload schema';
