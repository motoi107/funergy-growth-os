-- 中間レビュー：「店舗の管轄」で選べる人（読むだけ・何も変えない）
-- 20261018090000（v1076）のあとで使う。名前・役職だけを出す（メール・鍵は出さない）。
-- 「管轄で選べる」が true の人だけが、アプリの「店舗の管轄」に出る（GM・AM）。
select coalesce(e.name, m.name) as "名前", m.role as "中間レビューの役職", m.enabled as "有効",
  public.mr_member_role(m) as "いまの役職",
  coalesce(public.mr_member_role(m) in ('gm','am'), false) as "管轄で選べる",
  e.role as "社員の表の役職", e.status as "社員の表の在籍",
  case
    when not m.enabled then '止めてある'
    when m.role = 'am' and e.id is null then '社員の表に無い'
    when m.role = 'am' and coalesce(e.status, '') = '退職' then '社員の表で退職'
    when m.role = 'am' and coalesce(e.role, '') <> 'am' then '社員の表の役職が AM（am）ではない'
    when m.role in ('ceo','gm') and public.mr_member_role(m) is null then 'manager_auth で CEO・GM ではない'
    when public.mr_member_role(m) = 'ceo' then 'CEO は管轄に出ない（GM・AM だけ）'
    else '' end as "理由"
from public.mr_members m left join public.employees e on e.id::text = m.emp_id
where m.role in ('ceo','gm','am')
union all
select e.name, '（入っていない）', null, null, false, e.role, e.status,
  '社員の表では AM。中間レビューの利用者に入っていない（メールのアカウント → mid-review-add-member.sql）'
from public.employees e
where e.role = 'am' and coalesce(e.status, '') <> '退職'
  and not exists(select 1 from public.mr_members m where m.emp_id = e.id::text and m.enabled and m.role = 'am')
order by 5 desc, 2, 1;
