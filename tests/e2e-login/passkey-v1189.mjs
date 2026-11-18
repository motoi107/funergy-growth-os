// v1189：パスキーとメールのコードでログイン（UI案92・Moto さん 11/17 12:38 HST）を本物のブラウザ（Chrome）で通す。合成データだけ（作りものの人・メール・パスワード）。本番にはつながない。
// ・アプリ：このリポジトリの index.html（http://localhost:8094/）
// ・Supabase：tests/perf/mock-api.mjs（PostgREST など）＋ 関数 device-login は本物の handler と本物の SQL（PGlite・v1183〜v1189）
//   Supabase Auth（利用者・パスキー）・Google（送信）・auth-pin・emp-private は代わり。パスキーは Chrome の仮想の認証器（CDP の WebAuthn）で作って使う
//   （代わりのパスキー API は clientDataJSON の type・challenge・origin を確かめる）。ログインの印は perf-session:<社員 ID>
// 使い方：VENDOR_DIR=/tmp/e2e/vendor CERT_DIR=/tmp/e2e/cert [SHOTS=/tmp/pkshots] node tests/e2e-login/passkey-v1189.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createMock } from '../perf/mock-api.mjs';
import { createHandler } from '../../supabase/functions/device-login/handler.mjs';

for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const APP_DIR = process.env.APP_DIR || ROOT;
const VENDOR = process.env.VENDOR_DIR || '/tmp/e2e/vendor', CERT = process.env.CERT_DIR || '/tmp/e2e/cert', SHOTS = process.env.SHOTS || '';
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || path.join(ROOT, 'tests/runtime/node_modules/@electric-sql/pglite/dist/index.js'));
const ANON = (fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8').match(/const SUPABASE_ANON = '([^']+)'/) || [])[1];
const PORT = 8094, ORIGIN = `http://localhost:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond, info }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// ---------------------------------------------------------------- 作りものの人
const STORES = [['F01', 'Store A'], ['F02', 'Store B']].map(([id, name]) => ({ id, name, brand: 'Brand', color: '#335577', am: '', toastGuid: '', hours: '11:00-22:00', days: '毎日', active: true }));
const PEOPLE = [
  { id: 'E1', name: 'Cora Ceo', role: 'ceo', store: 'ALL', title: 'CEO' },
  { id: 'E2', name: 'Gabe Gm', role: 'gm', store: 'ALL', title: 'General Manager' },
  { id: 'E3', name: 'Dee Office', role: 'office', store: 'ALL', title: 'Accountant' },
  { id: 'S1', name: 'Aki Test', role: 'crew', store: 'F01', title: 'Crew' },
  { id: 'S2', name: 'Bo Pin', role: 'crew', store: 'F01', title: 'Crew' },
];
const PINS = { 'Aki Test': '246813', 'Bo Pin': '135790' };
const UID = { ceo: '00000000-0000-4000-8000-0000000000c1', gm: '00000000-0000-4000-8000-0000000000c2', office: '00000000-0000-4000-8000-0000000000c3' };
const ACC = { 'ceo@test.example': ['pw-ceo', UID.ceo], 'gm@test.example': ['pw-gm', UID.gm], 'office@test.example': ['pw-office', UID.office] };
const FROM = 'sender@test.example', AKI = 'aki@test.example';
const EMP = p => ({ id: p.id, name: p.name, role: p.role, store: p.store, support: [], emp: '正社員', step: 2, status: '在籍', perms: 'staff', coef: 1, title: p.title, firstWorkDate: '2025-01-10' });

// ---------------------------------------------------------------- 本物の device-login（PGlite・v1183〜v1189）
const pg = new PGlite();
await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
  create table public.employees(id text primary key, name text, status text, role text, store text, data jsonb);
  create table public.app_state(key text primary key, value jsonb, updated_at timestamptz not null default now());
  grant select on public.manager_auth, public.employees to service_role; grant select, insert, update on public.app_state to service_role;`);
