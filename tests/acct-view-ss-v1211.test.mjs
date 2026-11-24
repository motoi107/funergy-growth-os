// v1211（B-1）・#218 の Codex（7134072683）の P2：GM・CEO が「事務Crew と確かめた」PIN の事務Crew は、関数 secure-state でも
// 事務Crew のメールのアカウントと同じ office_crew になる（PIN の人の役割は work-requests の whoami＝wr_actor で決まるため）。
// Moto さん 11/24「メールの事務Crewと全く同じ」で認めた広がり。ここでは、その広がりと、確かめる前と後・確かめを外す・PIN の期限・退職で
// どう変わるか（secure-state は whoami の答えを 60 秒覚えるので、変わるのは最大 60 秒あと）を確かめる。
// 本物の申請の SQL（wr_actor・PGlite）と本物の work-requests の handler の whoami を、secure-state の偽のクラウド（tests/lib）につなぐ。
// 合成データだけ。本番にはつながない。仕様：docs/ACCT_VIEW_V1211_JA.md の 3・4。
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup as wrWorld, M, NAME } from './approval-rules-world.mjs';
import { createHandler } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, WR, ANON, SERVICE, JWT } from './lib/secure-state-world.mjs';

const LOST = M('20261213090000_wr_lost');
const FIX = M('20261217090000_wr_actor_crew_grant');
// PIN だけの事務Crew（manager_auth なし）：E15 は確かめる・E16 は確かめない
const EXTRA = [['E15', 'Pia Pin', 'office_crew', 'Office Crew', 'OFFICE'], ['E16', 'Quinn Pin', 'office_crew', 'Office Crew', 'OFFICE']];
const iso = m => new Date(Date.UTC(2026, 10, 24, 9, m, 0)).toISOString();
const N = (id, o) => ({ id, at: iso(1), by: 'X', readBy: [], ackBy: [], type: 't', title: 'T ' + id, ...o });
const NOTES = [N('s2-all', { toStore: 'S2' }), N('s3-sl', { toStore: 'S3', toRoles: ['sl'] }), N('r-office', { toRoles: ['office', 'office_crew'] }), N('r-gm', { toRoles: ['gm'] })];

async function both({ fix = true } = {}) {
  const wr = await wrWorld({});
  await wr.pg.exec('reset role');
  await wr.pg.exec(LOST);
  for (const [id, nm, role, title, store] of EXTRA) {
    await wr.pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, nm, role, title, store, JSON.stringify({ name: nm, status: '在籍' })]);
    NAME[id] = nm;
  }
  if (fix) await wr.pg.exec(FIX);
  await wr.pg.exec('set role service_role');
  // secure-state の偽のクラウド。work-requests の whoami だけは本物の handler（本物の wr_actor）へ。
  // PIN の印（sess-…）は PIN の仕組みが確かめる代わり：期限が切れた印は work-requests の verifyPin が断る形（pin-E… でない）にして渡す
  // 比べる相手：事務Crew のメールのアカウント（E4・manager_auth の office_crew）
  const OC = '00000000-0000-4000-8000-000000000004';
  const W = makeWorld({ emps: [{ id: 'E15', name: 'Pia Pin', role: 'office_crew', title: 'Office Crew', store: 'OFFICE', status: '在籍' },
    { id: 'E16', name: 'Quinn Pin', role: 'office_crew', title: 'Office Crew', store: 'OFFICE', status: '在籍' },
    { id: 'E4', name: 'Oli Office', role: 'office_crew', title: 'Office Crew', store: 'OFFICE', status: '在籍' }],
    users: { oc: OC }, mgr: { [OC]: { role: 'office_crew', emp_id: 'E4' } }, changeLog: [] });
  W.set('notifications', NOTES);
  const sess = new Map([['sess-15', 'pin-E15'], ['sess-16', 'pin-E16']]);
  const wrCalls = [];
  const fetch = async (u, opt) => {
    if (String(u).startsWith(WR)) {
      const b = JSON.parse(opt.body);
      wrCalls.push(b.pin_session);
      const tok = sess.get(b.pin_session) || 'expired';
      return wr.handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, pin_session: tok }) }));
    }
    return W.fetch(u, opt);
  };
  let clock = Date.UTC(2026, 10, 24, 10, 0, 0);
  const handle = createHandler({ env: k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]), fetch, now: () => clock });
  const call = async (body, auth = 'Bearer ' + ANON) => {
    const r = await handle(new Request('https://fn.test/secure-state', { method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify(body) }));
    let j = null; try { j = await r.json(); } catch { j = null; }
    return { status: r.status, j };
  };
  // 事務Crew の範囲のしるし 3 つ：変更の記録（change_log）・カードの下 4 桁の照合（card_match）・全店の通知（nt）
  // s：PIN の印（sess-…）か、'email'（事務Crew のメールのアカウント）
  const look = async s => {
    const as = s === 'email' ? [{}, 'Bearer ' + JWT('oc')] : [{ pin_session: s }];
    const cl = await call({ action: 'change_log', ...as[0] }, as[1]);
    const card = await call({ action: 'card_match', last4: '1111', ...as[0] }, as[1]);
    const nt = await call({ action: 'nt', ...as[0] }, as[1]);
    return { cl: cl.status, card: card.status, nt: nt.status === 200 ? (nt.j.items || []).map(n => n.id).sort() : nt.status };
  };
  const grant = async on => {
    const rows = (await wr.call('E2', { action: 'exp_grant_list' })).body.rows || [];
    const row = rows.find(x => x.emp === 'E15');
    const r = await wr.call('E2', { action: 'exp_grant_save', target: 'E15', mileage: null, reimburse: null, crew: on ? true : null, expect_rev: row ? row.rev : 0 });
    assert.equal(r.status, 200, 'grant ' + JSON.stringify(r.body));
  };
  return { wr, W, sess, wrCalls, call, look, grant, tick: ms => { clock += ms; } };
}

