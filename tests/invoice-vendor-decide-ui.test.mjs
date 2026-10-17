// 新しい業者を決める（アプリ v1089・Moto 2026-10-16 ③・UI案52 決めてほしいこと 9〜11 はすべて A）— the app side.
// Runs the real modules from index.html (FUNERGY_VENDOR_DECIDE and the vendor merge module it records merges with) in a VM. The
// invoice intake server is a stand-in that records what it was asked. Synthetic data only. No network, no storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL(process.env.FUNERGY_INDEX || '../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b); assert.ok(i >= 0 && j > i, a); return html.slice(i, j); };
const MERGE = cut('/* FUNERGY_VENDOR_MERGE_BEGIN */', '/* FUNERGY_VENDOR_MERGE_END */');
const DEC = cut('/* FUNERGY_VENDOR_DECIDE_BEGIN */', '/* FUNERGY_VENDOR_DECIDE_END */');
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// The body of a top-level function (up to the closing brace at the start of a line), for what can only be read in the source.
const bodyOf = name => { const i = html.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name); return html.slice(i, html.indexOf('\n}', i) + 2); };

const VENDORS = () => [
  { vendor_key: 'v1', display_name: 'Sakura Produce', aliases: ['SAKURA PRODUCE INC'], food_kind: 'food', auto_post: true, updated_at: 't1' },
  { vendor_key: 'v2', display_name: 'Sakura Farms LLC', aliases: [], food_kind: 'food', auto_post: false, updated_at: 't2' },
  { vendor_key: 'v3', display_name: 'Pacific Seafood', aliases: ['PAC SEAFOOD', 'SHARED NAME'], food_kind: 'food', auto_post: false, updated_at: 't3' },
  { vendor_key: 'v4', display_name: 'Kona Paper', aliases: ['SHARED NAME'], food_kind: 'nonfood', auto_post: false, updated_at: 't4' },
  { vendor_key: 'v5', display_name: 'Old Sakura', aliases: [], food_kind: 'food', merged_into: 'v1', updated_at: 't5' },
];
const USAGE = () => ({ vendors: [{ vendor_key: 'v1', display_name: 'Sakura Produce', docs: 42 }, { vendor_key: 'v2', display_name: 'Sakura Farms LLC', docs: 7 }, { vendor_key: 'v3', docs: 3 }],
  unknown: [{ name: 'SAKURA PRODUCF', docs: 3 }, { name: 'ALOHA FISH MKT', docs: 1 }], merges: [] });
const D1 = '11111111-1111-4111-8111-111111111111', D2 = '22222222-2222-4222-8222-222222222222';
const ROWS = () => [{ id: D1, version: 3, vendor_key: null, vendor_raw: 'SAKURA PRODUCF', reasons: [{ code: 'vendor_unknown' }] },
  { id: D2, version: 1, vendor_key: null, vendor_raw: 'sakura  producf', reasons: [{ code: 'vendor_unknown' }] }];
const CARD = (id, name, o = {}) => ({ id, name, contact: '', phone: '', sms: '', email: '', line: '', method: '', cutoff: '', leadtime: 1, minOrder: 0, delivery: '', terms: '', rating: 3, webform: '', ...o });