for (const p of PEOPLE) await pg.query(`insert into public.employees values ($1,$2,'在籍',$3,$4,'{}')`, [p.id, p.name, p.role, p.store]);
await pg.query('insert into public.manager_auth values ($1,$2,$3),($4,$5,$6),($7,$8,$9)', [UID.ceo, 'ceo', 'E1', UID.gm, 'gm', 'E2', UID.office, 'office', 'E3']);
for (const f of ['20261203090000_device_login.sql', '20261205090000_email_login.sql', '20261206090000_top_pin_off.sql', '20261207090000_pin_blocked_id_first.sql'])
  await pg.exec(fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8'));
await pg.exec(fs.readFileSync(path.join(ROOT, 'deploy/passkey-login-v1189/2_SQL.sql'), 'utf8'));
await pg.exec(fs.readFileSync(path.join(ROOT, 'deploy/passkey-login-v1189/4_送り手_SQL.sql'), 'utf8').replace("btrim('ここに送り手のメールアドレス')", `btrim('${FROM}')`));
await pg.exec('set role service_role');
const db = { async rpc(name, p) {
  try { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; }
  catch (e) { if (/does not exist/.test(e.message)) { const x = new Error('Could not find the function'); x.status = 404; throw x; } throw e; }
} };
const q = async (sql, args) => { await pg.exec('reset role'); try { return (await pg.query(sql, args)).rows; } finally { await pg.exec('set role service_role'); } };

// 代わりの Supabase Auth（利用者・ログイン・パスキー）
const S = { users: new Map(), tok: new Map(), rt: new Map(), cred: new Map(), keys: new Map(), chal: new Map(), closed: [], seq: 0, mails: [], pkBad: [] };
for (const [e, [, uid]] of Object.entries(ACC)) S.users.set(uid, { id: uid, email: e, app_metadata: {} });
const issue = uid => { const at = 'at-' + (++S.seq), rt = 'rt-' + S.seq; S.tok.set(at, uid); S.rt.set(rt, uid); return { access_token: at, refresh_token: rt, expires_in: 3600, token_type: 'bearer', user: { id: uid, email: (S.users.get(uid) || {}).email } }; };
const W = { pinCalls: [], dlCalls: [], ep: [] };
// v1186 の auth-pin・emp-private と同じ：SQL の dl_pin_blocked（v1189 でメール＋パスキーの人も止まる）
const blocked = async (name, emp) => (await q(`select public.dl_pin_blocked($1::jsonb)->>'blocked' as b`, [JSON.stringify({ name, emp_id: emp || '' })]))[0].b === 'true';
const readMail = raw => {
  const t = unb64u(raw).toString('utf8'); const [head, body] = t.split('\r\n\r\n');
  const h = Object.fromEntries(head.replace(/\r\n[ \t]/g, ' ').split('\r\n').map(l => [l.slice(0, l.indexOf(':')).toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]));
  return { to: h.to, text: Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8') };
};
const lastMail = to => [...S.mails].reverse().find(m => m.to === to);
const codeOf = m => (m.text.match(/コード：(\d{6})/) || [])[1];
const linkOf = m => (m.text.match(/https?:\/\/\S+[?&]pk=[A-Za-z0-9_-]{43}/) || [])[0];
const SBU = 'https://tgbhgxzehzeouopklhje.supabase.co';
const sfetch = async (url, init = {}) => {
  const u = new URL(String(url)), m = (init.method || 'GET').toUpperCase(), bodyS = typeof init.body === 'string' ? init.body : '';
  const body = bodyS.startsWith('{') ? JSON.parse(bodyS) : bodyS;
  const auth = String((init.headers && (init.headers.authorization || init.headers.Authorization)) || '');
  if (u.origin === SBU) {
    if (u.pathname === '/auth/v1/user') { const id = S.tok.get(auth.replace('Bearer ', '')); return id && S.users.has(id) ? Response.json({ id }) : new Response('{}', { status: 401 }); }
    if (u.pathname === '/auth/v1/admin/users' && m === 'POST') {
      if ([...S.users.values()].some(x => x.email === body.email)) return Response.json({ error_code: 'email_exists' }, { status: 422 });
      const id = crypto.randomUUID(); S.users.set(id, { id, email: body.email, app_metadata: body.app_metadata || {} }); return Response.json(S.users.get(id));
    }
    if (u.pathname === '/auth/v1/admin/generate_link') {
      const x = [...S.users.values()].find(v => v.email === body.email); if (!x) return new Response('{}', { status: 404 });
      const th = 'th-' + (++S.seq); S.tok.set(th, x.id); return Response.json({ ...x, hashed_token: th, verification_type: 'magiclink' });
    }
    if (u.pathname === '/auth/v1/verify') { const id = S.tok.get(body.token_hash); if (!id) return new Response('{}', { status: 403 }); S.tok.delete(body.token_hash); return Response.json(issue(id)); }
    const mm = u.pathname.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})(\/passkeys(?:\/([0-9a-f-]{36}))?)?$/);
    if (mm) {
      const [, id, pk, pid] = mm;
      if (!pk && m === 'GET') return S.users.has(id) ? Response.json(S.users.get(id)) : new Response('{}', { status: 404 });
      if (!pk && m === 'DELETE') { S.users.delete(id); S.keys.delete(id); for (const [c, v] of [...S.cred]) if (v.uid === id) S.cred.delete(c); return Response.json({}); }
      if (pk && m === 'GET') return Response.json(S.keys.get(id) || []);
      if (pk && m === 'DELETE') { S.keys.set(id, (S.keys.get(id) || []).filter(k => k.id !== pid)); for (const [c, v] of [...S.cred]) if (v.kid === pid) S.cred.delete(c); return Response.json({}); }
    }
  }
  if (String(url) === 'https://oauth2.googleapis.com/token') {
    const p = new URLSearchParams(String(body));
    if (p.get('grant_type') === 'authorization_code') return p.get('code') === 'good' ? Response.json({ refresh_token: 'g-refresh', access_token: 'g-access', scope: 'openid email https://www.googleapis.com/auth/gmail.send' }) : Response.json({ error: 'invalid_grant' }, { status: 400 });
    return Response.json({ access_token: 'g-access2' });
  }
  if (String(url) === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json({ email: FROM, email_verified: true });
  if (String(url) === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') { S.mails.push(readMail(body.raw)); return Response.json({ id: 'm' + S.mails.length }); }
  throw new Error('unexpected server call ' + url);
};
const dl = createHandler({
  env: k => ({ SUPABASE_URL: SBU, SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: ANON, DL_ALLOWED_ORIGINS: ORIGIN, DL_APP_URL: ORIGIN + '/', GMAIL_OAUTH_CLIENT_ID: 'cid', GMAIL_OAUTH_CLIENT_SECRET: 'csec' })[k],
  db, fetch: sfetch,
  pinCheck: async () => ({ ok: false }),
  signMark: async ({ emp_id }) => 'perf-session:' + emp_id,
});
const dlCall = async (body, uid) => {
  const at = issue(uid).access_token;
  const r = await dl(new Request('https://fn.local/device-login', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + at, origin: ORIGIN }, body: JSON.stringify(body) }));
  return r.json();
};
// GM が送り手をつなぐ（Google のページは開いたことにする）
{
  const r = await dlCall({ action: 'pk_mail_connect' }, UID.gm);
  const st = new URL(r.url).searchParams.get('state');
  await dl(new Request(SBU + '/functions/v1/device-login?state=' + encodeURIComponent(st) + '&code=good', { method: 'GET' }));
}

