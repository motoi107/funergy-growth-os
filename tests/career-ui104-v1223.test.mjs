// v1223（UI案104・Moto さん 11/26 承認・docs/UI104_CAREER_JA.md）：キャリアマップ（A 階段＋C の行）・責任マトリクス・店舗別の組織図・詳細パネル。
// 画面の FUNERGY_CAREER を VM で動かす（本物の Q4 のマスターと役割の文のマスター）。人と店は合成。保存の通信は使わない。
// 確かめること：
//   ・G のメインの責任（Moto さんの文）は案のあいだもスタッフ・候補者に出す。ほかの役割の文（案）は GM・CEO だけ（今までどおり）
//   ・Career Score の対象は G2〜G6（G1 はスキルレベル）、Chef の S・経理の S は S1〜S6 すべて、Prep は Prep の評価表
//   ・境目：G1｜G2＝Career Score（点線）、G3｜G4＝マネージャー職（破線）、店舗｜本部＝G4｜G5・Chef S2｜S3（細い線）
//   ・給与の仕組み（Prep の時給の段を含む）は G4 以上（従業員マスターの G4〜G6）と GM・CEO だけ。スタッフ・店の共有ログイン・候補者向けには出さない
//   ・詳細はパネル（タブ）で開き、閉じると元の表示へ。マトリクスの業務の詳細・組織図の人の詳細も同じパネル
//   ・数は Q4 のマスター（基準点・最低条件・時給の段）。上司の決まりは v1222 のまま
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const guide = JSON.parse(fs.readFileSync(new URL('../careerscore/role-guide-q4-v1.json', import.meta.url), 'utf8'));
const master = JSON.parse(fs.readFileSync(new URL('../careerscore/cs-q4-v1.json', import.meta.url), 'utf8'));
const cut = (b, e) => { const a = html.indexOf(b), z = html.indexOf(e); assert.ok(a >= 0 && z > a, b); return html.slice(a, z + e.length); };
const CSQ4 = cut('/* ==== FUNERGY_CSQ4 gen begin ==== */', '/* ==== FUNERGY_CSQ4 gen end ==== */');
const RG = cut('/* ==== FUNERGY_ROLE_GUIDE gen begin ==== */', '/* ==== FUNERGY_ROLE_GUIDE gen end ==== */');
const MOD = cut('/* ==== FUNERGY_CAREER begin ==== */', '/* ==== FUNERGY_CAREER end ==== */');
const GT = html.slice(html.indexOf('var GRADE_TITLES = {'), html.indexOf('function gradeOf(title)'));
const clone = v => JSON.parse(JSON.stringify(v));
const RESP = ['自分のポジションを責任持ってやり切る', 'G1を育て、店を回す最初のリーダー', '専門領域でチームを率いるリーダー職', '店舗の全てに責任を持つマネージャー職', '管轄責任', '全社責任'];
const RESP_D = ['店舗を円滑に支え、店長を育てる本部職', 'PL全責任、経営戦略、採用、教育、仕組みで組織を運営、本部と店舗を繋ぐ'];
const sum = (k, i) => guide.systems.find(x => x.key === k).grades[i].summary.ja;
const PEOPLE = [['E2', 'Gabe Gm', 'gm', 'ALL', 'General Manager'], ['A1', 'Ann Area', 'am', 'ALL', 'Area Manager'], ['C1', 'Cal Chef', 'chef', 'F01', 'Head Chef'],
  ['M1', 'Mia Manager', 'g4', 'F01', 'Store Manager'], ['S3', 'Sam Lead', 'sl', 'F01', 'Server Leader'], ['K2', 'Kai Leader', 'g2', 'F01', 'Crew Leader'], ['U1', 'Aki Crew', 'crew', 'F01', 'Crew'],
  ['P1', 'Pia Prep', 'crew', 'F01', 'Prep'], ['B1', 'Ben Help', 'crew', 'F02', 'Crew', ['F01']], ['Z1', 'Zed Crew', 'crew', 'F03', 'Crew'], ['O1', 'Oki Office', 'office', 'OFFICE', 'Accountant']]
  .map(([id, name, role, store, title, support]) => ({ id, name, role, store, title, support: support || [], status: '在籍' }));