function app({ role = 'office', cards = [CARD('v1', 'Sakura Produce', { kind: 'food' })], vendors = VENDORS(), rows = ROWS(), api = null, pull = true, merges = {} } = {}) {
  const mem = { m_vendors: cards, vendor_merges: merges, m_vendor_alias: {} };
  const dom = {};
  const c = {
    calls: [], toasts: [], modals: [], renders: 0, curLang: 'ja', curRole: role, curPage: 'acct_center', pulls: 0,
    escapeHtml: esc, t: (ja, en) => (c.curLang === 'en' ? en : ja), myName: () => 'Akane', nowJP: () => '2026/10/16 18:00',
    ls: (k, d) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : d), lsSet: (k, v) => { if (c.full) return false; mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    _lsStoreGet: k => (k in mem ? JSON.stringify(mem[k]) : null),
    getVendors: () => c.ls('m_vendors', []), getIngV2: () => [], _setIngV2: () => true,
    showToast: (m, k) => c.toasts.push([m, k]),
    openModal: h => { c.modals.push(h); if (/id="ivd-modal"/.test(h)) dom['ivd-modal'] = { innerHTML: '' }; else delete dom['ivd-modal']; },
    closeModalDirect: () => { delete dom['ivd-modal']; },
    renderPage: () => {},
    pullOpKey: async () => { c.pulls++; if (c.onPull) c.onPull(mem); return pull; },
    invInL: pair => (pair ? (c.curLang === 'en' ? pair[1] : pair[0]) : ''),
    invInCanEdit: () => ['ceo', 'gm', 'office', 'office_crew'].includes(c.curRole),
    invInSigned: () => true, invInHasEdits: () => !!c.edits, invInRerender: () => { c.renders++; },
    _invIn: { config: vendors ? { vendors } : null, review: { rows }, loaded: { review: 1, health: 1, config: 1, list: 1, doc: 1 }, doc: null, docId: null, edits: null },
    invInAPI: async body => {
      c.calls.push(JSON.parse(JSON.stringify(body)));
      const r = api ? await api(body, c) : (body.action === 'vendor_usage' ? USAGE() : body.action === 'config' ? { vendors: VENDORS() }
        : body.action === 'vendor_merge' && body.preview ? { ok: true, preview: true, matched: 1, target: { vendor_key: 'v1', display_name: body.to, auto_post: true }, from: [], unknown: 3, added_aliases: [body.names[1]] }
        : body.action === 'vendor_merge' ? { ok: true, merge_id: '99999999-9999-4999-8999-999999999999', target: { vendor_key: 'v1', display_name: body.to }, from: [], docs: 0, unknown: 3, recheck: { fixed: 3, failed: 0, left: 0 } }
        : body.action === 'vendor_register' ? { ok: true, vendor: { vendor_key: body.vendor.vendor_key, display_name: body.vendor.display_name, food_kind: body.vendor.food_kind, aliases: [] }, doc_ids: [D1], closed_left: 1, recheck: { fixed: 1, failed: 0, left: 0 } }
        : body.action === 'vendor_apply' ? { ok: true, vendor: { vendor_key: 'v3', display_name: 'Pacific Seafood' }, doc_ids: [D1], closed_left: 0, recheck: { fixed: 1, failed: 0, left: 0 } }
        : body.action === 'edit' ? { ok: true, version: body.version + 1 } : {});
      if (r && r.__error) { const e = new Error(r.__error); e.code = r.code || ''; throw e; }
      return r;
    },
    document: { getElementById: k => dom[k] || null, activeElement: null },
    setTimeout: f => { (c.later = c.later || []).push(f); return 0; }, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  };
  vm.createContext(c);
  vm.runInContext(MERGE + '\n' + DEC + '\nthis.M = { get m(){ return _ivd.m; } };', c);
  c.mem = mem; c.dom = dom;
  c.fn = n => vm.runInContext(n, c);
  c.box = () => (dom['ivd-modal'] ? dom['ivd-modal'].innerHTML : null);
  return c;
}
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const acts = c => c.calls.map(b => b.action + (b.preview ? ':preview' : ''));

