-- Career Score 2026 Q4（新制度・CAREER_2026_Q4_V1）段階 3-1：サーバーの表と関数（UI案99 の答え 11/22：1 A・2 A・3 B・4〜8 A）。
-- 仕様：docs/CAREER_SCORE_Q4_JA.md の 7。入れる順番：deploy/career-score-q4-server/手順.md
--（確かめ → この SQL → 確かめ → 関数 secure-state の 1 ファイル → 今の記録を写す（任意・何度でも同じ）→ 写した結果を確かめる）。
--
-- 表（どれも公開の鍵＝anon・authenticated では読めない・書けない。読み書きは関数 secure-state だけ＝サーバーの鍵）：
-- ・csq4_periods：評価の期間（2026-Q4＝ハワイの 2026-10-01〜2026-12-31・制度版 CAREER_2026_Q4_V1）。
-- ・csq4_assign：人ごと・期間ごとの評価表（G・S_CHEF・S_OFFICE・PREP）・Grade・型。GM・CEO が決める（答え 1 A・2 A）。ver は人ごとの版。
-- ・csq4_evals：評価（本人・期間・評価表・その時の Grade と型・制度版・改訂 rev・状態・明細・計算の結果・本人に共有した内容・日時と人）。
--   状態：draft（入力中）・submitted（確認待ち）・returned（差戻し）・published（確定・公開済み）・superseded（再評価で置き換わった・残す）・
--   cancelled（取りやめ・残す）。1 人・1 期間に開いている評価（draft・submitted・returned）は 1 つ、確定・公開は 1 つ（索引で守る）。
--   明細（entries）と結果（result）は関数 secure-state が確かめ・計算して渡す（端末の総合点は使わない）。ver は行の版（同時編集の確かめ）。
-- ・csq4_reqs：本人の見直しの申し出（「任されていないため見直しを希望」・コメント）と答え。
-- ・csq4_log：評価の操作の記録（だれが・いつ・何を・前と後）。消さない。
-- ・csq4_hist：今までの Career Score の記録（app_state の lss_emp_・spl_lss_history_・spl_lss_requests_・lss_scores・lss_requests・lss_history、
--   賞与の確定で固定した Career Score＝bonus_q と spl_bonus_q_<四半期> の csFreeze、オフィス用 Career Score＝ocs_ev_）をそのまま写したもの。
--   元（app_state）は変えない・消さない。同じ中身は 2 回写さない（元のキー・部分・中身の sha-256 で 1 つ）。元が変わったら新しい行を足す（前の行は残す）。
--   期間：賞与の固定とオフィス用は、その記録の四半期（period_state = 'known'。2026-Q4 の記録は「Q4・旧制度」）。
--   lss_emp_ などの期間の無い記録は 'unknown'（保存日だけで四半期を決めない）。新しい Q4 の評価には使わない（評価済みにしない）。
-- ・csq4_runs：写した回ごとの記録（元の数・写した数・あった数・期間ごとの数）。
--
-- 2 回流しても同じ（行・記録は消さない）。戻すとき：先に関数 secure-state を前の 1 ファイル（deploy/am-office-v1207/）に戻してから
-- db/csq4-rollback.sql（関数だけ外す・表と記録は残す）。

do $$
begin
  if to_regclass('public.app_state') is null then raise exception 'STOP: public.app_state がありません（何も変えていません）'; end if;
  if to_regclass('public.employees') is null then raise exception 'STOP: public.employees がありません（何も変えていません）'; end if;
  if to_regclass('public.csq4_evals') is not null and not exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'csq4_evals' and column_name = 'entries' and data_type = 'jsonb') then
    raise exception 'STOP: public.csq4_evals がありますが形が違います（何も変えていません）';
  end if;
  if to_regclass('public.csq4_hist') is not null and not exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'csq4_hist' and column_name = 'src_hash' and data_type = 'text') then
    raise exception 'STOP: public.csq4_hist がありますが形が違います（何も変えていません）';
  end if;
  if to_regclass('public.csq4_assign') is not null and not exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'csq4_assign' and column_name = 'ver' and data_type = 'integer') then
    raise exception 'STOP: public.csq4_assign がありますが形が違います（何も変えていません）';
  end if;
end $$;

create table if not exists public.csq4_periods (
  period text primary key check (period ~ '^[0-9]{4}-Q[1-4]$'),
  starts date not null,
  ends date not null,
  version text not null check (char_length(version) between 1 and 64),
  created_at timestamptz not null default now(),
  check (ends > starts)
);
comment on table public.csq4_periods is 'Career Score Q4（段階 3-1）：評価の期間（ハワイの日付・ends は含まない）と制度版。docs/CAREER_SCORE_Q4_JA.md の 7';
insert into public.csq4_periods (period, starts, ends, version) values ('2026-Q4', '2026-10-01', '2027-01-01', 'CAREER_2026_Q4_V1')
  on conflict (period) do nothing;

create table if not exists public.csq4_assign (
  emp_id text not null check (char_length(emp_id) between 1 and 64),
  period text not null references public.csq4_periods(period),
  system text not null check (system in ('G', 'S_CHEF', 'S_OFFICE', 'PREP')),
  grade text,
  type text,
  ver integer not null default 1 check (ver >= 1),
  updated_at timestamptz not null default now(),
  by_emp text,
  by_name text,
  by_role text,
  primary key (emp_id, period),
  check ((system = 'PREP' and grade is null and type is null)
      or (system = 'G' and grade ~ '^G[1-6]$' and type is not null and char_length(type) between 1 and 40)
      or (system in ('S_CHEF', 'S_OFFICE') and grade ~ '^S[1-6]$' and type is null))
);
comment on table public.csq4_assign is 'Career Score Q4（段階 3-1）：人・期間ごとの評価表・Grade・型（GM・CEO が決める）。読み書きは関数 secure-state だけ';

