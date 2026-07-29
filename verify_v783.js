/* verify_v783.js — 棚卸の仕入価格の手入力（当月のみ・Totoya3店）
   実関数を切り出して Node で動かす。修正前(v782)の症状の再現も入れてある。 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v782_backup.html', 'utf8');  // 無ければ ENOENT → run_verify が SKIP と分類

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '   → ' + JSON.stringify(extra) : '')); }
}
function grab(text, name) {
  let i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  let d = 0, st = false, j = i;
  for (; j < text.length; j++) {
    const c = text[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  const out = text.slice(i, j);
  if (!out.trim()) throw new Error('empty extract: ' + name);
  return out;
}

const CUR = '2026-07', PAST = '2026-06';
const TOTOYA = ['F04-K', 'F04-P', 'F04-A'];

/* 食材3件。A=内容量なし / B=内容量4 / C=店舗別価格つき */
function baseIngs() {
  return [
    { code: 401, name: 'Ahi', unit: 'lb', qty: 0, price: 13.00, cls: 'food', vendor: 'Ham', storePrices: {} },
    { code: 402, name: 'Rice', unit: 'bag', qty: 4, price: 40.00, cls: 'food', vendor: 'Cherry', storePrices: {} },
    { code: 403, name: 'Coke', unit: 'ea', qty: 0, price: 0.82, cls: 'beverage', vendor: 'Sams', storePrices: { 'F04-K': { price: 0.95 } } }
  ];
}

function makeEnv(offset) {
  const names = ['invPriceOverrides', 'invPriceOf', 'invPriceEditable', 'invBasePrice',
    'setInvPrice', 'invResetPrice', '_invPriceRowSync', '_invPriceTagHtml', 'invUnitValue'];
  const bodies = names.map(n => grab(src, n)).join('\n');
  return new Function(`
    var __store = {};
    var __warn = [];
    var __ings = ${JSON.stringify(baseIngs())};
    var invMonthOffset = ${offset};
    function invYm(){ return invMonthOffset===0 ? '${CUR}' : '${PAST}'; }
    function ls(k, d){ return (k in __store) ? JSON.parse(JSON.stringify(__store[k])) : d; }
    function lsSet(k, v){ __store[k] = JSON.parse(JSON.stringify(v)); }
    function isTotoyaStore(id){ return ${JSON.stringify(TOTOYA)}.indexOf(id) >= 0; }
    function getIngredients(){ return __ings; }
    function escapeHtml(s){ return String(s==null?'':s); }
    function showToast(m, t){ __warn.push(m); }
    function renderInvToppageInner(){ return ''; }
    function invRefreshInputSection(){}
    var document = { getElementById: function(){ return null; } };
    var ROLE_CONFIG = { gm: { name: 'GM' } }, curRole = 'gm';
    ${bodies}
    return {
      store:__store, warn:__warn, ings:__ings,
      setMonth:function(o){ invMonthOffset=o; },
      invPriceOf:invPriceOf, invPriceEditable:invPriceEditable, invBasePrice:invBasePrice,
      invUnitValue:invUnitValue, setInvPrice:setInvPrice, invResetPrice:invResetPrice,
      tag:_invPriceTagHtml
    };
  `)();
}

console.log('\n=== v783: 棚卸の仕入価格の手入力 ===\n');

/* ---------- 1. 修正前(v782)の症状の再現 ---------- */
console.log('[1] 修正前の症状（v782 は手入力を無視する）');
{
  const old = new Function(`
    ${grab(prev, 'invUnitValue')}
    return invUnitValue;
  `)();
  const i = baseIngs()[0];
  ok(old.length === 2, 'v782 の invUnitValue は引数2つ（月を見ない）', old.length);
  ok(old(i, 'F04-K') === 13.00, 'v782: 手入力の保存先を見る手段が無く、常にマスター価格 13.00', old(i, 'F04-K'));

  const env = makeEnv(0);
  env.setInvPrice('F04-K', 401, '9.50');
  ok(env.invUnitValue(baseIngs()[0], 'F04-K') === 9.50, 'v783: 同じ状況で手入力の 9.50 が使われる', env.invUnitValue(baseIngs()[0], 'F04-K'));
}

