import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const clone = value => JSON.parse(JSON.stringify(value));
const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const guard = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].find(match => match[1].includes('root.FunergyFinancialSave'))?.[1];
assert.ok(guard, 'financial guard is embedded in the released source');
const BASE = '2026-10-21T01:00:00.000001Z';
const AFTER = '2026-10-21T01:00:00.000002Z';
const DAILY = 'daily_actuals_F01', BUDGET = 'spl_budgets_v2_F01';
const ids = ['F01', 'F02', 'F03', 'F03-G', 'F04-A', 'F04-K', 'F04-P', 'F05', 'F06', 'F07'];
const dow = () => Object.fromEntries(['lunch', 'dinner', 'takeout'].map(s => [s, Array.from({ length: 7 }, () => ({ guests: 10, orders: 10, spend: 4 }))]));
const initial = () => ({
  [DAILY]: { '2026-10-01': { actual: 100, event: 'Before', foodCost: 9, by: 'Original', at: '2026/10/01', serverExtra: 3 } },
  [BUDGET]: [{ storeId: 'F01', actual: 100, period: '2026.10', status: '下書き', bases: [], dow: dow(),
    months: { '2026-10': { dow: dow(), days: { '2026-10-01': 200 }, status: '承認済み', approvedBy: 'GM', approvedAt: '2026/10/01' } } }]
});
function webFunction(name) {
  let start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, `actual source function exists: ${name}`);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, `top level function end exists: ${name}`);
  return source.slice(start, end + 2);
}
const roleConfig = source.match(/const ROLE_CONFIG = \{[\s\S]*?\n\};/)[0];
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(options = {}) {
  const storage = options.storage || new Map();
  const database = options.database || new Map(Object.entries(initial()).map(([key, value]) => [key, { key, value, exists: true, version: BASE }]));
  if (!storage.has(DAILY)) for (const [key, row] of database) storage.set(key, JSON.stringify(row.value));
  const fields = new Map(), dayFields = [], toasts = [], effects = [], legacy = [], commits = [], receipts = options.receipts || new Map();
  let nextId = 1, openHtml = '';
  const fieldsFrom = html => {
    openHtml = html; fields.clear();
    for (const tag of html.matchAll(/<input\b[^>]*>/g)) {
      const id = tag[0].match(/id="([^"]+)"/)?.[1]; if (id) fields.set(id, { value: tag[0].match(/value="([^"]*)"/)?.[1] || '', disabled: false });
    }
    for (const tag of html.matchAll(/<textarea\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) fields.set(tag[1], { value: tag[2], disabled: false });
    fields.set('da-weather', { value: '', disabled: false });
  };
  const raw = (key, fallback) => storage.has(key) ? JSON.parse(storage.get(key)) : fallback;
  const context = vm.createContext({ console, setTimeout, clearTimeout, Promise, crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}` },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, val) => storage.set(key, String(val)) },
    document: { getElementById: id => fields.get(id) || null, querySelectorAll: query => query === '.bb-day' ? dayFields : [...fields.values(), ...dayFields] },
    _lsRaw: raw, _lsStoreGet: key => storage.get(key) ?? null, _lsWriteVerified: (key, serialized) => {
      if (options.writeVerified?.(key, serialized) === false) return false;
      storage.set(key, serialized); return true;
    },
    ls: (key, fallback) => key === 'budgets_v2' ? ids.flatMap(id => raw('spl_budgets_v2_' + id, [])) : raw(key, fallback),
    lsSet: (key, value) => { storage.set(key, JSON.stringify(value)); legacy.push(['lsSet', key, clone(value)]); return true; },
    _lsPushBlocked: () => false, _pushWithOutbox: (...a) => legacy.push(['push', ...a]),
    syncMasterToSupabase: async (...a) => { legacy.push(['sync', ...a]); return true; },
    opMergePush: async (...a) => { legacy.push(['merge', ...a]); return true; },
    supaUpsert: async (...a) => { legacy.push(['upsert', ...a]); return true; },
    openModal: fieldsFrom, closeModalDirect: () => effects.push('close'),
    showToast: (message, kind) => toasts.push({ message, kind }),
    renderPage: page => { effects.push('render:' + page); if (context._bbStore) context._bbDow = clone(context.getBudgets().find(b => b.storeId === context._bbStore).dow); },
    bbClearDirty: () => { effects.push('clear'); context._bbDirty = false; },
    snapshotBudgetsLocal: () => {}, verifyBudgetSaved: store => ({ ok: Boolean(context.getBudgets().find(b => b.storeId === store)) }),
    getBudgetForMonth: (store, month) => { const b = context.getBudgets().find(b => b.storeId === store); return b && { ...b, ...(b.months?.[month] || {}) }; },
    dayBudgetFor: () => 200, weatherIcon: () => '', dayEventFor: () => '', escapeHtml: str => String(str).replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
    STORES: ids.map(id => ({ id, name: id })), getPeriod: () => '2026.10', daysOfYm: () => [],
    bizYm: () => '2026-10', curYm: () => '2026-10', budgetYM: () => ({ y: 2026, m: 10 }),
    myName: () => 'Test Owner', nowJP: () => '2026/10/21 12:00', curRole: 'gm', curUserName: 'Test Owner', curStoreLogin: false,
    scrollTo: () => {}, bbRecalcDow: () => {}, bbDayTotal: () => {}, alert: message => { throw new Error(message); }, confirm: () => true,
    _opLastPushErr: {}, _opLastPushWhy: {}, _lsPushP: {}, _LS_SAVE_FAIL: {}, _outboxFlushing: false, SUPA_SYNC_ENABLED: true, _supaBooting: false,
    t: value => value, fetchToastSales: options.fetchToastSales || (async () => [{ business_date: '2026-10-01', net_sales: 321 }]),
    fetchWeatherRange: options.fetchWeatherRange || (async () => ({ '2026-10-01': '晴' })),
    openInputModal: (_config, callback) => { context.reasonCallback = callback; }, apDecidedFromPage: (...args) => effects.push(['approval', ...args]),
    snapshotApprovedBudget: () => effects.push('snapshot'),
    openBudgetReview: () => fieldsFrom('<div>Review</div>'), addApproval: value => { effects.push(['addApproval', clone(value)]); },
    renderDowModal: () => fieldsFrom('<input id="dow-test" value="10">'), dowRecalc: () => {},
    monthDays: () => [{ date: '2026-10-01' }],
  });
  context.window = context;
  const names = ['getBudgets', 'getDailyActuals', 'setDailyActuals', '_dowHasReal', '_budHasReal', '_monHasReal', '_budStripTs', 'saveBudgets',
    '_ymFromStamp', '_budGuessStatusYm', '_budLegacyYm', 'budMon', 'budYmStr', 'budStatusFor', 'budSetStatus', 'budPinLegacyMonth', 'budPinCurrentMonth', 'canEditBudget',
    'openDailyActualModal', 'openDayMemo', 'bbOpen', 'saveDailyActual', 'saveDayMemo', 'bbSave', 'syncStoreActualsFromToast', 'fetchWeatherForView',
    'approveBudgetSeg', 'rejectBudgetSeg', '_outboxGet', '_outboxSet', '_outboxRemove', '_outboxAdd', 'outboxRetryOne', 'flushOutbox',
    'verifyBudgetSaved', 'openDowEditor', 'saveDow', 'getDow', 'dowCellInput', 'doWeatherSync', '_doSubmitBudget', 'budRationale',
    'mergeBudgets', '_budTs', '_budWeight', '_mergeBudMonths'];
  vm.runInContext(roleConfig + '\n' + names.map(webFunction).join('\n'), context);
  vm.runInContext(guard, context);
  const answer = request => {
    if (receipts.has(request.requestId)) return clone(receipts.get(request.requestId));
    for (const key of Object.keys(request.writes)) {
      const row = database.get(key); const expected = row ? { value: row.value, updated_at: row.version } : null;
      if (JSON.stringify(expected) !== JSON.stringify(request.expected[key])) return { status: 'conflict', requestId: request.requestId };
    }
    const versions = {};
    for (const [key, value] of Object.entries(request.writes)) {
      const old = database.get(key)?.version || BASE;
      versions[key] = old.replace(/\.(\d{6})Z$/, (_all, fraction) => '.' + String(Number(fraction) + 1).padStart(6, '0') + 'Z');
      database.set(key, { key, value: clone(value), exists: true, version: versions[key] });
    }
    const result = { status: 'committed', requestId: request.requestId, versions }; receipts.set(request.requestId, clone(result)); return result;
  };
  const transport = {
    read: options.read || (async keys => ({ rows: keys.map(key => database.has(key) ? clone(database.get(key)) : { key, exists: false, value: null, version: null }) })),
    commit: async request => { commits.push(request); return options.commit ? options.commit(request, answer) : answer(request); },
    receipt: options.receipt || (async ({ requestId }) => receipts.get(requestId) || { status: 'not-found', requestId })
  };
  const api = context.FunergyFinancialSave.install(context, { enabled: true, transport, timeoutMs: options.timeoutMs || 300, deferStartup: options.deferStartup });
  return { context, api, fields, dayFields, toasts, effects, legacy, commits, database, storage, receipts, answer,
    set: (id, value) => { const field = fields.get(id) || { disabled: false }; field.value = value; fields.set(id, field); },
    advance(key, fn) { const old = clone(database.get(key)); fn(old.value); old.version = AFTER; database.set(key, old); },
    html: () => openHtml };
}

test('guard is explicitly opt-in and factory has no transport or credential', () => {
  const c = vm.createContext({}); vm.runInContext(guard, c);
  assert.equal(c.FunergyFinancialSave.install(c, {}).enabled, false);
  assert.equal(c.FUNERGY_FINANCIAL_SAVE, undefined);
  assert.doesNotMatch(guard, /https:\/\/|service_role|SUPABASE_ANON|Bearer /);
});

test('real daily form freezes displayed baseline, commits both keys atomically and shows success only after acknowledgement', async () => {
  const gate = deferred(); const f = fixture({ commit: (request, answer) => gate.promise.then(() => answer(request)) });
  await f.context.openDailyActualModal('F01', '2026-10-01', '木');
  f.set('da-actual', '345'); f.set('da-event', 'Entered');
  const saving = f.context.saveDailyActual('F01', '2026-10-01'); await settle();
  assert.equal(f.commits.length, 1); const request = f.commits[0];
  assert.deepEqual(Object.keys(request.writes).sort(), [DAILY, BUDGET].sort());
  assert.equal(request.expected[DAILY].value['2026-10-01'].actual, 100);
  assert.equal(request.expected[DAILY].updated_at, BASE);
  assert.equal(request.writes[DAILY]['2026-10-01'].serverExtra, 3);
  assert.equal(request.writes[BUDGET][0].actual, 345);
  assert.equal(Object.isFrozen(request.expected[DAILY].value), true);
  assert.equal(f.toasts.some(x => x.kind === 'success'), false);
  assert.equal(f.effects.includes('close'), false);
  assert.equal(f.fields.get('da-actual').disabled, true);
  gate.resolve(); await saving;
  assert.equal(f.toasts.filter(x => x.kind === 'success').length, 1);
  assert.equal(f.effects.includes('close'), true);
  assert.equal(f.database.get(DAILY).value['2026-10-01'].actual, 345);
  assert.equal(f.api.getState().status, 'committed');
  assert.equal(f.legacy.length, 0);
});

test('remote update plus fresh local pull cannot rebase an already-open daily form', async () => {
  const f = fixture(); await f.context.openDailyActualModal('F01', '2026-10-01', '木');
  f.set('da-actual', '456'); f.set('da-event', 'Preserve this draft');
  f.advance(DAILY, value => { value['2026-10-01'].actual = 999; });
  f.storage.set(DAILY, JSON.stringify(f.database.get(DAILY).value));
  await f.api.refresh([DAILY, BUDGET]); // a background read must not replace the visible form's original baseline
  await f.context.saveDailyActual('F01', '2026-10-01');
  assert.equal(f.commits[0].expectedVersions[DAILY], BASE);
  assert.equal(f.api.getState().status, 'conflict');
  assert.equal(f.database.get(DAILY).value['2026-10-01'].actual, 999);
  assert.equal(f.database.get(BUDGET).value[0].actual, 100);
  assert.equal(f.fields.get('da-event').value, 'Preserve this draft');
  assert.equal(f.toasts.some(x => x.kind === 'success'), false);
  assert.equal(f.effects.includes('close'), false);
  assert.equal(f.api.getRecovery().some(x => x.reason === 'conflict'), true);
  await f.api.reloadForm();
  assert.equal(f.fields.get('da-actual').value, '999');
  assert.equal(f.api.getRecovery().find(x => x.reason === 'conflict').request.writes[DAILY]['2026-10-01'].event, 'Preserve this draft');
});

test('real memo and budget forms retain original transformations and approval metadata', async () => {
  const f = fixture(); await f.context.openDayMemo('F01', '2026-10-01', '木'); f.set('dm-memo', '  Memo  ');
  await f.context.saveDayMemo('F01', '2026-10-01');
  assert.deepEqual(Object.keys(f.commits[0].writes), [DAILY]);
  assert.equal(f.database.get(DAILY).value['2026-10-01'].event, 'Memo');
  await f.context.bbOpen('F01'); f.context._bbDow.lunch[0].guests = 99;
  f.dayFields.push({ value: '123.5', disabled: false, getAttribute: () => '2026-10-02' });
  await f.context.bbSave();
  assert.equal(f.commits.length, 2);
  const month = f.database.get(BUDGET).value[0].months['2026-10'];
  assert.equal(month.days['2026-10-02'], 123.5); assert.equal(month.dow.lunch[0].guests, 99);
  assert.equal(month.status, '承認済み'); assert.equal(month.approvedBy, 'GM');
  assert.equal(f.api.getRecovery().filter(x => x.reason === 'committed_receipt').length, 2);
});

test('timeout retains exact immutable request and refuses another save; explicit retry reuses id and body', async () => {
  let calls = 0; const f = fixture({ timeoutMs: 10, commit: (request, answer) => { calls++; return calls === 1 ? new Promise(() => {}) : answer(request); } });
  await f.context.openDayMemo('F01', '2026-10-01', '木'); f.set('dm-memo', 'Original request');
  await f.context.saveDayMemo('F01', '2026-10-01');
  assert.equal(f.api.getState().status, 'unknown'); const request = f.commits[0];
  f.set('dm-memo', 'Must not become new save'); await f.context.saveDayMemo('F01', '2026-10-01');
  assert.equal(f.commits.length, 1);
  await f.api.retry();
  assert.equal(f.commits[1], request); assert.equal(f.database.get(DAILY).value['2026-10-01'].event, 'Original request');
});

test('reload recovers unknown pending request and confirms original receipt without duplicate send', async () => {
  const f = fixture({ timeoutMs: 10, commit: (request, answer) => { answer(request); return new Promise(() => {}); } });
  await f.context.openDayMemo('F01', '2026-10-01', '木'); f.set('dm-memo', 'Committed but response lost');
  await f.context.saveDayMemo('F01', '2026-10-01');
  const again = fixture({ storage: f.storage, database: f.database, receipts: f.receipts });
  assert.equal(again.api.getState().status, 'unknown'); await again.api.reconcile();
  assert.equal(again.commits.length, 0); assert.equal(again.api.getState().status, 'committed');
  const third = fixture({ storage: f.storage, database: f.database, receipts: f.receipts }); assert.equal(third.api.getState().status, 'idle');
});

test('invalid, wrong-id, missing-key and equal/older acknowledgement remain unresolved', async () => {
  for (const bad of [r => ({ status: 'committed', requestId: 'wrong', versions: { [DAILY]: AFTER } }),
    r => ({ status: 'committed', requestId: r.requestId, versions: {} }),
    r => ({ status: 'committed', requestId: r.requestId, versions: { [DAILY]: BASE } }),
    r => ({ status: 'committed', requestId: r.requestId, versions: { [DAILY]: '2026-02-30T01:00:00Z' } }),
    r => ({ status: 'conflict', requestId: 'wrong' })]) {
    const f = fixture({ commit: bad }); await f.context.openDayMemo('F01', '2026-10-01', '木'); f.set('dm-memo', 'Draft');
    await f.context.saveDayMemo('F01', '2026-10-01'); assert.equal(f.api.getState().status, 'unknown');
    assert.equal(f.toasts.some(x => x.kind === 'success'), false); assert.equal(f.effects.includes('close'), false);
  }
});

test('actual legacy outbox retains protected entries including missing values while unrelated entries still sync', async () => {
  const f = fixture(); f.storage.set('op_outbox', JSON.stringify([{ key: DAILY }, { key: 'daily_actuals_F02' }, { key: 'tasks_all' }]));
  f.storage.set('tasks_all', JSON.stringify([{ id: 'task' }])); await f.api.refresh([DAILY]); await f.context.flushOutbox();
  assert.deepEqual(JSON.parse(f.storage.get('op_outbox')).map(x => x.key), [DAILY, 'daily_actuals_F02']);
  assert.equal(f.legacy.length, 1); assert.equal(f.legacy[0][1], 'tasks_all');
  await f.context.outboxRetryOne('daily_actuals_F02'); f.context._outboxRemove(DAILY);
  assert.equal(JSON.parse(f.storage.get('op_outbox')).length, 2);
  assert.equal(f.api.getRecovery().filter(x => x.reason === 'legacy_outbox').length, 2);
  assert.equal(await f.context.opMergePush(DAILY, {}), false);
  assert.equal(await f.context.syncMasterToSupabase(BUDGET, []), false);
  assert.equal(await f.context.supaUpsert('app_state', [{ key: DAILY, value: {} }, { key: 'tasks_all', value: [] }]), false);
  assert.equal(f.legacy.length, 2);
  assert.deepEqual(clone(f.legacy[1]), ['upsert', 'app_state', [{ key: 'tasks_all', value: [] }]]);
  assert.equal(await f.context.supaUpsert('app_state', { key: DAILY, value: {} }), false);
  assert.equal(f.legacy.length, 2);
  assert.throws(() => f.context.lsSet(DAILY, {}), /financial_transaction_required/);
});

test('actual async Toast write uses baseline frozen before await and never falls back to legacy merges', async () => {
  const gate = deferred(); const f = fixture({ fetchToastSales: () => gate.promise });
  await f.api.refresh([DAILY, BUDGET]);
  const writing = f.context.syncStoreActualsFromToast('F01', 'guid', [{ date: '2026-10-01' }]);
  await settle();
  f.advance(DAILY, value => { value['2026-10-01'].event = 'Other editor'; });
  await f.api.refresh([DAILY, BUDGET]);
  gate.resolve([{ business_date: '2026-10-01', net_sales: 321 }]); await writing;
  assert.equal(f.commits.length, 1); assert.equal(f.commits[0].expectedVersions[DAILY], BASE);
  assert.equal(f.api.getState().status, 'conflict'); assert.equal(f.database.get(DAILY).value['2026-10-01'].event, 'Other editor');
  assert.equal(f.legacy.length, 0);
});

test('real weather save and captured input callback commit per-store with acknowledgement-only side effects', async () => {
  const f = fixture(); await f.api.refresh([DAILY, BUDGET]); await f.context.fetchWeatherForView('F01', [{ date: '2026-10-01' }]);
  assert.equal(f.database.get(DAILY).value['2026-10-01'].weather, '晴');
  await f.context.rejectBudgetSeg('F01', '2026-10'); assert.equal(f.commits.length, 1);
  assert.equal(typeof f.context.reasonCallback, 'function');
  await f.context.reasonCallback('Revise');
  assert.equal(f.commits.length, 2); assert.equal(f.database.get(BUDGET).value[0].months['2026-10'].status, '差し戻し');
  assert.equal(f.effects.some(x => Array.isArray(x) && x[0] === 'approval'), true);
});

test('captured callback protects deliberate imports, but multi-store candidates never partially commit', async () => {
  const f = fixture(); await f.api.refresh([DAILY, BUDGET, 'spl_budgets_v2_F02']);
  const callback = f.api.captureCallback(() => {
    const budgets = f.context.getBudgets(); budgets.find(b => b.storeId === 'F01').actual = 999;
    budgets.find(b => b.storeId === 'F02').actual = 999; f.context.saveBudgets(budgets); f.context.showToast('Saved', 'success');
  });
  await callback(); assert.equal(f.commits.length, 0); assert.equal(f.database.get(BUDGET).value[0].actual, 100);
  assert.equal(f.toasts.some(x => x.kind === 'success'), false); assert.equal(f.api.getRecovery().some(x => x.reason === 'unverified_transaction'), true);
  assert.deepEqual(Object.keys(f.api.getRecovery().find(x => x.reason === 'unverified_transaction').before).sort(), [BUDGET, 'spl_budgets_v2_F02'].sort());
});

test('source writer coverage includes every direct setter caller in actual pinned source', () => {
  const c = vm.createContext({}); vm.runInContext(guard, c); const covered = new Set(c.FunergyFinancialSave.writerNames);
  for (const name of ['saveDailyActual', 'saveDayMemo', 'bbSave', 'syncStoreActualsFromToast', 'fetchToastRange', 'fetchWeatherForView',
    'saveEvent', 'deleteEvent', 'saveDow', 'saveSeg', 'saveDayBudget', 'saveBasis', 'deleteBasis', '_reviewBeforeSubmit',
    '_saveRationaleDraft', '_doSubmitBudget', 'approveBudgetSeg', 'rejectBudgetSeg', 'reopenBudget',
    'normalizeBudgetsDemo', 'migrateBudgetStatusYm', 'migrateBudgetStatusYmFix']) {
    assert.ok(covered.has(name), name); assert.match(webFunction(name), /(?:setDailyActuals|saveBudgets)\(/, name);
  }
});

test('parallel automatic Toast operations queue and acquire independent pristine baselines without opening a form', async () => {
  const gate = deferred(); let fetched = 0;
  const f = fixture({ fetchToastSales: async () => { fetched++; if (fetched === 1) await gate.promise; return [{ business_date: '2026-10-01', net_sales: 222 }]; } });
  f.database.set('daily_actuals_F02', { key: 'daily_actuals_F02', version: BASE, exists: true, value: {} });
  f.database.set('spl_budgets_v2_F02', { key: 'spl_budgets_v2_F02', version: BASE, exists: true, value: [{ storeId: 'F02', actual: 0 }] });
  const first = f.context.syncStoreActualsFromToast('F01', 'one', [{ date: '2026-10-01' }]);
  const second = f.context.syncStoreActualsFromToast('F02', 'two', [{ date: '2026-10-01' }]);
  await settle(); assert.equal(fetched, 1); gate.resolve();
  const answers = await Promise.all([first, second]);
  assert.equal(answers.every(x => !x.error && x.updated === 1), true);
  assert.equal(f.commits.length, 2);
  assert.equal(f.database.get(DAILY).value['2026-10-01'].actual, 222);
  assert.equal(f.database.get('daily_actuals_F02').value['2026-10-01'].actual, 222);
});

test('actual weather caller reports refusal instead of success after a conflicting write', async () => {
  const f = fixture({ commit: request => ({ status: 'conflict', requestId: request.requestId }) });
  await f.context.doWeatherSync('F01');
  assert.equal(f.api.getState().status, 'conflict');
  assert.equal(f.toasts.some(x => x.kind === 'success'), false);
});

test('read-only cache follows canonical refresh without local raw changes and preserves a displayed form snapshot', async () => {
  const f = fixture(); assert.equal(f.context._daRO('F01')['2026-10-01'].actual, 100);
  await f.api.refresh([DAILY]); f.advance(DAILY, value => { value['2026-10-01'].actual = 777; });
  await f.api.refresh([DAILY]); assert.equal(f.context._daRO('F01')['2026-10-01'].actual, 777);
  await f.context.openDayMemo('F01', '2026-10-01', '木');
  f.database.get(DAILY).value['2026-10-01'].actual = 888;
  await f.api.refresh([DAILY]); assert.equal(f.context._daRO('F01')['2026-10-01'].actual, 777);
});

test('actual saveDow preserves editable dowEditState on conflict, not only DOM text', async () => {
  const f = fixture({ commit: request => ({ status: 'conflict', requestId: request.requestId }) });
  await f.context.openDowEditor('F01', 'lunch'); f.context.dowCellInput(0, 'qty', '88');
  await f.context.saveDow();
  assert.equal(f.api.getState().status, 'conflict'); assert.equal(f.context.dowEditState.dow.lunch[0].guests, 88);
  f.context.dowCellInput(0, 'qty', '99'); assert.equal(f.context.dowEditState.dow.lunch[0].guests, 99);
  assert.equal(f.toasts.some(x => x.kind === 'success'), false);
});

test('actual budget submission flush continuation and approval side effects wait for acknowledgement', async () => {
  const gate = deferred(); const f = fixture({ commit: (request, answer) => gate.promise.then(() => answer(request)) });
  f.database.get(BUDGET).value[0].months['2026-10'].rationale = { basis: 'Confirmed', focus: 'October' };
  await f.context.openBudgetReview('F01', true);
  const saving = f.context._doSubmitBudget('F01'); await settle();
  assert.equal(f.commits.length, 1);
  assert.equal(f.effects.length, 0); assert.equal(f.toasts.length, 0);
  await settle(); assert.equal(f.toasts.some(x => x.kind === 'success'), false);
  gate.resolve(); await saving; await settle();
  assert.equal(f.effects.some(x => Array.isArray(x) && x[0] === 'addApproval'), true);
  assert.equal(f.toasts.some(x => x.kind === 'success'), true);
});

test('background conflict has a working explicit reload path and never automatically retries', async () => {
  const f = fixture({ commit: request => ({ status: 'conflict', requestId: request.requestId }) });
  await f.context.fetchWeatherForView('F01', [{ date: '2026-10-01' }]);
  assert.equal(f.api.getState().status, 'conflict');
  assert.equal(await f.api.reloadForm(), true);
  assert.equal(f.api.getState().status, 'idle'); assert.equal(f.commits.length, 1);
  assert.equal(f.api.getRecovery().some(x => x.reason === 'discarded_conflict'), true);
});

test('explicit bulk restore reads before confirmation and preserves normal multi-store restoration as individual guarded commits', async () => {
  const f = fixture(); const candidates = clone(initial()[BUDGET]); candidates[0].actual = 555;
  candidates.push({ storeId: 'F02', actual: 222, status: '下書き' });
  let confirmed = 0;
  const result = await f.api.restoreBudgets(candidates, { mode: 'overwrite', confirm: () => {
    confirmed++; assert.equal(f.commits.length, 0); return true;
  } });
  assert.equal(confirmed, 1); assert.deepEqual(Array.from(result.saved), ['F01', 'F02']);
  assert.equal(f.commits.length, 2); assert.equal(f.commits.every(x => Object.keys(x.writes).length === 1), true);
  assert.equal(f.database.get(BUDGET).value[0].actual, 555); assert.equal(f.database.get('spl_budgets_v2_F02').value[0].actual, 222);
  assert.equal(f.toasts.filter(x => x.kind === 'success').length, 1);
});

test('bulk restore stops on a concurrent change, reports only acknowledged stores, retains the rest and original file', async () => {
  const f = fixture(); f.database.set('spl_budgets_v2_F02', { key: 'spl_budgets_v2_F02', exists: true, version: BASE, value: [{ storeId: 'F02', actual: 100 }] });
  const candidates = [{ ...clone(initial()[BUDGET][0]), actual: 555 }, { storeId: 'F02', actual: 222 }, { storeId: 'F05', actual: 333 }];
  const result = await f.api.restoreBudgets(candidates, { mode: 'overwrite', confirm: () => {
    f.advance('spl_budgets_v2_F02', value => { value[0].actual = 777; }); return true;
  } });
  assert.deepEqual(Array.from(result.saved), ['F01']); assert.deepEqual(Array.from(result.retained), ['F02', 'F05']);
  assert.deepEqual(Array.from(result.conflicted), ['F02']); assert.equal(f.commits.length, 2);
  assert.equal(f.database.get('spl_budgets_v2_F02').value[0].actual, 777); assert.equal(f.database.has('spl_budgets_v2_F05'), false);
  assert.equal(f.toasts.some(x => x.kind === 'success'), false);
  assert.equal(f.api.getRecovery().find(x => x.reason === 'bulk_restore_proposal').value.length, 3);
  assert.equal(f.api.getRecovery().find(x => x.reason === 'bulk_restore_remainder').value.length, 2);
});

test('original local values are retained once before initial canonical read, including values without legacy outbox', async () => {
  const storage = new Map(Object.entries(initial()).map(([key, value]) => [key, JSON.stringify(value)]));
  storage.set('budgets_v2', JSON.stringify([{ storeId: 'F02', actual: 987 }]));
  storage.set('daily_actuals_F05', JSON.stringify({ '2026-10-01': { actual: 543 } }));
  const f = fixture({ storage }); await f.api.refresh([DAILY]); await f.api.refresh([BUDGET]);
  const records = f.api.getRecovery().filter(x => x.reason === 'pre_guard_local');
  assert.equal(records.length, 1); assert.equal(records[0].value.budgets_v2[0].actual, 987);
  assert.equal(records[0].value.daily_actuals_F05['2026-10-01'].actual, 543);
  f.storage.set(DAILY, JSON.stringify({ '2026-10-01': { actual: 777 } }));
  const again = fixture({ storage }); await again.api.refresh([DAILY]);
  assert.equal(again.api.getRecovery().filter(x => x.reason === 'pre_guard_local').length, 1);
});

test('bulk restore source entrypoints are excluded from generic writer ownership to avoid self-queue deadlock', () => {
  const c = vm.createContext({}); vm.runInContext(guard, c);
  for (const name of ['restoreBudgetsFromFile', 'restoreBudgetSnapshot', 'restoreApprovedBudget', 'pullBudgetsNow'])
    assert.equal(c.FunergyFinancialSave.writerNames.includes(name), false, name);
});

test('shared Web guard covers all existing default stores and all 20 protected rows, without creating blank budgets', async () => {
  const f = fixture();
  const defaults = source.match(/const DEFAULT_STORES = \[([\s\S]*?)\n\];/)[1];
  for (const match of defaults.matchAll(/\{id:'([^']+)'/g)) assert.ok(f.context.FunergyFinancialSave.storeIds.includes(match[1]), match[1]);
  await f.api.refresh(ids.flatMap(id => ['daily_actuals_' + id, 'spl_budgets_v2_' + id]));
  await f.context.openDayMemo('F03-G', '2026-10-01', '木'); f.set('dm-memo', 'Existing Web store');
  await f.context.saveDayMemo('F03-G', '2026-10-01');
  assert.equal(f.database.get('daily_actuals_F03-G').value['2026-10-01'].event, 'Existing Web store');
  assert.equal(f.database.has('spl_budgets_v2_F03-G'), false);
  assert.equal(f.commits[0].expected['daily_actuals_F03-G'], null);
});

test('unrelated approval and notification effects during an async financial read stay outside that transaction', async () => {
  const gate = deferred(); const f = fixture({ fetchToastSales: () => gate.promise, commit: request => ({ status: 'conflict', requestId: request.requestId }) });
  const writing = f.context.syncStoreActualsFromToast('F01', 'guid', [{ date: '2026-10-01' }]); await settle();
  f.context.lsSet('approvals', [{ id: 'vacation-1', type: '休暇', status: 'pending' }]);
  f.context.addApproval({ id: 'expense-1', type: '経費' });
  f.context.showToast('Vacation saved', 'success');
  assert.equal(JSON.parse(f.storage.get('approvals'))[0].id, 'vacation-1');
  assert.equal(f.effects.some(x => Array.isArray(x) && x[0] === 'addApproval'), true);
  assert.equal(f.toasts.some(x => x.message === 'Vacation saved'), true);
  gate.resolve([{ business_date: '2026-10-01', net_sales: 222 }]); await writing;
  assert.equal(f.api.getState().status, 'conflict');
  assert.equal(JSON.parse(f.storage.get('approvals'))[0].id, 'vacation-1');
});

test('historical F07 stays supported for restore, but unknown F08 cannot expand the protocol implicitly', async () => {
  const f = fixture();
  const result = await f.api.restoreBudgets([{ storeId: 'F07', actual: 77, bases: [], status: '下書き' }], { mode: 'overwrite' });
  assert.deepEqual(Array.from(result.saved), ['F07']);
  assert.equal(f.database.get('spl_budgets_v2_F07').value[0].actual, 77);
  await assert.rejects(() => f.api.refresh(['daily_actuals_F08']), /invalid_financial_read_scope/);
  await assert.rejects(() => f.api.restoreBudgets([{ storeId: 'F08', actual: 888 }]), /invalid_financial_restore/);
  const malformed = fixture({ read: async keys => ({ rows: [{ key: 'daily_actuals_F08', exists: true, value: {}, version: BASE }] }) });
  await assert.rejects(() => malformed.api.refresh([DAILY]), /financial_rows_mismatch/);
  assert.equal(malformed.commits.length, 0);
});

test('one-store pending, conflict and discarded drafts retain only touched rows after all 20 rows are hydrated', async () => {
  const gate = deferred();
  const f = fixture({ commit: request => gate.promise.then(() => ({ status: 'conflict', requestId: request.requestId })) });
  for (const id of ids.filter(id => id !== 'F01')) {
    const key = 'daily_actuals_' + id;
    f.database.set(key, { key, exists: true, version: BASE, value: { '2026-10-01': { event: 'UNRELATED_' + id } } });
  }
  await f.api.refresh(ids.flatMap(id => ['daily_actuals_' + id, 'spl_budgets_v2_' + id]));
  await f.context.openDayMemo('F01', '2026-10-01', '木'); f.set('dm-memo', 'Keep my entered memo');
  const saving = f.context.saveDayMemo('F01', '2026-10-01'); await settle();
  const retained = f.api.getRecovery().find(x => x.reason === 'pending_request');
  assert.deepEqual(Object.keys(retained.before), [DAILY]);
  assert.doesNotMatch(JSON.stringify(retained), /UNRELATED_/);
  gate.resolve(); await saving;
  assert.equal(f.api.getState().status, 'conflict');
  await f.api.reloadForm();
  for (const record of f.api.getRecovery().filter(x => ['pending_request', 'conflict', 'discarded_conflict'].includes(x.reason))) {
    assert.deepEqual(Object.keys(record.before), [DAILY]);
    assert.equal(record.request.writes[DAILY]['2026-10-01'].event, 'Keep my entered memo');
    assert.doesNotMatch(JSON.stringify(record), /UNRELATED_/);
  }
});

test('repeated acknowledged saves compact completed payloads to 50 summaries while retaining drafts losslessly', async () => {
  const recoveryKey = '_financial_save_recovery_v1';
  const drafts = [
    { reason: 'conflict', request: { requestId: '00000000-0000-4000-8000-999999999999', writes: { [DAILY]: { memo: 'Conflict draft' } } } },
    { reason: 'bulk_restore_proposal', value: [{ storeId: 'F07', actual: 77, notes: 'Original import' }] },
    { reason: 'legacy_outbox', key: BUDGET, value: [{ storeId: 'F01', actual: 876 }], outbox: { key: BUDGET } }
  ];
  const storage = new Map([[recoveryKey, JSON.stringify(drafts)]]);
  const f = fixture({ storage });
  await f.api.refresh(ids.flatMap(id => ['daily_actuals_' + id, 'spl_budgets_v2_' + id]));
  let sizeAt50;
  for (let i = 0; i < 80; i++) {
    await f.context.openDayMemo('F01', '2026-10-01', '木'); f.set('dm-memo', 'Memo-' + String(i).padStart(3, '0'));
    await f.context.saveDayMemo('F01', '2026-10-01');
    if (i === 49) sizeAt50 = f.storage.get(recoveryKey).length;
  }
  const records = clone(f.api.getRecovery());
  assert.equal(f.commits.length, 80);
  assert.equal(records.filter(x => x.reason === 'pending_request').length, 0);
  const summaries = records.filter(x => x.reason === 'committed_receipt');
  assert.equal(summaries.length, 50);
  assert.equal(summaries[0].requestId, f.commits[30].requestId);
  assert.equal(summaries.at(-1).requestId, f.commits[79].requestId);
  assert.equal(summaries.every(x => !x.before && !x.request && !x.value), true);
  assert.equal(f.storage.get(recoveryKey).length, sizeAt50);
  for (const draft of drafts) assert.deepEqual(records.find(x => x.reason === draft.reason), draft);
});

test('recovery storage exhaustion refuses dispatch and preserves the entered form and previous recovery', async () => {
  let rejectRecovery = false;
  const recoveryKey = '_financial_save_recovery_v1';
  const f = fixture({ writeVerified: key => !(rejectRecovery && key === recoveryKey) });
  await f.context.openDayMemo('F01', '2026-10-01', '木');
  const previous = f.storage.get(recoveryKey);
  f.set('dm-memo', 'Retain visible input on quota failure'); rejectRecovery = true;
  await f.context.saveDayMemo('F01', '2026-10-01');
  assert.equal(f.commits.length, 0);
  assert.equal(f.storage.get(recoveryKey), previous);
  assert.equal(f.fields.get('dm-memo').value, 'Retain visible input on quota failure');
  assert.equal(f.fields.get('dm-memo').disabled, false);
  assert.equal(f.effects.includes('close'), false);
  assert.equal(f.toasts.some(x => x.kind === 'success'), false);
});

test('bulk restore never claims durable retention when recovery storage rejects the candidate', async () => {
  let rejectRecovery = false;
  const recoveryKey = '_financial_save_recovery_v1';
  const f = fixture({ writeVerified: key => !(rejectRecovery && key === recoveryKey) });
  await f.api.refresh([BUDGET]); const previous = f.storage.get(recoveryKey);
  const result = await f.api.restoreBudgets([{ storeId: 'F01', actual: 987 }], {
    mode: 'overwrite', confirm: () => { rejectRecovery = true; return true; }
  });
  assert.equal(result.error, 'financial_recovery_storage_failed');
  assert.equal(f.commits.length, 0); assert.equal(f.storage.get(recoveryKey), previous);
  assert.equal(f.toasts.some(x => x.message.includes('保管しています')), false);
  assert.equal(f.toasts.some(x => x.message.includes('保管も確認できません')), true);
  assert.equal(f.toasts.some(x => x.kind === 'success'), false);
});
