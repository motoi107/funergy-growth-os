// secure-state v1144（2b の 6 つ目）の関数：従業員の表の個人の欄（生年月日・会社カードの下 4 桁・医療／歯科保険の加入・会社負担の保険料）。
// 見られる人は今の従業員マスターと同じ（Moto さん 11/09）。保険料（人ごと）は GM・CEO だけ。店ごとの合計はだれにでも（ログイン不要）。
// カードの下 4 桁の照合は、レシート管理を使える人に当たった人の ID と名前だけ。合成データだけ（架空の人・店）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHandler, piiIsKey, PII_KEY, PII_FIELDS, PII_HR, piiCmp, piiValid, ssIsKey, csIsKey, swIsKey, hrIsKey } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, JWT, ts6 } from './lib/secure-state-world.mjs';

const P = (dob, cardLast4, insurance, dental, insuranceAmt) => ({ dob, cardLast4, insurance, dental, insuranceAmt });
const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-CEO', name: 'Cal E', store: 'ALL', role: 'ceo', title: '', data: P('1970-01-02', '', true, true, 500) },   // 本部（ALL）の人：AM にも見える（今の従業員マスターと同じ）
  { id: 'E-OF', name: 'Ofelia', store: 'HQ', role: 'office', title: 'Accountant' },
  { id: 'E-OC', name: 'Oscar', store: 'HQ', role: 'office_crew', title: 'Office Crew' },
  { id: 'E-AM', name: 'Amy Area', store: 'S2', role: 'am', title: 'Area Manager' },
  { id: 'E-SM', name: 'Sam Manager', store: 'S1', role: 'sl', title: 'Store Manager', data: P('1985-05-05', '1111', true, false, 300) },
  { id: 'E-SL', name: 'Sally Lead', store: 'S2', role: 'sl', title: 'Server Leader', data: P('1990-03-03', '2222,3333', false, true, null) },
  { id: 'E-G2', name: 'Gus Two', store: 'S4', role: 'g2', title: 'Crew Leader', data: { dob: '2000-01-01', cardLast4: '4444' } },
  { id: 'E-CH', name: 'Chef Ken', store: 'S1', role: 'chef', title: 'Head Chef' },
  { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew', data: P('2001-01-01', '5555', true, true, 250) },   // G1：カードがあっても照合しない（アプリと同じ）
  { id: 'E-1B', name: 'Bea One', store: 'S2', role: 'crew', title: 'Crew', support: ['S1'], data: { dob: '1999/12/31' } },     // 前からの形の違う値（そのまま返す）
  { id: 'E-OUT', name: 'Gone Lead', store: 'S1', role: 'sl', title: 'Store Leader', status: '退職', data: P('1980-08-08', '1111', true, true, 999) },
  { id: 'E-SUP', name: 'Sue Support', store: 'S1', role: 'crew', title: 'Crew', support: ['S4'], data: P('1995-09-09', '', false, false, 100) },
];
const U = n => 'aaaaaaaa-0000-0000-0000-00000000000' + n;
const MGR = { [U(1)]: { role: 'gm', emp_id: 'E-GM' }, [U(2)]: { role: 'office', emp_id: 'E-OF' }, [U(3)]: { role: 'office_crew', emp_id: 'E-OC' }, [U(5)]: { role: 'ceo', emp_id: 'E-CEO' }, [U(6)]: { role: 'office', emp_id: null } };
const USERS = { gm: U(1), of: U(2), oc: U(3), ceo: U(5), ofn: U(6) };
const ME = {
  gm: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M' },
  ceo: { emp: 'E-CEO', role: 'ceo', grade: 7, stores: [], am_stores: [], name: 'Cal E' },
  of: { emp: 'E-OF', role: 'office', grade: 4, stores: [], am_stores: [], name: 'Ofelia' },
  oc: { emp: 'E-OC', role: 'office_crew', grade: 1, stores: [], am_stores: [], name: 'Oscar' },
  am: { emp: 'E-AM', role: 'am', grade: 5, stores: ['S2'], am_stores: ['S2', 'S4'], name: 'Amy Area' },
  amu: { emp: 'E-AM', role: 'staff', grade: 3, stores: ['S2'], am_stores: [], name: 'Amy Area', confirmed: false },   // 確かめがまだの AM
  sm: { emp: 'E-SM', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Sam Manager', confirmed: true },   // G4（店長）：従業員マスターは見ない
  sl: { emp: 'E-SL', role: 'staff', grade: 3, stores: ['S2'], am_stores: [], name: 'Sally Lead', confirmed: true },
  g2: { emp: 'E-G2', role: 'staff', grade: 2, stores: ['S4'], am_stores: [], name: 'Gus Two' },
  chef: { emp: 'E-CH', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Chef Ken', confirmed: true },
  chefu: { emp: 'E-CH', role: 'staff', grade: 3, stores: ['S1'], am_stores: [], name: 'Chef Ken', confirmed: false },   // 確かめがまだの Head Chef
  g1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One' },
  out: { emp: 'E-OUT', role: 'staff', grade: 3, stores: ['S1'], am_stores: [], name: 'Gone Lead' },
};
const T0 = ts6(Date.UTC(2026, 10, 3, 9, 0, 0));
// 前に v1144 の関数で直した人（emp_pii にある人）：従業員の表の値より先
const PII0 = { 'E-SL': { dob: '1990-04-04', cardLast4: '2222', insurance: true, dental: true, insuranceAmt: 120, _at: 'x', _by: 'Gina M' }, 'E-NEW': { dob: '2002-02-02', _at: 'x', _by: 'Gina M' } };

function setup(o = {}) {
  const W = makeWorld({ emps: EMPS.map(e => JSON.parse(JSON.stringify(e))), mgr: MGR, users: USERS, stores: [], wrPeople: [], pins: { ...Object.fromEntries(Object.entries(ME).map(([k, v]) => ['t' + k, v])), tstore: 'deny' }, ...o });
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  let clock = Date.UTC(2026, 10, 9, 10, 0, 0);
  const handle = createHandler({ env, fetch: W.fetch, now: () => (clock += 1000) });
  const call = async (body, hdr = {}) => {
    const r = await handle(new Request('https://fn.test/secure-state', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ANON, ...hdr }, body: JSON.stringify(body) }));
    let j = null; try { j = await r.json(); } catch { j = null; }
    return { status: r.status, j };
  };
  const as = who => ({ pin_session: 't' + who });
  const email = who => ({ authorization: 'Bearer ' + JWT(who) });
  if (o.pii !== false) W.set(PII_KEY, o.pii || PII0, T0);
  return { W, call, as, email };
}

