// 経費の申請（ガソリン代・建て替え経費・事前経費）を本物のブラウザで通すための模擬の世界（合成データだけ。本番にはつながない）。
// ・アプリ：このリポジトリの index.html（http://localhost:APP_PORT/）
// ・Supabase：tests/perf/mock-api.mjs（PostgREST・auth-pin などのまね）＋ 関数 work-requests は本物の handler と本物の SQL（PGlite）
//   PIN のログインの印は perf-session:<社員 ID>（verifyPin の代わり）。
// 使い方：node tests/e2e-wr/expense-paths.mjs（VENDOR_DIR・CERT_DIR が要る。README は同じフォルダ）
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { createMock } from '../perf/mock-api.mjs';
import { createHandler } from '../../supabase/functions/work-requests/handler.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || path.join(ROOT, 'tests/runtime/node_modules/@electric-sql/pglite/dist/index.js'));
const MIG = f => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f + '.sql'), 'utf8');
// 本番に入っている work-requests の SQL（入れた順）
export const WR_MIGS = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68',
  '20261113080000_wr_people_chef', '20261116080000_wr_people_g2', '20261120090000_work_requests_stage2', '20261121090000_chat', '20261123090000_work_requests_stage3', '20261124090000_chat_files']
  .concat(process.env.WR_FIX === '0' ? [] : ['20261125090000_wr_expense_g2']);   // WR_FIX=0：直す前（v1162 の本番と同じ SQL）

export const TODAY = new Date().toISOString().slice(0, 10);
const STORES = [['F01', 'Store A', 'Brand A', 'Ami Area'], ['F02', 'Store B', 'Brand B', '']].map(([id, name, brand, am]) => ({ id, name, brand, color: '#335577', am, toastGuid: '', hours: '11:00-22:00', days: '毎日', active: true }));
// 作りものの人（G1〜G6・CEO・経理）。role は本番の社員の表と同じ書き方（g2・sl・g4・am・gm・ceo・office・crew）
export const PEOPLE = [
  { id: 'e1', name: 'Cora Ceo', role: 'ceo', store: 'ALL', title: 'CEO', mgr: 'ceo' },
  { id: 'e2', name: 'Gabe Gm', role: 'gm', store: 'ALL', title: 'General Manager', mgr: 'gm' },
  { id: 'e3', name: 'Ann Acct', role: 'office', store: 'ALL', title: 'Accountant', mgr: 'office' },
  { id: 'e10', name: 'Cam Crew', role: 'crew', store: 'F01', title: 'Crew', g: 1 },
  { id: 'e11', name: 'Lee Two', role: 'g2', store: 'F01', title: 'Crew Leader', g: 2 },
  { id: 'e12', name: 'Sam Three', role: 'sl', store: 'F01', title: 'Server Leader', g: 3 },
  { id: 'e13', name: 'Mia Four', role: 'g4', store: 'F01', title: 'Store Manager', g: 4 },
  { id: 'e14', name: 'Ami Area', role: 'am', store: 'F01', title: 'Area Manager', g: 5 },
];
const EMP = p => ({ id: p.id, name: p.name, role: p.role, store: p.store, support: [], emp: '正社員', step: 2, status: '在籍', perms: 'staff', coef: 1, title: p.title, isSL: p.role === 'sl', firstWorkDate: '2025-01-10' });

