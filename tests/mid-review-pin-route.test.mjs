// 中間レビュー v1122 の入り方：本文の PIN の印が入り方を決める（Authorization の鍵の文字に左右されない）。
// PIN の確かめの無い関数は 'pin_check_missing'。断るときは理由をログに（印・鍵・名前は出さない）。
// Synthetic only: a stand-in database (rpc) and a stand-in PIN check. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/mid-review/handler.mjs';

const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key-of-the-function' })[k];
function make({ verifyPin = async tok => (tok === 'good-mark' ? { name: 'GM Test' } : tok === 'mark-with-id' ? { emp_id: 'E2', name: 'GM Test' } : null) } = {}) {
  const calls = [], emailCalls = [];
  const db = { async rpc(name, p) { calls.push([name, p]); if (name === 'mr_pin_actor') return { user_id: 'u-gm' }; if (name === 'mr_whoami') return { ok: true, who: p.actor, via: p.via }; return {}; } };
  const fetch = async (url, init) => { emailCalls.push(String(url)); return new Response(JSON.stringify({ id: 'u-email' }), { status: 200 }); };
  const h = createHandler({ env, fetch, db, verifyPin });
  const call = async (body, auth) => {
    const r = await h(new Request('https://fn.test', { method: 'POST', headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) }));
    return { status: r.status, body: await r.json() };
  };
  return { call, calls, emailCalls };
}
const quiet = async fn => { const w = console.warn, logged = []; console.warn = (...a) => logged.push(a.join(' ')); try { await fn(); } finally { console.warn = w; } return logged; };

test('a PIN mark decides the way in even when the app\'s anon key is not the function\'s setting', async () => {
  const S = make();
  // the app sends its own anon key (another string than the function's SUPABASE_ANON_KEY)
  const r = await S.call({ action: 'whoami', pin_session: 'good-mark' }, 'Bearer the-anon-key-the-app-holds');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.who, r.body.via], ['u-gm', 'pin']);
  assert.deepEqual(S.emailCalls, [], 'no email sign-in was tried');
  assert.deepEqual(S.calls[0], ['mr_pin_actor', { emp_id: null, name: 'GM Test' }]);
  // the employee id from the mark goes to the database too
  const S2 = make();
  assert.equal((await S2.call({ action: 'whoami', pin_session: 'mark-with-id' }, 'Bearer anon-key-of-the-function')).status, 200);
  assert.deepEqual(S2.calls[0], ['mr_pin_actor', { emp_id: 'E2', name: 'GM Test' }]);
});

test('a bad PIN mark is refused (401) with a reason in the log, and the email bearer next to it does not let it in', async () => {
  const S = make();
  let r;
  const log = await quiet(async () => { r = await S.call({ action: 'whoami', pin_session: 'forged' }, 'Bearer a-real-user-token'); });
  assert.equal(r.status, 401); assert.equal(r.body.error, 'unauthorized');
  assert.deepEqual(S.emailCalls, [], 'the PIN mark decides: no email sign-in');
  assert.equal(S.calls.length, 0, 'nothing reached the database');
  assert.ok(log.some(l => /mid-review unauthorized whoami pin_mark/.test(l)), log.join('\n'));
  assert.ok(!log.some(l => /forged|a-real-user-token|GM Test/.test(l)), 'no mark, key or name in the log');
  for (const [tok, why] of [['', 'pin_shape'], [42, 'pin_shape'], ['x'.repeat(4001), 'pin_shape']]) {
    const lg = await quiet(async () => { r = await S.call({ action: 'whoami', pin_session: tok }, 'Bearer anon-key-of-the-function'); });
    assert.equal(r.status, 401); assert.ok(lg.some(l => l.endsWith(why)), why);
  }
  const S3 = make({ verifyPin: async () => { throw new Error('boom'); } });
  const lg3 = await quiet(async () => { r = await S3.call({ action: 'whoami', pin_session: 'good-mark' }); });
  assert.equal(r.status, 401); assert.ok(lg3.some(l => l.endsWith('pin_check_error')));
  const S4 = make({ verifyPin: async () => ({ name: '  ' }) });
  const lg4 = await quiet(async () => { r = await S4.call({ action: 'whoami', pin_session: 'good-mark' }); });
  assert.equal(r.status, 401); assert.ok(lg4.some(l => l.endsWith('pin_who')));
});

test('a function without the PIN check says so (503 pin_check_missing), not "unauthorized"', async () => {
  const S = make({ verifyPin: null });
  const r = await S.call({ action: 'whoami', pin_session: 'good-mark' }, 'Bearer anon-key-of-the-function');
  assert.equal(r.status, 503); assert.equal(r.body.error, 'pin_check_missing');
  assert.equal(S.calls.length, 0);
});

test('without a PIN mark: the email sign-in works as before, the anon key alone or nothing is refused', async () => {
  const S = make();
  const r = await S.call({ action: 'whoami' }, 'Bearer a-real-user-token');
  assert.equal(r.status, 200); assert.deepEqual([r.body.who, r.body.via], ['u-email', 'email']);
  assert.equal(S.emailCalls.length, 1);
  let r2;
  const log = await quiet(async () => { r2 = await S.call({ action: 'whoami' }, 'Bearer anon-key-of-the-function'); });
  assert.equal(r2.status, 401); assert.ok(log.some(l => l.endsWith('none')));
  const r3 = await quiet(async () => { assert.equal((await S.call({ action: 'whoami' })).status, 401); });
  assert.ok(r3.length === 1);
  // the database says no → 403 forbidden (as before)
  const S5 = make();
  S5.calls.length = 0;
  const h = createHandler({ env, fetch: async () => { throw new Error('no'); }, db: { async rpc(n) { if (n === 'mr_pin_actor') throw new Error('forbidden'); return {}; } }, verifyPin: async () => ({ name: 'X' }) });
  const rr = await h(new Request('https://fn.test', { method: 'POST', body: JSON.stringify({ action: 'whoami', pin_session: 'good-mark' }) }));
  assert.equal(rr.status, 403); assert.equal((await rr.json()).error, 'forbidden');
});
