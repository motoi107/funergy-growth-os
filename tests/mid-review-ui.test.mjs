// 中間レビュー v1066（段階 2-1：全店一覧）: the real screen module from index.html in a VM, talking to the real
// mid-review handler and the real SQL (PGlite) with the UI案43 demo. Synthetic data only; no network, no storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHandler } from '../supabase/functions/mid-review/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const INDEX = process.env.FUNERGY_INDEX ? new URL(process.env.FUNERGY_INDEX, 'file://' + process.cwd() + '/') : new URL('../index.html', import.meta.url);
const html = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
const SQL = fs.readFileSync(new URL('../supabase/migrations/20261012090000_mid_review.sql', import.meta.url), 'utf8');
const B = '/* ===== v1066 中間レビュー（非公開版', E = '/* ===== v1066 中間レビュー ここまで ===== */';
const MOD = html.includes(B) ? html.slice(html.indexOf(B), html.indexOf(E)) : '';
const MEET = html.slice(html.indexOf('var MEET_KPI_DEF=['), html.indexOf('function _meetDiffStr('));
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const U = { ceo: '00000000-0000-4000-8000-0000000000c1', gm: '00000000-0000-4000-8000-0000000000c2', office: '00000000-0000-4000-8000-0000000000c3',
  am1: '00000000-0000-4000-8000-0000000000c5', am2: '00000000-0000-4000-8000-0000000000c6' };