test('a printed name no vendor has: similar vendors first (spelling, then part of the name), merged vendors never; the merge is checked first', async () => {
  const c = app();
  await c.fn('ivdOpenRow')(D1);
  await flush();
  const m = c.M.m;
  assert.deepEqual([m.mode, m.raw, m.cands.map(x => [x.v.vendor_key, x.why]), m.pick], ['merge', 'SAKURA PRODUCF', [['v1', 'spell'], ['v2', 'part']], 'v1']);
  // Preview first (nothing changes): the vendor's name and the printed one.
  const pv = c.calls.find(b => b.action === 'vendor_merge');
  assert.deepEqual(pv, { action: 'vendor_merge', preview: true, to: 'Sakura Produce', names: ['Sakura Produce', 'SAKURA PRODUCF'] });
  const h = c.box();
  assert.match(h, /同じ名前で待っている invoice：3 件/);
  assert.match(h, /Sakura Produce<\/b><br><span[^>]*>綴りが少し違う ・ 食材 ・ invoice 42 件/);
  assert.match(h, /Sakura Farms LLC<\/b><br><span[^>]*>名前の一部が同じ ・ 食材 ・ invoice 7 件/);
  assert.ok(!/Old Sakura/.test(h.split('ivd-other')[0]), 'a merged vendor is not a candidate');
  assert.ok(!/<option value="v5"/.test(h), 'nor a choice');
  assert.match(h, /「SAKURA PRODUCF」を <b>Sakura Produce<\/b> の別の名前として覚えます。待っている invoice 3 件の業者も直します/);
  assert.match(h, /業者マスターの「業者の統合」から外せます/);
  assert.match(h, /<button class="btn btn-primary"[^>]*onclick="ivdMerge\(\)">Sakura Produce に統合する<\/button>/);
  // Choosing another vendor checks again.
  c.fn('ivdPick')('v2'); await flush();
  assert.deepEqual(c.calls.filter(b => b.action === 'vendor_merge').at(-1).names, ['Sakura Farms LLC', 'SAKURA PRODUCF']);
  c.fn('ivdOther')('v3'); await flush();
  assert.deepEqual([c.M.m.pick, c.M.m.other, c.calls.filter(b => b.action === 'vendor_merge').at(-1).to], ['v2', 'v3', 'Pacific Seafood']);
  c.curLang = 'en'; c.fn('ivdRender')();
  assert.match(c.box(), /Merge into Pacific Seafood/);
});

test('今の業者に統合: the shared latest is read, the intake merges, the app records the merge (taken back in the vendor master); every list is read again', async () => {
  const c = app();
  c._invIn.docId = D1;
  await c.fn('ivdOpenRow')(D1); await flush();
  await c.fn('ivdMerge')(); await flush();
  assert.equal(c.pulls, 1);
  const call = c.calls.filter(b => b.action === 'vendor_merge' && !b.preview);
  assert.equal(call.length, 1);
  assert.deepEqual([call[0].to, call[0].names, /^vm[0-9a-z]+$/.test(call[0].group_id)], ['Sakura Produce', ['Sakura Produce', 'SAKURA PRODUCF'], true]);
  const g = c.mem.vendor_merges['g:' + call[0].group_id];
  assert.deepEqual([g.to, g.names, g.server.id, g.server.unknown, g.card, g.src, g.off, g.by], ['Sakura Produce', ['Sakura Produce', 'SAKURA PRODUCF'], '99999999-9999-4999-8999-999999999999', 3, 'v1', 'invoice_intake', false, 'Akane']);
  const n = c.mem.vendor_merges['n:sakura producf'];
  assert.deepEqual([n.to, n.name, n.g, n.off], ['Sakura Produce', 'SAKURA PRODUCF', call[0].group_id, false]);
  assert.equal(c.fn('vendorCanon')('Sakura  PRODUCF'), 'Sakura Produce', 'the app shows and totals it as the vendor');
  assert.equal(c.box(), null, 'closed');
  assert.deepEqual(Object.keys(c._invIn.loaded), [], 'review, health, config, list and the open invoice are read again');
  assert.equal(c._invIn.edits, null);
  assert.match(c.toasts.at(-1)[0], /「SAKURA PRODUCF」を Sakura Produce にまとめました（待っている invoice 3 件をこの業者にしました）/);
  assert.equal(c.M.m, null);
});

