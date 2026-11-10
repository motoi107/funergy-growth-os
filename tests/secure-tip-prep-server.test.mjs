// secure-state v1146（2b の 8 つ目・Moto さん 11/10「Tip Rate とプレップから」「今の画面で決められる人だけ」）の関数：
// Tip Rate の申請・決定（spl_tip_requests_<名前>・前の統合行 tip_requests）とプレップの時給の表・認定（prep_tables・prep_certs）を、決められる人だけが書く。
// 読むのは今までどおり REST（この関数の get では返さない）。合成データだけ（架空の人と店）。PostgREST・Auth・work-requests は tests/lib/secure-state-world.mjs の偽物。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, tpIsKey, tpCheck, tipNk, TP_KEYS, TIP_DECIDE, swIsKey, ssIsKey, csIsKey, hrIsKey } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, JWT } from './lib/secure-state-world.mjs';

const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-CEO', name: 'Cal E', store: 'HQ', role: 'ceo', title: '' },
  { id: 'E-OF', name: 'Ofelia', store: 'HQ', role: 'office', title: 'Accountant' },
  { id: 'E-OC', name: 'Oscar', store: 'HQ', role: 'office_crew', title: 'Office Crew' },
  { id: 'E-AM', name: 'Amy Area', store: 'S1', role: 'am', title: 'Area Manager' },
  { id: 'E-4', name: 'Leo Four', store: 'S1', role: 'g4', title: 'Store Manager' },
  { id: 'E-3', name: 'Sal Three', store: 'S1', role: 'sl', title: 'Store Leader' },
  { id: 'E-CH', name: 'Chef Ken', store: 'S1', role: 'chef', title: 'Head Chef' },
  { id: 'E-CC', name: 'Corp Cora', store: 'HQ', role: 'chef', title: 'Corporate Chef' },
  { id: 'E-SM', name: 'Sam Manager', store: 'S2', role: 'sl', title: 'Store Manager' },
  { id: 'E-4C', name: 'Gus Four', store: 'S2', role: 'g4', title: 'Store Manager' },
  { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew' },
  { id: 'E-34', name: 'Ivy Three', store: 'S1', role: 'g4', title: 'Store Manager' },   // 社員の表は g4。GM・CEO が確かめたのは G3（上がったのはまだ確かめていない）
  { id: 'E-2', name: 'Ria Two', store: 'S2', role: 'crew', title: 'Crew' },
  { id: 'E-OUTGM', name: 'Gone GM', store: 'HQ', role: 'gm', title: 'General Manager', status: '退職' },
];
const U = n => 'aaaaaaaa-0000-0000-0000-00000000000' + n;
const MGR = { [U(1)]: { role: 'gm', emp_id: 'E-GM' }, [U(5)]: { role: 'ceo', emp_id: 'E-CEO' }, [U(2)]: { role: 'office', emp_id: 'E-OF' }, [U(6)]: { role: 'gm', emp_id: 'E-OUTGM' }, [U(7)]: { role: 'office', emp_id: null } };
const USERS = { gm: U(1), ceo: U(5), of: U(2), gmout: U(6), ofx: U(7) };
const ME = {
  gm: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M' },
  ceo: { emp: 'E-CEO', role: 'ceo', grade: 7, stores: [], am_stores: [], name: 'Cal E' },
  of: { emp: 'E-OF', role: 'office', grade: 4, stores: [], am_stores: [], name: 'Ofelia' },
  oc: { emp: 'E-OC', role: 'office_crew', grade: 1, stores: [], am_stores: [], name: 'Oscar' },
  am: { emp: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1'], name: 'Amy Area' },
  g4: { emp: 'E-4', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Leo Four' },
  g3: { emp: 'E-3', role: 'staff', grade: 3, stores: ['S1'], am_stores: [], name: 'Sal Three' },
  chef: { emp: 'E-CH', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Chef Ken', confirmed: true },
  // v1146：GM・CEO が確かめた G4（役割 g4）・Corporate Chef（G5）・Store Manager（役割 sl・G4）。確かめた写し（wr_people）は試験ごとに
  g4c: { emp: 'E-4C', role: 'staff', grade: 4, stores: ['S2'], am_stores: [], name: 'Gus Four', confirmed: true },
  cc: { emp: 'E-CC', role: 'staff', grade: 5, stores: [], am_stores: [], name: 'Corp Cora', confirmed: true },
  sm: { emp: 'E-SM', role: 'staff', grade: 4, stores: ['S2'], am_stores: [], name: 'Sam Manager', confirmed: true },
  g1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One' },
  g3g4: { emp: 'E-34', role: 'staff', grade: 3, stores: ['S1'], am_stores: [], name: 'Ivy Three', confirmed: true },
  noname: { emp: 'E-2', role: 'staff', grade: 1, stores: ['S2'], am_stores: [], name: '' },
};
const T0 = '2026-11-09T09:00:00.000000+00:00';
const K = n => 'spl_tip_requests_' + n;
// アプリが書く形（submitTipRequest・approveTip・applyTipRaise）の見本（合成）
const P1 = { id: 'tip1', name: 'Kai One', rate: 90, reason: 'x', status: '申請中', date: '2026/11/01' };
const OLD = { id: 'tip0', name: 'Kai One', rate: 80, status: '承認', date: '2026/09/01', approver: 'Moto', approvedDate: '2026/09/02' };   // v1090 までの決定（時刻なし）
const TIP0 = [OLD, P1];
const approve = (r, st = '承認', at = 1762700000000) => ({ ...r, status: st, approver: 'Moto', approvedDate: '2026/11/09', decAt: at, decDay: '2026-11-09', decHst: '2026-11-09', ...(st === '承認' ? { fromDay: '2026-11-09', prevRate: 80 } : {}) });
const raise = (name, rate = 100, at = 1762700000100) => ({ id: 'tipR' + at, name, rate, store: 'S1', reason: 'Direct raise by manager', basis: 'manual', status: '承認', date: '2026/11/09', approver: 'Moto', approvedDate: '2026/11/09', decAt: at, decDay: '2026-11-09', fromDay: '2026-11-09', prevRate: 90, decHst: '2026-11-09' });
const CERT_OK = { emp: 'E-1', name: 'Kai One', store: 'S1', lv: 2, kind: 'req', state: 'approved', from: '2026-11-10', tbl: 't1', dBy: 'Moto', dAt: '2026-11-09T10:00:00Z', dt: 1, _at: 1762700000000 };
const CERT_PEND = { emp: 'E-2', name: 'Ria Two', store: 'S2', lv: 3, kind: 'req', state: 'pending', from: '', tbl: '', _at: 1762700000001 };
const CERTS0 = { c1: CERT_OK, c2: CERT_PEND };
const TBL0 = { t1: { store: 'S1', from: '2026-11-01', levels: [{ lv: 1, name: 'L1', cents: 1700 }], by: 'Moto', at: '2026-11-01T00:00:00Z', _at: 1762000000000 } };

function setup(o = {}) {
  const W = makeWorld({ emps: EMPS.map(e => ({ ...e })), mgr: MGR, users: USERS, wrPeople: [], pins: Object.fromEntries(Object.entries(ME).map(([k, v]) => ['t' + k, v])), ...o });
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  const handle = createHandler({ env, fetch: (u, opt) => W.fetch(u, opt), now: () => Date.UTC(2026, 10, 10, 10, 0, 0) });   // 試験の中で W.fetch を差し替えられる
  const call = async (body, hdr = {}) => {
    const r = await handle(new Request('https://fn.test/secure-state', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ANON, ...hdr }, body: JSON.stringify(body) }));
    let j = null; try { j = await r.json(); } catch { j = null; }
    return { status: r.status, j };
  };
  const pin = who => ({ pin_session: 't' + who });
  const email = who => ({ authorization: 'Bearer ' + JWT(who) });
  W.set(K('Kai One'), TIP0, T0);
  W.set(K('Amy Area'), [{ id: 'tipA', name: 'Amy Area', rate: 90, status: '申請中', date: '2026/11/01' }], T0);
  W.set('tip_requests', [OLD], T0);
  W.set('prep_tables', TBL0, T0);
  W.set('prep_certs', CERTS0, T0);
  W.set('tasks_all', { a: 1 }, T0);
  const put = (who, key, value, ex) => call({ action: 'put', key, value, ...(ex === undefined ? {} : { expect: ex }), ...(who.startsWith('@') ? {} : pin(who)) }, who.startsWith('@') ? email(who.slice(1)) : {});
  const row = key => W.rows.get(key);
  const ex = key => { const r = row(key); return r ? { exists: true, updated_at: r.updated_at } : { exists: false }; };
  return { W, call, put, ex };
}
const writes = (W, key) => W.log.filter(x => x[0] === 'write' && x[2] === key).map(x => x[1]);

test('the keys: Tip Rate rows per person (and the old combined row), the prep wage tables and certifications; not the Tip history, the prep settings or other keys', () => {
  assert.deepEqual(TP_KEYS, ['prep_tables', 'prep_certs', 'tip_requests']);
  assert.deepEqual(TIP_DECIDE, ['ceo', 'gm', 'am']);
  for (const k of ['prep_tables', 'prep_certs', 'tip_requests', K('Kai One'), K('a'), K('x'.repeat(183)), K('x'.repeat(184)), K('x'.repeat(5000))]) {
    assert.equal(tpIsKey(k), true, k);
    assert.equal(ssIsKey(k) || csIsKey(k) || hrIsKey(k) || swIsKey(k), false, k + ' is only a v1146 key');
  }
  for (const k of ['spl_tip_requests_', 'spl_tip_request_x', 'Spl_tip_requests_x', 'spl_tip_history_Kai One', 'tip_history', 'prep_cfg', 'prep_history', 'live_tip_rate', 'tip_requests_x', ' tip_requests', 'grade_hist', null, 3]) assert.equal(tpIsKey(k), false, String(k));
});

test('Tip Rate: a staff member adds only their own request (pending, no decision marks); they cannot approve, change, take back or delete anything, nor request for someone else', async () => {
  const { W, put, ex } = setup();
  const mine = [...TIP0, { id: 'tip2', name: 'Kai One', rate: 100, reason: 'y', status: '申請中', date: '2026/11/10' }];
  let r = await put('g1', K('Kai One'), mine, ex(K('Kai One')));
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.by, 'staff'); assert.equal(r.j.tpfn, 1);
  assert.deepEqual(W.get(K('Kai One')), mine);
  assert.deepEqual(writes(W, K('Kai One')), ['service']);
  const cases = {
    'approve own': [OLD, approve(P1)],
    'approve own new record': [...TIP0, raise('Kai One')],
    'new pending with a decision mark': [...TIP0, { ...P1, id: 'tip3', decAt: 5 }],
    'change own pending': [OLD, { ...P1, rate: 100 }],
    'delete': [P1],
    'empty': [],
  };
  for (const [what, v] of Object.entries(cases)) {
    const W2 = setup(); const r2 = await W2.put('g1', K('Kai One'), v, W2.ex(K('Kai One')));
    assert.equal(r2.status, 403, what + ' ' + JSON.stringify(r2.j));
    assert.deepEqual(W2.W.get(K('Kai One')), TIP0, what + ': unchanged');
  }
  // ほかの人の行に申請を足す
  r = await put('g1', K('Ria Two'), [{ id: 'tipX', name: 'Ria Two', rate: 100, status: '申請中', date: '2026/11/10' }], { exists: false });
  assert.equal(r.status, 403);
  // PIN の印に名前の無い人：社員の表の自分の行の名前で本人を決める（自分の行には申請を足せる・ほかの人の行には足せない。Codex #140 の P3）
  r = await put('noname', K('Kai One'), [...mine, { id: 'tipX', name: 'Kai One', rate: 100, status: '申請中', date: '2026/11/10' }], ex(K('Kai One')));
  assert.equal(r.status, 403, 'not their own row');
  r = await put('noname', K('Ria Two'), [{ id: 'tipX', name: 'Ria Two', rate: 100, status: '申請中', date: '2026/11/10' }], { exists: false });
  assert.equal(r.status, 200, 'their own row (the employee record E-2 is Ria Two)');
  // 名前が 1 つも分からない人（社員と結ばれていないメールのログイン・名前なし）は申請も足せない
  r = await put('@ofx', K('Kai One'), [...mine, { id: 'tipY', name: 'Kai One', rate: 100, status: '申請中', date: '2026/11/10' }], ex(K('Kai One')));
  assert.equal(r.status, 403);
});

