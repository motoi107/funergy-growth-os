// 業者の統合（アプリ v1083・Moto 2026-10-15・UI案51 決めてほしいこと 1〜7 はすべて A）— the app side.
// Runs the real vendor merge module from index.html (FUNERGY_VENDOR_MERGE) in a VM with the real vendor helpers it works with
// (invoice vendor kind, best match, the vendor list, the invoice form's check, the month's vendor totals, the shared-data merge).
// The invoice intake server is a stand-in that records what it was asked. Synthetic data only. No network, no storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MOD = html.slice(html.indexOf('/* FUNERGY_VENDOR_MERGE_BEGIN */'), html.indexOf('/* FUNERGY_VENDOR_MERGE_END */'));
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A top-level function from index.html, cut out by matching braces (strings and comments are skipped).
function fnSrc(name) {
  const start = html.indexOf('\nfunction ' + name + '(');
  assert.ok(start >= 0, 'function ' + name);
  let i = html.indexOf('{', start), depth = 0, q = null;
  for (; i < html.length; i++) {
    const ch = html[i], nx = html[i + 1];
    if (q) { if (ch === '\\') { i++; continue; } if (ch === q) q = null; continue; }
    if (ch === '/' && nx === '/') { i = html.indexOf('\n', i); continue; }
    if (ch === '/' && nx === '*') { i = html.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return html.slice(start + 1, i + 1);
  }
  throw new Error('unbalanced ' + name);
}
const REAL = ['mergeMapByTime', '_recAt', 'invVendorKind', 'invSetVendorKind', 'matchVendorBest', '_vnNorm', '_vnTokens', 'vendorsSorted', 'checkVendorRegistered',
  'applyVendorSuggest', '_invGather', 'invInVendorOpts'].map(fnSrc).join('\n');   // v1084: monthInvoiceByVendor は原価率(FC)の画面と一緒に廃止

const CARD = (id, name, o = {}) => ({ id, name, contact: '', phone: '', sms: '', email: '', line: '', method: '', cutoff: '', leadtime: 1, minOrder: 0, delivery: '', terms: '', rating: 3, webform: '', ...o });
const CARDS = () => [
  CARD('v1', 'Island Fresh Produce', { kind: 'food', contact: 'Lisa', phone: '808-555-0110', terms: 'NET15' }),
  CARD('v2', 'Island Fresh Produce Inc', { kind: 'food', email: 'orders@islandfresh.example', terms: 'NET30' }),
  CARD('v3', 'Aloha Meats', { kind: 'food' }),
  CARD('v4', 'Pacific Seafood', { kind: 'food' }), CARD('v5', 'Pacific Sea Food LLC', { kind: 'food' }),
  CARD('v6', 'Kona Paper Supply', { kind: 'nonfood' }), CARD('v7', 'KONA PAPER SUPPLY', { kind: 'food' }),
  CARD('v8', 'Hawaii Rice Co.', { kind: 'food' }), CARD('v9', 'Hawaii Rice Co.', { kind: 'food', email: 'rice@example.test' }),
  CARD('v10', 'Aloha Fish', { kind: 'food' }), CARD('v11', 'Rice Factory Hawaii', { kind: 'food' }),
];
const INVOICES = () => [
  ...Array.from({ length: 4 }, (_, i) => ({ id: 'a' + i, vendor: 'Island Fresh Produce', total: 100, docDate: '2026/10/0' + (i + 1), storeId: 'F01' })),
  { id: 'b1', vendor: 'ISLAND FRESH PRODUCE, INC.', total: 40, docDate: '2026/10/05', storeId: 'F01' },
  { id: 'b2', vendor: 'Island Fresh Prodcue', total: 5, docDate: '2026/10/06', storeId: 'F01' },
  { id: 'c1', vendor: 'ALOHA MEAT CO.', total: 70, docDate: '2026/10/07', storeId: 'F01' },
  { id: 'd1', vendor: 'Island Fresh Produce', total: 999, docDate: '2026/09/08', storeId: 'F01', deleted: true },
];
const USAGE = () => ({
  vendors: [{ vendor_key: 'v1', display_name: 'Island Fresh Produce', aliases: [], docs: 12, food_kind: 'food', auto_post: true },
    { vendor_key: 'v2', display_name: 'Island Fresh Produce Inc', aliases: [], docs: 3, food_kind: 'food', auto_post: false },
    { vendor_key: 'v3', display_name: 'Aloha Meats', aliases: ['ALOHA MEAT CO.'], docs: 7, food_kind: 'food', auto_post: true },
    { vendor_key: 'v12', display_name: 'Old Vendor', aliases: [], docs: 2, merged_into: 'v3' }],
  unknown: [{ name: 'ISLAND FRESH PRODUCE, INC.', docs: 6 }], merges: [] });
const PREVIEW = (o = {}) => ({ ok: true, preview: true, matched: 2, merge_id: null, target: { vendor_key: 'v1', display_name: 'Island Fresh Produce', auto_post: true, food_kind: 'food' },
  from: [{ vendor_key: 'v2', display_name: 'Island Fresh Produce Inc', food_kind: 'food', auto_post: false }], docs: 6, review: 2, posted: 4,
  kept: [{ id: 'k1', internal_no: 'INT-9', invoice_no: '5521', store_id: 'F01', vendor_key: 'v2' }], closed_left: 1, unknown: 6, maps: 1, prices: 3, checks: 1, added_aliases: [], months: ['2026-10'], ...o });

function app({ role = 'office', user = 'Akane', signed = true, cards = CARDS(), invoices = INVOICES(), products = [], usage = USAGE(), api = null, pull = true, mem: mem0 = null } = {}) {
  const mem = mem0 || { m_vendors: cards, invoices, vendor_merges: {}, m_vendor_alias: {}, m_ingredients_v2: products };
  const dom = {};
  const el = (id, o = {}) => (dom[id] = dom[id] || { id, innerHTML: '', value: '', dataset: {}, style: {}, ...o });
  const c = {
    calls: [], toasts: [], modals: [], pages: [], pulls: 0, curLang: 'ja', curRole: role, curPage: 'vendor_master', vmView: 'order', signed,
    escapeHtml: esc, t: (ja, en) => (c.curLang === 'en' ? en : ja), myName: () => user, nowJP: () => '2026/10/15 09:00',
    ls: (k, d) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : d), lsSet: (k, v) => { if (c.full) return false; mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    _lsStoreGet: k => (k in mem ? JSON.stringify(mem[k]) : null),
    getVendors: () => c.ls('m_vendors', []), getIngV2: () => c.ls('m_ingredients_v2', []), _setIngV2: a => c.lsSet('m_ingredients_v2', a),
    showToast: (m, k) => c.toasts.push([m, k]),
    openModal: h => { c.modals.push(h); if (/id="vmg-modal"/.test(h)) el('vmg-modal'); else delete dom['vmg-modal']; },
    closeModalDirect: () => { delete dom['vmg-modal']; },
    renderPage: p => c.pages.push(p),
    pullOpKey: async k => { c.pulls++; if (c.onPull) c.onPull(mem); return pull; },
    invInSigned: () => c.signed, invInKept: () => false, invInKeepWho: () => '', invInRestore: async () => false, invInLoginModal: () => c.modals.push('login'),
    _invIn: { config: null },
    invInAPI: async body => {
      c.calls.push(JSON.parse(JSON.stringify(body)));
      const r = api ? await api(body) : (body.action === 'vendor_usage' ? usage : body.action === 'vendor_merge' && body.preview ? PREVIEW()
        : body.action === 'vendor_merge' ? { ...PREVIEW({ preview: false }), merge_id: '11111111-1111-4111-8111-111111111111', recheck: { fixed: 2, failed: 0, left: 0 } }
        : body.action === 'vendor_unmerge' && body.preview ? { ok: true, preview: true, docs: 5, unknown: 2, stay: 1, review: 3, ...(globalThis.__unmergePv || {}) } : body.action === 'vendor_unmerge' ? { ok: true, docs: 5, stay: 1 } : {});
      if (r && r.__error) { const e = new Error(r.__error); e.code = r.code || ''; throw e; }
      return r;
    },
    document: { getElementById: k => dom[k] || null, activeElement: null, querySelectorAll: () => [] },
    setTimeout: (f) => { c.later = (c.later || []); c.later.push(f); return 0; }, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {} }, window: {},
    parseJaDate: s => { const m = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; },
    _invDate: v => c.parseJaDate(v.docDate || v.date), _invStoreIds: v => [v.storeId],
    invKindRefresh: () => {}, invoiceTmpLines: [], invoiceDocType: 'Invoice', ROLE_CONFIG: { office: { name: '経理' } }, curUserName: user,
    docVal: k => (dom[k] ? dom[k].value : ''),
  };
  vm.createContext(c);
  vm.runInContext(REAL + '\n' + MOD + '\nthis.M = { get _vmg(){ return _vmg; } };', c);
  c.mem = mem; c.dom = dom; c.el = el;
  c.fn = n => vm.runInContext(n, c);
  return c;
}
const J = v => JSON.parse(JSON.stringify(v));
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
const sent = c => c.calls.filter(b => b.action !== 'vendor_usage');
const entries = c => Object.fromEntries(Object.entries(c.mem.vendor_merges).filter(([k]) => k.startsWith('n:')).map(([k, v]) => [k, [v.to, !!v.off]]));

