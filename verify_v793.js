/* verify_v793.js — Grade別の労働時間管理（週判定）とオーバーワーク検知 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v792_backup.html', 'utf8');

let pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '   → ' + JSON.stringify(extra) : '')); }
}
function grab(text, name) {
  let i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('fn not found: ' + name);
  if (text.slice(Math.max(0, i - 6), i) === 'async ') i -= 6;
  let d = 0, st = false, j = i;
  for (; j < text.length; j++) {
    const c = text[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return text.slice(i, j);
}
function objDecl(text, name) {
  const a = text.search(new RegExp('(?:const|var)\\s+' + name + '\\s*=\\s*\\{'));
  if (a < 0) throw new Error('obj not found: ' + name);
  let i = text.indexOf('{', a), d = 0, end = -1;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '{') d++;
    else if (text[j] === '}') { d--; if (d === 0) { end = j; break; } }
  }
  return 'var ' + name + ' = ' + text.slice(i, end + 1) + ';';
}
function arrDecl(text, name) {
  const a = text.search(new RegExp('(?:const|var)\\s+' + name + '\\s*=\\s*\\['));
  if (a < 0) throw new Error('arr not found: ' + name);
  let i = text.indexOf('[', a), d = 0, end = -1;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '[') d++;
    else if (text[j] === ']') { d--; if (d === 0) { end = j; break; } }
  }
  return 'var ' + name + ' = ' + text.slice(i, end + 1) + ';';
}

console.log('\n=== v793: Grade別の労働時間管理（週 日〜土） ===\n');

/* labor: {store:{date:{name:hours}}} を tip_labor 形式に変換して流し込む */
function build(today, labor, emps) {
  return new Function('LABOR', 'EMPS', 'TODAY', `
    var store={};
    var curRole='gm';
    var STORES=[{id:'F01',name:'ToriTon'},{id:'F04-K',name:'Kaimuki'},{id:'F04-P',name:'Piikoi'}];
    var EC_MIN_DATE='2026-07-01';
    var GRADE_TITLES={G3:['Store Leader'],G4:['Store Manager','Head Chef'],G5:['Corporate Chef'],G6:['GM']};
    function gradeOf(t){ for(var g in GRADE_TITLES){ if(GRADE_TITLES[g].indexOf(t)>=0) return g; } return null; }
    function ls(k,d){ return (k in store)? JSON.parse(JSON.stringify(store[k])) : d; }
    function lsSet(k,v){ store[k]=JSON.parse(JSON.stringify(v)); return true; }
    function getEmployees(){ return EMPS; }
    function bizToday(){ return TODAY; }
    function escapeHtml(s){ return String(s); }
    function showToast(){} function openModal(){} function closeModalDirect(){} function renderPage(){}
    function getTipLabor(sid, dt){
      var d=(LABOR[sid]||{})[dt]; if(!d) return null;
      var out={}; Object.keys(d).forEach(function(n){ out[n]={rawLunch:d[n], rawDinner:0, lunch:0, dinner:0}; });
      return out;
    }
    ${grab(src, '_laborHrs')}
    ${grab(src, 'isoOf')}
    ${grab(src, 'isoLocalDate')}
    ${grab(src, 'laborWeekDays')}
    ${grab(src, 'laborWeekRange')}
    ${grab(src, 'empGrade')}
    ${objDecl(src, 'OW_DEFAULT_LIMITS')}
    ${arrDecl(src, 'OW_GRADES')}
    ${grab(src, 'getOwLimits')}
    ${grab(src, 'setOwLimits')}
    ${grab(src, 'owGradeOfName')}
    ${grab(src, 'owWeekComplete')}
    ${grab(src, 'owWeekHours')}
    ${grab(src, 'owScanWeek')}
    ${grab(src, 'owRecentSundays')}
    ${grab(src, 'owForPeriod')}
    ${grab(src, '_owStoreName')}
    ${grab(src, 'ecDetOverwork')}
    ${grab(src, '_ecAttribute')}
    return { ls:ls, lsSet:lsSet, store:function(){return store;},
             limits:getOwLimits, scan:owScanWeek, hours:owWeekHours, period:owForPeriod,
             complete:owWeekComplete, sundays:owRecentSundays, ec:ecDetOverwork,
             attribute:_ecAttribute, grade:owGradeOfName };
  `)(labor, emps, today);
}

