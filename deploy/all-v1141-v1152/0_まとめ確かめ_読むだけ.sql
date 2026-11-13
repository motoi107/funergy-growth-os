-- まとめて確かめる（読むだけ・v1141〜v1152 の ① を 1 回で）。何も書き換えません（最後に rollback）。
-- Supabase の SQL Editor に貼って Run。表を Claude に貼ってください（Claude との会話だけ。公開の PR・Issue・共有の場所には貼らないでください）。
-- 出るのは数・形・設定のあるなしと、ガソリン代の単価（会社の設定・1 マイルあたり）です。人の名前・記録の中身は出しません：
-- 名前の入る行（v1142 の 11 行目＝確かめがまだの人）は数だけにし、ほかの行も社員の名前（2 文字以上）を含む値は伏せます（最後の select）。
-- 確かめがまだの人の名前は、アプリの「ワークセンター › 承認・閲覧の権限の確かめ」の画面で見てください。
-- v（版）と n（行）は、それぞれの deploy/<版>/手順.md の「① の◯行目」と同じです。中身はそれぞれの 1_確かめ_読むだけ.sql をそのまま並べたものです（名前を伏せるのは最後の select だけ）。
begin;
create temp table all_pre(v text, n int, what text, value text, ok text) on commit drop;

-- ===== v1141（deploy/secure-settings-v1141/1_確かめ_読むだけ.sql）=====
insert into all_pre select 'v1141', x.* from (
-- 読むだけ（v1141・2b-3）。関数 secure-state を v1141 にする前と、20261110090000_secure_settings_write.sql を入れる「前」に、Supabase の SQL Editor で流す。
-- 何も書き換えない。地図の鍵・Score管理の中身は出しません（あるか・数・大きさだけ）。表をそのまま Claude に貼ってください。
select 1 as n, 'app_state の表' as what, case when to_regclass('public.app_state') is null then 'ない' else 'ある' end as value,
       case when to_regclass('public.app_state') is null then 'STOP' else 'OK' end as ok
union all
select 2, 'app_state の RLS', case when c.relrowsecurity then 'ON' else 'OFF' end, case when c.relrowsecurity then 'OK' else 'info（OFF。v1141 の SQL が ON にして今までどおり読み書きできる決まりを足します）' end
  from pg_class c where c.oid = 'public.app_state'::regclass
union all
select 3, 'v1139・v1140 の SQL（決まり ss_secret）', count(*)::text, case when count(*) = 1 then 'OK（入っている）' else 'info（まだ）' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname = 'ss_secret'
union all
select 4, 'v1141 の決まり（ss_guard_ins・ss_guard_upd・ss_guard_del）', count(*)::text, case when count(*) = 0 then 'info（まだ）' else 'info（もう ' || count(*) || ' つ。流し直しても同じ）' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname in ('ss_guard_ins', 'ss_guard_upd', 'ss_guard_del')
union all
-- ガソリン代の単価：work-requests の wr_mileage_rate と同じ読み方（包んだ形 __st も）。0.01〜5 でないと、ガソリン代の申請が止まる（「単価なし」・短い距離が 0 セント）。
-- 包んだ形はアプリが書かない形（画面は外を・精算は中を読むので、違う単価になりうる）。v1141 の関数は包んだ形を断るので、CEO・GM・経理が画面で入れ直す
select 5, 'ガソリン代の設定（mileage_config）の単価',
       case when x.v is null then '行なし' when r is null then '数でない・ない' else r::text end || case when x.w then '（包んだ形）' else '' end,
       case when r is not null and r >= 0.01 and r <= 5 and not x.w then 'OK'
            when r is not null and r >= 0.01 and r <= 5 then 'info（包んだ形。v1141 のあと CEO・GM・経理が画面で単価を入れ直してください）'
            else 'NG（ガソリン代の申請が止まる単価。v1141 の画面で CEO・GM・経理が入れ直してください）' end
  from (select (select case when a.value::jsonb->>'__st' = '1' then a.value::jsonb->'v' else a.value::jsonb end from public.app_state a where a.key = 'mileage_config') v,
               coalesce((select a.value::jsonb ? '__st' from public.app_state a where a.key = 'mileage_config' and jsonb_typeof(a.value::jsonb) = 'object'), false) w) x
  left join lateral (select case when jsonb_typeof(x.v->'ratePerMile') = 'number' then (x.v->>'ratePerMile')::numeric end r) y on true
union all
select 6, 'ガソリン代の設定の地図の鍵（gmapsKey。中身は出しません）',
       case when coalesce((select case when a.value::jsonb->>'__st' = '1' then a.value::jsonb->'v' else a.value::jsonb end from public.app_state a where a.key = 'mileage_config')->>'gmapsKey', '') = '' then '空' else '入っている' end,
       'info（入っているときは、Google Cloud でその鍵を funergy-plus.com だけから使えるように（HTTP リファラーの制限）してください。画面で使う鍵なので、公開の鍵と同じく見えます）'
union all
select 7, 'Score管理（career_cfg）', coalesce((select (select count(*) from jsonb_object_keys(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end))::text || ' 件・'
                                              || round(octet_length(a.value::text) / 1024.0)::text || ' KB・形の合わない記録 '
                                              || case when jsonb_typeof(a.value::jsonb) <> 'object' then '（全体が地図でない）'
                                                      else (select count(*) from jsonb_each(a.value::jsonb) e where char_length(e.key) > 100 or jsonb_typeof(e.value) not in ('object', 'null'))::text end
                                              from public.app_state a where a.key = 'career_cfg'), '行なし'),
       case when (select jsonb_typeof(a.value::jsonb) from public.app_state a where a.key = 'career_cfg') <> 'object'
            then 'NG（Score管理の行が地図でない。権限が初期の決まりに戻っています。Claude に）'
            else 'info（形の合わない記録があっても GM・CEO の保存は止まりません（そのまま残る）。消すなら Claude に）' end
union all
-- PIN のログインで「経理」「GM」「CEO」と分かるのは、メールのアカウント（manager_auth）が社員と結ばれている人だけ（work-requests の whoami）。
-- アプリは PIN の印があればいつもそれで送る（メールのログインに切り替えない）ので、結ばれていない人は v1141 からガソリン代の単価・Score管理を変えられない
select 8, 'CEO・GM・経理のメールのアカウントのうち、社員と結ばれていないもの', count(*)::text,
       case when count(*) = 0 then 'OK' else 'info（その人は変えられません。manager_auth に社員 ID を入れてください：db/invoice-signin-emp-check.sql で確かめる）' end
  from public.manager_auth m where m.role in ('ceo', 'gm', 'office') and (m.emp_id is null or m.emp_id::text = '')
union all
select 9, 'CEO・GM・経理のメールのアカウント（v1141 から単価を変えられる人）', count(*)::text, case when count(*) > 0 then 'OK' else 'STOP（だれも変えられなくなります）' end
  from public.manager_auth m where m.role in ('ceo', 'gm', 'office')
order by 1
) x;

-- ===== v1142（deploy/secure-hr-v1142/1_確かめ_読むだけ.sql）=====
insert into all_pre select 'v1142', x.* from (
-- 読むだけ（v1142・2b-4）。関数 secure-state を v1142 にする前と、20261111090000_secure_hr_rls.sql を入れる「前」に、Supabase の SQL Editor で流す。何も書き換えない。
-- 応募者・不採用ログ・相談の中身（名前・電話・メール・理由・本文）は出しません（数・大きさと、確かめが要るスタッフの名前だけ）。表をそのまま Claude に貼ってください。
select 1 as n, 'app_state の表' as what, case when to_regclass('public.app_state') is null then 'ない' else 'ある' end as value,
       case when to_regclass('public.app_state') is null then 'STOP' else 'OK' end as ok
union all
select 2, 'v1139・v1140 の SQL（決まり ss_secret）', count(*)::text, case when count(*) = 1 then 'OK（入っている）' else 'info（まだ。v1142 の SQL が一緒に入れます）' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname = 'ss_secret'
union all
select 3, '店の表（stores の id・name・brand・data）', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'stores' and column_name in ('id', 'name', 'brand', 'data'))::text || ' / 4 列',
       case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'stores' and column_name in ('id', 'name', 'brand', 'data')) = 4 then 'OK'
            else 'STOP（関数は店の表で応募者の店を決めます。Claude に貼ってください）' end
