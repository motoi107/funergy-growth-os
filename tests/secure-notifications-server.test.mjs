// v1152（段階 2b の最後）：通知（notifications）を関数 secure-state の nt で。合成データだけ（本番に接続していない）。
// 見られるのは宛先の分（画面の notifForMe と同じ決まり）と自分が出した分だけ。書くのは足す・自分の既読と確認の印だけ。
// 店舗の PIN のタブレット・PIN が初期の人は足すだけ（Moto さん 11/12：店のタブレットには通知を出さない）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, ntClean, ntVisible, NT_MAX, NT_STAFF_NEED, NT_ALL_ROLES } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, JWT } from './lib/secure-state-world.mjs';

function setup(o = {}) {
  const W = makeWorld(o);
  let clock = Date.UTC(2026, 10, 13, 10, 0, 0);
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  const handle = createHandler({ env, fetch: W.fetch, now: () => clock });
  const call = async (body, hdr = {}) => {
    const r = await handle(new Request('https://fn.test/secure-state', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ANON, ...hdr }, body: JSON.stringify(body) }));
    let j = null; try { j = await r.json(); } catch { j = null; }
    return { status: r.status, j };
  };
  return { W, call, now: () => clock, tick: ms => { clock += ms; } };
}
const iso = (m = 0) => new Date(Date.UTC(2026, 10, 13, 9, m, 0)).toISOString();
const GM = { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina' };
const AM = { emp: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S2'], name: 'Area' };
const SL = { emp: 'E-SL', role: 'staff', grade: 3, stores: ['S1', 'S3'], am_stores: [], name: 'Sally', confirmed: true };
const SLX = { emp: 'E-SLX', role: 'staff', grade: 3, stores: ['S1'], am_stores: [], name: 'Sam (unconfirmed)', confirmed: false };
const SM = { emp: 'E-SM', role: 'staff', grade: 4, stores: ['S2'], am_stores: [], name: 'Store Mgr', confirmed: true };
const CREW = { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Crew 1' };
const CHEF = { emp: 'E-CH', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Chef', confirmed: true };
const OF = { emp: 'E-OF', role: 'office', grade: 0, stores: [], am_stores: [], name: 'Office' };
const emps = [
  { id: 'E-SL', name: 'Sally', role: 'sl', title: 'Store Leader', store: 'S1' },
  { id: 'E-SLX', name: 'Sam (unconfirmed)', role: 'sl', title: 'Store Leader', store: 'S1' },
  { id: 'E-SM', name: 'Store Mgr', role: 'sl', title: 'Store Manager', store: 'S2' },
  { id: 'E-1', name: 'Crew 1', role: 'crew', title: 'Crew', store: 'S1' },
  { id: 'E-CH', name: 'Chef', role: 'chef', title: 'Head Chef', store: 'S1' },
];
const wrPeople = [
  { emp_id: 'E-SL', role: 'staff', grade: 3, stores: ['S1'] },          // S3 は社員の表だけ（確かめていない）
  { emp_id: 'E-SM', role: 'staff', grade: 4, stores: ['S2'] },
  { emp_id: 'E-CH', role: 'staff', grade: 4, stores: ['S1'], chef: true },
];
const pins = { tGM: GM, tAM: AM, tSL: SL, tSLX: SLX, tSM: SM, t1: CREW, tCH: CHEF, tOF: OF, tStore: 'deny' };
const N = (id, o) => ({ id, at: iso(1), by: 'X', readBy: [], ackBy: [], type: 't', title: 'T ' + id, ...o });
const SEED = [
  N('u-crew', { toUser: 'Crew 1', title: '特別育成に指名されました' }),
  N('u-gina', { toUser: 'Gina' }),
  N('st1-sl', { toStore: 'S1', toRoles: ['sl', 'am', 'gm'], title: '退職手続き開始：〇〇', text: '理由 …' }),
  N('st3-sl', { toStore: 'S3', toRoles: ['sl'] }),
  N('st2-sm', { toStore: 'S2', toRoles: ['sm'] }),
  N('st1-crew', { toStore: 'S1', toRoles: ['crew', 'sl'] }),
  N('st1-all', { toStore: 'S1' }),
  N('r-office', { toRoles: ['office', 'office_crew'] }),
  N('r-chef', { toRoles: ['chef'] }),
  N('r-gm', { toRoles: ['gm'] }),
  N('nobody', {}),
  N('by-sally', { by: 'Sally', toUser: 'Someone' }),
];
const ids = j => (j.items || []).map(n => n.id).sort();

test('each person gets only the notifications addressed to them (the same rule as the app’s notifForMe) and the ones they sent', async () => {
  const S = setup({ pins, emps, wrPeople });
  S.W.set('notifications', SEED);
  const see = async t => { const r = await S.call({ action: 'nt', pin_session: t }); assert.equal(r.status, 200, t); assert.equal(r.j.ntfn, 1); assert.equal(r.j.level, 'fn'); return ids(r.j); };
  assert.deepEqual(await see('tGM'), ['r-gm', 'st1-all', 'st1-sl', 'u-gina'].sort(), 'GM：全店・gm あて・自分あて');
  assert.deepEqual(await see('tAM'), ['st1-all', 'st1-sl'].sort(), 'AM：担当の店と自分の店で am あて');
  assert.deepEqual(await see('tSL'), ['by-sally', 'st1-all', 'st1-crew', 'st1-sl'].sort(), '確かめた SL：確かめた店（S1）だけで sl あて。社員の表だけの店（S3）は出ない。自分が出した分も');
  assert.deepEqual(await see('tSLX'), ['st1-all', 'st1-crew'].sort(), '確かめがまだの SL：crew あてだけ（sl あての退職の知らせは出ない）');
  assert.deepEqual(await see('tSM'), ['st2-sm'], 'Store Manager の肩書き：sm あて');
  assert.deepEqual(await see('t1'), ['st1-all', 'st1-crew', 'u-crew'].sort(), 'crew：自分の店の crew あてと自分あて');
  assert.deepEqual(await see('tCH'), ['r-chef', 'st1-all'], 'GM・CEO が確かめた Head Chef：chef あて（crew・sl あては画面と同じく出ない）');
  assert.deepEqual(await see('tOF'), ['r-office', 'st1-all'].sort(), '経理：全店・office あて');
  // 確かめた写しに Head Chef の印が無い（社員の表だけ Head Chef）：chef あては出ない
  const S2 = setup({ pins, emps, wrPeople: wrPeople.map(w => (w.emp_id === 'E-CH' ? { ...w, chef: false } : w)) });
  S2.W.set('notifications', SEED);
  assert.ok(!ids((await S2.call({ action: 'nt', pin_session: 'tCH' })).j).includes('r-chef'));
  // 確かめた写しが読めない（列が無い・表が無い）：crew と同じ（狭いほう）
  const S3 = setup({ pins, emps, wrPeople });
  S3.W.wrPeopleDown = true; S3.W.set('notifications', SEED);
  assert.deepEqual(ids((await S3.call({ action: 'nt', pin_session: 'tSL' })).j), ['by-sally', 'st1-all', 'st1-crew'].sort());
  assert.deepEqual(NT_STAFF_NEED, { g2: 2, sl: 3, g4: 4, chef: 4 });
  assert.deepEqual(NT_ALL_ROLES, ['ceo', 'gm', 'office', 'office_crew']);
});

test('ntVisible matches the app’s notifForMe for the same person (random notifications)', () => {
  // アプリの notifForMe（自分が出した分を出さない・自分の店・応援・担当の店・全店の役割）と、サーバーの ntVisible（自分が出した分も返す）を比べる
  const app = (n, me) => {
    if (n.by && me.name && n.by === me.name) return false;
    if (n.toUser) return !!(me.name && n.toUser === me.name);
    const roleMatch = r => !!(r && r.length) && (r.includes(me.role) || (r.includes('sm') && me.sm));
    if (n.toStore) { const inStore = me.all || me.stores.has(n.toStore); if (!inStore) return false; if (n.toRoles && n.toRoles.length) return roleMatch(n.toRoles); return true; }
    if (n.toRoles && n.toRoles.length) return roleMatch(n.toRoles);
    return false;
  };
  let seed = 7; const rnd = k => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
  const roles = ['ceo', 'gm', 'office', 'office_crew', 'am', 'sl', 'sm', 'g2', 'g4', 'chef', 'crew'];
  const names = ['A', 'B', 'C', ''];
  for (let i = 0; i < 4000; i++) {
    const n = { by: names[rnd(4)] };
    if (rnd(3) === 0) n.toUser = names[rnd(3)];
    if (rnd(2)) n.toStore = 'S' + rnd(3);
    if (rnd(2)) n.toRoles = roles.filter(() => rnd(4) === 0);
    const r = roles[rnd(roles.length)];
    const me = { name: names[rnd(4)], role: r === 'sm' ? 'sl' : r, all: NT_ALL_ROLES.includes(r), stores: new Set(['S' + rnd(3)]), sm: r === 'sm' };
    const own = !!(n.by && me.name && n.by === me.name);
    assert.equal(ntVisible(n, me), own || app(n, me), JSON.stringify([n, { ...me, stores: [...me.stores] }]));
  }
});

test('adding: the sender is the person the function checked; same id is not added twice; system notices keep one per refId; shapes are checked', async () => {
  const S = setup({ pins, emps, wrPeople });
  S.W.set('notifications', [N('old', { toRoles: ['gm'] }), N('sys1', { by: 'システム', refId: 'shiftremind_S1_11/16', toStore: 'S1', toRoles: ['sl', 'am', 'gm'] })]);
  const r = await S.call({ action: 'nt', pin_session: 'tSL', add: [
    { id: 'ntf1', at: iso(5), by: 'Somebody Else', type: 'shift', title: 'シフト変更', toStore: 'S1', toRoles: ['am'], readBy: ['Gina'], ackBy: ['Gina'], _s: 1, rbFocus: { ym: '2026-11', status: 'rejected' } },
    { id: 'old', title: 'dup' },
    { id: 'ntf2', by: 'システム', refId: 'shiftremind_S1_11/16', title: '来週のシフト未作成', toStore: 'S1', toRoles: ['sl'] },
    { id: 'ntf3', by: 'システム', refId: 'tipchg_x', title: 'Tip', toRoles: ['gm'], at: '2030-01-01T00:00:00.000Z' },
    { id: 'bad id!', title: 'x' },
    { id: 'ntf4', title: { html: 1 }, toRoles: ['gm'] },
    { id: 'ntf5', toRoles: ['GM'] },
  ] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.done, ['ntf1', 'old', 'ntf2', 'ntf3', 'bad id!', 'ntf4', 'ntf5'], 'every item with an id is settled, even a bad one (the app drops it from what it still has to send; it can never be added)');
  assert.equal(r.j.bad, 3);
  const cloud = S.W.get('notifications');
  assert.deepEqual(cloud.map(n => n.id), ['old', 'sys1', 'ntf1', 'ntf3'], 'the system notice with the same refId is not added again; the bad ones are not added');
  const a1 = cloud.find(n => n.id === 'ntf1');
  assert.equal(a1.by, 'Sally', 'the sender is the person the function checked (not what the app said)');
  assert.deepEqual([a1.readBy, a1.ackBy, a1._s], [[], [], undefined], 'marks and _ fields are the server’s');
  assert.deepEqual(a1.rbFocus, { ym: '2026-11', status: 'rejected' });
  const a3 = cloud.find(n => n.id === 'ntf3');
  assert.equal(a3.by, 'システム');
  assert.equal(a3.at, new Date(S.now()).toISOString(), 'a time in the future (clock ahead) becomes now');
  assert.equal(cloud.find(n => n.id === 'old').title, 'T old', 'an existing notification is not changed');
  assert.ok(r.j.items.some(n => n.id === 'ntf1'), 'the answer has what was added (sent by me)');
  assert.ok(!r.j.items.some(n => n.id === 'ntf3'), 'a system notice to GM is not shown to the SL who made it');
  // 21 件は断る（何も書かない）
  const before = S.W.calls.patch;
  assert.equal((await S.call({ action: 'nt', pin_session: 'tSL', add: Array.from({ length: 21 }, (_, i) => ({ id: 'x' + i })) })).status, 400);
  assert.equal(S.W.calls.patch, before);
  // そのまま（何も変わらない）なら書かない
  assert.equal((await S.call({ action: 'nt', pin_session: 'tSL', add: [{ id: 'old' }], read: ['nope'] })).status, 200);
  assert.equal(S.W.calls.patch, before, 'nothing changed: no write');
});

test('read / ack marks: only my own name, only on notifications I can see', async () => {
  const S = setup({ pins, emps, wrPeople });
  S.W.set('notifications', SEED.map(n => (n.id === 'st1-sl' ? { ...n, readBy: ['Gina'] } : n)));
  const r = await S.call({ action: 'nt', pin_session: 'tSL', read: ['st1-sl', 'r-gm', 'u-crew'], ack: ['st1-crew'] });
  assert.equal(r.status, 200);
  const c = Object.fromEntries(S.W.get('notifications').map(n => [n.id, n]));
  assert.deepEqual(c['st1-sl'].readBy, ['Gina', 'Sally'], 'my name is added; the others stay');
  assert.deepEqual(c['r-gm'].readBy, [], 'a notification I cannot see gets no mark');
  assert.deepEqual(c['u-crew'].readBy, []);
  assert.deepEqual([c['st1-crew'].ackBy, c['st1-crew'].readBy], [['Sally'], ['Sally']], 'confirm also marks read');
  // 同じ印をもう一度：書かない
  const p = S.W.calls.patch;
  await S.call({ action: 'nt', pin_session: 'tSL', read: ['st1-sl'], ack: ['st1-crew'] });
  assert.equal(S.W.calls.patch, p);
  // 形の合わない id は断る
  assert.equal((await S.call({ action: 'nt', pin_session: 'tSL', read: ['a b'] })).status, 400);
  assert.equal((await S.call({ action: 'nt', pin_session: 'tSL', read: [1] })).status, 400);
});

test('the store tablet (store PIN) and people without a PIN mark can only add; they cannot read or mark', async () => {
  const S = setup({ pins, emps, wrPeople });
  S.W.set('notifications', SEED);
  const g = await S.call({ action: 'nt', pin_session: 'tStore' });
  assert.equal(g.status, 401, 'reading is refused');
  assert.equal((await S.call({ action: 'nt', pin_session: 'tStore', add: [{ id: 'a1' }], read: ['st1-sl'] })).status, 401, 'marks are refused');
  const a = await S.call({ action: 'nt', pin_session: 'tStore', add: [{ id: 'tab1', by: '店 S1', title: 'シフトが公開されました', toStore: 'S1', toRoles: ['crew', 'sl'] }] });
  assert.equal(a.status, 200);
  assert.deepEqual([a.j.level, a.j.done, a.j.items], ['add', ['tab1'], undefined], 'nothing is read back');
  const t = S.W.get('notifications').find(n => n.id === 'tab1');
  assert.deepEqual([t.by, t._u], ['店 S1', 1], 'the sender is kept as written, marked as not checked');
  assert.equal(S.W.actors.at(-1)[1], null, 'the change log does not get a person for it (written as the server)');
  // ログインの印が無い（PIN が初期の人）
  const b = await S.call({ action: 'nt', add: [{ id: 'nopin1', title: 'x', toRoles: ['gm'] }] });
  assert.equal(b.status, 200);
  // メールのログインが壊れている人も同じ（足すだけ）
  assert.equal((await S.call({ action: 'nt', add: [{ id: 'em1' }] }, { authorization: 'Bearer ' + JWT('nobody') })).status, 200);
  // 10 分に 300 件まで
  let st = 200;
  for (let i = 0; i < 16 && st === 200; i++) st = (await S.call({ action: 'nt', pin_session: 'tStore', add: Array.from({ length: 20 }, (_, k) => ({ id: 'flood' + i + '_' + k })) })).status;
  assert.equal(st, 429, 'too many adds from people the function cannot check');
  S.tick(600001);
  assert.equal((await S.call({ action: 'nt', pin_session: 'tStore', add: [{ id: 'later1' }] })).status, 200);
  // PIN を確かめられない（work-requests が答えない）：503（足したとみなさない）
  S.W.wrDown = '503';
  assert.equal((await S.call({ action: 'nt', pin_session: 'tSL', add: [{ id: 'z' }] })).status, 503);
});

test('a write that meets another write is read again and laid on top (nothing is lost); the oldest are pushed out past 500', async () => {
  const S = setup({ pins, emps, wrPeople });
  S.W.set('notifications', [N('base', { toRoles: ['gm'] })]);
  let once = true;
  S.W.afterGet = url => {
    if (!once || !String(url.search).includes('notifications')) return false;
    once = false;
    const cur = S.W.get('notifications');
    S.W.set('notifications', [...cur, N('other-device', { toRoles: ['gm'], at: iso(2) })], '2026-11-13T09:59:59.000000+00:00');
    return true;
  };
  const r = await S.call({ action: 'nt', pin_session: 'tGM', add: [{ id: 'mine', toRoles: ['sl'], toStore: 'S1' }], read: ['base'] });
  assert.equal(r.status, 200);
  const c = S.W.get('notifications');
  assert.deepEqual(c.map(n => n.id).sort(), ['base', 'mine', 'other-device'].sort(), 'the other device’s add is kept');
  assert.deepEqual(c.find(n => n.id === 'base').readBy, ['Gina']);
  // 500 を超えたら古いほうから押し出す
  S.W.set('notifications', Array.from({ length: NT_MAX }, (_, i) => N('n' + String(i).padStart(3, '0'), { at: new Date(Date.UTC(2026, 10, 1) + i * 60000).toISOString(), toRoles: ['gm'] })));
  await S.call({ action: 'nt', pin_session: 'tGM', add: [{ id: 'newest', toRoles: ['gm'] }] });
  const c2 = S.W.get('notifications');
  assert.equal(c2.length, NT_MAX);
  assert.equal(c2[0].id, 'n001'); assert.equal(c2.at(-1).id, 'newest');
});

test('ntClean keeps the fields the app uses and drops the server’s fields', () => {
  const t = Date.UTC(2026, 10, 13);
  const c = ntClean({ id: 'ntf_wr_GS-2611-001_2', at: new Date(t - 1000).toISOString(), by: 'B', type: 'wr', title: 'T', text: 'x'.repeat(3000), toUser: 'U', page: 'tasks', wrTab: 'mine', refId: 'GS-1', apTab: 'acct', ack: true, invTab: 'dhealth', readBy: ['Z'], _w: 'me', _s: 1 }, t);
  assert.equal(c.text.length, 2000);
  assert.deepEqual([c.readBy, c.ackBy, c._w, c._s, c.wrTab, c.ack, c.apTab], [[], [], undefined, undefined, 'mine', true, 'acct']);
  assert.equal(ntClean({ id: 'a', 'bad-key': 1 }, t), null);
  assert.equal(ntClean({ id: 'a', toRoles: 'gm' }, t), null);
  assert.equal(ntClean({ id: 'a', big: { x: 'y'.repeat(1200) } }, t), null);
  assert.equal(ntClean({ id: 12 }, t).id, '12');
  assert.equal(ntClean([], t), null);
});

test('edges: an AM’s charge store, a lowered grade, sm needs the Store Manager title, sorted before trimming, old times and big notices', async () => {
  // 確かめた SL の今のグレードが下がった（whoami のグレード 2）：確かめた写しが 3 でも crew
  const SLDOWN = { ...SL, grade: 2, name: 'Sally' };
  const S = setup({ pins: { ...pins, tSLD: SLDOWN }, emps, wrPeople });
  S.W.set('notifications', [
    N('st2-am', { toStore: 'S2', toRoles: ['am'] }),           // AM の担当の店（自分の店ではない）
    N('st1-sm', { toStore: 'S1', toRoles: ['sm'] }),           // Store Manager あて：S1 の Store Leader には出さない
    N('st1-sl2', { toStore: 'S1', toRoles: ['sl'] }),
    N('st1-crew2', { toStore: 'S1', toRoles: ['crew'] }),
  ]);
  const see = async t => ids((await S.call({ action: 'nt', pin_session: t })).j);
  assert.ok((await see('tAM')).includes('st2-am'), 'AM：担当の店（am_stores）の am あて');
  const sl = await see('tSL');
  assert.ok(!sl.includes('st1-sm'), 'Store Leader の肩書きでは sm あては出ない');
  assert.ok(sl.includes('st1-sl2'));
  assert.deepEqual(await see('tSLD'), ['st1-crew2'], '今のグレードが足りない：crew あてだけ');
  // 500 件のときに古い時刻の通知を足す：時刻の順に並べてから押し出す（古いほうが押し出される）
  const t0 = Date.UTC(2026, 10, 1);
  S.W.set('notifications', Array.from({ length: NT_MAX }, (_, i) => N('m' + String(i).padStart(3, '0'), { at: new Date(t0 + i * 60000).toISOString(), toRoles: ['gm'] })));
  await S.call({ action: 'nt', pin_session: 'tGM', add: [{ id: 'older', at: new Date(t0 - 86400000).toISOString(), toRoles: ['gm'] }] });
  const c = S.W.get('notifications');
  assert.equal(c.length, NT_MAX);
  assert.ok(!c.some(n => n.id === 'older'), 'いちばん古い時刻なので押し出される');
  assert.equal(c[0].id, 'm000');
  const ats = c.map(n => n.at); assert.deepEqual(ats, [...ats].sort(), 'いつも時刻の順');
  // ntClean：400 日より古い時刻は今に・大きすぎる通知は足さない
  const now = Date.UTC(2026, 10, 13);
  assert.equal(ntClean({ id: 'o', at: new Date(now - 401 * 86400000).toISOString() }, now).at, new Date(now).toISOString());
  assert.equal(ntClean({ id: 'o', at: new Date(now - 399 * 86400000).toISOString() }, now).at, new Date(now - 399 * 86400000).toISOString());
  const big = { id: 'big', text: 'x'.repeat(2000) }; for (let i = 0; i < 9; i++) big['f' + i] = 'y'.repeat(500);
  assert.equal(ntClean(big, now), null, '全体が 6,000 字を超える通知は足さない');
  const r = await S.call({ action: 'nt', pin_session: 'tGM', add: [big] });
  assert.equal(r.status, 200); assert.equal(r.j.bad, 1);
});

test('the answer of every action says ntfn:1 (the app knows the function does notifications)', async () => {
  const S = setup({ pins, emps, wrPeople });
  const r = await S.call({ action: 'pull', pin_session: 'tGM' });
  assert.equal(r.j.ntfn, 1);
  assert.equal((await S.call({ action: 'nope' })).j.ntfn, 1);
});

test('Codex #146 P2: a confirmed G2 is "sl" and a confirmed G4 is "am" for the addressed roles (the app turns g2 into sl and g4 into am at sign-in)', async () => {
  const G2 = { emp: 'E-G2', role: 'staff', grade: 2, stores: ['S1'], am_stores: [], name: 'Gwen', confirmed: true };
  const G4 = { emp: 'E-G4', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Gus', confirmed: true };
  const G4X = { emp: 'E-G4X', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Gil', confirmed: false };
  const E2 = [...emps, { id: 'E-G2', name: 'Gwen', role: 'g2', title: 'Crew Leader', store: 'S1' }, { id: 'E-G4', name: 'Gus', role: 'g4', title: 'Operation Leader', store: 'S1' },
    { id: 'E-G4X', name: 'Gil', role: 'g4', title: 'Operation Leader', store: 'S1' }, { id: 'E-G2SM', name: 'Gia', role: 'g2', title: 'Store Manager', store: 'S1' }];
  const WP = [...wrPeople, { emp_id: 'E-G2', role: 'staff', grade: 2, stores: ['S1'] }, { emp_id: 'E-G4', role: 'staff', grade: 4, stores: ['S1'] }, { emp_id: 'E-G2SM', role: 'staff', grade: 2, stores: ['S1'] }];
  const G2SM = { emp: 'E-G2SM', role: 'staff', grade: 2, stores: ['S1'], am_stores: [], name: 'Gia', confirmed: true };
  const S = setup({ pins: { ...pins, tG2: G2, tG4: G4, tG4X: G4X, tG2SM: G2SM }, emps: E2, wrPeople: WP });
  S.W.set('notifications', [...SEED, N('st1-am', { toStore: 'S1', toRoles: ['am'] }), N('st1-sm', { toStore: 'S1', toRoles: ['sm'] }), N('st1-g2', { toStore: 'S1', toRoles: ['g2', 'g4'] })]);
  const see = async t => ids((await S.call({ action: 'nt', pin_session: t })).j);
  assert.deepEqual(await see('tG2'), ['st1-all', 'st1-crew', 'st1-sl'].sort(), 'G2：sl あて（前は g2 のまま比べて、sl あての通知が届かなかった）');
  assert.deepEqual(await see('tG4'), ['st1-all', 'st1-am', 'st1-sl'].sort(), 'G4：am あて（前は届かなかった）');
  assert.deepEqual(await see('tG2SM'), ['st1-all', 'st1-crew', 'st1-sl', 'st1-sm'].sort(), 'G2 で Store Manager の肩書き：sm あても（画面の isStoreManager と同じ）');
  assert.deepEqual(await see('tG4X'), ['st1-all', 'st1-crew'].sort(), '確かめがまだの G4：crew あてだけ（今までどおり）');
});

test('Codex #146 6845284151: a notice addressed by name goes only to a person who alone holds that name (the employee table, the checked copy, people who left)', async () => {
  const A1 = { emp: 'E-A1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Alex' };
  const A2 = { emp: 'E-A2', role: 'staff', grade: 1, stores: ['S2'], am_stores: [], name: 'Alex' };
  const B1 = { emp: 'E-B1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Bea' };
  const C1 = { emp: 'E-C1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Cy' };
  const E2 = [...emps, { id: 'E-A1', name: 'Alex', role: 'crew', store: 'S1' }, { id: 'E-A2', name: 'Alex', role: 'crew', store: 'S2' },
    { id: 'E-B1', name: 'Bea', role: 'crew', store: 'S1' }, { id: 'E-B0', name: 'Bea ', role: 'crew', store: 'S2', status: '退職' }, { id: 'E-C1', name: 'Cy', role: 'crew', store: 'S1' }];
  const WP = [...wrPeople, { emp_id: 'E-X9', role: 'staff', grade: 2, stores: ['S2'], name: 'Cy' }];   // 確かめた写しの名前が Cy（社員の表は別の名前）
  const S = setup({ pins: { ...pins, tA1: A1, tA2: A2, tB1: B1, tC1: C1 }, emps: E2, wrPeople: WP });
  S.W.set('notifications', [...SEED, N('u-alex', { toUser: 'Alex' }), N('u-bea', { toUser: 'Bea' }), N('u-cy', { toUser: 'Cy' }), N('by-alex', { by: 'Alex', toUser: 'Someone' })]);
  const see = async t => ids((await S.call({ action: 'nt', pin_session: t })).j);
  assert.ok(!(await see('tA1')).includes('u-alex'), '同じ名前の 2 人：どちらにも返さない（前は両方に同じ個人あての通知を返した）');
  assert.ok(!(await see('tA2')).includes('u-alex'));
  assert.ok(!(await see('tA1')).includes('by-alex'), '自分が出した分も（だれのものか分からない）');
  assert.ok((await see('tA1')).includes('st1-crew'), '店・役割あての通知は今までどおり');
  assert.ok(!(await see('tB1')).includes('u-bea'), '退職した人と同じ名前（前後の空白だけ違う）');
  assert.ok(!(await see('tC1')).includes('u-cy'), '確かめた写しにだけある同じ名前');
  assert.deepEqual(await see('t1'), ['st1-all', 'st1-crew', 'u-crew'].sort(), 'ほかに同じ名前の人がいない：今までどおり');
  assert.ok((await see('tGM')).includes('u-gina'));
  // 既読の印も同じ（見られない通知には付けない）
  const r = await S.call({ action: 'nt', pin_session: 'tA1', ack: ['u-alex'] });
  assert.equal(r.status, 200);
  assert.deepEqual(S.W.get('notifications').find(n => n.id === 'u-alex').ackBy, []);
  // 社員の表が読めない：通知を読むこと全体が失敗（端末の写しのまま。名前あての通知を黙って消さない）
  S.tick(61000); S.W.empsDown = true;
  const bad = await S.call({ action: 'nt', pin_session: 't1' });
  assert.notEqual(bad.status, 200);
});