// 代わりのパスキー API（Supabase の passkeys）：challenge を出して、ブラウザが返した clientDataJSON を確かめる
const newChal = (type, uid) => { const id = 'ch-' + (++S.seq), challenge = b64u(crypto.randomBytes(32)); S.chal.set(id, { type, challenge, uid }); return { id, challenge }; };
const checkClient = (cid, cred, type) => {
  const c = S.chal.get(cid); S.chal.delete(cid);
  let cd = null; try { cd = JSON.parse(unb64u(cred && cred.response && cred.response.clientDataJSON).toString('utf8')); } catch (e) {}
  const good = !!(c && cd && c.type === type && cd.type === type && cd.challenge === c.challenge && cd.origin === ORIGIN);
  if (!good) S.pkBad.push({ type, cd });
  return good ? c : null;
};
function passkeyApi(p, headers, j) {
  const J = (o, st = 200) => ({ status: st, body: JSON.stringify(o), headers: { 'content-type': 'application/json' } });
  const uidOf = () => S.tok.get(String(headers.authorization || '').replace('Bearer ', ''));
  if (p === '/auth/v1/passkeys/authentication/options') { const c = newChal('webauthn.get'); return J({ challenge_id: c.id, options: { publicKey: { challenge: c.challenge, rpId: 'localhost', userVerification: 'preferred', timeout: 60000 } } }); }
  if (p === '/auth/v1/passkeys/authentication/verify') {
    if (!checkClient(j.challenge_id, j.credential, 'webauthn.get')) return J({ error: 'bad_client_data' }, 400);
    const k = S.cred.get(j.credential.id);
    return k && S.users.has(k.uid) ? J({ session: issue(k.uid) }) : J({ error: 'passkey_not_found' }, 400);
  }
  if (p === '/auth/v1/passkeys/registration/options') {
    const uid = uidOf(); if (!uid) return J({}, 401);
    const c = newChal('webauthn.create', uid);
    return J({ challenge_id: c.id, options: { challenge: c.challenge, rp: { id: 'localhost', name: 'Funergy+' }, user: { id: b64u(Buffer.from(uid)), name: S.users.get(uid).email, displayName: S.users.get(uid).email },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' }, timeout: 60000 } });
  }
  if (p === '/auth/v1/passkeys/registration/verify') {
    const uid = uidOf(); if (!uid) return J({}, 401);
    const c = checkClient(j.challenge_id, j.credential, 'webauthn.create');
    if (!c || c.uid !== uid || !j.credential.response.attestationObject) return J({ error: 'bad_client_data' }, 400);
    const kid = crypto.randomUUID();
    S.cred.set(j.credential.id, { uid, kid });
    S.keys.set(uid, [...(S.keys.get(uid) || []), { id: kid, friendly_name: 'Device', created_at: new Date().toISOString() }]);
    return J({ id: kid });
  }
  return null;
}

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
    const h = { 'content-type': 'application/json', 'user-agent': String(headers['user-agent'] || ''), 'x-forwarded-for': '127.0.0.1' };
    if (headers.origin) h.origin = headers.origin; if (headers.authorization) h.authorization = headers.authorization;
    const res = await dl(new Request('https://fn.local/device-login' + u.search, { method, headers: h, body: method === 'POST' ? body : undefined }));
    const txt = await res.text(); W.dlCalls.push({ a: j.action, st: res.status, out: txt.slice(0, 200) });
    return { status: res.status, body: txt, headers: Object.fromEntries(res.headers) };
  }
  if (u.pathname === '/functions/v1/auth-pin') {
    if (j.action === 'verify') {
      W.pinCalls.push(j.key);
      const p = PEOPLE.find(x => x.id === String(j.emp || '') || x.name === j.key);
      if (!p || PINS[p.name] !== String(j.pin)) return J({ ok: false });
      if (await blocked(p.name, p.id)) return J({ ok: true, use_email: true });
      return J({ ok: true, token: 'perf-session:' + p.id });
    }
    return J({ ok: true });
  }
  if (u.pathname === '/functions/v1/emp-private') {
    W.ep.push({ action: j.action, token: !!j.token });
    const mt = /^perf-session:(.+)$/.exec(String(j.token || ''));
    const p = mt ? PEOPLE.find(x => x.id === mt[1]) : null;
    if (!p) return J({ ok: false, error: 'unauthorized' }, 401);
    const all = ['ceo', 'gm', 'office'].includes(p.role);
    const priv = {}; for (const x of PEOPLE) if (all || x.id === p.id) priv[x.id] = { wage: 20, email: '', phone: '', monthlySalary: null };
    return J({ ok: true, role: p.role, scope: all ? 'all' : 'self', private: priv });
  }
  const pk = u.pathname.startsWith('/auth/v1/passkeys/') ? passkeyApi(u.pathname, headers, j) : null;
  if (pk) return pk;
  if (u.pathname === '/auth/v1/token') {
    const g = u.searchParams.get('grant_type');
    if (g === 'password') { const a = ACC[j.email]; return a && a[0] === j.password ? J(issue(a[1])) : J({ error: 'invalid_grant' }, 400); }
    if (g === 'refresh_token') { const uid = S.rt.get(j.refresh_token); if (!uid) return J({ error: 'invalid_grant' }, 400); S.rt.delete(j.refresh_token); return J(issue(uid)); }
  }
  if (u.pathname === '/auth/v1/logout') { const tk = String(headers.authorization || '').replace('Bearer ', ''); S.closed.push(tk); S.tok.delete(tk); return { status: 204, body: '' }; }
  if (u.pathname === '/auth/v1/user') { const id = S.tok.get(String(headers.authorization || '').replace('Bearer ', '')); return id ? J({ id }) : J({}, 401); }
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
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const all = [];
// noJson：PublicKeyCredential の parse…FromJSON と toJSON が無いブラウザ（アプリ自身で変換する道）
async function device(width = 390, { lang, noJson } = {}) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 844 }, serviceWorkers: 'block', userAgent: width < 500 ? IPHONE : undefined });
  if (lang) await ctx.addInitScript(l => { try { localStorage.setItem('funergy_lang', l); } catch (e) {} }, lang);
  await ctx.addInitScript(no => {
    window.__pkGets = 0; window.__pkCreates = 0;
    if (no && window.PublicKeyCredential) { delete PublicKeyCredential.parseRequestOptionsFromJSON; delete PublicKeyCredential.parseCreationOptionsFromJSON; try { delete PublicKeyCredential.prototype.toJSON; } catch (e) {} }
    if (navigator.credentials) {
      const g = navigator.credentials.get.bind(navigator.credentials), c = navigator.credentials.create.bind(navigator.credentials);
      navigator.credentials.get = o => { window.__pkGets++; return g(o); };
      navigator.credentials.create = o => { window.__pkCreates++; return c(o); };
    }
  }, !!noJson);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const D = { ctx, page, cdp, authenticatorId, dialogs: [], errors: [] };
  page.on('dialog', d => { D.dialogs.push(d.message().slice(0, 200)); d.accept(); });
  page.on('pageerror', e => { D.errors.push(String(e.message).slice(0, 200)); if (process.env.PK_DEBUG) console.log('PAGEERROR', width, page.url(), String(e.stack).slice(0, 600)); });
  all.push(D);
  return D;
}
const creds = async D => (await D.cdp.send('WebAuthn.getCredentials', { authenticatorId: D.authenticatorId })).credentials || [];
const waitApp = page => page.waitForFunction(() => { const s = document.getElementById('app-shell'); return !!(s && s.style.display !== 'none' && curUserName) && window._heavyPending === false; }, null, { timeout: 90000 }).then(() => true, () => false);
const waitLogin = page => page.waitForFunction(() => { const l = document.getElementById('login-screen'); return !!(l && l.style.display !== 'none'); }, null, { timeout: 20000 }).then(() => true, () => false);
const vis = (page, id) => page.evaluate(i => { const e = document.getElementById(i); return !!e && e.style.display !== 'none' && !e.hidden && e.offsetParent !== null; }, id);
const text = (page, id) => page.evaluate(i => (document.getElementById(i) || {}).innerText || '', id);
const overflowX = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
const lsKeys = page => page.evaluate(() => Object.keys(localStorage).filter(k => /^_pk_/.test(k)).sort());
const sessEmp = page => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('_pk_sess_v1') || 'null'); } catch (e) { return null; } });
const live = async emp => (await q('select count(*)::int as n from public.dl_pk_sessions where emp_id = $1 and revoked_at is null', [emp]))[0].n;
const codeAgo = () => q(`update public.dl_pk_codes set created_at = created_at - interval '2 minutes'`);
async function openLogin(D) {
  await D.page.goto(ORIGIN + '/');
  await D.page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length >= 2, null, { timeout: 60000 });
  await D.page.waitForFunction(() => !!document.getElementById('pk-top'), null, { timeout: 15000 }).catch(() => {});
  await sleep(300);
}
async function pickName(D, store, name) {
  await openLogin(D);
  await D.page.evaluate(s => loginPickLocation(s), store); await sleep(400);
  await D.page.locator('#login-name-grid .store-btn', { hasText: name }).first().click();
  await sleep(500);
}
const logout = async D => { await D.page.evaluate(() => doLogout()); await waitLogin(D.page); await sleep(500); };

