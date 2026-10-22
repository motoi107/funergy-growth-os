import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].find(match => match[1].includes('root.FunergyFinancialTransport'))?.[1];
assert.ok(source, 'financial transport is embedded in the released source');
const BASE = '2026-10-21T01:00:00.000001Z', AFTER = '2026-10-21T01:00:00.000002Z';
const ID = '01234567-89ab-4cde-8fab-0123456789ab';
const DAILY = 'daily_actuals_F01', BUDGET = 'spl_budgets_v2_F01';
const clone = value => JSON.parse(JSON.stringify(value));
const body = keys => ({ requestId: ID, expectedVersions: Object.fromEntries(keys.map(key => [key, BASE])),
  expected: Object.fromEntries(keys.map(key => [key, { value: key.startsWith('daily_') ? {} : [{ storeId: 'F01' }], updated_at: BASE }])),
  writes: Object.fromEntries(keys.map(key => [key, key.startsWith('daily_') ? { '2026-10-01': { actual: 1 } } : [{ storeId: 'F01', actual: 1 }]])) });
const receipt = (action = 'daily-memo.save', versions = { [DAILY]: AFTER }) => ({ status: 'committed', request_id: ID, store_id: 'F01', action, versions });
function setup(handler = () => ({ data: [] }), { abortImmediately = false } = {}) {
  const requests = [], timeouts = [];
  const ctx = vm.createContext({ AbortSignal: { timeout(ms) { timeouts.push(ms); const controller = new AbortController();
    if (abortImmediately) queueMicrotask(() => controller.abort(new DOMException('Timed out', 'TimeoutError'))); return controller.signal; } } });
  vm.runInContext(source, ctx);
  const transport = ctx.FunergyFinancialTransport.create({ url: 'https://fixture-project.supabase.co',
    headers: extra => ({ 'X-Fixture-Caller': 'existing-caller', ...extra }), fetch: async (url, options) => {
      const request = { url, options }; requests.push(request);
      const result = await handler(request);
      if (result instanceof Error) throw result;
      return { ok: result.status === undefined || (result.status >= 200 && result.status < 300), status: result.status || 200,
        text: async () => result.text === undefined ? JSON.stringify(result.data) : result.text };
    } });
  return { ctx, transport, requests, timeouts };
}

test('transport fixed scope covers ten shared Web stores and factory does not accept arbitrary endpoint paths', () => {
  const f = setup(); assert.equal(f.ctx.FunergyFinancialTransport.keys.length, 20);
  for (const store of ['F03', 'F03-G', 'F07']) assert.ok(f.ctx.FunergyFinancialTransport.keys.includes('spl_budgets_v2_' + store));
  for (const url of ['http://fixture-project.supabase.co', 'https://example.com', 'https://fixture-project.supabase.co/path', 'https://fixture-project.supabase.co.evil.example'])
    assert.throws(() => f.ctx.FunergyFinancialTransport.create({ url, headers() {}, fetch() {} }), /financial_transport_invalid/);
});

test('exact row reads keep source JSON and microseconds while reporting verified absence separately', async () => {
  const value = { '2026-10-01': { actual: 42, unknown: { keep: true } } };
  const f = setup(() => ({ data: [{ key: DAILY, value, updated_at: BASE }] }));
  const result = await f.transport.read([DAILY, BUDGET]);
  assert.deepEqual(clone(result), { rows: [{ key: DAILY, value, version: BASE, exists: true }, { key: BUDGET, value: null, version: null, exists: false }] });
  const url = new URL(f.requests[0].url);
  assert.equal(url.searchParams.get('select'), 'key,value,updated_at');
  assert.equal(url.searchParams.get('key'), `in.(${DAILY},${BUDGET})`); assert.equal(url.searchParams.get('limit'), '21');
  assert.equal(f.requests[0].options.method, 'GET'); assert.equal(f.requests[0].options.body, undefined);
});

test('read scopes reject duplicate, future-store, injected or unexpected server rows', async () => {
  const f = setup();
  for (const keys of [[], [DAILY, DAILY], ['daily_actuals_F08'], ['daily_actuals_F01)&select=*'], ['budgets_v2']])
    await assert.rejects(() => f.transport.read(keys), /financial_keys_invalid/);
  assert.equal(f.requests.length, 0);
  for (const data of [[{ key: 'daily_actuals_F08', value: {}, updated_at: BASE }],
    [{ key: DAILY }, { key: DAILY }], { rows: [] }, [null]]) {
    const bad = setup(() => ({ data })); await assert.rejects(() => bad.transport.read([DAILY]));
  }
});

