// secure-state（v1139・2b-1）の関数：だれか（PIN の印・メール）・見せる形（proj）・書き込みの照合・成長カルテの PIN。
// 合成データだけ。PostgREST・Auth・work-requests はこの中の偽物（決まった問い合わせだけ答える）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, ssIsKey, projKarte, projKbCfg, tsMicro } from '../supabase/functions/secure-state/handler.mjs';

import { makeWorld, URL0, ANON, SERVICE, JWT } from './lib/secure-state-world.mjs';

function setup(o = {}) {
  const W = makeWorld(o);
  let clock = Date.UTC(2026, 10, 3, 10, 0, 0);
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  const handle = createHandler({ env, fetch: W.fetch, now: () => clock });
  const call = async (body, hdr = {}) => {
    const r = await handle(new Request('https://fn.test/secure-state', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ANON, ...hdr }, body: JSON.stringify(body) }));
    let j = null; try { j = await r.json(); } catch { j = null; }
    return { status: r.status, j };
  };
  return { W, call, handle, tick: ms => { clock += ms; }, now: () => clock };
}

const GM = { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'G M' };
const CREW = { emp: 'E-1', role: 'staff', grade: 2, stores: ['S1'], am_stores: [], name: 'Crew 1' };
const AM = { emp: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S2'], name: 'Area' };
const G4 = { emp: 'E-4', role: 'staff', grade: 4, stores: ['S3'], am_stores: [], name: 'Leader' };
const EMPS = [{ id: 'E-1', store: 'S1' }, { id: 'E-2', store: 'S2' }, { id: 'E-3', store: 'S3' }, { id: 'E-4', store: 'S3' }, { id: 'E-AM', store: 'S1' }, { id: 'E-GM', store: 'HQ' }];
function seed(W) {
  W.set('growth_karte', {
    'E-1': { hireDate: '2024-01-05', goals: [{ text: '仕込みを覚える', due: '2026-12-01' }, { text: '終わった目標', done: true }], payLog: [{ amount: 1234 }], meetings: [{ note: '面談' }], _at: 5 },
    'E-2': { hireDate: '2023-03-01', goals: [{ text: 'E-2 の目標' }], payLog: [{ amount: 999 }] },
    'E-3': { goals: [{ text: 'E-3 の目標', due: '2026-11-30' }] },
    'E-4': { hireDate: '2022-02-02' },
    'E-AM': { goals: [{ text: 'AM の目標' }] },
  });
  W.set('karte_bonus_config', { __st: 1, v: { quarter: '2026-Q3', gradeBase: { G2: 1000 }, poolRate: 0.12 }, _at: 3, _by: 'G M' });
  W.set('spl_bonus_q_2026-Q3', { __st: 1, v: { evSnap: { people: { 'E-1': { amt: 800 } } } } });
  W.set('bonus_eval', { 'E-1|2026-Q3': { ab: 3, note: 'コメント' } });
  W.set('bonus_store_q', { 'S1|2026-Q3': { profit: 10000 } });
  W.set('bonus_rules', { pool: [1, 2] });
  W.set('bonus_pool_extra', { '2026-Q3': { amt: 500, why: '理由' } });
  W.set('karte_pin', '4321');
  W.set('m_other', { not: 'secret' });
  W.set('tasks_all', []);
}

test('the secure keys are exactly the karte and bonus keys (and the split bonus rows)', () => {
  for (const k of ['growth_karte', 'karte_pin', 'karte_bonus_config', 'bonus_q', 'bonus_eval', 'bonus_store_q', 'bonus_rules', 'bonus_pool_extra', 'spl_bonus_q_2026-Q3']) assert.ok(ssIsKey(k), k);
  for (const k of ['spl_bonus_q_', 'bonus_eval_rule', 'bonus_eval_ovr', 'bonus_track', 'bonus_coef', 'grade_hist', 'cs_criteria', 'lss_emp_A', 'spl_bonus_qx', 'growth_karte2', '', null, 'x'.repeat(300)]) assert.ok(!ssIsKey(k), String(k));
});

test('GM (PIN): pull returns every secure row except the karte PIN, and skips rows the device already has', async () => {
  const S = setup({ pins: { tGM: GM }, emps: EMPS }); seed(S.W);
  const r = await S.call({ action: 'pull', pin_session: 'tGM' });
  assert.equal(r.status, 200); assert.equal(r.j.level, 'full'); assert.equal(r.j.fn, 1);
  const keys = r.j.rows.map(x => x.key).sort();
  assert.deepEqual(keys, ['bonus_eval', 'bonus_pool_extra', 'bonus_rules', 'bonus_store_q', 'growth_karte', 'karte_bonus_config', 'spl_bonus_q_2026-Q3']);
  assert.ok(!r.j.index.some(x => x.key === 'karte_pin' || x.key === 'm_other'));
  assert.deepEqual(r.j.rows.find(x => x.key === 'growth_karte').value['E-1'].payLog, [{ amount: 1234 }]);
  assert.ok(r.j.rows.every(x => /^h:[0-9a-f]{32}$/.test(x.v) && x.updated_at));
  const have = Object.fromEntries(r.j.index.map(x => [x.key, x.v]));
  delete have.bonus_eval;
  const r2 = await S.call({ action: 'pull', pin_session: 'tGM', have });
  assert.deepEqual(r2.j.rows.map(x => x.key), ['bonus_eval']);
  assert.equal(r2.j.index.length, 7);
});

test('without app_state_index the GM still gets every row (versions from the content)', async () => {
  const S = setup({ pins: { tGM: GM }, indexMissing: true }); seed(S.W);
  const r = await S.call({ action: 'pull', pin_session: 'tGM' });
  assert.equal(r.j.rows.length, 7);
  assert.ok(r.j.rows.every(x => /^x:[0-9a-f]{64}$/.test(x.v)));
  const have = Object.fromEntries(r.j.index.map(x => [x.key, x.v]));
  const r2 = await S.call({ action: 'pull', pin_session: 'tGM', have });
  assert.equal(r2.j.rows.length, 0);
});

test('crew (PIN): only the projection — every hire date, their own open goals, the bonus quarter; nothing else, no writes', async () => {
  const S = setup({ pins: { t1: CREW }, emps: EMPS }); seed(S.W);
  const r = await S.call({ action: 'pull', pin_session: 't1' });
  assert.equal(r.j.level, 'proj');
  assert.deepEqual(r.j.rows.map(x => x.key).sort(), ['growth_karte', 'karte_bonus_config']);
  const gk = r.j.rows.find(x => x.key === 'growth_karte').value;
  assert.deepEqual(gk, { 'E-1': { hireDate: '2024-01-05', goals: [{ text: '仕込みを覚える', due: '2026-12-01' }] }, 'E-2': { hireDate: '2023-03-01' }, 'E-4': { hireDate: '2022-02-02' } }, 'not the goals of others in the same store either');
  assert.deepEqual(r.j.rows.find(x => x.key === 'karte_bonus_config').value, { quarter: '2026-Q3' });
  assert.ok(!JSON.stringify(r.j).includes('1234') && !JSON.stringify(r.j).includes('面談') && !JSON.stringify(r.j).includes('gradeBase'));
  for (const key of ['bonus_eval', 'spl_bonus_q_2026-Q3', 'bonus_pool_extra']) assert.equal((await S.call({ action: 'get', pin_session: 't1', key })).status, 403, key);
  const g = await S.call({ action: 'get', pin_session: 't1', key: 'growth_karte' });
  assert.equal(g.status, 200); assert.equal(g.j.proj, true); assert.ok(!g.j.value['E-1'].payLog);
  assert.equal((await S.call({ action: 'put', pin_session: 't1', key: 'growth_karte', value: {} })).status, 403);
  assert.equal((await S.call({ action: 'pin_check', pin_session: 't1', pin: '4321' })).status, 403);
  assert.equal(S.W.calls.post + S.W.calls.patch, 0);
  // 同じ見せる形なら、二度目は送らない
  const have = Object.fromEntries(r.j.index.map(x => [x.key, x.v]));
  assert.equal((await S.call({ action: 'pull', pin_session: 't1', have })).j.rows.length, 0);
});

test('AM sees the goals of people in their stores; G4 of their own store; office (email) only their own', async () => {
  const S = setup({ pins: { tAM: AM, t4: G4 }, emps: [...EMPS, { id: 'E-5', store: 'S2' }, { id: 'E-6', store: 'S1' }], wrPeople: [{ emp_id: 'E-6', role: 'am' }, { emp_id: 'E-4', role: 'staff' }],
    users: { jwtOffice: 'aaaaaaaa-0000-0000-0000-000000000001' }, mgr: { 'aaaaaaaa-0000-0000-0000-000000000001': { role: 'office', emp_id: 'E-2' } } }); seed(S.W);
  const gk = S.W.get('growth_karte'); gk['E-5'] = { goals: [{ text: 'E-5 の目標' }] }; gk['E-6'] = { goals: [{ text: '別の AM の目標' }] }; S.W.set('growth_karte', gk);
  const am = (await S.call({ action: 'pull', pin_session: 'tAM' })).j.rows.find(x => x.key === 'growth_karte').value;
  assert.ok(am['E-1'].goals && am['E-5'].goals && !am['E-3'], 'own store and the stores they cover');
  assert.ok(!am['E-6'], 'another AM (confirmed copy): not shown');
  assert.ok(!(am['E-2'] || {}).goals, 'a manager_auth person (office) in the store: not shown even to the AM (the store column can be rewritten with the public key)');
  const g4 = (await S.call({ action: 'pull', pin_session: 't4' })).j.rows.find(x => x.key === 'growth_karte').value;
  assert.ok(g4['E-3'].goals && !g4['E-1'].goals && !(g4['E-2'] || {}).goals);
  const of = await S.call({ action: 'pull' }, { authorization: 'Bearer ' + JWT('jwtOffice') });
  assert.equal(of.j.level, 'proj');
  const ofk = of.j.rows.find(x => x.key === 'growth_karte').value;
  assert.ok(ofk['E-2'].goals && !ofk['E-1'].goals);
});

test('email: GM gets everything; an account without an employee gets nothing; resigned or suspended or unknown is refused', async () => {
  const U = { gm: 'aaaaaaaa-0000-0000-0000-00000000000a', of: 'aaaaaaaa-0000-0000-0000-00000000000b', out: 'aaaaaaaa-0000-0000-0000-00000000000c', sus: 'aaaaaaaa-0000-0000-0000-00000000000d' };
  const S = setup({ users: { jg: U.gm, jo: U.of, jx: U.out, js: U.sus }, mgr: { [U.gm]: { role: 'gm', emp_id: 'E-GM' }, [U.of]: { role: 'office', emp_id: null }, [U.out]: { role: 'ceo', emp_id: 'E-X' }, [U.sus]: { role: 'suspended', emp_id: 'E-GM' } },
    emps: [...EMPS, { id: 'E-X', store: 'HQ', status: '退職' }] }); seed(S.W);
  assert.equal((await S.call({ action: 'pull' }, { authorization: 'Bearer ' + JWT('jg') })).j.level, 'full');
  const o = await S.call({ action: 'pull' }, { authorization: 'Bearer ' + JWT('jo') });
  assert.equal(o.j.level, 'none'); assert.deepEqual(o.j.rows, []);
  assert.equal((await S.call({ action: 'pull' }, { authorization: 'Bearer ' + JWT('jx') })).status, 401);
  assert.equal((await S.call({ action: 'pull' }, { authorization: 'Bearer ' + JWT('js') })).status, 401);
  assert.equal((await S.call({ action: 'pull' }, { authorization: 'Bearer ' + JWT('nope') })).status, 401);
  assert.equal((await S.call({ action: 'pull' })).status, 401, 'the anon key alone is not a sign-in');
});

test('the person at the device decides: a staff PIN with a GM email still gets only the projection', async () => {
  const S = setup({ pins: { t1: CREW }, users: { jg: 'aaaaaaaa-0000-0000-0000-00000000000a' }, mgr: { 'aaaaaaaa-0000-0000-0000-00000000000a': { role: 'gm', emp_id: 'E-GM' } }, emps: EMPS }); seed(S.W);
  assert.equal((await S.call({ action: 'pull', pin_session: 't1' }, { authorization: 'Bearer ' + JWT('jg') })).j.level, 'proj');
  assert.equal((await S.call({ action: 'pull', pin_session: 'bad' }, { authorization: 'Bearer ' + JWT('jg') })).status, 401, 'a refused PIN mark does not fall back to the email');
});

test('work-requests missing: 503 auth_unavailable (the app keeps the old way); the email alone still works', async () => {
  const S = setup({ pins: { tGM: GM }, users: { jg: 'aaaaaaaa-0000-0000-0000-00000000000a' }, mgr: { 'aaaaaaaa-0000-0000-0000-00000000000a': { role: 'gm', emp_id: 'E-GM' } } }); seed(S.W);
  S.W.wrDown = true;
  const r = await S.call({ action: 'pull', pin_session: 'tGM' });
  assert.equal(r.status, 503); assert.equal(r.j.error, 'auth_unavailable');
  assert.equal((await S.call({ action: 'pull' }, { authorization: 'Bearer ' + JWT('jg') })).j.level, 'full', 'no PIN mark: the email decides');
});

// Codex の P1（#131・01f33ac）：PIN の印のある要求は、PIN を確かめられないときもメールのログインへ切り替えない
for (const mode of ['404', '503', 'throw', 'badjson', 'nome']) {
  test(`a staff PIN with a GM email on a shared device: work-requests ${mode} never gives the GM's rows`, async () => {
    const S = setup({ pins: { t1: CREW }, users: { jg: 'aaaaaaaa-0000-0000-0000-00000000000a' }, mgr: { 'aaaaaaaa-0000-0000-0000-00000000000a': { role: 'gm', emp_id: 'E-GM' } }, emps: EMPS }); seed(S.W);
    S.W.wrDown = mode;
    const hdr = { authorization: 'Bearer ' + JWT('jg') };
    for (const body of [{ action: 'pull', pin_session: 't1' }, { action: 'get', pin_session: 't1', key: 'growth_karte' }, { action: 'get', pin_session: 't1', key: 'bonus_eval' },
      { action: 'put', pin_session: 't1', key: 'bonus_rules', value: { x: 1 } }, { action: 'pin_check', pin_session: 't1', pin: '4321' }]) {
      const r = await S.call(body, hdr);
      assert.ok(r.status === 503 || r.status === 401, `${body.action}: refused (${r.status})`);
      assert.notEqual(r.j && r.j.level, 'full');
      const s = JSON.stringify(r.j);
      assert.ok(!s.includes('1234') && !s.includes('面談') && !s.includes('gradeBase') && !s.includes('コメント'), `${body.action}: no other person's pay, meetings, bonus settings or evaluations`);
    }
    if (mode !== 'nome') assert.equal((await S.call({ action: 'pull', pin_session: 't1' }, hdr)).j.error, 'auth_unavailable', 'the app sees "PIN check unavailable" (keeps the old way)');
    assert.equal(S.W.calls.post + S.W.calls.patch, 0, 'nothing written');
    S.W.wrDown = false;
    assert.equal((await S.call({ action: 'pull', pin_session: 't1' }, hdr)).j.level, 'proj', 'once work-requests answers, the PIN decides (projection)');
  });
}

test('a store login or a resigned person (work-requests refuses) is 401; the PIN check is cached for 60 seconds', async () => {
  const S = setup({ pins: { tStore: 'deny', tOut: 'gone', tGM: GM } }); seed(S.W);
  assert.equal((await S.call({ action: 'pull', pin_session: 'tStore' })).status, 401);
  assert.equal((await S.call({ action: 'pull', pin_session: 'tOut' })).status, 401);
  const n0 = S.W.calls.wr;
  await S.call({ action: 'pull', pin_session: 'tGM' }); await S.call({ action: 'pull', pin_session: 'tGM' });
  assert.equal(S.W.calls.wr - n0, 1);
  S.tick(61000);
  await S.call({ action: 'pull', pin_session: 'tGM' });
  assert.equal(S.W.calls.wr - n0, 2);
});

test('put: plain upsert, insert-only, and the compare on updated_at (a later time than the one read)', async () => {
  const S = setup({ pins: { tGM: GM } }); seed(S.W);
  const p0 = await S.call({ action: 'put', pin_session: 'tGM', key: 'bonus_rules', value: { pool: [9] } });
  assert.equal(p0.status, 200); assert.deepEqual(S.W.get('bonus_rules'), { pool: [9] });
  const ins = await S.call({ action: 'put', pin_session: 'tGM', key: 'bonus_rules', value: { pool: [1] }, expect: { exists: false } });
  assert.equal(ins.status, 409); assert.deepEqual(S.W.get('bonus_rules'), { pool: [9] });
  const ins2 = await S.call({ action: 'put', pin_session: 'tGM', key: 'spl_bonus_q_2026-Q4', value: { a: 1 }, expect: { exists: false } });
  assert.equal(ins2.status, 200);
  const g = await S.call({ action: 'get', pin_session: 'tGM', key: 'bonus_rules' });
  const read = g.j.updated_at;
  const ok = await S.call({ action: 'put', pin_session: 'tGM', key: 'bonus_rules', value: { pool: [10] }, expect: { exists: true, updated_at: read } });
  assert.equal(ok.status, 200);
  assert.ok(tsMicro(ok.j.updated_at) > tsMicro(read));
  const stale = await S.call({ action: 'put', pin_session: 'tGM', key: 'bonus_rules', value: { pool: [11] }, expect: { exists: true, updated_at: read } });
  assert.equal(stale.status, 409); assert.deepEqual(S.W.get('bonus_rules'), { pool: [10] });
  // 読んだ時刻が端末の時計より先でも、書く時刻はそれより後
  S.W.set('bonus_rules', { pool: [12] }, '2027-01-01T00:00:00.000500+00:00');
  const fut = await S.call({ action: 'put', pin_session: 'tGM', key: 'bonus_rules', value: { pool: [13] }, expect: { exists: true, updated_at: '2027-01-01T00:00:00.000500+00:00' } });
  assert.equal(fut.status, 200); assert.ok(tsMicro(fut.j.updated_at) > tsMicro('2027-01-01T00:00:00.000500+00:00'));
  assert.equal((await S.call({ action: 'put', pin_session: 'tGM', key: 'bonus_rules', value: 1, expect: { exists: true, updated_at: 'yesterday' } })).status, 400);
  assert.equal((await S.call({ action: 'put', pin_session: 'tGM', key: 'karte_pin', value: '0000' })).status, 400, 'the karte PIN is not written as a value');
  assert.equal((await S.call({ action: 'put', pin_session: 'tGM', key: 'm_other', value: 1 })).status, 400, 'only the secure keys');
  assert.equal((await S.call({ action: 'put', pin_session: 'tGM', key: 'bonus_rules' })).status, 400, 'a value is required');
  assert.equal((await S.call({ action: 'get', pin_session: 'tGM', key: 'karte_pin' })).status, 400);
  const miss = await S.call({ action: 'get', pin_session: 'tGM', key: 'bonus_eval_x' });
  assert.equal(miss.status, 400);
  const none = await S.call({ action: 'get', pin_session: 'tGM', key: 'spl_bonus_q_2030-Q1' });
  assert.deepEqual([none.status, none.j.exists], [200, false]);
});

test('karte PIN: checked on the server; the default 1234 and a plain old value upgrade to a PBKDF2 mark; 5 misses lock for 10 minutes', async () => {
  const S = setup({ pins: { tGM: GM, tCEO: { ...GM, emp: 'E-CEO', role: 'ceo' } } });
  assert.equal((await S.call({ action: 'pin_check', pin_session: 'tGM', pin: '9999' })).j.ok, false, 'no row: only the old default opens');
  assert.equal(S.W.get('karte_pin'), undefined, 'a wrong PIN stores nothing');
  assert.deepEqual((await S.call({ action: 'pin_check', pin_session: 'tGM', pin: '1234' })).j.ok, true, 'no row: the old default');
  const v = S.W.get('karte_pin');
  assert.ok(v && /^[0-9a-f]{64}$/.test(v.h) && /^[0-9a-f]{32}$/.test(v.s) && v.it >= 100000, 'stored as a mark, not the PIN');
  assert.ok(!JSON.stringify(v).includes('1234'));
  assert.equal((await S.call({ action: 'pin_check', pin_session: 'tGM', pin: '1234' })).j.ok, true, 'the mark matches');
  assert.equal((await S.call({ action: 'pin_check', pin_session: 'tGM', pin: '9999' })).j.ok, false);
  // 前の版の平文
  S.W.set('karte_pin', '4321');
  assert.equal((await S.call({ action: 'pin_check', pin_session: 'tCEO', pin: '1234' })).j.ok, false);
  assert.equal((await S.call({ action: 'pin_check', pin_session: 'tCEO', pin: '4321' })).j.ok, true);
  assert.equal(typeof S.W.get('karte_pin'), 'object');
  // 変える
  assert.deepEqual((await S.call({ action: 'pin_set', pin_session: 'tCEO', cur: '0000', pin: '5555' })).j, { ok: false, why: 'cur', fn: 1, csfn: 1, swfn: 1, hrfn: 1, sw2: 1, piifn: 1, ghfn: 1, tpfn: 1, scfn: 1 });
  assert.equal((await S.call({ action: 'pin_set', pin_session: 'tCEO', cur: '4321', pin: '55a5' })).status, 400);
  assert.equal((await S.call({ action: 'pin_set', pin_session: 'tCEO', cur: '4321', pin: '5555' })).j.ok, true);
  assert.equal((await S.call({ action: 'pin_check', pin_session: 'tGM', pin: '4321' })).j.ok, false);
  assert.equal((await S.call({ action: 'pin_check', pin_session: 'tGM', pin: '5555' })).j.ok, true);
  // 5 回まちがえると止まる（その人だけ）
  for (let i = 0; i < 5; i++) assert.equal((await S.call({ action: 'pin_check', pin_session: 'tGM', pin: '0000' })).j.ok, false);
  assert.equal((await S.call({ action: 'pin_check', pin_session: 'tGM', pin: '5555' })).status, 429);
  assert.equal((await S.call({ action: 'pin_check', pin_session: 'tCEO', pin: '5555' })).j.ok, true);
  S.tick(10 * 60000 + 1);
  assert.equal((await S.call({ action: 'pin_check', pin_session: 'tGM', pin: '5555' })).j.ok, true);
  assert.equal((await S.call({ action: 'pin_check', pin_session: 'tGM', pin: '12345' })).j.ok, false, 'not 4 digits: no');
});

test('the web entry: origin, OPTIONS, method, size, unknown action', async () => {
  const S = setup({ pins: { tGM: GM } });
  const mk = (method, origin, body) => S.handle(new Request('https://fn.test/secure-state', { method, headers: origin ? { origin } : {}, body }));
  assert.equal((await mk('POST', 'https://evil.example', '{}')).status, 403);
  const o = await mk('OPTIONS', 'https://funergy-plus.com');
  assert.equal(o.status, 204); assert.equal(o.headers.get('access-control-allow-origin'), 'https://funergy-plus.com');
  assert.equal((await mk('GET', 'https://funergy-plus.com')).status, 405);
  assert.equal((await mk('POST', null, 'not json')).status, 400);
  assert.equal((await S.call({ action: 'drop_table', pin_session: 'tGM' })).status, 400);
});

test('projection helpers keep only what the screens use', () => {
  const g = projKarte({ A: { hireDate: '2020-01-01', goals: [{ text: ' ', due: 'x' }, { text: 'g', due: 5 }], salary: 1 }, __meta: { hireDate: 'x' }, B: null }, id => id === 'A');
  assert.deepEqual(g, { A: { hireDate: '2020-01-01', goals: [{ text: 'g', due: '' }] } });
  assert.deepEqual(projKbCfg({ quarter: '2026-Q1', gradeBase: {} }), { quarter: '2026-Q1' });
  assert.deepEqual(projKbCfg({ __st: 1, v: { quarter: '2026-Q2' }, quarter: '2025-Q4' }), { quarter: '2025-Q4' }, 'the outer field first, as the app reads it (kbCfgPlain)');
  assert.deepEqual(projKbCfg({ __st: 1, v: { quarter: '2026-Q2' }, _at: 3 }), { quarter: '2026-Q2' });
  assert.deepEqual(projKbCfg({ __st: 1, v: { __st: 1, v: { quarter: '2026-Q1' } } }), { quarter: '2026-Q1' });
  assert.deepEqual(projKbCfg(null), {});
  assert.equal(tsMicro('2026-11-03T10:00:00.5+00:00'), Date.UTC(2026, 10, 3, 10) * 1000 + 500000);
  assert.equal(tsMicro('bad'), null);
});

// ---- 独立レビュー（121da1c）の指摘
test('P2-2: the row list is read page by page (PostgREST returns at most 1000 rows at a time)', async () => {
  const S = setup({ pins: { tGM: GM }, maxRows: 1000 }); seed(S.W);
  for (let i = 0; i < 2500; i++) S.W.set('a_' + String(i).padStart(5, '0'), { i });   // 対象のキーより前に並ぶ行
  const r = await S.call({ action: 'pull', pin_session: 'tGM' });
  const want = [...S.W.rows.keys()].filter(k => ssIsKey(k) && k !== 'karte_pin').sort();
  assert.ok(want.length >= 5);
  assert.deepEqual([...r.j.rows.map(x => x.key)].sort(), want, 'every secure row, even past the first 1000 rows of the list');
  assert.ok(r.j.index.every(x => /^h:/.test(x.v)), 'from the row list (not the slow way)');
});

test('P2-1: every answer of this function says fn:1 (also refusals); 429 from Auth is "unavailable", not "refused"; only a real sign-in token counts as email', async () => {
  const S = setup({ pins: { tGM: GM }, users: { jg: 'aaaaaaaa-0000-0000-0000-00000000000a' }, mgr: { 'aaaaaaaa-0000-0000-0000-00000000000a': { role: 'gm', emp_id: 'E-GM' } } }); seed(S.W);
  const r401 = await S.call({ action: 'pull' });
  assert.equal(r401.status, 401); assert.equal(r401.j.fn, 1);
  const bad = await S.call({ action: 'nope' }); assert.equal(bad.j.fn, 1);
  // 公開の鍵の文字が関数の設定と違っても（Bearer が role anon の JWT）、メールのログインとはみなさない → work-requests が無ければ 503（401 ではない）
  S.W.wrDown = true;
  const a = await S.call({ action: 'pull', pin_session: 'tGM' }, { authorization: 'Bearer ' + JWT('x', 'anon') });
  assert.equal(a.status, 503);
  const pub = await S.call({ action: 'pull', pin_session: 'tGM' }, { authorization: 'Bearer sb_publishable_abc' });
  assert.equal(pub.status, 503);
  S.W.wrDown = false;
  // Auth が 429
  const realFetch = S.W.fetch;
  S.W.fetch = async (u, o) => (String(u).endsWith('/auth/v1/user') ? new Response('{"msg":"rate"}', { status: 429 }) : realFetch(u, o));
  const h = createHandler({ env: k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]), fetch: S.W.fetch });
  const rr = await h(new Request('https://fn.test/x', { method: 'POST', headers: { authorization: 'Bearer ' + JWT('jg') }, body: JSON.stringify({ action: 'pull' }) }));
  assert.equal(rr.status, 503);
  const o = await h(new Request('https://fn.test/x', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' }));
  assert.equal(o.status, 403); assert.equal((await o.json()).fn, 1);
});

test('P3: email sign-in of someone resigned in the data or with the OS turned off is refused (same as work-requests)', async () => {
  const U = { a: 'aaaaaaaa-0000-0000-0000-00000000000a', b: 'aaaaaaaa-0000-0000-0000-00000000000b' };
  const S = setup({ users: { ja: U.a, jb: U.b }, mgr: { [U.a]: { role: 'gm', emp_id: 'E-A' }, [U.b]: { role: 'ceo', emp_id: 'E-B' } },
    emps: [{ id: 'E-A', store: 'HQ', data: { status: '退職' } }, { id: 'E-B', store: 'HQ', data: { osDisabled: true } }] }); seed(S.W);
  assert.equal((await S.call({ action: 'pull' }, { authorization: 'Bearer ' + JWT('ja') })).status, 401);
  assert.equal((await S.call({ action: 'pull' }, { authorization: 'Bearer ' + JWT('jb') })).status, 401);
});

test('P3: a refused PIN mark is remembered for 30 seconds (no work-requests call for each request)', async () => {
  const S = setup({ pins: { tGM: GM } }); seed(S.W);
  await S.call({ action: 'pull', pin_session: 'bad' });
  await S.call({ action: 'pull', pin_session: 'bad' });
  assert.equal(S.W.calls.wr, 1);
  S.tick(30001);
  await S.call({ action: 'pull', pin_session: 'bad' });
  assert.equal(S.W.calls.wr, 2);
});

test('P3: the projection is not rebuilt from the whole karte when nothing changed (the version comes from the row list and the scope)', async () => {
  const S = setup({ pins: { t1: CREW }, emps: EMPS }); seed(S.W);
  const r = await S.call({ action: 'pull', pin_session: 't1' });
  const have = Object.fromEntries(r.j.index.map(x => [x.key, x.v]));
  const n0 = S.W.reads.length;
  const r2 = await S.call({ action: 'pull', pin_session: 't1', have });
  assert.equal(r2.j.rows.length, 0);
  assert.equal(S.W.reads.length, n0, 'the karte row was not read');
  // 目標が変わる → 届く
  const gk = S.W.get('growth_karte'); gk['E-1'].goals.push({ text: '次' }); S.W.set('growth_karte', gk);
  const r3 = await S.call({ action: 'pull', pin_session: 't1', have });
  assert.deepEqual([...r3.j.rows.map(x => x.key)], ['growth_karte']);
  // 見せる範囲が変わる（AM の担当の店が増えた）→ 印が変わる
  const S2 = setup({ pins: { tAM: AM }, emps: EMPS }); seed(S2.W);
  const v1 = (await S2.call({ action: 'pull', pin_session: 'tAM' })).j.index.find(x => x.key === 'growth_karte').v;
  S2.W.emps.push({ id: 'E-7', store: 'S2' });
  S2.tick(61000);
  const v2 = (await S2.call({ action: 'pull', pin_session: 'tAM' })).j.index.find(x => x.key === 'growth_karte').v;
  assert.notEqual(v1, v2);
});

test('P3: odd keys that look like a bonus quarter (& # + space) are not secret keys and never break the reads', async () => {
  const S = setup({ pins: { tGM: GM } }); seed(S.W);
  for (const k of ['spl_bonus_q_a&b', 'spl_bonus_q_a#b', 'spl_bonus_q_a+b', 'spl_bonus_q_a b']) { S.W.set(k, { x: 1 }); assert.equal(ssIsKey(k), false, k); }
  const r = await S.call({ action: 'pull', pin_session: 'tGM' });
  assert.equal(r.status, 200);
  assert.ok(r.j.rows.some(x => x.key === 'growth_karte'));
  assert.ok(!r.j.rows.some(x => x.key.includes('a')  && x.key.startsWith('spl_bonus_q_a')));
  assert.equal((await S.call({ action: 'get', pin_session: 'tGM', key: 'spl_bonus_q_a&b' })).status, 400);
});