test('Tip Rate: CEO, GM and AM approve, reject and raise other people (as on the Tip Rate screen); a decided record changes only by a newer decision; nothing is deleted or put back to pending', async () => {
  for (const who of ['gm', 'ceo', 'am', '@gm', '@ceo']) {
    for (const st of ['承認', '却下']) {
      const { W, put, ex } = setup();
      const v = [OLD, approve(P1, st)];
      const r = await put(who, K('Kai One'), v, ex(K('Kai One')));
      assert.equal(r.status, 200, who + st + JSON.stringify(r.j));
      assert.deepEqual(W.get(K('Kai One')), v);
    }
    const { W, put, ex } = setup();
    const v = [...TIP0, raise('Kai One')];
    assert.equal((await put(who, K('Kai One'), v, ex(K('Kai One')))).status, 200, who + ' raise');
    // 行の無い人の引き上げ（初めての記録）
    assert.equal((await put(who, K('Ria Two'), [raise('Ria Two')], { exists: false })).status, 200, who + ' raise a new row');
    assert.deepEqual(W.get(K('Ria Two')), [raise('Ria Two')]);
  }
  // 前の統合行にだけあった前の決定（時刻なし・却下も）を人ごとの行へ移す（v720 の畳み込み）：決める人だけ
  for (const v of [[...TIP0, { ...raise('Kai One'), id: 'tipL1', decAt: undefined }], [...TIP0, { ...raise('Kai One'), id: 'tipL2', status: '却下', decAt: undefined }]]) {
    const S = setup();
    assert.equal((await S.put('gm', K('Kai One'), v, S.ex(K('Kai One')))).status, 200, 'GM moves an old decision');
    const S1 = setup();
    assert.equal((await S1.put('g1', K('Kai One'), v, S1.ex(K('Kai One')))).status, 403, 'not the staff member');
    assert.equal((await S1.put('@of', K('Kai One'), v, S1.ex(K('Kai One')))).status, 403, 'not Accounting');
  }
  const bad = {
    'a new pending for someone else': [...TIP0, { ...P1, id: 'tip9' }],
    'delete': [P1],
    'decided back to pending': [{ ...OLD, status: '申請中' }, P1],
    'change the rate when approving': [OLD, { ...approve(P1), rate: 100 }],
    'move to another name': [OLD, { ...approve(P1), name: 'Ria Two' }],
  };
  for (const [what, v] of Object.entries(bad)) {
    const S = setup(); const r = await S.put('gm', K('Kai One'), v, S.ex(K('Kai One')));
    assert.ok(r.status === 403 || r.status === 400, what + ' ' + r.status);
    assert.deepEqual(S.W.get(K('Kai One')), TIP0, what + ': unchanged');
  }
  // 決めたものの決め直し：前の決定より新しい時刻だけ（v1091 の合流と同じ）。前の記録に時刻を付けるのも
  const S = setup();
  S.W.set(K('Kai One'), [OLD, approve(P1, '承認', 2000)], T0);
  assert.equal((await S.put('gm', K('Kai One'), [OLD, approve(P1, '却下', 1999)], S.ex(K('Kai One')))).status, 403, 'an older decision');
  assert.equal((await S.put('gm', K('Kai One'), [OLD, approve(P1, '却下', 2000)], S.ex(K('Kai One')))).status, 403, 'the same time');
  assert.equal((await S.put('gm', K('Kai One'), [OLD, approve(P1, '却下', 2001)], S.ex(K('Kai One')))).status, 200, 'a newer decision');
  const S2 = setup();
  assert.equal((await S2.put('am', K('Kai One'), [{ ...OLD, decAt: 1 }, approve(P1)], S2.ex(K('Kai One')))).status, 200, 'stamping the old record with a time (tipStampLegacy) while approving');
  const S3 = setup();
  assert.equal((await S3.put('g1', K('Kai One'), [{ ...OLD, decAt: 1 }, P1], S3.ex(K('Kai One')))).status, 403, 'not by the staff member');
});

