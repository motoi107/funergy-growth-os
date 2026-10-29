-- 従業員の変更記録を見る（読むだけ・何も変えない・2026-10-29）
-- 名前・役割・肩書き・権限・店・応援店・Tip Rate（評価係数 coef）・Toast での名前（別名 toastAlias_…）が、いつ・どう変わったか。
-- 新しい順。下の 30 を変えると日数を変えられる。特定の人だけ見るときは、下の emp の行に名前の一部を入れる（例 'Sample'）。
-- 見方：
--   鍵 … anon＝アプリ（公開の鍵）／service_role＝サーバー／admin＝SQL Editor。アプリからの変更は、正しい操作も、アプリを改変した
--        書き込みも anon になる（だれが押したかは分からない）。心当たりの無い変更（とくに別名・Tip Rate）があれば Claude に。
--   別名 … 前 → 後 の「n」が Toast の名前、「from」がこの日の打刻から、「off」が外した印、「store」が店ごとの別名の店、「by」がアプリの記録の名前。
--          アプリを改変した書き込みでは by が空・いつもと違う人のことがある。
-- 元に戻すとき：その行の「記録 ID」を Claude に伝えてください（戻す SQL を渡します）。
with p as (select 30 as days, '' as emp)
select l.id as "記録 ID",
 to_char(l.at at time zone 'Pacific/Honolulu', 'YYYY-MM-DD HH24:MI:SS') as "時刻（ハワイ）",
 coalesce(l.emp_name, '') || ' [' || l.emp_id || ']' as "従業員",
 case when l.field like 'toastAlias\_%' then '別名 ' || substr(l.field, 12)
  when l.field = 'coef' then 'Tip Rate（評価係数）' when l.field = 'name' then '名前' when l.field = 'role' then '役割'
  when l.field = 'title' then '肩書き' when l.field = 'perms' then '権限' when l.field = 'store' then '店' when l.field = 'support' then '応援店'
  else l.field end as "欄",
 case l.op when 'insert' then '新しい人' when 'delete' then '行を消した' else '変更' end as "種類",
 coalesce(left(l.old_value::text, 200), '（無し）') as "前",
 coalesce(left(l.new_value::text, 200), '（無し）') as "後",
 l.writer as "鍵",
 coalesce(l.who, '') as "ログインの印"
from public.employee_field_log l, p
where l.at > now() - make_interval(days => p.days)
 and (p.emp = '' or coalesce(l.emp_name, '') ilike '%' || p.emp || '%' or l.emp_id = p.emp)
order by l.at desc, l.id desc
limit 500;
