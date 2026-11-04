-- 読むだけ（v1140・2b-2）。20261109090000_secure_cs_rls.sql を入れた「あと」に、Supabase の SQL Editor で流す。
-- 最後に rollback するので何も変わりません。全部の行が OK なら入っています。NG があったら、表をそのまま Claude に貼ってください（中身は出ません）。
begin;
create temp table cs_chk(n int, what text, value text, ok text) on commit drop;
grant insert on cs_chk to anon, authenticated;   -- 下で anon・authenticated として結果を書くため（この一時表だけ。rollback で消える）
insert into cs_chk
select 1, 'app_state の RLS', case when c.relrowsecurity then 'ON' else 'OFF' end, case when c.relrowsecurity then 'OK' else 'NG' end
  from pg_class c where c.oid = 'public.app_state'::regclass;
insert into cs_chk
select 2, '決まり ss_secret（restrictive・anon と authenticated）', count(*)::text,
       case when count(*) = 1 and bool_and(p.permissive = 'RESTRICTIVE' and p.roles @> array['anon', 'authenticated']::name[] and p.cmd = 'ALL') then 'OK' else 'NG' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname = 'ss_secret';
insert into cs_chk
select 3, '対象のキーの判定（成長カルテ・賞与 9 つ＋Career Score 6 つ）',
       (select count(*) from unnest(array['growth_karte','karte_pin','karte_bonus_config','bonus_q','bonus_eval','bonus_store_q','bonus_rules','bonus_pool_extra','spl_bonus_q_2026-Q3',
                                          'lss_emp_A B','spl_lss_requests_山田 太郎','spl_lss_history_A','lss_scores','lss_requests','lss_history']) k where public.ss_secret_key(k))::text,
       case when (select count(*) from unnest(array['growth_karte','karte_pin','karte_bonus_config','bonus_q','bonus_eval','bonus_store_q','bonus_rules','bonus_pool_extra','spl_bonus_q_2026-Q3',
                                          'lss_emp_A B','spl_lss_requests_山田 太郎','spl_lss_history_A','lss_scores','lss_requests','lss_history']) k where public.ss_secret_key(k)) = 15
             and not public.ss_secret_key('lss_emp_') and not public.ss_secret_key('spl_lss_requests_') and not public.ss_secret_key('lssXemp_A')
             and not public.ss_secret_key('lss_rules') and not public.ss_secret_key('cs_criteria') and not public.ss_secret_key('career_cfg')
             and not public.ss_secret_key('spl_skill_history_A') and not public.ss_secret_key('tasks_all') then 'OK' else 'NG' end;
-- ここから公開の鍵（anon）として読む
set local role anon;
insert into cs_chk
select 4, 'anon で読める Career Score の行', count(*)::text, case when count(*) = 0 then 'OK' else 'NG' end
  from public.app_state where public.ss_secret_key(key::text) and (key::text like 'lss%' or key::text like 'spl\_lss\_%');
insert into cs_chk
select 5, 'anon で読める成長カルテ・賞与の行（v1139 のまま）', count(*)::text, case when count(*) = 0 then 'OK' else 'NG' end
  from public.app_state where public.ss_secret_key(key::text);
insert into cs_chk
select 6, 'anon で読めるほかの行（今までどおり）', count(*)::text, case when count(*) > 0 then 'OK' else 'NG' end
  from public.app_state where not public.ss_secret_key(key::text);
-- anon で書けない（足す・直す・消す）。試すたびに、その場で取り消す（raise で中の取引を戻す。最後の rollback でも消える）
do $$
declare n int; res text;
begin
  res := 'OK';
  begin
    insert into public.app_state(key, value) values ('lss_emp_zz-postcheck', '{}'::jsonb);
    res := 'NG（書けた）';
    raise exception 'cs_undo';
  exception when insufficient_privilege then res := 'OK';
            when raise_exception then null;
            when others then res := 'NG（' || sqlstate || '）';
  end;
  insert into cs_chk values (8, 'anon で Career Score の行を足せない', res, case when res = 'OK' then 'OK' else 'NG' end);
  n := 0;
  begin
    update public.app_state set value = value where key::text like 'lss\_emp\_%' or key::text like 'spl\_lss\_%';
    get diagnostics n = row_count;
    raise exception 'cs_undo';
  exception when insufficient_privilege then n := 0;
            when raise_exception then null;
  end;
  insert into cs_chk values (9, 'anon で Career Score の行を直せない', case when n = 0 then 'OK' else 'NG（' || n || ' 行）' end, case when n = 0 then 'OK' else 'NG' end);
  n := 0;
  begin
    delete from public.app_state where key::text like 'lss\_emp\_%' or key::text like 'spl\_lss\_%';
    get diagnostics n = row_count;
    raise exception 'cs_undo';
  exception when insufficient_privilege then n := 0;
            when raise_exception then null;
  end;
  insert into cs_chk values (10, 'anon で Career Score の行を消せない', case when n = 0 then 'OK' else 'NG（' || n || ' 行）' end, case when n = 0 then 'OK' else 'NG' end);
  begin
    execute 'select count(*) from public.app_state_index(array[]::text[]) where public.ss_secret_key(key::text)' into n;
    insert into cs_chk values (11, 'anon の行の一覧（app_state_index）に出る対象のキー', n::text, case when n = 0 then 'OK' else 'NG' end);
  exception when undefined_function then insert into cs_chk values (11, 'anon の行の一覧（app_state_index）', 'ない', 'info');
            when insufficient_privilege then insert into cs_chk values (11, 'anon の行の一覧（app_state_index）', '呼べない', 'OK');
  end;
end $$;
reset role;
set local role authenticated;
insert into cs_chk
select 12, 'authenticated（メールのログイン）で読める対象のキーの行', count(*)::text, case when count(*) = 0 then 'OK' else 'NG' end
  from public.app_state where public.ss_secret_key(key::text);
reset role;
insert into cs_chk
select 7, 'サーバーの鍵・postgres で読める Career Score の行（関数 secure-state が使う。0 なら 4 は確かめになっていない）', count(*)::text, case when count(*) > 0 then 'OK' else 'NG' end
  from public.app_state where public.ss_secret_key(key::text) and (key::text like 'lss%' or key::text like 'spl\_lss\_%');
select n, what, value, ok from cs_chk order by n;
rollback;
