-- 読むだけ（キャリア・育成 A-2・育成計画・OJT）。20261219090000_gp_plan.sql を入れる「前」に、Supabase の SQL Editor で流す。
-- 最後に rollback するので何も変わりません。STOP が無ければ SQL に進めます。表は Claude との会話にだけ貼ってください（名前は出ません。数だけ）。
-- 2〜4 行目：新しい表がもうあれば「2 回目」（流し直しても行は消えません）。形が違えば STOP（SQL も何も変えずに止まります）。
-- 5 行目：旧の OJT・成長管理の記録（app_state のキー）の数。SQL のあとの「旧の記録を写す」で、これが 1 件ずつ「旧として保存」として写ります（元は変えません）。
begin;
create temp table gp_pre(n int, what text, value text, ok text) on commit drop;
do $$
declare shape_ok boolean; n bigint;
begin
  insert into gp_pre values (1, '表 app_state・employees・wr_people（前からある表）',
    concat_ws(' ', case when to_regclass('public.app_state') is not null then 'app_state' end, case when to_regclass('public.employees') is not null then 'employees' end,
              case when to_regclass('public.wr_people') is not null then 'wr_people' end),
    case when to_regclass('public.app_state') is not null and to_regclass('public.employees') is not null and to_regclass('public.wr_people') is not null then 'OK' else 'STOP（無い）' end);
  if to_regclass('public.gp_plans') is null then insert into gp_pre values (2, '表 gp_plans（育成計画）', 'まだ無い', 'OK');
  else
    shape_ok := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gp_plans' and column_name = 'support' and data_type = 'jsonb');
    if shape_ok then execute 'select count(*) from public.gp_plans' into n; end if;
    insert into gp_pre values (2, '表 gp_plans（育成計画）', 'もうある' || case when shape_ok then '（行 ' || n::text || '）' else '' end, case when shape_ok then 'OK（2 回目）' else 'STOP（形が違う）' end);
  end if;
  if to_regclass('public.gp_tasks') is null then insert into gp_pre values (3, '表 gp_tasks（OJT）', 'まだ無い', 'OK');
  else
    shape_ok := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gp_tasks' and column_name = 'items' and data_type = 'ARRAY');
    if shape_ok then execute 'select count(*) from public.gp_tasks' into n; end if;
    insert into gp_pre values (3, '表 gp_tasks（OJT）', 'もうある' || case when shape_ok then '（行 ' || n::text || '）' else '' end, case when shape_ok then 'OK（2 回目）' else 'STOP（形が違う）' end);
  end if;
  if to_regclass('public.gp_legacy') is null then insert into gp_pre values (4, '表 gp_legacy（旧の記録の写し）', 'まだ無い', 'OK');
  else
    shape_ok := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gp_legacy' and column_name = 'src_hash' and data_type = 'text');
    if shape_ok then execute 'select count(*) from public.gp_legacy' into n; end if;
    insert into gp_pre values (4, '表 gp_legacy（旧の記録の写し）', 'もうある' || case when shape_ok then '（行 ' || n::text || '）' else '' end, case when shape_ok then 'OK（2 回目）' else 'STOP（形が違う）' end);
  end if;
  if to_regclass('public.app_state') is not null then
    execute $q$insert into gp_pre select 5, '旧の OJT・成長管理の記録（app_state のキー）', count(*)::text || ' キー（' || coalesce(string_agg(key, '・' order by key), '') || '）', 'info'
      from public.app_state where value is not null and (key in ('ojt_enroll', 'grade_ojt', 'ojt_phase_map', 'ojt_gate_criteria', 'ojt_def_g2', 'crew_education', 'career_track',
        'career_history', 'career_cfg', 'train_master', 'trainees', 'trainee_checklists', 'dev_pipe', 'dev_pipe_start', 'dev_nominations', 'dev_start', 'dev_data') or left(key, 8) = 'ojt_def_')$q$;
  end if;
end $$;
select n, what, value, ok from gp_pre order by n;
rollback;
