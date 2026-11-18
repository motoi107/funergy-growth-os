// v1190：本番の道（postgrestDb）を通す試験。ほかの試験は db を差し込むので、postgrestDb の関数名の確かめ（wr_・chat_ だけ）を通っていなかった。
// ここでは db を差し込まず、偽の fetch が /rest/v1/rpc/<名前> を PGlite の本物の SQL に渡す。合成データだけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler, postgrestDb } from '../supabase/functions/work-requests/handler.mjs';
import { setup, NAME, KINDS16 } from './approval-rules-world.mjs';

const SRC = fs.readFileSync(new URL('../supabase/functions/work-requests/handler.mjs', import.meta.url), 'utf8');
const RPCS = [...new Set([...SRC.matchAll(/db\.rpc\('([a-z0-9_]+)'/g)].map(m => m[1]))];

test('every RPC name the handler calls passes the PostgREST adapter', async () => {
  assert.ok(RPCS.length > 40 && RPCS.some(n => n.startsWith('ar_')), 'the scan found the ar_ calls');
  const seen = [];
  const db = postgrestDb({ fetch: async u => { seen.push(new URL(u).pathname); return new Response('{}', { status: 200 }); }, url: 'https://db.test', key: 'service' });
  for (const n of RPCS) await db.rpc(n, {});
  assert.deepEqual(seen, RPCS.map(n => '/rest/v1/rpc/' + n));
  await assert.rejects(() => db.rpc('bot_case_write', {}), /bad_rpc/);
  await assert.rejects(() => db.rpc('ar_x;drop', {}), /bad_rpc/);
  await assert.rejects(() => db.rpc('invoice_post', {}), /bad_rpc/);
});

test('the approval rules work end to end through the PostgREST adapter', async () => {
  const w = await setup();
  const fetch = async (u, init = {}) => {
    const path = new URL(u).pathname, m = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(path);
    if (!m || init.method !== 'POST') return new Response('{"message":"not found"}', { status: 404 });
    const p = JSON.parse(init.body).p;
    try { const r = await w.pg.query(`select public.${m[1]}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return new Response(JSON.stringify(r.rows[0].v), { status: 200 }); }
    catch (e) { return new Response(JSON.stringify({ message: String(e.message) }), { status: 400 }); }
  };
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], fetch,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  let n = 0;
  const call = async (who, body) => { const r = await handler(new Request('https://fn.test/work-requests', { method: 'POST', body: JSON.stringify({ pin_session: 'pin-' + who, ...body }) })); return { status: r.status, body: await r.json() }; };
  const ok = async (who, body) => { const r = await call(who, body); assert.equal(r.status, 200, body.action + ' ' + JSON.stringify(r.body)); return r.body; };

  const me = await ok('E2', { action: 'whoami' });
  assert.equal(me.fn, 13); assert.equal(me.sql, 8); assert.ok(me.ar && me.ar.admin === true);
  let st = await ok('E2', { action: 'ar_state' });
  assert.equal(st.kinds.length, 16);
  for (const k of st.kinds) if (k.draft) await ok('E2', { action: 'ar_rule_activate', kind: k.kind, expect_rev: k.draft.rev, note: '確かめた' });
  st = await ok('E2', { action: 'ar_state' });
  assert.ok(st.kinds.every(k => KINDS16.includes(k.kind) && k.active));
  const pv = await ok('E2', { action: 'ar_rule_preview', kind: 'reimburse', store_id: 'S1', amount_cents: 5000, requester: 'E6' });
  assert.ok(pv.route && pv.route.stages.length >= 1);
  await ok('E2', { action: 'ar_role_list' }); await ok('E2', { action: 'ar_delegate_list' }); await ok('E2', { action: 'ar_stuck' });
  await ok('E2', { action: 'ar_go_live', expect_rev: st.rev, note: '使い始め' });

  const r = await ok('E6', { action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: 'k-pgrst-' + (++n).toString().padStart(4, '0'),
    payload: { date: w.today, payer: 'x', vendor: 'Costco', purpose: 'その他', amount_cents: 6000 } });
  assert.ok(r.route, 'the request has a route');
  const b = await ok('E2', { action: 'bulk_approve', items: [{ id: r.id, rev: r.rev }], client_key: 'k-pgrst-bulk-0001' });
  assert.equal(b.results.length, 1); assert.equal(b.results[0].outcome, 'final');
  // 前の版の関数の決まり（wr_・chat_ だけ）では ar_ を通さなかったこと
  assert.ok(!/^(wr|chat)_[a-z0-9_]+$/.test('ar_state'));
});
