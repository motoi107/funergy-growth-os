// db/pl-public-check.sql（読むだけ）：会計 PL の共有の保存（pl_public）の月 × 店の入り具合。金額は出さない。合成データ・PGlite。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SQL = fs.readFileSync(new URL('../db/pl-public-check.sql', import.meta.url), 'utf8');
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');

const PUB = { _at: 1763240000000,
  '2025-10': { F01: { sales: 1, cogs: 1, payroll: 1 } },
  '2026-09': { F06: { sales: 20000.5, cogs: 6000, payroll: 9000, _at: 1763240000000 }, F01: { sales: 100000, cogs: 27000, payroll: 33000 } },
  '2026-10': { F06: { sales: 60000, cogs: 18000, payroll: 21000, prov: 1, _at: 1763240000000 }, 'F03+F03-G': { sales: 0, cogs: null } } };

async function run(value, wrap) {
  const pg = new PGlite();
  await pg.exec('create table public.app_settings(key text primary key, value jsonb, category text, updated_at timestamptz default now())');
  if (value !== undefined) await pg.query('insert into public.app_settings(key, value) values ($1, $2)', ['pl_public', JSON.stringify(wrap ? { __st: 1, v: value, _at: 1 } : value)]);
  await pg.query("insert into public.app_settings(key, value) values ('other', '{\"2026-10\":{\"F06\":{\"sales\":5}}}')");
  return (await pg.query(SQL)).rows;
}

test('読むだけ・金額を出さない', () => {
  assert.doesNotMatch(SQL, /\b(insert|update|delete|alter|drop|create|truncate|grant)\b/i);
  assert.doesNotMatch(SQL, /->>'sales'\s*(\|\||as|,)/, '売上の額をそのまま出さない');
});

test('月 × 店：あり・無い・暫定の印・保存した時刻（2026 年から）', async () => {
  for (const wrap of [false, true]) {
    const rows = await run(PUB, wrap);
    const a = rows.find(r => r.part === 'A 保存の行');
    assert.equal(a.sales, 'あり'); assert.equal(a.prov, '3 か月');
    const b = rows.filter(r => r.part === 'B 月 × 店');
    assert.deepEqual(b.map(r => r.ym + ' ' + r.store), ['2026-09 F01', '2026-09 F06', '2026-10 F03+F03-G', '2026-10 F06']);
    const lala10 = b.find(r => r.ym === '2026-10' && r.store === 'F06');
    assert.deepEqual([lala10.sales, lala10.cogs, lala10.payroll, lala10.prov], ['あり', 'あり', 'あり', '暫定']);
    assert.match(lala10.saved_at, /^2025-11-1[45] \d\d:\d\d HST$/);
    const lala9 = b.find(r => r.ym === '2026-09' && r.store === 'F06');
    assert.equal(lala9.prov, '確定');
    const w = b.find(r => r.store === 'F03+F03-G');
    assert.deepEqual([w.sales, w.cogs, w.payroll], ['無い', '無い', '無い']);
    for (const r of rows) for (const k of ['sales', 'cogs', 'payroll']) assert.doesNotMatch(String(r[k]), /\d/, '額が出ていない');
  }
});

test('保存の行が無い・形が違うときも止まらない', async () => {
  let rows = await run(undefined);
  assert.equal(rows.length, 1); assert.equal(rows[0].sales, '無い');
  rows = await run([1, 2]);
  assert.equal(rows.length, 1); assert.equal(rows[0].prov, '0 か月');
  rows = await run({ '2026-10': 'x', '2026-11': { F01: 'y' } });
  assert.equal(rows.filter(r => r.part === 'B 月 × 店').length, 0);
});
