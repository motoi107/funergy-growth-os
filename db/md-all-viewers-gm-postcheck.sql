-- 読むだけ（v1192・Codex 6986713362 の P2-1・6989812896 の P2-1）。20261210090000_md_all_viewers_gm.sql を入れた「あと」に、Supabase の SQL Editor で流す。
-- 最後に rollback するので何も変わりません。全部 OK（か info）なら入っています。NG があったら表をそのまま Claude に貼ってください（名前は出ません）。
-- 4 行目：関数 secure-state が写しを使えるか（md_all_viewers_gm_trusted）。NG のあいだ、関数は写しを使わない（全店を見る AM も担当の店だけ）。
-- 5 行目：写しで ON の人の数。初めて入れたときは 0（空で作る）。関数と 1192 のあと GM・CEO が付け直すと増える。
begin;
create temp table lv_chk(n int, what text, value text, ok text) on commit drop;
grant insert on lv_chk to anon, authenticated;
insert into lv_chk
select 1, '対象のキーの判定（md_all_viewers_gm と v1146 までの 15。似た名前は対象外）',
       (select count(*) from unnest(array['md_all_viewers_gm', 'mileage_config', 'career_cfg', 'cs_criteria', 'bonus_coef', 'bonus_coef_rng', 'bonus_track',
                                          'bonus_eval_rule', 'bonus_eval_ovr', 'cs_strength_rule', 'cs_guide', 'grade_hist',
                                          'tip_requests', 'prep_tables', 'prep_certs', 'spl_tip_requests_zz_check']) k where public.ss_guard_key(k))::text,
       case when (select bool_and(public.ss_guard_key(k)) from unnest(array['md_all_viewers_gm', 'mileage_config', 'career_cfg', 'cs_criteria', 'bonus_coef', 'bonus_coef_rng',
                                          'bonus_track', 'bonus_eval_rule', 'bonus_eval_ovr', 'cs_strength_rule', 'cs_guide', 'grade_hist',
                                          'tip_requests', 'prep_tables', 'prep_certs', 'spl_tip_requests_zz_check']) k)
             and not public.ss_guard_key('md_all_viewers') and not public.ss_guard_key('md_all_viewers_gm ') and not public.ss_guard_key('Md_all_viewers_gm')
             and not public.ss_guard_key('md_all_viewers_g') and not public.ss_guard_key('tasks_all') and not public.ss_guard_key(null) then 'OK' else 'NG' end;
insert into lv_chk
select 2, '決まり ss_guard_ins・ss_guard_upd・ss_guard_del（restrictive・anon と authenticated）', count(*)::text,
       case when count(*) = 3 and bool_and(p.permissive = 'RESTRICTIVE' and p.roles @> array['anon', 'authenticated']::name[]) then 'OK' else 'NG' end
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_state' and p.policyname in ('ss_guard_ins', 'ss_guard_upd', 'ss_guard_del');
insert into lv_chk
select 3, 'app_state の RLS', case when c.relrowsecurity then 'ON' else 'OFF' end, case when c.relrowsecurity then 'OK' else 'NG' end
  from pg_class c where c.oid = 'public.app_state'::regclass;
-- 関数が無くても（SQL の前）止まらないように、呼ぶのは関数があるときだけ（query_to_xml で文字から呼ぶ）
insert into lv_chk
with t as (select case when to_regprocedure('public.md_all_viewers_gm_trusted()') is null then null
                       else (xpath('/row/t/text()', query_to_xml('select public.md_all_viewers_gm_trusted() as t', false, true, '')))[1]::text end as v)
select 4, '関数 secure-state が写しを使える（md_all_viewers_gm_trusted：公開の鍵で書けない形か）',
       case when t.v is null then '関数が無い' when t.v = 'true' then 'はい' else 'いいえ' end,
       case when t.v = 'true' then 'OK' else 'NG' end
  from t;
