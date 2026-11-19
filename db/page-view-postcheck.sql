-- 読むだけ（v1193・UI案95「画面の表示」）。20261211090000_pv_doc.sql を入れた「あと」に、Supabase の SQL Editor で流す。
-- 最後に rollback するので何も変わりません（7 行目は書いてから取り消して確かめます）。全部 OK（か info）なら入っています。NG があったら表をそのまま Claude に貼ってください。
-- 6 行目：今の設定の版。初めて入れたときは「まだ無い」（GM・CEO が 1193 の画面で初めの値を確かめて保存すると 1 になる）。
begin;
create temp table pv_chk(n int, what text, value text, ok text) on commit drop;
insert into pv_chk
select 1, '表 pv_doc・pv_log', concat_ws(' ', case when to_regclass('public.pv_doc') is not null then 'pv_doc' end, case when to_regclass('public.pv_log') is not null then 'pv_log' end),
       case when to_regclass('public.pv_doc') is not null and to_regclass('public.pv_log') is not null then 'OK' else 'NG' end;
insert into pv_chk
select 2, 'RLS（2 つとも ON）', string_agg(c.relname || '=' || case when c.relrowsecurity then 'ON' else 'OFF' end, ' ' order by c.relname),
       case when count(*) = 2 and bool_and(c.relrowsecurity) then 'OK' else 'NG' end
  from pg_class c where c.oid in (to_regclass('public.pv_doc'), to_regclass('public.pv_log'));
insert into pv_chk
select 3, '公開の鍵（anon・authenticated）が表を読めない・書けない', count(*)::text || ' 個の権限',
       case when count(*) = 0 then 'OK' else 'NG' end
  from information_schema.role_table_grants g
 where g.table_schema = 'public' and g.table_name in ('pv_doc', 'pv_log') and g.grantee in ('anon', 'authenticated', 'PUBLIC');
insert into pv_chk
select 4, '関数 pv_save（サーバーの鍵だけ・security invoker）',
       case when p.oid is null then '無い' else 'ある' end,
       case when p.oid is not null and not p.prosecdef
             and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
             and has_function_privilege('service_role', p.oid, 'execute') then 'OK' else 'NG' end
  from (select to_regprocedure('public.pv_save(jsonb,integer,text,jsonb,text,text,text)')::oid as oid) x left join pg_proc p on p.oid = x.oid;
insert into pv_chk
with s as (select to_regclass('public.pv_log_id_seq') as o)
select 5, '公開の鍵が記録の番号（sequence）を使えない',
       case when s.o is null then '無い' when has_sequence_privilege('anon', s.o, 'usage') or has_sequence_privilege('authenticated', s.o, 'usage') then '使える' else '使えない' end,
       case when s.o is not null and not has_sequence_privilege('anon', s.o, 'usage') and not has_sequence_privilege('authenticated', s.o, 'usage') then 'OK' else 'NG' end
  from s;
-- 6・7：表・関数が無くても（戻したあと など）止まらないように、文字から呼ぶ
do $$
declare v int; o boolean; r jsonb;
begin
  if to_regclass('public.pv_doc') is null then
    insert into pv_chk values (6, '今の設定の版', '表が無い', 'NG');
  else
    execute 'select ver, (doc->>''off'') = ''true'' from public.pv_doc where id = 1' into v, o;
    insert into pv_chk values (6, '今の設定の版', case when v is null then 'まだ無い' else 'ver ' || v::text || case when o then '（止めている）' else '' end end, 'info');
  end if;
  -- 7：読んだ版が違えば書かない（conflict）。書かないので何も変わらない（最後に rollback もする）
  if to_regprocedure('public.pv_save(jsonb,integer,text,jsonb,text,text,text)') is null then
    insert into pv_chk values (7, '読んだ版が違えば書かない（conflict）', '関数が無い', 'NG');
  else
    execute 'select public.pv_save($1, $2, $3, $4, null, null, $5)' into r
      using '{"v":1,"off":false,"cols":{},"people":{},"only":{}}'::jsonb, coalesce(v, 0) + 5, '確かめ', '[]'::jsonb, 'sql';
    insert into pv_chk values (7, '読んだ版が違えば書かない（conflict）', r::text, case when r->>'conflict' = 'true' then 'OK' else 'NG' end);
  end if;
end $$;
select n, what, value, ok from pv_chk order by n;
rollback;
