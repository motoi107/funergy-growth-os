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
// v1104（独立レビュー）：退避の記録は 1 件ずつの名前（RECOVERY_PREFIX＋時刻と番号）
const RECOVERY_PREFIX = 'financial_save_recovery_v2/';
const recoveryKeys = storage => [...storage.keys()].filter(k => k.startsWith(RECOVERY_PREFIX)).sort();
const recoveryText = storage => recoveryKeys(storage).map(k => storage.get(k)).join('\n');

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
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, val) => storage.set(key, String(val)), removeItem: key => storage.delete(key) },
    document: { getElementById: id => fields.get(id) || null, querySelectorAll: query => query === '.bb-day' ? dayFields : [...fields.values(), ...dayFields] },
    _lsRaw: raw, _lsStoreGet: key => storage.get(key) ?? null, _lsRawDel: key => storage.delete(key), _lsWriteVerified: (key, serialized) => {
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
  options.beforeInstall?.(context);
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
  // 記録の置き場所：本物の端末の関数（realStorage）があればそれ、なければ storage（Map）
  const mapStore = {
    get: key => storage.get(key) ?? null,
    keys: prefix => [...storage.keys()].filter(k => k.startsWith(prefix)),
    set: (key, json) => { if (options.writeVerified?.(key, json) === false) return false; storage.set(key, json); return true; },
    del: key => { storage.delete(key); return true; },
    persist: options.persist || (async () => true),
    reload: async () => true };
  const recoveryStore = options.recoveryStore || (typeof context.financialRecoveryStore === 'function' ? context.financialRecoveryStore() : mapStore);
  // v1107：答えが確かめられない保存の自動の確かめ。前からの試験では遅くして（10 分）、その試験の中では動かさない
  const api = context.FunergyFinancialSave.install(context, { enabled: true, transport, timeoutMs: options.timeoutMs || 300, deferStartup: options.deferStartup, lockWaitMs: options.lockWaitMs, onAutoRefused: options.onAutoRefused,
    autoCheckMs: options.autoCheckMs || [600000],
    awaitLocalReady: options.awaitLocalReady && (() => options.awaitLocalReady(context)), recoveryStore });
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
  const queueBefore = f.storage.get('op_outbox'), recoveryBefore = JSON.stringify(f.api.getRecovery());
  for (let i = 0; i < 20; i++) { await f.context.flushOutbox(); await f.context.outboxRetryOne(DAILY); await f.api.refresh([DAILY]); }
  assert.equal(f.storage.get('op_outbox'), queueBefore);
  assert.equal(JSON.stringify(f.api.getRecovery()), recoveryBefore);
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
  // v1107：自動の取り込みが重なったら、上書きせずに放す（帯で止めない・送り直さない）
  assert.equal(f.api.getState().status, 'idle'); assert.equal(f.api.getState().released.why, 'conflict');
  assert.equal(f.database.get(DAILY).value['2026-10-01'].event, 'Other editor');
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
  assert.equal(f.api.getState().status, 'idle'); assert.equal(f.api.getState().released.why, 'conflict');   // v1107：自動の保存は放す
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

test('background conflict lets go without overwriting or retrying; a typed conflict keeps the explicit reload path', async () => {
  // v1107：自動の保存（天気）が重なったら放す：帯で止めない・送り直さない・小さな印だけ残す
  const f = fixture({ commit: request => ({ status: 'conflict', requestId: request.requestId }) });
  await f.context.fetchWeatherForView('F01', [{ date: '2026-10-01' }]);
  assert.equal(f.api.getState().status, 'idle'); assert.equal(f.commits.length, 1);
  assert.equal(f.api.getRecovery().some(x => x.reason === 'auto_released' && x.why === 'conflict' && x.source === 'fetchWeatherForView'), true);
  assert.equal(f.api.getRecovery().some(x => x.reason === 'pending_request'), false);
  assert.equal(f.database.get(DAILY).value['2026-10-01'].event, 'Before');
  // 人の入力の保存が重なったときは今までどおり：帯で止めて、最新を確認する道で放す
  await f.context.openDayMemo('F01', '2026-10-01', '木'); f.set('dm-memo', 'Typed');
  await f.context.saveDayMemo('F01', '2026-10-01');
  assert.equal(f.api.getState().status, 'conflict');
  await f.api.reloadForm();   // 入力の画面を開き直す
  assert.equal(f.api.getState().status, 'idle'); assert.equal(f.commits.length, 2);
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
  assert.equal(f.api.getState().status, 'idle'); assert.equal(f.api.getState().released.why, 'conflict');   // v1107：自動の保存は放す
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
  // v1104: drafts written by v1101-v1103 under the old device-local key move once into the IndexedDB-capable key.
  const recoveryKey = 'financial_save_recovery_v2', legacyKey = '_financial_save_recovery_v1';
  const drafts = [
    { reason: 'conflict', request: { requestId: '00000000-0000-4000-8000-999999999999', writes: { [DAILY]: { memo: 'Conflict draft' } } } },
    { reason: 'bulk_restore_proposal', value: [{ storeId: 'F07', actual: 77, notes: 'Original import' }] },
    { reason: 'legacy_outbox', key: BUDGET, value: [{ storeId: 'F01', actual: 876 }], outbox: { key: BUDGET } }
  ];
  const storage = new Map([[legacyKey, JSON.stringify(drafts)]]);
  const f = fixture({ storage });
  await f.api.refresh(ids.flatMap(id => ['daily_actuals_' + id, 'spl_budgets_v2_' + id]));
  let sizeAt50;
  for (let i = 0; i < 80; i++) {
    await f.context.openDayMemo('F01', '2026-10-01', '木'); f.set('dm-memo', 'Memo-' + String(i).padStart(3, '0'));
    await f.context.saveDayMemo('F01', '2026-10-01');
    if (i === 49) sizeAt50 = recoveryText(f.storage).length;
  }
  const records = clone(f.api.getRecovery());
  assert.equal(f.commits.length, 80);
  assert.equal(records.filter(x => x.reason === 'pending_request').length, 0);
  const summaries = records.filter(x => x.reason === 'committed_receipt');
  assert.equal(summaries.length, 50);
  assert.equal(summaries[0].requestId, f.commits[30].requestId);
  assert.equal(summaries.at(-1).requestId, f.commits[79].requestId);
  assert.equal(summaries.every(x => !x.before && !x.request && !x.value), true);
  assert.equal(recoveryText(f.storage).length, sizeAt50);
  for (const draft of drafts) assert.deepEqual(records.find(x => x.reason === draft.reason), draft);
  assert.equal(f.storage.has(legacyKey), false);
});

test('a live legacy outbox keeps one original snapshot through 80 successful saves and module recreation', async () => {
  const recoveryKey = 'financial_save_recovery_v2';
  const outbox = [{ key: DAILY, attempts: 1, lastErr: 'Original offline save', ts: 1 }];
  const f = fixture();
  const unsent = initial()[DAILY]; unsent['2026-10-01'].event = 'Original unsent memo';
  f.storage.set(DAILY, JSON.stringify(unsent)); f.storage.set('op_outbox', JSON.stringify(outbox));
  await f.api.refresh([DAILY, BUDGET]);
  const originalLocal = clone(f.api.getRecovery().find(x => x.reason === 'pre_guard_local'));
  const originalOutbox = clone(f.api.getRecovery().find(x => x.reason === 'legacy_outbox'));
  let sizeAt50;
  for (let i = 0; i < 80; i++) {
    await f.context.openDayMemo('F01', '2026-10-01', '木'); f.set('dm-memo', 'Memo-' + String(i).padStart(3, '0'));
    await f.context.saveDayMemo('F01', '2026-10-01');
    if (i === 49) sizeAt50 = recoveryText(f.storage).length;
  }
  assert.equal(f.commits.length, 80);
  assert.equal(f.api.getRecovery().filter(x => x.reason === 'committed_receipt').length, 50);
  assert.equal(recoveryText(f.storage).length, sizeAt50);
  assert.deepEqual(clone(f.api.getRecovery().filter(x => x.reason === 'legacy_outbox')), [originalOutbox]);
  assert.deepEqual(originalOutbox.value, unsent);
  assert.deepEqual(JSON.parse(f.storage.get('op_outbox')), outbox);
  assert.equal(JSON.parse(f.storage.get(DAILY))['2026-10-01'].event, 'Memo-079');
  const beforeReload = recoveryText(f.storage);
  const again = fixture({ storage: f.storage, database: f.database, receipts: f.receipts });
  await again.api.refresh([DAILY, BUDGET]);
  assert.equal(recoveryText(again.storage), beforeReload);
  assert.deepEqual(clone(again.api.getRecovery().find(x => x.reason === 'pre_guard_local')), originalLocal);
  assert.deepEqual(clone(again.api.getRecovery().filter(x => x.reason === 'legacy_outbox')), [originalOutbox]);
});

test('a distinct legacy outbox identity archives its own input only after durable retention succeeds', async () => {
  const recoveryKey = 'financial_save_recovery_v2'; let rejectRecovery = false, reads = 0;
  const f = fixture({ writeVerified: key => !(rejectRecovery && key.startsWith(RECOVERY_PREFIX)),
    read: async keys => { reads++; return { rows: keys.map(key => clone(f.database.get(key))) }; } });
  f.storage.set('op_outbox', JSON.stringify([{ key: DAILY, attempts: 1, lastErr: 'Old input', ts: 1 }]));
  await f.api.refresh([DAILY]);
  const first = clone(f.api.getRecovery().find(x => x.reason === 'legacy_outbox'));
  const originalLocal = clone(f.api.getRecovery().find(x => x.reason === 'pre_guard_local'));
  const nextInput = initial()[DAILY]; nextInput['2026-10-01'].event = 'New unsent input';
  f.storage.set(DAILY, JSON.stringify(nextInput));
  f.context._outboxAdd(DAILY, 'A separate offline write');
  const nextOutbox = JSON.parse(f.storage.get('op_outbox'));
  const beforeFailure = recoveryText(f.storage); rejectRecovery = true;
  await assert.rejects(f.api.refresh([DAILY]), /financial_recovery_storage_failed/);
  assert.equal(reads, 1); assert.equal(f.commits.length, 0);
  assert.equal(recoveryText(f.storage), beforeFailure);
  assert.deepEqual(JSON.parse(f.storage.get(DAILY)), nextInput);
  assert.deepEqual(JSON.parse(f.storage.get('op_outbox')), nextOutbox);
  rejectRecovery = false; await f.api.refresh([DAILY]);
  assert.deepEqual(clone(f.api.getRecovery().filter(x => x.reason === 'legacy_outbox')), [first,
    { reason: 'legacy_outbox', key: DAILY, value: nextInput, outbox: nextOutbox[0] }]);
  assert.deepEqual(clone(f.api.getRecovery().find(x => x.reason === 'pre_guard_local')), originalLocal);
  const afterCapture = recoveryText(f.storage);
  f.storage.set(DAILY, JSON.stringify(initial()[DAILY]));
  await f.api.refresh([DAILY]);
  assert.equal(recoveryText(f.storage), afterCapture);
});

test('recovery storage exhaustion refuses dispatch and preserves the entered form and previous recovery', async () => {
  let rejectRecovery = false;
  const recoveryKey = 'financial_save_recovery_v2';
  const f = fixture({ writeVerified: key => !(rejectRecovery && key.startsWith(RECOVERY_PREFIX)) });
  await f.context.openDayMemo('F01', '2026-10-01', '木');
  const previous = recoveryText(f.storage);
  f.set('dm-memo', 'Retain visible input on quota failure'); rejectRecovery = true;
  await f.context.saveDayMemo('F01', '2026-10-01');
  assert.equal(f.commits.length, 0);
  assert.equal(recoveryText(f.storage), previous);
  assert.equal(f.fields.get('dm-memo').value, 'Retain visible input on quota failure');
  assert.equal(f.fields.get('dm-memo').disabled, false);
  assert.equal(f.effects.includes('close'), false);
  assert.equal(f.toasts.some(x => x.kind === 'success'), false);
});

test('bulk restore never claims durable retention when recovery storage rejects the candidate', async () => {
  let rejectRecovery = false;
  const recoveryKey = 'financial_save_recovery_v2';
  const f = fixture({ writeVerified: key => !(rejectRecovery && key.startsWith(RECOVERY_PREFIX)) });
  await f.api.refresh([BUDGET]); const previous = recoveryText(f.storage);
  const result = await f.api.restoreBudgets([{ storeId: 'F01', actual: 987 }], {
    mode: 'overwrite', confirm: () => { rejectRecovery = true; return true; }
  });
  assert.equal(result.error, 'financial_recovery_storage_failed');
  assert.equal(f.commits.length, 0); assert.equal(recoveryText(f.storage), previous);
  assert.equal(f.toasts.some(x => x.message.includes('保管しています')), false);
  assert.equal(f.toasts.some(x => x.message.includes('保管も確認できません')), true);
  assert.equal(f.toasts.some(x => x.kind === 'success'), false);
});

test('delayed actual IndexedDB reader is archived before canonical reads or any protected local overwrite', async () => {
  const gate = deferred(); let reads = 0;
  const f = fixture({
    beforeInstall: context => vm.runInContext("var _idbState='init', _IDB_MEM=null;\n"
      + source.match(/^function _lsRaw\(key, def\).*$/m)[0] + '\n' + webFunction('_lsStoreGet'), context),
    awaitLocalReady: async context => { await gate.promise; return context._idbState === 'ready'; },
    read: async keys => {
      reads++;
      const archived = f.api.getRecovery().find(x => x.reason === 'pre_guard_local');
      assert.equal(archived.value[DAILY]['2026-10-01'].event, 'Only in hydrated IndexedDB');
      return { rows: keys.map(key => clone(f.database.get(key))) };
    }
  });
  const reading = f.api.refresh([DAILY, BUDGET]); await settle();
  assert.equal(reads, 0); assert.equal(f.api.getRecovery().some(x => x.reason === 'pre_guard_local'), false);
  assert.equal(f.context._lsWriteVerified(DAILY, JSON.stringify({ cloud: 'too early' })), false);
  assert.equal(f.context._lsRawDel(DAILY), false);
  assert.equal(JSON.parse(f.storage.get(DAILY))['2026-10-01'].event, 'Before');
  assert.equal(f.context._lsWriteVerified('unrelated', JSON.stringify({ allowed: true })), true);
  f.context._IDB_MEM = new Map([[DAILY, JSON.stringify({ '2026-10-01': { actual: 999, event: 'Only in hydrated IndexedDB' } })]]);
  f.context._idbState = 'ready'; gate.resolve(); await reading;
  assert.equal(reads, 1); assert.equal(f.api.getRecovery().filter(x => x.reason === 'pre_guard_local').length, 1);
  assert.equal(f.context._lsWriteVerified(DAILY, JSON.stringify({ archived: 'safe to replace' })), true);
});

test('storage hydration failure blocks reads, automatic saves and restores without marking a fallback archive complete', async () => {
  let reads = 0, fetched = 0;
  const f = fixture({ awaitLocalReady: async () => false,
    read: async () => { reads++; throw new Error('must not read'); },
    fetchToastSales: async () => { fetched++; throw new Error('must not fetch'); } });
  await assert.rejects(f.api.refresh([DAILY]), /financial_local_unverified/);
  const sync = await f.context.syncStoreActualsFromToast('F01', 'guid', [{ date: '2026-10-01' }]);
  assert.ok(sync.error);
  const restored = await f.api.restoreBudgets([{ storeId: 'F01', actual: 999 }]);
  assert.equal(restored.error, 'financial_local_unverified');
  assert.equal(reads, 0); assert.equal(fetched, 0); assert.equal(f.commits.length, 0);
  assert.equal(f.api.getRecovery().some(x => x.reason === 'pre_guard_local'), false);
  assert.equal(f.context._lsWriteVerified(DAILY, '{}'), false);
  assert.equal(f.context._lsRawDel(BUDGET), false);
  assert.equal(f.context._lsWriteVerified('unrelated', '{"preserved":true}'), true);
  assert.equal(f.toasts.some(x => x.message.includes('送信を停止')), true);
  assert.equal(f.toasts.some(x => x.kind === 'success'), false);
});

// ---- v1104: a used device's localStorage is full (production keeps ~4.4M chars there). v1101-v1103 kept the
// recovery log under '_financial_save_recovery_v1'; keys starting with '_' never go to IndexedDB, so the
// pre-guard archive (all local sales/budget rows) could not be written and the guard stayed closed: no fresh rows
// on the device, no input screens, no saves. These tests run the app's real storage helpers.
// disk = what IndexedDB has on disk (shared by tabs of one device); each tab has its own _IDB_MEM loaded from it.
// _idbFlush() puts this tab's queue on disk (what the real one does once its transaction completes);
// opts.holdFlush keeps the queue in memory (a page killed before the write reached disk).
function realStorage(context, storage, limit, disk = new Map(), opts = {}) {
  const used = () => [...storage].reduce((n, [k, v]) => n + k.length + v.length, 0);
  context.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, val) => {
      const next = used() - (storage.has(key) ? key.length + storage.get(key).length : 0) + key.length + String(val).length;
      if (next > limit) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      storage.set(key, String(val));
    },
    removeItem: key => storage.delete(key)
  };
  context.__disk = disk; context.__opts = opts;
  vm.runInContext("var _idbState='ready', _IDB_MEM=new Map(__disk), _idbQ=new Map(), _idbTimer=null; function _lskBump(){}\n"
    + "function _idbFlush(){ if(__opts.holdFlush) return; _idbQ.forEach(function(v,k){ if(v===null) __disk.delete(k); else __disk.set(k,v); }); _idbQ=new Map(); }\n"
    + "function _idbFlushP(){ if(__opts.failPersist) return Promise.resolve(false); _idbFlush(); return Promise.resolve(!__opts.holdFlush); }\n"
    + "function _idbReloadPrefix(p){ _idbFlush(); Array.from(_IDB_MEM.keys()).forEach(function(k){ if(String(k).indexOf(p)===0&&!__disk.has(k)&&!_idbQ.has(k)) _IDB_MEM.delete(k); });"
    + " __disk.forEach(function(v,k){ if(String(k).indexOf(p)===0&&!_idbQ.has(k)) _IDB_MEM.set(k,v); }); return Promise.resolve(true); }\n"
    + source.match(/^var LS_DEVICE_LOCAL = .*$/m)[0] + '\n' + source.match(/^var _IDB_WATCH = .*$/m)[0] + '\n' + source.match(/^var _idbGen = .*$/m)[0] + '\n'
    + ['lsIsDeviceLocal', '_idbQueue', '_idbWatched', '_lsStoreGet', '_lsWriteVerified', 'financialRecoveryStore'].map(webFunction).join('\n') + '\n'
    + source.match(/^function _lsRaw\(key, def\).*$/m)[0] + '\n'
    + "function _lsRawDel(key){ try{ _idbQueue(key, null); }catch(e){} try{ localStorage.removeItem(key); return true; }catch(e){ return false; } }", context);
}
const fullDevice = () => {
  const storage = new Map(Object.entries(initial()).map(([key, value]) => [key, JSON.stringify(value)]));
  storage.set('other_data', 'x'.repeat(5000));
  return storage;
};

