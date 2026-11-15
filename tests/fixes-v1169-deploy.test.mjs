// v1169 の直しを入れる一式（deploy/fixes-v1169/）：② は migration と同じバイト・本番と同じ形の合成 DB（PGlite）で ① ② ③ が通る・
// ② のあとも前の版の ③（添付・チャット改修・守り・申請/承認）に NG が出ない・③ が見るべきものに気づく・手順の大事な文・鍵が無い。合成データだけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const M = f => rd('supabase/migrations/' + f + '.sql');
const D = 'deploy/fixes-v1169/';
const H = rd(D + '手順.md');
const lastRows = res => ((res.filter(r => r.fields && r.fields.length).pop()) || { rows: [] }).rows;
const rowsOf = async (pg, p) => lastRows(await pg.exec(rd(p)));
const by = rows => c => (rows.find(r => r.check_name.startsWith(c)) || {}).result;
const bad = rows => rows.filter(r => !/^（参考）/.test(r.check_name) && /^(STOP|NG)/.test(String(r.result)));

// 本番と同じ形：申請の段階 3・チャット・Google・添付・経費・申請/承認・チャット改修・守りまで
async function prod({ guard = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    insert into public.employees values ('E1','Cora CEO','ceo','CEO','OFFICE','[]','在籍','{}'),('E7','Lee Leader','sl','Server Leader','S1','[]','在籍','{}'),('E6','Sam Store','sl','Store Manager','S1','[]','在籍','{}');`);
  const list = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68',
    '20261113080000_wr_people_chef', '20261116080000_wr_people_g2', '20261120090000_work_requests_stage2', '20261121090000_chat', '20261122090000_google_reviews',
    '20261123090000_work_requests_stage3', '20261124090000_chat_files', '20261125090000_wr_expense_g2', '20261126090000_wr_approve_v1165', '20261127090000_chat_ui79'];
  if (guard) list.push('20261128090000_chat_guard');
  for (const f of list) await pg.exec(M(f));
  return pg;
}

test('the files: ② is the migration byte for byte; the steps name the private function file, the order, Verify JWT OFF, the old zip; no keys in the folder', () => {
  assert.equal(rd(D + '2_SQL_直し.sql'), M('20261129090000_fixes_v1169'));
  assert.deepEqual(fs.readdirSync(new URL('../' + D, import.meta.url)).sort(), ['1_最初に確認_読むだけ.sql', '2_SQL_直し.sql', '3_確認_読むだけ.sql', '戻す_直しを止める.md', '手順.md'].sort());
  assert.match(H, /`work-requests_v1169_index\.ts`（非公開/);
  assert.match(H, /前の非公開のファイル（`work-requests_v1168_index\.ts`）は貼らないでください/);
  assert.match(H, /Verify JWT は OFF/);
  assert.match(H, /`まとめ_v1163-v1168\.zip` のファイルは、もう使わないでください/);
  assert.match(H, /守りの ② → \*\*この ②\*\* の順に/);
  for (const f of ['手順.md', '戻す_直しを止める.md', '1_最初に確認_読むだけ.sql', '3_確認_読むだけ.sql'])
    assert.doesNotMatch(rd(D + f), /pin-E\d|SUPABASE_SERVICE_ROLE_KEY=|eyJhbGci|CHAT_VAPID_PRIVATE\s*[=:]\s*\S{20,}|BEGIN PRIVATE KEY/, f);
});

test('on a production-shaped database: ① no STOP (chat 4), ② twice, ③ no NG, ① again says 5 (the request stage stays 7); the older ③ checks stay without NG', async () => {
  const pg = await prod();
  // 退職した人だけが管理する人のグループ（② が 1 回直す）
  await pg.exec(`insert into public.chat_threads(id, kind, title, created_by, created_name, created_key) values ('00000000-0000-4000-8000-000000000001', 'group', 'Old', 'E7', 'Lee Leader', 'k-old-0001');
    insert into public.chat_members(thread_id, emp_id, added_by, admin) values ('00000000-0000-4000-8000-000000000001', 'E7', 'E7', true), ('00000000-0000-4000-8000-000000000001', 'E6', 'E7', false);
    update public.employees set status = '退職' where id = 'E7';`);
  let pre = await rowsOf(pg, D + '1_最初に確認_読むだけ.sql');
  assert.deepEqual(bad(pre), [], JSON.stringify(pre));
  assert.equal(by(pre)('3.'), '4'); assert.equal(by(pre)('（参考）いまの申請の段'), '7');
  assert.equal(by(pre)('（参考）管理する人が退職'), '1');
  await pg.exec(rd(D + '2_SQL_直し.sql'));
  await pg.exec(rd(D + '2_SQL_直し.sql'));
  const post = await rowsOf(pg, D + '3_確認_読むだけ.sql');
  assert.deepEqual(bad(post), [], JSON.stringify(post));
  pre = await rowsOf(pg, D + '1_最初に確認_読むだけ.sql');
  assert.equal(by(pre)('3.'), '5'); assert.equal(by(pre)('（参考）いまの申請の段'), '7');
  assert.equal(by(pre)('（参考）管理する人が退職'), '0', 'fixed once');
  for (const p of ['deploy/chat-files-v1161/3_確認_読むだけ.sql', 'deploy/chat-ui79-v1167/3_確認_読むだけ.sql', 'deploy/chat-guard-v1168/3_確認_読むだけ.sql', 'deploy/wr-approve-v1165/3_確認_読むだけ.sql']) {
    const r = lastRows(await pg.exec(rd(p)));
    const b = r.filter(x => Object.values(x).some(v => /^(STOP|NG)/.test(String(v ?? ''))) && !/^（参考）/.test(String(Object.values(x)[0] ?? '')));
    assert.deepEqual(b, [], p + ' ' + JSON.stringify(b));
  }
  // 前の版のチャットの SQL は、この上では止まる（何も変えない）
  for (const p of ['deploy/chat-v1156/2_SQL_チャット.sql', 'deploy/chat-files-v1161/2_SQL_添付.sql', 'deploy/chat-ui79-v1167/2_SQL_チャット改修.sql', 'deploy/chat-guard-v1168/2_SQL_チャットの守り.sql'])
    await assert.rejects(pg.exec(rd(p)), /STOP: これより新しいチャットの SQL（段 5）が入っています/, p);
  assert.deepEqual(bad(await rowsOf(pg, D + '3_確認_読むだけ.sql')), []);
});

test('before the chat protection: ① says STOP and ② stops without changing anything', async () => {
  const pg = await prod({ guard: false });
  assert.match(by(await rowsOf(pg, D + '1_最初に確認_読むだけ.sql'))('1.'), /^STOP/);
  await assert.rejects(pg.exec(rd(D + '2_SQL_直し.sql')), /STOP: 先にチャットの守り/);
  assert.equal((await pg.query(`select count(*)::int n from pg_proc where proname in ('chat_create_group_k','wr_acct_done')`)).rows[0].n, 0);
});

test('③ notices what it is meant to notice', async () => {
  const pg = await prod();
  await pg.exec(rd(D + '2_SQL_直し.sql'));
  const P = async () => by(await rowsOf(pg, D + '3_確認_読むだけ.sql'));
  await pg.exec(`grant execute on function public.wr_acct_done(jsonb) to anon`);
  assert.match((await P())('5.'), /^NG/);
  await pg.exec(`revoke execute on function public.wr_acct_done(jsonb) from anon; drop function public.chat_create_group_k(jsonb)`);
  assert.equal((await P())('5.'), 'OK');
  assert.match((await P())('2.'), /^NG（2 をもう一度/);
  await pg.exec(rd(D + '2_SQL_直し.sql'));
  assert.equal((await P())('2.'), 'OK');
  // 前の zip のチャット改修の SQL（止める仕組みが無い）を流した形：申請のチャットの直しが前の形に戻る
  const oldUi79 = M('20261127090000_chat_ui79').replace(/do \$\$ declare v integer := 0; begin[\s\S]*?end \$\$;\n/, '');
  await pg.exec(oldUi79);
  assert.match((await P())('3.'), /^NG/);
  await pg.exec(rd('deploy/chat-guard-v1168/2_SQL_チャットの守り.sql'));
  await pg.exec(rd(D + '2_SQL_直し.sql'));
  assert.equal((await P())('3.'), 'OK');
});
