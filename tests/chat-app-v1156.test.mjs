// v1156 チャットの画面（index.html の FUNERGY_CHAT）を VM で動かし、本物の handler と本物の SQL（PGlite）につなぐ。合成データだけ。
// PIN の確かめは代わり（'pin-E7' は社員 E7）。仕様：docs/CHAT_V1156_JA.md
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createHandler } from '../supabase/functions/work-requests/handler.mjs';
const J = (v) => JSON.parse(JSON.stringify(v));

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const B = '/* ==== FUNERGY_CHAT（v1156）', E = '/* ==== FUNERGY_CHAT end ==== */';
const MOD = html.slice(html.indexOf(B), html.indexOf(E) + E.length);
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const MIGS = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68', '20261120090000_work_requests_stage2'];
const PEOPLE = [
  ['E1', 'Cora CEO', 'ceo', 'CEO', 'OFFICE', 'ceo'], ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'],
  ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', null], ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', null], ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', null],
  ['E8', 'Cam Crew', 'crew', 'Crew', 'S1', null], ['E9', 'Kai Kitchen', 'crew', 'Crew', 'S2', null], ['E13', 'Ora Office', 'crew', 'Crew', 'S1', 'office_crew'],
];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function server({ chat = true } = {}) {
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
  if (chat) await pg.exec(M('20261121090000_chat'));
  await pg.exec('update public.wr_settings set live = true; set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const gm = { emp_id: 'E2', name: NAME.E2 }; const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  return { pg, handler };
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

async function app(srv, emp, { role = 'crew', storeLogin = false, fail = null, gate = null } = {}) {
  const D = fakeDom(), toasts = [], pages = [], calls = [];
  let pending = 0;
  const ctx = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number, Uint8Array, Error, RegExp, Map, Set,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    crypto: webcrypto, SUPABASE_URL: 'https://db.test', SUPABASE_ANON: 'anon-key', _hwSession: emp ? 'pin-' + emp : null,
    curStoreLogin: storeLogin, curRole: role, curPage: 'chat', workTab: 'today', STORES: [{ id: 'S1', name: 'Store One' }, { id: 'S2', name: 'Store Two' }],
    t: ja => ja, kpi: (l, v, s) => `[${l}:${v}:${s}]`, showToast: (m, k) => toasts.push([k, m]),
    openModal: h => { D.modal.innerHTML = h; }, closeModalDirect: () => { D.modal.innerHTML = ''; }, confirm: () => true,
    buildNav: () => pages.push('nav'), go: p => { ctx.curPage = p; pages.push('go:' + p); }, renderPage: p => pages.push('render:' + p),
    fetch: async (url, init) => {
      pending++;
      try {
        const body = JSON.parse(init.body); calls.push(body.action);
        const hold = gate && gate(body); if (hold) await hold;
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
  const idle = async () => { for (let quiet = 0; quiet < 3;) { await sleep(8); quiet = pending ? 0 : quiet + 1; } };
  const show = () => { D.main.innerHTML = ctx.renderChatPage(); };
  const S = () => ctx._chatState();
  const type = async v => { const ta = D.getElementById('chat-ta'); ta.value = v; ta.selectionStart = ta.selectionEnd = v.length; ctx.chatInput(ta); await idle(); };
  const key = (k, mods = {}) => { let prevented = false; ctx.chatKey({ key: k, keyCode: mods.composing ? 229 : 13, isComposing: !!mods.composing, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, preventDefault: () => { prevented = true; } }); return prevented; };
  return { ctx, D, toasts, pages, calls, idle, show, S, type, key };
}
async function start(a) { a.ctx.chatStart(); await a.idle(); a.show(); await a.idle(); }
async function openDm(a, to) { a.ctx.chatNew('dm'); await a.idle(); a.ctx.chatStartDm(to); await a.idle(); a.show(); await a.idle(); return a.S().open; }

test('before the chat SQL: the screen says so, no polling, no case button; the store tablet and an old function also say so', async () => {
  const srv = await server({ chat: false });
  const a = await app(srv, 'E8');
  await start(a);
  assert.equal(a.S().st, 'missing');
  assert.match(text(a.D.getElementById('chat-side')), /チャットのサーバー（SQL）がまだ入っていません/);
  assert.match(text(a.D.getElementById('chat-side')), /＋ 新しい会話<\/button>/);
  assert.match(text(a.D.getElementById('chat-side')), /onclick="chatNew\(\)" disabled/);
  const n = a.calls.length; a.ctx.chatStart(); await a.idle();
  assert.equal(a.calls.length, n, 'stops asking until the next login');
  assert.equal(a.ctx.chatCaseButton({ id: '00000000-0000-4000-8000-000000000000' }), '');
  // 店のタブレット（社員 ID が無い）
  const tab = await app(srv, null, { storeLogin: true, role: 'sl' });
  tab.ctx.chatStart(); await tab.idle(); tab.show();
  assert.equal(tab.calls.length, 0);
  assert.match(text(tab.D.main), /個人の PIN でログインした人だけ/);
  // 店のログインで印があっても使わない（店の印は人ではない）
  const tab2 = await app(srv, 'E7', { storeLogin: true, role: 'sl' });
  tab2.ctx.chatStart(); await tab2.idle(); tab2.show();
  assert.equal(tab2.calls.length, 0, 'the store login never asks the chat');
  assert.match(text(tab2.D.main), /個人の PIN でログインした人だけ/);
  assert.equal(tab2.ctx.chatCaseButton({ id: '00000000-0000-4000-8000-000000000000' }), '');
  // 前の版の関数（chat_* を知らない）
  const srv2 = await server();
  const old = await app(srv2, 'E8', { fail: { status: b => (b.action.startsWith('chat_') ? 'unknown_action' : '') } });
  await start(old);
  assert.equal(old.S().st, 'old');
  assert.match(text(old.D.getElementById('chat-side')), /関数 work-requests）が前の版/);
});

test('crew DM: start a DM, Ctrl/⌘+Enter sends (Enter and Japanese input do not), the other side sees unread and the badge, reading shows 既読', async () => {
  const srv = await server();
  const a = await app(srv, 'E8'), b = await app(srv, 'E9');
  await start(a); await start(b);
  const tid = await openDm(a, 'E9');
  assert.ok(tid);
  assert.ok(a.pages.includes('go:chat'));
  assert.match(text(a.D.getElementById('chat-head')), /Kai Kitchen/);
  await a.type('こんにちは');
  assert.equal(a.key('Enter', { composing: true, ctrl: true }), false, 'nothing during IME composition');
  assert.equal(a.key('Enter'), false, 'Enter alone is a new line');
  await a.idle();
  assert.equal(a.S().msgs[tid] ? a.S().msgs[tid].list.length : 0, 0);
  assert.equal(a.key('Enter', { ctrl: true }), true);
  await a.idle();
  assert.equal(a.S().msgs[tid].list.length, 1);
  assert.equal(a.D.getElementById('chat-ta').value, '', 'the box is cleared');
  await a.type('2 つ目'); a.key('Enter', { meta: true }); await a.idle();
  assert.equal(a.S().msgs[tid].list.length, 2);
  assert.match(text(a.D.getElementById('chat-msgs')), /あなた · /);
  // 相手：未読 2・数（ナビ・タブ）
  b.ctx.chatStart(); await b.idle();
  const bs = b.S(); bs.lastFull = 0; b.ctx.chatStart();
  await b.ctx.chatAPI({ action: 'chat_sync', since: 0 }).then(() => {});
  // 読み直し（合図の代わり）
  b.ctx.chatRetrySync(); await b.idle();
  assert.equal(b.ctx.chatUnread(), 2);
  assert.match(b.ctx.chatTabBadge(), />2</);
  b.show(); await b.idle();
  assert.match(text(b.D.getElementById('chat-list')), /Cam Crew/);
  assert.match(text(b.D.getElementById('chat-list')), /class="chat-unread">2/);
  b.ctx.chatOpen(tid); await b.idle(); await sleep(20); await b.idle();
  assert.equal(b.ctx.chatUnread(), 0, 'read when opened');
  // こちらの画面：既読（DM は数を出さない）
  a.ctx.chatOpen(tid); await a.idle();
  assert.match(text(a.D.getElementById('chat-msgs')), /· 既読</);
});

test('a lost answer keeps the message as "not sent" and "send again" reuses the key (one message on the server); discard puts the text back', async () => {
  const srv = await server();
  let lose = true;
  const a = await app(srv, 'E8', { fail: { after: b => b.action === 'chat_send' && lose && !(lose = false) } });
  await start(a);
  const tid = await openDm(a, 'E9');
  await a.type('in order?'); a.key('Enter', { ctrl: true }); await a.idle();
  const o = a.S().out[tid];
  assert.equal(o.length, 1); assert.equal(o[0].st, 'failed');
  assert.match(text(a.D.getElementById('chat-msgs')), /送れませんでした/);
  assert.match(text(a.D.getElementById('chat-msgs')), /もう一度送る/);
  const k = o[0].key;
  a.ctx.chatRetry(tid, k); await a.idle();
  assert.equal(a.S().out[tid].length, 0);
  assert.equal(a.S().msgs[tid].list.length, 1);
  assert.equal((await srv.pg.query(`select count(*)::int n from public.chat_messages where client_key = $1`, [k])).rows[0].n, 1, 'one message');
  assert.equal((await srv.pg.query(`select count(*)::int n from public.chat_messages where thread_id = $1`, [tid])).rows[0].n, 1, 'send again did not make a second message');
  // 届かなかった（サーバーに入っていない）→ 消す：入力欄に戻る
  const b = await app(srv, 'E8', { fail: { before: x => x.action === 'chat_send' } });
  await start(b);
  b.ctx.chatOpen(tid); await b.idle();
  await b.type('offline text'); b.key('Enter', { ctrl: true }); await b.idle();
  const k2 = b.S().out[tid][0].key;
  assert.equal(b.S().out[tid][0].st, 'failed');
  b.ctx.chatDiscard(tid, k2);
  assert.equal(b.S().out[tid].length, 0);
  assert.equal(b.D.getElementById('chat-ta').value, 'offline text');
  assert.equal((await srv.pg.query(`select count(*)::int n from public.chat_messages where client_key = $1`, [k2])).rows[0].n, 0);
});

test('group: @ shows members first; @ a non-member asks to add (with or without the earlier messages) and then mentions them', async () => {
  const srv = await server();
  const a = await app(srv, 'E7', { role: 'sl' });
  await start(a);
  a.ctx.chatNew('group'); await a.idle();
  a.ctx.chatNewMode('group'); a.ctx.chatNewTitle('Lunch team'); a.ctx.chatNewSel('E8', true);
  assert.equal(a.D.getElementById('chat-new-ok').disabled, false);
  a.ctx.chatCreateGroup(); await a.idle();
  a.show(); await a.idle();
  const tid = a.S().open;
  assert.equal(a.S().threads[tid].kind, 'group');
  await a.type('first one'); a.key('Enter', { ctrl: true }); await a.idle();
  await a.type('hi @Ca');
  assert.deepEqual(J(a.S().pop.items.map(x => [x.emp, x.member])), [['E8', true]]);
  a.ctx.chatPick(0);
  assert.equal(a.D.getElementById('chat-ta').value, 'hi @Cam Crew ');
  a.key('Enter', { ctrl: true }); await a.idle();
  const sent = a.S().msgs[tid].list.at(-1);
  assert.deepEqual(J(sent.mentions), ['E8']);
  // いない人
  await a.type('ask @Kai');
  const it = a.S().pop.items;
  assert.equal(it.length, 1); assert.equal(it[0].emp, 'E9'); assert.equal(it[0].member, false);
  assert.match(text(a.D.getElementById('chat-pop')), /この会話にいません/);
  a.ctx.chatPick(0);
  assert.match(text(a.D.getElementById('chat-add')), /参加者に加えて、これまでの会話を見せますか？/);
  a.ctx.chatAddMention(false); await a.idle();
  assert.equal(a.D.getElementById('chat-ta').value, 'ask @Kai Kitchen ');
  a.key('Enter', { ctrl: true }); await a.idle();
  assert.deepEqual(J(a.S().msgs[tid].list.at(-1).mentions), ['E9']);
  // E9：加わる前は見えない・@ が 1
  const k = await app(srv, 'E9');
  await start(k);
  assert.equal(k.S().mention, 1);
  k.ctx.chatOpen(tid); await k.idle();
  const seen = k.S().msgs[tid].list.map(x => x.body);
  assert.deepEqual(seen, ['ask @Kai Kitchen'], 'only from when they were added');
  assert.match(text(k.D.getElementById('chat-msgs')), /あなたが加わる前の会話は見られません/);
  assert.match(text(k.D.getElementById('chat-msgs')), /class="chat-msg at"/);
  // 自分宛ての @ の一覧
  k.ctx.chatSeg('at'); await k.idle();
  assert.match(text(k.D.getElementById('chat-list')), /Lunch team/);
});

test('edit (edited), delete (Deleted), and the GM hides / restores someone else’s message with a reason', async () => {
  const srv = await server();
  const a = await app(srv, 'E8');
  await start(a);
  a.ctx.chatNew('group'); await a.idle();
  a.ctx.chatNewMode('group'); a.ctx.chatNewTitle('Ops'); a.ctx.chatNewSel('E2', true); a.ctx.chatCreateGroup(); await a.idle();
  a.show(); await a.idle();
  const tid = a.S().open;
  await a.type('typo hre'); a.key('Enter', { ctrl: true }); await a.idle();
  await a.type('rude words'); a.key('Enter', { ctrl: true }); await a.idle();
  await a.type('to delete'); a.key('Enter', { ctrl: true }); await a.idle();
  const [m1, m2, m3] = a.S().msgs[tid].list;
  a.ctx.chatEdit(m1.id);
  a.D.getElementById('chat-edit-ta').value = 'typo here';
  a.ctx.chatEditSave(); await a.idle();
  assert.match(text(a.D.getElementById('chat-msgs')), /typo here/);
  assert.match(text(a.D.getElementById('chat-msgs')), /編集済み/);
  a.ctx.chatDelete(m3.id); await a.idle();
  assert.match(text(a.D.getElementById('chat-msgs')), /削除されました/);
  assert.doesNotMatch(text(a.D.getElementById('chat-msgs')), /to delete/);
  // GM
  const g = await app(srv, 'E2', { role: 'gm' });
  await start(g);
  g.ctx.chatOpen(tid); await g.idle();
  assert.match(text(g.D.getElementById('chat-msgs')), /chatHide\(/);
  g.ctx.chatHide(m2.id);
  g.ctx.chatHideSave();
  assert.match(text(g.D.getElementById('chat-dlg-err')), /理由を書いてください/);
  g.D.getElementById('chat-hide-reason').value = 'not appropriate';
  g.ctx.chatHideSave(); await g.idle();
  assert.match(text(g.D.getElementById('chat-msgs')), /見えなくなりました（Gabe GM）/);
  assert.doesNotMatch(text(g.D.getElementById('chat-msgs')), /rude words/);
  g.ctx.chatUnhide(m2.id); await g.idle();
  assert.match(text(g.D.getElementById('chat-msgs')), /rude words/);
});

// Codex #150（issuecomment 6870029872）P2-2：最新の 100 件だけ取り直して足していたので、それより前のページで見えなくした・直した・消したことが、
// もう開いている端末に届かなかった。開いている会話は前に読んだページも取り直す（4 ページまで・それより前は捨てて「さらに読む」で取り直す）。
// 閉じていたあいだに変わった会話は、開くときに前の写しを出さない
async function bulk(srv, tid, from, to, who = 'E2') {
  await srv.pg.exec('reset role');
  await srv.pg.query(`insert into public.chat_messages(thread_id, seq, author_emp, author_name, body, client_key)
    select $1::uuid, g, $4, $5, 'm' || g, 'bulk-' || $1 || '-' || g from generate_series($2::int, $3::int) g`, [tid, from, to, who, NAME[who]]);
  await srv.pg.query(`update public.chat_threads set last_seq = $2, last_at = now(), chg = nextval('public.chat_chg_seq') where id = $1::uuid`, [tid, to]);
  await srv.pg.exec('set role service_role');
}
async function srvCall(srv, who, body) {
  const r = await srv.handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin_session: 'pin-' + who, ...body }) }));
  const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); return j;
}
const msgOf = (a, tid, seq) => a.S().msgs[tid].list.find(x => x.seq === seq);