test('the shared table decides the vendor: chains, a name of another case, a merge taken back, a loop; the cards put away', () => {
  const c = app();
  c.mem.vendor_merges = {
    'n:island fresh produce inc': { to: 'Island Fresh Produce', name: 'Island Fresh Produce Inc', g: 'g1', _at: 1 },
    'n:island fresh prodcue': { to: 'Island Fresh Produce Inc', name: 'Island Fresh Prodcue', g: 'g0', _at: 1 },   // merged into a name merged since
    'n:kona paper supply': { to: 'Kona Paper Supply', name: 'KONA PAPER SUPPLY', g: 'g2', _at: 1 },
    'n:aloha meats': { to: 'Aloha Fish', name: 'Aloha Meats', g: 'g3', off: true, _at: 2 },                     // taken back
    'n:loop a': { to: 'Loop B', g: 'g4', _at: 1 }, 'n:loop b': { to: 'loop a', g: 'g4', _at: 1 },
    'g:g5': { to: 'Hawaii Rice Co.', names: ['Hawaii Rice Co.'], hide: ['v9'], _at: 1 },
  };
  const canon = c.fn('vendorCanon');
  assert.deepEqual(['Island Fresh Produce Inc', 'ISLAND  FRESH PRODUCE inc', 'Island Fresh Prodcue', 'KONA PAPER SUPPLY', 'Kona Paper Supply', 'Aloha Meats', 'Nobody', '　Ｎｏｂｏｄｙ ', 'Loop A', ''].map(canon),
    ['Island Fresh Produce', 'Island Fresh Produce', 'Island Fresh Produce', 'Kona Paper Supply', 'Kona Paper Supply', 'Aloha Meats', 'Nobody', 'Nobody', 'loop a', '']);
  assert.deepEqual(c.fn('getVendorsVisible')().map(v => v.id), ['v1', 'v3', 'v4', 'v5', 'v6', 'v8', 'v10', 'v11'], 'merged names’ cards and the second card of the same name are put away (not deleted)');
  assert.equal(c.mem.m_vendors.length, 11);
  assert.equal(c.fn('vmgCardFor')('island fresh prodcue').id, 'v1');
  assert.equal(c.fn('vmgCardFor')('KONA PAPER SUPPLY').id, 'v6');
  // The invoice form, the checks and the order screens list only the cards in use; the vendor kind comes from the kept card.
  assert.deepEqual(c.fn('vendorsSorted')().map(v => v.name), ['Aloha Fish', 'Aloha Meats', 'Hawaii Rice Co.', 'Island Fresh Produce', 'Kona Paper Supply', 'Pacific Sea Food LLC', 'Pacific Seafood', 'Rice Factory Hawaii']);
  assert.equal(c.fn('invVendorKind')('KONA PAPER SUPPLY'), 'nonfood', 'the merged name takes the kept card’s kind');
  // Choosing a kind for a merged name sets the kept card and makes no new card (the reason for 業者の統合).
  c.fn('invSetVendorKind')('ISLAND FRESH PRODCUE', 'nonfood');
  assert.equal(c.mem.m_vendors.length, 11);
  assert.equal(c.mem.m_vendors.find(v => v.id === 'v1').kind, 'nonfood');
  c.fn('invSetVendorKind')('Brand New Vendor', 'food');
  assert.equal(c.mem.m_vendors.length, 12, 'a new name still makes its card');
  // The best match finds a merged name at once.
  assert.deepEqual([c.fn('matchVendorBest')('Island Fresh Prodcue').vendor.id, c.fn('matchVendorBest')('Island Fresh Prodcue').score], ['v1', 1]);
  // Totals per vendor add the merged names up; the record keeps what was read.
  assert.equal(c.mem.invoices.find(v => v.id === 'b2').vendor, 'Island Fresh Prodcue', 'records are not rewritten (2A)');
  assert.match(c.fn('vmgVendorHtml')('Island Fresh Prodcue'), /^Island Fresh Produce <span[^>]*>読み取り：Island Fresh Prodcue<\/span>$/);
  assert.equal(c.fn('vmgVendorHtml')('Island Fresh Produce'), 'Island Fresh Produce');
});

