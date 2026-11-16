// v1180：#177（v1179）の Codex の P2 2 つ（スキルの評価コメント）と Claude のルーティンの P3 2 つの直し。
// 合成データ・本番に接続しない。index.html の関数を VM で動かす。画面は tests/e2e-pcsp/skill-comment-v1180.mjs（Chromium）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
function fnSrc(name, from = 0) {
  const i = HTML.indexOf('function ' + name + '(', from);
  assert.ok(i >= 0, name + ' がある');
  const j = HTML.indexOf('{', i);
  let depth = 0;
  for (let k = j; k < HTML.length; k++) { const ch = HTML[k]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return HTML.slice(i, k + 1); } }
  throw new Error('関数の終わりが無い：' + name);
}
const esc = x => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const U9_BASE = ['arMode', 'u9Mode', 'u9St', 'u9Reset', 'u9Page', 'u9Pager', 'u9GoPage', 'u9SetF', 'u9SetV', 'u9QMatch', 'u9SearchHtml', 'u9TableHtml', 'u9Pick', 'u9SpListHtml', 'u9StoreName', 'u9Q'];
const SEVN = ['sevnDraftMap', 'sevnKeep', 'sevnDraft', 'sevnHasDraft', 'u9DraftMark', 'u9DraftMarkSync', 'u9SkillGuard'];
const mm = w => q => { const m = q.match(/\((min|max)-width:\s*(\d+)px\)/); const v = +m[2]; return { matches: m[1] === 'min' ? w >= v : w <= v, addEventListener() {} }; };
function ctx(extra = {}, fns = [], width = 1440) {
  const c = { Math, Number, String, Object, Array, JSON, isNaN, isFinite, parseInt, parseFloat, console, Date, RegExp,
    setTimeout: () => 0, clearTimeout() {}, t: (j, e) => j, escapeHtml: esc, window: { matchMedia: mm(width) }, curUserName: 'Moto', curRole: 'gm',
    renders: [], toasts: [], opened: [], skillPosId: n => String(n).replace(/[^A-Za-z0-9]/g, '_'),
    STORES: [{ id: 'S1', name: 'Store One' }], curPage: 'skill',
    document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null }, ...extra };
  if (!c.renderPage) c.renderPage = p => c.renders.push(p);
  if (!c.showToast) c.showToast = (m, k) => c.toasts.push([m, k]);
  vm.createContext(c);
  vm.runInContext('var U9_PER = 50;\n' + [...new Set(U9_BASE.concat(SEVN, fns))].map(n => fnSrc(n)).join('\n'), c);
  return c;
}
function logCtx(log, extra = {}, fns = []) {
  const store = { skill_eval_log: { B: log } };
  const c = ctx({ ls: (k, d) => JSON.parse(JSON.stringify(store[k] || d)), lsSet: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); }, nowJP: () => '2026/11/15 23:00', ROLE_CONFIG: { gm: { name: 'GM' } }, ...extra },
    ['getSkillEvalLog', 'addSkillEvalNote', 'deleteSkillEvalNote', 'submitSkillEvalNote', 'skillEvalRefresh', 'skillEvalFp', 'skillEvalDelBtn', 'skillEvalSectionHtml'].concat(fns));
  c.store = store;
  c.u9SkillOpen = n => c.opened.push(n);
  return c;
}

test('版：ページと SW が同じ（1180 以上）', () => {
  const a = +(HTML.match(/const APP_VERSION = '(\d+)'/) || [])[1], s = +(SW.match(/const SW_BUILD = '(\d+)'/) || [])[1];
  assert.ok(a >= 1180 && a === s, a + ' / ' + s);
});

