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
order by 1;