const NARROW = { cl: 403, card: 403, nt: [] };                                   // 確かめがまだの G1（自分の店 OFFICE あての crew の通知も無い）
const CREW = { cl: 200, card: 200, nt: ['r-office', 's2-all'] };                  // 事務Crew（全店あての通知・事務Crew あて。店の役割あて・GM あては見えない）

test('#218 P2：確かめた PIN の事務Crew は secure-state でもメールの事務Crew と同じ範囲（変更の記録・カードの照合・全店の通知）。確かめていない人は今までどおり', async () => {
  const b = await both();
  // 確かめる前：G1 のスタッフ
  assert.deepEqual(await b.look('sess-15'), NARROW, '確かめる前');
  assert.deepEqual(await b.look('sess-16'), NARROW, '確かめない人');
  // GM が「事務Crew と確かめる」。secure-state は whoami の答えを 60 秒覚えているので、広がるのは最大 60 秒あと
  await b.grant(true);
  assert.deepEqual(await b.look('sess-15'), NARROW, '60 秒のあいだは前の答え');
  b.tick(60001);
  assert.deepEqual(await b.look('sess-15'), CREW, '確かめたあと：事務Crew の範囲');
  assert.deepEqual(await b.look('email'), CREW, 'メールの事務Crew と全く同じ');
  assert.deepEqual(await b.look('sess-16'), NARROW, '確かめていない人は変わらない');
  // 給与・賞与・成長カルテ（ほかの人の分）は GM・CEO だけのまま（secure-state の full は ceo・gm だけ。事務Crew は proj）
  const pull = await b.call({ action: 'pull', pin_session: 'sess-15' });
  assert.equal(pull.status, 200); assert.notEqual(pull.j.level, 'full');
});

test('#218 P2：確かめを外す・PIN の期限・退職は、次の whoami から狭まる（secure-state が覚えている最大 60 秒は前のまま）', async () => {
  const b = await both();
  await b.grant(true);
  assert.deepEqual(await b.look('sess-15'), CREW);
  // 1) GM が確かめを外す：60 秒のあいだは事務Crew のまま・そのあと G1
  await b.grant(false);
  assert.deepEqual(await b.look('sess-15'), CREW, '外した直後（最大 60 秒）は前の答え');
  b.tick(59000);
  assert.deepEqual(await b.look('sess-15'), CREW, '59 秒');
  b.tick(1001);
  assert.deepEqual(await b.look('sess-15'), NARROW, '60 秒をこえたら G1');
  // 2) 確かめ直して、PIN の期限が切れる：60 秒のあとは何も見えない（401）
  await b.grant(true); b.tick(60001);
  assert.deepEqual(await b.look('sess-15'), CREW);
  b.sess.delete('sess-15');
  assert.deepEqual(await b.look('sess-15'), CREW, '期限が切れた直後（最大 60 秒）は前の答え');
  b.tick(60001);
  assert.deepEqual(await b.look('sess-15'), { cl: 401, card: 401, nt: 401 }, '期限が切れた印は断る');
  // 3) 新しい印で入り直して、退職：whoami が断る（403）→ 60 秒のあとは何も見えない。カードの照合は社員の表で先に止まる
  b.sess.set('sess-15b', 'pin-E15');
  assert.deepEqual(await b.look('sess-15b'), CREW);
  await b.wr.retire('E15');
  b.W.emps.find(e => e.id === 'E15').status = '退職';
  const just = await b.look('sess-15b');
  assert.equal(just.cl, 200, '退職の直後（最大 60 秒）は前の答え'); assert.equal(just.card, 403, 'カードの照合は社員の表を毎回見る');
  b.tick(60001);
  assert.deepEqual(await b.look('sess-15b'), { cl: 401, card: 401, nt: 401 }, '退職した人は断る');
});

test('#218 P2：直す前の SQL（v1211 の 20261217090000 なし）では、確かめても secure-state は G1 のまま（広がりは v1211 から）', async () => {
  const b = await both({ fix: false });
  await b.grant(true); b.tick(60001);
  assert.deepEqual(await b.look('sess-15'), NARROW);
});
