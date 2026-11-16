// v1178（UI案86・Moto さん 11/15 16:33 HST「全部A」）。
// 合成データ・本番に接続しない。index.html の関数を VM で動かすか、形を確かめる。画面の見た目は tests/e2e-pcsp/ui86-v1178.mjs（Chromium）。
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
const esc = x => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ctxOf = (extra = {}) => { const c = { Math, Number, String, Object, Array, JSON, isNaN, isFinite, parseInt, parseFloat, console, Date, t: (j, e) => j, escapeHtml: esc, ...extra }; vm.createContext(c); return c; };
const mm = w => ({ matchMedia: q => { const m = q.match(/\((min|max)-width:\s*(\d+)px\)/); const v = +m[2]; return { matches: m[1] === 'min' ? w >= v : w <= v, addEventListener() {} }; } });

test('版：ページと SW が同じ（1178 以上）', () => {
  const a = +(HTML.match(/const APP_VERSION = '(\d+)'/) || [])[1], s = +(SW.match(/const SW_BUILD = '(\d+)'/) || [])[1];
  assert.ok(a >= 1178 && a === s, a + ' / ' + s);
});

/* ---------- 1A 経理レビュー › 書類 ---------- */
const AR_FNS = ['arFilterRows', 'arMode', 'arPageOf', 'arPagerHtml', 'arNextPlan', 'arAdvance', 'arRowsNow'];
function arCtx(width, docs) {
  const win = { ...mm(width), _arType: 'ALL', _arStore: 'ALL', _arMonth: 'ALL', _arStatus: 'ALL', _arPage: 1, _arSel: null };
  const c = ctxOf({ window: win, AR_PER: 50,
    arStatusRank: s => ({ '未確認': 0, '確認中': 1, '差し戻し': 2, '確認済み': 3 })[s] ?? 9,
    _invDate: inv => new Date(inv.date), arDocYm: inv => String(inv.date).slice(0, 7), arReviewList: () => docs });
  vm.runInContext(AR_FNS.map(fnSrc).join('\n'), c);
  return c;
}
const mkDocs = (n, st = () => '未確認') => Array.from({ length: n }, (_, i) => ({ id: 'd' + i, date: '2026-11-' + String(1 + (i % 28)).padStart(2, '0'), reviewStatus: st(i), storeId: 'S' + (i % 3), docType: 'Invoice' }));

test('1A 幅で形：1024px 以上＝pc、767px まで＝sp、そのあいだ＝mid（matchMedia が無ければ mid）', () => {
  assert.equal(arCtx(1440, []).arMode(), 'pc');
  assert.equal(arCtx(1024, []).arMode(), 'pc');
  assert.equal(arCtx(1023, []).arMode(), 'mid');
  assert.equal(arCtx(768, []).arMode(), 'mid');
  assert.equal(arCtx(767, []).arMode(), 'sp');
  assert.equal(arCtx(390, []).arMode(), 'sp');
  const c = ctxOf({ window: {} }); vm.runInContext(fnSrc('arMode'), c); assert.equal(c.arMode(), 'mid');
});

