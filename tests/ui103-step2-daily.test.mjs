// UI案103 step ②：客数は前日までの売上予算の割合。取り込み直しは同じ関数。失敗は保存しない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function fnSrc(name) {
  const m = new RegExp('function ' + name + '\\(').exec(SRC);
  if (!m) throw new Error('function not found: ' + name);
  let i = SRC.indexOf('{', m.index), depth = 0, q = null;
  for (; i < SRC.length; i++) {
    const ch = SRC[i], nx = SRC[i + 1];
    if (q) { if (ch === '\\') { i++; continue; } if (ch === q) q = null; continue; }
    if (ch === '/' && nx === '/') { i = SRC.indexOf('\n', i); continue; }
    if (ch === '/' && nx === '*') { i = SRC.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return SRC.slice(m.index, i + 1); }
  }
  throw new Error('unterminated: ' + name);
}
const pace = new Function('return ' + fnSrc('budGuestPacePlan'))();
const kind = new Function('return ' + fnSrc('budDayKind'))();

test('アプリとサービスワーカーの版が一致する（1224 以上）', () => {
  const app = SRC.match(/const APP_VERSION = '(\d+)'/);
  const sw = SW.match(/const SW_BUILD = '(\d+)'/);
  assert.ok(app && sw && app[1] === sw[1] && Number(app[1]) >= 1224);
});

test('月の途中：客数の計画＝月の計画 × 前日までの売上予算の割合', () => {
  const days = [];
  for (let d = 1; d <= 10; d++) days.push({ date: '2026-11-' + String(d).padStart(2, '0'), bud: 100 });
  const r = pace(300, days, '2026-11-06');
  assert.equal(r.mid, true);
  assert.equal(r.full, false);
  assert.ok(Math.abs(r.share - 0.5) < 1e-9);
  assert.ok(Math.abs(r.plan - 150) < 1e-9);
});

test('月が終わったあと：月の客数の計画そのものと比べる', () => {
  const days = [];
  for (let d = 1; d <= 10; d++) days.push({ date: '2026-10-' + String(d).padStart(2, '0'), bud: 100 });
  const r = pace(300, days, '2026-11-06');
  assert.equal(r.full, true);
  assert.equal(r.mid, false);
  assert.equal(r.share, 1);
  assert.equal(r.plan, 300);
});

test('定休（売上予算 0）は割合に入らない', () => {
  const days = [];
  for (let d = 1; d <= 10; d++) days.push({ date: '2026-11-' + String(d).padStart(2, '0'), bud: d === 2 ? 0 : 100 });
  const r = pace(900, days, '2026-11-06');
  // 1〜5 日のうち 2 日は 0。前日まで 400 / 月 900
  assert.ok(Math.abs(r.share - (400 / 900)) < 1e-9);
  assert.ok(Math.abs(r.plan - 400) < 1e-9);
  assert.equal(r.mid, true);
});

test('売上予算が無い月は計画を出さない', () => {
  const r = pace(100, [{ date: '2026-11-01', bud: 0 }], '2026-11-02');
  assert.equal(r.plan, null);
});

test('日の区別：定休は数えない。失敗は画面のあいだだけ。未入力と未取り込みを分ける', () => {
  const today = '2026-11-10';
  assert.equal(kind({ date: '2026-11-02', today, closed: 'closed', hasAct: false, bud: 0, act: 0, toastGuid: true }), 'off');
  assert.equal(kind({ date: '2026-11-03', today, closed: null, hasAct: false, bud: 100, act: 0, toastGuid: true, fail: true }), 'fail');
  assert.equal(kind({ date: '2026-11-04', today, closed: null, hasAct: false, bud: 100, act: 0, toastGuid: true }), 'gap');
  assert.equal(kind({ date: '2026-11-05', today, closed: null, hasAct: false, bud: 100, act: 0, toastGuid: false }), 'blank');
  assert.equal(kind({ date: '2026-11-06', today, closed: null, hasAct: true, bud: 100, act: 80, toastGuid: true, odd: true }), 'odd');
  assert.equal(kind({ date: '2026-11-07', today, closed: null, hasAct: true, bud: 100, act: 95, toastGuid: true }), 'watch');
  assert.equal(kind({ date: '2026-11-08', today, closed: null, hasAct: true, bud: 100, act: 80, toastGuid: true }), 'miss');
  assert.equal(kind({ date: '2026-11-09', today, closed: null, hasAct: true, bud: 100, act: 100, toastGuid: true }), 'ok');
  assert.equal(kind({ date: '2026-11-10', today, closed: null, hasAct: false, bud: 100, toastGuid: true }), 'today');
  assert.equal(kind({ date: '2026-11-11', today, closed: null, hasAct: false, bud: 100, toastGuid: true }), 'future');
});

test('範囲取り込みと取り込み直しは同じ関数。失敗した日は保存しない', () => {
  const imp = fnSrc('doRangeImport');
  assert.match(imp, /await fetchToastRange\(/);
  assert.match(imp, /doRangeImport\('','',1\)/);
  assert.match(SRC, /失敗した日だけ取り込み直す/);
  assert.match(fnSrc('openRangeModal'), /if \(!_rgBusy\) _rgLastFailed = null/);
  assert.doesNotMatch(fnSrc('budImportFlags'), /lsSet\(/);
  assert.doesNotMatch(imp, /lsSet\(\s*['"]_rgLastFailed/);
  assert.match(SRC, /guestBudget: hasGuestBud&&guestBud>0\?guestBud:null/);
  assert.match(SRC, /function statusFromPct\(p, goodAt, warnAt\)\{ goodAt=goodAt\|\|100; warnAt=warnAt\|\|90/);
});
