// secure-state v1147（2b の 9 つ目・Moto さん 11/10「読む人も書く人も絞る」）の関数：
// Tip の期間の確定（tip_cf_<店>_<年>）と注意ログ（warnings_<店>）を、見られる店の行だけ返し、書けるのも決めた人だけ（今の画面と同じ）。
// 合成データだけ（架空の人と店）。PostgREST・Auth・work-requests は tests/lib/secure-state-world.mjs の偽物。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, scIsKey, scParse, scCanRead, tcfCheck, wnCheck, wnKey, ssIsKey, csIsKey, hrIsKey, swIsKey, tpIsKey } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, JWT } from './lib/secure-state-world.mjs';

const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-CEO', name: 'Cal E', store: 'HQ', role: 'ceo', title: '' },
  { id: 'E-OF', name: 'Ofelia', store: 'HQ', role: 'office', title: 'Accountant' },
  { id: 'E-OC', name: 'Oscar', store: 'HQ', role: 'office_crew', title: 'Office Crew' },
  { id: 'E-AM', name: 'Amy Area', store: 'S1', role: 'am', title: 'Area Manager' },
  { id: 'E-4', name: 'Leo Four', store: 'S1', support: ['S3'], role: 'g4', title: 'Store Manager' },
  { id: 'E-4U', name: 'Uma Four', store: 'S2', role: 'g4', title: 'Store Manager' },          // 社員の表は g4。GM・CEO の確かめがまだ（whoami は G3 まで）
  { id: 'E-3', name: 'Sal Three', store: 'S1', role: 'sl', title: 'Store Leader' },
  { id: 'E-4X', name: 'Xena Four', store: 'S2', role: 'g4', title: 'Store Manager' },          // whoami が G4 でも、GM・CEO の確かめの印が無い（ふつうは起きない・二重の守り）
  { id: 'E-4L', name: 'Lou Four', store: 'S1', role: 'g4', title: 'Store Manager' },           // 社員の表は g4 だが、GM・CEO が確かめたのは G3
  { id: 'E-2', name: 'Ria Two', store: 'S2', role: 'g2', title: 'Crew Leader' },
  { id: 'E-CH', name: 'Chef Ken', store: 'S1', role: 'chef', title: 'Head Chef' },
  { id: 'E-CU', name: 'Chef Uno', store: 'S2', role: 'chef', title: 'Head Chef' },           // GM・CEO が確かめたのは G4 だが Head Chef の印が無い
  { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew' },
  { id: 'E-OUT', name: 'Gone Lead', store: 'S1', role: 'sl', title: 'Store Leader', status: '退職' },
];
const U = n => 'aaaaaaaa-0000-0000-0000-00000000000' + n;
const MGR = { [U(1)]: { role: 'gm', emp_id: 'E-GM' }, [U(2)]: { role: 'office', emp_id: 'E-OF' }, [U(3)]: { role: 'office', emp_id: null }, [U(4)]: { role: 'ceo', emp_id: 'E-GONE' } };
const USERS = { gm: U(1), of: U(2), ofx: U(3), ceogone: U(4) };
const ME = {
  gm: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M', confirmed: true },
  ceo: { emp: 'E-CEO', role: 'ceo', grade: 7, stores: [], am_stores: [], name: 'Cal E', confirmed: true },
  of: { emp: 'E-OF', role: 'office', grade: 4, stores: [], am_stores: [], name: 'Ofelia', confirmed: true },
  oc: { emp: 'E-OC', role: 'office_crew', grade: 1, stores: [], am_stores: [], name: 'Oscar', confirmed: true },
  am: { emp: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1', 'S2'], name: 'Amy Area', confirmed: true },
  g4: { emp: 'E-4', role: 'staff', grade: 4, stores: ['S1', 'S3'], am_stores: [], name: 'Leo Four', confirmed: true },
  g4u: { emp: 'E-4U', role: 'staff', grade: 3, stores: ['S2'], am_stores: [], name: 'Uma Four', confirmed: false },
  g4x: { emp: 'E-4X', role: 'staff', grade: 4, stores: ['S2'], am_stores: [], name: 'Xena Four', confirmed: false },
  g4lo: { emp: 'E-4L', role: 'staff', grade: 3, stores: ['S1'], am_stores: [], name: 'Lou Four', confirmed: true },
  g3: { emp: 'E-3', role: 'staff', grade: 3, stores: ['S1'], am_stores: [], name: 'Sal Three', confirmed: true },
  g2: { emp: 'E-2', role: 'staff', grade: 2, stores: ['S2'], am_stores: [], name: 'Ria Two', confirmed: false },
  chef: { emp: 'E-CH', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Chef Ken', confirmed: true },
  chefu: { emp: 'E-CU', role: 'staff', grade: 4, stores: ['S2'], am_stores: [], name: 'Chef Uno', confirmed: true },
  g1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One', confirmed: false },
  out: { emp: 'E-OUT', role: 'staff', grade: 3, stores: ['S1'], am_stores: [], name: 'Gone Lead', confirmed: true },   // 60 秒覚えている印（そのあいだに退職）
  odd: { emp: 'E-3', role: 'store_x', grade: 3, stores: ['S1'], am_stores: [], name: 'Sal Three', confirmed: true },   // whoami の知らない役割（社員の表は店長でも何も見せない）
  store: 'deny',                                                                                                  // 店舗の PIN（whoami が断る）
};
const T0 = '2026-11-09T09:00:00.000000+00:00';
const TK = (s, y = '2026') => 'tip_cf_' + s + '_' + y, WK = s => 'warnings_' + s;
// アプリが書く形（confirmTip・unconfirmTip・logWarning）の見本（合成・額は架空）
const CF = (from, o = {}) => ({ status: '確定済み', period: 'x', range: 'y', from, to: from.slice(0, 8) + '15', weight: 'rate', by: 'Store Leader', at: '2026/11/16 10:00',
  rows: [{ name: 'Kai One', hours: 10, rate: 90, final: 123.45 }], staffCount: 1, totalFinal: 123.45, forced: false, forceReason: '', _at: 1762700000000, ...o });
const UNLOCK = (at = 1762700000500) => ({ _deleted: true, by: 'GM', at: '2026/11/16 11:00', _at: at });
const W1 = { date: '2026/11/01 10:00', by: 'Yuki', reason: '必須タスク未完了 1件 (開店準備)', id: 'wA', _mut: 1762000000000 };
const WOLD = { date: '2026/10/01 10:00', by: 'Yuki', reason: '必須タスク未完了 2件 (a, b)' };   // v832 より前（id なし）
const WNEW = (n = 1) => ({ date: '2026/11/10 09:00', by: 'Store Manager', reason: '必須タスク未完了 ' + n + '件 (閉店)', id: 'wN' + n, _mut: 1762700000000 + n });

function setup(o = {}) {
  const W = makeWorld({ emps: EMPS.map(e => ({ ...e })), mgr: MGR, users: USERS, wrPeople: [{ emp_id: 'E-CH', role: 'staff', grade: 4, chef: true }, { emp_id: 'E-CU', role: 'staff', grade: 4, chef: false }],
    pins: Object.fromEntries(Object.entries(ME).map(([k, v]) => ['t' + k, v])), ...o });
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  const handle = createHandler({ env, fetch: (u, opt) => W.fetch(u, opt), now: () => Date.UTC(2026, 10, 10, 10, 0, 0) });
  const call = async (body, hdr = {}) => {
    const r = await handle(new Request('https://fn.test/secure-state', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ANON, ...hdr }, body: JSON.stringify(body) }));
    let j = null; try { j = await r.json(); } catch { j = null; }
    return { status: r.status, j };
  };
  const auth = who => who.startsWith('@') ? [{}, { authorization: 'Bearer ' + JWT(who.slice(1)) }] : [{ pin_session: 't' + who }, {}];
  const as = (who, body) => { const [b, h] = auth(who); return call({ ...body, ...b }, h); };
  W.set(TK('S1'), { '2026-11-01': CF('2026-11-01') }, T0);
  W.set(TK('S2'), { '2026-11-01': CF('2026-11-01', { totalFinal: 999 }) }, T0);
  W.set(TK('S3'), { '2026-10-16': CF('2026-10-16') }, T0);
  W.set(TK('S1', '2025'), { '2025-12-16': CF('2025-12-16') }, T0);
  W.set('tip_cf_odd', { x: 1 }, T0);                       // 形の合わないキー（全店を見られる人にだけ見える）
  W.set(WK('S1'), [WOLD, W1], T0);
  W.set(WK('S2'), [W1], T0);
  W.set('tasks_all', { a: 1 }, T0);
  W.set('growth_karte', { 'E-1': { hireDate: '2024-01-01' } }, T0);
  const put = (who, key, value, ex) => as(who, { action: 'put', key, value, ...(ex === undefined ? {} : { expect: ex }) });
  const row = key => W.rows.get(key);
  const ex = key => { const r = row(key); return r ? { exists: true, updated_at: r.updated_at } : { exists: false }; };
  const pull = (who, have = {}) => as(who, { action: 'pull', have: {}, cs_have: {}, sc_have: have });
  return { W, call, as, put, ex, pull };
}
const writes = (W, key) => W.log.filter(x => x[0] === 'write' && x[2] === key).map(x => x[1]);
const keysOf = r => (r.j.sc.index || []).map(x => x.key).sort();
const ALL_SC = ['tip_cf_S1_2025', 'tip_cf_S1_2026', 'tip_cf_S2_2026', 'tip_cf_S3_2026', 'tip_cf_odd', 'warnings_S1', 'warnings_S2'];