test('Tip Rate: nobody decides their own (AM, GM); once the Work Center is in use, G4, G3, Head Chef, Accounting and Office Crew do not decide (they ask the GM)', async () => {
  const { W, put, ex } = setup();
  const own = [{ id: 'tipA', name: 'Amy Area', rate: 90, status: '承認', date: '2026/11/01', decAt: 9, approver: 'Amy' }];
  assert.equal((await put('am', K('Amy Area'), own, ex(K('Amy Area')))).status, 403, 'AM approves her own request');
  assert.equal((await put('am', K('Amy Area'), [...W.get(K('Amy Area')), raise('Amy Area')], ex(K('Amy Area')))).status, 403, 'AM raises herself');
  assert.equal((await put('gm', K('Gina M'), [raise('Gina M')], { exists: false })).status, 403, 'GM raises himself');
  assert.equal((await put('gm', K('Amy Area'), own, ex(K('Amy Area')))).status, 200, 'the GM decides the AM');
  for (const who of ['g4', 'g3', 'chef', 'g4c', 'sm', 'of', 'oc', '@of', '@ofx']) {
    const S = setup({ wrPeople: [{ emp_id: 'E-CH', role: 'staff', grade: 4, chef: true }] });
    assert.equal((await S.put(who, K('Kai One'), [OLD, approve(P1)], S.ex(K('Kai One')))).status, 403, who + ' approve');
    assert.equal((await S.put(who, K('Kai One'), [...TIP0, raise('Kai One')], S.ex(K('Kai One')))).status, 403, who + ' raise');
    assert.deepEqual(S.W.get(K('Kai One')), TIP0);
  }
  // 決める人も自分の申請（申請中）は足せる
  const S = setup();
  assert.equal((await S.put('am', K('Amy Area'), [...S.W.get(K('Amy Area')), { id: 'tipA2', name: 'Amy Area', rate: 100, status: '申請中', date: '2026/11/10' }], S.ex(K('Amy Area')))).status, 200);
});

