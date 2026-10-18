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
const NAMES = { v1: 'Sakura Produce', v2: 'Sakura Farms LLC', v3: 'Pacific Seafood', v4: 'Kona Paper' };
// What vendor_merge_into answers in a preview (the vendor as the server calls it now).
const PV = (b, o = {}) => ({ ok: true, preview: true, matched: 1, target: { vendor_key: b.vendor_key, display_name: NAMES[b.vendor_key], before: NAMES[b.vendor_key], auto_post: b.vendor_key === 'v1' },
  from: [], unknown: 3, waiting: 3, closed_left: 0, here: true, added_aliases: [b.name], ...o });
const ROWS = () => [{ id: D1, version: 3, vendor_key: null, vendor_raw: 'SAKURA PRODUCF', reasons: [{ code: 'vendor_unknown' }] },
  { id: D2, version: 1, vendor_key: null, vendor_raw: 'sakura  producf', reasons: [{ code: 'vendor_unknown' }] }];
const CARD = (id, name, o = {}) => ({ id, name, contact: '', phone: '', sms: '', email: '', line: '', method: '', cutoff: '', leadtime: 1, minOrder: 0, delivery: '', terms: '', rating: 3, webform: '', ...o });

function app({ role = 'office', cards = [CARD('v1', 'Sakura Produce', { kind: 'food' })], vendors = VENDORS(), rows = ROWS(), api = null, pull = true, merges = {}, config = null } = {}) {
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
      // The vendor list is read again each time the dialog opens: the same list unless the test says otherwise (config).
      if (body.action === 'config') { c.configs = (c.configs || 0) + 1; return config ? config(c.configs) : { vendors: JSON.parse(JSON.stringify(vendors || [])) }; }
      const r = api ? await api(body, c) : (body.action === 'vendor_usage' ? USAGE()
        : body.action === 'vendor_merge_into' && body.preview ? PV(body)
        : body.action === 'vendor_merge_into' ? { ...PV(body), preview: false, merge_id: '99999999-9999-4999-8999-999999999999', recheck: { fixed: 3, failed: 0, left: 0 }, review_doc_ids: [D1, D2] }
        : body.action === 'vendor_register' ? { ok: true, vendor: { vendor_key: body.vendor.vendor_key, display_name: body.vendor.display_name, food_kind: body.vendor.food_kind, aliases: [] }, doc_ids: [D1], closed_left: 1, recheck: { fixed: 1, failed: 0, left: 0 } }
        : body.action === 'vendor_apply' ? { ok: true, vendor: { vendor_key: 'v3', display_name: 'Pacific Seafood' }, doc_ids: [D1], closed_left: 0, recheck: { fixed: 1, failed: 0, left: 0 } }
        : body.action === 'edit' ? { ok: true, version: body.version + 1 } : {});
      if (r && r.__error) { const e = new Error(r.__error); e.code = r.code || ''; if (r.status) e.status = r.status; throw e; }
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
  assert.equal(c.configs, 1, 'the vendor list is read again when it opens');
  // Preview first (nothing changes): the vendor, the printed name, the invoice on screen.
  const pv = c.calls.find(b => b.action === 'vendor_merge_into');
  assert.deepEqual(pv, { action: 'vendor_merge_into', preview: true, vendor_key: 'v1', name: 'SAKURA PRODUCF', doc_id: D1 });
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
  assert.equal(c.calls.filter(b => b.action === 'vendor_merge_into').at(-1).vendor_key, 'v2');
  c.fn('ivdOther')('v3'); await flush();
  assert.deepEqual([c.M.m.pick, c.M.m.other, c.calls.filter(b => b.action === 'vendor_merge_into').at(-1).vendor_key], ['v2', 'v3', 'v3']);
  c.curLang = 'en'; c.fn('ivdRender')();
  assert.match(c.box(), /Merge into Pacific Seafood/);
  // The server calls the vendor by another name now (renamed on another screen): that name is shown and used.
  const r = app({ api: b => b.action === 'vendor_merge_into' ? PV(b, { target: { vendor_key: 'v1', display_name: 'Sakura Produce Hawaii', before: 'Sakura Produce' }, waiting: 4, closed_left: 2, docs: 2 }) : USAGE() });
  await r.fn('ivdOpenRow')(D1); await flush();
  assert.match(r.box(), /この業者の invoice 2 件は、業者名を今の名前（Sakura Produce Hawaii）にそろえます（Drive の名前・QuickBooks・金額は変えません）/);
  assert.ok(!/業者名を今の名前/.test(c.box()), 'not told when there are none');
  assert.match(r.box(), /<b>Sakura Produce Hawaii<\/b> の別の名前として覚えます。待っている invoice 4 件の業者も直します（締めた月の 2 件はそのまま）/);
  assert.match(r.box(), /onclick="ivdMerge\(\)">Sakura Produce Hawaii に統合する</);
});

