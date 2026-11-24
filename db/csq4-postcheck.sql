-- 読むだけ（Career Score 2026 Q4・段階 3-1）。20261214090000_csq4.sql を入れた「あと」と、今の記録を写した「あと」に、Supabase の SQL Editor で流す。
-- 最後に rollback するので何も変わりません（8 行目は版の違う保存を頼んで、書かないことを確かめます）。全部 OK（か info）なら入っています。
-- NG があったら表を Claude との会話に貼ってください（名前は出ません。数だけ）。
-- 11 行目：今の記録を写したあと、写していない元（missing）は 0。まだ写していなければ info（手順.md の 5 で写す）。
-- 12 行目：サーバーの鍵（関数 secure-state）でも評価・記録・写しを消せない（csq4_log・csq4_hist・csq4_periods は直すこともできない）。
begin;
create temp table csq4_chk(n int, what text, value text, ok text) on commit drop;
with t(name) as (values ('csq4_periods'), ('csq4_assign'), ('csq4_evals'), ('csq4_reqs'), ('csq4_log'), ('csq4_runs'), ('csq4_hist'))
insert into csq4_chk
select 1, '表 7 つ', count(*) filter (where to_regclass('public.' || t.name) is not null)::text || ' / 7',
       case when count(*) filter (where to_regclass('public.' || t.name) is not null) = 7 then 'OK' else 'NG' end from t;
with t(name) as (values ('csq4_periods'), ('csq4_assign'), ('csq4_evals'), ('csq4_reqs'), ('csq4_log'), ('csq4_runs'), ('csq4_hist'))
insert into csq4_chk
select 2, 'RLS（7 つとも ON）', count(*) filter (where c.relrowsecurity)::text || ' / 7',
       case when count(*) = 7 and bool_and(c.relrowsecurity) then 'OK' else 'NG' end
  from t join pg_class c on c.oid = to_regclass('public.' || t.name);
insert into csq4_chk
select 3, '公開の鍵（anon・authenticated）が表を読めない・書けない', count(*)::text || ' 個の権限',
       case when count(*) = 0 then 'OK' else 'NG' end
  from information_schema.role_table_grants g
 where g.table_schema = 'public' and g.table_name like 'csq4\_%' and g.grantee in ('anon', 'authenticated', 'PUBLIC');
with f(sig) as (values ('csq4_unwrap(jsonb)'), ('csq4_open_reqs(text,text)'), ('csq4_assign_save(jsonb,text,text,text)'),
    ('csq4_eval_start(text,text,text,integer,jsonb,text,text,text)'), ('csq4_eval_reeval(text,text,text,bigint,integer,boolean,text,jsonb,text,text,text)'),
    ('csq4_eval_save(bigint,integer,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,text)'), ('csq4_eval_act(bigint,integer,text,text,jsonb,boolean,text,text,text)'),
    ('csq4_req_add(bigint,text,text,text,text,text)'), ('csq4_req_answer(bigint,text,text,text,text)'), ('csq4_hist_source()'), ('csq4_hist_copy(text,text,text)')),
  x as (select f.sig, to_regprocedure('public.' || f.sig)::oid as oid from f)
