-- v1155 ワークセンターの申請 段階 2：2 を流したあとの確認（読むだけ・何も変えない）。「result」に NG が 1 つも無ければ OK。（参考）は数を見るだけ。
select '1. 表が 9 つ・どれもサーバーの鍵だけ（行の守り）' as check_name,
  case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('wr_settings','wr_counters','wr_requests','wr_versions','wr_events','wr_people','wr_people_log','wr_views','wr_store_views') and c.relrowsecurity) = 9 then 'OK' else 'NG' end as result
union all select '2. ブラウザの鍵では表を読めない',
  case when (select count(*) from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name like 'wr\_%') = 0 then 'OK' else 'NG' end
union all select '3. ブラウザの鍵では関数を呼べない',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'wr\_%'
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0 then 'OK' else 'NG' end
union all select '4. 段階 2 の列（s2_live・step・steps・signoffs・ap_id）',
  case when (select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'wr_settings' and column_name in ('s2_live','s2_at','s2_by'))
    or (table_name = 'wr_requests' and column_name in ('step','steps','signoffs','ap_id')))) = 7 then 'OK' else 'NG（2 をもう一度流す）' end
union all select '5. 段階 2 の種類（予算・休暇・…・月間行動計画）と状態（反映した・経理の確認待ち）',
  case when (select pg_get_constraintdef(oid) from pg_constraint where conname = 'wr_requests_kind_check') like '%skill_self%plan%'
    and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'wr_requests_status_check') like '%applied%apply_error%acct%' then 'OK' else 'NG（2 をもう一度流す）' end
union all select '6. 前の画面の記録 1 つに申請 1 つ（索引）',
  case when to_regclass('public.wr_requests_ap_idx') is not null and to_regclass('public.wr_requests_budget_idx') is not null then 'OK' else 'NG（2 をもう一度流す）' end
union all select '7. 振り分け：段階 2 → 評価の変更 → 経費（前の段も残っている）',
  case when (select prosrc from pg_proc where oid = to_regprocedure('public.wr_submit(jsonb)')) like '%wr_submit_s2%wr_submit_eval%wr_submit_exp%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.wr_act(jsonb)')) like '%wr_act_s2%wr_act_eval%wr_act_exp%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.wr_actions(jsonb,public.wr_requests)')) like '%wr_actions_s2%wr_actions_eval%wr_actions_exp%'
    and to_regprocedure('public.wr_apply_fresh(public.wr_requests)') is not null
    then 'OK' else 'NG（2 をもう一度流す）' end
union all select '8. SQL の段が 5',
  case when public.wr_stage('{}'::jsonb)->>'stage' = '5' then 'OK' else 'NG（2 をもう一度流す）' end
union all select '9. 段階 2 の関数（14）がそろっている',
  case when (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in
    ('wr_s2_kinds','wr_is_s2','wr_s2_acct','wr_s2_am_kind','wr_s2_store_has_am','wr_s2_steps','wr_s2_live','wr_s2_can_submit','wr_s2_norm',
     'wr_submit_s2','wr_actions_s2','wr_act_s2','wr_live_row','wr_s2_save')) = 14 then 'OK' else 'NG（2 をもう一度流す）' end
union all select '10. G2 も権限の確かめに入ったまま（v1147 の直しが戻っていない）',
  case when (select prosrc from pg_proc where oid = to_regprocedure('public.wr_elevated(jsonb)')) like '%>= 2%' then 'OK' else 'NG（20261116080000_wr_people_g2.sql をもう一度流す）' end
union all select '11. 直し（Codex #149）：送り直しは同じ人・同じ店だけ・予算を出せる人・整数のセント',
  case when (select prosrc from pg_proc where oid = to_regprocedure('public.wr_submit_s2(jsonb)')) like '%o.requester_emp is distinct from%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.wr_submit_s2(jsonb)')) like '%r.store_id is distinct from v_store%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.wr_submit_s2(jsonb)')) like '%''staff''%>= 3%'
    and (select prosrc from pg_proc where oid = to_regprocedure('public.wr_s2_norm(text,jsonb)')) like '%{1,12}%'
    then 'OK' else 'NG（2 をもう一度流す）' end
union all select '（参考）wr_ の関数の数（v1144 の Head Chef の直しが入っていれば 71・無ければ 70）',
  (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'wr\_%')
union all select '（参考）段階 2 を使い始めたか：アプリで GM・CEO が押すまで false', (select coalesce(s2_live, false)::text from public.wr_settings where id = 1)
union all select '（参考）段階 2 の種類の申請',
  (select count(*)::text from public.wr_requests where kind in ('budget','leave','shift','hire','resign','promo','tip_self','skill_self','prep','plan'));
