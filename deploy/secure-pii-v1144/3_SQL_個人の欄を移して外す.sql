-- v1144（段階 2b の 6 つ目）：従業員の表の個人の欄を、公開の鍵（anon・authenticated）で読めないようにする。
-- 仕様：docs/SECURE_PII_V1144_JA.md。入れる順番：deploy/secure-pii-v1144/手順.md（関数 secure-state を v1144 に → アプリ v1144 →
-- 全部の端末を 1144 に → この SQL）。
--
-- ・対象の欄（従業員の表 employees の data の中）：生年月日（dob）・会社カードの下 4 桁（cardLast4）・医療保険／歯科保険の加入（insurance・dental）・
--   会社負担の保険料（月額・insuranceAmt）。
-- ・従業員の表に残っているこの 5 つを、app_state の 1 行 emp_pii（社員 ID → 欄）に写す。emp_pii にもうある人（v1144 の関数で直した人）は
--   写さない（そちらが新しい）。写したあと、従業員の表から 5 つを消す。ほかの欄・列・状態の版（_stV）は変えない。
--   写すあいだは従業員の表への書き込みを待たせる（読むのは止めない。写す人と消す人を同じにする＝写していない値を消さない）。
--   待たせた書き込み（前の版の端末）の 5 つの欄は、このあと見張りが外す（入らない。全部の端末を 1144 にしてから流す）。
-- ・これからも従業員の表に 5 つが入らないように、書くたびに外す見張り（employees_pii_strip_trg）を付ける（前の版の端末が書いても入らない）。
-- ・emp_pii は公開の鍵で読めない・書けない（ss_secret_key に足す。v1139〜v1142 と同じ restrictive の決まり ss_secret）。
--   v1139〜v1142 の SQL がまだでも、この SQL だけで同じになる（RLS が OFF なら ON にして今までの決まり ss_open を足す）。
--   サーバーの鍵（service_role）・postgres は RLS を通らない（今までどおり）。v1141・v1143 の決まり（ss_guard_*）はそのまま。
-- ・2 回流しても同じ（2 回目は写すもの・消すものが無い）。戻すとき：db/secure-pii-rollback.sql（emp_pii の値を従業員の表に戻す）。

create or replace function public.ss_secret_key(k text) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select coalesce(k in ('growth_karte', 'karte_pin', 'karte_bonus_config', 'bonus_q', 'bonus_eval', 'bonus_store_q', 'bonus_rules', 'bonus_pool_extra')
      or k ~ '^spl_bonus_q_[0-9A-Za-z_-]{1,40}$'                         -- spl_bonus_q_<四半期>（v1139）
      or k in ('lss_scores', 'lss_requests', 'lss_history')                -- v1140：Career Score の前の統合行
      or (length(k) > 8 and left(k, 8) = 'lss_emp_')                      -- v1140：点（人ごと）
      or (length(k) > 17 and left(k, 17) = 'spl_lss_requests_')           -- v1140：申請（人ごと）
      or (length(k) > 16 and left(k, 16) = 'spl_lss_history_')            -- v1140：履歴（人ごと）
      or k in ('applicants', 'reject_log', 'growthhub')                   -- v1142：採用（応募者・不採用ログ）・お悩み相談室
      or k = 'emp_pii', false)                                            -- v1144：従業員の個人の欄
$$;
comment on function public.ss_secret_key(text) is
  'v1144: app_state の成長カルテ・賞与・Career Score・採用・お悩み相談室・従業員の個人の欄のキーか（公開の鍵から外すキー）。関数 secure-state の ssIsKey・csIsKey・hrIsKey・piiIsKey と同じ決まり。';
revoke all on function public.ss_secret_key(text) from public;
grant execute on function public.ss_secret_key(text) to anon, authenticated, service_role;   -- 決まり（RLS）を読むときに要る

