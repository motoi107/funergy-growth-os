// v1197（UI案96 の 6B・Moto さん 11/18「6 B」）：「画面の表示」の店のタブレットの列（tab）。合成データだけ（本番には接続しない）。確かめること：
//  1. 中身の形（pvCheck）：tab の列は中タブ（p:）だけ（カード c: と G1 の大タブ g1: は断る）。ほかの列は今まで
//  2. pv_tab（ログインを確かめない・店舗の PIN のタブレットのため）：列だけを返す（人の例外・指定スタッフ限定・だれが保存したかは返さない）。
//     行が無い・止めた・形が合わない・SQL の前・DB の失敗。ログインの確かめ（work-requests・Auth）を呼ばない
//  3. pv_full に tabok:1（アプリはこれが無い関数には列を送らない）・pv_save で tab の列を書ける（本物の SQL・PGlite）・pv_get は列を全部返すまま
//  4. db/page-view-tab-drop.sql：cols.tab だけを外し、記録を 1 行・無ければ何もしない・2 回流しても同じ
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from './runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { createHandler, pvCheck, PV_COLS } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, JWT } from './lib/secure-state-world.mjs';

const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG = rd('supabase/migrations/20261211090000_pv_doc.sql');
const DROP = rd('db/page-view-tab-drop.sql');

const DOC = {
  v: 1,
  cols: { g2: { 'p:budget': 'h' }, tab: { 'p:menu': 's', 'p:vacation': 'h', 'p:store_cmd': 's' } },
  people: { 'E-4': { 'p:budget': 's' } },
  only: { 'p:hiring': ['E-4'] },
};

test('pvCheck: the tablet column takes screens (p:) only; the other columns are as before', () => {
  assert.ok(PV_COLS.includes('tab'));
  assert.deepEqual(pvCheck(DOC), { ...DOC, off: false });
  assert.equal(pvCheck({ v: 1, cols: { tab: { 'c:times': 's' } } }), null, 'no My Page cards on a tablet');
  assert.equal(pvCheck({ v: 1, cols: { tab: { 'g1:g_store': 'h' } } }), null, 'no G1 groups');
  assert.equal(pvCheck({ v: 1, cols: { tab: { 'p:menu': 'x' } } }), null);
  assert.equal(pvCheck({ v: 1, cols: { tab: { 'p:ar_settings': 's' } } }), null, 'fixed screens stay out');
  assert.equal(pvCheck({ v: 1, cols: { tablet: { 'p:menu': 's' } } }), null, 'unknown column');
  assert.ok(pvCheck({ v: 1, cols: { g2: { 'c:times': 'h' } } }), 'cards still fine for the other columns');
});

