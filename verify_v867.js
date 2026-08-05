/* verify_v867.js — 会議タブの売上目標が予算設定と一致しない

   Motoさん報告：会議タブの売上目標や他のKPIが、予算設定とKPI管理と合わない。

   原因は2つあった。どちらも会議タブ側（keyKpiStats）の計算。

   ① 日割りの分母が「日次タブで最後に見ていた月」の日数だった。
      dayBudgetFromBases() は monthDays() で日数を取っていたが、monthDays() は
      引数を取らず、日次タブのグローバル dailyMonthOffset を見ている。
      会議タブで8月を開いていても、日次タブで2月を見た後だと 28 で割られ、
      8月の売上目標が 31/28＝10.7% 過大になっていた。
      「日次タブでどの月を最後に見たか」で数字が変わる＝明確なバグ。

   ② 定休日の係数（bizDayFactor）が会議タブにだけ掛かっていた。
      予算設定は3区分の月合計をそのまま出し、係数を掛けない。
      月曜定休の店で −16.1%、月曜ランチ休みで −4.4% ずれていた。

   Motoさん確認済み（A案）＝予算設定を正とする。定休日の係数は掛けない。
   月間の売上予算は monthSalesBudget() の1か所で出し、予算設定と会議タブが
   同じ関数を見る（原価の foodCostOf() と同じ考え方）。

   ★ 判断を1つ入れている：日別の手入力は残す。
     日次実績には予算の手入力欄（ov.budget）があり、会議タブは反映、
     予算設定は無視していた。A案のまま素直に揃えると手入力が黙って消えるので、
     手入力（b.days と ov.budget）がある月は日ごとに積み直す。
     手入力が1つも無ければ、これまでどおり月合計そのまま。

   ★ 1日ぶんの表示（dayBudgetFor）は変えていない。定休日はこれまでどおり 0 になる。
     変えたのは「月の合計をどう出すか」だけ。

   守るのは7つ。
   ① 日割りの分母がその日付の月の日数になっている
   ② 日次タブの月を変えても会議タブの売上目標が動かない
   ③ 定休日があっても予算設定と会議タブが一致する
   ④ 日別の手入力は消えない
   ⑤ 予算設定と会議タブが同じ関数を見ている
   ⑥ 1日ぶんの表示は今までどおり（定休日は 0）
   ⑦ 原価・人件費まわりを1バイトも変えていない */
const fs = require('fs');
const _cur = fs.readFileSync('index.html', 'utf8');
const src = fs.existsSync('index_v867_backup.html')
  ? fs.readFileSync('index_v867_backup.html', 'utf8') : _cur;