insert into csq4_chk
select 4, '関数 11 個（サーバーの鍵だけ・security invoker）',
       count(p.oid)::text || ' / 11 ある・公開の鍵で呼べる ' || count(*) filter (where p.oid is not null and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')))::text,
       case when count(p.oid) = 11 and bool_and(p.oid is not null and not p.prosecdef and not has_function_privilege('anon', p.oid, 'execute')
              and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute')) then 'OK' else 'NG' end
  from x left join pg_proc p on p.oid = x.oid;
with s(name) as (values ('csq4_evals_id_seq'), ('csq4_reqs_id_seq'), ('csq4_log_id_seq'), ('csq4_runs_id_seq'), ('csq4_hist_id_seq'))
insert into csq4_chk
select 5, '公開の鍵が番号（sequence）を使えない',
       count(*) filter (where to_regclass('public.' || s.name) is not null and (has_sequence_privilege('anon', to_regclass('public.' || s.name), 'usage')
         or has_sequence_privilege('authenticated', to_regclass('public.' || s.name), 'usage')))::text || ' 個使える',
       case when count(*) filter (where to_regclass('public.' || s.name) is null) = 0
             and count(*) filter (where has_sequence_privilege('anon', to_regclass('public.' || s.name), 'usage')
               or has_sequence_privilege('authenticated', to_regclass('public.' || s.name), 'usage')) = 0 then 'OK' else 'NG' end
  from s;
with t(name, ro) as (values ('csq4_periods', true), ('csq4_assign', false), ('csq4_evals', false), ('csq4_reqs', false), ('csq4_log', true), ('csq4_runs', false), ('csq4_hist', true))
insert into csq4_chk
select 12, 'サーバーの鍵でも消せない・空にできない（記録と写しは直せない）',
       count(*) filter (where to_regclass('public.' || t.name) is not null and (has_table_privilege('service_role', to_regclass('public.' || t.name), 'DELETE')
         or has_table_privilege('service_role', to_regclass('public.' || t.name), 'TRUNCATE')
         or (t.ro and has_table_privilege('service_role', to_regclass('public.' || t.name), 'UPDATE'))))::text || ' 個の表で消せる・直せる',
       case when count(*) filter (where to_regclass('public.' || t.name) is null) = 0
             and count(*) filter (where has_table_privilege('service_role', to_regclass('public.' || t.name), 'DELETE')
               or has_table_privilege('service_role', to_regclass('public.' || t.name), 'TRUNCATE')
               or (t.ro and has_table_privilege('service_role', to_regclass('public.' || t.name), 'UPDATE'))) = 0 then 'OK' else 'NG' end
  from t;
do $$
declare v text; r jsonb; n bigint; m bigint; e text;
begin
  if to_regclass('public.csq4_periods') is null then
    insert into csq4_chk values (6, '期間 2026-Q4', '表が無い', 'NG');
  else
    execute $q$select string_agg(period || ' ' || starts::text || '〜' || (ends - 1)::text || ' ' || version, '; ') from public.csq4_periods$q$ into v;
    insert into csq4_chk values (6, '期間 2026-Q4（ハワイの日付）', coalesce(v, '無い'),
      case when v = '2026-Q4 2026-10-01〜2026-12-31 CAREER_2026_Q4_V1' then 'OK' else 'NG' end);
  end if;
  insert into csq4_chk values (7, '開いている評価は 1 人 1 つ・確定・公開も 1 つ（索引）',
    concat_ws(' ', case when to_regclass('public.csq4_evals_open') is not null then 'open' end, case when to_regclass('public.csq4_evals_pub') is not null then 'pub' end),
    case when to_regclass('public.csq4_evals_open') is not null and to_regclass('public.csq4_evals_pub') is not null then 'OK' else 'NG' end);
  -- 8：読んだ版が違えば書かない（conflict）。行の無い人に版 5 で頼む＝書かない（最後に rollback もする）
  if to_regprocedure('public.csq4_assign_save(jsonb,text,text,text)') is null then
    insert into csq4_chk values (8, '読んだ版が違えば書かない（conflict）', '関数が無い', 'NG');
  else
    execute 'select public.csq4_assign_save($1, null, null, $2)' into r
      using '[{"emp":"__csq4_postcheck__","period":"2026-Q4","system":"PREP","grade":null,"type":null,"expect":5}]'::jsonb, 'sql';
    insert into csq4_chk values (8, '読んだ版が違えば書かない（conflict）', r::text, case when r->>'conflict' = 'true' then 'OK' else 'NG' end);
  end if;
  if to_regclass('public.csq4_evals') is not null then
    execute 'select count(*) from public.csq4_assign' into n;
    execute $q$select coalesce(string_agg(status || ' ' || c::text, '・' order by status), '0 件') from (select status, count(*) c from public.csq4_evals group by status) x$q$ into e;
    insert into csq4_chk values (9, '評価表を決めた人・評価（状態ごと）', n::text || ' 人・' || e, 'info');
  end if;
  if to_regclass('public.csq4_hist') is null or to_regprocedure('public.csq4_hist_source()') is null then
    insert into csq4_chk values (10, '今の記録の写し', '表か関数が無い', 'NG');
  else
    execute 'select count(*) from public.csq4_hist' into n;
    execute $q$select count(*) from public.csq4_hist_source() c where not exists (select 1 from public.csq4_hist h
      where h.src_key = c.src_key and h.src_part = c.src_part and h.src_hash = c.src_hash)$q$ into m;
    execute $q$select coalesce(string_agg(x.s, '・' order by x.s), '0 行') from (select coalesce(period, '期間未確認') || ' ' || count(*)::text as s
      from public.csq4_hist group by period) x$q$ into e;
    insert into csq4_chk values (10, '写した記録（期間ごと。2026-Q4＝Q4・旧制度）', n::text || ' 行：' || e, 'info');
    insert into csq4_chk values (11, '写していない元（missing）', m::text,
      case when n = 0 then 'info（まだ写していない）' when m = 0 then 'OK' else 'NG（もう一度写す）' end);
  end if;
end $$;
select n, what, value, ok from csq4_chk order by n;
rollback;
