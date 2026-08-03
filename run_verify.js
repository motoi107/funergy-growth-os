#!/usr/bin/env node
/* ============================================================
   run_verify.js — 検証と監査をまとめて実行する

   使い方：  node run_verify.js

   検証スクリプトが落ちたとき、毎回「製品が壊れたのか、ハーネスが古いのか」を
   手で切り分けていた。そのうち一番多いのが
   「前版の index_v76x_backup.html が zip に入っていない」という入力不足で、
   これは製品とは無関係。ここで自動的に分類する。

     PASS … 全項目 ✅
     FAIL … ❌ がある（製品かハーネスかは中身を見て判断する）
     SKIP … 前版ファイルが無くて実行できない（製品とは無関係）
     ERR  … それ以外の例外（ハーネスの不具合を疑う）

   最後にビルドの基本チェック（版数の一致・lone LF・構文）も行う。
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = __dirname;
const files = fs.readdirSync(DIR)
  .filter(f => /^verify_v\d+\.js$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

if (!files.length) { console.log('検証スクリプトが見つかりません'); process.exit(1); }

let totalPass = 0, totalFail = 0;
const rows = [], skipped = [], failed = [];

for (const f of files) {
  let out = '', crashed = false;
  try {
    out = execFileSync(process.execPath, [f], { cwd: DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    /* 検証スクリプトは最後に process.exit(fail?1:0) で終わる。
       ここへ来て ❌ が1件も無い場合は「途中で例外が出て残りが走らなかった」ことを意味する。
       これを PASS と表示していたため、抽出漏れで半分しか動いていない検証を見逃していた。 */
    crashed = true;
  }
  const pass = (out.match(/✅/g) || []).length;
  const fail = (out.match(/❌/g) || []).length;

  /* 前版ファイルが無いだけのケースを拾う */
  const miss = out.match(/ENOENT[^\n]*?(index_v\d+_backup\.html)/);
  let status;
  if (miss && pass === 0 && fail === 0) { status = 'SKIP'; skipped.push([f, miss[1]]); }
  else if (fail > 0) { status = 'FAIL'; failed.push(f); }
  else if (crashed) { status = 'ERR '; failed.push(f); }   /* 途中で落ちた（✅が出ていても信用しない） */
  else if (pass === 0) { status = 'ERR '; failed.push(f); }
  else { status = 'PASS'; }

  totalPass += pass; totalFail += fail;
  rows.push([status, f.replace('.js', ''), pass, fail, miss ? miss[1] : '']);
}

console.log('\n===== 検証スクリプト =====');
for (const [st, name, p, f, note] of rows) {
  const bar = st === 'PASS' ? '✅' : st === 'SKIP' ? '⏭ ' : '❌';
  console.log(`  ${bar} ${st}  ${name.padEnd(14)} PASS=${String(p).padStart(3)} FAIL=${String(f).padStart(2)}` +
    (note ? `   ← ${note} が無い` : ''));
}
console.log(`\n  合計 PASS=${totalPass}  FAIL=${totalFail}  実行=${rows.length - skipped.length}/${rows.length}`);

if (skipped.length) {
  console.log('\n  ⏭ スキップ（製品とは無関係。前版ファイルを zip に同梱すれば実行できる）');
  skipped.forEach(([f, need]) => console.log(`      ${f.replace('.js', '')} … ${need}`));
}
if (failed.length) {
  console.log('\n  ❌ 要確認（製品が壊れたのか、ハーネスが古いのかを切り分けること）');
  failed.forEach(f => console.log(`      ${f.replace('.js', '')}`));
}

/* ---------------- 監査 ---------------- */
console.log('\n===== 監査（基準値と比べる） =====');
function audit(file, re, expect, label) {
  try {
    const out = execFileSync(process.execPath, [file], { cwd: DIR, encoding: 'utf8' });
    const m = out.match(re);
    const got = m ? m.slice(1).join(' / ') : '(読めず)';
    const ok = got === expect;
    console.log(`  ${ok ? '✅' : '⚠️ '} ${label}: ${got}` + (ok ? '' : `   ← 基準は ${expect}`));
    return ok;
  } catch (e) { console.log(`  ❌ ${label}: 実行できず`); return false; }
}
const a1 = audit('audit_merge_coverage.js', /マージ定義なし\s*:\s*(\d+)/, '1',
  '合流ルールの未定義（spl_skills_st_ の1件だけが既知）');
/* v825監査修正: クラウド同期の対象すべて（OP_SYNC_PREFIX）も基準値で見る。
   従来は手入力データ（LS_NEVER_FREE）だけを見ており、daily_actuals_ が視界の外だった。
   塞ぐたびにこの基準値を1つずつ下げていく。増えたら新しい穴が空いたということ。 */
const a3 = audit('audit_merge_coverage.js', /同期対象で未保護\s*:\s*(\d+)/, '1',
  '同期対象で未保護（形を確認しながら1つずつ塞ぐ）');
const a2 = audit('audit_budget_month.js', /要確認\s*(\d+)\s*\/\s*解決済み\s*(\d+)/, '3 / 7',
  '予算の対象月（要確認3件は確認済みの偽陽性）');

/* ---------------- ビルドの基本チェック ---------------- */
console.log('\n===== ビルド =====');
let buildOk = true;
function chk(cond, label, detail) {
  console.log(`  ${cond ? '✅' : '❌'} ${label}` + (detail ? `：${detail}` : ''));
  if (!cond) buildOk = false;
}
try {
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8');
  const av = (html.match(/APP_VERSION = '(\d+)'/) || [])[1];
  const sv = (sw.match(/SW_BUILD = '(\d+)'/) || [])[1];
  chk(av && av === sv, '版数の一致', `APP_VERSION=${av} / SW_BUILD=${sv}`);

  const buf = fs.readFileSync(path.join(DIR, 'index.html'));
  let crlf = 0, lone = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) { (i > 0 && buf[i - 1] === 0x0d) ? crlf++ : lone++; }
  }
  chk(lone === 0, 'index.html の改行', `CRLF=${crlf} / lone LF=${lone}`);

  const i = html.indexOf('<script>'), j = html.indexOf('</script>', i);
  try { new Function(html.slice(i + 8, j)); chk(true, '構文チェック'); }
  catch (e) { chk(false, '構文チェック', e.message); }

  chk(fs.existsSync(path.join(DIR, `index_v${av}_backup.html`)),
    `index_v${av}_backup.html がある`, '次版の検証で「修正前」として使う');
} catch (e) { chk(false, 'ビルドチェック', e.message); }

console.log('');
const allOk = totalFail === 0 && !failed.length && a1 && a2 && a3 && buildOk;
console.log(allOk ? '===== すべて基準どおり =====\n' : '===== 上の ❌ / ⚠️ を確認してください =====\n');
process.exit(allOk ? 0 : 1);
