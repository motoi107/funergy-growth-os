// db/lala-menu-repeat-check.sql（読むだけ）が、本番と同じ形の表で止まらずに 1 つの表を返すか（合成データ・PGlite）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SQL = fs.readFileSync(new URL('../db/lala-menu-repeat-check.sql', import.meta.url), 'utf8');
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');

test('LaLa の出数・来店区分の確かめ：1 つの表で、欠けた日と来店区分の無い日が分かる', async () => {
  const pg = new PGlite();
  await pg.exec(`
    create table public.stores(id text primary key, name text, toast_guid text);
    create table public.toast_sales(id serial primary key, restaurant_guid text, business_date text, net_sales numeric, guest_count int,
      first_time_count int, repeat_count int, super_regular_count int, lunch_first_time_count int, lunch_repeat_count int,
      dinner_first_time_count int, dinner_repeat_count int, updated_at timestamptz default now());
    create table public.toast_item_sales(id serial primary key, restaurant_guid text, business_month text, business_date text, item_guid text, item_name text, qty numeric);
    create table public.toast_item_modifier_sales(id serial primary key, restaurant_guid text, business_date text, item_guid text, modifier_name text, qty numeric);
    create table public.toast_menu_items(id serial primary key, restaurant_guid text, item_guid text, name text, category text, price numeric);
    insert into public.stores values ('F01','ToriTon','g-tori'),('F02','Tenkichi','g-ten'),('F06','LaLa','g-lala');`);
  const today = new Date(Date.now() - 10 * 3600 * 1000);
  const day = n => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10);
  for (const n of [1, 2, 3]) {
    await pg.query(`insert into toast_sales(restaurant_guid,business_date,net_sales,guest_count,first_time_count,repeat_count,super_regular_count) values ('g-tori',$1,1000,50,10,6,2),('g-lala',$1,2000,40,0,0,0)`, [day(n)]);
    await pg.query(`insert into toast_item_sales(restaurant_guid,business_month,business_date,item_guid,item_name,qty) values ('g-tori',$2,$1,'i1','Chicken Bowl',30),('g-tori',$2,$1,'ft','FT',10)`, [day(n), day(n).slice(0, 7)]);
  }
  await pg.query(`insert into toast_item_sales(restaurant_guid,business_month,business_date,item_guid,item_name,qty) values ('g-lala',$2,$1,'l1','Highball',12)`, [day(1), day(1).slice(0, 7)]);
  await pg.query(`insert into toast_item_modifier_sales(restaurant_guid,business_date,item_guid,modifier_name,qty) values ('g-lala',$1,'l1','Repeat guest',1)`, [day(1)]);
  await pg.exec(`insert into toast_menu_items(restaurant_guid,item_guid,name,category) values ('g-tori','ft','FT','Customers'),('g-tori','rp','RP','Customers'),('g-lala','l1','Highball','Drinks')`);
  const r = await pg.query(SQL);
  const rows = r.rows;
  const pick = p => rows.filter(x => x.part === p);
  assert.equal(pick('cols').length, 4);
  assert.equal(pick('store').length, 3);
  // 店・月ごとの行。3 日が月をまたぐ日（月の 1〜2 日）もあるので、月の行を足して比べる（11/02 の CI で 1 か月分だけ見て落ちた）
  const sumOf = (store, col, re) => pick('sales_m').filter(x => x.store === store).reduce((t, x) => t + Number((re.exec(String(x[col])) || [0, 0])[1]), 0);
  assert.equal(sumOf('F06', 'b', /days_sales (\d+)/), 3);
  assert.equal(sumOf('F06', 'c', /FT (\d+)/) + sumOf('F06', 'c', /RP (\d+)/) + sumOf('F06', 'c', /SR (\d+)/), 0);
  assert.equal(sumOf('F06', 'e', /sales_no_vt (\d+)/), 3);
  assert.equal(sumOf('F01', 'c', /FT (\d+)/), 30); assert.equal(sumOf('F01', 'c', /RP (\d+)/), 18); assert.equal(sumOf('F01', 'c', /SR (\d+)/), 6);
  const gaps = pick('items_d').filter(x => x.store === 'F06');
  assert.equal(gaps.length, 3);
  assert.equal(gaps.filter(x => /欠け/.test(x.e)).length, 2, '売上はあるのに出数の行が無い日');
  assert.ok(pick('vt_name').some(x => x.store === 'F01' && x.a === 'menu' && x.b === 'FT'));
  assert.ok(pick('vt_name').some(x => x.store === 'F06' && x.a === 'modifier' && /Repeat/.test(x.b)));
  assert.ok(pick('menu_cat').some(x => x.store === 'F01' && x.a === 'Customers'));
  await pg.close();
});
