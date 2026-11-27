// UI案103 step ④：年間は四半期ごとの 12 か月。状態と、押した行き先。見込みは出さない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

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

test('版は 1226 以上で揃っている', () => {
  const v = /const APP_VERSION = '(\d+)'/.exec(SRC)[1];
  assert.ok(Number(v) >= 1226);
  assert.match(SW, new RegExp("const SW_BUILD = '" + v + "'"));
});

test('12 か月を四半期ごとに並べ、月の状態は今の種類', () => {
  const band = fnSrc('apBandHtml');
  assert.match(band, /for\(var q=1;q<=4;q\+\+\)/);
  assert.match(band, /for\(var m=\(q-1\)\*3\+1;m<=q\*3;m\+\+\)/);
  const word = fnSrc('apBandWord');
  assert.match(word, /予算開始前/);
  assert.match(word, /予定/);
  assert.match(word, /進行中/);
  assert.match(word, /確定/);
  const c = { console };
  vm.createContext(c);
  vm.runInContext([fnSrc('apBandWord'), 'function t(a){return a;}'].join('\n'), c);
  assert.equal(c.apBandWord({ kind: 'pre' }), '予算開始前');
  assert.equal(c.apBandWord({ kind: 'future' }), '予定');
  assert.equal(c.apBandWord({ kind: 'current' }), '進行中');
  assert.equal(c.apBandWord({ kind: 'past', relevant: true, gap: [], unset: [] }), '確定');
});

test('差が大きい月は今のしきい値だけ（90% 未満）。見込みは出さない', () => {
  const large = fnSrc('apBandLarge');
  assert.match(large, /statusFromPct\(r\)==='danger'/);
  assert.match(large, /apTone\(metric, d\)==='ap-neg'/);
  assert.doesNotMatch(fnSrc('apBandHtml') + fnSrc('apBandDetail') + fnSrc('apBandMark'), /見込み/);
  const c = {
    console,
    statusFromPct: (p) => (p >= 100 ? 'good' : p >= 90 ? 'warn' : 'danger'),
    _apIsRate: (m) => m === 'fc' || m === 'labor',
    apRate: (metric, A) => (metric === 'fc' ? null : (A.a / A.b * 100)),
    apDiff: (metric, A) => A.a - A.b,
    apTone: (metric, d) => ((metric === 'fc' || metric === 'labor') ? (d < 0 ? 'ap-pos' : 'ap-neg') : (d > 0 ? 'ap-pos' : 'ap-neg'))
  };
  vm.createContext(c);
  vm.runInContext(large, c);
  const past = (a, b) => ({ kind: 'past', relevant: true, gap: [], unset: [], loading: false, failed: false, A: { a, b } });
  assert.equal(c.apBandLarge('sales', past(110, 100)), false);
  assert.equal(c.apBandLarge('sales', past(95, 100)), false);
  assert.equal(c.apBandLarge('sales', past(87, 100)), true);
  assert.equal(c.apBandLarge('sales', { kind: 'current', relevant: true, gap: [], unset: [], A: { a: 10, b: 100 } }), false);
  assert.equal(c.apBandLarge('fc', past(32, 30)), true);
  assert.equal(c.apBandLarge('fc', past(28, 30)), false);
});

test('月を押すと詳細。Daily/Monthly と Quarterly へ。予算設定への今の行き先は残す', () => {
  assert.match(fnSrc('apBandHtml'), /apBandPick\(/);
  assert.match(fnSrc('apBandDetail'), /apGoDaily\(/);
  assert.match(fnSrc('apBandDetail'), /planGoQuarter\(/);
  assert.match(fnSrc('apGoDaily'), /setBudgetTab\('daily'\)/);
  assert.match(fnSrc('planGoMonth'), /setBudgetTab\('setup'\)/);
  assert.match(fnSrc('planGoQuarter'), /setBudgetTab\('quarter'\)/);
});
