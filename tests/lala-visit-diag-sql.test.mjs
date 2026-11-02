// db/lala-visit-diag.sql（読むだけ）が、本番と同じ形の表で止まらずに 1 つの表を返すか（合成データ・PGlite）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SQL = fs.readFileSync(new URL('../db/lala-visit-diag.sql', import.meta.url), 'utf8');
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');

test('LaLa の来店区分の確かめ：Customers の出数と FT・RP・SR、LaLa の日ごと・商品ごと・レシピが 1 つの表で出る', async () => {
  const pg = new PGlite();
  await pg.exec(`
    create table public.stores(id text primary key, name text, toast_guid text);
    create table public.toast_sales(id serial primary key, restaurant_guid text, business_date text, net_sales numeric, guest_count int,
      first_time_count int, repeat_count int, super_regular_count int, fetched_at timestamptz default now());
    create table public.toast_item_sales(id serial primary key, restaurant_guid text, item_guid text, business_month text, qty numeric,
      synced_at timestamptz default now(), business_date text);
    create table public.toast_menu_items(id serial primary key, restaurant_guid text, guid text, name text, category text, price numeric, active boolean);
    create table public.recipes(id text primary key, name text, category text, store text, toast_guid text, sell_price numeric, data jsonb);
    insert into public.stores values ('F01','ToriTon','g-tori'),('F02','Tenkichi','g-ten'),('F06','LaLa','g-lala'),('F03','FSP',null);`);
  const today = new Date(Date.now() - 10 * 3600 * 1000);
  const day = n => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10);
  for (const n of [1, 2, 3]) {
    await pg.query(`insert into toast_sales(restaurant_guid,business_date,net_sales,guest_count,first_time_count,repeat_count,super_regular_count)
      values ('g-tori',$1,1000,50,10,6,2),('g-lala',$1,2000,40,0,0,0)`, [day(n)]);
    await pg.query(`insert into toast_item_sales(restaurant_guid,business_month,business_date,item_guid,qty)
      values ('g-tori',$2,$1,'i1',30),('g-tori',$2,$1,'ft-guid-0001',10),('g-tori',$2,$1,'rp-guid-0002',4),('g-tori',$2,$1,'sr-guid-0003',2),
             ('g-lala',$2,$1,'lala-hb-0009',12),('g-lala',$2,$1,'lala-xx-0010',7)`, [day(n), day(n).slice(0, 7)]);
  }
  await pg.exec(`insert into toast_menu_items(restaurant_guid,guid,name,category) values
    ('g-tori','ft-guid-0001','FT','Customers'),('g-tori','rp-guid-0002','RP',' customers '),('g-tori','sr-guid-0003','SR','Customers'),('g-tori','i1','Chicken Bowl','Bowls')`);
  await pg.exec(`insert into recipes(id,name,category,store,toast_guid,data) values
    ('r1','Highball','Drinks',null,'lala-hb-0009','{"storeId":"F06","toastGuid":"lala-hb-0009"}'),
    ('r2','Edamame','Food',null,null,'{"storeId":"F06"}')`);
  const rows = (await pg.query(SQL)).rows;
  const pick = p => rows.filter(x => x.part === p);
  assert.equal(pick('cols').length, 3);
  const mn = pick('menu_n');
  assert.equal(mn.length, 3, 'Toast の店（GUID のある店）ごとに 1 行');
  assert.ok(mn.some(x => x.store === 'F01' && x.b === 'rows 4' && x.c === 'customers 3'));
  assert.ok(mn.some(x => x.store === 'F06' && x.b === 'rows 0'), 'LaLa のメニューの表が空なことが分かる');
  const cu = pick('cust');
  assert.ok(cu.some(x => x.store === 'F01' && x.a === 'FT' && x.c === 'qty 30' && x.d === 'days 3'));
  assert.ok(cu.some(x => x.store === 'F01' && x.a === 'RP' && x.c === 'qty 12'), 'カテゴリーの前後の空白・大文字小文字は見ない');
  assert.ok(cu.some(x => x.store === 'F01' && x.a === '(toast_sales)' && x.c === 'FT 30 / RP 18 / SR 6'));
  const ld = pick('lala_d');
  assert.equal(ld.length, 3);
  assert.ok(ld.every(x => /FT 0 \/ RP 0 \/ SR 0/.test(x.c) && /item_rows 2 \/ qty 19 \/ items 2/.test(x.e)));
  const li = pick('lala_i');
  assert.equal(li.length, 2);
  assert.ok(li.some(x => x.a === '…-hb-0009' && x.b === 'qty 36' && /Highball \[Drinks\]/.test(x.d) && /メニューの表になし/.test(x.e)));
  assert.ok(li.some(x => x.a === '…-xx-0010' && /レシピなし/.test(x.d)));
  const rp = pick('recipe');
  assert.ok(rp.some(x => x.a === 'Drinks' && x.c === 'with_toast_id 1'));
  assert.ok(rp.some(x => x.a === 'Food' && x.c === 'with_toast_id 0'));
  await pg.close();
});
