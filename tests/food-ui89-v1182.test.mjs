// v1182（UI案89・Moto さん 11/16 08:13 HST「全部Aで」）：食材管理の PC・スマホ。
// 合成データ・本番に接続しない。index.html の関数を VM で動かすか、形を確かめる。見た目は tests/e2e-pcsp/ui88-89-v1182.mjs（Chromium）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function fnSrc(name) {
  const i = HTML.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name + ' がある');
  const j = HTML.indexOf('{', i);
  let depth = 0;
  for (let k = j; k < HTML.length; k++) { const ch = HTML[k]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return HTML.slice(i, k + 1); } }
  throw new Error('関数の終わりが無い：' + name);
}
const esc = x => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const mm = w => (w == null ? null : q => { const m = q.match(/\((min|max)-width:\s*(\d+)px\)/); const v = +m[2]; return { matches: m[1] === 'min' ? w >= v : w <= v, addEventListener() {} }; });
const U9 = ['arMode', 'u9Mode', 'u9St', 'u9Page', 'u9Pager', 'u9GoPage', 'u9SetF', 'u9SetV', 'u9QMatch', 'u9SearchHtml', 'u9TilesHtml', 'u9TableHtml', 'u9Pick', 'u9SpListHtml', 'u9StoreName', 'u9Q'];
const U10 = ['u10Sig', 'u10Js', 'u10Money', 'u10Kv', 'u10Btn', 'u10Tag', 'u10Gone', 'u10Panel', 'u10Box', 'u10Head', 'u10Count',
  'u10IngOf', 'u10IngOpen', 'u10IngHtml', 'u10V2VendorOf', 'u10V2Last', 'u10V2Md', 'u10V2SpecTag', 'u10V2Of', 'u10V2Open', 'u10V2Pick', 'u10V2Html',
  'recipeHasCost', 'recipeCardHtml', 'recipeActsHtml', 'u10RecipeOf', 'u10RecipeHtml', 'u10PdId', 'u10PdDay', 'u10PdOf', 'u10PdHtml',
  'u10RcStLabel', 'u10RcStChip', 'u10RbVisible', 'u10RcTab', 'u10RcOf', 'u10RbOf', 'u10RbStChip', 'u10RcHtml', 'u10RbHtml', 'u10VmgToggle', 'vmgFoldHtml', 'u10VmOf', 'u10VmHtml'];
