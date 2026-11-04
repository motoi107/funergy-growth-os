-- 書く（Supabase の SQL Editor で 1 回）。同じ人の記録が 2 つあり、片方が「退職」になっているとき、退職した記録の名前の後ろに「（重複）」を付ける。
-- 目的：Career Score は名前で分けているので、同じ名前の記録が 2 つあると、関数 secure-state（v1140）はその名前の点・申請・履歴を CEO・GM にしか届けない
--       （本人・その店のリーダーにも届かない）。退職した重複の記録の名前を変えると、在籍の記録だけがその名前を持つようになる。
-- 使い方：下の want の ID を、db/cs-same-name-check.sql の結果の「退職」の行の ID に入れ替える（1 行に 1 つ）。入れ替えずに流しても何も変わらない。
-- 変えるのは、次をすべて満たす記録の名前だけ（社員の表の列 name と data の name を同じに）：
--   ・退職（data の status、無ければ列の status が「退職」）
--   ・同じ名前の在籍の記録（退職でも OS 無効でもない）がほかにある
--   ・名前の後ろにまだ「（重複）」が付いていない・列の name と data の name が同じ
--   ・GM・CEO が確かめた写し（wr_people）にこの ID の行が無い（あると、その名前がまだ残るため。そのときは Claude に）
-- 変えないもの：在籍・退職の状態・退職日・社員番号・Career Score・成長カルテ・Tip・勤怠・退職手続きの記録（どれも名前のほうを残す）。
-- 名前の変更は employee_field_log（10/29 の変更記録・writer＝admin）に残る。2 回流しても同じ（2 回目は「もう付いている」）。元に戻すときは db/employee-dup-rename-undo.sql。
with want(id) as (values
  ('（退職した記録の ID）'),
  ('（退職した記録の ID）')
), cand as (
  select w.id, e.name,
         case
           when e.id is null then '社員の表に無い'
           when e.data is null or jsonb_typeof(e.data) <> 'object' then '社員の表の中身（data）が無い'
           when coalesce(nullif(e.data->>'status', ''), e.status, '') <> '退職' then '退職していない'
           when e.name like '%（重複）' then 'もう付いている'
           when coalesce(e.data->>'name', e.name) is distinct from e.name then '列の name と data の name が違う'
           when exists (select 1 from public.wr_people p where p.emp_id::text = e.id::text) then 'GM・CEO が確かめた写しがある（Claude に）'
           when not exists (select 1 from public.employees a
                             where a.name = e.name and a.id::text <> e.id::text and not public.emp_blocked_of(a.status, a.data)) then '同じ名前の在籍の記録が無い'
         end as why
    from (select distinct id from want) w
    left join public.employees e on e.id::text = w.id
), upd as (
  update public.employees e
     set name = e.name || '（重複）',
         data = e.data || jsonb_build_object('name', e.name || '（重複）')
    from cand c
   where c.why is null and e.id::text = c.id
  returning e.id::text as id, e.name as new_name
)
select c.id as "ID", c.name as "前の名前", u.new_name as "新しい名前",
       case when u.id is not null then '変えた' else '変えない：' || c.why end as "結果"
  from cand c left join upd u on u.id = c.id
 order by c.id;