export async function startWorld({ appPort = 8090, vendor = process.env.VENDOR_DIR, cert = process.env.CERT_DIR, confirmPeople = true, wrLive = true, s2 = true, appDir = ROOT } = {}) {
  const at = new Date().toISOString();
  const data = {
    tables: {
      app_state: [
        { key: 'wr_live', value: { live: wrLive, s2: wrLive && s2, at }, updated_at: at },
        { key: 'mileage_config', value: { ratePerMile: 0.7 }, updated_at: at },
        { key: 'ing_v2_backfill_done', value: true, updated_at: at }, { key: 'ing_v2_storeprice_fix', value: true, updated_at: at },
      ],
      app_settings: [], employees: PEOPLE.map(p => ({ id: p.id, name: p.name, role: p.role, data: EMP(p) })),
      stores: STORES.map(s => ({ id: s.id, data: s })), ingredients: [], recipes: [], vendors: [], categories: [],
      toast_sales: [], tip_labor: [], toast_item_sales: [], shift_availability: [], shift_plans: [], manager_auth: [], handbook_test_results: [],
    },
  };
  const mock = createMock(data);
  // ---- 本物の work-requests（PGlite）
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;`);
  for (const s of STORES) await pg.query('insert into public.stores values ($1,$2,$3,true)', [s.id, s.name, s.am || null]);
  for (const p of PEOPLE) {
    await pg.query(`insert into public.employees values ($1,$2,$3,$4,$5,'[]','在籍',$6)`, [p.id, p.name, p.role, p.title, p.store, JSON.stringify(EMP(p))]);
    if (p.mgr) await pg.query('insert into public.manager_auth(role, emp_id) values ($1,$2)', [p.mgr, p.id]);
  }
  await pg.query(`insert into public.app_state(key, value) values ('mileage_config', '{"ratePerMile":0.7}'::jsonb)`);
  for (const f of WR_MIGS) await pg.exec(MIG(f));
  await pg.exec(`update public.wr_settings set live = ${wrLive}, s2_live = ${wrLive && s2}; set role service_role`);
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const NAME = Object.fromEntries(PEOPLE.map(p => [p.id, p.name]));
  if (confirmPeople) {   // GM が「承認・閲覧の権限の確かめ」で全員を確かめた（本番で済んでいるかは分からない：両方を試す）
    const gm = { emp_id: 'e2', name: NAME.e2 }; const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  }
  const files = new Map();
  const storage = {
    async signUpload(p) { return { url: `https://tgbhgxzehzeouopklhje.supabase.co/storage/v1/object/upload/sign/chat-files/${p}?token=t`, token: 't' }; },
    async signDownload(paths) { return Object.fromEntries(paths.filter(p => files.has(p)).map(p => [p, `https://tgbhgxzehzeouopklhje.supabase.co/storage/v1/object/sign/chat-files/${p}?token=s`])); },
    async head(p) { const o = files.get(p); return o ? { bytes: o.slice(0, 16), size: o.length } : null; },
    async remove(paths) { for (const p of paths) files.delete(p); },
  };
  const wr = createHandler({ env: k => ({ SUPABASE_URL: 'https://tgbhgxzehzeouopklhje.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db, storage,
    verifyPin: async tok => { const m = /^perf-session:(e\d+)$/.exec(tok); return m && NAME[m[1]] ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  const calls = [];
  async function handle(method, u, headers, body) {
    if (u.pathname === '/functions/v1/work-requests') {
      let j = {}; try { j = JSON.parse(body || '{}'); } catch (e) { }
      calls.push({ at: Date.now(), action: j.action, kind: j.kind, op: j.op, who: String(j.pin_session || '').replace('perf-session:', '') });
      const res = await wr(new Request('https://fn.local/functions/v1/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body || '{}' }));
      const out = { status: res.status, body: await res.text(), headers: { 'content-type': 'application/json' } };
      calls[calls.length - 1].status = res.status; if (res.status >= 400) calls[calls.length - 1].err = out.body.slice(0, 200);
      return out;
    }
    if (u.pathname === '/functions/v1/auth-pin') {
      let j = {}; try { j = JSON.parse(body || '{}'); } catch (e) { }
      if (j.action === 'verify') return { status: 200, body: JSON.stringify({ ok: true, token: j.emp ? 'perf-session:' + j.emp : 'perf-session' }), headers: { 'content-type': 'application/json' } };
      return { status: 200, body: '{"ok":true}', headers: { 'content-type': 'application/json' } };
    }
    if (/^\/storage\/v1\/object\//.test(u.pathname)) {   // 領収書の置き場所のまね（中身は覚えるだけ）
      if (method === 'POST' || method === 'PUT') { files.set(u.pathname, Buffer.from(body || '')); return { status: 200, body: JSON.stringify({ Key: u.pathname }), headers: { 'content-type': 'application/json' } }; }
      return { status: 200, body: '{}', headers: { 'content-type': 'application/json' } };
    }
    return mock.handle(method, u, headers, body);
  }
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  const send = (res, st, h, buf) => { res.writeHead(st, Object.assign({ 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }, h)); res.end(buf); };
  const file = (res, f) => fs.existsSync(f) && fs.statSync(f).isFile() ? send(res, 200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }, fs.readFileSync(f)) : send(res, 404, {}, 'nf');
  const app = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(appDir, path.normalize(p).replace(/^(\.\.[/\\])+/, '')); if (!f.startsWith(appDir)) return send(res, 403, {}, '');
    file(res, f);
  });
  const ext = https.createServer({ key: fs.readFileSync(path.join(cert, 'key.pem')), cert: fs.readFileSync(path.join(cert, 'cert.pem')) }, async (req, res) => {
    const host = String(req.headers.host || '').split(':')[0]; const u = new URL(req.url, 'https://' + host);
    if (req.method === 'OPTIONS') return send(res, 204, { 'access-control-allow-headers': req.headers['access-control-request-headers'] || '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,PUT,HEAD,OPTIONS' }, '');
    if (host === 'cdn.jsdelivr.net') {
      if (u.pathname.startsWith('/npm/@supabase/supabase-js@2')) return file(res, path.join(vendor, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'));
      const m = u.pathname.match(/^\/npm\/@tabler\/icons-webfont@[^/]+\/(.*)$/); if (m) return file(res, path.join(vendor, 'node_modules/@tabler/icons-webfont', m[1].replace('tabler-icons.min.css', 'tabler-icons.css')));
      return send(res, 404, {}, 'nf');
    }
    if (/open-meteo\.com$/.test(host)) return send(res, 200, { 'content-type': 'application/json' }, '{"daily":{"time":[],"weathercode":[],"temperature_2m_max":[],"precipitation_sum":[]}}');
    if (/supabase\.co$/.test(host)) {
      const chunks = []; for await (const c of req) chunks.push(c);
      let r; try { r = await handle(req.method, u, req.headers, Buffer.concat(chunks).toString('utf8')); } catch (e) { r = { status: 500, body: JSON.stringify({ error: String(e && e.message || e) }) }; }
      return send(res, r.status, Object.assign({ 'content-type': 'application/json' }, r.headers || {}), r.body == null ? '' : r.body);
    }
    send(res, 404, {}, 'nf');
  });
  ext.on('upgrade', (req, sock) => sock.destroy());
  await new Promise(r => app.listen(appPort, '127.0.0.1', r)); await new Promise(r => ext.listen(443, '127.0.0.1', r));
  const q = async (sql, args) => { await pg.exec('reset role'); try { return (await pg.query(sql, args)).rows; } finally { await pg.exec('set role service_role'); } };
  return { url: `http://localhost:${appPort}/`, mock, pg, q, db, calls, close: () => { app.close(); ext.close(); } };
}
