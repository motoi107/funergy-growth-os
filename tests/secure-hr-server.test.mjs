// secure-state v1142（2b の 4 つ目）の関数：採用（応募者・不採用ログ）とお悩み相談室。
// 見られる範囲はサーバーが決める（今の画面と同じ。Moto さん 11/04）。書くのは 1 件ずつ（hr_op）。
// 合成データだけ（架空の人・店・応募者）。PostgREST・Auth・work-requests は tests/lib/secure-state-world.mjs の偽物。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHandler, hrIsKey, HR_KEYS, hrApClean, hrMatches, hrPrior, ssIsKey, csIsKey, swIsKey } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, JWT, ts6 } from './lib/secure-state-world.mjs';

const STORES = [
  { id: 'S1', name: 'Alpha Kaimuki', brand: 'Alpha' },
  { id: 'S2', name: 'Beta Ward', brand: 'Beta' },
  { id: 'S3', name: 'Alpha Aiea', brand: 'Alpha' },   // 同じブランドの店（今の画面と同じく、ブランドで決まる）
  { id: 'S4', name: 'Gamma', brand: '' },
];
const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-CEO', name: 'Cal E', store: 'HQ', role: 'ceo', title: '' },
  { id: 'E-OF', name: 'Ofelia', store: 'HQ', role: 'office', title: 'Accountant' },
  { id: 'E-OC', name: 'Oscar', store: 'HQ', role: 'office_crew', title: 'Office Crew' },
  { id: 'E-AM', name: 'Amy Area', store: 'S2', role: 'am', title: 'Area Manager' },
  { id: 'E-AMU', name: 'Una Unconf', store: 'S2', role: 'am', title: 'Area Manager' },       // 確かめがまだの AM
  { id: 'E-4', name: 'Leo Four', store: 'S1', role: 'g4', title: 'Store Manager' },
  { id: 'E-SM', name: 'Sam Manager', store: 'S1', role: 'sl', title: 'Store Manager' },
  { id: 'E-SL', name: 'Sally Lead', store: 'S2', role: 'sl', title: 'Server Leader' },
  { id: 'E-G2', name: 'Gus Two', store: 'S4', role: 'g2', title: 'Crew Leader' },
  { id: 'E-CH', name: 'Chef Ken', store: 'S1', role: 'chef', title: 'Head Chef' },
  { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew' },
  { id: 'E-1B', name: 'Bea One', store: 'S2', role: 'crew', title: 'Crew' },
  { id: 'E-OUT', name: 'Gone Lead', store: 'S1', role: 'sl', title: 'Store Leader', status: '退職' },
];
const U = n => 'aaaaaaaa-0000-0000-0000-00000000000' + n;
const MGR = { [U(1)]: { role: 'gm', emp_id: 'E-GM' }, [U(2)]: { role: 'office', emp_id: 'E-OF' }, [U(3)]: { role: 'office_crew', emp_id: 'E-OC' }, [U(5)]: { role: 'ceo', emp_id: 'E-CEO' } };
const USERS = { gm: U(1), of: U(2), oc: U(3), ceo: U(5) };
// work-requests の whoami の答え（AM の担当の店は確かめた写し。店は確かめた写しと今の重なり）
const ME = {
  gm: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M' },
  ceo: { emp: 'E-CEO', role: 'ceo', grade: 7, stores: [], am_stores: [], name: 'Cal E' },
  of: { emp: 'E-OF', role: 'office', grade: 4, stores: [], am_stores: [], name: 'Ofelia' },
  oc: { emp: 'E-OC', role: 'office_crew', grade: 1, stores: [], am_stores: [], name: 'Oscar' },
  am: { emp: 'E-AM', role: 'am', grade: 5, stores: ['S2'], am_stores: ['S2', 'S4'], name: 'Amy Area' },
  amu: { emp: 'E-AMU', role: 'staff', grade: 3, stores: ['S2'], am_stores: [], name: 'Una Unconf', confirmed: false },   // 写しが無い：whoami は G3 まで
  g4: { emp: 'E-4', role: 'staff', grade: 4, stores: ['S1', 'S2'], am_stores: [], name: 'Leo Four', confirmed: true },
  g4u: { emp: 'E-4', role: 'staff', grade: 3, stores: ['S1', 'S2'], am_stores: [], name: 'Leo Four', confirmed: false },   // 確かめがまだの G4
  sm: { emp: 'E-SM', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Sam Manager', confirmed: true },
  smu: { emp: 'E-SM', role: 'staff', grade: 3, stores: ['S1'], am_stores: [], name: 'Sam Manager', confirmed: false },     // 確かめがまだの店長
  sl: { emp: 'E-SL', role: 'staff', grade: 3, stores: ['S2'], am_stores: [], name: 'Sally Lead', confirmed: true },
  g2: { emp: 'E-G2', role: 'staff', grade: 2, stores: ['S4'], am_stores: [], name: 'Gus Two', confirmed: false },
  chef: { emp: 'E-CH', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Chef Ken', confirmed: true },
  g1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One' },
  g1b: { emp: 'E-1B', role: 'staff', grade: 1, stores: ['S2'], am_stores: [], name: 'Bea One' },
  out: { emp: 'E-OUT', role: 'staff', grade: 3, stores: ['S1'], am_stores: [], name: 'Gone Lead' },
  smNoStore: { emp: 'E-SM', role: 'staff', grade: 4, stores: [], am_stores: [], name: 'Sam Manager' },   // 確かめた写しの店と今の店が重ならない
};
const T0 = ts6(Date.UTC(2026, 10, 3, 9, 0, 0));
const APPS = [
  { id: 'a1', name: 'Ann Alpha', store: 'Alpha', phone: '808-555-0001', email: 'ann@x.test', status: '応募中', date: '2026-10-01' },
  { id: 'a2', name: 'Bob Beta', store: 'Beta', phone: '808-555-0002', email: 'bob@x.test', status: '応募中', date: '2026-10-02' },
  { id: 'a3', name: 'Cy Unsorted', store: '未分類', phone: '', email: '', status: '要確認', date: '2026-10-03' },
  { id: 'a4', name: 'Dee Name', store: 'Alpha Kaimuki', phone: '', email: '', status: '応募中', date: '2026-10-04' },
  { id: 'a5', name: 'Eve Gamma', store: 'Gamma', phone: '', email: '', status: '採用', date: '2026-10-05' },
  { id: 'a6', name: 'Rex Again', store: 'Beta', phone: '(808) 555-9999', email: '', status: '応募中', date: '2026-10-06' },   // 前に Alpha で不採用の人
];
const LOG = [
  { name: 'Rex Again', phone: '8085559999', email: 'rex@x.test', store: 'Alpha', applyDate: '2026-01-01', rejectDate: '2026-01-10', reason: '連絡が取れない', memo: 'no show', by: 'Gina M' },
  { name: 'Old Beta', phone: '', email: '', store: 'Beta', applyDate: '2026-02-01', rejectDate: '2026-02-10', reason: 'その他', memo: '', by: 'Amy Area' },
  { name: 'Old Unsorted', phone: '', email: '', store: '未分類', rejectDate: '2026-03-10', reason: 'その他' },
];
const GH = [
  { id: 'gh1', title: 'shift', body: 'b1', author: 'Kai One', store: 'S1', date: '2026/10/1', status: '未対応', replies: [] },
  { id: 'gh2', title: 'pay', body: 'b2', author: 'Bea One', store: 'S2', date: '2026/10/2', status: '未対応', replies: [] },
  { id: 'gh3', title: 'misc', body: 'b3', author: 'Gus Two', store: 'S4', date: '2026/10/3', status: '対応中', replies: [] },
];

function setup(o = {}) {
  const W = makeWorld({ emps: EMPS.map(e => ({ ...e })), mgr: MGR, users: USERS, stores: STORES.map(s => ({ ...s })), wrPeople: [], pins: Object.fromEntries(Object.entries(ME).map(([k, v]) => ['t' + k, v])), ...o });
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  let clock = Date.UTC(2026, 10, 4, 10, 0, 0);
  const handle = createHandler({ env, fetch: W.fetch, now: () => (clock += 1000) });
  const call = async (body, hdr = {}) => {
    const r = await handle(new Request('https://fn.test/secure-state', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ANON, ...hdr }, body: JSON.stringify(body) }));
    let j = null; try { j = await r.json(); } catch { j = null; }
    return { status: r.status, j };
  };
  const as = who => ({ pin_session: 't' + who });
  const email = who => ({ authorization: 'Bearer ' + JWT(who) });
  W.set('applicants', APPS, T0);
  W.set('reject_log', LOG, T0);
  W.set('growthhub', GH, T0);
  return { W, call, as, email };
}
const ids = v => (Array.isArray(v) ? v : []).map(x => x.id || x.name).sort();

