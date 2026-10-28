// v1109 bonus-close: the real SQL (PGlite) and the real handler on synthetic data. No production data: fake UUIDs,
// fictional names and made-up amounts. Email sign-in is a stand-in for Supabase Auth.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler, CODES } from '../supabase/functions/bonus-close/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const MIG = fs.readFileSync(new URL('../supabase/migrations/20261028090000_bonus_close.sql', import.meta.url), 'utf8');
const U = { ceo: '00000000-0000-4000-8000-0000000000b1', gm: '00000000-0000-4000-8000-0000000000b2', office: '00000000-0000-4000-8000-0000000000b3',
  crew: '00000000-0000-4000-8000-0000000000b4', sus: '00000000-0000-4000-8000-0000000000b5', stranger: '00000000-0000-4000-8000-0000000000b6',
  former: '00000000-0000-4000-8000-0000000000b7' };
const J = v => JSON.parse(JSON.stringify(v));

// The app's rounding (kevAlloc): $1 units, floor, then the largest remainders (ties: larger raw, then id).
export function alloc(list, cap) {
  const capC = Math.round(cap * 100), tgt = Math.floor(capC / 100), S = list.reduce((a, x) => a + x.raw, 0), finals = {};
  if (!(S > 0)) { list.forEach(x => { finals[x.id] = 0; }); return { k: 1, finals, sum: 0, S }; }
  if (capC / 100 >= S) { list.forEach(x => { finals[x.id] = x.raw; }); return { k: 1, finals, sum: S, S }; }
  const den = S * 100, rows = list.map(x => { const num = x.raw * capC, rem = num % den; return { id: x.id, raw: x.raw, fl: (num - rem) / den, fr: rem }; });
  const sum = rows.reduce((a, x) => a + x.fl, 0), R = Math.max(0, Math.min(rows.length, tgt - sum));
  rows.slice().sort((a, b) => (b.fr - a.fr) || (b.raw - a.raw) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, R).forEach(x => { x.fl++; });
  rows.forEach(x => { finals[x.id] = x.fl; });
  return { k: (capC / 100) / S, finals, sum: rows.reduce((a, x) => a + x.fl, 0), S };
}
// A snapshot as the app makes it (only the parts the server checks, plus a name).
export function snap(q, people, cap, extra = {}) {
  const list = people.map(([id, raw]) => ({ id, raw })), al = alloc(list, cap), P = {};
  people.forEach(([id, raw, name]) => { P[id] = { name: name || id, raw, final: al.finals[id] }; });
  return { q, order: people.map(x => x[0]), people: P, finals: al.finals, S: al.S, paid: al.sum, cap, k: al.k, unsel: 0, prov: 0, choices: {}, ...extra };
}

