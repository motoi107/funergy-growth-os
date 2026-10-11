// v1063 (Moto 2026-10-11「invoice取り込みに入る時のメール認証を削除してください」): Invoice取込 asks for the email
// sign-in only once per person on each device. The sign-in is kept on this device for the person who logged in with the
// PIN, and the screen signs in again by itself next time. The server is unchanged (email account + manager_auth role).
// Runs the real module from index.html in a VM with a stand-in localStorage. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL(process.env.FUNERGY_INDEX || '../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MOD = html.slice(html.indexOf('/* FUNERGY_INVOICE_INTAKE_BEGIN */'), html.indexOf('/* FUNERGY_INVOICE_INTAKE_END */'));
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

class Store { constructor() { this.m = new Map(); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }

// One "page load": the person has just logged in with their PIN (curUserName). storage is the device's localStorage.
function page({ storage = new Store(), user = 'Akane Sample', storeLogin = false, role = 'office', session = null, api = () => ({ ok: true }), dom = {} } = {}) {
  const c = {
    reqs: [], toasts: [], modals: [], timers: [], rerenders: 0, curLang: 'ja', curRole: role, curPage: 'acct_center', _acCat: 'drive', _acSub: 'dreview',
    curUserName: user, curStoreLogin: storeLogin, localStorage: storage,
    t: (ja, en) => (c.curLang === 'en' ? en : ja), escapeHtml: esc, STORES: [{ id: 'F06', name: 'Store A', color: '#777' }], getStoresAll: () => c.STORES, getIngredients: () => [],
    showToast: (m, k) => c.toasts.push([m, k]), openModal: h => c.modals.push(h), closeModalDirect: () => {}, renderPage: () => { c.rerenders++; }, acSetSub: () => {}, go: () => {}, lsSet: () => true,
    SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON: 'anon', _botSession: session, botResetShared: () => { c._botSession = null; }, botTime: v => String(v || ''),
    window: {}, setTimeout: (f) => { c.timers.push(f); }, document: { getElementById: k => dom[k] || null, querySelectorAll: () => [] },
    fetch: async (url, init) => {
      const req = { url: String(url), auth: (init.headers && init.headers.Authorization) || null, body: init.body ? JSON.parse(init.body) : null };
      c.reqs.push(req);
      const r = await api(req);
      if (r instanceof Error) throw r;
      return r && r.status ? { ok: false, status: r.status, json: async () => ({ error: r.error }) } : { ok: true, status: 200, json: async () => r };
    },
  };
  vm.createContext(c);
  vm.runInContext(MOD + '\nthis.M = { _invIn };', c);
  c.run = src => vm.runInContext(src, c);
  return c;
}
const kept = s => JSON.parse(s.getItem('_invin_signin') || '{"people":{}}').people;
const signInDom = (keep = true) => ({ 'invin-email': { value: ' akane@example.invalid ' }, 'invin-password': { value: 'pw' }, 'invin-login-button': { disabled: false }, 'invin-keep': { checked: keep } });

test('signing in once keeps it on this device for that person; the next PIN login opens the screen without the email sign-in', async () => {
  const storage = new Store();
  const first = page({ storage, dom: signInDom(), api: q => (q.url.includes('grant_type=password') ? { access_token: 'a1', refresh_token: 'r1' } : { ok: true }) });
  assert.match(first.run('invInGate()'), /この端末で最初の 1 回だけ、業務Bot と同じメール認証が要ります/);
  first.run('invInLoginModal()');
  assert.match(first.modals.at(-1), /id="invin-keep" type="checkbox" checked/);
  assert.match(first.modals.at(-1), /共有のパソコンでは外してください/);
  await first.run('invInLogin()');
  assert.equal(first.document.getElementById('invin-password').value, '', 'the password is not kept');
  assert.deepEqual(Object.keys(kept(storage)), ['Akane Sample']);
  assert.equal(kept(storage)['Akane Sample'].rt, 'r1');
  assert.ok(!storage.getItem('_invin_signin').includes('pw') && !storage.getItem('_invin_signin').includes('a1'), 'only the refresh key is kept, never the password or the access key');

  // next time: a new page load, the same person logs in with the PIN
  const next = page({ storage, api: q => (q.url.includes('grant_type=refresh_token') ? { access_token: 'a2', refresh_token: 'r2' } : { ok: true }) });
  assert.equal(next.run('invInSigned()'), false);
  assert.match(next.run('invInGate()'), /認証しています/);
  assert.doesNotMatch(next.run('invInGate()'), /invInLoginModal/);
  assert.equal(next.timers.length, 1, 'it signs in again by itself (once)');
  await next.timers[0]();
  assert.deepEqual(next.reqs.map(q => [q.url.replace('https://example.invalid', ''), q.body]), [['/auth/v1/token?grant_type=refresh_token', { refresh_token: 'r1' }]]);
  assert.equal(next.run('invInSigned()'), true);
  assert.equal(next._botSession.access_token, 'a2');
  assert.equal(kept(storage)['Akane Sample'].rt, 'r2', 'the replaced key is kept (Supabase replaces it each time)');
  assert.equal(next.run('invInGate()'), '');
  assert.ok(next.rerenders >= 1);
});

test('the kept sign-in is only for that person: another person, a store login, or "do not remember" get the email sign-in', async () => {
  const storage = new Store();
  storage.setItem('_invin_signin', JSON.stringify({ v: 1, people: { 'Akane Sample': { rt: 'r1', at: 1 } } }));
  const other = page({ storage, user: 'Bob Sample' });
  assert.match(other.run('invInGate()'), /invInLoginModal/);
  assert.equal(other.timers.length, 0);
  assert.equal(other.run('invInKept()'), null);
  const store = page({ storage, user: 'Store A', storeLogin: true });
  assert.equal(store.run('invInKept()'), null);
  store.run('invInKeepSet("x")');
  assert.deepEqual(Object.keys(kept(storage)), ['Akane Sample'], 'a store login never keeps one');
  // signing in with "remember" unticked keeps nothing, and removes what this person had
  const noKeep = page({ storage, dom: signInDom(false), api: q => ({ access_token: 'a9', refresh_token: 'r9' }) });
  await noKeep.run('invInLogin()');
  assert.deepEqual(kept(storage), {});
  assert.equal(storage.getItem('_invin_signin'), null, 'nothing is left on the device');
  assert.equal(noKeep.run('invInSigned()'), true, 'signed in for now');
});

test('a kept key that no longer works is dropped; a network failure keeps it', async () => {
  const storage = new Store();
  storage.setItem('_invin_signin', JSON.stringify({ v: 1, people: { 'Akane Sample': { rt: 'old', at: 1 } } }));
  const off = page({ storage, api: () => new Error('offline') });
  assert.equal(await off.run('invInRestore()'), false);
  assert.equal(kept(storage)['Akane Sample'].rt, 'old');
  assert.match(off.run('invInGate()'), /invInLoginModal/, 'after one try, the email sign-in shows (no loop)');
  const revoked = page({ storage, api: () => ({ status: 400, error: 'invalid_grant' }) });
  assert.equal(await revoked.run('invInRestore()'), false);
  assert.deepEqual(kept(storage), {});
  assert.match(revoked.run('invInGate()'), /invInLoginModal/);
});

test('when the access key runs out, the refreshed key is kept; 業務Bot\'s refresh keeps it too', async () => {
  const storage = new Store();
  storage.setItem('_invin_signin', JSON.stringify({ v: 1, people: { 'Akane Sample': { rt: 'r1', at: 1 } } }));
  let n = 0;
  const c = page({ storage, session: { access_token: 'a1', refresh_token: 'r1' }, api: q => {
    if (q.url.includes('grant_type=refresh_token')) return { access_token: 'a3', refresh_token: 'r3' };
    n++; return n === 1 ? { status: 401, error: 'unauthorized' } : { ok: true };
  } });
  await c.run(`invInAPI({ action:'health' })`);
  assert.equal(kept(storage)['Akane Sample'].rt, 'r3');
  // 業務Bot replaces the shared session's key the same way and calls the hook
  const bot = html.slice(html.indexOf('async function botAPI('), html.indexOf('async function botAPI(') + 1500);
  assert.match(bot, /_botSession=\{access_token:jj\.access_token,refresh_token:jj\.refresh_token\};if\(typeof invInKeepRefresh==='function'\)invInKeepRefresh\(\);return botAPI\(payload,true\);/);
  c._botSession = { access_token: 'a4', refresh_token: 'r4' }; c.run('invInKeepRefresh()');
  assert.equal(kept(storage)['Akane Sample'].rt, 'r4');
  // a person with nothing kept: the hook keeps nothing
  const s2 = new Store();
  const p2 = page({ storage: s2, session: { access_token: 'x', refresh_token: 'y' } });
  p2.run('invInKeepRefresh()');
  assert.equal(s2.getItem('_invin_signin'), null);
});

test('"forget on this device" removes it and closes the sign-in on the server', async () => {
  const storage = new Store();
  storage.setItem('_invin_signin', JSON.stringify({ v: 1, people: { 'Akane Sample': { rt: 'r1', at: 1 }, 'Bob Sample': { rt: 'b1', at: 1 } } }));
  const c = page({ storage, session: { access_token: 'a1', refresh_token: 'r1' } });
  assert.match(c.run('invInHead()'), /この端末に覚えたメール認証を消す/);
  await c.run('invInForget()');
  assert.deepEqual(Object.keys(kept(storage)), ['Bob Sample'], 'only this person\'s');
  assert.deepEqual(c.reqs.map(q => [q.url.replace('https://example.invalid', ''), q.auth]), [['/auth/v1/logout?scope=local', 'Bearer a1']]);
  assert.equal(c._botSession, null);
  assert.equal(c.run('invInSigned()'), false);
  assert.doesNotMatch(c.run('invInHead()'), /この端末に覚えたメール認証を消す/);
  assert.match(c.run('invInGate()'), /invInLoginModal/);
});

test('logging out while it signs in again does not hand the session to the next person; logout clears the screen', async () => {
  const storage = new Store();
  storage.setItem('_invin_signin', JSON.stringify({ v: 1, people: { 'Akane Sample': { rt: 'r1', at: 1 } } }));
  let release;
  const c = page({ storage, api: () => new Promise(res => { release = () => res({ access_token: 'a2', refresh_token: 'r2' }); }) });
  const p = c.run('invInRestore()');
  await new Promise(res => setImmediate(res));
  c.curUserName = 'Bob Sample';                       // logged out, Bob logged in
  release();
  assert.equal(await p, false);
  assert.equal(c._botSession, null, 'Bob does not get Akane\'s sign-in');
  assert.equal(kept(storage)['Akane Sample'].rt, 'r2', 'Akane\'s replaced key is still kept for her');
  // logout clears what the previous person loaded
  c.M._invIn.health = { review: 3 }; c.M._invIn.review = { rows: [1] }; c.M._invIn.loaded = { health: 1 }; c.M._invIn.restoreTried = 'Akane Sample'; c.M._invIn.error = 'e';
  c.run('invInReset()');
  assert.deepEqual([c.M._invIn.health, c.M._invIn.review, c.M._invIn.restoreTried, c.M._invIn.error, Object.keys(c.M._invIn.loaded).length], [null, null, null, '', 0]);
  const logout = html.slice(html.indexOf('function doLogout()'), html.indexOf('function doLogout()') + 900);
  assert.match(logout, /botResetShared\(\);[^\n]*\n\s*if\(typeof invInReset==='function'\) invInReset\(\);/);
});

test('the key is kept only on this device: a "_" key is device-local (not synced, not copied)', () => {
  const c = page();
  const key = c.run('INVIN_KEEP');
  assert.equal(key, '_invin_signin');
  const local = html.slice(html.indexOf('function lsIsDeviceLocal(key){'), html.indexOf('/* ===== v764: IndexedDB 基盤'));
  const ctx = { LS_DEVICE_LOCAL: [] }; vm.createContext(ctx); vm.runInContext(local, ctx);
  assert.equal(vm.runInContext(`lsIsDeviceLocal(${JSON.stringify(key)})`, ctx), true);
  const prefixes = JSON.parse(html.slice(html.indexOf('var OP_SYNC_PREFIX = ') + 'var OP_SYNC_PREFIX = '.length, html.indexOf('];', html.indexOf('var OP_SYNC_PREFIX = ')) + 1).replace(/'/g, '"').replace(/\s+/g, ''));
  assert.ok(!prefixes.some(p => key.startsWith(p)), 'not an op-sync key');
  assert.ok(!/OP_SYNC_KEYS[^;]*_invin_signin/.test(html) && !/SUPA_SETTING_KEYS[^;]*_invin_signin/.test(html));
  // nothing else in the app reads it
  assert.equal(html.split("'_invin_signin'").length - 1, 1);
});

test('price history from the ingredient master signs in again by itself too; English texts', async () => {
  const storage = new Store();
  storage.setItem('_invin_signin', JSON.stringify({ v: 1, people: { 'Akane Sample': { rt: 'r1', at: 1 } } }));
  const c = page({ storage, api: q => (q.url.includes('grant_type=refresh_token') ? { access_token: 'a2', refresh_token: 'r2' } : q.body.action === 'price_history' ? { rows: [] } : []) });
  await c.run(`invInHistModal('I-1')`);
  assert.deepEqual(c.reqs.map(q => (q.body && q.body.action) || 'refresh'), ['refresh', 'price_history', 'latest_prices']);
  assert.match(c.modals.at(-1), /まだありません/);
  const none = page();
  await none.run(`invInHistModal('I-1')`);
  assert.match(none.modals.at(-1), /この端末で最初の 1 回だけメール認証が要ります/);
  const en = page(); en.curLang = 'en';
  assert.match(en.run('invInGate()'), /Sign in once on this device/);
  en.run('invInLoginModal()');
  assert.match(en.modals.at(-1), /Remember on this device/);
  // a role without invoice work gets no sign-in at all
  assert.doesNotMatch(page({ role: 'crew' }).run('invInGate()'), /invInLoginModal|認証しています/);
});
