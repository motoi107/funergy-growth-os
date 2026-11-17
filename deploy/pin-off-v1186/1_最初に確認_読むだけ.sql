-- v1186 GM・CEO・経理は PIN でログインしない：入れる前に確かめる（読むだけ・何も変えない）。Supabase の SQL Editor に貼って Run。
-- 「STOP」が 1 つも無ければ 2 へ。4〜7 の行は名前を出します（Claude との会話にだけ貼る。公開の場には貼らない）。
with
 t as (select
   to_regprocedure('public.dl_email_login(jsonb)') is not null and to_regprocedure('public.dl_emp(text)') is not null as v1185,
   to_regclass('public.employees') is not null and to_regclass('public.manager_auth') is not null
     and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'manager_auth' and column_name in ('role','emp_id')) = 2 as tbl,
   to_regclass('public.dl_events') is not null and to_regclass('public.dl_trial') is not null as v1183,
   to_regprocedure('public.dl_pin_stage()') is not null as staged,
   to_regclass('public.dl_flags') is not null as flags),
 -- 在籍の GM・CEO・経理（社員の表の役割：列か中身のどちらかが ceo・gm・office。2 の SQL・auth-pin と同じ決め方）
 top_sql as (select $q$ with e as (select to_jsonb(t) as j, case when jsonb_typeof(to_jsonb(t)->'data') = 'object' then to_jsonb(t)->'data' else '{}'::jsonb end as d from public.employees t),
   top as (select e.j->>'id' as id, coalesce(nullif(btrim(e.j->>'name'), ''), e.d->>'name', e.j->>'id') as nm,
     coalesce(e.j->>'role', '') as rc, coalesce(e.d->>'role', '') as rd from e
     where (coalesce(nullif(e.j->>'role', ''), e.d->>'role', '') in ('ceo','gm','office') or coalesce(e.d->>'role', '') in ('ceo','gm','office'))
       and not (coalesce(e.j->>'status', '') = '退職' or coalesce(e.d->>'status', '') = '退職' or coalesce(e.d->>'osDisabled', '') = 'true')),
   linked as (select * from top where exists (select 1 from public.manager_auth m where m.emp_id::text = top.id and m.role in ('ceo','gm','office'))) $q$ as w),
 x4 as (select case when t.tbl then query_to_xml((select w from top_sql) || $q$ select count(*) as n, coalesce(string_agg(nm, '、' order by nm), '') as names from top where id not in (select id from linked) $q$, false, true, '') end as x from t),
 x5 as (select case when t.tbl and t.v1183 then query_to_xml((select w from top_sql) || $q$ select count(*) as n, coalesce(string_agg(nm, '、' order by nm), '') as names from linked where not exists (select 1 from public.dl_events v where v.kind = 'email_start' and v.result = 'ok' and v.emp_id = linked.id) $q$, false, true, '') end as x from t),
 x6 as (select case when t.tbl then query_to_xml((select w from top_sql) || $q$ select count(*) as n, coalesce(string_agg(nm || '（列 ' || coalesce(nullif(rc, ''), '空') || '・中身 ' || coalesce(nullif(rd, ''), '空') || '）', '、' order by nm), '') as names from top where rc <> '' and rd <> '' and rc <> rd $q$, false, true, '') end as x from t),
 x7 as (select case when t.tbl and t.v1183 then query_to_xml((select w from top_sql) || $q$ select count(*) as n, coalesce(string_agg(nm, '、' order by nm), '') as names from top where id in (select emp_id from public.dl_trial) and (rc = 'office' or rd = 'office' or exists (select 1 from public.manager_auth m where m.emp_id::text = top.id and m.role = 'office')) and not (rc in ('ceo','gm') or rd in ('ceo','gm')) $q$, false, true, '') end as x from t),
 x8 as (select case when t.flags then query_to_xml($q$ select coalesce((select case when value then '入っている（PIN を止めている）' else '外している（PIN で入れる）' end from public.dl_flags where key = 'top_pin_off'), 'まだ無い') as c $q$, false, true, '') end as x from t),
 v as (select (xpath('/row/n/text()', x4.x))[1]::text::int as n4, (xpath('/row/names/text()', x4.x))[1]::text as m4,
   (xpath('/row/n/text()', x5.x))[1]::text::int as n5, (xpath('/row/names/text()', x5.x))[1]::text as m5,
   (xpath('/row/n/text()', x6.x))[1]::text::int as n6, (xpath('/row/names/text()', x6.x))[1]::text as m6,
   (xpath('/row/n/text()', x7.x))[1]::text::int as n7, (xpath('/row/names/text()', x7.x))[1]::text as m7,
   (xpath('/row/c/text()', x8.x))[1]::text as s8 from x4, x5, x6, x7, x8)
select 1 as no, 'v1185 の SQL（メールとパスワードのログイン・dl_email_login）' as check_item,
  case when v1185 then 'OK' else 'STOP' end as result,
  case when v1185 then '' else '先に deploy/email-login-v1185 の ①②③ を流してください（メールのログインが無いと PIN を止められません）' end as detail from t
union all select 2, 'employees・manager_auth（role・emp_id）', case when tbl then 'OK' else 'STOP' end, case when tbl then '' else '表の形が違います。Claude に' end from t
union all select 3, 'もう入っているか（dl_pin_stage）', case when staged then 'もう入っています（2 をもう一度流すと、外したスイッチも入れ直します）' else 'まだ（初めて）' end, '' from t
union all select 4, '在籍の GM・CEO・経理で、メールのアカウントと結ばれていない人',
  case when n4 is null then '—' when n4 = 0 then 'OK（0 人）' else 'STOP（' || n4 || ' 人）' end,
  case when coalesce(n4, 0) = 0 then '' else m4 || '：PIN を止めると入れなくなります（2 も止まります）。その人のメールのアカウントを作って社員と結ぶ（Claude に）' end from t, v
union all select 5, 'そのうち、メールとパスワードでまだ一度も入っていない人',
  case when n5 is null then '—' when n5 = 0 then 'OK（0 人）' else '注意（' || n5 || ' 人）' end,
  case when coalesce(n5, 0) = 0 then '' else m5 || '：2 のあとは PIN で入れません。2 の前に一度、名前を選んでメールとパスワードで入ってもらう（パスワードが分からなければ管理者に）' end from t, v
union all select 6, '（参考）社員の表で、列と中身の役割が違う人',
  case when n6 is null then '—' when n6 = 0 then 'OK（0 人）' else 'info（' || n6 || ' 人）' end,
  case when coalesce(n6, 0) = 0 then '' else m6 || '：どちらかが GM・CEO・経理なら PIN を止めます。違っていれば社員の表を直す' end from t, v
union all select 7, '（参考）ログインの試し（端末＋PIN）に入っている経理',
  case when n7 is null then '—' when n7 = 0 then 'OK（0 人）' else 'info（' || n7 || ' 人）' end,
  case when coalesce(n7, 0) = 0 then '' else m7 || '：2 のあと、試しの端末では入れなくなり、メールとパスワードで入ります' end from t, v
union all select 8, 'スイッチ（dl_flags の top_pin_off）', coalesce(s8, 'まだ無い'), '' from t, v
order by 1;
