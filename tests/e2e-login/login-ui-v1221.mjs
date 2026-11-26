// v1221：ログインの画面の見た目（並べ替え・まとめ）を本物のブラウザ（Chrome）で確かめる。合成データだけ（作りものの店・人・PIN・メール）。本番にはつながない。
// ・アプリ：このリポジトリの index.html（APP_DIR で前の版も開ける＝前と後の画面を同じ台本で撮る）
// ・Supabase：tests/perf/mock-api.mjs（PostgREST など）＋ 関数 device-login は本物の handler と本物の SQL（PGlite・v1183〜v1189）
//   auth-pin・emp-private・Supabase Auth・パスキー API・Google（送信）は代わり（tests/e2e-login/passkey-v1189.mjs と同じ作り）
// 確かめること：スマホ（390・360）と PC（1280）・日本語と英語・最初の画面に出るもの・所属 → 名前 → PIN・違う PIN／確認中／サーバーにつながらない／止まっている
//   GM はメールとパスワード（違うパスワード）・店の共有の端末（店の PIN）・メール＋パスキーの人（コード → 自分の端末にパスキー → 開き直すと続ける・上のパスキー）
//   ログイン後の画面（Crew と GM で出るタブ）・ログアウト → もう一度ログイン・審査用デモの入口と帯・キーボードが出た高さ・横のはみ出し・文字のはみ出し
// 使い方：VENDOR_DIR=/tmp/e2e/vendor CERT_DIR=/tmp/e2e/cert [SHOTS=/tmp/shots/after] [APP_DIR=/path/to/older] node tests/e2e-login/login-ui-v1221.mjs
//   VENDOR_DIR に @tabler/icons-webfont@2.44.0 があればアイコンも出す（無ければアイコンの字だけ空く）
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
const SRC = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
const ANON = (SRC.match(/var FG_PROD_ANON = '([^']+)'/) || SRC.match(/const SUPABASE_ANON = '([^']+)'/) || [])[1];
const VER = Number((SRC.match(/const APP_VERSION = '(\d+)'/) || [])[1] || 0);
const NEW = VER >= 1221;   // 前の版（1220 まで）では、変えた画面だけの確かめを飛ばす（前の画面を撮るため）
const PORT = 8096, ORIGIN = `http://localhost:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond, info }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const only = (name, cond, info) => { if (NEW) ok(name, cond, info); else console.log('--  （前の版）' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// ---------------------------------------------------------------- 作りものの店・人（実在の店・人ではない）
const STORES = ['Store A', 'Store B', 'Store C', 'Store D', 'Store E', 'Store F', 'Store G', 'Store H'].map((name, i) => ({ id: 'F0' + (i + 1), name, brand: 'Brand', color: ['#335577', '#8a4b2a', '#2f7d5b', '#6b4fa0'][i % 4], am: '', toastGuid: '', hours: '11:00-22:00', days: '毎日', active: true }));
const PEOPLE = [
  { id: 'E1', name: 'Cora Ceo', role: 'ceo', store: 'ALL', title: 'CEO' },
  { id: 'E2', name: 'Gabe Gm', role: 'gm', store: 'ALL', title: 'General Manager' },
  { id: 'E3', name: 'Dee Office', role: 'office', store: 'ALL', title: 'Accountant' },
  { id: 'S1', name: 'Aki Test', role: 'crew', store: 'F01', title: 'Crew' },
  { id: 'S2', name: 'Bo Pin', role: 'crew', store: 'F01', title: 'Crew' },
  { id: 'S3', name: 'Cy Lead', role: 'sl', store: 'F01', title: 'Server Leader' },
  { id: 'S4', name: 'Dana Longname-Example', role: 'crew', store: 'F01', title: 'Crew' },
  { id: 'S5', name: 'Eli Crew', role: 'crew', store: 'F01', title: 'Crew' },
  { id: 'S6', name: 'Fay Crew', role: 'g2', store: 'F01', title: 'Crew' },
  { id: 'S7', name: 'Gus Kitchen', role: 'crew', store: 'F01', title: 'Kitchen' },
  { id: 'S8', name: 'Hana Store B', role: 'crew', store: 'F02', title: 'Crew' },
  { id: 'S9', name: 'Ivo Stopped', role: 'crew', store: 'F01', title: 'Crew' },
];
const PINS = { 'Bo Pin': '135790', 'Cy Lead': '246800', 'Hana Store B': '112233', 'Ivo Stopped': '999000', 'Gabe Gm': '424242' };
const STORE_PIN = { F01: '777111' };
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
await pg.exec(fs.readFileSync(path.join(ROOT, 'deploy/pin-off-v1186/PIN_を戻す.sql'), 'utf8'));   // 本番と同じ：GM・CEO・経理も PIN で入れる（Moto さん 11/17 19:34 HST）
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
const W = { pinCalls: [], dlCalls: [], ep: [], slowPin: 0, pinDown: false, locked: false };
const blocked = async (name, emp) => (await q(`select public.dl_pin_blocked($1::jsonb)->>'blocked' as b`, [JSON.stringify({ name, emp_id: emp || '' })]))[0].b === 'true';
const readMail = raw => {
  const t = unb64u(raw).toString('utf8'); const [head, body] = t.split('\r\n\r\n');
  const h = Object.fromEntries(head.replace(/\r\n[ \t]/g, ' ').split('\r\n').map(l => [l.slice(0, l.indexOf(':')).toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]));
  return { to: h.to, text: Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8') };
};
const lastMail = to => [...S.mails].reverse().find(m => m.to === to);
const codeOf = m => (m && m.text.match(/コード：(\d{6})/) || [])[1];
const linkOf = m => (m && m.text.match(/https?:\/\/\S+[?&]pk=[A-Za-z0-9_-]{43}/) || [])[0];
const codeAgo = () => q(`update public.dl_pk_codes set created_at = created_at - interval '2 minutes'`);
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
  db, fetch: sfetch, pinCheck: async () => ({ ok: false }), signMark: async ({ emp_id }) => 'perf-session:' + emp_id,
});
const dlCall = async (body, uid) => {
  const at = issue(uid).access_token;
  const r = await dl(new Request('https://fn.local/device-login', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + at, origin: ORIGIN }, body: JSON.stringify(body) }));
  return r.json();
};
{ // GM が送り手をつなぐ（Google のページは開いたことにする）
  const r = await dlCall({ action: 'pk_mail_connect' }, UID.gm);
  const st = new URL(r.url).searchParams.get('state');
  await dl(new Request(SBU + '/functions/v1/device-login?state=' + encodeURIComponent(st) + '&code=good', { method: 'GET' }));
}
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
      if (W.slowPin) await sleep(W.slowPin);
      if (W.pinDown) return { status: 503, body: 'down' };
      if (W.locked) return J({ ok: false, error: 'locked', retry_after: 600 });
      if (j.scope === 'store') return STORE_PIN[j.key] === String(j.pin) ? J({ ok: true, token: 'perf-session:store-' + j.key }) : J({ ok: false });
      const p = PEOPLE.find(x => x.id === String(j.emp || '') || x.name === j.key);
      if (!p || PINS[p.name] !== String(j.pin)) return J({ ok: false });
      if (p.id === 'S9') return J({ ok: false, error: 'inactive' });
      if (await blocked(p.name, p.id)) return J({ ok: true, use_email: true });
      return J({ ok: true, token: 'perf-session:' + p.id });
    }
    return J({ ok: true });
  }
  if (W.pinDown && u.pathname === '/rest/v1/app_settings') return { status: 503, body: 'down' };
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
    if (g === 'password') { const a = ACC[j.email]; return a && a[0] === j.password ? J(issue(a[1])) : J({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400); }
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
    const tb = u.pathname.match(/^\/npm\/@tabler\/icons-webfont@2\.44\.0\/(.+)$/);
    if (tb) return file(res, path.join(VENDOR, 'node_modules/@tabler/icons-webfont', tb[1].replace(/\.\./g, '')));
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
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP wjujeonfmjwvliunotuc.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const browser = await chromium.launch({ headless: true, args: ARGS, executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const all = [];
async function device(width = 390, { lang, height, demo } = {}) {
  const phone = width < 500;
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: height || (phone ? 844 : 800) }, deviceScaleFactor: SHOTS ? 2 : 1, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', userAgent: phone ? IPHONE : undefined });
  if (lang) await ctx.addInitScript(l => { try { if (!localStorage.getItem('funergy_lang')) localStorage.setItem('funergy_lang', l); } catch (e) {} }, lang);
  if (demo) await ctx.addInitScript(() => { try { localStorage.setItem('fg_env', 'review'); } catch (e) {} });
  await ctx.addInitScript(() => {
    window.__pkGets = 0; window.__pkCreates = 0;
    if (navigator.credentials) {
      const g = navigator.credentials.get.bind(navigator.credentials), c = navigator.credentials.create.bind(navigator.credentials);
      navigator.credentials.get = o => { window.__pkGets++; return g(o); };
      navigator.credentials.create = o => { window.__pkCreates++; return c(o); };
    }
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const D = { ctx, page, cdp, authenticatorId, dialogs: [], errors: [], width };
  page.on('dialog', d => { D.dialogs.push(d.message().slice(0, 200)); d.accept(); });
  page.on('pageerror', e => { D.errors.push(String(e.message).slice(0, 200)); });
  all.push(D);
  return D;
}
const waitApp = page => page.waitForFunction(() => { const s = document.getElementById('app-shell'); return !!(s && s.style.display !== 'none' && curUserName) && window._heavyPending === false; }, null, { timeout: 90000 }).then(() => true, () => false);
const waitLogin = page => page.waitForFunction(() => { const l = document.getElementById('login-screen'); return !!(l && l.style.display !== 'none'); }, null, { timeout: 20000 }).then(() => true, () => false);
const vis = (page, sel) => page.evaluate(s => { const e = s[0] === '#' || s[0] === '.' ? document.querySelector(s) : document.getElementById(s); if (!e || e.hidden) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && e.offsetParent !== null; }, sel);
const text = (page, sel) => page.evaluate(s => ((s[0] === '#' || s[0] === '.' ? document.querySelector(s) : document.getElementById(s)) || {}).innerText || '', sel);
const overflowX = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// 文字が枠からはみ出している・切れている要素（ログインの画面の中の見えているものだけ）
const clipped = page => page.evaluate(() => {
  const out = [], root = document.getElementById('login-screen'); if (!root) return out;
  const rr = root.getBoundingClientRect();
  root.querySelectorAll('button, a, label, .store-btn, input, p, div').forEach(e => {
    if (!e.offsetParent) return; const cs = getComputedStyle(e); if (cs.visibility === 'hidden') return;
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) return;
    if (r.right > rr.right + 1 || r.left < rr.left - 1) out.push('outside:' + (e.id || e.className || e.tagName) + ':' + (e.innerText || '').slice(0, 30));
    if (cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis' || /^(button|a|label)$/i.test(e.tagName)) { if (e.scrollWidth > e.clientWidth + 2 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') out.push('clip:' + (e.id || e.className || e.tagName) + ':' + (e.innerText || '').slice(0, 30)); }
  });
  return out.slice(0, 8);
});
// 押す場所の大きさ（見えているボタン・リンク・所属と名前の枠の高さ）
const smallTargets = (page, min = 40) => page.evaluate(m => {
  const out = [], root = document.getElementById('login-screen'); if (!root) return out;
  root.querySelectorAll('button, a, .store-btn, input[type=checkbox], label.pk-own').forEach(e => {
    if (!e.offsetParent) return; const r = e.getBoundingClientRect(); if (!r.width || !r.height) return;
    if (e.matches('input[type=checkbox]')) { const l = e.closest('label'); if (l && l.getBoundingClientRect().height >= m) return; }
    if (e.closest('.legal-links')) return;   // 下のリンク（プライバシーポリシー・サポート）は文の中のリンク
    if (r.height < m) out.push((e.id || e.className || e.tagName) + ':' + Math.round(r.height) + ':' + (e.innerText || '').trim().slice(0, 24));
  });
  return out.slice(0, 10);
}, min);
const shot = async (page, name, full) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: !!full }); } };
const lsKeys = page => page.evaluate(() => Object.keys(localStorage).filter(k => /^_pk_/.test(k)).sort());
async function openLogin(D) {
  await D.page.goto(ORIGIN + '/');
  await D.page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length >= 3, null, { timeout: 60000 });
  await D.page.waitForFunction(() => !!document.getElementById('pk-top'), null, { timeout: 15000 }).catch(() => {});
  await D.page.waitForFunction(() => { const o = document.getElementById('sync-splash'); return !o || o.style.display === 'none' || getComputedStyle(o).opacity === '0'; }, null, { timeout: 20000 }).catch(() => {});
  await sleep(400);
}
async function pickLoc(D, store) { await D.page.evaluate(s => loginPickLocation(s), store); await sleep(400); }
async function pickName(D, store, name, { fresh = true } = {}) {
  if (fresh) await openLogin(D);
  await pickLoc(D, store);
  await D.page.locator('#login-name-grid .store-btn', { hasText: name }).first().click();
  await sleep(500);
}
const logout = async D => { await D.page.evaluate(() => doLogout()); await waitLogin(D.page); await sleep(600); };
const tabs = page => page.evaluate(() => [...document.querySelectorAll('#nav-bar .nav-btn')].map(e => (e.textContent || '').trim()).filter(Boolean).slice(0, 30));
const btnText = (page, id) => page.evaluate(i => { const b = document.getElementById(i); return b ? { text: b.innerText.trim(), disabled: b.disabled } : null; }, id);
const firstScreen = page => page.evaluate(() => {
  const root = document.querySelector('#login-screen .login-card') || document.getElementById('login-screen');
  const seen = [...root.querySelectorAll('button, a, .store-btn, input, label, p, .login-sub, .pk-or, .role-section-label, summary, details')].filter(e => e.offsetParent && e.getBoundingClientRect().height > 0);
  return { buttons: seen.filter(e => /^(BUTTON|A|SUMMARY)$/.test(e.tagName) || e.classList.contains('store-btn')).length, chars: (root.innerText || '').replace(/\s+/g, '').length, text: (root.innerText || '').replace(/\n+/g, ' / ').slice(0, 400) };
});

// ================================================================ 1. 最初の画面（スマホ 390・360・PC 1280・英語）
const P = await device(390);
await openLogin(P);
const f390 = await firstScreen(P.page);
console.log('最初の画面（390）：', JSON.stringify(f390));
ok('390：横にはみ出さない（最初の画面）', (await overflowX(P.page)) <= 0);
ok('390：文字が枠からはみ出さない（最初の画面）', (await clipped(P.page)).length === 0, await clipped(P.page));
only('390：押す場所は高さ 40px 以上（最初の画面）', (await smallTargets(P.page)).length === 0, await smallTargets(P.page));
only('最初の画面の主な操作は所属を選ぶこと（所属の枠が上・パスキーは「ほかの方法」）', await P.page.evaluate(() => {
  const g = document.getElementById('login-store-grid').getBoundingClientRect(), pk = document.getElementById('pk-top');
  return !!pk && pk.getBoundingClientRect().top > g.top && !pk.classList.contains('login-btn-primary') && getComputedStyle(pk).backgroundColor !== getComputedStyle(document.querySelector('#login-store-grid .store-btn')).backgroundColor;
}));
only('所属の見出しは 1 つ（「所属を選択してください」と「所属を選択」を重ねない）', await P.page.evaluate(() => [...document.querySelectorAll('#login-screen *')].filter(e => e.offsetParent && e.children.length === 0 && /^所属を選/.test((e.innerText || '').trim())).length === 1));
only('Office は 1 行・空の枠を置かない', await P.page.evaluate(() => [...document.querySelectorAll('#login-store-grid > *')].every(e => getComputedStyle(e).visibility !== 'hidden')));
only('審査用（デモ）は店の並びに入れない（下の小さな入口）', await P.page.evaluate(() => { const e = document.getElementById('fg-review-entry'); return !!e && !e.closest('#login-store-grid') && !!e.offsetParent; }));
only('開発用の言葉（Growth OS）を最初の画面に出さない', !/Growth OS/.test(await text(P.page, '#login-screen')));
only('補足（QR・共有の端末・初めての人・版）は開いたときだけ', await P.page.evaluate(() => { const d = document.getElementById('login-help'); return !!d && d.tagName === 'DETAILS' && !d.open && /QR/.test(d.textContent) && /\d{4}/.test(d.textContent); }));
await shot(P.page, '01-top-390');
if (NEW) {   // 「ログインで困ったとき」を開く → 補足と版 → 閉じる
  await P.page.click('#login-help-sum'); await sleep(250);
  ok('「ログインで困ったとき」を開くと補足と版が出る', await P.page.evaluate(() => document.getElementById('login-help').open && /QR/.test(document.getElementById('login-help').innerText) && /1221|\d{4}/.test(document.getElementById('login-version').innerText)));
  await shot(P.page, '01b-help-open-390', true);
  await P.page.click('#login-help-sum'); await sleep(200);
}
const P360 = await device(360, { height: 740 });
await openLogin(P360);
ok('360：横にはみ出さない', (await overflowX(P360.page)) <= 0);
ok('360：文字が枠からはみ出さない', (await clipped(P360.page)).length === 0, await clipped(P360.page));
await shot(P360.page, '02-top-360');
const C = await device(1280);
await openLogin(C);
ok('1280：横にはみ出さない', (await overflowX(C.page)) <= 0);
const formW = await C.page.evaluate(() => Math.round((document.querySelector('#login-screen .login-card') || document.getElementById('login-screen')).getBoundingClientRect().width));
ok('1280：入力の枠は横に広がりすぎない（480px 以下）', formW <= 480, formW);
await shot(C.page, '03-top-1280');
// 英語
await C.page.evaluate(() => pickLang('en')); await sleep(400);
const en = await text(C.page, '#login-screen');
ok('英語に切り替わる（最初の画面）', /Select your location|location/i.test(en) && /passkey/i.test(en), en.slice(0, 120));
await shot(C.page, '04-top-1280-en');
await C.page.evaluate(() => pickLang('ja')); await sleep(300);

// ================================================================ 2. 所属 → 名前 → PIN（違う PIN・確認中・サーバーにつながらない・止まっている）→ 入る
await pickLoc(P, 'F01');
ok('名前の一覧（店の共有の端末の入口もある）', await vis(P.page, 'login-name-grid') && /この店舗としてログイン/.test(await text(P.page, 'login-step-name')));
only('名前が先・店の共有の端末は名前の下', await P.page.evaluate(() => { const a = [...document.querySelectorAll('#login-step-name .store-btn')]; const i = a.findIndex(e => /この店舗としてログイン/.test(e.innerText)); return i === a.length - 1 && a.length > 2; }));
ok('390：横にはみ出さない（名前の一覧）', (await overflowX(P.page)) <= 0);
ok('390：文字が枠からはみ出さない（名前の一覧）', (await clipped(P.page)).length === 0, await clipped(P.page));
only('名前の一覧：見出しを重ねない（「名前を選択してください」と「のスタッフを選択」）', await P.page.evaluate(() => { const t = document.getElementById('login-screen').innerText; return !(/名前を選択してください/.test(t) && /のスタッフを選択/.test(t)); }));
await shot(P.page, '05-names-390');
await P.page.locator('#login-name-grid .store-btn', { hasText: 'Bo Pin' }).first().click(); await sleep(500);
ok('PIN の段', await vis(P.page, 'login-pin-input') && await vis(P.page, 'login-pin-btn'));
only('PIN の段：誰でログインするかが見える・戻る', /Bo Pin/.test(await text(P.page, '#login-step-pin')) && await vis(P.page, '#login-step-pin .login-back'));
await shot(P.page, '06-pin-390');
// 違う PIN
await P.page.fill('#login-pin-input', '000001'); await P.page.click('#login-pin-btn');
await P.page.waitForFunction(() => { const e = document.getElementById('login-pin-err'); return e && e.style.display === 'block'; }, null, { timeout: 15000 }).catch(() => {});
ok('違う PIN：「PINが違います」・入らない・PIN は空に戻る', /PINが違います/.test(await text(P.page, 'login-pin-err')) && !(await P.page.evaluate(() => !!curUserName)) && (await P.page.inputValue('#login-pin-input')) === '');
only('違う PIN：エラーは読み上げられる枠（role=alert）', await P.page.evaluate(() => document.getElementById('login-pin-err').getAttribute('role') === 'alert'));
await shot(P.page, '07-pin-wrong-390');
// 確認中
W.slowPin = 2500;
await P.page.fill('#login-pin-input', '000002'); await P.page.click('#login-pin-btn'); await sleep(600);
const busy = await btnText(P.page, 'login-pin-btn');
ok('確認中：ボタンは「確認中…」で押せない', !!busy && /確認中/.test(busy.text) && busy.disabled, busy);
await shot(P.page, '08-pin-busy-390');
await P.page.waitForFunction(() => { const b = document.getElementById('login-pin-btn'); return b && !b.disabled; }, null, { timeout: 15000 }).catch(() => {});
W.slowPin = 0;
// サーバーにつながらない
W.pinDown = true;
await P.page.fill('#login-pin-input', '135790'); await P.page.click('#login-pin-btn');
await P.page.waitForFunction(() => { const e = document.getElementById('login-pin-err'); return e && e.style.display === 'block' && /サーバー/.test(e.textContent); }, null, { timeout: 30000 }).catch(() => {});
ok('サーバーにつながらない：「PINの間違いではないかもしれません」・PIN は残す', /サーバーにつながらない/.test(await text(P.page, 'login-pin-err')) && (await P.page.inputValue('#login-pin-input')) === '135790', await text(P.page, 'login-pin-err'));
await shot(P.page, '09-pin-offline-390');
W.pinDown = false;
// 続けて間違えて止まっている
W.locked = true;
await P.page.fill('#login-pin-input', '135790'); await P.page.click('#login-pin-btn');
await P.page.waitForFunction(() => { const e = document.getElementById('login-pin-err'); return e && e.style.display === 'block' && !/サーバー/.test(e.textContent); }, null, { timeout: 15000 }).catch(() => {});
ok('止まっている：分かる文（PIN が違うとは言わない）', !/PINが違います/.test(await text(P.page, 'login-pin-err')) && (await text(P.page, 'login-pin-err')).length > 6, await text(P.page, 'login-pin-err'));
W.locked = false;
// キーボードが出た高さ（390×500）で、PIN の欄とボタンが見える
await P.page.setViewportSize({ width: 390, height: 500 });
await P.page.focus('#login-pin-input'); await sleep(400);
const kb = await P.page.evaluate(() => { const i = document.getElementById('login-pin-input').getBoundingClientRect(), b = document.getElementById('login-pin-btn').getBoundingClientRect(); return { inTop: Math.round(i.top), btnBottom: Math.round(b.bottom), h: innerHeight }; });
ok('キーボードが出た高さ（500px）でも PIN の欄とログインのボタンが見える', kb.inTop >= 0 && kb.btnBottom <= kb.h, kb);
await shot(P.page, '10-pin-keyboard-390x500');
await P.page.setViewportSize({ width: 390, height: 844 });
// 正しい PIN → 入る（Crew）
await P.page.fill('#login-pin-input', '135790'); await P.page.click('#login-pin-btn');
ok('正しい PIN で入る（Crew）', await waitApp(P.page) && await P.page.evaluate(() => curUserName === 'Bo Pin' && window._hwSession === 'perf-session:S2'));
const crewTabs = await tabs(P.page);
ok('Crew の画面に管理のタブ（予実・経理など）が出ない', !crewTabs.some(t => /予実|経理|Accounting|Budget|Dashboard|ダッシュボード|人材/.test(t)), crewTabs);
ok('390：横にはみ出さない（ログイン後）', (await overflowX(P.page)) <= 0);
await shot(P.page, '11-crew-in-390');
// マイページの下のリンク（v1218）
const mpLegal = await P.page.evaluate(() => { const l = [...document.querySelectorAll('.legal-links')].filter(e => e.offsetParent); return l.map(e => e.innerText.trim()); });
ok('マイページの下にプライバシーポリシー・サポート（v1218）', mpLegal.some(t => /プライバシーポリシー/.test(t) && /サポート/.test(t)), mpLegal);
await shot(P.page, '11b-crew-mypage-full-390', true);
// ログアウト → もう一度
await logout(P);
ok('ログアウトでログインの画面（最初の段）', await vis(P.page, 'login-step-location') && !(await P.page.evaluate(() => !!curUserName)));
await pickName(P, 'F01', 'Bo Pin', { fresh: false });
await P.page.fill('#login-pin-input', '135790'); await P.page.press('#login-pin-input', 'Enter');
ok('ログアウトのあともう一度 PIN（Enter）で入る', await waitApp(P.page) && await P.page.evaluate(() => curUserName === 'Bo Pin'));
await logout(P);
// 止まっている人（退職・停止）
await pickName(P, 'F01', 'Ivo Stopped', { fresh: false });
await P.page.fill('#login-pin-input', '999000'); await P.page.click('#login-pin-btn');
await P.page.waitForFunction(() => { const e = document.getElementById('login-pin-err'); return e && e.style.display === 'block'; }, null, { timeout: 15000 }).catch(() => {});
ok('止められた人：「このアカウントは使えません」', /使えません/.test(await text(P.page, 'login-pin-err')), await text(P.page, 'login-pin-err'));
await P.page.evaluate(() => loginBackToLocation()); await sleep(300);

// ================================================================ 3. 店の共有の端末（店の PIN）
await pickLoc(P, 'F01');
await P.page.locator('#login-step-name .store-btn', { hasText: 'この店舗としてログイン' }).first().click(); await sleep(400);
ok('店の共有の端末：店の PIN の段', /店舗アカウント/.test(await text(P.page, '#login-step-pin')));
await shot(P.page, '12-store-pin-390');
await P.page.fill('#login-pin-input', '777111'); await P.page.click('#login-pin-btn');
ok('店の PIN で入る（店のアカウント）', await waitApp(P.page) && await P.page.evaluate(() => curStoreLogin === true && curStore === 'F01'));
await logout(P);

// ================================================================ 4. GM：メールとパスワード（違うパスワード・入る・GM のタブ）・PIN でも入れる
const G = await device(1280);
await pickName(G, 'OFFICE', 'Gabe Gm');
ok('GM はメールとパスワードの段', await vis(G.page, 'login-step-mail') && await vis(G.page, 'ml-email'));
only('メールとパスワードの段に「試しのあいだ」と出さない（PIN は今も使える）', !/試しのあいだ/.test(await text(G.page, '#login-step-mail')), await text(G.page, 'ml-pin'));
await shot(G.page, '13-gm-mail-1280');
await G.page.fill('#ml-email', 'gm@test.example'); await G.page.fill('#ml-pass', 'wrong'); await G.page.click('#ml-btn');
await G.page.waitForFunction(() => { const e = document.getElementById('ml-err'); return e && e.offsetParent && e.textContent.length > 3; }, null, { timeout: 15000 }).catch(() => {});
ok('違うパスワード：分かる文・入らない', (await text(G.page, 'ml-err')).length > 3 && !(await G.page.evaluate(() => !!curUserName)), await text(G.page, 'ml-err'));
await shot(G.page, '14-gm-mail-wrong-1280');
await G.page.fill('#ml-pass', 'pw-gm'); await G.page.click('#ml-btn');
ok('GM はメールとパスワードで入る', await waitApp(G.page) && await G.page.evaluate(() => curRole === 'gm'));
const gmTabs = await tabs(G.page);
ok('GM には管理のタブが出る（Crew より多い）', gmTabs.length > crewTabs.length, { gm: gmTabs.length, crew: crewTabs.length });
ok('1280：横にはみ出さない（GM のログイン後）', (await overflowX(G.page)) <= 0);
await shot(G.page, '13b-gm-in-1280');
await logout(G);
await pickName(G, 'OFFICE', 'Gabe Gm', { fresh: false });
await G.page.click('#ml-pin'); await sleep(400);
ok('GM：PIN でログインに切り替えられる', await vis(G.page, 'login-pin-input'));
await G.page.fill('#login-pin-input', '424242'); await G.page.click('#login-pin-btn');
ok('GM：PIN でも入れる', await waitApp(G.page) && await G.page.evaluate(() => curRole === 'gm'));
await logout(G);

// ================================================================ 5. メール＋パスキーの人：初めて（招待のリンク → コード → 自分の端末にパスキー）→ 開き直すと入ったまま → 上の「パスキーでログイン」→「続ける」→ 名前から（コード）
const inv = await dlCall({ action: 'pk_admin_set', emp_id: 'S1', email: AKI, told: true }, UID.gm);
ok('（GM がメール＋パスキーにする・招待のメール）', inv && inv.ok !== false && !!linkOf(lastMail(AKI)), inv && inv.error);
const A = await device(390);
await A.page.goto(linkOf(lastMail(AKI)));
await A.page.waitForFunction(() => { const s = document.getElementById('pk-screen'); return s && s.style.display !== 'none' && /Aki Test/.test(s.innerText); }, null, { timeout: 60000 }).catch(() => {});
await A.page.waitForFunction(() => { const o = document.getElementById('sync-splash'); return !o || o.style.display === 'none'; }, null, { timeout: 30000 }).catch(() => {});
ok('招待の画面：名前・「コードを送る」', /Aki Test/.test(await text(A.page, 'pk-screen')) && await vis(A.page, 'pk-send'));
ok('390：横にはみ出さない（招待の画面）', (await overflowX(A.page)) <= 0);
await shot(A.page, '15-invite-390');
await A.page.click('#pk-send');
await A.page.waitForFunction(() => { const b = document.getElementById('pk-code-box'); return b && b.style.display === 'block'; }, null, { timeout: 15000 }).catch(() => {});
await A.page.fill('#pk-code', codeOf(lastMail(AKI)) || ''); await A.page.click('#pk-code-btn');
ok('招待のコードで入る・自分の端末にパスキーを保存', await waitApp(A.page) && await A.page.evaluate(() => curUserName === 'Aki Test') && (await lsKeys(A.page)).includes('_pk_sess_v1'));
await A.page.reload();
ok('登録した端末：開き直すと入ったまま（パスキーを聞かない）', await waitApp(A.page) && await A.page.evaluate(() => curUserName === 'Aki Test' && window.__pkGets === 0));
await logout(A);
await A.page.evaluate(() => FUNERGY_PK.paintEntry()); await sleep(300);
ok('ログアウトのあと：上のパスキーで入れる', await vis(A.page, 'pk-top'));
await shot(A.page, '16-top-after-logout-390');
await A.page.click('#pk-top');
ok('「パスキーでログイン」で入る（本物の WebAuthn）', await waitApp(A.page) && await A.page.evaluate(() => curUserName === 'Aki Test' && window.__pkGets === 1) && S.pkBad.length === 0);
// ログインしたままの端末を、つながらないときに開く（端末のログインは残す）＝ログインの画面のいちばん上に「続ける」
const down = r => /"pk_resume"/.test(r.request().postData() || '') ? r.abort('internetdisconnected') : r.continue();
await A.page.route('**/functions/v1/device-login', down);
await A.page.reload();
await A.page.waitForFunction(() => !!document.getElementById('pk-resume'), null, { timeout: 60000 }).catch(() => {});
await sleep(500);
await A.page.unroute('**/functions/v1/device-login', down);
const res = await vis(A.page, 'pk-resume');
ok('ログインしたままの端末：「続ける」がいちばん上', res && await A.page.evaluate(() => { const r = document.getElementById('pk-resume').getBoundingClientRect(), g = document.getElementById('login-store-grid').getBoundingClientRect(); return r.top < g.top; }));
await shot(A.page, '17-resume-390');
await A.page.click('#pk-resume');
ok('「続ける」で入る', await waitApp(A.page) && await A.page.evaluate(() => curUserName === 'Aki Test'));
await logout(A);
await pickName(A, 'F01', 'Aki Test');
ok('名前を選ぶとパスキーとメールのコードの段（PIN の段は出さない）', await vis(A.page, 'login-step-pk') && !(await vis(A.page, 'login-step-pin')));
ok('390：横にはみ出さない（パスキーの段）', (await overflowX(A.page)) <= 0);
only('パスキーの段：見出しを重ねない', await A.page.evaluate(() => (document.getElementById('login-screen').innerText.match(/パスキーかメールのコードでログイン/g) || []).length <= 1));
await shot(A.page, '18-pk-step-390');
await codeAgo();
await A.page.click('#pk-send');
await A.page.waitForFunction(() => { const b = document.getElementById('pk-code-box'); return b && b.style.display === 'block'; }, null, { timeout: 15000 }).catch(() => {});
ok('コードを送る → 6 桁のコードの欄', await vis(A.page, 'pk-code'));
await A.page.fill('#pk-code', '000000'); await A.page.click('#pk-code-btn'); await sleep(1200);
ok('違うコード：分かる文・入らない', /違/.test(await text(A.page, 'pk-err')) && !(await A.page.evaluate(() => !!curUserName)), await text(A.page, 'pk-err'));
await shot(A.page, '18b-pk-code-wrong-390');
await A.page.fill('#pk-code', codeOf(lastMail(AKI)) || ''); await A.page.click('#pk-code-btn');
ok('正しいコードで入る', await waitApp(A.page) && await A.page.evaluate(() => curUserName === 'Aki Test'));
await logout(A);

// ================================================================ 6. 共有の端末（PC・英語）：パスキーを保存しない・コードで入る
const E = await device(1280, { lang: 'en' });
await pickName(E, 'F01', 'Aki Test');
ok('PC ははじめ共有の端末（自分の端末のチェックなし）', await E.page.evaluate(() => !document.getElementById('pk-own-step').checked));
await shot(E.page, '19-pk-step-1280-en');
await codeAgo();
await E.page.click('#pk-send');
await E.page.waitForFunction(() => { const b = document.getElementById('pk-code-box'); return b && b.style.display === 'block'; }, null, { timeout: 15000 }).catch(() => {});
ok('共有の端末では「パスキーを保存」を出さない', !(await E.page.evaluate(() => !!document.getElementById('pk-save'))));
await E.page.fill('#pk-code', codeOf(lastMail(AKI))); await E.page.click('#pk-code-btn');
ok('共有の端末：コードで入る・端末にログインを残さない', await waitApp(E.page) && !(await lsKeys(E.page)).includes('_pk_sess_v1'));
await logout(E);

// ================================================================ 7. 審査用デモ（印があるとき）：帯・本番に戻る・ログインの画面
const R = await device(360, { height: 740, demo: true });
await R.page.goto(ORIGIN + '/');
await R.page.waitForFunction(() => { const b = document.getElementById('fg-review-banner'); return b && b.style.display === 'block'; }, null, { timeout: 60000 }).catch(() => {});
await sleep(800);
ok('デモ：上に帯と「本番に戻る」', await vis(R.page, 'fg-review-banner') && await vis(R.page, 'fg-review-back'));
ok('デモ 360：横にはみ出さない', (await overflowX(R.page)) <= 0);
const bannerH = await R.page.evaluate(() => Math.round(document.getElementById('fg-review-banner').getBoundingClientRect().height));
ok('デモ 360：帯は 2 行まで（高さ 80px 以下）', bannerH <= 80, bannerH);
ok('デモでは入口（審査用）を出さない', !(await R.page.evaluate(() => { const e = document.getElementById('fg-review-entry'); return !!(e && e.offsetParent); })));
await shot(R.page, '20-demo-360');

// ================================================================ 8. 審査用（デモ）の入口から切り替える（v1220）→ 帯 → デモの GM で隠した画面 → 本番に戻る
const T = await device(390);
await openLogin(T);
await T.page.click('#fg-review-entry');
await T.page.waitForFunction(() => { const b = document.getElementById('fg-review-banner'); return b && b.style.display === 'block'; }, null, { timeout: 60000 }).catch(() => {});
ok('入口 → 確かめ → 審査用に切り替わる（帯・印）', await vis(T.page, 'fg-review-banner') && await T.page.evaluate(() => localStorage.getItem('fg_env') === 'review') && T.dialogs.some(d => /審査用/.test(d)), T.dialogs);
await T.page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length >= 3, null, { timeout: 60000 }).catch(() => {});
await pickName(T, 'OFFICE', 'Gabe Gm', { fresh: false });
if (await vis(T.page, 'ml-pin')) { await T.page.click('#ml-pin'); await sleep(300); }
await T.page.fill('#login-pin-input', '424242'); await T.page.click('#login-pin-btn');
ok('デモ：GM で入る', await waitApp(T.page) && await T.page.evaluate(() => curRole === 'gm'));
const dTabs = await T.page.evaluate(() => [...document.querySelectorAll('#nav-bar .nav-btn')].map(e => e.textContent.trim()));
await T.page.evaluate(() => go('dashboard')); await sleep(800);
ok('デモ：デモに無い画面は「not in the demo」と出す', /not in the demo/.test(await text(T.page, 'main-content')), (await text(T.page, 'main-content')).slice(0, 80));
ok('デモ 390：横にはみ出さない（ログイン後）', (await overflowX(T.page)) <= 0);
await shot(T.page, '21-demo-gm-hidden-390');
await T.page.evaluate(() => go('mypage')); await sleep(600);
await logout(T);
await T.page.click('#fg-review-back');
await T.page.waitForFunction(() => { const b = document.getElementById('fg-review-banner'); return b && b.style.display === 'none' && document.querySelectorAll('#login-store-grid .store-btn').length >= 3; }, null, { timeout: 60000 }).catch(() => {});
ok('「本番に戻る」で帯が消え、印も消える', !(await vis(T.page, 'fg-review-banner')) && await T.page.evaluate(() => localStorage.getItem('fg_env') === null), { tabs: dTabs.length });

// ================================================================ まとめ
const errs = all.flatMap(D => D.errors);
ok('pageerror 0', errs.length === 0, errs.slice(0, 3));
const bad = W.dlCalls.filter(c => c.st >= 500);
ok('device-login の 500 なし', bad.length === 0, bad.slice(0, 2));
await browser.close(); app.close(); ext.close();
const ng = results.filter(r => !r.ok);
console.log(`\napp ${VER}：${results.length - ng.length}/${results.length} OK`);
process.exit(ng.length ? 1 : 0);
