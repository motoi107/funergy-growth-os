// v1160：期間一括取り込みで失敗した日の理由を残し、失敗した日を 1 回取り直し、「失敗した日だけ取り込み直す」で取れる。
// 合成データだけ（本物の Toast・Supabase には触れない）。v1159（fcf0502）の本物のコードと比べる。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const now = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let before = null;
try { before = execFileSync('git', ['show', 'fcf0502:index.html'], { cwd: new URL('..', import.meta.url), maxBuffer: 64 << 20 }).toString(); } catch (_) {}

function extract(name, text) {
  const begin = text.indexOf('function ' + name + '(');
  assert.ok(begin >= 0, name);
  const start = text.slice(begin - 6, begin) === 'async ' ? begin - 6 : begin;
  const end = text.indexOf('\n}', begin);
  assert.ok(end > begin, name + ' end');
  return text.slice(start, end + 2);
}
function varLine(name, text) {
  const i = text.indexOf('var ' + name + ' = ');
  assert.ok(i >= 0, name);
  return text.slice(i, text.indexOf('\n', i));
}

// 偽の hyper-worker：日ごとに答えの列（呼ばれた回数で次の答え）。無ければいつも成功
function fakeWorker(plan = {}) {
  const calls = [];
  const ok = date => ({ status: 200, body: { ok: true, date, net_sales: 100, guests: 10, lunchSales: 40, dinnerSales: 60 } });
  return {
    calls,
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      const ymd = body.businessDate;
      const date = ymd.slice(0, 4) + '-' + ymd.slice(4, 6) + '-' + ymd.slice(6, 8);
      const n = calls.filter(d => d === date).length;
      calls.push(date);
      const list = plan[date] || [];
      const a = n < list.length ? list[n] : ok(date);
      if (a === 'throw') throw new TypeError('Failed to fetch');
      const text = typeof a.body === 'string' ? a.body : JSON.stringify(a.body);
      return { ok: a.status >= 200 && a.status < 300, status: a.status, text: async () => text, json: async () => JSON.parse(text) };
    },
  };
}

function load(text, plan) {
  const w = fakeWorker(plan), actuals = {}, sleeps = [], effects = [], toasts = [], elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: id === 'rg-from' ? '2026-10-01' : id === 'rg-to' ? '2026-10-05' : '', checked: false, innerHTML: '', disabled: false });
    return elements.get(id);
  };
  const store = { id: 'F04-A', name: 'Aiea', toastGuid: 'guid-a' };
  const context = vm.createContext({
    console, Promise, Date, Math, JSON, Number, String, Array, Object, TypeError,
    fetch: w.fetch, TOAST_SYNC_FN: 'https://example.invalid/hyper-worker', SUPABASE_ANON: 'anon',
    toastFnBody: o => JSON.stringify(o), STORES: [store],
    getDailyActuals: sid => JSON.parse(JSON.stringify(actuals[sid] || {})),
    setDailyActuals: (sid, v) => { actuals[sid] = JSON.parse(JSON.stringify(v)); },
    getBudgets: () => [], saveBudgets: () => {},
    setTimeout: fn => { fn(); return 0; },
    document: { getElementById: element },
    getVisibleStores: () => [store], getStoresAll: () => [store],
    escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    fmtUSD2: n => '$' + Number(n).toFixed(2), showToast: (m, k) => toasts.push({ m, k }),
    renderPage: p => effects.push('render:' + p), closeModalDirect: () => effects.push('close'),
    alert: m => { throw new Error('alert: ' + m); },
  });
  context.window = context;
  const isNew = text.includes('function toastFailKind(');
  const parts = isNew
    ? [varLine('_toastRangeSleep', text), varLine('TOAST_FAIL_LABEL', text), varLine('_rgLastFailed', text),
      ...['syncToastDay', 'toastFailKind', 'fetchToastRange', 'toastFailSummaryHtml', 'doRangeImport'].map(n => extract(n, text))]
    : ['syncToastDay', 'fetchToastRange'].map(n => extract(n, text));
  vm.runInContext(parts.join('\n'), context);
  if (isNew) context._toastRangeSleep = async ms => { sleeps.push(ms); };
  return { c: context, w, actuals, sleeps, effects, toasts, element };
}

const limit429 = { status: 500, body: { ok: false, error: 'Error: orders HTTP 429' } };

