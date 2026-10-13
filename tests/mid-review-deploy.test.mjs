// 中間レビューの配備用ファイルの確認（合成データ・本番に接続しない）。
// 1) deploy/mid-review-v1069/ は本番に入れたときのまま（変えない）。中身を sha256 で固定して見張る。
// 2) deploy/mid-review-v2/ は 10/13 に渡したときのまま（v1073 で確認の SQL が変わったので、中身を sha256 で固定して見張る）。
//    関数の 1 ファイルは置かない（PIN のログインの確かめが入るので公開しない。Moto さんに直接渡す）。
// 3) 戻す SQL（db/mid-review-fixes-revert.sql）が、v1069 の 3 つの関数を 20261012090000 のときの中身に戻すこと。
// 4) 止める SQL（db/mid-review-stop.sql）が、記録・設定を消さずに「非公開確認」だけを OFF にすること。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(new URL('../' + p, import.meta.url))).digest('hex');
const list = d => fs.readdirSync(new URL('../' + d, import.meta.url)).sort();
const FNS = ['mr_auth', 'mr_reply_send', 'mr_reply_delete'];
const pglite = async () => (await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js')).PGlite;

// v1069 の束（10/12 に本番へ入れたもの）。直すときは新しい版のフォルダを作る（このフォルダは変えない）。
const V1069 = {
  'A_土台のSQL_初回だけ.sql': 'e46bd05d2110c05902b9777e3c78c73a2270523156dda93ad4b087738fc6e2f7',
  'B_追加のSQL_今回の直し.sql': 'ae4cd6a212ef669a3b8c51bb6f12bfbd209b824a5a2b2005a486fdb0bd68782c',
  'C_関数_index.ts': '93a2e0befc8f596e96e802e797f580bf88d0885f30582d6a1ead934adba935a1',
  'D_確認のSQL_読むだけ.sql': '976bdb8a4385ca8e697a77faeb80a33cdf520f26b5029653274600eceb0e704f',
  '手順.md': '6592cf62c59759ca349f577c2623b6fe475ba7a864c65fc507b49cb91caeef10',
  '最初に確認.sql': 'b6a8b55a8c947946e136573acc80b198e111840f7a35c068f6295f490ffe9b85',
};

test('v1069 の束は本番に入れたときのまま（中身を変えない）', () => {
  assert.deepEqual(list('deploy/mid-review-v1069'), Object.keys(V1069).sort());
  for (const [f, h] of Object.entries(V1069)) assert.equal(sha('deploy/mid-review-v1069/' + f), h, f);
  // 土台と直しの migration は v2 でも変えていない（v2 は新しい migration を足すだけ）
  assert.equal(read('deploy/mid-review-v1069/A_土台のSQL_初回だけ.sql'), read('supabase/migrations/20261012090000_mid_review.sql'));
  assert.equal(read('deploy/mid-review-v1069/B_追加のSQL_今回の直し.sql'), read('supabase/migrations/20261013090000_mid_review_fixes.sql'));
  assert.equal(/^\s*import\s/m.test(read('deploy/mid-review-v1069/C_関数_index.ts')), false);
});

// v2 の束（10/13 に渡したもの）。直すときは新しい版のフォルダを作る（このフォルダは変えない）。
const V2 = {
  '1_最初に確認.sql': 'aad49483f34d432623316b919e1e6b380019e59e9fcea66cc9076ebb37358780',
  '2_追加のSQL_v2.sql': 'ae500549f159ef5a1895763978a9cc87b58a1257e53ff545b084e346b441f7c6',
  '3_確認のSQL_読むだけ.sql': 'fe562b392f888aebccecb335cad6a394ac6e5a415862870b9fe77132f65cc379',
  '手順.md': 'e329b0be56b1c234adcdf414236add7c95b7d9bd2f706877efcb76e8f6b0bd46',
  '止める.sql': '4f52e0a8f86010ca0a98719f46e4e8c34f9ea765d54f6bb0a9c3f8161eea50db',
};

test('v2 の束は渡したときのまま・v2 の SQL は元のファイルと同じ・関数のファイルは置かない', () => {
  const D = 'deploy/mid-review-v2/';
  assert.deepEqual(list(D), Object.keys(V2).sort());
  for (const [f, h] of Object.entries(V2)) assert.equal(sha(D + f), h, f);
  assert.equal(read(D + '2_追加のSQL_v2.sql'), read('supabase/migrations/20261015090000_mid_review_v2.sql'));
  assert.equal(read(D + '止める.sql'), read('db/mid-review-stop.sql'));
  assert.equal(list(D).some(f => /\.(ts|js|mjs)$/.test(f)), false, '関数（PIN の確かめ入り）は公開しない');
  const howto = read(D + '手順.md');
  for (const s of ['1_最初に確認.sql', '2_追加のSQL_v2.sql', '3_確認のSQL_読むだけ.sql', '止める.sql', '中間レビュー_関数_v1072_index.ts', 'Verify JWT', '全文'])
    assert.ok(howto.includes(s), s);
  // 順番：確認 → 関数 → SQL → 確認 → マージ
  const at = s => howto.indexOf(s);
  assert.ok(at('| 1 |') > 0 && at('| 1 |') < at('| 2 |') && at('| 2 |') < at('| 3 |') && at('| 3 |') < at('| 4 |') && at('| 4 |') < at('| 5 |'));
  const row = n => howto.slice(at('| ' + n + ' |'), howto.indexOf('\n', at('| ' + n + ' |')));
  assert.match(row(1), /1_最初に確認\.sql/); assert.match(row(2), /中間レビュー_関数_v1072_index\.ts/); assert.match(row(3), /2_追加のSQL_v2\.sql/);
  assert.match(row(4), /3_確認のSQL_読むだけ\.sql/); assert.match(row(5), /マージ/);
  // 公開のリポジトリなので、PIN の印の作り方（鍵の設定の名前・形）は書かない。言葉そのものは試験にも書かず、ハッシュで見張る。
  const H = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
  const FORBID = new Set(['1c3082c0c5e14780', 'b6b85248bf9e8053', '32fd6f051ca87f40']);
  for (const w of howto.match(/[A-Za-z0-9_:.-]+/g) || []) for (const x of [w, w.replace(/[:.-]+$/, ''), w.replace(/^[:.-]+/, '')]) assert.equal(FORBID.has(H(x)), false, '書かない言葉がある');
});

test('戻す SQL は v1069 の 3 つの関数を 20261012090000 のときの中身に戻す', async t => {
  const PGlite = await pglite();
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

test('止める SQL は記録・設定を消さずに「非公開確認」だけを OFF にする（2 回流しても同じ）', async t => {
  const PGlite = await pglite();
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, emp_code text, role text, perms jsonb, title text, store text, support jsonb, status text, emp_type text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean, data jsonb);
    insert into public.employees(id, name, role, title, status) values ('E2','GM Test','gm','General Manager','在籍');
    insert into public.manager_auth values ('00000000-0000-4000-8000-0000000000c2','gm','E2');`);
  for (const f of ['20261012090000_mid_review.sql', '20261013090000_mid_review_fixes.sql', '20261015090000_mid_review_v2.sql']) await pg.exec(read('supabase/migrations/' + f));
  const gm = '00000000-0000-4000-8000-0000000000c2';
  await pg.query(`insert into mr_members(user_id, emp_id, name, role) values($1,'E2','GM Test','gm') on conflict do nothing`, [gm]);
  const rpc = async (name, p) => (await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p)])).rows[0].v;
  await rpc('mr_settings_save', { actor: gm, via: 'email', key: 'flags', value: { private: true, live_input: true } });
  const { demoData } = await import('../supabase/functions/mid-review/handler.mjs');
  await rpc('mr_demo_reset', { actor: gm, via: 'email', ...demoData('2026-10') });
  const counts = async () => (await pg.query(`select (select count(*) from mr_reviews)::int r, (select count(*) from mr_submissions)::int s,
    (select count(*) from mr_replies)::int p, (select count(*) from mr_members)::int m, (select count(*) from mr_stores)::int st`)).rows[0];
  const before = await counts();
  assert.ok(before.r > 0 && before.s > 0 && before.p > 0 && before.st > 0, JSON.stringify(before));
  assert.ok((await rpc('mr_list', { actor: gm, via: 'email', env: 'demo', ym: '2026-10' })).stores.length > 0);

  const stop = read('db/mid-review-stop.sql');
  await pg.exec(stop); await pg.exec(stop);
  const flags = (await pg.query(`select value from mr_settings where key = 'flags'`)).rows[0].value;
  assert.deepEqual(flags, { private: false, store_publish: false, notify: false, live_input: true });
  assert.deepEqual(await counts(), before, '記録・利用者・店は消えない');
  await assert.rejects(rpc('mr_list', { actor: gm, via: 'email', env: 'demo', ym: '2026-10' }), /disabled/);
  // 画面（メールの GM・CEO）で ON に戻せる
  await rpc('mr_settings_save', { actor: gm, via: 'email', key: 'flags', value: { private: true } });
  assert.ok((await rpc('mr_list', { actor: gm, via: 'email', env: 'demo', ym: '2026-10' })).stores.length > 0);
});
