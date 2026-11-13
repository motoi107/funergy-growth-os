// secure-state v1143（2b の 5 つ目）の関数：GM・CEO だけが変える賞与・Career Score の設定 8 つ（スコア基準・係数・係数の幅・G3 の職種・
// 4 項目の設定・個人設定・強みの決まり・評価基準と例）を、GM・CEO だけが書く。読むのは今までどおり REST（この関数の get・pull では返さない）。
// 合成データだけ（架空の人と店）。PostgREST・Auth・work-requests は tests/lib/secure-state-world.mjs の偽物。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, swIsKey, swShapeOk, SW_WRITE, SW2_KEYS, ssIsKey, csIsKey, secretKey } from '../supabase/functions/secure-state/handler.mjs';
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
  chef: { emp: 'E-CH', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Chef Ken' },
  g1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One' },
};
const T0 = '2026-11-03T09:00:00.000000+00:00';
// 8 つのキーの、アプリが書く形の見本（合成）
const V0 = {
  cs_criteria: { G2: { cats: { A: { m: 'pct', v: 60 } }, at: '2026/11/01 10:00', by: 'Gina M', _at: 5, hist: [] } },
  bonus_coef: { 'g:G3': { v: 1, at: '2026/11/01 10:00', by: 'Gina M', _at: 5, hist: [] } },
  bonus_coef_rng: { 'g:G3': { lo: 0.85, hi: 1.15, at: '2026/11/01 10:00', by: 'Gina M', _at: 5 } },
  bonus_track: { '2026-Q3|E-1': { t: 'ops', at: '2026/11/01 10:00', by: 'Gina M', _at: 5 } },
  bonus_eval_rule: { '_common|2026-Q3': { set: { j: { s: [90, 100, 110] } }, why: 'start', at: '2026/11/01 10:00', by: 'Gina M', _at: 5, _t: { j: 5 }, hist: [] } },
  bonus_eval_ovr: { 'E-1|2026-Q3': { set: { c: { on: true } }, why: 'test', at: '2026/11/01 10:00', by: 'Gina M', _at: 5, _t: { c: 5 }, hist: [] } },
  cs_strength_rule: { rule: { minItems: 3, top: 3, good: true, bal: '2/3', grow: true, hist: [], at: '2026/11/01 10:00', by: 'Gina M', _at: 5 } },
  cs_guide: { 'H1@ja': { v: { what: '文' }, L: 'ja', key: 'H1', hist: [], at: '2026/11/01 10:00', by: 'Gina M', _at: 5 } },
};
const more = (k, i) => ({ ...V0[k], ['new|' + i]: { x: i, _at: 10 + i } });

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
  for (const k of SW2_KEYS) W.set(k, V0[k], T0);
  W.set('mileage_config', { gmapsKey: '', ratePerMile: 0.7, roundTripDefault: true }, T0);
  W.set('tasks_all', { a: 1 }, T0);
  return { W, call, pin, email };
}
const writes = (W, key) => W.log.filter(x => x[0] === 'write' && x[2] === key).map(x => x[1]);

test('the eight keys: GM and CEO only (the same as the screens); still readable (not secret, not Career Score); the app and the SQL list the same keys', () => {
  assert.deepEqual([...SW2_KEYS].sort(), ['bonus_coef', 'bonus_coef_rng', 'bonus_eval_ovr', 'bonus_eval_rule', 'bonus_track', 'cs_criteria', 'cs_guide', 'cs_strength_rule']);
  for (const k of SW2_KEYS) {
    assert.deepEqual(SW_WRITE[k], ['ceo', 'gm'], k);
    assert.ok(swIsKey(k) && !secretKey(k) && !ssIsKey(k) && !csIsKey(k), k + ' is guarded for writing only');
  }
  // v1143 の 8 つに入れないキー（グレードの履歴は v1145 で別に足した＝GH_KEYS。賞与の確定・原資は v1139 の秘密のキー）
  assert.ok(!SW2_KEYS.includes('grade_hist'), 'grade_hist is not one of the v1143 eight (v1145 adds it on its own: ghfn)');
  for (const k of ['bonus_eval', 'bonus_store_q', 'bonus_pool_extra', 'bonus_rules', 'karte_bonus_config', 'cs_criteria_x', 'cs_guide ', 'Bonus_coef']) assert.ok(!SW2_KEYS.includes(k) && !Object.prototype.hasOwnProperty.call(SW_WRITE, k), k);
});

