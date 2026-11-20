// v1202（決めてほしいこと 8 の A・8B）：紛失届をサーバーの申請へ。本物の SQL（申請の本番の順＋承認・閲覧の共通ルール＋20261213090000_wr_lost.sql・PGlite）と
// 本物の handler、合成データだけ。仕様：docs/UNIFIED_UI_V1191_JA.md の 25。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setup, M, STAGE, G, C } from './approval-rules-world.mjs';
import { normPayload, KINDS, ALL_KINDS } from '../supabase/functions/work-requests/handler.mjs';

const LOST = M('20261213090000_wr_lost');
const DROP = fs.readFileSync(new URL('../db/wr-lost-drop.sql', import.meta.url), 'utf8');
async function world(opt = {}) {
  const s = await setup(opt);
  if (opt.lost !== false) { await s.pg.exec('reset role'); await s.pg.exec(LOST); if (opt.twice) await s.pg.exec(LOST); await s.pg.exec('set role service_role'); }
  const lost = (who, store, p = {}) => s.call(who, { action: 'submit', kind: 'lost', store_id: store, client_key: s.key(),
    payload: { date: s.today, vendor: 'Costco', amount_cents: 4250, cardholder: 'Sam Store', items: 'ice, cups', memo: 'receipt lost', ...p } });
  return { ...s, lost };
}

test('the SQL is made from the current functions with only the lost lines added (scripts/gen-wr-lost.py --check); the handler takes lost (fn 14)', () => {
  assert.match(execFileSync('python3', ['scripts/gen-wr-lost.py', '--check'], { encoding: 'utf8' }), /^same/);
  assert.ok(KINDS.includes('lost') && ALL_KINDS.includes('lost'));
  assert.deepEqual(normPayload('lost', { date: '2026-11-18', vendor: ' Costco ', amount_cents: 4250, cardholder: 'Sam', items: 'ice', memo: '', card: '4111111111111111', extra: 1 }),
    { date: '2026-11-18', vendor: 'Costco', amount_cents: 4250, cardholder: 'Sam', items: 'ice', memo: '' }, 'only the known fields (no card number)');
  for (const bad of [{ vendor: '' }, { cardholder: '' }, { amount_cents: 0 }, { amount_cents: 12.5 }, { date: '2026-02-30' }])
    assert.throws(() => normPayload('lost', { date: '2026-11-18', vendor: 'V', amount_cents: 100, cardholder: 'C', ...bad }), /bad_value/, JSON.stringify(bad));
});

test('before the SQL: the function says sql 8 and the SQL refuses lost (nothing is saved); after: sql 9, and running it twice is the same', async () => {
  const s = await world({ lost: false });
  const w = await s.ok('E2', { action: 'whoami' });
  assert.equal(w.fn, 14); assert.equal(w.sql, 8);
  const r = await s.lost('E6', 'S1');
  assert.equal(r.status, 400); assert.equal((await s.q("select count(*)::int n from wr_requests where kind = 'lost'"))[0].n, 0);
  const t = await world({ twice: true });
  assert.equal((await t.ok('E2', { action: 'whoami' })).sql, 9);
  assert.equal((await t.lost('E6', 'S1')).status, 200);
});

test('anyone signed in can send it for their store (G1 too, no expense right needed); not for another store; HQ staff for any store', async () => {
  const s = await world();
  const crew = await s.lost('E8', 'S1');   // Crew（G1）・経費の申請の権限は無い
  assert.equal(crew.status, 200, JSON.stringify(crew.body));
  assert.match(crew.body.code, /^LR-\d{4}-\d{4,6}$/); assert.equal(crew.body.status, 'pending'); assert.equal(crew.body.amount_cents, 4250);
  assert.equal((await s.call('E8', { action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: s.key(), payload: { date: s.today, payer: 'x', vendor: 'v', amount_cents: 100 } })).status, 403, 'still no expense right');
  assert.equal((await s.lost('E8', 'S2')).status, 403, 'not another store');
  assert.equal((await s.lost('E3', 'S2')).status, 200, 'accounting: any store');
  assert.equal((await s.lost('E6', 'S1', { vendor: '' })).status, 400);
});

