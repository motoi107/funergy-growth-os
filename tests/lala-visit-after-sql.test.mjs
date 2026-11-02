// db/lala-visit-after-check.sql（読むだけ）：LaLa の来店区分を 1 日ずつ、注文の商品と保存した数で照らし合わせる（合成データ・PGlite）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const SQL = fs.readFileSync(new URL('../db/lala-visit-after-check.sql', import.meta.url), 'utf8');
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
test('一致・違う・保存の行なし・来店区分なし・休み・月と全期間のリピート率（足してから割る）', async () => {
  const pg = new PGlite();
  await pg.exec(`create table public.stores(id text primary key, toast_guid text);
    create table public.toast_menu_items(id serial, restaurant_guid text, guid text, category text, name text, price numeric, active boolean);
    create table public.toast_item_sales(id serial, restaurant_guid text, item_guid text, business_month text, qty numeric, business_date date);
    create table public.toast_sales(id serial, restaurant_guid text, business_date date, net_sales numeric, guest_count int, order_count int,
      first_time_count int, repeat_count int, super_regular_count int, fetched_at timestamptz);
    insert into stores values ('F01','g1'),('F06','g6');
    insert into toast_menu_items(restaurant_guid,guid,category,name) values
      ('g6','x1','Customer Property','FT'),('g6','x2','Customer Property','RP'),('g6','x3','Customer Property','SR'),
      ('g6','b1','Beer','Draft'),('g1','a1','Customers','FT');
    -- 9/26：一致（FT 3・RP 2・SR 1 → 保存 FT 3・RP+SR 3・SR 1）
    insert into toast_item_sales(restaurant_guid,item_guid,qty,business_date) values ('g6','x1',3,'2026-09-26'),('g6','x2',2,'2026-09-26'),('g6','x3',1,'2026-09-26'),('g6','b1',40,'2026-09-26');
    insert into toast_sales(restaurant_guid,business_date,net_sales,guest_count,order_count,first_time_count,repeat_count,super_regular_count,fetched_at)
      values ('g6','2026-09-26',2000,40,15,3,3,1,'2026-11-02T21:00:00Z');
    -- 9/27：違う（商品 RP 4・保存 0＝前の hyper-worker）
    insert into toast_item_sales(restaurant_guid,item_guid,qty,business_date) values ('g6','x2',4,'2026-09-27');
    insert into toast_sales(restaurant_guid,business_date,net_sales,guest_count,order_count,first_time_count,repeat_count,super_regular_count)
      values ('g6','2026-09-27',1500,30,12,0,0,0);
    -- 9/28：来店区分なし（売上あり・押されていない）、9/29：休み（売上 0）、9/30：保存の行なし
    insert into toast_sales(restaurant_guid,business_date,net_sales,guest_count,order_count,first_time_count,repeat_count,super_regular_count)
      values ('g6','2026-09-28',1800,35,14,0,0,0),('g6','2026-09-29',0,0,0,0,0,0);
    -- 10/01：一致（FT 1）。ほかの店（F01）の行は数えない
    insert into toast_item_sales(restaurant_guid,item_guid,qty,business_date) values ('g6','x1',1,'2026-10-01'),('g1','a1',9,'2026-10-01');
    insert into toast_sales(restaurant_guid,business_date,net_sales,guest_count,order_count,first_time_count,repeat_count,super_regular_count)
      values ('g6','2026-10-01',900,20,8,1,0,0),('g1','2026-10-01',5000,100,50,9,0,0);`);
  const rows = (await pg.query(SQL)).rows;
  const day = d => rows.find(r => r.part === 'day' && r.a === d);
  assert.equal(day('2026-09-26').e, '一致');
  assert.equal(day('2026-09-26').c, '商品 FT 3 · RP 2 · SR 1');
  assert.equal(day('2026-09-26').d, '保存 FT 3 · RP+SR 3 · SR 1');
  assert.equal(day('2026-09-26').f, '11/02 11:00 HST');
  assert.equal(day('2026-09-27').e, '違う');
  assert.equal(day('2026-09-28').e, '来店区分なし');
  assert.equal(day('2026-09-29').e, '休み');
  assert.equal(day('2026-09-30').e, '保存の行なし');
  assert.equal(day('2026-10-01').e, '一致');
  assert.equal(day('2026-09-19').e, '保存の行なし');
  const sep = rows.find(r => r.part === 'month' && r.a.startsWith('2026-09'));
  // 9 月の保存：FT 3・RP+SR 3 → 50.0%。商品：FT 3・RP 6・SR 1 → 70.0%（9/27 が違う）
  assert.match(sep.d, /保存 FT 3 · RP\+SR 3 · SR 1 → 50\.0%/);
  assert.match(sep.c, /商品 FT 3 · RP 6 · SR 1 → 70\.0%/);
  assert.match(sep.b, /来店区分のある日 1 \/ 売上のある日 3/);
  assert.match(sep.e, /違う日 1 \/ 保存の行なし \d+/);
  const tot = rows.find(r => r.part === 'total');
  // 全期間の保存：FT 4・RP+SR 3 → 42.9%（日ごとの率の平均ではない）
  assert.match(tot.d, /保存 FT 4 · RP\+SR 3 · SR 1 → 42\.9%/);
  // 1 行も来店区分が無い月は「対象データなし」（0% と出さない）
  await pg.exec(`delete from toast_item_sales where restaurant_guid='g6'; update toast_sales set first_time_count=0, repeat_count=0, super_regular_count=0 where restaurant_guid='g6';`);
  const r2 = (await pg.query(SQL)).rows;
  assert.match(r2.find(r => r.part === 'total').d, /→ 対象データなし/);
  assert.match(r2.find(r => r.part === 'total').c, /→ 対象データなし/);
  await pg.close();
});
