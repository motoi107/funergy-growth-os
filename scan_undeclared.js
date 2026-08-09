/* scan_undeclared.js — 「参照はあるが、そのスコープに宣言が無い」識別子を全部洗い出す。
   v885 の AC_TABS、v895 の _ym と同じ型。実行して初めて ReferenceError になるので、
   文字列を見る検証では絶対に拾えない。acorn で本物のスコープ解析をする。

   出るもの:
   ・読み取り（read）… ReferenceError で即死。ボタンが無反応になる型。
   ・書き込みのみ（write）… 暗黙のグローバルを作る。事故ではないが意図しない共有状態。 */
const fs = require('fs');
const acorn = require('acorn');

function scanUndeclared(file, srcText) {
const utf = srcText != null ? srcText : fs.readFileSync(file || 'index.html', 'utf8');
const start = utf.indexOf('<script>') + 8;
const end = utf.lastIndexOf('</script>');
const code = utf.slice(start, end);
/* 行番号を index.html に合わせるためのオフセット */
const lineOffset = utf.slice(0, start).split('\n').length - 1;

const ast = acorn.parse(code, { ecmaVersion: 2022, locations: true, allowReturnOutsideFunction: true });

/* ブラウザ／標準の組み込み。ここに無いものだけを疑う。 */
const GLOBALS = new Set(`
window document console navigator location history screen localStorage sessionStorage indexedDB
alert confirm prompt fetch XMLHttpRequest FormData Headers Request Response AbortController
setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame queueMicrotask
Math JSON Date Array Object String Number Boolean Symbol BigInt RegExp Function Error TypeError
RangeError SyntaxError ReferenceError EvalError URIError Promise Proxy Reflect Map Set WeakMap WeakSet
parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI
NaN Infinity undefined globalThis eval escape unescape structuredClone
Uint8Array Uint8ClampedArray Uint16Array Uint32Array Int8Array Int16Array Int32Array
Float32Array Float64Array BigInt64Array BigUint64Array ArrayBuffer DataView SharedArrayBuffer
Blob File FileReader FileList URL URLSearchParams Image ImageData ImageBitmap createImageBitmap
Audio Notification MediaRecorder MediaStream getComputedStyle matchMedia
Element HTMLElement HTMLCanvasElement HTMLImageElement HTMLInputElement Node NodeList Event
CustomEvent MouseEvent KeyboardEvent PointerEvent TouchEvent DragEvent MessageChannel BroadcastChannel
TextEncoder TextDecoder crypto performance caches ServiceWorker navigator atob btoa
Intl WebAssembly self top parent frames closed onerror print scrollTo scrollBy open close
CanvasRenderingContext2D Path2D DOMParser XPathResult MutationObserver IntersectionObserver
ResizeObserver AbortSignal ReadableStream WritableStream TransformStream
arguments this Worker importScripts postMessage addEventListener removeEventListener dispatchEvent
supabase Chart THREE pdfjsLib XLSX
`.trim().split(/\s+/));

/* ---------- スコープ構築 ---------- */
function newScope(parent, type) { return { parent, type, names: new Set() }; }
const rootScope = newScope(null, 'global');

function declarePattern(node, scope) {
  if (!node) return;
  switch (node.type) {
    case 'Identifier': scope.names.add(node.name); break;
    case 'ObjectPattern': node.properties.forEach(p =>
      declarePattern(p.type === 'RestElement' ? p.argument : p.value, scope)); break;
    case 'ArrayPattern': node.elements.forEach(e => declarePattern(e, scope)); break;
    case 'AssignmentPattern': declarePattern(node.left, scope); break;
    case 'RestElement': declarePattern(node.argument, scope); break;
  }
}

/* var と function宣言は関数スコープへ巻き上げる */
function functionScopeOf(scope) {
  let s = scope;
  while (s.type === 'block' && s.parent) s = s.parent;
  return s;
}

const refs = [];   /* {name, line, kind:'read'|'write', scope} */

/* 式の中で typeof の対象になっている識別子を集める */
function typeofNames(node, acc) {
  acc = acc || new Set();
  if (!node || typeof node.type !== 'string') return acc;
  if (node.type === 'UnaryExpression' && node.operator === 'typeof' && node.argument.type === 'Identifier') {
    acc.add(node.argument.name); return acc;
  }
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'start' || k === 'end' || k === 'type') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach(n => typeofNames(n, acc));
    else if (v && typeof v.type === 'string') typeofNames(v, acc);
  }
  return acc;
}

