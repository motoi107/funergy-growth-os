// secure-state v1148（2b の 10 個目・Moto さん 11/10「Career Score と同じ範囲に」）の関数：
// グレード履歴（grade_hist）・賞与の個人設定（bonus_eval_ovr）・G3 の職種（bonus_track）を、読む人ごとに分けて返す。
//   CEO・GM＝全部／経理・事務Crew＝グレード履歴は全部（HR・福利厚生）・ほかの 2 つは Career Score で見られる人と本人／
//   AM・スタッフ＝3 つとも Career Score で見られる人と本人／店のログイン＝なし。書くのは今までどおり GM・CEO だけ。
// 合成データだけ（架空の人と店）。PostgREST・Auth・work-requests は tests/lib/secure-state-world.mjs の偽物。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, GB_KEYS, gbIsKey, gbEntryId, gbProject, gbLevel, ssIsKey, csIsKey, scIsKey, swIsKey } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, JWT } from './lib/secure-state-world.mjs';

const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-CEO', name: 'Cal E', store: 'HQ', role: 'ceo', title: '' },
  { id: 'E-OF', name: 'Ofelia', store: 'HQ', role: 'office', title: 'Accountant' },
  { id: 'E-OC', name: 'Oscar', store: 'HQ', role: 'office_crew', title: 'Office Crew' },
  { id: 'E-AM', name: 'Amy Area', store: 'S1', role: 'am', title: 'Area Manager' },
  { id: 'E-4', name: 'Leo Four', store: 'S1', role: 'g4', title: 'Store Manager' },
  { id: 'E-4U', name: 'Uma Four', store: 'S1', role: 'g4', title: 'Store Manager' },        // GM・CEO の確かめがまだ（写しが無い）
  { id: 'E-3', name: 'Sal Three', store: 'S1', role: 'sl', title: 'Store Leader' },
  { id: 'E-2', name: 'Ria Two', store: 'S1', role: 'g2', title: 'Crew Leader' },
  { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew' },
  { id: 'E-1B', name: 'Bo One', store: 'S2', role: 'crew', title: 'Crew' },
  { id: 'E-1D', name: 'Dot One', store: 'S1', role: 'crew', title: 'Crew' },                // 同じ名前の人が S2 にいる（その名前はだれにも分けない＝Career Score と同じ）
  { id: 'E-1E', name: 'Dot One', store: 'S2', role: 'crew', title: 'Crew' },
  { id: 'E-CH', name: 'Chef Ken', store: 'S1', role: 'chef', title: 'Head Chef' },
  { id: 'E-OUT', name: 'Gone Lead', store: 'S1', role: 'sl', title: 'Store Leader', status: '退職' },
];
const WRP = [
  { emp_id: 'E-CH', role: 'staff', grade: 4, chef: true, stores: ['S1'] },
  { emp_id: 'E-4', role: 'staff', grade: 4, stores: ['S1'] }, { emp_id: 'E-3', role: 'staff', grade: 3, stores: ['S1'] },
  { emp_id: 'E-2', role: 'staff', grade: 2, stores: ['S1'] },
  { emp_id: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1', 'S2'] },
];
const U = n => 'aaaaaaaa-0000-0000-0000-00000000000' + n;
const MGR = { [U(1)]: { role: 'gm', emp_id: 'E-GM' }, [U(2)]: { role: 'office', emp_id: 'E-OF' }, [U(3)]: { role: 'office', emp_id: null }, [U(5)]: { role: 'ceo', emp_id: 'E-CEO' } };
const USERS = { gm: U(1), of: U(2), ofx: U(3), ceo: U(5) };
const ME = {
  gm: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M', confirmed: true },
  ceo: { emp: 'E-CEO', role: 'ceo', grade: 7, stores: [], am_stores: [], name: 'Cal E', confirmed: true },
  of: { emp: 'E-OF', role: 'office', grade: 4, stores: [], am_stores: [], name: 'Ofelia', confirmed: true },
  oc: { emp: 'E-OC', role: 'office_crew', grade: 1, stores: [], am_stores: [], name: 'Oscar', confirmed: true },
  am: { emp: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1', 'S2'], name: 'Amy Area', confirmed: true },
  g4: { emp: 'E-4', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Leo Four', confirmed: true },
  g4u: { emp: 'E-4U', role: 'staff', grade: 3, stores: ['S1'], am_stores: [], name: 'Uma Four', confirmed: false },
  g3: { emp: 'E-3', role: 'staff', grade: 3, stores: ['S1'], am_stores: [], name: 'Sal Three', confirmed: true },
  g2: { emp: 'E-2', role: 'staff', grade: 2, stores: ['S1'], am_stores: [], name: 'Ria Two', confirmed: true },
  g1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One', confirmed: false },
  chef: { emp: 'E-CH', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Chef Ken', confirmed: true },
  out: { emp: 'E-OUT', role: 'staff', grade: 3, stores: ['S1'], am_stores: [], name: 'Gone Lead', confirmed: true },
  dup: { emp: 'E-1D', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Dot One', confirmed: false },   // 同じ名前の人がいる（Career Score では本人にも届かない）
  odd: { emp: 'E-1', role: 'kiosk', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One', confirmed: false },  // 知らない役割（whoami が返さないはずの役割）
  store: 'deny',
};
const T0 = '2026-11-09T09:00:00.000000+00:00';
const REC = (id, g = 'G1') => ({ recs: [{ id: 'r-' + id, d: '2026-04-01', g, from: '', start: true, src: 'hire', by: 'Gina M', at: '2026/04/01 10:00', note: '' }], name: id, _at: 1762500000000 });
const ALL_IDS = ['E-GM', 'E-CEO', 'E-OF', 'E-OC', 'E-AM', 'E-4', 'E-4U', 'E-3', 'E-2', 'E-1', 'E-1B', 'E-1D', 'E-1E', 'E-CH', 'E-OUT'];
const GH = { ...Object.fromEntries(ALL_IDS.map(id => [id, REC(id)])), 'E-ZZ': REC('E-ZZ') };   // E-ZZ：社員の表に無い人（全部を読む人だけ）
const OV = (n = 1) => ({ set: { c: { b8: 1, bp8: 250 + n } }, at: '2026-11-03 09:00', by: 'Gina M', _at: 1762500000000 + n, _t: { c: 1762500000000 + n } });
const OVR = { ...Object.fromEntries(ALL_IDS.map((id, i) => [id + '|2026-Q3', OV(i)])), 'E-4|2026-Q4': OV(40), 'nobar': OV(41), '|2026-Q3': OV(42) };
const TRK = { ...Object.fromEntries(ALL_IDS.map(id => ['2026-Q3|' + id, { t: 'op', at: '2026/11/01', by: 'Gina M', _at: 1762500000000 }])), '2026-Q4|E-3': { t: 'sv', _at: 1762500000001 }, 'bad': { t: 'kt', _at: 1 }, '2026-Q3|': { t: 'op', _at: 1 } };
const V = { grade_hist: GH, bonus_eval_ovr: OVR, bonus_track: TRK };

function setup(o = {}) {
  const W = makeWorld({ emps: EMPS.map(e => ({ ...e })), mgr: MGR, users: USERS, wrPeople: WRP.map(x => ({ ...x })),
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
  for (const k of GB_KEYS) W.set(k, V[k], T0);
  W.set('tasks_all', { a: 1 }, T0);
  W.set('growth_karte', { 'E-1': { hireDate: '2024-01-01' } }, T0);
  W.set('lss_emp_Kai One', { scores: { A1: 2 } }, T0);
  const pull = (who, have = {}, extra = {}) => as(who, { action: 'pull', have: {}, cs_have: {}, gb_have: have, ...extra });
  return { W, call, as, pull };
}
const writes = (W, key) => W.log.filter(x => x[0] === 'write' && x[2] === key).map(x => x[1]);
const pick = (key, ids) => Object.fromEntries(Object.entries(V[key]).filter(([k]) => ids.includes(gbEntryId(key, k))));
const rowOf = (r, key) => (r.j.gb.rows || []).find(x => x.key === key);

// 見られる人（Career Score と同じ。名前で分けるので、同じ名前の人がいるとその名前はだれにも分けない＝E-1D）
const SCOPE = {
  am: ['E-AM', 'E-4', 'E-4U', 'E-3', 'E-2', 'E-1', 'E-1B', 'E-CH'],      // 担当の店 S1・S2 の人（AM・CEO・GM・経理の人は除く）。Dot One は 2 人とも担当の店だが、名前を渡すので E-1D・E-1E も入る
  g4: ['E-4', 'E-4U', 'E-3', 'E-2', 'E-1', 'E-CH'],                       // 自分の店（確かめた写しの S1）の G4 以下
  g4u: ['E-4U'],                                                          // 確かめがまだ：自分だけ
  g3: ['E-3', 'E-2', 'E-1'],                                              // 自分の店の G1・G2
  g2: ['E-2', 'E-1'],                                                     // 自分の店の G1
  g1: ['E-1'],                                                            // 自分だけ
  chef: ['E-CH', 'E-4', 'E-4U', 'E-3', 'E-2', 'E-1', 'E-1B'],             // Head Chef（GM・CEO が確かめた）：全店の人（本部の事務の人・CEO・GM・経理・確かめた AM は除く）
  of: ['E-OF', 'E-OC', 'E-CH'],                                           // 経理：本部の人（Office管理のメンバー）
  oc: ['E-OC', 'E-OF', 'E-CH'],
};
SCOPE.am.push('E-1D', 'E-1E'); SCOPE.chef.push('E-1D', 'E-1E');
for (const k of Object.keys(SCOPE)) SCOPE[k].sort();

test('the keys and the record ids (the same shapes the app writes: grade_hist <emp>, bonus_eval_ovr <emp>|<quarter>, bonus_track <quarter>|<emp>)', () => {
  assert.deepEqual(GB_KEYS, ['grade_hist', 'bonus_eval_ovr', 'bonus_track']);
  for (const k of GB_KEYS) { assert.equal(gbIsKey(k), true, k); assert.equal(swIsKey(k), true, k + ' is still written only through swPut (GM/CEO)'); }
  for (const k of ['grade_hist ', 'Grade_hist', 'bonus_eval', 'bonus_eval_rule', 'bonus_q', 'cs_guide', 'tip_cf_S1_2026', null, 1]) assert.equal(gbIsKey(k), false, String(k));
  for (const k of GB_KEYS) assert.ok(!ssIsKey(k) && !csIsKey(k) && !scIsKey(k), k + ' is no other family');
  assert.equal(gbEntryId('grade_hist', 'E-1'), 'E-1');
  assert.equal(gbEntryId('bonus_eval_ovr', 'E-1|2026-Q3'), 'E-1'); assert.equal(gbEntryId('bonus_eval_ovr', 'nobar'), null); assert.equal(gbEntryId('bonus_eval_ovr', '|2026-Q3'), null);
  assert.equal(gbEntryId('bonus_track', '2026-Q3|E-1'), 'E-1'); assert.equal(gbEntryId('bonus_track', 'bad'), null); assert.equal(gbEntryId('bonus_track', '2026-Q3|'), null);
  assert.equal(gbEntryId('grade_hist', ''), null); assert.equal(gbEntryId('cs_guide', 'E-1'), null);
  // 社員 ID に | があっても、アプリが書く形（kevVer の「社員ID|」で始まるキー・btrKey の「四半期|社員ID」）と同じ ID（四半期には | が無い）
  assert.equal(gbEntryId('bonus_eval_ovr', 'E|X|2026-Q3'), 'E|X'); assert.equal(gbEntryId('bonus_track', '2026-Q3|E|X'), 'E|X');
  const ids = new Set(['E-1']);
  assert.deepEqual(gbProject('bonus_eval_ovr', OVR, ids), { 'E-1|2026-Q3': OVR['E-1|2026-Q3'] });
  assert.deepEqual(gbProject('grade_hist', JSON.stringify(GH), ids), { 'E-1': GH['E-1'] }, 'a value an old version wrote as JSON text');
  for (const v of [null, [], 'x', 5, [GH]]) assert.deepEqual(gbProject('grade_hist', v, ids), {}, JSON.stringify(v));
  assert.deepEqual(gbProject('grade_hist', GH, null), {});
  assert.equal(gbLevel({ all: ['grade_hist'], ids: new Set() }, 'grade_hist'), 'all');
  assert.equal(gbLevel({ all: ['grade_hist'], ids: new Set() }, 'bonus_track'), 'scoped');
  assert.equal(gbLevel({ all: [], ids: null }, 'bonus_track'), 'none');
  assert.equal(gbLevel({ all: GB_KEYS, ids: null }, 'cs_guide'), 'none');
});

test('pull with gb_have: CEO/GM get all three whole; Accounting and Office Crew get the whole grade history (HR benefits) and only their Career Score range for the other two', async () => {
  const S = setup();
  for (const who of ['gm', 'ceo', '@gm', '@ceo']) {
    const r = await S.pull(who);
    assert.equal(r.status, 200, who); assert.equal(r.j.gbfn, 1);
    assert.deepEqual(r.j.gb.keys, { grade_hist: 'all', bonus_eval_ovr: 'all', bonus_track: 'all' }, who);
    for (const k of GB_KEYS) assert.deepEqual(rowOf(r, k).value, V[k], who + ' ' + k);
  }
  for (const who of ['of', 'oc', '@of']) {
    const r = await S.pull(who), sc = SCOPE[who.replace('@', '')];
    assert.deepEqual(r.j.gb.keys, { grade_hist: 'all', bonus_eval_ovr: 'scoped', bonus_track: 'scoped' }, who);
    assert.deepEqual(rowOf(r, 'grade_hist').value, GH, who + ': the whole grade history (the HR benefit screen shows everyone)');
    assert.deepEqual(rowOf(r, 'bonus_eval_ovr').value, pick('bonus_eval_ovr', sc), who);
    assert.deepEqual(rowOf(r, 'bonus_track').value, pick('bonus_track', sc), who);
  }
  // 社員と結ばれていない経理のメールのアカウント：グレード履歴は全部（HR）・ほかの 2 つは本部の人（本人の分は無い）
  const x = await S.pull('@ofx');
  assert.deepEqual(x.j.gb.keys, { grade_hist: 'all', bonus_eval_ovr: 'scoped', bonus_track: 'scoped' });
  assert.deepEqual(rowOf(x, 'bonus_track').value, pick('bonus_track', ['E-OF', 'E-OC', 'E-CH']));
});

test('pull with gb_have: AM, G4, G3, Crew Leader, crew and Head Chef get only the records of the people they see in Career Score, and their own', async () => {
  const S = setup();
  for (const who of ['am', 'g4', 'g4u', 'g3', 'g2', 'g1', 'chef']) {
    const r = await S.pull(who);
    assert.equal(r.status, 200, who);
    assert.deepEqual(r.j.gb.keys, { grade_hist: 'scoped', bonus_eval_ovr: 'scoped', bonus_track: 'scoped' }, who);
    for (const k of GB_KEYS) assert.deepEqual(rowOf(r, k).value, pick(k, SCOPE[who]), who + ' ' + k);
    // Career Score と同じ範囲：見られる人の名前（cs.names）と自分
    const names = new Set(r.j.cs.names), ids = SCOPE[who];
    for (const id of ids) assert.ok(names.has(EMPS.find(e => e.id === id).name), who + ' ' + id + ' is in the Career Score range');
    for (const e of EMPS) if (names.has(e.name) && !e.status) assert.ok(ids.includes(e.id), who + ' ' + e.id + ' (in Career Score) is also here');
    // 記録のキーが読めない記録（nobar・bad など）と社員の表に無い人（E-ZZ）は、全部を読む人にしか行かない
    assert.ok(!('nobar' in rowOf(r, 'bonus_eval_ovr').value) && !('bad' in rowOf(r, 'bonus_track').value) && !('E-ZZ' in rowOf(r, 'grade_hist').value), who);
  }
  // 同じ名前の人（Dot One・S1 と S2）：S1 だけを見る G4 には、どちらも分けない（Career Score と同じ）
  const g4 = await S.pull('g4');
  assert.ok(!('E-1D' in rowOf(g4, 'grade_hist').value) && !('E-1E' in rowOf(g4, 'grade_hist').value));
  // 退職した人（PIN の印を 60 秒覚えているあいだに退職）：本人の分も含めて何も（Career Score と同じ：在籍の社員の行が無い人は本人でない）
  const out = await S.pull('out');
  assert.equal(out.status, 200);
  for (const k of GB_KEYS) assert.deepEqual(rowOf(out, k).value, {}, 'a retired person ' + k);
  // 店のログイン（店舗の PIN）：断る
  assert.equal((await S.pull('store')).status, 401, 'the store PIN');
});

test('pull: an app before v1148 (no gb_have) gets no gb part; the karte (v1139), Career Score (v1140) and the index do not carry the three', async () => {
  const S = setup();
  for (const who of ['gm', 'am', 'g1']) {
    const r = await S.as(who, { action: 'pull', have: {}, cs_have: {} });
    assert.equal(r.status, 200, who); assert.equal(r.j.gb, undefined, who);
    assert.ok(!(r.j.rows || []).some(x => GB_KEYS.includes(x.key)) && !(r.j.index || []).some(x => GB_KEYS.includes(x.key)), who);
    assert.ok(!(r.j.cs.rows || []).some(x => GB_KEYS.includes(x.key)), who);
  }
});

test('versions: an unchanged row and the same people are not sent again; a change in the row or in the people sent again; all and scoped never share a version', async () => {
  for (const indexMissing of [false, true]) {
    const S = setup({ indexMissing });
    const first = await S.pull('am');
    const have = Object.fromEntries(first.j.gb.index.map(x => [x.key, x.v]));
    assert.deepEqual(first.j.gb.index.map(x => x.key).sort(), [...GB_KEYS].sort());
    for (const x of first.j.gb.index) assert.match(x.v, /^g:[0-9a-f]{64}$/, 'scoped versions are g:<hash>');
    const again = await S.pull('am', have);
    assert.deepEqual(again.j.gb.rows, [], indexMissing + ': nothing new');
    assert.deepEqual(again.j.gb.index, first.j.gb.index);
    // 担当の店に人が入る（Career Score の範囲が変わる）：3 つとも送り直す（元の行は同じでも）
    S.W.emps.push({ id: 'E-1N', name: 'New One', store: 'S2', role: 'crew', title: 'Crew' });
    const moved = await S.pull('am', have);
    assert.deepEqual(moved.j.gb.rows.map(x => x.key).sort(), [...GB_KEYS].sort(), indexMissing + ': the people changed');
    // 元の行が変わる：そのキーだけ
    const have2 = Object.fromEntries(moved.j.gb.index.map(x => [x.key, x.v]));
    S.W.set('bonus_track', { ...TRK, '2026-Q4|E-1': { t: 'sv', _at: 1762800000000 } }, '2026-11-10T09:00:00.000000+00:00');
    const changed = await S.pull('am', have2);
    assert.deepEqual(changed.j.gb.rows.map(x => x.key), ['bonus_track'], indexMissing);
    assert.deepEqual(changed.j.gb.rows[0].value['2026-Q4|E-1'], { t: 'sv', _at: 1762800000000 });
    // GM：元の行の印（全部）。AM の印とは違う
    const gm = await S.pull('gm');
    for (const x of gm.j.gb.index) { assert.doesNotMatch(x.v, /^g:/, 'all: the row version'); assert.notEqual(x.v, have2[x.key]); }
    // クラウドに行が無いキー：一覧にも行にも出ない
    S.W.rows.delete('grade_hist');
    const none = await S.pull('am');
    assert.ok(!none.j.gb.index.some(x => x.key === 'grade_hist') && !none.j.gb.rows.some(x => x.key === 'grade_hist'), indexMissing + ': no row');
  }
});

test('pull: when the people cannot be decided (the employee table cannot be read) the gb part is an error (the device keeps its copy); CEO/GM still get all', async () => {
  const S = setup();
  S.W.empsDown = true;
  const r = await S.pull('am');
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.gb, { error: 'scope' });
  const gm = await S.pull('gm');
  assert.deepEqual(gm.j.gb.keys, { grade_hist: 'all', bonus_eval_ovr: 'all', bonus_track: 'all' });
  assert.deepEqual(rowOf(gm, 'grade_hist').value, GH);
});

test('get: CEO/GM read the whole row; the others read only their range (proj); the store login and those who see none are refused', async () => {
  const S = setup();
  for (const k of GB_KEYS) {
    const g = await S.as('gm', { action: 'get', key: k });
    assert.equal(g.status, 200, k); assert.deepEqual(g.j.value, V[k]); assert.equal(g.j.proj, undefined); assert.equal(g.j.updated_at, T0);
    for (const who of ['am', 'g4', 'g1', 'chef']) {
      const r = await S.as(who, { action: 'get', key: k });
      assert.equal(r.status, 200, who + ' ' + k); assert.deepEqual(r.j.value, pick(k, SCOPE[who]), who + ' ' + k); assert.equal(r.j.proj, true);
    }
    const of = await S.as('of', { action: 'get', key: k });
    assert.deepEqual(of.j.value, k === 'grade_hist' ? GH : pick(k, SCOPE.of), 'Accounting ' + k);
    assert.equal((await S.as('store', { action: 'get', key: k })).status, 401);
  }
  S.W.rows.delete('bonus_track');
  assert.deepEqual((await S.as('am', { action: 'get', key: 'bonus_track' })).j, { exists: false, value: null, updated_at: null, fn: 1, csfn: 1, swfn: 1, hrfn: 1, sw2: 1, piifn: 1, ghfn: 1, tpfn: 1, scfn: 1, gbfn: 1, clfn: 1 });
});

test('put: writing is still GM/CEO only (v1143 / v1145); those who do not read it all are refused even with the same value (no guessing); Accounting\'s same grade history still passes', async () => {
  const S = setup();
  // GM：書ける（今までどおり）
  const next = { ...GH, 'E-9': REC('E-9', 'G2') };
  const w = await S.as('gm', { action: 'put', key: 'grade_hist', value: next, expect: { exists: true, updated_at: T0 } });
  assert.equal(w.status, 200); assert.deepEqual(S.W.get('grade_hist'), next); assert.deepEqual(writes(S.W, 'grade_hist'), ['service']);
  S.W.set('grade_hist', GH, T0);
  // 全部を読めない人：同じ値（全部）でも、見られる分だけでも 403（どちらも書かない）
  for (const who of ['am', 'g4', 'g1', 'chef']) for (const k of GB_KEYS) {
    for (const value of [V[k], pick(k, SCOPE[who])]) {
      const r = await S.as(who, { action: 'put', key: k, value });
      assert.equal(r.status, 403, who + ' ' + k); assert.equal(r.j.error, 'forbidden');
    }
  }
  for (const k of ['bonus_eval_ovr', 'bonus_track']) assert.equal((await S.as('of', { action: 'put', key: k, value: V[k] })).status, 403, 'Accounting ' + k);
  // 経理：グレード履歴は全部を読むので、同じ値は今までどおり書かずに通す（違えば 403）
  const same = await S.as('of', { action: 'put', key: 'grade_hist', value: GH });
  assert.equal(same.status, 200); assert.equal(same.j.same, true);
  assert.equal((await S.as('of', { action: 'put', key: 'grade_hist', value: next })).status, 403);
  assert.deepEqual(S.W.get('grade_hist'), GH); assert.deepEqual(writes(S.W, 'grade_hist'), ['service'], 'only the GM write');
  for (const k of ['bonus_eval_ovr', 'bonus_track']) assert.deepEqual(writes(S.W, k), [], k);
});

test('the other secure keys are not touched: Career Score, karte and the Tip confirmation pulls are the same with and without gb_have', async () => {
  const S = setup();
  for (const who of ['gm', 'am', 'g4', 'g1']) {
    const a = await S.as(who, { action: 'pull', have: {}, cs_have: {}, sc_have: {} });
    const b = await S.as(who, { action: 'pull', have: {}, cs_have: {}, sc_have: {}, gb_have: {} });
    for (const part of ['level', 'index', 'rows', 'cs', 'sc']) assert.deepEqual(b.j[part], a.j[part], who + ' ' + part);
  }
});

test('own records by the verified employee ID even when the name is shared (Career Score does not give the shared name); an unknown role gets none', async () => {
  const S = setup();
  // 同じ名前の人（Dot One・E-1D と E-1E）：本人（E-1D）の記録は社員 ID で届く。同じ名前のほかの人（E-1E）の記録は届かない
  const d = await S.pull('dup');
  assert.equal(d.status, 200);
  assert.ok(!d.j.cs.names.includes('Dot One'), 'Career Score keeps the shared name from everyone (v1140)');
  assert.deepEqual(d.j.gb.keys, { grade_hist: 'scoped', bonus_eval_ovr: 'scoped', bonus_track: 'scoped' });
  for (const k of GB_KEYS) assert.deepEqual(rowOf(d, k).value, pick(k, ['E-1D']), 'own records only ' + k);
  for (const k of GB_KEYS) {
    const g = await S.as('dup', { action: 'get', key: k });
    assert.equal(g.status, 200); assert.deepEqual(g.j.value, pick(k, ['E-1D']), 'get: own records only ' + k);
  }
  // 知らない役割（店のログインのような役割が来たとき）：3 つとも受け取らない・get も 403
  const o = await S.pull('odd');
  assert.equal(o.status, 200);
  assert.deepEqual(o.j.gb, { keys: { grade_hist: 'none', bonus_eval_ovr: 'none', bonus_track: 'none' }, index: [], rows: [] });
  for (const k of GB_KEYS) {
    const g = await S.as('odd', { action: 'get', key: k });
    assert.equal(g.status, 403, k); assert.equal(g.j.error, 'forbidden');
  }
});