async function mkdb() {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  return db;
}
async function as(db, role, sql, params) {
  await db.exec('set role ' + role);
  try { return await db.query(sql, params || []); } finally { await db.exec('reset role'); }
}
const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-4', name: 'Leo Four', store: 'S1', role: 'g4', title: 'Store Manager' },
  { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew' },
];
const U1 = 'bbbbbbbb-0000-0000-0000-000000000001';
const ME = {
  gm: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M' },
  g4: { emp: 'E-4', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Leo Four', confirmed: true },
};
async function setup(o = {}) {
  const db = await mkdb();
  if (o.sql !== false) await db.exec(MIG);
  const W = makeWorld({ emps: EMPS.map(e => ({ ...e })), mgr: { [U1]: { role: 'gm', emp_id: 'E-GM' } }, users: { gm: U1 }, wrPeople: [], pins: Object.fromEntries(Object.entries(ME).map(([k, v]) => ['t' + k, v])) });
  const base = W.fetch;
  const J = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json' } });
  const calls = [];
  W.fetch = async (u, opt = {}) => {
    const url = new URL(u), p = url.pathname;
    calls.push(p);
    if (o.dbFail && p.startsWith('/rest/v1/pv_')) return J({ message: 'boom' }, 500);
    if (!p.startsWith('/rest/v1/pv_') && p !== '/rest/v1/rpc/pv_save') return base(u, opt);
    const h = Object.fromEntries(Object.entries(opt.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    assert.equal(h.apikey, SERVICE, 'pv_* is read with the server key only');
    if (o.sql === false) return J({ code: 'PGRST205' }, 404);
    if (p === '/rest/v1/rpc/pv_save') {
      const b = JSON.parse(opt.body);
      const r = await as(db, 'service_role', 'select public.pv_save($1::jsonb, $2, $3, $4::jsonb, $5, $6, $7) r',
        [JSON.stringify(b.p_doc), b.p_expect, b.p_reason, JSON.stringify(b.p_summary), b.p_by_emp, b.p_by_name, b.p_by_role]);
      return J(r.rows[0].r);
    }
    if (p === '/rest/v1/pv_doc') {
      const r = await as(db, 'service_role', 'select doc, ver, updated_at, by_name, by_role from public.pv_doc where id = 1');
      return J(r.rows.map(x => ({ ...x, updated_at: new Date(x.updated_at).toISOString() })));
    }
    throw new Error('unexpected ' + u);
  };
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  const handle = createHandler({ env, fetch: W.fetch, now: () => Date.UTC(2026, 10, 19, 10, 0, 0) });
  const call = async (body, hdr = {}) => {
    const r = await handle(new Request('https://fn.test/secure-state', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ANON, ...hdr }, body: JSON.stringify(body) }));
    let j = null; try { j = await r.json(); } catch { j = null; }
    return { status: r.status, j };
  };
  const pin = (who, body) => call({ ...body, pin_session: 't' + who });
  const email = body => call(body, { authorization: 'Bearer ' + JWT('gm') });
  return { db, call, pin, email, calls };
}

test('pv_tab without a sign-in: only the tablet column; never people, the selected-staff lists or who saved; no sign-in check is called', async () => {
  const S = await setup();
  const t0 = await S.call({ action: 'pv_tab' });
  assert.equal(t0.status, 200); assert.equal(t0.j.pv, null); assert.equal(t0.j.pvfn, 1);
  const f0 = await S.email({ action: 'pv_full' });
  assert.equal(f0.status, 200); assert.equal(f0.j.tabok, 1, 'pv_full says the function takes the tablet column');
  const s1 = await S.email({ action: 'pv_save', doc: DOC, expect: 0, reason: '店のタブレットにメニューを足す' });
  assert.equal(s1.status, 200, JSON.stringify(s1.j)); assert.equal(s1.j.ver, 1);
  S.calls.length = 0;
  const t1 = await S.call({ action: 'pv_tab' });
  assert.equal(t1.status, 200);
  assert.deepEqual(Object.keys(t1.j.pv).sort(), ['at', 'col', 'ver']);
  assert.deepEqual(t1.j.pv.col, DOC.cols.tab); assert.equal(t1.j.pv.ver, 1);
  const txt = JSON.stringify(t1.j);
  for (const x of ['E-4', 'p:hiring', 'Gina', 'p:budget']) assert.ok(!txt.includes(x), x + ' leaked');
  assert.ok(!S.calls.some(p => /work-requests|auth\/v1/.test(p)), 'no sign-in check: ' + S.calls.join(' '));
  // also with a stray PIN mark or another person's email sign-in: the same answer (it does not depend on who asks)
  assert.deepEqual((await S.pin('g4', { action: 'pv_tab' })).j.pv, t1.j.pv);
  // pv_get still returns every column (columns are not secret) and the person's own exception only
  const g = await S.pin('g4', { action: 'pv_get' });
  assert.deepEqual(g.j.pv.cols.tab, DOC.cols.tab); assert.deepEqual(g.j.pv.mine, { 'p:budget': 's' });
  // a document without the tablet column gives an empty column
  const s2 = await S.email({ action: 'pv_save', doc: { v: 1, cols: { g2: { 'p:budget': 'h' } } }, expect: 1, reason: '列を消す' });
  assert.equal(s2.status, 200);
  assert.deepEqual((await S.call({ action: 'pv_tab' })).j.pv.col, {});
  // turned off → off; a shape the function cannot read → broken
  await S.db.exec(`update public.pv_doc set doc = jsonb_set(doc, '{off}', 'true') where id = 1`);
  const t3 = await S.call({ action: 'pv_tab' }); assert.equal(t3.j.pv, null); assert.equal(t3.j.off, true);
  await S.db.exec(`update public.pv_doc set doc = '{"v":1,"off":false,"cols":{"tab":{"c:times":"s"}}}' where id = 1`);
  const t4 = await S.call({ action: 'pv_tab' }); assert.equal(t4.j.pv, null); assert.equal(t4.j.broken, true);
});

test('pv_tab before the SQL is nosql; a database failure is a 500 without details; a bad tablet column is refused on save', async () => {
  const A = await setup({ sql: false });
  const t = await A.call({ action: 'pv_tab' }); assert.equal(t.status, 200); assert.equal(t.j.nosql, true); assert.equal(t.j.pv, null);
  const B = await setup({ dbFail: true });
  const e = await B.call({ action: 'pv_tab' }); assert.equal(e.status, 500); assert.deepEqual(Object.keys(e.j).filter(k => !/fn$|^sw2$/.test(k)), ['error']);
  const C = await setup();
  const s = await C.email({ action: 'pv_save', doc: { v: 1, cols: { tab: { 'c:times': 'h' } } }, expect: 0, reason: 'x' });
  assert.equal(s.status, 400);
  // only the CEO and GM save (the tablet column too)
  const s2 = await C.pin('g4', { action: 'pv_save', doc: DOC, expect: 0, reason: 'x' });
  assert.equal(s2.status, 403);
});

test('db/page-view-tab-drop.sql removes only the tablet column, logs one row, and does nothing without it (twice is the same)', async () => {
  const db = await mkdb();
  await db.exec(DROP);   // 表が無い：何もしない
  await db.exec(MIG);
  await db.exec(DROP);   // 行が無い：何もしない
  assert.equal((await db.query('select count(*)::int n from public.pv_log')).rows[0].n, 0);
  await as(db, 'service_role', `select public.pv_save($1::jsonb, 0, 'r', '[]'::jsonb, 'E-GM', 'Gina M', 'gm')`, [JSON.stringify(pvCheck(DOC))]);
  await db.exec(DROP);
  const r = (await db.query('select doc, ver from public.pv_doc where id = 1')).rows[0];
  assert.equal(r.ver, 2);
  assert.deepEqual(r.doc.cols, { g2: { 'p:budget': 'h' } });
  assert.deepEqual(r.doc.people, DOC.people); assert.deepEqual(r.doc.only, DOC.only); assert.equal(r.doc.off, false);
  const log = (await db.query('select via, by_role, before, after from public.pv_log order by id')).rows;
  assert.equal(log.length, 2); assert.equal(log[1].via, 'sql'); assert.deepEqual(log[1].before.cols.tab, DOC.cols.tab); assert.equal(log[1].after.cols.tab, undefined);
  await db.exec(DROP);
  assert.equal((await db.query('select ver from public.pv_doc where id = 1')).rows[0].ver, 2, 'twice is the same');
  assert.ok(pvCheck(r.doc), 'the older function can read the document again');
});
