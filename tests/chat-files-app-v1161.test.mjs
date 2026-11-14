// v1161 チャットの添付の画面（index.html の FUNERGY_CHAT の添付）を VM で動かし、本物の handler と本物の SQL（PGlite）につなぐ。
// 置き場所（Storage）・写真の縮小・新しい窓は代わり。合成データだけ。PIN の確かめは代わり（'pin-E7' は社員 E7）。仕様：docs/CHAT_FILES_V1161_JA.md
import test from 'node:test';
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
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));
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

async function server({ files = true } = {}) {
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
  await pg.exec('update public.wr_settings set live = true; set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const gm = { emp_id: 'E2', name: NAME.E2 }; const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  const storage = fakeStorage();
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db, storage,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  return { pg, handler, storage };
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
    createElement: tag => mkEl('', tag), head: { appendChild(c) { if (c.id) byId.set(c.id, c); } } };
  Object.defineProperty(dom, 'activeElement', { get: () => dom.active });
  byId.set('nav-bar', mkEl('nav-bar', 'div'));
  return dom;
}
// 要素の中身（書き直した子はその子の innerHTML、まだなら作ったときの中身）
const text = el => (el ? (el.innerHTML || el._snap || '') : '');


// 写真の縮小の代わり（長い辺 2000px にした大きさを返す。中身は合成の JPEG）。bad の名前は読めない写真
const shrink = async file => {
  if (/broken/.test(file.name)) throw new Error('decode');
  return { blob: new Blob([JPG(5000)], { type: 'image/jpeg' }), w: 2000, h: 1500, thumb: new Blob([JPG(800)], { type: 'image/jpeg' }) };
};

async function app(srv, emp, { role = 'crew', fail = null, lang = 'ja' } = {}) {
  const D = fakeDom(), toasts = [], pages = [], calls = [], wins = [], saves = [], confirms = [], revoked = [];
  let pending = 0, blobs = 0;
  const ctx = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number, Uint8Array, Error, RegExp, Map, Set, Blob, File,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    crypto: webcrypto, SUPABASE_URL: 'https://db.test', SUPABASE_ANON: 'anon-key', _hwSession: emp ? 'pin-' + emp : null,
    curStoreLogin: false, curRole: role, curPage: 'chat', workTab: 'today', STORES: [{ id: 'S1', name: 'Store One' }, { id: 'S2', name: 'Store Two' }],
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
        const body = JSON.parse(init.body); calls.push(body.action);
        if (fail && fail.before && fail.before(body)) throw new TypeError('offline');
        const r = await srv.handler(new Request(url, init));
        if (fail && fail.after && fail.after(body)) throw new TypeError('the answer was lost after the server saved');
        if (fail && fail.status && fail.status(body)) return new Response(JSON.stringify({ error: fail.status(body) }), { status: 400 });
        return r;
      } finally { pending--; }
    },
  };
  ctx.window = ctx; ctx.document = D;
  vm.createContext(ctx);
  vm.runInContext(MOD, ctx);
  ctx._chatShrink = shrink;
  const realSave = ctx._chatSaveUrl;
  ctx._chatSaveUrl = (u, n) => saves.push([u, n]);
  const idle = async () => { for (let quiet = 0; quiet < 3;) { await sleep(8); quiet = pending ? 0 : quiet + 1; } };
  const show = () => { D.main.innerHTML = ctx.renderChatPage(); };
  const S = () => ctx._chatState();
  const type = async v => { const ta = D.getElementById('chat-ta'); ta.value = v; ta.selectionStart = ta.selectionEnd = v.length; ctx.chatInput(ta); await idle(); };
  const send = async () => { ctx.chatKey({ key: 'Enter', keyCode: 13, isComposing: false, ctrlKey: true, metaKey: false, preventDefault() {} }); await idle(); };
  const attach = async (...files) => { ctx.chatPickFiles({ files, value: 'x' }); await idle(); };
  return { ctx, D, toasts, pages, calls, wins, saves, confirms, revoked, idle, show, S, type, send, attach, realSave };
}
async function start(a) { a.ctx.chatStart(); await a.idle(); a.show(); await a.idle(); }
async function openDm(a, to) { a.ctx.chatNew('dm'); await a.idle(); a.ctx.chatStartDm(to); await a.idle(); a.show(); await a.idle(); return a.S().open; }
const file = (name, bytes, type = '') => new File([bytes], name, { type });
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj');
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0]);
const rowsOf = async (srv, sql, args) => { await srv.pg.exec('reset role'); try { return (await srv.pg.query(sql, args)).rows; } finally { await srv.pg.exec('set role service_role'); } };