test('the key and the helpers', () => {
  assert.ok(piiIsKey('emp_pii'));
  for (const k of ['emp_pii ', 'Emp_pii', 'emp_pii_x', 'm_employees', '', null]) assert.ok(!piiIsKey(k), String(k));
  assert.ok(!ssIsKey('emp_pii') && !csIsKey('emp_pii') && !swIsKey('emp_pii') && !hrIsKey('emp_pii'), 'not readable or writable through the other paths');
  assert.deepEqual(PII_FIELDS, ['dob', 'cardLast4', 'insurance', 'dental', 'insuranceAmt']);
  assert.deepEqual(PII_HR, ['dob', 'cardLast4', 'insurance', 'dental']);
  // 書く値：おかしな値は undefined
  for (const [k, v, want] of [['dob', '2000-02-29', '2000-02-29'], ['dob', '', ''], ['dob', null, ''], ['dob', '2001-02-29', undefined], ['dob', '1990/01/01', undefined], ['dob', '1899-12-31', undefined],
    ['dob', 19900101, undefined], ['cardLast4', '1234', '1234'], ['cardLast4', '1234,5678', '1234,5678'], ['cardLast4', '', ''], ['cardLast4', '123', undefined], ['cardLast4', '1234,', undefined],
    ['cardLast4', 'abcd', undefined], ['cardLast4', 1234, undefined], ['insurance', true, true], ['insurance', false, false], ['insurance', 'true', undefined], ['dental', 1, undefined],
    ['insuranceAmt', 450, 450], ['insuranceAmt', 0, 0], ['insuranceAmt', null, null], ['insuranceAmt', '', null], ['insuranceAmt', -1, undefined], ['insuranceAmt', 100001, undefined],
    ['insuranceAmt', '450', undefined], ['insuranceAmt', NaN, undefined], ['wage', 20, undefined]]) assert.equal(piiValid(k, v), want, k + ' ' + JSON.stringify(v));
});

