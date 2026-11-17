// v1185 アプリの FUNERGY_ML（GM・CEO・経理はメールとパスワードでログイン）：本物のアプリのコード（index.html の <script>）を VM で動かし、
// 本物の handler と本物の SQL（PGlite・v1183 と v1185）に頼む。Supabase Auth（パスワード・鍵の取り替え・ログアウト）は代わり。
// 合成データだけ（架空の名前・ID・メール・パスワード）。本番にはつながない。画面の通しは tests/e2e-login/email-login-v1185.mjs（Chrome）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHandler } from '../supabase/functions/device-login/handler.mjs';

const ROOT = new URL('..', import.meta.url);
const HTML = fs.readFileSync(new URL('index.html', ROOT), 'utf8');
const SW = fs.readFileSync(new URL('sw.js', ROOT), 'utf8');
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const MIG83 = fs.readFileSync(new URL('supabase/migrations/20261203090000_device_login.sql', ROOT), 'utf8');
const MIG = fs.readFileSync(new URL('supabase/migrations/20261205090000_email_login.sql', ROOT), 'utf8');
const MIG86 = fs.readFileSync(new URL('supabase/migrations/20261206090000_top_pin_off.sql', ROOT), 'utf8');
const MIG87 = fs.readFileSync(new URL('supabase/migrations/20261207090000_pin_blocked_id_first.sql', ROOT), 'utf8');
const U = { ceo: '00000000-0000-4000-8000-0000000000c1', gm: '00000000-0000-4000-8000-0000000000c2', office: '00000000-0000-4000-8000-0000000000c3' };
const ACC = { 'ceo@x.test': ['pw-ceo', 'ceo'], 'gm@x.test': ['pw-gm', 'gm'], 'office@x.test': ['pw-office', 'office'] };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function scriptOf(marker) {
  const i = HTML.indexOf(marker);
  assert.ok(i > 0, marker);
  const s = HTML.lastIndexOf('<script>', i), e = HTML.indexOf('</script>', i);
  return HTML.slice(s + 8, e);
}
const mlBlock = () => scriptOf('/* ==== FUNERGY_ML（v1185）');
function fnSrc(name) {
  let i = HTML.indexOf('\nfunction ' + name + '(');
  if (i < 0) i = HTML.indexOf('\nasync function ' + name + '(');
  assert.ok(i >= 0, name);
  i += 1;
  const e = HTML.indexOf('\n}\n', i);
  return HTML.slice(i, e + 2);
}

function makeNode(id) {
  return { id, style: {}, value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, dataset: {}, children: [],
    classList: { contains: () => false }, setAttribute() {}, appendChild(n) { this.children.push(n); }, focus() {} };
}