test('v1104: a used device with full localStorage archives into IndexedDB, then refreshes and saves', async () => {
  const storage = fullDevice();
  const limit = [...storage].reduce((n, [k, v]) => n + k.length + v.length, 0) + 200;   // no room for the archive
  const f = fixture({ storage, beforeInstall: context => realStorage(context, storage, limit), awaitLocalReady: async () => true });
  const rows = await f.api.refresh(ids.flatMap(id => ['daily_actuals_' + id, 'spl_budgets_v2_' + id]));
  assert.equal(rows.get(DAILY).exists, true);
  const archived = f.api.getRecovery().find(x => x.reason === 'pre_guard_local');
  assert.equal(archived.archive, 'financial_pre_guard_archive_v1');
  assert.deepEqual(clone(archived.value[DAILY]), initial()[DAILY]);
  assert.equal([...f.context._IDB_MEM.keys()].some(k => k.startsWith(RECOVERY_PREFIX)), true);
  assert.equal([...storage.keys()].some(k => k.startsWith(RECOVERY_PREFIX) || k === 'financial_pre_guard_archive_v1'), false, 'the log and the archive stay out of localStorage');
  assert.equal(f.context._IDB_MEM.has('financial_pre_guard_archive_v1'), true);
  assert.equal(storage.has('_financial_save_recovery_v1'), false);
  // the fence opened: fresh cloud rows can be written to the device again
  assert.equal(f.context._lsWriteVerified(DAILY, JSON.stringify({ '2026-10-02': { actual: 7 } })), true);
  await f.context.openDayMemo('F01', '2026-10-01', '木'); f.set('dm-memo', 'Saved on a full device');
  await f.context.saveDayMemo('F01', '2026-10-01');
  assert.equal(f.commits.length, 1);
  assert.equal(f.database.get(DAILY).value['2026-10-01'].event, 'Saved on a full device');
  assert.equal(f.toasts.filter(x => x.kind === 'success').length, 1);
  assert.equal(f.toasts.some(x => x.kind === 'warning'), false);
});

