// v1063 (Moto 2026-10-11「invoice取り込みに入る時のメール認証を削除してください」): Invoice取込 asks for the email
// sign-in only once per person on each device. The sign-in (Supabase refresh token) is kept on this device for the
// employee who logged in with their own PIN, and the screen signs in again by itself next time. The server is unchanged.
// Runs the real module from index.html in a VM with a stand-in localStorage and network. No real network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL(process.env.FUNERGY_INDEX || '../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MOD = html.slice(html.indexOf('/* FUNERGY_INVOICE_INTAKE_BEGIN */'), html.indexOf('/* FUNERGY_INVOICE_INTAKE_END */'));
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const AKANE = { id: 'E2', name: 'Akane Sample' }, BOB = { id: 'E9', name: 'Bob Sample' };
const DAY = 86400000;

class Store { constructor(o) { this.m = new Map(Object.entries(o || {})); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }
const keptStore = (people) => new Store({ _invin_signin: JSON.stringify({ v: 1, people }) });
const kept = s => JSON.parse(s.getItem('_invin_signin') || '{"people":{}}').people;

// One page load after a PIN login. auth: answers for the Supabase auth/REST calls; api: answers for invoice-intake.
function page({ storage = new Store(), person = AKANE, pin = '4321', storeLogin = false, role = 'office', session = null, auth = {}, api = () => ({ ok: true }), dom = {} } = {}) {
  const c = {
    reqs: [], toasts: [], modals: [], timers: [], rerenders: 0, curLang: 'ja', curRole: role, curPage: 'acct_center', _acCat: 'drive', _acSub: 'dreview',
    curUserName: person ? person.name : 'Store A', loginPerson: person, curStoreLogin: storeLogin, DEFAULT_STAFF_PIN: '0000', localStorage: storage,
    t: (ja, en) => (c.curLang === 'en' ? en : ja), escapeHtml: esc, STORES: [{ id: 'F06', name: 'Store A', color: '#777' }], getStoresAll: () => c.STORES, getIngredients: () => [],
    showToast: (m, k) => c.toasts.push([m, k]), openModal: h => c.modals.push(h), closeModalDirect: () => {}, renderPage: () => { c.rerenders++; }, acSetSub: () => {}, go: () => {}, lsSet: () => true,
    SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON: 'anon', _botSession: session, botResetShared: () => { c._botSession = null; }, botTime: v => String(v || ''),
    window: { _sessionPin: pin }, setTimeout: (f) => { c.timers.push(f); return c.timers.length; }, clearTimeout: () => {}, AbortController,
    document: { getElementById: k => dom[k] || null, querySelectorAll: () => [] },
    fetch: async (url, init) => {
      const path = String(url).replace('https://example.invalid', '');
      const req = { path, method: init.method || 'GET', auth: (init.headers && init.headers.Authorization) || null, body: init.body ? JSON.parse(init.body) : null, signal: !!init.signal };
      c.reqs.push(req);
      const key = path.startsWith('/auth/v1/token?grant_type=password') ? 'password' : path.startsWith('/auth/v1/token?grant_type=refresh_token') ? 'refresh'
        : path.startsWith('/rest/v1/manager_auth') ? 'me' : path.startsWith('/auth/v1/logout') ? 'logout' : 'api';
      const r = key === 'api' ? await api(req) : (typeof auth[key] === 'function' ? await auth[key](req) : auth[key]);
      if (r instanceof Error) throw r;
      return r && r.status ? { ok: false, status: r.status, json: async () => ({ error: r.error }) } : { ok: true, status: 200, json: async () => r };
    },
  };
  vm.createContext(c);
  vm.runInContext(MOD + '\nthis.M = { _invIn };', c);
  c.run = src => vm.runInContext(src, c);
  return c;
}
const signInDom = (keep = true) => ({ 'invin-email': { value: ' akane@example.invalid ' }, 'invin-password': { value: 'pw' }, 'invin-login-button': { disabled: false }, 'invin-keep': { checked: keep } });
const rotate = () => { let n = 0; return q => ({ access_token: 'acc-' + (++n), refresh_token: q.body.refresh_token + '+' }); };
async function openScreen(c) {           // render the gate, then run the restore it scheduled
  const h = c.run('invInGate()'); const p = c.M._invIn.restoreP;
  c.timers.shift()?.(); await p; return h;
}

test('signing in once keeps it on this device for that employee; the next PIN login opens the screen by itself', async () => {
  const storage = new Store();
  const first = page({ storage, dom: signInDom(), auth: { password: { access_token: 'a1', refresh_token: 'r1' }, me: [{ emp_id: 'E2' }] } });
  assert.match(first.run('invInGate()'), /この端末で最初の 1 回だけ、業務Bot と同じメール認証が要ります/);
  first.run('invInLoginModal()');
  assert.match(first.modals.at(-1), /id="invin-keep" type="checkbox" checked/);
  assert.match(first.modals.at(-1), /Akane Sample さんの PIN ログインだけで開けます（Invoice取込・業務Bot）/);
  assert.match(first.modals.at(-1), /ご本人のメールで認証するときだけ。共有のパソコンでは外してください/);
  await first.run('invInLogin()');
  assert.equal(first.document.getElementById('invin-password').value, '', 'the password is not kept');
  assert.deepEqual(first.reqs.map(q => [q.path, q.auth]), [['/auth/v1/token?grant_type=password', null], ['/rest/v1/manager_auth?select=emp_id', 'Bearer a1']]);
  assert.deepEqual(Object.keys(kept(storage)), ['e:E2'], 'kept by employee id');
  assert.equal(kept(storage)['e:E2'].rt, 'r1');
  assert.ok(!/pw|a1|akane@/.test(storage.getItem('_invin_signin')), 'only the refresh key: never the password, the access key or the email');
  assert.equal(first.run('_invIn.keptSession === _botSession'), true);

  const next = page({ storage, auth: { refresh: rotate() } });
  assert.equal(next.run('invInSigned()'), false);
  const h = await openScreen(next);
  assert.match(h, /認証しています/); assert.doesNotMatch(h, /invInLoginModal/);
  assert.deepEqual(next.reqs.map(q => [q.path, q.body, q.signal]), [['/auth/v1/token?grant_type=refresh_token', { refresh_token: 'r1' }, true]], 'one request, with a time limit');
  assert.equal(next.run('invInSigned()'), true);
  assert.equal(next._botSession.access_token, 'acc-1');
  assert.equal(kept(storage)['e:E2'].rt, 'r1+', 'the replaced key is kept (Supabase replaces it each time)');
  assert.equal(next.run('invInGate()'), '');
  assert.ok(next.rerenders >= 1);
  // a second render while signing in schedules nothing more
  const again = page({ storage, auth: { refresh: rotate() } });
  again.run('invInGate()'); again.run('invInGate()');
  assert.equal(again.timers.length, 1);
});

test('kept only for that employee with their own PIN: not for another person, a store login, the initial PIN, or when unticked', async () => {
  const storage = keptStore({ 'e:E2': { rt: 'r1', at: Date.now() } });
  const bob = page({ storage, person: BOB });
  assert.match(bob.run('invInGate()'), /invInLoginModal/); assert.equal(bob.timers.length, 0); assert.equal(bob.run('invInKept()'), null);
  const sameName = page({ storage, person: { id: 'E7', name: 'Akane Sample' } });
  assert.equal(sameName.run('invInKept()'), null, 'another employee with the same name');
  const store = page({ storage, person: AKANE, storeLogin: true });   // a store login never keeps, even with a person left over
  assert.equal(store.run('invInKeepWho()'), ''); assert.equal(store.run('invInKeepSet("x")'), false);
  // the initial PIN: never used, never kept, and the screen says why
  const def = page({ storage, pin: '0000', dom: signInDom(), auth: { password: { access_token: 'a1', refresh_token: 'r9' }, me: [{ emp_id: 'E2' }] } });
  assert.equal(def.run('invInKept()'), null);
  assert.match(def.run('invInGate()'), /PIN が初期のままのあいだは毎回です/); assert.equal(def.timers.length, 0);
  def.run('invInLoginModal()');
  assert.doesNotMatch(def.modals.at(-1), /invin-keep/); assert.match(def.modals.at(-1), /PIN が初期のままなので、この端末では覚えません/);
  def.document.getElementById = k => (k === 'invin-keep' ? null : signInDom()[k]);
  await def.run('invInLogin()');
  assert.equal(kept(storage)['e:E2'].rt, 'r1', 'the initial PIN neither keeps nor removes');
  assert.ok(!def.reqs.some(q => q.path.startsWith('/rest/v1/manager_auth')));
  // unticked: keeps nothing and removes what this person had
  const noKeep = page({ storage, dom: signInDom(false), auth: { password: { access_token: 'a9', refresh_token: 'r9' }, me: [{ emp_id: 'E2' }] } });
  await noKeep.run('invInLogin()');
  assert.equal(storage.getItem('_invin_signin'), null);
  assert.equal(noKeep.run('invInSigned()'), true, 'signed in for now');
});

test('the email account must be the PIN person\'s own (manager_auth.emp_id)', async () => {
  const storage = new Store();
  const other = page({ storage, dom: signInDom(), auth: { password: { access_token: 'a1', refresh_token: 'r-ceo' }, me: [{ emp_id: 'E1' }] } });
  await other.run('invInLogin()');
  assert.equal(storage.getItem('_invin_signin'), null);
  assert.ok(other.toasts.some(([m, k]) => /いま PIN でログインしている人のものではないため、この端末では覚えませんでした/.test(m) && k === 'warning'));
  assert.equal(other.run('invInSigned()'), true, 'it still works this time');
  for (const emp of [null, '']) {
    const noEmp = page({ storage, dom: signInDom(), auth: { password: { access_token: 'a1', refresh_token: 'r2' }, me: [{ emp_id: emp }] } });
    await noEmp.run('invInLogin()');
    assert.equal(storage.getItem('_invin_signin'), null, 'an account with no employee id cannot be checked, so it is not kept');
    assert.ok(noEmp.toasts.some(([m, k]) => /社員の登録（manager_auth の emp_id）が無いため/.test(m) && k === 'warning'));
  }
  const mine = page({ storage, dom: signInDom(), auth: { password: { access_token: 'a1', refresh_token: 'r2' }, me: [{ emp_id: 'E2' }] } });
  await mine.run('invInLogin()');
  assert.equal(kept(storage)['e:E2'].rt, 'r2');
  storage.removeItem('_invin_signin');
  for (const me of [{ status: 401, error: 'x' }, [], [{ emp_id: 'E2' }, { emp_id: 'E2' }], new Error('offline')]) {
    const unsure = page({ storage, dom: signInDom(), auth: { password: { access_token: 'a1', refresh_token: 'r3' }, me } });
    await unsure.run('invInLogin()');
    assert.equal(storage.getItem('_invin_signin'), null, 'not kept when it cannot be checked');
    assert.equal(unsure.toasts.length, 0);
  }
});

test('a dead key is dropped; a rate limit or network failure keeps it and offers to try again', async () => {
  for (const status of [400, 401, 403]) {
    const storage = keptStore({ 'e:E2': { rt: 'old', at: Date.now() } });
    const c = page({ storage, auth: { refresh: { status, error: 'invalid_grant' } } });
    await openScreen(c);
    assert.equal(storage.getItem('_invin_signin'), null, String(status));
    assert.doesNotMatch(c.run('invInGate()'), /もう一度自動で認証する/);
  }
  for (const refresh of [{ status: 429, error: 'rate' }, { status: 503, error: 'down' }, new Error('offline')]) {
    const storage = keptStore({ 'e:E2': { rt: 'old', at: Date.now() } });
    const c = page({ storage, auth: { refresh } });
    await openScreen(c);
    assert.equal(kept(storage)['e:E2'].rt, 'old');
    const t0 = c.timers.length, g = c.run('invInGate()');
    assert.match(g, /invInLoginModal/); assert.match(g, /もう一度自動で認証する/); assert.equal(c.timers.length, t0, 'no loop');
    c.run('invInRestoreAgain()');
    assert.match(c.run('invInGate()'), /認証しています/); assert.equal(c.timers.length, t0 + 1);
  }
});

test('only the kept sign-in replaces the kept key, always from the newest key on the device', async () => {
  const storage = keptStore({ 'e:E2': { rt: 'r1', at: Date.now() } });
  const tabA = page({ storage, auth: { refresh: rotate() } });
  await openScreen(tabA);                                   // kept: r1+
  const tabB = page({ storage, auth: { refresh: rotate() } });
  await openScreen(tabB);                                   // tab B moves it on: r1++
  assert.equal(kept(storage)['e:E2'].rt, 'r1++');
  // tab A's access key runs out: it refreshes with the newest key on the device, not its own stale r1+
  let n = 0;
  tabA.fetch = async (url, init) => {
    const path = String(url).replace('https://example.invalid', ''); const body = init.body ? JSON.parse(init.body) : null;
    tabA.reqs.push({ path, body });
    if (path.includes('grant_type=refresh_token')) return { ok: true, status: 200, json: async () => ({ access_token: 'acc-A', refresh_token: body.refresh_token + 'A' }) };
    n++; return n === 1 ? { ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) } : { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  tabA.reqs.length = 0;
  await tabA.run(`invInAPI({ action:'health' })`);
  assert.deepEqual(tabA.reqs.find(q => q.path.includes('refresh_token')).body, { refresh_token: 'r1++' });
  assert.equal(kept(storage)['e:E2'].rt, 'r1++A');
  assert.equal(tabA.run('_invIn.keptSession === _botSession'), true);
  // someone else's sign-in in the same PIN session (e.g. 業務Bot as the CEO): its refresh never touches the kept key
  tabA._botSession = { access_token: 'ceo-a', refresh_token: 'ceo-r' };
  n = 0; tabA.reqs.length = 0;
  await tabA.run(`invInAPI({ action:'health' })`);
  assert.deepEqual(tabA.reqs.find(q => q.path.includes('refresh_token')).body, { refresh_token: 'ceo-r' });
  assert.equal(kept(storage)['e:E2'].rt, 'r1++A', 'the CEO\'s key is not kept under Akane');
  // 業務Bot's refresh goes through the same single refresh
  const bot = html.slice(html.indexOf('async function botAPI('), html.indexOf('async function botAPI(') + 1600);
  assert.match(bot, /if\(r\.status===401&&!retried&&session\.refresh_token\)\{\n\s*if\(typeof invInSessionRefresh==='function'\)\{var ns=await invInSessionRefresh\(session\);if\(ns&&\(_botSession\|\|window\._authSession\|\|null\)===ns\)return botAPI\(payload,true\);\}/);
  tabA.run(`var o = { access_token:'x', refresh_token:'y' }; _invIn.keptSession = null; invInKeepRefresh(o, { access_token:'x2', refresh_token:'y2' })`);
  assert.equal(kept(storage)['e:E2'].rt, 'r1++A');
});

test('"forget" removes this person\'s key and closes that sign-in on the server; it says so when it could not', async () => {
  const storage = keptStore({ 'e:E2': { rt: 'r1', at: Date.now() }, 'e:E9': { rt: 'b1', at: Date.now() } });
  const c = page({ storage, session: { access_token: 'expired', refresh_token: 'r0' }, auth: { refresh: { access_token: 'fresh', refresh_token: 'r2' }, logout: {} } });
  assert.match(c.run('invInHead()'), /この端末に覚えたメール認証を消す/);
  await c.run('invInForget()');
  assert.deepEqual(Object.keys(kept(storage)), ['e:E9'], 'only this person\'s');
  assert.deepEqual(c.reqs.map(q => [q.path, q.auth, q.body]), [['/auth/v1/token?grant_type=refresh_token', null, { refresh_token: 'r1' }], ['/auth/v1/logout?scope=local', 'Bearer fresh', null]]);
  assert.equal(c._botSession, null);
  assert.ok(c.toasts.some(([m, k]) => /この端末のメール認証を消しました/.test(m) && k === 'success'));
  assert.doesNotMatch(c.run('invInHead()'), /この端末に覚えたメール認証を消す/);
  assert.match(c.run('invInGate()'), /invInLoginModal/);
  const fail = page({ storage: keptStore({ 'e:E2': { rt: 'r1', at: Date.now() } }), auth: { refresh: new Error('offline') } });
  await fail.run('invInForget()');
  assert.ok(fail.toasts.some(([m, k]) => /サーバー側のログインは閉じられませんでした/.test(m) && k === 'warning'));
  const dead = page({ storage: keptStore({ 'e:E2': { rt: 'r1', at: Date.now() } }), auth: { refresh: { status: 400, error: 'invalid_grant' } } });
  await dead.run('invInForget()');
  assert.ok(dead.toasts.some(([, k]) => k === 'success') && !dead.reqs.some(q => q.path.startsWith('/auth/v1/logout')), 'a dead key has nothing to close');
});

test('logging out or signing in meanwhile: the restore hands nothing over and overwrites nothing; logout clears the screen', async () => {
  const storage = keptStore({ 'e:E2': { rt: 'r1', at: Date.now() } });
  let release;
  const c = page({ storage, auth: { refresh: () => new Promise(res => { release = () => res({ access_token: 'a2', refresh_token: 'r2' }); }) } });
  const p = c.run('invInRestore()');
  await new Promise(res => setImmediate(res));
  c.loginPerson = BOB; c.curUserName = BOB.name;          // logged out, Bob logged in
  release();
  assert.equal(await p, false);
  assert.equal(c._botSession, null, 'Bob does not get Akane\'s sign-in');
  assert.equal(kept(storage)['e:E2'].rt, 'r2', 'Akane\'s replaced key is still kept for her');
  const d = page({ storage, auth: { refresh: () => new Promise(res => { release = () => res({ access_token: 'a3', refresh_token: 'r3' }); }) } });
  const p2 = d.run('invInRestore()');
  await new Promise(res => setImmediate(res));
  d._botSession = { access_token: 'just-signed', refresh_token: 'js' };
  release();
  assert.equal(await p2, true);
  assert.equal(d._botSession.access_token, 'just-signed', 'a sign-in made meanwhile is not overwritten');
  c.M._invIn.health = { review: 3 }; c.M._invIn.review = { rows: [1] }; c.M._invIn.loaded = { health: 1 }; c.M._invIn.restoreTried = 'e:E2'; c.M._invIn.keptSession = {}; c.M._invIn.error = 'e';
  c.run('invInReset()');
  assert.deepEqual([c.M._invIn.health, c.M._invIn.review, c.M._invIn.restoreTried, c.M._invIn.keptSession, c.M._invIn.error, Object.keys(c.M._invIn.loaded).length], [null, null, null, null, '', 0]);
  const logout = html.slice(html.indexOf('function doLogout()'), html.indexOf('\n}', html.indexOf('function doLogout()')));   // v1098: the whole function (a line added near the top pushed these past 900 characters)
  assert.match(logout, /botResetShared\(\);[^\n]*\n\s*if\(typeof invInReset==='function'\) invInReset\(\);/);
});

test('kept only on this device ("_" key: not synced, not copied) and forgotten after 30 days unused', async () => {
  const c = page();
  const key = c.run('INVIN_KEEP');
  assert.equal(key, '_invin_signin');
  const local = html.slice(html.indexOf('function lsIsDeviceLocal(key){'), html.indexOf('/* ===== v764: IndexedDB 基盤'));
  const ctx = { LS_DEVICE_LOCAL: [] }; vm.createContext(ctx); vm.runInContext(local, ctx);
  assert.equal(vm.runInContext(`lsIsDeviceLocal(${JSON.stringify(key)})`, ctx), true);
  const prefixes = JSON.parse(html.slice(html.indexOf('var OP_SYNC_PREFIX = ') + 'var OP_SYNC_PREFIX = '.length, html.indexOf('];', html.indexOf('var OP_SYNC_PREFIX = ')) + 1).replace(/'/g, '"').replace(/\s+/g, ''));
  assert.ok(!prefixes.some(p => key.startsWith(p)), 'not an op-sync key');
  assert.equal(html.split("'_invin_signin'").length - 1, 1, 'nothing else in the app reads it');
  const storage = keptStore({ 'e:E2': { rt: 'old', at: Date.now() - 31 * DAY }, 'e:E9': { rt: 'b', at: Date.now() - 40 * DAY }, 'e:E5': { rt: 'c', at: Date.now() - DAY } });
  const old = page({ storage });
  assert.equal(old.run('invInKept()'), null);
  assert.match(old.run('invInGate()'), /invInLoginModal/); assert.equal(old.timers.length, 0);
  old.run('invInKeepSet("new")');
  assert.deepEqual(Object.keys(kept(storage)).sort(), ['e:E2', 'e:E5'], 'old entries are cleaned when it writes');
});

test('purchase history waits for the sign-in the screen is doing; English texts; other roles see nothing', async () => {
  const storage = keptStore({ 'e:E2': { rt: 'r1', at: Date.now() } });
  const c = page({ storage, auth: { refresh: rotate() }, api: q => (q.body.action === 'price_history' ? { rows: [] } : []) });
  c.run('invInGate()');                                     // the screen scheduled its restore
  const modal = c.run(`invInHistModal('I-1')`);
  await new Promise(res => setImmediate(res));
  c.timers.shift()();
  await modal;
  assert.deepEqual(c.reqs.map(q => (q.body && q.body.action) || q.path.split('?')[1]), ['grant_type=refresh_token', 'price_history', 'latest_prices'], 'one sign-in, no email prompt');
  assert.match(c.modals.at(-1), /まだありません/);
  const none = page();
  await none.run(`invInHistModal('I-1')`);
  assert.match(none.modals.at(-1), /この端末で最初の 1 回だけメール認証が要ります/);
  const en = page(); en.curLang = 'en';
  assert.match(en.run('invInGate()'), /Sign in once on this device/);
  en.run('invInLoginModal()');
  assert.match(en.modals.at(-1), /Remember on this device: next time Akane Sample’s PIN login is enough/);
  assert.doesNotMatch(page({ role: 'crew' }).run('invInGate()'), /invInLoginModal|認証しています/);
  const xss = page({ person: { id: 'E3', name: '<img src=x onerror=alert(1)>' } });
  xss.run('invInLoginModal()');
  assert.ok(!xss.modals.at(-1).includes('<img src=x') && xss.modals.at(-1).includes('&lt;img'), 'the name is escaped');
});

test('parallel 401s in one tab share one refresh, so the kept key and the tab stay together', async () => {
  const storage = keptStore({ 'e:E2': { rt: 'r1', at: Date.now() } });
  const c = page({ storage, auth: { refresh: rotate() } });
  await openScreen(c);                                         // kept r1+ = memory
  let refreshes = 0, n = 0, release;
  const gate = new Promise(res => { release = res; });
  c.fetch = async (url, init) => {
    const path = String(url).replace('https://example.invalid', ''); const body = init.body ? JSON.parse(init.body) : null;
    if (path.includes('grant_type=refresh_token')) { refreshes++; await gate; return { ok: true, status: 200, json: async () => ({ access_token: 'acc-' + refreshes, refresh_token: body.refresh_token + '#' }) }; }
    n++; return n <= 3 ? { ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) } : { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const all = Promise.all(['health', 'config', 'list'].map(a => c.run(`invInAPI({ action:'${a}' })`)));
  await new Promise(res => setImmediate(res));
  release();
  await all;
  assert.equal(refreshes, 1, 'one refresh for the three');
  assert.equal(kept(storage)['e:E2'].rt, c._botSession.refresh_token, 'the kept key is the tab\'s key');
  assert.equal(c.run('_invIn.keptSession === _botSession'), true);
  // the next round still follows the kept key (one more 401, then fine)
  n = 2; refreshes = 0;
  await c.run(`invInAPI({ action:'health' })`);
  assert.equal(refreshes, 1);
  assert.equal(kept(storage)['e:E2'].rt, c._botSession.refresh_token);
});

test('a refresh that finishes after logout is not handed to the next person; a failed write does not track the session', async () => {
  const storage = keptStore({ 'e:E2': { rt: 'r1', at: Date.now() } });
  const c = page({ storage, auth: { refresh: rotate() } });
  await openScreen(c);
  let release, n = 0;
  c.fetch = async (url, init) => {
    const path = String(url).replace('https://example.invalid', '');
    if (path.includes('grant_type=refresh_token')) { await new Promise(res => { release = res; }); return { ok: true, status: 200, json: async () => ({ access_token: 'late', refresh_token: 'late-r' }) }; }
    n++; return n === 1 ? { ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) } : { ok: true, status: 200, json: async () => ({}) };
  };
  const p = c.run(`invInAPI({ action:'health' })`).catch(e => e);
  await new Promise(res => setImmediate(res));
  c._botSession = null; c.loginPerson = BOB; c.curUserName = BOB.name; c.run('invInReset()');   // logout, Bob logs in
  release();
  await p;
  assert.equal(c._botSession, null, 'Bob does not get Akane\'s refreshed sign-in');
  // storage full: the restore works but this tab is not treated as the kept sign-in
  const full = keptStore({ 'e:E2': { rt: 'r1', at: Date.now() } });
  full.setItem = () => { throw new Error('QuotaExceededError'); };
  const d = page({ storage: full, auth: { refresh: rotate() } });
  await openScreen(d);
  assert.equal(d.run('invInSigned()'), true);
  assert.equal(d.run('_invIn.keptSession'), null);
  // storage fills up later: after the next refresh this tab stops being treated as the kept sign-in
  const later = keptStore({ 'e:E2': { rt: 'r1', at: Date.now() } });
  let m = 0;
  const e = page({ storage: later, auth: { refresh: rotate() }, api: () => (++m === 1 ? { status: 401, error: 'unauthorized' } : { ok: true }) });
  await openScreen(e);
  assert.equal(e.run('_invIn.keptSession === _botSession'), true);
  later.setItem = () => { throw new Error('QuotaExceededError'); };
  await e.run(`invInAPI({ action:'health' })`);
  assert.equal(e.run('_invIn.keptSession'), null);
  assert.equal(kept(later)['e:E2'].rt, 'r1+', 'the stored key stays as it was');
});

test('an action is not re-sent with the next person\'s sign-in; two tabs restoring at once both follow the kept key', async () => {
  const storage = keptStore({ 'e:E2': { rt: 'r1', at: Date.now() } });
  const c = page({ storage, auth: { refresh: rotate() } });
  await openScreen(c);
  let release; const sent = [];
  c.fetch = async (url, init) => {
    const path = String(url).replace('https://example.invalid', '');
    if (path.includes('grant_type=refresh_token')) { await new Promise(res => { release = res; }); return { ok: true, status: 200, json: async () => ({ access_token: 'akane-new', refresh_token: 'akane-r' }) }; }
    sent.push([JSON.parse(init.body).action, init.headers.Authorization]);
    return sent.length === 1 ? { ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) } : { ok: true, status: 200, json: async () => ({}) };
  };
  const p = c.run(`invInAPI({ action:'post', doc_id:'d1', version:1 })`).catch(e => e);
  await new Promise(res => setImmediate(res));
  c.loginPerson = BOB; c.curUserName = BOB.name; c.run('invInReset()');
  c._botSession = { access_token: 'bob-acc', refresh_token: 'bob-r' };      // Bob logs in and signs in
  release();
  await p;
  assert.deepEqual(sent, [['post', 'Bearer acc-1']], 'Akane\'s action is not re-sent with Bob\'s sign-in');
  assert.equal(c._botSession.access_token, 'bob-acc');
  // two tabs read the same kept key and get the same new key: both follow the kept key
  const both = keptStore({ 'e:E2': { rt: 'k1', at: Date.now() } });
  let go; const wait = new Promise(res => { go = res; });
  const same = async q => { await wait; return { access_token: 'acc', refresh_token: q.body.refresh_token + '+' }; };
  const A = page({ storage: both, auth: { refresh: same } }), B = page({ storage: both, auth: { refresh: same } });
  A.run('invInGate()'); B.run('invInGate()');
  const pa = A.M._invIn.restoreP, pb = B.M._invIn.restoreP;
  A.timers.shift()(); B.timers.shift()();
  go(); await Promise.all([pa, pb]);
  assert.equal(kept(both)['e:E2'].rt, 'k1+');
  assert.equal(A.run('_invIn.keptSession === _botSession'), true);
  assert.equal(B.run('_invIn.keptSession === _botSession'), true, 'the second tab is the same chain');
});
