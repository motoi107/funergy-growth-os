// v1182（UI案88・Moto さん 11/16 08:13 HST「全部Aで」を UI案88 にも読んだ）：人材の残り。
// 合成データ・本番に接続しない。index.html の関数を VM で動かすか、形を確かめる。見た目は tests/e2e-pcsp/ui88-89-v1182.mjs（Chromium）。
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
const mm = w => (w == null ? null : q => { const m = q.match(/\((min|max)-width:\s*(\d+)px\)/); const v = +m[2]; return { matches: m[1] === 'min' ? w >= v : w <= v, addEventListener() {} }; });
const U9 = ['arMode', 'u9Mode', 'u9St', 'u9Page', 'u9Pager', 'u9GoPage', 'u9SetF', 'u9SetV', 'u9QMatch', 'u9SearchHtml', 'u9TilesHtml', 'u9TableHtml', 'u9Pick', 'u9SpListHtml', 'u9StoreName', 'u9Q', 'u10Sig', 'u10Panel', 'u10Count', 'u10Kv', 'u10Gone'];
const U11 = ['u11Js', 'u11Ymd', 'u11DaysSince', 'u11ObSt', 'u11ObStep', 'u11ObNext', 'u11ObTag', 'u11ObDots', 'u11ObStore', 'u11ObPlanned', 'u11ObName', 'u11HrTab', 'u11ObOf', 'u11AppOf', 'u11AppSt', 'u11HrHtml', 'u11ObListHtml', 'u11AppsHtml',
  'u11HbOf', 'u11HbAdminHtml', 'u11ShDay', 'u11ShDayIdx', 'u11ShWk', 'u11ShiftDayHtml', 'u11RmSp', 'u11RmSel', 'u11RmIn', 'u11RespOpen', 'u11Tyg2Open', 'hbStatus'];
function ctx(width, extra = {}) {
  const renders = [], boxes = [];
  const c = { Math, Number, String, Object, Array, JSON, isNaN, isFinite, parseInt, parseFloat, console, Date, setTimeout: () => 0, clearTimeout() {},
    t: (j, e) => j, escapeHtml: esc, window: width == null ? {} : { matchMedia: mm(width) }, document: { querySelector: () => null, getElementById: () => null },
    renders, boxes, curPage: 'hiring', curRole: 'gm', renderPage: p => renders.push(p), STORES: [{ id: 'S1', name: 'Store One' }, { id: 'S2', name: 'Store Two' }],
    DOW_SHIFT: ['日', '月', '火', '水', '木', '金', '土'], RESP_LEVEL_OPTS: ['', '●', '◎'], TYG2_LEVEL_OPTS: ['－', '結果責任', '実行責任'],
    parseJaDate: s => { const m = String(s || '').match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; },
    obCardHtml: o => '<div class="card ob-card">' + esc(o.name) + '</div>', obCardInner: o => '<p>カード ' + esc(o.name) + '</p>', appCardInner: a => '<p>応募 ' + esc(a.name) + '</p>', appPriorRejects: a => a.prior || [],
    kpi: (l, v) => '<div class="kpi">' + l + v + '</div>', renderRejectedList: () => '<div id="rej"></div>', hrWaitHtml: () => '<div id="wait"></div>', getRejectLog: () => [], applicantStores: () => ['S1', 'S2'],
    hbTestCell: () => '<span>未回答</span>', shiftHeadcount: () => 2, openModal: h => boxes.push(h), closeModalDirect() {}, showToast() {}, ...extra };
  c.ls = (k, d) => (k === 'onboardings' ? (c.OBS || d) : d);
  vm.createContext(c);
  vm.runInContext('var U9_PER = 50; var U11_OB_STEPS = ' + (HTML.match(/var U11_OB_STEPS = (\[[^;]*\]);/) || [])[1] + ';\n' + U9.concat(U11).map(fnSrc).join('\n') + '\nfunction u11Box(title, body, foot){ boxes.push({ title, body, foot }); }', c);
  return c;
}

test('版：ページと SW が同じ（1182 以上）', () => {
  const a = +(HTML.match(/const APP_VERSION = '(\d+)'/) || [])[1], s = +(SW.match(/const SW_BUILD = '(\d+)'/) || [])[1];
  assert.ok(a >= 1182 && a === s, a + ' / ' + s);
});

