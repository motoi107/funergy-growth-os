-- 読むだけ（v1152・2b の最後）。20261119090000_secure_notifications.sql を入れた「あと」に、Supabase の SQL Editor で流す。
-- 最後に rollback するので何も変わりません。全部の行が OK なら入っています。NG があったら、表をそのまま Claude に貼ってください（中身は出ません）。
begin;
create temp table nt_chk(n int, what text, value text, ok text) on commit drop;
grant insert on nt_chk to anon, authenticated;   -- 下で anon・authenticated として結果を書くため（この一時表だけ。rollback で消える）
insert into nt_chk
select 1, 'app_state の RLS', case when c.relrowsecurity then 'ON' else 'OFF' end, case when c.relrowsecurity then 'OK' else 'NG' end
  from pg_class c where c.oid = 'public.app_state'::regclass;
insert into nt_chk
select 2, '決まり ss_secret（restrictive・anon と authenticated）', count(*)::text,
       case when count(*) = 1 and bool_and(p.permissive = 'RESTRICTIVE' and p.roles @> array['anon', 'authenticated']::name[] and p.cmd = 'ALL') then 'OK' else 'NG' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname = 'ss_secret';
insert into nt_chk
select 3, '対象のキーの判定（v1148 までの 27＋通知 1）',
       (select count(*) from unnest(array['growth_karte','karte_pin','karte_bonus_config','bonus_q','bonus_eval','bonus_store_q','bonus_rules','bonus_pool_extra','spl_bonus_q_2026-Q3',
                                          'lss_emp_A B','spl_lss_requests_山田 太郎','spl_lss_history_A','lss_scores','lss_requests','lss_history',
                                          'applicants','reject_log','growthhub','emp_pii',
                                          'tip_cf_S1_2026','tip_cf_x','warnings_S1','warnings_ 店',
                                          'tip_cf_' || repeat('x', 300),
                                          'grade_hist','bonus_eval_ovr','bonus_track','notifications']) k where public.ss_secret_key(k))::text,
       case when (select count(*) from unnest(array['growth_karte','karte_pin','karte_bonus_config','bonus_q','bonus_eval','bonus_store_q','bonus_rules','bonus_pool_extra','spl_bonus_q_2026-Q3',
                                          'lss_emp_A B','spl_lss_requests_山田 太郎','spl_lss_history_A','lss_scores','lss_requests','lss_history',
                                          'applicants','reject_log','growthhub','emp_pii',
                                          'tip_cf_S1_2026','tip_cf_x','warnings_S1','warnings_ 店',
                                          'tip_cf_' || repeat('x', 300),
                                          'grade_hist','bonus_eval_ovr','bonus_track','notifications']) k where public.ss_secret_key(k)) = 28
             and not public.ss_secret_key('notifications_x') and not public.ss_secret_key('Notifications') and not public.ss_secret_key('notification')
             and not public.ss_secret_key('invoice_qb_alerts') and not public.ss_secret_key('notip_config') and not public.ss_secret_key('tip_notify_state')
             and not public.ss_secret_key('bonus_eval_rule') and not public.ss_secret_key('bonus_coef') and not public.ss_secret_key('cs_criteria')
             and not public.ss_secret_key('tasks_all') and not public.ss_secret_key('approvals') then 'OK' else 'NG' end;
-- ここから公開の鍵（anon）として読む
set local role anon;
insert into nt_chk
select 4, 'anon で読める通知の行', count(*)::text, case when count(*) = 0 then 'OK' else 'NG' end
  from public.app_state where key::text = 'notifications';
insert into nt_chk
select 5, 'anon で読める成長カルテ・賞与・Career Score・採用・相談・個人の欄・Tip の確定・注意ログ・グレード履歴などの行（v1139〜v1148 のまま）', count(*)::text, case when count(*) = 0 then 'OK' else 'NG' end
  from public.app_state where public.ss_secret_key(key::text);
insert into nt_chk
select 6, 'anon で読めるほかの行（今までどおり）', count(*)::text, case when count(*) > 0 then 'OK' else 'NG' end
  from public.app_state where not public.ss_secret_key(key::text);
