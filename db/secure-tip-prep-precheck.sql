-- 読むだけ（v1146・2b-8）。関数 secure-state を v1146 にする前と、20261115090000_secure_tip_prep.sql を入れる「前」に、Supabase の SQL Editor で流す。
-- 何も書き換えない（最後に rollback）。Tip Rate・プレップの中身・社員の名前は出しません（あるか・数・大きさ・形だけ）。表をそのまま Claude に貼ってください。
-- 対象：Tip Rate の申請・決定（spl_tip_requests_<名前>・前の統合行 tip_requests）とプレップの時給の表・認定（prep_tables・prep_certs）。
-- 書いてよいのは今の画面で決められる人（Moto さん 11/10）。関数が決める（docs/SECURE_TIP_PREP_V1146_JA.md）。
begin;
create temp table tp_pre(n int, what text, value text, ok text) on commit drop;
insert into tp_pre
select 1, 'app_state の表', case when to_regclass('public.app_state') is null then 'ない' else 'ある' end,
       case when to_regclass('public.app_state') is null then 'STOP' else 'OK' end;
insert into tp_pre
select 2, 'app_state の RLS', case when c.relrowsecurity then 'ON' else 'OFF' end,
       case when c.relrowsecurity then 'OK' else 'info（OFF。v1146 の SQL が ON にして今までどおり読み書きできる決まりを足します）' end
  from pg_class c where c.oid = 'public.app_state'::regclass;
insert into tp_pre
select 3, 'v1141・v1143・v1145 の決まり（ss_guard_ins・ss_guard_upd・ss_guard_del）', count(*)::text,
       case when count(*) = 0 then 'info（まだ。v1146 の SQL だけで v1141・v1143・v1145 の分も入ります）' else 'info（もう ' || count(*) || ' つ。v1146 の SQL はキーを足すだけ）' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname in ('ss_guard_ins', 'ss_guard_upd', 'ss_guard_del');
-- 4：人ごとの Tip Rate の行。関数 secure-state と同じ決まりで形を見る（行は配列・記録は id・行と同じ名前・状態は 申請中／承認／却下・率は 0〜100 の数）。
--   行が配列でない・同じ id が 2 つある行は、v1146 の関数ではだれも保存できません（NG）。形の合わない記録は、そのままなら保存は止まりません（残る）
insert into tp_pre
with r as (
  select a.key, substr(a.key, 18) as nm, a.value::jsonb as v, char_length(a.value::text) as len
    from public.app_state a where left(a.key, 17) = 'spl_tip_requests_' and char_length(a.key) > 17
), e as (
  select r.key, x as rec from r, jsonb_array_elements(case when jsonb_typeof(r.v) = 'array' then r.v else '[]'::jsonb end) x
), odd as (
  select e.key from e join r using (key)
   where jsonb_typeof(e.rec) <> 'object'
      or jsonb_typeof(e.rec->'id') not in ('string', 'number')
      or coalesce(e.rec->>'name', '') <> r.nm
      or coalesce(e.rec->>'status', '') not in ('申請中', '承認', '却下')
      or jsonb_typeof(e.rec->'rate') <> 'number' or (e.rec->>'rate')::numeric < 0 or (e.rec->>'rate')::numeric > 100
), dup as (
  select e.key from e where jsonb_typeof(e.rec) = 'object' and jsonb_typeof(e.rec->'id') in ('string', 'number')
   group by e.key, e.rec->>'id' having count(*) > 1
)
select 4, 'Tip Rate の人ごとの行（spl_tip_requests_）',
       (select count(*) from r)::text || ' 行・' || (select count(*) from e)::text || ' 件・決めたもの ' || (select count(*) from e where e.rec->>'status' in ('承認', '却下'))::text
         || '・配列でない行 ' || (select count(*) from r where jsonb_typeof(r.v) <> 'array')::text
         || '・同じ id のある行 ' || (select count(distinct key) from dup)::text
         || '・形の合わない記録 ' || (select count(*) from odd)::text
         || '・200 字より長い名前の行 ' || (select count(*) from r where char_length(r.key) > 200)::text,
       case when (select count(*) from r where jsonb_typeof(r.v) <> 'array') > 0 or (select count(*) from dup) > 0 then 'NG（その人の Tip Rate はだれも保存できなくなります。Claude に）'
            when (select count(*) from r where r.len > 4000000) > 0 then 'NG（400 万字より大きい行がある。Claude に）'
            when (select count(*) from odd) > 0 then 'info（形の合わない記録がある。そのまま残せば保存は止まりません。ほかの人の名前の記録は、その人の行に移るときに決める人の保存だけが通ります。Claude に）'
            when (select count(*) from r where char_length(r.key) > 200) > 0 then 'info（名前の長すぎる行は v1146 の関数で書けません。Claude に）'
            else 'OK' end;