test('v1104: a v1101-v1103 recovery log on the device moves once into the new key without losing entries', async () => {
  const storage = fullDevice();
  const old = [{ reason: 'unversioned_write', key: DAILY, value: { '2026-10-01': { actual: 5 } } },
    { reason: 'committed_receipt', requestId: '00000000-0000-4000-8000-000000000999', receipt: { status: 'committed' } }];
  storage.set('_financial_save_recovery_v1', JSON.stringify(old));
  const disk = new Map();
  const f = fixture({ storage, beforeInstall: context => realStorage(context, storage, 1e9, disk), awaitLocalReady: async () => true });
  await f.api.refresh([DAILY]);
  const records = clone(f.api.getRecovery());
  assert.deepEqual(records.slice(0, 2), old);
  assert.equal(storage.has('_financial_save_recovery_v1'), false);
  const again = fixture({ storage, database: f.database, receipts: f.receipts, beforeInstall: context => realStorage(context, storage, 1e9, disk), awaitLocalReady: async () => true });
  await again.api.refresh([DAILY]);
  assert.deepEqual(clone(again.api.getRecovery()), records);
});

test('v1104: legacy writes refused before device storage is readable wait in memory and are recorded once it is', async () => {
  const gate = deferred(); const storage = fullDevice();
  const f = fixture({ storage, beforeInstall: context => realStorage(context, storage, 1e9),
    awaitLocalReady: async () => { await gate.promise; return true; } });
  await f.context.supaUpsert('app_state', [{ key: DAILY, value: { '2026-10-09': { actual: 9 } } }]);
  assert.equal([...f.context._IDB_MEM.keys()].some(k => k.startsWith(RECOVERY_PREFIX)), false);
  assert.equal(recoveryKeys(storage).length, 0);
  assert.equal(f.api.getState().hasRecovery, true);
  const reading = f.api.refresh([DAILY]); gate.resolve(); await reading;
  const kept = f.api.getRecovery().filter(x => x.reason === 'unversioned_write');
  assert.deepEqual(clone(kept), [{ reason: 'unversioned_write', key: DAILY, value: { '2026-10-09': { actual: 9 } } }]);
});

test('v1104: reads hand out independent values without changing what a budget save sends', async () => {
  const f = fixture();
  await f.api.refresh(ids.flatMap(id => ['daily_actuals_' + id, 'spl_budgets_v2_' + id]));
  const a = f.context.getDailyActuals('F01'); a['2026-10-01'].actual = -1;
  assert.equal(f.context.getDailyActuals('F01')['2026-10-01'].actual, 100);
  const b = f.context.getBudgets(); b.find(x => x.storeId === 'F01').actual = -2;
  assert.equal(f.context.getBudgets().find(x => x.storeId === 'F01').actual, 100);
  assert.equal(f.database.get(DAILY).value['2026-10-01'].actual, 100);
  // unchanged budgets are not staged; the changed store is the only write
  await f.context.openDailyActualModal('F01', '2026-10-01', '木');
  f.set('da-actual', '345');
  await f.context.saveDailyActual('F01', '2026-10-01');
  assert.equal(f.commits.length, 1);
  assert.deepEqual(Object.keys(f.commits[0].writes).sort(), [DAILY, BUDGET].sort());
  assert.equal(f.commits[0].writes[BUDGET][0].actual, 345);
});

test('v1104: local budgets are parsed once per stored text, handed out fresh, and re-read when the device row changes', async () => {
  let parses = 0; const storage = new Map();
  const f = fixture({ storage, beforeInstall: context => {
    const ls = context.ls; context.ls = (key, fallback) => { if (key === 'budgets_v2') parses++; return ls(key, fallback); };
    context.lsKeys = prefix => [...storage.keys()].filter(k => k.startsWith(prefix));
  } });
  // no server rows yet: everything comes from the device
  const first = f.context.getBudgets(); assert.equal(parses, 1);
  first.find(b => b.storeId === 'F01').actual = -5;
  const second = f.context.getBudgets(); assert.equal(parses, 1);
  assert.equal(second.find(b => b.storeId === 'F01').actual, 100);
  f.storage.set(BUDGET, JSON.stringify([{ ...initial()[BUDGET][0], actual: 222 }]));
  assert.equal(f.context.getBudgets().find(b => b.storeId === 'F01').actual, 222); assert.equal(parses, 2);
  // with server rows the canonical row wins, and local parts are not re-parsed while the text is unchanged
  await f.api.refresh([BUDGET]);
  assert.equal(f.context.getBudgets().find(b => b.storeId === 'F01').actual, 100);
  assert.equal(parses, 2);
});

// ---- v1104 independent review (4e573bb): P1 two tabs overwrote the one recovery log; P2 a save killed right after
// tapping lost its request; P2 the v1101-v1103 log was deleted before the new one was on disk; P2 the one-time
// archive checked the size of all rows together. The log is now one key per record, kept in IndexedDB only.
const ALL = ids.flatMap(id => ['daily_actuals_' + id, 'spl_budgets_v2_' + id]);
function device() {
  const storage = new Map(Object.entries(initial()).map(([k, v]) => [k, JSON.stringify(v)]));
  const database = new Map(Object.entries(initial()).map(([key, value]) => [key, { key, value, exists: true, version: BASE }]));
  database.set('daily_actuals_F02', { key: 'daily_actuals_F02', value: { '2026-10-01': { actual: 1 } }, exists: true, version: BASE });
  return { storage, database, disk: new Map([...storage]), receipts: new Map() };
}
const onDisk = (disk, text) => [...disk].some(([k, v]) => k.startsWith(RECOVERY_PREFIX) && v.includes(text));

