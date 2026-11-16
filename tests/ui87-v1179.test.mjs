// v1179（UI案87・Moto さん 11/15 20:51 HST「次は全部Aいきます」）。
// 合成データ・本番に接続しない。index.html の関数を VM で動かすか、形を確かめる。画面の見た目は tests/e2e-pcsp/ui87-v1179.mjs（Chromium）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
function fnSrc(name) {
  const i = HTML.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name + ' がある');
  const j = HTML.indexOf('{', i);
  let depth = 0;
  for (let k = j; k < HTML.length; k++) { const ch = HTML[k]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return HTML.slice(i, k + 1); } }
  throw new Error('関数の終わりが無い：' + name);
}
const esc = x => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const ctxOf = (extra = {}) => { const c = { Math, Number, String, Object, Array, JSON, isNaN, isFinite, parseInt, parseFloat, console, Date, setTimeout: () => 0, clearTimeout() {}, t: (j, e) => j, escapeHtml: esc, ...extra }; vm.createContext(c); return c; };
const U9_BASE = ['u9Mode', 'u9St', 'u9Page', 'u9Pager', 'u9GoPage', 'u9SetF', 'u9SetV', 'u9QMatch', 'u9SearchHtml', 'u9TilesHtml', 'u9TableHtml', 'u9Pick', 'u9SpListHtml', 'u9StoreName', 'u9Q'];
const mm = w => (w == null ? null : q => { const m = q.match(/\((min|max)-width:\s*(\d+)px\)/); const v = +m[2]; return { matches: m[1] === 'min' ? w >= v : w <= v, addEventListener() {} }; });
function u9Ctx(width, extra = {}, fns = []) {
  const win = width == null ? {} : { matchMedia: mm(width) };
  const renders = [];
  const c = ctxOf({ window: win, renders, curPage: 'leadership', renderPage: p => renders.push(p), STORES: [{ id: 'S1', name: 'Store One' }, { id: 'S2', name: 'Store Two' }], document: { querySelector: () => null, getElementById: () => null }, ...extra });
  const order = (HTML.match(/var U9_CS_ORDER = \{[^}]*\};/) || [''])[0];
  vm.runInContext('var U9_PER = 50;\n' + order + '\n' + [fnSrc('arMode')].concat(U9_BASE.concat(fns).map(fnSrc)).join('\n'), c);
  return c;
}

test('版：ページと SW が同じ（1179 以上）', () => {
  const a = +(HTML.match(/const APP_VERSION = '(\d+)'/) || [])[1], s = +(SW.match(/const SW_BUILD = '(\d+)'/) || [])[1];
  assert.ok(a >= 1179 && a === s, a + ' / ' + s);
});

test('共通：幅で形（1024px 以上＝表とパネル・767px まで＝1 行の一覧・あいだ＝今の形）', () => {
  assert.equal(u9Ctx(1440).u9Mode(), 'pc');
  assert.equal(u9Ctx(1024).u9Mode(), 'pc');
  assert.equal(u9Ctx(1023).u9Mode(), 'mid');
  assert.equal(u9Ctx(768).u9Mode(), 'mid');
  assert.equal(u9Ctx(767).u9Mode(), 'sp');
  assert.equal(u9Ctx(null).u9Mode(), 'mid');
});

