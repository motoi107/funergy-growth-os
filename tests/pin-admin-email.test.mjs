// App v1067 (Moto 2026-10-12): the PIN list, PIN resets, store PIN changes, new hires' confidential details and the
// move of those details open only after the email sign-in (the same sign-in as Invoice intake and the Operations Bot).
// The app no longer asks for the manager's own PIN for these. When a PIN login is paused after repeated mistakes,
// the login screen and "my PIN" say so instead of "Incorrect PIN"; the PIN list shows who is locked.
// Runs the real functions from index.html in a VM with stand-in network and screens. No real network.
// FUNERGY_INDEX=<path> runs the same checks against another build (v1066 fails them).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// renderPinListBody has a regex literal with a quote (/'/g) that the brace matcher below cannot read: cut it at the next function.
const CUT = { renderPinListBody: 'async function resetStaffPin(' };
function fnSrc(name) {
  if (CUT[name]) { const a = SRC.indexOf('function ' + name + '('), b = SRC.indexOf(CUT[name], a); if (a < 0 || b < 0) throw new Error('function not found: ' + name); return SRC.slice(a, b); }
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

const FNS = ['secAuthSession', 'secAuthEnsure', 'secAuthCall', 'secAuthNeedLogin', 'secAuthErrText', 'secAuthLoginModal', 'secAuthLogin',
  'pinLockLeft', 'pinLocksMap', 'pinLockLeftSec', '_loginLockedMsg', 'canViewPins', 'openPinListModal', '_staffPinView', 'renderPinListBody',
  'resetStaffPin', 'editStorePin', 'openObSecret', 'runObMigrate', 'obImgSrc', 'authPin', 'authPinCheck', 'doStaffLogin', 'saveMyPin'];
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const IMG = 'data:image/jpeg;base64,QUJDRA==';
const tick = () => new Promise(r => setImmediate(r));

// One page. session: the email sign-in already in this tab (or null). fn: answers of auth-pin / ob-private by action.
function app({ role = 'gm', session = { access_token: 'acc-1', refresh_token: 'ref-1' }, kept = null, fn = {}, inputs = [], confirmAnswer = true, dom = {}, login = null } = {}) {
  const c = {
    reqs: [], modals: [], alerts: [], toasts: [], rerenders: [], curRole: role, curUserName: 'GM Test', curLang: 'ja',
    t: (ja, en) => (c.curLang === 'en' ? en : ja), escapeHtml: esc, window: {}, console,
    STORES: [{ id: 'F01', name: 'Store A' }, { id: 'F02', name: 'Store B' }],
    getEmployees: () => [{ name: 'Alice', store: 'F01', status: '在籍' }, { name: "O'Neil", store: 'F02', status: '在籍' }, { name: 'Gone', store: 'F01', status: '退職' }],
    openModal: h => c.modals.push(h), closeModalDirect: () => {}, alert: m => c.alerts.push(m), showToast: (m, k) => c.toasts.push([m, k]),
    renderPage: p => c.rerenders.push(p), confirm: () => confirmAnswer, pullOpKey: async () => true,
    askInput: async () => (inputs.length ? inputs.shift() : null),
    SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON: 'anon',
    _botSession: session, keptRt: kept,
    invInSession: () => c._botSession, invInSigned: () => !!(c._botSession && c._botSession.access_token),
    invInKept: () => (c.keptRt ? { rt: c.keptRt } : null),
    invInRestore: async () => { c.restored = (c.restored || 0) + 1; if (c.keptRt) c._botSession = { access_token: 'acc-kept', refresh_token: c.keptRt + '+' }; return !!c.keptRt; },
    invInSessionRefresh: async (s) => { c.refreshed = (c.refreshed || 0) + 1; const ns = { access_token: s.access_token + '-new', refresh_token: s.refresh_token + '+' }; c._botSession = ns; return ns; },
    invInKeepBoxHtml: (what) => '<keep:' + (what ? what[0] : 'default') + '>',
    invInLogin: async () => { c.logins = (c.logins || 0) + 1; if (c.loginWorks !== false) c._botSession = { access_token: 'acc-login', refresh_token: 'ref-login' }; },
    document: { getElementById: k => dom[k] || null },
    supaHeaders: () => ({ apikey: 'anon', Authorization: 'Bearer anon' }), LOGIN_PIN_TIMEOUT: 1, setTimeout: (f) => { f(); return 1; },
    _loginServerPing: () => Promise.resolve(true), _loginServerDownMsg: () => 'SERVER DOWN',
    _loginFetchT: async (url, init) => { c.reqs.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return { ok: true, json: async () => login }; },
    STORE_LOGIN: null, loginStoreMode: false, loginLocation: 'F01', loginPerson: null, enterAppWithSync: () => { c.entered = true; },
    fetch: async (url, init) => {
      const name = String(url).replace('https://example.invalid/functions/v1/', '');
      const body = JSON.parse(init.body);
      c.reqs.push({ fn: name, body, auth: init.headers.Authorization, apikey: init.headers.apikey });
      const a = fn[name + ':' + body.action];
      const r = typeof a === 'function' ? await a(body, init.headers.Authorization) : a;
      if (r && r.__status) return { ok: false, status: r.__status, json: async () => { throw new Error('not json'); } };
      return { ok: true, status: 200, json: async () => r };
    },
  };
  vm.createContext(c);
  vm.runInContext('var _secAuthAfter = null;\n' + FNS.map(fnSrc).join('\n'), c);
  c.run = src => vm.runInContext(src, c);
  return c;
}

test('PIN list: sent with the email sign-in only (no manager name or PIN); shows PINs, who is locked, and stopped stores', async () => {
  const c = app({ fn: { 'auth-pin:list': { ok: true, staffPins: { Alice: '4321' }, storePins: {}, defaultStaff: '0000', defaultStore: {}, locks: [{ k: 'staff:Alice', retry_after: 600 }, { k: 'store:F02', retry_after: 7200 }] } } });
  await c.run('openPinListModal()');
  assert.equal(c.reqs.length, 1);
  assert.deepEqual(c.reqs[0], { fn: 'auth-pin', body: { action: 'list' }, auth: 'Bearer acc-1', apikey: 'anon' });
  const h = c.modals.at(-1);
  assert.match(h, /ログインPIN一覧/); assert.match(h, />4321</); assert.match(h, />0000</, 'default for people without their own PIN');
  assert.match(h, /Alice<div[^]*?ロック中・あと約 10 分/);
  assert.doesNotMatch(h, /O&#39;Neil[^]*?ロック中|O'Neil<div[^<]*<\/div><div[^>]*>[^<]*ロック中/);
  assert.match(h, /店舗のログインで止まっているもの：Store B（あと約 2 時間）/);
  assert.doesNotMatch(h, /Gone/);
  assert.equal(c.alerts.length, 0);
});

test('PIN list: not signed in → the email sign-in screen (nothing sent); after signing in the list opens by itself', async () => {
  const c = app({ session: null, fn: { 'auth-pin:list': { ok: true, staffPins: {}, storePins: {}, locks: [] } } });
  await c.run('openPinListModal()');
  assert.equal(c.reqs.length, 0);
  assert.match(c.modals.at(-1), /PIN一覧の表示：メール認証/);
  assert.match(c.modals.at(-1), /<keep:PIN の一覧・変更・機密情報・Invoice取込・業務Bot>/);
  assert.match(c.modals.at(-1), /onclick="secAuthLogin\(\)"/);
  await c.run('secAuthLogin()'); await tick();
  assert.equal(c.reqs.length, 1); assert.equal(c.reqs[0].auth, 'Bearer acc-login');
  assert.match(c.modals.at(-1), /ログインPIN一覧/);
});

test('PIN list: a sign-in remembered on this device is used first (no email screen)', async () => {
  const c = app({ session: null, kept: 'ref-k', fn: { 'auth-pin:list': { ok: true, staffPins: {}, storePins: {}, locks: [] } } });
  await c.run('openPinListModal()');
  assert.equal(c.restored, 1); assert.equal(c.reqs[0].auth, 'Bearer acc-kept');
  assert.match(c.modals.at(-1), /ログインPIN一覧/);
});

test('sign-in expired → refreshed once and sent again; an account the server does not accept right after signing in gets a message, not a loop', async () => {
  let n = 0;
  const c = app({ fn: { 'auth-pin:list': (b, auth) => (++n === 1 ? { ok: false, error: 'email_required' } : { ok: true, staffPins: {}, storePins: {}, locks: [] }) } });
  await c.run('openPinListModal()');
  assert.equal(c.refreshed, 1); assert.deepEqual(c.reqs.map(r => r.auth), ['Bearer acc-1', 'Bearer acc-1-new']);
  assert.match(c.modals.at(-1), /ログインPIN一覧/);

  const d = app({ session: null, fn: { 'auth-pin:list': { ok: false, error: 'email_required' } } });
  await d.run('openPinListModal()');
  await d.run('secAuthLogin()'); await tick();
  assert.equal(d.modals.filter(h => /メール認証/.test(h)).length, 1, 'no second sign-in screen');
  assert.match(d.alerts.at(-1), /このメールのアカウントでは PIN の一覧・変更を開けません（GM・CEO として登録されたメールだけ）/);
});

test('messages: forbidden, server down, an old server', async () => {
  for (const [ans, re] of [[{ ok: false, error: 'forbidden' }, /GM・CEO として登録されたメールだけ/], [{ ok: false, error: 'db_unavailable' }, /サーバーにつながりません/], [{ ok: false }, /サーバーが古い版のままかもしれません/], [{ __status: 503 }, /サーバーにつながりません/]]) {
    const c = app({ fn: { 'auth-pin:list': ans } });
    await c.run('openPinListModal()');
    assert.match(c.alerts.at(-1), re, JSON.stringify(ans));
    assert.equal(c.modals.length, 0);
  }
  const g = app({ role: 'office' });
  await g.run('openPinListModal()');
  assert.equal(g.reqs.length, 0, 'the button is GM/CEO only on the screen too');
});

test('PIN reset: sent with the email sign-in; the list updates and the lock goes away', async () => {
  const c = app({ inputs: ['2468'], fn: { 'auth-pin:list': { ok: true, staffPins: { Alice: '4321' }, storePins: {}, locks: [{ k: 'staff:Alice', retry_after: 600 }] }, 'auth-pin:reset': { ok: true } } });
  await c.run('openPinListModal()');
  await c.run("resetStaffPin('Alice')");
  assert.deepEqual(c.reqs[1], { fn: 'auth-pin', body: { action: 'reset', scope: 'staff', target: 'Alice', newPin: '2468' }, auth: 'Bearer acc-1', apikey: 'anon' });
  assert.match(c.modals.at(-1), />2468</); assert.doesNotMatch(c.modals.at(-1), /ロック中・あと/);
  assert.equal(c.toasts.at(-1)[0], 'Alice のPINを更新しました');
  const d = app({ inputs: ['2468'], fn: { 'auth-pin:list': { ok: true, staffPins: {}, storePins: {}, locks: [] }, 'auth-pin:reset': { ok: false, error: 'forbidden' } } });
  await d.run('openPinListModal()'); await d.run("resetStaffPin('Alice')");
  assert.match(d.alerts.at(-1), /GM・CEO として登録されたメールだけ/);
});

test('store PIN change: email sign-in first, then the new PIN; sent as scope store', async () => {
  const c = app({ session: null, inputs: ['123456'], fn: { 'auth-pin:reset': { ok: true } } });
  await c.run("editStorePin('F01','Store A')");
  assert.equal(c.reqs.length, 0); assert.match(c.modals.at(-1), /店舗PINの変更：メール認証/);
  await c.run('secAuthLogin()'); await tick(); await tick();
  assert.deepEqual(c.reqs[0], { fn: 'auth-pin', body: { action: 'reset', scope: 'store', target: 'F01', newPin: '123456' }, auth: 'Bearer acc-login', apikey: 'anon' });
  assert.deepEqual(c.rerenders, ['store_master']);
  const g = app({ role: 'office' });
  await g.run("editStorePin('F01','Store A')");
  assert.match(g.alerts[0], /GM\/CEOのみ/); assert.equal(g.reqs.length, 0);
});

test('confidential details: email sign-in (accounting, GM, CEO); only image data is drawn as an image', async () => {
  const secret = { address: '<b>A</b>', ssn: '123-45-6789', docs: [{ name: 'Passport', image: IMG }, { name: 'Bad', image: 'x" onerror="alert(1)' }, { name: 'Svg', image: 'data:image/svg+xml;base64,PHN2Zz4=' }] };
  const c = app({ role: 'office', fn: { 'ob-private:get': { ok: true, secret } } });
  await c.run("openObSecret('ob1')");
  assert.deepEqual(c.reqs[0], { fn: 'ob-private', body: { action: 'get', obId: 'ob1' }, auth: 'Bearer acc-1', apikey: 'anon' });
  const h = c.modals.at(-1);
  assert.match(h, /123-45-6789/); assert.match(h, /&lt;b&gt;A&lt;\/b&gt;/);
  assert.equal((h.match(/<img /g) || []).length, 1, 'only the real image');
  assert.doesNotMatch(h, /onerror|svg\+xml/);
  assert.match(h, /Bad（画像なし）/);
  const f = app({ role: 'office', fn: { 'ob-private:get': { ok: false, error: 'forbidden' } } });
  await f.run("openObSecret('ob1')");
  assert.match(f.alerts.at(-1), /経理・GM・CEO として登録されたメールだけ/);
  const s = app({ role: 'crew' });
  await s.run("openObSecret('ob1')");
  assert.equal(s.reqs.length, 0);
});

test('move to the protected area: GM/CEO, asks to confirm once, email sign-in', async () => {
  const c = app({ session: null, fn: { 'ob-private:migrate': { ok: true, moved: 2, failed: 0, total: 5 } } });
  let asked = 0; c.confirm = () => { asked++; return true; };
  await c.run('runObMigrate()');
  assert.equal(asked, 1); assert.match(c.modals.at(-1), /機密情報の移行：メール認証/);
  await c.run('secAuthLogin()'); await tick(); await tick();
  assert.equal(asked, 1, 'not asked again after signing in');
  assert.deepEqual(c.reqs[0], { fn: 'ob-private', body: { action: 'migrate' }, auth: 'Bearer acc-login', apikey: 'anon' });
  assert.equal(c.toasts.at(-1)[0], '2件の機密情報を保護領域へ移行しました');
  const o = app({ role: 'office' }); await o.run('runObMigrate()'); assert.equal(o.reqs.length, 0);
});

test('login: a paused login says so (not "Incorrect PIN"); wrong PIN and server trouble keep their messages', async () => {
  const run = async (answer, store = true) => {
    const errEl = { textContent: '', style: {} }, btn = { disabled: false, dataset: {}, textContent: 'ログイン' };
    const c = app({ login: answer, dom: { 'login-pin-err': errEl, 'login-pin-btn': btn, 'login-pin-input': { value: '1234' } } });
    c.loginStoreMode = store; c.loginPerson = store ? null : { name: 'Alice' };
    c.run('doStaffLogin()'); for (let i = 0; i < 6; i++) await tick();
    return { c, msg: errEl.textContent, btn };
  };
  const a = await run({ ok: false, error: 'locked', retry_after: 840 });
  assert.match(a.msg, /PIN を続けて間違えたため、このログインを止めています（あと約 14 分）。GM・CEO が PIN を変更すると、すぐに使えます。/);
  assert.equal(a.btn.disabled, false);
  assert.match((await run({ ok: false, error: 'locked', retry_after: 86400 }, false)).msg, /あと約 24 時間/);
  assert.equal((await run({ ok: false })).msg, 'PINが違います');
  assert.equal((await run({ ok: false, error: 'db_unavailable' })).msg, 'SERVER DOWN');
  const ok = await run({ ok: true, token: null });
  assert.equal(ok.c.entered, true);
  const c = app({ login: { ok: false, error: 'locked', retry_after: 30 } });
  assert.deepEqual({ ...(await c.run("authPinCheck('staff','Alice','0000')")) }, { ok: false, server: false, locked: 30 });
});

test('my PIN: a paused change says so', async () => {
  const dom = { 'my-pin-old': { value: '1111' }, 'my-pin': { value: '5555' }, 'my-pin2': { value: '5555' } };
  const c = app({ dom, fn: { 'auth-pin:selfset': { ok: false, error: 'locked', retry_after: 300 } } });
  c.curUserName = 'Alice'; c.ROLE_CONFIG = {};
  await c.run('saveMyPin()');
  assert.match(c.alerts.at(-1), /止めています（あと約 5 分）/);
  assert.equal(c.reqs[0].auth, 'Bearer anon', 'my PIN change still uses the PIN itself');
  const d = app({ dom, fn: { 'auth-pin:selfset': { ok: false, error: 'oldpin' } } }); d.curUserName = 'Alice'; d.ROLE_CONFIG = {};
  await d.run('saveMyPin()'); assert.equal(d.alerts.at(-1), '現在のPINが違います');
});

test('the manager PIN prompt and the name + PIN payloads are gone; logout clears the PIN list copy', () => {
  assert.doesNotMatch(SRC, /askAdminPin|_pinAdmin|adminPin|adminName/);
  assert.match(fnSrc('doLogout'), /window\._pinCache = null; _secAuthAfter = null;/);
  const c = app();
  assert.equal(c.run("obImgSrc('data:image/png;base64,QUJD')"), 'data:image/png;base64,QUJD');
  for (const bad of ['javascript:alert(1)', 'data:text/html;base64,PHA+', 'data:image/png;base64,AA"><x', '', null, 5]) assert.equal(c.run('obImgSrc(' + JSON.stringify(bad) + ')'), '', String(bad));
});