test('the keys and the helpers', () => {
  assert.deepEqual(HR_KEYS, ['applicants', 'reject_log', 'growthhub']);
  for (const k of HR_KEYS) { assert.ok(hrIsKey(k)); assert.ok(!ssIsKey(k) && !csIsKey(k) && !swIsKey(k), k); }
  for (const k of ['applicant', 'Applicants', 'reject_log ', 'growthhub_x', 'onboardings', '__proto__', 'toString', '', null, 1]) assert.ok(!hrIsKey(k), String(k));
  // 1 件の形：_ で始まる欄は落とす。ID・店・名前・状態が要る。大きすぎるものは断る
  const ok = hrApClean({ id: 'a1', store: 'Alpha', name: 'x', status: '応募中', _prior: [1], _x: 1, memo: 'm' });
  assert.deepEqual(ok, { id: 'a1', store: 'Alpha', name: 'x', status: '応募中', memo: 'm' });
  for (const bad of [null, [], 'x', { store: 'A', name: 'x', status: 's' }, { id: 'a 1', store: 'A', name: 'x', status: 's' }, { id: 'a1', store: '', name: 'x', status: 's' },
    { id: 'a1', store: 'A', name: '', status: 's' }, { id: 'a1', store: 'A', name: 'x' }, { id: "a1'", store: 'A', name: 'x', status: 's' },
    { id: 'a1', store: 'A'.repeat(81), name: 'x', status: 's' }, { id: 'a1', store: 'A', name: 'x', status: 's', memo: 'm'.repeat(50001) }]) assert.equal(hrApClean(bad), null, JSON.stringify(bad).slice(0, 60));
  assert.deepEqual(hrPrior(LOG[0]), { rejectDate: '2026-01-10', store: 'Alpha', reason: '連絡が取れない', memo: 'no show' }, 'no name, phone or e-mail');
});

