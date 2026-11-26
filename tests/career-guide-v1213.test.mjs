// v1213（A-1・統合実装プロンプトの A・UI案101・Moto さんの答え 11/24）：「キャリア・育成」と制度・役割ガイドのマスター。
// 画面の FUNERGY_CAREER を VM で動かす（本物の Q4 のマスターと役割の文のマスター）。合成の役割だけ・個人の記録は使わない。
// 仕様：docs/GRADE_UNIFY_A_JA.md の 6（A-1）
// v1222（docs/CAREER_HUB_V1222_JA.md）：制度・役割ガイド／役割と責任マップ／候補者向け／育成計画を 1 つの画面に。
//   最初の画面＝キャリアマップ（カード）→ カードを押すと 1〜5。業務の分担はマトリクス、候補者向けは同じマスターから。
//   試験の意図（案のあいだは出さない・公開したら出す・評価の数は Q4 のマスターから）は v1213 のまま、見る場所だけ新しい画面に合わせた。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { check, GRADES } from '../scripts/gen-index-roleguide.mjs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const guide = JSON.parse(fs.readFileSync(new URL('../careerscore/role-guide-q4-v1.json', import.meta.url), 'utf8'));
const master = JSON.parse(fs.readFileSync(new URL('../careerscore/cs-q4-v1.json', import.meta.url), 'utf8'));
const cut = (b, e) => { const a = html.indexOf(b), z = html.indexOf(e); assert.ok(a >= 0 && z > a, b); return html.slice(a, z + e.length); };
const CSQ4 = cut('/* ==== FUNERGY_CSQ4 gen begin ==== */', '/* ==== FUNERGY_CSQ4 gen end ==== */');
const RG = cut('/* ==== FUNERGY_ROLE_GUIDE gen begin ==== */', '/* ==== FUNERGY_ROLE_GUIDE gen end ==== */');
const MOD = cut('/* ==== FUNERGY_CAREER begin ==== */', '/* ==== FUNERGY_CAREER end ==== */');
const clone = v => JSON.parse(JSON.stringify(v));

function world({ role = 'crew', lang = 'ja', status, enStatus, allow = () => true } = {}) {
  const els = {};
  const c = {
    curRole: role, curLang: lang, curPage: 'career', curStoreLogin: null, gone: [],
    navGuardAllows: allow, go: p => c.gone.push(p), renderPage: p => c.gone.push('render:' + p),
    document: { getElementById: id => els[id] || null },
    setTimeout: () => 0,   // v1214：育成計画・過去の記録は関数から読む（この試験では読まない。tests/gp-app-a2.test.mjs）
  };
  c.window = c;
  c.t = (ja, en) => (c.curLang === 'en' ? (en != null ? en : ja) : ja);
  vm.createContext(c);
  vm.runInContext(CSQ4, c);
  vm.runInContext(RG, c);
  if (status) c.FUNERGY_ROLE_GUIDE.status = status;
  if (status === 'published') c.FUNERGY_ROLE_GUIDE.approval = { by: 'X', at: '2026-12-01' };
  if (enStatus) c.FUNERGY_ROLE_GUIDE.en.status = enStatus;
  vm.runInContext(MOD, c);
  c.mount = () => { const h = c.FUNERGY_CAREER.pageHtml(); els['cr-root'] = { innerHTML: '' }; return h; };
  c.root = () => els['cr-root'].innerHTML;
  return c;
}

