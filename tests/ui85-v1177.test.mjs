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
