import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function extract(name) {
  let start = source.indexOf('function ' + name + '('); assert.ok(start >= 0, name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

test('production installer waits for the later assigned IDB boot promise and accepts only a fully hydrated Map', async () => {
  const gate = deferred(), context = vm.createContext({ document: { addEventListener() {} },
    FunergyFinancialSave: { install(_win, options) { context.options = options; } },
    FunergyFinancialTransport: { create() { return {}; } }, SUPABASE_URL: 'fixture', financialRecoveryStore: () => ({ marker: 'idb-store' }) });
  context.window = context;
  vm.runInContext('var _idbBootP, _idbState="init", _IDB_MEM=null;\n' + source.slice(
    source.indexOf('/* FUNERGY_FINANCIAL_WEB_INTEGRATION_V1'), source.indexOf('const TOAST_SYNC_FN')), context);
  assert.equal(context.options.recoveryStore.marker, 'idb-store', 'the guard keeps its log in the IndexedDB store');
  let done = false; const readiness = context.options.awaitLocalReady().then(value => { done = true; return value; });
  context._idbBootP = gate.promise; await settle(); assert.equal(done, false);
  vm.runInContext('_idbState="ready"; _IDB_MEM=new Map();', context);
  gate.resolve(); assert.equal(await readiness, true);
  context._idbState = 'unavailable'; assert.equal(await context.options.awaitLocalReady(), false);
  context._idbState = 'init'; assert.equal(await context.options.awaitLocalReady(), false);
  vm.runInContext('_idbState="ready"; _IDB_MEM=null;', context); assert.equal(await context.options.awaitLocalReady(), false);
});

test('original broad pull waits for local archival before starting, and financial single-key pull refuses when hydration fails', async () => {
  const gate = deferred(); let calls = 0;
  const context = vm.createContext({ SUPA_MASTER_MAP: {}, FUNERGY_FINANCIAL_SAVE: { preserveLocal: () => gate.promise },
    FunergyFinancialSave: { financialKey: key => key.startsWith('daily_actuals_') },
    supaFetchAll: () => { calls++; throw new Error('network sentinel'); }, fetch: () => { calls++; throw new Error('network sentinel'); } });
  context.window = context; vm.runInContext(extract('supaPullAllMasters') + '\n' + extract('pullOpKey'), context);
  const pulling = context.supaPullAllMasters(); await settle(); assert.equal(calls, 0);
  gate.resolve(); await assert.rejects(pulling, /network sentinel/); assert.equal(calls, 1);
  context.FUNERGY_FINANCIAL_SAVE.preserveLocal = async () => { throw new Error('financial_local_unverified'); };
  assert.equal(await context.pullOpKey('daily_actuals_F01'), false); assert.equal(calls, 1);
});

test('manual local-budget recovery waits for hydration and uses the real split definition with existing legacy rows', async () => {
  for (const name of ['pullBudgetsNow', 'pushBudgetsNow']) {
    const gate = deferred(), data = new Map(), restored = []; let localReads = 0;
    const context = vm.createContext({
      FUNERGY_FINANCIAL_SAVE: { preserveLocal: () => gate.promise, restoreBudgets: async values => { restored.push(values); return { saved: values.map(x => x.storeId) }; } },
      _lsRaw: (key, fallback) => { localReads++; return data.get(key) || fallback; },
      lsKeys: prefix => [...data.keys()].filter(key => key.startsWith(prefix)), _splitPrefix: key => 'spl_' + key + '_',
      showToast: message => { throw new Error(message); }
    });
    context.window = context;
    vm.runInContext("var _SPLIT_KEYS={budgets_v2:{type:'arr',by:function(row){return row.storeId;}}};\n" + extract('_splitRead') + '\n' + extract(name), context);
    const recovering = context[name](); await settle(); assert.equal(localReads, 0, name);
    data.set('budgets_v2', [{ storeId: 'F01', actual: 876 }]);
    data.set('spl_budgets_v2_F02', [{ storeId: 'F02', actual: 222 }]); gate.resolve();
    const result = await recovering;
    assert.deepEqual(Array.from(result.saved), ['F01', 'F02'], name);
    assert.equal(restored[0][0].actual, 876); assert.equal(restored[0][1].actual, 222);
  }
});
