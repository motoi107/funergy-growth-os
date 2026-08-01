/* verify_v799.js — 査定の対象店舗を役職から決める
   GM＝全店合算 / AM＝管轄店舗 / それ以外＝配属店。手動指定があればそれが最優先。 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v798_backup.html', 'utf8');
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
/* 依存が増えても検査が止まらないよう、あるものだけ取り込む。
   v799/v800 で karteEmpStores の依存が2度増え、そのたびに ReferenceError で
   検査ごと停止した（FAIL より危険。0件通過に見えて何も守っていない）。 */
function grabIf(text, name) {
  return text.indexOf('function ' + name + '(') >= 0 ? grab(text, name) : '';
}

console.log('\n=== v799: 対象店舗を役職から決める ===\n');

const STORES = [
  { id: 'F01', name: 'ToriTon', am: 'Yuki Nagatani', active: true },
  { id: 'F02', name: 'Tenkichi', am: 'Masamitsu', active: true },
  { id: 'F04-K', name: 'Kaimuki', am: 'Yuki Nagatani', active: true },
  { id: 'F04-P', name: 'Piikoi', am: 'Yuki Nagatani', active: true },
  { id: 'F05', name: 'Marujuu', am: 'Masamitsu', active: false },
  { id: 'OFFICE', name: 'Office', active: true }
];
function build(which) {
  const s = which === 'prev' ? prev : src;
  return new Function('STORES_ALL', `
    var STORES=STORES_ALL;
    function getStoresAll(){ return STORES_ALL; }
    function amStoresOf(n){ return getStoresAll().filter(function(s){return s.am===n;}).map(function(s){return s.id;}); }
    function empGrade(e){ return (e&&e.grade)||''; }
    function escapeHtml(x){ return String(x==null?'':x); }
    ${grabIf(s,'scAssignedStores')}
    ${grabIf(s,'karteEmpStoresAuto')}
    ${grab(s, 'karteEmpStores')}
    ${grabIf(s,'karteEmpStoreBasis') || 'function karteEmpStoreBasis(){return{kind:"",label:""};}'}
    return { stores:karteEmpStores, basis:karteEmpStoreBasis };
  `)(STORES);
}
const e = build(), old = build('prev');
const GM = { id: 'g', name: 'Moto Kubota', role: 'gm', grade: 'G6', store: 'F01' };
const AM = { id: 'a', name: 'Yuki Nagatani', role: 'am', grade: 'G5', store: 'F04-K' };
const AM2 = { id: 'a2', name: 'Masamitsu', role: 'am', grade: 'G5', store: 'F02' };
const AMX = { id: 'ax', name: '未割当AM', role: 'am', grade: 'G5', store: 'F02' };
const SL = { id: 's', name: '田中', role: 'sl', grade: 'G3', store: 'F01' };
const G4 = { id: 'g4', name: '店長', role: 'g4', grade: 'G4', store: 'F02' };

console.log('[1] GM は全店合算');
{
  const r = e.stores({}, GM);
  ok(r.length === 4, '営業中の全店が対象（4店）', r);
  ok(r.indexOf('F01') >= 0 && r.indexOf('F02') >= 0 && r.indexOf('F04-K') >= 0 && r.indexOf('F04-P') >= 0, '全店が入る', r);
  ok(r.indexOf('OFFICE') < 0, 'OFFICE は除く', r);
  ok(r.indexOf('F05') < 0, '休止中の店は除く', r);
  ok(e.basis({}, GM).kind === 'all', '根拠は「全店合算」', e.basis({}, GM));
  /* v798 では配属店1つだけだった */
  ok(old.stores({}, GM).length === 1, 'v798 では配属店1店だけだった（全店の責任を負うのに）', old.stores({}, GM));
}

console.log('\n[2] AM は管轄店舗のみ');
{
  const r = e.stores({}, AM);
  ok(r.length === 3, 'Yuki の管轄3店', r);
  ok(r.indexOf('F01') >= 0 && r.indexOf('F04-K') >= 0 && r.indexOf('F04-P') >= 0, 'ToriTon・Kaimuki・Piikoi', r);
  ok(r.indexOf('F02') < 0, '他AMの店は入らない', r);
  const r2 = e.stores({}, AM2);
  ok(r2.length === 1 && r2[0] === 'F02', '別のAMは自分の管轄だけ（休止店は除く）', r2);
  ok(e.basis({}, AM).label.indexOf('3店') >= 0, '根拠に管轄店数が出る', e.basis({}, AM).label);
  ok(old.stores({}, AM).length === 1, 'v798 では配属店1店だけだった', old.stores({}, AM));
}

