// secure-state v1145（2b の 7 つ目）の関数：グレード履歴（grade_hist）を、GM・CEO だけが書く（Moto さん 11/10「GM,CEOです」）。
// 読むのは今までどおり REST（この関数の get・pull では返さない）。v1143 の 8 つと同じ道（swPut）に 1 つ足しただけ。
// 合成データだけ（架空の人と店）。PostgREST・Auth・work-requests は tests/lib/secure-state-world.mjs の偽物。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, swIsKey, swShapeOk, SW_WRITE, SW2_KEYS, GH_KEYS, ssIsKey, csIsKey, secretKey, hrIsKey, piiIsKey } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, JWT } from './lib/secure-state-world.mjs';

const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-CEO', name: 'Cal E', store: 'HQ', role: 'ceo', title: '' },
  { id: 'E-OF', name: 'Ofelia', store: 'HQ', role: 'office', title: 'Accountant' },
  { id: 'E-OC', name: 'Oscar', store: 'HQ', role: 'office_crew', title: 'Office Crew' },
  { id: 'E-AM', name: 'Amy Area', store: 'S1', role: 'am', title: 'Area Manager' },
  { id: 'E-4', name: 'Leo Four', store: 'S1', role: 'g4', title: 'Store Manager' },
  { id: 'E-CH', name: 'Chef Ken', store: 'S1', role: 'chef', title: 'Head Chef' },
  { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew' },
  { id: 'E-OUTGM', name: 'Gone GM', store: 'HQ', role: 'gm', title: 'General Manager', status: '退職' },
];
const U = n => 'aaaaaaaa-0000-0000-0000-00000000000' + n;
const MGR = { [U(1)]: { role: 'gm', emp_id: 'E-GM' }, [U(5)]: { role: 'ceo', emp_id: 'E-CEO' }, [U(2)]: { role: 'office', emp_id: 'E-OF' }, [U(3)]: { role: 'office_crew', emp_id: 'E-OC' },
  [U(4)]: { role: 'gm', emp_id: null }, [U(6)]: { role: 'gm', emp_id: 'E-OUTGM' } };