do $$
declare rls boolean;
begin
  if to_regclass('public.app_state') is null then raise exception 'STOP: public.app_state がありません（何も変えていません）'; end if;
  select c.relrowsecurity into rls from pg_class c where c.oid = 'public.app_state'::regclass;
  if not rls then
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_state' and policyname not in ('ss_open', 'ss_secret')) then
      raise exception 'STOP: app_state の RLS が OFF で、効いていない決まり（policy）があります。ON にするとそれが効き始めるので、確かめてから（何も変えていません）';
    end if;
    alter table public.app_state enable row level security;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_state' and policyname = 'ss_open') then
      create policy ss_open on public.app_state as permissive for all to anon, authenticated using (true) with check (true);
      comment on policy ss_open on public.app_state is 'v1139: RLS was off before 20261108090000 (rollback turns it off again)';
    end if;
  end if;
  drop policy if exists ss_secret on public.app_state;
  create policy ss_secret on public.app_state as restrictive for all to anon, authenticated
    using (not public.ss_secret_key(key::text)) with check (not public.ss_secret_key(key::text));
  comment on policy ss_secret on public.app_state is 'v1139/v1140/v1142/v1144: growth karte / bonus / Career Score / hiring / consultation / employee personal keys go through the secure-state function only';
end $$;

-- 書くたびに 5 つの欄を外す見張り（その書き込みの data だけを直す。ほかの欄・列はそのまま）
create or replace function public.employees_pii_strip() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if NEW.data is not null and jsonb_typeof(NEW.data) = 'object' and NEW.data ?| array['dob', 'cardLast4', 'insurance', 'dental', 'insuranceAmt'] then
    NEW.data := NEW.data - array['dob', 'cardLast4', 'insurance', 'dental', 'insuranceAmt'];
  end if;
  return NEW;
end $$;
comment on function public.employees_pii_strip() is 'v1144: 従業員の表（公開の鍵で読める）に、生年月日・カードの下 4 桁・保険の加入・保険料を入れない（app_state の emp_pii に置く）';
revoke all on function public.employees_pii_strip() from public, anon, authenticated;

do $$
declare f text[] := array['dob', 'cardLast4', 'insurance', 'dental', 'insuranceAmt'];
        cur jsonb; add jsonb; n_copy int; n_strip int;
begin
  if to_regclass('public.employees') is null then raise exception 'STOP: public.employees がありません（何も変えていません）'; end if;
  -- 写して消すあいだ、従業員の表への書き込みを待たせる（読むのは止めない。写していない値を消さない。待たせた書き込みの 5 つの欄は見張りが外す）
  lock table public.employees in share row exclusive mode;
  select s.value::jsonb into cur from public.app_state s where s.key::text = 'emp_pii' for update;
  if cur is not null and jsonb_typeof(cur) <> 'object' then
    raise exception 'STOP: app_state の emp_pii がオブジェクトではありません（何も変えていません。Claude に知らせてください）';
  end if;
  cur := coalesce(cur, '{}'::jsonb);
  -- 写す：従業員の表にこの欄があり、emp_pii にまだ無い人だけ（emp_pii にある人は v1144 の関数で直した＝そちらが新しい）
  select coalesce(jsonb_object_agg(e.id::text, sub.v || jsonb_build_object('_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '_by', 'SQL 20261113090000')), '{}'::jsonb),
         count(*)
    into add, n_copy
    from public.employees e
    cross join lateral (select jsonb_object_agg(k, e.data -> k) as v from unnest(f) k where e.data ? k) sub
   where e.data is not null and jsonb_typeof(e.data) = 'object' and e.data ?| f and sub.v is not null and not (cur ? e.id::text);
  if add <> '{}'::jsonb then
    -- 同じときに関数が行を作っていたら、関数の値（新しい）を残す
    insert into public.app_state(key, value, updated_at) values ('emp_pii', add, now())
    on conflict (key) do update set value = excluded.value || public.app_state.value, updated_at = now();
  end if;
  -- 消す：従業員の表から 5 つの欄だけ
  update public.employees set data = data - f where data is not null and jsonb_typeof(data) = 'object' and data ?| f;
  get diagnostics n_strip = row_count;
  drop trigger if exists employees_pii_strip_trg on public.employees;
  create trigger employees_pii_strip_trg before insert or update on public.employees
    for each row execute function public.employees_pii_strip();
  raise notice 'v1144: emp_pii に % 人を写し、従業員の表の % 行から個人の欄を消しました', n_copy, n_strip;
end $$;

notify pgrst, 'reload schema';
