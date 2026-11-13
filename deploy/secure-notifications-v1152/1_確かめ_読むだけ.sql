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
order by n;
