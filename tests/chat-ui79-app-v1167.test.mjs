// v1167 チャット改修の画面（UI案79）：右下のボタン・パネル・申請のチャットを始める・管理する人・画像（印と説明）・ロック。
// index.html の FUNERGY_CHAT を VM で動かし、本物の handler と本物の SQL（PGlite・チャット＋添付＋UI案79）につなぐ。合成データだけ。
// 置き場所（Storage）・写真の縮小・PIN の確かめ（auth-pin）は代わり。仕様：docs/CHAT_UI79_V1167_JA.md
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

async function server({ files = true, ui79 = true } = {}) {
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
  if (files && ui79 && process.env.CHAT_WITH_GUARD === '1') await pg.exec(M('20261128090000_chat_guard'));   /* v1168：守りの SQL があっても同じ */
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
    createElement: tag => mkEl('', tag), head: { appendChild(c) { if (c.id) byId.set(c.id, c); } }, body: { appendChild(c) { if (c.id) byId.set(c.id, c); } } };
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
  const authCalls = [], authLock = { n: 0 };
  let pending = 0, blobs = 0;
  const ctx = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number, Uint8Array, Error, RegExp, Map, Set, Blob, File,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    crypto: webcrypto, SUPABASE_URL: 'https://db.test', SUPABASE_ANON: 'anon-key', _hwSession: emp ? 'pin-' + emp : null,
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
  return { ctx, D, toasts, pages, calls, wins, saves, confirms, revoked, idle, show, S, type, send, attach, realSave, authCalls, authLock };
}
async function start(a) { a.ctx.chatStart(); await a.idle(); a.show(); await a.idle(); }
async function openDm(a, to) { a.ctx.chatNew('dm'); await a.idle(); a.ctx.chatStartDm(to); await a.idle(); a.show(); await a.idle(); return a.S().open; }
const file = (name, bytes, type = '') => new File([bytes], name, { type });
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj');
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0]);
const rowsOf = async (srv, sql, args) => { await srv.pg.exec('reset role'); try { return (await srv.pg.query(sql, args)).rows; } finally { await srv.pg.exec('set role service_role'); } };
const busy = a => { a.D.main.innerHTML = '<div id="biz-form"><input id="biz-input" value="売上 1200"></div>'; };   // 業務の画面（年間計画など）
const el = (a, id) => a.D.getElementById(id);
const submitReq = (a, who, extra = {}) => a.ctx.chatAPI({ action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: 'wr-ui79-' + Math.random().toString(36).slice(2, 10),
  payload: { date: '2026-11-0' + (1 + Math.floor(Math.random() * 8)), payer: NAME[who], payer_is_employee: true, vendor: 'Vendor ' + Math.random().toString(36).slice(2, 6), purpose: '仕入れ', amount_cents: 1000 + Math.floor(Math.random() * 9000), ...extra } });

