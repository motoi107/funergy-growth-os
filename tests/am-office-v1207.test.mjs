// v1207（Moto さん 11/22「はい」）：本部（OFFICE）の人も、全店（ALL）の人と同じく全部の AM の一覧に出す。
// ただし本部の人の個人の欄（生年月日・カードの下 4 桁・保険の加入）は AM に出さない・直させない（Moto さん 11/23「C」）。
//  1. 入れる一式（deploy/am-office-v1207/）：secure-state の 1 ファイルが今のソースから作ったものと同じ・秘密の部分が無い・
//     モジュールの handler と同じ答え（AM の pii_get に本部の人は入らない・見られる人の ids）・v1197 の 1 ファイルとの違いは ids の数行だけ・手順の順番
//  2. アプリの AM の範囲（従業員マスター・退職の対象・スタッフの成長）：index.html の本物の関数を VM で動かす。シフト作成は ALL だけのまま
//  3. アプリの従業員の編集の画面：ids に無い人（本部の人など）の個人の欄を止める（本物の piiFormState・piiLoad を VM で）
// 合成データだけ（架空の人・店）。本番には接続しない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import { build, withoutTail, TAIL, OUT } from '../scripts/build-secure-state-one.mjs';
import { createHandler, PII_KEY } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, ts6 } from './lib/secure-state-world.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const D = 'deploy/am-office-v1207/';
const ONE = D + '1_関数_secure-state_index.ts';
const V1197 = 'deploy/page-view-tab-v1197/1_関数_secure-state_index.ts';

test('the one-file secure-state (v1207) stays as it was made, has no private part, and differs from v1197 only in the ids of pii_get (the AM scope stays)', () => {
  // Career Score Q4 の段階 3-1 から build() は deploy/career-score-q4-server/ に書く。v1207 の 1 ファイルは #213 で作ったときのまま（sha256 で固定）
  assert.notEqual(OUT, ONE, 'the build now writes into a later folder');
  assert.ok(build().length > 0);
  const one = rd(ONE);
  assert.equal(crypto.createHash('sha256').update(one).digest('hex'), 'fdcac7439776009857acbd813e1b4cc11f11bf5f00373db8bb4774132f1b60e7', 'the v1207 one file is as made in #213 (Moto 11/23 "C")');
  assert.ok(one.startsWith('// secure-state の 1 ファイル（v1207）'));
  assert.ok(one.endsWith(TAIL));
  assert.ok(!/^import\s/m.test(one), 'no import left');
  assert.ok(!/verifyPin/.test(one), 'no private part');
  assert.match(one, /affn: 1/); assert.match(one, /pvfn: 1/); assert.match(one, /ltfn: 1/); assert.match(one, /piifn: 1/);
  // AM の範囲は v1197 のまま（本部（OFFICE）は入れない＝Moto さん 11/23「C」）
  assert.match(one, /return st === 'ALL' \|\| S\.includes\(st\) \|\| sup\.some\(x => S\.includes\(String\(x\)\)\);/);
  assert.ok(!/toUpperCase\(\) === 'OFFICE'/.test(one), 'no OFFICE in the AM scope');
  // v1197（入れた 1 ファイル）と比べて、変わったのは全員の範囲の印（all）と pii_get の ids だけ（コメントと見出しの版の行も）
  const a = rd(V1197).split('\n'), b = one.split('\n');
  const removed = a.filter(x => !b.includes(x)), added = b.filter(x => !a.includes(x));
  const code = l => !/^\s*(\/\/|\/\*)/.test(l) && l.trim() !== '';
  const norm = l => l.trim().replace(/ all: (true|false),/, '').replace(/   \/\/ .*$/, '');
  const rem = removed.filter(code).map(norm), add = added.filter(code).map(norm);
  // all の印とコメントを外すと同じになる行（scope の 6 行）
  const same = rem.filter(x => add.includes(x));
  assert.equal(same.length, 6, JSON.stringify(rem));
  assert.deepEqual(rem.filter(x => !same.includes(x)), ['const data = {}, seen = new Set();', 'return { level: sc.lv, data, updated_at: row ? row.updated_at : null };']);
  assert.deepEqual(add.filter(x => !same.includes(x)), ['const data = {}, seen = new Set(), ids = [];', 'ids.push(id);',
    'const out = { level: sc.lv, data, updated_at: row ? row.updated_at : null };', 'if (!sc.all) out.ids = ids;']);
  assert.ok(removed.length <= 12 && added.length <= 20, 'only a few lines');
});