test('an open chat re-reads the older pages it shows: a message hidden, edited or deleted further back reaches a device that already has it (Codex #150 P2-2)', async () => {
  const srv = await server();
  const a = await app(srv, 'E8');
  await start(a);
  a.ctx.chatNew('group'); await a.idle();
  a.ctx.chatNewMode('group'); a.ctx.chatNewTitle('Long'); a.ctx.chatNewSel('E2', true); a.ctx.chatCreateGroup(); await a.idle();
  a.show(); await a.idle();
  const tid = a.S().open;
  await a.type('mine 1'); a.key('Enter', { ctrl: true }); await a.idle();
  await bulk(srv, tid, 2, 102);
  a.ctx.chatRetrySync(); await a.idle();
  assert.equal(a.S().msgs[tid].list.length, 102, 'the newest page (3–102) and the page under it (1–2) that the device already showed');
  assert.equal(msgOf(a, tid, 1).body, 'mine 1', 'E8 still shows seq 1');
  // Codex の順番：もう 1 件 → GM が seq 1 を見えなくする → E8 が読み直す
  const m1 = msgOf(a, tid, 1);
  await bulk(srv, tid, 103, 103);
  await srvCall(srv, 'E2', { action: 'chat_hide', id: m1.id, hide: true, reason: 'not appropriate' });
  a.ctx.chatRetrySync(); await a.idle();
  assert.equal(msgOf(a, tid, 1).hidden, true, 'seq 1 is hidden on the device that already had it');
  assert.doesNotMatch(text(a.D.getElementById('chat-msgs')), /mine 1/);
  // 前のページで本人が直した・消したものも届く
  await srv.pg.exec(`reset role; update public.chat_messages set body = 'm2 fixed', edited_at = now() where thread_id = '${tid}' and seq = 2;
    update public.chat_messages set deleted_at = now() where thread_id = '${tid}' and seq = 3;
    update public.chat_threads set chg = nextval('public.chat_chg_seq') where id = '${tid}'; set role service_role`);
  a.ctx.chatRetrySync(); await a.idle();
  assert.equal(msgOf(a, tid, 2).body, 'm2 fixed');
  assert.equal(msgOf(a, tid, 3).deleted, true);
  assert.equal(a.S().msgs[tid].older, false, 'nothing older on the server');
});

