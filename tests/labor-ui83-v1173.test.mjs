// v1173（UI案83・Moto さん 11/15 10:59 HST「全部Aで」）：予実 › 人件費・勤怠の PC・スマホと、不具合 3 つ。
// index.html の本物の関数を VM で動かす（合成データ・本番にはつながない・保存しない）。
// 本物のブラウザでの形・はみ出し・箱は tests/e2e-pcsp/labor-ui83-v1173.mjs（模擬サーバー）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(process.env.INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.indexOf('\nfunction ' + name + '(');
  assert.ok(start >= 0, 'function ' + name);
  const end = source.indexOf('\n}', start + 1);
  return source.slice(start + 1, end + 2);
}
const has = name => source.indexOf('\nfunction ' + name + '(') >= 0;
const run = (c, code) => vm.runInContext(code, c);

function ctx(extra) {
  const c = { console, out: [] };
  vm.createContext(c);
  vm.runInContext(['escapeHtml', '_laborHrs', 'breakHoursFromShifts', 'fmtClockHST'].map(fn).join('\n') + `
    function t(ja, en){ return ja; }
    var EMP = [];
    function getEmployees(){ return EMP; }
    var curRole = 'gm', curPage = 'labor', window = {};
    function renderPage(p){ out.push(p); }
  ` + (extra || ''), c);
  return c;
}
/* HST（UTC−10）の時刻を ISO に */
const H = (d, hm) => { const [y, m, dd] = d.split('-').map(Number), [h, mi] = hm.split(':').map(Number); return new Date(Date.UTC(y, m - 1, dd, h + 10, mi)).toISOString(); };

test('版：APP_VERSION と SW_BUILD が 1173 以上でそろう', () => {
  const a = Number(/const APP_VERSION = '(\d+)'/.exec(source)[1]), b = Number(/const SW_BUILD = '(\d+)'/.exec(SW)[1]);
  assert.ok(a >= 1173 && a === b, a + ' / ' + b);
});

test('不具合 1：読めない打刻の時刻は「NaN:NaN」ではなく「--:--」（ほかの時刻は今まで通り）', () => {
  const c = ctx();
  assert.equal(run(c, `fmtClockHST('2026-11-13T25:30:00')`), '--:--');   // 合成データの時刻不正（24 時より後）
  assert.equal(run(c, `fmtClockHST('not a date')`), '--:--');
  assert.equal(run(c, `fmtClockHST('')`), '—');
  assert.equal(run(c, `fmtClockHST(null)`), '—');
  assert.equal(run(c, `fmtClockHST('${H('2026-11-02', '09:05')}')`), '09:05');
  assert.equal(run(c, `fmtClockHST('${H('2026-11-02', '23:59')}')`), '23:59');
});

test('不具合 1：1 日の表とスマホの箱は「--:--」に「時刻不正」を添える（打刻エラーと同じ言葉）', () => {
  assert.ok(has('attStaffCells') && has('attClockHtml'), 'v1173 の関数');
  const c = ctx(fn('attStaffCells') + '\n' + fn('attClockHtml'));
  const e = { lunch: 0, dinner: 0, rawLunch: 0, rawDinner: 0, shifts: [{ inDate: '2026-11-13T25:30:00', outDate: H('2026-11-13', '13:30') }] };
  const x = run(c, `attStaffCells(${JSON.stringify(e)})`);
  assert.equal(x.clockIn, '--:--'); assert.equal(x.clockOut, '13:30'); assert.equal(x.missingOut, false);
  assert.match(run(c, `attClockHtml('--:--')`), /時刻不正/);
  assert.equal(run(c, `attClockHtml('09:00')`), '09:00');
  /* 退勤なしは今まで通り「漏れ」 */
  const y = run(c, `attStaffCells(${JSON.stringify({ shifts: [{ inDate: H('2026-11-13', '09:00') }] })})`);
  assert.equal(y.missingOut, true);
});

