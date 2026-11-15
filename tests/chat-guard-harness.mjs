// v1168 チャットの守りの画面の試験の土台（chat-ui79-app-v1167 の土台を写して、守りの SQL・ログインの PIN の確かめ・プッシュの送り先・Service Worker の代わりを足した）。
// index.html の FUNERGY_CHAT を VM で動かし、本物の handler と本物の SQL（PGlite）につなぐ。合成データだけ。試験そのものは chat-guard-app-v1168.test.mjs。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createHandler } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const B0 = '/* ==== FUNERGY_CHAT（v1156）', E0 = '/* ==== FUNERGY_CHAT end ==== */';
const MOD = html.slice(html.indexOf(B0), html.indexOf(E0) + E0.length);
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const MIGS = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68', '20261120090000_work_requests_stage2'];
const PEOPLE = [
  ['E1', 'Cora CEO', 'ceo', 'CEO', 'OFFICE', 'ceo'], ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'],
  ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', null], ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', null], ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', null],
  ['E8', 'Cam Crew', 'crew', 'Crew', 'S1', null], ['E9', 'Kai Kitchen', 'crew', 'Crew', 'S2', null],
];
export const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));
// 公開の鍵の形だけ（65 バイト・先頭 4）。本物の署名はしない（送り先は代わり）
export const VAPID_PUB = Buffer.from(new Uint8Array([4, ...new Array(64).fill(9)])).toString('base64url');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const J = v => JSON.parse(JSON.stringify(v ?? null));   // VM の中の配列・オブジェクトを比べられる形に
const URLB = 'https://db.test/storage/v1/object';
const JPG = n => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(Math.max(0, n - 4)).fill(7)]);

// 置き場所の代わり（handler 側と、アプリが PUT する先の両方）
function fakeStorage() {
  const objs = new Map();
  const st = {
    objs, puts: [], removed: [],
    async signUpload(path) { return { url: `${URLB}/upload/sign/chat-files/${path}?token=t`, token: 't' }; },
    async signDownload(paths, { download = null } = {}) {
      return Object.fromEntries(paths.filter(p => objs.has(p)).map(p => [p, `${URLB}/sign/chat-files/${p}?token=s` + (download ? '&download=' + encodeURIComponent(download) : '')]));
    },
    async head(path) { const o = objs.get(path); return o ? { bytes: o.slice(0, 16), size: o.length } : null; },
    async remove(paths) { st.removed.push(...paths); for (const p of paths) objs.delete(p); },
  };
  return st;
}

export async function server({ guard = true, push = true } = {}) {
  const files = true, ui79 = true;
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One','Ami Area',true),('S2','Store Two',null,true);`);
  for (const [id, name, role, title, store, ma] of PEOPLE) {
    await pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, name, role, title, store, JSON.stringify({ name })]);
    if (ma) await pg.query('insert into manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  for (const f of MIGS) await pg.exec(M(f));
  await pg.exec(M('20261121090000_chat'));
  if (files) await pg.exec(M('20261124090000_chat_files'));
  if (files && ui79) await pg.exec(M('20261127090000_chat_ui79'));
  if (guard) await pg.exec(M('20261128090000_chat_guard'));
  await pg.exec('update public.wr_settings set live = true; set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const gm = { emp_id: 'E2', name: NAME.E2 }; const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  const storage = fakeStorage();
  const pushed = [], later = [];
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' };
  if (push) Object.assign(env, { CHAT_VAPID_PUBLIC: VAPID_PUB, CHAT_VAPID_PRIVATE: 'priv' });
  const handler = createHandler({ env: k => env[k], db, storage,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; },
    loginCheck: async (w, pin) => (pin === '4321' ? { ok: true } : { ok: false }),   // ログインの PIN（代わり：4321）
    pushSend: async ep => { pushed.push(ep); return 201; }, waitUntil: p => { later.push(p); } });
  const flush = async () => { while (later.length) await later.shift(); };
  return { pg, handler, storage, pushed, flush };
}

