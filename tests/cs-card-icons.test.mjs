// v1113 (Moto 10/29 · UI案63): "B案で作りこみます" / "強みのところの、ほか１という表記をやめたいです" /
// "専門職キャリアのアイコン良いですね、これで進めてください"; then (14:36) the growth-chart tile drops "ほか N" too ("やめます"),
// My page / the growth chart keep the folded breakdown ("そのままで良い"), and the office groups get icons ("つけてください").
//  1. the specialist sheets (経理・調理・サービス・マーケ) get one line icon and an English name per axis (before: ti-star on all 8, English = Japanese);
//     経理・調理 use the same icons as their strengths; axes, items, points and saving do not change;
//  2. the Career Score list card (B "一覧型"): every strength as an icon card (no "ほか N"), the points line, and the category breakdown
//     always visible (not folded) with icon circles — 2 columns on a PC, 1 on a phone; My page / the growth chart keep the folded breakdown.
// Runs the real code from index.html in a VM with the fictional staff of tests/cs-strengths.test.mjs and tests/karte-eval.test.mjs.
// No network, no browser storage, no production data. Display only: nothing here writes data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index = process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url).pathname;
const SRC = fs.readFileSync(index, 'utf8').replace(/\r\n/g, '\n');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const between = (a, b) => { const i = SRC.indexOf(a), j = SRC.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return SRC.slice(i, j + b.length); };
const fnSrc = name => { const i = SRC.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name); const l = SRC.slice(i + 1, SRC.indexOf('\n', i + 1)); return /\}\s*$/.test(l.replace(/\s*\/\*[^\n]*?\*\/\s*$/, '')) && (l.match(/\{/g) || []).length === (l.match(/\}/g) || []).length ? l : SRC.slice(i + 1, SRC.indexOf('\n}\n', i) + 2); };
const varBlock = (name, close) => between('\nvar ' + name + ' = ', close);
const J = x => JSON.parse(JSON.stringify(x));
const run = (c, code) => { const v = vm.runInContext(code, c); return v === undefined ? v : J(v); };
const SPEC = [varBlock('SPECIALIST_DEPTS', '\n};'), varBlock('SPECIALIST_AXIS_ITEMS', '\n};'), varBlock('SPECIALIST_AXIS_META', '\n};'), fnSrc('specialistAxisMeta'), fnSrc('specialistCats')].join('\n');

// the two existing fixtures (their code before the first test), loaded as modules with their own file location
async function fixture(file, cut, names) {
  const url = new URL('./' + file, import.meta.url).href;
  let s = fs.readFileSync(new URL(url), 'utf8').split(cut)[0];
  s = s.replace(/const file = .*?;/, 'const file = ' + JSON.stringify(index) + ';').replaceAll('import.meta.url', JSON.stringify(url));
  return import('data:text/javascript;base64,' + Buffer.from(s + '\nexport { ' + names + ' };\n').toString('base64'));
}
const S = await fixture('cs-strengths.test.mjs', "\ntest('", 'app, person, storeRec, evalOf');
const K = await fixture('karte-eval.test.mjs', "test('the fictional company", 'company');
const CSVB = between('/* FUNERGY_CS_GRADE_VIEW_BEGIN */', '/* FUNERGY_CS_GRADE_VIEW_END */');
function co() {
  const c = K.company();
  vm.runInContext(`KEV2_START = '2026-Q3';
    function bizToday(){ return '2026-09-20'; }
    function healthRing(p, col, size){ return '<ring></ring>'; }
    function ghBadge(g){ return '<badge>'+g+'</badge>'; }`, c);
  vm.runInContext(CSVB, c);
  vm.runInContext(SPEC, c);   // the real department sheets (Ray = Head Chef = 調理)
  return c;
}
// R = the strengths result of the same person (its state is the tag on the header line of the card)
const listOf = (c, id, R = null) => { c.ID = id; c.HR = R; return run(c, `(function(){ var V=csvView(EMPS.find(function(e){ return e.id===ID; })); return {pts:csvListPtsHtml(V, HR), cats:csvCatsListHtml(V), state:V.state, un:V.un}; })()`); };

