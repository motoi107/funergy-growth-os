// Moto さん 2026-10-30 の依頼 ②③④⑦ の「読むだけ」の SQL（本番で流してもらうもの）が、
// 何も書き換えず・合成データで期待どおりに分けることを PGlite で確かめる（本番には接続しない・名前は架空）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const sql = f => fs.readFileSync(new URL('../db/' + f, import.meta.url), 'utf8');
const FILES = ['vendor-duplicates-check.sql', 'unregistered-punch-check.sql', 'menu-sync-status-check.sql', 'purchase-price-check.sql'];
const hstToday = () => new Date(Date.now() - 10 * 3600e3).toISOString().slice(0, 10);
const D = n => new Date(Date.parse(hstToday() + 'T00:00:00Z') - n * 86400e3).toISOString().slice(0, 10);

async function db() {
  const pg = new PGlite();
  await pg.exec(`
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    create table public.stores(id text primary key, name text, toast_guid text, data jsonb);
    create table public.vendors(id text primary key, name text, data jsonb);
    create table public.ingredients(code text primary key, name text, vendor text, data jsonb);
    create table public.invoice_vendor_rules(vendor_key text primary key, display_name text, aliases text[] default '{}', merged_into text);
    create table public.invoice_docs(id uuid primary key default gen_random_uuid(), vendor_name text, status text);
    create table public.employees(id text primary key, name text, status text, data jsonb);
    create table public.tip_labor(restaurant_guid text, business_date date, data jsonb);
    create table public.toast_item_sales(id serial primary key, restaurant_guid text, business_month text, business_date date, item_guid text, item_name text, qty numeric);
    create table public.invoice_lines(id uuid primary key, qty numeric, unit_price numeric, amount_cents bigint, line_discount_cents bigint);
    create table public.invoice_price_history(id bigint generated always as identity primary key, store_id text, vendor_key text, ingredient_code text, spec_key text default '',
      purchase_unit text default '', doc_id uuid, line_id uuid, effective_date date, effective_basis text, invoice_date date, invoice_no_norm text,
      price_per_purchase numeric, price_per_count numeric, count_unit text, price_per_base numeric, base_unit text, status text default 'active');
    insert into public.stores values ('F01','One','g1','{}'),('F02','Two','g2','{}');`);
  return pg;
}
async function snapshot(pg) {
  const t = (await pg.query(`select table_name from information_schema.tables where table_schema = 'public' order by 1`)).rows.map(r => r.table_name);
  const out = {};
  for (const n of t) out[n] = (await pg.query('select * from public.' + n + ' order by 1')).rows;
  return JSON.stringify(out);
}

test('the read-only files contain no writes', () => {
  for (const f of FILES) assert.doesNotMatch(sql(f).replace(/--[^\n]*/g, ''), /\b(insert|update|delete|truncate|drop|alter|create|grant|revoke)\b/i, f);
});

test('③ vendors: same-name groups and the records tied to each card', async () => {
  const pg = await db();
  await pg.exec(`insert into public.vendors values ('v1','Sample Produce, Inc.','{"kind":"food"}'),('v2','SAMPLE PRODUCE','{}'),('v3','Other Fish LLC','{"deleted":true}');
    insert into public.ingredients values ('i1','Onion','Sample Produce, Inc.','{}');
    insert into public.invoice_vendor_rules values ('sample','SAMPLE PRODUCE','{"Sample Produce Inc"}',null);
    insert into public.invoice_docs(vendor_name, status) values ('SAMPLE PRODUCE','posted'),('SAMPLE PRODUCE','review'),('SAMPLE PRODUCE','rejected');
    insert into public.app_state(key, value) values ('spl_invoices_F01', '[{"vendor":"Sample Produce, Inc."},{"vendor":"Other Fish LLC"}]'),
      ('spl_invoices_F02', '{"__st":1,"v":[{"vendor":"Sample Produce, Inc."}]}');`);
  const before = await snapshot(pg);
  const rows = (await pg.query(sql('vendor-duplicates-check.sql'))).rows;
  assert.equal(await snapshot(pg), before);
  const by = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.equal(Number(by.v1.same_key), 2); assert.equal(by.v1.key, by.v2.key);
  assert.equal(Number(by.v1.app_invoices), 2); assert.equal(Number(by.v1.ingredients), 1);
  assert.equal(Number(by.v2.drive_docs), 2, 'rejected documents are not counted'); assert.equal(by.v2.intake_rule, 'sample');
  assert.equal(Number(by.v3.same_key), 1); assert.match(by.v3.flags, /deleted/);
  assert.equal(rows[0].same_key, 2, 'candidates first');
  await pg.close();
});

test('④ punches: every raw Toast name is matched the way the import does it (no special names)', async () => {
  const pg = await db();
  await pg.exec(`insert into public.employees values
      ('e1','Ann Sample','在籍','{}'),('e2','Ben Example','退職','{}'),('e3','Cara Test','在籍','{"toastAlias_caratest2":"2026-10-01"}'),
      ('e4','Dee','在籍','{}'),('e5','Eve Case','在籍','{}');`);
  const day = (n, names) => pg.query('insert into public.tip_labor values ($1,$2,$3)', ['g1', D(n), JSON.stringify(names.map(x => ({ name: x, lunchHours: 3, dinnerHours: 2 })))]);
  await day(1, ['Ann Sample', 'Ben Example', 'Cara Test 2', 'Dee Newcomer', 'EVE CASE', 'Zed Unknown']);
  await day(2, ['Zed Unknown']);
  await day(90, ['Old Name']);
  const before = await snapshot(pg);
  const rows = (await pg.query(sql('unregistered-punch-check.sql'))).rows;
  assert.equal(await snapshot(pg), before);
  const m = Object.fromEntries(rows.map(r => [r.toast_name, r.match]));
  assert.deepEqual(m, { 'Ann Sample': 'exact', 'Ben Example': 'exact_resigned', 'Cara Test 2': 'alias', 'Dee Newcomer': 'part→Dee', 'EVE CASE': 'case', 'Zed Unknown': 'none' });
  const z = rows.find(r => r.toast_name === 'Zed Unknown');
  assert.equal(Number(z.days), 2); assert.equal(Number(z.hours), 10); assert.equal(z.store_id, 'F01');
  await pg.close();
});