test('candidates: Inc./LLC/Co., punctuation, case and one-letter spellings are found; other vendors are not; “different vendors” stays apart', () => {
  const c = app({ products: [{ code: 'P1', vendor: 'Island Fresh Produce' }, { code: 'P2', vendor: 'Pacific Seafood' }] });
  c.M._vmg.usage = USAGE();
  const pool = c.fn('vmgPool')();
  assert.deepEqual(J(pool['Island Fresh Produce']).inv, 4, 'a deleted invoice is not counted');
  assert.deepEqual([pool['Island Fresh Produce'].cards.length, pool['Island Fresh Produce'].intake, pool['Island Fresh Produce'].prod], [1, 12, 1]);
  assert.equal(pool['ISLAND FRESH PRODUCE, INC.'].unk, 6, 'printed names no intake vendor has yet are candidates too');
  assert.equal(pool['Old Vendor'], undefined, 'a vendor merged in the intake is not offered again');
  assert.ok(pool['Kona Paper Supply'] && pool['KONA PAPER SUPPLY'], 'names that differ only in case are two names (the totals show them apart)');
  const groups = J(c.fn('vmgGroups')(pool));
  const g = name => groups.find(x => x.names.includes(name));
  assert.deepEqual(g('Island Fresh Produce').names.slice().sort(), ['ISLAND FRESH PRODUCE, INC.', 'Island Fresh Prodcue', 'Island Fresh Produce', 'Island Fresh Produce Inc']);
  assert.equal(g('Island Fresh Produce').names[0], 'Island Fresh Produce', 'the one with a card and the most use first');
  assert.equal(g('Island Fresh Produce').why, 'spell');
  assert.deepEqual([g('Aloha Meats').names.slice().sort(), g('Aloha Meats').why], [['ALOHA MEAT CO.', 'Aloha Meats'], 'loose']);
  assert.deepEqual([g('Pacific Seafood').names.slice().sort(), g('Pacific Seafood').why], [['Pacific Sea Food LLC', 'Pacific Seafood'], 'loose']);
  assert.deepEqual([g('Kona Paper Supply').why, g('Kona Paper Supply').kindClash], ['case', true]);
  assert.deepEqual([g('Hawaii Rice Co.').names, g('Hawaii Rice Co.').why], [['Hawaii Rice Co.'], 'dupcard']);
  assert.equal(g('Aloha Fish'), undefined, 'Aloha Fish is another vendor'); assert.equal(g('Rice Factory Hawaii'), undefined);
  // The card shows them, with the buttons for accounting; the AM sees them without buttons.
  const h = c.fn('vmgCardHtml')();
  assert.match(h, /業者の統合/); assert.match(h, /候補 5/); assert.match(h, /候補の理由：綴りが少し違う/); assert.match(h, /まとめる…/);
  assert.match(h, /Invoice取込 12/); assert.match(h, /業者を選ぶ待ち 6/); assert.match(h, /食材と食材以外が分かれています/);
  const am = app({ role: 'am' });
  const ha = am.fn('vmgCardHtml')();
  assert.doesNotMatch(ha, /まとめる…|別の業者<\/button>/); assert.match(ha, /まとめる・外すのは経理・事務Crew・GM・CEO です/);
  assert.equal(am.calls.length, 0, 'the AM does not read the intake');
  am.fn('vmgOpen')(['Aloha Meats', 'ALOHA MEAT CO.']);
  assert.match(am.toasts.pop()[0], /経理・事務Crew・GM・CEO/);
  // An earlier merge kept on this device only (the old 業者名の整理) is offered again, to be merged for every device and the intake.
  const leg = app({ mem: { m_vendors: CARDS(), invoices: INVOICES(), vendor_merges: {}, m_vendor_alias: { 'aloha fish': 'Aloha Meats' }, m_ingredients_v2: [] } });
  assert.equal(J(leg.fn('vmgGroups')(leg.fn('vmgPool')())).find(x => x.names.includes('Aloha Fish')).why, 'legacy');
});