test('不具合 3：1 日の表の見出しと値の位置（左・中央・右）がそろう・名前はエスケープ', () => {
  assert.ok(has('attDayTableHtml'), 'v1173 の関数');
  const c = ctx(['attStaffCells', 'attClockHtml', 'attStaffNameHtml', 'attDayTableHtml'].map(fn).join('\n'));
  const labor = { '<b>Ann</b>': { lunch: 4.5, dinner: 0, rawLunch: 4.5, rawDinner: 0, shifts: [{ inDate: H('2026-11-02', '09:00'), outDate: H('2026-11-02', '13:30') }] },
    'Bo': { lunch: 0, dinner: 3, rawLunch: 0, rawDinner: 3, shifts: [{ inDate: '2026-11-02T26:00:00', outDate: H('2026-11-02', '20:00') }] } };
  const html = run(c, `attDayTableHtml('F01', ${JSON.stringify({ date: '2026-11-02', names: Object.keys(labor), labor })})`);
  const align = s => { const m = /text-align:\s*(\w+)/.exec(s || ''); return m ? m[1] : 'left'; };
  const th = [...html.matchAll(/<th(?=[\s>])([^>]*)>/g)].map(m => align(m[1]));
  const firstRow = html.slice(html.indexOf('<tbody>'));
  const td = [...firstRow.slice(0, firstRow.indexOf('</tr>')).matchAll(/<td(?=[\s>])([^>]*)>/g)].map(m => align(m[1]));
  assert.deepEqual(th, td, '見出し ' + th.join(',') + ' / 値 ' + td.join(','));
  assert.deepEqual(th, ['left', 'center', 'center', 'right', 'right', 'right', 'right']);
  assert.ok(!/NaN/.test(html), 'NaN が出ない');
  assert.ok(html.includes('&lt;b&gt;Ann&lt;/b&gt;') && !html.includes('<b>Ann</b>'), '名前はエスケープ');
});