test('the one-file secure-state answers the same as the module handler (pii_get as an AM: ALL people and ids, no OFFICE person; pii_get as GM; pii_op as an AM on an OFFICE person is refused)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amoffice-one-test-'));
  try {
    const f = path.join(dir, 'one.mjs');
    fs.writeFileSync(f, withoutTail(rd(ONE)));
    const mod = await import(pathToFileURL(f).href);
    const emps = [
      { id: 'E-AM', name: 'Amy Area', store: 'S1', role: 'am', title: 'Area Manager', data: { store: 'S1' } },
      { id: 'E-GM', name: 'Gina M', store: 'ALL', role: 'gm', title: 'General Manager', data: { dob: '1970-01-01' } },
      { id: 'E-HQ', name: 'Hana HQ', store: 'OFFICE', role: 'office', title: 'Accountant', data: { dob: '1980-01-01', cardLast4: '1234', insuranceAmt: 300 } },
      { id: 'E-S1', name: 'Sue One', store: 'S1', role: 'crew', title: 'Crew', data: { dob: '1999-01-01' } },
      { id: 'E-S2', name: 'Sam Two', store: 'S2', role: 'crew', title: 'Crew', data: { dob: '1998-01-01' } },
    ];
    const pins = { tam: { emp: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1'], name: 'Amy Area', confirmed: true },
      tgm: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M' } };
    const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
    const run = async (mk, body) => {
      const W = makeWorld({ emps: JSON.parse(JSON.stringify(emps)), mgr: {}, users: {}, stores: [{ id: 'S1' }, { id: 'S2' }], wrPeople: [], pins });
      W.set(PII_KEY, {}, ts6(Date.UTC(2026, 10, 22, 9, 0, 0)));
      const h = mk({ env, fetch: W.fetch, now: () => Date.UTC(2026, 10, 22, 10, 0, 0) });
      const r = await h(new Request('https://fn.test/secure-state', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ANON }, body: JSON.stringify(body) }));
      return [r.status, await r.json(), W.get(PII_KEY)];
    };
    const cases = [{ action: 'pii_get', pin_session: 'tam' }, { action: 'pii_get', pin_session: 'tgm' },
      { action: 'pii_op', id: 'E-HQ', set: { cardLast4: '5678' }, base: { cardLast4: '1234' }, pin_session: 'tam' },
      { action: 'pii_op', id: 'E-S2', set: { dob: '' }, base: { dob: '1998-01-01' }, pin_session: 'tam' }];
    for (const body of cases) {
      const a = await run(mod.createHandler, body), b = await run(createHandler, body);
      const strip = x => JSON.parse(JSON.stringify(x, (k, v) => (k === '_at' ? '*' : k === 'cs4fn' ? undefined : v)));   // cs4fn：段階 3-1 から handler が付ける
      assert.deepEqual(strip(a), strip(b), JSON.stringify(body));
    }
    const am = await run(mod.createHandler, cases[0]);
    assert.deepEqual(Object.keys(am[1].data).sort(), ['E-GM', 'E-S1'], 'the AM: the store and ALL people; not OFFICE, not another store');
    assert.deepEqual(am[1].ids.slice().sort(), ['E-AM', 'E-GM', 'E-S1'], 'ids: who is in scope (the AM herself too)');
    assert.ok(!('insuranceAmt' in am[1].data['E-GM']), 'no amount for the AM');
    const gm = await run(mod.createHandler, cases[1]);
    assert.ok('E-HQ' in gm[1].data && !('ids' in gm[1]), 'GM: everybody, no ids');
    const hq = await run(mod.createHandler, cases[2]);
    assert.equal(hq[0], 403, 'the AM may not change an OFFICE person (Moto 11/23 "C")');
    assert.deepEqual(hq[2], {}, 'nothing written');
    assert.equal((await run(mod.createHandler, cases[3]))[0], 403, 'not another store');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the steps: the function first, then the merge and the devices; no SQL; going back is the v1197 one file', () => {
  const s = rd(D + '手順.md');
  const order = ['1. **関数 secure-state を差し替える**', '2. **PR をマージし、全部の端末を 1207 にする**', '## 戻すとき'];
  let at = -1; for (const x of order) { const i = s.indexOf(x); assert.ok(i > at, x); at = i; }
  assert.match(s, /deploy\/page-view-tab-v1197\/1_関数_secure-state_index\.ts/);
  assert.match(s, /SQL はありません/);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, D)).sort(), ['1_関数_secure-state_index.ts', '手順.md'].sort());
});

