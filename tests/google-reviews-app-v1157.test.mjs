// v1157 Google の口コミ（index.html の FUNERGY_GR）を VM で動かし、本物の handler と本物の SQL（PGlite）につなぐ。合成データだけ・Google は偽物。
// 仕様：docs/GOOGLE_REVIEWS_V1157_JA.md（UI案73：1 毎日 4:30・2 つなぐまでは手入力・3 その月の口コミをすべて・4 設定は KPI設定）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createHandler } from '../supabase/functions/google-reviews/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const B = '/* ==== FUNERGY_GR（v1157）', E = '/* ==== FUNERGY_GR end ==== */';
const MOD = html.slice(html.indexOf(B), html.indexOf(E) + E.length);
const SQL = fs.readFileSync(new URL('../supabase/migrations/20261122090000_google_reviews.sql', import.meta.url), 'utf8');
const NOW0 = Date.parse('2026-11-13T20:00:00Z');   // ハワイ 11/13 10:00
const PEOPLE = { E1: ['ceo', 'Cora CEO'], E2: ['gm', 'Gabe GM'], E5: ['am', 'Ami Area'], E8: ['crew', 'Cam Crew'] };
const ACC = 'accounts/111', LOC1 = 'locations/901';
const PLACE = 'ChIJ_test_place_000001';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fakeGoogle() {
  const g = { calls: [], places: {} };
  g.places[PLACE] = { id: PLACE, displayName: { text: 'Store Two' }, formattedAddress: '1 Test St', rating: 4.3, userRatingCount: 210, googleMapsUri: 'https://maps.google.com/?cid=1',
    reviews: [
      { rating: 5, originalText: { text: 'Great <b>bowl</b>' }, publishTime: '2026-11-10T03:00:00Z', authorAttribution: { displayName: 'Pat', uri: 'https://www.google.com/maps/contrib/1' } },
      { rating: 2, text: { text: 'Slow' }, publishTime: '2026-10-02T03:00:00Z', authorAttribution: { displayName: 'Rae', uri: 'javascript:alert(1)' } },
    ] };
  g.fetch = async (url) => {
    const u = new URL(String(url)); g.calls.push(u.hostname + u.pathname);
    const m = /^\/v1\/places\/(.+)$/.exec(u.pathname);
    if (u.hostname === 'places.googleapis.com' && m && g.places[decodeURIComponent(m[1])]) return new Response(JSON.stringify(g.places[decodeURIComponent(m[1])]), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  return g;
}

async function server({ connect = true, from = '2026-10', loc = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;`);
  await pg.exec(SQL);
  if (connect) await pg.exec(`update public.gr_bp set refresh_token = 'rt-secret', account = 'owner@example.test', status = 'ok', connected_at = now(), last_ok_at = '2026-11-13T14:30:00Z' where id = 1`);
  if (loc) {
    await pg.query(`insert into public.gr_bp_loc (store_id, account, location, title, rating, total, rating_at, synced_at, from_ym) values ('S1', $1, $2, 'Store One BP', 4.62, 318, now(), now(), $3)`, [ACC, LOC1, from]);
    // 11 月の口コミ 7 件（ハワイ時間の投稿日）・10 月 1 件・9 月 1 件（取り始めの前の月）
    const rows = [
      ['a1', 5, 'Loved it', 'Ann', '2026-11-12T20:00:00Z', true], ['a2', 4, '', '', '2026-11-11T20:00:00Z', false],
      ['a3', 3, '<script>alert(1)</script>', 'Eve <x>', '2026-11-10T20:00:00Z', false], ['a4', 5, 'Fast', 'Bo', '2026-11-08T20:00:00Z', false],
      ['a5', 5, 'Good', 'Cy', '2026-11-05T20:00:00Z', false], ['a6', 4, 'Nice', 'Di', '2026-11-03T20:00:00Z', false],
      ['a7', 2, 'Cold', 'Ed', '2026-11-01T11:00:00Z', false],   // ハワイ 11/1 1:00
      ['b1', 5, 'Oct', 'Fy', '2026-11-01T09:00:00Z', false],     // UTC では 11 月・ハワイでは 10/31
      ['c1', 1, 'Sep', 'Gu', '2026-09-15T20:00:00Z', false],
    ];
    for (const [n, r, c, who, at, rep] of rows) {
      await pg.query(`insert into public.gr_reviews (name, store_id, rating, comment, reviewer, created, updated, ym, replied) values ($1,'S1',$2,nullif($3,''),nullif($4,''),$5,$5,public.gr_hst_ym($5::timestamptz),$6)`,
        [`${ACC}/${LOC1}/reviews/${n}`, r, c, who, at, rep]);
    }
  }
  await pg.query('insert into public.gr_places (store_id, place_id) values ($1, $2)', ['S2', PLACE]);
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const g = fakeGoogle();
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon', GOOGLE_PLACES_API_KEY: 'places-key-xyz',
    GBP_OAUTH_CLIENT_ID: 'cid', GBP_OAUTH_CLIENT_SECRET: 'csecret' })[k], db, fetch: g.fetch, now: () => NOW0,
    whoami: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m && PEOPLE[m[1]] ? { emp: m[1], role: PEOPLE[m[1]][0], name: PEOPLE[m[1]][1] } : null; } });
  return { pg, db, g, handler };
}

function fakeDom() {
  const byId = new Map(), cards = [];
  const mk = (id, tag) => ({ id, tag, textContent: '', innerHTML: '', style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, appendChild() {} });
  const D = { byId, cards, hidden: false,
    getElementById: id => byId.get(id) || null, addEventListener() {}, removeEventListener() {},
    createElement: tag => mk('', tag), querySelectorAll: () => [],
    head: { appendChild(c) { if (c.id) byId.set(c.id, c); } } };
  return D;
}

async function app(srv, emp, { role = 'crew', storeLogin = false, href = 'https://funergy-plus.com/' } = {}) {
  const D = fakeDom(), toasts = [], pages = [], calls = [], wrote = [];
  let pending = 0;
  const loc = { href, assign(u) { pages.push('assign:' + u); } };
  const hist = { state: null, replaceState(s, t, u) { loc.replaced = u; } };
  const man = { 'S1|2026.11': { gAvg: 3.9, gCnt: 4, reviewScore: 4.1, gTotalCnt: 300 }, 'S1|2026.9': { gAvg: 4.5, gCnt: 2 }, 'S2|2026.11': { gAvg: 4.4, gCnt: 6, reviewScore: 4.2, gTotalCnt: 205 } };
  const ctx = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number, Error, RegExp, Map, Set, URL, URLSearchParams,
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
    crypto: webcrypto, SUPABASE_URL: 'https://db.test', SUPABASE_ANON: 'anon-key', _hwSession: emp ? 'pin-' + emp : null,
    curStoreLogin: storeLogin, curRole: role, curPage: 'meeting',
    location: loc, history: hist,
    localStorage: new Proxy({}, { get(_, k) { wrote.push('localStorage.' + String(k)); return () => null; } }),
    sessionStorage: new Proxy({}, { get(_, k) { wrote.push('sessionStorage.' + String(k)); return () => null; } }),
    t: ja => ja, showToast: (m, k) => toasts.push([k, m]), confirm: () => true,
    openModal: h => { D.modal = h; }, closeModalDirect: () => { D.modal = ''; },
    go: p => { ctx.curPage = p; pages.push('go:' + p); }, renderPage: p => pages.push('render:' + p),
    FUNERGY_UX: { noteDataChange: () => pages.push('note'), bgRefresh: () => pages.push('bg') },
    getStoresAll: () => [{ id: 'S1', name: 'Store One' }, { id: 'S2', name: 'Store Two', googleUrl: 'https://maps.example/s2' }],
    activeStores: () => [{ id: 'S1', name: 'Store One' }, { id: 'S2', name: 'Store Two' }],
    kpiSettableStores: () => [{ id: 'S1', name: 'Store One' }, { id: 'S2', name: 'Store Two' }],
    getKpiManual: (sid, per) => man[sid + '|' + per] || {},
    k2Period: ym => { const p = ym.split('-'); return p[0] + '.' + parseInt(p[1], 10); },
    k2YmOfOffset: () => '2026-11',
    _k2Num: v => (v == null || v === '' ? null : (isFinite(Number(v)) ? Number(v) : null)),
    k2ExplicitTarget: () => 4.4,
    _meetStatus: (k, a, t) => (a >= t ? 'ok' : 'miss'), _meetStatColor: st => (st === 'ok' ? 'var(--green)' : 'var(--red)'),
    _meetStatLabel: st => (st === 'ok' ? '達成' : '未達'), _meetDiffStr: (k, a, t) => (a - t >= 0 ? '+' : '') + (a - t).toFixed(1),
    canSetKpiStore: () => true, _ymToOffset: () => 0,
    k2GoogleUrlSet: s => !!(s && s.googleUrl), k2GoogleUrl: s => (s && s.googleUrl) || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(((s && s.name) || '') + ' Hawaii'),
    fetch: async (url, init) => {
      pending++;
      try {
        const body = JSON.parse(init.body); calls.push(body.action);
        assert.ok(String(url).endsWith('/functions/v1/google-reviews'));
        return await srv.handler(new Request(url, init));
      } finally { pending--; }
    },
  };
  ctx.window = ctx; ctx.document = D;
  vm.createContext(ctx);
  vm.runInContext(MOD, ctx);
  const idle = async () => { for (let quiet = 0; quiet < 3;) { await sleep(8); quiet = pending ? 0 : quiet + 1; } };
  const S = () => ctx._grState();
  return { ctx, D, toasts, pages, calls, wrote, loc, idle, S };
}

test('the module is in index.html after the chat; version 1157 everywhere; hooks for login, logout, KPI settings and the meeting', () => {
  assert.ok(html.indexOf(B) > html.indexOf('/* ==== FUNERGY_CHAT end ==== */'), 'after the chat module');
  const v = /const APP_VERSION = '(\d+)'/.exec(html)[1];
  assert.ok(Number(v) >= 1157); assert.match(sw, new RegExp("const SW_BUILD = '" + v + "'"));
  assert.equal((html.match(/if\(typeof grReset==='function'\) grReset\(\);/g) || []).length, 2, 'both logout paths');
  assert.match(html, /setTimeout\(function\(\)\{ if\(typeof grStart==='function'\) grStart\(\); \}, 3500\)/);
  assert.match(html, /window\._kpiTab==='google'\)\s*return html \+ \(\(typeof grTabHtml==='function'\) \? grTabHtml\(\) : ''\)/);
  assert.match(html, /function _meetGoogleCard\(store, ym\)\{\n  \/\*[^\n]*\*\/\n  try\{ if\(typeof grCardHtml==='function'\)\{ var _gh=grCardHtml\(store, ym\); if\(_gh\) return _gh; \} \}catch\(e\)\{\}/);
  // KPI の行と年の表：自動の店・月は Google、ほかは手入力
  assert.match(html, /var _gm=\(typeof grMonthOf==='function'\)\?grMonthOf\(sid, ym\):null;\n\s+if\(_gm\)\{ r\.act=_gm\.avg;/);
  assert.match(html, /kk==='google'\)\{ try\{ var _gm=\(typeof grMonthOf==='function'\)\?grMonthOf\(sid, ym\):null; if\(_gm\) return _gm\.avg;/);
  // 手入力の欄：自動の月は Google の 4 つを出さない（ほかの手入力 KPI は残す）
  assert.match(html, /_grAutoM = \(typeof grAutoYm==='function'\) && grAutoYm\(sid, k2YmOfPeriod\(period\)\)/);
  assert.match(html, /if \(_grAutoM\) \{\n\s+manKpis = manKpis\.filter\(m=>\['gAvg','gCnt','reviewScore','gTotalCnt'\]\.indexOf\(m\[0\]\)<0\)/, 'only for auto months');
  // 端末に残さない
  assert.ok(!/localStorage|lsSet\(|_idb|IndexedDB\.|sessionStorage/.test(MOD.replace(/\/\*[\s\S]*?\*\//g, '')), 'nothing on the device');
});

test('2: until Business Profile is connected and read once, the meeting stays manual; once read, auto from the first full month only', async () => {
  // つないでいない：手入力のまま
  const s0 = await server({ connect: false });
  const a0 = await app(s0, 'E8');
  a0.ctx.grStart(); await a0.idle();
  assert.equal(a0.ctx.grAuto('S1'), false); assert.equal(a0.ctx.grMonthOf('S1', '2026-11'), null);
  // 結んだが、まだ一度も取り終えていない（審査待ち）：手入力のまま
  const s1 = await server({ from: null });
  const a1 = await app(s1, 'E8');
  a1.ctx.grStart(); await a1.idle();
  assert.equal(a1.ctx.grMonthOf('S1', '2026-11'), null);
  // 取り終えた：10 月から自動。9 月は手入力のまま。11 月は 7 件（ハワイ時間の投稿日・UTC で 11/1 でもハワイで 10/31 の 1 件は 10 月）
  const s = await server();
  const a = await app(s, 'E8');
  assert.equal(a.ctx.grMonthOf('S1', '2026-11'), null, 'before the first answer: manual');
  a.ctx.grStart(); await a.idle();
  assert.deepEqual(JSON.parse(JSON.stringify(a.ctx.grMonthOf('S1', '2026-11'))), { avg: 4, cnt: 7 });
  assert.deepEqual(JSON.parse(JSON.stringify(a.ctx.grMonthOf('S1', '2026-10'))), { avg: 5, cnt: 1 });
  assert.equal(a.ctx.grMonthOf('S1', '2026-09'), null, 'before the first full month: manual');
  assert.equal(a.ctx.grMonthOf('S2', '2026-11'), null, 'a store without Business Profile: manual');
  assert.deepEqual(JSON.parse(JSON.stringify(a.ctx.grMonthOf('S1', '2026-12'))), { avg: null, cnt: 0 });
  assert.equal(a.ctx.grOverallOf('S1').rating, 4.62);
  assert.ok(a.pages.includes('note') && a.pages.includes('bg'), 'redraws the meeting in the background when the numbers arrive');
  // 10 分のあいだは聞き直さない
  const n = a.calls.length; a.ctx.grAuto('S1'); a.ctx.grMonthOf('S1', '2026-11'); await a.idle();
  assert.equal(a.calls.length, n);
  assert.deepEqual(a.wrote, [], 'never touches localStorage or sessionStorage');
});

test('3: the meeting card of an auto store shows every review of the month (escaped), the count is the meeting actual, no Enter button', async () => {
  const s = await server();
  const a = await app(s, 'E8');
  a.ctx.grStart(); await a.idle();
  let h = a.ctx.grCardHtml({ id: 'S1', name: 'Store One' }, '2026-11');
  assert.match(h, /自動（Google）/);
  assert.match(h, /★4\.0/); assert.match(h, /7 件・会議の「実績」に入る値（自動）/);
  assert.match(h, /未達/, 'judged against the target 4.4');
  assert.match(h, /総合評価・Business Profile/); assert.match(h, /★4\.6/); assert.match(h, /累計 318 件/);
  assert.ok(!/入力する/.test(h), 'no manual entry for an auto month');
  assert.ok(!a.calls.includes('places_now'), 'no Places call when Business Profile has the overall rating');
  await a.idle();
  h = a.ctx.grCardHtml({ id: 'S1', name: 'Store One' }, '2026-11');
  assert.match(h, /この月の口コミ（すべて・新しい順）（7）/);
  assert.equal((h.match(/class="gr-rv"/g) || []).length, 7, 'all seven');
  assert.ok(h.indexOf('Loved it') < h.indexOf('Cold'), 'newest first');
  assert.ok(!h.includes('<script>alert(1)</script>') && h.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'escaped');
  assert.ok(h.includes('Eve &lt;x&gt;'));
  assert.match(h, /返信済み/); assert.match(h, /（星だけ）/); assert.match(h, /名前なし/);
  assert.match(h, /すべて広げる/);
  // 取り始めの前の月は手入力のカード
  const h9 = a.ctx.grCardHtml({ id: 'S1', name: 'Store One' }, '2026-09');
  assert.match(h9, />手入力</); assert.match(h9, /★4\.5/); assert.match(h9, /入力する/);
});

test('2 and terms: a store without Business Profile stays manual; Places shows the overall and recent reviews live and nothing is kept', async () => {
  const s = await server();
  const a = await app(s, 'E8');
  a.ctx.grStart(); await a.idle();
  let h = a.ctx.grCardHtml({ id: 'S2', name: 'Store Two', googleUrl: 'https://maps.example/s2' }, '2026-11');
  assert.match(h, /手入力/); assert.match(h, /★4\.4/, 'the manual month average'); assert.match(h, /入力する/);
  assert.match(h, /Business Profile をつなぐまでは/);
  await a.idle();
  h = a.ctx.grCardHtml({ id: 'S2', name: 'Store Two', googleUrl: 'https://maps.example/s2' }, '2026-11');
  assert.match(h, /総合評価は自動・月の平均は手入力/);
  assert.match(h, /総合評価・Google（今）/); assert.match(h, /★4\.3/); assert.match(h, /累計 210 件/);
  assert.match(h, /Google が返す最近の口コミ（最大 5 件・この月の分 1 件）/);
  assert.ok(h.includes('Great &lt;b&gt;bowl&lt;/b&gt;'), 'escaped');
  assert.ok(h.includes('href="https://www.google.com/maps/contrib/1"'), 'author attribution link');
  assert.ok(!h.includes('javascript:'), 'no unsafe link');
  assert.match(h, /Google の決まりで残しません/);
  assert.ok(h.includes('href="https://maps.google.com/?cid=1"'), 'Google’s own link');
  // サーバーにも残らない（place_id だけ）
  await s.pg.exec('reset role');
  const cols = (await s.pg.query("select column_name from information_schema.columns where table_schema='public' and table_name='gr_places' order by 1")).rows.map(r => r.column_name);
  assert.deepEqual(cols, ['place_id', 'set_at', 'set_emp', 'set_name', 'store_id']);
  assert.deepEqual(a.wrote, []);
});

test('4: KPI settings › Google reviews — GM can connect and pick; crew only sees; the store tablet sees nothing', async () => {
  const s = await server();
  const gm = await app(s, 'E2', { role: 'gm' });
  gm.ctx.grStart(); await gm.idle();
  gm.ctx.grTabHtml(); await gm.idle();
  let h = gm.ctx.grTabHtml();
  assert.match(h, /つながっています/); assert.match(h, /owner@example\.test/, 'GM sees the connected account');
  assert.match(h, /今すぐ取る/); assert.match(h, />切る</);
  assert.match(h, /自動（2026-10 から）/); assert.match(h, /Store One BP/);
  assert.match(h, /grSearchOpen\('S2'\)/); assert.match(h, /grLocsOpen\('S1'\)/);
  const crew = await app(s, 'E8');
  crew.ctx.grStart(); await crew.idle();
  crew.ctx.grTabHtml(); await crew.idle();
  h = crew.ctx.grTabHtml();
  assert.ok(!/grSearchOpen|grLocsOpen|grConnect|grSyncNow/.test(h), 'no buttons');
  assert.ok(!h.includes('owner@example.test'), 'the account is for GM and CEO only');
  assert.match(h, /つなぐ・店を選ぶのは GM・CEO です/);
  const tab = await app(s, 'E8', { storeLogin: true, role: 'sl' });
  assert.match(tab.ctx.grTabHtml(), /個人の PIN でログインした人だけ/);
  tab.ctx.grStart(); await tab.idle();
  assert.deepEqual(tab.calls, [], 'the store tablet never asks');
  // GM：今すぐ取る（つながっているが偽の Google は鍵を返さない＝読めない）→ 知らせる
  gm.ctx.grSyncNow(); await gm.idle();
  assert.ok(gm.toasts.some(([k]) => k === 'error'));
  // GM：Google のログインへ（accounts.google.com だけに移る）
  gm.ctx.grConnect(); await gm.idle();
  const to = gm.pages.find(p => p.startsWith('assign:'));
  assert.ok(to && to.startsWith('assign:https://accounts.google.com/'), to);
});

test('Google sign-in return: the result is read from the address once, removed, and told after the PIN login; GM goes to the Google tab', async () => {
  const s = await server();
  const a = await app(s, 'E2', { role: 'gm', href: 'https://funergy-plus.com/?google_bp=pending#x' });
  assert.equal(a.loc.replaced, '/#x', 'the result is removed from the address');
  a.ctx.grStart(); await a.idle();
  assert.ok(a.toasts.some(([k, m]) => k === 'info' && /審査が通るまで/.test(m)));
  assert.ok(a.pages.includes('go:kpi_master')); assert.equal(a.ctx._kpiTab, 'google');
  const b = await app(s, 'E8', { href: 'https://funergy-plus.com/?a=1&google_bp=<script>' });
  assert.equal(b.loc.replaced, '/?a=1');
  b.ctx.grStart(); await b.idle();
  assert.ok(b.toasts.some(([k]) => k === 'error')); assert.ok(!b.pages.includes('go:kpi_master'), 'crew is not sent to settings');
  assert.ok(!b.toasts.some(([, m]) => m.includes('<script>')));
});

test('logout: the next person never sees the previous answers; a late answer is thrown away', async () => {
  const s = await server();
  const a = await app(s, 'E2', { role: 'gm' });
  a.ctx.grStart();
  a.ctx.grReset();                     // 答えが来る前にログアウト
  a.ctx._hwSession = 'pin-E8'; a.ctx.curRole = 'crew';
  await a.idle();
  assert.equal(a.S().kpi, null, 'the late answer is not kept');
  assert.equal(a.ctx.grMonthOf('S1', '2026-11'), null);
  a.ctx.grStart(); await a.idle();
  assert.ok(a.ctx.grMonthOf('S1', '2026-11'));
  // 印が変わったら（ほかの人のログイン）始め直す
  a.ctx._hwSession = 'pin-E1'; const g0 = a.S().gen; a.ctx.grStart();
  assert.ok(a.S().gen > g0);
  a.ctx._hwSession = null; a.ctx.grReset();
  assert.equal(a.ctx.grAuto('S1'), false);  // GM の操作の答えが、ログアウトして次の人に変わってから届いた：その答えは使わず、止めたと知らせる
  const b = await app(s, 'E2', { role: 'gm' });
  b.ctx.grStart(); await b.idle();
  b.ctx.grSyncNow();
  b.ctx.grReset(); b.ctx._hwSession = 'pin-E8'; b.ctx.curRole = 'crew';
  await b.idle();
  const errs = b.toasts.filter(([k]) => k === 'error');
  assert.equal(errs.length, 1, JSON.stringify(b.toasts)); assert.match(errs[0][1], /別の人のログインに変わった/);
});

test('server or SQL missing: the settings tab says so and the meeting stays manual', async () => {
  const s = await server();
  const a = await app({ handler: async () => new Response('', { status: 404 }) }, 'E2', { role: 'gm' });
  a.ctx.grStart(); await a.idle();
  a.ctx.grTabHtml(); await a.idle();
  assert.match(a.ctx.grTabHtml(), /関数 google-reviews）がまだ入っていません/);
  assert.equal(a.ctx.grMonthOf('S1', '2026-11'), null);
  const n = a.calls.length; a.ctx.grLoadKpi(); await a.idle();
  assert.equal(a.calls.length, n, 'stops asking until the next login');
  const b = await app({ handler: async () => new Response(JSON.stringify({ error: 'gr_missing' }), { status: 503 }) }, 'E2', { role: 'gm' });
  b.ctx.grStart(); await b.idle(); b.ctx.grTabHtml(); await b.idle();
  assert.match(b.ctx.grTabHtml(), /SQL）がまだ入っていません/);
  void s;
});

// ---------------------------------------------------------------- #151 のレビュー（Codex・Claude）の直し
test('#151 settings: a failed read with an older status waits 2 minutes instead of asking again on every redraw (503 ten times)', async () => {
  const s = await server();
  let fail = 0, statusCalls = 0;
  const wrap = { handler: async req => {
    const body = await req.clone().json();
    if (body.action === 'status') { statusCalls++; if (fail > 0) { fail--; return new Response(JSON.stringify({ error: 'x' }), { status: 503 }); } }
    return s.handler(req);
  } };
  const a = await app(wrap, 'E2', { role: 'gm' });
  // 設定のタブが画面にあるとき：描き直すと grTabHtml が呼ばれる（Codex の再現と同じ形）
  const tab = { getAttribute: () => '1', set outerHTML(v) { tab.n = (tab.n || 0) + 1; } };
  a.D.querySelectorAll = sel => (sel === '[data-grtab]' ? [tab] : []);
  a.ctx.grStart(); a.ctx.grTabHtml(); await a.idle();
  assert.ok(a.S().status, 'read once');
  const n0 = statusCalls;
  a.S().status._at = 0; fail = 10;          // 古くなった・ここから 10 回 503
  a.ctx.grTabHtml(); await a.idle(); await sleep(40); await a.idle();
  assert.equal(statusCalls - n0, 1, 'one request, then it waits (before: 11 requests in 27 ms)');
  assert.equal(a.S().statusSt, 'stale');
  assert.match(a.ctx.grTabHtml(), /最新を読めませんでした（前に読めた内容を出しています）/);
  assert.match(a.ctx.grTabHtml(), /つなぎ方/, 'the older status is still shown');
  // 「もう一度」は待たずに読む
  fail = 0; a.ctx.grReloadTab(); await a.idle();
  assert.equal(statusCalls - n0, 2); assert.equal(a.S().statusSt, 'ok');
  assert.ok(!/最新を読めませんでした/.test(a.ctx.grTabHtml()));
});

test('#151 the meeting data (kpi): a failed read with an older value waits 2 minutes, it does not ask again on every card', async () => {
  const s = await server();
  let fail = false, kpiCalls = 0;
  const wrap = { handler: async req => {
    const body = await req.clone().json();
    if (body.action === 'kpi') { kpiCalls++; if (fail) return new Response(JSON.stringify({ error: 'x' }), { status: 503 }); }
    return s.handler(req);
  } };
  const a = await app(wrap, 'E8');
  a.ctx.grStart(); await a.idle();
  const n0 = kpiCalls;
  a.S().kpiAt = 0; fail = true;
  for (let i = 0; i < 6; i++) { a.ctx.grAuto('S1'); await a.idle(); }
  assert.equal(kpiCalls - n0, 1, 'one failed read, then it waits');
  assert.ok(a.ctx.grAuto('S1'), 'the older value is still used');
});

test('#151 a month with more reviews than one page: the card says how many are shown and reads the rest 200 at a time; a late answer after a reload is dropped', async () => {
  const s = await server();
  await s.pg.exec('reset role');
  for (let i = 0; i < 443; i++) await s.pg.query(`insert into public.gr_reviews (name, store_id, rating, comment, reviewer, created, updated, ym) values ($1,'S1',4,$2,'X',$3,$3,'2026-11')`,
    [`${ACC}/${LOC1}/reviews/m${i}`, 'many ' + i, new Date(Date.parse('2026-11-12T00:00:00Z') - Math.floor(i / 2) * 60000).toISOString()]);
  await s.pg.exec('set role service_role');
  const a = await app(s, 'E8');
  a.ctx.grStart(); await a.idle();
  a.ctx.grCardHtml({ id: 'S1', name: 'Store One' }, '2026-11'); await a.idle();
  let h = a.ctx.grCardHtml({ id: 'S1', name: 'Store One' }, '2026-11');
  assert.match(h, /450 件のうち 200 件を表示/);
  assert.match(h, /続きを読む（残り 250 件）/);
  assert.equal((h.match(/class="gr-rv"/g) || []).length, 200);
  a.ctx.grMoreMonth('S1', '2026-11'); await a.idle();
  h = a.ctx.grCardHtml({ id: 'S1', name: 'Store One' }, '2026-11');
  assert.match(h, /450 件のうち 400 件を表示/);
  a.ctx.grMoreMonth('S1', '2026-11'); await a.idle();
  h = a.ctx.grCardHtml({ id: 'S1', name: 'Store One' }, '2026-11');
  assert.match(h, /この月の口コミ（すべて・新しい順）（450）/);
  assert.ok(!/続きを読む/.test(h));
  const items = a.S().month['S1|2026-11'].data.items;
  assert.equal(new Set(items.map(x => x.h)).size, 450, 'each review once');
});

test('#151 reading more: a late "more" answer after a reload is dropped; an overlapping page does not show a review twice', async () => {
  const s = await server();
  await s.pg.exec('reset role');
  for (let i = 0; i < 443; i++) await s.pg.query(`insert into public.gr_reviews (name, store_id, rating, comment, reviewer, created, updated, ym) values ($1,'S1',4,$2,'X',$3,$3,'2026-11')`,
    [`${ACC}/${LOC1}/reviews/m${i}`, 'many ' + i, new Date(Date.parse('2026-11-12T00:00:00Z') - Math.floor(i / 2) * 60000).toISOString()]);
  await s.pg.exec('set role service_role');
  let hold = null, overlap = false;
  const wrap = { handler: async req => {
    const body = await req.clone().json();
    const r = await s.handler(req);
    if (body.action === 'month' && body.before) {
      if (hold) await hold;
      if (overlap) { const j = await r.json(); const first = { ...body }; delete first.before;
        const prev = (await (await s.handler(new Request(req.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(first) }))).json()).items;
        j.items = [prev[prev.length - 1]].concat(j.items); return new Response(JSON.stringify(j), { status: 200 }); }
    }
    return r;
  } };
  const a = await app(wrap, 'E8');
  a.ctx.grStart(); await a.idle();
  a.ctx.grCardHtml({ id: 'S1', name: 'Store One' }, '2026-11'); await a.idle();
  // 続きの答えを止めて、そのあいだに読み直す：読み直しが先に届き、遅れて届いた続きは使わない
  let release; hold = new Promise(r => { release = r; });
  a.ctx.grMoreMonth('S1', '2026-11'); await sleep(20);
  a.ctx.grRetryMonth('S1', '2026-11');
  // 続きの答えは止まったまま（idle は待てない）：読み直しが届くまで待つ
  for (let i = 0; i < 300 && a.S().month['S1|2026-11'].st !== 'ok'; i++) await sleep(10);
  assert.equal(a.S().month['S1|2026-11'].st, 'ok');
  assert.equal(a.S().month['S1|2026-11'].data.items.length, 200);
  hold = null; release(); await a.idle();
  assert.equal(a.S().month['S1|2026-11'].data.items.length, 200, 'the late "more" answer is dropped');
  // 重なったページ（前のページの最後の 1 件がもう一度来る）：同じ口コミは 1 回だけ
  overlap = true;
  a.ctx.grMoreMonth('S1', '2026-11'); await a.idle();
  const items = a.S().month['S1|2026-11'].data.items;
  assert.equal(items.length, 400); assert.equal(new Set(items.map(x => x.h)).size, 400);
});

test('#151 revoked access: the settings line no longer says the hand entry is used (the read stores stay automatic)', async () => {
  const s = await server();
  await s.pg.exec("reset role; update public.gr_bp set status = 'expired'; set role service_role");
  const a = await app(s, 'E2', { role: 'gm' });
  a.ctx.grStart(); a.ctx.grTabHtml(); await a.idle();
  const h = a.ctx.grTabHtml();
  assert.match(h, /それまで新しい口コミは入りません・つなぎ直すと止まったところから取ります/);
  assert.ok(!/それまでは手入力/.test(h.replace(/審査待ち[^<]*/g, '')));
  assert.ok(a.ctx.grAuto('S1'), 'still automatic, as the text now says');
});