test('Tip Rate before the Work Center is in use: G4 (role g4) and the Head Chef confirmed by the GM/CEO decide, as on the Tip Rate screen; the Corporate Chef decides always; nobody else is added', async () => {
  const CH = { emp_id: 'E-CH', role: 'staff', grade: 4, chef: true }, CC = { emp_id: 'E-CC', role: 'staff', grade: 5, chef: true };
  const ok = async (who, o, what) => {
    const S = setup(o);
    const r = await S.put(who, K('Kai One'), [OLD, approve(P1)], S.ex(K('Kai One')));
    assert.equal(r.status, 200, what + ' ' + JSON.stringify(r.j));
    assert.deepEqual(S.W.get(K('Kai One')), [OLD, approve(P1)], what);
    const S2 = setup(o);
    assert.equal((await S2.put(who, K('Kai One'), [...TIP0, raise('Kai One')], S2.ex(K('Kai One')))).status, 200, what + ' raise');
  };
  const no = async (who, o, what) => {
    const S = setup(o);
    const r = await S.put(who, K('Kai One'), [OLD, approve(P1)], S.ex(K('Kai One')));
    assert.equal(r.status, 403, what + ' ' + JSON.stringify(r.j));
    assert.deepEqual(S.W.get(K('Kai One')), TIP0, what);
  };
  await ok('g4c', { wrLive: false }, 'confirmed G4 (role g4), before the Work Center');
  await no('g4c', {}, 'confirmed G4 after the Work Center is in use');
  await no('g4c', { wrLive: 'none' }, 'confirmed G4 when the Work Center state is not known');
  await no('g4', { wrLive: false }, 'G4 not confirmed by the GM/CEO');
  await no('sm', { wrLive: false }, 'a Store Manager whose role is sl (the screen does not let them decide)');
  await no('g3', { wrLive: false }, 'G3');
  await ok('chef', { wrLive: false, wrPeople: [CH] }, 'Head Chef confirmed as Head Chef, before the Work Center');
  await no('chef', { wrLive: false }, 'Head Chef without the GM/CEO\'s Head Chef mark');
  await no('chef', { wrLive: false, wrPeople: [CH], wrNoChef: true }, 'Head Chef before the SQL that adds the mark');
  await no('chef', { wrPeople: [CH] }, 'Head Chef after the Work Center is in use');
  await ok('cc', { wrPeople: [CC] }, 'Corporate Chef (G5) after the Work Center is in use');
  await ok('cc', { wrLive: false, wrPeople: [CC] }, 'Corporate Chef before');
  await no('cc', {}, 'Corporate Chef without the GM/CEO\'s mark');
  // 社員の表の役割を書き換えても（公開の鍵で書ける）、確かめた G4 以上でなければ決めない・自分の分は決めない
  await no('g1', { wrLive: false, emps: EMPS.map(e => e.id === 'E-1' ? { ...e, role: 'g4' } : { ...e }) }, 'a G1 who set their role to g4');
  {
    const S = setup({ wrLive: false });
    S.W.set(K('Gus Four'), [{ id: 'tipG', name: 'Gus Four', rate: 90, status: '申請中', date: '2026/11/01' }], T0);
    assert.equal((await S.put('g4c', K('Gus Four'), [approve({ id: 'tipG', name: 'Gus Four', rate: 90, status: '申請中', date: '2026/11/01' })], S.ex(K('Gus Four')))).status, 403, 'G4 decides their own');
  }
  // 社員の表を読めないときは決めない（狭いほう）。本人かも決められないので失敗（500：端末は送信待ちに残して送り直す。断った印は付けない）
  {
    const S = setup({ wrLive: false });
    const f0 = S.W.fetch;
    S.W.fetch = async (u, opt) => (String(u).includes('/rest/v1/employees?id=') ? new Response('{"message":"down"}', { status: 500 }) : f0(u, opt));
    const r = await S.put('g4c', K('Kai One'), [OLD, approve(P1)], S.ex(K('Kai One')));
    assert.equal(r.status, 500, JSON.stringify(r.j));
    assert.deepEqual(S.W.get(K('Kai One')), TIP0);
    assert.deepEqual(writes(S.W, K('Kai One')), []);
  }
});

// Codex #140 6766283780 の P2：前の統合行を使うと「自分の Tip Rate は決めない」を通らずに済んだ（GM が自分の承認を統合行に足して 200）。
// アプリは統合行の記録も読む（_splitRead → _tipLatestApproved）ので、統合行はだれも変えない（クラウドと同じ値だけ通す）。P3：名前の書き方の違い・名前なし
test('Codex #140: the old combined row cannot be used to decide one\'s own Tip Rate (nobody changes it: add, change, remove, stamp, empty); the per-person row refuses it too', async () => {
  const own = { id: 'tipGM', name: 'Gina M', rate: 100, status: '承認', date: '2026/11/10', approver: 'Gina M', approvedDate: '2026/11/10', decAt: 1762800000000, decDay: '2026-11-10', decHst: '2026-11-10', fromDay: '2026-11-10', prevRate: 90 };
  for (const who of ['gm', '@gm', 'ceo', '@ceo', 'am']) {
    const S = setup();
    // 人ごとの行：GM 本人は決めない（CEO・AM が GM の Tip Rate を決めるのは、ほかの人のことなので今までどおり）
    if (who === 'gm' || who === '@gm') assert.equal((await S.put(who, K('Gina M'), [own], { exists: false })).status, 403, who + ': per-person row');
    const cases = {
      'add own approval': [OLD, own],
      'add someone else\'s approval': [OLD, raise('Kai One')],
      'change a record': [{ ...OLD, rate: 100 }],
      'stamp a record': [{ ...OLD, _dG: 2 }],
      'remove a record': [],
      'add a pending request': [OLD, P1],
    };
    for (const [what, v] of Object.entries(cases)) {
      const r = await S.put(who, 'tip_requests', v, S.ex('tip_requests'));
      assert.equal(r.status, 403, who + ' ' + what + ' ' + JSON.stringify(r.j));
    }
    assert.deepEqual(S.W.get('tip_requests'), [OLD], who + ': unchanged');
    assert.deepEqual(writes(S.W, 'tip_requests'), [], who + ': not written');
    if (who === 'gm' || who === '@gm') assert.equal(S.W.get(K('Gina M')), undefined);
  }
  // 行が無いときも足せない
  const S = setup(); S.W.rows.delete('tip_requests');
  assert.equal((await S.put('gm', 'tip_requests', [own], { exists: false })).status, 403);
  assert.equal((await S.put('gm', 'tip_requests', { a: 1 }, { exists: false })).status, 400, 'not a list');
  // 関数の確かめ（tpCheck）も同じ
  assert.equal(tpCheck('tip_requests', [OLD], [OLD, own], { role: 'gm', name: 'Gina M', dec: true }), 'forbidden');
  assert.equal(tpCheck('tip_requests', [OLD], [OLD], { role: 'gm', name: 'Gina M', dec: true }), 'ok');
  assert.equal(tpCheck('tip_requests', null, [], { role: 'ceo', name: 'Cal E', dec: true }), 'forbidden');
});

