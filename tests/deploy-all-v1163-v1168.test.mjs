// まとめての手順（deploy/all-v1163-v1168/）：表の 01〜19 のファイルがあり、本番と同じ形の合成 DB（PGlite）に上から順に流すと
// ① に STOP・② にエラー・③ に NG が出ない。上から全部をもう一度流しても最後の状態は同じ（10 の 5 だけが「段が 7」で NG）。
// ただし途中（03 のあと 18 まで）はキーの守りが外れる（#164 の Codex 6888011035）ので、手順は 18 のあとの 03・15 の流し直しを止める。
// 関数は v1168 の 1 ファイルだけ・Secrets の名前・マージの順・鍵が無いこと。合成データだけ（本番にはつながない）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const M = f => rd('supabase/migrations/' + f + '.sql');
const H = rd('deploy/all-v1163-v1168/手順.md');
const ROWS = [...H.matchAll(/^\| (\d\d) \| `([^`]+)` \| `(deploy\/[^`]+)` \|/gm)].map(m => ({ n: m[1], zip: m[2], path: m[3] }));

test('the table names 01〜19 in order, each file exists, and the zip name carries the number and the file name', () => {
  assert.deepEqual(ROWS.map(r => r.n), Array.from({ length: 19 }, (_, i) => String(i + 1).padStart(2, '0')));
  for (const r of ROWS) {
    assert.ok(fs.existsSync(new URL('../' + r.path, import.meta.url)), r.path);
    assert.ok(r.zip.startsWith(r.n + '_'), r.zip);
    assert.ok(r.zip.endsWith('.sql') && r.path.endsWith('.sql'), r.zip);
  }
  // 順番：添付 → Google → 経費 → 申請/承認 → チャット改修 → チャットの守り（それぞれ ① ② ③）
  const dirs = ROWS.slice(1).map(r => r.path.split('/')[1]);
  assert.deepEqual([...new Set(dirs)], ['chat-files-v1161', 'google-reviews-v1157', 'expense-g2-v1164', 'wr-approve-v1165', 'chat-ui79-v1167', 'chat-guard-v1168']);
  for (let i = 1; i < 19; i += 3) assert.deepEqual(ROWS.slice(i, i + 3).map(r => r.path.split('/')[2][0]), ['1', '2', '3'], ROWS[i].path);
  assert.equal(ROWS[0].path, 'deploy/wr-approve-v1165/0_件数_読むだけ.sql');
});

