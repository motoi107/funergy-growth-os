// v1164：マイページ・レシート管理の「経費の申請」カード（FUNERGY_WR の wrMyExpCard）を VM で動かし、本物の handler と SQL（PGlite）につなぐ。
// #160 の Codex（6882878159）：P2 取得に失敗すると、描き直すたびにエラーを消してすぐ取り直していた／P3 古い答えを捨てたとき busy が戻らない。
// 合成データだけ。PIN の確かめは代わり（'pin-E8' は社員 E8）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createHandler } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MOD = html.slice(html.indexOf('/* ==== FUNERGY_WR（v1131'), html.indexOf('/* ==== FUNERGY_WR end ==== */'));
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const MIGS = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68',
  '20261113080000_wr_people_chef', '20261116080000_wr_people_g2', '20261120090000_work_requests_stage2', '20261121090000_chat', '20261123090000_work_requests_stage3',
  '20261124090000_chat_files', '20261125090000_wr_expense_g2'];
const PEOPLE = [['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E8', 'Lee Two', 'g2', 'Crew Leader', 'S1', null]];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));

async function server() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One',null,true);
    insert into public.app_state(key, value) values ('mileage_config', '{"ratePerMile":0.7}');`);
  for (const [id, name, role, title, store, ma] of PEOPLE) {
    await pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, name, role, title, store, JSON.stringify({ name })]);
    if (ma) await pg.query('insert into manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  for (const f of MIGS) await pg.exec(M(f));
  await pg.exec('update public.wr_settings set live = true; set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  return { pg, handler };
}

function app(srv, emp) {
  const els = {}, calls = [];
  const mkEl = id => { let ih = ''; return { id, style: {}, get innerHTML() { return ih; }, set innerHTML(v) { ih = v; } }; };
  const mount = h => { const m = /id="(wr-myexp)"/.exec(h); if (m) { const el = els[m[1]] || (els[m[1]] = mkEl(m[1])); el.innerHTML = h.replace(/^<div[^>]*>/, '').replace(/<\/div>$/, ''); } };
  let now = Date.parse('2026-11-14T10:00:00Z');
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
  const net = { down: false, hold: null };
  const ctx = {
    console, Promise, Date: FakeDate, Math, JSON, Object, Array, String, Number, Uint8Array, setTimeout: (f) => { f(); return 0; }, encodeURI,
    crypto: webcrypto, SUPABASE_URL: 'https://db.test', SUPABASE_ANON: 'anon-key', _hwSession: 'pin-' + emp,
    curPage: 'mypage', workTab: 'wr', curRole: 'sl', curRealRole: 'g2', curStoreLogin: false, curStore: 'S1', STORES: [{ id: 'S1', name: 'Store One' }],
    t: (ja) => ja, bizNow: () => new FakeDate(now), kpi: (l, v) => `[${l}:${v}]`, mrAuthKey: () => 'p|' + ctx._hwSession,
    renderPage: () => {}, go: () => {}, showToast: () => {}, addNotif: () => {}, getNotifs: () => [],
    openModal: () => {}, closeModalDirect: () => {}, confirm: () => true, prompt: (_m, d) => d, groupsForRole: () => [{ children: ['dashboard', 'tasks'] }],
    ls: (k, d) => d,
    localStorage: { _m: new Map([['_wr_live_v1', JSON.stringify({ live: true, at: '2026-11-14T00:00:00Z', s2: false })]]), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body.action);
      if (calls.length > 300) return new Promise(() => {});   // 読み直しが止まらないとき（直す前のコード）：答えずに止める＝試験が終わる
      if (body.action === 'list' && net.down) { await new Promise(r => setImmediate(r)); throw new TypeError('offline'); }   // 次の回に回す（直す前のコードの読み直しの輪で止まらないように）
      if (body.action === 'list' && net.hold) { const h = net.hold; net.hold = null; await h; }
      return srv.handler(new Request(url, init));
    },
    document: { getElementById: id => els[id] || null },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(MOD, ctx);
  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
  const card = async () => { mount(ctx.wrMyExpCard('mypage')); await settle(); mount(ctx.wrMyExpCard('mypage')); await settle(); return els['wr-myexp'] ? els['wr-myexp'].innerHTML : ''; };
  const lists = () => calls.filter(a => a === 'list').length;
  return { ctx, els, calls, net, card, settle, lists, tick: ms => { now += ms; } };
}

test('#160 Codex P2: when reading my requests fails, painting again does not read again at once; after 30 s or "Retry" it reads again', async () => {
  const srv = await server();
  const a = app(srv, 'E8');
  a.net.down = true;
  const h = await a.card();
  assert.match(h, /経費の申請/);
  assert.match(h, /つながりません|network|通信/, 'the error is shown: ' + h.slice(0, 400));
  assert.match(h, /wrMyExpRetry\(\)/, 'with a retry button');
  const n = a.lists();
  // 描き直しを何度しても、すぐには読み直さない（前はエラーを消して読み直し、失敗→描き直し→… を続けた）
  for (let i = 0; i < 5; i++) { await a.card(); a.ctx.wrMyExpCard('mypage'); await a.settle(); }
  assert.equal(a.lists(), n, 'no new read while the error is fresh');
  assert.match(a.els['wr-myexp'].innerHTML, /wrMyExpRetry/, 'the error stays on the card');
  // 30 秒たつと 1 回だけ読み直す（まだ失敗）
  a.tick(31000);
  await a.card();
  assert.equal(a.lists(), n + 1);
  // つながったら「もう一度」ですぐ読み直して一覧が出る
  a.net.down = false;
  a.ctx.wrMyExpRetry(); await a.settle();
  assert.equal(a.lists(), n + 2);
  assert.match(a.els['wr-myexp'].innerHTML, /まだありません/);
  assert.doesNotMatch(a.els['wr-myexp'].innerHTML, /wrMyExpRetry/);
});

test('#160 Codex P3: an answer thrown away because the generation changed does not leave the card "busy"; it reads again', async () => {
  const srv = await server();
  const a = app(srv, 'E8');
  await a.card();   // 1 回目（成功・まだありません）
  assert.ok(a.ctx._wrState().me, 'whoami done');
  // 2 回目の読み込みを途中で止め、そのあいだに同じログインのまま世代が進む（「更新」＝wrRefresh）
  let release; a.net.hold = new Promise(r => { release = r; });
  a.tick(11000);
  a.ctx.wrMyExpCard('mypage'); await a.settle();   // 読み込み開始（止まっている）
  const held = a.lists();
  a.ctx.wrRefresh(); await a.settle();             // 世代が進む（authKey は同じ）
  release(); await a.settle();
  // 前は busy のまま残り、そのあと何度描いても読み直さなかった（一覧が古いまま）
  assert.ok(a.lists() > held, 'the thrown-away answer leads to a new read');
  const before = a.lists();
  a.tick(11000);
  const h = await a.card();
  assert.ok(a.lists() > before, 'it can read again later (not stuck)');
  assert.match(h, /まだありません/);
});
