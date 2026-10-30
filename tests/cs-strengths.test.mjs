// v1108 (Moto 10/28 "キャリアスコアの強み表示" · UI案61, answers 10/28: 1·2·9 left to Claude, 3 "some people are working on something and some are not", 4 A):
// the main Career Score display becomes the person's strengths (line icons + a short name, up to 3, one sentence, the evidence);
// the points, total and base move into "評価の内訳を見る" (not removed). Display only: nothing is saved and no bonus, promotion or grade changes.
// Runs the real code from index.html (the FUNERGY_CS_STRENGTH block and the definitions it reads) in a VM with fictional staff and scores.
// No network, no browser storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index = process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url).pathname;
const SRC = fs.readFileSync(index, 'utf8').replace(/\r\n/g, '\n');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const between = (a, b) => { const i = SRC.indexOf(a), j = SRC.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return SRC.slice(i, j + b.length); };
function fn(name) {
  const start = SRC.indexOf('\nfunction ' + name + '(');
  assert.ok(start >= 0, name);
  const lineEnd = SRC.indexOf('\n', start + 1), line = SRC.slice(start + 1, lineEnd), code = line.replace(/\s*\/\*[^\n]*?\*\/\s*$/, '');
  if (code.trimEnd().endsWith('}') && (code.match(/\{/g) || []).length === (code.match(/\}/g) || []).length) return line;
  return SRC.slice(start + 1, SRC.indexOf('\n}', start + 1) + 2);
}
const varBlock = (name, close) => between('\n' + (SRC.includes('\nconst ' + name + ' = ') ? 'const ' : 'var ') + name + ' = ', close).replace(/^\nconst /, '\nvar ');
const CSS = between('/* FUNERGY_CS_STRENGTH_BEGIN */', '/* FUNERGY_CS_STRENGTH_END */');
const J = x => JSON.parse(JSON.stringify(x));

function app() {
  const c = { console, STORE: {}, EMPS: [], SCORES: {}, PENDING: {}, KARTE: {}, OCSEV: {}, OFFICE: {}, TOASTS: [], MODALS: [], CSV: [], curLang: 'ja', curRole: 'gm', curStoreLogin: false, curUserName: 'GM Sample', curPage: 'leadership' };
  vm.createContext(c);
  vm.runInContext([varBlock('LSS_CATEGORIES', '\n];'), varBlock('SPECIALIST_DEPTS', '\n};'), varBlock('SPECIALIST_AXIS_ITEMS', '\n};'), varBlock('SPECIALIST_TITLE_DEPT', '\n};'),
    varBlock('OCS_GROUPS', '\n];'), varBlock('OCS_CATS', '\n];'), varBlock('OCS_ITEMS', '\n];'),
    ...['lssCatsOrdered', 'lssItemId', 'specialistCats', 'empSpecialistDept', 'kevCsSheet', 'ghDate', 'ghYMD', 'cscN', 'defaultEvalRubric', 'getEvalRubric',
      'ocsGrpOfCat', 'ocsNum', 'ocsIsTarget', 'ocsFmt', '_recAt', 'mergeMapByTime', '_coversMapByTime'].map(fn), CSS].join('\n') + `
    var window = this;
    function ls(k, d){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d; }
    function lsSet(k, v){ STORE[k] = JSON.parse(JSON.stringify(v)); return true; }
    function _lsStoreGet(k){ return Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.stringify(STORE[k]) : null; }
    function t(a, b){ return curLang === 'en' ? b : a; }
    function escapeHtml(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function getLssScores(n){ return SCORES[n] ? JSON.parse(JSON.stringify(SCORES[n])) : null; }
    function getEmployees(){ return EMPS; }
    function getLssRequests(){ return Object.keys(PENDING).filter(function(n){ return PENDING[n]; }).map(function(n){ return {id:'r-'+n, name:n, kind:'score', status:'申請中'}; })
      .concat([{id:'r-x', name:'Other Sample', kind:'score', status:'承認'}, {id:'r-y', name:'Skill Sample', kind:'skill', status:'申請中'}]); }
    function ocsOldLocked(n){ return !!OFFICE[n]; }
    function ocsLastConfirmed(id){ return OCSEV[id] || null; }
    function getKarte(id){ return KARTE[id] || {}; }
    function cscStoreCats(){ return lssCatsOrdered(); }
    function csvGradeHtml(V){ return '<grade>' + V.g + '</grade>'; }
    function csvMainHtml(V, o){ CSV.push(o); return '<csv-main score="' + V.score + '" base="' + V.bp + '"></csv-main>'; }
    function ghBadge(g){ return '<badge>' + g + '</badge>'; }
    function showToast(m, k){ TOASTS.push([m, k]); } function openModal(h){ MODALS.push(h); } function closeModalDirect(){} function renderPage(){}
    function kevNow(){ return '2026/10/28 10:30'; } function kevMe(){ return curUserName; }`, c);
  return c;
}
const run = (c, code) => { const v = vm.runInContext(code, c); return v === undefined ? v : J(v); };
// a store-sheet record where every item is at 2 unless given
function storeRec(over = {}, opt = {}) {
  const sc = {};
  for (const [k, n] of Object.entries({ H: 18, A: 18, B: 18, C: 21, D: 17, E: 24, F: 12, G: 12 })) for (let i = 0; i < n; i++) sc[k + i] = 2;
  for (const [id, v] of Object.entries(over)) { if (v === null) delete sc[id]; else sc[id] = v; }
  return Object.assign({ evaluator: 'Store Manager Sample', date: '2026/10/20', scores: sc, status: '確定', _set: 'general', _at: 1 }, opt);
}
function person(c, id, rec, extra = {}) {
  const e = Object.assign({ id, name: id + ' Sample', title: 'Server Leader', status: '在籍' }, extra);
  c.EMPS.push(e); if (rec) c.SCORES[e.name] = rec;
  return e;
}
const evalOf = (c, id) => { c.ID = id; return run(c, `(function(){ var R=cssEvaluate(EMPS.find(function(e){ return e.id===ID; })); return {state:R.state, un:R.un, pending:R.pending, date:R.date, by:R.by, q:R.q, kind:R.kind, list:R.list.map(function(x){ return [x.d.id, x.threes, x.n]; })}; })()`); };
const html = (c, id, opt = '{}') => { c.ID = id; return run(c, `cssProfileHtml(EMPS.find(function(e){ return e.id===ID; }), ${opt})`); };

