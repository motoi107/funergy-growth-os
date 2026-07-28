/* ============================================================
   verify_v763.js — 書き込み・単発読みの出口を保存層へ揃えた版の検証

     テスト1: 現行動作の同一性 … v762 と v763 が同じ結果になること
     テスト2: 修正前の症状の再現 … 保存先を差し替えた世界で v762 の予算バックアップが
              失われ、v763 は残ること
     テスト3: 残った直接アクセスが「意図的な端末ローカル」だけであること
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

const V762 = fs.readFileSync('index_v762_backup.html', 'utf8');
const V763 = fs.readFileSync('index.html', 'utf8');

function makeLS(map) {
  return {
    get length() { return Object.keys(map).length; },
    key(i) { return Object.keys(map)[i]; },
    getItem(k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem(k, v) { map[k] = String(v); },
    removeItem(k) { delete map[k]; }
  };
}
/* 保存先を差し替えた後：物理 localStorage は読めず、書いても誰も読まない */
function makeBlindLS() {
  const dead = {};
  return {
    get length() { return 0; },
    key() { return null; },
    getItem() { return null; },
    setItem(k, v) { dead[k] = String(v); },
    removeItem() { },
    _dead: dead
  };
}

/* 対象：予算バックアップの世代送り（Marujuu 7月の件と同じ、消えては困るデータ） */
function build(src, ls, budgets, override) {
  const layer = ['_lsStoreGet', '_lsRaw', '_lsRawStr', '_lsWriteVerified'].map(n => {
    try { return grab(src, n); } catch (e) { return ''; }
  }).join('\n');
  const stub = "var _idbState='unavailable', _IDB_MEM=null;\nfunction _idbQueue(){ return false; }\n";
  const bodies = [grab(src, 'snapshotBudgetsLocal'), grab(src, 'budgetSnapshotList')].join('\n');
  const fn = new Function('localStorage', 'ls', '_budHasReal', 'nowJP', '__ovr',
    stub + layer + '\n' +
    'if(__ovr){ if(__ovr._lsRaw) _lsRaw=__ovr._lsRaw; if(__ovr._lsRawStr) _lsRawStr=__ovr._lsRawStr;' +
    ' if(__ovr._lsWriteVerified) _lsWriteVerified=__ovr._lsWriteVerified; }\n' +
    bodies + '\nreturn { snap: snapshotBudgetsLocal, list: budgetSnapshotList };'
  );
  return fn(ls, (k, d) => (k === 'budgets_v2' ? budgets.cur : d),
    (b) => !!(b && b.months && Object.keys(b.months).length),
    () => '2026-07-28 10:00', override || null);
}

let fail = 0;
const check = (label, cond, extra) => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + label + (extra ? '   ' + extra : ''));
  if (!cond) fail++;
};

const gen = (n) => [{ storeId: 'F05', months: { ['2026-0' + n]: { dow: [n] } } }];

/* ============================================================
   テスト1: 現行動作の同一性
   ============================================================ */
console.log('\n=== テスト1: v762 と v763 で世代送りの結果が一致するか ===');
{
  const run = (src) => {
    const map = {}, ls = makeLS(map), box = { cur: null };
    const api = build(src, ls, box);
    [1, 2, 3].forEach(n => { box.cur = gen(n); api.snap(); });
    return { list: api.list(), keys: Object.keys(map).sort() };
  };
  const a = run(V762), b = run(V763);
  check('世代の中身が一致', JSON.stringify(a.list) === JSON.stringify(b.list),
    `v762=${a.list.length}世代 / v763=${b.list.length}世代（期待3）`);
  check('保存されたキーが一致', JSON.stringify(a.keys) === JSON.stringify(b.keys), b.keys.join(','));
  check('3世代そろっている', b.list.length === 3);

  /* 同じ内容を2回保存しても世代を無駄に消費しない（重複判定が効いているか） */
  const map2 = {}, box2 = { cur: gen(1) };
  const api2 = build(V763, makeLS(map2), box2);
  api2.snap(); api2.snap(); api2.snap();
  check('同一内容の連続保存で世代を潰さない', api2.list().length === 1, `${api2.list().length}世代`);
}

/* ============================================================
   テスト2: 修正前の症状の再現
   ============================================================ */
console.log('\n=== テスト2: 保存先を差し替えた世界（v764移行の模擬）===');
{
  const runBlind = (src) => {
    const mem = {}, box = { cur: null };
    const ovr = {
      _lsRaw: (k, def) => { try { return mem[k] ? JSON.parse(mem[k]) : def; } catch (e) { return def; } },
      _lsRawStr: (k) => (mem[k] == null ? null : mem[k]),
      _lsWriteVerified: (k, j) => { mem[k] = String(j); return true; }
    };
    const api = build(src, makeBlindLS(), box, ovr);
    [1, 2, 3].forEach(n => { box.cur = gen(n); api.snap(); });
    return { mem, list: api.list() };
  };
  const a = runBlind(V762), b = runBlind(V763);
  check('v762 は予算バックアップを1件も残せない（症状の再現）', a.list.length === 0,
    `残った世代=${a.list.length}`);
  check('v763 は3世代とも残る', b.list.length === 3, `残った世代=${b.list.length}`);
  console.log('    → v762 は例外も警告も出さない。予算を保存するたび静かに退避を失う。');
}

/* ============================================================
   テスト3: 残った直接アクセスの棚卸し
   ============================================================ */
