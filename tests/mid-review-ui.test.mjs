// 中間レビュー v2（段階 4-2・UI案44 B案・v1072）: the real screen module from index.html in a VM, talking to the real
// mid-review handler and the real SQL (all three migrations, PGlite) with the v2 demo. Synthetic data only; no network,
// no storage. Email sign-in is a stand-in for Supabase Auth; the PIN sign-in's mark is checked by a stand-in verifier.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHandler, missingV2, normBody, normSnap, demoSnapshot, demoData, KPI_PREV, KPI_CUR } from '../supabase/functions/mid-review/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const INDEX = process.env.FUNERGY_INDEX ? new URL(process.env.FUNERGY_INDEX, 'file://' + process.cwd() + '/') : new URL('../index.html', import.meta.url);
const html = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
const SQL = ['20261012090000_mid_review.sql', '20261013090000_mid_review_fixes.sql', '20261015090000_mid_review_v2.sql'].map(f => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8')).join('\n');
const B = '/* ===== v1066 中間レビュー（非公開版', E = '/* ===== v1066 中間レビュー ここまで ===== */';
const MOD = html.includes(B) ? html.slice(html.indexOf(B), html.indexOf(E)) : '';
const MEET = html.slice(html.indexOf('var MEET_KPI_DEF=['), html.indexOf('function _meetDiffStr('));
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const U = { ceo: '00000000-0000-4000-8000-0000000000c1', gm: '00000000-0000-4000-8000-0000000000c2', office: '00000000-0000-4000-8000-0000000000c3',
  am1: '00000000-0000-4000-8000-0000000000c5', am2: '00000000-0000-4000-8000-0000000000c6' };
const EMPLOYEES = [['E1', 'CEO Test', 'ceo', 'CEO'], ['E2', 'GM Test', 'gm', 'General Manager'], ['E3', 'Office Test', 'office', 'Accounting'], ['E5', 'Yuki', 'am', 'Area Manager'],
  ['E6', 'AM Two', 'am', 'Area Manager'], ['E10', 'Chef Oka', 'g4', 'Head Chef'], ['E11', 'Corp Chef', 'chef', 'Corporate Chef'], ['E12', 'Server Lead', 'g3', 'Server Leader'],
  ['E13', 'Store Mgr', 'g4', 'Store Manager'], ['E14', 'Op Lead', 'g3', 'Operation Leader'], ['E17', 'Crew Kid', 'crew', 'Server']];

async function server({ on = true, demo = true, verifier = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, emp_code text, role text, perms jsonb, title text, store text, support jsonb, status text, emp_type text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean, data jsonb);
    grant select on public.manager_auth, public.employees, public.stores to service_role;
    insert into public.stores(id, name, am, active) values ('F01','ToriTon','Yuki',true),('F02','Tenkichi','Yuki',true),('F05','Marujuu','AM Two',true),('F06','LaLa',null,true);`);
  for (const [id, name, role, title] of EMPLOYEES) await pg.query(`insert into employees(id, name, role, title, status) values($1,$2,$3,$4,'在籍')`, [id, name, role, title]);
  for (const [k, r, e] of [['ceo', 'ceo', 'E1'], ['gm', 'gm', 'E2'], ['office', 'office', 'E3']]) await pg.query('insert into manager_auth values($1,$2,$3)', [U[k], r, e]);
  await pg.exec(SQL);
  await pg.query(`insert into mr_members(user_id, emp_id, name, role) values($1,'E5','Yuki','am'),($2,'E6','AM Two','am')`, [U.am1, U.am2]);
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const fetch = async (url, init) => { const id = U[(init.headers.authorization || '').replace('Bearer tok-', '')]; return id ? Response.json({ id }) : new Response('{}', { status: 401 }); };
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k];
  // The PIN sign-in's mark as the stand-in verifier reads it: 'pin-E12' → employee E12. (The real one is auth-pin's.)
  const verifyPin = async tok => { const m = /^pin-(E\d+)(-\w+)?$/.exec(tok); return m ? { emp_id: m[1] } : null; };   // 'pin-E2-2': a newer mark of E2
  const h = createHandler({ env, fetch, db, ...(verifier ? { verifyPin } : {}) });
  const call = async (headers, body) => (await h(new Request('https://fn.test', { method: 'POST', headers, body: JSON.stringify(body) }))).json();
  const api = (who, body) => call({ authorization: 'Bearer tok-' + who }, body);
  const pin = (tok, body) => call({ authorization: 'Bearer anon-key' }, { ...body, pin_session: tok });
  const q = async (sql, p = []) => { await pg.exec('reset role'); try { return (await pg.query(sql, p)).rows; } finally { await pg.exec('set role service_role'); } };
  if (on) await api('gm', { action: 'settings_save', key: 'flags', value: { private: true } });
  if (on && demo) await api('gm', { action: 'demo_reset' });
  return { h, pg, api, pin, q };
}
// Live: F01 (ToriTon, AM Yuki) reported by E12 (Server Lead, PIN), F02 (Tenkichi) by Yuki herself, F05 (Marujuu, AM Two) by E14 with Yuki as an extra viewer.
async function live(S, { input = true } = {}) {
  await S.api('gm', { action: 'settings_save', key: 'flags', value: { private: true, live_input: input } });
  await S.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: U.am1, sort: 1 }, { store_id: 'F02', name: 'Tenkichi', am_user: U.am1, sort: 2 },
    { store_id: 'F05', name: 'Marujuu', am_user: U.am2, sort: 3 }, { store_id: 'F06', name: 'LaLa', am_user: null, sort: 4 }] });
  const r = await S.api('gm', { action: 'access_save', stores: [{ store_id: 'F01', input_emp: 'E12', viewer_emps: [] }, { store_id: 'F02', input_emp: 'E5', viewer_emps: [] },
    { store_id: 'F05', input_emp: 'E14', viewer_emps: ['E5'] }] });
  assert.equal(r.saved, 3, JSON.stringify(r));
}
// The meeting tab's numbers as the stand-in app gives them (keyKpiStats … _meetKpiRows). [act, tgt]; state = _meetConfirmState.
const KPI = {
  F01: { '2026-10': { sales: [48000, 50000], guests: [1900, 2000], ppa: [25.26, 25], repeat: [29, 30], labor: [29.6, 27], fc: [31.8, 30.5] },
    '2026-09': { state: 'final', sales: [121400, 118000], guests: [4620, 4800], ppa: [26.28, 24.6], repeat: [33.1, 38], labor: [28.4, 27], fc: [31, 30.5] } },
  F02: { '2026-10': { sales: [30000, 0], guests: [1000, 1100], ppa: [30, 27.27], labor: [25, 26], fc: [30, 31] }, '2026-09': { state: 'comb', sales: [90000, 88000], guests: [3000, 3100], ppa: [30, 28.4], labor: [26, 26], fc: [31, 30] } },
  F05: { '2026-10': {}, '2026-09': {} }, F06: { '2026-10': {}, '2026-09': {} },
};
const QB = { 'F01_2026Q4': { focusItems: ['repeat', 'menu'] } };
const QROWS = { F01: [{ key: 'repeat', label: 'リピート強化', mode: 'auto', kpiLabel: 'リピート率', unit: '%', lower: false, now: 29, prev: 27.5, has: true, prevLabel: 'Q3' },
  { key: 'menu', label: 'メニュー・商品力', mode: 'manual', notes: [], last: null }] };
const STORES = [{ id: 'F01', name: 'ToriTon', am: 'Yuki', active: true }, { id: 'F02', name: 'Tenkichi', am: 'Yuki', active: true }, { id: 'F05', name: 'Marujuu', am: 'AM Two', active: true }, { id: 'F06', name: 'LaLa', am: '', active: true }];

// The app around the module: only what the module calls. The browser's fetch goes to the real handler.
function app(S, { who = 'gm', role = 'gm', signed = true, pin = null, kept = null, lp = { id: 'E2', name: 'GM Test' }, defaultPin = false, lang = 'ja', net = true, kpi = KPI, qb = QB } = {}) {
  const timers = [];
  const row = (sid, ym) => (kpi[sid] && kpi[sid][ym]) || {};
  const c = {
    curLang: lang, curRealRole: role, curStoreLogin: false, curPage: 'mid_review', html: '', toasts: [], modals: [], calls: [], keep: [], writes: [], went: [],
    t: (ja, en) => (c.curLang === 'en' ? en : ja), escapeHtml: esc, ls: () => ({}), lsSet: (...a) => { c.writes.push(a); return true; },
    SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON: 'anon-key', _botSession: signed ? { access_token: 'tok-' + who, refresh_token: 'r-' + who } : null,
    _hwSession: pin, _invIn: { keptSession: null }, botResetShared: () => { c._botSession = null; },
    invInSession: () => c._botSession, invInSigned: () => !!(c._botSession && c._botSession.access_token), invInKept: () => kept, invInKeepWho: () => (lp && !defaultPin ? 'e:' + lp.id : ''),
    invInLoginPerson: () => lp, invInDefaultPin: () => defaultPin, invInKeepSet: (rt, w) => { c.keep.push([rt, w]); return true; }, invInSessionRefresh: async () => null,
    invInRestore: async () => { c.restored = true; return false; }, invInAuthFetch: async (path, opt) => {
      if (path.includes('grant_type=password')) return opt.body.password === 'pw' ? { ok: true, json: async () => ({ access_token: 'tok-' + opt.body.email.split('@')[0], refresh_token: 'rt-new' }) } : { ok: false, json: async () => ({}) };
      throw new Error('unexpected ' + path);
    },
    bizNow: () => new Date(2026, 9, 18, 9, 30), bizYm: () => '2026-10', daysOfYm: ym => Array.from({ length: ym.endsWith('-09') ? 30 : 31 }, (_, i) => ({ date: ym + '-' + String(i + 1).padStart(2, '0') })),
    getStoresAll: () => STORES, activeStores: () => STORES, getEmployees: () => EMPLOYEES.map(([id, name, r]) => ({ id, name, role: r })),
    keyKpiStats: ([s], days) => { const ym = days[0].date.slice(0, 7), d = row(s.id, ym); return { sid: s.id, ym, sales: d.sales ? d.sales[0] : 0 }; },
    _meetApplyPl: k => k, meetingBudgetKpi: (k, cur) => ({ ...k, cur, budget: (row(k.sid, k.ym).sales || [0, 0])[1] }),
    _meetKpiRows: p => ['sales', 'guests', 'ppa', 'repeat', 'fc', 'labor'].filter(key => row(p.sid, p.ym)[key] || key !== 'repeat')
      .map(key => { const v = row(p.sid, p.ym)[key] || [0, null]; return { key, label: key, act: v[0], tgt: v[1], lower: key === 'fc' || key === 'labor' }; }),
    _meetConfirmState: (sid, ym) => row(sid, ym).state || 'prov',
    getQBudget: (sid, y, q) => qb[sid + '_' + y + 'Q' + q] || null, qcFocusRows: sid => QROWS[sid] || [],
    budgetTab: 'daily', _budgetStore: 'ALL', dailyMonthOffset: 0, go: p => c.went.push(['go', p, c.budgetTab, c._budgetStore, c.dailyMonthOffset]),
    loadMonthAndRerender: (ym, p) => c.went.push(['load', ym, p]), ymFromOffset: o => '2026-' + String(10 + o).padStart(2, '0'),
    showToast: (m, k) => c.toasts.push([m, k]), openModal: h => c.modals.push(h), closeModalDirect: () => {}, confirm: () => true,
    renderPage: () => { c.html = c.renderMidReview(); }, document: { getElementById: k => (c.dom || {})[k] || null, querySelectorAll: () => c.qsa || [] },
    setTimeout: f => { const id = ++c.tid; timers.push([id, f]); return id; }, clearTimeout: id => { const i = timers.findIndex(x => x[0] === id); if (i >= 0) timers.splice(i, 1); }, tid: 0, console,
    crypto: globalThis.crypto, atob: s => Buffer.from(s, 'base64').toString('binary'),
    fetch: async (url, init) => {
      if (!net) throw new TypeError('Failed to fetch');
      const body = JSON.parse(init.body); c.calls.push({ ...body, _auth: init.headers.Authorization });
      const r = await S.h(new Request('https://fn.test', { method: 'POST', headers: { authorization: init.headers.Authorization }, body: init.body }));
      return { ok: r.ok, status: r.status, json: () => r.json() };
    },
  };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(MEET + '\n' + MOD + '\nthis.renderMidReview = renderMidReview; this.M = () => _mr;', c);
  c.flush = async () => { for (let i = 0; i < 80 && timers.length; i++) { const [, f] = timers.shift(); await f(); for (let k = 0; k < 4; k++) await new Promise(r => setImmediate(r)); } };
  c.pending = () => timers.length;
  c.show = async () => { c.renderPage(); await c.flush(); c.renderPage(); return c.html; };
  c.run = src => vm.runInContext(src, c);
  return c;
}
const strip = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const openStore = async (c, id) => { await c.show(); c.run(`mrOpenStore(${JSON.stringify(id)})`); c.renderPage(); await c.flush(); c.renderPage(); };
// Fills every required field still missing in the open editor (with the screen's own rule).
const fillAll = c => {
  const miss = c.run('mrMissingV2(_mr.ed.body, mrSnapNow(_mr.rec)).missing');
  for (const code of miss) {
    const p = code.split(':');
    if (code === 'consult') c.run("mrSetVal('consult','none')");
    else if (p[0] === 'prev' || p[0] === 'cur') c.run(p[2] === 'eval' ? `mrSetVal('${p[0]}.${p[1]}.eval', 3)` : `mrSetVal('${p[0]}.${p[1]}.${p[2]}', 'テスト ${p[2]}')`);
    else if (p[0] === 'focus') c.run(p[2] === 'status' ? `mrSetVal('focus.${p[1]}.status','ok')` : `mrSetVal('focus.${p[1]}.${p[2]}','テスト ${p[2]}')`);
    else c.run(`mrSetVal('issues.' + _mr.ed.body.issues.findIndex(function(x){ return x.id === ${JSON.stringify(p[1])}; }) + '.${p[2]}', 'テスト')`);
  }
  return miss;
};
const get = async (S, store, who = 'gm', env = 'demo', ym = '2026-10') => S.api(who, { action: 'get', env, ym, store_id: store });
const cardOf = (h, id) => { const i = h.indexOf('id="mr-k-' + id + '"'); assert.ok(i >= 0, 'card ' + id); const j = h.indexOf('<div class="mr-k ', i + 10); return h.slice(h.lastIndexOf('<div', i), j < 0 ? h.length : j); };
const dataCodes = h => [...h.matchAll(/data-codes="([^"]*)"/g)].flatMap(m => m[1].split(' '));

test('the module is in index.html; the entry is wired; nothing of the review goes to shared app data; v1072', () => {
  assert.ok(MOD.length > 20000, 'module markers');
  assert.match(html, /\{id:'mid_review',\s+label:'中間レビュー', icon:'ti-message-2-check',\s+roles:\['ceo','gm','am','chef','sl'\]\}/);
  assert.match(html, /children:\['budget','mid_review','labor','foodcost','kpi_master'\]\}/);
  assert.match(html, /\{id:'gc_budget', label:'予実', icon:'ti-chart-bar',\n    children:\['budget','mid_review','labor','foodcost','kpi_master'\]\},/);
  assert.match(html, /case 'mid_review':\s+el\.innerHTML = renderMidReview\(\)/);
  assert.match(html, /if\(typeof mrReset==='function'\) mrReset\(\);/);
  assert.doesNotMatch(MOD, /lsSet\(|\bls\('|localStorage|sessionStorage|supaUpsert|pushOpKey|setQBudgetObj|saveQcNote/);
  assert.match(html, /const APP_VERSION = '1072';/);
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /const SW_BUILD = '1072';/);
  // The old v1 reply steps are not called any more.
  assert.doesNotMatch(MOD, /'reply_save'|'reply_send'|'reply_delete'|'result_save'|action:'complete'/);
});

const fnSrc = name => { const st = html.indexOf('function ' + name + '('); assert.ok(st >= 0, name); const a = html.lastIndexOf('\n', st) + 1; return html.slice(a, html.indexOf('\n}', st) + 2); };
const constSrc = name => { const st = html.indexOf('const ' + name + ' = ['); assert.ok(st >= 0, name); const en = html.indexOf('\n]', st); return html.slice(st, en + 2).replace('const ', 'var ') + ';'; };

test('menu: CEO, GM, AM, Corporate Chef, G4 and G3 get the entry (the server decides what they see); G2, office, crew and store logins do not', () => {
  for (const [real, role, store, want] of [['ceo', 'ceo', 'ALL', true], ['gm', 'gm', 'ALL', true], ['am', 'am', 'ALL', true], ['chef', 'chef', 'OFFICE', true], ['g4', 'am', 'F01', true],
    ['sl', 'sl', 'F01', true], ['g2', 'sl', 'F01', false], ['office', 'office', 'ALL', false], ['office_crew', 'office_crew', 'ALL', false], ['crew', 'crew', 'F01', false]]) {
    const c = { curRealRole: real, curRole: role, curStore: store, curStoreLogin: false, mcCanOpen: () => true, mdCanOpen: () => true, _gradeHideApplies: () => false,
      canAccessStaffMaster: () => true, canAccessKpiMaster: () => true, canSeeDashboard: () => true, console };
    vm.createContext(c);
    vm.runInContext(['NAV_ITEMS', 'MENU_GROUPS', 'OFFICE_GROUPS', 'ACCT_GROUPS', 'CHEF_GROUPS', 'CREW_GROUPS', 'STORE_GROUPS'].map(constSrc).join('\n') + '\n' + MOD + '\n' + fnSrc('groupsForRole') + '\n' + fnSrc('firstAllowedChild'), c);
    assert.equal(vm.runInContext('mrCanSee()', c), want, real);
    const has = vm.runInContext('groupsForRole()', c).some(g => g.children.includes('mid_review'));
    assert.equal(has, want, real);
    if (real === 'g2') assert.equal(vm.runInContext(`firstAllowedChild({ children:['mid_review','budget'] })`, c), 'budget', real);   // never lands a G2 on it
  }
  const st = { curRealRole: 'gm', curStoreLogin: true }; vm.createContext(st); vm.runInContext(MOD, st);
  assert.equal(vm.runInContext('mrCanSee()', st), false);
});

test('sign-in: the PIN login works without any email step; via and actor are never sent; no mark or an expired one says so', async () => {
  const S = await server();
  const c = app(S, { signed: false, pin: 'pin-E2' });
  await S.q(`update mr_members set emp_id='E2' where user_id=$1`, [U.gm]);
  const h = await c.show();
  assert.match(h, /PIN でログイン中：GM Test（GM）/); assert.match(h, /港町（デモ）/);
  assert.ok(c.calls.length > 1);
  for (const b of c.calls) { assert.equal(b.pin_session, 'pin-E2'); assert.equal(b._auth, 'Bearer anon-key'); assert.ok(!('via' in b) && !('actor' in b), JSON.stringify(b)); }
  assert.equal(c.M().who.via, 'pin');
  // An email sign-in sends the access key and no PIN mark.
  const e = app(S); await e.show();
  for (const b of e.calls) { assert.equal(b._auth, 'Bearer tok-gm'); assert.ok(!('pin_session' in b) && !('via' in b) && !('actor' in b)); }
  assert.equal(e.M().who.via, 'email');
  // No mark (initial PIN, or no login): no request, and a plain message.
  const n = app(S, { signed: false, pin: null });
  assert.match(await n.show(), /PIN のログインの印がありません/); assert.equal(n.calls.length, 0);
  const d = app(S, { signed: false, pin: null, defaultPin: true });
  assert.match(await d.show(), /PIN が初期のまま/);
  // An expired mark: log out and in again.
  const exp = 'h.' + Buffer.from(JSON.stringify({ exp: 1000 })).toString('base64url') + '.s';
  const x = app(S, { signed: false, pin: exp });
  assert.match(await x.show(), /ログインの期限が切れました/); assert.equal(x.calls.length, 0);
  // The server does not accept PIN yet (no verifier): its answer in plain words, with the email sign-in offered.
  const S0 = await server({ verifier: false });
  const p = app(S0, { signed: false, pin: 'pin-E2' });
  const hp = await p.show();
  assert.match(hp, /PIN のログインで入れませんでした（サーバーがまだ PIN のログインを受け付けていないか/); assert.match(hp, /mrLoginModal\(\)/);
  // A remembered email sign-in is tried first (once).
  const k = app(S, { signed: false, pin: 'pin-E2', kept: { rt: 'x' } });
  assert.match(k.run('renderMidReview()'), /覚えた認証を確かめています/);
  await k.flush(); assert.equal(k.restored, true); k.renderPage(); await k.flush();
  assert.equal(k.M().who.via, 'pin');
});

test('sign-in: a person who is not a member is told plainly; an email account that cannot open it can fall back to the PIN login', async () => {
  const S = await server();
  const s = app(S, { signed: false, pin: 'pin-E17', role: 'sl' });
  assert.match(await s.show(), /中間レビューを開けません/);
  const o = app(S, { who: 'office', pin: 'pin-E5', lp: { id: 'E5', name: 'Yuki' }, role: 'am' });
  const h = await o.show(); assert.match(h, /PIN のログインで開く/);
  o.run('mrUsePin()'); const h2 = await o.show();
  assert.match(h2, /PIN でログイン中：Yuki（AM）/); assert.equal(o.M().who.role, 'am');
  const n = app(S, { net: false }); assert.match(await n.show(), /mid-review）につながりません/);
});

test('email sign-in from the dialog: remembered only when the server says it is this PIN person; it brings back the settings', async () => {
  const S = await server();
  const c = app(S, { signed: false, pin: 'pin-E2' });
  await S.q(`update mr_members set emp_id='E2' where user_id=$1`, [U.gm]);
  await c.show(); c.run('mrOpenSettings()'); const h = await c.show();
  assert.match(h, /担当・閲覧設定の変更はメールの認証が要ります/); assert.equal(c.calls.filter(b => b.action === 'access_get').length, 0);
  c.run('mrLoginModal()'); assert.match(c.modals[0], /id="mr-keep"/); assert.match(c.modals[0], /担当・閲覧設定を変えるとき/);
  c.dom = { 'mr-email': { value: 'gm@x' }, 'mr-password': { value: 'pw' }, 'mr-login-button': { disabled: false }, 'mr-keep': { checked: true }, 'mr-login-error': { textContent: '' } };
  await c.run('mrLogin()');
  assert.deepEqual(c.keep, [['rt-new', 'e:E2']]); assert.equal(c.M().who.via, 'email'); assert.ok(c.M().view.settings);
  const hs = await c.show(); assert.match(hs, /入力・提出の担当（基本）|本番の店舗がまだ保存されていません/);
  // Someone else's account: not remembered.
  const o = app(S, { signed: false, pin: 'pin-E2' });
  o.dom = { 'mr-email': { value: 'am1@x' }, 'mr-password': { value: 'pw' }, 'mr-login-button': { disabled: false }, 'mr-keep': { checked: true }, 'mr-login-error': { textContent: '' } };
  await o.run('mrLogin()'); assert.deepEqual(o.keep, [[null, 'e:E2']]); assert.equal(o.M().who.role, 'am');
  const w = app(S, { signed: false, pin: 'pin-E2' });
  w.dom = { 'mr-email': { value: 'gm@x' }, 'mr-password': { value: 'bad' }, 'mr-login-button': { disabled: false }, 'mr-login-error': { textContent: '' } };
  await w.run('mrLogin()'); assert.match(w.dom['mr-login-error'].textContent, /メール・パスワードを確認/);
});

test('off: nobody can list; an email GM turns it on; a PIN GM is told to sign in by email; others wait', async () => {
  const S = await server({ on: false });
  const a = app(S, { who: 'am1', role: 'am' }); assert.match(await a.show(), /GM・CEO が ON にするまでお待ちください/);
  await S.q(`update mr_members set emp_id='E2' where user_id=$1`, [U.gm]);
  const p = app(S, { signed: false, pin: 'pin-E2' }); assert.match(await p.show(), /ON にするにはメールの認証が要ります/);
  const g = app(S); assert.match(await g.show(), /非公開確認を ON にする/);
  await g.run('mrSetFlags({ private:true })'); await g.show();
  assert.match(g.html, /デモがまだありません/);
  assert.deepEqual(g.calls.filter(b => b.action === 'settings_save').map(b => b.value), [{ private: true, live_input: false }]);
});

test('全店 (demo): status, input person, separate counts equal to the server, deadlines and overdue only when a date is set', async () => {
  const S = await server();
  const c = app(S); const h = await c.show(), s = strip(h);
  const L = await S.api('gm', { action: 'list', env: 'demo', ym: '2026-10' });
  for (const st of L.stores) {
    const row = (h.match(new RegExp('<tr onclick="mrOpenStore\\(\'' + st.store_id + '\'\\)">[\\s\\S]*?</tr>')) || [''])[0];
    assert.ok(row, st.store_id);
    const c0 = st.review.counts;
    if (c0) {
      assert.ok(row.includes('未達の KPI <b>' + c0.miss_cur + '</b>') && row.includes('評価 1・2 <b>' + c0.eval_low + '</b>') && row.includes('対策あり <b>' + c0.measures + '</b>')
        && row.includes('相談 <b>' + c0.consult + '</b>') && row.includes('未返信の項目 <b>' + c0.unanswered + '</b>') && row.includes('評価保留 <b>' + c0.holds + '</b>'), st.store_id);
      assert.ok(row.includes('順調 ' + c0.focus.ok + '・遅延 ' + c0.focus.late + '・完了 ' + c0.focus.done + '・支援必要 ' + c0.focus.help), st.store_id);
    } else assert.match(row, /まだ提出されていない/);
    assert.ok(row.includes(esc(st.input.name)), st.store_id);
    assert.equal((row.match(/期限超過/g) || []).length, (st.review.overdue.submit ? 1 : 0) + (st.review.overdue.reply ? 1 : 0), st.store_id);
  }
  assert.match(s, /港町（デモ） 担当：AM 佐藤（デモ） 提出済み（提出版 1）/);
  assert.match(s, /丘の上（デモ） .* ✓ 確認完了（提出版 1）/);
  assert.match(s, /川沿い（デモ） AM 未設定 下書き（未提出） 入力担当： 店長 Nguyen（デモ） まだ提出されていない 提出 10\/15 期限超過 返信 未設定/);
  assert.match(s, /海岸（デモ） .* 提出 未設定 返信 未設定/);
  assert.match(s, /公園通り（デモ） .* 提出 未設定 返信 10\/17 期限超過/);
  assert.match(h, /担当・閲覧設定/);
  // The phone gets cards with the same facts (the table is hidden there by CSS).
  assert.equal((h.match(/class="card mr-lcard"/g) || []).length, 6);
  // An AM: no settings button.
  const a = app(S, { who: 'am1', role: 'am' }); assert.doesNotMatch(await a.show(), /mrOpenSettings/);
});

test('live: who sees which store — CEO / GM / chef all, an AM their own and where added as a viewer, a staff input person only theirs; 入力担当：未設定', async () => {
  const S = await server(); await live(S);
  await S.api('gm', { action: 'chef_save', emp_id: 'E11', on: true });
  const names = async c => { c.run("mrSetEnv('live')"); const h = await c.show(); return [...h.matchAll(/<tr onclick="mrOpenStore\('([^']+)'\)">/g)].map(m => m[1]); };
  assert.deepEqual(await names(app(S)), ['F01', 'F02', 'F05', 'F06']);
  assert.deepEqual(await names(app(S, { signed: false, pin: 'pin-E11', role: 'chef', lp: { id: 'E11', name: 'Corp Chef' } })), ['F01', 'F02', 'F05', 'F06']);
  assert.deepEqual(await names(app(S, { who: 'am1', role: 'am' })), ['F01', 'F02', 'F05']);   // F05 as an extra viewer
  assert.deepEqual(await names(app(S, { who: 'am2', role: 'am' })), ['F05']);
  assert.deepEqual(await names(app(S, { signed: false, pin: 'pin-E12', role: 'sl', lp: { id: 'E12', name: 'Server Lead' } })), ['F01']);
  const g = app(S); g.run("mrSetEnv('live')"); const h = strip(await g.show());
  assert.match(h, /LaLa AM 未設定 未作成 入力担当：未設定/);
  assert.match(h, /ToriTon 担当：Yuki 未作成 入力担当： Server Lead/);
});

test('store page (write): every item is a full card — result, rating, comment / action — with 必須 / 任意; colours follow the judgement; this month’s food cost has no inputs', async () => {
  const S = await server();
  const c = app(S); await openStore(c, 'D6');
  assert.equal(c.run('mrOpNow(_mr.rec)'), 'write');
  const h = c.html, d = demoData('2026-10').stores.find(x => x.store_id === 'D6').demo, sn = demoSnapshot('2026-10', d);
  for (const k of KPI_PREV) {
    const card = cardOf(h, 'prev-' + k), j = sn.prev.rows[k].judge;
    assert.match(card, new RegExp('class="mr-k mr-k-' + j + '"'), k);
    assert.match(card, /data-p="prev\.\w+\.comment"/); assert.match(card, /role="radiogroup"/);
    assert.match(card, j === 'ok' ? /✓ 達成/ : j === 'warn' ? /△ 注意/ : /✗ 未達/);
    assert.ok(card.includes('data-req="prev:' + k + ':eval"') && card.includes('data-req="prev:' + k + ':comment"'), k);   // 必須 even when met
    assert.match(card, /今月の改善<span class="mr-opt">任意<\/span>/);
  }
  // Achieved this month (sales, guests, labor) are full cards too, with optional fields; repeat is a miss with required rating and action.
  for (const k of ['sales', 'guests', 'labor']) { const card = cardOf(h, 'cur-' + k); assert.match(card, /mr-k-ok/); assert.match(card, /担当者評価<span class="mr-opt">任意/); assert.doesNotMatch(card, /data-req=/); }
  const miss = cardOf(h, 'cur-repeat');
  assert.match(miss, /mr-k-miss/); assert.match(miss, /✗ 未達/); assert.match(miss, /data-req="cur:repeat:eval" data-sel="1">必須</);   // the demo draft already has a rating
  assert.match(miss, /data-req="cur:repeat:measure" data-sel="0">必須・未入力/); assert.match(miss, /class="mr-ta mr-empty" data-need="cur:repeat:measure"/);
  assert.match(miss, /原因・見立て<span class="mr-opt">任意/); assert.match(miss, /担当<span class="mr-opt">任意/); assert.match(miss, /期限<span class="mr-opt">任意/);
  assert.match(cardOf(h, 'cur-ppa'), /mr-k-warn/);
  const fc = cardOf(h, 'cur-fc'); assert.match(fc, /mr-k mr-k-ref/); assert.match(fc, /速報・評価対象外/); assert.doesNotMatch(fc, /data-p=|<textarea|mr-scale/);
  // An empty required field is outlined red; a filled one is not, and its label says 必須 only.
  assert.match(cardOf(h, 'prev-guests'), /class="mr-scale mr-empty" data-need="prev:guests:eval"/);
  assert.match(cardOf(h, 'prev-sales'), /data-req="prev:sales:eval" data-sel="1">必須</);
  assert.match(cardOf(h, 'prev-sales'), /<button class="mr-sc on" role="radio" aria-checked="true" onclick="mrSetVal\('prev\.sales\.eval',4,true,true\)">/);
  // Focus items: all five required; consult: one of the two required.
  for (const f of ['status', 'done', 'remaining', 'next', 'owner']) assert.ok(cardOf(h, 'focus-cs').includes('data-req="focus:cs:' + f + '"'), f);
  assert.match(h, /data-req="consult" data-sel="1">必須・未選択/); assert.match(h, /class="mr-radios mr-empty" data-need="consult"/);
  // The number strip (same numbers as the cards) jumps to the cards; 5 steps on the left; the phone gets a submit bar.
  assert.match(h, /数字の一覧（会議タブと同じ）/); assert.match(h, /onclick="mrGo\('k-prev-sales'\)"/); assert.match(h, /onclick="mrGo\('k-cur-fc'\)"/);
  for (const s of ['前月の振り返り', '今月の進捗', '重点項目（Qコミット）', '相談・支援依頼', '確認・提出']) assert.ok(h.includes(s), s);
  assert.match(h, /<div class="mr-subbar" id="mr-subbar">.*提出の前に あと 9/);
  assert.match(h, /あなたの操作：<b class="">報告を書く/);
});

test('judgements that cannot be made: last month not final → all six on hold (optional); no target / no data → neutral with the reason, optional', async () => {
  const S = await server();
  const c = app(S); await openStore(c, 'D3'); c.run("mrSetOp('write')"); c.renderPage(); const h = c.html;
  for (const k of KPI_PREV) { const card = cardOf(h, 'prev-' + k); assert.match(card, /mr-k-na/); assert.match(card, /評価保留（前月が未確定）/); assert.doesNotMatch(card, /data-req=/); assert.match(card, /担当者評価<span class="mr-opt">任意/); }
  assert.match(cardOf(h, 'prev-sales'), /速報の判定：未達/);
  const d4 = app(S); await openStore(d4, 'D4'); d4.run("mrSetOp('write')"); d4.renderPage();
  assert.match(cardOf(d4.html, 'prev-labor'), /mr-k-na[\s\S]*評価保留（目標未設定）/); assert.doesNotMatch(cardOf(d4.html, 'prev-labor'), /data-req=/);
  assert.match(cardOf(d4.html, 'cur-labor'), /mr-k-na[\s\S]*判定不可（目標未設定）/); assert.doesNotMatch(cardOf(d4.html, 'cur-labor'), /data-req=/);
  const d5 = app(S); await openStore(d5, 'D5'); d5.run("mrSetOp('write')"); d5.renderPage();
  assert.match(cardOf(d5.html, 'cur-sales'), /判定不可（未取得）/);
  assert.match(d5.html, /<button class="mr-mt mr-mt-na" onclick="mrGo\('k-cur-sales'\)"><span class="mr-mtl">売上<\/span><b>— 判定不可<\/b>/);
});

test('the screen’s rules equal the server’s: missing items, counts and the demo numbers', () => {
  const c = app({ h: null });
  const DD = demoData('2026-10');
  for (const st of DD.stores) {
    const mine = JSON.parse(c.run(`JSON.stringify(mrDemoSnap('2026-10', ${JSON.stringify(st.demo)}))`));
    assert.deepEqual(mine, JSON.parse(JSON.stringify(demoSnapshot('2026-10', st.demo))), st.store_id);
  }
  // Random bodies and numbers: the screen's missing list and holds equal the server's (same codes, same order).
  let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const pick = a => a[rnd(a.length)];
  for (let i = 0; i < 400; i++) {
    const judges = ['ok', 'warn', 'miss', 'unset', 'missing'], keys = ['repeat', 'menu', 'ppa', 'cs'].filter(() => rnd(2));
    const sn = { prev: { state: pick(['final', 'prov', 'none', 'final']), rows: Object.fromEntries(KPI_PREV.map(k => [k, { judge: pick(judges) }])) },
      cur: { rows: Object.fromEntries(KPI_CUR.map(k => [k, { judge: pick(judges) }])) }, focus: { keys } };
    const txt = () => pick(['', ' ', '　', 'あ', null, '\n']);
    const b = { prev: Object.fromEntries(KPI_PREV.map(k => [k, { eval: pick([null, 1, 3, 5, 0, 6, 2.5, '3']), comment: txt() }])),
      cur: Object.fromEntries(KPI_CUR.map(k => [k, { eval: pick([null, 2, 4, 7]), measure: txt() }])),
      focus: Object.fromEntries(keys.filter(() => rnd(3)).map(k => [k, { status: pick(['', 'ok', 'late', 'done', 'help', 'x']), done: txt(), remaining: txt(), next: txt(), owner: txt() }])),
      consult: pick(['', 'yes', 'none', 'maybe']), issues: Array.from({ length: rnd(3) }, (_, j) => ({ id: pick(['i' + j, null, 7]), what: txt(), ask: txt() })) };
    const mine = JSON.parse(c.run(`JSON.stringify(mrMissingV2(${JSON.stringify(b)}, ${JSON.stringify(sn)}))`));
    assert.deepEqual(mine, missingV2(b, sn), JSON.stringify(b));
  }
});

test('counts on the screen (rail, chips) equal the server’s counts for every demo store; the rail filters show only those items', async () => {
  const S = await server();
  const L = await S.api('gm', { action: 'list', env: 'demo', ym: '2026-10' });
  for (const st of L.stores.filter(x => x.review.counts)) {
    const R = await get(S, st.store_id); const last = R.submissions.at(-1);
    const c = app(S);
    const mine = JSON.parse(c.run(`(function(){ var x = mrCounts(${JSON.stringify(last.body)}, ${JSON.stringify(last.snapshot)}, ${JSON.stringify(R.replies)}, ${last.no}); delete x.items; delete x.open; return JSON.stringify(x); })()`));
    assert.deepEqual(mine, st.review.counts, st.store_id);
  }
  const c = app(S); await openStore(c, 'D3');
  assert.equal(c.run('mrOpNow(_mr.rec)'), 'review');
  const rail = c.html.slice(c.html.indexOf('id="mr-rail"'), c.html.indexOf('</nav>'));
  const cnt = L.stores.find(x => x.store_id === 'D3').review.counts;
  for (const [l, n] of [['未達の KPI', cnt.miss_cur], ['担当者評価 1・2', cnt.eval_low], ['対策あり', cnt.measures], ['相談', cnt.consult], ['未返信の項目', cnt.unanswered], ['評価保留', cnt.holds]])
    assert.ok(new RegExp('<span class="mr-rl">' + l + '</span><span class="mr-cnt [^"]+">' + n + '</span>').test(rail), l);
  assert.match(rail, /順調 0・遅延 2・支援必要 1・完了 0/);
  c.run("mrSetFlt('unanswered')"); c.renderPage();
  const shown = [...c.html.matchAll(/id="mr-k-([a-z]+-[A-Za-z0-9_]+)"/g)].map(m => m[1].replace('-', ':')).sort();
  const open = c.run('JSON.stringify(mrCtx(_mr.rec).cnt.open)');
  assert.deepEqual(shown, JSON.parse(open).sort());
  assert.match(c.html, /「未返信の項目」だけを表示中/);
  c.run("mrSetFlt('miss')"); c.renderPage();
  assert.deepEqual([...c.html.matchAll(/id="mr-k-([a-z]+-[A-Za-z0-9_]+)"/g)].map(m => m[1]), ['cur-sales', 'cur-guests', 'cur-labor']);
});

test('⑤ lists the concrete missing items as links; the codes equal what the server says on submit (random bodies)', async () => {
  const S = await server();
  const c = app(S); await openStore(c, 'D6');
  let h = c.html; const sec = h.slice(h.indexOf('id="mr-sec-5"'));
  assert.match(sec, /提出の前に（9 件）/);
  assert.match(sec, /前月の客数：担当者評価とコメントが未入力/); assert.match(sec, /今月のリピート率：対策が未入力/);
  assert.match(sec, /重点項目「接客・CS向上」：進捗状態と実施したこと/); assert.match(sec, /相談：「相談がある」か「相談なし」を選ぶ/);
  assert.match(sec, /onclick="mrGo\('k-cur-repeat'\)"/);
  assert.match(sec, /<button class="btn btn-primary mr-btn-l" disabled onclick="mrSubmit\(\)">提出する/);
  // Random partial bodies: whatever the list shows is exactly the server's missing list (save + submit straight to the server).
  let seed = 3; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let i = 0; i < 12; i++) {
    const R = c.M().rec, ed = c.M().ed;
    const b = JSON.parse(JSON.stringify(ed.body));
    for (const k of KPI_PREV) if (rnd(2)) b.prev[k] = { eval: rnd(2) ? 1 + rnd(5) : null, comment: rnd(2) ? 'c' : '', improve: '' };
    for (const k of KPI_CUR) if (rnd(2)) Object.assign(b.cur[k], { eval: rnd(2) ? 2 : null, measure: rnd(2) ? 'm' : '' });
    for (const k of Object.keys(b.focus)) if (rnd(2)) b.focus[k] = { status: rnd(2) ? 'late' : '', done: rnd(2) ? 'd' : '', remaining: 'r', next: rnd(2) ? 'n' : '', owner: 'o' };
    b.consult = ['', 'yes', 'none'][rnd(3)]; b.issues = b.consult === 'yes' ? Array.from({ length: rnd(3) }, (_, j) => ({ id: 'i' + (j + 1), what: rnd(2) ? 'w' : '', ask: rnd(2) ? 'a' : '' })) : [];
    c.run(`_mr.ed.body = ${JSON.stringify(b)}; mrDirty();`); await c.flush(); c.renderPage(); h = c.html;
    const shown = dataCodes(h.slice(h.indexOf('id="mr-sec-5"')));
    const snap = JSON.parse(c.run('JSON.stringify(mrSnapNow(_mr.rec))'));
    const got = await S.api('gm', { action: 'submit', env: 'demo', ym: '2026-10', store_id: 'D6', expect_version: c.M().ed.version, snapshot: snap });
    if (got.error === 'incomplete') assert.deepEqual(shown, got.missing, JSON.stringify(b));
    else { assert.deepEqual(shown, [], JSON.stringify(got)); await S.api('gm', { action: 'demo_reset' }); c.run('mrEdStop(); mrReloadRec()'); await c.flush(); c.renderPage(); }
  }
});

test('submit: fill in, autosave with versions, submit makes version 1 with the demo numbers; resubmit makes version 2 and keeps version 1', async () => {
  const S = await server();
  const c = app(S); await openStore(c, 'D6');
  c.run("mrSetVal('prev.guests.comment', '少し届かなかった')"); assert.equal(c.M().ed.state, 'dirty');
  await c.flush(); assert.equal(c.M().ed.state, 'saved'); assert.equal((await get(S, 'D6')).review.body.prev.guests.comment, '少し届かなかった');
  const v1 = c.M().ed.version; assert.equal(v1, 2);
  fillAll(c); await c.flush(); c.renderPage();
  assert.match(c.html, /✓ 必須の欄はそろっています/); assert.match(c.html, /<div class="mr-subbar" id="mr-subbar">.*提出できます/);
  await c.run('mrSubmit()'); await c.flush(); c.renderPage();
  const R = await get(S, 'D6');
  assert.equal(R.review.submitted_no, 1); assert.equal(R.review.status, 'submitted');
  assert.deepEqual(R.submissions[0].snapshot, normSnap(demoSnapshot('2026-10', R.store.demo)));
  assert.ok(c.toasts.some(([m, k]) => k === 'success' && /提出しました（川沿い（デモ）・提出版 1）/.test(m)), JSON.stringify(c.toasts));
  // Back on the same store: a new editor on the submitted copy; nothing changed → cannot submit again.
  assert.equal(c.M().ed.version, R.review.version); assert.match(c.html, /提出版 1 から変わっていません/);
  c.run("mrSetVal('prev.sales.improve', '前日の告知')"); await c.flush(); c.renderPage();
  assert.match(c.html, /出し直す（提出版 2）/);
  await c.run('mrSubmit()'); await c.flush();
  const R2 = await get(S, 'D6'); assert.equal(R2.submissions.length, 2); assert.equal(R2.submissions[0].body.prev.sales.improve, '');
  // The list shows it.
  c.run('mrBack()'); await c.show(); assert.match(strip(c.html), /川沿い（デモ） AM 未設定 提出済み（提出版 2）/);
});

test('submit: the server’s 422 (incomplete) is shown as the server’s list, the input stays; “unchanged” is a warning', async () => {
  const S = await server();
  const c = app(S); await openStore(c, 'D6');
  c.run("mrMissingV2 = function(){ return { missing:[], holds:0 }; }");   // the screen believes it is complete
  await c.run('mrSubmit()'); await c.flush(); c.renderPage();
  assert.ok(c.toasts.some(([m, k]) => k === 'warning' && /サーバーの確認で足りないものがありました/.test(m)), JSON.stringify(c.toasts));
  const srv = c.M().srvMiss; assert.ok(srv.length >= 8 && srv.includes('consult'));
  assert.deepEqual([...c.html.matchAll(/data-srv="([^"]*)"/g)].flatMap(m => m[1].split(' ')), srv);
  assert.ok(c.M().ed); assert.equal((await get(S, 'D6')).review.submitted_no, 0);
});

test('submit: when the answer is lost on the way, the page checks and says it was submitted (no second version)', async () => {
  const S = await server();
  const c = app(S); await openStore(c, 'D6'); fillAll(c); await c.flush();
  const f0 = c.fetch; c.fetch = async (u, i) => { const r = await f0(u, i); if (JSON.parse(i.body).action === 'submit') throw new TypeError('Failed to fetch'); return r; };
  await c.run('mrSubmit()'); await c.flush();
  assert.ok(c.toasts.some(([m, k]) => k === 'success' && /提出できていました（川沿い（デモ）・提出版 1）/.test(m)), JSON.stringify(c.toasts));
  assert.equal((await get(S, 'D6')).submissions.length, 1);
});

test('R1 (v2): a submit answered after moving to another store leaves that store’s editor alone; the toast names the store', async () => {
  const S = await server();
  const c = app(S); await openStore(c, 'D6'); fillAll(c); await c.flush();
  const f0 = c.fetch; let release, got; const ready = new Promise(r => { got = r; });
  c.fetch = async (u, i) => { const r = await f0(u, i); if (JSON.parse(i.body).action === 'submit') { got(); await new Promise(x => { release = x; }); } return r; };
  const p = c.run('mrSubmit()'); await ready;
  c.run('mrBack()'); await openStore(c, 'D1'); c.run("mrSetOp('write')"); c.renderPage();
  c.run("mrSetVal('cur.sales.comment', 'D1 で打っている')"); const ed = c.M().ed; assert.ok(ed);
  release(); await p;
  assert.equal(c.M().ed, ed); assert.equal(c.M().view.id, 'D1'); assert.equal(ed.body.cur.sales.comment, 'D1 で打っている');
  assert.ok(c.toasts.some(([m, k]) => k === 'success' && /川沿い（デモ）・提出版 1/.test(m)), JSON.stringify(c.toasts));
  await c.flush();
  assert.equal((await get(S, 'D1')).review.body.cur.sales.comment, 'D1 で打っている');
  assert.equal((await get(S, 'D6')).review.submitted_no, 1);
});

test('autosave: someone saved first → no overwrite, the input stays, then an explicit choice; a failed save keeps the input; locked after 確認完了', async () => {
  const S = await server();
  const a = app(S); await openStore(a, 'D6');
  const b = app(S, { who: 'am1', role: 'am' }); await openStore(b, 'D6');
  b.run("mrSetVal('prev.sales.comment', 'B が先')"); await b.flush();
  a.run("mrSetVal('prev.sales.comment', 'A の入力')"); await a.flush(); a.renderPage();
  assert.equal(a.M().ed.state, 'conflict'); assert.match(a.html, /ほかの人が先に保存しました/);
  assert.equal((await get(S, 'D6')).review.body.prev.sales.comment, 'B が先');
  await a.run('mrConflictOverwrite()'); await a.flush();
  assert.equal((await get(S, 'D6')).review.body.prev.sales.comment, 'A の入力');
  // Network down: the input stays, the chip says so.
  const n = app(S); await openStore(n, 'D6'); n.fetch = async () => { throw new TypeError('Failed to fetch'); };
  n.run("mrSetVal('prev.sales.comment', '届かない')"); await n.flush(); n.renderPage();
  assert.equal(n.M().ed.state, 'error'); assert.match(n.html, /保存できません（入力は残っています）/); assert.equal(n.run('mrUnsaved()'), true);
  // After 確認完了 (D2) the input person sees it read only (no fields).
  const d = app(S); await openStore(d, 'D2'); d.run("mrSetOp('write')"); d.renderPage();
  assert.equal(d.M().ed, null); assert.match(d.html, /確認完了になっているので、入力はできません/); assert.doesNotMatch(d.html, /data-p="/);
  // A long text stops at the server's length.
  const l = app(S); await openStore(l, 'D6'); l.run(`mrSetVal('prev.sales.comment', '${'あ'.repeat(500)}')`);
  assert.equal(l.M().ed.body.prev.sales.comment.length, 400);
});

test('leaving with unsaved input or an unsent reply asks; logout while a save waits writes nothing', async () => {
  const S = await server();
  const c = app(S); await openStore(c, 'D6');
  c.run("mrSetVal('prev.sales.comment', 'まだ保存していない')");
  let asked = 0; c.confirm = () => { asked++; return false; };
  c.run('mrBack()'); assert.equal(asked, 1); assert.equal(c.M().view.id, 'D6');
  c.run('mrReset()'); await c.flush();
  assert.equal((await get(S, 'D6')).review.body.prev.sales.comment, '少し届かなかった。');   // the demo's text, unchanged
  const r = app(S); await openStore(r, 'D1'); r.run("mrCOpen('reply|cur:sales')"); r.run("mrCIn({ getAttribute:function(){ return 'reply|cur:sales'; }, value:'書きかけ' })");
  let a2 = 0; r.confirm = () => { a2++; return false; }; r.run("mrOpenStore('D2')"); assert.equal(a2, 1); assert.equal(r.M().view.id, 'D1');
});

test('reviewer (D1): the answers read only, threads under each item, a reply composer with optional response and date; replies post at once', async () => {
  const S = await server();
  const c = app(S, { who: 'am1', role: 'am', lp: { id: 'E5', name: 'Yuki' } }); await openStore(c, 'D1');
  const h = c.html;
  assert.equal(c.run('mrOpNow(_mr.rec)'), 'review'); assert.match(h, /あなたの操作：<b class="mr-blue">確認して返信する/);
  assert.match(h, /提出版 1（10\/14 21:12・店長 田中（デモ））を見ています/);   // 10/15 07:12 UTC = 10/14 21:12 in Hawaii
  const fc = cardOf(h, 'prev-fc');
  assert.match(fc, /<span class="mr-ev">2 <small>改善が必要<\/small><\/span>/); assert.match(fc, /9\/25 からの米の値上げと、刺身の廃棄。/);
  assert.match(fc, /返信 1 件（前月の原価率・提出版 1）/); assert.match(fc, /CEO（デモ）<\/b><span class="mr-chip mr-c-none">CEO<\/span>/);
  assert.doesNotMatch(fc, /data-p="/);
  const iss = cardOf(h, 'issue-i1');
  assert.match(iss, /返信 4 件（相談 1・提出版 1）/); assert.match(iss, /補足（入力担当）/); assert.match(iss, /<span class="mr-chip mr-c-warn">修正<\/span>/); assert.match(iss, /期限 10\/25/);
  assert.match(iss, /Head Chef・Corporate Chef/);
  // Items that wait for a reply open the composer; others show a button.
  assert.match(cardOf(h, 'prev-fc'), /mrCOpen\('reply\|prev:fc'\)/);
  const open = JSON.parse(c.run('JSON.stringify(mrCtx(_mr.rec).cnt.open)'));
  for (const tg of open) assert.ok(h.includes('id="mr-cmp-reply_' + tg.replace(':', '_') + '"'), tg);
  assert.match(h, /返信する（Yuki・AM として）/);
  // Post one reply with a response and a date.
  c.run("mrCIn({ getAttribute:function(){ return 'reply|focus:foodcost'; }, value:'業者の見積りは本部で。' })");
  c.run("mrCDec('reply|focus:foodcost','modify')"); c.run("mrCDue({ getAttribute:function(){ return 'reply|focus:foodcost'; }, value:'2026-10-24' })");
  await c.run("mrPost('reply|focus:foodcost')"); await c.flush(); c.renderPage();
  const R = await get(S, 'D1', 'am1'); const mine = R.replies.filter(x => x.mine);
  assert.deepEqual(mine.map(x => [x.kind, x.target, x.text, x.decision, x.due, x.sub_no, x.author_role]), [['reply', 'focus:foodcost', '業者の見積りは本部で。', 'modify', '2026-10-24', 1, 'am']]);
  assert.match(cardOf(c.html, 'focus-foodcost'), /返信 1 件/); assert.ok(c.toasts.some(([m, k]) => k === 'success' && /返信しました/.test(m)));
  // A reply on the overall review.
  c.run("mrCOpen('reply|review')"); c.run("mrCIn({ getAttribute:function(){ return 'reply|review'; }, value:'全体として順調' })");
  await c.run("mrPost('reply|review')"); assert.equal((await get(S, 'D1', 'am1')).replies.filter(x => x.target === 'review').length, 1);
  // Empty text is not sent.
  c.run("mrCOpen('reply|cur:sales')"); await c.run("mrPost('reply|cur:sales')"); c.renderPage(); assert.match(c.html, /本文を書いてください/);
});

test('reply idempotency: a double click posts once; a lost answer is sent again with the same client_id and stored once', async () => {
  const S = await server();
  const c = app(S); await openStore(c, 'D1');
  c.run("mrCOpen('reply|cur:guests')"); c.run("mrCIn({ getAttribute:function(){ return 'reply|cur:guests'; }, value:'二度押し' })");
  await Promise.all([c.run("mrPost('reply|cur:guests')"), c.run("mrPost('reply|cur:guests')")]);
  assert.equal((await get(S, 'D1')).replies.filter(x => x.text === '二度押し').length, 1);
  assert.equal(c.calls.filter(b => b.action === 'post').length, 1);
  // The server stored it but the answer did not come back: the second press reuses the client_id.
  const f0 = c.fetch; let drop = true;
  c.fetch = async (u, i) => { const r = await f0(u, i); if (JSON.parse(i.body).action === 'post' && drop) { drop = false; throw new TypeError('Failed to fetch'); } return r; };
  c.run("mrCOpen('reply|cur:ppa')"); c.run("mrCIn({ getAttribute:function(){ return 'reply|cur:ppa'; }, value:'届いたか分からない' })");
  await c.run("mrPost('reply|cur:ppa')"); c.renderPage();
  assert.match(c.html, /mid-review）につながりません/);
  const cid = c.M().cmp['reply|cur:ppa'].cid; assert.match(cid, /^[0-9a-f-]{36}$/);
  await c.run("mrPost('reply|cur:ppa')");
  const posts = c.calls.filter(b => b.action === 'post' && b.target === 'cur:ppa');
  assert.deepEqual(posts.map(b => b.client_id), [cid, cid]);
  assert.equal((await get(S, 'D1')).replies.filter(x => x.text === '届いたか分からない').length, 1);
  assert.equal(c.M().cmp['reply|cur:ppa'], undefined);
});

test('one person with both roles (demo): 報告を書く and 確認して返信する are separate, with separate composers (補足 / 返信)', async () => {
  const S = await server();
  const c = app(S); await openStore(c, 'D1');
  assert.match(c.html, /この店では両方できます/); assert.match(c.html, /aria-pressed="true" onclick="mrSetOp\('review'\)"/);
  assert.match(c.html, /mrCOpen\('reply\|/); assert.doesNotMatch(c.html, /mrCOpen\('note\|/);
  c.run("mrSetOp('write')"); c.renderPage();
  assert.match(c.html, /あなたの操作：<b class="">報告を書く/); assert.match(c.html, /mrCOpen\('note\|prev:sales'\)/); assert.doesNotMatch(c.html, /mrCOpen\('reply\|/);
  assert.match(c.html, /data-p="prev\.sales\.comment"/);
  c.run("mrCOpen('note|prev:sales')"); c.renderPage(); assert.match(c.html, /補足（入力担当として。管理側の返信とは別）/); assert.doesNotMatch(cardOf(c.html, 'prev-sales'), /対応・判断（任意）/);
  c.run("mrCIn({ getAttribute:function(){ return 'note|prev:sales'; }, value:'補足です' })"); await c.run("mrPost('note|prev:sales')");
  const x = (await get(S, 'D1')).replies.find(r => r.text === '補足です'); assert.equal(x.kind, 'note'); assert.equal(x.decision, null);
});

test('live: the staff input person (PIN) writes, submits with the meeting tab’s numbers, adds a note; cannot reply; a chef replies but cannot confirm', async () => {
  const S = await server(); await live(S);
  await S.api('gm', { action: 'chef_save', emp_id: 'E11', on: true });
  const s = app(S, { signed: false, pin: 'pin-E12', role: 'sl', lp: { id: 'E12', name: 'Server Lead' } });
  s.run("mrSetEnv('live')"); await s.show(); s.run("mrOpenStore('F01')"); s.renderPage(); await s.flush(); s.renderPage();
  assert.equal(s.run('mrOpNow(_mr.rec)'), 'write'); assert.doesNotMatch(s.html, /この店では両方できます/);
  const sn = JSON.parse(s.run('JSON.stringify(mrSnapNow(_mr.rec))'));
  assert.deepEqual(sn.period, { from: '2026-10-01', to: '2026-10-17' });
  assert.equal(sn.prev.state, 'final'); assert.equal(sn.prev.ym, '2026-09');
  assert.deepEqual(Object.fromEntries(KPI_PREV.map(k => [k, sn.prev.rows[k].judge])), { sales: 'ok', guests: 'warn', ppa: 'ok', repeat: 'miss', labor: 'warn', fc: 'warn' });
  assert.deepEqual(Object.fromEntries(KPI_CUR.map(k => [k, sn.cur.rows[k].judge])), { sales: 'warn', guests: 'warn', ppa: 'ok', repeat: 'warn', labor: 'miss' });
  assert.deepEqual(sn.cur.fc_ref, { act: 31.8, tgt: 30.5, unit: '%', judge: 'warn' });
  assert.deepEqual(sn.focus, { y: 2026, q: 4, keys: ['repeat', 'menu'], rows: { repeat: { label: 'リピート強化', mode: 'auto', now: 29, prev: 27.5, unit: '%', lower: false }, menu: { label: 'メニュー・商品力', mode: 'manual', now: null, prev: null, unit: '', lower: false } } });
  assert.deepEqual(sn.thresholds.repeat, { green: 100, yellow: 90 });
  assert.match(cardOf(s.html, 'focus-repeat'), /<b>リピート率 29\.0%<\/b>　前四半期 27\.5% から \+1\.5pt <span class="mr-m">（良化）/);
  assert.match(s.html, /本番の会議タブへの反映：店舗公開のときに ON/);
  fillAll(s); await s.flush(); await s.run('mrSubmit()'); await s.flush(); s.renderPage();
  assert.doesNotMatch(s.html, /id="mr-qc"/);   // no meeting-tab preview on live stores (reflection is off while private)
  const R = await get(S, 'F01', 'gm', 'live');
  assert.equal(R.review.submitted_no, 1); assert.equal(R.submissions[0].by, 'Server Lead');
  const kept = R.submissions[0].snapshot; assert.match(kept.updated, /^2026-|^20\d\d-/); assert.deepEqual({ ...kept, updated: '' }, { ...normSnap(sn), updated: '' });   // read again at submit time
  // A note on an item; the staff has no reply composer and no confirm.
  assert.doesNotMatch(s.html, /mrCOpen\('reply\|/); assert.doesNotMatch(s.html, /mrConfirm\(\)/);
  s.run("mrCOpen('note|cur:labor')"); s.run("mrCIn({ getAttribute:function(){ return 'note|cur:labor'; }, value:'シフトを見直しています' })");
  await s.run("mrPost('note|cur:labor')");
  // Done is recorded under the measure.
  s.run("mrCOpen('done|cur:labor')"); s.run("mrCIn({ getAttribute:function(){ return 'done|cur:labor'; }, value:'10/20 から分担表' })"); await s.run("mrPost('done|cur:labor')"); s.renderPage();
  assert.match(cardOf(s.html, 'cur-labor'), /実行：<b class="mr-v-ok">記録あり（1 件/);
  const R2 = await get(S, 'F01', 'gm', 'live');
  assert.deepEqual(R2.replies.map(x => [x.kind, x.target, x.author_role]), [['note', 'cur:labor', 'staff'], ['done', 'cur:labor', 'staff']]);
  // The chef (PIN) replies; no confirm button.
  const ch = app(S, { signed: false, pin: 'pin-E11', role: 'chef', lp: { id: 'E11', name: 'Corp Chef' } }); ch.run("mrSetEnv('live')"); await ch.show();
  ch.run("mrOpenStore('F01')"); ch.renderPage(); await ch.flush(); ch.renderPage();
  assert.equal(ch.run('mrOpNow(_mr.rec)'), 'review'); assert.doesNotMatch(ch.html, /mrConfirm\(\)/); assert.match(ch.html, /返信する（Corp Chef・Head Chef・Corporate Chef として）/);
  ch.run("mrCIn({ getAttribute:function(){ return 'reply|cur:labor'; }, value:'キッチン側も手伝います' })"); await ch.run("mrPost('reply|cur:labor')");
  assert.equal((await get(S, 'F01', 'gm', 'live')).replies.filter(x => x.author_role === 'chef').length, 1);
  // The meeting tab link opens that store and month.
  ch.run("mrOpenMeeting('F01','2026-10')"); assert.deepEqual(ch.went, [['go', 'budget', 'meeting', 'F01', 0], ['load', '2026-10', 'budget']]);
  ch.went = []; ch.run("mrOpenMeeting('F01','2026-09')"); assert.deepEqual(ch.went, [['go', 'budget', 'meeting', 'F01', -1], ['load', '2026-09', 'budget']]);
  ch.went = []; ch.run("mrOpenMeeting('x\\'','2026-09')"); assert.deepEqual(ch.went, []);
  assert.match(ch.html, /onclick="mrOpenMeeting\('F01','2026-10'\)">会議タブで見る/);
  // Live input off: the input person is told, nothing to write.
  await S.api('gm', { action: 'settings_save', key: 'flags', value: { private: true, live_input: false } });
  const off = app(S, { signed: false, pin: 'pin-E12', role: 'sl', lp: { id: 'E12', name: 'Server Lead' } }); off.run("mrSetEnv('live')"); await off.show();
  off.run("mrOpenStore('F01')"); off.renderPage(); await off.flush(); off.renderPage();
  assert.match(off.html, /本番の店の入力はまだ OFF です/); assert.doesNotMatch(off.html, /data-p="/);
});

test('live numbers: a combined PL month is not “final” (same as the meeting tab); no repeat row = no target; a store missing from the app has no numbers', async () => {
  const S = await server(); await live(S);
  const c = app(S, { who: 'am1', role: 'am', lp: { id: 'E5', name: 'Yuki' } }); c.run("mrSetEnv('live')"); await c.show();
  c.run("mrOpenStore('F02')"); c.renderPage(); await c.flush(); c.renderPage();
  const sn = JSON.parse(c.run('JSON.stringify(mrSnapNow(_mr.rec))'));
  assert.equal(sn.prev.state, 'prov'); assert.equal(sn.cur.rows.repeat.judge, 'unset'); assert.equal(sn.cur.rows.sales.judge, 'unset');
  assert.match(cardOf(c.html, 'cur-repeat'), /判定不可（目標未設定）/);
  for (const k of KPI_PREV) assert.match(cardOf(c.html, 'prev-' + k), /評価保留（前月が未確定）/);
  const f6 = app(S); f6.run("mrSetEnv('live')"); await f6.show(); f6.run("mrOpenStore('F06')"); f6.renderPage(); await f6.flush(); f6.renderPage();
  assert.match(f6.html, /入力担当が未設定なので、だれも入力できません/);
});

test('確認完了 and its undo: AM confirms the version shown; a newer version → told and reloaded; only GM / CEO undo; deadlines are optional (GM / CEO)', async () => {
  const S = await server();
  const a = app(S, { who: 'am1', role: 'am', lp: { id: 'E5', name: 'Yuki' } }); await openStore(a, 'D4');
  assert.match(a.html, /確認完了にする（提出版 1）/); assert.doesNotMatch(a.html, /期限を変える/);
  // A new version comes in while the AM looks at version 1.
  const w = app(S); await openStore(w, 'D4'); w.run("mrSetOp('write')"); w.renderPage(); w.run("mrSetVal('cur.sales.comment','追記')"); await w.flush(); await w.run('mrSubmit()'); await w.flush();
  await a.run('mrConfirm()'); await a.flush(); a.renderPage();
  assert.ok(a.toasts.some(([m, k]) => k === 'warning' && /新しい提出版が届きました/.test(m)), JSON.stringify(a.toasts));
  assert.equal(a.M().rec.review.submitted_no, 2);
  await a.run('mrConfirm()'); await a.flush(); a.renderPage();
  assert.equal((await get(S, 'D4')).review.status, 'confirmed'); assert.match(a.html, /確認完了：/); assert.doesNotMatch(a.html, /mrUnconfirm\(\)/);
  const g = app(S); await openStore(g, 'D4'); assert.match(g.html, /確認完了を取り消す（GM・CEO）/);
  await g.run('mrUnconfirm()'); await g.flush(); assert.equal((await get(S, 'D4')).review.status, 'submitted');
  // Deadlines: GM sets only the submit date; the reply date stays empty (no default).
  g.renderPage(); assert.match(g.html, /期限を変える（GM・CEO・任意）/);
  g.run('_mr.dlOpen=true'); g.renderPage();
  g.dom = { 'mr-dl-submit': { value: '2026-10-20' }, 'mr-dl-reply': { value: '' } };
  await g.run('mrDeadlineSave()'); await g.flush();
  assert.deepEqual((await get(S, 'D4')).review.deadlines, { submit: '2026-10-20' });
  g.dom = { 'mr-dl-submit': { value: '2026-10-20' }, 'mr-dl-reply': { value: '2026-10-19' } };
  const before = g.calls.length; await g.run('mrDeadlineSave()');
  assert.equal(g.calls.length, before); assert.ok(g.toasts.some(([m]) => /返信期限は提出期限より前にできません/.test(m)));
});

test('demo Qコミット: after submission the meeting tab’s focus card (demo) shows the submitted progress as one new record per item; nothing is written to app data', async () => {
  const S = await server();
  const c = app(S); await openStore(c, 'D1');
  const qc = c.html.slice(c.html.indexOf('id="mr-qc"'), c.html.indexOf('</section>', c.html.indexOf('id="mr-qc"')));
  assert.match(qc, /2026 Q4 の重点項目 <span class="mr-chip mr-c-info">会議タブの重点カード（デモ）/);
  assert.match(qc, /【中間レビュー 提出版 1】進捗：順調／実施：スタンプカードを全員に渡している。／残り：2 回目の来店の案内。／次：レシートに次回の案内を入れる（10\/20）／担当：田中/);
  assert.match(qc, /店長 田中（デモ） 10\/14 21:12（会議タブの記録に 1 件足す形）/);
  assert.match(qc, /接客・CS向上<\/span><span class="mr-chip mr-c-none">手入力/);
  assert.match(qc, /本番の会議タブへの反映：店舗公開のときに ON/);
  assert.equal(c.writes.length, 0);
  // Before submission there is no card, only the note.
  const d = app(S); await openStore(d, 'D6'); assert.doesNotMatch(d.html, /id="mr-qc"/); assert.match(d.html, /提出すると、ここに「会議タブの重点カード（デモ）」/);
});

test('settings (GM / CEO by email): input person, viewers, month override, Head Chef list, the effective table from the server, live input switch', async () => {
  const S = await server(); await live(S, { input: false });
  const c = app(S); await c.show(); c.run('mrOpenSettings()'); await c.show();
  let h = c.html;
  assert.match(h, /担当・閲覧設定/); assert.match(h, /本番の店の入力（入力担当が書ける）：<b>OFF/);
  const sel = id => (h.match(new RegExp('id="' + id + '"[\\s\\S]*?</select>')) || [''])[0];
  assert.match(sel('mr-acc-input'), /<option value="E12" selected>Server Lead（Server Leader・G3）<\/option>/);
  for (const e of ['E13', 'E14', 'E10', 'E5', 'E2']) assert.match(sel('mr-acc-input'), new RegExp('value="' + e + '"'), e);
  assert.doesNotMatch(sel('mr-acc-input'), /value="E17"|value="E3"/);
  assert.match(sel('mr-acc-vadd'), /value="E5"/); assert.match(sel('mr-acc-vadd'), /value="E11"/); assert.doesNotMatch(sel('mr-acc-vadd'), /value="E12"/);
  assert.match(sel('mr-acc-chef'), /value="E10"[\s\S]*value="E11"/);
  // The effective table for ToriTon: the input person cannot write while live input is off; the GM can change settings.
  const table = h.slice(h.indexOf('一人ひとりの実効の権限'), h.indexOf('</table>', h.indexOf('一人ひとりの実効の権限')));
  assert.match(table, /<b>Server Lead<\/b> <span class="mr-m">入力担当<\/span><\/td><td><span class="mr-y">○<\/span><\/td><td><span class="mr-n">×<\/span><\/td><td><span class="mr-n">×<\/span><\/td><td><span class="mr-n">×<\/span><\/td><td class="mr-m">この月の入力担当・本番の入力は OFF/);
  assert.match(table, /<b>GM Test<\/b> <span class="mr-m">GM<\/span>.*<span class="mr-y">○<\/span><\/td><td class="mr-m">CEO・GM・Head Chef（全店）/);
  // Change ToriTon: input E13, add viewer E6 (keeps the list whole).
  c.run("mrAccSet('input','E13')"); c.dom = { 'mr-acc-vadd': { value: 'E6' } }; c.run('mrAccAddViewer()');
  c.renderPage(); assert.match(c.html, /保存していない変更あり/);
  await c.run('mrAccSave()'); await c.flush(); await c.show(); h = c.html;
  assert.deepEqual((await S.q(`select input_emp, viewer_emps from mr_stores where env='live' and store_id='F01'`))[0], { input_emp: 'E13', viewer_emps: ['E6'] });
  const saved = c.calls.filter(b => b.action === 'access_save').at(-1); assert.deepEqual(saved.stores, [{ store_id: 'F01', input_emp: 'E13', viewer_emps: ['E6'] }]);
  // Remove the viewer: the full (empty) list is sent.
  c.run("mrAccDelViewer('E6')"); await c.run('mrAccSave()'); await c.flush(); await c.show();
  assert.deepEqual((await S.q(`select viewer_emps from mr_stores where env='live' and store_id='F01'`))[0].viewer_emps, []);
  // This month only: E14.
  c.dom = { 'mr-acc-month': { value: 'E14' } }; await c.run('mrAccMonthSave()'); await c.flush(); await c.show();
  assert.equal((await S.q(`select input_emp from mr_reviews where env='live' and store_id='F01' and ym='2026-10'`))[0].input_emp, 'E14');
  assert.match(c.html, /いまのこの月の担当：Op Lead/);
  // Head Chef: add E10 (a G4 Head Chef), then remove.
  c.dom = { 'mr-acc-chef': { value: 'E10' } }; await c.run('mrChefAdd()'); await c.flush(); await c.show();
  assert.match(c.html, /<span class="mr-pp"><b>Chef Oka<\/b>/);
  assert.equal((await S.q(`select role from mr_members where emp_id='E10' and enabled`))[0].role, 'chef');
  await c.run("mrChefDel('E10')"); await c.flush(); await c.show();
  assert.equal((await S.q(`select count(*)::int n from mr_members where emp_id='E10' and enabled`))[0].n, 0);
  // Live input on.
  await c.run('mrSetFlags({ live_input:true })'); await c.flush(); await c.show();
  assert.match(c.html, /本番の店の入力（入力担当が書ける）：<b>ON/);
  assert.deepEqual(c.calls.filter(b => b.action === 'settings_save').at(-1).value, { private: true, live_input: true });
  // A bad candidate is refused with plain words.
  c.run("mrAccSet('input','E17')"); await c.run('mrAccSave()');
  assert.ok(c.toasts.some(([m, k]) => k === 'error' && /選べない人です/.test(m)));
});

test('settings: a PIN GM sees why email is needed (no settings call); an AM cannot open it; the server refuses settings by PIN too', async () => {
  const S = await server(); await live(S);
  await S.q(`update mr_members set emp_id='E2' where user_id=$1`, [U.gm]);
  const p = app(S, { signed: false, pin: 'pin-E2' }); await p.show(); assert.match(p.html, /mrOpenSettings/);
  p.run('mrOpenSettings()'); const h = await p.show();
  assert.match(h, /担当・閲覧設定の変更はメールの認証が要ります/); assert.match(h, /mrLoginModal\(\)/);
  assert.equal(p.calls.filter(b => ['access_get', 'members_list', 'access_save'].includes(b.action)).length, 0);
  assert.equal((await S.pin('pin-E2', { action: 'access_get', ym: '2026-10' })).error, 'email_required');
  const a = app(S, { who: 'am1', role: 'am' }); await a.show(); a.run('mrOpenSettings()'); assert.match(await a.show(), /GM・CEO だけが開けます/);
  // The PIN GM can still change dates and confirm (no email needed).
  p.run("mrSetEnv('demo')"); await openStore(p, 'D1'); assert.match(p.html, /期限を変える（GM・CEO・任意）/); assert.match(p.html, /確認完了にする（提出版 1）/);
});

test('settings: live stores and AMs are saved as before (store master proposals)', async () => {
  const S = await server();
  const c = app(S); await c.show(); c.run('mrOpenSettings()'); await c.show(); c.run('_mr.amOpen=true'); c.renderPage(); await c.flush(); c.renderPage();
  const h = c.html;
  assert.match(h, /data-store="F01"[^>]*>.*<option value="00000000-0000-4000-8000-0000000000c5" selected>Yuki<\/option>/s);
  assert.match(h, /data-store="F05"[^>]*>.*<option value="00000000-0000-4000-8000-0000000000c6" selected>AM Two<\/option>/s);
  c.qsa = [{ getAttribute: k => ({ 'data-store': 'F01', 'data-name': 'ToriTon', 'data-sort': '1', 'data-active': '1' })[k], value: U.am1 }, { getAttribute: k => ({ 'data-store': 'F06', 'data-name': 'LaLa', 'data-sort': '4', 'data-active': '1' })[k], value: '' }];
  await c.run('mrSaveStores()'); await c.flush();
  assert.deepEqual(await S.q(`select store_id, am_user from mr_stores where env='live' order by store_id`), [{ store_id: 'F01', am_user: U.am1 }, { store_id: 'F06', am_user: null }]);
});

test('R3 (v2): a new key for the same person keeps the screen and the input (email and PIN); another person resets it', async () => {
  const S = await server();
  const jwt = (sub, n) => 'h.' + Buffer.from(JSON.stringify({ sub, n })).toString('base64url') + '.s';
  const c = app(S);
  const f0 = c.fetch;
  c.fetch = async (u, i) => {   // the stand-in server knows people by tok-…; map the keys of this test to them
    const tok = (i.headers.Authorization || '').replace('Bearer ', ''); let who = null;
    try { const sub = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url')).sub; who = Object.keys(U).find(k => U[k] === sub); } catch (e) {}
    return f0(u, who ? { ...i, headers: { ...i.headers, Authorization: 'Bearer tok-' + who } } : i);
  };
  c._botSession = { access_token: jwt(U.gm, 1), refresh_token: 'r1' };
  await openStore(c, 'D6'); c.run("mrSetVal('prev.sales.comment','鍵が変わる前')");
  const ed = c.M().ed;
  c._botSession = { access_token: jwt(U.gm, 2), refresh_token: 'r2' }; c.renderPage();
  assert.equal(c.M().ed, ed); assert.equal(c.M().view.id, 'D6'); assert.match(c.html, /id="mr-sec-1"/);
  await c.flush();
  assert.equal((await get(S, 'D6')).review.body.prev.sales.comment, '鍵が変わる前');
  c._botSession = { access_token: jwt(U.am1, 3), refresh_token: 'r3' }; c.renderPage();
  assert.equal(c.M().ed, null); assert.equal(c.M().view, null); assert.equal(c.M().rec, null); assert.doesNotMatch(c.html, /id="mr-sec-1"/);
  // PIN: a new mark for the same logged-in person keeps the editor; another person's login resets.
  await S.q(`update mr_members set emp_id='E2' where user_id=$1`, [U.gm]);
  const p = app(S, { signed: false, pin: 'pin-E2' }); await openStore(p, 'D6'); p.run("mrSetVal('prev.sales.comment','PIN の入力')"); const ped = p.M().ed;
  p._hwSession = 'pin-E2-2'; p.renderPage(); assert.equal(p.M().ed, ped); await p.flush();
  assert.equal((await get(S, 'D6')).review.body.prev.sales.comment, 'PIN の入力');
  p.invInLoginPerson = () => ({ id: 'E5', name: 'Yuki' }); p._hwSession = 'pin-E5'; p.renderPage();
  assert.equal(p.M().ed, null); assert.equal(p.M().view, null);
  // A key that cannot be read is treated as another person (reset).
  const d = app(S); await openStore(d, 'D6'); const ed2 = d.M().ed;
  d._botSession = { access_token: 'tok-gm', refresh_token: 'other' }; d.renderPage();
  assert.notEqual(d.M().ed, ed2);
});

test('every text from the server is escaped (store, input person, replies, author names, comments, settings names)', async () => {
  const S = await server(); await live(S);
  const X = '<img src=x onerror=alert(1)>';
  await S.q(`update mr_stores set name=$1 where store_id in ('D1','F01')`, [X]);
  await S.q(`update mr_stores set demo = jsonb_set(demo, '{input_name}', to_jsonb($1::text)) where store_id='D1'`, [X]);
  await S.q(`update employees set name=$1 where id='E12'`, [X]);
  await S.q(`update mr_submissions set body = jsonb_set(body, '{prev,sales,comment}', to_jsonb($1::text)) where review_id=(select id from mr_reviews where store_id='D1')`, [X]);
  await S.q(`update mr_replies set author_name=$1, text=$1 where target='prev:fc'`, [X]);
  for (const [who, f] of [['gm', c => c.run("mrSetEnv('demo'); mrOpenStore('D1')")], ['gm', c => c.run('mrOpenSettings()')], ['gm', c => c.run("mrSetEnv('live')")]]) {
    const c = app(S, { who }); await c.show(); f(c); await c.show(); await c.flush(); c.renderPage();
    assert.ok(!c.html.includes('<img src=x') && c.html.includes('&lt;img src=x'), c.html.slice(0, 200));
  }
  const t = app(S); await t.show(); t.run("mrSetEnv('demo')"); await openStore(t, 'D1'); t.run("mrCOpen('reply|cur:sales')"); t.run(`mrCIn({ getAttribute:function(){ return 'reply|cur:sales'; }, value:${JSON.stringify(X)} })`); t.renderPage();
  assert.ok(!t.html.includes('<img src=x') && t.html.includes('&lt;img src=x'));
  // Unknown server error words are not echoed.
  assert.equal(t.run(`mrErrText('<b>x</b>', 500)`), 'うまくいきませんでした（HTTP 500）');
});

test('English: the list, the store page (both tasks) and the settings', async () => {
  const S = await server();
  const c = app(S, { lang: 'en' }); const h = await c.show();
  assert.match(h, /Mid-month review/); assert.match(h, /Submitted \(version 1\)/); assert.match(h, /Missed KPIs <b>/); assert.match(h, /Access settings/);
  c.run("mrOpenStore('D6')"); c.renderPage(); await c.flush(); c.renderPage();
  for (const s of ['Last month review', 'This month so far', 'Focus items (Q-commit', 'Questions and requests', 'Check and submit', 'Required · not chosen', 'Optional', '✓ Met', 'Flash · not rated', 'Before submitting (9)', 'Write the report'])
    assert.ok(c.html.includes(s), s);
  assert.match(c.html, /Last month · Guests: rating and comment missing/);
  c.run("mrOpenStore('D1')"); c.renderPage(); await c.flush(); c.renderPage();
  assert.match(c.html, /Check and reply/); assert.match(c.html, /Reply \(as GM Test, GM\)/); assert.match(c.html, /Meeting tab focus card \(demo\)/);
  c.run('mrOpenSettings()'); await c.show(); assert.match(c.html, /Access settings/); assert.match(c.html, /Live store input/);
});

test('logout clears what the previous person loaded; another sign-in loads again as that person', async () => {
  const S = await server();
  const c = app(S); await c.show(); assert.ok(c.M().list && c.M().who);
  c.run('mrReset()'); assert.equal(c.M().list, null); assert.equal(c.M().who, null);
  const e = app(S); await e.show(); assert.equal(e.M().who.role, 'gm');
  e._botSession = { access_token: 'tok-am1', refresh_token: 'r' }; await e.show();
  assert.equal(e.M().who.role, 'am'); assert.doesNotMatch(e.html, /mrOpenSettings/);
});

test('phone and PC: the CSS keeps one column on a phone, buttons at least 44px there, no fixed widths that overflow', () => {
  const css = html.slice(html.indexOf('/* v1072 中間レビュー v2'), html.indexOf('/* ===== v925'));
  assert.ok(css.length > 3000);
  const phone = css.slice(css.indexOf('@media (max-width:820px)'));
  assert.match(phone, /\.mr-pg \{ flex-direction:column/); assert.match(phone, /\.mr-f2 \{ grid-template-columns:minmax\(0,1fr\)/);
  assert.match(phone, /body\.mr-wide \.main button, body\.mr-wide \.main select, body\.mr-wide \.main input\[type=date\], body\.mr-wide \.main input\[type=text\] \{ min-height:44px; \}/);
  assert.match(phone, /\.mr-subbar \{ display:flex; position:sticky; bottom:0/);
  assert.match(css, /\.mr-grid \{ display:grid; grid-template-columns:repeat\(auto-fill, minmax\(min\(100%, 400px\), 1fr\)\)/);
  assert.doesNotMatch(css, /min-width:7\d\dpx/);
});

