/* smoke_v887.js — シフトリーダーの支給額が「実際に計算されて出るか」を走らせて確かめる。
   文字列があるかではなく、金額が合っているかを見る。 */
const fs = require('fs');
const utf = fs.readFileSync('index.html', 'utf8');

function grab(re, name) {
  const m = utf.match(re);
  if (!m) { console.log('切り出し失敗: ' + name); process.exit(1); }
  return m[0];
}

/* シフトリーダー一式（v887 ヘルパー含む）＋ 期間ヘルパー */
const slBlock = grab(/var SL_DEFAULT_STORES = \[[\s\S]*?\nvar slHalf='first';/, 'SLブロック');
const p4 = grab(/function _p4Period\(iso\)\{[\s\S]*?\n\}/, '_p4Period');

const stub = `
var STORES=[{id:'F04-K',name:'Totoya Kaimuki',color:'#f0661f'},{id:'F01',name:'ToriTon',color:'#3b82f6'}];
var curStore='F04-K', curRole='gm', curUserName='Moto', slHalfSeed='first';
function t(ja,en){ return ja; }
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function _money(n){ return '$'+(Number(n)||0).toFixed(2); }
function showToast(){} function renderPage(){} function openModal(){}
function nowJP(){ return '2026-08-01'; } function myName(){ return 'Moto'; }
function isoLocalDate(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function bizToday(){ return '2026-08-10'; }
function tipPeriodInfo(){ return { y:2026, m:7, half:'first', from:'2026-08-01', to:'2026-08-15' }; }
function _owStoreName(id){ var s=STORES.find(function(x){return x.id===id;}); return s?s.name:id; }
function getTipWindow(){ return { lunchStart:10, lunchEnd:15, dinnerStart:16, dinnerEnd:23 }; }
function overlapHours(a,b,s,e){ return (a===s)?3:0; }

/* 従業員マスター：G1 が3人、G2 が1人（G2 は対象外になるはず） */
var _EMP=[{name:'Aさん',grade:'G1',store:'F04-K'},{name:'Bさん',grade:'G1',store:'F04-K'},
          {name:'Cさん',grade:'G1',store:'F04-K'},{name:'Dさん',grade:'G2',store:'F04-K'}];
function getEmployees(){ return _EMP; }
function empGrade(e){ return e.grade; }

/* Toast 勤怠：Shift Leader の Job が入っている日 */
var _LABOR={
  'F04-K':{
    '2026-08-01':{ 'Aさん':{shifts:[{jobTitle:'Shift Leader', inDate:10, outDate:15}]} },
    '2026-08-02':{ 'Aさん':{shifts:[{jobTitle:'Shift Leader', inDate:16, outDate:23}]},
                   'Dさん':{shifts:[{jobTitle:'Shift Leader', inDate:10, outDate:15}]} },
    '2026-08-03':{ 'Bさん':{shifts:[{jobTitle:'SL', inDate:10, outDate:15}]} }
  }
};
function getTipLabor(sid, dt){ return (_LABOR[sid]||{})[dt]||{}; }

/* 手入力ぶん（Cさん 1回・Aさん は Toast と同日同区分なので二重に数えないこと） */
var _STORE_LS={ 'sl_manual_F04-K': { '2026-08-05': { 'Cさん': { 'D': {at:'x', by:'Moto'} }, _at:1 },
                                     '2026-08-01': { 'Aさん': { 'L': {at:'x', by:'Moto'} }, _at:1 } } };
function ls(k,d){ return (k in _STORE_LS) ? _STORE_LS[k] : d; }
function lsSet(k,v){ _STORE_LS[k]=v; return true; }
function getVisibleStores(){ return STORES; }
function downloadCSV(rows,fn){ globalThis.__csv={rows:rows,fn:fn}; }
function acctMonthLabel(){ return '2026年8月'; }
var window = globalThis;
`;

const src = stub + '\n' + p4 + '\n' + slBlock + `
;globalThis.__T = { slPayrollData, slPayrollRows, slPeriodSummary, slDayRecords,
                    renderTipShiftLeader, exportSlPayrollCSV, slCfg };
globalThis.slHalf = 'first';
`;

let T;
try { T = new Function(src + '\nreturn globalThis.__T;')(); }
catch (e) { console.log('SMOKE FAIL → ' + e.message); console.log(e.stack.split('\n').slice(0,4).join('\n')); process.exit(1); }

let bad = 0;
function is(name, got, want) {
  const ok = String(got) === String(want);
  if (!ok) bad++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + '  → ' + got + (ok ? '' : '  (期待 ' + want + ')'));
}

const RATE = T.slCfg().amount;                       // 既定 $10
console.log('単価 = $' + RATE.toFixed(2) + '\n');

const p = T.slPayrollData('F04-K', '2026-08-01', '2026-08-15');
is('制度対象店として扱われる', p.enabled, true);
is('対象は G1 の3人だけ（G2 は除外）', p.rows.length, 3);
is('G2 が除外リストに入る', p.excluded.some(x => x.name === 'Dさん'), true);

