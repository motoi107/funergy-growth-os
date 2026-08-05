/* verify_v868.js — 月初MTGの年間KPI表で、目標だけシステムの設定が届いていなかった

   Motoさん報告：会議の年間KPI推移で、売上目標が予算設定と合わず（$130,050 vs $132,090）、
   リピート率・ドリンク比率も KPI管理と合わない（62.5% vs 60% / 31.5% vs 30%）。

   原因。_meetYearMatrix の cellV() が値を決める順番はこうだった。
     ① 手編集
     ② Excel取込のシード（MEETING_KGI_SEED）← ここで必ず止まる
     ③ 実績だけ liveA() でライブ値
     ④ 目標は null
   シードには12か月ぶん目標が入っているため、7月以降もExcelの数字が勝ち続け、
   予算設定も KPI管理も画面に届いていなかった。
   実績行は liveA を見ていたので「実績だけ本物・目標だけExcel」の状態だった。
   画面の説明文には「1〜6月＝Excel取込／7月〜＝ライブ値」と書かれており、
   設計の意図どおりに動いていなかった。

   Motoさん確認済み（A案）＝6月までExcel、7月以降はシステムの数字。
   1〜6月の会議記録の数字は動かさない。
   ライブ値の無いKPI（Googleレビュー）は今までどおりシードで埋める。

   ★ 目標は中間MTGと同じ keyKpiStats の値を使う。2つの会議で同じ数字になる。
   ★ 切替月は年込み（'2026-06'）で持つ。月だけで判定すると、来年の表に
     今年のExcelの数字がそのまま出てしまう。

   守るのは6つ。
   ① 6月以前はExcelのまま
   ② 7月以降は予算設定・KPI管理の値が出る
   ③ ライブ値の無いKPIは空欄にせずシードで埋める
   ④ 手編集はこれまでどおり最優先
   ⑤ 年をまたぐとシードを使わない
   ⑥ liveA・中間MTG・v867 の売上予算を1バイトも変えていない */
const fs = require('fs');
const _cur = fs.readFileSync('index.html', 'utf8');
const src = fs.existsSync('index_v868_backup.html')
  ? fs.readFileSync('index_v868_backup.html', 'utf8') : _cur;
const prev = fs.readFileSync('index_v867_backup.html', 'utf8');
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

const SEED = JSON.parse(src.match(/var MEETING_KGI_SEED = (\{[\s\S]*?\});\r\n/)[1]);
const BODY = grab(src, '_meetYearMatrix');
const CELL = BODY.slice(BODY.indexOf('  function liveT('), BODY.indexOf('function isEdited'));

/* 予算設定 $132,090 / KPI管理 リピート60% ドリンク30% を積んだライブ値 */
const LIVE = { budget: 132090, guestBudget: 2550, ppaBudget: 51.8, repeatTgt: 60, drinkTgt: 30,
               fcBudgetRate: 24, laborBudgetRate: 30, misoTgt: 40, ikuraTgt: 15, opDays: 31 };
function mk(o) {
  o = o || {};
  return new Function('CFG', `
    var MEETING_KGI_SEED_UNTIL = CFG.until;
    var sid = CFG.sid, seed = CFG.seed, edits = CFG.edits || {}, isB = !!CFG.isB, store = { id: CFG.sid };
    function daysOfYm(){ return []; }
    function keyKpiStats(){ return CFG.live; }
    function liveA(kk, ym, off){ return CFG.actual ? CFG.actual[kk] : null; }
    ${CELL}
    return cellV;
  `)({ until: (src.match(/MEETING_KGI_SEED_UNTIL = '([^']+)'/) || [])[1],
       sid: o.sid || 'F01', seed: SEED[o.sid || 'F01'], edits: o.edits, isB: o.isB,
       live: o.live === undefined ? LIVE : o.live, actual: o.actual });
}

console.log('\n[1] 切替月の持ち方');
{
  const u = (src.match(/MEETING_KGI_SEED_UNTIL = '([^']+)'/) || [])[1];
  ok(u === '2026-06', '切替月は 2026-06（年込みで持つ）', u);
  ok(/if\(ym > MEETING_KGI_SEED_UNTIL\)/.test(code(src, '_meetYearMatrix')), '月の比較で切り替えている');
}

console.log('\n[2] ① 6月以前はExcelのまま');
{
  const c = mk();
  ok(c('sales', 't', 5, -3, '2026-05') === 123675, '5月の売上目標はExcelの 123,675', c('sales','t',5,-3,'2026-05'));
  ok(c('repeat', 't', 5, -3, '2026-05') === 62.5, '5月のリピート率はExcelの 62.5%');
  ok(c('drink', 't', 5, -3, '2026-05') === 31.5, '5月のドリンク比率はExcelの 31.5%');
  ok(c('sales', 't', 6, -2, '2026-06') === 129285, '6月もExcelのまま（境目）', c('sales','t',6,-2,'2026-06'));
}

