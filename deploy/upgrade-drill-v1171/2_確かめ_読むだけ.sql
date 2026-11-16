-- v1171：アップグレードの明細の確かめ（読むだけ・何も変えない）。結果の表は Claude との会話にだけ貼る（公開の場には貼らない）。
-- part：
--   setup … 表・読む決まり・公開の鍵で書けないこと（OK／NG）
--   day   … Totoya の店ごと・日ごと（直近 14 日）に、toast_sales の分母・分子と、明細の行から数えた数・印の数が同じか
--           （一致／ちがう／明細なし＝v1171 より前に取り込んだ日・取り込み直すと入る）
with toto as (
  select id, name, toast_guid from public.stores where id like 'F04%' and coalesce(toast_guid, '') <> ''
),
setup as (
  select 'setup' as part, null::text as store, x.a, x.b, x.c, x.d from (values
    ('tables', case when to_regclass('public.toast_upgrade_lines') is not null and to_regclass('public.toast_upgrade_days') is not null then 'OK' else 'NG' end, '', ''),
    ('rls', case when coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.toast_upgrade_lines')), false)
                  and coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.toast_upgrade_days')), false) then 'OK' else 'NG' end, '', ''),
    ('anon read', case when to_regclass('public.toast_upgrade_lines') is not null and has_table_privilege('anon', 'public.toast_upgrade_lines', 'SELECT')
                        and has_table_privilege('anon', 'public.toast_upgrade_days', 'SELECT') then 'OK' else 'NG' end, '', ''),
    ('anon cannot write', case when to_regclass('public.toast_upgrade_lines') is not null
                        and not has_table_privilege('anon', 'public.toast_upgrade_lines', 'INSERT') and not has_table_privilege('anon', 'public.toast_upgrade_lines', 'UPDATE')
                        and not has_table_privilege('anon', 'public.toast_upgrade_lines', 'DELETE') and not has_table_privilege('anon', 'public.toast_upgrade_days', 'INSERT')
                        and not has_table_privilege('anon', 'public.toast_upgrade_days', 'UPDATE') and not has_table_privilege('anon', 'public.toast_upgrade_days', 'DELETE') then 'OK' else 'NG' end, '', '')
  ) as x(a, b, c, d)
),
s as (
  select t.id, t.toast_guid, r.business_date::date as d, r.miso_total_count as tot, r.miso_upgrade_count as up
    from toto t join public.toast_sales r on r.restaurant_guid = t.toast_guid
   where r.business_date >= ((now() at time zone 'Pacific/Honolulu')::date - 14)
),
ln as (
  select restaurant_guid g, business_date d,
         round(sum(qty) filter (where counted)) as tot,
         round(sum(qty) filter (where counted and kind <> 'aosa')) as up,
         count(*) filter (where not counted) as voided
    from public.toast_upgrade_lines
   where business_date >= ((now() at time zone 'Pacific/Honolulu')::date - 14)
   group by 1, 2
),
dy as (
  select restaurant_guid g, business_date d, total, upgrade, hw_version from public.toast_upgrade_days
   where business_date >= ((now() at time zone 'Pacific/Honolulu')::date - 14)
),
day as (
  select 'day' as part, s.id as store, s.d::text as a,
         'toast ' || coalesce(s.tot::text, '-') || ' / ' || coalesce(s.up::text, '-') as b,
         case when dy.g is null then 'no day mark' else 'lines ' || coalesce(ln.tot::text, '0') || ' / ' || coalesce(ln.up::text, '0') || ' · void ' || coalesce(ln.voided::text, '0') || ' · ' || coalesce(dy.hw_version, '') end as c,
         case when dy.g is null then '明細なし（取り込み直すと入る）'
              when coalesce(ln.tot, 0) = coalesce(s.tot, 0) and coalesce(ln.up, 0) = coalesce(s.up, 0) and dy.total = coalesce(s.tot, 0) and dy.upgrade = coalesce(s.up, 0) then '一致'
              else 'ちがう' end as d
    from s left join dy on dy.g = s.toast_guid and dy.d = s.d
           left join ln on ln.g = s.toast_guid and ln.d = s.d
)
select * from setup
union all
select * from (select * from day order by store, a desc) z;