test('今の業者に統合 is not sent when it would merge another vendor, cannot be checked, or the app has the name elsewhere; the latest unread: nothing', async () => {
  // Another vendor has the chosen vendor's name: the intake would merge it too.
  let c = app({ api: b => b.action === 'vendor_merge' && b.preview ? { ok: true, matched: 2, target: { vendor_key: 'v1' }, from: [{ vendor_key: 'v9', display_name: 'Sakura Prod.' }], unknown: 3 }
    : b.action === 'vendor_usage' ? USAGE() : { ok: true } });
  await c.fn('ivdOpenRow')(D1); await flush();
  assert.match(c.box(), /ほかの業者（Sakura Prod\.）も同じ名前を持っているため、ここではまとめられません/);
  assert.match(c.box(), /onclick="ivdMerge\(\)"/); assert.match(c.box(), / disabled onclick="ivdMerge\(\)"/);
  await c.fn('ivdMerge')(); await flush();
  assert.deepEqual(acts(c).filter(a => a === 'vendor_merge'), [], 'not sent');
  // The check failed / the vendor is not found there.
  c = app({ api: b => b.action === 'vendor_merge' ? { __error: '通信できません' } : USAGE() });
  await c.fn('ivdOpenRow')(D1); await flush();
  assert.match(c.box(), /Invoice取込を確かめられませんでした/);
  c = app({ api: b => b.action === 'vendor_merge' ? { ok: true, matched: 0, target: null, from: [] } : USAGE() });
  await c.fn('ivdOpenRow')(D1); await flush();
  assert.match(c.box(), /この業者が Invoice取込で見つかりません/);
  // The app's 業者の統合 put the printed name under another vendor already (read with the latest).
  c = app();
  c.onPull = mem => { mem.vendor_merges = { 'n:sakura producf': { to: 'Sakura Farms LLC', name: 'SAKURA PRODUCF', g: 'gx', _at: 5 } }; };
  await c.fn('ivdOpenRow')(D1); await flush();
  await c.fn('ivdMerge')(); await flush();
  assert.deepEqual(acts(c).filter(a => a.startsWith('vendor_merge')), ['vendor_merge:preview'], 'only the preview was sent');
  assert.match(c.box(), /「SAKURA PRODUCF」は、業者マスターの「業者の統合」で「Sakura Farms LLC」にまとめてあります/);
  // Closed (or another screen opened) while the latest was read: nothing is sent.
  c = app();
  c.onPull = () => { delete c.dom['ivd-modal']; };
  await c.fn('ivdOpenRow')(D1); await flush();
  await c.fn('ivdMerge')(); await flush();
  assert.deepEqual(acts(c).filter(a => a.startsWith('vendor_merge')), ['vendor_merge:preview'], 'closed: only the preview was sent');
  c = app();
  c.dom['modal-overlay'] = { classList: { contains: k => k === 'open' && !c.closedOverlay } };
  c.onPull = () => { c.closedOverlay = true; };   // × pressed: the box stays in the page, the overlay is closed
  await c.fn('ivdOpenRow')(D1); await flush();
  await c.fn('ivdMerge')(); await flush();
  assert.deepEqual(acts(c).filter(a => a.startsWith('vendor_merge')), ['vendor_merge:preview'], '× pressed: only the preview was sent');
  // The latest records could not be read: nothing is sent.
  c = app({ pull: false });
  await c.fn('ivdOpenRow')(D1); await flush();
  await c.fn('ivdMerge')(); await flush();
  assert.deepEqual(acts(c).filter(a => a.startsWith('vendor_merge')), ['vendor_merge:preview'], 'only the preview was sent');
  assert.match(c.toasts.at(-1)[0], /最新の記録を読めませんでした/);
  // Nothing to merge (the name became the vendor's meanwhile): told, read again.
  c = app({ api: b => b.action === 'vendor_merge' && b.preview ? { ok: true, matched: 1, target: { vendor_key: 'v1' }, from: [], unknown: 0 }
    : b.action === 'vendor_merge' ? { ok: true, merge_id: null, matched: 1 } : USAGE() });
  await c.fn('ivdOpenRow')(D1); await flush(); await c.fn('ivdMerge')(); await flush();
  assert.deepEqual([c.box(), c.toasts.at(-1)[1], Object.keys(c.mem.vendor_merges).length], [null, 'info', 0]);
});