test('the match is the app\'s findPriorRejects (same results on many probes)', () => {
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const m = /function findPriorRejects\(applicant\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(m, 'findPriorRejects in index.html');
  const log = [...LOG, { name: ' ANN alpha ', phone: '1234567', email: 'A@X.TEST ' }, { name: '', phone: '555-12', email: '' }, { name: 'Zed', phone: null, email: null }, null];
  const ctx = vm.createContext({ getRejectLog: () => log.filter(Boolean) });
  vm.runInContext(m[0] + '; this.f = findPriorRejects;', ctx);
  const probes = [{ name: 'ann alpha' }, { name: 'Ann Alpha ' }, { phone: '123-4567' }, { phone: '55512' }, { phone: '555-12' }, { email: 'a@x.test' }, { email: 'rex@x.test' }, { phone: '(808)555-9999' },
    { name: '', phone: '', email: '' }, { name: 'Zed' }, { name: 'zed', phone: '0' }, {}, { name: 'Nobody', phone: '000000', email: 'n@x' }];
  for (const p of probes) assert.deepEqual(hrMatches(p, log).map(x => JSON.stringify(x)), ctx.f(p).map(x => JSON.stringify(x)), JSON.stringify(p));
});

test('who sees which applicants and rejects (the screens of today; Moto 11/04)', async () => {
  const { call, as, email } = setup();
  const want = {
    gm: [['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], ['Old Beta', 'Old Unsorted', 'Rex Again'], 'all'],
    ceo: [['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], ['Old Beta', 'Old Unsorted', 'Rex Again'], 'all'],
    of: [['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], ['Old Beta', 'Old Unsorted', 'Rex Again'], 'all'],
    oc: [[], [], 'none'],                                            // 事務Crew：今の画面でも応募者は出ない
    am: [['a2', 'a3', 'a6'], ['Old Beta', 'Old Unsorted'], 'scoped'],   // 確かめた担当の店（S2 Beta・S4 は空のブランド）＋未分類
    amu: [['a2', 'a6'], ['Old Beta'], 'scoped'],                      // 確かめがまだの AM：G3 と同じ（配属の店のブランドと店の名前。未分類は入らない）
    g4: [['a1', 'a3'], ['Old Unsorted', 'Rex Again'], 'scoped'],     // 配属の店（S1 Alpha）だけ＋未分類（応援の S2 は入れない）
    g4u: [['a1', 'a4'], ['Rex Again'], 'scoped'],                    // 確かめがまだの G4：G3 と同じ
    smu: [['a1', 'a4'], ['Rex Again'], 'scoped'],
    sm: [['a1', 'a4'], ['Rex Again'], 'scoped'],                    // 店長（SL）：自分の店のブランドと店の名前
    sl: [['a2', 'a6'], ['Old Beta'], 'scoped'],
    g2: [[], [], 'none'],                                            // S4 はブランドも名前も空でない：名前 Gamma
    chef: [[], [], 'none'], g1: [[], [], 'none'], out: [[], [], 'none'], smNoStore: [[], [], 'none'],
  };
  want.g2 = [['a5'], [], 'scoped'];
  for (const [who, [ap, rj, level]] of Object.entries(want)) {
    const r1 = await call({ action: 'hr_get', key: 'applicants', ...as(who) });
    assert.equal(r1.status, 200, who); assert.equal(r1.j.hrfn, 1); assert.equal(r1.j.fn, 1);
    assert.deepEqual(ids(r1.j.value), ap, who + ' applicants'); assert.equal(r1.j.level, level, who);
    const r2 = await call({ action: 'hr_get', key: 'reject_log', ...as(who) });
    assert.deepEqual(ids(r2.j.value), rj, who + ' rejects');
  }
  // メールのログイン：manager_auth の役割
  for (const [who, n] of [['gm', 6], ['of', 6], ['ceo', 6], ['oc', 0]]) {
    const r = await call({ action: 'hr_get', key: 'applicants' }, email(who));
    assert.equal(r.status, 200); assert.equal(r.j.value.length, n, who);
  }
  // ログインの印が無い・知らない印：何も返さない
  assert.equal((await call({ action: 'hr_get', key: 'applicants' })).status, 401);
  assert.equal((await call({ action: 'hr_get', key: 'applicants', pin_session: 'tnobody' })).status, 401);
  assert.equal((await call({ action: 'hr_get', key: 'onboardings', ...as('gm') })).status, 400);
});

test('an applicant who was rejected at another store carries only the match (date, store, reason, memo)', async () => {
  const { call, as } = setup();
  const r = await call({ action: 'hr_get', key: 'applicants', ...as('sl') });   // Beta の SL：Alpha の不採用ログは見えない
  const rex = r.j.value.find(x => x.id === 'a6');
  assert.deepEqual(rex._prior, [{ rejectDate: '2026-01-10', store: 'Alpha', reason: '連絡が取れない', memo: 'no show' }]);
  assert.ok(!r.j.value.find(x => x.id === 'a2')._prior, 'no match → no _prior');
  const lg = await call({ action: 'hr_get', key: 'reject_log', ...as('sl') });
  assert.ok(!lg.j.value.some(x => x.name === 'Rex Again'), 'the Alpha reject itself is not sent');
  // 採用・不採用になった人には付けない（今の画面の警告と同じ：応募中・新規応募・要確認だけ）
  const { W, call: c2, as: a2 } = setup();
  W.set('applicants', APPS.map(x => (x.id === 'a6' ? { ...x, status: '採用' } : x)), T0);
  assert.ok(!(await c2({ action: 'hr_get', key: 'applicants', ...a2('gm') })).j.value.find(x => x.id === 'a6')._prior);
});

test('the rehire check at entry: matches from every store, only for people who can add applicants', async () => {
  const { call, as } = setup();
  const r = await call({ action: 'hr_match', name: 'nobody', phone: '808 555 9999', email: '', ...as('sm') });
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.matches, [{ rejectDate: '2026-01-10', store: 'Alpha', reason: '連絡が取れない', memo: 'no show' }]);
  assert.deepEqual((await call({ action: 'hr_match', name: 'Old Beta', ...as('sm') })).j.matches.map(x => x.store), ['Beta'], 'another store');
  assert.deepEqual((await call({ action: 'hr_match', name: '', phone: '555', email: '', ...as('gm') })).j.matches, [], 'short phone');
  for (const who of ['g1', 'chef', 'oc', 'out']) assert.equal((await call({ action: 'hr_match', name: 'Rex Again', ...as(who) })).status, 403, who);
  // 長い入力は切る（落ちない）
  assert.equal((await call({ action: 'hr_match', name: 'x'.repeat(5000), phone: { a: 1 }, ...as('gm') })).status, 200);
});

test('the consultation room: managers see their stores, everyone sees their own (the screen of today)', async () => {
  const { call, as } = setup();
  const want = { gm: ['gh1', 'gh2', 'gh3'], of: ['gh1', 'gh2', 'gh3'], am: ['gh2', 'gh3'], g4: ['gh1'], sm: ['gh1'], sl: [], g1: ['gh1'], g1b: ['gh2'], g2: ['gh3'], chef: [], oc: [],
    amu: [], g4u: [], smu: [] };   // 確かめがまだの AM・G4・店長は相談の管理者にならない（自分の相談だけ）
  for (const [who, list] of Object.entries(want)) {
    const r = await call({ action: 'hr_get', key: 'growthhub', ...as(who) });
    assert.deepEqual(ids(r.j.value), list, who);
  }
});

test('add and edit an applicant: one record at a time; others are never overwritten', async () => {
  const { W, call, as } = setup();
  // 店長（Alpha）が足す（どの店でも選べる：今の画面と同じ）
  let r = await call({ action: 'hr_op', key: 'applicants', op: 'put', create: true, rec: { id: 'a9', name: 'New One', store: 'Alpha', status: '応募中', _prior: [{ x: 1 }] }, ...as('sm') });
  assert.equal(r.status, 200); assert.equal(r.j.created, true);
  assert.deepEqual(W.get('applicants').find(x => x.id === 'a9'), { id: 'a9', name: 'New One', store: 'Alpha', status: '応募中' }, '_prior dropped');
  assert.equal(W.get('applicants').length, 7, 'the other six are still there (the client only had two)');
  assert.deepEqual(ids(r.j.value), ['a1', 'a4', 'a9'], 'the answer is the scoped view');
  r = await call({ action: 'hr_op', key: 'applicants', op: 'put', create: true, rec: { id: 'a10', name: 'Walk In', store: 'Beta', status: '応募中' }, ...as('sm') });
  assert.equal(r.status, 200, 'another store is fine (then it is not in the list)');
  assert.ok(!r.j.value.some(x => x.id === 'a10'));
  // 同じ ID で足す：上書きしない（どの店の人かも言わない）
  r = await call({ action: 'hr_op', key: 'applicants', op: 'put', create: true, rec: { id: 'a2', name: 'Fake', store: 'Alpha', status: '応募中' }, ...as('sm') });
  assert.equal(r.status, 409); assert.equal(W.get('applicants').find(x => x.id === 'a2').name, 'Bob Beta');
  // 直す：見られる店の人だけ
  r = await call({ action: 'hr_op', key: 'applicants', op: 'put', rec: { ...APPS[0], memo: 'call back' }, base: APPS[0], ...as('sm') });
  assert.equal(r.status, 200); assert.equal(W.get('applicants').find(x => x.id === 'a1').memo, 'call back');
  r = await call({ action: 'hr_op', key: 'applicants', op: 'put', rec: { ...APPS[1], store: 'Alpha', memo: 'grab' }, base: APPS[1], ...as('sm') });
  assert.equal(r.status, 403, 'a Beta applicant cannot be taken over by moving them'); assert.equal(W.get('applicants').find(x => x.id === 'a2').store, 'Beta');
  // 見られる店から別の店へ移す（担当の店の人）：できる
  r = await call({ action: 'hr_op', key: 'applicants', op: 'put', rec: { ...APPS[1], store: 'Alpha' }, base: APPS[1], ...as('am') });
  assert.equal(r.status, 200); assert.equal(W.get('applicants').find(x => x.id === 'a2').store, 'Alpha');
  // もう無い人を直す：410（作らない）
  r = await call({ action: 'hr_op', key: 'applicants', op: 'put', rec: { id: 'zz', name: 'Ghost', store: 'Alpha', status: '応募中' }, base: { id: 'zz', name: 'Ghost', store: 'Alpha', status: '要確認' }, ...as('sm') });
  assert.equal(r.status, 410); assert.ok(!W.get('applicants').some(x => x.id === 'zz'));
  // 同じ中身：書かない
  const before = W.log.length;
  r = await call({ action: 'hr_op', key: 'applicants', op: 'put', rec: { ...APPS[0], memo: 'call back' }, base: APPS[0], ...as('sm') });
  assert.equal(r.status, 200); assert.equal(W.log.length, before, 'no write');
  // 応募者を見られない人は足せない・直せない
  for (const who of ['g1', 'chef', 'oc', 'out']) {
    r = await call({ action: 'hr_op', key: 'applicants', op: 'put', create: true, rec: { id: 'a20', name: 'x', store: 'Alpha', status: '応募中' }, ...as(who) });
    assert.equal(r.status, 403, who);
  }
  // 形の悪いもの
  for (const rec of [null, { id: 'a 1', name: 'x', store: 'A', status: 's' }, { id: 'a21', name: 'x', store: 'A' }, 'x']) {
    r = await call({ action: 'hr_op', key: 'applicants', op: 'put', create: true, rec, ...as('gm') });
    assert.equal(r.status, 400, JSON.stringify(rec));
  }
  assert.equal((await call({ action: 'hr_op', key: 'applicants', op: 'nope', ...as('gm') })).status, 400);
  assert.equal((await call({ action: 'hr_op', key: 'reject_log', op: 'put', rec: {}, ...as('gm') })).status, 400, 'the reject log is written only by rejecting');
  const logBefore = JSON.stringify(W.get('reject_log'));
  assert.equal((await call({ action: 'hr_op', key: 'reject_log', op: 'post', title: 'T', body: 'B', ...as('gm') })).status, 400, 'not through the consultation ops either');
  assert.equal(JSON.stringify(W.get('reject_log')), logBefore);
  assert.equal(W.calls.anonHr, 0);
});

test('a write between the read and the write is kept (the server reads again and retries)', async () => {
  const { W, call, as } = setup();
  let n = 0;
  W.afterGet = url => {
    if (!/key=eq\.applicants/.test(decodeURIComponent(url.search)) || n++ > 0) return false;
    const cur = W.get('applicants');
    W.set('applicants', cur.concat([{ id: 'other', name: 'From Another Device', store: 'Beta', status: '応募中' }]), ts6(Date.UTC(2026, 10, 4, 10, 30)));
    return true;
  };
  const r = await call({ action: 'hr_op', key: 'applicants', op: 'put', create: true, rec: { id: 'mine', name: 'Mine', store: 'Alpha', status: '応募中' }, ...as('gm') });
  assert.equal(r.status, 200);
  const all = W.get('applicants').map(x => x.id);
  assert.ok(all.includes('other') && all.includes('mine'), 'both kept');
  // ずっとぶつかる：409（書かない）
  const { W: W2, call: c2, as: a2 } = setup();
  W2.afterGet = url => { if (/key=eq\.applicants/.test(decodeURIComponent(url.search))) { W2.set('applicants', W2.get('applicants'), ts6(Date.now() + Math.random() * 1e9)); } return false; };
  const r2 = await c2({ action: 'hr_op', key: 'applicants', op: 'put', create: true, rec: { id: 'mine', name: 'Mine', store: 'Alpha', status: '応募中' }, ...a2('gm') });
  assert.equal(r2.status, 409); assert.ok(!W2.get('applicants').some(x => x.id === 'mine'));
});

test('reject: the server builds the log entry from the cloud record, removes the applicant, and a retry does not log twice', async () => {
  const { W, call, as } = setup();
  let r = await call({ action: 'hr_op', key: 'applicants', op: 'reject', id: 'a6', reason: '経験・スキル不足', memo: 'm', by: 'Sally', rejectDate: '2026-11-04', ...as('sl') });
  assert.equal(r.status, 200);
  assert.ok(!W.get('applicants').some(x => x.id === 'a6'));
  const e = W.get('reject_log').find(x => x.aid === 'a6');
  assert.deepEqual(e, { aid: 'a6', name: 'Rex Again', phone: '(808) 555-9999', email: '', store: 'Beta', applyDate: '2026-10-06', rejectDate: '2026-11-04', reason: '経験・スキル不足', memo: 'm', by: 'Sally', resumeName: '' });
  assert.ok(!r.j.value.some(x => x.id === 'a6')); assert.ok(r.j.reject_log.value.some(x => x.aid === 'a6'), 'the answer carries both lists');
  // もう一度（答えが届かずに押し直した）：記録は 1 つ
  r = await call({ action: 'hr_op', key: 'applicants', op: 'reject', id: 'a6', reason: '経験・スキル不足', memo: 'm', by: 'Sally', rejectDate: '2026-11-04', ...as('sl') });
  assert.equal(r.status, 200); assert.equal(W.get('reject_log').filter(x => x.aid === 'a6').length, 1);
  // 記録は足せたが、応募者を外す前に止まった：押し直すと外れる（記録は 1 つのまま）
  const { W: W2, call: c2, as: a2 } = setup();
  W2.set('reject_log', LOG.concat([{ aid: 'a2', name: 'Bob Beta', store: 'Beta', rejectDate: '2026-11-04', reason: 'x' }]), T0);
  r = await c2({ action: 'hr_op', key: 'applicants', op: 'reject', id: 'a2', reason: 'x', rejectDate: '2026-11-04', ...a2('sl') });
  assert.equal(r.status, 200); assert.ok(!W2.get('applicants').some(x => x.id === 'a2')); assert.equal(W2.get('reject_log').filter(x => x.aid === 'a2').length, 1);
  // 見られない店の人：断る（何も書かない）
  r = await c2({ action: 'hr_op', key: 'applicants', op: 'reject', id: 'a1', reason: 'x', rejectDate: '2026-11-04', ...a2('sl') });
  assert.equal(r.status, 403); assert.ok(W2.get('applicants').some(x => x.id === 'a1')); assert.ok(!W2.get('reject_log').some(x => x.aid === 'a1'));
  // 理由・日付が無い：400／いない人：410
  assert.equal((await c2({ action: 'hr_op', key: 'applicants', op: 'reject', id: 'a4', reason: '', rejectDate: '2026-11-04', ...a2('gm') })).status, 400);
  assert.equal((await c2({ action: 'hr_op', key: 'applicants', op: 'reject', id: 'nope', reason: 'x', rejectDate: '2026-11-04', ...a2('gm') })).status, 410);
  assert.equal((await c2({ action: 'hr_op', key: 'applicants', op: 'reject', id: "a1'", reason: 'x', rejectDate: 'd', ...a2('gm') })).status, 400);
  // 端末が送った名前・電話は使わない（クラウドの記録から作る）
  r = await c2({ action: 'hr_op', key: 'applicants', op: 'reject', id: 'a4', reason: 'x', rejectDate: '2026-11-04', name: 'Spoof', store: 'Beta', ...a2('sm') });
  assert.equal(r.status, 200); const e2 = W2.get('reject_log').find(x => x.aid === 'a4');
  assert.equal(e2.name, 'Dee Name'); assert.equal(e2.store, 'Alpha Kaimuki');
});

test('consultations: post, reply, status and assign — each by the right person only', async () => {
  const { W, call, as } = setup();
  // 相談する：名前と店はサーバーが決める
  let r = await call({ action: 'hr_op', key: 'growthhub', op: 'post', title: 'T', body: 'B', date: '2026/11/4', author: 'Spoof', store: 'S2', ...as('g1') });
  assert.equal(r.status, 200);
  const np = W.get('growthhub').find(x => x.id === r.j.id);
  assert.deepEqual(np, { id: r.j.id, title: 'T', body: 'B', author: 'Kai One', store: 'S1', date: '2026/11/4', status: '未対応', replies: [] });
  assert.ok(r.j.value.some(x => x.id === r.j.id), 'my own post comes back');
  assert.equal((await call({ action: 'hr_op', key: 'growthhub', op: 'post', title: '', body: 'B', ...as('g1') })).status, 400);
  // 本人の返信（管理者ではない）
  r = await call({ action: 'hr_op', key: 'growthhub', op: 'reply', id: 'gh1', text: 'more', date: 'd', author: 'Boss', ...as('g1') });
  assert.equal(r.status, 200); assert.equal(r.j.mgr, false);
  let p = W.get('growthhub').find(x => x.id === 'gh1');
  assert.deepEqual(p.replies[0], { author: 'Kai One', byMgr: false, text: 'more', date: 'd' }); assert.equal(p.status, '未対応');
  r = await call({ action: 'hr_op', key: 'growthhub', op: 'reply', id: 'gh1', text: 'pretend', byMgr: true, ...as('g1') });
  p = W.get('growthhub').find(x => x.id === 'gh1');
  assert.equal(p.replies[1].byMgr, false, 'the device cannot say it is a manager'); assert.equal(p.status, '未対応');
  p.replies.pop(); W.set('growthhub', W.get('growthhub').map(x => (x.id === 'gh1' ? p : x)), T0);
  // ほかの人の相談に返信できない・状態を変えられない
  assert.equal((await call({ action: 'hr_op', key: 'growthhub', op: 'reply', id: 'gh2', text: 'x', ...as('g1') })).status, 403);
  assert.equal((await call({ action: 'hr_op', key: 'growthhub', op: 'status', id: 'gh1', status: '解決', ...as('g1') })).status, 403);
  assert.equal((await call({ action: 'hr_op', key: 'growthhub', op: 'reply', id: 'gh1', text: 'x', ...as('sl') })).status, 403, 'a leader who is not the store manager');
  assert.equal((await call({ action: 'hr_op', key: 'growthhub', op: 'reply', id: 'gh1', text: 'x', ...as('am') })).status, 403, 'not the AM\'s store');
  // 店長の返信：管理者として・未対応 → 対応中
  r = await call({ action: 'hr_op', key: 'growthhub', op: 'reply', id: 'gh1', text: 'ok', author: 'Store Leader', date: 'd2', ...as('sm') });
  assert.equal(r.status, 200); assert.equal(r.j.mgr, true);
  p = W.get('growthhub').find(x => x.id === 'gh1');
  assert.deepEqual(p.replies[1], { author: 'Store Leader', byMgr: true, text: 'ok', date: 'd2' }); assert.equal(p.status, '対応中');
  // 担当・状態
  r = await call({ action: 'hr_op', key: 'growthhub', op: 'assign', id: 'gh2', at: 't', ...as('am') });
  assert.equal(r.status, 200); p = W.get('growthhub').find(x => x.id === 'gh2');
  assert.equal(p.assignee, 'Amy Area'); assert.equal(p.status, '対応中'); assert.equal(p.assignedAt, 't');
  r = await call({ action: 'hr_op', key: 'growthhub', op: 'assign', id: 'gh2', off: true, ...as('am') });
  assert.equal(W.get('growthhub').find(x => x.id === 'gh2').assignee, '');
  r = await call({ action: 'hr_op', key: 'growthhub', op: 'status', id: 'gh2', status: '解決', ...as('of') });
  assert.equal(r.status, 200); assert.equal(W.get('growthhub').find(x => x.id === 'gh2').status, '解決');
  assert.equal((await call({ action: 'hr_op', key: 'growthhub', op: 'status', id: 'gh2', status: 'done', ...as('gm') })).status, 400);
  assert.equal((await call({ action: 'hr_op', key: 'growthhub', op: 'reply', id: 'nope', text: 'x', ...as('gm') })).status, 410);
  assert.equal((await call({ action: 'hr_op', key: 'growthhub', op: 'delete', id: 'gh1', ...as('gm') })).status, 400);
  assert.equal(W.get('growthhub').length, 4, 'nothing removed');
});

test('every answer says hrfn:1 (the app keeps using REST with an older function)', async () => {
  const { call, as } = setup();
  for (const b of [{ action: 'hr_get', key: 'applicants', ...as('gm') }, { action: 'hr_get', key: 'nope', ...as('gm') }, { action: 'pull', ...as('g1') }, { action: 'nope' }]) {
    const r = await call(b);
    assert.equal(r.j.hrfn, 1, JSON.stringify(b)); assert.equal(r.j.fn, 1);
  }
});

test('the store list or the employee table cannot be read: nothing (never everything)', async () => {
  const { W, call, as } = setup();
  W.storesDown = true;
  const r = await call({ action: 'hr_get', key: 'applicants', ...as('sm') });
  assert.equal(r.status, 500); assert.equal(r.j.value, undefined);
  W.storesDown = false;
  assert.equal((await call({ action: 'hr_get', key: 'applicants', ...as('sm') })).status, 200);
});

test('a stored helper field (_prior) is never passed on as it is; a row that is not a list is not overwritten', async () => {
  const { W, call, as } = setup();
  W.set('applicants', APPS.map(a => (a.id === 'a5' ? { ...a, _prior: [{ name: 'planted' }] } : a.id === 'a1' ? { ...a, _prior: [{ name: 'planted' }] } : a)), T0);
  const v = (await call({ action: 'hr_get', key: 'applicants', ...as('gm') })).j.value;
  assert.equal(v.find(x => x.id === 'a5')._prior, undefined, 'hired: no match, and the stored field is dropped');
  assert.equal(v.find(x => x.id === 'a1')._prior, undefined, 'active, no match in the log: dropped');
  // 配列でない行：空とみなして上書きしない（500・書かない）
  for (const key of ['applicants', 'growthhub']) {
    const { W: W2, call: c2, as: a2 } = setup();
    W2.set(key, { not: 'a list' }, T0);
    const r = key === 'applicants'
      ? await c2({ action: 'hr_op', key, op: 'put', create: true, rec: { id: 'n1', name: 'N', store: 'Alpha', status: '応募中' }, ...a2('gm') })
      : await c2({ action: 'hr_op', key, op: 'post', title: 'T', body: 'B', ...a2('g1') });
    assert.equal(r.status, 500, key); assert.deepEqual(W2.get(key), { not: 'a list' }, key + ' unchanged');
  }
});

test('the store\'s brand and name come from the columns, or from data when the columns are empty (the app writes both)', async () => {
  const { W, call, as } = setup({ stores: [{ id: 'S1', name: null, brand: null, data: { id: 'S1', name: 'Alpha Kaimuki', brand: 'Alpha' } }, { id: 'S2', name: 'Beta Ward', brand: 'Beta', data: { brand: 'Other' } }] });
  assert.deepEqual(ids((await call({ action: 'hr_get', key: 'applicants', ...as('sm') })).j.value), ['a1', 'a4'], 'S1 from data: brand Alpha + name Alpha Kaimuki');
  assert.deepEqual(ids((await call({ action: 'hr_get', key: 'applicants', ...as('sl') })).j.value), ['a2', 'a6'], 'S2: the column wins over data');
});

test('writing yourself up in the employee table does not make you a manager (the confirmed copy decides; review P2-3)', async () => {
  // Crew（E-1）が自分の行を役割 g4・店 S2・肩書き Store Manager に書き換えた。whoami は写しが無いので G3 まで・店は今の表
  const { W, call, as } = setup({ pins: { ...Object.fromEntries(Object.entries(ME).map(([k, v]) => ['t' + k, v])), tself: { emp: 'E-1', role: 'staff', grade: 3, stores: ['S2'], am_stores: [], name: 'Kai One', confirmed: false } } });
  W.emps = W.emps.map(e => (e.id === 'E-1' ? { ...e, role: 'g4', store: 'S2', title: 'Store Manager' } : e));
  const gh = await call({ action: 'hr_get', key: 'growthhub', ...as('self') });
  assert.deepEqual(ids(gh.j.value), ['gh1'], 'only their own consultation (not the S2 posts of others)');
  assert.equal((await call({ action: 'hr_op', key: 'growthhub', op: 'status', id: 'gh2', status: '解決', ...as('self') })).status, 403);
  assert.equal(W.get('growthhub').find(x => x.id === 'gh2').status, '未対応');
  const ap = await call({ action: 'hr_get', key: 'applicants', ...as('self') });
  assert.ok(!ap.j.value.some(x => x.store === '未分類'), 'no 未分類 (that is for confirmed G4 and AM)');
  // G3 と同じ範囲（配属の店）までは、社員の表の書き換えで見える（残る限界・段階 (b) で閉じる）
  assert.deepEqual(ids(ap.j.value), ['a2', 'a6']);
  // whoami が（もし）G4 を返しても、確かめた写しが無ければ管理者にしない
  const { W: W2, call: c2, as: a2 } = setup({ pins: { tself: { emp: 'E-1', role: 'staff', grade: 4, stores: ['S2'], am_stores: [], name: 'Kai One', confirmed: false } } });
  W2.emps = W2.emps.map(e => (e.id === 'E-1' ? { ...e, role: 'g4', store: 'S2', title: 'Store Manager' } : e));
  assert.deepEqual(ids((await c2({ action: 'hr_get', key: 'growthhub', ...a2('self') })).j.value), ['gh1']);
  assert.ok(!(await c2({ action: 'hr_get', key: 'applicants', ...a2('self') })).j.value.some(x => x.store === '未分類'));
});

test('editing an applicant: only the fields this device changed; the same field changed elsewhere is a conflict (review P2-2)', async () => {
  const { W, call, as } = setup();
  const base = { ...APPS[0] };
  // GM が採用にして Onboarding の印を付けた（店長の端末はまだ前の写し）
  let r = await call({ action: 'hr_op', key: 'applicants', op: 'put', rec: { ...base, status: '採用', onboardId: 'C9' }, base, ...as('gm') });
  assert.equal(r.status, 200);
  // 店長が前の写しのままメモを直す：メモだけ重なる（状態・印は戻らない）
  r = await call({ action: 'hr_op', key: 'applicants', op: 'put', rec: { ...base, memo: 'call back', _prior: [{ x: 1 }] }, base: { ...base, _prior: [{ x: 1 }] }, ...as('sm') });
  assert.equal(r.status, 200);
  assert.deepEqual(W.get('applicants').find(x => x.id === 'a1'), { ...base, status: '採用', onboardId: 'C9', memo: 'call back' });
  // 同じ欄（状態）を前の写しから別の値に：409（書かない）
  r = await call({ action: 'hr_op', key: 'applicants', op: 'put', rec: { ...base, status: '要確認' }, base, ...as('sm') });
  assert.equal(r.status, 409); assert.equal(W.get('applicants').find(x => x.id === 'a1').status, '採用');
  // 同じ値に変えていた：ぶつからない（書かない）
  const before = W.log.length;
  r = await call({ action: 'hr_op', key: 'applicants', op: 'put', rec: { ...base, status: '採用' }, base, ...as('sm') });
  assert.equal(r.status, 200); assert.equal(W.log.length, before);
  // 欄を消す
  const now = W.get('applicants').find(x => x.id === 'a1');
  r = await call({ action: 'hr_op', key: 'applicants', op: 'put', rec: (({ memo, ...x }) => x)(now), base: now, ...as('sm') });
  assert.equal(r.status, 200); assert.ok(!('memo' in W.get('applicants').find(x => x.id === 'a1')));
  // base が無い・別の人：400
  assert.equal((await call({ action: 'hr_op', key: 'applicants', op: 'put', rec: { ...base, memo: 'x' }, ...as('sm') })).status, 400);
  assert.equal((await call({ action: 'hr_op', key: 'applicants', op: 'put', rec: { ...base, memo: 'x' }, base: { ...APPS[3] }, ...as('sm') })).status, 400);
});

test('posting or replying twice with the same send key (the first answer was lost): one post, one reply', async () => {
  const { W, call, as } = setup();
  const b = { action: 'hr_op', key: 'growthhub', op: 'post', title: 'T', body: 'B', cid: 'cid-123456', ...as('g1') };
  const r1 = await call(b), r2 = await call(b);
  assert.equal(r1.status, 200); assert.equal(r2.status, 200); assert.equal(r1.j.id, r2.j.id);
  assert.equal(W.get('growthhub').filter(x => x.cid === 'cid-123456').length, 1);
  // ほかの人が同じ印で送っても、その人の相談にはならない（別に足す）
  const r3 = await call({ ...b, ...as('g1b') });
  assert.notEqual(r3.j.id, r1.j.id);
  const rp = { action: 'hr_op', key: 'growthhub', op: 'reply', id: 'gh1', text: 'ok', cid: 'rcid-1234', ...as('sm') };
  await call(rp); await call(rp);
  assert.equal(W.get('growthhub').find(x => x.id === 'gh1').replies.length, 1);
  // 社員と結ばれていないメールのログインの GM も担当できる（名前は GM）
  const { W: W2, call: c2, email } = setup({ mgr: { ...MGR, [U(1)]: { role: 'gm', emp_id: null } } });
  const ra = await c2({ action: 'hr_op', key: 'growthhub', op: 'assign', id: 'gh2', at: 't' }, email('gm'));
  assert.equal(ra.status, 200); assert.equal(W2.get('growthhub').find(x => x.id === 'gh2').assignee, 'GM');
});

test('a confirmed G4 who is a leader but not the store manager does not manage consultations (the title decides, as on the screen)', async () => {
  const { W, call, as } = setup({ pins: { tlead: { emp: 'E-SL', role: 'staff', grade: 4, stores: ['S2'], am_stores: [], name: 'Sally Lead', confirmed: true } } });
  assert.deepEqual(ids((await call({ action: 'hr_get', key: 'growthhub', ...as('lead') })).j.value), [], 'not a manager (Server Leader)');
  W.emps = W.emps.map(e => (e.id === 'E-SL' ? { ...e, title: 'Store Manager' } : e));
  assert.deepEqual(ids((await call({ action: 'hr_get', key: 'growthhub', ...as('lead') })).j.value), ['gh2'], 'the store manager of S2');
});

test('Codex #136 P2-1: within the 60-second PIN cache, a person who was retired, stopped or removed sees and writes nothing of their own', async () => {
  for (const change of ['retired', 'osDisabled', 'removed']) {
    const { W, call, as } = setup();
    // 在籍のうちに一度呼ぶ（PIN の確かめを覚える）
    let r = await call({ action: 'hr_get', key: 'growthhub', ...as('g1') });
    assert.equal(r.status, 200); assert.deepEqual(ids(r.j.value), ['gh1'], 'own consultation while employed');
    // 退職・OS 停止・社員の行が無くなった。work-requests も PIN を断るが、関数は 60 秒覚えている
    const i = W.emps.findIndex(e => e.id === 'E-1');
    if (change === 'retired') W.emps[i] = { ...W.emps[i], status: '退職' };
    else if (change === 'osDisabled') W.emps[i] = { ...W.emps[i], data: { osDisabled: true } };
    else W.emps.splice(i, 1);
    W.pins.tg1 = 'deny';
    r = await call({ action: 'hr_get', key: 'growthhub', ...as('g1') });
    assert.equal(r.status, 200, change); assert.deepEqual(r.j.value, [], change + ': no own consultation');
    r = await call({ action: 'hr_op', key: 'growthhub', op: 'post', title: 't', body: 'b', date: '2026/11/9', ...as('g1') });
    assert.equal(r.status, 403, change + ': cannot post');
    r = await call({ action: 'hr_op', key: 'growthhub', op: 'reply', id: 'gh1', text: 'x', date: '2026/11/9', ...as('g1') });
    assert.equal(r.status, 403, change + ': cannot reply to the own consultation');
    assert.equal(W.get('growthhub').length, GH.length, change + ': nothing written');
    assert.deepEqual(W.get('growthhub')[0].replies, []);
  }
  // CEO・GM・経理（社員と結ばれている）も、今の社員の表で退職なら何も見ない
  const { W, call, as } = setup();
  assert.equal((await call({ action: 'hr_get', key: 'applicants', ...as('gm') })).j.value.length, APPS.length);
  const g = W.emps.findIndex(e => e.id === 'E-GM'); W.emps[g] = { ...W.emps[g], status: '退職' }; W.pins.tgm = 'deny';
  let r = await call({ action: 'hr_get', key: 'applicants', ...as('gm') });
  assert.equal(r.status, 200); assert.deepEqual(r.j.value, []); assert.equal(r.j.level, 'none');
  r = await call({ action: 'hr_op', key: 'applicants', op: 'reject', id: 'a1', reason: 'x', rejectDate: '2026-11-09', ...as('gm') });
  assert.equal(r.status, 403); assert.ok(W.get('applicants').some(x => x.id === 'a1'));
  // 在籍の人・社員と結ばれていないメールのログインの経理などは今までどおり
  assert.deepEqual(ids((await call({ action: 'hr_get', key: 'growthhub', ...as('g1') })).j.value), ['gh1']);
});

test('Codex #136 P2-2: an edit made by another device while the reject is copied to the log is not lost (the log gets the new values)', async () => {
  const { W, call, as } = setup();
  W.set('applicants', APPS.map(x => (x.id === 'a2' ? { ...x, phone: 'OLD-PHONE' } : x)), T0);
  let n = 0;
  W.afterGet = url => {   // 不採用ログを読んだ直後（書く前）に、ほかの端末が応募者の電話番号を直す
    if (!/key=eq\.reject_log/.test(decodeURIComponent(url.search)) || n++ > 0) return false;
    W.set('applicants', W.get('applicants').map(x => (x.id === 'a2' ? { ...x, phone: 'NEW-PHONE' } : x)), ts6(Date.UTC(2026, 10, 4, 10, 31)));
    return true;
  };
  const r = await call({ action: 'hr_op', key: 'applicants', op: 'reject', id: 'a2', reason: 'x', rejectDate: '2026-11-09', memo: 'm', ...as('am') });
  assert.equal(r.status, 200);
  assert.ok(!W.get('applicants').some(x => x.id === 'a2'), 'removed');
  const e = W.get('reject_log').filter(x => x.aid === 'a2');
  assert.equal(e.length, 1, 'one log entry');
  assert.equal(e[0].phone, 'NEW-PHONE', 'the newer edit is in the log');
  assert.equal(e[0].reason, 'x'); assert.equal(e[0].memo, 'm');
  // ずっと直され続ける：応募者は外さない（409）。ログは今の記録の写し・1 つだけ
  const { W: W2, call: c2, as: a2 } = setup();
  let k = 0;
  W2.afterGet = url => {
    if (/key=eq\.applicants/.test(decodeURIComponent(url.search))) W2.set('applicants', W2.get('applicants').map(x => (x.id === 'a2' ? { ...x, phone: 'P' + (++k) } : x)), ts6(Date.UTC(2026, 10, 4, 11, 0) + k * 1000));
    return false;
  };
  const r2 = await c2({ action: 'hr_op', key: 'applicants', op: 'reject', id: 'a2', reason: 'x', rejectDate: '2026-11-09', ...a2('am') });
  assert.equal(r2.status, 409);
  assert.ok(W2.get('applicants').some(x => x.id === 'a2'), 'not removed');
  assert.equal(W2.get('reject_log').filter(x => x.aid === 'a2').length, 1);
  // そのあと押し直す（もう直されない）：今の記録を写して外す。理由は最初の不採用のまま
  W2.afterGet = null;
  const now = W2.get('applicants').find(x => x.id === 'a2');
  const r3 = await c2({ action: 'hr_op', key: 'applicants', op: 'reject', id: 'a2', reason: 'y', rejectDate: '2026-11-10', ...a2('am') });
  assert.equal(r3.status, 200);
  assert.ok(!W2.get('applicants').some(x => x.id === 'a2'));
  const e3 = W2.get('reject_log').filter(x => x.aid === 'a2');
  assert.equal(e3.length, 1); assert.equal(e3[0].phone, now.phone, 'the latest record'); assert.equal(e3[0].reason, 'x', 'the first reject reason stays');
});
