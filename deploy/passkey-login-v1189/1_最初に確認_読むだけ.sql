-- v1189 パスキーとメールのコードのログイン：入れる前に確かめる（読むだけ・何も変えない）。Supabase の SQL Editor に貼って Run。
-- 「STOP」が 1 つも無ければ 2 へ。名前・メールは出さない（数だけ）。
with
 t as (select
   to_regprocedure('public.dl_pin_stage()') is not null and to_regprocedure('public.dl_email_login(jsonb)') is not null as v1186,
   to_regprocedure('public.dl_pk_stage()') is not null as staged,
   to_regclass('public.manager_auth') is not null and to_regclass('public.employees') is not null as base,
   to_regclass('public.dl_devices') is not null and to_regclass('public.dl_invites') is not null and to_regclass('public.dl_trial') is not null as v1183,
   to_regclass('public.dl_mail') is not null as mail_tb),
 stg as (select case when to_regprocedure('public.dl_pin_stage()') is not null
   then (xpath('/row/c/text()', query_to_xml('select public.dl_pin_stage()::text as c', false, true, '')))[1]::text::int end as st)
select 1 as no, 'v1186 の SQL（GM・CEO・経理は PIN でログインしない・20261206＋20261207）' as check_item,
  case when (select v1186 from t) and coalesce((select st from stg), 0) >= 2 then 'OK' else 'STOP' end as result,
  case when (select v1186 from t) and coalesce((select st from stg), 0) >= 2 then '' else '先に deploy/pin-off-v1186 の ② を流してください（20261207 も）' end as detail
union all select 2, 'もう入っているか（dl_pk_stage）',
  case when (select staged from t) then 'もう入っています（2 をもう一度流しても同じ）' else 'まだ（初めて）' end, ''
union all select 3, 'GM のメールのアカウント（manager_auth の gm・社員と結ばれている）',
  case when not (select base from t) then 'STOP'
       else (xpath('/row/c/text()', query_to_xml('select case when count(*) = 0 then ''STOP（0 人）'' else ''OK（'' || count(*) || '' 人）'' end as c from public.manager_auth m where m.role = ''gm'' and exists (select 1 from public.employees e where e.id::text = m.emp_id::text)', false, true, '')))[1]::text end,
  'ログインの方式を変える・送り手のメールをつなぐのは GM だけ（管理者セキュアページと同じメールとパスワードで）。0 人なら Claude に'
union all select 4, 'ログインの試し（v1183）で、いま使える端末・招待',
  case when not (select v1183 from t) then '—'
       else (xpath('/row/c/text()', query_to_xml('select ''info（端末 '' || (select count(*) from public.dl_devices where revoked_at is null) || ''・招待 '' || (select count(*) from public.dl_invites where used_at is null and revoked_at is null) || ''・試す人 '' || (select count(*) from public.dl_trial) || ''）'' as c', false, true, '')))[1]::text end,
  '2 を流すと止まります（7A）。その人たちは今までどおり名前を選んで PIN で入る'
union all select 5, '送り手のメール（dl_mail）',
  case when not (select mail_tb from t) then 'まだ（2 のあと 4_送り手_SQL.sql）'
       else (xpath('/row/c/text()', query_to_xml('select case when coalesce(from_addr, '''') = '''' then ''まだ（4_送り手_SQL.sql）'' when state = ''ok'' then ''つながっている'' else ''決まっている・まだつないでいない'' end as c from public.dl_mail where id = 1', false, true, '')))[1]::text end,
  ''
order by 1;
