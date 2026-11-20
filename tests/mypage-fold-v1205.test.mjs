// v1205（UI案98・段階 4・Moto さんの答え 5A・6A）：スマホ（1 列）のマイページの ④ 成長・⑤ 会社から・⑥ 自分の設定は見出しだけ（押すと開く・
// 開いたかはこの端末だけが覚える）。本部の人の「対応可能ポジション」は所属・応援の店だけ。本物の関数を index.html から切り出して VM で動かす。
// 合成データだけ。仕様：docs/UNIFIED_UI_V1191_JA.md の 27c。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const BLK = SRC.slice(SRC.indexOf('/* ===== v1203（UI案98・段階 4'), SRC.indexOf('function renderMypage() {'));
const ESC = SRC.slice(SRC.indexOf('function escapeHtml(s){'), SRC.indexOf('\n', SRC.indexOf('function escapeHtml(s){')));
const PGD = SRC.slice(SRC.indexOf('function renderPGD(empName, isManagerView) {'), SRC.indexOf('/* ゲーミフィケーション: 実績バッジ */'));

function fakeLS(init = {}) { const m = new Map(Object.entries(init)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; }
function blk({ pc = false, ls = fakeLS() } = {}) {
  const els = {}, btns = {};
  const ctx = {
    console, Math, JSON, Object, Array, String, Number, Date, curLang: 'ja', t: (ja, en) => (ctx.curLang === 'en' ? en : ja),
    empSmIsPc: () => pc, uiPcWatch1177: () => {}, localStorage: ls,
    document: {
      getElementById: id => els[id] || null,
      querySelector: sel => { let m = /data-mps="(\d+)"\] \.mp-fold/.exec(sel); if (m) return btns[m[1]] || null; m = /data-mps="(\d+)"/.exec(sel); return m ? (els['sec' + m[1]] || null) : null; },
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(ESC + '\n' + BLK, ctx);
  const mk = sec => { const attrs = {}; els['mp-secb-' + sec] = { hidden: true }; btns[sec] = { setAttribute: (k, v) => { attrs[k] = v; }, attrs }; els['sec' + sec] = { scrolled: 0, scrollIntoView() { this.scrolled++; } }; };
  return { ctx, els, btns, ls, mk };
}
const S = (s, o) => '<!--MPS:' + s + ':' + o + '-->', card = n => '<div class="card">' + n + '</div>';
const BODY = '<div class="mypage-header"></div>' + S(1, 10) + card('today') + S(2, 10) + card('req') + S(3, 10) + card('work') + S(4, 10) + card('grow') + S(5, 10) + card('co') + S(6, 10) + card('pin');

test('phone: ① ② ③ stay open; ④ ⑤ ⑥ are a heading button (aria-expanded, aria-controls) over a hidden body; PC never folds', () => {
  const { ctx } = blk();
  const h = ctx.mpSecLayout(BODY);
  for (const n of [1, 2, 3]) assert.match(h, new RegExp('<section class="mp-sec" data-mps="' + n + '"><h2 class="mp-sech"><span class="mp-secn">'));
  for (const n of [4, 5, 6]) {
    assert.match(h, new RegExp('<section class="mp-sec mp-sec-f" data-mps="' + n + '"><h2 class="mp-sech"><button type="button" class="mp-fold" aria-expanded="false" aria-controls="mp-secb-' + n + '" onclick="mpFoldToggle\\(' + n + '\\)">'));
    assert.match(h, new RegExp('<div class="mp-secb" id="mp-secb-' + n + '" hidden>'));
  }
  assert.match(h, /<div class="mp-secb" id="mp-secb-4" hidden><div class="card">grow<\/div><\/div>/, 'the cards are there (only hidden)');
  const pc = blk({ pc: true }).ctx.mpSecLayout(BODY);
  assert.doesNotMatch(pc, /mp-fold|mp-secb|hidden/);
  // 英語
  ctx.curLang = 'en'; assert.match(ctx.mpSecLayout(BODY), /<span class="mp-secn">④<\/span>Growth<i class="ti ti-chevron-down mp-fold-i"><\/i><\/button>/);
});

test('open / close is kept on this device only (localStorage mp_open_v1205); a section opened before is drawn open; mpGoSec opens it', () => {
  const a = blk();
  a.mk(4); a.mk(5);
  a.ctx.mpFoldToggle(4);
  assert.equal(a.els['mp-secb-4'].hidden, false); assert.equal(a.btns[4].attrs['aria-expanded'], 'true');
  assert.deepEqual(JSON.parse(a.ls.getItem('mp_open_v1205')), { 4: 1 });
  assert.match(a.ctx.mpSecLayout(BODY), /aria-expanded="true" aria-controls="mp-secb-4"[\s\S]*<div class="mp-secb" id="mp-secb-4">/, 'drawn open next time');
  a.ctx.mpFoldToggle(4);
  assert.equal(a.els['mp-secb-4'].hidden, true); assert.equal(a.btns[4].attrs['aria-expanded'], 'false');
  assert.deepEqual(JSON.parse(a.ls.getItem('mp_open_v1205')), {});
  a.ctx.mpGoSec(5);
  assert.equal(a.els['mp-secb-5'].hidden, false, 'going to ⑤ (a consultation reply in ①) opens it'); assert.equal(a.els.sec5.scrolled, 1);
  // 壊れた値・使えない localStorage でも描ける（閉じたまま）
  const b = blk({ ls: fakeLS({ mp_open_v1205: '{bad' }) });
  assert.match(b.ctx.mpSecLayout(BODY), /id="mp-secb-4" hidden/);
  const c = blk({ ls: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } });
  c.mk(6); c.ctx.mpFoldToggle(6); assert.equal(c.els['mp-secb-6'].hidden, false, 'still opens on screen');
  // 同期の仕組み（ls / lsSet）は使わない＝この端末だけ
  assert.doesNotMatch(BLK.slice(BLK.indexOf('var MP_FOLD_KEY'), BLK.indexOf('function mpGoSec(')), /lsSet\(|\bls\(/);
});

test('5A: on their own My Page, HQ people (GM, CEO, accounting, office crew, Head Chef) see positions only for their own and support stores (none → no card); AM, store staff and other people’s pages unchanged', () => {
  const ctx = {
    console, Math, JSON, Object, Array, String, Number, Date, t: ja => ja, escapeHtml: s => String(s), STORES: [{ id: 'F01', name: 'Store A' }, { id: 'F02', name: 'Store B' }, { id: 'F03', name: 'Store C' }],
    getEmployees: () => ctx._emps, ROLE_CONFIG: new Proxy({}, { get: () => ({ label: 'x' }) }), STEP_PROMO: [{ role: '', cond: [] }], ls: (k, d) => d, getWarnings: () => [], scSeesStore: () => true,
    _tipLatestApproved: () => null, _tipNotFuture: null, empSmIsPc: () => false, uiPcWatch1177: () => {}, getStorePositions: () => ['Server', 'Host'], getEmpSkillsStore: () => ({}),
    SKILL_TRAINING: {}, posLabel: p => p, curRole: 'gm', goOnboarding: () => {}, kpi: (l, v) => '[' + l + ':' + v + ']', getStoresAll: () => ctx.STORES, amStoresOf: () => ['F02', 'F03'],
  };
  vm.createContext(ctx);
  vm.runInContext(SRC.slice(SRC.indexOf('function empStoresOf(e) {'), SRC.indexOf('\n}\n', SRC.indexOf('function empStoresOf(e) {')) + 3) + '\n' + PGD, ctx);
  const cards = (name, emp, mgrView = false) => { ctx._emps = [{ name, step: 0, emp: '正社員', support: [], ...emp }]; return [...ctx.renderPGD(name, mgrView).matchAll(/background:[^"]*"><\/span>([^<]*) 対応可能ポジション/g)].map(m => m[1]); };
  assert.deepEqual(cards('G', { role: 'gm', store: 'OFFICE' }), [], 'GM (office): no store → no card (was 3 stores here, 9 in production)');
  assert.deepEqual(cards('C', { role: 'chef', store: 'ALL' }), [], 'Head Chef (all stores) → none');
  assert.deepEqual(cards('O', { role: 'office', store: 'OFFICE' }), [], 'accounting: was the first store (Store A) though not theirs');
  assert.deepEqual(cards('K', { role: 'office_crew', store: 'OFFICE', support: ['F02'] }), ['Store B'], 'a support store is shown');
  assert.deepEqual(cards('E', { role: 'ceo', store: 'F01', support: ['F03', 'F01', 'X9'] }), ['Store A', 'Store C'], 'own + support, no repeats, only real stores');
  assert.deepEqual(cards('A', { role: 'am', store: 'ALL' }), ['Store A', 'Store B', 'Store C'], 'AM: unchanged (empStoresOf)');
  assert.deepEqual(cards('S', { role: 'sl', store: 'F02', support: ['F03'] }), ['Store B', 'Store C'], 'store staff: unchanged');
  assert.deepEqual(cards('O2', { role: 'office', store: 'OFFICE' }, true), ['Store A'], 'someone else’s page (isManagerView): unchanged');
});
