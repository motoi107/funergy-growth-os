// v1195（UI案96 の段階 2 の ①・Moto さん 11/18「1 B・2 A・3 A・4 A・5 B・6 B・7 B」）：所属の確認（aff_people）。合成データだけ（本番には接続しない）。確かめること：
//  1. SQL（PGlite の本物の PostgreSQL）：公開の鍵は読めない・書けない・aff_save を呼べない・人ごとの版（1 人でも違えば何も書かずに違った人を返す）・
//     同じ中身は書かない・書けば版を 1 つ進めて記録を 1 行（前と後）・2 回流しても同じ・形の違う表で STOP・最初の確かめ・確認の SQL・戻す SQL
//  2. 関数（本物の handler と PGlite）：aff_get は自分の行だけ（ほかの人の社員 ID を返さない）・aff_full／aff_save は GM・CEO だけ（退職した GM も断る）・
//     SQL の前は nosql／not_installed・在籍でない人と知らない店は書かない・ALL／OFFICE は店として受けない・答えにいつも affn:1
//  3. 従業員の個人の欄（piiScope）：v1195 は AM の見える範囲を広げない（所属が OFFICE の人は、応援が担当の店のときだけ。ALL は今までどおり）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from './runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { createHandler, PII_KEY } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, JWT, ts6 } from './lib/secure-state-world.mjs';

const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG = rd('supabase/migrations/20261212090000_aff_people.sql');
const PRE = rd('db/aff-precheck.sql');
const POST = rd('db/aff-postcheck.sql');
const BACK = rd('db/aff-rollback.sql');

