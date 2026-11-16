// v1181：#173・#174 の Codex（6904392963・6904393429）の P3 と Claude のルーティン（#174 6904318744）の P3 の直し。
//   ① 古い「トッピング/アップセル比率」のカード：保存の答えを待つあいだに変えたチェックを、答えのあとの描き直しで消さない
//   ② 「全店共通に戻す」も保存と同じ世代の番号に入る（古い答えで新しい保存の状態を書き換えない）
//   ③ 業務用アカウントの一覧の引き継ぎ：ほかの店の保存の途中だと何もせずに「済み」になっていた → 待ってから作る・作れなければ「もう一度」
//   ④ 送れなかった理由ごとの文（起動の途中・まだ読み込んでいない）・ログアウトで KPI設定の下書きを捨てる
// 本物の関数（index.html）を VM で動かす。合成データだけ。本番にはつながない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
function fnSrc(name) {
  const m = new RegExp('^(async )?function ' + name.replace(/\$/g, '\\$') + '\\(', 'm').exec(SRC);
  if (!m) throw new Error('function not found: ' + name);
  let i = SRC.indexOf('{', m.index), depth = 0, q = null, tpl = [];
  for (; i < SRC.length; i++) {
    const ch = SRC[i], nx = SRC[i + 1];
    if (q) {
      if (ch === '\\') { i++; continue; }
      if (q === '`' && ch === '$' && nx === '{') { tpl.push(depth); depth++; q = null; i++; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '/' && nx === '/') { i = SRC.indexOf('\n', i); continue; }
    if (ch === '/' && nx === '*') { i = SRC.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (tpl.length && depth === tpl[tpl.length - 1]) { tpl.pop(); q = '`'; continue; }
      if (depth === 0) return SRC.slice(m.index, i + 1);
    }
  }
  throw new Error('unterminated: ' + name);
}
const plain = v => JSON.parse(JSON.stringify(v));

test('版：ページと SW が同じ（1181 以上）', () => {
  const a = +(SRC.match(/const APP_VERSION = '(\d+)'/) || [])[1], s = +(SW.match(/const SW_BUILD = '(\d+)'/) || [])[1];
  assert.ok(a >= 1181 && a === s, a + ' / ' + s);
});

/* 画面のチェックの代わり：value と checked を持つ。querySelectorAll('.kpi-upsell') と '.kpi-upsell:checked' に答える */
function upWorld({ user = 'Moto' } = {}) {
  const boxes = ['gA', 'gB', 'gC'].map(v => ({ value: v, checked: false }));
  const c = { Promise, Array, Date, Object, String, t: (j) => j, curUserName: user, curPage: 'kpi_master', toasts: [], rendered: 0, boxes, pushes: [], cfg: {} };
  c.window = { _kpiStore: 'F02', _kpiTab: 'manual' };
  c.showToast = (m, k) => c.toasts.push([m, k]); c.renderPage = () => { c.rendered++; };
  c.canSetKpiStore = () => true;
  c.document = { querySelectorAll: s => s === '.kpi-upsell:checked' ? boxes.filter(b => b.checked) : s === '.kpi-upsell' ? boxes : [] };
  c._lsPushP = {};
  /* 送るたびに答えを待つ（あとで res で返す） */
  c.setKpiConfigStore = (sid, p) => { c.cfg = Object.assign({}, c.cfg, p); c._lsPushP.kpi_config = new Promise(r => c.pushes.push(r)); };
  c.getKpiConfig = () => ({ byStore: { F02: Object.assign({}, c.cfg) } });
  c.setKpiConfig = (v) => { c.cfg = Object.assign({}, (v.byStore || {}).F02 || {}); c._lsPushP.kpi_config = new Promise(r => c.pushes.push(r)); };
  vm.createContext(c);
  ['kpiCfgPush', 'kpiCfgUnsavedMsg', 'upsellDraftMap', 'upsellDraftFor', 'upsellDraftDrop', 'upsellKeepDom', 'kpiSameView', 'saveUpsellGuids', 'clearKpiCfgStore', 'kpiDraftReset'].forEach(n => vm.runInContext(fnSrc(n), c));
  return c;
}
const check = (c, ...vs) => c.boxes.forEach(b => { b.checked = vs.includes(b.value); });
const flush = () => new Promise(r => setImmediate(r));

test('① 保存の答えを待つあいだに足したチェック（Codex の手順：A を保存 → 待つあいだに B → 成功）は、描き直しても残り「保存していない変更」と出る', async () => {
  const c = upWorld();
  check(c, 'gA');
  const p = c.saveUpsellGuids('F02');
  check(c, 'gA', 'gB');                      // 答えを待つあいだに B も選ぶ（画面だけ）
  c.pushes[0](true); assert.equal(await p, true);
  assert.deepEqual(c.cfg.upsellGuids, ['gA'], '保存したのは押したときの A だけ');
  assert.equal(c.rendered, 1);
  assert.deepEqual(plain(c.upsellDraftFor('F02')), { sid: 'F02', u: 'Moto', vals: ['gA', 'gB'] }, '描き直しても A+B を出す下書き');
  assert.equal(c.window._upsellSaveState.ok, true);
  /* もう一度「保存」：画面（A+B）を保存し、下書きはなくなる */
  const p2 = c.saveUpsellGuids('F02');
  assert.equal(c.upsellDraftFor('F02'), null, '押したら下書きは使い終わる');
  c.pushes[1](true); assert.equal(await p2, true);
  assert.deepEqual(c.cfg.upsellGuids, ['gA', 'gB']); assert.equal(c.upsellDraftFor('F02'), null);
  /* 変えなかったら下書きは作らない・外したチェックも残す */
  const d = upWorld(); check(d, 'gA', 'gB');
  const q = d.saveUpsellGuids('F02'); check(d, 'gA'); d.pushes[0](true); await q;
  assert.deepEqual(plain(d.upsellDraftFor('F02')).vals, ['gA'], '外したチェックも残す');
  const e = upWorld(); check(e, 'gC'); const r = e.saveUpsellGuids('F02'); e.pushes[0](true); await r;
  assert.equal(e.upsellDraftFor('F02'), null, '変えていなければ下書きなし');
  /* 送れなかったときも残す（「もう一度」で画面の A+B を送る） */
  const f = upWorld(); check(f, 'gA'); const s = f.saveUpsellGuids('F02'); check(f, 'gA', 'gB'); f.pushes[0](false); assert.equal(await s, false);
  assert.deepEqual(plain(f.upsellDraftFor('F02')).vals, ['gA', 'gB']); assert.equal(f.toasts.at(-1)[1], 'warning');
});

test('① 下書きはその店・ログインした人だけ。ほかの画面・店を見ているときは作らない。ログアウトで捨てる', async () => {
  const c = upWorld(); check(c, 'gA');
  const p = c.saveUpsellGuids('F02'); check(c, 'gA', 'gB'); c.window._kpiStore = 'F05'; c.pushes[0](true); await p;
  assert.equal(c.rendered, 0); assert.equal(c.window._upsellDraft, undefined, 'ほかの店を見ていたら描き直さず、下書きも作らない');
  const d = upWorld(); check(d, 'gA');
  const q = d.saveUpsellGuids('F02'); check(d, 'gA', 'gB'); d.pushes[0](true); await q;
  assert.ok(d.upsellDraftFor('F02')); assert.equal(d.upsellDraftFor('F05'), null, 'ほかの店には出さない');
  d.curUserName = 'Other'; assert.equal(d.upsellDraftFor('F02'), null, 'ほかの人のログインには出さない');
  d.curUserName = 'Moto'; d.window._upsEdits = { 'F04-K': {} }; d.window._upsEdit = {};
  d.kpiDraftReset();
  assert.equal(d.upsellDraftFor('F02'), null); assert.equal(d.window._upsEdits, null); assert.equal(d.window._upsEdit, null);
  /* ログアウト（doLogout の 2 つの写し）で呼ぶ */
  assert.equal((SRC.match(/if\(typeof kpiDraftReset==='function'\) kpiDraftReset\(\);/g) || []).length, 2);
  /* カード：下書きがあればそのチェックを出し、「保存していない変更」と出す */
  const card = fnSrc('renderKpiManualTab');
  assert.match(card, /var _upDraft = upsellDraftFor\(sid\);\n\s*if \(_upDraft\) upSel = _upDraft\.vals\.slice\(\);/);
  assert.match(card, /保存していない変更があります/);
});

test('② 「全店共通に戻す」と「保存」：あとで押したほうの答えだけが状態を決める（Codex の手順：新しい保存の成功のあとに古い戻しの失敗）', async () => {
  const c = upWorld(); check(c, 'gA');
  const clr = c.clearKpiCfgStore('F02', 'upsellGuids');   // 先に戻す（答えを待つ）
  const sv = c.saveUpsellGuids('F02');                     // あとで保存
  c.pushes[1](true); assert.equal(await sv, true);
  c.pushes[0](false); assert.equal(await clr, false);
  assert.equal(c.window._upsellSaveState.ok, true, '古い戻しの失敗で書き換えない');
  assert.equal(c.window._upsellSaveState.kind, undefined, '「もう一度」は保存のまま（戻しにならない）');
  assert.deepEqual(c.toasts.map(x => x[1]), ['success'], '古い答えの知らせは出さない');
  /* 逆の順：保存のあとに戻す → 古い保存の成功で「保存しました」にしない */
  const d = upWorld(); check(d, 'gA');
  const s2 = d.saveUpsellGuids('F02'), c2 = d.clearKpiCfgStore('F02', 'upsellGuids');
  d.pushes[1](false); await c2; d.pushes[0](true); await s2;
  assert.equal(d.window._upsellSaveState.ok, false); assert.equal(d.window._upsellSaveState.kind, 'clear');
  /* 戻すと下書きも捨てる */
  const e = upWorld(); check(e, 'gA'); const s3 = e.saveUpsellGuids('F02'); check(e, 'gA', 'gB'); e.pushes[0](true); await s3;
  assert.ok(e.upsellDraftFor('F02')); const c3 = e.clearKpiCfgStore('F02', 'upsellGuids'); assert.equal(e.upsellDraftFor('F02'), null); e.pushes[1](true); await c3;
  /* ドリンク・お酒のカテゴリの戻しは世代の番号を使わない */
  const f = upWorld(); f.window._upsellSaveSeq = 5; const c4 = f.clearKpiCfgStore('F02', 'drinkCats'); f.pushes[0](true); await c4;
  assert.equal(f.window._upsellSaveSeq, 5); assert.equal(f.window._upsellSaveState, undefined);
});

test('④ 送れなかった理由ごとの文：起動の途中・まだ読み込んでいない・送れなかった（答え true／false は今までどおり）', async () => {
  const c = upWorld(); check(c, 'gA');
  for (const [why, re] of [['booting', /起動の途中/], ['deferred', /まだ読み込んでいない/], [false, /クラウドに送れていません/]]) {
    const p = c.saveUpsellGuids('F02'); c.pushes.at(-1)(why); assert.equal(await p, false, String(why));
    assert.match(c.toasts.at(-1)[0], re); assert.equal(c.toasts.at(-1)[1], 'warning');
  }
  /* 送らなかった（同期 OFF など・答えの置き場が無い） */
  const d = upWorld(); d.setKpiConfigStore = () => { delete d._lsPushP.kpi_config; };
  assert.equal(await d.saveUpsellGuids('F02'), false); assert.equal(d.window._kpiCfgPushWhy, 'none'); assert.match(d.toasts.at(-1)[0], /クラウドに送れていません/);
  /* 戻すときの文 */
  const e = upWorld(); const q = e.clearKpiCfgStore('F02', 'upsellGuids'); e.pushes[0]('booting'); await q;
  assert.match(e.toasts.at(-1)[0], /^この端末では全店共通に戻しましたが、アプリの起動の途中/);
  assert.equal(await (async () => { const r = upWorld(); const p = r.saveUpsellGuids('F02'); r.pushes[0]('booting'); return p; })(), false, '"booting" を成功にしない');
  /* 業務用アカウントとアップグレード率（FUNERGY_UPS）の保存も同じ文 */
  assert.match(fnSrc('k2SysSave'), /showToast\(kpiCfgUnsavedMsg\(\),'warning'\)/);
  assert.match(SRC, /\(typeof kpiCfgUnsavedMsg === 'function'\) \? kpiCfgUnsavedMsg\(\)/);
});

/* ③ 業務用アカウントの一覧の引き継ぎ */
function kWorld() {
  const c = { Promise, Object, Array, JSON, String, Date, Math, setTimeout, console, LS: { kpi_config: {} }, TOASTS: [], RENDERS: 0, PUSH: { ok: true, wait: false, res: [] } };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(`
    var curRole='gm', curRealRole=null, curPage='kpi_master', _lsPushP={}, _k2SysBusy=false, curUserName='Moto';
    var CLOUD={ value:null, fail:false };
    async function wbFetchSetting(k){ if(CLOUD.fail) return undefined; return CLOUD.value==null ? { exists:false, value:null } : { exists:true, value:JSON.parse(JSON.stringify(CLOUD.value)) }; }
    async function pullSettingKey(k){ return false; }
    function t(ja){ return ja; } function showToast(m,k){ TOASTS.push([m,k]); } function renderPage(){ RENDERS++; } function mdCacheClear(){}
    function myAmStores(){ return []; }
    function getKpiConfig(){ return LS.kpi_config; }
    function setKpiConfigStore(sid, p){ var c=LS.kpi_config; c.byStore=c.byStore||{}; c.byStore[sid]=Object.assign({}, c.byStore[sid]||{}, p);
      _lsPushP['kpi_config'] = PUSH.wait ? new Promise(function(r){ PUSH.res.push(r); }) : Promise.resolve(PUSH.ok); }
    function k2SysCarryOver(sid){ return { 'g-sys': { name:'Toast Generic Login', on:true, src:'auto' } }; }
  `, c);
  ['k2SysAcctList', 'k2SysCanEdit', 'k2SysSave', 'k2SysCloudList', 'k2SysCarry', 'k2SysCarryRetry', 'kpiCfgPush', 'kpiCfgUnsavedMsg', 'kpiSameView'].forEach(n => vm.runInContext(fnSrc(n), c));
  c.window._kpiStore = 'F01';
  return c;
}

test('③ 業務用アカウント：ほかの店（F06）の保存の途中に F01 を開いても、F06 が終わるのを待って F01 の一覧を作る（Codex の手順）', async () => {
  const c = kWorld();
  c.PUSH.wait = true;
  const f06 = c.k2SysSave('F06', { x: { name: 'X', on: true } }, 'ok', 'sys');   // F06 の保存（答えを待つ）
  assert.equal(c._k2SysBusy, true);
  const f01 = c.k2SysCarry('F01');
  for (let i = 0; i < 5; i++) await flush();
  assert.equal(c._k2SysCarried.F01, 'busy', '待っているあいだは「作っています」（「済み」にしない）');
  assert.equal(c.k2SysAcctList('F01'), null);
  c.PUSH.res[0](true); await f06;                                                // F06 が終わる
  c.PUSH.wait = false;
  await f01;
  assert.ok(c.k2SysAcctList('F01'), 'F01 の一覧ができた'); assert.equal(c._k2SysCarried.F01, 'done');
  assert.deepEqual(Object.keys(c.k2SysAcctList('F01')), ['g-sys']);
  /* 待っているあいだに F01 の一覧がこの端末に入った（ほかの端末が作った一覧が同期で届いた）→ 上書きせず「済み」（もう保存しない） */
  const d = kWorld();
  d.PUSH.wait = true;
  const g06 = d.k2SysSave('F06', { x: { name: 'X', on: true } }, 'ok', 'sys');
  const g01 = d.k2SysCarry('F01');
  for (let i = 0; i < 5; i++) await flush();
  d.LS.kpi_config.byStore.F01 = { sysAcct: { 'g-other': { name: 'Other device', on: true, src: 'manual' } } };
  d.PUSH.res[0](true); await g06; d.PUSH.wait = false;
  await g01;
  assert.equal(d._k2SysCarried.F01, 'done');
  assert.deepEqual(Object.keys(d.k2SysAcctList('F01')), ['g-other'], 'ほかの端末の一覧を上書きしない');
  assert.equal(d.PUSH.res.length, 1, 'F01 はもう保存しない');
});

test('③ 待っても終わらない・この端末に作れなかった → 「済み」にせず「もう一度」（理由の文）。もう一度で作れる', async () => {
  const c = kWorld();
  c._k2SysBusy = true;                         // ほかの店の保存がずっと終わらない
  c.setTimeout = (fn) => setTimeout(fn, 0);    // 待つ時間を縮める（30 秒の上限まで回す）
  vm.runInContext('setTimeout = window.setTimeout;', c);
  await c.k2SysCarry('F01');
  assert.equal(c._k2SysCarried.F01, 'fail'); assert.equal(c._k2SysCarryWhy.F01, 'busy'); assert.equal(c.k2SysAcctList('F01'), null);
  c._k2SysBusy = false;
  await c.k2SysCarryRetry('F01');
  assert.equal(c._k2SysCarried.F01, 'done'); assert.ok(c.k2SysAcctList('F01')); assert.equal(c._k2SysCarryWhy.F01, undefined);
  /* この端末に入らなかった（保存の途中で例外など）→ 「もう一度」 */
  const d = kWorld();
  vm.runInContext('setKpiConfigStore = function(){ throw new Error("quota"); };', d);
  await d.k2SysCarry('F01');
  assert.equal(d._k2SysCarried.F01, 'fail'); assert.equal(d._k2SysCarryWhy.F01, 'save');
  /* 送れなかった（この端末には入った）→ 「済み」（k2SysSave の「未保存・もう一度」が出る） */
  const e = kWorld(); e.PUSH.ok = false;
  assert.equal(await e.k2SysCarry('F01'), false);
  assert.equal(e._k2SysCarried.F01, 'done'); assert.ok(e.k2SysAcctList('F01')); assert.match(e.TOASTS.at(-1)[0], /未保存/);
  /* クラウドを読めなかった → 今までどおり「読めなかった」 */
  const f = kWorld(); vm.runInContext('CLOUD.fail = true;', f);
  await f.k2SysCarry('F01'); assert.equal(f._k2SysCarried.F01, 'fail'); assert.equal(f._k2SysCarryWhy.F01, 'read');
  /* 画面の文：読めなかった／それ以外 */
  const tab = fnSrc('renderKpiSysAcctTab');
  assert.match(tab, /\(\(window\._k2SysCarryWhy\|\|\{\}\)\[sid\]\)\|\|'read'\)==='read'/);
  assert.match(tab, /一覧をまだ作れていません/);
});

