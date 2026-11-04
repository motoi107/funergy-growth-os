// v1139（2b-1）の入れる一式（deploy/secure-state-v1139）が、リポジトリの元のファイルと 1 文字も違わないこと。
// 貼る中身が古くならないように（関数・SQL を直したら、一式も作り直す）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const D = 'deploy/secure-state-v1139/';

test('the deploy bundle is the repository files as they are', () => {
  assert.equal(rd(D + '1_確かめ_読むだけ.sql'), rd('db/secure-state-precheck.sql'));
  assert.equal(rd(D + '3_SQL_公開の鍵から外す.sql'), rd('supabase/migrations/20261108090000_secure_state_rls.sql'));
  assert.equal(rd(D + '4_確かめ_読むだけ.sql'), rd('db/secure-state-postcheck.sql'));
  assert.equal(rd(D + '戻す_SQL.sql'), rd('db/secure-state-rls-rollback.sql'));
  const one = rd(D + '2_関数_secure-state_index.ts');
  const handler = rd('supabase/functions/secure-state/handler.mjs');
  assert.ok(one.startsWith(handler), 'the one file starts with the handler as it is');
  const tail = one.slice(handler.length);
  assert.match(tail, /Deno\.serve\(createHandler\(\{ env: \(key: string\) => Deno\.env\.get\(key\) \}\)\);\n$/);
  assert.ok(!/import /.test(tail) && !/verifyPin/.test(one), 'no private part, no imports');
  assert.match(rd('supabase/functions/secure-state/index.ts'), /Deno\.serve\(createHandler\(\{ env: \(key: string\) => Deno\.env\.get\(key\) \}\)\);/);
  assert.ok(fs.existsSync(new URL('../' + D + '手順.md', import.meta.url)));
});
