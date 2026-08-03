/* verify_v825.js — 日次売上が消えた件の修正
   実際に起きたこと（2026-08-02 / Tenkichi のみ）:
     昨日まで見えていた 7/1〜7/18 が消えた。7/19以降は残っていた。
   構造:
     daily_actuals_<店舗> はクラウド同期対象なのに合流ルールが無く、
     コード内のコメントどおり「丸ごと上書き」されていた。
     ログイン時の自動同期は直近14日だけを見る（recentDays(14)）。
     14日ぶんしか持たない端末が押し上げると、クラウドの残りが消えて全端末に伝播する。

   守るのは4つ。
   ① 範囲外の日が消えない（和集合）
   ② 同じ日がぶつかったら、これまでと同じくローカルが勝つ（退行させない）
   ③ 中身のある売上を空で上書きしない
   ④ 同じ穴が他のキーにも空いていることを、見えるようにしておく */
const fs = require('fs');
const _cur = fs.readFileSync('index.html', 'utf8');
const src = fs.existsSync('index_v825_backup.html')
  ? fs.readFileSync('index_v825_backup.html', 'utf8') : _cur;
const prev = fs.readFileSync('index_v824_backup.html', 'utf8');
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
function grabIf(t, n) { try { return grab(t, n); } catch (e) { return ''; } }
function decl(text, name, o, c) {
  const a = text.search(new RegExp('(?:const|var)\\s+' + name + '\\s*=\\s*\\' + o));
  if (a < 0) throw new Error('not found: ' + name);
  let i = text.indexOf(o, a), d = 0, e = -1;
  for (let j = i; j < text.length; j++) { if (text[j] === o) d++; else if (text[j] === c) { d--; if (d === 0) { e = j; break; } } }
  return 'var ' + name + ' = ' + text.slice(i, e + 1) + ';';
}
const arrDecl = (t, n) => decl(t, n, '[', ']');
const objDecl = (t, n) => decl(t, n, '{', '}');
function unchangedIn(ver, fn) {
  const f = 'index_v' + ver + '_backup.html';
  if (!fs.existsSync(f)) return true;
  return grabIf(fs.readFileSync(f, 'utf8'), fn) === grabIf(prev, fn);
}

/* 実際に起きた形を再現する */
function july(fromDay, toDay) {
  const o = {};
  for (let d = fromDay; d <= toDay; d++) {
    o['2026-07-' + String(d).padStart(2, '0')] = { actual: 1000 + d, guests: 50 + d, toastSrc: true };
  }
  return o;
}

const E = new Function(`
  var LOG=[];
  var STORE={};
  function ls(k, def){ return (k in STORE) ? JSON.parse(JSON.stringify(STORE[k])) : def; }
  function lsSet(k, v){ STORE[k]=JSON.parse(JSON.stringify(v)); }
  var console={ warn:function(){ LOG.push(Array.prototype.slice.call(arguments).join(' ')); } };
  ${grab(src, '_recAt')}
  ${grab(src, 'mergeMapByTime')}
  ${grab(src, '_coversMapByTime')}
  ${grab(src, 'getDailyActuals')}
  ${grab(src, 'setDailyActuals')}
  return {
    merge: mergeMapByTime, covers: _coversMapByTime,
    get: getDailyActuals, set: setDailyActuals,
    put: function(k,v){ STORE[k]=v; }, raw: function(k){ return STORE[k]; },
    log: function(){ return LOG; }
  };
`)();

console.log('\n=== v825: 日次売上が消えた件 ===\n');

console.log('[1] 実際に起きた形を再現して、消えないことを確かめる');
{
  const cloud = july(1, 31);                 /* クラウドには7月全部があった */
  const partial = july(19, 31);              /* 直近14日ぶんしか持たない端末 */
  const merged = E.merge(cloud, partial);
  const days = Object.keys(merged).sort();
  ok(days.length === 31, '7月31日ぶんすべて残る（消えない）', days.length);
  ok(!!merged['2026-07-01'] && !!merged['2026-07-18'], '7/1〜7/18 が消えない');
  ok(merged['2026-07-01'].actual === 1001, '中身もそのまま');
  ok(!!merged['2026-07-31'], '新しい側の日も残る');

  /* 逆向き（クラウドが部分・ローカルが全部）でも消えない */
  const rev = E.merge(partial, cloud);
  ok(Object.keys(rev).length === 31, '向きが逆でも消えない', Object.keys(rev).length);
}

console.log('\n[2] 同じ日がぶつかったときの勝敗（今までと変えない）');
{
  const c = { '2026-07-10': { actual: 100, note: 'クラウド' } };
  const l = { '2026-07-10': { actual: 200, note: 'ローカル' } };
  const m = E.merge(c, l);
  ok(m['2026-07-10'].note === 'ローカル', '_at が無ければローカルが勝つ（従来と同じ＝退行しない）');

  const c2 = { '2026-07-10': { actual: 100, note: 'クラウド', _at: 2000 } };
  const l2 = { '2026-07-10': { actual: 200, note: 'ローカル', _at: 1000 } };
  ok(E.merge(c2, l2)['2026-07-10'].note === 'クラウド', '_at があれば新しい方が勝つ');
}

