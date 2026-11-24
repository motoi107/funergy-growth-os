-- キャリア・育成 A-2-1（v1214 の前・サーバー）：育成計画・OJT の表と関数（統合実装プロンプトの A-6・A-7・A-9・UI案101 の答え 11/24：4 A・5 B）。
-- 仕様：docs/GRADE_UNIFY_A_JA.md の 7。入れる順番：deploy/growth-plan-a2/手順.md
--（確かめ → この SQL → 確かめ → 関数 secure-state の 1 ファイル → 旧の記録を写す（何度でも同じ）→ 写した結果を確かめる）。
--
-- 表（どれも公開の鍵＝anon・authenticated では読めない・書けない。読み書きは関数 secure-state だけ＝サーバーの鍵）：
-- ・gp_plans：1 人 1 つの育成計画（開いている計画は 1 人 1 つ＝索引）。当時の系統・等級・担当型、次に目指す役割、現状と強み・課題（指導者）、
--   本人の希望（本人が書く・自己採点ではない）、会社・上司が用意すること（だれが・いつ・どの仕事・どう確かめる）、次の確認、
--   制度の版（Q4 のマスターと役割の文のマスター）。ver は行の版（同時編集の確かめ）。閉じても消さない。
-- ・gp_tasks：OJT（実務で確かめる課題）。関係する評価項目の ID（いくつでも・1 つの記録を共有＝二重入力・二重加点にしない）、学ぶ内容と完成の基準、
--   確認の方法、会社が用意する機会、指導者・確認者・期限、状態（未開始・実施中・確認待ち・再練習・習得確認済み・取りやめ）。
--   「習得確認済み」には確認者・確認日・根拠が要る（本人のチェックや既読では入らない＝関数 secure-state がだれが押せるかを確かめる）。
--   OJT は点数・Grade・時給・Tip Rate を変えない（このテーブルからほかの表へは何も書かない）。
-- ・gp_notes：記録（本人の希望・相談・実施メモ／指導者・確認者・上司の記録）。流れの段（共有・見本・実施・確認・再実施）。足すだけ（直さない・消さない）。
-- ・gp_log：計画と OJT の操作の記録（だれが・いつ・何を・前と後）。消さない。
-- ・gp_legacy：旧の OJT・成長管理の記録の写し（答え 5 B＝全部「旧として保存」・理由つき）。元（app_state）は変えない・消さない。
--   キーが人や項目の地図なら 1 件ずつ（src_part）に分けて写す。同じ中身は 2 回写さない。元が変わったら新しい行を足す（前の行は残す）。
-- ・gp_runs：写した回ごとの記録。
--
-- 2 回流しても同じ（行・記録は消さない）。戻すとき：先に関数 secure-state を前の 1 ファイルに戻してから db/gp-rollback.sql（関数だけ外す・表と記録は残す）。

do $$
begin
  if to_regclass('public.app_state') is null then raise exception 'STOP: public.app_state がありません（何も変えていません）'; end if;
  if to_regclass('public.employees') is null then raise exception 'STOP: public.employees がありません（何も変えていません）'; end if;
  if to_regclass('public.wr_people') is null then raise exception 'STOP: public.wr_people がありません（先に 20261104090000 を・何も変えていません）'; end if;
  if to_regclass('public.gp_plans') is not null and not exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'gp_plans' and column_name = 'support' and data_type = 'jsonb') then
    raise exception 'STOP: public.gp_plans がありますが形が違います（何も変えていません）';
  end if;
  if to_regclass('public.gp_tasks') is not null and not exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'gp_tasks' and column_name = 'items' and data_type = 'ARRAY') then
    raise exception 'STOP: public.gp_tasks がありますが形が違います（何も変えていません）';
  end if;
  if to_regclass('public.gp_legacy') is not null and not exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'gp_legacy' and column_name = 'src_hash' and data_type = 'text') then
    raise exception 'STOP: public.gp_legacy がありますが形が違います（何も変えていません）';
  end if;
end $$;

