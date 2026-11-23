-- 戻す（Career Score 2026 Q4・段階 3-1）：先に関数 secure-state を前の 1 ファイル（deploy/am-office-v1207/1_関数_secure-state_index.ts）に戻してから流す。
-- 関数 11 個を外す。表（csq4_periods・csq4_assign・csq4_evals・csq4_reqs・csq4_log・csq4_runs・csq4_hist）と行は残す
--（評価・記録・写しを消さない。公開の鍵では読めないまま）。2 回流しても同じ。今までの記録（app_state）は写すときも変えていないので戻すものはありません。
drop function if exists public.csq4_hist_copy(text, text, text);
drop function if exists public.csq4_hist_source();
drop function if exists public.csq4_req_answer(bigint, text, text, text, text);
drop function if exists public.csq4_req_add(bigint, text, text, text, text, text);
drop function if exists public.csq4_eval_act(bigint, integer, text, text, jsonb, boolean, text, text, text);
drop function if exists public.csq4_eval_save(bigint, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text);
drop function if exists public.csq4_eval_reeval(text, text, text, bigint, integer, boolean, text, jsonb, text, text, text);
drop function if exists public.csq4_eval_start(text, text, text, integer, jsonb, text, text, text);
drop function if exists public.csq4_assign_save(jsonb, text, text, text);
drop function if exists public.csq4_open_reqs(text, text);
drop function if exists public.csq4_unwrap(jsonb);
