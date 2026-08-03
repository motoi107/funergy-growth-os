/* verify_v833.js — 日次オペレーション（dailyops_）を1項目ごとに保存する
   同じ接頭辞で3つの入れ物がある。
     dailyops_template_<店>  … 各店で作り込んだチェックリストの中身（手入力・再入力が重い）
     dailyops_<店>_<日付>    … その日のチェック状態
     dailyops_complete_<店>  … 完了記録（追記のみ）
   どれも合流ルールが無く「丸ごと上書き」だった。
   さらにテンプレートの削除は配列から物理的に抜いていたため、
   削除前の写しを持った端末から項目が復活していた。

   守るのは7つ。
   ① 2台で別々の項目を足しても、どちらも残る
   ② テンプレートの削除が伝わり、持っている端末から復活しない
   ③ テンプレートを読むと印が落ちていて、削除済みは出ない（画面もその日の分も今までと同じ形）
   ④ 2人が別の項目にチェックしても、どちらのチェックも残る
   ⑤ 完了記録は id が無くても重複しない
   ⑥ 少ない側で押し上げない
   ⑦ テンプレートは app_settings 経由でも同じルールが効く */
const fs = require('fs');
const _cur = fs.readFileSync('index.html', 'utf8');
const src = fs.existsSync('index_v833_backup.html')
  ? fs.readFileSync('index_v833_backup.html', 'utf8') : _cur;
const prev = fs.readFileSync('index_v832_backup.html', 'utf8');
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
function unchangedIn(name) {
  try { return grab(src, name) === grab(prev, name); } catch (e) { return false; }
}

const FN = ['_mutBare', '_stampListBy', '_doKey', 'mergeDailyOps', '_coversDailyOps', '_doSave',
            'getDailyOpsTemplateRaw', 'getDailyOpsTemplate', 'saveDailyOpsTemplate',
            'setDailyOpsTemplate', 'getDailyOps', 'setDailyOps'];
function env(who) {
  return new Function('__store', '__who', `
    var DEFAULT_DAILYOPS=[{id:'d1', phase:'Opening', text:'冷蔵庫の温度確認', required:true},
                          {id:'d2', phase:'Closing', text:'レジ締め', required:true}];
    function myName(){ return __who; }
    function todayJP(){ return '2026/08/02'; }
    function ls(k, d){ return (k in __store) ? JSON.parse(JSON.stringify(__store[k])) : d; }
    function lsSet(k, v){ __store[k] = JSON.parse(JSON.stringify(v)); return true; }
    var console={warn:function(){}};
    ${FN.map(n => grab(src, n)).join('\n')}
    return { ${FN.map(n => n + ':' + n).join(',')}, store:__store };
  `)({}, who || 'Moto');
}
const TK = 'dailyops_template_F01';
const DK = 'dailyops_F01_2026/08/02';
const CK = 'dailyops_complete_F01';
const IT = (id, text, phase) => ({ id: id, phase: phase || 'Opening', text: text, required: true });

console.log('[1] 2台で別々の項目を足しても、どちらも残る');
{
  const A = env('店長');
  A.saveDailyOpsTemplate('F01', A.getDailyOpsTemplate('F01').concat([IT('do1', 'グリスト清掃')]));
  const B = env('Yuki');
  B.saveDailyOpsTemplate('F01', B.getDailyOpsTemplate('F01').concat([IT('do2', '換気扇チェック')]));
  const m = A.mergeDailyOps(A.store[TK], B.store[TK]);
  const V = env(); V.store[TK] = m;
  const seen = V.getDailyOpsTemplate('F01');
  ok(seen.length === 4, '既定2件＋各端末が足した1件ずつ＝4件', seen.map(x => x.id));
  ok(seen.some(x => x.id === 'do1') && seen.some(x => x.id === 'do2'), '両方の項目が残る');
  ok(A.mergeDailyOps(B.store[TK], A.store[TK]).length === 4, '押し上げの順番が逆でも同じ');
}