create table if not exists public.gp_plans (
  id bigserial primary key,
  emp_id text not null check (char_length(emp_id) between 1 and 64),
  emp_name text check (emp_name is null or char_length(emp_name) <= 120),
  status text not null default 'active' check (status in ('active', 'closed')),
  system text not null check (system in ('G', 'S_CHEF', 'S_OFFICE', 'PREP')),
  grade text check (grade is null or grade ~ '^(G[1-6]|S[1-6]|P[1-6])$'),
  type text check (type is null or char_length(type) between 1 and 40),
  target_grade text check (target_grade is null or target_grade ~ '^(G[1-6]|S[1-6]|P[1-6])$'),
  target text not null default '' check (char_length(target) <= 200),
  strengths text not null default '' check (char_length(strengths) <= 2000),
  issues text not null default '' check (char_length(issues) <= 2000),
  wish text not null default '' check (char_length(wish) <= 2000),
  support jsonb not null default '[]'::jsonb check (jsonb_typeof(support) = 'array' and jsonb_array_length(support) <= 20),
  next_check text not null default '' check (char_length(next_check) <= 1000),
  csq4_ver text not null check (char_length(csq4_ver) between 1 and 64),
  guide_ver text not null check (char_length(guide_ver) between 1 and 64),
  ver integer not null default 1 check (ver >= 1),
  created_at timestamptz not null default now(),
  created_by_emp text, created_by_name text, created_by_role text,
  updated_at timestamptz not null default now(),
  updated_by_emp text, updated_by_name text, updated_by_role text,
  closed_at timestamptz, closed_by_emp text, closed_by_name text,
  close_reason text check (close_reason is null or char_length(close_reason) between 1 and 1000),
  check ((status = 'closed') = (closed_at is not null and close_reason is not null)),
  check ((system = 'G' and grade ~ '^G[1-6]$') or (system in ('S_CHEF', 'S_OFFICE') and grade ~ '^S[1-6]$')
      or (system = 'PREP' and (grade is null or grade ~ '^P[1-6]$')))
);
comment on table public.gp_plans is 'キャリア・育成 A-2：1 人 1 つの育成計画（開いている計画は 1 人 1 つ）。読み書きは関数 secure-state だけ。docs/GRADE_UNIFY_A_JA.md の 7';
create unique index if not exists gp_plans_one_active on public.gp_plans (emp_id) where status = 'active';
create index if not exists gp_plans_emp on public.gp_plans (emp_id, id desc);

create table if not exists public.gp_tasks (
  id bigserial primary key,
  plan_id bigint not null references public.gp_plans(id),
  emp_id text not null check (char_length(emp_id) between 1 and 64),
  title text not null check (char_length(title) between 1 and 200),
  items text[] not null default '{}' check (cardinality(items) <= 20),
  standard text not null default '' check (char_length(standard) <= 2000),
  method text not null default '' check (char_length(method) <= 1000),
  opportunity text not null default '' check (char_length(opportunity) <= 1000),
  trainer_emp text check (trainer_emp is null or char_length(trainer_emp) between 1 and 64),
  trainer_name text,
  checker_emp text check (checker_emp is null or char_length(checker_emp) between 1 and 64),
  checker_name text,
  due date,
  state text not null default 'not_started' check (state in ('not_started', 'in_progress', 'waiting', 'retry', 'mastered', 'dropped')),
  mastered_at timestamptz, mastered_by_emp text, mastered_by_name text,
  mastered_basis text check (mastered_basis is null or char_length(mastered_basis) between 1 and 2000),
  ver integer not null default 1 check (ver >= 1),
  created_at timestamptz not null default now(),
  created_by_emp text, created_by_name text,
  updated_at timestamptz not null default now(),
  updated_by_emp text, updated_by_name text,
  check ((state = 'mastered') = (mastered_at is not null and mastered_by_emp is not null and mastered_basis is not null))
);
comment on table public.gp_tasks is 'キャリア・育成 A-2：OJT（実務で確かめる課題）。習得確認済みには確認者・日・根拠。点数・Grade・時給・Tip Rate は変えない';
create index if not exists gp_tasks_plan on public.gp_tasks (plan_id, id);
create index if not exists gp_tasks_trainer on public.gp_tasks (trainer_emp) where trainer_emp is not null;
create index if not exists gp_tasks_checker on public.gp_tasks (checker_emp) where checker_emp is not null;