test('a day Toast refused is tried again and saved (v1159 dropped it with no reason)', async () => {
  const plan = { '2026-10-02': [limit429], '2026-10-04': [limit429] };
  const a = load(now, plan);
  const info = [];
  const r = await a.c.fetchToastRange('F04-A', 'guid-a', '2026-10-01', '2026-10-05', (d, t, o, f, i) => { if (i) info.push(i.phase); });
  assert.equal(r.ok, 5); assert.equal(r.fail, 0); assert.equal(r.retried, 2); assert.equal(r.recovered, 2);
  assert.deepEqual(r.failures, []);
  assert.deepEqual(Object.keys(a.actuals['F04-A']).sort(), ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
  assert.equal(r.sumSales, 500);
  assert.ok(a.sleeps.includes(15000), 'waits before trying the refused days again');
  assert.ok(a.sleeps[1] >= 3000, 'spaces the days after a refusal');
  assert.deepEqual([...new Set(info)], ['wait', 'retry']);
  if (before) {
    const b = load(before, plan);
    const r0 = await b.c.fetchToastRange('F04-A', 'guid-a', '2026-10-01', '2026-10-05');
    assert.equal(r0.fail, 2); assert.equal(r0.failures, undefined);
    assert.equal(Object.keys(b.actuals['F04-A']).length, 3);
  }
});

test('an answer that is not JSON keeps a reason instead of throwing', async () => {
  const html = { status: 502, body: '<html>Bad gateway</html>' };
  const plan = { '2026-10-01': [html, html, html] };
  const a = load(now, plan);
  const r = await a.c.fetchToastRange('F04-A', 'guid-a', '2026-10-01', '2026-10-02');
  assert.equal(r.fail, 1);
  assert.equal(r.failures[0].kind, 'server');
  assert.match(r.failures[0].msg, /HTTP 502/);
  assert.equal(a.w.calls.filter(d => d === '2026-10-01').length, 2);
  const d = await a.c.syncToastDay('guid-a', '20261001');
  assert.equal(d.ok, false); assert.match(d.error, /HTTP 502/);
  const n = load(now, { '2026-10-01': ['throw'] });
  const e = await n.c.syncToastDay('guid-a', '20261001');
  assert.equal(e.ok, false); assert.equal(n.c.toastFailKind(e), 'network');
  if (before) {
    const b = load(before, plan);
    await assert.rejects(b.c.syncToastDay('guid-a', '20261001'));
  }
});

test('when the app login is refused the remaining days are not called and not tried again', async () => {
  const refused = { status: 401, body: { error: 'ログインを確かめられませんでした。ログアウトしてログインし直してください（session_required）' } };
  const a = load(now, { '2026-10-02': [refused] });
  const r = await a.c.fetchToastRange('F04-A', 'guid-a', '2026-10-01', '2026-10-05');
  assert.deepEqual(a.w.calls, ['2026-10-01', '2026-10-02']);
  assert.equal(r.ok, 1); assert.equal(r.fail, 4); assert.equal(r.retried, 0);
  assert.ok(r.failures.every(f => f.kind === 'session'));
  assert.deepEqual(r.failures.filter(f => f.skipped).map(f => f.date), ['2026-10-03', '2026-10-04', '2026-10-05']);
  const m = load(now, { '2026-10-02': [refused] });
  await m.c.doRangeImport('F04-A', 'guid-a');
  const html = m.element('rg-progress').innerHTML;
  assert.match(html, /ログインし直して/);
  assert.doesNotMatch(html, /rg-retry/);
  assert.equal(m.effects.includes('close'), false);
});

test('a day that still fails shows the reason and date, and the button takes only that day', async () => {
  const a = load(now, { '2026-10-03': [limit429, limit429] });
  await a.c.doRangeImport('F04-A', 'guid-a');
  let html = a.element('rg-progress').innerHTML;
  assert.match(html, /Toast の回数の制限 1日/);
  assert.match(html, /10\/03/);
  assert.match(html, /orders HTTP 429/);
  assert.match(html, /失敗した日だけ取り込み直す（1日）/);
  assert.equal(a.effects.includes('close'), false, 'keeps the window open when a day failed');
  assert.equal(a.toasts.at(-1).k, 'warning');
  assert.equal(a.actuals['F04-A']['2026-10-03'], undefined);
  const callsBefore = a.w.calls.length;
  await a.c.doRangeImport('', '', 1);
  assert.deepEqual(a.w.calls.slice(callsBefore), ['2026-10-03']);
  assert.equal(a.actuals['F04-A']['2026-10-03'].actual, 100);
  html = a.element('rg-progress').innerHTML;
  assert.doesNotMatch(html, /rg-retry/);
  assert.equal(a.c._rgLastFailed, null);
  assert.equal(a.effects.includes('close'), true);
});

test('a save error in the database is shown and not tried again', async () => {
  const a = load(now, { '2026-10-02': [{ status: 200, body: { ok: false, dbError: 'column "x" does not exist' } }] });
  const r = await a.c.fetchToastRange('F04-A', 'guid-a', '2026-10-01', '2026-10-03');
  assert.equal(r.retried, 0); assert.equal(a.w.calls.length, 3);
  assert.equal(r.failures[0].kind, 'db'); assert.match(r.dbError, /column "x"/);
  const m = load(now, { '2026-10-02': [{ status: 200, body: { ok: false, dbError: 'column "x" does not exist' } }] });
  await m.c.doRangeImport('F04-A', 'guid-a');
  assert.match(m.element('rg-progress').innerHTML, /DB保存エラー/);
  assert.doesNotMatch(m.element('rg-progress').innerHTML, /rg-retry/);
  assert.equal(m.effects.includes('close'), false);
});

test('reasons are told apart', () => {
  const { c } = load(now, {});
  const k = r => c.toastFailKind(r);
  assert.equal(k({ ok: false, error: 'auth_failed', detail: 'HTTP 429' }), 'limit');
  assert.equal(k({ ok: false, error: 'auth_failed', detail: 'network' }), 'auth');
  assert.equal(k({ ok: false, error: 'Error: toast login HTTP 401' }), 'auth');
  assert.equal(k({ ok: false, error: 'network: Failed to fetch' }), 'network');
  assert.equal(k({ error: 'ログインを確かめられませんでした（session_expired）', _http: 401 }), 'session');
  assert.equal(k({ error: 'このアカウントは退職・停止のため使えません（inactive）', _http: 401 }), 'session');
  assert.equal(k({ error: 'unauthorized', _http: 401 }), 'session');
  assert.equal(k({ ok: false, dbError: 'x' }), 'db');
  assert.equal(k({ ok: false, error: 'HTTP 546: {"code":"WORKER_LIMIT"}', _http: 546 }), 'server');
  assert.equal(k({ ok: false, error: 'Error: menus HTTP 503' }), 'server');
  assert.equal(k({ error: '社員の表を確かめられませんでした（db_unavailable）', _http: 503 }), 'server');
  assert.equal(k({ ok: false, error: 'something odd' }), 'other');
  assert.equal(k(null), 'other');
});

test('L/D missing is counted once a day even when the day was tried again', async () => {
  const ld = date => ({ status: 200, body: { ok: true, date, net_sales: 100, ldSaved: false } });
  const a = load(now, { '2026-10-01': [ld('2026-10-01')], '2026-10-02': [{ status: 200, body: { ok: false, error: 'Error: orders HTTP 429', ldSaved: false } }, ld('2026-10-02')] });
  const r = await a.c.fetchToastRange('F04-A', 'guid-a', '2026-10-01', '2026-10-03');
  assert.equal(r.ldMissing, 2); assert.equal(r.fail, 0);
});

test('only the given days inside the range are taken', async () => {
  const a = load(now, {});
  const r = await a.c.fetchToastRange('F04-A', 'guid-a', '2026-10-01', '2026-10-31', null, { dates: ['2026-10-07', '2026-10-20', '2026-11-02'] });
  assert.deepEqual(a.w.calls, ['2026-10-07', '2026-10-20']);
  assert.equal(r.total, 2); assert.equal(r.ok, 2);
});

test('the spacing grows after refusals and shrinks after successes', async () => {
  const a = load(now, { '2026-10-01': [limit429], '2026-10-02': [limit429] });
  await a.c.fetchToastRange('F04-A', 'guid-a', '2026-10-01', '2026-10-06', null, { noRetry: true });
  assert.deepEqual(a.sleeps, [3000, 6000, 3000, 1500, 750]);
});

test('the optional L/D column SQL only adds columns and can run twice', async () => {
  const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
  const pg = new PGlite();
  await pg.exec(`create table public.toast_sales (restaurant_guid text, business_date date, net_sales numeric, guest_count integer,
    primary key (restaurant_guid, business_date));
    insert into public.toast_sales values ('guid-a', '2026-10-01', 123.45, 7);`);
  const sql = readFileSync(new URL('../db/toast-sales-ld-columns.sql', import.meta.url), 'utf8');
  for (let i = 0; i < 2; i++) {
    const out = await pg.exec(sql);
    assert.equal(Number(out.at(-1).rows[0].ld_columns), 6);
  }
  const row = (await pg.query(`select * from public.toast_sales`)).rows[0];
  assert.equal(Number(row.net_sales), 123.45); assert.equal(row.guest_count, 7);
  assert.equal(row.lunch_repeat_count, 0); assert.equal(row.dinner_super_regular_count, 0);
  assert.doesNotMatch(sql, /\b(drop|delete|update|truncate)\b/i);
});