// ================================================================ 1. ログインの画面：上に「パスキーでログイン」（8A）
const P = await device(390);
await openLogin(P);
const entry = await text(P.page, 'pk-entry');
ok('ログインの画面の上に「パスキーでログイン」（iPhone の幅）', await vis(P.page, 'pk-entry') && /パスキーでログイン/.test(entry), entry.slice(0, 120));
ok('390px で横にはみ出さない（ログインの画面）', (await overflowX(P.page)) <= 0);
await shot(P.page, 'top-390');

// ================================================================ 2. GM：ログインの方式（2A）でスタッフをメール＋パスキーにして招待を送る
const G = await device(1280);
await pickName(G, 'OFFICE', 'Gabe Gm');
await G.page.fill('#ml-email', 'gm@test.example'); await G.page.fill('#ml-pass', 'pw-gm'); await G.page.click('#ml-btn');
ok('GM はメールとパスワードで入る', await waitApp(G.page) && await G.page.evaluate(() => curRole === 'gm'));
await G.page.evaluate(() => FUNERGY_PK.admin()); await sleep(1200);
const am = await G.page.evaluate(() => (document.querySelector('.modal') || {}).innerText || '');
ok('「ログインの方式」：送り手はつながっている・スタッフに「メール＋パスキーにする」', /ログインの方式/.test(am) && /送り手のメール/.test(am) && /つながっている|つないであります|つながっています/.test(am) && /Aki Test/.test(am) && /メール＋パスキーにする/.test(am), am.slice(0, 300));
await shot(G.page, 'gm-admin-1280');
await G.page.evaluate(() => FUNERGY_PK.aSet('S1')); await sleep(400);
await G.page.fill('#pk-a-email', AKI);
await G.page.click('#pk-a-go'); await sleep(800);
ok('「本人に伝えた」のチェックが無いと送らない', await vis(G.page, 'pk-a-err') && !lastMail(AKI));
await G.page.check('#pk-a-told'); await G.page.click('#pk-a-go');
for (let i = 0; i < 60 && !lastMail(AKI); i++) await sleep(250);
await sleep(500);
const inv = lastMail(AKI);
ok('招待のメール（7 日）が本人に届く・リンクとこのアプリの場所', !!inv && !!linkOf(inv) && linkOf(inv).startsWith(ORIGIN + '/'), inv && inv.text.slice(0, 160));
ok('サーバー：その人はメール＋パスキー（PIN では入れない）', (await q(`select mode from public.dl_people where emp_id = 'S1'`))[0].mode === 'passkey' && await blocked('Aki Test', 'S1'));