test('the shape check for the eight: a map of records (object or null), keys up to 200 characters, up to 6 million characters; odd records only as they already are in the cloud', () => {
  for (const k of SW2_KEYS) {
    assert.ok(swShapeOk(k, V0[k]), k); assert.ok(swShapeOk(k, {}), k + ' empty'); assert.ok(swShapeOk(k, { a: null }), k + ' null record');
    assert.ok(swShapeOk(k, { ['k'.repeat(200)]: {} }), k + ' a 200-character key');
    for (const v of [null, [], 'x', 5, { a: 1 }, { a: 'x' }, { a: [] }, { ['k'.repeat(201)]: {} }, { __st: 1, v: V0[k] }]) assert.ok(!swShapeOk(k, v), k + ' ' + JSON.stringify(v).slice(0, 40));
    assert.ok(swShapeOk(k, { a: { t: 'y'.repeat(5000000) } }), k + ' 5 million characters (history can grow)');
    assert.ok(!swShapeOk(k, { a: { t: 'y'.repeat(6000001) } }), k + ' over 6 million characters');
    // クラウドにもうある形の合わない記録は、同じままなら通す
    const cloud = { ...V0[k], x: 1 };
    assert.ok(swShapeOk(k, { ...V0[k], x: 1, b: { _at: 1 } }, cloud)); assert.ok(!swShapeOk(k, { ...V0[k], x: 2 }, cloud)); assert.ok(!swShapeOk(k, { ...V0[k], y: 1 }, cloud));
  }
  assert.ok(!swShapeOk('career_cfg', { ['k'.repeat(101)]: {} }), 'the Score settings keep their 100-character keys (v1141)');
});

test('GM and CEO write each of the eight (PIN or email) with the server key; the answer says sw2:1 and who wrote', async () => {
  const S = setup();
  let i = 0;
  for (const k of SW2_KEYS) for (const [how, who] of [['pin', 'gm'], ['pin', 'ceo'], ['email', 'gm'], ['email', 'ceo']]) {
    const v = more(k, ++i);
    const r = await S.call({ action: 'put', key: k, value: v, ...(how === 'pin' ? S.pin(who) : {}) }, how === 'email' ? S.email(who) : {});
    assert.equal(r.status, 200, k + ' ' + how + ' ' + who); assert.equal(r.j.ok, true); assert.equal(r.j.sw2, 1); assert.equal(r.j.swfn, 1); assert.equal(r.j.hrfn, 1);
    assert.equal(r.j.by, who === 'gm' ? 'gm' : 'ceo'); assert.ok(!r.j.same);
    assert.deepEqual(S.W.get(k), v, k + ' ' + how + ' ' + who);
  }
  for (const k of SW2_KEYS) assert.deepEqual(writes(S.W, k), ['service', 'service', 'service', 'service'], k);
});

test('everyone else is refused (403) and nothing is written — Accounting, office crew, AM, G4, Head Chef, crew; a GM account without an employee link; a retired GM; the device cannot claim a role', async () => {
  const S = setup();
  for (const k of SW2_KEYS) {
    const v = more(k, 1);
    for (const who of ['of', 'oc', 'am', 'g4', 'chef', 'g1']) {
      const r = await S.call({ action: 'put', key: k, value: v, ...S.pin(who) });
      assert.equal(r.status, 403, k + ' ' + who); assert.equal(r.j.error, 'forbidden'); assert.equal(r.j.sw2, 1);
    }
    assert.equal((await S.call({ action: 'put', key: k, value: v }, S.email('of'))).status, 403, k + ' Accounting by email');
    assert.equal((await S.call({ action: 'put', key: k, value: v }, S.email('gmout'))).status, 401, k + ' a retired GM cannot sign in');
    assert.equal((await S.call({ action: 'put', key: k, value: v }, S.email('stranger'))).status, 401);
    assert.equal((await S.call({ action: 'put', key: k, value: v })).status, 401, k + ' the public key alone');
    assert.equal((await S.call({ action: 'put', key: k, value: v, role: 'gm', ...S.pin('am') })).status, 403, k + ' the device says gm');
    assert.deepEqual(S.W.get(k), V0[k]);
  }
  // メールのアカウントが社員と結ばれていない GM は、メールのログインなら manager_auth の役割で入れる（v1141 と同じ）
  const r = await S.call({ action: 'put', key: 'cs_guide', value: more('cs_guide', 2) }, S.email('gmnoemp'));
  assert.equal(r.status, 200, 'an email GM without an employee link');
  assert.deepEqual(SW2_KEYS.flatMap(k => writes(S.W, k)), ['service']);
});