test('1A 入社手続き：状態 → 5 段の進み具合・次にすること（キャンセルは点を塗らない）', () => {
  const c = ctx(1440);
  assert.equal(c.u11ObSt({}), '本人入力待ち', '状態が無ければ本人入力待ち');
  assert.deepEqual(['本人入力待ち', '差し戻し', '提出完了', 'I-9確認待ち', '経理確認中', 'Payroll登録中', '登録完了', '知らない'].map(c.u11ObStep), [0, 0, 1, 2, 3, 3, 4, 0]);
  assert.match(c.u11ObNext('提出完了'), /経理が確認/); assert.match(c.u11ObNext('I-9確認待ち'), /I-9/); assert.match(c.u11ObNext('不明'), /確認/);
  const dots = h => (h.match(/u11-dot( done| cur)?"/g) || []).map(x => x.includes('done') ? 'd' : x.includes('cur') ? 'c' : '-').join('');
  assert.equal(dots(c.u11ObDots('I-9確認待ち')), 'ddc--');
  assert.equal(dots(c.u11ObDots('登録完了')), 'ddddd');
  assert.equal(dots(c.u11ObDots('キャンセル')), '-----');
  assert.match(c.u11ObDots('提出完了'), /aria-label="進み具合 1\/5"/);
  assert.match(c.u11ObTag('キャンセル'), /tag-gray[^>]*>中止</); assert.match(c.u11ObTag('差し戻し'), /tag-red/); assert.match(c.u11ObTag('<b>'), /&lt;b&gt;/);
});

const OB = (id, name, st, store, startDate, extra = {}) => ({ id, name, obStatus: st, store, startDate, pos: 'Server', ...extra });
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

test('1A 入社手続き：初めは「進行中」だけ・登録完了／中止／応募者はタブ・数が出る・タブを変えると 1 ページ目', () => {
  const c = ctx(1440);
  c.OBS = [OB(1, 'Aki', '提出完了', 'S1', daysAgo(3)), OB(2, 'Ben', '登録完了', 'S2', daysAgo(30)), OB(3, 'Cy', 'キャンセル', 'S1', daysAgo(9)), OB(4, 'Dee', '差し戻し', 'S2', daysAgo(12))];
  let h = c.u11HrHtml([{ id: 'a1', name: 'App One', store: 'S1', status: '新規応募' }], false);
  assert.match(h, /入社手続き 進行中 2/); assert.match(h, /登録完了 1/); assert.match(h, /中止 1/); assert.match(h, /応募者 1/);
  const ids = [...h.matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids, ['4', '1'], '進行中だけ・始めてから長い順（止まっている人が上）');
  assert.match(h, /aria-selected="true"[^>]*onclick="u11HrTab\('ob'\)"/);
  c.u9St().pg.ob = 3; c.u11HrTab('done'); assert.equal(c.window._u11HrTab, 'done'); assert.equal(c.u9St().pg.ob, 1); assert.deepEqual(c.renders, ['hiring']);
  h = c.u11HrHtml([], false); assert.deepEqual([...h.matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]), ['2']);
  c.window._u11HrTab = 'cancel'; h = c.u11HrHtml([], false); assert.deepEqual([...h.matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]), ['3']);
  c.window._u11HrTab = 'apps'; h = c.u11HrHtml([], true); assert.match(h, /id="wait"/, '読み込み中は待つ表示'); assert.match(h, /応募者 …/);
});

test('1A 入社手続き：PC は 8 列の表と右のパネル（今のカード）・名前と店はエスケープ・日数', () => {
  const c = ctx(1440);
  c.OBS = [OB('x<1>', '<img src=x>', 'I-9確認待ち', 'S1', daysAgo(5), { plannedStart: '2026-12-01' })];
  const h = c.u11HrHtml([], false);
  assert.match(h, /<th class="u9-wrap">名前<\/th><th class="u9-wrap">店<\/th><th class="u9-wrap">職種<\/th><th>勤務開始予定<\/th><th>状態<\/th><th>進み具合<\/th><th class="u9-wrap">次にすること<\/th><th class="num">日数<\/th>/);
  assert.ok(!h.includes('<img src=x>'), '名前はエスケープ'); assert.match(h, /&lt;img src=x&gt;/);
  assert.match(h, /data-u9id="x&lt;1&gt;"/); assert.match(h, /Store One/); assert.match(h, /2026-12-01/); assert.match(h, /<td class="num">5<\/td>/);
  assert.match(h, /id="u9p-ob"><div class="u11-obcard"><p>カード &lt;img/, 'パネルは今のカードの中身');
  assert.match(h, /店長が I-9 を確認/);
});

