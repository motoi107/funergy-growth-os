/* ============================================================
   verify_v765.js — 読み元を IndexedDB へ切り替えた版の検証

     テスト1: 端末が満杯でも保存でき、直後に読めること（容量問題の解決）
     テスト2: 自動prune で localStorage から消えたものが読めること
     テスト3: 読み元の優先順位（IndexedDB が勝つ）
     テスト4: lsKeys が和集合になっていること
     テスト5: バックフィルが新しい値を古い値で潰さないこと（v764の欠陥の再現）
     テスト6: IndexedDB が使えない端末では完全に従来どおり
     テスト7: 書き込み失敗時に積み直し、本当に失われた分だけ通知する
   ============================================================ */
const fs = require('fs');
const SRC = fs.readFileSync('index.html', 'utf8');
const V764 = fs.readFileSync('index_v764_backup.html', 'utf8');

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
function idbBlock(src) {
  const s = src.indexOf("var IDB_NAME = 'funergy_os_kv'");
  const di = src.indexOf('function idbDiag()', s);
  let d = 0, st = false, j = src.indexOf('{', di);
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return src.slice(s, j);
}

function makeLS(map) {
  return {
    get length() { return Object.keys(map).filter(k => k !== '__full').length; },
    key(i) { return Object.keys(map).filter(k => k !== '__full')[i]; },
    getItem(k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem(k, v) { if (map.__full) throw new Error('QuotaExceededError'); map[k] = String(v); },
    removeItem(k) { delete map[k]; },
    clear() { Object.keys(map).forEach(k => delete map[k]); }
  };
}
function makeIDB(opt) {
  opt = opt || {};
  const data = new Map(); let created = false;
  const tick = (f) => setTimeout(f, 0);
  return {
    _data: data, _opt: opt,
    open() {
      const rq = {};
      tick(() => {
        if (opt.failOpen) { if (rq.onerror) rq.onerror(); return; }
        const db = {
          objectStoreNames: { contains: () => created },
          createObjectStore() { created = true; },
          transaction(name, mode) {
            const tx = {};
            tx.objectStore = () => ({
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
            });
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
}

function build(src, map, idb) {
  const prims = ['lsKeys', '_lsStoreGet', '_lsRaw', '_lsRawStr', '_lsRawDel', '_lsWriteVerified', 'lsIsDeviceLocal']
    .map(n => { try { return grab(src, n); } catch (e) { return ''; } }).join('\n');
  const lsFn = grab(src, 'ls');
  const stub = [
    "var LS_DEVICE_LOCAL = ['funergy_lang','supa_sync','heavy_ready','haptics_on'];",
    "var _SPLIT_KEYS = {};",                       /* 分割キーは対象外にして本体経路を見る */
    "var _LS_FETCHED = {};",
    "function _lsOnDemand(){ return false; }",
    "function _lsRequestDeferred(){}",
    "function _lsRequestDeferredPrefix(){}",
    "function _lsSplitOnDemandPrefix(){ return null; }",
    "function _splitRead(){ return null; }",
    "function _lsNoteSaveFailure(k){ (window.__noted=window.__noted||[]).push(k); }"
  ].join('\n');
  const win = { addEventListener: () => { }, __noted: [] };
  const doc = { addEventListener: () => { }, visibilityState: 'visible' };
  const nav = { storage: { persist: () => Promise.resolve(true) } };
  const fn = new Function('localStorage', 'indexedDB', 'window', 'document', 'navigator', 'nowJP',
    stub + '\n' + prims + '\n' + lsFn + '\n' + idbBlock(src) + '\n' +
    'return { ls:ls, lsKeys:lsKeys, w:_lsWriteVerified, del:_lsRawDel, raw:_lsRawStr,' +
    ' boot:_idbBoot, flush:_idbFlush, diag:idbDiag, state:function(){return _idbState;},' +
    ' mem:function(){return _IDB_MEM;} };');
  const api = fn(makeLS(map), idb, win, doc, nav, () => '2026-07-28 10:00');
  api._win = win;
  return api;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fail = 0;
const check = (l, c, e) => { console.log((c ? '  ✅ ' : '  ❌ ') + l + (e ? '   ' + e : '')); if (!c) fail++; };

(async function () {

  console.log('\n=== テスト1: 端末が満杯でも保存でき、直後に読める ===');
  {
    const map = {}; const idb = makeIDB();
    const api = build(SRC, map, idb);
    await api.boot(); await sleep(30);

    map.__full = true;                                   /* localStorage を満杯にする */
    const ok = api.w('spl_onboardings_Scarlett Dias', '{"id":"sc","done":true}');
    check('保存が成功と判定される', ok === true);
    check('localStorage には入っていない', map['spl_onboardings_Scarlett Dias'] === undefined);
    const back = api.ls('spl_onboardings_Scarlett Dias', null);
    check('保存直後に読み戻せる（書き込み完了を待たずに）',
      back && back.id === 'sc', JSON.stringify(back));
    await sleep(400);
    check('IndexedDB にも書かれている',
      idb._data.get('spl_onboardings_Scarlett Dias') === '{"id":"sc","done":true}');
  }

  console.log('\n=== テスト2: prune で localStorage から消えたものが読める ===');
  {
    const map = { 'tip_labor_F01_2026-01-05': '{"Taro":{"lunch":3}}' };
    const idb = makeIDB();
    const api = build(SRC, map, idb);
    await api.boot(); await sleep(400);
    delete map['tip_labor_F01_2026-01-05'];              /* 自動prune を模擬 */
    const v = api.ls('tip_labor_F01_2026-01-05', null);
    check('IndexedDB 側から読める', v && v.Taro && v.Taro.lunch === 3, JSON.stringify(v));
  }

  console.log('\n=== テスト3: 読み元の優先順位（IndexedDBが勝つ）===');
  {
    const map = { 'skills_st_F04-K': '{"Taro":{"lv":1}}' };   /* 古い値が残っている */
    const idb = makeIDB();
    idb._data.set('skills_st_F04-K', '{"Taro":{"lv":4}}');    /* 満杯時に入った新しい値 */
    const api = build(SRC, map, idb);
    await api.boot(); await sleep(400);
    const v = api.ls('skills_st_F04-K', null);
    check('新しい IndexedDB の値が返る', v.Taro.lv === 4, 'lv=' + v.Taro.lv);
    check('localStorage の古い値で上書きされていない',
      idb._data.get('skills_st_F04-K') === '{"Taro":{"lv":4}}');
  }

  console.log('\n=== テスト4: lsKeys が和集合になっている ===');
  {
    const map = { 'inv_F01': '[]' };
    const idb = makeIDB();
    idb._data.set('inv_F02', '[]');
    const api = build(SRC, map, idb);
    await api.boot(); await sleep(400);
    const ks = api.lsKeys('inv_').sort();
    check('両方のキーが列挙される', ks.join(',') === 'inv_F01,inv_F02', ks.join(','));
  }

  console.log('\n=== テスト5: バックフィルが新しい値を潰さない（v764の欠陥）===');
  {
    /* 端末が満杯で localStorage は古いまま、IndexedDB にだけ新しい値が入った状態で再起動 */
    const seed = () => {
      const map = { 'budgets_v2_bak1': '{"budgets":[{"old":true}]}' };
      const idb = makeIDB();
      idb._data.set('budgets_v2_bak1', '{"budgets":[{"new":true}]}');
      return { map, idb };
    };
    const a = seed(); const apiA = build(V764, a.map, a.idb);
    await apiA.boot(); await sleep(500);
    check('v764 は起動時に古い値で上書きしてしまう（症状の再現）',
      a.idb._data.get('budgets_v2_bak1') === '{"budgets":[{"old":true}]}',
      a.idb._data.get('budgets_v2_bak1'));

    const b = seed(); const apiB = build(SRC, b.map, b.idb);
    await apiB.boot(); await sleep(500);
    check('v765 は新しい値を保つ',
      b.idb._data.get('budgets_v2_bak1') === '{"budgets":[{"new":true}]}',
      b.idb._data.get('budgets_v2_bak1'));
  }

  console.log('\n=== テスト6: IndexedDB が使えない端末は完全に従来どおり ===');
  {
    const map = { 'invoices': '[{"id":1}]' };
    const idb = makeIDB({ failOpen: true });
    const api = build(SRC, map, idb);
    await api.boot(); await sleep(50);
    check('状態が unavailable', api.state() === 'unavailable', api.state());
    check('読み取りは localStorage から', JSON.stringify(api.ls('invoices', null)) === '[{"id":1}]');
    const ok = api.w('invoices', '[{"id":2}]');
    check('保存は localStorage の結果で判定', ok === true && map['invoices'] === '[{"id":2}]');

    map.__full = true;
    const ng = api.w('invoices', '[{"id":3}]');
    check('満杯なら従来どおり失敗を返す（勝手に成功にしない）', ng === false);
  }

  console.log('\n=== テスト7: IndexedDB への書き込み失敗を握り潰さない ===');
  {
    const map = {}; const idb = makeIDB();
    const api = build(SRC, map, idb);
    await api.boot(); await sleep(30);
    idb._opt.failWrite = true;                    /* 以降の書き込みが失敗する */
    map.__full = true;                            /* localStorage にも入らない */
    api.w('spl_invoices_F01', '[{"id":9}]');
    await sleep(500);
    const noted = api._win.__noted || [];
    check('端末のどこにも無い項目は「保存できていない」に載る',
      noted.indexOf('spl_invoices_F01') >= 0, noted.join(',') || 'なし');
    check('IndexedDB にも入っていない', !idb._data.has('spl_invoices_F01'));
  }

  console.log('\n=== テスト8: 読み元が1本になっている（ソース確認）===');
  {
    check('ls() が _lsStoreGet を経由', grab(SRC, 'ls').indexOf('_lsStoreGet(key)') >= 0);
    check('_lsRaw() が _lsStoreGet を経由', grab(SRC, '_lsRaw').indexOf('_lsStoreGet(key)') >= 0);
    check('_lsRawStr() が _lsStoreGet を経由', grab(SRC, '_lsRawStr').indexOf('_lsStoreGet(key)') >= 0);
    check('_splitRead() が lsKeys を経由', grab(SRC, '_splitRead').indexOf('lsKeys(pre)') >= 0);
    check('_splitPartitionsRaw() が lsKeys を経由', grab(SRC, '_splitPartitionsRaw').indexOf('lsKeys(pre)') >= 0);
  }

  console.log('\n' + (fail === 0 ? '===== 全テスト PASS =====' : `===== ${fail} 件 FAIL =====`));
  process.exit(fail ? 1 : 0);
})();