test('共通：50 人ずつ・はみ出したページは最後に寄せる・「1〜50 人目 / N 人」・1 ページなら出さない・ページは一覧ごと', () => {
  const c = u9Ctx(1440), rows = Array.from({ length: 120 }, (_, i) => i);
  let P = c.u9Page('cs', rows);
  assert.deepEqual([P.page, P.pages, P.total, P.from, P.to, P.slice.length], [1, 3, 120, 0, 50, 50]);
  const h = c.u9Pager(P);
  assert.match(h, /1〜50 人目 \/ 120 人/); assert.match(h, /aria-current="page"/); assert.match(h, /onclick="u9GoPage\('cs',2\)"/);
  assert.match(h, /ar-pg pv" disabled/, '1 ページ目では前へを押せない');
  c.u9St().pg.cs = 9; P = c.u9Page('cs', rows); assert.deepEqual([P.page, P.from, P.slice.length], [3, 100, 20]);
  assert.equal(c.u9Page('skill', rows).page, 1, 'ほかの一覧のページは別');
  assert.equal(c.u9Pager(c.u9Page('x', rows.slice(0, 50))), '');
  c.u9GoPage('skill', 2); assert.equal(c.u9St().pg.skill, 2); assert.deepEqual(c.renders, ['leadership']);
});

test('共通：絞り込み・並び・探す欄は 1 ページ目へ／同じ数をもう一度押すと全部', () => {
  const c = u9Ctx(1440);
  c.u9St().pg.cs = 3; c.u9SetF('cs', 'met'); assert.equal(c.u9St().f.cs, 'met'); assert.equal(c.u9St().pg.cs, 1);
  c.u9St().pg.cs = 2; c.u9SetF('cs', 'met'); assert.equal(c.u9St().f.cs, '');
  c.u9St().pg.cs = 2; c.u9SetV('cs:g', 'sort', 'G3', 'cs'); assert.equal(c.u9St().sort['cs:g'], 'G3'); assert.equal(c.u9St().pg.cs, 1);
  c.u9St().q.cs = ' AKI '; assert.equal(c.u9QMatch('cs', 'Aki Abe'), true); assert.equal(c.u9QMatch('cs', 'Ben Ito'), false);
  c.u9St().q.cs = '"><img'; assert.match(c.u9SearchHtml('cs'), /value="&quot;&gt;&lt;img"/, '探す欄の値はエスケープ');
});

test('共通：PC の表：最初は 1 行目・選んだ人が一覧にいれば残す・名前は文字列として渡す（onclick に入れない）・aria', () => {
  const c = u9Ctx(1440);
  const o = { key: 'cs', cols: [{ h: '名前' }, { h: '点', cls: 'num' }], rows: [{ id: "O'Neil \"X\"", cells: ['a', '1'] }, { id: 'Ben', cells: ['b', '2'] }], panel: id => '<p>' + esc(id) + '</p>' };
  let h = c.u9TableHtml(o);
  assert.equal(c.u9St().sel.cs, "O'Neil \"X\"");
  assert.match(h, /data-u9id="O&#39;Neil &quot;X&quot;"/);
  assert.match(h, /onclick="u9Pick\('cs',this.getAttribute\('data-u9id'\)\)"/);
  assert.ok(!/u9Pick\('cs','O/.test(h), '名前を onclick の中に入れない');
  assert.match(h, /aria-selected="true"/); assert.match(h, /<th class="num">点<\/th>/); assert.match(h, /<td class="num">1<\/td>/);
  assert.match(h, /id="u9p-cs"><p>O&#39;Neil/);
  c.u9St().sel.cs = 'Ben'; h = c.u9TableHtml(o); assert.equal(c.u9St().sel.cs, 'Ben');
  c.u9St().sel.cs = 'gone'; c.u9TableHtml(o); assert.equal(c.u9St().sel.cs, "O'Neil \"X\"", 'いなくなった人なら 1 行目');
  const e = c.u9TableHtml({ key: 'z', cols: [{ h: 'a' }], rows: [], panel: () => 'x', empty: '誰もいない' });
  assert.match(e, /colspan="2" class="u9-empty">誰もいない/); assert.equal(c.u9St().sel.z, null);
});

test('共通：行を選ぶ：書きかけがあると聞き、やめると変えない・同じ人なら何もしない', () => {
  const panel = { innerHTML: '' }, rows = [{ id: 'A' }, { id: 'B' }].map(r => ({ getAttribute: () => r.id, classList: { toggle(k, on) { r.on = on; } }, setAttribute() {}, r }));
  const doc = { querySelector: () => ({ querySelectorAll: () => rows }), getElementById: () => panel };
  const c = u9Ctx(1440, { document: doc });
  c.u9St().sel.k = 'A'; c.u9St().panel.k = id => 'P:' + id;
  let ask = false; c.u9St().guard.k = () => ask;
  c.u9Pick('k', 'B'); assert.equal(c.u9St().sel.k, 'A', 'やめると A のまま'); assert.equal(panel.innerHTML, '');
  ask = true; c.u9Pick('k', 'B'); assert.equal(c.u9St().sel.k, 'B'); assert.equal(panel.innerHTML, 'P:B'); assert.equal(rows[1].r.on, true); assert.equal(rows[0].r.on, false);
  ask = false; c.u9Pick('k', 'B'); assert.equal(panel.innerHTML, 'P:B');
  let g = 0; c.u9St().guard.k = () => { g++; return true; }; panel.innerHTML = 'kept'; c.u9Pick('k', 'B');
  assert.equal(g, 0, '同じ人なら聞かない'); assert.equal(panel.innerHTML, 'kept', '同じ人ならパネルを書き直さない');
  assert.deepEqual(c.renders, [], 'パネルだけ書き直す（画面全体は描き直さない）');
});

test('共通：スマホの 1 行の一覧：名前はエスケープ・押すと名前を渡す', () => {
  const c = u9Ctx(390);
  const h = c.u9SpListHtml('cs', [{ id: '<b>x', t1: '<b>x', r1: '<span>tag</span>', t2: 'G2 · Store' }], 'u9CsOpen');
  assert.match(h, /data-u9id="&lt;b&gt;x"/); assert.match(h, /<span class="ar-sv">&lt;b&gt;x<\/span><span>tag<\/span>/);
  assert.match(h, /onclick="u9CsOpen\(this.getAttribute\('data-u9id'\)\)"/);
  assert.match(c.u9SpListHtml('cs', [], 'f', '空'), /u9-empty">空/);
});

/* ---------- 1. Career Score ---------- */
function csCtx(width, leaders) {
  const V = { a: { state: 'met', score: 300, bp: 252, diff: 48, g: 'G2' }, b: { state: 'notmet', score: 200, bp: 252, diff: -52, g: 'G2' }, c: { state: 'partial', score: 100, bp: 294, un: 5, g: 'G3' }, d: { state: 'none', bp: 294, g: 'G3' }, e: { state: 'nobase', g: 'G1' } };
  return u9Ctx(width, {
    csvView: e => V[e.k], cssEvaluate: e => ({ list: e.k === 'a' ? [{ d: 'X' }] : [], good: { list: [] }, date: e.k === 'a' ? '2026-11-01' : '' }),
    cssDefName: d => '強み' + d, cssHasGood: () => false, cscN: n => String(n), csvTag: v => '<tag>' + v.state + '</tag>', empGrade: () => '', ghBadge: g => '<g>' + g + '</g>',
    getEmployees: () => leaders,
  }, ['u9CsRow', 'u9CsStr', 'u9CsPts', 'u9CsDiff', 'u9CsListHtml']);
}
const L5 = [{ name: 'Zed', k: 'a', store: 'S1' }, { name: 'Yan', k: 'b', store: 'S2' }, { name: 'Xia', k: 'c', store: 'S1' }, { name: 'Wes', k: 'd', store: 'S2' }, { name: 'Vic', k: 'e', store: 'S1' }];
test('1 Career Score：並びは 未達 → 評価途中 → 未評価 → 基準未設定 → 達成、4 つの数・グレードと店と名前で絞る', () => {
  const c = csCtx(1440, L5);
  const h = c.u9CsListHtml(L5, 'pc', e => '<card>' + e.name + '</card>');
  assert.deepEqual([...h.matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]), ['Yan', 'Xia', 'Wes', 'Vic', 'Zed']);
  assert.match(h, /u9-tn" style="color:#15803d">1<\/span><span class="u9-tl">基準達成/);
  assert.match(h, /id="u9p-cs"><card>Yan<\/card>/, '右のパネルは今のカード');
  assert.match(h, /<td class="num">300 \/ 252<\/td><td class="num"><span style="color:#15803d;font-weight:800">\+48<\/span>/);
  assert.match(h, /<td class="num">200 \/ 252<\/td><td class="num"><span style="color:#c2410c;font-weight:800">−52<\/span>/);
  assert.match(h, /— \/ 294<\/td><td class="num">—/, '未評価は — / 基準点');
  assert.match(h, /未採点 5/);
  assert.match(h, /<td class="u9-wrap">強みX<\/td><td>2026-11-01/);
  c.u9St().f.cs = 'met'; assert.deepEqual([...c.u9CsListHtml(L5, 'pc', () => '').matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]), ['Zed']);
  c.u9St().f.cs = ''; c.u9St().sort['cs:g'] = 'G3'; assert.deepEqual([...c.u9CsListHtml(L5, 'pc', () => '').matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]), ['Xia', 'Wes']);
  c.u9St().sort['cs:g'] = ''; c.u9St().sort['cs:s'] = 'S2'; assert.deepEqual([...c.u9CsListHtml(L5, 'pc', () => '').matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]), ['Yan', 'Wes']);
  c.u9St().sort['cs:s'] = ''; c.u9St().q.cs = 'z'; assert.deepEqual([...c.u9CsListHtml(L5, 'pc', () => '').matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]), ['Zed']);
});
test('1 Career Score：スマホは 1 行の一覧（グレード・店・点）と全画面の箱を開く関数', () => {
  const c = csCtx(390, L5);
  const h = c.u9CsListHtml(L5, 'sp', e => 'card');
  assert.ok(!/u9-tbl/.test(h)); assert.match(h, /onclick="u9CsOpen\(this.getAttribute\('data-u9id'\)\)"/);
  assert.match(h, /<span class="ar-sm">G2 · Store Two · 200 \/ 252<\/span>/);
  assert.equal(typeof c.window._u9CsCard, 'function');
});
test('1 Career Score：画面は PC・スマホだけ新しい形、あいだは今のカードを 50 人ずつ、カードは 1 つの関数（csCardHtml）', () => {
  const src = fnSrc('renderLeadership');
  assert.match(src, /if \(viewOthers && \(_m9==='pc' \|\| _m9==='sp'\)\) \{\s*html \+= u9CsListHtml\(leaders, _m9, function\(e\)\{ return csCardHtml\(e, _m9==='pc' \? 'bare' : 'box'\); \}\);/);
  assert.match(src, /var _P9 = viewOthers \? u9Page\('cs', leaders\) : \{ slice:leaders \};\s*_P9\.slice\.forEach\(function\(e\)\{ html \+= csCardHtml\(e\); \}\);\s*if \(viewOthers\) html \+= u9Pager\(_P9\);/);
  assert.match(src, /uiPcWatch1179\(\)/);
  const cc = fnSrc('csCardHtml');
  assert.match(cc, /var btn = \(how==='box'\) \? ''/, '箱では下のボタンだけ（カードの中に同じボタンを出さない）');
  assert.match(cc, /escapeHtml\(e.name\)/);
});

/* ---------- 2. パイプライン ---------- */
test('2 パイプライン：最上位帯は出さない・状態で絞る・データのある人から準備度の高い順・パネルに担当軸', () => {
  const rows = [
    { e: { name: 'A', store: 'S1' }, status: 'dev', readiness: 30, hasData: true, grade: 'G1', path: { nextGrade: 'G2', nextTitle: 'CL' }, axisL4: 1, axisTotal: 4, ojtNeeded: true, ojtOk: false, weakAxis: 'B', ax: { L4: 75, perAxis: [{ key: 'A', name: '基本', pct: 80 }, { key: 'B', name: '接客', pct: 40 }] } },
    { e: { name: 'B', store: 'S2' }, status: 'nodata', readiness: 50, hasData: false, grade: 'G1', ax: {} },
    { e: { name: 'C', store: 'S1' }, status: 'can', readiness: 100, hasData: true, grade: 'G2', path: null, axisL4: 4, axisTotal: 4, ojtNeeded: false, ax: { L4: 75, perAxis: [] } },
    { e: { name: 'T', store: 'S1' }, topped: true, status: 'topped' }];
  const c = u9Ctx(1440, { pipeStatusMeta: s => ({ label: s, color: '#000' }), pipeCandRow: x => '<cand>' + x.e.name + '</cand>', pipeBar: p => '<bar ' + p + '>' }, ['u9PipeListHtml', 'u9PipePanel']);
  const h = c.u9PipeListHtml(rows, 'pc');
  assert.deepEqual([...h.matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]), ['C', 'A', 'B'], 'データのある人が先（データの無い人の準備度が高くても後ろ）');
  assert.match(h, /G1 → G2 CL/); assert.match(h, /<td class="num">1 \/ 4<\/td>/); assert.match(h, /<td>未<\/td>/); assert.match(h, /<td>不要<\/td>/);
  c.u9St().f.pipe = 'dev'; assert.deepEqual([...c.u9PipeListHtml(rows, 'pc').matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]), ['A']);
  const p = c.u9PipePanel(rows[0]);
  assert.match(p, /^<cand>A<\/cand>/); assert.match(p, /<bar 80>/); assert.match(p, /<b style="color:var\(--green\)">80%/); assert.match(p, /<b style="color:var\(--tm\)">40%/);
  assert.match(p, /ここでは昇格させません/);
  assert.ok(!/u9-axl/.test(c.u9PipePanel(rows[1])), 'データの無い人は担当軸を出さない');
});
test('2 パイプライン：組織図はたたみ、開いたかはこの端末に覚える・リーダー不在の店と最有力候補', () => {
  const ls = {};
  const c = u9Ctx(1440, { localStorage: { getItem: k => ls[k] || null, setItem: (k, v) => { ls[k] = v; } }, renderPipeOrg: () => '<org>',
    spStaffStats: id => ({ leader: id !== 'S2' }) }, ['u9PipeOrgHtml', 'u9PipeNoLeaderHtml']);
  assert.match(c.u9PipeOrgHtml([]), /<details class="card u9-org" ontoggle=/); ls._u9_pipe_org = '1'; assert.match(c.u9PipeOrgHtml([]), /<details class="card u9-org" open/);
  const rows = [{ e: { name: 'P', store: 'S2' }, gnum: 3, hasData: true, readiness: 60 }, { e: { name: 'Q', store: 'S2' }, gnum: 2, hasData: true, readiness: 90 }];
  const n = c.u9PipeNoLeaderHtml([{ id: 'S1', name: 'One' }, { id: 'S2', name: 'Two' }], rows);
  assert.match(n, /リーダー不在の店 1/); assert.match(n, /<b>Two<\/b> 最有力候補：P（準備度 60%）/, 'G3 のデータのある人を先に（今のマップと同じ）');
  assert.equal(c.u9PipeNoLeaderHtml([{ id: 'S1', name: 'One' }], rows), '');
  const src = fnSrc('renderTalentPipeline');
  assert.match(src, /u9PipeOrgHtml\(stores\)/); assert.match(src, /!r\.topped && \(!_f9 \|\| r\.status === _f9\)/);
});

