-- 戻す（キャリア・育成 A-2）：先に関数 secure-state を前の 1 ファイル（deploy/career-score-q4-server/4_関数_secure-state_index.ts など、gpfn の無いもの）に戻してから流す。
-- 関数 7 個を外す。表（gp_plans・gp_tasks・gp_notes・gp_log・gp_runs・gp_legacy）と行は残す（計画・OJT・記録・写しを消さない。公開の鍵では読めないまま）。
-- 2 回流しても同じ。旧の記録（app_state）は写すときも変えていないので戻すものは無い。
drop function if exists public.gp_legacy_copy(text, text, text, text);
drop function if exists public.gp_legacy_source();
drop function if exists public.gp_note_add(bigint, bigint, text, text, text, text, text, text);
drop function if exists public.gp_task_act(bigint, integer, text, text, text, text, text);
drop function if exists public.gp_task_save(bigint, bigint, integer, jsonb, text, text, text);
drop function if exists public.gp_plan_close(bigint, integer, text, text, text, text);
drop function if exists public.gp_plan_save(bigint, integer, text, text, jsonb, text, text, text);
