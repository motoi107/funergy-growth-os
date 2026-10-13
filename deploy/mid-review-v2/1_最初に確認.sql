-- 中間レビュー：入れる前の確認（読むだけ。何も書き換えません）
-- すべての行が OK（または参考）になってから流してください。
--   はじめて入れるとき：20261012090000_mid_review.sql → 20261013090000_mid_review_fixes.sql → 20261015090000_mid_review_v2.sql
--   v1066／v1068 が入っているとき：20261015090000_mid_review_v2.sql だけ
-- 中間レビューは社員の表（employees）と店舗の表（stores）を「読むだけ」で使います（候補を出す・退職や役職の変更で入れなくするため）。
with c as (
  select table_name, column_name from information_schema.columns where table_schema = 'public'
), mr as (
  select count(*) n from pg_class k join pg_namespace s on s.oid = k.relnamespace where s.nspname = 'public' and k.relkind = 'r'
    and k.relname in ('mr_settings','mr_members','mr_stores','mr_reviews','mr_submissions','mr_replies','mr_events')
)
select 'manager_auth (user_id, role, emp_id)' as check_name,
  (select count(*) from c where table_name = 'manager_auth' and column_name in ('user_id','role','emp_id'))::text as value,
  case when (select count(*) from c where table_name = 'manager_auth' and column_name in ('user_id','role','emp_id')) = 3 then 'OK' else 'NG：manager_auth の列が足りない' end as result
union all select 'employees (id, name, role, status)',
  (select count(*) from c where table_name = 'employees' and column_name in ('id','name','role','status'))::text,
  case when (select count(*) from c where table_name = 'employees' and column_name in ('id','name','role','status')) = 4 then 'OK' else 'NG：社員の表の列が足りない' end
union all select 'employees.title (Head Chef・入力担当の候補)',
  (select count(*) from c where table_name = 'employees' and column_name = 'title')::text,
  case when exists(select 1 from c where table_name = 'employees' and column_name = 'title') then 'OK' else 'NG：社員の表に title（肩書き）の列が無い（v2 は流せない）' end
union all select 'stores (id, am)',
  (select count(*) from c where table_name = 'stores' and column_name in ('id','am'))::text,
  case when (select count(*) from c where table_name = 'stores' and column_name in ('id','am')) = 2 then 'OK' else 'NG：店舗の表の列が足りない' end
union all select 'employees.id is unique',
  (select count(*) from (select id from public.employees group by id having count(*) > 1) x)::text,
  case when (select count(*) from (select id from public.employees group by id having count(*) > 1) x) = 0 then 'OK' else 'NG：同じ社員 ID が 2 行以上' end
union all select 'auth.users',
  (to_regclass('auth.users') is not null)::text, case when to_regclass('auth.users') is not null then 'OK' else 'NG' end
union all select 'mid-review tables (v1066)', (select n from mr)::text,
  case (select n from mr) when 0 then 'OK（まだ無い：20261012090000 → 20261013090000 → 20261015090000 の順に流す）'
   when 7 then 'OK（入っている：この上に 20261015090000 を流す）' else 'NG：表が途中まで（Claude に相談）' end
union all select 'mid-review v2 already there',
  exists(select 1 from c where table_name = 'mr_stores' and column_name = 'input_emp')::text,
  case when exists(select 1 from c where table_name = 'mr_stores' and column_name = 'input_emp') then 'OK（もう入っている：流し直しても同じ）' else 'OK（まだ）' end
union all select 'the same employee enabled twice in mr_members',
  case when to_regclass('public.mr_members') is null then '0' else
    substring(query_to_xml('select count(*) as n from (select emp_id from public.mr_members where enabled and coalesce(emp_id, '''') <> '''' group by emp_id having count(*) > 1) x',
      false, true, '')::text from '<n>([0-9]+)</n>') end,
  case when to_regclass('public.mr_members') is null then 'OK'
   when substring(query_to_xml('select count(*) as n from (select emp_id from public.mr_members where enabled and coalesce(emp_id, '''') <> '''' group by emp_id having count(*) > 1) x',
      false, true, '')::text from '<n>([0-9]+)</n>') = '0' then 'OK' else 'NG：同じ社員の有効な利用者が 2 行以上（片方を止めてから流す）' end
union all select 'ceo / gm in manager_auth', (select count(*)::text from public.manager_auth where role in ('ceo','gm')),
  case when exists(select 1 from public.manager_auth where role in ('ceo','gm')) then 'OK' else 'NG：CEO・GM のメールのアカウントが無い' end
union all select 'employees with role am', (select count(*)::text from public.employees where role = 'am' and coalesce(status, '') <> '退職'),
  'OK（参考：AM の人数。G4 の店長は数えない）'
union all select 'Head Chef / Corporate Chef in the employee master',
  (select count(*)::text from public.employees e where coalesce(e.status, '') <> '退職'
    and (e.role = 'chef' or btrim(coalesce(to_jsonb(e)->>'title', '')) in ('Head Chef','Corporate Chef'))),
  'OK（参考：担当・閲覧設定で「全店を見る」に足せる人の数）'
union all select 'input candidates in the employee master',
  (select count(*)::text from public.employees e where coalesce(e.status, '') <> '退職'
    and (btrim(coalesce(to_jsonb(e)->>'title', '')) in ('Server Leader','Kitchen Leader','Operation Leader','Store Leader','Store Manager','Head Chef','Area Manager','General Manager')
     or e.role in ('am','gm'))),
  'OK（参考：入力担当に選べる人の数）';
