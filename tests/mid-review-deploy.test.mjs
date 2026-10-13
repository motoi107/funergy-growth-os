// 中間レビュー v1069 の配備用ファイルの確認（合成データ・本番に接続しない）。
// 1) deploy/mid-review-v1069/ の貼り付け用ファイルが、リポジトリの元のファイルと同じ中身であること
//    （貼る内容が古くならないようにするための見張り）。
// 2) 戻す SQL（db/mid-review-fixes-revert.sql）が、3 つの関数を 20261012090000 のときの中身に戻すこと。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const FNS = ['mr_auth', 'mr_reply_send', 'mr_reply_delete'];

test('貼り付け用の 1 ファイルは handler.mjs ＋ index.ts の serve 行と同じ中身', () => {
  const bundle = read('deploy/mid-review-v1069/C_関数_index.ts');
  const handler = read('supabase/functions/mid-review/handler.mjs');
  const serve = read('supabase/functions/mid-review/index.ts').split('\n').find(l => l.includes('Deno.serve'));
  assert.ok(bundle.includes(handler), 'handler.mjs を丸ごと含むこと（直したら作り直す）');
  assert.ok(bundle.includes(serve.trim()), 'index.ts の serve 行を含むこと');
  // 貼るのは 1 ファイルなので、ほかのファイルを読む import は残っていてはいけない
  assert.equal(/^\s*import\s/m.test(bundle), false, 'import が残っていない（1 ファイルで動く）');
  assert.equal(bundle.indexOf(handler) + handler.length + bundle.slice(bundle.indexOf(handler) + handler.length).length,
    bundle.length, 'handler.mjs のあとは serve 行だけ');
});

test('貼り付け用の SQL 4 本は、リポジトリの元のファイルと 1 文字も違わない', () => {
  assert.equal(read('deploy/mid-review-v1069/A_土台のSQL_初回だけ.sql'), read('supabase/migrations/20261012090000_mid_review.sql'));
  assert.equal(read('deploy/mid-review-v1069/B_追加のSQL_今回の直し.sql'), read('supabase/migrations/20261013090000_mid_review_fixes.sql'));
  assert.equal(read('deploy/mid-review-v1069/D_確認のSQL_読むだけ.sql'), read('db/mid-review-postcheck.sql'));
  assert.equal(read('deploy/mid-review-v1069/E_AMを足すSQL.sql'), read('db/mid-review-add-am.sql'));
});

test('AM を足す SQL は、貼る人が書き換えるところが無い', () => {
  const sql = read('db/mid-review-add-am.sql');
  assert.equal(/:= *'<[^']*>'/.test(sql), false, "'<...>' の書き換え欄が残っていない");
  assert.match(sql, /v_email text := 'yuki@funergygroup\.com'/, 'メールが入っている');
  assert.match(sql, /v_role  text := 'am'/, '役職が am で入っている');
  // 社員は「在籍の AM」から自動で決める（名前を打たせない）。1 人に決まらないときは止まる。
  assert.match(sql, /lower\(trim\(coalesce\(e\.role, ''\)\)\) = 'am'/, '社員は役職 AM から決める');
  assert.match(sql, /coalesce\(e\.status, ''\) <> '退職'/, '在籍者だけ');
  assert.match(sql, /if v_n > 1 then\n  raise exception/, 'AM が複数なら止まる');
  assert.match(sql, /if v_old is not null and v_old <> v_role then/, 'ほかの役職で入っている人の役職は変えない');
  assert.match(sql, /if v_old is not null and not v_old_on then/, '止めてある人は勝手に戻さない');
});