test('the keys: tip_cf_<store>… and warnings_<store>…; nothing else, and no other family', () => {
  for (const k of ['tip_cf_S1_2026', 'tip_cf_F04-K_2026', 'tip_cf_A_B_2026', 'tip_cf_x', 'warnings_S1', 'warnings_F03-G', 'warnings_ x', 'tip_cf_' + 'x'.repeat(193)]) {
    assert.equal(scIsKey(k), true, k);
    assert.equal(ssIsKey(k) || csIsKey(k) || hrIsKey(k) || swIsKey(k) || tpIsKey(k), false, k + ' is only a v1147 key');
  }
  for (const k of ['tip_cf_', 'warnings_', 'tip_cf', 'warnings', 'Tip_cf_S1_2026', ' warnings_S1', 'tip_confirm_S1_2026-11-01', 'tip_requests', 'cash_tips_S1', 'tip_cf_' + 'x'.repeat(194), null, 3]) assert.equal(scIsKey(k), false, String(k));
  assert.deepEqual(scParse('tip_cf_A_B_2026'), { kind: 'tip', store: 'A_B', year: '2026' });
  assert.deepEqual(scParse('tip_cf_x'), { kind: 'tip', store: null, year: null });
  assert.deepEqual(scParse('warnings_F03-G'), { kind: 'wn', store: 'F03-G', year: null });
  // 形の合わない Tip のキーは、全店を見られる人にだけ見える
  assert.equal(scCanRead('tip_cf_x', { tip: true, all: true, stores: [] }), true);
  assert.equal(scCanRead('tip_cf_x', { tip: true, all: false, stores: ['x'] }), false);
  assert.equal(scCanRead('warnings_S1', { tip: true, wn: false, all: true, stores: [] }), false);
});