test('attach and send (1B・2A・3A): a photo is resized as JPEG with a small picture, a PDF goes as it is; one message; the list says what was sent', async () => {
  const srv = await server();
  const a = await app(srv, 'E8'), b = await app(srv, 'E9');
  await start(a);
  const tid = await openDm(a, 'E9');
  assert.match(text(a.D.getElementById('chat-comp')), /accept="image\/\*,\.pdf,\.xlsx,\.xls,\.csv,\.docx,\.doc,\.pptx,\.ppt,\.txt"/);
  await a.attach(file('IMG_0001.HEIC', JPG(90000), 'image/heic'), file('menu.pdf', PDF, 'application/pdf'));
  const att = a.S().att[tid];
  assert.deepEqual(J(att.map(x => [x.name, x.ext, x.kind, x.st])), [['IMG_0001.jpg', 'jpg', 'photo', 'ready'], ['menu.pdf', 'pdf', 'pdf', 'ready']]);
  assert.deepEqual(J([att[0].w, att[0].h, att[0].size]), [2000, 1500, 5000], 'the resized photo, not the original');
  assert.match(text(a.D.getElementById('chat-tray')), /IMG_0001\.jpg/);
  assert.match(text(a.D.getElementById('chat-tray')), /<img src="blob:https:\/\/app\.test\/1" alt="">/);
  assert.match(text(a.D.getElementById('chat-tray')), /menu\.pdf/);
  await a.send();   // 文なしでも送れる
  assert.deepEqual(J(a.S().att[tid]), [], 'the tray is cleared');
  assert.equal(a.S().out[tid].length, 0, 'sent');
  const m = a.S().msgs[tid].list.at(-1);
  assert.equal(m.body, '');
  assert.deepEqual(J(m.files.map(f => [f.name, f.kind])), [['IMG_0001.jpg', 'photo'], ['menu.pdf', 'pdf']]);
  // 置き場所：写真（JPEG）・小さい写真・PDF の 3 つ、決まった形で
  assert.deepEqual(srv.storage.puts.map(p => [p.path.endsWith('.t'), p.type, p.size]).sort(),
    [[false, 'application/pdf', PDF.length], [false, 'image/jpeg', 5000], [true, 'image/jpeg', 800]].sort());
  assert.equal((await rowsOf(srv, `select count(*)::int n from public.chat_messages where thread_id = $1`, [tid]))[0].n, 1);
  assert.equal(a.S().threads[tid].preview.text, '写真 1 枚・ファイル 1 個');
  const h = text(a.D.getElementById('chat-msgs'));
  assert.match(h, /class="chat-ph one"/); assert.match(h, /aspect-ratio:2000\/1500/);
  assert.match(h, /alt="" src="blob:https:\/\/app\.test\/1"/, 'the sender sees the small picture made on this device');
  assert.ok(!a.calls.includes('chat_file_url'), 'no link asked for it');
  assert.match(h, /menu\.pdf<\/b><span>/);
  assert.doesNotMatch(h, /class="chat-bub"><\/div>/, 'no empty bubble');
  // 相手：一覧に「写真 1 枚・ファイル 1 個」、小さい写真はまとめてリンクを頼んで出す
  await start(b);
  assert.match(text(b.D.getElementById('chat-list')), /写真 1 枚・ファイル 1 個/);
  b.ctx.chatOpen(tid); await b.idle();
  const ph = m.files[0].id;
  assert.ok(b.calls.includes('chat_file_url'));
  assert.match(text(b.D.getElementById('chat-msgs')), new RegExp(`data-cf="${ph}" alt="" src="${URLB}/sign/chat-files/[^"]+\\.t\\?token=s"`));
  const n = b.calls.filter(c => c === 'chat_file_url').length;
  b.ctx.chatOpen(tid); await b.idle();
  assert.equal(b.calls.filter(c => c === 'chat_file_url').length, n, 'the links are reused for 4 minutes');
});

test('limits and kinds: 5 at a time, 10 MB, only the six kinds, empty, a photo that cannot be read; remove before sending; a resizing photo waits', async () => {
  const srv = await server();
  const a = await app(srv, 'E8');
  await start(a);
  const tid = await openDm(a, 'E9');
  await a.attach(file('a.exe', ZIP), file('b.zip', ZIP), file('notes.md', PDF), file('empty.txt', new Uint8Array(0)), file('big.pdf', new Uint8Array(10485761)), file('broken.png', JPG(10), 'image/png'));
  assert.deepEqual(J(a.S().att[tid]), []);
  const msgs = a.toasts.map(t => t[1]).join('\n');
  assert.match(msgs, /付けられない種類です.*（3）/); assert.match(msgs, /空のファイル/); assert.match(msgs, /大きすぎます（1 つ 10MB まで）/);
  assert.match(msgs, /broken\.jpg：この写真を読めませんでした/);
  const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]);
  const six = [['a.pdf', PDF], ['b.xlsx', ZIP], ['c.xls', OLE], ['d.csv', new TextEncoder().encode('日付,金額\n')], ['e.docx', ZIP], ['f.doc', OLE]].map(([n, x]) => file(n, x));
  await a.attach(...six);
  assert.equal(a.S().att[tid].length, 5);
  assert.match(a.toasts.at(-1)[1], /5 つまでです（1 つは付けていません）/);
  a.ctx.chatUnattach(a.S().att[tid][0].key);
  assert.equal(a.S().att[tid].length, 4);
  // 写真を縮めているあいだは送らない
  let release; a.ctx._chatShrink = f => new Promise(r => { release = () => r(shrink(f)); });
  await a.attach(file('slow.jpg', JPG(100), 'image/jpeg'));
  assert.match(text(a.D.getElementById('chat-tray')), /縮めています…/);
  await a.send();
  assert.match(a.toasts.at(-1)[1], /写真を縮めています/);
  assert.equal(a.S().att[tid].length, 5, 'still attached');
  release(); await a.idle();
  await a.send();
  assert.equal(a.S().msgs[tid].list.at(-1).files.length, 5);
  assert.deepEqual(J(a.S().msgs[tid].list.at(-1).files.map(f => f.kind)), ['sheet', 'sheet', 'sheet', 'doc', 'photo'], 'in the order attached');
});