/* ---------- 3. スキル ---------- */
test('3 スキル：店ごとの点・Lv3・未習得・次に取り組む／プレップの人は点を出さない／書きかけのコメントを聞く', () => {
  const c = u9Ctx(1440, { empStoresOf: e => e.stores, skillScoreStore: (n, s) => ({ total: s === 'S1' ? 5 : 2, lv3: 1 }), getEmpSkillsStore: () => ({ Grill: { status: '承認', level: 2 } }),
    getStorePositions: () => ['Grill', 'Fry', 'Host'], nextSkillSuggestions: () => ['「Fry」を習得（→Lv1）'], effectiveTipRate: n => n === 'B' ? 0 : 90, skillPosId: n => String(n) }, ['u9SkillStat', 'u9SkillListHtml', 'u9SkillGuard', 'u9DraftMark', 'sevnHasDraft', 'sevnDraft', 'sevnDraftMap', 'sevnKeep']);
  assert.deepEqual(JSON.parse(JSON.stringify(c.u9SkillStat({ name: 'A', stores: ['S1', 'S2'] }, 'ALL'))), { total: 7, lv3: 2, zero: 4, next: '「Fry」を習得（→Lv1）', stores: ['S1', 'S2'] });
  assert.equal(c.u9SkillStat({ name: 'A', stores: ['S1', 'S2'] }, 'S2').total, 2, '店を選んだらその店だけ');
  assert.equal(c.u9SkillStat({ name: 'P', prep: true, stores: ['S1'] }, 'ALL').total, null);
  assert.deepEqual(JSON.parse(JSON.stringify(c.u9SkillStat({ name: 'O', role: 'office', stores: [] }, 'ALL').stores)), ['OFFICE']);
  const h = c.u9SkillListHtml([{ name: 'B', stores: ['S1'] }, { name: 'A', stores: ['S1'] }, { name: 'P', prep: true, stores: ['S1'] }], 'ALL', 'pc', e => '<card ' + e.name + '>');
  assert.deepEqual([...h.matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]), ['A', 'B', 'P']);
  assert.match(h, /<td>No<\/td>/); assert.match(h, /<td>90%<\/td>/); assert.match(h, /プレップ評価/);
  assert.equal(c.u9St().guard.skill, c.u9SkillGuard);
  /* v1180：書きかけは人ごとに残すので聞かない（tests/skill-comment-v1180.test.mjs） */
  const c3 = u9Ctx(1440, { document: { querySelector: () => null, querySelectorAll: () => [] }, confirm: () => { throw new Error('聞かない'); } }, ['u9SkillGuard', 'sevnKeep', 'sevnDraftMap']);
  assert.equal(c3.u9SkillGuard(), true);
  const src = fnSrc('renderSkillStaffView');
  assert.match(src, /uiPcWatch1179\(\)/); assert.match(src, /u9SkillListHtml\(staff, selStore, _m9/); assert.match(src, /u9Page\('skill', staff\)/);
});

