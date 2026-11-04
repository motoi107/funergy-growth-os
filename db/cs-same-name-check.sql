-- 同じ名前の人を 1 人ずつ見る（読むだけ・何も変えない・2026-11-04・v1140）
-- deploy/secure-cs-v1140/1_確かめ_読むだけ.sql の 9 行目（同じ名前の人）に名前が出たときに流す。
-- Career Score（点・申請・履歴）は名前で分けているので、同じ名前の人が 2 人以上いると、だれの点か分からない。
-- v1140 の関数は、その名前の点を CEO・GM と「同じ名前の人を全員見られる人」にだけ届ける（本人・その店のリーダーにも届かない）。
-- 見分け方：
--   ・1 人が「在籍」、ほかが「退職」で、入社日・社員番号などから同じ人に見える → 同じ人の記録が 2 つある（再入社・作り直し）。
--   ・2 人とも「在籍」で店・入社日が違う → 別の 2 人。点の行（lss_emp_）を 2 人で 1 つ使っている（v1140 の前から）。
--   ・「確かめた写しだけ」→ GM・CEO が確かめたあと、社員の表の行が消えたか ID が変わった。
-- 結果を Claude に貼ってください（名前と店が出ます。給与・連絡先は出しません）。
with h as (
  select x.name, x.id
    from (select e.id::text as id, e.name from public.employees e where coalesce(e.name, '') <> ''
          union all
          select w.emp_id::text, w.name from public.wr_people w where coalesce(w.name, '') <> '') x
   group by x.name, x.id
), d as (
  select name from h group by name having count(distinct id) > 1
)
select h.name as "名前",
       h.id as "ID",
       case when e.id is null then '確かめた写しだけ（社員の表に行が無い）' else '社員の表' end
         || case when w.emp_id is not null and e.id is not null then '・確かめた写し' else '' end as "ある場所",
       case when e.id is null then '—'
            when coalesce(e.status, '') = '退職' or coalesce(e.data->>'status', '') = '退職' then '退職'
            when coalesce(e.data->>'osDisabled', '') = 'true' then 'OS 無効'
            else '在籍' end as "在籍",
       coalesce(nullif(e.store, ''), e.data->>'store', '') as "店",
       coalesce(e.support::text, '') as "応援店",
       coalesce(e.role, e.data->>'role', '') || ' / ' || coalesce(e.title, e.data->>'title', '') as "役割 / 肩書き",
       coalesce(e.data->>'empCode', '') as "社員番号",
       coalesce(nullif(e.data->>'hireDate', ''), e.data->>'startDate', '') as "入社日",
       coalesce(e.data->>'resignDate', '') as "退職日",
       case when w.emp_id is null then ''
            else w.role || ' G' || w.grade::text
                 || case when e.id is not null and w.name <> e.name then '（確かめた名前：' || w.name || '）' else '' end end as "確かめた写し",
       coalesce((select string_agg(distinct m.role, '・') from public.manager_auth m where m.emp_id::text = h.id), '') as "メールのアカウント",
       coalesce((select to_char(s.updated_at at time zone 'Pacific/Honolulu', 'YYYY-MM-DD')
                   from public.app_state s where s.key::text = 'lss_emp_' || h.name), '（無し）') as "この名前の点（最後の保存）"
  from h
  join d on d.name = h.name
  left join public.employees e on e.id::text = h.id
  left join public.wr_people w on w.emp_id::text = h.id
 order by h.name, 4, h.id;
