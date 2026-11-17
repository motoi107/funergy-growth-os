// v1183：新しいログインの試し（段階 1）を本物のブラウザ（Chrome）で通す。合成データだけ（作りものの人・PIN）。本番にはつながない。
// ・アプリ：このリポジトリの index.html（http://localhost:8091/）
// ・Supabase：tests/perf/mock-api.mjs（PostgREST など）＋ 関数 device-login は本物の handler と本物の SQL（PGlite）
//   PIN の確かめ（auth-pin）とログインの印は代わり（印は perf-session:<社員 ID>。本物の印の形は公開しない 1 ファイルで別に確かめる）
// 使い方：VENDOR_DIR=/tmp/e2e/vendor CERT_DIR=/tmp/e2e/cert [SHOTS=/tmp/dlshots] node tests/e2e-login/device-login-v1183.mjs
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
const PORT = 8091, ORIGIN = `http://localhost:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond, info }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

// ---------------------------------------------------------------- 作りものの人
const STORES = [['F01', 'Store A'], ['F02', 'Store B']].map(([id, name]) => ({ id, name, brand: 'Brand', color: '#335577', am: '', toastGuid: '', hours: '11:00-22:00', days: '毎日', active: true }));
const PEOPLE = [
  { id: 'E1', name: 'Cora Ceo', role: 'ceo', store: 'ALL', title: 'CEO', mgr: 'ceo' },
  { id: 'E2', name: 'Gabe Gm', role: 'gm', store: 'ALL', title: 'General Manager', mgr: 'gm' },
  { id: 'S1', name: 'Aki Test', role: 'crew', store: 'F01', title: 'Crew' },
  { id: 'S2', name: 'Ben Test', role: 'sl', store: 'F01', title: 'Server Leader' },
  { id: 'S4', name: 'Dee Test', role: 'office', store: 'ALL', title: 'Accountant' },
  { id: 'S5', name: 'Pat Default', role: 'crew', store: 'F02', title: 'Crew' },
];
const PINS = { 'Cora Ceo': '1111', 'Gabe Gm': '2222', 'Aki Test': '246813', 'Ben Test': '1357', 'Dee Test': '9753', 'Pat Default': '0000' };
const UID = { gm: '00000000-0000-4000-8000-0000000000c2', ceo: '00000000-0000-4000-8000-0000000000c1' };
const EMP = p => ({ id: p.id, name: p.name, role: p.role, store: p.store, support: [], emp: '正社員', step: 2, status: '在籍', perms: 'staff', coef: 1, title: p.title, firstWorkDate: '2025-01-10' });

// ---------------------------------------------------------------- 本物の device-login（PGlite）
const pg = new PGlite();
await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
  create table public.employees(id text primary key, name text, status text, role text, store text, data jsonb);
  grant select on public.manager_auth, public.employees to service_role;`);
