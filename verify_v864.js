/* verify_v864.js — Piikoi のシフト画面まわり4件

   Motoさん依頼：
     ① Main Plater → Plater の表記に
     ② L と D の間に常にちょうど真ん中で仕切り線を入れる（★SL/Close/Order の帯も割る）
     ③ 全画面で Fri 付近が見切れる。右端の週h まで一画面に収める
     ④ 公開後、各自のアカウントで見えるスケジュールをこの週間表にする

   ① は表示だけ。データ側のキー 'Main Plater' はスキル軸・ポジション定義・
   過去のシフトの cells キーとつながっているので絶対に変えない。
   p4PosLabel() を通すのは画面に出す瞬間だけ。

   ② 仕切りが真ん中に来ていなかったのは、L と D の div に flex 指定が無く
   中身の量で幅が決まっていたため（F01/F02 のビルダーには flex:1 が入っていた）。
   両方を flex:1 1 0 にして、帯も同じ位置で割る。

   ④ 週間表には総合点と Grade を出さない。本人以外のHR情報なので。
   同じ理由で並びも点数順にせず名前順にしている。

   守るのは7つ。
   ① 表示は Plater、データのキーは Main Plater のまま
   ② セルの左右が必ず半分ずつ（flex:1 1 0）
   ③ ★SL/Close/Order の帯も L/D に割れて、仕切りが下のセルと同じ位置に来る
   ④ 帯は「その人がその時間帯に入っている側」にだけ色が付く
   ⑤ 公開後の週間表が出て、点数と Grade が入っていない
   ⑥ 未公開なら週間表を出さない
   ⑦ 判定・自動振り分け・スキル計算を1バイトも変えていない */
const fs = require('fs');
const _cur = fs.readFileSync('index.html', 'utf8');
const src = fs.existsSync('index_v864_backup.html')
  ? fs.readFileSync('index_v864_backup.html', 'utf8') : _cur;
const prev = fs.readFileSync('index_v863_backup.html', 'utf8');
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

/* ---------- 画面まわりの環境 ---------- */
function uiEnv(F) {
  return new Function('F', `
    var DOW_SHIFT = ['日','月','火','水','木','金','土'];
    function DOW_SHIFT_EN(){ return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; }
    function weekDateForDow(d){ return '2026-08-' + String(9 + DOW_SHIFT.indexOf(d)).padStart(2,'0'); }
    function escapeHtml(s){ return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function t(ja, en){ return ja; }
    function getShiftPlan(){ return F.plan; }
    function _shiftPosTimeDef(){ return {}; }
    function skillScoreStore(n){ return { total: F.score[n] || 0 }; }
    ${grab(src, 'p4PosLabel')} ${grab(src, '_p4Mark')}
    ${grab(src, '_stTimeToMin')}
    ${grab(src, '_p4Def')} ${grab(src, '_p4Time')}
    ${grab(src, '_p4Assigned')} ${grab(src, 'p4DayMarks')}
    ${grab(src, '_p4Ro')} ${grab(src, 'p4StaffWeekHtml')}
    return { lab:p4PosLabel, mark:_p4Mark, week:p4StaffWeekHtml, asg:_p4Assigned };
  `)(F);
}
function baseF() {
  return {
    score: { 'Aoi': 27, 'Ken': 21, 'Mika': 19 },
    plan: {
      status: '公開済',
      cells: {
        /* Aoi は L も D も入っている / Ken は D だけ / Mika は L だけ */
        '日_Lunch_Host#1': 'Aoi', '日_Dinner_Main Plater#1': 'Aoi',
        '日_Dinner_Miso#1': 'Ken',
        '日_Lunch_Main Plater#2': 'Mika'
      },
      meta: {}
    }
  };
}