-- 5：前の統合行（tip_requests）。人ごとの行（v720 から）に無い記録があると、その記録を人ごとの行へ移す保存（どの端末も自動でする）は、
--   決める人（CEO・GM・AM など）のときだけ通ります。決めない人の端末では「断られた」と出ます（右上の「保存」から外せる・値は変わらない）。
insert into tp_pre
with l as (
  select x as rec from public.app_state a, jsonb_array_elements(case when jsonb_typeof(a.value::jsonb) = 'array' then a.value::jsonb else '[]'::jsonb end) x
   where a.key = 'tip_requests'
), p as (
  select x->>'id' as id from public.app_state a, jsonb_array_elements(case when jsonb_typeof(a.value::jsonb) = 'array' then a.value::jsonb else '[]'::jsonb end) x
   where left(a.key, 17) = 'spl_tip_requests_' and char_length(a.key) > 17
)
select 5, 'Tip Rate の前の統合行（tip_requests）',
       case when not exists (select 1 from public.app_state where key = 'tip_requests') then '行なし'
            else (select count(*) from l)::text || ' 件・人ごとの行に無い記録 '
                 || (select count(*) from l where jsonb_typeof(l.rec->'id') in ('string', 'number') and not exists (select 1 from p where p.id = l.rec->>'id'))::text end,
       case when (select count(*) from l where jsonb_typeof(l.rec->'id') in ('string', 'number') and not exists (select 1 from p where p.id = l.rec->>'id')) > 0
            then 'info（人ごとの行に無い記録がある。入れる前に GM・CEO の端末で一度 Tip Rate の画面を開いて「最新を取得」すると移ります。数が減らなければ Claude に）'
            else 'OK' end;
-- 6・7：プレップの時給の表と認定（関数と同じ決まり：全体がオブジェクト・記録はオブジェクトか空・キーは 200 字まで・400 万字まで）
insert into tp_pre
select o.n, o.what,
       case when a.value is null then '行なし'
            when jsonb_typeof(a.value::jsonb) <> 'object' then '全体がオブジェクトでない（' || jsonb_typeof(a.value::jsonb) || '）'
            else (select count(*) from jsonb_object_keys(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end))::text || ' 件・形の合わない記録 ' || coalesce(x.bad, 0)::text end,
       case when a.value is not null and (jsonb_typeof(a.value::jsonb) <> 'object' or char_length(a.value::text) > 4000000) then 'NG（GM・CEO も保存できなくなります。Claude に）'
            when coalesce(x.bad, 0) > 0 then 'info（形の合わない記録がある。そのまま残せば GM・CEO の保存は止まりません。Claude に）'
            else 'OK' end
  from (values (6, 'プレップの時給の表（prep_tables）', 'prep_tables'), (7, 'プレップの認定（prep_certs）', 'prep_certs')) o(n, what, k)
  left join public.app_state a on a.key = o.k
  left join lateral (select count(*)::int as bad from jsonb_each(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end) e
                      where char_length(e.key) > 200 or jsonb_typeof(e.value) not in ('object', 'null')) x on true;
-- 8・9：今の画面で Tip Rate を決められるのに、v1146 の関数では決められない人の数（名前は出しません。だれかは GM・CEO の「承認・閲覧の権限の確かめ」で）。
--   関数は、AM・G4・Head Chef を GM・CEO が確かめた写し（wr_people）で決める（v1131 から。社員の表は公開の鍵で書けるので）。
--   ワークセンターを使い始めている（10 行目が ON）なら、G4・Head Chef は今の画面でも決めない（v1135）ので数えません。
do $$
declare has_wr boolean := to_regclass('public.wr_people') is not null;
        has_chef boolean := false; live boolean := null; n_am int; n_g4 int; n_ch int; n_cc int;
