-- 読むだけ（v1146・2b-8）。20261115090000_secure_tip_prep.sql を入れた「あと」に、Supabase の SQL Editor で流す。
-- 最後に rollback するので何も変わりません。全部の行が OK（か info）なら入っています。NG・CHECK があったら、表をそのまま Claude に貼ってください（地図の鍵・名前は出ません）。
-- v1145 の確かめ（db/secure-grade-hist-postcheck.sql）と同じ 19 行に、Tip Rate・プレップの 20〜22 行目を足したもの。
-- v1146 のあとは、v1145・v1143・v1141 の確かめの 3 行目は NG になります（キーが増えたため）。前の分もこの SQL の 12〜14・17〜19 行目で見ます。
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
select 3, '対象のキーの判定（v1145 までの 11＋v1146 の Tip Rate の前の統合行・プレップの表と認定・人ごとの Tip Rate の行の見本＝15）',
       (select count(*) from unnest(array['mileage_config', 'career_cfg', 'cs_criteria', 'bonus_coef', 'bonus_coef_rng', 'bonus_track',
                                          'bonus_eval_rule', 'bonus_eval_ovr', 'cs_strength_rule', 'cs_guide', 'grade_hist',
                                          'tip_requests', 'prep_tables', 'prep_certs', 'spl_tip_requests_zz_check']) k where public.ss_guard_key(k))::text,
       case when (select bool_and(public.ss_guard_key(k)) from unnest(array['mileage_config', 'career_cfg', 'cs_criteria', 'bonus_coef', 'bonus_coef_rng', 'bonus_track',
                                                                          'bonus_eval_rule', 'bonus_eval_ovr', 'cs_strength_rule', 'cs_guide', 'grade_hist',
                                                                          'tip_requests', 'prep_tables', 'prep_certs', 'spl_tip_requests_zz_check']) k)
             and not public.ss_guard_key('mileage_requests') and not public.ss_guard_key('cs_criteria ') and not public.ss_guard_key('Cs_guide')
             and not public.ss_guard_key('grade_hist ') and not public.ss_guard_key('Grade_hist') and not public.ss_guard_key('grade_hist_x')
             and not public.ss_guard_key('growth_karte') and not public.ss_guard_key('bonus_q')
             and not public.ss_guard_key('karte_bonus_config') and not public.ss_guard_key('tasks_all') and not public.ss_guard_key('lss_emp_x')
             and not public.ss_guard_key('spl_tip_requests_') and not public.ss_guard_key('spl_tip_history_x') and not public.ss_guard_key('spl_tip_request_x')
             and not public.ss_guard_key('tip_requests ') and not public.ss_guard_key('Tip_requests') and not public.ss_guard_key('live_tip_rate')
             and not public.ss_guard_key('prep_cfg') and not public.ss_guard_key('prep_history') and not public.ss_guard_key('prep_certs_x')
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
  -- 足す（上書きの upsert も）：対象のキーのどれも、行があってもなくても断られる。試すたびに、その場で取り消す（raise で中の取引を戻す。最後の rollback でも消える）
  res := 'OK';
  foreach k in array array['mileage_config', 'career_cfg', 'cs_criteria', 'bonus_coef', 'bonus_coef_rng', 'bonus_track',
                           'bonus_eval_rule', 'bonus_eval_ovr', 'cs_strength_rule', 'cs_guide', 'grade_hist',
                           'tip_requests', 'prep_tables', 'prep_certs', 'spl_tip_requests_zz_check', 'spl_tip_requests_' || repeat('x', 300)] loop
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
  insert into sw_chk values (6, 'anon で対象の行を足せない・上書きできない（v1145 までの 11＋Tip Rate・プレップ）', res, case when res = 'OK' then 'OK' else 'NG' end);
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
    insert into public.app_state(key, value) values ('zz_v1146_postcheck', '{}'::jsonb) on conflict (key) do update set value = excluded.value;
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
    insert into sw_chk values (12, 'ガソリン代の単価（wr_mileage_rate。work-requests が使う。決めた単価と同じか見てください）', coalesce(r::text, '読めない'),
      case when r is not null and r >= 0.01 and r <= 5 then 'OK（決めた単価と同じか確かめてください）' else 'NG（ガソリン代の申請が止まる・短い距離が 0 セントになる。CEO・GM・経理が画面で単価を入れ直す）' end);
  exception when undefined_function then insert into sw_chk values (12, 'ガソリン代の単価（wr_mileage_rate）', '関数なし', 'info');
  end;
