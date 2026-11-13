-- 読むだけ（v1141・2b-3）。20261110090000_secure_settings_write.sql を入れた「あと」に、Supabase の SQL Editor で流す。
-- 最後に rollback するので何も変わりません。全部の行が OK（か info）なら入っています。NG・CHECK があったら、表をそのまま Claude に貼ってください（地図の鍵・名前は出ません）。
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
    insert into sw_chk values (12, 'ガソリン代の単価（wr_mileage_rate。work-requests が使う。③ の前に書き換えられていないか、決めた単価と同じか見てください）', coalesce(r::text, '読めない'),
      case when r is not null and r >= 0.01 and r <= 5 then 'OK（決めた単価と同じか確かめてください）' else 'NG（ガソリン代の申請が止まる・短い距離が 0 セントになる。CEO・GM・経理が画面で単価を入れ直す）' end);
  exception when undefined_function then insert into sw_chk values (12, 'ガソリン代の単価（wr_mileage_rate）', '関数なし', 'info');
  end;
end $$;
-- 13：対象の行の形（関数 secure-state の swShapeOk と同じ決まり）。おかしな形のガソリン代の設定は、決めた人が保存し直すまで直らない
insert into sw_chk
-- Codex #135 の P2：形を確かめられない（単価が無い・数でない＝NULL）を OK にしない（is not true）。Score管理の行がオブジェクトでないのは NG（-1 を OK にしていた）
select 13, '対象の行の形（関数と同じ決まり：ガソリン代は包まない形・単価 0.01〜5・地図の鍵は 300 字まで／Score管理は記録ごとにオブジェクトか空）',
       'ガソリン代 ' || case when mi is null then '行なし' when mi_ok is true then 'OK' else 'NG' end
         || '・Score管理 ' || case when cg is null then '行なし' when cg_bad < 0 then '全体がオブジェクトでない（' || jsonb_typeof(cg) || '）' else '形の合わない記録 ' || cg_bad end,
       case when mi is not null and mi_ok is not true then 'NG（ガソリン代の設定：CEO・GM・経理が画面で入れ直す）'
            when cg_bad < 0 then 'NG（Score管理の行がオブジェクトでない。権限が初期の決まりに戻っています。Claude に）'
            when coalesce(cg_bad, 0) > 0 then 'info（Score管理に形の合わない記録が ' || cg_bad || ' 件。GM・CEO の保存は止まりません（そのまま残る）。消すなら Claude に）'
            else 'OK' end
  from (select (select a.value::jsonb from public.app_state a where a.key = 'mileage_config') mi,
               (select a.value::jsonb from public.app_state a where a.key = 'career_cfg') cg) x
  left join lateral (select jsonb_typeof(x.mi) = 'object' and not (x.mi ? '__st')
                            and jsonb_typeof(x.mi->'ratePerMile') = 'number' and (x.mi->>'ratePerMile')::numeric between 0.01 and 5
                            and (not (x.mi ? 'gmapsKey') or jsonb_typeof(x.mi->'gmapsKey') = 'null' or (jsonb_typeof(x.mi->'gmapsKey') = 'string' and char_length(x.mi->>'gmapsKey') <= 300))
                            and (not (x.mi ? 'roundTripDefault') or jsonb_typeof(x.mi->'roundTripDefault') = 'boolean') as mi_ok) y on true
  left join lateral (select case when x.cg is null then null when jsonb_typeof(x.cg) <> 'object' then -1
                                 else (select count(*)::int from jsonb_each(x.cg) e where char_length(e.key) > 100 or jsonb_typeof(e.value) not in ('object', 'null')) end as cg_bad) z on true;
-- 14：Score管理の記録（キーと最後に変えた日時。名前は出しません）。③ の前は公開の鍵で書けたので、画面で 1 つずつ決めたとおりか確かめる
insert into sw_chk
select 14, 'Score管理の記録（専門職|グレード：最後に変えた日時）',
       coalesce((select case when jsonb_typeof(a.value::jsonb) <> 'object' then '全体がオブジェクトでない（13 行目）' end from public.app_state a where a.key = 'career_cfg'),
                (select string_agg(e.key || '：' || coalesce(e.value->>'at', '?'), ' / ' order by e.key)
                   from public.app_state a, jsonb_each(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end) e where a.key = 'career_cfg'), 'なし'),
       'info（Score管理の画面で、権限がどれも決めたとおりか確かめてください）';
-- 15・16：決まり（RLS）を通らずに app_state に書ける道（独立レビュー P2-2）。この SQL は直接の書き込みしか試していないので、名前を出して確かめる
insert into sw_chk
select 15, 'app_state を使う security definer の関数で、公開の鍵・ログインで呼べるもの（決まりを通らない）', coalesce(string_agg(p.proname, ', ' order by p.proname), 'なし'),
       case when count(*) = 0 then 'OK' else 'CHECK（名前を Claude に。決まったキーだけを書くか確かめます）' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef and p.prosrc ilike '%app_state%'
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
insert into sw_chk
select 16, 'app_state を使う view で、公開の鍵・ログインで書けるもの', coalesce(string_agg(c.relname, ', ' order by c.relname), 'なし'),
       case when count(*) = 0 then 'OK' else 'CHECK（名前を Claude に）' end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'v' and pg_get_viewdef(c.oid) ilike '%app_state%'
   and (has_table_privilege('anon', c.oid, 'insert,update,delete') or has_table_privilege('authenticated', c.oid, 'insert,update,delete'));
select n, what, value, ok from sw_chk order by n;
rollback;