begin
  if has_wr then
    has_chef := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'wr_people' and column_name = 'chef');
  end if;
  if to_regclass('public.wr_settings') is not null then
    execute 'select coalesce((select live from public.wr_settings where id = 1), false)' into live;
  end if;
  if not has_wr then
    insert into tp_pre values (8, 'Tip Rate を決められなくなる AM・G4・Head Chef（確かめた写し wr_people）', '表 wr_people なし',
      'NG（ワークセンターの SQL（20261104090000）がまだ。AM・G4・Head Chef はだれも Tip Rate を決められなくなります。Claude に）');
  else
    -- 役割・肩書きは列か、無ければ data の中（関数 secure-state・アプリと同じ）
    execute $q$
      with e as (
        select x.id::text as id, coalesce(nullif(x.role, ''), x.data->>'role', '') as role, btrim(coalesce(nullif(x.title, ''), x.data->>'title', '')) as title
          from public.employees x
         where coalesce(x.status, '') <> '退職' and coalesce(x.data->>'status', '') <> '退職' and coalesce(x.data->>'osDisabled', '') <> 'true'
      )
      select count(*) filter (where e.role = 'am' and not exists (select 1 from public.wr_people w where w.emp_id = e.id and w.role = 'am')),
             count(*) filter (where e.role = 'g4' and not exists (select 1 from public.wr_people w where w.emp_id = e.id and w.grade >= 4)),
             count(*) filter (where e.role = 'chef' and e.title <> 'Corporate Chef'
                                and not exists (select 1 from public.wr_people w where w.emp_id = e.id and w.grade >= 4 and coalesce((to_jsonb(w)->>'chef')::boolean, false))),
             count(*) filter (where e.role = 'chef' and e.title = 'Corporate Chef'
                                and not exists (select 1 from public.wr_people w where w.emp_id = e.id and w.grade >= 5 and coalesce((to_jsonb(w)->>'chef')::boolean, false)))
        from e
    $q$ into n_am, n_g4, n_ch, n_cc;
    if live is true then n_g4 := 0; n_ch := 0; end if;   -- 使い始めている：今の画面でも決めない
    insert into tp_pre values (8, 'Tip Rate を決められなくなる人（AM ' || n_am || '・G4 ' || n_g4 || '・Head Chef ' || n_ch || '・Corporate Chef ' || n_cc || '）',
      (n_am + n_g4 + n_ch + n_cc)::text,
      case when n_am + n_g4 + n_ch + n_cc = 0 then 'OK'
           else 'info（その人は GM・CEO が「承認・閲覧の権限の確かめ」で確かめるまで、Tip Rate を決められません（今の画面では決められる）。' ||
                case when not has_chef and n_ch + n_cc > 0 then 'Head Chef の印は v1144 の 1b の SQL（20261113080000）が要ります。' else '' end || '）' end);
  end if;
  insert into tp_pre values (9, 'ワークセンターを使い始めたか（wr_settings.live）',
    case when live is null then '表なし' when live then 'ON' else 'OFF' end,
    case when live is null then 'info（ワークセンターの SQL がまだ。G4・Head Chef は関数では Tip Rate を決めません）'
         when live then 'info（ON：G4・Head Chef は Tip Rate を決めず GM に申請（今の画面と同じ）。CEO・GM・AM・Corporate Chef が決める）'
         else 'info（OFF：確かめた G4・Head Chef も Tip Rate を決める（今の画面と同じ））' end);
end $$;
-- 10・11：PIN のログインで「GM」「CEO」と分かるのは、メールのアカウント（manager_auth）が社員と結ばれている人だけ（work-requests の whoami）。
--   結ばれていない人は、v1146 の関数ではプレップの表・認定を PIN のログインで変えられない（社員 ID を入れる：db/invoice-signin-emp-check.sql で確かめる）。
--   Tip Rate は、メールのログインでも決められない（名前が分からないと、自分の Tip Rate かを決められない。Codex #140 6766283780 の P3）
insert into tp_pre
select 10, 'GM・CEO のメールのアカウントのうち、社員と結ばれていないもの', count(*)::text,
       case when count(*) = 0 then 'OK' else 'info（その人は Tip Rate を決められず、PIN のログインではプレップの表・認定も変えられません。manager_auth に社員 ID を入れてください）' end
  from public.manager_auth m where m.role in ('ceo', 'gm') and (m.emp_id is null or m.emp_id::text = '');
insert into tp_pre
select 11, 'GM・CEO のメールのアカウント（v1146 からプレップの表・認定を変えられる人）', count(*)::text, case when count(*) > 0 then 'OK' else 'STOP（だれも変えられなくなります）' end
  from public.manager_auth m where m.role in ('ceo', 'gm');
select n, what, value, ok from tp_pre order by n;
rollback;
