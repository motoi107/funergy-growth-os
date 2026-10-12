-- 中間レビュー：入れる前の確認（読むだけ。何も書き換えません）
-- すべての行が OK になってから、supabase/migrations/20261012090000_mid_review.sql を流してください。
-- 中間レビューは社員の表（employees）と店舗の表（stores）を「読むだけ」で使います（AM の退職・異動・担当替えで入れなくするため）。
with c as (
  select table_name, column_name from information_schema.columns where table_schema = 'public'
)
select 'manager_auth (user_id, role, emp_id)' as check_name,
  (select count(*) from c where table_name = 'manager_auth' and column_name in ('user_id','role','emp_id'))::text as value,
  case when (select count(*) from c where table_name = 'manager_auth' and column_name in ('user_id','role','emp_id')) = 3 then 'OK' else 'NG：manager_auth の列が足りない' end as result
union all select 'employees (id, name, role, status)',
  (select count(*) from c where table_name = 'employees' and column_name in ('id','name','role','status'))::text,
  case when (select count(*) from c where table_name = 'employees' and column_name in ('id','name','role','status')) = 4 then 'OK' else 'NG：社員の表の列が足りない' end
union all select 'stores (id, am)',
  (select count(*) from c where table_name = 'stores' and column_name in ('id','am'))::text,
  case when (select count(*) from c where table_name = 'stores' and column_name in ('id','am')) = 2 then 'OK' else 'NG：店舗の表の列が足りない' end
union all select 'employees.id is unique',
  (select count(*) from (select id from public.employees group by id having count(*) > 1) x)::text,
  case when (select count(*) from (select id from public.employees group by id having count(*) > 1) x) = 0 then 'OK' else 'NG：同じ社員 ID が 2 行以上' end
union all select 'auth.users',
  (to_regclass('auth.users') is not null)::text, case when to_regclass('auth.users') is not null then 'OK' else 'NG' end
union all select 'mid-review tables already there',
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'
    and c.relname in ('mr_settings','mr_members','mr_stores','mr_reviews','mr_submissions','mr_replies','mr_events'))::text,
  case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'
    and c.relname in ('mr_settings','mr_members','mr_stores','mr_reviews','mr_submissions','mr_replies','mr_events')) = 0 then 'OK（まだ無い）' else 'NG：もう入っている（流し直さない）' end
union all select 'ceo / gm in manager_auth', (select count(*)::text from public.manager_auth where role in ('ceo','gm')),
  case when exists(select 1 from public.manager_auth where role in ('ceo','gm')) then 'OK' else 'NG：CEO・GM のメールのアカウントが無い' end
union all select 'employees with role am', (select count(*)::text from public.employees where role = 'am' and coalesce(status, '') <> '退職'),
  'OK（参考：AM の人数。G4 の店長は数えない）';