test('Codex #140 (P3): whether it is one\'s own Tip Rate does not depend on how the name is written; a person whose name is not known decides nothing', async () => {
  const own = (nm, at = 1762800000000) => ({ id: 'tipS' + at, name: nm, rate: 100, status: '承認', date: '2026/11/10', approver: 'x', approvedDate: '2026/11/10', decAt: at, decDay: '2026-11-10', decHst: '2026-11-10', fromDay: '2026-11-10', prevRate: 90 });
  // 書き方の違う自分の名前の行（全角・空白・大文字）：決めない
  for (const nm of ['Gina  M', ' Gina M ', 'ＧＩＮＡ M', 'gina m', 'Gina　M']) {
    const S = setup();
    assert.equal((await S.put('gm', K(nm), [own(nm)], { exists: false })).status, 403, JSON.stringify(nm));
  }
  // PIN の印の名前が社員の表と違っても（略した名前など）、社員の表の自分の行の名前で本人と分かる
  {
    const S = setup({ pins: { ...Object.fromEntries(Object.entries(ME).map(([k, v]) => ['t' + k, v])), tgmx: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'G. M' } } });
    assert.equal((await S.call({ action: 'put', key: K('Gina M'), value: [own('Gina M')], expect: { exists: false }, pin_session: 'tgmx' })).status, 403, 'the employee record says Gina M');
    const r = await S.call({ action: 'put', key: K('Kai One'), value: [OLD, approve(P1)], expect: S.ex(K('Kai One')), pin_session: 'tgmx' });
    assert.equal(r.status, 200, 'other people are decided as before ' + JSON.stringify(r.j));
  }
  // 社員の表の data の中の名前も見る
  {
    // PIN の印は「A.A.」・社員の表の列は「A. Area」・data の中だけが「Amy Area」
    const S = setup({ emps: EMPS.map(e => e.id === 'E-AM' ? { ...e, name: 'A. Area', data: { name: 'Amy Area' } } : { ...e }),
      pins: { ...Object.fromEntries(Object.entries(ME).map(([k, v]) => ['t' + k, v])), tamx: { ...ME.am, name: 'A.A.' } } });
    const v = [{ id: 'tipA', name: 'Amy Area', rate: 90, status: '承認', date: '2026/11/01', approver: 'x', approvedDate: '2026/11/10', decAt: 1762800000000, decDay: '2026-11-10', decHst: '2026-11-10' }];
    assert.equal((await S.call({ action: 'put', key: K('Amy Area'), value: v, expect: S.ex(K('Amy Area')), pin_session: 'tamx' })).status, 403, 'AM own (data.name)');
    assert.equal((await S.call({ action: 'put', key: K('Kai One'), value: [OLD, approve(P1)], expect: S.ex(K('Kai One')), pin_session: 'tamx' })).status, 200, 'the same AM decides for others');
  }
  // 名前が 1 つも分からない GM（社員と結ばれていないメールのアカウント）：決めない（本人かを決められない）
  {
    const S = setup({ mgr: { ...MGR, [U(8)]: { role: 'gm', emp_id: null } }, users: { ...USERS, gmx: U(8) } });
    const r = await S.put('@gmx', K('Kai One'), [OLD, approve(P1)], S.ex(K('Kai One')));
    assert.equal(r.status, 403, JSON.stringify(r.j));
    assert.deepEqual(S.W.get(K('Kai One')), TIP0);
    // プレップの表は今までどおり（GM の役割で決まる）
    assert.equal((await S.put('@gmx', 'prep_tables', { ...TBL0, t2: { store: 'S1', from: '2026-12-01', levels: [], _at: 1762900000000 } }, S.ex('prep_tables'))).status, 200);
  }
  // 名前のそろえ方
  assert.equal(tipNk(' ＧＩＮＡ　\tM '), 'gina m');
  assert.equal(tipNk(null), '');
  assert.equal(tpCheck(K('Gina M'), [], [own('Gina M')], { role: 'gm', name: '', names: ['gina  m'], dec: true }), 'forbidden', 'names are compared after normalising');
  assert.equal(tpCheck(K('Kai One'), [OLD, P1], [OLD, approve(P1)], { role: 'gm', name: '', names: [], dec: true }), 'forbidden', 'no name: no decision');
  assert.equal(tpCheck(K('Kai One'), [OLD, P1], [OLD, approve(P1)], { role: 'gm', name: 'Gina M', dec: true }), 'ok');
});