union all
select 4, '応募者（applicants）', coalesce((select case when jsonb_typeof(s.value::jsonb) = 'array' then jsonb_array_length(s.value::jsonb)::text || ' 件・' else '形が違う（' || jsonb_typeof(s.value::jsonb) || '）・' end
                                                    || round(octet_length(s.value::text) / 1024.0)::text || ' KB' from public.app_state s where s.key::text = 'applicants'), '行なし'),
       case when exists (select 1 from public.app_state s where s.key::text = 'applicants' and jsonb_typeof(s.value::jsonb) not in ('array', 'null')) then 'NG（配列でない。関数は書きません。Claude に貼ってください）' else 'info' end
union all
select 5, '不採用ログ（reject_log）', coalesce((select case when jsonb_typeof(s.value::jsonb) = 'array' then jsonb_array_length(s.value::jsonb)::text || ' 件・' else '形が違う（' || jsonb_typeof(s.value::jsonb) || '）・' end
                                                    || round(octet_length(s.value::text) / 1024.0)::text || ' KB' from public.app_state s where s.key::text = 'reject_log'), '行なし'),
       case when exists (select 1 from public.app_state s where s.key::text = 'reject_log' and jsonb_typeof(s.value::jsonb) not in ('array', 'null')) then 'NG（配列でない。Claude に貼ってください）' else 'info' end
union all
select 6, 'お悩み相談室（growthhub）', coalesce((select case when jsonb_typeof(s.value::jsonb) = 'array' then jsonb_array_length(s.value::jsonb)::text || ' 件・' else '形が違う（' || jsonb_typeof(s.value::jsonb) || '）・' end
                                                    || round(octet_length(s.value::text) / 1024.0)::text || ' KB' from public.app_state s where s.key::text = 'growthhub'), '行なし'),
       case when exists (select 1 from public.app_state s where s.key::text = 'growthhub' and jsonb_typeof(s.value::jsonb) not in ('array', 'null')) then 'NG（配列でない。Claude に貼ってください）' else 'info' end
union all
-- 応募店舗が、どの店のブランド・店の名前・「未分類」にも当たらない応募者・不採用の記録：CEO・GM・経理にだけ見える（今の画面でも AM・店長には出ていない）
select 7, '店に当たらない応募者・不採用の記録（CEO・GM・経理にだけ見える）',
       (select count(*) from public.app_state s, jsonb_array_elements(case when jsonb_typeof(s.value::jsonb) = 'array' then s.value::jsonb else '[]'::jsonb end) x
         where s.key::text in ('applicants', 'reject_log')
           and coalesce(btrim(x->>'store'), '') not in (select btrim(coalesce(nullif(btrim(st.brand), ''), st.data->>'brand', '')) from public.stores st
                                                        union select btrim(coalesce(nullif(btrim(st.name), ''), st.data->>'name', '')) from public.stores st union select '未分類'))::text,
       'info'
union all
-- ID の形が合わない応募者・相談（英数字と _ - だけ・64 文字まで）：画面にボタンが出ない（直す・採用・不採用・返信ができない）
select 8, 'ID の形が合わない応募者・相談（画面で操作できない）',
       (select count(*) from public.app_state s, jsonb_array_elements(case when jsonb_typeof(s.value::jsonb) = 'array' then s.value::jsonb else '[]'::jsonb end) x
         where s.key::text in ('applicants', 'growthhub') and coalesce(x->>'id', '') !~ '^[A-Za-z0-9_-]{1,64}$')::text,
       case when (select count(*) from public.app_state s, jsonb_array_elements(case when jsonb_typeof(s.value::jsonb) = 'array' then s.value::jsonb else '[]'::jsonb end) x
         where s.key::text in ('applicants', 'growthhub') and coalesce(x->>'id', '') !~ '^[A-Za-z0-9_-]{1,64}$') = 0 then 'OK' else 'info（Claude に貼ってください）' end
union all
-- 店が店の表に無い相談：CEO・GM・経理と、相談した本人にだけ見える
select 9, '店の表に無い店の相談（CEO・GM・経理と本人にだけ見える）',
       (select count(*) from public.app_state s, jsonb_array_elements(case when jsonb_typeof(s.value::jsonb) = 'array' then s.value::jsonb else '[]'::jsonb end) x
         where s.key::text = 'growthhub' and coalesce(x->>'store', '') not in (select st.id::text from public.stores st))::text, 'info'
union all
-- 相談した人の名前が、在籍の人の名前に当たらない相談：本人はもう見られない（CEO・GM・経理と店の管理者には見える）
select 10, '在籍の人の名前に当たらない相談（相談した本人には見えない）',
       (select count(*) from public.app_state s, jsonb_array_elements(case when jsonb_typeof(s.value::jsonb) = 'array' then s.value::jsonb else '[]'::jsonb end) x
         where s.key::text = 'growthhub'
           and btrim(coalesce(x->>'author', '')) not in (select btrim(coalesce(e.name, '')) from public.employees e
                                                        where coalesce(e.status, '') <> '退職' and coalesce(e.data->>'status', '') <> '退職' and coalesce(e.data->>'osDisabled', '') <> 'true'))::text, 'info'
union all
-- 社員の表で AM・G4・店長（Store Manager）なのに、GM・CEO の確かめがまだの人：確かめるまで、応募者は配属の店だけ（未分類・担当の店は入らない）・
-- お悩み相談室は自分の相談だけ（G3 と同じ）
select 11, '確かめがまだの AM・G4・店長（ワークセンター › 承認・閲覧の権限の確かめ）',
       count(*)::text || coalesce('：' || string_agg(btrim(e.name), '・' order by btrim(e.name)), ''),
       case when count(*) = 0 then 'OK' else 'info（確かめるまで、応募者は配属の店だけ・相談は自分の分だけ）' end
  from public.employees e
 where (coalesce(e.role, '') in ('am', 'g4') or (coalesce(e.role, '') = 'sl' and btrim(coalesce(e.title, e.data->>'title', '')) = 'Store Manager'))
   and coalesce(e.status, '') <> '退職' and coalesce(e.data->>'status', '') <> '退職' and coalesce(e.data->>'osDisabled', '') <> 'true'
   and not exists (select 1 from public.wr_people w where w.emp_id = e.id::text and (w.role = 'am' or w.grade >= 4))
union all
select 12, 'app_state の RLS（ON なら v1139 以降の SQL が入っている）', case when c.relrowsecurity then 'ON' else 'OFF' end, 'info'
  from pg_class c where c.oid = 'public.app_state'::regclass
union all
-- CEO・GM・経理のメールのアカウントで、社員 ID が社員の表に無い人：関数はその人に応募者・不採用ログ・相談を何も見せない
-- （社員の行を消した人は止める：Codex #136 6738169923 の P2-1）。社員と結ばれていない（社員 ID が空の）アカウントは今までどおり全部見える
select 13, 'CEO・GM・経理のメールのアカウントで、社員 ID が社員の表に無い（応募者・不採用ログ・相談が見えなくなる）', count(*)::text,
       case when count(*) = 0 then 'OK' else 'info（manager_auth の emp_id を今の社員 ID に直すか、空にする。db/invoice-signin-emp-check.sql で確かめる）' end
  from public.manager_auth m
 where m.role in ('ceo', 'gm', 'office') and coalesce(m.emp_id::text, '') <> ''
   and not exists (select 1 from public.employees e where e.id::text = m.emp_id::text)
order by n
) x;

