// v1186：GM・CEO・経理は PIN でログインしない（Moto さん 11/16 23:24 HST）を本物のブラウザ（Chrome）で通す。合成データだけ（作りものの人・メール・パスワード）。本番にはつながない。
// ・アプリ：このリポジトリの index.html（http://localhost:8092/）
// ・Supabase：tests/perf/mock-api.mjs（PostgREST など）＋ 関数 device-login は本物の handler と本物の SQL（PGlite・v1183・v1185、途中で v1186 と PIN_を戻す.sql）
//   Supabase Auth・auth-pin・emp-private は代わり（auth-pin と emp-private は v1186 と同じく、本物の SQL の dl_pin_blocked で止める）。ログインの印は perf-session:<社員 ID>
// 使い方：VENDOR_DIR=/tmp/e2e/vendor CERT_DIR=/tmp/e2e/cert [SHOTS=/tmp/pinoffshots] node tests/e2e-login/pin-off-v1186.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { createMock } from '../perf/mock-api.mjs';
import { createHandler } from '../../supabase/functions/device-login/handler.mjs';

for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const APP_DIR = process.env.APP_DIR || ROOT;
const VENDOR = process.env.VENDOR_DIR || '/tmp/e2e/vendor', CERT = process.env.CERT_DIR || '/tmp/e2e/cert', SHOTS = process.env.SHOTS || '';
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || path.join(ROOT, 'tests/runtime/node_modules/@electric-sql/pglite/dist/index.js'));
const ANON = (fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8').match(/const SUPABASE_ANON = '([^']+)'/) || [])[1];
const PORT = 8093, ORIGIN = `http://localhost:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond, info }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

// ---------------------------------------------------------------- 作りものの人
const STORES = [['F01', 'Store A'], ['F02', 'Store B']].map(([id, name]) => ({ id, name, brand: 'Brand', color: '#335577', am: '', toastGuid: '', hours: '11:00-22:00', days: '毎日', active: true }));
const PEOPLE = [
  { id: 'E1', name: 'Cora Ceo', role: 'ceo', store: 'ALL', title: 'CEO' },
  { id: 'E2', name: 'Gabe Gm', role: 'gm', store: 'ALL', title: 'General Manager' },
  { id: 'E3', name: 'Dee Office', role: 'office', store: 'ALL', title: 'Accountant' },
  { id: 'S1', name: 'Aki Test', role: 'crew', store: 'F01', title: 'Crew' },
];
const PINS = { 'Cora Ceo': '1111', 'Gabe Gm': '2222', 'Dee Office': '9753', 'Aki Test': '246813', 'Mix Gm': '4444' };
// アプリの名簿では Crew・サーバーの社員の表では GM（列と中身・名簿が違う人）
const MIX = { id: 'E4', name: 'Mix Gm', role: 'crew', store: 'F01', title: 'Crew' };
const ALLP = [...PEOPLE, MIX];
const UID = { ceo: '00000000-0000-4000-8000-0000000000c1', gm: '00000000-0000-4000-8000-0000000000c2', office: '00000000-0000-4000-8000-0000000000c3', mix: '00000000-0000-4000-8000-0000000000c4' };
const ACC = { 'ceo@test.example': ['pw-ceo', UID.ceo], 'gm@test.example': ['pw-gm', UID.gm], 'office@test.example': ['pw-office', UID.office], 'mix@test.example': ['pw-mix', UID.mix] };
const EMP = p => ({ id: p.id, name: p.name, role: p.role, store: p.store, support: [], emp: '正社員', step: 2, status: '在籍', perms: 'staff', coef: 1, title: p.title, firstWorkDate: '2025-01-10' });

// ---------------------------------------------------------------- 本物の device-login（PGlite）
const pg = new PGlite();
await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
  create table public.employees(id text primary key, name text, status text, role text, store text, data jsonb);
  create table public.app_state(key text primary key, value jsonb, updated_at timestamptz not null default now());
  grant select on public.manager_auth, public.employees to service_role; grant select, insert, update on public.app_state to service_role;`);