const USERS = { gm: U(1), ceo: U(5), of: U(2), oc: U(3), gmnoemp: U(4), gmout: U(6), stranger: 'bbbbbbbb-0000-0000-0000-000000000009' };
const ME = {
  gm: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M' },
  ceo: { emp: 'E-CEO', role: 'ceo', grade: 7, stores: [], am_stores: [], name: 'Cal E' },
  of: { emp: 'E-OF', role: 'office', grade: 4, stores: [], am_stores: [], name: 'Ofelia' },
  oc: { emp: 'E-OC', role: 'office_crew', grade: 1, stores: [], am_stores: [], name: 'Oscar' },
  am: { emp: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1'], name: 'Amy Area' },
  g4: { emp: 'E-4', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Leo Four' },
  chef: { emp: 'E-CH', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Chef Ken', confirmed: true },
  g1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One' },
};
const T0 = '2026-11-09T09:00:00.000000+00:00';
// アプリが書く形（ghSave：社員 ID → { recs, name, _at }）の見本（合成）
const GH0 = {
  'E-1': { recs: [{ id: 'gh1', d: '2026-04-01', g: 'G1', from: '', start: true, src: 'hire', by: 'Gina M', at: '2026/04/01 10:00', note: '' }], name: 'Kai One', _at: 5 },
  'E-4': { recs: [{ id: 'gh2', d: '2026-06-30', g: 'G4', from: 'G3', start: false, src: 'title', by: 'Gina M', at: '2026/06/30 10:00', note: '', prevEval: { g: 'G3', csScore: 300, csMax: 420 } }], name: 'Leo Four', _at: 6 },
};
const withRec = i => ({ ...GH0, ['E-' + (100 + i)]: { recs: [{ id: 'n' + i, d: '2026-11-0' + (1 + (i % 8)), g: 'G2', from: 'G1', start: false, src: 'title', by: 'Gina M', at: '2026/11/09', note: '' }], name: 'New ' + i, _at: 10 + i } });

function setup(o = {}) {
  const W = makeWorld({ emps: EMPS.map(e => ({ ...e })), mgr: MGR, users: USERS, wrPeople: [], pins: Object.fromEntries(Object.entries(ME).map(([k, v]) => ['t' + k, v])), ...o });
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  const handle = createHandler({ env, fetch: W.fetch, now: () => Date.UTC(2026, 10, 9, 10, 0, 0) });
  const call = async (body, hdr = {}) => {
    const r = await handle(new Request('https://fn.test/secure-state', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ANON, ...hdr }, body: JSON.stringify(body) }));
    let j = null; try { j = await r.json(); } catch { j = null; }
    return { status: r.status, j };
  };
  const pin = who => ({ pin_session: 't' + who });
  const email = who => ({ authorization: 'Bearer ' + JWT(who) });
  W.set('grade_hist', GH0, T0);
  W.set('tasks_all', { a: 1 }, T0);
  return { W, call, pin, email };
}
const writes = (W, key) => W.log.filter(x => x[0] === 'write' && x[2] === key).map(x => x[1]);

test('the grade history: GM and CEO only (Moto 11/10); still readable (not secret, not Career Score, not HR, not the personal fields); a key of its own (not one of the v1143 eight)', () => {
  assert.deepEqual(GH_KEYS, ['grade_hist']);
  assert.deepEqual(SW_WRITE.grade_hist, ['ceo', 'gm']);
  assert.ok(swIsKey('grade_hist') && !secretKey('grade_hist') && !ssIsKey('grade_hist') && !csIsKey('grade_hist') && !hrIsKey('grade_hist') && !piiIsKey('grade_hist'));
  assert.ok(!SW2_KEYS.includes('grade_hist'), 'its own marker (ghfn), so a v1143 / v1144 app does not route it to a function that refuses it');
  for (const k of ['grade_hist ', 'Grade_hist', 'grade_hist_x', 'gradehist', 'grade', 'toString', '__proto__', '', null]) assert.ok(!swIsKey(k), String(k));
});

test('the shape: a map of employee records (object or null), keys up to 200 characters, up to 6 million characters; odd records only as they already are in the cloud', () => {
  const k = 'grade_hist';
  assert.ok(swShapeOk(k, GH0)); assert.ok(swShapeOk(k, {})); assert.ok(swShapeOk(k, { a: null })); assert.ok(swShapeOk(k, { ['k'.repeat(200)]: {} }));
  for (const v of [null, [], 'x', 5, { a: 1 }, { a: 'x' }, { a: [] }, { ['k'.repeat(201)]: {} }, { __st: 1, v: GH0 }]) assert.ok(!swShapeOk(k, v), JSON.stringify(v).slice(0, 40));
  assert.ok(swShapeOk(k, { a: { recs: [], note: 'y'.repeat(5000000) } }), '5 million characters');
  assert.ok(!swShapeOk(k, { a: { recs: [], note: 'y'.repeat(6000001) } }), 'over 6 million characters');
  const cloud = { ...GH0, odd: 1 };
  assert.ok(swShapeOk(k, { ...GH0, odd: 1, 'E-9': { recs: [], _at: 1 } }, cloud)); assert.ok(!swShapeOk(k, { ...GH0, odd: 2 }, cloud)); assert.ok(!swShapeOk(k, { ...GH0, other: 1 }, cloud));
});

test('GM and CEO write it (PIN or email) with the server key; the answer says ghfn:1 and who wrote', async () => {
  const S = setup();
  let i = 0;
  for (const [how, who] of [['pin', 'gm'], ['pin', 'ceo'], ['email', 'gm'], ['email', 'ceo']]) {
    const v = withRec(++i);
    const r = await S.call({ action: 'put', key: 'grade_hist', value: v, ...(how === 'pin' ? S.pin(who) : {}) }, how === 'email' ? S.email(who) : {});
    assert.equal(r.status, 200, how + ' ' + who); assert.equal(r.j.ok, true);
    assert.equal(r.j.ghfn, 1); assert.equal(r.j.sw2, 1); assert.equal(r.j.piifn, 1); assert.equal(r.j.by, who); assert.ok(!r.j.same);
    assert.deepEqual(S.W.get('grade_hist'), v);
  }
  assert.deepEqual(writes(S.W, 'grade_hist'), ['service', 'service', 'service', 'service']);
  // メールのアカウントが社員と結ばれていない GM は、メールのログインなら manager_auth の役割で入れる（v1141・v1143 と同じ）
  assert.equal((await S.call({ action: 'put', key: 'grade_hist', value: withRec(9) }, S.email('gmnoemp'))).status, 200);
});

test('everyone else is refused (403) and nothing is written — Accounting, office crew, AM, G4, Head Chef (even confirmed), crew; a retired GM; the device cannot claim a role', async () => {
  const S = setup();
  const v = withRec(1);
  for (const who of ['of', 'oc', 'am', 'g4', 'chef', 'g1']) {
    const r = await S.call({ action: 'put', key: 'grade_hist', value: v, ...S.pin(who) });
    assert.equal(r.status, 403, who); assert.equal(r.j.error, 'forbidden'); assert.equal(r.j.ghfn, 1);
  }
  for (const who of ['of', 'oc']) assert.equal((await S.call({ action: 'put', key: 'grade_hist', value: v }, S.email(who))).status, 403, who + ' by email');
  assert.equal((await S.call({ action: 'put', key: 'grade_hist', value: v }, S.email('gmout'))).status, 401, 'a retired GM cannot sign in');
  assert.equal((await S.call({ action: 'put', key: 'grade_hist', value: v }, S.email('stranger'))).status, 401);
  assert.equal((await S.call({ action: 'put', key: 'grade_hist', value: v })).status, 401, 'the public key alone');
  assert.equal((await S.call({ action: 'put', key: 'grade_hist', value: v, role: 'gm', ...S.pin('am') })).status, 403, 'the device says gm');
  assert.deepEqual(S.W.get('grade_hist'), GH0);
  assert.deepEqual(writes(S.W, 'grade_hist'), []);
});

test('the same value as the cloud passes for anyone signed in without writing (key order does not matter); no row is never "the same"', async () => {
  const S = setup();
  const reordered = { 'E-4': GH0['E-4'], 'E-1': { _at: 5, name: 'Kai One', recs: GH0['E-1'].recs } };
  for (const who of ['am', 'g4', 'of', 'g1']) {
    const r = await S.call({ action: 'put', key: 'grade_hist', value: reordered, ...S.pin(who) });
    assert.equal(r.status, 200, who); assert.equal(r.j.same, true); assert.equal(r.j.updated_at, T0);
  }
  assert.equal(S.W.log.filter(x => x[0] === 'write').length, 0);
  S.W.rows.delete('grade_hist');
  assert.equal((await S.call({ action: 'put', key: 'grade_hist', value: GH0, ...S.pin('am') })).status, 403);
});

test('a bad shape is refused (400) even for the CEO; an odd record already in the cloud does not stop the GM', async () => {
  const S = setup();
  for (const value of [null, [], 'x', { a: 1 }, { a: 'x' }, { __st: 1, v: GH0, _at: 1 }]) {
    const r = await S.call({ action: 'put', key: 'grade_hist', value, ...S.pin('ceo') });
    assert.equal(r.status, 400, JSON.stringify(value)); assert.equal(r.j.error, 'bad_value');
  }
  assert.equal(S.W.log.filter(x => x[0] === 'write').length, 0);
  S.W.set('grade_hist', { ...GH0, old: 'x' }, T0);
  const v = { ...GH0, old: 'x', 'E-7': { recs: [], _at: 9 } };
  assert.equal((await S.call({ action: 'put', key: 'grade_hist', value: v, ...S.pin('gm') })).status, 200);
  assert.equal((await S.call({ action: 'put', key: 'grade_hist', value: { ...v, old: 'y' }, ...S.pin('gm') })).status, 400);
  assert.deepEqual(S.W.get('grade_hist'), v);
});

test('expect (read-then-write): a stale read is a conflict (409) and writes nothing — GM and CEO saving at once never lose a change', async () => {
  const S = setup();
  const v = withRec(3);
  assert.equal((await S.call({ action: 'put', key: 'grade_hist', value: v, expect: { exists: false }, ...S.pin('gm') })).status, 409);
  assert.equal((await S.call({ action: 'put', key: 'grade_hist', value: v, expect: { exists: true, updated_at: '2026-11-09T08:00:00+00:00' }, ...S.pin('ceo') })).status, 409);
  assert.deepEqual(S.W.get('grade_hist'), GH0);
  const ok = await S.call({ action: 'put', key: 'grade_hist', value: v, expect: { exists: true, updated_at: T0 }, ...S.pin('gm') });
  assert.equal(ok.status, 200); assert.deepEqual(S.W.get('grade_hist'), v);
  S.W.rows.delete('grade_hist');
  assert.equal((await S.call({ action: 'put', key: 'grade_hist', value: GH0, expect: { exists: false }, ...S.pin('ceo') })).status, 200, 'a new row with exists:false');
});

test('reading does not go through this path (get refuses, pull never returns it); a PIN request whose check fails is 503 (no fallback to email); the v1141 / v1143 keys are unchanged', async () => {
  const S = setup();
  assert.equal((await S.call({ action: 'get', key: 'grade_hist', ...S.pin('gm') })).status, 400);
  const p = await S.call({ action: 'pull', have: {}, cs_have: {}, ...S.pin('gm') });
  assert.equal(p.status, 200);
  assert.ok(!p.j.rows.some(r => r.key === 'grade_hist') && !p.j.index.some(r => r.key === 'grade_hist'));
  assert.equal((await S.call({ action: 'put', key: 'mileage_config', value: { gmapsKey: '', ratePerMile: 0.75, roundTripDefault: true }, ...S.pin('of') })).status, 200, 'Accounting still writes the mileage rate');
  assert.equal((await S.call({ action: 'put', key: 'cs_guide', value: { a: { _at: 1 } }, ...S.pin('of') })).status, 403, 'the v1143 eight stay GM/CEO');
  S.W.wrDown = '503';
  const d = await S.call({ action: 'put', key: 'grade_hist', value: withRec(4), ...S.pin('am') }, S.email('gm'));
  assert.equal(d.status, 503, 'a PIN request is decided by the PIN only');
  assert.deepEqual(S.W.get('grade_hist'), GH0);
});