// ---- 2. アプリ：index.html の本物の関数を VM で ----
const src = rd('index.html').replace(/\r\n/g, '\n');
function fnSrc(name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name);
  const j = src.indexOf('\n}', i);
  return src.slice(i, j + 2);
}
const STAFF_FILTER = "emps = emps.filter(e=>empAnyStore(e.store)||myAmStores().includes(e.store)||(e.support||[]).some(s=>myAmStores().includes(s)));";
const SHIFT_FILTER = "var emps = getEmployees().filter(e=>e.status!=='退職' && (e.store===storeId || (e.support||[]).includes(storeId) || e.store==='ALL'));";
function app(role, emps) {
  const c = { curRole: role, curStore: 'S1', curUserName: 'Amy Area', EMPS: emps };
  vm.createContext(c);
  vm.runInContext(['function getEmployees(){ return EMPS.map(function(e){ return Object.assign({}, e); }); }',
    "function myAmStores(){ return ['S1']; }", fnSrc('empOfficeStore'), fnSrc('empAnyStore'), fnSrc('offboardEligibleEmps'), fnSrc('visibleStaffForManager'),
    'function staffMaster(){ var emps = getEmployees(); if (curRole===\'am\') { ' + STAFF_FILTER + ' } return emps.map(function(e){ return e.id; }).sort(); }',
    'function shiftList(storeId){ ' + SHIFT_FILTER + ' return emps.map(function(e){ return e.id; }).sort(); }'].join('\n'), c);
  return c;
}
const EMPS = [
  { id: 'E-ALL', name: 'Al All', role: 'gm', store: 'ALL', status: '在籍' },
  { id: 'E-HQ', name: 'Hana HQ', role: 'office', store: 'OFFICE', status: '在籍' },
  { id: 'E-HQ2', name: 'Hugo HQ', role: 'crew', store: ' office ', status: '在籍' },
  { id: 'E-HQS', name: 'Hal Support', role: 'crew', store: 'OFFICE', support: ['S1'], status: '在籍' },
  { id: 'E-HQX', name: 'Not Office', role: 'crew', store: 'OFFICES', status: '在籍' },
  { id: 'E-OLD', name: 'Old Hq', role: 'crew', store: '---', status: '在籍' },
  { id: 'E-S1', name: 'Sue One', role: 'crew', store: 'S1', status: '在籍' },
  { id: 'E-S2', name: 'Sam Two', role: 'crew', store: 'S2', status: '在籍' },
  { id: 'E-S2H', name: 'Hope Two', role: 'crew', store: 'S2', support: ['S1'], status: '在籍' },
  { id: 'E-OUT', name: 'Gone HQ', role: 'crew', store: 'OFFICE', status: '退職' },
];

test('the AM lists (staff master, offboarding targets, staff growth) show ALL and OFFICE people; shift building keeps ALL only', () => {
  assert.ok(src.includes(STAFF_FILTER), 'the staff master filter in index.html');
  assert.ok(src.includes(SHIFT_FILTER), 'the shift-building filter in index.html');
  const c = app('am', EMPS);
  const run = x => JSON.parse(JSON.stringify(vm.runInContext(x, c)));
  const AM = ['E-ALL', 'E-HQ', 'E-HQ2', 'E-HQS', 'E-S1', 'E-S2H'];
  assert.deepEqual(run('staffMaster()'), AM.concat(['E-OUT']).sort(), 'the staff master (the retired head-office person too, as before for ALL)');
  assert.deepEqual(run('offboardEligibleEmps().map(function(e){ return e.id; }).sort()'), AM);
  assert.deepEqual(run('visibleStaffForManager().map(function(e){ return e.id; }).sort()'), AM);
  // シフト作成：全店の人と店の人・応援の人だけ（本部の人は応援の店だけ・v1195 のまま）
  assert.deepEqual(run("shiftList('S1')"), ['E-ALL', 'E-HQS', 'E-S1', 'E-S2H']);
  // GM・CEO・経理は今までどおり全員（退職を除く）
  const g = app('gm', EMPS);
  assert.equal(JSON.parse(JSON.stringify(vm.runInContext('offboardEligibleEmps().length', g))), EMPS.filter(e => e.status !== '退職').length);
  assert.equal(JSON.parse(JSON.stringify(vm.runInContext('visibleStaffForManager().length', g))), EMPS.filter(e => e.status !== '退職').length);
});

test('the version is 1207 or later, the same in the page and the service worker', () => {
  // v1208（Career Score Q4 の段階 3-2）で版が上がった。1207 より前に戻っていないこと・ページと SW が同じことを見る
  const v = (src.match(/^const APP_VERSION = '(\d+)';/m) || [])[1], w = (rd('sw.js').match(/^const SW_BUILD = '(\d+)';/m) || [])[1];
  assert.ok(Number(v) >= 1207, v);
  assert.equal(v, w);
});

