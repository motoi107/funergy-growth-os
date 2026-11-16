// v1171：アップグレードの明細の表（supabase/migrations/20261130090000_toast_upgrade_lines.sql）と確かめの SQL（合成データ・PGlite）。
// 公開の鍵（anon）は読めるが書けない・サーバーの鍵（service_role）は書ける・2 回流しても同じ・確かめの SQL が一致／ちがう／明細なしを分ける。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const MIG = fs.readFileSync(new URL('../supabase/migrations/20261130090000_toast_upgrade_lines.sql', import.meta.url), 'utf8');
const CHECK = fs.readFileSync(new URL('../db/toast-upgrade-lines-check.sql', import.meta.url), 'utf8');
const ROLLBACK = fs.readFileSync(new URL('../db/toast-upgrade-lines-rollback.sql', import.meta.url), 'utf8');
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');

async function base() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.stores(id text primary key, name text, toast_guid text);
    create table public.toast_sales(restaurant_guid text, business_date date, net_sales numeric, miso_total_count int, miso_upgrade_count int,
      primary key (restaurant_guid, business_date));
    grant select on public.toast_sales to anon;
    insert into public.stores values ('F04-K','Totoya Kaimuki','g-k'),('F04-A','Totoya Aiea','g-a'),('F01','ToriTon','g-t');`);
  return pg;
}
const hstDay = n => new Date(Date.now() - 10 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10);

test('表が無いデータベースでは何も作らずに止まる', async () => {
  const pg = new PGlite();
  await assert.rejects(pg.exec(MIG), /toast_sales がありません/);
  const r = await pg.query(`select to_regclass('public.toast_upgrade_lines') t`);
  assert.equal(r.rows[0].t, null);
  await pg.close();
});

test('公開の鍵は読むだけ・サーバーの鍵は書ける・2 回流しても同じ・戻すと表が無くなる', async () => {
  const pg = await base();
  await pg.exec(MIG);
  await pg.exec(MIG);
  await pg.exec(`set role service_role;
    insert into toast_upgrade_lines(restaurant_guid,business_date,line_key,order_no,bowl_name,mod_name,kind,qty) values ('g-k','${hstDay(1)}','s1:0','101','Matsu','Crab Miso','crab',1);
    insert into toast_upgrade_days(restaurant_guid,business_date,lines,crab,total,upgrade,hw_version) values ('g-k','${hstDay(1)}',1,1,1,1,'v1171');
    reset role;`);
  await pg.exec(`set role anon;`);
  const r = await pg.query(`select count(*)::int n from toast_upgrade_lines`);
  assert.equal(r.rows[0].n, 1, '公開の鍵で読める');
  await assert.rejects(pg.exec(`insert into toast_upgrade_lines(restaurant_guid,business_date,line_key,kind,qty) values ('g-k','${hstDay(1)}','x:0','aosa',1)`), /permission denied/);
  await assert.rejects(pg.exec(`update toast_upgrade_days set total = 99`), /permission denied/);
  await assert.rejects(pg.exec(`delete from toast_upgrade_lines`), /permission denied/);
  await pg.exec(`reset role;`);
  await assert.rejects(pg.exec(`insert into toast_upgrade_lines(restaurant_guid,business_date,line_key,kind,qty) values ('g-k','${hstDay(1)}','x:1','miso',1)`), /check/i, '決めた種類だけ');
  await assert.rejects(pg.exec(`insert into toast_upgrade_lines(restaurant_guid,business_date,line_key,kind,qty,counted,reason) values ('g-k','${hstDay(1)}','x:2','aosa',1,false,'refund')`), /check/i, '決めた理由だけ');
  const pol = await pg.query(`select count(*)::int n from pg_policies where tablename in ('toast_upgrade_lines','toast_upgrade_days') and cmd = 'SELECT'`);
  assert.equal(pol.rows[0].n, 2);
  await pg.exec(ROLLBACK);
  const g = await pg.query(`select to_regclass('public.toast_upgrade_lines') a, to_regclass('public.toast_upgrade_days') b`);
  assert.equal(g.rows[0].a, null); assert.equal(g.rows[0].b, null);
  const ts = await pg.query(`select to_regclass('public.toast_sales') a`);
  assert.ok(ts.rows[0].a, 'toast_sales は残る');
  await pg.close();
});

test('確かめの SQL：一致・ちがう・明細なし（v1171 より前の日）を分け、表の決まりは OK', async () => {
  const pg = await base();
  await pg.exec(MIG);
  const d1 = hstDay(1), d2 = hstDay(2), d3 = hstDay(3);
  await pg.query(`insert into toast_sales values ('g-k',$1,1000,5,2),('g-k',$2,900,4,1),('g-k',$3,800,3,1),('g-a',$1,700,2,0),('g-t',$1,500,null,null)`, [d1, d2, d3]);
  await pg.exec(`
    insert into toast_upgrade_lines(restaurant_guid,business_date,line_key,kind,qty,counted,reason) values
      ('g-k','${d1}','a:0','aosa',3,true,null),('g-k','${d1}','b:0','crab',1,true,null),('g-k','${d1}','c:0','chazuke',1,true,null),
      ('g-k','${d1}','v:0','udon',2,false,'void_order'),
      ('g-k','${d2}','a:0','aosa',3,true,null),('g-k','${d2}','b:0','today',0.5,true,null),('g-k','${d2}','b:1','udon',0.5,true,null),
      ('g-a','${d1}','a:0','aosa',2,true,null);
    insert into toast_upgrade_days(restaurant_guid,business_date,lines,aosa,crab,chazuke,udon,total,upgrade,voided,hw_version) values
      ('g-k','${d1}',4,3,1,1,0,5,2,1,'v1171'),('g-k','${d2}',3,3,0,0,0.5,4,1,0,'v1171'),('g-a','${d1}',1,2,0,0,0,2,0,0,'v1171');
    update toast_sales set miso_upgrade_count = 2 where restaurant_guid = 'g-k' and business_date = '${d2}';`);
  const rows = (await pg.query(CHECK)).rows;
  const setup = rows.filter(r => r.part === 'setup');
  assert.deepEqual(setup.map(r => r.b), ['OK', 'OK', 'OK', 'OK']);
  const day = rows.filter(r => r.part === 'day');
  const f = (s, d) => day.find(r => r.store === s && r.a === d);
  assert.equal(f('F04-K', d1).d, '一致'); assert.match(f('F04-K', d1).c, /lines 5 \/ 2 · void 1 · v1171/);
  assert.equal(f('F04-K', d2).d, 'ちがう', 'toast_sales の分子が明細と違う');
  assert.equal(f('F04-K', d3).d, '明細なし（取り込み直すと入る）');
  assert.equal(f('F04-A', d1).d, '一致', '分子 0 の日も一致');
  assert.ok(!day.some(r => r.store === 'F01'), 'Totoya の店だけ');
  await pg.close();
});

test('入れる一式：SQL は元のファイルと同じ・手順は非公開の hyper-worker の sha256 と順番を書く', () => {
  const D = new URL('../deploy/upgrade-drill-v1171/', import.meta.url);
  assert.equal(fs.readFileSync(new URL('1_追加のSQL.sql', D), 'utf8'), MIG);
  assert.equal(fs.readFileSync(new URL('2_確かめ_読むだけ.sql', D), 'utf8'), CHECK);
  assert.equal(fs.readFileSync(new URL('戻す.sql', D), 'utf8'), ROLLBACK);
  const md = fs.readFileSync(new URL('手順.md', D), 'utf8');
  assert.match(md, /48a5ba239f12/); assert.match(md, /リポジトリには置かない/);
  const i1 = md.indexOf('1_追加のSQL.sql'), i3 = md.indexOf('hyper-worker_v1171_index.ts'), i4 = md.indexOf('この PR をマージ');
  assert.ok(i1 > 0 && i1 < i3 && i3 < i4, 'SQL → hyper-worker → マージ');
  assert.ok(!fs.existsSync(new URL('hyper-worker_v1171_index.ts', D)), '非公開の 1 ファイルは置かない');
});
