// v1151（「変わった」の合図と変更の記録）のアプリ側：FUNERGY_SIGNAL（index.html の本物のブロック）を vm で動かす。
// 合図の表（sync_signal）・Realtime・取り込みの関数（pullOpKey など）・画面（FUNERGY_STATUS・FUNERGY_UX）は、この中の偽物。合成データだけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(process.env.UX_INDEX_PATH || new URL('../index.html', import.meta.url), 'utf8');
const block = (a, b) => { const i = source.indexOf(a), j = source.indexOf(b, i); assert.ok(i > 0 && j > i, a); return source.slice(i, j); };
const MOD = block('/* ==== FUNERGY_SIGNAL（v1151', '/* ==== FUNERGY_SIGNAL end ==== */');
function fn(name) {
  let start = source.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = source.indexOf('\nasync function ' + name + '(');
  assert.ok(start >= 0, 'function exists: ' + name);
  start += 1;
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const URL0 = 'https://db.example.test', ANON = 'anon-key';
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

function fakeDom() {
  const byId = new Map(), listeners = {};
  const mk = tag => {
    const el = { tagName: tag, style: {}, attrs: {}, children: [], parentNode: null, _html: '', textContent: '', id: '',
      setAttribute(k, v) { this.attrs[k] = v; if (k === 'id') this.id = v; }, appendChild(c) { c.parentNode = this; this.children.push(c); if (c.id) byId.set(c.id, c); return c; },
      removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; if (c.id) byId.delete(c.id); } };
    Object.defineProperty(el, 'innerHTML', { get() { return this._html; }, set(v) { this._html = v; } });
    return el;
  };
  const body = mk('body'), head = mk('head');
  const doc = { hidden: false, body, head, createElement: mk, getElementById: id => byId.get(id) || null,
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); }, removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter(x => x !== f); }, _listeners: listeners };
  return doc;
}

// 合図の表と Realtime の偽物
function world(o = {}) {
  const W = { signals: new Map(), calls: [], fetches: [], rt: { subs: [], removed: 0, status: o.rtStatus === undefined ? 'SUBSCRIBED' : o.rtStatus }, corsRefuse: !!o.corsRefuse, missing: !!o.missing, down: false };
  W.put = (key, n, at, by_emp, by_dev) => W.signals.set(key, { key, n, at, by_emp, by_dev });
  W.fetch = async (u, opt = {}) => {
    const h = opt.headers || {};
    W.fetches.push({ u, method: opt.method || 'GET', h: { ...h } });
    if (W.down) throw new TypeError('Failed to fetch');
    if (W.corsRefuse && h['x-fp-actor']) throw new TypeError('Failed to fetch (CORS)');
    const url = new URL(u);
    if (url.pathname === '/rest/v1/sync_signal') {
      if (W.missing) return { status: 404, ok: false, json: async () => ({ code: 'PGRST205' }) };
      let rows = [...W.signals.values()];
      const at = url.searchParams.get('at'); if (at && at.startsWith('gte.')) rows = rows.filter(r => r.at >= at.slice(4));
      rows.sort((a, b) => a.at < b.at ? -1 : 1);
      return { status: 200, ok: true, json: async () => rows.map(r => ({ ...r })) };
    }
    return { status: 201, ok: true, json: async () => [] };
  };
  W.client = { channel(name) {
    const sub = { name, handlers: [], on(ev, filter, cb) { this.handlers.push({ filter, cb }); return this; }, subscribe(cb) { this.statusCb = cb; setTimeout(() => cb(W.rt.status), 0); return this; } };
    W.rt.subs.push(sub); return sub;
  }, removeChannel() { W.rt.removed++; } };
  W.emit = row => { W.put(row.key, row.n, row.at, row.by_emp, row.by_dev); for (const s of W.rt.subs) for (const h of s.handlers) h.cb({ new: { ...row } }); };
  return W;
}