/* ---------- 2. 価格の決まり方 ---------- */
console.log('\n[2] 価格の決まり方');
{
  const env = makeEnv(0);
  const [A, B, C] = baseIngs();
  ok(env.invBasePrice(A, 'F04-K') === 13.00, '手入力なし → マスターの price', env.invBasePrice(A, 'F04-K'));
  ok(env.invBasePrice(C, 'F04-K') === 0.95, '手入力なし → storePrices があればそちらが優先', env.invBasePrice(C, 'F04-K'));
  ok(env.invBasePrice(C, 'F04-P') === 0.82, '別店舗は storePrices が無いので price', env.invBasePrice(C, 'F04-P'));
  ok(env.invUnitValue(B, 'F04-K') === 10.00, '内容量4 → 40.00÷4 = 10.00', env.invUnitValue(B, 'F04-K'));

  env.setInvPrice('F04-K', 403, '1.10');
  ok(env.invBasePrice(C, 'F04-K') === 1.10, '手入力は storePrices よりも強い', env.invBasePrice(C, 'F04-K'));

  env.setInvPrice('F04-K', 402, '48');
  ok(env.invUnitValue(B, 'F04-K') === 12.00, '内容量ありの手入力 → 48÷4 = 12.00', env.invUnitValue(B, 'F04-K'));
  ok(env.invBasePrice(B, 'F04-K') === 48, '仕入価格そのものは 48 のまま', env.invBasePrice(B, 'F04-K'));
}

/* ---------- 3. 月ごとに独立している ---------- */
console.log('\n[3] 月ごとに独立している（翌月はマスター値から始まる）');
{
  const env = makeEnv(0);
  const A = baseIngs()[0];
  env.setInvPrice('F04-K', 401, '9.50');
  ok(Object.keys(env.store)[0] === 'inv_price_F04-K_' + CUR, '保存先は inv_price_<店舗>_<年月>', Object.keys(env.store));
  ok(env.invBasePrice(A, 'F04-K', CUR) === 9.50, '当月は 9.50');
  ok(env.invBasePrice(A, 'F04-K', PAST) === 13.00, '前月は手入力の影響を受けない（13.00）', env.invBasePrice(A, 'F04-K', PAST));
  ok(env.invBasePrice(A, 'F04-K', '2026-08') === 13.00, '翌月もマスター値から始まる（13.00）', env.invBasePrice(A, 'F04-K', '2026-08'));
}

/* ---------- 4. 編集できる条件 ---------- */
console.log('\n[4] 編集できる条件（Totoya3店 × 当月のみ）');
{
  const env = makeEnv(0);
  TOTOYA.forEach(s => ok(env.invPriceEditable(s) === true, s + ' の当月は編集できる'));
  ['F01', 'F02', 'F03', 'F03-G', 'F05'].forEach(s => ok(env.invPriceEditable(s) === false, s + ' は編集できない'));

  const past = makeEnv(-1);
  ok(past.invPriceEditable('F04-K') === false, '過去月は Totoya でも編集できない');
  past.setInvPrice('F04-K', 401, '9.50');
  ok(Object.keys(past.store).length === 0, '過去月では1件も保存されない', past.store);
  ok(past.warn.length === 1, '過去月では警告が出る', past.warn);

  /* 読み出しは店舗で絞っていない＝保存済みの手入力が黙って無視されない */
  const f01 = makeEnv(0);
  f01.store['inv_price_F01_' + CUR] = { 401: { p: 7.77, _at: 1 } };
  ok(f01.invBasePrice(baseIngs()[0], 'F01') === 7.77,
    '非Totoyaに保存済みの手入力があれば読み出しは効く（黙って無視しない）', f01.invBasePrice(baseIngs()[0], 'F01'));
}