console.log('\n[3] 管轄が未設定のAM');
{
  const r = e.stores({}, AMX);
  ok(r.length === 1 && r[0] === 'F02', '配属店に落とす（空にしない）', r);
  /* kind の文字列そのものは実装の都合で変わる（v800 で amNone→none）。
     durable な性質は「未設定だと分かる表示になっていること」。 */
  ok(/未設定/.test(e.basis({}, AMX).label), '未設定であることが表示で分かる', e.basis({}, AMX));
  /* 空を返すと予算達成率が中立になり、査定が甘くなってしまう */
  ok(r.length > 0, '空を返さない（空だと係数が中立になり査定が甘くなる）');
}

console.log('\n[4] それ以外は配属店');
{
  ok(JSON.stringify(e.stores({}, SL)) === JSON.stringify(['F01']), 'SL は配属店のみ', e.stores({}, SL));
  ok(JSON.stringify(e.stores({}, G4)) === JSON.stringify(['F02']), 'G4（店長）は自店のみ', e.stores({}, G4));
  ok(e.basis({}, SL).kind === 'own', '根拠は「配属店」');
  ok(JSON.stringify(e.stores({}, SL)) === JSON.stringify(old.stores({}, SL)), 'v798 と同じ（一般スタッフの査定は変わらない）');
  ok(JSON.stringify(e.stores({}, G4)) === JSON.stringify(old.stores({}, G4)), 'G4 も変わらない');
}

console.log('\n[5] 手動指定が最優先');
{
  const cfg = { empStore: { g: ['F01'], a: ['F04-K', 'F04-P'] } };
  ok(JSON.stringify(e.stores(cfg, GM)) === JSON.stringify(['F01']), 'GM でも手動指定が勝つ', e.stores(cfg, GM));
  ok(e.stores(cfg, AM).length === 2, 'AM でも手動指定が勝つ', e.stores(cfg, AM));
  ok(e.basis(cfg, GM).kind === 'manual', '手動であることが分かる');
  ok(e.basis(cfg, AM).kind === 'manual', 'AM も手動と表示される');
  /* 文字列1つの旧形式も読める */
  ok(JSON.stringify(e.stores({ empStore: { g: 'F02' } }, GM)) === JSON.stringify(['F02']), '旧形式（文字列）も読める');
  /* 空配列は指定なし扱い → 自動に戻る */
  ok(e.stores({ empStore: { g: [] } }, GM).length === 4, '空の指定は自動判定に戻る', e.stores({ empStore: { g: [] } }, GM).length);
}

console.log('\n[6] 壊れた入力');
{
  ok(JSON.stringify(e.stores({}, null)) === '[]', '従業員が無いと空');
  ok(JSON.stringify(e.stores({}, { id: 'x', name: '無店舗', role: 'crew', grade: 'G1' })) === '[]', '配属店が無い一般スタッフは空');
  ok(e.stores({}, { id: 'y', name: 'X', role: 'gm' }).length === 4, 'grade が無くても role で判定できる');
  ok(e.stores({}, { id: 'z', name: 'Yuki Nagatani', grade: 'G5', store: 'F04-K' }).length === 3, 'role が無くても grade で判定できる');
}

console.log('\n[7] 画面に根拠が出る');
{
  ok(/karteEmpStoreBasis/.test(grab(src, '_karteStoreSel')), '一覧の店舗欄に根拠を出す');
  ok(/karteEmpStoreBasis/.test(grab(src, 'renderBonusBreakdown')), '算定根拠にも範囲が出る');
  ok(prev.indexOf('karteEmpStoreBasis') < 0, 'v798 には無かった');
}

console.log('\n[8] 影響範囲');
{
  ok(grab(src, 'bonusForEmp') === grab(prev, 'bonusForEmp'), '算定式は1文字も変えていない');
  ok(grab(src, 'budgetAchieveFor') === grab(prev, 'budgetAchieveFor'), '予算達成率の取り方も同じ');
  ok(grab(src, 'bqStores') === grab(prev, 'bqStores'), '利益入力の対象店の集め方も同じ（karteEmpStores 経由で自動的に広がる）');
  ok(!/lsSet\(/.test(grab(src, 'karteEmpStoresAuto')) && !/lsSet\(/.test(grab(src, 'karteEmpStoreBasis')), '判定は何も保存しない');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