test('all commit shapes map to exact SQL actions and send original expected values, not freshly read values', async () => {
  for (const [keys, action] of [[[DAILY], 'daily-memo.save'], [[BUDGET], 'budget-month.save'], [[DAILY, BUDGET], 'daily-actual.save']]) {
    const request = body(keys), versions = Object.fromEntries(keys.map(key => [key, AFTER]));
    const f = setup(() => ({ data: receipt(action, versions) }));
    const result = await f.transport.commit(request);
    assert.deepEqual(clone(result), { status: 'committed', requestId: ID, versions });
    assert.equal(f.requests.length, 1);
    assert.match(f.requests[0].url, /\/rest\/v1\/rpc\/financial_web_commit$/);
    assert.deepEqual(JSON.parse(f.requests[0].options.body), { p_request_id: ID, p_action: action, p_store: 'F01', p_expected: request.expected, p_writes: request.writes });
    assert.equal(f.requests[0].options.method, 'POST');
    assert.equal(f.requests[0].options.headers['X-Fixture-Caller'], 'existing-caller');
    assert.equal(f.requests[0].options.headers['Content-Type'], 'application/json');
  }
});

test('commit never sends cross-store or out-of-scope writes and validates the immutable operation id', async () => {
  const f = setup();
  for (const value of [body([DAILY, 'spl_budgets_v2_F02']), body([DAILY, BUDGET, 'daily_actuals_F02']), body(['daily_actuals_F08']),
    { ...body([DAILY]), requestId: 'new-id' }, { ...body([DAILY]), writes: {} }]) await assert.rejects(() => f.transport.commit(value));
  assert.equal(f.requests.length, 0);
});

test('only the exact rollback conflict is definite; errors and unknown outcomes are never automatically retried', async () => {
  const conflict = setup(() => ({ status: 409, data: { code: '40001', message: 'financial_guard_version_conflict' } }));
  assert.deepEqual(clone(await conflict.transport.commit(body([DAILY]))), { status: 'conflict', requestId: ID });
  for (const handler of [() => ({ status: 409, data: { code: '40001', message: 'different_conflict' } }),
    () => ({ status: 500, data: { code: 'XX000', message: 'failure' } }), () => new Error('network lost')]) {
    const f = setup(handler); await assert.rejects(() => f.transport.commit(body([DAILY]))); assert.equal(f.requests.length, 1);
  }
});

test('receipt checks use the original id and reject wrong ids, unsupported action/store and mismatched revision scope', async () => {
  const f = setup(() => ({ data: receipt() }));
  assert.deepEqual(clone(await f.transport.receipt({ requestId: ID })), { status: 'committed', requestId: ID, versions: { [DAILY]: AFTER } });
  assert.deepEqual(JSON.parse(f.requests[0].options.body), { p_request_id: ID });
  assert.match(f.requests[0].url, /\/rpc\/financial_web_receipt$/);
  for (const data of [{ ...receipt(), request_id: 'different' }, { ...receipt(), store_id: 'F08' }, { ...receipt(), action: 'anything.upsert' },
    { ...receipt(), store_id: 'F02' }, { ...receipt(), action: 'daily-actual.save' }, { ...receipt(), versions: {} },
    { ...receipt(), versions: { [DAILY]: AFTER, [BUDGET]: AFTER } }, { ...receipt(), versions: null }]) {
    const bad = setup(() => ({ data })); await assert.rejects(() => bad.transport.receipt({ requestId: ID }), /financial_receipt_invalid/);
  }
});

test('not-found receipt remains unresolved and malformed/non-JSON/oversized replies fail closed', async () => {
  const f = setup(() => ({ data: { status: 'not-found', request_id: ID } }));
  assert.deepEqual(clone(await f.transport.receipt({ requestId: ID })), { status: 'not-found', requestId: ID });
  for (const text of ['not json', 'x'.repeat(16000001)]) {
    const bad = setup(() => ({ text })); await assert.rejects(() => bad.transport.commit(body([DAILY])), /financial_response_/);
  }
  const wrongCommit = setup(() => ({ data: { ...receipt(), action: 'budget-month.save' } }));
  await assert.rejects(() => wrongCommit.transport.commit(body([DAILY])), /financial_receipt_invalid/);
});

test('timeout cancellation applies to each request without replay or mutating its id/body', async () => {
  const f = setup(async ({ options }) => {
    await new Promise((resolve, reject) => { if (options.signal.aborted) reject(options.signal.reason);
      else options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); });
  }, { abortImmediately: true });
  const request = body([DAILY]), before = clone(request);
  await assert.rejects(() => f.transport.commit(request), error => error.name === 'TimeoutError');
  assert.deepEqual(request, before); assert.deepEqual(f.timeouts, [30000]); assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].options.redirect, 'error'); assert.equal(f.requests[0].options.cache, 'no-store');
});
