// v1185：GM・CEO・経理はメールとパスワードでログイン（段階 2）を本物のブラウザ（Chrome）で通す。合成データだけ（作りものの人・メール・パスワード）。本番にはつながない。
// ・アプリ：このリポジトリの index.html（http://localhost:8092/）
// ・Supabase：tests/perf/mock-api.mjs（PostgREST など）＋ 関数 device-login は本物の handler と本物の SQL（PGlite・v1183 と v1185）
//   Supabase Auth（パスワード・鍵の取り替え・ログアウト）・PIN の確かめ（auth-pin）・emp-private は代わり。ログインの印は perf-session:<社員 ID>（本物の形は公開しない 1 ファイルで別に確かめる）
// 使い方：VENDOR_DIR=/tmp/e2e/vendor CERT_DIR=/tmp/e2e/cert [SHOTS=/tmp/mlshots] node tests/e2e-login/email-login-v1185.mjs
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
const PORT = 8092, ORIGIN = `http://localhost:${PORT}`;
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
const PINS = { 'Cora Ceo': '1111', 'Gabe Gm': '2222', 'Dee Office': '9753', 'Aki Test': '246813' };
const UID = { ceo: '00000000-0000-4000-8000-0000000000c1', gm: '00000000-0000-4000-8000-0000000000c2', office: '00000000-0000-4000-8000-0000000000c3' };
const ACC = { 'ceo@test.example': ['pw-ceo', UID.ceo], 'gm@test.example': ['pw-gm', UID.gm], 'office@test.example': ['pw-office', UID.office] };
const EMP = p => ({ id: p.id, name: p.name, role: p.role, store: p.store, support: [], emp: '正社員', step: 2, status: '在籍', perms: 'staff', coef: 1, title: p.title, firstWorkDate: '2025-01-10' });