/* ---------- 5. 食材マスターを書き換えない（凍結の維持） ---------- */
console.log('\n[5] 食材マスターを書き換えない');
{
  const env = makeEnv(0);
  const before = JSON.stringify(env.ings);
  env.setInvPrice('F04-K', 401, '9.50');
  env.setInvPrice('F04-K', 402, '48');
  env.setInvPrice('F04-K', 403, '1.10');
  env.invResetPrice('F04-K', 403);
  ok(JSON.stringify(env.ings) === before, '食材マスターの中身が1文字も変わらない');
  ok(!('m_ingredients' in env.store), 'm_ingredients へ保存していない', Object.keys(env.store));
  ok(!('store_ingredients' in env.store), 'store_ingredients へ保存していない');
  ok(Object.keys(env.store).every(k => k.indexOf('inv_price_') === 0),
    '書き込むキーは inv_price_ だけ', Object.keys(env.store));
}

/* ---------- 6. 空欄・不正値・戻す ---------- */
console.log('\n[6] 空欄・不正値・戻す（マスターへ戻る）');
{
  const env = makeEnv(0);
  const A = baseIngs()[0];
  const key = 'inv_price_F04-K_' + CUR;

  env.setInvPrice('F04-K', 401, '9.50');
  ok(env.invPriceOf('F04-K', 401) === 9.50, '手入力が入る');

  env.setInvPrice('F04-K', 401, '');
  ok(env.invPriceOf('F04-K', 401) === null, '空欄 → 手入力なし');
  ok(env.store[key][401].p === null, '空欄は行を消さず p:null で残す', env.store[key][401]);
  ok(env.invBasePrice(A, 'F04-K') === 13.00, 'マスター価格へ戻る');

  env.setInvPrice('F04-K', 401, 'abc');
  ok(env.invPriceOf('F04-K', 401) === null, '数値でない入力 → 手入力なし');
  env.setInvPrice('F04-K', 401, '-5');
  ok(env.invPriceOf('F04-K', 401) === null, 'マイナス → 手入力なし');
  env.setInvPrice('F04-K', 401, '0');
  ok(env.invPriceOf('F04-K', 401) === 0, '0 は有効な価格として受け付ける', env.invPriceOf('F04-K', 401));

  env.setInvPrice('F04-K', 401, '9.50');
  env.invResetPrice('F04-K', 401);
  ok(env.invPriceOf('F04-K', 401) === null, '「戻す」で手入力なしへ');
  ok(env.store[key][401].p === null, '「戻す」も p:null で残す');

  const rec = { p: 1 };
  ok(typeof env.store[key][401]._at === 'number' && env.store[key][401]._at > 0,
    '_at（数値の時刻）が入る＝合流の判定に使える', env.store[key][401]);
}

/* ---------- 7. 確定時に単価が焼き付く ---------- */
console.log('\n[7] 確定時に単価が明細へ焼き付く');
{
  const fn = grab(src, 'saveInventory');
  const s = fn.indexOf('var lines=[];');
  const e = fn.indexOf('if(!lines.length)');
  ok(s > 0 && e > s, '明細を組み立てる部分を切り出せた', { s: s, e: e });
  const loop = fn.slice(s, e);
  ok(/_L\.manual\s*=\s*1/.test(loop), '手入力した行に manual の印を付けている');

  const env = makeEnv(0);
  env.setInvPrice('F04-K', 401, '9.50');
  const build = new Function('inv', `
    var storeId='F04-K';
    var ings=${JSON.stringify(baseIngs())};
    var codes=[401,402,403];
    var counts={401:10, 402:2, 403:100};
    function catClass(){ return 'food'; }
    var invUnitValue=inv.invUnitValue, invPriceOf=inv.invPriceOf;
    ${loop}
    return lines;
  `)(env);
  const l401 = build.filter(x => x.code === 401)[0];
  const l402 = build.filter(x => x.code === 402)[0];
  ok(l401.unitVal === 9.50, '手入力した品目の単価が明細に入る', l401.unitVal);
  ok(l401.value === 95, '金額 = 9.50 × 10 = 95', l401.value);
  ok(l401.manual === 1, '手入力の印が付く', l401.manual);
  ok(l402.unitVal === 10.00 && l402.manual === undefined, '手入力していない品目は従来どおり印なし', l402);
}