test('1A 入社手続き：スマホは 1 行の一覧（押すと箱）・あいだは今のカードを 50 人ずつ・店で絞る・名前で探す', () => {
  const list = Array.from({ length: 60 }, (_, i) => OB(i + 1, 'P' + String(i + 1).padStart(2, '0'), '提出完了', i % 2 ? 'S2' : 'S1', daysAgo(i)));
  let c = ctx(390); c.OBS = list;
  let h = c.u11HrHtml([], false);
  assert.match(h, /onclick="u11ObOpen\(this.getAttribute\('data-u9id'\)\)"/); assert.equal((h.match(/u9-sprow/g) || []).length, 50); assert.match(h, /1〜50/);
  assert.match(h, /次：経理が確認/); assert.match(h, /\d+日目/);
  c.u11ObOpen = undefined; vm.runInContext(fnSrc('u11ObOpen'), c); c.u11ObOpen('7'); assert.equal(c.boxes.at(-1).title, 'P07'); assert.match(c.boxes.at(-1).body, /カード P07/);
  c = ctx(900); c.OBS = list; h = c.u11HrHtml([], false);
  assert.equal((h.match(/class="card ob-card"/g) || []).length, 50, 'あいだは今のカード'); assert.ok(!/u9-tbl|u9-sprow/.test(h));
  c = ctx(1440); c.OBS = list; c.u9St().f.obs = 'S2'; h = c.u11HrHtml([], false);
  assert.equal((h.match(/class="ar-row u9-row/g) || []).length, 30, '店で絞る');
  c.u9St().q.ob = 'p0'; h = c.u11HrHtml([], false); assert.equal((h.match(/class="ar-row u9-row/g) || []).length, 4, '名前で探す（S2 の P02・P04・P06・P08）');
  c.u9St().f.obs = 'GONE'; c.u9St().q.ob = ''; h = c.u11HrHtml([], false); assert.equal((h.match(/class="ar-row u9-row/g) || []).length, 50, '無くなった店の絞り込みは外す');
});

test('1A 入社手続き：並び（勤務開始予定・名前）・ほかの端末で消えた人は「見つかりません」', () => {
  const c = ctx(1440);
  c.OBS = [OB(1, 'Zed', '提出完了', 'S1', daysAgo(1), { plannedStart: '2026-12-09' }), OB(2, 'Amy', '提出完了', 'S1', daysAgo(2), { plannedStart: '2026-12-01' }), OB(3, 'Kim', '提出完了', 'S1', daysAgo(3))];
  c.u9St().sort.ob = 'plan'; assert.deepEqual([...c.u11HrHtml([], false).matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]), ['2', '1', '3']);
  c.u9St().sort.ob = 'name'; assert.deepEqual([...c.u11HrHtml([], false).matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]), ['2', '3', '1']);
  assert.equal(c.u11ObOf('99'), null); assert.match(c.u10Panel(c.u11ObOf)('99'), /見つかりません/);
});

test('1A 応募者：同じ形（状態で絞る・店で絞る・未分類も出る・過去応募の印）・PC は表とパネル', () => {
  const c = ctx(1440); c.window._u11HrTab = 'apps'; c.OBS = [];
  c.visibleApplicants = () => apps;
  const apps = [{ id: 'a1', name: 'Ann', store: 'S1', status: '新規応募', date: '2026-11-10', pos: 'Server', prior: [1] }, { id: 'a2', name: 'Bo', store: '未分類', status: '採用', date: '2026-11-12' }, { id: 'a3', name: 'Cal', store: 'S2', status: '不採用', date: '2026-11-11' }];
  let h = c.u11HrHtml(apps, false);
  assert.deepEqual([...h.matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]), ['a2', 'a3', 'a1'], '応募日の新しい順・未分類も出る');
  assert.match(h, /要確認 1件/); assert.match(h, /過去応募/); assert.match(h, /id="rej"/, '不採用の一覧はそのまま');
  assert.match(h, /すべて 3/); assert.match(h, /応募中 1/); assert.match(h, /採用 1/);
  c.u9St().f.appst = '応募中'; h = c.u11HrHtml(apps, false); assert.deepEqual([...h.matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]), ['a1']);
  c.u9St().f.appst = ''; c.u9St().f.apps = 'S2'; h = c.u11HrHtml(apps, false); assert.deepEqual([...h.matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]), ['a3']);
  assert.match(c.u11AppOf('a1').body, /応募 Ann/); assert.equal(c.u11AppOf('zz'), null);
});

test('2A Handbook › 進捗管理：4 つの数で絞る・進み具合の少ない順・PC は表とパネル（章ごと）・スマホは今の表（名前で箱）', () => {
  const chs = [{ id: 'c1', order: 1, titleJa: '一', version: 1 }, { id: 'c2', order: 2, titleJa: '二', version: 2 }];
  const reads = { Aki: { c1: { v: 1, at: '11/1' }, c2: { v: 2, at: '11/2' } }, Ben: { c1: { v: 1 } }, "O'Neil": { c2: { v: 1, at: '10/9' } } };
  const R = [{ name: 'Aki', readN: 2, ok: true, ts: 'pending', nm: 'Aki', pr: '<td>p</td>', cells: '<td>c</td>', tc: 'x' }, { name: 'Ben', readN: 1, ok: false, ts: 'wait', nm: 'Ben', pr: '', cells: '', tc: '' }, { name: "O'Neil", readN: 0, ok: false, ts: 'wait', nm: 'O', pr: '', cells: '', tc: '' }];
  const k = { all: 3, done: 1, tDone: 0, tPend: 1, tClaim: 0, tScore: 0, tMax: 0, tScored: 0 };
  let c = ctx(1440, { getEmployees: () => [{ name: 'Aki', store: 'S1' }, { name: 'Ben', store: 'S2' }, { name: "O'Neil", store: 'S1' }] });
  let h = c.u11HbAdminHtml(chs, reads, R, k);
  assert.equal((h.match(/class="u9-tile[ "]/g) || []).length, 4); assert.match(h, /<th class="u11-hbch">1<\/th><th class="u11-hbch">2<\/th>/);
  assert.match(h, /id="u9p-hb">.*✓ 読了 11\/1/s);
  c.u9St().f.hb = 'inc'; h = c.u11HbAdminHtml(chs, reads, R, k); assert.deepEqual([...h.matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]), ['Ben', 'O&#39;Neil']);
  c.u9St().f.hb = 'pend'; h = c.u11HbAdminHtml(chs, reads, R, k); assert.deepEqual([...h.matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]), ['Aki']);
  c.u9St().f.hb = ''; c.u9St().sort.hb = 'prog'; h = c.u11HbAdminHtml(chs, reads, R, k); assert.deepEqual([...h.matchAll(/data-u9id="([^"]+)"/g)].map(m => m[1]), ['O&#39;Neil', 'Ben', 'Aki']);
  const o = c.u11HbOf("O'Neil"); assert.match(o.body, /0\/2/); assert.match(o.body, /更新あり・要再確認/, '前の版の読了は要再確認'); assert.match(o.body, /－ 未読/);
  c = ctx(390, { getEmployees: () => [] }); h = c.u11HbAdminHtml(chs, reads, R, k);
  assert.match(h, /class="inv-table u11-hbt"/); assert.match(h, /onclick="u11HbOpen\('O\\&#39;Neil'\)"/, '名前は JS の文字列として（引用符をエスケープ）');
  assert.match(h, /position:sticky;left:0/, 'スマホも名前の列を止める');
});

test('4A シフト作成（スマホ）：曜日のタブ・入っている人 → 希望あり → 希望の無い人はたたむ・本数の − ＋・週の合計時間', () => {
  const c = ctx(390, { todayISO: () => '2026-11-18' });
  const dates = ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'];
  const cell = (n, day) => ({ on: n === 'On', avail: n === 'Av', html: '<button>' + n + day + '</button>' });
  const h = c.u11ShiftDayHtml({ storeId: "S'1", dates, dowEn: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    sections: [{ key: 'dinner', label: 'ディナー', icon: 'ti-moon', accent: '#123', names: ['Rest', 'Av', 'On'], wk: { On: 42, Av: 38 }, dinner: true, cell, head: true }] });
  assert.match(h, /aria-selected="true"[^>]*onclick="u11ShDay\(3\)"><b>Wed<\/b><span>11\/18<\/span>/, '初めは今日の曜日');
  const order = [...h.matchAll(/<div class="u11-shn"><b>([^<]+)<\/b>/g)].map(m => m[1]);
  assert.deepEqual(order, ['On', 'Av', 'Rest']); assert.match(h, /<details class="u11-shrest"><summary>この日に希望の無い人 1/);
  assert.match(h, /1 \/ 2人/); assert.match(h, /shiftHeadStep\('S\\&#39;1','dinner','水',-1\)/);
  assert.match(h, /42h ⚠ OT/); assert.match(h, /38h<\/span>/); assert.match(h, /<button>On水<\/button>/, 'セルは今の箱を開くボタンのまま');
  c.window._u11ShDay = 6; assert.equal(c.u11ShDayIdx(dates), 6); c.window._u11ShDay = 'x'; assert.equal(c.u11ShDayIdx(dates), 3); c.window._u11ShDay = 9; assert.equal(c.u11ShDayIdx(dates), 3, '範囲の外は今日'); c.window._u11ShDay = -1; assert.equal(c.u11ShDayIdx(dates), 3);
  c.u11ShDay(1); assert.equal(c.window._u11ShDay, 1); assert.deepEqual(c.renders, ['hiring']);
});

test('5A 責任マトリクス・G2（スマホ）：箱は GM・CEO だけ・選べる値に無い今の値も消さない・すぐ保存の関数を呼ぶ', () => {
  const rows = [{ cat: 'A' }, ['棚卸', '●', '', '', '', '', '', '', 'メモ', '', 'note']];
  const c = ctx(390, { getRespMatrix: () => ({ rows }), getTotoyaG2Matrix: () => ({ rows: [[0, 0, 0, '発注', 'Order', '－', '独自', '－', '－', '－', '－', '－', '－', 'n', 'ne']] }) });
  assert.equal(c.u11RmSp(), true);
  c.curRole = 'am'; c.u11RespOpen(1); assert.equal(c.boxes.length, 0, 'AM では開かない');
  c.curRole = 'gm'; c.u11RespOpen(0); assert.equal(c.boxes.length, 0, '見出しの行は開かない');
  c.u11RespOpen(1); const b = c.boxes.at(-1);
  assert.equal(b.title, '棚卸'); assert.equal((b.body.match(/onchange="respSetCell\(1,\d,this.value\)"/g) || []).length, 7);
  assert.match(b.body, /onchange="respSetName\(1,this.value\)"/); assert.match(b.body, /onchange="respSetNoteEn\(1,this.value\)"/); assert.match(b.foot, /respDelRow\(1\)/);
  c.u11Tyg2Open(0); const g = c.boxes.at(-1);
  assert.match(g.body, /<option value="独自" selected>独自<\/option>/, '選べる値に無い今の値も残す'); assert.equal((g.body.match(/tyg2SetCell\(0,\d+,this.value\)/g) || []).length, 8);
  assert.equal(ctx(1440).u11RmSp(), false);
});

test('形：画面のつなぎ（関数が無いときは今の画面のまま）', () => {
  assert.match(fnSrc('renderHiring'), /if \(typeof u11HrHtml === 'function'\)/);
  assert.match(fnSrc('hbRenderAdmin'), /if\(typeof u11HbAdminHtml==='function'\) return h \+ u11HbAdminHtml\(/);
  assert.match(fnSrc('renderShiftBuilderF01'), /typeof u11ShiftDayHtml === 'function' && typeof u9Mode === 'function' && u9Mode\(\) === 'sp'/);
  assert.match(fnSrc('renderShiftBuilderF02'), /typeof u11ShiftDayHtml === 'function'/);
  assert.match(fnSrc('renderRespMatrix'), /u11RespOpen\(/); assert.match(fnSrc('renderTotoyaG2'), /u11Tyg2Open\(/);
  assert.match(fnSrc('renderShiftAdmin'), /u11-touch/, '最適化設定と特別ルールは押す範囲 44px（タッチ）');
  assert.match(HTML, /@media \(pointer:coarse\)[^{]*\{[^}]*\.u11-touch/);
  assert.match(fnSrc('uiPcWatch1179'), /'hiring', 'crew_handbook', 'tip', 'shift_admin'/);
});

test('前からの不具合：採用 › キャリア説明の責任マトリクスを直すと業務ガイドに移っていた → 今の画面を描き直す', () => {
  const renders = []; const c = { renderPage: p => renders.push(p), curPage: 'hiring' }; vm.createContext(c);
  vm.runInContext(fnSrc('_respRerender'), c); c._respRerender(); c.curPage = 'ojt_admin'; c._respRerender(); c.curPage = 'biz_guide'; c._respRerender(); c.curPage = 'x'; c._respRerender();
  assert.deepEqual(renders, ['hiring', 'ojt_admin', 'biz_guide', 'biz_guide']);
});

test('3A 配分表：配分に出ていない出勤者は 1 行にたたむ（人数と理由ごとの数・押すと開く）・PC は見出しと ①〜④ を止める・スマホは 1 日ずつ', () => {
  const src = fnSrc('renderTipPeriodMatrix');
  assert.match(src, /u11-umb/); assert.match(src, /u11TipUmToggle\(\)/); assert.match(src, /window\._u11TipUm/);
  assert.match(src, /if \(_u11Sp\) return html \+ _u11TipDayHtml\(\);/);
  assert.match(src, /u11-tipwrap/); assert.match(src, /table[^"]*u11-tipm/); assert.match(src, /class="u11-st"/);
  assert.match(src, /_rateCache = _rateCache \|\| \{\};/, '1 日の表を先に描いても率の覚えが空にならない');
  assert.match(src, /tipCashCellHtml\(/, '③ キャッシュは今の入力のまま'); assert.match(src, /tipCellHtml\(/, '1 人の L/D のセル（押すと Tip 対象外）も今のまま');
});

test('どの案でも直す：最適化設定・特別ルールの □ だけのマスは、タッチの端末でマスのどこを押しても □ を押したのと同じ（PC・□ そのもの・2 つあるマスは今のまま）', () => {
  const mk = coarse => { const c = { window: { matchMedia: q => ({ matches: /pointer:coarse/.test(q) && coarse }) } }; vm.createContext(c); vm.runInContext(fnSrc('u11TouchCell'), c); return c; };
  const box = (type, extra = {}) => { const i = { tagName: 'INPUT', type, disabled: false, clicks: 0, click() { this.clicks++; }, ...extra }; return i; };
  const td = kids => ({ tagName: 'TD', children: kids });
  const t1 = mk(true), cb = box('checkbox');
  t1.u11TouchCell({ target: td([cb]) }); assert.equal(cb.clicks, 1, 'マスを押すと □ を 1 回押す');
  t1.u11TouchCell({ target: cb }); assert.equal(cb.clicks, 1, '□ そのものを押したときは何もしない（2 回にしない）');
  const r = box('radio'); t1.u11TouchCell({ target: td([r]) }); assert.equal(r.clicks, 1);
  const a = box('checkbox'), b = box('checkbox'); t1.u11TouchCell({ target: td([a, b]) }); assert.equal(a.clicks + b.clicks, 0, '2 つあるマスは押さない');
  const n = box('number'); t1.u11TouchCell({ target: td([n]) }); assert.equal(n.clicks, 0, '数の欄は押さない');
  const d = box('checkbox', { disabled: true }); t1.u11TouchCell({ target: td([d]) }); assert.equal(d.clicks, 0, '押せない □ は押さない');
  const t0 = mk(false), pc = box('checkbox'); t0.u11TouchCell({ target: td([pc]) }); assert.equal(pc.clicks, 0, 'PC（マウス）は今のまま');
  t1.u11TouchCell(null); t1.u11TouchCell({ target: null }); t1.u11TouchCell({ target: { tagName: 'DIV', children: [] } });
  const lb = box('checkbox'); t1.u11TouchCell({ target: { tagName: 'LABEL', children: [lb] } }); assert.equal(lb.clicks, 0, 'ラベルはブラウザが □ を押すので、ここでは押さない（2 回にしない）');
  const sa = fnSrc('renderShiftAdmin');
  assert.equal((sa.match(/class="u11-touch" onclick="u11TouchCell\(event\)"/g) || []).length, 2, '特別ルールと最適化設定の 2 つ');
  assert.match(HTML, /\.u11-touch span\.tag\[onclick\] \{[^}]*min-height:44px/, '特別ルールの名前の札（押すと切り替え）も 44px');
  assert.match(HTML, /\.u11-touch td:has\(> input\[type="checkbox"\]:only-child\)[^{]*\{[^}]*height:44px/);
});
