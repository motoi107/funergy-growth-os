// まとめて入れる手順（deploy/all-v1141-v1152/手順.md の A）では、アプリが 1140 のまま v1152 の関数を入れる（A-5）。
// その組み合わせを、v1140 のアプリの試験そのもの（main 2d83214 の secure-state-client・secure-cs-client。アプリは main の index.html）で
// v1152 の関数に対して流す（Codex #146 6849760483：「A で関数を入れ替える以上、旧 1140 端末との互換確認が別に要る」）。
// 変えるのは試験の土台の 2 つだけ：A-4 で GM・CEO が確かめた写し（wr_people）と、確かめた印（whoami の confirmed）。
// 確かめていない G2・G3 は、v1147 から自分の分だけになる（手順の A-4 に書いた変わること。下の 2 つ目の試験）。
// main 2d83214 が無い（浅い clone）ときは理由を出して飛ばす（CI は取ってくる）。合成データだけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = '2d832147717459643d233a661a85bbcaa68ab2b4';   // main（v1140・#135 の前）
const has = (() => { try { execFileSync('git', ['cat-file', '-e', BASE + '^{commit}'], { cwd: ROOT, stdio: 'ignore' }); return true; } catch { return false; } })();
const show = p => execFileSync('git', ['show', BASE + ':' + p], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

function build(patchCs) {
  const dir = mkdtempSync(join(tmpdir(), 'compat1140-'));
  for (const d of ['tests/lib', 'deploy/secure-state-v1139', 'supabase/functions']) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, 'index.html'), show('index.html'));                                   // v1140 のアプリ
  writeFileSync(join(dir, 'tests/secure-state-client.test.mjs'), show('tests/secure-state-client.test.mjs'));
  writeFileSync(join(dir, 'tests/secure-cs-client.test.mjs'), patchCs(show('tests/secure-cs-client.test.mjs')));
  writeFileSync(join(dir, 'deploy/secure-state-v1139/2_関数_secure-state_index.ts'), show('deploy/secure-state-v1139/2_関数_secure-state_index.ts'));
  cpSync(join(ROOT, 'tests/lib/secure-state-world.mjs'), join(dir, 'tests/lib/secure-state-world.mjs'));   // 今のサーバーの作り（v1152 の関数が読む表も）
  cpSync(join(ROOT, 'supabase/functions/secure-state'), join(dir, 'supabase/functions/secure-state'), { recursive: true });   // v1152 の関数
  if (existsSync(join(ROOT, 'tests/runtime'))) symlinkSync(join(ROOT, 'tests/runtime'), join(dir, 'tests/runtime'));
  return dir;
}
// 子の node --test が「試験の中の試験」とみなされないように（NODE_TEST_CONTEXT を渡さない）
const childEnv = () => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; };
function run(dir) {
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'tests/secure-state-client.test.mjs', 'tests/secure-cs-client.test.mjs'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: childEnv() });
  const out = (r.stdout || '') + (r.stderr || '');
  const n = k => Number((out.match(new RegExp('^# ' + k + ' (\\d+)$', 'm')) || [])[1]);
  return { code: r.status, pass: n('pass'), fail: n('fail'), failed: [...out.matchAll(/^not ok \d+ - (.*)$/gm)].map(m => m[1]), out };
}
const once = (s, a, b) => { assert.equal(s.split(a).length - 1, 1, 'the v1140 test has exactly one ' + a); return s.replace(a, b); };
const confirmed = s => {
  s = once(s, "makeWorld({ pins: ME, emps: EMPS.map(e => ({ ...e })), mgr:", "makeWorld({ pins: ME, emps: EMPS.map(e => ({ ...e })), wrPeople: [{ emp_id: 'E-3', role: 'staff', grade: 3, stores: ['S1'] }, { emp_id: 'E-2', role: 'staff', grade: 2, stores: ['S1'] }], mgr:");
  s = once(s, "name: 'Sam Three' }", "name: 'Sam Three', confirmed: true }");
  s = once(s, "name: 'Cora Two' }", "name: 'Cora Two', confirmed: true }");
  return s;
};

test('the v1140 app (main 2d83214) with the v1152 function: all the v1140 app\'s own secure-state and Career Score tests pass once GM・CEO have confirmed the G2・G3 (step A-4)', { skip: has ? false : 'main ' + BASE.slice(0, 7) + ' is not in this clone (fetch it to run this)', timeout: 600000 }, () => {
  const dir = build(confirmed);
  try {
    const r = run(dir);
    assert.equal(r.fail, 0, 'failed: ' + r.failed.join(' / ') + '\n' + r.out.slice(-3000));
    assert.ok(r.pass >= 40, 'the v1140 tests ran (' + r.pass + ')');
    assert.equal(r.code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the v1140 app with the v1152 function, before A-4: the not-yet-confirmed G2・G3 see only their own Career Score (the change written in step A-4); GM・CEO and the staff are as before', { skip: has ? false : 'main ' + BASE.slice(0, 7) + ' is not in this clone (fetch it to run this)', timeout: 600000 }, () => {
  const dir = build(s => s);
  try {
    const r = run(dir);
    assert.ok(r.failed.length > 0, 'the v1140 tests expect a G3 to see the store');
    // 落ちるのは G3・G2 が店の人を見る・書く試験だけ（GM・スタッフ・v1139 の成長カルテ・賞与の試験は通る）
    for (const t of r.failed) assert.match(t, /G3|scope|OJT|history|combined|function goes back/i, 'only the store-scope tests change: ' + t);
    assert.ok(r.pass >= 35, 'the rest still pass (' + r.pass + ')');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