console.log('\n[2] テンプレートの削除は記録として残り、復活しない');
{
  const A = env('店長');
  A.saveDailyOpsTemplate('F01', A.getDailyOpsTemplate('F01').concat([IT('do1', 'グリスト清掃')]));
  const B = env('Yuki'); B.store[TK] = JSON.parse(JSON.stringify(A.store[TK]));
  /* 店長が do1 を削除（画面と同じ手順） */
  const raw = A.getDailyOpsTemplateRaw('F01');
  raw.forEach(function (x) { if (x.id === 'do1') x._deleted = true; });
  A.saveDailyOpsTemplate('F01', raw);
  A.store[TK].forEach(function (x) { if (x.id === 'do1') x._mut = 9e12; });

  const m = A.mergeDailyOps(B.store[TK], A.store[TK]);
  const V = env(); V.store[TK] = m;
  ok(!V.getDailyOpsTemplate('F01').some(x => x.id === 'do1'), '削除した項目は復活しない');
  ok(m.some(x => x.id === 'do1' && x._deleted), '削除したことは記録として残る');
  ok(V.getDailyOpsTemplate('F01').length === 2, '残りの項目は消えない');
  /* 消した記録を保存のたびに落としていないこと */
  A.saveDailyOpsTemplate('F01', A.getDailyOpsTemplate('F01'));
  ok(A.getDailyOpsTemplateRaw('F01').some(x => x.id === 'do1' && x._deleted),
    '別の保存をしても、消した記録が落ちない（落とすと復活する）');
}

console.log('\n[3] 読むときの形');
{
  const A = env('店長');
  ok(A.getDailyOpsTemplate('F01').length === 2, '未設定の店は既定のテンプレートが返る');
  A.saveDailyOpsTemplate('F01', A.getDailyOpsTemplate('F01').concat([IT('do9', '製氷機の清掃')]));
  const t = A.getDailyOpsTemplate('F01').find(x => x.id === 'do9');
  ok(!('_mut' in t) && !('_deleted' in t) && !('_by' in t), '印は画面へ渡さない', Object.keys(t));
  ok(t.text && t.phase && t.required === true, '中身は今までどおり', t);
  const rawNew = A.getDailyOpsTemplateRaw('F01').find(x => x.id === 'do9');
  ok(Number(rawNew._mut) > 0, '保存側には印が付いている');
  ok(rawNew._by === '店長', '保存者も残る');
  /* その日のチェック状態にも印が紛れ込まない */
  const day = A.getDailyOps('F01');
  ok(!('_mut' in day[0]), 'その日の分にもテンプレートの印が混ざらない', Object.keys(day[0]));
  ok(day[0].done === false && day[0].by === '', '未完で作られる');
}

console.log('\n[4] 2人が別の項目にチェックしても、どちらも残る');
{
  const base = env('店長');
  base.setDailyOps('F01', base.getDailyOps('F01'));
  const A = env('店長'); A.store[DK] = JSON.parse(JSON.stringify(base.store[DK]));
  const B = env('Yuki'); B.store[DK] = JSON.parse(JSON.stringify(base.store[DK]));
  var la = A.getDailyOps('F01'); la[0].done = true; la[0].by = '店長'; A.setDailyOps('F01', la);
  var lb = B.getDailyOps('F01'); lb[1].done = true; lb[1].by = 'Yuki'; B.setDailyOps('F01', lb);

  const m = A.mergeDailyOps(A.store[DK], B.store[DK]);
  const d1 = m.find(x => x.id === 'd1'), d2 = m.find(x => x.id === 'd2');
  ok(d1 && d1.done === true && d1.by === '店長', '店長のチェックが残る', d1);
  ok(d2 && d2.done === true && d2.by === 'Yuki', 'Yuki のチェックも残る（丸ごと上書きなら片方が消えていた）', d2);
}

console.log('\n[4b] 保存のたびに全項目の時刻を進めない（進めると結局「全部上書き」に戻る）');
{
  const A = env('店長');
  A.setDailyOps('F01', A.getDailyOps('F01'));
  const before = A.store[DK].map(x => x._mut);
  var l = A.getDailyOps('F01'); l[0].done = true; l[0].by = '店長'; A.setDailyOps('F01', l);
  const after = A.store[DK].map(x => x._mut);
  ok(after[0] > before[0], 'チェックした項目の時刻は進む', { before: before[0], after: after[0] });
  ok(after[1] === before[1], '触っていない項目の時刻は据え置き', { before: before[1], after: after[1] });
}

console.log('\n[5] 完了記録は id が無くても重複しない');
{
  const A = env('店長'), B = env('Yuki');
  const rec = { date: '2026/08/02 22:10', by: '店長', count: 12 };
  ok(A._doKey(rec) === B._doKey(rec), '同じ中身なら、どの端末でも同じ鍵になる', A._doKey(rec));
  A._doSave(CK, [rec], []);
  B._doSave(CK, [JSON.parse(JSON.stringify(rec))], []);
  ok(A.mergeDailyOps(A.store[CK], B.store[CK]).length === 1, '同じ完了記録は1件のまま');
  const other = { date: '2026/08/03 22:30', by: 'Yuki', count: 12 };
  B._doSave(CK, B.store[CK].concat([other]), B.store[CK]);
  ok(A.mergeDailyOps(A.store[CK], B.store[CK]).length === 2, '別の完了記録は足される');
}