end $$;
-- 13：v1143 の 8 つの行の形（関数 secure-state の swShapeOk と同じ決まり：全体がオブジェクト・記録はオブジェクトか空・キーは 200 字まで・600 万字まで）。
-- 全体がオブジェクトでない・大きすぎる行は、GM・CEO も保存できない（NG）。形の合わない記録は、そのまま残すなら保存は止まらない（info）
insert into sw_chk
select 13, '賞与・Career Score の設定 8 つの形（全体・記録・大きさ）',
       string_agg(o.k || ' ' || case when a.value is null then '行なし'
                                     when jsonb_typeof(a.value::jsonb) <> 'object' then '全体がオブジェクトでない（' || jsonb_typeof(a.value::jsonb) || '）'
                                     else (select count(*) from jsonb_object_keys(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end))::text || ' 件' || coalesce('・形の合わない記録 ' || nullif(x.bad, 0)::text, '')
                                          || case when char_length(a.value::text) > 3000000 then '・' || round(char_length(a.value::text) / 10000.0)::text || ' 万字' else '' end end,
                  ' / ' order by o.i),
       case when bool_or(a.value is not null and (jsonb_typeof(a.value::jsonb) <> 'object' or char_length(a.value::text) > 6000000)) then 'NG（その設定は GM・CEO も保存できません。Claude に）'
            when bool_or(coalesce(x.bad, 0) > 0) then 'info（形の合わない記録がある。GM・CEO の保存は止まりません（そのまま残る）。消すなら Claude に）'
            when bool_or(a.value is not null and char_length(a.value::text) > 3000000) then 'info（300 万字より大きい設定がある。600 万字を超えると保存できなくなります。Claude に）'
            else 'OK' end
  from (values (1, 'cs_criteria'), (2, 'bonus_coef'), (3, 'bonus_coef_rng'), (4, 'bonus_track'),
               (5, 'bonus_eval_rule'), (6, 'bonus_eval_ovr'), (7, 'cs_strength_rule'), (8, 'cs_guide')) o(i, k)
  left join public.app_state a on a.key = o.k
  left join lateral (select (select count(*)::int from jsonb_each(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end) e where char_length(e.key) > 200 or jsonb_typeof(e.value) not in ('object', 'null')) bad
                      where a.value is not null and jsonb_typeof(a.value::jsonb) = 'object') x on true;
-- 14：v1141 の 2 つ（ガソリン代の設定・Score管理）の形（v1141 の確かめの 13 行目と同じ。v1141 の SQL を入れていなかったときもこれで見る）
insert into sw_chk
select 14, 'ガソリン代の設定・Score管理の形（v1141 と同じ決まり：ガソリン代は包まない形・単価 0.01〜5・地図の鍵は 300 字まで／Score管理は記録ごとにオブジェクトか空）',
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
                                 else (select count(*)::int from jsonb_each(case when jsonb_typeof(x.cg) = 'object' then x.cg else '{}'::jsonb end) e where char_length(e.key) > 100 or jsonb_typeof(e.value) not in ('object', 'null')) end as cg_bad) z on true;
-- 15・16：決まり（RLS）を通らずに app_state に書ける道。この SQL は直接の書き込みしか試していないので、名前を出して確かめる
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
-- 17：8 つの設定の、いちばん新しい保存の日時（ハワイ時間。中身・名前は出しません）。③ の前は公開の鍵で書けたので、
-- 見覚えの無い新しい日時があれば、その画面で GM・CEO が決めたとおりか確かめる
insert into sw_chk
select 17, '賞与・Career Score の設定 8 つの、いちばん新しい保存（ハワイ時間）',
       string_agg(o.k || '：' || coalesce(to_char(to_timestamp(t.ms / 1000.0) at time zone 'UTC' - interval '10 hours', 'YYYY-MM-DD HH24:MI'), 'なし'), ' / ' order by o.i),
       'info（見覚えの無い日時があれば、その設定の画面で決めたとおりか確かめてください）'
  from (values (1, 'cs_criteria'), (2, 'bonus_coef'), (3, 'bonus_coef_rng'), (4, 'bonus_track'),
               (5, 'bonus_eval_rule'), (6, 'bonus_eval_ovr'), (7, 'cs_strength_rule'), (8, 'cs_guide')) o(i, k)
  left join lateral (select max((e.value->>'_at')::numeric) ms
                       from public.app_state a, jsonb_each(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end) e
                      where a.key = o.k and jsonb_typeof(e.value) = 'object' and jsonb_typeof(e.value->'_at') = 'number'
                        and (e.value->>'_at')::numeric between 1000000000000 and 99999999999999) t on true;
