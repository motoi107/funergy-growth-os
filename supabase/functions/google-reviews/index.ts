import { createHandler } from './handler.mjs';

// google-reviews（v1157）：Google の口コミ。Places API（見るときに取る・残さない）と Business Profile API（毎日 4:30 に取る）。
// Verify JWT は OFF（関数の中で確かめる）。PIN のログインの印は work-requests の whoami に確かめてもらう（PIN を確かめるコードは入れない）。
// 鍵は Supabase の Secrets：GOOGLE_PLACES_API_KEY・GBP_OAUTH_CLIENT_ID／SECRET（無ければ GMAIL_OAUTH_CLIENT_ID／SECRET）。このファイルのまま貼ってよい。
Deno.serve(createHandler({ env: (key: string) => Deno.env.get(key) }));