create table if not exists public.gp_notes (
  id bigserial primary key,
  plan_id bigint not null references public.gp_plans(id),
  task_id bigint references public.gp_tasks(id),
  kind text not null check (kind in ('self', 'trainer', 'checker', 'manager')),
  step text check (step is null or step in ('share', 'demo', 'do', 'check', 'redo')),
  body text not null check (char_length(body) between 1 and 2000),
  at timestamptz not null default now(),
  by_emp text, by_name text, by_role text
);
comment on table public.gp_notes is 'キャリア・育成 A-2：記録（本人の希望・相談・実施メモ／指導者・確認者・上司の記録）。足すだけ';
create index if not exists gp_notes_plan on public.gp_notes (plan_id, id);

create table if not exists public.gp_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  plan_id bigint, task_id bigint, emp_id text,
  action text not null check (char_length(action) between 1 and 40),
  by_emp text, by_name text, by_role text,
  detail jsonb not null default '{}'::jsonb
);
comment on table public.gp_log is 'キャリア・育成 A-2：計画と OJT の操作の記録（消さない）';
create index if not exists gp_log_plan on public.gp_log (plan_id, id);

create table if not exists public.gp_runs (
  id bigserial primary key,
  at timestamptz not null default now(),
  via text not null check (via in ('fn', 'sql')),
  by_emp text, by_name text,
  report jsonb not null default '{}'::jsonb
);
comment on table public.gp_runs is 'キャリア・育成 A-2：旧の記録を写した回ごとの記録';

create table if not exists public.gp_legacy (
  id bigserial primary key,
  src_key text not null check (char_length(src_key) between 1 and 300),
  src_part text not null default '' check (char_length(src_part) <= 300),
  src_hash text not null check (src_hash ~ '^[0-9a-f]{64}$'),
  emp_id text,
  emp_name text,
  data jsonb not null,
  src_updated_at timestamptz,
  decision text not null default 'saved_as_old' check (decision = 'saved_as_old'),
  reason text not null check (char_length(reason) between 1 and 500),
  run_id bigint references public.gp_runs(id),
  copied_at timestamptz not null default now(),
  unique (src_key, src_part, src_hash)
);
comment on table public.gp_legacy is 'キャリア・育成 A-2：旧の OJT・成長管理の記録の写し（全部「旧として保存」・理由つき・元は変えない・読むだけ）';
create index if not exists gp_legacy_emp on public.gp_legacy (emp_id);

do $$
declare t text;
begin
  foreach t in array array['gp_plans', 'gp_tasks', 'gp_notes', 'gp_log', 'gp_runs', 'gp_legacy'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);   -- サーバーの鍵にも下で要る分だけ（消す・空にするは無し）
  end loop;
  foreach t in array array['gp_plans_id_seq', 'gp_tasks_id_seq', 'gp_notes_id_seq', 'gp_log_id_seq', 'gp_runs_id_seq', 'gp_legacy_id_seq'] loop
    execute format('revoke all on sequence public.%I from public, anon, authenticated', t);
    execute format('grant usage, select on sequence public.%I to service_role', t);
  end loop;
end $$;
grant select, insert, update on table public.gp_plans to service_role;
grant select, insert, update on table public.gp_tasks to service_role;
grant select, insert on table public.gp_notes to service_role;
grant select, insert on table public.gp_log to service_role;
grant select, insert, update on table public.gp_runs to service_role;   -- 写した回の記録（report）を写したあとに書く
grant select, insert on table public.gp_legacy to service_role;

