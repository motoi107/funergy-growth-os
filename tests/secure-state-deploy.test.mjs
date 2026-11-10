// 入れる一式（deploy/secure-state-v1139・secure-cs-v1140・secure-settings-v1141・secure-hr-v1142・secure-settings-v1143・secure-pii-v1144・secure-grade-hist-v1145・secure-tip-prep-v1146）が、リポジトリの元のファイルと 1 文字も違わないこと。
// 貼る中身が古くならないように（関数・SQL を直したら、一式も作り直す）。
// 前の版の関数の 1 ファイルは、入れたときのまま（次の版の関数を戻すときに貼る）。中身の sha256 で固定する。
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
  assert.equal(sha(D + '2_関数_secure-state_index.ts'), 'a55638d5c41fe094d7d27f9585e091a25362c642a89d3567fd06e974f61df472', 'the v1141 function file (PR #135 90a832e) is not changed');
  const one = rd(D + '2_関数_secure-state_index.ts');
  assert.match(one, TAIL);
  assert.ok(/swfn: 1/.test(one) && !/hrfn/.test(one), 'the v1141 function knows the guarded settings, not hiring');
  const how = rd(D + '手順.md');
  for (const f of ['1_確かめ_読むだけ.sql', '2_関数_secure-state_index.ts', '3_SQL_公開の鍵で書けなくする.sql', '4_確かめ_読むだけ.sql', '戻す_SQL.sql', 'deploy/secure-cs-v1140/2_関数_secure-state_index.ts']) assert.ok(how.includes(f), '手順.md names ' + f);
});

test('the v1142 bundle is as it was (the SQL files and the pinned function file)', () => {
  const D = 'deploy/secure-hr-v1142/';
  assert.equal(rd(D + '1_確かめ_読むだけ.sql'), rd('db/secure-hr-precheck.sql'));
  assert.equal(rd(D + '3_SQL_公開の鍵から外す.sql'), rd('supabase/migrations/20261111090000_secure_hr_rls.sql'));
  assert.equal(rd(D + '4_確かめ_読むだけ.sql'), rd('db/secure-hr-postcheck.sql'));
  assert.equal(rd(D + '戻す_SQL.sql'), rd('db/secure-hr-rls-rollback.sql'));
  assert.equal(sha(D + '2_関数_secure-state_index.ts'), 'fe6f5ae4b699a52a36fe21a99a1b2f349654fdd7e9ad190381a6404c78a324aa', 'the v1142 function file (PR #136 76af7fd) is not changed');
  const one = rd(D + '2_関数_secure-state_index.ts');
  assert.match(one, TAIL);
  assert.ok(/hrfn: 1/.test(one) && !/sw2: 1/.test(one), 'the v1142 function knows hiring, not the v1143 settings');
  const how = rd(D + '手順.md');
  for (const f of ['1_確かめ_読むだけ.sql', '2_関数_secure-state_index.ts', '3_SQL_公開の鍵から外す.sql', '4_確かめ_読むだけ.sql', '戻す_SQL.sql', 'deploy/secure-settings-v1141/2_関数_secure-state_index.ts']) assert.ok(how.includes(f), '手順.md names ' + f);
});