const STORES = [{ id: 'F01', name: 'Store A', am: 'Ann Area', chef: 'Cal Chef' }, { id: 'F02', name: 'Store B', am: 'Ann Area' }, { id: 'F03', name: 'Store C', am: '' }];

function world({ role = 'crew', lang = 'ja', status, me, store = null, allow = () => true } = {}) {
  const els = {}, calls = [];
  const c = {
    curRole: role, curLang: lang, curPage: 'career', curStoreLogin: store, gone: [], curUserName: me || '',
    navGuardAllows: allow, go: p => c.gone.push(p), renderPage: p => c.gone.push('render:' + p),
    document: { getElementById: id => els[id] || null },
    setTimeout: () => 0, ssCall: p => { calls.push(p.action); return new Promise(() => {}); },
    getEmployees: () => PEOPLE, getStoresAll: () => STORES,
  };
  c.window = c; c.calls = calls;
  c.t = (ja, en) => (c.curLang === 'en' ? (en != null ? en : ja) : ja);
  vm.createContext(c);
  vm.runInContext(CSQ4, c); vm.runInContext(RG, c);
  if (status) { c.FUNERGY_ROLE_GUIDE.status = status; c.FUNERGY_ROLE_GUIDE.approval = { by: 'X', at: '2026-12-01' }; }
  vm.runInContext(GT + ";function gradeOf(t){if(!t)return '';var k=Object.keys(GRADE_TITLES);for(var i=0;i<k.length;i++){if(GRADE_TITLES[k[i]].indexOf(t)>=0)return k[i];}return '';}"
    + "function empGrade(e){if(!e)return '';var g=gradeOf(e.title);if(g)return g;var r=e.role;if(r==='gm')return 'G6';if(r==='am')return 'G5';if(r==='g4'||r==='chef')return 'G4';if(r==='sl')return 'G3';if(r==='g2')return 'G2';if(r==='crew'||r==='office_crew')return 'G1';return '';}", c);
  vm.runInContext(MOD, c);
  c.mount = () => { const h = c.FUNERGY_CAREER.pageHtml(); els['cr-root'] = { innerHTML: '' }; return h; };
  c.root = () => els['cr-root'].innerHTML;
  c.st = () => c.FUNERGY_CAREER.state();
  return c;
}
const col = (h, k, g) => { const i = h.indexOf("onclick=\"crOpen('" + k + "','" + g + "')\""); assert.ok(i >= 0, k + g); return h.slice(h.lastIndexOf('<div class="cr-col', i), h.indexOf('</div></div>', i) + 12); };

test('v1223：G のメインの責任（Moto さんの文）は案のあいだもスタッフ・候補者に出す／ほかの役割の文（案）は GM・CEO だけ', () => {
  for (const r of ['crew', 'g2', 'g4', 'gm']) {
    const w = world({ role: r }); const h = w.mount();
    RESP.concat(RESP_D).forEach(x => assert.ok(h.includes(x), r + ' ' + x));
    if (r === 'gm') assert.ok(h.includes(sum('S_CHEF', 0)), 'GM には S の段に要約（案）');
    else { assert.ok(!h.includes(sum('S_CHEF', 0)), r); assert.match(h, /役割の説明は会社が確認中/); }
  }
  const c = world({ role: 'crew' }); c.mount(); c.crSet('view', 'cand'); const ch = c.root();
  RESP.forEach(x => assert.ok(ch.includes(x), '候補者向け ' + x)); assert.ok(!ch.includes(sum('S_CHEF', 0)));
  c.crOpen('G', 'G5', 1); assert.match(c.root(), /メインの責任<\/div><div class="cr-off-t">管轄責任<\/div><div class="cr-p">店舗を円滑に支え、店長を育てる本部職/);
  assert.doesNotMatch(c.root(), /育成計画<\/button>|給与の仕組み<\/button>|スキルと OJT<\/button>/, '候補者向けのパネルは役割・評価・次の段階だけ');
  // 英語：Moto さんの文の英訳は案なので GM・CEO だけ（スタッフは日本語のまま）
  const e = world({ role: 'crew', lang: 'en' }); assert.ok(e.mount().includes(RESP[0]));
  const eg = world({ role: 'gm', lang: 'en' }); assert.ok(eg.mount().includes('Own your position and see it through'));
});

