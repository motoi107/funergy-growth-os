/* verify_v901.js — 日次進捗の日毎の人件費率

   守るのは7つ。
   ① 人件費列の「直後」に人件費率の列がある（ヘッダー・セルとも）
   ② 実績が無い / 人件費が0 の日は '—'。0除算もNaNも出さない
   ③ 計算が 人件費 ÷ 実績 × 100 で、数値として正しい
   ④ ヘッダーの<th>と行の<td>が、isAgg × canEdit の全4通りで一致する
   ⑤ 月次KPIとズレる理由の注記が表の下にある
   ⑥ 信号色を付けていない（日別は残業割増を含まず低く出るため誤誘導になる）
   ⑦ 既存の列・月次KPI側の計算を壊していない
*/
const fs = require('fs');
const cur  = fs.readFileSync('index.html', 'utf8');
const src  = fs.existsSync('index_v901_backup.html') ? fs.readFileSync('index_v901_backup.html','utf8') : cur;
const prev = fs.readFileSync('index_v900_backup.html', 'utf8');

let pass = 0, fail = 0;
function ok(c, label, extra){
  if(c){ pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra!==undefined ? '  → ' + extra : '')); }
}

/* ---------- 断片の取り出し ---------- */
function headerLine(s){
  const m = s.split(/\r?\n/).find(l => l.includes("${t('日','Day')}</th>"));
  return m || '';
}
function rowTemplate(s){
  const i = s.indexOf('html += `<tr style="${rowBg}">');
  if(i < 0) return '';
  const j = s.indexOf('</tr>`;', i);
  return j < 0 ? '' : s.slice(i + 'html += `'.length, j + '</tr>'.length);
}

const hdr = headerLine(src);
const row = rowTemplate(src);
ok(hdr.length > 0, 'ヘッダー行を取り出せる');
ok(row.length > 0, '行テンプレートを取り出せる');

/* ---------- ① 位置 ---------- */
const hLabor = hdr.indexOf("t('人件費','Labor $')");
const hRate  = hdr.indexOf("t('人件費率*','Labor %*')");
ok(hRate > 0, 'ヘッダーに人件費率の列がある');
ok(hLabor > 0 && hRate > hLabor, 'ヘッダーで人件費率が人件費の「直後」にある', 'labor@'+hLabor+' rate@'+hRate);
ok(!/人件費率\*[\s\S]{0,80}t\('人件費','Labor \$'\)/.test(hdr), 'ヘッダーで人件費率が人件費より前に来ていない');

const cLabor = row.indexOf('fmtUSD2(dayLaborCost)');
const cRate  = row.indexOf('dayLaborRate');
ok(cRate > 0, '行に人件費率のセルがある');
ok(cLabor > 0 && cRate > cLabor, '行で人件費率が人件費の「直後」にある', 'labor@'+cLabor+' rate@'+cRate);

/* ---------- ② ③ 計算 ---------- */
const calcM = src.match(/var dayLaborRate = ([^\r\n;]+);/);
ok(!!calcM, 'dayLaborRate の算出がある');
if(calcM){
  const expr = calcM[1];
  ok(/hasAct/.test(expr) && /dayAct>0/.test(expr), '実績のガードがある（0除算・NaN防止）', expr);
  ok(/dayLaborCost>0/.test(expr), '人件費のガードがある', expr);

  const evalRate = (hasAct, dayAct, dayLaborCost) =>
    Function('hasAct','dayAct','dayLaborCost','return (' + expr + ');')(hasAct, dayAct, dayLaborCost);

  /* 280/1000*100 は 28.000000000000004 になる。表示は toFixed(1) なので
     生の値ではなく「画面に出る文字列」で確かめる。 */
  ok(Math.abs(evalRate(true, 1000, 280) - 28) < 1e-9, '1000ドル / 人件費280ドル → 28%', evalRate(true,1000,280));
  ok(evalRate(true, 1000, 280).toFixed(1) === '28.0', '画面表示が 28.0%（浮動小数の桁が出ない）', evalRate(true,1000,280).toFixed(1));
  ok(Math.abs(evalRate(true, 3200, 1024) - 32) < 1e-9, '3200ドル / 1024ドル → 32%', evalRate(true,3200,1024));
  ok(evalRate(true, 2750, 866.25).toFixed(1) === '31.5', '端数のある日も1桁で丸まる', evalRate(true,2750,866.25).toFixed(1));
  ok(evalRate(false, 0, 280) === null, '実績未入力の日は null（→ 表示は —）', evalRate(false,0,280));
  ok(evalRate(true, 0, 280) === null, '実績0の日は null。Infinity を出さない', evalRate(true,0,280));
  ok(evalRate(true, 1000, 0) === null, '人件費0の日は null', evalRate(true,1000,0));
  const vals = [evalRate(false,0,280), evalRate(true,0,280), evalRate(true,1000,0)];
  ok(vals.every(v => v === null || Number.isFinite(v)), 'NaN / Infinity が出ない', JSON.stringify(vals));
}
ok(/dayLaborRate!=null\?/.test(row), 'null のときは表示を分岐している');
ok(/dayLaborRate!=null\?[\s\S]{0,200}:'—'/.test(row), 'null のとき — を出す');