/* #179 の Codex（6913975960）の P2：下書きは店ごと（ほかの店の保存で前の店の下書きを消さない） */
test('#179 の Codex の P2：F02 の保存していないチェックは、F06 を保存しても（変えずに・変えて）残る。F02 に戻ると出る', async () => {
  const c = upWorld(); check(c, 'gA');
  const p = c.saveUpsellGuids('F02'); check(c, 'gA', 'gB'); c.pushes[0](true); await p;
  assert.deepEqual(plain(c.upsellDraftFor('F02')).vals, ['gA', 'gB']);
  /* F06 へ移る（画面のチェックは F06 の保存した中身＝gC だけ）→ 変えずに保存 */
  c.window._kpiStore = 'F06'; check(c, 'gC');
  const q = c.saveUpsellGuids('F06'); c.pushes[1](true); await q;
  assert.deepEqual(plain(c.upsellDraftFor('F02')).vals, ['gA', 'gB'], 'F06 の保存で F02 の下書きを消さない（Codex の手順では null になっていた）');
  assert.equal(c.upsellDraftFor('F06'), null);
  /* F06 で保存の途中に変えた → F06 の下書き。F02 の下書きはそのまま */
  const r = c.saveUpsellGuids('F06'); check(c, 'gB', 'gC'); c.pushes[2](true); await r;
  assert.deepEqual(plain(c.upsellDraftFor('F06')).vals, ['gB', 'gC']); assert.deepEqual(plain(c.upsellDraftFor('F02')).vals, ['gA', 'gB']);
  /* F06 の「全店共通に戻す」は F06 の分だけ捨てる */
  const z = c.clearKpiCfgStore('F06', 'upsellGuids'); if (c.pushes[3]) c.pushes[3](true); await z;
  assert.equal(c.upsellDraftFor('F06'), null); assert.deepEqual(plain(c.upsellDraftFor('F02')).vals, ['gA', 'gB']);
  /* F02 を保存すると F02 の分だけ使い終わる */
  c.window._kpiStore = 'F02'; check(c, 'gA', 'gB'); const w = c.saveUpsellGuids('F02'); assert.equal(c.upsellDraftFor('F02'), null); c.pushes.at(-1)(true); await w;
  /* ログインした人が変わったら前の人の分は出さない・ログアウトで全部捨てる */
  const d = upWorld(); check(d, 'gA'); const x = d.saveUpsellGuids('F02'); check(d, 'gB'); d.pushes[0](true); await x;
  d.curUserName = 'Other'; assert.equal(d.upsellDraftFor('F02'), null);
  /* ほかの人が同じ端末で保存の途中に変えた → その人の下書き（前の人の分には混ぜない） */
  check(d, 'gA'); const y = d.saveUpsellGuids('F02'); check(d, 'gA', 'gC'); d.pushes.at(-1)(true); await y;
  assert.deepEqual(plain(d.upsellDraftFor('F02')).vals, ['gA', 'gC']);
  d.curUserName = 'Moto'; assert.equal(d.upsellDraftFor('F02'), null, '前の人の下書きは捨てている・ほかの人の分は出さない');
  d.kpiDraftReset(); assert.equal(d.upsellDraftFor('F02'), null);
});

