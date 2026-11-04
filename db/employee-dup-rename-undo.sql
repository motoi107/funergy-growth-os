-- 書く（元に戻す）。db/employee-dup-rename.sql で名前の後ろに付けた「（重複）」を外す（社員の表の列 name と data の name）。
-- want の ID は db/employee-dup-rename.sql に入れたものと同じにする。入れ替えずに流しても何も変わらない。
-- 外すのは、退職のままで、名前が「（重複）」で終わり、列の name と data の name が同じ記録だけ。状態・ほかの欄は変えない。
-- 外すと同じ名前の記録がまた 2 つになり、その名前の Career Score は v1140 の関数では CEO・GM にだけ届く（前の状態）。2 回流しても同じ。
with want(id) as (values
  ('（退職した記録の ID）'),
  ('（退職した記録の ID）')
), cand as (
  select w.id, e.name,
         case
           when e.id is null then '社員の表に無い'
           when e.data is null or jsonb_typeof(e.data) <> 'object' then '社員の表の中身（data）が無い'
           when coalesce(nullif(e.data->>'status', ''), e.status, '') <> '退職' then '退職していない'
           when e.name not like '%（重複）' then '付いていない'
           when coalesce(e.data->>'name', e.name) is distinct from e.name then '列の name と data の name が違う'
         end as why
    from (select distinct id from want) w
    left join public.employees e on e.id::text = w.id
), upd as (
  update public.employees e
     set name = left(e.name, length(e.name) - length('（重複）')),
         data = e.data || jsonb_build_object('name', left(e.name, length(e.name) - length('（重複）')))
    from cand c
   where c.why is null and e.id::text = c.id
  returning e.id::text as id, e.name as new_name
)
select c.id as "ID", c.name as "前の名前", u.new_name as "新しい名前",
       case when u.id is not null then '戻した' else '戻さない：' || c.why end as "結果"
  from cand c left join upd u on u.id = c.id
 order by c.id;