/* ---------- ④ 列数（isAgg × canEdit の全4通り） ---------- */
function countCols(tpl, vars, tag){
  const stub = {
    t: (ja) => ja,
    isAgg: false, canEdit: true, showRR: true,
    guestLabel: '客数',
    rtCellTd: '<td>rt</td>',
    rowBg: '', d: { day: 1, dow: '月', date: '2026-08-01' },
    isWeekend: false, weather: 'sunny', weatherIcon: () => 'W',
    dayHol: '', dayMemo: '', escapeHtml: (x) => String(x),
    fmtUSD2: (n) => '$' + Number(n).toFixed(2), pctColor: () => 'red',
    scopeStores: [{ id: 'F01' }],
    dayBud: 100, hasAct: true, dayAct: 1000, isToast: false, _manBy: null,
    hasLD: true, dayLunch: 400, dayDinner: 600,
    gv: { total: 50, lunch: 20, dinner: 30, toTotal: null, toLunch: null, toDinner: null, takeout: null },
    rate: 100, cumRate: 100, tipRate: 5, tipTotal: 50,
    dayLaborH: 30, dayLaborCost: 280, dayLaborRate: 28,
  };
  Object.assign(stub, vars);
  const keys = Object.keys(stub);
  const html = Function(...keys, 'return `' + tpl.replace(/\\/g, '\\\\') + '`;')(...keys.map(k => stub[k]));
  return (html.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length;
}

[[false, true], [false, false], [true, true], [true, false]].forEach(([isAgg, canEdit]) => {
  const label = 'isAgg=' + isAgg + ' canEdit=' + canEdit;
  let th = null, td = null, err = null;
  try {
    th = countCols(hdr, { isAgg, canEdit }, 'th');
    td = countCols(row, { isAgg, canEdit }, 'td');
  } catch(e){ err = e.message; }
  ok(err === null && th === td, '列数が一致 ' + label, err || ('th=' + th + ' td=' + td));
});

/* v900 でも一致していたこと（この検証自体が正しく効いているか） */
(() => {
  const h0 = headerLine(prev), r0 = rowTemplate(prev);
  let th = null, td = null;
  try { th = countCols(h0, { isAgg:false, canEdit:true }, 'th'); td = countCols(r0, { isAgg:false, canEdit:true }, 'td'); } catch(e){}
  ok(th === td, 'v900 でも列数は一致していた（検証の妥当性確認）', 'th=' + th + ' td=' + td);
  ok(th !== null && countCols(hdr, { isAgg:false, canEdit:true }, 'th') === th + 1, 'v901 で列がちょうど1つ増えた');
})();

/* ---------- ⑤ 注記 ---------- */
const noteRe = /人件費率＝人件費 ÷ 実績[\s\S]{0,120}残業割増[\s\S]{0,80}月次KPI/;
ok(noteRe.test(src), '表の下に月次KPIとズレる理由の注記がある');
ok(src.indexOf('</tbody></table>') < src.search(noteRe), '注記が表の「後」にある');
ok(/Labor % = Labor \$ ÷ Actual/.test(src), '注記が日英併記になっている');

/* ---------- ⑥ 信号色を付けていない ---------- */
const rateCell = row.slice(cRate > 0 ? row.lastIndexOf('<td', cRate) : 0,
                           cRate > 0 ? row.indexOf('</td>', cRate) + 5 : 0);
ok(!/tag-green|tag-red|tag-yellow|var\(--green\)|var\(--red\)/.test(rateCell),
   '人件費率セルに信号色を付けていない', rateCell.slice(0, 90));

/* ---------- ⑦ 壊していない ---------- */
ok(/t\('労働h','Labor h'\)/.test(hdr), '労働h の列が残っている');
ok(/t\('人件費','Labor \$'\)/.test(hdr), '人件費 の列が残っている');
ok(/t\('チップ率','Tip %'\)/.test(hdr), 'チップ率 の列が残っている');
ok(/tipRate = tipTotal\/dayAct\*100/.test(src), 'チップ率の計算を触っていない');

const laborCore = /laborRate: laborSalesCore\?Math\.round\(labor\/laborSalesCore\*1000\)\/10/;
ok(laborCore.test(src) && laborCore.test(prev), '月次KPIの人件費率の計算を触っていない');
ok(src.includes('function _laborCoreForYmRaw') && prev.includes('function _laborCoreForYmRaw'), 'laborCoreForYm を触っていない');
ok(/if \(h>0\) cost \+= h\*\(empWage\(n\)\|\|0\);/.test(src), 'toastLaborCostForDate を触っていない');
ok(/dayLaborCost \+= _tl\*\(1\+PAYROLL_TAX_RATE\)/.test(src), '人件費の積み上げ式を触っていない');

/* 変更が意図した箇所だけか */
/* 内訳: 算出 4行（コメント3＋コード1）／セル 1行／注記 2行（コメント1＋コード1）= 7行 */
const dl = src.split(/\r?\n/).length - prev.split(/\r?\n/).length;
ok(dl === 7, 'v900 からの行数増が想定どおり（+7）', '+' + dl);
ok(/const APP_VERSION = '901'/.test(src), 'APP_VERSION が 901');

console.log('\n合計 PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
