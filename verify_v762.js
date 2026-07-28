/* ============================================================
   verify_v762.js — 列挙(走査)の出口を lsKeys() に一本化した版の検証

   v762 は「今の挙動を変えない」変更のため、検証は2本立てにする。
     テスト1: 現行動作の同一性 … v761 と v762 が同じ結果を返すこと
     テスト2: 修正前の症状の再現 … 保存先を差し替えた世界で v761 が黙って
              0件を返し、v762 が正しい件数を返すこと
     テスト3: ループ中に削除したときの取りこぼし
   ============================================================ */
const fs = require('fs');

function grab(src, name) {
  const re = new RegExp('(?:^|\\n)\\s*function\\s+' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('見つかりません: ' + name);
  let i = m.index + m[0].indexOf('function');
  let d = 0, st = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

const V761 = fs.readFileSync('index_v761_backup.html', 'utf8');
const V762 = fs.readFileSync('index.html', 'utf8');

const TARGETS = ['workedShiftCount', 'unregisteredClockIns'];

/* ---- 端末保存のモック ---- */
function makeLS(map) {
  return {
    get length() { return Object.keys(map).length; },
    key(i) { return Object.keys(map)[i]; },
    getItem(k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem(k, v) { map[k] = String(v); },
    removeItem(k) { delete map[k]; }
  };
}
/* 保存先を差し替えた後の世界：物理 localStorage の列挙は空。データはメモリ側にある */
function makeBlindLS(map) {
  return {
    get length() { return 0; },
    key() { return null; },
    getItem() { return null; },
    setItem(k, v) { map[k] = String(v); },
    removeItem(k) { delete map[k]; }
  };
}

function build(src, ls, override) {
  const names = ['lsKeys', '_lsRaw', '_lsStoreGet'];
  /* v765: 保存層が _idbState/_IDB_MEM を参照するようになったのでスタブする。
     ここでは IndexedDB 無効時＝従来どおりの経路を検証する。 */
  let layer = "var _idbState='unavailable', _IDB_MEM=null;\n";
  for (const n of names) { try { layer += grab(src, n) + '\n'; } catch (e) { } }
  const bodies = TARGETS.map(n => grab(src, n)).join('\n');
  const fn = new Function(
    'localStorage', 'firstWorkDate', 'isoOf', 'isOrderOnlyAccount', 'getEmployees', '__ovr',
    layer + '\n' +
    'if(__ovr && __ovr.lsKeys) lsKeys = __ovr.lsKeys;\n' +
    'if(__ovr && __ovr._lsRaw) _lsRaw = __ovr._lsRaw;\n' +
    bodies + '\nreturn { workedShiftCount: workedShiftCount, unregisteredClockIns: unregisteredClockIns };'
  );
  return fn(
    ls,
    () => null,                                   // firstWorkDate: 制限なし
    (d) => new Date(d).toISOString().slice(0, 10),  // isoOf
    () => false,                                  // isOrderOnlyAccount
    () => [],                                     // getEmployees: 全員が未登録扱い
    override || null
  );
}

/* ---- テストデータ：F01 の3日分 + F02 の1日分 ---- */
function seed() {
  const today = new Date();
  const d = (n) => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10);
  return {
    ['tip_labor_F01_' + d(1)]: JSON.stringify({ 'Taro': { lunch: 5, dinner: 4 }, 'Hanako': { lunch: 3 } }),
    ['tip_labor_F01_' + d(2)]: JSON.stringify({ 'Taro': { dinner: 6 } }),
    ['tip_labor_F01_' + d(3)]: JSON.stringify({ 'Taro': { lunch: 4, dinner: 4 } }),
    ['tip_labor_F02_' + d(1)]: JSON.stringify({ 'Jiro': { lunch: 8 } }),
    'other_key_ignore': JSON.stringify({ x: 1 })
  };
}

let fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(label, cond, extra) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + label + (extra ? '   ' + extra : ''));
  if (!cond) fail++;
}

/* ============================================================
   テスト1: 現行動作の同一性（v762 は今日の挙動を変えない）
   ============================================================ */
console.log('\n=== テスト1: v761 と v762 の結果が一致するか（挙動不変の確認）===');
{
  const m1 = seed(), m2 = seed();
  const a = build(V761, makeLS(m1));
  const b = build(V762, makeLS(m2));
  const emp = { name: 'Taro', store: 'F01' };

  const w1 = a.workedShiftCount(emp), w2 = b.workedShiftCount(emp);
  check('workedShiftCount が一致', w1 === w2 && w1 === 5, `v761=${w1} / v762=${w2}（期待5）`);

  const u1 = a.unregisteredClockIns(30), u2 = b.unregisteredClockIns(30);
  check('unregisteredClockIns が一致', eq(u1, u2) && u1.length === 3,
    `v761=${u1.length}人 / v762=${u2.length}人（期待3: Taro/Hanako/Jiro）`);
}