// 小さな DOM の代わり：innerHTML から id のある要素を作る（textarea・input の値、display:none、中身）
function fakeDom() {
  const byId = new Map();
  const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  function innerOf(h, from, tag) {
    let depth = 1, i = from; const open = new RegExp('<' + tag + '\\b', 'g'), close = new RegExp('</' + tag + '>', 'g');
    while (depth > 0) {
      open.lastIndex = i; close.lastIndex = i;
      const o = open.exec(h), c = close.exec(h);
      if (!c) return h.slice(from);
      if (o && o.index < c.index) { depth++; i = o.index + 1; } else { depth--; if (!depth) return h.slice(from, c.index); i = c.index + 1; }
    }
    return '';
  }
  function drop(h) { const re = /\bid="([^"]+)"/g; let m; while ((m = re.exec(h))) byId.delete(m[1]); }
  function mkEl(id, tag) {
    let ih = '';
    const el = { id, tag, value: '', className: '', disabled: false, style: { display: '', height: '' }, scrollTop: 0, scrollHeight: 1000, clientHeight: 400, selectionStart: 0, selectionEnd: 0,
      get innerHTML() { return ih; }, set innerHTML(v) { drop(ih); ih = String(v); parse(ih); },
      focus() { dom.active = el; }, appendChild(c) { if (c.id) byId.set(c.id, c); } };
    return el;
  }
  function parse(h) {
    const re = /<(\w+)\b([^>]*?)\bid="([^"]+)"([^>]*)>/g; let m;
    while ((m = re.exec(h))) {
      const [, tag0, a1, id, a2] = m, tag = tag0.toLowerCase(), attrs = a1 + a2, el = mkEl(id, tag);
      byId.set(id, el);
      if (tag === 'textarea') { const rest = h.slice(m.index + m[0].length); el.value = unesc(rest.slice(0, rest.indexOf('</textarea>'))); el.selectionStart = el.selectionEnd = el.value.length; }
      else if (tag === 'input') { const v = /\bvalue="([^"]*)"/.exec(attrs); el.value = v ? unesc(v[1]) : ''; }
      else if (!['input', 'br', 'img'].includes(tag)) { const inner = innerOf(h, m.index + m[0].length, tag); Object.defineProperty(el, '_snap', { value: inner }); }
      const st = /style="([^"]*)"/.exec(attrs); if (st && /display:\s*none/.test(st[1])) el.style.display = 'none';
      const cl = /class="([^"]*)"/.exec(attrs); if (cl) el.className = cl[1];
      if (/\bdisabled\b/.test(attrs)) el.disabled = true;
    }
  }
  const main = mkEl('main-content', 'div'), modal = mkEl('modal', 'div');
  const dom = { byId, main, modal, active: null, hidden: false,
    getElementById: id => byId.get(id) || null, addEventListener() {}, removeEventListener() {},
    createElement: tag => mkEl('', tag), head: { appendChild(c) { if (c.id) byId.set(c.id, c); } }, body: { appendChild(c) { if (c.id) byId.set(c.id, c); } } };
  Object.defineProperty(dom, 'activeElement', { get: () => dom.active });
  byId.set('nav-bar', mkEl('nav-bar', 'div'));
  return dom;
}
// 要素の中身（書き直した子はその子の innerHTML、まだなら作ったときの中身）
export const text = el => (el ? (el.innerHTML || el._snap || '') : '');


// 写真の縮小の代わり（長い辺 2000px にした大きさを返す。中身は合成の JPEG）。bad の名前は読めない写真
const shrink = async file => {
  if (/broken/.test(file.name)) throw new Error('decode');
  return { blob: new Blob([JPG(5000)], { type: 'image/jpeg' }), w: 2000, h: 1500, thumb: new Blob([JPG(800)], { type: 'image/jpeg' }) };
};