test('the app\'s piiCmp and piiSendVal are the function\'s piiCmp and piiValid', () => {
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const a = /function piiCmp\(k, v\)\{[\s\S]*?\n\}/.exec(src), b = /function piiSendVal\(k, v\)\{[\s\S]*?\n\}/.exec(src);
  assert.ok(a && b, 'piiCmp and piiSendVal in index.html');
  const ctx = vm.createContext({});
  vm.runInContext(a[0] + '\n' + b[0] + '\nthis.cmp = piiCmp; this.send = piiSendVal;', ctx);
  const vals = ['', null, undefined, '2000-02-29', '2001-02-29', '1990/01/01', ' 1990-01-01 ', '1234', '1234,5678', '123', 'abcd', true, false, 'true', 0, 450, -1, 100001, '450', NaN, 19900101];
  for (const k of [...PII_FIELDS, 'wage']) for (const v of vals) {
    assert.equal(JSON.stringify(ctx.cmp(k, v)), JSON.stringify(piiCmp(k, v)), 'cmp ' + k + ' ' + String(v));
    // アプリの送る形は、関数が受ける形（真偽はアプリが true/false にそろえる。関数は真偽しか受けない）
    const sv = ctx.send(k, v);
    if (k === 'insurance' || k === 'dental') assert.equal(sv, v === true);
    else assert.equal(JSON.stringify(sv), JSON.stringify(piiValid(k, v)), 'send ' + k + ' ' + String(v));
  }
});

const ids = d => Object.keys(d || {}).sort();
test('who sees which fields of whom (the staff master of today; Moto 11/09)', async () => {
  const { call, as, email } = setup();
  const ALL = ['E-1', 'E-1B', 'E-CEO', 'E-G2', 'E-NEW', 'E-OUT', 'E-SL', 'E-SM', 'E-SUP'];
  const want = {
    gm: ['full', ALL], ceo: ['full', ALL], of: ['hr', ALL],
    oc: ['flag', ['E-1', 'E-1B', 'E-CEO', 'E-G2', 'E-OUT', 'E-SL', 'E-SM', 'E-SUP']],          // 事務Crew：生年月日があるかだけ（社員の表にまだ無い人は入らない）
    am: ['hr', ['E-1B', 'E-CEO', 'E-G2', 'E-SL', 'E-SUP']],                                    // 担当の店 S2・S4（応援も）と本部 ALL の人
    chef: ['hr', ['E-1', 'E-1B', 'E-CEO', 'E-G2', 'E-OUT', 'E-SL', 'E-SM', 'E-SUP']],          // Head Chef：全員（社員の表にまだ無い人は入らない）
    amu: ['none', []], sm: ['none', []], sl: ['none', []], g2: ['none', []], chefu: ['none', []], g1: ['none', []], out: ['none', []],
  };
  for (const [who, [lv, list]] of Object.entries(want)) {
    const r2 = await call({ action: 'pii_get', ...as(who) });
    assert.equal(r2.status, 200, who);
    assert.equal(r2.j.piifn, 1);
    assert.equal(r2.j.level, lv, who);
    assert.deepEqual(ids(r2.j.data), list.slice().sort(), who);
  }
  const g = (await call({ action: 'pii_get', ...as('gm') })).j.data;
  assert.deepEqual(g['E-SM'], P('1985-05-05', '1111', true, false, 300), 'from the employee table (before the SQL)');
  assert.deepEqual(g['E-SL'], P('1990-04-04', '2222', true, true, 120), 'emp_pii first (changed with the v1144 function)');
  assert.deepEqual(g['E-1B'], { dob: '1999/12/31' }, 'an old odd value is returned as it is');
  assert.deepEqual(g['E-NEW'], { dob: '2002-02-02' }, 'a person registered but not yet in the table (no _at / _by)');
  const o = (await call({ action: 'pii_get', ...as('of') })).j.data;
  assert.deepEqual(o['E-SM'], { dob: '1985-05-05', cardLast4: '1111', insurance: true, dental: false }, 'accounting: no insurance amount');
  assert.ok(!Object.values(o).some(x => 'insuranceAmt' in x));
  const c = (await call({ action: 'pii_get', ...as('oc') })).j.data;
  assert.deepEqual(c['E-SM'], { _dobSet: true });
  assert.ok(!('E-GM' in c), 'no birthday, nothing');
  assert.ok(Object.values(c).every(x => JSON.stringify(x) === '{"_dobSet":true}'), 'only the flag');
  // メールのログイン：GM・経理（社員と結ばれていない経理も）。社員と結ばれた経理の行が無くなったら何も
  assert.equal((await call({ action: 'pii_get' }, email('gm'))).j.level, 'full');
  assert.equal((await call({ action: 'pii_get' }, email('ofn'))).j.level, 'hr');
  // 店舗の PIN のタブレット（work-requests が断る）：401
  assert.equal((await call({ action: 'pii_get', pin_session: 'tstore' })).status, 401);
  assert.equal((await call({ action: 'pii_get' })).status, 401, 'no login');
});

