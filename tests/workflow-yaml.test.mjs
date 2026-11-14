// CI の設定（.github/workflows/*.yml）が YAML として読めるか（#153 のレビュー P1：step の名前に「: 」があり、ワークフローが読めず CI が 1 つも走らなかった）。
// YAML の読み手を入れずに、よくある間違いだけを見る：引用符の無い 1 行の値に「: 」がある・タブで字下げしている（「 #」から後はコメントになるだけで読める）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const DIR = new URL('../.github/workflows/', import.meta.url);

test('workflow files: plain one-line values have no ": ", and no tabs (they would break the YAML and stop CI)', () => {
  const files = fs.readdirSync(DIR).filter(f => /\.ya?ml$/.test(f));
  assert.ok(files.length > 0);
  const bad = [];
  for (const f of files) {
    const lines = fs.readFileSync(new URL(f, DIR), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/^\t| \t/.test(line.replace(/\s+$/, '')) && /^\s*\t/.test(line)) bad.push(`${f}:${i + 1} tab indent`);
      const m = /^\s*(?:-\s+)?[A-Za-z0-9_.-]+:\s+(.+?)\s*$/.exec(line);
      if (!m) return;
      const v = m[1];
      if (/^["'|>[{&*!]/.test(v)) return;            // 引用符・ブロック・流れ・アンカーは見ない
      if (/: /.test(v) || /:$/.test(v)) bad.push(`${f}:${i + 1} ": " in a plain value`);
    });
  }
  assert.deepEqual(bad, []);
});

test('the check notices the #153 mistake', () => {
  const line = '      - name: Check v1159 work center step 3 (GM/CEO copy its records automatically: pending to work center pending)';
  const m = /^\s*(?:-\s+)?[A-Za-z0-9_.-]+:\s+(.+?)\s*$/.exec(line);
  assert.ok(m && /: /.test(m[1]));
});