const byName = {}; p.rows.forEach(r => byName[r.name] = r);
is('Aさん 回数（同日同区分の二重計上なし）', byName['Aさん'].count, 2);
is('Aさん 支給額 = 2回 × 単価', byName['Aさん'].amount, 2 * RATE);
is('Bさん 支給額 = 1回 × 単価', byName['Bさん'].amount, 1 * RATE);
is('Cさん（手入力のみ）も支給対象', byName['Cさん'].amount, 1 * RATE);
is('支給合計 = 4回 × 単価', p.total, 4 * RATE);
is('合計は各人の和と一致', p.rows.reduce((a, r) => a + r.amount, 0), p.total);

const off = T.slPayrollData('F01', '2026-08-01', '2026-08-15');
is('制度対象外の店は金額を出さない', off.enabled + '/' + off.total, 'false/0');

/* CSV の中身 */
const rows = T.slPayrollRows('F04-K', '2026-08-01', '2026-08-15');
const head = rows.find(r => r[0] === '氏名') || [];
is('CSV に単価列がある', head.indexOf('単価($)') >= 0, true);
is('CSV に支給額列がある', head.indexOf('支給額($)') >= 0, true);
is('CSV に該当日列がある', head.indexOf('該当日') >= 0, true);
const totRow = rows.find(r => r[0] === '合計') || [];
is('CSV 合計行の支給額', totRow[5], (4 * RATE).toFixed(2));
const aRow = rows.find(r => r[0] === 'Aさん') || [];
is('CSV Aさんの支給額', aRow[5], (2 * RATE).toFixed(2));
is('CSV Aさんの該当日が入っている', /08-01L|08-02D/.test(String(aRow[6])), true);
is('CSV に対象外の注記がある', rows.some(r => r[0] === '【対象外】'), true);

/* 単独出力 */
T.exportSlPayrollCSV('F04-K', '2026-08-10');
is('CSV ファイル名', /シフトリーダー手当_Totoya Kaimuki_2026-08-01_2026-08-15\.csv/.test((globalThis.__csv || {}).fn || ''), true);

/* 画面 */
let h = '';
try { h = T.renderTipShiftLeader(); } catch (e) { console.log('  FAIL  画面が落ちた → ' + e.message); bad++; }
is('画面に支給明細の見出しが出る', h.indexOf('支給明細') >= 0, true);
is('画面に一人ずつの金額が出る（Aさん $' + (2 * RATE).toFixed(2) + '）', h.indexOf('$' + (2 * RATE).toFixed(2)) >= 0, true);
is('画面に支給合計が出る', h.indexOf('$' + (4 * RATE).toFixed(2)) >= 0, true);
is('画面にCSV出力ボタンが出る', h.indexOf('exportSlPayrollCSV') >= 0, true);
is('アイコンが付いている（cash / crown / sun / moon）',
  ['ti-cash-banknote', 'ti-crown', 'ti-sun', 'ti-moon'].every(i => h.indexOf(i) >= 0), true);
is('色が付いている（green / accent / accent2）',
  ['var(--green)', 'var(--accent)', 'var(--accent2)'].every(c => h.indexOf(c) >= 0), true);

/* 制度対象外の店の画面は金額を出さない */
let h2 = '';
try { h2 = new Function(src + "\ncurStore='F01'; return renderTipShiftLeader();")(); } catch (e) { h2 = 'ERR:' + e.message; }
is('対象外の店の画面に支給明細を出さない', h2.indexOf('支給明細') < 0, true);

/* 配分表CSV のシフトリーダーブロックを実際に組んで、列がずれないか見る */
const mtx = grab(/var _slp = slPayrollData\(storeId, info\.from, info\.to\);[\s\S]*?rows\.push\(_slTot\);\r?\n  \}/, '配分表SLブロック');
const mtxRun = new Function(src + `
  var rows=[], storeId='F04-K';
  var info={from:'2026-08-01', to:'2026-08-15'};
  var dists=['2026-08-01','2026-08-02','2026-08-03','2026-08-05'].map(function(d){ return {date:d}; });
  function md(d){ return String(d).slice(5); }
  ${mtx}
  return rows;
`)();
/* 見出し行（【シフトリーダー】…）は列数が違って当然なので、データ行だけ見る */
const widths = mtxRun.filter(r => r.length > 1 && r[0] !== '【シフトリーダー】').map(r => r.length);
const uniq = [...new Set(widths)];
is('配分表CSV の列数が全行そろう（2+4日x2+3=13）', uniq.join('/'), '13');
const mHead = mtxRun.find(r => r[0] === '従業員＼日付') || [];
is('配分表CSV の末尾3列が 回数/単価/支給額', mHead.slice(-3).join(','), '期間合計(回),単価($),支給額($)');
const mTot = mtxRun.find(r => r[0] === '合計') || [];
is('配分表CSV の合計行の支給額', mTot[mTot.length - 1], (4 * RATE).toFixed(2));

console.log('\n' + (bad ? 'FAIL ' + bad + ' 件' : 'すべて PASS'));
process.exit(bad ? 1 : 0);
