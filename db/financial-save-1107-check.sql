-- v1107：売上・予算の保存が「保存結果がまだ確認できていません」で止まる原因の確かめ（読むだけ。何も書かない・何も変えない）
-- Supabase の SQL Editor に貼って Run。結果の表を Claude に渡してください。金額などの中身は出しません。

-- ① 売上・予算の 20 行：最後に書かれた時刻（ハワイ時間）・サーバーの今より先の時刻か・大きさ
--    in_future が true の行は、端末の時計で書かれた時刻が残っている（その行の保存の答えを、アプリが「新しくなっていない」と読むことがある）
select key,
       to_char(updated_at at time zone 'Pacific/Honolulu', 'YYYY-MM-DD HH24:MI:SS.US') as updated_hst,
       updated_at > now() as in_future,
       octet_length(value::text) as bytes
from app_state
where key ~ '^(daily_actuals_|spl_budgets_v2_)(F01|F02|F03|F03-G|F04-A|F04-K|F04-P|F05|F06|F07)$'
order by key;

-- ② 保存の関数と、呼ぶ役の時間の上限（statement_timeout など）
select p.proname as function_name, p.prosecdef as security_definer, p.proconfig as settings,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('financial_web_commit', 'financial_web_receipt')
order by 1;
select rolname, rolconfig from pg_roles where rolname in ('anon', 'authenticated', 'authenticator') order by 1;

-- ③ 保存の記録の表（名前と列だけ。中身は出さない）
select table_schema, table_name,
       string_agg(column_name || ':' || data_type, ', ' order by ordinal_position) as columns
from information_schema.columns
where table_name ilike '%financial%'
group by 1, 2 order by 1, 2;

-- ④（できれば）保存の関数の中身。長い文が 1 つ出ます。そのまま Claude に渡してください（リポジトリには入れません）
select p.proname, pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('financial_web_commit', 'financial_web_receipt')
order by 1;