-- 5・6：写し・設定がオブジェクトでなくても止まらないように、先にオブジェクトだけを取り出してから数える
insert into lv_chk
with gm as (select case when jsonb_typeof(a.value::text::jsonb) = 'object' then a.value::text::jsonb end as j from public.app_state a where a.key = 'md_all_viewers_gm')
select 5, '写し md_all_viewers_gm（ON の人の数。初めて入れたときは 0）',
       coalesce((select count(*) from gm, jsonb_each(coalesce(gm.j, '{}'::jsonb)) e
                  where jsonb_typeof(e.value) = 'object' and e.value->>'on' = 'true' and coalesce(e.value->>'_deleted', '') <> 'true')::text, '?'),
       case when exists (select 1 from gm where gm.j is not null) then 'OK' else 'NG（写しが無い・地図でない）' end;
insert into lv_chk
with gm as (select case when jsonb_typeof(a.value::text::jsonb) = 'object' then a.value::text::jsonb end as j from public.app_state a where a.key = 'md_all_viewers_gm'),
     st as (select case when jsonb_typeof(s.value::text::jsonb) = 'object' then s.value::text::jsonb end as j from public.app_settings s where s.key = 'md_all_viewers'),
     on_gm as (select string_agg(e.key, ',' order by e.key) as ids from gm, jsonb_each(coalesce(gm.j, '{}'::jsonb)) e
                where jsonb_typeof(e.value) = 'object' and e.value->>'on' = 'true' and coalesce(e.value->>'_deleted', '') <> 'true'),
     on_st as (select string_agg(e.key, ',' order by e.key) as ids from st, jsonb_each(coalesce(st.j, '{}'::jsonb)) e
                where jsonb_typeof(e.value) = 'object' and e.value->>'on' = 'true' and coalesce(e.value->>'_deleted', '') <> 'true')
select 6, 'app_settings の md_all_viewers と ON の人が同じか（初めは「違う」。関数と 1192 のあと GM・CEO が 1192 の端末で付け直す）',
       case when coalesce((select ids from on_gm), '') = coalesce((select ids from on_st), '') then '同じ' else '違う' end, 'info';
set local role anon;
do $$
declare res text := 'OK'; n int;
begin
  begin
    insert into public.app_state(key, value) values ('md_all_viewers_gm', '{"x":{"on":true}}'::jsonb) on conflict (key) do update set value = excluded.value;
    res := 'NG（書けた）'; raise exception 'lv_undo';
  exception when insufficient_privilege then null; when raise_exception then null; when others then res := 'NG（' || sqlstate || '）';
  end;
  insert into lv_chk values (7, 'anon で写しを足せない・上書きできない', res, case when res = 'OK' then 'OK' else 'NG' end);
  n := 0;
  begin
    update public.app_state set value = value where key = 'md_all_viewers_gm'; get diagnostics n = row_count; raise exception 'lv_undo';
  exception when insufficient_privilege then n := 0; when raise_exception then null;
  end;
  insert into lv_chk values (8, 'anon で写しを直せない', case when n = 0 then 'OK' else 'NG（' || n || ' 行）' end, case when n = 0 then 'OK' else 'NG' end);
  n := 0;
  begin
    delete from public.app_state where key = 'md_all_viewers_gm'; get diagnostics n = row_count; raise exception 'lv_undo';
  exception when insufficient_privilege then n := 0; when raise_exception then null;
  end;
  insert into lv_chk values (9, 'anon で写しを消せない', case when n = 0 then 'OK' else 'NG（' || n || ' 行）' end, case when n = 0 then 'OK' else 'NG' end);
  insert into lv_chk select 10, 'anon で写しを読める（今までどおり）', count(*)::text, case when count(*) = 1 then 'OK' else 'NG' end from public.app_state where key = 'md_all_viewers_gm';
end $$;
reset role;
set local role authenticated;
do $$
declare res text := 'OK';
begin
  begin
    insert into public.app_state(key, value) values ('md_all_viewers_gm', '{"x":{"on":true}}'::jsonb) on conflict (key) do update set value = excluded.value;
    res := 'NG（書けた）'; raise exception 'lv_undo';
  exception when insufficient_privilege then null; when raise_exception then null; when others then res := 'NG（' || sqlstate || '）';
  end;
  insert into lv_chk values (11, 'authenticated で写しを足せない・上書きできない', res, case when res = 'OK' then 'OK' else 'NG' end);
end $$;
reset role;
select * from lv_chk order by n;
rollback;
