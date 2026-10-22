-- v1104：売上・予算の保存と取り込みの確かめ（読むだけ。何も書かない・何も変えない）
-- Supabase の SQL Editor に貼って Run。結果の表（3 つ）を Claude に渡してください。
-- 中身（金額など）は出しません。キー・時刻・大きさ・値の数だけです。

-- ① 関数があるか（app_state_index：v1098 の「変わった行だけ取る」。無いとログインのたびに全部を取る）
--    （financial_web_commit・financial_web_receipt：v1101 の売上・予算の保存）
select p.proname as function_name, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('app_state_index', 'financial_web_commit', 'financial_web_receipt')
order by 1;

-- ② 売上（daily_actuals_）・予算（spl_budgets_v2_）の 20 行：最後に書かれた時刻（ハワイ時間）・大きさ・値の数
--    v1101〜v1103 では、使っている端末から売上・予算を保存できず、Toast の売上の反映も止まっていた。
--    10/21 15:07 HST（v1101 の公開）より後に書かれていない行が多ければ、その影響が本番にも出ていたことになる。
--    nodes は 1 行の中の値の数（v1101 の確かめは 1 回あたり 20 万まで。v1103 までは 20 行の合計で数えていた）。
select key,
       to_char(updated_at at time zone 'Pacific/Honolulu', 'YYYY-MM-DD HH24:MI:SS') as updated_hst,
       octet_length(value::text) as bytes,
       jsonb_array_length(jsonb_path_query_array(value::jsonb, 'strict $.**')) as nodes
from app_state
where key ~ '^(daily_actuals_|spl_budgets_v2_)(F01|F02|F03|F03-G|F04-A|F04-K|F04-P|F05|F06|F07)$'
order by key;

-- ③ 合計（v1103 までは起動のときに 20 行をまとめて確かめていた。合計が 20 万を超えると毎回失敗していた）
select count(*) as rows,
       sum(octet_length(value::text)) as bytes,
       sum(jsonb_array_length(jsonb_path_query_array(value::jsonb, 'strict $.**'))) as nodes,
       count(*) filter (where updated_at >= timestamptz '2026-10-21 15:07:00-10') as written_after_v1101
from app_state
where key ~ '^(daily_actuals_|spl_budgets_v2_)(F01|F02|F03|F03-G|F04-A|F04-K|F04-P|F05|F06|F07)$';