test('pull: who receives which stores (the same as the screens today); rows are whole; the old app (no sc_have) gets nothing new', async () => {
  const S = setup();
  const exp = {
    gm: ['all', ALL_SC], ceo: ['all', ALL_SC], of: ['all', ALL_SC],
    oc: ['all', ALL_SC.filter(k => k.startsWith('tip_cf_'))],                                        // 事務Crew：チップ管理だけ（必須チェックは開けない）
    am: ['scoped', ['tip_cf_S1_2025', 'tip_cf_S1_2026', 'tip_cf_S2_2026', 'warnings_S1', 'warnings_S2']],   // 担当の店（S1・S2）と自分の店
    g4: ['scoped', ['tip_cf_S1_2025', 'tip_cf_S1_2026', 'tip_cf_S3_2026', 'warnings_S1']],                // 自分の店と応援の店
    g4u: ['scoped', ['tip_cf_S2_2026', 'warnings_S2']],
    g4x: ['scoped', ['tip_cf_S2_2026', 'warnings_S2']], g4lo: ['scoped', ['tip_cf_S1_2025', 'tip_cf_S1_2026', 'warnings_S1']],
    g3: ['scoped', ['tip_cf_S1_2025', 'tip_cf_S1_2026', 'warnings_S1']],
    g2: ['scoped', ['tip_cf_S2_2026', 'warnings_S2']],
    chef: ['all', ALL_SC],                                                                             // GM・CEO が確かめた Head Chef：全店
    chefu: ['scoped', ['tip_cf_S2_2026', 'warnings_S2']],                                              // Head Chef の印が無い：自分の店だけ（確かめた G4 と同じ）
    g1: ['none', []], out: ['none', []], odd: ['none', []],
  };
  for (const [who, [level, keys]] of Object.entries(exp)) {
    const r = await S.pull(who);
    assert.equal(r.status, 200, who + ' ' + JSON.stringify(r.j)); assert.equal(r.j.scfn, 1);
    assert.equal(r.j.sc.level, level, who); assert.deepEqual(keysOf(r), keys, who);
    assert.deepEqual(r.j.sc.rows.map(x => x.key).sort(), keys, who + ': all rows on the first pull');
    for (const x of r.j.sc.rows) assert.deepEqual(x.value, S.W.get(x.key), who + ' ' + x.key + ': whole row');
  }
  const f = async who => (await S.pull(who)).j.sc;
  assert.deepEqual([(await f('gm')).unlock, (await f('of')).unlock, (await f('oc')).unlock, (await f('am')).unlock, (await f('g3')).unlock], [true, true, false, false, false]);
  assert.deepEqual([(await f('gm')).wnWrite, (await f('of')).wnWrite, (await f('am')).wnWrite, (await f('g4')).wnWrite, (await f('g4u')).wnWrite, (await f('g3')).wnWrite, (await f('chef')).wnWrite, (await f('chefu')).wnWrite],
    [true, false, true, true, false, false, true, true]);   // Head Chef の印が無い Head Chef も、GM・CEO が確かめた G4 なら自分の店に記録できる（G4 と同じ）
  assert.deepEqual([(await f('g4x')).wnWrite, (await f('g4lo')).wnWrite], [false, false], 'a G4 needs both the GM/CEO confirmation and grade 4 to record warnings');
  assert.deepEqual((await f('am')).stores, ['S1', 'S2']); assert.equal((await f('gm')).stores, null);
  // メールのログイン：社員と結ばれていない経理は全店。社員 ID が社員の表に無い CEO は何も
  assert.equal((await S.as('@ofx', { action: 'pull', have: {}, sc_have: {} })).j.sc.level, 'all');
  assert.equal((await S.as('@ceogone', { action: 'pull', have: {}, sc_have: {} })).j.sc.level, 'none');
  // 店舗の PIN：401（何も返さない）
  assert.equal((await S.pull('store')).status, 401);
  // 前の版のアプリ（sc_have を送らない）：sc の部分は無い
  const old = await S.as('g3', { action: 'pull', have: {}, cs_have: {} });
  assert.equal(old.status, 200); assert.equal(old.j.sc, undefined);
});