test('a lost answer: sending again reuses the keys (no second upload or message); a cut upload is uploaded again once; discard gives the files back', async () => {
  const srv = await server();
  let lose = true;
  const a = await app(srv, 'E8', { fail: { after: b => b.action === 'chat_send' && lose && !(lose = false) } });
  await start(a);
  const tid = await openDm(a, 'E9');
  await a.type('レシート'); await a.attach(file('r.pdf', PDF));
  await a.send();
  const o = a.S().out[tid][0];
  assert.equal(o.st, 'failed');
  assert.match(text(a.D.getElementById('chat-msgs')), /r\.pdf/);
  const puts = srv.storage.puts.length;
  a.ctx.chatRetry(tid, o.key); await a.idle();
  assert.equal(a.S().out[tid].length, 0);
  assert.equal(srv.storage.puts.length, puts, 'not uploaded again');
  assert.equal((await rowsOf(srv, `select count(*)::int n from public.chat_messages where thread_id = $1`, [tid]))[0].n, 1, 'one message');
  assert.equal((await rowsOf(srv, `select count(*)::int n from public.chat_files where thread_id = $1`, [tid]))[0].n, 1, 'one file');
  // 上げる途中で切れた：送ると「まだ無い」→ 1 回だけ上げ直して送る
  let cut = true;
  const b = await app(srv, 'E8', { fail: { put: () => cut && !(cut = false) } });
  await start(b); b.ctx.chatOpen(tid); await b.idle();
  await b.attach(file('s.pdf', PDF)); await b.send();
  assert.equal(b.S().out[tid][0].st, 'failed');
  assert.match(b.S().out[tid][0].err, /つながりません/);
  b.ctx.chatRetry(tid, b.S().out[tid][0].key); await b.idle();
  assert.equal(b.S().out[tid].length, 0);
  assert.equal(b.S().msgs[tid].list.at(-1).files[0].name, 's.pdf');
  // サーバーが file_missing（置き場所に無い）と言ったら、同じ鍵で上げ直してから送る
  const c = await app(srv, 'E8');
  await start(c); c.ctx.chatOpen(tid); await c.idle();
  await c.attach(file('t.pdf', PDF));
  const realPut = c.ctx.fetch; let dropped = 0;
  c.ctx.fetch = async (url, init) => { if (init.method === 'PUT' && !dropped++) return new Response('{"Key":"x"}', { status: 200 }); return realPut(url, init); };   // 「上げた」と答えたが入っていない
  await c.send();
  assert.equal(c.S().out[tid].length, 0, 'sent after one upload again');
  assert.equal(c.calls.filter(x => x === 'chat_file_start').length, 2, 'the same key asked again');
  // 送れなかったものを消す：文とファイルが戻る（新しい鍵）
  const d = await app(srv, 'E8', { fail: { before: b => b.action === 'chat_send' } });
  await start(d); d.ctx.chatOpen(tid); await d.idle();
  await d.type('x'); await d.attach(file('u.pdf', PDF)); await d.send();
  const od = d.S().out[tid][0], k0 = od.files[0].key;
  d.ctx.chatDiscard(tid, od.key);
  assert.equal(d.D.getElementById('chat-ta').value, 'x');
  assert.equal(d.S().att[tid].length, 1); assert.notEqual(d.S().att[tid][0].key, k0); assert.equal(d.S().att[tid][0].done, false);
});

test('content that does not match the name (file_bad) is said and not given back; before the SQL and with an old function the screen says so and text still works', async () => {
  const srv = await server();
  const a = await app(srv, 'E8');
  await start(a);
  const tid = await openDm(a, 'E9');
  await a.attach(file('fake.pdf', ZIP)); await a.send();
  const o = a.S().out[tid][0];
  assert.equal(o.code, 'file_bad'); assert.match(o.err, /中身が名前と合いません/);
  a.ctx.chatDiscard(tid, o.key);
  assert.deepEqual(J(a.S().att[tid] || []), [], 'not given back');
  // 添付の SQL がまだ
  const s0 = await server({ files: false });
  const b = await app(s0, 'E8');
  await start(b);
  const t0 = await openDm(b, 'E9');
  await b.attach(file('m.pdf', PDF)); await b.send();
  assert.match(b.S().out[t0][0].err, /添付のサーバー（SQL）がまだ入っていません/);
  await b.type('文字だけ'); await b.send();
  assert.equal(b.S().msgs[t0].list.at(-1).body, '文字だけ', 'text still works');
  // 関数が前の版（chat_file_start を知らない）
  const c = await app(srv, 'E8', { fail: { status: x => (x.action === 'chat_file_start' || x.action === 'chat_files' ? 'unknown_action' : '') } });
  await start(c); c.ctx.chatOpen(tid); await c.idle();
  await c.attach(file('n.pdf', PDF)); await c.send();
  assert.match(c.S().out[tid][0].err, /v1161 になってから/);
  c.ctx.chatFilesList(); await c.idle();
  assert.match(text(c.D.getElementById('chat-flist')), /v1161 になってから/);
});

