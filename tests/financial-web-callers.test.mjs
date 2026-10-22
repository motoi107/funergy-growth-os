import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const updated = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extract(name, text = updated) {
  const begin = text.indexOf('function ' + name + '(');
  assert.ok(begin >= 0, name);
  const start = text.slice(begin - 6, begin) === 'async ' ? begin - 6 : begin;
  const end = text.indexOf('\n}', begin);
  assert.ok(end > begin, name + ' end');
  return text.slice(start, end + 2);
}
const names = ['doRangeImport', 'tipRefreshPeriodFromToast', 'attBackfillMonth', 'saveBowlCatCfg',
  'syncCenterRunStore', 'syncAllData', 'syncCenterRunAll', 'doToastFetchToday',
  'ensureMonthDataLoaded', 'refreshNow', 'reopenApproval', 'repairBudgetDupes'];
function fixture(success = false) {
  const elements = new Map(), toasts = [], effects = [], writes = [], synced = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: id === 'rg-from' || id === 'rg-to' ? '2026-10-01' : '', checked: false, textContent: '', innerHTML: '', disabled: false });
    return elements.get(id);
  };
  const store = { id: 'F01', name: 'Fixture', toastGuid: 'fixture-guid' };
  const result = () => success ? { updated: 1, ok: 1, fail: 0, sumSales: 100 } : { error: 'financial conflict' };
  const context = vm.createContext({
    console, Promise, Date, Math, document: { getElementById: element },
    setTimeout: callback => { effects.push('timer'); callback(); return 0; },
    showToast: (message, kind) => toasts.push({ message, kind }),
    renderPage: page => effects.push('render:' + page), closeModalDirect: () => effects.push('close'),
    getVisibleStores: () => [store], getStoresAll: () => [store], STORES: [store],
    fetchToastRange: async () => result(), syncStoreActualsFromToast: async () => result(),
    doWeatherSyncSilent: async () => result(), syncTipLaborFromDB: async () => ({ updated: 1 }),
    fetchTipLabor: async () => ({ count: 1 }), backfillRecentLabor: async () => {}, loadMenuMixFromDB: async () => {},
    syncToastDay: async () => ({ ok: true, date: '2026-10-01', net_sales: 100, guests: 2 }),
    monthDays: () => [{ date: '2026-10-01' }], daysOfYm: () => [{ date: '2026-10-01' }],
    attMonthDays: () => [{ date: '2026-10-01' }], todayISO: () => '2026-10-01', todayDays: () => [{ date: '2026-10-01' }],
    curYm: () => '2026-10', curPage: 'budget', nowJP: () => 'fixture', isFrozenMonth: () => true,
    _ensureMonthInflight: {}, monthFrozenKey: id => 'month-frozen-' + id,
    ls: (_key, fallback) => fallback, lsSet: (...args) => writes.push(args), markSynced: key => synced.push(key),
    fmtUSD2: String, escapeHtml: String, t: text => text, isoOf: () => '2026-10-01',
    confirm: () => true, alert: message => { throw new Error(message); },
    setSyncState: (_id, value) => writes.push(['sync-state', value]), openSyncCenter: () => {},
    setBowlCatCfg: () => effects.push('bowl-config'), _bowlPickFood: [], _bowlPickTO: [],
    supaPullAllMasters: async () => {}, refreshStores: () => {},
    showSyncSplash: () => {}, setSyncSplash: message => effects.push('splash:' + message), hideSyncSplash: () => {},
  });
  context.window = context;
  vm.runInContext(names.map(name => extract(name)).join('\n'), context);
  return { context, toasts, effects, writes, synced, element };
}

test('range import retains result and counts CAS refusal as a failure', async () => {
  const f = fixture(); await f.context.doRangeImport('F01', 'fixture-guid');
  assert.equal(f.toasts.some(x => x.kind === 'success'), false);
  assert.equal(f.toasts.at(-1).kind, 'warning');
  assert.match(f.element('rg-progress').innerHTML, /financial conflict/);
  assert.equal(f.effects.includes('close'), false);
  assert.equal(f.effects.includes('timer'), false);
});

test('manual duplicate repair preserves data and reports unsupported instead of false success', () => {
  const f = fixture();
  let reads = 0;
  Object.assign(f.context, {
    FUNERGY_FINANCIAL_SAVE: {},
    lsKeys: () => { reads++; return ['spl_budgets_v2_F01']; },
    _lsRaw: () => { throw new Error('unversioned repair must not read or mutate budgets'); },
    mergeBudgets: () => { throw new Error('unversioned repair must not merge budgets'); },
  });
  const result = f.context.repairBudgetDupes(false);
  assert.equal(result.blocked, true);
  assert.equal(result.fixed, 0);
  assert.equal(result.checked, 0);
  assert.equal(reads, 0);
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.toasts.map(x => x.kind), ['warning']);
  assert.match(f.toasts[0].message, /変更せず/);
  assert.doesNotMatch(f.toasts[0].message, /修復しました|重複はありません/);
  const silent = f.context.repairBudgetDupes(true);
  assert.equal(silent.blocked, true);
  assert.equal(f.toasts.length, 1);
});

