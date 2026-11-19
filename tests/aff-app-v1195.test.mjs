// v1195（UI案96 の段階 2 の ①・Moto さん 11/18「1 B・2 A・3 A・4 A・5 B・6 B・7 B」）：所属の確認の画面（FUNERGY_AFF）。
// index.html の本物のコードを VM で動かす（合成データだけ・本番には接続しない・端末に何も残さない）。確かめること：
//  1. 理由：決まっていない／マスターと確かめた所属が違う／役割と所属が合わない（2A）／全店／空・不明／AM の管轄が所属・応援に無い
//  2. おすすめは控えめ（はっきりした所属はそのまま・全店や空は本部の役割と AM・Head Chef だけ本部・店の役割は GM・CEO が選ぶ）
//  3. 変わること（人ごと）：所属・応援・スキルマトリクス・店の一覧（全店 → 応援の店）・ログインの場所
//  4. 保存：先にサーバー（aff_save・人ごとの版）、そのあと従業員マスター（本部は OFFICE）。先に変わった人がいれば何も書かずに色を付けて残す。
//     サーバーに書けてマスターに書けないときは知らせる（もう一度書くボタン）。SQL の前・前の版の関数・通信・断られたときは何も書かない
//  5. GM・CEO だけ（店のログイン・ほかの役割にはカードを出さない）・ログインが変わったら写しを捨てる・名前はエスケープ
//  6. 前からの所属 OFFICE の扱い（自分の店を決める所だけ「特定の店ではない」）と、ssCall が関数の版（affn）を見ること
// 本物の関数（PGlite）との通しは tests/aff-server-v1195.test.mjs。ここでは関数の答えを合成する。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
function between(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); }
const AFF = between('/* ==== FUNERGY_AFF（v1195', '/* ==== FUNERGY_AFF end ==== */');
const HQ = between('\nvar EMP_HQ_STORE', '\n/* 店舗のスキルマトリクスに出す人');
const tick = () => new Promise(r => setImmediate(r));
async function settle() { await new Promise(r => setTimeout(r, 5)); for (let i = 0; i < 8; i++) await tick(); }

const STORES = [{ id: 'S1', name: 'Store One', am: 'Amy Area' }, { id: 'S2', name: 'Store Two', am: 'Amy Area' }, { id: 'S3', name: 'Store Three' },
  { id: 'S9', name: 'Closed', active: false }, { id: 'ALL', name: 'all' }, { id: 'OFFICE', name: 'Office' }];
const EMPS0 = () => [
  { id: 'E-GM', name: 'Gina M', role: 'gm', store: 'ALL', title: 'General Manager' },
  { id: 'E-OF', name: 'Ofelia', role: 'office', store: 'ALL', title: 'Accountant' },
  { id: 'E-OC', name: 'Oscar', role: 'office_crew', store: 'S1', title: 'Office Crew' },        // 本部の役割で店に所属＝合わない
  { id: 'E-AM', name: 'Amy Area', role: 'am', store: 'ALL', support: [], title: 'Area Manager' },
  { id: 'E-CH', name: 'Chet', role: 'chef', store: '', title: 'Head Chef' },
  { id: 'E-1', name: 'Kai One', role: 'crew', store: 'S1', support: ['S2'], title: 'Crew' },
  { id: 'E-2', name: 'Lea Two', role: 'crew', store: 'ALL', title: 'Crew' },                    // 店の役割で全店＝おすすめなし
  { id: 'E-3', name: 'Mo <b>Three</b>', role: 'sl', store: 'office', title: 'Store Leader' },   // 本部（小文字）で店の役割＝合わない
  { id: 'E-4', name: 'Nia Four', role: 'g4', store: 'S7', title: 'Store Manager' },             // 店舗マスターに無い店
  { id: 'E-X', name: 'Gone', role: 'crew', store: 'S1', status: '退職' },
  { id: 'E-OS', name: 'Off Switch', role: 'crew', store: 'S1', osDisabled: 'true' },
  { id: '_sys', name: 'System', role: 'crew', store: 'S1' },
];

