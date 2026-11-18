// v1190（UI案93）：承認・閲覧設定の画面（FUNERGY_AR）・申請の画面のルートと例外・共通ルールのまとめて承認（FUNERGY_WR の bulk_approve）。
// 本物の画面のモジュール（index.html）を VM で動かし、本物の handler と本物の SQL（PGlite・approval-rules-world）につなぐ。合成データだけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { setup, NAME, KINDS16, G, C, AMm, STAGE, ALLS } from './approval-rules-world.mjs';

const html = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cut = (b, e) => { const i = html.indexOf(b), j = html.indexOf(e); assert.ok(i > 0 && j > i, 'module markers ' + b); return html.slice(i, j); };
const WR = cut('/* ==== FUNERGY_WR（v1131', '/* ==== FUNERGY_WR end ==== */');
const AR = cut('/* ==== FUNERGY_AR（v1190', '/* ==== FUNERGY_AR end ==== */');

function fakeDom() {
  const els = {};
  const parse = h => {
    const re = /<(input|select|textarea|div)\b([^>]*)\bid="([^"]+)"([^>]*)>/g; let m;
    while ((m = re.exec(h))) { const id = m[3]; if (!els[id]) els[id] = mkEl(id); }
  };
  function mkEl(id) { let ih = ''; return { id, value: '', checked: false, get innerHTML() { return ih; }, set innerHTML(v) { ih = v; parse(v); } }; }
  return { els, parse };
}

async function app(W, emp, { page = 'ar_settings', fail = null } = {}) {
  const dom = fakeDom(), toasts = [], notifs = [];
  let modal = '';
  const today = W.today;
  const ctx = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number, Uint8Array, setTimeout: f => { f(); return 0; }, encodeURI,
    crypto: webcrypto, SUPABASE_URL: 'https://db.test', SUPABASE_ANON: 'anon-key', _hwSession: 'pin-' + emp,
    curPage: page, workTab: 'wr', curRole: emp === 'E1' ? 'ceo' : emp === 'E2' ? 'gm' : 'sl', curRealRole: '',
    STORES: [{ id: 'S1', name: 'Store One' }, { id: 'S2', name: 'Store Two' }, { id: 'S3', name: 'Store Three' }],
    t: ja => ja, bizNow: () => new Date(today + 'T10:00:00'), kpi: (l, v) => `[${l}:${v}]`, mrAuthKey: () => 'p|' + emp,
    renderPage: () => {}, go: () => {}, showToast: (m, k) => toasts.push([k, m]), addNotif: n => notifs.push(JSON.parse(JSON.stringify(n))), getNotifs: () => notifs,
    openModal: h => { modal = h; dom.parse(h); }, closeModalDirect: () => { modal = ''; }, closeModal: () => { modal = ''; },
    confirm: () => true, prompt: (_m, d) => d, groupsForRole: () => [{ children: ['dashboard', 'tasks'] }], getEmployees: () => [], empBlocked: () => false,
    ls: (k, d) => d, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: async (url, init) => {
      const b = JSON.parse(init.body); const who = String(b.pin_session).replace(/^pin-/, ''); delete b.pin_session;
      const r = await W.call(who, b);
      if (fail && fail.next && b.action === fail.action) { fail.next = false; throw new TypeError('network lost after the server saved'); }
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
    },
    document: { getElementById: id => dom.els[id] || null },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(WR, ctx);
  vm.runInContext(AR, ctx);
  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
  const page0 = async () => { ctx.curPage = 'ar_settings'; dom.els['ar-root'] = null; const h = ctx.FUNERGY_AR.render(); dom.parse(h); dom.els['ar-root'].innerHTML = h.slice(h.indexOf('<div id="ar-root">') + 18); await settle(); return root(); };
  const root = () => dom.els['ar-root'] ? dom.els['ar-root'].innerHTML : '';
  return { ctx, dom, toasts, notifs, settle, page0, root, h: ctx.FUNERGY_AR.h, A: () => ctx.FUNERGY_AR._A(), modal: () => modal, S: () => ctx._wrState() };
}