// ---- 3. アプリの従業員の編集の画面（Moto さん 11/23「C」）：本物の piiLoad・piiFormState を VM で ----
// 1 行の関数も取り出せるように、中かっこの数で終わりを決める（文字列の中のかっこは、この 6 つの関数には無い）
function fnBal(name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; }
  const k = src.slice(i - 6, i) === 'async ' ? i - 6 : i;
  return src.slice(k, j + 1);
}
function piiApp(answer) {
  const c = { curRole: 'am', curStoreLogin: false, PII_ROLES: ['ceo', 'gm', 'office', 'office_crew', 'am', 'chef', 'g4', 'sl', 'g2', 'crew'],
    PII_FN_KEY: 'k', calls: 0, ANSWER: answer, window: {} };
  c.localStorage = { getItem: () => '1' };
  vm.createContext(c);
  const pre = src.slice(src.indexOf('var _pii = {'), src.indexOf('\n', src.indexOf('var _pii = {')));
  vm.runInContext([pre, 'var _piiCard = {}; var _piiEnsureAt = 0; var _piiSeq = 0; var _piiChk = {};',
    "function ssToken(){ return { g:1, u:'U-AM', st:'', id:'E-AM' }; }", 'function ssStale(){ return false; }',
    'async function ssCall(p){ calls++; return JSON.parse(JSON.stringify(ANSWER)); }',
    'function t(ja){ return ja; }',
    fnBal('piiFnSeen'), fnBal('piiTid'), fnBal('piiWants'), fnBal('piiReady'), fnBal('piiLoad'), fnBal('piiFormState'),
    ...(src.includes('function piiRecheck(') ? [fnBal('piiUnsent'), fnBal('piiRecheck')] : [])].join('\n'), c);
  return c;
}
test('the edit screen: an AM sees the fields of people in ids; a head-office person outside ids is locked with a note; GM (no ids) and an old function (no ids) as before', async () => {
  const c = piiApp({ ok: true, j: { level: 'hr', data: { 'E-S1': { dob: '1999-01-01' } }, ids: ['E-AM', 'E-GM', 'E-S1'], updated_at: null } });
  assert.equal(await vm.runInContext('piiLoad(true)', c), 'ok');
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('_pii.ids', c))), ['E-AM', 'E-GM', 'E-S1']);
  const st = id => JSON.parse(JSON.stringify(vm.runInContext('piiFormState(' + JSON.stringify(id) + ')', c)));
  for (const id of ['E-S1', 'E-GM']) assert.deepEqual(st(id), { note: '', lock: false, lockAmt: true }, id + ' (in scope, even with empty fields)');
  // 本部の人（ids に無い）：初めて開いたときは止めたままサーバーに 1 回だけ確かめ直し（Codex #213 再レビュー P2）、一覧に無ければ止めたまま
  const before = c.calls;
  const hq0 = st('E-HQ');
  assert.equal(hq0.lock, true); assert.equal(hq0.lockAmt, true);
  assert.match(hq0.note, /サーバーに確かめています/);
  assert.equal(await vm.runInContext("_piiChk[piiTid()+'#E-HQ'].p", c), 'out');
  const hq = st('E-HQ');
  assert.equal(hq.lock, true); assert.equal(hq.lockAmt, true);
  assert.match(hq.note, /この人の生年月日・カード・保険は、このアカウントでは見る・直すことはできません/);
  st('E-HQ'); await new Promise((s) => setImmediate(s));
  assert.equal(c.calls, before + 1, 'once per login (no request on the next open)');
  assert.deepEqual(st(''), { note: '', lock: false, lockAmt: true }, 'a new person: as before (the server decides once the row is there)');
  // GM（ids なし）：全員そのまま
  const g = piiApp({ ok: true, j: { level: 'full', data: {}, updated_at: null } });
  g.curRole = 'gm';
  assert.equal(await vm.runInContext('piiLoad(true)', g), 'ok');
  assert.equal(vm.runInContext('_pii.ids', g), null);
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext("piiFormState('E-HQ')", g))), { note: '', lock: false, lockAmt: false });
  // 前の版の関数（ids を返さない）：今までどおり止めない（保存すればサーバーが 403）
  const o = piiApp({ ok: true, j: { level: 'hr', data: {}, updated_at: null } });
  assert.equal(await vm.runInContext('piiLoad(true)', o), 'ok');
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext("piiFormState('E-HQ')", o))), { note: '', lock: false, lockAmt: true });
  // ログアウトで ids も消える
  assert.ok(src.includes("function piiOnLogout(){ _pii={ tid:'', lv:'', map:null, ids:null, at:0, p:null };"));
});