create table if not exists public.csq4_evals (
  id bigserial primary key,
  emp_id text not null check (char_length(emp_id) between 1 and 64),
  emp_name text not null default '' check (char_length(emp_name) <= 120),
  period text not null references public.csq4_periods(period),
  system text not null check (system in ('G', 'S_CHEF', 'S_OFFICE', 'PREP')),
  grade text,
  type text,
  version text not null check (char_length(version) between 1 and 64),
  rev integer not null check (rev >= 1),
  status text not null check (status in ('draft', 'submitted', 'returned', 'published', 'superseded', 'cancelled')),
  entries jsonb not null default '{}'::jsonb check (jsonb_typeof(entries) = 'object'),
  prep jsonb check (prep is null or jsonb_typeof(prep) = 'object'),
  feedback jsonb not null default '{}'::jsonb check (jsonb_typeof(feedback) = 'object'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  shared jsonb check (shared is null or jsonb_typeof(shared) = 'object'),
  shared_at timestamptz,
  shared_by_name text,
  prev_id bigint references public.csq4_evals(id),
  change_reason text not null default '' check (char_length(change_reason) <= 1000),
  note text not null default '' check (char_length(note) <= 1000),
  ver integer not null default 1 check (ver >= 1),
  created_at timestamptz not null default now(),
  created_by_emp text, created_by_name text, created_by_role text,
  updated_at timestamptz not null default now(),
  updated_by_emp text, updated_by_name text, updated_by_role text,
  submitted_at timestamptz, submitted_by_emp text, submitted_by_name text,
  returned_at timestamptz, returned_by_name text,
  confirmed_at timestamptz, confirmed_by_emp text, confirmed_by_name text, confirmed_by_role text,
  closed_at timestamptz, closed_by_name text,
  superseded_by bigint,
  unique (emp_id, period, rev)
);
comment on table public.csq4_evals is 'Career Score Q4（段階 3-1）：評価（改訂ごとに 1 行・消さない）。読み書きは関数 secure-state だけ。docs/CAREER_SCORE_Q4_JA.md の 7';
create unique index if not exists csq4_evals_open on public.csq4_evals (emp_id, period) where status in ('draft', 'submitted', 'returned');
create unique index if not exists csq4_evals_pub on public.csq4_evals (emp_id, period) where status = 'published';
create index if not exists csq4_evals_period on public.csq4_evals (period, status);

create table if not exists public.csq4_reqs (
  id bigserial primary key,
  eval_id bigint not null references public.csq4_evals(id),
  emp_id text not null,
  period text not null,
  item_id text check (item_id is null or char_length(item_id) between 1 and 40),   -- S Office の項目 ID は 23 文字まで（OF-M-01／AC-M-01／HR-M-01）
  kind text not null check (kind in ('not_assigned', 'comment')),
  note text not null default '' check (char_length(note) <= 1000),
  status text not null default 'open' check (status in ('open', 'answered')),
  answer text not null default '' check (char_length(answer) <= 1000),
  created_at timestamptz not null default now(),
  created_by_emp text, created_by_name text,
  answered_at timestamptz, answered_by_emp text, answered_by_name text, answered_by_role text,
  check (kind <> 'not_assigned' or item_id is not null),
  check (status <> 'answered' or answer <> '')
);
comment on table public.csq4_reqs is 'Career Score Q4（段階 3-1）：本人の見直しの申し出・コメントと答え（消さない）';
create index if not exists csq4_reqs_emp on public.csq4_reqs (emp_id, period, status);
create unique index if not exists csq4_reqs_open on public.csq4_reqs (eval_id, item_id, kind) where status = 'open' and item_id is not null;

create table if not exists public.csq4_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  eval_id bigint,
  emp_id text not null,
  period text not null,
  action text not null check (char_length(action) between 1 and 40),
  by_emp text, by_name text, by_role text,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object')
);
comment on table public.csq4_log is 'Career Score Q4（段階 3-1）：評価の操作の記録（消さない）';
create index if not exists csq4_log_emp on public.csq4_log (emp_id, period, id desc);
create index if not exists csq4_log_eval on public.csq4_log (eval_id, id desc);

create table if not exists public.csq4_runs (
  id bigserial primary key,
  at timestamptz not null default now(),
  via text not null check (via in ('fn', 'sql')),
  by_emp text, by_name text,
  report jsonb not null default '{}'::jsonb
);
comment on table public.csq4_runs is 'Career Score Q4（段階 3-1）：今の記録を写した回ごとの記録';

create table if not exists public.csq4_hist (
  id bigserial primary key,
  src_key text not null check (char_length(src_key) between 1 and 300),
  src_part text not null default '' check (char_length(src_part) <= 200),
  src_hash text not null check (src_hash ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('lss_emp', 'lss_history', 'lss_requests', 'lss_legacy', 'bonus_csfreeze', 'ocs_ev')),
  emp_id text,
  emp_name text,
  period text check (period is null or period ~ '^[0-9]{4}-Q[1-4]$'),
  period_state text not null check (period_state in ('known', 'unknown')),
  data jsonb not null,
  src_updated_at timestamptz,
  run_id bigint references public.csq4_runs(id),
  copied_at timestamptz not null default now(),
  unique (src_key, src_part, src_hash),
  check ((period_state = 'known') = (period is not null))
);
comment on table public.csq4_hist is 'Career Score Q4（段階 3-1）：今までの Career Score の記録の写し（元は変えない・同じ中身は 1 つ・読むだけ）';
create index if not exists csq4_hist_emp on public.csq4_hist (emp_id, period);