function load(o = {}) {
  const W = world(o);
  const doc = fakeDom();
  const store = new Map(o.ls || []);
  const pulls = [];
  let busy = '', dataAt = 0, autoN = 0, refreshes = 0, autoLast = 0;
  const ST = { userBusy: () => busy, auto: { get last() { return autoLast; } }, autoSync(why) { autoN++; autoLast = Date.now(); pulls.push(['auto', why]); return Promise.resolve('ok'); },
    paintSoon() {}, log(...a) { pulls.push(['log', ...a]); }, niceLabel: (l, k) => (!l || l === k ? 'そのほかのデータ' : l), tableLabel: k => ({ stores: '店舗', employees: '従業員' }[k] || 'データ') };
  const UX = { bgRefresh() { refreshes++; }, _dataChangedSince: t => dataAt > t };
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Date, JSON, Math, Promise, Number, String, Array, Object, RegExp, Uint8Array, Error, TypeError,
    btoa: s => Buffer.from(s, 'binary').toString('base64'), unescape, encodeURIComponent, decodeURIComponent, crypto: globalThis.crypto,
    navigator: { userAgent: o.ua || 'Mozilla/5.0 (Windows NT 10.0)', maxTouchPoints: 0, onLine: true },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: doc, Headers: globalThis.Headers,
    SUPABASE_URL: URL0, SUPABASE_ANON: ANON, _rtClient: W.client,
    curRole: o.role === undefined ? 'gm' : o.role, curStoreLogin: false, curUserName: o.name || 'Gina 試験', loginPerson: { id: 'E-GM', name: 'Gina 試験' }, curLang: 'ja',
    KV_SKIP_PREFIX: ['invoice_purchase_', 'lunch_photo_'],
    _lsOnDemand: k => ['ec_log', 'menu_log'].includes(k), isLocalOnlyKey: k => k === 'pl_actual', piiRawKey: k => k === 'emp_pii', hrIsKey: k => ['applicants', 'reject_log', 'growthhub'].includes(k),
    ssIsKey: k => k === 'growth_karte', csIsKey: k => k.startsWith('lss_'), scIsKey: () => false, gbIsKey: () => false,
    pullOpKey: async k => { pulls.push(['op', k]); if (o.pullFail === k) return false; dataAt = Date.now() + 1; return true; },
    pullSettingKey: async k => { pulls.push(['set', k]); dataAt = Date.now() + 1; return true; },
    SUPA_MASTER_MAP: { m_stores: { table: 'stores' }, m_employees: { table: 'employees' } },
    supaFetchAll: async (t, c) => { pulls.push(['master', t, c]); return [{ data: { id: 'F01', name: 'A' } }]; },
    _stripTestRows: (k, a) => a, _empMergeCloud: a => a, mrApplyPulled: null, _pullKeepLocal: () => false,
    _lsWriteVerified: (k, v) => { pulls.push(['write', k]); store.set(k, v); dataAt = Date.now() + 1; return true; }, refreshStores: () => pulls.push(['refreshStores']),
    hrRouted: () => true, _hrMem: { at: o.hrLoaded ? { applicants: 1 } : {} }, hrLoad: async (k, f) => { pulls.push(['hr', k, f]); return 'ok'; },
    _pii: { map: o.piiLoaded ? {} : null }, piiLoad: async f => { pulls.push(['pii', f]); return 'ok'; },
    getEmployees: () => [{ id: 'E-1', name: 'Ann <b>試験</b>' }, { id: 'E-2', name: 'Bob' }, { id: 'E-GM', name: 'Gina 試験' }],
    outboxLabel: k => ({ meetings: '会議', daily_actuals_F01: '売上・日報' }[k] || (k.startsWith('daily_actuals_') ? '売上・日報' : k)),
    escapeHtml: s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'), t: (ja) => ja,
    STORES: [{ id: 'F01', name: '本店' }],
    ssCall: async p => { pulls.push(['ssCall', p]); return o.ssAnswer ? o.ssAnswer(p) : { ok: true, j: { rows: [], more: false, clfn: 1 } }; },
  };
  ctx.window = ctx; ctx.fetch = W.fetch; ctx.FUNERGY_STATUS = ST; ctx.FUNERGY_UX = UX;
  ctx.supabase = { createClient: () => W.client };
  vm.createContext(ctx);
  vm.runInContext(MOD, ctx);
  const out = { W, ctx, SG: ctx.FUNERGY_SIGNAL, pulls, store, doc, setBusy: b => { busy = b; }, refreshes: () => refreshes, autoN: () => autoN, setData: () => { dataAt = Date.now() + 1; } };
  LIVE.push(out);
  return out;
}
const LIVE = [];
test.afterEach(() => { for (const a of LIVE.splice(0)) { try { a.SG.stop(); } catch { /* */ } } });
const t0 = () => new Date(Date.now() - 3600000).toISOString();
const later = (s = 0) => new Date(Date.now() + s * 1000).toISOString();

