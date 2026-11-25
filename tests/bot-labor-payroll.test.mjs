// Labor payroll period and the morning report that production sends (synthetic data only).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from './runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { createHandler, formatPayrollLaborReport } from '../supabase/functions/ops-bot/handler.mjs';

const root = new URL('../', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');
const sqlFiles = ['ops-bot', 'ops-bot-all-stores', 'ops-bot-monitor', 'ops-bot-mentions', 'ops-bot-daily-range', 'ops-bot-auth', 'ops-bot-morning-summary', 'ops-bot-morning-summary-details'];
const migrations = ['20260910184520_bot_case_closure', '20260911205005_bot_simple_completion', '20260912220724_bot_full_morning_report', '20260912224146_bot_report_responsibility', '20261220090000_bot_labor_payroll'];

async function db() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create table manager_auth(user_id uuid primary key, role text);
    create table store_config(store_id text primary key, name text, active boolean default true, restaurant_guid text);
    insert into store_config(store_id, name) values ('F01','One'), ('F02','Two');`);
  for (const f of sqlFiles) await pg.exec(read('db/' + f + '.sql'));
  for (const f of migrations) await pg.exec(read('supabase/migrations/' + f + '.sql'));
  return pg;
}
const period = async (pg, instant) => (await pg.query('select bot_labor_payroll_period($1::timestamptz) v', [instant])).rows[0].v;

test('payroll period is Wednesday, the 16th, and the 1st only', async () => {
  const pg = await db();
  const wed = await period(pg, '2026-11-25 18:00:00+00');
  assert.equal(wed.day, '2026-11-25');
  assert.equal(wed.from, '2026-11-16');
  assert.equal(wed.to, '2026-11-24');
  assert.equal(wed.payroll_to, '2026-11-30');
  assert.equal(wed.is_final, false);
  assert.equal(wed.is_scheduled, true);
  const sixteenth = await period(pg, '2026-11-16 18:00:00+00');
  assert.deepEqual([sixteenth.from, sixteenth.to, sixteenth.payroll_to, sixteenth.is_final, sixteenth.is_scheduled], ['2026-11-01', '2026-11-15', '2026-11-15', true, true]);
  const first = await period(pg, '2026-12-01 18:00:00+00');
  assert.deepEqual([first.day, first.from, first.to, first.payroll_to, first.is_final, first.is_scheduled], ['2026-12-01', '2026-11-16', '2026-11-30', '2026-11-30', true, true]);
  const thursday = await period(pg, '2026-11-26 18:00:00+00');
  assert.equal(thursday.is_scheduled, false);
  assert.equal(thursday.is_final, false);
  await pg.close();
});

test('payroll snapshot counts collection inside the period and keeps labor cases only', async () => {
  const pg = await db();
  await pg.query(`insert into bot_settings(key, value) values('collection_range', $1) on conflict (key) do update set value = excluded.value`, [JSON.stringify({ first_business_dates: { F02: '2026-11-20' } })]);
  await pg.query(`insert into bot_cases(source_key, kind, store_id, business_date, subject, status, payload)
    values ('labor-in','labor','F01','2026-11-18','In','review',$1),
           ('labor-out','labor','F01','2026-11-10','Out','review',$1),
           ('void-in','void','F01','2026-11-18','Void','review',$2)`,
    [JSON.stringify({ employee_name: 'Synthetic' }), JSON.stringify({ scope: 'payment', amount: 1 })]);
  const snap = (await pg.query(`select bot_labor_payroll_snapshot('2026-11-25 18:00:00+00') v`)).rows[0].v;
  assert.equal(snap.day, '2026-11-25');
  assert.equal(snap.labor_period.from, '2026-11-16');
  assert.equal(snap.labor_period.to, '2026-11-24');
  assert.equal(snap.detail_total, 1);
  assert.equal(snap.details[0].source_key || snap.details[0].subject, snap.details[0].subject);
  assert.ok(snap.details.every(c => c.kind === 'labor' && c.business_date >= '2026-11-16' && c.business_date <= '2026-11-24'));
  assert.equal(snap.counts.void, 0);
  const days = (await pg.query(`select store_id, business_date::text d from bot_collection_days('2026-11-25 18:00:00+00') order by 1, 2`)).rows;
  assert.equal(days[0].store_id, 'F01');
  assert.equal(days[0].d, '2026-11-01');
  assert.ok(days.filter(d => d.store_id === 'F02').every(d => d.d >= '2026-11-20'));
  await pg.exec('set role anon');
  await assert.rejects(() => pg.query('select bot_labor_payroll_snapshot()'), /permission denied/);
  await pg.close();
});

test('labor report uses the payroll window and is not sent while collection is short', async () => {
  const day = '2026-11-25';
  const row = { kind: 'labor', code: '#9', store_id: 'F01', store_name: 'One', business_date: '2026-11-18', subject: 'Synthetic', status: 'review', progress: 'waiting', shifts: [] };
  const payroll = {
    day, snapshot_at: '2026-11-25T18:00:00Z', active_stores: 1,
    labor_period: { day, from: '2026-11-16', to: '2026-11-24', expected: 2, ok: 2, failed: 0, payroll_from: '2026-11-16', payroll_to: '2026-11-30', is_final: false },
    detail_total: 1, details: [row]
  };
  const report = formatPayrollLaborReport(payroll);
  assert.equal(report.category, 'labor');
  assert.equal(report.complete, true);
  assert.match(report.messages.map(m => m.text).join('\n'), /2026-11-16〜2026-11-24/);
  assert.match(report.messages.map(m => m.text).join('\n'), /#9/);
  assert.equal(formatPayrollLaborReport({ ...payroll, labor_period: { ...payroll.labor_period, ok: 1 } }).complete, false);
  assert.throws(() => formatPayrollLaborReport({ ...payroll, details: [{ ...row, business_date: '2026-11-01' }] }), /labor_payroll_period_mismatch/);

  let pushed = 0;
  const h = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', LINE_CHANNEL_ACCESS_TOKEN: 'synthetic' })[k], fetch: async (url, init) => {
    if (url.includes('key=eq.worker')) return Response.json([{ value: { enabled: true, key: 'worker' } }]);
    if (url.includes('key=eq.clock')) return Response.json([{ value: { nightFrom: '03:00', nightTo: '05:00', longH: 12, shortMin: 15 } }]);
    if (url.includes('key=eq.morning_summary')) return Response.json([{ value: { enabled: true, group_id: 'C' + 'a'.repeat(32), label: '修正依頼', routes: { labor: { group_id: 'C' + 'a'.repeat(32), label: '修正依頼' }, finance: { group_id: 'C' + 'b'.repeat(32), label: '経理' } } } }]);
    if (url.includes('/bot_groups?')) return Response.json([{ group_id: 'C' + 'a'.repeat(32), label: '修正依頼', all_stores: true }]);
    if (url.endsWith('/rpc/bot_morning_snapshot')) return Response.json({ day, from: '2026-11-01', to: '2026-11-24', expected: 1, ok: 1, failed: 0, active_stores: 1, finance_enabled: true, finance_ok: 1, counts: { labor: 1 }, detail_total: 1, details: [row], stores: [] });
    if (url.endsWith('/rpc/bot_labor_payroll_snapshot')) return Response.json({ ...payroll, labor_period: { ...payroll.labor_period, ok: 1 } });
    if (url.endsWith('/message/push')) { pushed++; return new Response(null, { status: 200 }); }
    throw Error(url + (init ? '' : ''));
  } });
  const res = await h(new Request('https://fn.test', { method: 'POST', headers: { 'x-bot-worker-key': 'worker' }, body: JSON.stringify({ action: 'worker', mode: 'morning_summary', category: 'labor' }) }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).reports[0].reason, 'labor_collection_incomplete');
  assert.equal(pushed, 0);
});

test('the schedule file is the production cron and does not embed a worker key', () => {
  const sql = read('db/ops-bot-morning-summary-schedule.sql');
  assert.match(sql, /cron\.schedule\('ops-bot-morning-summary','0,5,10 18 \* \* \*'/);
  assert.match(sql, /"category":"labor"|'category','labor'/);
  assert.match(sql, /is_scheduled/);
  assert.match(sql, /cron\.schedule\('ops-bot-payroll-month-close-collect','\* 17 1 \* \*'/);
  assert.match(sql, /labor_payroll_collect/);
  assert.doesNotMatch(sql, /0,5,10 19 \* \* \*/);
  assert.doesNotMatch(sql, /eyJ|SUPABASE_ANON_KEY|TOAST_RESTAURANT_GUID/);
});