/* ============================================================
   テスト2: 修正前の症状の再現
   保存先をメモリ側へ移した世界を模擬する。
   物理 localStorage の列挙は何も返さないが、lsKeys/_lsRaw はデータを見られる。
   ============================================================ */
console.log('\n=== テスト2: 保存先を差し替えた世界での挙動（v764移行の模擬）===');
{
  const mem = seed();
  const blind = makeBlindLS({});
  const ovr = {
    lsKeys: (p) => Object.keys(mem).filter(k => !p || k.indexOf(p) === 0),
    _lsRaw: (k, def) => { try { return mem[k] ? JSON.parse(mem[k]) : def; } catch (e) { return def; } }
  };
  const a = build(V761, blind, ovr);   // v761 は lsKeys を呼ばないので置き換えても効かない
  const b = build(V762, blind, ovr);
  const emp = { name: 'Taro', store: 'F01' };

  const w1 = a.workedShiftCount(emp), w2 = b.workedShiftCount(emp);
  check('v761 は出勤回数を 0 と誤答する（症状の再現）', w1 === 0, `v761=${w1}`);
  check('v762 は正しく 5 を返す', w2 === 5, `v762=${w2}`);

  const u1 = a.unregisteredClockIns(30), u2 = b.unregisteredClockIns(30);
  check('v761 は未登録打刻を 0 件と誤答する（症状の再現）', u1.length === 0, `v761=${u1.length}人`);
  check('v762 は 3 件を検出する', u2.length === 3, `v762=${u2.length}人`);
  console.log('    → 例外は一切出ない。数字が黙って減るだけなので気付けない。');
}

/* ============================================================
   テスト3: ループ中に削除したときの取りこぼし
   ============================================================ */
console.log('\n=== テスト3: 列挙中にキーを削除したときの取りこぼし ===');
{
  const map = { a1: '1', a2: '2', a3: '3', a4: '4' };
  const ls = makeLS(map);
  /* 従来の直接走査：削除すると添字がずれて次のキーを飛ばす */
  const seen = [];
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i); if (!k) continue;
    seen.push(k); ls.removeItem(k);
  }
  check('従来の直接走査は取りこぼす', seen.length < 4, `見えたのは ${seen.join(',')}（4件中${seen.length}件）`);

  const map2 = { a1: '1', a2: '2', a3: '3', a4: '4' };
  const ls2 = makeLS(map2);
  const api = build(V762, ls2);
  const keys = new Function('localStorage', grab(V762, 'lsKeys') + '\nreturn lsKeys("a");')(ls2);
  const seen2 = [];
  keys.forEach(k => { seen2.push(k); ls2.removeItem(k); });
  check('lsKeys() は先に確定させるので取りこぼさない', seen2.length === 4, `${seen2.join(',')}（4件）`);
}

/* ============================================================
   テスト4: 生の localStorage 走査が残っていないか
   ============================================================ */
console.log('\n=== テスト4: 変換漏れの機械チェック ===');
{
  const LAYER = ['_splitRead', '_splitPartitionsRaw', 'lsBytesTotal', 'lsPrunableInfo', '_lsPrunableKeys',
    '_lsLaborKeys', '_lsFreeOldLaborKeys', '_lsAllKeysBySize', '_lsTopKeysHtml', 'lsKeys'];
  const lines = V762.split('\r\n');
  const decls = [];
  lines.forEach((l, i) => {
    const m = /(?:^|\s)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(l);
    if (m) decls.push([i, m[1]]);
  });
  const owner = (idx) => { let n = '(top)'; for (const [i, x] of decls) { if (i <= idx) n = x; else break; } return n; };
  /* コメント行は除外する。v762 の説明コメント自体が旧パターンを本文に含むため */
  let inBlock = false;
  const isComment = (l) => {
    const t = l.trim();
    if (inBlock) { if (t.indexOf('*/') >= 0) inBlock = false; return true; }
    if (t.indexOf('/*') === 0) { if (t.indexOf('*/') < 0) inBlock = true; return true; }
    return t.indexOf('//') === 0 || t.indexOf('*') === 0;
  };
  const left = [];
  lines.forEach((l, i) => {
    const c = isComment(l);
    if (c) return;
    if (!/localStorage\.(length|key)\b/.test(l)) return;
    const o = owner(i);
    if (LAYER.includes(o) || /^migrate/.test(o)) return;
    left.push(`${i + 1}:${o}`);
  });
  check('保存層と移行処理を除き、生の列挙が残っていない', left.length === 0, left.join(' / ') || '残り0件');
}

console.log('\n' + (fail === 0 ? '===== 全テスト PASS =====' : `===== ${fail} 件 FAIL =====`));
process.exit(fail ? 1 : 0);
