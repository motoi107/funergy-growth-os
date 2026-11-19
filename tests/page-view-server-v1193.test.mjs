// v1193（UI案95・Moto さん 11/18「すべて A」）：画面の表示の設定（pv_doc）。合成データだけ（本番には接続しない）。確かめること：
//  1. 中身の形（pvCheck）：列・ノード・固定のもの・人の例外・指定スタッフ限定・大きさ。整えた形（off はいつも true／false）
//  2. ログインした人に返す形（pvProject）：人の例外は自分の分だけ・指定スタッフ限定は自分が入っているかだけ（ほかの人の社員 ID を返さない）
//  3. SQL（PGlite の本物の PostgreSQL）：公開の鍵は読めない・書けない・pv_save を呼べない・読んだ版が違えば書かない・同じなら書かない・
//     書けば版を 1 つ進めて記録を 1 行（前と後）・2 回流しても同じ・最初の確かめ・確認の SQL・止める／もう一度使う・戻す SQL
//  4. 関数（本物の handler と PGlite）：読むのはだれでも（自分の分だけ）・書く・全部を読む・記録は GM・CEO だけ（退職した GM も断る）・
//     SQL の前は nosql・行が無いと null・止めると off・形の合わない中身は broken・答えに pvfn:1
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from './runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { createHandler, pvCheck, pvProject, PV_COLS, PV_NEVER } from '../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, JWT } from './lib/secure-state-world.mjs';

const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG = rd('supabase/migrations/20261211090000_pv_doc.sql');
const PRE = rd('db/page-view-precheck.sql');
const POST = rd('db/page-view-postcheck.sql');
const STOP = rd('db/page-view-stop.sql');
const RESUME = rd('db/page-view-resume.sql');
const BACK = rd('db/page-view-rollback.sql');

const DOC = {
  v: 1,
  cols: { g1: { 'g1:g_tip': 'h', 'c:times': 's' }, g2: { 'p:dashboard': 's', 'p:budget': 'h' }, g4: { 'p:hiring': 's' }, acct: { 'p:skill': 's', 'c:myreq': 'h' } },
  people: { 'E-1': { 'g1:g_tip': 's' }, 'E-4': { 'p:budget': 's' }, 'E-AM': { 'p:skill': 'h' } },
  only: { 'p:hiring': ['E-4', 'E-9'], 'p:lala': ['E-OF'] },
};

// ---------- 1・2. 形 ----------
test('pvCheck: a good document is kept as it is, off becomes a boolean, empty people are dropped', () => {
  const o = pvCheck(DOC);
  assert.deepEqual(o, { ...DOC, off: false });
  assert.equal(pvCheck({ ...DOC, off: true }).off, true);
  assert.deepEqual(pvCheck({ v: 1 }), { v: 1, off: false, cols: {}, people: {}, only: {} });
  assert.deepEqual(pvCheck({ v: 1, people: { 'E-1': {} } }).people, {});
  assert.deepEqual(PV_COLS, ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'am', 'chef', 'acct']);
  for (const k of ['p:ar_settings', 'p:growth_karte', 'p:mid_review', 'p:approval', 'c:secure']) assert.ok(PV_NEVER.includes(k), k);
});