/* #179 の Codex（6913975960）の要修正：待ったあとにクラウドを読み直す */
test('#179 の Codex の要修正：F06 の保存を待つあいだにほかの端末が F01 の一覧を作った（この端末には届いていない）→ 待ったあとクラウドを読み直し、前の決まりで作らない', async () => {
  const c = kWorld();
  vm.runInContext('pullSettingKey = async function(k){ LS.kpi_config = JSON.parse(JSON.stringify(CLOUD.value)); return true; };', c);
  c.PUSH.wait = true;
  const f06 = c.k2SysSave('F06', { x: { name: 'X', on: true } }, 'ok', 'sys');
  const f01 = c.k2SysCarry('F01');
  for (let i = 0; i < 5; i++) await flush();
  vm.runInContext("CLOUD.value = { byStore: { F01: { sysAcct: { 'g-sys': { name: 'Toast Generic Login', on: false, src: 'manual' } } } } };", c);
  c.PUSH.res[0](true); await f06; c.PUSH.wait = false;
  await f01;
  assert.equal(c._k2SysCarried.F01, 'done');
  assert.deepEqual(plain(c.k2SysAcctList('F01')['g-sys']), { name: 'Toast Generic Login', on: false, src: 'manual' }, 'ほかの端末の手の設定（外さない）を、前の決まり（外す・auto）で作り直さない');
  assert.equal(c.PUSH.res.length, 1, 'F01 は保存しない');
  /* 待ったあとにクラウドを読めない → 作らない（「読めなかった」） */
  const d = kWorld(); d.PUSH.wait = true;
  const g06 = d.k2SysSave('F06', { x: { name: 'X', on: true } }, 'ok', 'sys');
  const g01 = d.k2SysCarry('F01');
  for (let i = 0; i < 5; i++) await flush();
  vm.runInContext('CLOUD.fail = true;', d);
  d.PUSH.res[0](true); await g06; d.PUSH.wait = false;
  await g01;
  assert.equal(d._k2SysCarried.F01, 'fail'); assert.equal(d._k2SysCarryWhy.F01, 'read'); assert.equal(d.k2SysAcctList('F01'), null);
});
