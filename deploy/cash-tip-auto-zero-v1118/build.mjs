// v1118：ops-bot を 1 ファイルにまとめる（Supabase の画面の Edge Functions → ops-bot に貼る用）。
// node deploy/cash-tip-auto-zero-v1118/build.mjs [esbuild のパス]
//   3_関数_ops-bot_index.ts … 今のソース（キャッシュチップの朝の知らせは不正な値だけ）
//   戻すときは deploy/ops-bot-job-check-v1105/1_関数_ops-bot_index.ts（v1105 の ops-bot）を貼る
//   source.json … まとめた元のファイルと、まとめたものの sha256（tests/cash-tip-auto-zero.test.mjs が見張る）
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const here = path.join(root, 'deploy/cash-tip-auto-zero-v1118');
const esbuild = process.argv[2] || '/opt/npm-tools/node_modules/.bin/esbuild';
export const SOURCES = ['supabase/functions/ops-bot/index.ts', 'supabase/functions/ops-bot/handler.mjs', 'bot/case-replies.mjs', 'bot/clock-detector.mjs',
  'bot/cash-tip-report.mjs', 'bot/payment-details.mjs', 'bot/job-check.mjs'];
export const BUNDLE_NAME = '3_関数_ops-bot_index.ts';
export const ROLLBACK_FILE = 'deploy/ops-bot-job-check-v1105/1_関数_ops-bot_index.ts';
const ARGS = ['--bundle', '--format=esm', '--platform=neutral', '--target=es2022', '--log-level=warning'];
const sha = b => createHash('sha256').update(b).digest('hex');

// どこから流しても同じ中身になるように、元のフォルダの中で流す（esbuild はファイルの場所を cwd からの名前でコメントに書く）
export function bundle(dir, out, bin = esbuild) {
  execFileSync(bin, ['supabase/functions/ops-bot/index.ts', ...ARGS, '--outfile=' + out], { stdio: 'inherit', cwd: dir });
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  bundle(root, path.join(here, BUNDLE_NAME));
  const version = execFileSync(esbuild, ['--version'], { encoding: 'utf8' }).trim();
  const json = {
    note: BUNDLE_NAME + ' は下の sources を esbuild ' + version + ' で 1 つにまとめたもの（' + ARGS.slice(0, 4).join(' ') + '）。どれかを直したら node deploy/cash-tip-auto-zero-v1118/build.mjs で作り直す（tests/cash-tip-auto-zero.test.mjs が見張る）。戻すときは ' + ROLLBACK_FILE + '。',
    esbuild: version,
    bundle_sha256: sha(fs.readFileSync(path.join(here, BUNDLE_NAME))),
    rollback_file: ROLLBACK_FILE,
    rollback_sha256: sha(fs.readFileSync(path.join(root, ROLLBACK_FILE))),
    sources: Object.fromEntries(SOURCES.map(f => [f, sha(fs.readFileSync(path.join(root, f)))]))
  };
  fs.writeFileSync(path.join(here, 'source.json'), JSON.stringify(json, null, 1) + '\n');
  console.log(JSON.stringify({ bundle: json.bundle_sha256.slice(0, 12), rollback: json.rollback_sha256.slice(0, 12) }));
}
