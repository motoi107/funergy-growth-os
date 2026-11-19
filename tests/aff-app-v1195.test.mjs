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
        if (id === 'aff-root' || id === 'aff-list' || id === 'aff-tabs' || id === 'aff-card') { if (!ELS[id]) ELS[id] = { innerHTML:'' }; return (id === 'aff-card' || MODAL.open) ? ELS[id] : null; }
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
