// v1161 チャットの添付（UI案75 の答え）。本物の SQL（申請 1 段目〜段階 2 ＋ チャット ＋ 添付・PGlite）と本物の handler、
// 置き場所（Storage）は代わり（メモリ）。合成データだけ。PIN の確かめは代わり（'pin-E7' は社員 E7）。仕様：docs/CHAT_FILES_V1161_JA.md
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler, storageApi, sniffOk, FILE_MAX } from '../supabase/functions/work-requests/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const M = f => fs.readFileSync(new URL('../supabase/migrations/' + f + '.sql', import.meta.url), 'utf8');
const MIGS = ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68', '20261120090000_work_requests_stage2'];
const CHAT_SQL = M('20261121090000_chat');
export const FILES_SQL = M('20261124090000_chat_files');

const PEOPLE = [
  ['E1', 'Cora CEO', 'ceo', 'CEO', 'OFFICE', 'ceo'], ['E2', 'Gabe GM', 'gm', 'General Manager', 'OFFICE', 'gm'], ['E3', 'Ann Acct', 'office', 'Accountant', 'OFFICE', 'office'],
  ['E5', 'Ami Area', 'am', 'Area Manager', 'S1', null], ['E6', 'Sam Store', 'sl', 'Store Manager', 'S1', null], ['E7', 'Lee Leader', 'sl', 'Server Leader', 'S1', null],
  ['E8', 'Cam Crew', 'crew', 'Crew', 'S1', null], ['E9', 'Kai Kitchen', 'crew', 'Crew', 'S2', null], ['E12', 'Hal Head', 'sl', 'Store Manager', 'S2', null],
  ['E13', 'Ora Office', 'crew', 'Crew', 'S1', 'office_crew'],
];
const NAME = Object.fromEntries(PEOPLE.map(p => [p[0], p[1]]));

// 中身の先頭（合成）
const B = {
  jpg: n => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(Math.max(0, n - 4)).fill(1)]),
  pdf: () => new TextEncoder().encode('%PDF-1.7\n1 0 obj'),
  zip: () => Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0]),
  ole: () => Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]),
  png: () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]),
  txt: s => new TextEncoder().encode(s || '日付,金額\n2026-11-01,86.40\n'),
};

// 置き場所の代わり（上げる先・読む先・先頭の 16 バイトと大きさ・消す）
function fakeStorage() {
  const objs = new Map();
  const st = {
    objs, removed: [], failRemove: false, signed: [],
    put(path, bytes, size) { objs.set(path, { bytes, size: size ?? bytes.length }); },
    async signUpload(path) { return { url: 'https://store.test/upload/' + path + '?token=t', token: 't' }; },
    async signDownload(paths, { expires = 300, download = null } = {}) {
      st.signed.push({ paths, expires, download });
      return Object.fromEntries(paths.filter(p => objs.has(p)).map(p => [p, 'https://store.test/dl/' + p + '?token=s' + (download ? '&download=' + encodeURIComponent(download) : '')]));
    },
    async head(path) { const o = objs.get(path); return o ? { bytes: o.bytes.slice(0, 16), size: o.size } : null; },
    async remove(paths) { if (st.failRemove) throw new Error('storage remove 500'); st.removed.push(...paths); for (const p of paths) objs.delete(p); },
  };
  return st;
}

