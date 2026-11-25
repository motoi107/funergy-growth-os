// キャリア・育成 A-2 の試験の土台（合成の DB＝PGlite に本物の SQL・本物の関数 secure-state・合成の人）。本番には接続しない。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '../runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { createHandler } from '../../supabase/functions/secure-state/handler.mjs';
import { makeWorld, URL0, ANON, SERVICE, JWT } from './secure-state-world.mjs';

const rd = p => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
export const CSQ4_MIG = rd('supabase/migrations/20261214090000_csq4.sql');
export const MIG = rd('supabase/migrations/20261219090000_gp_plan.sql');
export const SIG = {
  gp_plan_save: [['p_id', 'bigint'], ['p_expect', 'integer'], ['p_emp', 'text'], ['p_name', 'text'], ['p_f', 'jsonb'], ['p_by_emp', 'text'], ['p_by_name', 'text'], ['p_by_role', 'text']],
  gp_plan_close: [['p_id', 'bigint'], ['p_expect', 'integer'], ['p_reason', 'text'], ['p_by_emp', 'text'], ['p_by_name', 'text'], ['p_by_role', 'text']],
  gp_task_save: [['p_plan_id', 'bigint'], ['p_id', 'bigint'], ['p_expect', 'integer'], ['p_f', 'jsonb'], ['p_by_emp', 'text'], ['p_by_name', 'text'], ['p_by_role', 'text']],
  gp_task_act: [['p_id', 'bigint'], ['p_expect', 'integer'], ['p_act', 'text'], ['p_note', 'text'], ['p_by_emp', 'text'], ['p_by_name', 'text'], ['p_by_role', 'text']],
  gp_note_add: [['p_plan_id', 'bigint'], ['p_task_id', 'bigint'], ['p_kind', 'text'], ['p_step', 'text'], ['p_body', 'text'], ['p_by_emp', 'text'], ['p_by_name', 'text'], ['p_by_role', 'text']],
  gp_legacy_copy: [['p_via', 'text'], ['p_reason', 'text'], ['p_by_emp', 'text'], ['p_by_name', 'text']],
};