async function server({ on = true, demo = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text); grant select on public.manager_auth to service_role;
    create table public.employees(id text primary key, name text, role text, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean, data jsonb);
    grant select on public.employees, public.stores to service_role;
    insert into public.employees(id, name, role) values ('E5','Yuki','am'),('E6','Second AM','am'),('E7','Twin','am'),('E8','Twin','am');
    insert into public.stores(id, name, am) values ('F01','ToriTon','Yuki'),('F02','Tenkichi','Second AM'),('F05','Marujuu','Someone else'),('F06','LaLa',null),('F09','Closed','Yuki');`);
  for (const [k, r, e] of [['ceo', 'ceo', 'E1'], ['gm', 'gm', 'E2'], ['office', 'office', 'E3']]) await pg.query('insert into manager_auth values($1,$2,$3)', [U[k], r, e]);
  await pg.exec(SQL);
  await pg.query(`insert into mr_members(user_id, emp_id, name, role) values($1,'E5','Yuki','am'),($2,'E6',null,'am')`, [U.am1, U.am2]);
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const fetch = async (url, init) => { const id = U[(init.headers.authorization || '').replace('Bearer tok-', '')]; return id ? Response.json({ id }) : new Response('{}', { status: 401 }); };
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k];
  const h = createHandler({ env, fetch, db });
  const api = async (who, body) => (await h(new Request('https://fn.test', { method: 'POST', headers: { authorization: 'Bearer tok-' + who }, body: JSON.stringify(body) }))).json();
  if (on) await api('gm', { action: 'settings_save', key: 'flags', value: { private: true } });
  if (on && demo) await api('gm', { action: 'demo_reset' });
  return { h, pg, api };
}

// The app around the module: only what the module calls. The browser's fetch goes to the real handler.
function app(S, { who = 'gm', role = 'gm', signed = true, kept = null, lp = { id: 'E2', name: 'GM Test' }, defaultPin = false, stores = [], kpi = {}, lang = 'ja', net = true } = {}) {
  const timers = [];
  const c = {
    curLang: lang, curRealRole: role, curStoreLogin: false, curPage: 'mid_review', html: '', toasts: [], modals: [], calls: [], keep: [],
    t: (ja, en) => (c.curLang === 'en' ? en : ja), escapeHtml: esc, ls: () => ({}), lsSet: () => true,
    SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON: 'anon', _botSession: signed ? { access_token: 'tok-' + who, refresh_token: 'r-' + who } : null,
    _invIn: { keptSession: null }, botResetShared: () => { c._botSession = null; },
    invInSession: () => c._botSession, invInSigned: () => !!(c._botSession && c._botSession.access_token), invInKept: () => kept, invInKeepWho: () => (lp && !defaultPin ? 'e:' + lp.id : ''),
    invInLoginPerson: () => lp, invInDefaultPin: () => defaultPin, invInKeepSet: (rt, w) => { c.keep.push([rt, w]); return true; }, invInSessionRefresh: async () => null,
    invInRestore: async () => { c.restored = true; return false; }, invInAuthFetch: async (path, opt) => {
      if (path.includes('grant_type=password')) return opt.body.password === 'pw' ? { ok: true, json: async () => ({ access_token: 'tok-' + opt.body.email.split('@')[0], refresh_token: 'rt-new' }) } : { ok: false, json: async () => ({}) };
      throw new Error('unexpected ' + path);
    },
    bizNow: () => new Date(2026, 9, 12, 9, 30), bizYm: () => '2026-10', daysOfYm: ym => Array.from({ length: 31 }, (_, i) => ({ date: ym + '-' + String(i + 1).padStart(2, '0') })),
    getStoresAll: () => stores, activeStores: () => stores.filter(s => s.active !== false), getEmployees: () => [{ id: 'E5', name: 'Yuki', role: 'am' }, { id: 'E6', name: 'Second AM', role: 'am' }],
    keyKpiStats: ([s]) => ({ sid: s.id, sales: (kpi[s.id] && kpi[s.id].sales && kpi[s.id].sales.act) || 0 }), _meetApplyPl: k => k, meetingBudgetKpi: k => ({ ...k, budget: kpi[k.sid] && kpi[k.sid].sales ? kpi[k.sid].sales.tgt : 0 }),
    _meetKpiRows: p => ['sales', 'fc', 'labor'].map(key => ({ key, act: kpi[p.sid] && kpi[p.sid][key] ? kpi[p.sid][key].act : 0, tgt: kpi[p.sid] && kpi[p.sid][key] ? kpi[p.sid][key].tgt : null, lower: key !== 'sales' })),
    _meetConfirmState: (sid) => (kpi[sid] && kpi[sid].pl) || 'prov',
    showToast: (m, k) => c.toasts.push([m, k]), openModal: h => c.modals.push(h), closeModalDirect: () => {}, confirm: () => true,
    renderPage: () => { c.html = c.renderMidReview(); }, document: { getElementById: k => (c.dom || {})[k] || null, querySelectorAll: () => c.qsa || [] },
    setTimeout: f => { const id = ++c.tid; timers.push([id, f]); return id; }, clearTimeout: id => { const i = timers.findIndex(x => x[0] === id); if (i >= 0) timers.splice(i, 1); }, tid: 0, console,
    fetch: async (url, init) => {
      if (!net) throw new TypeError('Failed to fetch');
      const body = JSON.parse(init.body); c.calls.push(body);
      const r = await S.h(new Request('https://fn.test', { method: 'POST', headers: { authorization: init.headers.Authorization }, body: init.body }));
      return { ok: r.ok, status: r.status, json: () => r.json() };
    },
  };
  vm.createContext(c);
  vm.runInContext(MEET + '\n' + MOD + '\nthis.renderMidReview = renderMidReview; this.M = () => _mr;', c);
  c.flush = async () => { for (let i = 0; i < 60 && timers.length; i++) { const [, f] = timers.shift(); await f(); for (let k = 0; k < 4; k++) await new Promise(r => setImmediate(r)); } };
  c.pending = () => timers.length;
  c.show = async () => { c.renderPage(); await c.flush(); return c.html; };
  c.run = src => vm.runInContext(src, c);
  return c;
}
const strip = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('the module is in index.html and the entry is wired for CEO / GM / AM only', () => {
  assert.ok(MOD.length > 1000, 'module markers');
  assert.match(html, /\{id:'mid_review',\s+label:'中間レビュー'/);
  assert.match(html, /children:\['budget','mid_review','labor','foodcost','kpi_master'\]/);
  assert.equal((html.match(/'mid_review'/g) || []).length >= 6, true);
  assert.match(html, /case 'mid_review':\s+el\.innerHTML = renderMidReview\(\)/);
  assert.match(html, /if\(typeof mrReset==='function'\) mrReset\(\);/);
  // The chef menu does not get it.
  assert.match(html, /\{id:'gc_budget', label:'予実', icon:'ti-chart-bar',\n    children:\['budget','labor','foodcost','kpi_master'\]\}/);
  // Nothing of the review is written to the shared app data.
  assert.doesNotMatch(MOD, /lsSet\(|\bls\('|localStorage|supaUpsert|pushOpKey/);
});

test('who sees the entry: ceo, gm, am yes; a G4 store manager (shown as AM inside the app), sl, office, crew and store logins no', async () => {
  const S = await server();
  for (const [role, ok] of [['ceo', true], ['gm', true], ['am', true], ['g4', false], ['sl', false], ['office', false], ['office_crew', false], ['crew', false], ['chef', false]]) {
    const c = app(S, { role });
    assert.equal(c.run('mrCanSee()'), ok, role);
    if (!ok) assert.match(await c.show(), /CEO・GM・AM だけが開けます/);
  }
  const st = app(S, { role: 'gm' }); st.curStoreLogin = true; assert.equal(st.run('mrCanSee()'), false);
});

test('sign-in: not signed in shows the email sign-in (no request); a remembered sign-in is tried first', async () => {
  const S = await server();
  const c = app(S, { signed: false });
  const h = await c.show();
  assert.match(h, /メールで認証してください/); assert.equal(c.calls.length, 0);
  const k = app(S, { signed: false, kept: { rt: 'x' } });
  assert.match(k.run('renderMidReview()'), /覚えた認証を確かめています/);
  await k.flush(); assert.equal(k.restored, true);
});

test('sign-in remembers only when the server says the account is this PIN person; never with the initial PIN', async () => {
  const S = await server();
  // GM Test (E2) signs in with the GM account (emp E2): remembered.
  const c = app(S, { signed: false });
  c.run('mrLoginModal()'); assert.match(c.modals[0], /id="mr-keep"/);
  c.dom = { 'mr-email': { value: 'gm@x' }, 'mr-password': { value: 'pw' }, 'mr-login-button': { disabled: false }, 'mr-keep': { checked: true }, 'mr-login-error': { textContent: '' } };
  await c.run('mrLogin()');
  assert.deepEqual(c.keep, [['rt-new', 'e:E2']]); assert.equal(c.M().who.role, 'gm');
  // Someone else's account (am1 is E5) while E2 is logged in by PIN: not remembered, and the old key for E2 is removed.
  const o = app(S, { signed: false });
  o.dom = { 'mr-email': { value: 'am1@x' }, 'mr-password': { value: 'pw' }, 'mr-login-button': { disabled: false }, 'mr-keep': { checked: true }, 'mr-login-error': { textContent: '' } };
  await o.run('mrLogin()'); assert.deepEqual(o.keep, [[null, 'e:E2']]);
  // A GM with no employee id on the server: works this time, not remembered, and says so.
  await S.pg.exec(`reset role; update mr_members set emp_id=null where user_id='${U.gm}'; set role service_role;`);
  const n = app(S, { signed: false });
  n.dom = { 'mr-email': { value: 'gm@x' }, 'mr-password': { value: 'pw' }, 'mr-login-button': { disabled: false }, 'mr-keep': { checked: true }, 'mr-login-error': { textContent: '' } };
  await n.run('mrLogin()'); assert.deepEqual(n.keep, [[null, 'e:E2']]); assert.match(n.toasts[0][0], /社員の登録/); assert.equal(n.M().who.role, 'gm');
  // An AM with no employee id cannot get in at all (the server checks the AM in the employee master).
  await S.pg.exec(`reset role; update mr_members set emp_id=null where user_id='${U.am2}'; set role service_role;`);
  const na = app(S, { signed: false, lp: { id: 'E6', name: 'Second AM' } });
  na.dom = { 'mr-email': { value: 'am2@x' }, 'mr-password': { value: 'pw' }, 'mr-login-button': { disabled: false }, 'mr-keep': { checked: true }, 'mr-login-error': { textContent: '' } };
  await na.run('mrLogin()'); assert.match(na.dom['mr-login-error'].textContent, /開けません/); assert.equal(na.M().who, null); assert.deepEqual(na.keep, []);
  // Not a member (office): the error stays in the dialog.
  const f = app(S, { signed: false, lp: { id: 'E3', name: 'Office' } });
  f.dom = { 'mr-email': { value: 'office@x' }, 'mr-password': { value: 'pw' }, 'mr-login-button': { disabled: false }, 'mr-keep': { checked: true }, 'mr-login-error': { textContent: '' } };
  await f.run('mrLogin()'); assert.match(f.dom['mr-login-error'].textContent, /開けません/); assert.equal(f.M().who, null);
  // Initial PIN: no remember box.
  const d = app(S, { signed: false, defaultPin: true }); d.run('mrLoginModal()');
  assert.doesNotMatch(d.modals[0], /mr-keep/); assert.match(d.modals[0], /PIN が初期のまま/);
});

test('off: nobody can list; GM / CEO get the switch, an AM is told to wait; errors are plain words', async () => {
  const S = await server({ on: false });
  const a = app(S, { who: 'am1', role: 'am' });
  assert.match(await a.show(), /GM・CEO が ON にするまでお待ちください/);
  const g = app(S);
  const h = await g.show(); assert.match(h, /非公開確認を ON にする/);
  await g.run('mrSetFlag(true)'); await g.flush();
  assert.match(g.html, /デモがまだありません/);
  const x = app(S, { who: 'office', role: 'gm' });
  assert.match(await x.show(), /開けません/);
  const n = app(S, { net: false });
  assert.match(await n.show(), /mid-review）につながりません/);
});

test('全店 (A): the UI案43 demo — counts, status, next person, overdue, KPI judgements, PL state, schedule', async () => {
  const S = await server();
  const c = app(S);
  const h = await c.show(), s = strip(h);
  for (const [l, n] of [['未提出', 1], ['AM 返信待ち', 1], ['追加確認', 1], ['判断待ち', 1], ['個別相談予定', 1], ['レビュー完了', 1], ['期限超過', 2], ['AM 未設定・要確認', 1]])
    assert.ok(new RegExp(l + ' <b>' + n + '</b>').test(h), l);
  assert.match(s, /港町（デモ） AM 佐藤（デモ） AM 返信待ち 期限超過 1 日 AM 佐藤（デモ） 10\/17 売上 98\.1% 注意 原価率 33\.2% 未達 人件費率 25\.8% 達成 完了 1・順調 1 遅延 1 1 件 要注意 確定/);
  assert.match(s, /駅前（デモ） AM 佐藤（デモ） 判断待ち（GM・CEO） GM 山本（デモ） 10\/19 売上 88\.3% 未達/);
  assert.match(s, /公園通り（デモ） .* 売上 未取得 10\/16・10\/17/);
  assert.match(s, /人件費率 26\.8% 未設定/);
  assert.match(s, /川沿い（デモ） AM 未設定 → GM が確認 下書き（未提出） 期限超過 3 日 店長 Nguyen（デモ） 10\/15 .* 未入手/);
  assert.match(s, /丘の上（デモ） AM 佐藤（デモ） レビュー完了 — 対応不要（理由あり） .* 相談なし（確認済み） 確定/);
  assert.match(s, /個別相談予定 10\/21 15:00（30 分）/);
  assert.match(s, /2026 年 10 月・10\/18 08:15 HST 時点・当月 KPI は 10\/1〜10\/17（前日まで 17\/31 日）・前月 PL は 2026 年 9 月/);
  assert.match(h, /mr-step cur"><b>10\/19 まで<\/b> 追加確認・上位判断 <b class="mr-now">← 今日 10\/18<\/b>/);
  assert.match(h, /非公開プレビュー（CEO・GM・AM だけ）/); assert.match(h, /店舗公開 OFF・通知 OFF/); assert.match(h, /デモデータ/);
  // The phone gets cards with the same facts (the table is hidden there by CSS).
  assert.equal((h.match(/class="card mr-card"/g) || []).length, 6);
  // An AM: no “AM 未設定” chip or filter, the same six fictional stores.
  const a = app(S, { who: 'am1', role: 'am' }); const ha = await a.show();
  assert.doesNotMatch(ha, /AM 未設定・要確認 <b>/); assert.equal((ha.match(/class="card mr-card"/g) || []).length, 6); assert.doesNotMatch(ha, /設定（GM・CEO）/);
});

test('filters: status chip, overdue, store, no AM', async () => {
  const S = await server();
  const c = app(S); await c.show();
  const cards = () => (c.html.match(/class="card mr-card"/g) || []).length;
  c.run("_mr.f.status='overdue'"); c.renderPage(); assert.equal(cards(), 2);
  c.run("_mr.f.status='decision'"); c.renderPage(); assert.equal(cards(), 1); assert.match(c.html, /駅前（デモ）/);
  c.run("_mr.f.status='draft'"); c.renderPage(); assert.equal(cards(), 1); assert.match(c.html, /川沿い（デモ）/);
  c.run("_mr.f.status=''; _mr.f.am='__none'"); c.renderPage(); assert.equal(cards(), 1);
  c.run("_mr.f.am='AM Lee（デモ）'"); c.renderPage(); assert.equal(cards(), 2);
  c.run("_mr.f.am=''; _mr.f.store='D2'"); c.renderPage(); assert.equal(cards(), 1); assert.match(c.html, /丘の上（デモ）/);
});

test('対応待ち (C): groups, CEO items, mine per role, quiet stores kept', async () => {
  const S = await server();
  const c = app(S); await c.show();
  c.run("_mr.tab='queue'"); c.renderPage();
  const s = strip(c.html);
  assert.match(s, /期限超過 2 川沿い（デモ） 下書き（未提出） AM 未設定 提出 3 日超過 次：店長 Nguyen（デモ）・10\/15 港町（デモ） AM 返信待ち AM 返信 1 日超過 次：AM 佐藤（デモ）・10\/17/);
  assert.match(s, /判断待ち 2 駅前（デモ） 判断待ち（GM） 重要 夜の人手：港町から週 2 回の応援 次：GM・10\/19 駅前（デモ） 判断待ち（CEO） 重要 求人広告の追加費用 次：CEO・10\/22/);
  assert.match(s, /追加確認 1 海岸（デモ） .*工事はいつまでか・テイクアウトの割合 次：店長 Kim（デモ）・10\/19/);
  assert.match(s, /個別相談 1 公園通り（デモ） .*次：AM Lee（デモ）・10\/21・15:00・店長 Garcia（デモ）・AM Lee（デモ）/);
  assert.match(s, /対応待ちのない店 1 丘の上（デモ） レビュー完了 全項目が目標どおり/);
  assert.match(s, /CEO の判断が要るもの 1 相談内容 駅前（デモ）：求人広告の追加費用 回答希望日 10\/22/);
  assert.match(c.html, /対応待ち 6/);
  const mine = role => { const x = app(S, { who: role === 'am' ? 'am1' : role, role }); return x; };
  for (const [role, n] of [['gm', 2], ['ceo', 1], ['am', 3]]) {
    const x = mine(role); await x.show(); x.run("_mr.tab='queue'; _mr.mine=true"); x.renderPage();
    assert.match(x.html, new RegExp('自分の対応 ' + n), role);
  }
});

test('live (before store publication): only the stores the server returns; KPI from the meeting-tab functions; 未設定 / 未取得 never shown as zero or met', async () => {
  const S = await server();
  await S.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: U.am1, sort: 1 }, { store_id: 'F02', name: 'Tenkichi', am_user: U.am2, sort: 2 }, { store_id: 'F06', name: 'LaLa', am_user: null, sort: 3 }] });
  const stores = [{ id: 'F01', name: 'ToriTon', am: 'Yuki' }, { id: 'F02', name: 'Tenkichi', am: 'Second AM' }, { id: 'F06', name: 'LaLa', am: '' }];
  const kpi = { F01: { sales: { act: 50000, tgt: 52000 }, fc: { act: 0, tgt: 30 }, labor: { act: 27, tgt: null }, pl: 'final' },
    F02: { sales: { act: 0, tgt: 40000 }, fc: { act: 31, tgt: 30 }, labor: { act: 25, tgt: 26 } }, F06: {} };
  const a = app(S, { who: 'am1', role: 'am', stores, kpi });
  a.run("_mr.env='live'"); const h = await a.show(), s = strip(h);
  assert.equal((h.match(/class="card mr-card"/g) || []).length, 1);
  assert.match(s, /ToriTon Yuki 未作成（未提出） —（店舗公開前） 売上 96\.2% 注意 原価率 未取得 人件費率 27\.0% 未設定 まだ更新なし —（未提出） 確定/);
  assert.match(s, /売上 96\.2% 注意 原価率 未取得 人件費率 27\.0% 未設定/);
  assert.match(s, /本番の数字（読むだけ）/);
  assert.doesNotMatch(h, /Tenkichi|LaLa/);
  const g = app(S, { stores, kpi }); g.run("_mr.env='live'"); const hg = strip(await g.show());
  assert.match(hg, /Tenkichi Second AM 未作成（未提出） —（店舗公開前） 売上 未取得 原価率 31\.0% 注意 人件費率 25\.0% 達成 まだ更新なし —（未提出） 未入手/);
  assert.match(hg, /LaLa AM 未設定 → GM が確認 未作成（未提出） —（店舗公開前） 売上 未設定 原価率 未設定 人件費率 未設定/);
  // Before store publication store managers cannot submit: no due date and never “overdue”, also for past months.
  assert.doesNotMatch(hg, /期限超過 \d+ 日/);
  g.run("_mr.ym='2026-07'"); const past = strip(await g.show());
  assert.doesNotMatch(past, /期限超過 \d+ 日/); assert.match(past, /2026 年 7 月/);
  // Day 1 of the month: no numbers yet (not 未設定 for sales).
  const d1 = app(S, { stores, kpi }); d1.bizNow = () => new Date(2026, 9, 1, 9, 0); d1.run("_mr.env='live'");
  const h1 = strip(await d1.show()); assert.match(h1, /まだ数字がない（月の 1 日目）/); assert.doesNotMatch(h1, /売上 未設定/);
});

test('settings (GM / CEO): proposes the AM from the store master, saves only what is shown, the schedule and the switch', async () => {
  const S = await server();
  const stores = [{ id: 'F01', name: 'ToriTon', am: 'Yuki', active: true }, { id: 'F05', name: 'Marujuu', am: 'Someone else', active: true }];
  const c = app(S, { stores }); await c.show();
  c.run('_mr.setOpen=true'); c.renderPage(); await c.flush();
  const h = c.html;
  assert.match(h, /data-store="F01"[^>]*>.*<option value="00000000-0000-4000-8000-0000000000c5" selected>Yuki<\/option>/s);
  assert.match(h, /data-store="F05"[^>]*><option value="">AM 未設定（GM が確認）<\/option><option value="00000000-0000-4000-8000-0000000000c5">Yuki/);
  assert.match(h, /店舗公開：<b>OFF<\/b>.*この版では ON にできない/s);
  c.qsa = [{ getAttribute: k => ({ 'data-store': 'F01', 'data-name': 'ToriTon', 'data-sort': '1' })[k], value: U.am1 }, { getAttribute: k => ({ 'data-store': 'F05', 'data-name': 'Marujuu', 'data-sort': '2' })[k], value: '' }];
  await c.run('mrSaveStores()'); await c.flush();
  const saved = await S.pg.query(`select store_id, am_user from mr_stores where env='live' order by store_id`);
  assert.deepEqual(saved.rows, [{ store_id: 'F01', am_user: U.am1 }, { store_id: 'F05', am_user: null }]);
  // Saved assignments are shown again, not the proposal (F05 stays “no AM” even though the master says someone).
  c.run('_mr.setOpen=true'); c.renderPage(); await c.flush();
  assert.match(c.html, /data-store="F05"[^>]*><option value="">AM 未設定（GM が確認）<\/option><option value="00000000-0000-4000-8000-0000000000c5">Yuki<\/option>/);
  c.dom = { 'mr-sch-submit_day': { value: '14' }, 'mr-sch-reply_day': { value: '16' }, 'mr-sch-decide_day': { value: '18' }, 'mr-sch-consult_from': { value: '20' }, 'mr-sch-consult_to': { value: '22' } };
  await c.run('mrSaveSchedule()'); await c.flush();
  assert.deepEqual((await S.pg.query(`select value from mr_settings where key='schedule'`)).rows[0].value, { submit_day: 14, reply_day: 16, decide_day: 18, consult_from: 20, consult_to: 22 });
  const sw = c.calls.filter(b => b.action === 'settings_save');
  assert.ok(sw.every(b => b.key !== 'flags' || Object.keys(b.value).join() === 'private'));
  await c.run('mrSetFlag(false)'); await c.flush();
  assert.match(c.html, /OFF です/);
});

test('escaping and English', async () => {
  const S = await server();
  await S.pg.exec(`reset role; update mr_stores set name='<img src=x onerror=alert(1)>' where store_id='D1'; set role service_role;`);
  const c = app(S); const h = await c.show();
  assert.ok(!h.includes('<img src=x') && h.includes('&lt;img src=x'));
  const en = app(S, { lang: 'en' }); const he = await en.show();
  assert.match(he, /Mid-month review/); assert.match(he, /Waiting for AM <b>1<\/b>/); assert.match(he, /Overdue <b>2<\/b>/);
});

test('logout clears what the previous person loaded', async () => {
  const S = await server();
  const c = app(S); await c.show();
  assert.ok(c.M().list && c.M().who);
  c.run('mrReset()');
  assert.equal(c.M().list, null); assert.equal(c.M().who, null);
});

test('AM proposals in the settings are exact and unique only (never widened by a partial or shared name)', async () => {
  const S = await server();
  await S.pg.exec(`reset role; insert into mr_members(user_id, emp_id, name, role) values('00000000-0000-4000-8000-0000000000c9','E7','Twin','am'),('00000000-0000-4000-8000-0000000000ca','E8','Twin','am'); set role service_role;`);
  const stores = [{ id: 'F03', name: 'FSP', am: 'Yuki Nagatani', active: true }, { id: 'F05', name: 'Marujuu', am: 'Yuki', active: true },
    { id: 'F02', name: 'Tenkichi', am: 'Second AM', active: true }, { id: 'F06', name: 'LaLa', am: 'Twin', active: true }];
  const c = app(S, { stores }); c.getEmployees = () => [{ id: 'E5', name: 'Yuki', role: 'am' }, { id: 'E6', name: 'Second AM', role: 'am' }, { id: 'E7', name: 'Twin', role: 'am' }, { id: 'E8', name: 'Twin', role: 'am' }];
  await c.show(); c.run('_mr.setOpen=true'); c.renderPage(); await c.flush();
  const sel = id => (c.html.match(new RegExp('data-store="' + id + '"[\\s\\S]*?</select>')) || [''])[0];
  assert.doesNotMatch(sel('F03'), / selected/);                                   // partial name: no proposal
  assert.match(sel('F05'), /value="00000000-0000-4000-8000-0000000000c5" selected/);  // exact "Yuki"
  assert.match(sel('F02'), /value="00000000-0000-4000-8000-0000000000c6" selected/);  // name from the employee table (E6)
  assert.doesNotMatch(sel('F06'), / selected/);                                   // two AMs named Twin: no proposal
  assert.match(strip(c.html), /FSP Yuki Nagatani .* 案なし .*Marujuu Yuki .* 案（同じ名前の AM） .*LaLa Twin .* 案なし（同じ名前の AM が 2 人以上）/);
  // The employee table's name wins over the name kept in the members table (am1 is E5 = "Yuki Nagatani" there).
  const c3 = app(S, { stores }); c3.getEmployees = () => [{ id: 'E5', name: 'Yuki Nagatani', role: 'am' }, { id: 'E6', name: 'Second AM', role: 'am' }];
  await c3.show(); c3.run('_mr.setOpen=true'); c3.renderPage(); await c3.flush();
  const sel3 = id => (c3.html.match(new RegExp('data-store="' + id + '"[\\s\\S]*?</select>')) || [''])[0];
  assert.match(sel3('F03'), /value="00000000-0000-4000-8000-0000000000c5" selected/); assert.doesNotMatch(sel3('F05'), / selected/);
  // A store saved earlier but no longer active is listed and saved as inactive (its AM can be taken off).
  await S.api('gm', { action: 'stores_save', stores: [{ store_id: 'F09', name: 'Closed', am_user: U.am1 }] });
  const c2 = app(S, { stores }); await c2.show(); c2.run('_mr.setOpen=true'); c2.renderPage(); await c2.flush();
  assert.match(c2.html, /data-store="F09"[^>]*data-active="0"/); assert.match(strip(c2.html), /Closed 今は使っていない店 .* 店舗マスターの AM 欄と違う/);
  c2.qsa = [{ getAttribute: k => ({ 'data-store': 'F09', 'data-name': 'Closed', 'data-sort': '5', 'data-active': '0' })[k], value: '' }];
  await c2.run('mrSaveStores()'); await c2.flush();
  assert.deepEqual((await S.pg.query(`select am_user, active from mr_stores where store_id='F09'`)).rows, [{ am_user: null, active: false }]);
});

test('no stale writes: a load that finishes after logout, another sign-in or a switch is dropped', async () => {
  const S = await server();
  // Logout (reset) while whoami is in flight: before it starts, and after the request went out.
  const c = app(S); c.renderPage(); c.run('mrReset()'); await c.flush();
  assert.equal(c.M().who, null);
  const c2 = app(S); const f2 = c2.fetch; c2.fetch = async (u, i) => { c2.run('mrReset()'); return f2(u, i); };
  c2.renderPage(); await c2.flush(); await new Promise(r => setTimeout(r, 30));
  assert.equal(c2.M().who, null);
  // Switching demo → live while the demo list is still in flight (it answers last): the demo list is not shown as live.
  const d = app(S); await d.show(); const fd = d.fetch;
  d.fetch = async (u, i) => { const b = JSON.parse(i.body); if (b.action === 'list' && b.env === 'demo') await new Promise(r => setTimeout(r, 60)); return fd(u, i); };
  d.run("_mr.list=null; _mr.listKey=''; _mr.load={}; _mr.load.who=1"); d.renderPage(); await d.flush();
  d.run("_mr.env='live'"); d.renderPage(); await d.flush(); await new Promise(r => setTimeout(r, 120)); await d.flush();
  assert.equal(d.M().list.env, 'live');
  // Another email sign-in (Invoice / Bot) after the GM loaded: the next render loads again as that person.
  const e = app(S); await e.show(); assert.equal(e.M().who.role, 'gm');
  e._botSession = { access_token: 'tok-am1', refresh_token: 'r' }; await e.show();
  assert.equal(e.M().who.role, 'am'); assert.doesNotMatch(e.html, /設定（GM・CEO）/);
  // A PIN logout while the sign-in waits for whoami: nothing is written, the remembered key is untouched.
  const f = app(S, { signed: false });
  f.dom = { 'mr-email': { value: 'gm@x' }, 'mr-password': { value: 'pw' }, 'mr-login-button': { disabled: false }, 'mr-keep': { checked: true }, 'mr-login-error': { textContent: '' } };
  const realFetch = f.fetch; f.fetch = async (u, i) => { f.invInKeepWho = () => ''; f.run('mrReset()'); return realFetch(u, i); };
  await f.run('mrLogin()');
  assert.equal(f.M().who, null); assert.deepEqual(f.keep, []);
  // A network failure during sign-in does not delete the remembered key either.
  const n = app(S, { signed: false });
  n.dom = { 'mr-email': { value: 'gm@x' }, 'mr-password': { value: 'pw' }, 'mr-login-button': { disabled: false }, 'mr-keep': { checked: true }, 'mr-login-error': { textContent: '' } };
  n.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await n.run('mrLogin()'); assert.deepEqual(n.keep, []); assert.match(n.dom['mr-login-error'].textContent, /つながりません/);
});

test('the admin page session (_authSession) is not used for the review', async () => {
  const S = await server();
  const c = app(S, { signed: false }); c.window = { _authSession: { access_token: 'tok-gm' } };
  assert.match(await c.show(), /メールで認証してください/); assert.equal(c.calls.length, 0);
});

const fnSrc = name => { const st = html.indexOf('function ' + name + '('); assert.ok(st >= 0, name); const a = html.lastIndexOf('\n', st) + 1; return html.slice(a, html.indexOf('\n}', st) + 2); };
const constSrc = name => { const st = html.indexOf('const ' + name + ' = ['); assert.ok(st >= 0, name); return html.slice(st, html.indexOf('\n];', st) + 3).replace('const ', 'var '); };

test('menu: a G4 store manager (role shown as AM inside the app) gets no mid-review entry; a real AM, GM and CEO do', () => {
  for (const [real, role, store, want] of [['g4', 'am', 'F01', false], ['am', 'am', 'ALL', true], ['gm', 'gm', 'ALL', true], ['ceo', 'ceo', 'ALL', true], ['sl', 'sl', 'F01', false]]) {
    const c = { curRealRole: real, curRole: role, curStore: store, curStoreLogin: false, mcCanOpen: () => true, mdCanOpen: () => true, _gradeHideApplies: () => false,
      canAccessStaffMaster: () => true, canAccessKpiMaster: () => true, canSeeDashboard: () => true, console };
    vm.createContext(c);
    vm.runInContext(constSrc('NAV_ITEMS') + '\n' + constSrc('MENU_GROUPS') + '\n' + MOD + '\n' + fnSrc('groupsForRole') + '\n' + fnSrc('firstAllowedChild'), c);
    const groups = vm.runInContext('groupsForRole()', c);
    const has = groups.some(g => g.children.includes('mid_review'));
    assert.equal(has, want, real);
    // Even a group that still lists it (old saved menus) never lands a G4 on it.
    const first = vm.runInContext(`firstAllowedChild({ children:['mid_review','budget'] })`, c);
    if (!want) assert.equal(first, 'budget', real);
  }
});

test('every text from the server is escaped (store, AM, member names, titles, reasons, consult people and time, PL note)', async () => {
  const S = await server();
  const X = '<img src=x onerror=alert(1)>';
  await S.pg.exec(`reset role;
    update mr_stores set name='${X}', am_name='${X}', demo=jsonb_set(demo, '{pl,note}', to_jsonb('${X}'::text)) where store_id='D3';
    update mr_reviews set body=jsonb_set(body, '{done_reason}', to_jsonb('${X}'::text)) where store_id='D2';
    update mr_reviews set consult=jsonb_build_object('date','2026-10-21','time','${X}','people',jsonb_build_array('${X}')) where store_id='D5';
    update mr_replies set data=jsonb_set(data, '{title}', to_jsonb('${X}'::text)), author_name='${X}';
    update mr_members set name='${X}' where emp_id='E6';
    set role service_role;`);
  const c = app(S, { stores: [{ id: 'F01', name: X, am: X, active: true }] }); c.getEmployees = () => [];
  const views = [await c.show()];
  c.run("_mr.tab='queue'"); c.renderPage(); views.push(c.html);
  c.run("_mr.mine=true"); c.renderPage(); views.push(c.html);
  c.run("_mr.tab='all'; _mr.setOpen=true"); c.renderPage(); await c.flush(); views.push(c.html);
  for (const [i, h] of views.entries()) { assert.ok(!h.includes('<img src=x'), 'view ' + i); assert.ok(h.includes('&lt;img src=x'), 'view ' + i + ' shows it as text'); }
  // An error code the app does not know is not shown as it came (toasts are HTML).
  assert.doesNotMatch(c.run(`mrErrText('<img src=x>', 500)`), /img/);
  assert.equal(c.run(`mrErrText('', '<b>')`), 'うまくいきませんでした');
});

test('live KPI: this month is judged against the budget to yesterday, a past month against the whole month; the PL import is applied', async () => {
  const S = await server();
  await S.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: U.am1, sort: 1 }] });
  const seen = [];
  const c = app(S, { stores: [{ id: 'F01', name: 'ToriTon', am: 'Yuki' }] });
  c.keyKpiStats = ([s]) => ({ sid: s.id, sales: 50000 });
  c._meetApplyPl = (k, sid, ym) => ({ ...k, pl: ym });
  c.meetingBudgetKpi = (k, current) => { seen.push([k.pl, current]); return { ...k, budget: current ? 52000 : 100000 }; };
  c._meetKpiRows = p => [{ key: 'sales', act: p.sales, tgt: null }, { key: 'fc', act: 30, tgt: 30 }, { key: 'labor', act: 25, tgt: 26 }];
  c.run("_mr.env='live'"); const now = strip(await c.show());
  assert.match(now, /売上 96\.2% 注意/); assert.deepEqual(seen.at(-1), ['2026-10', true]);
  c.run("_mr.ym='2026-09'"); const past = strip(await c.show());
  assert.match(past, /売上 50\.0% 未達/); assert.deepEqual(seen.at(-1), ['2026-09', false]);
});

test('an answer for the previous email sign-in is not shown with the new one (whoami in flight)', async () => {
  const S = await server();
  const c = app(S); const f0 = c.fetch;
  // The first whoami (as the GM) answers only after someone signs in with the AM's email on the same device.
  c.fetch = async (u, i) => { c.fetch = f0; const r = await f0(u, i); c._botSession = { access_token: 'tok-am1', refresh_token: 'r' }; return r; };
  c.renderPage(); await c.flush();
  // The GM answer is dropped and the page loads again as the AM by itself.
  assert.equal(c.M().who.role, 'am'); assert.doesNotMatch(c.html, /設定（GM・CEO）/);
  assert.equal(c.calls.filter(b => b.action === 'whoami').length, 2);
});

test('settings: a saved AM who is stopped or no longer an AM is shown as stopped and is not saved again; the list tells the GM', async () => {
  const S = await server();
  const stores = [{ id: 'F01', name: 'ToriTon', am: 'Yuki', active: true }, { id: 'F02', name: 'Tenkichi', am: 'Second AM', active: true }];
  await S.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: U.am1, sort: 1 }, { store_id: 'F02', name: 'Tenkichi', am_user: U.am2, sort: 2 }] });
  await S.pg.exec(`reset role; update employees set status='退職' where id='E6'; set role service_role;`);
  const c = app(S, { stores }); c.getEmployees = () => [{ id: 'E5', name: 'Yuki', role: 'am' }, { id: 'E6', name: 'Second AM', role: 'am', status: '退職' }];
  c.run("_mr.env='live'"); await c.show();
  assert.match(strip(c.html), /Tenkichi Second AM この AM は今この店を見られない → 設定で確認/);
  assert.match(c.html, /AM 未設定・要確認 <b>1<\/b>/);
  c.run('_mr.setOpen=true'); c.renderPage(); await c.flush();
  const sel = id => (c.html.match(new RegExp('data-store="' + id + '"[\\s\\S]*?</select>')) || [''])[0];
  assert.match(sel('F02'), /data-stopped="1" selected>Second AM（停止中）/);
  assert.doesNotMatch(sel('F01'), /停止中/); assert.doesNotMatch(sel('F01'), /Second AM/);   // a stopped AM is not offered
  assert.match(strip(c.html), /保存済みの AM が停止中・AM ではない/);
  const opt = (v, stopped) => ({ getAttribute: k => (k === 'data-stopped' && stopped ? '1' : null) });
  c.qsa = [{ getAttribute: k => ({ 'data-store': 'F01', 'data-name': 'ToriTon', 'data-sort': '1' })[k], value: U.am1, options: [opt()], selectedIndex: 0 },
    { getAttribute: k => ({ 'data-store': 'F02', 'data-name': 'Tenkichi', 'data-sort': '2' })[k], value: U.am2, options: [opt(U.am2, true)], selectedIndex: 0 }];
  await c.run('mrSaveStores()'); await c.flush();
  assert.match(c.toasts.map(x => x[0]).join(' '), /停止中の AM のままの店（1 店）は保存しませんでした/);
  const saved = c.calls.filter(b => b.action === 'stores_save').at(-1);
  assert.deepEqual(saved.stores.map(s => s.store_id), ['F01']);
});

test('the remembered sign-in is used for the review even when the admin page has its own session', async () => {
  const c = { _botSession: null, window: { _authSession: { access_token: 'admin' } }, _invIn: {}, kept: { rt: 'r1' }, invInRerender: () => {}, console };
  c.invInKeepWho = () => 'e:E2'; c.invInKeepGet = () => c.kept; c.invInKeepSet = (rt) => { c.kept = rt ? { rt } : null; return true; };
  c.invInAuthFetch = async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'a2', refresh_token: 'r2' }) });
  vm.createContext(c);
  vm.runInContext(fnSrc('invInSession') + fnSrc('invInSigned') + fnSrc('invInRestore'), c);
  assert.equal(await vm.runInContext('invInRestore(false, true)', c), true);
  assert.deepEqual(JSON.parse(JSON.stringify(c._botSession)), { access_token: 'a2', refresh_token: 'r2' });
  // The Invoice screen keeps its old behaviour (an admin page session counts as signed in there).
  c._botSession = null; c.kept = { rt: 'r3' };
  assert.equal(await vm.runInContext('invInRestore()', c), true); assert.equal(c._botSession, null);
});

// ---------------------------------------------------------------- 段階 2-2: the store page and the store manager's input (demo)
const J = v => JSON.parse(JSON.stringify(v));
const openStore = async (c, id) => { await c.show(); c.run(`mrOpenStore('${id}')`); c.renderPage(); await c.flush(); c.renderPage(); return c.html; };

test('store page (B): what was submitted, the numbers now and at submission, focus with both due dates, questions, sent replies, history', async () => {
  const S = await server();
  const c = app(S); const h = strip(await openStore(c, 'D1'));
  assert.match(h, /港町（デモ） AM 返信待ち 返信 期限超過 1 日/);
  assert.match(h, /報告者 店長 田中（デモ） 店長 一次確認 AM 佐藤（デモ） 提出期限 \/ 返信期限 10\/15 \/ 10\/17/);
  assert.match(h, /提出版 1 ?（10\/14 21:12・店長 田中（デモ））：当月 KPI は 10\/1〜10\/13・Toast 10\/14 05:40／前月 PL は 2026 年 9 月・確定/);
  assert.match(h, /いまの数字は 10\/17 まで（提出後に更新あり）/);
  assert.match(h, /A\. 前月 PL（2026 年 9 月） 確定 PL 取込 10\/9・当月の数字ではない/);
  assert.match(h, /売上 \$141,200 \$145,000・97\.4% 注意 原価率 32\.1% 30\.5%・\+1\.6pt 注意/);
  assert.match(h, /月初に確認済み：売上・人件費率（変更なし） 原価率 見立て 9\/25 からの米の値上げ/);
  assert.match(h, /原価率 33\.2% 30\.5%・\+2\.7pt 未達 仕入 米の値上げ（9\/25〜）と盛り付けのばらつき。→ 相談 1/);
  assert.match(h, /客単価 \$25\.02 \$25\.12・99\.6% 注意 （コメントなし）/);
  assert.match(h, /遅延 1\. ランチのピーク.*当初の期限 10\/15 → 変更後 10\/31 ?（遅れた記録は残る） 理由 新人 2 名の研修が 1 週遅れた/);
  assert.match(h, /要注意 相談 1：原価率が目標より高い.* ② 原因の見立て 9\/25 から米の仕入単価.* ③ 誰が・何を・いつまでに 田中：丼の盛り付けを計量.* ④ 判断・支援してほしいこと 本部で米の業者を比べてほしい（回答希望 10\/24）/);
  assert.match(h, /履歴 10\/14 21:12 提出（提出版 1）・店長 田中（デモ）/);
  // The numbers at submission.
  c.run('_mr.showSnap=true'); c.renderPage(); const hs = strip(c.html);
  assert.match(hs, /売上 \$63,450 \$65,010・97\.6% 注意/); assert.match(hs, /原価率 33\.5% 30\.5%・\+3\.0pt 未達/); assert.match(hs, /今の数字を見る/);
  // A CEO sees the decisions waiting on 駅前 with reason and recommendation.
  const ceo = app(S, { who: 'ceo', role: 'ceo' }); const hc = strip(await openStore(ceo, 'D3'));
  assert.match(hc, /上位判断待ち（CEO） 重要 求人広告の追加費用 理由 予算にない費用。 推奨案 2 か月だけ月 \$600 を出す。/);
  assert.match(hc, /いまは「判断待ち（GM・CEO）」なので、店長は書き足せません/);
  assert.match(ceo.html, /disabled style="opacity:\.55;cursor:not-allowed" onclick="mrStartInput\(\)"/);
  // A Operation Leader's report says so.
  const ol = strip(await openStore(app(S), 'D5'));
  assert.match(ol, /報告者 Operation Leader 原田（デモ・G3） G3 Operation Leader/);
  assert.match(ol, /② 原因 調査中 ?：締め作業に何分かかっているか（1 週間）（原田・10\/20）/);
  // A draft is not shown to managers before it is submitted.
  const d6 = strip(await openStore(app(S), 'D6'));
  assert.match(d6, /店長が書いている途中（下書き・未提出）/); assert.match(d6, /1\. ドリンクの提案をメニューに/);
  // Back to the list.
  c.run('mrBack()'); c.renderPage(); await c.flush(); assert.match(c.html, /全店 6/);
});

test('input (demo): fill in, autosave with versions, what is missing, submit makes version 1; the list shows it', async () => {
  const S = await server();
  const c = app(S, { who: 'am1', role: 'am' }); await openStore(c, 'D6');
  c.run('mrStartInput()'); c.renderPage();
  assert.match(c.html, /店長の画面を体験中（デモの店・川沿い（デモ））/); assert.match(c.html, /押した人（あなた）の名前が記録されます/);
  assert.deepEqual(J(c.run('mrMissing(_mr.ed.body, mrSnapNow(_mr.rec))')), ['consult', 'focus:f1', 'focus:f2']);
  assert.match(c.html, /data-need="focus:f1"/); assert.match(c.html, /<button class="btn btn-primary" disabled onclick="mrSubmit\(\)">/);
  c.run(`mrSetVal('focus.0.status','ok',true); mrSetVal('focus.1.status','late',true); mrSetVal('focus.1.reason','担当が休み'); mrSetVal('focus.1.next','担当表を作る'); mrSetVal('focus.1.next_owner','Nguyen'); mrSetVal('focus.1.next_due','2026-10-24'); mrSetVal('consult','none',true); mrSetVal('reporter_role','op_leader')`);
  assert.equal(c.run('_mr.ed.state'), 'dirty');
  await c.flush();
  assert.equal(c.run('_mr.ed.state'), 'saved'); assert.equal(c.run('_mr.ed.version') > 1, true);
  const saves = c.calls.filter(b => b.action === 'save'); assert.equal(saves.length, 1, 'one save for the burst of edits');
  assert.deepEqual(J(c.run('mrMissing(_mr.ed.body, mrSnapNow(_mr.rec))')), []);
  c.renderPage(); assert.match(c.html, /<button class="btn btn-primary"  onclick="mrSubmit\(\)">提出する<\/button>/);
  await c.run('mrSubmit()'); c.renderPage(); await c.flush(); c.renderPage();
  const sub = c.calls.filter(b => b.action === 'submit')[0];
  assert.equal(sub.snapshot.period.to, '2026-10-17'); assert.equal(sub.snapshot.kpi.fc.judge, 'warn'); assert.equal(sub.snapshot.pl.state, 'none');
  const h = strip(c.html);
  assert.match(h, /川沿い（デモ） AM 返信待ち/); assert.match(h, /提出版 1 ?（.*・Yuki）/); assert.match(h, /報告者 店長 Nguyen（デモ） G3 Operation Leader/);
  assert.match(h, /遅延 2\. 清掃チェック表 .* 理由 担当が休み 次の対応 担当表を作る（Nguyen・10\/24）/);
  c.run('mrBack()'); c.renderPage(); await c.flush(); c.renderPage();
  assert.match(strip(c.html), /川沿い（デモ） AM 未設定 → GM が確認 AM 返信待ち/);
});

test('input: a MISS needs a comment; PL 注意 needs cause and plan; re-submitting keeps the first version', async () => {
  const S = await server();
  const c = app(S); await openStore(c, 'D1'); c.run('mrStartInput()'); c.renderPage();
  assert.deepEqual(J(c.run('mrMissing(_mr.ed.body, mrSnapNow(_mr.rec))')), []);
  c.run(`mrSetVal('kpi.fc.comment',''); mrSetVal('pl.fc.plan','  ')`);
  assert.deepEqual(J(c.run('mrMissing(_mr.ed.body, mrSnapNow(_mr.rec))')), ['kpi:fc', 'pl:fc']);
  c.renderPage(); const h = strip(c.html);
  assert.match(h, /KPI：原価率 は未達なのでコメントが必要/); assert.match(h, /前月 PL：原価率 の見立てと改善策/);
  assert.match(c.html, /原価率 33\.2%<\/b><span>目標 30\.5%・\+2\.7pt <span class="mr-tag"[^>]*>未達<\/span><\/span><\/div><div class="mr-tagrow">/);
  assert.match(c.html, /売上 \$80,800<\/b>.*?<div class="mr-tagrow"><button class="mr-pick on" aria-pressed="true"/s);   // 注意 is open with its tags
  assert.match(c.html, /人件費率 25\.8%.*?＋ コメントを書く/s);                                                                    // 達成 stays short
  c.run(`mrSetVal('kpi.fc.comment','米の値上げ'); mrSetVal('pl.fc.plan','業者を比べる')`); await c.flush();
  await c.run('mrSubmit()'); await c.flush(); c.renderPage();
  assert.match(strip(c.html), /提出版 2 ?（.*）.* 前の提出版：版 1（10\/14 21:12）/);
  const subs = await S.pg.query(`select no from mr_submissions x join mr_reviews r on r.id=x.review_id where r.store_id='D1' order by no`);
  assert.deepEqual(subs.rows.map(x => x.no), [1, 2]);
});

test('input: someone saved first → no overwrite, the input stays, then an explicit choice; a failed save keeps the input', async () => {
  const S = await server();
  const a = app(S, { who: 'am1', role: 'am' }), g = app(S);
  await openStore(a, 'D6'); a.run('mrStartInput()'); a.renderPage();
  await openStore(g, 'D6'); g.run('mrStartInput()'); g.renderPage();
  g.run(`mrSetVal('consult','none',true)`); await g.flush(); assert.equal(g.run('_mr.ed.state'), 'saved');
  a.run(`mrSetVal('focus.0.note','A の入力')`); await a.flush();
  assert.equal(a.run('_mr.ed.state'), 'conflict'); assert.equal(a.run('_mr.ed.body.focus[0].note'), 'A の入力');
  a.renderPage(); assert.match(strip(a.html), /ほかの人が先に保存しました（自動では保存しません）/);
  assert.match(a.html, /最新を読み込む（自分の入力は消える）/);
  a.run(`mrSetVal('focus.0.note','A の入力 2')`); await a.flush();                    // still not saved by itself
  assert.equal(a.calls.filter(b => b.action === 'save').length, 1);
  let r = await S.pg.query(`select body from mr_reviews where store_id='D6'`); assert.equal(r.rows[0].body.consult, 'none');
  await a.run('mrConflictOverwrite()'); await a.flush();
  assert.equal(a.run('_mr.ed.state'), 'saved');
  r = await S.pg.query(`select body from mr_reviews where store_id='D6'`); assert.equal(r.rows[0].body.focus[0].note, 'A の入力 2');
  // Network failure: the input stays, it says so, and the next save goes through.
  const realFetch = a.fetch; a.fetch = async () => { throw new TypeError('Failed to fetch'); };
  a.run(`mrSetVal('focus.1.note','オフラインで書いた')`); await a.flush();
  assert.equal(a.run('_mr.ed.state'), 'error'); a.renderPage(); assert.match(strip(a.html), /保存できません（入力は残っています）/);
  a.fetch = realFetch; await a.run('mrSaveNow()');
  assert.equal(a.run('_mr.ed.state'), 'saved');
  r = await S.pg.query(`select body from mr_reviews where store_id='D6'`); assert.equal(r.rows[0].body.focus[1].note, 'オフラインで書いた');
});

test('input: logout while a save is waiting writes nothing; leaving with unsaved input asks first; locked and live stores have no input', async () => {
  const S = await server();
  const c = app(S); await openStore(c, 'D6'); c.run('mrStartInput()');
  c.run(`mrSetVal('consult','none')`); c.run('mrReset()'); await c.flush();
  assert.equal(c.calls.filter(b => b.action === 'save').length, 0);
  const d = app(S); await openStore(d, 'D6'); d.run('mrStartInput()'); d.run(`mrSetVal('consult','none')`);
  let asked = 0; d.confirm = () => { asked++; return false; };
  d.run('mrBack()'); assert.equal(asked, 1); assert.equal(d.run('_mr.view.mode'), 'input');
  // Locked: waiting for a decision.
  const l = app(S); await openStore(l, 'D3'); l.run('mrStartInput()'); assert.equal(l.run('_mr.view.mode'), 'page'); assert.equal(l.run('_mr.ed'), null);
  // Live: numbers only, no input before store publication.
  await S.api('gm', { action: 'stores_save', stores: [{ store_id: 'F01', name: 'ToriTon', am_user: U.am1, sort: 1 }] });
  const kpi = { F01: { sales: { act: 50000, tgt: 52000 }, fc: { act: 31, tgt: 30 }, labor: { act: 27, tgt: 26 }, pl: 'final' } };
  const v = app(S, { who: 'am1', role: 'am', stores: [{ id: 'F01', name: 'ToriTon', am: 'Yuki' }], kpi }); v.run("_mr.env='live'");
  const hv = strip(await openStore(v, 'F01'));
  assert.match(hv, /店舗公開の前なので、店長の報告はまだありません/); assert.doesNotMatch(v.html, /mrStartInput/);
  assert.match(hv, /売上 \$50,000 \$52,000・96\.2% 注意/);
  v.run('mrStartInput()'); assert.equal(v.run('_mr.ed'), null);
  // A store the AM does not have: the server says not found.
  const x = app(S, { who: 'am2', role: 'am', stores: [{ id: 'F01', name: 'ToriTon', am: 'Yuki' }], kpi }); x.run("_mr.env='live'");
  await openStore(x, 'F01'); assert.match(strip(x.html), /うまくいきませんでした（not_found）|もう一度/);
});

test('store page and input: every text is escaped; English', async () => {
  const S = await server();
  const X = '<img src=x onerror=alert(1)>';
  await S.pg.exec(`reset role;
    update mr_reviews set body = jsonb_set(jsonb_set(body, '{kpi,fc,comment}', to_jsonb('${X}'::text)), '{issues,0,what}', to_jsonb('${X}'::text)) where store_id='D1';
    update mr_submissions set body = jsonb_set(jsonb_set(body, '{kpi,fc,comment}', to_jsonb('${X}'::text)), '{focus,0,title}', to_jsonb('${X}'::text)), created_by='${X}';
    update mr_stores set name='${X}' where store_id='D1';
    update mr_replies set data = jsonb_set(data, '{recommend}', to_jsonb('${X}'::text));
    set role service_role;`);
  for (const id of ['D1', 'D3']) {
    const c = app(S); const h = await openStore(c, id);
    assert.ok(!h.includes('<img src=x'), id); assert.ok(h.includes('&lt;img src=x'), id);
    if (id === 'D1') { c.run('mrStartInput()'); c.renderPage(); assert.ok(!c.html.includes('<img src=x') && c.html.includes('&lt;img src=x'), 'input ' + id); }
  }
  const en = app(S, { lang: 'en' }); const he = strip(await openStore(en, 'D1'));
  assert.match(he, /Submitted version 1/); assert.match(he, /Last month PL/); assert.match(he, /Original due 10\/15 → now 10\/31/);
  en.run('mrStartInput()'); en.renderPage(); assert.match(strip(en.html), /Trying the store manager’s screen/);
});

test('a store opens again after going back (list → store → list → store, prev/next, input → page)', async () => {
  const S = await server();
  const c = app(S); await openStore(c, 'D1');
  for (const step of ['mrBack()', "mrOpenStore('D1')", "mrOpenStore('D2')", "mrOpenStore('D1')", 'mrStartInput()', 'mrBack()']) {
    c.run(step); c.renderPage(); await c.flush(); c.renderPage();
    assert.doesNotMatch(c.html, /読み込み中…/, step);
  }
  assert.match(strip(c.html), /港町（デモ） AM 返信待ち/);
});

test('input: the AM’s follow-up question is shown and needs an answer; answering closes it and the store goes back to the AM', async () => {
  const S = await server();
  const c = app(S, { who: 'am2', role: 'am' }); await openStore(c, 'D4'); c.run('mrStartInput()'); c.renderPage();
  const h = strip(c.html);
  assert.match(h, /AM・GM からの質問（追加確認） .* 工事はいつまでか・テイクアウトの割合 工事はいつまでか分かる？ テイクアウトは売上の何 % まで増えた？ AM Lee（デモ）・.*回答希望 10\/19 回答（必須）/);
  assert.deepEqual(J(c.run('mrMissing(_mr.ed.body, mrSnapNow(_mr.rec), mrOpenFollowups(_mr.rec))')), ['answer:issue:i1']);
  assert.match(c.html, /data-p="answers\.issue:i1"[^>]*maxlength="600"/);
  c.run(`mrSetVal('answers.issue:i1','工事は 11 月末まで。テイクアウトは 18%。')`); await c.flush();
  assert.deepEqual(J(c.run('mrMissing(_mr.ed.body, mrSnapNow(_mr.rec), mrOpenFollowups(_mr.rec))')), []);
  await c.run('mrSubmit()'); await c.flush(); c.renderPage();
  const p = strip(c.html);
  assert.match(p, /海岸（デモ） AM 返信待ち/);
  assert.match(p, /追加確認 .* 店長の回答（提出版 2） ?工事は 11 月末まで。テイクアウトは 18%。/);
  c.run('mrBack()'); c.renderPage(); await c.flush(); c.run("_mr.tab='queue'"); c.renderPage();
  assert.doesNotMatch(strip(c.html), /追加確認 1 海岸/);
});

test('input: choosing "相談はない" asks, then drops the questions; text stops at the server’s length; nothing new → no new version', async () => {
  const S = await server();
  const c = app(S); await openStore(c, 'D1'); c.run('mrStartInput()'); c.renderPage();
  assert.match(c.html, /data-p="kpi\.sales\.comment"[^>]*maxlength="400"/); assert.match(c.html, /data-p="issues\.0\.what"[^>]*maxlength="160"/);
  // Unchanged since version 1: the button waits for a change.
  assert.match(strip(c.html), /提出版 1 から変わっていません/); assert.match(c.html, /<button class="btn btn-primary" disabled onclick="mrSubmit\(\)">出し直す（提出版 2）/);
  let asked = 0; c.confirm = () => { asked++; return false; };
  c.run(`mrIn({ getAttribute: k => k === 'data-p' ? 'consult' : null, type: 'radio', value: 'none' })`);
  assert.equal(asked, 1); assert.equal(c.run('_mr.ed.body.consult'), 'yes'); assert.equal(c.run('_mr.ed.body.issues.length'), 1);
  c.confirm = () => true;
  c.run(`mrIn({ getAttribute: k => k === 'data-p' ? 'consult' : null, type: 'radio', value: 'none' })`);
  assert.equal(c.run('_mr.ed.body.consult'), 'none'); assert.equal(c.run('_mr.ed.body.issues.length'), 0);
  c.renderPage(); assert.doesNotMatch(strip(c.html), /提出版 1 から変わっていません/);
});

test('submit: when the answer is lost on the way, the page checks and says it was submitted (no second version)', async () => {
  const S = await server();
  const c = app(S); await openStore(c, 'D6'); c.run('mrStartInput()');
  c.run(`mrSetVal('focus.0.status','ok'); mrSetVal('focus.1.status','ok'); mrSetVal('consult','none')`); await c.flush();
  const f0 = c.fetch; let busySeen = '';
  c.fetch = async (u, i) => { const b = JSON.parse(i.body); if (b.action === 'submit') { busySeen = c.html; await f0(u, i); throw new TypeError('Failed to fetch'); } return f0(u, i); };
  c.renderPage = () => { c.html = c.renderMidReview(); };
  await c.run('mrSubmit()'); await c.flush(); c.renderPage();
  assert.match(busySeen, /<fieldset class="mr-fs" disabled>/); assert.match(busySeen, /提出中…/);
  assert.match(c.toasts.map(x => x[0]).join(' '), /提出できていました（提出版 1）/);
  const n = await S.pg.query(`select count(*)::int n from mr_submissions x join mr_reviews r on r.id=x.review_id where r.store_id='D6'`);
  assert.equal(n.rows[0].n, 1);
  assert.match(strip(c.html), /川沿い（デモ） AM 返信待ち/);
});

test('another email sign-in on the device closes the opened store and the editor (nothing is saved as the new person)', async () => {
  const S = await server();
  const c = app(S); await openStore(c, 'D6'); c.run('mrStartInput()'); c.run(`mrSetVal('consult','none')`);
  c._botSession = { access_token: 'tok-am1', refresh_token: 'r' };
  await c.show(); await c.flush(); c.renderPage();
  assert.equal(c.run('_mr.view'), null); assert.equal(c.run('_mr.ed'), null);
  assert.equal(c.calls.filter(b => b.action === 'save').length, 0);
  assert.match(c.html, /全店 6/); assert.equal(c.run('_mr.who.role'), 'am');
  // Unsaved input: logout and closing the tab ask first.
  const d = app(S); await openStore(d, 'D6'); d.run('mrStartInput()'); d.run(`mrSetVal('consult','none')`);
  assert.equal(d.run('mrUnsaved()'), true);
  assert.match(html, /function doLogout\(\) \{\n  if \(typeof mrUnsaved === 'function' && mrUnsaved\(\) && !confirm\(/);
});
