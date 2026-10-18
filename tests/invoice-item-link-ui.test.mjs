// 紐づけ 段階 1（アプリ v1093・Moto 2026-10-18・UI案55 決まったこと 1〜8）— the app side.
// Runs the real module from index.html (FUNERGY_ITEM_LINK) in a VM, against the real invoice-intake handler and SQL (PGlite) for the
// end-to-end part. Synthetic data only (made-up vendors, items and codes). No network, no storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { createHandler } from '../supabase/functions/invoice-intake/handler.mjs';
import { parseResponse } from '../invoice/extract.mjs';

const html = fs.readFileSync(new URL(process.env.FUNERGY_INDEX || '../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b); assert.ok(i >= 0 && j > i, a); return html.slice(i, j); };
const MOD = cut('/* FUNERGY_ITEM_LINK_BEGIN */', '/* FUNERGY_ITEM_LINK_END */');
const bodyOf = name => { let i = html.indexOf('\nfunction ' + name + '('); if (i < 0) i = html.indexOf('\nasync function ' + name + '('); assert.ok(i >= 0, name); return html.slice(i, html.indexOf('\n}', i) + 2); };
const lineOf = name => { const i = html.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name); return html.slice(i, html.indexOf('\n', i + 1)); };
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The current master (made up): codes, names in Japanese and English, vendors, the vendor's item code (sku).
const MASTER = () => [
  { code: 10003, name: 'アボカド', nameEN: 'Avocado', vendor: 'Ala Moana', unit: 'pc' },
  { code: 600084, name: '豚バラ 2mmスライス', nameEN: 'Pork Belly 2mm Sliced', vendor: 'Redondo', unit: 'g' },
  { code: 600126, name: '半切り焼のり Silver', nameEN: 'Hangiri Silver Yakinori', vendor: 'Cherry', unit: 'pc', sku: '12345' },
  { code: 600133, name: '鈴勝 うなぎ蒲焼たれ', nameEN: 'Unagi Kabayaki Tare Suzukatsu', vendor: 'Cherry', unit: 'ml' },
  { code: 50101, name: 'アボカドオイル', nameEN: 'Avocado Oil', vendor: 'Costco', unit: 'ml' },
  { code: 2005, name: 'サワークリーム', nameEN: 'Sour cream', vendor: 'ChefZone', unit: 'g' },
];
const VENDORS = () => [{ vendor_key: 'vc', display_name: 'CHERRY COMPANY, LTD.', food_kind: 'food' }, { vendor_key: 'va', display_name: 'Ala Moana Produce', food_kind: 'food' },
  { vendor_key: 'vr', display_name: "Redondo's", food_kind: 'food' }, { vendor_key: 'vz', display_name: 'Chef Zone', food_kind: 'food' },
  { vendor_key: 'vs', display_name: 'Paper Supply Co', food_kind: 'nonfood' }];
const item = (id, vendor_key, o = {}) => ({ id, vendor_key, vendor_item_code: null, alias_key: null, spec_key: '', names: [['X', 1]], specs: [], units: [['CS', 1]], n: 1, docs: 1,
  stores: ['F06'], posted: 1, review: 0, first: '2026-10-02', last: '2026-10-02', last_price: { unit_price: '10.000000', unit: 'CS', day: '2026-10-02', store_id: 'F06' },
  min_price: '10.000000', max_price: '10.000000', link: null, links: 0, applied: 0, waiting: 0, retired: [], mark: null, mark_version: null, ...o });
const ITEMS = () => [
  item('vc|c:12345', 'vc', { vendor_item_code: '12345', names: [['HANGIRI SILVER YAKINDRI 10/100p(3.5oz)', 2]], n: 2 }),
  item('vc|a:unagi kabayaki tare suzukatsu 6/60floz(1.8l)|6/60FLOZ', 'vc', { alias_key: 'unagi kabayaki tare suzukatsu 6/60floz(1.8l)', spec_key: '6/60FLOZ', names: [['UNAGI KABAYAKI TARE SUZUKATSU 6/60floz(1.8L)', 3]], n: 3 }),
  item('vr|a:#1464 rrr pork body sliced 7mm|', 'vr', { alias_key: '#1464 rrr pork body sliced 7mm', names: [['#1464 RRR Pork Belly Sliced 7mm', 2]] }),
  item('va|a:avocado, 48s usa|', 'va', { alias_key: 'avocado, 48s usa', names: [['Avocado, 48s USA', 17]], n: 17, stores: ['F01', 'F02'] }),
  item('vz|a:cream, heavy 36%|', 'vz', { alias_key: 'cream, heavy 36%', names: [['CREAM, HEAVY 36%', 1]] }),
  item('vs|c:1897217', 'vs', { vendor_item_code: '1897217', names: [['1897217 ZIPLOC GAL', 6]], n: 6 }),
];

function app({ role = 'chef', signed = true, data = null, api = null, lang = 'ja', stock = { F06: [600126, 600133, 10003], TOTOYA: [600084] } } = {}) {
  const mem = { store_ingredients: stock };
  const dom = {};
  const c = {
    calls: [], toasts: [], modals: [], renders: 0, curLang: lang, curRole: role, curPage: 'ingredient_master', window: { _ingTab: 'link' },
    escapeHtml: esc, t: (ja, en) => (c.curLang === 'en' ? en : ja),
    ls: (k, d) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : d), getIngredients: () => MASTER(),
    storesUsingIngredient: code => Object.keys(mem.store_ingredients).filter(k => mem.store_ingredients[k].includes(Number(code))),
    showToast: (m, k) => c.toasts.push([m, k]),
    openModal: h => { c.modals.push(h); }, closeModalDirect: () => {},
    renderPage: () => { c.renders++; },
    INVIN_CSS: '', INVIN_COL: { green: '#15A66A', yel: '#B7791F', red: '#D64545', blue: '#0E78C4', gray: '#7a7a72' },
    invInSigned: () => signed, invInKeepWho: () => 'e:E-CH', invInKept: () => false, _invIn: { restoring: null, restoreTried: null },
    invInStore: id => ({ name: { F01: 'ToriTon', F02: 'Tenkichi', F06: 'LaLa' }[id] || id }), invInPrice: v => '$' + Number(v).toFixed(2), invInTime: v => String(v),
    invInAPI: async body => {
      c.calls.push(JSON.parse(JSON.stringify(body)));
      if (api) { const r = await api(body, c); if (r && r.__error) { const e = new Error(r.__error); e.code = r.code || ''; throw e; } return r; }
      if (body.action === 'link_data') return data || { role, items: ITEMS(), vendors: VENDORS(), people: {}, lines: 0 };
      if (body.action === 'link_save') return { maps: body.links.map((x, i) => ({ id: 'm' + i, vendor_key: x.vendor_key })), sync: { lines: body.links.length, prices: 1 } };
      return { sync: { lines: 0 } };
    },
    document: { getElementById: k => dom[k] || null }, Promise,
    setTimeout: f => { (c.later = c.later || []).push(f); return 0; }, clearTimeout: () => {},
  };
  vm.createContext(c);
  vm.runInContext(bodyOf('invInJs') + '\n' + MOD + '\nthis.S = () => _ilk;', c);
  c.dom = dom;
  c.fn = n => vm.runInContext(n, c);
  c.run = async () => { for (let k = 0; k < 6; k++) { const l = c.later || []; c.later = []; for (const f of l) await f(); await new Promise(r => setImmediate(r)); } };
  c.page = () => c.fn('renderIngLink()');
  return c;
}
const loaded = async c => { c.page(); await c.run(); return c.page(); };