test('the chat button on a business screen opens the panel without redrawing the screen; minimize keeps the draft; the chat page says it is in the panel', async () => {
  const srv = await server();
  const a = await app(srv, 'E8');
  a.ctx.chatStart(); await a.idle();
  busy(a);
  a.ctx.chatStart(); await a.idle();
  const fab = el(a, 'chat-fab');
  assert.ok(fab && !fab.hidden, 'a chat button on the business screen');
  assert.match(fab.innerHTML, /チャット/);
  a.ctx.chatFab(); await a.idle();
  const fl = el(a, 'chat-float');
  assert.ok(fl && !fl.hidden, 'the panel opens');
  assert.ok(fab.hidden, 'the button hides while the panel is open');
  assert.ok(el(a, 'biz-form') && el(a, 'biz-input').value === '売上 1200', 'the business screen and its input stay');
  assert.match(el(a, 'chat-fbar').innerHTML, /chatDetach\(\)/);
  assert.match(el(a, 'chat-fbar').innerHTML, /chatLockNow\(\)/);
  assert.match(el(a, 'chat-fbar').innerHTML, /chatPin\(\)/);
  assert.match(el(a, 'chat-root').className, /chat-narrow/, 'a small panel shows the list or one conversation');
  // DM を始めて書きかけ → たたむ → 開く：書きかけと会話はそのまま
  a.ctx.chatNew('dm'); await a.idle();
  assert.ok(el(a, 'chat-new'), 'the new-conversation dialog opens inside the panel');
  a.ctx.chatStartDm('E9'); await a.idle();
  const tid = a.S().open;
  assert.match(el(a, 'chat-head').innerHTML, /送り先：Kai Kitchen ・ 参加者 2 人/);
  await a.type('下書きです');
  a.ctx.chatMin(); await a.idle();
  assert.ok(fl.hidden); assert.equal(el(a, 'chat-fbody').innerHTML, '', 'nothing of the chat stays on the screen');
  assert.ok(!fab.hidden);
  a.ctx.chatFab(); await a.idle();
  assert.equal(a.S().open, tid);
  assert.equal(el(a, 'chat-ta').value, '下書きです', 'the draft is back');
  // チャットのページを開いても、パネルで開いているあいだは同じ画面を作らない
  a.show();
  assert.match(a.D.main.innerHTML, /チャットはパネルで開いています/);
  assert.doesNotMatch(a.D.main.innerHTML, /id="chat-root"/);
  a.ctx.chatToPage(); a.show(); await a.idle();
  assert.ok(fl.hidden); assert.match(a.D.main.innerHTML, /id="chat-host-page"/);
  assert.ok(fab.hidden, 'no button on the chat page');
});