test('pvCheck refuses: unknown keys, another version, CEO/GM columns, pages in the G1 column, G1 groups elsewhere, fixed things, bad values, bad lists, too large', () => {
  const bad = [
    null, [], 'x', { v: 2 }, { v: 1, x: 1 }, { v: 1, off: 'yes' },
    { v: 1, cols: { ceo: {} } }, { v: 1, cols: { gm: { 'p:dashboard': 's' } } }, { v: 1, cols: { G2: {} } }, { v: 1, cols: [] },
    { v: 1, cols: { g1: { 'p:dashboard': 's' } } }, { v: 1, cols: { g2: { 'g1:g_tip': 'h' } } },
    { v: 1, cols: { g2: { 'p:ar_settings': 's' } } }, { v: 1, cols: { g3: { 'p:growth_karte': 'h' } } }, { v: 1, cols: { acct: { 'c:secure': 's' } } },
    { v: 1, cols: { g2: { 'p:Dashboard': 's' } } }, { v: 1, cols: { g2: { 'p:dash-board': 's' } } }, { v: 1, cols: { g2: { 'x:dashboard': 's' } } },
    { v: 1, cols: { g2: { 'p:dashboard': 'show' } } }, { v: 1, cols: { g2: { 'p:dashboard': true } } }, { v: 1, cols: { g2: { 'p:dashboard': null } } },
    { v: 1, people: { 'E 1': { 'p:x': 's' } } }, { v: 1, people: { 'E-1': { 'p:approval': 's' } } }, { v: 1, people: { 'E-1': 'h' } },
    { v: 1, only: { 'p:hiring': [] } }, { v: 1, only: { 'p:hiring': ['E-1', 'E-1'] } }, { v: 1, only: { 'p:hiring': ['bad id'] } },
    { v: 1, only: { 'c:times': ['E-1'] } }, { v: 1, only: { 'g1:g_tip': ['E-1'] } }, { v: 1, only: { 'p:mid_review': ['E-1'] } }, { v: 1, only: { 'p:hiring': 'E-1' } },
    { v: 1, only: { 'p:hiring': Array.from({ length: 501 }, (_, i) => 'E-' + i) } },
    { v: 1, people: Object.fromEntries(Array.from({ length: 3001 }, (_, i) => ['E-' + i, { 'p:x': 's' }])) },
    { v: 1, people: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => ['E-' + i, Object.fromEntries(Array.from({ length: 20 }, (_, j) => ['p:page_' + j, 'h']))])) },
  ];
  for (const d of bad) assert.equal(pvCheck(d), null, JSON.stringify(d).slice(0, 80));
});

test('pvProject: my own exceptions only; for "only" lists, whether I am in it (no other employee IDs leave the function)', () => {
  const d = pvCheck(DOC);
  const p4 = pvProject(d, 'E-4');
  assert.deepEqual(p4, { cols: d.cols, mine: { 'p:budget': 's' }, only: { 'p:hiring': true, 'p:lala': false } });
  const p1 = pvProject(d, 'E-1');
  assert.deepEqual(p1.mine, { 'g1:g_tip': 's' }); assert.deepEqual(p1.only, { 'p:hiring': false, 'p:lala': false });
  for (const p of [p4, p1, pvProject(d, ''), pvProject(d, 'E-OF')]) {
    const t = JSON.stringify(p);
    for (const other of ['E-9', 'E-AM']) assert.ok(!t.includes(other), other + ' leaked');
  }
  assert.deepEqual(pvProject(d, '').mine, {});
});

