import { createHandler } from './handler.mjs';
// background: a posting answers at once and the QuickBooks send goes on after the answer (Supabase keeps the function running).
const runtime = (globalThis as any).EdgeRuntime;
Deno.serve(createHandler({ env: (key: string) => Deno.env.get(key),
  background: (p: Promise<unknown>) => (runtime && typeof runtime.waitUntil === 'function' ? runtime.waitUntil(p) : p) }));
