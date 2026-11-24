#!/usr/bin/env node
// Career Score 2026 Q4（段階 3-1）：関数 secure-state が使う計算の芯と評価表マスターを 1 つのファイルにする。
//   node scripts/gen-secure-state-csq4.mjs          … supabase/functions/secure-state/csq4.gen.mjs を作り直す
//   node scripts/gen-secure-state-csq4.mjs --check  … 作り直したものと今のファイルが 1 文字も違わないか（違えば 1 で終わる・CI）
// 中身：careerscore/q4-core.mjs をそのまま（export の語だけ外して）1 つの関数の中に入れ、名前の付いた 1 つの入れ物 CSQ4 で返す
//（secure-state の 1 ファイルの中で、ほかのファイルの一番外の名前と重ならないように）。マスターは careerscore/cs-q4-v1.json をそのまま。
// 計算を直すときは careerscore/q4-core.mjs を直して、これを流す（手で直さない）。依存なし（Node だけ）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CORE = 'careerscore/q4-core.mjs';
export const MASTER = 'careerscore/cs-q4-v1.json';
export const OUT = 'supabase/functions/secure-state/csq4.gen.mjs';

export function gen(root = ROOT) {
  const src = fs.readFileSync(path.join(root, CORE), 'utf8');
  if (/^\s*import\s/m.test(src)) throw new Error(CORE + ' imports something; this script does not join imports');
  const names = [];
  const body = src.replace(/^export (const|function|let) ([A-Za-z_$][\w$]*)/gm, (m, kw, name) => { names.push(name); return kw + ' ' + name; });
  if (/^export\s/m.test(body)) throw new Error(CORE + ' has an export this script does not handle');
  const master = JSON.parse(fs.readFileSync(path.join(root, MASTER), 'utf8'));
  if (master.version !== 'CAREER_2026_Q4_V1') throw new Error('unexpected master version: ' + master.version);
  return '// 自動で作ったファイル。手で直さない（' + CORE + ' か ' + MASTER + ' を直して `node scripts/gen-secure-state-csq4.mjs` を流す）。\n'
    + '// Career Score 2026 Q4（段階 3-1）：関数 secure-state が使う計算の芯（' + CORE + ' のまま）と評価表マスター（' + MASTER + ' のまま）。\n'
    + '/* eslint-disable */\n'
    + 'export const CSQ4 = (() => {\n' + body.replace(/\n*$/, '\n') + 'return { ' + names.join(', ') + ' };\n})();\n'
    + 'export const CSQ4_MASTER = ' + JSON.stringify(master) + ';\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = gen();
  const file = path.join(ROOT, OUT);
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (now !== out) { console.error(OUT + ' is out of date: run node scripts/gen-secure-state-csq4.mjs'); process.exit(1); }
    console.log(OUT + ' is up to date');
  } else {
    fs.writeFileSync(file, out);
    console.log('wrote ' + OUT + ' (' + out.length + ' chars)');
  }
}