test('more pages than it re-reads: the oldest are dropped and loaded again from the server; a failed re-read drops them too', async () => {
  const srv = await server();
  let failBefore = false;
  const a = await app(srv, 'E8', { fail: { before: b => failBefore && b.action === 'chat_messages' && b.before != null } });
  await start(a);
  a.ctx.chatNew('group'); await a.idle();
  a.ctx.chatNewMode('group'); a.ctx.chatNewTitle('Very long'); a.ctx.chatNewSel('E2', true); a.ctx.chatCreateGroup(); await a.idle();
  a.show(); await a.idle();
  const tid = a.S().open;
  await bulk(srv, tid, 1, 650, 'E8');
  a.ctx.chatRetrySync(); await a.idle();
  for (let i = 0; i < 6; i++) { a.ctx.chatOlder(); await a.idle(); }
  assert.equal(a.S().msgs[tid].list[0].seq, 1, 'all 650 are shown');
  const m10 = msgOf(a, tid, 10);
  await srvCall(srv, 'E2', { action: 'chat_hide', id: m10.id, hide: true, reason: 'x' });
  a.ctx.chatRetrySync(); await a.idle();
  const L = a.S().msgs[tid];
  assert.equal(L.list[0].seq, 151, 'the newest page and 4 more (500) are re-read; older copies are dropped');
  assert.equal(L.list.length, 500);
  assert.equal(L.older, true, '"load older" fetches them again');
  assert.equal(msgOf(a, tid, 10), undefined, 'the hidden one is not kept from before');
  a.ctx.chatOlder(); await a.idle(); a.ctx.chatOlder(); await a.idle();
  assert.equal(msgOf(a, tid, 10).hidden, true, 'loaded again from the server: hidden');
  // 前のページを取り直せない（通信）：取れなかったところより前は捨てる
  failBefore = true;
  await bulk(srv, tid, 651, 651, 'E8');
  a.ctx.chatRetrySync(); await a.idle();
  assert.equal(a.S().msgs[tid].list[0].seq, 552, 'only the newest page (552–651) is kept');
  assert.equal(a.S().msgs[tid].older, true);
});