test('the steps: only the v1168 function file, the three secrets, the merge order, no keys in the folder', () => {
  assert.match(H, /`work-requests_v1168_index\.ts`（非公開/);
  assert.match(H, /v1165・v1167 のファイルは貼らないでください/);
  assert.match(H, /Verify JWT は OFF/);
  for (const k of ['CHAT_VAPID_PUBLIC', 'CHAT_VAPID_PRIVATE', 'CHAT_VAPID_SUBJECT']) assert.match(H, new RegExp(k));
  assert.match(H, /#160 → #161 → #162 → #163 → #164/);
  assert.match(H, /自分の端末をすべて 1168 にしてから/);
  assert.match(H, /止まった番号から/);
  assert.match(H, /18 まで流したあとは、03（添付の SQL）・15（チャット改修の SQL）を流し直さないでください/);
  assert.match(H, /10 の 5 だけは「NG（段が 7）」/);
  const D = new URL('../deploy/all-v1163-v1168/', import.meta.url);
  assert.deepEqual(fs.readdirSync(D), ['手順.md'], 'only the steps: the SQL stays in each version folder, the private files never come here');
  assert.doesNotMatch(H, /pin-E\d|SUPABASE_SERVICE_ROLE_KEY=|eyJhbGci|CHAT_VAPID_PRIVATE\s*[=:]\s*\S{20,}|BEGIN PRIVATE KEY/);
});

// 本番と同じ形：申請の段階 3・チャット・Google の口コミ・添付まで入っている（v1163 の流し直しの前）
async function prod() {
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
    alter table storage.objects enable row level security;`);
  for (const f of ['20261104090000_work_requests', '20261105090000_work_requests_eval', '20261106090000_work_requests_apply_claim', '20261107090000_work_requests_ui68',
    '20261113080000_wr_people_chef', '20261116080000_wr_people_g2', '20261120090000_work_requests_stage2', '20261121090000_chat', '20261122090000_google_reviews',
    '20261123090000_work_requests_stage3', '20261124090000_chat_files']) await pg.exec(M(f));
  return pg;
}
const kind = p => /\/0_件数/.test(p) ? 'count' : /\/1_最初に確認/.test(p) ? 'pre' : /\/2_SQL/.test(p) ? 'sql' : 'post';
const lastRows = res => ((res.filter(r => r.fields && r.fields.length).pop()) || { rows: [] }).rows;
const bad = rows => rows.filter(r => !/^（参考）/.test(String(Object.values(r)[0] ?? ''))).filter(r => Object.values(r).some(v => /^(STOP|NG)/.test(String(v ?? ''))));

async function runAll(pg) {
  const out = [];
  for (const r of ROWS) {
    const k = kind(r.path);
    let rows = [], err = null;
    try { rows = lastRows(await pg.exec(rd(r.path))); } catch (e) { err = e.message; }
    out.push({ ...r, k, rows, err, bad: bad(rows) });
  }
  return out;
}

test('top to bottom once on a production-shaped database: no STOP in ①, every ② succeeds, no NG in ③; the counts after (24) are the same', async () => {
  const pg = await prod();
  const res = await runAll(pg);
  for (const x of res) {
    assert.equal(x.err, null, `${x.n} ${x.path}: ${x.err}`);
    if (x.k !== 'sql') assert.ok(x.rows.length > 0, `${x.n} returns rows`);
    assert.deepEqual(x.bad, [], `${x.n} ${x.path}: ${JSON.stringify(x.bad)}`);
  }
  // ① の「もう入っている」の数（手順の「見ること」）
  const val = (n, c) => (res.find(x => x.n === n).rows.find(r => r.check_name.startsWith(c)) || {}).result;
  assert.equal(val('02', '2.'), '1'); assert.equal(val('05', '1.'), '7');
  assert.equal(val('08', '2.'), '0'); assert.equal(val('11', '2.'), '0');
  assert.equal(val('14', '3.'), '0'); assert.equal(val('14', '4.'), '2'); assert.equal(val('17', '2.'), '3');
  // 24：01 をもう一度＝同じ件数（合成 DB では 0 件のまま）・4・5 が OK
  const after = lastRows(await pg.exec(rd(ROWS[0].path)));
  assert.deepEqual(after, res[0].rows);
  assert.ok(after.some(r => /^4 /.test(r.part) && /^OK/.test(r.note)) && after.some(r => /^5 /.test(r.part) && /^OK/.test(r.note)));
  // 最後の段：17 をもう一度流すと 2 は 4（守りまで入った）
  const pre17 = lastRows(await pg.exec(rd(ROWS[16].path)));
  assert.equal(pre17.find(r => r.check_name.startsWith('2.')).result, '4');
});

test('the final state after running everything again from the top is the same (only 10\'s check 5 says NG, stage 7; 13・16・19 end OK). This checks the end state only: between 03 and 18 the protection is off, so the steps forbid it', async () => {
  const pg = await prod();
  await runAll(pg);
  const res = await runAll(pg);
  for (const x of res) assert.equal(x.err, null, `${x.n}: ${x.err}`);
  const ng = res.filter(x => x.bad.length).map(x => [x.n, x.bad.map(r => Object.values(r)[0])]);
  assert.equal(ng.length, 1, JSON.stringify(ng));
  assert.equal(ng[0][0], '10'); assert.match(String(ng[0][1][0]), /^5\./);
  for (const n of ['13', '16', '19']) assert.deepEqual(res.find(x => x.n === n).bad, [], n);
});