/* ---------- 4. 成長管理 ---------- */
test('4 成長管理：OJT の進み（G1 は G1→G2 の章・上は次の OJT の修了・最上位帯）と並び・絞り込み', () => {
  const prog = { A: { done: 0, total: 5, pct: 0, all: false }, B: { done: 3, total: 5, pct: 60, all: false }, C: { done: 5, total: 5, pct: 100, all: true } };
  const c = u9Ctx(1440, { empGradeNum: e => e.g, g2Progress: n => prog[n], PROMO_PATH: { G2: { ojt: 'G3 OJT', ojtKey: 'k' }, G6: {} }, ojtDone: n => n === 'D', progBar: p => '<pb ' + p + '>', u9GmPanel: () => '' }, ['u9OjtProgRow', 'u9OjtProgHtml']);
  const E = [{ name: 'A', g: 1 }, { name: 'B', g: 1 }, { name: 'C', g: 1 }, { name: 'D', g: 2 }, { name: 'F', g: 2 }, { name: 'T', g: 6 }];
  assert.deepEqual(E.map(e => c.u9OjtProgRow(e).kind), ['notyet', 'doing', 'done', 'done', 'notyet', 'top']);
  assert.equal(c.u9OjtProgRow(E[1]).label, 'G1→G2 Crew Leader OJT　3/5');
  const ids = () => [...c.u9OjtProgHtml(E).matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids(), ['A', 'B', 'C', 'D', 'F', 'T']);
  c.u9St().sort.ojtp = 'low'; assert.deepEqual(ids(), ['A', 'F', 'T', 'B', 'C', 'D']);
  c.u9St().sort.ojtp = 'high'; assert.deepEqual(ids(), ['C', 'D', 'B', 'A', 'F', 'T']);
  c.u9St().sort.ojtp = 'grade'; c.u9St().f.ojtp = 'notyet'; assert.deepEqual(ids(), ['A', 'F']);
  assert.match(fnSrc('renderOjtProgressList'), /u9OjtProgHtml\(emps\)/);
});
test('4 成長管理：90 日育成は始まっていなければ「未開始」（前の 0 日を出さない）・全画面で開く・戻ると位置', () => {
  const src = HTML.slice(HTML.indexOf('function u9GmStaffHtml('), HTML.indexOf('function u9OjtProgRow('));
  assert.ok(!/s\.dev\.days >= 0/.test(src)); assert.equal((src.match(/s\.dev && s\.dev\.start \?/g) || []).length, 2);
  assert.match(fnSrc('u9GmStaffHtml'), /if \(mode !== 'pc' && mode !== 'sp'\) return null;/);
  assert.match(fnSrc('u9GmPanel'), /growthMgrOpen\(\\'' \+ nm \+ '\\'\)/);
  assert.match(fnSrc('growthMgrOpen'), /_gmBackY/); assert.match(fnSrc('growthMgrBack'), /_gmBackY/);
  assert.match(fnSrc('renderGrowthManager'), /var _u9 = \(typeof u9GmStaffHtml==='function'\) \? u9GmStaffHtml\(\) : null;/);
});

