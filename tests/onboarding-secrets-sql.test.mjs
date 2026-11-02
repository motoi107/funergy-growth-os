// v1128：読むだけの SQL（db/onboarding-secrets-check.sql）を PGlite と合成データで。値は出さず数だけ・ほかのキーは数えない・何も書かない
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const CHECK = fs.readFileSync(new URL('../db/onboarding-secrets-check.sql', import.meta.url), 'utf8');

test('新しく入った人の記録に残っている機密の数（値は出さない）', async () => {
  const pg = new PGlite();
  await pg.exec('create table app_state(key text primary key, value jsonb, updated_at timestamptz);');
  const rows = [
    ['spl_onboardings_Ann', [{ id: 1, personal: { ssn: '000-00-0000' }, docs: [{ name: 'Passport', image: 'data:image/png;base64,AA' }] }]],
    ['spl_onboardings_Bob', [{ id: 2, personal: { ssn: '', pos: 'Crew' }, docs: [{ name: 'Passport' }] }]],
    ['onboardings', [{ id: 3, personal: { email: 'x@example.com' } }]],
    ['spl_offboardings_Ann', [{ id: 9, personal: { ssn: '1' } }]],
    ['spl_onboardings_Z', {}],
  ];
  for (const [k, v] of rows) await pg.query('insert into app_state values ($1, $2, now())', [k, JSON.stringify(v)]);
  const before = (await pg.query('select key, value::text from app_state order by key')).rows;
  const r = (await pg.query(CHECK)).rows;
  assert.deepEqual(r, [{ rows: 4, records: 3, with_secret: 2, with_doc_image: 1 }]);
  assert.deepEqual(Object.keys(r[0]).sort(), ['records', 'rows', 'with_doc_image', 'with_secret'], '数だけ（値の列は無い）');
  assert.deepEqual((await pg.query('select key, value::text from app_state order by key')).rows, before, '何も書かない');
});
