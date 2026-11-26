// キャリア・育成 A-2-2（v1214）：「育成計画・OJT」「過去の記録」のタブ（index.html の FUNERGY_CAREER）を VM で動かし、本物の関数 secure-state（gp_*）と
// 本物の SQL（PGlite）につなぐ。合成データだけ（名前は架空）。本番にはつながない。仕様：docs/GRADE_UNIFY_A_JA.md の 8
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setup } from './lib/gp-world.mjs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const cut = (b, e) => { const a = html.indexOf(b), z = html.indexOf(e); assert.ok(a >= 0 && z > a, b); return html.slice(a, z + e.length); };
const CSQ4 = cut('/* ==== FUNERGY_CSQ4 gen begin ==== */', '/* ==== FUNERGY_CSQ4 gen end ==== */');
const RG = cut('/* ==== FUNERGY_ROLE_GUIDE gen begin ==== */', '/* ==== FUNERGY_ROLE_GUIDE gen end ==== */');
const MOD = cut('/* ==== FUNERGY_CAREER begin ==== */', '/* ==== FUNERGY_CAREER end ==== */');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 画面：ひとりの人として開く。ssCall は本物の関数（PIN のログイン）へ。入力欄は id で値を入れる
function screen(S, who, role, { legacy = false } = {}) {
  const els = {}, toasts = [];
  const doc = { getElementById: id => els[id] || null };
  const c = { curRole: role, curLang: 'ja', curPage: 'career', curStoreLogin: null, curUserName: who, toasts, gone: [],
    navGuardAllows: () => true, go: p => c.gone.push(p), renderPage: () => {}, showToast: (m, k) => toasts.push([m, k]), document: doc,
    ssCall: async p => {
      const body = { ...p }; delete body.ms;
      const r = await S.pin(who, body);
      if (legacy) return { legacy: true };
      if (r.status === 200) return { ok: true, j: r.j };
      return { status: r.status, error: r.j.error };
    } };
  c.window = c; c.setTimeout = setTimeout;
  c.t = (ja, en) => (c.curLang === 'en' ? (en != null ? en : ja) : ja);
  vm.createContext(c);
  vm.runInContext(CSQ4, c); vm.runInContext(RG, c); vm.runInContext(MOD, c);
  c.page = () => { const h = c.FUNERGY_CAREER.pageHtml(); els['cr-root'] = { innerHTML: '' }; return h; };
  c.root = () => els['cr-root'].innerHTML;
  c.input = (id, v) => { els[id] = { value: v }; };
  c.idle = async () => { for (let i = 0; i < 40; i++) { await sleep(15); } };
  return c;
}