test('戻す SQL は 3 つの関数を 20261012090000 のときの中身に戻す', async t => {
  const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean, data jsonb);`);
  const src = async () => Object.fromEntries((await pg.query(
    `select proname, prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any($1)`, [FNS])).rows.map(r => [r.proname, r.prosrc]));
  const priv = async () => (await pg.query(
    `select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname = any($1)
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
            or not has_function_privilege('service_role', p.oid, 'execute') or p.prosecdef)`, [FNS])).rows[0].n;

  await pg.exec(read('supabase/migrations/20261012090000_mid_review.sql'));
  const before = await src();
  assert.equal(Object.keys(before).length, 3);
  assert.equal(await priv(), 0, '元から anon / authenticated は実行できない');

  await pg.exec(read('supabase/migrations/20261013090000_mid_review_fixes.sql'));
  const fixed = await src();
  for (const f of FNS) assert.notEqual(fixed[f], before[f], f + ' は v1069 で変わる');
  assert.match(fixed.mr_reply_delete, /for update/, '削除もレビュー行をロックする');
  assert.equal(await priv(), 0);

  // 戻す（2 回流しても同じ）
  const revert = read('db/mid-review-fixes-revert.sql');
  await pg.exec(revert); await pg.exec(revert);
  assert.deepEqual(await src(), before, '3 つとも元の中身に戻る');
  assert.equal(await priv(), 0, '戻したあとも anon / authenticated は実行できない');
  // 戻したあと、もう一度 v1069 を入れられる
  await pg.exec(read('supabase/migrations/20261013090000_mid_review_fixes.sql'));
  assert.deepEqual(await src(), fixed);
});

test('AM を足す SQL を実際に流す（合成データ・本番に接続しない）', async t => {
  const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean, data jsonb);`);
  await pg.exec(read('supabase/migrations/20261012090000_mid_review.sql'));
  const sql = read('db/mid-review-add-am.sql');
  const run = () => pg.exec(sql);
  const members = async () => (await pg.query(
    `select role, name, emp_id, enabled from public.mr_members order by role, name`)).rows;
  const fails = async (re, msg) => {
    await assert.rejects(run(), e => (assert.match(e.message, re), true), msg);
  };
  const YUKI = '11111111-1111-1111-1111-111111111111';

  // メールのアカウントがまだ無い
  await fails(/Authentication/, 'アカウントが無ければ止まる');
  await pg.query(`insert into auth.users(id, email) values($1, 'Yuki@FunergyGroup.com')`, [YUKI]);

  // 社員の表に在籍の AM がいない
  await pg.exec(`insert into public.employees(id, name, role, status)
    values('E1','Yuki','manager',''), ('E2','Taro','am','退職')`);
  await fails(/役職が AM の在籍者がいません/, 'AM がいなければ止まる');

  // 在籍の AM が 2 人
  await pg.exec(`update public.employees set role='am' where id='E1';
    insert into public.employees(id, name, role, status) values('E3','Hana','AM','')`);
  await fails(/AM の在籍者が 2 人います（Hana \/ Yuki）/, '2 人なら名前を出して止まる');
  assert.deepEqual(await members(), [], '止まったときは 1 行も入らない');

  // 1 人に決まる → 入る（大文字小文字の違うメールでも同じアカウント）
  await pg.exec(`delete from public.employees where id='E3'`);
  await run();
  assert.deepEqual(await members(), [{ role: 'am', name: 'Yuki', emp_id: 'E1', enabled: true }]);

  // 何度流しても同じ（社員の表で名前が変わっていれば合わせる）
  await pg.exec(`update public.employees set name='Yuki K' where id='E1'`);
  await run(); await run();
  assert.deepEqual(await members(), [{ role: 'am', name: 'Yuki K', emp_id: 'E1', enabled: true }]);

  // ほかの役職で入っている人の役職は変えない
  await pg.exec(`update public.mr_members set role='gm' where user_id='${YUKI}'`);
  await fails(/もう gm として入っています/, '役職は変えない');
  await pg.exec(`update public.mr_members set role='am' where user_id='${YUKI}'`);

  // 止めてある人は勝手に戻さない
  await pg.exec(`update public.mr_members set enabled=false where user_id='${YUKI}'`);
  await fails(/止めてあります/, '止めてある人は戻さない');
  assert.deepEqual(await members(), [{ role: 'am', name: 'Yuki K', emp_id: 'E1', enabled: false }]);
});