test('period and attendance callers do not claim success after financial refusal', async () => {
  for (const name of ['tipRefreshPeriodFromToast', 'attBackfillMonth']) {
    const f = fixture();
    if (name === 'tipRefreshPeriodFromToast') await f.context[name]('F01', '2026-10-01', '2026-10-01');
    else await f.context[name]('F01', 'fixture-guid');
    assert.equal(f.toasts.some(x => x.kind === 'success'), false, name);
    assert.equal(f.toasts.at(-1).kind, 'warning', name);
  }
});

test('bowl recalculation stops before a success claim when either financial phase fails', async () => {
  const first = fixture(); await first.context.saveBowlCatCfg('F01');
  assert.equal(first.toasts.at(-1).kind, 'warning');
  const second = fixture(true);
  second.context.syncStoreActualsFromToast = async () => ({ error: 'later conflict' });
  await second.context.saveBowlCatCfg('F01');
  assert.equal(second.toasts.at(-1).kind, 'warning');
  assert.equal(second.toasts.some(x => x.kind === 'success'), false);
});

test('weather refusal propagates to per-store and aggregate sync state', async () => {
  const f = fixture(true); f.context.doWeatherSyncSilent = async () => ({ error: 'weather conflict' });
  const result = await f.context.syncCenterRunStore('F01');
  assert.equal(result.err, 'weather conflict');
  await f.context.syncAllData('F01', 'fixture-guid');
  assert.equal(f.toasts.at(-1).kind, 'danger');
  await f.context.syncCenterRunAll();
  assert.equal(f.toasts.at(-1).kind, 'warning');
  assert.equal(f.writes.filter(x => x[0] === 'sync-state').every(x => x[1].status === 'failed'), true);
  f.context.doWeatherSyncSilent = async () => { throw new Error('weather unavailable'); };
  const rejected = await f.context.syncCenterRunStore('F01');
  assert.match(rejected.err, /weather unavailable/);
  await f.context.syncAllData('F01', 'fixture-guid');
  assert.equal(f.toasts.at(-1).kind, 'danger');
});

test('failed month import neither freezes nor marks synced and refresh reports incomplete', async () => {
  const f = fixture();
  const result = await f.context.ensureMonthDataLoaded('2026-10');
  assert.match(result.error, /未完了/);
  assert.equal(f.writes.some(x => x[0].startsWith('month-frozen-')), false);
  assert.equal(f.synced.length, 0);
  await f.context.refreshNow();
  assert.equal(f.toasts.at(-1).kind, 'warning');
  await f.context.doToastFetchToday('F01', 'fixture-guid');
  assert.match(f.element('toast-sync-status').textContent, /未完了/);
});

test('successful ordinary import still freezes and retains success behavior', async () => {
  const f = fixture(true);
  const result = await f.context.ensureMonthDataLoaded('2026-10');
  assert.equal(result.error, null);
  assert.equal(f.writes.some(x => x[0] === 'month-frozen-F01' && x[1] === true), true);
  assert.equal(f.synced.length, 1);
  await f.context.doRangeImport('F01', 'fixture-guid');
  assert.equal(f.toasts.at(-1).kind, 'success');
  assert.equal(f.effects.includes('close'), true);
});

test('budget approval reopen owns its whole branch while non-budget reopen bypasses financial capture', async () => {
  const f = fixture(true), events = [], budgets = [{ storeId: 'F01', status: '承認済み' }];
  let release; const gate = new Promise(resolve => { release = resolve; });
  const approval = { id: 'a1', type: '予算', ref: 'F01', status: 'approved', from: 'Fixture', title: 'Budget' };
  Object.assign(f.context, {
    curRole: 'gm', curUserName: 'Owner', ROLE_CONFIG: { gm: { name: 'Owner' } },
    apPullLatest: async () => {}, ls: () => [approval],
    _apStT: () => 0, _apMut: () => 0, _apGen: () => 0, _rtNextT: (_v, stamp) => stamp,
    _apReopenRec: a => { events.push('approval'); a.status = 'pending'; },
    getBudgets: () => budgets, saveBudgets: () => events.push('budget'),
    lsSet: () => events.push('approval-save'), addNotif: () => events.push('notification'), _apRerender: () => events.push('render'),
    FUNERGY_FINANCIAL_SAVE: {
      refresh: async keys => { events.push(['refresh', ...keys]); },
      captureCallback: fn => { events.push('capture'); return () => gate.then(fn); },
    },
  });
  const saving = f.context.reopenApproval('a1');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, [['refresh', 'spl_budgets_v2_F01'], 'capture']);
  assert.equal(budgets[0].status, '承認済み');
  release(); await saving;
  assert.deepEqual(events.slice(2), ['budget', 'approval', 'approval-save', 'notification', 'render']);
  const vacation = { status: '承認済み' };
  approval.type = '休暇'; approval.status = 'approved';
  Object.assign(f.context, { getVacations: () => [Object.assign(vacation, { id: 'F01' })], saveVacations: () => events.push('vacation') });
  events.length = 0; await f.context.reopenApproval('a1');
  assert.equal(events.includes('capture'), false);
  assert.equal(events.some(x => Array.isArray(x) && x[0] === 'refresh'), false);
  assert.equal(events.includes('vacation'), true);
});