// ================================================================ 3. 本人（iPhone）：招待のリンク → メールのコード → パスキーを保存 → ログイン
const A = await device(390);
await A.page.goto(linkOf(inv));
await A.page.waitForFunction(() => { const s = document.getElementById('pk-screen'); return s && s.style.display !== 'none' && /Aki Test/.test(s.innerText); }, null, { timeout: 60000 }).catch(() => {});
await A.page.waitForFunction(() => { const o = document.getElementById('sync-splash'); return !o || o.style.display === 'none'; }, null, { timeout: 30000 }).catch(() => {});
ok('招待の画面：名前と期限・「コードを送る」', /Aki Test/.test(await text(A.page, 'pk-screen')) && await vis(A.page, 'pk-send'));
ok('390px で横にはみ出さない（招待の画面）', (await overflowX(A.page)) <= 0);
await shot(A.page, 'invite-390');
await A.page.click('#pk-send');
await A.page.waitForFunction(() => { const b = document.getElementById('pk-code-box'); return b && b.style.display === 'block'; }, null, { timeout: 15000 }).catch(() => {});
const c1 = codeOf(lastMail(AKI));
ok('コードのメールが届く・自分の端末と「パスキーを保存」がはじめから入っている', !!c1 && await A.page.evaluate(() => document.getElementById('pk-own-inv').checked && document.getElementById('pk-save').checked));
await A.page.fill('#pk-code', '000000'); await A.page.click('#pk-code-btn'); await sleep(1200);
ok('違うコードでは入らない', !(await A.page.evaluate(() => !!curUserName)) && /違|正しく/.test(await text(A.page, 'pk-err')), await text(A.page, 'pk-err'));
await A.page.fill('#pk-code', c1); await A.page.click('#pk-code-btn');
ok('正しいコード → パスキーを保存（本物の WebAuthn）→ アプリに入る（PIN のログインと同じ印）', await waitApp(A.page) && await A.page.evaluate(() => curUserName === 'Aki Test' && window._hwSession === 'perf-session:S1' && window._pkSignedIn === true));
ok('パスキーは認証器に 1 つ・サーバーにも 1 つ（clientDataJSON の type・challenge・origin が合う）', (await creds(A)).length === 1 && [...S.cred.values()].filter(v => v.uid !== UID.gm).length === 1 && S.pkBad.length === 0, S.pkBad.slice(0, 1));
ok('アドレスから招待の値が消える', !/[?&]pk=/.test(A.page.url()), A.page.url());
ok('端末には印と端末の選び方だけ（12 時間）', JSON.stringify(await lsKeys(A.page)) === JSON.stringify(['_pk_own_v1', '_pk_sess_v1']) && (await sessEmp(A.page)).emp === 'S1');
ok('Supabase のログインは閉じた', S.closed.length >= 1);
await shot(A.page, 'staff-in-390');