test('紐づけの画面: who sees it, and the sign-in (Head Chef and AM too)', async () => {
  for (const role of ['crew', 'sl', 'g2']) assert.match(app({ role }).page(), /経理・事務Crew・GM・CEO・Head Chef・AM 向けの画面です/);
  for (const role of ['ceo', 'gm', 'office', 'office_crew', 'am', 'chef']) assert.equal(app({ role }).fn('ilkCan()'), true, role);
  const c = app({ signed: false });
  const h = c.page();
  assert.match(h, /invInLoginModal\('link'\)/);
  assert.match(h, /経理・事務Crew・GM・CEO・Head Chef・AM/);
  assert.equal(c.calls.length, 0, 'nothing is asked of the server before the sign-in');
  // the source switch: Drive first, the app's invoices (stage 3) not yet
  const s = await loaded(app());
  assert.match(s, /Drive 取込（10\/7〜）<small>6 品目/);
  assert.match(s, /disabled[^>]*>アプリの invoice（〜10\/7）/);
});

test('紐づけの画面: suggestions by words, not by a part of a name; marks keep an item out of the bulk confirm; the bulk confirm sends one vendor\'s items', async () => {
  const c = app();
  await loaded(c);
  const P = c.fn('_ilk.prep'), st = id => c.fn(`ilkState(ilkItem(${JSON.stringify(id)}))`);
  // the Cherry items: by the item code / by the name; the nori name has a misread word and is still close
  assert.equal(P['vc|c:12345'].best.c.code, '600126');
  assert.equal(P['vc|c:12345'].cls, 'A');
  assert.equal(st('vc|c:12345'), 'high');
  assert.equal(P['vc|a:unagi kabayaki tare suzukatsu 6/60floz(1.8l)|6/60FLOZ'].best.c.code, '600133');
  // 7 mm and 2 mm: a mark (decision 4/7)
  const pork = P['vr|a:#1464 rrr pork body sliced 7mm|'];
  assert.deepEqual(JSON.parse(JSON.stringify([pork.best && pork.best.c.code, pork.flags.map(f => f.k)])), ['600084', ['num']]);
  // Avocado, 48s USA → Avocado (same vendor), never Avocado Oil (another vendor, a part of the name)
  assert.equal(P['va|a:avocado, 48s usa|'].best.c.code, '10003');
  // "CREAM, HEAVY 36%" and "Sour cream": one word only → not high confidence
  assert.notEqual(P['vz|a:cream, heavy 36%|'].cls, 'A');
  // a non-food vendor's item is left out at first (decision 6)
  assert.equal(st('vs|c:1897217'), 'out');
  // the bulk confirm: a vendor must be chosen; marked items are not in it
  let h = c.page();
  assert.match(h, /仕入先を選ぶと、その仕入先の「確かさ高」をまとめて確定できます/);
  c.fn(`ilkSet('vendor','vr')`); h = c.page();
  assert.match(h, /印の無い 0 品目を確かめて確定…/);
  c.fn(`ilkSet('vendor','vc')`);
  const bulk = c.fn('ilkBulkRows()').map(x => x.id);
  assert.deepEqual(bulk.sort(), ['vc|a:unagi kabayaki tare suzukatsu 6/60floz(1.8l)|6/60FLOZ', 'vc|c:12345'].sort());
  c.fn('ilkBulkAsk()');
  assert.match(c.modals.at(-1), /2 品目を確定/);
  c.fn(`ilkBulkTick(${JSON.stringify('vc|c:12345')}, false)`);
  // the master changes while the dialog is open (a sync): the codes shown in the dialog are sent, not new ones (review P3)
  c.fn(`_ilk.prep[${JSON.stringify('vc|a:unagi kabayaki tare suzukatsu 6/60floz(1.8l)|6/60FLOZ')}].best = { s: 1, c: { code: '999999' } }`);
  c.fn(`ilkBulkTick(${JSON.stringify('vc|c:12345')}, true)`); c.fn(`ilkBulkTick(${JSON.stringify('vc|c:12345')}, false)`);
  await c.fn('ilkBulkGo()'); await c.run();
  const save = c.calls.find(x => x.action === 'link_save');
  assert.deepEqual(save.links, [{ vendor_key: 'vc', ingredient_code: '600133', alias_key: 'unagi kabayaki tare suzukatsu 6/60floz(1.8l)', spec_key: '6/60FLOZ' }]);
  assert.ok(c.toasts.some(([m, k]) => k === 'success' && /まとめて確定しました：1 品目/.test(m)));
  assert.ok(c.calls.filter(x => x.action === 'link_data').length >= 2, 'read again after saving');
});