// Tabler webfont 2.44.0 (the version index.html loads): each name below was checked against its tabler-icons.min.css when this was written
const TABLER_2_44 = ['list-check', 'clock-check', 'file-analytics', 'scale', 'shield-check', 'bulb', 'school', 'heart-handshake', 'clipboard-check', 'chef-hat',
  'calculator', 'tools-kitchen-2', 'chart-bar', 'heart', 'book-2', 'mood-smile', 'thumb-up', 'messages', 'adjustments', 'speakerphone', 'device-mobile',
  'target-arrow', 'palette', 'confetti', 'chart-donut', 'user-check', 'briefcase'];

test('1. specialist axes: one icon and an English name each (no ☆); 経理・調理 match their strengths; axes, items and names are unchanged', () => {
  const c = {}; vm.createContext(c);
  vm.runInContext(SPEC + '\n' + varBlock('CS_STRENGTHS', '\n];'), c);
  // the English names approved on UI案63 (Moto 10/29 "これで進めてください")
  const EN = {
    '経理': ['Accuracy', 'Deadlines', 'Financial analysis', 'Tax & compliance', 'Internal control', 'Systems & improvement', 'Developing the team', 'Philosophy (integrity)'],
    '調理': ['Hygiene & safety', 'Quality & standards', 'Menu development', 'Costing & recipes', 'Kitchen operations', 'Numbers (food cost)', 'Developing cooks', 'Food culture & philosophy'],
    'サービス': ['Service standards', 'Guest experience', 'Repeat visits & reviews', 'Voice of the customer', 'Service operations', 'Numbers (CS metrics)', 'Developing service staff', 'Hospitality & philosophy'],
    'マーケ': ['Promotion', 'Digital channels', 'Measurement & ROI', 'Brand & world', 'Planning & experiences', 'Numbers (metrics)', 'Team & development', 'Philosophy & brand consistency']
  };
  const ICON = {
    '経理': ['list-check', 'clock-check', 'file-analytics', 'scale', 'shield-check', 'bulb', 'school', 'heart-handshake'],
    '調理': ['shield-check', 'clipboard-check', 'chef-hat', 'calculator', 'tools-kitchen-2', 'chart-bar', 'school', 'heart'],
    'サービス': ['book-2', 'mood-smile', 'thumb-up', 'messages', 'adjustments', 'chart-bar', 'school', 'heart-handshake'],
    'マーケ': ['speakerphone', 'device-mobile', 'target-arrow', 'palette', 'confetti', 'chart-bar', 'school', 'heart-handshake']
  };
  const depts = run(c, 'SPECIALIST_DEPTS'), items = run(c, 'SPECIALIST_AXIS_ITEMS'), strengths = run(c, 'CS_STRENGTHS');
  assert.deepEqual(Object.keys(depts), Object.keys(EN));
  for (const d of Object.keys(EN)) {
    c.D = d;
    const cats = run(c, 'specialistCats(D)');
    assert.deepEqual(cats.map(x => x.key), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], d);
    // nothing about scoring changes: the same Japanese names and the same items (1 per axis for サービス・マーケ)
    assert.deepEqual(cats.map(x => x.name), depts[d].axes.map(a => a.n), d);
    assert.deepEqual(cats.map(x => x.items), depts[d].axes.map(a => (items[d] && items[d][a.k]) || [a.n]), d);
    assert.deepEqual(cats.map(x => x.en), EN[d], d + ' English');
    assert.deepEqual(cats.map(x => x.icon), ICON[d].map(n => 'ti-' + n), d + ' icons');
    assert.equal(new Set(cats.map(x => x.icon)).size, 8, d + ': eight different icons');
    for (const x of cats) { assert.ok(TABLER_2_44.includes(x.icon.slice(3)), x.icon); assert.match(x.en, /^[\x20-\x7e]+$/, x.en); assert.notEqual(x.icon, 'ti-star'); }
  }
  // 経理・調理: the axis icon is the icon of the strength for that axis (one picture for one area everywhere)
  for (const [d, p] of [['経理', 'AC-'], ['調理', 'CK-']]) { c.D = d; for (const x of run(c, 'specialistCats(D)')) assert.equal(x.icon, strengths.find(s => s.id === p + x.key).ic, d + ' ' + x.key); }
  assert.equal(run(c, `specialistCats('無い部門')`), null);
  assert.deepEqual(run(c, `specialistAxisMeta('無い部門', 'A')`), { icon: 'ti-point', en: '' });
  assert.doesNotMatch(fnSrc('specialistCats'), /ti-star/);
  assert.match(SRC, /@tabler\/icons-webfont@2\.44\.0\/tabler-icons\.min\.css/);
});