-- ===== v1143（deploy/secure-settings-v1143/1_確かめ_読むだけ.sql）=====
insert into all_pre select 'v1143', x.* from (
-- 読むだけ（v1143・2b-5）。関数 secure-state を v1143 にする前と、20261112090000_secure_settings_more.sql を入れる「前」に、Supabase の SQL Editor で流す。
-- 何も書き換えない。設定の中身・名前は出しません（あるか・数・大きさ・形だけ）。表をそのまま Claude に貼ってください。
-- 対象：GM・CEO だけが変える賞与・Career Score の設定 8 つ（スコア基準・係数・係数の幅・G3 の職種・4 項目の設定・個人設定・強みの決まり・評価基準と例）。
select 1 as n, 'app_state の表' as what, case when to_regclass('public.app_state') is null then 'ない' else 'ある' end as value,
       case when to_regclass('public.app_state') is null then 'STOP' else 'OK' end as ok
union all
select 2, 'app_state の RLS', case when c.relrowsecurity then 'ON' else 'OFF' end,
       case when c.relrowsecurity then 'OK' else 'info（OFF。v1143 の SQL が ON にして今までどおり読み書きできる決まりを足します）' end
  from pg_class c where c.oid = 'public.app_state'::regclass
union all
select 3, 'v1141 の決まり（ss_guard_ins・ss_guard_upd・ss_guard_del）', count(*)::text,
       case when count(*) = 0 then 'info（まだ。v1143 の SQL だけで v1141 の分も入ります）' else 'info（もう ' || count(*) || ' つ。v1143 の SQL はキーを足すだけ）' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname in ('ss_guard_ins', 'ss_guard_upd', 'ss_guard_del')
union all
-- 4〜11：8 つのキー。行・記録の数・大きさ・形（関数 secure-state と同じ決まり：キー → 記録（オブジェクトか空）の地図。キーは 200 字まで）。
-- 全体がオブジェクトでない行は、v1143 の関数では GM・CEO も保存できません（Claude に）。形の合わない記録は、そのままなら保存は止まりません（残る）
select 3 + o.i, '「' || o.label || '」（' || o.k || '）',
       coalesce((select case when jsonb_typeof(a.value::jsonb) <> 'object' then '全体がオブジェクトでない（' || jsonb_typeof(a.value::jsonb) || '）'
                             else (select count(*) from jsonb_object_keys(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end))::text || ' 件・' || round(char_length(a.value::text) / 1000.0)::text || ' 千字・形の合わない記録 '
                                  || (select count(*) from jsonb_each(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end) e where char_length(e.key) > 200 or jsonb_typeof(e.value) not in ('object', 'null'))::text end
                   from public.app_state a where a.key = o.k), '行なし'),
       case when (select jsonb_typeof(a.value::jsonb) from public.app_state a where a.key = o.k) <> 'object' then 'NG（全体がオブジェクトでない。Claude に）'
            when (select char_length(a.value::text) from public.app_state a where a.key = o.k) > 6000000 then 'NG（600 万字より大きい。v1143 の関数は書けません。Claude に）'
            when (select char_length(a.value::text) from public.app_state a where a.key = o.k) > 3000000 then 'info（300 万字より大きい。600 万字を超えると保存できなくなります。Claude に）'
            when coalesce((select count(*) from public.app_state a, jsonb_each(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end) e
                            where a.key = o.k and (char_length(e.key) > 200 or jsonb_typeof(e.value) not in ('object', 'null'))), 0) > 0
              then 'info（形の合わない記録がある。GM・CEO の保存は止まりません（そのまま残る）。消すなら Claude に）'
            else 'OK' end
  from (values (1, 'cs_criteria', 'スコア基準'), (2, 'bonus_coef', '賞与の係数'), (3, 'bonus_coef_rng', '賞与の係数の幅'), (4, 'bonus_track', 'G3 の職種'),
               (5, 'bonus_eval_rule', '賞与の 4 項目の設定'), (6, 'bonus_eval_ovr', '賞与の個人設定'), (7, 'cs_strength_rule', '強みの決まり'), (8, 'cs_guide', '評価基準・例')) o(i, k, label)
union all
-- PIN のログインで「GM」「CEO」と分かるのは、メールのアカウント（manager_auth）が社員と結ばれている人だけ（work-requests の whoami）。
-- 結ばれていない人は、v1143 の関数ではこの 8 つを変えられない（社員 ID を入れる：db/invoice-signin-emp-check.sql で確かめる）
select 12, 'GM・CEO のメールのアカウントのうち、社員と結ばれていないもの', count(*)::text,
       case when count(*) = 0 then 'OK' else 'info（その人は v1143 から賞与・Career Score の設定を変えられません。manager_auth に社員 ID を入れてください）' end
  from public.manager_auth m where m.role in ('ceo', 'gm') and (m.emp_id is null or m.emp_id::text = '')
union all
select 13, 'GM・CEO のメールのアカウント（v1143 から設定を変えられる人）', count(*)::text, case when count(*) > 0 then 'OK' else 'STOP（だれも変えられなくなります）' end
  from public.manager_auth m where m.role in ('ceo', 'gm')
order by 1
) x;

-- ===== v1144（deploy/secure-pii-v1144/1_確かめ_読むだけ.sql）=====
insert into all_pre select 'v1144', x.* from (
-- 読むだけ（v1144・2b-6）。関数 secure-state を v1144 にする前と、20261113090000_secure_emp_pii.sql を入れる「前」に、Supabase の SQL Editor で流す。何も書き換えない。
-- 生年月日・カードの番号・保険の中身・金額は出しません（人数だけ）。表をそのまま Claude に貼ってください。
select 1 as n, '従業員の表（employees）' as what, case when to_regclass('public.employees') is null then 'ない' else 'ある' end as value,
       case when to_regclass('public.employees') is null then 'STOP' else 'OK' end as ok
union all
select 2, 'app_state の決まり ss_secret（v1139〜v1142 の SQL）', count(*)::text, case when count(*) = 1 then 'OK（入っている）' else 'info（まだ。v1144 の SQL が一緒に入れます）' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname = 'ss_secret'
union all
-- 従業員の表に入っている個人の欄の人数（③ で emp_pii に写して従業員の表から消す）
select 3, '従業員の表に入っている人数（生年月日・カード・医療・歯科・保険料）',
       (select count(*) filter (where coalesce(e.data->>'dob', '') <> '') || '・' || count(*) filter (where coalesce(e.data->>'cardLast4', '') <> '')
               || '・' || count(*) filter (where e.data->'insurance' = 'true'::jsonb) || '・' || count(*) filter (where e.data->'dental' = 'true'::jsonb)
               || '・' || count(*) filter (where e.data ? 'insuranceAmt' and jsonb_typeof(e.data->'insuranceAmt') <> 'null')
          from public.employees e where e.data is not null and jsonb_typeof(e.data) = 'object'),
       'info'
union all
select 4, 'data がオブジェクトでない従業員の行（③ では変えない）',
       (select count(*) from public.employees e where e.data is null or jsonb_typeof(e.data) <> 'object')::text, 'info'
union all
select 5, 'emp_pii の行（v1144 の関数で直すとできる）',
       coalesce((select case when jsonb_typeof(s.value::jsonb) = 'object' then (select count(*) from jsonb_object_keys(s.value::jsonb))::text || ' 人・' || round(octet_length(s.value::text) / 1024.0)::text || ' KB'
                             else '形が違う（' || jsonb_typeof(s.value::jsonb) || '）' end
                   from public.app_state s where s.key::text = 'emp_pii'), 'まだない'),
       case when exists (select 1 from public.app_state s where s.key::text = 'emp_pii' and jsonb_typeof(s.value::jsonb) <> 'object') then 'STOP（オブジェクトでない。Claude に貼ってください）' else 'OK' end
union all
-- emp_pii にもある人で、従業員の表の値と違う人（v1144 の関数で直したあと、前の版の端末で同じ人の欄を直した）：③ では emp_pii の値が残る
select 6, 'emp_pii と従業員の表で値が違う人（③ では emp_pii の値が残る）',
       (select count(*) from public.employees e, public.app_state s
         where s.key::text = 'emp_pii' and jsonb_typeof(s.value::jsonb) = 'object' and jsonb_typeof(s.value::jsonb -> e.id::text) = 'object'
           and e.data is not null and jsonb_typeof(e.data) = 'object'
           and exists (select 1 from unnest(array['dob', 'cardLast4', 'insurance', 'dental', 'insuranceAmt']) k
                        where e.data ? k and (e.data -> k) is distinct from (s.value::jsonb -> e.id::text -> k)))::text,
       case when (select count(*) from public.employees e, public.app_state s
         where s.key::text = 'emp_pii' and jsonb_typeof(s.value::jsonb) = 'object' and jsonb_typeof(s.value::jsonb -> e.id::text) = 'object'
           and e.data is not null and jsonb_typeof(e.data) = 'object'
           and exists (select 1 from unnest(array['dob', 'cardLast4', 'insurance', 'dental', 'insuranceAmt']) k
                        where e.data ? k and (e.data -> k) is distinct from (s.value::jsonb -> e.id::text -> k))) = 0 then 'OK'
            else 'info（前の版の端末で直した人がいます。全部の端末を 1144 にしてから、もう一度直してください）' end
union all
select 7, '書くたびに外す見張り（employees_pii_strip_trg）',
       (select count(*) from pg_trigger t where t.tgrelid = 'public.employees'::regclass and t.tgname = 'employees_pii_strip_trg' and not t.tgisinternal)::text,
       case when (select count(*) from pg_trigger t where t.tgrelid = 'public.employees'::regclass and t.tgname = 'employees_pii_strip_trg' and not t.tgisinternal) = 1
            then 'info（もう入っている）' else 'OK（まだ）' end
union all
-- v1144 の直し（Codex #138 P1-1）：Head Chef も GM・CEO が確かめた写し（wr_people）で決める。①b の SQL がこの表に欄を足す
select 8, 'ワークセンターの権限の写し（wr_people）', case when to_regclass('public.wr_people') is null then 'ない' else 'ある' end,
       case when to_regclass('public.wr_people') is null then 'STOP（①b を流せません。Claude に）' else 'OK' end
union all
select 9, 'Head Chef（社員の表の肩書き・役割。在籍。CEO・GM・経理・事務Crew のアカウントの人を除く）',
       (select count(*) from public.employees e
         where (coalesce(e.role, '') = 'chef' or btrim(coalesce(e.title, '')) in ('Head Chef', 'Corporate Chef'))
           and coalesce(e.status, '') <> '退職' and coalesce(e.data->>'status', '') <> '退職' and coalesce(e.data->>'osDisabled', '') <> 'true'
           and not exists (select 1 from public.manager_auth m where m.emp_id::text = e.id::text and m.role in ('ceo', 'gm', 'office', 'office_crew')))::text,
       'info（①b のあと「承認・閲覧の権限の確かめ」で確かめるまで、この人たちは全員の個人の欄・全店の Career Score を見られません）'
) x;

