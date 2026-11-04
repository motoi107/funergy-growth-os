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
    '_idbStale', '_idbRequeue', '_idbQueue', '_idbBackfill', '_idbBoot', 'lsIsDeviceLocal', '_lsStoreGet', '_lsRawStr', '_lsRawDel', '_lsWriteVerified'].map(fn))
  .concat([slimBlock,
    'function _lskBump(){} function _lsNoteSaveFailure(k){ (__fails||(__fails=[])).push(k); } var __fails=[];',
    'function lsKeys(p){ p=p||""; var s=new Set(); for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k&&k.indexOf(p)===0) s.add(k);} if(_idbState==="ready"&&_IDB_MEM) _IDB_MEM.forEach(function(v,k){ if(String(k).indexOf(p)===0) s.add(k); }); return Array.from(s); }',
    'var __outbox=[], __busy={}, __logs=[], __mergeDefs={};',
    'function _opMergeDef(k){ return __mergeDefs[k] || null; }',
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
  assert.ok(out && out.removed >= 2, JSON.stringify(out));
  assert.equal(dev.ls.has('daily_actuals_F01'), false);
  assert.equal(dev.ls.has('spl_budgets_v2_F01'), false);
  assert.equal(dev.ls.get('tip_labor_F01'), rows.tip_labor_F01, '(k) 送信待ちのキーの写しは届くまで残す。中身が違う（古い）写しは IndexedDB の値に書き直す（2 回目の独立レビュー P2-2）');
  assert.equal(dev.ls.get('_lsj:tip_labor_F01'), 'c' + c._lsFp(rows.tip_labor_F01));
  assert.equal(out.differ, 1);
  assert.equal(dev.ls.get('m_employees'), rows.m_employees, '送信待ちで同じ中身の控えは届くまで残す');
  assert.equal(dev.ls.get('funergy_lang'), 'ja'); assert.equal(dev.ls.get('_pend_edit_at'), '{"x":1}');
  assert.equal(dev.ls.get('op_outbox'), '[{"key":"m_employees"}]'); assert.equal(dev.ls.get('emp_dirty_q'), '[{"id":"E1"}]');
  assert.equal(c._lsStoreGet('daily_actuals_F01'), rows.daily_actuals_F01, '読むのは IndexedDB');
  assert.equal(c._lsStoreGet('tip_labor_F01'), rows.tip_labor_F01, '読むのは今までどおり IndexedDB');
  assert.ok(c.__logs.some(([k]) => k === 'store'), '「診断と記録」に空けたことを残す');
  /* 送れたら控えを外す（違う中身の写しは次の片づけで） */
  c.__outbox = [];
  assert.equal(c._lsSlimTry('m_employees'), true);
  assert.equal(dev.ls.has('m_employees'), false);
  await c._lsSlimSweep();
  assert.equal(dev.ls.has('tip_labor_F01'), false);
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
  const dev = device(); await seedDisk(dev.factory, { m_cfg: big(30, 'real') });
  const c = tab(dev);
  assert.equal(c._idbState, 'init');
  assert.equal(c._lsWriteVerified('m_cfg', '[]'), true, '（localStorage を空けた端末では、読む前は空に見える）');
  assert.equal(c._lsWriteVerified('spl_new', big(5, 'n')), true);
  assert.equal(c._lsRawDel('m_cfg'), true);   // 読む前の削除は IndexedDB に届けない（前の版と同じ）
  c._lsWriteVerified('m_cfg', '[]');
  await ready(c);
  assert.equal(c._lsStoreGet('m_cfg'), big(30, 'real'));
  assert.equal(c._lsStoreGet('spl_new'), big(5, 'n'));
  assert.equal(c._idbStat.journal.initKept, 1);
  await c._idbFlushP(); await wait(5);
  const d = await disk(dev.factory);
  assert.equal(d.get('m_cfg'), big(30, 'real')); assert.equal(d.get('spl_new'), big(5, 'n'));
  assert.equal(dev.ls.has('m_cfg'), false); assert.equal(dev.ls.has('spl_new'), false);
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
  const boot = source.slice(source.indexOf('var _idbBootP = new Promise'), source.indexOf('checkDriveOAuthReturn(); }catch'));
  assert.ok(boot.length > 100 && boot.length < 5000, String(boot.length));
  assert.match(boot, /\(async function\(\)\{ try \{ await Promise\.resolve\(_idbBootP\); \} catch\(e\) \{ \} try \{ refreshStores\(\); \} catch\(e\) \{ \} try \{ _bootMigrations\(\); \}/);
  const mig = fn('_bootMigrations');
  for (const m of ['migrateWaikikiSplit', 'migrateActivateStores', 'migrateBudgetStatusYm', 'repairBudgetDupes', 'migrateStoreManagers', 'migrateMergeFCrew', '_v2VendorNormOnce'])
    assert.ok(mig.includes(m + '('), m);
  // 移し替えを上の段で直接呼ばない（読む前に localStorage を見ると、空けた端末では空に見える）
  const top = source.split('\n').filter(l => /^try \{ (migrate[A-Z]\w*|_v2VendorNormOnce|repairBudgetDupes)\(/.test(l));
  assert.deepEqual(top.map(l => l.match(/^try \{ (\w+)/)[1]), ['migrateEnableMasterAutosync']);
});

test('起動の読み込みが返らない端末は 8 秒でつなぎ直して 12 秒まで待ち、それでもだめなら使えないことにする（起動を止めない）', () => {
  const b = fn('_idbBoot');
  assert.match(b, /Promise\.race\(\[_idbLoadAll\(\), new Promise\(function \(r\) \{ setTimeout\(function \(\) \{ r\(null\); \}, ms\); \}\)\]\)/);
  assert.match(b, /var m = await _race\(8000\);/); assert.match(b, /m = _idbDB \? await _race\(12000\) : null;/);
  assert.match(b, /端末のデータを読み込んでいます/);
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

// ---- 独立レビュー（18247bd）の直し ----
test('P1-1 起動の途中に読む店舗の表は localStorage にも残す・2 回目の起動でも LaLa（F06）・F07 の棚卸の履歴を月ごとに分ける', async () => {
  assert.equal(tab(device({ idb: false }))._lsSlimKind('m_stores'), 'keep');
  const reg = fn('_registerInvHistSplit');
  assert.match(reg, /_lsRaw\('m_stores', null\)/);
  assert.match(source, /\n_registerInvHistSplit\(\);/);
  assert.match(fn('refreshStores'), /_registerInvHistSplit\(\)/);
  assert.match(source, /await Promise\.resolve\(_idbBootP\); \} catch\(e\) \{ \} try \{ refreshStores\(\); \} catch\(e\) \{ \} try \{ _bootMigrations\(\); \}/);
  // 2 回起動しても店舗の表が localStorage に残る（起動の途中の読み取りが空にならない）
  const st = JSON.stringify([{ id: 'F01' }, { id: 'F06' }, { id: 'F07' }]);
  const dev = device({ ls: { m_stores: st } }); await seedDisk(dev.factory, { m_stores: st });
  const a = tab(dev); await ready(a); await a._lsSlimSweep(); a._lsWriteVerified('m_stores', st); await a._idbFlushP(); await wait(5);
  const b = tab(dev); assert.equal(b._lsStoreGet('m_stores'), st, '起動の途中（IndexedDB を読む前）でも読める'); await ready(b); await b._lsSlimSweep();
  assert.equal(dev.ls.get('m_stores'), st);
});

test('P2-2 アプリの保存の層を通らないキー（Office のモジュール・Supabase）は IndexedDB に写さず、localStorage から消さない', async () => {
  const k1 = 'funergy_web_office_cas_legacy_attempts_v1', k2 = 'sb-tgbhgxzehzeouopklhje-auth-token';
  const dev = device({ ls: { [k1]: '[1]', [k2]: '{"t":1}' } }); await seedDisk(dev.factory, { [k1]: '[0]' });   // 前の版の写しが IndexedDB に入っている端末も
  const a = tab(dev); await ready(a); await a._lsSlimSweep();
  dev.ls.set(k1, '[1,2]');   // モジュールがあとで足した
  const b = tab(dev); await ready(b); await b._lsSlimSweep();
  assert.equal(dev.ls.get(k1), '[1,2]'); assert.equal(dev.ls.get(k2), '{"t":1}');
  assert.equal(b._IDB_MEM.has(k2), false, '写さない');
});

test('P2-1 IndexedDB を読めなかった起動の送信待ちの保存は、次に読めた起動で取り戻す（古い値で消さない・古い値を送らない）。削除は届けない', async () => {
  const dev = device(); await seedDisk(dev.factory, { spl_k: big(5, 'stale'), spl_gone: big(5, 'g') });
  const a = tab(dev, x => { x._idbLoadAll = () => Promise.resolve(null); });   // 読み込みが返らない（つなぎ直しても）
  assert.equal(await ready(a), 'unavailable');
  assert.equal(a._idbStat.loadRetry, true, 'つなぎ直してもう一度読んだ');
  a.__outbox = [{ key: 'spl_k' }];
  assert.equal(a._lsWriteVerified('spl_k', big(5, 'EDIT')), true);
  assert.equal(dev.ls.get('_lsj:spl_k').charAt(0), 'u');
  assert.equal(a._lsRawDel('spl_gone'), true);
  assert.equal(dev.ls.has('_lsj:spl_gone'), false, '読めなかった起動の削除は印を残さない（空の土台からの削除で IndexedDB の値を消さない）');
  const b = tab(dev, x => { x.__outbox = [{ key: 'spl_k' }]; }); await ready(b);
  assert.equal(b._lsStoreGet('spl_k'), big(5, 'EDIT'), '送信待ちの編集が IndexedDB の古い値に負けない');
  assert.equal(b._lsStoreGet('spl_gone'), big(5, 'g'));
  assert.equal(b._idbStat.journal.unavail, 1);
  await b._idbFlushP(); await wait(5); await b._lsSlimSweep();
  assert.equal((await disk(dev.factory)).get('spl_k'), big(5, 'EDIT'));
  assert.equal(dev.ls.get('spl_k'), big(5, 'EDIT'), '送信待ちのあいだは控えも残す');
  b.__outbox = []; b._lsSlimRetry();
  assert.equal(dev.ls.has('spl_k'), false);
});

test('P2-1（2 回目）読めなかった起動の送信待ちでない書き込み・この端末だけのデータは IndexedDB が勝つ（空の土台から作った値で履歴を消さない）', async () => {
  const hist = JSON.stringify({ '2026-08': { s: 1 }, '2026-09': { s: 2 } });
  const dev = device(); await seedDisk(dev.factory, { pl_actual: hist, spl_np: big(5, 'idb') });
  const a = tab(dev, x => { x._idbLoadAll = () => Promise.resolve(null); }); await ready(a);
  const cur = JSON.parse(a._lsStoreGet('pl_actual') || '{}'); cur['2026-10'] = { s: 3 };   // plImportSave と同じ読み書き（土台が空）
  a._lsWriteVerified('pl_actual', JSON.stringify(cur));
  a._lsWriteVerified('spl_np', big(5, 'np'));
  const b = tab(dev); await ready(b);
  assert.equal(b._lsStoreGet('pl_actual'), hist, '8・9 月が残る');
  assert.equal(b._lsStoreGet('spl_np'), big(5, 'idb'));
  assert.equal(dev.ls.has('pl_actual'), false); assert.equal(dev.ls.has('_lsj:pl_actual'), false);
});

test('P2-1（2 回目）合流の決まりのある送信待ちのキーは IndexedDB の値と合わせる', async () => {
  const dev = device(); await seedDisk(dev.factory, { spl_m: JSON.stringify({ a: 1 }) });
  const merge = { merge: (remote, local) => Object.assign({}, remote, local) };
  const a = tab(dev, x => { x._idbLoadAll = () => Promise.resolve(null); x.__mergeDefs = { spl_m: merge }; }); await ready(a);
  a.__outbox = [{ key: 'spl_m' }];
  a._lsWriteVerified('spl_m', JSON.stringify({ b: 2 }));
  const b = tab(dev, x => { x.__outbox = [{ key: 'spl_m' }]; x.__mergeDefs = { spl_m: merge }; }); await ready(b);
  assert.deepEqual(JSON.parse(b._lsStoreGet('spl_m')), { a: 1, b: 2 });
  await b._idbFlushP(); await wait(5);
  assert.deepEqual(JSON.parse((await disk(dev.factory)).get('spl_m')), { a: 1, b: 2 });
});

test('P2-2（2 回目）前の版の満杯で古いままの送信待ちの写しは IndexedDB の値に書き直す（読めなかった起動の土台にする）', async () => {
  const dev = device({ ls: { spl_p: JSON.stringify(['old']) } }); await seedDisk(dev.factory, { spl_p: JSON.stringify(['old', 'NEW-unsent']) });
  const a = tab(dev, x => { x.__outbox = [{ key: 'spl_p' }]; }); await ready(a); await a._lsSlimSweep();
  assert.equal(dev.ls.get('spl_p'), JSON.stringify(['old', 'NEW-unsent']));
  const b = tab(dev, x => { x._idbLoadAll = () => Promise.resolve(null); x.__outbox = [{ key: 'spl_p' }]; }); await ready(b);
  const cur = JSON.parse(b._lsStoreGet('spl_p')); cur.push('edit'); b._lsWriteVerified('spl_p', JSON.stringify(cur));
  const c = tab(dev, x => { x.__outbox = [{ key: 'spl_p' }]; }); await ready(c);
  assert.deepEqual(JSON.parse(c._lsStoreGet('spl_p')), ['old', 'NEW-unsent', 'edit']);
});

test('P3-3（2 回目）送信待ちで残した写しは「入り終えた」印（c）：あとで IndexedDB が新しくなっても古い写しで戻さない', async () => {
  const dev = device(); const a = tab(dev, x => { x.__outbox = [{ key: 'spl_c' }]; }); await ready(a); await wait(20);
  a._lsWriteVerified('spl_c', '"v1"'); await a._idbFlushP(); await wait(5);
  assert.equal(dev.ls.get('_lsj:spl_c'), 'c' + a._lsFp('"v1"'));
  crash(a);
  await seedDisk(dev.factory, { spl_c: '"v2-newer"' });   // 前の版のタブが IndexedDB だけに新しい値を書いた
  const b = tab(dev, x => { x.__outbox = [{ key: 'spl_c' }]; }); await ready(b);
  assert.equal(b._lsStoreGet('spl_c'), '"v2-newer"');
  assert.equal(dev.ls.get('spl_c'), '"v2-newer"', '写しは IndexedDB の値に書き直す（送信待ちなので残す）');
});

test('P2-3（2 回目）開くときの時間切れは、あとで状態を「使えない」に変えない', { timeout: 15000 }, async () => {
  const dev = device(); const c = tab(dev); await ready(c);
  c._idbDB = null;   // つなぎ直しの途中など
  await wait(4300);
  assert.equal(c._idbState, 'ready');
  const o = fn('_idbOpen');
  assert.doesNotMatch(o.slice(o.indexOf('setTimeout')), /_idbState/);
});

test('P3-5（2 回目）読めなかった起動で印を書けない（満杯）ときは値だけ書く', async () => {
  const v = big(900, 'w');
  const dev = device({ cap: v.length + 'spl_w'.length + 5 }); await seedDisk(dev.factory, { x: '1' });
  const c = tab(dev, x => { x._idbLoadAll = () => Promise.resolve(null); }); await ready(c);
  assert.equal(c._lsWriteVerified('spl_w', v), true);
  assert.equal(dev.ls.get('spl_w'), v);
});

test('P3-1・P3-2（2 回目）読めなかった起動：送信待ちの値が見えなくても捨てない・一度きりの移し替えをしない', () => {
  assert.match(fn('flushOutbox'), /_idbState!=='ready' && typeof _idbAvailable==='function' && _idbAvailable\(\)\) continue;/);
  assert.match(fn('_bootMigrations'), /_lsDegraded\(\)\) return;/);
  const ia = fn('initApp');
  assert.match(ia, /var _dg=\(typeof _lsDegraded==='function' && _lsDegraded\(\)\);/);
  for (const m of ['migrateInvHistSplit', 'migrateMenuStore', 'uploadAllLocalShifts', 'migrateUploadLocalOps', 'migrateBudgetsSplit', 'trimNotificationsOnce']) assert.match(ia, new RegExp('if\\(!_dg\\)[^\\n]{0,40}' + m), m);
  assert.match(source, /_idbState==='init' \|\| \(typeof _lsDegraded==='function' && _lsDegraded\(\)\)\)\) return false;/);
});

test('P2-1 IndexedDB を読めなかった起動：このタブの読む前の書き込みは u に（送信待ちでなければ次も IndexedDB が勝つ）・前のタブの i はそのまま・IndexedDB の無い端末は印を消す', async () => {
  const dev = device({ ls: { spl_prev: big(5, 'p') } }); await seedDisk(dev.factory, { spl_i: big(5, 'old'), spl_prev: big(5, 'idbp') });
  dev.ls.set('_lsj:spl_prev', 'i' + tab(device({ idb: false }))._lsFp(big(5, 'p')));   // 前に閉じたタブの読む前の書き込み
  const a = tab(dev, x => { x._idbLoadAll = () => Promise.resolve(null); });
  a._lsWriteVerified('spl_i', big(5, 'init'));   // 読む前
  await ready(a);
  assert.equal(dev.ls.get('_lsj:spl_i').charAt(0), 'u');
  assert.equal(dev.ls.get('_lsj:spl_prev').charAt(0), 'i');
  const b = tab(dev); await ready(b);
  assert.equal(b._lsStoreGet('spl_i'), big(5, 'old'));
  assert.equal(b._lsStoreGet('spl_prev'), big(5, 'idbp'));
  const d2 = device({ idb: false }); const c = tab(d2);
  c._lsWriteVerified('spl_x', '1'); await ready(c);
  assert.equal([...d2.ls.keys()].some(k => k.startsWith('_lsj:')), false);
  assert.equal(d2.ls.get('spl_x'), '1');
});

test('P2-1 読み込みが 1 回返らなくても、つなぎ直して読めれば使う', async () => {
  const dev = device(); await seedDisk(dev.factory, { spl_r: '1' });
  let n = 0; const c = tab(dev, x => { const orig = x._idbLoadAll; x._idbLoadAll = () => (n++ === 0 ? Promise.resolve(null) : orig()); });
  assert.equal(await ready(c), 'ready');
  assert.equal(c._idbStat.loadRetry, true); assert.equal(c._lsStoreGet('spl_r'), '1');
});

test('P3 ほかのタブがあとで書いた写しと印は、このタブの片づけで消さない', async () => {
  const dev = device(); const a = tab(dev); await ready(a); await wait(20);
  a.__outbox = [{ key: 'spl_t' }];
  a._lsWriteVerified('spl_t', big(5, '1')); await a._idbFlushP(); await wait(5);
  assert.ok(a._lsJDone.spl_t, 'A は送信待ちのあいだ控えを残している');
  const b = tab(dev); await ready(b); await wait(20);
  b.__outbox = [{ key: 'spl_t' }];
  b._idbTimer = null; b._lsWriteVerified('spl_t', big(5, '2')); clearTimeout(b._idbTimer);   // B が書いた（まだ書き出していない）
  a.__outbox = []; assert.equal(a._lsSlimTry('spl_t'), false);
  assert.equal(dev.ls.get('spl_t'), big(5, '2')); assert.ok(dev.ls.get('_lsj:spl_t'));
  crash(b);
  const c = tab(dev); await ready(c);
  assert.equal(c._lsStoreGet('spl_t'), big(5, '2'));
});

test('P3 とても大きい値は写しを書かずにすぐ書き出す・同じ時の書き出しはまとめて 1 回', async () => {
  const dev = device(); const c = tab(dev); await ready(c); await wait(20);
  let tx = 0; const db = c._idbDB, orig = db.transaction.bind(db); db.transaction = (...a) => { if (a[1] === 'readwrite') tx++; return orig(...a); };
  const huge = big(1600000, 'h');
  assert.equal(c._lsWriteVerified('spl_huge', huge), true);
  assert.equal(dev.ls.has('spl_huge'), false); assert.equal(dev.ls.has('_lsj:spl_huge'), false);
  for (let i = 0; i < 30; i++) c._lsWriteVerified('spl_h' + i, big(1600000, String(i % 10)));
  await wait(60);
  assert.equal(tx, 1, '1 回の書き出し');
  assert.equal((await disk(dev.factory)).get('spl_huge'), huge);
});

test('P3 書き出しが 2 回とも失敗しても、積み直すのは新しい値', async () => {
  const dev = device(); const c = tab(dev); await ready(c); await wait(20);
  const db = c._idbDB, orig = db.transaction.bind(db);
  db.transaction = (...a) => { const tx = orig(...a); if (a[1] === 'readwrite') Promise.resolve().then(() => { try { tx.abort(); } catch (e) { } }); return tx; };
  c._lsWriteVerified('spl_q', '"old"'); c._idbFlush();
  c._lsWriteVerified('spl_q', '"new"'); c._idbFlush();
  await wait(20);
  assert.equal(c._idbQ.get('spl_q'), '"new"');
  clearTimeout(c._idbTimer);
});

test('P3 Drive の連携の戻り・前の運用キーの送り直しは IndexedDB を読み終えてから・IndexedDB のキーも見る', () => {
  assert.match(source, /setTimeout\(function\(\)\{ Promise\.resolve\(_idbBootP\)\.then\(function\(\)\{ try\{ checkDriveOAuthReturn\(\);/);
  assert.match(fn('migrateUploadLocalOps'), /lsKeys\(\)\.forEach/);
  assert.doesNotMatch(fn('migrateUploadLocalOps'), /localStorage\.key\(/);
});

test('P3-6（2 回目）つなぎが切れていても、ふだんの書き出しでつなぎ直して書く（写しが積もらない）', async () => {
  const dev = device(); const c = tab(dev); await ready(c); await wait(20);
  try { c._idbDB.close(); } catch (e) { } c._idbDB = null;   // iOS で切れた
  c._lsWriteVerified('spl_re', '"x"');
  await wait(400);
  assert.equal((await disk(dev.factory)).get('spl_re'), '"x"');
  assert.equal(dev.ls.has('spl_re'), false);
});
