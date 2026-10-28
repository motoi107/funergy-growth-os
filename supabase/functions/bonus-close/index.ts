import { createHandler } from './handler.mjs';

// bonus-close（v1109）：メールで認証した CEO・GM が書き、経理は読むだけ。Verify JWT は OFF（関数の中で確かめる）。
Deno.serve(createHandler({ env: (key: string) => Deno.env.get(key) }));
