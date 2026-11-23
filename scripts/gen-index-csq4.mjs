#!/usr/bin/env node
// Career Score 2026 Q4（段階 3-2）：画面（index.html）が使う計算の芯と評価表マスターを、index.html の 1 つの <script> に入れる。
//   node scripts/gen-index-csq4.mjs          … index.html の印のあいだを作り直す
//   node scripts/gen-index-csq4.mjs --check  … 作り直したものと今の index.html が 1 文字も違わないか（違えば 1 で終わる・CI）
// 中身：careerscore/q4-core.mjs をそのまま（export の語だけ外して）1 つの関数の中に入れ、window.FUNERGY_CSQ4 で返す。
// マスターは careerscore/cs-q4-v1.json をそのまま window.FUNERGY_CSQ4_MASTER に。関数 secure-state と同じ芯・同じマスター
// （scripts/gen-secure-state-csq4.mjs が同じ 2 つのファイルから作る）＝画面の「入力途中」の点とサーバーの点が同じ計算になる。
// 画面の点は表示だけ。保存・確定の点はいつもサーバーが計算し直す（画面の値は信じない）。
// 計算を直すときは careerscore/q4-core.mjs を直して、これと gen-secure-state-csq4.mjs を流す（手で直さない）。依存なし（Node だけ）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CORE = 'careerscore/q4-core.mjs';
export const MASTER = 'careerscore/cs-q4-v1.json';
export const HTML = 'index.html';
export const BEGIN = '/* ==== FUNERGY_CSQ4 gen begin ==== */';
export const END = '/* ==== FUNERGY_CSQ4 gen end ==== */';

export function block(root = ROOT) {
  const src = fs.readFileSync(path.join(root, CORE), 'utf8');
  if (/^\s*import\s/m.test(src)) throw new Error(CORE + ' imports something; this script does not join imports');
  const names = [];
  const body = src.replace(/^export (const|function|let) ([A-Za-z_$][\w$]*)/gm, (m, kw, name) => { names.push(name); return kw + ' ' + name; });
  if (/^export\s/m.test(body)) throw new Error(CORE + ' has an export this script does not handle');
  if (/<\/script/i.test(body)) throw new Error(CORE + ' contains </script');
  const master = JSON.parse(fs.readFileSync(path.join(root, MASTER), 'utf8'));
  if (master.version !== 'CAREER_2026_Q4_V1') throw new Error('unexpected master version: ' + master.version);
  // JSON の中の「</」は <\/ に（<script> を途中で閉じないように）。値は変わらない。
  // 中身は 2 文字下げる（行の頭の function を index.html の上の段の関数と見まちがえないように。gradeNum など同じ名前がある）
  if (/`/.test(body)) throw new Error(CORE + ' has a template literal; indenting could change it');
  const json = JSON.stringify(master).replace(/<\//g, '<\\/');
  return BEGIN + '\n'
    + '// 自動で作った部分。手で直さない（' + CORE + ' か ' + MASTER + ' を直して `node scripts/gen-index-csq4.mjs` を流す）。\n'
    + 'window.FUNERGY_CSQ4 = (function(){\n' + body.replace(/\n*$/, '\n').replace(/^(?=.)/gm, '  ') + '  return { ' + names.join(', ') + ' };\n})();\n'
    + 'window.FUNERGY_CSQ4_MASTER = ' + json + ';\n'
    + END;
}

export function gen(root = ROOT) {
  const html = fs.readFileSync(path.join(root, HTML), 'utf8');
  const a = html.indexOf(BEGIN), b = html.indexOf(END);
  if (a < 0 || b < a || html.indexOf(BEGIN, a + 1) >= 0 || html.indexOf(END, b + 1) >= 0) throw new Error(HTML + ': the CSQ4 markers must appear once each, in order');
  return html.slice(0, a) + block(root) + html.slice(b + END.length);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = gen();
  const file = path.join(ROOT, HTML);
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(file, 'utf8') !== out) { console.error(HTML + ': the CSQ4 block is out of date: run node scripts/gen-index-csq4.mjs'); process.exit(1); }
    console.log(HTML + ': the CSQ4 block is up to date');
  } else {
    fs.writeFileSync(file, out);
    console.log('wrote the CSQ4 block in ' + HTML + ' (' + block().length + ' chars)');
  }
}