-- ===== v1145（deploy/secure-grade-hist-v1145/1_確かめ_読むだけ.sql）=====
insert into all_pre select 'v1145', x.* from (
-- 読むだけ（v1145・2b-7）。関数 secure-state を v1145 にする前と、20261114090000_secure_grade_hist.sql を入れる「前」に、Supabase の SQL Editor で流す。
-- 何も書き換えない。グレード履歴の中身・社員の名前は出しません（あるか・数・大きさ・形だけ）。表をそのまま Claude に貼ってください。
-- 対象：グレード履歴（grade_hist。社員ごとのグレードの確定日・前後のグレード・前のグレードの期間の評価）。書いてよいのは GM・CEO（Moto さん 11/10）。
select 1 as n, 'app_state の表' as what, case when to_regclass('public.app_state') is null then 'ない' else 'ある' end as value,
       case when to_regclass('public.app_state') is null then 'STOP' else 'OK' end as ok
union all
select 2, 'app_state の RLS', case when c.relrowsecurity then 'ON' else 'OFF' end,
       case when c.relrowsecurity then 'OK' else 'info（OFF。v1145 の SQL が ON にして今までどおり読み書きできる決まりを足します）' end
  from pg_class c where c.oid = 'public.app_state'::regclass
union all
select 3, 'v1141・v1143 の決まり（ss_guard_ins・ss_guard_upd・ss_guard_del）', count(*)::text,
       case when count(*) = 0 then 'info（まだ。v1145 の SQL だけで v1141・v1143 の分も入ります）' else 'info（もう ' || count(*) || ' つ。v1145 の SQL はキーを足すだけ）' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname in ('ss_guard_ins', 'ss_guard_upd', 'ss_guard_del')
union all
-- 4：グレード履歴の行。社員の数・大きさ・形（関数 secure-state と同じ決まり：社員 ID → 記録（オブジェクトか空）の地図。キーは 200 字まで）。
-- 全体がオブジェクトでない行は、v1145 の関数では GM・CEO も保存できません（Claude に）。形の合わない記録は、そのままなら保存は止まりません（残る）
select 4, 'グレード履歴（grade_hist）',
       coalesce((select case when jsonb_typeof(a.value::jsonb) <> 'object' then '全体がオブジェクトでない（' || jsonb_typeof(a.value::jsonb) || '）'
                             else (select count(*) from jsonb_object_keys(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end))::text || ' 人・' || round(char_length(a.value::text) / 1000.0)::text || ' 千字・形の合わない記録 '
                                  || (select count(*) from jsonb_each(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end) e where char_length(e.key) > 200 or jsonb_typeof(e.value) not in ('object', 'null'))::text end
                   from public.app_state a where a.key = 'grade_hist'), '行なし'),
       case when (select jsonb_typeof(a.value::jsonb) from public.app_state a where a.key = 'grade_hist') <> 'object' then 'NG（全体がオブジェクトでない。Claude に）'
            when (select char_length(a.value::text) from public.app_state a where a.key = 'grade_hist') > 6000000 then 'NG（600 万字より大きい。v1145 の関数は書けません。Claude に）'
            when (select char_length(a.value::text) from public.app_state a where a.key = 'grade_hist') > 3000000 then 'info（300 万字より大きい。600 万字を超えると保存できなくなります。Claude に）'
            when coalesce((select count(*) from public.app_state a, jsonb_each(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end) e
                            where a.key = 'grade_hist' and (char_length(e.key) > 200 or jsonb_typeof(e.value) not in ('object', 'null'))), 0) > 0
              then 'info（形の合わない記録がある。GM・CEO の保存は止まりません（そのまま残る）。消すなら Claude に）'
            else 'OK' end
union all
-- PIN のログインで「GM」「CEO」と分かるのは、メールのアカウント（manager_auth）が社員と結ばれている人だけ（work-requests の whoami）。
-- 結ばれていない人は、v1145 の関数ではグレード履歴を変えられない（社員 ID を入れる：db/invoice-signin-emp-check.sql で確かめる）
select 5, 'GM・CEO のメールのアカウントのうち、社員と結ばれていないもの', count(*)::text,
       case when count(*) = 0 then 'OK' else 'info（その人は PIN のログインではグレード履歴を変えられません。manager_auth に社員 ID を入れてください）' end
  from public.manager_auth m where m.role in ('ceo', 'gm') and (m.emp_id is null or m.emp_id::text = '')
union all
select 6, 'GM・CEO のメールのアカウント（v1145 からグレード履歴・グレードが変わる変更ができる人）', count(*)::text, case when count(*) > 0 then 'OK' else 'STOP（だれも変えられなくなります）' end
  from public.manager_auth m where m.role in ('ceo', 'gm')
order by 1
) x;

-- ===== v1146（deploy/secure-tip-prep-v1146/1_確かめ_読むだけ.sql）=====
-- 読むだけ（v1146・2b-8）。関数 secure-state を v1146 にする前と、20261115090000_secure_tip_prep.sql を入れる「前」に、Supabase の SQL Editor で流す。
-- 何も書き換えない（最後に rollback）。Tip Rate・プレップの中身・社員の名前は出しません（あるか・数・大きさ・形だけ）。表をそのまま Claude に貼ってください。
-- 対象：Tip Rate の申請・決定（spl_tip_requests_<名前>・前の統合行 tip_requests）とプレップの時給の表・認定（prep_tables・prep_certs）。
-- 書いてよいのは今の画面で決められる人（Moto さん 11/10）。関数が決める（docs/SECURE_TIP_PREP_V1146_JA.md）。
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
insert into all_pre select 'v1146', n, what, value, ok from tp_pre;

