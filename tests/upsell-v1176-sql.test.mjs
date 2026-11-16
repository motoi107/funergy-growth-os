// v1176：アップセルの欄と表（supabase/migrations/20261201090000_upsell_v1176.sql）・確かめの SQL・戻す SQL（合成データ・PGlite）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const MIG71 = fs.readFileSync(new URL('../supabase/migrations/20261130090000_toast_upgrade_lines.sql', import.meta.url), 'utf8');
const MIG = fs.readFileSync(new URL('../supabase/migrations/20261201090000_upsell_v1176.sql', import.meta.url), 'utf8');
const CHECK = fs.readFileSync(new URL('../db/upsell-v1176-check.sql', import.meta.url), 'utf8');
const ROLLBACK = fs.readFileSync(new URL('../db/upsell-v1176-rollback.sql', import.meta.url), 'utf8');
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');

async function base(with71 = true) {
  const pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.stores(id text primary key, name text, toast_guid text);
    create table public.toast_sales(restaurant_guid text, business_date date, net_sales numeric, miso_total_count int, miso_upgrade_count int, primary key (restaurant_guid, business_date));
    create table public.tip_labor(restaurant_guid text, business_date date, data jsonb, primary key (restaurant_guid, business_date));
    insert into public.stores values ('F04-K','Totoya Kaimuki','g-k'),('F04-A','Totoya Aiea','g-a'),('F01','ToriTon','g-t');`);
  if (with71) await pg.exec(MIG71);
  return pg;
}
const hstDay = n => new Date(Date.now() - 10 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10);

test('v1171 の表が無いと何も変えずに止まる', async () => {
  const pg = await base(false);
  await assert.rejects(pg.exec(MIG), /先に 20261130090000/);
  const r = await pg.query(`select to_regclass('public.toast_upgrade_extra') t`);
  assert.equal(r.rows[0].t, null);
  await pg.close();
});

test('欄と表を足す・前の行は残る・公開の鍵は読むだけ・2 回流しても同じ・戻すと v1171 の形', async () => {
  const pg = await base();
  await pg.exec(`set role service_role;
    insert into toast_upgrade_lines(restaurant_guid,business_date,line_key,kind,qty) values ('g-k','${hstDay(2)}','old:0','crab',1);
    insert into toast_upgrade_days(restaurant_guid,business_date,lines,crab,total,upgrade,hw_version) values ('g-k','${hstDay(2)}',1,1,1,1,'v1171');
    reset role;`);
  await pg.exec(MIG); await pg.exec(MIG);
  const old = await pg.query(`select mod_guid, check_key from toast_upgrade_lines where line_key='old:0'`);
  assert.deepEqual(old.rows[0], { mod_guid: null, check_key: null }, '前の行は残り、足した欄は空');
  await pg.exec(`set role service_role;
    insert into toast_upgrade_lines(restaurant_guid,business_date,line_key,kind,qty,mod_guid,check_key) values ('g-k','${hstDay(1)}','s1:0','crab',1,'m-crab','c1');
    insert into toast_upgrade_extra(restaurant_guid,business_date,line_key,check_key,item_guid,item_name,qty,meal) values ('g-k','${hstDay(1)}','s2','c1','i-soup','Crab Miso Soup',1,'L');
    insert into toast_upgrade_days(restaurant_guid,business_date,lines,crab,total,upgrade,hw_version,by_mod,extra) values ('g-k','${hstDay(1)}',1,1,1,1,'v1176','{"m-crab":{"n":"Crab","k":"crab","q":1}}',1);
    reset role;`);
  await pg.exec(`set role anon;`);
  assert.equal((await pg.query(`select count(*)::int n from toast_upgrade_extra`)).rows[0].n, 1, '公開の鍵で読める');
  await assert.rejects(pg.exec(`insert into toast_upgrade_extra(restaurant_guid,business_date,line_key,item_guid,qty) values ('g-k','${hstDay(1)}','x',' i',1)`), /permission denied/);
  await assert.rejects(pg.exec(`update toast_upgrade_extra set qty = 9`), /permission denied/);
  await assert.rejects(pg.exec(`delete from toast_upgrade_extra`), /permission denied/);
  await pg.exec(`reset role;`);
  await assert.rejects(pg.exec(`insert into toast_upgrade_extra(restaurant_guid,business_date,line_key,qty) values ('g-k','${hstDay(1)}','y',1)`), /null/i, '品の ID は必須');
  await assert.rejects(pg.exec(`insert into toast_upgrade_extra(restaurant_guid,business_date,line_key,item_guid,qty,meal) values ('g-k','${hstDay(1)}','z','i',1,'X')`), /check/i);
  await pg.exec(ROLLBACK); await pg.exec(ROLLBACK);
  const g = await pg.query(`select to_regclass('public.toast_upgrade_extra') a, to_regclass('public.toast_upgrade_lines') b`);
  assert.equal(g.rows[0].a, null); assert.ok(g.rows[0].b, 'v1171 の表は残る');
  const cols = await pg.query(`select column_name from information_schema.columns where table_name in ('toast_upgrade_lines','toast_upgrade_days') and column_name in ('mod_guid','check_key','by_mod','extra')`);
  assert.equal(cols.rows.length, 0);
  assert.equal((await pg.query(`select count(*)::int n from toast_upgrade_lines`)).rows[0].n, 2, '行は残る');
  await pg.close();
});

test('確かめの SQL：setup が OK・v1171 の日は取り込み直し・一致・ちがう・退勤の打刻の無い日を数える', async () => {
  const pg = await base();
  await assert.rejects(pg.query(CHECK), /by_mod/, '流す前は（足した欄が無いので）エラー＝先に SQL を流す');
  await pg.exec(MIG);
  let r;
  await pg.exec(`set role service_role;
    insert into toast_upgrade_days(restaurant_guid,business_date,lines,total,upgrade,hw_version) values ('g-k','${hstDay(3)}',0,0,0,'v1171');
    insert into toast_upgrade_days(restaurant_guid,business_date,lines,total,upgrade,hw_version,by_mod,extra) values ('g-k','${hstDay(2)}',0,0,0,'v1176','{}',1);
    insert into toast_upgrade_extra(restaurant_guid,business_date,line_key,item_guid,qty) values ('g-k','${hstDay(2)}','a','i',1);
    insert into toast_upgrade_days(restaurant_guid,business_date,lines,total,upgrade,hw_version,by_mod,extra) values ('g-a','${hstDay(2)}',1,1,1,'v1176','{}',2);
    insert into toast_upgrade_extra(restaurant_guid,business_date,line_key,item_guid,qty) values ('g-a','${hstDay(2)}','a','i',1);
    reset role;
    insert into tip_labor values ('g-t','${hstDay(1)}','[{"guid":"e1","openShifts":[{"inDate":"x"}]}]'),('g-t','${hstDay(2)}','[{"guid":"e1","shifts":[]}]'),('g-k','${hstDay(1)}','[]');`);
  r = await pg.query(CHECK);
  const setup = r.rows.filter(x => x.part === 'setup');
  assert.deepEqual(setup.map(x => x.b), ['OK', 'OK', 'OK', 'OK', 'OK']);
  const day = r.rows.filter(x => x.part === 'day');
  assert.equal(day.find(x => x.store === 'F04-K' && x.a === hstDay(3)).d, '取り込み直しが要る（v1176 より前）');
  assert.equal(day.find(x => x.store === 'F04-K' && x.a === hstDay(2)).d, '一致');
  assert.equal(day.find(x => x.store === 'F04-A').d, 'ちがう', '印の数と行の数が違う');
  const lab = r.rows.filter(x => x.part === 'labor');
  assert.deepEqual(lab.map(x => [x.store, x.a, x.b]), [['F01', '2', '1'], ['F04-K', '1', '0']]);
  assert.ok(!JSON.stringify(r.rows).includes('e1'), '人の ID は出さない');
  await pg.close();
});

test('入れる一式：SQL は元のファイルと 1 文字も違わない・手順に非公開の 1 ファイルの sha256 の先頭（中身は置かない）', () => {
  const dep = f => fs.readFileSync(new URL('../deploy/upsell-v1176/' + f, import.meta.url), 'utf8');
  assert.equal(dep('1_追加のSQL.sql'), MIG);
  assert.equal(dep('2_確かめ_読むだけ.sql'), CHECK);
  assert.equal(dep('戻す.sql'), ROLLBACK);
  const g = dep('手順.md');
  assert.match(g, /hyper-worker_v1176_index\.ts/);
  assert.match(g, /sha256 の先頭 `[0-9a-f]{12}`/);
  assert.ok(!fs.readdirSync(new URL('../deploy/upsell-v1176/', import.meta.url)).some(f => /\.ts$/.test(f)), 'the private hyper-worker is not in the repo');
  assert.ok(g.indexOf('1_追加のSQL.sql') < g.indexOf('2_確かめ_読むだけ.sql') && g.indexOf('2_確かめ_読むだけ.sql') < g.indexOf('hyper-worker_v1176_index.ts') && g.indexOf('hyper-worker_v1176_index.ts') < g.indexOf('取り込み直す'));
});