test('a manager whose employee row is gone or out sees nothing (the PIN is remembered for 60 s)', async () => {
  const { W, call, as, email } = setup();
  assert.equal((await call({ action: 'pii_get', ...as('of') })).j.level, 'hr');
  W.emps.splice(W.emps.findIndex(e => e.id === 'E-OF'), 1);
  assert.equal((await call({ action: 'pii_get', ...as('of') })).j.level, 'none');
  assert.equal((await call({ action: 'pii_get' }, email('of'))).j.level, 'none');
  W.emps.find(e => e.id === 'E-AM').status = '退職';
  assert.equal((await call({ action: 'pii_get', ...as('am') })).j.level, 'none');
  W.emps.find(e => e.id === 'E-GM').data = { osDisabled: true };
  assert.equal((await call({ action: 'pii_get', ...as('gm') })).j.level, 'none');
  assert.equal((await call({ action: 'pii_op', id: 'E-1', set: { dob: '' }, base: {}, ...as('gm') })).status, 403);
});

test('change: one person, the fields that changed; the whole record goes to emp_pii; the employee table is not touched', async () => {
  const { W, call, as } = setup();
  const before = JSON.stringify(W.emps);
  const r = await call({ action: 'pii_op', id: 'E-SM', set: { dob: '1985-06-06', insuranceAmt: 350 }, base: { dob: '1985-05-05', insuranceAmt: 300 }, ...as('gm') });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.same, false);
  assert.deepEqual(r.j.entry, P('1985-06-06', '1111', true, false, 350));
  const v = W.get(PII_KEY);
  assert.deepEqual({ ...v['E-SM'], _at: 0 }, { ...P('1985-06-06', '1111', true, false, 350), _at: 0, _by: 'Gina M' }, 'the other fields are copied from the table');
  assert.deepEqual(v['E-SL'], PII0['E-SL'], 'the others are kept');
  assert.equal(JSON.stringify(W.emps), before, 'the employee table is not changed');
  // 同じ値をもう一度：書かない
  const p0 = W.calls.patch;
  const r2 = await call({ action: 'pii_op', id: 'E-SM', set: { dob: '1985-06-06' }, base: { dob: '1985-05-05' }, ...as('gm') });
  assert.equal(r2.status, 200); assert.equal(r2.j.same, true); assert.equal(W.calls.patch, p0);
  // 空にする（空・false・null も値）
  const r3 = await call({ action: 'pii_op', id: 'E-SM', set: { cardLast4: '', insurance: false }, base: { cardLast4: '1111', insurance: true }, ...as('of') });
  assert.equal(r3.status, 200);
  assert.deepEqual(r3.j.entry, { dob: '1985-06-06', cardLast4: '', insurance: false, dental: false }, 'accounting gets 4 fields back');
  assert.equal(W.get(PII_KEY)['E-SM'].insuranceAmt, 350, 'the amount stays');
  assert.equal(W.get(PII_KEY)['E-SM']._by, 'Ofelia');
});