test('a chat that changed while closed does not show its old copy when opened again (no flash of a hidden message)', async () => {
  const srv = await server();
  let hold = null;
  const a = await app(srv, 'E8', { gate: b => (b.action === 'chat_messages' && hold) ? hold.p : null });
  await start(a);
  a.ctx.chatNew('group'); await a.idle();
  a.ctx.chatNewMode('group'); a.ctx.chatNewTitle('Reopen'); a.ctx.chatNewSel('E2', true); a.ctx.chatCreateGroup(); await a.idle();
  a.show(); await a.idle();
  const tid = a.S().open;
  await a.type('secret words'); a.key('Enter', { ctrl: true }); await a.idle();
  const m = a.S().msgs[tid].list[0];
  a.ctx.chatBack(); a.show(); await a.idle();
  await srvCall(srv, 'E2', { action: 'chat_hide', id: m.id, hide: true, reason: 'x' });
  a.ctx.chatRetrySync(); await a.idle();
  let release; hold = { p: new Promise(r => { release = r; }) };
  a.ctx.chatOpen(tid); a.show();
  await sleep(20);
  assert.doesNotMatch(text(a.D.getElementById('chat-msgs')), /secret words/, 'while the answer is on its way, the old copy is not shown');
  hold = null; release(); await a.idle(); a.show(); await a.idle();
  assert.equal(a.S().msgs[tid].list[0].hidden, true);
  assert.doesNotMatch(text(a.D.getElementById('chat-msgs')), /secret words/);
  // 変わっていなければ前の写しをすぐ出す（読み直しは裏で）
  a.ctx.chatBack(); a.show(); await a.idle();
  hold = { p: new Promise(r => { release = r; }) };
  a.ctx.chatOpen(tid); a.show();
  await sleep(20);
  assert.match(text(a.D.getElementById('chat-msgs')), /見えなくなりました/, 'unchanged: the copy is shown at once');
  hold = null; release(); await a.idle();
});

