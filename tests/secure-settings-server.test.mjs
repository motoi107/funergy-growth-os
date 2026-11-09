// secure-state v1141（2b の 3 つ目）の関数：ガソリン代の単価（mileage_config）と Score管理（career_cfg）を、決めた人だけが書く。
// 合成データだけ（架空の人と店）。PostgREST・Auth・work-requests は tests/lib/secure-state-world.mjs の偽物。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, swIsKey, swShapeOk, SW_WRITE, ssIsKey, csIsKey, secretKey } from '../supabase/functions/secure-state/handler.mjs';
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
  { id: 'E-OUT', name: 'Gone Office', store: 'HQ', role: 'office', title: 'Accountant', status: '退職' },
];
const U = n => 'aaaaaaaa-0000-0000-0000-00000000000' + n;
const MGR = { [U(1)]: { role: 'gm', emp_id: 'E-GM' }, [U(5)]: { role: 'ceo', emp_id: 'E-CEO' }, [U(2)]: { role: 'office', emp_id: 'E-OF' }, [U(3)]: { role: 'office_crew', emp_id: 'E-OC' },
  [U(4)]: { role: 'office', emp_id: null }, [U(6)]: { role: 'office', emp_id: 'E-OUT' } };
const USERS = { gm: U(1), ceo: U(5), of: U(2), oc: U(3), ofnoemp: U(4), ofout: U(6), stranger: 'bbbbbbbb-0000-0000-0000-000000000009' };
// PIN のログイン（work-requests の whoami の答え。manager_auth の人は ceo・gm・office・office_crew、ほかは am・staff）
const ME = {
  gm: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M' },
  ceo: { emp: 'E-CEO', role: 'ceo', grade: 7, stores: [], am_stores: [], name: 'Cal E' },
  of: { emp: 'E-OF', role: 'office', grade: 4, stores: [], am_stores: [], name: 'Ofelia' },
  oc: { emp: 'E-OC', role: 'office_crew', grade: 1, stores: [], am_stores: [], name: 'Oscar' },
  am: { emp: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1'], name: 'Amy Area' },
  g4: { emp: 'E-4', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Leo Four' },
  chef: { emp: 'E-CH', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Chef Ken' },
  g1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One' },
};
const T0 = '2026-11-03T09:00:00.000000+00:00';
const MI0 = { gmapsKey: '', ratePerMile: 0.7, roundTripDefault: true };
const CG0 = { '経理|G4': { role: '', hide: [], csView: null, csEdit: null, csApprove: ['am'], _at: 5 } };

function setup(o = {}) {
  const W = makeWorld({ emps: EMPS.map(e => ({ ...e })), mgr: MGR, users: USERS, wrPeople: [], pins: Object.fromEntries(Object.entries(ME).map(([k, v]) => ['t' + k, v])), ...o });
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  const handle = createHandler({ env, fetch: W.fetch, now: () => Date.UTC(2026, 10, 4, 10, 0, 0) });
  const call = async (body, hdr = {}) => {
    const r = await handle(new Request('https://fn.test/secure-state', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ANON, ...hdr }, body: JSON.stringify(body) }));
    let j = null; try { j = await r.json(); } catch { j = null; }
    return { status: r.status, j };
  };
  const pin = who => ({ pin_session: 't' + who });
  const email = who => ({ authorization: 'Bearer ' + JWT(who) });
  W.set('mileage_config', MI0, T0);
  W.set('career_cfg', CG0, T0);
  W.set('tasks_all', { a: 1 }, T0);
  return { W, call, pin, email };
}
const writes = (W, key) => W.log.filter(x => x[0] === 'write' && x[2] === key).map(x => x[1]);

test('the keys: mileage_config and career_cfg (v1141) and the eight GM/CEO settings (v1143); not secret (still readable); the rules per key', () => {
  assert.deepEqual(Object.keys(SW_WRITE).sort(), ['bonus_coef', 'bonus_coef_rng', 'bonus_eval_ovr', 'bonus_eval_rule', 'bonus_track', 'career_cfg', 'cs_criteria', 'cs_guide', 'cs_strength_rule', 'mileage_config']);
  assert.deepEqual(SW_WRITE.mileage_config, ['ceo', 'gm', 'office'], 'Moto 11/04: CEO, GM and Accounting');
  assert.deepEqual(SW_WRITE.career_cfg, ['ceo', 'gm']);
  for (const k of ['mileage_config', 'career_cfg']) { assert.ok(swIsKey(k)); assert.ok(!secretKey(k) && !ssIsKey(k) && !csIsKey(k), k + ' stays readable'); }
  for (const k of ['mileage_requests', 'career_cfg ', 'Career_cfg', 'cs_criteria_', 'grade_hist', 'q_budgets', 'growth_karte', 'toString', '__proto__', 'constructor', 'hasOwnProperty', '', null, undefined, 1]) assert.ok(!swIsKey(k), String(k));
});

test('the shape check: a mileage rate the server can use (0.01 <= rate <= 5, never wrapped); the Score settings are a map (odd records only as they already are in the cloud)', () => {
  const ok = [MI0, { ratePerMile: 5 }, { ratePerMile: 0.01 }, { ratePerMile: 0.7, gmapsKey: null }, { ratePerMile: 0.7, gmapsKey: 'k'.repeat(300), roundTripDefault: false }];
  for (const v of ok) assert.ok(swShapeOk('mileage_config', v), JSON.stringify(v));
  const bad = [null, [], 'x', {}, { ratePerMile: 0 }, { ratePerMile: -1 }, { ratePerMile: 5.0001 }, { ratePerMile: '0.7' }, { ratePerMile: NaN }, { ratePerMile: Infinity },
    { ratePerMile: 0.009 }, { ratePerMile: 1e-9 },   // 独立レビュー P3-1：短い距離が 0 セントになり申請が止まる
    { ratePerMile: 0.7, gmapsKey: 5 }, { ratePerMile: 0.7, gmapsKey: 'k'.repeat(301) }, { ratePerMile: 0.7, roundTripDefault: 'yes' }, { __st: 1, v: { ratePerMile: 9 } },
    { __st: 1, v: { ratePerMile: 0.66 }, _at: 3 }, { __st: '1', ratePerMile: 0.7, v: {} }, { __st: '1', ratePerMile: 0.7, v: { ratePerMile: 5 } }, { ratePerMile: 0.7, __st: 0 },   // 包んだ形は書かない（画面と精算で違う単価）
    { ratePerMile: 0.7, junk: 'x'.repeat(20001) }];
  for (const v of bad) assert.ok(!swShapeOk('mileage_config', v), JSON.stringify(v).slice(0, 60));
  assert.ok(swShapeOk('career_cfg', CG0)); assert.ok(swShapeOk('career_cfg', {})); assert.ok(swShapeOk('career_cfg', { 'a|G1': null }));
  for (const v of [null, [], 'x', { a: 1 }, { a: [] }, { ['k'.repeat(101)]: {} }, { a: { x: 'y'.repeat(1000001) } }]) assert.ok(!swShapeOk('career_cfg', v), JSON.stringify(v).slice(0, 40));
  // 独立レビュー P2-1：クラウドにもうある形の合わない記録は、同じままなら通す（新しく入れる・変えるのは断る）
  const cloud = { ...CG0, x: 1, y: [1, { a: 2 }] };
  assert.ok(swShapeOk('career_cfg', { ...CG0, x: 1, y: [1, { a: 2 }], 'b|G2': { _at: 1 } }, cloud));
  assert.ok(swShapeOk('career_cfg', { ...CG0, x: 1 }, cloud), 'one of them dropped');
  for (const v of [{ ...CG0, x: 2 }, { ...CG0, x: 1, z: 3 }, { ...CG0, y: [1] }]) assert.ok(!swShapeOk('career_cfg', v, cloud), JSON.stringify(v));
  for (const c of [null, undefined, [], 'x', { x: '1' }]) assert.ok(!swShapeOk('career_cfg', { ...CG0, x: 1 }, c), JSON.stringify(c));
  assert.ok(!swShapeOk('tasks_all', {}));
});

test('mileage_config: CEO, GM and Accounting write it (PIN or email) with the server key; the answer says swfn:1', async () => {
  const S = setup();
  const cases = [['pin', 'gm'], ['pin', 'ceo'], ['pin', 'of'], ['email', 'gm'], ['email', 'ceo'], ['email', 'of'], ['email', 'ofnoemp']];
  let n = 0;
  for (const [how, who] of cases) {
    const v = { gmapsKey: '', ratePerMile: 0.5 + (++n) / 100, roundTripDefault: false };
    const r = await S.call({ action: 'put', key: 'mileage_config', value: v, ...(how === 'pin' ? S.pin(who) : {}) }, how === 'email' ? S.email(who) : {});
    assert.equal(r.status, 200, how + ' ' + who); assert.equal(r.j.ok, true); assert.equal(r.j.swfn, 1); assert.equal(r.j.fn, 1); assert.equal(r.j.csfn, 1);
    assert.ok(!r.j.same);
    assert.deepEqual(S.W.get('mileage_config'), v, how + ' ' + who);
  }
  assert.deepEqual(writes(S.W, 'mileage_config'), cases.map(() => 'service'));
});

test('mileage_config: everyone else is refused (403) and nothing is written — office crew, AM, G4, Head Chef, crew, a retired accountant', async () => {
  const S = setup();
  const v = { gmapsKey: 'x', ratePerMile: 4.9, roundTripDefault: false };
  for (const who of ['oc', 'am', 'g4', 'chef', 'g1']) {
    const r = await S.call({ action: 'put', key: 'mileage_config', value: v, ...S.pin(who) });
    assert.equal(r.status, 403, who); assert.equal(r.j.error, 'forbidden'); assert.equal(r.j.swfn, 1);
  }
  assert.equal((await S.call({ action: 'put', key: 'mileage_config', value: v }, S.email('oc'))).status, 403, 'office crew by email');
  assert.equal((await S.call({ action: 'put', key: 'mileage_config', value: v }, S.email('ofout'))).status, 401, 'a retired accountant cannot log in');
  assert.equal((await S.call({ action: 'put', key: 'mileage_config', value: v }, S.email('stranger'))).status, 401);
  assert.equal((await S.call({ action: 'put', key: 'mileage_config', value: v })).status, 401, 'the public key alone');
  assert.equal((await S.call({ action: 'put', key: 'mileage_config', value: v, pin_session: 'tnobody' })).status, 401, 'an unknown PIN mark');
  // 端末が役割を言っても使わない
  assert.equal((await S.call({ action: 'put', key: 'mileage_config', value: v, role: 'gm', ...S.pin('g4') })).status, 403);
  assert.deepEqual(S.W.get('mileage_config'), MI0);
  assert.equal(writes(S.W, 'mileage_config').length, 0);
});

test('the same value as the cloud passes for anyone signed in, without writing (a bulk resend of an unchanged setting does not stop)', async () => {
  const S = setup();
  const r = await S.call({ action: 'put', key: 'mileage_config', value: { roundTripDefault: true, ratePerMile: 0.7, gmapsKey: '' }, ...S.pin('g1') });   // 欄の順だけ違う
  assert.equal(r.status, 200); assert.equal(r.j.same, true); assert.equal(r.j.updated_at, T0);
  const c = await S.call({ action: 'put', key: 'career_cfg', value: CG0, ...S.pin('am') });
  assert.equal(c.status, 200); assert.equal(c.j.same, true);
  assert.equal(S.W.log.filter(x => x[0] === 'write').length, 0, 'nothing written');
  // 行が無いときは「同じ」にならない
  S.W.rows.delete('career_cfg');
  assert.equal((await S.call({ action: 'put', key: 'career_cfg', value: CG0, ...S.pin('am') })).status, 403);
  // 決めた人の書き込みは、同じ値でも書く（ふだんの保存と同じ）
  assert.equal((await S.call({ action: 'put', key: 'mileage_config', value: MI0, ...S.pin('of') })).j.same, undefined);
  assert.deepEqual(writes(S.W, 'mileage_config'), ['service']);
});

test('career_cfg: GM and CEO only — Accounting, office crew, AM, G4 and crew are refused', async () => {
  const S = setup();
  const v = { ...CG0, '調理|G4': { role: 'chef', hide: [], csView: ['g4'], csEdit: null, csApprove: null, _at: 9 } };
  for (const who of ['of', 'oc', 'am', 'g4', 'chef', 'g1']) {
    const r = await S.call({ action: 'put', key: 'career_cfg', value: v, ...S.pin(who) });
    assert.equal(r.status, 403, who);
  }
  assert.equal((await S.call({ action: 'put', key: 'career_cfg', value: v }, S.email('of'))).status, 403, 'Accounting by email');
  assert.deepEqual(S.W.get('career_cfg'), CG0);
  for (const [i, who] of ['gm', 'ceo'].entries()) {
    const w = { ...v, n: { _at: i } };
    const r = await S.call({ action: 'put', key: 'career_cfg', value: w, ...S.pin(who) });
    assert.equal(r.status, 200, who); assert.deepEqual(S.W.get('career_cfg'), w);
  }
  assert.deepEqual(writes(S.W, 'career_cfg'), ['service', 'service']);
});

test('a bad value is refused (400) even for the CEO — a rate that would stop every mileage request is never written', async () => {
  const S = setup();
  for (const value of [{ ratePerMile: 0 }, { ratePerMile: 6 }, { ratePerMile: '0.8' }, {}, null, []]) {
    const r = await S.call({ action: 'put', key: 'mileage_config', value, ...S.pin('ceo') });
    assert.equal(r.status, 400, JSON.stringify(value)); assert.equal(r.j.error, 'bad_value');
  }
  assert.equal((await S.call({ action: 'put', key: 'career_cfg', value: [1], ...S.pin('gm') })).status, 400);
  assert.equal((await S.call({ action: 'put', key: 'mileage_config', ...S.pin('ceo') })).status, 400, 'no value');
  assert.equal((await S.call({ action: 'put', key: 'mileage_config', value: MI0, expect: 'yes', ...S.pin('ceo') })).status, 400, 'a bad expect');
  assert.equal(S.W.log.filter(x => x[0] === 'write').length, 0);
});

test('expect (read-then-write) works for these keys too: a stale read is a conflict and writes nothing', async () => {
  const S = setup();
  const v = { ...MI0, ratePerMile: 0.8 };
  assert.equal((await S.call({ action: 'put', key: 'mileage_config', value: v, expect: { exists: false }, ...S.pin('gm') })).status, 409);
  assert.equal((await S.call({ action: 'put', key: 'mileage_config', value: v, expect: { exists: true, updated_at: '2026-11-03T08:00:00+00:00' }, ...S.pin('gm') })).status, 409);
  const ok = await S.call({ action: 'put', key: 'mileage_config', value: v, expect: { exists: true, updated_at: T0 }, ...S.pin('gm') });
  assert.equal(ok.status, 200); assert.deepEqual(S.W.get('mileage_config'), v);
});

test('reading and pulling do not go through this path: get refuses the keys, pull never returns them, PIN check failure is 503 (no fallback to email)', async () => {
  const S = setup();
  for (const key of ['mileage_config', 'career_cfg']) assert.equal((await S.call({ action: 'get', key, ...S.pin('gm') })).status, 400, key);
  const p = await S.call({ action: 'pull', have: {}, cs_have: {}, ...S.pin('gm') });
  assert.equal(p.status, 200);
  assert.ok(!p.j.rows.some(r => swIsKey(r.key)) && !p.j.index.some(r => swIsKey(r.key)) && !p.j.cs.rows.some(r => swIsKey(r.key)));
  S.W.wrDown = '503';
  const d = await S.call({ action: 'put', key: 'mileage_config', value: { ...MI0, ratePerMile: 1 }, ...S.pin('g4') }, S.email('gm'));
  assert.equal(d.status, 503, 'a PIN request is decided by the PIN only (Codex P1 of v1139)');
  assert.deepEqual(S.W.get('mileage_config'), MI0);
});

test('v1141 review P2-1: an odd record that someone put in the Score settings before the SQL does not stop the GM — it stays as it is; a new odd record is refused (400)', async () => {
  const S = setup();
  S.W.set('career_cfg', { ...CG0, x: 1 }, T0);
  const v = { ...CG0, x: 1, '調理|G4': { role: 'chef', hide: [], csView: ['g4'], _at: 9 } };   // GM の端末：クラウドと合流した値（形の合わない記録も入る）
  const r = await S.call({ action: 'put', key: 'career_cfg', value: v, ...S.pin('gm') });
  assert.equal(r.status, 200); assert.deepEqual(S.W.get('career_cfg'), v);
  const n = await S.call({ action: 'put', key: 'career_cfg', value: { ...v, x: 2 }, ...S.pin('gm') });
  assert.equal(n.status, 400); assert.equal(n.j.error, 'bad_value'); assert.deepEqual(S.W.get('career_cfg'), v);
  assert.equal((await S.call({ action: 'put', key: 'career_cfg', value: { ...v, z: 'new' }, ...S.pin('ceo') })).status, 400);
  assert.deepEqual(writes(S.W, 'career_cfg'), ['service']);
});

test('v1141 review P3-6: a resend that equals the cloud passes even when the cloud value itself has the wrong shape (no write); a different value is 403, not 400', async () => {
  const S = setup();
  const odd = { __st: 1, v: { ratePerMile: 0.66 }, ratePerMile: 0.66 };
  S.W.set('mileage_config', odd, T0);
  const r = await S.call({ action: 'put', key: 'mileage_config', value: { ...odd }, ...S.pin('g4') });
  assert.equal(r.status, 200); assert.equal(r.j.same, true);
  assert.equal((await S.call({ action: 'put', key: 'mileage_config', value: { ratePerMile: 0.9 }, ...S.pin('g4') })).status, 403);
  assert.equal((await S.call({ action: 'put', key: 'mileage_config', value: 'junk', ...S.pin('g4') })).status, 403, 'not 400: whoever is not allowed is told so');
  // 決めた人が同じ包んだ形を送ると断る（直してもらう）。包まない形にすると書ける
  assert.equal((await S.call({ action: 'put', key: 'mileage_config', value: { ...odd }, ...S.pin('of') })).status, 400);
  assert.equal((await S.call({ action: 'put', key: 'mileage_config', value: { ratePerMile: 0.66 }, ...S.pin('of') })).status, 200);
  assert.equal(S.W.log.filter(x => x[0] === 'write').length, 1);
});