// ---------------------------------------------------------------- 本物の device-login（PGlite）
const pg = new PGlite();
await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
  create table public.employees(id text primary key, name text, status text, role text, store text, data jsonb);
  create table public.app_state(key text primary key, value jsonb, updated_at timestamptz not null default now());
  grant select on public.manager_auth, public.employees to service_role; grant select, insert, update on public.app_state to service_role;`);
for (const p of PEOPLE) await pg.query(`insert into public.employees values ($1,$2,'在籍',$3,$4,'{}')`, [p.id, p.name, p.role, p.store]);
await pg.query('insert into public.manager_auth values ($1,$2,$3),($4,$5,$6),($7,$8,$9)', [UID.ceo, 'ceo', 'E1', UID.gm, 'gm', 'E2', UID.office, 'office', 'E3']);
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
  app_settings: [], employees: PEOPLE.map(p => ({ id: p.id, name: p.name, role: p.role, data: EMP(p) })),
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
      const p = PEOPLE.find(x => x.id === String(j.emp || '') || x.name === j.key);
      if (!p || PINS[p.name] !== String(j.pin)) return J({ ok: false });
      return J({ ok: true, token: 'perf-session:' + p.id });
    }
    return J({ ok: true });
  }
  if (u.pathname === '/functions/v1/emp-private') {
    // v1185 の emp-private（公開しない 1 ファイル）の代わり：印（token）か PIN。W.epOld なら v5（PIN だけ）
    W.ep.push({ action: j.action, token: !!j.token, pin: !!j.pin });
    const m = /^perf-session:(.+)$/.exec(String(j.token || ''));
    const p = (!W.epOld && m) ? PEOPLE.find(x => x.id === m[1]) : PEOPLE.find(x => x.name === j.name && PINS[x.name] === String(j.pin || ''));
    if (!p) return J({ ok: false, error: 'unauthorized' }, 401);
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

// ================================================================ 1. GM（iPhone の幅）：名前を選ぶとメールとパスワード
const G = await device(390);
await pickName(G, 'OFFICE', 'Gabe Gm');
ok('名前の一覧で GM・CEO・経理に盾の印', await G.page.evaluate(() => Array.from(document.querySelectorAll('#login-name-grid .store-btn')).filter(b => b.querySelector('.ti-shield-lock')).map(b => (b.querySelector('div') ? b.querySelector('div').textContent : b.textContent).trim()).sort().join() === 'Cora Ceo,Dee Office,Gabe Gm'));
ok('GM はメールとパスワードの段（PIN の段は出ない）', await vis(G.page, 'login-step-mail') && !(await vis(G.page, 'login-step-pin')));
const m1 = await text(G.page, 'login-step-mail');
ok('名前・メール・パスワード・PIN でログイン（試しのあいだ）', /Gabe Gm/.test(m1) && /メールアドレス/.test(m1) && /パスワード/.test(m1) && /PIN でログイン（試しのあいだ）/.test(m1) && /この端末には覚えません/.test(m1), m1.slice(0, 200));
ok('パスワード欄は password・current-password', await G.page.evaluate(() => { const p = document.getElementById('ml-pass'); return p.type === 'password' && p.autocomplete === 'current-password' && document.getElementById('ml-email').autocomplete === 'username'; }));
ok('390px で横にはみ出さない', (await overflowX(G.page)) <= 0);
await shot(G.page, 'mail-390');
await mailLogin(G, 'gm@test.example', 'nope');
ok('パスワードが違うと「メールまたはパスワードが違います」', /メールまたはパスワードが違います/.test(await errText(G.page)));
ok('違ったときは device-login を呼ばない・パスワード欄を空に', W.dlCalls.filter(c => c.a !== 'login_info').length === 0 && await G.page.evaluate(() => document.getElementById('ml-pass').value === ''));
await mailLogin(G, 'office@test.example', 'pw-office');
ok('ほかの人のメールでは入れない（その人として入れません）', /Gabe Gm さんとして入れません/.test(await errText(G.page)) && W.closed.length === 1);
await mailLogin(G, 'gm@test.example', 'pw-gm');
ok('正しいメールとパスワードで入る', await waitApp(G.page));
ok('PIN を確かめていない・PIN はメモリに無い・印あり', W.pinCalls.length === 0 && await G.page.evaluate(() => curUserName === 'Gabe Gm' && curRole === 'gm' && window._mlSignedIn === true && !window._sessionPin && window._hwSession === 'perf-session:E2'));
ok('給与は印で読めた（PIN を聞かない）', W.ep.some(e => e.action === 'pull' && e.token && !e.pin) && await G.page.evaluate(() => !!(window._empPrivate && window._empPrivate.S1)) && !(await G.page.evaluate(() => (document.getElementById('modal-overlay') || {}).classList?.contains('open'))));
const ls = await G.page.evaluate(() => Object.keys(localStorage).filter(k => /ml|auth|sb-/i.test(k)).map(k => [k, localStorage.getItem(k)]));
ok('この端末に残すのは端末の番号だけ（鍵・印・メール・パスワードなし）', ls.length === 1 && ls[0][0] === '_ml_dev_v1' && /^[0-9a-f-]{36}$/.test(ls[0][1]) && await G.page.evaluate(() => !JSON.stringify(Object.assign({}, localStorage)).match(/at-\d|rt-\d|perf-session|pw-gm|gm@test/)), ls);
const ns = (await q(`select value from app_state where key = 'notifications'`))[0];
ok('新しい端末：本人とほかの GM・CEO に知らせ（サーバー）', ns && ns.value.length === 2 && ns.value[0].toUser === 'Gabe Gm' && /iPhone · Safari/.test(ns.value[0].text) && ns.value[1].toRoles.join() === 'ceo,gm', ns && ns.value.map(x => x.title));

// ================================================================ 2. マイページ：管理者セキュアページをアプリの中から
await G.page.evaluate(() => go('mypage')); await sleep(1500);
const my = await G.page.evaluate(() => document.body.innerText);
ok('マイページに「メールとパスワードでログイン中」と 3 つのボタン', /メールとパスワードでログイン中/.test(my) && /管理者セキュアページを開く/.test(my) && /すべての端末からログアウト/.test(my) && !/時給を読むには PIN/.test(my));
await shot(G.page, 'mypage-390');
await G.page.evaluate(() => FUNERGY_ML.openSecure());
await G.page.waitForFunction(() => { const s = document.getElementById('manager-secure-screen'); return s && s.style.display === 'block'; }, null, { timeout: 20000 });
ok('メールを入れ直さずに管理者セキュアページ', W.pw.length === 3 && await vis(G.page, 'mgr-back-app') && !(await vis(G.page, 'app-shell')));
await sleep(1200); await shot(G.page, 'secure-390');
await G.page.click('#mgr-back-app'); await sleep(1200);
ok('「アプリに戻る」でマイページ・役割・名前が戻る', await G.page.evaluate(() => document.getElementById('app-shell').style.display === 'block' && curPage === 'mypage' && curUserName === 'Gabe Gm' && curRole === 'gm' && !window._secureMode && document.getElementById('manager-secure-screen').style.display === 'none'));

// ================================================================ 3. 裏の取り替え・止めたらログアウト
const k0 = W.dlCalls.length;
await G.page.evaluate(() => { window._authSession.exp = Date.now(); return FUNERGY_ML.refresh(true); }); await sleep(600);
ok('鍵と印の取り替え（refresh）', W.dlCalls.slice(k0).some(c => c.a === 'email_login' && c.mode === 'refresh' && c.st === 200) && await G.page.evaluate(() => window._mlSignedIn === true && /^at-/.test(window._authSession.access_token) && window._authSession.email === 'gm@test.example'));
await q(`update public.manager_auth set role = 'suspended' where emp_id = 'E2'`);
await G.page.evaluate(() => FUNERGY_ML.refresh(true)); await sleep(2000);
ok('アカウントを止めると、次の取り替えでログアウトして理由', await G.page.evaluate(() => document.getElementById('app-shell').style.display === 'none' && !window._mlSignedIn && !window._authSession && /使えません/.test((document.getElementById('ml-login-note') || {}).textContent || '')));
await q(`update public.manager_auth set role = 'gm' where emp_id = 'E2'`);

// ================================================================ 4. PIN でも入れる（試しのあいだ）
await pickName(G, 'OFFICE', 'Gabe Gm');
await G.page.click('#ml-pin'); await sleep(300);
ok('「PIN でログイン」で PIN の段', await vis(G.page, 'login-step-pin') && !(await vis(G.page, 'login-step-mail')));
ok('GM の PIN の段の下は「メールとパスワードでログイン」', /メールとパスワードでログイン/.test(await G.page.textContent('#mgr-login-entry-btn')));
await G.page.click('#mgr-login-entry-btn'); await sleep(300);
ok('PIN の段の「メールとパスワードでログイン」で戻る', await vis(G.page, 'login-step-mail'));
await G.page.click('#ml-pin'); await sleep(300);
await G.page.fill('#login-pin-input', PINS['Gabe Gm']); await G.page.click('#login-pin-btn');
ok('GM も PIN で入れる（試しのあいだ）', await waitApp(G.page) && await G.page.evaluate(() => curUserName === 'Gabe Gm' && window._sessionPin === '2222' && !window._mlSignedIn));
await G.page.evaluate(() => doLogout()); await sleep(800);

// ================================================================ 5. スタッフはいつもの PIN・経理（PC）・CEO
await pickName(G, 'F01', 'Aki Test');
ok('スタッフはいつもの PIN の段', await vis(G.page, 'login-step-pin') && !(await vis(G.page, 'login-step-mail')));
ok('スタッフの PIN の段の下は前と同じ「メールで管理者ログイン」', /メールで管理者ログイン/.test(await G.page.textContent('#mgr-login-entry-btn')));
await G.ctx.close();
const O = await device(1280);
await pickName(O, 'OFFICE', 'Dee Office');
ok('経理もメールとパスワード（PC）', await vis(O.page, 'login-step-mail'));
ok('1280px で横にはみ出さない', (await overflowX(O.page)) <= 0);
await shot(O.page, 'mail-1280');
// 給与の関数が前の版（PIN だけ）なら：入ったあと PIN を 1 回聞く
W.epOld = true;
await mailLogin(O, 'office@test.example', 'pw-office');
ok('経理が入る', await waitApp(O.page));
const asked = await O.page.waitForSelector('#ipm-val', { timeout: 15000 }).then(() => true, () => false);
ok('給与の関数が前の版なら、PIN を 1 回聞く（理由つき）', asked && /給与・人件費/.test(await O.page.evaluate(() => document.getElementById('modal-body').innerText)));
await O.page.fill('#ipm-val', PINS['Dee Office']); await O.page.evaluate(() => submitInputModal());
await sleep(1500);
ok('PIN を入れると給与を読む（印は残す）', await O.page.evaluate(() => !!(window._empPrivate && window._empPrivate.S1) && window._sessionPin === '9753' && /^perf-session:E3$/.test(window._hwSession || '')));
W.epOld = false;
// すべての端末からログアウト
await O.page.evaluate(() => go('mypage')); await sleep(1200);
await O.page.evaluate(() => FUNERGY_ML.logoutAll()); await sleep(1500);
ok('すべての端末からログアウト（サーバー：global）', W.closed.at(-1) === 'global' && await O.page.evaluate(() => document.getElementById('app-shell').style.display === 'none' && !window._mlSignedIn));
await O.ctx.close();

// ================================================================ 6. 英語・関数がまだ（v1183 の関数）
const EN = await device(390, 'en');
await pickName(EN, 'OFFICE', 'Cora Ceo');
const me = await text(EN.page, 'login-step-mail');
ok('英語の画面', /Log in with email and password/.test(me) && /Log in with PIN \(during the trial\)/.test(me), me.slice(0, 160));
W.dlOff = true;
await mailLogin(EN, 'ceo@test.example', 'pw-ceo');
ok('関数が無いときは「PIN でログインを」と出す（前の入り方のボタンも）', /not ready on the server yet/.test(await errText(EN.page)) && await EN.page.evaluate(() => document.querySelectorAll('#ml-err button').length === 1));
W.dlOff = false;
await mailLogin(EN, 'ceo@test.example', 'pw-ceo');
ok('CEO も入る', await waitApp(EN.page) && await EN.page.evaluate(() => curRole === 'ceo' && window._mlSignedIn === true));
await EN.page.evaluate(() => doLogout()); await sleep(800);
ok('ログアウトでメールのログインをサーバー側でも閉じる', W.closed.at(-1) === 'local' && await EN.page.evaluate(() => !window._authSession && !window._hwSession));
await EN.ctx.close();

// ================================================================ まとめ
const errs = all.flatMap(D => D.errors);
ok('pageerror 0', errs.length === 0, errs.slice(0, 3));
const bad = W.dlCalls.filter(c => c.st >= 500 && !(c.st === 503));
ok('device-login の 500 なし', bad.length === 0, bad.slice(0, 2));
await browser.close(); app.close(); ext.close();
const ng = results.filter(r => !r.ok);
console.log(`\n${results.length - ng.length}/${results.length} OK`);
process.exit(ng.length ? 1 : 0);