test('change: who may change what', async () => {
  const { W, call, as } = setup();
  const op = (who, id, set, base = {}) => call({ action: 'pii_op', id, set, base, ...as(who) });
  assert.equal((await op('of', 'E-SM', { insuranceAmt: 1 }, { insuranceAmt: 300 })).status, 403, 'accounting cannot change the amount (GM・CEO only)');
  assert.equal((await op('chef', 'E-SM', { insuranceAmt: 1 }, { insuranceAmt: 300 })).status, 403);
  assert.equal((await op('ceo', 'E-SM', { insuranceAmt: 1 }, { insuranceAmt: 300 })).status, 200);
  assert.equal((await op('chef', 'E-SM', { dob: '1985-07-07' }, { dob: '1985-05-05' })).status, 200, 'Head Chef: everybody');
  assert.equal((await op('am', 'E-SL', { cardLast4: '7777' }, { cardLast4: '2222' })).status, 200, 'AM: a person of the store');
  assert.equal((await op('am', 'E-SUP', { dob: '' }, { dob: '1995-09-09' })).status, 200, 'AM: a helper of the store');
  assert.equal((await op('am', 'E-CEO', { dental: false }, { dental: true })).status, 200, 'AM: a head-office (ALL) person (as the staff master shows)');
  assert.equal((await op('am', 'E-1', { dob: '' }, { dob: '2001-01-01' })).status, 403, 'AM: another store');
  assert.equal((await op('am', 'E-ZZ', { dob: '2000-01-01' })).status, 404, 'AM: not in the table yet (the app sends again later)');
  assert.equal((await op('chef', 'E-ZZ', { dob: '2000-01-01' })).status, 404);
  assert.equal((await op('of', 'E-ZZ', { dob: '2000-01-01' })).status, 200, 'accounting: a person registered now');
  assert.equal(W.get(PII_KEY)['E-ZZ'].dob, '2000-01-01');
  for (const who of ['oc', 'amu', 'sm', 'sl', 'g2', 'chefu', 'g1', 'out']) assert.equal((await op(who, 'E-1', { dob: '' }, { dob: '2001-01-01' })).status, 403, who);
  assert.equal((await call({ action: 'pii_op', id: 'E-1', set: { dob: '' }, base: {}, pin_session: 'tstore' })).status, 401);
  // 形
  for (const b of [{ id: 'E 1', set: { dob: '' } }, { id: 'E-1', set: {} }, { id: 'E-1', set: { wage: 30 } }, { id: 'E-1', set: { dob: '2001-02-30' } }, { id: 'E-1', set: { cardLast4: '12' } },
    { id: 'E-1', set: { insurance: 'yes' } }, { id: 'E-1', set: { insuranceAmt: -5 } }, { id: 'E-1', set: [] }, { id: 1, set: { dob: '' } }, { id: 'E-1' }]) {
    assert.equal((await call({ action: 'pii_op', ...b, base: {}, ...as('gm') })).status, 400, JSON.stringify(b));
  }
});

test('change: another device changed the same field first -> 409 (nothing written); a different field is fine', async () => {
  const { W, call, as } = setup();
  const op = (who, id, set, base) => call({ action: 'pii_op', id, set, base, ...as(who) });
  assert.equal((await op('gm', 'E-1', { dob: '2001-02-02' }, { dob: '2001-01-01' })).status, 200);
  const v0 = JSON.stringify(W.get(PII_KEY));
  assert.equal((await op('of', 'E-1', { dob: '2001-03-03' }, { dob: '2001-01-01' })).status, 409, 'read before the GM change');
  assert.equal(JSON.stringify(W.get(PII_KEY)), v0);
  assert.equal((await op('of', 'E-1', { dob: '2001-02-02' }, { dob: '2001-01-01' })).status, 200, 'the same value as the change: fine');
  assert.equal((await op('of', 'E-1', { cardLast4: '9999' }, { cardLast4: '5555' })).status, 200, 'another field: fine');
  assert.deepEqual({ ...W.get(PII_KEY)['E-1'], _at: 0, _by: 0 }, { ...P('2001-02-02', '9999', true, true, 250), _at: 0, _by: 0 });
  // 空と「無い」は同じ（画面を開いたとき空だった欄）
  assert.equal((await op('gm', 'E-GM', { dob: '1975-01-01' }, { dob: null })).status, 200);
});