test('v1104 review P1: another tab no longer overwrites the recovery log; a reload finds the first tab\'s unsent save', async () => {
  const d = device(); let offline = true;
  const tab = (opts = {}) => fixture({ storage: d.storage, database: d.database, receipts: d.receipts, awaitLocalReady: async () => true,
    beforeInstall: c => realStorage(c, d.storage, 1e9, d.disk, opts),
    commit: (req, answer) => offline ? Promise.reject(new Error('offline')) : answer(req) });
  const A = tab(); await A.api.refresh(ALL);
  const B = tab(); await B.api.refresh(ALL);   // B was opened before A saved: its copy of the device does not have A's record
  await A.context.openDayMemo('F01', '2026-10-01', '木'); A.set('dm-memo', 'Tab A unsent memo');
  assert.equal(await A.context.saveDayMemo('F01', '2026-10-01'), false);
  assert.equal(A.api.getState().status, 'unknown');
  assert.equal(onDisk(d.disk, 'Tab A unsent memo'), true);
  // B records something of its own (a refused old-style write) and then tries to save: it reads the device first
  await B.context.supaUpsert('app_state', [{ key: 'daily_actuals_F02', value: { '2026-10-09': { actual: 9 } } }]);
  offline = false;
  assert.equal(await B.context.openDayMemo('F02', '2026-10-01', '木'), false, 'B sees A\'s unresolved save and waits for it');
  assert.equal(B.api.getState().status, 'unknown'); assert.equal(B.commits.length, 0);
  assert.equal(onDisk(d.disk, 'Tab A unsent memo'), true, 'A\'s record is still on the device');
  // reload: the unsent save is there and can be sent once, with the same request id
  const C = tab();
  await assert.rejects(C.api.refresh([DAILY]), /financial_unresolved_save/);
  assert.equal(C.api.getState().status, 'unknown');
  assert.equal(await C.api.reconcile(), false, 'nothing reached the server');
  assert.equal(await C.api.retry(), true);
  assert.equal(d.database.get(DAILY).value['2026-10-01'].event, 'Tab A unsent memo');
  assert.equal(C.commits[0].requestId, A.commits[0].requestId);
  assert.equal(onDisk(d.disk, '"pending_request"'), false);
  // both tabs' own records survive
  const D = tab(); await D.api.refresh(ALL);
  assert.equal(D.api.getRecovery().some(x => x.reason === 'unversioned_write' && x.key === 'daily_actuals_F02'), true);
  assert.equal(D.api.getState().status, 'idle');
  // the stale first tab still believes the save is open, but writing its own records does not bring it back
  await A.context.supaUpsert('app_state', [{ key: DAILY, value: { '2026-10-09': { actual: 4 } } }]);
  const E = tab(); await E.api.refresh(ALL);
  assert.equal(E.api.getState().status, 'idle', 'a resolved save is not resurrected by an older tab');
  assert.equal(await A.api.reconcile(), true, 'the stale tab finds the receipt');
});

test('v1104 review P2: the request is on the device before it is sent, also when the page is closed right after', async () => {
  for (const limit of [1e9, 3000]) {
    const d = device(); let sentAfterDisk = null;
    const f = fixture({ storage: d.storage, database: d.database, awaitLocalReady: async () => true,
      beforeInstall: c => realStorage(c, d.storage, limit, d.disk),
      commit: req => { sentAfterDisk = onDisk(d.disk, req.requestId); return Promise.reject(new Error('offline')); } });
    await f.api.refresh(ALL);
    await f.context.openDayMemo('F01', '2026-10-01', '木'); f.set('dm-memo', 'Entered then app killed');
    await f.context.saveDayMemo('F01', '2026-10-01');
    assert.equal(sentAfterDisk, true, 'limit ' + limit);
    // the page is gone: a new page reads only what is on the device
    const C = fixture({ storage: d.storage, database: d.database, awaitLocalReady: async () => true, beforeInstall: c => realStorage(c, d.storage, limit, new Map(d.disk)) });
    await assert.rejects(C.api.refresh([DAILY]), /financial_unresolved_save/);
    assert.equal(JSON.stringify(C.api.getRecovery()).includes('Entered then app killed'), true);
    assert.equal(C.api.getState().status, 'unknown');
  }
});

test('v1104 review P2: when the device cannot store the request, nothing is sent and the entered memo stays', async () => {
  const d = device(), opts = {};
  const f = fixture({ storage: d.storage, database: d.database, awaitLocalReady: async () => true, beforeInstall: c => realStorage(c, d.storage, 1e9, d.disk, opts) });
  await f.api.refresh(ALL);
  await f.context.openDayMemo('F01', '2026-10-01', '木'); f.set('dm-memo', 'Keep me');
  opts.failPersist = true;
  assert.equal(await f.context.saveDayMemo('F01', '2026-10-01'), false);
  assert.equal(f.commits.length, 0);
  assert.equal(f.fields.get('dm-memo').value, 'Keep me'); assert.equal(f.effects.includes('close'), false);
  assert.equal(f.api.getRecovery().some(x => x.reason === 'pending_request'), false, 'a request that was never sent is not left to be replayed');
  assert.equal(f.api.getState().status, 'idle');
  opts.failPersist = false;
  await f.context.openDayMemo('F01', '2026-10-01', '木'); f.set('dm-memo', 'Keep me');
  assert.notEqual(await f.context.saveDayMemo('F01', '2026-10-01'), false);
  assert.equal(f.database.get(DAILY).value['2026-10-01'].event, 'Keep me');
});

test('v1104 review P2: the v1101-v1103 log is removed only after the new records are on the device', async () => {
  const d = device();
  const old = [{ reason: 'conflict', request: { requestId: '00000000-0000-4000-8000-999999999999', writes: { [DAILY]: { memo: 'v1103 conflict draft' } } } },
    { reason: 'pre_guard_local', value: { [DAILY]: { '2026-09-01': { actual: 77, event: 'Before the guard' } } } }];
  d.storage.set('_financial_save_recovery_v1', JSON.stringify(old));
  const limit = [...d.storage].reduce((n, [k, v]) => n + k.length + v.length, 0) + 50;   // full
  const opts = { holdFlush: true };   // the first boot is killed before anything reaches the device
  const A = fixture({ storage: d.storage, database: d.database, awaitLocalReady: async () => true, beforeInstall: c => realStorage(c, d.storage, limit, d.disk, opts) });
  await assert.rejects(A.api.refresh([DAILY]), /financial_recovery_storage_failed/);
  assert.equal(d.storage.has('_financial_save_recovery_v1'), true, 'the old log is kept');
  const C = fixture({ storage: d.storage, database: d.database, awaitLocalReady: async () => true, beforeInstall: c => realStorage(c, d.storage, limit, d.disk) });
  await C.api.refresh([DAILY]);
  assert.equal(JSON.stringify(C.api.getRecovery()).includes('v1103 conflict draft'), true);
  assert.equal(d.storage.has('_financial_save_recovery_v1'), false, 'removed once the new records are on the device');
  assert.equal(onDisk(d.disk, 'v1103 conflict draft'), true);
  // P3: the large value from before the guard moves out of the log into its own key, and is still shown
  const marker = [...d.disk].filter(([k]) => k.startsWith(RECOVERY_PREFIX)).map(([, v]) => JSON.parse(v)).find(x => x.reason === 'pre_guard_local');
  assert.deepEqual(marker, { reason: 'pre_guard_local', archive: 'financial_pre_guard_archive_v1', keys: [DAILY] });
  assert.equal(C.api.getRecovery().find(x => x.reason === 'pre_guard_local').value[DAILY]['2026-09-01'].event, 'Before the guard');
  // a second boot does not add anything
  const before = recoveryText(d.disk);
  const E = fixture({ storage: d.storage, database: d.database, awaitLocalReady: async () => true, beforeInstall: c => realStorage(c, d.storage, limit, d.disk) });
  await E.api.refresh([DAILY]);
  assert.equal(recoveryText(d.disk), before);
});

test('v1104 review P2: a device whose rows add up to more than 200,000 values still archives and opens the fence', async () => {
  const d = device();
  const day = i => ({ actual: i, guests: 10, lunchSales: 1, dinnerSales: 2, lunchGuests: 3, dinnerGuests: 4, bowls: 5, takeout: 6, foodCost: 7, by: 'x', at: 'y', toastSrc: true, creditTip: 1, cashTip: 2, event: '', weather: '' });
  for (const id of ids.slice(0, 9)) { const o = {}; for (let i = 0; i < 1400; i++) o['d' + i] = day(i); d.storage.set('daily_actuals_' + id, JSON.stringify(o)); }
  d.disk = new Map([...d.storage]);
  const f = fixture({ storage: d.storage, database: d.database, awaitLocalReady: async () => true, beforeInstall: c => realStorage(c, d.storage, 1e9, d.disk) });
  await f.api.refresh(ALL);
  assert.equal(f.context._lsWriteVerified(DAILY, '{}'), true, 'the fence is open');
  assert.notEqual(await f.context.openDayMemo('F01', '2026-10-01', '木'), false);
  assert.equal(Object.keys(f.api.getRecovery().find(x => x.reason === 'pre_guard_local').value).length, 10);   // 9 stores' sales + F01's budget
});