test('⑦ menu: rows, days, gaps, double rows per store and month', async () => {
  const pg = await db();
  const ym = D(1).slice(0, 7);
  await pg.query(`insert into public.toast_item_sales(restaurant_guid, business_month, business_date, item_guid, item_name, qty) values
      ('g1',$1,$2,'a','A',3),('g1',$1,$2,'a','A',3),('g1',$1,$3,'b','B',1),('g1',$1,null,'a','A',9),('g2',$1,$2,null,'X',1)`, [ym, D(1), D(2).slice(0, 7) === ym ? D(2) : D(1)]);
  const before = await snapshot(pg);
  const rows = (await pg.query(sql('menu-sync-status-check.sql'))).rows;
  assert.equal(await snapshot(pg), before);
  const f1 = rows.find(r => r.store_id === 'F01' && r.ym === ym);
  assert.equal(Number(f1.rows), 4); assert.equal(Number(f1.month_rows), 1);
  assert.equal(Number(f1.dup_groups), 1); assert.equal(Number(f1.both_kinds), 1);
  assert.ok(Number(f1.missing_days) >= 0);
  assert.equal(Number(rows.find(r => r.store_id === 'F02').no_guid), 1);
  await pg.close();
});

test('② prices: the latest and the previous confirmed price for the same item, spec and unit', async () => {
  const pg = await db();
  await pg.exec(`insert into public.invoice_lines values ('00000000-0000-4000-8000-000000000001', 2, 60, 12000, null), ('00000000-0000-4000-8000-000000000002', 4, 60, 24000, null);
    insert into public.invoice_price_history(store_id, vendor_key, ingredient_code, purchase_unit, line_id, effective_date, effective_basis, invoice_no_norm, price_per_purchase, price_per_count, count_unit, price_per_base, base_unit) values
      ('F01','v','1001','CS','00000000-0000-4000-8000-000000000001','2026-10-01','invoice','100',60,5,'ea',5,'ea'),
      ('F01','v','1001','CS','00000000-0000-4000-8000-000000000002','2026-10-08','invoice','101',60,5,'ea',5,'ea'),
      ('F01','v','1002','LB',null,'2026-10-01','invoice','100',3.2,null,null,0.00705,'g'),
      ('F01','v','1002','LB',null,'2026-10-08','invoice','101',3.52,null,null,0.00776,'g');`);
  const before = await snapshot(pg);
  const rows = (await pg.query(sql('purchase-price-check.sql'))).rows;
  assert.equal(await snapshot(pg), before);
  const by = Object.fromEntries(rows.map(r => [r.ingredient_code, r]));
  assert.equal(Number(by['1001'].chg_pct), 0, 'twice the cases at the same price is no increase');
  assert.equal(Number(by['1001'].line_check), 0);
  assert.equal(Number(by['1002'].chg_pct), 10.1);
  assert.equal(rows[0].ingredient_code, '1002', 'the biggest change first');
  await pg.close();
});

test('② prices (Codex on 42fe938): the 80 rows are chosen by the change they show — a case at the same $60 holding half as much is +100 % per base unit', async () => {
  const pg = await db();
  await pg.exec(`insert into public.invoice_price_history(store_id, vendor_key, ingredient_code, spec_key, purchase_unit, effective_date, effective_basis, invoice_no_norm, price_per_purchase, price_per_base, base_unit) values
      ('F01','v','2001','10LB','CS','2026-10-01','invoice','100',60,0.013228,'g'),
      ('F01','v','2001','10LB','CS','2026-10-08','invoice','101',60,0.026455,'g'),
      ('F01','v','2002','','CS','2026-10-01','invoice','100',50,0.01,'g'),
      ('F01','v','2002','','CS','2026-10-08','invoice','101',55,0.011,'g');`);
  for (let i = 0; i < 90; i++)   // more than 80 rows: the smaller changes must not push the big one out
    await pg.query(`insert into public.invoice_price_history(store_id, vendor_key, ingredient_code, purchase_unit, effective_date, effective_basis, invoice_no_norm, price_per_purchase) values
      ('F02','w',$1,'CS','2026-10-01','invoice','100',100),('F02','w',$1,'CS','2026-10-08','invoice','101',$2)`, ['3' + String(i).padStart(3, '0'), 100 + 1 + (i % 40)]);
  const rows = (await pg.query(sql('purchase-price-check.sql'))).rows;
  assert.equal(rows.length, 80);
  const i1 = rows.findIndex(r => r.ingredient_code === '2001');
  assert.ok(i1 >= 0, 'the +100 % per base unit is kept in the 80 rows');
  assert.equal(Number(rows[i1].chg_pct), 100);
  assert.equal(i1, 0, 'and comes first');
  for (let i = 1; i < rows.length; i++) assert.ok(Math.abs(Number(rows[i - 1].chg_pct)) >= Math.abs(Number(rows[i].chg_pct)), 'ordered by the shown change');
  await pg.close();
});
