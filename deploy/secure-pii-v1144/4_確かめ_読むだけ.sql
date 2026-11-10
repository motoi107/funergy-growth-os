-- 読むだけ（v1144・2b-6）。20261113090000_secure_emp_pii.sql を入れた「あと」に、Supabase の SQL Editor で流す。
-- 最後に rollback するので何も変わりません。全部の行が OK なら入っています。NG があったら、表をそのまま Claude に貼ってください（中身は出ません）。
begin;
create temp table pii_chk(n int, what text, value text, ok text) on commit drop;
grant insert on pii_chk to anon, authenticated;   -- 下で anon・authenticated として結果を書くため（この一時表だけ。rollback で消える）
insert into pii_chk
select 1, 'app_state の RLS', case when c.relrowsecurity then 'ON' else 'OFF' end, case when c.relrowsecurity then 'OK' else 'NG' end
  from pg_class c where c.oid = 'public.app_state'::regclass;
insert into pii_chk
select 2, '決まり ss_secret（restrictive・anon と authenticated）', count(*)::text,
       case when count(*) = 1 and bool_and(p.permissive = 'RESTRICTIVE' and p.roles @> array['anon', 'authenticated']::name[] and p.cmd = 'ALL') then 'OK' else 'NG' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname = 'ss_secret';
insert into pii_chk
select 3, '対象のキーの判定（成長カルテ・賞与 9 つ＋Career Score 6 つ＋採用・相談 3 つ＋個人の欄 1 つ）',
       (select count(*) from unnest(array['growth_karte','karte_pin','karte_bonus_config','bonus_q','bonus_eval','bonus_store_q','bonus_rules','bonus_pool_extra','spl_bonus_q_2026-Q3',
                                          'lss_emp_A B','spl_lss_requests_山田 太郎','spl_lss_history_A','lss_scores','lss_requests','lss_history',
                                          'applicants','reject_log','growthhub','emp_pii']) k where public.ss_secret_key(k))::text,
       case when (select count(*) from unnest(array['growth_karte','karte_pin','karte_bonus_config','bonus_q','bonus_eval','bonus_store_q','bonus_rules','bonus_pool_extra','spl_bonus_q_2026-Q3',
                                          'lss_emp_A B','spl_lss_requests_山田 太郎','spl_lss_history_A','lss_scores','lss_requests','lss_history',
                                          'applicants','reject_log','growthhub','emp_pii']) k where public.ss_secret_key(k)) = 19
             and not public.ss_secret_key('emp_pii_x') and not public.ss_secret_key('emp_pi') and not public.ss_secret_key('Emp_pii')
             and not public.ss_secret_key('m_employees') and not public.ss_secret_key('onboardings') and not public.ss_secret_key('mileage_config')
             and not public.ss_secret_key('career_cfg') and not public.ss_secret_key('tasks_all') then 'OK' else 'NG' end;
insert into pii_chk
select 4, '従業員の表に残っている個人の欄（生年月日・カード・保険の加入・保険料）', count(*)::text, case when count(*) = 0 then 'OK' else 'NG' end
  from public.employees e where e.data is not null and jsonb_typeof(e.data) = 'object' and e.data ?| array['dob', 'cardLast4', 'insurance', 'dental', 'insuranceAmt'];
insert into pii_chk
select 5, '書くたびに外す見張り（employees_pii_strip_trg・書く前）', count(*)::text,
       case when count(*) = 1 then 'OK' else 'NG' end
  from pg_trigger t where t.tgrelid = 'public.employees'::regclass and t.tgname = 'employees_pii_strip_trg' and not t.tgisinternal and t.tgenabled <> 'D';
-- 見張りが効くか：1 人の行に生年月日を書いてみて、入らないことを確かめる（その場で取り消す。最後の rollback でも消える）
do $$
declare res text; id0 text;
begin
  select e.id::text into id0 from public.employees e where e.data is not null and jsonb_typeof(e.data) = 'object' limit 1;
  if id0 is null then insert into pii_chk values (6, '見張りが効く（試しに書いて入らない）', '従業員の行がない', 'info'); return; end if;
  begin
    update public.employees set data = data || '{"dob":"2000-01-01","insuranceAmt":1}'::jsonb where id::text = id0;
    select case when (e.data ? 'dob') or (e.data ? 'insuranceAmt') then 'NG（入った）' else 'OK' end into res from public.employees e where e.id::text = id0;
    raise exception 'pii_undo';
  exception when raise_exception then null;
            when others then res := 'NG（' || sqlstate || '）';
  end;
  insert into pii_chk values (6, '見張りが効く（試しに書いて入らない）', res, case when res = 'OK' then 'OK' else 'NG' end);
