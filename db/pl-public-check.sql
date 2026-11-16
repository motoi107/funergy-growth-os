-- 読むだけ（v1174）。会計 PL の共有の保存（app_settings の pl_public）に、どの月・どの店の数が入っているか。
-- 会議タブの「KPI推移」と月の下の「確定／暫定」はここを読む（取り込んだ端末の pl_actual はその端末だけ＝この SQL では見えない）。
-- 金額は出さない（入っているか・暫定の印・保存した時刻だけ）。2026 年 1 月から。
-- 見方：sales・cogs・payroll が「あり」なら、その店・その月の売上・原価率・人件費率が会計 PL の数になる。
--       prov が「暫定」の月は、ファイル名か見出しに「暫定」のある PL から取り込んだ月（確定版を取り込むと「確定」）。
with s as (
  select to_jsonb(a) as r, a.value::jsonb as v0 from public.app_settings a where a.key = 'pl_public'
), v as (
  select r, case when jsonb_typeof(v0) = 'object' and v0 ? '__st' then v0->'v' else v0 end as v from s
), m as (
  select mo.key as ym, mo.value as mv
    from v, jsonb_each(case when jsonb_typeof(v.v) = 'object' then v.v else '{}'::jsonb end) mo
   where mo.key ~ '^[0-9]{4}-[0-9]{2}$'
)
select 'A 保存の行' as part, '' as ym, '' as store,
       case when exists (select 1 from s) then 'あり' else '無い' end as sales,
       '' as cogs, '' as payroll,
       (select count(*)::text from m) || ' か月' as prov,
       coalesce((select r->>'updated_at' from s limit 1), '') as saved_at
union all
select * from (
  select 'B 月 × 店' as part, m.ym, st.key as store,
         case when jsonb_typeof(st.value->'sales') = 'number' and (st.value->>'sales')::numeric > 0 then 'あり' else '無い' end,
         case when jsonb_typeof(st.value->'cogs') = 'number' then 'あり' else '無い' end,
         case when jsonb_typeof(st.value->'payroll') = 'number' then 'あり' else '無い' end,
         case when (st.value->>'prov') in ('1', 'true') then '暫定' else '確定' end,
         case when (st.value->>'_at') ~ '^[0-9]{10,14}$'
              then to_char(to_timestamp((st.value->>'_at')::bigint / 1000.0) at time zone 'Pacific/Honolulu', 'YYYY-MM-DD HH24:MI') || ' HST'
              else '' end
    from m, jsonb_each(case when jsonb_typeof(m.mv) = 'object' then m.mv else '{}'::jsonb end) st
   where m.ym >= '2026-01' and jsonb_typeof(st.value) = 'object'
   order by m.ym, st.key
) b;
