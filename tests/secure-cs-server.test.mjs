// secure-state v1140（2b の 2 つ目）の関数：Career Score の点・申請・履歴を、見られる人の分だけ届ける・書き込みを確かめる。
// 合成データだけ（架空の人と店）。PostgREST・Auth・work-requests は tests/lib/secure-state-world.mjs の偽物。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, csIsKey, csParse, secretKey, ssIsKey, wrGrade, appGrade } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, JWT } from './lib/secure-state-world.mjs';

// ---- 架空の会社：店 S1・S2・S3 と本部 HQ
const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-CEO', name: 'Cal E', store: 'HQ', role: 'ceo', title: '' },
  { id: 'E-OF', name: 'Ofelia', store: 'HQ', role: 'office', title: 'Accountant' },
  { id: 'E-OC', name: 'Oscar', store: 'HQ', role: 'office_crew', title: 'Office Crew', data: { career: '経理' } },
  { id: 'E-HQ', name: 'Hana', store: 'HQ', role: 'office_crew', title: 'Office Crew' },
  { id: 'E-AM', name: 'Amy Area', store: 'S1', role: 'am', title: 'Area Manager' },
  { id: 'E-4', name: 'Leo Four', store: 'S1', role: 'g4', title: 'Store Manager' },
  { id: 'E-4b', name: 'Lia Four', store: 'S2', role: 'g4', title: 'Store Manager' },
  { id: 'E-3', name: 'Sam Three', store: 'S1', role: 'sl', title: 'Store Leader' },
  { id: 'E-3b', name: 'Tom Three', store: 'S1', role: 'sl', title: 'Kitchen Leader' },
  { id: 'E-2b', name: 'Gia Two', store: 'S1', role: 'g2', title: 'Crew Leader' },
  { id: 'E-5', name: 'Cory Corp', store: 'S1', role: 'chef', title: 'Corporate Chef' },
  { id: 'E-2', name: 'Cora Two', store: 'S1', role: 'g2', title: 'Crew Leader' },
  { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew' },
  { id: 'E-1s', name: 'Mei 応援', store: 'S2', role: 'crew', title: 'Crew', support: ['S1'] },
  { id: 'E-1b', name: 'Ben S2', store: 'S2', role: 'crew', title: 'Crew' },
  { id: 'E-1d', name: 'Dan S3', store: 'S3', role: 'crew', title: 'Crew' },
  { id: 'E-P', name: 'Pia Prep', store: 'S3', role: 'crew', title: 'Prep' },
  { id: 'E-CH', name: 'Chef Ken', store: 'S1', role: 'chef', title: 'Head Chef' },
  { id: 'E-OUT', name: 'Gone Crew', store: 'S1', role: 'crew', title: 'Crew', status: '退職' },
];
const U = n => 'aaaaaaaa-0000-0000-0000-00000000000' + n;
const MGR = { [U(1)]: { role: 'gm', emp_id: 'E-GM' }, [U(5)]: { role: 'ceo', emp_id: 'E-CEO' }, [U(2)]: { role: 'office', emp_id: 'E-OF' }, [U(3)]: { role: 'office_crew', emp_id: 'E-OC' }, [U(4)]: { role: 'office', emp_id: null } };
const USERS = { gm: U(1), of: U(2), oc: U(3), noemp: U(4) };
const WRP = [{ emp_id: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S2'] }, { emp_id: 'E-4', role: 'g4', grade: 4, stores: ['S1'] }, { emp_id: 'E-4b', role: 'g4', grade: 4, stores: ['S2'] }, { emp_id: 'E-CH', role: 'staff', grade: 4, chef: true, stores: ['S1'] },
  { emp_id: 'E-3', role: 'staff', grade: 3, stores: ['S1'] }, { emp_id: 'E-2', role: 'staff', grade: 2, stores: ['S1'] }];   // v1147：G2・G3 の店も確かめた写しで（Codex #141 P2-1）   // v1144：Head Chef は確かめた写しでも Head Chef（chef）
const ME = {
  gm: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M' },
  am: { emp: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S2'], name: 'Amy Area' },
  g4: { emp: 'E-4', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Leo Four', confirmed: true },
  g3: { emp: 'E-3', role: 'staff', grade: 3, stores: ['S1'], am_stores: [], name: 'Sam Three', confirmed: true },
  g2: { emp: 'E-2', role: 'staff', grade: 2, stores: ['S1'], am_stores: [], name: 'Cora Two', confirmed: true },
  g1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One' },
  chef: { emp: 'E-CH', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Chef Ken', confirmed: true },
};
const NAMES = EMPS.map(e => e.name);
const T0 = '2026-11-03T09:00:00.000000+00:00';

function setup(o = {}) {
  const W = makeWorld({ emps: EMPS.map(e => ({ ...e })), mgr: MGR, users: USERS, wrPeople: WRP.map(x => ({ ...x })), pins: Object.fromEntries(Object.entries(ME).map(([k, v]) => ['t' + k, v])), ...o });
  let clock = Date.UTC(2026, 10, 4, 10, 0, 0);
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  const handle = createHandler({ env, fetch: W.fetch, now: () => clock });
  const call = async (body, hdr = {}) => {
    const r = await handle(new Request('https://fn.test/secure-state', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ANON, ...hdr }, body: JSON.stringify(body) }));
    let j = null; try { j = await r.json(); } catch { j = null; }
    return { status: r.status, j };
  };
  const as = who => (who in ME ? { pin_session: 't' + who } : {});
  const hdr = who => (who in USERS ? { authorization: 'Bearer ' + JWT(who) } : {});
  const pullCs = async (who, have = {}) => call({ action: 'pull', cs_have: have, ...as(who) }, hdr(who));
  return { W, call, as, hdr, pullCs, tick: ms => { clock += ms; } };
}
const req = (id, name, status = '申請中', extra = {}) => ({ id, name, status, total: 50, ...extra });
function seed(W) {
  for (const n of NAMES) {
    W.set('lss_emp_' + n, { scores: { 'A-1': 1, 'A-2': 2 }, date: '2026/10/01', evaluator: 'seed', status: '確定', _at: 1, _by: 'seed' }, T0);
    W.set('spl_lss_requests_' + n, [req('r-' + n, n, '承認')], T0);
    W.set('spl_lss_history_' + n, [{ name: n, at: '2026-10-01', total: 40 }], T0);
  }
  W.set('lss_scores', Object.fromEntries(NAMES.map(n => [n, { s: { 'A-1': 1 } }])), T0);
  W.set('lss_requests', NAMES.map(n => req('old-' + n, n, '承認')), T0);
  W.set('lss_history', NAMES.map(n => ({ name: n, total: 10 })), T0);
  W.set('growth_karte', { 'E-1': { hireDate: '2024-01-05' } }, T0);
  W.set('m_other', { x: 1 }, T0);
}
const emps = j => j.cs.rows.filter(r => csParse(r.key).kind === 'emp').map(r => csParse(r.key).name).sort();
const sorted = a => [...a].sort();

test('the Career Score keys, their parse, and the secret-key list (SQL ss_secret_key) agree', () => {
  for (const k of ['lss_scores', 'lss_requests', 'lss_history', 'lss_emp_A', 'lss_emp_名前 空白', 'spl_lss_requests_A', 'spl_lss_history_A']) { assert.ok(csIsKey(k), k); assert.ok(secretKey(k), k); assert.ok(!ssIsKey(k), k); }
  for (const k of ['lss_emp_', 'spl_lss_requests_', 'spl_lss_history_', 'lss_scores2', 'lss_emp', 'spl_lss_request_A', 'skills', 'cs_criteria', 'career_cfg', '', null, 'lss_emp_' + 'x'.repeat(400)]) assert.ok(!csIsKey(k), String(k));
  assert.deepEqual(csParse('lss_emp_A B'), { kind: 'emp', name: 'A B' });
  assert.deepEqual(csParse('spl_lss_requests_Kai'), { kind: 'req', name: 'Kai' });
  assert.deepEqual(csParse('spl_lss_history_Kai'), { kind: 'hist', name: 'Kai' });
  assert.deepEqual(csParse('lss_requests'), { kind: 'legacy', name: '' });
  for (const k of ['growth_karte', 'spl_bonus_q_2026-Q3']) assert.ok(secretKey(k));
  assert.ok(!secretKey('m_other'));
  // グレード：SQL の wr_grade と同じ（肩書きと役割の大きいほう）。アプリの empGrade は肩書きが先
  assert.equal(wrGrade('Crew', 'am'), 5); assert.equal(wrGrade('Head Chef', 'crew'), 4); assert.equal(wrGrade('', 'crew'), 1); assert.equal(wrGrade(' Store Leader ', null), 3);
  assert.equal(appGrade('Crew', 'am'), 'G1'); assert.equal(appGrade('', 'sl'), 'G3'); assert.equal(appGrade('Office Crew Leader', 'office_crew'), 'G2');
});

test('a v1139 app (no cs_have) gets no Career Score section — the karte/bonus part is unchanged', async () => {
  const S = setup(); seed(S.W);
  const r = await S.call({ action: 'pull', ...S.as('gm') });
  assert.equal(r.status, 200); assert.equal(r.j.csfn, 1, 'the answer says the function knows Career Score'); assert.ok(!('cs' in r.j), 'no Career Score part for a v1139 app'); assert.equal(r.j.fn, 1);
  assert.ok(!r.j.index.some(x => csIsKey(x.key)), 'no Career Score key in the karte/bonus index');
  assert.deepEqual(r.j.rows.map(x => x.key), ['growth_karte']);
  const g = await S.call({ action: 'pull', ...S.as('g1') });
  assert.equal(g.j.level, 'proj'); assert.ok(!('names' in g.j));
});

test('GM / CEO: every point and request row and the old combined rows (history only on demand); unchanged rows are skipped', async () => {
  for (const indexMissing of [false, true]) {
    const S = setup({ indexMissing }); seed(S.W);
    const r = await S.pullCs('gm');
    assert.equal(r.status, 200); assert.equal(r.j.cs.level, 'full'); assert.equal(r.j.cs.names, null);
    const keys = r.j.cs.rows.map(x => x.key);
    assert.equal(keys.length, NAMES.length * 2 + 3);
    assert.ok(keys.includes('lss_scores') && keys.includes('lss_requests') && keys.includes('lss_history'));
    assert.ok(!keys.some(k => k.startsWith('spl_lss_history_')), 'history only on demand');
    assert.deepEqual(r.j.cs.rows.find(x => x.key === 'lss_scores').value, S.W.get('lss_scores'), 'the full old row, as it is');
    assert.ok(r.j.cs.rows.every(x => (indexMissing ? /^x:[0-9a-f]{64}$/ : /^h:[0-9a-f]{32}$/).test(x.v)));
    const have = Object.fromEntries(r.j.cs.index.map(x => [x.key, x.v]));
    delete have['lss_emp_Kai One'];
    const r2 = await S.pullCs('gm', have);
    assert.deepEqual(r2.j.cs.rows.map(x => x.key), ['lss_emp_Kai One']);
    assert.equal(r2.j.cs.index.length, r.j.cs.index.length);
  }
  const S = setup(); seed(S.W);
  const ceo = await S.call({ action: 'pull', cs_have: {} }, { authorization: 'Bearer ' + JWT('gm') });
  assert.equal(ceo.j.cs.level, 'full', 'GM by email too');
});

// 見られる人（Moto さん 11/04 の回答）
const SCOPES = {
  am: ['Amy Area', 'Leo Four', 'Lia Four', 'Sam Three', 'Tom Three', 'Cora Two', 'Gia Two', 'Kai One', 'Mei 応援', 'Ben S2', 'Chef Ken', 'Cory Corp'],   // 担当の店 S1・S2（応援も）。CEO・GM・本部・ほかの AM は入らない
  g4: ['Leo Four', 'Sam Three', 'Tom Three', 'Cora Two', 'Gia Two', 'Kai One', 'Mei 応援', 'Chef Ken'],               // 自分の店 S1 の G4 以下（応援の人も。G5 は入らない）
  g3: ['Sam Three', 'Cora Two', 'Gia Two', 'Kai One', 'Mei 応援'],                                               // 自分の店の G1・G2（ほかの G3 は入らない）
  g2: ['Cora Two', 'Kai One', 'Mei 応援'],                                                                       // Crew Leader：自分の店の G1（ほかの G2 は入らない）
  g1: ['Kai One'],                                                                                                // 自分だけ
  chef: NAMES.filter(n => !['Gina M', 'Cal E', 'Ofelia', 'Oscar', 'Hana', 'Amy Area', 'Gone Crew'].includes(n)),   // Head Chef：全店の人（申請と、その判断に要る点。CEO・GM・AM・本部の事務の人は入れない＝独立レビュー P2-3）
  of: ['Ofelia', 'Oscar', 'Hana', 'Chef Ken', 'Cory Corp'],                                                       // 経理：本部の人（Office管理のメンバー＝役割 office・office_crew・chef）
};
test('who sees whom: AM, G4, G3, Crew Leader, crew, Head Chef and the office get only their people (whole rows)', async () => {
  const S = setup(); seed(S.W);
  for (const [who, want] of Object.entries(SCOPES)) {
    const r = await S.pullCs(who);
    assert.equal(r.status, 200, who); assert.equal(r.j.cs.level, 'scoped', who);
    assert.deepEqual(r.j.cs.names, sorted(want), who);
    assert.deepEqual(emps(r.j), sorted(want), who + ': the points of exactly those people');
    for (const x of r.j.cs.rows) if (csParse(x.key).kind === 'emp') assert.deepEqual(x.value, S.W.get(x.key), 'whole rows');
    assert.ok(!r.j.cs.rows.some(x => x.key.startsWith('spl_lss_history_')));
    assert.ok(!r.j.cs.names.includes('Gone Crew'), 'retired people are not delivered');
    // 申請：Head Chef は全店（今のまま）。ほかは見られる人と同じ
    const reqNames = r.j.cs.rows.filter(x => csParse(x.key).kind === 'req').map(x => csParse(x.key).name).sort();
    if (who === 'chef') assert.deepEqual(reqNames, sorted(NAMES.filter(n => !['Gina M', 'Cal E', 'Ofelia', 'Oscar', 'Hana', 'Amy Area', 'Gone Crew'].includes(n))), 'Head Chef: every store request (not CEO/GM/AM, not the HQ office people)');
    else assert.deepEqual(reqNames, sorted(want), who);
  }
});

// Codex #138 P1-1（v1144）：社員の表の肩書き・役割だけで Head Chef の広い範囲（全店）にしない。GM・CEO が確かめた写し（chef）も要る
test('Head Chef needs the confirmed copy too: a G4 who edits their own title or role to chef keeps the G4 scope (Codex #138 P1-1)', async () => {
  for (const ch of [{ title: 'Head Chef' }, { role: 'chef' }, { title: 'Corporate Chef', role: 'chef' }]) {
    const S = setup(); seed(S.W);
    Object.assign(S.W.emps.find(e => e.id === 'E-4'), ch);
    const r = await S.pullCs('g4');
    assert.deepEqual(r.j.cs.names, sorted(SCOPES.g4), JSON.stringify(ch) + ': still the own store');
    assert.ok(!r.j.cs.names.includes('Ben S2'));
    assert.equal((await S.call({ action: 'get', key: 'lss_emp_Ben S2', ...S.as('g4') })).status, 403);
    // GM・CEO が確かめたあと（写しに chef）は全店
    S.W.wrPeople.find(x => x.emp_id === 'E-4').chef = true;
    assert.ok((await S.pullCs('g4')).j.cs.names.includes('Ben S2'), 'after the GM confirms: every store');
  }
  // 確かめた Head Chef でも、今の社員の表で Head Chef でなくなったら G4 の範囲（狭いほう）。写しの列がまだ無いときも
  { const S = setup(); seed(S.W); Object.assign(S.W.emps.find(e => e.id === 'E-CH'), { title: 'Store Manager', role: 'sl' });
    assert.ok(!(await S.pullCs('chef')).j.cs.names.includes('Ben S2')); }
  { const S = setup({ wrNoChef: true }); seed(S.W); assert.ok(!(await S.pullCs('chef')).j.cs.names.includes('Ben S2'), 'no chef column yet'); }
});

test('the old combined rows reach scoped people only as the part about their people, and are versioned per scope', async () => {
  const S = setup(); seed(S.W);
  const r = await S.pullCs('g3');
  const sc = r.j.cs.rows.find(x => x.key === 'lss_scores');
  assert.deepEqual(Object.keys(sc.value).sort(), sorted(SCOPES.g3));
  assert.deepEqual(r.j.cs.rows.find(x => x.key === 'lss_requests').value.map(x => x.name).sort(), sorted(SCOPES.g3));
  assert.deepEqual(r.j.cs.rows.find(x => x.key === 'lss_history').value.map(x => x.name).sort(), sorted(SCOPES.g3));
  assert.match(sc.v, /^p:[0-9a-f]{64}$/);
  const r1 = await S.pullCs('g1');
  assert.notEqual(r1.j.cs.rows.find(x => x.key === 'lss_scores').v, sc.v, 'another scope, another version');
  // 同じ人・同じ行：同じ印で、送らない
  const have = Object.fromEntries(r.j.cs.index.map(x => [x.key, x.v]));
  const r2 = await S.pullCs('g3', have);
  assert.equal(r2.j.cs.rows.length, 0);
  // 見られる人が変わる（Kai さんが S2 へ）：前の統合行の印も変わり、届き直す
  S.W.emps.find(e => e.id === 'E-1').store = 'S2';
  const r3 = await S.pullCs('g3', have);
  assert.ok(r3.j.cs.rows.some(x => x.key === 'lss_scores'));
  assert.ok(!r3.j.cs.names.includes('Kai One'));
  S.W.emps.find(e => e.id === 'E-1').store = 'S1';
});

test('store edits in the publicly writable employees table cannot pull a CEO/GM/office/AM into a store scope', async () => {
  const S = setup(); seed(S.W);
  for (const id of ['E-GM', 'E-CEO', 'E-OF', 'E-AM']) S.W.emps.find(e => e.id === id).store = 'S1';
  S.W.emps.find(e => e.id === 'E-GM').title = 'Crew'; S.W.emps.find(e => e.id === 'E-GM').role = 'crew';
  S.W.emps.find(e => e.id === 'E-CEO').role = 'office_crew';   // 本部の人に見せかける
  S.W.emps.push({ id: 'E-AM2', name: 'Abe Area', store: 'S1', role: 'crew', title: 'Crew' });
  S.W.wrPeople.push({ emp_id: 'E-AM2', role: 'am', grade: 5 });   // GM・CEO が確かめた AM（社員の表は crew と書き換えられている）
  for (const who of ['am', 'g4', 'g3', 'g2', 'chef', 'of']) {
    const r = await S.pullCs(who);
    for (const n of ['Gina M', 'Cal E', 'Ofelia', 'Amy Area', 'Abe Area']) if (!(who === 'am' && n === 'Amy Area') && !(who === 'of' && n === 'Ofelia')) assert.ok(!r.j.cs.names.includes(n), who + ' must not see ' + n);
  }
  // 確かめた写し（wr_people）のグレードが社員の表より上なら、上を使う（G4 の店の人を G1 と書き換えても G3 の範囲に入らない）
  S.W.emps.find(e => e.id === 'E-4').title = 'Crew'; S.W.emps.find(e => e.id === 'E-4').role = 'crew';
  const r = await S.pullCs('g3');
  assert.ok(!r.j.cs.names.includes('Leo Four'));
});

test('Score管理 (career_cfg) grants: view for any of the three roles; G4/G3 only for people of their own stores; not CEO/GM, not a confirmed AM', async () => {
  const S = setup(); seed(S.W);
  S.W.set('career_cfg', { '経理|G1': { csView: ['g4', 'am'], csEdit: [], csApprove: [] }, '調理|G4': { csView: ['sl'] } });
  assert.ok((await S.pullCs('am')).j.cs.names.includes('Oscar'), 'AM given 経理|G1 sees the office crew (a manager_auth person, but not CEO/GM)');
  const r = await S.pullCs('g4');
  assert.ok(!r.j.cs.names.includes('Oscar'), 'a grant to G4 stops at the G4’s own stores (Oscar is HQ)');
  assert.ok(!r.j.cs.names.includes('Hana'), 'no career row for her');
  const g3 = await S.pullCs('g3');
  assert.ok(g3.j.cs.names.includes('Chef Ken'), 'G3 given 調理|G4 sees the Head Chef of the same store');
  // 付ける・承認する役に入れた役も見られる（アプリの cgCsGranted と同じ）
  S.W.set('career_cfg', { '経理|G1': { csApprove: ['am'] } });
  assert.ok((await S.pullCs('am')).j.cs.names.includes('Oscar'));
  // G4 に選ばれても、G5 の人は見せない（G4 は G4 以下）
  S.W.set('career_cfg', { '調理|G5': { csView: ['g4', 'sl'] } });
  assert.ok(!(await S.pullCs('g4')).j.cs.names.includes('Cory Corp'), 'a grant to G4 stops at G4');
  assert.ok((await S.pullCs('g3')).j.cs.names.includes('Cory Corp'), 'the same row granted to G3 (no grade cap, same store) does show');
  S.W.emps.find(e => e.id === 'E-5').store = 'S2';
  assert.ok(!(await S.pullCs('g3')).j.cs.names.includes('Cory Corp'), '… but not when that person is in another store');
  S.W.set('career_cfg', { '経理|G1': { csView: ['am'], _deleted: true } });
  assert.ok(!(await S.pullCs('am')).j.cs.names.includes('Oscar'), 'a deleted row grants nothing');
});

test('the office by email sees the HQ people; an office account without an employee link, a store login and a bad PIN get nothing', async () => {
  const S = setup(); seed(S.W);
  const of = await S.call({ action: 'pull', cs_have: {} }, { authorization: 'Bearer ' + JWT('of') });
  assert.deepEqual(of.j.cs.names, sorted(SCOPES.of));
  const ne = await S.call({ action: 'pull', cs_have: {} }, { authorization: 'Bearer ' + JWT('noemp') });
  assert.equal(ne.j.cs.level, 'none'); assert.deepEqual(ne.j.cs.rows, []);
  S.W.pins.tstore = 'deny';
  const st = await S.call({ action: 'pull', cs_have: {}, pin_session: 'tstore' });
  assert.equal(st.status, 401);
  assert.equal((await S.call({ action: 'hist', pin_session: 'tstore' })).status, 401);
  assert.equal((await S.call({ action: 'hist' }, { authorization: 'Bearer ' + JWT('noemp') })).status, 403);
});

test('if the people tables cannot be read, the Career Score section says so (the device keeps its copy) and the rest still works', async () => {
  const S = setup(); seed(S.W);
  S.W.mgrDown = true;
  const r = await S.pullCs('g3');
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.cs, { error: 'scope' });
  assert.ok(r.j.rows.some(x => x.key === 'growth_karte'), 'the karte projection still came');
});

test('get: inside the scope a whole row; outside 403; the old combined rows projected', async () => {
  const S = setup(); seed(S.W);
  const ok = await S.call({ action: 'get', key: 'lss_emp_Kai One', ...S.as('g2') });
  assert.equal(ok.status, 200); assert.deepEqual(ok.j.value, S.W.get('lss_emp_Kai One'));
  assert.equal((await S.call({ action: 'get', key: 'lss_emp_Sam Three', ...S.as('g2') })).status, 403);
  assert.equal((await S.call({ action: 'get', key: 'lss_emp_Ben S2', ...S.as('g4') })).status, 403);
  const lg = await S.call({ action: 'get', key: 'lss_scores', ...S.as('g1') });
  assert.deepEqual(Object.keys(lg.j.value), ['Kai One']); assert.equal(lg.j.proj, true);
  const none = await S.call({ action: 'get', key: 'lss_emp_No Body', ...S.as('gm') });
  assert.deepEqual([none.j.exists, none.j.value], [false, null]);
  // Head Chef：全店の人の申請と点（判断に要る点）。CEO・GM・AM・本部の事務の人は入らない
  assert.equal((await S.call({ action: 'get', key: 'spl_lss_requests_Lia Four', ...S.as('chef') })).status, 200);
  assert.equal((await S.call({ action: 'get', key: 'lss_emp_Lia Four', ...S.as('chef') })).status, 200);
  for (const n of ['Gina M', 'Amy Area', 'Oscar']) assert.equal((await S.call({ action: 'get', key: 'lss_emp_' + n, ...S.as('chef') })).status, 403, n);
});

test('history on demand: only the people in the scope; the GM gets every history row', async () => {
  const S = setup(); seed(S.W);
  const g = await S.call({ action: 'hist', ...S.as('g3') });
  assert.deepEqual(g.j.rows.map(x => csParse(x.key).name).sort(), sorted(SCOPES.g3));
  assert.deepEqual(g.j.names, sorted(SCOPES.g3));
  const gm = await S.call({ action: 'hist', ...S.as('gm') });
  assert.equal(gm.j.rows.length, NAMES.length); assert.equal(gm.j.names, null);
});

const put = (S, who, key, value, expect) => S.call({ action: 'put', key, value, ...(expect ? { expect } : {}), ...S.as(who) }, S.hdr(who));
// OJT の合格で分野の下限を上げる（アプリの g2RaiseAxisFloor と同じ形：点を上げ、日付・OJT の印・保存の印を変える）
const raised = (W, key, up) => { const c = W.get(key) || { scores: {} }; return { ...c, scores: { ...(c.scores || {}), ...up }, date: '2026/11/04', autoOjt: true, _at: 50, _by: 'Signer' }; };
test('points (lss_emp_): AM and the approver roles write as they like; OJT signers (G3 and up) only raise floors of G1/G2 below them; nobody writes their own', async () => {
  const S = setup(); seed(S.W);
  const v = { scores: { 'A-1': 3 }, _at: 9, _by: 'x' };
  assert.equal((await put(S, 'am', 'lss_emp_Ben S2', v)).status, 200, 'AM: a person in the AM stores');
  assert.equal((await put(S, 'am', 'lss_emp_Sam Three', v)).status, 200);
  // OJT の合格：G3 以上が、見られる G1（上限 2）・G2（上限 3）で自分より下のグレードの人の点を上げるだけ
  assert.equal((await put(S, 'g3', 'lss_emp_Kai One', raised(S.W, 'lss_emp_Kai One', { 'A-1': 2, 'B-1': 2 }))).status, 200, 'G3 → a G1 of the store');
  assert.equal((await put(S, 'g3', 'lss_emp_Cora Two', raised(S.W, 'lss_emp_Cora Two', { 'A-1': 3, 'A-2': 3 }))).status, 200, 'G3 → a G2 of the store (G2→G3 OJT, up to 3)');
  assert.equal((await put(S, 'chef', 'lss_emp_Dan S3', raised(S.W, 'lss_emp_Dan S3', { 'A-1': 2 }))).status, 200, 'Head Chef: a G1 anywhere');
  assert.equal((await put(S, 'chef', 'lss_emp_Gia Two', raised(S.W, 'lss_emp_Gia Two', { 'A-1': 3 }))).status, 200, 'Head Chef: a G2 anywhere');
  assert.equal((await put(S, 'g4', 'lss_emp_Mei 応援', raised(S.W, 'lss_emp_Mei 応援', { 'A-1': 2 }))).status, 200, 'G4 → a G1 helping in the store');
  assert.deepEqual(S.W.get('lss_emp_Kai One').scores, { 'A-1': 2, 'A-2': 2, 'B-1': 2 });
  // 下げる・消す・上限を超える・ほかの欄を変える・評価者を変える：断る（独立レビュー P2-2）
  const k = 'lss_emp_Kai One', cur = S.W.get(k);
  const bad = {
    'lower': { ...cur, scores: { ...cur.scores, 'A-1': 1 }, _at: 60 },
    'remove': { ...cur, scores: { 'A-1': 2 }, _at: 60 },
    'above the cap for a G1': { ...cur, scores: { ...cur.scores, 'C-1': 3 }, _at: 60 },
    'not a whole number': { ...cur, scores: { ...cur.scores, 'C-1': 1.5 }, _at: 60 },
    'a text score': { ...cur, scores: { ...cur.scores, 'C-1': '2' }, _at: 60 },
    'another field': { ...cur, comment: 'x', _at: 60 },
    'the evaluator': { ...cur, evaluator: 'Someone', _at: 60 },
    'the status': { ...cur, status: '申請中', _at: 60 },
    'the OJT mark (not true)': { ...cur, scores: { ...cur.scores, 'C-1': 2 }, autoOjt: 'x', _at: 60 },
    'no scores': { ...cur, scores: undefined, _at: 60 },
    'replace everything': { scores: { 'A-1': 2, 'A-2': 2, 'B-1': 2 } },
  };
  for (const [what, val] of Object.entries(bad)) assert.equal((await put(S, 'g3', k, val)).status, 403, what);
  assert.deepEqual(S.W.get(k), cur, 'nothing written');
  for (const [who, key] of [['g2', 'lss_emp_Kai One'], ['g1', 'lss_emp_Kai One'], ['g4', 'lss_emp_Sam Three'], ['g4', 'lss_emp_Chef Ken'], ['g4', 'lss_emp_Lia Four'],
    ['g3', 'lss_emp_Tom Three'], ['g3', 'lss_emp_Ben S2'], ['g3', 'lss_emp_Sam Three'], ['chef', 'lss_emp_Leo Four'], ['chef', 'lss_emp_Sam Three'], ['am', 'lss_emp_Amy Area'], ['am', 'lss_emp_Dan S3'], ['of', 'lss_emp_Oscar']]) {
    const r = await put(S, who, key, raised(S.W, key, { 'Z-9': 2 }));
    assert.equal(r.status, 403, who + ' → ' + key);
  }
  // 点の行がまだ無い G1：前の統合行のその人の分から上げる（アプリの getLssScores と同じ）
  S.W.emps.push({ id: 'E-NEW', name: 'New One', store: 'S1', role: 'crew', title: 'Crew' });
  S.W.set('lss_scores', { ...S.W.get('lss_scores'), 'New One': { scores: { 'A-1': 2 }, evaluator: 'old' } });
  assert.equal((await put(S, 'g3', 'lss_emp_New One', { scores: { 'A-1': 1, 'B-1': 2 }, evaluator: 'old', autoOjt: true, _at: 3 })).status, 403, 'not lower than the old combined row');
  assert.equal((await put(S, 'g3', 'lss_emp_New One', { scores: { 'A-1': 2, 'B-1': 2 }, evaluator: 'old', status: '確定', autoOjt: true, _at: 3 })).status, 200);
  // Score管理：承認する役は点を書く（承認すると点と履歴を書く）。付ける役は AM だけが直接、AM より下は申請
  S.W.set('career_cfg', { '経理|G1': { csEdit: ['office'] }, '経理|G4': { csEdit: ['office'], csApprove: ['office'] } });
  assert.equal((await put(S, 'of', 'lss_emp_Oscar', v)).status, 403, 'office given csEdit only: a request, not a direct write');
  S.W.set('career_cfg', { '経理|G1': { csApprove: ['office'] }, '経理|G4': { csEdit: ['office'], csApprove: ['office'] } });
  assert.equal((await put(S, 'of', 'lss_emp_Oscar', v)).status, 200, 'office given csApprove');
  assert.equal((await put(S, 'of', 'spl_lss_history_Oscar', [...S.W.get('spl_lss_history_Oscar'), { name: 'Oscar', total: 1 }])).status, 200, '… and the history of that approval');
  assert.equal((await put(S, 'of', 'lss_emp_Ofelia', v)).status, 403, 'a role given to their own career row still cannot write their own points');
  assert.equal((await put(S, 'of', 'spl_lss_history_Ofelia', [...S.W.get('spl_lss_history_Ofelia'), { name: 'Ofelia', total: 1 }])).status, 403, '… or their own history');
  S.W.set('career_cfg', { '経理|G1': { csEdit: ['am'] } });
  assert.equal((await put(S, 'am', 'lss_emp_Oscar', v)).status, 200, 'AM given csEdit writes directly (as the app does)');
  S.W.set('career_cfg', { '経理|G1': { csView: ['am'] } });
  assert.equal((await put(S, 'am', 'lss_emp_Oscar', v)).status, 403, 'AM given csView only: sees, does not write');
  assert.equal((await put(S, 'am', 'lss_emp_Ben S2', [1])).status, 400, 'points are an object');
  assert.equal((await put(S, 'gm', 'lss_emp_Ben S2', [1])).status, 200, 'CEO/GM write as before (no checks)');
});

test('requests: no request is dropped, every entry is that person’s, and a person only adds pending requests or cancels their own', async () => {
  const S = setup(); seed(S.W);
  const K = 'spl_lss_requests_Kai One';
  const cur = S.W.get(K);
  // 本人：新しい申請（申請中）を足す
  assert.equal((await put(S, 'g1', K, [...cur, req('n1', 'Kai One')])).status, 200);
  assert.equal((await put(S, 'g1', K, [...S.W.get(K), req('n2', 'Kai One', '承認')])).status, 403, 'not an approved one');
  // 本人：自分の申請を取り下げる
  const c2 = S.W.get(K).map(r => r.id === 'n1' ? { ...r, status: '取消', supersededAt: 5 } : r);
  assert.equal((await put(S, 'g1', K, c2)).status, 200);
  const c3 = S.W.get(K).map(r => r.id === 'r-Kai One' ? { ...r, status: '却下' } : r);
  assert.equal((await put(S, 'g1', K, c3)).status, 403, 'not deciding an approved one');
  const c4 = S.W.get(K).map(r => r.id === 'n1' ? { ...r, total: 99 } : r);
  assert.equal((await put(S, 'g1', K, c4)).status, 403, 'not editing the content');
  assert.equal((await put(S, 'g1', K, S.W.get(K).filter(r => r.id !== 'n1'))).status, 403, 'no request dropped');
  assert.equal((await put(S, 'g1', K, [...S.W.get(K), req('x', 'Cora Two')])).status, 400, 'no other person’s entry');
  // G2 の申請の行で自分で承認しない
  assert.equal((await put(S, 'g2', 'spl_lss_requests_Cora Two', [...S.W.get('spl_lss_requests_Cora Two'), req('y', 'Cora Two', '承認')])).status, 403);
  // 見られる人の申請を決める（G4：自分の店の G3 の申請を承認）
  S.W.set('spl_lss_requests_Sam Three', [req('p1', 'Sam Three')]);
  assert.equal((await put(S, 'g4', 'spl_lss_requests_Sam Three', [{ ...req('p1', 'Sam Three'), status: '承認', reviewedBy: 'Leo Four' }])).status, 200);
  assert.equal((await put(S, 'g4', 'spl_lss_requests_Ben S2', [req('z', 'Ben S2')])).status, 403, 'outside the scope');
  // Head Chef：全店の申請
  assert.equal((await put(S, 'chef', 'spl_lss_requests_Lia Four', [...S.W.get('spl_lss_requests_Lia Four'), req('h', 'Lia Four')])).status, 200);
  assert.equal((await put(S, 'g2', 'spl_lss_requests_Mei 応援', 'x')).status, 400);
});

test('history: append only, AM or a Score管理 role; the old combined rows are written by CEO/GM only', async () => {
  const S = setup(); seed(S.W);
  const K = 'spl_lss_history_Ben S2';
  assert.equal((await put(S, 'am', K, [...S.W.get(K), { name: 'Ben S2', at: '2026-11-04', total: 55 }])).status, 200);
  assert.equal((await put(S, 'am', K, [{ name: 'Ben S2', at: '2026-11-04', total: 55 }])).status, 403, 'not dropping old history');
  assert.equal((await put(S, 'am', K, S.W.get(K).map(x => ({ ...x, total: 1 })))).status, 403, 'not rewriting');
  assert.equal((await put(S, 'g4', 'spl_lss_history_Kai One', [...S.W.get('spl_lss_history_Kai One'), { name: 'Kai One', total: 3 }])).status, 403, 'G4 does not write history');
  assert.equal((await put(S, 'am', 'spl_lss_history_Amy Area', [...S.W.get('spl_lss_history_Amy Area'), { name: 'Amy Area', total: 3 }])).status, 403, 'not their own');
  // 並びとキーの順が違っても同じ記録（クラウドの jsonb はキーを並べ替える）
  const re = S.W.get(K).map(x => Object.fromEntries(Object.entries(x).reverse())).reverse();
  assert.equal((await put(S, 'am', K, [...re, { total: 60, name: 'Ben S2' }])).status, 200);
  for (const who of ['am', 'g4', 'g1', 'chef']) for (const k of ['lss_scores', 'lss_requests', 'lss_history']) assert.equal((await put(S, who, k, {})).status, 403, who + ' ' + k);
  assert.equal((await S.call({ action: 'put', key: 'lss_scores', value: {} }, { authorization: 'Bearer ' + JWT('of') })).status, 403);
  assert.equal((await put(S, 'gm', 'lss_scores', { a: 1 })).status, 200);
});

test('scoped writes are compare-and-write: a stale read (or a row that appeared) is a conflict, and nothing is written', async () => {
  const S = setup(); seed(S.W);
  const K = 'lss_emp_Ben S2';
  const g = await S.call({ action: 'get', key: K, ...S.as('am') });
  S.W.set(K, { s: { 'A-1': 1 }, _at: 5 }, '2026-11-04T09:30:00.000000+00:00');
  const r = await put(S, 'am', K, { s: { 'A-1': 3 }, _at: 9 }, { exists: true, updated_at: g.j.updated_at });
  assert.equal(r.status, 409);
  assert.deepEqual(S.W.get(K), { s: { 'A-1': 1 }, _at: 5 });
  assert.equal((await put(S, 'am', 'lss_emp_New Hire', { s: {} }, { exists: false })).status, 403, 'a name nobody has is outside every scope');
  S.W.emps.push({ id: 'E-NEW', name: 'New Hire', store: 'S2', role: 'crew', title: 'Crew' });
  assert.equal((await put(S, 'am', 'lss_emp_New Hire', { s: {} }, { exists: false })).status, 200);
  assert.equal((await put(S, 'am', 'lss_emp_New Hire', { s: { b: 1 } }, { exists: false })).status, 409, 'the row exists now');
  const r2 = await put(S, 'am', 'lss_emp_New Hire', { s: { b: 2 } });
  assert.equal(r2.status, 200, 'without expect: written against what was just read');
  assert.equal((await put(S, 'am', K, { s: {} }, { exists: true, updated_at: 'not-a-time' })).status, 400);
});

test('a write is checked against the row it read: another device writing in between makes it a conflict', async () => {
  const S = setup(); seed(S.W);
  const K = 'spl_lss_requests_Ben S2';
  const other = [...S.W.get(K), req('o1', 'Ben S2')];
  S.W.afterGet = u => { if (!decodeURIComponent(u.search).includes('key=in.("' + K + '")')) return false; S.W.set(K, other, '2026-11-04T09:59:00.000000+00:00'); return true; };   // 関数がその行を読んだ直後に、ほかの端末が申請を足す
  const r = await put(S, 'am', K, [...S.W.get(K), req('a1', 'Ben S2')]);
  assert.equal(r.status, 409);
  assert.deepEqual(S.W.get(K), other, 'the other device’s request is still there');
});

test('the name from the PIN mark is self only when that name belongs to that person alone (the employees table, or the copy the GM/CEO confirmed)', async () => {
  const S = setup(); seed(S.W);
  S.W.set('lss_emp_Kai O.', { scores: {}, _at: 1 });
  S.W.set('spl_lss_requests_Kai O.', [req('ko', 'Kai O.', '承認')]);
  // 印の名前を持つ人が社員の表にいない（確かめていない）：本人とみなさない（名前は公開の鍵で書き換えられるので、印の名前だけでは決めない）
  S.W.pins.tre = { ...ME.g1, name: 'Kai O.' };
  const r = await S.call({ action: 'pull', cs_have: {}, pin_session: 'tre' });
  assert.ok(!r.j.cs.names.includes('Kai O.'));
  assert.ok(r.j.cs.names.includes('Kai One'), 'the name in the employees table is still self');
  assert.equal((await S.call({ action: 'get', key: 'lss_emp_Kai O.', pin_session: 'tre' })).status, 403);
  // GM・CEO が確かめた写しの名前（社員の表はまだ前の名前）：本人
  S.W.wrPeople.push({ emp_id: 'E-1', name: 'Kai O.', role: 'staff', grade: 1 });
  const r2 = await S.call({ action: 'pull', cs_have: {}, pin_session: 'tre' });
  assert.ok(r2.j.cs.names.includes('Kai O.'));
  assert.ok(r2.j.cs.rows.some(x => x.key === 'lss_emp_Kai O.'));
  assert.equal((await S.call({ action: 'put', key: 'lss_emp_Kai O.', value: { scores: {} }, pin_session: 'tre' })).status, 403, 'not their own points');
});

test('names with spaces and Japanese go through as they are; a PIN name that differs only by surrounding spaces is still self', async () => {
  const S = setup(); seed(S.W);
  S.W.pins.tsp = { ...ME.g1, name: ' Kai One ' };
  const r = await S.call({ action: 'pull', cs_have: {}, pin_session: 'tsp' });
  assert.ok(r.j.cs.names.includes('Kai One'));
  assert.ok(r.j.cs.names.includes(' Kai One '));
  assert.equal((await S.call({ action: 'put', key: 'lss_emp_Kai One', value: { scores: {} }, pin_session: 'tsp' })).status, 403, 'still not their own points');
  assert.equal((await put(S, 'g3', 'lss_emp_Mei 応援', raised(S.W, 'lss_emp_Mei 応援', { 'A-1': 2 }))).status, 200);
  // 前後に空白のある名前をほかの人が持っている：その名前は本人のものとみなさない
  S.W.emps.find(e => e.id === 'E-1b').name = ' Kai One ';
  const r2 = await S.call({ action: 'pull', cs_have: {}, pin_session: 'tsp' });
  assert.ok(r2.j.cs.names.includes('Kai One'));
  assert.ok(!r2.j.cs.names.includes(' Kai One '));
});

// 独立レビュー P1-1：点・申請・履歴は名前で持っていて、社員の表の名前は公開の鍵で書き換えられる。名前を書き換えても、ほかの人の点を読めない・書けない
test('renaming rows in the publicly writable employees table does not hand out someone else’s Career Score', async () => {
  const S = setup(); seed(S.W);
  const rn = (id, name) => { S.W.emps.find(e => e.id === id).name = name; };
  const reads = async (who, n) => {
    const r = await S.pullCs(who);
    const got = r.j.cs.names.includes(n) || r.j.cs.rows.some(x => csParse(x.key).name === n);
    const lg = r.j.cs.rows.find(x => x.key === 'lss_scores');
    return got || !!(lg && Object.prototype.hasOwnProperty.call(lg.value, n));
  };
  const blocked = async (who, n) => {
    assert.ok(!(await reads(who, n)), who + ' must not get ' + n);
    assert.equal((await S.call({ action: 'get', key: 'lss_emp_' + n, ...S.as(who) }, S.hdr(who))).status, 403, who + ' get ' + n);
    assert.equal((await S.call({ action: 'hist', ...S.as(who) }, S.hdr(who))).j.rows.some(x => csParse(x.key).name === n), false, who + ' history ' + n);
    assert.equal((await put(S, who, 'spl_lss_requests_' + n, [...(S.W.get('spl_lss_requests_' + n) || []), req('evil', n)])).status, 403, who + ' request on ' + n);
    assert.equal((await put(S, who, 'lss_emp_' + n, raised(S.W, 'lss_emp_' + n, { 'Z-1': 2 }))).status, 403, who + ' points of ' + n);
    assert.equal((await put(S, who, 'spl_lss_history_' + n, [...(S.W.get('spl_lss_history_' + n) || []), { name: n, total: 1 }])).status, 403, who + ' history of ' + n);
  };
  // 1) 事務Crew が自分の行の名前を GM の名前に
  rn('E-OC', 'Gina M');
  await blocked('oc', 'Gina M');
  rn('E-OC', 'Oscar');
  // 2) G3 が自分の店の G1 の名前を GM・CEO・経理・AM の名前に
  for (const n of ['Gina M', 'Cal E', 'Ofelia', 'Amy Area']) { rn('E-1', n); await blocked('g3', n); }
  rn('E-1', 'Kai One');
  // 3) 見られる人の名前を、ほかの店の人・同じ店の G3 の名前に
  for (const n of ['Ben S2', 'Tom Three']) { rn('E-1', n); await blocked('g3', n); }
  rn('E-1', 'Kai One');
  // 3b) AM：担当の店の人の名前を、担当の外の人（S3）の名前に
  rn('E-1', 'Dan S3'); await blocked('am', 'Dan S3'); rn('E-1', 'Kai One');
  // 4) 退職した人の名前に（退職した人の点も守る）
  rn('E-1', 'Gone Crew'); await blocked('g3', 'Gone Crew'); rn('E-1', 'Kai One');
  // 5) 確かめた AM の社員の表の名前も書き換えて、空いた名前を見られる人に付ける：確かめた写しの名前で守る
  S.W.emps.push({ id: 'E-AM2', name: 'Abe Area', store: 'S2', role: 'am', title: 'Area Manager' });
  S.W.wrPeople.push({ emp_id: 'E-AM2', name: 'Abe Area', role: 'am', grade: 5 });
  S.W.set('lss_emp_Abe Area', { scores: { 'A-1': 3 }, _at: 1 }); S.W.set('spl_lss_requests_Abe Area', []);
  rn('E-AM2', 'Zed'); rn('E-1', 'Abe Area');
  await blocked('g3', 'Abe Area');
  S.W.emps = S.W.emps.filter(e => e.id !== 'E-AM2');   // 社員の表の行が無い（確かめた写しだけ）
  await blocked('g3', 'Abe Area');
  rn('E-1', 'Kai One');
  // 6) 自分の名前をほかの人と同じにする：その名前は本人のものとしても渡さない（だれの点か分からない）
  rn('E-1b', 'Kai One');
  const g1 = await S.pullCs('g1');
  assert.ok(!g1.j.cs.names.includes('Kai One'));
  assert.equal((await put(S, 'g1', 'spl_lss_requests_Kai One', [...S.W.get('spl_lss_requests_Kai One'), req('n9', 'Kai One')])).status, 403);
  rn('E-1b', 'Ben S2');
  // 戻せば今までどおり
  assert.ok((await S.pullCs('g1')).j.cs.names.includes('Kai One'));
  assert.ok((await S.pullCs('g3')).j.cs.names.includes('Kai One'));
});

test('the same person twice (a retired duplicate record with the same name): only CEO/GM get the name; adding （重複） to the retired record gives it back (db/employee-dup-rename.sql)', async () => {
  const S = setup(); seed(S.W);
  S.W.emps.push({ id: 'E-1x', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew', status: '', data: { name: 'Kai One', status: '退職', resignDate: '2026-07-03' } });
  for (const who of ['g1', 'g3', 'g4', 'am']) {
    assert.ok(!(await S.pullCs(who)).j.cs.names.includes('Kai One'), who + ' while two records hold the name');
    assert.equal((await S.call({ action: 'get', key: 'lss_emp_Kai One', ...S.as(who) }, S.hdr(who))).status, 403, who + ' get');
  }
  assert.ok(emps((await S.pullCs('gm')).j).includes('Kai One'), 'CEO/GM still get it');
  // what db/employee-dup-rename.sql writes: the column name and data.name of the retired record
  const x = S.W.emps.find(e => e.id === 'E-1x'); x.name = 'Kai One（重複）'; x.data = { ...x.data, name: 'Kai One（重複）' };
  for (const who of ['g1', 'g3', 'g4', 'am']) {
    const r = await S.pullCs(who);
    assert.ok(r.j.cs.names.includes('Kai One'), who + ' after the rename');
    assert.ok(!r.j.cs.names.includes('Kai One（重複）'), who + ': a retired record is in nobody’s scope');
  }
  assert.ok(emps((await S.pullCs('g1')).j).includes('Kai One'), 'the person gets their own points again');
});

test('a server that returns fewer rows per page than asked (max-rows) still gives every Career Score row (read until an empty page)', async () => {
  const S = setup({ indexMissing: true, maxRows: 7 }); seed(S.W);
  const r = await S.pullCs('gm');
  assert.equal(r.j.cs.rows.length, NAMES.length * 2 + 3);
  const g = await S.pullCs('g3');
  assert.deepEqual(emps(g.j), sorted(SCOPES.g3));
  assert.equal((await S.call({ action: 'hist', ...S.as('gm') })).j.rows.length, NAMES.length);
});

test('a server that keeps answering full pages past 50 pages: the scope is not decided from a partial list (the device keeps its copy)', async () => {
  const S = setup({ indexMissing: true, maxRows: 1 }); seed(S.W);
  for (let i = 0; i < 20; i++) S.W.set('lss_emp_Extra ' + i, { scores: {} }, T0);   // 63 行（1 行ずつ＝50 ページを超える）
  const r = await S.pullCs('g3');
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.cs, { error: 'scope' });
});

test('Score管理 grants never reach CEO/GM rows or a confirmed AM, even when their career row is granted', async () => {
  const S = setup(); seed(S.W);
  S.W.emps.find(e => e.id === 'E-GM').data = { career: '経理' };
  S.W.emps.push({ id: 'E-AM2', name: 'Abe Area', store: 'S2', role: 'office_crew', title: 'Office Crew', data: { career: '経理' } });
  S.W.wrPeople.push({ emp_id: 'E-AM2', name: 'Abe Area', role: 'am', grade: 5 });
  const cfg = {};
  for (const g of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6']) cfg['経理|' + g] = { csView: ['am', 'office'], csEdit: ['am'], csApprove: ['am', 'office'] };
  S.W.set('career_cfg', cfg);
  for (const who of ['am', 'of']) {
    const r = await S.call({ action: 'pull', cs_have: {}, ...S.as(who) }, S.hdr(who));
    assert.ok(r.j.cs.names.includes('Oscar'), who + ' sees the granted office crew');
    for (const n of ['Gina M', 'Abe Area']) {
      assert.ok(!r.j.cs.names.includes(n), who + ' must not see ' + n);
      assert.equal((await put(S, who, 'lss_emp_' + n, { scores: { 'A-1': 3 } })).status, 403, who + ' must not write ' + n);
    }
  }
});

test('v1147 (Codex #141 6781928056 P2-1, the same root): a crew who rewrites their own title / role / store gets no store people; a confirmed G2 or G3 only in the confirmed stores', async () => {
  const S = setup(); seed(S.W);
  // Crew（E-1）が自分の行を Server Leader（G3）・店 S1 に書き換えた：whoami は写しが無いので G3 まで・今の社員の表の店（確かめは無い）
  S.W.pins.tforge = { emp: 'E-1', role: 'staff', grade: 3, stores: ['S1'], am_stores: [], name: 'Kai One', confirmed: false };
  S.W.emps = S.W.emps.map(e => (e.id === 'E-1' ? { ...e, role: 'sl', title: 'Server Leader' } : e));
  const f = await S.call({ action: 'pull', cs_have: {}, pin_session: 'tforge' });
  assert.equal(f.status, 200); assert.deepEqual(emps(f.j), ['Kai One'], 'only their own points');
  // 確かめた G2：写しの店（S1）の G1。確かめていない店（社員の表で足した S2）の人は入らない
  S.W.emps = EMPS.map(e => ({ ...e }));
  S.W.pins.tg2x = { emp: 'E-2', role: 'staff', grade: 2, stores: ['S1', 'S2'], am_stores: [], name: 'Cora Two', confirmed: true };
  const g = await S.call({ action: 'pull', cs_have: {}, pin_session: 'tg2x' });
  assert.ok(!emps(g.j).includes('Ben S2'), 'a store not in the confirmed copy');
  assert.ok(emps(g.j).includes('Kai One'), 'their own store G1');
  // 写しの無い G2（確かめがまだ）：自分の分だけ
  S.W.wrPeople = S.W.wrPeople.filter(x => x.emp_id !== 'E-2');
  const u = await S.call({ action: 'pull', cs_have: {}, pin_session: 'tg2x' });
  assert.deepEqual(emps(u.j), ['Cora Two']);
});
