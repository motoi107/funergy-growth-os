-- 読むだけ（v1195・UI案96 の段階 2 の ①「所属の確認」）。20261212090000_aff_people.sql を入れる「前」に、Supabase の SQL Editor で流す。
-- 最後に rollback するので何も変わりません。STOP が無ければ SQL に進めます。表は Claude との会話にだけ貼ってください（名前は出ません。人数だけ）。
-- 3〜6 行目：今の従業員マスターの所属の数（在籍の人）。v1195 の「所属の確認」で本部にした人は所属が「OFFICE」になります。
--   5 行目（もう OFFICE・Office の人）は、v1195 から店の並び・人の一覧で「ALL（全店）」と同じに扱います（前は存在しない店の扱い）。
begin;
create temp table aff_pre(n int, what text, value text, ok text) on commit drop;
do $$
declare n bigint; shape_ok boolean;
begin
  if to_regclass('public.aff_people') is null then
    insert into aff_pre values (1, '表 aff_people（所属の写し）', 'まだ無い', 'OK');
  else
    shape_ok := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'aff_people' and column_name = 'support' and data_type = 'jsonb');
    if shape_ok then execute 'select count(*) from public.aff_people' into n; end if;
    insert into aff_pre values (1, '表 aff_people（所属の写し）', 'もうある' || case when shape_ok then '（行 ' || n::text || '）' else '' end,
                                case when shape_ok then 'OK（2 回目）' else 'STOP（形が違う）' end);
  end if;
  if to_regclass('public.aff_log') is null then
    insert into aff_pre values (2, '表 aff_log（変更の記録）', 'まだ無い', 'OK');
  else
    shape_ok := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'aff_log' and column_name = 'after' and data_type = 'jsonb');
    begin execute 'select count(*) from public.aff_log' into n; exception when others then n := null; end;
    insert into aff_pre values (2, '表 aff_log（変更の記録）', 'もうある（行 ' || coalesce(n::text, '?') || '）', case when shape_ok then 'OK' else 'STOP（形が違う）' end);
  end if;
end $$;
-- 在籍の人の所属（列の store か、中身の store）
with e as (
  select coalesce(nullif(btrim(coalesce(x.data->>'store', '')), ''), nullif(btrim(coalesce(x.store, '')), ''), '') as st
    from public.employees x
   where coalesce(x.status, '') <> '退職' and coalesce(x.data->>'status', '') <> '退職'
)
insert into aff_pre
select 3, '在籍の人：所属が ALL（全店）', count(*) filter (where st = 'ALL')::text || ' 人', 'info' from e
union all
select 4, '在籍の人：所属が空', count(*) filter (where st = '')::text || ' 人', 'info' from e
union all
select 5, '在籍の人：所属がもう OFFICE（Office など。大文字・小文字は見ない）', count(*) filter (where upper(st) = 'OFFICE')::text || ' 人', 'info' from e
union all
select 6, '在籍の人：所属が 本部・HQ・---', count(*) filter (where lower(st) in ('本部', 'hq', '---'))::text || ' 人', 'info' from e;
insert into aff_pre
select 7, '関数 aff_save', case when to_regprocedure('public.aff_save(jsonb,text,text,text,text)') is null then 'まだ無い' else 'もうある' end, 'OK';
select n, what, value, ok from aff_pre order by n;
rollback;