test('今の業者に統合: the shared latest is read, the intake merges after its checks, the app records the merge (taken back in the vendor master); every list is read again', async () => {
  const c = app();
  c._invIn.docId = D1;
  await c.fn('ivdOpenRow')(D1); await flush();
  await c.fn('ivdMerge')(); await flush();
  assert.equal(c.pulls, 1);
  const call = c.calls.filter(b => b.action === 'vendor_merge_into' && !b.preview);
  assert.equal(call.length, 1);
  assert.deepEqual([call[0].vendor_key, call[0].name, call[0].doc_id, /^vm[0-9a-z]+$/.test(call[0].group_id)], ['v1', 'SAKURA PRODUCF', D1, true]);
  assert.ok(!c.calls.some(b => b.action === 'vendor_merge'), 'never the unchecked merge');
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
  // The app records the name the server merged into (renamed meanwhile), and tells the closed months left.
  const d = app({ api: b => b.action === 'vendor_merge_into' && b.preview ? PV(b) : b.action === 'vendor_merge_into'
    ? { ...PV(b, { target: { vendor_key: 'v1', display_name: 'Sakura Produce Hawaii' } }), preview: false, merge_id: '99999999-9999-4999-8999-999999999999', recheck: { fixed: 2, failed: 0, left: 0 }, closed_left: 1 } : USAGE() });
  await d.fn('ivdOpenRow')(D1); await flush(); await d.fn('ivdMerge')(); await flush();
  assert.equal(d.mem.vendor_merges['n:sakura producf'].to, 'Sakura Produce Hawaii');
  assert.match(d.toasts.at(-1)[0], /Sakura Produce Hawaii にまとめました.*締めた月の 1 件はそのままです/);
});

