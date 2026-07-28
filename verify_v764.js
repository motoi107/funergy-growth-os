/* ============================================================
   verify_v764.js — IndexedDB 基盤（第1段階：二重書き）の検証

   実際の IDB 層を index.html から切り出し、Node 上のモック IndexedDB で動かす。
     テスト1: 挙動不変 … _lsWriteVerified の戻り値が IndexedDB の状態に左右されない
     テスト2: 二重書き … localStorage と IndexedDB の両方に入る
     テスト3: fail-closed … 開けない／読めない端末で unavailable になり、以降触らない
     テスト4: コピーであって移動ではない … localStorage から消えない
     テスト5: 自動prune を伝播させない … IndexedDB が上位集合として残る
     テスト6: 端末ローカルのキーは複製しない
     テスト7: バックフィル後に idbDiag() の差分が 0
   ============================================================ */
const fs = require('fs');
const SRC = fs.readFileSync('index.html', 'utf8');

function grab(src, name) {
  const re = new RegExp('(?:^|\\n)\\s*(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('見つかりません: ' + name);
  let i = m.index + m[0].indexOf(m[0].trim().split(/\s+/)[0]);
  i = src.indexOf('function', m.index);
  if (src.slice(m.index, i).indexOf('async') >= 0) i = src.indexOf('async', m.index);
  let d = 0, st = false, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

/* IDB ブロックを丸ごと切り出す（var IDB_NAME 〜 idbDiag の終わり） */
function idbBlock(src) {
  const s = src.indexOf("var IDB_NAME = 'funergy_os_kv'");
  if (s < 0) throw new Error('IDBブロックが見つかりません');
  const di = src.indexOf('function idbDiag()', s);
  let d = 0, st = false, j = src.indexOf('{', di);
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return src.slice(s, j);
}

/* ---- localStorage モック ---- */
function makeLS(map) {
  return {
    get length() { return Object.keys(map).length; },
    key(i) { return Object.keys(map)[i]; },
    getItem(k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem(k, v) { if (map.__full) throw new Error('QuotaExceeded'); map[k] = String(v); },
    removeItem(k) { delete map[k]; },
    clear() { Object.keys(map).forEach(k => delete map[k]); }
  };
}

/* ---- IndexedDB モック ---- */
function makeIDB(opt) {
  opt = opt || {};
  const data = new Map();
  let created = false;
  const tick = (f) => setTimeout(f, 0);
  const api = {
    _data: data,
    open() {
      const rq = {};
      tick(() => {
        if (opt.failOpen) { if (rq.onerror) rq.onerror(); return; }
        if (opt.hangOpen) return;                  /* 永久に返らない端末 */
        const db = {
          objectStoreNames: { contains: () => created },
          createObjectStore() { created = true; },
          transaction(name, mode) {
            const tx = {};
            const store = {
              put(v, k) { if (!opt.failWrite) data.set(k, v); },
              delete(k) { data.delete(k); },
              clear() { data.clear(); },
              openCursor() {
                const r2 = {};
                tick(() => {
                  if (opt.failRead) { if (r2.onerror) r2.onerror(); return; }
                  const es = [...data.entries()]; let i = 0;
                  const step = () => {
                    if (i < es.length) {
                      const [k, v] = es[i++];
                      r2.result = { key: k, value: v, continue: () => tick(step) };
                      if (r2.onsuccess) r2.onsuccess();
                    } else { r2.result = null; if (r2.onsuccess) r2.onsuccess(); }
                  };
                  step();
                });
                return r2;
              }
            };
            tx.objectStore = () => store;
            tick(() => {
              if (opt.failWrite && mode === 'readwrite') { if (tx.onerror) tx.onerror(); return; }
              if (tx.oncomplete) tx.oncomplete();
            });
            return tx;
          }
        };
        if (!created) { rq.result = db; if (rq.onupgradeneeded) rq.onupgradeneeded(); }
        rq.result = db;
        if (rq.onsuccess) rq.onsuccess();
      });
      return rq;
    }
  };
  return api;
}

function build(map, idb) {
  const prims = ['lsKeys', '_lsRaw', '_lsRawStr', '_lsRawDel', '_lsWriteVerified', 'lsIsDeviceLocal']
    .map(n => grab(SRC, n)).join('\n');
  const consts = "var LS_DEVICE_LOCAL = ['funergy_lang','supa_sync','heavy_ready','haptics_on'];";
  const listeners = { window: {}, document: {} };
  const win = { addEventListener: (e, f) => { listeners.window[e] = f; } };
  const doc = { addEventListener: (e, f) => { listeners.document[e] = f; }, visibilityState: 'visible' };
  const nav = { storage: { persist: () => { nav._persisted = true; return Promise.resolve(true); } } };
  const fn = new Function('localStorage', 'indexedDB', 'window', 'document', 'navigator', 'nowJP',
    consts + '\n' + prims + '\n' + idbBlock(SRC) + '\n' +
    'return { _lsWriteVerified:_lsWriteVerified, _lsRawDel:_lsRawDel, lsKeys:lsKeys,' +
    ' _idbBoot:_idbBoot, _idbFlush:_idbFlush, _idbClearAll:_idbClearAll, idbDiag:idbDiag,' +
    ' state:function(){return _idbState;}, mem:function(){return _IDB_MEM;} };');
  const api = fn(makeLS(map), idb, win, doc, nav, () => '2026-07-28 10:00');
  api._nav = nav; api._listeners = listeners;
  return api;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fail = 0;
const check = (label, cond, extra) => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + label + (extra ? '   ' + extra : ''));
  if (!cond) fail++;
};

(async function () {

  /* ========================================================
     テスト1 + 2: 挙動不変と二重書き
     ======================================================== */
  console.log('\n=== テスト1・2: 挙動不変と二重書き ===');
  {
    const map = {}; const idb = makeIDB();
    const api = build(map, idb);
    await api._idbBoot(); await sleep(30);

    const r1 = api._lsWriteVerified('tip_labor_F01_2026-07-01', '{"Taro":{"lunch":5}}');
    const r2 = api._lsWriteVerified('skills_st_F04-K', '{"Taro":{"a":3}}');
    await sleep(400);

    check('_lsWriteVerified の戻り値は従来どおり true', r1 === true && r2 === true);
    check('localStorage に入っている', map['tip_labor_F01_2026-07-01'] === '{"Taro":{"lunch":5}}');
    check('IndexedDB にも入っている', idb._data.get('skills_st_F04-K') === '{"Taro":{"a":3}}',
      `IDB=${idb._data.size}件`);
    check('状態が ready', api.state() === 'ready', api.state());
    check('navigator.storage.persist() を要求した', api._nav._persisted === true);
  }

  /* ========================================================
     テスト3: fail-closed
     ======================================================== */
  console.log('\n=== テスト3: IndexedDB が使えない端末（fail-closed）===');
  for (const [name, opt] of [['開けない', { failOpen: true }], ['読めない', { failRead: true }]]) {
    const map = {}; const idb = makeIDB(opt);
    const api = build(map, idb);
    await api._idbBoot(); await sleep(30);
    const r = api._lsWriteVerified('invoices', '[1,2,3]');
    await sleep(400);
    check(`${name}端末: 状態が unavailable`, api.state() === 'unavailable', api.state());
    check(`${name}端末: 保存は従来どおり成功`, r === true && map['invoices'] === '[1,2,3]');
  }
  {
    /* 書き込みだけ失敗する端末でも、アプリの保存結果は変わらない */
    const map = {}; const idb = makeIDB({ failWrite: true });
    const api = build(map, idb);
    await api._idbBoot(); await sleep(30);
    const r = api._lsWriteVerified('invoices', '[9]');
    await sleep(400);
    check('IndexedDBへの書き込みが失敗しても保存結果は true', r === true && map['invoices'] === '[9]');
  }

  {
    /* open が永久に返らない端末（プライベートモード等）。4秒で見切る */
    const map = {}; const idb = makeIDB({ hangOpen: true });
    const api = build(map, idb);
    const t0 = Date.now();
    await api._idbBoot();
    const el = Date.now() - t0;
    const r = api._lsWriteVerified('invoices', '[7]');
    check('応答しない端末: 待ち続けずに unavailable になる', api.state() === 'unavailable',
      `${(el / 1000).toFixed(1)}秒で判定 / ${api.state()}`);
    check('応答しない端末: 保存は従来どおり成功', r === true && map['invoices'] === '[7]');
  }

  /* ========================================================
     テスト4: コピーであって移動ではない
     ======================================================== */
  console.log('\n=== テスト4: 移行はコピー（localStorage から消さない）===');
  {
    const map = { 'budgets_v2_bak1': '{"budgets":[1]}', 'spl_invoices_F01': '[{"id":1}]' };
    const idb = makeIDB();
    const api = build(map, idb);
    await api._idbBoot(); await sleep(400);
    check('バックフィル後も localStorage に残っている',
      map['budgets_v2_bak1'] === '{"budgets":[1]}' && map['spl_invoices_F01'] === '[{"id":1}]');
    check('IndexedDB にコピーされた', idb._data.size === 2, `IDB=${idb._data.size}件`);
  }

  /* ========================================================
     テスト5: 自動prune を IndexedDB へ伝播させない
     ======================================================== */
  console.log('\n=== テスト5: 自動prune は伝播させない（IndexedDBが上位集合）===');
  {
    const map = { 'tip_labor_F01_2026-01-05': '{"Taro":{"lunch":3}}' };
    const idb = makeIDB();
    const api = build(map, idb);
    await api._idbBoot(); await sleep(400);
    check('先に IndexedDB へ複製されている', idb._data.has('tip_labor_F01_2026-01-05'));

    /* 自動prune を模擬：localStorage から直接消す（_lsRawDel を通さない経路） */
    delete map['tip_labor_F01_2026-01-05'];
    await sleep(400);
    check('prune 後も IndexedDB には残っている（移行後に戻せる）',
      idb._data.has('tip_labor_F01_2026-01-05'));

    /* 意図的な削除は伝播する */
    map['spl_legacy'] = '[]';
    api._lsWriteVerified('spl_legacy', '[]'); await sleep(400);
    api._lsRawDel('spl_legacy'); await sleep(400);
    check('意図的な削除（_lsRawDel）は IndexedDB にも伝わる', !idb._data.has('spl_legacy'));
  }

  /* ========================================================
     テスト6: 端末ローカルのキーは複製しない
     ======================================================== */
  console.log('\n=== テスト6: 端末ローカルのキーは移さない ===');
  {
    const map = { 'funergy_lang': 'ja', 'supa_sync': '1', '_f1_autosync': '1', 'invoices': '[]' };
    const idb = makeIDB();
    const api = build(map, idb);
    await api._idbBoot(); await sleep(400);
    const keys = [...idb._data.keys()];
    check('言語・同期設定・移行マーカーは複製されない',
      !keys.includes('funergy_lang') && !keys.includes('supa_sync') && !keys.includes('_f1_autosync'),
      `IDB=${keys.join(',') || 'なし'}`);
    check('アプリデータは複製される', keys.includes('invoices'));
  }

  /* ========================================================
     テスト7: idbDiag の差分が 0
     ======================================================== */
  console.log('\n=== テスト7: 読み元を切り替えてよいかの判定（差分0）===');
  {
    const map = {};
    for (let i = 1; i <= 25; i++) map['tip_labor_F01_2026-07-' + String(i).padStart(2, '0')] = '{"Taro":{"lunch":' + i + '}}';
    map['funergy_lang'] = 'ja';
    const idb = makeIDB();
    const api = build(map, idb);
    await api._idbBoot(); await sleep(600);
    const d = api.idbDiag();
    check('未複製が 0 件', d.missing.length === 0 && d.differ.length === 0,
      `未複製=${d.missing.length} / 内容違い=${d.differ.length}`);
    check('端末ローカルは対象外', d.lsKeys === 25 && d.idbKeys === 25, `ls=${d.lsKeys} / idb=${d.idbKeys}`);

    /* 新規保存も差分0のまま保たれる */
    api._lsWriteVerified('skills_st_F04-P', '{"Hanako":{"b":2}}');
    await sleep(400);
    const d2 = api.idbDiag();
    check('保存後も差分0を保つ', d2.missing.length === 0 && d2.differ.length === 0,
      `未複製=${d2.missing.length} / 内容違い=${d2.differ.length}`);
  }

  /* ========================================================
     テスト8: 読み取り経路に手を入れていないこと（ソース確認）
     ======================================================== */
  console.log('\n=== テスト8: 読み取り経路が無傷であること ===');
  {
    const lsFn = grab(SRC, 'ls');
    check('ls() が _IDB_MEM を参照していない', lsFn.indexOf('_IDB_MEM') < 0);
    check('_lsRaw() が _IDB_MEM を参照していない', grab(SRC, '_lsRaw').indexOf('_IDB_MEM') < 0);
    check('_splitRead() が _IDB_MEM を参照していない', grab(SRC, '_splitRead').indexOf('_IDB_MEM') < 0);
    console.log('    → この版では読み取りは完全に従来どおり。IndexedDB は書き込みの複製のみ。');
  }

  console.log('\n' + (fail === 0 ? '===== 全テスト PASS =====' : `===== ${fail} 件 FAIL =====`));
  process.exit(fail ? 1 : 0);
})();