-- ===== v1147（deploy/secure-tip-cf-v1147/1_確かめ_読むだけ.sql）=====
insert into all_pre select 'v1147', x.* from (
-- 読むだけ（v1147・2b-9）。関数 secure-state を v1147 にする前と、20261116090000_secure_tip_cf.sql を入れる「前」に、Supabase の SQL Editor で流す。何も書き換えない。
-- チップの額・人の名前・注意の中身は出しません（数だけ）。表をそのまま Claude に貼ってください。
with tip as (
  select s.key::text k, s.value::jsonb v from public.app_state s where left(s.key::text, 7) = 'tip_cf_' and length(s.key::text) > 7
), tip_rec as (
  select t.k, e.key d, e.value r from tip t, jsonb_each(case when jsonb_typeof(t.v) = 'object' then t.v else '{}'::jsonb end) e
), wn as (
  select s.key::text k, s.value::jsonb v from public.app_state s where left(s.key::text, 9) = 'warnings_' and length(s.key::text) > 9
), wn_rec as (
  select w.k, x from wn w, jsonb_array_elements(case when jsonb_typeof(w.v) = 'array' then w.v else '[]'::jsonb end) x
), sc_store as (   -- キーから読んだ店（Tip は tip_cf_<店>_<年>。形の合わないキーは店なし）
  select k, case when k ~ '^tip_cf_.+_[0-9]{4}$' then substring(k from '^tip_cf_(.+)_[0-9]{4}$') end st from tip
  union all select k, substr(k, 10) from wn
)
select 1 as n, 'app_state の表' as what, case when to_regclass('public.app_state') is null then 'ない' else 'ある' end as value,
       case when to_regclass('public.app_state') is null then 'STOP' else 'OK' end as ok
union all
select 2, 'v1139〜v1144 の SQL（決まり ss_secret）', count(*)::text, case when count(*) = 1 then 'OK（入っている）' else 'info（まだ。v1147 の SQL が一緒に入れます）' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname = 'ss_secret'
union all
select 3, 'app_state の RLS（ON なら v1139 以降の SQL が入っている）', case when c.relrowsecurity then 'ON' else 'OFF' end, 'info'
  from pg_class c where c.oid = 'public.app_state'::regclass
union all
-- Tip の期間の確定：行・記録の数と形（関数は形の合わない記録を書かない。読むのは、その店を見られる人）
select 4, 'Tip の期間の確定（tip_cf_）',
       (select count(*) from tip)::text || ' 行・オブジェクトでない行 ' || (select count(*) from tip where jsonb_typeof(v) <> 'object')::text
       || '・記録 ' || (select count(*) from tip_rec)::text
       || '（確定 ' || (select count(*) from tip_rec where jsonb_typeof(r) = 'object' and r->>'status' = '確定済み' and coalesce(r->>'_deleted', '') <> 'true')::text
       || '・解除 ' || (select count(*) from tip_rec where jsonb_typeof(r) = 'object' and r->'_deleted' = 'true'::jsonb)::text
       || '・形の合わない記録 ' || (select count(*) from tip_rec where not (d ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and jsonb_typeof(r) = 'object'
                                       and (r->'_deleted' = 'true'::jsonb or (r->>'status' = '確定済み' and r->>'from' = d and jsonb_typeof(r->'rows') = 'array'))))::text || '）'
       || '・店と年の形でないキー ' || (select count(*) from tip where k !~ '^tip_cf_.+_[0-9]{4}$')::text
       || '・200 字より長いキー ' || (select count(*) from tip where length(k) > 200)::text,
       case when (select count(*) from tip where jsonb_typeof(v) <> 'object' or length(k) > 200) > 0 then 'NG（Claude に貼ってください。関数はこの行を読み書きしません）'
            when (select count(*) from tip where k !~ '^tip_cf_.+_[0-9]{4}$') > 0 then 'info（形の合わないキーは CEO・GM・経理・事務Crew にだけ見え、だれも書けません）'
            else 'OK' end
union all
-- 注意ログ：行・記録の数と形（関数は足すだけを受ける。id の無い前の記録はそのまま読める）
select 5, '注意ログ（warnings_）',
       (select count(*) from wn)::text || ' 行・配列でない行 ' || (select count(*) from wn where jsonb_typeof(v) <> 'array')::text
       || '・記録 ' || (select count(*) from wn_rec)::text
       || '・id の無い記録 ' || (select count(*) from wn_rec where jsonb_typeof(x) = 'object' and not (x ? 'id'))::text
       || '・オブジェクトでない記録 ' || (select count(*) from wn_rec where jsonb_typeof(x) <> 'object')::text
       || '・200 字より長いキー ' || (select count(*) from wn where length(k) > 200)::text,
       case when (select count(*) from wn where jsonb_typeof(v) <> 'array' or length(k) > 200) > 0 then 'NG（Claude に貼ってください。関数はこの行に足せません）'
            when (select count(*) from wn_rec where jsonb_typeof(x) <> 'object') > 0 then 'info（Claude に貼ってください）'
            else 'OK' end
union all
-- 店の表に無い店の行：CEO・GM・経理（注意ログは事務Crew を除く）にだけ見える（今の画面でも店を選べない）
select 6, '店の表に無い店の行（CEO・GM・経理にだけ見える）',
       (select count(*) from sc_store x where x.st is null or x.st not in (select st.id::text from public.stores st))::text, 'info'
union all
-- 社員の表で AM・G2 以上・Head Chef・店長・リーダーなのに、GM・CEO の確かめ（ワークセンター › 承認・閲覧の権限の確かめ）がまだの人：
-- 関数 v1147 では、確かめるまで店のある範囲（Tip の期間の確定・注意ログ・応募者・Career Score の店の人）を何も見ない（自分の分だけ）。
-- 社員の表の役割・肩書き・店は公開の鍵で書けるので（Codex #141 6781928056 の P2-1）。G2 を確かめるには先に 1b の SQL（20261116080000）
select 7, '確かめがまだの AM・G2 以上・Head Chef・店長・リーダー（店の Tip の確定・注意ログ・応募者・Career Score を見られない）',
       (select count(*) from public.employees e
         where (coalesce(e.role, e.data->>'role', '') in ('am', 'g4', 'chef', 'sl', 'g2')
                or btrim(coalesce(e.title, e.data->>'title', '')) in ('Head Chef', 'Corporate Chef', 'Store Manager', 'Area Manager', 'Office Manager', 'Accountant', 'Customer Service Manager',
                  'Server Leader', 'Kitchen Leader', 'Operation Leader', 'Store Leader', 'Accounting Leader', 'Crew Leader', 'Office Crew Leader'))
           and coalesce(e.status, '') <> '退職' and coalesce(e.data->>'status', '') <> '退職' and coalesce(e.data->>'osDisabled', '') <> 'true'
           and not exists (select 1 from public.manager_auth m where m.emp_id::text = e.id::text and m.role in ('ceo', 'gm', 'office', 'office_crew'))
           and not exists (select 1 from public.wr_people w where w.emp_id = e.id::text and (w.role = 'am' or w.grade >= 2)))::text,
       case when (select count(*) from public.employees e
         where (coalesce(e.role, e.data->>'role', '') in ('am', 'g4', 'chef', 'sl', 'g2')
                or btrim(coalesce(e.title, e.data->>'title', '')) in ('Head Chef', 'Corporate Chef', 'Store Manager', 'Area Manager', 'Office Manager', 'Accountant', 'Customer Service Manager',
                  'Server Leader', 'Kitchen Leader', 'Operation Leader', 'Store Leader', 'Accounting Leader', 'Crew Leader', 'Office Crew Leader'))
           and coalesce(e.status, '') <> '退職' and coalesce(e.data->>'status', '') <> '退職' and coalesce(e.data->>'osDisabled', '') <> 'true'
           and not exists (select 1 from public.manager_auth m where m.emp_id::text = e.id::text and m.role in ('ceo', 'gm', 'office', 'office_crew'))
           and not exists (select 1 from public.wr_people w where w.emp_id = e.id::text and (w.role = 'am' or w.grade >= 2))) = 0 then 'OK'
            else 'info（1b の SQL のあと、GM・CEO が「承認・閲覧の権限の確かめ」で確かめると見られます。② の前に）' end
union all
-- Head Chef で、GM・CEO が確かめた写しに Head Chef の印（wr_people.chef）が無い人：全店ではなく自分の店と応援の店だけ（v1144 の Career Score と同じ）
select 8, 'Head Chef の印がまだの Head Chef（全店ではなく自分の店だけ）',
       (select count(*) from public.employees e
         where coalesce(e.role, e.data->>'role', '') = 'chef'
           and coalesce(e.status, '') <> '退職' and coalesce(e.data->>'status', '') <> '退職' and coalesce(e.data->>'osDisabled', '') <> 'true'
           and not exists (select 1 from public.wr_people w where w.emp_id = e.id::text and w.grade >= 4 and (to_jsonb(w)->>'chef') = 'true'))::text,
       'info（GM・CEO が「承認・閲覧の権限の確かめ」で Head Chef を確かめると全店）'
union all
-- 社員の表で事務Crew なのに、事務Crew のメールのアカウント（manager_auth）に結ばれていない人：Tip の期間の確定が見えなくなる
select 9, '事務Crew のアカウント（manager_auth）に結ばれていない事務Crew（Tip の確定が見えなくなる）',
       (select count(*) from public.employees e
         where coalesce(e.role, e.data->>'role', '') = 'office_crew'
           and coalesce(e.status, '') <> '退職' and coalesce(e.data->>'status', '') <> '退職' and coalesce(e.data->>'osDisabled', '') <> 'true'
           and not exists (select 1 from public.manager_auth m where m.emp_id::text = e.id::text and m.role in ('ceo', 'gm', 'office', 'office_crew')))::text,
       'info（manager_auth の emp_id を結ぶと見えます）'
union all
-- CEO・GM・経理・事務Crew のメールのアカウントで、社員 ID が社員の表に無い人：関数はその人に何も見せない（社員の行を消した人は止める）
select 10, 'CEO・GM・経理・事務Crew のアカウントで、社員 ID が社員の表に無い（何も見えなくなる）', count(*)::text,
       case when count(*) = 0 then 'OK' else 'info（manager_auth の emp_id を今の社員 ID に直すか、空にする。db/invoice-signin-emp-check.sql で確かめる）' end
  from public.manager_auth m
 where m.role in ('ceo', 'gm', 'office', 'office_crew') and coalesce(m.emp_id::text, '') <> ''
   and not exists (select 1 from public.employees e where e.id::text = m.emp_id::text)
union all
-- 1b の SQL（20261116080000）：GM・CEO が確かめた写しに G2 も入る（入れないと G2 は確かめられない＝店の Tip の確定・注意ログなどを見られない）
select 11, '写しに入れる人が G2 以上（1b の SQL 20261116080000）',
       case when to_regprocedure('public.wr_elevated(jsonb)') is null then 'ない'
            when pg_get_functiondef(to_regprocedure('public.wr_elevated(jsonb)')) like '%>= 2)%' then 'G2 以上' else 'G3 以上（まだ）' end,
       case when to_regprocedure('public.wr_elevated(jsonb)') is null then 'STOP（ワークセンターの申請の SQL がありません。Claude に）'
            when pg_get_functiondef(to_regprocedure('public.wr_elevated(jsonb)')) like '%>= 2)%' then 'OK'
            else 'NG（② の前に 1b の SQL を流し、GM・CEO が確かめてください）' end
union all
-- 社員の変更記録（10/29・deploy/employee-field-log）：関数 v1147 は、Tip Rate を決める人が自分の前の名前の申請を決めないよう、この表で前の名前を見る
-- （Codex #141 6781928056 の P2-2）。無いと Tip Rate の承認・却下・引き上げは止まる（500）
select 12, '社員の変更記録（employee_field_log・Tip Rate を決める人の本人かの確かめ）',
       case when to_regclass('public.employee_field_log') is null then 'ない'
            when exists (select 1 from pg_trigger t where t.tgrelid = 'public.employees'::regclass and t.tgname = 'employees_field_log_trg' and not t.tgisinternal) then 'ある・見張りあり'
            else 'ある・見張りなし' end,
       case when to_regclass('public.employee_field_log') is null then 'STOP（先に deploy/employee-field-log/ の SQL を流してください）'
            when exists (select 1 from pg_trigger t where t.tgrelid = 'public.employees'::regclass and t.tgname = 'employees_field_log_trg' and not t.tgisinternal) then 'OK'
            else 'NG（見張りがありません。deploy/employee-field-log/ の SQL を流し直してください）' end
order by n
) x;

