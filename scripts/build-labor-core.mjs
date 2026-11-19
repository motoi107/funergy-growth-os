#!/usr/bin/env node
// v1192：関数 secure-state の「人件費の合計」（labor）が使う計算を、index.html の関数をそのまま取り出して 1 つのファイルにする。
//   node scripts/build-labor-core.mjs          … supabase/functions/secure-state/labor-core.gen.mjs を作り直す
//   node scripts/build-labor-core.mjs --check  … 作り直したものと今のファイルが 1 文字も違わないか（違えば 1 で終わる）
// 取り出すのは ROOTS から呼ばれる関数と、その中で使う一番外の定数（var／const）。STOPS はサーバーが用意する（端末の保存・ログイン・画面）。
// 依存なし（Node だけ）。中身は index.html のまま（直すときは index.html を直して、これを流す）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(here, '..');
const SRC = path.join(ROOT_DIR, 'index.html');
const OUT = path.join(ROOT_DIR, 'supabase/functions/secure-state/labor-core.gen.mjs');

// サーバーが答えるもの（端末の上書きの関数 ltServer* が受ける形）
export const ROOTS = [
  'getTipLabor', 'tipLaborBuildDay', 'toastAliasIndex', 'normalizeBusinessDate',
  '_laborWageParts', 'toastLaborCostForDate', '_meetLaborLDDay', 'ldLaborDay',
  'storeSalaryMonthly', '_laborGradeSplit', 'laborMonthWeeks', 'daysOfYm', 'laborWeekDays',
];
// サーバーが用意するもの（取り出さない）。端末の保存（ls など）・ログイン・日付・画面・端末だけのキャッシュ
export const STOPS = [
  'ls', 'lsSet', '_lrRead', 'lsSplitRO', '_lsStoreGet', '_lsRaw', 'lsKeys', 'v1136Moved',
  'getEmployees', 'STORES', 'bizToday', 'curYm', '_mdMemo',
  'getDailyActuals', 'salesActualForDay',
  'ltServerParts', 'ltServerDay', 'ltServerSalary', 'ltServerGrade',
  't', 'T', 'escapeHtml', 'showToast', 'renderPage',
];
const BUILTIN = new Set(('var function return if else for while do break continue new typeof instanceof in of this null undefined true false '
  + 'try catch finally throw switch case default delete void let const window document localStorage Math JSON Date Object Array String Number '
  + 'Boolean isNaN isFinite parseInt parseFloat RegExp Error Infinity NaN Set Map console arguments encodeURIComponent decodeURIComponent').split(' '));

// 文字列とコメントを消す（名前を探すとき、文字列の中の名前を数えない）
export function stripCode(s) {
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i], n = s[i + 1];
    if (c === '/' && n === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; out += ' '; continue; }
    if (c === '/' && n === '/' && s[i - 1] !== ':' && s[i - 1] !== '\\') { const e = s.indexOf('\n', i); i = e < 0 ? s.length : e; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < s.length && s[j] !== c) { if (s[j] === '\\') j++; if (c !== '`' && s[j] === '\n') break; j++; }
      out += '""'; i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

// 一番外の文（var NAME = …;）の終わり：深さ 0 の ; まで（文字列・コメントを飛ばす）
function statementEnd(src, start) {
  let depth = 0, i = start;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); i = e + 2; continue; }
    if (c === '/' && n === '/' && depth > 0) { const e = src.indexOf('\n', i); i = e; continue; }
    if (c === "'" || c === '"' || c === '`') { let j = i + 1; while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; } i = j + 1; continue; }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ';' && depth === 0) return i + 1;
    i++;
  }
  throw new Error('statement without end at ' + start);
}

// { の位置から対応する } の次の位置まで（文字列・テンプレート・コメント・正規表現の中の括弧は数えない）
function braceEnd(src, open) {
  if (src[open] !== '{') throw new Error('no body at ' + open);
  let depth = 0, i = open, prev = '';
  const regexBefore = /[(,=:[!&|?{};+\-*%<>~^]$|(?:^|[^\w$])(?:return|typeof|case|in|of|void|delete|throw)$/;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); i = e + 2; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); i = e; continue; }
    if (c === '/' && regexBefore.test(prev.trimEnd())) {
      let j = i + 1, cls = false;
      while (j < src.length && (cls || src[j] !== '/')) { if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '\n') throw new Error('regex without end at ' + i); j++; }
      prev += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; else if (c === '`' && src[j] === '$' && src[j + 1] === '{') { j = braceEnd(src, j + 1) - 1; } j++; }
      prev += '""'; i = j + 1; continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i + 1; }
    prev += c; if (prev.length > 64) prev = prev.slice(-32);
    i++;
  }
  throw new Error('function without end at ' + open);
}