test('the same value as the cloud passes for anyone signed in without writing (an unchanged resend from a non-GM device does not stop); no row is never "the same"', async () => {
  const S = setup();
  // v1148：賞与の個人設定・G3 の職種は、全部を読めない人（GM・CEO 以外）には同じ値でも 403（「同じ値か」で中身を当てる道にしない）
  for (const k of SW2_KEYS) {
    const r = await S.call({ action: 'put', key: k, value: JSON.parse(JSON.stringify(V0[k])), ...S.pin('g4') });
    if (['bonus_eval_ovr', 'bonus_track'].includes(k)) { assert.equal(r.status, 403, k + ' (v1148)'); continue; }
    assert.equal(r.status, 200, k); assert.equal(r.j.same, true); assert.equal(r.j.updated_at, T0);
  }
  assert.equal(S.W.log.filter(x => x[0] === 'write').length, 0);
  S.W.rows.delete('cs_guide');
  assert.equal((await S.call({ action: 'put', key: 'cs_guide', value: V0.cs_guide, ...S.pin('g4') })).status, 403);
});

test('a bad shape is refused (400) even for the CEO; an odd record already in the cloud does not stop the GM', async () => {
  const S = setup();
  for (const k of SW2_KEYS) for (const value of [null, [], 'x', { a: 1 }, { a: 'x' }, { __st: 1, v: V0[k], _at: 1 }]) {
    const r = await S.call({ action: 'put', key: k, value, ...S.pin('ceo') });
    assert.equal(r.status, 400, k + ' ' + JSON.stringify(value)); assert.equal(r.j.error, 'bad_value');
  }
  assert.equal(S.W.log.filter(x => x[0] === 'write').length, 0);
  S.W.set('cs_criteria', { ...V0.cs_criteria, old: 'x' }, T0);
  const v = { ...V0.cs_criteria, old: 'x', G3: { cats: {}, _at: 9 } };
  assert.equal((await S.call({ action: 'put', key: 'cs_criteria', value: v, ...S.pin('gm') })).status, 200);
  assert.equal((await S.call({ action: 'put', key: 'cs_criteria', value: { ...v, old: 'y' }, ...S.pin('gm') })).status, 400);
  assert.deepEqual(S.W.get('cs_criteria'), v);
});

test('expect (read-then-write) for the eight: a stale read is a conflict (409) and writes nothing — two GMs saving at once never lose a change', async () => {
  const S = setup();
  for (const k of SW2_KEYS) {
    const v = more(k, 3);
    assert.equal((await S.call({ action: 'put', key: k, value: v, expect: { exists: false }, ...S.pin('gm') })).status, 409, k);
    assert.equal((await S.call({ action: 'put', key: k, value: v, expect: { exists: true, updated_at: '2026-11-03T08:00:00+00:00' }, ...S.pin('ceo') })).status, 409, k);
    assert.deepEqual(S.W.get(k), V0[k]);
    const ok = await S.call({ action: 'put', key: k, value: v, expect: { exists: true, updated_at: T0 }, ...S.pin('gm') });
    assert.equal(ok.status, 200, k); assert.deepEqual(S.W.get(k), v);
  }
  S.W.rows.delete('cs_strength_rule');
  assert.equal((await S.call({ action: 'put', key: 'cs_strength_rule', value: V0.cs_strength_rule, expect: { exists: false }, ...S.pin('gm') })).status, 200, 'a new row with exists:false');
});

test('reading does not go through this path (get refuses the six, pull never returns the eight in the karte part); a PIN request whose check fails is 503 (no fallback to email); the v1141 keys are unchanged (Accounting still writes the mileage rate)', async () => {
  const S = setup();
  // v1148：賞与の個人設定・G3 の職種は get で読める（GM には全部）。ほかの 6 つは今までどおり読まない
  for (const k of SW2_KEYS) assert.equal((await S.call({ action: 'get', key: k, ...S.pin('gm') })).status, ['bonus_eval_ovr', 'bonus_track'].includes(k) ? 200 : 400, k);
  const p = await S.call({ action: 'pull', have: {}, cs_have: {}, ...S.pin('gm') });
  assert.equal(p.status, 200);
  assert.ok(!p.j.rows.some(r => SW2_KEYS.includes(r.key)) && !p.j.index.some(r => SW2_KEYS.includes(r.key)));
  assert.equal((await S.call({ action: 'put', key: 'mileage_config', value: { gmapsKey: '', ratePerMile: 0.75, roundTripDefault: true }, ...S.pin('of') })).status, 200);
  assert.equal((await S.call({ action: 'put', key: 'career_cfg', value: { a: { _at: 1 } }, ...S.pin('of') })).status, 403);
  S.W.wrDown = '503';
  const d = await S.call({ action: 'put', key: 'cs_criteria', value: more('cs_criteria', 4), ...S.pin('g4') }, S.email('gm'));
  assert.equal(d.status, 503, 'a PIN request is decided by the PIN only');
  assert.deepEqual(S.W.get('cs_criteria'), V0.cs_criteria);
});
