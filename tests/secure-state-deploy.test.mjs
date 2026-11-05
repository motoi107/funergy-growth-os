// 入れる一式（deploy/secure-state-v1139・deploy/secure-cs-v1140・deploy/secure-settings-v1141）が、リポジトリの元のファイルと 1 文字も違わないこと。
// 貼る中身が古くならないように（関数・SQL を直したら、一式も作り直す）。
// v1139・v1140 の関数の 1 ファイルは、入れたときのまま（次の版の関数を戻すときに貼る）。中身の sha256 で固定する。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(new URL('../' + p, import.meta.url))).digest('hex');
const TAIL = /\n\/\/ ---- 起動（supabase\/functions\/secure-state\/index\.ts と同じ）\nDeno\.serve\(createHandler\(\{ env: \(key: string\) => Deno\.env\.get\(key\) \}\)\);\n$/;

test('the v1139 bundle is as it was when it went in (the SQL files and the pinned function file)', () => {
  const D = 'deploy/secure-state-v1139/';
  assert.equal(rd(D + '1_確かめ_読むだけ.sql'), rd('db/secure-state-precheck.sql'));
  assert.equal(rd(D + '3_SQL_公開の鍵から外す.sql'), rd('supabase/migrations/20261108090000_secure_state_rls.sql'));
  assert.equal(rd(D + '4_確かめ_読むだけ.sql'), rd('db/secure-state-postcheck.sql'));
  assert.equal(rd(D + '戻す_SQL.sql'), rd('db/secure-state-rls-rollback.sql'));
  assert.equal(sha(D + '2_関数_secure-state_index.ts'), '1fb2c049db2daf7d08cf7c9fcb7ecc100819574072d89059982df13eee291f7f', 'the v1139 function file (main 9bc7b48) is not changed');
  const one = rd(D + '2_関数_secure-state_index.ts');
  assert.match(one, TAIL);
  assert.ok(!/csfn|cs_have/.test(one), 'the v1139 function does not know Career Score');
  assert.ok(fs.existsSync(new URL('../' + D + '手順.md', import.meta.url)));
});

test('the v1140 bundle is as it was when it went in (the SQL files and the pinned function file)', () => {
  const D = 'deploy/secure-cs-v1140/';
  assert.equal(rd(D + '1_確かめ_読むだけ.sql'), rd('db/secure-cs-precheck.sql'));
  assert.equal(rd(D + '3_SQL_公開の鍵から外す.sql'), rd('supabase/migrations/20261109090000_secure_cs_rls.sql'));
  assert.equal(rd(D + '4_確かめ_読むだけ.sql'), rd('db/secure-cs-postcheck.sql'));
  assert.equal(rd(D + '戻す_SQL.sql'), rd('db/secure-cs-rls-rollback.sql'));
  assert.equal(sha(D + '2_関数_secure-state_index.ts'), '7d33eb53e4aff542e1481d3f6315181128cfb9d664bf789304ee4e3f294b52db', 'the v1140 function file (main 18a9547) is not changed');
  const one = rd(D + '2_関数_secure-state_index.ts');
  assert.match(one, TAIL);
  assert.ok(/csfn: 1/.test(one) && !/swfn/.test(one), 'the v1140 function knows Career Score, not the guarded settings');
  const how = rd(D + '手順.md');
  for (const f of ['1_確かめ_読むだけ.sql', '2_関数_secure-state_index.ts', '3_SQL_公開の鍵から外す.sql', '4_確かめ_読むだけ.sql', '戻す_SQL.sql', 'deploy/secure-state-v1139/2_関数_secure-state_index.ts']) assert.ok(how.includes(f), '手順.md names ' + f);
});

test('the v1141 bundle is as it was (the SQL files and the pinned function file)', () => {
  const D = 'deploy/secure-settings-v1141/';
  assert.equal(rd(D + '1_確かめ_読むだけ.sql'), rd('db/secure-settings-precheck.sql'));
  assert.equal(rd(D + '3_SQL_公開の鍵で書けなくする.sql'), rd('supabase/migrations/20261110090000_secure_settings_write.sql'));
  assert.equal(rd(D + '4_確かめ_読むだけ.sql'), rd('db/secure-settings-postcheck.sql'));
  assert.equal(rd(D + '戻す_SQL.sql'), rd('db/secure-settings-write-rollback.sql'));
  assert.equal(sha(D + '2_関数_secure-state_index.ts'), '1bab6c14bcc80c9358af3cafcca8ab3a48d1ce104a135cd5f11a9df4303cf865', 'the v1141 function file (PR #135) is not changed');
  const one = rd(D + '2_関数_secure-state_index.ts');
  assert.match(one, TAIL);
  assert.ok(/swfn: 1/.test(one) && !/hrfn/.test(one), 'the v1141 function knows the guarded settings, not hiring');
  const how = rd(D + '手順.md');
  for (const f of ['1_確かめ_読むだけ.sql', '2_関数_secure-state_index.ts', '3_SQL_公開の鍵で書けなくする.sql', '4_確かめ_読むだけ.sql', '戻す_SQL.sql', 'deploy/secure-cs-v1140/2_関数_secure-state_index.ts']) assert.ok(how.includes(f), '手順.md names ' + f);
});

test('the v1142 bundle is the repository files as they are', () => {
  const D = 'deploy/secure-hr-v1142/';
  assert.equal(rd(D + '1_確かめ_読むだけ.sql'), rd('db/secure-hr-precheck.sql'));
  assert.equal(rd(D + '3_SQL_公開の鍵から外す.sql'), rd('supabase/migrations/20261111090000_secure_hr_rls.sql'));
  assert.equal(rd(D + '4_確かめ_読むだけ.sql'), rd('db/secure-hr-postcheck.sql'));
  assert.equal(rd(D + '戻す_SQL.sql'), rd('db/secure-hr-rls-rollback.sql'));
  const one = rd(D + '2_関数_secure-state_index.ts');
  const handler = rd('supabase/functions/secure-state/handler.mjs');
  assert.ok(one.startsWith(handler), 'the one file starts with the handler as it is');
  const tail = one.slice(handler.length);
  assert.match(tail, TAIL);
  assert.ok(!/import /.test(tail) && !/verifyPin/.test(one), 'no private part, no imports');
  assert.match(one, /hrfn: 1/);
  assert.match(rd('supabase/functions/secure-state/index.ts'), /Deno\.serve\(createHandler\(\{ env: \(key: string\) => Deno\.env\.get\(key\) \}\)\);/);
  const how = rd(D + '手順.md');
  for (const f of ['1_確かめ_読むだけ.sql', '2_関数_secure-state_index.ts', '3_SQL_公開の鍵から外す.sql', '4_確かめ_読むだけ.sql', '戻す_SQL.sql', 'deploy/secure-settings-v1141/2_関数_secure-state_index.ts']) assert.ok(how.includes(f), '手順.md names ' + f);
});