test('open, save and the photo viewer (4A): a window opened at the tap gets the 5-minute link; save asks for the download link; links are never other hosts', async () => {
  const srv = await server();
  const a = await app(srv, 'E8'), b = await app(srv, 'E9');
  await start(a);
  const tid = await openDm(a, 'E9');
  await a.attach(file('レジ.jpg', JPG(50), 'image/jpeg'), file('表.xlsx', ZIP)); await a.send();
  const [ph, xl] = a.S().msgs[tid].list.at(-1).files;
  await start(b); b.ctx.chatOpen(tid); await b.idle();
  b.ctx.chatFileOpen(xl.id); await b.idle();
  assert.equal(b.wins.length, 1, 'opened at the tap');
  assert.match(b.wins[0].location.href, new RegExp(`^${URLB}/sign/chat-files/[^?]+\\?token=s$`));
  b.ctx.chatFileSave(xl.id); await b.idle();
  assert.equal(b.saves.length, 1); assert.match(b.saves[0][0], /download=%E8%A1%A8\.xlsx$/); assert.equal(b.saves[0][1], '表.xlsx');
  b.ctx.chatFileOpen(ph.id); await b.idle();
  assert.equal(b.wins.length, 1, 'a photo opens on this screen');
  const v = text(b.D.getElementById('chat-view'));
  assert.match(v, new RegExp(`<img src="${URLB}/sign/chat-files/[^"]+\\?token=s" alt="レジ\\.jpg"`));
  assert.doesNotMatch(v, /\.t\?/, 'the full photo, not the small one');
  assert.doesNotMatch(v, /申請に付ける/, 'not a request chat');
  // 新しい窓を開けない端末：押して開くリンク
  b.ctx.open = () => null;
  b.ctx.chatFileOpen(xl.id); await b.idle();
  assert.match(text(b.D.modal), /<a class="btn btn-primary" href="https:\/\/db\.test\/storage\/v1\/object\/sign\/chat-files\/[^"]+" target="_blank" rel="noopener noreferrer"/);
  // サーバーの答えのリンクがほかの所なら使わない
  const c = await app(srv, 'E9', { fail: { status: () => '' } });
  await start(c); c.ctx.chatOpen(tid); await c.idle();
  const realFetch = c.ctx.fetch;
  c.ctx.fetch = async (url, init) => { const body = JSON.parse(init.body); if (body.action === 'chat_file_url' && !body.thumb) return new Response(JSON.stringify({ url: 'javascript:alert(1)', name: 'x' })); return realFetch(url, init); };
  c.ctx.chatFileOpen(xl.id); await c.idle();
  assert.equal(c.wins[0].location.href, '', 'not navigated'); assert.equal(c.wins[0].closed, true);
  c.ctx.chatFileSave(xl.id); await c.idle();
  assert.equal(c.saves[0][0], 'javascript:alert(1)');
  // 本物の保存は https のリンクしか使わない（リンクを作らない・押さない・画面を動かさない）
  let clicked = [], went = [];
  const ce = c.D.createElement;
  c.D.createElement = tag => { const e = ce(tag); e.click = () => clicked.push(e.href); e.remove = () => {}; return e; };
  if (!c.D.body) c.D.body = { appendChild() {} };
  Object.defineProperty(c.ctx, 'location', { configurable: true, value: { set href(v) { went.push(v); }, get href() { return ''; } } });
  const nT = c.toasts.length;
  c.realSave(c.saves[0][0], 'x');
  assert.equal(c.toasts.length, nT + 1, 'one message for this tap');
  assert.match(c.toasts.at(-1)[1], /ファイルの置き場所につながりませんでした/);
  assert.deepEqual([clicked, went], [[], []]);
  c.realSave('https://db.test/storage/v1/object/sign/chat-files/a?token=s&download=x', 'x');
  assert.deepEqual(clicked, ['https://db.test/storage/v1/object/sign/chat-files/a?token=s&download=x'], 'an https link is saved');
});

test('this chat’s files (7A): newest first with who and when, more pages, the small pictures, opening from the list', async () => {
  const srv = await server();
  const a = await app(srv, 'E8');
  await start(a);
  const tid = await openDm(a, 'E9');
  for (let i = 0; i < 32; i++) { await a.attach(file(`f${String(i).padStart(2, '0')}.pdf`, PDF)); await a.send(); }
  await a.attach(file('last.jpg', JPG(40), 'image/jpeg')); await a.send();
  a.ctx.chatFilesList(); await a.idle();
  const h = text(a.D.getElementById('chat-flist'));
  assert.match(h, /この会話のファイル/);
  assert.ok(h.indexOf('last.jpg') < h.indexOf('f31.pdf') && h.indexOf('f31.pdf') < h.indexOf('f03.pdf'), 'newest first');
  assert.doesNotMatch(h, /f01\.pdf/, '30 messages a page');
  assert.match(h, /Cam Crew · /);
  assert.match(h, /前のファイルを読む/);
  a.ctx.chatFilesMore(); await a.idle();
  assert.match(text(a.D.getElementById('chat-flist')), /f00\.pdf/);
  assert.doesNotMatch(text(a.D.getElementById('chat-flist')), /前のファイルを読む/);
  // 送った写真の小さい絵はこのタブのものを使う（URL が無い環境では読みに行く）
  const id = a.S().flist.items[0].id;
  assert.match(text(a.D.getElementById('chat-flist')), new RegExp(`data-cf="${id}"`));
  a.ctx.chatFileOpen(a.S().flist.items[1].id); await a.idle();
  assert.equal(a.wins.length, 1);
});