test('settings page: CEO/GM see the 16 kinds; edit a draft, save, activate; others are refused', async () => {
  const W = await setup();
  const gm = await app(W, 'E2');
  let h = await gm.page0();
  assert.match(h, /まだ使っていません/);
  assert.match(h, /有効 <\/span>?0 \/ 16|有効 0 \/ 16|今：有効 0 \/ 16/);
  for (const k of KINDS16) assert.match(h, new RegExp(`FUNERGY_AR\\.h\\.kind\\('${k}'\\)`), 'a row for ' + k);
  assert.match(h, /下書きを直しています/, 'the first kind opens its draft');
  assert.match(h, /確かめ：問題なし|class="ar-warn"/, 'the saved draft shows its check');
  // add a condition ($500 and over → GM then CEO), save, activate
  gm.h.addBranch(); gm.h.bAmt(0, 'min', '500'); gm.h.bLabel(0, '$500 以上');
  gm.h.sAdd('b0'); gm.h.pk('role', 'ceo'); gm.h.pkOk();
  h = gm.root();
  assert.match(h, /保存していない変更があります/);
  assert.match(h, /段 2/);
  const before = (await W.state()).kinds.find(k => k.kind === 'mileage').draft.ver;
  gm.h.save(); await gm.settle();
  let st = await W.state(), k = st.kinds.find(x => x.kind === 'mileage');
  assert.equal(k.draft.ver, before, 'the same draft version is saved again');
  assert.deepEqual(k.draft.def.branches[0].when, { min_cents: 50000 });
  assert.equal(k.draft.def.branches[0].label, '$500 以上');
  assert.deepEqual(k.draft.def.branches[0].stages, [STAGE(G), STAGE(C)]);
  assert.match(gm.root(), /下書きを直しています/);
  assert.doesNotMatch(gm.root(), /保存していない変更があります/);
  gm.h.activate(); await gm.settle();                              // no note: refused on screen
  assert.ok(gm.toasts.some(t => /メモ/.test(t[1])));
  gm.h.note('確かめた'); gm.h.activate(); await gm.settle();
  k = (await W.state()).kinds.find(x => x.kind === 'mileage');
  assert.ok(k.active && !k.draft, 'activated');
  assert.match(gm.root(), /有効にしました|有効 v/);
  // a store manager cannot open it (the server says forbidden)
  const sl = await app(W, 'E6');
  h = await sl.page0();
  assert.match(h, /CEO・GM だけ/);
});