const EMPS = [
  { name: 'A太', role: 'crew', store: 'F01', status: '在籍' },              /* G1 */
  { name: 'B子', role: 'g2', store: 'F01', status: '在籍' },                /* G2 */
  { name: 'C郎', role: 'sl', store: 'F01', status: '在籍' },                /* G3 */
  { name: 'D美', role: 'g4', title: 'Store Manager', store: 'F01', status: '在籍' }, /* G4 */
  { name: 'E介', role: 'crew', store: 'F04-K', status: '在籍' }             /* G1・掛け持ち */
];
/* 2026-07-05(日)〜07-11(土) は完了週。今日は 2026-07-15(水)＝07-12(日)開始週が進行中 */
const TODAY = '2026-07-15';
function wk(sun, hoursByDayCount) { return hoursByDayCount; }

/* ---------- 1. 既定の枠が指示どおりか ---------- */
console.log('[1] 既定の枠');
{
  const e = build(TODAY, {}, EMPS);
  const L = e.limits();
  ok(L.G1.max === 40 && L.G1.min === null, 'G1 は上限40h（下限なし）', L.G1);
  ok(L.G2.min === 30 && L.G2.max === 40, 'G2 は 30〜40h', L.G2);
  ok(L.G3.max === 40 && L.G3.min === null, 'G3 は上限40h', L.G3);
  ok(L.G4.max === null && L.G5.max === null && L.G6.max === null, 'G4以上は既定では監視しない', [L.G4, L.G5, L.G6]);
}

/* ---------- 2. 週の切り方 ---------- */
console.log('\n[2] 週(日〜土)の扱い');
{
  const e = build(TODAY, {}, EMPS);
  ok(e.complete('2026-07-05') === true, '07/05〜07/11 は完了週');
  ok(e.complete('2026-07-12') === false, '07/12〜07/18 は進行中（今日は07/15）');
  const s = e.sundays(4);
  ok(s[0] === '2026-07-12', '直近の日曜は 07/12', s);
  ok(s.length === 4 && s[3] === '2026-06-21', '4週さかのぼる', s);
  /* 月をまたぐ週を1週として数える */
  const e2 = build('2026-08-10', { F01: { '2026-07-29': { A太: 10 }, '2026-07-30': { A太: 10 }, '2026-08-01': { A太: 25 } } }, EMPS);
  const r = e2.scan('2026-07-26', ['F01']).find(x => x.name === 'A太');
  ok(r && r.total === 45, '7/26週は月をまたいでも合計45h', r && r.total);
  ok(r && r.over === 5, '上限40hを5h超過', r && r.over);
}

/* ---------- 3. 超過・不足の判定 ---------- */
console.log('\n[3] 超過と不足');
{
  const L = {
    F01: {
      '2026-07-06': { A太: 41, B子: 25, C郎: 40, D美: 60 },
      '2026-07-07': { A太: 0 }
    }
  };
  const e = build(TODAY, L, EMPS);
  const rows = e.scan('2026-07-05', ['F01']);
  const g = n => rows.find(r => r.name === n);
  ok(g('A太').over === 1 && g('A太').state === 'over', 'G1 41h → 1h超過', g('A太'));
  ok(g('C郎').over === 0 && g('C郎').state === 'ok', 'G3 ちょうど40h は超過にしない', g('C郎'));
  ok(g('B子').under === 5 && g('B子').state === 'under', 'G2 25h → 下限30hに5h不足', g('B子'));
  ok(g('D美').over === 0, 'G4 は枠が無いので60hでも出ない（月給制）', g('D美'));
  ok(g('A太').grade === 'G1' && g('B子').grade === 'G2' && g('D美').grade === 'G4', '等級が正しく解決される');
}

/* ---------- 4. 進行中の週の扱い ---------- */
console.log('\n[4] 進行中の週');
{
  const L = { F01: { '2026-07-13': { A太: 45, B子: 8 } } };
  const e = build(TODAY, L, EMPS);
  const rows = e.scan('2026-07-12', ['F01']);
  const a = rows.find(r => r.name === 'A太'), b = rows.find(r => r.name === 'B子');
  ok(a.over === 5 && a.state === 'over', '進行中でも超過は先に出す（週末を待たない）', a);
  ok(b.under === 0 && b.state === 'ok', '進行中は不足の判定をしない（まだ働く日がある）', b);
  ok(a.weekDone === false, '進行中であることが分かる');
}