for (const p of PEOPLE) await pg.query(`insert into public.employees values ($1,$2,'在籍',$3,$4,'{}')`, [p.id, p.name, p.role, p.store]);
await pg.query(`insert into public.employees values ('E4','Mix Gm','在籍','gm','F01','{}')`);
// #184 の P2：退職した GM と同じ名前の Crew（Aki Test）。サーバーの社員の表にだけある（アプリの名簿には出ない）。Crew は PIN で入れる
await pg.query(`insert into public.employees values ('R9','Aki Test','退職','gm','F01','{}')`);
await pg.query('insert into public.manager_auth values ($1,$2,$3),($4,$5,$6),($7,$8,$9),($10,$11,$12)', [UID.ceo, 'ceo', 'E1', UID.gm, 'gm', 'E2', UID.office, 'office', 'E3', UID.mix, 'gm', 'E4']);
await pg.exec(fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261203090000_device_login.sql'), 'utf8'));
await pg.exec(fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261205090000_email_login.sql'), 'utf8'));
await pg.exec('set role service_role');
// PostgREST と同じく、無い関数は 404（v1186 の login_info は SQL がまだなら「止めていない」）
const db = { async rpc(name, p) {
  try { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; }
  catch (e) { if (/does not exist/.test(e.message)) { const x = new Error('Could not find the function'); x.status = 404; throw x; } throw e; }
} };
const q = async (sql, args) => { await pg.exec('reset role'); try { return (await pg.query(sql, args)).rows; } finally { await pg.exec('set role service_role'); } };
const TOK = new Map(), RT = new Map();
let n = 0;
const W = { dlOff: false, epOld: false, pinCalls: [], dlCalls: [], ep: [], closed: [], pw: [] };
// v1186 の auth-pin・emp-private と同じ：SQL の dl_pin_blocked（無ければ止めない）
const blocked = async (name, emp) => { try { return (await q(`select public.dl_pin_blocked($1::jsonb)->>'blocked' as b`, [JSON.stringify({ name, emp_id: emp || '' })]))[0].b === 'true'; } catch (e) { if (/does not exist/.test(e.message)) return false; throw e; } };
const issue = uid => { const at = 'at-' + (++n), rt = 'rt-' + n; TOK.set(at, uid); RT.set(rt, uid); return { access_token: at, refresh_token: rt, expires_in: 3600, token_type: 'bearer' }; };
const dl = createHandler({
  env: k => ({ SUPABASE_URL: 'https://tgbhgxzehzeouopklhje.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: ANON, DL_ALLOWED_ORIGINS: ORIGIN })[k],
  db,
  fetch: async (url, init) => { if (String(url).endsWith('/auth/v1/user')) { const id = TOK.get(String(init.headers.authorization || '').replace('Bearer ', '')); return id ? Response.json({ id }) : new Response('{}', { status: 401 }); } throw new Error('unexpected ' + url); },
  pinCheck: async () => ({ ok: false }),
  signMark: async ({ emp_id }) => 'perf-session:' + emp_id,
});

// ---------------------------------------------------------------- 模擬の Supabase
const at = new Date().toISOString();
const mock = createMock({ tables: {
  app_state: [{ key: 'ing_v2_backfill_done', value: true, updated_at: at }, { key: 'ing_v2_storeprice_fix', value: true, updated_at: at }],
  app_settings: [], employees: ALLP.map(p => ({ id: p.id, name: p.name, role: p.role, data: EMP(p) })),
  stores: STORES.map(s => ({ id: s.id, data: s })), ingredients: [], recipes: [], vendors: [], categories: [],
  toast_sales: [], tip_labor: [], toast_item_sales: [], shift_availability: [], shift_plans: [], manager_auth: [], handbook_test_results: [],
} });
async function handle(method, u, headers, body) {
  const J = (o, st = 200) => ({ status: st, body: JSON.stringify(o), headers: { 'content-type': 'application/json' } });
  let j = {}; try { j = JSON.parse(body || '{}'); } catch (e) {}
  if (u.pathname === '/functions/v1/device-login') {
    if (W.dlOff) return { status: 404, body: 'Requested function was not found', headers: { 'content-type': 'text/plain' } };
    const h = { 'content-type': 'application/json', 'user-agent': String(headers['user-agent'] || ''), 'x-forwarded-for': '127.0.0.1' };
    if (headers.origin) h.origin = headers.origin; if (headers.authorization) h.authorization = headers.authorization;
    const res = await dl(new Request('https://fn.local/device-login', { method, headers: h, body: method === 'POST' ? body : undefined }));
    const txt = await res.text(); W.dlCalls.push({ a: j.action, mode: j.mode, st: res.status, out: txt.slice(0, 200) });
    return { status: res.status, body: txt, headers: { 'content-type': 'application/json' } };
  }
  if (u.pathname === '/functions/v1/auth-pin') {
    if (j.action === 'verify') {
      W.pinCalls.push(j.key);
      const p = ALLP.find(x => x.id === String(j.emp || '') || x.name === j.key);
      if (!p || PINS[p.name] !== String(j.pin)) return J({ ok: false });
      if (await blocked(p.name, p.id)) return J({ ok: true, use_email: true });   // auth-pin v1186：印を出さない
      return J({ ok: true, token: 'perf-session:' + p.id });
    }
    return J({ ok: true });
  }
  if (u.pathname === '/functions/v1/emp-private') {
    // v1185 の emp-private（公開しない 1 ファイル）の代わり：印（token）か PIN。W.epOld なら v5（PIN だけ）
    W.ep.push({ action: j.action, token: !!j.token, pin: !!j.pin, name: j.name });
    const m = /^perf-session:(.+)$/.exec(String(j.token || ''));
    const p = (!W.epOld && m) ? ALLP.find(x => x.id === m[1]) : ALLP.find(x => x.name === j.name && PINS[x.name] === String(j.pin || ''));
    if (!p) return J({ ok: false, error: 'unauthorized' }, 401);
    if (!m && await blocked(p.name, p.id)) return J({ ok: false, error: 'unauthorized' }, 401);   // emp-private v1186：PIN の道は止める
    if (j.action === 'save') return ['ceo', 'gm', 'office'].includes(p.role) ? J({ ok: true }) : J({ ok: false, error: 'forbidden' }, 403);
    const all = ['ceo', 'gm', 'office', 'am'].includes(p.role);
    const priv = {}; for (const x of PEOPLE) if (all || x.id === p.id) priv[x.id] = { wage: 20, email: '', phone: '', monthlySalary: null };
    return J({ ok: true, role: p.role, scope: all ? 'all' : 'self', private: priv });
  }
  if (u.pathname === '/auth/v1/token') {
    const g = u.searchParams.get('grant_type');
    if (g === 'password') { W.pw.push(j.email); const a = ACC[j.email]; return a && a[0] === j.password ? J(issue(a[1])) : J({ error: 'invalid_grant' }, 400); }
    if (g === 'refresh_token') { const uid = RT.get(j.refresh_token); if (!uid) return J({ error: 'invalid_grant' }, 400); RT.delete(j.refresh_token); return J(issue(uid)); }
  }
  if (u.pathname === '/auth/v1/logout') {
    const tk = String(headers.authorization || '').replace('Bearer ', ''), scope = u.searchParams.get('scope');
    W.closed.push(scope);
    if (scope === 'global') { const uid = TOK.get(tk); for (const [k, v] of [...TOK]) if (v === uid) TOK.delete(k); for (const [k, v] of [...RT]) if (v === uid) RT.delete(k); } else TOK.delete(tk);
    return { status: 204, body: '' };
  }
  if (u.pathname === '/auth/v1/user') { const id = TOK.get(String(headers.authorization || '').replace('Bearer ', '')); return id ? J({ id }) : J({}, 401); }
  return mock.handle(method, u, headers, body);
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
const send = (res, st, h, buf) => { res.writeHead(st, Object.assign({ 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }, h)); res.end(buf); };
const file = (res, f) => fs.existsSync(f) && fs.statSync(f).isFile() ? send(res, 200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }, fs.readFileSync(f)) : send(res, 404, {}, 'nf');
const app = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(APP_DIR, path.normalize(p).replace(/^(\.\.[/\\])+/, '')); if (!f.startsWith(APP_DIR)) return send(res, 403, {}, ''); file(res, f);
});
const ext = https.createServer({ key: fs.readFileSync(path.join(CERT, 'key.pem')), cert: fs.readFileSync(path.join(CERT, 'cert.pem')) }, async (req, res) => {
  const host = String(req.headers.host || '').split(':')[0]; const u = new URL(req.url, 'https://' + host);
  if (req.method === 'OPTIONS') return send(res, 204, { 'access-control-allow-headers': req.headers['access-control-request-headers'] || '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,PUT,HEAD,OPTIONS' }, '');
  if (host === 'cdn.jsdelivr.net') {
    if (u.pathname.startsWith('/npm/@supabase/supabase-js@2')) return file(res, path.join(VENDOR, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'));
    const m = u.pathname.match(/^\/npm\/@tabler\/icons-webfont@[^/]+\/(.*)$/); if (m) return file(res, path.join(VENDOR, 'node_modules/@tabler/icons-webfont', m[1].replace('tabler-icons.min.css', 'tabler-icons.css')));
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
await new Promise(r => app.listen(PORT, '127.0.0.1', r)); await new Promise(r => ext.listen(443, '127.0.0.1', r));

// ---------------------------------------------------------------- ブラウザ
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const browser = await chromium.launch({ headless: true, args: ARGS, executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const all = [];
async function device(width = 390, lang) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 844 }, serviceWorkers: 'block', userAgent: width < 500 ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' : undefined });
  if (lang) await ctx.addInitScript(l => { try { localStorage.setItem('funergy_lang', l); } catch (e) {} }, lang);
  const page = await ctx.newPage();
  const D = { ctx, page, dialogs: [], errors: [] };
  page.on('dialog', d => { D.dialogs.push(d.message().slice(0, 200)); d.accept(); });
  page.on('pageerror', e => D.errors.push(String(e.message).slice(0, 200)));
  all.push(D);
  return D;
}
const waitApp = page => page.waitForFunction(() => { const s = document.getElementById('app-shell'); return !!(s && s.style.display !== 'none' && curUserName) && window._heavyPending === false; }, null, { timeout: 90000 }).then(() => true, () => false);
const vis = (page, id) => page.evaluate(i => { const e = document.getElementById(i); return !!e && e.style.display !== 'none' && !e.hidden && e.offsetParent !== null; }, id);
const text = (page, id) => page.evaluate(i => (document.getElementById(i) || {}).innerText || '', id);
const overflowX = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
async function pickName(D, store, name) {
  const { page } = D;
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length >= 2, null, { timeout: 60000 });
  await page.evaluate(s => loginPickLocation(s), store); await sleep(400);
  await page.locator('#login-name-grid .store-btn', { hasText: name }).first().click();
  await sleep(300);
}
async function mailLogin(D, email, pass) {
  await D.page.fill('#ml-email', email); await D.page.fill('#ml-pass', pass); await D.page.click('#ml-btn');
}
const errText = page => page.waitForFunction(() => { const e = document.getElementById('ml-err'); return e && e.style.display === 'block' && e.textContent; }, null, { timeout: 15000 }).then(() => text(page, 'ml-err'), () => '');


const SQL86 = fs.readFileSync(path.join(ROOT, 'deploy/pin-off-v1186/2_SQL.sql'), 'utf8');
const UNDO = fs.readFileSync(path.join(ROOT, 'deploy/pin-off-v1186/PIN_を戻す.sql'), 'utf8');
const sqlRun = async s => { await pg.exec('reset role'); try { await pg.exec(s); } finally { await pg.exec('set role service_role'); } };
const pinBtn = page => page.evaluate(() => { const b = document.getElementById('ml-pin'); return !!b && b.style.display !== 'none' && b.offsetParent !== null; });
const pinLogin = async (D, pin) => { await D.page.fill('#login-pin-input', pin); await D.page.evaluate(() => doStaffLogin()); };

// ================================================================ 1. SQL の前：v1185 と同じ（「PIN でログイン（試しのあいだ）」が出る）
const A = await device(390);
await pickName(A, 'OFFICE', 'Gabe Gm');
ok('SQL の前：GM はメールの段で「PIN でログイン」が出る（v1185 と同じ）', await vis(A.page, 'login-step-mail') && await pinBtn(A.page));
ok('SQL の前：login_info は止めていない（404 → false）', W.dlCalls.some(c => c.a === 'login_info' && c.st === 200 && /"top_pin_off":false/.test(c.out)));
await A.ctx.close();

// ================================================================ 2. SQL（v1186）を流す
await sqlRun(SQL86);
ok('SQL を流すとスイッチが入る', (await q(`select public.dl_top_pin_off() as v`))[0].v === true);

// GM（iPhone の幅）
const G = await device(390);
await pickName(G, 'OFFICE', 'Gabe Gm');
const mg = await text(G.page, 'login-step-mail');
ok('GM：メールとパスワードの段・「PIN でログイン」を出さない', await vis(G.page, 'login-step-mail') && !(await vis(G.page, 'login-step-pin')) && !(await pinBtn(G.page)) && !/PIN でログイン/.test(mg), mg.slice(0, 200));
ok('390px で横にはみ出さない', (await overflowX(G.page)) <= 0);
await shot(G.page, 'gm-mail-390');
await G.page.evaluate(() => FUNERGY_ML.usePin()); await sleep(300);
ok('画面の外から PIN の段に切り替えても出ない（メールで、と出す）', !(await vis(G.page, 'login-step-pin')) && /メールとパスワード/.test(await errText(G.page)));
await mailLogin(G, 'gm@test.example', 'pw-gm');
ok('GM はメールとパスワードで入る（PIN を確かめない）', await waitApp(G.page) && W.pinCalls.length === 0 && await G.page.evaluate(() => curRole === 'gm' && window._mlSignedIn === true && window._hwSession === 'perf-session:E2'));
ok('GM の給与は印で読める', W.ep.some(e => e.name === 'Gabe Gm' && e.action === 'pull' && e.token) && await G.page.evaluate(() => !!(window._empPrivate && window._empPrivate.S1)));
await G.page.evaluate(() => doLogout()); await sleep(800);
await G.ctx.close();

// 経理（PC の幅・英語）
const O = await device(1280, 'en');
await pickName(O, 'OFFICE', 'Dee Office');
const mo = await text(O.page, 'login-step-mail');
ok('経理（英語・PC）：メールの段・PIN のボタンなし', await vis(O.page, 'login-step-mail') && !(await pinBtn(O.page)) && /Log in with email and password/.test(mo) && !/Log in with PIN/.test(mo), mo.slice(0, 160));
await O.ctx.close();

// Crew は今までどおり PIN
const C = await device(390);
await pickName(C, 'F01', 'Aki Test');
ok('Crew：PIN の段（今までどおり）', await vis(C.page, 'login-step-pin') && !(await vis(C.page, 'login-step-mail')));
await pinLogin(C, '246813');
ok('Crew は PIN で入る・印あり', await waitApp(C.page) && await C.page.evaluate(() => curUserName === 'Aki Test' && window._hwSession === 'perf-session:S1'));
await C.ctx.close();

// アプリの名簿では Crew・サーバーでは GM の人：PIN は合っていても入らず、メールの段へ → メールとパスワードで入れる
const X = await device(390);
await pickName(X, 'F01', 'Mix Gm');
ok('名簿が Crew の人は PIN の段（アプリは知らない）', await vis(X.page, 'login-step-pin'));
const pc0 = W.pinCalls.length;
await pinLogin(X, '4444'); await sleep(1200);
ok('auth-pin が use_email：入らずにメールの段・PIN の欄は空・印なし', W.pinCalls.length === pc0 + 1 && await vis(X.page, 'login-step-mail') && !(await X.page.evaluate(() => !!curUserName || !!window._hwSession || !!window._sessionPin)) && await X.page.evaluate(() => (document.getElementById('login-pin-input') || {}).value === ''));
ok('その人もメールとパスワードで入れる（役割はサーバーの GM）', await (async () => { await X.page.fill('#ml-email', 'mix@test.example'); await X.page.fill('#ml-pass', 'pw-mix'); await X.page.click('#ml-btn'); return waitApp(X.page); })() && await X.page.evaluate(() => curUserName === 'Mix Gm' && window._mlSignedIn === true && window._hwSession === 'perf-session:E4'));
await X.ctx.close();

// ================================================================ 3. PIN_を戻す.sql
await sqlRun(UNDO);
const B = await device(390);
await pickName(B, 'OFFICE', 'Gabe Gm');
ok('戻すと GM にまた「PIN でログイン」が出る', await vis(B.page, 'login-step-mail') && await pinBtn(B.page));
await B.page.evaluate(() => FUNERGY_ML.usePin()); await sleep(300);
ok('PIN の段に切り替えられる', await vis(B.page, 'login-step-pin'));
await pinLogin(B, '2222');
ok('GM が PIN で入る（印あり）', await waitApp(B.page) && await B.page.evaluate(() => curRole === 'gm' && window._hwSession === 'perf-session:E2' && !window._mlSignedIn));
await B.ctx.close();

// ================================================================ まとめ
const errs = all.flatMap(D => D.errors);
ok('pageerror 0', errs.length === 0, errs.slice(0, 3));
const bad = W.dlCalls.filter(c => c.st >= 500 && !(c.st === 503));
ok('device-login の 500 なし', bad.length === 0, bad.slice(0, 2));
await browser.close(); app.close(); ext.close();
const ng = results.filter(r => !r.ok);
console.log(`\n${results.length - ng.length}/${results.length} OK`);
process.exit(ng.length ? 1 : 0);