test('Tip Rate: the approval center\'s stamps on a record (_dG, _stK, _stT, _dT, _mut) can be set or dropped by anyone signed in, without changing the rate, status or decision; bad stamp values are refused', async () => {
  const D = approve(P1, '承認', 1762700000000);
  const base = [OLD, D];
  const stamped = [OLD, { ...D, _dG: 2, _stK: 'k-abc', _stT: 1762700000500, _dT: 1762700000500 }];
  for (const who of ['@of', '@ofx', 'oc', 'g1', 'g4', 'am', 'gm']) {
    const S = setup(); S.W.set(K('Kai One'), base, T0);
    const r = await S.put(who, K('Kai One'), stamped, S.ex(K('Kai One')));
    assert.equal(r.status, 200, who + ' stamps ' + JSON.stringify(r.j));
    assert.deepEqual(S.W.get(K('Kai One')), stamped);
    // 古い写しの端末が印を外す（合流で手元が勝つ：今までと同じ）＋ 本人の申請を足す
    const S2 = setup(); S2.W.set(K('Kai One'), stamped, T0);
    const drop = who === 'g1' ? [...base, { id: 'tip5', name: 'Kai One', rate: 100, status: '申請中', date: '2026/11/10' }] : base;
    assert.equal((await S2.put(who, K('Kai One'), drop, S2.ex(K('Kai One')))).status, 200, who + ' drops the stamps');
  }
  const S = setup(); S.W.set(K('Kai One'), base, T0);
  const sneak = {
    'stamps and a new status': [OLD, { ...D, _dG: 2, status: '却下' }],
    'stamps and a new decision time': [OLD, { ...D, _dG: 2, decAt: D.decAt + 5 }],
    'stamps and a new rate': [OLD, { ...D, _stK: 'x', rate: 100 }],
    'stamps and a new approver': [OLD, { ...D, _dT: 9, approver: 'Someone' }],
  };
  for (const [what, v] of Object.entries(sneak)) assert.equal((await S.put('@of', K('Kai One'), v, S.ex(K('Kai One')))).status, 403, what);
  const bad = {
    'a text stamp version': [OLD, { ...D, _dG: 'two' }],
    'a negative time': [OLD, { ...D, _dT: -1 }],
    'an object key': [OLD, { ...D, _stK: { a: 1 } }],
    'a long key': [OLD, { ...D, _stK: 'k'.repeat(121) }],
  };
  for (const [what, v] of Object.entries(bad)) assert.equal((await S.put('gm', K('Kai One'), v, S.ex(K('Kai One')))).status, 400, what);
  assert.deepEqual(S.W.get(K('Kai One')), base);
  // 経理（社員と結ばれていない・名前なし）は申請を足せない
  assert.equal((await S.put('@ofx', K('Kai One'), [...base, { id: 'tip6', name: 'Kai One', rate: 100, status: '申請中', date: '2026/11/10' }], S.ex(K('Kai One')))).status, 403);
});

test('Tip Rate: what the cloud has (or a copy the cloud already covers) passes without a write for anyone; the old combined row is read-only; shapes are checked', async () => {
  const { W, put, ex, call } = setup();
  for (const who of ['g1', 'g4', 'of', 'am']) {
    const r = await put(who, K('Kai One'), JSON.parse(JSON.stringify(TIP0)).map(x => Object.fromEntries(Object.entries(x).reverse())), ex(K('Kai One')));
    assert.equal(r.status, 200, who); assert.equal(r.j.same, true, who);
  }
  assert.deepEqual(writes(W, K('Kai One')), [], 'nothing written');
  assert.equal((await put('am', 'tip_requests', [OLD, P1], ex('tip_requests'))).status, 403, 'AM: the old combined row');
  assert.equal((await put('gm', 'tip_requests', [OLD, P1], ex('tip_requests'))).status, 403, 'GM: the old combined row is read-only too (Codex #140)');
  { const r = await put('gm', 'tip_requests', [OLD], ex('tip_requests')); assert.equal(r.status, 200); assert.equal(r.j.same, true, 'the same value passes without a write'); }
  const shapes = {
    'not a list': { a: 1 },
    'a record of another name': [...TIP0, { ...raise('Ria Two') }],
    'an unknown status': [...TIP0, { ...raise('Kai One'), status: '取消' }],
    'a rate over 100': [...TIP0, { ...raise('Kai One'), rate: 150 }],
    'no id': [...TIP0, { ...raise('Kai One'), id: undefined }],
    'the same id twice': [...TIP0, P1],
  };
  for (const [what, v] of Object.entries(shapes)) {
    const S = setup(); const r = await S.put('gm', K('Kai One'), v, S.ex(K('Kai One')));
    assert.equal(r.status, 400, what + ' ' + JSON.stringify(r.j));
  }
  // おかしな記録は、クラウドにもうある同じ記録だけ通す（前の版の記録が残っていても、決める人の保存が止まらない）
  const S = setup();
  const odd = { id: 'tipOdd', name: 'Kai One', rate: 'x', status: '?' };
  S.W.set(K('Kai One'), [...TIP0, odd], T0);
  assert.equal((await S.put('gm', K('Kai One'), [OLD, approve(P1), odd], S.ex(K('Kai One')))).status, 200);
  assert.equal((await S.put('gm', K('Kai One'), [OLD, approve(P1), { ...odd, rate: 'y' }], S.ex(K('Kai One')))).status, 400);
  // 名前の長すぎる行（201 字より長いキー）は書かない（SQL では公開の鍵でも書けない）
  assert.equal((await S.put('gm', K('x'.repeat(184)), [raise('x'.repeat(184))], { exists: false })).status, 400, 'a too-long key');
  // 読むのはこの関数では返さない（今までどおり REST）
  const g = await call({ action: 'get', key: K('Kai One'), pin_session: 'tgm' });
  assert.equal(g.status, 400);
});

test('writes only when the row read is unchanged: a different expect or a row written in between is 409 and nothing is written', async () => {
  const { W, put, ex } = setup();
  const e0 = ex(K('Kai One'));
  W.set(K('Kai One'), [...TIP0, { id: 'tipB', name: 'Kai One', rate: 100, status: '申請中', date: '2026/11/10' }], '2026-11-09T09:30:00.000000+00:00');
  const r = await put('gm', K('Kai One'), [OLD, approve(P1)], e0);
  assert.equal(r.status, 409);
  assert.equal(W.get(K('Kai One')).length, 3, 'the other device\'s request stays');
  assert.equal((await put('gm', K('Ria Two'), [raise('Ria Two')], { exists: true, updated_at: T0 })).status, 409, 'expected a row that is not there');
  // 確かめたあと書くまでにほかの端末が書いた
  const S = setup();
  S.W.afterGet = url => { if (!String(url).includes(encodeURIComponent(K('Kai One')))) return false; S.W.set(K('Kai One'), [OLD], '2026-11-09T09:45:00.000000+00:00'); return true; };
  const r2 = await S.put('gm', K('Kai One'), [OLD, approve(P1)]);
  assert.equal(r2.status, 409, JSON.stringify(r2.j));
  assert.deepEqual(S.W.get(K('Kai One')), [OLD]);
});

