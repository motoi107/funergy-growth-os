import { createHandler } from './handler.mjs';

// device-login（v1183・ログインの試し）。Verify JWT は OFF（関数の中で確かめる）。
// ログインの印を作る部品（signMark）は公開しない 1 ファイルにだけ入れる。ここでは null（印が要る操作は 503 sign_missing・データは変えない）。
Deno.serve(createHandler({ env: (key: string) => Deno.env.get(key), signMark: null }));