// ---- 4. Codex（#213 7108122960）P2：AM が新しい人を登録して個人の欄の保存に成功したあと、もう一度開くと「担当の店の外」で止まる ----
// 本物の piiLoad・piiPut・piiSave・piiFormState を VM で。サーバーの答えは合成（action ごと・遅らせられる）
function piiApp2() {
  const c = { curRole: 'am', curStoreLogin: false, PII_ROLES: ['ceo', 'gm', 'office', 'office_crew', 'am', 'chef', 'g4', 'sl', 'g2', 'crew'],
    PII_FN_KEY: 'k', window: {}, TOK: 'A', Q: [], log: [], DIRTY: {}, PUSH: null, PUSHES: 0, FILLS: [] };
  c.localStorage = { getItem: () => '1' };
  vm.createContext(c);
  const pre = src.slice(src.indexOf('var _pii = {'), src.indexOf('\n', src.indexOf('var _pii = {')));
  const fns = ['piiFnSeen', 'piiTid', 'piiWants', 'piiReady', 'piiLoad', 'piiPut', 'piiSave', 'piiFormState']
    .concat(src.includes('function piiRecheck(') ? ['piiUnsent', 'piiRecheck'] : []);
  const seq = src.includes('var _piiSeq') ? src.slice(src.indexOf('var _piiSeq'), src.indexOf('\n', src.indexOf('var _piiSeq'))) : '';
  const skip = src.slice(src.indexOf('var PII_FIELDS'), src.indexOf('\n', src.indexOf('var PII_SKIP')));
  vm.runInContext([skip, pre, 'var _piiCard = {}; var _piiEnsureAt = 0; var _piiChk = {};', seq,
    // ログインは TOK（A／B）。ssStale は頼んだときのログインと今が違うか
    "function ssToken(){ return { g:1, u:'U-'+TOK, st:'', id:'E-AM' }; }", 'function ssStale(tk){ return tk.u !== ssToken().u; }',
    // ssCall：Q の先頭の答えを使う（{ action, r, wait }）。wait があれば Promise を返して、あとで解く
    'async function ssCall(p){ log.push(p.action); var a = Q.shift(); if(!a || a.action !== p.action) throw new Error("unexpected " + p.action); if(a.wait) await a.wait; return JSON.parse(JSON.stringify(a.r)); }',
    'function t(ja){ return ja; }', 'function showToast(){}', 'function insTotalsRefresh(){}',
    // 社員の行を送る（PUSH で遅らせる・失敗させる）・送れていない行（DIRTY・新しい人は n）・開いている画面の描き直し（FILLS）
    'async function empPushDirty(){ PUSHES++; return PUSH ? await PUSH() : true; }', 'function _empDirtyGet(){ return DIRTY; }', 'function piiFormFill(id){ FILLS.push(id); }',
    ...fns.map(fnBal)].join('\n'), c);
  return c;
}
const GET = (ids, data = {}) => ({ action: 'pii_get', r: { ok: true, j: { level: 'hr', data, ids, updated_at: null } } });
const OK = (id) => ({ action: 'pii_op', r: { ok: true, j: { entry: { dob: '2000-02-02' }, level: 'hr' } } });
const stOf = (c, id) => JSON.parse(JSON.stringify(vm.runInContext('piiFormState(' + JSON.stringify(id) + ')', c)));
const defer = () => { let res; const p = new Promise((r) => { res = r; }); return { p, res }; };
const tick = () => new Promise((s) => setImmediate(s));
// ids に無い人を開いたときの確かめ直し（Codex #213 再レビュー P2）の終わりを待つ（直す前のコードには無い：null）
const chkP = (c, id) => vm.runInContext("typeof _piiChk === 'undefined' ? null : ((_piiChk[piiTid() + '#' + " + JSON.stringify(id) + "] || {}).p || null)", c);
// 開いて（確かめ直しが要るならサーバーの答えを 1 つ用意して）確かめ終わるまで待つ
const openSettled = async (c, id, ans) => { if (ans) c.Q.push(ans); const s0 = stOf(c, id); await chkP(c, id); await tick(); return { first: s0, now: stOf(c, id) }; };