-- 18：グレード履歴（v1145）の形（関数 secure-state の swShapeOk と同じ決まり：全体がオブジェクト・社員ごとの記録はオブジェクトか空・キーは 200 字まで・600 万字まで）。
-- 全体がオブジェクトでない・大きすぎる行は、GM・CEO も保存できない（NG）。形の合わない記録は、そのまま残すなら保存は止まらない（info）
insert into sw_chk
select 18, 'グレード履歴（grade_hist）の形（全体・社員ごとの記録・大きさ）',
       case when a.value is null then '行なし'
            when jsonb_typeof(a.value::jsonb) <> 'object' then '全体がオブジェクトでない（' || jsonb_typeof(a.value::jsonb) || '）'
            else (select count(*) from jsonb_object_keys(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end))::text || ' 人'
                 || coalesce('・形の合わない記録 ' || nullif(x.bad, 0)::text, '')
                 || case when char_length(a.value::text) > 3000000 then '・' || round(char_length(a.value::text) / 10000.0)::text || ' 万字' else '' end end,
       case when a.value is not null and (jsonb_typeof(a.value::jsonb) <> 'object' or char_length(a.value::text) > 6000000) then 'NG（GM・CEO もグレード履歴を保存できません。Claude に）'
            when coalesce(x.bad, 0) > 0 then 'info（形の合わない記録がある。GM・CEO の保存は止まりません（そのまま残る）。消すなら Claude に）'
            when a.value is not null and char_length(a.value::text) > 3000000 then 'info（300 万字より大きい。600 万字を超えると保存できなくなります。Claude に）'
            else 'OK' end
  from (select 1) one
  left join public.app_state a on a.key = 'grade_hist'
  left join lateral (select (select count(*)::int from jsonb_each(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end) e where char_length(e.key) > 200 or jsonb_typeof(e.value) not in ('object', 'null')) bad
                      where a.value is not null and jsonb_typeof(a.value::jsonb) = 'object') x on true;
-- 19：グレード履歴の、いちばん新しい保存（ハワイ時間・社員の名前・中身は出しません）。③ の前は公開の鍵で書けたので、
-- 見覚えの無い新しい日時があれば、成長カルテ › グレード履歴で、GM・CEO が決めたとおりか確かめる
insert into sw_chk
select 19, 'グレード履歴の、いちばん新しい保存（ハワイ時間）',
       coalesce(to_char(to_timestamp(t.ms / 1000.0) at time zone 'UTC' - interval '10 hours', 'YYYY-MM-DD HH24:MI'), 'なし'),
       'info（見覚えの無い日時があれば、成長カルテのグレード履歴で決めたとおりか確かめてください）'
  from (select max((e.value->>'_at')::numeric) ms
          from public.app_state a, jsonb_each(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end) e
         where a.key = 'grade_hist' and jsonb_typeof(e.value) = 'object' and jsonb_typeof(e.value->'_at') = 'number'
           and (e.value->>'_at')::numeric between 1000000000000 and 99999999999999) t;
-- 20：Tip Rate の人ごとの行（v1146）の形（関数 secure-state と同じ決まり。最初に確かめる SQL の 4 行目と同じ）。
-- 行が配列でない・同じ id が 2 つある行は、だれも保存できない（NG）。形の合わない記録は、そのまま残すなら保存は止まらない（info）
insert into sw_chk
with r as (
  select a.key, substr(a.key, 18) as nm, a.value::jsonb as v, char_length(a.value::text) as len
    from public.app_state a where left(a.key, 17) = 'spl_tip_requests_' and char_length(a.key) > 17
), e as (
  select r.key, x as rec from r, jsonb_array_elements(case when jsonb_typeof(r.v) = 'array' then r.v else '[]'::jsonb end) x
), odd as (
  select e.key from e join r using (key)
   where jsonb_typeof(e.rec) <> 'object'
      or jsonb_typeof(e.rec->'id') not in ('string', 'number')
      or coalesce(e.rec->>'name', '') <> r.nm
      or coalesce(e.rec->>'status', '') not in ('申請中', '承認', '却下')
      or jsonb_typeof(e.rec->'rate') <> 'number' or (e.rec->>'rate')::numeric < 0 or (e.rec->>'rate')::numeric > 100
), dup as (
  select e.key from e where jsonb_typeof(e.rec) = 'object' and jsonb_typeof(e.rec->'id') in ('string', 'number')
   group by e.key, e.rec->>'id' having count(*) > 1
)
select 20, 'Tip Rate の人ごとの行の形（行・同じ id・記録）',
       (select count(*) from r)::text || ' 行・' || (select count(*) from e)::text || ' 件'
         || coalesce('・配列でない行 ' || nullif((select count(*) from r where jsonb_typeof(r.v) <> 'array'), 0)::text, '')
         || coalesce('・同じ id のある行 ' || nullif((select count(distinct key) from dup), 0)::text, '')
         || coalesce('・形の合わない記録 ' || nullif((select count(*) from odd), 0)::text, ''),
       case when (select count(*) from r where jsonb_typeof(r.v) <> 'array') > 0 or (select count(*) from dup) > 0 or (select count(*) from r where r.len > 4000000) > 0
              then 'NG（その人の Tip Rate はだれも保存できません。Claude に）'
            when (select count(*) from odd) > 0 then 'info（形の合わない記録がある。そのまま残せば保存は止まりません。Claude に）'
            else 'OK' end;