test('新しい業者として登録: the kind is required; the intake and the app vendor master get it (11A); a card of the same name is used, not doubled', async () => {
  const c = app({ rows: [{ id: D1, version: 2, vendor_key: null, vendor_raw: 'ALOHA FISH MKT', reasons: [{ code: 'vendor_unknown' }] }] });
  await c.fn('ivdOpenRow')(D1); await flush();
  assert.deepEqual([c.M.m.mode, c.M.m.name, c.M.m.kind], ['register', 'ALOHA FISH MKT', ''], 'no similar vendor: register first, the printed name as it is');
  assert.ok(!c.calls.some(b => b.action === 'vendor_merge'), 'no merge preview for a registration');
  assert.match(c.box(), /食材か食材以外かを選んでください/);
  await c.fn('ivdRegister')(); await flush();
  assert.ok(!c.calls.some(b => b.action === 'vendor_register'), 'not sent without the kind');
  c.fn('ivdNameIn')('Aloha  Fish Market'); c.fn('ivdKind')('food'); c.fn('ivdRender')();
  assert.match(c.box(), /印字された「ALOHA FISH MKT」は別の名前として覚えます/);
  assert.match(c.box(), /Invoice取込とアプリの業者マスターの両方に作ります/);
  assert.match(c.box(), /同じ印字名で待っている invoice 1 件もこの業者にします/);
  await c.fn('ivdRegister')(); await flush();
  const r = c.calls.find(b => b.action === 'vendor_register');
  assert.match(r.vendor.vendor_key, /^v\d{10,}$/);
  assert.deepEqual([r.vendor.display_name, r.vendor.food_kind, r.printed, r.doc_id], ['Aloha Fish Market', 'food', 'ALOHA FISH MKT', D1]);
  const card = c.mem.m_vendors.find(v => v.id === r.vendor.vendor_key);
  assert.deepEqual([card.name, card.kind, card.kindBy, card.src, c.mem.m_vendors.length], ['Aloha Fish Market', 'food', 'Akane', 'invoice_intake', 2]);
  assert.match(c.toasts.at(-1)[0], /Aloha Fish Market を登録しました（Invoice取込と業者マスター）。待っている invoice 1 件をこの業者にしました。締めた月の 1 件はそのままです/);
  assert.equal(c.box(), null);
  // A card of the same name exists (no Invoice取込 vendor yet): its id is the vendor key, no second card; an empty kind is filled.
  const d = app({ cards: [CARD('v1', 'Sakura Produce', { kind: 'food' }), CARD('v77', 'aloha fish market')], rows: [{ id: D1, version: 2, vendor_key: null, vendor_raw: 'ALOHA FISH MKT', reasons: [{ code: 'vendor_unknown' }] }] });
  await d.fn('ivdOpenRow')(D1); await flush();
  d.fn('ivdNameIn')('Aloha Fish Market'); d.fn('ivdKind')('nonfood'); d.fn('ivdRender')();
  assert.match(d.box(), /業者マスターのカード「aloha fish market」はもうあるので、そのカードを使います/);
  await d.fn('ivdRegister')(); await flush();
  assert.equal(d.calls.find(b => b.action === 'vendor_register').vendor.vendor_key, 'v77');
  assert.deepEqual([d.mem.m_vendors.length, d.mem.m_vendors.find(v => v.id === 'v77').kind], [2, 'nonfood']);
  assert.match(d.toasts.at(-1)[0], /Aloha Fish Market を登録しました（Invoice取込）/);
  // The card could not be saved (storage full): the intake has it, and that is told.
  const f = app({ rows: [{ id: D1, version: 2, vendor_key: null, vendor_raw: 'ALOHA FISH MKT', reasons: [{ code: 'vendor_unknown' }] }] });
  f.full = true;
  await f.fn('ivdOpenRow')(D1); await flush(); f.fn('ivdKind')('food'); await f.fn('ivdRegister')(); await flush();
  assert.match(f.toasts.at(-1)[0], /業者マスターのカードを保存できませんでした/);
});

