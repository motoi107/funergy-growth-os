// v1098：読むだけの SQL 関数 app_state_index を本物の PostgreSQL（PGlite）に流して確かめる（合成データだけ）。
//   ・2 回流しても同じ／value が jsonb でも json でも動く
//   ・md5(value::text) を返す・中身を変えると印が変わる（updated_at を変えなくても）
//   ・接頭辞の行（invoice_purchase_・lunch_photo_）は返さない・引数なしなら全部
//   ・security invoker・anon が呼べる・確認の SQL がすべて OK
//   ・外す SQL で関数が消える（2 回流しても同じ）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from './runtime/node_modules/@electric-sql/pglite/dist/index.js';

const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG = rd('supabase/migrations/20261027090000_app_state_index.sql');
const CHECK = rd('db/app-state-index-check.sql');
const ROLLBACK = rd('db/app-state-index-rollback.sql');

for (const variant of ['jsonb', 'json']) {
  test(`app_state_index on a ${variant} value column`, async () => {
    const db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.app_state(key ${variant === 'json' ? 'varchar(300)' : 'text'} primary key, value ${variant} not null, updated_at timestamptz default now());
      insert into public.app_state(key, value, updated_at) values
        ('a', '{"x":1}', '2026-10-20T01:02:03.123456Z'),
        ('spl_invoices_F01', '[{"id":1,"t":"日本語"}]', now()),
        ('invoice_purchase_2026-10', '{}', now()),
        ('lunch_photo_1', '{}', now()),
        ('lunch_photoX', '{}', now());`);
    await db.exec(MIG); await db.exec(MIG);   // 2 回流しても同じ
    const r = (await db.query(`select * from public.app_state_index(array['invoice_purchase_','lunch_photo_']) order by key`)).rows;
    const m = Object.fromEntries((await db.query(`select key, md5(value::text) h, octet_length(value::text) n from public.app_state`)).rows.map(x => [x.key, x]));
    assert.deepEqual(r.map(x => x.key), ['a', 'lunch_photoX', 'spl_invoices_F01'], 'prefixed rows are left out; a key that only starts like a prefix is kept');
    r.forEach(x => { assert.match(x.h, /^[0-9a-f]{32}$/); assert.equal(x.h, m[x.key].h); assert.equal(x.n, m[x.key].n); });
    assert.equal((await db.query(`select count(*)::int c from public.app_state_index()`)).rows[0].c, 5, 'no argument: every row');
    const chk = (await db.query(CHECK)).rows;
    assert.equal(chk.length, 6);
    chk.forEach(x => assert.equal(x.ok, 'OK', x.what + ' ' + x.value));
    const h0 = (await db.query(`select h from public.app_state_index() where key='a'`)).rows[0].h;
    await db.exec(`update public.app_state set value='{"x":2}' where key='a'`);   // updated_at はそのまま
    const h1 = (await db.query(`select h from public.app_state_index() where key='a'`)).rows[0].h;
    assert.notEqual(h0, h1, 'the mark changes when the content changes, even with the same updated_at');
    await db.exec(ROLLBACK); await db.exec(ROLLBACK);
    assert.equal((await db.query(`select count(*)::int c from pg_proc where proname='app_state_index'`)).rows[0].c, 0);
    assert.equal((await db.query(`select count(*)::int c from public.app_state`)).rows[0].c, 5, 'no rows touched');
    await db.close();
  });
}