// ================================================================ 4. 同じ端末で開き直す：ログインしたまま（5B・パスキーを聞かない）
const g0 = await A.page.evaluate(() => window.__pkGets);
await A.page.reload();
ok('開き直すと入ったまま（パスキーを聞かない）', await waitApp(A.page) && await A.page.evaluate(() => curUserName === 'Aki Test' && window.__pkGets === 0) && g0 === 0);

// ================================================================ 5. ログアウト → 上の「パスキーでログイン」（8A）
await logout(A);
ok('ログアウトで端末のログインもサーバーのログインも終わる', !(await lsKeys(A.page)).includes('_pk_sess_v1') && (await live('S1')) === 0);
await A.page.evaluate(() => FUNERGY_PK.paintEntry()); await sleep(300);
await A.page.locator('#pk-entry button', { hasText: 'パスキーでログイン' }).first().click();
ok('上の「パスキーでログイン」で入る（本物の WebAuthn の get）', await waitApp(A.page) && await A.page.evaluate(() => curUserName === 'Aki Test' && window.__pkGets === 1) && S.pkBad.length === 0);
await logout(A);

// ================================================================ 6. 名前を選ぶ：メール＋パスキーの人は PIN の段を出さない
await pickName(A, 'F01', 'Aki Test');
ok('名前を選ぶとパスキーとメールのコードの段（PIN の段は出さない）', await vis(A.page, 'login-step-pk') && !(await vis(A.page, 'login-step-pin')) && /Aki Test/.test(await text(A.page, 'login-step-pk')));
ok('390px で横にはみ出さない（名前のあとの段）', (await overflowX(A.page)) <= 0);
await shot(A.page, 'step-390');
await pickName(A, 'F01', 'Bo Pin');
ok('PIN の人は今までどおり PIN の段', await vis(A.page, 'login-step-pin') && !(await vis(A.page, 'login-step-pk')));
await A.page.fill('#login-pin-input', '135790'); await A.page.evaluate(() => doStaffLogin());
ok('PIN の人は PIN で入る', await waitApp(A.page) && await A.page.evaluate(() => curUserName === 'Bo Pin' && window._hwSession === 'perf-session:S2'));
await logout(A);

