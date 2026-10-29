-- 従業員の変更記録が入ったかを確かめる（読むだけ・何も変えない）。どの行も「OK」なら入っています。
select '記録の表がある' as "確かめること",
 case when to_regclass('public.employee_field_log') is not null then 'OK' else 'NG（1_追加のSQL がまだ）' end as "結果"
union all
select '記録の表は公開の鍵で読めない・書けない',
 case when to_regclass('public.employee_field_log') is null then 'NG（表が無い）'
  when (select relrowsecurity from pg_class where oid = to_regclass('public.employee_field_log'))
   and not has_table_privilege('anon', 'public.employee_field_log', 'select') and not has_table_privilege('anon', 'public.employee_field_log', 'insert')
   and not has_table_privilege('authenticated', 'public.employee_field_log', 'select') and not has_table_privilege('authenticated', 'public.employee_field_log', 'insert')
  then 'OK' else 'NG（Claude に）' end
union all
select '従業員の表の見張りが動いている',
 case when exists(select 1 from pg_trigger where tgrelid = 'public.employees'::regclass and tgname = 'employees_field_log_trg' and tgenabled <> 'D')
  then 'OK' else 'NG（1_追加のSQL がまだ）' end
union all
select '退職の守り（v1085）もそのまま',
 case when exists(select 1 from pg_trigger where tgrelid = 'public.employees'::regclass and tgname = 'employees_status_guard_trg' and tgenabled <> 'D')
  then 'OK' else '無い（v1085 の SQL を入れていないなら、そのままで大丈夫）' end
union all
select 'これまでの記録の数',
 case when to_regclass('public.employee_field_log') is null then '—' else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.employee_field_log', false, true, '')))[1]::text || ' 行' end;
