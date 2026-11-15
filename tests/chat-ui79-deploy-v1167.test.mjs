// v1167 チャット改修（UI案79）：Moto さんが貼るファイル（deploy/chat-ui79-v1167）が migration と同じか・確認の SQL が読むべきものを読むか。
// 合成の DB（PGlite）・本物の SQL と handler だけ。前の版の申請のチャット（自動で入った人）を作ってから ② を流す。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const D = new URL('../deploy/chat-ui79-v1167/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, D), 'utf8');
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const WR = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68', '20261120090000_work_requests_stage2'];
const CHAT = M('20261121090000_chat'), FILES = M('20261124090000_chat_files'), UI79 = M('20261127090000_chat_ui79');
const PEOPLE = [['E1', 'Cora CEO', 'ceo', 'CEO', 'OFFICE', 'ceo'], ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'],
  ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', null], ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', null], ['E8', 'Cam Crew', 'crew', 'Crew', 'S1', null]];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));

test('the SQL to paste is the UI79 migration, letter for letter; the steps say the order, the version, the private function file, the answers and how to stop', () => {
  assert.equal(read('2_SQL_チャット改修.sql'), UI79);
  const h = read('手順.md');
  assert.match(h, /Verify JWT は OFF/); assert.match(h, /work-requests_v1167_index\.ts`（非公開/); assert.match(h, /1167/);
  assert.match(h, /deploy\/chat-v1156/); assert.match(h, /deploy\/chat-files-v1161/);
  assert.match(h, /#160 → #161 → #162 → この PR/);
  assert.match(h, /1〜6 A/); assert.match(h, /いまその申請を見られる人だけ残し/);
  assert.match(h, /戻す_チャット改修を止める\.md/);
  assert.match(read('戻す_チャット改修を止める.md'), /work-requests_v1165_index\.ts/);
  assert.match(read('戻す_チャット改修を止める.md'), /戻す SQL は用意していません/);
  assert.ok(!fs.existsSync(new URL('work-requests_v1167_index.ts', D)), 'the PIN check file never goes into the repository');
  for (const f of fs.readdirSync(D)) assert.doesNotMatch(read(f), /pin-E\d|SUPABASE_SERVICE_ROLE_KEY=|eyJhbGci/, f + ' has no keys');
});

async function base({ chat = true, files = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One',null,true);
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;`);
  for (const [id, name, role, title, store, ma] of PEOPLE) {
    await pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, name, role, title, store, JSON.stringify({ name })]);
    if (ma) await pg.query('insert into manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  for (const f of WR) await pg.exec(M(f));
  if (chat) await pg.exec(CHAT);
  if (chat && files) await pg.exec(FILES);
  await pg.exec('update public.wr_settings set live = true');
  return pg;
}
// 前の版の申請のチャット（自動で入った人）を本物の handler で作る
async function oldCaseChat(pg) {
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const gm = { emp_id: 'E2', name: NAME.E2 }; const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  const call = async (who, body) => { const r = await handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin_session: 'pin-' + who, ...body }) })); return r.json(); };
  const sub = await call('E7', { action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: 'u-000001-deploy', payload: { date: '2026-11-03', payer: NAME.E7, payer_is_employee: true, vendor: 'Costco', purpose: '仕入れ', amount_cents: 4200 } });
  const c = await call('E7', { action: 'chat_case', id: sub.id });
  assert.ok(c.thread && c.thread.id, JSON.stringify(c));
  await pg.exec(`reset role; delete from public.manager_auth where emp_id = 'E3'`);   // 経理の役を外す＝いまは申請を見られない
  return c.thread.id;
}
const rowsOf = async (pg, f) => (await pg.query(read(f))).rows;
const by = rows => n => (rows.find(r => r.check_name.startsWith(n)) || {}).result;
const okAll = rows => rows.filter(r => !/^（参考）/.test(r.check_name)).every(r => r.result === 'OK');

