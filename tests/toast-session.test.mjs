// App v1061: every call to hyper-worker (Toast sync) carries the login token that auth-pin v1061 returns
// when a PIN check passes. hyper-worker v1061 uses it to tell logged-in app calls from anyone else.
// Runs the real functions from index.html in a VM with synthetic state. No network, no storage.
// FUNERGY_INDEX=<path> runs the same checks against another build (v1060 fails them).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// Source of one top-level function declaration, braces matched outside strings, template literals and comments.
function fnSrc(name) {
  const m = new RegExp('^(async )?function ' + name.replace(/\$/g, '\\$') + '\\(', 'm').exec(SRC);
  if (!m) throw new Error('function not found: ' + name);
  let i = SRC.indexOf('{', m.index), depth = 0, q = null, tpl = [];
  for (; i < SRC.length; i++) {
    const ch = SRC[i], nx = SRC[i + 1];
    if (q) {
      if (ch === '\\') { i++; continue; }
      if (q === '`' && ch === '$' && nx === '{') { tpl.push(depth); depth++; q = null; i++; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '/' && nx === '/') { i = SRC.indexOf('\n', i); continue; }
    if (ch === '/' && nx === '*') { i = SRC.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (tpl.length && depth === tpl[tpl.length - 1]) { tpl.pop(); q = '`'; continue; }
      if (depth === 0) return SRC.slice(m.index, i + 1);
    }
  }
  throw new Error('unterminated: ' + name);
}

const tok = (exp) => 'v1.' + Buffer.from(JSON.stringify({ sc: 'staff', k: 'Leader B', iat: 1, exp })).toString('base64url') + '.c2ln';
function app({ session = null, login = null } = {}) {
  const c = {
    window: {}, toasts: [], sent: [], curLang: 'ja', t: (ja) => ja, showToast: (m, k) => c.toasts.push([m, k]),
    SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON: 'anon', TOAST_SYNC_FN: 'https://example.invalid/functions/v1/hyper-worker',
    atob: (x) => Buffer.from(x, 'base64').toString('binary'), STORES: [{ id: 'F01', toastGuid: 'g1' }], getBowlCatCfgByGuid: () => null, tipSplitHourFor: () => 16,
    supaHeaders: () => ({}), LOGIN_PIN_TIMEOUT: 1, setTimeout: (f) => f(),
    fetch: async (url, init) => { c.sent.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({}) }; },
    _loginFetchT: async () => ({ ok: true, json: async () => login }), _loginServerPing: () => Promise.resolve(true),
  };
  c.window._hwSession = session;
  vm.createContext(c);
  let code = ['toastFnBody', 'authPinCheck', 'syncToastDay', 'fetchToastRestaurants', 'syncToastMenuFetch'].map(n => { try { return fnSrc(n); } catch (_e) { return ''; } }).join('\n');
  vm.runInContext(code, c);
  return c;
}
const run = (c, e) => vm.runInContext(e, c);

test('every call to hyper-worker sends its body through toastFnBody', () => {
  const calls = [...SRC.matchAll(/fetch\(TOAST_SYNC_FN,/g)].map(m => m.index);
  assert.equal(calls.length, 12);
  for (const at of calls) {
    const seg = SRC.slice(at, at + 400);
    const body = /body\s*:\s*([A-Za-z_]+)\(/.exec(seg);
    assert.ok(body, seg.slice(0, 120));
    assert.equal(body[1], 'toastFnBody', seg.slice(0, 160));
  }
});

test('toastFnBody adds the login token when there is one, and leaves the request otherwise as before', () => {
  const c = app({ session: tok(4102444800) });
  const input = { restaurantGuid: 'g1', mode: 'tipLabor', businessDate: '20261001' };
  const out = JSON.parse(run(c, 'toastFnBody')(input));
  assert.deepEqual(out, { ...input, session: tok(4102444800) });
  assert.equal('session' in input, false, 'the caller\'s object is not changed');
  assert.deepEqual(JSON.parse(run(app(), 'toastFnBody')(input)), input);
  assert.equal(run(app(), 'toastFnBody')(), '{}');
  assert.equal(c.toasts.length, 0);
});

test('an expired token: one notice to log in again, the call still goes out', () => {
  const c = app({ session: tok(1000) });
  run(c, 'toastFnBody({a:1})'); run(c, 'toastFnBody({a:2})');
  assert.equal(c.toasts.length, 1);
  assert.match(c.toasts[0][0], /ログインし直して/);
});

test('the PIN check keeps the token from auth-pin; a failed check keeps nothing new', async () => {
  const c = app({ login: { ok: true, token: 'v1.a.b' } });
  assert.deepEqual({ ...(await run(c, 'authPinCheck')('staff', 'Leader B', '4321')) }, { ok: true, server: false });
  assert.equal(c.window._hwSession, 'v1.a.b');
  const n = app({ login: { ok: true }, session: 'old' });
  await run(n, 'authPinCheck')('store', 'F01', '1111');
  assert.equal(n.window._hwSession, null, 'auth-pin without a token (older auth-pin, or not issued): no token');
  const f = app({ login: { ok: false }, session: 'keep' });
  assert.equal((await run(f, 'authPinCheck')('staff', 'X', '0000')).ok, false);
  assert.equal(f.window._hwSession, 'keep');
});

test('the sync calls really send it; logging out forgets it', async () => {
  const c = app({ session: 'v1.p.s' });
  await run(c, 'syncToastDay')('g1', '20261001');
  await run(c, 'fetchToastRestaurants')();
  await run(c, 'syncToastMenuFetch')('g1', 'p');
  assert.equal(c.sent.length, 3);
  for (const s of c.sent) assert.equal(s.body.session, 'v1.p.s');
  assert.equal(c.sent[0].body.restaurantGuid, 'g1');
  assert.match(fnSrc('doLogout'), /window\._hwSession = null/);
});
