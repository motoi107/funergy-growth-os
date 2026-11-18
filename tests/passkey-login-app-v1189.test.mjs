// v1189 アプリの FUNERGY_PK（パスキーとメールのコードでログイン・UI案92）：本物のアプリのコード（index.html の <script>）を VM で動かし、
// 本物の handler と本物の SQL（PGlite・v1183〜v1189）に頼む。Supabase Auth（利用者・パスキー）・Google（送信）・端末のパスキー（WebAuthn）は偽物。
// 合成データだけ（架空の名前・ID・メール）。本番にはつながない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHandler } from '../supabase/functions/device-login/handler.mjs';

const ROOT = new URL('..', import.meta.url);
const HTML = fs.readFileSync(new URL('index.html', ROOT), 'utf8');
const SW = fs.readFileSync(new URL('sw.js', ROOT), 'utf8');
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const R = f => fs.readFileSync(new URL('supabase/migrations/' + f, ROOT), 'utf8');
const MIGS = ['20261203090000_device_login.sql', '20261205090000_email_login.sql', '20261206090000_top_pin_off.sql', '20261207090000_pin_blocked_id_first.sql'].map(R);
const MIG89 = R('20261208090000_passkey_login.sql');
const U = { ceo: '00000000-0000-4000-8000-0000000000c1', gm: '00000000-0000-4000-8000-0000000000c2', office: '00000000-0000-4000-8000-0000000000c3' };
const FROM = 'sender@example.test';
const SEND = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const EMPS = [
  { id: 'E1', name: 'CEO Sample', role: 'ceo', store: 'OFFICE', status: '在籍' }, { id: 'E2', name: 'GM Sample', role: 'gm', store: 'OFFICE', status: '在籍' },
  { id: 'E3', name: 'Office Sample', role: 'office', store: 'OFFICE', status: '在籍' }, { id: 'E9', name: 'Crew Nine', role: 'crew', store: 'F01', status: '在籍' },
  { id: 'E10', name: 'Crew Ten', role: 'crew', store: 'F02', status: '在籍' },
];