-- 計画を作る（p_id が null）・直す（p_expect＝今の ver）。p_f は関数 secure-state が確かめた欄だけ（本人は wish だけ）。
-- 作るとき：開いている計画があれば open（その id）。直すとき：閉じた計画は state・ver が違えば conflict（書かない）。
create or replace function public.gp_plan_save(p_id bigint, p_expect integer, p_emp text, p_name text, p_f jsonb,
  p_by_emp text, p_by_name text, p_by_role text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare r public.gp_plans%rowtype; t timestamptz := now(); k text; nid bigint; before jsonb; after jsonb;
  allowed text[] := array['system', 'grade', 'type', 'target_grade', 'target', 'strengths', 'issues', 'wish', 'support', 'next_check', 'csq4_ver', 'guide_ver'];
begin
  if p_f is null or jsonb_typeof(p_f) <> 'object' then raise exception 'gp_bad_value' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_f) loop
    if not (k = any(allowed)) then raise exception 'gp_bad_value' using errcode = '22023'; end if;
  end loop;
  if p_id is null then
    if p_emp is null or not (p_f ? 'system') or not (p_f ? 'csq4_ver') or not (p_f ? 'guide_ver') then raise exception 'gp_bad_value' using errcode = '22023'; end if;
    perform pg_advisory_xact_lock(hashtext('funergy.gp_plan.' || p_emp));
    select id into nid from public.gp_plans where emp_id = p_emp and status = 'active';
    if found then return jsonb_build_object('ok', false, 'error', 'open', 'ids', jsonb_build_array(nid::text)); end if;
    insert into public.gp_plans (emp_id, emp_name, system, grade, type, target_grade, target, strengths, issues, wish, support, next_check, csq4_ver, guide_ver,
        created_at, created_by_emp, created_by_name, created_by_role, updated_at, updated_by_emp, updated_by_name, updated_by_role)
      values (p_emp, p_name, p_f->>'system', p_f->>'grade', p_f->>'type', p_f->>'target_grade', coalesce(p_f->>'target', ''),
        coalesce(p_f->>'strengths', ''), coalesce(p_f->>'issues', ''), coalesce(p_f->>'wish', ''), coalesce(p_f->'support', '[]'::jsonb),
        coalesce(p_f->>'next_check', ''), p_f->>'csq4_ver', p_f->>'guide_ver', t, p_by_emp, p_by_name, p_by_role, t, p_by_emp, p_by_name, p_by_role)
      returning id into nid;
    insert into public.gp_log (at, plan_id, emp_id, action, by_emp, by_name, by_role, detail)
      values (t, nid, p_emp, 'plan_create', p_by_emp, p_by_name, p_by_role, jsonb_build_object('fields', p_f));
    return jsonb_build_object('ok', true, 'id', nid, 'ver', 1, 'at', t);
  end if;
  select * into r from public.gp_plans where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if r.ver <> p_expect then return jsonb_build_object('ok', false, 'conflict', true, 'ver', r.ver); end if;
  if r.status <> 'active' then return jsonb_build_object('ok', false, 'error', 'state'); end if;
  select jsonb_object_agg(x.key, to_jsonb(r) -> x.key) into before from jsonb_each(p_f) x;
  update public.gp_plans set
      system = case when p_f ? 'system' then p_f->>'system' else system end,
      grade = case when p_f ? 'grade' then p_f->>'grade' else grade end,
      type = case when p_f ? 'type' then p_f->>'type' else type end,
      target_grade = case when p_f ? 'target_grade' then p_f->>'target_grade' else target_grade end,
      target = case when p_f ? 'target' then coalesce(p_f->>'target', '') else target end,
      strengths = case when p_f ? 'strengths' then coalesce(p_f->>'strengths', '') else strengths end,
      issues = case when p_f ? 'issues' then coalesce(p_f->>'issues', '') else issues end,
      wish = case when p_f ? 'wish' then coalesce(p_f->>'wish', '') else wish end,
      support = case when p_f ? 'support' then coalesce(p_f->'support', '[]'::jsonb) else support end,
      next_check = case when p_f ? 'next_check' then coalesce(p_f->>'next_check', '') else next_check end,
      csq4_ver = case when p_f ? 'csq4_ver' then p_f->>'csq4_ver' else csq4_ver end,
      guide_ver = case when p_f ? 'guide_ver' then p_f->>'guide_ver' else guide_ver end,
      ver = r.ver + 1, updated_at = t, updated_by_emp = p_by_emp, updated_by_name = p_by_name, updated_by_role = p_by_role
    where id = p_id;
  insert into public.gp_log (at, plan_id, emp_id, action, by_emp, by_name, by_role, detail)
    values (t, p_id, r.emp_id, 'plan_save', p_by_emp, p_by_name, p_by_role, jsonb_build_object('before', before, 'after', p_f));
  return jsonb_build_object('ok', true, 'id', p_id, 'ver', r.ver + 1, 'at', t);