test('今の業者に統合 is not sent when the intake refuses, cannot be checked, or the app has the name elsewhere; the latest unread or closed: nothing', async () => {
  // The intake refuses: another vendor has the vendor's name / the vendor is gone.
  let c = app({ api: b => b.action === 'vendor_merge_into' ? { ok: false, why: 'shared', vendors: [{ vendor_key: 'v9', display_name: 'Sakura Prod.' }] } : USAGE() });
  await c.fn('ivdOpenRow')(D1); await flush();
  assert.match(c.box(), /ほかの業者（Sakura Prod\.）も「Sakura Produce」という名前を持っているため、ここではまとめられません/);
  assert.match(c.box(), / disabled onclick="ivdMerge\(\)"/);
  await c.fn('ivdMerge')(); await flush();
  assert.deepEqual(acts(c).filter(a => a === 'vendor_merge_into'), [], 'not sent');
  c = app({ api: b => b.action === 'vendor_merge_into' ? { ok: false, why: 'gone', vendors: [] } : USAGE() });
  await c.fn('ivdOpenRow')(D1); await flush();
  assert.match(c.box(), /この業者が Invoice取込で見つかりません/);
  // Any other refusal, even one that names the vendor: not sent.
  c = app({ api: b => b.action === 'vendor_merge_into' ? { ...PV(b), ok: false, why: 'later_change' } : USAGE() });
  await c.fn('ivdOpenRow')(D1); await flush();
  assert.match(c.box(), / disabled onclick="ivdMerge\(\)"/);
  await c.fn('ivdMerge')(); await flush();
  assert.deepEqual(acts(c).filter(a => a === 'vendor_merge_into'), [], 'a refused preview is not sent');
  // The printed name has become a vendor's elsewhere: the dialog gives the waiting invoices that vendor instead.
  c = app({ api: b => b.action === 'vendor_merge_into' ? { ok: false, why: 'owned', vendors: [{ vendor_key: 'v3', display_name: 'Pacific Seafood' }] } : USAGE() });
  await c.fn('ivdOpenRow')(D1); await flush();
  assert.deepEqual([c.M.m.mode, c.M.m.owners.map(v => v.vendor_key)], ['owned', ['v3']]);
  assert.match(c.box(), /この印字名は、もう <b>Pacific Seafood<\/b> の名前です/);
  // The check failed.
  c = app({ api: b => b.action === 'vendor_merge_into' ? { __error: '通信できません' } : USAGE() });
  await c.fn('ivdOpenRow')(D1); await flush();
  assert.match(c.box(), /Invoice取込を確かめられませんでした/);
  // Refused when sent (decided on another screen meanwhile): nothing recorded, the dialog follows.
  c = app({ api: b => b.action === 'vendor_merge_into' && b.preview ? PV(b) : b.action === 'vendor_merge_into' ? { ok: false, why: 'owned', vendors: [{ vendor_key: 'v2', display_name: 'Sakura Farms LLC' }] } : USAGE() });
  await c.fn('ivdOpenRow')(D1); await flush(); await c.fn('ivdMerge')(); await flush();
  assert.deepEqual([c.M.m.mode, Object.keys(c.mem.vendor_merges).length, c.toasts.at(-1)[1]], ['owned', 0, 'warning']);
  assert.match(c.toasts.at(-1)[0], /まとめていません：この印字名は、ほかの画面でもう業者の名前になりました/);
  // The app's 業者の統合 put the printed name under another vendor already (read with the latest).
  c = app();
  c.onPull = mem => { mem.vendor_merges = { 'n:sakura producf': { to: 'Sakura Farms LLC', name: 'SAKURA PRODUCF', g: 'gx', _at: 5 } }; };
  await c.fn('ivdOpenRow')(D1); await flush();
  await c.fn('ivdMerge')(); await flush();
  assert.deepEqual(acts(c).filter(a => a.startsWith('vendor_merge')), ['vendor_merge_into:preview'], 'only the preview was sent');
  assert.match(c.box(), /「SAKURA PRODUCF」は、業者マスターの「業者の統合」で「Sakura Farms LLC」にまとめてあります/);
  // Closed (or another screen opened) while the latest was read: nothing is sent.
  c = app();
  c.onPull = () => { delete c.dom['ivd-modal']; };
  await c.fn('ivdOpenRow')(D1); await flush();
  await c.fn('ivdMerge')(); await flush();
  assert.deepEqual(acts(c).filter(a => a.startsWith('vendor_merge')), ['vendor_merge_into:preview'], 'closed: only the preview was sent');
  c = app();
  c.dom['modal-overlay'] = { classList: { contains: k => k === 'open' && !c.closedOverlay } };
  c.onPull = () => { c.closedOverlay = true; };   // × pressed: the box stays in the page, the overlay is closed
  await c.fn('ivdOpenRow')(D1); await flush();
  await c.fn('ivdMerge')(); await flush();
  assert.deepEqual(acts(c).filter(a => a.startsWith('vendor_merge')), ['vendor_merge_into:preview'], '× pressed: only the preview was sent');
  // The latest records could not be read: nothing is sent.
  c = app({ pull: false });
  await c.fn('ivdOpenRow')(D1); await flush();
  await c.fn('ivdMerge')(); await flush();
  assert.deepEqual(acts(c).filter(a => a.startsWith('vendor_merge')), ['vendor_merge_into:preview'], 'only the preview was sent');
  assert.match(c.toasts.at(-1)[0], /最新の記録を読めませんでした/);
  // No answer (the network, or the server stopped inside): the intake is asked what happened.
  for (const err of [{ __error: 'つながりません', code: 'network' }, { __error: 'うまくいきませんでした（error）', code: 'error', status: 500 }]) {
    // It was merged there (its record carries this merge's id): the app's record is written, as after a normal merge.
    let gid = null, usageCalls = 0;
    c = app({ api: b => { if (b.action === 'vendor_merge_into' && b.preview) return PV(b); if (b.action === 'vendor_merge_into') { gid = b.group_id; return err; }
      if (b.action === 'vendor_usage') { usageCalls++; return usageCalls === 1 ? USAGE() : { ...USAGE(), merges: [{ id: 'mmmmmmmm-0000-4000-8000-000000000001', to_key: 'v1', names: ['Sakura Produce', 'SAKURA PRODUCF'], group_id: gid, merged_at: '2026-10-16T19:01:00.000Z' }] }; } return {}; } });
    await c.fn('ivdOpenRow')(D1); await flush(); await c.fn('ivdMerge')(); await flush();
    assert.match(c.toasts.at(-1)[0], /答えが途中で返りませんでしたが、Invoice取込では済んでいました/, err.code);
    assert.deepEqual([c.mem.vendor_merges['g:' + gid].server.id, c.mem.vendor_merges['n:sakura producf'].to, c.mem.vendor_merges['g:' + gid].at], ['mmmmmmmm-0000-4000-8000-000000000001', 'Sakura Produce', '2026-10-16T19:01:00.000Z'], err.code);
    assert.deepEqual([c.box(), ['review', 'config', 'health', 'list'].filter(k => k in c._invIn.loaded)], [null, []], err.code);
    // Not merged there: told so, nothing recorded.
    c = app({ api: b => b.action === 'vendor_merge_into' && b.preview ? PV(b) : b.action === 'vendor_merge_into' ? err : USAGE() });
    await c.fn('ivdOpenRow')(D1); await flush(); await c.fn('ivdMerge')(); await flush();
    assert.match(c.toasts.at(-1)[0], /Invoice取込を確かめたときには変わっていませんでした/, err.code);
    assert.deepEqual(Object.keys(c.mem.vendor_merges), [], err.code);
    // The intake cannot be asked either: the result is unknown.
    let uc = 0;
    c = app({ api: b => b.action === 'vendor_merge_into' && b.preview ? PV(b) : b.action === 'vendor_merge_into' ? err : (b.action === 'vendor_usage' && ++uc > 1) ? { __error: 'x', code: 'network' } : USAGE() });
    await c.fn('ivdOpenRow')(D1); await flush(); await c.fn('ivdMerge')(); await flush();
    assert.match(c.toasts.at(-1)[0], /結果が分かりません/, err.code);
  }
  // Opened again after such a lost answer: the intake's merge of this printed name gets its app record (only a 2-name one made here).
  c = app({ api: b => b.action === 'vendor_usage' ? { ...USAGE(), merges: [{ id: 'mmmmmmmm-0000-4000-8000-000000000002', to_key: 'v1', names: ['Sakura Produce', 'SAKURA PRODUCF'], group_id: 'vmlost01', merged_at: '2026-10-16T19:00:00.000Z' },
    { id: 'mmmmmmmm-0000-4000-8000-000000000003', to_key: 'v1', names: ['Sakura Produce', 'SAKURA PRODUCF', 'OTHER'], group_id: 'vmmaster1' }] } : PV(b) });
  await c.fn('ivdOpenRow')(D1); await flush();
  assert.deepEqual([Object.keys(c.mem.vendor_merges).sort(), c.mem.vendor_merges['g:vmlost01'].server.id], [['g:vmlost01', 'n:sakura producf'], 'mmmmmmmm-0000-4000-8000-000000000002']);
  assert.match(c.toasts.at(-1)[0], /この印字名の統合（「SAKURA PRODUCF」→ Sakura Produce）の記録が無かったので/);
  // Written later, it keeps the time of the merge at the intake (so a newer merge or 外す of the same name still wins).
  assert.deepEqual([c.mem.vendor_merges['g:vmlost01'].at, c.mem.vendor_merges['g:vmlost01'].ms], ['2026-10-16T19:00:00.000Z', Date.parse('2026-10-16T19:00:00.000Z')]);
});

