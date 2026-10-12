-- 中間レビュー：どちらの手順になるかを決めるだけの SQL（読むだけ。何も変えません）
-- Supabase → SQL Editor に貼って Run し、出た数字を見てください。
--   0  → まだ土台が入っていない。手順.md の【ケース 1（初回）】
--   7  → 土台は入っている。手順.md の【ケース 2（直しだけ）】
--   それ以外（1〜6）→ 流しかけで止まっている可能性。Claude に数字を伝えてください。
select count(*) as mr_tables_0か7
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'mr\_%';