test('書きかけ：人（欄）ごとに残す・空にすると消える・コメントの欄だけ・ログインが変わったら前の人の分は使わない・ログアウトで消える', () => {
  const c = ctx();
  c.sevnKeep({ id: 'sevn-A', value: '良かった点' });
  c.sevnKeep({ id: 'sevn-B', value: '<b>次</b>' });
  c.sevnKeep({ id: 'mr-x', value: 'ほかの欄' });
  assert.equal(c.sevnDraft('sevn-A'), '良かった点'); assert.equal(c.sevnDraft('sevn-B'), '<b>次</b>'); assert.equal(c.sevnDraft('mr-x'), ''); assert.ok(!('mr-x' in c.window._sevnDraft), 'ほかの欄は覚えない');
  assert.equal(c.sevnHasDraft('A'), true); assert.equal(c.sevnHasDraft('C'), false);
  c.sevnKeep({ id: 'sevn-A', value: '   ' }); assert.equal(c.sevnDraft('sevn-A'), '', '空白だけにしたら消す');
  c.curUserName = 'Other'; assert.equal(c.sevnDraft('sevn-B'), '', 'ほかの人のログインでは前の人の書きかけを出さない');
  c.curUserName = 'Moto'; assert.equal(c.sevnDraft('sevn-B'), '', '一度ほかの人になったら戻っても前の分は捨てている');
  c.sevnKeep({ id: 'sevn-B', value: 'x' }); c.window._u9 = { sel: { skill: 'B' } }; c.window._u9SkillCard = () => '';
  c.u9Reset(); assert.equal(c.window._sevnDraft, null); assert.equal(c.window._u9, null); assert.equal(c.window._u9SkillCard, null); assert.equal(c.sevnDraft('sevn-B'), '');
  for (const src of [...HTML.matchAll(/function doLogout\(\) \{/g)].map(m => fnSrc('doLogout', m.index))) {
    assert.match(src, /if\(typeof u9Reset==='function'\) u9Reset\(\);/, 'ログアウトで u9 の状態と書きかけを消す');
  }
  assert.equal((HTML.match(/if\(typeof u9Reset==='function'\) u9Reset\(\);/g) || []).length, 2, 'doLogout の 2 つの写しの両方');
});

test('P2-2：ほかの人を開く・ページ送り・名前で探す・店の切り替えで、書きかけが消えない（聞かずに残す）', () => {
  const tas = [{ id: 'sevn-A', value: '書いている途中' }];
  const c = ctx({ document: { querySelector: () => null, querySelectorAll: s => /sevn-/.test(s) ? tas : [], getElementById: () => null }, confirm: () => { throw new Error('聞かない'); } });
  assert.equal(c.u9SkillGuard(), true);
  assert.equal(c.sevnDraft('sevn-A'), '書いている途中', 'ほかの人を開く前に今の欄を残す');
  /* 欄が画面から無くなっても（ページ送り・探す・店の切り替えで描き直したあと）書きかけは残っている */
  tas.length = 0; c.u9GoPage('skill', 2); c.u9SetV('skill', 'q', 'zz');
  assert.equal(c.sevnDraft('sevn-A'), '書いている途中');
  /* その人のコメントの欄を描き直すと戻る（PC の右のパネル・スマホの箱・あいだの幅のカード） */
  const l = logCtx([], { document: c.document });
  l.window._sevnDraft = c.window._sevnDraft;
  const h = l.skillEvalSectionHtml('A');
  assert.match(h, /<textarea id="sevn-A"[^>]*oninput="sevnKeep\(this\)">書いている途中<\/textarea>/);
  l.window._sevnDraft = { _u: 'Moto', 'sevn-A': '</textarea><img src=x onerror=alert(1)>' };
  assert.match(l.skillEvalSectionHtml('A'), /&lt;\/textarea&gt;&lt;img src=x onerror=alert\(1\)&gt;<\/textarea>/, '書きかけは文字として戻す');
  /* u9SkillListHtml は描き直す前に、まだ画面にある欄を残す */
  assert.match(fnSrc('u9SkillListHtml'), /querySelectorAll\('textarea\[id\^="sevn-"\]'\)\.forEach\(function\(ta\)\{ sevnKeep\(ta\); \}\)/);
});

test('一覧の印：書きかけのある人に「書きかけ」（PC の名前の列・スマホの行）', () => {
  const extra = { empStoresOf: () => ['S1'], skillScoreStore: () => ({ total: 3, lv3: 1 }), getEmpSkillsStore: () => ({}), getStorePositions: () => ['Grill'], nextSkillSuggestions: () => [], effectiveTipRate: () => 90 };
  const staff = [{ name: 'A', stores: ['S1'] }, { name: 'B', stores: ['S1'] }];
  const pc = ctx(extra, ['u9SkillStat', 'u9SkillListHtml']);
  pc.sevnKeep({ id: 'sevn-B', value: 'メモ' });
  const h = pc.u9SkillListHtml(staff, 'ALL', 'pc', e => '<card ' + e.name + '>');
  assert.equal((h.match(/class="u9-draft"/g) || []).length, 1); assert.match(h, /<b>B<\/b> <span class="u9-draft">書きかけ<\/span>/);
  const sp = ctx(extra, ['u9SkillStat', 'u9SkillListHtml'], 390);
  sp.sevnKeep({ id: 'sevn-A', value: 'メモ' });
  const s = sp.u9SkillListHtml(staff, 'ALL', 'sp', e => '');
  assert.equal((s.match(/class="u9-draft"/g) || []).length, 1); assert.match(s, /data-u9id="A"[\s\S]*?u9-draft[\s\S]*?data-u9id="B"/);
  assert.match(HTML, /\.u9-draft \{[^}]*font-size:11px/, '印の文字は 11px');
  /* 一覧を描き直さなくても（PC のパネルで打つ・スマホで箱を閉じる）その行の印をその場で付け外す */
  const mkRow = (id, sp) => { const r = { id, kids: [], getAttribute: k => k === 'data-u9id' ? id : null,
    querySelector: s => s === '.u9-draft' ? (r.kids.find(k => k.cls === 'u9-draft') || null) : ((sp && s === '.ar-sv') || (!sp && s === 'td b')) ? { insertAdjacentHTML: (w, h) => { if (/u9-draft/.test(h)) r.kids.push({ cls: 'u9-draft', previousSibling: null, remove: () => { r.kids = r.kids.filter(k => k.cls !== 'u9-draft'); } }); } } : null }; return r; };
  const rows = [mkRow('A', false), mkRow('B', false)];
  const m = ctx({ document: { querySelector: () => null, querySelectorAll: s => /data-u9id/.test(s) ? rows : [], getElementById: () => null } });
  m.sevnKeep({ id: 'sevn-B', value: 'x', getAttribute: k => k === 'data-n' ? 'B' : null });
  assert.equal(rows[1].kids.length, 1); assert.equal(rows[0].kids.length, 0);
  m.sevnKeep({ id: 'sevn-B', value: 'xy', getAttribute: k => k === 'data-n' ? 'B' : null }); assert.equal(rows[1].kids.length, 1, '二重に付けない');
  m.sevnKeep({ id: 'sevn-B', value: ' ', getAttribute: k => k === 'data-n' ? 'B' : null }); assert.equal(rows[1].kids.length, 0, '空にしたら外す');
  const sr = [mkRow('C', true)]; const s2 = ctx({ document: { querySelector: () => null, querySelectorAll: s => /data-u9id/.test(s) ? sr : [], getElementById: () => null } });
  s2.sevnKeep({ id: 'sevn-C', value: 'y', getAttribute: k => k === 'data-n' ? 'C' : null }); assert.equal(sr[0].kids.length, 1, 'スマホの行（名前のあと）');
});

test('P2-1：記録したら欄を空に・書きかけを消す・一覧を描き直し、スマホの箱が開いていればその人の箱を新しくする（同じ文を二度送らない）', () => {
  const c = logCtx([]);
  const el = { id: 'sevn-B', value: '声が出ていた', closest: s => s === '#modal-body' ? {} : null };
  c.document.getElementById = () => el;
  c.sevnKeep(el);
  c.submitSkillEvalNote('B', 'sevn-B');
  assert.equal(c.store.skill_eval_log.B.length, 1); assert.equal(c.store.skill_eval_log.B[0].text, '声が出ていた');
  assert.equal(el.value, ''); assert.equal(c.sevnDraft('sevn-B'), '');
  assert.deepEqual(c.renders, ['skill']); assert.deepEqual(c.opened, ['B'], 'スマホの箱の中身も新しくする');
  assert.equal(c.toasts.at(-1)[1], 'success');
  /* もう一度押しても（欄は空）2 回目は記録しない・入力の案内だけ */
  c.submitSkillEvalNote('B', 'sevn-B');
  assert.equal(c.store.skill_eval_log.B.length, 1); assert.equal(c.toasts.at(-1)[1], 'warning'); assert.deepEqual(c.renders, ['skill']); assert.deepEqual(c.opened, ['B']);
  /* PC（箱の外）では一覧だけ描き直す */
  const p = logCtx([]); const el2 = { id: 'sevn-B', value: 'ok', closest: () => null }; p.document.getElementById = () => el2;
  p.submitSkillEvalNote('B', 'sevn-B'); assert.deepEqual(p.renders, ['skill']); assert.deepEqual(p.opened, []);
  /* 失敗（空）のときは欄を残す */
  const f = logCtx([]); const el3 = { id: 'sevn-B', value: '   ', closest: () => null }; f.document.getElementById = () => el3;
  f.submitSkillEvalNote('B', 'sevn-B'); assert.equal(el3.value, '   '); assert.deepEqual(f.renders, []);
});

test('P2-1：削除は画面に出ていたコメントと同じものだけ。消したら箱も新しくする・あいだに並びが変わっても別のコメントを消さない', () => {
  const A = { date: '11/01', by: 'GM', text: 'a' }, B = { date: '11/02', by: 'GM', text: 'b' }, C = { date: '11/03', by: 'AM', text: 'c' };
  const btn = (c, idx, en, inBox = true) => ({ getAttribute: k => ({ 'data-n': 'B', 'data-i': String(idx), 'data-fp': c.skillEvalFp(en) })[k], closest: s => (inBox && s === '#modal-body') ? {} : null });
  let c = logCtx([A, B, C], { confirm: () => true });
  c.skillEvalDelBtn(btn(c, 1, B));
  assert.deepEqual(c.store.skill_eval_log.B.map(x => x.text), ['a', 'c']); assert.deepEqual(c.renders, ['skill']); assert.deepEqual(c.opened, ['B']);
  /* 箱は古いまま（C は 2 番目と思っている）だが、ほかで A が消えて C が 1 番目になった → C を探して消す。b は残る */
  c = logCtx([B, C], { confirm: () => true });
  c.skillEvalDelBtn(btn(c, 2, C));
  assert.deepEqual(c.store.skill_eval_log.B.map(x => x.text), ['b']);
  /* 同じ番号に別のコメントがいる（古い番号）→ 番号では消さない */
  c = logCtx([A, C], { confirm: () => true });
  c.skillEvalDelBtn(btn(c, 1, B));
  assert.deepEqual(c.store.skill_eval_log.B.map(x => x.text), ['a', 'c'], 'もう無いコメントは消さない');
  assert.equal(c.toasts.at(-1)[1], 'warning'); assert.deepEqual(c.opened, ['B'], '新しい中身を見せる');
  /* やめたら何もしない */
  c = logCtx([A, B], { confirm: () => false });
  c.skillEvalDelBtn(btn(c, 0, A)); assert.equal(c.store.skill_eval_log.B.length, 2); assert.deepEqual(c.renders, []);
  /* ボタンの形：onclick に名前を入れない・確かめは関数の中 */
  c = logCtx([A, { date: '11/02', by: 'GM', text: '"<x>\'' }]);
  const h = c.skillEvalSectionHtml('B');
  assert.match(h, /data-n="B" data-i="1" data-fp="11\/02\|GM\|&quot;&lt;x&gt;&#39;" onclick="skillEvalDelBtn\(this\)">削除<\/button>/);
  assert.ok(!/deleteSkillEvalNote\(/.test(h) && !/confirm\(/.test(h), '前の onclick（番号だけで消す）は使わない');
  /* 削除できるのは GM・CEO・AM だけ（前と同じ） */
  const s = logCtx([A], { curRole: 'sl' }); assert.ok(!/skillEvalDelBtn/.test(s.skillEvalSectionHtml('B')));
});

test('英語：コメントの欄の文字（前は日本語だけ）', () => {
  const c = logCtx([], { t: (j, e) => e });
  const h = c.skillEvalSectionHtml('B');
  assert.match(h, /No comments yet/); assert.match(h, /Comments/); assert.match(h, /placeholder="Record an evaluation or feedback \(added to the log\)"/); assert.match(h, /<\/i> Save<\/button>/);
});

test('P3：スマホの OJT の「章を開いている」は OJT の種類ごと／成長管理の並びは 1 人 1 回だけ数える', () => {
  assert.equal((HTML.match(/S\.f\['ojt:open:' \+ ojtAdminKey\]/g) || []).length, 3);
  assert.ok(!/\['ojt:open'\]/.test(HTML), '種類を見ない印は残っていない');
  const people = Array.from({ length: 30 }, (_, i) => ({ name: 'P' + String(i).padStart(2, '0'), role: 'crew', store: 'S1' }));
  let calls = 0;
  const c = ctx({ visibleStaffForManager: () => people, isLeaderTrackEmp: () => false, growthStoreMatch: () => true,
    getEmpSkills: n => { calls++; return { Grill: { status: '承認', level: (n.charCodeAt(2) % 4) } }; },
    u9GmStat: () => ({ cov: '1/3', lv2: 0, lv3: 0, ojt: '0/5', pct: 0, dev: null, rate: 90 }), u9GmPanel: () => '', progBar: () => '' }, ['u9GmStaffHtml']);
  const h = c.u9GmStaffHtml();
  assert.equal(calls, 30, '並べるときに getEmpSkills は 1 人 1 回');
  assert.match(h, /data-u9id="P/);
});