console.log('\n[3] 取りこぼしの判定（covers）');
{
  const full = july(1, 31), partial = july(19, 31);
  ok(E.covers(full, partial) === true, '全部持っていれば部分をカバーできている');
  ok(E.covers(partial, full) === false, '部分しか持っていなければカバーできていない（押し上げを止められる）');
}

console.log('\n[4] 空で上書きしない');
{
  E.put('daily_actuals_F02', july(1, 31));
  E.set('F02', {});
  ok(Object.keys(E.raw('daily_actuals_F02')).length === 31, '空を書こうとしても消えない');
  ok(E.log().some(function (l) { return /空での上書きを止めました/.test(l); }), '止めたことを記録に残す', E.log());

  E.set('F02', july(1, 20));
  ok(Object.keys(E.raw('daily_actuals_F02')).length === 20, '中身がある更新は今までどおり通す');

  E.put('daily_actuals_F09', {});
  E.set('F09', {});
  ok(E.raw('daily_actuals_F09') && Object.keys(E.raw('daily_actuals_F09')).length === 0,
    'もともと空なら書ける（新規店舗が作れなくならない）');
}

console.log('\n[5] 登録されているか');
{
  const mp = objDecl(src, 'OP_MERGE_PREFIX');
  ok(/'daily_actuals_':\s*\{\s*merge:\s*mergeMapByTime/.test(mp), '合流ルールが登録されている');
  ok(!/'daily_actuals_'/.test(objDecl(prev, 'OP_MERGE_PREFIX')), '（参考）v824 までは登録されていなかった');
  const pre = arrDecl(src, 'OP_SYNC_PREFIX');
  ok(/'daily_actuals_'/.test(pre), 'クラウド同期の対象であることは変わらない');
}

console.log('\n[6] 同じ穴が他に何個あるか（見えるようにしておく）');
{
  /* 【当初この節は OP_MERGE_PREFIX の宣言テキストを文字列一致で見ていた】
     そのため v807 で _opMergeDef の先頭に直書きされた sl_manual_ の分岐を拾えず、
     保護済みのキーを「未保護」として数え、12個と報告していた（実際は11個）。
     判定は実コードに聞く。宣言テキストの一致で代用しない。 */
  const MP = require('./merge_probe.js');
  function uncoveredIn(text) {
    const p = MP.buildProbe(text);
    return p.syncPrefixes().filter(function (k) {
      if (MP.NOT_A_DATA_KEY.indexOf(k) >= 0) return false;   // spl_ は分割キーの入れ物
      return !p.ruleFor(k).name;
    });
  }
  const missing = uncoveredIn(src);
  console.log('     合流ルールが無いキー（丸ごと上書きされる）: ' + missing.length + ' 個');
  console.log('     ' + missing.join('  '));
  ok(missing.indexOf('daily_actuals_') < 0, '売上は塞いだ');
  ok(missing.indexOf('sl_manual_') < 0, '（v807で保護済みの sl_manual_ を未保護と誤報告しない）');
  const missB = uncoveredIn(prev);
  ok(missing.length === missB.length - 1, '1つだけ減った（他は形を確認してから触る）',
    { v824: missB.length, v825: missing.length });
  ok(missing.length > 0, '残りがあることを毎回表に出す（隠さない）', missing.length);
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

  ['mergeMapByTime', '_coversMapByTime', '_recAt', 'getDailyActuals',
    'syncStoreActualsFromToast', 'fetchToastRange', 'fetchToastSales', 'loginToastAutoSync',
    'syncCenterRunStore', 'monthDays', 'recentDays', 'cumulativeToToday', 'foodCostOf',
    'mcUpsertAlert', 'mcNotifyTargets', 'groupsForRole'].forEach(function (fn) {
      ok(grabIf(prev, fn) !== '' && unchangedIn('825', fn), fn + ' を変えていない');
    });
  ok(arrDecl(src, 'NAV_ITEMS') === arrDecl(prev, 'NAV_ITEMS'), 'NAV_ITEMS を変えていない');
  ok(arrDecl(src, 'OP_SYNC_PREFIX') === arrDecl(prev, 'OP_SYNC_PREFIX'), '同期対象のキー一覧は変えていない');
  ok(src.indexOf(String.fromCharCode(0x8f96)) < 0, '簡体字の誤字が入っていない');
  /* 合流関数そのものを触っていない＝他のキーへの影響が無い */
  ok(grabIf(src, 'mergeMapByTime') === grabIf(prev, 'mergeMapByTime'),
    '既存の合流関数を流用しただけ（他のキーの挙動は変わらない）');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
