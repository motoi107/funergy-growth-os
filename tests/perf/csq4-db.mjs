// v1208（Career Score 2026 Q4・段階 3-2）：模擬サーバー（mock-api.mjs）の CSQ4_DB=1 で使う、csq4_* の表と関数。
// 本物の SQL（supabase/migrations/20261214090000_csq4.sql）を PGlite（WASM の PostgreSQL）に流し、関数 secure-state が
// サーバーの鍵で読む・呼ぶ csq4_* だけを答える（PostgREST の代わり）。合成データだけ・本番にはつながない。
// 関数の引数の名前と型は、流したあとの pg_proc から読む（SQL と同じものを使う）。
import fs from 'node:fs';

export async function createCsq4Db() {
  const { PGlite } = await import('../runtime/node_modules/@electric-sql/pglite/dist/index.js');
  const db = new PGlite();
  // 今までの記録の写し（csq4_hist_copy）だけが読む表。中身は空（写すものは無い）
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.employees(id text primary key, name text, store text, status text, data jsonb);
    create table public.wr_people(emp_id text primary key, name text not null, role text, grade integer);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz not null default now());`);
  await db.exec(fs.readFileSync(new URL('../../supabase/migrations/20261214090000_csq4.sql', import.meta.url), 'utf8'));
  const sigs = {};
  const rs = await db.query(`select p.proname n, p.proargnames a, array(select format_type(t, null) from unnest(p.proargtypes::oid[]) t) t
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'csq4\\_%'`);
  for (const r of rs.rows) (sigs[r.n] = sigs[r.n] || []).push((r.a || []).map((a, i) => [a, r.t[i]]));
  let chain = Promise.resolve();
  const lock = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  const as = async (sql, params) => { await db.exec('set role service_role'); try { return await db.query(sql, params || []); } finally { await db.exec('reset role'); } };
  const J = (v, s = 200) => ({ status: s, body: JSON.stringify(v), headers: { 'content-type': 'application/json' } });
  const unq = s => s.replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const splitList = s => { const out = []; let cur = '', q = false; for (const ch of s) { if (ch === '"') q = !q; if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out.map(unq); };
  const stats = { gets: 0, rpcs: [] };
  async function handle(method, u, body) {
    const p = u.pathname;
    try {
      if (p.startsWith('/rest/v1/rpc/')) {
        if (method !== 'POST') return J({ message: 'method' }, 405);
        const fn = p.slice('/rest/v1/rpc/'.length), b = JSON.parse(body || '{}'), keys = Object.keys(b).sort().join(',');
        const sig = (sigs[fn] || []).find(s => s.map(x => x[0]).sort().join(',') === keys);
        if (!sig) return J({ code: 'PGRST202', message: 'Could not find the function ' + fn }, 404);
        const params = sig.map(([k, t]) => { const v = b[k]; if (v === null || v === undefined) return null; if (t === 'jsonb') return JSON.stringify(v); if (t === 'boolean') return !!v; return String(v); });
        stats.rpcs.push(fn);
        const r = await lock(() => as(`select public.${fn}(${sig.map(([k, t], i) => `${k} => $${i + 1}::${t}`).join(', ')}) as r`, params));
        return J(r.rows[0].r);
      }
      if (method !== 'GET') return J({ message: 'method' }, 405);
      const tbl = p.slice('/rest/v1/'.length);
      if (!/^csq4_[a-z_]+$/.test(tbl)) return J({ code: 'PGRST205', message: 'not found' }, 404);
      const q = u.searchParams, cols = (q.get('select') || '*').split(','), where = [], params = [];
      if (!cols.every(c => c === '*' || /^[a-z_]+$/.test(c))) return J({ message: 'select' }, 400);
      for (const [k, v] of q.entries()) {
        if (['select', 'order', 'limit'].includes(k)) continue;
        if (!/^[a-z_]+$/.test(k)) return J({ message: 'column' }, 400);
        if (v.startsWith('eq.')) { params.push(v.slice(3)); where.push(`${k}::text = $${params.length}`); }
        else if (v.startsWith('in.(') && v.endsWith(')')) { params.push(JSON.stringify(splitList(v.slice(4, -1)))); where.push(`${k}::text in (select jsonb_array_elements_text($${params.length}::jsonb))`); }
        else if (v === 'is.null') where.push(`${k} is null`);
        else return J({ message: 'filter ' + k }, 400);
      }
      let order = '';
      if (q.get('order')) { const [c, d] = q.get('order').split('.'); if (!/^[a-z_]+$/.test(c)) return J({ message: 'order' }, 400); order = ` order by ${c} ${d === 'desc' ? 'desc' : 'asc'}`; }
      const lim = q.get('limit') ? ` limit ${Number(q.get('limit'))}` : '';
      stats.gets++;
      const r = await lock(() => as(`select coalesce(json_agg(t), '[]'::json) j from (select ${cols.join(',')} from public.${tbl}${where.length ? ' where ' + where.join(' and ') : ''}${order}${lim}) t`, params));
      return J(r.rows[0].j);
    } catch (e) {
      const c = String(e.code || '');
      return J({ code: c, message: String(e.message || e) }, c.startsWith('22') || c === 'P0001' ? 400 : c === '23505' ? 409 : 500);
    }
  }
  return { db, handle, stats };
}