test('pull: rows the device already has (same mark) are not sent again; without the index RPC the marks come from the rows (still only the stores in scope)', async () => {
  const S = setup();
  const r1 = await S.pull('g3');
  const have = Object.fromEntries(r1.j.sc.index.map(x => [x.key, x.v]));
  const r2 = await S.pull('g3', have);
  assert.deepEqual(r2.j.sc.rows, []); assert.deepEqual(keysOf(r2), keysOf(r1));
  S.W.set(WK('S1'), [WOLD, W1, WNEW()], '2026-11-10T09:00:00.000000+00:00');
  const r3 = await S.pull('g3', have);
  assert.deepEqual(r3.j.sc.rows.map(x => x.key), [WK('S1')]);
  const N = setup({ indexMissing: true });
  const n1 = await N.pull('am');
  assert.deepEqual(keysOf(n1), ['tip_cf_S1_2025', 'tip_cf_S1_2026', 'tip_cf_S2_2026', 'warnings_S1', 'warnings_S2']);
  const n2 = await N.pull('am', Object.fromEntries(n1.j.sc.index.map(x => [x.key, x.v])));
  assert.deepEqual(n2.j.sc.rows, []);
  // 見られる店を決められない（社員の表が読めない）：sc は error（端末の写しはそのまま）・ほかは返る
  const D = setup(); const f0 = D.W.fetch;
  D.W.fetch = async (u, o) => { if (String(u).includes('/rest/v1/employees?id=eq.E-3')) return new Response(JSON.stringify({ message: 'down' }), { status: 500 }); return f0(u, o); };
  const d = await D.pull('g3');
  assert.equal(d.status, 200); assert.deepEqual(d.j.sc, { error: 'scope' });
});

test('get: a row of a store in scope; others are 403', async () => {
  const S = setup();
  let r = await S.as('g3', { action: 'get', key: TK('S1') });
  assert.equal(r.status, 200); assert.deepEqual(r.j.value, S.W.get(TK('S1')));
  for (const [who, key] of [['g3', TK('S2')], ['g3', WK('S2')], ['oc', WK('S1')], ['g1', TK('S1')], ['am', TK('S3')], ['chefu', TK('S1')], ['g3', 'tip_cf_odd']]) {
    r = await S.as(who, { action: 'get', key });
    assert.equal(r.status, 403, who + ' ' + key);
  }
  r = await S.as('gm', { action: 'get', key: 'tip_cf_odd' }); assert.equal(r.status, 200);
  r = await S.as('g3', { action: 'get', key: TK('S1', '2027') }); assert.deepEqual([r.status, r.j.exists], [200, false]);
});