test('request chat: the button in the request detail opens it for a decider; others are told; the chat links back to the request', async () => {
  const srv = await server();
  const r7 = await app(srv, 'E7', { role: 'sl' });
  await start(r7);
  const sub = await r7.ctx.chatAPI({ action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: 'wr-test-000001-chatapp',
    payload: { date: '2026-11-01', payer: NAME.E7, payer_is_employee: true, vendor: 'Costco', purpose: '仕入れ', amount_cents: 8640 } });
  assert.match(r7.ctx.chatCaseButton(sub), /この申請のチャット/);
  r7.ctx.curPage = 'tasks';
  r7.ctx.chatOpenCase(sub.id); await r7.idle();
  assert.equal(r7.ctx.workTab, 'chat', 'opens inside the Work Center when you are there');
  r7.show(); await r7.idle();
  const tid = r7.S().open, row = r7.S().threads[tid];
  assert.equal(row.kind, 'case'); assert.equal(row.ref.id, sub.id);
  assert.match(text(r7.D.getElementById('chat-head')), /建て替え経費/);
  assert.match(text(r7.D.getElementById('chat-head')), new RegExp("chatOpenRequest\\('" + sub.id + "'\\)"));
  // 同じ店のほかの crew は見られない
  const c8 = await app(srv, 'E8');
  await start(c8);
  c8.ctx.chatOpenCase(sub.id); await c8.idle();
  assert.match(c8.toasts.map(x => x[1]).join('\n'), /この申請は見られません|見られません/);
  assert.equal(c8.S().open, '');
});