test('edit and delete: a message with files can lose its text; delete says the files go too and they are removed from storage', async () => {
  const srv = await server();
  const a = await app(srv, 'E8');
  await start(a);
  const tid = await openDm(a, 'E9');
  await a.type('見てください'); await a.attach(file('x.pdf', PDF)); await a.send();
  const m = a.S().msgs[tid].list.at(-1);
  a.ctx.chatEdit(m.id);
  assert.match(text(a.D.modal), /ファイルはそのまま/);
  a.D.getElementById('chat-edit-ta').value = '';
  a.ctx.chatEditSave(); await a.idle();
  assert.equal(a.S().msgs[tid].list.at(-1).body, '');
  assert.equal(a.S().msgs[tid].list.at(-1).files.length, 1);
  const path = (await rowsOf(srv, 'select path from public.chat_files where id = $1', [m.files[0].id]))[0].path;
  a.ctx.chatDelete(m.id); await a.idle(); await sleep(20);
  assert.match(a.confirms.at(-1), /付けたファイル（1 つ）もサーバーから消えます/);
  assert.equal(a.S().msgs[tid].list.at(-1).deleted, true);
  assert.deepEqual(J(a.S().msgs[tid].list.at(-1).files), []);
  assert.ok(srv.storage.removed.includes(path), 'removed from storage');
  // 文だけのメッセージは空にできない
  await a.type('only text'); await a.send();
  a.ctx.chatEdit(a.S().msgs[tid].list.at(-1).id);
  a.D.getElementById('chat-edit-ta').value = '';
  a.ctx.chatEditSave(); await a.idle();
  assert.match(text(a.D.getElementById('chat-dlg-err')), /空にはできません/);
});