async function makeDb({ chat = true, files = true, twice = false, storageSchema = true, policy = null } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, am text, active boolean);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    grant select on public.manager_auth, public.employees, public.stores to service_role; grant select, insert, update on public.app_state to service_role;
    insert into public.stores values ('S1','Store One','Ami Area',true),('S2','Store Two',null,true);`);
  if (storageSchema) {
    await pg.exec(`create schema storage;
      create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      create policy "invoices read" on storage.objects for select to anon using (bucket_id = 'invoices');`);
    if (policy) await pg.exec(policy);
  }
  for (const [id, name, role, title, store, ma] of PEOPLE) {
    await pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, name, role, title, store, JSON.stringify({ name })]);
    if (ma) await pg.query('insert into manager_auth(role, emp_id) values($1,$2)', [ma, id]);
  }
  for (const f of MIGS) await pg.exec(M(f));
  if (chat) await pg.exec(CHAT_SQL);
  if (chat && files) { await pg.exec(FILES_SQL); if (twice) await pg.exec(FILES_SQL); }
  await pg.exec('update public.wr_settings set live = true; set role service_role');
  return pg;
}

async function setup(opt = {}) {
  const pg = await makeDb(opt);
  const calls = [];
  const db = { async rpc(name, p) { calls.push(name); const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; } };
  const gm = { emp_id: 'E2', name: NAME.E2 }; const d = await db.rpc('wr_people_diff', gm); await db.rpc('wr_people_sync', { ...gm, digest: d.digest });
  const storage = opt.storage || fakeStorage();
  const handler = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k], db, storage,
    verifyPin: async tok => { const m = /^pin-(E\d+)$/.exec(tok); return m ? { emp_id: m[1], name: NAME[m[1]] } : null; } });
  let seq = 0;
  const key = () => 'f-' + (++seq).toString().padStart(6, '0') + '-file';
  const call = async (who, body) => { const r = await handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin_session: 'pin-' + who, ...body }) })); return { status: r.status, body: await r.json() }; };
  const ok = async (who, body) => { const r = await call(who, body); assert.equal(r.status, 200, who + ' ' + body.action + ' ' + JSON.stringify(r.body)); return r.body; };
  // 上げる：準備 → 置き場所へ（中身を指定。thumb:false で小さい写真を上げない）
  const up = async (who, thread, f, put = {}) => {
    const s = await ok(who, { action: 'chat_file_start', thread, client_key: f.key || key(), name: f.name, ext: f.ext, size: f.size ?? 1000, w: f.w, h: f.h });
    const path = s.upload && new URL(s.upload.url).pathname.replace('/upload/', '');
    if (path && put.main !== false) storage.put(path, put.bytes || (f.ext === 'jpg' ? B.jpg(64) : f.ext === 'pdf' ? B.pdf() : /x$/.test(f.ext) ? B.zip() : ['xls', 'doc', 'ppt'].includes(f.ext) ? B.ole() : B.txt()), put.size);
    if (s.thumb_upload && put.thumb !== false) storage.put(path + '.t', put.thumbBytes || B.jpg(32), put.thumbSize);
    return { ...s, path };
  };
  const send = (who, thread, body, files, extra = {}) => call(who, { action: 'chat_send', thread, body, files, client_key: extra.key || key(), mentions: extra.mentions });
  const msgs = (who, thread) => call(who, { action: 'chat_messages', thread });
  const fileRow = async id => (await pg.query('select * from public.chat_files where id = $1', [id])).rows[0];
  return { pg, db, calls, storage, call, ok, key, up, send, msgs, fileRow };
}
const asAdmin = async (pg, sql, args) => { await pg.exec('reset role'); try { return await pg.query(sql, args); } finally { await pg.exec('set role service_role'); } };

test('the attachment SQL comes after the chat SQL, stops on a storage rule that is not limited to one place, runs twice, and the bucket is private', async () => {
  await assert.rejects(makeDb({ chat: false, files: false }).then(pg => pg.exec(FILES_SQL)), /STOP: 先にチャットの SQL/);
  await assert.rejects(makeDb({ policy: `create policy "all read" on storage.objects for select to anon using (true);` }), /STOP: Storage（storage.objects）に置き場所を限らない決まり/);
  await assert.rejects(makeDb({ policy: `create policy "chat" on storage.objects for select to authenticated using (bucket_id = 'chat-files');` }), /STOP: Storage に chat-files を開ける決まり/);
  const pg = await makeDb({ twice: true });
  await pg.exec('reset role');
  const b = (await pg.query(`select * from storage.buckets where id = 'chat-files'`)).rows[0];
  assert.equal(b.public, false); assert.equal(Number(b.file_size_limit), 10485760);
  assert.deepEqual([...b.allowed_mime_types].sort(), ['application/msword', 'application/pdf', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'text/csv', 'text/plain']);
  // 置き場所が無い環境（試験だけ）でも表と関数はできる
  const p2 = await makeDb({ storageSchema: false });
  await p2.exec('reset role');
  assert.equal((await p2.query(`select count(*)::int n from pg_tables where tablename = 'chat_files'`)).rows[0].n, 1);
  // 公開の鍵では表も関数も触れない
  await pg.exec('set role anon');
  await assert.rejects(pg.query('select * from public.chat_files'), /permission denied/);
  for (const fn of ['chat_file_start', 'chat_files_access', 'chat_files_list', 'chat_file_purge_list', 'wr_receipt_from_chat', 'wr_receipt_file']) {
    await assert.rejects(pg.query(`select public.${fn}('{}'::jsonb)`), /permission denied/, fn);
  }
  await pg.exec('reset role');
});

test('before the attachment SQL the function says files_missing; text chat keeps working; whoami tells the version', async () => {
  const s = await setup({ files: false });
  const w = (await s.call('E8', { action: 'whoami' })).body;
  assert.equal(w.fn, 7); assert.equal(w.chat, 1, 'chat stage 1 = no attachments yet');
  const dm = await s.ok('E8', { action: 'chat_open_dm', to: 'E9' });
  const r = await s.call('E8', { action: 'chat_file_start', thread: dm.id, client_key: s.key(), name: 'a.pdf', ext: 'pdf', size: 100 });
  assert.deepEqual([r.status, r.body.error], [503, 'files_missing']);
  const r2 = await s.send('E8', dm.id, '', ['00000000-0000-4000-8000-000000000001']);
  assert.deepEqual([r2.status, r2.body.error], [503, 'files_missing']);
  assert.equal((await s.send('E8', dm.id, 'text only')).status, 200);
  const s2 = await setup();
  assert.equal((await s2.call('E8', { action: 'whoami' })).body.chat, 2);
  assert.equal((await s2.ok('E8', { action: 'chat_sync' })).limits.files.max, 5);
});

test('send photos and files (1B・3A): checked on the server, one message per key, a body is optional, the list line says what was sent', async () => {
  const { ok, call, up, send, msgs, key, storage, fileRow } = await setup();
  const dm = await ok('E8', { action: 'chat_open_dm', to: 'E9' });
  const ph = await up('E8', dm.id, { name: 'IMG_0001.HEIC.jpg', ext: 'jpg', size: 900000, w: 2000, h: 1500 });
  assert.equal(ph.status, 'up'); assert.ok(ph.upload.url); assert.ok(ph.thumb_upload.url, 'a photo gets a second place for the small picture');
  assert.equal(ph.name, 'IMG_0001.HEIC.jpg'); assert.equal(ph.kind, 'photo'); assert.equal(ph.path.split('/').length, 2, 'the place name is two meaningless ids');
  const pdf = await up('E8', dm.id, { name: '請求書 10月.pdf', ext: 'pdf', size: 30000 });
  assert.equal(pdf.thumb_upload, undefined);
  const k = key();
  const m = await send('E8', dm.id, '', [ph.id, pdf.id], { key: k });
  assert.equal(m.status, 200, JSON.stringify(m.body));
  assert.equal(m.body.body, ''); assert.deepEqual(m.body.files.map(f => f.name), ['IMG_0001.HEIC.jpg', '請求書 10月.pdf'], 'in the order picked');
  assert.equal(m.body.files[0].thumb, true); assert.equal(m.body.files[0].size, 64, 'the size is what was really uploaded');
  assert.equal(m.body.files[1].path, undefined, 'the place name is never shown');
  assert.equal((await send('E8', dm.id, '', [ph.id, pdf.id], { key: k })).body.replay, true, 'a lost answer: the same message');
  assert.equal((await send('E8', dm.id, 'again', [ph.id])).body.error, 'file_bad', 'a sent file cannot go into another message');
  const s9 = await ok('E9', { action: 'chat_sync' });
  assert.equal(s9.threads[0].preview.text, '写真 1 枚・ファイル 1 個');
  const got = (await msgs('E9', dm.id)).body.messages;
  assert.equal(got[0].files.length, 2);
  // 文字だけ・写真だけ・ファイル 1 つ・ファイル 2 つの一覧の 1 行
  const p2 = await up('E8', dm.id, { ext: 'jpg', size: 1, w: 10, h: 10 });
  const p3 = await up('E8', dm.id, { ext: 'jpg', size: 1, w: 10, h: 10 });
  await send('E8', dm.id, '', [p2.id, p3.id]);
  assert.equal((await ok('E9', { action: 'chat_sync' })).threads[0].preview.text, '写真 2 枚');
  const x1 = await up('E8', dm.id, { name: 'シフト.xlsx', ext: 'xlsx' });
  await send('E8', dm.id, '', [x1.id]);
  assert.equal((await ok('E9', { action: 'chat_sync' })).threads[0].preview.text, 'ファイル「シフト.xlsx」');
  const d1 = await up('E8', dm.id, { name: 'a.docx', ext: 'docx' }), d2 = await up('E8', dm.id, { name: 'b.pptx', ext: 'pptx' });
  await send('E8', dm.id, '資料です', [d1.id, d2.id]);
  assert.equal((await ok('E9', { action: 'chat_sync' })).threads[0].preview.text, '資料です', 'a body wins');
  // 古い形（xls・doc・ppt）・csv・txt
  for (const ext of ['xls', 'doc', 'ppt', 'csv', 'txt']) {
    const f = await up('E8', dm.id, { name: 'old.' + ext, ext });
    assert.equal((await send('E8', dm.id, '', [f.id])).status, 200, ext);
  }
  // 名前：区切りの文字・制御文字・長さ・拡張子は付け直す・空なら photo / file
  const n1 = await up('E8', dm.id, { name: 'a/b\\c:d*?"<>|e\u0007.PDF', ext: 'pdf' });
  assert.equal(n1.name, 'a_b_c_d______e.pdf');
  const n2 = await up('E8', dm.id, { name: 'x'.repeat(150) + '.pdf', ext: 'pdf' });
  assert.equal(n2.name.length, 104);
  assert.equal((await up('E8', dm.id, { name: '', ext: 'jpg', w: 1, h: 1 })).name, 'photo.jpg');
  assert.equal((await up('E8', dm.id, { name: '  ', ext: 'txt' })).name, 'file.txt');
  // 同じ鍵の準備は同じ 1 つ（上げ直せる）
  const kk = key();
  const a1 = await up('E8', dm.id, { key: kk, ext: 'pdf' }, { main: false });
  const a2 = await ok('E8', { action: 'chat_file_start', thread: dm.id, client_key: kk, name: 'x.pdf', ext: 'pdf', size: 10 });
  assert.equal(a2.id, a1.id); assert.ok(a2.upload, 'still up: a new upload place');
  const other = await ok('E8', { action: 'chat_open_dm', to: 'E7' });
  assert.equal((await call('E8', { action: 'chat_file_start', thread: other.id, client_key: kk, name: 'x.pdf', ext: 'pdf', size: 10 })).status, 409, 'the same key in another chat');
  void storage; void fileRow;
});

test('limits (3A) and checks: kinds, size, count, someone else’s file, content that is not what the name says, missing small picture', async () => {
  const { ok, call, up, send, key, storage, fileRow, pg, db } = await setup();
  const dm = await ok('E8', { action: 'chat_open_dm', to: 'E9' });
  const start = (b) => call('E8', { action: 'chat_file_start', thread: dm.id, client_key: key(), name: 'x', size: 100, ...b });
  assert.deepEqual([(await start({ ext: 'exe' })).status, (await start({ ext: 'exe' })).body.error], [400, 'file_type']);
  assert.equal((await start({ ext: 'png' })).body.error, 'file_type', 'photos are always sent as JPEG');
  assert.equal((await start({ ext: 'heic' })).body.error, 'file_type');
  assert.deepEqual([(await start({ ext: 'pdf', size: FILE_MAX.size + 1 })).status, (await start({ ext: 'pdf', size: FILE_MAX.size + 1 })).body.error], [413, 'file_big']);
  assert.equal((await start({ ext: 'pdf', size: FILE_MAX.size })).status, 200, '10MB exactly is fine');
  assert.equal((await start({ ext: 'pdf', size: 0 })).status, 400);
  assert.equal((await start({ ext: 'jpg' })).status, 400, 'a photo needs its size in pixels');
  assert.equal((await start({ ext: 'jpg', w: 4001, h: 10 })).status, 400);
  assert.equal((await call('E8', { action: 'chat_file_start', thread: dm.id, client_key: key(), name: 'x', ext: 'pdf', size: 1.5 })).status, 400);
  // 6 つは送れない
  const six = []; for (let i = 0; i < 6; i++) six.push((await up('E8', dm.id, { ext: 'pdf' })).id);
  assert.equal((await send('E8', dm.id, '', six)).status, 400);
  assert.equal((await send('E8', dm.id, '', [six[0], six[0]])).status, 400, 'twice the same file');
  assert.equal((await send('E8', dm.id, '', six.slice(0, 5))).status, 200, 'five is fine');
  // ほかの人の・ほかの会話のファイルは使えない
  const theirs = await up('E9', dm.id, { ext: 'pdf' });
  assert.equal((await send('E8', dm.id, '', [theirs.id])).body.error, 'file_bad');
  // 関数を通らずに SQL を呼んでも（確かめ済みの ok でも）ほかの人のファイルは送れない
  await db.rpc('chat_file_mark', { emp_id: 'E9', name: NAME.E9, id: theirs.id, ok: true });
  assert.equal((await fileRow(theirs.id)).status, 'ok');
  await assert.rejects(db.rpc('chat_send', { emp_id: 'E8', name: NAME.E8, thread: dm.id, body: '', client_key: key(), files: [theirs.id] }), /file_bad/);
  assert.equal((await fileRow(theirs.id)).message_id, null);
  const g = await ok('E8', { action: 'chat_open_dm', to: 'E7' });
  const elsewhere = await up('E8', g.id, { ext: 'pdf' });
  assert.equal((await send('E8', dm.id, '', [elsewhere.id])).body.error, 'file_bad');
  // 名前は .pdf でも中身が PNG：送らない（状態 bad）。もう一度送っても bad
  const fake = await up('E8', dm.id, { ext: 'pdf' }, { bytes: B.png() });
  const r1 = await send('E8', dm.id, 'x', [fake.id]);
  assert.deepEqual([r1.status, r1.body.error], [409, 'file_bad']);
  assert.equal((await fileRow(fake.id)).status, 'bad'); assert.equal((await fileRow(fake.id)).bad_reason, 'content');
  assert.equal((await send('E8', dm.id, 'x', [fake.id])).body.error, 'file_bad');
  // xlsx の名前で古い形（OLE）の中身、txt の名前で PDF の中身
  assert.equal((await send('E8', dm.id, '', [(await up('E8', dm.id, { ext: 'xlsx' }, { bytes: B.ole() })).id])).body.error, 'file_bad');
  assert.equal((await send('E8', dm.id, '', [(await up('E8', dm.id, { ext: 'txt' }, { bytes: B.pdf() })).id])).body.error, 'file_bad');
  assert.equal((await send('E8', dm.id, '', [(await up('E8', dm.id, { ext: 'csv' }, { bytes: Uint8Array.from([0x61, 0, 0x62]) })).id])).body.error, 'file_bad', 'a NUL byte is not text');
  // 本当の大きさが 10MB を超えていた
  assert.equal((await send('E8', dm.id, '', [(await up('E8', dm.id, { ext: 'pdf' }, { size: FILE_MAX.size + 1 })).id])).body.error, 'file_bad');
  // まだ上がっていない：file_missing（状態は up のまま。上げてから送れば送れる）
  const late = await up('E8', dm.id, { ext: 'pdf' }, { main: false });
  const r2 = await send('E8', dm.id, '', [late.id]);
  assert.deepEqual([r2.status, r2.body.error], [409, 'file_missing']);
  assert.equal((await fileRow(late.id)).status, 'up');
  storage.put(late.path, B.pdf());
  assert.equal((await send('E8', dm.id, '', [late.id])).status, 200);
  // 写真の小さい写真が無い・JPEG でない・大きすぎる
  const noThumb = await up('E8', dm.id, { ext: 'jpg', w: 1, h: 1 }, { thumb: false });
  assert.equal((await send('E8', dm.id, '', [noThumb.id])).body.error, 'file_missing');
  assert.equal((await send('E8', dm.id, '', [(await up('E8', dm.id, { ext: 'jpg', w: 1, h: 1 }, { thumbBytes: B.png() })).id])).body.error, 'file_bad');
  const big = await up('E8', dm.id, { ext: 'jpg', w: 1, h: 1 }, { thumbSize: FILE_MAX.thumb + 1 });
  assert.equal((await send('E8', dm.id, '', [big.id])).body.error, 'file_bad');
  assert.equal((await fileRow(big.id)).bad_reason, 'thumb');
  // 1 日に送らないファイルは 30 まで（送ったものは数えない）
  await asAdmin(pg, `update public.chat_files set status = 'up', message_id = null where owner_emp = 'E9'`);
  for (let i = (await asAdmin(pg, `select count(*)::int n from public.chat_files where owner_emp = 'E9' and status in ('up','ok','bad')`)).rows[0].n; i < 30; i++) await up('E9', dm.id, { ext: 'pdf' });
  const tm = await call('E9', { action: 'chat_file_start', thread: dm.id, client_key: key(), name: 'x', ext: 'pdf', size: 1 });
  assert.deepEqual([tm.status, tm.body.error], [409, 'file_many']);
  // メンバーでない会話には上げられない
  assert.equal((await call('E6', { action: 'chat_file_start', thread: dm.id, client_key: key(), name: 'x', ext: 'pdf', size: 1 })).status, 404);
});

test('open and save (4A): only people who can read the message; 5-minute links; small pictures together; deleted or hidden ones never', async () => {
  const { ok, call, up, send, key, storage, pg } = await setup();
  const g = await ok('E6', { action: 'chat_create_group', title: 'S1', members: ['E7', 'E8'], client_key: key() });
  const ph = await up('E7', g.id, { name: 'レジ.jpg', ext: 'jpg', w: 800, h: 600 });
  const pdf = await up('E7', g.id, { name: 'メニュー.pdf', ext: 'pdf' });
  const m = (await send('E7', g.id, 'see', [ph.id, pdf.id])).body;
  const o = await ok('E8', { action: 'chat_file_url', id: pdf.id });
  assert.match(o.url, /^https:\/\/store\.test\/dl\//); assert.equal(o.name, 'メニュー.pdf'); assert.equal(o.mime, 'application/pdf'); assert.equal(o.expires, 300);
  assert.equal(storage.signed.at(-1).expires, 300);
  const sv = await ok('E8', { action: 'chat_file_url', id: pdf.id, download: true });
  assert.match(sv.url, /download=%E3%83%A1/, 'save uses the original name');
  const th = await ok('E8', { action: 'chat_file_url', ids: [ph.id, pdf.id], thumb: true });
  assert.deepEqual(th.items.map(x => x.id).sort(), [ph.id, pdf.id].sort());
  assert.match(th.items.find(x => x.id === ph.id).url, /\.t\?/, 'a photo’s small picture');
  assert.doesNotMatch(th.items.find(x => x.id === pdf.id).url, /\.t\?/);
  assert.equal(storage.signed.at(-1).paths.length, 2, 'signed together');
  assert.equal((await call('E8', { action: 'chat_file_url', ids: [ph.id, pdf.id], download: true })).status, 400, 'save is one at a time');
  assert.equal((await call('E9', { action: 'chat_file_url', id: pdf.id })).status, 404, 'not a member');
  assert.deepEqual((await ok('E9', { action: 'chat_file_url', ids: [pdf.id], thumb: true })).items, [], 'a list answer leaves it out');
  // まだ送っていないファイルは本人も開けない（上げただけのもの）
  const draft = await up('E7', g.id, { ext: 'pdf' });
  assert.equal((await call('E7', { action: 'chat_file_url', id: draft.id })).status, 404);
  // あとから加わった人：見せない設定なら前のファイルは開けない
  await ok('E6', { action: 'chat_add', thread: g.id, members: ['E5'], history: false });
  assert.equal((await call('E5', { action: 'chat_file_url', id: pdf.id })).status, 404);
  await ok('E6', { action: 'chat_add', thread: g.id, members: ['E13'], history: true });
  assert.equal((await call('E13', { action: 'chat_file_url', id: pdf.id })).status, 200);
  // GM・CEO が見えなくした：ファイルも出さない（残す）
  const g2 = await ok('E2', { action: 'chat_create_group', title: 'H', members: ['E7', 'E8'], client_key: key() });
  const hp = await up('E7', g2.id, { ext: 'pdf' });
  const hm = (await send('E7', g2.id, 'bad', [hp.id])).body;
  await ok('E2', { action: 'chat_hide', id: hm.id, hide: true, reason: '個人の情報' });
  assert.equal((await call('E8', { action: 'chat_file_url', id: hp.id })).status, 404);
  const seen = (await call('E8', { action: 'chat_messages', thread: g2.id })).body.messages[0];
  assert.deepEqual(seen.files, [], 'a hidden message shows no files');
  assert.equal((await asAdmin(pg, 'select status from public.chat_files where id = $1', [hp.id])).rows[0].status, 'sent', 'kept');
  assert.ok(storage.objs.has(hp.path), 'kept in storage');
  await ok('E2', { action: 'chat_hide', id: hm.id, hide: false });
  assert.equal((await call('E8', { action: 'chat_file_url', id: hp.id })).status, 200, 'shown again');
  void m;
});

test('delete (5A): the author’s delete removes the files from storage; a failed removal is tried again after 10 minutes; unsent files go after 1 day (6A)', async () => {
  const { ok, call, up, send, storage, pg, fileRow } = await setup();
  const dm = await ok('E8', { action: 'chat_open_dm', to: 'E9' });
  const ph = await up('E8', dm.id, { ext: 'jpg', w: 1, h: 1 });
  const m = (await send('E8', dm.id, 'x', [ph.id])).body;
  assert.equal((await call('E9', { action: 'chat_delete', id: m.id })).status, 403, 'only the author');
  const d = await ok('E8', { action: 'chat_delete', id: m.id });
  assert.equal(d.deleted, true); assert.deepEqual(d.files, []);
  assert.deepEqual(storage.removed.sort(), [ph.path, ph.path + '.t'].sort());
  const row = await fileRow(ph.id);
  assert.equal(row.status, 'gone'); assert.equal(row.name, null, 'the name goes too');
  assert.equal((await call('E9', { action: 'chat_file_url', id: ph.id })).status, 404);
  // 消すのに失敗：消しかけのまま。10 分たてばもう一度
  const p2 = await up('E8', dm.id, { ext: 'pdf' });
  const m2 = (await send('E8', dm.id, 'y', [p2.id])).body;
  storage.failRemove = true;
  assert.equal((await call('E8', { action: 'chat_delete', id: m2.id })).status, 200, 'the delete itself is done');
  assert.equal((await fileRow(p2.id)).status, 'purging');
  storage.failRemove = false;
  await ok('E8', { action: 'chat_delete', id: m2.id });
  assert.equal((await fileRow(p2.id)).status, 'purging', 'not before 10 minutes');
  await asAdmin(pg, `update public.chat_files set purge_at = now() - interval '11 minutes' where id = $1`, [p2.id]);
  const p3 = await up('E8', dm.id, { ext: 'pdf' });   // 上げる準備でも少しずつ片づける
  assert.equal((await fileRow(p2.id)).status, 'gone');
  // 送らなかったファイル：1 日たつと消す（1 日たたないものは消さない）
  await asAdmin(pg, `update public.chat_files set created_at = now() - interval '25 hours' where id = $1`, [p3.id]);
  const p4 = await up('E8', dm.id, { ext: 'pdf' });
  assert.equal((await fileRow(p3.id)).status, 'gone'); assert.ok(!storage.objs.has(p3.path));
  assert.equal((await fileRow(p4.id)).status, 'up');
  assert.equal((await send('E8', dm.id, '', [p3.id])).body.error, 'file_bad', 'gone: attach it again');
});

test('edit: a message with files can lose its text; a text-only message cannot', async () => {
  const { ok, call, up, send } = await setup();
  const dm = await ok('E8', { action: 'chat_open_dm', to: 'E9' });
  const f = await up('E8', dm.id, { ext: 'pdf' });
  const m = (await send('E8', dm.id, '請求書', [f.id])).body;
  const e = await ok('E8', { action: 'chat_edit', id: m.id, body: '' });
  assert.equal(e.body, ''); assert.equal(e.files.length, 1);
  assert.equal((await ok('E9', { action: 'chat_sync' })).threads[0].preview.text, 'ファイル「file.pdf」'.replace('file.pdf', e.files[0].name));
  const t = (await send('E8', dm.id, 'text')).body;
  assert.equal((await call('E8', { action: 'chat_edit', id: t.id, body: '' })).status, 400);
  assert.equal((await send('E8', dm.id, '')).status, 400, 'no files and no text: refused');
});

test('this chat’s files (7A): newest first, by message pages, without deleted or hidden ones, only what you may read', async () => {
  const { ok, call, up, send, key } = await setup();
  const g = await ok('E6', { action: 'chat_create_group', title: 'S1', members: ['E7', 'E8'], client_key: key() });
  const ids = [];
  for (let i = 0; i < 5; i++) { const f = await up('E7', g.id, { name: 'f' + i + '.pdf', ext: 'pdf' }); ids.push((await send('E7', g.id, 'm' + i, [f.id])).body.id); }
  const two = [await up('E8', g.id, { ext: 'jpg', w: 1, h: 1 }), await up('E8', g.id, { ext: 'jpg', w: 1, h: 1 })];
  await send('E8', g.id, '', two.map(x => x.id));
  await send('E7', g.id, 'no file');
  await ok('E7', { action: 'chat_delete', id: ids[2] });
  const p1 = await ok('E6', { action: 'chat_files', thread: g.id, limit: 2 });
  assert.equal(p1.items.length, 3, 'two messages: the last one has 2 photos');
  assert.equal(p1.items[0].kind, 'photo'); assert.equal(p1.items[2].name, 'f4.pdf'); assert.equal(p1.items[0].by, NAME.E8);
  assert.equal(p1.more, true);
  const p2 = await ok('E6', { action: 'chat_files', thread: g.id, before: p1.before, limit: 10 });
  assert.deepEqual(p2.items.map(x => x.name), ['f3.pdf', 'f1.pdf', 'f0.pdf'], 'the deleted one is gone');
  assert.equal(p2.more, false);
  assert.equal((await call('E9', { action: 'chat_files', thread: g.id })).status, 404);
  await ok('E6', { action: 'chat_add', thread: g.id, members: ['E5'], history: false });
  assert.deepEqual((await ok('E5', { action: 'chat_files', thread: g.id })).items, [], 'added without history');
});

test('use as the receipt (8B): the requester attaches a photo or PDF from the request’s chat; kept even if the message is deleted', async () => {
  const { ok, call, up, send, key, storage, fileRow, pg, db } = await setup();
  let r = await ok('E7', { action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: key(),
    payload: { date: '2026-11-01', payer: NAME.E7, payer_is_employee: true, vendor: 'Costco', purpose: '仕入れ', amount_cents: 8640 } });
  const c = (await ok('E7', { action: 'chat_case', id: r.id })).thread;
  assert.equal(c.ref.mine, true); assert.equal(c.ref.rev, r.rev);
  assert.equal((await ok('E2', { action: 'chat_case', id: r.id })).thread.ref.mine, false);
  const ph = await up('E7', c.id, { name: 'receipt.jpg', ext: 'jpg', w: 1000, h: 1400 });
  const xl = await up('E7', c.id, { name: 'list.xlsx', ext: 'xlsx' });
  const gp = await up('E2', c.id, { name: 'gm.pdf', ext: 'pdf' });
  const m = (await send('E7', c.id, 'レシートです', [ph.id, xl.id])).body;
  await send('E2', c.id, '', [gp.id]);
  const att = (who, file, extra = {}) => call(who, { action: 'wr_receipt_chat', id: r.id, file, expect_rev: extra.rev ?? r.rev, client_key: extra.key || key() });
  assert.equal((await att('E2', ph.id)).status, 403, 'only the requester');
  assert.equal((await att('E7', xl.id)).body.error, 'file_type', 'only a photo or PDF');
  assert.equal((await att('E7', ph.id, { rev: r.rev + 5 })).status, 409, 'an old screen');
  const dm = await ok('E7', { action: 'chat_open_dm', to: 'E8' });
  const elsewhere = await up('E7', dm.id, { ext: 'jpg', w: 1, h: 1 });
  await send('E7', dm.id, '', [elsewhere.id]);
  assert.equal((await att('E7', elsewhere.id)).status, 404, 'a file from another chat');
  assert.equal((await att('E7', gp.id)).status, 200, 'someone else’s photo or PDF in this chat is fine for the requester');
  r = (await ok('E7', { action: 'get', id: r.id })).request || (await ok('E7', { action: 'get', id: r.id }));
  const k = key();
  const a = await ok('E7', { action: 'wr_receipt_chat', id: r.id, file: ph.id, expect_rev: r.rev, client_key: k });
  assert.equal(a.payload.receipt.chat_file, ph.id); assert.equal(a.payload.receipt.name, 'receipt.jpg'); assert.equal(a.payload.receipt.kind, 'photo');
  assert.equal(a.version, r.version + 1);
  assert.equal((await ok('E7', { action: 'wr_receipt_chat', id: r.id, file: ph.id, expect_rev: r.rev, client_key: k })).replay, true, 'same key: same result');
  const g = await ok('E7', { action: 'get', id: r.id });
  const ev = (g.events || g.request?.events || []).map(e => e.action);
  assert.ok(ev.includes('receipt_chat'), JSON.stringify(ev));
  // 開ける：申請を見られる人（申請の決まり）。見られない人は開けない
  const u = await ok('E3', { action: 'wr_receipt_url', id: r.id });
  assert.match(u.url, /store\.test\/dl\//); assert.equal(u.name, 'receipt.jpg');
  assert.match((await ok('E3', { action: 'wr_receipt_url', id: r.id, download: true })).url, /download=receipt\.jpg/);
  assert.equal((await call('E9', { action: 'wr_receipt_url', id: r.id })).status, 404);
  // 本人がメッセージを消しても、領収書にした写真は残る（申請の記録）。もう 1 つのファイルは消える
  await ok('E7', { action: 'chat_delete', id: m.id });
  assert.equal((await fileRow(ph.id)).status, 'sent'); assert.ok(storage.objs.has(ph.path));
  assert.equal((await fileRow(xl.id)).status, 'gone');
  assert.equal((await ok('E2', { action: 'wr_receipt_url', id: r.id })).name, 'receipt.jpg');
  // 片づけ（消す・送らなかったファイル）は、申請の領収書にしたファイルをどの状態でも消さない
  await asAdmin(pg, `update public.chat_files set status = 'del', created_at = now() - interval '2 days' where id = $1`, [ph.id]);
  await up('E7', c.id, { ext: 'pdf' });   // 上げる準備で片づけが動く
  assert.equal((await fileRow(ph.id)).status, 'del'); assert.ok(storage.objs.has(ph.path));
  await asAdmin(pg, `update public.chat_files set status = 'purging', purge_at = now() - interval '11 minutes' where id = $1`, [ph.id]);
  await up('E7', c.id, { ext: 'pdf' });
  assert.equal((await fileRow(ph.id)).status, 'purging', 'not picked again'); assert.ok(storage.objs.has(ph.path));
  await db.rpc('chat_file_purged', { ids: [ph.id] });
  assert.notEqual((await fileRow(ph.id)).status, 'gone');
  await asAdmin(pg, `update public.chat_files set status = 'sent' where id = $1`, [ph.id]);
  assert.equal((await call('E2', { action: 'chat_file_url', id: ph.id })).status, 404, 'but it is not shown in the chat any more');
  // 申請を直して出し直しても領収書（チャットのファイル）は残る
  const cur = await ok('E7', { action: 'get', id: r.id });
  const rr = cur.request || cur;
  const ret = await call('E2', { action: 'act', id: r.id, op: 'return', expect_rev: rr.rev, client_key: key(), note: '金額を確認' });
  assert.equal(ret.status, 200, JSON.stringify(ret.body));
  const re = await ok('E7', { action: 'act', id: r.id, op: 'resubmit', expect_rev: ret.body.rev, client_key: key(), kind: 'reimburse',
    payload: { ...ret.body.payload, amount_cents: 8600 } });
  assert.equal(re.payload.receipt.chat_file, ph.id);
  assert.equal((await ok('E3', { action: 'wr_receipt_url', id: r.id })).name, 'receipt.jpg');
  // 決まったあとは付け替えられない
  await ok('E2', { action: 'act', id: r.id, op: 'approve', expect_rev: re.rev, client_key: key() });
  const after = await ok('E7', { action: 'get', id: r.id });
  assert.equal((await att('E7', gp.id, { rev: (after.request || after).rev })).status, 403);
  // 名前を変えたチャットのファイルの id を payload に書いても、ほかのファイルは開けない
  const r2 = await ok('E7', { action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: key(),
    payload: { date: '2026-11-02', payer: NAME.E7, payer_is_employee: true, vendor: 'Costco', purpose: '仕入れ', amount_cents: 100, receipt: { chat_file: gp.id, name: 'x', kind: 'pdf' } } });
  assert.equal((await call('E3', { action: 'wr_receipt_url', id: r2.id })).status, 404, 'a written id that was not attached does not open');
});

test('the storage helper talks to Supabase Storage the way it expects (synthetic answers)', async () => {
  const seen = [];
  const T = '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222';
  const fetch = async (url, init = {}) => {
    seen.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (url.includes('/object/upload/sign/')) return new Response(JSON.stringify({ url: '/object/upload/sign/chat-files/' + T + '?token=abc' }), { status: 200 });
    if (url.endsWith('/object/sign/chat-files')) return new Response(JSON.stringify([{ path: T, signedURL: '/object/sign/chat-files/' + T + '?token=dl', error: null }, { path: 'x', error: 'Not found' }]), { status: 200 });
    if (url.includes('/object/authenticated/') && url.endsWith('.t')) return new Response('', { status: 400 });
    if (url.includes('/object/authenticated/')) return new Response(B.pdf().slice(0, 16), { status: 206, headers: { 'content-range': 'bytes 0-15/12345' } });
    if (init.method === 'DELETE') return new Response('[]', { status: 200 });
    return new Response('no', { status: 500 });
  };
  const st = storageApi({ fetch, url: 'https://db.test', key: 'service' });
  const up = await st.signUpload(T);
  assert.equal(up.url, 'https://db.test/storage/v1/object/upload/sign/chat-files/' + T + '?token=abc'); assert.equal(up.token, 'abc');
  assert.equal(seen[0].headers.authorization, 'Bearer service');
  const dl = await st.signDownload([T], { download: '請求書.pdf' });
  assert.equal(dl[T], 'https://db.test/storage/v1/object/sign/chat-files/' + T + '?token=dl&download=' + encodeURIComponent('請求書.pdf'));
  assert.equal(JSON.parse(seen[1].body).expiresIn, 300);
  const h = await st.head(T);
  assert.equal(h.size, 12345); assert.equal(h.bytes[0], 0x25); assert.equal(seen[2].headers.range, 'bytes=0-15');
  assert.equal(await st.head(T + '.t'), null, 'missing');
  await st.remove([T, T + '.t']);
  assert.deepEqual(JSON.parse(seen.at(-1).body), { prefixes: [T, T + '.t'] });
  await assert.rejects(st.signUpload('../etc/passwd'), /bad_path/, 'only our own place names');
  const bad = storageApi({ fetch: async () => new Response('down', { status: 503 }), url: 'https://db.test', key: 'k' });
  await assert.rejects(bad.signUpload(T), /^Error: storage sign_upload 503/);
});

test('the content check (sniff) per kind', () => {
  assert.ok(sniffOk('jpg', B.jpg(10))); assert.ok(!sniffOk('jpg', B.png()));
  assert.ok(sniffOk('pdf', B.pdf())); assert.ok(!sniffOk('pdf', B.zip()));
  for (const e of ['xlsx', 'docx', 'pptx']) { assert.ok(sniffOk(e, B.zip()), e); assert.ok(!sniffOk(e, B.ole()), e); }
  for (const e of ['xls', 'doc', 'ppt']) { assert.ok(sniffOk(e, B.ole()), e); assert.ok(!sniffOk(e, B.zip()), e); }
  for (const e of ['csv', 'txt']) { assert.ok(sniffOk(e, B.txt()), e); assert.ok(!sniffOk(e, B.pdf()), e); assert.ok(!sniffOk(e, Uint8Array.from([0x4d, 0x5a, 1])), e); }
  assert.ok(!sniffOk('pdf', new Uint8Array(0))); assert.ok(!sniffOk('exe', B.zip()));
});