test('Tip confirmation: anyone who sees the store confirms; unlocking and forcing are the CEO, GM and Accounting (as on screen); nothing is removed', async () => {
  const add = (prev, day, rec) => ({ ...prev, [day]: rec });
  // 確定（見られる人）
  for (const who of ['g3', 'g2s', 'am', 'g4', 'oc', 'gm', 'chef']) {
    const S = setup(); const w = who === 'g2s' ? 'g2' : who; const st = who === 'g2s' ? 'S2' : 'S1';
    const v = add(S.W.get(TK(st)), '2026-11-16', CF('2026-11-16', { _at: 1762900000000 }));
    const r = await S.put(w, TK(st), v, S.ex(TK(st)));
    assert.equal(r.status, 200, who + ' ' + JSON.stringify(r.j)); assert.equal(r.j.scfn, 1);
    assert.deepEqual(S.W.get(TK(st)), v); assert.deepEqual(writes(S.W, TK(st)), ['service']);
  }
  // 見られない店には、同じ値でも書かない（値を当てる道にしない）
  { const S = setup();
    for (const [who, key, v] of [['g3', TK('S2'), S.W.get(TK('S2'))], ['g3', TK('S2'), add(S.W.get(TK('S2')), '2026-11-16', CF('2026-11-16'))], ['g1', TK('S1'), S.W.get(TK('S1'))], ['chefu', TK('S1'), S.W.get(TK('S1'))], ['g3', 'tip_cf_odd', { x: 1 }]]) {
      const r = await S.put(who, key, v, S.ex(key)); assert.equal(r.status, 403, who + ' ' + key);
    }
    assert.deepEqual(writes(S.W, TK('S2')), []); }
  // 解除・例外承認：CEO・GM・経理だけ
  for (const [who, code] of [['g3', 403], ['am', 403], ['oc', 403], ['chef', 403], ['gm', 200], ['ceo', 200], ['of', 200], ['@of', 200]]) {
    const S = setup();
    const r = await S.put(who, TK('S1'), { '2026-11-01': UNLOCK() }, S.ex(TK('S1')));
    assert.equal(r.status, code, 'unlock ' + who);
    const S2 = setup();
    const r2 = await S2.put(who, TK('S1'), add(S2.W.get(TK('S1')), '2026-11-16', CF('2026-11-16', { forced: true, forceReason: 'checked' })), S2.ex(TK('S1')));
    assert.equal(r2.status, code, 'force ' + who);
  }
  // 解除のあと確定し直す（見られる人）
  { const S = setup(); S.W.set(TK('S1'), { '2026-11-01': UNLOCK() }, T0);
    const r = await S.put('g3', TK('S1'), { '2026-11-01': CF('2026-11-01', { _at: 1762800000000 }) }, S.ex(TK('S1'))); assert.equal(r.status, 200); }
  // 確定済みの記録を別の中身にする（額を書き換える）：解除できる人だけ（画面でも確定済みは「確定解除」だけ。2 台が同じ期間を確定したときのあとの端末も断られる）
  for (const [who, code] of [['g3', 403], ['am', 403], ['g4', 403], ['chef', 403], ['oc', 403], ['gm', 200], ['of', 200]]) {
    const S = setup();
    const r = await S.put(who, TK('S1'), { '2026-11-01': CF('2026-11-01', { totalFinal: 1, rows: [{ name: 'Kai One', final: 1 }], _at: 1762900000000 }) }, S.ex(TK('S1')));
    assert.equal(r.status, code, 'rewrite a live confirmation ' + who);
    if (code === 403) assert.equal(S.W.get(TK('S1'))['2026-11-01'].totalFinal, 123.45);
  }
  // 解除の印は、まだ確定していない日・もう解除した日にも、解除できる人だけ（確定する人が解除の印で上書きする道にしない）
  for (const [who, code] of [['g3', 403], ['gm', 200]]) {
    const S = setup();
    let r = await S.put(who, TK('S1'), { ...S.W.get(TK('S1')), '2026-11-16': UNLOCK() }, S.ex(TK('S1'))); assert.equal(r.status, code, 'unlock a new day ' + who);
    const S2 = setup(); S2.W.set(TK('S1'), { '2026-11-01': UNLOCK(1) }, T0);
    r = await S2.put(who, TK('S1'), { '2026-11-01': UNLOCK(2) }, S2.ex(TK('S1'))); assert.equal(r.status, code, 'stamp an unlock again ' + who);
  }
  // 記録を消す（解除の印ではなく、なくす）：だれも
  for (const who of ['gm', 'g3']) { const S = setup(); const r = await S.put(who, TK('S1'), {}, S.ex(TK('S1'))); assert.equal(r.status, 403, who); }
  // 形：オブジェクトでない・年の違う初日・確定でない状態・初日と from の違い・行が配列でない・形の合わないキーに書く
  const S = setup();
  for (const [what, key, v] of [['array', TK('S1'), []], ['string', TK('S1'), 'x'], ['other year', TK('S1'), { ...S.W.get(TK('S1')), '2025-11-16': CF('2025-11-16') }],
    ['not a day', TK('S1'), { ...S.W.get(TK('S1')), 'later': CF('2026-11-16') }], ['status', TK('S1'), { ...S.W.get(TK('S1')), '2026-11-16': CF('2026-11-16', { status: '確認中' }) }],
    ['from', TK('S1'), { ...S.W.get(TK('S1')), '2026-11-16': CF('2026-11-01') }], ['rows', TK('S1'), { ...S.W.get(TK('S1')), '2026-11-16': CF('2026-11-16', { rows: 'x' }) }],
    ['odd key', 'tip_cf_odd', { x: 2 }]]) {
    const r = await S.put('gm', key, v, S.ex(key)); assert.equal(r.status, 400, what);
  }
  assert.deepEqual(S.W.get(TK('S1')), { '2026-11-01': CF('2026-11-01') }, 'unchanged');
  // 同じ値：書かずに通す。読んだ行から変わっていれば 409
  let r = await S.put('g3', TK('S1'), S.W.get(TK('S1')), S.ex(TK('S1'))); assert.deepEqual([r.status, r.j.same], [200, true]); assert.deepEqual(writes(S.W, TK('S1')), []);
  r = await S.put('g3', TK('S1'), { ...S.W.get(TK('S1')), '2026-11-16': CF('2026-11-16') }, { exists: true, updated_at: '2026-11-01T00:00:00.000000+00:00' }); assert.equal(r.status, 409);
  r = await S.put('g3', TK('S1', '2027'), { '2027-01-01': CF('2027-01-01') }, { exists: true, updated_at: T0 }); assert.equal(r.status, 409, 'no row yet');
  r = await S.put('g3', TK('S1', '2027'), { '2027-01-01': CF('2027-01-01') }, { exists: false }); assert.equal(r.status, 200, 'a new year row');
  // 前の版が JSON の文字で書いた行も読める
  const J = setup(); J.W.set(TK('S1'), JSON.stringify({ '2026-11-01': CF('2026-11-01') }), T0);
  r = await J.put('g3', TK('S1'), { '2026-11-01': CF('2026-11-01'), '2026-11-16': CF('2026-11-16') }, J.ex(TK('S1'))); assert.equal(r.status, 200);
});