/* ---------- 8. 合流ルール ---------- */
console.log('\n[8] 合流ルール（品目ごとに新しい方が勝つ）');
{
  ok(/'inv_price_':\s*\{\s*merge:\s*mergeMapByTime,\s*covers:\s*_coversMapByTime\s*\}/.test(src),
    "OP_MERGE_PREFIX に 'inv_price_' を登録している");

  const m = new Function(`
    ${grab(src, '_recAt')}
    ${grab(src, 'mergeMapByTime')}
    return mergeMapByTime;
  `)();
  const cloud = { 401: { p: 9.5, _at: 100 }, 402: { p: 48, _at: 100 } };
  const local = { 402: { p: 50, _at: 200 }, 403: { p: 1.1, _at: 200 } };
  const out = m(cloud, local);
  ok(out[401].p === 9.5, '他端末だけが入れた品目が残る（401）', out[401]);
  ok(out[402].p === 50, '同じ品目は新しい方が勝つ（402: 48→50）', out[402]);
  ok(out[403].p === 1.1, '自端末だけが入れた品目も残る（403）', out[403]);

  const del = m({ 401: { p: 9.5, _at: 100 } }, { 401: { p: null, _at: 200 } });
  ok(del[401].p === null, '新しい「戻す」は古い価格に上書きされない', del[401]);
  const undel = m({ 401: { p: null, _at: 100 } }, { 401: { p: 9.5, _at: 200 } });
  ok(undel[401].p === 9.5, '「戻す」のあとに入れ直せば新しい価格が勝つ', undel[401]);
  ok(m({ 401: { p: null, _at: 300 } }, { 401: { p: 9.5, _at: 200 } })[401].p === null,
    '古い入れ直しは新しい「戻す」に勝てない');

  /* 実際の解決関数で確かめる */
  function grabObj(text, decl) {
    const i = text.indexOf(decl);
    let d = 0, st = false, j = i;
    for (; j < text.length; j++) {
      const c = text[j];
      if (c === '{') { d++; st = true; }
      else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
    }
    return text.slice(i, j) + ';';
  }
  const merges = grabObj(src, 'var OP_MERGE = {');
  const mergePre = grabObj(src, 'var OP_MERGE_PREFIX = {');
  const refs = new Set();
  (merges + mergePre).replace(/(?:merge|covers)\s*:\s*([A-Za-z_$][\w$]*)/g, (a, n) => { refs.add(n); return a; });
  const def = new Function(`
    var DEFAULT_STORES=[{id:'F01'},{id:'F04-K'}];
    function _lsRaw(){ return null; }
    function mergeStamped(){} function _coversStamped(){}
    function mergeListByCode(){} function _coversListByCode(){}
    var _ST_MERGE_DEF=null;
    function _stDef(){ if(!_ST_MERGE_DEF) _ST_MERGE_DEF={merge:mergeStamped,covers:_coversStamped}; return _ST_MERGE_DEF; }
    var console={warn:function(){}};
    ${[...refs].map(n => 'function ' + n + '(){}').join('\n')}
    ${merges}
    ${mergePre}
    ${grabObj(src, 'var _SPLIT_KEYS = {')}
    ${grab(src, 'registerInvMergeKeys')}
    registerInvMergeKeys();
    ${grab(src, '_opMergeDef')}
    return _opMergeDef;
  `)();
  ok(!!def('inv_price_F04-K_' + CUR), '_opMergeDef が inv_price_F04-K_2026-07 に定義を返す');
  ok(!!def('inv_F04-K'), '既存の inv_<店舗> の定義を壊していない');
  ok(!!def('inv_hist_F04-K'), '既存の inv_hist_ の定義を壊していない');
}