// ================================================================ 7. PC（英語）・JSON の変換が無いブラウザ：共有の端末はコードだけ・自分の端末にするとパスキーを足せる
const C = await device(1280, { lang: 'en', noJson: true });
await pickName(C, 'F01', 'Aki Test');
const st = await text(C.page, 'login-step-pk');
ok('英語の段：パスキーとメールのコード', /passkey/i.test(st) && /code/i.test(st), st.slice(0, 160));
ok('PC ははじめ共有の端末（自分の端末のチェックなし）', await C.page.evaluate(() => !document.getElementById('pk-own-step').checked));
await codeAgo();
await C.page.click('#pk-send');
await C.page.waitForFunction(() => { const b = document.getElementById('pk-code-box'); return b && b.style.display === 'block'; }, null, { timeout: 15000 }).catch(() => {});
ok('共有の端末では「パスキーを保存」を出さない', !(await C.page.evaluate(() => !!document.getElementById('pk-save'))));
await C.page.fill('#pk-code', codeOf(lastMail(AKI))); await C.page.click('#pk-code-btn');
ok('共有の端末：コードで入る・端末にログインを残さない・パスキーを作らない', await waitApp(C.page) && !(await lsKeys(C.page)).includes('_pk_sess_v1') && await C.page.evaluate(() => window.__pkCreates === 0));
await logout(C);
await pickName(C, 'F01', 'Aki Test');
await C.page.check('#pk-own-step');
await codeAgo();
await C.page.click('#pk-send');
await C.page.waitForFunction(() => { const b = document.getElementById('pk-code-box'); return b && b.style.display === 'block'; }, null, { timeout: 15000 }).catch(() => {});
ok('自分の端末にすると「パスキーを保存」が出る（名前から入るときははじめは外れている）', await C.page.evaluate(() => { const s = document.getElementById('pk-save'); return !!s && !s.checked; }));
await C.page.check('#pk-save');
await C.page.fill('#pk-code', codeOf(lastMail(AKI))); await C.page.click('#pk-code-btn');
ok('JSON の変換が無くても、アプリ自身の変換でパスキーを保存できる', await waitApp(C.page) && (await creds(C)).length === 1 && (S.keys.get([...S.users.values()].find(x => x.email === AKI).id) || []).length === 2 && S.pkBad.length === 0);
await logout(C);
await C.page.evaluate(() => FUNERGY_PK.paintEntry()); await sleep(300);
await C.page.locator('#pk-entry button', { hasText: /passkey/i }).first().click();
ok('JSON の変換が無くても、パスキーで入れる（英語）', await waitApp(C.page) && await C.page.evaluate(() => curUserName === 'Aki Test') && S.pkBad.length === 0);
ok('1280px で横にはみ出さない', (await overflowX(C.page)) <= 0);
await shot(C.page, 'pc-en-1280');