// Service Worker とプッシュの代わり（端末ごと。同じ端末で人が替わるときは同じ sw を渡す）
export function fakeDevice({ perm = 'default', ios = false, standalone = false, noPush = false } = {}) {
  const dev = { perm, asked: 0, sub: null, subscribed: [], unsubscribed: [], listeners: [] };
  const pm = {
    async getSubscription() { return dev.sub; },
    async subscribe(o) { dev.subscribed.push(o); const ep = 'https://fcm.googleapis.com/fcm/send/dev-' + (dev.subscribed.length); const key = o.applicationServerKey;
      dev.sub = { endpoint: ep, options: { applicationServerKey: key.buffer.slice(0) }, async unsubscribe() { dev.unsubscribed.push(ep); if (dev.sub && dev.sub.endpoint === ep) dev.sub = null; return true; } }; return dev.sub; },
  };
  dev.reg = { pushManager: pm };
  dev.navigator = { userAgent: ios ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X)' : 'Mozilla/5.0 (Macintosh)', standalone, maxTouchPoints: ios ? 5 : 0,
    serviceWorker: noPush ? undefined : { async getRegistration() { return dev.reg; }, addEventListener(t, f) { if (t === 'message') dev.listeners.push(f); } } };
  dev.Notification = { get permission() { return dev.perm; }, requestPermission() { dev.asked++; if (dev.perm === 'default') dev.perm = 'granted'; return Promise.resolve(dev.perm); } };
  dev.message = d => dev.listeners.forEach(f => f({ data: d }));
  return dev;
}