// roots・stops を変えると、試験が同じ取り出し方で端末の関数（上書きの関数も）を取り出せる（tests/labor-totals-v1192.test.mjs）
export function analyze(raw, roots = ROOTS, stopList = STOPS) {
  const src = raw.replace(/\r\n/g, '\n');
  const fdecl = new Map();   // 名前 → 位置（一番外の function だけ。2 つあれば止める）
  for (const m of src.matchAll(/\n(?:async )?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (fdecl.has(m[1])) fdecl.set(m[1], -1); else fdecl.set(m[1], m.index + 1);
  }
  const vdecl = new Map();   // 名前 → 文の始まり（var A=…, B=…; の B も）
  for (const m of src.matchAll(/\n(?:var|const|let)\s+[A-Za-z_$]/g)) {   // 1 行目の中の名前（var A=…, B=…; の B も）
    const s = m.index + 1, line = stripCode(src.slice(s, src.indexOf('\n', s)));
    for (const v of line.matchAll(/(?:^(?:var|const|let)\s+|,\s*)([A-Za-z_$][\w$]*)\s*=(?!=)/g)) if (!vdecl.has(v[1])) vdecl.set(v[1], s);
  }
  const body = name => {
    const s = fdecl.get(name);
    if (s == null) throw new Error('function not found: ' + name);
    if (s < 0) throw new Error('function declared twice: ' + name);
    const le = src.indexOf('\n', s), first = src.slice(s, le);
    const f = stripCode(first);
    if (f.trimEnd().endsWith('}') && (f.match(/\{/g) || []).length === (f.match(/\}/g) || []).length) return first;
    // 本体の { から対応する } まで（文字列・コメント・正規表現を飛ばす）。行の頭の } で終わる関数は、前と同じ答えになることを確かめる
    const e = braceEnd(src, src.indexOf('{', src.indexOf(')', s)));
    const old = src.indexOf('\n}', s) + 2;
    if (e !== old && !/\n(?:async )?function\s/.test(src.slice(e, old))) throw new Error('function end differs: ' + name);
    return src.slice(s, e);
  };
  const stops = new Set(stopList), seen = [], vars = new Set(), usedStops = new Set(), free = new Set(), stack = [...roots];
  while (stack.length) {
    const n = stack.pop();
    if (seen.includes(n)) continue;
    seen.push(n);
    const b = stripCode(body(n));
    for (const m of b.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)/g)) {
      const r = m[1];
      if (BUILTIN.has(r)) continue;
      if (stops.has(r)) { usedStops.add(r); continue; }
      if (fdecl.has(r)) { if (!seen.includes(r)) stack.push(r); }
      else if (vdecl.has(r)) vars.add(r);
      else free.add(r);
    }
  }
  // 定数の文（同じ文に入っている別の名前も一緒に）。中で使う関数があれば止める（定数の中の関数は取り出さない）
  const stmts = [...new Set([...vars].map(v => vdecl.get(v)))].sort((a, b) => a - b).map(s => src.slice(s, statementEnd(src, s)));
  for (const st of stmts) {
    for (const m of stripCode(st).matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) if (fdecl.has(m[1]) && !BUILTIN.has(m[1])) throw new Error('constant calls a function: ' + m[1]);
  }
  const order = [...seen].sort((a, b) => fdecl.get(a) - fdecl.get(b));
  return { functions: order.map(n => ({ name: n, text: body(n) })), constants: stmts, usedStops: [...usedStops].sort(), free: [...free].sort() };
}

export function build(raw) {
  const a = analyze(raw);
  const L = [];
  L.push('// 自動で作ったファイル。手で直さない（index.html を直して `node scripts/build-labor-core.mjs` を流す）。');
  L.push('// v1192：関数 secure-state の labor（人件費の合計）が使う計算。中身は index.html の関数そのまま（' + a.functions.length + ' 個）。');
  L.push('// サーバーが用意するもの（env）：' + a.usedStops.filter(s => !/^ltServer/.test(s)).join('・'));
  L.push('/* eslint-disable */');
  L.push('export const LABOR_CORE_STOPS = ' + JSON.stringify(a.usedStops) + ';');
  L.push('export function laborCore(env) {');
  L.push('  var window = env.window || {};');
  for (const s of a.usedStops) {
    if (/^ltServer/.test(s)) L.push('  var ' + s + ' = undefined;   // サーバーでは上書きしない（端末だけ）');
    else L.push('  var ' + s + ' = env.' + s + ';');
  }
  for (const c of a.constants) L.push(c.replace(/^const /, 'var '));
  for (const f of a.functions) L.push(f.text);
  L.push('  return { ' + ROOTS.join(', ') + ' };');
  L.push('}');
  return L.join('\n') + '\n';
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const text = build(fs.readFileSync(SRC, 'utf8'));
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== text) { console.error('labor-core.gen.mjs is not up to date: run node scripts/build-labor-core.mjs'); process.exit(1); }
    console.log('labor-core.gen.mjs is up to date');
  } else {
    fs.writeFileSync(OUT, text);
    console.log('wrote ' + path.relative(ROOT_DIR, OUT) + ' (' + text.length + ' chars)');
  }
}
