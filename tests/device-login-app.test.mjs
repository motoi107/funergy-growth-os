// v1183 アプリの FUNERGY_DL（ログインの試し）：本物のアプリのコード（index.html の <script>）を VM で動かし、本物の handler と本物の SQL（PGlite）に署名を送る。
// 合成データだけ（架空の名前・ID・PIN）。本番にはつながない。画面の通しは tests/e2e-login/device-login-v1183.mjs（Chrome）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHandler } from '../supabase/functions/device-login/handler.mjs';

const ROOT = new URL('..', import.meta.url);
const HTML = fs.readFileSync(new URL('index.html', ROOT), 'utf8');
const SW = fs.readFileSync(new URL('sw.js', ROOT), 'utf8');
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const FIDB = new URL('./runtime/node_modules/fake-indexeddb/build/esm/index.js', import.meta.url);
const MIG = fs.readFileSync(new URL('supabase/migrations/20261203090000_device_login.sql', ROOT), 'utf8');

function dlBlock() {
  const i = HTML.indexOf('/* ==== FUNERGY_DL（v1183）');
  assert.ok(i > 0, 'FUNERGY_DL がある');
  const s = HTML.lastIndexOf('<script>', i), e = HTML.indexOf('</script>', i);
  return HTML.slice(s + 8, e);
}