test('use as the receipt (8B): only the requester, only a reimbursement waiting or returned, photo or PDF; the request detail opens it', async () => {
  const srv = await server();
  const r7 = await app(srv, 'E7', { role: 'sl' }), gm = await app(srv, 'E2', { role: 'gm' });
  await start(r7);
  const sub = await r7.ctx.chatAPI({ action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: 'wr-test-000001-files',
    payload: { date: '2026-11-01', payer: NAME.E7, payer_is_employee: true, vendor: 'Costco', purpose: '仕入れ', amount_cents: 8640 } });
  r7.ctx.chatOpenCase(sub.id); await r7.idle(); r7.show(); await r7.idle();
  const tid = r7.S().open;
  assert.equal(r7.S().threads[tid].ref.mine, true);
  await r7.attach(file('receipt.jpg', JPG(60), 'image/jpeg'), file('memo.pdf', PDF), file('list.xlsx', ZIP)); await r7.send();
  const [ph, pdf, xl] = r7.S().msgs[tid].list.at(-1).files;
  let h = text(r7.D.getElementById('chat-msgs'));
  assert.match(h, new RegExp(`chatFileReceipt\\('${ph.id}'\\)">写真を申請に付ける`));
  assert.match(h, new RegExp(`chatFileReceipt\\('${pdf.id}'\\)">申請に付ける`));
  assert.doesNotMatch(h, new RegExp(`chatFileReceipt\\('${xl.id}'\\)`), 'not Excel');
  // GM（決める人）には出さない
  await start(gm); gm.ctx.chatOpenCase(sub.id); await gm.idle(); gm.show(); await gm.idle();
  assert.doesNotMatch(text(gm.D.getElementById('chat-msgs')), /申請に付ける/);
  // 付ける
  r7.ctx.chatFileReceipt(ph.id); await r7.idle();
  assert.match(r7.confirms.at(-1), new RegExp(`この写真を申請 ${sub.code} の領収書にしますか`));
  assert.match(r7.toasts.at(-1)[1], new RegExp(`申請 ${sub.code} の領収書にしました`));
  const row = (await rowsOf(srv, 'select payload, rev from public.wr_requests where id = $1', [sub.id]))[0];
  assert.equal(row.payload.receipt.chat_file, ph.id);
  assert.equal(r7.S().threads[tid].ref.rev, row.rev, 'the screen knows the new version');
  h = text(r7.D.getElementById('chat-msgs'));
  assert.match(h, /chat-ph-tag">申請に付けた/);
  assert.doesNotMatch(h, new RegExp(`chatFileReceipt\\('${ph.id}'\\)`), 'not offered again');
  // PDF に付け替える（版が進んでいても今の版で）
  r7.ctx.chatFileReceipt(pdf.id); await r7.idle();
  assert.equal((await rowsOf(srv, 'select payload from public.wr_requests where id = $1', [sub.id]))[0].payload.receipt.chat_file, pdf.id);
  // 古い画面（版が違う）：断られて読み直す（付け替えない）
  await r7.attach(file('again.pdf', PDF)); await r7.send();
  const again = r7.S().msgs[tid].list.at(-1).files[0], realRev = r7.S().threads[tid].ref.rev;
  r7.S().threads[tid].ref.rev = 1;
  r7.ctx.chatFileReceipt(again.id); await r7.idle();
  assert.match(r7.toasts.at(-1)[1], /ほかの人が先に変えました/);
  assert.equal(r7.S().threads[tid].ref.rev, realRev, 'read again');
  assert.equal((await rowsOf(srv, 'select payload from public.wr_requests where id = $1', [sub.id]))[0].payload.receipt.chat_file, pdf.id);
  // 承認されたら出さない
  const cur = await gm.ctx.chatAPI({ action: 'get', id: sub.id });
  await gm.ctx.chatAPI({ action: 'act', id: sub.id, op: 'approve', expect_rev: (cur.request || cur).rev, client_key: 'wr-test-000002-files' });
  r7.ctx.chatRetrySync(); await r7.idle(); await r7.idle();
  r7.ctx.chatOpen(tid); await r7.idle();
  assert.notEqual(r7.S().threads[tid].ref.status, 'pending');
  assert.doesNotMatch(text(r7.D.getElementById('chat-msgs')), /申請に付ける/);
  // 申請の画面：チャットの写真・PDF の領収書を開く（申請を見られる人）
  const ac = await app(srv, 'E3', { role: 'office' });
  ac.ctx.chatReceiptOpen(sub.id); await ac.idle();
  assert.match(ac.wins[0].location.href, new RegExp(`^${URLB}/sign/chat-files/`));
  const c8 = await app(srv, 'E9');
  c8.ctx.chatReceiptOpen(sub.id); await c8.idle();
  assert.equal(c8.wins[0].closed, true); assert.match(c8.toasts.at(-1)[1], /見られません/);
  c8.ctx.chatReceiptOpen('not-an-id'); await c8.idle();
  assert.equal(c8.wins.length, 1, 'a bad id does nothing');
  // #155 の Codex（6876878458）の 2：答えが来る前にログアウトして別の人がログインしたら、前の人の領収書を開かない（窓も閉じる）
  const hold = async (who, change) => {
    const x = await app(srv, 'E3', { role: 'office' });
    if (who === 'blocked') x.ctx.open = () => null;   // ポップアップを止める端末（リンクの画面を出すところ）
    const realFetch = x.ctx.fetch;
    let release; const gate = new Promise(r => { release = r; });
    x.ctx.fetch = async (url, init) => { const r = await realFetch(url, init); if (init && init.body && /wr_receipt_url/.test(init.body)) await gate; return r; };
    x.ctx.chatReceiptOpen(sub.id); await sleep(30);
    change(x);
    release(); await x.idle();
    return x;
  };
  for (const [name, change] of [
    ['logout and another person signs in', x => { x.ctx.chatReset(); x.ctx._hwSession = 'pin-E9'; }],
    ['another person signs in (no reset)', x => { x.ctx._hwSession = 'pin-E9'; }],
    ['logout only', x => { x.ctx.chatReset(); x.ctx._hwSession = null; }],
  ]) {
    const x = await hold('', change);
    assert.equal(x.wins.length, 1, name);
    assert.equal(x.wins[0].location.href, '', name + ': the old link is not opened');
    assert.equal(x.wins[0].closed, true, name + ': the window opened on the tap is closed');
    assert.equal(x.D.modal.innerHTML, '', name + ': no link on the screen');
    assert.equal(x.toasts.length, 0, name + ': nothing shown to the next person');
  }
  const xb = await hold('blocked', x => { x.ctx.chatReset(); x.ctx._hwSession = 'pin-E9'; });
  assert.equal(xb.D.modal.innerHTML, '', 'a blocked pop-up: the link screen is not shown to the next person');
  // 同じ人のままなら開く（ポップアップを止める端末はリンクの画面）
  const xs = await hold('blocked', () => {});
  assert.match(xs.D.modal.innerHTML, new RegExp(`href="${URLB}/sign/chat-files/`));
  // ログインしていない画面からは呼ばない
  const xn = await app(srv, null, { role: 'office' });
  xn.ctx.chatReceiptOpen(sub.id); await xn.idle();
  assert.equal(xn.wins.length, 0); assert.match(xn.toasts.at(-1)[1], /ログイン/);
});

test('file names are shown as text; logout forgets the attachments and links; nothing is kept on the device; the request detail is wired', async () => {
  const srv = await server();
  const a = await app(srv, 'E8');
  await start(a);
  const tid = await openDm(a, 'E9');
  await a.attach(file("Tom's & <b>.pdf", PDF)); await a.send();
  const h = text(a.D.getElementById('chat-msgs'));
  assert.doesNotMatch(h, /<b>\.pdf|Tom's/); assert.match(h, /Tom&#39;s &amp; _b_\.pdf/, 'the server takes out < > and the screen escapes the rest');
  await a.attach(file('q.jpg', JPG(30), 'image/jpeg')); await a.send();   // q.jpg は送った（その絵はこのタブで使う）
  await a.attach(file('left.pdf', PDF), file('p.jpg', JPG(30), 'image/jpeg'));   // まだ送っていない
  const local = a.S().att[tid].find(x => x.kind === 'photo').local;
  assert.match(local, /^blob:/);
  a.ctx.chatReset(); await a.idle();
  assert.ok(a.revoked.includes(local), 'the unsent picture is let go');
  assert.equal(a.revoked.length, 2, 'and the sent one too');
  const s = a.S();
  assert.deepEqual([Object.keys(s.att).length, Object.keys(s.furl).length, s.flist, s.view], [0, 0, null, null]);
  assert.doesNotMatch(MOD.replace(/\/\*[\s\S]*?\*\//g, ''), /localStorage|indexedDB|lsSet\(|sessionStorage/, 'no copies on the device');
  assert.match(html, /if \(p\.receipt && p\.receipt\.chat_file\) o\.push\(\[T\('領収書','Receipt'\), chatRcLink\(r\)\]\);/);
  assert.match(html, /if \(typeof rc\.chat_file === 'string' && rc\.chat_file\) return \['c:' \+ rc\.chat_file\];/);
  assert.match(html, /onclick="wrAttSeen\(\\'c:\\'\+this\.dataset\.f\);if\(window\.chatReceiptOpen\)chatReceiptOpen\(this\.dataset\.a\);return false"/);
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const v = /const APP_VERSION = '(\d+)'/.exec(html)[1];
  assert.ok(Number(v) >= 1161); assert.match(sw, new RegExp("const SW_BUILD = '" + v + "'"));
});

test('an upload whose answer was lost is not uploaded twice; an upload link for another place is refused; a lost receipt answer is sent again with the same key', async () => {
  const srv = await server();
  let lose = true;
  const a = await app(srv, 'E8', { fail: { putAfter: () => lose && !(lose = false) } });
  await start(a);
  const tid = await openDm(a, 'E9');
  await a.attach(file('d.pdf', PDF)); await a.send();
  assert.equal(a.S().out[tid][0].st, 'failed');
  a.ctx.chatRetry(tid, a.S().out[tid][0].key); await a.idle();
  assert.equal(a.S().out[tid].length, 0, 'the second upload said “already there” and it went on');
  assert.equal(srv.storage.puts.length, 2, 'tried again and was told it is already there');
  assert.equal(srv.storage.objs.size, 1, 'stored once');
  assert.equal(a.S().msgs[tid].list.at(-1).files[0].name, 'd.pdf');
  // 上げる先がこの Supabase の Storage でなければ上げない
  const b = await app(srv, 'E8');
  await start(b); b.ctx.chatOpen(tid); await b.idle();
  const real = b.ctx.fetch;
  b.ctx.fetch = async (url, init) => {
    const r = await real(url, init);
    if (init.method !== 'PUT' && JSON.parse(init.body).action === 'chat_file_start') { const j = await r.json(); j.upload = { url: 'https://evil.test/storage/v1/object/upload/sign/chat-files/x?token=t' }; return new Response(JSON.stringify(j)); }
    return r;
  };
  const n = srv.storage.puts.length;
  await b.attach(file('e.pdf', PDF)); await b.send();
  assert.equal(b.S().out[tid][0].st, 'failed'); assert.match(b.S().out[tid][0].err, /ファイルを上げられませんでした/);
  assert.equal(srv.storage.puts.length, n, 'nothing sent elsewhere');
  // 申請に付ける：答えが届かなくても、押し直しは同じ鍵（版が 1 つだけ進む）
  const r7 = await app(srv, 'E7', { role: 'sl', fail: { after: x => x.action === 'wr_receipt_chat' && lose2 && !(lose2 = false) } });
  let lose2 = true;
  await start(r7);
  const sub = await r7.ctx.chatAPI({ action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: 'wr-test-000003-files',
    payload: { date: '2026-11-02', payer: NAME.E7, payer_is_employee: true, vendor: 'Costco', purpose: '仕入れ', amount_cents: 100 } });
  r7.ctx.chatOpenCase(sub.id); await r7.idle(); r7.show(); await r7.idle();
  const ct = r7.S().open;
  await r7.attach(file('r.pdf', PDF)); await r7.send();
  const f = r7.S().msgs[ct].list.at(-1).files[0];
  const v0 = (await rowsOf(srv, 'select version from public.wr_requests where id = $1', [sub.id]))[0].version;
  r7.ctx.chatFileReceipt(f.id); await r7.idle();
  assert.match(r7.toasts.at(-1)[1], /つながりません/);
  r7.ctx.chatFileReceipt(f.id); await r7.idle();
  assert.match(r7.toasts.at(-1)[1], /の領収書にしました/);
  assert.equal((await rowsOf(srv, 'select version from public.wr_requests where id = $1', [sub.id]))[0].version, v0 + 1, 'one new version, not two');
  assert.equal((await rowsOf(srv, `select count(*)::int n from public.wr_events where request_id = $1 and action = 'receipt_chat'`, [sub.id]))[0].n, 1);
});

// #155 の Codex（P3）：英語の画面で、本文の無い添付のメッセージの一覧の文が「写真 1 枚」と日本語だった（SQL の chat_files_label）。
// v1163：サーバーは数（preview.files）と状態（preview.state）も返し、画面の言葉で出す。前の SQL（files が無い）なら text のまま
test('v1163 the list line for files only, deleted and hidden follows the screen language (English too); without the new SQL it shows the text as before', async () => {
  const srv = await server();
  const a = await app(srv, 'E8');
  await start(a);
  const tid = await openDm(a, 'E9');
  const listOf = async (lang, q = '') => { const b = await app(srv, 'E9', { lang }); await start(b); if (q) { b.ctx._chatState().q = q; b.show(); } return text(b.D.getElementById('chat-list')); };
  await a.attach(file('IMG_0001.jpg', JPG(9000), 'image/jpeg'), file('menu.pdf', PDF, 'application/pdf')); await a.send();
  assert.match(await listOf('en'), /Cam Crew：1 photo · 1 file/);
  assert.match(await listOf('ja'), /Cam Crew：写真 1 枚・ファイル 1 個/);
  assert.match(await listOf('en', 'photo'), /1 photo · 1 file/, 'found by the English words');
  await a.attach(file('a.jpg', JPG(9000), 'image/jpeg'), file('b.jpg', JPG(9000), 'image/jpeg')); await a.send();
  assert.match(await listOf('en'), /Cam Crew：2 photos/);
  await a.attach(file('シフト.xlsx', ZIP)); await a.send();
  assert.match(await listOf('en'), /Cam Crew：File “シフト\.xlsx”/);
  await a.attach(file('x.pdf', PDF), file('y.pdf', PDF)); await a.send();
  assert.match(await listOf('en'), /Cam Crew：2 files/);
  assert.match(await listOf('ja'), /Cam Crew：ファイル 2 個/);
  // 本文があれば本文
  await a.type('資料です'); await a.attach(file('z.pdf', PDF)); await a.send();
  assert.match(await listOf('en'), /Cam Crew：資料です/);
  // 消した：英語は (Deleted)
  a.ctx.chatDelete(a.S().msgs[tid].list.at(-1).id); await a.idle(); await sleep(20);
  assert.match(await listOf('en'), /Cam Crew：\(Deleted\)/);
  assert.match(await listOf('ja'), /Cam Crew：（削除されました）/);
  // 前の SQL（preview に files・state が無い）：text をそのまま出す（v1162 までと同じ）
  const old = M('20261124090000_chat_files').match(/create or replace function public\.chat_row[\s\S]*?\nend \$\$;\n/)[0]
    .replace(/jsonb_strip_nulls\(jsonb_build_object\('seq'([\s\S]*?)'at', lm\.created_at,\n[\s\S]*?public\.chat_files_count\(lm\.id\) end\)\) end,/, "jsonb_build_object('seq'$1'at', lm.created_at) end,");
  assert.doesNotMatch(old, /chat_files_count/);
  await srv.pg.exec('reset role'); await srv.pg.exec(old); await srv.pg.exec('set role service_role');
  assert.match(await listOf('en'), /Cam Crew：（削除されました）/, 'the old SQL still gives its Japanese text');
});

// #159 の Claude のレビュー（P3）：送った直後の自分の一覧の 1 行は、端末で作った文（filesLabel）だけで数を持たず、
// 英語は「1 photos, 1 files」と一覧の言い方（pvText「1 photo · 1 file」）と違っていた。日英を切り替えても前の言葉のまま。
test('#159 P3 right after sending files, my own list line uses the same wording and follows a language switch', async () => {
  const srv = await server();
  const a = await app(srv, 'E8', { lang: 'en' });
  await start(a);
  const tid = await openDm(a, 'E9');
  await a.attach(file('IMG_0002.jpg', JPG(9000), 'image/jpeg'), file('menu.pdf', PDF, 'application/pdf')); await a.send();
  const pv = a.S().threads[tid].preview;
  assert.deepEqual(JSON.parse(JSON.stringify(pv.files)), { ph: 1, ot: 1, name: 'menu.pdf' }, 'the counts are kept with the line (same shape as chat_files_count)');
  assert.match(text(a.D.getElementById('chat-list')), /You：1 photo · 1 file/);
  a.ctx.t = ja => ja; a.show(); await a.idle();
  assert.match(text(a.D.getElementById('chat-list')), /あなた：写真 1 枚・ファイル 1 個/, 'follows the language switch');
  a.ctx.t = (ja, en) => en;
  await a.attach(file('シフト.xlsx', ZIP)); await a.send();
  assert.equal(a.S().threads[tid].preview.files.name, 'シフト.xlsx');
  a.show(); await a.idle();
  assert.match(text(a.D.getElementById('chat-list')), /You：File “シフト\.xlsx”/);
  // 本文があれば数は持たない（本文を出す）
  await a.type('メモ'); await a.attach(file('z.pdf', PDF)); await a.send();
  assert.equal(a.S().threads[tid].preview.files, undefined);
  a.show(); await a.idle();
  assert.match(text(a.D.getElementById('chat-list')), /You：メモ/);
});