async function setup() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, status text);
    grant select on public.manager_auth, public.employees to service_role;
    insert into public.employees values ('E1','CEO Sample','在籍'),('E2','GM Sample','在籍'),('E3','Accounting Sample','在籍'),('E4','Crew Sample','在籍'),('E5','Former Sample','退職');`);
  for (const [k, r, e] of [['ceo', 'ceo', 'E1'], ['gm', 'gm', 'E2'], ['office', 'office', 'E3'], ['crew', 'office_crew', 'E4'], ['sus', 'suspended', 'E2'], ['former', 'gm', 'E5']])
    await pg.query('insert into manager_auth(user_id, role, emp_id) values($1,$2,$3)', [U[k], r, e]);
  await pg.exec(MIG);
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const users = Object.fromEntries(Object.entries(U).map(([k, v]) => ['tok-' + k, v]));
  const fetch = async (url, init) => {
    if (String(url).endsWith('/auth/v1/user')) { const id = users[(init.headers.authorization || '').replace('Bearer ', '')]; return id ? Response.json({ id }) : new Response('{}', { status: 401 }); }
    throw new Error('unexpected network call ' + url);
  };
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k];
  const handler = createHandler({ env, fetch, db });
  const call = async (who, body, origin) => {
    const headers = { 'content-type': 'application/json' };
    if (who) headers.authorization = 'Bearer tok-' + who;
    if (origin) headers.origin = origin;
    const r = await handler(new Request('https://fn.test/bonus-close', { method: 'POST', headers, body: JSON.stringify(body) }));
    return { status: r.status, body: await r.json() };
  };
  return { pg, db, call };
}

const Q = '2026-Q4';
test('the tables and functions are closed to browsers; only the service role reaches them', async () => {
  const { pg } = await setup();
  await pg.exec('reset role');
  for (const role of ['anon', 'authenticated']) {
    const t = await pg.query(`select count(*)::int n from information_schema.role_table_grants where grantee = $1 and table_name like 'bc\\_%'`, [role]);
    assert.equal(t.rows[0].n, 0, role + ' has no table grants');
    const f = await pg.query(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'bc\\_%' and has_function_privilege($1, p.oid, 'execute')`, [role]);
    assert.equal(f.rows[0].n, 0, role + ' cannot run bc_ functions');
  }
  const rls = await pg.query(`select count(*)::int n from pg_class where relname in ('bc_quarters','bc_versions','bc_adjust','bc_events') and relrowsecurity`);
  assert.equal(rls.rows[0].n, 4);
  const sec = await pg.query(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'bc\\_%' and (p.prosecdef or not exists(select 1 from unnest(p.proconfig) c where c like 'search_path=%'))`);
  assert.equal(sec.rows[0].n, 0, 'security invoker with a fixed search_path');
});

test('who may read and write: CEO / GM write, accounting reads, others and suspended accounts are refused', async () => {
  const { call } = await setup();
  assert.equal((await call(null, { action: 'get', quarter: Q })).status, 401);
  assert.equal((await call('stranger', { action: 'get', quarter: Q })).status, 403);
  assert.equal((await call('crew', { action: 'get', quarter: Q })).status, 403);
  assert.equal((await call('sus', { action: 'get', quarter: Q })).status, 403);
  assert.equal((await call('former', { action: 'get', quarter: Q })).status, 403, 'an account still linked to a resigned employee');
  const g = await call('office', { action: 'get', quarter: Q });
  assert.equal(g.status, 200); assert.equal(g.body.me.role, 'office'); assert.equal(g.body.me.write, false); assert.equal(g.body.rev, 0);
  assert.equal((await call('office', { action: 'draft_save', quarter: Q, expect_rev: 0, draft: { choices: {} } })).status, 403);
  const w = await call('gm', { action: 'draft_save', quarter: Q, expect_rev: 0, draft: { choices: {} } });
  assert.equal(w.status, 200); assert.equal(w.body.rev, 1); assert.equal(w.body.draft_by, 'GM Sample');
  // The body's own role or actor is never used.
  assert.equal((await call('office', { action: 'draft_save', quarter: Q, expect_rev: 1, draft: {}, actor: U.ceo, role: 'ceo' })).status, 403);
  assert.equal((await call('ceo', { action: 'nope', quarter: Q })).status, 400);
  assert.equal((await call('ceo', { action: 'get', quarter: '2026-4' })).status, 400);
  assert.equal((await call('ceo', { action: 'get', quarter: Q }, 'https://evil.test')).status, 403);
});

test('a version adds up or is refused; nothing unselected; the pool is required', async () => {
  const { call } = await setup();
  const people = [['P1', 1000, 'Sample A'], ['P2', 1000, 'Sample B'], ['P3', 1500, 'Sample C']];
  const ok = snap(Q, people, 3000);
  assert.equal(ok.paid, 3000);
  const tries = [
    ['unselected', { ...ok, unsel: 1 }],
    ['bad_amounts', { ...ok, paid: ok.paid + 1 }],
    ['bad_amounts', { ...ok, finals: { ...ok.finals, P1: ok.finals.P1 + 1 }, paid: ok.paid + 1 }],
    ['bad_amounts', { ...ok, k: 0.9 }],
    ['bad_amounts', { ...ok, S: 3499 }],
    // under the pool's whole dollars (everything else adds up): refused
    ['bad_amounts', { ...ok, finals: { ...ok.finals, P1: ok.finals.P1 - 1 }, paid: ok.paid - 1, people: { ...ok.people, P1: { ...ok.people.P1, final: ok.finals.P1 - 1 } } }],
    // more than the person's own amount (the total still adds up): refused
    ['bad_amounts', { ...ok, finals: { ...ok.finals, P1: 1001, P3: ok.finals.P3 - (1001 - ok.finals.P1) }, people: { ...ok.people, P1: { ...ok.people.P1, final: 1001 }, P3: { ...ok.people.P3, final: ok.finals.P3 - (1001 - ok.finals.P1) } } }],
    ['no_pool', { ...ok, cap: null }],
    ['bad_snapshot', { ...ok, q: '2026-Q3' }],
    ['bad_snapshot', { ...ok, order: ['P1', 'P2'] }],
    ['bad_amounts', { ...ok, people: { ...ok.people, P1: { ...ok.people.P1, raw: 10.5 } } }],
    ['bad_snapshot', { ...ok, choices: { P1: { c: { m: 'set', v: 1.02, why: 'x' } } } }],
    ['bad_snapshot', { ...ok, choices: { P1: { c: { m: 'set', v: 1.05 } } } }],
    ['bad_snapshot', { ...ok, choices: { P1: { c: { m: 'guess' } } } }],
    ['bad_snapshot', { ...ok, choices: { P1: { d: { m: 'set', v: 1, why: 'x' } } } }],
  ];
  for (const [code, s] of tries) {
    const r = await call('gm', { action: 'save', quarter: Q, expect_rev: 0, kind: 'provisional', snap: s });
    assert.equal(r.body.error, code, code + ' ' + JSON.stringify(s).slice(0, 80));
  }
  // S = 0: k 1 and nothing paid. The pool above S: everyone gets the raw amount.
  const zero = snap(Q, [['P1', 0], ['P2', 0]], 500);
  assert.equal((await call('gm', { action: 'save', quarter: Q, expect_rev: 0, kind: 'provisional', snap: zero })).body.ver, 1);
  const { call: call2 } = await setup();
  const big = snap(Q, people, 9000.5);
  assert.deepEqual(J(big.finals), { P1: 1000, P2: 1000, P3: 1500 });
  assert.equal((await call2('gm', { action: 'save', quarter: Q, expect_rev: 0, kind: 'provisional', snap: { ...big, finals: { P1: 1000, P2: 1000, P3: 1499 }, paid: 3499, people: { ...big.people, P3: { ...big.people.P3, final: 1499 } } } })).body.error, 'bad_amounts');
  // A final cannot be saved directly (only from a provisional version, or while correcting an effective final).
  assert.equal((await call2('gm', { action: 'save', quarter: Q, expect_rev: 0, kind: 'final', snap: big, why: 'x' })).body.error, 'not_editable');
});

test('the flow: draft → 仮締め v1 → 修正 → 仮締め v2 → 確定 v3 → 修正 → 再確定 v4 (v3 replaced, one effective)', async () => {
  const { call, pg } = await setup();
  const people = [['P1', 1000, 'Sample A'], ['P2', 1000, 'Sample B']];
  let g = (await call('gm', { action: 'get', quarter: Q })).body;
  assert.equal(g.rev, 0); assert.equal(g.versions.length, 0);
  // Conflict: another screen saved first.
  assert.equal((await call('gm', { action: 'draft_save', quarter: Q, expect_rev: 0, draft: { choices: { P1: { c: { m: 'tmp', at: 'x', by: 'GM' } } } } })).body.rev, 1);
  assert.equal((await call('ceo', { action: 'draft_save', quarter: Q, expect_rev: 0, draft: { choices: {} } })).status, 409);
  const s1 = snap(Q, people, 1800, { prov: 1, choices: { P1: { c: { m: 'tmp' } } } });
  const v1 = (await call('gm', { action: 'save', quarter: Q, expect_rev: 1, kind: 'provisional', snap: s1 })).body;
  assert.equal(v1.ver, 1); assert.equal(v1.lid, 'BC-2026-Q4-v1');
  // After 仮締め the draft is closed until a correction starts.
  assert.equal((await call('gm', { action: 'draft_save', quarter: Q, expect_rev: v1.rev, draft: {} })).body.error, 'not_editable');
  assert.equal((await call('gm', { action: 'save', quarter: Q, expect_rev: v1.rev, kind: 'provisional', snap: s1 })).body.error, 'not_editable');
  let f = (await call('gm', { action: 'fix_start', quarter: Q, expect_rev: v1.rev })).body;
  assert.equal(f.fixing, 1);
  g = (await call('gm', { action: 'get', quarter: Q })).body;
  assert.deepEqual(J(g.draft.choices), { P1: { c: { m: 'tmp' } } }, 'the correction starts from v1’s chosen values');
  const s2 = snap(Q, [['P1', 1100, 'Sample A'], ['P2', 1000, 'Sample B']], 1800);
  const v2 = (await call('gm', { action: 'save', quarter: Q, expect_rev: f.rev, kind: 'provisional', snap: s2 })).body;
  assert.equal(v2.ver, 2);
  assert.deepEqual(J(s2.finals), { P1: 943, P2: 857 }, 'the example in the request (A·B) with $1 units');
  // 支給額を確定 copies the latest provisional (no recount). With provisional values a reason is required.
  const c3 = (await call('ceo', { action: 'confirm', quarter: Q, expect_rev: v2.rev, ver: 2 })).body;
  assert.equal(c3.ver, 3);
  assert.equal((await call('gm', { action: 'confirm', quarter: Q, expect_rev: c3.rev, ver: 3 })).body.error, 'not_editable');
  g = (await call('gm', { action: 'get', quarter: Q })).body;
  assert.deepEqual(g.versions.map(v => [v.ver, v.kind, v.status]), [[1, 'provisional', 'kept'], [2, 'provisional', 'kept'], [3, 'final', 'effective']]);
  assert.equal(g.versions[2].from_ver, 2); assert.equal(g.versions[2].made_by, 'CEO Sample');
  assert.equal(g.latest.ver, 3); assert.deepEqual(J(g.latest.snap.finals), { P1: 943, P2: 857 });
  // Correct from the final: v3 stays effective until re-confirmed; cancel keeps it.
  f = (await call('gm', { action: 'fix_start', quarter: Q, expect_rev: g.rev })).body;
  assert.equal(f.fixing, 3);
  assert.equal((await call('gm', { action: 'save', quarter: Q, expect_rev: f.rev, kind: 'provisional', snap: s2 })).body.error, 'not_editable', 'no provisional once a final exists');
  const fc = (await call('gm', { action: 'fix_cancel', quarter: Q, expect_rev: f.rev })).body;
  g = (await call('gm', { action: 'get', quarter: Q })).body;
  assert.equal(g.fixing, null); assert.equal(g.versions.find(v => v.status === 'effective').ver, 3);
  f = (await call('gm', { action: 'fix_start', quarter: Q, expect_rev: fc.rev })).body;
  const s4 = snap(Q, [['P1', 1100, 'Sample A'], ['P2', 1000, 'Sample B']], 2100);
  assert.equal((await call('gm', { action: 'save', quarter: Q, expect_rev: f.rev, kind: 'final', snap: s4 })).body.error, 'why_required');
  const v4 = (await call('gm', { action: 'save', quarter: Q, expect_rev: f.rev, kind: 'final', snap: s4, why: 'Sample B の評価が確定' })).body;
  assert.equal(v4.ver, 4);
  g = (await call('gm', { action: 'get', quarter: Q })).body;
  assert.deepEqual(g.versions.map(v => [v.ver, v.status]), [[1, 'kept'], [2, 'kept'], [3, 'replaced'], [4, 'effective']]);
  assert.equal(g.adjust.length, 0, 'not paid yet: no adjustment records');
  // v3 still opens with its own numbers.
  const old = (await call('office', { action: 'version', quarter: Q, ver: 3 })).body;
  assert.deepEqual(J(old.snap.finals), { P1: 943, P2: 857 }); assert.equal(old.status, 'replaced');
  // The database refuses a second effective final whatever happens.
  await pg.exec('reset role');
  await assert.rejects(pg.query(`update public.bc_versions set status = 'effective' where quarter = $1 and ver = 3`, [Q]));
});

test('支給済み: once, from the effective final; a later re-confirm makes adjustment records and never changes the paid amounts', async () => {
  const { call } = await setup();
  const A = [['P1', 1000, 'Sample A'], ['P2', 1000, 'Sample B']];
  let r = (await call('gm', { action: 'save', quarter: Q, expect_rev: 0, kind: 'provisional', snap: snap(Q, A, 1800) })).body;
  r = (await call('gm', { action: 'confirm', quarter: Q, expect_rev: r.rev, ver: 1 })).body;   // v2 final
  assert.equal((await call('gm', { action: 'mark_paid', quarter: Q, expect_rev: r.rev, ver: 1, paid_on: '2027-02-25' })).body.error, 'not_editable');
  assert.equal((await call('gm', { action: 'mark_paid', quarter: Q, expect_rev: r.rev, ver: 2, paid_on: '2027-02-30' })).body.error, 'bad_value');
  const p = (await call('gm', { action: 'mark_paid', quarter: Q, expect_rev: r.rev, ver: 2, paid_on: '2027-02-25' })).body;
  assert.equal(p.ver, 2);
  assert.equal((await call('gm', { action: 'mark_paid', quarter: Q, expect_rev: p.rev, ver: 2, paid_on: '2027-02-25' })).body.error, 'already_paid');
  let f = (await call('ceo', { action: 'fix_start', quarter: Q, expect_rev: p.rev })).body;
  assert.equal((await call('gm', { action: 'mark_paid', quarter: Q, expect_rev: f.rev, ver: 2, paid_on: '2027-02-25' })).body.error, 'fixing');
  const v3 = (await call('ceo', { action: 'save', quarter: Q, expect_rev: f.rev, kind: 'final', why: '評価の訂正', snap: snap(Q, [['P1', 1100, 'Sample A'], ['P2', 1000, 'Sample B'], ['P3', 300, 'Sample C']], 2400) })).body;
  let g = (await call('office', { action: 'get', quarter: Q })).body;
  assert.equal(g.versions.find(v => v.ver === 2).paid_on, '2027-02-25');
  assert.equal(g.versions.find(v => v.ver === 2).status, 'replaced');
  assert.deepEqual(g.adjust.map(x => [x.emp_id, x.prev_amount, x.new_amount, x.diff, x.state, x.paid_ver]).sort(),
    [['P1', 900, 1100, 200, 'open', 2], ['P2', 900, 1000, 100, 'open', 2], ['P3', 0, 300, 300, 'open', 2]]);
  // Re-confirming again: the differences are against the previous effective final (v3), so nothing is counted twice.
  f = (await call('ceo', { action: 'fix_start', quarter: Q, expect_rev: g.rev })).body;
  await call('ceo', { action: 'save', quarter: Q, expect_rev: f.rev, kind: 'final', why: 'もう一度', snap: snap(Q, [['P1', 1100, 'Sample A'], ['P2', 1000, 'Sample B'], ['P3', 200, 'Sample C']], 2300) });
  g = (await call('office', { action: 'get', quarter: Q })).body;
  const sum = id => g.adjust.filter(x => x.emp_id === id).reduce((a, x) => a + Number(x.diff), 0);
  assert.equal(sum('P3'), 200, 'P3: +300 then −100'); assert.equal(sum('P1'), 200);
  // 対応済み needs a memo and is recorded once.
  const id = Number(g.adjust[0].id);
  assert.equal((await call('gm', { action: 'adjust_done', quarter: Q, expect_rev: g.rev, id, memo: ' ' })).body.error, 'memo_required');
  const d = (await call('gm', { action: 'adjust_done', quarter: Q, expect_rev: g.rev, id, memo: '次の四半期の支給で調整' })).body;
  assert.equal((await call('gm', { action: 'adjust_done', quarter: Q, expect_rev: d.rev, id, memo: 'again' })).body.error, 'not_editable');
  assert.equal((await call('office', { action: 'adjust_done', quarter: Q, expect_rev: d.rev, id, memo: 'x' })).status, 403);
});

test('every refused write leaves the quarter as it was (rev, versions, draft)', async () => {
  const { call } = await setup();
  const s = snap(Q, [['P1', 500]], 400);
  const v1 = (await call('gm', { action: 'save', quarter: Q, expect_rev: 0, kind: 'provisional', snap: s })).body;
  const before = (await call('gm', { action: 'get', quarter: Q })).body;
  for (const b of [{ action: 'save', kind: 'provisional', snap: s, expect_rev: v1.rev }, { action: 'confirm', ver: 1, expect_rev: v1.rev - 1 }, { action: 'fix_cancel', expect_rev: v1.rev },
    { action: 'mark_paid', ver: 1, paid_on: '2027-01-10', expect_rev: v1.rev }, { action: 'draft_save', draft: { x: 1 }, expect_rev: v1.rev }])
    assert.ok((await call('gm', { quarter: Q, ...b })).status >= 400);
  const after = (await call('gm', { action: 'get', quarter: Q })).body;
  assert.deepEqual(J(after), J(before));
  assert.ok(CODES.includes('conflict'));
});

test('a provisional version with chosen values needs a reason to become the final', async () => {
  const { call } = await setup();
  const s1 = snap(Q, [['P1', 1000, 'Sample A'], ['P2', 1000, 'Sample B']], 1800, { prov: 1, choices: { P1: { c: { m: 'tmp' } } } });
  const v1 = (await call('gm', { action: 'save', quarter: Q, expect_rev: 0, kind: 'provisional', snap: s1 })).body;
  assert.equal((await call('gm', { action: 'confirm', quarter: Q, expect_rev: v1.rev, ver: 1 })).body.error, 'why_required');
  assert.equal((await call('gm', { action: 'confirm', quarter: Q, expect_rev: v1.rev, ver: 1, why: '  ' })).body.error, 'why_required');
  const c = (await call('gm', { action: 'confirm', quarter: Q, expect_rev: v1.rev, ver: 1, why: '支給日に間に合わせる' })).body;
  assert.equal(c.ver, 2);
  const g = (await call('office', { action: 'get', quarter: Q })).body;
  assert.equal(g.versions[1].has_prov, true);
  assert.equal(g.versions[1].why, '支給日に間に合わせる');
});

test('the anon key is not a sign-in: refused without asking Auth', async () => {
  const seen = [];
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k];
  const handler = createHandler({ env, db: { rpc: async () => { throw new Error('no db'); } }, fetch: async (url, init) => { seen.push(init.headers.authorization); return Response.json({ id: U.gm }); } });
  const r = await handler(new Request('https://fn.test/bonus-close', { method: 'POST', headers: { authorization: 'Bearer anon-key', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'get', quarter: Q }) }));
  assert.equal(r.status, 401);
  assert.deepEqual(seen, [], 'Auth was not asked with the anon key');
  const r2 = await handler(new Request('https://fn.test/bonus-close', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'get', quarter: Q }) }));
  assert.equal(r2.status, 401);
});