test('Codex #213 P2：AM が新しい人を登録して保存できたら、読み直す前でももう一度開いて直せる（担当の外・失敗・ログインの切り替えでは増えない）', async () => {
  // 1) 新しい人 → 保存に成功 → 自分の変更の合図より前にもう一度開く（前は「担当の店の外」で止まっていた）
  const c = piiApp2();
  c.Q.push(GET(['E-AM', 'E-S1']));
  assert.equal(await vm.runInContext('piiLoad(true)', c), 'ok');
  assert.equal((await openSettled(c, 'E-NEW', GET(['E-AM', 'E-S1']))).now.lock, true, '保存の前は止まる（サーバーの一覧に無い）');
  c.Q.push(OK('E-NEW'));
  assert.equal(await vm.runInContext("piiSave('E-NEW', { dob:'2000-02-02' }, {}, true)", c), true);
  assert.deepEqual(stOf(c, 'E-NEW'), { note: '', lock: false, lockAmt: true }, '保存できた人はもう一度開いて直せる');
  assert.equal(vm.runInContext("_pii.map['E-NEW'].dob", c), '2000-02-02');
  // 自分の変更の合図で読み直し（サーバーの一覧に入っている）→ そのまま
  c.Q.push(GET(['E-AM', 'E-S1', 'E-NEW'], { 'E-NEW': { dob: '2000-02-02' } }));
  assert.equal(await vm.runInContext('piiLoad(true)', c), 'ok');
  assert.equal(stOf(c, 'E-NEW').lock, false);
  // 担当の外（本部の人）は止まったまま（確かめ直しても一覧に無い）
  assert.equal((await openSettled(c, 'E-HQ', GET(['E-AM', 'E-S1', 'E-NEW']))).now.lock, true);

  // 2) 保存の前に始まった読み直しが、保存のあとに古い一覧で返っても、保存できた人を外さない
  const d = piiApp2();
  d.Q.push(GET(['E-AM']));
  await vm.runInContext('piiLoad(true)', d);
  const late = defer();
  d.Q.push({ ...GET(['E-AM']), wait: late.p });
  const pending = vm.runInContext('piiLoad(true)', d);
  d.Q.push(OK('E-NEW2'));
  assert.equal(await vm.runInContext("piiSave('E-NEW2', { dob:'2000-02-02' }, {}, true)", d), true);
  late.res(); assert.equal(await pending, 'ok');
  assert.equal(stOf(d, 'E-NEW2').lock, false, '古い読み直しで止めに戻らない');
  assert.equal(vm.runInContext("_pii.map['E-NEW2'] && _pii.map['E-NEW2'].dob", d), '2000-02-02', '保存した欄も消えない');
  // 保存のあとに始めた読み直しは、サーバーの答えそのまま（外されたら外れる）
  d.Q.push(GET(['E-AM']));
  await vm.runInContext('piiLoad(true)', d);
  assert.equal((await openSettled(d, 'E-NEW2', GET(['E-AM']))).now.lock, true, '保存のあとに読んだ一覧に無ければ止める（サーバーが正）');

  // 3) 失敗・403・競合では増えない
  for (const r of [{ ok: false, status: 500 }, { ok: false, status: 403 }, { ok: false, status: 409 }, { ok: false, net: true, status: 0 }]) {
    const e = piiApp2();
    e.Q.push(GET(['E-AM']));
    await vm.runInContext('piiLoad(true)', e);
    e.Q.push({ action: 'pii_op', r });
    if (r.status === 409) e.Q.push(GET(['E-AM']));   // 競合のあとの読み直し（今までどおり）
    const out = await vm.runInContext("piiSave('E-X', { dob:'2000-02-02' }, {}, true)", e);
    assert.notEqual(out, true, JSON.stringify(r));
    await tick();
    assert.equal((await openSettled(e, 'E-X', GET(['E-AM']))).now.lock, true, '失敗のあとも止まる ' + JSON.stringify(r));
    assert.equal(vm.runInContext("_pii.map['E-X']", e), undefined);
  }

  // 4) ログインの切り替え：A で保存を始め、答えの前に B に替わる → A の答えで B の一覧に足さない
  const f = piiApp2();
  f.Q.push(GET(['E-AM']));
  await vm.runInContext('piiLoad(true)', f);
  const slow = defer();
  f.Q.push({ ...OK('E-NEW3'), wait: slow.p });
  const save = vm.runInContext("piiSave('E-NEW3', { dob:'2000-02-02' }, {}, true)", f);
  await new Promise((s) => setImmediate(s));
  assert.equal(f.log[f.log.length - 1], 'pii_op', '保存を送ってから切り替える');
  f.TOK = 'B';
  f.Q.push(GET(['E-AM']));
  await vm.runInContext('piiLoad(true)', f);
  slow.res();
  assert.equal(await save, 'failed', '古いログインの遅れた答えは使わない');
  assert.equal((await openSettled(f, 'E-NEW3', GET(['E-AM']))).now.lock, true, 'B の一覧は増えない');
  // B の読み直しのあとに A の遅れた読み直しが来ても使わない（今までどおり ssStale）
});

