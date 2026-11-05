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
order by n;