test('before the chat and the attachments the pre-check says STOP and the SQL changes nothing', async () => {
  for (const o of [{ chat: false }, { chat: true, files: false }]) {
    const pg = await base(o);
    const pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
    assert.match(pre('1.'), /^STOP/); assert.equal(pre('2.'), 'OK'); assert.equal(pre('3.'), '0');
    await assert.rejects(pg.exec(read('2_SQL_チャット改修.sql')), /STOP: 先にチャット/);
    assert.equal((await pg.query(`select count(*)::int n from information_schema.columns where table_name = 'chat_members' and column_name = 'admin'`)).rows[0].n, 0);
  }
});

test('with an old request chat: pre-check OK (stage 2, auto members counted); after the SQL every check is OK and the auto members who cannot read left; twice is the same', async () => {
  const pg = await base();
  const tid = await oldCaseChat(pg);
  let pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.equal(pre('1.'), 'OK'); assert.equal(pre('2.'), 'OK'); assert.equal(pre('3.'), '0'); assert.equal(pre('4.'), '2');
  assert.ok(Number(pre('（参考）申請のチャットに自動')) >= 3, pre('（参考）申請のチャットに自動'));
  assert.equal(pre('（参考）会話の数'), 'case 1');
  const post0 = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.ok(!okAll(post0), 'before the SQL the checks are not all OK');
  assert.match(by(post0)('1.'), /^NG/); assert.equal(by(post0)('6.'), 'NG（2 がまだ）');
  await pg.exec(read('2_SQL_チャット改修.sql'));
  let post = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.ok(okAll(post), JSON.stringify(post.filter(r => r.result !== 'OK')));
  const left = (await pg.query(`select emp_id from public.chat_members where thread_id = $1 and left_at is not null order by emp_id`, [tid])).rows.map(r => r.emp_id);
  assert.deepEqual(left, ['E3'], 'the accountant who can no longer see the request left');
  assert.match(by(post)('（参考）自動で入っていて'), /^[1-9]/);
  assert.match(by(post)('（参考）いまの参加者'), /^\d+・1$/, 'one manager');
  pre = by(await rowsOf(pg, '1_最初に確認_読むだけ.sql'));
  assert.equal(pre('3.'), '1'); assert.equal(pre('4.'), '3');
  await pg.exec(read('2_SQL_チャット改修.sql'));
  post = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.ok(okAll(post));
});

test('running the old chat SQL afterwards stops (v1169) and changes nothing (before, 1・3・4・11 turned NG); this SQL itself can run again', async () => {
  const pg = await base();
  await oldCaseChat(pg);
  await pg.exec(read('2_SQL_チャット改修.sql'));
  const fns = async () => (await pg.query(`select string_agg(p.proname || md5(p.prosrc), ',' order by p.proname, md5(p.prosrc)) v from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'chat%'`)).rows[0].v;
  const before = await fns();
  await assert.rejects(pg.exec(CHAT), /STOP: これより新しいチャットの SQL（段 3）が入っています/);
  await assert.rejects(pg.exec(FILES), /STOP: これより新しいチャットの SQL（段 3）が入っています/);
  assert.equal(await fns(), before, 'no chat function changed');
  await pg.exec(read('2_SQL_チャット改修.sql'));
  const rows = await rowsOf(pg, '3_確認_読むだけ.sql');
  assert.ok(okAll(rows), JSON.stringify(rows.filter(r => r.result !== 'OK')));
  let post;
  // 足りない管理する人・残った自動の行も 3 が見る
  await pg.exec(`update public.chat_members set admin = false`);
  post = by(await rowsOf(pg, '3_確認_読むだけ.sql'));
  assert.match(post('6.'), /^NG/);
  await pg.exec(read('2_SQL_チャット改修.sql'));
  assert.equal(by(await rowsOf(pg, '3_確認_読むだけ.sql'))('6.'), 'OK');
});
