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
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text); grant select on public.manager_auth to service_role;`);
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
    getStoresAll: () => stores, activeStores: () => stores.filter(s => s.active !== false), getEmployees: () => [{ id: 'E6', name: 'Second AM' }],
    keyKpiStats: ([s]) => ({ sid: s.id, sales: (kpi[s.id] && kpi[s.id].sales && kpi[s.id].sales.act) || 0 }), _meetApplyPl: k => k, meetingBudgetKpi: k => ({ ...k, budget: kpi[k.sid] && kpi[k.sid].sales ? kpi[k.sid].sales.tgt : 0 }),
    _meetKpiRows: p => ['sales', 'fc', 'labor'].map(key => ({ key, act: kpi[p.sid] && kpi[p.sid][key] ? kpi[p.sid][key].act : 0, tgt: kpi[p.sid] && kpi[p.sid][key] ? kpi[p.sid][key].tgt : null, lower: key !== 'sales' })),
    _meetConfirmState: (sid) => (kpi[sid] && kpi[sid].pl) || 'prov',
    showToast: (m, k) => c.toasts.push([m, k]), openModal: h => c.modals.push(h), closeModalDirect: () => {}, confirm: () => true,
    renderPage: () => { c.html = c.renderMidReview(); }, document: { getElementById: k => (c.dom || {})[k] || null, querySelectorAll: () => c.qsa || [] },
    setTimeout: f => { timers.push(f); }, console,
    fetch: async (url, init) => {
      if (!net) throw new TypeError('Failed to fetch');
      const body = JSON.parse(init.body); c.calls.push(body);
      const r = await S.h(new Request('https://fn.test', { method: 'POST', headers: { authorization: init.headers.Authorization }, body: init.body }));
      return { ok: r.ok, status: r.status, json: () => r.json() };
    },
  };
  vm.createContext(c);
  vm.runInContext(MEET + '\n' + MOD + '\nthis.renderMidReview = renderMidReview; this.M = () => _mr;', c);
  c.flush = async () => { for (let i = 0; i < 30 && timers.length; i++) { const f = timers.shift(); f(); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r)); } };
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
  // No employee id on the server: works this time, not remembered, and says so.
  await S.pg.exec(`reset role; update mr_members set emp_id=null where user_id='${U.am2}'; set role service_role;`);
  const n = app(S, { signed: false, lp: { id: 'E6', name: 'AM Two' } });
  n.dom = { 'mr-email': { value: 'am2@x' }, 'mr-password': { value: 'pw' }, 'mr-login-button': { disabled: false }, 'mr-keep': { checked: true }, 'mr-login-error': { textContent: '' } };
  await n.run('mrLogin()'); assert.deepEqual(n.keep, [[null, 'e:E6']]); assert.match(n.toasts[0][0], /社員の登録/);
  // Not a member (office): the error stays in the dialog.
  const f = app(S, { signed: false, lp: { id: 'E3', name: 'Office' } });
  f.dom = { 'mr-email': { value: 'office@x' }, 'mr-password': { value: 'pw' }, 'mr-login-button': { disabled: false }, 'mr-keep': { checked: true }, 'mr-login-error': { textContent: '' } };
  await f.run('mrLogin()'); assert.match(f.dom['mr-login-error'].textContent, /利用者に登録されていません/); assert.equal(f.M().who, null);
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
  assert.match(await x.show(), /利用者に登録されていません/);
  const n = app(S, { net: false });
  assert.match(await n.show(), /mid-review）につながりません/);
});

test('全店 (A): the UI案43 demo — counts, status, next person, overdue, KPI judgements, PL state, schedule', async () => {
  const S = await server();
  const c = app(S);
  const h = await c.show(), s = strip(h);
  for (const [l, n] of [['未提出', 1], ['AM 返信待ち', 1], ['追加確認', 1], ['判断待ち', 1], ['個別相談予定', 1], ['レビュー完了', 1], ['期限超過', 2], ['AM 未設定', 1]])
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
  assert.doesNotMatch(ha, /AM 未設定 <b>/); assert.equal((ha.match(/class="card mr-card"/g) || []).length, 6); assert.doesNotMatch(ha, /設定（GM・CEO）/);
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
  assert.match(s, /ToriTon Yuki 未作成（未提出） 店長 10\/15 売上 96\.2% 注意 原価率 未取得 人件費率 27\.0% 未設定 まだ更新なし —（未提出） 確定/);
  assert.match(s, /売上 96\.2% 注意 原価率 未取得 人件費率 27\.0% 未設定/);
  assert.match(s, /本番の数字（読むだけ）/);
  assert.doesNotMatch(h, /Tenkichi|LaLa/);
  const g = app(S, { stores, kpi }); g.run("_mr.env='live'"); const hg = strip(await g.show());
  assert.match(hg, /Tenkichi Second AM 未作成（未提出） 店長 10\/15 売上 未取得 原価率 31\.0% 注意 人件費率 25\.0% 達成 まだ更新なし —（未提出） 未入手/);
  assert.match(hg, /LaLa AM 未設定 → GM が確認 未作成（未提出） 店長 10\/15 売上 未設定 原価率 未設定 人件費率 未設定/);
  // Live month 2026-10 on 10/12: submission due 10/15, not yet overdue; next is the store manager.
  assert.match(hg, /店長 10\/15/); assert.doesNotMatch(hg, /期限超過 \d+ 日/);
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
