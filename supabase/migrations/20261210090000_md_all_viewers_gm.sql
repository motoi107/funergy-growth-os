-- v1192（Codex 6986713362 の P2-1）：ダッシュボードで全店を見る AM を、GM・CEO だけが書ける写し（app_state の md_all_viewers_gm）にする。
-- 仕様：docs/LABOR_TOTALS_V1192_JA.md。入れる順番：deploy/labor-totals-v1192/手順.md（この SQL → 関数 secure-state → マージ → 全部の端末を 1192 に → emp-private）。
--
-- ・前：関数 secure-state の人件費の合計（labor）は、app_settings の md_all_viewers で ON の AM に全店の合計を返した。md_all_viewers は
--   公開の鍵で書けるので、AM が自分の行を書き足すと、担当外の店の人件費の合計まで受け取れた（app_state の決まり ss_guard_* は app_settings に効かない）。
-- ・いま：関数は app_state の md_all_viewers_gm だけを見る。このキーを ss_guard_key に足し、公開の鍵（anon・authenticated）では書けないようにする
--   （読むのは今までどおり。書くのは関数 secure-state だけで、関数が GM・CEO だけに書かせる）。アプリ 1192 は GM・CEO が「管轄の割り当て」で
--   付け外しすると、この写しと md_all_viewers の両方に書く（前の版の端末は md_all_viewers だけを読む）。
-- ・写しがまだ無ければ、今の md_all_viewers をそのまま 1 回だけ写す（だれが ON かは、先に db/md-all-viewers-gm-precheck.sql で確かめる。
--   もう写しがあれば何もしない）。md_all_viewers は消さない・変えない。
-- ・ss_guard_key の中身は v1146 の SQL（20261115090000）と同じで、md_all_viewers_gm が増えただけ。v1146 の SQL が無ければ何も変えずに止まる。
-- ・2 回流しても同じ。戻すとき：db/md-all-viewers-gm-rollback.sql（写しをまた公開の鍵で書けるようにする。写しの行は残す）。
-- ・あとで v1141・v1143・v1145・v1146 の SQL を流し直すと ss_guard_key が前の形に戻り、写しをまた公開の鍵で書ける。そのときはこの SQL をもう一度流す
--   （db/md-all-viewers-gm-postcheck.sql の 1 行目が NG になるので分かる）。

do $$
declare ok boolean;
begin
  if to_regclass('public.app_state') is null then raise exception 'STOP: public.app_state がありません（何も変えていません）'; end if;
  if to_regprocedure('public.ss_guard_key(text)') is null then
    raise exception 'STOP: 先に 20261115090000（v1146 の SQL）を流してください（何も変えていません）';
  end if;
  execute 'select public.ss_guard_key($1)' into ok using 'prep_certs';
  if not coalesce(ok, false) then
    raise exception 'STOP: 先に 20261115090000（v1146 の SQL）を流してください（何も変えていません）';
  end if;
end $$;

create or replace function public.ss_guard_key(k text) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select coalesce(k in ('mileage_config', 'career_cfg',
                        'cs_criteria', 'bonus_coef', 'bonus_coef_rng', 'bonus_track', 'bonus_eval_rule', 'bonus_eval_ovr', 'cs_strength_rule', 'cs_guide',
                        'grade_hist',
                        'tip_requests', 'prep_tables', 'prep_certs',
                        'md_all_viewers_gm')
                  or (char_length(k) > 17 and left(k, 17) = 'spl_tip_requests_'), false)
$$;
comment on function public.ss_guard_key(text) is
  'v1192: app_state の、公開の鍵で書けないキー（読むのは今までどおり）。関数 secure-state の swIsKey・tpIsKey と同じ決まり（v1141 の 2 つ＋v1143 の 8 つ＋v1145 のグレード履歴＋v1146 の Tip Rate・プレップ＋v1192 の全店を見る AM の写し）。';
revoke all on function public.ss_guard_key(text) from public;
grant execute on function public.ss_guard_key(text) to anon, authenticated, service_role;

do $$
declare rls boolean;
begin
  select c.relrowsecurity into rls from pg_class c where c.oid = 'public.app_state'::regclass;
  if not rls then
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_state'
               and policyname not in ('ss_open', 'ss_secret', 'ss_guard_ins', 'ss_guard_upd', 'ss_guard_del')) then
      raise exception 'STOP: app_state の RLS が OFF で、効いていない決まり（policy）があります。ON にするとそれが効き始めるので、確かめてから（何も変えていません）';
    end if;
    alter table public.app_state enable row level security;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_state' and policyname = 'ss_open') then
      create policy ss_open on public.app_state as permissive for all to anon, authenticated using (true) with check (true);
      comment on policy ss_open on public.app_state is 'v1141: RLS was off before 20261110090000 / 20261112090000 / 20261114090000 / 20261115090000 (rollback turns it off again)';
    end if;
  end if;
  drop policy if exists ss_guard_ins on public.app_state;
  drop policy if exists ss_guard_upd on public.app_state;
  drop policy if exists ss_guard_del on public.app_state;
  create policy ss_guard_ins on public.app_state as restrictive for insert to anon, authenticated
    with check (not public.ss_guard_key(key::text));
  create policy ss_guard_upd on public.app_state as restrictive for update to anon, authenticated
    using (not public.ss_guard_key(key::text)) with check (not public.ss_guard_key(key::text));
  create policy ss_guard_del on public.app_state as restrictive for delete to anon, authenticated
    using (not public.ss_guard_key(key::text));
  comment on policy ss_guard_ins on public.app_state is 'v1192: the keys of ss_guard_key are written by the secure-state function only (reading is unchanged)';
  comment on policy ss_guard_upd on public.app_state is 'v1192: the keys of ss_guard_key are written by the secure-state function only (reading is unchanged)';
  comment on policy ss_guard_del on public.app_state is 'v1192: the keys of ss_guard_key are written by the secure-state function only (reading is unchanged)';
end $$;

-- 写しがまだ無ければ、今の md_all_viewers を 1 回だけ写す（オブジェクトでなければ空の地図）。value の列が json でも jsonb でも
do $$
declare v text; typ text;
begin
  if exists (select 1 from public.app_state where key = 'md_all_viewers_gm') then return; end if;
  if to_regclass('public.app_settings') is not null then
    select s.value::text into v from public.app_settings s where s.key = 'md_all_viewers';
  end if;
  if v is null or jsonb_typeof(v::jsonb) <> 'object' then v := '{}'; end if;
  select data_type into typ from information_schema.columns where table_schema = 'public' and table_name = 'app_state' and column_name = 'value';
  execute format('insert into public.app_state(key, value, updated_at) values ($1, $2::%s, now()) on conflict (key) do nothing',
                 case when typ = 'json' then 'json' else 'jsonb' end)
    using 'md_all_viewers_gm', v;
end $$;

notify pgrst, 'reload schema';