test('a request chat: the first opener sees the related people already picked, takes someone off, and starts it; others who only see the request are told it is for members', async () => {
  const srv = await server();
  const r7 = await app(srv, 'E7', { role: 'sl' });
  r7.ctx.chatStart(); await r7.idle(); busy(r7);
  const sub = await submitReq(r7, 'E7');
  r7.ctx.chatOpenCase(sub.id); await r7.idle();
  const dlg = text(el(r7, 'chat-case'));
  assert.match(dlg, /この申請のチャットを始める/);
  for (const n of ['Cora CEO', 'Gabe GM', 'Ann Acct']) assert.match(dlg, new RegExp(n));
  assert.equal((dlg.match(/type="checkbox" checked onchange="chatCaseSel/g) || []).length, 3, 'the related people are picked');
  assert.match(dlg, /加えた人が申請そのものを見られるようにはなりません/);
  r7.ctx.chatCaseSel('E1', false); r7.ctx.chatCaseSel('E6', true); r7.ctx.chatCaseTitle('領収書の確認');
  r7.ctx.chatCaseCreate(); await r7.idle();
  const tid = r7.S().open;
  assert.ok(tid);
  assert.ok(!el(r7, 'chat-float').hidden, 'opens in the panel; the request screen stays');
  assert.ok(el(r7, 'biz-form'));
  const mem = (await r7.ctx.chatAPI({ action: 'chat_messages', thread: tid })).members.map(x => x.emp).sort();
  assert.deepEqual(mem, ['E2', 'E3', 'E6', 'E7'], 'CEO taken off, the store manager added');
  // CEO：申請は見られるが参加者ではない
  const ceo = await app(srv, 'E1', { role: 'ceo' });
  ceo.ctx.chatStart(); await ceo.idle(); busy(ceo);
  ceo.ctx.chatOpenCase(sub.id); await ceo.idle();
  assert.match(ceo.toasts.map(x => x[1]).join('\n'), /参加者だけが開けます/);
  assert.equal(ceo.S().open, '');
  assert.equal(text(ceo.D.modal), '', 'no start dialog (one chat per request)');
  // 関数がまだ前の版（v1165 など）：作れないことを分かる言葉で（チャットはまだ作られていない）
  const old = await app(srv, 'E6', { role: 'sl', fail: { status: b => (b.action === 'chat_case_create' ? 'unknown_action' : null) } });
  old.ctx.chatStart(); await old.idle(); busy(old);
  const sub2 = await submitReq(old, 'E6');
  old.ctx.chatOpenCase(sub2.id); await old.idle();
  old.ctx.chatCaseCreate(); await old.idle();
  assert.match(text(el(old, 'chat-case')), /関数 work-requests）が v1167 になってから/);
  assert.equal(old.S().open, '');
});

test('managers: only they see add / remove / make manager; others are told; the last manager cannot step down', async () => {
  const srv = await server();
  const a = await app(srv, 'E8'), b = await app(srv, 'E9');
  await start(a); await start(b);
  a.ctx.chatNew('group'); await a.idle(); a.ctx.chatNewMode('group'); a.ctx.chatNewTitle('Prep'); a.ctx.chatNewSel('E9', true); a.ctx.chatNewSel('E6', true); a.ctx.chatCreateGroup(); await a.idle();
  a.show(); await a.idle();
  const tid = a.S().open;
  a.ctx.chatMembers(); await a.idle();
  let h = text(el(a, 'chat-mem'));
  assert.match(h, /人を加える/); assert.match(h, /管理にする/); assert.match(h, /chatRemove\('E9'\)/);
  assert.match(h, /<span class="chat-chip">管理<\/span>/);
  assert.doesNotMatch(h, /chatSetAdmin\('E8',false\)/, 'the only manager has no step-down button');
  b.ctx.chatRetrySync(); await b.idle(); b.ctx.chatOpen(tid); await b.idle(); b.ctx.chatMembers(); await b.idle();
  h = text(el(b, 'chat-mem'));
  assert.doesNotMatch(h, /chat-mem-add|chatMemQ/); assert.doesNotMatch(h, /管理にする/); assert.doesNotMatch(h, /chatRemove\('E6'\)/);
  assert.match(h, /この会話を管理する人だけです/);
  assert.match(h, /chatRemove\('E9'\)">抜ける/, 'anyone may leave');
  // @ に参加者でない人を出さない（加えられないので）。社員の一覧を読んだあとでも（新しい会話の画面で読む）
  b.ctx.chatDlgClose(); b.ctx.chatNew('group'); await b.idle(); b.ctx.chatDlgClose(); b.ctx.chatOpen(tid); await b.idle();
  const ta = el(b, 'chat-ta'); ta.value = '@'; ta.selectionStart = ta.selectionEnd = 1; b.ctx.chatInput(ta); await b.idle();
  assert.match(el(b, 'chat-pop').innerHTML, /Sam Store/, 'members are offered');
  assert.doesNotMatch(el(b, 'chat-pop').innerHTML, /この会話にいません/);
  // 管理する人には、参加者でない人も出る（加えてから送る）
  a.ctx.chatDlgClose(); const tA = el(a, 'chat-ta'); tA.value = '@'; tA.selectionStart = tA.selectionEnd = 1; a.ctx.chatInput(tA); await a.idle();
  assert.match(el(a, 'chat-pop').innerHTML, /この会話にいません/, 'a manager sees people who are not in it yet');
  a.ctx.chatInput(Object.assign(tA, { value: '' })); await a.idle();
  // 管理する人を足す → B も加えられる
  a.ctx.chatMembers(); await a.idle(); a.ctx.chatSetAdmin('E9', true); await a.idle();
  b.ctx.chatOpen(tid); await b.idle(); b.ctx.chatMembers(); await b.idle();
  assert.match(text(el(b, 'chat-mem')), /chat-mem-add/);
  // 確かめの途中で次の確かめを出すと、前のものは「やめる」になる（答えていないものは何もしない）
  a.ctx.chatMembers(); await a.idle();
  a.ctx.chatRemove('E6'); a.ctx.chatRemove('E9');
  a.ctx.chatAskAnswer(false); await a.idle();
  const left = await rowsOf(srv, 'select emp_id from public.chat_members where thread_id = $1 and left_at is null order by emp_id', [tid]);
  assert.deepEqual(left.map(r => r.emp_id), ['E6', 'E8', 'E9'], 'nobody was removed without a yes');
});

test('lock now hides the chat everywhere (no messages on the screen); a shared PC needs the login PIN (checked by the server, stops after wrong tries); idle lock after 5 minutes', async () => {
  const srv = await server();
  const a = await app(srv, 'E8');
  await start(a);
  const tid = await openDm(a, 'E9');
  await a.type('秘密の相談'); await a.send();
  assert.match(el(a, 'chat-msgs').innerHTML, /秘密の相談/);
  a.ctx.chatLockNow(); await a.idle();
  const page = a.D.getElementById('chat-host-page').innerHTML;
  assert.match(page, /ロック中（Cam Crew）/); assert.doesNotMatch(page, /秘密の相談|chat-msgs|chat-ta/);
  assert.match(page, /ログインの PIN/, 'a PC is a shared PC unless chosen otherwise');
  // まちがえた PIN
  el(a, 'chat-lock-pin').value = '1111'; a.ctx.chatUnlock(); await a.idle();
  assert.match(a.D.getElementById('chat-host-page').innerHTML, /PIN が違います/);
  assert.deepEqual(a.authCalls.at(-1), { action: 'verify', scope: 'staff', key: 'Cam Crew', pin: '1111', emp: 'E8' });
  assert.equal(a.ctx._hwSession, 'pin-E8', 'the login is not replaced');
  el(a, 'chat-lock-pin').value = '4321'; a.ctx.chatUnlock(); await a.idle();
  assert.match(el(a, 'chat-msgs').innerHTML, /秘密の相談/, 'unlocked');
  // 続けてまちがえると止まる（サーバーが止める）
  a.ctx.chatLockNow(); a.authLock.n = 3;
  el(a, 'chat-lock-pin').value = '4321'; a.ctx.chatUnlock(); await a.idle();
  assert.match(a.D.getElementById('chat-host-page').innerHTML, /続けて間違えたので止まっています（10 分）/);
  a.authLock.n = 0; el(a, 'chat-lock-pin').value = '4321'; a.ctx.chatUnlock(); await a.idle();
  // 自分の端末に変える → 30 分。続けるは PIN なし
  a.ctx.chatGuard(); await a.idle();
  assert.match(text(el(a, 'chat-gd')) || text(el(a, 'chat-layer')), /店の共有 PC/);   // v1168：守りの画面は chat-gd の中に描く
  a.ctx.chatSetDev('personal'); a.ctx.chatDlgClose();
  // 放っておいた：5 分では閉じない（自分の端末）・31 分で閉じる
  const realNow = Date.now; let off = 0;
  a.ctx.Date = class extends Date { static now() { return realNow() + off; } };
  try {
    const pg = () => a.D.getElementById('chat-host-page').innerHTML;
    off = 6 * 60000; a.ctx._chatIdleTick(); assert.match(pg(), /chat-msgs/, 'own device: not after 6 minutes');
    off = 31 * 60000; a.ctx._chatIdleTick(); assert.doesNotMatch(pg(), /chat-msgs/, 'own device: after 30 minutes');
    assert.match(a.D.getElementById('chat-host-page').innerHTML, /しばらく操作がなかった/);
    assert.doesNotMatch(a.D.getElementById('chat-host-page').innerHTML, /chat-lock-pin/, 'own device: no PIN');
    a.ctx.chatUnlock(); await a.idle(); assert.match(pg(), /chat-msgs/);
    // v1185：GM・CEO は放っておいてもロックしない（ほかの役割は今までどおり）
    const role0 = a.ctx.curRole;
    for (const r of ['gm', 'ceo']) {
      a.ctx.curRole = r; off += 120 * 60000; a.ctx._chatIdleTick(); assert.match(pg(), /chat-msgs/, r + ': no idle lock');
    }
    a.ctx.chatLockNow(); assert.match(pg(), /GM・CEO は、操作がなくてもロックしません/, 'lock now still works and says so');
    a.ctx.chatUnlock(); await a.idle(); assert.match(pg(), /chat-msgs/);
    a.ctx.curRole = role0;
    off += 120 * 60000; a.ctx._chatIdleTick(); assert.doesNotMatch(pg(), /chat-msgs/, 'other roles: idle lock as before');
    a.ctx.chatUnlock(); await a.idle(); assert.match(pg(), /chat-msgs/);
    // ロック中は端末の種類を変えられない
    a.ctx.chatLockNow(); a.ctx.chatSetDev('personal'); a.ctx.chatGuard();
    assert.doesNotMatch(a.D.getElementById('chat-host-page').innerHTML, /chat-dev/);
    a.ctx.chatUnlock(); await a.idle();
  } finally { a.ctx.Date = Date; }
  // ログインし直す（人が替わる）と共有 PC に戻る・ロックも捨てる
  a.ctx.chatReset(); a.ctx._hwSession = 'pin-E8'; await start(a);
  a.ctx.chatLockNow(); assert.match(a.D.getElementById('chat-host-page').innerHTML, /chat-lock-pin/);
});

test('an image: one pasted image opens “send an image” (preview, circle/arrow, undo, clear, note); send makes one message with the photo and the note; the other side zooms it', async () => {
  const srv = await server();
  const a = await app(srv, 'E8'), b = await app(srv, 'E9');
  await start(a);
  const tid = await openDm(a, 'E9');
  a.ctx.createImageBitmap = async () => ({ width: 1200, height: 800, close() {} });
  let rendered = null;
  a.ctx._chatShotRender = async s => { rendered = JSON.parse(JSON.stringify({ marks: s.marks, w: s.w, h: s.h })); return { blob: new Blob([JPG(300)], { type: 'image/jpeg' }), thumb: new Blob([JPG(60)], { type: 'image/jpeg' }), w: 1200, h: 800 }; };
  let prevented = false;
  a.ctx.chatPaste({ clipboardData: { files: [file('screen.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png')] }, preventDefault() { prevented = true; } });
  await a.idle();
  assert.ok(prevented, 'the image is not pasted as text');
  const lay = () => text(el(a, 'chat-layer'));
  assert.match(lay(), /画像を送る（Kai Kitchen へ）/); assert.match(lay(), /丸/); assert.match(lay(), /矢印/); assert.match(lay(), /元に戻す/); assert.match(lay(), /印を全部消す/); assert.match(lay(), /印は任意/);
  assert.match(lay(), /この画像をやめる/); assert.match(lay(), /id="chat-shot-cv"/);
  // 印（画面の上の位置は 0〜1）・元に戻す・説明
  const S = a.ctx._chatShot();
  S.marks.push({ t: 'circle', x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.3 }, { t: 'arrow', x0: 0.8, y0: 0.8, x1: 0.5, y1: 0.4 }, { t: 'arrow', x0: 0, y0: 0, x1: 1, y1: 1 });
  a.ctx.chatShotUndo();
  assert.equal(a.ctx._chatShot().marks.length, 2);
  a.ctx.chatShotDesc('この累計差は何月からですか？');
  // たたんで開いても、画像と印と説明は残る
  busy(a); a.ctx.chatFab(); await a.idle(); a.ctx.chatMin(); await a.idle(); a.ctx.chatFab(); await a.idle();
  assert.match(lay(), /画像を送る/); assert.match(lay(), /この累計差は何月からですか？/);
  a.ctx.chatShotSend(); await a.idle();
  assert.deepEqual(rendered.marks.map(m => m.t), ['circle', 'arrow']);
  assert.equal(a.ctx._chatShot(), null);
  const last = a.S().msgs[tid].list.at(-1);
  assert.equal(last.body, 'この累計差は何月からですか？'); assert.equal(last.files.length, 1); assert.equal(last.files[0].kind, 'photo');
  assert.equal((await rowsOf(srv, 'select count(*)::int n from public.chat_messages where thread_id = $1', [tid]))[0].n, 1, 'one message');
  // 相手：写真を押すと暗い全画面（拡大・返信）
  await start(b); b.ctx.chatOpen(tid); await b.idle();
  b.ctx.chatFileOpen(last.files[0].id); await b.idle();
  const v = text(el(b, 'chat-viewer'));
  assert.match(v, /id="chat-vw-stage"/); assert.match(v, /返信する/); assert.match(v, /指で広げる/);
  b.ctx.chatViewReply();
  assert.equal(text(el(b, 'chat-viewer')), '');
  // 2 枚・ほかのファイルと一緒は、前と同じく付ける欄へ
  a.ctx.chatPaste({ clipboardData: { files: [file('a.png', new Uint8Array([0x89, 0x50]), 'image/png'), file('b.png', new Uint8Array([0x89, 0x50]), 'image/png')] }, preventDefault() {} });
  await a.idle();
  assert.equal(a.ctx._chatShot(), null); assert.equal(a.S().att[tid].length, 2);
  // 文字だけの貼り付けはふつうに貼る
  let p2 = false; a.ctx.chatPaste({ clipboardData: { files: [], items: [] }, preventDefault() { p2 = true; } }); assert.equal(p2, false);
  // やめる
  a.S().att[tid] = [];
  a.ctx.chatPaste({ clipboardData: { files: [file('c.png', new Uint8Array([0x89, 0x50]), 'image/png')] }, preventDefault() {} }); await a.idle();
  assert.ok(a.ctx._chatShot()); a.ctx.chatShotCancel(); assert.equal(a.ctx._chatShot(), null); assert.equal(text(el(a, 'chat-layer')), '');
});

test('sending shows a percentage and a failed send offers “send again” (same key, one message) and “cancel”', async () => {
  const srv = await server();
  let lose = true;
  const a = await app(srv, 'E8', { fail: { after: b => b.action === 'chat_send' && lose && !(lose = false) } });
  await start(a);
  const tid = await openDm(a, 'E9');
  await a.attach(file('r.pdf', new TextEncoder().encode('%PDF-1.7\n1 0 obj')));
  await a.send();
  const out = a.S().out[tid];
  assert.equal(out.length, 1); assert.equal(out[0].st, 'failed');
  assert.match(el(a, 'chat-msgs').innerHTML, /送れませんでした/); assert.match(el(a, 'chat-msgs').innerHTML, /もう一度送る/); assert.match(el(a, 'chat-msgs').innerHTML, />やめる</);
  a.ctx.chatRetry(tid, out[0].key);
  assert.match(el(a, 'chat-msgs').innerHTML, /送信中… \d+%/);
  await a.idle();
  assert.equal(a.S().out[tid].length, 0);
  assert.equal((await rowsOf(srv, 'select count(*)::int n from public.chat_messages where thread_id = $1', [tid]))[0].n, 1, 'one message on the server');
});

test('removed from a conversation: the open chat closes on the next check and its draft, attached file and messages are dropped from the tab', async () => {
  const srv = await server();
  const a = await app(srv, 'E8'), b = await app(srv, 'E9');
  await start(a); await start(b);
  a.ctx.chatNew('group'); await a.idle(); a.ctx.chatNewMode('group'); a.ctx.chatNewTitle('Prep'); a.ctx.chatNewSel('E9', true); a.ctx.chatCreateGroup(); await a.idle();
  const tid = a.S().open;
  await a.type('秘密の段取り'); await a.send();
  b.ctx.chatRetrySync(); await b.idle(); b.ctx.chatOpen(tid); await b.idle(); b.show(); await b.idle();
  assert.match(el(b, 'chat-msgs').innerHTML, /秘密の段取り/);
  await b.type('書きかけ'); await b.attach(file('r.pdf', PDF));
  assert.equal(b.S().att[tid].length, 1);
  a.ctx.chatMembers(); await a.idle(); a.ctx.chatRemove('E9'); await a.idle();
  b.ctx.chatRetrySync(); await b.idle();
  const C = b.S();
  assert.equal(C.open, '', 'the open chat closed');
  assert.ok(!C.threads[tid] && !C.msgs[tid], 'no rows or messages kept');
  assert.ok(!(tid in C.drafts) && !C.att[tid] && !C.out[tid], 'no draft or attached file kept');
  b.show(); await b.idle();
  assert.doesNotMatch(b.D.main.innerHTML, /秘密の段取り|Prep/);
  assert.equal((await b.ctx.chatAPI({ action: 'chat_messages', thread: tid, limit: 10 }).catch(e => e)).code, 'not_found', 'the server refuses too');
});

test('logout closes the panel and the button, drops the image, the lock and the drafts; nothing is kept for the next person', async () => {
  const srv = await server();
  const a = await app(srv, 'E8');
  a.ctx.chatStart(); await a.idle(); busy(a);
  a.ctx.chatFab(); await a.idle();
  a.ctx.chatNew('dm'); await a.idle(); a.ctx.chatStartDm('E9'); await a.idle();
  await a.type('次の人に見せない');
  a.ctx.createImageBitmap = async () => ({ width: 10, height: 10, close() {} });
  a.ctx.chatPaste({ clipboardData: { files: [file('x.png', new Uint8Array([0x89, 0x50]), 'image/png')] }, preventDefault() {} }); await a.idle();
  a.ctx.chatLockNow();
  a.ctx.chatSwitchUser();
  assert.ok(a.pages.includes('logout'));
  assert.ok(el(a, 'chat-float').hidden); assert.equal(el(a, 'chat-fbody').innerHTML, '');
  assert.ok(el(a, 'chat-fab').hidden);
  assert.equal(a.ctx._chatShot(), null);
  assert.deepEqual(JSON.parse(JSON.stringify(a.S().drafts)), {});
  a.ctx._hwSession = 'pin-E9'; a.ctx.curUserName = NAME.E9; a.ctx.chatStart(); await a.idle();
  busy(a); a.ctx.chatFab(); await a.idle();
  assert.doesNotMatch(el(a, 'chat-fbody').innerHTML, /ロック中|次の人に見せない/);
});

test('without the UI79 SQL the start dialog is not offered and the error says the database is earlier; the static code has no device copies', async () => {
  const srv = await server({ ui79: false });
  const r7 = await app(srv, 'E7', { role: 'sl' });
  r7.ctx.chatStart(); await r7.idle();
  assert.equal(r7.S().st === 'missing' || r7.S().st === 'old', false);
  const t = await r7.ctx.chatAPI({ action: 'chat_case_create', id: '00000000-0000-4000-8000-000000000000', members: [], client_key: 'kkkkkkkk-77' }).catch(e => e);
  assert.equal(t.code, 'chat_old'); assert.match(t.message, /UI案79 の SQL がまだ/);
  const code = MOD.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code.split('W.localStorage.getItem(UI_KEY)').join('').split('W.localStorage.setItem(UI_KEY').join(''), /localStorage|indexedDB|sessionStorage|lsSet\(/);
  assert.doesNotMatch(code, /\.focus\(\)[^;]*EXT\.win|EXT\.win\.focus\(\)[\s\S]{0,40}paint/, 'a new message never brings the window forward');
  assert.match(code, /documentPictureInPicture\.requestWindow\(/);
  assert.match(code, /W\.open\('', 'funergy-chat', 'popup=yes/);
});
