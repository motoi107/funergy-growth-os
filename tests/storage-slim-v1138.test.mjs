// v1138：端末の保存領域（localStorage）をいっぱいにしない。合成データだけ（本番に接続しない）。
// アプリの本物の IndexedDB の層（_idbBoot・_idbQueue・_idbWriteBatch・_idbFlushP）と v1138 の写しの記録（_lsj:）を
// fake-indexeddb の上で動かす。1 つの factory ＝ 1 台の端末、1 つの vm ＝ 1 つのタブ（閉じる＝その vm を捨てる）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(process.env.UX_INDEX_PATH || new URL('../index.html', import.meta.url), 'utf8');   // わざと壊す試験は UX_INDEX_PATH で別の写しを読む
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const { IDBFactory, IDBKeyRange } = await import('./runtime/node_modules/fake-indexeddb/build/esm/index.js');

function fn(name) {
  let start = source.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = source.indexOf('\nasync function ' + name + '(');
  assert.ok(start >= 0, 'function exists: ' + name);
  start += 1;
  const end = source.indexOf('\n}', start);
  return source.slice(start, end + 2);
}
const varLine = re => { const m = source.match(re); assert.ok(m, String(re)); return m[0].replace(/\r$/, ''); };
const slimBlock = (() => {
  const a = source.indexOf('var LS_SLIM_KEEP'), b = source.indexOf('\nfunction _lsWriteVerified(');
  assert.ok(a > 0 && b > a, 'v1138 block exists');
  return source.slice(a, b);
})();
const CODE = [/^var IDB_NAME = .*$/m, /^var _idbDB = .*$/m, /^var _idbState = .*$/m, /^var _IDB_MEM = .*$/m, /^var _idbQ = .*$/m, /^var _idbTimer = .*$/m,
  /^var _idbStat = .*$/m, /^var _idbInflight = .*$/m, /^var _IDB_WATCH = .*$/m, /^var _idbGen = .*$/m, /^var _idbReopening = .*$/m, /^var LS_DEVICE_LOCAL = .*$/m].map(varLine)
  .concat(['_idbAvailable', '_idbOpen', '_idbLoadAll', '_idbWatched', '_idbTrack', '_idbWriteBatch', '_idbFlush', '_idbFlushP', '_idbReopen',
    '_idbRequeue', '_idbQueue', '_idbBackfill', '_idbBoot', 'lsIsDeviceLocal', '_lsStoreGet', '_lsRawStr', '_lsRawDel', '_lsWriteVerified'].map(fn))
  .concat([slimBlock,
    'function _lskBump(){} function _lsNoteSaveFailure(k){ (__fails||(__fails=[])).push(k); } var __fails=[];',
    'function lsKeys(p){ p=p||""; var s=new Set(); for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k&&k.indexOf(p)===0) s.add(k);} if(_idbState==="ready"&&_IDB_MEM) _IDB_MEM.forEach(function(v,k){ if(String(k).indexOf(p)===0) s.add(k); }); return Array.from(s); }',
    'var __outbox=[], __busy={}, __logs=[];',
    'function _outboxGet(){ return __outbox.slice(); } function _outboxSet(a){ __outbox=a.slice(); return true; } function _pushBusy(k){ return !!__busy[k]; } function _pendEditAtDrop(){}',
    fn('_outboxRemove'),
    'var FUNERGY_STATUS={ log:function(kind, msg){ __logs.push([kind, msg]); } };',
    "var _idbBootP = new Promise(function(res){ setTimeout(function(){ try{ Promise.resolve(_idbBoot()).then(res, res); }catch(e){ res(); } }, 0); });",
  ]).join('\n');

