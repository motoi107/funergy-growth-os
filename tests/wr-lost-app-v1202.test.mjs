// v1202（8B）：紛失届をサーバーの申請へ（アプリ）。本物の画面のモジュール（index.html の FUNERGY_WR）を VM で、本物の handler と本物の SQL
// （申請の本番の順＋承認・閲覧の共通ルール＋20261213090000_wr_lost.sql・PGlite）につなぐ。合成データだけ。仕様：docs/UNIFIED_UI_V1191_JA.md の 25。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { setup, M } from './approval-rules-world.mjs';

const html = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const B = '/* ==== FUNERGY_WR（v1131', E = '/* ==== FUNERGY_WR end ==== */';
const MOD = html.slice(html.indexOf(B), html.indexOf(E));
const LOST = M('20261213090000_wr_lost');

async function world(lost = true) {
  const s = await setup();
  if (lost) { await s.pg.exec('reset role'); await s.pg.exec(LOST); await s.pg.exec('set role service_role'); }
  return s;
}
function fakeDom() {
  const els = {};
  const parse = h => {
    const re = /<(input|select|textarea|div)\b([^>]*)\bid="([^"]+)"([^>]*)>/g; let m;
    while ((m = re.exec(h))) {
      const [, tagName, a1, id, a2] = m, attrs = a1 + a2;
      const el = els[id] || (els[id] = mkEl(id));
      if (tagName === 'input') { const v = /\bvalue="([^"]*)"/.exec(attrs); el.value = v ? v[1] : ''; el.checked = /\bchecked\b/.test(attrs); }
    }
  };
  function mkEl(id) { let ih = ''; return { id, value: '', checked: false, files: null, get innerHTML() { return ih; }, set innerHTML(v) { ih = v; parse(v); } }; }
  return { els, parse };
}
async function app(s, emp, { role = 'crew', page = 'lost_receipt', pin = true } = {}) {
  const dom = fakeDom(), toasts = [], pages = [], oldOpened = [];
  let modal = '';
  const ctx = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number, Uint8Array, setTimeout: (f) => { f(); return 0; }, encodeURI,
    crypto: webcrypto, SUPABASE_URL: 'https://db.test', SUPABASE_ANON: 'anon-key', _hwSession: pin ? 'pin-' + emp : null, innerWidth: 1024,
    curPage: page, workTab: 'wr', _arTab: 'req', curRole: role, curRealRole: '', curStore: 'S1', STORES: [{ id: 'S1', name: 'Store One' }, { id: 'S2', name: 'Store Two' }],
    t: (ja) => ja, bizNow: () => new Date(), kpi: (l, v) => `[${l}:${v}]`, mrAuthKey: () => 'p|' + emp,
    renderPage: p => pages.push(p), go: p => pages.push('go:' + p), showToast: (m, k) => toasts.push([k, m]),
    openModal: h => { modal = h; dom.parse(h); }, closeModalDirect: () => { modal = ''; },
    confirm: () => true, prompt: (_m, d) => d, groupsForRole: () => [{ children: ['dashboard', 'tasks'] }],
    ls: (k, d) => d, _apClosed: () => true, apOldPend: () => [],
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: async (url, init) => s.handler(new Request(url, init)),
    document: { getElementById: id => dom.els[id] || null },
    openLostReceiptForm: function (id) { oldOpened.push(id || 'new'); },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(MOD, ctx);
  const settle = async () => { for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r)); };
  return { ctx, dom, toasts, pages, oldOpened, settle, modal: () => modal, S: () => ctx._wrState() };
}
const fill = (a, v) => { for (const [k, x] of Object.entries(v)) a.dom.els['wrf-' + k].value = x; };