test('logout clears everything and a late answer for the previous person is dropped', async () => {
  const srv = await server();
  const a = await app(srv, 'E8');
  await start(a);
  const tid = await openDm(a, 'E9');
  await a.type('secret'); a.key('Enter', { ctrl: true });
  a.ctx.chatReset(); a.ctx._hwSession = 'pin-E9';
  await a.idle();
  const s = a.S();
  assert.deepEqual([s.open, Object.keys(s.threads).length, Object.keys(s.msgs).length, Object.keys(s.out).length, Object.keys(s.drafts).length], ['', 0, 0, 0, 0]);
  a.ctx.chatStart(); await a.idle();
  assert.equal(a.S().me, 'E9');
  assert.equal(a.S().threads[tid].title, 'Cam Crew', 'the next person sees their own view');
  assert.equal(a.S().msgs[tid], undefined, 'not the previous person’s copy');
});

test('a list answer that arrives after logout is dropped (the next person starts empty)', async () => {
  const srv = await server();
  const a0 = await app(srv, 'E8');
  await start(a0); await openDm(a0, 'E9');
  let release; const hold = new Promise(r => { release = r; });
  const a = await app(srv, 'E8', { gate: b => (b.action === 'chat_sync' ? hold : null) });
  a.ctx.chatStart(); await sleep(30);
  a.ctx.chatReset();
  release(); await a.idle();
  const s = a.S();
  assert.deepEqual([Object.keys(s.threads).length, s.me, s.unread], [0, '', 0], 'nothing from the previous person');
});

