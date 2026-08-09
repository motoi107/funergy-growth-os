/* verify_v896.js — 「参照はあるが宣言が無い識別子」をビルドの条件にする。
   この型で2回やられている:
     v885  AC_TABS  → 経理センターが真っ白（前の画面が残る）
     v895  _ym      → 棚卸の確定ボタンが完全に無反応
   どちらも文字列を見る検証は素通りした。参照が存在するので grep は必ず当たる。
   acorn で本物のスコープ解析をして、実行時に ReferenceError になる参照を止める。

   ALLOWED は「いま残っていて、かつ安全と確認済み」のもの。
   全部 typeof で守られていて例外にならない。ここに無いものが出たら FAIL。
   減らせるなら ALLOWED から外すこと（外し忘れも検出する）。 */
const fs = require('fs');
const { scanUndeclared } = require('./scan_undeclared.js');

const FILE = process.argv[2] || 'index.html';
const utf = fs.readFileSync(FILE, 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');

/* v896 時点で ALLOWED は空。スキャナが typeof ガードを理解するようにしたので、
   残っていた3件（mcStatusLabel / acctYm / _rbIdPre）は誤検出として消えた。
   空のまま保てるということは、ここに何か出たら必ず本物のバグということ。
   安易に足さず、まずコードを直すこと。 */
const ALLOWED = {};

let PASS = 0, FAIL = 0;
function chk(name, fn) {
  try {
    const r = fn();
    if (r === true) { PASS++; console.log('  PASS  ' + name); }
    else { FAIL++; console.log('  FAIL  ' + name + (r ? '  → ' + r : '')); }
  } catch (e) { FAIL++; console.log('  FAIL  ' + name + '  → 例外: ' + (e && e.message)); }
}

const APP = (utf.match(/const APP_VERSION = '(\d+)'/) || [])[1];
const SWB = (sw.match(/const SW_BUILD = '(\d+)'/) || [])[1];
console.log('APP_VERSION=' + APP + '  SW_BUILD=' + SWB + '\n');
chk('APP_VERSION と SW_BUILD が一致', () => APP === SWB || ('APP=' + APP + ' SW=' + SWB));

const res = scanUndeclared(FILE);
console.log('  （参照 ' + res.total + ' 件を解析）');

chk('新しい「宣言の無い参照」が無い', () => {
  const bad = [...res.reads.keys()].filter(n => !(n in ALLOWED));
  return bad.length === 0
    || ('ALLOWED に無い: ' + bad.map(n => n + '(行 ' + res.reads.get(n).join(',') + ')').join(' , '));
});

chk('ALLOWED に不要な項目が残っていない', () => {
  const stale = Object.keys(ALLOWED).filter(n => !res.reads.has(n));
  return stale.length === 0 || ('直ったので ALLOWED から外せる: ' + stale.join(','));
});

chk('暗黙のグローバルを作っていない', () => {
  const w = [...res.writes.keys()];
  return w.length === 0
    || ('宣言なしの代入: ' + w.map(n => n + '(行 ' + res.writes.get(n).join(',') + ')').join(' , '));
});

/* 過去に実際に落ちた2件が、再発したら必ず捕まること */
chk('v885 の AC_TABS 型を捕まえられる', () => {
  const r = scanUndeclared(null, utf.replace(
    'function acSetCat(id){', 'function _acProbe(){ return AC_TABS_PROBE.length; }\r\nfunction acSetCat(id){'));
  return r.reads.has('AC_TABS_PROBE') || '検出できない';
});
chk('v895 の _ym 型を捕まえられる', () => {
  const r = scanUndeclared(null, utf.replace(
    "  var ym = invYm();\r\n", "  var ym = invYm();\r\n  var _probe = _ymProbe;\r\n"));
  return r.reads.has('_ymProbe') || '検出できない';
});
chk('typeof ガードを誤検出しない（三項）', () => {
  const r = scanUndeclared(null, utf.replace(
    "  var ym = invYm();\r\n",
    "  var ym = invYm();\r\n  var _p2 = (typeof _safeProbe==='function') ? _safeProbe() : null;\r\n"));
  return !r.reads.has('_safeProbe') || 'typeof を誤検出している';
});
chk('typeof ガードを誤検出しない（&&）', () => {
  const r = scanUndeclared(null, utf.replace(
    "  var ym = invYm();\r\n",
    "  var ym = invYm();\r\n  var _p3 = (typeof _safeProbe2!=='undefined') && _safeProbe2.x;\r\n"));
  return !r.reads.has('_safeProbe2') || 'typeof を誤検出している';
});
chk('ガードの無い呼び出しは見逃さない', () => {
  const r = scanUndeclared(null, utf.replace(
    "  var ym = invYm();\r\n",
    "  var ym = invYm();\r\n  var _p4 = _bareProbe();\r\n"));
  return r.reads.has('_bareProbe') || 'ガード無しを見逃している';
});

/* 今回直した2件が戻っていないこと */
chk('_optPreview が window. 付きで統一されている', () =>
  !/[^.\w]_optPreview\b/.test(utf.replace(/window\._optPreview/g, 'window.OK')) || 'window. の無い参照が残っている');
chk('saveInvoice が window.event に頼っていない', () =>
  !/var saveBtn = event && event\.target/.test(utf) || 'window.event 依存が残っている');
chk('保存ボタンのラベルを元に戻している', () =>
  /saveBtn\.textContent = saveBtnLabel;/.test(utf) || "固定文字で戻している（'保存' に化ける）");

console.log('\n合計 PASS=' + PASS + '  FAIL=' + FAIL);
process.exit(FAIL ? 1 : 0);