for (const p of PEOPLE) await pg.query(`insert into public.employees values ($1,$2,'在籍',$3,$4,'{}')`, [p.id, p.name, p.role, p.store]);
await pg.query('insert into public.manager_auth values ($1,$2,$3),($4,$5,$6)', [UID.gm, 'gm', 'E2', UID.ceo, 'ceo', 'E1']);
await pg.exec(fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261203090000_device_login.sql'), 'utf8'));
await pg.exec('set role service_role');
// PostgREST と同じく、無い関数は 404（v1186 の login_info は SQL がまだなら「止めていない」）
const db = { async rpc(name, p) {
  try { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; }
  catch (e) { if (/does not exist/.test(e.message)) { const x = new Error('Could not find the function'); x.status = 404; throw x; } throw e; }
} };
const q = async (sql, args) => { await pg.exec('reset role'); try { return (await pg.query(sql, args)).rows; } finally { await pg.exec('set role service_role'); } };
const TOK = { 'tok-gm': UID.gm, 'tok-ceo': UID.ceo };
const W = { dlOff: false, epNew: false, pinCalls: [], dlCalls: [] };
const dl = createHandler({
  env: k => ({ SUPABASE_URL: 'https://tgbhgxzehzeouopklhje.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: ANON, DL_ALLOWED_ORIGINS: ORIGIN })[k],
  db,
  fetch: async (url, init) => {
    if (String(url).endsWith('/auth/v1/user')) { const id = TOK[String(init.headers.authorization || '').replace('Bearer ', '')]; return id ? Response.json({ id }) : new Response('{}', { status: 401 }); }
    throw new Error('unexpected ' + url);
  },
  pinCheck: async (name, emp, pin) => { W.pinCalls.push(name); if (pin === '0000' && PINS[name] === '0000') return { ok: true, mark: false }; return PINS[name] === pin ? { ok: true, mark: true } : { ok: false }; },
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
  if (u.pathname === '/functions/v1/device-login') {
    if (W.dlOff) return { status: 404, body: 'Requested function was not found', headers: { 'content-type': 'text/plain' } };
    let a = ''; try { a = JSON.parse(body || '{}').action; } catch (e) {}
    const h = { 'content-type': 'application/json', 'user-agent': String(headers['user-agent'] || ''), 'x-forwarded-for': '127.0.0.1' };
    if (headers.origin) h.origin = headers.origin; if (headers.authorization) h.authorization = headers.authorization;
    const res = await dl(new Request('https://fn.local/device-login', { method, headers: h, body: method === 'POST' ? body : undefined }));
    const txt = await res.text(); W.dlCalls.push({ a, st: res.status, body: body, out: txt.slice(0, 300) });
    return { status: res.status, body: txt, headers: { 'content-type': 'application/json' } };
  }
  if (u.pathname === '/functions/v1/auth-pin') {
    let j = {}; try { j = JSON.parse(body || '{}'); } catch (e) {}
    if (j.action === 'verify') {
      const p = PEOPLE.find(x => x.id === String(j.emp || '') || x.name === j.key);
      if (!p || PINS[p.name] !== String(j.pin)) return J({ ok: false });
      return J(PINS[p.name] === '0000' ? { ok: true } : { ok: true, token: 'perf-session:' + p.id });
    }
    return J({ ok: true });
  }
  if (u.pathname === '/functions/v1/emp-private') {
    // v1185：給与の関数。ふだんは今の本番（v5＝PIN だけ・印は 401）。W.epNew なら v1185（公開しない 1 ファイル＝印でも）
    let j = {}; try { j = JSON.parse(body || '{}'); } catch (e) {}
    const m = /^perf-session:(.+)$/.exec(String(j.token || ''));
    const p = (W.epNew && m) ? PEOPLE.find(x => x.id === m[1]) : PEOPLE.find(x => x.name === j.name && PINS[x.name] === String(j.pin || ''));
    if (!p) return J({ ok: false, error: 'unauthorized' }, 401);
    return J({ ok: true, private: { [p.id]: { wage: 20, email: '', phone: '', monthlySalary: null } } });
  }
  if (u.pathname === '/auth/v1/token') {
    let j = {}; try { j = JSON.parse(body || '{}'); } catch (e) {}
    if (j.email === 'gm@test.example' && j.password === 'pw') return J({ access_token: 'tok-gm', refresh_token: 'rt-gm' });
    return J({ error: 'invalid_grant' }, 400);
  }
  if (u.pathname === '/auth/v1/user') { const id = TOK[String(headers.authorization || '').replace('Bearer ', '')]; return id ? J({ id }) : J({}, 401); }
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
async function device(width = 390, lang) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 844 }, serviceWorkers: 'block' });
  if (lang) await ctx.addInitScript(l => { try { localStorage.setItem('funergy_lang', l); } catch (e) {} }, lang);
  const page = await ctx.newPage();
  const dialogs = [], errors = [];
  page.on('dialog', d => { dialogs.push(d.message().slice(0, 200)); d.accept(); });
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
  return { ctx, page, dialogs, errors };
}
const inApp = page => page.evaluate(() => { const s = document.getElementById('app-shell'); return !!(s && s.style.display !== 'none' && typeof curUserName !== 'undefined' && curUserName); });
const waitApp = page => page.waitForFunction(() => { const s = document.getElementById('app-shell'); return !!(s && s.style.display !== 'none' && curUserName) && window._heavyPending === false; }, null, { timeout: 90000 }).then(() => true, () => false);
const dlText = page => page.evaluate(() => { const e = document.getElementById('dl-screen'); return e && !e.hidden ? e.innerText : ''; });
const waitDl = (page, re) => page.waitForFunction(r => { const e = document.getElementById('dl-screen'); return !!(e && !e.hidden && new RegExp(r).test(e.innerText)); }, re.source, { timeout: 30000 }).then(() => true, () => false);
const overflowX = page => page.evaluate(() => { const e = document.getElementById('dl-screen'); return e ? e.scrollWidth - e.clientWidth : 0; });
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
async function pinLogin(D, store, name) {
  const { page } = D;
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length >= 2, null, { timeout: 60000 });
  await page.evaluate(s => loginPickLocation(s), store); await sleep(400);
  await page.locator('#login-name-grid .store-btn', { hasText: name }).first().click();
  await sleep(200);
  // v1185：GM・CEO・経理はメールとパスワードの段が出る → 試しのあいだは「PIN でログイン」で PIN の段へ
  if (await page.evaluate(() => { const m = document.getElementById('login-step-mail'); return !!(m && m.style.display !== 'none'); })) { await page.click('#ml-pin'); await sleep(200); }
  await page.fill('#login-pin-input', PINS[name]); await page.click('#login-pin-btn');
  return waitApp(page);
}

