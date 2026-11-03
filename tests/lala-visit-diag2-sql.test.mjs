// db/lala-visit-diag-2.sql（読むだけ）：来店区分らしい商品（Customer Property など）と注文の数・LaLa の日ごと（合成データ・PGlite）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const SQL = fs.readFileSync(new URL('../db/lala-visit-diag-2.sql', import.meta.url), 'utf8');
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
test('Customer Property の商品・注文の数・LaLa の日ごとの客数と並べる（business_date が date の列でも止まらない）', async () => {
  const pg = new PGlite();
  await pg.exec(`create table public.stores(id text primary key, toast_guid text);
    create table public.toast_menu_items(id serial, restaurant_guid text, guid text, category text, name text, price numeric, active boolean, synced_at timestamptz);
    create table public.toast_item_sales(id serial, restaurant_guid text, item_guid text, business_month text, qty numeric, synced_at timestamptz, business_date date);
    create table public.toast_sales(id serial, restaurant_guid text, business_date date, net_sales numeric, guest_count int, order_count int);
    insert into stores values ('F01','g1'),('F06','g6');
    insert into toast_menu_items(restaurant_guid,guid,category,name,price,active) values ('g6','x1','Customer Property','FT',0,true),('g6','x2','Customer Property','RP',0,true),('g6','x3','Customer Property','SR',0,true),('g1','a1','Customers','FT',0,true),('g6','b1','Beer','Draft',8,true);
    insert into toast_item_sales(restaurant_guid,item_guid,qty,business_date) values ('g6','x1',3,current_date-2),('g6','x2',5,current_date-2),('g1','a1',9,current_date-3),('g6','b1',40,current_date-2);
    insert into toast_sales(restaurant_guid,business_date,net_sales,guest_count,order_count) values ('g6',current_date-2,1234.567,40,15),('g6',current_date-3,999,30,10);`);
  const rows = (await pg.query(SQL)).rows;
  const cand = rows.filter(r => r.part === 'cand');
  assert.equal(cand.length, 4, 'Draft は来店区分らしい商品ではない');
  assert.ok(cand.some(r => r.store === 'F06' && r.a === 'Customer Property' && r.b === 'RP' && r.e === 'qty 5 / days 1'));
  assert.ok(cand.some(r => r.store === 'F06' && r.b === 'SR' && r.f === '（注文に無し）'));
  const ld = rows.filter(r => r.part === 'lala_d');
  assert.equal(ld.length, 2);
  assert.ok(ld.some(r => /guests 40 \/ orders 15/.test(r.b) && r.c === 'FT 3 · RP 5 · SR 0'));
  await pg.close();
});