-- ===== v1148（deploy/secure-grade-bonus-read-v1148/1_確かめ_読むだけ.sql）=====
insert into all_pre select 'v1148', x.* from (
-- 読むだけ（v1148・2b-10）。関数 secure-state を v1148 にする前と、20261117090000_secure_grade_bonus_read.sql を入れる「前」に、Supabase の SQL Editor で流す。何も書き換えない。
-- 人の名前・グレード・賞与の設定の中身は出しません（数だけ）。表をそのまま Claude に貼ってください。
with gb as (
  select s.key::text k, s.value::jsonb v from public.app_state s where s.key::text in ('grade_hist', 'bonus_eval_ovr', 'bonus_track')
), gb_rec as (   -- 記録（オブジェクトの行だけ。JSON の文字で書かれた行は関数が読み直す）
  select g.k, e.key ek from gb g, jsonb_each(case when jsonb_typeof(g.v) = 'object' then g.v else '{}'::jsonb end) e
), gb_id as (    -- 記録の社員 ID（関数 secure-state の gbEntryId と同じ。グレード履歴＝キーそのまま／賞与の個人設定＝最後の | の前／G3 の職種＝最初の | の後）
  select k, ek, case
           when k = 'grade_hist' then nullif(ek, '')
           when k = 'bonus_eval_ovr' and strpos(reverse(ek), '|') > 0 and length(ek) - strpos(reverse(ek), '|') > 0 then left(ek, length(ek) - strpos(reverse(ek), '|'))
           when k = 'bonus_track' and strpos(ek, '|') > 0 and strpos(ek, '|') < length(ek) then substr(ek, strpos(ek, '|') + 1)
         end id
    from gb_rec
), live as (     -- 在籍の社員（退職・OS を止めた人を除く）
  select e.id::text id from public.employees e
   where coalesce(e.status, '') <> '退職' and coalesce(e.data->>'status', '') <> '退職' and coalesce(e.data->>'osDisabled', '') <> 'true'
)
select 1 as n, 'app_state の表' as what, case when to_regclass('public.app_state') is null then 'ない' else 'ある' end as value,
       case when to_regclass('public.app_state') is null then 'STOP' else 'OK' end as ok
union all
select 2, 'v1139〜v1147 の SQL（決まり ss_secret）', count(*)::text, case when count(*) = 1 then 'OK（入っている）' else 'info（まだ。v1148 の SQL が一緒に入れます）' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname = 'ss_secret'
union all
select 3, 'app_state の RLS（ON なら v1139 以降の SQL が入っている）', case when c.relrowsecurity then 'ON' else 'OFF' end, 'info'
  from pg_class c where c.oid = 'public.app_state'::regclass
union all
-- 3 つの行の形と記録の数（関数は記録ごとに社員 ID を読み、見られる人の分だけ返す。形の合わない記録は CEO・GM（グレード履歴は経理・事務Crew も）にだけ見える）
select k3.o, k3.what,
       coalesce((select case jsonb_typeof(g.v) when 'object' then 'オブジェクト' when 'string' then 'JSON の文字' else jsonb_typeof(g.v) end from gb g where g.k = k3.k), '行なし')
       || '・記録 ' || (select count(*) from gb_rec r where r.k = k3.k)::text
       || '・社員 ID の読めない記録 ' || (select count(*) from gb_id i where i.k = k3.k and i.id is null)::text
       || '・社員の表に無い ID ' || (select count(*) from gb_id i where i.k = k3.k and i.id is not null and not exists (select 1 from public.employees e where e.id::text = i.id))::text
       || '・退職した人 ' || (select count(*) from gb_id i where i.k = k3.k and i.id is not null and exists (select 1 from public.employees e where e.id::text = i.id) and i.id not in (select id from live))::text,
       case when (select count(*) from gb g where g.k = k3.k and jsonb_typeof(g.v) not in ('object', 'string')) > 0 then 'NG（Claude に貼ってください。関数はこの行を読めません）'
            when (select count(*) from gb g where g.k = k3.k and jsonb_typeof(g.v) = 'string') > 0 then 'info（JSON の文字の行。関数は読み直して使います。記録の数は数えていません）'
            when (select count(*) from gb_id i where i.k = k3.k and i.id is null) > 0 then 'info（形の合わない記録は CEO・GM にだけ見えます。Claude に貼ってください）'
            else 'OK' end
  from (values (4, 'grade_hist', 'グレード履歴（grade_hist）'), (5, 'bonus_eval_ovr', '賞与の個人設定（bonus_eval_ovr）'), (6, 'bonus_track', 'G3 の職種（bonus_track）')) as k3(o, k, what)
union all
-- v1143・v1145 の SQL：この 3 つを書けるのは GM・CEO だけ（関数）。v1148 の SQL は読み書きとも止める（決まり ss_secret は書き込みも止める）ので、
-- 書く決まりがまだでもこの SQL だけで公開の鍵からは書けなくなる。ただ v1148 の SQL だけを戻すと、書く決まりが無ければまた書けるようになる。
-- （関数の中身の文字で確かめる。関数が無くても、この SQL は止まらない）
select 7, '書く決まり（v1143・v1145 の SQL：ss_guard_key に 3 つ）',
       case when to_regprocedure('public.ss_guard_key(text)') is null then 'ない'
            else (select count(*) from unnest(array['grade_hist', 'bonus_eval_ovr', 'bonus_track']) k
                   where pg_get_functiondef(to_regprocedure('public.ss_guard_key(text)')) like '%''' || k || '''%')::text || ' / 3' end,
       case when (select count(*) from unnest(array['grade_hist', 'bonus_eval_ovr', 'bonus_track']) k
                   where pg_get_functiondef(to_regprocedure('public.ss_guard_key(text)')) like '%''' || k || '''%') = 3 then 'OK（入っている）'
            else 'info（v1143・v1145 の SQL がまだ。v1148 の SQL だけでも公開の鍵からは読み書きできなくなります）' end
union all
-- 社員の表で事務Crew なのに、事務Crew のメールのアカウント（manager_auth）に結ばれていない人：
-- 関数 v1148 では、その人のグレード履歴は Career Score で見られる人と本人の分だけ（福利厚生の画面で全員のグレードが分からない）
select 8, '事務Crew のアカウント（manager_auth）に結ばれていない事務Crew（グレード履歴が全員分でなくなる）',
       (select count(*) from public.employees e
         where coalesce(e.role, e.data->>'role', '') = 'office_crew'
           and coalesce(e.status, '') <> '退職' and coalesce(e.data->>'status', '') <> '退職' and coalesce(e.data->>'osDisabled', '') <> 'true'
           and not exists (select 1 from public.manager_auth m where m.emp_id::text = e.id::text and m.role in ('ceo', 'gm', 'office', 'office_crew')))::text,
       'info（manager_auth の emp_id を結ぶと全員分）'
union all
-- CEO・GM・経理・事務Crew のメールのアカウントで、社員 ID が社員の表に無い人：関数はその人に何も見せない（v1142 からの決まり）
select 9, 'CEO・GM・経理・事務Crew のアカウントで、社員 ID が社員の表に無い（何も見えなくなる）', count(*)::text,
       case when count(*) = 0 then 'OK' else 'info（manager_auth の emp_id を今の社員 ID に直すか、空にする。db/invoice-signin-emp-check.sql で確かめる）' end
  from public.manager_auth m
 where m.role in ('ceo', 'gm', 'office', 'office_crew') and coalesce(m.emp_id::text, '') <> ''
   and not exists (select 1 from public.employees e where e.id::text = m.emp_id::text)
union all
-- 社員の表で AM・G2 以上・Head Chef・店長・リーダーなのに、GM・CEO の確かめがまだの人：Career Score と同じく自分の分だけ（v1147 の ① の 7 行目と同じ）
select 10, '確かめがまだの AM・G2 以上・Head Chef・店長・リーダー（グレード履歴・賞与の個人設定・G3 の職種も自分の分だけ）',
       (select count(*) from public.employees e
         where (coalesce(e.role, e.data->>'role', '') in ('am', 'g4', 'chef', 'sl', 'g2')
                or btrim(coalesce(e.title, e.data->>'title', '')) in ('Head Chef', 'Corporate Chef', 'Store Manager', 'Area Manager', 'Office Manager', 'Accountant', 'Customer Service Manager',
                  'Server Leader', 'Kitchen Leader', 'Operation Leader', 'Store Leader', 'Accounting Leader', 'Crew Leader', 'Office Crew Leader'))
           and coalesce(e.status, '') <> '退職' and coalesce(e.data->>'status', '') <> '退職' and coalesce(e.data->>'osDisabled', '') <> 'true'
           and not exists (select 1 from public.manager_auth m where m.emp_id::text = e.id::text and m.role in ('ceo', 'gm', 'office', 'office_crew'))
           and not exists (select 1 from public.wr_people w where w.emp_id = e.id::text and (w.role = 'am' or w.grade >= 2)))::text,
       'info（GM・CEO が「承認・閲覧の権限の確かめ」で確かめると、Career Score と同じ範囲）'
order by n
) x;

-- ===== v1151（deploy/change-signal-v1151/1_確かめ_読むだけ.sql）=====
insert into all_pre select 'v1151', x.* from (
-- 読むだけ（v1151・「変わった」の合図と変更の記録）。20261118090000_change_signal.sql を入れる「前」に、Supabase の SQL Editor で流す。
-- 何も変えません。STOP が 1 つでもあれば入れずに、表をそのまま Claude に貼ってください（名前・中身は出ません）。
with
t(n, what, value, ok) as (
  select 1, 'app_state・app_settings がある',
         (case when to_regclass('public.app_state') is not null then 'app_state ' else '' end) || (case when to_regclass('public.app_settings') is not null then 'app_settings' else '' end),
         case when to_regclass('public.app_state') is not null and to_regclass('public.app_settings') is not null then 'OK' else 'STOP' end
  union all
  select 2, 'v1139 の SQL（ss_secret_key）が入っている', case when to_regprocedure('public.ss_secret_key(text)') is not null then 'ある' else 'ない' end,
         case when to_regprocedure('public.ss_secret_key(text)') is not null then 'OK' else 'STOP' end
  union all
  select 3, 'app_state・app_settings の key・value の列',
         (select string_agg(c.table_name || '.' || c.column_name || ':' || c.data_type, ' ' order by c.table_name, c.column_name) from information_schema.columns c
           where c.table_schema = 'public' and c.table_name in ('app_state', 'app_settings') and c.column_name in ('key', 'value')),
         case when (select count(*) from information_schema.columns c where c.table_schema = 'public' and c.table_name in ('app_state', 'app_settings') and c.column_name in ('key', 'value')) = 4 then 'OK' else 'STOP' end
  union all
  select 4, 'マスターの表と主キー（無い表は見張らない）',
         (select string_agg(v.t || (case when to_regclass('public.' || v.t) is null then '（なし）'
                                        when exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = v.t and c.column_name = v.pk) then '.' || v.pk
                                        else '（' || v.pk || ' の列なし）' end), ' ' order by v.t)
            from (values ('stores', 'id'), ('employees', 'id'), ('ingredients', 'code'), ('recipes', 'id'), ('vendors', 'id'), ('categories', 'code')) v(t, pk)),
         case when exists (select 1 from (values ('stores', 'id'), ('employees', 'id'), ('ingredients', 'code'), ('recipes', 'id'), ('vendors', 'id'), ('categories', 'code')) v(t, pk)
                            where to_regclass('public.' || v.t) is not null
                              and not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = v.t and c.column_name = v.pk)) then 'STOP' else 'OK' end
  union all
  select 5, 'Realtime（supabase_realtime）', case when exists (select 1 from pg_publication where pubname = 'supabase_realtime') then 'ある' else 'ない' end,
         case when exists (select 1 from pg_publication where pubname = 'supabase_realtime') then 'OK' else 'info（合図は 60 秒ごとに読む。動きは同じ）' end
  union all
  select 6, 'すでに入っている（sync_signal・change_log）',
         (case when to_regclass('public.sync_signal') is not null then 'sync_signal ' else '' end) || (case when to_regclass('public.change_log') is not null then 'change_log' else '' end),
         case when to_regclass('public.sync_signal') is null and to_regclass('public.change_log') is null then 'OK（まだ）' else 'info（2 回流しても同じ）' end
  union all
  select 7, '同じ名前の表・関数がほかに無い（fp_*）',
         coalesce((select string_agg(p.proname, ' ' order by p.proname) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                    where s.nspname = 'public' and p.proname in ('fp_actor', 'fp_via', 'fp_sec_cat', 'fp_parts', 'fp_note', 'fp_sig_kv', 'fp_sig_rows')), 'なし'),
         case when to_regclass('public.change_log') is null
                   and exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('fp_actor', 'fp_via', 'fp_sec_cat', 'fp_parts', 'fp_note', 'fp_sig_kv', 'fp_sig_rows'))
              then 'STOP（ほかの関数と名前がぶつかる）' else 'OK' end
  union all
  select 8, '見張りの数（app_state・app_settings・マスター。名前は出さない）',
         (select string_agg(x.t || ':' || x.c, ' ' order by x.t) from (
            select c.relname t, count(*) c from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace s on s.oid = c.relnamespace
             where s.nspname = 'public' and not g.tgisinternal and c.relname in ('app_state', 'app_settings', 'stores', 'employees', 'ingredients', 'recipes', 'vendors', 'categories')
             group by c.relname) x),
         'info'
  union all
  select 9, '公開の鍵（anon）の時間の上限', coalesce((select array_to_string(r.rolconfig, ' ') from pg_roles r where r.rolname = 'anon'), '（設定なし）'), 'info（見張りはふだんの保存で数ミリ秒）'
  union all
  select 11, '行の一覧（app_state_index・v1098）', case when to_regprocedure('public.app_state_index(text[])') is not null then 'ある' else 'ない' end,
         case when to_regprocedure('public.app_state_index(text[])') is not null then 'OK' else 'info（無いと、機密の区分・まとめての合図のたびに app_state を全部読む。deploy/perf-v1098 で入れられる）' end
  union all
  select 10, 'app_state の行の数・いちばん大きい値（KB）',
         (select count(*)::text || ' 行・' || coalesce(round(max(pg_column_size(value)) / 1024.0)::text, '0') || ' KB' from public.app_state),
         'info'
)
select n, what, value, ok from t order by n
) x;

-- ===== v1152（deploy/secure-notifications-v1152/1_確かめ_読むだけ.sql）=====
insert into all_pre select 'v1152', x.* from (
-- 読むだけ（v1152・2b の最後）。関数 secure-state を v1152 にする前と、20261119090000_secure_notifications.sql を入れる「前」に、Supabase の SQL Editor で流す。何も書き換えない。
-- 通知の中身・人の名前は出しません（数だけ）。表をそのまま Claude に貼ってください。
with nt as (
  select s.value::jsonb v from public.app_state s where s.key::text = 'notifications'
), items as (   -- 通知（配列の要素。JSON の文字で書かれた行は関数が読み直す）
  select e.x from nt, jsonb_array_elements(case when jsonb_typeof(nt.v) = 'array' then nt.v else '[]'::jsonb end) e(x)
), live as (     -- 在籍の社員（退職・OS を止めた人を除く）
  select e.id::text id, coalesce(e.role, e.data->>'role', '') r from public.employees e
   where coalesce(e.status, '') <> '退職' and coalesce(e.data->>'status', '') <> '退職' and coalesce(e.data->>'osDisabled', '') <> 'true'
)
select 1 as n, 'app_state の表' as what, case when to_regclass('public.app_state') is null then 'ない' else 'ある' end as value,
       case when to_regclass('public.app_state') is null then 'STOP' else 'OK' end as ok
union all
select 2, 'v1139〜v1148 の SQL（決まり ss_secret）', count(*)::text, case when count(*) = 1 then 'OK（入っている）' else 'info（まだ。v1152 の SQL が一緒に入れます）' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname = 'ss_secret'
union all
select 3, 'app_state の RLS（ON なら v1139 以降の SQL が入っている）', case when c.relrowsecurity then 'ON' else 'OFF' end, 'info'
  from pg_class c where c.oid = 'public.app_state'::regclass
union all
-- 通知の行の形と数（関数は配列の要素を読み、宛先の人の分だけ返す。形の合わない行は空として扱い、次に足すときに置き換える）
select 4, '通知の行（notifications）の形・数',
       coalesce((select case jsonb_typeof(v) when 'array' then '配列' when 'string' then 'JSON の文字' else jsonb_typeof(v) end from nt), '行なし')
       || '・通知 ' || (select count(*) from items)::text
       || '・大きさ ' || coalesce((select pg_column_size(v)::text from nt), '0') || ' バイト',
       case when (select count(*) from nt where jsonb_typeof(v) not in ('array', 'string')) > 0 then 'NG（Claude に貼ってください。関数はこの行を空として扱います）'
            when (select count(*) from nt where jsonb_typeof(v) = 'string') > 0 then 'info（JSON の文字の行。関数は読み直して使います。数は数えていません）'
            else 'OK' end
union all
-- だれあてでもない通知（個人・店・役割のどれも無い）：今までも出した人にしか出ていない。関数も出した人にだけ返す
select 5, 'だれあてでもない通知（出した人にだけ見える）',
       (select count(*) from items where coalesce(x->>'toUser', '') = '' and coalesce(x->>'toStore', '') = ''
          and (jsonb_typeof(x->'toRoles') is distinct from 'array' or jsonb_array_length(x->'toRoles') = 0))::text, 'info'
union all
-- id の無い・形の合わない通知：関数は印（既読）を付けられない（そのまま残る）
select 6, 'id の無い・形の合わない通知', (select count(*) from items where jsonb_typeof(x) <> 'object' or coalesce(x->>'id', '') = '' or (x->>'id') !~ '^[A-Za-z0-9_:.-]{1,100}$')::text,
       case when (select count(*) from items where jsonb_typeof(x) <> 'object' or coalesce(x->>'id', '') = '' or (x->>'id') !~ '^[A-Za-z0-9_:.-]{1,100}$') = 0 then 'OK' else 'info（その通知に既読を付けられません。古くなると押し出されます）' end
union all
-- 社員の表で店長・リーダー・G4・Head Chef なのに、GM・CEO の確かめがまだの人：関数 v1152 では、その人には crew あての通知だけ（v1147 の ① の 7 行目と同じ考え）
select 7, '確かめがまだの店長・リーダー・G4・Head Chef（crew あての通知だけになる）',
       (select count(*) from live l
         where l.r in ('sl', 'g2', 'g4', 'chef')
           and not exists (select 1 from public.manager_auth m where m.emp_id::text = l.id and m.role in ('ceo', 'gm', 'office', 'office_crew'))
           and not exists (select 1 from public.wr_people w where w.emp_id = l.id and w.grade >= 2))::text,
       'info（GM・CEO が「承認・閲覧の権限の確かめ」で確かめると、今までどおり役割あての通知も届く）'
union all
-- 確かめた AM（wr_people の role am）でない AM：関数 v1152 では、AM あての通知が届かない（whoami が AM と見ない）
select 8, '確かめがまだの AM（AM あての通知が届かない）',
       (select count(*) from live l
         where l.r = 'am'
           and not exists (select 1 from public.manager_auth m where m.emp_id::text = l.id and m.role in ('ceo', 'gm', 'office', 'office_crew'))
           and not exists (select 1 from public.wr_people w where w.emp_id = l.id and w.role = 'am'))::text,
       'info（GM・CEO が確かめると届く）'
union all
-- v1151 の SQL（合図と変更の記録）：入っていれば、この SQL が機密の区分に通知を足す
select 9, 'v1151 の SQL（合図と変更の記録：fp_sec_cat）', case when to_regprocedure('public.fp_sec_cat(text)') is null then 'ない' else 'ある' end,
       case when to_regprocedure('public.fp_sec_cat(text)') is null then 'info（v1151 の SQL のあとに、この SQL をもう一度流す）' else 'OK' end
order by n
) x;

-- 最後の表：人の名前は出しません（Codex #146 6849760483 P2-1：前は v1142 の 11 行目が確かめがまだの人の名前をそのまま出していた）。
-- v1142 の 11 行目は数だけ。ほかの行も、社員の表の名前（2 文字以上・退職した人も）を含む値は伏せる（数で始まる「数：名前」は数だけ）。
select a.v, a.n, a.what,
       case when a.v = 'v1142' and a.n = 11
              then split_part(coalesce(a.value, ''), '：', 1) || case when strpos(coalesce(a.value, ''), '：') > 0 then '（名前は出しません）' else '' end
            when exists (select 1 from public.employees e
                          where char_length(btrim(coalesce(nullif(btrim(e.name), ''), e.data->>'name', ''))) >= 2
                            and strpos(coalesce(a.value, ''), btrim(coalesce(nullif(btrim(e.name), ''), e.data->>'name', ''))) > 0)
              then case when a.value ~ '^[0-9]+：' then split_part(a.value, '：', 1) || '（名前は出しません）' else '（名前を含むので出しません）' end
            else a.value end as value,
       a.ok
  from all_pre a order by a.v, a.n;
rollback;