end $$;
insert into pii_chk
select 7, 'emp_pii の行（サーバーの鍵・postgres で読める。関数 secure-state が使う）',
       coalesce((select case when jsonb_typeof(s.value::jsonb) = 'object' then (select count(*) from jsonb_object_keys(s.value::jsonb))::text || ' 人' else '形が違う' end
                   from public.app_state s where s.key::text = 'emp_pii'), '行なし'),
       case when exists (select 1 from public.app_state s where s.key::text = 'emp_pii' and jsonb_typeof(s.value::jsonb) = 'object') then 'OK'
            when exists (select 1 from public.app_state s where s.key::text = 'emp_pii') then 'NG'
            else 'info（だれも個人の欄を持っていなかった）' end;
-- ここから公開の鍵（anon）として読む
set local role anon;
insert into pii_chk
select 8, 'anon で読める emp_pii の行', count(*)::text, case when count(*) = 0 then 'OK' else 'NG' end
  from public.app_state where key::text = 'emp_pii';
insert into pii_chk
select 9, 'anon で読めるほかの行（今までどおり）', count(*)::text, case when count(*) > 0 then 'OK' else 'NG' end
  from public.app_state where not public.ss_secret_key(key::text);
insert into pii_chk
select 10, 'anon で読める従業員の表の個人の欄', count(*)::text, case when count(*) = 0 then 'OK' else 'NG' end
  from public.employees e where e.data is not null and jsonb_typeof(e.data) = 'object' and e.data ?| array['dob', 'cardLast4', 'insurance', 'dental', 'insuranceAmt'];
do $$
declare n int; res text;
begin
  res := 'OK';
  begin
    insert into public.app_state(key, value) values ('emp_pii', '{}'::jsonb);
    res := 'NG（書けた）';
    raise exception 'pii_undo';
  exception when insufficient_privilege then res := 'OK';
            when unique_violation then res := 'NG（行が見えている）';
            when raise_exception then null;
            when others then res := 'NG（' || sqlstate || '）';
  end;
  insert into pii_chk values (11, 'anon で emp_pii の行を足せない', res, case when res = 'OK' then 'OK' else 'NG' end);
  n := 0;
  begin
    update public.app_state set value = value where key::text = 'emp_pii';
    get diagnostics n = row_count;
    raise exception 'pii_undo';
  exception when insufficient_privilege then n := 0;
            when raise_exception then null;
  end;
  insert into pii_chk values (12, 'anon で emp_pii の行を直せない', case when n = 0 then 'OK' else 'NG（' || n || ' 行）' end, case when n = 0 then 'OK' else 'NG' end);
  n := 0;
  begin
    delete from public.app_state where key::text = 'emp_pii';
    get diagnostics n = row_count;
    raise exception 'pii_undo';
  exception when insufficient_privilege then n := 0;
            when raise_exception then null;
  end;
  insert into pii_chk values (13, 'anon で emp_pii の行を消せない', case when n = 0 then 'OK' else 'NG（' || n || ' 行）' end, case when n = 0 then 'OK' else 'NG' end);
  begin
    execute 'select count(*) from public.app_state_index(array[]::text[]) where key::text = ''emp_pii''' into n;
    insert into pii_chk values (14, 'anon の行の一覧（app_state_index）に出る emp_pii', n::text, case when n = 0 then 'OK' else 'NG' end);
  exception when undefined_function then insert into pii_chk values (14, 'anon の行の一覧（app_state_index）', 'ない', 'info');
            when insufficient_privilege then insert into pii_chk values (14, 'anon の行の一覧（app_state_index）', '呼べない', 'OK');
  end;
end $$;
reset role;
set local role authenticated;
insert into pii_chk
select 15, 'authenticated（メールのログイン）で読める対象のキーの行', count(*)::text, case when count(*) = 0 then 'OK' else 'NG' end
  from public.app_state where public.ss_secret_key(key::text);
reset role;
-- 決まり（RLS）を通らない道：app_state か従業員の表を使う security definer の関数で、公開の鍵・ログインで呼べるもの（v1142 の 14 と同じ）
insert into pii_chk
select 16, 'app_state を使う security definer の関数で、公開の鍵・ログインで呼べるもの（決まりを通らない）', coalesce(string_agg(p.proname, ', ' order by p.proname), 'なし'),
       case when count(*) = 0 then 'OK' else 'CHECK（名前を Claude に。emp_pii を返さないか確かめます）' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef and p.prosrc ilike '%app_state%'
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
select n, what, value, ok from pii_chk order by n;
rollback;