// ================================================================ 1. GM：試す人を足して招待のリンクを作る（メールで認証）
const GM = await device(1280);
ok('GM はいつもの PIN でログインできる（v1185：メールの段の「PIN でログイン」から）', await pinLogin(GM, 'OFFICE', 'Gabe Gm'));
await GM.page.evaluate(() => go('staff_master')); await sleep(1200);
ok('従業員マスターに「ログインの試し」（GM・CEO）', await GM.page.evaluate(() => /ログインの試し/.test(document.body.innerText)));
await GM.page.evaluate(() => FUNERGY_DL.admin());
await GM.page.waitForSelector('#invin-email', { timeout: 10000 });
ok('はじめはメール認証の画面（PIN では開けない）', true);
await GM.page.fill('#invin-email', 'gm@test.example'); await GM.page.fill('#invin-password', 'pw');
await GM.page.evaluate(() => { const k = document.getElementById('invin-keep'); if (k) k.checked = false; });
await GM.page.evaluate(() => secAuthLogin());
await GM.page.waitForSelector('#dl-a-add', { timeout: 15000 });
ok('認証のあと試しの一覧', /まだだれもいません/.test(await GM.page.evaluate(() => document.getElementById('modal-body').innerText)));
const optList = await GM.page.evaluate(() => Array.from(document.querySelectorAll('#dl-a-add option')).map(o => o.textContent));
ok('足す候補に GM・CEO は出ない', !optList.some(t => /Gabe Gm|Cora Ceo/.test(t)) && optList.some(t => /Aki Test/.test(t)), optList);
const links = {};
for (const [id, name] of [['S1', 'Aki Test'], ['S4', 'Dee Test'], ['S5', 'Pat Default'], ['S2', 'Ben Test']]) {
  await GM.page.selectOption('#dl-a-add', id); await GM.page.evaluate(() => FUNERGY_DL.aAdd());
  await GM.page.waitForFunction(n => new RegExp(n).test(document.getElementById('modal-body').innerText) && !document.querySelector('#dl-a-add option[value="' + 'X' + '"]'), name, { timeout: 10000 });
  await sleep(300);
  await GM.page.evaluate(i => FUNERGY_DL.aInvite(i), id);
  await GM.page.waitForSelector('#dl-a-url', { timeout: 10000 });
  links[id] = await GM.page.evaluate(() => document.getElementById('dl-a-url').value);
}
ok('招待のリンクは ?dl= と 43 文字', Object.values(links).every(u => /^http:\/\/localhost:8091\/\?dl=[A-Za-z0-9_-]{43}$/.test(u)), links.S1);
ok('一覧に「招待中」', /招待中/.test(await GM.page.evaluate(() => document.getElementById('modal-body').innerText)));
ok('LINE とテキストの送り先がある', await GM.page.evaluate(() => !!document.querySelector('a[href^="https://line.me/R/share?text="]') && !!document.querySelector('a[href^="sms:"]')));
ok('データベースには招待の値そのものは無い（sha-256 だけ）', (await q('select token_hash from public.dl_invites')).every(r => !Object.values(links).some(u => u.includes(r.token_hash))) && (await q('select count(*)::int n from public.dl_invites'))[0].n === 4);
await shot(GM.page, 'gm-admin-1280');

