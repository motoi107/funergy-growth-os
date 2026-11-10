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
-- 社員の表で AM・G4・Head Chef なのに、GM・CEO の確かめ（ワークセンター › 承認・閲覧の権限の確かめ）がまだの人：
-- 確かめるまで、注意ログを記録できない（読むのと Tip の確定は自分の店と応援の店だけ）
select 7, '確かめがまだの AM・G4・Head Chef（注意ログを記録できない）',
       (select count(*) from public.employees e
         where (coalesce(e.role, e.data->>'role', '') in ('am', 'g4', 'chef') or btrim(coalesce(e.title, e.data->>'title', '')) in ('Head Chef', 'Corporate Chef'))
           and coalesce(e.status, '') <> '退職' and coalesce(e.data->>'status', '') <> '退職' and coalesce(e.data->>'osDisabled', '') <> 'true'
           and not exists (select 1 from public.manager_auth m where m.emp_id::text = e.id::text and m.role in ('ceo', 'gm', 'office', 'office_crew'))
           and not exists (select 1 from public.wr_people w where w.emp_id = e.id::text and (w.role = 'am' or w.grade >= 4)))::text,
       case when (select count(*) from public.employees e
         where (coalesce(e.role, e.data->>'role', '') in ('am', 'g4', 'chef') or btrim(coalesce(e.title, e.data->>'title', '')) in ('Head Chef', 'Corporate Chef'))
           and coalesce(e.status, '') <> '退職' and coalesce(e.data->>'status', '') <> '退職' and coalesce(e.data->>'osDisabled', '') <> 'true'
           and not exists (select 1 from public.manager_auth m where m.emp_id::text = e.id::text and m.role in ('ceo', 'gm', 'office', 'office_crew'))
           and not exists (select 1 from public.wr_people w where w.emp_id = e.id::text and (w.role = 'am' or w.grade >= 4))) = 0 then 'OK'
            else 'info（GM・CEO が「承認・閲覧の権限の確かめ」で確かめると記録できます）' end
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
order by n;