export async function mkdb() {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    create table public.employees(id text primary key, name text, store text, status text, data jsonb);
    create table public.wr_people(emp_id text primary key, name text not null, role text, grade integer);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz not null default now());
    insert into public.employees(id, name, store, status, data) values ('E-1', 'Kai One', 'S1', '', '{}'), ('E-D1', 'Dup Name', 'S1', '', '{}'), ('E-D2', 'Dup Name', 'S2', '退職', '{}');
    insert into public.app_state(key, value, updated_at) values
      ('ojt_enroll', '{"Kai One":{"phase":2,"done":["a"]},"Dup Name":{"phase":1},"E-1":{"note":"by id"}}', '2026-10-01 00:00:00+00'),
      ('trainees', '[{"name":"Kai One","g":"G3"}]', '2026-10-02 00:00:00+00'),
      ('ojt_def_g3', '{"__st":1,"v":{"k1":{"t":"x"}}}', '2026-10-03 00:00:00+00'),
      ('skills', '{"Kai One":{"lv":3}}', '2026-10-04 00:00:00+00'),
      ('growth_karte', '{"Kai One":{"payLog":[1]}}', '2026-10-05 00:00:00+00');`);
  return db;
}
export async function as(db, role, sql, params) {
  await db.exec('set role ' + role);
  try { return await db.query(sql, params || []); } finally { await db.exec('reset role'); }
}
export const table = async (db, sql) => { const out = []; const rs = await db.exec(sql); for (const r of rs) if (r.fields && r.fields.some(f => f.name === 'ok')) out.push(...r.rows); return out; };
export const snap = async db => (await db.query('select key, value::text v, updated_at::text t from public.app_state order by key')).rows;

const U = n => 'cccccccc-0000-0000-0000-00000000000' + n;
const E = (id, name, store, role, title, status = '') => ({ id, name, store, role, title, status, data: { name, store } });
export const EMPS = [
  E('E-CEO', 'Cal E', 'ALL', 'ceo', ''), E('E-GM', 'Gina M', 'OFFICE', 'gm', 'General Manager'), E('E-AM', 'Amy Area', 'S1', 'am', 'Area Manager'),
  E('E-4', 'Leo Four', 'S1', 'g4', 'Store Manager'), E('E-3', 'Kit Three', 'S1', 'sl', 'Kitchen Leader'),
  E('E-1', 'Kai One', 'S1', 'crew', 'Crew'), E('E-1B', 'Ben One', 'S1', 'crew', 'Crew'), E('E-2', 'Sue Two', 'S2', 'crew', 'Crew'), E('E-22', 'Gus Two', 'S1', 'g2', 'Crew Leader'),
  E('E-OUT', 'Otto Out', 'S1', 'crew', 'Crew', '退職'),
];
const PIN = (emp, role, grade, stores = [], extra = {}) => ({ emp, role, grade, stores, am_stores: [], name: (EMPS.find(e => e.id === emp) || {}).name || '', confirmed: true, ...extra });
const unq = s => s.replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
const splitList = s => { const out = []; let cur = '', q = false; for (const ch of s) { if (ch === '"') q = !q; if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out.map(unq); };

export async function setup({ sql = true } = {}) {
  const db = await mkdb();
  await db.exec(CSQ4_MIG);
  if (sql) await db.exec(MIG);
  const W = makeWorld({
    emps: EMPS.map(e => ({ ...e, data: { ...e.data } })),
    mgr: { [U(1)]: { emp_id: 'E-GM', role: 'gm' }, [U(3)]: { emp_id: 'E-CEO', role: 'ceo' } },
    users: { gm: U(1), ceo: U(3) },
    wrPeople: [{ emp_id: 'E-AM', name: 'Amy Area', role: 'am', grade: 5, stores: ['S1'], am_stores: ['S1'] },
               { emp_id: 'E-3', name: 'Kit Three', role: 'staff', grade: 3, stores: ['S1'] }, { emp_id: 'E-4', name: 'Leo Four', role: 'staff', grade: 4, stores: ['S1'] }],
    pins: { tceo: PIN('E-CEO', 'ceo', 7), tgm: PIN('E-GM', 'gm', 6), tam: PIN('E-AM', 'am', 5, ['S1'], { am_stores: ['S1'] }),
            tg4: PIN('E-4', 'staff', 4, ['S1']), tg3: PIN('E-3', 'staff', 3, ['S1']), tg2: PIN('E-22', 'staff', 2, ['S1'], { confirmed: false }),
            tg1: PIN('E-1', 'staff', 1, ['S1'], { confirmed: false }), tg1b: PIN('E-1B', 'staff', 1, ['S1'], { confirmed: false }), ts2: PIN('E-2', 'staff', 1, ['S2'], { confirmed: false }) },
  });
  let chain = Promise.resolve();
  const lock = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  const J = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json' } });
  const base = W.fetch;
  W.db = { rpcs: [] };
  W.fetch = async (u, opt = {}) => {
    const url = new URL(u), p = url.pathname, m = (opt.method || 'GET').toUpperCase();
    const isGp = p.startsWith('/rest/v1/gp_') || p.startsWith('/rest/v1/rpc/gp_'), isCs = p.startsWith('/rest/v1/csq4_') || p.startsWith('/rest/v1/rpc/csq4_');
    if (!isGp && !isCs) return base(u, opt);
    const h = Object.fromEntries(Object.entries(opt.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    assert.equal(h.apikey, SERVICE, 'gp and csq4 tables only with the server key');
    if (isGp && !sql) return J({ code: p.includes('/rpc/') ? 'PGRST202' : 'PGRST205', message: 'not found' }, 404);
    try {
      if (p.startsWith('/rest/v1/rpc/')) {
        assert.equal(m, 'POST');
        const fn = p.slice('/rest/v1/rpc/'.length), sig = SIG[fn];
        assert.ok(sig, 'known rpc ' + fn);
        const body = JSON.parse(opt.body);
        assert.deepEqual(Object.keys(body).sort(), sig.map(x => x[0]).sort(), fn + ' arguments');
        const params = sig.map(([k, t]) => { const v = body[k]; if (v === null || v === undefined) return null; if (t === 'jsonb') return JSON.stringify(v); return String(v); });
        W.db.rpcs.push(fn);
        const r = await lock(() => as(db, 'service_role', `select public.${fn}(${sig.map(([k, t], i) => `${k} => $${i + 1}::${t}`).join(', ')}) as r`, params));
        return J(r.rows[0].r);
      }
      assert.equal(m, 'GET');
      const tbl = p.slice('/rest/v1/'.length);
      assert.match(tbl, /^(gp|csq4)_[a-z_]+$/);
      const q = url.searchParams, cols = (q.get('select') || '*').split(','), where = [], params = [];
      for (const c of cols) assert.match(c, /^[a-z_0-9]+$/);
      for (const [k, v] of q.entries()) {
        if (['select', 'order', 'limit'].includes(k)) continue;
        if (v.startsWith('eq.')) { params.push(v.slice(3)); where.push(`${k}::text = $${params.length}`); }
        else if (v.startsWith('in.(') && v.endsWith(')')) { params.push(JSON.stringify(splitList(v.slice(4, -1)))); where.push(`${k}::text in (select jsonb_array_elements_text($${params.length}::jsonb))`); }
        else throw new Error('filter ' + k + '=' + v);
      }
      let order = '';
      if (q.get('order')) { const [c, d] = q.get('order').split('.'); order = ` order by ${c} ${d === 'desc' ? 'desc' : 'asc'}`; }
      const lim = q.get('limit') ? ` limit ${Number(q.get('limit'))}` : '';
      const r = await lock(() => as(db, 'service_role', `select coalesce(json_agg(t), '[]'::json) j from (select ${cols.join(',')} from public.${tbl}${where.length ? ' where ' + where.join(' and ') : ''}${order}${lim}) t`, params));
      return J(r.rows[0].j);
    } catch (e) {
      const c = String(e.code || '');
      return J({ code: c, message: String(e.message || e) }, c.startsWith('22') || c === 'P0001' ? 400 : c === '23505' ? 409 : 500);
    }
  };
  const env = k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }[k]);
  const handle = createHandler({ env, fetch: W.fetch, now: () => Date.UTC(2026, 10, 24, 20, 0, 0) });
  const call = async (body, hdr = {}) => {
    const r = await handle(new Request('https://fn.test/secure-state', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ANON, ...hdr }, body: JSON.stringify(body) }));
    let j = null; try { j = await r.json(); } catch { j = null; }
    assert.equal(j && j.gpfn, 1, 'every answer says gpfn:1 ' + JSON.stringify(body).slice(0, 80));
    return { status: r.status, j };
  };
  const pin = (who, body) => call({ ...body, pin_session: 't' + who });
  const email = (who, body) => call(body, { authorization: 'Bearer ' + JWT(who) });
  return { db, W, pin, email };
}
export const okj = (r, what) => { assert.equal(r.status, 200, what + ' ' + JSON.stringify(r.j)); assert.equal(r.j.error, undefined, what); return r.j; };
export const fail = (r, status, error, what) => { assert.equal(r.status, status, what + ' ' + JSON.stringify(r.j)); assert.equal(r.j.error, error, what); return r.j; };

