import { createHandler } from './handler.mjs';

// secure-state（v1139・v1140・v1141・v1142）：成長カルテ・賞与・Career Score・採用・お悩み相談室のキーを、公開の鍵ではなくこの関数で読み書きする。Verify JWT は OFF（関数の中で確かめる）。
// PIN のログインの印は work-requests の whoami に確かめてもらう（PIN を確かめるコードはこの関数には入れない）。このファイルのまま貼ってよい。
Deno.serve(createHandler({ env: (key: string) => Deno.env.get(key) }));