function ctx(width, extra = {}) {
  const renders = [], boxes = [];
  const c = { Math, Number, String, Object, Array, JSON, isNaN, isFinite, parseInt, parseFloat, console, Date, setTimeout: () => 0, clearTimeout() {},
    t: (j, e) => j, escapeHtml: esc, window: width == null ? {} : { matchMedia: mm(width) }, document: { querySelector: () => null, getElementById: () => null },
    renders, boxes, curPage: 'ingredient_master', curRole: 'gm', curStore: 'ALL', curUserName: 'Me', renderPage: p => renders.push(p),
    STORES: [{ id: 'S1', name: 'Store One' }, { id: 'S2', name: 'Store Two' }], showToast() {}, openModal(h) { boxes.push(h); },
    ingClassFilter: '', ingCatFilter: '', ingVendorFilter: '', ingMasterSearch: '',
    catClass: c => (String(c).startsWith('4') ? 'supply' : 'food'), className: x => (x === 'food' ? '食材' : '消耗品'), classColor: () => '#333', catName: c => 'Cat' + c,
    ingUnitCost: i => (Number(i.price) || 0) / (Number(i.qty) || 1), isInStoreMaster: (s, code) => code === 2, storesUsingIngredient: () => ['S1'],
    getIngredients: () => c.ING || [], getIngV2: () => c.V2 || [], v2StorePriceRange: it => it.gap || null, _v2ItemRow: it => '<div class="v2row">' + esc(it.name) + '</div>',
    calcRecipeCost: r => (r.items || []).reduce((a, x) => a + x.c, 0), recipeCostRate: r => { const cost = (r.items || []).reduce((a, x) => a + x.c, 0); return r.price ? cost / r.price * 100 : 0; },
    recipeStoreBadge: () => '', kpi: (l, v) => '<div class="kpi">' + l + ':' + v + '</div>', getRecipes: () => c.RC || [], ROLE_CONFIG: { gm: { canCreate: true, financial: true }, crew: {} },
    _pdStore: 'ALL', pdYm: () => '2026-11', _pdType: 'all', _pdVendor: '', _pdOpen: {}, vmgVendorHtml: v => esc(v), vendorCanon: v => v,
    ls: (k, d) => (k === 'invoices' ? (c.INV || d) : d), invCardHtml: inv => '<div class="card inv">' + esc(inv.vendor) + '</div>',
    getReimbursements: () => c.RB || [], reimburseScoped: () => c.RB || [], canManageReimburse: () => true, rbStatusOf: r => r.st, rbMonthsOf: () => ['2026-11'], _rbView: {},
    _rbRow: r => '<div class="rbrow">' + esc(r.payer) + '</div>', _rbStoreName: id => id, rbNotifyRejectedPaid() {},
    getVendorsVisible: () => c.VM || [], vendorCatOf: v => v.cat || 'purchase', vendorStateOf: v => v.st || 'active', vendorCatLabel: x => ({ purchase: '仕入れ', construction: '工事関係', other: '未分類' })[x],
    vmgPool: () => ({ ACME: { inv: 3, prod: 7, merged: ['ACME CO'] } }), normVendor: n => n, vmgGroups: () => [1, 2], vmgAll: () => ({ 'g:1': {}, 'g:2': { off: true } }), vmgCardHtml: () => '<div id="vmg-card"></div>', vmgCan: () => true,
    parseJaDate: s => { const m = String(s || '').match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }, ...extra };
  vm.createContext(c);
  vm.runInContext('var U9_PER = 50; var U10_RC_TARGET = 31; var U10_RC_ST = ' + HTML.match(/var U10_RC_ST = (\[[^;]*\]);/)[1] + '; var U10_RB_ST = ' + HTML.match(/var U10_RB_ST = (\{[^;]*\});/)[1] + ';\n'
    + U9.concat(U10).map(fnSrc).join('\n') + '\nfunction u9Box(title, body, foot){ boxes.push({ title, body, foot }); }', c);
  return c;
}
const ids = h => [...h.matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]);

