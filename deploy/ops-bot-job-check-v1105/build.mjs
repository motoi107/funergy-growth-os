// v1105：ops-bot を 1 ファイルにまとめる（Supabase の画面の Edge Functions → ops-bot に貼る用）。
// node deploy/ops-bot-job-check-v1105/build.mjs [esbuild のパス]
//   1_関数_ops-bot_index.ts … 今のソース（Job確認あり）
//   戻す_関数_ops-bot_index.ts … main（a1348be＝本番 v1103 のときの ops-bot）のソース
//   source.json … まとめた元のファイルと、まとめたものの sha256（tests/ops-bot-deploy-v1105.test.mjs が見張る）
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const here = path.join(root, 'deploy/ops-bot-job-check-v1105');
const esbuild = process.argv[2] || '/opt/npm-tools/node_modules/.bin/esbuild';
export const SOURCES = ['supabase/functions/ops-bot/index.ts', 'supabase/functions/ops-bot/handler.mjs', 'bot/case-replies.mjs', 'bot/clock-detector.mjs',
  'bot/cash-tip-report.mjs', 'bot/payment-details.mjs', 'bot/job-check.mjs'];
export const ROLLBACK_COMMIT = 'a1348be';
const ARGS = ['--bundle', '--format=esm', '--platform=neutral', '--target=es2022', '--log-level=warning'];
const sha = b => createHash('sha256').update(b).digest('hex');

function bundle(dir, out) {
  execFileSync(esbuild, [path.join(dir, 'supabase/functions/ops-bot/index.ts'), ...ARGS, '--outfile=' + out], { stdio: 'inherit' });
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  bundle(root, path.join(here, '1_関数_ops-bot_index.ts'));
  // 戻す方：main のときのソースを一時フォルダに出してまとめる
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opsbot-rollback-'));
  const files = execFileSync('git', ['-C', root, 'ls-tree', '-r', '--name-only', ROLLBACK_COMMIT, 'supabase/functions/ops-bot', 'bot'], { encoding: 'utf8' }).trim().split('\n');
  for (const f of files) {
    fs.mkdirSync(path.join(tmp, path.dirname(f)), { recursive: true });
    fs.writeFileSync(path.join(tmp, f), execFileSync('git', ['-C', root, 'show', ROLLBACK_COMMIT + ':' + f]));
  }
  bundle(tmp, path.join(here, '戻す_関数_ops-bot_index.ts'));
  fs.rmSync(tmp, { recursive: true, force: true });
  const version = execFileSync(esbuild, ['--version'], { encoding: 'utf8' }).trim();
  const json = {
    note: '1_関数 は下の sources を esbuild ' + version + ' で 1 つにまとめたもの（' + ARGS.slice(0, 4).join(' ') + '）。どれかを直したら node deploy/ops-bot-job-check-v1105/build.mjs で作り直す（tests/ops-bot-deploy-v1105.test.mjs が見張る）。戻す_関数 は ' + ROLLBACK_COMMIT + '（main・本番 v1103 のとき）の ops-bot。',
    esbuild: version,
    bundle_sha256: sha(fs.readFileSync(path.join(here, '1_関数_ops-bot_index.ts'))),
    rollback_commit: ROLLBACK_COMMIT,
    rollback_sha256: sha(fs.readFileSync(path.join(here, '戻す_関数_ops-bot_index.ts'))),
    sources: Object.fromEntries(SOURCES.map(f => [f, sha(fs.readFileSync(path.join(root, f)))]))
  };
  fs.writeFileSync(path.join(here, 'source.json'), JSON.stringify(json, null, 1) + '\n');
  console.log(JSON.stringify({ bundle: json.bundle_sha256.slice(0, 12), rollback: json.rollback_sha256.slice(0, 12) }));
}
