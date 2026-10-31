-- ④ 未登録の打刻：Toast の打刻（tip_labor の生の名前）と従業員マスターのつながり方（読むだけ。何も書き換えません）。
-- 特定の人の名前では探しません。全店・直近 75 日の、Toast の名前ごとに 1 行です。そのまま Claude に貼ってください。
--   match の見方（アプリの取り込みと同じ順で、最初に当たったもの）
--     exact …………… 従業員の名前と同じ（在籍）
--     exact_resigned … 同じ名前の人が退職だけ（アプリは結ぶ。未登録の打刻検知には出ない）
--     case …………… 大文字・小文字だけ違う（在籍）
--     alias …………… Toast での名前（別名）で結ばれている
--     part→… ………… 名前の一部が重なる人に結ばれる（例：短い名前が長い名前に含まれる）。→ の先が結ばれる人（2 人以上なら , で）
--     none …………… どの人にも結ばれない（未登録）
--   days・hours … その名前の打刻がある日数・時間の合計（ランチ＋ディナーの打刻の時間）。first_day・last_day … 最初と最後の日
with st as (select id, name, toast_guid from public.stores where coalesce(toast_guid, '') <> ''),
raw as (
  select st.id as store_id, t.business_date::date as d, e.value as r
    from public.tip_labor t join st on st.toast_guid = t.restaurant_guid,
         jsonb_array_elements(case when jsonb_typeof(t.data) = 'array' then t.data else '[]'::jsonb end) e
   where t.business_date::date >= (now() at time zone 'Pacific/Honolulu')::date - 75 and jsonb_typeof(e.value) = 'object'
),
n as (
  select store_id, coalesce(r ->> 'name', '') as toast_name, d,
         coalesce((r ->> 'lunchHours')::numeric, 0) + coalesce((r ->> 'dinnerHours')::numeric, 0) as h
    from raw
),
g as (
  select store_id, toast_name, count(distinct d) as days, round(sum(h), 1) as hours, min(d) as first_day, max(d) as last_day
    from n where toast_name <> '' group by store_id, toast_name
),
emp as (
  select id::text as id, coalesce(name, '') as name, coalesce(status, data ->> 'status', '') as status, coalesce(data, '{}'::jsonb) as d
    from public.employees where coalesce(name, '') <> ''
),
ak as (   -- 別名の欄（toastAlias_<そろえた名前>[@店]）。値が off のものは外す
  select e.id, split_part(substr(x.key, 12), '@', 1) as k, nullif(split_part(substr(x.key, 12), '@', 2), '') as store
    from emp e, jsonb_each(e.d) x
   where x.key like 'toastAlias\_%' escape '\' and coalesce(x.value #>> '{}', '') <> 'off'
),
nk as (select g.*, regexp_replace(lower(normalize(toast_name, NFKC)), '[[:space:]\-‐-―−.,''’_・@]', '', 'g') as k from g)
select nk.store_id, nk.toast_name, nk.days, nk.hours, nk.first_day, nk.last_day,
  case
    when exists (select 1 from emp where emp.name = nk.toast_name and emp.status <> '退職') then 'exact'
    when exists (select 1 from emp where emp.name = nk.toast_name) then 'exact_resigned'
    when exists (select 1 from emp where lower(emp.name) = lower(nk.toast_name) and emp.status <> '退職') then 'case'
    when exists (select 1 from ak where ak.k = nk.k and (ak.store is null or ak.store = nk.store_id)) then 'alias'
    when exists (select 1 from emp where emp.name <> '' and (position(emp.name in nk.toast_name) > 0 or position(nk.toast_name in emp.name) > 0))
      then 'part→' || (select string_agg(emp.name || case when emp.status = '退職' then '(退職)' else '' end, ', ' order by emp.name) from emp
                        where position(emp.name in nk.toast_name) > 0 or position(nk.toast_name in emp.name) > 0)
    else 'none' end as match
  from nk
 order by case when nk.last_day >= (now() at time zone 'Pacific/Honolulu')::date - 30 then 0 else 1 end, nk.store_id, nk.toast_name;