test('1A 50 件ずつ：ページの数・はみ出したページは最後に寄せる・「1〜50 件目 / N 件」・1 ページなら出さない', () => {
  const docs = mkDocs(120), c = arCtx(1440, docs);
  const rows = c.arFilterRows(docs);
  let P = c.arPageOf(rows);
  assert.deepEqual([P.page, P.pages, P.total, P.from, P.to, P.slice.length], [1, 3, 120, 0, 50, 50]);
  const h1 = c.arPagerHtml(P);
  assert.match(h1, /1〜50 件目 \/ 120 件/); assert.match(h1, /aria-current="page"/); assert.match(h1, /‹ 前へ<\/button>/);
  assert.match(h1, /class="btn btn-secondary btn-sm ar-pg pv" disabled/, '1 ページ目では「前へ」を押せない');
  c.window._arPage = 9; P = c.arPageOf(rows);
  assert.deepEqual([P.page, P.from, P.to, P.slice.length], [3, 100, 120, 20], '多すぎるページは最後に');
  assert.match(c.arPagerHtml(P), /101〜120 件目 \/ 120 件/);
  c.window._arPage = 'x'; assert.equal(c.arPageOf(rows).page, 1);
  assert.equal(c.arPagerHtml(c.arPageOf(rows.slice(0, 50))), '', '50 件以下は出さない');
  const big = arCtx(1440, mkDocs(1000)); big.window._arPage = 10;
  const hb = big.arPagerHtml(big.arPageOf(big.arFilterRows(mkDocs(1000))));
  assert.deepEqual([...hb.matchAll(/onclick="arGoPage\((\d+)\)"/g)].map(m => +m[1]), [9, 1, 9, 11, 20, 11], '前へ 9・1 … 9 10 11 … 20・次へ 11');
  assert.ok(/>1<\/button>/.test(hb) && (hb.match(/ar-gap/g) || []).length === 2);
});

test('1A 並び：未確認 → 確認中 → 差し戻し → 確認済み、同じ状態は新しい日付から。絞り込みは今と同じ 4 つ', () => {
  const docs = [
    { id: 'a', date: '2026-11-01', reviewStatus: '確認済み', storeId: 'S1' }, { id: 'b', date: '2026-11-05', storeId: 'S1' },
    { id: 'c', date: '2026-11-09', reviewStatus: '差し戻し', storeId: 'S2' }, { id: 'd', date: '2026-11-07', reviewStatus: '確認中', storeId: 'S1' },
    { id: 'e', date: '2026-11-08', storeId: 'S2', docType: 'Receipt' }];
  const c = arCtx(1440, docs);
  assert.deepEqual(c.arFilterRows(docs).map(x => x.id), ['e', 'b', 'd', 'c', 'a']);
  c.window._arStore = 'S2'; assert.deepEqual(c.arFilterRows(docs).map(x => x.id), ['e', 'c']);
  c.window._arStore = 'ALL'; c.window._arType = 'Receipt'; assert.deepEqual(c.arFilterRows(docs).map(x => x.id), ['e']);
  c.window._arType = 'ALL'; c.window._arStatus = '未確認'; assert.deepEqual(c.arFilterRows(docs).map(x => x.id), ['e', 'b']);
});

test('1A 押したあと次の未確認へ（PC だけ）：押す前の並びで下の未確認・なければ上から・残っていなければそのまま・そのページへ', () => {
  const docs = mkDocs(120);
  const c = arCtx(1440, docs);
  const rows = c.arFilterRows(docs);
  // 選んでいる行（49 番目）を確認済みにした
  c.window._arSel = rows[50].id;
  let plan = c.arNextPlan(rows[50].id);
  docs.find(x => x.id === rows[50].id).reviewStatus = '確認済み';
  c.arAdvance(plan);
  const now = c.arFilterRows(docs).map(x => x.id);
  assert.equal(c.window._arSel, rows[51].id, '下の未確認'); assert.equal(now.indexOf(rows[51].id), 50);
  assert.equal(c.window._arPage, 2, '押したあとの並びで、その行のあるページへ');
  // 最後の未確認：上から探す
  docs.forEach((x, i) => { x.reviewStatus = i === 3 || i === 7 ? '未確認' : '確認済み'; });
  const r2 = c.arFilterRows(docs); c.window._arSel = r2[1].id; plan = c.arNextPlan(r2[1].id);
  docs.find(x => x.id === r2[1].id).reviewStatus = '差し戻し';
  c.arAdvance(plan);
  assert.equal(c.window._arSel, r2[0].id, '下に無ければ上から'); assert.equal(c.window._arPage, 1);
  // 残っていない
  const only = c.arFilterRows(docs).find(x => x.reviewStatus === '未確認');
  c.window._arSel = only.id; plan = c.arNextPlan(only.id); docs.find(x => x.id === only.id).reviewStatus = '確認済み'; c.window._arPage = 2;
  c.arAdvance(plan);
  assert.equal(c.window._arSel, only.id); assert.equal(c.window._arPage, 2, '残っていなければそのまま');
  // 選んでいない行を押した（別のタブなど）・スマホ：動かない
  docs.forEach(x => { x.reviewStatus = '未確認'; });
  const r3 = c.arFilterRows(docs); c.window._arSel = r3[5].id; plan = c.arNextPlan(r3[0].id); c.arAdvance(plan);
  assert.equal(c.window._arSel, r3[5].id);
  const sp = arCtx(390, docs); const rs = sp.arFilterRows(docs); sp.window._arSel = rs[49].id; sp.window._arPage = 1;
  const pl = sp.arNextPlan(rs[49].id); docs.find(x => x.id === rs[49].id).reviewStatus = '確認済み'; sp.arAdvance(pl);
  assert.equal(sp.window._arSel, rs[49].id); assert.equal(sp.window._arPage, 1, 'スマホは今いるページのまま');
});