test('GM approves → accounting checks → done (no payment step); the requester and accounting see it, another store’s crew does not', async () => {
  const s = await world();
  const x = (await s.lost('E8', 'S1')).body;
  assert.notEqual((await s.get('E9', x)).status, 200, 'another store crew does not see it');
  assert.equal((await s.get('E3', x)).status, 200, 'accounting sees it');
  const a = await s.approve('E2', x); assert.equal(a.status, 200, JSON.stringify(a.body)); assert.equal(a.body.status, 'approved');
  let f = await s.fresh(x);
  assert.equal(f.next.step, 'check'); assert.equal(f.next.who, 'acct');
  const acct = (await s.get('E3', x)).body;
  assert.ok(acct.can.includes('check')); assert.ok(!acct.can.includes('pay'));
  const c = await s.act('E3', acct, 'check'); assert.equal(c.status, 200, JSON.stringify(c.body)); assert.equal(c.body.status, 'done', 'done at the check (like a pre-approval)');
  f = await s.fresh(x); assert.ok(!f.next || f.next.step !== 'pay');
  const mine = await s.ok('E8', { action: 'get', id: x.id }); assert.equal(mine.status, 'done', 'the requester sees it');
  const undo = (await s.get('E3', x)).body; assert.ok(undo.can.includes('undo'), 'accounting can undo the check');
});

test('duplicates are flagged like expenses (same person, same day, same amount); the GM can confirm them', async () => {
  const s = await world();
  const first = (await s.lost('E6', 'S1')).body;
  const ask = (await s.lost('E6', 'S1')).body;
  assert.ok(Array.isArray(ask.duplicate) && ask.duplicate.length === 1, 'asked first (nothing written): ' + JSON.stringify(ask));
  assert.equal((await s.q("select count(*)::int n from wr_requests where kind = 'lost'"))[0].n, 1);
  const d = (await s.call('E6', { action: 'submit', kind: 'lost', store_id: 'S1', client_key: s.key(), dup_reason: '2 枚目のカード',
    payload: { date: s.today, vendor: 'Costco', amount_cents: 4250, cardholder: 'Sam Store', items: 'ice, cups', memo: 'receipt lost' } })).body;
  assert.deepEqual(d.dup_codes, [first.code]); assert.equal(d.dup_reason, '2 枚目のカード');
  const g = (await s.get('E2', d)).body; assert.ok(g.can.includes('dup_ok'), 'the GM can confirm it is not a duplicate');
});

test('approval rules: lost is one of the kinds; with a rule (GM → CEO) the route is followed and accounting sees the final one', async () => {
  const s = await world();
  const st = await s.state(); assert.ok(st.kinds.some(k => k.kind === 'lost'));
  await s.setRule('lost', { default: { stages: [STAGE(G), STAGE(C)] } });
  await s.activate(); await s.live();
  const x = (await s.lost('E8', 'S1')).body;
  let r = await s.approve('E2', x); assert.equal(r.status, 200); assert.equal(r.body.status, 'pending', 'the CEO step is next');
  r = await s.approve('E1', x); assert.equal(r.status, 200); assert.equal(r.body.status, 'approved');
  const acct = (await s.get('E3', x)).body; assert.ok(acct.can.includes('check'));
  assert.equal((await s.act('E3', acct, 'check')).body.status, 'done');
});

test('rollback: with no lost request it goes back to the earlier functions (sql 8, lost refused); with one it stops and changes nothing', async () => {
  const s = await world();
  await s.pg.exec('reset role'); await s.pg.exec(DROP); await s.pg.exec('set role service_role');
  assert.equal((await s.ok('E2', { action: 'whoami' })).sql, 8);
  assert.equal((await s.lost('E6', 'S1')).status, 400);
  assert.equal((await s.call('E6', { action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: s.key(), payload: { date: s.today, payer: 'x', vendor: 'v', amount_cents: 100 } })).status, 200, 'expenses still work');
  const t = await world();
  await t.lost('E6', 'S1');
  await t.pg.exec('reset role');
  await assert.rejects(t.pg.exec(DROP), /STOP: 紛失届/);
  await t.pg.exec('set role service_role');
  assert.equal((await t.ok('E2', { action: 'whoami' })).sql, 9);
});
