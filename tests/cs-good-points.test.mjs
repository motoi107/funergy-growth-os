// v1114 (Moto 10/29 16:00 HST "強みがない人が数人います" / "突出した良いところでなければ、バランサーなど、その人の良いところが
// クローズアップされる評価に見えるようにしてください" · UI案64, answers: Balancer at two thirds or more, show "この人の中で高い",
// "伸び盛り" only for people with no strength, the same orange as strengths):
//  people with no area that meets the strength rule get "良いところ" instead of "得意分野を確認中" — on the list card, the growth-chart
//  tile and the profile (My page, the Career Score screen, the growth chart). People with strengths are unchanged. Display only.
// Runs the real code from index.html (the FUNERGY_CS_STRENGTH block) with the fictional staff of tests/cs-strengths.test.mjs.
// No network, no browser storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index = process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url).pathname;
const SRC = fs.readFileSync(index, 'utf8').replace(/\r\n/g, '\n');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const between = (a, b) => { const i = SRC.indexOf(a), j = SRC.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return SRC.slice(i, j + b.length); };
const fnSrc = name => { const i = SRC.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name); const l = SRC.slice(i + 1, SRC.indexOf('\n', i + 1)); return /\}\s*$/.test(l.replace(/\s*\/\*[^\n]*?\*\/\s*$/, '')) && (l.match(/\{/g) || []).length === (l.match(/\}/g) || []).length ? l : SRC.slice(i + 1, SRC.indexOf('\n}\n', i) + 2); };
const J = x => JSON.parse(JSON.stringify(x));
const run = (c, code) => { const v = vm.runInContext(code, c); return v === undefined ? v : J(v); };
const CSS = between('/* FUNERGY_CS_STRENGTH_BEGIN */', '/* FUNERGY_CS_STRENGTH_END */');

async function fixture(file, cut, names) {
  const url = new URL('./' + file, import.meta.url).href;
  let s = fs.readFileSync(new URL(url), 'utf8').split(cut)[0];
  s = s.replaceAll('import.meta.url', JSON.stringify(url));
  return import('data:text/javascript;base64,' + Buffer.from(s + '\nexport { ' + names + ' };\n').toString('base64'));
}
const S = await fixture('cs-strengths.test.mjs', "\ntest('", 'app, person, storeRec');

function app() {
  const c = S.app();
  vm.runInContext(`function lssCatsForName(n){ return lssCatsOrdered(); }`, c);   // the store sheet (cssUnOf)
  return c;
}
// the evidence items of each store strength (from the real table)
const groups = c => Object.fromEntries(run(c, `CS_STRENGTHS.filter(function(d){ return d.sh==='store'; }).map(function(d){ return [d.id, d.it]; })`));
// a store record: every item at 2, then `set` (strength id → values for its evidence items, in order), then a 1 in the first item of `low`
function rec(c, set = {}, low = []) {
  const G = groups(c), over = {};
  for (const id of low) over[G[id][0]] = 1;
  for (const [id, vals] of Object.entries(set)) G[id].forEach((it, i) => { over[it] = vals[i]; });
  return S.storeRec(over);
}
const ALL = c => Object.keys(groups(c));
const good = (c, id) => { c.ID = id; return run(c, `(function(){ var R=cssEvaluate(EMPS.find(function(e){ return e.id===ID; })); return {state:R.state, strengths:R.list.map(function(x){ return x.d.id; }),
  good:R.good && {list:R.good.list.map(function(x){ return [x.d.id, x.kind, x.need]; }), types:R.good.types, ok:R.good.ok, judged:R.good.judged}}; })()`); };
const html = (c, id, opt = '{}') => { c.ID = id; return run(c, `cssProfileHtml(EMPS.find(function(e){ return e.id===ID; }), ${opt})`); };
const strip = (c, id) => { c.ID = id; return run(c, `cssStripHtml(EMPS.find(function(e){ return e.id===ID; }))`); };
const tile = (c, id, f = 'cssTileValHtml') => { c.ID = id; return run(c, `${f}(cssEvaluate(EMPS.find(function(e){ return e.id===ID; })))`); };
const hist = (c, name, h) => { c.STORE.lss_history = (c.STORE.lss_history || []).concat([Object.assign({ name, pct: 0, by: 'GM Sample', date: '2026/10/20' }, h)]); };

