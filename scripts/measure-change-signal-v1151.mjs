// v1151 の見張りの前後の重さ（PGlite・合成データ・Codex #145 の確認）。本番の Postgres・ネットワークではない。使い方：npm ci --prefix tests/runtime のあと node scripts/measure-change-signal-v1151.mjs
import fs from 'node:fs';
const R = process.argv[2] || new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { PGlite } = await import(R + '/tests/runtime/node_modules/@electric-sql/pglite/dist/index.js');
const SECURE = fs.readFileSync(R + '/supabase/migrations/20261117090000_secure_grade_bonus_read.sql', 'utf8');
const MIG = fs.readFileSync(R + '/supabase/migrations/20261118090000_change_signal.sql', 'utf8');
async function setup(mig) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    create table public.app_settings(key text primary key, value jsonb, category text, updated_at timestamptz default now());
    create table public.stores(id text primary key, name text, active boolean, data jsonb, updated_at timestamptz default now());
    create table public.employees(id text primary key, name text, role text, store text, status text, data jsonb, updated_at timestamptz default now());
    create table public.ingredients(code text primary key, name text, price numeric, data jsonb, updated_at timestamptz default now());
    grant select, insert, update, delete on public.app_state, public.app_settings, public.stores, public.employees, public.ingredients to anon, authenticated, service_role;`);
  try { await pg.exec('create publication supabase_realtime'); } catch {}
  await pg.exec(SECURE);
  if (mig) await pg.exec(MIG);
  return pg;
}
const hdr = JSON.stringify({ 'x-fp-actor': Buffer.from(JSON.stringify({ e: 'E1', n: 'Ann', r: 'gm', d: 'dA-tB', k: 'pc' })).toString('base64') });
async function asAnon(pg, f) {
  await pg.exec('set role anon');
  await pg.query(`select set_config('request.jwt.claims', '{"role":"anon"}', false), set_config('request.headers', $1, false)`, [hdr]);
  try { return await f(); } finally { await pg.exec('reset role'); }
}
function bigArr(mb) {   // 請求書のような並び（id のある要素）
  const one = { id: 'x', vendor: 'Sample Foods', date: '2026-11-01', total: 123.45, lines: Array.from({ length: 12 }, (_, i) => ({ item: 'item ' + i, qty: i, price: 1.25 })) };
  const sz = JSON.stringify(one).length, n = Math.ceil(mb * 1e6 / sz);
  return Array.from({ length: n }, (_, i) => ({ ...one, id: 'INV' + i }));
}
const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
async function timeIt(pg, f, n = 5) { const t = []; for (let i = 0; i < n; i++) { const s = performance.now(); await f(i); t.push(performance.now() - s); } return med(t); }
const out = [];
for (const mb of [0.5, 2, 5, 10]) {
  const res = {};
  for (const mig of [false, true]) {
    const pg = await setup(mig);
    const base = bigArr(mb);
    await asAnon(pg, () => pg.query(`insert into public.app_state(key, value) values ('invoices_big', $1::jsonb)`, [JSON.stringify(base)]));
    res[mig ? 'after' : 'before'] = await timeIt(pg, i => asAnon(pg, () => {
      const v = base.slice(); v[i] = { ...v[i], total: 999 + i };   // 1 件だけ直す（よくある保存）
      return pg.query(`insert into public.app_state(key, value) values ('invoices_big', $1::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(v)]);
    }));
    await pg.close();
  }
  out.push(`app_state 1 行 ${mb}MB（並びの 1 件を直す）: 前 ${res.before.toFixed(0)} ms → 後 ${res.after.toFixed(0)} ms（+${(res.after - res.before).toFixed(0)}）`);
}
for (const rows of [2000]) {
  const res = {};
  for (const mig of [false, true]) {
    const pg = await setup(mig);
    const vals = Array.from({ length: rows }, (_, i) => `('C${i}', 'Sample ${i}', ${i}, '{"unit":"lb","note":"sample"}'::jsonb)`).join(',');
    await pg.exec(`insert into public.ingredients(code, name, price, data) values ${vals}`);
    res[mig ? 'after' : 'before'] = await timeIt(pg, i => asAnon(pg, () => pg.query(`update public.ingredients set price = price + 1, updated_at = now()`)), 3);
    await pg.close();
  }
  out.push(`食材マスター ${rows} 行を 1 回で直す: 前 ${res.before.toFixed(0)} ms → 後 ${res.after.toFixed(0)} ms（+${(res.after - res.before).toFixed(0)}）`);
}
console.log(out.join('\n'));
