/* verify_v802.js — 月次進捗の「全店合算」カード
   最重要：合算の数字が、下に並ぶ店舗別カードと食い違わないこと。 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v801_backup.html', 'utf8');
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
console.log('\n=== v802: 全店合算（月次進捗） ===\n');

function build() {
  return new Function(`
    var curLang='ja';
    function t(ja,en){ return curLang==='en'?en:ja; }
    function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function fmtK(n){ return '$'+Math.round(Number(n)||0).toLocaleString('en-US'); }
    function progBar(p,o){ return '<div class="bar" data-p="'+(p==null?'':p)+'"></div>'; }
    ${grab(src, '_bAggLaborPct')}
    ${grab(src, '_bAggFcPct')}
    ${grab(src, 'renderBudgetAllStoreAgg')}
    return { labor:_bAggLaborPct, fc:_bAggFcPct, render:renderBudgetAllStoreAgg,
             lang:function(l){ curLang=l; } };
  `)();
}
const e = build();

/* 店舗別カードと同じ作り方で3店ぶんを用意 */
const CUM = {
  'F01':   { budMonth: 300000, actMonth: 320000, budToToday: 200000, actToToday: 220000, costToToday: 66000, laborToToday: 55000, daysPassed: 20 },
  'F04-K': { budMonth: 100000, actMonth: 90000,  budToToday: 66000,  actToToday: 60000,  costToToday: 18000, laborToToday: 21000, daysPassed: 20 },
  'F04-P': { budMonth: 80000,  actMonth: 85000,  budToToday: 53000,  actToToday: 58000,  costToToday: 17400, laborToToday: 17000, daysPassed: 20 }
};
const STORES = [{ id: 'F01', name: 'ToriTon' }, { id: 'F04-K', name: 'Kaimuki' }, { id: 'F04-P', name: 'Piikoi' }];
function aggOf(cum, ids) {
  const a = { budToToday: 0, actToToday: 0, budMonth: 0, actMonth: 0, costToToday: 0, laborToToday: 0, daysPassed: 0, daysWithActual: 0 };
  ids.forEach(function (id) {
    const c = cum[id] || {};
    a.budToToday += c.budToToday || 0; a.actToToday += c.actToToday || 0;
    a.budMonth += c.budMonth || 0; a.actMonth += c.actMonth || 0;
    a.costToToday += c.costToToday || 0; a.laborToToday += c.laborToToday || 0;
    a.daysPassed = Math.max(a.daysPassed, c.daysPassed || 0);
  });
  return a;
}
const AGG = aggOf(CUM, ['F01', 'F04-K', 'F04-P']);

console.log('[1] 合算の数字');
{
  ok(AGG.budMonth === 480000, '全店の月間予算 = 48万（30+10+8）', AGG.budMonth);
  ok(AGG.actToToday === 338000, '全店の実績（前日まで）= 33.8万', AGG.actToToday);
  ok(AGG.laborToToday === 93000, '全店の人件費 = 9.3万', AGG.laborToToday);
  const h = e.render(STORES, CUM, AGG, true, 30, '当月');
  ok(h.indexOf('$480,000') >= 0, '予算合計が画面に出る');
  ok(h.indexOf('$338,000') >= 0, '実績合計が画面に出る');
  ok(h.indexOf('$93,000') >= 0, '人件費の金額も出る');
  ok(/3店/.test(h), '対象店舗数が出る');
}

console.log('\n[2] 人件費率・原価率');
{
  /* 93000 / 338000 = 27.51% */
  ok(e.labor(AGG, 338000) === 27.5, '全店 人件費率 27.5%', e.labor(AGG, 338000));
  /* 101400 / 338000 = 30.0% */
  ok(e.fc(AGG, 338000) === 30, '全店 原価率 30.0%', e.fc(AGG, 338000));
  const h = e.render(STORES, CUM, AGG, true, 30, '当月');
  ok(/27\.5%/.test(h), '人件費率が画面に出る');
  ok(/30\.0%/.test(h), '原価率が画面に出る');
  ok(/57\.5%/.test(h), '合計（人件費＋原価）も出る');
  ok(/人件費率/.test(h) && /原価率/.test(h), 'それぞれの見出しが出る');
  /* 売上0では割らない */
  ok(e.labor(AGG, 0) === null && e.fc(AGG, 0) === null, '売上0のときは率を出さない（0除算しない）');
  ok(e.labor({ laborToToday: 0 }, 100) === 0, '人件費0なら0%');
}

