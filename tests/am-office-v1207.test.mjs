// v1207（Moto さん 11/22「はい」）：本部（OFFICE）の人も、全店（ALL）の人と同じく全部の AM に見せる。
//  1. 入れる一式（deploy/am-office-v1207/）：secure-state の 1 ファイルが今のソースから作ったものと同じ・秘密の部分が無い・
//     モジュールの handler と同じ答え（AM の pii_get に本部の人）・v1197 の 1 ファイルとの違いは piiScope の 1 行だけ・手順の順番
//  2. アプリの AM の範囲（従業員マスター・退職の対象・スタッフの成長）：index.html の本物の関数を VM で動かす。シフト作成は ALL だけのまま
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

test('the one-file secure-state (v1207) is what the build script makes now, has no private part, and differs from v1197 only in the AM scope of piiScope', () => {
  // Career Score Q4 の段階 3-1 から build() は deploy/career-score-q4-server/ に書く。v1207 の 1 ファイルは Moto さんに渡したときのまま（sha256 で固定）
  assert.notEqual(OUT, ONE, 'the build now writes into a later folder');
  assert.ok(build().length > 0);
  const one = rd(ONE);
  assert.equal(crypto.createHash('sha256').update(one).digest('hex'), '725f84868e66cf2048ad158745fc4a40828b8fa224d9a339fbf66614494bef20', 'the v1207 one file is as handed over');
  assert.ok(one.startsWith('// secure-state の 1 ファイル（v1207）'));
  assert.ok(one.endsWith(TAIL));
  assert.ok(!/^import\s/m.test(one), 'no import left');
  assert.ok(!/verifyPin/.test(one), 'no private part');
  assert.match(one, /affn: 1/); assert.match(one, /pvfn: 1/); assert.match(one, /ltfn: 1/); assert.match(one, /piifn: 1/);
  assert.match(one, /return st === 'ALL' \|\| st\.trim\(\)\.toUpperCase\(\) === 'OFFICE' \|\| S\.includes\(st\)/);
  // v1197（入れた 1 ファイル）と比べて、変わった行はコメントと piiScope の AM の 1 行だけ（見出しの版の行も）
  const a = rd(V1197).split('\n'), b = one.split('\n');
  const removed = a.filter(x => !b.includes(x)), added = b.filter(x => !a.includes(x));
  const code = l => !/^\s*(\/\/|\/\*)/.test(l) && l.trim() !== '';
  assert.deepEqual(removed.filter(code).map(s => s.trim()), ["if (a.role === 'am') {   // 担当の店（応援も）と本部（ALL）の人：アプリの従業員マスターの絞り込みと同じ",
    "return st === 'ALL' || S.includes(st) || sup.some(x => S.includes(String(x)));"]);
  assert.deepEqual(added.filter(code).map(s => s.trim()), ["if (a.role === 'am') {   // 担当の店（応援も）と全店（ALL）・本部（OFFICE・v1207 から）の人：アプリの従業員マスターの絞り込みと同じ",
    "return st === 'ALL' || st.trim().toUpperCase() === 'OFFICE' || S.includes(st) || sup.some(x => S.includes(String(x)));"]);
  assert.ok(removed.length <= 4 && added.length <= 5, 'only a few lines');
});

test('the one-file secure-state answers the same as the module handler (pii_get as an AM: ALL and OFFICE people; pii_get as GM; pii_op as an AM on an OFFICE person)', async () => {
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
    assert.deepEqual(Object.keys(am[1].data).sort(), ['E-GM', 'E-HQ', 'E-S1'], 'the AM: the store, ALL and OFFICE people; not another store');
    assert.ok(!('insuranceAmt' in am[1].data['E-HQ']), 'no amount for the AM');
    assert.equal((await run(mod.createHandler, cases[2]))[0], 200, 'the AM may change an OFFICE person');
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