test('新しい業者として登録 is refused for a name a vendor has (here or at the intake); the merge into it is one press away', async () => {
  const c = app({ rows: [{ id: D1, version: 2, vendor_key: null, vendor_raw: 'ALOHA FISH MKT', reasons: [{ code: 'vendor_unknown' }] }] });
  await c.fn('ivdOpenRow')(D1); await flush();
  c.fn('ivdKind')('food'); c.fn('ivdNameIn')('pac  seafood'); c.fn('ivdRender')();
  assert.match(c.box(), /「Pacific Seafood」がもうこの名前を持っています/);
  assert.match(c.box(), /disabled onclick="ivdRegister\(\)"/);
  await c.fn('ivdRegister')(); await flush();
  assert.ok(!c.calls.some(b => b.action === 'vendor_register'));
  c.fn('ivdUseTaken')('v3'); await flush();
  assert.deepEqual([c.M.m.mode, c.M.m.pick, c.calls.filter(b => b.action === 'vendor_merge').at(-1).to], ['merge', 'v3', 'Pacific Seafood']);
  // The intake refuses it (another screen registered it meanwhile): the vendor is named, the vendors are read again.
  const d = app({ rows: [{ id: D1, version: 2, vendor_key: null, vendor_raw: 'ALOHA FISH MKT', reasons: [{ code: 'vendor_unknown' }] }],
    api: b => b.action === 'vendor_register' ? { ok: false, taken: { why: 'name', vendor_key: 'v8', display_name: 'Aloha Fish Market', name: 'ALOHA FISH MKT' } }
      : b.action === 'config' ? { vendors: VENDORS().concat([{ vendor_key: 'v8', display_name: 'Aloha Fish Market', aliases: ['ALOHA FISH MKT'] }]) } : USAGE() });
  await d.fn('ivdOpenRow')(D1); await flush();
  d.fn('ivdKind')('food'); await d.fn('ivdRegister')(); await flush();
  assert.deepEqual(acts(d).slice(-2), ['vendor_register', 'config']);
  assert.match(d.box(), /「Aloha Fish Market」がもうこの名前を持っています/);
  assert.match(d.box(), /onclick="ivdUseTaken\(&quot;v8&quot;\)"/);
  assert.equal(d.mem.m_vendors.length, 1, 'no card');
  // The card's id is a vendor of the intake under another name already: that vendor is named.
  const k = app({ cards: [CARD('v3', 'Aloha Fish Market', { kind: 'food' })], rows: [{ id: D1, version: 2, vendor_key: null, vendor_raw: 'ALOHA FISH MKT', reasons: [{ code: 'vendor_unknown' }] }],
    api: b => b.action === 'vendor_register' ? { ok: false, taken: { why: 'key', vendor_key: 'v3', display_name: 'Pacific Seafood', name: 'Pacific Seafood' } } : b.action === 'config' ? { vendors: VENDORS() } : USAGE() });
  await k.fn('ivdOpenRow')(D1); await flush();
  k.fn('ivdNameIn')('Aloha Fish Market'); k.fn('ivdKind')('food'); await k.fn('ivdRegister')(); await flush();
  assert.equal(k.calls.find(b => b.action === 'vendor_register').vendor.vendor_key, 'v3', 'the card’s id');
  assert.match(k.box(), /業者マスターのカード「Aloha Fish Market」は、Invoice取込ではもう「Pacific Seafood」です/);
  assert.match(k.box(), /onclick="ivdUseTaken\(&quot;v3&quot;\)"/);
});