test('prep wage tables: GM and CEO only; prep certifications: GM and CEO, and Accounting only the "done" mark on an approved one', async () => {
  for (const who of ['gm', 'ceo', '@gm']) {
    const S = setup();
    const t2 = { ...TBL0, t2: { store: 'S1', from: '2026-12-01', levels: [{ lv: 1, name: 'L1', cents: 1800 }], by: 'Moto', at: 'x', _at: 1762900000000 } };
    assert.equal((await S.put(who, 'prep_tables', t2, S.ex('prep_tables'))).status, 200, who);
    const c3 = { ...CERTS0, c3: { ...CERT_OK, emp: 'E-2', name: 'Ria Two', store: 'S2', lv: 5, _at: 1762900000000 } };
    assert.equal((await S.put(who, 'prep_certs', c3, S.ex('prep_certs'))).status, 200, who);
  }
  for (const who of ['of', 'am', 'g4', 'chef', 'g1', '@of']) {
    const S = setup();
    assert.equal((await S.put(who, 'prep_tables', { ...TBL0, t1: { ...TBL0.t1, levels: [{ lv: 1, name: 'L1', cents: 9900 }], _at: 1762900000000 } }, S.ex('prep_tables'))).status, 403, who + ' table');
    assert.equal((await S.put(who, 'prep_certs', { ...CERTS0, c2: { ...CERT_PEND, state: 'approved', _at: 1762900000000 } }, S.ex('prep_certs'))).status, 403, who + ' approve a cert');
    assert.equal((await S.put(who, 'prep_certs', { ...CERTS0, c9: { ...CERT_OK, emp: 'E-1', lv: 5 } }, S.ex('prep_certs'))).status, 403, who + ' add a cert');
    assert.deepEqual(S.W.get('prep_certs'), CERTS0); assert.deepEqual(S.W.get('prep_tables'), TBL0);
  }
  const mark = { ...CERTS0, c1: { ...CERT_OK, toast: { by: 'Ofelia', at: '2026-11-10T01:00:00.000Z' }, _at: 1762900000000 } };
  for (const who of ['of', '@of']) {
    const S = setup();
    assert.equal((await S.put(who, 'prep_certs', mark, S.ex('prep_certs'))).status, 200, who + ' marks done');
    assert.deepEqual(S.W.get('prep_certs'), mark);
    assert.equal((await S.put(who, 'prep_certs', { ...mark, c1: { ...mark.c1, toast: { by: 'X', at: '2026-11-10T02:00:00.000Z' }, _at: 1762900000001 } }, S.ex('prep_certs'))).status, 403, who + ': not marked twice');
  }
  const office = {
    'a mark on a pending one': { ...CERTS0, c2: { ...CERT_PEND, toast: { by: 'O', at: '2026-11-10T01:00:00.000Z' }, _at: 9 } },
    'a mark that also changes the Lv': { ...CERTS0, c1: { ...CERT_OK, lv: 5, toast: { by: 'O', at: '2026-11-10T01:00:00.000Z' }, _at: 9 } },
    'a mark with something else in it': { ...CERTS0, c1: { ...CERT_OK, toast: { by: 'O', at: '2026-11-10T01:00:00.000Z', lv: 5 }, _at: 9 } },
    'removing a cert': { c1: CERT_OK, c2: null },
  };
  for (const [what, v] of Object.entries(office)) {
    const S = setup(); assert.equal((await S.put('of', 'prep_certs', v, S.ex('prep_certs'))).status, 403, what);
  }
  const S = setup();
  assert.equal((await S.put('gm', 'prep_tables', [1, 2], S.ex('prep_tables'))).status, 400, 'shape');
  assert.equal((await S.put('gm', 'prep_certs', { ...CERTS0, odd: 5 }, S.ex('prep_certs'))).status, 400, 'shape of a record');
  // 同じ値はだれでも書かずに通す
  const r = await S.put('g1', 'prep_certs', JSON.parse(JSON.stringify(CERTS0)), S.ex('prep_certs'));
  assert.equal(r.status, 200); assert.equal(r.j.same, true);
});