test('change: the row changes between the read and the write -> read again and keep the other change', async () => {
  const { W, call, as } = setup();
  let fired = false;
  W.afterGet = url => {
    if (fired || !String(url).includes('key=eq.emp_pii')) return false;
    fired = true;
    // ほかの端末が、同じあいだに別の人を直した（行の版が変わる）
    const v = W.get(PII_KEY); v['E-SUP'] = { ...P('1995-09-09', '', false, false, 100), dob: '1995-10-10', _at: 'y', _by: 'Cal E' };
    W.set(PII_KEY, v, ts6(Date.UTC(2026, 10, 9, 11, 0, 0)));
    return true;
  };
  const r = await call({ action: 'pii_op', id: 'E-1', set: { dental: false }, base: { dental: true }, ...as('gm') });
  assert.equal(r.status, 200);
  assert.ok(fired);
  const v = W.get(PII_KEY);
  assert.equal(v['E-SUP'].dob, '1995-10-10', 'the other device\'s change is kept');
  assert.equal(v['E-1'].dental, false);
  // 同じ人の同じ欄が、読んだあとに変わった：読み直して 409
  let fired2 = false;
  W.afterGet = url => {
    if (fired2 || !String(url).includes('key=eq.emp_pii')) return false;
    fired2 = true;
    const v2 = W.get(PII_KEY); v2['E-1'] = { ...v2['E-1'], cardLast4: '8888' };
    W.set(PII_KEY, v2, ts6(Date.UTC(2026, 10, 9, 12, 0, 0)));
    return true;
  };
  const r2 = await call({ action: 'pii_op', id: 'E-1', set: { cardLast4: '6666' }, base: { cardLast4: '5555' }, ...as('gm') });
  assert.equal(r2.status, 409);
  assert.equal(W.get(PII_KEY)['E-1'].cardLast4, '8888');
});

test('an emp_pii row that is not an object is not read or overwritten', async () => {
  const { W, call, as } = setup({ pii: ['x'] });
  assert.equal((await call({ action: 'pii_get', ...as('gm') })).status, 500);
  assert.equal((await call({ action: 'pii_op', id: 'E-1', set: { dob: '' }, base: { dob: '2001-01-01' }, ...as('gm') })).status, 500);
  assert.deepEqual(W.get(PII_KEY), ['x']);
  assert.equal((await call({ action: 'ins_totals' })).status, 500);
});

test('no emp_pii row yet (before anybody changed): read from the table; the first change makes the row', async () => {
  const { W, call, as } = setup({ pii: false });
  const g = (await call({ action: 'pii_get', ...as('gm') })).j;
  assert.equal(g.updated_at, null);
  assert.deepEqual(g.data['E-SL'], P('1990-03-03', '2222,3333', false, true, null));
  assert.equal((await call({ action: 'pii_op', id: 'E-SL', set: { dental: false }, base: { dental: true }, ...as('gm') })).status, 200);
  assert.deepEqual(Object.keys(W.get(PII_KEY)), ['E-SL']);
});

