-- 読むだけ（v1195・UI案96 の段階 2 の ①「所属の確認」）。20261212090000_aff_people.sql を入れた「あと」に、Supabase の SQL Editor で流す。
-- 最後に rollback するので何も変わりません（7 行目は版の違う保存を頼んで、書かないことを確かめます）。全部 OK（か info）なら入っています。
-- NG があったら表を Claude との会話に貼ってください（名前は出ません）。
begin;
create temp table aff_chk(n int, what text, value text, ok text) on commit drop;
insert into aff_chk
select 1, '表 aff_people・aff_log', concat_ws(' ', case when to_regclass('public.aff_people') is not null then 'aff_people' end, case when to_regclass('public.aff_log') is not null then 'aff_log' end),
       case when to_regclass('public.aff_people') is not null and to_regclass('public.aff_log') is not null then 'OK' else 'NG' end;
insert into aff_chk
select 2, 'RLS（2 つとも ON）', string_agg(c.relname || '=' || case when c.relrowsecurity then 'ON' else 'OFF' end, ' ' order by c.relname),
       case when count(*) = 2 and bool_and(c.relrowsecurity) then 'OK' else 'NG' end
  from pg_class c where c.oid in (to_regclass('public.aff_people'), to_regclass('public.aff_log'));
insert into aff_chk
select 3, '公開の鍵（anon・authenticated）が表を読めない・書けない', count(*)::text || ' 個の権限',
       case when count(*) = 0 then 'OK' else 'NG' end
  from information_schema.role_table_grants g
 where g.table_schema = 'public' and g.table_name in ('aff_people', 'aff_log') and g.grantee in ('anon', 'authenticated', 'PUBLIC');
insert into aff_chk
select 4, '関数 aff_save（サーバーの鍵だけ・security invoker）',
       case when p.oid is null then '無い' else 'ある' end,
       case when p.oid is not null and not p.prosecdef
             and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
             and has_function_privilege('service_role', p.oid, 'execute') then 'OK' else 'NG' end
  from (select to_regprocedure('public.aff_save(jsonb,text,text,text,text)')::oid as oid) x left join pg_proc p on p.oid = x.oid;
insert into aff_chk
with s as (select to_regclass('public.aff_log_id_seq') as o)
select 5, '公開の鍵が記録の番号（sequence）を使えない',
       case when s.o is null then '無い' when has_sequence_privilege('anon', s.o, 'usage') or has_sequence_privilege('authenticated', s.o, 'usage') then '使える' else '使えない' end,
       case when s.o is not null and not has_sequence_privilege('anon', s.o, 'usage') and not has_sequence_privilege('authenticated', s.o, 'usage') then 'OK' else 'NG' end
  from s;
do $$
declare n bigint; r jsonb;
begin
  if to_regclass('public.aff_people') is null then
    insert into aff_chk values (6, '決めた人', '表が無い', 'NG');
  else
    execute 'select count(*) from public.aff_people' into n;
    insert into aff_chk values (6, '決めた人', n::text || ' 人', 'info');
  end if;
  -- 7：読んだ版が違えば書かない（conflict）。行の無い人に版 5 で頼む＝書かない（最後に rollback もする）
  if to_regprocedure('public.aff_save(jsonb,text,text,text,text)') is null then
    insert into aff_chk values (7, '読んだ版が違えば書かない（conflict）', '関数が無い', 'NG');
  else
    execute 'select public.aff_save($1, $2, null, null, $3)' into r
      using '[{"emp":"__aff_postcheck__","aff":"hq","store":"","support":[],"expect":5}]'::jsonb, '確かめ', 'sql';
    insert into aff_chk values (7, '読んだ版が違えば書かない（conflict）', r::text, case when r->>'conflict' = 'true' then 'OK' else 'NG' end);
  end if;
end $$;
select n, what, value, ok from aff_chk order by n;
rollback;