export async function app(srv, emp, { role = 'crew', fail = null, lang = 'ja', dev = null, search = '' } = {}) {
  const D = fakeDom(), toasts = [], pages = [], calls = [], wins = [], saves = [], confirms = [], revoked = [];
  const authCalls = [], authLock = { n: 0 };
  let pending = 0, blobs = 0;
  const ctx = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number, Uint8Array, Error, RegExp, Map, Set, Blob, File,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    crypto: webcrypto, SUPABASE_URL: 'https://db.test', SUPABASE_ANON: 'anon-key', _hwSession: emp ? 'pin-' + emp : null,
    atob: s => Buffer.from(s, 'base64').toString('binary'), location: { search, pathname: '/', hash: '' }, history: { replaceState: () => { ctx.location.search = ''; } },
    curStoreLogin: false, curRole: role, curPage: 'chat', workTab: 'today', curUserName: emp ? NAME[emp] : null, doLogout: () => { pages.push('logout'); ctx.chatReset(); }, STORES: [{ id: 'S1', name: 'Store One' }, { id: 'S2', name: 'Store Two' }],
    t: lang === 'en' ? (ja, en) => en : ja => ja, kpi: (l, v, s) => `[${l}:${v}:${s}]`, showToast: (m, k) => toasts.push([k, m]),
    openModal: h => { D.modal.innerHTML = h; }, closeModalDirect: () => { D.modal.innerHTML = ''; }, confirm: m => { confirms.push(m); return true; },
    buildNav: () => pages.push('nav'), go: p => { ctx.curPage = p; pages.push('go:' + p); }, renderPage: p => pages.push('render:' + p),
    open: () => { const w = { closed: false, location: { href: '' }, close() { w.closed = true; } }; wins.push(w); return w; },
    URL: { createObjectURL: () => 'blob:https://app.test/' + (++blobs), revokeObjectURL: u => revoked.push(u) },
    fetch: async (url, init) => {
      pending++;
      try {
        if (init.method === 'PUT') {   // 置き場所へ上げる
          calls.push('PUT');
          assert.ok(url.startsWith(URLB + '/upload/sign/chat-files/'), url);
          const path = decodeURIComponent(new URL(url).pathname.replace('/storage/v1/object/upload/sign/chat-files/', ''));
          if (fail && fail.put && fail.put(path)) throw new TypeError('offline');
          const bytes = new Uint8Array(await init.body.arrayBuffer());
          srv.storage.puts.push({ path, type: init.headers['Content-Type'], size: bytes.length });
          if (srv.storage.objs.has(path)) return new Response(JSON.stringify({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }), { status: 400 });
          srv.storage.objs.set(path, bytes);
          if (fail && fail.putAfter && fail.putAfter(path)) throw new TypeError('the answer was lost after the upload');
          return new Response('{"Key":"x"}', { status: 200 });
        }
        if (/\/functions\/v1\/auth-pin$/.test(url)) {   // 本人の確かめ（代わり：PIN は 4321。続けて 3 回まちがえると止まる）
          const b = JSON.parse(init.body); calls.push('auth-pin'); authCalls.push(b);
          if (authLock.n >= 3) return new Response(JSON.stringify({ ok: false, error: 'locked', retry_after: 600 }), { status: 200 });
          if (b.action === 'verify' && b.scope === 'staff' && b.emp === emp && b.pin === '4321') { authLock.n = 0; return new Response(JSON.stringify({ ok: true, token: 'pin-' + emp + '-new' }), { status: 200 }); }
          authLock.n++; return new Response(JSON.stringify({ ok: false }), { status: 200 });
        }
        const body = JSON.parse(init.body); calls.push(body.action);
        if (fail && fail.before && fail.before(body)) throw new TypeError('offline');
        const r = await srv.handler(new Request(url, init));
        if (fail && fail.after && fail.after(body)) throw new TypeError('the answer was lost after the server saved');
        if (fail && fail.status && fail.status(body)) return new Response(JSON.stringify({ error: fail.status(body) }), { status: 400 });
        return r;
      } finally { pending--; }
    },
  };
  if (dev) { ctx.navigator = dev.navigator; if (!dev.navigator.serviceWorker) {} else { ctx.PushManager = function(){}; ctx.Notification = dev.Notification; } }
  else ctx.navigator = { userAgent: 'node' };
  const bodies = [];
  const fetch0 = ctx.fetch; ctx.fetch = async (url, init) => { if (init && typeof init.body === 'string' && /work-requests/.test(url)) bodies.push(JSON.parse(init.body)); return fetch0(url, init); };
  ctx.window = ctx; ctx.document = D;
  vm.createContext(ctx);
  vm.runInContext(MOD, ctx);
  ctx._chatShrink = shrink;
  const realSave = ctx._chatSaveUrl;
  ctx._chatSaveUrl = (u, n) => saves.push([u, n]);
  // v1167：確かめはチャットの画面の中（ブラウザの confirm ではない）。ここでは前と同じく「はい」と答え、文を confirms に残す
  const answerAsks = () => { const el = D.getElementById('chat-askl'); const h = el ? el.innerHTML : ''; if (h) { confirms.push(h.replace(/<[^>]+>/g, '')); ctx.chatAskAnswer(true); return true; } return false; };
  const idle = async () => { for (let quiet = 0; quiet < 3;) { await sleep(8); quiet = (pending || answerAsks()) ? 0 : quiet + 1; } };
  const show = () => { D.main.innerHTML = ctx.renderChatPage(); };
  const S = () => ctx._chatState();
  const type = async v => { const ta = D.getElementById('chat-ta'); ta.value = v; ta.selectionStart = ta.selectionEnd = v.length; ctx.chatInput(ta); await idle(); };
  const send = async () => { ctx.chatKey({ key: 'Enter', keyCode: 13, isComposing: false, ctrlKey: true, metaKey: false, preventDefault() {} }); await idle(); };
  // v1161 の付ける欄（v1167 からは写真 1 枚だけのときは「画像を送る」になるので、ここでは欄へ直接）
  const attach = async (...files) => { ctx._chatAddFiles(ctx._chatState().open, files); await idle(); };
  return { ctx, D, toasts, pages, calls, wins, saves, confirms, revoked, idle, show, S, type, send, attach, realSave, authCalls, authLock, bodies, dev };
}
export async function start(a) { a.ctx.chatStart(); await a.idle(); a.show(); await a.idle(); }
export async function openDm(a, to) { a.ctx.chatNew('dm'); await a.idle(); a.ctx.chatStartDm(to); await a.idle(); a.show(); await a.idle(); return a.S().open; }
const file = (name, bytes, type = '') => new File([bytes], name, { type });
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj');
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0]);
export const rowsOf = async (srv, sql, args) => { await srv.pg.exec('reset role'); try { return (await srv.pg.query(sql, args)).rows; } finally { await srv.pg.exec('set role service_role'); } };
export const busy = a => { a.D.main.innerHTML = '<div id="biz-form"><input id="biz-input" value="売上 1200"></div>'; };   // 業務の画面（年間計画など）
export const el = (a, id) => a.D.getElementById(id);
export const sleepMs = ms => new Promise(r => setTimeout(r, ms));