test('不具合 2：労働時間のタブの月の切り替えは 1 つ（renderLaborHours の中に 2 つ目が無い）', () => {
  assert.ok(!/shiftAttMonth\(/.test(fn('renderLaborHours')), 'renderLaborHours に月の切り替えがある');
  assert.ok(!/shiftAttMonth\(/.test(fn('renderLaborHoursPc')), 'renderLaborHoursPc に月の切り替えがある');
  const rl = fn('renderLabor');
  assert.equal((rl.match(/shiftAttMonth\(-1\)/g) || []).length, 1, 'renderLabor の上の 1 つだけ');
});

test('PC とスマホ：幅で描き分ける（1024px・印 data-lbv・見張り）と、その入口', () => {
  const rl = fn('renderLabor');
  assert.match(rl, /data-lbv="\$\{laborIsPc\(\)\?'pc':'sp'\}"/);
  assert.match(rl, /laborIsPc\(\) \? renderLaborOverviewPc\(\) : renderLaborOverview\(\)/);
  assert.match(rl, /if \(laborIsPc\(\)\) return html \+ renderLaborHoursPc\(/);
  assert.match(fn('renderAttendanceBody'), /data-lbv=/);
  assert.match(fn('renderLaborDetail'), /if \(_pc\) return renderLaborDetailPc\(/);
  assert.match(fn('laborIsPc'), /empSmIsPc\(\)/);
  assert.match(fn('laborPcWatch'), /min-width:1024px/);
});

test('承認・メモ・解除のあと：今の画面を描き直す（人件費・勤怠から押しても勤怠データのページへ移らない）', () => {
  const c = ctx(fn('attRerender'));
  run(c, `curPage='labor'; attRerender(); curPage='attendance'; attRerender();`);
  assert.equal(run(c, 'out.join()'), 'labor,attendance');
  for (const n of ['_applyDayAtt', 'unapproveDayAtt', 'memoDayAtt']) {
    const s = fn(n);
    assert.ok(/attRerender\(\)/.test(s) && !/renderPage\('attendance'\)/.test(s), n);
  }
});

test('スマホの箱：data-mfull-req の箱も全画面（FUNERGY_LAYOUT）・題と「承認」の行', () => {
  const L = source.slice(source.indexOf('/* ==== FUNERGY_LAYOUT start'), source.indexOf('/* ==== FUNERGY_LAYOUT end ==== */'));
  assert.match(L, /n >= 3 \|\| tbls\.length \|\| mb\.querySelector\('\[data-mfull-req\]'\)/);
  const box = fn('attOpenDayBox');
  assert.match(box, /data-mfull-req/);
  assert.match(box, /class="btn-row"/);
  assert.match(box, /attBoxDo\('approve'/);
  /* 箱から押すと箱を閉じてから今と同じ関数 */
  const c = ctx(fn('attBoxDo') + `
    function closeModalDirect(){ out.push('close'); }
    function approveDayAtt(s,d){ out.push('approve:'+s+':'+d); }
    function unapproveDayAtt(s,d){ out.push('unapprove:'+s+':'+d); }
    function memoDayAtt(s,d){ out.push('memo:'+s+':'+d); }
    function openAttFixModal(s,d){ out.push('fix:'+s+':'+d); }`);
  run(c, `attBoxDo('approve','F01','2026-11-02'); attBoxDo('fix','F01','2026-11-03');`);
  assert.equal(run(c, 'out.join()'), 'close,approve:F01:2026-11-02,close,fix:F01:2026-11-03');
});

/* 勤怠明細の PC：合成の行で描く */
function detailCtx() {
  return ctx(['renderLaborDetailPc', 'laborDetailFilter', 'laborDetailToggle'].map(fn).join('\n') + `
    function attMonthLabel(){ return '2026年11月'; }
    function fmtUSD2(v){ return '$' + Number(v).toFixed(2); }
    function owRowBadge(b){ return b && b.under ? '<span class="tag">不足</span>' : ''; }
    function _ceKindTags(){ return '<span class="tag">時刻不正</span>'; }
    function getCeCfg(){ return { nightFrom:'03:00', nightTo:'05:00' }; }
    function renderLaborOverwork(){ return '<div id="ow-body">Grade別の表</div>'; }
  `);
}
const ROWS = [
  { name: 'Ann <x>', reg: 4.5, ot: 0, wage: 72, tags: '', sub: 'G1', subCol: '', wageHtml: '$72.00', detail: '通常 $72.00 ＋ OT $0.00', sp: '' },
  { name: 'Bo', reg: 10, ot: 2, wage: 230, tags: '', sub: 'G2', subCol: '', wageHtml: '$230.00', detail: '通常 $200.00 ＋ OT $30.00', sp: '' },
  { name: 'Cy', reg: 1.5, ot: 0, wage: 24, tags: '', sub: 'G2', subCol: '', wageHtml: '$24.00', detail: '', sp: '' }
];
const DD = canWage => ({ storeId: 'F01', canWage, ym: '2026-11', weeks: [], selWeek: '', periodLabel: '2026年11月 全体', core: { cutoff: true }, hqCnt: 0, hqAmt: 0,
  ow: { byName: { Cy: { under: 1 } }, over: [], under: [{}] }, ce: { rows: [{ name: 'Bo', date: '2026-11-13', level: 'error', kinds: ['bad'], det: [{ inClock: '--:--', outClock: '13:30', hours: 0 }] }], error: [1], warn: [], overrides: [] },
  rows: ROWS, warn: '', sumHtml: '<div id="sum">人件費サマリー Labor額</div>', unreg: [], shownCount: 3, totalReg: 16, totalOt: 2, totalCost: 326 });

test('勤怠明細（PC）：従業員の表と右のパネル（打刻エラー 3 件まで・Grade別はたたむ・人件費）・合計は渡された数字', () => {
  const c = detailCtx();
  c.D = DD(true);
  const html = run(c, 'renderLaborDetailPc(D)');
  assert.equal((html.match(/<tr [^>]*data-n=/g) || []).length, 3);
  assert.ok(html.includes('Ann &lt;x&gt;') && !html.includes('Ann <x>'), '名前はエスケープ');
  assert.match(html, /<table class="lb-tbl" id="ld-tbl" data-lbstick>/);
  assert.match(html, /<aside class="lb-col lb-side">/);
  assert.match(html, /<details class="lb-fold"[^>]*>[\s\S]*Grade別の表/);
  assert.ok(!/<details class="lb-fold" open/.test(html), 'Grade別ははじめたたむ');
  assert.match(html, /<div id="sum">/);
  assert.match(html, /16h<\/td><td class="num">2h<\/td><td class="num">\$326\.00/);
  assert.match(html, /賃金<\/th>/);
  assert.match(html, /laborDetailToggle\(this\)/);
  assert.ok(!/NaN|undefined/.test(html));
  /* 賃金を見られない人：賃金の列と内訳を出さない */
  c.D = DD(false);
  const h2 = run(c, 'renderLaborDetailPc(D)');
  assert.ok(!/賃金<\/th>/.test(h2) && !/\$72\.00/.test(h2) && !/laborDetailToggle\(this\)/.test(h2) && !/通常 \$200/.test(h2));
});

test('勤怠明細（PC）：並べ替え・不足／超過だけ・名前で探す（描き直したときも同じ行）', () => {
  const c = detailCtx();
  c.D = DD(true);
  run(c, `window._ldSort='hours'`);
  const names = s => [...s.matchAll(/data-n="([^"]*)"/g)].map(m => m[1]);
  assert.deepEqual(names(run(c, 'renderLaborDetailPc(D)')), ['bo', 'ann &lt;x&gt;', 'cy']);
  run(c, `window._ldSort='wage'`);
  assert.deepEqual(names(run(c, 'renderLaborDetailPc(D)')), ['bo', 'ann &lt;x&gt;', 'cy']);
  run(c, `window._ldSort=''; window._ldOw=true`);
  const h = run(c, 'renderLaborDetailPc(D)');
  assert.equal((h.match(/data-n="[^"]*" data-ow="1"(?! hidden)/g) || []).length, 1);
  assert.match(h, /不足・超過だけ（1）/);
  run(c, `window._ldOw=false; window._ldQ='an'`);
  const q = run(c, 'renderLaborDetailPc(D)');
  assert.equal((q.match(/data-n="[^"]*" data-ow="[01]"(?! hidden)/g) || []).length, 1);
  assert.match(q, /id="ld-cnt">1 人 \/ 3</);
});

test('勤怠明細（PC）：名前で探すは行を出し入れするだけ（描き直さない）・行を押すと内訳', () => {
  const c = detailCtx();
  /* 小さな DOM の代わり */
  run(c, `
    function TR(n, ow, x){ var tr = { hidden:false, attrs:{'data-n':n,'data-ow':ow}, getAttribute:function(k){ return this.attrs[k]; }, setAttribute:function(k,v){ this.attrs[k]=v; } };
      tr.nextElementSibling = x ? { hidden:true, classList:{ contains:function(k){ return k==='lb-x'; } } } : { classList:{ contains:function(){ return false; } } };
      return tr; }
    var rows = [TR('ann', '0', true), TR('bo', '1', true), TR('cy', '0', false)];
    var cnt = { textContent:'' };
    var document = { querySelector:function(s){ return s==='#ld-tbl > tbody' ? { querySelectorAll:function(){ return rows; } } : null; }, getElementById:function(id){ return id==='ld-cnt' ? cnt : null; } };
  `);
  run(c, `rows[0].nextElementSibling.hidden=false; laborDetailFilter('B')`);
  assert.deepEqual(JSON.parse(run(c, 'JSON.stringify(rows.map(function(r){ return r.hidden; }))')), [true, false, true]);
  assert.equal(run(c, 'rows[0].nextElementSibling.hidden'), true, '隠した行の内訳も閉じる');
  assert.equal(run(c, 'cnt.textContent'), '1 人 / 3');
  assert.equal(run(c, 'window._ldQ'), 'B');
  assert.equal(run(c, 'out.length'), 0, '描き直さない');
  run(c, `window._ldOw=true; laborDetailFilter('')`);
  assert.deepEqual(JSON.parse(run(c, 'JSON.stringify(rows.map(function(r){ return r.hidden; }))')), [true, false, true]);
  run(c, `window._ldOw=false; laborDetailFilter('')`);
  assert.equal(run(c, 'cnt.textContent'), '3 人');
  run(c, `laborDetailToggle(rows[1])`);
  assert.equal(run(c, 'rows[1].nextElementSibling.hidden'), false);
  assert.equal(run(c, `rows[1].attrs['aria-expanded']`), 'true');
  run(c, `laborDetailToggle(rows[1])`);
  assert.equal(run(c, `rows[1].attrs['aria-expanded']`), 'false');
});

test('勤怠明細：スマホの表は今と同じ（行の HTML は sp に、PC は同じ行の数字から）', () => {
  const d = fn('renderLaborDetail');
  assert.match(d, /_tbody = _rowsArr\.map\(function\(r\)\{ return r\.sp; \}\)\.join\(''\);/);
  /* 打刻エラー・Grade別のカードはスマホだけ上に（PC は右のパネル） */
  assert.match(d, /var _pc = laborIsPc\(\);/);
});