console.log('\n[3] ② 7月以降はシステムの数字');
{
  const c = mk();
  ok(c('sales', 't', 8, 0, '2026-08') === 132090, '8月の売上目標が予算設定の 132,090', c('sales','t',8,0,'2026-08'));
  ok(c('repeat', 't', 8, 0, '2026-08') === 60, '8月のリピート率が KPI管理の 60%', c('repeat','t',8,0,'2026-08'));
  ok(c('drink', 't', 8, 0, '2026-08') === 30, '8月のドリンク比率が KPI管理の 30%', c('drink','t',8,0,'2026-08'));
  ok(c('sales', 't', 7, -1, '2026-07') === 132090, '7月から切り替わる（境目）', c('sales','t',7,-1,'2026-07'));
  ok(c('ppa', 't', 8, 0, '2026-08') === 51.8, '客単価目標もライブ');
  ok(c('guests', 't', 8, 0, '2026-08') === 2550, '集客目標もライブ');
  ok(c('fc', 't', 8, 0, '2026-08') === 24, '原価率目標もライブ');
  ok(c('labor', 't', 8, 0, '2026-08') === 30, '人件費率目標もライブ');
  ok(c('sales', 't', 12, 4, '2026-12') === 132090, '先の月（12月）もライブを見る');
  /* 丼の店は日別平均に直す（実績と同じ土俵） */
  const cb = mk({ isB: true, sid: 'F04-K' });
  ok(cb('guests', 't', 8, 0, '2026-08') === Math.round(2550 / 31), '丼の店は日別平均に直す', cb('guests','t',8,0,'2026-08'));
}

console.log('\n[4] ③ ライブが無いときは空欄にしない');
{
  const c = mk();
  ok(c('google', 't', 8, 0, '2026-08') === 4.4, 'Googleレビュー目標はシードで埋める（ライブ値が無い）', c('google','t',8,0,'2026-08'));
  /* 予算が未登録の月はシードに戻す（画面が「—」で埋まらないように） */
  const c0 = mk({ live: { budget: 0, repeatTgt: null, drinkTgt: null } });
  ok(c0('sales', 't', 9, 1, '2026-09') === 122400, '予算が未登録ならシードに戻る', c0('sales','t',9,1,'2026-09'));
  const cn = mk({ live: null });
  ok(cn('sales', 't', 8, 0, '2026-08') === 130050, '集計が取れなくてもシードに戻る（画面が壊れない）');
}

console.log('\n[5] ④⑤ 手編集と年またぎ');
{
  const ce = mk({ edits: { F01: { sales: { t8: 999999 } } } });
  ok(ce('sales', 't', 8, 0, '2026-08') === 999999, '手編集が最優先（7月以降でも）');
  const ce2 = mk({ edits: { F01: { sales: { t5: 888888 } } } });
  ok(ce2('sales', 't', 5, -3, '2026-05') === 888888, '手編集は6月以前でも最優先');
  /* 年をまたぐとシードを使わない */
  const c = mk();
  ok(c('sales', 't', 3, 7, '2027-03') === 132090, '2027年3月はライブ（去年のExcelを使い回さない）', c('sales','t',3,7,'2027-03'));
  ok(c('repeat', 't', 3, 7, '2027-03') === 60, '2027年もKPI管理の値');
}

console.log('\n[6] 実績行');
{
  const c = mk({ actual: { sales: 129252 } });
  ok(c('sales', 'a', 8, 0, '2026-08') === 129252, '7月以降の実績はライブ');
  ok(c('sales', 'a', 5, -3, '2026-05') === 120538.41, '6月以前の実績はExcelのまま', c('sales','a',5,-3,'2026-05'));
  /* シードに7月以降の実績が入っていないこと（入っていると切替の意味が消える） */
  let leftover = [];
  Object.keys(SEED).forEach(function (sid) {
    Object.keys(SEED[sid]).forEach(function (k) {
      (SEED[sid][k].a || []).forEach(function (v, i) { if (i >= 6 && v != null) leftover.push(sid + '/' + k + '/' + (i + 1) + '月'); });
    });
  });
  ok(leftover.length === 0, 'シードに7月以降の実績が残っていない', leftover.slice(0, 5));
}

console.log('\n[7] 触っていないもの');
{
  ok(/function liveA\(kk, ym, off\)\{ if\(off>0\) return null;/.test(src), 'liveA の中身を変えていない');
  ok(unchangedIn('_meetKpiRows'), '中間MTGのKPI行を1バイトも変えていない');
  ok(unchangedIn('_meetJudge'), '達成判定を1バイトも変えていない');
  ok(unchangedIn('monthSalesBudget'), 'v867 の売上予算を1バイトも変えていない');
  ok(unchangedIn('keyKpiStats'), 'keyKpiStats を1バイトも変えていない');
  ok(unchangedIn('getStoreKpiTargets'), 'KPI管理の読み出しを1バイトも変えていない');
  ok(unchangedIn('getKgiEdits'), '手編集の保存を1バイトも変えていない');
  ok(src.indexOf('var MEETING_KGI_SEED = ') >= 0 &&
     src.match(/var MEETING_KGI_SEED = (\{[\s\S]*?\});\r\n/)[1] ===
     prev.match(/var MEETING_KGI_SEED = (\{[\s\S]*?\});\r\n/)[1],
    'Excelのシードそのものを1バイトも変えていない');
  /* 目標は中間MTGと同じ keyKpiStats の値を見ている */
  const lt = code(src, '_meetYearMatrix');
  ok(/case 'sales': return k\.budget/.test(lt) && /case 'repeat': return k\.repeatTgt/.test(lt),
    '目標は中間MTGと同じ項目から取っている');
}

console.log('\n[8] ビルド');
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