test('message text is shown as text: no HTML, only http(s) links, mention names highlighted', async () => {
  const srv = await server();
  const a = await app(srv, 'E8');
  await start(a);
  const tid = await openDm(a, 'E9');
  await a.type('<img src=x onerror=alert(1)> javascript:alert(1) https://example.com/a?b=1&c=2'); a.key('Enter', { ctrl: true }); await a.idle();
  const h = text(a.D.getElementById('chat-msgs'));
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(h, /href="javascript/);
  assert.match(h, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">/);
});

test('the app keeps chat off the device and is wired into the navigation, logout, login and the request detail', () => {
  assert.doesNotMatch(MOD.replace(/\/\*[\s\S]*?\*\//g, ''), /localStorage|indexedDB|lsSet\(|sessionStorage/, 'no copies on the device');
  assert.match(html, /\{id:'chat',\s+label:'DM・チャット', icon:'ti-messages',\s+roles:\['ceo','gm','office','am','sl','crew','office_crew','chef'\]\}/);
  assert.match(html, /\{id:'g_chat', label:'チャット', icon:'ti-messages', children:\['chat'\]\}/, 'G1 (crew) menu');
  assert.match(html, /children:\['tasks','chat','lala'\]\},   \/\* v1156 \*\//);
  assert.equal(html.split("case 'chat':         el.innerHTML = (typeof renderChatPage==='function') ? renderChatPage() : ''; break;").length - 1, 2, 'both renderPage copies');
  assert.equal(html.split("if(typeof chatReset==='function') chatReset();").length - 1, 2, 'both logout copies');
  assert.match(html, /if\(typeof chatStart==='function'\) chatStart\(\); \}, 3000\)/);
  assert.match(html, /'acct_center','lost_receipt','expense','diag_center','chat'\]/);
  assert.match(html, /if \(workTab==='chat'\) return bar \+ \(\(typeof chatWorkTab==='function'\) \? chatWorkTab\(\) : ''\);/);
  assert.match(html, /if \(typeof W\.chatCaseButton === 'function'\) h \+= W\.chatCaseButton\(r\);/);
  assert.match(html, /if \(pid==='chat'\) return \(typeof chatUnread==='function'\) \? chatUnread\(\) : 0;/);
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const v = /const APP_VERSION = '(\d+)'/.exec(html)[1];
  assert.ok(Number(v) >= 1156); assert.match(sw, new RegExp("const SW_BUILD = '" + v + "'"));
});