async function world() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, status text, role text, store text, data jsonb);
    grant select on public.manager_auth, public.employees to service_role;
    insert into public.employees values ('E2','GM Sample','在籍','gm','OFFICE','{}'),('S1','Aki Test','在籍','crew','F01','{}');
    insert into public.manager_auth values ('00000000-0000-4000-8000-0000000000c2','gm','E2');`);
  await pg.exec(MIG);
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const handler = createHandler({
    env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k], db,
    fetch: async (url, init) => { if (String(url).endsWith('/auth/v1/user')) return init.headers.authorization === 'Bearer tok-gm' ? Response.json({ id: '00000000-0000-4000-8000-0000000000c2' }) : new Response('{}', { status: 401 }); throw new Error('unexpected ' + url); },
    pinCheck: async (name, emp, pin) => (pin === '246813' ? { ok: true, mark: true } : { ok: false }),
    signMark: async ({ emp_id }) => 'mark:' + emp_id,
  });
  const sent = [];
  const fetchApp = async (url, init) => {
    sent.push({ url: String(url), headers: init.headers, body: init.body });
    return handler(new Request('https://fn.test/device-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: init.body }));
  };
  const call = async (body, who) => { const r = await handler(new Request('https://fn.test/device-login', { method: 'POST', headers: { 'content-type': 'application/json', ...(who ? { authorization: 'Bearer tok-' + who } : {}) }, body: JSON.stringify(body) })); return r.json(); };
  // アプリ（VM）
  const { indexedDB } = await import(FIDB);
  const store = new Map();
  const nodes = {};
  const doc = {
    readyState: 'complete', visibilityState: 'visible', head: { appendChild() {} }, body: { appendChild(n) { if (n.id) nodes[n.id] = n; } },
    getElementById: id => nodes[id] || null, querySelector: () => null, addEventListener() {},
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  };
  const win = {
    document: doc, localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    indexedDB, crypto: globalThis.crypto, TextEncoder, btoa, URL, fetch: fetchApp, console, setTimeout, clearTimeout, setInterval, clearInterval, Date, JSON, Promise,
    location: { href: 'https://funergy-plus.com/', origin: 'https://funergy-plus.com', pathname: '/' }, history: { replaceState() {} }, navigator: { userAgent: 'iPhone' },
    SUPABASE_URL: 'https://db.test', SUPABASE_ANON: 'anon-key', isSecureContext: true,
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(dlBlock(), win, { filename: 'FUNERGY_DL.js' });
  return { pg, db, call, win, store, sent, DL: win.FUNERGY_DL };
}

async function registered(w) {
  await w.call({ action: 'admin_trial', emp_id: 'S1', on: true }, 'gm');
  const inv = await w.call({ action: 'admin_invite', emp_id: 'S1' }, 'gm');
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const j = await crypto.subtle.exportKey('jwk', k.publicKey);
  const r = await w.call({ action: 'invite_complete', token: inv.token, pin: '246813', pubkey: { kty: j.kty, crv: j.crv, x: j.x, y: j.y }, device_name: 'Phone' });
  assert.equal(r.ok, true, JSON.stringify(r));
  await w.DL._t.keyPut('device', k.privateKey);
  w.DL._t.recSet({ v: 1, id: r.device_id, emp: 'S1', name: 'Aki Test', dname: 'Phone', at: new Date().toISOString() });
  return { r, inv };
}

test('アプリの署名がサーバーの確かめと合う（start・refresh・logout・reauth）', async () => {
  const w = await world();
  await registered(w);
  const s = await w.DL._t.signed('start', { action: 'start' });
  assert.equal(s.ok, true, JSON.stringify(s)); assert.equal(s.token, 'mark:S1'); assert.equal(s.emp_id, 'S1');
  const rf = await w.DL._t.signed('refresh', { action: 'start', mode: 'refresh' });
  assert.equal(rf.ok, true);
  // 何をするかも署名に入る：start の署名で reauth は通らない
  const wrong = await w.DL._t.signed('start', { action: 'reauth', pin: '246813' });
  assert.equal(wrong.error, 'bad_signature');
  const lo = await w.DL._t.signed('logout_this', { action: 'logout', scope: 'this' });
  assert.equal(lo.ok, true, JSON.stringify(lo));
  const s2 = await w.DL._t.signed('start', { action: 'start' });
  assert.equal(s2.error, 'reauth');
  const bad = await w.DL._t.signed('reauth', { action: 'reauth', pin: '000000' });
  assert.equal(bad.error, 'pin_wrong');
  const ra = await w.DL._t.signed('reauth', { action: 'reauth', pin: '246813' });
  assert.equal(ra.ok, true); assert.equal(ra.token, 'mark:S1');
  // 頼みに PIN・印・鍵を localStorage に残さない
  for (const [k, v] of w.store) assert.doesNotMatch(v, /246813|mark:S1|"d":/, k);
  // 頼みは公開の鍵（anon）で送る（メールのログインの印は送らない）
  assert.ok(w.sent.every(x => x.headers.Authorization === 'Bearer anon-key' && x.headers.apikey === 'anon-key'));
});

test('鍵が無い・登録が無い端末は送らない／外された端末は device_revoked', async () => {
  const w = await world();
  assert.equal((await w.DL._t.signed('start', { action: 'start' })).error, 'no_device');
  const { r } = await registered(w);
  await w.call({ action: 'admin_device_revoke', emp_id: 'S1', device_id: r.device_id }, 'gm');
  assert.equal((await w.DL._t.signed('start', { action: 'start' })).error, 'device_revoked');
  w.DL._t.recSet({ v: 1, id: r.device_id, emp: 'S1', name: 'Aki Test' });
  const n = w.sent.length;
  await w.DL._t.keyPut('device', undefined);
  assert.equal((await w.DL._t.signed('start', { action: 'start' })).error, 'no_key');
  assert.equal(w.sent.length, n, '鍵が無ければ確かめの値も頼まない');
});

test('招待のリンクの読み方（?dl= の 43 文字だけ）', async () => {
  const w = await world();
  const tk = 'A'.repeat(42) + 'b';
  assert.equal(w.DL._t.tokenFrom('https://funergy-plus.com/?dl=' + tk), tk);
  assert.equal(w.DL._t.tokenFrom('Aki さん：…\nhttps://funergy-plus.com/?x=1&dl=' + tk + '#a'), tk);
  assert.equal(w.DL._t.tokenFrom(tk), tk);
  assert.equal(w.DL._t.tokenFrom('https://funergy-plus.com/?dl=' + tk + 'X'), '');
  assert.equal(w.DL._t.tokenFrom('https://funergy-plus.com/?dl=short'), '');
  assert.equal(w.DL._t.tokenFrom(''), '');
});

test('本体への組み込み（ログアウト 2 か所・入口・起動・PIN が要る機能・版）', () => {
  const lo = HTML.split("try{ if(window.FUNERGY_DL) FUNERGY_DL.onLogout(); }catch(e){}").length - 1;
  assert.equal(lo, 2, 'doLogout の 2 つの写しで、前の人の印を消す前に呼ぶ');
  for (const block of HTML.split('(function doLogout() {').slice(1, 3)) {
    const a = block.indexOf('FUNERGY_DL.onLogout'), b = block.indexOf('window._sessionPin = null');
    assert.ok(a > 0 && b > a, 'onLogout は _sessionPin を消す前');
  }
  assert.match(HTML, /function bootLogin\(\) \{[\s\S]{0,2400}FUNERGY_DL\.paintEntry\(\)/);
  assert.match(HTML, /await _dlBootWhenReady\(\)/);
  assert.match(HTML, /function invInDefaultPin\(\)\{\n  if \(!invInLoginPerson\(\)\) return false;\n  if \(window\._dlSignedIn\) return false;/);
  assert.match(HTML, /async function insertDiscountUse\(storeCode\)\{\n  if\(curUserName && !window\._sessionPin && window\.FUNERGY_DL && window\._dlSignedIn\)\{ await window\.FUNERGY_DL\.ensurePin\(\); \}/);
  assert.match(HTML, /FUNERGY_DL\.myCardHtml\(\)/);
  assert.match(HTML, /FUNERGY_DL\.payPin\(\)/);
  assert.match(HTML, /canViewPins\(\)\?`<button class="btn btn-secondary btn-sm" onclick="FUNERGY_DL\.admin\(\)"/);
  const av = Number((HTML.match(/const APP_VERSION = '(\d+)';/) || [])[1]), sv = Number((SW.match(/const SW_BUILD = '(\d+)';/) || [])[1]);
  assert.ok(av >= 1183 && av === sv, 'APP_VERSION と SW_BUILD は 1183 以上で同じ');
  // FUNERGY_DL が localStorage に書くのは端末の記録だけ
  const blk = dlBlock();
  assert.deepEqual([...blk.matchAll(/localStorage\.setItem\(([^,]+),/g)].map(m => m[1].trim()), ['REC']);
  assert.doesNotMatch(blk, /sessionStorage/);
  // 鍵は取り出せない形で作る
  assert.match(blk, /generateKey\(\{ name: 'ECDSA', namedCurve: 'P-256' \}, false, \['sign', 'verify'\]\)/);
});
