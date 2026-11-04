import { createHandler } from './handler.mjs';

// secure-state（v1139・v1140）：成長カルテ・賞与と Career Score のキーを、公開の鍵ではなくこの関数で読み書きする。Verify JWT は OFF（関数の中で確かめる）。
// PIN のログインの印は work-requests の whoami に確かめてもらう（PIN を確かめるコードはこの関数には入れない）。このファイルのまま貼ってよい。
Deno.serve(createHandler({ env: (key: string) => Deno.env.get(key) }));