end $$;

-- 計画を閉じる（理由が要る・行は残す）。閉じた計画の OJT はそのまま読める（状態は変えない）
create or replace function public.gp_plan_close(p_id bigint, p_expect integer, p_reason text, p_by_emp text, p_by_name text, p_by_role text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare r public.gp_plans%rowtype; t timestamptz := now();
begin
  if p_reason is null or char_length(btrim(p_reason)) = 0 or char_length(p_reason) > 1000 then raise exception 'gp_bad_value' using errcode = '22023'; end if;
  select * into r from public.gp_plans where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if r.ver <> p_expect then return jsonb_build_object('ok', false, 'conflict', true, 'ver', r.ver); end if;
  if r.status <> 'active' then return jsonb_build_object('ok', false, 'error', 'state'); end if;
  update public.gp_plans set status = 'closed', closed_at = t, closed_by_emp = p_by_emp, closed_by_name = p_by_name, close_reason = p_reason,
      ver = r.ver + 1, updated_at = t, updated_by_emp = p_by_emp, updated_by_name = p_by_name, updated_by_role = p_by_role
    where id = p_id;
  insert into public.gp_log (at, plan_id, emp_id, action, by_emp, by_name, by_role, detail)
    values (t, p_id, r.emp_id, 'plan_close', p_by_emp, p_by_name, p_by_role, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true, 'id', p_id, 'ver', r.ver + 1, 'at', t);
end $$;

-- OJT を作る（p_id が null）・直す（状態は変えない）。開いている計画の中だけ
create or replace function public.gp_task_save(p_plan_id bigint, p_id bigint, p_expect integer, p_f jsonb, p_by_emp text, p_by_name text, p_by_role text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare pl public.gp_plans%rowtype; r public.gp_tasks%rowtype; t timestamptz := now(); k text; nid bigint; before jsonb; its text[];
  allowed text[] := array['title', 'items', 'standard', 'method', 'opportunity', 'trainer_emp', 'trainer_name', 'checker_emp', 'checker_name', 'due'];
begin
  if p_f is null or jsonb_typeof(p_f) <> 'object' then raise exception 'gp_bad_value' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_f) loop
    if not (k = any(allowed)) then raise exception 'gp_bad_value' using errcode = '22023'; end if;
  end loop;
  if p_f ? 'items' then
    if jsonb_typeof(p_f->'items') <> 'array' then raise exception 'gp_bad_value' using errcode = '22023'; end if;
    select coalesce(array_agg(x), '{}') into its from jsonb_array_elements_text(p_f->'items') x;
  end if;
  select * into pl from public.gp_plans where id = p_plan_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if pl.status <> 'active' then return jsonb_build_object('ok', false, 'error', 'state'); end if;
  if p_id is null then
    if not (p_f ? 'title') then raise exception 'gp_bad_value' using errcode = '22023'; end if;
    if (select count(*) from public.gp_tasks where plan_id = p_plan_id) >= 60 then return jsonb_build_object('ok', false, 'error', 'too_many'); end if;
    insert into public.gp_tasks (plan_id, emp_id, title, items, standard, method, opportunity, trainer_emp, trainer_name, checker_emp, checker_name, due,
        created_at, created_by_emp, created_by_name, updated_at, updated_by_emp, updated_by_name)
      values (p_plan_id, pl.emp_id, p_f->>'title', coalesce(its, '{}'), coalesce(p_f->>'standard', ''), coalesce(p_f->>'method', ''),
        coalesce(p_f->>'opportunity', ''), p_f->>'trainer_emp', p_f->>'trainer_name', p_f->>'checker_emp', p_f->>'checker_name', (p_f->>'due')::date,
        t, p_by_emp, p_by_name, t, p_by_emp, p_by_name)
      returning id into nid;
    insert into public.gp_log (at, plan_id, task_id, emp_id, action, by_emp, by_name, by_role, detail)
      values (t, p_plan_id, nid, pl.emp_id, 'task_create', p_by_emp, p_by_name, p_by_role, jsonb_build_object('fields', p_f));
    return jsonb_build_object('ok', true, 'id', nid, 'ver', 1, 'at', t);
  end if;
  select * into r from public.gp_tasks where id = p_id and plan_id = p_plan_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if r.ver <> p_expect then return jsonb_build_object('ok', false, 'conflict', true, 'ver', r.ver); end if;
  if r.state in ('mastered', 'dropped') then return jsonb_build_object('ok', false, 'error', 'state', 'state', r.state); end if;
  select jsonb_object_agg(x.key, to_jsonb(r) -> x.key) into before from jsonb_each(p_f) x;
  update public.gp_tasks set
      title = case when p_f ? 'title' then p_f->>'title' else title end,
      items = case when p_f ? 'items' then coalesce(its, '{}') else items end,
      standard = case when p_f ? 'standard' then coalesce(p_f->>'standard', '') else standard end,
      method = case when p_f ? 'method' then coalesce(p_f->>'method', '') else method end,
      opportunity = case when p_f ? 'opportunity' then coalesce(p_f->>'opportunity', '') else opportunity end,
      trainer_emp = case when p_f ? 'trainer_emp' then p_f->>'trainer_emp' else trainer_emp end,
      trainer_name = case when p_f ? 'trainer_name' then p_f->>'trainer_name' else trainer_name end,
      checker_emp = case when p_f ? 'checker_emp' then p_f->>'checker_emp' else checker_emp end,
      checker_name = case when p_f ? 'checker_name' then p_f->>'checker_name' else checker_name end,
      due = case when p_f ? 'due' then (p_f->>'due')::date else due end,
      ver = r.ver + 1, updated_at = t, updated_by_emp = p_by_emp, updated_by_name = p_by_name
    where id = p_id;
  insert into public.gp_log (at, plan_id, task_id, emp_id, action, by_emp, by_name, by_role, detail)
    values (t, p_plan_id, p_id, r.emp_id, 'task_save', p_by_emp, p_by_name, p_by_role, jsonb_build_object('before', before, 'after', p_f));
  return jsonb_build_object('ok', true, 'id', p_id, 'ver', r.ver + 1, 'at', t);
end $$;

-- OJT の状態を進める（だれが押せるかは関数 secure-state が確かめる）。p_act：
--   start（未開始・再練習 → 実施中）／ask（実施中・再練習 → 確認待ち）／retry（確認待ち → 再練習・ひとこと要る）／
--   master（確認待ち → 習得確認済み・根拠が要る・確認者と日を残す）／reopen（習得確認済み → 実施中・理由が要る・前の確認は記録に残る）／
--   drop（まだ習得確認済みでない課題をやめる・理由が要る）
create or replace function public.gp_task_act(p_id bigint, p_expect integer, p_act text, p_note text, p_by_emp text, p_by_name text, p_by_role text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare r public.gp_tasks%rowtype; pl public.gp_plans%rowtype; t timestamptz := now(); nx text;
begin
  if p_act is null or p_act not in ('start', 'ask', 'retry', 'master', 'reopen', 'drop') then raise exception 'gp_bad_value' using errcode = '22023'; end if;
  if p_note is not null and char_length(p_note) > 2000 then raise exception 'gp_bad_value' using errcode = '22023'; end if;
  if p_act = 'master' and (p_by_emp is null or char_length(p_by_emp) = 0) then raise exception 'gp_bad_value' using errcode = '22023'; end if;   -- 習得確認はだれが確かめたかが要る
  if p_act in ('retry', 'master', 'reopen', 'drop') and (p_note is null or char_length(btrim(p_note)) = 0) then
    return jsonb_build_object('ok', false, 'error', 'reason_required');
  end if;
  select * into r from public.gp_tasks where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if r.ver <> p_expect then return jsonb_build_object('ok', false, 'conflict', true, 'ver', r.ver, 'state', r.state); end if;
  select * into pl from public.gp_plans where id = r.plan_id;
  if pl.status <> 'active' then return jsonb_build_object('ok', false, 'error', 'state'); end if;
  nx := case
    when p_act = 'start' and r.state in ('not_started', 'retry') then 'in_progress'
    when p_act = 'ask' and r.state in ('in_progress', 'retry') then 'waiting'
    when p_act = 'retry' and r.state = 'waiting' then 'retry'
    when p_act = 'master' and r.state = 'waiting' then 'mastered'
    when p_act = 'reopen' and r.state = 'mastered' then 'in_progress'
    when p_act = 'drop' and r.state in ('not_started', 'in_progress', 'waiting', 'retry') then 'dropped'
    else null end;
  if nx is null then return jsonb_build_object('ok', false, 'error', 'state', 'state', r.state); end if;
  update public.gp_tasks set state = nx,
      mastered_at = case when nx = 'mastered' then t else null end,
      mastered_by_emp = case when nx = 'mastered' then p_by_emp else null end,
      mastered_by_name = case when nx = 'mastered' then p_by_name else null end,
      mastered_basis = case when nx = 'mastered' then p_note else null end,
      ver = r.ver + 1, updated_at = t, updated_by_emp = p_by_emp, updated_by_name = p_by_name
    where id = p_id;
  if p_note is not null and char_length(btrim(p_note)) > 0 then
    insert into public.gp_notes (plan_id, task_id, kind, step, body, at, by_emp, by_name, by_role)
      values (r.plan_id, p_id, case when p_act in ('master', 'retry') then 'checker' when p_act in ('reopen', 'drop') then 'manager' else 'trainer' end,
        case when p_act = 'master' then 'check' when p_act = 'retry' then 'check' else null end, p_note, t, p_by_emp, p_by_name, p_by_role);
  end if;
  insert into public.gp_log (at, plan_id, task_id, emp_id, action, by_emp, by_name, by_role, detail)
    values (t, r.plan_id, p_id, r.emp_id, 'task_' || p_act, p_by_emp, p_by_name, p_by_role,
      jsonb_build_object('from', r.state, 'to', nx, 'note', p_note, 'prev_mastered', case when r.state = 'mastered' then
        jsonb_build_object('at', r.mastered_at, 'by', r.mastered_by_name, 'basis', r.mastered_basis) else null end));
  return jsonb_build_object('ok', true, 'id', p_id, 'ver', r.ver + 1, 'state', nx, 'at', t);
end $$;

-- 記録を足す（本人の希望・相談・実施メモ／指導者・確認者・上司の記録）。閉じた計画にも足せない
create or replace function public.gp_note_add(p_plan_id bigint, p_task_id bigint, p_kind text, p_step text, p_body text, p_by_emp text, p_by_name text, p_by_role text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare pl public.gp_plans%rowtype; t timestamptz := now(); nid bigint;
begin
  if p_body is null or char_length(btrim(p_body)) = 0 or char_length(p_body) > 2000 then raise exception 'gp_bad_value' using errcode = '22023'; end if;
  select * into pl from public.gp_plans where id = p_plan_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if pl.status <> 'active' then return jsonb_build_object('ok', false, 'error', 'state'); end if;
  if p_task_id is not null and not exists (select 1 from public.gp_tasks where id = p_task_id and plan_id = p_plan_id) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  insert into public.gp_notes (plan_id, task_id, kind, step, body, at, by_emp, by_name, by_role)
    values (p_plan_id, p_task_id, p_kind, p_step, p_body, t, p_by_emp, p_by_name, p_by_role) returning id into nid;
  return jsonb_build_object('ok', true, 'id', nid, 'at', t);
end $$;

-- 旧の OJT・成長管理の記録（app_state）。人・項目の地図（object）は 1 件ずつ、それ以外はキーごとに 1 行。
-- 名前のキーは、その名前を持つ人が 1 人のときだけ社員 ID を付ける（Career Score Q4 の写しと同じ考え）
create or replace function public.gp_legacy_source()
returns table (src_key text, src_part text, emp_id text, emp_name text, data jsonb, src_updated_at timestamptz, src_hash text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with keys as (
    select s.key as k, (case when jsonb_typeof(s.value) = 'object' and (s.value ? '__st') and (s.value ? 'v') then s.value->'v' else s.value end) as v, s.updated_at as at
      from public.app_state s
     where s.value is not null and (s.key in ('ojt_enroll', 'grade_ojt', 'ojt_phase_map', 'ojt_gate_criteria', 'ojt_def_g2', 'crew_education', 'career_track',
         'career_history', 'career_cfg', 'train_master', 'trainees', 'trainee_checklists', 'dev_pipe', 'dev_pipe_start', 'dev_nominations', 'dev_start', 'dev_data')
       or left(s.key, 8) = 'ojt_def_')
  ), raw as (
    select k.k, e.key as part, e.value as d, k.at from keys k cross join lateral jsonb_each(k.v) e where jsonb_typeof(k.v) = 'object'
    union all
    select k.k, '', k.v, k.at from keys k where jsonb_typeof(k.v) <> 'object'
  ), owners as (
    select e.id::text as id, e.name as name from public.employees e where coalesce(e.name, '') <> ''
    union
    select e.id::text, e.data->>'name' from public.employees e where jsonb_typeof(e.data) = 'object' and coalesce(e.data->>'name', '') <> ''
    union
    select w.emp_id, w.name from public.wr_people w where coalesce(w.name, '') <> ''
  ), uniq as (
    select o.name, min(o.id) as id from owners o group by o.name having count(distinct o.id) = 1
  ), ids as (
    select o.id from owners o group by o.id
  )
  select r.k, left(r.part, 300),
    coalesce((select i.id from ids i where i.id = r.part limit 1), u.id),
    left(coalesce(u.name, (select e.name from public.employees e where e.id::text = r.part limit 1)), 120),
    r.d, r.at, encode(sha256(convert_to(r.d::text, 'UTF8')), 'hex')
  from raw r left join uniq u on u.name = r.part and r.part <> ''
$$;

-- 旧の記録を gp_legacy に写す（全部「旧として保存」・理由つき。元は変えない・何度流しても同じ）。p_via：'fn'（関数・GM・CEO）か 'sql'
create or replace function public.gp_legacy_copy(p_via text, p_reason text, p_by_emp text, p_by_name text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare rid bigint; t timestamptz := now(); rep jsonb; n_added integer;
begin
  if p_via is null or p_via not in ('fn', 'sql') then raise exception 'gp_bad_via' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 or char_length(p_reason) > 500 then raise exception 'gp_bad_value' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('funergy.gp_legacy'));
  insert into public.gp_runs (at, via, by_emp, by_name) values (t, p_via, p_by_emp, p_by_name) returning id into rid;
  insert into public.gp_legacy (src_key, src_part, src_hash, emp_id, emp_name, data, src_updated_at, reason, run_id, copied_at)
    select c.src_key, c.src_part, c.src_hash, c.emp_id, c.emp_name, c.data, c.src_updated_at, p_reason, rid, t
      from public.gp_legacy_source() c
    on conflict (src_key, src_part, src_hash) do nothing;
  get diagnostics n_added = row_count;
  with c as (select * from public.gp_legacy_source())
  select jsonb_build_object(
      'run', rid, 'at', t, 'added', n_added,
      'keys', coalesce((select jsonb_object_agg(k.src_key, jsonb_build_object('src', k.src, 'present', k.present)) from (
          select c.src_key, count(*) as src,
            count(*) filter (where exists (select 1 from public.gp_legacy h where h.src_key = c.src_key and h.src_part = c.src_part and h.src_hash = c.src_hash)) as present
          from c group by c.src_key) k), '{}'::jsonb),
      'src', (select count(*) from c),
      'no_emp', (select count(*) from c where c.emp_id is null),
      'missing', (select count(*) from c where not exists (select 1 from public.gp_legacy h
          where h.src_key = c.src_key and h.src_part = c.src_part and h.src_hash = c.src_hash)),
      'legacy_rows', (select count(*) from public.gp_legacy))
    into rep;
  update public.gp_runs set report = rep where id = rid;
  return rep;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'gp_plan_save(bigint, integer, text, text, jsonb, text, text, text)',
    'gp_plan_close(bigint, integer, text, text, text, text)',
    'gp_task_save(bigint, bigint, integer, jsonb, text, text, text)',
    'gp_task_act(bigint, integer, text, text, text, text, text)',
    'gp_note_add(bigint, bigint, text, text, text, text, text, text)',
    'gp_legacy_source()',
    'gp_legacy_copy(text, text, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
comment on function public.gp_legacy_copy(text, text, text, text) is 'キャリア・育成 A-2：旧の OJT・成長管理の記録を gp_legacy に写す（全部「旧として保存」・元は変えない・何度流しても同じ）';