test('the screen checks the shape the server checks (rule_invalid has no details)', async () => {
  const W = await setup();
  const gm = await app(W, 'E2'); await gm.page0();
  const defErr = gm.ctx.FUNERGY_AR._defErrors, clean = gm.ctx.FUNERGY_AR._cleanDef;
  const ok = { default: { stages: [STAGE(G)] } };
  const bad = [
    { branches: [{ when: {}, stages: [STAGE(G)] }], default: { stages: [STAGE(G)] } },                                   // no condition
    { branches: [{ when: { min_cents: 900, max_cents: 100 }, stages: [STAGE(G)] }], default: { stages: [STAGE(G)] } },     // min ≥ max
    { default: { stages: [] } },                                                                                          // no step
    { default: { stages: [STAGE(G), STAGE(G), STAGE(G), STAGE(G), STAGE(G), STAGE(G)] } },                                 // 6 steps
    { default: { stages: [{ mode: 'any', slots: [] }] } },                                                                // no slot
    { default: { stages: [STAGE({ t: 'role', role: 'gm', scope: 'stores', stores: [] })] } },                              // stores empty
    { default: { stages: [STAGE(G)] }, viewers: [{ who: { t: 'role', role: 'am', scope: 'all', each: true }, from: 'submit' }] }, // each on a viewer
    { default: { stages: [STAGE({ t: 'emp', emp: 'bad id!' })] } },                                                       // emp shape
  ];
  for (const d of bad) {
    assert.ok(defErr(d).length > 0, 'screen catches ' + JSON.stringify(d));
    const r = await W.saveRule('leave', d);
    assert.equal(r.status, 400, 'server refuses ' + JSON.stringify(d));
  }
  for (const d of [ok, { branches: [{ label: 'x', when: { hq: true }, stages: [STAGE(C)] }], default: { block: true }, viewers: [{ who: AMm, from: 'final' }], self: 'block' }]) {
    assert.equal(defErr(d).length, 0, JSON.stringify(d) + ' ' + defErr(d).join(' / '));   // VM の配列は別の realm（deepEqual しない）
    const r = await W.saveRule('leave', JSON.parse(JSON.stringify(clean(d))));
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
});

test('preview shows who it goes to with the rule on screen (nothing is saved)', async () => {
  const W = await setup();
  const gm = await app(W, 'E2'); await gm.page0();
  gm.h.kind('reimburse'); await gm.settle();
  const A = gm.A(); A.ed.def = { default: { stages: [STAGE(AMm), STAGE(G)] }, viewers: [{ who: { t: 'role', role: 'acct_mgr', scope: 'all' }, from: 'final' }] }; A.ed.dirty = true;
  const v0 = (await W.state()).kinds.find(k => k.kind === 'reimburse').draft;
  gm.h.pv('store', 'S1'); gm.h.pv('emp', 'E7'); gm.h.pv('amt', '80'); gm.h.preview(); await gm.settle();
  const h = gm.root();
  assert.match(h, /段 1（だれか 1 人）/);
  assert.match(h, /Ami Area/, 'the AM of the store');
  assert.match(h, /Gabe GM/);
  assert.match(h, /Ann Acct/, 'the viewer by name');
  assert.match(h, /最終承認から/);
  const v1 = (await W.state()).kinds.find(k => k.kind === 'reimburse').draft;
  assert.deepEqual(v1, v0, 'preview does not save');
});

test('someone saved first: conflict, the edit stays on screen; delegates; go live and stop', async () => {
  const W = await setup();
  const gm = await app(W, 'E2'); await gm.page0();
  gm.h.kind('leave'); await gm.settle();
  gm.h.self('block');
  await W.saveRule('leave', { default: { stages: [STAGE(C)] } }, 'E1');          // the CEO saves first
  gm.h.save(); await gm.settle();
  assert.ok(gm.toasts.some(t => /先に変えました/.test(t[1])));
  assert.equal(gm.A().ed.def.self, 'block', 'my edit is kept');
  assert.ok(gm.A().ed.dirty);
  gm.h.save(); await gm.settle();
  assert.equal((await W.state()).kinds.find(k => k.kind === 'leave').draft.def.self, 'block');
  // delegates
  gm.h.tab('dels'); await gm.settle();
  assert.match(gm.root(), /ありません/);
  gm.h.dNew(); await gm.settle();
  gm.h.df('from', 'E5'); gm.h.df('to', 'E10'); gm.h.df('note', '休暇のあいだ', 1);
  gm.h.dSave(); await gm.settle();
  const ds = (await W.ok('E2', { action: 'ar_delegate_list' })).delegates;
  assert.equal(ds.length, 1); assert.equal(ds[0].from_name, 'Ami Area'); assert.equal(ds[0].to_name, 'Bea Area');
  assert.match(gm.root(), /Ami Area<\/b> → <b>Bea Area/);
  gm.h.dNew(); gm.h.df('from', 'E10'); gm.h.df('to', 'E5'); gm.h.df('note', 'x', 1); gm.h.dSave(); await gm.settle();
  assert.match(gm.root(), /ぐるっと回って/);
  gm.h.dCancel(); gm.h.dEnd(ds[0].id); gm.h.dEndNote('戻った'); gm.h.dEndGo(); await gm.settle();
  assert.equal((await W.ok('E2', { action: 'ar_delegate_list' })).delegates[0].active, false);
  // go live needs all 16 active
  gm.h.tab('live'); await gm.settle();
  assert.match(gm.root(), /有効な版がない種類/);
  await W.activate();
  gm.h.reload(); await gm.settle(); gm.h.tab('live'); await gm.settle();
  assert.match(gm.root(), /16 種類すべて有効です/);
  gm.h.goLive(); await gm.settle();
  assert.equal((await W.state()).live, true);
  assert.match(gm.root(), /共通ルールで動いています/);
  gm.h.goOff(); await gm.settle();                                    // no reason: refused on screen
  assert.equal((await W.state()).live, true);
  gm.h.liveNote('戻す'); gm.h.goOff(); await gm.settle();
  assert.equal((await W.state()).live, false);
});

test('route card on a request; an exception for this request only; not on your own request', async () => {
  const W = await setup();
  await W.activate();
  await W.setRule('reimburse', { branches: [{ label: 'AM のいる店', when: { has_am: true }, stages: [STAGE(AMm), STAGE(G)] }], default: { stages: [STAGE(G)] } });
  await W.live();
  const r = await W.subOk('E7', 'reimburse', 'S1');
  const gm = await app(W, 'E2', { page: 'tasks' });
  gm.ctx.renderWrTab(); await gm.settle();                            // the list reads whoami (ar.admin)
  gm.ctx.wrOpen(r.id); await gm.settle();
  let d = gm.dom.els['wr-detail'].innerHTML;
  assert.match(d, /承認のルート/);
  assert.match(d, /段 1/); assert.match(d, /段 2/);
  assert.match(d, /Ami Area/, 'who can approve the current step');
  assert.match(d, /例外（この申請だけ・CEO・GM）/);
  // change step 1 to the CEO for this request
  gm.h.exToggle(r.id, true);
  gm.h.ex('op', 'set_stage'); gm.h.pick('x' + r.id); gm.h.pk('role', 'ceo'); gm.h.pkOk();
  gm.h.exGo(); await gm.settle();
  assert.match(gm.dom.els['ar-ex'].innerHTML, /理由を入れてください/);
  gm.h.ex('note', '店長が休み', 1); gm.h.exGo(); await gm.settle();
  const f = await W.fresh(r);
  assert.deepEqual(f.route.stages[0].slots.map(s => s.role), ['ceo']);
  assert.equal(f.route.ex.length, 1);
  d = gm.dom.els['wr-detail'].innerHTML;
  assert.match(d, /段を変えた 段 1/, 'the record is shown');
  assert.doesNotMatch(d, /"emp"|E2\b/, 'no employee ID on screen');
  // the GM's own request: no exception form
  const own = await W.subOk('E2', 'reimburse', 'S1');
  gm.ctx.wrOpen(own.id); await gm.settle();
  assert.doesNotMatch(gm.dom.els['wr-detail'].innerHTML, /例外（この申請だけ/);
  // a store manager sees the route but no exception form
  const sl = await app(W, 'E6', { page: 'tasks' });
  sl.ctx.renderWrTab(); await sl.settle();
  sl.ctx.wrOpen(r.id); await sl.settle();
  const s = sl.dom.els['wr-detail'] ? sl.dom.els['wr-detail'].innerHTML : '';
  if (s) assert.doesNotMatch(s, /例外（この申請だけ/);
});

test('bulk approval on the common rules: one call, final and next step, a changed one skipped, notifications', async () => {
  const W = await setup();
  await W.activate();
  await W.setRule('mileage', { default: { stages: [STAGE(G)] } });
  await W.setRule('reimburse', { default: { stages: [STAGE(G), STAGE(C)] } });
  await W.live();
  const a = await W.subOk('E7', 'mileage', 'S1');
  const b = await W.subOk('E7', 'reimburse', 'S1');
  const c = await W.subOk('E7', 'mileage', 'S1');
  const gm = await app(W, 'E2', { page: 'tasks' });
  gm.ctx.renderWrTab(); await gm.settle(); gm.ctx.renderWrTab(); await gm.settle();
  assert.ok(gm.S().ar && gm.S().ar.live && gm.S().ar.admin);
  gm.ctx.wrSelAll(true); gm.ctx.renderWrTab(); await gm.settle();
  gm.ctx.wrBulkAsk();
  let m = gm.dom.els['wr-bulk'].innerHTML;
  assert.match(m, /最終承認/); assert.match(m, /次の段へ/);
  assert.match(m, /段 2 へ/);
  // the requester edits c after the GM looked
  const fc = await W.fresh(c);
  const ed = await W.act('E7', fc, 'edit', { kind: 'mileage', payload: { date: W.today, purpose: '買い出し', origin: 'A', destination: 'B', one_way_miles: 33, round_trip: false } });
  assert.equal(ed.status, 200, JSON.stringify(ed.body));
  gm.ctx.wrBulkGo(); gm.ctx.wrBulkGo(); await gm.settle();
  const bl = gm.S().bulk;
  const by = Object.fromEntries(bl.arRes.map(x => [x.id, x.outcome]));
  assert.equal(by[a.id], 'final'); assert.equal(by[b.id], 'next'); assert.notEqual(by[c.id], 'final');
  m = gm.dom.els['wr-bulk'].innerHTML;
  assert.match(m, /最終承認/); assert.match(m, /次の段へ/);
  assert.equal((await W.q(`select count(*)::int n from public.ar_bulk`))[0].n, 1, 'one bulk call even when pressed twice');
  assert.equal((await W.fresh(a)).status, 'approved');
  assert.equal((await W.fresh(b)).status, 'pending');
  assert.equal((await W.fresh(b)).route.cur, 2);
  assert.ok(gm.notifs.some(n => n.toUser === 'Lee Leader' && /承認されました/.test(n.title)), 'the requester hears the final approval');
  assert.ok(gm.notifs.length >= 2, 'the next step hears too');
});

test('bulk approval: the answer did not arrive → send again with the same number (no double approval)', async () => {
  const W = await setup();
  await W.activate();
  await W.setRule('mileage', { default: { stages: [STAGE(G)] } });
  await W.live();
  const a = await W.subOk('E7', 'mileage', 'S1');
  const fail = { next: true, action: 'bulk_approve' };
  const gm = await app(W, 'E2', { page: 'tasks', fail });
  gm.ctx.renderWrTab(); await gm.settle(); gm.ctx.renderWrTab(); await gm.settle();
  gm.ctx.wrSelAll(true); gm.ctx.renderWrTab(); await gm.settle();
  gm.ctx.wrBulkAsk(); const key = gm.S().bulk.key;
  gm.ctx.wrBulkGo(); await gm.settle();
  assert.equal(gm.S().bulk.phase, 'retry');
  assert.match(gm.dom.els['wr-bulk'].innerHTML, /同じ番号でもう一度送る/);
  assert.equal((await W.fresh(a)).status, 'approved', 'the server did approve');
  gm.ctx.wrBulkGo(); await gm.settle();
  const bl = gm.S().bulk;
  assert.equal(bl.key, key); assert.equal(bl.replay, true);
  assert.equal(bl.arRes[0].outcome, 'final');
  assert.equal((await W.q(`select count(*)::int n from public.wr_events where action = 'approve' and request_id = $1`, [a.id]))[0].n, 1, 'approved once');
});

// PR #192 のレビュー（Codex 66608b3）：「全員」の段でほかの枠が残るときは「段 N へ」ではなく「この段のほかの承認を待つ」
test('PR #192: an "all" step says it waits for the others — on the route card, the bulk check and the bulk result', async () => {
  const W = await setup();
  await W.activate();
  await W.setRule('shift', { default: { stages: [ALLS(G, C), STAGE(G)] } });
  await W.setRule('hire', { default: { stages: [STAGE(G), STAGE(C)] } });
  await W.setRule('plan', { default: { stages: [ALLS(G, C)] } });
  await W.live();
  const sh = await W.subOk('E8', 'shift', 'S1');
  const hi = await W.subOk('E8', 'hire', 'S1');
  const pl = await W.subOk('E8', 'plan', 'S1');
  const gm = await app(W, 'E2', { page: 'tasks' });
  gm.ctx.renderWrTab(); await gm.settle(); gm.ctx.renderWrTab(); await gm.settle();
  gm.ctx.wrOpen(pl.id); await gm.settle();
  let d = gm.dom.els['wr-detail'].innerHTML;
  assert.match(d, /あなたが承認すると：<b>この段のほかの承認を待ちます<\/b>/, 'plan: one step, CEO still to sign');
  assert.match(d, /あと 1 人/);
  assert.doesNotMatch(d, /あなたが承認すると：<b>段 2 へ/, 'before: it said "to step 2" for a one-step route');
  gm.ctx.wrOpen(hi.id); await gm.settle();
  assert.match(gm.dom.els['wr-detail'].innerHTML, /あなたが承認すると：<b>段 2 へ/, 'an "any" step still goes to the next step');
  // bulk: the check screen and the result
  gm.ctx.renderWrTab(); await gm.settle();
  gm.ctx.wrSelAll(true); gm.ctx.renderWrTab(); await gm.settle();
  gm.ctx.wrBulkAsk();
  let m = gm.dom.els['wr-bulk'].innerHTML;
  assert.match(m, /この段のほかの承認を待つ/); assert.match(m, /この段のほかを待つ/);
  gm.ctx.wrBulkGo(); await gm.settle();
  const by = Object.fromEntries(gm.S().bulk.arRes.map(x => [x.id, x.outcome]));
  assert.equal(by[sh.id], 'stage'); assert.equal(by[pl.id], 'stage'); assert.equal(by[hi.id], 'next');
  m = gm.dom.els['wr-bulk'].innerHTML;
  assert.equal((m.match(/>ほかを待つ</g) || []).length, 2, 'two rows marked “waiting” (not failed)');
  assert.match(m, /はほかの承認を待っています（Cora CEO）/);
  assert.equal((await W.fresh(pl)).status, 'pending'); assert.equal((await W.fresh(sh)).route.cur, 1, 'the step did not move');
  // an older server (no my.after): the screen works it out from the open slots
  const aft = gm.ctx.arAfter;
  assert.deepEqual(JSON.parse(JSON.stringify(aft({ cur: 1, my: { final: false }, stages: [{ mode: 'all', slots: [{ filled: false }, { filled: false }] }] }))), { after: 'same', left: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(aft({ cur: 1, my: { final: false }, stages: [{ mode: 'any', slots: [{ filled: false }, { filled: false }] }] }))), { after: 'next', left: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(aft({ cur: 1, my: { final: false, after: 'next', left: 0 }, stages: [{ mode: 'all', slots: [{ filled: false }, { filled: false }] }] }))), { after: 'next', left: 0 }, 'the server’s answer wins');
  assert.deepEqual(JSON.parse(JSON.stringify(aft({ cur: 1, my: { final: true }, stages: [{ mode: 'all', slots: [{ filled: false }, { filled: false }] }] }))), { after: 'final', left: 0 });
});

test('PR #192: a discarded draft stays in the history; activate refused → the screen reloads and keeps the note; limits checked on screen', async () => {
  const W = await setup();
  const gm = await app(W, 'E2'); await gm.page0();
  gm.h.kind('plan'); await gm.settle();
  const seen = gm.A().ed; assert.equal(seen.from, 'draft');
  // someone else discards and makes a new draft
  await W.ok('E1', { action: 'ar_rule_discard', kind: 'plan', expect_ver: seen.ver, expect_rev: seen.rev });
  const re = await W.ok('E1', { action: 'ar_rule_save', kind: 'plan', def: { default: { stages: [STAGE(C)] } }, expect_ver: 0, expect_rev: 0, base_ver: 0, note: '作り直し' });
  gm.h.note('GM のメモ');
  gm.h.activate(); await gm.settle();
  assert.ok(gm.toasts.some(t => /先に変えました/.test(t[1])));
  const st = await W.state(); const k = st.kinds.find(x => x.kind === 'plan');
  assert.equal(k.active, undefined, 'nothing activated from the old screen');
  assert.ok(gm.A().ed, 'the editor stays open');
  assert.equal(gm.A().ed.note, 'GM のメモ', 'the note is kept');
  assert.equal(gm.A().ed.ver, re.draft.ver, 'the editor now shows the new draft');
  assert.match(gm.root(), /捨てた下書き/, 'the discarded draft is in the history');
  // the amount limit is the server's (12 digits of cents)
  gm.h.addBranch();
  gm.h.bAmt(0, 'min', '9999999999.99');
  assert.equal(gm.A().ed.def.branches[0].when.min_cents, 999999999999);
  gm.h.bAmt(0, 'min', '10000000000');
  assert.equal(gm.A().ed.def.branches[0].when.min_cents, 999999999999, 'over the limit: not taken');
  assert.ok(gm.toasts.some(t => /9,999,999,999\.99/.test(t[1])));
});

test('PR #192: "remove a step" stops on screen when only one unfinished step is left (nothing is sent)', async () => {
  const W = await setup();
  await W.activate();
  await W.setRule('mileage', { default: { stages: [STAGE(G)] } });
  await W.live();
  const r = await W.subOk('E7', 'mileage', 'S1');
  const gm = await app(W, 'E2', { page: 'tasks' });
  let sent = 0; const f0 = gm.ctx.fetch;
  gm.ctx.fetch = async (u, i) => { if (JSON.parse(i.body).action === 'ar_exception') sent++; return f0(u, i); };
  gm.ctx.renderWrTab(); await gm.settle();
  gm.ctx.wrOpen(r.id); await gm.settle();
  gm.h.exToggle(r.id, true);
  gm.h.ex('op', 'remove_stage'); gm.h.ex('note', '外す', 1);
  gm.h.exGo(); await gm.settle();
  assert.equal(sent, 0, 'not sent');
  assert.match(gm.dom.els['ar-ex'].innerHTML, /承認の済んでいない段を 1 つは残します/);
  assert.equal(((await W.fresh(r)).route.ex || []).length, 0);
});