console.log('\n[3] 店舗別カードと食い違わない');
{
  /* 店舗別カードは act で割っている。合算も同じ分母を使っているか */
  const per = src.slice(src.indexOf('var fc = act>0'), src.indexOf('var fc = act>0') + 260);
  ok(/costToToday\|\|0\)\/act/.test(per), '店舗別は costToToday / act');
  ok(/laborToToday\|\|0\)\/act/.test(per), '店舗別は laborToToday / act');
  ok(/laborToToday\|\|0\)\/refAct/.test(grab(src, '_bAggLaborPct')), '合算も laborToToday / 売上');
  ok(/costToToday\|\|0\)\/refAct/.test(grab(src, '_bAggFcPct')), '合算も costToToday / 売上');
  /* 各店の率を金額加重で合成すると合算と一致するはず */
  const sumLab = ['F01', 'F04-K', 'F04-P'].reduce(function (a, id) { return a + CUM[id].laborToToday; }, 0);
  const sumAct = ['F01', 'F04-K', 'F04-P'].reduce(function (a, id) { return a + CUM[id].actToToday; }, 0);
  ok(Math.round(sumLab / sumAct * 1000) / 10 === e.labor(AGG, 338000), '店舗別の金額を足した率と一致する', [sumLab / sumAct, e.labor(AGG, 338000)]);
  /* ％の単純平均とは違う（大きい店が正しく効く） */
  const avg = ['F01', 'F04-K', 'F04-P'].reduce(function (a, id) { return a + CUM[id].laborToToday / CUM[id].actToToday * 100; }, 0) / 3;
  ok(Math.round(avg * 10) / 10 !== e.labor(AGG, 338000), '％の単純平均は使っていない', [Math.round(avg * 10) / 10, e.labor(AGG, 338000)]);
}

console.log('\n[4] 当月と過去月で分母が変わる');
{
  const hCur = e.render(STORES, CUM, AGG, true, 30, '当月');
  ok(/前日まで/.test(hCur), '当月は「前日まで」と明示');
  ok(/20\/30日/.test(hCur), '経過日数が出る');
  ok(/着地予測/.test(hCur), '当月は着地予測が出る');
  const hPast = e.render(STORES, CUM, AGG, false, 31, '7月');
  ok(/月間確定/.test(hPast), '過去月は「月間確定」と明示');
  ok(!/着地予測/.test(hPast), '過去月に着地予測は出さない');
  /* 過去月は actMonth を使う */
  ok(hPast.indexOf('$495,000') >= 0, '過去月は月間実績49.5万で表示', AGG.actMonth);
  ok(/どちらの分母か/.test(hCur) === false && /分母は売上/.test(hCur), '分母が何かを画面に書いている');
}

console.log('\n[5] 予算未登録の店');
{
  const cum2 = JSON.parse(JSON.stringify(CUM));
  cum2['F04-P'].budMonth = 0;
  const agg2 = aggOf(cum2, ['F01', 'F04-K', 'F04-P']);
  const h = e.render(STORES, cum2, agg2, true, 30, '当月');
  ok(/未登録/.test(h), '未登録があると警告が出る');
  ok(/Piikoi/.test(h), 'どの店か名前が出る');
  ok(/高く出ます/.test(h), '達成率が高く出ることを伝える');
  ok(agg2.budMonth === 400000, '未登録店は予算0として合算される', agg2.budMonth);
  /* 全店に予算があれば警告は出ない */
  ok(!/未登録/.test(e.render(STORES, CUM, AGG, true, 30, '当月')), '全店登録済みなら警告は出ない');
}

console.log('\n[6] 壊れた入力');
{
  ok(typeof e.render([], {}, { budMonth: 0, actToToday: 0, daysPassed: 0 }, true, 30, '当月') === 'string', '店舗0でも落ちない');
  const h = e.render(STORES, {}, { budMonth: 0, actToToday: 0, actMonth: 0, costToToday: 0, laborToToday: 0, daysPassed: 0 }, true, 30, '当月');
  ok(h.indexOf('—') >= 0, 'データが無ければ「—」を出す（0%とは書かない）');
  ok(/未登録/.test(h), '予算が無いことは伝える');
  ok(typeof e.render(STORES, CUM, AGG, true, 0, '当月') === 'string', '日数0でも落ちない');
  e.lang('en');
  ok(/All stores/.test(e.render(STORES, CUM, AGG, true, 30, 'This month')), '英語表示にも対応');
  e.lang('ja');
}

console.log('\n[7] 既存への影響');
{
  ok(prev.indexOf('renderBudgetAllStoreAgg') < 0, 'v801 には無かった');
  ok(grab(src, 'renderBudgetSummaryStores') === grab(prev, 'renderBudgetSummaryStores'), '店舗別カードは1文字も変えていない');
  ok(grab(src, 'cumulativeToToday') === grab(prev, 'cumulativeToToday'), '集計コアも変えていない');
  ok(!/lsSet\(/.test(grab(src, 'renderBudgetAllStoreAgg')), '合算カードは何も保存しない');
  /* 単店のときは合算カードを出さない（同じ数字が2枚並ばないように） */
  const sum = grab(src, 'renderBudgetSummary');
  ok(/if \(stores\.length > 1\)/.test(sum), '複数店のときだけ出す');
  const idx1 = sum.indexOf('renderBudgetAllStoreAgg'), idx2 = sum.indexOf('renderBudgetSummaryStores(');
  ok(idx1 > 0 && idx2 > idx1, '合算カードが店舗別カードより先に出る', { idx1, idx2 });
  ok(sum.indexOf('renderBudgetAllStoreAgg') === sum.lastIndexOf('renderBudgetAllStoreAgg'), '合算カードは1回だけ');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
