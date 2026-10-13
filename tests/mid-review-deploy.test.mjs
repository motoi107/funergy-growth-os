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

test('貼り付け用の SQL 3 本は、リポジトリの元のファイルと 1 文字も違わない', () => {
  assert.equal(read('deploy/mid-review-v1069/A_土台のSQL_初回だけ.sql'), read('supabase/migrations/20261012090000_mid_review.sql'));
  assert.equal(read('deploy/mid-review-v1069/B_追加のSQL_今回の直し.sql'), read('supabase/migrations/20261013090000_mid_review_fixes.sql'));
  assert.equal(read('deploy/mid-review-v1069/D_確認のSQL_読むだけ.sql'), read('db/mid-review-postcheck.sql'));
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