// ---------- 3. SQL ----------
async function mkdb() {
  const db = new PGlite();
  // Supabase と同じく、public に作る表と関数は anon・authenticated にも既定で権限が付く（だから SQL は両方から明示的に外す）
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    create table public.app_settings(key text primary key, value jsonb, updated_at timestamptz default now());
    insert into public.app_settings(key, value) values ('grade_hide', '{"G2":["budget"]}'), ('role_hide_g2', '["budget"]');`);
  return db;
}
async function as(db, role, sql, params) {
  await db.exec('set role ' + role);
  try { return await db.query(sql, params || []); } finally { await db.exec('reset role'); }
}
const save = (db, doc, expect, reason = 'r', role = 'service_role') =>
  as(db, role, `select public.pv_save($1::jsonb, $2, $3, '[]'::jsonb, 'E-GM', 'Gina M', 'gm') r`, [JSON.stringify(doc), expect, reason]).then(x => x.rows[0].r);
const table = async (db, sql) => { const out = []; const rs = await db.exec(sql); for (const r of rs) if (r.fields && r.fields.some(f => f.name === 'ok')) out.push(...r.rows); return out; };

test('SQL: the public keys cannot read, write or call; versions, same, log with before and after; twice is the same', async () => {
  const db = await mkdb();
  const pre = await table(db, PRE);
  assert.ok(pre.every(r => r.ok !== 'STOP' && !/NG/.test(r.ok)), JSON.stringify(pre));
  assert.equal(pre.find(r => r.n === 3).value, 'ある（object）');
  await db.exec(MIG);
  await db.exec(MIG);   // 2 回目も通る
  for (const role of ['anon', 'authenticated']) {
    for (const sql of ['select * from public.pv_doc', 'select * from public.pv_log', `insert into public.pv_doc(id, doc) values (1, '{}')`,
                       `insert into public.pv_log(ver, reason, after) values (1, 'x', '{}')`, `select public.pv_save('{"v":1}', 0, 'x', '[]', null, null, null)`,
                       `select nextval('public.pv_log_id_seq')`])
      await assert.rejects(as(db, role, sql), /permission denied/, role + ' ' + sql);
  }
  const d1 = pvCheck(DOC);
  assert.deepEqual(await save(db, d1, 5), { ok: false, conflict: true, ver: 0 });        // 行が無いのに 0 でない版
  const r1 = await save(db, d1, 0, '初めの値');
  assert.equal(r1.ok, true); assert.equal(r1.ver, 1);
  assert.deepEqual(await save(db, d1, 0), { ok: false, conflict: true, ver: 1 });        // 古い版
  const same = await save(db, d1, 1);
  assert.equal(same.same, true); assert.equal(same.ver, 1);
  const d2 = { ...d1, cols: { ...d1.cols, g3: { 'p:dashboard': 'h' } } };
  const r2 = await save(db, d2, 1, 'G3 からダッシュボードを外す');
  assert.equal(r2.ver, 2);
  const doc = (await as(db, 'service_role', 'select doc, ver, by_name, by_role from public.pv_doc')).rows;
  assert.equal(doc.length, 1); assert.deepEqual(doc[0].doc, d2); assert.equal(doc[0].ver, 2); assert.equal(doc[0].by_name, 'Gina M');
  const log = (await as(db, 'service_role', 'select ver, reason, before, after, via from public.pv_log order by id')).rows;
  assert.deepEqual(log.map(x => [x.ver, x.reason, x.via]), [[1, '初めの値', 'fn'], [2, 'G3 からダッシュボードを外す', 'fn']]);
  assert.equal(log[0].before, null); assert.deepEqual(log[0].after, d1); assert.deepEqual(log[1].before, d1); assert.deepEqual(log[1].after, d2);
  for (const [doc0, ex, reason] of [[null, 2, 'x'], [d2, -1, 'x'], [d2, 2, ''], [d2, 2, '  '], [d2, 2, 'x'.repeat(501)]])
    await assert.rejects(as(db, 'service_role', `select public.pv_save($1::jsonb, $2, $3, '[]'::jsonb, null, null, null)`, [doc0 == null ? null : JSON.stringify(doc0), ex, reason]), /pv_bad|null/);
  await db.exec(MIG);   // 行があっても流し直せる・行と版は変えない
  assert.equal((await as(db, 'service_role', 'select ver from public.pv_doc')).rows[0].ver, 2);
  const post = await table(db, POST);
  assert.ok(post.every(r => r.ok === 'OK' || r.ok === 'info'), JSON.stringify(post));
  assert.equal(post.find(r => r.n === 6).value, 'ver 2');
  assert.equal((await as(db, 'service_role', 'select count(*)::int n from public.pv_log')).rows[0].n, 2, 'the postcheck wrote nothing');
});

test('SQL: stop and resume keep the contents and leave a line in the log; the rollback drops the function and keeps the rows', async () => {
  const db = await mkdb();
  await db.exec(STOP);   // 行が無いあいだは何もしない
  await db.exec(MIG);
  await db.exec(STOP);
  assert.equal((await as(db, 'service_role', 'select count(*)::int n from public.pv_doc')).rows[0].n, 0);
  const d1 = pvCheck(DOC);
  await save(db, d1, 0);
  await db.exec(STOP); await db.exec(STOP);
  let r = (await as(db, 'service_role', 'select doc, ver from public.pv_doc')).rows[0];
  assert.equal(r.doc.off, true); assert.equal(r.ver, 2); assert.deepEqual({ ...r.doc, off: false }, d1);
  await db.exec(RESUME); await db.exec(RESUME);
  r = (await as(db, 'service_role', 'select doc, ver from public.pv_doc')).rows[0];
  assert.equal(r.doc.off, false); assert.equal(r.ver, 3); assert.deepEqual(r.doc, d1);
  const log = (await as(db, 'service_role', 'select ver, via, by_role from public.pv_log order by id')).rows;
  assert.deepEqual(log.map(x => [x.ver, x.via]), [[1, 'fn'], [2, 'sql'], [3, 'sql']]);
  const post = await table(db, POST);
  assert.ok(post.every(r => r.ok === 'OK' || r.ok === 'info'), JSON.stringify(post));
  await db.exec(BACK); await db.exec(BACK);
  assert.equal((await db.query(`select to_regprocedure('public.pv_save(jsonb,integer,text,jsonb,text,text,text)') p`)).rows[0].p, null);
  assert.equal((await as(db, 'service_role', 'select count(*)::int n from public.pv_log')).rows[0].n, 3, 'the log stays');
  const post2 = await table(db, POST);
  assert.equal(post2.find(r => r.n === 4).ok, 'NG', 'the postcheck sees the function is gone');
  assert.equal(post2.find(r => r.n === 7).value, '関数が無い');
});

test('SQL: a table pv_doc of another shape stops the migration (nothing changes)', async () => {
  const db = await mkdb();
  await db.exec('create table public.pv_doc(id smallint primary key, doc text)');
  await assert.rejects(db.exec(MIG), /STOP/);
  const pre = await table(db, PRE);
  assert.equal(pre.find(r => r.n === 1).ok, 'STOP（形が違う）');
  assert.equal((await db.query(`select to_regclass('public.pv_log') t`)).rows[0].t, null);
});

// ---------- 4. 関数 ----------
const EMPS = [
  { id: 'E-GM', name: 'Gina M', store: 'HQ', role: 'gm', title: 'General Manager' },
  { id: 'E-CEO', name: 'Cal E', store: 'HQ', role: 'ceo', title: '' },
  { id: 'E-GMX', name: 'Gone GM', store: 'HQ', role: 'gm', title: 'General Manager', status: '退職', data: { status: '退職' } },
  { id: 'E-OF', name: 'Ofelia', store: 'HQ', role: 'office', title: 'Accountant' },
  { id: 'E-AM', name: 'Amy Area', store: 'S1', role: 'am', title: 'Area Manager' },
  { id: 'E-4', name: 'Leo Four', store: 'S1', role: 'g4', title: 'Store Manager' },
  { id: 'E-1', name: 'Kai One', store: 'S1', role: 'crew', title: 'Crew' },
];
const U = n => 'bbbbbbbb-0000-0000-0000-00000000000' + n;
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

// PostgREST の pv_* だけを PGlite に渡す偽物（ほかは secure-state-world の偽物）。sql:false なら pv_* は 404（SQL の前）
async function setup(o = {}) {
  const db = await mkdb();
  if (o.sql !== false) await db.exec(MIG);
  const W = makeWorld({ emps: EMPS.map(e => ({ ...e })), mgr: MGR, users: USERS, wrPeople: [], pins: Object.fromEntries(Object.entries(ME).map(([k, v]) => ['t' + k, v])) });
  const base = W.fetch;
  const J = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json' } });
  const pvCalls = [];
  W.fetch = async (u, opt = {}) => {
    const url = new URL(u), p = url.pathname, q = url.searchParams;
    if (!p.startsWith('/rest/v1/pv_') && p !== '/rest/v1/rpc/pv_save') return base(u, opt);
    const h = Object.fromEntries(Object.entries(opt.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    assert.equal(h.apikey, SERVICE, 'pv_* is read with the server key only');
    pvCalls.push(p + url.search);
    const miss = () => J({ code: 'PGRST205', message: 'not found' }, 404);
    try {
      if (p === '/rest/v1/rpc/pv_save') {
        if (o.sql === false) return J({ code: 'PGRST202' }, 404);
        const b = JSON.parse(opt.body);
        const r = await as(db, 'service_role', 'select public.pv_save($1::jsonb, $2, $3, $4::jsonb, $5, $6, $7) r',
          [JSON.stringify(b.p_doc), b.p_expect, b.p_reason, JSON.stringify(b.p_summary), b.p_by_emp, b.p_by_name, b.p_by_role]);
        return J(r.rows[0].r);
      }
      if (o.sql === false) return miss();
      if (p === '/rest/v1/pv_doc') {
        assert.equal(q.get('id'), 'eq.1');
        const r = await as(db, 'service_role', 'select doc, ver, updated_at, by_name, by_role from public.pv_doc where id = 1');
        return J(r.rows.map(x => ({ ...x, updated_at: new Date(x.updated_at).toISOString() })));
      }
      if (p === '/rest/v1/pv_log') {
        const cols = q.get('select').split(',');
        assert.ok(cols.every(c => /^[a-z_]+$/.test(c)));
        let sql = 'select ' + cols.join(',') + ' from public.pv_log', args = [];
        if (q.get('id') && q.get('id').startsWith('eq.')) { sql += ' where id = $1'; args = [Number(q.get('id').slice(3))]; }
        else if (q.get('id') && q.get('id').startsWith('lt.')) { sql += ' where id < $1'; args = [Number(q.get('id').slice(3))]; }
        if (q.get('order') === 'id.desc') sql += ' order by id desc';
        if (q.get('limit')) sql += ' limit ' + Number(q.get('limit'));
        const r = await as(db, 'service_role', sql, args);
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
  return { db, W, call, pin, email, pvCalls };
}

test('before the SQL: everyone gets pv:null with nosql; saving says not_installed; the answer has pvfn:1', async () => {
  const S = await setup({ sql: false });
  const g = await S.pin('g1', { action: 'pv_get' });
  assert.equal(g.status, 200); assert.equal(g.j.pv, null); assert.equal(g.j.nosql, true); assert.equal(g.j.pvfn, 1); assert.equal(g.j.ltfn, 1);
  assert.equal((await S.pin('gm', { action: 'pv_full' })).j.nosql, true);
  const s = await S.pin('gm', { action: 'pv_save', doc: DOC, expect: 0, reason: '初めの値' });
  assert.equal(s.status, 503); assert.equal(s.j.error, 'not_installed');
  assert.equal((await S.pin('gm', { action: 'pv_log' })).j.nosql, true);
});

test('GM and CEO save with the version they read; a stale version is 409; same contents do not count; others are refused', async () => {
  const S = await setup();
  assert.deepEqual((await S.pin('g1', { action: 'pv_get' })).j.pv, null);
  const f0 = await S.pin('gm', { action: 'pv_full' });
  assert.equal(f0.status, 200); assert.equal(f0.j.pv, null); assert.equal(f0.j.ver, 0);
  for (const who of ['am', 'g4', 'g1', 'of', 'gmx']) {
    for (const act of [{ action: 'pv_full' }, { action: 'pv_save', doc: DOC, expect: 0, reason: 'x' }, { action: 'pv_log' }]) {
      const r = await S.pin(who, act);
      assert.equal(r.status, 403, who + ' ' + act.action); assert.equal(r.j.error, 'forbidden');
    }
  }
  assert.equal((await S.email('of', { action: 'pv_save', doc: DOC, expect: 0, reason: 'x' })).status, 403, 'office by email');
  assert.equal((await S.call({ action: 'pv_get' })).status, 401, 'no login');
  assert.equal((await S.call({ action: 'pv_get', pin_session: 'tnobody' })).status, 401, 'store login / unknown PIN');
  const s1 = await S.pin('gm', { action: 'pv_save', doc: DOC, expect: 0, reason: '初めの値', summary: ['G2：ダッシュボードを表示'] });
  assert.equal(s1.status, 200); assert.deepEqual([s1.j.ok, s1.j.ver, s1.j.same], [true, 1, false]); assert.equal(s1.j.pvfn, 1);
  const s2 = await S.email('ceo', { action: 'pv_save', doc: { ...DOC, cols: {} }, expect: 0, reason: '古い画面' });
  assert.equal(s2.status, 409); assert.equal(s2.j.error, 'conflict');
  const s3 = await S.email('ceo', { action: 'pv_save', doc: DOC, expect: 1, reason: '同じ' });
  assert.equal(s3.status, 200); assert.equal(s3.j.same, true); assert.equal(s3.j.ver, 1);
  for (const [b, why] of [[{ doc: { v: 2 }, expect: 1, reason: 'x' }, 'doc'], [{ doc: DOC, expect: -1, reason: 'x' }, 'expect'], [{ doc: DOC, expect: 1.5, reason: 'x' }, 'expect'],
                          [{ doc: DOC, expect: 1, reason: '' }, 'reason'], [{ doc: DOC, expect: 1, reason: ' '.repeat(3) }, 'reason'], [{ doc: DOC, expect: 1, reason: 'x'.repeat(501) }, 'reason'],
                          [{ doc: DOC, expect: 1, reason: 'x', summary: 'a' }, 'summary'], [{ doc: DOC, expect: 1, reason: 'x', summary: [''] }, 'summary'], [{ doc: DOC, expect: 1, reason: 'x', summary: ['x'.repeat(201)] }, 'summary']]) {
    const r = await S.pin('gm', { action: 'pv_save', ...b });
    assert.equal(r.status, 400, why); assert.equal(r.j.error, 'bad_value');
  }
  const f1 = await S.email('ceo', { action: 'pv_full' });
  assert.deepEqual(f1.j.pv.doc, pvCheck(DOC)); assert.equal(f1.j.pv.ver, 1); assert.equal(f1.j.pv.by_name, 'Gina M'); assert.equal(f1.j.pv.by_role, 'gm');
  const log = await S.pin('gm', { action: 'pv_log' });
  assert.equal(log.j.rows.length, 1); assert.equal(log.j.rows[0].reason, '初めの値'); assert.deepEqual(log.j.rows[0].summary, ['G2：ダッシュボードを表示']);
  assert.ok(!('after' in log.j.rows[0]), 'the list does not carry the contents');
  const one = await S.pin('gm', { action: 'pv_log', id: log.j.rows[0].id });
  assert.deepEqual(one.j.row.after, pvCheck(DOC)); assert.equal(one.j.row.before, null);
  assert.equal((await S.pin('gm', { action: 'pv_log', id: 0 })).status, 400);
  assert.equal((await S.pin('gm', { action: 'pv_log', before: 'x' })).status, 400);
});

test('pv_get: my column settings, my own exceptions and only-list membership; nothing about the other people', async () => {
  const S = await setup();
  await S.pin('gm', { action: 'pv_save', doc: DOC, expect: 0, reason: '初めの値' });
  const g4 = (await S.pin('g4', { action: 'pv_get' })).j;
  assert.equal(g4.pv.ver, 1); assert.ok(g4.pv.at);
  assert.deepEqual(g4.pv.cols, pvCheck(DOC).cols); assert.deepEqual(g4.pv.mine, { 'p:budget': 's' }); assert.deepEqual(g4.pv.only, { 'p:hiring': true, 'p:lala': false });
  const g1 = (await S.pin('g1', { action: 'pv_get' })).j;
  assert.deepEqual(g1.pv.mine, { 'g1:g_tip': 's' }); assert.deepEqual(g1.pv.only, { 'p:hiring': false, 'p:lala': false });
  const of = (await S.email('of', { action: 'pv_get' })).j;
  assert.deepEqual(of.pv.only, { 'p:hiring': false, 'p:lala': true });
  for (const j of [g4, g1, of]) for (const other of ['E-9', 'E-AM"', 'Amy Area', 'people']) assert.ok(!JSON.stringify(j).includes(other), other);
  // 止める（SQL）：だれにも null と off
  await S.db.exec(STOP);
  const st = (await S.pin('g4', { action: 'pv_get' })).j;
  assert.equal(st.pv, null); assert.equal(st.off, true);
  assert.equal((await S.pin('gm', { action: 'pv_full' })).j.pv.doc.off, true, 'the GM still sees the stopped contents');
  await S.db.exec(RESUME);
  assert.ok((await S.pin('g4', { action: 'pv_get' })).j.pv);
  // 形の合わない中身（SQL で手で直した など）：broken（画面は今までの決まり）・GM・CEO は版を見て上書きできる
  await as(S.db, 'service_role', `update public.pv_doc set doc = '{"v":1,"cols":{"gm":{"p:dashboard":"h"}}}'`);
  assert.deepEqual((await S.pin('g1', { action: 'pv_get' })).j, { ...(await S.pin('g1', { action: 'pv_get' })).j, pv: null, broken: true });
  const fb = (await S.pin('gm', { action: 'pv_full' })).j;
  assert.equal(fb.pv, null); assert.equal(fb.broken, true); assert.equal(fb.ver, 3);
  const fix = await S.pin('gm', { action: 'pv_save', doc: DOC, expect: 3, reason: '直す' });
  assert.equal(fix.status, 200); assert.equal(fix.j.ver, 4);
});