/* localStorage の代わり（cap＝入る文字数の上限。超えたら QuotaExceededError） */
function lsObject(map, cap = Infinity) {
  const size = () => { let n = 0; for (const [k, v] of map) n += k.length + v.length; return n; };
  return {
    getItem: k => map.has(k) ? map.get(k) : null,
    setItem: (k, v) => {
      v = String(v); const before = map.has(k) ? k.length + map.get(k).length : 0;
      if (size() - before + k.length + v.length > cap) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      map.set(k, v);
    },
    removeItem: k => { map.delete(k); },
    key: i => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}
function device({ ls = {}, cap = Infinity, idb = true } = {}) {
  return { ls: new Map(Object.entries(ls)), cap, factory: idb ? new IDBFactory() : null };
}
function tab(dev, setup) {
  const c = vm.createContext({ console, setTimeout, clearTimeout, setInterval: () => 0, Promise, Map, Set, JSON, Math, Date, String, Number, Object, Array,
    navigator: {}, IDBKeyRange, localStorage: lsObject(dev.ls, dev.cap) });
  if (dev.factory) c.indexedDB = dev.factory;
  c.window = c;
  vm.runInContext(CODE, c);
  if (setup) setup(c);
  return c;
}
const ready = async c => { await c._idbBootP; return c._idbState; };
const wait = ms => new Promise(r => setTimeout(r, ms));
function disk(factory) {
  return new Promise(res => {
    const rq = factory.open('funergy_os_kv', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => {
      const db = rq.result, out = new Map(), tx = db.transaction('kv', 'readonly'), cur = tx.objectStore('kv').openCursor();
      cur.onsuccess = () => { const x = cur.result; if (x) { out.set(x.key, x.value); x.continue(); } };
      tx.oncomplete = () => { db.close(); res(out); };
    };
  });
}
async function seedDisk(factory, rows) {
  await new Promise(res => {
    const rq = factory.open('funergy_os_kv', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => { const db = rq.result, tx = db.transaction('kv', 'readwrite'); for (const [k, v] of Object.entries(rows)) tx.objectStore('kv').put(v, k); tx.oncomplete = () => { db.close(); res(); }; };
  });
}
/* タブを閉じる（書き出しを待たない）：そのタブのつなぎを外して、残っている書き出しを捨てる */
function crash(c) { try { clearTimeout(c._idbTimer); } catch (e) { } c._idbTimer = null; c._idbQ = new Map(); try { c._idbDB.close(); } catch (e) { } c._idbDB = null; }
const big = (n, ch = 'x') => JSON.stringify({ v: ch.repeat(n) });

test('(a)(k) 前の版の端末：IndexedDB にある控えは起動のあとに localStorage から消える（端末だけの印・送信待ちの記録は残す）', async () => {
  const rows = { daily_actuals_F01: big(2000, 'a'), spl_budgets_v2_F01: big(2000, 'b'), m_employees: big(500, 'e'), tip_labor_F01: big(300, 't') };
  const dev = device({ ls: { ...rows, funergy_lang: 'ja', _pend_edit_at: '{"x":1}', op_outbox: '[{"key":"m_employees"}]', emp_dirty_q: '[{"id":"E1"}]',
    tip_labor_F01: big(300, 'OLD') } });   // tip_labor は localStorage の古い控え（中身が違う）
  await seedDisk(dev.factory, rows);
  const c = tab(dev, x => { x.__outbox = [{ key: 'm_employees' }, { key: 'tip_labor_F01' }]; });
  assert.equal(await ready(c), 'ready');
  const out = await c._lsSlimSweep();
  assert.ok(out && out.removed >= 3, JSON.stringify(out));
  assert.equal(dev.ls.has('daily_actuals_F01'), false);
  assert.equal(dev.ls.has('spl_budgets_v2_F01'), false);
  assert.equal(dev.ls.has('tip_labor_F01'), false, '(k) 送信待ちでも中身が IndexedDB と違う控えは消す（アプリは IndexedDB の値を読み、送る）');
  assert.equal(dev.ls.get('m_employees'), rows.m_employees, '送信待ちで同じ中身の控えは届くまで残す');
  assert.equal(dev.ls.get('funergy_lang'), 'ja'); assert.equal(dev.ls.get('_pend_edit_at'), '{"x":1}');
  assert.equal(dev.ls.get('op_outbox'), '[{"key":"m_employees"}]'); assert.equal(dev.ls.get('emp_dirty_q'), '[{"id":"E1"}]');
  assert.equal(c._lsStoreGet('daily_actuals_F01'), rows.daily_actuals_F01, '読むのは IndexedDB');
  assert.equal(c._lsStoreGet('tip_labor_F01'), rows.tip_labor_F01);
  assert.ok(c.__logs.some(([k]) => k === 'store'), '「診断と記録」に空けたことを残す');
  /* 送れたら控えを外す */
  c.__outbox = [];
  assert.equal(c._lsSlimTry('m_employees'), true);
  assert.equal(dev.ls.has('m_employees'), false);
  const d = await disk(dev.factory);
  for (const [k, v] of Object.entries(rows)) assert.equal(d.get(k), v, k + ' は IndexedDB に残る');
});

test('(b) IndexedDB に入り終える前に閉じた書き込みは、次に開いたときに取り戻す', async () => {
  const dev = device(); await seedDisk(dev.factory, { daily_actuals_F01: big(10, 'old') });
  const a = tab(dev); await ready(a);
  const v2 = big(10, 'new');
  assert.equal(a._lsWriteVerified('daily_actuals_F01', v2), true);
  assert.equal(dev.ls.get('daily_actuals_F01'), v2, '閉じられても残るように localStorage にもすぐ書く');
  assert.ok(dev.ls.get('_lsj:daily_actuals_F01'), '印');
  crash(a);
  assert.equal((await disk(dev.factory)).get('daily_actuals_F01'), big(10, 'old'), '（まだ入っていない）');
  const b = tab(dev); await ready(b);
  assert.equal(b._lsStoreGet('daily_actuals_F01'), v2);
  assert.equal(b._idbStat.journal.applied, 1);
  assert.equal(await b._idbFlushP(), true); await wait(5);
  assert.equal((await disk(dev.factory)).get('daily_actuals_F01'), v2);
  assert.equal(dev.ls.has('daily_actuals_F01'), false, '入り終えたら控えを消す'); assert.equal(dev.ls.has('_lsj:daily_actuals_F01'), false);
});

test('(b2) ふだんの保存：入り終えたら localStorage に残さない・すぐ読める', async () => {
  const dev = device(); const c = tab(dev); await ready(c);
  for (let i = 0; i < 20; i++) assert.equal(c._lsWriteVerified('spl_x_' + i, big(1000, String(i % 10))), true);
  assert.equal(c._lsStoreGet('spl_x_3'), big(1000, '3'));
  assert.equal(await c._idbFlushP(), true); await wait(5);
  assert.deepEqual([...dev.ls.keys()].filter(k => !k.startsWith('_')), [], 'localStorage は空');
  assert.deepEqual([...dev.ls.keys()], []);
  assert.equal((await disk(dev.factory)).size, 20);
});

test('(c) 送信待ち・送っている途中・送信中のキーは、届くまで控えを残す', async () => {
  const dev = device(); const c = tab(dev); await ready(c);
  c.__outbox = [{ key: 'spl_a' }]; c.__busy = { spl_b: true }; dev.ls.set('_ux_inflight', JSON.stringify({ spl_c: { 'p:E1': 1 } }));
  for (const k of ['spl_a', 'spl_b', 'spl_c', 'spl_d']) c._lsWriteVerified(k, big(50, k.slice(-1)));
  assert.equal(await c._idbFlushP(), true); await wait(5);
  assert.equal(dev.ls.has('spl_a'), true); assert.equal(dev.ls.has('spl_b'), true); assert.equal(dev.ls.has('spl_c'), true);
  assert.equal(dev.ls.has('spl_d'), false);
  c.__outbox = []; c.__busy = {}; dev.ls.delete('_ux_inflight');
  c._lsSlimRetry();
  for (const k of ['spl_a', 'spl_b', 'spl_c']) { assert.equal(dev.ls.has(k), false, k); assert.equal(dev.ls.has('_lsj:' + k), false); }
  /* 分からないとき（送信待ちの記録が読めない）は残す */
  c._outboxGet = () => { throw new Error('x'); };
  c._lsWriteVerified('spl_e', big(5)); await c._idbFlushP(); await wait(5);
  assert.equal(dev.ls.has('spl_e'), true);
});

test('(d) 印と合わない写し（写しを書く前に閉じられた）は取り戻さない', async () => {
  const dev = device({ ls: { spl_k: big(5, 'old'), '_lsj:spl_k': 'NOT-THE-FP' } });
  await seedDisk(dev.factory, { spl_k: big(5, 'idb') });
  const c = tab(dev); await ready(c);
  assert.equal(c._lsStoreGet('spl_k'), big(5, 'idb'));
  assert.equal(c._idbStat.journal.dropped, 1);
  assert.equal(dev.ls.has('_lsj:spl_k'), false);
  await c._lsSlimSweep();
  assert.equal(dev.ls.has('spl_k'), false, '印の無い古い控えは消す');
});

test('(e) 消したあと入り終える前に閉じても、消したことを取り戻す', async () => {
  const dev = device(); await seedDisk(dev.factory, { spl_del: big(5) });
  const a = tab(dev); await ready(a);
  assert.equal(a._lsRawDel('spl_del'), true);
  assert.equal(dev.ls.get('_lsj:spl_del'), 'd');
  crash(a);
  const b = tab(dev); await ready(b);
  assert.equal(b._lsStoreGet('spl_del'), null);
  assert.equal(b._idbStat.journal.del, 1);
  await b._idbFlushP(); await wait(5);
  assert.equal((await disk(dev.factory)).has('spl_del'), false);
  assert.equal(dev.ls.has('_lsj:spl_del'), false, '入り終えたら印も消す');
});

test('(f) IndexedDB を読む前の書き込み：新しい名前は使う・IndexedDB にある名前は IndexedDB を残す（空の値で上書きしない）', async () => {
  const dev = device(); await seedDisk(dev.factory, { m_stores: big(30, 'real') });
  const c = tab(dev);
  assert.equal(c._idbState, 'init');
  assert.equal(c._lsWriteVerified('m_stores', '[]'), true, '（localStorage を空けた端末では、読む前は空に見える）');
  assert.equal(c._lsWriteVerified('spl_new', big(5, 'n')), true);
  assert.equal(c._lsRawDel('m_stores'), true);   // 読む前の削除は IndexedDB に届けない（前の版と同じ）
  c._lsWriteVerified('m_stores', '[]');
  await ready(c);
  assert.equal(c._lsStoreGet('m_stores'), big(30, 'real'));
  assert.equal(c._lsStoreGet('spl_new'), big(5, 'n'));
  assert.equal(c._idbStat.journal.initKept, 1);
  await c._idbFlushP(); await wait(5);
  const d = await disk(dev.factory);
  assert.equal(d.get('m_stores'), big(30, 'real')); assert.equal(d.get('spl_new'), big(5, 'n'));
  assert.equal(dev.ls.has('m_stores'), false); assert.equal(dev.ls.has('spl_new'), false);
});

test('(g) IndexedDB が使えない端末は今までどおり（localStorage だけ・印を書かない）', async () => {
  const dev = device({ idb: false }); const c = tab(dev);
  assert.equal(await ready(c), 'unavailable');
  assert.equal(c._lsWriteVerified('spl_u', big(5)), true);
  assert.equal(dev.ls.get('spl_u'), big(5));
  assert.equal([...dev.ls.keys()].some(k => k.startsWith('_lsj:')), false);
  assert.equal(c._lsStoreGet('spl_u'), big(5));
  assert.equal(c._lsRawDel('spl_u'), true); assert.equal(dev.ls.has('spl_u'), false);
});

test('(j) 送信待ちの記録・従業員と業者の送れていない変更は localStorage が持ち主（消さない）', async () => {
  const dev = device({ ls: { op_outbox: '[{"key":"x"}]' } }); const c = tab(dev); await ready(c);   // 送信待ちの記録は IndexedDB に写さない（読むのは localStorage）
  for (const k of ['emp_dirty_q', 'vendor_touched_v1']) assert.equal(c._lsWriteVerified(k, '[1]'), true);
  await c._idbFlushP(); await wait(5); await c._lsSlimSweep();
  assert.equal(dev.ls.get('emp_dirty_q'), '[1]'); assert.equal(dev.ls.get('vendor_touched_v1'), '[1]');
  assert.equal(dev.ls.has('_lsj:emp_dirty_q'), false);
  assert.equal(c._IDB_MEM.has('op_outbox'), false);
  assert.equal(c._lsSlimKind('op_outbox'), 'keep'); assert.equal(c._lsSlimKind('_ux_inflight'), 'dev'); assert.equal(c._lsSlimKind('funergy_lang'), 'dev');
  assert.equal(c._lsSlimKind('daily_actuals_F01'), 'bulk');
});

test('(l) localStorage に入らない大きな取り込み：保存できた（IndexedDB）・古い控えを残さない・ほかの小さな印は書ける', async () => {
  const dev = device({ cap: 20000, ls: { spl_big: big(3000, 'old') } });
  await seedDisk(dev.factory, { spl_big: big(3000, 'old') });
  const c = tab(dev, x => { x.__outbox = [{ key: 'spl_big' }]; }); await ready(c); await wait(20);   // 起動の片づけ（書き出しを含む）が終わってから。送信待ちなので控えは残っている
  assert.equal(dev.ls.get('spl_big'), big(3000, 'old'));
  const huge = big(50000, 'z');
  assert.equal(c._lsWriteVerified('spl_big', huge), true);
  assert.equal(dev.ls.has('spl_big'), false, 'IndexedDB の新しい値と食い違う古い控えを残さない');
  assert.equal(dev.ls.has('_lsj:spl_big'), false);
  assert.equal(c._lsStoreGet('spl_big'), huge);
  await wait(60);   // 0.3 秒の待ちより前に（localStorage に控えを残せないときは待たずに書き出す）
  assert.equal((await disk(dev.factory)).get('spl_big'), huge);
  dev.ls.set('_pend_edit_at', '{}');
  assert.doesNotThrow(() => c.localStorage.setItem('_pend_edit_at', JSON.stringify({ a: 'x'.repeat(5000) })), '空いた localStorage に小さな印が書ける');
});

test('(n) あとで別の中身を書いたら、前の書き出しで控えを消さない（その書き出しを待つ）', async () => {
  const dev = device(); const c = tab(dev); await ready(c); await wait(20);   // 起動の片づけ（書き出し）と重ならないように
  c._lsWriteVerified('spl_n', big(5, '1'));
  c._idbFlush();                                   // 1 回目の書き出しを始める
  c._lsWriteVerified('spl_n', big(5, '2'));       // まだ入り終えていない
  await wait(1);
  assert.equal(dev.ls.get('spl_n'), big(5, '2'));
  crash(c);                                        // 2 回目は書き出す前に閉じる
  const b = tab(dev); await ready(b);
  assert.equal(b._lsStoreGet('spl_n'), big(5, '2'));
});

test('(n2) 書き出しが失敗したら控えを残す（次に開いたとき取り戻す）', async () => {
  const dev = device(); const c = tab(dev); await ready(c); await wait(10);   // 起動のあとの片づけ（つなぎ直しを含む）が終わってから
  const db = c._idbDB, orig = db.transaction.bind(db);
  db.transaction = (...a) => { const tx = orig(...a); if (a[1] === 'readwrite') Promise.resolve().then(() => { try { tx.abort(); } catch (e) { } }); return tx; };
  c._lsWriteVerified('spl_f', big(5, 'f'));
  c._idbFlush(); await wait(20);
  assert.equal(dev.ls.get('spl_f'), big(5, 'f'));
  assert.ok(dev.ls.get('_lsj:spl_f'));
  crash(c);
  const b = tab(dev); await ready(b);
  assert.equal(b._lsStoreGet('spl_f'), big(5, 'f'));
});

test('(h)(i) 起動のデータの移し替え・必要時の取り込みは IndexedDB を読み終えてから', () => {
  assert.match(fn('_lsRequestDeferredPrefix'), /JSON\.parse\(_lsStoreGet\(r\.key\)\|\|'null'\)/);
  const boot = source.slice(source.indexOf('var _idbBootP = new Promise'), source.indexOf('setTimeout(function(){ try{ checkDriveOAuthReturn'));
  assert.match(boot, /\(async function\(\)\{ try \{ await Promise\.resolve\(_idbBootP\); \} catch\(e\) \{ \} try \{ _bootMigrations\(\); \}/);
  const mig = fn('_bootMigrations');
  for (const m of ['migrateWaikikiSplit', 'migrateActivateStores', 'migrateBudgetStatusYm', 'repairBudgetDupes', 'migrateStoreManagers', 'migrateMergeFCrew', '_v2VendorNormOnce'])
    assert.ok(mig.includes(m + '('), m);
  // 移し替えを上の段で直接呼ばない（読む前に localStorage を見ると、空けた端末では空に見える）
  const top = source.split('\n').filter(l => /^try \{ (migrate[A-Z]\w*|_v2VendorNormOnce|repairBudgetDupes)\(/.test(l));
  assert.deepEqual(top.map(l => l.match(/^try \{ (\w+)/)[1]), ['migrateEnableMasterAutosync']);
});

test('起動の読み込みが返らない端末は 8 秒で使えないことにする（起動を止めない）', () => {
  assert.match(fn('_idbBoot'), /Promise\.race\(\[_idbLoadAll\(\), new Promise\(function \(r\) \{ setTimeout\(function \(\) \{ r\(null\); \}, 8000\); \}\)\]\)/);
});

test('前の版の端末の書き込み（印なし）は、次に開いたときに消える前に IndexedDB に写す', async () => {
  const dev = device({ ls: { spl_only_ls: big(5, 'L') } });   // IndexedDB にまだ無い（前の版で localStorage にだけ入った）
  const c = tab(dev); await ready(c);
  assert.equal(c._lsStoreGet('spl_only_ls'), big(5, 'L'));
  await c._lsSlimSweep();
  assert.equal((await disk(dev.factory)).get('spl_only_ls'), big(5, 'L'));
  assert.equal(dev.ls.has('spl_only_ls'), false, '写し終えてから消す');
});

test('版：アプリと Service Worker が 1138 以上でそろう', () => {
  const a = (source.match(/const APP_VERSION = '(\d+)';/) || [])[1], b = (sw.match(/const SW_BUILD = '(\d+)';/) || [])[1];
  assert.ok(Number(a) >= 1138, String(a)); assert.equal(a, b);
});

test('起動のあと自動で空ける（片づけを呼ばなくても）', async () => {
  const rows = { spl_auto_1: big(100, '1'), spl_auto_2: big(100, '2') };
  const dev = device({ ls: { ...rows } }); await seedDisk(dev.factory, rows);
  const c = tab(dev); await ready(c); await wait(60);
  assert.equal(dev.ls.has('spl_auto_1'), false); assert.equal(dev.ls.has('spl_auto_2'), false);
  assert.ok(c._lsSlimLast && c._lsSlimLast.removed === 2, JSON.stringify(c._lsSlimLast));
});

test('書き出せない（IndexedDB に入り終えたか確かめられない）ときは何も消さない', async () => {
  const dev = device({ ls: { spl_only_ls2: big(5, 'L') } });
  const c = tab(dev, x => { x.setTimeout = (f, ms) => (ms === 0 ? 0 : setTimeout(f, ms)); });   // 起動の片づけを止める
  await ready(c);
  c._idbFlushP = () => Promise.resolve(false);
  assert.equal(await c._lsSlimSweep(), null);
  assert.equal(dev.ls.get('spl_only_ls2'), big(5, 'L'));
});

test('印が localStorage の持ち主のキーに付いていても IndexedDB へ取り込まない（印は捨てる）', async () => {
  const dev = device({ ls: { vendor_touched_v1: '{"a":1}', '_lsj:vendor_touched_v1': '' } });
  dev.ls.set('_lsj:vendor_touched_v1', (await (async () => { const c0 = tab(device({ idb: false })); return c0._lsFp('{"a":1}'); })()));
  await seedDisk(dev.factory, { vendor_touched_v1: '{"b":2}' });
  const c = tab(dev); await ready(c);
  assert.equal(dev.ls.has('_lsj:vendor_touched_v1'), false);
  assert.equal(c._IDB_MEM.get('vendor_touched_v1'), '{"b":2}');
});

test('IndexedDB を読む前の削除は IndexedDB に届けない（前の版と同じ）', async () => {
  const dev = device(); await seedDisk(dev.factory, { spl_keep: big(5, 'k') });
  const c = tab(dev);
  assert.equal(c._lsRawDel('spl_keep'), true);
  assert.equal(dev.ls.has('_lsj:spl_keep'), false);
  await ready(c);
  assert.equal(c._lsStoreGet('spl_keep'), big(5, 'k'));
});

test('IndexedDB を読めない端末は使えないことにして、つなぎも外す（localStorage だけで動く）', async () => {
  const dev = device(); const c = tab(dev, x => { x._idbLoadAll = () => Promise.resolve(null); });
  assert.equal(await ready(c), 'unavailable');
  assert.equal(c._idbDB, null);
  assert.equal(c._lsWriteVerified('spl_z', '1'), true); assert.equal(dev.ls.get('spl_z'), '1');
});

test('送信待ちが届いたら（_outboxRemove）すぐ控えを外す・送れた知らせでも外す', async () => {
  const dev = device(); const c = tab(dev); await ready(c);
  c.__outbox = [{ key: 'spl_o' }];
  c._lsWriteVerified('spl_o', big(5)); await c._idbFlushP(); await wait(5);
  assert.equal(dev.ls.has('spl_o'), true);
  c._outboxRemove('spl_o');
  assert.equal(dev.ls.has('spl_o'), false); assert.equal(dev.ls.has('_lsj:spl_o'), false);
  const ux = source.slice(source.indexOf("var INF = '_ux_inflight'"), source.indexOf("var INF = '_ux_inflight'") + 9000);
  assert.equal((ux.match(/if\(r === true && typeof _lsSlimTry === 'function'\) setTimeout\(function\(\)\{ _lsSlimTry\(key\); \}, 0\);/g) || []).length, 2);
});

test('アプリを通さずに localStorage に書かれた値（IndexedDB に無い）は消さない', async () => {
  const dev = device(); const c = tab(dev); await ready(c); await wait(20);
  dev.ls.set('spl_direct', 'x');
  await c._lsSlimSweep();
  assert.equal(dev.ls.get('spl_direct'), 'x');
});