test('マスター：形・項目の ID・G1〜G6（G7 は無い）・案のまま', () => {
  assert.equal(check(guide, master), true);
  assert.equal(guide.status, 'draft', 'Moto さんが確かめるまで案');
  assert.equal(guide.en.status, 'draft');
  assert.deepEqual(guide.systems.map(s => s.key), ['G', 'S_CHEF', 'S_OFFICE', 'PREP']);
  assert.deepEqual(guide.systems[0].grades.map(g => g.grade), GRADES.G);
  assert.doesNotMatch(JSON.stringify(guide.systems), /G7/, "制度は G1〜G6（G7 は文の中にも出さない）");
  // 数（基準点・配点・最低条件・時給）はここに書かない（正本は Q4 のマスター）
  assert.doesNotMatch(JSON.stringify(guide), /"(base|weights|minimum|wageUsd|pay|speedMin|rangeMin)":/);
  // 壊したものは止まる
  const bad = [
    g => { g.systems[0].grades[0].tasks[0].items = ['99-99']; },
    g => { g.systems[0].grades.push(Object.assign(clone(g.systems[0].grades[5]), { grade: 'G7' })); },
    g => { g.status = 'published'; },
    g => { g.systems[1].duties[0].marks.S9 = 'do'; },
    g => { g.systems[2].duties[0].marks.S1 = 'owner'; },
    g => { g.systems[0].grades[5].next = { ja: 'x', en: 'y' }; },
    g => { delete g.systems[3].grades[0].summary.en; },
    g => { g.basedOn = 'CAREER_2027_Q1_V1'; },
    g => { g.systems[0].duties.push(clone(g.systems[0].duties[0])); },
  ];
  for (const f of bad) { const g = clone(guide); f(g); assert.throws(() => check(g, master)); }
});

test('index.html：マスターの写しが今のファイルと同じ・版 1213・入口と旧の表', () => {
  const w = world();
  assert.deepEqual(clone(w.FUNERGY_ROLE_GUIDE), guide);
  { const v = (html.match(/const APP_VERSION = '(\d+)';/) || [])[1], w = (sw.match(/const SW_BUILD = '(\d+)';/) || [])[1]; assert.ok(Number(v) >= 1213, v); assert.equal(v, w); }   // 1213 以上（ページと SW が同じ）
  assert.match(html, /\{id:'career',\s+label:'キャリア・育成'[^}]*roles:\['ceo','gm','office','am','sl','crew','office_crew','chef','g2','g4'\]\}/);
  assert.match(html, /children:\['career','skill',('ojt_admin','growth_mgr',)?'leadership','growthhub'\]/);   // v1216（A-2-3）から OJT管理・成長管理を外す
  assert.match(html, /children:\['career','skill',('ojtmap',)?'totoya_docs'\]/);   // v1216（A-2-3）：OJTマップは廃止
  assert.match(html, /'biz_guide','career'\]\}/);
  assert.equal((html.match(/case 'career':\s+el\.innerHTML = \(window\.FUNERGY_CAREER \? FUNERGY_CAREER\.pageHtml\(\) : ''\); break;/g) || []).length, 2);
  assert.match(html, /var CREW_EXTRA_PAGES = \[[^\]]*'career'/);
  // 採用 › キャリア説明：v1222 から既定は候補者向け（制度・役割の説明はキャリア・育成の 1 か所だけ。前の 'guide' は候補者向けへ）。旧の 4 つは「旧制度の説明（読むだけ）」の中
  assert.match(html, /if\(!window\._ceMode \|\| window\._ceMode==='guide'\) window\._ceMode='cand';/);
  assert.match(html, /var CE_OLD_MODES = \['internal','show','rolemap','respmatrix'\];/);
  assert.match(html, /return h \+ FUNERGY_CAREER\.embedHtml\('cand'\);/);
  assert.match(html, /onclick="if\(window\.crGo\)crGo\('map'\);else go\('career'\)"/, '制度・役割はキャリア・育成で開く');
  // 旧の責任マトリクスは書けない
  assert.match(html, /function respLocked\(\)\{ return true; \}/);
  assert.match(html, /function saveRespMatrix\(mx\)\{ if\(respLocked\(\)\)\{[^}]*return; \}/);
  assert.match(html, /var canEdit=\(\['gm','ceo'\]\.indexOf\(curRole\)>=0\) && !respLocked\(\);/);
});