test('wiring: version 1214 in the page and the worker; old functions say legacy; the old OJT and growth screens point to the new plans', () => {
  const v = (html.match(/const APP_VERSION = '(\d+)';/) || [])[1], w = (sw.match(/const SW_BUILD = '(\d+)';/) || [])[1];
  assert.ok(Number(v) >= 1214, v); assert.equal(v, w);
  assert.match(html, /if\(j\.gpfn!==1 && typeof payload\.action==='string' && payload\.action\.indexOf\('gp_'\)===0\) return \{ legacy:true \};/);
  assert.equal((html.match(/case 'growth_mgr':\s+el\.innerHTML = \(window\.crOldBanner \? crOldBanner\(\) : ''\) \+ renderGrowthManager\(\);/g) || []).length, 2);
  assert.equal((html.match(/case 'ojt_admin':\s+el\.innerHTML = \(window\.crOldBanner \? crOldBanner\(\) : ''\) \+ renderOjtAdmin\(\);/g) || []).length, 2);
  assert.doesNotMatch(MOD, /localStorage|sessionStorage|indexedDB|lsSet\(|fetch\(/, 'nothing kept on the device; only the function');
});

test('a manager makes a plan and an OJT task; the person asks for a check; the named checker confirms with a basis; the screens show each step', async () => {
  const S = await setup();
  const g4 = screen(S, 'g4', 'sl');
  g4.page(); g4.crSet('tab', 'plan'); await g4.idle();
  let h = g4.root();
  assert.match(h, /育成計画を見る人/); assert.match(h, /Kai One/); assert.match(h, /まだ育成計画はありません/, 'the G4 has no plan of their own');
  await g4.crGp('open', 'E-1'); await g4.idle();
  h = g4.root(); assert.match(h, /育成計画を作る/);
  g4.input('gp-f-sys', 'G'); g4.input('gp-f-grade', 'G1'); g4.input('gp-f-type', 'Kitchen中心'); g4.input('gp-f-tg', 'G2'); g4.input('gp-f-target', 'Crew Leader');
  g4.input('gp-f-str', '工程を守る'); g4.input('gp-f-iss', '逆算'); g4.input('gp-f-next', '12/12');
  g4.input('gp-s-who-0', 'Leo'); g4.input('gp-s-when-0', '火・木'); g4.input('gp-s-what-0', '仕込み表'); g4.input('gp-s-how-0', '時刻と量');
  await g4.crGp('plan_new'); await g4.idle();
  h = g4.root();
  assert.match(h, /G1 · Kitchen中心/); assert.match(h, /CAREER_2026_Q4_V1/); assert.match(h, /OJT の課題を足す/);
  g4.input('gp-t-title', 'ランチの仕込み表'); g4.input('gp-t-items', '04-03、04-02'); g4.input('gp-t-std', '完成時刻に間に合う'); g4.input('gp-t-method', '別の日 3 回');
  g4.input('gp-t-opp', '火・木の開店前'); g4.input('gp-t-trainer', 'E-1B'); g4.input('gp-t-checker', 'E-4'); g4.input('gp-t-due', '2026-12-12');
  await g4.crGp('task_new'); await g4.idle();
  h = g4.root();
  assert.match(h, /ランチの仕込み表/); assert.match(h, /04-03 必要量と完成時刻から仕込みの段取りを組む/); assert.match(h, /指導者 Ben One · 確認者 Leo Four · 期限 2026-12-12/); assert.match(h, /未開始/);
  // 本人：自分の計画・希望・実施中 → 確認をお願いする（習得確認のボタンは無い）
  const me = screen(S, 'g1', 'crew');
  me.page(); me.crSet('tab', 'plan'); await me.idle();
  h = me.root();
  assert.match(h, /わたしの育成計画/); assert.match(h, /ランチの仕込み表/); assert.match(h, /自己採点ではありません/); assert.doesNotMatch(h, /育成計画を見る人/);
  assert.doesNotMatch(h, /習得を確かめた/); assert.doesNotMatch(h, /計画を保存/);
  me.input('gp-wish', '段取りを任されたい'); await me.crGp('wish'); await me.idle();
  const tid = (await S.db.query('select id from public.gp_tasks')).rows[0].id;
  await me.crGp('start', tid); await me.idle();
  me.input('gp-n-' + tid, '量は合ったが 10 分遅れた'); me.input('gp-st-' + tid, 'do'); await me.crGp('note', tid); await me.idle();
  await me.crGp('ask', tid); await me.idle();
  h = me.root(); assert.match(h, /確認待ち/); assert.match(h, /量は合ったが 10 分遅れた/); assert.match(h, /本人の実施/);
  // 指導者（同僚）：担当の一覧に出る・開ける・習得確認のボタンは無い
  const tr = screen(S, 'g1b', 'crew');
  tr.page(); tr.crSet('tab', 'plan'); await tr.idle();
  h = tr.root(); assert.match(h, /指導・確認の担当/); assert.match(h, /指導者/);
  await tr.crGp('open', 'E-1'); await tr.idle();
  h = tr.root(); assert.match(h, /再練習にする/); assert.doesNotMatch(h, /習得を確かめた/); assert.doesNotMatch(h, /計画を保存/);
  // 確認者（G4）：根拠なしは止まる → 根拠つきで確かめる
  await g4.crGp('reload'); await g4.idle(); await g4.crGp('open', 'E-1'); await g4.idle();
  assert.match(g4.root(), /習得を確かめた/);
  await g4.crGp('master', tid); await g4.idle();
  assert.match(g4.toasts.at(-1)[0], /理由・根拠が要ります/);
  g4.input('gp-n-' + tid, '別の日 3 回・時刻と量どおり'); await g4.crGp('master', tid); await g4.idle();
  h = g4.root(); assert.match(h, /習得確認済み/); assert.match(h, /根拠：別の日 3 回・時刻と量どおり/);
  const row = (await S.db.query('select state, mastered_by_name, mastered_basis from public.gp_tasks where id = $1', [tid])).rows[0];
  assert.deepEqual({ ...row }, { state: 'mastered', mastered_by_name: 'Leo Four', mastered_basis: '別の日 3 回・時刻と量どおり' });
  assert.equal((await S.db.query('select wish from public.gp_plans')).rows[0].wish, '段取りを任されたい');
  // ほかの人の版で保存しようとすると止まって読み直す
  const g4b = screen(S, 'g4', 'sl'); g4b.page(); g4b.crSet('tab', 'plan'); await g4b.idle(); await g4b.crGp('open', 'E-1'); await g4b.idle();
  await me.crGp('reload'); await me.idle(); me.input('gp-wish', '変えた'); await me.crGp('wish'); await me.idle();
  g4b.input('gp-f-tg', 'G2'); g4b.input('gp-f-target', 'x'); g4b.input('gp-f-str', 'y'); g4b.input('gp-f-iss', ''); g4b.input('gp-f-next', '');
  await g4b.crGp('plan_save'); await g4b.idle();
  assert.match(g4b.toasts.at(-1)[0], /ほかの人が先に変えました/);
});

test('past records: the person reads their own copies; GM copies and reads all; before the new function the tab says so and links the current screens', async () => {
  const S = await setup();
  const gm = screen(S, 'gm', 'gm');
  gm.page(); gm.crSet('tab', 'history'); await gm.idle();
  assert.match(gm.root(), /旧として保存/); assert.match(gm.root(), /旧の記録を写す/);
  await gm.crGpCopy(); await gm.idle();
  let h = gm.root();
  assert.match(h, /写した：足した 5 件・まだ写していない 0 件/); assert.match(h, /全部の写し/); assert.match(h, /OJT の受講 · Kai One/);
  const me = screen(S, 'g1', 'crew');
  me.page(); me.crSet('tab', 'history'); await me.idle();
  h = me.root();
  assert.match(h, /わたしの旧の記録/); assert.match(h, /OJT の受講 · Kai One/); assert.doesNotMatch(h, /Dup Name/, 'not other people'); assert.doesNotMatch(h, /旧の記録を写す/);
  const old = screen(S, 'g4', 'sl', { legacy: true });
  old.page(); old.crSet('tab', 'plan'); await old.idle();
  h = old.root(); assert.match(h, /まだ前の版です/); assert.match(h, /crGp\('reload'\)/);   // v1216（A-2-3）：旧の画面への入口は出さない（止めた）
  const n = await setup({ sql: false });
  const ns = screen(n, 'g1', 'crew'); ns.page(); ns.crSet('tab', 'plan'); await ns.idle();
  assert.match(ns.root(), /サーバーの準備がまだです（育成計画の表）/);
});

test('v1216（A-2-3）：旧の OJT・成長管理を止める — メニューから外す・古い行き先はキャリア・育成・旧の記録のキーは書かない・過去の記録から読むだけで開く', async () => {
  assert.doesNotMatch(html, /children:\['career','skill','ojt_admin'/); assert.doesNotMatch(html, /'growthhub','totoya_docs','crew_handbook'\]\},   \/\* v1213：キャリア・育成 \*\//);
  assert.match(html, /children:\['career','skill','totoya_docs'\]\},   \/\* v1216（A-2-3・Moto さん 11\/24）：OJTマップは廃止 \*\//);
  assert.match(html, /if \(page === 'ojtmap' \|\| \(\(page === 'ojt_admin' \|\| page === 'growth_mgr'\) && window\._crOldView !== page\)\)/);
  assert.match(html, /if\(window\.crFrozen && window\.crFrozen\(key\)\) return false;/);
  assert.doesNotMatch(html, /myOjtCard\(\) \+ renderMypage\(\)/, 'the old OJT card is not on My page');
  const S = await setup();
  const gm = screen(S, 'gm', 'gm');
  for (const k of ['ojt_enroll', 'grade_ojt', 'ojt_phase_map', 'ojt_gate_criteria', 'ojt_def_g3', 'trainees', 'dev_start', 'dev_data']) assert.equal(gm.crFrozen(k), true, k);
  // v1222（Moto さん・選択肢 A）：育成指名・Leaderを目指す・教材マスターは v1221 と同じく書く
  for (const k of ['career_cfg', 'career_history', 'skills', 'growth_karte', 'grade_hist', 'tip_history', 'ojtx', 'dev_nominations', 'dev_pipe', 'dev_pipe_start', 'train_master']) assert.equal(gm.crFrozen(k), false, k);
  const saved = {};
  const lsSetLike = (key, val) => { if (gm.crFrozen(key)) return false; saved[key] = val; return true; };
  assert.equal(lsSetLike('dev_nominations', [{ id: 'n1' }]), true);
  assert.equal(lsSetLike('dev_pipe', { Kai: { stage: 1 } }), true);
  assert.equal(lsSetLike('dev_pipe_start', { Kai: { d: '2026-11-01' } }), true);
  assert.equal(lsSetLike('train_master', { benefits: 'meal' }), true);
  assert.equal(lsSetLike('ojt_enroll', { x: 1 }), false);
  assert.deepEqual(saved.dev_nominations, [{ id: 'n1' }]);
  assert.equal(saved.ojt_enroll, undefined);
  // v1222：裏の書き込み（同期など）は黙って止める（ログインのたびに知らせが出ていた）。知らせは旧の画面で押したときだけ・1 分に 1 回
  assert.equal(gm.toasts.length, 0, 'no notice for background writes outside the old pages');
  gm.curPage = 'ojt_admin';
  for (const k of ['ojt_enroll', 'grade_ojt', 'trainees']) assert.equal(gm.crFrozen(k), true, k);
  assert.equal(gm.toasts.length, 1, 'one notice a minute on the old page (not a wall of toasts)');
  gm.curPage = 'career';
  gm.page(); gm.crSet('tab', 'history'); await gm.idle();
  assert.match(gm.root(), /crOpenOldPage\('ojt_admin'\)/); assert.match(gm.root(), /crOpenOldPage\('growth_mgr'\)/);
  gm.crOpenOldPage('ojt_admin'); assert.equal(gm._crOldView, 'ojt_admin'); assert.deepEqual(gm.gone.slice(-1), ['ojt_admin']);
  gm.crOpenOldPage('settings'); assert.deepEqual(gm.gone.slice(-1), ['ojt_admin'], 'only the two old pages');
  assert.match(gm.crOldBanner(), /保存はできません/);
});
