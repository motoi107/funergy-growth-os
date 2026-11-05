-- 読むだけ（v1141・2b-3）。20261110090000_secure_settings_write.sql を入れた「あと」に、Supabase の SQL Editor で流す。
-- 最後に rollback するので何も変わりません。全部の行が OK（か info）なら入っています。NG があったら、表をそのまま Claude に貼ってください（中身は出ません）。
begin;
create temp table sw_chk(n int, what text, value text, ok text) on commit drop;
grant insert on sw_chk to anon, authenticated;   -- 下で anon・authenticated として結果を書くため（この一時表だけ。rollback で消える）
insert into sw_chk
select 1, 'app_state の RLS', case when c.relrowsecurity then 'ON' else 'OFF' end, case when c.relrowsecurity then 'OK' else 'NG' end
  from pg_class c where c.oid = 'public.app_state'::regclass;
insert into sw_chk
select 2, '決まり ss_guard_ins・ss_guard_upd・ss_guard_del（restrictive・anon と authenticated・足す／直す／消す）',
       count(*)::text || '（' || coalesce(string_agg(p.cmd, '・' order by p.cmd), '') || '）',
       case when count(*) = 3 and bool_and(p.permissive = 'RESTRICTIVE' and p.roles @> array['anon', 'authenticated']::name[])
             and array_agg(p.cmd order by p.cmd) = array['DELETE', 'INSERT', 'UPDATE'] then 'OK' else 'NG' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname in ('ss_guard_ins', 'ss_guard_upd', 'ss_guard_del');
insert into sw_chk
select 3, '対象のキーの判定（mileage_config・career_cfg だけ）',
       (select count(*) from unnest(array['mileage_config', 'career_cfg']) k where public.ss_guard_key(k))::text,
       case when public.ss_guard_key('mileage_config') and public.ss_guard_key('career_cfg')
             and not public.ss_guard_key('mileage_requests') and not public.ss_guard_key('career_cfg ') and not public.ss_guard_key('Career_cfg')
             and not public.ss_guard_key('cs_criteria') and not public.ss_guard_key('growth_karte') and not public.ss_guard_key('tasks_all')
             and not public.ss_guard_key(null) then 'OK' else 'NG' end;
insert into sw_chk
select 4, 'サーバーの鍵・postgres で読める対象の行（0 なら下の 5 は確かめになっていない）', count(*)::text, case when count(*) > 0 then 'OK' else 'info（まだ保存されていない）' end
  from public.app_state where public.ss_guard_key(key::text);
-- ここから公開の鍵（anon）として
set local role anon;
insert into sw_chk
select 5, 'anon で読める対象の行（今までどおり読める）', count(*)::text, 'info'
  from public.app_state where public.ss_guard_key(key::text);
do $$
declare n int; res text; k text;
begin
  -- 足す（上書きの upsert も）：どちらのキーも、行があってもなくても断られる。試すたびに、その場で取り消す（raise で中の取引を戻す。最後の rollback でも消える）
  res := 'OK';
  foreach k in array array['mileage_config', 'career_cfg'] loop
    begin
      insert into public.app_state(key, value) values (k, '{"ratePerMile":1}'::jsonb) on conflict (key) do update set value = excluded.value;
      res := 'NG（' || k || ' に書けた）';
      raise exception 'sw_undo';
    exception when insufficient_privilege then null;
              when raise_exception then null;
              when others then res := 'NG（' || k || '：' || sqlstate || '）';
    end;
    exit when res <> 'OK';
  end loop;
  insert into sw_chk values (6, 'anon で対象の行を足せない・上書きできない', res, case when res = 'OK' then 'OK' else 'NG' end);
  n := 0;
  begin
    update public.app_state set value = value where public.ss_guard_key(key::text);
    get diagnostics n = row_count;
    raise exception 'sw_undo';
  exception when insufficient_privilege then n := 0;
            when raise_exception then null;
  end;
  insert into sw_chk values (7, 'anon で対象の行を直せない', case when n = 0 then 'OK' else 'NG（' || n || ' 行）' end, case when n = 0 then 'OK' else 'NG' end);
  n := 0;
  begin
    delete from public.app_state where public.ss_guard_key(key::text);
    get diagnostics n = row_count;
    raise exception 'sw_undo';
  exception when insufficient_privilege then n := 0;
            when raise_exception then null;
  end;
  insert into sw_chk values (8, 'anon で対象の行を消せない', case when n = 0 then 'OK' else 'NG（' || n || ' 行）' end, case when n = 0 then 'OK' else 'NG' end);
  -- ほかのキーは今までどおり書ける（試して取り消す）
  res := 'NG（書けなかった）';
  begin
    insert into public.app_state(key, value) values ('zz_v1141_postcheck', '{}'::jsonb) on conflict (key) do update set value = excluded.value;
    res := 'OK';
    raise exception 'sw_undo';
  exception when raise_exception then null;
            when others then res := 'NG（' || sqlstate || '）';
  end;
  insert into sw_chk values (9, 'anon でほかのキーは今までどおり書ける', res, case when res = 'OK' then 'OK' else 'NG' end);
end $$;
reset role;
set local role authenticated;
do $$
declare n int := 0;
begin
  begin
    update public.app_state set value = value where public.ss_guard_key(key::text);
    get diagnostics n = row_count;
    raise exception 'sw_undo';
  exception when insufficient_privilege then n := 0;
            when raise_exception then null;
  end;
  insert into sw_chk values (10, 'authenticated（メールのログイン）で対象の行を直せない', case when n = 0 then 'OK' else 'NG（' || n || ' 行）' end, case when n = 0 then 'OK' else 'NG' end);
end $$;
reset role;
insert into sw_chk
select 11, 'anon と postgres で読める対象の行の数が同じ（読むのは今までどおり）',
       (select value from sw_chk where n = 5) || ' ／ ' || (select value from sw_chk where n = 4),
       case when (select value from sw_chk where n = 5) = (select value from sw_chk where n = 4) then 'OK' else 'NG' end;
do $$
declare r numeric;
begin
  begin
    execute 'select public.wr_mileage_rate()' into r;
    insert into sw_chk values (12, 'ガソリン代の単価（wr_mileage_rate。work-requests が使う）', coalesce(r::text, '読めない'), case when r is not null then 'OK' else 'NG（ガソリン代の申請が止まる。CEO・GM・経理が画面で単価を入れ直す）' end);
  exception when undefined_function then insert into sw_chk values (12, 'ガソリン代の単価（wr_mileage_rate）', '関数なし', 'info');
  end;
end $$;
select n, what, value, ok from sw_chk order by n;
rollback;
