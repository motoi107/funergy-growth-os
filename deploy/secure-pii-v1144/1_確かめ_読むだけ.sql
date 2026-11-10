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
       'info（①b のあと「承認・閲覧の権限の確かめ」で確かめるまで、この人たちは全員の個人の欄・全店の Career Score を見られません）';