function app(o = {}) {
  const c = {
    curRole: o.role || 'gm', curRealRole: o.role || 'gm', curStoreLogin: !!o.storeLogin, curUserName: o.user || 'Gina M', curLang: o.lang || 'ja', curPage: o.page || '',
    TOASTS: [], CALLS: [], WRITES: [], RENDERS: [], EMPS: o.emps || EMPS0(), STORES: (o.stores || STORES).map(s => ({ ...s })), LSFAIL: false, SS: o.ss || null, PHONE: !!o.phone,
    Date, JSON, Math, Object, Array, String, Number, Promise, setTimeout, clearTimeout, console,
  };
  vm.createContext(c);
  vm.runInContext(`
    var window = this;
    var MODAL = { html:'', open:false };
    var ELS = {};
    var document = {
      getElementById(id){
        if (id === 'aff-card') { if (!ELS[id]) ELS[id] = { innerHTML:'' }; return ELS[id]; }
        if (!MODAL.open) return null;
        if (id === 'aff-root') { if (!ELS[id]) ELS[id] = { innerHTML:'' }; return ELS[id]; }
        /* 中の部分は、いまの箱の HTML にその id があるときだけある（本物の DOM と同じ）。描き直した部分は ELS に残る */
        if (id === 'aff-list' || id === 'aff-tabs' || id === 'aff-bar') {
          if (!ELS['aff-root'] || ELS['aff-root'].innerHTML.indexOf('id="' + id + '"') < 0) return null;
          if (!ELS[id] || ELS[id].root !== ELS['aff-root'].innerHTML) ELS[id] = { innerHTML:'', root:ELS['aff-root'].innerHTML };
          return ELS[id];
        }
        return null;
      }
    };
    window.matchMedia = function(){ return { matches: PHONE }; };
    function t(ja, en){ return curLang === 'en' ? en : ja; }
    function showToast(m, k){ TOASTS.push([m, k]); }
    function openModal(h){ MODAL.html = h; MODAL.open = true; ELS['aff-root'] = { innerHTML: (h.split('<div id="aff-root">')[1] || '') }; }
    function closeModalDirect(){ MODAL.open = false; }
    function getEmployees(){ return EMPS; }
    function getStoresAll(){ return STORES.map(function(s){ return Object.assign({}, s); }); }
    function amStoresOf(n){ return STORES.filter(function(s){ return s.am === n; }).map(function(s){ return s.id; }); }
    var STORE_STAFF_ROLES = ['gm', 'am', 'g4', 'chef', 'sl', 'g2', 'crew'];
    function isStoreStaff(e) { return STORE_STAFF_ROLES.indexOf(e && e.role) >= 0; }
    function empGradeNum(){ return 0; }
    function lsSet(k, v){ if (LSFAIL) return false; WRITES.push([k, JSON.parse(JSON.stringify(v))]); if (k === 'm_employees') EMPS = JSON.parse(JSON.stringify(v)); return true; }
    function renderPage(p){ RENDERS.push(p); }
    var confirm = function(){ return true; };
    var _ssGen = 0;   /* ssOnLogout が進める世代（本物と同じ名前） */
    async function ssCall(p){ CALLS.push(JSON.parse(JSON.stringify(p))); return SS ? SS(p) : { status:400, error:'unknown_action' }; }
    ${HQ}
    ${AFF}
  `, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
const T = c => run(c, 'FUNERGY_AFF._t');
const E = c => run(c, 'FUNERGY_AFF._t.E()');
const emp = (c, id) => c.EMPS.find(e => e.id === id);
const ROW = (emp_id, aff, store, support, ver) => ({ emp_id, aff, store, support, ver, updated_at: '2026-11-18T10:00:00Z', by_name: 'Gina M' });
const full = (rows, log = []) => p => p.action === 'aff_full' ? { ok: true, j: { affn: 1, rows, log } } : { status: 400, error: 'unknown_action' };

test('release markers are 1195 or later and the same in the page and the service worker', () => {
  const a = src.match(/const APP_VERSION = '(\d+)';/), b = sw.match(/const SW_BUILD = '(\d+)';/);
  assert.ok(Number(a[1]) >= 1195); assert.equal(a[1], b[1]);
});

test('reasons: not decided, differs from the master, role and affiliation do not match (2A), all stores, empty or unknown, AM missing stores', async () => {
  const c = app({ ss: full([ROW('E-1', 'store', 'S1', ['S2'], 1), ROW('E-OF', 'hq', '', [], 2), ROW('E-3', 'store', 'S3', [], 1)]) });
  await T(c).load(); await settle();
  const R = id => Array.from(T(c).reasons(emp(c, id)));
  assert.deepEqual(R('E-1'), [], 'master S1 + S2 equals the row');
  assert.deepEqual(R('E-OF'), ['diff', 'all'], 'master ALL, row head office');
  assert.deepEqual(R('E-3'), ['diff', 'role'], 'master office (head office) with a store role, row S3');
  assert.deepEqual(R('E-GM'), ['none', 'all']);
  assert.deepEqual(R('E-OC'), ['none', 'role'], 'office crew in a store');
  assert.deepEqual(R('E-2'), ['none', 'role', 'all'], 'crew with all stores');
  assert.deepEqual(R('E-CH'), ['none', 'unknown']);
  assert.deepEqual(R('E-4'), ['none', 'unknown'], 'a store not in the store master');
  assert.deepEqual(R('E-AM'), ['none', 'all', 'am'], 'AM of S1 and S2 with neither as affiliation or support');
  // the support of the row and the master are compared as a set, ignoring the home store in the master support
  emp(c, 'E-1').support = ['S2', 'S1', 'S2'];
  assert.deepEqual(R('E-1'), []);
  emp(c, 'E-1').support = ['S3'];
  assert.deepEqual(R('E-1'), ['diff']);
  // head office in the row matches OFFICE / Office / 本部 / HQ / --- in the master
  for (const v of ['OFFICE', 'Office', '本部', 'hq', '---', ' office ']) { emp(c, 'E-OF').store = v; assert.deepEqual(R('E-OF'), [], v); }
  emp(c, 'E-OF').store = 'S1'; assert.deepEqual(R('E-OF'), ['diff', 'role']);
  // AM covered by affiliation + support has no 'am' reason
  emp(c, 'E-AM').store = 'S1'; emp(c, 'E-AM').support = ['S2'];
  assert.deepEqual(R('E-AM'), ['none']);
  // the counts on the card: people who are out, switched off or system ids are not counted
  const n = T(c).counts();
  assert.equal(n.need + n.done, 9, 'E-X (resigned), E-OS (osDisabled "true") and _sys are not listed');
});

test('suggestions are conservative: a clear affiliation stays, all/empty becomes head office only for office roles, AM and Head Chef, store roles are left to the GM', async () => {
  const c = app({ ss: full([]) });
  await T(c).load(); await settle();
  const S = id => { const s = T(c).suggest(emp(c, id)); return s ? JSON.parse(JSON.stringify(s)) : null; };
  assert.deepEqual(S('E-1'), { aff: 'store', store: 'S1', support: ['S2'] });
  assert.deepEqual(S('E-OC'), { aff: 'store', store: 'S1', support: [] }, 'a clear store stays (the role mismatch is shown, not fixed)');
  assert.deepEqual(S('E-3'), { aff: 'hq', store: '', support: [] }, 'a clear head office stays');
  assert.deepEqual(S('E-GM'), { aff: 'hq', store: '', support: [] });
  assert.deepEqual(S('E-OF'), { aff: 'hq', store: '', support: [] });
  assert.deepEqual(S('E-CH'), { aff: 'hq', store: '', support: [] });
  assert.deepEqual(S('E-AM'), { aff: 'hq', store: '', support: ['S1', 'S2'] }, 'AM keeps the assigned stores as support (1B: same stores as today)');
  assert.equal(S('E-2'), null, 'crew with all stores: the GM picks');
  assert.equal(S('E-4'), null, 'store manager in an unknown store: the GM picks');
  // "use suggestions" fills drafts only for people without a row and with a suggestion; nothing is saved
  run(c, 'FUNERGY_AFF.h.open()');
  run(c, 'FUNERGY_AFF.h.fill()');
  assert.deepEqual(Object.keys(E(c).draft).sort(), ['E-1', 'E-3', 'E-AM', 'E-CH', 'E-GM', 'E-OC', 'E-OF']);
  assert.equal(c.CALLS.filter(p => p.action === 'aff_save').length, 0);
  assert.equal(c.WRITES.length, 0);
});

test('what changes for each person: affiliation, support, skill matrix, store lists (all stores → support only), login location', async () => {
  const c = app({ ss: full([]) });
  await T(c).load(); await settle();
  const CH = (id, d) => Array.from(T(c).changes(emp(c, id), d));
  const am = CH('E-AM', { aff: 'hq', store: '', support: ['S1', 'S2'] });
  assert.ok(am.includes('所属：全店 → 本部'), am.join('|'));
  assert.ok(am.includes('応援：なし → Store One・Store Two'));
  assert.ok(am.includes('スキルマトリクスに出なくなる（本部）'));
  assert.ok(am.includes('店の一覧（シフト作成・AM の従業員マスター）：全店 → Store One・Store Two'), 'HQ people show only in their support stores');
  assert.ok(!am.some(x => x.startsWith('ログイン')), 'AM signs in from Office: no login line');
  const crew = CH('E-2', { aff: 'store', store: 'S3', support: [] });
  assert.ok(crew.includes('所属：全店 → Store Three'));
  assert.ok(crew.includes('店の一覧（シフト作成・AM の従業員マスター）：全店 → Store Three'));
  assert.ok(crew.includes('ログインで名前が出る場所：どこにも出ない → Store Three'), crew.join('|'));
  const sl = CH('E-3', { aff: 'store', store: 'S1', support: ['S2'] });
  assert.ok(sl.includes('所属：本部 → Store One'));
  assert.ok(sl.includes('スキルマトリクスに出る（Store One）'));
  assert.ok(sl.includes('ログインで名前が出る場所：どこにも出ない → Store One・Store Two'));
  const k = CH('E-1', { aff: 'store', store: 'S1', support: [] });
  assert.deepEqual(k, ['応援：Store Two → なし', '店の一覧から外れる：Store Two', 'ログインで名前が出る場所：Store One・Store Two → Store One']);
  assert.deepEqual(CH('E-1', { aff: 'store', store: 'S1', support: ['S2'] }), [], 'the same as the master: nothing changes');
  const off = CH('E-1', { aff: 'hq', store: '', support: [] });
  assert.ok(off.includes('ログインで名前が出る場所：Store One・Store Two → Office'), 'a store role in head office signs in from Office');
  // English
  c.curLang = 'en';
  assert.ok(Array.from(T(c).changes(emp(c, 'E-AM'), { aff: 'hq', store: '', support: [] })).includes('Affiliation: All stores → Head office'));
});

test('save: the server first (with the version per person), then the staff master (head office is OFFICE); only changed people are written', async () => {
  const rows = [ROW('E-1', 'store', 'S1', ['S2'], 3), ROW('E-OF', 'store', 'S1', [], 2)];
  let after = rows;
  const c = app({ ss: p => {
    if (p.action === 'aff_full') return { ok: true, j: { affn: 1, rows: after, log: [] } };
    if (p.action === 'aff_save') { after = [ROW('E-1', 'store', 'S1', ['S2'], 3), ROW('E-OF', 'hq', '', [], 3), ROW('E-AM', 'hq', '', ['S1', 'S2'], 1), ROW('E-2', 'store', 'S3', [], 1)]; return { ok: true, j: { affn: 1, ok: true, rows: [], same: 0 } }; }
    return { status: 400, error: 'unknown_action' };
  }, page: 'staff_master' });
  run(c, 'FUNERGY_AFF.h.open()'); await settle();
  const ix = id => E(c).ix.indexOf(id);
  run(c, 'FUNERGY_AFF.h.tab("need")');
  run(c, `FUNERGY_AFF.h.aff(${ix('E-OF')}, 'hq')`);
  run(c, `FUNERGY_AFF.h.sugg(${ix('E-AM')})`);
  run(c, `FUNERGY_AFF.h.aff(${ix('E-2')}, 'store')`);
  assert.equal(JSON.stringify(T(c).itemsOf()).includes('Pick a store') || typeof T(c).itemsOf() === 'string', true, 'a store role switched to store with no valid store must pick one');
  run(c, `FUNERGY_AFF.h.store(${ix('E-2')}, 'S3')`);
  run(c, `FUNERGY_AFF.h.supAdd(${ix('E-2')}, 'S3')`);   // the home store is not support
  run(c, `FUNERGY_AFF.h.supAdd(${ix('E-2')}, 'ALL')`);  // not a store
  run(c, 'FUNERGY_AFF.h.review()');
  assert.equal(E(c).view, 'confirm');
  run(c, 'FUNERGY_AFF.h.reason("確認しました")');
  run(c, 'FUNERGY_AFF.h.save()'); await settle();
  const sv = c.CALLS.find(p => p.action === 'aff_save');
  assert.deepEqual(sv.items.sort((a, b) => a.emp.localeCompare(b.emp)), [
    { emp: 'E-2', aff: 'store', store: 'S3', support: [], expect: 0 },
    { emp: 'E-AM', aff: 'hq', store: '', support: ['S1', 'S2'], expect: 0 },
    { emp: 'E-OF', aff: 'hq', store: '', support: [], expect: 2 },
  ]);
  assert.equal(sv.reason, '確認しました');
  assert.equal(c.WRITES.length, 1, 'the staff master is written once');
  const m = c.WRITES[0][1];
  assert.equal(c.WRITES[0][0], 'm_employees');
  assert.equal(m.find(e => e.id === 'E-OF').store, 'OFFICE');
  assert.deepEqual(m.find(e => e.id === 'E-AM').support, ['S1', 'S2']);
  assert.equal(m.find(e => e.id === 'E-AM').store, 'OFFICE');
  assert.equal(m.find(e => e.id === 'E-2').store, 'S3');
  assert.equal(m.find(e => e.id === 'E-1').store, 'S1', 'others unchanged');
  assert.equal(m.find(e => e.id === 'E-X').status, '退職', 'people who are out are kept as they are');
  assert.deepEqual(Object.keys(E(c).draft), [], 'drafts cleared');
  assert.ok(c.RENDERS.includes('staff_master'));
  assert.equal(c.CALLS.filter(p => p.action === 'aff_full').length, 2, 'reloaded after saving');
  assert.ok(c.TOASTS.some(x => /保存しました（3 人）/.test(x[0])));
  // after saving and reloading, these people are confirmed (no reasons)
  for (const id of ['E-OF', 'E-AM', 'E-2']) assert.deepEqual(Array.from(T(c).reasons(emp(c, id))), [], id);
});

test('confirming a person whose master already matches writes only the confirmation (the staff master is not rewritten); support is cleaned before sending', async () => {
  const c = app({ ss: p => p.action === 'aff_full' ? { ok: true, j: { affn: 1, rows: [], log: [] } }
    : p.action === 'aff_save' ? { ok: true, j: { affn: 1, ok: true, rows: [], same: 0 } } : { status: 400 } });
  run(c, 'FUNERGY_AFF.h.open()'); await settle();
  E(c).draft['E-1'] = { aff: 'store', store: 'S1', support: ['S2'] };
  assert.deepEqual(Array.from(T(c).changes(emp(c, 'E-1'), E(c).draft['E-1'])), []);
  assert.match(run(c, 'ELS["aff-root"].innerHTML') + run(c, 'FUNERGY_AFF.h.tab("done"), ELS["aff-root"].innerHTML'), /従業員マスターは変わりません/);
  run(c, 'FUNERGY_AFF.h.save()'); await settle();
  assert.equal(c.CALLS.filter(p => p.action === 'aff_save').length, 1);
  assert.equal(c.WRITES.length, 0, 'the staff master is not rewritten when nothing changes');
  // the home store, unknown stores, ALL / OFFICE and duplicates are not sent as support
  E(c).draft['E-OF'] = { aff: 'store', store: 'S2', support: ['S2', 'S7', 'ALL', 'OFFICE', 'S3', 'S3'] };
  const its = T(c).itemsOf();
  assert.deepEqual(JSON.parse(JSON.stringify(its.find(x => x.emp === 'E-OF').support)), ['S3']);
});

test('a person changed first by someone else: nothing written, the people are highlighted, the drafts are kept', async () => {
  const c = app({ ss: p => p.action === 'aff_full' ? { ok: true, j: { affn: 1, rows: [ROW('E-OF', 'hq', '', [], 4)], log: [] } }
    : p.action === 'aff_save' ? { status: 409, error: 'conflict', ids: ['E-OF'] } : { status: 400, error: 'unknown_action' } });
  run(c, 'FUNERGY_AFF.h.open()'); await settle();
  E(c).draft['E-GM'] = { aff: 'hq', store: '', support: [] };
  E(c).draft['E-OF'] = { aff: 'store', store: 'S1', support: [] };
  run(c, 'FUNERGY_AFF.h.save()'); await settle();
  assert.equal(c.WRITES.length, 0, 'the staff master is not written');
  assert.deepEqual(Array.from(E(c).conflict), ['E-OF']);
  assert.equal(E(c).band, 'conflict');
  assert.deepEqual(Object.keys(E(c).draft).sort(), ['E-GM', 'E-OF']);
  const root = run(c, 'ELS["aff-root"].innerHTML');
  assert.match(root, /ほかの人が先に変えた人がいるので、何も保存していません：Ofelia/);
  assert.match(root, /<tr class="cf"><td><b>Ofelia<\/b>/);
});

test('the server saved but the staff master could not be written: told, drafts cleared, and the row offers to write the master again', async () => {
  let rows = [];
  const c = app({ ss: p => p.action === 'aff_full' ? { ok: true, j: { affn: 1, rows, log: [] } }
    : p.action === 'aff_save' ? (rows = [ROW('E-GM', 'hq', '', [], 1)], { ok: true, j: { affn: 1, ok: true, rows: [], same: 0 } }) : { status: 400 } });
  run(c, 'FUNERGY_AFF.h.open()'); await settle();
  E(c).draft['E-GM'] = { aff: 'hq', store: '', support: [] };
  c.LSFAIL = true;
  run(c, 'FUNERGY_AFF.h.save()'); await settle();
  assert.equal(E(c).band, 'master');
  assert.deepEqual(Array.from(E(c).mfail), ['Gina M']);
  assert.ok(c.TOASTS.some(x => /従業員マスターに書けなかった人/.test(x[0])));
  assert.deepEqual(Array.from(T(c).reasons(emp(c, 'E-GM'))), ['diff', 'all'], 'still listed: master ALL, confirmed head office');
  const html = run(c, 'ELS["aff-root"].innerHTML');
  assert.match(html, /確かめた所属をマスターに書く/);
  c.LSFAIL = false;
  run(c, `FUNERGY_AFF.h.toMaster(${E(c).ix.indexOf('E-GM')})`);
  assert.equal(c.WRITES.length, 1);
  assert.equal(c.WRITES[0][1].find(e => e.id === 'E-GM').store, 'OFFICE');
  assert.equal(E(c).band, '');
  assert.deepEqual(Array.from(T(c).reasons(emp(c, 'E-GM'))), []);
});

test('before the SQL, an old function, a network error, refused or a shape error: nothing is written and the drafts are kept', async () => {
  const cases = [
    [{ ok: true, j: { affn: 1, nosql: true, rows: [], log: [] } }, null, 'nosql'],
    [{ legacy: true }, null, 'old'],
    [{ status: 400, error: 'unknown_action' }, null, 'old'],
    [{ net: true }, null, 'net'],
    [{ status: 403, error: 'forbidden' }, null, 'forbidden'],
    [{ none: true }, null, 'nosign'],
  ];
  for (const [ans, , code] of cases) {
    const c = app({ ss: () => ans });
    await T(c).load(); await settle();
    assert.equal(E(c).load, 'err', code); assert.equal(E(c).code, code);
    assert.ok(run(c, 'FUNERGY_AFF.cardHtml()').length > 0);
  }
  const saves = [[{ status: 503, error: 'not_installed' }, /SQL がまだ/], [{ legacy: true }, /v1195/], [{ status: 400, error: 'unknown_action' }, /v1195/],
    [{ status: 400, error: 'bad' }, /形が合わない/], [{ status: 404, error: 'not_found' }, /在籍でない人/], [{ status: 403, error: 'forbidden' }, /CEO・GM/], [{ net: true }, /通信/]];
  for (const [ans, re] of saves) {
    const c = app({ ss: p => p.action === 'aff_full' ? { ok: true, j: { affn: 1, rows: [], log: [] } } : ans });
    run(c, 'FUNERGY_AFF.h.open()'); await settle();
    E(c).draft['E-GM'] = { aff: 'hq', store: '', support: [] };
    run(c, 'FUNERGY_AFF.h.save()'); await settle();
    assert.equal(c.WRITES.length, 0, String(re));
    assert.deepEqual(Object.keys(E(c).draft), ['E-GM'], String(re));
    assert.ok(c.TOASTS.some(x => re.test(x[0])), String(re) + ' ' + JSON.stringify(c.TOASTS));
  }
});

test('GM and CEO only; a store sign-in or another role sees no card; a new sign-in drops the copy; names are escaped', async () => {
  for (const role of ['office', 'am', 'chef', 'sl']) {
    const c = app({ role });
    assert.equal(run(c, 'FUNERGY_AFF.cardHtml()'), '', role);
    run(c, 'FUNERGY_AFF.h.open()');
    assert.equal(c.CALLS.length, 0, role);
  }
  const s = app({ storeLogin: true });
  assert.equal(run(s, 'FUNERGY_AFF.cardHtml()'), '');
  const c = app({ role: 'ceo', user: 'Cal E', ss: full([ROW('E-1', 'store', 'S1', ['S2'], 1)]) });
  assert.match(run(c, 'FUNERGY_AFF.cardHtml()'), /id="aff-card"/);
  await settle();
  assert.equal(c.CALLS.filter(p => p.action === 'aff_full').length, 1, 'the card loads once');
  run(c, 'FUNERGY_AFF.cardHtml()'); await settle();
  assert.equal(c.CALLS.filter(p => p.action === 'aff_full').length, 1, 'not again');
  E(c).draft['E-GM'] = { aff: 'hq', store: '', support: [] };
  c.curUserName = 'Gina M'; c.curRole = 'gm'; c.curRealRole = 'gm';
  run(c, 'FUNERGY_AFF.cardHtml()');
  assert.deepEqual(Object.keys(E(c).draft), [], 'a different sign-in starts empty');
  assert.deepEqual(Object.keys(E(c).rows), []);
  await settle();
  // escaping: the name with HTML is shown as text
  run(c, 'FUNERGY_AFF.h.open()'); await settle();
  const html = run(c, 'ELS["aff-root"].innerHTML');
  assert.ok(html.includes('Mo &lt;b&gt;Three&lt;/b&gt;'));
  assert.ok(!html.includes('<b>Three</b>'));
  // the phone shows cards instead of the table
  const p = app({ phone: true, ss: full([]) });
  run(p, 'FUNERGY_AFF.h.open()'); await settle();
  const ph = run(p, 'ELS["aff-root"].innerHTML');
  assert.match(ph, /class="aff-card/); assert.ok(!ph.includes('<table class="aff-tbl">'));
});

test('a save returning after a new sign-in does nothing; more than 200 people or 20 support stores are refused before sending', async () => {
  let resolve;
  const c = app({ ss: p => p.action === 'aff_full' ? { ok: true, j: { affn: 1, rows: [], log: [] } } : new Promise(r => { resolve = r; }) });
  run(c, 'FUNERGY_AFF.h.open()'); await settle();
  E(c).draft['E-GM'] = { aff: 'hq', store: '', support: [] };
  run(c, 'FUNERGY_AFF.h.save()'); await settle();
  assert.equal(E(c).busy, true);
  c.curUserName = 'Cal E'; c.curRole = 'ceo';
  run(c, 'FUNERGY_AFF.cardHtml()');
  resolve({ ok: true, j: { affn: 1, ok: true, rows: [], same: 0 } }); await settle();
  assert.equal(c.WRITES.length, 0, 'the old answer is not used for the new sign-in');
  const many = app({ emps: Array.from({ length: 201 }, (_, i) => ({ id: 'P' + i, name: 'P' + i, role: 'crew', store: 'S1' })), ss: full([]) });
  run(many, 'FUNERGY_AFF.h.open()'); await settle();
  for (let i = 0; i < 201; i++) E(many).draft['P' + i] = { aff: 'store', store: 'S1', support: [] };
  assert.equal(typeof T(many).itemsOf(), 'string');
  run(many, 'FUNERGY_AFF.h.review()');
  assert.equal(E(many).view, 'list');
  const big = Array.from({ length: 22 }, (_, i) => 'S' + i);   // S1 is the home store: 21 support stores
  const sx = app({ ss: full([]), stores: STORES.concat(big.filter(id => !STORES.some(s => s.id === id)).map(id => ({ id, name: id }))) });
  run(sx, 'FUNERGY_AFF.h.open()'); await settle();
  E(sx).draft['E-1'] = { aff: 'store', store: 'S1', support: big.filter(x => x !== 'S1') };
  assert.match(String(T(sx).itemsOf()), /20/);
  E(sx).draft['E-1'] = { aff: 'store', store: 'S1', support: big.filter(x => x !== 'S1').slice(0, 20) };
  assert.equal(T(sx).itemsOf().length, 1, '20 support stores are fine');
});

test('the staff master shows the card for GM/CEO, the default-store places treat OFFICE like ALL, and ssCall checks affn for aff_ actions', () => {
  assert.ok(src.includes('<div class="sm-chk">${(window.FUNERGY_AFF?FUNERGY_AFF.cardHtml():\'\')}${renderInactiveCard()}'));
  assert.ok(src.includes("if (store && !empAnyStore(store) && typeof setWorkCondition==='function') {"));
  const c = app();
  for (const v of ['OFFICE', 'Office', ' office ', 'ALL']) assert.equal(run(c, `empAnyStore(${JSON.stringify(v)})`), true, v);
  for (const v of ['S1', '', null, '本部', 'all']) assert.equal(run(c, `empAnyStore(${JSON.stringify(v)})`), false, String(v));
  assert.equal(run(c, 'empStoreLabel("OFFICE")'), '本部');
  assert.equal(run(c, 'empStoreLabel("ALL")'), '全店');
  // the store label in the PIN list, the user list and the employee badge: OFFICE is shown as 本部, not the raw id
  assert.equal(src.split('empAnyStore(e.store)?empStoreLabel(e.store):').length - 1, 1);
  assert.ok(src.includes('_uStore = _uEmp ? (empAnyStore(_uEmp.store) ? empStoreLabel(_uEmp.store) :'), 'the user list label');
  assert.ok(src.includes("(empAnyStore(e.store)?empStoreLabel(e.store)+' · ':'')"));
  // ssCall: aff_ actions to a function without affn are "old" (nothing written); conflicts carry the people
  const ss = src.slice(src.indexOf('async function ssCall(payload, retried){'), src.indexOf('\n}', src.indexOf('async function ssCall(payload, retried){')));
  assert.match(ss, /if\(j\.affn!==1 && typeof payload\.action==='string' && payload\.action\.indexOf\('aff_'\)===0\) return \{ legacy:true \};/);
  assert.match(ss, /if\(Array\.isArray\(j\.ids\)\) _ro\.ids=j\.ids\.slice\(0, 200\)\.map\(String\);/);
  assert.ok(ss.indexOf('j.affn!==1') < ss.indexOf('if(!r.ok){'), 'checked before the error path (an old function says unknown_action)');
  // membership of the store lists keeps ALL only (no widening for AM): a few fixed spots
  assert.ok(!/empAnyStore\(e\.store\)\s*\|\|\s*S\.includes/.test(src));
});

// ---- Codex（#200 7002734955）・Claude のルーティン（7002642425）の直し ----
// いまの帯（下の「変える人」と「内容を確かめて保存」）：描き直した帯があればそれ、無ければ箱の HTML の中の帯
function barNow(c) {
  return run(c, `(function(){ var r = ELS['aff-root'] ? ELS['aff-root'].innerHTML : ''; var b = ELS['aff-bar'];
    if (b && b.root === r && b.innerHTML) return b.innerHTML;
    var i = r.indexOf('id="aff-bar">'); return i < 0 ? null : r.slice(i + 'id="aff-bar">'.length, r.indexOf('</div>', i)); })()`);
}
function reviewDisabled(c) {
  const m = String(barNow(c) || '').match(/<button class="btn btn-primary btn-sm"( disabled)? onclick="FUNERGY_AFF\.h\.review\(\)"/);
  assert.ok(m, 'the review button is in the bar'); return !!m[1];
}

test('P2-1: changing one person turns the bar on (count and the review button) without redrawing everything; undo turns it off again', async () => {
  for (const phone of [false, true]) {
    const c = app({ ss: full([]), phone });
    run(c, 'FUNERGY_AFF.h.open()'); await settle();
    assert.equal(reviewDisabled(c), true, 'nobody to change at first');
    assert.match(barNow(c), /変える人はまだいません/);
    const ix = id => E(c).ix.indexOf(id);
    const before = run(c, 'ELS["aff-root"].innerHTML');
    run(c, `FUNERGY_AFF.h.sugg(${ix('E-GM')})`);
    assert.equal(run(c, 'ELS["aff-root"].innerHTML'), before, 'only the parts are redrawn (the search box keeps focus)');
    assert.deepEqual(Object.keys(E(c).draft), ['E-GM']);
    assert.equal(reviewDisabled(c), false, 'the review button is on after one change (' + (phone ? 'phone' : 'PC') + ')');
    assert.match(barNow(c), /変える人 <b>1<\/b>/);
    assert.match(barNow(c), /FUNERGY_AFF\.h\.discard\(\)/, 'the reset button appears too');
    // each control: head office / store, store, support add / remove
    run(c, `FUNERGY_AFF.h.aff(${ix('E-2')}, 'store')`); run(c, `FUNERGY_AFF.h.store(${ix('E-2')}, 'S3')`);
    assert.match(barNow(c), /変える人 <b>2<\/b>/);
    run(c, `FUNERGY_AFF.h.supAdd(${ix('E-OF')}, 'S2')`);   // E-OF has no draft and a suggestion: support goes on top of it
    assert.match(barNow(c), /変える人 <b>3<\/b>/);
    run(c, `FUNERGY_AFF.h.undo(${ix('E-GM')})`); run(c, `FUNERGY_AFF.h.undo(${ix('E-2')})`); run(c, `FUNERGY_AFF.h.undo(${ix('E-OF')})`);
    assert.equal(reviewDisabled(c), true, 'off again when nobody is left');
    // pressing the (now enabled) button goes to the confirm view: the real flow, not a direct call
    run(c, `FUNERGY_AFF.h.sugg(${ix('E-GM')})`);
    assert.equal(reviewDisabled(c), false);
    run(c, 'FUNERGY_AFF.h.review()');
    assert.equal(E(c).view, 'confirm');
  }
});

test('P2-2: an answer that arrives after a sign-out (even the same person signing in again) is not used: no staff master write, no toast; load too', async () => {
  for (const how of ['onLogout', 'ssGen', 'sameAgain', 'other']) {
    let resolve;
    const c = app({ ss: p => p.action === 'aff_full' ? { ok: true, j: { affn: 1, rows: [], log: [] } } : new Promise(r => { resolve = r; }) });
    run(c, 'FUNERGY_AFF.h.open()'); await settle();
    E(c).draft['E-GM'] = { aff: 'hq', store: '', support: [] };
    run(c, 'FUNERGY_AFF.h.save()'); await settle();
    assert.equal(E(c).busy, true, how);
    const toasts = c.TOASTS.length;
    if (how === 'onLogout') run(c, 'FUNERGY_AFF.onLogout()');                     // doLogout → ssOnLogout → this (the card is not redrawn)
    if (how === 'ssGen') run(c, '_ssGen++');                                        // only the shared sign-out generation moved
    if (how === 'sameAgain') { run(c, 'FUNERGY_AFF.onLogout()'); run(c, 'FUNERGY_AFF.cardHtml()'); await settle(); }   // the same GM signs in again (its own load runs)
    if (how === 'other') { c.curUserName = 'Cal E'; c.curRole = 'ceo'; c.curRealRole = 'ceo'; }     // no redraw at all
    const fulls = c.CALLS.filter(p => p.action === 'aff_full').length;
    resolve({ ok: true, j: { affn: 1, ok: true, rows: [], same: 0 } }); await settle();
    assert.equal(c.WRITES.length, 0, how + ': no staff master write');
    assert.equal(c.TOASTS.length, toasts, how + ': no toast');
    assert.equal(E(c).busy, false, how + ': nothing is left busy');
    assert.equal(c.CALLS.filter(p => p.action === 'aff_full').length, fulls, how + ': not reloaded for the old login');
  }
  // load: a late answer of the old login does not fill the rows of the new one
  for (const how of ['onLogout', 'ssGen']) {
    let resolve;
    const c = app({ ss: p => p.action === 'aff_full' ? new Promise(r => { resolve = r; }) : { status: 400 } });
    run(c, 'FUNERGY_AFF.cardHtml()'); await settle();
    if (how === 'onLogout') run(c, 'FUNERGY_AFF.onLogout()'); else run(c, '_ssGen++');
    resolve({ ok: true, j: { affn: 1, rows: [ROW('E-GM', 'hq', '', [], 1)], log: [] } }); await settle();
    assert.deepEqual(Object.keys(E(c).rows), [], how + ': rows not filled');
    assert.notEqual(E(c).load, 'ok', how);
  }
  // the hook is in ssOnLogout (both copies of doLogout call it)
  const so = src.slice(src.indexOf('function ssOnLogout(){'), src.indexOf('\n}', src.indexOf('function ssOnLogout(){')));
  assert.match(so, /if\(window\.FUNERGY_AFF\) FUNERGY_AFF\.onLogout\(\);/);
  assert.equal(src.split("if(typeof ssOnLogout==='function') ssOnLogout();").length - 1, 2, 'both doLogout copies');
});

test('P2-2: a sign-in key that is rotated during the save (same login) does not drop the answer', async () => {
  let resolve;
  const c = app({ ss: p => p.action === 'aff_full' ? { ok: true, j: { affn: 1, rows: [], log: [] } } : new Promise(r => { resolve = r; }) });
  run(c, 'FUNERGY_AFF.h.open()'); await settle();
  E(c).draft['E-GM'] = { aff: 'hq', store: '', support: [] };
  run(c, 'FUNERGY_AFF.h.save()'); await settle();
  run(c, 'window._hwSession = "rotated-token"; FUNERGY_AFF.cardHtml()');
  resolve({ ok: true, j: { affn: 1, ok: true, rows: [], same: 0 } }); await settle();
  assert.equal(c.WRITES.length, 1, 'written');
});

test('P3-3: a 409 where the server already has what was sent (an earlier save whose answer was lost) writes the master and is not shown as someone else', async () => {
  // E-GM: the server already has head office (our lost save). E-OF: really changed by someone else. E-2: not in the conflict.
  let rows = [ROW('E-OF', 'hq', '', [], 1)];
  const c = app({ ss: p => {
    if (p.action === 'aff_full') return { ok: true, j: { affn: 1, rows, log: [] } };
    if (p.action === 'aff_save') { rows = [ROW('E-GM', 'hq', '', [], 1), ROW('E-OF', 'store', 'S2', [], 2)]; return { status: 409, error: 'conflict', ids: ['E-GM', 'E-OF'] }; }
    return { status: 400 };
  }, page: 'staff_master' });
  run(c, 'FUNERGY_AFF.h.open()'); await settle();
  E(c).draft['E-GM'] = { aff: 'hq', store: '', support: [] };
  E(c).draft['E-OF'] = { aff: 'store', store: 'S1', support: [] };
  E(c).draft['E-2'] = { aff: 'store', store: 'S3', support: [] };
  run(c, 'FUNERGY_AFF.h.save()'); await settle();
  assert.equal(c.WRITES.length, 1, 'the master is written for the person already on the server only');
  const m = c.WRITES[0][1];
  assert.equal(m.find(e => e.id === 'E-GM').store, 'OFFICE');
  assert.equal(m.find(e => e.id === 'E-OF').store, 'ALL', 'the real conflict is not written');
  assert.equal(m.find(e => e.id === 'E-2').store, 'ALL', 'others were not saved (all or nothing)');
  assert.deepEqual(Array.from(E(c).conflict), ['E-OF']);
  assert.equal(E(c).band, 'conflict');
  assert.deepEqual(Object.keys(E(c).draft).sort(), ['E-2', 'E-OF']);
  assert.ok(c.TOASTS.some(x => /同じ内容がもうサーバーに入っていた人がいます.*Gina M.*ほかの変更はまだ保存していません/.test(x[0])), JSON.stringify(c.TOASTS));
  assert.ok(c.TOASTS.some(x => /ほかの人が先に変えた人がいます/.test(x[0])));
  const root = run(c, 'ELS["aff-root"].innerHTML');
  assert.match(root, /何も保存していません：Ofelia/);
  assert.ok(!/何も保存していません：[^<]*Gina M/.test(root), 'not listed as changed by someone else');
  assert.deepEqual(Array.from(T(c).reasons(emp(c, 'E-GM'))), [], 'E-GM is confirmed and the master matches');
  // only the lost save: no conflict band at all
  let rows2 = [];
  const d = app({ ss: p => p.action === 'aff_full' ? { ok: true, j: { affn: 1, rows: rows2, log: [] } }
    : p.action === 'aff_save' ? (rows2 = [ROW('E-GM', 'hq', '', [], 1)], { status: 409, error: 'conflict', ids: ['E-GM'] }) : { status: 400 } });
  run(d, 'FUNERGY_AFF.h.open()'); await settle();
  E(d).draft['E-GM'] = { aff: 'hq', store: '', support: [] };
  run(d, 'FUNERGY_AFF.h.save()'); await settle();
  assert.equal(E(d).band, ''); assert.deepEqual(Array.from(E(d).conflict), []);
  assert.ok(!d.TOASTS.some(x => /ほかの人が先に変えた/.test(x[0])));
  assert.ok(d.TOASTS.some(x => /同じ内容がもうサーバーに入っていた人がいます.*Gina M$/.test(x[0])), JSON.stringify(d.TOASTS));
  assert.equal(d.WRITES.length, 1);
});

test('P2-3: a store role set to head office (OFFICE) who signs in at a support store keeps that store (PIN, passkey with the chosen place); OFFICE acts like ALL did', () => {
  const RLI = between('function resolveLoginIdentity(){', '\n/* ログイン画面表示前に');
  const FSL = between('function finishStaffLogin() {', '\n/* ===== ログイン時に最新データへ同期してから入る');
  const c = { EMPS: [], Object, Array, String, JSON };
  vm.createContext(c);
  vm.runInContext(`
    var curRole = '', curRealRole = '', curUserName = '', curStore = '', curStoreLogin = false, loginPerson = null, loginLocation = null, ENTERED = 0;
    function getEmployees(){ return EMPS; }
    function getStoresAll(){ return [{ id:'S1' }, { id:'S2' }]; }
    function _applyRole(r){ curRole = r; curRealRole = r; }
    function enterAppWithSync(){ ENTERED++; }
    ${HQ}
    ${FSL}
    ${RLI}
    /* PIN：場所を選ぶ → 名前 → PIN（finishStaffLogin）→ 同期のあと（resolveLoginIdentity） */
    function pin(emp, loc){ EMPS = [emp]; loginPerson = emp; loginLocation = loc; finishStaffLogin(); var a = curStore; resolveLoginIdentity(); return [a, curStore]; }
    /* 登録した端末・場所を選ばないパスキー：場所は empLoginLoc */
    function auto(emp){ return pin(emp, empLoginLoc(emp)); }
  `, c);
  const P = (e, loc) => JSON.parse(JSON.stringify(vm.runInContext(`pin(${JSON.stringify(e)}, ${JSON.stringify(loc)})`, c)));
  const A = e => JSON.parse(JSON.stringify(vm.runInContext(`auto(${JSON.stringify(e)})`, c)));
  const crew = store => ({ id: 'E-1', name: 'Kai', role: 'crew', store, support: ['S2'] });
  // the reported case: crew in head office signs in at the support store S2 → S2 (was OFFICE, not a store)
  assert.deepEqual(P(crew('OFFICE'), 'S2'), ['S2', 'S2']);
  for (const v of ['Office', ' office ', 'ALL']) assert.deepEqual(P(crew(v), 'S2'), ['S2', 'S2'], v);
  // a real home store stays as before (the home store, not the chosen support store)
  assert.deepEqual(P(crew('S1'), 'S2'), ['S2', 'S1']);
  // OFFICE place, managers: all stores as before
  assert.deepEqual(P(crew('OFFICE'), 'OFFICE'), ['ALL', 'ALL']);
  assert.deepEqual(P({ id: 'E-G', name: 'Gina', role: 'gm', store: 'S1' }, 'S1'), ['ALL', 'ALL']);
  // OFFICE behaves exactly like ALL for every role and place (PIN) and for the automatic place (device, passkey)
  for (const role of ['ceo', 'gm', 'am', 'office', 'chef', 'office_crew', 'g4', 'sl', 'g2', 'crew']) {
    for (const loc of ['OFFICE', 'S1', 'S2']) {
      const e = s => ({ id: 'E-9', name: 'N', role, store: s, support: ['S2'] });
      assert.deepEqual(P(e('OFFICE'), loc), P(e('ALL'), loc), role + ' ' + loc);
      assert.ok(!P(e('OFFICE'), loc).includes('OFFICE'), 'never OFFICE as the store: ' + role + ' ' + loc);
    }
    const e = s => ({ id: 'E-9', name: 'N', role, store: s, support: ['S2'] });
    assert.deepEqual(A(e('OFFICE')), A(e('ALL')), 'auto ' + role);
    assert.deepEqual(A(e('Office')), A(e('ALL')), 'auto lower-case ' + role);
  }
  // the automatic place itself
  const L = e => vm.runInContext(`empLoginLoc(${JSON.stringify(e)})`, c);
  assert.equal(L(crew('S1')), 'S1'); assert.equal(L(crew('OFFICE')), 'OFFICE'); assert.equal(L(crew('office')), 'OFFICE');
  assert.equal(L(crew('ALL')), 'OFFICE'); assert.equal(L(crew('')), 'OFFICE');
  assert.equal(L({ role: 'am', store: 'S1' }), 'OFFICE');
  // both automatic sign-ins use the one rule (device login, passkey)
  assert.equal(src.split('loginLocation = empLoginLoc(emp);').length - 1, 2);
  assert.ok(!src.includes("emp.store === 'OFFICE' || emp.store === 'ALL'"), 'the old copies are gone');
  assert.match(RLI, /curStore = \(emp\.store && !empAnyStore\(emp\.store\)\) \? emp\.store : loginLocation;/);
  // the error center tags an employee issue with a store only for a real store (not ALL / OFFICE)
  assert.ok(src.includes("var sid=(e.store && !empAnyStore(e.store)) ? e.store : '';"));
});
