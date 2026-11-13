-- v1146（2b-8）の SQL だけを戻す。Tip Rate の申請・決定（spl_tip_requests_<名前>・tip_requests）とプレップの時給の表・認定（prep_tables・prep_certs）を、
-- また公開の鍵で書けるようにする（v1145 のあとと同じ）。行・値は何も変えない。v1141・v1143・v1145 の 11 は書けないまま。
-- 成長カルテ・賞与・Career Score・採用・個人の欄（v1139・v1140・v1142・v1144）は外したまま。
-- 2 回流しても同じ。アプリ v1146 は戻さなくても動く（関数 secure-state で書く）。v1145 のグレード履歴も戻すときは、このあと db/secure-grade-hist-rollback.sql。
do $$
begin
  if to_regprocedure('public.ss_guard_key(text)') is null then return; end if;   -- v1141・v1143・v1145・v1146 の SQL が無い（戻すものが無い）
  create or replace function public.ss_guard_key(k text) returns boolean
  language sql immutable parallel safe set search_path = public, pg_temp as $f$
    select coalesce(k in ('mileage_config', 'career_cfg',
                          'cs_criteria', 'bonus_coef', 'bonus_coef_rng', 'bonus_track', 'bonus_eval_rule', 'bonus_eval_ovr', 'cs_strength_rule', 'cs_guide',
                          'grade_hist'), false)
  $f$;
  comment on function public.ss_guard_key(text) is
    'v1145: app_state の、公開の鍵で書けないキー（読むのは今までどおり）。関数 secure-state の swIsKey と同じ決まり（v1141 の 2 つ＋v1143 の 8 つ＋v1145 のグレード履歴）。';
end $$;
notify pgrst, 'reload schema';