test('UI案64 Aiko: no strength, all at 2 or above in 12 of 15 areas → Balancer; three "もう少しで強み" areas with what is missing', () => {
  const c = app();
  S.person(c, 'aiko', rec(c, { S1: [3, 3, 2, 2, 2], S5: [3, 3, 2, 2, 2], S7: [3, 2, 2, 2, 2] }, ['S11', 'S12', 'S13']));
  const R = good(c, 'aiko');
  assert.deepEqual(R.strengths, [], 'the strength rule is unchanged: 2 of 5 at 3 is not half');
  // near first (fewest 3s missing, then the table order), at most 3
  assert.deepEqual(R.good.list, [['S1', 'near', 1], ['S5', 'near', 1], ['S7', 'near', 2]]);
  assert.deepEqual([R.good.ok, R.good.judged], [12, 15]);
  assert.deepEqual(R.good.types.map(x => [x.k, x.ok, x.judged]), [['bal', 12, 15]]);
  const h = html(c, 'aiko', '{self:true}');
  assert.match(h, /aria-label="あなたの良いところ"/);
  assert.match(h, />あなたのタイプ<\/div><div[^>]*>バランサー<\/div><p[^>]*>幅広い分野を安定してこなせる、チームの土台になる人<\/p><div[^>]*>15 分野のうち 12 分野で、すべての項目が 2（継続してできる）以上<\/div>/);
  assert.match(h, /<i class="ti ti-chart-radar"/);
  assert.match(h, />とくに光っているところ</);
  assert.equal((h.split('<template')[0].match(/aria-pressed=/g) || []).length, 3);
  assert.match(h, /aria-pressed="true"[^>]*min-height:118px[\s\S]*?>お客様対応<\/span><span[^>]*color:#b4501a">もう少しで強み<\/span><\/button>/);
  // the evidence of the selected area, and what would make it a strength
  const live = h.slice(h.indexOf('-ev" aria-live="polite"'), h.indexOf('<template'));
  assert.match(live, /<b[^>]*>お客様対応<\/b><span[^>]*>もう少しで強み<\/span>/);
  assert.match(live, /3（模範）があと 1 つで、「お客様対応」が強みになります/);
  assert.match(live, /5 項目すべて 2 以上・3 が 2 つ/);
  assert.match(h, /<template id="cssp\d+-t-S7">[\s\S]*?3（模範）があと 2 つで、「品質・衛生管理」が強みになります/);
  // with a Balancer the banner carries the sentence (no second sentence under the cards)
  assert.doesNotMatch(h, /もう少しで強みになる人/);
  assert.match(h, /強みの決まりに届く分野がまだ無いので、良いところを出しています。表示だけで、点・基準点・賞与・昇格は変わりません。/);
  for (const m of h.matchAll(/min-height:(\d+)px/g)) assert.ok(+m[1] >= 44, m[0]);
  // the list card: the label, the type pill and the three areas with their wording (not the strength cards)
  const s = strip(c, 'aiko');
  assert.match(s, /^<div style="margin-top:10px;[^"]*"><div[^>]*><span style="[^"]*color:#b4501a">良いところ<\/span><span role="list" aria-label="タイプ"[^>]*><span role="listitem" style="[^"]*background:#b4501a;color:#fff[^"]*">[\s\S]*?ti-chart-radar[\s\S]*?>バランサー<\/span><span[^>]*>幅広い分野で安定（12 \/ 15 分野）<\/span>/);
  assert.match(s, /<div role="list" aria-label="良いところ"/);
  assert.match(s, /<span style="font-size:13px;font-weight:800;white-space:nowrap;flex:0 0 auto">バランサー<\/span>/, 'the type name never breaks on a phone (only its explanation wraps)');
  assert.equal((s.match(/>もう少しで強み・あと 1</g) || []).length, 2);
  assert.match(s, />品質・衛生管理<\/span><span[^>]*>もう少しで強み・あと 2</);
  assert.doesNotMatch(s, /得意分野を確認中|ほか/);
  // the growth-chart tile: the type in the big letters, the wording and the areas in the small line
  assert.equal(tile(c, 'aiko', 'cssTileVal'), 'バランサー');
  assert.equal(tile(c, 'aiko'), 'バランサー<span style="display:block;font-size:11px;font-weight:700;line-height:1.45;margin-top:3px;color:#b4501a">もう少しで強み：接客、段取り</span>');
  // English
  c.curLang = 'en';
  const he = html(c, 'aiko', '{self:true}');
  assert.match(he, /aria-label="Your good points"/);
  assert.match(he, />Your type<\/div><div[^>]*>Balancer<\/div><p[^>]*>Steady across a wide range of areas — a foundation for the team<\/p><div[^>]*>All items at 2 \(consistently\) or above in 12 of 15 areas</);
  assert.match(he, />Where you shine</);
  assert.match(he, /1 more at 3 \(role model\) and &quot;Guest service&quot; becomes a strength/);
  assert.match(strip(c, 'aiko'), />Almost a strength · 1 more at 3</);
  assert.equal(tile(c, 'aiko', 'cssTileVal'), 'Balancer');
  assert.match(tile(c, 'aiko'), /Almost a strength: guest service · preparation</);
  // both types: the Balancer leads the banner, 伸び盛り is one line under it; two pills on the card; both in the tile's small line
  c.curLang = 'ja';
  hist(c, 'aiko Sample', { ts: 1, score: 282, prevScore: 270, max: 420, prevMax: 420, un: 0, prevUn: 0 });
  assert.deepEqual(good(c, 'aiko').good.types.map(x => x.k), ['bal', 'grow']);
  assert.match(html(c, 'aiko'), />バランサー<\/div>[\s\S]*?<\/div><\/div><div style="display:flex;align-items:center;gap:10px;border-top[^"]*"><span[^>]*><i class="ti ti-trending-up"[^>]*><\/i><\/span><span[^>]*><b>伸び盛り<\/b> 前回の評価から ＋12 点<\/span><\/div><\/div>/);
  assert.equal((strip(c, 'aiko').match(/background:#b4501a;color:#fff/g) || []).length, 2);
  assert.match(tile(c, 'aiko'), />もう少しで強み：接客、段取り ・ <span style="white-space:nowrap">伸び盛り ＋12 点<\/span><\/span>$/);
});

test('UI案64 Daniel: no Balancer (3 of 15); "伸び盛り" from the history; one "もう少しで強み" then "安定してできる"', () => {
  const c = app();
  const all = ALL(c);
  S.person(c, 'dan', rec(c, { S6: [3, 3, 2, 2, 2] }, all.filter(x => !['S6', 'S7', 'S10'].includes(x))));
  hist(c, 'dan Sample', { ts: 1, score: 230, prevScore: 200, max: 420, prevMax: 420, un: 0, prevUn: 0, date: '2026/07/20' });
  hist(c, 'dan Sample', { ts: 2, score: 238, prevScore: 220, max: 420, prevMax: 420, un: 0, prevUn: 0, date: '2026/10/20' });
  const R = good(c, 'dan');
  assert.deepEqual(R.good.list, [['S6', 'near', 1], ['S7', 'steady', 3], ['S10', 'steady', 2]]);
  assert.deepEqual(R.good.types, [{ k: 'grow', d: 18, date: '2026/10/20', score: 238, prev: 220, max: 420 }]);
  const h = html(c, 'dan');
  assert.match(h, /aria-label="良いところ"/);
  assert.match(h, /<i class="ti ti-trending-up" style="font-size:28px"><\/i><\/span><div[^>]*><div[^>]*>タイプ<\/div><div[^>]*>伸び盛り<\/div><p[^>]*>前回の評価から、総合点が ＋18 点上がっている人<\/p><div[^>]*>Career Score の履歴で前回の評価と比べています（220 → 238 点・2026\/10\/20）<\/div>/);
  assert.match(h, /<p style="margin:0;font-size:15px;font-weight:800;line-height:1\.5">仕込みが、もう少しで強みになる人<\/p>/);
  assert.match(h, /<template id="cssp\d+-t-S7">[\s\S]*?>安定してできる<[\s\S]*?3（模範）が 3 つになると、「品質・衛生管理」が強みになります[\s\S]*?5 項目すべて 2 以上</);
  assert.doesNotMatch(h, /3 が 0 つ/, 'no "0 at 3" wording');
  assert.match(strip(c, 'dan'), />伸び盛り<\/span><span[^>]*>前回の評価から ＋18 点<\/span>/);
  assert.match(strip(c, 'dan'), />品質・衛生管理<\/span><span[^>]*>安定してできる<\/span>/);
  assert.equal(tile(c, 'dan'), '<span style="white-space:nowrap">仕込み</span><span style="display:block;font-size:11px;font-weight:700;line-height:1.45;margin-top:3px;color:#b4501a">もう少しで強み ・ <span style="white-space:nowrap">伸び盛り ＋18 点</span></span>');   // names and 伸び盛り ＋N never break inside
  c.curLang = 'en';
  assert.match(html(c, 'dan'), />On the rise<\/div><p[^>]*>Total score up \+18 pt since the last evaluation</);
  assert.match(html(c, 'dan'), />Almost a strength in prep work</);
});

test('UI案64 Mei: nothing at 2 everywhere → "この人の中で高い" (the two areas above the rest), with how many items are below 2', () => {
  const c = app();
  S.person(c, 'mei', rec(c, { S1: [3, 3, 2, 2, 1], S10: [3, 2, 2, 1] }, ALL(c).filter(x => !['S1', 'S10'].includes(x))));
  hist(c, 'mei Sample', { ts: 5, score: 205, prevScore: 181, max: 420, prevMax: 420, un: 0, prevUn: 0 });
  const R = good(c, 'mei');
  assert.deepEqual([R.good.ok, R.good.list], [0, [['S1', 'rel', 1], ['S10', 'rel', 1]]]);
  assert.deepEqual(R.good.types.map(x => [x.k, x.d]), [['grow', 24]]);
  const h = html(c, 'mei');
  assert.match(h, />接客とチームワークが、この人の中でいちばん得意なところ</);
  assert.match(html(c, 'mei', '{self:true}'), />接客とチームワークが、あなたの中でいちばん得意なところ</);
  assert.match(html(c, 'mei', '{self:true}'), />あなたの中で高い</);
  assert.match(h, /2（継続してできる）に届いていない項目があと 1 つ。すべて 2 以上になると「安定してできる」になります/);
  assert.match(h, /5 項目のうち 2 以上が 4 つ・3 が 2 つ/);
  assert.match(strip(c, 'mei'), />この人の中で高い・あと 1 項目で安定</);
  assert.equal(tile(c, 'mei'), '<span style="white-space:nowrap">接客、</span><wbr><span style="white-space:nowrap">チームワーク</span><span style="display:block;font-size:11px;font-weight:700;line-height:1.45;margin-top:3px;color:#b4501a">この人の中で高い ・ <span style="white-space:nowrap">伸び盛り ＋24 点</span></span>');
  assert.equal(tile(c, 'mei', 'cssTileVal'), '接客、チームワーク');
  c.curLang = 'en';
  assert.match(strip(c, 'mei'), />Their best area · 1 item to steady</);
  assert.match(html(c, 'mei'), />Strongest in guest service and teamwork</);
  // all areas the same → nothing stands out → no "この人の中で高い" (and no type) → 得意分野を確認中 as before
  c.curLang = 'ja';
  const flat1 = {}; for (const [k, n] of Object.entries({ H: 18, A: 18, B: 18, C: 21, D: 17, E: 24, F: 12, G: 12 })) for (let i = 0; i < n; i++) flat1[k + i] = 1;
  S.person(c, 'ones', S.storeRec(flat1));
  assert.deepEqual(good(c, 'ones').good, { list: [], types: [], ok: 0, judged: 15 });
  assert.match(html(c, 'ones'), /得意分野を確認中/);
  assert.match(strip(c, 'ones'), /得意分野を確認中（決まりに当たる分野がまだありません）/);
  assert.equal(tile(c, 'ones', 'cssTileVal'), '確認中');
  // one area higher than the rest but with nothing at 2 → not "the best area" (it has to have something at 2 or above)
  const zero = {}; for (const [k, n] of Object.entries({ H: 18, A: 18, B: 18, C: 21, D: 17, E: 24, F: 12, G: 12 })) for (let i = 0; i < n; i++) zero[k + i] = 0;
  for (const it of groups(c).S1) zero[it] = 1;
  S.person(c, 'zero', S.storeRec(zero));
  assert.deepEqual(good(c, 'zero').good.list, []);
  // every area at the same average (one 3 and one 1 in each) → nothing stands out → no "この人の中で高い"
  const G = groups(c), even = {};
  for (const id of ALL(c)) { even[G[id][0]] = 3; even[G[id][1]] = 1; }
  S.person(c, 'even', S.storeRec(even));
  assert.deepEqual(good(c, 'even').good.list, []);
  // complete, nothing stands out, but 伸び盛り → the banner and the "complete" wording (not "as the evaluation progresses"; review P3-5)
  hist(c, 'even Sample', { ts: 7, score: 210, prevScore: 200, max: 420, prevMax: 420, un: 0, prevUn: 0 });
  const he = html(c, 'even');
  assert.match(he, />伸び盛り</);
  assert.match(he, /評価はそろっています。分野ごとに出せる良いところは、まだありません（ほかの分野より平均が高い分野がありません）。/);
  assert.doesNotMatch(he, /評価が進むと出ます/);
  // ties are not broken by the table order (review P3-3): three areas share the top average → none; one on top and two tied for second → only the top
  const tie = rec(c, { S2: [3, 1, 2, 1], S3: [3, 1, 2, 1], S10: [3, 1, 2, 1] }, ALL(c).filter(x => !['S2', 'S3', 'S10'].includes(x)).map(x => x));
  for (const id of ALL(c).filter(x => !['S2', 'S3', 'S10'].includes(x))) for (const it of G[id]) tie.scores[it] = (it === G[id][0]) ? 2 : 1;
  S.person(c, 'tie', tie);
  assert.deepEqual(good(c, 'tie').good.list, []);
  tie.scores[G.S10[3]] = 2;   // S10 now 2.0, S2 and S3 still 1.75 together
  c.SCORES['tie Sample'] = tie;
  assert.deepEqual(good(c, 'tie').good.list, [['S10', 'rel', 1]]);
  // only two areas judged so far, at the same average → neither is "higher than the others"
  const two = {}; for (const id of ALL(c)) for (const it of G[id]) two[it] = null;
  for (const id of ['S1', 'S2']) G[id].forEach((it, i) => { two[it] = i === 0 ? 3 : (i === 1 ? 1 : 2); });
  two[G.S1[4]] = 2;   // S1: 3,1,2,2,2 (2.0) / S2: 3,1,2,2 (2.0)
  S.person(c, 'two', S.storeRec(two));
  assert.deepEqual([good(c, 'two').state, good(c, 'two').good.judged, good(c, 'two').good.list], ['partial', 2, []]);
  // the person's own tile says あなた (review P3-4)
  c.ID = 'mei'; assert.match(run(c, `cssTileValHtml(cssEvaluate(EMPS.find(function(e){ return e.id===ID; })), true)`), />あなたの中で高い ・ /);
  assert.match(fnSrc('renderKarteSelfView'), /_kTile\('Career Score', cssTileValHtml\(R, true\)/);
  assert.match(fnSrc('kdTilesHtml'), /_kTile\('Career Score', cssTileValHtml\(R\), /);
});

test('people with a strength are unchanged: no good points, no type, the strength profile as before', () => {
  const c = app();
  S.person(c, 'hana', rec(c, { S1: [3, 3, 3, 2, 2] }));
  hist(c, 'hana Sample', { ts: 1, score: 300, prevScore: 250, max: 420, prevMax: 420, un: 0, prevUn: 0 });
  const R = good(c, 'hana');
  assert.deepEqual([R.strengths, R.good], [['S1'], null], '伸び盛り only for people with no strength');
  const h = html(c, 'hana');
  assert.match(h, /aria-label="強み"/);
  assert.doesNotMatch(h, /良いところ|伸び盛り|バランサー|タイプ/);
  assert.doesNotMatch(strip(c, 'hana'), /良いところ|伸び盛り/);
  assert.equal(tile(c, 'hana', 'cssTileVal'), '接客');
});

test('unscored areas are never used (no 0, no guess); the partial wording; Balancer needs 3 judged areas', () => {
  const c = app();
  const G = groups(c), un = {};
  for (const id of ALL(c).slice(2)) un[G[id][0]] = null;   // only S1 and S2 fully scored
  S.person(c, 'p2', S.storeRec(Object.assign({}, un, { [G.S1[0]]: 3 })));
  let R = good(c, 'p2');
  assert.equal(R.state, 'partial');
  assert.deepEqual([R.good.list, R.good.types, R.good.judged], [[['S1', 'near', 2], ['S2', 'steady', 2]], [], 2], 'only 2 areas judged → no Balancer');
  const h = html(c, 'p2');
  assert.match(h, />評価途中</);
  assert.match(h, />現時点で確認できている良いところ</);
  assert.match(h, />現時点では、接客が、もう少しで強みになる人</);
  assert.match(h, /採点していない項目が 13 あります/);
  assert.match(strip(c, 'p2'), /現時点で確認できた良いところ（採点していない項目 13）/);
  // three judged areas, all at 2 or above → Balancer "of the areas fully scored"
  const un2 = {}; for (const id of ALL(c).slice(3)) un2[G[id][0]] = null;
  S.person(c, 'p3', S.storeRec(un2));
  R = good(c, 'p3');
  assert.deepEqual(R.good.types.map(x => [x.k, x.ok, x.judged]), [['bal', 3, 3]]);
  assert.match(html(c, 'p3'), /3 分野のうち 3 分野で、すべての項目が 2（継続してできる）以上（採点が終わった分野のうち）/);
  assert.match(strip(c, 'p3'), />幅広い分野で安定（3 \/ 3 分野・採点が終わった分野のうち）</);
  c.curLang = 'en'; assert.match(strip(c, 'p3'), />Steady across many areas \(3 of 3 scored so far\)</); c.curLang = 'ja';
  // nothing judged yet → no good points (the old message)
  const un3 = {}; for (const id of ALL(c)) un3[G[id][0]] = null;
  S.person(c, 'p0', S.storeRec(un3));
  assert.equal(good(c, 'p0').good.list.length + good(c, 'p0').good.types.length, 0);
  assert.match(html(c, 'p0'), /得意分野を確認中/);
});

test('伸び盛り: the latest history entry only; same maximum; both evaluations with no unscored items (recorded from v1114); up only', () => {
  const c = app();
  S.person(c, 'g', rec(c, {}, ALL(c)));   // no ok area (a 1 everywhere)
  const types = () => good(c, 'g').good.types;
  const set = h => { c.STORE.lss_history = [Object.assign({ name: 'g Sample', ts: 1, score: 220, prevScore: 200, max: 420, prevMax: 420, un: 0, prevUn: 0 }, h)]; };
  set({}); assert.deepEqual(types().map(x => x.d), [20]);
  set({ score: 218.5 }); assert.deepEqual(types().map(x => x.d), [18.5]);
  set({ un: undefined, prevUn: undefined }); assert.deepEqual(types(), [], 'an entry from before v1114 (no unscored counts) is not compared');
  set({ prevUn: 4 }); assert.deepEqual(types(), [], 'the previous evaluation was in progress (filling in items is not growth)');
  set({ un: 2 }); assert.deepEqual(types(), []);
  set({ prevMax: 225 }); assert.deepEqual(types(), [], 'a different sheet');
  set({ score: 200 }); assert.deepEqual(types(), [], 'not up');
  set({ score: 190 }); assert.deepEqual(types(), []);
  set({ prevScore: null }); assert.deepEqual(types(), [], 'the first evaluation');
  // a save that changes no points (a comment fix) is not "the previous evaluation" (review P3-1)
  c.STORE.lss_history = [{ name: 'g Sample', ts: 1, score: 220, prevScore: 200, max: 420, prevMax: 420, un: 0, prevUn: 0 }, { name: 'g Sample', ts: 2, score: 220, prevScore: 220, max: 420, prevMax: 420, un: 0, prevUn: 0 }];
  assert.deepEqual(types().map(x => x.d), [20]);
  // the latest entry (by time) decides, wherever it is in the list
  c.STORE.lss_history = [{ name: 'g Sample', ts: 9, score: 200, prevScore: 210, max: 420, prevMax: 420, un: 0, prevUn: 0 }, { name: 'g Sample', ts: 3, score: 250, prevScore: 200, max: 420, prevMax: 420, un: 0, prevUn: 0 }, { name: 'other Sample', ts: 10, score: 300, prevScore: 100, max: 420, prevMax: 420, un: 0, prevUn: 0 }];
  assert.deepEqual(types(), []);
  // turned off by the rule
  set({}); c.STORE.cs_strength_rule = { rule: { minItems: 3, top: 'half', grow: false, _at: 5 } };
  assert.deepEqual(types(), []);
});

test('the office sheet: good points by category; Balancer; never 伸び盛り (its history is separate)', () => {
  const c = app();
  S.person(c, 'off', null, { title: 'Office Crew' });
  c.OFFICE['off Sample'] = true;
  const asg = {}, s = {};
  for (const cat of 'ABCDEFG') for (let i = 1; i <= 5; i++) { asg['O-' + cat + i] = { scored: true, role: 'own' }; s['O-' + cat + i] = 2; }
  s['O-A1'] = 3; s['O-A2'] = 3;
  c.OCSEV.off = { period: '2026-Q3', conf: { state: 'confirmed', s, at: '2026-10-05T01:00:00Z', by: 'GM Sample' }, meta: { asg, weights: { A: 20, P: 60, F: 20, G: 0 } } };
  hist(c, 'off Sample', { ts: 1, score: 300, prevScore: 200, max: 420, prevMax: 420, un: 0, prevUn: 0 });
  const R = good(c, 'off');
  assert.deepEqual(R.strengths, []);
  assert.deepEqual(R.good.list, [['OF-A', 'near', 1], ['OF-B', 'steady', 3], ['OF-C', 'steady', 3]]);
  assert.deepEqual(R.good.types.map(x => [x.k, x.ok, x.judged]), [['bal', 6, 6]], 'the weight-0 group (G) is not judged; no 伸び盛り');
});

test('the rule (GM/CEO): turn the good points off; the Balancer share; 伸び盛り; old records read as the defaults; saved and read back', () => {
  const c = app();
  S.person(c, 'aiko', rec(c, { S1: [3, 3, 2, 2, 2] }, ['S11', 'S12', 'S13', 'S14', 'S15', 'S9', 'S3']));   // ok 8 of 15
  const types = () => (good(c, 'aiko').good || { types: [] }).types.map(x => x.k);
  assert.deepEqual(types(), [], '8 of 15 is less than two thirds');
  for (const [bal, want] of [['half', ['bal']], ['twothirds', []], ['eighty', []], ['all', []], ['off', []]]) {
    c.STORE.cs_strength_rule = { rule: { minItems: 3, top: 'half', bal, _at: 5 } };
    assert.deepEqual(types(), want, bal);
  }
  // the edges: 11 of 15 (73%) is two thirds but not 80%; 14 of 15 is not "all"; 15 of 15 is
  S.person(c, 'b11', rec(c, {}, ['S11', 'S12', 'S13', 'S14']));
  S.person(c, 'b14', rec(c, {}, ['S11']));
  S.person(c, 'b15', rec(c));
  const bal = id => (good(c, id).good || { types: [] }).types.filter(x => x.k === 'bal').length;
  for (const [b, want] of [['twothirds', [1, 1, 1]], ['eighty', [0, 1, 1]], ['all', [0, 0, 1]], ['half', [1, 1, 1]]]) {
    c.STORE.cs_strength_rule = { rule: { minItems: 3, top: 'half', bal: b, _at: 5 } };
    assert.deepEqual(['b11', 'b14', 'b15'].map(bal), want, b);
  }
  c.STORE.cs_strength_rule = { rule: { minItems: 3, top: 'half', good: false, _at: 5 } };
  assert.equal(good(c, 'aiko').good, null);
  // a record saved by v1113 (no new fields) and a bad value → the defaults
  c.STORE.cs_strength_rule = { rule: { minItems: 3, top: 'half', _at: 5 } };
  assert.deepEqual(['good', 'bal', 'grow'].map(k => run(c, 'cssRule()')[k]), [true, 'twothirds', true]);
  c.STORE.cs_strength_rule = { rule: { minItems: 3, top: 'half', bal: 'most', good: 'no', _at: 5 } };
  assert.deepEqual(['good', 'bal', 'grow'].map(k => run(c, 'cssRule()')[k]), [true, 'twothirds', true]);
  // 'all' at 3 / 'one' at 3 change what is "almost": with 'one', a 3 makes it a strength, so the rest is only "steady" (1 more at 3)
  c.STORE.cs_strength_rule = { rule: { minItems: 3, top: 'all', _at: 5 } };
  assert.deepEqual(good(c, 'aiko').good.list[0], ['S1', 'near', 3]);
  c.STORE.cs_strength_rule = { rule: { minItems: 3, top: 'one', _at: 5 } };
  assert.equal(good(c, 'aiko').good, null, 'S1 is a strength under "one"');
  S.person(c, 'st', rec(c, {}, ['S11']));
  c.ID = 'st'; assert.match(run(c, `cssProfileHtml(EMPS.find(function(e){ return e.id===ID; }))`), /3（模範）が 1 つになると、/);
  // save and read back (and the history keeps the previous values)
  delete c.STORE.cs_strength_rule;
  const r = run(c, `cssSaveRuleRec({minItems:3, top:'half', good:false, bal:'off', grow:false}, 'try', 0, false)`);
  assert.equal(r.ok, true);
  assert.deepEqual(['good', 'bal', 'grow', 'set'].map(k => run(c, 'cssRule()')[k]), [false, 'off', false, true]);
  const at = run(c, 'cssRule()').rawAt;
  assert.equal(run(c, `cssSaveRuleRec({minItems:3, top:'half', good:true, bal:'eighty', grow:true}, 'again', ${at}, false)`).ok, true);
  assert.deepEqual(J(c.STORE.cs_strength_rule.rule.hist.at(-1).before), { minItems: 3, top: 'half', good: false, bal: 'off', grow: false });
  assert.deepEqual(['good', 'bal', 'grow'].map(k => run(c, 'cssRule()')[k]), [true, 'eighty', true]);
  // the modal: the new section (checkboxes and the select at 44px), the screen reads them on save
  run(c, 'openCssRuleModal()');
  const m = c.MODALS.at(-1);
  assert.match(m, /強みが無い人の「良いところ」/);
  assert.match(m, /<label style="display:flex;align-items:center;gap:10px;min-height:44px[^"]*"><input type="checkbox" id="css-r-good" checked/);
  assert.match(m, /<select id="css-r-bal" class="form-input" style="min-height:44px">[\s\S]*?<option value="eighty" selected>8 割以上<\/option>[\s\S]*?<option value="off">バランサーを出さない<\/option>/);
  assert.match(m, /<input type="checkbox" id="css-r-grow" checked/);
  assert.match(m, /もう少しで強み[\s\S]*安定してできる[\s\S]*この人の中で高い/);
  const el = { 'css-r-min': { value: '3' }, 'css-r-top': { value: 'half' }, 'css-r-good': { checked: true }, 'css-r-bal': { value: 'half' }, 'css-r-grow': { checked: false }, 'css-r-why': { value: '' } };
  c.EL = el; vm.runInContext(`var document = { getElementById: function(id){ return EL[id] || null; } }; window._cssRuleAt0 = cssRule().rawAt;`, c);
  assert.equal(run(c, 'cssSaveRule(false)'), true);
  assert.deepEqual(['good', 'bal', 'grow'].map(k => run(c, 'cssRule()')[k]), [true, 'half', false]);
  el['css-r-bal'].value = 'most'; vm.runInContext('window._cssRuleAt0 = cssRule().rawAt;', c);
  assert.equal(run(c, 'cssSaveRule(false)'), false, 'a bad value is not saved');
  c.curRole = 'am'; assert.equal(run(c, 'cssSaveRule(false)'), false);
});

test('the unscored count for the history (v1114): both writers record un and prevUn; the count is the person’s sheet', () => {
  const c = app();
  const sc = S.storeRec({ B0: null, B1: null, A1: '' }).scores;
  c.SC = sc; assert.equal(run(c, `cssUnOf('x', SC)`), 3);
  assert.equal(run(c, `cssUnOf('x', {})`), 140, 'nothing scored');
  assert.equal(run(c, `cssUnOf('x', null)`), 140);
  for (const name of ['approveLssScoreRequest', 'saveLssScores']) {
    const f = fnSrc(name);
    assert.match(f, /var _un0 = [^;]*cssUnOf\(/, name);
    assert.match(f, /entry\.un = _un1; if \(_un0 != null\) entry\.prevUn = _un0;/, name);
    assert.ok(f.indexOf('var _un0') < f.indexOf('setLssScores('), name + ': the previous count is taken before the save');
    assert.match(f, /var _un0 = [^;]*\._set \|\| 'general'\) === lssItemSetOf\(/, name + ': no previous count when the previous record is on another sheet (review P3-2)');
  }
});

test('display only: judging and drawing write nothing; the bonus, promotion and grade blocks do not read the good points; the release', () => {
  const c = app();
  S.person(c, 'aiko', rec(c, { S1: [3, 3, 2, 2, 2] }, ['S11']));
  hist(c, 'aiko Sample', { ts: 1, score: 230, prevScore: 220, max: 420, prevMax: 420, un: 0, prevUn: 0 });
  const before = JSON.stringify(c.STORE) + JSON.stringify(c.SCORES);
  run(c, `cssProfileHtml(EMPS[0], {self:true}) + cssStripHtml(EMPS[0]) + cssTileValHtml(cssEvaluate(EMPS[0]))`);
  assert.equal(JSON.stringify(c.STORE) + JSON.stringify(c.SCORES), before);
  for (const [a, b] of [['/* FUNERGY_KARTE_EVAL_BEGIN */', '/* FUNERGY_KARTE_EVAL_END */'], ['/* FUNERGY_CAREER_CRITERIA_BEGIN */', '/* FUNERGY_CAREER_CRITERIA_END */'], ['/* FUNERGY_CS_GRADE_VIEW_BEGIN */', '/* FUNERGY_CS_GRADE_VIEW_END */']])
    assert.doesNotMatch(between(a, b), /cssGood|cssGrowthOf|cssHasGood/, a);
  // the same orange as the strengths (Moto: "強みと同じオレンジ"); no teal, no emoji
  assert.doesNotMatch(CSS, /#0f766e|#e3f3ef|#dcefea/);
  assert.doesNotMatch(CSS, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u);
  // the icons are Tabler 2.44 line icons
  assert.match(CSS, /CSS_TYPE_IC = \{bal:'ti-chart-radar', grow:'ti-trending-up'\}/);
  assert.match(SRC, /const APP_VERSION = '1114';/);
  assert.match(SW, /const SW_BUILD = '1114';/);
});