/* ---------- 9. 保存層の扱い（同期・保護・自動prune） ---------- */
console.log('\n[9] 保存層の扱い');
{
  const arr = n => (new RegExp('var ' + n + ' = \\[([\\s\\S]*?)\\];').exec(src)[1])
    .replace(/\/\*[\s\S]*?\*\//g, '').split(',')
    .map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  const sync = arr('OP_SYNC_PREFIX');
  const never = arr('LS_NEVER_FREE');
  const key = 'inv_price_F04-K_' + CUR;
  ok(sync.some(p => key.indexOf(p) === 0), 'OP_SYNC_PREFIX に該当 → クラウドへ同期される', sync.filter(p => key.indexOf(p) === 0));
  ok(never.some(p => key.indexOf(p) === 0), 'LS_NEVER_FREE に該当 → 容量整理で消されない');

  const prune = new Function(`${grab(src, 'lsIsPrunable')} return lsIsPrunable;`)();
  ok(prune(key) === false, '自動pruneの対象外（再生成できないデータ）');
  ok(prune('spl_' + key) === false, 'spl_ を付けても対象外');
}

/* ---------- 10. 画面の表示 ---------- */
console.log('\n[10] 画面の表示');
{
  const a = src.indexOf('<td style="text-align:right">${_pe');
  ok(a > 0, '単価セルを差し替えている');
  const b = src.indexOf('`}</td>', a);
  const cell = src.slice(a, b + 7);
  ok(cell.length > 0 && cell.length < 1200, '単価セルを切り出せた（長さ ' + cell.length + '）');

  const env = makeEnv(0);
  env.setInvPrice('F04-K', 401, '9.50');
  const render = new Function('_pe', '_bp', 'i', 'uv', 'storeId', '_invPriceTagHtml', 'return `' + cell + '`;');

  const A = baseIngs()[0];
  const editable = render(true, env.invBasePrice(A, 'F04-K'), A, env.invUnitValue(A, 'F04-K'), 'F04-K', env.tag);
  ok(/<input /.test(editable), '編集できるときは入力欄が出る');
  ok(/value="9.5"/.test(editable), '入力欄に手入力した価格が入っている', editable.slice(0, 160));
  ok(/setInvPrice\('F04-K',401,this\.value\)/.test(editable), 'onchange が setInvPrice を呼ぶ');
  ok(/手入力/.test(editable) && /戻す/.test(editable), '手入力の印と「戻す」が出る');

  const B = baseIngs()[1];
  const env2 = makeEnv(0);
  const noEdit = render(false, env2.invBasePrice(B, 'F01'), B, env2.invUnitValue(B, 'F01'), 'F01', env2.tag);
  ok(!/<input /.test(noEdit), '編集できないときは入力欄が出ない');
  ok(/\$10\.00/.test(noEdit), '従来どおり単価が表示される（40÷4=10.00）', noEdit);
  ok(!/手入力/.test(noEdit), '手入力していなければ印は出ない');

  ok(/仕入価格は当月のみ手入力で直せます/.test(src), '脚注に説明を足している');
  ok(/l\.manual\?/.test(src), '確定済みビューにも手入力の印を出している');
}

/* ---------- 11. 版数 ---------- */
console.log('\n[11] 版数');
{
  const av = (src.match(/const APP_VERSION = '(\d+)'/) || [])[1];
  const sv = (fs.readFileSync('sw.js', 'utf8').match(/const SW_BUILD = '(\d+)'/) || [])[1];
  ok(av === '783', 'APP_VERSION = 783', av);
  ok(sv === '783', 'SW_BUILD = 783', sv);
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
