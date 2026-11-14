import { createHandler } from './handler.mjs';

// PIN のログインの印（auth-pin が出す body.pin_session）を確かめて { emp_id, name } を返す関数。
// auth-pin と同じ鍵・形で確かめるため、そのコードはこの公開のリポジトリに置かない：Supabase に入れる 1 ファイル
// （Moto さんに直接渡す・v1131）がこの null の代わりに入れる。このまま動かすと、どの呼び出しも 'pin_check_missing'（503）になる。
const verifyPin = null;

// v1161：添付のあと片づけ（消したメッセージのファイルなど）は答えを返したあとに裏で（Supabase の EdgeRuntime.waitUntil）
const waitUntil = (p: Promise<unknown>) => (globalThis as any).EdgeRuntime?.waitUntil?.(p);

Deno.serve(createHandler({ env: (key: string) => Deno.env.get(key), verifyPin, waitUntil }));