test('1A 食材マスター（凍結中）：PC は表と右のパネル（コードの順・50 品ずつ）・自店のボタンは行を選ばない・スマホは 1 行の一覧・あいだは今の表を 50 品ずつ', () => {
  const ING = Array.from({ length: 60 }, (_, i) => ({ code: 60 - i, name: 'Item' + (60 - i), vendor: 'V', cat: '10100', price: 10, qty: 4, unit: 'lb', yield: 80 }));
  ING.push({ code: 999, name: '<b>x</b>', vendor: "O'V", cat: '40000', price: 1, qty: 1, unit: 'ea', yield: 95, nameEN: 'X' });
  let c = ctx(1440); c.ING = ING;
  let h = c.u10IngHtml(ING, 'S1');
  assert.deepEqual(ids(h).slice(0, 3), ['1', '2', '3'], 'コードの順'); assert.equal(ids(h).length, 50); assert.match(h, /1〜50/);
  assert.match(h, /onclick="event.stopPropagation\(\);toggleStoreIngredient\('2'\)">外す/, '自店のボタンは行を選ばない');
  assert.match(h, /id="u9p-ing">.*\$2\.5000/s, 'パネルに実効原価');
  assert.match(c.u10IngOf(999).acts, /openIngModal\('999'\)/); assert.ok(!c.u10IngOf(999).head.includes('<b>x</b>'));
  assert.equal(c.u10IngOf(12345), null);
  c = ctx(390); c.ING = ING; h = c.u10IngHtml(ING, null);
  assert.equal((h.match(/u9-sprow/g) || []).length, 50); assert.match(h, /onclick="u10IngOpen\(this.getAttribute\('data-u9id'\)\)"/);
  c.u10IngOpen('3'); assert.equal(c.boxes.at(-1).title, 'Item3'); assert.match(c.boxes.at(-1).foot, /openIngModal\('3'\)/);
  c = ctx(900); c.ING = ING; h = c.u10IngHtml(ING, null);
  assert.equal((h.match(/onclick="openIngModal\(/g) || []).length, 50, 'あいだは今の表（押すと編集）'); assert.ok(!/u9-tbl|u9-sprow/.test(h));
  c.u9St().pg.ing = 2; c.ingCatFilter = '20000'; c.u10IngHtml(ING, null); assert.equal(c.u9St().pg.ing, 1, '絞り込みが変われば 1 ページ目');
});

test('2A 新マスター：業者（品の多い順）→ その業者の品（仕様未入力が上）・PC は初めに 1 社目・スマホは業者の一覧から', () => {
  const V2 = [{ id: 'a', name: 'Bean', vendor: 'Small', specDone: true }, { id: 'b', name: 'Zucchini', vendor: 'Big', specDone: true, priceHistory: [{ date: '2026-11-03', price: 3 }, { date: '2026-11-10', price: 4 }], price: 4 },
    { id: 'c', name: 'Apple', vendor: 'Big', specDone: true }, { id: 'd', name: 'Kale', vendor: 'Big', specDone: false, gap: { min: 1, max: 2, pct: 50 } }];
  let c = ctx(1440); c.V2 = V2;
  let h = c.u10V2Html(V2, null);
  assert.deepEqual([...h.matchAll(/data-v="([^"]+)"/g)].map(m => m[1]), ['Big', 'Small']);
  assert.match(h, /aria-pressed="true" data-v="Big"/); assert.deepEqual(ids(h), ['d', 'c', 'b'], '仕様未入力が上・あとは名前の順');
  assert.match(h, /店舗差 1/); assert.match(c.u10V2Of('b').body, /\$4\.00<\/b> <span class="u10-mu">11-10/, '最新は日付の新しい読取');
  c.u10V2Pick('Small'); assert.equal(c.u9St().sel.v2v, 'Small'); assert.deepEqual(c.renders, ['ingredient_master']);
  c = ctx(390); c.V2 = V2; h = c.u10V2Html(V2, null);
  assert.ok(!/u9-sprow/.test(h), 'スマホは初めに業者の一覧だけ'); c.u9St().sel.v2v = 'Big'; h = c.u10V2Html(V2, null);
  assert.equal((h.match(/u9-sprow/g) || []).length, 3); assert.match(h, /u10V2Pick\(''\)">‹ 業者の一覧/);
  c = ctx(900); c.V2 = V2; c.u9St().sel.v2v = 'Big'; h = c.u10V2Html(V2, null); assert.equal((h.match(/class="v2row"/g) || []).length, 3, 'あいだは今の行');
});

test('3A 原価登録：3 つの数（目標・超えている・原価未登録）・原価未登録はいつも一番下・灰色の「原価未登録」（どの案でも直す (1)）', () => {
  const RC = [{ id: 1, name: 'Low', price: 10, items: [{ c: 2 }] }, { id: 2, name: 'Zero', price: 9, items: [] }, { id: 3, name: 'High', price: 10, items: [{ c: 5 }] }, { id: 4, name: 'Mid', price: 10, items: [{ c: 3.3 }] }];
  const c = ctx(1440); c.RC = RC;
  let h = c.u10RecipeHtml(RC, true, 'active');
  assert.match(h, />1<\/span><span class="u9-tl">目標（/); assert.match(h, />2<\/span><span class="u9-tl">目標を超えている/); assert.match(h, />1<\/span><span class="u9-tl">原価未登録/);
  assert.deepEqual(ids(h), ['3', '4', '1', '2'], '原価率が高い順・未登録は下');
  c.u9St().sort.rc = 'rate_asc'; assert.deepEqual(ids(c.u10RecipeHtml(RC, true, 'active')), ['1', '4', '3', '2'], '低い順でも未登録は下');
  c.u9St().sort.rc = 'name'; assert.deepEqual(ids(c.u10RecipeHtml(RC, true, 'active')), ['3', '1', '4', '2']);
  c.u9St().sort.rc = ''; c.u9St().f.rc = 'unreg'; assert.deepEqual(ids(c.u10RecipeHtml(RC, true, 'active')), ['2']);
  const card = c.recipeCardHtml(RC[1], true);
  assert.match(card, /tag tag-gray">原価未登録/); assert.match(card, /原価率:未登録/); assert.ok(!/原価率 0\.0%/.test(card), '0% と出さない');
  assert.match(c.recipeCardHtml(RC[2], true), /tag-red">原価率 50\.0%/);
  assert.match(c.u10RecipeOf(1).acts, /openRecipeModal\('1'\)/);
});

test('4A 仕入明細：日ごとの見出し（件数・合計）・1 件 1 行・押すと品目と画像・50 件ずつ', () => {
  const rows = [{ iso: '2026-11-10', amount: 10, sids: ['S1'], v: { id: 'x1', vendor: 'ACME', docType: 'Invoice', lines: [{ name: 'Rice', qty: 2, lineTotal: 10 }], imagePath: 'p/1.jpg' } },
    { iso: '2026-11-10', amount: 5, sids: ['S1', 'S2'], v: { id: 'x2', vendor: '', docType: 'Receipt', lines: [] } }, { iso: '2026-11-09', amount: 7, sids: ['S2'], v: { vendor: 'B' } }];
  const c = ctx(1440);
  const h = c.u10PdHtml(rows);
  assert.equal((h.match(/class="u10-grp"/g) || []).length, 2); assert.match(h, /11\/10（火）<\/span><span class="u10-mu">2 件<\/span><span class="u10-gs">\$15\.00/);
  assert.deepEqual(ids(h), ['x1', 'x2', 'i2'], 'ID の無い伝票も 1 行'); assert.match(h, /按分/);
  const o = c.u10PdOf('x1'); assert.match(o.body, /Rice/); assert.match(o.acts, /viewInvoiceImage\('p\/1.jpg'\)/); assert.match(c.u10PdOf('x2').acts, /画像なし/);
  const sp = ctx(390); assert.equal((sp.u10PdHtml(rows).match(/class="u10-spg"/g) || []).length, 2, 'スマホも日ごとの見出し');
});

test('5A レシート管理 › レシート：「レシート」と「建て替え経費」を分ける・状態で絞る・新しい順・建て替えが見えない人はタブを出さない', () => {
  const INV = [{ id: 1, vendor: 'Old', reviewStatus: '確認済み', total: 1 }, { id: 2, vendor: 'Mid', total: 2 }, { id: 3, vendor: 'New', reviewStatus: '差し戻し', total: 3 }];
  let c = ctx(1440); c.INV = INV; c.RB = [{ id: 'r1', payer: 'Pat', st: 'unpaid', amount: 12, date: '2026-11-03' }];
  let h = c.u10RcHtml(INV);
  assert.match(h, /レシート 3/); assert.match(h, /建て替え経費 1 <span class="tag tag-yellow u10-tag">未払い \$12\.00/);
  assert.deepEqual(ids(h), ['3', '2', '1'], '新しい順'); assert.match(h, /未確認 1/);
  c.u9St().f.rcs = '差し戻し'; assert.deepEqual(ids(c.u10RcHtml(INV)), ['3']);
  c.window._u10RcTab = 'rb'; h = c.u10RcHtml(INV); assert.deepEqual(ids(h), ['r1']); assert.match(h, /立て替えた人/);
  c = ctx(1440, { curRole: 'crew' }); c.INV = INV; c.RB = [{ id: 'r9', payer: 'Other', byUser: 'X', st: 'paid' }]; c.window._u10RcTab = 'rb';
  h = c.u10RcHtml(INV); assert.ok(!/建て替え経費/.test(h), '見えない人にはタブを出さない（レシートに戻す）'); assert.deepEqual(ids(h), ['3', '2', '1']);
  c = ctx(900); c.RB = [{ id: 'r1', payer: 'Pat', st: 'pending', amount: 1, date: '2026-11-01' }]; c.window._u10RcTab = 'rb';
  assert.match(c.u10RcHtml([]), /class="rbrow">Pat/, 'あいだは今の行');
});

test('6A 業者マスター：1 行 1 社の表・業者の統合は上で 1 行にたたむ（候補と記録の数）・工事関係業者は分類ごと・名前で探す', () => {
  const VM = [{ id: 'v1', name: 'ACME', cat: 'purchase', method: 'LINE', rating: 4 }, { id: 'v2', name: 'Bolt', cat: 'construction', cgroup: 'Electric', w9: '必要' },
    { id: 'v3', name: 'Pipe', cat: 'construction', cgroup: 'Plumbing' }, { id: 'v4', name: 'Amp', cat: 'construction', cgroup: 'Electric' }];
  const c = ctx(1440); c.VM = VM;
  const fold = c.vmgFoldHtml();
  assert.match(fold, /候補 2/); assert.match(fold, /統合の記録 1/); assert.ok(!/vmg-card/.test(fold), '初めはたたむ');
  c.u10VmgToggle(); assert.match(c.vmgFoldHtml(), /id="vmg-card"/); assert.deepEqual(c.renders, ['vendor_master']);
  let h = c.u10VmHtml(VM.filter(v => v.cat === 'construction'), 'construction', () => '');
  assert.equal((h.match(/class="u10-grp"/g) || []).length, 2); assert.deepEqual(ids(h), ['v2', 'v4', 'v3'], '分類ごと（最初に出た順）');
  assert.match(h, /W9必要/);
  h = c.u10VmHtml(VM, 'all', () => ''); assert.match(h, /<td class="num">3<\/td><td class="num">7<\/td>/, '請求書・商品の数');
  c.u9St().q.vm = 'am'; assert.deepEqual(ids(c.u10VmHtml(VM, 'all', () => '')), ['v4']);
  assert.match(c.u10VmOf('v1').body, /ACME CO/, 'まとめた名前'); assert.match(c.u10VmOf('v1').acts, /deleteVendor\('v1'\)/);
});

test('形：画面のつなぎ・幅をまたいだら描き直す・メニュー別は 50 品ずつ', () => {
  assert.match(fnSrc('uiPcWatch1179'), /'ingredient_master', 'recipe', 'purchase_detail', 'invoice', 'vendor_master', 'menu'/);
  assert.match(HTML, /if \(typeof u10IngHtml === 'function'\) html \+= u10IngHtml\(list, ingStore\);/);
  assert.ok(HTML.includes("if (typeof u10RcHtml === 'function') { try { if (typeof uiPcWatch1179 === 'function') uiPcWatch1179(); } catch (e) {} return html + u10RcHtml(receipts); }"));
  assert.match(HTML, /u10Sig\('mn', \[s\.store, s\.per, s\.from, s\.to, s\.kind, s\.cat, s\.chip, s\.sort, s\.q\]\.join\('\|'\)\); mnP = u9Page\('mn', all\);/);
  assert.match(HTML, /\} else if \(typeof u10VmHtml === 'function'\) \{/);
});