// ================================================================ 2. スタッフ（iPhone の幅）：招待のリンクを開いて登録
const A = await device(390);
await A.page.goto(links.S1);
ok('招待の画面：名前を先に出す（段階 2 PIN）', await waitDl(A.page, /Aki Test/));
const t1 = await dlText(A.page);
ok('段階が上に（確かめる・PIN・完了）', /確かめる/.test(t1) && /PIN/.test(t1) && /完了/.test(t1));
ok('主ボタンは下に固定', await A.page.evaluate(() => { const f = document.querySelector('.dl-foot'); return !!f && getComputedStyle(f).position === 'fixed' && /この端末を登録してログイン/.test(f.innerText); }));
ok('390px で横にはみ出さない', (await overflowX(A.page)) <= 0);
await shot(A.page, 'invite-390');
await A.page.fill('#dl-pin', '11112222'); await A.page.evaluate(() => FUNERGY_DL.register());
await A.page.waitForFunction(() => { const e = document.getElementById('dl-err'); return e && e.style.display === 'block'; }, null, { timeout: 15000 });
const e1 = await A.page.evaluate(() => document.getElementById('dl-err').textContent);
ok('PIN を間違えると「あと N 回」', /PINが違います/.test(e1) && /あと 4 回/.test(e1), e1);
await A.page.fill('#dl-pin', PINS['Aki Test']); await A.page.fill('#dl-dname', 'Aki iPhone');
await A.page.evaluate(() => FUNERGY_DL.register());
ok('正しい PIN で登録してそのまま入る', await waitApp(A.page));
ok('入った人は Aki Test（登録のときの PIN はこの回だけメモリに・印あり）', await A.page.evaluate(() => curUserName === 'Aki Test' && window._dlSignedIn === true && window._sessionPin === '246813' && /^perf-session:S1$/.test(window._hwSession || '')), await A.page.evaluate(() => ({ n: curUserName, s: window._dlSignedIn, pin: !!window._sessionPin })));
ok('URL から ?dl= を消した', await A.page.evaluate(() => !/[?&]dl=/.test(location.href)));
const recA = await A.page.evaluate(() => localStorage.getItem('_dl_dev_v1'));
ok('この端末に残すのは端末の番号と名前だけ（PIN・印なし）', !!recA && !/246813|perf-session|token/.test(recA) && /Aki iPhone/.test(recA), recA);
ok('鍵は取り出せない（IndexedDB の CryptoKey・extractable false）', await A.page.evaluate(async () => { const k = await FUNERGY_DL._t.keyGet('device'); if (!k || k.extractable !== false || k.type !== 'private') return false; try { await crypto.subtle.exportKey('jwk', k); return false; } catch (e) { return true; } }));
const dbDev = await q('select emp_id, name, pubkey, ask_pin from public.dl_devices');
ok('サーバーには公開鍵だけ（d が無い）', dbDev.length === 1 && dbDev[0].emp_id === 'S1' && !('d' in dbDev[0].pubkey) && dbDev[0].pubkey.kty === 'EC', dbDev.map(d => Object.keys(d.pubkey)));

// ================================================================ 3. 開き直すと PIN なしで入る
const pinsBefore = W.pinCalls.length;
await A.page.reload();
ok('開き直すと開くだけで入る', await waitApp(A.page));
ok('PIN を確かめていない（auth-pin を呼ばない）', W.pinCalls.length === pinsBefore && await A.page.evaluate(() => curUserName === 'Aki Test' && !window._sessionPin));
await A.page.evaluate(() => go('mypage')); await sleep(1500);
ok('マイページに「この端末のログイン（試し）」', /この端末のログイン（試し）/.test(await A.page.evaluate(() => document.body.innerText)));
const payBtn = await A.page.evaluate(() => /時給を読むには PIN を 1 回/.test(document.body.innerText));
ok('給与の見込みに「PIN を 1 回」の案内（PIN なしで入ったため・給与の関数が v5 のまま）', payBtn);
W.epNew = true;
await A.page.evaluate(async () => { await fetchEmpPrivate(); go('mypage'); }); await sleep(1200);
ok('v1185：給与の関数が印を受けると PIN なしで時給を読む（案内は出ない）', await A.page.evaluate(() => !!(window._empPrivate && window._empPrivate.S1) && !/時給を読むには PIN を 1 回/.test(document.body.innerText)));
W.epNew = false;
ok('Invoice取込の「初期 PIN」扱いにしない', await A.page.evaluate(() => typeof invInDefaultPin === 'function' && invInDefaultPin() === false));
await shot(A.page, 'mypage-390');