test('Codex #213 P2：応援の店の人（サーバーの一覧にいる）はそのまま・前の版の関数（ids なし）と GM は今までどおり', async () => {
  const c = piiApp2();
  c.Q.push(GET(['E-AM', 'E-SUP']));   // 応援が担当の店の人はサーバーが ids に入れる
  await vm.runInContext('piiLoad(true)', c);
  assert.equal(stOf(c, 'E-SUP').lock, false);
  const o = piiApp2();
  o.Q.push({ action: 'pii_get', r: { ok: true, j: { level: 'hr', data: {}, updated_at: null } } });
  await vm.runInContext('piiLoad(true)', o);
  o.Q.push(OK('E-NEW'));
  assert.equal(await vm.runInContext("piiSave('E-NEW', { dob:'2000-02-02' }, {}, true)", o), true);
  assert.equal(vm.runInContext('_pii.ids', o), null, 'ids の無い前の版の関数では一覧を作らない');
  assert.equal(stOf(o, 'E-HQ').lock, false);
});

// ---- 5. Codex（#213 7111705389）再レビュー P2：個人の欄を空のまま登録した人（piiSave を通らない）を、同じタブでもう一度開くと「担当の店の外」で止まる ----
// 直し：ids に無い人を開いたら、社員の行を送ってからサーバーに 1 回だけ確かめ直す（止めたまま・答えで描き直す）。ids に足すのはサーバーの答えだけ
const pget = (c) => c.log.filter((x) => x === 'pii_get').length;
async function amReady(ids = ['E-AM', 'E-S1']) {
  const c = piiApp2();
  c.Q.push(GET(ids));
  assert.equal(await vm.runInContext('piiLoad(true)', c), 'ok');
  return c;
}

test('Codex #213 再レビュー P2：個人の欄なしで登録 → 同じタブでもう一度開くと、確かめ終わったら直せる（社員の行が遅れて届く場合も）', async () => {
  const c = await amReady();
  c.DIRTY = { 'E-NEW': { n: 1, f: { name: 'New Person', store: 'S1' } } };   // saveEmp が送る前の新しい行
  const late = defer();
  c.PUSH = async () => { await late.p; c.DIRTY = {}; return true; };          // 社員の行が遅れて届く
  const s0 = stOf(c, 'E-NEW');
  assert.equal(s0.lock, true, '確かめ終わるまで止める');
  assert.match(s0.note, /サーバーに確かめています/);
  await tick();
  assert.equal(pget(c), 1, '社員の行が届くまで読み直さない（届く前の一覧では決めない）');
  assert.equal(stOf(c, 'E-NEW').lock, true, '送っているあいだも止めたまま');
  c.Q.push(GET(['E-AM', 'E-S1', 'E-NEW']));
  late.res();
  assert.equal(await chkP(c, 'E-NEW'), 'in');
  assert.equal(pget(c), 2, '行が届いてから 1 回だけ読み直す');
  assert.deepEqual(stOf(c, 'E-NEW'), { note: '', lock: false, lockAmt: true }, 'もう一度開くと直せる');
  assert.ok(c.FILLS.includes('E-NEW'), '開いたままの画面を描き直す（piiFormFill）');
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('_pii.ids', c))), ['E-AM', 'E-S1', 'E-NEW'], 'ids はサーバーの答えのまま');

  // 保存の直後（saveEmp が開く前に確かめ直す）：もう一度開いたときは待たずに直せる
  const e = await amReady();
  e.DIRTY = { 'E-NEW': { n: 1, f: { name: 'New Person' } } };
  e.PUSH = async () => { e.DIRTY = {}; return true; };
  e.Q.push(GET(['E-AM', 'E-S1', 'E-NEW']));
  assert.equal(await vm.runInContext("piiRecheck('E-NEW')", e), 'in');
  assert.deepEqual(stOf(e, 'E-NEW'), { note: '', lock: false, lockAmt: true });
  assert.equal(pget(e), 2);
  // saveEmp：個人の欄を変えずに登録した新しい人は piiRecheck を呼ぶ（変えた人は今までどおり piiSave）
  assert.ok(src.includes("if(_piiCh && _seP) piiSave(_seP.id, _piiCh.set, _piiCh.base, !empId);\n    /* Codex #213 再レビュー P2"));
  assert.ok(src.includes("else if(!empId && _seP && typeof piiRecheck==='function') piiRecheck(_seP.id); }catch(e){}"));
});

