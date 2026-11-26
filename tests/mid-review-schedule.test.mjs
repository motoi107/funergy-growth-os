// New mid-reviews take submit_day from mr_settings. Late submission stays allowed. Notices stay off.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from './runtime/node_modules/@electric-sql/pglite/dist/index.js';

const mig = f => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8');
const chain = ['20261012090000_mid_review.sql', '20261013090000_mid_review_fixes.sql', '20261015090000_mid_review_v2.sql', '20261016090000_mid_review_v2_versions.sql', '20261017090000_mid_review_stores_save_fix.sql', '20261018090000_mid_review_scope_gm.sql', '20261220100000_mr_schedule_deadlines.sql'];

async function setup() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table manager_auth(user_id uuid primary key, role text, emp_id text);
    create table employees(id text primary key, name text, role text, title text, status text);
    create table stores(id text primary key, name text, am text, active boolean);`);
  for (const f of chain) await pg.exec(mig(f));
  await pg.exec(`insert into mr_stores(env, store_id, name) values ('live','F01','One'), ('live','F02','Two')`);
  return pg;
}

test('schedule is the 20th and a new review uses it; an existing empty deadline is kept', async () => {
  const pg = await setup();
  const schedule = (await pg.query(`select value, (value->>'notify') as notify_key from mr_settings where key = 'schedule'`)).rows[0].value;
  assert.deepEqual(schedule, { submit_day: 20, reply_day: 21, decide_day: 21, consult_from: 21, consult_to: 23 });
  const flags = (await pg.query(`select value from mr_settings where key = 'flags'`)).rows[0].value;
  assert.equal(flags.notify, false);
  assert.equal((await pg.query(`select mr_default_deadlines('2026-11') d`)).rows[0].d.submit, '2026-11-20');
  assert.equal((await pg.query(`select mr_default_deadlines('2026-02') d`)).rows[0].d.submit, '2026-02-20');
  await pg.query(`update mr_settings set value = jsonb_set(value, '{submit_day}', '31'::jsonb) where key = 'schedule'`);
  assert.deepEqual((await pg.query(`select mr_default_deadlines('2026-02') d`)).rows[0].d, {});
  await pg.query(`update mr_settings set value = '{"submit_day":20,"reply_day":21,"decide_day":21,"consult_from":21,"consult_to":23}' where key = 'schedule'`);

  const created = (await pg.query(`select deadlines from mr_review_row('live','F01','2026-11')`)).rows[0].deadlines;
  assert.deepEqual(created, { submit: '2026-11-20' });
  await pg.query(`update mr_reviews set deadlines = '{"submit":"2026-11-18","reply":"2026-11-21"}' where store_id = 'F01' and ym = '2026-11'`);
  const kept = (await pg.query(`select deadlines from mr_review_row('live','F01','2026-11')`)).rows[0].deadlines;
  assert.deepEqual(kept, { submit: '2026-11-18', reply: '2026-11-21' });

  await pg.query(`insert into mr_reviews(env, store_id, ym, status, body, deadlines, version) values ('live','F02','2026-11','draft','{"v":2}','{}',0)`);
  const empty = (await pg.query(`select deadlines from mr_review_row('live','F02','2026-11')`)).rows[0].deadlines;
  assert.deepEqual(empty, {});
  await pg.close();
});

test('a past submit date is overdue and mr_submit still has no deadline rejection', async () => {
  const pg = await setup();
  await pg.query(`select mr_review_row('live','F01','2026-11')`);
  await pg.query(`update mr_reviews set deadlines = '{"submit":"2020-01-20"}' where store_id = 'F01'`);
  const overdue = (await pg.query(`select mr_overdue(x) v from mr_reviews x where store_id = 'F01'`)).rows[0].v;
  assert.equal(overdue.submit, true);
  const v2 = mig('20261015090000_mid_review_v2.sql');
  const submit = v2.slice(v2.indexOf('function public.mr_submit'), v2.indexOf('function public.mr_post'));
  assert.doesNotMatch(submit, /deadlines|overdue|submit_day/);
  assert.doesNotMatch(mig('20261220100000_mr_schedule_deadlines.sql'), /function public\.mr_submit|notify'\s*,\s*true|"notify":\s*true/);
  await pg.close();
});

test('the screen says a late report can still be submitted and does not disable the button for that', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /提出期限を過ぎています（まだ提出できます）/);
  assert.match(html, /期限超過・提出できます/);
  assert.match(html, /期限を過ぎても提出は止まりません/);
  const submit = html.slice(html.indexOf('function mrSubmitSec'), html.indexOf('function mrSubBarInner'));
  assert.match(submit, /このまま提出できます/);
  assert.doesNotMatch(submit, /overdue[^;]{0,120}disabled|disabled[^;]{0,80}overdue/);
  const bar = html.slice(html.indexOf('function mrSubBarInner'), html.indexOf('function mrReviewSec'));
  assert.match(bar, /g\.length \|\| _mr\.busy \|\| same \? 'disabled'/);
  assert.match(bar, /提出できます（期限は過ぎています）/);
});
