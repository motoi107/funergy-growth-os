import { createHandler } from './handler.mjs';

// payroll-expense（v1212・B-2）：Payroll 別のガソリン代・立替経費。仕様：docs/PAYROLL_EXPENSE_V1212_JA.md
// Verify JWT は OFF（関数の中で確かめる）。PIN のログインの印は work-requests の whoami に確かめてもらう（PIN を確かめるコードは入れない）。
// 鍵は入っていない（Supabase が入れる SUPABASE_URL・SUPABASE_SERVICE_ROLE_KEY・SUPABASE_ANON_KEY だけ）。このファイルのまま貼ってよい。
Deno.serve(createHandler({ env: (key: string) => Deno.env.get(key) }));