// ================================================================ 8. GM が止める（失効）→ 本人の端末は次の取り替えでログアウト・パスキーでも入れない
await A.page.evaluate(() => FUNERGY_PK.paintEntry()); await sleep(300);
await A.page.locator('#pk-entry button', { hasText: 'パスキーでログイン' }).first().click();
ok('（もう一度パスキーで入る）', await waitApp(A.page));
const rv = await dlCall({ action: 'pk_admin_revoke', emp_id: 'S1' }, UID.gm);
ok('GM が止める', rv && rv.ok !== false, rv);
await A.page.evaluate(() => FUNERGY_PK.refresh(true));
ok('本人の端末は次の取り替えでログアウトし、端末のログインも消す', await waitLogin(A.page) && !(await lsKeys(A.page)).includes('_pk_sess_v1'));
await A.page.evaluate(() => FUNERGY_PK.paintEntry()); await sleep(300);
await A.page.locator('#pk-entry button', { hasText: 'パスキーでログイン' }).first().click(); await sleep(1500);
ok('止めたあとはパスキーでも入れない', !(await A.page.evaluate(() => !!curUserName)) && /ログインできません/.test(await text(A.page, 'pk-login-note')), await text(A.page, 'pk-login-note'));

// ================================================================ まとめ
const errs = all.flatMap(D => D.errors);
ok('pageerror 0', errs.length === 0, errs.slice(0, 3));
const bad = W.dlCalls.filter(c => c.st >= 500);
ok('device-login の 500 なし', bad.length === 0, bad.slice(0, 2));
ok('送ったメールにほかの人のアドレスが無い', S.mails.every(m => m.to === AKI));
await browser.close(); app.close(); ext.close();
const ng = results.filter(r => !r.ok);
console.log(`\n${results.length - ng.length}/${results.length} OK`);
process.exit(ng.length ? 1 : 0);
