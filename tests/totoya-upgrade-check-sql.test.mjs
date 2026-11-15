// db/totoya-upgrade-check.sql（読むだけ）が、本番と同じ形の表で止まらずに 1 つの表を返すか（合成データ・PGlite）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SQL = fs.readFileSync(new URL('../db/totoya-upgrade-check.sql', import.meta.url), 'utf8');
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');

test('Totoya のアップグレード率：toast_sales の分母・分子と、モディファイヤーから数えた数が日ごとに比べられる', async () => {
  const pg = new PGlite();
  await pg.exec(`
    create table public.stores(id text primary key, name text, toast_guid text);
    create table public.toast_sales(id serial primary key, restaurant_guid text, business_date date, net_sales numeric,
      miso_total_count int, miso_upgrade_count int, fetched_at timestamptz default now());
    create table public.toast_item_modifier_sales(id serial primary key, restaurant_guid text, business_date date, item_guid text,
      modifier_name text, qty numeric, item_qty numeric);
    insert into public.stores values ('F04-K','Totoya Kaimuki','g-k'),('F04-A','Totoya Aiea','g-a'),('F01','ToriTon','g-t');`);
  const today = new Date(Date.now() - 10 * 3600 * 1000);
  const day = n => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10);
  for (const n of [1, 2]) {
    await pg.query(`insert into toast_sales(restaurant_guid,business_date,net_sales,miso_total_count,miso_upgrade_count)
      values ('g-k',$1,1000,20,6),('g-a',$1,900,10,2),('g-t',$1,500,null,null)`, [day(n)]);
    await pg.query(`insert into toast_item_modifier_sales(restaurant_guid,business_date,item_guid,modifier_name,qty,item_qty) values
      ('g-k',$1,'b1','AOSA Miso',14,30),('g-k',$1,'b1','Crab Miso',3,30),('g-k',$1,'b2','Today''s Miso',1,9),('g-k',$1,'b2',' CHAZUKE ',2,9),
      ('g-k',$1,'b1','Extra Rice',5,30)`, [day(n)]);
  }
  await pg.query(`update toast_item_modifier_sales set qty=4 where business_date=$1 and modifier_name='Crab Miso'`, [day(2)]);
  await pg.query(`insert into toast_sales(restaurant_guid,business_date,miso_total_count,miso_upgrade_count) values ('g-k',$1,5,1)`, [day(80)]);
  const rows = (await pg.query(SQL)).rows;
  const pick = p => rows.filter(x => x.part === p);
  assert.ok(pick('cols').some(x => x.a === 'toast_item_modifier_sales' && x.b === 'modifier_name'));
  assert.ok(pick('cols').some(x => x.a === 'toast_sales' && x.b === 'miso_upgrade_count'));
  assert.ok(!pick('cols').some(x => x.b === 'net_sales'), '金額の列は出さない');
  const sales = pick('sales');
  assert.equal(sales.length, 2, 'Totoya の店だけ');
  assert.ok(sales.some(x => x.store === 'F04-K' && x.b === 'days 2 / miso_days 2' && x.c === 'total 40 / upgrade 12' && x.d === '30.0%'), '45 日より前は数えない');
  assert.ok(sales.some(x => x.store === 'F04-A' && x.c === 'total 20 / upgrade 4'));
  const ma = pick('modall');
  assert.ok(ma.some(x => x.store === 'F04-K' && x.b === 'rows 10' && x.d === 'names 5 / items 2'));
  assert.ok(ma.some(x => x.store === 'F04-A' && x.b === 'rows 0'), 'モディファイヤーの行が無い店が分かる');
  const mn = pick('modname');
  assert.ok(mn.some(x => x.store === 'F04-K' && x.a === 'chazuke' && x.b === 'qty 4'), '名前の前後の空白・大文字小文字は見ない');
  assert.ok(!mn.some(x => x.a === 'extra rice'), '味噌汁・茶漬けに関係のない名前は出さない');
  const d = pick('day');
  assert.ok(d.some(x => x.store === 'F04-K' && x.a === day(1) && x.b === 'toast 20 / 6' && x.c === 'mod 20 / 6' && x.d === '一致'));
  assert.ok(d.some(x => x.store === 'F04-K' && x.a === day(2) && x.c === 'mod 21 / 7' && x.d === 'ちがう'));
  assert.ok(d.some(x => x.store === 'F04-A' && x.d === 'モディファイヤーの行なし'));
  await pg.close();
});