async function world(opts = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, status text, role text, store text, data jsonb);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz not null default now());
    grant select on public.manager_auth, public.employees to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.employees values ('E1','CEO Sample','在籍','ceo','OFFICE','{}'),('E2','GM Sample','在籍','gm','OFFICE','{}'),('E3','Office Sample','在籍','office','OFFICE','{}');`);
  for (const [k, e] of [['ceo', 'E1'], ['gm', 'E2'], ['office', 'E3']]) await pg.query('insert into manager_auth values($1,$2,$3)', [U[k], k, e]);
  await pg.exec(MIG83);
  if (!opts.noSql) await pg.exec(MIG);
  if (opts.v1186) { await pg.exec(MIG86); await pg.exec(MIG87); }   // v1186：GM・CEO・経理の PIN のログインを止める（20261207：社員の ID を先に見る）
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) {
    try { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; }
    catch (e) { if (/does not exist/.test(e.message)) { const x = new Error('Could not find the function'); x.status = 404; throw x; } throw e; }
  } };
  const tokens = new Map();    // access token → 利用者 ID
  const rts = new Map();       // refresh token → 利用者 ID
  const closed = [];
  let n = 0, authDown = false, refreshStatus = 0;
  const handler = createHandler({
    env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k], db,
    fetch: async (url, init) => { if (String(url).endsWith('/auth/v1/user')) { const id = tokens.get((init.headers.authorization || '').replace('Bearer ', '')); return id ? Response.json({ id }) : new Response('{}', { status: 401 }); } throw new Error('unexpected ' + url); },
    pinCheck: async () => ({ ok: false }),
    signMark: opts.noSign ? null : async ({ emp_id }) => 'mark:' + emp_id + ':' + (++n),
  });
  const sent = [];
  const issue = uid => { const at = 'at-' + (++n), rt = 'rt-' + n; tokens.set(at, uid); rts.set(rt, uid); return { access_token: at, refresh_token: rt, expires_in: 3600, token_type: 'bearer' }; };
  const fetchApp = async (url, init = {}) => {
    const u = String(url), body = init.body ? JSON.parse(init.body) : null;
    sent.push({ url: u, headers: init.headers, body });
    if (authDown) throw new TypeError('Failed to fetch');
    if (u === 'https://db.test/auth/v1/token?grant_type=password') {
      const a = ACC[body.email];
      if (!a || a[0] !== body.password) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      return Response.json(issue(U[a[1]]));
    }
    if (u === 'https://db.test/auth/v1/token?grant_type=refresh_token') {
      if (refreshStatus) return Response.json({ error: 'x' }, { status: refreshStatus });
      const uid = rts.get(body.refresh_token); if (!uid) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      rts.delete(body.refresh_token); return Response.json(issue(uid));
    }
    if (u.startsWith('https://db.test/auth/v1/logout?scope=')) {
      const tk = (init.headers.Authorization || '').replace('Bearer ', ''); closed.push({ token: tk, scope: u.split('=')[1] });
      if (u.endsWith('global')) { const uid = tokens.get(tk); for (const [k, v] of [...tokens]) if (v === uid) tokens.delete(k); } else tokens.delete(tk);
      return new Response(null, { status: 204 });
    }
    if (u === 'https://db.test/functions/v1/auth-pin') return Response.json(opts.authPin ? opts.authPin(body) : { ok: false });   // v1186：PIN の段（doStaffLogin）
    if (u === 'https://db.test/functions/v1/device-login') {
      if (opts.oldFunction) return Response.json({ error: 'bad_value' }, { status: 400 });
      if (opts.fakeDl) { const r = opts.fakeDl(body); if (r) return Response.json(r, { status: 200 }); }
      return handler(new Request('https://fn.test/device-login', { method: 'POST', headers: { 'content-type': 'application/json', authorization: init.headers.Authorization }, body: init.body }));
    }
    throw new Error('unexpected ' + u);
  };
  // アプリ（VM）
  const store = new Map(), nodes = {}, calls = { finish: 0, logout: 0, render: [], toast: [], secure: 0 };
  const node = id => nodes[id] || (nodes[id] = makeNode(id));
  ['ml-email', 'ml-pass', 'ml-err', 'ml-btn', 'login-step-mail', 'login-step-name', 'login-step-pin', 'ml-name', 'ml-role', 'ml-forgot-text', 'ml-forgot', 'ml-pin', 'ml-title',
    'ml-email-lab', 'ml-pass-lab', 'ml-note', 'mgr-login-entry-btn', 'login-pin-input', 'mgr-back-app', 'app-shell', 'manager-secure-screen', 'modal-overlay',
    'login-pin-err', 'login-pin-btn'].forEach(node);
  node('ml-forgot-text').style.display = 'none'; node('login-step-mail').style.display = 'none'; node('mgr-back-app').hidden = true; node('app-shell').style.display = 'block';
  node('login-step-sub').parentNode = { insertBefore(n) { if (n.id) nodes[n.id] = n; } };
  const doc = {
    visibilityState: 'visible', getElementById: id => nodes[id] || null, addEventListener() {},
    createElement: () => makeNode(''),
  };
  const win = {
    document: doc, localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    crypto: globalThis.crypto, Uint8Array, fetch: fetchApp, console, setTimeout, clearTimeout, AbortController,
    setInterval: () => 7, clearInterval: () => {}, Date, JSON, Promise, Object, Array, String, Number, Error, TypeError,
    navigator: { userAgent: opts.ua || IPHONE }, scrollY: 0, scrollTo() {},
    SUPABASE_URL: 'https://db.test', SUPABASE_ANON: 'anon-key', STORES: [{ id: 'F01', name: 'Store One' }],
    loginPerson: null, loginStoreMode: false, loginLocation: 'OFFICE', curRole: null, curRealRole: null, curStore: null, curUserName: null, curPage: 'dash',
    _botSession: null, _invInRefreshing: null, _uxLoginBusy: false,
    t: ja => ja, roleLabelI18n: r => ({ ceo: 'CEO', gm: 'GM', office: '経理' })[r] || r, empBlocked: e => !!(e && e.status === '退職'),
    managerRoleAllowed: r => ['ceo', 'gm', 'office'].includes(r), refreshLoginLabels() {},
    showToast: (m, k) => calls.toast.push([m, k]), confirm: () => true, alert() {},
    renderPage: p => calls.render.push(p), kevFlushText() {}, mrUnsaved: () => false,
    invInRtFor: s => s.refresh_token, invInKeepRefresh() {},
    // v1186：PIN の段（本物の doStaffLogin・authPinCheck を動かす）
    supaHeaders: () => ({ 'Content-Type': 'application/json' }), _loginFetchT: (u, i) => fetchApp(u, i), _loginServerPing: () => Promise.resolve(true), LOGIN_PIN_TIMEOUT: 1000,
    _loginServerDownMsg: () => 'server down', _loginLockedMsg: () => 'locked', escapeHtml: x => String(x), enterAppWithSync() {}, curStoreLogin: false,
  };
  win.window = win;
  win.finishStaffLogin = () => { calls.finish++; win._uxLoginBusy = false; win.curRole = win.loginPerson.role; win.curRealRole = win.loginPerson.role; win.curUserName = win.loginPerson.name; win.curStore = 'ALL'; };
  win.doLogout = () => { calls.logout++; try { win.FUNERGY_ML.onLogout(); } catch (e) {} win.curRole = null; win.curUserName = null; win._hwSession = null; win._sessionPin = null; };
  win.managerSessionAllowed = () => !!(win._authSession && win._authSession.access_token && ['ceo', 'gm', 'office'].includes(win._authSession.role));
  win.showManagerSecure = async () => { calls.secure++; win._secureMode = true; win._karteUnlocked = true; win.curRole = win._authSession.role; win.curRealRole = win._authSession.role; win.curStore = 'ALL'; win.curUserName = 'from-secure'; node('manager-secure-screen').style.display = 'block'; };
  vm.createContext(win);
  vm.runInContext(fnSrc('invInSessionRefresh'), win, { filename: 'invInSessionRefresh.js' });
  vm.runInContext(fnSrc('authPinCheck') + fnSrc('doStaffLogin'), win, { filename: 'doStaffLogin.js' });
  vm.runInContext(mlBlock(), win, { filename: 'FUNERGY_ML.js' });
  const ML = win.FUNERGY_ML;
  const pick = (id, name, role) => { win.loginPerson = { id, name, role, status: '在籍' }; return ML.route(win.loginPerson); };
  const type = (email, pass) => { node('ml-email').value = email; node('ml-pass').value = pass; };
  const notifs = async () => { await pg.exec('reset role'); try { const r = await pg.query(`select value from app_state where key = 'notifications'`); return r.rows[0] ? r.rows[0].value : []; } finally { await pg.exec('set role service_role'); } };
  const sql = async q => { await pg.exec('reset role'); try { return await pg.query(q); } finally { await pg.exec('set role service_role'); } };
  return { win, ML, node, nodes, calls, sent, store, closed, tokens, pick, type, notifs, sql,
    set authDown(v) { authDown = v; }, set refreshStatus(v) { refreshStatus = v; } };
}
// v1186：名前を選ぶと、PIN のログインを止めているかを device-login に聞く（login_info・鍵なし）。ログインの呼び出しとは分けて数える
const isInfo = x => !!(x.body && x.body.action === 'login_info');
const dlCalls = w => w.sent.filter(x => x.url.endsWith('/functions/v1/device-login') && !isInfo(x));
const loginSent = w => w.sent.filter(x => !isInfo(x));

test('GM: 名前を選ぶとメールとパスワードの段 → 入ると PIN のログインと同じ印・メモリだけ・新しい端末の知らせ', async () => {
  const w = await world();
  assert.equal(w.pick('E2', 'GM Sample', 'gm'), true, 'GM・CEO・経理はメールとパスワードの段');
  assert.equal(w.node('login-step-mail').style.display, 'block');
  assert.equal(w.node('login-step-name').style.display, 'none');
  assert.equal(w.node('ml-name').textContent, 'GM Sample');
  assert.equal(w.node('ml-role').textContent, 'GM · Office');
  w.type('gm@x.test', 'pw-gm');
  await w.ML.login();
  assert.equal(w.calls.finish, 1, 'PIN のログインと同じ道で入る');
  assert.equal(w.win._mlSignedIn, true);
  assert.match(w.win._hwSession, /^mark:E2:/);
  assert.equal(w.win._sessionPin, null);
  assert.deepEqual([w.win._authSession.email, w.win._authSession.emp_id, w.win._authSession.role], ['gm@x.test', 'E2', 'gm']);
  assert.equal(w.node('ml-pass').value, '', 'パスワードは画面に残さない');
  assert.equal(w.node('ml-email').value, '');
  // 頼んだ中身：選んだ人の ID と端末の番号・名前（パスワードは Supabase Auth だけに）
  const d = dlCalls(w)[0];
  assert.equal(d.headers.Authorization, 'Bearer ' + w.win._authSession.access_token);
  assert.deepEqual([d.body.action, d.body.emp_id, d.body.mode, d.body.device_name], ['email_login', 'E2', 'start', 'iPhone · Safari']);
  assert.match(d.body.device_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  for (const x of w.sent.filter(x => !x.url.includes('grant_type=password'))) assert.doesNotMatch(JSON.stringify(x.body || {}), /pw-gm/);
  // この端末に残すのは、新しい端末かを見分ける番号だけ（印・鍵・メール・パスワードは残さない）
  assert.deepEqual([...w.store.keys()], ['_ml_dev_v1']);
  assert.equal(w.store.get('_ml_dev_v1'), d.body.device_id);
  // 新しい端末：本人とほかの GM・CEO にアプリの中で知らせる
  const ns = await w.notifs();
  assert.equal(ns.length, 2);
  assert.ok(ns.every(x => x.type === 'login'));
  // 同じ端末でもう一度：知らせない
  w.win.doLogout(); w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm');
  await w.ML.login();
  assert.equal(w.calls.finish, 2);
  assert.equal((await w.notifs()).length, 2);
  w.ML.onLogout();
});

test('経理・CEO も同じ。G4・スタッフ・店舗のログインは今までどおり PIN', async () => {
  const w = await world();
  assert.equal(w.pick('E3', 'Office Sample', 'office'), true);
  w.type('office@x.test', 'pw-office'); await w.ML.login();
  assert.equal(w.win._authSession.role, 'office'); assert.equal(w.calls.finish, 1);
  w.win.doLogout();
  assert.equal(w.pick('E1', 'CEO Sample', 'ceo'), true);
  assert.equal(w.pick('S1', 'Crew', 'crew'), false);
  assert.equal(w.pick('G4', 'Mgr', 'g4'), false);
  assert.equal(w.pick('A1', 'Area', 'am'), false);
  w.win.loginStoreMode = true;
  assert.equal(w.ML.route({ id: 'E2', role: 'gm' }), false, '店舗のログインはメールの段に行かない');
  w.win.loginStoreMode = false;
  // 店のところから選んだ GM：場所の名前
  w.win.loginLocation = 'F01'; w.pick('E2', 'GM Sample', 'gm');
  assert.equal(w.node('ml-role').textContent, 'GM · Store One');
});

test('「PIN でログイン（試しのあいだ）」で PIN の段へ、PIN の段の「メールとパスワードでログイン」で戻る', async () => {
  const w = await world();
  w.pick('E2', 'GM Sample', 'gm');
  let picked = null;
  w.win.loginPickPerson = id => { picked = id; if (!w.ML.route(w.win.loginPerson)) w.node('login-step-pin').style.display = 'block'; };
  w.ML.usePin();
  assert.equal(picked, 'E2');
  assert.equal(w.node('login-step-mail').style.display, 'none');
  assert.equal(w.node('login-step-pin').style.display, 'block', 'PIN を選んだ人はメールの段に戻らない');
  w.ML.fromPin();
  assert.equal(w.node('login-step-mail').style.display, 'block');
  // 名前の一覧に戻ると、PIN を選んだのを忘れる
  w.ML.usePin(); w.ML.hideStep(true);
  assert.equal(w.ML.route(w.win.loginPerson), true);
  // パスワードを忘れたとき：GM・CEO に頼む・PIN でも入れる
  w.ML.forgot();
  assert.equal(w.node('ml-forgot-text').style.display, 'block');
  assert.match(w.node('ml-forgot-text').textContent, /GM・CEO に頼んで/);
});

test('入れないとき：言葉を分ける・印を作らない・メールのログインはサーバー側でも閉じる', async () => {
  const w = await world();
  w.pick('E2', 'GM Sample', 'gm');
  w.type('', ''); await w.ML.login();
  assert.match(w.node('ml-err').textContent, /メールとパスワードを入れて/); assert.equal(loginSent(w).length, 0);
  w.type('gm@x.test', 'wrong'); await w.ML.login();
  assert.match(w.node('ml-err').textContent, /メールまたはパスワードが違います/);
  assert.equal(dlCalls(w).length, 0); assert.equal(w.node('ml-pass').value, '');
  // ほかの人のメール（経理のメールで GM を選んだ）：その人としては入れない
  w.type('office@x.test', 'pw-office'); await w.ML.login();
  assert.match(w.node('ml-err').textContent, /GM Sample さんとして入れません/);
  assert.equal(w.calls.finish, 0); assert.equal(w.win._mlSignedIn, undefined); assert.equal(w.win._authSession, undefined);
  assert.equal(w.closed.length, 1, '入れなかったメールのログインは閉じる'); assert.equal(w.closed[0].scope, 'local');
  assert.equal(w.tokens.size, 0);
  assert.equal(w.win._uxLoginBusy, false);
  // 止めたアカウント
  await w.sql(`update manager_auth set role = 'suspended' where emp_id = 'E2'`);
  w.type('gm@x.test', 'pw-gm'); await w.ML.login();
  assert.match(w.node('ml-err').textContent, /使えません（退職・停止中）/);
  // つながらない
  w.authDown = true; w.type('gm@x.test', 'pw-gm'); await w.ML.login();
  assert.match(w.node('ml-err').textContent, /つながりません/);
  assert.equal(w.calls.finish, 0);
});

test('サーバーがまだ（v1183 の関数・v1185 の SQL が無い・印を作れない）：PIN で入るように案内（前の入り方のボタンも）', async () => {
  for (const o of [{ oldFunction: true }, { noSql: true }, { noSign: true }]) {
    const w = await world(o);
    w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm');
    await w.ML.login();
    assert.match(w.node('ml-err').textContent, /まだサーバーで使えるようになっていません/, JSON.stringify(o));
    assert.equal(w.node('ml-err').children.length, 1, '管理者セキュアページだけを開く（前の入り方）');
    assert.equal(w.calls.finish, 0); assert.equal(w.closed.length, 1);
  }
});

test('待っているあいだにほかの人を選んだ・戻った：入らない', async () => {
  const w = await world();
  w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm');
  const p = w.ML.login();
  w.win.loginPerson = { id: 'E3', name: 'Office Sample', role: 'office' };
  await p;
  assert.equal(w.calls.finish, 0); assert.equal(w.win._mlSignedIn, undefined);
  assert.equal(w.closed.length, 1);
  assert.equal(dlCalls(w).length, 0, 'パスワードの確かめのあいだに人が変わったら、device-login も呼ばない（新しい端末の知らせも出さない）');
  assert.equal((await w.notifs()).length, 0);
  // 2 回押しても 1 回だけ
  w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm');
  const a = w.ML.login(), b = w.ML.login();
  await Promise.all([a, b]);
  assert.equal(w.calls.finish, 1);
  assert.equal(w.sent.filter(x => x.url.includes('grant_type=password')).length, 2);
  w.ML.onLogout();
});

test('サーバーの答えの社員がこの人と違う（念のための守り）：入らない・印を使わない', async () => {
  const w = await world({ fakeDl: b => (b.action === 'email_login' ? { ok: true, emp_id: 'E3', name: 'Office Sample', role: 'office', token: 'mark:E3:x' } : null) });
  w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm');
  await w.ML.login();
  assert.equal(w.calls.finish, 0); assert.notEqual(w.win._mlSignedIn, true);
  assert.notEqual(w.win._hwSession, 'mark:E3:x');
  assert.match(w.node('ml-err').textContent, /GM Sample さんとして入れません/);
  assert.equal(w.closed.length, 1, 'メールのログインはサーバー側でも閉じる');
});

test('入ったあと：PIN が要る古い給与の関数のときは 1 回だけ聞く・キャンセルしても続けて聞かない', async () => {
  const w = await world();
  let asked = 0, fetched = 0, answer = false;
  w.win.FUNERGY_DL = { ensurePin: async () => { asked++; return answer; } };
  w.win.fetchEmpPrivate = async () => { fetched++; };
  w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm'); await w.ML.login();
  await w.ML.afterEnter(); await w.ML.afterEnter();
  assert.equal(asked, 1, 'キャンセルしても続けて聞かない'); assert.equal(fetched, 0);
  assert.match(w.calls.toast.at(-1)[0], /給与を読んでいない/);
  // 入り直すとまた 1 回だけ
  w.ML.onLogout(); w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm'); await w.ML.login();
  answer = true; await w.ML.afterEnter(); await w.ML.afterEnter();
  assert.equal(asked, 2); assert.equal(fetched, 1);
  // 給与がもう読めている・PIN で入っている人には聞かない
  w.ML.onLogout(); w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm'); await w.ML.login();
  w.win._empPrivate = { E2: {} }; await w.ML.afterEnter(); assert.equal(asked, 2);
  w.win._empPrivate = null; w.win._sessionPin = '1357'; await w.ML.afterEnter(); assert.equal(asked, 2);
  w.ML.onLogout();
});

test('入ったあと：鍵と印の取り替え／止めた・期限切れはログアウト／つながらないときはそのまま', async () => {
  const w = await world();
  w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm'); await w.ML.login();
  const m1 = w.win._hwSession, s1 = w.win._authSession;
  // 期限が近い：Supabase の鍵を取り替え（メール・社員・役割は残す）→ 印も新しく。新しい端末の知らせは出さない
  w.win._authSession.exp = Date.now() + 60 * 1000;
  await w.ML.refresh(true);
  assert.notEqual(w.win._authSession.access_token, s1.access_token);
  assert.deepEqual([w.win._authSession.email, w.win._authSession.emp_id, w.win._authSession.role], ['gm@x.test', 'E2', 'gm']);
  assert.ok(w.win._authSession.exp > Date.now() + 50 * 60 * 1000);
  assert.notEqual(w.win._hwSession, m1); assert.match(w.win._hwSession, /^mark:E2:/);
  assert.equal(dlCalls(w).at(-1).body.mode, 'refresh');
  assert.equal(dlCalls(w).at(-1).body.device_name, undefined);
  assert.equal((await w.notifs()).length, 2);
  assert.equal(w.calls.logout, 0);
  // つながらない：ログアウトしない
  w.authDown = true; await w.ML.refresh(true); w.authDown = false;
  assert.equal(w.calls.logout, 0); assert.equal(w.win._mlSignedIn, true);
  // 鍵の取り替えでサーバーの失敗（500）：そのまま
  w.win._authSession.exp = Date.now(); w.refreshStatus = 500; await w.ML.refresh(true);
  assert.equal(w.calls.logout, 0);
  // パスワードが変わった・すべてログアウト（取り替えが 400）：ログアウト
  w.refreshStatus = 400; await w.ML.refresh(true); w.refreshStatus = 0;
  assert.equal(w.calls.logout, 1); assert.match(w.calls.toast.at(-1)[0], /メールのログインが終わりました/);
  assert.equal(w.win._mlSignedIn, false); assert.equal(w.win._authSession, null);
  // 入り直して、アカウントを止める → 次の取り替えでログアウト
  w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm'); await w.ML.login();
  await w.sql(`update manager_auth set role = 'suspended' where emp_id = 'E2'`);
  await w.ML.refresh(true);
  assert.equal(w.calls.logout, 2); assert.match(w.calls.toast.at(-1)[0], /使えません/);
  // 権限が変わった（GM・CEO・経理でなくなった）→ 次の取り替えでログアウト（理由つき）
  await w.sql(`update manager_auth set role = 'gm' where emp_id = 'E2'`);
  w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm'); await w.ML.login();
  await w.sql(`update manager_auth set role = 'am' where emp_id = 'E2'`);
  await w.ML.refresh(true);
  assert.equal(w.calls.logout, 3); assert.match(w.calls.toast.at(-1)[0], /権限が変わりました/);
  // 退職
  await w.sql(`update manager_auth set role = 'gm' where emp_id = 'E2'`);
  w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm'); await w.ML.login();
  await w.sql(`update employees set status = '退職' where id = 'E2'`);
  await w.ML.refresh(true);
  assert.equal(w.calls.logout, 4);
  // 30 分たっていなければ、ふだんの取り替えは頼まない
  await w.sql(`update employees set status = '在籍' where id = 'E2'`);
  w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm'); await w.ML.login();
  const k = loginSent(w).length; await w.ML.refresh(false);
  assert.equal(loginSent(w).length, k);
  w.ML.onLogout();
});

test('ログアウト：メールのログインをサーバー側でも閉じる／すべての端末からログアウト', async () => {
  const w = await world();
  w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm'); await w.ML.login();
  const at = w.win._authSession.access_token;
  w.win.doLogout();
  assert.deepEqual(w.closed.at(-1), { token: at, scope: 'local' });
  assert.equal(w.win._authSession, null); assert.equal(w.win._mlSignedIn, false);
  assert.equal(w.ML.myCardHtml(), '');
  // すべての端末から
  w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm'); await w.ML.login();
  w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm');
  const card = w.ML.myCardHtml();
  assert.match(card, /すべての端末からログアウト/); assert.match(card, /管理者セキュアページを開く/); assert.match(card, /gm@x\.test/);
  await w.ML.logoutAll();
  assert.equal(w.closed.at(-1).scope, 'global');
  assert.equal(w.tokens.size, 0, 'このアカウントの鍵はすべて使えない');
  assert.equal(w.win._mlSignedIn, false);
  // 鍵の文字は画面に出さない・メールはエスケープ
  w.win._mlSignedIn = true; w.win._authSession = { email: '<b>x</b>@x.test', access_token: 'secret-at', role: 'gm' };
  const c2 = w.ML.myCardHtml();
  assert.doesNotMatch(c2, /<b>x/); assert.doesNotMatch(c2, /secret-at/);
  w.win._mlSignedIn = false;
});

test('管理者セキュアページをアプリの中から開く・アプリに戻る（ログインはそのまま・画面と役割を戻す）', async () => {
  const w = await world();
  w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm'); await w.ML.login();
  w.win.curPage = 'meeting'; w.win.curStore = 'F01'; w.win._karteUnlocked = false;
  await w.ML.openSecure();
  assert.equal(w.calls.secure, 1);
  assert.equal(w.node('app-shell').style.display, 'none');
  assert.equal(w.node('mgr-back-app').hidden, false);
  assert.equal(w.win._secureMode, true);
  assert.equal(w.ML.secureLogout === undefined, false);
  await w.ML.backToApp();
  assert.equal(w.win._secureMode, false); assert.equal(w.win._karteUnlocked, false);
  assert.deepEqual([w.win.curRole, w.win.curStore, w.win.curUserName], ['gm', 'F01', 'GM Sample']);
  assert.equal(w.node('app-shell').style.display, 'block'); assert.equal(w.node('mgr-back-app').hidden, true);
  assert.equal(w.node('manager-secure-screen').style.display, 'none');
  assert.deepEqual(w.calls.render.at(-1), 'meeting');
  assert.equal(w.win._mlSignedIn, true, 'ログインはそのまま');
  // セキュアページの「ログアウト」：アプリのログアウトと同じ
  await w.ML.openSecure();
  assert.equal(w.ML.secureLogout(), true);
  assert.equal(w.calls.logout, 1); assert.equal(w.win._mlSignedIn, false); assert.equal(w.win._secureMode, false);
  // アプリから開いていないとき（前の入り方）は何もしない
  assert.equal(w.ML.secureLogout(), false);
  // メールでログインしていなければ開かない
  await w.ML.openSecure();
  assert.equal(w.calls.secure, 2);
  assert.match(w.calls.toast.at(-1)[0], /メールとパスワードでログインしたとき/);
});

test('給与：PIN なしで入った人はログインの印で頼む／読めていないときは保存しない（空の給与で上書きしない）', async () => {
  const sent = [];
  const ctx = { window: null, SUPABASE_URL: 'https://db.test', curUserName: 'GM Sample', curStoreLogin: false, curRole: 'gm', console,
    supaHeaders: () => ({ apikey: 'anon-key', Authorization: 'Bearer anon-key' }), t: ja => ja, showToast: m => sent.push(['toast', m]), Promise, JSON, Number,
    fetch: async (url, init) => { const b = JSON.parse(init.body); sent.push(['fetch', b]); if (refuseToken && b.token) return Response.json({ ok: false, error: 'pin' }); return Response.json({ ok: true, private: { E2: { wage: 30 } } }); } };
  let refuseToken = false;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fnSrc('fetchEmpPrivate') + fnSrc('_empPrivOk') + fnSrc('saveEmpPrivate'), ctx);
  ctx._mlSignedIn = true; ctx._hwSession = 'mark:E2:1';
  assert.equal(await ctx.saveEmpPrivate('S1', 0, '', '', null), 'failed');
  assert.equal(sent.filter(x => x[0] === 'fetch').length, 0, '読めていないときは送らない');
  await ctx.fetchEmpPrivate();
  const f = sent.find(x => x[0] === 'fetch')[1];
  assert.deepEqual(f, { action: 'pull', name: 'GM Sample', token: 'mark:E2:1' });
  assert.equal(ctx._empPrivate.E2.wage, 30);
  assert.equal(await ctx.saveEmpPrivate('S1', 19, '', '', null), true);
  const s = sent.filter(x => x[0] === 'fetch').at(-1)[1];
  assert.equal(s.action, 'save'); assert.equal(s.token, 'mark:E2:1'); assert.equal(s.pin, undefined);
  // v1186：メールで入った人は、PIN を入れたあと（割引など）も印を先に（emp-private v1186 は GM・CEO・経理の PIN を受けない）
  ctx._sessionPin = '1357'; let k = sent.length; await ctx.fetchEmpPrivate();
  assert.deepEqual(sent.slice(k).map(x => x[1]), [{ action: 'pull', name: 'GM Sample', token: 'mark:E2:1' }]);
  k = sent.length; assert.equal(await ctx.saveEmpPrivate('S1', 20, '', '', null), true);
  assert.deepEqual(sent.slice(k).map(x => [x[1].token, x[1].pin]), [['mark:E2:1', undefined]]);
  // 印を断られた（印を受けない前の emp-private）：PIN でもう一度
  refuseToken = true; ctx._empPrivate = null; k = sent.length; await ctx.fetchEmpPrivate();
  assert.deepEqual(sent.slice(k).map(x => x[1]), [{ action: 'pull', name: 'GM Sample', token: 'mark:E2:1' }, { action: 'pull', name: 'GM Sample', pin: '1357' }]);
  assert.equal(ctx._empPrivate.E2.wage, 30);
  k = sent.length; assert.equal(await ctx.saveEmpPrivate('S1', 21, '', '', null), true);
  assert.deepEqual(sent.slice(k).map(x => [x[1].token, x[1].pin, x[1].wage]), [['mark:E2:1', undefined, 21], [undefined, '1357', 21]]);
  // PIN が無ければ PIN では頼まない（保存できなかった）
  ctx._sessionPin = null; k = sent.length; assert.equal(await ctx.saveEmpPrivate('S1', 22, '', '', null), 'failed');
  assert.equal(sent.length - k, 1);
  refuseToken = false;
  // PIN で入った人（メールのログインでない）：今までどおり PIN
  ctx._mlSignedIn = false; ctx._hwSession = 'mark:E2:pin'; ctx._sessionPin = '1357'; await ctx.fetchEmpPrivate();
  assert.deepEqual(sent.filter(x => x[0] === 'fetch').at(-1)[1], { action: 'pull', name: 'GM Sample', pin: '1357' });
  // 端末のログイン（PIN なし）も印で
  ctx._sessionPin = null; ctx._mlSignedIn = false; ctx._dlSignedIn = true; ctx._hwSession = 'mark:S1:2'; await ctx.fetchEmpPrivate();
  assert.equal(sent.filter(x => x[0] === 'fetch').at(-1)[1].token, 'mark:S1:2');
  // どちらでもない（印も PIN も無い）：頼まない
  ctx._dlSignedIn = false; const n = sent.length; await ctx.fetchEmpPrivate(); assert.equal(sent.length, n);
});

test('本体への組み込み（名前を選ぶ・戻る・ログアウト 2 か所・セキュアページ・マイページ・版）', () => {
  assert.match(HTML, /function loginPickPerson\(empId, el\) \{[\s\S]{0,260}loginStoreMode = false;\n  try\{ if\(window\.FUNERGY_ML && FUNERGY_ML\.route\(emp\)\) return; \}catch\(e\)\{\}/);
  assert.equal(HTML.split("try{ if(window.FUNERGY_ML) FUNERGY_ML.onLogout(); }catch(e){}").length - 1, 2, 'doLogout の 2 つの写し');
  assert.equal(HTML.split('if(window.FUNERGY_ML && FUNERGY_ML.secureLogout()) return;').length - 1, 2, 'managerLogout の 2 つの写し');
  assert.match(HTML, /FUNERGY_UX\.afterEnter\(\); \}catch\(e\)\{\}\n  try\{ if \(window\.FUNERGY_ML\) FUNERGY_ML\.afterEnter\(\); \}catch\(e\)\{\}/);
  assert.match(HTML, /FUNERGY_ML\.myCardHtml\(\)/);
  assert.match(HTML, /id="login-step-mail"/);
  assert.match(HTML, /id="ml-pass" type="password" autocomplete="current-password"/);
  assert.match(HTML, /id="mgr-back-app" hidden onclick="FUNERGY_ML\.backToApp\(\)"/);
  assert.match(HTML, /function invInDefaultPin\(\)\{\n  if \(!invInLoginPerson\(\)\) return false;\n  if \(window\._dlSignedIn\) return false;[^\n]*\n  if \(window\._mlSignedIn\) return false;/);
  // チャット：GM・CEO は操作なしのロックをしない
  assert.match(HTML, /noIdleLock\(\)/);
  const av = Number((HTML.match(/const APP_VERSION = '(\d+)';/) || [])[1]), sv = Number((SW.match(/const SW_BUILD = '(\d+)';/) || [])[1]);
  assert.ok(av >= 1185 && av === sv, 'APP_VERSION と SW_BUILD は 1185 以上で同じ');
  // FUNERGY_ML が localStorage に書くのは端末の番号だけ。sessionStorage・IndexedDB は使わない
  const blk = mlBlock();
  assert.deepEqual([...blk.matchAll(/localStorage\.setItem\(([^,]+),/g)].map(m => m[1].trim()), ['DEV']);
  assert.doesNotMatch(blk, /sessionStorage|indexedDB/);
  assert.doesNotMatch(blk, /localStorage\.setItem\([^)]*(_authSession|access_token|refresh_token|password|_hwSession)/);
});

// ---------- v1186（Moto さん 11/16 23:24 HST「PINでのログインやめます」・Codex #183 の P2） ----------
const tick = () => new Promise(r => setTimeout(r, 0));
async function untilIdle(w) { for (let i = 0; i < 100; i++) { await tick(); if (!w.win._uxLoginBusy) return; } throw new Error('doStaffLogin did not finish'); }
const pinCalls = w => w.sent.filter(x => x.url.endsWith('/functions/v1/auth-pin'));

test('v1186：PIN のログインを止めたら「PIN でログイン」を出さない・PIN の段に行けない・言葉に PIN を出さない', async () => {
  const w = await world({ v1186: true });
  w.pick('E2', 'GM Sample', 'gm');
  assert.equal(await w.ML.info(false), true); await tick();
  assert.equal(w.ML.pinOff(), true);
  assert.equal(w.node('ml-pin').style.display, 'none', '「PIN でログイン（試しのあいだ）」を出さない');
  const info = w.sent.filter(isInfo);
  assert.equal(info.length, 1);
  assert.equal(info[0].headers.Authorization, 'Bearer anon-key', 'ログインの前（公開の鍵）');
  let picked = null; w.win.loginPickPerson = id => { picked = id; };
  w.ML.usePin();
  assert.equal(picked, null, 'PIN の段に行かない');
  assert.match(w.node('ml-err').textContent, /PIN ではなくメールとパスワードでログインします/);
  assert.equal(w.node('login-step-mail').style.display, 'block');
  w.ML._t.S.pinFor = 'E2';
  assert.equal(w.ML.route(w.win.loginPerson), true, '前に PIN を選んでいてもメールの段');
  w.ML.forgot();
  assert.doesNotMatch(w.node('ml-forgot-text').textContent, /PIN/);
  // 人違いのメール・サーバーがまだ：「PIN でログイン」を勧めない
  w.type('office@x.test', 'pw-office'); await w.ML.login();
  assert.match(w.node('ml-err').textContent, /GM Sample さんとして入れません/);
  assert.doesNotMatch(w.node('ml-err').textContent, /PIN/);
  assert.doesNotMatch(w.ML._t.msg('not_installed'), /PIN/);
  // 5 分は聞き直さない
  w.pick('E1', 'CEO Sample', 'ceo'); await tick();
  assert.equal(w.sent.filter(isInfo).length, 1);
  // メールとパスワードではそのまま入れる（経理も）
  w.pick('E3', 'Office Sample', 'office'); w.type('office@x.test', 'pw-office'); await w.ML.login();
  assert.equal(w.calls.finish, 1); assert.equal(w.win._authSession.role, 'office');
  w.ML.onLogout();
});

test('v1186：まだ止めていない（v1185 の SQL・前の関数・つながらない）ときは今までどおり「PIN でログイン」を出す', async () => {
  for (const o of [{}, { oldFunction: true }]) {
    const w = await world(o);
    w.pick('E2', 'GM Sample', 'gm');
    assert.equal(await w.ML.info(false), false, JSON.stringify(o)); await tick();
    assert.equal(w.node('ml-pin').style.display, '');
    assert.match(w.ML._t.msg('not_installed'), /PIN でログイン/);
  }
  const w = await world({ v1186: true });
  w.authDown = true;
  w.pick('E2', 'GM Sample', 'gm');
  assert.equal(await w.ML.info(false), null, 'つながらない：分からない');
  await tick();
  assert.equal(w.node('ml-pin').style.display, '', '分からないときは出す（本当に止めるのは auth-pin）');
  w.authDown = false;
  assert.equal(await w.ML.info(false), true, '分からなければ次に聞き直す');
});

test('v1186：PIN の段から（本物の doStaffLogin）：止めたのを知っていれば auth-pin に聞かない・auth-pin が「メールで」と答えたらメールの段・スタッフは今までどおり', async () => {
  // (a) 止めたのを知っている
  const a = await world({ v1186: true, authPin: () => ({ ok: true, use_email: true }) });
  a.pick('E2', 'GM Sample', 'gm'); await a.ML.info(false);
  a.node('login-step-mail').style.display = 'none'; a.node('login-pin-input').value = '1357';
  a.win.doStaffLogin(); await untilIdle(a);
  assert.equal(pinCalls(a).length, 0, 'PIN を送らない');
  assert.equal(a.node('login-step-mail').style.display, 'block');
  assert.match(a.node('ml-err').textContent, /PIN ではなくメールとパスワード/);
  assert.equal(a.node('login-pin-input').value, '');
  assert.equal(a.calls.finish, 0); assert.equal(a.win._sessionPin, undefined);
  // (b) まだ聞けていない（つながらなかった）→ auth-pin（v1186）が印を出さずに「メールで」→ メールの段・前の印も使わない
  const b = await world({ v1186: true, authPin: () => ({ ok: true, use_email: true }) });
  b.authDown = true; b.pick('E2', 'GM Sample', 'gm'); await b.ML.info(false); b.authDown = false;
  assert.equal(b.ML.pinOff(), false);
  b.win._hwSession = 'old-mark'; b.node('login-pin-input').value = '1357';
  b.win.doStaffLogin(); await untilIdle(b);
  assert.equal(pinCalls(b).length, 1);
  assert.deepEqual([pinCalls(b)[0].body.key, pinCalls(b)[0].body.emp], ['GM Sample', 'E2']);
  assert.equal(b.ML.pinOff(), true, 'auth-pin の答えで止めたのを知る');
  assert.equal(b.node('login-step-mail').style.display, 'block');
  assert.equal(b.win._hwSession, null); assert.equal(b.win._sessionPin, undefined); assert.equal(b.calls.finish, 0);
  assert.equal(b.node('login-pin-input').value, '');
  // (c) スタッフ・G4：今までどおり PIN（止めていても）
  const c = await world({ v1186: true, authPin: x => ({ ok: true, token: 'mark:' + x.emp }) });
  await c.ML.info(false);
  c.win.loginPerson = { id: 'S1', name: 'Crew', role: 'crew', status: '在籍' }; c.node('login-pin-input').value = '2468';
  c.win.doStaffLogin(); await untilIdle(c);
  assert.equal(c.calls.finish, 1); assert.equal(c.win._hwSession, 'mark:S1'); assert.equal(c.win._sessionPin, '2468');
  // 店舗のログインも今までどおり
  c.win.doLogout(); c.win.loginStoreMode = true; c.win.loginLocation = 'F01'; c.node('login-pin-input').value = '1111';
  c.win.doStaffLogin();
  for (let i = 0; i < 100 && c.win.curUserName !== 'Store One'; i++) await tick();   // 店舗のログインはアプリを出したところで外れる
  assert.equal(c.win.curUserName, 'Store One'); assert.equal(pinCalls(c).at(-1).body.scope, 'store');
  // (d) auth-pin が「メールで」と答えたのに、アプリの名簿では GM・CEO・経理でない（名簿のずれ）：PIN では入らず、その人をメールの段に回す
  const d = await world({ v1186: true, authPin: () => ({ ok: true, use_email: true }) });
  d.win.loginPerson = { id: 'X1', name: 'Mixed', role: 'crew', status: '在籍' }; d.node('login-pin-input').value = '1357';
  d.win.doStaffLogin(); await untilIdle(d);
  assert.equal(d.calls.finish, 0); assert.equal(d.win._sessionPin, undefined); assert.equal(d.win._hwSession, null);
  assert.equal(d.node('login-step-mail').style.display, 'block'); assert.equal(d.node('login-pin-input').value, '');
  assert.match(d.node('ml-err').textContent, /メールとパスワードでログインします/);
  assert.equal(d.ML.pinBlocked({ id: 'X2', name: 'Other', role: 'crew' }, false), false, 'ほかの Crew はメールの段に回さない');
});

test('v1186（Codex #183 の P2）：取り替えで役職が変わった（GM → 経理）→ 前の役職の画面のまま続けない', async () => {
  const w = await world();
  w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm'); await w.ML.login();
  assert.equal(w.win.curRole, 'gm');
  await w.sql(`update manager_auth set role = 'office' where emp_id = 'E2'`);
  await w.ML.refresh(true);
  assert.equal(w.calls.logout, 1); assert.match(w.calls.toast.at(-1)[0], /権限が変わりました/);
  assert.equal(w.win._mlSignedIn, false); assert.equal(w.win._authSession, null);
});

test('v1186（Codex #183 の P2）：確かめている途中に名前の一覧へ戻った → その答えでは入らない・メールのログインは閉じる・すぐに押し直せる', async () => {
  const w = await world();
  // (a) パスワードの確かめの途中
  w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm');
  const p = w.ML.login();
  w.ML.hideStep(true);
  assert.equal(w.win._uxLoginBusy, false, '戻った画面で押せる'); assert.equal(w.node('ml-btn').disabled, false);
  await p;
  assert.equal(w.calls.finish, 0); assert.equal(w.win._mlSignedIn, undefined);
  assert.equal(dlCalls(w).length, 0); assert.equal(w.closed.length, 1, 'パスワードのログインはサーバー側でも閉じる');
  // (b) device-login の途中（同じ人をもう一度選んでも、前の答えでは入らない）
  let reached = false, open; const gate = new Promise(r => { open = r; });
  const orig = w.win.fetch;
  w.win.fetch = async (u, i) => { if (String(u).endsWith('/functions/v1/device-login') && i && JSON.parse(i.body).action === 'email_login') { reached = true; await gate; } return orig(u, i); };
  w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm');
  const p2 = w.ML.login();
  for (let i = 0; i < 100 && !reached; i++) await tick();
  assert.ok(reached);
  w.ML.hideStep(true); w.pick('E2', 'GM Sample', 'gm');
  open(); await p2;
  assert.equal(w.calls.finish, 0); assert.notEqual(w.win._mlSignedIn, true);
  assert.equal(w.win._hwSession, undefined, '前の答えの印を使わない');
  assert.equal(w.closed.length, 2);
  // (c) そのあと、ふつうに入れる
  w.win.fetch = orig; w.type('gm@x.test', 'pw-gm'); await w.ML.login();
  assert.equal(w.calls.finish, 1); assert.equal(w.win._mlSignedIn, true);
  w.ML.onLogout();
});

test('v1186（Codex #183 の P3）：新しい端末の知らせは、本人には本人あての 1 つだけ・ほかの GM・CEO には 1 つ（本物の notifForMe）', async () => {
  const w = await world({ v1186: true });
  w.pick('E2', 'GM Sample', 'gm'); w.type('gm@x.test', 'pw-gm'); await w.ML.login();
  const ns = await w.notifs();
  assert.equal(ns.length, 2);
  const ctx = { curUserName: null, curRole: null, curStore: 'ALL', _userSupportsStore: () => false, _amManagesStore: () => false };
  vm.createContext(ctx);
  vm.runInContext(fnSrc('notifRetired') + fnSrc('_roleMatch') + fnSrc('notifForMe'), ctx);
  const see = (name, role) => { ctx.curUserName = name; ctx.curRole = role; return ns.filter(n => ctx.notifForMe(n)).map(n => n.id.slice(-2)); };
  assert.deepEqual(see('GM Sample', 'gm'), ['-u'], '本人：本人あてだけ（自分が出した GM・CEO あては出さない）');
  assert.deepEqual(see('CEO Sample', 'ceo'), ['-g']);
  assert.deepEqual(see('Other GM', 'gm'), ['-g']);
  assert.deepEqual(see('Office Sample', 'office'), []);
  assert.deepEqual(see('Crew', 'crew'), []);
  w.ML.onLogout();
});