// 印の取り替え（30 分ごと）
const n0 = W.dlCalls.length;
await A.page.evaluate(() => FUNERGY_DL.refresh(true)); await sleep(800);
ok('印の取り替え（refresh）が通る', W.dlCalls.slice(n0).some(c => c.a === 'start' && /"mode":"refresh"/.test(c.body) && c.st === 200) && await A.page.evaluate(() => curUserName === 'Aki Test'));

// ================================================================ 4. 端末と設定：開くたびに PIN
await A.page.evaluate(() => FUNERGY_DL.devices());
await A.page.waitForFunction(() => /ログインの端末/.test(document.getElementById('modal-body').innerText) && /Aki iPhone/.test(document.getElementById('modal-body').innerText), null, { timeout: 10000 });
ok('端末の一覧に「この端末」', /この端末/.test(await A.page.evaluate(() => document.getElementById('modal-body').innerText)));
await A.page.evaluate(() => FUNERGY_DL.askPin(true)); await sleep(800);
ok('「開くたびに PIN」をサーバーに保存', (await q('select ask_pin from public.dl_devices'))[0].ask_pin === true);
await A.page.evaluate(() => closeModalDirect());
await A.page.reload();
ok('開くたびに PIN：名前と PIN の画面', await waitDl(A.page, /Aki Test[\s\S]*PIN/));
await A.page.fill('#dl-pin', '99998888'); await A.page.evaluate(() => FUNERGY_DL.reauth());
await A.page.waitForFunction(() => { const e = document.getElementById('dl-err'); return e && e.style.display === 'block'; }, null, { timeout: 10000 });
ok('PIN を間違えると入れない', /PINが違います/.test(await A.page.evaluate(() => document.getElementById('dl-err').textContent)) && !(await inApp(A.page)));
await A.page.fill('#dl-pin', PINS['Aki Test']); await A.page.evaluate(() => FUNERGY_DL.reauth());
ok('正しい PIN で入る（この回は PIN がメモリにある）', await waitApp(A.page) && await A.page.evaluate(() => window._sessionPin === '246813' && window._dlSignedIn === true));
await A.page.evaluate(() => FUNERGY_DL.askPin(false)); await sleep(600);

// ================================================================ 5. ログアウト → 次は PIN
await A.page.evaluate(() => doLogout()); await sleep(1200);
ok('ログアウトのあとログイン画面に「Aki Test さん：この端末でログイン」', await A.page.evaluate(() => { const e = document.getElementById('dl-entry'); return !!e && /Aki Test さん：この端末でログイン/.test(e.innerText) && document.getElementById('app-shell').style.display === 'none'; }));
ok('ログアウトでメモリの PIN と印を消した', await A.page.evaluate(() => !window._sessionPin && !window._hwSession && !window._dlSignedIn));
await A.page.evaluate(() => FUNERGY_DL.start());
ok('ログアウトのあとは PIN を聞く', await waitDl(A.page, /続けるには/));
await A.page.fill('#dl-pin', PINS['Aki Test']); await A.page.evaluate(() => FUNERGY_DL.reauth());
ok('PIN でまた入る', await waitApp(A.page));