test('a name one vendor has now: the waiting invoices get it (vendor_apply); two vendors: this invoice only, nothing remembered', async () => {
  const c = app({ rows: [{ id: D1, version: 4, vendor_key: null, vendor_raw: 'Pac Seafood', reasons: [{ code: 'vendor_unknown' }] }] });
  await c.fn('ivdOpenRow')(D1); await flush();
  assert.equal(c.M.m.mode, 'owned');
  assert.match(c.box(), /この印字名は、もう <b>Pacific Seafood<\/b> の名前です/);
  assert.ok(!/ivdMode\(/.test(c.box()), 'neither merge nor register is offered (the name would join two vendors)');
  await c.fn('ivdApply')(); await flush();
  assert.deepEqual(c.calls.find(b => b.action === 'vendor_apply'), { action: 'vendor_apply', name: 'Pac Seafood', doc_id: D1 });
  assert.match(c.toasts.at(-1)[0], /待っている invoice 1 件を Pacific Seafood にしました/);
  // Two vendors have it.
  const d = app({ rows: [{ id: D1, version: 4, vendor_key: null, vendor_raw: 'shared name', reasons: [{ code: 'vendor_unknown' }] }] });
  await d.fn('ivdOpenRow')(D1); await flush();
  assert.match(d.box(), /2 つ以上の業者（Pacific Seafood・Kona Paper）が持っているため/);
  assert.ok(!/ivdApply/.test(d.box()));
  d.fn('ivdOnlyPick')('v4'); await d.fn('ivdOnly')(); await flush();
  assert.deepEqual(d.calls.find(b => b.action === 'edit'), { action: 'edit', doc_id: D1, version: 4, header: { vendor_key: 'v4' }, lines: [], reason: '業者を選んだ：Kona Paper', adjustment_ack: false, ack: [] });
  assert.ok(!d.calls.some(b => b.action === 'vendor_merge' || b.action === 'vendor_apply' || b.action === 'vendor_register'));
  // The vendors with the name changed meanwhile: nothing is changed, it is told.
  const z = app({ rows: [{ id: D1, version: 4, vendor_key: null, vendor_raw: 'Pac Seafood', reasons: [{ code: 'vendor_unknown' }] }], api: b => b.action === 'vendor_apply' ? { ok: false, vendors: [] } : USAGE() });
  await z.fn('ivdOpenRow')(D1); await flush(); await z.fn('ivdApply')(); await flush();
  assert.match(z.toasts.at(-1)[0], /この名前を持つ業者が変わりました/);
});

test('no printed name: the invoice gets the vendor chosen (no name is remembered), or a new vendor of its own', async () => {
  const c = app({ rows: [{ id: D1, version: 6, vendor_key: null, vendor_raw: '', reasons: [{ code: 'vendor_unknown' }] }] });
  await c.fn('ivdOpenRow')(D1); await flush();
  assert.deepEqual([c.M.m.mode, c.M.m.cands.length], ['merge', 0]);
  assert.match(c.box(), /（印字なし・読めなかった）/);
  c.fn('ivdOther')('v2'); await flush();
  assert.match(c.box(), /この invoice の業者を <b>Sakura Farms LLC<\/b> にします（印字された名前が無いので、名前は覚えません）/);
  await c.fn('ivdMerge')(); await flush();
  assert.deepEqual(acts(c).filter(a => a !== 'vendor_usage'), ['edit'], 'no merge, no preview');
  assert.deepEqual(c.calls.find(b => b.action === 'edit').header, { vendor_key: 'v2' });
  const d = app({ rows: [{ id: D1, version: 6, vendor_key: null, vendor_raw: '', reasons: [{ code: 'vendor_unknown' }] }] });
  await d.fn('ivdOpenRow')(D1); await flush();
  d.fn('ivdMode')('register'); d.fn('ivdNameIn')('Pali Paper'); d.fn('ivdKind')('nonfood'); d.fn('ivdRender')();
  assert.match(d.box(), /この invoice をこの業者にします/);
  await d.fn('ivdRegister')(); await flush();
  assert.deepEqual([d.calls.find(b => b.action === 'vendor_register').printed, d.calls.find(b => b.action === 'vendor_register').doc_id], [null, D1]);
});

test('who may, one at a time, the open invoice’s unsaved values, an older server, and names shown as text', async () => {
  for (const role of ['am', 'chef', 'store_leader']) {
    const c = app({ role });
    await c.fn('ivdOpenRow')(D1); await flush();
    assert.deepEqual([c.box(), c.calls.length, /経理・事務Crew・GM・CEO/.test(c.toasts.at(-1)[0])], [null, 0, true], role);
  }
  for (const role of ['office_crew', 'gm', 'ceo']) { const c = app({ role }); await c.fn('ivdOpenRow')(D1); await flush(); assert.ok(c.box(), role); }
  // While one is being saved, another is not opened.
  let release; const gate = new Promise(r => { release = r; });
  const c = app({ api: async b => { if (b.action === 'vendor_merge' && !b.preview) await gate; return b.action === 'vendor_merge' && b.preview ? { ok: true, matched: 1, target: { vendor_key: 'v1' }, from: [], unknown: 3 }
    : b.action === 'vendor_merge' ? { ok: true, merge_id: '99999999-9999-4999-8999-999999999999', target: { vendor_key: 'v1' }, from: [], recheck: { fixed: 3 } } : USAGE(); } });
  await c.fn('ivdOpenRow')(D1); await flush();
  const p = c.fn('ivdMerge')(); await flush();
  assert.match(c.box(), /決めています…/);
  await c.fn('ivdOpenRow')(D2); await flush();
  assert.match(c.toasts.at(-1)[0], /前の業者を決めています/);
  await c.fn('ivdMerge')(); await flush();
  assert.equal(c.calls.filter(b => b.action === 'vendor_merge' && !b.preview).length, 1, 'pressed twice: sent once');
  release(); await p; await flush();
  // The open invoice has unsaved values: asked first.
  const d = app();
  d._invIn.doc = { doc: { id: D1, version: 3, vendor_raw: 'SAKURA PRODUCF' } }; d._invIn.docId = D1; d.edits = true;
  d.fn('ivdOpenDoc')();
  assert.match(d.modals.at(-1), /この画面で直した値（まだ保存していないもの）は消えます/);
  assert.equal(d.box(), null);
  await d.fn('ivdOpenDoc')(true); await flush();
  assert.deepEqual([d.M.m.docId, d.M.m.version], [D1, 3]);
  // An older intake server does not know the actions.
  const o = app({ rows: [{ id: D1, version: 2, vendor_key: null, vendor_raw: 'ALOHA FISH MKT', reasons: [{ code: 'vendor_unknown' }] }],
    api: b => b.action === 'vendor_register' ? { __error: 'うまくいきませんでした（unknown_action）', code: 'unknown_action' } : USAGE() });
  await o.fn('ivdOpenRow')(D1); await flush(); o.fn('ivdKind')('food'); await o.fn('ivdRegister')(); await flush();
  assert.match(o.toasts.at(-1)[0], /Invoice取込のサーバーが前の版のままです（関数 invoice-intake を入れ直してください）（変えていません）/);
  assert.equal(o.mem.m_vendors.length, 1);
  // A printed name is shown and told as text.
  const x = app({ rows: [{ id: D1, version: 2, vendor_key: null, vendor_raw: '<img src=x onerror=alert(1)>', reasons: [{ code: 'vendor_unknown' }] }] });
  await x.fn('ivdOpenRow')(D1); await flush();
  assert.ok(!/<img/.test(x.box()) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(x.box()));
  x.fn('ivdKind')('food'); await x.fn('ivdRegister')(); await flush();
  assert.ok(x.toasts.length && x.toasts.every(([m]) => !/<img/.test(m)), 'toasts too');
});

test('the review list and the open invoice offer 業者を決める where the vendor is not in the master; the silent learning is gone; v1089', () => {
  const table = bodyOf('invInReviewTable');
  assert.match(table, /var vendorNew = edit && !r\.vendor_key && chk\.some\(function\(x\)\{ return x\.code==='vendor_unknown'; \}\);/);
  assert.match(table, /\(vendorNew \? ' <button class="btn btn-primary btn-sm"[^']*'\+dis\+' onclick="event\.stopPropagation\(\);ivdOpenRow\(/);
  const detail = bodyOf('invInDetail');
  assert.match(detail, /var vendorNew = canEdit && rv && d\.status==='review' && !d\.vendor_key && codes\.indexOf\('vendor_unknown'\)>=0;/);
  assert.match(detail, /kind==='vendor' && vendorNew \? '<button class="btn btn-primary btn-sm" onclick="ivdOpenDoc\(\)">/);
  assert.ok(detail.indexOf("kind==='vendor' && vendorNew") < detail.indexOf("kind==='vendor' ? '<select"), 'the button comes before the select');
  assert.ok(!/を業者の別名として覚えます（次回から ✓）/.test(html), 'the old note is gone');
  assert.match(html, /const APP_VERSION = '(\d+)'/);
  const v = Number(/const APP_VERSION = '(\d+)'/.exec(html)[1]);
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(v >= 1089 && sw.includes("const SW_BUILD = '" + v + "'"));
});
