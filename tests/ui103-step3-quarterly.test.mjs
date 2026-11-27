// UI案103 step ③：Quarterly は 約束 → 行動 → 結果 → 残り。保存の関数とキーは変えない。
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

test('版は 1225', () => {
  assert.match(SRC, /const APP_VERSION = '1225'/);
  assert.match(SW, /const SW_BUILD = '1225'/);
});

test('Quarterly の欄は 約束 → 行動 → 結果 → 残り', () => {
  const sec = fnSrc('qbQuarterSections');
  const a = sec.indexOf('約束（Qコミット）');
  const b = sec.indexOf('行動（重点項目のメモ）');
  const c = sec.indexOf('結果（前の四半期と比べた数字）');
  const d = sec.indexOf("t('残り'");
  assert.ok(a >= 0 && b > a && c > b && d > c, [a, b, c, d]);
  assert.match(sec, /part:'memo'/);
  assert.match(sec, /part:'result'/);
  assert.match(sec, /renderQcRemain\(R\)/);
  assert.doesNotMatch(sec, /未実施/);
});

test('記録なしを未実施と言わない。行動のメモが空なら記録なし', () => {
  const focus = fnSrc('renderQcFocus');
  assert.match(focus, /記録なし/);
  assert.doesNotMatch(focus, /未実施/);
  assert.match(focus, /part==='memo'/);
  assert.match(focus, /part==='result'/);
});

test('約束の保存と行動のメモは今の関数とキーのまま', () => {
  const save = fnSrc('saveQBudget');
  assert.match(save, /setQBudgetObj\(storeId,_qbY,_qbQ,obj\)/);
  assert.match(fnSrc('renderQcPromise'), /saveQBudget\(/);
  assert.match(fnSrc('renderQcPromise'), /id="qb-'\+st\.id\+'-basis"/);
  assert.match(fnSrc('renderQcPromise'), /id="qb-'\+st\.id\+'-focus"/);
  const note = fnSrc('saveQcNote');
  assert.match(note, /obj\.focusNotes/);
  assert.match(note, /setQBudgetObj\(storeId,y,q,obj\)/);
  assert.match(fnSrc('getQBudget'), /ls\('q_budgets'/);
  assert.match(fnSrc('renderQcFocus'), /saveQcNote\(/);
});

test('計算は変えない：qcFillWays と 100% / 95%、客数の言葉', () => {
  assert.match(fnSrc('qcFillWays'), /byGuest = ppa>0 \? \(need\/ppa\/days\) : null/);
  assert.match(SRC, /R\.pacePct>=1\.0/);
  assert.match(SRC, /R\.pacePct>=0\.95/);
  assert.match(fnSrc('renderQcRemain'), /客数だけで埋めるなら1日/);
  assert.match(fnSrc('renderQcRemain'), /Q目標まで あと/);
});