test('Tip confirmation: the write is conditional on the row the function checked (another device writing in between → 409, nothing lost)', async () => {
  const S = setup();
  const mine = { ...S.W.get(TK('S1')), '2026-11-16': CF('2026-11-16') };
  S.W.afterGet = url => { if (url.search.includes('tip_cf_S1_2026')) { S.W.set(TK('S1'), { '2026-11-01': UNLOCK() }, '2026-11-10T09:30:00.000000+00:00'); return true; } return false; };
  const r = await S.put('g3', TK('S1'), mine);
  assert.equal(r.status, 409, JSON.stringify(r.j));
  assert.deepEqual(S.W.get(TK('S1')), { '2026-11-01': UNLOCK() });
});

test('warning log: those who may record it (CEO, GM, confirmed AM / G4 / Head Chef) only add; nobody removes or rewrites; old records may get their id', async () => {
  const add = (st, rec) => (s) => [...s.W.get(WK(st)), rec];
  for (const [who, st, code] of [['gm', 'S1', 200], ['ceo', 'S2', 200], ['am', 'S2', 200], ['g4', 'S1', 200], ['chef', 'S2', 200],
    ['chefu', 'S2', 200], ['of', 'S1', 403], ['g3', 'S1', 403], ['g2', 'S2', 403], ['g4u', 'S2', 403], ['chefu', 'S1', 403], ['oc', 'S1', 403], ['g1', 'S1', 403], ['am', 'S3', 403], ['g4', 'S2', 403]]) {
    const S = setup();
    if (!S.W.rows.has(WK(st))) S.W.set(WK(st), [], T0);
    const v = add(st, WNEW())(S);
    const r = await S.put(who, WK(st), v, S.ex(WK(st)));
    assert.equal(r.status, code, who + ' ' + st + ' ' + JSON.stringify(r.j));
    if (code === 200) assert.deepEqual(S.W.get(WK(st)), v);
  }
  // 新しい店の行（まだ無い）
  { const S = setup(); const r = await S.put('am', WK('S2'), [W1, WNEW()], S.ex(WK('S2'))); assert.equal(r.status, 200); }
  { const S = setup(); S.W.rows.delete(WK('S2')); const r = await S.put('am', WK('S2'), [WNEW()], { exists: false }); assert.equal(r.status, 200); }
  // 消す・書き換える：だれも（GM も）
  for (const [what, v] of [['remove', [W1]], ['rewrite', [WOLD, { ...W1, reason: 'changed' }]], ['rewrite old', [{ ...WOLD, by: 'x' }, W1]], ['empty', []]]) {
    const S = setup(); const r = await S.put('gm', WK('S1'), v, S.ex(WK('S1'))); assert.equal(r.status, 403, what);
  }
  // 保存の印（_mut）と、id の無い前の記録に付ける id（中身から作った鍵）は変えてよい（アプリの saveWarnings が付ける）。記録しない人でも（足していなければ）
  { const S = setup(); const v = [{ ...WOLD, id: wnKey(WOLD), _mut: 1762700000009 }, { ...W1, _mut: 1762700000010 }];
    for (const who of ['gm', 'g3']) { const r = await S.put(who, WK('S1'), v, S.ex(WK('S1'))); assert.equal(r.status, 200, who); }
    const r2 = await S.put('gm', WK('S1'), [{ ...WOLD, id: 'other' }, W1], S.ex(WK('S1'))); assert.equal(r2.status, 403, 'a different id is a different record (the old one is gone)'); }
  // 同じ鍵（id）を借りて中身の違う記録を足す：だれも（記録しない人が足す道にしない。前は Map の後勝ちで、先に置いた偽の記録が通った）
  for (const who of ['g3', 'gm']) {
    for (const v of [[{ ...W1, reason: '偽の注意' }, WOLD, W1], [WOLD, W1, { ...W1, reason: '偽の注意' }], [WOLD, W1, { ...WOLD, id: wnKey(WOLD), by: 'x' }]]) {
      const S = setup(); const r = await S.put(who, WK('S1'), v, S.ex(WK('S1'))); assert.equal(r.status, 403, who + ' ' + JSON.stringify(v.map(x => x.reason)));
      assert.deepEqual(S.W.get(WK('S1')), [WOLD, W1]);
    }
  }
  // 前からある、同じ id で中身の違う記録が 2 つ：片方を落とすのは消すのと同じ（だれも）。両方そのままなら書ける
  { const S = setup(); const A = { date: '2026/11/02', by: 'Yuki', reason: 'a', id: 'wD' }, B2 = { ...A, reason: 'b' };
    S.W.set(WK('S1'), [A, B2, W1], T0);
    for (const v of [[A, W1, WNEW()], [B2, W1, WNEW()]]) { const r = await S.put('gm', WK('S1'), v, S.ex(WK('S1'))); assert.equal(r.status, 403, 'drop one of two ' + v[0].reason); }
    const r = await S.put('gm', WK('S1'), [A, B2, W1, WNEW()], S.ex(WK('S1'))); assert.equal(r.status, 200, 'both kept'); }
  // 前からある同じ中身の記録が 2 つ（id なし）：そのまま読める・書ける（アプリが同じ id を付ける）
  { const S = setup(); S.W.set(WK('S1'), [WOLD, WOLD, W1], T0);
    const ids = [{ ...WOLD, id: wnKey(WOLD), _mut: 1 }, { ...WOLD, id: wnKey(WOLD), _mut: 2 }, W1];
    let r = await S.put('g3', WK('S1'), ids, S.ex(WK('S1'))); assert.equal(r.status, 200, 'the store leader only stamps');
    r = await S.put('gm', WK('S1'), [...ids, WNEW()], S.ex(WK('S1'))); assert.equal(r.status, 200, 'the GM adds');
    r = await S.put('gm', WK('S1'), [ids[0], W1, WNEW()], S.ex(WK('S1'))); assert.equal(r.status, 200, 'one of two identical old records may be folded (same content)'); }
  // 形：配列でない・知らない欄・長すぎる理由
  for (const [what, v] of [['object', { a: 1 }], ['extra field', [WOLD, W1, { ...WNEW(), amount: 5 }]], ['long', [WOLD, W1, { ...WNEW(), reason: 'x'.repeat(4001) }]], ['not a record', [WOLD, W1, 'x']]]) {
    const S = setup(); const r = await S.put('gm', WK('S1'), v, S.ex(WK('S1'))); assert.equal(r.status, 400, what);
  }
  // 鍵はアプリと同じ
  assert.equal(wnKey({ id: 7 }), '7');
  assert.equal(wnKey(WOLD), wnKey({ ...WOLD }));
  assert.notEqual(wnKey(WOLD), wnKey({ ...WOLD, reason: WOLD.reason + ' ' }));
});