test('Codex #213 再レビュー P2：社員の行を送れない・読めない・本部の人・ログインの切り替えでは止めたまま（ids を端末で足さない）', async () => {
  // 社員の行を送れない（同期の失敗）：読み直さず「まだ届いていない」・15 秒たてば開き直しでもう一度
  const c = await amReady();
  c.DIRTY = { 'E-NEW': { n: 1, f: { name: 'New Person' } } };
  c.PUSH = async () => false;
  const r1 = await openSettled(c, 'E-NEW');
  assert.equal(r1.now.lock, true);
  assert.match(r1.now.note, /社員の行がまだサーバーに届いていない/);
  assert.equal(pget(c), 1, '届いていない行のために読み直さない');
  assert.ok(!vm.runInContext('_pii.ids', c).includes('E-NEW'), '端末の新しい ID を足さない');
  stOf(c, 'E-NEW'); await tick();
  assert.equal(c.PUSHES, 1, '15 秒たつまで開き直しても送り直さない');
  vm.runInContext("_piiChk[piiTid() + '#E-NEW'].at -= 20000", c);
  c.PUSH = async () => { c.DIRTY = {}; return true; };
  const r2 = await openSettled(c, 'E-NEW', GET(['E-AM', 'E-S1', 'E-NEW']));
  assert.equal(r2.first.lock, true);
  assert.equal(r2.now.lock, false, '届いたあとは直せる');

  // 読めない（pii_get が 500）：止めたまま「確かめられませんでした」・15 秒たてばもう一度
  const f = await amReady();
  const r3 = await openSettled(f, 'E-NEW', { action: 'pii_get', r: { ok: false, status: 500 } });
  assert.equal(r3.now.lock, true);
  assert.match(r3.now.note, /確かめられませんでした/);
  stOf(f, 'E-NEW'); await tick();
  assert.equal(pget(f), 2, '15 秒たつまで読み直さない');
  vm.runInContext("_piiChk[piiTid() + '#E-NEW'].at -= 20000", f);
  assert.equal((await openSettled(f, 'E-NEW', GET(['E-AM', 'E-S1', 'E-NEW']))).now.lock, false);

  // 本部の人（担当の外）：確かめても一覧に無い → 止めたまま・このログインではもう聞かない
  const h = await amReady();
  const r4 = await openSettled(h, 'E-HQ', GET(['E-AM', 'E-S1']));
  assert.equal(r4.now.lock, true);
  assert.match(r4.now.note, /本部の人など、担当の店の外の人/);
  stOf(h, 'E-HQ'); stOf(h, 'E-HQ'); await tick();
  assert.equal(pget(h), 2, '1 回だけ');
  assert.ok(!vm.runInContext('_pii.ids', h).includes('E-HQ'));

  // ログインの切り替え：A の確かめ直しの答えが B のあとに届いても使わない。B は B で確かめる
  const g = await amReady();
  g.DIRTY = { 'E-NEW': { n: 1, f: { name: 'New Person' } } };
  g.PUSH = async () => { g.DIRTY = {}; return true; };
  const slow = defer();
  g.Q.push({ ...GET(['E-AM', 'E-S1', 'E-NEW']), wait: slow.p });
  stOf(g, 'E-NEW'); await tick();
  g.TOK = 'B';
  g.Q.push(GET(['E-AM']));
  assert.equal(await vm.runInContext('piiLoad(true)', g), 'ok');
  slow.res(); await tick(); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('_pii.ids', g))), ['E-AM'], 'A の答えで B の一覧を変えない');
  assert.equal((await openSettled(g, 'E-NEW', GET(['E-AM']))).now.lock, true, 'B の答えでは担当の外');
  // ログアウトで確かめ直しの結果も消す
  assert.ok(src.includes('_piiEnsureAt=0; _piiChk={}; piiPurgeLocal(); }'));
});

test('Codex #213 再レビュー P2：確かめ直しは、社員の行を送る前に始まっていた読みの答えを使わない（終わるのを待ってから読み直す）', async () => {
  const c = await amReady();
  c.DIRTY = { 'E-NEW': { n: 1, f: { name: 'New Person' } } };
  c.PUSH = async () => { c.DIRTY = {}; return true; };
  const old = defer();
  c.Q.push({ ...GET(['E-AM', 'E-S1']), wait: old.p });       // 送る前に始まった読み（新しい人がまだいない）
  const pending = vm.runInContext('piiLoad(true)', c);
  await tick();
  c.Q.push(GET(['E-AM', 'E-S1', 'E-NEW']));                    // 送ったあとの読み
  const r = vm.runInContext("piiRecheck('E-NEW')", c);
  await tick();
  old.res();
  assert.equal(await pending, 'ok');
  assert.equal(await r, 'in');
  assert.equal(pget(c), 3, '前の読みが終わってから、もう 1 回読む');
  assert.equal(stOf(c, 'E-NEW').lock, false);
});