test('紐づけの画面: a linked item (who and when), choose again / undo; accounting\'s own mapping is not changed by a Head Chef / AM; marks with their versions', async () => {
  const linked = (o = {}) => item('va|a:avocado, 48s usa|', 'va', { alias_key: 'avocado, 48s usa', names: [['Avocado, 48s USA', 17]],
    link: { id: 'm-1', version: 4, ingredient_code: '10003', verified: true, source: 'review', verified_by: 'u-1', verified_at: '2026-10-18 09:10',
      vendor_item_code: null, alias_key: 'avocado, 48s usa', spec_key: '' }, links: 1, applied: 17, ...o });
  const data = items => ({ role: 'chef', items, vendors: VENDORS(), people: { 'u-1': 'Kai Test' } });
  let c = app({ data: data([linked()]) });
  await loaded(c);
  c.fn(`ilkSet('filter','done')`);
  let h = c.page();
  assert.match(h, /✓ 確定済み<\/span><div class="ilk-s">Kai Test · 2026-10-18 09:10/);
  assert.match(h, /<div class="ilk-en">Avocado<\/div><div class="ilk-ja">アボカド · 10003/, 'English large, Japanese small');
  c.fn(`ilkUndoAsk(${JSON.stringify('va|a:avocado, 48s usa|')})`);
  await c.fn(`ilkUndo(${JSON.stringify('va|a:avocado, 48s usa|')})`);
  assert.deepEqual(c.calls.find(x => x.action === 'link_undo').maps, [{ id: 'm-1', version: 4 }]);
  // choose again: the link is sent with its id and version
  c = app({ data: data([linked()]) });
  await loaded(c);
  c.fn(`ilkOpen(${JSON.stringify('va|a:avocado, 48s usa|')})`);
  assert.match(c.modals.at(-1), /今の紐づけ/);
  c.fn(`ilkPick('50101')`);
  await c.fn('ilkPickGo()'); await c.run();
  assert.deepEqual(c.calls.find(x => x.action === 'link_save').links, [{ vendor_key: 'va', ingredient_code: '50101', alias_key: 'avocado, 48s usa', spec_key: '', map_id: 'm-1', version: 4 }]);
  // accounting's own verified mapping: a Head Chef / AM sees it, cannot change it; accounting can
  const own = linked({ link: { id: 'm-2', version: 1, ingredient_code: '10003', verified: true, source: 'manual', verified_by: 'u-9', verified_at: 'x',
    vendor_item_code: null, alias_key: 'avocado, 48s usa', spec_key: '' } });
  for (const [role, can] of [['chef', false], ['am', false], ['office', true], ['office_crew', true]]) {
    c = app({ role, data: data([own]) });
    await loaded(c); c.fn(`ilkSet('filter','done')`); h = c.page();
    assert.equal(/ilkUndoAsk/.test(h), can, role);
    assert.equal(/経理が確かめた対応/.test(h), !can, role);
  }
  // marks: new item / left out / later carry the version the screen saw; 'included' takes a non-food vendor's item back
  c = app({ data: data([item('vz|a:x|', 'vz', { alias_key: 'x' }), item('vs|c:1897217', 'vs', { vendor_item_code: '1897217' }),
    item('va|a:y|', 'va', { alias_key: 'y', mark: { state: 'later', version: 3, by_actor: 'u-1', at: 't' } })]) });
  await loaded(c);
  await c.fn(`ilkMark('vz|a:x|','excluded')`);
  await c.fn(`ilkMark('vs|c:1897217','included')`);
  await c.fn(`ilkMark('va|a:y|','none')`);
  assert.deepEqual(c.calls.filter(x => x.action === 'link_mark').map(x => x.marks[0]), [
    { vendor_key: 'vz', state: 'excluded', version: null, alias_key: 'x', spec_key: '' },
    { vendor_key: 'vs', state: 'included', version: null, vendor_item_code: '1897217' },
    { vendor_key: 'va', state: 'none', version: 3, alias_key: 'y', spec_key: '' }]);
  // several mappings for one item: no confirm, and the dialog says accounting tidies them
  c = app({ data: data([item('va|a:z|', 'va', { alias_key: 'z', names: [['Avocado', 1]], links: 2 })]) });
  await loaded(c); c.fn(`ilkSet('filter','check')`); h = c.page();
  assert.ok(!/ilkConfirmOne/.test(h));
  c.fn(`ilkOpen('va|a:z|')`);
  assert.match(c.modals.at(-1), /対応表にこの品目の対応が複数あります/);
  assert.ok(!/ilk-pick-go/.test(c.modals.at(-1)));
  // some lines on another mapping (a store's own, or one a person chose): told, not confirmed together, and still linkable one by one
  // (those lines keep their mapping; second review P3-1)
  c = app({ data: data([item('va|a:avocado, 48s usa|', 'va', { alias_key: 'avocado, 48s usa', names: [['Avocado, 48s USA', 3]], n: 3, other_lines: 2 })]) });
  await loaded(c); h = c.page();
  assert.ok(/明細 2 行はほかの対応のまま/.test(h) && !/ilkConfirmOne/.test(h) && !/対応表に同じ品目が複数/.test(h));
  c.fn(`ilkOpen('va|a:avocado, 48s usa|')`);
  assert.ok(/ilk-pick-go/.test(c.modals.at(-1)));
  // a code item whose lines are linked by their printed name: choosing again changes that link, sent with its own key (review P3)
  const byName = item('va|c:777', 'va', { vendor_item_code: '777', names: [['Avocado, 48s USA', 3]],
    link: { id: 'm-5', version: 2, ingredient_code: '10003', verified: true, source: 'review', verified_by: 'u-1', verified_at: 't', vendor_item_code: null, alias_key: 'avocado, 48s usa', spec_key: '', by_name: true }, links: 1 });
  c = app({ data: data([byName]) });
  await loaded(c);
  c.fn(`ilkOpen('va|c:777')`);
  assert.match(c.modals.at(-1), /名前の対応で結んでいます/);
  c.fn(`ilkPick('50101')`);
  await c.fn('ilkPickGo()'); await c.run();
  assert.deepEqual(c.calls.find(x => x.action === 'link_save').links, [{ vendor_key: 'va', ingredient_code: '50101', alias_key: 'avocado, 48s usa', spec_key: '', map_id: 'm-5', version: 2 }]);
});