function scriptOf(marker) {
  const i = HTML.indexOf(marker);
  assert.ok(i > 0, marker);
  const s = HTML.lastIndexOf('<script>', i), e = HTML.indexOf('</script>', i);
  return HTML.slice(s + 8, e);
}
const pkBlock = () => scriptOf('/* ==== FUNERGY_PK（v1189）');
const mlBlock = () => scriptOf('/* ==== FUNERGY_ML（v1185）');
function fnSrc(name) {
  let i = HTML.indexOf('\nfunction ' + name + '(');
  if (i < 0) i = HTML.indexOf('\nasync function ' + name + '(');
  assert.ok(i >= 0, name);
  i += 1;
  const e = HTML.indexOf('\n}\n', i);
  return HTML.slice(i, e + 2);
}
const b64uDec = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function readMail(raw) {
  const t = b64uDec(raw).toString('utf8');
  const [head, body] = t.split('\r\n\r\n');
  const h = Object.fromEntries(head.replace(/\r\n[ \t]/g, ' ').split('\r\n').map(l => [l.slice(0, l.indexOf(':')).toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]));
  return { to: h.to, text: Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8') };
}
const tick = () => new Promise(r => setTimeout(r, 0));

// ---------- サーバー（本物の handler・SQL）と偽の Supabase Auth・Google ----------
async function server(opts = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, status text, role text, store text, data jsonb);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz not null default now());
    grant select, insert, update on public.app_state to service_role;
    grant select on public.manager_auth, public.employees to service_role;`);
  for (const e of EMPS) await pg.query('insert into public.employees values($1,$2,$3,$4,$5,$6)', [e.id, e.name, e.status, e.role, e.store, '{}']);
  for (const [k, e] of [['ceo', 'E1'], ['gm', 'E2'], ['office', 'E3']]) await pg.query('insert into manager_auth values($1,$2,$3)', [U[k], k, e]);
  for (const m of MIGS) await pg.exec(m);
  if (!opts.no89) { await pg.exec(MIG89); await pg.query('update public.dl_mail set from_addr = $1 where id = 1', [FROM]); }
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) {
    try { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; }
    catch (e) { if (/does not exist/.test(e.message)) { const x = new Error('Could not find the function'); x.status = 404; throw x; } throw e; }
  } };
  const S = { users: new Map(), tokens: new Map(), keys: new Map(), cred: new Map(), closed: [], seq: 0, authDown: false };
  const addUser = (id, email, meta) => { S.users.set(id, { id, email, app_metadata: meta || {} }); };
  addUser(U.ceo, 'ceo@example.test'); addUser(U.gm, 'gm@example.test'); addUser(U.office, 'office@example.test');
  for (const [k, v] of Object.entries(U)) S.tokens.set('tok-' + k, v);
  const issue = uid => { const at = 'sb-' + (++S.seq); S.tokens.set(at, uid); return { access_token: at, refresh_token: 'rt-' + S.seq, expires_in: 3600, token_type: 'bearer', user: { id: uid, email: (S.users.get(uid) || {}).email } }; };
  const G = { sent: [] };
  const sfetch = async (url, init = {}) => {
    const u = String(url), m = (init.method || 'GET').toUpperCase(), body = init.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body;
    const auth = (init.headers && (init.headers.authorization || init.headers.Authorization)) || '';
    if (u === 'https://db.test/auth/v1/user') { const id = S.tokens.get(auth.replace('Bearer ', '')); return id && S.users.has(id) ? Response.json({ id }) : new Response('{}', { status: 401 }); }
    if (u === 'https://db.test/auth/v1/admin/users' && m === 'POST') {
      if ([...S.users.values()].some(x => x.email === body.email)) return Response.json({ error_code: 'email_exists' }, { status: 422 });
      const id = '00000000-0000-4000-8000-' + String(++S.seq).padStart(12, '0'); addUser(id, body.email, body.app_metadata); return Response.json(S.users.get(id));
    }
    if (u === 'https://db.test/auth/v1/admin/generate_link') {
      const x = [...S.users.values()].find(v => v.email === body.email); if (!x) return new Response('{}', { status: 404 });
      const th = 'th-' + (++S.seq); S.tokens.set(th, x.id); return Response.json({ ...x, hashed_token: th, verification_type: 'magiclink' });
    }
    if (u === 'https://db.test/auth/v1/verify') {
      const id = S.tokens.get(body.token_hash); if (!id) return new Response('{}', { status: 403 });
      S.tokens.delete(body.token_hash); return Response.json(issue(id));
    }
    const mm = u.match(/^https:\/\/db\.test\/auth\/v1\/admin\/users\/([0-9a-f-]{36})(\/passkeys(?:\/([0-9a-f-]{36}))?)?$/);
    if (mm) {
      const [, id, pk, pid] = mm;
      if (!pk && m === 'GET') return S.users.has(id) ? Response.json(S.users.get(id)) : new Response('{}', { status: 404 });
      if (!pk && m === 'DELETE') { S.users.delete(id); S.keys.delete(id); for (const [c, v] of [...S.cred]) if (v === id) S.cred.delete(c); return Response.json({}); }
      if (pk && m === 'GET') return Response.json(S.keys.get(id) || []);
      if (pk && m === 'DELETE') { S.keys.set(id, (S.keys.get(id) || []).filter(k => k.id !== pid)); for (const [c, v] of [...S.cred]) if (v === id && c.endsWith(pid)) S.cred.delete(c); return Response.json({}); }
    }
    if (u === 'https://oauth2.googleapis.com/token') {
      const q = new URLSearchParams(String(body));
      if (q.get('grant_type') === 'authorization_code') return Response.json({ refresh_token: 'g-refresh', access_token: 'g-access', scope: 'openid email https://www.googleapis.com/auth/gmail.send' });
      return Response.json({ access_token: 'g-access2' });
    }
    if (u === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json({ email: FROM, email_verified: true });
    if (u === SEND) { G.sent.push(readMail(body.raw)); return Response.json({ id: 'm' + G.sent.length }); }
    throw new Error('unexpected server call ' + u);
  };
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key', GMAIL_OAUTH_CLIENT_ID: 'cid', GMAIL_OAUTH_CLIENT_SECRET: 'csec', DL_APP_URL: 'https://funergy-plus.com/' })[k];
  const handler = createHandler({ env, fetch: sfetch, db, pinCheck: async () => ({ ok: false }), signMark: async ({ emp_id }) => 'mark.' + emp_id + '.' + (++S.seq) });
  const call = async (body, who) => {
    const headers = { 'content-type': 'application/json' };
    if (who) headers.authorization = 'Bearer ' + (who.startsWith('tok-') || who.startsWith('sb-') ? who : 'tok-' + who);
    const r = await handler(new Request('https://fn.test/device-login', { method: 'POST', headers, body: JSON.stringify(body) }));
    return { status: r.status, body: await r.json() };
  };
  const sql = async (q, a) => { await pg.exec('reset role'); try { return await pg.query(q, a); } finally { await pg.exec('set role service_role'); } };
  if (!opts.no89 && opts.mail !== false) {   // GM が送り手をつなぐ（Google のページは開いたことにする）
    const r = await call({ action: 'pk_mail_connect' }, 'gm');
    const st = new URL(r.body.url).searchParams.get('state');
    await handler(new Request('https://db.test/functions/v1/device-login?state=' + encodeURIComponent(st) + '&code=good', { method: 'GET' }));
  }
  const lastMailTo = to => [...G.sent].reverse().find(x => x.to === to);
  const tokenOf = mail => (mail.text.match(/[?&]pk=([A-Za-z0-9_-]{43})/) || [])[1];
  const codeOf = mail => (mail.text.match(/コード：(\d{6})/) || [])[1];
  const ago = emp => sql(`update public.dl_pk_codes set created_at = created_at - interval '2 minutes' where emp_id = $1`, [emp]);
  return { pg, handler, call, sql, S, G, issue, lastMailTo, tokenOf, codeOf, ago, oldFunction: !!opts.oldFunction };
}

function makeNode(id, onHtml) {
  let html = '';
  const n = { id, style: {}, value: '', textContent: '', hidden: false, disabled: false, checked: false, dataset: {}, children: [],
    classList: { contains: () => false, add() {}, remove() {} }, setAttribute() {}, appendChild(c) { this.children.push(c); }, focus() {}, setSelectionRange() {} };
  Object.defineProperty(n, 'innerHTML', { get: () => html, set(v) { html = String(v); if (onHtml) onHtml(id, html); }, enumerable: true });
  return n;
}

// ---------- アプリ（VM）。同じ端末＝同じ store を渡す ----------
async function app(srv, opts = {}) {
  const store = opts.store || new Map(), nodes = {}, calls = { finish: 0, logout: 0, modal: [], toast: [], alert: [], render: 0, secAuth: [] };
  const sent = [];
  // 描いた HTML のチェックボックスは、本物の DOM と同じく描いたときの checked になる（描き直すと前のチェックは消える）
  const onHtml = (id, html) => {
    if (id === 'pk-save-row') delete nodes['pk-save'];
    for (const m of html.matchAll(/<input\b[^>]*>/g)) {
      const tag = m[0], cid = (tag.match(/\bid="([^"]+)"/) || [])[1];
      if (!cid || !/type="checkbox"/.test(tag)) continue;
      const c = nodes[cid] = makeNode(cid, onHtml); c.checked = /\schecked[\s>]/.test(tag);
    }
  };
  const node = id => nodes[id] || (nodes[id] = makeNode(id, onHtml));
  const ins = { insertBefore(n) { if (n.id) nodes[n.id] = n; }, removeChild() {} };
  ['login-step-location', 'login-step-name', 'login-step-pin', 'login-step-mail', 'login-pin-input', 'login-pin-btn', 'login-pin-err', 'login-screen',
    'ml-email', 'ml-pass', 'ml-err', 'ml-btn', 'ml-name', 'ml-role', 'ml-note', 'ml-forgot', 'ml-forgot-text', 'ml-pin', 'ml-title', 'ml-email-lab', 'ml-pass-lab',
    'mgr-login-entry-btn', 'mgr-back-app', 'app-shell', 'manager-secure-screen', 'modal-overlay',
    'pk-code', 'pk-own-step', 'pk-own-inv', 'pk-own-top', 'pk-err', 'pk-code-box', 'pk-sent-note', 'pk-send', 'pk-code-btn', 'pk-go', 'pk-top', 'pk-resume',
    'pk-save-row', 'pk-a-email', 'pk-a-told', 'pk-a-err', 'pk-a-go'].forEach(node);
  for (const id of ['login-step-mail', 'login-step-pin', 'login-step-name', 'pk-code-box']) node(id).style.display = 'none';
  node('login-step-location').style.display = 'block';
  node('login-step-sub').parentNode = ins; node('login-step-mail').parentNode = ins;
  node('ml-forgot-text').style.display = 'none'; node('mgr-back-app').hidden = true;
  const doc = {
    visibilityState: 'visible', getElementById: id => nodes[id] || null, addEventListener() {}, querySelector: () => null,
    createElement: () => makeNode('', onHtml), head: { appendChild(n) { if (n.id) nodes[n.id] = n; } }, body: { appendChild(n) { if (n.id) nodes[n.id] = n; } },
  };
  // 端末のパスキー（WebAuthn）の偽物：次に返す鍵・作った鍵
  const nav = { userAgent: opts.ua || IPHONE, maxTouchPoints: 5, nextGet: null, getOpts: [], createOpts: [], made: 0, getError: null, createError: null };
  nav.credentials = {
    get: async ({ publicKey }) => {
      nav.getOpts.push(publicKey);
      assert.ok(publicKey.challenge instanceof ArrayBuffer, 'challenge is decoded');
      if (nav.getError) { const e = new Error('x'); e.name = nav.getError; throw e; }
      const id = nav.nextGet;
      return { id, type: 'public-key', toJSON: () => ({ id, rawId: id, type: 'public-key', response: { clientDataJSON: 'cd', authenticatorData: 'ad', signature: 'sig', userHandle: null }, clientExtensionResults: {} }) };
    },
    create: async ({ publicKey }) => {
      nav.createOpts.push(publicKey);
      assert.ok(publicKey.challenge instanceof ArrayBuffer && publicKey.user.id instanceof ArrayBuffer, 'creation options are decoded');
      if (nav.createError) { const e = new Error('x'); e.name = nav.createError; throw e; }
      const id = 'cred-' + (++nav.made);
      return { id, type: 'public-key', toJSON: () => ({ id, rawId: id, type: 'public-key', response: { clientDataJSON: 'cd', attestationObject: 'ao', transports: ['internal'] }, clientExtensionResults: {} }) };
    },
  };
  const S = srv.S;
  let regSeq = 0;
  const fetchApp = async (url, init = {}) => {
    const u = String(url), body = init.body ? JSON.parse(init.body) : null;
    sent.push({ url: u, headers: init.headers, body });
    if (S.authDown) throw new TypeError('Failed to fetch');
    const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || '';
    if (u === 'https://db.test/functions/v1/device-login') {
      if (srv.oldFunction) return Response.json({ error: 'bad_value' }, { status: 400 });
      return srv.handler(new Request('https://fn.test/device-login', { method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body: init.body }));
    }
    if (u === 'https://db.test/functions/v1/auth-pin') return Response.json(opts.authPin ? opts.authPin(body) : { ok: false });
    if (u === 'https://db.test/auth/v1/passkeys/authentication/options') return Response.json({ challenge_id: 'ac-1', options: { publicKey: { challenge: 'Y2hhbGxlbmdl', rpId: 'funergy-plus.com', userVerification: 'preferred' } } });
    if (u === 'https://db.test/auth/v1/passkeys/authentication/verify') {
      const uid = S.cred.get(body.credential && body.credential.id);
      return uid && S.users.has(uid) ? Response.json({ session: srv.issue(uid) }) : Response.json({ error: 'passkey_not_found' }, { status: 400 });
    }
    if (u === 'https://db.test/auth/v1/passkeys/registration/options') {
      const uid = S.tokens.get(auth.replace('Bearer ', '')); if (!uid) return new Response('{}', { status: 401 });
      return Response.json({ challenge_id: 'rc-1', options: { challenge: 'Y2hhbA', rp: { id: 'funergy-plus.com', name: 'Funergy+' }, user: { id: 'dXNlcg', name: 'u', displayName: 'u' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }] } });
    }
    if (u === 'https://db.test/auth/v1/passkeys/registration/verify') {
      const uid = S.tokens.get(auth.replace('Bearer ', '')); if (!uid) return new Response('{}', { status: 401 });
      const kid = '00000000-0000-4000-9000-' + String(++regSeq).padStart(12, '0');
      S.cred.set(body.credential.id + ':' + kid, uid); S.cred.set(body.credential.id, uid);
      S.keys.set(uid, [...(S.keys.get(uid) || []), { id: kid, friendly_name: 'Phone', created_at: '2026-11-17T10:00:00Z' }]);
      return Response.json({ id: kid });
    }
    if (u.startsWith('https://db.test/auth/v1/logout?scope=')) { const tk = auth.replace('Bearer ', ''); S.closed.push(tk); S.tokens.delete(tk); return new Response(null, { status: 204 }); }
    if (u === 'https://db.test/auth/v1/token?grant_type=refresh_token') return Response.json({ error: 'x' }, { status: 400 });
    throw new Error('unexpected app call ' + u);
  };
  const loc = { href: opts.href || 'https://funergy-plus.com/' };
  const win = {
    document: doc, location: loc, history: { replaceState: (_a, _b, p) => { loc.href = 'https://funergy-plus.com' + p; } },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    crypto: globalThis.crypto, Uint8Array, ArrayBuffer, fetch: fetchApp, console, setTimeout, clearTimeout, AbortController, URL, atob, btoa,
    setInterval: () => 7, clearInterval: () => {}, Date, JSON, Promise, Object, Array, String, Number, Error, TypeError, Math,
    navigator: nav, PublicKeyCredential: opts.noWebauthn ? undefined : function PublicKeyCredential() {}, scrollY: 0, scrollTo() {},
    SUPABASE_URL: 'https://db.test', SUPABASE_ANON: 'anon-key', STORES: [{ id: 'F01', name: 'Store One' }, { id: 'F02', name: 'Store Two' }],
    loginPerson: null, loginStoreMode: false, loginLocation: '', curRole: null, curRealRole: null, curStore: null, curUserName: null, curPage: 'dash',
    _uxLoginBusy: false, _botSession: null, _invInRefreshing: null,
    t: ja => ja, roleLabelI18n: r => r, empBlocked: e => !!(e && e.status === '退職'), managerRoleAllowed: r => ['ceo', 'gm', 'office'].includes(r),
    refreshLoginLabels() { try { win.FUNERGY_PK.paintEntry(); } catch (e) {} }, getEmployees: () => EMPS, loginBootstrapPull: async () => {},
    showToast: (m, k) => calls.toast.push([m, k]), confirm: () => true, alert: m => calls.alert.push(m), askInput: async () => opts.askValue == null ? null : opts.askValue(),
    renderPage: () => { calls.render++; }, openModal: h => calls.modal.push(h), closeModalDirect() {}, kevFlushText() {}, mrUnsaved: () => false,
    invInRtFor: s => s.refresh_token, invInKeepRefresh() {},
    secAuthEnsure: async () => true, secAuthNeedLogin: () => false, secAuthLoginModal() {}, secAuthErrText: () => 'err',
    secAuthCall: async (fn, payload) => { calls.secAuth.push([fn, payload]); if (fn !== 'device-login') return { ok: true }; return (await srv.call(payload, opts.adminAs || 'gm')).body; },
    supaHeaders: () => ({ 'Content-Type': 'application/json' }), _loginFetchT: (u, i) => fetchApp(u, i), _loginServerPing: () => Promise.resolve(true), LOGIN_PIN_TIMEOUT: 1000,
    _loginServerDownMsg: () => 'server down', _loginLockedMsg: () => 'locked', escapeHtml: x => String(x), enterAppWithSync() {}, curStoreLogin: false,
  };
  win.window = win;
  win.finishStaffLogin = () => { calls.finish++; win._uxLoginBusy = false; win.curRole = win.loginPerson.role; win.curUserName = win.loginPerson.name; };
  win.doLogout = () => { calls.logout++; try { win.FUNERGY_ML.onLogout(); } catch (e) {} try { win.FUNERGY_PK.onLogout(); } catch (e) {} win.curRole = null; win.curUserName = null; win._hwSession = null; win._sessionPin = null; };
  vm.createContext(win);
  vm.runInContext(fnSrc('invInSessionRefresh'), win, { filename: 'invInSessionRefresh.js' });
  vm.runInContext(fnSrc('authPinCheck') + fnSrc('doStaffLogin'), win, { filename: 'doStaffLogin.js' });
  vm.runInContext(mlBlock(), win, { filename: 'FUNERGY_ML.js' });
  vm.runInContext(pkBlock(), win, { filename: 'FUNERGY_PK.js' });
  const PK = win.FUNERGY_PK;
  const dl = (action) => sent.filter(x => x.url.endsWith('/device-login') && x.body && x.body.action === action);
  return { win, PK, ML: win.FUNERGY_ML, node, nodes, calls, sent, store, nav, loc, dl };
}
const sessOf = a => JSON.parse(a.store.get('_pk_sess_v1') || 'null');
const uidOf = async (srv, emp) => (await srv.sql('select auth_uid from public.dl_people where emp_id = $1', [emp])).rows[0].auth_uid;

// GM が招待 → 本人が招待のリンクを開いてコード → ログイン（own・save を選べる）
async function enrollByApp(srv, emp, email, { own = true, save = true, store } = {}) {
  const set = await srv.call({ action: 'pk_admin_set', emp_id: emp, email, told: true }, 'gm');
  assert.equal(set.status, 200, JSON.stringify(set.body));
  const token = srv.tokenOf(srv.lastMailTo(email));
  const a = await app(srv, { href: 'https://funergy-plus.com/?pk=' + token + '#x', store });
  assert.equal(await a.PK.boot(), true, 'the invite link opens the invite screen');
  assert.match(a.node('pk-screen').innerHTML, new RegExp(EMPS.find(e => e.id === emp).name));
  await a.PK.sendCode();
  assert.equal(a.node('pk-code-box').style.display, 'block');
  a.node('pk-code').value = ' ' + srv.codeOf(srv.lastMailTo(email)) + ' ';
  assert.equal(a.nodes['pk-save'].checked, true, 'the invite starts with “save a passkey” on (own device)');
  a.node('pk-own-inv').checked = own; a.nodes['pk-save'].checked = save;
  await a.PK.verify();
  return { a, token };
}

test('招待のリンク → メールのコード → 本人の端末にパスキーを保存 → PIN のログインと同じ道で入る（12 時間・端末には印と端末の選び方だけ）', async () => {
  const srv = await server();
  const { a } = await enrollByApp(srv, 'E9', 'nine@example.test');
  assert.equal(a.calls.finish, 1, 'finishStaffLogin');
  assert.equal(a.win._pkSignedIn, true);
  assert.match(a.win._hwSession, /^mark\.E9\./, 'the same login mark as the PIN login');
  assert.equal(a.win._sessionPin, null);
  assert.equal(a.win.loginPerson.id, 'E9');
  assert.equal(a.win.loginLocation, 'F01', 'the person’s own store');
  assert.doesNotMatch(a.loc.href, /pk=/, 'the invite token leaves the address bar');
  assert.equal(a.node('pk-screen').hidden, true);
  // パスキー：Supabase に保存 → サーバーに知らせる → Supabase のログインは閉じる
  const uid = await uidOf(srv, 'E9');
  assert.ok(uid);
  assert.equal((srv.S.keys.get(uid) || []).length, 1);
  assert.equal(a.dl('pk_keys_added').length, 1);
  const sbTok = a.sent.find(x => x.url.endsWith('/registration/options')).headers.Authorization.replace('Bearer ', '');
  assert.ok(srv.S.closed.includes(sbTok), 'the Supabase login is closed after saving');
  assert.ok((await srv.sql('select keys_at from public.dl_people where emp_id = $1', ['E9'])).rows[0].keys_at);
  // 端末に残すのはログインのあいだ（サーバーには sha-256 だけ）と端末の選び方だけ
  assert.deepEqual([...a.store.keys()].sort(), ['_pk_own_v1', '_pk_sess_v1']);
  const ss = sessOf(a);
  assert.equal(ss.emp, 'E9'); assert.equal(ss.keep, true); assert.match(ss.s, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(Date.parse(ss.exp) - Date.now() > 11 * 3600e3 && Date.parse(ss.exp) - Date.now() <= 12 * 3600e3 + 60e3, '12 hours');
  assert.doesNotMatch(JSON.stringify([...a.store.values()]), /mark\.|sb-|nine@example/);
  // ログアウト：サーバー側でも終える・端末から消す
  a.win.doLogout();
  assert.equal(a.win._pkSignedIn, false);
  assert.equal(a.store.has('_pk_sess_v1'), false);
  await tick(); await tick();
  assert.equal(a.dl('pk_logout').length, 1);
  assert.equal(a.dl('pk_logout')[0].body.session, ss.s);
  const live = await srv.sql('select count(*)::int as n from public.dl_pk_sessions where emp_id = $1 and revoked_at is null', ['E9']);
  assert.equal(live.rows[0].n, 0);
});

test('開いたとき：本人の端末はログインしたまま（開くたびにパスキーを聞かない・5B）。止められたら残さない', async () => {
  const srv = await server();
  const { a } = await enrollByApp(srv, 'E9', 'nine@example.test', { save: false });
  const store = a.store, s0 = sessOf(a).s;
  // 別の起動（同じ端末）
  const b = await app(srv, { store });
  assert.equal(await b.PK.boot(), true);
  assert.equal(b.calls.finish, 1);
  assert.equal(b.nav.getOpts.length, 0, 'no passkey prompt');
  assert.equal(b.dl('pk_resume')[0].body.mode, 'start');
  assert.equal(b.dl('pk_resume')[0].body.session, s0);
  assert.match(b.win._hwSession, /^mark\.E9\./);
  // 裏で取り替え（30 分）→ 新しい印
  const m1 = b.win._hwSession;
  await b.PK.refresh(true);
  assert.notEqual(b.win._hwSession, m1);
  // GM が止めた → 次の取り替えでログアウト・端末からも消す
  assert.equal((await srv.call({ action: 'pk_admin_revoke', emp_id: 'E9' }, 'gm')).status, 200);
  await b.PK.refresh(true);
  assert.equal(b.calls.logout, 1);
  assert.equal(b.store.has('_pk_sess_v1'), false);
  assert.equal(b.win._pkSignedIn, false);
  // 次の起動：入らない
  const c = await app(srv, { store });
  assert.equal(await c.PK.boot(), false);
  assert.equal(c.calls.finish, 0);
});

test('開いたとき：つながらないときは端末のログインを残す（「続ける」でもう一度）', async () => {
  const srv = await server();
  const { a } = await enrollByApp(srv, 'E9', 'nine@example.test', { save: false });
  const b = await app(srv, { store: a.store });
  await b.PK.info(true);
  srv.S.authDown = true;
  assert.equal(await b.PK.resume(), false);
  assert.ok(b.store.has('_pk_sess_v1'), 'kept for a retry');
  assert.match(b.node('pk-login-note').textContent, /つながりません/);
  srv.S.authDown = false;
  assert.equal(await b.PK.resume(), true);
  assert.equal(b.calls.finish, 1);
});

test('共有の端末（9A）：パスキーを保存しない・端末にログインを残さない（閉じたら終わり）', async () => {
  const srv = await server();
  const { a } = await enrollByApp(srv, 'E9', 'nine@example.test', { own: false, save: true });
  assert.equal(a.calls.finish, 1);
  assert.equal(a.nav.createOpts.length, 0, 'no passkey on a shared device');
  assert.equal(a.dl('pk_code_verify')[0].body.passkey, false);
  assert.equal(a.dl('pk_code_verify')[0].body.keep, false);
  assert.equal(a.store.has('_pk_sess_v1'), false);
  assert.equal(a.store.get('_pk_own_v1'), '0');
  const live = await srv.sql('select keep from public.dl_pk_sessions where emp_id = $1 and revoked_at is null', ['E9']);
  assert.deepEqual(live.rows.map(r => r.keep), [false]);
  // 同じ端末を次に開く：入らない
  const b = await app(srv, { store: a.store });
  assert.equal(await b.PK.boot(), false);
});

test('上の「パスキーでログイン」（8A）：スタッフはパスキーで入る（Supabase のログインはすぐ閉じる）', async () => {
  const srv = await server();
  const { a } = await enrollByApp(srv, 'E9', 'nine@example.test');
  a.win.doLogout();
  const b = await app(srv, { store: new Map() });
  await b.PK.boot();
  assert.match(b.node('pk-entry').innerHTML, /パスキーでログイン/);
  assert.equal(b.node('pk-entry').style.display, 'block');
  b.nav.nextGet = 'cred-1';
  b.node('pk-own-top').checked = true;
  await b.PK.passkey(false);
  assert.equal(b.calls.finish, 1);
  assert.equal(b.win.loginPerson.id, 'E9');
  const login = b.sent.find(x => x.body && x.body.action === 'pk_login');
  const sbTok = login.headers.Authorization.replace('Bearer ', '');
  assert.ok(srv.S.closed.includes(sbTok), 'the Supabase login is closed');
  assert.equal(login.body.keep, true);
  assert.equal(sessOf(b).emp, 'E9');
  // 取り消したパスキー → 入らない
  b.win.doLogout();
  const c = await app(srv, { store: new Map() });
  await c.PK.boot();
  c.nav.nextGet = 'cred-unknown';
  await c.PK.passkey(false);
  assert.equal(c.calls.finish, 0);
  assert.match(c.node('pk-login-note').textContent, /このパスキーではログインできません/);
  // やめた
  c.nav.getError = 'NotAllowedError';
  await c.PK.passkey(false);
  assert.match(c.node('pk-login-note').textContent, /やめました/);
  assert.equal(c.win._uxLoginBusy, false);
});

test('名前を選んでからスタッフの段で、ほかのスタッフのパスキー：入らない・そのログインは閉じる', async () => {
  const srv = await server();
  (await enrollByApp(srv, 'E10', 'ten@example.test')).a.win.doLogout();          // E10 のパスキー（cred-1）
  (await enrollByApp(srv, 'E9', 'nine@example.test', { save: false })).a.win.doLogout();
  const b = await app(srv);
  await b.PK.boot();
  b.win.loginPerson = EMPS[3]; b.win.loginLocation = 'F01';
  assert.equal(b.PK.route(EMPS[3]), true);
  b.nav.nextGet = 'cred-1';
  await b.PK.passkey(true);
  await tick(); await tick();
  assert.equal(b.calls.finish, 0);
  assert.equal(b.win._pkSignedIn, undefined);
  assert.match(b.node('pk-err').textContent, /Crew Ten さんのもの/);
  assert.equal(b.dl('pk_logout').length, 1, 'the other person’s new login is closed');
  const live = await srv.sql('select count(*)::int as n from public.dl_pk_sessions where emp_id = $1 and revoked_at is null', ['E10']);
  assert.equal(live.rows[0].n, 0);
  assert.equal(b.store.has('_pk_sess_v1'), false);
});

test('「この端末にパスキーを保存」のはじめ：招待は保存する・名前を選んでコードで入るときは保存しない（自分の端末の切り替えのあとも同じ）', async () => {
  const srv = await server();
  // 招待：コードを送る前に「自分の端末」を外して戻しても、はじめは保存する
  await srv.call({ action: 'pk_admin_set', emp_id: 'E9', email: 'nine@example.test', told: true }, 'gm');
  const a = await app(srv, { href: 'https://funergy-plus.com/?pk=' + srv.tokenOf(srv.lastMailTo('nine@example.test')) });
  await a.PK.boot();
  a.node('pk-own-inv').checked = false; a.PK.ownChanged(a.node('pk-own-inv'));
  assert.equal(a.nodes['pk-save'], undefined, 'no save box on a shared device');
  a.node('pk-own-inv').checked = true; a.PK.ownChanged(a.node('pk-own-inv'));
  await a.PK.sendCode();
  assert.equal(a.nodes['pk-save'].checked, true);
  // 外したあとにもう一度送っても（すぐなら「少し前に送りました」）外したまま
  a.nodes['pk-save'].checked = false;
  await a.PK.sendCode();
  assert.match(a.node('pk-sent-note').textContent, /少し前にコードを送りました/);
  assert.equal(a.nodes['pk-save'].checked, false);
  // 名前を選んで：はじめは保存しない・送ったあとも同じ
  a.node('pk-code').value = srv.codeOf(srv.lastMailTo('nine@example.test')); a.nodes['pk-save'].checked = false;
  await a.PK.verify(); a.win.doLogout();
  await srv.ago('E9');
  const b = await app(srv);
  await b.PK.boot();
  assert.equal(b.PK.route(EMPS[3]), true);
  assert.equal(b.nodes['pk-save'].checked, false);
  await b.PK.sendCode();
  assert.equal(b.nodes['pk-save'].checked, false);
  b.node('pk-own-step').checked = false; b.PK.ownChanged(b.node('pk-own-step'));
  b.node('pk-own-step').checked = true; b.PK.ownChanged(b.node('pk-own-step'));
  assert.equal(b.nodes['pk-save'].checked, false);
});

test('開いたとき：端末の印と違う人のログインが返ったら入らない・端末から消す', async () => {
  const srv = await server();
  const { a } = await enrollByApp(srv, 'E9', 'nine@example.test', { save: false });
  const x = sessOf(a); x.emp = 'E10'; a.store.set('_pk_sess_v1', JSON.stringify(x));
  const b = await app(srv, { store: a.store });
  assert.equal(await b.PK.boot(), false);
  assert.equal(b.calls.finish, 0);
  assert.equal(b.win._pkSignedIn, undefined);
  assert.equal(b.store.has('_pk_sess_v1'), false);
});

test('GM・CEO・経理のパスキー：パスワードのあとと同じ道（FUNERGY_ML）・この端末には覚えない', async () => {
  const srv = await server();
  srv.S.cred.set('cred-gm', U.gm);
  const a = await app(srv);
  await a.PK.boot();
  a.nav.nextGet = 'cred-gm';
  await a.PK.passkey(false);
  assert.equal(a.calls.finish, 1);
  assert.equal(a.win._mlSignedIn, true);
  assert.equal(a.win._pkSignedIn, undefined);
  assert.equal(a.win._authSession.via, 'passkey');
  assert.equal(a.win._authSession.emp_id, 'E2');
  assert.match(a.win._hwSession, /^mark\.E2\./);
  assert.equal(a.store.has('_pk_sess_v1'), false);
  const em = a.sent.find(x => x.body && x.body.action === 'email_login');
  assert.equal(em.body.emp_id, 'E2');
  // 名前を選んでからスタッフの段で GM のパスキー：その人ではない
  a.win.doLogout();
  const b = await app(srv);
  await b.PK.boot();
  b.win.loginPerson = EMPS[4]; b.win.loginLocation = 'F02';
  srv.S.cred.set('cred-gm', U.gm);
  await srv.call({ action: 'pk_admin_set', emp_id: 'E10', email: 'ten@example.test', told: true }, 'gm');
  await b.PK.info(true);
  assert.equal(b.PK.route(EMPS[4]), true);
  b.nav.nextGet = 'cred-gm';
  await b.PK.passkey(true);
  assert.equal(b.calls.finish, 0);
  assert.match(b.node('pk-err').textContent, /GM Sample さんのもの/);
});

test('名前を選んだとき：メール＋パスキーの人は PIN の段を出さない・ほかは今までどおり', async () => {
  const srv = await server();
  const first = (await enrollByApp(srv, 'E9', 'nine@example.test', { own: false })).a;
  first.win.doLogout();
  await srv.ago('E9');   // 招待のコードから 1 分たった（もう一度送れる）
  const a = await app(srv);
  await a.PK.boot();
  assert.equal(a.PK.route(EMPS[3]), true, 'E9 → passkey / email code step');
  assert.equal(a.node('login-step-pk').style.display, 'block');
  assert.equal(a.node('login-step-pin').style.display, 'none');
  assert.equal(a.node('login-step-name').style.display, 'none');
  assert.match(a.node('login-step-pk').innerHTML, /Crew Nine/);
  assert.match(a.node('login-step-pk').innerHTML, /data-to="name"/);
  assert.equal(a.node('pk-entry').style.display, 'none', 'the top button hides on the step');
  assert.equal(a.PK.route(EMPS[4]), false, 'PIN person');
  assert.equal(a.PK.route(EMPS[1]), false, 'GM goes to FUNERGY_ML');
  a.win.loginStoreMode = true;
  assert.equal(a.PK.route(EMPS[3]), false, 'store login');
  a.win.loginStoreMode = false;
  // 戻る
  a.PK.hideStep();
  assert.equal(a.node('login-step-pk').style.display, 'none');
  // 名前を選んでメールのコード（登録したメールに。共有の端末）
  a.PK.route(EMPS[3]);
  await a.PK.sendCode();
  const mail = srv.lastMailTo('nine@example.test');
  assert.ok(mail);
  assert.equal(a.dl('pk_code_send').at(-1).body.emp_id, 'E9');
  a.node('pk-own-step').checked = false;
  a.node('pk-code').value = '000000';
  await a.PK.verify();
  assert.match(a.node('pk-err').textContent, /コードが違います/);
  a.node('pk-code').value = srv.codeOf(mail);
  await a.PK.verify();
  assert.equal(a.calls.finish, 1);
  assert.equal(a.store.has('_pk_sess_v1'), false);
});

test('PIN の段から（本物の doStaffLogin）：auth-pin が「PIN ではない」と答えたらパスキーとメールのコードの段（PIN は残さない）', async () => {
  const srv = await server();
  const a = await app(srv, { authPin: () => ({ ok: true, use_email: true }) });
  await a.PK.boot();
  a.win.loginPerson = EMPS[4]; a.win.loginLocation = 'F02';
  a.node('login-pin-input').value = '1357';
  a.win.doStaffLogin();
  for (let i = 0; i < 50 && a.win._uxLoginBusy; i++) await tick();
  await tick();
  assert.equal(a.node('login-step-pk').style.display, 'block');
  assert.equal(a.node('login-pin-input').value, '');
  assert.equal(a.calls.finish, 0);
  assert.equal(a.win._sessionPin, undefined);
  assert.match(a.node('pk-err').textContent, /PIN ではなく、パスキーかメールのコード/);
  // 段を出すときも PIN の欄を空にする（doStaffLogin を通らない呼び方でも）
  a.node('login-pin-input').value = '2468';
  assert.equal(a.PK.pinBlocked(EMPS[4], true), true);
  assert.equal(a.node('login-pin-input').value, '');
});

test('GM の「ログインの方式」（2A）：メール＋パスキーにする（本人に伝えたのチェック）・GM だけ・メールを送れないとき', async () => {
  const srv = await server();
  const a = await app(srv);
  a.win.curRole = 'am';
  await a.PK.admin();
  assert.equal(a.calls.secAuth.length, 0, 'not GM: nothing');
  a.win.curRole = 'gm';
  await a.PK.admin();
  assert.match(a.calls.modal.at(-1), /送り手のメール/);
  assert.match(a.calls.modal.at(-1), /つながっています/);
  assert.match(a.calls.modal.at(-1), /Crew Ten/);
  assert.doesNotMatch(a.calls.modal.at(-1), /CEO Sample.*メール＋パスキーにする/);
  a.PK.aSet('E10');
  assert.match(a.calls.modal.at(-1), /PIN ではログインできません/);
  a.node('pk-a-email').value = 'ten@example.test';
  a.node('pk-a-told').checked = false;
  await a.PK.aSetGo('E10');
  assert.match(a.node('pk-a-err').textContent, /チェック/);
  assert.equal(srv.lastMailTo('ten@example.test'), undefined);
  a.node('pk-a-told').checked = true;
  await a.PK.aSetGo('E10');
  assert.ok(srv.lastMailTo('ten@example.test'), 'invite mail');
  assert.equal(a.calls.secAuth.at(-1)[1].action, 'pk_admin_set');
  assert.match(a.calls.toast.at(-1)[0], /招待のメールを送りました/);
  assert.match(a.calls.modal.at(-1), /Crew Ten[\s\S]*メール＋パスキー/);
  // 経理（GM でない）が送ってもサーバーが断る
  const b = await app(srv, { adminAs: 'office' });
  b.win.curRole = 'gm';   // 画面をだましても
  await b.PK.admin();
  assert.match(b.calls.alert.at(-1), /GM だけ/);
});

test('サーバーがまだ（v1188 までの関数・SQL）：パスキーの入口を出さない・名前を選ぶと今までどおり PIN', async () => {
  const old = await server({ oldFunction: true });
  const a = await app(old);
  await a.PK.boot();
  assert.equal(a.node('pk-entry').style.display, 'none');
  assert.equal(a.PK.route(EMPS[3]), false);
  const no89 = await server({ no89: true });
  const b = await app(no89);
  await b.PK.boot();
  assert.equal(b.node('pk-entry').style.display, 'none');
  assert.equal(b.PK.route(EMPS[3]), false);
  // パスキーを使えないブラウザ：名前の段でメールのコードだけ
  const srv = await server();
  await srv.call({ action: 'pk_admin_set', emp_id: 'E9', email: 'nine@example.test', told: true }, 'gm');
  const c = await app(srv, { noWebauthn: true, ua: PC });
  await c.PK.boot();
  assert.equal(c.PK.route(EMPS[3]), true);
  assert.doesNotMatch(c.node('login-step-pk').innerHTML, /id="pk-go"/);
  assert.match(c.node('login-step-pk').innerHTML, /メールにコードを送る/);
  assert.equal(c.PK._t.own(), false, 'a PC defaults to a shared device');
});

test('本体への組み込み（名前を選ぶ・PIN の段・戻る・ログアウト 2 か所・起動・マイページ・PIN 一覧・版）', () => {
  assert.match(HTML, /FUNERGY_ML\.route\(emp\)\) return; \}catch\(e\)\{\}[^\n]*\n  try\{ if\(window\.FUNERGY_PK && FUNERGY_PK\.route\(emp\)\) return; \}catch\(e\)\{\}/);
  assert.match(HTML, /function toMail\(server\)\{ try\{ if\(\(window\.FUNERGY_PK && FUNERGY_PK\.pinBlocked\(loginPerson, server\)\) \|\| \(window\.FUNERGY_ML && FUNERGY_ML\.pinBlocked\(loginPerson, server\)\)\)\{/);
  for (const block of HTML.split('(function doLogout() {').slice(1, 3)) {
    const a = block.indexOf('FUNERGY_PK.onLogout'), b = block.indexOf('window._sessionPin = null');
    assert.ok(a > 0 && b > a, 'onLogout before _sessionPin is cleared');
  }
  assert.equal(HTML.split('try{ if(window.FUNERGY_PK) FUNERGY_PK.onLogout(); }catch(e){}').length - 1, 2);
  assert.match(HTML, /function bootLogin\(\) \{[\s\S]{0,2600}FUNERGY_PK\.paintEntry\(\)/);
  assert.match(HTML, /function _dlBootWhenReady\(\)\{[\s\S]{0,900}window\.FUNERGY_PK\.boot\(\)/);
  assert.match(HTML, /FUNERGY_PK\.myCardHtml\(\)/);
  assert.equal(HTML.split('FUNERGY_PK.hideStep()').length - 1, 3, 'location pick + both back buttons');
  assert.match(HTML, /\(window\._dlSignedIn \|\| window\._mlSignedIn \|\| window\._pkSignedIn\) && !window\._sessionPin && !window\._empPrivate/);
  assert.match(HTML, /\(curRole==='gm'\)\?`<button class="btn btn-secondary btn-sm" onclick="FUNERGY_PK\.admin\(\)"/);
  // 「ログインの試し」（v1183）はやめた：入口・マイページ・起動で入る道が無い
  const dl = scriptOf('/* ==== FUNERGY_DL（v1183）');
  assert.match(dl, /function paintEntry\(\) \{ try \{ var el = \$\('dl-entry'\);/);
  assert.match(dl, /function myCardHtml\(\) \{ return ''; \}/);
  const boot = dl.slice(dl.indexOf('  async function boot() {'), dl.indexOf('/* ---------- PIN が要る機能'));
  assert.doesNotMatch(boot, /start\(|showInvite\(/);
  // FUNERGY_PK が端末に書くのはログインのあいだと端末の選び方だけ・sessionStorage は使わない
  const pk = pkBlock();
  assert.deepEqual([...pk.matchAll(/localStorage\.setItem\(([^,]+),/g)].map(m => m[1].trim()), ['OWN', 'SESS']);
  assert.doesNotMatch(pk, /sessionStorage|indexedDB/);
  assert.doesNotMatch(pk, /[A-Za-z0-9._%+-]+@(?!example\.)[A-Za-z0-9-]+\.[A-Za-z]{2,}/, 'no real email addresses in the app');
  const av = Number((HTML.match(/const APP_VERSION = '(\d+)';/) || [])[1]), sv = Number((SW.match(/const SW_BUILD = '(\d+)';/) || [])[1]);
  assert.ok(av >= 1189 && av === sv, 'APP_VERSION and SW_BUILD are 1189 or later and equal');
});