do $$
declare t text;
begin
  foreach t in array array['csq4_periods', 'csq4_assign', 'csq4_evals', 'csq4_reqs', 'csq4_log', 'csq4_runs', 'csq4_hist'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);   -- サーバーの鍵にも下で要る分だけ（消す・空にするは無し）
  end loop;
  foreach t in array array['csq4_evals_id_seq', 'csq4_reqs_id_seq', 'csq4_log_id_seq', 'csq4_runs_id_seq', 'csq4_hist_id_seq'] loop
    execute format('revoke all on sequence public.%I from public, anon, authenticated', t);
    execute format('grant usage, select on sequence public.%I to service_role', t);
  end loop;
end $$;
grant select on table public.csq4_periods to service_role;
grant select, insert, update on table public.csq4_assign to service_role;
grant select, insert, update on table public.csq4_evals to service_role;
grant select, insert, update on table public.csq4_reqs to service_role;
grant select, insert on table public.csq4_log to service_role;
grant select, insert, update on table public.csq4_runs to service_role;   -- 写した回の記録（report）を写したあとに書く
grant select, insert on table public.csq4_hist to service_role;

-- アプリの包んだ形（{ __st: 1, v: 中身, …外側の欄 }）を開く（アプリの kbCfgPlain と同じ：外側の欄が中より先）。包んでいなければそのまま
create or replace function public.csq4_unwrap(p jsonb)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = public, pg_temp
as $$
declare r jsonb := p; top jsonb; i integer := 0;
begin
  while jsonb_typeof(r) = 'object' and r->'__st' = '1'::jsonb and i < 20 loop
    top := r - '__st' - 'v' - '_at' - '_by' - '_deleted';
    r := case when jsonb_typeof(r->'v') = 'object' then (r->'v') || top else top end;
    i := i + 1;
  end loop;
  return r;
end $$;

-- 開いている評価の申し出が残っているか（同じ人・同じ期間）
create or replace function public.csq4_open_reqs(p_emp text, p_period text)
returns integer
language sql
stable
security invoker
set search_path = public, pg_temp
as $$ select count(*)::integer from public.csq4_reqs where emp_id = p_emp and period = p_period and status = 'open' $$;

-- 評価表を決める。p_items：[{ emp, name, period, system, grade, type, expect }]（1〜200 人）。
-- 人ごとに、読んだときの版（expect・行が無ければ 0）と今の版が同じときだけ書く（1 人でも違えば何も書かずに conflict と違った人）。
-- 開いている評価（入力中・確認待ち・差戻し）がある人の評価表は変えない（open と人。取りやめてから）。中身が同じ人は書かない（same）。
create or replace function public.csq4_assign_save(p_items jsonb, p_by_emp text, p_by_name text, p_by_role text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  it jsonb; cur public.csq4_assign%rowtype; op public.csq4_evals%rowtype;
  t timestamptz := now();
  e text; pr text; sy text; gr text; ty text; ex integer; nv integer; had boolean;
  bad text[] := array[]::text[]; busy text[] := array[]::text[]; seen text[] := array[]::text[];
  done jsonb := '[]'::jsonb; nsame integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 200 then
    raise exception 'csq4_bad_items' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('funergy.csq4'));
  for it in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it) <> 'object' then raise exception 'csq4_bad_item' using errcode = '22023'; end if;
    e := it->>'emp'; pr := it->>'period'; sy := it->>'system'; gr := it->>'grade'; ty := it->>'type';
    if e is null or char_length(e) < 1 or char_length(e) > 64 or (e || '|' || coalesce(pr, '')) = any(seen) then raise exception 'csq4_bad_emp' using errcode = '22023'; end if;
    seen := seen || (e || '|' || coalesce(pr, ''));
    if pr is null or not exists (select 1 from public.csq4_periods where period = pr) then raise exception 'csq4_bad_period' using errcode = '22023'; end if;
    if sy is null or sy not in ('G', 'S_CHEF', 'S_OFFICE', 'PREP') then raise exception 'csq4_bad_system' using errcode = '22023'; end if;
    if jsonb_typeof(it->'expect') <> 'number' then raise exception 'csq4_bad_expect' using errcode = '22023'; end if;
    ex := (it->>'expect')::integer;
    if ex < 0 then raise exception 'csq4_bad_expect' using errcode = '22023'; end if;
    select * into cur from public.csq4_assign where emp_id = e and period = pr for update;
    had := found;
    if (had and cur.ver <> ex) or (not had and ex <> 0) then bad := bad || e; continue; end if;
    select * into op from public.csq4_evals where emp_id = e and period = pr and status in ('draft', 'submitted', 'returned');
    if found and (op.system is distinct from sy or op.grade is distinct from gr or op.type is distinct from ty) then busy := busy || e; end if;
  end loop;
  if array_length(bad, 1) is not null then return jsonb_build_object('ok', false, 'conflict', true, 'ids', to_jsonb(bad)); end if;
  if array_length(busy, 1) is not null then return jsonb_build_object('ok', false, 'open', true, 'ids', to_jsonb(busy)); end if;
  for it in select value from jsonb_array_elements(p_items) loop
    e := it->>'emp'; pr := it->>'period'; sy := it->>'system'; gr := it->>'grade'; ty := it->>'type';
    select * into cur from public.csq4_assign where emp_id = e and period = pr;
    had := found;
    if had and cur.system = sy and cur.grade is not distinct from gr and cur.type is not distinct from ty then
      nsame := nsame + 1;
      done := done || jsonb_build_object('emp', e, 'period', pr, 'ver', cur.ver, 'same', true);
      continue;
    end if;
    if had then
      nv := cur.ver + 1;
      update public.csq4_assign set system = sy, grade = gr, type = ty, ver = nv, updated_at = t, by_emp = p_by_emp, by_name = p_by_name, by_role = p_by_role
        where emp_id = e and period = pr;
    else
      nv := 1;
      insert into public.csq4_assign (emp_id, period, system, grade, type, ver, updated_at, by_emp, by_name, by_role)
        values (e, pr, sy, gr, ty, 1, t, p_by_emp, p_by_name, p_by_role);
    end if;
    insert into public.csq4_log (at, eval_id, emp_id, period, action, by_emp, by_name, by_role, detail)
      values (t, null, e, pr, 'assign', p_by_emp, p_by_name, p_by_role, jsonb_build_object('name', left(coalesce(it->>'name', ''), 120),
        'before', case when had then jsonb_build_object('system', cur.system, 'grade', cur.grade, 'type', cur.type) else null end,
        'after', jsonb_build_object('system', sy, 'grade', gr, 'type', ty), 'ver', nv));
    done := done || jsonb_build_object('emp', e, 'period', pr, 'ver', nv);
  end loop;
  return jsonb_build_object('ok', true, 'rows', done, 'same', nsame, 'at', t);
