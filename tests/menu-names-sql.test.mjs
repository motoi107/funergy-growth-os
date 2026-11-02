// db/menu-names-check.sql（読むだけ）が、本番と同じ形の表（toast_item_sales に商品名の列なし・toast_menu_items は guid）で止まらずに、
// アプリと同じ決まり（名前・カテゴリーはメニューの表・来店区分は Customers のグループ）で数えるか（合成データ・PGlite）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SQL = fs.readFileSync(new URL('../db/menu-names-check.sql', import.meta.url), 'utf8');
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');

test('メニュー出数の照合：月ごとの来店区分・名前のある出数・表に無い商品・先月の上位 10', async () => {
  const pg = new PGlite();
  assert.doesNotMatch(SQL, /\b(insert|update|delete|alter|drop|create|truncate|grant)\b/i, 'read only');
  await pg.exec(`
    create table public.stores(id text primary key, name text, toast_guid text);
    create table public.toast_item_sales(id serial primary key, restaurant_guid text, item_guid text, business_month text, qty numeric, synced_at timestamptz default now(), business_date text);
    create table public.toast_menu_items(id serial primary key, restaurant_guid text, guid text, category text, name text, price numeric, active boolean, synced_at timestamptz default now());
    insert into public.stores values ('F01','ToriTon','g-tori'),('F06','LaLa','g-lala'),('F09','NoToast','');
    insert into toast_menu_items(restaurant_guid,guid,category,name,price,active) values
      ('g-tori','i1','Yakitori','Negima',4,true),('g-tori','i2','Beer','Draft',7,true),('g-tori','ft','Customers','FT',0,true),('g-tori','rp',' customers','RP',0,true),
      ('g-tori','i3','Appetizers','FT Special',9,true),('g-tori','i4','Other','Old Dish',5,false);`);
  const now = new Date(Date.now() - 10 * 3600 * 1000), lm = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 3)).toISOString().slice(0, 10);
  await pg.query(`insert into toast_item_sales(restaurant_guid,item_guid,business_month,qty,business_date) values
    ('g-tori','i1',$2,10,$1),('g-tori','i2',$2,6,$1),('g-tori','ft',$2,30,$1),('g-tori','rp',$2,20,$1),('g-tori','i3',$2,2,$1),('g-tori','i4',$2,1,$1),
    ('g-tori','zz-unknown-abcdef',$2,3,$1),('g-lala','l1',$2,8,$1)`, [lm, lm.slice(0, 7)]);
  const rows = (await pg.query(SQL)).rows;
  const pick = (p, s) => rows.filter(x => x.part === p && (!s || x.store === s));
  const m = pick('month', 'F01').find(x => x.a === lm.slice(0, 7));
  assert.match(m.b, /rows 7 \/ qty 72/); assert.equal(m.c, 'visit 50'); assert.equal(m.d, 'named 19');
  assert.equal(m.e, 'not_in_menu 3 (1 items)'); assert.equal(m.f, 'with_category 19');
  const lala = pick('month', 'F06')[0]; assert.equal(lala.e, 'not_in_menu 8 (1 items)', 'LaLa without a menu table: every item is "not in menu"');
  assert.match(pick('menu', 'F01')[0].e, /customers 2/); assert.match(pick('menu', 'F01')[0].d, /inactive 1/); assert.match(pick('menu', 'F06')[0].b, /rows 0/);
  const top = pick('top', 'F01').map(x => x.c);
  assert.deepEqual(top, ['Negima', 'Draft', '(not in menu …abcdef)', 'FT Special', 'Old Dish'], 'visit types are not in the top list; a dish named FT … is');
  assert.deepEqual(pick('visit', 'F01').map(x => x.b).sort(), ['FT', 'RP']);
  assert.deepEqual(pick('unknown', 'F01').map(x => [x.a, x.b]), [['abcdef', '3']]);
  assert.equal(pick('month', 'F09').length, 0, 'stores without Toast are not read');
  await pg.close();
});