test('the device id is random, kept on this device only, and the kind comes from the browser', async () => {
  const A = load();
  const d = A.SG.device();
  assert.match(d, /^d[0-9a-f]{24}$/); assert.equal(A.SG.device(), d); assert.equal(A.store.get('_fp_dev_v1'), d);
  assert.equal(load({ ls: [['_fp_dev_v1', 'dKEEP-me_12']] }).SG.device(), 'dKEEP-me_12');
  assert.match(load({ ls: [['_fp_dev_v1', '<bad>']] }).SG.device(), /^d[0-9a-f]{24}$/, 'a wrong-shaped id is replaced');
  assert.equal(load({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' }).SG.kind(), 'iphone');
  assert.equal(load({ ua: 'Mozilla/5.0 (Linux; Android 14; Pixel) Mobile' }).SG.kind(), 'android');
  assert.equal(load({ ua: 'Mozilla/5.0 (iPad; CPU OS 17_0)' }).SG.kind(), 'ipad');
  assert.equal(load().SG.kind(), 'pc');
});

test('who changed it goes only on REST writes, and only after REST accepted the header once', async () => {
  const A = load();
  await A.ctx.fetch(URL0 + '/rest/v1/app_state?on_conflict=key', { method: 'POST', headers: { apikey: ANON } });
  assert.equal(A.W.fetches.at(-1).h['x-fp-actor'], undefined, 'not before the check');
  assert.equal(await A.SG.probe(), true);
  await A.ctx.fetch(URL0 + '/rest/v1/app_state?on_conflict=key', { method: 'POST', headers: { apikey: ANON } });
  const h = A.W.fetches.at(-1).h['x-fp-actor'];
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64').toString('utf8')), { e: 'E-GM', n: 'Gina 試験', r: 'gm', d: A.SG.device(), k: 'pc' });
  for (const [u, m] of [[URL0 + '/rest/v1/app_state?key=eq.x', 'GET'], [URL0 + '/functions/v1/auth-pin', 'POST'], [URL0 + '/storage/v1/object/invoices/a', 'DELETE'], [URL0 + '/auth/v1/token', 'POST']]) {
    await A.ctx.fetch(u, { method: m, headers: { apikey: ANON } });
    assert.equal(A.W.fetches.at(-1).h['x-fp-actor'], undefined, m + ' ' + u);
  }
  await A.ctx.fetch(URL0 + '/rest/v1/stores?id=eq.F01', { method: 'PATCH', headers: { apikey: ANON } });
  await A.ctx.fetch(URL0 + '/rest/v1/stores?id=eq.F01', { method: 'DELETE', headers: { apikey: ANON } });
  assert.ok(A.W.fetches.slice(-2).every(f => f.h['x-fp-actor']), 'PATCH and DELETE too');
  // a REST that refuses the header (the browser stops the request): never sent
  const B = load({ corsRefuse: true });
  assert.equal(await B.SG.probe(), false);
  await B.ctx.fetch(URL0 + '/rest/v1/app_state', { method: 'POST', headers: { apikey: ANON } });
  assert.equal(B.W.fetches.at(-1).h['x-fp-actor'], undefined);
  // offline at the check: try again later (not decided)
  const C = load(); C.W.down = true;
  assert.equal(await C.SG.probe(), null);
  C.W.down = false; assert.equal(await C.SG.probe(), true);
  // a store tablet sends no person
  const D = load(); D.ctx.curStoreLogin = true; await D.SG.probe();
  await D.ctx.fetch(URL0 + '/rest/v1/app_state', { method: 'POST', headers: { apikey: ANON } });
  assert.deepEqual(JSON.parse(Buffer.from(D.W.fetches.at(-1).h['x-fp-actor'], 'base64').toString('utf8')).e, '');
});

test('at sign-in: older signals are the baseline; ones from during the sign-in are taken again; then another device\'s change is taken, ours is not', async () => {
  const A = load();
  A.W.put('meetings', 4, t0(), 'E-1', 'dOTHER');
  A.W.put('daily_actuals_F01', 2, later(1), 'E-1', 'dOTHER');   // during the sign-in
  A.SG.mark(); A.SG.start();
  await tick(20); await tick(1600);
  assert.deepEqual(A.pulls.filter(p => p[0] === 'op').map(p => p[1]), ['daily_actuals_F01']);
  assert.equal(A.SG.state().k, 'live');
  // another device
  A.W.emit({ key: 'meetings', n: 5, at: later(2), by_emp: 'E-2', by_dev: 'dOTHER' });
  await tick(1600);
  assert.deepEqual(A.pulls.filter(p => p[0] === 'op').map(p => p[1]), ['daily_actuals_F01', 'meetings']);
  // option C: the screen is drawn again in place, and the note bottom left names who changed it
  assert.ok(A.refreshes() >= 1);
  const note = A.doc.getElementById('fp-sig-note');
  assert.ok(note && /<li>会議 <span class="fp-sig-who">Bob さん<\/span><\/li>/.test(note.innerHTML), note && note.innerHTML);
  // this device (n + 1, our id): not taken
  A.W.emit({ key: 'meetings', n: 6, at: later(3), by_emp: 'E-GM', by_dev: A.SG.device() });
  await tick(1600);
  assert.equal(A.pulls.filter(p => p[0] === 'op').length, 2);
  // this device's write, but another device wrote in between (n jumped by 2): taken
  A.W.emit({ key: 'meetings', n: 8, at: later(4), by_emp: 'E-GM', by_dev: A.SG.device() });
  await tick(1600);
  assert.equal(A.pulls.filter(p => p[0] === 'op').length, 3);
  // the same signal twice (Realtime and a read): once
  A.W.emit({ key: 'meetings', n: 8, at: later(4), by_emp: 'E-GM', by_dev: 'dOTHER' });
  await tick(1600);
  assert.equal(A.pulls.filter(p => p[0] === 'op').length, 3);
  A.SG.stop();
});

test('settings, masters and the protected kinds go the right way; the full sync is at most every 2 minutes', async () => {
  const A = load({ hrLoaded: true });
  A.SG.start(); await tick(20);
  A.W.emit({ key: 'set:m_store_kpi', n: 1, at: later(1), by_emp: 'E-1', by_dev: 'dOTHER' });
  A.W.emit({ key: 'm:stores', n: 3, at: later(1), by_emp: 'E-1', by_dev: 'dOTHER' });
  A.W.emit({ key: 'm:recipes', n: 1, at: later(1), by_emp: 'E-1', by_dev: 'dOTHER' });   // not a master this app knows here
  A.W.emit({ key: '_secure:hiring', n: 1, at: later(1), by_emp: null, by_dev: 'dOTHER' });
  A.W.emit({ key: '_secure:pii', n: 1, at: later(1), by_emp: null, by_dev: 'dOTHER' });   // not loaded on this device: nothing
  A.W.emit({ key: '_secure:bonus', n: 1, at: later(1), by_emp: null, by_dev: 'dOTHER' });
  await tick(1700);
  const P = A.pulls.filter(p => p[0] !== 'log');
  assert.deepEqual(P.filter(p => p[0] === 'set'), [['set', 'm_store_kpi']]);
  assert.deepEqual(P.filter(p => ['master', 'write', 'refreshStores'].includes(p[0])), [['master', 'stores', 'data'], ['write', 'm_stores'], ['refreshStores']]);
  assert.deepEqual(P.filter(p => p[0] === 'hr'), [['hr', 'applicants', true]], 'only what this device read before');
  assert.equal(P.filter(p => p[0] === 'pii').length, 0);
  assert.equal(A.autoN(), 1, 'the bonus kind: the whole sync');
  A.W.emit({ key: '*', n: 1, at: later(2), by_emp: null, by_dev: 'dOTHER' });
  await tick(1700);
  assert.equal(A.autoN(), 1, 'not again within 2 minutes (it waits)');
  assert.ok(A.ctx.FUNERGY_SIGNAL.st.fullTm, 'a later full sync is waiting');
  // protected kinds never name a person in the note
  const note = A.doc.getElementById('fp-sig-note');
  assert.ok(note && /<li>採用<\/li>/.test(note.innerHTML), note && note.innerHTML);
  assert.match(note.innerHTML, /<li>店舗 <span class="fp-sig-who">Ann &#60;b&#62;試験&#60;\/b&#62; さん<\/span><\/li>/, 'a name is escaped');
  A.SG.stop();
  assert.equal(A.ctx.FUNERGY_SIGNAL.st.fullTm, null, 'stopped at sign-out');
});

test('keys the app does not keep, the raw personal row and the secure rows are not taken one by one', async () => {
  const A = load();
  A.SG.start(); await tick(20);
  for (const k of ['invoice_purchase_F01_2026-10', 'lunch_photo_1', 'ec_log', 'pl_actual', 'emp_pii', 'applicants', 'growth_karte', 'lss_emp_Ann'])
    A.W.emit({ key: k, n: 1, at: later(1), by_emp: 'E-1', by_dev: 'dOTHER' });
  await tick(1700);
  assert.equal(A.pulls.filter(p => p[0] === 'op').length, 0);
  A.SG.stop();
});

test('notifications (v1152): a signal is read through the function (ntPull), never one by one by REST; the protected kind too; the REST road as before', async () => {
  const A = load();
  let nt = 0, mode = 'fn';
  A.ctx.ntMode = () => mode; A.ctx.ntPull = async () => { nt++; return true; };
  A.SG.start(); await tick(20);
  A.W.emit({ key: 'notifications', n: 1, at: later(1), by_emp: 'E-1', by_dev: 'dOTHER' });
  await tick(1700);
  A.W.emit({ key: '_secure:notifications', n: 1, at: later(2), by_emp: null, by_dev: 'dOTHER' });
  await tick(1700);
  assert.equal(nt, 2, 'both through the function');
  assert.equal(A.pulls.filter(p => p[0] === 'op').length, 0, 'not by REST');
  assert.equal(A.autoN(), 0, 'not the whole sync');
  mode = 'rest';   // 前の版の関数：今までどおり
  A.W.emit({ key: 'notifications', n: 2, at: later(3), by_emp: 'E-1', by_dev: 'dOTHER' });
  await tick(1700);
  assert.deepEqual(A.pulls.filter(p => p[0] === 'op'), [['op', 'notifications']]);
  assert.equal(nt, 2);
  // 関数で読もうとして前の版と分かった（'rest'）：同じ合図で今までどおり REST で読む
  mode = 'fn'; A.ctx.ntPull = async () => { nt++; mode = 'rest'; return 'rest'; };
  A.W.emit({ key: 'notifications', n: 3, at: later(4), by_emp: 'E-1', by_dev: 'dOTHER' });
  await tick(1700);
  assert.equal(nt, 3);
  assert.deepEqual(A.pulls.filter(p => p[0] === 'op'), [['op', 'notifications'], ['op', 'notifications']]);
  A.SG.stop();
});

test('while typing or with a dialog open, nothing is taken; it is taken when the person stops', async () => {
  const A = load();
  A.SG.start(); await tick(20);
  A.setBusy('typing');
  A.W.emit({ key: 'meetings', n: 1, at: later(1), by_emp: 'E-1', by_dev: 'dOTHER' });
  await tick(1700);
  assert.equal(A.pulls.filter(p => p[0] === 'op').length, 0);
  A.setBusy('');
  await tick(5200);
  assert.deepEqual(A.pulls.filter(p => p[0] === 'op').map(p => p[1]), ['meetings']);
  A.SG.stop();
});

test('a pull that failed is taken again at the next read; without Realtime the table is read every minute (2 minutes back)', async () => {
  const A = load({ rtStatus: 'CHANNEL_ERROR', pullFail: 'meetings' });
  A.SG.start(); await tick(20);
  assert.equal(A.SG.state().k, 'poll');
  assert.equal(A.SG.live(), false);
  A.W.put('meetings', 3, later(1), 'E-1', 'dOTHER');
  await A.SG.pollNow('test'); await tick(1700);
  assert.equal(A.pulls.filter(p => p[0] === 'op').length, 1);
  await A.SG.pollNow('test'); await tick(1700);
  const q = new URL(A.W.fetches.filter(f => f.u.includes('sync_signal')).at(-1).u).searchParams.get('at');
  assert.ok(q && q.startsWith('gte.'), 'reads only the recent signals');
  assert.ok(Math.abs(Date.parse(q.slice(4)) - (Date.now() + 1000 - 120000)) < 5000, 'from 2 minutes before the last signal');
  assert.equal(A.pulls.filter(p => p[0] === 'op').length, 2, 'taken again because the first pull failed');
  A.SG.stop();
});

test('before the SQL (no table): nothing is watched and the 10-minute sync stays', async () => {
  const A = load({ missing: true });
  A.SG.start(); await tick(30);
  assert.equal(A.SG.state().k, 'missing'); assert.equal(A.SG.live(), false);
  assert.equal(A.W.rt.subs.length, 0);
  // the status module uses FUNERGY_SIGNAL.live() for the interval
  assert.match(source, /ST\.every = function\(\)\{ try\{ if\(W\.FUNERGY_SIGNAL && FUNERGY_SIGNAL\.live && FUNERGY_SIGNAL\.live\(\)\) return LIVE_EVERY; \}catch\(e\)\{\} return EVERY; \};/);
  assert.match(source, /now\(\) - AU\.last >= ST\.every\(\)\) ST\.autoSync\('timer'\)/);
  assert.match(source, /var LIVE_EVERY = 30 \* 60000;/);
  A.SG.stop();
});

test('sign-in and sign-out start and stop the watcher; sign-out removes the channel and forgets the log view', async () => {
  assert.match(source, /async function enterAppWithSync\(\)\{\n  try\{ if\(window\.FUNERGY_SIGNAL\) FUNERGY_SIGNAL\.mark\(\); \}catch\(e\)\{\}/);
  assert.match(source, /tipLiveStart\(\); \}catch\(e\)\{\}   \/\* v1091[^\n]*\n  try\{ if\(window\.FUNERGY_SIGNAL\) FUNERGY_SIGNAL\.start\(\); \}catch\(e\)\{\}/);
  assert.equal(source.split('FUNERGY_SIGNAL.stop(); FUNERGY_SIGNAL.clReset();').length - 1, 2, 'both copies of doLogout');
  const A = load();
  A.SG.start(); await tick(20);
  A.SG.stop();
  assert.equal(A.W.rt.removed, 1);
  A.W.emit({ key: 'meetings', n: 9, at: later(1), by_emp: 'E-1', by_dev: 'dOTHER' });
  await tick(1700);
  assert.equal(A.pulls.filter(p => p[0] === 'op').length, 0, 'nothing after sign-out');
});

test('signing out before the start finished: the table is not read and nothing is watched', async () => {
  const A = load();
  A.SG.start();
  A.SG.stop();   // sign-out while the check (probe) is still waiting
  await tick(50);
  assert.equal(A.W.fetches.filter(f => f.u.includes('/rest/v1/sync_signal?select=key,n,at')).length, 0, 'the signals are not read (only the header check ran)');
  assert.equal(A.W.rt.subs.length, 0, 'no channel');
  assert.equal(A.SG.state().k === 'live', false);
});

test('a changed employees master keeps the changes this device has not sent yet (the same merge as the sign-in pull)', async () => {
  const A = load();
  A.ctx._empMergeCloud = a => a.concat([{ id: 'E-PEND', name: 'まだ送れていない人', _pend: 1 }]);
  A.SG.start(); await tick(20);
  A.W.emit({ key: 'm:employees', n: 2, at: later(1), by_emp: 'E-1', by_dev: 'dOTHER' });
  await tick(1700);
  assert.deepEqual(A.pulls.filter(p => p[0] === 'master'), [['master', 'employees', 'data']]);
  const kept = JSON.parse(A.store.get('m_employees'));
  assert.deepEqual(kept.map(e => e.id), ['F01', 'E-PEND'], 'the row from the cloud and the unsent one');
  A.SG.stop();
});

test('the change log card: only CEO・GM・経理・事務Crew; the filters go to the function; names are escaped; an old function says so', async () => {
  for (const r of ['am', 'staff', 'g4']) assert.equal(load({ role: r }).SG.canLog(), false, r);
  for (const r of ['ceo', 'gm', 'office', 'office_crew']) assert.equal(load({ role: r }).SG.canLog(), true, r);
  const rows = [
    { id: 9, at: '2026-11-13T19:00:00Z', last_at: '2026-11-13T19:04:00Z', src: 'employees', key: 'employees', cat: null, by_emp: 'E-GM', by_name: 'Gina <script>', by_role: 'gm', by_kind: 'iphone', via: 'app', parts: ['E-1', 'E-2'], more: false, n: 3 },
    { id: 8, at: '2026-11-13T18:00:00Z', last_at: '2026-11-13T18:00:00Z', src: 'app_state', key: '_secure', cat: 'bonus', by_emp: 'E-GM', by_name: 'Gina', via: 'fn', parts: [], more: false, n: 1 },
    { id: 7, at: '2026-11-13T17:00:00Z', last_at: '2026-11-13T17:00:00Z', src: 'app_state', key: 'daily_actuals_F01', cat: null, by_emp: null, by_name: null, via: 'old', parts: ['2026-11-12'], more: false, n: 1 },
  ];
  const A = load({ ssAnswer: () => ({ ok: true, j: { rows, more: true, clfn: 1 } }) });
  A.doc.body.appendChild(Object.assign(A.doc.createElement('div'), { id: 'cl-list' }));
  for (const [id, v] of [['cl-days', '30'], ['cl-emp', 'E-1'], ['cl-src', 'employees'], ['cl-q', 'F01']]) A.doc.body.appendChild(Object.assign(A.doc.createElement('select'), { id, value: v }));
  await A.SG.clLoad(true);
  const call = A.pulls.find(p => p[0] === 'ssCall')[1];
  assert.equal(call.action, 'change_log'); assert.equal(call.emp, 'E-1'); assert.equal(call.src, 'employees'); assert.equal(call.q, 'F01'); assert.equal(call.limit, 100);
  assert.ok(Math.abs(Date.now() - 30 * 86400000 - Date.parse(call.from)) < 5000);
  const html = A.doc.getElementById('cl-list').innerHTML;
  assert.ok(!/<script>/.test(html) && /Gina &#60;script&#62;/.test(html), 'names are escaped');
  assert.match(html, /Ann &#60;b&#62;試験&#60;\/b&#62;・Bob/, 'employee ids are shown as names');
  assert.match(html, /賞与/); assert.match(html, /名前なし（前の版の端末）/); assert.match(html, /3 回/); assert.match(html, /もっと見る/);
  await A.SG.clLoad(false);
  assert.equal(A.pulls.filter(p => p[0] === 'ssCall').at(-1)[1].before, 7, 'the next page starts below the last id');
  // a wrong filter is not sent
  const B = load(); B.doc.body.appendChild(Object.assign(B.doc.createElement('div'), { id: 'cl-list' })); B.doc.body.appendChild(Object.assign(B.doc.createElement('input'), { id: 'cl-q', value: "x' or 1=1" }));
  await B.SG.clLoad(true);
  assert.equal(B.pulls.filter(p => p[0] === 'ssCall').length, 0); assert.match(B.doc.getElementById('cl-list').innerHTML, /英数字/);
  // an older function
  const C = load({ ssAnswer: () => ({ status: 400, error: 'unknown_action' }) }); C.doc.body.appendChild(Object.assign(C.doc.createElement('div'), { id: 'cl-list' }));
  await C.SG.clLoad(true);
  assert.match(C.doc.getElementById('cl-list').innerHTML, /v1151/);
  // the card is in 設定 › 診断と記録 for those who can see it
  assert.match(source, /if\(full && W\.FUNERGY_SIGNAL && FUNERGY_SIGNAL\.canLog && FUNERGY_SIGNAL\.canLog\(\)\) h \+= card\('ti-history-toggle', T\('変更の記録'/);
});

test('ssCall: the device header goes to secure-state only after it answered clfn:1, and is dropped if the function stops accepting it', async () => {
  const calls = [];
  let answer = { fn: 1, clfn: 1, ok: true }, refuseHdr = false;
  const ctx = {
    SUPABASE_URL: URL0, SUPABASE_ANON: ANON, SS_FN: '/functions/v1/secure-state', _ss: {}, window: null, JSON, Object, Date, setTimeout, clearTimeout, AbortController,
    ssSess: () => ({ id: 'S1', pin: 'tok' }), invInSessionRefresh: null, piiFnMark() {}, gbIsKey: () => false, csIsKey: () => false, gwIsKey: () => false, sw2IsKey: () => false, ghIsKey: () => false, tpIsKey: () => false, scIsKey: () => false,
    fpActorHdr: () => ({ 'x-fp-actor': 'AAAA' }),
    fetch: async (u, opt) => { calls.push(opt.headers['x-fp-actor'] || null); if (refuseHdr && opt.headers['x-fp-actor']) throw new TypeError('cors'); return { status: 200, ok: true, json: async () => ({ ...answer, gbfn: 1, csfn: 1, swfn: 1, sw2: 1, ghfn: 1, tpfn: 1, scfn: 1, hrfn: 1, piifn: 1 }) }; },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fn('ssCall'), ctx);
  await ctx.ssCall({ action: 'pull' });
  assert.deepEqual(calls, [null], 'the first call has no header');
  await ctx.ssCall({ action: 'pull' });
  assert.deepEqual(calls, [null, 'AAAA'], 'after clfn:1, the device header');
  refuseHdr = true;
  const r = await ctx.ssCall({ action: 'pull' });
  assert.equal(r.ok, true, 'tried again without the header');
  assert.deepEqual(calls, [null, 'AAAA', 'AAAA', null]);
  assert.equal(ctx._fpSsHdr, false);
  answer = { fn: 1, ok: true };   // an older function (no clfn): never starts sending
  await ctx.ssCall({ action: 'pull' });
  assert.equal(calls.at(-1), null);
});
