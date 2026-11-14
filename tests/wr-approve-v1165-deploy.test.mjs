// v1165（UI案77）：Moto さんが貼る一式（deploy/wr-approve-v1165/）。合成データだけ（PGlite）。
// 2 の SQL は migration と同じ文字・0 の件数の SQL は db/wr-switch-count-check.sql と同じ文字・1 → 2（2 回）→ 3 がすべて OK・鍵が無い。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const D = new URL('../deploy/wr-approve-v1165/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, D), 'utf8');
const MIGS = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68',
  '20261113080000_wr_people_chef', '20261116080000_wr_people_g2', '20261120090000_work_requests_stage2', '20261121090000_chat', '20261123090000_work_requests_stage3', '20261124090000_chat_files'];

async function db(withV1164 = true) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());`);
  for (const f of MIGS) await pg.exec(M(f));
  if (withV1164) await pg.exec(M('20261125090000_wr_expense_g2'));
  return pg;
}
const by = rows => n => (rows.find(r => r.check_name.startsWith(n)) || {}).result;

test('v1165 the files Moto pastes: the SQL and the count SQL are the tested files letter for letter, and hold no keys', () => {
  assert.equal(read('2_SQL_事前経費と実費.sql'), M('20261126090000_wr_approve_v1165'));
  assert.equal(read('0_件数_読むだけ.sql'), fs.readFileSync(new URL('../db/wr-switch-count-check.sql', import.meta.url), 'utf8'));
  for (const f of fs.readdirSync(D)) assert.doesNotMatch(read(f), /pin-E\d|SUPABASE_SERVICE_ROLE_KEY=|eyJhbGci|sk_live|service_role_key/i, f + ' has no keys');
  const steps = read('手順.md');
  for (const f of fs.readdirSync(D).filter(f => f.endsWith('.sql'))) assert.ok(steps.includes(f), '手順.md names ' + f);
});

test('v1165 pre-check → the SQL (twice) → post-check: all OK; the counts run before and after; a stage 2 SQL run again shows NG until the SQL is run again', async () => {
  const pg = await db();
  let pre = by((await pg.query(read('1_最初に確認_読むだけ.sql'))).rows);
  assert.equal(pre('1.'), 'OK'); assert.equal(pre('2.'), '0'); assert.equal(pre('3.'), 'OK');
  await pg.query(read('0_件数_読むだけ.sql'));   // 入れる前も流せる
  await pg.exec(read('2_SQL_事前経費と実費.sql')); await pg.exec(read('2_SQL_事前経費と実費.sql'));
  const post = (await pg.query(read('3_確認_読むだけ.sql'))).rows;
  assert.ok(post.every(r => r.result === 'OK'), JSON.stringify(post));
  assert.equal(post.length, 6);
  assert.equal(by((await pg.query(read('1_最初に確認_読むだけ.sql'))).rows)('2.'), '1');
  await pg.query(read('0_件数_読むだけ.sql'));   // 入れたあとも流せる
  // 段階 2 の SQL をあとで流し直すと wr_row・wr_stage が前の形に戻る → 1・4 が NG → この 2 をもう一度
  await pg.exec(M('20261120090000_work_requests_stage2'));
  const again = by((await pg.query(read('3_確認_読むだけ.sql'))).rows);
  assert.match(again('1.'), /^NG/); assert.match(again('4.'), /^NG/);
  await pg.exec(read('2_SQL_事前経費と実費.sql'));
  assert.ok((await pg.query(read('3_確認_読むだけ.sql'))).rows.every(r => r.result === 'OK' || /NG（deploy\/expense-g2-v1164/.test(r.result)));
});

test('v1165 before v1164: the pre-check says STOP and the SQL changes nothing', async () => {
  const pg = await db(false);
  assert.match(by((await pg.query(read('1_最初に確認_読むだけ.sql'))).rows)('1.'), /^STOP/);
  await assert.rejects(pg.exec(read('2_SQL_事前経費と実費.sql')), /STOP: 先に段階 3/);
  assert.equal((await pg.query(`select count(*)::int n from information_schema.columns where table_name = 'wr_requests' and column_name = 'pre_id'`)).rows[0].n, 0);
});