/* ---------- 5. 複数店の合算 ---------- */
console.log('\n[5] 掛け持ちの合算');
{
  const L = {
    'F01': { '2026-07-06': { E介: 25 } },
    'F04-K': { '2026-07-08': { E介: 25 } }
  };
  const e = build(TODAY, L, EMPS);
  const one = e.scan('2026-07-05', ['F01']).find(r => r.name === 'E介');
  ok(one.total === 25 && one.over === 0, '1店だけ見ると25hで超過に見えない', one);
  const all = e.scan('2026-07-05', null).find(r => r.name === 'E介');
  ok(all.total === 50 && all.over === 10, '全店合算で50h・10h超過を検知', all);
  ok(Object.keys(all.byStore).length === 2, '店舗ごとの内訳を持つ', all.byStore);
  /* 勤怠明細は表示中の店に関係する人だけ出す */
  const p = e.period('F01', [{ sun: '2026-07-05' }], '');
  ok(p.rows.some(r => r.name === 'E介'), 'F01の画面にも合算で超過として出る');
  ok(p.rows.find(r => r.name === 'E介').total === 50, 'そこに出る数字は合算値', p.rows.find(r => r.name === 'E介').total);
}

/* ---------- 6. 時間の出どころが勤怠明細と同じ ---------- */
console.log('\n[6] 時間の出どころ');
{
  const e = build(TODAY, {}, EMPS);
  const laborCore = grab(src, 'laborCoreForYm');
  ok(/_laborHrs\(/.test(laborCore), '勤怠明細の共通コアは _laborHrs を使う');
  ok(/_laborHrs\(/.test(grab(src, 'owWeekHours')), '労働時間の判定も同じ _laborHrs を使う');
  ok(/laborWeekDays\(/.test(grab(src, 'owWeekHours')), '週の日付も同じ laborWeekDays を使う');
  const core = grab(src, 'laborCoreForYm'), prevCore = grab(prev, 'laborCoreForYm');
  ok(core === prevCore, '賃金計算のコアは1文字も変えていない');
  ok(grab(src, 'laborForEmployee') === grab(prev, 'laborForEmployee'), '賃金の計算式も変えていない');
}

/* ---------- 7. エラーセンター ---------- */
console.log('\n[7] エラーセンターへの通知');
{
  const L = {
    'F01': { '2026-07-06': { A太: 41 }, '2026-07-07': { C郎: 50 } },
    'F04-K': { '2026-07-08': { E介: 25 } }
  };
  L['F01']['2026-07-09'] = { E介: 25 };
  const e = build(TODAY, L, EMPS);
  const iss = e.ec();
  ok(iss.length >= 2, '超過が通知される', iss.map(x => x.title));
  const a = iss.find(x => x.title.indexOf('A太') === 0);
  const c = iss.find(x => x.title.indexOf('C郎') === 0);
  ok(!!a && a.sev === 'mid', '1h超過は「確認」', a && a.sev);
  ok(!!c && c.sev === 'high', '10h超過は「要対応」', c && c.sev);
  ok(iss.every(x => x.cat === '勤怠'), '分類は勤怠', iss.map(x => x.cat));
  ok(iss.every(x => x.fix && /go\('labor'\)/.test(x.fix.action)), '勤怠明細へ飛べる');
  /* 題名は実績時間を含まない（進行中に時間が伸びても別件として溜まらない） */
  ok(iss.every(x => !/\d+(\.\d+)?h超過/.test(x.title.replace(/上限\d+h超過/, ''))), '題名に実績時間を入れていない', iss.map(x => x.title));
  ok(a.detail.indexOf('41h') >= 0, '実績は詳細側に入る', a.detail);
  /* 査定ログの店舗・人の紐付け */
  const at = e.attribute(a);
  ok(at.emp === 'A太', 'ログに従業員が紐づく', at);
  ok(at.store === 'F01', 'ログに店舗が紐づく', at);
  /* 掛け持ちの合算も通知される */
  const ee = iss.find(x => x.title.indexOf('E介') === 0);
  ok(!!ee && /合算/.test(ee.detail), '掛け持ちの合算も通知し、内訳を書く', ee && ee.detail);
  /* 枠を全部外すと通知しない */
  const e2 = build(TODAY, L, EMPS);
  e2.lsSet('ow_limits', { G1: {}, G2: {}, G3: {}, G4: {}, G5: {}, G6: {} });
  ok(e2.ec().length === 0, '上限を全部外せば通知しない', e2.ec().length);
}

/* ---------- 8. 設定 ---------- */
console.log('\n[8] 枠の設定');
{
  const e = build(TODAY, { F01: { '2026-07-06': { A太: 36 } } }, EMPS);
  ok(e.scan('2026-07-05', ['F01'])[0].over === 0, '36h は既定では超過ではない');
  e.lsSet('ow_limits', { G1: { min: null, max: 35 }, G2: {}, G3: {}, G4: {}, G5: {}, G6: {} });
  ok(e.scan('2026-07-05', ['F01'])[0].over === 1, '上限を35hにすると1h超過になる');
  ok(e.limits().G2.max === null, '空欄の側は見ない', e.limits().G2);
  ok(/ow_limits/.test(src.slice(src.indexOf('SUPA_SETTING_KEYS'), src.indexOf('SUPA_SETTING_KEYS') + 1200)),
    '枠の設定はクラウド同期の対象');
  const save = grab(src, 'saveOwLimits');
  ok(/mn>mx/.test(save), '下限が上限を超える入力を止める');
  ok(/\['gm','ceo'\]\.indexOf\(curRole\)<0/.test(save), '保存は GM・CEO のみ');
  ok(/\['gm','ceo'\]\.indexOf\(curRole\)<0/.test(grab(src, 'openOwLimitsModal')), '設定画面も GM・CEO のみ');
}

/* ---------- 9. 等級が取れない人 ---------- */
console.log('\n[9] 例外的なデータ');
{
  const e = build(TODAY, { F01: { '2026-07-06': { '謎の人': 60 } } }, EMPS);
  const r = e.scan('2026-07-05', ['F01'])[0];
  ok(r.grade === '', 'マスターに無い人は等級が空', r.grade);
  ok(r.over === 0 && r.state === 'ok', '等級不明の人に枠を当てはめない（誤検知しない）', r);
  ok(e.ec().length === 0, '等級不明はエラーセンターにも出さない');
  const e2 = build(TODAY, {}, EMPS);
  ok(e2.scan('2026-07-05', ['F01']).length === 0, '勤務データが無い週は空');
  ok(e2.period('F01', [], '').rows.length === 0, '週が1つも無くても落ちない');
}

/* ---------- 10. 読み取りだけ・既存への影響 ---------- */
console.log('\n[10] 副作用');
{
  const e = build(TODAY, { F01: { '2026-07-06': { A太: 41 } } }, EMPS);
  const before = JSON.stringify(e.store());
  e.scan('2026-07-05', null); e.ec(); e.period('F01', [{ sun: '2026-07-05' }], '');
  ok(JSON.stringify(e.store()) === before, '判定・通知は何も保存しない');
  ['owScanWeek', 'owWeekHours', 'owForPeriod', 'ecDetOverwork', 'renderLaborOverwork'].forEach(fn => {
    ok(!/lsSet\(/.test(grab(src, fn)), fn + ' は保存しない');
  });
  ok(/ecDetOverwork/.test(src.slice(src.indexOf('var EC_DETECTORS'), src.indexOf('var EC_DETECTORS') + 300)),
    'エラーセンターに登録されている');
  const before2 = (prev.match(/var EC_DETECTORS=\[([^\]]*)\]/) || [])[1] || '';
  const after2 = (src.match(/var EC_DETECTORS=\[([^\]]*)\]/) || [])[1] || '';
  ok(before2.split(',').every(x => after2.indexOf(x.trim()) >= 0), '既存の検知器を1つも外していない', { before2, after2 });
}

/* ---------- 11. 画面 ---------- */
console.log('\n[11] 画面');
{
  ok(prev.indexOf('renderLaborOverwork') < 0, 'v792 には無かった');
  const detail = grab(src, 'renderLaborDetail');
  ok(/renderLaborOverwork\(storeId, _ow, periodLabel\)/.test(detail), '勤怠明細にカードが出る');
  ok(/owForPeriod\(storeId, weeks, selWeek\)/.test(detail), '期間の評価は1回だけ');
  ok((detail.match(/owRowBadge\(/g) || []).length === 2, '明細の各行（時給・月給）に印が付く',
    (detail.match(/owRowBadge\(/g) || []).length);
  ok(/owGradeOfName\(e\.name\)/.test(detail), '行に等級を出す');
  ok(/openOwLimitsModal\(\)/.test(grab(src, 'renderLaborOverwork')), '枠の設定を開ける');
  ok(/tag-red/.test(grab(src, 'owRowBadge')) && /tag-yellow/.test(grab(src, 'owRowBadge')), '超過と不足で色を分ける');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