console.log('\n[1] ① 表示は Plater、データは Main Plater のまま');
{
  const E = uiEnv(baseF());
  ok(E.lab('Main Plater') === 'Plater', 'Main Plater は Plater と出る');
  ok(E.lab('Host') === 'Host' && E.lab('Miso') === 'Miso' && E.lab('Supporter') === 'Supporter',
    '他のポジションはそのまま');
  ok(E.lab(null) === '' && E.lab(undefined) === '', '空でも落ちない');
  /* データ側のキーは変えていない */
  ok(/var P4_POS_ALL=\['Host','Main Plater','Miso','Supporter'\]/.test(src),
    'P4_POS_ALL のキーは Main Plater のまま');
  ok(/const TOTOYA_SHIFT_POSITIONS = \['Host','Main Plater','Miso','Supporter'\]/.test(src),
    'TOTOYA_SHIFT_POSITIONS のキーも変えていない');
  ok(/'F04-P':\['Team Standards','Main Plater'/.test(src), 'Piikoi のスキル軸も変えていない');
  ok(/'Main Plater':\['未経験'/.test(src), 'スキル基準文の見出しキーも変えていない');
  /* 割当セルは表示だけ差し替わっている */
  ok(/escapeHtml\(p4PosLabel\(a\.pos\)\)/.test(code(src, '_p4Cell')), 'セルは p4PosLabel を通している');
  ok(/a\.pos/.test(code(src, '_p4Cell')) && !/pos:\s*p4PosLabel/.test(code(src, '_p4Cell')),
    '保存する値は差し替えていない');
}

console.log('\n[2] ② 仕切りが常にちょうど真ん中');
{
  const cell = code(src, '_p4Cell');
  const halves = (cell.match(/flex:1 1 0;min-width:0/g) || []).length;
  ok(halves === 3, 'セルの3パターン全部が半分ずつ（割当・空き・未割当）', halves);
  ok(!/style="cursor:pointer;padding:2px 3px;background:/.test(cell),
    '中身の量で幅が決まる書き方が残っていない');

  const E = uiEnv(baseF());
  /* 帯：入っている側だけ色が付き、両側とも同じ幅 */
  const on = E.mark('Close', 'var(--accent2)', true);
  const off = E.mark('Close', 'var(--accent2)', false);
  ok(/flex:1 1 0/.test(on) && /flex:1 1 0/.test(off), '帯の左右も半分ずつ');
  ok(/background:var\(--accent2\)/.test(on), '入っている側は色が付く');
  ok(/background:transparent/.test(off) && !/Close/.test(off), '入っていない側は色も文字も出さない');
  ok(/\u00a0/.test(off), '空側も高さが崩れないよう詰め物が入る');

  /* シフト作成画面の td：帯とセルで仕切りの位置が同じ */
  const row = code(src, 'renderShiftBuilderF04P');
  ok(/_p4Mark\(bTxt, bBg, !!dA\.Lunch\)/.test(row) && /_p4Mark\(bTxt, bBg, !!dA\.Dinner\)/.test(row),
    '帯を L と D に割っている');
  const divs = (row.match(/<div style="width:1px;background:var\(--border\)"><\/div>/g) || []).length;
  ok(divs === 2, '仕切り線は帯とセルで2本（同じ位置に縦に通る）', divs);
  ok(!/font-size:7.5px;font-weight:800;text-align:center;color:#fff;background:var\(--accent2\);line-height:1.5">Close<\/div>/.test(row),
    '全幅の帯が残っていない');
}

console.log('\n[3] ③ 一画面に収める');
{
  ok(/min-width:820px;width:100%;font-size:11px/.test(src), '表が幅いっぱいに伸びる（min 820px）');
  ok(!/min-width:900px;font-size:11px;border-collapse/.test(src), '900px の下限が残っていない');
  ok(/padding:3px 2px;min-width:92px/.test(src), '曜日の列を 92px に詰めた');
  ok(/z-index:2;min-width:112px">Staff<\/th>/.test(src), 'Staff 列を 112px に詰めた');
  ok(/body\.shift-wide \.main \{ max-width:1900px; \}/.test(src), 'この画面だけ幅制限を外す CSS がある');
  ok(/classList\.toggle\('shift-wide', page === 'shift_admin'\)/.test(src),
    'shift_admin のときだけ shift-wide が付く');
  /* 他の画面に影響していないこと */
  ok(/body\.md-wide \.main \{ max-width:1500px; \}/.test(src), '統合コンソールの幅指定はそのまま');
  /* 幅の見積り：Staff112 + 7×92 + 週h48 = 804 < 820 */
  ok(112 + 7 * 92 + 48 <= 820, '列の合計が表の下限に収まっている', 112 + 7 * 92 + 48);
}

console.log('\n[4] ④ 公開後の週間表');
{
  const E = uiEnv(baseF());
  const h = E.week('F04-P', '8/9', 'Ken');
  ok(!!h, '公開済みなら週間表が出る');
  ok(/Plater/.test(h) && !/Main Plater/.test(h), '表の中も Plater 表記');
  ok(/>Aoi</.test(h) && />Ken</.test(h) && />Mika</.test(h), '3人とも行が出る');
  ok(!/点/.test(h), '総合点を出していない');
  ok(!/G1|G2|G3|G4/.test(h), 'Grade を出していない');
  ok(h.indexOf('Aoi') < h.indexOf('Ken') && h.indexOf('Ken') < h.indexOf('Mika'),
    '並びは名前順（点数順にすると順位が漏れる）');
  ok(/#fdf1e8/.test(h), '自分の行だけ色が付く');
  ok(!/onclick/.test(h), '読み取り専用（タップで編集できない）');
  ok(/10:30–15:00|10:30\u201315:00/.test(h), 'ランチの既定時間が出る');
  ok(/16:30–22:00|16:30\u201322:00/.test(h), 'ディナーの既定時間が出る');

  /* 帯：Aoi が最上位なので ★SL。L も D も入っているので両側に付く */
  ok(/★SL/.test(h), '★SL の帯が出る');
  const aoiRow = h.slice(h.indexOf('>Aoi<'), h.indexOf('>Ken<'));
  ok((aoiRow.match(/★SL/g) || []).length === 2, 'L も D も入っている人は帯が両側に出る',
    (aoiRow.match(/★SL/g) || []).length);
  const kenRow = h.slice(h.indexOf('>Ken<'), h.indexOf('>Mika<'));
  ok((kenRow.match(/Close|Order/g) || []).length === 1, 'D だけの人は帯が片側だけ',
    (kenRow.match(/Close|Order/g) || []).length);

  /* 未公開なら出さない */
  const F2 = baseF(); F2.plan.status = '下書き';
  ok(uiEnv(F2).week('F04-P', '8/9', 'Ken') === '', '未公開なら何も出さない');
  const F3 = baseF(); F3.plan = { status: '公開済', cells: {}, meta: {} };
  ok(uiEnv(F3).week('F04-P', '8/9', 'Ken') === '', '割当が無ければ何も出さない');

  /* マイシフトから呼ばれている */
  ok(/storeId === 'F04-P'/.test(code(src, 'renderShiftStaff')) &&
     /p4StaffWeekHtml\(storeId, week, me\)/.test(code(src, 'renderShiftStaff')),
    'マイシフトが Piikoi のときに週間表を呼ぶ');
  ok(/公開シフト/.test(code(src, 'renderShiftStaff')), '今までの一覧（変更申請ボタン）も残っている');
}

console.log('\n[5] 触っていないもの');
{
  ok(unchangedIn('p4DayMarks'), 'p4DayMarks を1バイトも変えていない（★SL/Close/Order の決め方）');
  ok(unchangedIn('_p4Assigned'), '_p4Assigned を1バイトも変えていない');
  ok(unchangedIn('_p4Time'), '_p4Time を1バイトも変えていない');
  ok(unchangedIn('_p4Def'), '_p4Def を1バイトも変えていない');
  ok(unchangedIn('p4Positions'), 'p4Positions を1バイトも変えていない');
  ok(unchangedIn('p4LeaderCount'), 'p4LeaderCount を1バイトも変えていない');
  ok(unchangedIn('ldHead'), '曜日別の本数を1バイトも変えていない');
  ok(unchangedIn('mdSalesChartHtml'), 'v863 の売上グラフを1バイトも変えていない');
  ok(unchangedIn('mdStoreSeries'), 'mdStoreSeries を1バイトも変えていない');
}

console.log('\n[6] ビルド');
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