test('the v1143 bundle is as it was (the SQL files and the pinned function file)', () => {
  const D = 'deploy/secure-settings-v1143/';
  assert.equal(rd(D + '1_確かめ_読むだけ.sql'), rd('db/secure-settings-more-precheck.sql'));
  assert.equal(rd(D + '3_SQL_公開の鍵で書けなくする.sql'), rd('supabase/migrations/20261112090000_secure_settings_more.sql'));
  assert.equal(rd(D + '4_確かめ_読むだけ.sql'), rd('db/secure-settings-more-postcheck.sql'));
  assert.equal(rd(D + '戻す_SQL.sql'), rd('db/secure-settings-more-rollback.sql'));
  assert.equal(sha(D + '2_関数_secure-state_index.ts'), '848cdfba5b7213ed92950852b71cf158e2a7716a983072f27a0702637fc1a771', 'the v1143 function file (PR #137 eb75e66) is not changed');
  const one = rd(D + '2_関数_secure-state_index.ts');
  assert.match(one, TAIL);
  assert.ok(/sw2: 1/.test(one) && /hrfn: 1/.test(one) && !/piifn/.test(one), 'the v1143 function knows the v1143 settings, not the personal fields');
  const how = rd(D + '手順.md');
  for (const f of ['1_確かめ_読むだけ.sql', '2_関数_secure-state_index.ts', '3_SQL_公開の鍵で書けなくする.sql', '4_確かめ_読むだけ.sql', '戻す_SQL.sql', 'deploy/secure-hr-v1142/2_関数_secure-state_index.ts', 'deploy/secure-settings-v1141/手順.md']) assert.ok(how.includes(f), '手順.md names ' + f);
});

test('the v1144 bundle is as it was (the SQL files and the pinned function file)', () => {
  const D = 'deploy/secure-pii-v1144/';
  assert.equal(rd(D + '1_確かめ_読むだけ.sql'), rd('db/secure-pii-precheck.sql'));
  assert.equal(rd(D + '1b_SQL_権限の写しにHeadChef.sql'), rd('supabase/migrations/20261113080000_wr_people_chef.sql'));   // Codex #138 P1-1
  assert.equal(rd(D + '3_SQL_個人の欄を移して外す.sql'), rd('supabase/migrations/20261113090000_secure_emp_pii.sql'));
  assert.equal(rd(D + '4_確かめ_読むだけ.sql'), rd('db/secure-pii-postcheck.sql'));
  assert.equal(rd(D + '戻す_SQL.sql'), rd('db/secure-pii-rollback.sql'));
  // v1145 から関数は先へ進んだので、v1144 の 1 ファイルは PR #138（0ea3ae6）のまま固定（v1145 を戻すときに使う）
  assert.equal(sha(D + '2_関数_secure-state_index.ts'), '8668ca3e8526d2ed619442004fa58865c9de2b600945252801f165459126d498', 'the v1144 function file (PR #138 0ea3ae6) is not changed');
  const one = rd(D + '2_関数_secure-state_index.ts');
  assert.match(one, TAIL);
  assert.ok(!/verifyPin/.test(one), 'no private part');
  assert.match(one, /piifn: 1/); assert.match(one, /sw2: 1/); assert.match(one, /hrfn: 1/);
  assert.ok(!/ghfn/.test(one), 'the v1144 function does not know the grade history');
  const how = rd(D + '手順.md');
  assert.match(one, /async function confChef\(a\)/, 'Head Chef also needs the confirmed copy (Codex #138 P1-1)');
  for (const f of ['1_確かめ_読むだけ.sql', '1b_SQL_権限の写しにHeadChef.sql', '2_関数_secure-state_index.ts', '3_SQL_個人の欄を移して外す.sql', '4_確かめ_読むだけ.sql', '戻す_SQL.sql', 'deploy/secure-settings-v1143/2_関数_secure-state_index.ts', 'deploy/secure-settings-v1143/手順.md']) assert.ok(how.includes(f), '手順.md names ' + f);
});