-- anon で書けない（足す・直す・消す）。試すたびに、その場で取り消す（raise で中の取引を戻す。最後の rollback でも消える）
do $$
declare n int; res text;
begin
  res := 'OK';
  begin
    insert into public.app_state(key, value) values ('notifications', '[]'::jsonb);
    res := 'NG（書けた）';
    raise exception 'nt_undo';
  exception when insufficient_privilege then res := 'OK';
            when unique_violation then res := 'NG（行が見えている）';
            when raise_exception then null;
            when others then res := 'NG（' || sqlstate || '）';
  end;
  insert into nt_chk values (8, 'anon で通知の行を足せない', res, case when res = 'OK' then 'OK' else 'NG' end);
  n := 0;
  begin
    update public.app_state set value = value where key::text = 'notifications';
    get diagnostics n = row_count;
    raise exception 'nt_undo';
  exception when insufficient_privilege then n := 0;
            when raise_exception then null;
  end;
  insert into nt_chk values (9, 'anon で通知の行を直せない', case when n = 0 then 'OK' else 'NG（' || n || ' 行）' end, case when n = 0 then 'OK' else 'NG' end);
  n := 0;
  begin
    delete from public.app_state where key::text = 'notifications';
    get diagnostics n = row_count;
    raise exception 'nt_undo';
  exception when insufficient_privilege then n := 0;
            when raise_exception then null;
  end;
  insert into nt_chk values (10, 'anon で通知の行を消せない', case when n = 0 then 'OK' else 'NG（' || n || ' 行）' end, case when n = 0 then 'OK' else 'NG' end);
  begin
    execute 'select count(*) from public.app_state_index(array[]::text[]) where key::text = ''notifications''' into n;
    insert into nt_chk values (11, 'anon の行の一覧（app_state_index）に出る通知', n::text, case when n = 0 then 'OK' else 'NG' end);
  exception when undefined_function then insert into nt_chk values (11, 'anon の行の一覧（app_state_index）', 'ない', 'info');
            when insufficient_privilege then insert into nt_chk values (11, 'anon の行の一覧（app_state_index）', '呼べない', 'OK');
  end;
end $$;
reset role;
set local role authenticated;
insert into nt_chk
select 12, 'authenticated（メールのログイン）で読める通知の行', count(*)::text, case when count(*) = 0 then 'OK' else 'NG' end
  from public.app_state where key::text = 'notifications';
reset role;
insert into nt_chk
select 7, 'サーバーの鍵・postgres で読める通知の行（関数 secure-state が使う。0 なら 4 は確かめになっていない）', count(*)::text,
       case when count(*) > 0 then 'OK' else 'info（行がまだ無い）' end
  from public.app_state where key::text = 'notifications';
-- v1151 の機密の区分（合図は _secure:notifications）
do $$
declare c text;
begin
  if to_regprocedure('public.fp_sec_cat(text)') is null then
    insert into nt_chk values (13, 'v1151 の機密の区分に通知（合図 _secure:notifications）', 'v1151 の SQL がない', 'info（v1151 の SQL のあとに、v1152 の SQL をもう一度流す）');
  else
    execute 'select public.fp_sec_cat(''notifications'')' into c;   -- 関数が無いときに読み方で止まらないように（その場で読む）
    insert into nt_chk values (13, 'v1151 の機密の区分に通知（合図 _secure:notifications）', c, case when c = 'notifications' then 'OK' else 'NG（v1152 の SQL をもう一度流す）' end);
  end if;
end $$;
-- 決まり（RLS）を通らない道：app_state を使う security definer の関数・view で、公開の鍵・ログインで呼べる／読めるもの（v1142 の 14・15 と同じ）
insert into nt_chk
select 14, 'app_state を使う security definer の関数で、公開の鍵・ログインで呼べるもの（決まりを通らない）', coalesce(string_agg(p.proname, ', ' order by p.proname), 'なし'),
       case when count(*) = 0 then 'OK' else 'CHECK（名前を Claude に。通知などのキーを返さないか確かめます）' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef and p.prosrc ilike '%app_state%' and p.prorettype <> 'trigger'::regtype
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
insert into nt_chk
select 15, 'app_state を使う view で、公開の鍵・ログインで読める・書けるもの（security_invoker でないもの）', coalesce(string_agg(c.relname, ', ' order by c.relname), 'なし'),
       case when count(*) = 0 then 'OK' else 'CHECK（名前を Claude に）' end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('v', 'm') and pg_get_viewdef(c.oid) ilike '%app_state%'
   and not coalesce('security_invoker=true' = any(c.reloptions) or 'security_invoker=on' = any(c.reloptions), false)
   and (has_table_privilege('anon', c.oid, 'select,insert,update,delete') or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete'));
select n, what, value, ok from nt_chk order by n;
rollback;
