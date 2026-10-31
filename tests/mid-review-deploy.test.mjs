// 中間レビューの配備用ファイルの確認（合成データ・本番に接続しない）。
// 1) deploy/mid-review-v1069/ は本番に入れたときのまま（変えない）。中身を sha256 で固定して見張る。
// 2) deploy/mid-review-v2/ は 10/13 に渡したときのまま（v1073 で確認の SQL が変わったので、中身を sha256 で固定して見張る）。
//    deploy/mid-review-v1073/・deploy/mid-review-v1073-fix/ も渡したときのまま（sha256）。deploy/mid-review-v1076/ は SQL が元のファイルの写し（確認の SQL と手順は sha256）。
//    deploy/mid-review-v1122/ は SQL と確認の SQL が元のファイルの写し。
//    どちらも関数の 1 ファイルは置かない（PIN のログインの確かめが入るので公開しない。Moto さんに直接渡す）。
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

// v1073 の束（10/13 に渡して本番に入ったもの）。直すときは新しい版のフォルダを作る（このフォルダは変えない）。
const V1073 = {
  '1_最初に確認.sql': '6fc7ad53699334ab68fdf3a572ab2afe3e9cb35117f9f716d6bfd4d68dfc43bb',
  '2_追加のSQL_v2.sql': 'ae500549f159ef5a1895763978a9cc87b58a1257e53ff545b084e346b441f7c6',
  '3_追加のSQL_v1073.sql': '0048770d2da0af52a15fd0ff052bfb1e2cf3e2f259a118030f6b3d794f60c0bf',
  '4_確認のSQL_読むだけ.sql': '844f44be79d0998003111df28a68c5b51af17dacb9d4396d9b32d15f6adc985d',
  '手順.md': '8b4ceb4c5cb171400efdadd1ec0fe0c830fc2ff4e5bc526d8c5e0e12964f6671',
  '止める.sql': '4f52e0a8f86010ca0a98719f46e4e8c34f9ea765d54f6bb0a9c3f8161eea50db',
};

test('v1073 の束は渡したときのまま・v2 と v1073 の SQL は元のファイルと同じ・関数のファイルは置かない', () => {
  const D = 'deploy/mid-review-v1073/';
  assert.deepEqual(list(D), Object.keys(V1073).sort());
  for (const [f, h] of Object.entries(V1073)) assert.equal(sha(D + f), h, f);
  assert.equal(read(D + '2_追加のSQL_v2.sql'), read('supabase/migrations/20261015090000_mid_review_v2.sql'));
  assert.equal(read(D + '3_追加のSQL_v1073.sql'), read('supabase/migrations/20261016090000_mid_review_v2_versions.sql'), 'the v1073 migration is not changed (the fix is a new one)');
  assert.equal(read(D + '止める.sql'), read('db/mid-review-stop.sql'));
  assert.equal(list(D).some(f => /\.(ts|js|mjs)$/.test(f)), false, '関数（PIN の確かめ入り）は公開しない');
});

// v1073 の直しの束（10/13 に渡したもの）：SQL 1 つ＋確認の SQL。v1076 で確認の SQL が変わったので、中身を sha256 で固定して見張る。
// 直すときは新しい版のフォルダを作る（このフォルダは変えない）。
const V1073FIX = {
  '1_追加のSQL_直し.sql': '12025603b1212d0b9028f4cbe4d5664f0eaa7eba8b2654e6ec900d14c4da6dea',
  '2_確認のSQL_読むだけ.sql': '0d21162a6f45dda7ff9041c225c3cbeb8c96090f6e16d90844042f048c86d565',
  '手順.md': 'd6df1cbbad8c10be354ba173432b81d9ea7f8c50c1405734220a2cd8f71fed20',
};
test('v1073 の直しの束は渡したときのまま：SQL は元のファイルと同じ・関数のファイルは置かない・手順は SQL → 確認だけ', () => {
  const D = 'deploy/mid-review-v1073-fix/';
  assert.deepEqual(list(D), Object.keys(V1073FIX).sort());
  for (const [f, h] of Object.entries(V1073FIX)) assert.equal(sha(D + f), h, f);
  assert.equal(read(D + '1_追加のSQL_直し.sql'), read('supabase/migrations/20261017090000_mid_review_stores_save_fix.sql'), 'the fix migration is not changed (v1076 is a new one)');
  const howto = read(D + '手順.md');
  for (const s of ['1_追加のSQL_直し.sql', '2_確認のSQL_読むだけ.sql', 'mid-review stores_save fix (20261017090000)', '全文', '関数・アプリは変えません'])
    assert.ok(howto.includes(s), s);
  const at = s => howto.indexOf(s);
  assert.ok(at('| 1 |') > 0 && at('| 1 |') < at('| 2 |'));
  assert.equal(howto.includes('| 3 |'), false);
  const H = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
  const FORBID = new Set(['1c3082c0c5e14780', 'b6b85248bf9e8053', '32fd6f051ca87f40']);
  for (const w of howto.match(/[A-Za-z0-9_:.-]+/g) || []) for (const x of [w, w.replace(/[:.-]+$/, ''), w.replace(/^[:.-]+/, '')]) assert.equal(FORBID.has(H(x)), false, '書かない言葉がある');
});

