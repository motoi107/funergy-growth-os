-- 読むだけ（Career Score 2026 Q4・段階 3-1）。20261214090000_csq4.sql を入れる「前」に、Supabase の SQL Editor で流す。
-- 最後に rollback するので何も変わりません。STOP が無ければ SQL に進めます。表は Claude との会話にだけ貼ってください（名前は出ません。数だけ）。
-- 4〜9 行目：今の Career Score の記録（app_state）の数。SQL のあとの「今の記録を写す」でこの数が写ります（元は変えません・消しません）。
-- 10 行目：同じ名前の人（社員の表の列と中身・確かめた写し。退職の人も数える）。その名前の記録は人を決めずに写します（本人の画面には出ません）。
-- 2・3・12 行目：新しい表がもうあれば「2 回目」（流し直しても行は消えません）。形が違えば STOP（SQL も何も変えずに止まります）。
begin;
create temp table csq4_pre(n int, what text, value text, ok text) on commit drop;
do $$
declare shape_ok boolean; n bigint;
begin
  insert into csq4_pre values (1, '表 app_state・employees・wr_people（前からある表）',
    concat_ws(' ', case when to_regclass('public.app_state') is not null then 'app_state' end, case when to_regclass('public.employees') is not null then 'employees' end,
              case when to_regclass('public.wr_people') is not null then 'wr_people' end),
    case when to_regclass('public.app_state') is not null and to_regclass('public.employees') is not null and to_regclass('public.wr_people') is not null then 'OK' else 'STOP（無い）' end);
  if to_regclass('public.csq4_evals') is null then
    insert into csq4_pre values (2, '表 csq4_evals（新しい評価）', 'まだ無い', 'OK');
  else
    shape_ok := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'csq4_evals' and column_name = 'entries' and data_type = 'jsonb');
    if shape_ok then execute 'select count(*) from public.csq4_evals' into n; end if;
    insert into csq4_pre values (2, '表 csq4_evals（新しい評価）', 'もうある' || case when shape_ok then '（行 ' || n::text || '）' else '' end,
                                 case when shape_ok then 'OK（2 回目）' else 'STOP（形が違う）' end);
  end if;
  if to_regclass('public.csq4_hist') is null then
    insert into csq4_pre values (3, '表 csq4_hist（今までの記録の写し）', 'まだ無い', 'OK');
  else
    shape_ok := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'csq4_hist' and column_name = 'src_hash' and data_type = 'text');
    if shape_ok then execute 'select count(*) from public.csq4_hist' into n; end if;
    insert into csq4_pre values (3, '表 csq4_hist（今までの記録の写し）', 'もうある' || case when shape_ok then '（行 ' || n::text || '）' else '' end,
                                 case when shape_ok then 'OK（2 回目）' else 'STOP（形が違う）' end);
  end if;
  if to_regclass('public.csq4_assign') is null then
    insert into csq4_pre values (12, '表 csq4_assign（評価表）', 'まだ無い', 'OK');
  elsif exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'csq4_assign' and column_name = 'ver' and data_type = 'integer') then
    insert into csq4_pre values (12, '表 csq4_assign（評価表）', 'もうある', 'OK（2 回目）');
  else
    insert into csq4_pre values (12, '表 csq4_assign（評価表）', 'もうある', 'STOP（形が違う）');
  end if;
end $$;
do $$
begin
  if to_regclass('public.app_state') is null then return; end if;
  insert into csq4_pre
  select 4, '今の点（lss_emp_〜）', count(*) filter (where left(key, 8) = 'lss_emp_' and char_length(key) > 8)::text || ' 人分', 'info' from public.app_state
  union all
  select 5, '変更の履歴（spl_lss_history_〜）', count(*) filter (where left(key, 16) = 'spl_lss_history_' and char_length(key) > 16)::text || ' 人分', 'info' from public.app_state
  union all
  select 6, '申請（spl_lss_requests_〜）', count(*) filter (where left(key, 17) = 'spl_lss_requests_' and char_length(key) > 17)::text || ' 人分', 'info' from public.app_state
  union all
  select 7, '前の統合行（lss_scores・lss_requests・lss_history）', count(*) filter (where key in ('lss_scores', 'lss_requests', 'lss_history'))::text || ' 行', 'info' from public.app_state
  union all
  select 8, '賞与の確定で固定した Career Score（bonus_q・spl_bonus_q_〜）', count(*) filter (where key = 'bonus_q' or left(key, 12) = 'spl_bonus_q_')::text || ' 行', 'info' from public.app_state
  union all
  select 9, 'オフィス用 Career Score（ocs_ev_〜）', count(*) filter (where left(key, 7) = 'ocs_ev_' and char_length(key) > 7)::text || ' 人分', 'info' from public.app_state;
end $$;
do $$
begin
  if to_regclass('public.employees') is null or to_regclass('public.wr_people') is null then return; end if;
  -- 名前を持つ人：社員の表の名前（列と中身）・確かめた写しの名前。2 人以上が持つ名前の記録は人を決めずに写す
  execute $q$insert into csq4_pre
  select 10, '同じ名前の人（社員の表の列と中身・確かめた写し。退職の人も数える）', count(*)::text || ' 組（その名前の記録は人を決めずに写す）', 'info'
    from (select o.name from (
            select e.id::text as id, e.name as name from public.employees e where coalesce(e.name, '') <> ''
            union select e.id::text, e.data->>'name' from public.employees e where jsonb_typeof(e.data) = 'object' and coalesce(e.data->>'name', '') <> ''
            union select w.emp_id, w.name from public.wr_people w where coalesce(w.name, '') <> '') o
          group by o.name having count(distinct o.id) > 1) x$q$;
end $$;
insert into csq4_pre
select 11, '関数 csq4_hist_copy（今の記録を写す）', case when to_regprocedure('public.csq4_hist_copy(text,text,text)') is null then 'まだ無い' else 'もうある' end, 'OK';
select n, what, value, ok from csq4_pre order by n;
rollback;