end $$;

-- 評価を始める・再開する。p_assign_ver＝関数が読んだ評価表の版（違えば assign_changed）。
-- 開いている評価があればそれを返す（resumed・何も変えない＝何度押しても初期化しない）。確定・公開済みがあれば published（再評価で）。
-- ほかは新しい改訂（rev＝その人・期間の最大＋1）を入力中で作る。明細は空（全項目が未評価）。p_result は関数が空の明細で計算したもの。
create or replace function public.csq4_eval_start(p_emp text, p_name text, p_period text, p_assign_ver integer, p_result jsonb,
  p_by_emp text, p_by_name text, p_by_role text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  a public.csq4_assign%rowtype; op public.csq4_evals%rowtype; pv public.csq4_periods%rowtype;
  t timestamptz := now(); nr integer; nid bigint;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object' then raise exception 'csq4_bad_result' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('funergy.csq4'));
  select * into pv from public.csq4_periods where period = p_period;
  if not found then raise exception 'csq4_bad_period' using errcode = '22023'; end if;
  select * into a from public.csq4_assign where emp_id = p_emp and period = p_period;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_assign'); end if;
  if a.ver <> p_assign_ver then return jsonb_build_object('ok', false, 'conflict', true, 'error', 'assign_changed'); end if;
  select * into op from public.csq4_evals where emp_id = p_emp and period = p_period and status in ('draft', 'submitted', 'returned');
  if found then return jsonb_build_object('ok', true, 'resumed', true, 'id', op.id, 'rev', op.rev, 'ver', op.ver, 'status', op.status); end if;
  select * into op from public.csq4_evals where emp_id = p_emp and period = p_period and status = 'published';
  if found then return jsonb_build_object('ok', false, 'error', 'published', 'id', op.id); end if;
  select coalesce(max(rev), 0) + 1 into nr from public.csq4_evals where emp_id = p_emp and period = p_period;
  insert into public.csq4_evals (emp_id, emp_name, period, system, grade, type, version, rev, status, entries, prep, result,
      created_at, created_by_emp, created_by_name, created_by_role, updated_at, updated_by_emp, updated_by_name, updated_by_role)
    values (p_emp, left(coalesce(p_name, ''), 120), p_period, a.system, a.grade, a.type, pv.version, nr, 'draft', '{}'::jsonb,
      case when a.system = 'PREP' then '{}'::jsonb else null end, p_result, t, p_by_emp, p_by_name, p_by_role, t, p_by_emp, p_by_name, p_by_role)
    returning id into nid;
  insert into public.csq4_log (at, eval_id, emp_id, period, action, by_emp, by_name, by_role, detail)
    values (t, nid, p_emp, p_period, 'start', p_by_emp, p_by_name, p_by_role,
      jsonb_build_object('rev', nr, 'system', a.system, 'grade', a.grade, 'type', a.type, 'version', pv.version));
  return jsonb_build_object('ok', true, 'id', nid, 'rev', nr, 'ver', 1, 'status', 'draft');
end $$;

-- 確定・公開のあとの再評価（新しい改訂）。p_pub_id＝関数が読んだ確定・公開の評価（違えば conflict）。理由が要る。
-- 同じ評価表（system が同じ）なら確定・公開の明細と Prep の記録・本人への説明を写して始める（元の行は変えない＝確定するまで本人の正式な結果は元のまま）。
-- 評価表が変わっていれば明細は空から。p_copy は関数が計算に使った写し方（SQL の決め方と違えば止める）。
create or replace function public.csq4_eval_reeval(p_emp text, p_name text, p_period text, p_pub_id bigint, p_assign_ver integer,
  p_copy boolean, p_reason text, p_result jsonb, p_by_emp text, p_by_name text, p_by_role text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  a public.csq4_assign%rowtype; pub public.csq4_evals%rowtype; pv public.csq4_periods%rowtype;
  t timestamptz := now(); nr integer; nid bigint; cp boolean;
begin
  if p_reason is null or btrim(p_reason) = '' or char_length(p_reason) > 1000 then raise exception 'csq4_bad_reason' using errcode = '22023'; end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' then raise exception 'csq4_bad_result' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('funergy.csq4'));
  select * into pv from public.csq4_periods where period = p_period;
  if not found then raise exception 'csq4_bad_period' using errcode = '22023'; end if;
  if exists (select 1 from public.csq4_evals where emp_id = p_emp and period = p_period and status in ('draft', 'submitted', 'returned')) then
    return jsonb_build_object('ok', false, 'error', 'open');
  end if;
  select * into pub from public.csq4_evals where emp_id = p_emp and period = p_period and status = 'published';
  if not found or pub.id <> p_pub_id then return jsonb_build_object('ok', false, 'conflict', true, 'error', 'published_changed'); end if;
  select * into a from public.csq4_assign where emp_id = p_emp and period = p_period;
  if not found or a.ver <> p_assign_ver then return jsonb_build_object('ok', false, 'conflict', true, 'error', 'assign_changed'); end if;
  cp := a.system = pub.system;
  if cp is distinct from p_copy then return jsonb_build_object('ok', false, 'conflict', true, 'error', 'assign_changed'); end if;
  select coalesce(max(rev), 0) + 1 into nr from public.csq4_evals where emp_id = p_emp and period = p_period;
  insert into public.csq4_evals (emp_id, emp_name, period, system, grade, type, version, rev, status, entries, prep, feedback, result, prev_id, change_reason,
      created_at, created_by_emp, created_by_name, created_by_role, updated_at, updated_by_emp, updated_by_name, updated_by_role)
    values (p_emp, left(coalesce(p_name, ''), 120), p_period, a.system, a.grade, a.type, pv.version, nr, 'draft',
      case when cp then pub.entries else '{}'::jsonb end,
      case when cp then pub.prep when a.system = 'PREP' then '{}'::jsonb else null end,
      case when cp then pub.feedback else '{}'::jsonb end,
      p_result, pub.id, btrim(p_reason), t, p_by_emp, p_by_name, p_by_role, t, p_by_emp, p_by_name, p_by_role)
    returning id into nid;
  insert into public.csq4_log (at, eval_id, emp_id, period, action, by_emp, by_name, by_role, detail)
    values (t, nid, p_emp, p_period, 'reeval', p_by_emp, p_by_name, p_by_role,
      jsonb_build_object('rev', nr, 'prev_id', pub.id, 'prev_rev', pub.rev, 'copied', cp, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'id', nid, 'rev', nr, 'ver', 1, 'status', 'draft', 'copied', cp);
end $$;

-- 下書きを保存する（入力中・差戻しだけ）。p_expect＝読んだときの行の版（違えば conflict）。
-- 明細・Prep の記録・本人への説明・結果は関数 secure-state が確かめ・計算して渡す。p_changes＝変わった項目の前と後（記録に残す）。
create or replace function public.csq4_eval_save(p_id bigint, p_expect integer, p_entries jsonb, p_prep jsonb, p_feedback jsonb, p_result jsonb,
  p_changes jsonb, p_by_emp text, p_by_name text, p_by_role text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare r public.csq4_evals%rowtype; t timestamptz := now();
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'object' or p_result is null or jsonb_typeof(p_result) <> 'object'
     or p_feedback is null or jsonb_typeof(p_feedback) <> 'object' or (p_prep is not null and jsonb_typeof(p_prep) <> 'object')
     or p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'csq4_bad_value' using errcode = '22023';
  end if;
  select * into r from public.csq4_evals where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if r.ver <> p_expect then return jsonb_build_object('ok', false, 'conflict', true, 'ver', r.ver, 'status', r.status); end if;
  if r.status not in ('draft', 'returned') then return jsonb_build_object('ok', false, 'error', 'state', 'status', r.status); end if;
  if (r.system = 'PREP') <> (p_prep is not null) then raise exception 'csq4_bad_value' using errcode = '22023'; end if;
  update public.csq4_evals set entries = p_entries, prep = p_prep, feedback = p_feedback, result = p_result, ver = r.ver + 1, updated_at = t,
      updated_by_emp = p_by_emp, updated_by_name = p_by_name, updated_by_role = p_by_role
    where id = p_id;
  if p_changes <> '{}'::jsonb then
    insert into public.csq4_log (at, eval_id, emp_id, period, action, by_emp, by_name, by_role, detail)
      values (t, p_id, r.emp_id, r.period, 'save', p_by_emp, p_by_name, p_by_role, jsonb_build_object('rev', r.rev, 'changes', p_changes));
  end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'ver', r.ver + 1, 'at', t);
end $$;

-- 状態を進める。p_act：
--   share（本人に説明を共有：入力中・差戻し。p_shared は関数が作った本人向けの内容）
--   submit（確認待ちへ：入力中・差戻し。p_ok＝関数が今の明細で計算して確定できる。本人の申し出が残っていれば止める）
--   return（差戻し：確認待ち。理由が要る）
--   confirm（確定・本人に公開：確認待ち。p_ok と申し出が残っていないこと。p_shared＝本人に見せる確定の内容。前の確定・公開は superseded にして残す）
--   cancel（取りやめ：開いている評価。理由が要る・行は残す）
create or replace function public.csq4_eval_act(p_id bigint, p_expect integer, p_act text, p_note text, p_shared jsonb, p_ok boolean,
  p_by_emp text, p_by_name text, p_by_role text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare r public.csq4_evals%rowtype; old public.csq4_evals%rowtype; t timestamptz := now(); nt text := btrim(coalesce(p_note, ''));
begin
  if p_act is null or p_act not in ('share', 'submit', 'return', 'confirm', 'cancel') then raise exception 'csq4_bad_act' using errcode = '22023'; end if;
  if char_length(nt) > 1000 then raise exception 'csq4_bad_note' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('funergy.csq4'));
  select * into r from public.csq4_evals where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if r.ver <> p_expect then return jsonb_build_object('ok', false, 'conflict', true, 'ver', r.ver, 'status', r.status); end if;
  if p_act = 'share' then
    if r.status not in ('draft', 'returned') then return jsonb_build_object('ok', false, 'error', 'state', 'status', r.status); end if;
    if p_shared is null or jsonb_typeof(p_shared) <> 'object' then raise exception 'csq4_bad_shared' using errcode = '22023'; end if;
    update public.csq4_evals set shared = p_shared, shared_at = t, shared_by_name = p_by_name, ver = r.ver + 1, updated_at = t,
        updated_by_emp = p_by_emp, updated_by_name = p_by_name, updated_by_role = p_by_role where id = p_id;
  elsif p_act = 'submit' then
    if r.status not in ('draft', 'returned') then return jsonb_build_object('ok', false, 'error', 'state', 'status', r.status); end if;
    if p_ok is not true then return jsonb_build_object('ok', false, 'error', 'not_complete'); end if;
    if public.csq4_open_reqs(r.emp_id, r.period) > 0 then return jsonb_build_object('ok', false, 'error', 'open_requests'); end if;
    update public.csq4_evals set status = 'submitted', submitted_at = t, submitted_by_emp = p_by_emp, submitted_by_name = p_by_name, ver = r.ver + 1,
        updated_at = t, updated_by_emp = p_by_emp, updated_by_name = p_by_name, updated_by_role = p_by_role where id = p_id;
  elsif p_act = 'return' then
    if r.status <> 'submitted' then return jsonb_build_object('ok', false, 'error', 'state', 'status', r.status); end if;
    if nt = '' then raise exception 'csq4_bad_note' using errcode = '22023'; end if;
    update public.csq4_evals set status = 'returned', returned_at = t, returned_by_name = p_by_name, note = nt, ver = r.ver + 1,
        updated_at = t, updated_by_emp = p_by_emp, updated_by_name = p_by_name, updated_by_role = p_by_role where id = p_id;
  elsif p_act = 'confirm' then
    if r.status <> 'submitted' then return jsonb_build_object('ok', false, 'error', 'state', 'status', r.status); end if;
    if p_ok is not true then return jsonb_build_object('ok', false, 'error', 'not_complete'); end if;
    if public.csq4_open_reqs(r.emp_id, r.period) > 0 then return jsonb_build_object('ok', false, 'error', 'open_requests'); end if;
    select * into old from public.csq4_evals where emp_id = r.emp_id and period = r.period and status = 'published' for update;
    if found then
      update public.csq4_evals set status = 'superseded', closed_at = t, closed_by_name = p_by_name, superseded_by = p_id where id = old.id;
    end if;
    if p_shared is null or jsonb_typeof(p_shared) <> 'object' then raise exception 'csq4_bad_shared' using errcode = '22023'; end if;
    update public.csq4_evals set status = 'published', confirmed_at = t, confirmed_by_emp = p_by_emp, confirmed_by_name = p_by_name,
        confirmed_by_role = p_by_role, shared = p_shared, shared_at = t, shared_by_name = p_by_name, ver = r.ver + 1, updated_at = t where id = p_id;
  else
    if r.status not in ('draft', 'submitted', 'returned') then return jsonb_build_object('ok', false, 'error', 'state', 'status', r.status); end if;
    if nt = '' then raise exception 'csq4_bad_note' using errcode = '22023'; end if;
    update public.csq4_evals set status = 'cancelled', closed_at = t, closed_by_name = p_by_name, note = nt, ver = r.ver + 1,
        updated_at = t, updated_by_emp = p_by_emp, updated_by_name = p_by_name, updated_by_role = p_by_role where id = p_id;
  end if;
  insert into public.csq4_log (at, eval_id, emp_id, period, action, by_emp, by_name, by_role, detail)
    values (t, p_id, r.emp_id, r.period, p_act, p_by_emp, p_by_name, p_by_role,
      jsonb_build_object('rev', r.rev, 'from', r.status, 'note', nt) || case when p_act = 'confirm' and old.id is not null then jsonb_build_object('superseded', old.id) else '{}'::jsonb end);
  return jsonb_build_object('ok', true, 'id', p_id, 'ver', r.ver + 1, 'at', t);
end $$;

-- 本人の見直しの申し出・コメント（関数が本人の評価か確かめてから渡す）。共有した開いている評価か、確定・公開済みの評価だけ。
-- 同じ項目・同じ種類の開いている申し出は 1 つ（同じなら same）。1 つの評価に開いている申し出は 200 まで。
create or replace function public.csq4_req_add(p_eval_id bigint, p_item text, p_kind text, p_note text, p_by_emp text, p_by_name text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare r public.csq4_evals%rowtype; x public.csq4_reqs%rowtype; t timestamptz := now(); nid bigint; nt text := btrim(coalesce(p_note, ''));
begin
  if p_kind is null or p_kind not in ('not_assigned', 'comment') then raise exception 'csq4_bad_kind' using errcode = '22023'; end if;
  if char_length(nt) > 1000 or (p_kind = 'comment' and nt = '') then raise exception 'csq4_bad_note' using errcode = '22023'; end if;
  if p_kind = 'not_assigned' and (p_item is null or p_item = '') then raise exception 'csq4_bad_item' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('funergy.csq4'));
  select * into r from public.csq4_evals where id = p_eval_id for update;
  if not found or r.emp_id is distinct from p_by_emp then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not (r.status = 'published' or (r.status in ('draft', 'submitted', 'returned') and r.shared_at is not null)) then
    return jsonb_build_object('ok', false, 'error', 'state', 'status', r.status);
  end if;
  if p_item is not null then
    select * into x from public.csq4_reqs where eval_id = p_eval_id and item_id = p_item and kind = p_kind and status = 'open';
    if found then return jsonb_build_object('ok', true, 'id', x.id, 'same', true); end if;
  end if;
  if (select count(*) from public.csq4_reqs where eval_id = p_eval_id and status = 'open') >= 200 then
    return jsonb_build_object('ok', false, 'error', 'too_many');
  end if;
  insert into public.csq4_reqs (eval_id, emp_id, period, item_id, kind, note, created_at, created_by_emp, created_by_name)
    values (p_eval_id, r.emp_id, r.period, nullif(p_item, ''), p_kind, nt, t, p_by_emp, p_by_name) returning id into nid;
  insert into public.csq4_log (at, eval_id, emp_id, period, action, by_emp, by_name, by_role, detail)
    values (t, p_eval_id, r.emp_id, r.period, 'request', p_by_emp, p_by_name, null, jsonb_build_object('req', nid, 'item', p_item, 'kind', p_kind, 'note', nt));
  return jsonb_build_object('ok', true, 'id', nid, 'at', t);
end $$;

-- 申し出に答える（関数が答えてよい人か確かめてから渡す）。開いている申し出だけ。
create or replace function public.csq4_req_answer(p_id bigint, p_answer text, p_by_emp text, p_by_name text, p_by_role text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare x public.csq4_reqs%rowtype; t timestamptz := now(); an text := btrim(coalesce(p_answer, ''));
begin
  if an = '' or char_length(an) > 1000 then raise exception 'csq4_bad_answer' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('funergy.csq4'));
  select * into x from public.csq4_reqs where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if x.status <> 'open' then return jsonb_build_object('ok', false, 'error', 'state'); end if;
  update public.csq4_reqs set status = 'answered', answer = an, answered_at = t, answered_by_emp = p_by_emp, answered_by_name = p_by_name,
      answered_by_role = p_by_role where id = p_id;
  insert into public.csq4_log (at, eval_id, emp_id, period, action, by_emp, by_name, by_role, detail)
    values (t, x.eval_id, x.emp_id, x.period, 'answer', p_by_emp, p_by_name, p_by_role, jsonb_build_object('req', p_id, 'answer', an));
  return jsonb_build_object('ok', true, 'id', p_id, 'at', t);
end $$;

-- 写す元（app_state を読むだけ）。1 行＝写す単位：
--   lss_emp_<名前>（今の点）・spl_lss_history_<名前>（変更の履歴）・spl_lss_requests_<名前>（申請）→ 期間未確認（unknown）
--   lss_scores・lss_requests・lss_history（前の統合行）→ 期間未確認・人は決めない
--   bonus_q（前の統合行）と spl_bonus_q_<四半期> の csFreeze の人ごと → その四半期（known）
--   ocs_ev_<社員 ID> の evals の四半期ごと → その四半期（known）
-- 名前の記録は、社員の表でその名前の人が 1 人だけのとき社員 ID を付ける（退職の人も数える＝同じ名前がほかにあれば決めない＝本人には出さない）。
-- 包んだ形（__st）は開いてから中を見る（csq4_unwrap）。写す中身（data）は元のその部分のまま
create or replace function public.csq4_hist_source()
returns table (src_key text, src_part text, kind text, emp_id text, emp_name text, period text, period_state text, data jsonb, src_updated_at timestamptz, src_hash text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with raw as (
    select s.key as k, '' as part, 'lss_emp' as kind, substr(s.key, 9) as nm, null::text as emp, null::text as per, s.value as d, s.updated_at as at
      from public.app_state s where left(s.key, 8) = 'lss_emp_' and char_length(s.key) > 8 and s.value is not null
    union all
    select s.key, '', 'lss_history', substr(s.key, 17), null, null, s.value, s.updated_at
      from public.app_state s where left(s.key, 16) = 'spl_lss_history_' and char_length(s.key) > 16 and s.value is not null
    union all
    select s.key, '', 'lss_requests', substr(s.key, 18), null, null, s.value, s.updated_at
      from public.app_state s where left(s.key, 17) = 'spl_lss_requests_' and char_length(s.key) > 17 and s.value is not null
    union all
    select s.key, '', 'lss_legacy', null, null, null, s.value, s.updated_at
      from public.app_state s where s.key in ('lss_scores', 'lss_requests', 'lss_history') and s.value is not null
    union all
    select s.key, q.key || '|' || f.key, 'bonus_csfreeze', null, f.key, q.key, f.value, s.updated_at
      from public.app_state s
      cross join lateral jsonb_each(case when jsonb_typeof(public.csq4_unwrap(s.value)) = 'object' then public.csq4_unwrap(s.value) else '{}'::jsonb end) q
      cross join lateral jsonb_each(case when jsonb_typeof(public.csq4_unwrap(q.value)->'csFreeze') = 'object' then public.csq4_unwrap(q.value)->'csFreeze' else '{}'::jsonb end) f
      where s.key = 'bonus_q' and q.key ~ '^[0-9]{4}-Q[1-4]$' and char_length(f.key) between 1 and 64
    union all
    select s.key, substr(s.key, 13) || '|' || f.key, 'bonus_csfreeze', null, f.key, substr(s.key, 13), f.value, s.updated_at
      from public.app_state s
      cross join lateral jsonb_each(case when jsonb_typeof(public.csq4_unwrap(s.value)->'csFreeze') = 'object' then public.csq4_unwrap(s.value)->'csFreeze' else '{}'::jsonb end) f
      where left(s.key, 12) = 'spl_bonus_q_' and substr(s.key, 13) ~ '^[0-9]{4}-Q[1-4]$' and char_length(f.key) between 1 and 64
    union all
    select s.key, q.key, 'ocs_ev', null, coalesce(nullif(public.csq4_unwrap(s.value)->>'empId', ''), substr(s.key, 8)), q.key, q.value, s.updated_at
      from public.app_state s
      cross join lateral jsonb_each(case when jsonb_typeof(public.csq4_unwrap(s.value)->'evals') = 'object' then public.csq4_unwrap(s.value)->'evals' else '{}'::jsonb end) q
      where left(s.key, 7) = 'ocs_ev_' and char_length(s.key) > 7 and q.key ~ '^[0-9]{4}-Q[1-4]$'
  ), uniq as (
    select e.name, min(e.id::text) as id from public.employees e where e.name is not null group by e.name having count(*) = 1
  )
  select r.k, r.part, r.kind,
    coalesce(r.emp, u.id) as emp_id,
    left(coalesce(r.nm, (select e.name from public.employees e where e.id::text = r.emp limit 1)), 120) as emp_name,
    r.per, case when r.per is null then 'unknown' else 'known' end, r.d, r.at,
    encode(sha256(convert_to(r.d::text, 'UTF8')), 'hex')
  from raw r left join uniq u on r.emp is null and r.nm is not null and u.name = r.nm
$$;

-- 今までの Career Score の記録を csq4_hist に写す（元は変えない・何度流しても同じ）。p_via：'fn'（関数・GM・CEO）か 'sql'（SQL Editor）。
-- 元が変わっていれば新しい行を足す（前の行は残す）。戻り値：種類ごとの元の数（src）・写したあとにある数（present）・今回足した数（added）、
-- 期間ごとの数、期間未確認の数（unknown）、人を決めない数（no_emp）、写していない元（missing＝0 のはず）
create or replace function public.csq4_hist_copy(p_via text, p_by_emp text, p_by_name text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare rid bigint; t timestamptz := now(); rep jsonb; n_added integer;
begin
  if p_via is null or p_via not in ('fn', 'sql') then raise exception 'csq4_bad_via' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('funergy.csq4_hist'));
  insert into public.csq4_runs (at, via, by_emp, by_name) values (t, p_via, p_by_emp, p_by_name) returning id into rid;
  insert into public.csq4_hist (src_key, src_part, src_hash, kind, emp_id, emp_name, period, period_state, data, src_updated_at, run_id, copied_at)
    select c.src_key, c.src_part, c.src_hash, c.kind, c.emp_id, c.emp_name, c.period, c.period_state, c.data, c.src_updated_at, rid, t
      from public.csq4_hist_source() c
    on conflict (src_key, src_part, src_hash) do nothing;
  get diagnostics n_added = row_count;
  with c as (select * from public.csq4_hist_source())
  select jsonb_build_object(
      'run', rid, 'at', t, 'added', n_added,
      'kinds', coalesce((select jsonb_object_agg(k.kind, jsonb_build_object('src', k.src, 'present', k.present)) from (
          select c.kind, count(*) as src,
            count(*) filter (where exists (select 1 from public.csq4_hist h where h.src_key = c.src_key and h.src_part = c.src_part and h.src_hash = c.src_hash)) as present
          from c group by c.kind) k), '{}'::jsonb),
      'periods', coalesce((select jsonb_object_agg(p.period, p.n) from (select c.period, count(*) as n from c where c.period is not null group by c.period) p), '{}'::jsonb),
      'unknown', (select count(*) from c where c.period_state = 'unknown'),
      'no_emp', (select count(*) from c where c.emp_id is null),
      'missing', (select count(*) from c where not exists (select 1 from public.csq4_hist h
          where h.src_key = c.src_key and h.src_part = c.src_part and h.src_hash = c.src_hash)),
      'hist_rows', (select count(*) from public.csq4_hist))
    into rep;
  update public.csq4_runs set report = rep where id = rid;
  return rep;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'csq4_unwrap(jsonb)',
    'csq4_open_reqs(text, text)',
    'csq4_assign_save(jsonb, text, text, text)',
    'csq4_eval_start(text, text, text, integer, jsonb, text, text, text)',
    'csq4_eval_reeval(text, text, text, bigint, integer, boolean, text, jsonb, text, text, text)',
    'csq4_eval_save(bigint, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text)',
    'csq4_eval_act(bigint, integer, text, text, jsonb, boolean, text, text, text)',
    'csq4_req_add(bigint, text, text, text, text, text)',
    'csq4_req_answer(bigint, text, text, text, text)',
    'csq4_hist_source()',
    'csq4_hist_copy(text, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
comment on function public.csq4_hist_copy(text, text, text) is 'Career Score Q4（段階 3-1）：今までの Career Score の記録を csq4_hist に写す（元は変えない・何度流しても同じ）。サーバーの鍵だけ';