test('the v1145 bundle is as it was (the SQL files and the pinned function file)', () => {
  const D = 'deploy/secure-grade-hist-v1145/';
  assert.equal(rd(D + '1_確かめ_読むだけ.sql'), rd('db/secure-grade-hist-precheck.sql'));
  assert.equal(rd(D + '3_SQL_公開の鍵で書けなくする.sql'), rd('supabase/migrations/20261114090000_secure_grade_hist.sql'));
  assert.equal(rd(D + '4_確かめ_読むだけ.sql'), rd('db/secure-grade-hist-postcheck.sql'));
  assert.equal(rd(D + '戻す_SQL.sql'), rd('db/secure-grade-hist-rollback.sql'));
  // v1146 から関数は先へ進んだので、v1145 の 1 ファイルは PR #139（bd68040）のまま固定（v1146 を戻すときに使う）
  assert.equal(sha(D + '2_関数_secure-state_index.ts'), '6081ec5c975a3a1cc923e67b2b97441e73be4c588e7c61452d455e39eb26fe17', 'the v1145 function file (PR #139 bd68040) is not changed');
  const one = rd(D + '2_関数_secure-state_index.ts');
  assert.match(one, TAIL);
  assert.ok(!/verifyPin/.test(one), 'no private part');
  assert.match(one, /ghfn: 1/); assert.match(one, /piifn: 1/); assert.match(one, /sw2: 1/); assert.match(one, /hrfn: 1/);
  assert.ok(!/tpfn/.test(one), 'the v1145 function does not know Tip Rate and prep');
  assert.match(one, /export const GH_KEYS = \['grade_hist'\];/);
  assert.match(one, /async function confChef\(a\)/, 'keeps the v1144 Head Chef check');
  const how = rd(D + '手順.md');
  for (const f of ['1_確かめ_読むだけ.sql', '2_関数_secure-state_index.ts', '3_SQL_公開の鍵で書けなくする.sql', '4_確かめ_読むだけ.sql', '戻す_SQL.sql', 'deploy/secure-pii-v1144/2_関数_secure-state_index.ts', 'deploy/secure-pii-v1144/手順.md']) assert.ok(how.includes(f), '手順.md names ' + f);
});

test('the v1146 bundle is the repository files as they are', () => {
  const D = 'deploy/secure-tip-prep-v1146/';
  assert.equal(rd(D + '1_確かめ_読むだけ.sql'), rd('db/secure-tip-prep-precheck.sql'));
  assert.equal(rd(D + '3_SQL_公開の鍵で書けなくする.sql'), rd('supabase/migrations/20261115090000_secure_tip_prep.sql'));
  assert.equal(rd(D + '4_確かめ_読むだけ.sql'), rd('db/secure-tip-prep-postcheck.sql'));
  assert.equal(rd(D + '戻す_SQL.sql'), rd('db/secure-tip-prep-rollback.sql'));
  const one = rd(D + '2_関数_secure-state_index.ts');
  const handler = rd('supabase/functions/secure-state/handler.mjs');
  assert.ok(one.startsWith(handler), 'the one file starts with the handler as it is');
  const tail = one.slice(handler.length);
  assert.match(tail, TAIL);
  assert.ok(!/import /.test(tail) && !/verifyPin/.test(one), 'no private part, no imports');
  assert.match(one, /tpfn: 1/); assert.match(one, /ghfn: 1/); assert.match(one, /piifn: 1/); assert.match(one, /sw2: 1/); assert.match(one, /hrfn: 1/);
  assert.match(one, /export const TP_KEYS = \['prep_tables', 'prep_certs', 'tip_requests'\];/);
  assert.match(one, /async function tipDecider\(a\)/);
  assert.match(one, /async function confChef\(a\)/, 'keeps the v1144 Head Chef check');
  assert.match(rd('supabase/functions/secure-state/index.ts'), /Deno\.serve\(createHandler\(\{ env: \(key: string\) => Deno\.env\.get\(key\) \}\)\);/);
  const how = rd(D + '手順.md');
  for (const f of ['1_確かめ_読むだけ.sql', '2_関数_secure-state_index.ts', '3_SQL_公開の鍵で書けなくする.sql', '4_確かめ_読むだけ.sql', '戻す_SQL.sql', 'deploy/secure-grade-hist-v1145/2_関数_secure-state_index.ts', 'deploy/secure-grade-hist-v1145/手順.md']) assert.ok(how.includes(f), '手順.md names ' + f);
});
