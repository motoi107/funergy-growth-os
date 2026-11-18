-- v1192（Codex 6986713362 の P2-1）：ダッシュボードで全店を見る AM を、GM・CEO だけが書ける写し（app_state の md_all_viewers_gm）にする。
-- 仕様：docs/LABOR_TOTALS_V1192_JA.md。入れる順番：deploy/labor-totals-v1192/手順.md（この SQL → 関数 secure-state → マージ → 全部の端末を 1192 に
-- → GM・CEO が全店を見る AM を付け直す → emp-private）。
--
-- ・前：関数 secure-state の人件費の合計（labor）は、app_settings の md_all_viewers で ON の AM に全店の合計を返した。md_all_viewers は
--   公開の鍵で書けるので、AM が自分の行を書き足すと、担当外の店の人件費の合計まで受け取れた（app_state の決まり ss_guard_* は app_settings に効かない）。
-- ・いま：関数は app_state の md_all_viewers_gm だけを見る。このキーを ss_guard_key に足し、公開の鍵（anon・authenticated）では書けないようにする
--   （読むのは今までどおり。書くのは関数 secure-state だけで、関数が GM・CEO だけに書かせる）。アプリ 1192 は GM・CEO が「管轄の割り当て」で
--   付け外しすると、この写しと md_all_viewers の両方に書く（前の版の端末は md_all_viewers だけを読む）。
-- ・v1192（Codex 6989812896 の P2-1）：写しは「空」で作る。md_all_viewers も、この SQL の前からある写しも、公開の鍵で書けた（書けた）ので信じない。
--   ・写しがまだ無い：空の写しを作る。関数と 1192 のあと、GM・CEO が 1192 の端末で全店を見る AM を付け直す（だれだったかは先に
--     db/md-all-viewers-gm-precheck.sql の表で見る）。
--   ・写しがもうあり、この SQL で守られていた（md_all_viewers_gm_trusted() が true＝この SQL のあと流し直した）：そのまま（GM・CEO の決めた値を変えない）。
--   ・写しがもうあるが、守られていない（この SQL の前に公開の鍵で作られた・あとで守りが外れた）：何も変えずに STOP。
--     db/md-all-viewers-gm-discard.sql（deploy の 1b）で写しを捨ててから、もう一度流す。
-- ・関数 md_all_viewers_gm_trusted()（サーバーの鍵だけ）：写しが公開の鍵で書けない形かを返す（ss_guard_key・RLS・3 つの決まり・anon と authenticated が
--   RLS を飛ばせない）。関数 secure-state は、これが true のときだけ写しで全店を返す（無い・false・読めない＝担当の店だけ）。
--   守りが外れると（あとで v1141〜v1146 の SQL を流し直す・戻す SQL）関数は写しを使わなくなる（Codex 6989812896 の P2-3）。
-- ・ss_guard_key の中身は v1146 の SQL（20261115090000）と同じで、md_all_viewers_gm が増えただけ。v1146 の SQL が無ければ何も変えずに止まる。
-- ・2 回流しても同じ。戻すとき：先に関数 secure-state を戻してから db/md-all-viewers-gm-rollback.sql（写しの守りと md_all_viewers_gm_trusted を外す。写しの行は残す）。
-- ・あとで v1141・v1143・v1145・v1146 の SQL を流し直すと ss_guard_key が前の形に戻り、写しをまた公開の鍵で書ける（関数は写しを使わなくなる）。
--   そのときは 1b で写しを捨ててから、この SQL をもう一度流し、GM・CEO が付け直す（db/md-all-viewers-gm-postcheck.sql の 1 行目・4 行目が NG になるので分かる）。

do $$
declare ok boolean; was boolean := false;
begin
  perform set_config('funergy.lv_was', '', false);
  if to_regclass('public.app_state') is null then raise exception 'STOP: public.app_state がありません（何も変えていません）'; end if;
  if to_regprocedure('public.ss_guard_key(text)') is null then
    raise exception 'STOP: 先に 20261115090000（v1146 の SQL）を流してください（何も変えていません）';
  end if;
  execute 'select public.ss_guard_key($1)' into ok using 'prep_certs';
  if not coalesce(ok, false) then
    raise exception 'STOP: 先に 20261115090000（v1146 の SQL）を流してください（何も変えていません）';
  end if;
  -- v1192（Codex 6989812896 の P2-1）：写しがこの SQL で守られていたか（決まりを変える「前」に見る）。守られていない写しは信じない
  if to_regprocedure('public.md_all_viewers_gm_trusted()') is not null then
    execute 'select public.md_all_viewers_gm_trusted()' into was;
  end if;
  was := coalesce(was, false);
  if not was and exists (select 1 from public.app_state where key = 'md_all_viewers_gm') then
    raise exception 'STOP: app_state に写し md_all_viewers_gm がもうありますが、この SQL で守られていません（公開の鍵で作られた・書かれたかもしれない）。何も変えていません。db/md-all-viewers-gm-discard.sql（deploy の 1b）で写しを捨ててから、もう一度流してください';
  end if;
  perform set_config('funergy.lv_was', case when was then '1' else '0' end, false);
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

