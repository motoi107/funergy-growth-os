// v1132 work-requests 2 段目：Moto さんが貼るファイル（deploy/work-requests-v1132）が migration と同じか・確認の SQL が読むべきものを読むか。合成の DB。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const D = new URL('../deploy/work-requests-v1132/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, D), 'utf8');
const M1 = fs.readFileSync(new URL('../supabase/migrations/20261104090000_work_requests.sql', import.meta.url), 'utf8');
const M2 = fs.readFileSync(new URL('../supabase/migrations/20261105090000_work_requests_eval.sql', import.meta.url), 'utf8');

test('the SQL to paste is the stage-2 migration, letter for letter; the steps say the order', () => {
  assert.equal(read('2_追加のSQL.sql'), M2);
  const h = read('手順.md');
  assert.match(h, /Verify JWT は OFF/); assert.match(h, /#123（v1131）→ この PR/); assert.match(h, /もう一度/);
});

async function base() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    insert into public.manager_auth(role, emp_id) values ('gm','E2'),('office','E3');`);
  return pg;
}

test('without stage 1 the pre-check says STOP and the SQL changes nothing', async () => {
  const pg = await base();
  const pre = (await pg.query(read('1_最初に確認_読むだけ.sql'))).rows;
  assert.ok(pre.some(r => /^STOP/.test(r.result)), JSON.stringify(pre)); assert.equal(pre.find(r => /^live/.test(r.check_name)).result, '—');
  await assert.rejects(pg.exec(M2), /STOP: 先に 20261104090000/);
  assert.equal((await pg.query(`select to_regclass('public.wr_views') v`)).rows[0].v, null);
});

test('pre-check, post-check, twice, and re-running stage 1 is caught', async () => {
  const pg = await base();
  await pg.exec(M1);
  const pre = (await pg.query(read('1_最初に確認_読むだけ.sql'))).rows;
  assert.ok(pre.every(r => !/^STOP/.test(r.result)), JSON.stringify(pre));
  assert.equal(pre.find(r => /もう入っている/.test(r.check_name)).result, '0');
  assert.equal(pre.find(r => /functions now/.test(r.check_name)).result, '44');
  assert.equal(pre.find(r => /^live/.test(r.check_name)).result, 'false');
  assert.equal(pre.find(r => /G4 以上/.test(r.check_name)).result, '0');
  const post = async () => { const rows = (await pg.query(read('3_確認のSQL_読むだけ.sql'))).rows; return n => rows.find(r => r.check_name.startsWith(n)).result; };
  await pg.exec(M2);
  let by = await post();
  for (const n of ['wr_views', 'row level', 'browser roles cannot read', 'browser roles cannot run', '1 段目の関数', '振り分け']) assert.equal(by(n), 'OK', n);
  assert.equal(by('functions'), '55');
  await pg.exec(M2);
  by = await post(); assert.equal(by('functions'), '55', 'twice: the same'); assert.equal(by('振り分け'), 'OK');
  await pg.exec(M1);
  by = await post(); assert.match(by('振り分け'), /^NG/, 'stage 1 again puts its own wr_submit back');
  await pg.exec(M2);
  by = await post(); assert.equal(by('振り分け'), 'OK'); assert.equal(by('functions'), '55');
  assert.equal(by('browser roles cannot run'), 'OK');
});

// 1 段目と 2 段目をまとめて入れる一式（deploy/work-requests-v1131-v1132）
const DA = new URL('../deploy/work-requests-v1131-v1132/', import.meta.url);
const readA = f => fs.readFileSync(new URL(f, DA), 'utf8');

test('the combined set: the SQL is stage 1 then stage 2, letter for letter; the steps say the order', () => {
  assert.equal(readA('2_SQL_1段目と2段目.sql'), M1 + '\n' + M2);
  assert.equal(readA('1_最初に確認_読むだけ.sql'), fs.readFileSync(new URL('../deploy/work-requests-v1131/1_最初に確認_読むだけ.sql', import.meta.url), 'utf8'));
  const h = readA('手順.md');
  assert.match(h, /Verify JWT は OFF/); assert.match(h, /#122 → #123 → #124/); assert.match(h, /work-requests_v1132_index\.ts/);
});

test('the combined set on a fresh database: pre-check, the SQL (twice), the check has no NG', async () => {
  const pg = await base();
  await pg.exec(`insert into public.app_state(key, value) values ('mileage_config', '{"ratePerMile":0.7}')`);
  const pre = (await pg.query(readA('1_最初に確認_読むだけ.sql'))).rows;
  assert.ok(pre.every(r => !/^STOP/.test(r.result)), JSON.stringify(pre));
  const check = async () => (await pg.query(readA('3_確認_読むだけ.sql'))).rows;
  await pg.exec(readA('2_SQL_1段目と2段目.sql'));
  let rows = await check();
  assert.ok(rows.filter(r => /^\d\./.test(r.check_name)).every(r => r.result === 'OK'), JSON.stringify(rows));
  assert.equal(rows.find(r => /使い始めたか/.test(r.check_name)).result, 'false');
  await pg.exec(readA('2_SQL_1段目と2段目.sql'));
  rows = await check();
  assert.ok(rows.filter(r => /^\d\./.test(r.check_name)).every(r => r.result === 'OK'), 'twice: the same ' + JSON.stringify(rows));
  // 2 段目が抜けていれば NG が出る
  const pg2 = await base(); await pg2.exec(M1);
  const ng = (await pg2.query(readA('3_確認_読むだけ.sql'))).rows;
  assert.ok(ng.some(r => /^NG/.test(r.result)), 'stage 1 only shows NG');
});

// v1133：1 段目・2 段目・反映の押さえをまとめて入れる一式（deploy/work-requests-v1131-v1133）。前の v1131／v1132 の一式の代わり
const DB = new URL('../deploy/work-requests-v1131-v1133/', import.meta.url);
const readB = f => fs.readFileSync(new URL(f, DB), 'utf8');
const M3 = fs.readFileSync(new URL('../supabase/migrations/20261106090000_work_requests_apply_claim.sql', import.meta.url), 'utf8');
const okAll = rows => rows.filter(r => /^\d\./.test(r.check_name)).every(r => r.result === 'OK');

test('v1133 set: the SQL is stage 1, stage 2 and the v1133 SQL, letter for letter; the steps name the v1133 file', () => {
  assert.equal(readB('2_SQL_まとめて.sql'), M1 + '\n' + M2 + '\n' + M3);
  assert.equal(readB('1_最初に確認_読むだけ.sql'), fs.readFileSync(new URL('../deploy/work-requests-v1131/1_最初に確認_読むだけ.sql', import.meta.url), 'utf8'));
  const h = readB('手順.md');
  assert.match(h, /Verify JWT は OFF/); assert.match(h, /work-requests_v1133_index\.ts/); assert.match(h, /1133/);
  assert.match(h, /入れていても、入れていなくても/, 'one procedure whether or not the v1132 files went in');
  assert.match(readA('手順.md'), /work-requests-v1131-v1133/, 'the earlier set points at this one');
});

test('v1133 set on a fresh database (twice) and on top of the v1132 set with requests in it: no NG, nothing lost', async () => {
  const pg = await base();
  await pg.exec(`insert into public.app_state(key, value) values ('mileage_config', '{"ratePerMile":0.7}')`);
  assert.ok((await pg.query(readB('1_最初に確認_読むだけ.sql'))).rows.every(r => !/^STOP/.test(r.result)));
  const check = async (db = pg) => (await db.query(readB('3_確認_読むだけ.sql'))).rows;
  await pg.exec(readB('2_SQL_まとめて.sql'));
  let rows = await check(); assert.ok(okAll(rows), JSON.stringify(rows));
  await pg.exec(readB('2_SQL_まとめて.sql'));
  rows = await check(); assert.ok(okAll(rows), 'twice: the same ' + JSON.stringify(rows));
  // the v1132 set went in and requests exist (live): the v1133 set keeps them and adds the claim
  const pg2 = await base();
  await pg2.exec(`insert into public.app_state(key, value) values ('mileage_config', '{"ratePerMile":0.7}')`);
  await pg2.exec(readA('2_SQL_1段目と2段目.sql'));
  const v1132 = await check(pg2);
  assert.match(v1132.find(r => /^6\./.test(r.check_name)).result, /^NG/, 'the v1132 set alone shows the claim is missing');
  await pg2.exec(`update public.wr_settings set live = true;
    insert into public.wr_requests(code, kind, status, store_id, requester_emp, requester_name, target_emp, target_name, payload)
     values ('SK-2611-0001','skill','approved','S1','E6','Sam Store','E8','Cam Crew','{"items":[{"pos":"Grill","from":1,"to":2}],"reason":"r"}'),
            ('GS-2611-0001','mileage','pending','S1','E7','Lee Leader',null,null,'{}');`);
  await pg2.exec(readB('2_SQL_まとめて.sql'));
  rows = await check(pg2); assert.ok(okAll(rows), JSON.stringify(rows));
  const kept = (await pg2.query(`select code, status, apply_key from public.wr_requests order by code`)).rows;
  assert.deepEqual(kept, [{ code: 'GS-2611-0001', status: 'pending', apply_key: null }, { code: 'SK-2611-0001', status: 'approved', apply_key: null }]);
  assert.equal((await pg2.query(`select live from public.wr_settings where id = 1`)).rows[0].live, true, 'still live');
});