test('1A 描き方：PC は表とパネル＋ページ・スマホは一覧＋ページ・そのあいだは今のカードを 50 件ずつ。押す関数は今のまま', () => {
  const src = fnSrc('renderAcctReview');
  assert.match(src, /if \(_arM === 'pc'\) \{ html \+= arPcHtml\(_arP\) \+ arPagerHtml\(_arP\)/);
  assert.match(src, /if \(_arM === 'sp'\) \{ html \+= arSpHtml\(_arP\) \+ arPagerHtml\(_arP\)/);
  assert.match(src, /_arP\.slice\.forEach\(function\(inv\)/, 'あいだの幅も 50 件ずつ');
  const btns = fnSrc('arActBtns');
  for (const f of ['arApprove', 'arRejectModal', 'deleteInvoiceConfirm', "'確認中'"]) assert.ok(btns.includes(f), f);
  assert.match(fnSrc('arSetFilter'), /window\._arPage=1/, '絞り込みを変えたら 1 ページ目');
  for (const f of ['arApprove', 'arRejectConfirm', 'deleteInvoiceDo']) { const s = fnSrc(f); assert.ok(s.includes('arNextPlan(id)') && s.includes('arAdvance(_nx)'), f + ' は押す前の並びを覚えて次へ'); }
  assert.match(fnSrc('arOpenBox'), /data-mfull-req/, 'スマホの箱は全画面（共通の決まり）');
});

/* ---------- 2A 設定 ---------- */
test('2A グレード × 画面の表：対象外は「—」・隠している画面に印・チェックは今と同じ toggleGradeHide・G1 は対象の画面なし・現金チップの注意', () => {
  const NAV = [['dashboard', 'ダッシュボード'], ['store_cmd', '店舗オペレーション'], ['mypage', 'マイページ'], ['acct_review', '経理レビュー']].map(([id, label]) => ({ id, label, icon: 'ti-x' }));
  const ids = { G1: [], G2: ['dashboard', 'store_cmd', 'mypage'], G3: ['dashboard', 'store_cmd', 'mypage'], G4: ['dashboard', 'mypage', 'acct_review'], G5: ['dashboard', 'mypage', 'acct_review'] };
  const hide = { G2: ['store_cmd'], G3: [], G4: ['acct_review'], G5: [] };
  const c = ctxOf({ getGradeHide: () => hide, _baseRoleForGrade: g => g, _pagesForBaseRole: g => ids[g], _gradeHideInherit: (v, m) => v || [],
    MENU_GROUPS: [{ children: ['dashboard', 'store_cmd'] }, { children: ['mypage', 'acct_review'] }], NAV_ITEMS: NAV, GRADE_TITLES: { G2: ['Crew Leader'] }, jobTitleLabel: k => k, navLabelEn: x => x });
  vm.runInContext(fnSrc('renderGradeHideConfig'), c);
  const h = c.renderGradeHideConfig();
  const toggles = [...h.matchAll(/<input type="checkbox" (checked)? ?aria-label="[^"]*" onchange="toggleGradeHide\('(G\d)','([a-z_]+)'\)"/g)].map(m => m[2] + ':' + m[3] + (m[1] ? '*' : ''));
  const want = []; ['dashboard', 'store_cmd', 'mypage', 'acct_review'].forEach(p => ['G2', 'G3', 'G4', 'G5'].forEach(g => { if (ids[g].includes(p)) want.push(g + ':' + p + (hide[g].includes(p) ? '*' : '')); }));
  assert.deepEqual(toggles.sort(), want.sort(), '押せるのは対象の画面だけ・印は隠している画面');
  assert.equal((h.match(/st-na/g) || []).length, 4 * 4 - want.length, '対象外の数だけ「—」');
  assert.match(h, /G1 は対象の画面がありません/);
  assert.match(h, /非表示 G2 1・G3 0・G4 1・G5 0/);
  assert.match(h, /G2 は現金チップを入力できません/);
  assert.equal((h.match(/<table class="st-gt">/g) || []).length, 2, '2 つの表（PC は横に並ぶ・CSS）');
});

test('2A 承認ルーティングは表・No Tip は横に並ぶ格子・上と下はそれぞれ 3 枚（CSS で PC だけ横）', () => {
  const s = fnSrc('renderSettings');
  for (const k of ['st-top', 'st-mid', 'st-bot', 'st-gt st-rt', 'st-ntg']) assert.ok(s.includes(k), k);
  const css = HTML.slice(HTML.indexOf('/* v1178（UI案86 の 2：A）：設定'), HTML.indexOf('.st-gh-h {'));
  assert.match(css, /@media \(min-width:1024px\)/); assert.match(css, /\.st-row\.st-mid \{ grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\); \}/); assert.match(css, /\.st-ghg \{ display:grid;/);
  assert.match(HTML, /\.st-gt td\.c \{ width:44px; padding:0; \}/, 'スマホのチェックは 44px（名前の列を広く）');
});

/* ---------- 3A 経理出力 ---------- */
test('3A PC の店ごとの表：押す関数・押せる条件は今の形と同じ（Tip・シフトリーダー手当・月次棚卸・全店まとめて）・ファイルの関数は変えない', () => {
  const s = fnSrc('renderAcctExport');
  const pc = s.slice(s.indexOf('function _axPcStores'), s.indexOf('function _axPcStores') + s.slice(s.indexOf('function _axPcStores')).indexOf('\n  }\n'));
  for (const f of ['exportTipCSV', 'exportAllTipCSV', 'exportSlPayrollCSV', 'exportAllSlPayrollCSV', 'exportInventoryCSV', 'exportAllInventoryCSV', '_acctTipStatusHtml', 'slPayrollData', 'invHistInMonth', 'itMonthlyReport']) {
    assert.ok(pc.includes(f), 'PC：' + f); assert.ok(s.slice(s.indexOf("html += `<div class=\"card\"><div class=\"card-title\"><i class=\"ti ti-coin\"")).includes(f) || f === 'itMonthlyReport' || f === 'invHistInMonth', '今の形にも ' + f);
  }
  assert.equal((pc.match(/'\s*\+\s*_busy\s*\+\s*'/g) || []).length, 6, '取り直し中に止めるボタン：店ごとの Tip 2・手当 2 と、全店の Tip・全店の手当（今と同じ。棚卸は止めない）');
  assert.match(s, /if \(_axPc\) return html \+ _axPcStores\(\) \+ '<div class="ax-pc2"><div class="ax-col">' \+ officePayrollCardHtml\(y, m\)/);
  assert.match(s, /html \+= _axTail\(\);\n  return html;/, 'スマホ・タブレットは今の並び（集計 3 つは最後）');
  assert.match(s, /var _axPc = \(typeof empSmIsPc === 'function'\) && empSmIsPc\(\);/);
});

/* ---------- 4A 診断と記録 ---------- */
test('4A 同期の点検を 2 つに分けられる：checks（点検・診断／バックアップ）と main（それ以外）・何も渡さなければ今と同じ 1 つ', () => {
  const s = fnSrc('syncCenterBodyHtml');
  assert.match(s, /function syncCenterBodyHtml\(part\)/);
  const d = HTML.slice(HTML.indexOf('/* ② Toast の取り直し'), HTML.indexOf('/* ② Toast の取り直し') + 900);
  assert.match(d, /syncCenterBodyHtml\(pc \? 'main' : undefined\)/);
  assert.match(d, /chk = syncCenterBodyHtml\('checks'\)/);
});

/* ---------- 5A 月次サマリーのグラフ ---------- */
test('5A スマホのグラフ：画面の幅で描き、日付の文字は 12（見た目 11px 以上）。PC・タブレットは今のまま', () => {
  const trend = Array.from({ length: 30 }, (_, i) => ({ day: i + 1, actual: 1000 + i * 10, budget: 1100 }));
  const run = phone => { const c = ctxOf({ uiChartPhone: () => phone, uiChartPhoneW: () => 340, uiPcWatch1178: () => {} }); vm.runInContext(fnSrc('msTrendSvg'), c); return c.msTrendSvg(trend); };
  const sp = run(true), pc = run(false);
  const fs1 = [...sp.matchAll(/font-size="([\d.]+)"/g)].map(m => +m[1]);
  assert.ok(fs1.length >= 6 && fs1.every(v => v >= 12), JSON.stringify(fs1));
  assert.match(sp, /viewBox="0 0 340 162" width="100%"/);
  assert.ok(!/overflow-x:auto/.test(sp), 'スマホは横に流さない');
  assert.match(pc, /viewBox="0 0 660 150" width="660"/); assert.match(pc, /font-size="8"/);
});

test('5A 月次サマリーのほかのグラフ（要因分解・リピーター・コスト・メニュー・売上分析）：スマホは文字 12・入らない本数はカードの中で横に流す。PC は今のまま', () => {
  const FNS = ['_msPh', '_msFs', '_msW', '_msGrid', '_msSvg', '_msEmpty', '_msX', 'msMoneyShort', 'msBarChart', 'msStackedBar', 'msGroupedBar', 'msBarsWithLine', '_msMultiLine', '_msLDLine', '_msWaterfall', '_msScatter'];
  const chDef = (HTML.match(/var CH_PC=\{[^}]*\}, CH_PH=\{[^}]*\};\nvar CH=CH_PC;/) || [])[0];
  assert.ok(chDef, 'CH_PC と CH_PH がある');
  const run = (phone, w = 340) => { const c = ctxOf({ uiChartPhone: () => phone, uiChartPhoneW: () => w, uiPcWatch1178: () => {} }); vm.runInContext(chDef + '\n' + FNS.map(fnSrc).join('\n'), c); return c; };
  const d = n => Array.from({ length: n }, (_, i) => ({ label: (i + 1) + '月', value: 1000 * (i + 1), sub: '12人', lineVal: 40 + i, topLabel: '$' + i, segs: [{ v: 500, color: '#a' }, { v: 300 * i, color: '#b' }], bars: [{ value: 200 + i, color: '#a' }, { value: 400, color: '#b' }] }));
  const all = (c, n) => [c.msBarChart(d(n), { money: true }), c.msStackedBar(d(n), { money: true }), c.msGroupedBar(d(n), { money: true }), c.msBarsWithLine(d(n), { money: true }),
    c._msMultiLine(d(n).map(x => x.label), [{ values: d(n).map((x, i) => 20 + i), color: '#a' }], { band: { from: 28, to: 32, color: '#c' } }),
    c._msLDLine(Array.from({ length: n }, (_, i) => '10/' + (i + 1)), [{ values: Array.from({ length: n }, (_, i) => (i % 4 ? i : null)), color: '#a' }]),
    c._msWaterfall([{ type: 'total', label: '前期', value: 52000 }, { label: '客数', value: -3100 }, { type: 'total', label: '今期', value: 48900 }]),
    c._msScatter([{ qty: 5, marginPer: 3, quad: 'star' }, { qty: 1, marginPer: 9, quad: 'dog' }], 3, 5, 6, 10)];
  const sizes = s => [...s.matchAll(/font-size="([\d.]+)"/g)].map(m => +m[1]).concat([...s.matchAll(/font-size:([\d.]+)px/g)].map(m => +m[1]));
  for (const n of [3, 12, 31]) {
    const sp = all(run(true), n);
    sp.forEach((s, i) => { const f = sizes(s); assert.ok(f.length && f.every(v => v >= 12), n + '本 #' + i + ' ' + JSON.stringify(f)); });
    sp.forEach((s, i) => {
      const m = s.match(/viewBox="0 0 (\d+) (\d+)"( width="([^"]+)")?/); assert.ok(m, '#' + i);
      if (+m[1] > 340) { assert.equal(m[4], m[1], n + '本 #' + i + ' 入らないときは 1 単位＝1px'); assert.match(s, /overflow-x:auto/); }
      else { assert.equal(m[4], '100%', n + '本 #' + i + ' 入るときは画面の幅'); assert.ok(!/overflow-x:auto/.test(s), '入るときは流さない'); }
    });
  }
  // 12 本：1 本 64（グループは 100）ずつ。数字が重ならない幅
  const c12 = run(true); assert.match(c12.msBarChart(d(12), {}), /viewBox="0 0 830 188"/); assert.match(c12.msGroupedBar(d(12), {}), /viewBox="0 0 1262 188"/);
  const gw = [...c12.msGroupedBar(d(2), { money: true }).matchAll(/<rect x="[\d.]+" y="[\d.]+" width="([\d.]+)"/g)].map(m => +m[1]);
  assert.ok(gw.length === 4 && gw.every(v => v >= 36), 'スマホのグループの棒は 36 以上（数字が入る幅）' + JSON.stringify(gw));
  // どのグラフも、それだけを最初に描いてもスマホの形になる（前のグラフの形に頼らない）
  const firsts = ['msBarChart', 'msStackedBar', 'msGroupedBar', 'msBarsWithLine', '_msWaterfall', '_msMultiLine', '_msLDLine'];
  for (const fn of firsts) {
    const c = run(true);
    const out = fn === '_msWaterfall' ? c[fn]([{ type: 'total', label: '前期', value: 52000 }, { label: '客数', value: -3100 }, { type: 'total', label: '今期', value: 48900 }])
      : fn === '_msMultiLine' || fn === '_msLDLine' ? c[fn](['1月', '2月', '3月'], [{ values: [30, 40, 50], color: '#a' }], {}) : c[fn](d(3), { money: true });
    assert.match(out, /viewBox="0 0 \d+ 188"/, fn + ' はスマホの高さ'); assert.ok(sizes(out).every(v => v >= 12), fn);
    const y = [...out.matchAll(/text-anchor="middle" font-size="12" fill="var\(--tm\)"[^>]*>/g)].length; void y;
    const lab = [...out.matchAll(/<text x="[\d.]+" y="(\d+(?:\.\d+)?)" text-anchor="middle" font-size="12" fill="var\(--tm\)"/g)].map(m => +m[1]);
    assert.ok(lab.length && lab.every(v => v === 188 - 44 + 16), fn + ' の下の名前はスマホの位置 ' + JSON.stringify(lab));
  }
  // PC：前と同じ数・同じ文字（7・9・7.5・8.5・9.5・8）、幅は 100%（日次は 1:1）
  const pc = all(run(false), 12);
  assert.match(pc[0], /viewBox="0 0 620 148" style="width:100%;max-width:560px;min-width:300px;height:auto;display:block"/);
  assert.match(pc[0], /font-size="7" fill="var\(--muted\)" opacity="0.85"/); assert.match(pc[0], /font-size="9" fill="var\(--tm\)"/);
  assert.match(pc[2], /font-size="9.5" fill="var\(--tm\)" font-weight="600"/); assert.match(pc[6], /font-size="8.5"/);
  assert.match(pc[7], /font-size="8" fill="var\(--green\)">★Star/); assert.match(pc[7], /font-size:8px/);
  const pcLD = run(false)._msLDLine(Array.from({ length: 31 }, (_, i) => '10/' + (i + 1)), [{ values: Array.from({ length: 31 }, (_, i) => i), color: '#a' }]);
  assert.match(pcLD, /viewBox="0 0 974 148" style="width:974px;height:auto;display:block"/);
  // 一つの端末で スマホ → PC と描いても、PC の形に戻る（CH をそのたびに決め直す）
  const both = run(true); both.msBarChart(d(3), {}); both.uiChartPhone = () => false;
  assert.match(both.msBarChart(d(3), {}), /viewBox="0 0 300 148"/);
});

test('幅をまたいだら描き直す：見張りは 1 つ・箱を開いている／入力中は待つ・形の変わる画面だけ', () => {
  const s = fnSrc('uiPcWatch1178');
  assert.match(s, /if \(window\._u78Mq \|\| !window\.matchMedia\) return;/);
  assert.match(s, /\['acct_review', 'acct_center', 'acct_export', 'diag_center'\]/);
  assert.match(s, /\['acct_review', 'acct_center', 'monthly'\]/);
  // 動かして確かめる：箱を開いている・入力中は描き直さず待つ、どちらも無ければ今の画面だけ描き直す
  const ls = {}, drawn = [], timers = [];
  const ov = { open: false, classList: { contains: k => k === 'open' && ov.open } };
  const doc = { activeElement: null, body: {}, getElementById: id => (id === 'modal-overlay' ? ov : null) };
  doc.activeElement = doc.body;
  const c = ctxOf({ document: doc, curPage: 'acct_export', renderPage: p => drawn.push(p), setTimeout: (f, ms) => { timers.push(f); return timers.length; }, clearTimeout: () => {},
    window: { matchMedia: q => ({ matches: false, addEventListener: (e, f) => { (ls[q] = ls[q] || []).push(f); } }) } });
  vm.runInContext(s, c); c.uiPcWatch1178(); c.uiPcWatch1178();
  assert.equal(ls['(min-width:1024px)'].length, 1, '見張りは 1 つ（2 回呼んでも）');
  const fire = q => ls[q].forEach(f => f());
  ov.open = true; fire('(min-width:1024px)'); assert.deepEqual(drawn, [], '箱を開いているあいだは描き直さない'); assert.equal(timers.length, 1);
  ov.open = false; doc.activeElement = { tagName: 'INPUT' }; timers.pop()(); assert.deepEqual(drawn, [], '入力中も待つ'); assert.equal(timers.length, 1);
  doc.activeElement = doc.body; timers.pop()(); assert.deepEqual(drawn, ['acct_export'], '終わったら描き直す');
  c.curPage = 'acct_export'; fire('(max-width:767px)'); assert.deepEqual(drawn, ['acct_export'], '767px の見張りに経理出力は入っていない（形が変わらない）');
  c.curPage = 'monthly'; fire('(max-width:767px)'); assert.deepEqual(drawn, ['acct_export', 'monthly']);
  c.curPage = 'dashboard'; fire('(min-width:1024px)'); fire('(max-width:767px)'); assert.equal(drawn.length, 2, 'ほかの画面は描き直さない');
});
