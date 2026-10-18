// db/ingredient-master-export*.sql (read only): the "owners" column (stores that have the item on their inventory sheet).
// Synthetic rows in PGlite only. Codex 10/17 (missing brackets let other rows in) and the independent review of 7002a69
// (the app saves each store's list as {__st:1, v:[codes]} since v750, which the SQL did not read; a null in a list matched every text code).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');

const FILES = ['../db/ingredient-master-export.sql', '../db/ingredient-master-export-current.sql'].map(f => new URL(f, import.meta.url));
const ROWS = [
  ['spl_store_ingredients_F01', [101, 102]],                                    // codes as numbers
  ['spl_store_ingredients_F02', ['A1', '103']],                                 // codes as text
  ['spl_store_ingredients_F05', { __st: 1, v: [101, 103], _at: 1, _by: 'x' }],  // what the app saves (_stWrap)
  ['spl_store_ingredients_F06', { F06: [102] }],                                // {store: [...]}
  ['spl_store_ingredients_F10', { __st: 1, v: { __st: 1, v: [999] } }],         // wrapped twice
  ['spl_store_ingredients_TOTOYA', [103]],
  ['spl_store_ingredients_F08', [7]],
  ['spl_store_ingredients_F07', [null, 5]],                                     // a null in the list matches nothing
  ['splXstoreXingredientsXF09', [101, 102, 103]],                               // looks alike (LIKE's "_" is any character)
  ['spl_store_ingredients', [101]],                                             // no store part
  ['store_ingredients', { F01: [101] }],
  ['unrelated_numbers_key_ZZZ', [101, 102, 103, 7, 999]],
  ['m_ingredients_v2', [{ id: 'v1', name: 'N', vendor: 'V', spec: { orderUnit: 'CS' }, stores: ['F06'], rawNames: ['RAW'] }]],
];
const WANT = { 101: 'F01 F05', 102: 'F01 F06', 103: 'F02 F05 TOTOYA', A1: 'F02', 7: 'F08', 999: 'F10', 555: null };

async function setup(codeType, valueType) {
  const db = new PGlite();
  await db.exec(`create table public.ingredients(code ${codeType} primary key, data jsonb);
    create table public.app_state(key text primary key, value ${valueType}, updated_at timestamptz default now());`);
  for (const c of Object.keys(WANT)) {
    if (codeType === 'integer' && !/^\d+$/.test(c)) continue;
    await db.query('insert into public.ingredients(code, data) values($1, $2)', [codeType === 'integer' ? Number(c) : c, { name: 'item ' + c }]);
  }
  for (const [k, v] of ROWS) await db.query('insert into public.app_state(key, value) values($1, $2)', [k, JSON.stringify(v)]);
  return db;
}

for (const [codeType, valueType] of [['text', 'jsonb'], ['text', 'json'], ['integer', 'jsonb']]) {
  test(`owners: only the stores' own rows, in every saved shape (code ${codeType}, value ${valueType})`, async () => {
    for (const f of FILES) {
      const db = await setup(codeType, valueType);
      const res = await db.exec('begin transaction read only;\n' + fs.readFileSync(f, 'utf8') + '\n;commit;');
      const sel = res.filter(r => r.fields && r.fields.length);
      const got = Object.fromEntries(sel[0].rows.map(r => [String(r.code), r.owners ?? null]));
      for (const [c, want] of Object.entries(WANT)) {
        if (codeType === 'integer' && !/^\d+$/.test(c)) continue;
        assert.equal(got[c], want, f.pathname.split('/').pop() + ' code ' + c);
      }
      if (/export\.sql$/.test(f.pathname)) assert.equal(sel[1].rows.length, 1, 'the second result (new master) still works');
      assert.equal((await db.query('select count(*)::int n from public.app_state')).rows[0].n, ROWS.length, 'nothing written');
      await db.close();
    }
  });
}

test('the files only read (no writing statements)', () => {
  for (const f of FILES) {
    const body = fs.readFileSync(f, 'utf8').split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
    assert.equal(body.match(/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|perform|lock)\b/gi), null, f.pathname);
  }
});