test('with the SQL (sql 9) and the function (fn 14): “New” on the lost receipt screen opens the request form for a lost receipt (G1 too, no expense right); sending makes LR-…', async () => {
  const s = await world();
  const a = await app(s, 'E8');   // Crew（G1）・経費の申請の権限は無い
  a.ctx.openLostReceiptForm(); await a.settle();
  assert.equal(a.oldOpened.length, 0, 'not the earlier form');
  assert.equal(a.ctx.wrLostReady(), true);
  const f = a.dom.els['wr-form'].innerHTML;
  assert.match(f, /会社のカードで買ったのにレシートを無くしたとき/);
  for (const id of ['date', 'vendor', 'amount', 'cardholder', 'items', 'memo']) assert.ok(a.dom.els['wrf-' + id], id);
  assert.doesNotMatch(f, /wrPick\('/, 'no expense kind buttons');
  assert.equal(a.dom.els['wrf-cardholder'].value, 'Cam Crew', 'the card user starts as me');
  fill(a, { store: 'S1', vendor: 'Costco', amount: '42.50', items: 'ice', memo: 'lost it' });   // （試験の DOM は select の値を持たない）
  await a.ctx.wrSend(); await a.settle();
  const rows = await s.q("select code, kind, status, amount_cents, store_id, requester_emp, payload from wr_requests where kind = 'lost'");
  assert.equal(rows.length, 1);
  assert.match(rows[0].code, /^LR-/); assert.equal(rows[0].status, 'pending'); assert.equal(Number(rows[0].amount_cents), 4250); assert.equal(rows[0].store_id, 'S1'); assert.equal(rows[0].requester_emp, 'E8');
  assert.deepEqual(Object.keys(rows[0].payload).sort(), ['amount_cents', 'cardholder', 'date', 'items', 'memo', 'vendor']);
  // editing an earlier lost receipt (with an id) stays on the earlier screen
  a.ctx.openLostReceiptForm('lr1'); assert.deepEqual(a.oldOpened, ['lr1']);
});

test('before the SQL (sql 8) or without a PIN sign-in: the earlier lost receipt form, as today', async () => {
  const s = await world(false);
  const a = await app(s, 'E8');
  a.ctx.openLostReceiptForm(); await a.settle();
  assert.equal(a.ctx.wrLostReady(), false);
  assert.deepEqual(a.oldOpened, ['new']);
  const t = await world();
  const b = await app(t, 'E8', { pin: false });
  b.ctx.wrStartExpense('lost'); await b.settle();
  assert.deepEqual(b.oldOpened, ['new'], 'store tablet / no PIN: the earlier form');
});

test('the detail shows the lost receipt fields; accounting gets it in the one list feed after the GM approves; it ends at the check', async () => {
  const s = await world();
  const x = (await s.call('E8', { action: 'submit', kind: 'lost', store_id: 'S1', client_key: s.key(), payload: { date: s.today, vendor: 'Costco', amount_cents: 4250, cardholder: 'Sam Store', items: 'ice', memo: '' } })).body;
  const g = await app(s, 'E2', { role: 'gm', page: 'tasks' });
  g.ctx.wrOpen(x.id); await g.settle();
  const d = g.dom.els['wr-detail'].innerHTML;
  assert.match(d, /紛失届 · LR-/); assert.match(d, /買った日/); assert.match(d, /店（業者）[^]*Costco/); assert.match(d, /カードを使った人[^]*Sam Store/);
  await s.approve('E2', x);
  const ac = await app(s, 'E3', { role: 'office', page: 'acct_center' });
  ac.ctx.acrOnPage = () => true;
  ac.ctx.wrAcctFeed(); await ac.settle(); ac.ctx.wrAcctFeed(); await ac.settle();
  const f = ac.ctx.wrAcctFeed();
  const r = f.rows.find(y => y.id === x.id);
  assert.ok(r, 'in the one list'); assert.equal(r.kindL, '紛失届'); assert.equal(r.st, 'ck'); assert.equal(r.amount, 42.5); assert.match(r.useH, /Costco · Sam Store/);
});

test('a person who can also send expenses gets only the lost receipt form from “New” (no expense kind buttons)', async () => {
  const s = await world();
  const a = await app(s, 'E6', { role: 'sl' });   // Store Manager：経費も出せる
  a.ctx.openLostReceiptForm(); await a.settle();
  const f = a.dom.els['wr-form'].innerHTML;
  assert.ok(a.ctx.wrExpKinds().length > 0, 'this person can send expenses');
  assert.match(f, /会社のカードで買ったのにレシートを無くしたとき/); assert.doesNotMatch(f, /wrPick\('/);
});