test('v1104: the real IndexedDB helpers wait for the write to reach the device and see other tabs', async () => {
  const { IDBFactory, IDBKeyRange } = await import('./runtime/node_modules/fake-indexeddb/build/esm/index.js');
  const factory = new IDBFactory();
  const names = ['_idbAvailable', '_idbOpen', '_idbLoadAll', '_idbWatched', '_idbTrack', '_idbWriteBatch', '_idbFlush', '_idbRequeue', '_idbFlushP', '_idbReopen', '_idbReloadPrefix', '_idbQueue', 'lsIsDeviceLocal', 'financialRecoveryStore'];
  const boot = async () => {
    const c = vm.createContext({ indexedDB: factory, IDBKeyRange, setTimeout, clearTimeout, Promise, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, console });
    vm.runInContext("var IDB_NAME='funergy_os_kv', IDB_STORE='kv', IDB_VER=1, _idbDB=null, _idbState='init', _IDB_MEM=null, _idbQ=new Map(), _idbTimer=null, _idbStat={loaded:0,wrote:0,failed:0,backfilled:0,at:''};\n"
      + "function _lskBump(){} function _lsNoteSaveFailure(){}\n" + source.match(/^var LS_DEVICE_LOCAL = .*$/m)[0] + '\n' + source.match(/^var _idbInflight = .*$/m)[0] + '\n'
      + source.match(/^var _IDB_WATCH = .*$/m)[0] + '\n' + source.match(/^var _idbGen = .*$/m)[0] + '\n' + source.match(/^var _idbReopening = .*$/m)[0] + '\n'
      + names.map(webFunction).join('\n'), c);
    await c._idbOpen(); c._IDB_MEM = await c._idbLoadAll(); c._idbState = 'ready';
    return c;
  };
  const A = await boot(), B = await boot();
  const sa = A.financialRecoveryStore(), sb = B.financialRecoveryStore();
  const K = RECOVERY_PREFIX + '0001', K2 = RECOVERY_PREFIX + '0002';
  assert.equal(sa.set(K, '{"reason":"a"}'), true);
  assert.equal(await sa.persist(), true);
  // what is on the device now: a fresh page sees it
  const C = await boot(); assert.equal(C._IDB_MEM.get(K), '{"reason":"a"}');
  // B was opened before: it sees A's record only after reading the device again
  assert.equal(sb.get(K), null);
  assert.equal(await sb.reload(RECOVERY_PREFIX), true); assert.equal(sb.get(K), '{"reason":"a"}');
  // a record B has not written out yet is kept while B reads the device
  sb.set(K2, '{"reason":"b"}'); A.financialRecoveryStore().del(K); await sa.persist();
  assert.equal(await sb.reload(RECOVERY_PREFIX), true);
  assert.equal(sb.get(K), null, 'a record deleted in another tab goes away');
  assert.equal(sb.get(K2), '{"reason":"b"}');
  assert.equal(await sb.persist(), true);
  const D = await boot(); assert.equal(D._IDB_MEM.get(K2), '{"reason":"b"}'); assert.equal(D._IDB_MEM.has(K), false);
  // a page without IndexedDB cannot claim the write reached the device
  const E = await boot(); E._idbState = 'unavailable'; assert.equal(await E.financialRecoveryStore().persist(), false);
});

// ---- v1104 second independent review (bc1fdb2): P1 a reload racing this tab's own write dropped a record (orphan
// requests, an overwritten pre-guard archive); P1 two tabs moving the old log stored it twice (blocked for good);
// P2 a tab kept another tab's finished save; P3 unrelated write failures / lost connection refused saves.
// These run the app's real IndexedDB layer on fake-indexeddb: one factory = one device, one vm context = one tab.
const { IDBFactory: FakeIDBFactory, IDBKeyRange: FakeIDBKeyRange } = await import('./runtime/node_modules/fake-indexeddb/build/esm/index.js');
const varLine = re => source.match(re)[0].replace(/\r$/, '');
const IDB_CODE = [/^var IDB_NAME = .*$/m, /^var _idbDB = .*$/m, /^var _idbState = .*$/m, /^var _IDB_MEM = .*$/m, /^var _idbQ = .*$/m, /^var _idbTimer = .*$/m,
  /^var _idbStat = .*$/m, /^var _idbInflight = .*$/m, /^var _IDB_WATCH = .*$/m, /^var _idbGen = .*$/m, /^var _idbReopening = .*$/m, /^var LS_DEVICE_LOCAL = .*$/m].map(varLine)
  .concat(['_idbAvailable', '_idbOpen', '_idbLoadAll', '_idbWatched', '_idbTrack', '_idbWriteBatch', '_idbFlush', '_idbFlushP', '_idbReopen', '_idbReloadPrefix',
    'financialRecoveryStore', '_idbRequeue', '_idbQueue', '_idbBackfill', '_idbBoot', 'lsIsDeviceLocal', '_lsStoreGet', '_lsRawStr', '_lsRawDel', '_lsWriteVerified'].map(webFunction),
  [varLine(/^function _lsRaw\(key, def\).*$/m), 'function _lskBump(){} function _lsNoteSaveFailure(){}',
    'function lsKeys(p){ p=p||""; var s=new Set(); for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k&&k.indexOf(p)===0) s.add(k);} if(_idbState==="ready"&&_IDB_MEM) _IDB_MEM.forEach(function(v,k){ if(String(k).indexOf(p)===0) s.add(k); }); return Array.from(s); }',
    "var _idbBootP = new Promise(function(res){ setTimeout(function(){ try{ Promise.resolve(_idbBoot()).then(res, res); }catch(e){ res(); } }, 0); });",
    "var __ready = async function(){ await Promise.resolve().then(function(){return _idbBootP;}); return _idbState==='ready' && _IDB_MEM instanceof Map; };"]).join('\n');
const lsObject = map => ({ getItem: k => map.has(k) ? map.get(k) : null, setItem: (k, v) => { map.set(k, String(v)); }, removeItem: k => { map.delete(k); },
  key: i => [...map.keys()][i] ?? null, get length() { return map.size; } });