test('案のあいだ：スタッフ・候補者には役割の文を出さない／GM・CEO には「案」で出す', () => {
  const crew = world({ role: 'crew' });
  let h = crew.mount();
  assert.match(h, /キャリア・育成/); assert.match(h, /役割の説明は会社が確認中です/);
  assert.doesNotMatch(h, /Opening・Closing を手順どおりに終え/);
  assert.match(h, /基準点 55 点/, 'キャリアマップのカードは Q4 のマスターの基準点（役割の文の代わり）');
  for (const g of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6']) assert.match(h, new RegExp("crOpen\\('G','" + g + "'\\)"));
  assert.doesNotMatch(h, /G7（|'G7'/);
  crew.crOpen('G', 'G1'); assert.match(crew.root(), /<span>基準点<\/span><b>55<\/b>/, '評価の見方（Q4 のマスター）は出す');
  assert.match(crew.root(), /役割の説明は会社が確認中です/); assert.doesNotMatch(crew.root(), /Opening・Closing を手順どおりに終え/);
  crew.crSet('view', 'matrix'); assert.match(crew.root(), /業務の分担（責任マトリクス）は会社が確認中です/); assert.doesNotMatch(crew.root(), /Opening・Closing と各種リスト/);
  crew.crSet('view', 'cand'); assert.match(crew.root(), /等級ごとの役割の説明は準備中です/); assert.doesNotMatch(crew.root(), /手順とルールを守って基本の仕事/);
  for (const r of ['gm', 'ceo']) {
    const m = world({ role: r }); h = m.mount();
    assert.match(h, /文は案・会社の確認待ち/); assert.match(h, /GM・CEO だけに見えています/); assert.match(h, /手順とルールを守って基本の仕事/, 'カードに要約（案）');
    m.crOpen('G', 'G1'); const d = m.root();
    assert.match(d, /Opening・Closing を手順どおりに終え/);
    assert.match(d, /一般スタッフ：担当作業を学び[^<]* <span class="cr-note">\(Excel「配点・基準点案 52 行」\)<\/span>/, 'Excel の位置付けと出どころ');
    assert.match(d, /評価と昇格の考え方/); assert.match(d, /配点・基準点案 87 行/);
    m.crSet('view', 'matrix'); m.crSet('cat', 'all'); assert.match(m.root(), /Opening・Closing と各種リスト/); assert.match(m.root(), /◎/);
    m.crSet('view', 'cand'); assert.doesNotMatch(m.root(), /手順とルールを守って基本の仕事/, '候補者向けは公開まで GM・CEO の画面でも出さない');
    m.crOpen('G', 'G1', 1); assert.doesNotMatch(m.root(), /Opening・Closing を手順どおりに終え|担当作業を学び/, '候補者向けのカードも公開まで出さない');
  }
  const store = world({ role: 'gm' }); store.curStoreLogin = { store: 'S1' }; h = store.mount();
  assert.match(h, /役割の説明は会社が確認中です/, '店のタブレット（共有ログイン）は GM の役割でも案を出さない');
  for (const r of ['am', 'sl', 'office', 'office_crew', 'chef', 'g2', 'g4']) assert.match(world({ role: r }).mount(), /役割の説明は会社が確認中です/, r);
});

test('公開したら全員に出す・候補者向けにも要約・英語は確かめるまで日本語＋英訳確認中', () => {
  const p = world({ role: 'crew', status: 'published' });
  let h = p.mount();
  assert.match(h, /手順とルールを守って基本の仕事/); assert.doesNotMatch(h, /文は案/); assert.doesNotMatch(h, /会社が確認中/);
  p.crOpen('G', 'G1'); assert.match(p.root(), /Opening・Closing を手順どおりに終え/); assert.doesNotMatch(p.root(), /文は案|会社が確認中/);
  p.crSet('view', 'cand'); assert.match(p.root(), /部門Leader/, '候補者向けのカードは公開したら Excel の等級の位置付けの名前（G2・G3 など）');
  p.crOpen('G', 'G1', 1); assert.match(p.root(), /担当作業を学び、手順・品質・スピードの基準へ近づく/, '候補者向けは Excel の等級の位置付け');
  assert.doesNotMatch(p.root(), /02-02|育成計画/, '候補者向けに項目の ID・育成計画は出さない');
  const e = world({ role: 'crew', status: 'published', lang: 'en' }); h = e.mount();
  assert.match(h, /English translation under review/); e.crOpen('G', 'G1'); assert.match(e.root(), /Opening・Closing を手順どおりに終え/, '英訳の案はスタッフに出さない');
  const ed = world({ role: 'crew', lang: 'en' }); assert.doesNotMatch(ed.mount(), /English translation under review/, '役割の文が出ないあいだは英訳の知らせも出さない');
  const eg = world({ role: 'gm', lang: 'en' }); h = eg.mount();
  assert.match(h, /English draft, under review/); eg.crOpen('G', 'G1'); assert.match(eg.root(), /Finish Opening and Closing by the procedure/);
  const ep = world({ role: 'crew', status: 'published', enStatus: 'published', lang: 'en' }); h = ep.mount();
  assert.doesNotMatch(h, /under review/); ep.crOpen('G', 'G1'); assert.match(ep.root(), /Finish Opening and Closing by the procedure/);
});

test('評価の見方は Q4 のマスターから（基準点・配点・最低条件・Prep の段）', () => {
  const w = world({ role: 'gm' }); w.mount();
  w.crOpen('G', 'G4');
  let h = w.root();
  assert.match(h, /<span>基準点<\/span><b>85<\/b>/);
  for (const [k, v] of Object.entries(master.systems.G.weights.G4['店長'].weights)) if (v > 0) assert.match(h, new RegExp('<b>' + v + '</b>'), k);
  assert.match(h, /理念 5 分類のそれぞれの平均 2\.25 以上/); assert.match(h, /サービスとKitchenのそれぞれの平均 2\.00 以上/);
  assert.match(h, /指定項目（01-13・01-14・01-09・01-16）がそれぞれ 2 点以上/);
  w.crSet('grade', 'G1'); w.crSet('type', 'Kitchen中心'); h = w.root();
  assert.equal(w.FUNERGY_CAREER.state().view, 'detail', '前後の等級はカードの中で動く');
  assert.match(h, /主担当（Kitchen）の平均 1\.50 以上/); assert.match(h, /他部門（サービス）の平均 1\.00 以上/); assert.doesNotMatch(h, /指定項目/, 'G1 に指定項目は無い');
  w.crOpen('S_CHEF', 'S3'); h = w.root();
  assert.match(h, /<span>基準点<\/span><b>75<\/b>/); assert.match(h, /衛生安全の平均 2\.00 以上/); assert.match(h, /品質管理の平均 2\.00 以上/);
  assert.doesNotMatch(h, /未担当（G だけ）/, 'S に未担当は無い');
  w.crOpen('PREP', 'P3'); h = w.root();
  assert.match(h, /1\.00 以上/); assert.match(h, /70% 以上/); assert.match(h, /Q1 分量・数量/);
  assert.doesNotMatch(h, /\$|wageUsd|1[7-9] ?ドル|時給 \d/, 'Prep の時給はガイドに出さない（別の決まり）');
  assert.match(h, /時給・Tip Rate・賞与・福利厚生は別の決まりです/);
  // 選べないものは選ばない（G7・知らない系統・型）
  const before = w.FUNERGY_CAREER.state();
  w.crSet('sys', 'G7'); w.crSet('grade', 'G7'); w.crSet('type', 'CEO'); w.crOpen('G', 'G7'); w.crOpen('X', 'G1'); w.crSet('view', 'nope');
  assert.deepEqual(clone(w.FUNERGY_CAREER.state()), clone(before));
});

test('ほかのタブ：評価・振り返りは今の画面への入口（開けない画面のボタンは出さない）・過去の記録から旧の説明へ・端末に残さない', () => {
  // 育成計画・OJT と過去の記録の中身は v1214（A-2-2）から関数 secure-state の gp_*（tests/gp-app-a2.test.mjs）
  const crew = world({ role: 'crew', allow: p => ['mypage', 'career'].includes(p) });
  crew.mount();
  crew.crSet('tab', 'review'); assert.doesNotMatch(crew.root(), /go\('leadership'\)/); assert.match(crew.root(), /go\('mypage'\)/);
  crew.crSet('tab', 'history'); assert.doesNotMatch(crew.root(), /crOpenOld\(\)/);
  const gm = world({ role: 'gm' }); gm.mount();
  gm.crSet('tab', 'review'); assert.match(gm.root(), /go\('leadership'\)/);
  gm.crSet('tab', 'history'); assert.match(gm.root(), /crOpenOld\(\)/);
  gm.hiringTab = 'main'; gm.crOpenOld(); assert.equal(gm._ceMode, 'old'); assert.deepEqual(gm.gone.slice(-1), ['hiring']);
  // 端末に何も残さない（localStorage を使わない）。サーバーへは関数 secure-state（ssCall）だけ
  assert.doesNotMatch(MOD, /localStorage|sessionStorage|indexedDB|fetch\(|lsSet\(/);
});

test('旧の責任マトリクス：GM・CEO でも直せない（書く道が止まる）', () => {
  const src = name => { const i = html.indexOf('function ' + name + '('); assert.ok(i >= 0, name); let d = 0, j = html.indexOf('{', i); for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; } return html.slice(i, j + 1); };
  const saved = [], toasts = [];
  const c = { curRole: 'gm', t: (a) => a, showToast: (m) => toasts.push(m), boxes: [], u11Box: (...a) => c.boxes.push(a),
    getRespMatrix: () => ({ rows: [['棚卸', '●', '', '', '', '', '', '', '', '', '']] }), ssSaveRespMatrix: () => saved.push(1) };
  vm.createContext(c);
  vm.runInContext(['respLocked', 'saveRespMatrix', 'respReset', 'u11RespOpen'].map(src).join('\n'), c);
  c.saveRespMatrix({ rows: [] }); c.respReset(); c.u11RespOpen(0);
  assert.equal(c.boxes.length, 0); assert.equal(toasts.length, 2); assert.match(toasts[0], /読むだけ/);
});

test('v1215（A-3）：マイページ・Handbook（Grade・評価の章）・業務ガイドからキャリア・育成へ（読むだけ・本文は変えない）', () => {
  const v = (html.match(/const APP_VERSION = '(\d+)';/) || [])[1], w = (sw.match(/const SW_BUILD = '(\d+)';/) || [])[1];
  assert.ok(Number(v) >= 1215, v); assert.equal(v, w);
  assert.equal((html.match(/renderFavCard\(\) \+ \(window\.crMyCard \? crMyCard\(\) : ''\) \+ (myOjtCard\(\) \+ )?renderMypage\(\)/g) || []).length, 2);   // v1216：旧の OJT のカードは外す
  assert.match(html, /if\(\['ch3','ch5','ch7'\]\.indexOf\(c\.id\)>=0 && window\.crHbNote\) h\+=crHbNote\(\);/);
  assert.match(html, /return \(window\.crBizNote \? crBizNote\(\) : ''\) \+ renderGradeGuide\(\);/);
  const c = world({ role: 'crew' });
  assert.match(c.crMyCard(), /crGo\('plan'\)/); assert.match(c.crMyCard(), /crGo\('map'\)/);
  assert.match(c.crHbNote(), /旧制度の内容が含まれます/); assert.match(c.crBizNote(), /crGo\('matrix'\)/);
  c.mount();
  // v1222：前の行き先の名前（ブックマーク・ほかの画面のボタン）は今の表示へ。制度・役割ガイドの「役割と責任マップ」→ マトリクス、「等級ごと」→ キャリアマップ
  c.crGo('guide', 'map'); assert.deepEqual(c.gone.slice(-1), ['career']); assert.equal(c.FUNERGY_CAREER.state().view, 'matrix');
  c.crGo('guide', 'grade'); assert.equal(c.FUNERGY_CAREER.state().view, 'map');
  c.crGo('guide', 'cand'); assert.equal(c.FUNERGY_CAREER.state().view, 'cand');
  c.crGo('plan'); assert.equal(c.FUNERGY_CAREER.state().view, 'plan');
  c.crGo('guide'); assert.equal(c.FUNERGY_CAREER.state().view, 'map');
  c.crGo('nope', 'nope'); assert.equal(c.FUNERGY_CAREER.state().view, 'map', '知らないタブ・表示は変えない');
  const n = world({ role: 'crew', allow: p => p !== 'hiring' }); n.mount(); n.crGo('guide', 'cand'); assert.notEqual(n.FUNERGY_CAREER.state().view, 'cand', '採用を開けない人に候補者向けの表示は出さない');
});

test('v1222（Moto さん 11/26）：キャリアマップの職名（G1 Crew・G4 Store Manager・G5 Area Manager・G6 General Manager）と配属のラベルは案のあいだも全員に出す', () => {
  const card = (h, label) => { const i = h.indexOf('<span class="cr-card-g">' + label); assert.ok(i >= 0, label); return h.slice(i, h.indexOf('</button>', i)); };
  for (const [role, opts] of [['crew', {}], ['gm', {}], ['crew', { status: 'published' }]]) {
    const w = world({ role, ...opts }); const h = w.mount();
    assert.match(card(h, 'G1'), /cr-card-t">Crew</); assert.match(card(h, 'G4'), /cr-card-t">Store Manager</);
    assert.match(card(h, 'G5'), /cr-card-t">Area Manager<\/span><span class="cr-card-s">複数店舗・管轄責任</);
    assert.match(card(h, 'G6'), /cr-card-t">General Manager<\/span><span class="cr-card-s">全社運営責任</);
    assert.doesNotMatch(card(h, 'G1'), /一般スタッフ/); assert.doesNotMatch(card(h, 'G4'), /cr-card-t">店長/);
    const store = ['G1', 'G2', 'G3', 'G4', 'Chef S1', 'Chef S2', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
    const hq = ['G5', 'G6', 'Chef S3', 'Chef S4', 'Chef S5', 'Chef S6', '経理 S1', '経理 S2', '経理 S3', '経理 S4', '経理 S5', '経理 S6'];
    for (const g of store) { assert.match(card(h, g), /cr-asg-store[^<]*<i[^>]*><\/i> 店舗配属/, g); assert.doesNotMatch(card(h, g), /本部配属/, g); }
    for (const g of hq) { assert.match(card(h, g), /cr-asg-hq[^<]*<i[^>]*><\/i> 本部配属/, g); assert.doesNotMatch(card(h, g), /店舗配属/, g); }
    if (role === 'crew' && !opts.status) { assert.doesNotMatch(card(h, 'G2'), /cr-card-t/, 'ほかの職名（案）は公開まで出さない'); assert.doesNotMatch(card(h, 'Chef S3'), /Head Chef/); }
  }
  const c = world({ role: 'crew' }); c.mount(); c.crSet('view', 'cand'); const ch = c.root();
  assert.match(card(ch, 'G5'), /Area Manager/); assert.match(card(ch, 'G5'), /本部配属/, '候補者向けにも職名と配属');
  c.crOpen('G', 'G6'); assert.match(c.root(), /General Manager · 全社運営責任/); assert.match(c.root(), /本部配属/);
  const e = world({ role: 'crew', lang: 'en' }); const eh = e.mount();
  assert.match(card(eh, 'G5'), /Multi-store, area responsibility/); assert.match(card(eh, 'G5'), /HQ-based/); assert.match(card(eh, 'P1'), /Store-based/);
});

test('v1222（Moto さん 11/26・UI案102 の答え）：順は G → Prep → Chef → 経理・テーマカラー・組織マップの上司は決まりから（入力しない）', () => {
  const w = world({ role: 'gm' }); const h = w.mount();
  const lanes = [...h.matchAll(/<section class="cr-lane">[\s\S]*?<b>([^<]+)<\/b>/g)].map(m => m[1]);
  assert.deepEqual(lanes.map(x => x.split('（')[0].trim()), ['G', 'Prep', 'Chef の S', '経理の S']);
  const style = g => (h.match(new RegExp('style="([^"]*)" onclick="crOpen\\(\\\'[A-Z_]+\\\',\\\'' + g + '\\\'\\)"')) || [])[1] || '';
  assert.match(style('G1'), /--l:#F0661F/, 'G はアプリと同じオレンジ'); assert.match(style('P1'), /--c:#166534;--l:#15803D/, 'Prep は深緑');
  assert.match(style('S1'), /--c:#A16207;--l:#EAB308/, 'Chef は黄色（Chef S1 が先・経理 S1 はあと）');
  assert.ok(h.indexOf("crOpen('S_CHEF','S1')") < h.indexOf("crOpen('S_OFFICE','S1')"));
  assert.match(h, /--c:#7E22CE;--l:#9333EA;--b:#F3E8FD" onclick="crOpen\('S_OFFICE','S1'\)/, '経理は紫');
  // 上司：店舗配属＝店の G4・G4 本人と G4 のいない店＝管轄 AM（店舗マスター）・管轄 AM もいない店＝G6・本部と Head Chef＝—
  const gt = html.slice(html.indexOf('var GRADE_TITLES = {'), html.indexOf('function gradeOf(title)'));
  const P = [['E2', 'Gabe Gm', 'gm', 'ALL', 'General Manager'], ['A1', 'Ann Area', 'am', 'ALL', 'Area Manager'], ['C1', 'Cal Chef', 'chef', 'F01', 'Head Chef'],
    ['M1', 'Mia Manager', 'g4', 'F01', 'Store Manager'], ['S3', 'Sam Lead', 'sl', 'F01', 'Server Leader'], ['P1', 'Pia Prep', 'crew', 'F01', 'Prep'],
    ['B1', 'Ben Help', 'crew', 'F02', 'Crew', ['F01']], ['Z1', 'Zed Crew', 'crew', 'F03', 'Crew'], ['O1', 'Oki Office', 'office', 'OFFICE', 'Accountant'], ['R1', 'Gone Crew', 'crew', 'F01', 'Store Manager', [], '退職']]
    .map(([id, name, role, store, title, support, status]) => ({ id, name, role, store, title, support: support || [], status: status || '在籍' }));
  const o = world({ role: 'crew' });
  o.getEmployees = () => P; o.getStoresAll = () => [{ id: 'F01', name: 'Store A', am: 'Ann Area' }, { id: 'F02', name: 'Store B', am: 'Ann Area' }, { id: 'F03', name: 'Store C', am: '' }];
  vm.runInContext(gt + ';function empGrade(e){var g=gradeOf(e&&e.title);if(g)return g;var r=e&&e.role;if(r===\'gm\')return \'G6\';if(r===\'am\')return \'G5\';if(r===\'g4\'||r===\'chef\')return \'G4\';if(r===\'sl\')return \'G3\';if(r===\'g2\')return \'G2\';if(r===\'crew\'||r===\'office_crew\')return \'G1\';return \'\';}'
    + 'function gradeOf(t){if(!t)return \'\';var k=Object.keys(GRADE_TITLES);for(var i=0;i<k.length;i++){if(GRADE_TITLES[k[i]].indexOf(t)>=0)return k[i];}return \'\';}', o);
  o.mount();
  const rows = sid => { o.crSet('view', 'org'); o.crSet('org', sid); return Object.fromEntries([...o.root().matchAll(/<tr><td>([\s\S]*?)<\/tr>/g)].map(m => { const td = m[1].split('</td><td>').map(x => x.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()); return [td[0].split(' ')[0] + ' ' + td[0].split(' ')[1], td[3]]; })); };
  const a = rows('F01');
  assert.equal(a['Sam Lead'], 'Mia Manager （店の G4）'); assert.equal(a['Pia Prep'], 'Mia Manager （店の G4）');
  assert.equal(a['Mia Manager'], 'Ann Area （管轄 AM）', 'G4 本人は管轄の G5');
  assert.equal(a['Cal Chef'], '—', 'Head Chef は本部配属の職（店の G4 に数えない・上司の決まりの外）');
  assert.equal(a['Ben Help'], 'Ann Area （管轄 AM） （所属店）', '兼務は所属店の上司'); assert.equal(a['Ann Area'], '—');
  assert.ok(!('Gone Crew' in a), '退職の人は出さない（G4 にも数えない）');
  assert.equal(rows('F03')['Zed Crew'], 'Gabe Gm （G6）', '管轄 AM のいない店は G6');
  const hq = rows('HQ'); assert.equal(hq['Gabe Gm'], '—'); assert.equal(hq['Oki Office'], '—');
  assert.match(o.root(), /上司（報告先）は会社の決まりから自動で出しています（ここでは入力しません）/);
  o.crSet('org', 'F01'); o.crSet('person', 'S3'); assert.match(o.root(), /上司（報告先）<\/div><div class="cr-p">Mia Manager/);
});

test('v1222：遅れた cs4 の読み込みは、別の表示・別の画面・未保存の希望を消さない', async () => {
  const open = () => {
    const els = {}, pending = [], q = [];
    const c = {
      curRole: 'crew', curLang: 'ja', curPage: 'career', curStoreLogin: null, curUserName: 'Aki Crew', gone: [],
      navGuardAllows: () => true, go: p => c.gone.push(p), renderPage: () => {},
      document: { getElementById: id => els[id] || null, activeElement: null },
      ssCall: p => (p.action === 'cs4_me' || p.action === 'cs4_roster')
        ? new Promise(r => pending.push({ action: p.action, r }))
        : new Promise(() => {}),
      setTimeout: fn => { q.push(fn); return 0; },
    };
    c.window = c; c.t = ja => ja;
    vm.createContext(c);
    vm.runInContext(CSQ4, c); vm.runInContext(RG, c); vm.runInContext(MOD, c);
    const box = (html, fields) => {
      const node = { innerHTML: html, contains: n => (fields || []).indexOf(n) >= 0, querySelectorAll: () => fields || [] };
      els['cr-root'] = node;
      return node;
    };
    return { c, els, pending, flush: () => { while (q.length) q.shift()(); }, box };
  };
  const settle = async (pending, action, body) => {
    const hit = pending.filter(x => x.action === action);
    assert.ok(hit.length >= 1, action);
    hit.forEach(x => x.r(body));
    await new Promise(r => setTimeout(r, 30));
  };
  // 未保存の希望（入力中・値が default と違う）は作り直さない
  {
    const w = open();
    w.c.FUNERGY_CAREER.pageHtml(); w.flush();
    w.c.crSet('view', 'plan');
    const wish = { tagName: 'TEXTAREA', type: '', value: 'UNSAVED typed wish', defaultValue: 'saved wish' };
    const node = w.box('KEEP-WISH', [wish]);
    w.c.document.activeElement = wish;
    await settle(w.pending, 'cs4_me', { ok: true, j: { assign: { system: 'G', grade: 'G1', type: 'Server中心' } } });
    assert.equal(node.innerHTML, 'KEEP-WISH');
    assert.equal(wish.value, 'UNSAVED typed wish');
  }
  // 読み始めたあとに別の表示へ移っていたら、その表示を作り直さない
  {
    const w = open();
    w.c.FUNERGY_CAREER.pageHtml(); w.flush();
    w.c.crSet('view', 'plan');
    const node = w.box('KEEP-PLAN', []);
    await settle(w.pending, 'cs4_me', { ok: true, j: { assign: { system: 'G', grade: 'G1' } } });
    assert.equal(node.innerHTML, 'KEEP-PLAN');
  }
  // キャリアの画面を離れていたら、ほかの画面を描き直さない
  {
    const w = open();
    w.c.FUNERGY_CAREER.pageHtml(); w.flush();
    w.c.curPage = 'mypage';
    const node = w.box('KEEP-PAGE', []);
    await settle(w.pending, 'cs4_me', { ok: true, j: { assign: { system: 'G', grade: 'G1' } } });
    assert.equal(node.innerHTML, 'KEEP-PAGE');
    assert.deepEqual(w.c.gone, []);
  }
  // 同じ表示のまま、入力が無ければ描き直す（キャッシュした評価表が出る）
  {
    const w = open();
    w.c.FUNERGY_CAREER.pageHtml(); w.flush();
    const node = w.box('OLD-MAP', []);
    await settle(w.pending, 'cs4_me', { ok: true, j: { assign: { system: 'G', grade: 'G1', type: 'Server中心' } } });
    assert.match(node.innerHTML, /自分のキャリアを見る/);
    assert.match(node.innerHTML, /Server中心/);
    assert.doesNotMatch(node.innerHTML, /OLD-MAP/);
  }
  // 組織マップの cs4_roster も、入力中は描き直さない
  {
    const w = open();
    w.c.curRole = 'gm';
    w.c.FUNERGY_CAREER.pageHtml(); w.flush();
    w.box('TEMP', []);
    w.c.crSet('view', 'org'); w.flush();
    const field = { tagName: 'INPUT', type: 'text', value: 'typed', defaultValue: '' };
    const node = w.box('KEEP-ORG', [field]);
    await settle(w.pending, 'cs4_roster', { ok: true, j: { rows: [] } });
    assert.equal(node.innerHTML, 'KEEP-ORG');
    assert.equal(field.value, 'typed');
  }
});