-- 21：プレップの時給の表・認定の形（全体がオブジェクト・記録はオブジェクトか空・キーは 200 字まで・400 万字まで）
insert into sw_chk
select 21, 'プレップの時給の表・認定の形',
       string_agg(o.k || ' ' || case when a.value is null then '行なし'
                                     when jsonb_typeof(a.value::jsonb) <> 'object' then '全体がオブジェクトでない（' || jsonb_typeof(a.value::jsonb) || '）'
                                     else (select count(*) from jsonb_object_keys(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end))::text || ' 件' || coalesce('・形の合わない記録 ' || nullif(x.bad, 0)::text, '') end,
                  ' / ' order by o.i),
       case when bool_or(a.value is not null and (jsonb_typeof(a.value::jsonb) <> 'object' or char_length(a.value::text) > 4000000)) then 'NG（GM・CEO も保存できません。Claude に）'
            when bool_or(coalesce(x.bad, 0) > 0) then 'info（形の合わない記録がある。そのまま残せば GM・CEO の保存は止まりません。Claude に）'
            else 'OK' end
  from (values (1, 'prep_tables'), (2, 'prep_certs')) o(i, k)
  left join public.app_state a on a.key = o.k
  left join lateral (select (select count(*)::int from jsonb_each(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end) e where char_length(e.key) > 200 or jsonb_typeof(e.value) not in ('object', 'null')) bad
                      where a.value is not null and jsonb_typeof(a.value::jsonb) = 'object') x on true;
-- 22：いちばん新しい Tip Rate の決定（decAt）と、プレップの表・認定の保存（_at）（ハワイ時間。名前・中身は出しません）。③ の前は公開の鍵で書けたので、
-- 見覚えの無い新しい日時があれば、Tip Rate の画面の履歴・プレップLv の画面の「認定の記録」で、決めたとおりか確かめる
insert into sw_chk
select 22, 'いちばん新しい Tip Rate の決定・プレップの表と認定の保存（ハワイ時間）',
       'Tip Rate：' || coalesce(to_char(to_timestamp(t.ms / 1000.0) at time zone 'UTC' - interval '10 hours', 'YYYY-MM-DD HH24:MI'), 'なし')
       || ' / prep_tables：' || coalesce(to_char(to_timestamp(p1.ms / 1000.0) at time zone 'UTC' - interval '10 hours', 'YYYY-MM-DD HH24:MI'), 'なし')
       || ' / prep_certs：' || coalesce(to_char(to_timestamp(p2.ms / 1000.0) at time zone 'UTC' - interval '10 hours', 'YYYY-MM-DD HH24:MI'), 'なし'),
       'info（見覚えの無い日時があれば、その画面で決めたとおりか確かめてください）'
  from (select max((x->>'decAt')::numeric) ms
          from public.app_state a, jsonb_array_elements(case when jsonb_typeof(a.value::jsonb) = 'array' then a.value::jsonb else '[]'::jsonb end) x
         where left(a.key, 17) = 'spl_tip_requests_' and char_length(a.key) > 17 and jsonb_typeof(x) = 'object' and jsonb_typeof(x->'decAt') = 'number'
           and (x->>'decAt')::numeric between 1000000000000 and 99999999999999) t,
       lateral (select max((e.value->>'_at')::numeric) ms
                  from public.app_state a, jsonb_each(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end) e
                 where a.key = 'prep_tables' and jsonb_typeof(e.value) = 'object' and jsonb_typeof(e.value->'_at') = 'number'
                   and (e.value->>'_at')::numeric between 1000000000000 and 99999999999999) p1,
       lateral (select max((e.value->>'_at')::numeric) ms
                  from public.app_state a, jsonb_each(case when jsonb_typeof(a.value::jsonb) = 'object' then a.value::jsonb else '{}'::jsonb end) e
                 where a.key = 'prep_certs' and jsonb_typeof(e.value) = 'object' and jsonb_typeof(e.value->'_at') = 'number'
                   and (e.value->>'_at')::numeric between 1000000000000 and 99999999999999) p2;
select n, what, value, ok from sw_chk order by n;
rollback;
