/* verify_v835.js — Remind 済み（reminded_）
   その週のシフト提出をまだしていない人のうち、誰に催促を送ったかの名前一覧。
   合流ルールが無く「丸ごと上書き」だった。
   このキーは _LS_PRUNABLE に入っており、容量逼迫で端末から丸ごと消える。
   消えた端末が1人に催促を送ると、その1人だけの一覧が押し上がり、
   他の人の「Remind済」表示が消える＝同じ人にまた催促が飛ぶ。

   守るのは5つ。
   ① 別の端末で送った催促の記録が消えない（名前の和集合）
   ② remindAll で置き換えても、すでに送った人を落とさない
   ③ 空や重複で壊れない
   ④ 少ない側で押し上げない
   ⑤ 画面が受け取る形は今までと同じ（名前の配列） */
const fs = require('fs');
const _cur = fs.readFileSync('index.html', 'utf8');
const src = fs.existsSync('index_v835_backup.html')
  ? fs.readFileSync('index_v835_backup.html', 'utf8') : _cur;
const prev = fs.readFileSync('index_v834_backup.html', 'utf8');
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

const FN = ['getReminded', 'mergeRemindedNames', '_coversRemindedNames', 'saveReminded'];
function env() {
  return new Function('__store', `
    function ls(k, d){ return (k in __store) ? JSON.parse(JSON.stringify(__store[k])) : d; }
    function lsSet(k, v){ __store[k] = JSON.parse(JSON.stringify(v)); return true; }
    ${FN.map(n => grab(src, n)).join('\n')}
    return { ${FN.map(n => n + ':' + n).join(',')}, store:__store };
  `)({});
}
const K = 'reminded_F01_2026-W32';
const W = '2026-W32';

console.log('[1] 容量整理で消えた端末が1人に送っても、他の記録が消えない');
{
  const A = env(); A.saveReminded('F01', W, ['Taro', 'Hanae', 'Ken']);
  const B = env(); B.saveReminded('F01', W, ['Jun']);        /* 消えた端末から1人だけ */
  const m = A.mergeRemindedNames(A.store[K], B.store[K]);
  ok(m.length === 4, '4人ぶんになる（丸ごと上書きなら1人に置き換わっていた）', m);
  ok(m.indexOf('Taro') >= 0 && m.indexOf('Jun') >= 0, '古い記録も新しい記録も残る');
  ok(A.mergeRemindedNames(B.store[K], A.store[K]).length === 4, '押し上げの順番が逆でも同じ');
}

console.log('\n[2] remindAll で置き換えても、すでに送った人を落とさない');
{
  const A = env();
  A.saveReminded('F01', W, ['Taro', 'Hanae']);              /* 個別に送った */
  A.saveReminded('F01', W, ['Ken', 'Jun']);                 /* そのあと「全員Remind」 */
  const r = A.getReminded('F01', W);
  ok(r.length === 4, '前に送った人が残る（落とすと同じ人にまた催促が飛ぶ）', r);
  ok(r.indexOf('Taro') >= 0 && r.indexOf('Ken') >= 0, '両方の回のぶんが入っている');
}

console.log('\n[3] 空や重複で壊れない');
{
  const A = env();
  A.saveReminded('F01', W, ['Taro']);
  A.saveReminded('F01', W, ['Taro']);
  ok(A.getReminded('F01', W).length === 1, '同じ人を二重に持たない');
  ok(A.mergeRemindedNames([], ['Taro']).length === 1, '片方が空でも動く');
  ok(A.mergeRemindedNames(['Taro'], []).length === 1, '逆向きも同じ');
  ok(A.mergeRemindedNames(null, null).length === 0, '両方無くても落ちない');
  ok(A.mergeRemindedNames(['Taro', '', null], ['Taro']).length === 1, '空の名前は入れない');
  ok(A.getReminded('F02', W).length === 0, '未設定の週は空で返る');
}

console.log('\n[4] covers：少ない側で押し上げない');
{
  const A = env();
  ok(A._coversRemindedNames(['Taro', 'Hanae'], ['Taro']) === true, '全部持っていればカバーできている');
  ok(A._coversRemindedNames(['Taro'], ['Taro', 'Hanae']) === false, '足りなければ押し上げを止める');
  ok(A._coversRemindedNames([], ['Taro']) === false, '空では押し上げられない');
  ok(A._coversRemindedNames(['Taro'], []) === true, '相手が空なら止めない');
}

console.log('\n[5] 画面が受け取る形と保存側');
{
  const A = env(); A.saveReminded('F01', W, ['Taro']);
  const r = A.getReminded('F01', W);
  ok(Array.isArray(r) && typeof r[0] === 'string', '名前の配列のまま', r);
  ok(r.includes('Taro'), 'includes() で判定できる（画面の書き方を変えなくてよい）');

  ok((src.match(/ls\('reminded_/g) || []).length === 1, "ls('reminded_… は getReminded の中だけ");
  ok((src.match(/lsSet\('reminded_/g) || []).length === 1, "lsSet('reminded_… は saveReminded の中だけ");
  ok(/saveReminded\(/.test(grab(src, 'remindOne')), '個別Remind は出口を通る');
  ok(/saveReminded\(/.test(grab(src, 'remindAll')), '全員Remind も出口を通る');

  const MP = require('./merge_probe.js');
  const p = MP.buildProbe(src);
  ok(p.ruleFor('reminded_').name === 'mergeRemindedNames', '実 _opMergeDef が合流ルールを返す');
  ok(MP.buildProbe(prev).ruleFor('reminded_').name === null, '（参考）v834 までは無かった');
}

console.log('\n[6] 残りはいくつか');
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
  console.log('     ' + (missing.join('  ') || '（なし）'));
  ok(missing.indexOf('reminded_') < 0, 'Remind 済みは塞いだ');
  ok(missing.length === missB.length - 1, '1つだけ減った', { v834: missB.length, v835: missing.length });
  ok(missing.length === 1 && missing[0] === 'labor_hours_',
    '残るのは死んでいる labor_hours_ だけ（塞ぐのではなく外すか消すかを Moto さんに確認）', missing);
}

console.log('\n[7] ビルドの性質と既存への影響');
{
  const av = (src.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
  const pv = (prev.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
  ok(av && pv && Number(av) === Number(pv) + 1, '前版より1つだけ進んでいる', { prev: pv, now: av });
  if (src === _cur) {
    const sw = (fs.readFileSync('sw.js', 'utf8').match(/SW_BUILD\s*=\s*'(\d+)'/) || [])[1];
    ok(av === sw, 'APP_VERSION と SW_BUILD が揃っている');
  } else ok(true, 'SW_BUILD は現行版の検証で見る');

  /* 読み手2か所はアクセサ呼び出しに差し替えた。中身が1行だけの入れ替えであることを確かめる */
  ['renderShiftStatus', 'renderShiftStaff'].forEach(function (n) {
    const now = grab(src, n), old = grab(prev, n);
    ok(now.replace('getReminded(storeId, week)', "ls('reminded_'+storeId+'_'+week, [])") === old,
      n + ' はアクセサ呼び出しへの差し替えだけ');
  });
  ['mergeMenuMix', 'mergeDailyOps', 'mergeWarnings',
   '_opMergeDef', 'saveOrders', 'getMenuMix', 'maybePullStaffShift'
  ].forEach(function (n) { ok(unchangedIn(n), n + ' を変えていない'); });

  ok(src.indexOf('\u8f96') < 0, '簡体字の誤字が入っていない');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
