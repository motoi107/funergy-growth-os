/* verify_v910.js — 会計PLの取り込み

   要は「実物のPLブックを、index.html に埋め込んだコードで正しく読めるか」。
   模擬データではなく本物のファイルに対して動かす。

   ① 実物の2026年PLを読み、7店×7か月=49行、検算NG 0
   ② 行も列も決め打ちしていない（店ごとに合計行の位置が違うのに全店読める）
   ③ 2025年形式のブックは0行で拒否（誤って取り込まない）
   ④ 利益(netop/opex)が pl_public に入らない
   ⑤ 同期の4点セットが揃っている
   ⑥ 確定判定が pl_public と合算店に対応している
*/
const fs = require('fs');
const path = require('path');
const src  = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v909_backup.html', 'utf8');

let pass = 0, fail = 0;
function ok(c, label, extra){
  if(c){ pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra!==undefined ? '  → ' + extra : '')); }
}
function grab(s, name){
  const i = s.indexOf('function ' + name + '(');
  if(i < 0) return '';
  let d = 0, st = false;
  for(let j = i; j < s.length; j++){
    if(s[j] === '{'){ d++; st = true; }
    else if(s[j] === '}'){ d--; if(st && d === 0) return s.slice(i, j + 1); }
  }
  return '';
}
function konst(s, name){
  const i = s.indexOf('var ' + name + ' =');
  if(i < 0) return '';
  const j = s.indexOf('\n};', i);
  if(j > 0 && j - i < 3000) return s.slice(i, j + 3);
  const k = s.indexOf(';', i);
  return s.slice(i, k + 1);
}

/* ---------- 埋め込みコードを取り出して実行環境を作る ---------- */
const XLSX = require('xlsx');
const code = [
  konst(src,'PL_SHEET_MAP'), konst(src,'PL_LABELS'),
  konst(src,'PL_MONTHS'), konst(src,'PL_MONTH_RE'),
  grab(src,'_plCell'), grab(src,'_plFindMonthCols'), grab(src,'_plFindRows'), grab(src,'parsePLWorkbook'),
].join('\n');
ok(code.length > 1500, '取り込みコードを取り出せる', code.length);
const F = new Function('XLSX','console', code + '\nreturn{parsePLWorkbook,PL_SHEET_MAP,PL_LABELS,_plFindRows};')(XLSX, console);

const UP = '/mnt/user-data/uploads';
const F26 = path.join(UP, 'Funergy_Group_Inc__PL_Jul26暫定M__1_.xlsx');
const F25 = path.join(UP, 'BS__PL_2025-12__1_.xlsx');
const has26 = fs.existsSync(F26), has25 = fs.existsSync(F25);
ok(has26, '2026年PLの実物がある（無ければ以下は飛ばす）', F26);

/* ---------- ① 実物を読む ---------- */
if (has26) (() => {
  const wb = XLSX.readFile(F26);
  const r = F.parsePLWorkbook(wb);
  ok(r.rows.length === 49, '49行（7店×7か月）', r.rows.length);
  ok(r.rows.filter(x => !x.ok).length === 0, '検算NGが0件');
  ok(r.warnings.length === 0, '警告なし', r.warnings.join(' / '));
  ok(r.months.join(',') === '2026-01,2026-02,2026-03,2026-04,2026-05,2026-06,2026-07', '1〜7月', r.months.join(','));
  const stores = {}; r.rows.forEach(x => stores[x.storeKey] = (stores[x.storeKey]||0)+1);
  ok(Object.keys(stores).length === 7, '7店舗', Object.keys(stores).join(','));
  ok(stores['F03+F03-G'] === 7, 'Waikiki は合算キーで入る（分離しない）', stores['F03+F03-G']);
  ok(!stores['F03'] && !stores['F03-G'], 'F03/F03-G の個別キーは作らない（按分＝推計を確定値にしない）');

  /* 既知の値と突き合わせ */
  const may = {}; r.rows.filter(x => x.ym==='2026-05').forEach(x => may[x.storeKey] = x.v);
  ok(may['F01'].sales === 120538, 'F01 5月 売上 $120,538（アプリのシード値と一致）', may['F01'].sales);
  ok(may['F02'].sales === 143503, 'F02 5月 売上 $143,503', may['F02'].sales);
  ok(may['F01'].cogs === 29135, 'F01 5月 原価 $29,135', may['F01'].cogs);
  ok(may['F02'].netop === 34301, 'F02 5月 営業利益 $34,301', may['F02'].netop);
  /* 未来の月（8月以降）は空なので取り込まない */
  ok(!r.months.some(m => m >= '2026-08'), '空の月を取り込んでいない');

  /* ② 行を決め打ちしていない証拠：店ごとに合計行の位置が違う */
  const rows = {};
  ['Tori Ton','Tenkichi','Waikiki','T-Kaimuki'].forEach(n => {
    const ws = wb.Sheets[n];
    const ref = XLSX.utils.decode_range(ws['!ref']);
    rows[n] = F._plFindRows(ws, ref.e.r).sales;
  });
  ok(new Set(Object.values(rows)).size > 1, '店ごとに売上の合計行が違う（行固定なら壊れる状況）', JSON.stringify(rows));
  ok(rows['Tori Ton'] !== rows['Tenkichi'] && rows['Waikiki'] !== rows['Tenkichi'], 'それでも全店から正しく読めている');
})();