test('the strength table: one table, real item IDs, line icons from the app font, short names for the sentence, no emoji', () => {
  const c = app();
  const T = run(c, 'CS_STRENGTHS');
  const ids = T.map(d => d.id);
  assert.equal(new Set(ids).size, ids.length, 'unique strength IDs');
  assert.deepEqual(ids.filter(x => /^S\d+$/.test(x)), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12', 'S13', 'S14', 'S15']);
  const items = new Set(run(c, `(function(){ var o=[]; LSS_CATEGORIES.forEach(function(k){ k.items.forEach(function(_, i){ o.push(k.key+i); }); }); return o; })()`));
  for (const d of T.filter(d => d.sh === 'store')) {
    assert.ok(d.it.length >= 3, d.id + ' has at least 3 evidence items');
    for (const id of d.it) assert.ok(items.has(id), d.id + ' → ' + id);
  }
  // 経理・調理: one strength per axis (8 each); the office sheet: one per category (7); サービス・マーケ have no rows (1 item per axis)
  assert.deepEqual(['経理', '調理', 'office', 'サービス', 'マーケ'].map(sh => T.filter(d => d.sh === sh).length), [8, 8, 7, 0, 0]);
  // icons: Tabler line icons that exist in the app's webfont 2.44.0 (checked against its CSS when the table was written)
  assert.match(SRC, /@tabler\/icons-webfont@2\.44\.0\/tabler-icons\.min\.css/);
  const KNOWN = ['message-circle', 'coin', 'heart', 'school', 'clipboard-check', 'chef-hat', 'shield-check', 'package', 'bulb', 'friends', 'flag', 'chart-bar', 'speakerphone', 'message-2', 'rocket',
    'list-check', 'clock-check', 'file-analytics', 'scale', 'heart-handshake', 'calculator', 'tools-kitchen-2', 'user-check', 'receipt', 'id-badge-2', 'file-certificate', 'report-money'];
  for (const d of T) { assert.match(d.ic, /^ti-[a-z0-9-]+$/, d.id); assert.ok(KNOWN.includes(d.ic.slice(3)), d.id + ' ' + d.ic); assert.ok(d.n && d.en && d.s && d.se && d.can && d.cen, d.id + ' has JA/EN texts'); }
  // no emoji anywhere in the block (icons must look the same on every device)
  assert.doesNotMatch(CSS, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u);
});

test('rule A (the default, a proposal): all evidence scored, all at 2 or above, half or more at 3 — the UI案61 example', () => {
  const c = app();
  person(c, 'aoi', storeRec({ B0: 3, B1: 3, B2: 2, B3: 3, B4: 2, B6: 3, B7: 2, B8: 2, B9: 2 }));
  const R = evalOf(c, 'aoi');
  assert.equal(R.state, 'done');
  assert.deepEqual(R.list, [['S1', 3, 5]], 'お客様対応 is a strength (3 of 5 at 3); 提案 is not (1 of 4)');
  assert.deepEqual(run(c, 'cssRule()'), { minItems: 3, top: 'half', good: true, bal: 'twothirds', grow: true, set: false, at: '', by: '', _at: 0, rawAt: 0 });   // v1114: + the good-point rule (defaults)
  assert.equal(run(c, 'cssRuleTxt()'), '根拠の項目が 3 つ以上・すべて 2 以上・3（模範）が半分以上');
});

test('not chosen by total or category share: item evidence decides; a single 1 stops it; a high category share alone does not', () => {
  const c = app();
  // D (marketing) almost all at 3 (94%) but one evidence item of 集客 at 1 → no strength; the category share is ignored
  const d = {}; for (let i = 0; i < 17; i++) d['D' + i] = 3; d.D8 = 1;
  person(c, 'mk', storeRec(d));
  assert.deepEqual(evalOf(c, 'mk').list, [], 'one evidence item at 1 → not a strength, whatever the category share');
  // B (service) mostly at 0–1 (a low category share) but B0–B4 at 3: お客様対応 is still a strength
  const b = { B0: 3, B1: 3, B2: 3, B3: 3, B4: 3 }; for (let i = 5; i < 18; i++) b['B' + i] = 0;
  person(c, 'sv', storeRec(b));
  assert.deepEqual(evalOf(c, 'sv').list, [['S1', 5, 5]]);
  // a few high scores are not enough: 3·3 and the rest at 2 in a 7-item strength → 2 of 7 < half
  person(c, 'pk', storeRec({ E0: 3, E2: 3 }));
  assert.deepEqual(evalOf(c, 'pk').list, []);
  // everything at 2 (expected level everywhere, no role-model items): no strength.
  // v1114 (UI案64): good points instead (Balancer, Steady); with the good points turned off → 得意分野を確認中 as before
  person(c, 'flat', storeRec());
  assert.deepEqual([evalOf(c, 'flat').state, evalOf(c, 'flat').list], ['done', []]);
  const g = html(c, 'flat');
  assert.match(g, /aria-label="良いところ"/);
  assert.match(g, />バランサー</);
  assert.doesNotMatch(g, /得意分野を確認中/);
  c.STORE.cs_strength_rule = { rule: { minItems: 3, top: 'half', good: false, _at: 5 } };
  const h = html(c, 'flat');
  assert.match(h, /得意分野を確認中/);
  assert.match(h, /評価はそろっています。強みとして出す決まり（根拠の項目が 3 つ以上・すべて 2 以上・3（模範）が半分以上）に当たる分野は、まだありません。/);
  assert.doesNotMatch(h, /aria-pressed/, 'no badges at all — never grey “not yet earned” icons');
});

test('unscored items are never 0: a strength with an unscored evidence item is not judged; the others still show (評価途中)', () => {
  const c = app();
  const over = { B0: 3, B1: 3, B2: 3, B3: 2, B4: 2, G0: 3, G1: 3, G2: 3, G3: 3, E9: null, D16: null };   // E9 (evidence of 新人育成) and D16 not scored
  person(c, 'mid', storeRec(over));
  const R = evalOf(c, 'mid');
  assert.deepEqual([R.state, R.un, R.list], ['partial', 2, [['S1', 3, 5]]]);
  const h = html(c, 'mid');
  assert.match(h, /現時点で確認できている強み/);
  assert.match(h, /現時点では、接客で力を発揮する人/);
  assert.match(h, /採点していない項目が 2 あります。評価が終わると、ほかの分野も判定します（採点していない項目を 0 点や推測で埋めません）。/);
  assert.match(h, />評価途中</);
  // once E9 is scored at 3, 新人サポート・育成 appears (it was "not judged", not "failed")
  c.SCORES['mid Sample'].scores.E9 = 3;
  assert.deepEqual(evalOf(c, 'mid').list.map(x => x[0]), ['S4', 'S1']);
  // no strength while unscored: v1114 → the good points found so far (with the unscored count); turned off → 得意分野を確認中
  person(c, 'mid2', storeRec({ B0: null, A1: null }));
  assert.match(html(c, 'mid2'), /現時点で確認できている良いところ[\s\S]*採点していない項目が 2 あります/);
  c.STORE.cs_strength_rule = { rule: { minItems: 3, top: 'half', good: false, _at: 5 } };
  assert.match(html(c, 'mid2'), /得意分野を確認中[\s\S]*採点していない項目が 2 あります/);
});

test('order, top 3 and "see all", the sentence (top two) in Japanese and English', () => {
  const c = app();
  person(c, 'aoi', storeRec({ G0: 3, G1: 3, G2: 2, G3: 3, E9: 3, B0: 3, B1: 3, B2: 2, B3: 3, B4: 2, A1: 3, A2: 2, A3: 3, A13: 3, A17: 2, H6: 3, H8: 2, E7: 3, E14: 2 }));
  // 新人育成 4/5 (80%) → お客様対応 3/5 → 段取り 3/5 (both 60%, same count → table order S1 before S5) → チーム連携 2/4 (50%)
  assert.deepEqual(evalOf(c, 'aoi').list, [['S4', 4, 5], ['S1', 3, 5], ['S5', 3, 5], ['S10', 2, 4]]);
  const h = html(c, 'aoi', '{self:true}');
  assert.match(h, /あなたの強み/);
  assert.match(h, /新人育成と接客で力を発揮する人/);
  const main = h.split('-rest" hidden>')[0], rest = h.split('-rest" hidden>')[1];
  assert.equal((main.match(/aria-pressed=/g) || []).length, 3, 'three badges in the main display');
  assert.equal((main.match(/aria-pressed="true"/g) || []).length, 1, 'the first is selected');
  assert.match(main, /aria-expanded="false"[^>]*>強みをすべて見る（4）</);
  assert.match(rest, /data-s="S10"/);
  // the share of 3s decides before the count: 提案 3 of 4 (75%) comes before 数値管理 6 of 12 (50%) even with fewer 3s;
  // the same share → more evidence items first: 数値管理 6 of 12 before 提案 2 of 4 (both 50%)
  const f = {}; for (let i = 0; i < 12; i++) f['F' + i] = i < 6 ? 3 : 2;
  person(c, 'num', storeRec(Object.assign({ B6: 3, B7: 3, B8: 3, B9: 2 }, f)));
  assert.deepEqual(evalOf(c, 'num').list, [['S2', 3, 4], ['S12', 6, 12]]);
  person(c, 'num2', storeRec(Object.assign({ B6: 3, B7: 3, B8: 2, B9: 2 }, f)));
  assert.deepEqual(evalOf(c, 'num2').list, [['S12', 6, 12], ['S2', 2, 4]]);
  c.curLang = 'en';
  assert.match(html(c, 'aoi'), /Shines in coaching new staff and guest service/);
  assert.match(html(c, 'aoi'), /G0<\/span> How to teach new hires/, 'English item names');
  assert.match(html(c, 'aoi'), /Role model \(3\)/);
  assert.match(html(c, 'aoi'), /See all strengths \(4\)/);
});

test('the evidence panel: items, level (rubric label), evaluation date, evaluator, the rule; read aloud; 44px+ targets', () => {
  const c = app();
  person(c, 'aoi', storeRec({ G0: 3, G1: 3, G2: 2, G3: 3, E9: 3 }));
  const h = html(c, 'aoi');
  const live = h.slice(h.indexOf('-ev" aria-live="polite"'), h.indexOf('<template'));
  assert.match(live, /<b[^>]*>新人サポート・育成<\/b>/);
  assert.match(live, /新人に基本手順を教え、一人でできるまで支えられる/);
  assert.match(live, /G0<\/span> 新人への教え方/);
  assert.match(live, /E9<\/span> 新人教育力/);
  assert.match(live, /模範となっている（3）/);
  assert.match(live, /継続してできる（期待レベル）（2）/);
  assert.match(live, /評価日 2026\/10\/20 ・ 評価者 Store Manager Sample ・ 5 項目すべて 2 以上・3 が 4 つ/);
  assert.match(h, /<template id="cssp\d+-t-S4">/, 'every strength has its panel ready to swap into the live region');
  // targets: badges 104px tall, buttons and the breakdown summary at least 44px
  assert.match(h, /aria-pressed="true"[^>]*min-height:104px/);
  for (const m of h.matchAll(/min-height:(\d+)px/g)) assert.ok(+m[1] >= 44, m[0]);
  // the badges are real buttons (keyboard) with aria-pressed; the icon is decorative
  assert.match(h, /<button type="button" data-u="cssp\d+" data-s="S4" aria-pressed="true" aria-controls="cssp\d+-ev" onclick="cssSel\(this\)"/);
  assert.match(h, /<span aria-hidden="true"[^>]*><i class="ti ti-school"/);
});

test('the breakdown keeps the old points: total / base and the categories inside "評価の内訳を見る" (folded unless asked)', () => {
  const c = app();
  person(c, 'aoi', storeRec({ B0: 3, B1: 3, B2: 3 }));
  c.ID = 'aoi';
  const V = { g: 'G3', score: 300, bp: 294, state: 'met' };
  c.VV = V;
  let h = run(c, `cssProfileHtml(EMPS.find(function(e){ return e.id===ID; }), {self:true, V:VV, bdExtra:'<x-extra>'})`);
  assert.match(h, /<details style="[^"]*"><summary style="min-height:44px[^"]*">.*評価の内訳を見る（点・基準点）<\/summary><div[^>]*><csv-main score="300" base="294"><\/csv-main><\/div><\/details>/);
  assert.deepEqual(J(c.CSV.at(-1)), { size: 56, openCats: true, extra: '<x-extra>' });
  assert.match(h, /<grade>G3<\/grade>/);
  // the scoring screen opens it and remembers the open/closed state across redraws
  h = run(c, `cssProfileHtml(EMPS.find(function(e){ return e.id===ID; }), {V:VV, bdKey:'lss|aoi', bdOpen:true, draftNote:true})`);
  assert.match(h, /<details open data-k="lss\|aoi" ontoggle="cssBdKeep\(this\)"/);
  assert.match(h, /強みは保存した正式な評価から出します。入力中の点は下の「評価の内訳」に出ます。/);
  run(c, `cssBdKeep({getAttribute:function(){ return 'lss|aoi'; }, open:false})`);
  h = run(c, `cssProfileHtml(EMPS.find(function(e){ return e.id===ID; }), {V:VV, bdKey:'lss|aoi', bdOpen:true})`);
  assert.match(h, /<details data-k="lss\|aoi"/, 'closed once the person closed it');
  // the selected strength and "see all" stay across the redraws of the scoring screen (review P3-8)
  person(c, 'many', storeRec({ B0: 3, B1: 3, B2: 3, B3: 3, B4: 3, B6: 3, B7: 3, B8: 3, B9: 3, C0: 3, C1: 3, C2: 3, C3: 3, C4: 3, G0: 3, G1: 3, G2: 3, G3: 3, E9: 3 }));
  c.ID = 'many';
  const ids = run(c, `cssEvaluate(EMPS.find(function(e){ return e.id===ID; })).list.map(function(x){ return x.d.id; })`);
  assert.ok(ids.length >= 4, 'needs a fourth strength for "see all"');
  run(c, `cssSelKeep({getAttribute:function(){ return 'lss|many'; }}, 's', ${JSON.stringify(ids[3])}); cssSelKeep({getAttribute:function(){ return 'lss|many'; }}, 'more', true)`);
  h = run(c, `cssProfileHtml(EMPS.find(function(e){ return e.id===ID; }), {V:VV, bdKey:'lss|many'})`);
  assert.match(h, new RegExp('data-s="' + ids[3] + '" aria-pressed="true"'));
  assert.match(h, new RegExp('data-s="' + ids[0] + '" aria-pressed="false"'));
  assert.match(h, /aria-expanded="true"[^>]*>閉じる<\/button><div id="cssp\d+-rest">/);
  // other screens (no key) start from the first strength
  h = run(c, `cssProfileHtml(EMPS.find(function(e){ return e.id===ID; }), {V:VV})`);
  assert.match(h, new RegExp('data-s="' + ids[0] + '" aria-pressed="true"'));
});

test('only the official record: pending score requests are not mixed in; changed item sets and missing records are not judged', () => {
  const c = app();
  person(c, 'pend', storeRec({ B6: 3, B7: 3, B8: 2, B9: 2 }));
  c.PENDING['pend Sample'] = true;
  const R = evalOf(c, 'pend');
  assert.deepEqual([R.pending, R.list], [true, [['S2', 2, 4]]]);
  const h = html(c, 'pend');
  assert.match(h, />承認待ちあり</);
  assert.match(h, /点の変更の申請が承認待ちです。承認されるまでは、今の正式な評価で表示します（申請中の点は混ぜません）。/);
  // only a score request that is still waiting counts (a skill request, or a score request already decided, does not)
  person(c, 'Skill', storeRec()); person(c, 'Other', storeRec());
  assert.deepEqual([evalOf(c, 'Skill').pending, evalOf(c, 'Other').pending], [false, false]);
  // the record was made with another item set (the same IDs ask different questions) → checking, not judged
  person(c, 'moved', storeRec({ B0: 3, B1: 3, B2: 3, B3: 3, B4: 3 }, { _set: '経理' }));
  assert.deepEqual([evalOf(c, 'moved').state, evalOf(c, 'moved').list], ['set', []]);
  assert.match(html(c, 'moved'), /評価項目が入れ替わったため、強みを確認中です/);
  // an old store record without the set mark is read as the store sheet
  person(c, 'old', storeRec({ B0: 3, B1: 3, B2: 3, B3: 3, B4: 3 }, { _set: undefined }));
  assert.deepEqual(evalOf(c, 'old').list, [['S1', 5, 5]]);
  // a record with no score at all is "not evaluated" (not "in progress"; review P3-6)
  const empty = storeRec(); for (const k of Object.keys(empty.scores)) empty.scores[k] = null;
  person(c, 'empty', empty);
  assert.equal(evalOf(c, 'empty').state, 'none');
  // no record at all
  person(c, 'none', null);
  assert.deepEqual(evalOf(c, 'none'), { state: 'none', un: 0, pending: false, date: '', by: '', q: '', kind: 'store', list: [] });
  assert.match(html(c, 'none'), /まだ評価がありません。評価が入ると、確認できた強みがここに出ます。/);
});

test('the strength rule (GM/CEO, display only): stored values change the judgement, bad values fall back, reset goes back to the default', () => {
  const c = app();
  person(c, 'aoi', storeRec({ B6: 3, B7: 2, B8: 2, B9: 2 }));   // 提案：1 of 4 at 3
  assert.deepEqual(evalOf(c, 'aoi').list, []);
  c.STORE.cs_strength_rule = { rule: { minItems: 3, top: 'one', _at: 5, at: '2026/10/28 10:00', by: 'CEO Sample' } };
  assert.deepEqual(evalOf(c, 'aoi').list, [['S2', 1, 4]], 'rule B: at least one at 3');
  c.STORE.cs_strength_rule = { rule: { minItems: 5, top: 'one', _at: 6 } };
  assert.deepEqual(evalOf(c, 'aoi').list, [], '4-item strengths are not judged when 5 are required');
  c.STORE.cs_strength_rule = { rule: { minItems: 1, top: 'many', _at: 7 } };
  assert.deepEqual(run(c, 'cssRule()').minItems + '|' + run(c, 'cssRule()').top, '3|half', 'out-of-range values use the default');
  // save: the GM saves (conflict-checked), reset stores {reset:true} — never _deleted (that would beat newer saves in the merge)
  c.STORE.cs_strength_rule = { rule: { minItems: 4, top: 'all', _at: 10, hist: [] } };
  assert.deepEqual(run(c, `cssSaveRuleRec({minItems:3, top:'one'}, 'test', 9, false)`), { ok: false, conflict: true });
  assert.equal(run(c, `cssSaveRuleRec({minItems:3, top:'one'}, 'why', 10, false)`).ok, true);
  const saved = J(c.STORE.cs_strength_rule.rule);
  assert.deepEqual([saved.minItems, saved.top, saved.by, saved.hist.at(-1).before], [3, 'one', 'GM Sample', { minItems: 4, top: 'all' }]);
  assert.equal(run(c, `cssSaveRuleRec(null, '', ${saved._at}, true)`).ok, true);
  assert.equal(c.STORE.cs_strength_rule.rule.reset, true);
  assert.equal(c.STORE.cs_strength_rule.rule._deleted, undefined);
  assert.equal(run(c, 'cssRule()').set, false);
  // the merge keeps the newest save, whether reset or not (two devices)
  const older = { rule: { minItems: 5, top: 'all', _at: 1 } }, newer = { rule: { reset: true, _at: 2 } };
  assert.deepEqual(run(c, `mergeMapByTime(${JSON.stringify(older)}, ${JSON.stringify(newer)})`), newer);
  assert.deepEqual(run(c, `mergeMapByTime(${JSON.stringify(newer)}, ${JSON.stringify({ rule: { minItems: 4, top: 'one', _at: 3 } })})`).rule.minItems, 4);
  // after a reset the modal reads the time of the record now, so the next save is not refused as a conflict (review P2)
  c.curRole = 'gm';
  run(c, 'openCssRuleModal()');
  assert.equal(c.window._cssRuleAt0, c.STORE.cs_strength_rule.rule._at);
  assert.equal(run(c, `cssSaveRuleRec({minItems:4, top:'half'}, 'again', window._cssRuleAt0, false)`).ok, true);
  assert.deepEqual([run(c, 'cssRule()').minItems, run(c, 'cssRule()').set], [4, true]);
  // a rule that asks for more items than a sheet has: "few" says it is the rule, not the sheet; the modal warns
  c.STORE.cs_strength_rule = { rule: { minItems: 5, top: 'half', _at: 120 } };
  const acc = { scores: {}, evaluator: 'GM Sample', date: '2026/10/18', _set: '経理', _at: 1 };
  for (const a of 'ABCDEFGH') for (let i = 0; i < 4; i++) acc.scores[a + i] = 3;
  person(c, 'acc5', acc, { title: 'Accountant' });
  assert.equal(evalOf(c, 'acc5').state, 'few');
  assert.match(html(c, 'acc5'), /強みの決まり（根拠の項目が 5 つ以上）に届く分野が、この評価表にはありません。決まりは GM・CEO が変えられます。/);
  c.ID = 'acc5'; assert.match(run(c, `cssStripHtml(EMPS.find(function(e){ return e.id===ID; }))`), /決まりの根拠の数に届く分野がありません/);
  run(c, 'openCssRuleModal()');
  assert.match(c.MODALS.at(-1), /根拠の項目を 5 つ以上にすると、経理・調理（1 軸 4 項目）では強みが出ません/);
  // GM/CEO see the current rule above the list (with the default marked as a proposal); others do not
  c.STORE.cs_strength_rule = { rule: { reset: true, _at: 99 } };
  assert.match(run(c, 'cssRuleBarHtml()'), /強みの決まり（表示だけ）：根拠の項目が 3 つ以上・すべて 2 以上・3（模範）が半分以上（初期値・設定案） ・ 強みが無い人の良いところ：出す<\/span><button[^>]*min-height:44px[^>]*onclick="openCssRuleModal\(\)">変える</);
  c.curStoreLogin = true; assert.equal(run(c, 'cssRuleBarHtml()'), ''); c.curStoreLogin = false;
  // only GM/CEO (and not a store login) can open or save it
  c.curRole = 'am';
  assert.equal(run(c, 'cssRuleBarHtml()'), '');
  const nModals = c.MODALS.length;
  run(c, 'openCssRuleModal()');
  assert.equal(c.MODALS.length, nModals);
  assert.equal(run(c, 'cssSaveRule(false)'), false);
  c.curRole = 'ceo';
  run(c, 'openCssRuleModal()');
  assert.match(c.MODALS.at(-1), /変わるのは表示だけで、点・基準点・昇格の判定・賞与は変わりません/);
  assert.match(c.MODALS.at(-1), /強みの対応表（38）/);
});

test('department sheets: 経理 and 調理 by axis (not the store categories); サービス・マーケ cannot be judged (1 item per axis)', () => {
  const c = app();
  const acc = { scores: {}, evaluator: 'GM Sample', date: '2026/10/18', _set: '経理', _at: 1 };
  for (const a of 'ABCDEFGH') for (let i = 0; i < 4; i++) acc.scores[a + i] = 2;
  Object.assign(acc.scores, { A0: 3, A1: 3, A2: 3, A3: 2, E0: 3, E1: 3, E2: 2, E3: 2 });
  person(c, 'acc', acc, { title: 'Accountant' });
  const R = evalOf(c, 'acc');
  assert.deepEqual([R.kind, R.list], ['spec', [['AC-A', 3, 4], ['AC-E', 2, 4]]]);
  assert.match(html(c, 'acc'), /正確さと内部統制で力を発揮する人/);
  assert.match(html(c, 'acc'), /A0<\/span> 仕訳・記帳の正確さ/);
  const cook = { scores: {}, evaluator: 'GM Sample', date: '2026/10/18', _set: '調理', _at: 1 };
  for (const a of 'ABCDEFGH') for (let i = 0; i < 4; i++) cook.scores[a + i] = 3;
  person(c, 'cook', cook, { title: 'Head Chef' });
  assert.equal(evalOf(c, 'cook').list.length, 8, 'all 8 axes; the main display shows 3');
  assert.match(html(c, 'cook'), /強みをすべて見る（8）/);
  const sv = { scores: { A0: 3, B0: 3, C0: 3, D0: 3, E0: 3, F0: 3, G0: 3, H0: 3 }, evaluator: 'GM Sample', date: '2026/10/18', _set: 'サービス', _at: 1 };
  person(c, 'cs', sv, { title: 'Customer Service Manager' });
  assert.equal(evalOf(c, 'cs').state, 'few');
  assert.match(html(c, 'cs'), /この評価表は分野ごとの項目が少ないため、強みを判定していません。/);
});

test('the office sheet: only the latest confirmed evaluation, only the items in the person’s scope, not the weight-0 group', () => {
  const c = app();
  const e = person(c, 'off', null, { title: 'Office Crew' });
  c.OFFICE['off Sample'] = true;
  assert.equal(evalOf(c, 'off').state, 'none');
  assert.match(html(c, 'off'), /オフィス用 Career Score の確定した評価がまだありません/);
  const asg = {}, s = {};
  for (const cat of 'ABCDEFG') for (let i = 1; i <= 5; i++) { asg['O-' + cat + i] = { scored: true, role: 'own' }; s['O-' + cat + i] = 2; }
  Object.assign(s, { 'O-A1': 3, 'O-A2': 3, 'O-A3': 3, 'O-G1': 3, 'O-G2': 3, 'O-G3': 3, 'O-G4': 3, 'O-G5': 3 });
  asg['O-B4'] = { scored: false, role: 'na' }; asg['O-B5'] = { scored: false, role: 'na' }; asg['O-B3'] = { scored: false, role: 'na' };   // B: only 2 items in scope
  s['O-B1'] = 3; s['O-B2'] = 3; s['O-B3'] = 3; s['O-B4'] = 3; s['O-B5'] = 3;   // the out-of-scope items are high too (must not count)
  c.OCSEV.off = { period: '2026-Q3', conf: { state: 'confirmed', s, at: '2026-10-05T01:00:00Z', by: 'GM Sample' }, meta: { asg, weights: { A: 20, P: 60, F: 20, G: 0 } } };
  const R = evalOf(c, 'off');
  // A: 3 of 5 at 3 → strength. B: 2 items in scope < 3 → not judged. G: the weight-0 group (development record) is not used.
  // The date is the Hawaii date (10/05 01:00 UTC is 10/04 in Hawaii; review P3-4)
  assert.deepEqual([R.kind, R.state, R.q, R.date, R.by, R.list], ['office', 'done', '2026 Q3', '2026/10/04', 'GM Sample', [['OF-A', 3, 5]]]);
  // a revised confirmation shows who revised it and when
  c.OCSEV.off.conf.revisedAt = '2026-10-20T20:00:00Z'; c.OCSEV.off.conf.revisedBy = 'CEO Sample';
  assert.deepEqual([evalOf(c, 'off').date, evalOf(c, 'off').by], ['2026/10/20', 'CEO Sample']);
  delete c.OCSEV.off.conf.revisedAt; delete c.OCSEV.off.conf.revisedBy;
  // the mgr / self parts are never read: only conf.s
  c.OCSEV.off.mgr = { s: Object.fromEntries(Object.keys(s).map(k => [k, 3])) };
  assert.deepEqual(evalOf(c, 'off').list, [['OF-A', 3, 5]]);
  void e;
});

test('伸ばしていること: one agreed goal from the growth chart (not done, nearest due); none → nothing is shown or made up', () => {
  const c = app();
  person(c, 'aoi', storeRec({ B0: 3, B1: 3, B2: 3 }));
  assert.equal(run(c, `cssGrow(EMPS[0])`), null);
  assert.doesNotMatch(html(c, 'aoi'), /伸ばしていること/);
  c.KARTE.aoi = { goals: [
    { id: 'g1', text: '新しいメニューの説明', due: '2026-12-30', done: false },
    { id: 'g2', text: 'ピーク時の全体指示', due: '2026-12-15', done: false },
    { id: 'g3', text: '終わった目標', due: '2026-11-01', done: true },
    { id: 'g4', text: '', due: '2026-10-01', done: false }
  ] };
  assert.deepEqual(run(c, `cssGrow(EMPS[0])`), { text: 'ピーク時の全体指示', due: '2026-12-15' });
  assert.match(html(c, 'aoi'), /伸ばしていること<\/div><div[^>]*>ピーク時の全体指示<span[^>]*>（2026\/12\/15 まで）<\/span>/);
});

test('display only: judging and drawing write nothing (no shared data, no bonus, no promotion)', () => {
  const c = app();
  person(c, 'aoi', storeRec({ B0: 3, B1: 3, B2: 3 }));
  c.KARTE.aoi = { goals: [{ id: 'g', text: 'x', due: '', done: false }] };
  const before = JSON.stringify(c.STORE) + JSON.stringify(c.SCORES) + JSON.stringify(c.KARTE);
  run(c, `cssProfileHtml(EMPS[0], {self:true, V:{g:'G3', score:1, bp:2}}) + cssStripHtml(EMPS[0]) + cssTileVal(cssEvaluate(EMPS[0]))`);
  assert.equal(JSON.stringify(c.STORE) + JSON.stringify(c.SCORES) + JSON.stringify(c.KARTE), before);
  // nothing outside the display reads the strength judgement (bonus, promotion and grade blocks do not mention it)
  for (const [a, b] of [['/* FUNERGY_KARTE_EVAL_BEGIN */', '/* FUNERGY_KARTE_EVAL_END */'], ['/* FUNERGY_CAREER_CRITERIA_BEGIN */', '/* FUNERGY_CAREER_CRITERIA_END */'], ['/* FUNERGY_CS_GRADE_VIEW_BEGIN */', '/* FUNERGY_CS_GRADE_VIEW_END */']])
    assert.doesNotMatch(between(a, b), /css(Evaluate|ProfileHtml|Rule)\b/, a);
  for (const name of ['bonusForEmp', 'bonusSegEval', 'gradePromoEval', 'lssEligibility']) assert.doesNotMatch(fn(name), /cssEvaluate|cssRule/, name);
});

test('wiring: My page, the Career Score list and screen, the growth chart and its talk points use the strengths; the shared key and the release', () => {
  // My page: the profile instead of the total / base headline; the categories only inside the breakdown
  assert.match(SRC, /\$\{cssProfileHtml\(meEmpL, \{self:true, V:lV, bdExtra:lExtra\}\)\}/);
  // the folded category breakdown (My page and the growth chart) is a 44px target (review P3-1); the list cards use the always-open one (v1113)
  assert.match(fn('csvCatsHtml'), /<summary style="[^"]*min-height:44px/);
  assert.doesNotMatch(SRC, /csvMainHtml\(lV, \{size:60, extra:lExtra, noCats:true\}\)/);
  // the list cards: no points ring; v1113 (UI案63 B): every strength as an icon card, the points line and the always-open categories
  const list = fn('renderLeadership');
  assert.doesNotMatch(list, /csvRingHtml\(cV/);
  assert.match(list, /var cR = cssEvaluate\(e\);/);
  assert.match(list, /html \+= cssStripHtml\(e, cR\) \+ csvListPtsHtml\(cV, cR\) \+ csvCatsListHtml\(cV\);/);
  assert.match(list, /html \+= \(typeof cssRuleBarHtml==='function'\) \? cssRuleBarHtml\(\) : '';/);
  assert.doesNotMatch(list, /onclick="openCssRuleModal\(\)"/, 'not another header button (the header is already full at 1280px)');
  // the scoring screen: strengths from the official record; the live draft in the breakdown (open for people who score)
  assert.match(fn('renderLssSummary'), /cssProfileHtml\(e, \{self:lssIsSelf\(name\), V:V, bdKey:'lss\|'\+name, bdOpen:_cs, draftNote:_cs\}\)/);
  assert.match(fn('renderLssSummary'), /var V=csvView\(e, \{scores:window\._lssDraft\|\|\{\}\}\);/);
  // growth chart: the tiles, the strengths card (manager page and the person's view), the old "Career Score の内訳" card is not repeated
  assert.equal((SRC.match(/return _kTile\('Career Score', cssTileValHtml\(R(, true)?\)/g) || []).length, 2);
  assert.match(fn('renderKarteDetailPage'), /h\+='<div class="card">'\+cssProfileHtml\(e, \{V:csvView\(e\)\}\)\+'<\/div>';/);
  assert.match(fn('renderKarteSelfView'), /cssProfileHtml\(e, \{self:true, V:csvView\(e\)\}\)/);
  // talk points: strengths also for people who have no store-sheet record (office sheet; review P3-9)
  const ks = fn('karteAutoSkills');
  assert.ok(ks.indexOf('strong=cssEvaluate(e)') < ks.indexOf('if(!sum||!sum.hasData) return {strong:strong'), ks);
  assert.doesNotMatch(fn('renderKarteSelfView'), /Career Score の内訳/);
  // the old "strengths" (top category share) are gone from the growth chart; the weak side stays as it was
  const ak = fn('karteAutoSkills');
  assert.match(ak, /strong=cssEvaluate\(e\)\.list\.slice\(0,3\)/);
  assert.doesNotMatch(ak, /var strong=cats\.slice\(0,3\)/);
  assert.match(ak, /var weak=cats\.slice\(\)\.sort/);
  // the shared rule key: synced, merged by time, never freed
  assert.match(SRC, /var OP_SYNC_KEYS = \[[\s\S]*?'cs_strength_rule','cs_guide',/);
  assert.match(SRC, /\n  cs_strength_rule:   \{ merge: mergeMapByTime, covers: _coversMapByTime \},/);
  assert.equal((SRC.match(/'bonus_pool_extra','cs_strength_rule','cs_guide',/g) || []).length, 2);
  // release markers
  const app = (SRC.match(/const APP_VERSION = '(\d+)';/) || [])[1], sw = (SW.match(/const SW_BUILD = '(\d+)';/) || [])[1];   // v1109: later releases keep the strengths
  assert.ok(Number(app) >= 1108 && app === sw, 'APP_VERSION ' + app + ' / SW_BUILD ' + sw);
});