// v1076 の束：SQL 1 つ（店舗の管轄に GM も）＋確認の SQL。どちらも元のファイルの写し。関数は変えない。順番は SQL → 確認 → マージ。
test('v1076 の束：SQL と確認の SQL は元のファイルと同じ・関数のファイルは置かない・手順は SQL → 確認 → マージ → 端末を更新 → 管轄を選ぶ', () => {
  const D = 'deploy/mid-review-v1076/';
  assert.deepEqual(list(D), ['1_追加のSQL_管轄にGM.sql', '2_確認のSQL_読むだけ.sql', '手順.md'].sort());
  assert.equal(read(D + '1_追加のSQL_管轄にGM.sql'), read('supabase/migrations/20261018090000_mid_review_scope_gm.sql'));
  // v1122 で確認の SQL が変わったので、渡したときの中身を sha256 で固定して見張る。
  assert.equal(sha(D + '2_確認のSQL_読むだけ.sql'), '6672fe477f0a2330e7fbbc4ff6e7dbbb1292c6d215943d7343af5cc14efe65a6');
  assert.equal(sha(D + '手順.md'), 'd5d689663d9ce45b1fe3fcc64b1f7c5216dc0e89741171e356c35e64e689d96a');
  const howto = read(D + '手順.md');
  for (const s of ['1_追加のSQL_管轄にGM.sql', '2_確認のSQL_読むだけ.sql', 'mid-review scope GM (20261018090000)', 'mid-review stores_save fix (20261017090000)',
    '全文', '関数は変えません', 'v1076', '未設定（GM・CEO みんなで見る）'])
    assert.ok(howto.includes(s), s);
  const at = s => howto.indexOf(s);
  assert.ok(at('| 1 |') > 0 && at('| 1 |') < at('| 2 |') && at('| 2 |') < at('| 3 |') && at('| 3 |') < at('| 4 |') && at('| 4 |') < at('| 5 |'));
  const row = n => howto.slice(at('| ' + n + ' |'), howto.indexOf('\n', at('| ' + n + ' |')));
  assert.match(row(1), /1_追加のSQL_管轄にGM\.sql/); assert.match(row(2), /2_確認のSQL_読むだけ\.sql/); assert.match(row(3), /マージ/); assert.match(row(4), /端末.*v1076/); assert.match(row(5), /店舗の管轄/);
  assert.equal(howto.includes('| 6 |'), false);
  assert.equal(list(D).some(f => /\.(ts|js|mjs)$/.test(f)), false);
  const H = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
  const FORBID = new Set(['1c3082c0c5e14780', 'b6b85248bf9e8053', '32fd6f051ca87f40']);
  for (const w of howto.match(/[A-Za-z0-9_:.-]+/g) || []) for (const x of [w, w.replace(/[:.-]+$/, ''), w.replace(/^[:.-]+/, '')]) assert.equal(FORBID.has(H(x)), false, '書かない言葉がある');
});

// v1122 の束：SQL 1 つ（デモをやめて本番に・メールの認証をやめる・入力担当を何人でも）＋確認の SQL。どちらも元のファイルの写し。
// 関数は入力担当の名簿を渡すところだけ変えた（PIN の確かめが入る 1 ファイルは公開しない・Moto さんに直接）。
test('v1122 の束：SQL と確認の SQL は元のファイルと同じ・関数のファイルは置かない・手順は SQL → 確認 → 関数 → マージ → 端末を更新 → 担当・閲覧設定', () => {
  const D = 'deploy/mid-review-v1122/';
  assert.deepEqual(list(D), ['1_追加のSQL_本番にする.sql', '2_確認のSQL_読むだけ.sql', '手順.md'].sort());
  assert.equal(read(D + '1_追加のSQL_本番にする.sql'), read('supabase/migrations/20261102090000_mid_review_live.sql'));
  assert.equal(read(D + '2_確認のSQL_読むだけ.sql'), read('db/mid-review-postcheck.sql'));
  const howto = read(D + '手順.md');
  for (const s of ['1_追加のSQL_本番にする.sql', '2_確認のSQL_読むだけ.sql', 'mid-review live (20261102090000)', 'ceo / gm accounts without an employee id',
    'live stores without an input person', 'input_emp not the first of the list', '全文', '非公開の 1 ファイル', '何人でも', 'v1122', 'PIN が初期のまま', '前の記録', '店舗公開・通知は OFF', 'db/mid-review-stop.sql'])
    assert.ok(howto.includes(s), s);
  const at = s => howto.indexOf(s);
  assert.ok(at('| 1 |') > 0 && at('| 1 |') < at('| 2 |') && at('| 2 |') < at('| 2b |') && at('| 2b |') < at('| 3 |') && at('| 3 |') < at('| 4 |') && at('| 4 |') < at('| 5 |'));
  const row = n => howto.slice(at('| ' + n + ' |'), howto.indexOf('\n', at('| ' + n + ' |')));
  assert.match(row(1), /1_追加のSQL_本番にする\.sql/); assert.match(row(2), /2_確認のSQL_読むだけ\.sql/); assert.match(row('2b'), /関数 `mid-review`.*非公開/); assert.match(row(3), /マージ/); assert.match(row(4), /端末.*v1122/); assert.match(row(5), /担当・閲覧設定/);
  assert.equal(howto.includes('| 6 |'), false);
  assert.equal(list(D).some(f => /\.(ts|js|mjs)$/.test(f)), false, '関数（PIN の確かめ入り）は公開しない');
  const H = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
  const FORBID = new Set(['1c3082c0c5e14780', 'b6b85248bf9e8053', '32fd6f051ca87f40']);
  for (const w of howto.match(/[A-Za-z0-9_:.@-]+/g) || []) for (const x of [w, w.replace(/[:.-]+$/, ''), w.replace(/^[:.-]+/, '')]) assert.equal(FORBID.has(H(x)), false, '書かない言葉がある');
  assert.doesNotMatch(howto, /@[a-z0-9.-]+\.[a-z]{2,}/i, 'メールアドレスを書かない');
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
