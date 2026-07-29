/* ============================================================
   verify_v773.js — 容量警告・自動pruneの撤去

   実関数を index.html（v773）と index_v772_backup.html（v772）の両方から切り出し、
   Node 上のモック localStorage で動かして「修正前の症状」を再現する。

     テスト1: 症状再現 … v772 は IndexedDB が使えていても勤怠キャッシュを削除する
     テスト2: v773 は 'ready' の端末で削除しない
     テスト3: v773 は 'init'（判定前）でも削除しない ← 'ready' 条件では防げない箇所
     テスト4: v773 は 'unavailable' の端末では従来どおり削除する（退行防止）
     テスト5: _idbBoot が unavailable に確定したとき autoPruneIfCritical を1回呼ぶ
     テスト6: 容量カード … 'ready' で 5MBメーター・赤・「上限に近づいたら」を出さない
     テスト7: 容量カード … 'unavailable' では従来のメーターを出す（退行防止）
     テスト8: 整理できるキャッシュが0件ならボタンを出さない
     テスト9: _capacityCauseText … 'ready' で容量のせいにしない
     テスト10: 呼び出し元（initApp・請求書の書き戻し）は据え置き
   ============================================================ */
const fs = require('fs');
const SRC = fs.readFileSync('index.html', 'utf8');
const OLD = fs.readFileSync('index_v772_backup.html', 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { console.log('  ✅ ' + msg); pass++; }
  else { console.log('  ❌ ' + msg); fail++; }
}

