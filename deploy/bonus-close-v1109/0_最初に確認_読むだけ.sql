-- v1109 ボーナスの締め：入れる前の確認（読むだけ・何も変えません）。結果の表をそのまま Claude に貼ってください（名前・メールは出ません）。
select 'manager_auth (role, user_id, emp_id)' as check_item,
  case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'manager_auth' and column_name in ('role','user_id','emp_id')) = 3 then 'OK' else 'STOP' end as result
union all
select 'employees (id, name)',
  case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'employees' and column_name in ('id','name')) = 2 then 'OK' else 'STOP' end
union all
select 'bc_ tables not yet made (0 = first time)',
  (select count(*)::text from information_schema.tables where table_schema = 'public' and table_name in ('bc_quarters','bc_versions','bc_adjust','bc_events'))
union all
select 'accounts that can write (GM / CEO)', (select count(*)::text from public.manager_auth where role in ('gm','ceo'))
union all
select 'accounts that can read (accounting)', (select count(*)::text from public.manager_auth where role = 'office');