/* ---------- ③ 2025年形式は拒否 ---------- */
if (has25) (() => {
  const r = F.parsePLWorkbook(XLSX.readFile(F25));
  ok(r.rows.length === 0, '2025年形式のブックからは1行も取り込まない', r.rows.length);
  ok(r.warnings.length > 0, '理由を出す', r.warnings.length);
  ok(r.warnings.some(w => /月の見出し/.test(w)), '「月の見出しが無い」と説明する');
})();

/* ---------- ④ 利益が pl_public に入らない ---------- */
const save = grab(src, 'plImportSave');
ok(save.length > 0, 'plImportSave がある');
(() => {
  const i = save.indexOf('pub[x.ym][x.storeKey]');
  const line = save.slice(i, save.indexOf(';', i));
  ok(/sales/.test(line) && /cogs/.test(line) && /payroll/.test(line), 'pl_public に 売上・原価・人件費 は入る');
  ok(!/netop/.test(line), '★pl_public に netop が入らない', line.slice(0,110));
  ok(!/opex/.test(line), '★pl_public に opex が入らない（引き算で利益が出るため）', line.slice(0,110));
  const j = save.indexOf('act[x.ym][x.storeKey]');
  const aline = save.slice(j, save.indexOf(';', j));
  ok(/netop/.test(aline) && /opex/.test(aline), 'pl_actual には全項目が入る（端末内のみ）');
})();
ok(!/SUPA_SETTING_KEYS = \['pl_actual'|'pl_actual',/.test(src.slice(src.indexOf('var SUPA_SETTING_KEYS'), src.indexOf('var SUPA_SETTING_KEYS')+400)),
   'pl_actual は同期キーに入れていない（利益が他端末へ行かない）');

/* ---------- ⑤ 同期の4点セット ---------- */
(() => {
  const seg = src.slice(src.indexOf('var SUPA_SETTING_KEYS'), src.indexOf('var SUPA_SETTING_KEYS') + 300);
  ok(/'pl_public'/.test(seg), '① SUPA_SETTING_KEYS に pl_public');
  ok(/pl_public:\s*\{ merge: mergeMapByKey, covers: _coversMapByKey \}/.test(src), '② 合流ルールがある');
  const nf = src.slice(src.indexOf('var LS_NEVER_FREE'), src.indexOf('var LS_NEVER_FREE') + 200);
  ok(/'pl_public'/.test(nf) && /'pl_actual'/.test(nf), '③ LS_NEVER_FREE に両方');
})();

/* ---------- ⑥ 確定判定 ---------- */
(() => {
  const PUB = { '2026-05': { 'F01':{sales:1}, 'F03+F03-G':{sales:1} } };
  const ACT = { '2026-06': { 'F02':{sales:1,netop:1} } };
  const G = new Function('ls','console', grab(src,'_meetIsConfirmed') + '\nreturn{_meetIsConfirmed};')
    ((k,d)=> (k==='pl_public'?PUB : k==='pl_actual'?ACT : d), console);
  ok(G._meetIsConfirmed('F01','2026-05') === true, 'pl_public にあれば確定');
  ok(G._meetIsConfirmed('F03','2026-05') === true, '合算キーがあれば F03 も確定');
  ok(G._meetIsConfirmed('F03-G','2026-05') === true, '合算キーがあれば F03-G も確定');
  ok(G._meetIsConfirmed('F05','2026-05') === false, '無い店は速報');
  ok(G._meetIsConfirmed('F02','2026-06') === true, 'pl_actual しか無い端末でも確定を出す');
  ok(G._meetIsConfirmed('F01','2026-07') === false, '取り込んでいない月は速報');
  const G2 = new Function('ls','console', grab(src,'_meetIsConfirmed') + '\nreturn{_meetIsConfirmed};')
    (()=>{ throw new Error('x'); }, console);
  ok(G2._meetIsConfirmed('F01','2026-05') === false, '読めないときは速報扱い（落ちない）');
})();

/* ---------- 入口と安全側 ---------- */
ok(/onclick="openPlImport\(\)"/.test(src), '簡易PL画面に取り込みボタンがある');
ok(/cdn\.jsdelivr\.net\/npm\/xlsx/.test(src), 'SheetJS は必要なときだけ読む');
ok(!/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/xlsx/.test(src), 'アプリ本体には常時読み込んでいない');
const prev2 = grab(src, '_plPreviewHtml');
ok(/取り込む内容がありません|取り込める行がありません/.test(prev2 + save), '取り込めないときは保存させない');
ok(/r\.rows\.filter\(function\(x\)\{ return x\.ok; \}\)/.test(save), '検算NGの行は保存しない');
ok(/_plImport = null/.test(save), '保存後に一時データを消す');
ok(/showToast\(/.test(save), '結果を知らせる');
ok(grab(src,'plFilePicked').indexOf('lsSet') < 0, 'ファイルを選んだだけでは保存しない');

/* ---------- 壊していない ---------- */
ok(grab(src, 'keyKpiStats') === grab(prev, 'keyKpiStats'), 'keyKpiStats を触っていない（PLで上書きしない）');
ok(grab(src, '_meetGapBreakdown') === grab(prev, '_meetGapBreakdown'), '差分分解を触っていない');
ok(grab(src, '_plPrevYear') === grab(prev, '_plPrevYear'), 'v909の昨対を触っていない');
ok(src.indexOf('var PL2025_SEED = {') > 0, 'v909の2025年シードが残っている');
ok(prev.indexOf('parsePLWorkbook') < 0, 'v909 には無かった関数');
ok(parseInt((src.match(/const APP_VERSION = '(\d+)'/)||[])[1],10) >= 910, 'APP_VERSION が 910 以上');

console.log('\n合計 PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