test('“different vendors” is shared, read first; it keeps the pair out of the candidates', async () => {
  const c = app();
  const before = J(c.fn('vmgGroups')(c.fn('vmgPool')())).length;
  const i = J(c.fn('vmgGroups')(c.fn('vmgPool')())).findIndex(x => x.names.includes('Pacific Seafood'));
  await c.fn('vmgSkipGroup')(i);
  assert.equal(c.pulls, 1);
  assert.equal(c.mem.vendor_merges['skip:pacific sea food llc|pacific seafood'].off, false);
  assert.equal(J(c.fn('vmgGroups')(c.fn('vmgPool')())).length, before - 1);
  const bad = app({ pull: false });
  await bad.fn('vmgSkipGroup')(0);
  assert.deepEqual(bad.mem.vendor_merges, {}, 'the latest could not be read: nothing changes');
});

test('merge: the screen asks the intake first (nothing changes), then the intake merges and the shared table and the card follow', async () => {
  const c = app();
  c.fn('vmgOpen')(['Island Fresh Produce', 'Island Fresh Produce Inc', 'ISLAND FRESH PRODUCE, INC.', 'Island Fresh Prodcue']);
  await flush();
  assert.deepEqual(sent(c), [{ action: 'vendor_merge', preview: true, to: 'Island Fresh Produce', names: ['Island Fresh Produce', 'Island Fresh Produce Inc', 'ISLAND FRESH PRODUCE, INC.', 'Island Fresh Prodcue'] }]);
  const P = J(c.fn('vmgPlan')());
  assert.deepEqual([P.keep, P.target.id, P.rename, Object.keys(P.fill), P.fill.email.v, P.hide, P.clash, P.kind, P.inv], ['Island Fresh Produce', 'v1', null, ['email'], 'orders@islandfresh.example', [], false, 'food', 2]);
  const h = c.dom['vmg-modal'].innerHTML;
  assert.match(h, /① 残す名前/); assert.match(h, /ほかのカードから埋める/); assert.match(h, /業者マスターのカード 2 → 1/);
  assert.match(h, /締めていない月の書類 6 件を「Island Fresh Produce」に付け替えます（締めた月の 1 件はそのまま）/);
  assert.match(h, /同じ番号で 2 件とも反映済み/); assert.match(h, /#5521（F01）/); assert.match(h, /業者を選ぶ待ちの書類/);
  assert.match(h, /自動で反映するかは「Island Fresh Produce」の設定のまま（自動）/);
  assert.match(h, /QuickBooks に送ったもの・名前を変えた Drive の原本・締めた月の数字/);
  assert.doesNotMatch(h, /id="vmg-go" disabled/);
  assert.deepEqual(c.mem.vendor_merges, {}, 'the preview changes nothing');
  // Untick one: the intake is asked again for the new set.
  c.fn('vmgSetOff')('Island Fresh Prodcue', true);
  await flush();
  assert.deepEqual(sent(c).at(-1).names, ['Island Fresh Produce', 'Island Fresh Produce Inc', 'ISLAND FRESH PRODUCE, INC.']);
  c.fn('vmgSetOff')('Island Fresh Prodcue', false); await flush();
  await c.fn('vmgDo')();
  const call = sent(c).at(-1);
  assert.equal(call.action, 'vendor_merge'); assert.equal(call.preview, undefined); assert.match(call.group_id, /^vm[a-z0-9]+$/);
  assert.deepEqual([call.to, call.names, call.food_kind], ['Island Fresh Produce', ['Island Fresh Produce', 'Island Fresh Produce Inc', 'ISLAND FRESH PRODUCE, INC.', 'Island Fresh Prodcue'], null]);
  assert.equal(c.pulls, 1, 'the shared table is read before anything changes');
  assert.deepEqual(entries(c), { 'n:island fresh produce inc': ['Island Fresh Produce', false], 'n:island fresh produce, inc.': ['Island Fresh Produce', false], 'n:island fresh prodcue': ['Island Fresh Produce', false] });
  const g = c.mem.vendor_merges['g:' + call.group_id];
  assert.deepEqual([g.to, g.by, g.server.id, g.server.docs, g.server.kept, g.card, g.filled, g.off], ['Island Fresh Produce', 'Akane', '11111111-1111-4111-8111-111111111111', 6, 1, 'v1', { email: 'orders@islandfresh.example' }, false]);
  const v1 = c.mem.m_vendors.find(v => v.id === 'v1');
  assert.deepEqual([v1.email, v1.terms, v1.contact], ['orders@islandfresh.example', 'NET15', 'Lisa'], 'the kept card keeps its values; only blanks are filled (6A)');
  assert.equal(c.mem.m_vendors.length, 11, 'no card is deleted');
  assert.deepEqual(c.fn('getVendorsVisible')().map(v => v.id).includes('v2'), false);
  assert.match(c.toasts.find(x => x[1] === 'success')[0], /「Island Fresh Produce」にまとめました（Invoice取込：書類 6 件を付け替え・業者を選ぶ待ち 6 件）/);
  assert.ok(c.toasts.some(x => /同じ番号で 2 件とも反映済み/.test(x[0]) && x[1] === 'warning'));
  assert.equal(c.dom['vmg-modal'], undefined, 'closed');
  // Now one vendor everywhere in the app.
  assert.equal(J(c.fn('vmgGroups')(c.fn('vmgPool')())).some(x => x.names.includes('Island Fresh Produce')), false);
  const h2 = c.fn('vmgCardHtml')();
  assert.match(h2, /統合の記録 1/);
});

test('merge refusals: nothing changes when the latest cannot be read, someone else merged first, the intake refuses, or the kind is not chosen', async () => {
  const names = ['Island Fresh Produce', 'Island Fresh Produce Inc'];
  // The latest could not be read.
  const a = app({ pull: false });
  a.fn('vmgOpen')(names); await flush(); await a.fn('vmgDo')();
  assert.deepEqual([sent(a).filter(b => !b.preview).length, a.mem.vendor_merges], [0, {}]);
  // Someone else merged one of the names into another vendor meanwhile (the read brings it).
  const b = app();
  b.onPull = mem => { mem.vendor_merges = { 'n:island fresh produce inc': { to: 'Other Vendor', name: 'Island Fresh Produce Inc', g: 'gx', _at: 9 } }; };
  b.fn('vmgOpen')(names); await flush(); await b.fn('vmgDo')();
  assert.equal(sent(b).filter(x => !x.preview).length, 0);
  assert.match(b.toasts.at(-1)[0], /ほかの人が先にまとめました/);
  // The intake refuses: the app changes nothing either.
  const cc = app({ api: body => (body.preview ? PREVIEW() : { __error: '今の状態ではこの操作はできません', code: 'invalid_state' }) });
  cc.fn('vmgOpen')(names); await flush(); await cc.fn('vmgDo')();
  assert.deepEqual([cc.mem.vendor_merges, cc.mem.m_vendors.find(v => v.id === 'v1').email], [{}, '']);
  assert.match(cc.toasts.at(-1)[0], /まとめていません/);
  // Food and non-food differ: it waits for the choice, and the choice is sent to the intake and set on the kept card.
  const d = app({ api: body => (body.preview ? PREVIEW({ target: { vendor_key: 'v6', display_name: 'Kona Paper Supply', food_kind: 'nonfood' }, from: [] })
    : { ...PREVIEW({ preview: false, from: [] }), merge_id: '22222222-2222-4222-8222-222222222222' }) });
  d.fn('vmgOpen')(['Kona Paper Supply', 'KONA PAPER SUPPLY']); await flush();
  assert.match(d.fn('vmgCantWhy')(J(d.fn('vmgPlan')()), true), /食材か食材以外か/);
  assert.match(d.dom['vmg-modal'].innerHTML, /id="vmg-go" disabled/);
  await d.fn('vmgDo')();
  assert.equal(sent(d).filter(x => !x.preview).length, 0);
  d.fn('vmgKind')('food');
  await d.fn('vmgDo')();
  assert.equal(sent(d).at(-1).food_kind, 'food');
  const v6 = d.mem.m_vendors.find(v => v.id === 'v6');
  assert.deepEqual([v6.kind, d.mem.vendor_merges['n:kona paper supply'].to], ['food', 'Kona Paper Supply']);
  assert.deepEqual(d.fn('getVendorsVisible')().filter(v => /kona/i.test(v.name)).map(v => v.id), ['v6']);
  // Not signed in: the screen asks for the email sign-in and does not merge.
  const e = app({ signed: false });
  e.fn('vmgOpen')(names); await flush();
  assert.match(e.dom['vmg-modal'].innerHTML, /一緒にまとめるにはメール認証が要ります/);
  await e.fn('vmgDo')();
  assert.deepEqual([sent(e).length, e.mem.vendor_merges], [0, {}]);
  // This device cannot save: the toast says the intake was merged and to press again.
  const f = app(); f.fn('vmgOpen')(names); await flush(); f.full = true; await f.fn('vmgDo')();
  assert.match(f.toasts.at(-1)[0], /Invoice取込はまとめましたが、この端末に保存できませんでした/);
});

test('the name to keep has no card: the card is renamed to it; taken back, the names, the card, its blanks and its kind come back', async () => {
  const c = app();
  c.fn('vmgOpen')(['Island Fresh Produce', 'Island Fresh Produce Inc', 'ISLAND FRESH PRODUCE, INC.'], 'ISLAND FRESH PRODUCE, INC.');
  await flush();
  const P = J(c.fn('vmgPlan')());
  assert.deepEqual([P.keep, P.target.id, P.rename], ['ISLAND FRESH PRODUCE, INC.', 'v1', { id: 'v1', from: 'Island Fresh Produce' }]);
  assert.match(c.dom['vmg-modal'].innerHTML, /名前を「ISLAND FRESH PRODUCE, INC\.」に変えます/);
  await c.fn('vmgDo')();
  const gid = sent(c).at(-1).group_id;
  assert.equal(c.mem.m_vendors.find(v => v.id === 'v1').name, 'ISLAND FRESH PRODUCE, INC.');
  assert.equal(c.fn('vendorCanon')('Island Fresh Produce'), 'ISLAND FRESH PRODUCE, INC.', 'the old card name goes to the new one (orders and records by that name)');
  assert.deepEqual(c.fn('getVendorsVisible')().filter(v => /island/i.test(v.name)).map(v => v.id), ['v1']);
  // A later merge into the same vendor: the earlier one waits for it to be taken back first.
  c.fn('vmgOpen')(['ISLAND FRESH PRODUCE, INC.', 'Island Fresh Prodcue']); await flush(); await c.fn('vmgDo')();
  const gid2 = sent(c).at(-1).group_id;
  await c.fn('vmgUndoAsk')(gid);
  assert.match(c.toasts.at(-1)[0], /先に新しいほうを外してください/);
  // Taking back the later one: the intake first (preview, then the change), then the table.
  await c.fn('vmgUndoAsk')(gid2);
  assert.deepEqual(sent(c).at(-1), { action: 'vendor_unmerge', merge_id: '11111111-1111-4111-8111-111111111111', preview: true });
  assert.match(c.modals.at(-1), /Invoice取込：書類 5 件を元の業者に戻します・業者が決まっていなかった 2 件は業者を選ぶ待ちに戻します（そのあと直した 1 件はそのまま）/);
  globalThis.__unmergePv = { docs: 0, unknown: 2, stay: 0 };   // only invoices that had no vendor go back
  await c.fn('vmgUndoAsk')(gid2);
  assert.match(c.modals.at(-1), /Invoice取込：業者が決まっていなかった 2 件は業者を選ぶ待ちに戻します。/);
  globalThis.__unmergePv = { docs: 0, unknown: 0, stay: 0 };
  await c.fn('vmgUndoAsk')(gid2);
  assert.match(c.modals.at(-1), /Invoice取込：書類 0 件を元の業者に戻します。/);
  delete globalThis.__unmergePv;
  await c.fn('vmgUndo')(gid2);
  assert.deepEqual(sent(c).at(-1), { action: 'vendor_unmerge', merge_id: '11111111-1111-4111-8111-111111111111' });
  assert.equal(c.fn('vendorCanon')('Island Fresh Prodcue'), 'Island Fresh Prodcue');
  await c.fn('vmgUndo')(gid);
  const v1 = c.mem.m_vendors.find(v => v.id === 'v1');
  assert.deepEqual([v1.name, v1.email, v1.kind], ['Island Fresh Produce', '', 'food'], 'the name, the filled blank and the kind come back');
  assert.deepEqual(Object.values(entries(c)).every(x => x[1]), true, 'every name of both merges is off');
  assert.equal(c.mem.vendor_merges['g:' + gid].off, true); assert.equal(c.mem.vendor_merges['g:' + gid].offBy, 'Akane');
  assert.deepEqual(c.fn('getVendorsVisible')().filter(v => /island/i.test(v.name)).map(v => v.id), ['v1', 'v2']);
  assert.match(c.fn('vmgCardHtml')(), /統合の記録 0/);
  // A value changed on the card since the merge stays when it is taken back.
  const d = app();
  d.fn('vmgOpen')(['Island Fresh Produce', 'Island Fresh Produce Inc']); await flush(); await d.fn('vmgDo')();
  const dg = sent(d).at(-1).group_id;
  d.mem.m_vendors.find(v => v.id === 'v1').email = 'new@example.test';
  await d.fn('vmgUndo')(dg);
  assert.equal(d.mem.m_vendors.find(v => v.id === 'v1').email, 'new@example.test');
  // The intake has it taken back already: the app still takes its part back.
  const e = app({ api: body => (body.action === 'vendor_unmerge' ? { __error: 'x', code: 'invalid_state' } : body.preview ? PREVIEW() : { ...PREVIEW({ preview: false }), merge_id: '33333333-3333-4333-8333-333333333333' }) });
  e.fn('vmgOpen')(['Island Fresh Produce', 'Island Fresh Produce Inc']); await flush(); await e.fn('vmgDo')();
  const eg = sent(e).at(-1).group_id;
  await e.fn('vmgUndo')(eg);
  assert.equal(e.mem.vendor_merges['g:' + eg].off, true);
  // Another refusal of the intake: nothing changes in the app.
  const f = app({ api: body => (body.action === 'vendor_unmerge' ? { __error: 'このあとの統合が同じ業者を使っています', code: 'later_merge' } : body.preview ? PREVIEW() : { ...PREVIEW({ preview: false }), merge_id: '44444444-4444-4444-8444-444444444444' }) });
  f.fn('vmgOpen')(['Island Fresh Produce', 'Island Fresh Produce Inc']); await flush(); await f.fn('vmgDo')();
  const fg = sent(f).at(-1).group_id;
  await f.fn('vmgUndo')(fg);
  assert.equal(f.mem.vendor_merges['g:' + fg].off, false);
  assert.match(f.toasts.at(-1)[0], /外していません/);
});

test('two devices merge different vendors at once: both stay (per-record merge of the shared table)', () => {
  const c = app();
  const merge = c.fn('mergeMapByTime');
  const A = { 'n:aloha meat co.': { to: 'Aloha Meats', g: 'ga', _at: 10 }, 'g:ga': { to: 'Aloha Meats', _at: 10 } };
  const B = { 'n:pacific sea food llc': { to: 'Pacific Seafood', g: 'gb', _at: 11 }, 'g:gb': { to: 'Pacific Seafood', _at: 11 }, 'n:aloha meat co.': { to: 'Aloha Meats', g: 'ga', off: true, _at: 12 } };
  const m = J(merge(A, B));
  assert.deepEqual(Object.keys(m).sort(), ['g:ga', 'g:gb', 'n:aloha meat co.', 'n:pacific sea food llc']);
  assert.equal(m['n:aloha meat co.'].off, true, 'a later “take back” wins');
  // The shared key is synced, merged per record and never freed from the device.
  assert.match(html, /'ingredient_transfers','vendor_merges','meeting_reviews'/);
  assert.match(html, /\n  vendor_merges:      \{ merge: mergeMapByTime, covers: _coversMapByTime \},/);
  assert.match(html, /\n  'vendor_merges',     \/\* v1083/);
});

test('7A: a new name close to a vendor asks “this vendor?” before saving; choosing it remembers the name for accounting (app only)', async () => {
  const c = app();
  const vEl = c.el('inv-vendor', { value: 'Island Fresh Prodce' }), warn = c.el('inv-vendor-warn');
  c.fn('checkVendorRegistered')();
  assert.match(warn.innerHTML, /似た業者があります：<\/b>Island Fresh Produce/);
  assert.match(warn.innerHTML, /綴りが少し違う/, 'found by the name (not only by the looser search)');
  assert.deepEqual(J(c.fn('vmgAskSimilar')('Island Fresh Prodce')), { name: 'Island Fresh Produce', why: 2 });
  assert.match(warn.innerHTML, /この業者にする/); assert.match(warn.innerHTML, /新しい業者として登録/);
  // Saving stops until one is chosen.
  vm.runInContext('invoiceTmpLines = [{ code: 1, name: "x", qty: 1, newPrice: 1 }]', c);
  assert.equal(c.fn('_invGather')(), null);
  assert.match(c.toasts.at(-1)[0], /似た業者があります/);
  // “Register as a new vendor”: not asked again for this name.
  c.fn('vmgNewVendorOk')();
  assert.equal(vEl.dataset.newOk, 'Island Fresh Prodce');
  assert.doesNotMatch(warn.innerHTML, /似た業者があります/);
  // “Use this vendor”: the field gets the vendor, and the typed name is remembered (accounting may merge).
  vEl.value = 'Island Fresh Prodce'; vEl.dataset.newOk = '';
  await c.fn('vmgUseVendor')('Island Fresh Prodce', 'Island Fresh Produce');
  assert.equal(vEl.value, 'Island Fresh Produce');
  const n = c.mem.vendor_merges['n:island fresh prodce'];
  assert.deepEqual([n.to, c.mem.vendor_merges['g:' + n.g].src, c.mem.vendor_merges['g:' + n.g].server], ['Island Fresh Produce', 'invoice_form', null]);
  assert.equal(c.fn('vmgAskSimilar')('Island Fresh Prodce'), null, 'known now: not asked');
  // A store crew member chooses it too, but merges nothing.
  const s = app({ role: 'crew' });
  s.el('inv-vendor', { value: 'Pacific Seafod' }); s.el('inv-vendor-warn');
  await s.fn('vmgUseVendor')('Pacific Seafod', 'Pacific Seafood');
  assert.deepEqual([s.dom['inv-vendor'].value, s.mem.vendor_merges], ['Pacific Seafood', {}]);
  // Names that are not close are not asked about; known vendors neither.
  assert.equal(c.fn('vmgAskSimilar')('Totally Different Co'), null);
  assert.equal(c.fn('vmgAskSimilar')('Aloha Meats'), null);
  assert.deepEqual(J(c.fn('vmgAskSimilar')('ALOHA MEATS LLC')), { name: 'Aloha Meats', why: 1 });
});

test('invoice intake screens: a merged vendor is not offered; the ones like the printed name come first', () => {
  const c = app();
  c._invIn.config = { vendors: [{ vendor_key: 'v1', display_name: 'Island Fresh Produce', aliases: [] }, { vendor_key: 'v2', display_name: 'Island Fresh Produce Inc', aliases: [], merged_into: 'v1' },
    { vendor_key: 'v3', display_name: 'Aloha Meats', aliases: [] }] };
  const o = c.fn('invInVendorOpts')('', 'ISLAND FRESH PRODUCE CO');
  assert.match(o, /<optgroup label="印字された名前に似た業者"><option value="v1">Island Fresh Produce<\/option><\/optgroup><optgroup label="すべての業者">/);
  assert.doesNotMatch(o, /value="v2"/);
  assert.match(c.fn('invInVendorOpts')('v2', ''), /<option value="v2" selected>Island Fresh Produce Inc（まとめた業者）<\/option>/, 'an invoice still on a merged vendor shows it');
  assert.doesNotMatch(c.fn('invInVendorOpts')('v1', 'ISLAND FRESH PRODUCE CO'), /optgroup/, 'a chosen vendor needs no suggestion');
  // The error texts of the server's new refusals.
  assert.match(html, /merged:\['この業者はほかの業者にまとめてあります/); assert.match(html, /later_merge:\['このあとの統合が同じ業者を使っています/);
});

test('names are shown as text, never as markup', async () => {
  const c = app({ cards: [...CARDS(), CARD('vx', '<img src=x onerror=alert(1)> Supply', { kind: 'food' }), CARD('vy', '<img src=x onerror=alert(1)> Supply Inc', { kind: 'food' })] });
  const h = c.fn('vmgCardHtml')();
  assert.ok(!h.includes('<img'), 'candidates');
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt; Supply/);
  assert.ok(!c.fn('vmgVendorHtml')('<img src=x> Co').includes('<img'));
  c.fn('vmgOpen')(['<img src=x onerror=alert(1)> Supply', '<img src=x onerror=alert(1)> Supply Inc']); await flush();
  assert.ok(!c.dom['vmg-modal'].innerHTML.includes('<img'), 'the merge screen');
  await c.fn('vmgDo')();
  assert.ok(c.toasts.some(x => x[1] === 'success'), 'merged');
  assert.ok(c.toasts.every(x => !x[0].includes('<img')), 'the toasts');
  // Taking it back: the screen and its button do not run what a shared record carries.
  const gid = Object.keys(c.mem.vendor_merges).find(k => k.startsWith('g:')).slice(2);
  await c.fn('vmgUndoAsk')(gid);
  assert.ok(!c.modals.at(-1).includes('<img'), 'the take-back screen');
  c.M._vmg.tab = 'rec';
  c.mem.vendor_merges = { "g:g1');alert(1);('": { to: '<img src=x> A', names: ['<img src=x> A', '<b>B</b>'], by: '<i>me</i>', at: '2026-10-15T00:00:00Z', ms: 1, _at: 1 } };
  const rec = c.fn('vmgCardHtml')();
  assert.ok(!/<img|<b>B|<i>me/.test(rec), 'the record');
  assert.ok(!/vmgUndoAsk\('g1'\);alert/.test(rec) && /vmgUndoAsk\(&quot;g1&#39;\);alert\(1\);\(&#39;&quot;\)/.test(rec), 'the id is a string, not code');
});