console.log('\n=== テスト3: 残った localStorage 直接アクセスの棚卸し ===');
{
  const LAYER = ['ls', 'lsSet', '_lsRaw', '_lsRawStr', '_lsRawDel', '_lsWriteVerified', '_lsSetVerified',
    '_splitRead', '_splitWrite', '_splitPartitionsRaw', '_outboxGet', '_outboxSet', 'autoPruneIfCritical',
    '_lsPrunableKeys', 'lsPrunableInfo', 'lsBytesTotal', '_lsAllKeysBySize', '_lsTopKeysHtml',
    'freeRecoverableSpace', 'runStorageCleanup', '_lsFreeOldLaborKeys', '_lsLaborKeys',
    '_lsRequestDeferredPrefix', 'clearAllData', 'freeCacheAndRetrySkill', 'lsKeys',
    '_lsStoreGet', '_idbQueue', '_idbFlush', '_idbRequeue', '_idbBackfill', '_idbBoot',
    '_idbClearAll', '_idbOpen', '_idbLoadAll', '_idbAvailable', 'idbDiag'];
  const DEVICE = ['funergy_lang', 'supa_sync', 'heavy_ready', 'haptics_on', 'HAPTIC_KEY'];

  const lines = V763.split('\r\n');
  const decls = [];
  lines.forEach((l, i) => {
    const m = /(?:^|\s)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(l);
    if (m) decls.push([i, m[1]]);
  });
  const owner = (idx) => { let n = '(top)'; for (const [i, x] of decls) { if (i <= idx) n = x; else break; } return n; };

  let inBlock = false;
  const isComment = (l) => {
    const t = l.trim();
    if (inBlock) { if (t.indexOf('*/') >= 0) inBlock = false; return true; }
    if (t.indexOf('/*') === 0) { if (t.indexOf('*/') < 0) inBlock = true; return true; }
    return t.indexOf('//') === 0 || t.indexOf('*') === 0;
  };

  const leftovers = [];
  lines.forEach((l, i) => {
    if (isComment(l)) return;
    if (!/localStorage\.(setItem|getItem|removeItem|length|key)\b/.test(l)) return;
    const o = owner(i);
    if (LAYER.includes(o)) return;
    if (/^migrate/.test(o)) return;              /* 一度きりの移行は v764 で扱う */
    const re = /localStorage\.(?:setItem|getItem|removeItem)\(\s*([^,)]+)/g;
    let m, ok = true, keys = [];
    while ((m = re.exec(l))) {
      const k = m[1].trim().replace(/^['"]|['"]$/g, '');
      keys.push(k);
      if (!(DEVICE.includes(k) || k.charAt(0) === '_')) ok = false;
    }
    if (!keys.length) ok = false;                /* length/key の走査が残っている */
    if (!ok) leftovers.push(`${i + 1}:${o}(${keys.join('|') || '走査'})`);
  });
  check('残っているのは端末ローカルのキーだけ', leftovers.length === 0,
    leftovers.join(' / ') || '漏れ0件');
  console.log('    据え置き（意図的）: ' + DEVICE.slice(0, 4).join(', ') + ' と _ 始まりの移行済みマーカー');
}

/* ============================================================
   テスト4: 握り潰された catch による失敗検知の欠落（v763作業中に作り込んだ症状の再現）
   _lsWriteVerified は例外を内部で処理して真偽値を返すため、
   try/catch のまま置き換えると catch が発火せず「失敗0件」になる。
   請求書の書き戻しでは、それが旧キーの消去条件になっていた。
   ============================================================ */
console.log('\n=== テスト4: 保存失敗の検知が効いているか（請求書の書き戻し）===');
{
  /* 容量オーバーの端末を模擬：F02 だけ保存できない */
  const mkWrite = (badStore) => (key, json) => (key.indexOf(badStore) >= 0 ? false : true);
  const byStore = { F01: [1], F02: [2], F03: [3] };

  /* 旧い形：例外を投げない書き込みを try/catch で見張る → 失敗を取りこぼす */
  const oldShape = () => {
    const w = mkWrite('F02'); const failed = [];
    Object.keys(byStore).forEach((id) => {
      try { w('spl_invoices_' + id, '[]'); } catch (e) { failed.push(id); }
    });
    return failed;
  };
  /* 新しい形：戻り値で判定する */
  const newShape = () => {
    const w = mkWrite('F02'); const failed = [];
    Object.keys(byStore).forEach((id) => {
      if (!w('spl_invoices_' + id, '[]')) failed.push(id);
    });
    return failed;
  };
  check('try/catch のままだと失敗を取りこぼす（症状の再現）', oldShape().length === 0,
    `検知した失敗=${oldShape().length}件（実際は1件）`);
  check('戻り値判定なら F02 の失敗を検知する', newShape().length === 1 && newShape()[0] === 'F02',
    `検知=${newShape().join(',')}`);

  /* 製品コードが戻り値判定になっていること */
  const srcOk = /if\(!_lsWriteVerified\('spl_invoices_'\+id, JSON\.stringify\(byStore\[id\]\)\)\) failed\.push\(id\);/.test(V763);
  check('製品コードが戻り値で failed を積んでいる', srcOk);
  const legacyGuard = /if\(!failed\.length\)\{ _lsWriteVerified\('invoices','\[\]'\); \}/.test(V763);
  check('旧キーの消去は failed が空のときだけ', legacyGuard);
}

console.log('\n' + (fail === 0 ? '===== 全テスト PASS =====' : `===== ${fail} 件 FAIL =====`));
process.exit(fail ? 1 : 0);
