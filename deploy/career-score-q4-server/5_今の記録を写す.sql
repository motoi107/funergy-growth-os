-- Career Score 2026 Q4・段階 3-1：今までの Career Score の記録を、読むだけの履歴（csq4_hist）に写す。Supabase の SQL Editor で流す。
-- 元（app_state の lss_emp_・spl_lss_history_・spl_lss_requests_・lss_scores など、賞与の固定 csFreeze、オフィス用 ocs_ev_）は変えません・消しません。
-- 何度流しても同じ中身は 2 回写しません（元が変わっていれば、前の行を残して新しい行を足します）。
-- 期間の無い記録（lss_emp_ など）は「期間未確認」のまま（保存した日で四半期を決めません）。2026-Q4 の記録は「Q4・旧制度」として写すだけで、新しい評価には使いません。
-- 答えの report は数だけです（名前は出ません）。Claude との会話にだけ貼ってください。
select public.csq4_hist_copy('sql', null, null) as report;