test('1b. the scoring tabs, the folded breakdown and the "専門職キャリアに求めるもの" card draw the axis icon', () => {
  assert.match(fnSrc('renderLssCatTabs'), /<i class="ti \$\{c\.icon\}"/);
  assert.match(fnSrc('csvCatsHtml'), /escapeHtml\(c\.icon\|\|'ti-point'\)/);
  assert.match(SRC, /<b style="color:var\(--accent\);flex-shrink:0">\$\{a\.k\}<\/b><i class="ti \$\{escapeHtml\(specialistAxisMeta\(d, a\.k\)\.icon\)\}"/);
  // csvView carries the icon and the English name of each category to the drawings
  assert.match(fnSrc('csvView'), /V\.cats\.push\(\{key:c\.key, name:c\.name, en:c\.en, icon:c\.icon,/);
});

test('2. strengths on the list card: every strength as an icon card — never "ほか N" / "+N more"', () => {
  const c = S.app();
  // everyone at 3 → every store strength (15)
  const all = {}; for (const [k, n] of Object.entries({ H: 18, A: 18, B: 18, C: 21, D: 17, E: 24, F: 12, G: 12 })) for (let i = 0; i < n; i++) all[k + i] = 3;
  S.person(c, 'top', S.storeRec(all));
  S.person(c, 'one', S.storeRec({ B0: 3, B1: 3, B2: 3, B3: 2, B4: 2 }));
  S.person(c, 'mid', S.storeRec({ B0: 3, B1: 3, B2: 3, A1: 3, A2: 3, A3: 3, G0: 3, G1: 3, G2: 3, E9: 3, D16: null }));
  S.person(c, 'flat', S.storeRec());
  const strip = id => { c.ID = id; return run(c, `cssStripHtml(EMPS.find(function(e){ return e.id===ID; }))`); };
  for (const lang of ['ja', 'en']) {
    c.curLang = lang;
    const top = S.evalOf(c, 'top').list, h = strip('top');
    assert.equal(top.length, 15);
    assert.equal((h.match(/role="listitem"/g) || []).length, 15, 'all 15 strengths, not 3');
    assert.doesNotMatch(h, /ほか|more/);
    assert.match(h, /<div role="list" aria-label="(強み|Strengths)"/);
    c.IDS = top.map(x => x[0]);
    for (const n of run(c, `IDS.map(function(id){ return cssDefName(CS_STRENGTHS.find(function(d){ return d.id===id; })); })`)) assert.ok(h.includes('>' + n.replaceAll('&', '&amp;') + '</span>'), n);
    assert.equal((h.match(/width:36px;height:36px/g) || []).length, 15, 'each card has its icon circle');
  }
  c.curLang = 'ja';
  assert.equal((strip('one').match(/role="listitem"/g) || []).length, 1);
  // partial: the strengths found so far, said so under the cards
  assert.deepEqual(S.evalOf(c, 'mid').list.length, 3);
  assert.match(strip('mid'), /<\/div><div style="font-size:11\.5px;color:var\(--muted\);margin-top:4px">現時点で確認できた強み<\/div><\/div>$/);
  // no strength → the message box as before (no empty list)
  assert.match(strip('flat'), /得意分野を確認中（決まりに当たる分野がまだありません）/);
  assert.doesNotMatch(strip('flat'), /role="list"/);
  // the old "top 3 + ほか N" is gone from this function
  assert.doesNotMatch(fnSrc('cssStripHtml'), /slice\(0, 3\)|'ほか '|more'\)/);
});

test('3. the breakdown on the list card is always open (no <details>): icon circles, bars, points, unscored counts; PC 2 columns / phone 1', () => {
  const c = co();
  for (let i = 0; i < 18; i++) c.SCORES['Ken Sample'].scores['A' + i] = 3;   // 284 → 302 (base 294)
  for (let i = 0; i < 2; i++) c.SCORES['Ken Sample'].scores['B' + i] = 3;    // → 304
  const ken = listOf(c, 'ken');
  assert.equal(ken.state, 'met');
  assert.doesNotMatch(ken.cats, /<details|<summary/);
  assert.match(ken.cats, /^<section aria-label="カテゴリー別の内訳"/);
  assert.match(ken.cats, /<span style="font-size:13px;font-weight:800">カテゴリー別の内訳<\/span><span[^>]*>8 カテゴリー・評価表の満点 420 点<\/span>/);
  assert.match(ken.cats, /<div role="list" style="display:grid;grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,340px\),1fr\)\);column-gap:24px">/);
  assert.equal((ken.cats.match(/role="listitem"/g) || []).length, 8);
  // the store categories in sheet order with their own icons (not a list of shortfalls)
  const cats = run(c, 'cscStoreCats()');
  let at = 0;
  for (const k of cats) { const i = ken.cats.indexOf('<i class="ti ' + k.icon + '"', at); assert.ok(i > at, k.key + ' ' + k.icon); at = i; }
  assert.match(ken.cats, /<span style="display:block;width:\d+(\.\d)?%;height:6px;background:var\(--accent\)"><\/span>/);
  // the points line: total / base, met and by how much
  assert.match(ken.pts, /総合点 <b[^>]*>\d+<\/b>/);
  assert.match(ken.pts, /基準点 <b[^>]*>294<\/b> 点/);
  assert.match(ken.pts, />基準達成</);
  assert.match(ken.pts, /基準点より ＋\d+ 点/);
  // in progress: the count of unscored items (the header already says 評価途中 — not a second tag), and per category
  delete c.SCORES['Ken Sample'].scores.D3; delete c.SCORES['Ken Sample'].scores.D4;
  const part = listOf(c, 'ken', { state: 'partial', un: 2 });
  assert.deepEqual([part.state, part.un], ['partial', 2]);
  assert.match(part.pts, /採点していない項目 2/);
  assert.doesNotMatch(part.pts, />評価途中</, 'the header line already says 評価途中');
  assert.doesNotMatch(listOf(c, 'ken', { state: 'few', un: 2 }).pts, />評価途中</, 'few + unscored is shown as 評価途中 on the header too');
  // the header says something else (e.g. 確認中 when the sheet changed) → the points line says 評価途中 itself
  for (const R of [{ state: 'set', un: 0 }, { state: 'done', un: 0 }, null]) assert.match(listOf(c, 'ken', R).pts, />評価途中</, JSON.stringify(R));
  assert.match(part.cats, /マーケティング<span style="display:block;font-size:10\.5px;font-weight:700;color:var\(--yellow\)">未評価 2<\/span>/);
  // not evaluated yet → no rows of zeros; office sheet → its own tab
  c.SCORES['Neo Sample'] = undefined; delete c.SCORES['Neo Sample'];
  const none = listOf(c, 'neo');
  assert.deepEqual([none.state, none.pts, none.cats], ['none', '', '']);
  c.OCS['Mia Sample'] = true;
  const off = listOf(c, 'mia');
  assert.deepEqual([off.state, off.pts, off.cats], ['office', '', '']);
  // English
  c.curLang = 'en';
  const en = listOf(c, 'ken');
  assert.match(en.cats, /Breakdown by category<\/span><span[^>]*>8 categories · sheet max 420 pt</);
  assert.match(en.cats, /not scored/);
  assert.match(en.pts, /2 items not scored yet/);
  // in progress with no base (G1 / G3 without a track): the reason is said too; one item is singular in English
  c.curLang = 'ja';
  const noBase = run(c, `csvListPtsHtml({state:'partial', un:1, score:120, max:420, bp:null, base:{why:'g1'}}, {state:'partial', un:1})`);
  assert.match(noBase, /総合点 <b[^>]*>120<\/b><\/span><span style="white-space:nowrap"> 点<\/span>/);
  assert.match(noBase, /採点していない項目 1・G1 には基準点の設定がありません/);
  c.curLang = 'en';
  assert.match(run(c, `csvListPtsHtml({state:'partial', un:1, score:120, max:420, bp:294, base:{}}, null)`), />1 item not scored yet</);
});

test('3b. a specialist (Head Chef = 調理) on the list card: the department axes with their icons and English names', () => {
  const c = co();
  const sc = {}; for (const k of 'ABCDEFGH') for (let i = 0; i < 4; i++) sc[k + i] = 2;
  c.SCORES['Ray Sample'] = { evaluator: 'GM', date: '2026/09/20', scores: sc, status: '確定' };
  const ray = listOf(c, 'ray');
  assert.equal((ray.cats.match(/role="listitem"/g) || []).length, 8);
  assert.match(ray.cats, /8 カテゴリー・評価表の満点 96 点/);
  for (const ic of ['shield-check', 'clipboard-check', 'chef-hat', 'calculator', 'tools-kitchen-2', 'chart-bar', 'school', 'heart']) assert.match(ray.cats, new RegExp('<i class="ti ti-' + ic + '"'));
  assert.doesNotMatch(ray.cats, /ti-star/);
  assert.match(ray.cats, />衛生・安全</);
  c.curLang = 'en';
  assert.match(listOf(c, 'ray').cats, />Hygiene &amp; safety</);
});

test('4. wiring: the list uses the B card; the base note once under the list; My page / the growth chart keep the folded breakdown; release 1113', () => {
  const list = SRC.slice(SRC.indexOf('// リーダー一覧（スコアカード）'), SRC.indexOf('// 履歴（スコア＋申請承認）'));
  assert.match(list, /html \+= cssStripHtml\(e, cR\) \+ csvListPtsHtml\(cV, cR\) \+ csvCatsListHtml\(cV\);/);
  assert.doesNotMatch(list, /csvCatsHtml\(cV, false\)|cssPtsLineHtml/);
  assert.equal((list.match(/csvListNoteHtml\(\)/g) || []).length, 1);
  assert.ok(list.indexOf('csvListNoteHtml()') > list.lastIndexOf('});'), 'after the loop over the leaders, not inside each card');
  assert.doesNotMatch(SRC, /function cssPtsLineHtml\(/, 'the old small points line is gone (it had no other caller)');
  // the buttons at the top of the list wrap (in English on a phone they pushed the page sideways before)
  assert.match(fnSrc('renderLeadership'), /var html = `<div class="section-header" style="flex-wrap:wrap;gap:6px;justify-content:flex-end">\n    <div style="margin-right:auto"><div class="section-title"><i class="ti ti-trending-up"/);
  // the base note is not repeated inside each card
  assert.doesNotMatch(fnSrc('csvCatsListHtml'), /基準点は今のグレード/);
  // My page and the growth chart: the folded breakdown inside "評価の内訳を見る" as before
  assert.match(fnSrc('csvMainHtml'), /csvCatsHtml\(V, opt\.openCats\)/);
  assert.match(fnSrc('csvCatsHtml'), /'<details style="margin-top:8px;border-top:1px solid var\(--border\);padding-top:6px"'\+\(open \? ' open' : ''\)/);
  // display only: none of the new drawing functions writes anything
  for (const f of ['csvListPtsHtml', 'csvCatsListHtml', 'csvListNoteHtml', 'cssStripHtml', 'specialistCats', 'specialistAxisMeta']) assert.doesNotMatch(fnSrc(f), /lsSet|opMergePush|localStorage|fetch\(/, f);
  const app = (SRC.match(/const APP_VERSION = '(\d+)';/) || [])[1], sw = (SW.match(/const SW_BUILD = '(\d+)';/) || [])[1];
  assert.ok(Number(app) >= 1113 && app === sw, 'APP_VERSION ' + app + ' / SW_BUILD ' + sw);
});

test('5. the growth-chart tile: every strength by name — no "ほか N" / "+N" (Moto 10/29 14:36 "やめます"); 3 or more in a smaller wrapping line', () => {
  const c = S.app();
  const all = {}; for (const [k, n] of Object.entries({ H: 18, A: 18, B: 18, C: 21, D: 17, E: 24, F: 12, G: 12 })) for (let i = 0; i < n; i++) all[k + i] = 3;
  S.person(c, 'top', S.storeRec(all));
  S.person(c, 'one', S.storeRec({ B0: 3, B1: 3, B2: 3, B3: 2, B4: 2 }));
  S.person(c, 'flat', S.storeRec());
  S.person(c, 'nobody');
  const tile = (id, f) => { c.ID = id; return run(c, f + `(cssEvaluate(EMPS.find(function(e){ return e.id===ID; })))`); };
  for (const lang of ['ja', 'en']) {
    c.curLang = lang;
    const names = run(c, `cssEvaluate(EMPS.find(function(e){ return e.id==='top'; })).list.map(function(x){ return cssDefShort(x.d); })`);
    assert.equal(names.length, 15);
    const sep = lang === 'en' ? ' · ' : '、';   // some short names contain 「・」 (在庫・原価), so Japanese uses 「、」 between names
    const v = tile('top', 'cssTileVal');
    assert.equal(v, names.join(sep), 'all 15 names');
    assert.doesNotMatch(v, /ほか|\+\d/);
    // each name stays on one line (no break in the middle of a name); the line can break between names
    assert.equal(tile('top', 'cssTileValHtml'), '<span style="display:block;font-size:13px;line-height:1.45">'
      + names.map((n, i) => '<span style="white-space:nowrap">' + n.replaceAll('&', '&amp;') + (i < names.length - 1 ? sep : '') + '</span>').join('<wbr>') + '</span>');
  }
  c.curLang = 'ja';
  assert.equal(tile('one', 'cssTileValHtml'), tile('one', 'cssTileVal'), 'one or two names stay in the big letters');
  // the cut is between 2 and 3 names
  S.person(c, 'two', S.storeRec({ B0: 3, B1: 3, B2: 3, A1: 3, A2: 3, A3: 3 }));
  S.person(c, 'three', S.storeRec({ B0: 3, B1: 3, B2: 3, A1: 3, A2: 3, A3: 3, G0: 3, G1: 3, G2: 3 }));
  assert.deepEqual([S.evalOf(c, 'two').list.length, S.evalOf(c, 'three').list.length], [2, 3]);
  assert.equal(tile('two', 'cssTileValHtml'), tile('two', 'cssTileVal'));
  assert.match(tile('two', 'cssTileVal'), /^[^、]+、[^、]+$/);
  assert.match(tile('three', 'cssTileValHtml'), /^<span style="display:block;font-size:13px;line-height:1\.45">(<span style="white-space:nowrap">[^<]+<\/span>(<wbr>)?){3}<\/span>$/);
  assert.equal(tile('flat', 'cssTileVal'), '確認中');
  assert.equal(tile('nobody', 'cssTileVal'), '未評価');
  assert.doesNotMatch(fnSrc('cssTileVal').replace(/\/\*[\s\S]*?\*\//g, ''), /ほか|slice\(0, 2\)/);
  // both tiles (the person view and the manager view of the growth chart) use it
  assert.equal((SRC.match(/_kTile\('Career Score', cssTileValHtml\(R\), /g) || []).length, 2);
});

test('6. office Career Score groups get the icons of UI案63 (O-A / O-F / O-G = the office strengths; O-B〜O-E = briefcase): detail tiles, plan tags, weights table', () => {
  const c = {}; vm.createContext(c);
  vm.runInContext(varBlock('OCS_GROUPS', '\n];') + '\n' + fnSrc('ocsGrpIcon') + '\n' + varBlock('CS_STRENGTHS', '\n];') + `
    function escapeHtml(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }`, c);
  const G = run(c, 'OCS_GROUPS'), str = run(c, 'CS_STRENGTHS');
  assert.deepEqual(G.map(g => [g.k, g.ic]), [['A', 'ti-user-check'], ['P', 'ti-briefcase'], ['F', 'ti-bulb'], ['G', 'ti-school']]);
  for (const k of ['A', 'F', 'G']) assert.equal(G.find(g => g.k === k).ic, str.find(d => d.id === 'OF-' + k).ic, k);
  for (const g of G) assert.ok(TABLER_2_44.includes(g.ic.slice(3)), g.ic);
  // groups, names and weights are what they were (the icon is the only new field; ocsCalc reads g.k only)
  assert.deepEqual(G.map(g => [g.k, g.ja, g.en]), [['A', 'O-A 基本姿勢', 'O-A Basics'], ['P', 'O-B〜O-E 専門実務', 'O-B–O-E Specialist work'], ['F', 'O-F 改善・標準化', 'O-F Improvement'], ['G', 'O-G 運営・育成', 'O-G Operations & development']]);
  assert.equal(run(c, `ocsGrpIcon(OCS_GROUPS[1], 14)`), '<i class="ti ti-briefcase" aria-hidden="true" style="color:var(--accent);font-size:14px"></i>');
  assert.equal(run(c, `ocsGrpIcon({}, 12)`), '<i class="ti ti-point" aria-hidden="true" style="color:var(--accent);font-size:12px"></i>');
  assert.doesNotMatch(fnSrc('ocsCalc'), /\.ic\b/);
  // where the four groups are drawn
  assert.match(fnSrc('ocsDetailHtml'), /<span style="display:flex;align-items:center;gap:4px;min-width:0">'\+ocsGrpIcon\(g, 14\)\+'<span>'\+escapeHtml\(ocsTx\(g\)\)/);
  assert.match(fnSrc('ocsAsgEditorHtml'), /font-size:10\.5px">'\+ocsGrpIcon\(g, 12\)\+' '\+escapeHtml\(ocsTx\(g\)\)/);
  assert.match(fnSrc('ocsOpenItemsModal'), /border-bottom:1px solid var\(--border\)">'\+ocsGrpIcon\(g, 12\)\+' '\+escapeHtml\(ocsTx\(g\)\)/);
  // the Office screens are drawn by the Office save-guard module (web-office-cas.<sha256>.js) from its own copies of this code:
  // every copy of the groups carries the same icons, and every group tile / plan tag there draws them (the same HTML as ocsGrpIcon)
  const ref = (SRC.match(/<script type="module" src="\.\/(web-office-cas\.[0-9a-f]{64}\.js)"><\/script>/) || [])[1];
  assert.ok(ref, 'module');
  const MOD = fs.readFileSync(process.env.FUNERGY_OFFICE_MODULE || new URL('../' + ref, import.meta.url), 'utf8');
  const copies = [...MOD.matchAll(/\n  var OCS_GROUPS = (\[[\s\S]*?\n  \]);/g)].map(m => vm.runInNewContext('(' + m[1] + ')'));
  assert.equal(copies.length, 6);
  for (const cp of copies) assert.deepEqual(J(cp), G);
  const tileNew = `<span style="display:flex;align-items:center;gap:4px;min-width:0"><i class="ti ' + escapeHtml(g && g.ic || "ti-point") + '" aria-hidden="true" style="color:var(--accent);font-size:14px"></i><span>' + escapeHtml(ocsTx(g)) + '</span></span>`;
  assert.equal(MOD.split(tileNew).length - 1, 6, 'all six group-tile copies');
  assert.equal(MOD.split(`font-weight:700"><span>' + escapeHtml(ocsTx(g)) + '</span>`).length - 1, 0, 'no copy without the icon');
  assert.equal(MOD.split(`font-size:10.5px">' + '<i class="ti ' + escapeHtml(g && g.ic || "ti-point") + '" aria-hidden="true" style="color:var(--accent);font-size:12px"></i> ' + escapeHtml(ocsTx(g)) + " <b>"`).length - 1, 1, 'plan tags');
  assert.equal(MOD.split(`font-size:10.5px">' + escapeHtml(ocsTx(g)) + " <b>"`).length - 1, 0);
});
