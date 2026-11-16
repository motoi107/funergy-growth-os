// v1177（UI案85・Moto さん 11/15 15:46 HST「１ A ２ 今のまま ３ A ４ A ５ A ６ A」）。
// 合成データ・本番に接続しない。index.html の関数を VM で動かすか、形を確かめる。画面の見た目は tests/e2e-pcsp/ui85-v1177.mjs（Chromium）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
function fnSrc(name) {
  const i = HTML.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name + ' がある');
  const j = HTML.indexOf('{', i);
  let depth = 0;
  for (let k = j; k < HTML.length; k++) { const ch = HTML[k]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return HTML.slice(i, k + 1); } }
  throw new Error('関数の終わりが無い：' + name);
}
const ctxOf = (extra = {}) => { const c = { Math, Number, String, Object, Array, JSON, isNaN, parseFloat, console, t: (j, e) => j, ...extra }; vm.createContext(c); return c; };

test('版：ページと SW が同じ（1177 以上）', () => {
  const a = +(HTML.match(/const APP_VERSION = '(\d+)'/) || [])[1], s = +(SW.match(/const SW_BUILD = '(\d+)'/) || [])[1];
  assert.ok(a >= 1177 && a === s, a + ' / ' + s);
});

test('1A タイル：押せるタイルは「›」・ボタン・キーボード。押せないタイルには印なし。目標は値の下・「タップで内訳」の文は無い', () => {
  const c = ctxOf(); vm.runInContext(fnSrc('kpiTileHtml'), c);
  const on = c.kpiTileHtml({ click: "openKpiDetail('kpid1')", icon: 'ti-cash', label: '売上', val: '$1,000', tgt: '目標 $900', sub: '下の行' });
  assert.match(on, /class="kpi-go"/); assert.match(on, /role="button"/); assert.match(on, /tabindex="0"/); assert.match(on, /onkeydown=/);
  assert.ok(on.indexOf('kpi-v') < on.indexOf('kpi-tg') && on.indexOf('kpi-tg') < on.indexOf('kpi-s'), '値 → 目標 → 下の行');
  const off = c.kpiTileHtml({ label: '客数', val: '—' });
  assert.ok(!/kpi-go|role="button"|onclick/.test(off));
  for (const f of ['budKpiCard', 'k2HoursTile']) assert.ok(!/タップで内訳|Tap for breakdown/.test(fnSrc(f).replace(/\/\*[\s\S]*?\*\//g, '')), f + ' に「タップで内訳」の行が無い（説明のコメントは除く）');
  assert.ok(/kpiTileHtml\(/.test(fnSrc('budKpiCard')) && /kpiTileHtml\(/.test(fnSrc('k2HoursTile')), '同じ形のタイル');
});

test('1A この先の日をたたむ：今月だけ・押すと開いて端末に覚える・もう一度で閉じる（覚えを消す）', () => {
  assert.match(HTML, /var _futFold = \(_dOff===0\) && days\.some/, '今月（_dOff===0）だけ');
  const mem = {};
  const mkRow = h => { const a = new Set(h ? ['hidden'] : []); return { hasAttribute: n => a.has(n), setAttribute: n => a.add(n), removeAttribute: n => a.delete(n) }; };
  const rows = [mkRow(true), mkRow(true)];
  const ic = { textContent: '▸' }, ac = { textContent: '' };
  const tr = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, querySelector: s => (s === '.bud-fold-ic' ? ic : s === '.bud-fold-act' ? ac : null), parentNode: { querySelectorAll: () => rows } };
  const c = ctxOf({ _smallGet: k => (k in mem ? mem[k] : null), _smallSet: (k, v) => { if (v == null) delete mem[k]; else mem[k] = v; }, budDlFit: () => {}, localStorage: {} });
  vm.runInContext(fnSrc('budFutIsOpen') + '\n' + fnSrc('budFutToggle'), c);
  assert.equal(c.budFutIsOpen(), false);
  c.budFutToggle(tr);
  assert.equal(mem._bud_fut_open, '1'); assert.ok(rows.every(r => !r.hasAttribute('hidden'))); assert.equal(ic.textContent, '▾'); assert.equal(tr.attrs['aria-expanded'], 'true');
  c.budFutToggle(tr);
  assert.ok(!('_bud_fut_open' in mem), '閉じたら覚えを消す'); assert.ok(rows.every(r => r.hasAttribute('hidden'))); assert.equal(ic.textContent, '▸');
});

test('3A・4A マイページ：PC は「仕事」「成長」の 2 列・管理者は証明と PIN を横に・スマホは印を消すだけ（並びは今のまま）', () => {
  const body = 'P<!--MPC:t:20-->[PIN]<!--MPC:w:20-->[W2]<!--MPC:t:10-->[ID]<!--MPC:g:10-->[G1]<!--MPC:w:10-->[W1]<!--MPC:t:30-->[T3]<!--MPC:g:20--> ';
  const run = (pc, mgr) => { const c = ctxOf({ empSmIsPc: () => pc, uiPcWatch1177: () => {} }); vm.runInContext(fnSrc('mpLayout'), c); return c.mpLayout(body, mgr); };
  const sp = run(false, false);
  assert.equal(sp, 'P[PIN][W2][ID][G1][W1][T3] ', 'スマホは今の並びのまま');
  const pc = run(true, false);
  assert.equal(pc, 'P<div class="mp-pair">[ID][PIN]</div>[T3]<div class="mp-pc" data-pcv="pc"><div class="mp-col"><div class="mp-colh"><i class="ti ti-briefcase"></i>仕事</div>[W1][W2]</div><div class="mp-col"><div class="mp-colh"><i class="ti ti-plant-2"></i>成長</div>[G1]</div></div>');
  const mg = run(true, true);
  assert.equal(mg, 'P[W2]<div class="mp-pair">[ID][PIN]</div>[G1][W1][T3]', '管理者は並びのまま・証明と PIN だけ横に（中身の無い区切りは捨てる）');
});

test('4A GM の店ごとの表・5A 月間行動計画の設定の表は PC だけ', () => {
  const pg = fnSrc('renderPGD');
  assert.match(pg, /pgd-pos/); assert.match(pg, /_pgTbl/);
  const cc = fnSrc('renderCcSetting');
  assert.match(cc, /if \(typeof empSmIsPc === 'function' && empSmIsPc\(\)\) \{[\s\S]{0,1200}<table class="inv-table cc-mx">/, 'PC のときだけ指標 × 店の表');
  assert.match(cc, /id="ct-' \+ mt\.id \+ '-' \+ st\.id \+ '"/, '入力の id は今までと同じ（ct-指標-店）');
});

test('6A スマホのグラフ：画面の幅で描く・文字 12（描いて 11px 以上）・目盛りは 1 つおき。PC は今の描き方', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ g: 20 + i, seg: 500 + i * 10, s: 300, ds: 200, full: true, mon: '2026-' + String(i + 1).padStart(2, '0'), wk: '2026-10-' + String(i + 1).padStart(2, '0'), from: '2026-10-' + String(i + 1).padStart(2, '0'), date: '2026-10-' + String(i + 1).padStart(2, '0'), days: 7 }));
  const draw = phone => { const c = ctxOf({ uiPcWatch1177: () => {}, escapeHtml: x => String(x == null ? '' : x).replace(/[&<>"']/g, ''), window: { matchMedia: () => ({ matches: phone }), innerWidth: 390 } });
    vm.runInContext(fnSrc('uiChartPhone') + '\n' + fnSrc('uiChartPhoneW'), c);
    try { vm.runInContext(fnSrc('lunChart'), c); return c.lunChart(rows, 'guests', {}); } catch (e) { return 'ERR ' + e.message; } };
  const sp = draw(true), pc = draw(false);
  assert.ok(!/^ERR /.test(sp) && !/^ERR /.test(pc), 'VM で描ける：' + sp.slice(0, 80) + ' / ' + pc.slice(0, 80));
  {
    assert.match(sp, /data-phw="1"/); assert.ok(!/data-phw/.test(pc));
    const vb = +sp.match(/viewBox="0 0 (\d+(?:\.\d+)?) /)[1];
    assert.ok(vb >= 270 && vb <= 460, 'viewBox の幅は画面の幅に近い ' + vb);
    const sizes = [...sp.matchAll(/font-size="([\d.]+)"/g)].map(m => +m[1]);
    assert.ok(sizes.length && Math.min(...sizes) >= 12, 'スマホの文字 ' + sizes.join(','));
    assert.ok([...pc.matchAll(/font-size="([\d.]+)"/g)].some(m => +m[1] < 12), 'PC は今の大きさ');
    const ticks = h => (h.match(/text-anchor="end"/g) || []).length;
    assert.equal(ticks(pc), 5, 'PC の目盛りの文字は 5 つ'); assert.equal(ticks(sp), 3, 'スマホは 1 つおき（3 つ）');
  }
  const lc = fnSrc('lcChartHtml');
  assert.match(lc, /\(typeof uiChartPhone === 'function'\) && uiChartPhone\(\)/, 'ランチチャレンジの区切りの中だけでも動く');
  assert.match(lc, /font-size="' \+ \(_ph \? 12 : 11\) \+ '" font-weight="700"/, '最後の点の数もスマホは 12');
  assert.ok(!/font-size="(?:[0-9]|10)"/.test(lc.replace(/_ph \? 12 : 11/g, '')), '固定の小さい文字が無い');
});

test('どの案でも直す：ランチ・ディナーのまとめ（スマホ）・会議の KPI推移・キャッシュチップの箱・箱の × の押す範囲', () => {
  const ld = fnSrc('ldSummaryCard');
  assert.match(ld, /<div class="ld-tw"><table class="ld-t"><colgroup><col class="ld-c0"/);
  assert.match(ld, /<span class="ld-lng">'\+t\('人時売上 ','Sales\/h '\)\+'<\/span><span class="ld-sht">'\+t\('人時 ','Sales\/h '\)/);
  const css = HTML.slice(HTML.indexOf('/* v1177（UI案85）：スマホのランチ・ディナーのまとめ'), HTML.indexOf('.ld-bar {'));
  for (const r of ['.ld-tw .ld-t .v { font-size:14px; }', '.ld-tw .ld-t .s { font-size:11px; }', '.ld-tw .ld-t col.ld-c0 { width:60px !important; }', 'position:sticky; left:0;', '.ld-tw .ld-t .s > span { display:block; }', '.ld-t .ld-sht { display:inline; }'])
    assert.ok(css.includes(r), 'スマホの決まり：' + r);
  /* 下の行の「・」と block は直接の子だけ（中の ld-lng／ld-sht を隠す・出すが効くように） */
  assert.ok(!/\.ld-t \.s span[ +{]/.test(HTML), '.ld-t .s span（子孫すべて）の決まりが残っていない');
  /* 会議の KPI推移：名前の列は止めたまま、スマホは 116px までにして名前を折り返す */
  assert.equal((HTML.match(/class="mkt-n" style="'\+sticky\+'/g) || []).length, 5, '名前の列の 5 つのセルに印');
  assert.ok(/@media \(max-width:767px\)\{\s*table td\.mkt-n, table th\.mkt-n \{ max-width:116px;[^}]*white-space:normal !important; \}/.test(HTML), 'スマホは 116px まで・折り返す');
  const ct = fnSrc('openCashTipModal');
  assert.ok(!/font-size:(?:[0-9]|10)(?:\.\d+)?px/.test(ct), 'キャッシュチップの箱に 11px 未満の文字が無い');
  assert.match(HTML, /if \(a && !\(a\.classList && a\.classList\.contains\('modal-overlay'\)\)\) return false;/, '箱の外側（閉じる onclick）を「押せる要素の中」と数えない');
});

/* ---------- #175 の Codex・Claude のレビュー（P2 2 つ）の直し ---------- */
// 小さな合成の DOM（本番にはつながない）：#main-content の子と入力欄だけ
function fakeDom() {
  const byId = () => all().find(Boolean);
  const mkField = (o) => ({ tagName: o.tag || 'INPUT', type: o.type || 'text', id: o.id || '', value: o.v ?? '', defaultValue: o.v ?? '', checked: !!o.ck, defaultChecked: !!o.ck, multiple: !!o.multi, options: o.options || [], files: o.files || null });
  const root = { kids: [], get firstChild() { return this.kids[0] || null; }, appendChild(n) { if (n && n.isFrag) { this.kids.push(...n.kids); n.kids = []; } else this.kids.push(n); return n; }, removeChild(n) { this.kids.splice(this.kids.indexOf(n), 1); return n; },
    querySelectorAll() { return this.kids.filter(k => k.field).map(k => k.field); }, contains(e) { return this.kids.some(k => k.field === e); } };
  function all() { return root.kids.map(k => k.field); }
  void byId;
  const doc = { getElementById: id => (id === 'main-content' ? root : (all().find(f => f && f.id === id) || null)), createDocumentFragment: () => ({ isFrag: true, kids: [], appendChild(n) { const i = root.kids.indexOf(n); if (i >= 0) root.kids.splice(i, 1); this.kids.push(n); return n; } }) };
  const paint = defs => { root.kids = defs.map(d => ({ field: mkField(d) })); };
  return { root, doc, paint, field: id => all().find(f => f && f.id === id) };
}
const KEEP_FNS = ['uiDirtyFields', 'uiRedrawKeep'];
function keepCtx(render) {
  const d = fakeDom(); const calls = [];
  const c = ctxOf({ document: d.doc, window: {}, renderPage: p => { calls.push(p); render(d, p); } });
  vm.runInContext(KEEP_FNS.map(fnSrc).join('\n'), c); return { c, d, calls };
}

test('#175 P2-1：幅をまたいだ描き直しで、まだ保存していない目標・必須のチェックを消さない（同じ id の欄に戻す・保存は呼ばない）', () => {
  // 月間行動計画 › 設定：PC の表とスマホの形で欄の id は同じ（ct-指標-店・cq-指標）。描き直すと保存済みの値（100・必須）に戻る
  const saved = [{ id: 'ct-sales-F01', v: '100' }, { id: 'cq-sales', type: 'checkbox', ck: true }, { id: 'ct-sales-F02', v: '50' }];
  const { c, d, calls } = keepCtx(dd => dd.paint(saved));
  d.paint(saved);
  d.field('ct-sales-F01').value = '999'; d.field('cq-sales').checked = false;   // 打っただけ（保存していない）
  assert.equal(c.uiRedrawKeep('cc_plan'), true);
  assert.deepEqual(calls, ['cc_plan'], '描き直した');
  assert.equal(d.field('ct-sales-F01').value, '999', '打った目標が残る（999 → 100 に戻らない）');
  assert.equal(d.field('cq-sales').checked, false, '外した必須が残る');
  assert.equal(d.field('ct-sales-F02').value, '50', '触っていない欄は保存済みのまま');
  // 残った値はまだ「保存していない」（保存ボタンで保存できる）
  const df = c.uiDirtyFields(d.root); assert.equal(df.list.length, 2);
});

test('#175 P2-1：残せない入力（id が無い・描き直すと欄が無くなる）は描き直さずに待つ。前の画面は中身ごとそのまま・同じ入力では何度も描かない', () => {
  // id の無い欄が変わっている → 描かない
  const a = keepCtx(dd => dd.paint([{ v: 'x' }]));
  a.d.paint([{ v: 'x' }]); a.d.root.kids[0].field.value = 'y';
  assert.equal(a.c.uiRedrawKeep('cc_plan'), false); assert.deepEqual(a.calls, [], 'id の無い欄が変わっていれば描かない');
  // 描き直すと同じ id の欄が無い → 前の画面（打った値ごと）に戻す
  const b = keepCtx(dd => dd.paint([{ id: 'other', v: '1' }]));
  b.d.paint([{ id: 'ct-x-F01', v: '100' }]); b.d.field('ct-x-F01').value = '999';
  assert.equal(b.c.uiRedrawKeep('cc_plan'), false);
  assert.equal(b.d.field('ct-x-F01').value, '999', '前の画面に戻り、打った値もそのまま');
  assert.equal(b.d.field('other'), undefined, '描き直した中身は捨てる');
  assert.equal(b.c.uiRedrawKeep('cc_plan'), false); assert.equal(b.calls.length, 1, '同じ入力ならもう一度描いてみない（重い画面を何度も描かない）');
  // 変わっていなければふつうに描き直す・ファイルを選んでいる・複数選びが変わっている → 待つ
  const e = keepCtx(dd => dd.paint([{ id: 'q', v: '1' }])); e.d.paint([{ id: 'q', v: '1' }]);
  assert.equal(e.c.uiRedrawKeep('mypage'), true); assert.deepEqual(e.calls, ['mypage']);
  const f = keepCtx(dd => dd.paint([])); f.d.paint([{ id: 'f', type: 'file', files: [1] }]); assert.equal(f.c.uiRedrawKeep('mypage'), false);
  const ms = () => [{ id: 's', tag: 'SELECT', multi: true, options: [{ selected: false, defaultSelected: false }, { selected: false, defaultSelected: false }] }];
  const g = keepCtx(dd => dd.paint(ms())); g.d.paint(ms()); g.d.field('s').options.forEach(o => { o.selected = true; });
  assert.equal(g.c.uiRedrawKeep('mypage'), false); assert.deepEqual(g.calls, [], '複数選びが変わっていれば描かない（値 1 つでは戻せない）');
  // ボタン・hidden は数えない
  const h = keepCtx(dd => dd.paint([])); h.d.paint([{ type: 'hidden', v: 'a' }]); h.d.root.kids[0].field.value = 'b'; assert.equal(h.c.uiRedrawKeep('mypage'), true);
});

test('#175：1 つ選ぶ欄は、selected の付いた選択肢が無くて先頭が選ばれているのを「変えた」と数えない（id の無い絞り込みで描き直しが止まらない）', () => {
  const sel = (id, v, defs) => ({ id, tag: 'SELECT', v, options: ['a', 'b', 'c'].map((x, i) => ({ value: x, selected: x === v, defaultSelected: !!defs[i] })) });
  // id の無い絞り込み：selected の付いたものが無い → ブラウザが先頭（a）を選ぶ＝変えていない
  const a = keepCtx(dd => dd.paint([sel('', 'a', [])])); a.d.paint([sel('', 'a', [])]);
  assert.equal(a.c.uiRedrawKeep('acct_review'), true); assert.deepEqual(a.calls, ['acct_review']);
  // selected が b に付いている → b のままなら変えていない、c にしたら変えた（id があれば戻す）
  const b = keepCtx(dd => dd.paint([sel('cl-days', 'b', [0, 1, 0])])); b.d.paint([sel('cl-days', 'b', [0, 1, 0])]);
  assert.equal(b.c.uiDirtyFields(b.d.root).list.length, 0);
  b.d.field('cl-days').value = 'c';
  assert.equal(JSON.stringify(b.c.uiDirtyFields(b.d.root).list.map(x => x.v)), '["c"]');
  assert.equal(b.c.uiRedrawKeep('diag_center'), true); assert.equal(b.d.field('cl-days').value, 'c', '選んだ値が残る');
  // 先頭が既定のとき、ほかを選んだら変えた（id が無ければ待つ）
  const c = keepCtx(dd => dd.paint([sel('', 'a', [])])); c.d.paint([sel('', 'a', [])]); c.d.root.kids[0].field.value = 'b';
  assert.equal(c.c.uiRedrawKeep('acct_review'), false); assert.deepEqual(c.calls, []);
});

test('#175 P2-1：見張りは描けなかったら 1.5 秒ごとに待つ（入力中・箱を開いているときと同じ）・描けたら終わる', () => {
  const s = fnSrc('uiPcWatch1177');
  assert.match(s, /done = uiRedrawKeep\(curPage\)/);
  assert.match(s, /if \(!done\) \{ clearTimeout\(on\._t\); on\._t = setTimeout\(on, 1500\); \}/);
  assert.ok(!/renderPage\(curPage\)/.test(s), '描き直しは必ず uiRedrawKeep を通す');
});

test('#175 P2-2：新しいタイルの並び（2 列・数ごとの列）は .kpi-wrap の中だけ。ほかの .kpi-grid（PC 4 列）は前のまま', () => {
  const css = HTML.slice(0, HTML.indexOf('</style>', HTML.indexOf('.kpi-wrap {')));
  assert.match(HTML, /\.kpi-grid \{ display: grid; grid-template-columns: repeat\(2, 1fr\); gap: 10px; \}\n@media\(min-width:600px\) \{ \.kpi-grid \{ grid-template-columns: repeat\(4, 1fr\); \} \}/, '前の決まり（600px から 4 列）');
  // 素の .kpi-grid { … } は前の 2 か所だけ。新しい決まりは .kpi-wrap > .kpi-grid か .kpi-grid[data-kn]
  const plain = [...css.matchAll(/(.{0,14})\.kpi-grid\s*\{/g)].filter(m => !/\.kpi-wrap\s*>\s*$/.test(m[1])).map(m => m[0]);
  assert.equal(plain.length, 2, '素の .kpi-grid の決まりは前の 2 つだけ ' + JSON.stringify(plain));
  const scoped = [...css.matchAll(/\.kpi-wrap\s*>\s*\.kpi-grid\s*\{/g)].length;
  assert.equal(scoped, 2, '新しい並びと fallback は .kpi-wrap > .kpi-grid だけ');
  assert.match(css, /\.kpi-wrap > \.kpi-grid \{ display:grid; gap:8px; grid-template-columns:repeat\(2,minmax\(0,1fr\)\); \}/);
  assert.match(css, /@supports not \(container-type:inline-size\) \{ \.kpi-wrap > \.kpi-grid \{/);
  // 並べ方の決まり（data-kn）は .kpi-wrap > .kpi-grid と同じ強さであとに書く（効く）
  assert.ok(css.indexOf('.kpi-grid[data-kn="4"]') > css.indexOf('.kpi-wrap > .kpi-grid {'));
});