console.log('\n[6] covers：少ない側で押し上げない');
{
  const A = env('店長');
  A.saveDailyOpsTemplate('F01', A.getDailyOpsTemplate('F01').concat([IT('do1', 'グリスト清掃')]));
  const full = A.store[TK], part = [full[0]];
  ok(A._coversDailyOps(full, part) === true, '全部持っていれば部分をカバーできている');
  ok(A._coversDailyOps(part, full) === false, '部分しか持っていなければ押し上げを止める');
  ok(A._coversDailyOps([], full) === false, '空では押し上げられない');
  ok(A._coversDailyOps(full, []) === true, '相手が空なら止めない');
}

console.log('\n[7] 読み書きの集約と登録');
{
  ok((src.match(/lsSet\('dailyops_/g) || []).length === 0, "lsSet('dailyops_… が直接書かれている場所は無い");
  const del = grab(src, 'deleteDailyOpTemplate');
  ok(/_deleted\s*=\s*true/.test(del) && /saveDailyOpsTemplate\(/.test(del), '削除は記録として残す');
  ok(!/\.filter\(x=>x\.id!==id\)/.test(del), '物理削除が残っていない');
  ok(/confirm\(/.test(del), '確認ダイアログはそのまま');
  ok(/return saveDailyOpsTemplate\(/.test(grab(src, 'setDailyOpsTemplate')),
    '旧名 setDailyOpsTemplate も保存の出口へ寄せてある');
  ok(/_doSave\(/.test(grab(src, 'setDailyOps')), 'その日の分も出口を通る');
  ok(/_doSave\(/.test(grab(src, 'completeDailyOps')), '完了記録も出口を通る');

  const MP = require('./merge_probe.js');
  const p = MP.buildProbe(src);
  ok(p.ruleFor('dailyops_').name === 'mergeDailyOps', '実 _opMergeDef が合流ルールを返す');
  ok(!!p.def('dailyops_template_F01') && !!p.def('dailyops_complete_F01') && !!p.def('dailyops_F01_2026/08/02'),
    '3つの入れ物すべてに効く');
  ok(MP.buildProbe(prev).ruleFor('dailyops_').name === null, '（参考）v832 までは無かった');
  /* テンプレートは app_settings 経由。そちらも _opMergeDef を見ていることを確認 */
  ok(/isSetting[\s\S]{0,200}_opMergeDef\(key\)[\s\S]{0,80}app_settings/.test(src),
    '設定側の押し上げも合流ルールを通る（テンプレートが守られる根拠）');
}

console.log('\n[8] 同じ穴が他に何個あるか（見えるようにしておく）');
{
  const MP = require('./merge_probe.js');
  function uncoveredIn(text) {
    const q = MP.buildProbe(text);
    return q.syncPrefixes().filter(function (k) {
      if (MP.NOT_A_DATA_KEY.indexOf(k) >= 0) return false;
      return !q.ruleFor(k).name;
    });
  }
  const missing = uncoveredIn(src), missB = uncoveredIn(prev);
  console.log('     合流ルールが無いキー（丸ごと上書きされる）: ' + missing.length + ' 個');
  console.log('     ' + missing.join('  '));
  ok(missing.indexOf('dailyops_') < 0, '日次オペレーションは塞いだ');
  ok(missing.length === missB.length - 1, '1つだけ減った', { v832: missB.length, v833: missing.length });
}

console.log('\n[9] ビルドの性質と既存への影響');
{
  const av = (src.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
  const pv = (prev.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
  ok(av && pv && Number(av) === Number(pv) + 1, '前版より1つだけ進んでいる', { prev: pv, now: av });
  if (src === _cur) {
    const sw = (fs.readFileSync('sw.js', 'utf8').match(/SW_BUILD\s*=\s*'(\d+)'/) || [])[1];
    ok(av === sw, 'APP_VERSION と SW_BUILD が揃っている');
  } else ok(true, 'SW_BUILD は現行版の検証で見る');

  ['_stampListBy', '_mutBare', '_slId', 'mergeStampedList', 'mergeWarnings', 'mergeHelpRequests',
   '_opMergeDef', 'toggleDailyOp', 'renderDailyOps', 'saveDailyOp', 'copyStoreSetup',
   'saveOrders', 'getWarnings'
  ].forEach(function (n) { ok(unchangedIn(n), n + ' を変えていない'); });

  ok(src.indexOf('\u8f96') < 0, '簡体字の誤字が入っていない');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