test('新しい業者として登録: the kind is required; the intake and the app vendor master get it (11A); a card of the same name is used, not doubled', async () => {
  const c = app({ rows: [{ id: D1, version: 2, vendor_key: null, vendor_raw: 'ALOHA FISH MKT', reasons: [{ code: 'vendor_unknown' }] }] });
  await c.fn('ivdOpenRow')(D1); await flush();
  assert.deepEqual([c.M.m.mode, c.M.m.name, c.M.m.kind], ['register', 'ALOHA FISH MKT', ''], 'no similar vendor: register first, the printed name as it is');
  assert.ok(!c.calls.some(b => b.action === 'vendor_merge_into'), 'no merge preview for a registration');
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
  // No answer to the registration: the intake is asked whether the vendor (this key) is there; if so, the card is made.
  let rk = null;
  const g = app({ rows: [{ id: D1, version: 2, vendor_key: null, vendor_raw: 'ALOHA FISH MKT', reasons: [{ code: 'vendor_unknown' }] }],
    config: n => ({ vendors: n === 1 || !rk ? VENDORS() : VENDORS().concat([{ vendor_key: rk, display_name: 'aloha fish  mkt', aliases: [], food_kind: 'food' }]) }),
    api: b => { if (b.action === 'vendor_register') { rk = b.vendor.vendor_key; return { __error: 'つながりません', code: 'network' }; } return USAGE(); } });
  await g.fn('ivdOpenRow')(D1); await flush(); g.fn('ivdKind')('food'); await g.fn('ivdRegister')(); await flush();
  assert.match(g.toasts.at(-1)[0], /Invoice取込では済んでいました/);
  assert.deepEqual(g.mem.m_vendors.map(v => v.id), ['v1', rk]);
  // The server refused it (the key was there already, with another name): the vendor found under the key is not this one -> not done, no card.
  let rk2 = null;
  const g2 = app({ rows: [{ id: D1, version: 2, vendor_key: null, vendor_raw: 'ALOHA FISH MKT', reasons: [{ code: 'vendor_unknown' }] }],
    config: n => ({ vendors: n === 1 || !rk2 ? VENDORS() : VENDORS().concat([{ vendor_key: rk2, display_name: 'Someone Else', aliases: [], food_kind: 'food' }]) }),
    api: b => { if (b.action === 'vendor_register') { rk2 = b.vendor.vendor_key; return { __error: 'つながりません', code: 'network' }; } return USAGE(); } });
  await g2.fn('ivdOpenRow')(D1); await flush(); g2.fn('ivdKind')('food'); await g2.fn('ivdRegister')(); await flush();
  assert.match(g2.toasts.at(-1)[0], /Invoice取込を確かめたときには変わっていませんでした/);
  assert.deepEqual(g2.mem.m_vendors.map(v => v.id), ['v1']);
  // The key was in the list read at open (the card's id is an intake vendor's key: here one merged away, so its name is free): the
  // server refuses by key, so finding that vendor under the key afterwards is not "done".
  const g3 = app({ cards: [CARD('v1', 'Sakura Produce', { kind: 'food' }), CARD('v9', 'ALOHA FISH MKT', { kind: 'food' })],
    vendors: VENDORS().concat([{ vendor_key: 'v9', display_name: 'ALOHA FISH MKT', aliases: [], food_kind: 'food', merged_into: 'v1', updated_at: 't9' }]),
    rows: [{ id: D1, version: 2, vendor_key: null, vendor_raw: 'ALOHA FISH MKT', reasons: [{ code: 'vendor_unknown' }] }],
    api: b => (b.action === 'vendor_register' ? { __error: 'つながりません', code: 'network' } : USAGE()) });
  await g3.fn('ivdOpenRow')(D1); await flush(); g3.fn('ivdMode')('register'); g3.fn('ivdKind')('food');
  await g3.fn('ivdRegister')(); await flush();
  const sent3 = g3.calls.filter(b => b.action === 'vendor_register');
  assert.equal(sent3.length, 1); assert.equal(sent3[0].vendor.vendor_key, 'v9');
  assert.match(g3.toasts.at(-1)[0], /確かめたときには変わっていませんでした/);
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
  assert.deepEqual([c.M.m.mode, c.M.m.pick, c.calls.filter(b => b.action === 'vendor_merge_into').at(-1).vendor_key], ['merge', 'v3', 'v3']);
  // The intake refuses it (another screen registered it meanwhile): the vendor is named, the vendors are read again.
  const d = app({ rows: [{ id: D1, version: 2, vendor_key: null, vendor_raw: 'ALOHA FISH MKT', reasons: [{ code: 'vendor_unknown' }] }],
    config: n => ({ vendors: n === 1 ? VENDORS() : VENDORS().concat([{ vendor_key: 'v8', display_name: 'Aloha Fish Market', aliases: ['ALOHA FISH MKT'] }]) }),
    api: b => b.action === 'vendor_register' ? { ok: false, taken: { why: 'name', vendor_key: 'v8', display_name: 'Aloha Fish Market', name: 'ALOHA FISH MKT' } } : USAGE() });
  await d.fn('ivdOpenRow')(D1); await flush();
  d.fn('ivdKind')('food'); await d.fn('ivdRegister')(); await flush();
  assert.deepEqual(acts(d).slice(-2), ['vendor_register', 'config']);
  assert.match(d.box(), /「Aloha Fish Market」がもうこの名前を持っています/);
  assert.match(d.box(), /onclick="ivdUseTaken\(&quot;v8&quot;\)"/);
  assert.equal(d.mem.m_vendors.length, 1, 'no card');
  // The card's id is a vendor of the intake under another name already: that vendor is named.
  const k = app({ cards: [CARD('v3', 'Aloha Fish Market', { kind: 'food' })], rows: [{ id: D1, version: 2, vendor_key: null, vendor_raw: 'ALOHA FISH MKT', reasons: [{ code: 'vendor_unknown' }] }],
    api: b => b.action === 'vendor_register' ? { ok: false, taken: { why: 'key', vendor_key: 'v3', display_name: 'Pacific Seafood', name: 'Pacific Seafood' } } : USAGE() });
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
  assert.deepEqual(c.calls.find(b => b.action === 'vendor_apply'), { action: 'vendor_apply', name: 'Pac Seafood', doc_id: D1, vendor_key: 'v3' }, 'with the vendor the dialog showed');
  assert.match(c.toasts.at(-1)[0], /待っている invoice 1 件を Pacific Seafood にしました/);
  // Two vendors have it.
  const d = app({ rows: [{ id: D1, version: 4, vendor_key: null, vendor_raw: 'shared name', reasons: [{ code: 'vendor_unknown' }] }] });
  await d.fn('ivdOpenRow')(D1); await flush();
  assert.match(d.box(), /2 つ以上の業者（Pacific Seafood・Kona Paper）が持っているため/);
  assert.ok(!/ivdApply/.test(d.box()));
  d.fn('ivdOnlyPick')('v4'); await d.fn('ivdOnly')(); await flush();
  assert.deepEqual(d.calls.find(b => b.action === 'edit'), { action: 'edit', doc_id: D1, version: 4, header: { vendor_key: 'v4' }, lines: [], reason: '業者を選んだ：Kona Paper', adjustment_ack: false, ack: [], learn: false });
  assert.ok(!d.calls.some(b => b.action === 'vendor_merge_into' || b.action === 'vendor_apply' || b.action === 'vendor_register'));
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
  assert.deepEqual(acts(c).filter(a => a !== 'vendor_usage' && a !== 'config'), ['edit'], 'no merge, no preview');
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
  const c = app({ api: async b => { if (b.action === 'vendor_merge_into' && !b.preview) await gate; return b.action === 'vendor_merge_into' && b.preview ? PV(b)
    : b.action === 'vendor_merge_into' ? { ...PV(b), preview: false, merge_id: '99999999-9999-4999-8999-999999999999', recheck: { fixed: 3 } } : USAGE(); } });
  await c.fn('ivdOpenRow')(D1); await flush();
  const p = c.fn('ivdMerge')(); await flush();
  assert.match(c.box(), /決めています…/);
  await c.fn('ivdOpenRow')(D2); await flush();
  assert.match(c.toasts.at(-1)[0], /前の業者を決めています/);
  await c.fn('ivdMerge')(); await flush();
  assert.equal(c.calls.filter(b => b.action === 'vendor_merge_into' && !b.preview).length, 1, 'pressed twice: sent once');
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

test('a vendor name is text everywhere (also one registered from a printed name); the vendor applied is the server’s; a printed name merged in the app is not registered elsewhere', async () => {
  const bad = '<img src=x onerror=alert(1)>';
  const vendors = VENDORS().concat([{ vendor_key: 'v9', display_name: bad, aliases: ['EVIL CO'], food_kind: 'food' }]);
  const c = app({ vendors, rows: [{ id: D1, version: 1, vendor_key: null, vendor_raw: 'EVIL CO', reasons: [{ code: 'vendor_unknown' }] }],
    api: b => b.action === 'vendor_apply' ? { ok: true, vendor: { vendor_key: 'v9', display_name: bad }, doc_ids: [D1], recheck: { fixed: 1 } } : USAGE() });
  await c.fn('ivdOpenRow')(D1); await flush();
  assert.equal(c.M.m.mode, 'owned');
  assert.ok(!/<img/.test(c.box()), c.box().match(/ivdApply\(\)">[^<]*/));
  assert.match(c.box(), /onclick="ivdApply\(\)">&lt;img src=x onerror=alert\(1\)&gt; にする</);
  await c.fn('ivdApply')(); await flush();
  assert.ok(c.toasts.length && c.toasts.every(([m]) => !/<img/.test(m)));
  // The toast names the vendor the server applied.
  const d = app({ rows: [{ id: D1, version: 1, vendor_key: null, vendor_raw: 'PAC SEAFOOD', reasons: [{ code: 'vendor_unknown' }] }],
    api: b => b.action === 'vendor_apply' ? { ok: true, vendor: { vendor_key: 'v3', display_name: 'Pacific Seafood Co' }, doc_ids: [D1], recheck: { fixed: 1 } } : USAGE() });
  await d.fn('ivdOpenRow')(D1); await flush(); await d.fn('ivdApply')(); await flush();
  assert.match(d.toasts.at(-1)[0], /待っている invoice 1 件を Pacific Seafood Co にしました/);
  // The printed name is merged into another vendor in the app: registering it under a new name is refused.
  const e = app({ merges: { 'n:aloha fish mkt': { to: 'Aloha Fish', name: 'ALOHA FISH MKT', g: 'g1', _at: 1 } },
    rows: [{ id: D1, version: 1, vendor_key: null, vendor_raw: 'ALOHA FISH MKT', reasons: [{ code: 'vendor_unknown' }] }] });
  await e.fn('ivdOpenRow')(D1); await flush();
  e.fn('ivdMode')('register'); e.fn('ivdNameIn')('Aloha Fish Market'); e.fn('ivdKind')('food'); e.fn('ivdRender')();
  assert.match(e.box(), /印字された「ALOHA FISH MKT」は、業者マスターの「業者の統合」で「Aloha Fish」にまとめてあります/);
  await e.fn('ivdRegister')(); await flush();
  assert.ok(!e.calls.some(b => b.action === 'vendor_register'));
  // Refused as taken by the vendor that has the printed name now: 「統合する」 gives the waiting invoices that vendor (no empty merge).
  const f = app({ rows: [{ id: D1, version: 1, vendor_key: null, vendor_raw: 'ALOHA FISH MKT', reasons: [{ code: 'vendor_unknown' }] }],
    config: n => ({ vendors: n === 1 ? VENDORS() : VENDORS().concat([{ vendor_key: 'v8', display_name: 'Aloha Fish Market', aliases: ['ALOHA FISH MKT'] }]) }),
    api: b => b.action === 'vendor_register' ? { ok: false, taken: { why: 'name', vendor_key: 'v8', display_name: 'Aloha Fish Market', name: 'ALOHA FISH MKT' } } : USAGE() });
  await f.fn('ivdOpenRow')(D1); await flush(); f.fn('ivdKind')('food'); await f.fn('ivdRegister')(); await flush();
  f.fn('ivdUseTaken')('v8'); await flush();
  assert.deepEqual([f.M.m.mode, f.M.m.owners.map(v => v.vendor_key)], ['owned', ['v8']]);
  assert.ok(!f.calls.some(b => b.action === 'vendor_merge_into'), 'no merge');
  // Pressed again while the list is read: only the last one opens.
  let release; const gate = new Promise(r => { release = r; });
  const g = app({ config: async n => { if (n === 1) await gate; return { vendors: VENDORS() }; } });
  const p1 = g.fn('ivdOpenRow')(D1); await flush();
  await g.fn('ivdOpenRow')(D2); await flush();
  release(); await p1; await flush();
  assert.equal(g.M.m.docId, D2);
  // Closed while the list is read: it does not open.
  let rel2; const gate2 = new Promise(r => { rel2 = r; });
  const h = app({ config: async () => { await gate2; return { vendors: VENDORS() }; } });
  const p2 = h.fn('ivdOpenRow')(D1); await flush();
  assert.match(h.modals.at(-1), /業者の一覧を読んでいます/);
  h.fn('closeModalDirect')(); rel2(); await p2; await flush();
  assert.deepEqual([h.M.m, h.box()], [null, null]);
  assert.ok(!h.calls.some(b => b.action === 'vendor_merge_into'));
});

test('the review list and the open invoice offer 業者を決める where the vendor is not in the master; the silent learning is gone; v1089', () => {
  const table = bodyOf('invInReviewTable');
  // Also one a merge gave the vendor that was not worked out again yet (more than one call works out): it still says vendor_unknown.
  assert.match(table, /var vendorNew = edit && chk\.some\(function\(x\)\{ return x\.code==='vendor_unknown'; \}\);/);
  assert.match(table, /\(vendorNew \? ' <button class="btn btn-primary btn-sm"[^']*'\+dis\+' onclick="event\.stopPropagation\(\);ivdOpenRow\(/);
  const detail = bodyOf('invInDetail');
  assert.match(detail, /var vendorNew = canEdit && rv && d\.status==='review' && codes\.indexOf\('vendor_unknown'\)>=0;/);
  assert.match(detail, /kind==='vendor' && vendorNew \? '<button class="btn btn-primary btn-sm" onclick="ivdOpenDoc\(\)">/);
  assert.ok(detail.indexOf("kind==='vendor' && vendorNew") < detail.indexOf("kind==='vendor' ? '<select"), 'the button comes before the select');
  assert.ok(!/を業者の別名として覚えます（次回から ✓）/.test(html), 'the old note is gone');
  assert.match(html, /const APP_VERSION = '(\d+)'/);
  const v = Number(/const APP_VERSION = '(\d+)'/.exec(html)[1]);
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(v >= 1089 && sw.includes("const SW_BUILD = '" + v + "'"));
});
