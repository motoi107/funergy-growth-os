// db/approvals-inventory-check.sql（読むだけ）が、前の「承認」タブの申請を種類 × 状態で数え、
// 承認ルートの設定（保存していれば・包んだ形でも）を出し、名前・タイトル・金額を出さないか（合成データ・PGlite）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SQL = fs.readFileSync(new URL('../db/approvals-inventory-check.sql', import.meta.url), 'utf8');
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');

const items = [
  { id: 'a1', type: '予算', status: 'pending', date: '2026/11/01', title: 'F01 2026-12 予算', from: 'Aki Sample', amount: 1000 },
  { id: 'a2', type: '予算', status: 'approved', date: '2026/10/02', title: 'F02 2026-11 予算', from: 'Ben Sample', signoffs: [{ role: 'gm' }] },
  { id: 'a3', type: '休暇', status: 'approved', date: '2026/10/20', title: '休暇 Cara Sample', acct: { by: 'X', at: 1 } },
  { id: 'a4', type: '休暇', status: 'approved', date: '2026/10/21', acct: { off: 'true' } },
  { id: 'a5', type: '', status: 'rejected', date: '2026/09/30' },
  'not an object',
];

test('種類 × 状態の数・経理の確認・承認の印・日付の幅・名前は出さない', async () => {
  assert.doesNotMatch(SQL.replace(/--.*$/gm, ''), /\b(insert|update|delete|alter|drop|create|truncate|grant)\b/i, 'read only');
  const pg = new PGlite();
  await pg.exec(`create table public.app_state(key text primary key, value jsonb not null, updated_at timestamptz default now());`);
  await pg.query('insert into public.app_state(key, value) values ($1, $2)', ['approvals', JSON.stringify(items)]);
  const rows = (await pg.query(SQL)).rows;
  const ap = rows.filter(r => r.part === '1 申請');
  const pick = (t, s) => ap.find(r => r.type === t && r.status === s);
  assert.equal(pick('予算', 'pending').n, '1');
  assert.equal(pick('予算', 'approved').with_signoffs, '1');
  assert.equal(pick('休暇', 'approved').n, '2');
  assert.equal(pick('休暇', 'approved').acct_checked, '1', 'acct with off:true is not counted as checked');
  assert.equal(pick('休暇', 'approved').oldest, '2026/10/20');
  assert.equal(pick('休暇', 'approved').newest, '2026/10/21');
  assert.ok(pick('(種類なし)', 'rejected'));
  const text = JSON.stringify(rows);
  for (const leak of ['Aki Sample', 'Ben Sample', 'Cara Sample', '1000', 'F01 2026-12']) assert.ok(!text.includes(leak), 'no ' + leak);
  const rt = rows.filter(r => r.part === '2 承認ルートの設定');
  assert.deepEqual(rt.map(r => r.type), ['(保存なし＝初期値)']);
});

test('承認ルートの設定：保存した形・包んだ形・申請の行が包んだ形・行が無い', async () => {
  const pg = new PGlite();
  await pg.exec(`create table public.app_state(key text primary key, value jsonb not null, updated_at timestamptz default now());`);
  await pg.query('insert into public.app_state(key, value) values ($1, $2)', ['approval_routing', JSON.stringify({ __st: 1, v: { '予算': ['gm'], '休暇': ['am', 'gm'], '採用': [] } })]);
  await pg.query('insert into public.app_state(key, value) values ($1, $2)', ['approvals', JSON.stringify({ __st: 1, v: [{ type: '退職', status: 'pending' }] })]);
  const rows = (await pg.query(SQL)).rows;
  const rt = rows.filter(r => r.part === '2 承認ルートの設定');
  const by = t => rt.find(r => r.type === t)?.status;
  assert.equal(by('予算'), 'gm');
  assert.equal(by('休暇'), 'am・gm');
  assert.equal(by('採用'), '(なし)');
  assert.ok(!rt.some(r => r.type === '(保存なし＝初期値)'));
  assert.equal(rows.find(r => r.part === '1 申請' && r.type === '退職').n, '1');

  const empty = new PGlite();
  await empty.exec(`create table public.app_state(key text primary key, value jsonb not null, updated_at timestamptz default now());`);
  const none = (await empty.query(SQL)).rows;
  assert.deepEqual(none.map(r => r.part), ['2 承認ルートの設定']);
});
