// PR #31 (deployed to ops-bot on 2026-10-04): the attendance check also leaves out "Toast Generic Login" at every store and
// "Server Default" at LaLa (F06) only. Names are compared after NFKC, lower case and treating spaces, "_", "-", "." and "*"
// alike. Payments are not affected. Synthetic names only.
import test from 'node:test';
import assert from 'node:assert/strict';
const {isBotSystemAccount, laborFindings, createHandler, voidFindings} = await import(process.env.BOT_HANDLER_PATH || '../supabase/functions/ops-bot/handler.mjs');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const cfg = {nightFrom: '03:00', nightTo: '05:00', longH: 12, shortMin: 15};
const shifts = [{guid: id(1), employeeReference: {guid: id(2)}, inDate: '2026-08-01T09:00:00-10:00', outDate: null}];   // still clocked in: a finding for a person
const found = (name, store_id) => laborFindings(shifts, [{guid: id(2), name}], cfg, {store_id, name: store_id}, '2026-08-01').length;

const GENERIC = ['Toast Generic Login', 'TOAST GENERIC LOGIN', 'toast_generic-login', 'Toast.Generic.Login', '*Toast Generic Login*', 'Ｔｏａｓｔ　Ｇｅｎｅｒｉｃ　Ｌｏｇｉｎ',
  '  toast   generic   login  ', 'Toast Generic Login 2'];
const DEFAULT = ['Server Default', 'SERVER DEFAULT', 'server_default', 'Server-Default', '*Server Default*', 'Ｓｅｒｖｅｒ　Ｄｅｆａｕｌｔ', 'server.default'];
const PEOPLE = ['Synthetic Person', 'Toasty Generic Login', 'MyToast Generic Login', 'Toast Generic Logins', 'Toast Genericlogin', 'Generic Login', 'Default Server', 'Server Default 2', 'Server', 'Default', ''];

test('Toast Generic Login is left out at every store, in any spelling', () => {
  for (const store of ['F06', 'F01', 'F04-K', 'TEST']) for (const name of GENERIC) {
    assert.equal(isBotSystemAccount(name, store), true, name + ' @' + store);
    assert.equal(found(name, store), 0, name + ' @' + store);
  }
});

test('Server Default is left out only at LaLa (F06)', () => {
  for (const name of DEFAULT) {
    assert.equal(isBotSystemAccount(name, 'F06'), true, name);
    assert.equal(found(name, 'F06'), 0, name);
    for (const store of ['F01', 'F02', 'F04-K', 'F05', 'TEST', undefined]) {
      assert.equal(isBotSystemAccount(name, store), false, name + ' @' + store);
      assert.equal(found(name, store), 1, name + ' @' + store);
    }
  }
});

test('people and other names are still checked; the earlier system names stay excluded', () => {
  for (const store of ['F06', 'F01']) {
    for (const name of PEOPLE) { assert.equal(isBotSystemAccount(name, store), false, name + ' @' + store); assert.equal(found(name, store), 1, name + ' @' + store); }
    for (const name of ['Kiosk Mode', 'Order Only']) assert.equal(found(name, store), 0, name + ' @' + store);
  }
});

test('an existing case is closed the same way when it is checked again (store from the case)', async () => {
  const run = async (store_id, employee_name) => {
    const c = {id: id(10), version: 3, kind: 'labor', store_id, payload: {employee_name}}, calls = [];
    const env = k => ({SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', SUPABASE_ANON_KEY: 'synthetic-anon'})[k];
    const handler = createHandler({env, fetch: async (url, init) => {
      if (url.endsWith('/auth/v1/user')) return Response.json({id: id(99)});
      if (url.includes('/manager_auth?')) return Response.json([{role: 'office'}]);
      if (url.includes('/bot_cases?id=')) return Response.json([c]);
      if (url.endsWith('/rpc/bot_case_write')) { const b = JSON.parse(init.body); calls.push(b); return Response.json({...c, status: 'done'}); }
      throw Error('Unexpected request ' + url);   // Toast or LINE would be contacted only for a person
    }});
    const r = await handler(new Request('https://fn.test', {method: 'POST', headers: {Authorization: 'Bearer synthetic'}, body: JSON.stringify({action: 'recheck', id: c.id, version: 3})}));
    return {status: r.status, body: r.status === 200 ? await r.json() : null, calls};
  };
  for (const [store, name] of [['F06', 'Server Default'], ['F01', 'Toast Generic Login'], ['F06', '*toast_generic login*']]) {
    const r = await run(store, name);
    assert.equal(r.status, 200, store + ' ' + name); assert.equal(r.body.message, 'excluded_nonhuman_account');
    assert.equal(r.calls.length, 1); assert.equal(r.calls[0].p_op, 'verified'); assert.equal(r.calls[0].p_data.verification_type, 'nonhuman_account_excluded');
  }
  for (const [store, name] of [['F01', 'Server Default'], ['F06', 'Synthetic Person']]) {
    const r = await run(store, name);
    assert.notEqual(r.status, 200, store + ' ' + name); assert.equal(r.calls.length, 0, 'not closed as an excluded account');
  }
});

test('payments made by these accounts are still detected', () => {
  const orders = [{guid: id(1), checks: [{guid: id(2), paymentStatus: 'OPEN', totalAmount: 10, payments: [{guid: id(3), paymentStatus: 'VOIDED', voidInfo: {voidUser: {guid: id(4)}}}]}]}];
  for (const name of ['Toast Generic Login', 'Server Default'])
    assert.equal(voidFindings(orders, {store_id: 'F06', name: 'F06'}, '2026-08-01', [], [{guid: id(4), name}]).length, 1, name);
});
