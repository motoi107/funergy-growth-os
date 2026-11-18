// secure-state を Supabase の編集画面に 1 回で貼れる 1 ファイルにする（v1192 から：handler.mjs が labor.mjs・labor-core.gen.mjs を読むため）。
//   node scripts/build-secure-state-one.mjs            → deploy/labor-totals-v1192/1_関数_secure-state_index.ts を書く
//   node scripts/build-secure-state-one.mjs --check    → 今のソースから作ったものとファイルが同じか（違えば 1 で終わる）
// つなぎ方：labor-core.gen.mjs → labor.mjs → handler.mjs の順に、相対の import の行だけを外して並べ、最後に起動の行（index.ts と同じ）。
// 3 つのファイルの一番外の名前が重なれば止める（重なると Deno で読めない）：起動の行を外したものを node --check で確かめる
// （同じ名前の宣言は読み込む前の SyntaxError になる）。中身は書き換えない（手で直さない）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = 'supabase/functions/secure-state/';
export const PARTS = ['labor-core.gen.mjs', 'labor.mjs', 'handler.mjs'];
export const OUT = 'deploy/labor-totals-v1192/1_関数_secure-state_index.ts';
export const TAIL = '\n// ---- 起動（supabase/functions/secure-state/index.ts と同じ）\nDeno.serve(createHandler({ env: (key: string) => Deno.env.get(key) }));\n';
const IMPORT_RE = /^import \{[^}]*\} from '\.\/[a-z0-9.-]+\.mjs';\n/gm;

export function build(root = ROOT) {
  const chunks = [];
  for (const f of PARTS) {
    const src = fs.readFileSync(path.join(root, DIR, f), 'utf8');
    const body = src.replace(IMPORT_RE, '');
    if (/^import\s/m.test(body)) throw new Error(f + ' has an import this script does not join');
    chunks.push('// ==== ' + DIR + f + ' ====\n' + body.replace(/\n*$/, '\n'));
  }
  const head = '// secure-state の 1 ファイル（v1192）：Supabase › Edge Functions › secure-state に、このファイルの中身をそのまま貼って Deploy（Verify JWT は OFF のまま）。\n'
    + '// 作り方：node scripts/build-secure-state-one.mjs（' + PARTS.map(p => DIR + p).join(' → ') + ' を import の行だけ外して並べる）。手で直さない。\n';
  const out = head + chunks.join('\n') + TAIL;
  syntaxCheck(out);
  return out;
}

// 起動の行（TypeScript の型が入る）を外した中身を、ES モジュールとして node --check で読む
export function withoutTail(one) {
  if (!one.endsWith(TAIL)) throw new Error('the start line is missing');
  return one.slice(0, -TAIL.length) + '\n';
}
export function syntaxCheck(one) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-one-'));
  const f = path.join(dir, 'secure-state-one.mjs');
  try {
    fs.writeFileSync(f, withoutTail(one));
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    throw new Error('the joined file does not parse (a top-level name used twice?): ' + String((e.stderr || e.message || '')).slice(0, 600));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = build();
  const file = path.join(ROOT, OUT);
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (now !== out) { console.error(OUT + ' is out of date: run node scripts/build-secure-state-one.mjs'); process.exit(1); }
    console.log(OUT + ' is up to date');
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, out);
    console.log('wrote ' + OUT + ' (' + out.length + ' chars)');
  }
}