test('tcf_status (the previous-period check before a Tip Rate decision): which stores are confirmed — store IDs only, for Tip Rate deciders or the stores one sees', async () => {
  const S = setup();
  S.W.set(TK('S2'), { '2026-11-01': UNLOCK(), '2026-10-16': CF('2026-10-16') }, T0);
  let r = await S.as('gm', { action: 'tcf_status', stores: ['S1', 'S2', 'S3', 'S9'], from: '2026-11-01' });
  assert.equal(r.status, 200); assert.deepEqual(r.j.confirmed, ['S1']);
  assert.equal(JSON.stringify(r.j).includes('123.45'), false, 'no amounts');
  r = await S.as('am', { action: 'tcf_status', stores: ['S3'], from: '2026-10-16' });   // AM は Tip Rate を決める人（店では分けない）
  assert.deepEqual([r.status, r.j.confirmed], [200, ['S3']]);
  r = await S.as('g3', { action: 'tcf_status', stores: ['S1'], from: '2026-11-01' });   // 決める人でなくても、見られる店なら
  assert.deepEqual([r.status, r.j.confirmed], [200, ['S1']]);
  for (const [who, st] of [['g3', 'S2'], ['g1', 'S1'], ['g4u', 'S1']]) {
    r = await S.as(who, { action: 'tcf_status', stores: [st], from: '2026-11-01' }); assert.equal(r.status, 403, who + ' ' + st);
  }
  for (const b of [{ stores: ['S1'] }, { stores: 'S1', from: '2026-11-01' }, { stores: ['S1'], from: '11/01' }, { stores: Array(31).fill('S1'), from: '2026-11-01' }, { stores: [''], from: '2026-11-01' }]) {
    r = await S.as('gm', { action: 'tcf_status', ...b }); assert.equal(r.status, 400, JSON.stringify(b));
  }
  // 解除の印に状態が残っている記録（解除の印は形を問わない）も、確定とは数えない（アプリの getTipConfirm と同じ）
  S.W.set(TK('S2'), { '2026-11-01': { ...CF('2026-11-01'), _deleted: true } }, T0);
  r = await S.as('gm', { action: 'tcf_status', stores: ['S1', 'S2'], from: '2026-11-01' }); assert.deepEqual(r.j.confirmed, ['S1']);
  // 文字で書いた行（前の版）も
  S.W.set(TK('S1'), JSON.stringify({ '2026-11-16': CF('2026-11-16') }), T0);
  r = await S.as('gm', { action: 'tcf_status', stores: ['S1'], from: '2026-11-16' }); assert.deepEqual(r.j.confirmed, ['S1']);
});

