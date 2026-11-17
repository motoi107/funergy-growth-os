-- v1185 メールとパスワードのログイン（GM・CEO・経理）：入れる前に確かめる（読むだけ・何も変えない）。Supabase の SQL Editor に貼って Run。
-- 「STOP」が 1 つも無ければ 2 へ。名前・メール・パスワードは出さない（数だけ）。
with
 t as (select
   to_regclass('public.employees') is not null as emp,
   to_regclass('public.manager_auth') is not null as mgr,
   (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'manager_auth' and column_name in ('user_id','role','emp_id')) as mgr_cols,
   to_regclass('public.app_state') is not null as st,
   (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'app_state' and column_name in ('key','value','updated_at')) as st_cols,
   to_regprocedure('public.dl_stage()') is not null and to_regprocedure('public.dl_emp(text)') is not null
     and to_regprocedure('public.dl_log(text,text,uuid,text,text,text,text,text)') is not null as v1183,
   to_regprocedure('public.dl_email_stage()') is not null as staged)
select 1 as no, 'v1183 の SQL（ログインの試し・dl_stage など）' as check_item,
  case when v1183 then 'OK' else 'STOP' end as result,
  case when v1183 then '' else '先に deploy/device-login-v1183 の ①②③ を流してください' end as detail from t
union all select 2, 'employees・manager_auth（user_id・role・emp_id）', case when emp and mgr and mgr_cols = 3 then 'OK' else 'STOP' end, case when emp and mgr and mgr_cols = 3 then '' else '表の形が違います。Claude に' end from t
union all select 3, 'app_state（key・value・updated_at）', case when st and st_cols = 3 then 'OK' else 'STOP' end, case when st and st_cols = 3 then '' else '知らせを足す表の形が違います。Claude に' end from t
union all select 4, 'もう入っているか（dl_email_stage）', case when staged then 'もう入っています（2 をもう一度流しても同じ）' else 'まだ（初めて）' end, '' from t
union all select 5, 'GM・CEO・経理のメールのアカウント（manager_auth の ceo・gm・office）',
  case when mgr and mgr_cols = 3 then (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.manager_auth where role in (''ceo'',''gm'',''office'')', false, true, '')))[1]::text else '—' end,
  '0 なら、名前を選んでもメールとパスワードでは入れません（PIN で入ります）' from t
union all select 6, 'そのうち社員の行と結ばれていない数（emp_id が空・社員の表に無い）',
  case when emp and mgr and mgr_cols = 3 then (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.manager_auth m where m.role in (''ceo'',''gm'',''office'') and (coalesce(m.emp_id::text, '''') = '''' or not exists (select 1 from public.employees e where e.id::text = m.emp_id::text))', false, true, '')))[1]::text else '—' end,
  '0 でなければ、その人はメールで入れません（「このメールでは入れません」）。管理者セキュアページと同じく emp_id を入れる（Claude に）' from t
union all select 7, '知らせの行（app_state の notifications）の形',
  case when st and st_cols = 3 then (xpath('/row/c/text()', query_to_xml('select coalesce((select case when jsonb_typeof(value::jsonb) = ''array'' then ''OK（配列）'' when jsonb_typeof(value::jsonb) = ''string'' then ''OK（文字の形）'' else ''注意：配列でない'' end from public.app_state where key = ''notifications''), ''OK（まだ無い）'') as c', false, true, '')))[1]::text else '—' end,
  '「注意」なら新しい端末の知らせを足せません（ログインはできます・Claude に）' from t
order by 1;