function walk(node, scope) {
  if (!node || typeof node.type !== 'string') return;
  const T = node.type;

  if (T === 'FunctionDeclaration') {
    functionScopeOf(scope).names.add(node.id.name);
    const fs2 = newScope(scope, 'function');
    node.params.forEach(p => declarePattern(p, fs2));
    walk(node.body, fs2);
    return;
  }
  if (T === 'FunctionExpression' || T === 'ArrowFunctionExpression') {
    const fs2 = newScope(scope, 'function');
    if (node.id) fs2.names.add(node.id.name);
    node.params.forEach(p => declarePattern(p, fs2));
    walk(node.body, fs2);
    return;
  }
  if (T === 'ClassDeclaration') { if (node.id) scope.names.add(node.id.name); }
  if (T === 'VariableDeclaration') {
    const target = node.kind === 'var' ? functionScopeOf(scope) : scope;
    node.declarations.forEach(dcl => {
      declarePattern(dcl.id, target);
      if (dcl.init) walk(dcl.init, scope);
    });
    return;
  }
  if (T === 'BlockStatement') {
    const bs = newScope(scope, 'block');
    node.body.forEach(n => walk(n, bs));
    return;
  }
  if (T === 'ForStatement' || T === 'ForInStatement' || T === 'ForOfStatement') {
    const bs = newScope(scope, 'block');
    if (node.init) walk(node.init, bs);
    if (node.left) walk(node.left, bs);
    if (node.right) walk(node.right, bs);
    if (node.test) walk(node.test, bs);
    if (node.update) walk(node.update, bs);
    walk(node.body, bs);
    return;
  }
  if (T === 'CatchClause') {
    const cs = newScope(scope, 'block');
    if (node.param) declarePattern(node.param, cs);
    walk(node.body, cs);
    return;
  }
  if (T === 'MemberExpression') {           /* a.b の b は識別子ではない */
    walk(node.object, scope);
    if (node.computed) walk(node.property, scope);
    return;
  }
  if (T === 'Property') {
    if (node.computed) walk(node.key, scope);
    walk(node.value, scope);
    return;
  }
  if (T === 'LabeledStatement') { walk(node.body, scope); return; }
  if (T === 'BreakStatement' || T === 'ContinueStatement') return;
  if (T === 'AssignmentExpression') {
    if (node.left.type === 'Identifier') {
      refs.push({ name: node.left.name, line: node.left.loc.start.line, kind: node.operator === '=' ? 'write' : 'read', scope });
    } else walk(node.left, scope);
    walk(node.right, scope);
    return;
  }
  if (T === 'UpdateExpression' && node.argument.type === 'Identifier') {
    refs.push({ name: node.argument.name, line: node.argument.loc.start.line, kind: 'read', scope });
    return;
  }
  if (T === 'UnaryExpression' && node.operator === 'typeof' && node.argument.type === 'Identifier') {
    /* typeof 未定義変数 は例外を投げない。既存コードの防御的な書き方なので疑わない。 */
    return;
  }
  /* (typeof X === 'function') ? X() : y  /  typeof X !== 'undefined' && X.foo
     という書き方は「X が無いかもしれない」と分かって書かれた防御。
     この型を誤検出すると許可リストが膨らみ、本物の事故が紛れてしまうので、
     テストに出てきた名前はその分岐の中だけ宣言済みとして扱う。 */
  if (T === 'ConditionalExpression' || T === 'IfStatement') {
    walk(node.test, scope);
    const g = typeofNames(node.test);
    const gs = g.size ? Object.assign(newScope(scope, 'block'), { names: g }) : scope;
    walk(node.consequent, gs);
    if (node.alternate) walk(node.alternate, gs);
    return;
  }
  if (T === 'LogicalExpression') {
    walk(node.left, scope);
    const g = typeofNames(node.left);
    walk(node.right, g.size ? Object.assign(newScope(scope, 'block'), { names: g }) : scope);
    return;
  }
  if (T === 'Identifier') {
    refs.push({ name: node.name, line: node.loc.start.line, kind: 'read', scope });
    return;
  }

  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'start' || k === 'end' || k === 'type') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach(n => walk(n, scope));
    else if (v && typeof v.type === 'string') walk(v, scope);
  }
}

ast.body.forEach(n => walk(n, rootScope));

function resolves(name, scope) {
  let s = scope;
  while (s) { if (s.names.has(name)) return true; s = s.parent; }
  return GLOBALS.has(name);
}

const readMiss = new Map(), writeMiss = new Map();
refs.forEach(r => {
  if (resolves(r.name, r.scope)) return;
  const bag = r.kind === 'read' ? readMiss : writeMiss;
  if (!bag.has(r.name)) bag.set(r.name, []);
  bag.get(r.name).push(r.line + lineOffset);
});
/* 書き込みで作られる暗黙グローバルは、読みの側では「存在する」とみなす */
writeMiss.forEach((_, n) => { /* 情報として残すだけ */ });

  return { reads: readMiss, writes: writeMiss, total: refs.length };
}
module.exports = { scanUndeclared };

/* 直接実行されたときだけ結果を表示する */
if (require.main === module) {
const res = scanUndeclared(process.argv[2] || 'index.html');
const readMiss = res.reads, writeMiss = res.writes, refs = { length: res.total };
console.log('=== 読み取り（ReferenceError で落ちる） ===');
if (!readMiss.size) console.log('  なし');
[...readMiss.entries()].sort((a, b) => a[1][0] - b[1][0]).forEach(([n, lines]) => {
  const impl = writeMiss.has(n) ? '  ※ どこかで代入もあり（暗黙グローバル。実行順によっては通る）' : '';
  console.log('  ' + n.padEnd(24) + '行 ' + lines.slice(0, 6).join(', ') + (lines.length > 6 ? ' ほか' + (lines.length - 6) : '') + impl);
});

console.log('\n=== 代入のみ（暗黙のグローバルを作っている） ===');
if (!writeMiss.size) console.log('  なし');
[...writeMiss.entries()].sort((a, b) => a[1][0] - b[1][0]).forEach(([n, lines]) => {
  console.log('  ' + n.padEnd(24) + '行 ' + lines.slice(0, 6).join(', ') + (lines.length > 6 ? ' ほか' + (lines.length - 6) : ''));
});

console.log('\n参照 ' + refs.length + ' 件を解析 / 読み取り未定義 ' + readMiss.size + ' 種類, 代入のみ ' + writeMiss.size + ' 種類');
}