-- 写しがまだ無ければ、空の写しを作る（md_all_viewers は写さない＝公開の鍵で書けたので信じない）。value の列が json でも jsonb でも。
-- もうある写しは、この SQL で前から守られていたときだけそのまま（流しているあいだに作られた写しは STOP）
do $$
declare typ text; was text := current_setting('funergy.lv_was', true);
begin
  if exists (select 1 from public.app_state where key = 'md_all_viewers_gm') then
    if coalesce(was, '') <> '1' then
      raise exception 'STOP: この SQL を流しているあいだに写し md_all_viewers_gm が作られました（公開の鍵で書かれたかもしれない）。db/md-all-viewers-gm-discard.sql（deploy の 1b）で写しを捨ててから、もう一度流してください';
    end if;
    return;   -- 前からこの SQL で守られていた写し（GM・CEO が関数で書いたもの）はそのまま
  end if;
  select data_type into typ from information_schema.columns where table_schema = 'public' and table_name = 'app_state' and column_name = 'value';
  execute format('insert into public.app_state(key, value, updated_at) values ($1, $2::%s, now()) on conflict (key) do nothing',
                 case when typ = 'json' then 'json' else 'jsonb' end)
    using 'md_all_viewers_gm', '{}';
end $$;

-- 写しが公開の鍵で書けない形か（関数 secure-state がこれで写しを使うかを決める）。読むだけ・サーバーの鍵だけ
create or replace function public.md_all_viewers_gm_trusted() returns boolean
language plpgsql stable set search_path = public, pg_catalog, pg_temp as $f$
declare c record; n int;
begin
  if to_regclass('public.app_state') is null or to_regprocedure('public.ss_guard_key(text)') is null then return false; end if;
  if not coalesce(public.ss_guard_key('md_all_viewers_gm'), false) then return false; end if;
  select relrowsecurity, relforcerowsecurity, relowner into c from pg_class where oid = 'public.app_state'::regclass;
  if not coalesce(c.relrowsecurity, false) then return false; end if;
  -- anon・authenticated が RLS を飛ばせない（BYPASSRLS・スーパーユーザー・表の持ち主のロールを継ぐ）
  if (select count(*) from pg_roles r where r.rolname in ('anon', 'authenticated')) <> 2 then return false; end if;
  if exists (select 1 from pg_roles r where r.rolname in ('anon', 'authenticated') and (r.rolbypassrls or r.rolsuper)) then return false; end if;
  if not c.relforcerowsecurity and exists (select 1 from pg_roles r where r.rolname in ('anon', 'authenticated') and pg_has_role(r.oid, c.relowner, 'USAGE')) then
    return false;
  end if;
  -- 3 つの決まり：restrictive・anon と authenticated（か public）に効く・中身が「not ss_guard_key(key)」
  select count(*) into n from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'app_state' and p.permissive = 'RESTRICTIVE'
     and (p.roles @> array['anon', 'authenticated']::name[] or 'public' = any(p.roles))
     and ((p.policyname = 'ss_guard_ins' and p.cmd = 'INSERT'
           and regexp_replace(lower(coalesce(p.with_check, '')), '[[:space:]()]|public\.|::text', '', 'g') = 'notss_guard_keykey')
       or (p.policyname = 'ss_guard_upd' and p.cmd = 'UPDATE'
           and regexp_replace(lower(coalesce(p.qual, '')), '[[:space:]()]|public\.|::text', '', 'g') = 'notss_guard_keykey'
           and regexp_replace(lower(coalesce(p.with_check, '')), '[[:space:]()]|public\.|::text', '', 'g') = 'notss_guard_keykey')
       or (p.policyname = 'ss_guard_del' and p.cmd = 'DELETE'
           and regexp_replace(lower(coalesce(p.qual, '')), '[[:space:]()]|public\.|::text', '', 'g') = 'notss_guard_keykey'));
  return n = 3;
end $f$;
comment on function public.md_all_viewers_gm_trusted() is
  'v1192（Codex 6989812896）: app_state の md_all_viewers_gm が公開の鍵で書けない形か。関数 secure-state はこれが true のときだけ写しで全店の人件費の合計を返す。';
revoke all on function public.md_all_viewers_gm_trusted() from public;
revoke all on function public.md_all_viewers_gm_trusted() from anon, authenticated;
grant execute on function public.md_all_viewers_gm_trusted() to service_role;

do $$
begin
  if not public.md_all_viewers_gm_trusted() then
    raise exception 'STOP: 写し md_all_viewers_gm を公開の鍵で書けない形にできませんでした（anon・authenticated が RLS を飛ばせる・決まりが違う）。このまま Claude に連絡してください（関数 secure-state は写しを使いません）';
  end if;
  perform set_config('funergy.lv_was', '', false);
end $$;

notify pgrst, 'reload schema';