test('紐づけの画面: lines waiting for a link are brought in (そろえる); errors are told; the stock-list view counts per store; English', async () => {
  const waiting = item('va|a:avocado, 48s usa|', 'va', { alias_key: 'avocado, 48s usa', names: [['Avocado, 48s USA', 17]], n: 17,
    link: { id: 'm-1', version: 4, ingredient_code: '10003', verified: true, source: 'review', verified_by: 'u-1', verified_at: 't' }, links: 1, applied: 12, waiting: 5 });
  let c = app({ data: { role: 'office', items: [waiting, ...ITEMS().slice(0, 2)], vendors: VENDORS(), people: {} } });
  let h = await loaded(c);
  assert.match(h, /今の結びとそろっていない明細が <b>5<\/b> 行/);
  await c.fn('ilkSyncAll()'); await c.run();
  assert.ok(c.calls.some(x => x.action === 'link_sync'));
  // coverage: the stock lists' items (F06: 3, TOTOYA: 1) — one linked (10003), suggestions for two Cherry items
  assert.deepEqual(JSON.parse(JSON.stringify(c.fn('ilkCoverage()'))), { n: 4, linked: 1, cand: 2 });
  c.fn(`ilkSet('view','stores')`); h = c.page();
  assert.match(h, /LaLa<\/b><small>結んだ 1 ／ 3/);
  assert.match(h, /Totoya（3 店）<\/b><small>結んだ 0 ／ 1/);
  c.fn(`ilkShowCode('600126')`); h = c.page();
  assert.match(h, /に結んだ・候補の invoice の品目/);
  assert.deepEqual(c.fn('ilkFiltered()').map(x => x.id), ['vc|c:12345']);
  // errors: someone was first; a code not in the master; an account that may not link
  c = app({ api: async b => (b.action === 'link_data' ? { role: 'chef', items: ITEMS(), vendors: VENDORS(), people: {} } : { __error: 'x', code: 'conflict' }) });
  await loaded(c);
  await c.fn(`ilkConfirmOne('vc|c:12345')`); await c.run();
  assert.ok(c.toasts.some(([m, k]) => k === 'warning' && /ほかの人が先に変えていました/.test(m)));
  c = app({ api: async () => ({ __error: 'x', code: 'forbidden' }) });
  h = await loaded(c);
  assert.match(h, /このメールのアカウントは紐づけに使えません/);
  // a sign-in after that reads the screen again (the old message does not stay: review P3)
  c.fn('var _invIn = { loaded: {} }; function invInRerender(){}\n' + lineOf('invInRefresh').trim() + '\ninvInRefresh();');
  assert.equal(c.fn('_ilk.loaded'), '');
  // English: the labels follow the language
  c = app({ lang: 'en' });
  h = await loaded(c);
  assert.match(h, /Linking \(invoice items → current master\)/);
  assert.match(h, /High confidence/);
});