/* ---- 関数の切り出し（verify_v764.js と同じ方式） ---- */
function grab(src, name) {
  const re = new RegExp('(?:^|\\n)\\s*(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('見つかりません: ' + name);
  let i = src.indexOf('function', m.index);
  if (src.slice(m.index, i).indexOf('async') >= 0) i = src.indexOf('async', m.index);
  let d = 0, st = false, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

/* ---- localStorage モック ---- */
function makeLS(map) {
  return {
    get length() { return Object.keys(map).length; },
    key(i) { return Object.keys(map)[i]; },
    getItem(k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem(k, v) { map[k] = String(v); },
    removeItem(k) { delete map[k]; }
  };
}

/* localStorage を約4.8MB にする。中身は
   ・削除対象になりうる勤怠キャッシュ（当月＝古い月ではないので _lsFreeOldLaborKeys では消えない）
   ・保護されている手入力データ（これが大半なので、消しても4.3MBを下回らない）  */
function seedFullStorage() {
  const map = {};
  const ym = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
  /* 削除対象になりうる勤怠キャッシュ（当月なので _lsFreeOldLaborKeys では消えない）: 約0.4MB */
  map['tip_labor_F01_' + ym] = 'x'.repeat(100000);
  map['tip_labor_F02_' + ym] = 'x'.repeat(100000);
  /* 保護されている手入力データ: 約4.5MB。
     実機と同じく「これだけで4.3MBを超える」比率にする。
     消せるものを全部消しても閾値を下回らない、というのが症状の核心。 */
  for (let i = 0; i < 9; i++) map['spl_invoices_F0' + i] = 'y'.repeat(260000);
  return map;
}

/* ---- 対象版のサンドボックスを作る ---- */
function build(src, opts) {
  opts = opts || {};
  const map = opts.map || seedFullStorage();
  const sandbox = {
    localStorage: makeLS(map),
    _idbState: opts.idbState || 'ready',
    _IDB_MEM: opts.mem || new Map(),
    _idbStat: { loaded: 0, wrote: 0, failed: 0, backfilled: 0, at: '' },
    console,
    Date, Math, Object, Array, String, Number, JSON, RegExp,
    t: (ja, en) => ja,
    escapeHtml: (s) => String(s),
    _map: map
  };

  const names = ['lsKeys', 'lsBytesTotal', 'lsIsPrunable', 'lsPrunableInfo', '_lsPrunableKeys',
    '_lsLaborKeys', '_lsFreeOldLaborKeys', 'autoPruneIfCritical', 'idbDiag', 'renderStorageCard'];
  let code = "var _LS_PRUNABLE=[];\n";
  code += "function lsIsDeviceLocal(k){ return String(k).charAt(0)==='_'; }\n";
  code += "function _lsRawStr(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }\n";
  for (const n of names) {
    if (n === '_lsPruneNeeded') continue;
    try { code += grab(src, n) + '\n'; } catch (e) { code += '/* skip ' + n + ' */\n'; }
  }
  try { code += grab(src, '_lsPruneNeeded') + '\n'; } catch (e) { }
  try { code += grab(src, '_capacityCauseText') + '\n'; } catch (e) { }

  const vm = require('vm');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

console.log('\n===== テスト1: 症状再現（v772 は ready でも勤怠キャッシュを消す） =====');
{
  const s = build(OLD, { idbState: 'ready' });
  const before = Object.keys(s._map).filter(k => k.indexOf('tip_labor_') === 0).length;
  s.autoPruneIfCritical();
  const after = Object.keys(s._map).filter(k => k.indexOf('tip_labor_') === 0).length;
  ok(before === 2, 'v772: 実行前は勤怠キャッシュが2件ある');
  ok(after === 0, 'v772: IndexedDB が使えていても削除される（これが撤去したい挙動）');
  const info = s.lsPrunableInfo();
  ok(info.count === 0, 'v772: 削除後は「整理可能キャッシュ 0件」になる（ボタンが効かなくなる原因）');
  ok(s.lsBytesTotal() > 4.3 * 1024 * 1024, 'v772: それでも総量は4.3MBを下回らない（赤いまま＝打つ手なし）');
}

console.log('\n===== テスト2: v773 は ready の端末で削除しない =====');
{
  const s = build(SRC, { idbState: 'ready' });
  s.autoPruneIfCritical();
  const after = Object.keys(s._map).filter(k => k.indexOf('tip_labor_') === 0).length;
  ok(after === 2, 'v773: 勤怠キャッシュが残る');
}

console.log('\n===== テスト3: v773 は init（判定前）でも削除しない =====');
{
  const s = build(SRC, { idbState: 'init' });
  s.autoPruneIfCritical();
  const after = Object.keys(s._map).filter(k => k.indexOf('tip_labor_') === 0).length;
  ok(after === 2, "v773: 'init' でも残る（initApp 時点では ready とは限らないため）");

  const s2 = build(OLD, { idbState: 'init' });
  s2.autoPruneIfCritical();
  ok(Object.keys(s2._map).filter(k => k.indexOf('tip_labor_') === 0).length === 0,
    "v772: 'init' では削除されていた（'ready' 条件だけでは防げない）");
}

console.log('\n===== テスト4: v773 は unavailable では従来どおり削除する =====');
{
  const s = build(SRC, { idbState: 'unavailable' });
  s.autoPruneIfCritical();
  const after = Object.keys(s._map).filter(k => k.indexOf('tip_labor_') === 0).length;
  ok(after === 0, 'v773: IndexedDB が使えない端末では削除される（5MB制約は本物のため）');
}

console.log('\n===== テスト5: _idbBoot が unavailable 確定時に prune を呼ぶ =====');
{
  const boot = grab(SRC, '_idbBoot');
  ok(/finally\s*\{/.test(boot), '_idbBoot に finally がある');
  ok(boot.indexOf('autoPruneIfCritical') >= 0, '_idbBoot から autoPruneIfCritical を呼ぶ');
  ok(/_idbState\s*===\s*'unavailable'\s*&&/.test(boot), "unavailable のときだけ呼ぶ");
  ok(grab(OLD, '_idbBoot').indexOf('autoPruneIfCritical') < 0, 'v772 には無かった（取りこぼしの経路）');

  /* 実際に3経路とも finally を通ることを確認する */
  const vm = require('vm');
  let called = 0;
  const sb = {
    _idbState: 'init', _idbDB: null, _IDB_MEM: null,
    _idbStat: { loaded: 0, backfilled: 0 },
    _idbOpen: async () => null,
    _idbLoadAll: async () => null,
    _idbFlush: () => { },
    _idbBackfill: () => 0,
    autoPruneIfCritical: () => { called++; },
    navigator: {}, console
  };
  vm.createContext(sb);
  vm.runInContext(boot, sb);
  return_check(sb, () => called);
  function return_check(sbx, get) {
    sbx._idbBoot().then(() => {
      ok(sbx._idbState === 'unavailable', '開けない端末は unavailable になる');
      ok(get() === 1, 'そのとき autoPruneIfCritical が1回だけ呼ばれる');
      afterAsync();
    });
  }
}

function afterAsync() {
  console.log('\n===== テスト6: 容量カード（ready）に警告を出さない =====');
  {
    const mem = new Map([['a', 'z'.repeat(1000)]]);
    const s = build(SRC, { idbState: 'ready', mem });
    const html = s.renderStorageCard();
    ok(html.indexOf('上限に近づいたら') < 0, '「上限に近づいたら整理してください」を出さない');
    ok(html.indexOf('/ ~5 MB') < 0, '5MBメーターを出さない');
    ok(html.indexOf('var(--red)') < 0, '赤を使わない');
    ok(html.indexOf('IndexedDB') >= 0, '実際の保存先を示す');

    const oldHtml = build(OLD, { idbState: 'ready', mem }).renderStorageCard();
    ok(oldHtml.indexOf('上限に近づいたら') >= 0, 'v772 は警告を出していた（症状再現）');
    ok(oldHtml.indexOf('var(--red)') >= 0, 'v772 は赤で表示していた（症状再現）');
  }

  console.log('\n===== テスト7: 容量カード（unavailable）は従来どおり =====');
  {
    const s = build(SRC, { idbState: 'unavailable' });
    const html = s.renderStorageCard();
    ok(html.indexOf('/ ~5 MB') >= 0, '5MBメーターを出す');
    ok(html.indexOf('var(--red)') >= 0, '上限に近ければ赤で出す');
  }

  console.log('\n===== テスト8: 整理できるものが0件ならボタンを出さない =====');
  {
    const s = build(SRC, { idbState: 'unavailable' });
    s.autoPruneIfCritical();                       /* 整理可能キャッシュが0件になる */
    ok(s.lsPrunableInfo().count === 0, '前提: 整理可能キャッシュ 0件');
    ok(s.renderStorageCard().indexOf('runStorageCleanup()') < 0, 'ボタンを出さない');

    const s2 = build(SRC, { idbState: 'unavailable' });
    ok(s2.lsPrunableInfo().count > 0, '前提: 整理可能キャッシュがある');
    ok(s2.renderStorageCard().indexOf('runStorageCleanup()') >= 0, 'あるときは出す');

    const o = build(OLD, { idbState: 'unavailable' });
    o.autoPruneIfCritical();
    ok(o.renderStorageCard().indexOf('runStorageCleanup()') >= 0,
      'v772 は0件でもボタンを出していた（押しても何も起きない状態）');
  }

  console.log('\n===== テスト9: 保存失敗の原因説明 =====');
  {
    const r = build(SRC, { idbState: 'ready' });
    ok(r._capacityCauseText('4.8').indexOf('容量が原因ではありません') >= 0,
      'ready: 容量のせいにしない');
    const u = build(SRC, { idbState: 'unavailable' });
    ok(u._capacityCauseText('4.8').indexOf('上限に達している可能性') >= 0,
      'unavailable: 従来の説明を出す');
    ok(SRC.indexOf('_capacityCauseText(mb)') >= 0 && SRC.indexOf('_capacityCauseText(_mb)') >= 0,
      '勤怠診断・スキル診断・Invoice がヘルパを使っている');
  }

  console.log('\n===== テスト10: 呼び出し元は据え置き =====');
  {
    const n = (SRC.match(/autoPruneIfCritical\(\)/g) || []).length;
    const o = (OLD.match(/autoPruneIfCritical\(\)/g) || []).length;
    ok(SRC.indexOf('try{ autoPruneIfCritical(); }catch(e){}') >= 0,
      'initApp・請求書の書き戻しからの呼び出しはそのまま（ゲートは関数の中）');
    ok(n === o + 2, '呼び出しが増えたのは _idbBoot と定義側の2箇所だけ（' + o + ' → ' + n + '）');
  }

  console.log('\n===== 結果: PASS ' + pass + ' / FAIL ' + fail + ' =====');
  if (fail) process.exit(1);
  console.log('===== 全テスト PASS =====\n');
}