test('card match: G2 and up, in service; the ID and the name only; who may ask', async () => {
  const { call, as, email } = setup();
  const m = async (who, last4s) => call({ action: 'card_match', last4s, ...as(who) });
  const r = await m('sl', ['1111', '2222', '3333', '4444', '5555', '0000']);
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.matches, {
    '1111': [{ id: 'E-SM', name: 'Sam Manager' }],      // 退職の人（同じ番号）は入らない
    '2222': [{ id: 'E-SL', name: 'Sally Lead' }],       // emp_pii の値（3333 は前の値）
    '3333': [], '4444': [{ id: 'E-G2', name: 'Gus Two' }], '5555': [], '0000': [],   // G1 は入らない（アプリと同じ）
  });
  assert.ok(!JSON.stringify(r.j).includes('dob') && !JSON.stringify(r.j).includes('1985'), 'no other fields');
  for (const who of ['gm', 'ceo', 'of', 'oc', 'am', 'amu', 'sm', 'chef', 'chefu']) assert.equal((await m(who, ['1111'])).status, 200, who);   // レシート管理を使える人（G3 以上）
  for (const who of ['g2', 'g1', 'out']) assert.equal((await m(who, ['1111'])).status, 403, who);
  assert.equal((await call({ action: 'card_match', last4: '1111' }, email('oc'))).status, 200);
  assert.equal((await call({ action: 'card_match', last4: '1111', pin_session: 'tstore' })).status, 401, 'a store tablet: choose by hand');
  for (const b of [{ last4: '111' }, { last4: 1111 }, { last4s: [] }, { last4s: Array(21).fill('1111') }, { last4s: ['1111', 'abcd'] }, {}]) assert.equal((await call({ action: 'card_match', ...b, ...as('gm') })).status, 400, JSON.stringify(b));
});

test('card match: 200 numbers in 10 minutes per person (so nobody can try all 10,000)', async () => {
  const { call, as } = setup();
  const twenty = Array.from({ length: 20 }, (_, i) => String(1000 + i));
  for (let i = 0; i < 10; i++) assert.equal((await call({ action: 'card_match', last4s: twenty, ...as('sl') })).status, 200, 'round ' + i);
  assert.equal((await call({ action: 'card_match', last4: '1111', ...as('sl') })).status, 429);
  assert.equal((await call({ action: 'card_match', last4: '1111', ...as('am') })).status, 200, 'another person is counted apart');
});

test('insurance totals: anybody (no login); the same as the app\'s storeInsuranceMonthly', async () => {
  const { W, call } = setup();
  const r = await call({ action: 'ins_totals' }, { authorization: '' });
  assert.equal(r.status, 200);
  assert.equal(r.j.piifn, 1);
  // S1：E-SM 300＋E-1 250＋E-SUP 100（退職の E-OUT は入らない）／S2：E-SL 120（emp_pii）／ALL：E-CEO 500
  assert.deepEqual(r.j.totals, { ALL: 500, S1: 650, S2: 120 });
  assert.ok(!JSON.stringify(r.j).includes('E-'), 'no person');
  assert.equal((await call({ action: 'ins_totals', pin_session: 'tstore' })).status, 200, 'a store tablet too');
  // アプリの storeInsuranceMonthly（従業員マスターの値＝emp_pii を重ねたもの）と同じ
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const f1 = /function empInsuranceAmt\(e\)\{[^\n]*\}/.exec(src), f2 = /function storeInsuranceMonthly\(storeId\)\{[\s\S]*?\n\}/.exec(src);
  assert.ok(f1 && f2);
  const v = W.get(PII_KEY);
  const emps = W.emps.map(e => { const o = { ...(e.data || {}), id: e.id, name: e.name, store: e.store, status: e.status || '在籍' }; if (v[e.id]) Object.assign(o, v[e.id]); return o; });
  const ctx = vm.createContext({ getEmployees: () => emps, piiFnSeen: () => false });
  vm.runInContext(f1[0] + '\n' + f2[0] + '\nthis.f = storeInsuranceMonthly;', ctx);
  for (const s of ['S1', 'S2', 'S4', 'ALL', 'HQ']) assert.equal(r.j.totals[s] || 0, ctx.f(s), s);
});

test('the other paths do not read or write emp_pii; every answer says piifn:1', async () => {
  const { W, call, as } = setup();
  assert.equal((await call({ action: 'get', key: PII_KEY, ...as('gm') })).status, 400);
  const put = await call({ action: 'put', key: PII_KEY, value: {}, expect: { exists: true, updated_at: T0 }, ...as('gm') });
  assert.ok(put.status >= 400, 'put is refused');
  assert.deepEqual(W.get(PII_KEY), PII0);
  const pl = await call({ action: 'pull', ...as('gm') });
  assert.ok(!JSON.stringify(pl.j).includes('1990-04-04'), 'pull does not carry emp_pii');
  for (const r of [pl, await call({ action: 'nope', ...as('gm') }), await call({ action: 'pii_get' })]) assert.equal(r.j.piifn, 1);
});