test('unit: tcfCheck / wnCheck', () => {
  const sc = { confirm: true, unlock: false, wnWrite: false };
  assert.equal(tcfCheck('2026', null, { '2026-11-01': CF('2026-11-01') }, sc), 'ok');
  assert.equal(tcfCheck('2026', { '2026-11-01': CF('2026-11-01') }, { '2026-11-01': UNLOCK() }, sc), 'forbidden');
  assert.equal(tcfCheck('2026', { '2026-11-01': CF('2026-11-01') }, { '2026-11-01': UNLOCK() }, { ...sc, unlock: true }), 'ok');
  assert.equal(tcfCheck('2026', { '2026-11-01': CF('2026-11-01') }, { '2026-11-01': CF('2026-11-01'), '2026-11-16': CF('2026-11-16') }, { ...sc, confirm: false }), 'forbidden');
  assert.equal(tcfCheck(null, null, {}, sc), 'bad');
  assert.equal(wnCheck([W1], [W1, WNEW()], { wnWrite: true }), 'ok');
  assert.equal(wnCheck([W1], [W1, WNEW()], { wnWrite: false }), 'forbidden');
  assert.equal(wnCheck([W1], [{ ...W1, _mut: 5 }], { wnWrite: false }), 'ok');
  assert.equal(wnCheck(null, [WNEW()], { wnWrite: true }), 'ok');
  assert.equal(wnCheck(JSON.stringify([W1]), [W1], { wnWrite: false }), 'ok');
  assert.equal(wnCheck([W1], [{ ...W1, reason: 'x' }, W1], { wnWrite: true }), 'forbidden', 'a borrowed id with other content');
  assert.equal(tcfCheck('2026', { '2026-11-01': CF('2026-11-01') }, { '2026-11-01': CF('2026-11-01', { totalFinal: 9 }) }, sc), 'forbidden', 'rewriting a live confirmation needs the unlock right');
  assert.equal(tcfCheck('2026', { '2026-11-01': CF('2026-11-01') }, { '2026-11-01': CF('2026-11-01', { totalFinal: 9 }) }, { ...sc, unlock: true }), 'ok');
  assert.equal(tcfCheck('2026', { '2026-11-01': UNLOCK() }, { '2026-11-01': CF('2026-11-01') }, sc), 'ok', 'confirming again after an unlock');
});