// ================================================================ 6. 同じリンクは 2 回使えない・初期の PIN・経理
const B = await device(390);
await B.page.goto(links.S1);
ok('使ったリンクは「もう使われています」', await waitDl(B.page, /もう使われています/));
await B.ctx.close();
const P = await device(390);
await P.page.goto(links.S5);
await waitDl(P.page, /Pat Default/);
await P.page.fill('#dl-pin', '0000'); await P.page.evaluate(() => FUNERGY_DL.register());
await P.page.waitForFunction(() => { const e = document.getElementById('dl-err'); return e && e.style.display === 'block'; }, null, { timeout: 15000 });
ok('PIN が初期のまま（0000）の人は登録できない', /初期のまま/.test(await P.page.evaluate(() => document.getElementById('dl-err').textContent)) && (await q(`select count(*)::int n from public.dl_devices where emp_id = 'S5'`))[0].n === 0);
await P.ctx.close();
const DE = await device(1280);
await DE.page.goto(links.S4);
ok('PC の幅（1280）は 2 列', await waitDl(DE.page, /Dee Test/) && await DE.page.evaluate(() => getComputedStyle(document.querySelector('.dl-grid')).gridTemplateColumns.split(' ').length === 2));
ok('1280px で横にはみ出さない', (await overflowX(DE.page)) <= 0);
await shot(DE.page, 'invite-1280');
await DE.page.fill('#dl-pin', PINS['Dee Test']); await DE.page.evaluate(() => FUNERGY_DL.register());
ok('経理も登録して入る（PIN がメモリにある）', await waitApp(DE.page) && await DE.page.evaluate(() => window._sessionPin === '9753'));
await DE.page.reload();
ok('経理は開くたびに PIN（機密の画面が PIN を使うため）', await waitDl(DE.page, /Dee Test[\s\S]*続けるには/));
await DE.ctx.close();

// ================================================================ 7. GM が外すと、その端末は次の取り替えでログアウト
await GM.page.evaluate(() => FUNERGY_DL.aDevices('S1'));
await GM.page.waitForFunction(() => /Aki iPhone/.test(document.getElementById('modal-body').innerText), null, { timeout: 10000 });
await GM.page.evaluate(() => FUNERGY_DL.aRevoke('S1', null)); await sleep(1000);
ok('GM が端末を外した（サーバー）', (await q(`select count(*)::int n from public.dl_devices where emp_id = 'S1' and revoked_at is not null`))[0].n === 1);
await A.page.evaluate(() => FUNERGY_DL.refresh(true)); await sleep(2500);
ok('外された端末はログアウトし、登録を忘れる', await A.page.evaluate(() => document.getElementById('app-shell').style.display === 'none' && !localStorage.getItem('_dl_dev_v1')));
ok('ログイン画面に理由', /使えなくなりました/.test(await A.page.evaluate(() => (document.getElementById('dl-login-note') || {}).textContent || '')));
ok('外されたあとも、いつもの PIN でログインできる', await pinLogin(A, 'F01', 'Aki Test'));

// ================================================================ 8. 関数がまだ無い（404）・英語・試しの外の人
W.dlOff = true;
const N = await device(390);
await N.page.goto(links.S2);
ok('関数が無いときは「まだ使えません」と出す', await waitDl(N.page, /まだサーバーで使えるようになっていません/));
await N.page.evaluate(() => FUNERGY_DL.toLogin()); await sleep(400);
ok('いつものログインへ戻れる', await N.page.evaluate(() => document.getElementById('dl-screen').hidden === true && document.querySelectorAll('#login-store-grid .store-btn').length >= 2));
await N.ctx.close();
W.dlOff = false;
const EN = await device(390, 'en');
await EN.page.goto(links.S2);
ok('英語の画面', await waitDl(EN.page, /Register this device for[\s\S]*Ben Test/) && /Register this device and log in/.test(await dlText(EN.page)));
await EN.page.goto(ORIGIN + '/?dl=short'); await sleep(2500);
ok('形の合わないリンクは登録の画面を出さず理由', await EN.page.evaluate(() => (document.getElementById('dl-screen') || { hidden: true }).hidden !== false && /not valid/.test((document.getElementById('dl-login-note') || {}).textContent || '')));
await EN.ctx.close();

// ================================================================ まとめ
const errs = [GM, A].flatMap(D => D.errors);
ok('pageerror 0', errs.length === 0, errs.slice(0, 3));
const bad = W.dlCalls.filter(c => c.st >= 500);
ok('device-login の 500 なし', bad.length === 0, bad.slice(0, 2));
await browser.close(); app.close(); ext.close();
const ng = results.filter(r => !r.ok);
console.log(`\n${results.length - ng.length}/${results.length} OK`);
process.exit(ng.length ? 1 : 0);