test('v1223：Career Score の対象（G2〜G6・S1〜S6）・Prep は Prep の評価表・境目（CS・マネージャー職・店舗｜本部）', () => {
  const w = world({ role: 'crew' }); const h = w.mount();
  assert.match(col(h, 'G', 'G1'), /スキルレベル（CS 対象外）/); assert.doesNotMatch(col(h, 'G', 'G1'), /基準点/);
  for (const g of ['G2', 'G3', 'G4', 'G5', 'G6']) assert.match(col(h, 'G', g), new RegExp('基準点 ' + master.base.G[g.slice(1)]), g);
  for (const k of ['S_CHEF', 'S_OFFICE']) for (const g of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']) assert.match(col(h, k, g), new RegExp('基準点 ' + master.base.S[g.slice(1)]), k + g);
  assert.match(h, /Career Score の対象（G2〜G6）/); assert.match(h, /G1 は対象外（スキルレベル）/);
  assert.match(h, /Career Score の対象（Chef S1〜Chef S6）/); assert.match(h, /Career Score の対象（経理 S1〜経理 S6）/);
  assert.match(h, /Prep の評価表で段を決める（Career Score の点は使わない）/);
  // 境目：G2 の列に Career Score（cr-b-cs）、G4 の列にマネージャー職（cr-b-mgr）、本部配属は G5 と Chef S3 から（cr-b-asg）
  assert.match(col(h, 'G', 'G2'), /^<div class="cr-col cr-col-store cr-b-cs"[^>]*><span class="cr-flag cr-flag-cs">CS ここから<\/span>/);
  assert.match(col(h, 'G', 'G4'), /^<div class="cr-col cr-col-store cr-b-mgr"[^>]*><span class="cr-flag cr-flag-mgr">マネージャー職 ここから<\/span>/);
  assert.match(col(h, 'G', 'G5'), /^<div class="cr-col cr-col-hq cr-b-asg"/); assert.match(col(h, 'S_CHEF', 'S3'), /^<div class="cr-col cr-col-hq cr-b-asg"/);
  for (const [k, g] of [['G', 'G1'], ['G', 'G3'], ['G', 'G6'], ['PREP', 'P2'], ['S_OFFICE', 'S2']]) assert.doesNotMatch(col(h, k, g), /cr-b-(cs|mgr|asg)/, k + g);
  assert.equal((h.match(/cr-flag-cs/g) || []).length, 2, 'PC の列と、スマホのはしごの線（1 つずつ）'); assert.equal((h.match(/cr-flag-mgr/g) || []).length, 2);
  // スマホのはしご：配属の見出しと境目の線
  assert.match(h, /ここから Career Score の対象/); assert.match(h, /ここからマネージャー職/);
  // パネルの評価：G1 は対象外、Chef S1 は対象
  w.crOpen('G', 'G1'); w.crSet('ptab', 'eval'); assert.match(w.root(), /G1 は Career Score の対象外です（G2 から対象）/); assert.match(w.root(), /Career Score の対象外（スキルレベル）/);
  w.crOpen('S_CHEF', 'S1'); assert.match(w.root(), /<span>基準点<\/span><b>65<\/b>/); assert.match(w.root(), /cr-tag-cs">Career Score の対象/);
  w.crOpen('G', 'G3'); w.crSet('ptab', 'next'); assert.match(w.root(), /cr-flag-mgr" style="margin:0">ここからマネージャー職/);
  w.crOpen('G', 'G4'); assert.match(w.root(), /cr-tag-hq[^>]*><i[^>]*><\/i> 本部配属<\/span><span class="cr-note">（ここから）/);
});

test('v1223：給与の仕組みは G4 以上（従業員マスター）と GM・CEO だけ・数は Q4 のマスターから・個人の額は出さない', () => {
  const pay = master.systems.PREP.pay;
  const sees = (w, label) => { const h = w.mount(); assert.match(h, /G の給与の仕組み/, label); assert.match(h, /時給の段/, label); for (const p of pay) assert.ok(h.includes('$' + p.wageUsd), label + p.step);
    w.crOpen('PREP', 'P3'); w.crSet('ptab', 'pay'); assert.equal(w.st().ptab, 'pay', label); assert.match(w.root(), /この段（P3）は \$19（Q4 のマスター）/);
    w.crOpen('G', 'G4'); assert.match(w.root(), /G4 は 85 点（次の G5 は 90 点）/); assert.match(w.root(), /「Career Score」→「今期の評価」で確定・公開した評価で決めます/);
    w.crOpen('G', 'G1'); assert.match(w.root(), /Career Score を使う賞与 ① は G2 から（G1 は Career Score の対象外）/); };
  sees(world({ role: 'gm' }), 'gm'); sees(world({ role: 'ceo' }), 'ceo');
  sees(world({ role: 'g4', me: 'Mia Manager' }), 'G4（Store Manager）'); sees(world({ role: 'am', me: 'Ann Area' }), 'G5（Area Manager）');
  const notSee = (w, label) => { const h = w.mount(); assert.doesNotMatch(h, /給与の仕組み|時給の段|\$1\d|\$2\d/, label);
    w.crOpen('PREP', 'P3'); const before = w.st().ptab; w.crSet('ptab', 'pay'); assert.equal(w.st().ptab, before, label + '：給与の仕組みのタブは選べない');
    assert.doesNotMatch(w.root(), /給与の仕組み<\/button>|\$1\d/, label); };
  notSee(world({ role: 'crew', me: 'Aki Crew' }), 'G1'); notSee(world({ role: 'g2', me: 'Kai Leader' }), 'G2'); notSee(world({ role: 'sl', me: 'Sam Lead' }), 'G3');
  notSee(world({ role: 'gm', store: { store: 'F01' } }), '店の共有ログイン（GM の役割でも）');
  const c = world({ role: 'gm' }); c.mount(); c.crSet('view', 'cand'); assert.doesNotMatch(c.root(), /給与の仕組み|時給の段|\$1\d/, '候補者向け');
  c.crOpen('PREP', 'P3', 1); assert.doesNotMatch(c.root(), /給与の仕組み|\$1\d/);
  const e = c.FUNERGY_CAREER.embedHtml('cand'); assert.doesNotMatch(e, /給与の仕組み|時給の段|\$1\d/, '採用 › キャリア説明（候補者向け）');
  // 今ある決まりの文だけ（新しい額・条件は足さない）
  const g = world({ role: 'gm' }); g.mount(); g.crOpen('G', 'G4'); g.crSet('ptab', 'pay');
  assert.match(g.root(), /時給・Tip Rate・賞与・福利厚生は別の決まりです/); assert.match(g.root(), /個人の時給・Tip Rate・賞与の額はここに出しません/);
});

test('v1223：詳細パネル（タブ・前後の等級・閉じると元の表示）・マトリクスと組織図から開く', () => {
  const w = world({ role: 'gm' }); w.mount();
  assert.equal(w.st().view, 'map'); assert.doesNotMatch(w.root() || w.FUNERGY_CAREER.pageHtml(), /class="cr-panel"/);
  w.crOpen('G', 'G2'); let h = w.root();
  assert.match(h, /<aside class="cr-panel" role="dialog"/); assert.match(h, /cr-lay cr-lay-p/); assert.match(h, /cr-rail cr-rail-mini/);
  assert.match(h, /role="tab" aria-selected="true" class="cr-tab on" onclick="crSet\('ptab','role'\)"/);
  for (const t of ['eval', 'next', 'skill', 'plan', 'pay']) assert.match(h, new RegExp("crSet\\('ptab','" + t + "'\\)"), t);
  assert.match(h, /crOpen\('G','G2'\)" aria-current="true"/, 'マップの選んだ段に印');
  w.crSet('ptab', 'next'); w.crSet('grade', 'G3'); assert.equal(w.st().ptab, 'next', '前後の等級に動いてもタブはそのまま'); assert.equal(w.st().grade, 'G3');
  w.crClose(); assert.equal(w.st().view, 'map'); assert.doesNotMatch(w.root(), /class="cr-panel"/);
  w.crOpen('G', 'G1'); assert.equal(w.st().ptab, 'role', '閉じてから開くと役割のタブ'); w.crClose();
  // マトリクス：業務の行 → 業務の詳細 → 等級 → 等級のパネル → 閉じるとマトリクス（業務の詳細のまま）
  w.crSet('view', 'matrix'); w.crSet('duty', 'G-02'); h = w.root();
  assert.match(h, /トラブルの初期対応と指揮/); assert.match(h, /等級ごとの関わり/); assert.match(h, /根拠になる評価項目（Q4 のマスター）/);
  assert.match(h, /<span class="cr-id">02-12<\/span>トラブル時の初期対応を行う/);
  assert.match(h, /cr-mxr on/);
  w.crOpen('G', 'G4'); assert.equal(w.st().view, 'detail'); assert.equal(w.st().from, 'matrix'); assert.match(w.root(), /‹ 責任マトリクスに戻る/);
  w.crClose(); assert.equal(w.st().view, 'matrix'); assert.equal(w.st().duty, 'G-02');
  w.crClose(); assert.equal(w.st().duty, ''); w.crSet('col', 'G4'); assert.match(w.root(), /等級の分担（すべての分類）/);
  w.crClose(); assert.equal(w.st().col, '');
  // 組織図：人 → Grade の説明 → 閉じると組織図（人の詳細のまま）
  w.crSet('view', 'org'); w.crSet('org', 'F01'); w.crSet('person', 'S3'); assert.match(w.root(), /上司（報告先）<\/div><div class="cr-p">Mia Manager/); assert.match(w.root(), /この店の G4（Store Manager）です。/);
  w.crOpen('G', 'G3'); assert.equal(w.st().view, 'detail'); w.crClose(); assert.equal(w.st().view, 'org'); assert.equal(w.st().person, 'S3');
  // パネルの下：この等級の分担（マトリクス）・組織図で印
  w.crOpen('G', 'G4'); assert.match(w.root(), /crMx\('G','G4'\)/); assert.match(w.root(), /crOrgHl\('G4'\)/);
  w.crMx('G', 'G4'); assert.deepEqual([w.st().view, w.st().mxmode, w.st().col], ['matrix', 'grade', 'G4']); assert.match(w.root(), /cr-mxgb/);
  w.crOrgHl('G4'); assert.deepEqual([w.st().view, w.st().hl], ['org', 'G4']); assert.match(w.root(), /cr-nd hl/);
  // 選べないものは選ばない
  const before = clone(w.st());
  w.crSet('ptab', 'nope'); w.crSet('duty', 'X-99'); w.crSet('col', 'G7'); w.crSet('mxsys', 'X'); w.crSet('mxmode', 'x'); w.crSet('orgmode', 'x'); w.crSet('hl', 'G9'); w.crSet('track', 'X'); w.crSet('hide', 'X');
  assert.deepEqual(clone(w.st()), before);
});

test('v1223：責任マトリクス（系統ごと・分類と件数・業務で見る／等級で見る・記号は系統の色と重ねない）', () => {
  const w = world({ role: 'gm' }); w.mount(); w.crSet('view', 'matrix'); let h = w.root();
  const G = guide.systems.find(x => x.key === 'G');
  assert.match(h, /G（店舗・本部の運営）<\/b><span class="cr-note">· 日常業務 · \d+ 件/);
  assert.match(h, new RegExp("crSet\\('cat','all'\\)\"><span>すべて</span><span class=\"cr-cnt\">" + G.duties.length + '</span>'));
  for (const m of guide.marks) assert.match(h, new RegExp('cr-mk2-' + m.key), m.key);
  const css = w.FUNERGY_CAREER.pageHtml();
  assert.match(css, /\.cr-mk2-lead\{background:#1E3A8A;color:#fff;border-radius:12px\}/); assert.match(css, /\.cr-mk2-do\{background:#0F766E/); assert.match(css, /\.cr-mk2-support\{border:2px solid #64748B/); assert.match(css, /\.cr-mk2-approve\{background:#DBEAFE;color:#1D4ED8;border:2px solid #1D4ED8;border-radius:5px/);
  w.crSet('mxsys', 'S_CHEF'); h = w.root();
  assert.equal(w.st().mxsys, 'S_CHEF'); assert.match(h, /Chef の S（S Chef）<\/b><span class="cr-note">· 調理・品質管理 · 5 件/, 'Chef は日常業務が無いので最初の分類（調理・品質管理）');
  assert.doesNotMatch(h, /crSet\('cat','daily'\)/);
  w.crSet('mxmode', 'grade'); h = w.root(); assert.equal(w.st().col, 'S1'); assert.equal((h.match(/class="cr-mxgb"/g) || []).length, 4);
  w.crSet('mxsys', 'PREP'); w.crSet('mxmode', 'duty'); h = w.root(); assert.match(h, /PR-01|品質/);
  // スタッフは案のあいだ見られない（今までどおり）
  const c = world({ role: 'crew' }); c.mount(); c.crSet('view', 'matrix'); assert.match(c.root(), /業務の分担（責任マトリクス）は会社が確認中です/);
  assert.doesNotMatch(c.root(), /cr-mxr|cr-cnt|Opening/); c.crSet('duty', 'G-02'); assert.doesNotMatch(c.root(), /class="cr-panel"/);
});

test('v1223：店舗別の組織図（図が最初・本部の帯・店の G4・G4 のいない店・兼務・全店・一覧）。上司の決まりと出す項目は v1222 のまま', () => {
  const w = world({ role: 'crew' }); w.mount(); w.crSet('view', 'org'); w.crSet('org', 'F01'); let h = w.root();
  assert.equal(w.st().orgmode, 'chart');
  assert.match(h, /本部（この店にかかわる人）/); assert.match(h, /G6（全社）<\/span><button[^>]*><span class="cr-gc">G6<\/span><span><b>Gabe Gm<\/b>/);
  assert.match(h, /管轄 AM（店舗マスター）<\/span><button[^>]*><span class="cr-gc">G5<\/span><span><b>Ann Area<\/b>/); assert.match(h, /担当 Chef（店舗マスター）<\/span><button[^>]*>[\s\S]*?<b>Cal Chef<\/b>/);
  assert.match(h, /Store Manager（店の G4）<\/span><div class="cr-g4s"><button[^>]*><span class="cr-gc">G4<\/span><span><b>Mia Manager<\/b>/);
  assert.match(h, /兼務（応援）<span class="cr-cnt">1 人<\/span><\/span><button type="button" class="cr-nd cr-nd-d"[^>]*><span class="cr-gc">G1<\/span><span><b>Ben Help<\/b>/);
  assert.match(h, /Prep<span class="cr-cnt">1 人<\/span><\/span><button[^>]*><span><b>Pia Prep<\/b>/);
  assert.doesNotMatch(h.slice(h.indexOf('cr-stf')), /<b>Cal Chef<\/b>|<b>Ann Area<\/b>/, '本部の帯の人は店の枠に重ねて出さない');
  w.crSet('org', 'F02'); assert.match(w.root(), /この店には G4（Store Manager）がいません → 店の人の報告先は管轄 AM/);
  w.crSet('org', 'F03'); assert.match(w.root(), /この店には G4（Store Manager）も管轄 AM もいません → 店の人の報告先は G6/);
  w.crSet('org', '*'); h = w.root(); assert.match(h, /cr-ovc/); assert.match(h, /Store Manager：Mia Manager/); assert.match(h, /本部・Office<\/b>/);
  assert.match(h, /crSet\('org',&quot;F02&quot;\)/);
  w.crSet('org', 'HQ'); assert.match(w.root(), /<table class="cr-tbl cr-org">/, '本部は一覧');
  w.crSet('org', 'F01'); w.crSet('orgmode', 'list'); assert.match(w.root(), /<table class="cr-tbl cr-org">/);
  w.crSet('hl', 'G1'); assert.match(w.root(), /<tr class="hl">/);
  // 個人の評価・給与・連絡先・Q4 の評価表は出さない（採点できる人の一覧が無い人）
  assert.doesNotMatch(w.root(), /phone|email|時給|Tip Rate/i);
});

test('v1223：保存・新しい通信を足さない（読むのは今までの cs4_me・cs4_roster・gp_me・gp_roster だけ）・端末に残さない・版', () => {
  const acts = [...MOD.matchAll(/action:'([a-z0-9_]+)'/g)].map(m => m[1]);
  assert.deepEqual([...new Set(acts)].sort(), ['cs4_me', 'cs4_roster', 'gp_close', 'gp_copy', 'gp_get', 'gp_legacy', 'gp_me', 'gp_note', 'gp_plan_save', 'gp_roster', 'gp_task_act', 'gp_task_save']);
  assert.doesNotMatch(MOD, /localStorage|sessionStorage|indexedDB|fetch\(|lsSet\(/);
  const w = world({ role: 'gm' }); w.mount(); const t0 = w.calls.length;
  w.crOpen('G', 'G4'); for (const t of ['eval', 'next', 'skill', 'pay', 'role']) w.crSet('ptab', t); w.crClose();
  w.crSet('view', 'matrix'); w.crSet('duty', 'G-01'); w.crSet('view', 'org'); w.crSet('org', '*'); w.crSet('org', 'F01'); w.crSet('person', 'M1');
  assert.ok(w.calls.every(a => /^(cs4_me|cs4_roster|gp_me|gp_roster)$/.test(a)), JSON.stringify(w.calls.slice(t0)));
  const v = (html.match(/const APP_VERSION = '(\d+)';/) || [])[1]; assert.ok(Number(v) >= 1223, v);
  // PC の広い画面：キャリア・育成のマップ・マトリクス・組織図だけ .main を広げる（ほかの画面は今の幅）
  assert.equal((html.match(/document\.body\.classList\.toggle\('cr-wide', page === 'career' && !!\(window\.FUNERGY_CAREER && FUNERGY_CAREER\.wideView && FUNERGY_CAREER\.wideView\(\)\)\)/g) || []).length, 2);
  assert.match(html, /@media \(min-width:1180px\) \{ body\.cr-wide \.main \{ max-width:1500px; \} \}/);
  w.crSet('view', 'plan'); assert.equal(w.FUNERGY_CAREER.wideView(), false); w.crSet('view', 'map'); assert.equal(w.FUNERGY_CAREER.wideView(), true);
});
