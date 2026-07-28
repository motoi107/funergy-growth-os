/* ===== v757 検証 =====
   ① スキルマトリクスの Lv4 が Lv選択モーダルと同じ青になるか
   ② レーダー上部の緑チップから、店舗の評価軸に無い旧ポジションが消えるか
   店舗ごとに軸も最大レベルも違うため、取り違えないことを重点的に確認する。 */
const fs = require('fs');
const NEW = fs.readFileSync('index.html', 'utf8');
const OLD = fs.readFileSync('index_v756_backup.html', 'utf8');

function grab(src, n) {
  let i = src.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('not found: ' + n);
  let d = 0, st = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

/* 店舗ごとの評価軸（Piikoi/Kaimuki は7軸Lv0-4、他店は旧軸Lv0-3） */
const POS = {
  'F04-P': ['Team Standards', 'Main Plater', 'Miso', 'Host', 'Supporter', 'Prep', 'Hospitality'],
  'F04-K': ['Team Standards', 'Main Plater', 'Miso', 'Host', 'Supporter', 'Prep', 'Hospitality'],
  'F01': ['理念', 'サービスクオリティ', 'Energy', 'Host']
};
/* 記録には軸から外した旧ポジションが残り続ける（合流は記録を消さないため） */
const SKILLS = {
  'F04-P': {
    'Team Standards': { status: '承認', level: 2 },
    'Main Plater': { status: '承認', level: 1 },
    'Miso': { status: '承認', level: 2 },
    'Host': { status: '承認', level: 3 },
    'Supporter': { status: '承認', level: 2 },
    'Prep': { status: '承認', level: 1 },
    'Hospitality': { status: '承認', level: 2 },
    '理念': { status: '承認', level: 2 },              // 旧
    'サービスクオリティ': { status: '承認', level: 3 }, // 旧
    'Energy': { status: '承認', level: 1 }             // 旧
  },
  'F01': {
    '理念': { status: '承認', level: 2 },
    'Energy': { status: '承認', level: 1 },
    'Host': { status: '承認', level: 3 }
  }
};

function build(src) {
  const code = `
    function getStorePositions(sid){ return (POS[sid]||[]).slice(); }
    function getEmpSkillsStore(name, sid){ return SKILLS[sid]||{}; }
    function storeSkillMax(sid){ return (sid==='F04-K'||sid==='F04-P') ? 4 : 3; }
    function escapeHtml(x){ return String(x); }
    function tStatus(x){ return x; }
    function posLabel(p){ var M={'理念':'Philosophy','サービスクオリティ':'Service Quality'}; return (M[p]!=null?M[p]:p); }
    ${src.indexOf('function skillLvColor(') >= 0 ? grab(src, 'skillLvColor') : ''}
    ${grab(src, 'approvedPositionsStore')}
    ${grab(src, 'skillLevelListHtml')}
    ${grab(src, 'skillScoreStore')}
    /* マトリクスのセル色（実ファイルの式をそのまま取り出す） */
    function cellBg(v){ ${(function(){
      const m = /var bg=[^\n]*/.exec(src.slice(src.indexOf('var sk = getEmpSkillsStore(e.name, mgrStoreId);')));
      return m[0].replace(/\r/g, '') + ' return bg;';
    })()} }
    return { ap:approvedPositionsStore, list:skillLevelListHtml, score:skillScoreStore, cellBg:cellBg,
             lvColor:(typeof skillLvColor==='function'?skillLvColor:null) };
  `;
  return new Function('POS', 'SKILLS', code)(POS, SKILLS);
}

/* =========================================================
   T1: マトリクスの Lv4 の色
   ========================================================= */
console.log('\n[T1] スキルマトリクスの Lv4');
{
  const o = build(OLD), n = build(NEW);
  ok('修正前(v756): Lv4 が Lv3 と同じ橙になっていた',
    o.cellBg(4) === o.cellBg(3), 'Lv4=' + o.cellBg(4) + ' Lv3=' + o.cellBg(3));
  ok('修正後(v757): Lv4 は青(--accent2)',
    n.cellBg(4) === 'var(--accent2)', n.cellBg(4));
  ok('修正後: Lv4 と Lv3 の色が違う', n.cellBg(4) !== n.cellBg(3));

  ok('Lv3 は従来どおり橙', n.cellBg(3) === 'var(--accent)');
  ok('Lv2 は従来どおり緑', n.cellBg(2) === 'var(--green)');
  ok('Lv1 は従来どおり黄', n.cellBg(1) === 'var(--yellow)');
  ok('Lv0 は従来どおり無色', n.cellBg(0) === 'transparent');

  ok('Lv選択モーダルと同じ色を使っている',
    NEW.indexOf("4:'var(--accent2, var(--accent))'") >= 0 && n.lvColor(4) === 'var(--accent2)');
}

/* =========================================================
   T2: レベル一覧のバー本数（店舗別）
   ========================================================= */
console.log('\n[T2] レベル一覧のバー本数');
{
  const o = build(OLD), n = build(NEW);
  const cnt = h => (h.match(/width:1[03]px;height:5px/g) || []).length;

  ok('修正前(v756): Piikoi でもバーは3本だった',
    cnt(o.list('Noah', 'F04-P')) === 3 * POS['F04-P'].length,
    cnt(o.list('Noah', 'F04-P')) + '本');
  ok('修正後(v757): Piikoi は4本になる',
    cnt(n.list('Noah', 'F04-P')) === 4 * POS['F04-P'].length,
    cnt(n.list('Noah', 'F04-P')) + '本');
  ok('修正後: 他店(F01)は従来どおり3本',
    cnt(n.list('X', 'F01')) === 3 * POS['F01'].length,
    cnt(n.list('X', 'F01')) + '本');
  ok('Lv3の色は一覧でも橙のまま', n.list('Noah', 'F04-P').indexOf('var(--accent)') >= 0);
}

/* =========================================================
   T3: 緑チップから旧ポジションが消えるか
   ========================================================= */
console.log('\n[T3] レーダー上部の一覧（緑チップ）');
{
  const o = build(OLD), n = build(NEW);
  const oldAp = o.ap('Noah', 'F04-P');
  const newAp = n.ap('Noah', 'F04-P');

  ok('修正前(v756): 旧ポジションが混ざる（報告された症状）',
    oldAp.indexOf('理念') >= 0 && oldAp.indexOf('Energy') >= 0 && oldAp.indexOf('サービスクオリティ') >= 0,
    JSON.stringify(oldAp));
  ok('修正後(v757): 旧ポジション（理念/Philosophy）が消える', newAp.indexOf('理念') < 0);
  ok('修正後: 旧ポジション（サービスクオリティ/Service Quality）が消える',
    newAp.indexOf('サービスクオリティ') < 0);
  ok('修正後: 旧ポジション（Energy）が消える', newAp.indexOf('Energy') < 0);
  ok('修正後: 7軸ちょうどになる', newAp.length === 7, newAp.length + '件 ' + JSON.stringify(newAp));
  ok('修正後: 評価軸の順に並ぶ',
    JSON.stringify(newAp) === JSON.stringify(POS['F04-P']), JSON.stringify(newAp));
}

/* =========================================================
   T4: 店舗を取り違えていないか
   ========================================================= */
console.log('\n[T4] 店舗別の区別');
{
  const n = build(NEW);
  // F01 は旧軸のままの店舗。Energy や 理念 は「その店の正しい軸」なので消してはいけない
  const ap01 = n.ap('X', 'F01');
  ok('旧軸の店舗(F01)では 理念 が残る', ap01.indexOf('理念') >= 0, JSON.stringify(ap01));
  ok('旧軸の店舗(F01)では Energy が残る', ap01.indexOf('Energy') >= 0);
  ok('旧軸の店舗(F01)は軸の順に並ぶ',
    JSON.stringify(ap01) === JSON.stringify(['理念', 'Energy', 'Host']),
    JSON.stringify(ap01));

  ok('点数計算は従来どおり軸で絞られている（13点）',
    n.score('Noah', 'F04-P').total === 13, JSON.stringify(n.score('Noah', 'F04-P')));
  ok('Lv3以上の数も軸で絞られている', n.score('Noah', 'F04-P').lv3 === 1);
  ok('チップの件数と点数の対象が一致する',
    n.ap('Noah', 'F04-P').length === n.score('Noah', 'F04-P').approved);

  // 評価軸が未設定の店舗では従来どおり全件返す
  const n2 = new Function('POS', 'SKILLS', `
    function getStorePositions(){ return []; }
    function getEmpSkillsStore(){ return {A:{status:'承認',level:1}}; }
    ${grab(NEW, 'approvedPositionsStore')}
    return approvedPositionsStore;
  `)(POS, SKILLS);
  ok('評価軸が未設定の店舗では従来どおり', n2('X', 'ZZZ').length === 1);
}

console.log('\n==================================');
console.log('  PASS ' + pass + ' / FAIL ' + fail);
console.log('==================================');
if (fail) process.exit(1);