const prev = fs.readFileSync('index_v866_backup.html', 'utf8');
let pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '   → ' + JSON.stringify(extra) : '')); }
}
function grab(text, name) {
  let i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  if (text.slice(Math.max(0, i - 6), i) === 'async ') i -= 6;
  let d = 0, st = false, j = i;
  for (; j < text.length; j++) {
    const c = text[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return text.slice(i, j);
}
function code(text, name) { return grab(text, name).replace(/\/\*[\s\S]*?\*\//g, ''); }
function unchangedIn(n) { try { return grab(src, n) === grab(prev, n); } catch (e) { return false; } }

/* 予算：ランチ 30,000 / ディナー 70,000 / TO 500×20=10,000 → 月 110,000 */
const SEG = { lunch: { sales: 30000 }, dinner: { sales: 70000 }, takeout: { orders: 500, spend: 20 } };
function env(cfg) {
  return new Function('CFG', `
    var DOW = ['月','火','水','木','金','土','日'];
    var dailyMonthOffset = CFG.off, STORES = CFG.stores;
    function budgetAuthorLabel(b){ return (b && b.by) || ''; }
    function getSegments(b){ return b && b.segments; }
    function hasSegments(b){ return !!(b && b.segments); }
    function usesDowMode(b){ return !!(b && b.dowMode); }
    function getDow(b){ return (b && b.dow) || null; }
    function dowSegBreakdown(dow, ym){ return CFG.dowBd || { lunch:0, dinner:0, takeout:0 }; }
    function getBudgetForMonth(){ return CFG.b; }
    function getDailyActuals(){ return CFG.acts || {}; }
    function daysOfYm(ym){
      var p = ym.split('-'), y = +p[0], m = +p[1], n = new Date(y, m, 0).getDate(), a = [];
      for (var i = 1; i <= n; i++) { var d = new Date(y, m-1, i);
        a.push({ date: ym + '-' + String(i).padStart(2,'0'), dow: ['日','月','火','水','木','金','土'][d.getDay()] }); }
      return a;
    }
    ${grab(src, 'segSales')} ${grab(src, 'segmentsTotal')} ${grab(src, 'monthDays')}
    ${grab(src, '_ymDaysCount')} ${grab(src, 'bizDayFactor')} ${grab(src, 'dayBudgetFromBases')}
    ${grab(src, 'hasDayBudget')} ${grab(src, 'dayBudgetFor')} ${grab(src, 'dayBudgetAuto')}
    ${grab(src, 'monthSalesBudget')}
    return { cnt:_ymDaysCount, month:monthSalesBudget, day:dayBudgetFor, bases:dayBudgetFromBases };
  `)(cfg);
}
function mk(o) {
  return env({
    off: (o.off || 0),
    stores: [{ id: 'F02', bizDays: o.bizDays || null }],
    b: Object.assign({ storeId: 'F02', by: 'Moto', segments: SEG }, o.b || {}),
    acts: o.acts || {}, dowBd: o.dowBd
  });
}
const R = v => Math.round(v);

console.log('\n[1] ① 日割りの分母はその日付の月');
{
  const E = mk({});
  ok(E.cnt('2026-08') === 31, '8月は31日');
  ok(E.cnt('2026-02') === 28, '2026年2月は28日');
  ok(E.cnt('2024-02') === 29, 'うるう年は29日');
  ok(E.cnt('') === 0 && E.cnt(null) === 0 && E.cnt('abc') === 0, '不正な入力は0');
  /* 1日ぶんの額が対象月で決まる（日次タブの月では決まらない） */
  const a = mk({ off: 0 }).bases({ storeId: 'F02', by: 'Moto', segments: SEG }, '月', '2026-08');
  const b = mk({ off: -6 }).bases({ storeId: 'F02', by: 'Moto', segments: SEG }, '月', '2026-08');
  ok(R(a) === R(b) && R(a) === R(110000 / 31),
    '日次タブの月を変えても8月の1日ぶんは変わらない', { a: R(a), b: R(b) });
  ok(/_ymDaysCount\(ym\) \|\|/.test(code(src, 'dayBudgetFromBases')), '分母を対象月から取っている');
  ok(/dayBudgetFromBases\(b, dow, String\(dateISO\|\|''\)\.slice\(0,7\)\)/.test(code(src, 'dayBudgetFor')),
    'dayBudgetFor が月を渡している');
  ok(/dayBudgetFromBases\(b, dow, String\(dateISO\|\|''\)\.slice\(0,7\)\)/.test(code(src, 'dayBudgetAuto')),
    'dayBudgetAuto も月を渡している');
}

console.log('\n[2] ②③ 予算設定と会議タブが一致する');
{
  const SETUP = 110000;   /* 予算設定の「月間売上予算」 */
  [['日次タブが8月', 0], ['日次タブが6月', -2], ['日次タブが2月', -6]].forEach(function (c) {
    const v = mk({ off: c[1] }).month('F02', '2026-08');
    ok(R(v) === SETUP, c[0] + ' でも ' + SETUP.toLocaleString(), R(v));
  });
  [['月曜がランチ休み', { '月': 'lclose' }], ['月曜が定休', { '月': 'closed' }],
   ['水曜がディナー休み', { '水': 'dclose' }]].forEach(function (c) {
    const v = mk({ bizDays: c[1] }).month('F02', '2026-08');
    ok(R(v) === SETUP, c[0] + ' でも ' + SETUP.toLocaleString() + '（定休日の係数を掛けない）', R(v));
  });
  /* 曜日別モードは曜日表の合計をそのまま */
  const dv = mk({ b: { dowMode: true, dow: {} }, dowBd: { lunch: 40000, dinner: 60000, takeout: 5000 } })
    .month('F02', '2026-08');
  ok(R(dv) === 105000, '曜日別モードは曜日表の合計', R(dv));
  ok(mk({ b: { segments: null } }).month('F02', '2026-08') === 0, '予算が無ければ0');
}

console.log('\n[3] ④ 日別の手入力は消えない');
{
  /* 日次実績の予算欄で 8/3 を 9,000 に（自動は 110000/31 = 3,548.4） */
  const per = 110000 / 31;
  const v1 = mk({ acts: { '2026-08-03': { budget: 9000 } } }).month('F02', '2026-08');
  ok(R(v1) === R(110000 - per + 9000), '日次実績の手入力が効く', { got: R(v1), want: R(110000 - per + 9000) });
  ok(v1 > 110000, '手入力ぶんだけ増えている');
  /* 予算の日別調整（b.days）も効く */
  const v2 = mk({ b: { days: { '2026-08-05': 12000 } } }).month('F02', '2026-08');
  ok(R(v2) === R(110000 - per + 12000), '予算の日別調整が効く', R(v2));
  /* 両方あるときは日次実績が優先（dayBudgetFor と同じ優先順） */
  const v3 = mk({ b: { days: { '2026-08-05': 12000 } }, acts: { '2026-08-05': { budget: 20000 } } })
    .month('F02', '2026-08');
  ok(R(v3) === R(110000 - per + 20000), '両方あれば日次実績の値が勝つ', R(v3));
  /* 手入力が無ければ日ごとに積み直さない＝月合計そのまま */
  ok(R(mk({}).month('F02', '2026-08')) === 110000, '手入力が無ければ月合計そのまま');
  /* 手入力がある月でも定休日の係数は掛けない */
  const v4 = mk({ bizDays: { '月': 'closed' }, acts: { '2026-08-03': { budget: 9000 } } }).month('F02', '2026-08');
  ok(R(v4) === R(110000 - per + 9000), '手入力があっても定休日の係数は掛けない', R(v4));
}

console.log('\n[4] ⑤ 同じ関数を見ている');
{
  ok(/monthSalesBudget\(b\.storeId, _bsYmStr\)/.test(code(src, 'renderBudgetSetup')),
    '予算設定が monthSalesBudget を呼ぶ');
  ok(!/segmentsTotal\(segs\)[^;]*;\s*$/m.test(code(src, 'renderBudgetSetup')) ||
     !/var total = dowMode \?/.test(code(src, 'renderBudgetSetup')),
    '予算設定に古い計算が残っていない');
  const kk = code(src, 'keyKpiStats');
  ok(/monthSalesBudget\(s\.id, ym\)/.test(kk), '会議タブ側も monthSalesBudget を呼ぶ');
  ok(/budget \+= _msb/.test(kk) && /salesBud \+= _msb/.test(kk), '売上予算と客単価の分子が同じ値');
  ok(!/budget\+=dayBud/.test(kk), '日ごとの積み上げが残っていない');
  ok(!/var dayBud=ov\.budget/.test(kk), '使わなくなった変数も残っていない');
}

console.log('\n[5] ⑥ 1日ぶんの表示は変えていない');
{
  const E = mk({ bizDays: { '月': 'closed' } });
  /* 2026-08-03 は月曜 */
  ok(E.day({ storeId: 'F02', by: 'Moto', segments: SEG }, '2026-08-03', '月') === 0,
    '定休日の1日ぶんは今までどおり 0（日次画面の表示は変えていない）');
  const tue = E.day({ storeId: 'F02', by: 'Moto', segments: SEG }, '2026-08-04', '火');
  ok(R(tue) === R(110000 / 31), '定休日でない日は月合計÷その月の日数', R(tue));
  ok(/bizDayFactor\(b\.storeId, dow, b\)/.test(code(src, 'dayBudgetFor')),
    'dayBudgetFor は今までどおり定休日の係数を掛ける');
}

console.log('\n[6] ⑦ 触っていないもの');
{
  ok(unchangedIn('bizDayFactor'), 'bizDayFactor を1バイトも変えていない');
  ok(unchangedIn('segmentsTotal'), 'segmentsTotal を1バイトも変えていない');
  ok(unchangedIn('segSales'), 'segSales を1バイトも変えていない');
  ok(unchangedIn('hasDayBudget'), 'hasDayBudget を1バイトも変えていない');
  ok(unchangedIn('dowSegBreakdown'), 'dowSegBreakdown を1バイトも変えていない');
  ok(unchangedIn('segmentsFcBudget'), '原価予算を1バイトも変えていない');
  ok(unchangedIn('segmentsLaborBudget'), '人件費予算を1バイトも変えていない');
  ok(unchangedIn('foodCostOf'), 'foodCostOf を1バイトも変えていない');
  ok(unchangedIn('laborCoreForYm'), 'laborCoreForYm を1バイトも変えていない');
  ok(unchangedIn('getStoreKpiTargets'), 'KPI管理の読み出しを1バイトも変えていない');
  ok(unchangedIn('monthGuestBudget'), '客数予算を1バイトも変えていない');
  ok(unchangedIn('_meetKpiRows'), '会議のKPI行の並びを1バイトも変えていない');
  ok(unchangedIn('monthSalesBudget') === false, 'monthSalesBudget は新設（前版に無い）');
  ok(unchangedIn('empStoresOf'), 'v866 のスキル判定を1バイトも変えていない');
}

console.log('\n[7] ビルド');
{
  const av = (src.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
  const pv = (prev.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
  ok(av && pv && Number(av) === Number(pv) + 1, '前版より1つだけ進んでいる', { prev: pv, now: av });
  if (src === _cur) {
    const sw = (fs.readFileSync('sw.js', 'utf8').match(/SW_BUILD\s*=\s*'(\d+)'/) || [])[1];
    ok(sw === av, 'SW_BUILD も同じ', { APP_VERSION: av, SW_BUILD: sw });
  }
}

console.log('\nPASS=' + pass + ' FAIL=' + fail);
process.exit(fail ? 1 : 0);