test('edges (mutation tests): a confirmed G3 whose role was raised to g4 does not decide; a decided record does not go back to pending even with a newer time; a decision does not rename a record; AM cannot mark "done"; Accounting cannot mark a table; sizes', async () => {
  {
    const S = setup({ wrLive: false });
    assert.equal((await S.put('g3g4', K('Kai One'), [OLD, approve(P1)], S.ex(K('Kai One')))).status, 403, 'grade is the narrower of the confirmed copy (G3) and the table (g4)');
    assert.deepEqual(S.W.get(K('Kai One')), TIP0);
  }
  {
    const S = setup();
    S.W.set(K('Kai One'), [OLD, approve(P1, '承認', 2000)], T0);
    const back = { ...approve(P1, '承認', 3000), status: '申請中' };
    assert.equal((await S.put('gm', K('Kai One'), [OLD, back], S.ex(K('Kai One')))).status, 403, 'decided → pending with a newer time');
    assert.deepEqual(S.W.get(K('Kai One')), [OLD, approve(P1, '承認', 2000)]);
  }
  {
    // 名前の違う記録（前の版のおかしな記録）を、決めるついでに名前を変えて決めない
    const S = setup();
    const stray = { id: 'tipS', name: 'Ria Two', rate: 90, status: '申請中', date: '2026/11/01' };
    S.W.set(K('Kai One'), [...TIP0, stray], T0);
    assert.equal((await S.put('gm', K('Kai One'), [...TIP0, approve({ ...stray, name: 'Kai One' })], S.ex(K('Kai One')))).status, 403);
    assert.deepEqual(S.W.get(K('Kai One')), [...TIP0, stray]);
  }
  {
    const mark = { ...CERTS0, c1: { ...CERT_OK, toast: { by: 'Amy', at: '2026-11-10T01:00:00.000Z' }, _at: 1762900000000 } };
    for (const who of ['am', 'g4', 'chef', 'g1', 'oc']) {
      const S = setup();
      assert.equal((await S.put(who, 'prep_certs', mark, S.ex('prep_certs'))).status, 403, who + ' marks done');
      assert.deepEqual(S.W.get('prep_certs'), CERTS0);
    }
    // 表には「反映した」の印も付けない（経理が書けるのは認定の印だけ）
    const S = setup();
    const tbl = { t1: { ...TBL0.t1, state: 'approved' } };
    S.W.set('prep_tables', tbl, T0);
    assert.equal((await S.put('of', 'prep_tables', { t1: { ...tbl.t1, toast: { by: 'O', at: '2026-11-10T01:00:00.000Z' }, _at: 1762900000000 } }, S.ex('prep_tables'))).status, 403);
  }
  {
    const S = setup();
    const many = Array.from({ length: 2001 }, (_, i) => ({ id: 'tipM' + i, name: 'Kai One', rate: 90, status: '申請中', date: '2026/11/10' }));
    assert.equal((await S.put('g1', K('Kai One'), many, S.ex(K('Kai One')))).status, 400, 'more than 2000 records');
    const big = [...TIP0, { id: 'tipBig', name: 'Kai One', rate: 90, status: '申請中', date: '2026/11/10', reason: 'x'.repeat(4000001) }];
    assert.equal((await S.put('g1', K('Kai One'), big, S.ex(K('Kai One')))).status, 400, 'over 4,000,000 characters');
    assert.deepEqual(S.W.get(K('Kai One')), TIP0);
  }
});

test('sign-in: a retired GM (email) is refused; the public key alone is refused; the v1145 keys are unchanged', async () => {
  const { put, call } = setup();
  assert.equal((await put('@gmout', K('Kai One'), [OLD, approve(P1)])).status, 401);
  const r = await call({ action: 'put', key: K('Kai One'), value: [OLD, approve(P1)] });
  assert.equal(r.status, 401);
  const S = setup(); S.W.set('grade_hist', { 'E-1': { recs: [], _at: 1 } }, T0);
  assert.equal((await S.put('am', 'grade_hist', { 'E-1': { recs: [], _at: 2 } }, S.ex('grade_hist'))).status, 403, 'v1145: GM/CEO only');
});

test('tpCheck: random edits by a staff member never decide anything; random decisions by the GM never delete or move a record', () => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const sts = ['申請中', '承認', '却下'];
  for (let i = 0; i < 400; i++) {
    const cloud = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, j) => ({ id: 't' + j, name: 'Kai One', rate: [80, 90, 100][j % 3], status: sts[Math.floor(rnd() * 3)], ...(rnd() < 0.5 ? { decAt: 1 + Math.floor(rnd() * 5) } : {}) }));
    const next = cloud.map(x => ({ ...x }));
    const k = Math.floor(rnd() * next.length);
    const op = Math.floor(rnd() * 6);
    if (op === 5) { next[k]['_dG'] = Math.floor(rnd() * 3); if (rnd() < 0.5) next[k].status = sts[Math.floor(rnd() * 3)]; }
    else if (op === 0) next[k].status = sts[Math.floor(rnd() * 3)];
    else if (op === 1) next[k].decAt = Math.floor(rnd() * 8);
    else if (op === 2) next.splice(k, 1);
    else if (op === 3) next.push({ id: 'n' + i, name: 'Kai One', rate: 100, status: sts[Math.floor(rnd() * 3)], ...(rnd() < 0.5 ? { decAt: 9 } : {}) });
    else next[k].rate = 100;
    const bare = x => x && JSON.stringify(Object.fromEntries(Object.entries(x).filter(([kk]) => !['_dG', '_stK', '_stT', '_dT', '_mut'].includes(kk))));
    const staff = tpCheck('spl_tip_requests_Kai One', cloud, next, { role: 'staff', name: 'Kai One' });
    if (staff === 'ok') {
      // 本人が通るのは、何も変えない（承認センターの印だけ）・申請中を足すだけ
      const ids = new Set(cloud.map(x => x.id));
      assert.ok(cloud.every(c => bare(next.find(n => n.id === c.id)) === bare(c)), 'staff changed nothing that existed');
      assert.ok(next.filter(n => !ids.has(n.id)).every(n => n.status === '申請中' && n.decAt == null), 'staff only adds pending');
    }
    // 決める人でない（dec なし）なら、GM の役割でも本人と同じ（役割では決めない：関数の tipDecider が決める）
    assert.equal(tpCheck('spl_tip_requests_Kai One', cloud, next, { role: 'gm', name: 'Gina M' }) === 'ok', tpCheck('spl_tip_requests_Kai One', cloud, next, { role: 'staff', name: 'Gina M' }) === 'ok');
    const gm = tpCheck('spl_tip_requests_Kai One', cloud, next, { role: 'gm', name: 'Gina M', dec: true });
    if (gm === 'ok') {
      assert.ok(cloud.every(c => next.some(n => n.id === c.id && n.name === c.name && Number(n.rate) === Number(c.rate))), 'nothing deleted, moved or re-rated');
      assert.ok(cloud.filter(c => c.status !== '申請中').every(c => { const n = next.find(x => x.id === c.id); return bare(n) === bare(c) || (n.status !== '申請中' && (Number(n.decAt) || 0) > (Number(c.decAt) || 0)); }), 'a decision changes only by a newer one');
    }
    // 本人は自分の分を決めない（dec があっても）
    const own = tpCheck('spl_tip_requests_Kai One', cloud, next, { role: 'gm', name: 'Kai One', dec: true });
    if (own === 'ok') assert.ok(cloud.every(c => bare(next.find(n => n.id === c.id)) === bare(c)), 'not their own');
  }
});
