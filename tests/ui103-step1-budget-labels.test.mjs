// UI案103 step ①：予実のタブ名と、statusFromPct のしきい値（100 / 90）が変わっていないこと。
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

test('版は 1223 で、アプリとサービスワーカーが一致する', () => {
  assert.match(SRC, /const APP_VERSION = '1223'/);
  assert.match(SW, /const SW_BUILD = '1223'/);
});

test('予実のタブは Daily/Monthly・Quarterly・Annual・予算設定・施策分析で、各タブに一行の目的がある', () => {
  const tabs = SRC.slice(SRC.indexOf('class="phase-tabs bud-tabs"'), SRC.indexOf('</div>`+budPeriodBand()'));
  assert.match(tabs, /budTabBtn\('daily','Daily\/Monthly','Daily\/Monthly','月の累計と日別'/);
  assert.match(tabs, /budTabBtn\('quarter','Quarterly','Quarterly','四半期の約束と残り'/);
  assert.match(tabs, /budTabBtn\('annual','Annual','Annual','12か月の予算と実績'/);
  assert.match(tabs, /budTabBtn\('setup','予算設定','Budget Setup','日別の予算を入れる'/);
  assert.match(tabs, /budTabBtn\('initiative','施策分析','Initiatives','施策の前後を見る'/);
  assert.match(SRC, /function budPeriodBand\(\)/);
  assert.match(SRC, /› Q/);
});

test('statusFromPct のしきい値は 100 と 90 のまま', () => {
  const src = fnSrc('statusFromPct');
  assert.match(src, /goodAt=goodAt\|\|100/);
  assert.match(src, /warnAt=warnAt\|\|90/);
  assert.match(src, /return p>=goodAt\?'good':p>=warnAt\?'warn':'danger'/);
  const statusFromPct = new Function('return ' + src)();
  assert.equal(statusFromPct(100), 'good');
  assert.equal(statusFromPct(99.9), 'warn');
  assert.equal(statusFromPct(90), 'warn');
  assert.equal(statusFromPct(89.9), 'danger');
  assert.equal(statusFromPct(0), 'danger');
});

test('期間の途中は「未達」と言わず、終わったあとの 90〜99% は ▼ 未達', () => {
  const mark = new Function('t', 'return ' + fnSrc('budStatusMark'))(ja => ja);
  assert.match(mark('good', false), /✓ 順調/);
  assert.match(mark('warn', false), /! ペース不足/);
  assert.match(mark('danger', false), /! 遅れ/);
  assert.doesNotMatch(mark('warn', false), /未達/);
  assert.doesNotMatch(mark('danger', false), /未達/);
  assert.match(mark('good', true), /✓ 達成/);
  assert.match(mark('warn', true), /▼ 未達/);
  assert.match(mark('warn', true), /bud-st warn/);
  assert.match(mark('danger', true), /▼ 未達/);
  assert.match(mark('danger', true), /bud-st danger/);
  assert.match(mark('none', false), /判定なし/);
});

test('Quarterly の客数の言葉だけ変わり、計算は need/ppa/days のまま', () => {
  const fill = fnSrc('qcFillWays');
  assert.match(fill, /byGuest = ppa>0 \? \(need\/ppa\/days\) : null/);
  assert.match(SRC, /客数だけで埋めるなら1日/);
  assert.match(SRC, /人（今の客単価）/);
  assert.match(SRC, /R\.pacePct>=1\.0/);
  assert.match(SRC, /R\.pacePct>=0\.95/);
});

test('客数 KPI は月全体の計画との比較のまま（前日までの計画は step ②）', () => {
  assert.match(SRC, /k\.guests>=k\.guestBudget\?'var\(--green\)':k\.guests>=k\.guestBudget\*0\.9\?'var\(--yellow\)':'var\(--red\)'/);
});