function sharedLocks() {
  const queues = new Map(); let held = 0;
  return { get held() { return held; }, request(name, a, b) {
    const cb = typeof a === 'function' ? a : b, signal = typeof a === 'function' ? null : a?.signal;
    return new Promise((resolve, reject) => {
      const q = queues.get(name) || []; queues.set(name, q); let started = false;
      const run = async () => { started = true; held++; try { resolve(await cb({ name })); } catch (e) { reject(e); } finally { held--; q.shift(); if (q.length) q[0](); } };
      signal?.addEventListener('abort', () => { if (started) return; q.splice(q.indexOf(run), 1); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
      q.push(run); if (q.length === 1) run();
    });
  } };
}
function idbDevice({ locks = false } = {}) {
  const rows = initial();
  return { ls: new Map(Object.entries(rows).map(([k, v]) => [k, JSON.stringify(v)])), factory: new FakeIDBFactory(), locks: locks ? sharedLocks() : null, receipts: new Map(),
    database: new Map(Object.entries(rows).map(([key, value]) => [key, { key, value, exists: true, version: BASE }])) };
}
function idbTab(dev, extra = {}) {
  return fixture({ storage: dev.ls, database: dev.database, receipts: dev.receipts, deferStartup: true, ...extra,
    beforeInstall: c => {
      c.crypto = { randomUUID: () => globalThis.crypto.randomUUID() }; c.indexedDB = dev.factory; c.IDBKeyRange = FakeIDBKeyRange; c.localStorage = lsObject(dev.ls);
      c.addEventListener = () => {}; c.AbortSignal = AbortSignal;
      if (dev.locks) c.navigator = { locks: dev.locks };
      vm.runInContext(IDB_CODE, c);
      if (extra.faults) c._idbBootP.then(() => { const db = c._idbDB, orig = db.transaction.bind(db);
        db.transaction = (...a) => { if (extra.faults.throwOnTx?.()) { const e = new Error('lost'); e.name = 'InvalidStateError'; throw e; } const tx = orig(...a); extra.faults.onTx?.(tx, a[1]); return tx; }; });
      extra.beforeInstall?.(c);
    },
    awaitLocalReady: c => c.__ready() });
}
function diskOf(factory, prefix) {
  return new Promise(res => { const rq = factory.open('funergy_os_kv', 1); rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => { const db = rq.result, out = new Map(), tx = db.transaction('kv', 'readonly'), cur = tx.objectStore('kv').openCursor();
      cur.onsuccess = () => { const c = cur.result; if (c) { if (String(c.key).startsWith(prefix)) out.set(c.key, c.value); c.continue(); } };
      tx.oncomplete = () => { db.close(); res(out); }; }; });
}
const diskRecs = async factory => [...await diskOf(factory, RECOVERY_PREFIX)].sort(([a], [b]) => a < b ? -1 : 1).map(([, v]) => JSON.parse(v));
const wait = ms => new Promise(r => setTimeout(r, ms));
const legacyPending = () => {
  const next = initial()[DAILY]; next['2026-10-01'].event = 'v1103 unanswered memo';
  return [{ reason: 'pre_guard_local', value: { [DAILY]: { '2026-09-01': { actual: 77, event: 'value from before the guard (v1101)' } } } },
    { reason: 'pending_request', request: { requestId: '00000000-0000-4000-8000-00000000abcd', expectedVersions: { [DAILY]: BASE },
      expected: { [DAILY]: { value: initial()[DAILY], updated_at: BASE } }, writes: { [DAILY]: next } },
      before: { [DAILY]: { key: DAILY, exists: true, value: initial()[DAILY], version: BASE } } }];
};

test('v1104 review 2 P1-1: a reload racing this tab\'s own write keeps the write (real IndexedDB layer)', { timeout: 20000 }, async () => {
  const dev = idbDevice(), A = idbTab(dev), c = A.context; await c.__ready();
  const OLD = RECOVERY_PREFIX + '0000000000001-a', NEW = RECOVERY_PREFIX + '0000000000002-b';
  c._idbQueue(OLD, '{"reason":"x"}'); assert.equal(await c._idbFlushP('financial_'), true);
  let r = c._idbReloadPrefix(RECOVERY_PREFIX); c._idbQueue(NEW, '{"reason":"y"}'); const p = c._idbFlushP('financial_');
  assert.equal(await r, true); assert.equal(await p, true);
  assert.equal(c._IDB_MEM.has(NEW), true, 'a record written during the reload stays');
  r = c._idbReloadPrefix(RECOVERY_PREFIX); c._idbQueue(OLD, null); await c._idbFlushP('financial_'); await r;
  assert.equal(c._IDB_MEM.has(OLD), false, 'a record deleted during the reload stays deleted');
  assert.deepEqual([...(await diskOf(dev.factory, RECOVERY_PREFIX)).keys()], [NEW]);
});

test('v1104 review 2 P1-1: a save overlapping another startup read leaves no stale request, even after 50 more saves', { timeout: 20000 }, async () => {
  const dev = idbDevice(); let race = false, A;
  A = idbTab(dev, { read: async keys => { if (race) { race = false; A.api.preserveLocal(); } return { rows: keys.map(k => clone(dev.database.get(k) || { key: k, exists: false, value: null, version: null })) }; } });
  await A.api.refresh(ALL); race = true;
  const r = await A.context.syncStoreActualsFromToast('F01', 'g', [{ date: '2026-10-01' }], [{ business_date: '2026-10-01', net_sales: 555 }]);
  assert.equal(r.updated, 1); await wait(30);
  assert.equal((await diskRecs(dev.factory)).some(x => x.reason === 'pending_request'), false);
  for (let i = 0; i < 50; i++) { await A.context.openDayMemo('F01', '2026-10-01', '木'); A.set('dm-memo', 'memo ' + i); await A.context.saveDayMemo('F01', '2026-10-01'); }
  await wait(30);
  const C = idbTab(dev); await C.api.refresh(ALL);
  assert.equal(C.api.getState().status, 'idle');
  assert.equal(C.context.getDailyActuals('F01')['2026-10-01'].event, 'memo 49');
});

test('v1104 review 2 P1-2: two tabs moving the old log store it once; the unanswered save is sent once', { timeout: 20000 }, async () => {
  for (const locks of [false, true]) {
    const dev = idbDevice({ locks }); dev.ls.set('_financial_save_recovery_v1', JSON.stringify(legacyPending()));
    const A = idbTab(dev), B = idbTab(dev);
    await Promise.allSettled([A.api.refresh(ALL), B.api.refresh(ALL)]); await wait(30);
    const disk = await diskRecs(dev.factory);
    assert.equal(disk.filter(x => x.reason === 'pending_request').length, 1, 'locks ' + locks);
    assert.equal(disk.filter(x => x.reason === 'pre_guard_local').length, 1);
    assert.equal(dev.ls.has('_financial_save_recovery_v1'), false);
    const C = idbTab(dev);
    await assert.rejects(C.api.refresh(ALL), /financial_unresolved_save/);
    assert.equal(C.api.getState().status, 'unknown');
    assert.equal(await C.api.retry(), true);
    assert.equal(dev.database.get(DAILY).value['2026-10-01'].event, 'v1103 unanswered memo');
    await C.api.refresh(ALL); assert.equal(C.api.getState().status, 'committed');
  }
});

test('v1104 review 2 P1-1: the archive from before the guard is never overwritten by a second startup caller', { timeout: 20000 }, async () => {
  const dev = idbDevice(); dev.ls.set('_financial_save_recovery_v1', JSON.stringify(legacyPending().slice(0, 1)));
  const A = idbTab(dev);
  await Promise.all([A.api.refresh(ALL), A.api.preserveLocal()]); await wait(30);
  const archive = (await diskOf(dev.factory, 'financial_pre_guard_archive_v1')).get('financial_pre_guard_archive_v1');
  assert.match(archive, /value from before the guard/);
  assert.equal((await diskRecs(dev.factory)).filter(x => x.reason === 'pre_guard_local').length, 1);
});

test('v1104 review 2 P2-1: a tab that saw another tab\'s save in flight lets go once it is finished', { timeout: 20000 }, async () => {
  const dev = idbDevice({ locks: true }); let gate;
  const A = idbTab(dev, { commit: (req, answer) => new Promise(r => { gate = () => r(answer(req)); }), timeoutMs: 5000 });
  const B = idbTab(dev, { timeoutMs: 5000 });
  await A.api.refresh(ALL); await B.api.refresh(ALL);
  await A.context.openDayMemo('F01', '2026-10-01', '木'); A.set('dm-memo', 'A in flight');
  const saving = A.context.saveDayMemo('F01', '2026-10-01'); await wait(30);
  assert.equal(await B.context.openDayMemo('F02', '2026-10-01', '木'), false);
  assert.match(B.toasts.at(-1).message, /前の保存の結果がまだ確認できていません/);
  gate(); await saving; await wait(30);
  assert.notEqual(await B.context.openDayMemo('F02', '2026-10-01', '木'), false, 'B opens again after A finished');
  assert.equal(B.api.getState().status, 'idle');
});

test('v1104 review 2 P3: an unrelated write that IndexedDB refuses does not refuse a sales save', { timeout: 20000 }, async () => {
  const dev = idbDevice(); let same = false, refuse = true;
  const faults = { onTx(tx, mode) { if (mode !== 'readwrite' || !refuse) return; const os = tx.objectStore.bind(tx);
    tx.objectStore = n => { const st = os(n), put = st.put.bind(st); st.put = (v, k) => { if (k === 'big_unrelated_cache') Promise.resolve().then(() => { try { tx.abort(); } catch (_) {} }); return put(v, k); }; return st; }; } };
  const A = idbTab(dev, { faults, beforeInstall: c => { const orig = c.saveDayMemo; c.saveDayMemo = function (...a) { if (same) c._lsWriteVerified('big_unrelated_cache', 'x'.repeat(1000)); return orig.apply(this, a); }; } });
  await A.api.refresh(ALL);
  A.context._lsWriteVerified('big_unrelated_cache', 'x');
  for (let i = 0; i < 4; i++) {
    same = i >= 2; await A.context.openDayMemo('F01', '2026-10-01', '木'); A.set('dm-memo', 'memo ' + i);
    assert.notEqual(await A.context.saveDayMemo('F01', '2026-10-01'), false, 'save ' + i); await wait(20);
  }
  assert.equal(A.commits.length, 4);
  refuse = false; clearTimeout(A.context._idbTimer); A.context._idbTimer = null;   // the app retries the refused write every 5 s; end it
});

test('v1104 review 2 P3: after the IndexedDB connection is lost, the next save reconnects instead of refusing', { timeout: 20000 }, async () => {
  const dev = idbDevice(); let lost = false;
  const A = idbTab(dev, { faults: { throwOnTx: () => lost } });   // only the lost connection throws; a new one works
  await A.api.refresh(ALL); lost = true;
  await A.context.openDayMemo('F01', '2026-10-01', '木'); A.set('dm-memo', 'after the connection was lost');
  assert.notEqual(await A.context.saveDayMemo('F01', '2026-10-01'), false);
  assert.equal(dev.database.get(DAILY).value['2026-10-01'].event, 'after the connection was lost');
  assert.equal((await diskRecs(dev.factory)).some(x => x.reason === 'committed_receipt'), true);
});

test('v1104 review 2 P3: two unanswered saves (no locks) are checked one after the other instead of blocking', { timeout: 20000 }, async () => {
  const dev = idbDevice(); let offline = true;
  const mk = () => idbTab(dev, { commit: (req, answer) => offline ? Promise.reject(new Error('offline')) : answer(req) });
  const A = mk(), B = mk(); await A.api.refresh(ALL); await B.api.refresh(ALL);
  await A.context.openDayMemo('F01', '2026-10-01', '木'); A.set('dm-memo', 'A offline');
  await B.context.openDayMemo('F02', '2026-10-01', '木'); B.set('dm-memo', 'B offline');
  await Promise.all([A.context.saveDayMemo('F01', '2026-10-01'), B.context.saveDayMemo('F02', '2026-10-01')]); await wait(30);
  assert.equal((await diskRecs(dev.factory)).filter(x => x.reason === 'pending_request').length, 2);
  offline = false;
  const C = mk();
  for (let i = 0; i < 2; i++) { await assert.rejects(C.api.refresh(ALL), /financial_unresolved_save/); assert.equal(await C.api.retry(), true); }
  await C.api.refresh(ALL);
  assert.equal(dev.database.get(DAILY).value['2026-10-01'].event, 'A offline');
  assert.equal(dev.database.get('daily_actuals_F02').value['2026-10-01'].event, 'B offline');
});

test('v1104 review 2 P3: a save does not wait for ever behind another tab; old prefetched Toast rows are read again', { timeout: 20000 }, async () => {
  const dev = idbDevice({ locks: true }); let gate;
  const A = idbTab(dev, { commit: (req, answer) => new Promise(r => { gate = () => r(answer(req)); }), timeoutMs: 5000 });
  const B = idbTab(dev, { timeoutMs: 5000, lockWaitMs: 50 });
  await A.api.refresh(ALL); await B.api.refresh(ALL);
  await A.context.openDayMemo('F01', '2026-10-01', '木'); A.set('dm-memo', 'A slow');
  const saving = A.context.saveDayMemo('F01', '2026-10-01'); await wait(20);
  const r = await B.context.syncStoreActualsFromToast('F02', 'g', [{ date: '2026-10-01' }], [{ business_date: '2026-10-01', net_sales: 9 }]);
  assert.ok(r.error); assert.match(B.toasts.at(-1).message, /ほかの画面（タブ）で売上・予算の保存が続いています/);
  gate(); await saving;
  // rows read more than 20 s before the save are read again inside it
  let fetched = 0; const stale = [{ business_date: '2026-10-01', net_sales: 1 }]; Object.defineProperty(stale, '_fetchedAt', { value: Date.now() - 60000 });
  const F = fixture({ fetchToastSales: async () => { fetched++; return [{ business_date: '2026-10-01', net_sales: 777 }]; } });
  await F.api.refresh(ALL);
  await F.context.syncStoreActualsFromToast('F01', 'g', [{ date: '2026-10-01' }], stale);
  assert.equal(fetched, 1); assert.equal(F.database.get(DAILY).value['2026-10-01'].actual, 777);
});

test('v1105: when the guard cannot read the latest rows for an automatic sales import, the app is told and may keep it quiet', async () => {
  for (const quiet of [true, false]) {
    const told = []; let failRead = false;
    const database = new Map(Object.entries(initial()).map(([key, value]) => [key, { key, value, exists: true, version: BASE }]));
    const f = fixture({ database, onAutoRefused: (name, args) => { told.push([name, args[0]]); return quiet; },
      read: async keys => { if (failRead) throw new Error('down'); return { rows: keys.map(key => database.has(key) ? clone(database.get(key)) : { key, exists: false, value: null, version: null }) }; } });
    await f.api.refresh(ALL); failRead = true;
    const before = f.toasts.length;
    const r = await f.context.syncStoreActualsFromToast('F01', 'g', [{ date: '2026-10-01' }], [{ business_date: '2026-10-01', net_sales: 9 }]);
    assert.ok(r.error); assert.equal(f.commits.length, 0);
    assert.deepEqual(told, [['syncStoreActualsFromToast', 'F01']]);
    assert.equal(f.toasts.length - before, quiet ? 0 : 1, 'quiet ' + quiet);
  }
});

// ===== v1107：答えが確かめられない保存で、売上・予算の読み込みと保存がすべて止まっていた（本番 10/24 の帯） =====
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const serverError = () => { const e = new Error('canceling statement due to statement timeout'); e.status = 500; e.code = '57014'; return e; };
const networkError = () => new TypeError('Failed to fetch');
async function until(check, ms = 2000) { const end = Date.now() + ms; while (Date.now() < end) { if (check()) return true; await sleep(5); } return check(); }
function seedStore(f, id) {
  f.database.set('daily_actuals_' + id, { key: 'daily_actuals_' + id, version: BASE, exists: true, value: {} });
  f.database.set('spl_budgets_v2_' + id, { key: 'spl_budgets_v2_' + id, version: BASE, exists: true, value: [{ storeId: id, actual: 0 }] });
}

test('v1107: an automatic Toast import whose save fails no longer stops the other stores and the budget read', async () => {
  // ログインの同期と同じ：F01 の保存がサーバーのエラーで返らない → 前は F01 が「結果不明」で残り、F02 の取り込みも予算の読み込みも止まっていた
  const f = fixture({ commit: (request, answer) => { if (request.writes.daily_actuals_F01) throw serverError(); return answer(request); } });
  seedStore(f, 'F02');
  const rows = [{ business_date: '2026-10-01', net_sales: 333 }];
  const [one, two] = await Promise.all([
    f.context.syncStoreActualsFromToast('F01', 'one', [{ date: '2026-10-01' }], rows),
    f.context.syncStoreActualsFromToast('F02', 'two', [{ date: '2026-10-01' }], rows)]);
  assert.equal(one.error !== undefined, true); assert.equal(one.code, 'http_500_57014');
  assert.equal(two.error, undefined); assert.equal(two.updated, 1);
  assert.equal(f.database.get('daily_actuals_F02').value['2026-10-01'].actual, 333);
  assert.equal(f.database.get(DAILY).value['2026-10-01'].actual, 100);   // F01 は書けていない（前の値のまま・0 にしない）
  const state = f.api.getState();
  assert.equal(state.status, 'committed'); assert.equal(state.released.store, 'F01'); assert.equal(state.released.why, 'http_500_57014');
  const all = await f.api.refresh(ids.flatMap(id => ['daily_actuals_' + id, 'spl_budgets_v2_' + id]));   // 予算・売上の読み込みは止まらない
  assert.equal(all.size, 20);
  const rec = f.api.getRecovery();
  assert.equal(rec.some(x => x.reason === 'pending_request'), false);   // 自動の保存の行の中身は残さない（印だけ）
  assert.equal(rec.filter(x => x.reason === 'auto_released').length, 1);
  // 次の取り込みは最新を読み直して送る（前の番号は使わない）
  const again = await f.context.syncStoreActualsFromToast('F01', 'one', [{ date: '2026-10-01' }], rows);
  assert.equal(again.code, 'http_500_57014'); assert.equal(f.api.getState().status, 'committed');
});

test('v1107: an automatic import whose answer was lost after the server wrote it is confirmed at once (no second write)', async () => {
  const f = fixture({ commit: (request, answer) => { answer(request); throw networkError(); } });
  const r = await f.context.syncStoreActualsFromToast('F01', 'one', [{ date: '2026-10-01' }], [{ business_date: '2026-10-01', net_sales: 444 }]);
  assert.equal(r.error, undefined); assert.equal(r.updated, 1);
  assert.equal(f.commits.length, 1); assert.equal(f.api.getState().status, 'committed');
  assert.equal(f.database.get(DAILY).value['2026-10-01'].actual, 444);
});

test('v1107: a typed save whose answer did not come back is checked and sent again without pressing', async () => {
  let calls = 0;
  const f = fixture({ autoCheckMs: [5, 5, 5], commit: (request, answer) => { calls++; if (calls === 1) throw networkError(); return answer(request); } });
  await f.context.openDayMemo('F01', '2026-10-01', '木'); f.set('dm-memo', 'Typed while the network dropped');
  assert.equal(await f.context.saveDayMemo('F01', '2026-10-01'), false);
  assert.equal(f.api.getState().status, 'unknown'); assert.equal(f.api.getState().why, 'network');
  assert.equal(await until(() => f.api.getState().status === 'committed'), true);
  assert.equal(f.commits.length, 2); assert.equal(f.commits[1], f.commits[0]);   // 同じ番号・同じ中身
  assert.equal(f.database.get(DAILY).value['2026-10-01'].event, 'Typed while the network dropped');
});

test('v1107: when the server keeps refusing a typed save, the user can stop it and keep the input', async () => {
  const f = fixture({ autoCheckMs: [5, 600000], commit: () => { throw serverError(); } });
  await f.context.openDayMemo('F01', '2026-10-01', '木'); f.set('dm-memo', 'Keep me');
  await f.context.saveDayMemo('F01', '2026-10-01');
  assert.equal(await f.api.abandon(), false);   // 届いていないとまだ分からない：やめられない
  assert.equal(await until(() => f.api.getState().notFound === true && f.commits.length === 2), true);   // 確かめた → 届いていない → 送り直した
  await settle();
  const s1 = f.api.getState();
  assert.equal(s1.status, 'unknown'); assert.equal(s1.why, 'http_500_57014');
  await assert.rejects(f.api.refresh([DAILY]), /financial_unresolved_save/);   // 片づくまでは読み込みを止める（今までどおり）
  assert.equal(await f.api.abandon(), true);
  assert.equal(f.api.getState().status, 'idle');
  const rec = f.api.getRecovery();
  const kept = rec.find(x => x.reason === 'abandoned_unconfirmed');
  assert.equal(kept.request.writes[DAILY]['2026-10-01'].event, 'Keep me');   // 入力はこの端末の記録に残る
  assert.equal(kept.why, 'http_500_57014');
  assert.equal(rec.some(x => x.reason === 'pending_request'), false);
  assert.equal((await f.api.refresh([DAILY, BUDGET])).size, 2);
  assert.equal(f.database.get(DAILY).value['2026-10-01'].event, 'Before');
  // 読み込み直しても、やめた保存は戻らない
  const again = fixture({ storage: f.storage, database: f.database, receipts: f.receipts });
  assert.equal((await again.api.refresh([DAILY])).size, 1); assert.equal(again.api.getState().status, 'idle');
});

test('v1107: a v1106 record (no source) found at startup is checked without pressing; conflicts stay explicit', async () => {
  const lost = fixture({ timeoutMs: 10, commit: (request, answer) => { answer(request); return new Promise(() => {}); } });
  await lost.context.openDayMemo('F01', '2026-10-01', '木'); lost.set('dm-memo', 'Written, answer lost');
  await lost.context.saveDayMemo('F01', '2026-10-01');
  const strip = storage => { for (const k of recoveryKeys(storage)) { const v = JSON.parse(storage.get(k)); if (v.reason === 'pending_request') { delete v.source; storage.set(k, JSON.stringify(v)); } } };
  strip(lost.storage);
  const a = fixture({ storage: lost.storage, database: lost.database, receipts: lost.receipts, deferStartup: true, autoCheckMs: [5] });
  await assert.rejects(a.api.refresh([DAILY]), /financial_unresolved_save/);   // 起動の読み込みで引き取る
  assert.equal(await until(() => a.api.getState().status === 'committed'), true);
  assert.equal(a.commits.length, 0);   // 受け取りで済んだ（送り直さない）
  assert.equal((await a.api.refresh([DAILY, BUDGET])).size, 2);
  // 届いていない古い記録：同じ内容で送り直すと、そのあいだにほかの端末が直していれば「重なった」で止める（人の保存かもしれないので放さない）
  const typed = fixture({ timeoutMs: 10, commit: () => new Promise(() => {}) });
  await typed.context.openDayMemo('F01', '2026-10-01', '木'); typed.set('dm-memo', 'Never arrived');
  await typed.context.saveDayMemo('F01', '2026-10-01');
  strip(typed.storage);
  typed.advance(DAILY, value => { value['2026-10-01'].event = 'Other device'; });
  const b = fixture({ storage: typed.storage, database: typed.database, receipts: typed.receipts, deferStartup: true, autoCheckMs: [5] });
  await assert.rejects(b.api.refresh([DAILY]), /financial_unresolved_save/);
  assert.equal(await until(() => b.api.getState().status === 'conflict'), true);
  assert.equal(b.commits.length, 1); assert.equal(b.database.get(DAILY).value['2026-10-01'].event, 'Other device');
});

test('v1107: an automatic import found unfinished at startup is let go once the server says it never arrived', async () => {
  const first = fixture({ timeoutMs: 10, commit: () => new Promise(() => {}) });
  const r = await first.context.syncStoreActualsFromToast('F01', 'one', [{ date: '2026-10-01' }], [{ business_date: '2026-10-01', net_sales: 555 }]);
  assert.equal(r.code, 'timeout'); assert.equal(first.api.getState().status, 'idle');
  // 閉じる前に放せなかった記録（保存の前の記録だけが残った）を作る
  const g = fixture({ timeoutMs: 10, commit: () => new Promise(() => {}), receipt: () => new Promise(() => {}) });
  const req = g.context.syncStoreActualsFromToast('F01', 'one', [{ date: '2026-10-01' }], [{ business_date: '2026-10-01', net_sales: 555 }]);
  await until(() => recoveryText(g.storage).includes('pending_request'));
  const snapshot = new Map(g.storage);
  await req;
  const b = fixture({ storage: snapshot, database: g.database, deferStartup: true, autoCheckMs: [5] });
  await assert.rejects(b.api.refresh([DAILY]), /financial_unresolved_save/);
  assert.equal(await until(() => b.api.getState().status === 'idle'), true);
  assert.equal(b.commits.length, 0);   // 自動の保存は送り直さない（次の取り込みで最新を読み直す）
  assert.equal(b.api.getState().released.source, 'syncStoreActualsFromToast');
  assert.equal((await b.api.refresh([DAILY, BUDGET])).size, 2);
});

test('v1107: an automatic import refused because a typed save is still open says why; marks stay at 30', async () => {
  const f = fixture({ timeoutMs: 10, commit: (request, answer) => request.writes[DAILY] && request.writes[DAILY]['2026-10-01'].event === 'Pending memo' ? new Promise(() => {}) : answer(request) });
  await f.context.openDayMemo('F01', '2026-10-01', '木'); f.set('dm-memo', 'Pending memo');
  await f.context.saveDayMemo('F01', '2026-10-01');
  seedStore(f, 'F02');
  const r = await f.context.syncStoreActualsFromToast('F02', 'two', [{ date: '2026-10-01' }], [{ business_date: '2026-10-01', net_sales: 1 }]);
  assert.equal(r.code, 'pending');
  const m = fixture({ commit: () => { throw serverError(); } });
  for (let i = 0; i < 35; i++) await m.context.syncStoreActualsFromToast('F01', 'one', [{ date: '2026-10-01' }], [{ business_date: '2026-10-01', net_sales: 600 + i }]);
  assert.equal(m.api.getRecovery().filter(x => x.reason === 'auto_released').length, 30);
  assert.equal(m.api.getRecovery().some(x => x.reason === 'pending_request'), false);
});

test('v1107: a v1101-v1106 record of a Toast import is recognised at startup and let go without pressing; the record is kept', async () => {
  // 本番 10/24：v1106 の端末に、答えの来ない Toast の売上の取り込みの記録が残り、どのボタンでも片づかなかった
  const g = fixture({ timeoutMs: 10, commit: () => new Promise(() => {}), receipt: () => new Promise(() => {}) });
  const req = g.context.syncStoreActualsFromToast('F01', 'one', [{ date: '2026-10-01' }], [{ business_date: '2026-10-01', net_sales: 777, guest_count: 12 }]);
  await until(() => recoveryText(g.storage).includes('pending_request'));
  const snapshot = new Map(g.storage); await req;
  for (const k of recoveryKeys(snapshot)) { const v = JSON.parse(snapshot.get(k)); if (v.reason === 'pending_request') { assert.equal(v.source, 'syncStoreActualsFromToast'); delete v.source; snapshot.set(k, JSON.stringify(v)); } }
  const refused = () => { throw serverError(); };
  const b = fixture({ storage: snapshot, database: g.database, deferStartup: true, autoCheckMs: [5], commit: refused });
  await assert.rejects(b.api.refresh([DAILY]), /financial_unresolved_save/);
  assert.equal(b.api.getState().auto, true);
  assert.equal(await until(() => b.api.getState().status === 'idle'), true);
  assert.equal(b.commits.length, 0); assert.equal(b.api.getState().released.source, 'guessed-import');
  assert.equal((await b.api.refresh(ids.flatMap(id => ['daily_actuals_' + id, 'spl_budgets_v2_' + id]))).size, 20);
  const rec = b.api.getRecovery();
  assert.equal(rec.some(x => x.reason === 'pending_request'), true);   // 見分けただけなので記録は消さない
  assert.equal(rec.some(x => x.reason === 'auto_released'), true);
  const c = fixture({ storage: snapshot, database: g.database, deferStartup: true });
  assert.equal((await c.api.refresh([DAILY])).size, 1); assert.equal(c.api.getState().status, 'idle');   // 読み込み直しても戻らない
});

test('v1107: a typed v1106 record is not mistaken for an import; an answer the app cannot accept still offers the way out', async () => {
  const g = fixture({ timeoutMs: 10, commit: () => new Promise(() => {}) });
  await g.context.openDailyActualModal('F01', '2026-10-01', '木'); g.set('da-actual', '345');
  await g.context.saveDailyActual('F01', '2026-10-01');
  for (const k of recoveryKeys(g.storage)) { const v = JSON.parse(g.storage.get(k)); if (v.reason === 'pending_request') { delete v.source; g.storage.set(k, JSON.stringify(v)); } }
  // サーバーは「済み」と答えるが、版が新しくなっていない（このアプリは受け取れない形）
  const odd = async ({ requestId }) => ({ status: 'committed', requestId, versions: { [DAILY]: BASE, [BUDGET]: BASE } });
  const b = fixture({ storage: g.storage, database: g.database, deferStartup: true, autoCheckMs: [5, 600000], receipt: odd, commit: () => { throw networkError(); } });
  await assert.rejects(b.api.refresh([DAILY]), /financial_unresolved_save/);
  assert.equal(b.api.getState().auto, false);
  assert.equal(await until(() => b.api.getState().oddReceipt === true), true);
  await settle();
  assert.equal(b.api.getState().status, 'unknown');
  assert.equal(await b.api.abandon(), true);
  assert.equal(b.api.getState().status, 'idle');
  assert.equal(b.api.getRecovery().find(x => x.reason === 'abandoned_unconfirmed').request.writes[DAILY]['2026-10-01'].actual, 345);
});

test('v1107: typed memo and budget records without a source are never taken for an automatic import', async () => {
  const strip = storage => { for (const k of recoveryKeys(storage)) { const v = JSON.parse(storage.get(k)); if (v.reason === 'pending_request') { delete v.source; storage.set(k, JSON.stringify(v)); } } };
  const memo = fixture({ timeoutMs: 10, commit: () => new Promise(() => {}) });
  await memo.context.openDayMemo('F01', '2026-10-01', '木'); memo.set('dm-memo', 'Typed memo');
  await memo.context.saveDayMemo('F01', '2026-10-01'); strip(memo.storage);
  const m = fixture({ storage: memo.storage, database: memo.database, deferStartup: true });
  await assert.rejects(m.api.refresh([DAILY]), /financial_unresolved_save/); assert.equal(m.api.getState().auto, false);
  const bud = fixture({ timeoutMs: 10, commit: () => new Promise(() => {}) });
  await bud.context.bbOpen('F01'); bud.context._bbDow.lunch[0].guests = 99;
  bud.dayFields.push({ value: '123.5', disabled: false, getAttribute: () => '2026-10-02' });
  await bud.context.bbSave(); strip(bud.storage);
  const b = fixture({ storage: bud.storage, database: bud.database, deferStartup: true });
  await assert.rejects(b.api.refresh([BUDGET]), /financial_unresolved_save/); assert.equal(b.api.getState().auto, false);
});
