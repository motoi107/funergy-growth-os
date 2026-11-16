-- v1176：アップセルの明細と退勤の打刻の無い勤務の確かめ（読むだけ・何も変えない）。結果の表は Claude との会話にだけ貼る（公開の場には貼らない）。
-- part：
--   setup … 足した欄・表・読む決まり・公開の鍵で書けないこと（OK／NG）
--   day   … Totoya の店ごと・日ごと（直近 14 日）：v1176 で取り込んだか（by_mod）・品の行の数が印と同じか・明細に ID が入っているか
--   labor … 全店・直近 14 日：退勤の打刻が無い勤務がある日の数（v1176 の取り込みで入る。名前は出さない）
with toto as (
  select id, toast_guid from public.stores where id like 'F04%' and coalesce(toast_guid, '') <> ''
),
setup as (
  select 'setup' as part, null::text as store, x.a, x.b, x.c, x.d from (values
    ('columns', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'toast_upgrade_lines' and column_name = 'mod_guid')
                      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'toast_upgrade_lines' and column_name = 'check_key')
                      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'toast_upgrade_days' and column_name = 'by_mod')
                      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'toast_upgrade_days' and column_name = 'extra') then 'OK' else 'NG' end, '', ''),
    ('extra table', case when to_regclass('public.toast_upgrade_extra') is not null then 'OK' else 'NG' end, '', ''),
    ('rls', case when coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.toast_upgrade_extra')), false) then 'OK' else 'NG' end, '', ''),
    ('anon read', case when to_regclass('public.toast_upgrade_extra') is not null and has_table_privilege('anon', 'public.toast_upgrade_extra', 'SELECT') then 'OK' else 'NG' end, '', ''),
    ('anon cannot write', case when to_regclass('public.toast_upgrade_extra') is not null
                        and not has_table_privilege('anon', 'public.toast_upgrade_extra', 'INSERT') and not has_table_privilege('anon', 'public.toast_upgrade_extra', 'UPDATE')
                        and not has_table_privilege('anon', 'public.toast_upgrade_extra', 'DELETE') then 'OK' else 'NG' end, '', '')
  ) as x(a, b, c, d)
),
dy as (
  select t.id, d.business_date as dd, d.hw_version, d.by_mod is not null as v76, d.extra,
         (select count(*) from public.toast_upgrade_extra x where x.restaurant_guid = d.restaurant_guid and x.business_date = d.business_date) as ex_rows,
         (select count(*) from public.toast_upgrade_lines l where l.restaurant_guid = d.restaurant_guid and l.business_date = d.business_date and l.mod_guid is null) as no_id
    from toto t join public.toast_upgrade_days d on d.restaurant_guid = t.toast_guid
   where d.business_date >= ((now() at time zone 'Pacific/Honolulu')::date - 14)
),
day as (
  select 'day' as part, id as store, dd::text as a, coalesce(hw_version, '') as b,
         case when v76 then 'extra ' || coalesce(extra::text, '-') || ' / rows ' || ex_rows || ' · no id ' || no_id else 'v1171' end as c,
         case when not v76 then '取り込み直しが要る（v1176 より前）'
              when coalesce(extra, -1) = ex_rows and no_id = 0 then '一致'
              else 'ちがう' end as d
    from dy
),
lab as (
  select 'labor' as part, s.id as store,
         count(*)::text as a,
         count(*) filter (where exists (select 1 from jsonb_array_elements(case when jsonb_typeof(tl.data::jsonb) = 'array' then tl.data::jsonb else '[]'::jsonb end) e
                                         where jsonb_typeof(e->'openShifts') = 'array' and jsonb_array_length(e->'openShifts') > 0))::text as b,
         '' as c, '日数 / 退勤の打刻が無い勤務がある日' as d
    from public.stores s join public.tip_labor tl on tl.restaurant_guid = s.toast_guid
   where tl.business_date >= ((now() at time zone 'Pacific/Honolulu')::date - 14)
   group by s.id
)
select * from setup
union all select * from (select * from day order by store, a desc) z
union all select * from (select * from lab order by store) y;