// ---------- 1. SQL ----------
async function mkdb() {
  const db = new PGlite();
  // Supabase と同じく、public に作る表と関数は anon・authenticated にも既定で権限が付く（だから SQL は両方から明示的に外す）
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    create table public.employees(id text primary key, name text, store text, status text, data jsonb);
    insert into public.employees(id, name, store, status, data) values
      ('E-1', 'Kai', 'S1', '', '{"store":"S1"}'),
      ('E-2', 'Al', '', '', '{"store":"ALL"}'),
      ('E-3', 'Bo', 'ALL', '', '{}'),
      ('E-4', 'Cy', '', '', '{}'),
      ('E-5', 'Di', '', '', '{"store":"OFFICE"}'),
      ('E-6', 'Ed', '', '', '{"store":"Office"}'),
      ('E-7', 'Fa', '本部', '', '{}'),
      ('E-8', 'Gi', '', '', '{"store":"hq"}'),
      ('E-9', 'Hu', '---', '', '{}'),
      ('E-X', 'Gone', 'ALL', '退職', '{"store":"ALL"}'),
      ('E-Y', 'Gone2', '', '', '{"store":"OFFICE","status":"退職"}');`);
  return db;
}
async function as(db, role, sql, params) {
  await db.exec('set role ' + role);
  try { return await db.query(sql, params || []); } finally { await db.exec('reset role'); }
}
const saveSql = (db, items, reason = '', role = 'service_role') =>
  as(db, role, `select public.aff_save($1::jsonb, $2, 'E-GM', 'Gina M', 'gm') r`, [JSON.stringify(items), reason]).then(x => x.rows[0].r);
const table = async (db, sql) => { const out = []; const rs = await db.exec(sql); for (const r of rs) if (r.fields && r.fields.some(f => f.name === 'ok')) out.push(...r.rows); return out; };
const rowsOf = async db => (await as(db, 'service_role', 'select emp_id, aff, store, support, ver, by_name from public.aff_people order by emp_id')).rows;
const logOf = async db => (await as(db, 'service_role', 'select emp_id, emp_name, ver, reason, before, after, via, by_role from public.aff_log order by id')).rows;

test('SQL: the public keys cannot read, write or call; versions per person, conflict writes nothing, same, log with before and after; twice is the same', async () => {
  const db = await mkdb();
  const pre = await table(db, PRE);
  assert.ok(pre.every(r => r.ok !== 'STOP' && !/NG/.test(r.ok)), JSON.stringify(pre));
  const v = n => pre.find(r => r.n === n).value;
  assert.equal(v(3), '2 人');   // ALL（退職の E-X は数えない）
  assert.equal(v(4), '1 人');   // 空
  assert.equal(v(5), '2 人');   // OFFICE・Office（退職の E-Y は数えない）
  assert.equal(v(6), '3 人');   // 本部・hq・---
  assert.equal(v(7), 'まだ無い');
  await db.exec(MIG);
  await db.exec(MIG);   // 2 回目も通る
  for (const role of ['anon', 'authenticated']) {
    for (const sql of ['select * from public.aff_people', 'select * from public.aff_log', `insert into public.aff_people(emp_id, aff) values ('E-1', 'hq')`,
                       `insert into public.aff_log(emp_id, ver, after) values ('E-1', 1, '{}')`, `update public.aff_people set ver = 9`,
                       `select public.aff_save('[{"emp":"E-1","aff":"hq","store":"","support":[],"expect":0}]', '', null, null, null)`,
                       `select nextval('public.aff_log_id_seq')`])
      await assert.rejects(as(db, role, sql), /permission denied/, role + ' ' + sql);
  }
  // 行が無い人に 0 でない版 → 書かない（違った人を返す）
  assert.deepEqual(await saveSql(db, [{ emp: 'E-1', aff: 'store', store: 'S1', support: [], expect: 2 }]), { ok: false, conflict: true, ids: ['E-1'] });
  assert.equal((await rowsOf(db)).length, 0);
  const r1 = await saveSql(db, [
    { emp: 'E-1', name: 'Kai', aff: 'store', store: 'S1', support: ['S2'], expect: 0 },
    { emp: 'E-5', name: 'Di', aff: 'hq', store: '', support: [], expect: 0 },
  ], '初めの確認');
  assert.equal(r1.ok, true); assert.equal(r1.same, 0);
  assert.deepEqual(r1.rows, [{ emp: 'E-1', ver: 1 }, { emp: 'E-5', ver: 1 }]);
  // 1 人でも版が違えば、だれも書かない（全員まとめて 1 回）
  const c = await saveSql(db, [
    { emp: 'E-1', aff: 'hq', store: '', support: [], expect: 1 },
    { emp: 'E-5', aff: 'store', store: 'S3', support: [], expect: 0 },     // 古い版
    { emp: 'E-7', aff: 'hq', store: '', support: [], expect: 4 },          // 行が無いのに 0 でない
  ], '古い画面');
  assert.deepEqual(c, { ok: false, conflict: true, ids: ['E-5', 'E-7'] });
  assert.deepEqual((await rowsOf(db)).map(x => [x.emp_id, x.aff, x.store, x.ver]), [['E-1', 'store', 'S1', 1], ['E-5', 'hq', '', 1]]);
  // 同じ中身は書かない（記録も足さない）・違う人だけ書く
  const r2 = await saveSql(db, [
    { emp: 'E-1', aff: 'store', store: 'S1', support: ['S2'], expect: 1 },
    { emp: 'E-5', name: 'Di', aff: 'store', store: 'S3', support: ['S1'], expect: 1 },
  ], '本部から S3 へ');
  assert.equal(r2.same, 1);
  assert.deepEqual(r2.rows, [{ emp: 'E-1', ver: 1, same: true }, { emp: 'E-5', ver: 2 }]);
  const rows = await rowsOf(db);
  assert.deepEqual(rows.map(x => [x.emp_id, x.aff, x.store, x.support, x.ver, x.by_name]),
    [['E-1', 'store', 'S1', ['S2'], 1, 'Gina M'], ['E-5', 'store', 'S3', ['S1'], 2, 'Gina M']]);
  const log = await logOf(db);
  assert.deepEqual(log.map(x => [x.emp_id, x.ver, x.reason, x.via, x.by_role]),
    [['E-1', 1, '初めの確認', 'fn', 'gm'], ['E-5', 1, '初めの確認', 'fn', 'gm'], ['E-5', 2, '本部から S3 へ', 'fn', 'gm']]);
  assert.equal(log[0].emp_name, 'Kai');
  assert.equal(log[0].before, null, 'a new row has no before');
  assert.deepEqual(log[1].after, { aff: 'hq', store: '', support: [] });
  assert.deepEqual(log[2].before, { aff: 'hq', store: '', support: [] }, 'before is the row as it was (not changed by the update)');
  assert.deepEqual(log[2].after, { aff: 'store', store: 'S3', support: ['S1'] });
  // 形の合わない頼み（関数は先に確かめるが、ここでも断る）
  const bad = [
    [], 'x', Array.from({ length: 201 }, (_, i) => ({ emp: 'E-' + i, aff: 'hq', store: '', support: [], expect: 0 })),
    [1], [{ aff: 'hq', store: '', support: [], expect: 0 }], [{ emp: '', aff: 'hq', store: '', support: [], expect: 0 }],
    [{ emp: 'E-1', aff: 'hq', store: '', support: [], expect: 1 }, { emp: 'E-1', aff: 'hq', store: '', support: [], expect: 1 }],
    [{ emp: 'E-1', aff: 'boss', store: '', support: [], expect: 1 }], [{ emp: 'E-1', aff: 'hq', store: 'S1', support: [], expect: 1 }],
    [{ emp: 'E-1', aff: 'store', store: '', support: [], expect: 1 }], [{ emp: 'E-1', aff: 'store', store: 'S'.repeat(33), support: [], expect: 1 }],
    [{ emp: 'E-1', aff: 'store', store: 'S1', support: 'S2', expect: 1 }], [{ emp: 'E-1', aff: 'store', store: 'S1', support: [2], expect: 1 }],
    [{ emp: 'E-1', aff: 'store', store: 'S1', support: [''], expect: 1 }], [{ emp: 'E-1', aff: 'store', store: 'S1', support: Array.from({ length: 21 }, (_, i) => 'S' + i), expect: 1 }],
    [{ emp: 'E-1', aff: 'store', store: 'S1', support: [], expect: '1' }], [{ emp: 'E-1', aff: 'store', store: 'S1', support: [], expect: -1 }],
  ];
  for (const items of bad) await assert.rejects(saveSql(db, items), /aff_bad/, JSON.stringify(items).slice(0, 80));
  await assert.rejects(saveSql(db, [{ emp: 'E-1', aff: 'hq', store: '', support: [], expect: 1 }], 'x'.repeat(501)), /aff_bad_reason/);
  assert.equal((await logOf(db)).length, 3, 'nothing written by the refused calls');
  await db.exec(MIG);   // 行があっても流し直せる・行と版は変えない
  assert.deepEqual((await rowsOf(db)).map(x => x.ver), [1, 2]);
  const post = await table(db, POST);
  assert.ok(post.every(r => r.ok === 'OK' || r.ok === 'info'), JSON.stringify(post));
  assert.equal(post.find(r => r.n === 6).value, '2 人');
  assert.match(post.find(r => r.n === 7).value, /conflict/);
  assert.equal((await logOf(db)).length, 3, 'the postcheck wrote nothing');
  assert.equal((await rowsOf(db)).length, 2);
  const pre2 = await table(db, PRE);
  assert.equal(pre2.find(r => r.n === 1).ok, 'OK（2 回目）');
  assert.equal(pre2.find(r => r.n === 7).value, 'もうある');
});

test('SQL: a table aff_people of another shape stops the migration (nothing changes); the rollback drops the function and keeps the rows', async () => {
  const db = await mkdb();
  await db.exec('create table public.aff_people(emp_id text primary key, support text)');
  await assert.rejects(db.exec(MIG), /STOP/);
  const pre = await table(db, PRE);
  assert.equal(pre.find(r => r.n === 1).ok, 'STOP（形が違う）');
  assert.equal((await db.query(`select to_regclass('public.aff_log') t`)).rows[0].t, null);
  const db2 = await mkdb();
  await db2.exec(`create table public.aff_log(id bigserial primary key, after text)`);
  await assert.rejects(db2.exec(MIG), /STOP/);
  assert.equal((await db2.query(`select to_regclass('public.aff_people') t`)).rows[0].t, null);
  // 戻す
  const db3 = await mkdb();
  await db3.exec(MIG);
  await saveSql(db3, [{ emp: 'E-1', aff: 'hq', store: '', support: [], expect: 0 }]);
  await db3.exec(BACK); await db3.exec(BACK);
  assert.equal((await db3.query(`select to_regprocedure('public.aff_save(jsonb,text,text,text,text)') p`)).rows[0].p, null);
  assert.equal((await rowsOf(db3)).length, 1, 'the rows stay');
  assert.equal((await logOf(db3)).length, 1, 'the log stays');
  const post = await table(db3, POST);
  assert.equal(post.find(r => r.n === 4).ok, 'NG', 'the postcheck sees the function is gone');
  assert.equal(post.find(r => r.n === 7).value, '関数が無い');
  await db3.exec(MIG);   // もう一度入れられる
  assert.equal((await rowsOf(db3))[0].ver, 1);
});

// ---------- 2. 関数 ----------
const D = (name, store, extra = {}) => ({ name, store, ...extra });
const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'OFFICE', role: 'gm', title: 'General Manager', data: D('Gina M', 'OFFICE') },
  { id: 'E-CEO', name: 'Cal E', store: 'ALL', role: 'ceo', title: '', data: D('Cal E', 'ALL') },
  { id: 'E-GMX', name: 'Gone GM', store: 'ALL', role: 'gm', title: 'General Manager', status: '退職', data: D('Gone GM', 'ALL', { status: '退職' }) },
  { id: 'E-OF', name: 'Ofelia', store: 'ALL', role: 'office', title: 'Accountant', data: D('Ofelia', 'ALL') },
  { id: 'E-AM', name: 'Amy Area', store: 'S1', role: 'am', title: 'Area Manager', data: D('Amy Area', 'S1') },
  { id: 'E-4', name: 'Leo Four', store: 'S1', role: 'g4', title: 'Store Manager', data: D('Leo Four', 'S1') },
  { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew', data: D('Kai One', 'S1') },
  { id: 'E-OUT', name: 'Gone Crew', store: 'S2', role: 'crew', title: 'Crew', status: '退職', data: D('Gone Crew', 'S2', { status: '退職' }) },
  { id: 'E-OS', name: 'Off Switch', store: 'S2', role: 'crew', title: 'Crew', data: D('Off Switch', 'S2', { osDisabled: true }) },
  { id: 'E-COL', name: 'Col Only', store: 'S2', role: 'crew', title: 'Crew', data: {} },   // 中身に名前の無い行（列の名前を使う）
];
// 店舗マスターに ALL・OFFICE の行があっても、店としては受けない（関数の二重の確かめ）
const STORES = [{ id: 'S1' }, { id: 'S2' }, { id: 'S3' }, { id: 'F03+F03-G' }, { id: 'ALL' }, { id: 'OFFICE' }, { id: 'Office' }];
const U = n => 'cccccccc-0000-0000-0000-00000000000' + n;
const MGR = { [U(1)]: { role: 'gm', emp_id: 'E-GM' }, [U(2)]: { role: 'office', emp_id: 'E-OF' }, [U(3)]: { role: 'ceo', emp_id: 'E-CEO' } };
const USERS = { gm: U(1), of: U(2), ceo: U(3) };
const ME = {
  gm: { emp: 'E-GM', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gina M' },
  ceo: { emp: 'E-CEO', role: 'ceo', grade: 7, stores: [], am_stores: [], name: 'Cal E' },
  gmx: { emp: 'E-GMX', role: 'gm', grade: 6, stores: [], am_stores: [], name: 'Gone GM' },
  of: { emp: 'E-OF', role: 'office', grade: 4, stores: [], am_stores: [], name: 'Ofelia' },
  am: { emp: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1'], name: 'Amy Area', confirmed: true },
  g4: { emp: 'E-4', role: 'staff', grade: 4, stores: ['S1'], am_stores: [], name: 'Leo Four', confirmed: true },
  g1: { emp: 'E-1', role: 'staff', grade: 1, stores: ['S1'], am_stores: [], name: 'Kai One' },
};

// PostgREST の aff_* だけを PGlite に渡す偽物（ほかは secure-state-world の偽物）。sql:false なら aff_* は 404（SQL の前）
async function setup(o = {}) {
  const db = await mkdb();
  if (o.sql !== false) await db.exec(MIG);
  const W = makeWorld({ emps: EMPS.map(e => JSON.parse(JSON.stringify(e))), mgr: MGR, users: USERS, stores: STORES.map(s => ({ ...s })), wrPeople: [],
    pins: Object.fromEntries(Object.entries(ME).map(([k, v]) => ['t' + k, v])), ...(o.world || {}) });
  const base = W.fetch;
  const J = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json' } });
  const affCalls = [];
  W.fetch = async (u, opt = {}) => {
    const url = new URL(u), p = url.pathname, q = url.searchParams;
    if (!p.startsWith('/rest/v1/aff_') && p !== '/rest/v1/rpc/aff_save') return base(u, opt);
    const h = Object.fromEntries(Object.entries(opt.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    assert.equal(h.apikey, SERVICE, 'aff_* is read with the server key only');
    affCalls.push(p + url.search);
    const miss = () => J({ code: 'PGRST205', message: 'not found' }, 404);
    try {
      if (p === '/rest/v1/rpc/aff_save') {
        if (o.sql === false) return J({ code: 'PGRST202' }, 404);
        const b = JSON.parse(opt.body);
        assert.deepEqual(Object.keys(b).sort(), ['p_by_emp', 'p_by_name', 'p_by_role', 'p_items', 'p_reason']);
        const r = await as(db, 'service_role', 'select public.aff_save($1::jsonb, $2, $3, $4, $5) r', [JSON.stringify(b.p_items), b.p_reason, b.p_by_emp, b.p_by_name, b.p_by_role]);
        return J(r.rows[0].r);
      }
      if (o.sql === false) return miss();
      const cols = q.get('select').split(',');
      assert.ok(cols.every(c => /^[a-z_]+$/.test(c)));
      if (p === '/rest/v1/aff_people') {
        let sql = 'select ' + cols.join(',') + ' from public.aff_people', args = [];
        if (q.get('emp_id')) { assert.ok(q.get('emp_id').startsWith('eq.')); sql += ' where emp_id = $1'; args = [q.get('emp_id').slice(3)]; }
        if (q.get('order') === 'emp_id.asc') sql += ' order by emp_id';
        if (q.get('limit')) sql += ' limit ' + Number(q.get('limit'));
        const r = await as(db, 'service_role', sql, args);
        return J(r.rows.map(x => ({ ...x, updated_at: x.updated_at && new Date(x.updated_at).toISOString() })));
      }
      if (p === '/rest/v1/aff_log') {
        let sql = 'select ' + cols.join(',') + ' from public.aff_log';
        if (q.get('order') === 'id.desc') sql += ' order by id desc';
        if (q.get('limit')) sql += ' limit ' + Number(q.get('limit'));
        const r = await as(db, 'service_role', sql);
        return J(r.rows.map(x => ({ ...x, id: Number(x.id), at: x.at && new Date(x.at).toISOString() })));
      }
    } catch (e) { return J({ message: String(e.message || e) }, 400); }
    throw new Error('unexpected ' + u);
  };
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  const handle = createHandler({ env, fetch: W.fetch, now: () => Date.UTC(2026, 10, 18, 10, 0, 0) });
  const call = async (body, hdr = {}) => {
    const r = await handle(new Request('https://fn.test/secure-state', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ANON, ...hdr }, body: JSON.stringify(body) }));
    let j = null; try { j = await r.json(); } catch { j = null; }
    return { status: r.status, j };
  };
  const pin = (who, body) => call({ ...body, pin_session: 't' + who });
  const email = (who, body) => call(body, { authorization: 'Bearer ' + JWT(who) });
  return { db, W, call, pin, email, affCalls };
}
const IT = (emp, aff, store, support, expect) => ({ emp, aff, store, support, expect });

test('before the SQL: aff_get gives row:null with nosql; aff_full nosql; saving says not_installed; the answer has affn:1', async () => {
  const S = await setup({ sql: false });
  const g = await S.pin('g1', { action: 'aff_get' });
  assert.equal(g.status, 200); assert.equal(g.j.row, null); assert.equal(g.j.nosql, true); assert.equal(g.j.affn, 1); assert.equal(g.j.pvfn, 1);
  const f = await S.pin('gm', { action: 'aff_full' });
  assert.equal(f.status, 200); assert.equal(f.j.nosql, true); assert.deepEqual(f.j.rows, []);
  const s = await S.pin('gm', { action: 'aff_save', items: [IT('E-1', 'store', 'S1', [], 0)] });
  assert.equal(s.status, 503); assert.equal(s.j.error, 'not_installed'); assert.equal(s.j.affn, 1);
});

test('GM and CEO save with the version they read per person; a stale version is 409 with the people; same contents are not written; others are refused', async () => {
  const S = await setup();
  for (const who of ['am', 'g4', 'g1', 'of', 'gmx']) {
    for (const act of [{ action: 'aff_full' }, { action: 'aff_save', items: [IT('E-1', 'store', 'S1', [], 0)] }]) {
      const r = await S.pin(who, act);
      assert.equal(r.status, 403, who + ' ' + act.action); assert.equal(r.j.error, 'forbidden');
    }
  }
  assert.equal((await S.email('of', { action: 'aff_save', items: [IT('E-1', 'store', 'S1', [], 0)] })).status, 403, 'office by email');
  assert.equal((await S.call({ action: 'aff_get' })).status, 401, 'no login');
  assert.equal((await S.call({ action: 'aff_get', pin_session: 'tnobody' })).status, 401, 'store login / unknown PIN');
  assert.equal(S.affCalls.filter(c => c.startsWith('/rest/v1/rpc')).length, 0, 'the refused people never reached the SQL');

  const s1 = await S.pin('gm', { action: 'aff_save', reason: '初めの確認', items: [IT('E-1', 'store', 'S1', ['S2'], 0), IT('E-OF', 'hq', '', [], 0), IT('E-COL', 'store', 'F03+F03-G', [], 0)] });
  assert.equal(s1.status, 200, JSON.stringify(s1.j)); assert.equal(s1.j.ok, true); assert.equal(s1.j.same, 0); assert.equal(s1.j.affn, 1);
  assert.deepEqual(s1.j.rows, [{ emp: 'E-1', ver: 1 }, { emp: 'E-OF', ver: 1 }, { emp: 'E-COL', ver: 1 }]);
  const log0 = (await as(S.db, 'service_role', 'select emp_id, emp_name, by_emp, by_name, by_role, reason from public.aff_log order by id')).rows;
  assert.deepEqual(log0.map(x => [x.emp_id, x.emp_name, x.by_emp, x.by_name, x.by_role, x.reason]),
    [['E-1', 'Kai One', 'E-GM', 'Gina M', 'gm', '初めの確認'], ['E-OF', 'Ofelia', 'E-GM', 'Gina M', 'gm', '初めの確認'], ['E-COL', 'Col Only', 'E-GM', 'Gina M', 'gm', '初めの確認']]);
  // 古い画面（E-1 は版 1 になった）・ほかの人は合っている → だれも書かない・違った人だけ返す
  const c = await S.email('ceo', { action: 'aff_save', items: [IT('E-4', 'store', 'S1', [], 0), IT('E-1', 'hq', '', [], 0)] });
  assert.equal(c.status, 409); assert.equal(c.j.error, 'conflict'); assert.deepEqual(c.j.ids, ['E-1']);
  assert.equal((await as(S.db, 'service_role', `select count(*)::int n from public.aff_people where emp_id = 'E-4'`)).rows[0].n, 0, 'nobody written on conflict');
  // 同じ中身は書かない
  const s2 = await S.email('ceo', { action: 'aff_save', items: [IT('E-1', 'store', 'S1', ['S2'], 1), IT('E-4', 'store', 'S1', [], 0)] });
  assert.equal(s2.status, 200); assert.equal(s2.j.same, 1);
  assert.deepEqual(s2.j.rows, [{ emp: 'E-1', ver: 1, same: true }, { emp: 'E-4', ver: 1 }]);
  // 形・中身の確かめ（400）
  const bad = [
    [{ items: [] }, 'empty'], [{ items: 'x' }, 'not a list'], [{ items: Array.from({ length: 201 }, (_, i) => IT('E-' + i, 'hq', '', [], 0)) }, '201 people'],
    [{ items: [1] }, 'not an object'], [{ items: [IT('', 'hq', '', [], 0)] }, 'no emp'], [{ items: [IT('_x', 'hq', '', [], 0)] }, 'emp starting with _'],
    [{ items: [IT('E-1', 'hq', '', [], 1), IT('E-1', 'hq', '', [], 1)] }, 'same person twice'], [{ items: [IT('E-1', 'boss', '', [], 1)] }, 'aff'],
    [{ items: [IT('E-1', 'hq', 'S1', [], 1)] }, 'hq with a store'], [{ items: [IT('E-1', 'store', '', [], 1)] }, 'store without a store'],
    [{ items: [IT('E-1', 'store', 'ALL', [], 1)] }, 'ALL is not a store'], [{ items: [IT('E-1', 'store', 'office', [], 1)] }, 'office is not a store'], [{ items: [IT('E-1', 'store', 'OFFICE', [], 1)] }, 'OFFICE is not a store'], [{ items: [IT('E-1', 'store', 'Office', [], 1)] }, 'Office is not a store'],
    [{ items: [IT('E-1', 'store', 'S1', ['OFFICE'], 1)] }, 'OFFICE as support'],
    [{ items: [IT('E-1', 'store', 'S1', ['ALL'], 1)] }, 'ALL as support'], [{ items: [IT('E-1', 'store', 'S1', ['S1'], 1)] }, 'own store as support'],
    [{ items: [IT('E-1', 'store', 'S1', ['S2', 'S2'], 1)] }, 'support twice'], [{ items: [IT('E-1', 'store', 'S1', 'S2', 1)] }, 'support not a list'],
    [{ items: [IT('E-1', 'store', 'S 1', [], 1)] }, 'odd store id'], [{ items: [IT('E-1', 'store', 'S1', [], -1)] }, 'expect -1'],
    [{ items: [IT('E-1', 'store', 'S1', [], 1.5)] }, 'expect 1.5'], [{ items: [IT('E-1', 'store', 'S1', [], '1')] }, 'expect string'],
    [{ items: [IT('E-1', 'store', 'S9', [], 1)] }, 'store not in the store master'], [{ items: [IT('E-1', 'store', 'S1', ['S9'], 1)] }, 'support not in the store master'],
    [{ items: [IT('E-1', 'store', 'S1', [], 1)], reason: 3 }, 'reason not text'], [{ items: [IT('E-1', 'store', 'S1', [], 1)], reason: 'x'.repeat(501) }, 'reason too long'],
  ];
  for (const [b, why] of bad) {
    const r = await S.pin('gm', { action: 'aff_save', ...b });
    assert.equal(r.status, 400, why); assert.equal(r.j.error, 'bad_value', why);
  }
  // 在籍でない人・知らない人（端末の名簿が古くても）：書かない
  for (const emp of ['E-OUT', 'E-OS', 'E-NOBODY']) {
    const r = await S.pin('gm', { action: 'aff_save', items: [IT('E-1', 'store', 'S1', ['S2'], 1), IT(emp, 'store', 'S2', [], 0)] });
    assert.equal(r.status, 404, emp); assert.equal(r.j.error, 'not_found', emp);
  }
  // 店舗マスターが読めない：書かない
  S.W.storesDown = true;
  assert.equal((await S.pin('gm', { action: 'aff_save', items: [IT('E-1', 'hq', '', [], 1)] })).status, 500);
  S.W.storesDown = false;
  assert.equal((await as(S.db, 'service_role', 'select count(*)::int n from public.aff_log')).rows[0].n, 4, 'nothing written by the refused calls');
  // 全部を読む（GM・CEO）：行と記録
  const f = await S.pin('gm', { action: 'aff_full' });
  assert.equal(f.status, 200);
  assert.deepEqual(f.j.rows.map(x => [x.emp_id, x.aff, x.store, x.support, x.ver]),
    [['E-1', 'store', 'S1', ['S2'], 1], ['E-4', 'store', 'S1', [], 1], ['E-COL', 'store', 'F03+F03-G', [], 1], ['E-OF', 'hq', '', [], 1]]);
  assert.equal(f.j.log.length, 4); assert.equal(f.j.log[0].emp_id, 'E-4', 'newest first'); assert.ok(f.j.log[0].at);
  assert.equal((await S.email('ceo', { action: 'aff_full' })).j.rows.length, 4);
});

test('aff_get: my own row only; nothing about the other people; null when not decided or when the login has no employee', async () => {
  const S = await setup();
  await S.pin('gm', { action: 'aff_save', items: [IT('E-1', 'store', 'S1', ['S2'], 0), IT('E-OF', 'hq', '', [], 0), IT('E-4', 'store', 'S3', [], 0)] });
  const g1 = (await S.pin('g1', { action: 'aff_get' })).j;
  assert.deepEqual({ ...g1.row, at: !!g1.row.at }, { aff: 'store', store: 'S1', support: ['S2'], ver: 1, at: true });
  const of = (await S.email('of', { action: 'aff_get' })).j;
  assert.deepEqual([of.row.aff, of.row.store, of.row.support], ['hq', '', []]);
  const am = (await S.pin('am', { action: 'aff_get' })).j;
  assert.equal(am.row, null, 'not decided yet');
  for (const j of [g1, of, am]) {
    const t = JSON.stringify(j);
    for (const other of ['E-4', 'S3', 'Leo Four', 'E-OF', 'Gina M', 'by_']) if (!(j === of && other === 'E-OF')) assert.ok(!t.includes(other), other + ' leaked');
  }
  // 社員と結ばれていないメールのアカウント：null（読みに行かない）
  const S2 = await setup({ world: { mgr: { [U(4)]: { role: 'office', emp_id: null } }, users: { ofn: U(4) } } });
  const n = await S2.email('ofn', { action: 'aff_get' });
  assert.equal(n.status, 200); assert.equal(n.j.row, null);
  assert.equal(S2.affCalls.length, 0);
});

// ---------- 3. 従業員の個人の欄：v1195 は AM の範囲を広げない ----------
test('piiScope: v1195 does not widen an AM: OFFICE people only through a supported store; ALL as before', async () => {
  const P = (dob, store) => ({ dob, store });
  const emps = [
    { id: 'E-AM', name: 'Amy Area', store: 'S1', role: 'am', title: 'Area Manager', data: { store: 'S1' } },
    { id: 'E-HQ', name: 'Hana HQ', store: '', role: 'office', title: 'Accountant', data: P('1980-01-01', 'OFFICE') },
    { id: 'E-HQ2', name: 'Hugo HQ', store: 'Office', role: 'office_crew', title: 'Office Crew', data: { dob: '1981-01-01' } },
    { id: 'E-ALL', name: 'Al All', store: 'ALL', role: 'gm', title: 'General Manager', data: P('1970-01-01', 'ALL') },
    { id: 'E-S1', name: 'Sue One', store: 'S1', role: 'crew', title: 'Crew', data: P('1999-01-01', 'S1') },
    { id: 'E-S2', name: 'Sam Two', store: 'S2', role: 'crew', title: 'Crew', data: P('1998-01-01', 'S2') },
    { id: 'E-OFFX', name: 'Not Office', store: 'S2', role: 'crew', title: 'Crew', data: P('1997-01-01', 'OFFICES') },
    { id: 'E-HQS', name: 'Hal Support', store: 'OFFICE', role: 'am', title: 'Area Manager', data: { dob: '1975-01-01', store: 'OFFICE', support: ['S1'] } },
  ];
  const W = makeWorld({ emps, mgr: {}, users: {}, stores: [{ id: 'S1' }, { id: 'S2' }], wrPeople: [],
    pins: { tam: { emp: 'E-AM', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1'], name: 'Amy Area', confirmed: true } } });
  W.set(PII_KEY, {}, ts6(Date.UTC(2026, 10, 18, 9, 0, 0)));
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  const handle = createHandler({ env, fetch: W.fetch, now: () => Date.UTC(2026, 10, 18, 10, 0, 0) });
  const r = await handle(new Request('https://fn.test/secure-state', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ANON },
    body: JSON.stringify({ action: 'pii_get', pin_session: 'tam' }) }));
  const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.level, 'hr');
  assert.deepEqual(Object.keys(j.data || {}).sort(), ['E-ALL', 'E-HQS', 'E-S1']);
});