/* ---------- 5. OJT管理 ---------- */
function ojtCtx(width, saved) {
  const store = { k1: JSON.stringify(saved) };
  const c = u9Ctx(width, {
    ojtAdminKey: 'k1', getOjtDefK: k => JSON.parse(store[k]), setStore: (k, v) => { store[k] = JSON.stringify(v); },
    ojtModCardHtml: (m, i) => '<mod ' + i + ' ' + m.title + '>',
  }, ['u9OjtBaseNote', 'u9OjtDirtyK', 'u9OjtDirty', 'u9OjtDirtyAny', 'u9OjtChapterList', 'u9OjtBar', 'u9OjtChapterHtml', 'u9OjtEditorHtml']);
  c.window._ojtDraftMap = { k1: JSON.parse(store.k1) }; c.window._ojtDraft = c.window._ojtDraftMap.k1;
  return { c, store };
}
const OJT = { modules: [{ id: 'm1', no: '1', title: 'One', axis: 'A', knowledge: ['a', 'b'], checks: ['c'], hasTest: true }, { id: 'm2', no: '2', title: 'Two', axis: 'B', knowledge: [], checks: [] }, { id: 'm3', no: '3', title: 'Three', axis: 'A' }], tests: { m1: [{ q: 'q' }] } };
test('5 OJT：保存していない変更は「保存した内容」とも「開いたときの下書き」とも違うときだけ（ほかの端末の保存だけでは数えない）', () => {
  const { c, store } = ojtCtx(1440, OJT);
  c.u9OjtBaseNote();
  assert.equal(c.u9OjtDirty(), false);
  store.k1 = JSON.stringify({ ...OJT, modules: OJT.modules.map(m => ({ ...m, title: m.title + '!' })) });
  assert.equal(c.u9OjtDirty(), false, 'ほかの端末が保存しただけ');
  c.window._ojtDraft.modules[0].title = 'Edited';
  assert.equal(c.u9OjtDirty(), true); assert.equal(c.u9OjtDirtyAny(), true);
  store.k1 = JSON.stringify(c.window._ojtDraft); assert.equal(c.u9OjtDirty(), false, '保存したら消える');
  c.window._ojtDraft.modules[0].title = 'One'; store.k1 = JSON.stringify({ ...OJT, tests: {} });
  assert.equal(c.u9OjtDirty(), false, '元に戻したら変更なし');
  assert.match(fnSrc('ojtSaveDraft'), /_u9OjtBase\|\|\(window\._u9OjtBase=\{\}\)\)\[ojtAdminKey\]=JSON\.stringify\(window\._ojtDraft\)/, '保存したら「開いたときの下書き」を新しく');
  assert.match(fnSrc('ojtResetDraft'), /_u9OjtBase/);
});
test('5 OJT：PC は章の一覧と 1 章・スマホは一覧 → 1 章（下に前・次・保存）・あいだは null（今の全部の章）', () => {
  const { c } = ojtCtx(1440, OJT);
  const aCol = { A: '#f00' };
  let h = c.u9OjtEditorHtml(c.window._ojtDraft, [], aCol);
  assert.match(h, /u9-ojt-pc/); assert.equal((h.match(/<mod /g) || []).length, 1); assert.match(h, /<mod 0 One>/);
  assert.match(h, /章 1 \/ 3/); assert.match(h, /知識 2 · チェック 1 · テスト 1/); assert.match(h, /u9-ch on" aria-current="true" style="border-left-color:#f00"/);
  assert.match(h, /onclick="u9OjtGo\(-1\)" disabled/); assert.match(h, /onclick="u9OjtGo\(1\)"/); assert.match(h, /保存していない変更はありません/);
  c.u9St().sel['ojt:k1'] = 9; h = c.u9OjtEditorHtml(c.window._ojtDraft, [], aCol); assert.match(h, /<mod 2 Three>/); assert.match(h, /onclick="u9OjtGo\(3\)" disabled/);
  const s = ojtCtx(390, OJT).c;
  let sp = s.u9OjtEditorHtml(s.window._ojtDraft, [], aCol);
  assert.equal((sp.match(/<mod /g) || []).length, 0); assert.equal((sp.match(/class="u9-ch[ "]/g) || []).length, 3); assert.ok(!/u9-ojt-bar/.test(sp), '変更が無ければ下のバーは出さない');
  s.window._ojtDraft.modules[1].title = 'X'; s.u9OjtBaseNote && 0;
  s.u9St().f['ojt:open:k1'] = true; s.u9St().sel['ojt:k1'] = 1;
  sp = s.u9OjtEditorHtml(s.window._ojtDraft, [], aCol);
  assert.match(sp, /u9-ojt-sp/); assert.match(sp, /u9OjtList\(\)/); assert.match(sp, /<mod 1 X>/); assert.match(sp, /u9-ojt-bar/);
  assert.equal(ojtCtx(800, OJT).c.u9OjtEditorHtml(OJT, [], aCol), null);
  assert.equal(c.u9OjtEditorHtml({ modules: [] }, [], aCol), null);
  const src = fnSrc('renderOjtAdmin');
  assert.match(src, /u9OjtEditorHtml\(d, axisOpts, aCol\)/); assert.match(src, /d\.modules\.forEach\(function\(m, idx\)\{ html \+= ojtModCardHtml\(m, idx, axisOpts, aCol\); \}\)/);
  assert.match(src, /u9OjtBaseNote\(\)/); assert.match(src, /u9OjtLeaveInstall\(\)/); assert.match(src, /'<div data-ojted>'/);
  assert.match(src, /if \(_u9 != null\) return html \+ '<div data-ojted>' \+ _u9 \+ '<\/div>';/, 'PC・スマホでは新しい形を返す');
});
test('5 OJT：ほかの画面へ移る前に聞く（保存していない変更があるときだけ・OJT管理の中では聞かない）', () => {
  let went = []; let ans = false, asked = 0;
  const c = u9Ctx(1440, { go: p => { went.push(p); }, confirm: () => { asked++; return ans; }, curPage: 'ojt_admin', getOjtDefK: () => ({ a: 1 }), addEventListener() {} }, ['u9OjtLeaveInstall', 'u9OjtDirtyAny', 'u9OjtDirtyK']);
  c.window.addEventListener = () => {};
  c.window._ojtDraftMap = { k: { a: 2 } }; c.window._u9OjtBase = { k: JSON.stringify({ a: 1 }) };
  c.u9OjtLeaveInstall();
  vm.runInContext("go('dashboard')", c); assert.deepEqual(went, []); assert.equal(asked, 1);
  ans = true; vm.runInContext("go('dashboard')", c); assert.deepEqual(went, ['dashboard']);
  vm.runInContext("go('ojt_admin')", c); assert.equal(asked, 2, 'OJT管理の中では聞かない');
  c.window._ojtDraftMap = { k: { a: 1 } }; vm.runInContext("go('skill')", c); assert.equal(asked, 2, '変更が無ければ聞かない');
  c.u9OjtLeaveInstall(); vm.runInContext("go('x')", c); assert.equal(went.filter(p => p === 'x').length, 1, '2 回包まない');
  c.window._ojtDraftMap = { k: { a: 2 } }; const a0 = asked; ans = true; vm.runInContext("go('y')", c);
  assert.equal(asked - a0, 1, '2 回包まない（聞くのは 1 回だけ）'); assert.equal(went.filter(p => p === 'y').length, 1);
});
test('5 OJT：選択式の正解と解説が下書きに入る（前は押しても入らなかった）・範囲の外は入れない', () => {
  const renders = [];
  const c = ctxOf({ window: {}, renderPage: p => renders.push(p) });
  vm.runInContext(fnSrc('ojtTestQEdit'), c);
  c.window._ojtDraft = { tests: { m1: [{ q: '', choices: ['a', 'b', 'c', 'd'], a: 0 }, { q: '記述' }] } };
  c.ojtTestQEdit('m1', 0, 'a', 2); assert.equal(c.window._ojtDraft.tests.m1[0].a, 2); assert.deepEqual(renders, ['ojt_admin']);
  c.ojtTestQEdit('m1', 0, 'a', 2); assert.equal(renders.length, 1, '同じなら描き直さない');
  c.ojtTestQEdit('m1', 0, 'a', 4); c.ojtTestQEdit('m1', 0, 'a', -1); c.ojtTestQEdit('m1', 0, 'a', 1.5); c.ojtTestQEdit('m1', 1, 'a', 0);
  assert.equal(c.window._ojtDraft.tests.m1[0].a, 2); assert.equal(c.window._ojtDraft.tests.m1[1].a, undefined);
  c.ojtTestQEdit('m1', 0, 'why', '理由'); assert.equal(c.window._ojtDraft.tests.m1[0].why, '理由');
  c.ojtTestQEdit('m1', 0, 'q', 'Q'); c.ojtTestQEdit('m1', 0, 'guide', 'G'); assert.deepEqual([c.window._ojtDraft.tests.m1[0].q, c.window._ojtDraft.tests.m1[0].guide], ['Q', 'G']);
});
test('5 OJT：「×」と正解の丸に押す範囲（PC 32px・タッチ 44px）・正解の丸はキーボードで押せる', () => {
  const te = fnSrc('ojtTestEditor');
  assert.match(te, /class="ojt-ans" role="button" tabindex="0" aria-pressed="'\+\(q\.a===ci\?'true':'false'\)\+'"/);
  assert.match(te, /onkeydown="if\(event\.key===\\'Enter\\'\|\|event\.key===\\' \\'\)\{event\.preventDefault\(\);this\.click\(\);\}"/);
  for (const f of ['ojtKnowEditor', 'ojtChecksEditor', 'ojtTestEditor']) { const s = fnSrc(f); assert.match(s, /class="ojt-xrow"/, f); assert.match(s, /btn-sm ojt-x"/, f); assert.match(s, /aria-label="(この設問を)?削除"/, f); }
  assert.match(HTML, /\.ojt-x::after \{ content:''; position:absolute; left:50%; top:50%; width:32px; height:32px;/);
  assert.match(HTML, /@media \(pointer: coarse\) \{\n  \.ojt-x::after, \.ojt-ans::after \{ width:44px; height:44px; \}\n  \[data-ojted\] \.ojt-xrow \{ min-height:44px;/);
});

/* ---------- 共通の守り ---------- */
test('幅をまたいだら描き直す（4 つの画面・箱と入力中は待つ・残せない入力があれば待つ）', () => {
  const src = fnSrc('uiPcWatch1179');
  assert.match(src, /var pages = \['leadership', 'skill', 'growth_mgr', 'ojt_admin'\];/);
  assert.match(src, /if \(\(ov && ov\.classList\.contains\('open'\)\) \|\| typing\) \{ clearTimeout\(on\._t\); on\._t = setTimeout\(on, 1500\); return; \}/);
  assert.match(src, /try \{ done = uiRedrawKeep\(curPage\); \} catch \(e\) \{ \}\n      if \(!done\)/);
  assert.match(src, /add\(mq, on\); add\(window\.matchMedia\('\(max-width:767px\)'\), on\);/);
  for (const f of ['renderLeadership', 'renderSkillStaffView', 'renderGrowthManager', 'renderOjtAdmin']) assert.match(fnSrc(f), /uiPcWatch1179\(\)/, f);
});
test('#175・#176 の Codex の P3：描き直しの前後で「開いているもの・位置」を残す・選ぶ欄の初めの値は選べる最初のもの', () => {
  const k = fnSrc('uiRedrawKeep');
  assert.match(k, /snap = \(typeof UXo\.snapMain === 'function'\) \? UXo\.snapMain\(\) : null/);
  assert.ok((k.match(/fix\(\)/g) || []).length >= 3, '描いたあと・前に戻したあと・入力を戻したあとに位置を戻す');
  assert.ok(k.indexOf('snapMain') < k.indexOf('root.firstChild'), '中身を外す前に覚える');
  assert.match(HTML, /UX\.snapMain = function\(\)\{ try\{ var m = mainEl\(\); return m \? snapshot\(m\) : null; \}catch\(e\)\{ return null; \} \};/);
  assert.match(HTML, /UX\.restoreMain = function\(s\)\{ try\{ if\(s\) restore\(mainEl\(\), s\); \}catch\(e\)\{\} \};/);
  /* uiDirtyFields：selected の無い 1 つ選ぶ欄の初めの値は「選べる最初の」選択肢（disabled の「選んでください」ではない） */
  const c = ctxOf({});
  vm.runInContext(fnSrc('uiDirtyFields'), c);
  const sel = { tagName: 'SELECT', id: 's1', type: 'select-one', multiple: false, size: 0, value: 'b', disabled: false,
    options: [{ value: '', disabled: true, defaultSelected: false }, { value: 'b', disabled: false, defaultSelected: false }, { value: 'c', disabled: false, defaultSelected: false }] };
  const root = { querySelectorAll: () => [sel] };
  assert.equal(c.uiDirtyFields(root).list.length, 0, '開いたまま（b）なら変えていない');
  sel.value = 'c'; assert.equal(c.uiDirtyFields(root).list.length, 1);
});
test('チャットのボタン：PC は下のバーの「保存」が隠れない余白・スマホで 1 章を直しているあいだは出さない', () => {
  assert.match(HTML, /@media \(min-width:821px\) \{ \.u9-ojt-pc \.u9-ojt-bar \{ padding-right:150px; \} \}/);
  assert.match(HTML, /@media \(max-width:767px\) \{ body:has\(#main-content \.u9-ojt-sp\) \.chat-fab \{ display:none; \} \}/);
});
