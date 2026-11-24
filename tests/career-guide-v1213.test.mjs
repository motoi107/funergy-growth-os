// v1213（A-1・統合実装プロンプトの A・UI案101・Moto さんの答え 11/24）：「キャリア・育成」と制度・役割ガイドのマスター。
// 画面の FUNERGY_CAREER を VM で動かす（本物の Q4 のマスターと役割の文のマスター）。合成の役割だけ・個人の記録は使わない。
// 仕様：docs/GRADE_UNIFY_A_JA.md の 6（A-1）
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
  assert.match(html, /children:\['career','skill','ojt_admin','growth_mgr','leadership','growthhub'\]/);
  assert.match(html, /children:\['career','skill','ojtmap','totoya_docs'\]/);
  assert.match(html, /'biz_guide','career'\]\}/);
  assert.equal((html.match(/case 'career':\s+el\.innerHTML = \(window\.FUNERGY_CAREER \? FUNERGY_CAREER\.pageHtml\(\) : ''\); break;/g) || []).length, 2);
  assert.match(html, /var CREW_EXTRA_PAGES = \[[^\]]*'career'/);
  // 採用 › キャリア説明：既定は新しいガイド。旧の 4 つは「旧制度の説明（読むだけ）」の中
  assert.match(html, /if\(!window\._ceMode\) window\._ceMode='guide';/);
  assert.match(html, /var CE_OLD_MODES = \['internal','show','rolemap','respmatrix'\];/);
  assert.match(html, /FUNERGY_CAREER\.embedHtml\(mode==='cand' \? 'cand' : 'guide'\)/);
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
  assert.match(h, /基準点 <b style="font-size:22px">55<\/b>/, '評価の見方（Q4 のマスター）は出す');
  for (const g of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6']) assert.match(h, new RegExp("crSet\\('grade','" + g + "'\\)"));
  assert.doesNotMatch(h, /G7/);
  crew.crSet('view', 'map'); assert.match(crew.root(), /業務の分担は会社が確認中です/); assert.doesNotMatch(crew.root(), /Opening・Closing と各種リスト/);
  crew.crSet('view', 'cand'); assert.match(crew.root(), /等級ごとの役割の説明は準備中です/); assert.doesNotMatch(crew.root(), /手順とルールを守って基本の仕事/);
  for (const r of ['gm', 'ceo']) {
    const m = world({ role: r }); h = m.mount();
    assert.match(h, /文は案・会社の確認待ち/); assert.match(h, /Opening・Closing を手順どおりに終え/); assert.match(h, /GM・CEO だけに見えています/);
    m.crSet('view', 'map'); assert.match(m.root(), /Opening・Closing と各種リスト/); assert.match(m.root(), /◎/);
    m.crSet('view', 'cand'); assert.doesNotMatch(m.root(), /手順とルールを守って基本の仕事/, '候補者向けは公開まで GM・CEO の画面でも出さない');
  }
  const store = world({ role: 'gm' }); store.curStoreLogin = { store: 'S1' }; h = store.mount();
  assert.match(h, /役割の説明は会社が確認中です/, '店のタブレット（共有ログイン）は GM の役割でも案を出さない');
  for (const r of ['am', 'sl', 'office', 'office_crew', 'chef', 'g2', 'g4']) assert.match(world({ role: r }).mount(), /役割の説明は会社が確認中です/, r);
});

test('公開したら全員に出す・候補者向けにも要約・英語は確かめるまで日本語＋英訳確認中', () => {
  const p = world({ role: 'crew', status: 'published' });
  let h = p.mount();
  assert.match(h, /Opening・Closing を手順どおりに終え/); assert.doesNotMatch(h, /文は案/); assert.doesNotMatch(h, /会社が確認中/);
  p.crSet('view', 'cand'); assert.match(p.root(), /手順とルールを守って基本の仕事/);
  const e = world({ role: 'crew', status: 'published', lang: 'en' }); h = e.mount();
  assert.match(h, /English translation under review/); assert.match(h, /Opening・Closing を手順どおりに終え/, '英訳の案はスタッフに出さない');
  const eg = world({ role: 'gm', lang: 'en' }); h = eg.mount();
  assert.match(h, /English draft, under review/); assert.match(h, /Finish Opening and Closing by the procedure/);
  const ep = world({ role: 'crew', status: 'published', enStatus: 'published', lang: 'en' }); h = ep.mount();
  assert.doesNotMatch(h, /under review/); assert.match(h, /Finish Opening and Closing by the procedure/);
});

test('評価の見方は Q4 のマスターから（基準点・配点・最低条件・Prep の段）', () => {
  const w = world({ role: 'gm' }); w.mount();
  w.crSet('grade', 'G4');
  let h = w.root();
  assert.match(h, /基準点 <b style="font-size:22px">85<\/b>/);
  for (const [k, v] of Object.entries(master.systems.G.weights.G4['店長'].weights)) if (v > 0) assert.match(h, new RegExp('<b>' + v + '</b>'), k);
  assert.match(h, /理念 5 分類のそれぞれの平均 2\.25 以上/); assert.match(h, /サービスとKitchenのそれぞれの平均 2\.00 以上/);
  assert.match(h, /指定項目（01-13・01-14・01-09・01-16）がそれぞれ 2 点以上/);
  w.crSet('grade', 'G1'); w.crSet('type', 'Kitchen中心'); h = w.root();
  assert.match(h, /主担当（Kitchen）の平均 1\.50 以上/); assert.match(h, /他部門（サービス）の平均 1\.00 以上/); assert.doesNotMatch(h, /指定項目/, 'G1 に指定項目は無い');
  w.crSet('sys', 'S_CHEF'); w.crSet('grade', 'S3'); h = w.root();
  assert.match(h, /基準点 <b style="font-size:22px">75<\/b>/); assert.match(h, /衛生安全の平均 2\.00 以上/); assert.match(h, /品質管理の平均 2\.00 以上/);
  assert.doesNotMatch(h, /未担当（G だけ）/, 'S に未担当は無い');
  w.crSet('sys', 'PREP'); w.crSet('grade', 'P3'); h = w.root();
  assert.match(h, /1\.00 以上/); assert.match(h, /70% 以上/); assert.match(h, /Q1 分量・数量/);
  assert.doesNotMatch(h, /\$|wageUsd|1[7-9] ?ドル|時給 \d/, 'Prep の時給はガイドに出さない（別の決まり）');
  assert.match(h, /時給・Tip Rate・賞与・福利厚生は別の決まりです/);
  // 選べないものは選ばない（G7・知らない系統・型）
  const before = w.FUNERGY_CAREER.state();
  w.crSet('sys', 'G7'); w.crSet('grade', 'G7'); w.crSet('type', 'CEO');
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