// Keeping the sign-in on the device (v1063) for a Head Chef / AM: their account has no manager_auth row, so the server is asked whose it is.
test('紐づけ: the sign-in is kept on the device only for the employee the Head Chef / AM account belongs to', async () => {
  const src = bodyOf('invInAccountIsMine') + '\n' + bodyOf('invInLinkIsMine');
  const run = async (rows, who) => {
    const c = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON: 'anon', INVIN_FN: '/functions/v1/invoice-intake',
      invInLoginPerson: () => ({ id: 'E-CH', name: 'Kai' }),
      invInAuthFetch: async () => ({ ok: true, json: async () => rows }),
      fetch: async (url, init) => { c.sent = JSON.parse(init.body); return who === null ? { ok: false } : { ok: true, json: async () => who }; } };
    vm.createContext(c); vm.runInContext(src, c);
    return { r: await vm.runInContext('invInAccountIsMine("tok")', c), sent: c.sent };
  };
  assert.deepEqual(await run([], { role: 'chef', emp_id: 'E-CH' }), { r: true, sent: { action: 'link_whoami' } });
  assert.equal((await run([], { role: 'am', emp_id: 'E-AM' })).r, 'other');
  assert.equal((await run([], { role: null, emp_id: null })).r, false);
  assert.equal((await run([], { role: 'chef', emp_id: '' })).r, 'noemp');
  assert.equal((await run([], null)).r, false);
  assert.equal((await run([{ emp_id: 'E-CH' }], null)).r, true, 'an accounting account: as before (manager_auth)');
  // the screens for linking: the ingredient master tab is there for the six roles only, and opens the screen
  assert.match(html, /\$\{ilkCan\(\)\?`<div class="phase-tab\$\{_ingTab==='link'\?' active':''\}" onclick="setIngTab\('link'\)">/);
  assert.match(lineOf('invInRerender'), /ilkOnPage\(\)\) renderPage\('ingredient_master'\)/);
  assert.match(bodyOf('invInReset'), /ilkReset\(\)/);
});

// ---------------------------------------------------------------- end to end: the screen against the real handler and SQL
const SQL = fs.readFileSync(new URL('../db/invoice-intake.sql', import.meta.url), 'utf8');
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
test('紐づけ: the screen against the real intake (a Head Chef links Cherry\'s high-confidence items, undoes one, marks one)', async () => {
  const pg = new PGlite();
  const U = { office: '00000000-0000-4000-8000-0000000000a2', chef: '00000000-0000-4000-8000-0000000000c1' };
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text); grant select on public.manager_auth to service_role;
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz); grant select, insert, update on public.app_state to service_role;
    create table public.ingredients(code text primary key, name text, unit text, vendor text, qty numeric, data jsonb); grant select on public.ingredients to service_role;
    create table public.employees(id text primary key, name text, role text, title text, status text, data jsonb); grant select on public.employees to service_role;
    insert into public.employees values ('E-CH','Kai Test','chef','Head Chef','在籍','{}');`);
  for (const m of MASTER()) await pg.query(`insert into public.ingredients values($1,$2,$3,$4,1,$5)`, [String(m.code), m.name, m.unit, m.vendor, JSON.stringify({ name: m.name, nameEN: m.nameEN, cat: '10000' })]);
  await pg.query(`insert into manager_auth values($1,'office','E-OF')`, [U.office]);
  await pg.exec(SQL);
  await pg.query(`insert into invoice_link_members(user_id, emp_id, role) values($1,'E-CH','chef')`, [U.chef]);
  await pg.exec(`update invoice_settings set value=value||'{"intake":true,"auto_post":false,"start_at":"2026-10-01T00:00:00Z"}' where key='mode';
    update invoice_settings set value=jsonb_build_object('key','wk-0123456789','enabled',true) where key='worker';
    update invoice_settings set value=value||'{"currency_when_absent":"USD","batch":10}' where key='rules';
    insert into invoice_stores(store_id,label,root_folder_id,upload_folder_id,active,auto_post,aliases) values ('F06','LaLa','R6','U6',true,false,'{"LaLa Izakaya"}');
    insert into invoice_vendor_rules(vendor_key,display_name,aliases,food_kind,auto_post) values ('vc','CHERRY COMPANY, LTD.','{"CHERRY CO"}','food',false),('vs','Paper Supply Co','{"PAPER SUPPLY"}','nonfood',false);`);
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const files = new Map();
  const drive = { async listFolder(f) { return { files: f === 'U6' ? [...files.values()].map(x => x.meta) : [], next: null }; }, async get(id) { return files.get(id) ? { status: 200, file: files.get(id).meta } : { status: 404 }; },
    async download(id) { return new Uint8Array(files.get(id).bytes); }, async update(id, x) { return files.get(id).meta; }, async findFolders() { return []; }, async createFolder(p, n) { return { id: 'd' + n, name: n }; }, async listNames() { return []; } };
  const fixture = { readable: true, documents: [{ doc_type: 'invoice', pages: [1], pages_marked: [], vendor_name: 'CHERRY CO', ship_to: 'LaLa Izakaya', invoice_number: '501', invoice_date_text: '10/02/2026',
    invoice_date: '2026-10-02', currency: 'USD', subtotal: '130.00', tax: '0.00', total: '130.00', references: [],
    lines: [{ page: 1, item_code: '12345', description: 'HANGIRI SILVER YAKINDRI 10/100p(3.5oz)', qty: '1', unit: 'CS', pack: '10/100P', unit_price: '40.00', amount: '40.00' },
      { page: 1, item_code: null, description: 'UNAGI KABAYAKI TARE SUZUKATSU 6/60floz(1.8L)', qty: '1', unit: 'CS', pack: '6/60FLOZ', unit_price: '90.00', amount: '90.00' }] }] };
  const bytes = Buffer.from('%PDF-1.4\nCH-1\n%%EOF');
  files.set('f1', { bytes, meta: { id: 'f1', name: 'CH-1.pdf', mimeType: 'application/pdf', parents: ['U6'], size: String(bytes.length), md5Checksum: crypto.createHash('md5').update(bytes).digest('hex'), createdTime: '2026-10-06T19:00:00Z', modifiedTime: '2026-10-06T19:00:00Z' } });
  const h = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 's', SUPABASE_ANON_KEY: 'a' })[k], db, drive,
    ai: async () => ({ ...parseResponse(JSON.stringify(fixture)), model: 'synthetic' }), now: () => Date.parse('2026-10-06T20:00:00Z'),
    fetch: async (url, init) => (String(url).endsWith('/auth/v1/user') && init.headers.authorization === 'Bearer tok-chef' ? Response.json({ id: U.chef }) : new Response('{}', { status: 401 })) });
  const call = async (body, headers) => { const r = await h(new Request('https://fn.test', { method: 'POST', headers, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  assert.equal((await call({ action: 'worker' }, { 'x-invoice-worker-key': 'wk-0123456789' })).body.ok, true);
  const c = app({ role: 'chef', api: async b => { const r = await call(b, { authorization: 'Bearer tok-chef' }); return r.status === 200 ? r.body : { __error: r.body.error, code: r.body.error }; } });
  await loaded(c);
  assert.deepEqual(c.fn('_ilk.data.items').map(i => i.id).sort(), ['vc|a:unagi kabayaki tare suzukatsu 6/60floz(1.8l)|6/60FLOZ', 'vc|c:12345']);
  c.fn(`ilkSet('vendor','vc')`);
  assert.equal(c.fn('ilkBulkRows()').length, 2);
  c.fn('ilkBulkAsk()');
  await c.fn('ilkBulkGo()'); await c.run(); await loaded(c);
  assert.ok(c.toasts.some(([m, k]) => k === 'success' && /2 品目（明細 2 行・単価の記録 0 件）/.test(m)), JSON.stringify(c.toasts));
  const maps = (await pg.query(`select vendor_item_code, alias_key, ingredient_code, verified, source, verified_by from invoice_item_maps order by ingredient_code`)).rows;
  assert.deepEqual(maps.map(m => [m.ingredient_code, m.verified, m.source, m.verified_by]), [['600126', true, 'review', U.chef], ['600133', true, 'review', U.chef]]);
  assert.deepEqual((await pg.query(`select ingredient_code from invoice_lines order by line_no`)).rows.map(r => r.ingredient_code), ['600126', '600133']);
  c.fn(`ilkSet('filter','done')`);
  assert.equal(c.fn('ilkFiltered()').length, 2);
  await c.fn(`ilkUndo('vc|c:12345')`); await c.run(); await loaded(c);
  assert.deepEqual((await pg.query(`select ingredient_code from invoice_lines order by line_no`)).rows.map(r => r.ingredient_code), [null, '600133']);
  await c.fn(`ilkMark('vc|c:12345','later')`); await c.run(); await loaded(c);
  assert.equal(c.fn(`ilkState(ilkItem('vc|c:12345'))`), 'later');
  assert.ok(!c.toasts.some(([, k]) => k === 'warning'), JSON.stringify(c.toasts));
  await pg.close();
});
