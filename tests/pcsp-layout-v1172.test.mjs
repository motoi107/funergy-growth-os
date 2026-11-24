// v1172（Moto さん 11/14 21:52 HST：UI案82「１〜５ A」）：PC・スマホの共通の決まり（FUNERGY_LAYOUT）と、
// 従業員マスターの PC の表と右のパネル。合成データだけ・本番に接続しない。index.html の中を VM で動かす。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const A = HTML.indexOf('/* ==== FUNERGY_LAYOUT start'), B = HTML.indexOf('/* ==== FUNERGY_LAYOUT end ==== */');
assert.ok(A > 0 && B > A, 'FUNERGY_LAYOUT の区切りがある');
const LAYOUT = HTML.slice(A, B);
function fnSrc(name) {
  const i = HTML.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name);
  let depth = 0, j = HTML.indexOf('{', i);
  for (let k = j; k < HTML.length; k++) { const ch = HTML[k]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return HTML.slice(i, k + 1); } }
  throw new Error(name);
}
const CSS = HTML.slice(HTML.indexOf('/* ===== v1172：PC・スマホの共通の決まり'), HTML.indexOf('</style>', HTML.indexOf('/* ===== v1172：PC・スマホの共通の決まり')));
const escapeHtml = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------- 版 ---------- */
test('版：APP_VERSION と SW_BUILD が 1172 以上でそろう', () => {
  const a = +(HTML.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1], b = +(SW.match(/SW_BUILD\s*=\s*'(\d+)'/) || [])[1];
  assert.ok(a >= 1172 && a === b, a + ' / ' + b);
});

/* ---------- 画面の幅 ---------- */
function layoutCtx(opt = {}) {
  const body = { _a: {}, setAttribute(k, v) { this._a[k] = v; }, removeAttribute(k) { delete this._a[k]; }, getAttribute(k) { return this._a[k]; } };
  const ctx = { console, Math, String, Number, Object, Array, JSON, parseFloat, isFinite, setTimeout: () => 0, Set, NodeFilter: { SHOW_TEXT: 4 } };
  ctx.window = ctx;
  ctx.document = Object.assign({ body, readyState: 'complete', visibilityState: 'visible', getElementById: () => null, querySelector: () => null, addEventListener() { }, documentElement: { clientWidth: 390 } }, opt.doc || {});
  if (opt.matchMedia) ctx.matchMedia = opt.matchMedia;
  if (opt.getComputedStyle) ctx.getComputedStyle = opt.getComputedStyle;
  ctx.innerHeight = 844;
  Object.assign(ctx, opt.globals || {});
  vm.createContext(ctx);
  vm.runInContext(LAYOUT, ctx);
  return ctx;
}
test('画面の幅：表・一覧は wide、カードの画面は std、文章と短いフォームは read、自分の幅を持つ画面は印なし', () => {
  const c = layoutCtx({ globals: { mdCanOpen: () => true } });
  const L = c.FUNERGY_LAYOUT;
  for (const p of ['budget', 'meeting', 'staff_master', 'skill', 'leadership', 'labor', 'attendance', 'kpi_master', 'tip', 'hiring']) assert.equal(L.layoutOf(p), 'wide', p);
  for (const p of ['mypage', 'store_cmd', 'settings']) assert.equal(L.layoutOf(p), 'std', p);
  assert.equal(L.layoutOf('handbook_x'), 'read');
  assert.equal(L.layoutOf('shift_admin'), '');
  assert.equal(L.layoutOf('chat'), '');
  assert.equal(L.layoutOf('dashboard'), 'wide');
  const c2 = layoutCtx({ globals: { mdCanOpen: () => false } });
  assert.equal(c2.FUNERGY_LAYOUT.layoutOf('dashboard'), 'std', '管理ダッシュボードを開けない人のダッシュボードはふつう');
});
test('画面の幅：renderPage を包んで、描く前に body[data-layout] を付ける（中身・戻り値は同じ）', () => {
  const seen = [];
  let atRender = null;
  const c = layoutCtx({ globals: { renderPage(p) { atRender = this.document.body._a['data-layout']; seen.push(p); return 'r:' + p; } } });
  c.document.body._a = {};
  assert.equal(c.renderPage('budget'), 'r:budget');
  assert.equal(atRender, 'wide');
  c.renderPage('shift_admin');
  assert.equal(c.document.body._a['data-layout'], undefined, 'シフト作成は印を外す');
  assert.deepEqual(seen, ['budget', 'shift_admin']);
});

/* ---------- スマホ：押せる範囲を広げる（となりとは間の半分まで） ---------- */
function fakeEl(rect, extra = {}) {
  const el = {
    tagName: extra.tag || 'BUTTON', _a: {}, style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, removeProperty(k) { delete this._p[k]; }, getPropertyValue(k) { return this._p[k] || ''; } },
    parentElement: { closest: () => null }, firstElementChild: null,
    matches: sel => /button/.test(sel), getClientRects: () => [rect], getBoundingClientRect: () => rect,
    hasAttribute(k) { return k in this._a; }, setAttribute(k, v) { this._a[k] = v; }, removeAttribute(k) { delete this._a[k]; }, getAttribute(k) { return this._a[k]; },
    querySelector: () => null,
  };
  el._cs = Object.assign({ display: 'inline-block', overflow: 'visible', overflowX: 'visible', overflowY: 'visible', position: 'static', fontSize: '13px' }, extra.cs || {});
  /* 本物の CSS と同じ：:where([data-hit][data-hitrel]) { position:relative }（強さ 0）は、元が static のときだけ効く */
  const basePos = el._cs.position;
  Object.defineProperty(el._cs, 'position', { enumerable: true, get: () => (basePos === 'static' && 'data-hit' in el._a && 'data-hitrel' in el._a) ? 'relative' : basePos });
  return el;
}
const R = (left, top, w, h) => ({ left, top, width: w, height: h, right: left + w, bottom: top + h });
/* phone：true＝スマホの幅（タッチ）／false＝PC（マウス・zoom）／'touch'＝タッチの端末で 768px 以上（iPad など）／'none'＝どれでもない */
function phoneRun(els, phone = true, texts = []) {
  const root = { querySelectorAll: sel => (/table/.test(sel) ? [] : /input/.test(sel) ? [] : els) };
  const tables = [];
  const mode = phone === true ? 'phone' : phone === 'touch' ? 'touch' : phone === 'none' ? 'none' : 'mouse';
  const c = layoutCtx({
    matchMedia: q => ({ matches: /767/.test(q) ? mode === 'phone' : /coarse/.test(q) ? (mode === 'phone' || mode === 'touch') : /hover: hover/.test(q) ? mode === 'mouse' : false }),
    getComputedStyle: (el, pseudo) => pseudo ? { content: 'none' } : (el._cs || { display: 'block', overflowX: 'visible', overflow: 'visible', overflowY: 'visible', position: 'static', fontSize: '13px' }),
    doc: { getElementById: id => (id === 'main-content' ? Object.assign(root, { querySelectorAll: sel => (/^table$/.test(sel) ? (tables.push(1), []) : /table/.test(sel) ? [] : /input/.test(sel) ? [] : els) }) : null),
      createTreeWalker: () => { let i = 0; return { nextNode: () => texts[i++] || null }; } },
  });
  c.FUNERGY_LAYOUT.run();
  c._tablesScanned = tables.length;
  return c;
}
const textOf = (px, word = 'abc') => { const el = fakeEl(R(0, 0, 40, 12), { tag: 'SPAN', cs: { fontSize: px + 'px' } }); el.closest = () => null; return { nodeValue: word, parentElement: el }; };
test('スマホ：小さい押すところは押せる範囲を 44px に。となりの押すところとは間の半分まで（重ならない）', () => {
  const a = fakeEl(R(10, 100, 30, 30)), b = fakeEl(R(50, 100, 30, 30)), solo = fakeEl(R(200, 300, 20, 20)), big = fakeEl(R(10, 400, 60, 48));
  phoneRun([a, b, solo, big]);
  const ext = el => ['--ht', '--hb', '--hl', '--hr'].map(k => parseFloat(el.style.getPropertyValue(k)) || 0);
  assert.ok(a.hasAttribute('data-hit') && b.hasAttribute('data-hit'));
  assert.deepEqual(ext(a), [7, 7, 7, 5], 'a の右は間（10px）の半分');
  assert.deepEqual(ext(b), [7, 7, 5, 7], 'b の左も間の半分');
  assert.deepEqual(ext(solo), [12, 12, 12, 12], 'まわりに何もなければ 44px');
  assert.ok(!big.hasAttribute('data-hit'), '44px 以上はそのまま');
  /* 広げたあとの大きさ：a は 44×42、となりの b と重ならない */
  const ea = ext(a), eb = ext(b);
  assert.ok(10 + 30 + ea[3] <= 50 - eb[2] + 0.01, '重ならない');
});
test('スマホ：文字の行の中・表の中・はみ出しを切る中の押すところは広げない／PC では何もしない', () => {
  const inl = fakeEl(R(10, 10, 20, 14), { cs: { display: 'inline' } }), cell = fakeEl(R(10, 60, 20, 14), { cs: { display: 'table-cell' } }), clip = fakeEl(R(10, 120, 20, 14), { cs: { overflow: 'hidden', overflowX: 'hidden' } });
  phoneRun([inl, cell, clip]);
  for (const e of [inl, cell, clip]) assert.ok(!e.hasAttribute('data-hit'));
  const x = fakeEl(R(10, 10, 20, 20));
  phoneRun([x], false);
  assert.ok(!x.hasAttribute('data-hit'), 'PC（768px 以上）では印を付けない');
});

test('スマホ：横に送る低い帯（店のボタンの列など）は、押す範囲が帯で切れる分だけ上下の余白を足し、同じだけ外の余白を減らす（ボタンは動かない・何度走らせても同じ）', () => {
  const mkStrip = (rect, bg = 'rgba(0, 0, 0, 0)') => {
    const sp = { _a: {}, clientHeight: rect.height, style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, removeProperty(k) { delete this._p[k]; }, getPropertyValue(k) { return this._p[k] || ''; } },
      hasAttribute(k) { return k in this._a; }, setAttribute(k, v) { this._a[k] = v; }, removeAttribute(k) { delete this._a[k]; }, getBoundingClientRect: () => sp._rect, closest: () => null };
    sp._rect = rect;
    sp._cs = { display: 'flex', overflowX: 'auto', overflowY: 'auto', overflow: 'auto', position: 'static', fontSize: '13px', backgroundColor: bg, borderTopWidth: '0px', borderBottomWidth: '0px', paddingTop: '6px', paddingBottom: '8px', marginTop: '0px', marginBottom: '6px' };
    return sp;
  };
  const strip = mkStrip(R(0, 100, 390, 41));
  const chip = fakeEl(R(10, 106, 40, 27)); chip.parentElement = strip;
  phoneRun([chip]);
  assert.ok(strip.hasAttribute('data-hitpad'));
  assert.deepEqual(['--hpt', '--hpb', '--p0t', '--p0b', '--m0t', '--m0b'].map(k => strip.style.getPropertyValue(k)), ['3px', '1px', '6px', '8px', '0px', '6px'], '上は 6px しか無いので 3px 足す・下は 8px で 1px 足す・元の余白を覚える');
  /* 余白を足したあと（帯の外側は 3px 上・1px 下に広がる）にもう一度走らせても同じ */
  strip._rect = R(0, 97, 390, 45); strip._cs.paddingTop = '9px'; strip._cs.marginTop = '-3px';
  phoneRun([chip]);
  assert.deepEqual(['--hpt', '--hpb', '--p0t', '--m0t'].map(k => strip.style.getPropertyValue(k)), ['3px', '1px', '6px', '0px'], '元の余白は最初に読んだまま');
  /* 背景色のある帯・高い帯は変えない */
  const colored = mkStrip(R(0, 100, 390, 41), 'rgb(255, 255, 255)'), c2 = fakeEl(R(10, 106, 40, 27)); c2.parentElement = colored;
  phoneRun([c2]);
  assert.ok(!colored.hasAttribute('data-hitpad'));
  const tall = mkStrip(R(0, 100, 390, 80)); tall.clientHeight = 80; const c3 = fakeEl(R(10, 106, 40, 27)); c3.parentElement = tall;
  phoneRun([c3]);
  assert.ok(!tall.hasAttribute('data-hitpad'));
  assert.match(CSS, /\[data-hitpad\] \{ padding-top:calc\(var\(--p0t\) \+ var\(--hpt\)\) !important;[\s\S]*?margin-top:calc\(var\(--m0t\) - var\(--hpt\)\) !important;/);
});
test('タッチの端末（iPad など・768px 以上）も押せる範囲を広げて 11px に。PC（マウス）は押す範囲は変えず、10px 未満の文字だけ 10px（zoom 1.1 で見た目 11px）', () => {
  /* タッチの端末（幅 1024px など）：押す範囲と 11px。表の固定（スマホの幅だけ）はしない */
  const a = fakeEl(R(10, 100, 30, 30)), t1 = textOf(8.5), t2 = textOf(10.5), t3 = textOf(12);
  const c = phoneRun([a], 'touch', [t1, t2, t3]);
  assert.ok(a.hasAttribute('data-hit'), 'タッチの端末でも押せる範囲を広げる');
  assert.deepEqual([t1, t2, t3].map(x => x.parentElement.hasAttribute('data-fs11')), [true, true, false]);
  assert.ok(![t1, t2, t3].some(x => x.parentElement.hasAttribute('data-fs10')));
  assert.equal(c._tablesScanned, 0, '表の固定はスマホの幅だけ');
  /* PC（マウス）：押す範囲はそのまま。10px より小さい文字だけ data-fs10（10〜10.9px は見た目 11px 以上なのでそのまま） */
  const b = fakeEl(R(10, 100, 30, 30)), p1 = textOf(8.5), p2 = textOf(9.5), p3 = textOf(10), p4 = textOf(10.5);
  phoneRun([b], false, [p1, p2, p3, p4]);
  assert.ok(!b.hasAttribute('data-hit'));
  assert.deepEqual([p1, p2, p3, p4].map(x => x.parentElement.hasAttribute('data-fs10')), [true, true, false, false]);
  assert.ok(![p1, p2, p3, p4].some(x => x.parentElement.hasAttribute('data-fs11')), 'PC では 11px の印を付けない（zoom で 12.1px になる）');
  /* スマホの幅：押す範囲・11px・表の固定 */
  const s1 = textOf(10.5), cp = phoneRun([fakeEl(R(10, 10, 20, 20))], true, [s1]);
  assert.ok(s1.parentElement.hasAttribute('data-fs11'));
  assert.equal(cp._tablesScanned, 1);
  /* どれでもない（matchMedia が無い等）：何もしない。空白だけの文字・svg の中は数えない */
  const n1 = textOf(8), sp = textOf(8, '  '), sv = textOf(8); sv.parentElement.closest = sel => (sel === 'svg' ? {} : null);
  phoneRun([fakeEl(R(10, 10, 20, 20))], 'none', [n1]);
  assert.ok(!n1.parentElement.hasAttribute('data-fs11') && !n1.parentElement.hasAttribute('data-fs10'));
  phoneRun([], 'touch', [sp, sv]);
  assert.ok(!sp.parentElement.hasAttribute('data-fs11') && !sv.parentElement.hasAttribute('data-fs11'));
  /* 最初の子が空白だけ（改行と字下げ）でも、あとの文字があればその要素を見る（v1172 の直し：KPI設定の注意書き 10px が残っていた） */
  const ws = textOf(10), real = { nodeValue: '昨対は…', parentElement: ws.parentElement }; ws.nodeValue = '\n   ';
  phoneRun([], true, [ws, real]);
  assert.ok(ws.parentElement.hasAttribute('data-fs11'));
});
/* ---------- 速さ（v1172 の直し：経理レビューのように押すところが数万ある画面で止まらない） ---------- */
/* 前の形（となりを全部見る）と同じ広げ方：同じ順で全部を見る。マス目で近くだけを見ても結果は同じであること */
function bruteExt(rects) {
  return rects.map((r, i) => {
    if (r.width >= 44 && r.height >= 44) return null;
    const e = { t: Math.max(0, (44 - r.height) / 2), b: Math.max(0, (44 - r.height) / 2), l: Math.max(0, (44 - r.width) / 2), r: Math.max(0, (44 - r.width) / 2) };
    for (let j = 0; j < rects.length; j++) {
      const q = rects[j]; if (j === i) continue;
      if (q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top) continue;
      const vOv = q.top < r.bottom + e.b && q.bottom > r.top - e.t, hOv = q.left < r.right + e.r && q.right > r.left - e.l;
      if (q.left >= r.right && vOv) e.r = Math.min(e.r, Math.max(0, (q.left - r.right) / 2));
      else if (q.right <= r.left && vOv) e.l = Math.min(e.l, Math.max(0, (r.left - q.right) / 2));
      if (q.top >= r.bottom && hOv) e.b = Math.min(e.b, Math.max(0, (q.top - r.bottom) / 2));
      else if (q.bottom <= r.top && hOv) e.t = Math.min(e.t, Math.max(0, (r.top - q.bottom) / 2));
    }
    return (e.t + e.b + e.l + e.r < 1) ? null : [e.t, e.b, e.l, e.r].map(v => +v.toFixed(1));
  });
}
test('速さ：となりは近くのマス目だけを見る。ばらばらに置いた押すところ（大きいもの・重なるもの・負の位置も）で、全部を見たときと同じ広げ方', () => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let round = 0; round < 6; round++) {
    const rects = [];
    for (let i = 0; i < 260; i++) {
      const big = rnd() < 0.08, w = big ? 200 + rnd() * 5000 : 8 + rnd() * 50, h = big ? 40 + rnd() * 3000 : 8 + rnd() * 50;
      rects.push(R(Math.round(rnd() * 900 - 300), Math.round(rnd() * 2600 - 600), Math.round(w), Math.round(h)));
    }
    const els = rects.map(r => fakeEl(r));
    phoneRun(els);
    const got = els.map(el => el.hasAttribute('data-hit') ? ['--ht', '--hb', '--hl', '--hr'].map(k => parseFloat(el.style.getPropertyValue(k))) : null);
    assert.deepEqual(got, bruteExt(rects), 'round ' + round);
  }
});
test('速さ：押すところと文字は、先に全部読んでからまとめて書く（1 つ書くたびにレイアウトし直さない）', () => {
  /* 書いたあとの最初の読みでレイアウトし直す（数えて、きれいに戻す）。前の形は押すところ 1 つごとに 1 回（40 回以上） */
  let dirty = false, readsAfterWrite = 0;
  const watchEl = el => {
    const sa = el.setAttribute.bind(el), sp = el.style.setProperty.bind(el.style), gb = el.getBoundingClientRect, gc = el.getClientRects;
    el.setAttribute = (k, v) => { dirty = true; sa(k, v); };
    el.style.setProperty = (k, v) => { dirty = true; sp(k, v); };
    el.getBoundingClientRect = () => { if (dirty) { readsAfterWrite++; dirty = false; } return gb(); };
    el.getClientRects = () => { if (dirty) { readsAfterWrite++; dirty = false; } return gc(); };
    return el;
  };
  const els = []; for (let i = 0; i < 40; i++) els.push(watchEl(fakeEl(R(10 + (i % 8) * 40, 100 + Math.floor(i / 8) * 40, 30, 30))));
  const texts = []; for (let i = 0; i < 20; i++) { const t = textOf(8 + (i % 5)); watchEl(t.parentElement); texts.push(t); }
  const root = { querySelectorAll: sel => (/table/.test(sel) ? [] : /input/.test(sel) ? [] : els) };
  const c = layoutCtx({
    matchMedia: q => ({ matches: /767/.test(q) || /coarse/.test(q) }),
    getComputedStyle: (el, pseudo) => { if (dirty) { readsAfterWrite++; dirty = false; } return pseudo ? { content: 'none' } : (el._cs || { display: 'block', overflow: 'visible', overflowX: 'visible', overflowY: 'visible', position: 'static', fontSize: '13px' }); },
    doc: { getElementById: id => (id === 'main-content' ? root : null), createTreeWalker: () => { let i = 0; return { nextNode: () => texts[i++] || null }; } },
  });
  c.FUNERGY_LAYOUT.run();
  assert.ok(els.every(e => e.hasAttribute('data-hit')), '押すところの印は付く ' + els.filter(e => !e.hasAttribute('data-hit')).length);
  assert.ok(texts.some(t => t.parentElement.hasAttribute('data-fs11')), '文字の印は付く');
  /* 文字の印を書いたあと押すところを読む前の 1 回と、押すところをまとめて書いたあとに relative になったかを確かめる 1 回（#169 の Codex 6900411328 の P3） */
  assert.ok(readsAfterWrite <= 2, '書いたあとに読むのは 2 回まで（' + readsAfterWrite + '）');
});
test('速さ：static を決めている要素がいくつあっても、先に全部読んでからまとめて外す（読む → 外す をくり返さない・#169 の Codex 6900755891 の P3）', () => {
  /* 書く（setAttribute・removeAttribute・setProperty・removeProperty）のあとの最初の読みを数える。前の形は static の要素 1 つごとに 1 回（40 回） */
  let dirty = false, readsAfterWrite = 0;
  const watchEl = el => {
    const sa = el.setAttribute.bind(el), ra = el.removeAttribute.bind(el), sp = el.style.setProperty.bind(el.style), rp = el.style.removeProperty.bind(el.style), gb = el.getBoundingClientRect, gc = el.getClientRects;
    el.setAttribute = (k, v) => { dirty = true; sa(k, v); };
    el.removeAttribute = k => { dirty = true; ra(k); };
    el.style.setProperty = (k, v) => { dirty = true; sp(k, v); };
    el.style.removeProperty = k => { dirty = true; return rp(k); };
    el.getBoundingClientRect = () => { if (dirty) { readsAfterWrite++; dirty = false; } return gb(); };
    el.getClientRects = () => { if (dirty) { readsAfterWrite++; dirty = false; } return gc(); };
    return el;
  };
  const els = [];
  for (let i = 0; i < 40; i++) { const el = watchEl(fakeEl(R(10 + (i % 8) * 40, 100 + Math.floor(i / 8) * 40, 30, 30))); Object.defineProperty(el._cs, 'position', { get: () => 'static' }); els.push(el); }
  const root = { querySelectorAll: sel => (/table/.test(sel) ? [] : /input/.test(sel) ? [] : els) };
  const c = layoutCtx({
    matchMedia: q => ({ matches: /767/.test(q) || /coarse/.test(q) }),
    getComputedStyle: (el, pseudo) => { if (dirty) { readsAfterWrite++; dirty = false; } return pseudo ? { content: 'none' } : (el._cs || { display: 'block', overflow: 'visible', overflowX: 'visible', overflowY: 'visible', position: 'static', fontSize: '13px' }); },
    doc: { getElementById: id => (id === 'main-content' ? root : null), createTreeWalker: () => ({ nextNode: () => null }) },
  });
  c.FUNERGY_LAYOUT.run();
  assert.ok(els.every(e => !e.hasAttribute('data-hit') && !e.hasAttribute('data-hitrel')), 'static を決めている要素には押す範囲も印も残さない');
  assert.ok(readsAfterWrite <= 2, '書いたあとに読むのは 2 回まで（' + readsAfterWrite + '）');
});
/* 要素がとても多い画面：見えている所の上下 1 画面（外の塊はその中ごと飛ばす） */
function treeRun(cards, opt = {}) {
  const NF = { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 };
  const root = { tagName: 'DIV', kids: cards, getElementsByTagName: () => ({ length: opt.count || 25000 }), querySelectorAll: () => { throw new Error('多い画面では全部を集めない'); }, firstChild: null };
  let visited = 0;
  const walker = (r, what, filter) => {
    const out = [];
    const dfs = n => { for (const k of n.kids || []) { visited++; const v = filter && filter.acceptNode ? filter.acceptNode(k) : 1; if (v === NF.FILTER_REJECT) continue; if (v === NF.FILTER_ACCEPT) out.push(k); dfs(k); } };
    dfs(r); let i = 0; return { nextNode: () => out[i++] || null };
  };
  const listeners = [];
  const c = layoutCtx({
    matchMedia: q => ({ matches: /767/.test(q) || /coarse/.test(q) }),
    getComputedStyle: (el, pseudo) => pseudo ? { content: 'none' } : (el._cs || { display: 'block', overflow: 'visible', overflowX: 'visible', overflowY: 'visible', position: 'static', fontSize: '13px' }),
    doc: { getElementById: id => (id === 'main-content' ? root : null), createTreeWalker: walker, addEventListener: (ev, fn, o) => listeners.push([ev, o]) },
    globals: { NodeFilter: NF, MutationObserver: function(){ this.observe = () => {}; }, addEventListener() {} },
  });
  c.document.getElementById = id => (id === 'main-content' ? root : id === 'modal-body' || id === 'modal-overlay' ? { classList: { contains: () => false } } : null);
  c.FUNERGY_LAYOUT.run();
  return { c, visited: () => visited, listeners };
}
function card(top, h, kids) { const el = fakeEl(R(0, top, 390, h), { tag: 'DIV' }); el.matches = () => false; el.kids = kids; return el; }
function btnIn(top) { const b = fakeEl(R(20, top, 30, 30)); b.kids = []; b.matches = sel => /button/.test(sel); return b; }
function smallText(top) { const sp = fakeEl(R(20, top, 60, 12), { tag: 'SPAN', cs: { fontSize: '9px' } }); sp.matches = () => false; sp.closest = () => null; sp.kids = []; sp.firstChild = { nodeType: 3, nodeValue: 'abc', nextSibling: null }; return sp; }
test('速さ：要素が 2 万より多い画面は、見えている所の上下 1 画面だけに印を付け、外の塊は中を見ない。スクロールが止まったら見直す', () => {
  const near = [], far = [], farTexts = [], nearTexts = [];
  const cards = [];
  for (let i = 0; i < 40; i++) {
    const top = i * 300 - 1500, b = btnIn(top + 10), t = smallText(top + 60);
    const inside = r => r.bottom >= -844 && r.top <= 844 * 2;   /* 上下 1 画面（844px）とその下 1 画面 */
    (inside(b.getBoundingClientRect()) ? near : far).push(b); (inside(t.getBoundingClientRect()) ? nearTexts : farTexts).push(t);
    cards.push(card(top, 300, [b, t]));
  }
  const { c, visited, listeners } = treeRun(cards);
  assert.ok(near.length > 3 && far.length > 10);
  assert.ok(near.every(b => b.hasAttribute('data-hit')), '見えている所の近くは広げる ' + near.filter(b => !b.hasAttribute('data-hit')).map(b => b.getBoundingClientRect().top).join(','));
  assert.ok(far.every(b => !b.hasAttribute('data-hit')), '遠い所はまだ触らない');
  assert.ok(nearTexts.every(t => t.hasAttribute('data-fs11')) && farTexts.every(t => !t.hasAttribute('data-fs11')));
  assert.ok(visited() < cards.length * 3 + near.length * 4, '外の塊の中は見ない');
  assert.equal(c.FUNERGY_LAYOUT._windowed, true);
  /* 要素が少ない画面は今までどおり全部（querySelectorAll）。見えている所だけにはしない */
  const few = []; for (let i = 0; i < 30; i++) few.push(fakeEl(R(10, i * 400, 30, 30)));
  const cc = phoneRun(few);
  assert.ok(few.every(b => b.hasAttribute('data-hit')));
  assert.equal(cc.FUNERGY_LAYOUT._windowed, false);
});
test('速さ：スクロールの見張りは 1 つ（止まってから 200ms で見直す・見えている所だけを見ているときだけ）', () => {
  const i = LAYOUT.indexOf("D.addEventListener('scroll'");
  assert.ok(i > 0);
  assert.match(LAYOUT.slice(i, i + 220), /if \(!L\._windowed\) return; clearTimeout\(stT\); stT = setTimeout\(schedule, 200\); \}, \{ capture: true, passive: true \}\);/);
  assert.equal(LAYOUT.split("D.addEventListener('scroll'").length, 2, 'ページのスクロールの見張りは 1 つ（ナビの横のスクロールは別）');
});
test('CSS：押す範囲と 11px はスマホの幅とタッチの端末だけ（PC で残った印は効かない）。PC の 10px はマウスの端末だけ', () => {
  const touch = CSS.slice(CSS.indexOf('@media (max-width:767px), (pointer: coarse) {'));
  assert.ok(CSS.indexOf('@media (max-width:767px), (pointer: coarse) {') > 0);
  const blk = touch.slice(0, touch.indexOf('\n}'));
  assert.match(blk, /\[data-hit\]:not\(\.ux-busy\)::after/);
  assert.match(blk, /\[data-fs11\] \{ font-size:11px !important; \}/);
  assert.equal((CSS.match(/\[data-hit\]:not\(\.ux-busy\)::after/g) || []).length, 1, '押す範囲の決まりはこの段だけ');
  assert.equal((CSS.match(/\[data-fs11\] \{/g) || []).length, 1);
  const pc = CSS.slice(CSS.indexOf('@media (hover: hover) and (pointer: fine) {'));
  assert.match(pc.slice(0, pc.indexOf('\n}')), /\[data-fs10\] \{ font-size:10px !important; \}/);
  assert.ok(CSS.indexOf('[data-fs10] {') < CSS.indexOf('[data-fs11] {'), '両方付いたら 11px（あと）が勝つ');
  assert.match(HTML, /@media \(hover: hover\) and \(pointer: fine\) \{\s*body \{ zoom: 1\.1; \}/, 'PC の zoom と同じ条件');
});

/* ---------- CSS の決まり ---------- */
test('CSS：PC の幅（1024px 以上で 1440、1440px 以上で 1880）・箱の大きさ・スマホの全画面の箱と固定の行', () => {
  assert.match(CSS, /@media \(min-width:1024px\)[\s\S]*body\[data-layout="wide"\] \.main \{ max-width:1440px; \}/);
  assert.match(CSS, /@media \(min-width:1440px\)[\s\S]*body\[data-layout="wide"\] \.main \{ max-width:1880px; \}/);
  assert.match(CSS, /#modal-body\.modal\[data-msize="lg"\] \{ max-width:1000px; \}/);
  assert.match(CSS, /#modal-body\.modal\[data-mfull\][^{]*\{[^}]*height:100%/);
  assert.match(CSS, /\[data-mfull\] > \[data-mfoot\] \{ position:sticky; bottom:/);
  assert.match(CSS, /\[data-fs11\] \{ font-size:11px !important; \}/);
});
test('CSS：スマホの見出しはボタンを次の行へ・上の店の切り替えは縮めない（足りなければ名前の札を縮める・374px 以下は出さない）', () => {
  const sp = CSS.slice(CSS.indexOf('@media (max-width:767px)'));
  assert.match(sp, /\.section-header \{ flex-wrap:wrap;/);
  const m640 = CSS.slice(CSS.indexOf('@media (max-width:640px)'), CSS.indexOf('@media (max-width:374px)'));
  assert.match(m640, /\.topbar-store \{[^}]*flex:0 0 auto/);
  assert.match(m640, /\.topbar-role-badge \{ min-width:0; overflow:hidden; \}/);
  assert.match(m640, /\.tb-sn-f \{ display:none; \}/, '略称の決まりは 640px の段のまま');
  assert.match(CSS, /@media \(max-width:374px\) \{\s*\.topbar-role-badge \{ display:none; \}/);
});

/* ---------- 上の店の名前（略称） ---------- */
test('上の店の名前：正式名と略称の両方を出し、どちらもエスケープする', () => {
  const ctx = { escapeHtml, STORES: [{ id: 'F01', name: 'Tori<b>Ton' }], _bStoreAbbr: s => (s.id === 'F01' ? 'T<T' : s.id) };
  vm.createContext(ctx); vm.runInContext(fnSrc('tbStoreName'), ctx);
  const h = ctx.tbStoreName('F01', 'Tori<b>Ton');
  assert.match(h, /tb-sn-f">Tori&lt;b&gt;Ton</);
  assert.match(h, /tb-sn-s">T&lt;T</);
  assert.match(ctx.tbStoreName('ALL', '全店舗'), /tb-sn-s">全店</);
});

/* ---------- Qコミットビュー：棒の下の数字を重ねない ---------- */
test('Qコミットビュー：棒の下の数字は並べる（絶対位置で重ねない）。棒の印は今までどおり', () => {
  const src = HTML.slice(HTML.indexOf('/* ★着地見込みをバー上の印にする'), HTML.indexOf('/* ★埋め方をここに畳む'));
  assert.ok(src.length > 100);
  assert.match(src, /display:flex;flex-wrap:wrap;justify-content:space-between/);
  assert.doesNotMatch(src, /position:absolute;left:0">\$0/);
  assert.doesNotMatch(src, /transform:translateX\(-50%\)/);
  assert.match(src, /_qcBarMark\(pPace/);
  assert.match(src, /_qcBarMark\(pFc/);
});

/* ---------- 従業員マスター：PC は表と右のパネル、スマホは今のカード ---------- */
const EMPS = [
  { id: 'e1', name: 'Wes Endo', role: 'ceo', store: 'ALL', emp: '正社員', status: '在籍', step: 0, title: 'CEO' },
  { id: 'e2', name: 'Cora <img src=x onerror=alert(1)>', role: 'g4', store: 'F01', support: ['F02', 'F03'], emp: '正社員', status: '在籍', step: 3, empCode: 'TT-1', hireDate: '2025-04-01', insurance: true },
  { id: 'e3', name: 'Kai Mori', role: 'crew', store: 'F02', emp: 'パート', status: '在籍', step: 1 },
  { id: 'e4', name: 'Ren Old', role: 'crew', store: 'F03', emp: 'パート', status: '退職', step: 0 },
];
function staffCtx(opt = {}) {
  const els = {};
  const listeners = [];
  const mq = { matches: !!opt.pc, addEventListener: (ev, fn) => listeners.push(fn) };
  const ctx = {
    console, Math, String, Number, Object, Array, JSON, setTimeout: () => 0,
    escapeHtml, t: (ja) => ja, curRole: opt.role || 'gm', window: null, STORES: [{ id: 'F01' }, { id: 'F02' }, { id: 'F03' }],
    empFilter: opt.filter || 'active', empStoreFilter: opt.store || 'all', empSearchQ: opt.q || '',
    canAccessStaffMaster: () => true, empRosterRefresh() { }, piiEnsure() { },
    getEmployees: () => JSON.parse(JSON.stringify(EMPS.concat(opt.extra || []))),
    myAmStores: () => opt.amStores || [],
    canViewPins: () => !!opt.pins, wageScopeStores: () => (opt.wage === 'all' ? null : []),
    canViewWageOf: e => opt.wage === 'all' || (opt.wage === 'F02' && e.store === 'F02'),
    canViewIndividualWage: () => ['ceo', 'gm'].includes(ctx.curRole),   /* v1191：役職給与表のボタンは CEO・GM だけ */
    getStaffPin: n => (n === 'Kai Mori' ? '4321' : '0000'),
    renderInactiveCard: () => '<div class="card" data-clear>in</div>', renderUnregisteredCard: () => '', renderOffboardingCard: () => '', renderResignRepairCard: () => '',
    bStoreChips: () => '<chips>', storeBadge: id => '<sb ' + escapeHtml(id) + '>',
    empGrade: e => ({ ceo: 'CEO', g4: 'G4', crew: 'G1' }[e.role] || ''),
    evalColorLv: () => '#999', getOffboardings: () => [{ id: 'o1', empId: 'e4', status: '進行中' }], offboardProgress: () => ({ pct: 40 }),
    empTitleHtml: e => (e.title ? '<b>' + escapeHtml(e.title) + '</b>' : ''), gradeLevelBadgeHtml: () => '<lv>',
    isMonthlyTitle: t => t === 'CEO', empMonthlyOf: () => 10000, empWageOf: () => 16,
    empToastAliases: e => (e.id === 'e2' ? [{ n: 'Cora<T>', store: 'F01' }] : []),
    document: { getElementById: id => els[id] || null, querySelector: () => null },
  };
  if (opt.noMq !== true) ctx.matchMedia = q => { assert.equal(q, '(min-width:1024px)'); return mq; };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['renderStaffMaster', 'empSmResignBtns', 'empSmPanelInner', 'empSmPick', 'empSmIsPc', 'empSmWatch', 'empOfficeStore', 'empAnyStore']) vm.runInContext(fnSrc(f), ctx);   /* v1207：AM の絞り込みは empAnyStore（ALL か OFFICE） */
  ctx._els = els; ctx._mq = mq; ctx._listeners = listeners;
  return ctx;
}
const part = (h, a, b) => { const i = h.indexOf(a); assert.ok(i >= 0, a); const j = b ? h.indexOf(b, i) : h.length; return h.slice(i, j < 0 ? h.length : j); };
const cardIds = h => [...h.matchAll(/class="staff-item"[^>]*onclick="openEmpModal\('([^']+)'\)"/g)].map(m => m[1]);
const rowIds = h => [...h.matchAll(/class="sm-row[^"]*"[^>]*data-eid="([^"]+)"/g)].map(m => m[1]);
test('従業員マスター：幅に合うほうだけを描く（スマホ・タブレットはカード、1024px 以上は表とパネル。両方は描かない）', () => {
  const hs = staffCtx({ pc: false }).renderStaffMaster();
  const hp = staffCtx({ pc: true }).renderStaffMaster();
  assert.match(hs, /<div class="sm-wrap" data-v="sp"><div class="card sm-sp">/);
  assert.doesNotMatch(hs, /sm-pc|sm-tbl|sm-panel|sm-row/, 'カードのときは表もパネルも描かない');
  assert.match(hp, /<div class="sm-wrap" data-v="pc"><div class="sm-pc">/);
  assert.doesNotMatch(hp, /sm-sp|staff-item/, '表のときはカードを描かない');
  assert.deepEqual(cardIds(hs), ['e1', 'e2', 'e3']);
  assert.deepEqual(rowIds(hp), cardIds(hs), '在籍の 3 人・同じ順（Grade の順）');
  for (const h of [hs, hp]) {
    const ids = [...h.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(new Set(ids).size, ids.length, '同じ id が 2 つない');
    assert.match(h, /<div class="sm-chk"><div class="card" data-clear>/, '上の確かめのカードは横に並べる箱の中');
  }
  assert.deepEqual([...hp.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]).filter(x => x !== 'emp-search'), ['sm-panel']);
  /* matchMedia が無い・使えないときはカード（今までどおり） */
  assert.match(staffCtx({ noMq: true }).renderStaffMaster(), /data-v="sp"/);
});
test('従業員マスター：名前・コード・Toast の名前はエスケープする（カード・表・パネル）', () => {
  const hs = staffCtx({ pc: false, pins: true }).renderStaffMaster();
  const c = staffCtx({ pc: true, pins: true });
  c.empSmSel = 'e2';
  const hp = c.renderStaffMaster();
  for (const h of [hs, hp]) assert.doesNotMatch(h, /<img src=x/);
  assert.equal((hs.match(/Cora &lt;img src=x onerror=alert\(1\)&gt;/g) || []).length, 1, 'カード');
  assert.ok((hp.match(/Cora &lt;img src=x onerror=alert\(1\)&gt;/g) || []).length >= 2, '表とパネル');
  assert.match(hp, /Cora&lt;T&gt;/);
  assert.match(part(hp, 'id="sm-panel"'), /2025-04-01/);
  assert.match(part(hp, 'id="sm-panel"'), /<dt>保険<\/dt><dd>医療<\/dd>/);
});
test('従業員マスター：給与の列とパネルの給与は見てよい人だけ。PIN は PIN を見られる人だけ', () => {
  for (const pc of [false, true]) {
    const h = staffCtx({ pc, wage: 'none', pins: false }).renderStaffMaster();
    assert.doesNotMatch(h, /<th class="num">給与/);
    assert.doesNotMatch(h, /\$16\/h|\$10,000/);
    assert.doesNotMatch(h, /PIN/);
  }
  let h = staffCtx({ pc: true, wage: 'F02', pins: false }).renderStaffMaster();
  assert.match(h, /<th class="num">給与/);
  const rows = [...h.matchAll(/data-eid="(e\d)"[\s\S]*?<\/tr>/g)].map(m => [m[1], /\$16\/h|\$10,000/.test(m[0])]);
  assert.deepEqual(rows, [['e1', false], ['e2', false], ['e3', true]], '給与は F02 の人だけ');
  h = staffCtx({ pc: true, wage: 'all', pins: true }).renderStaffMaster();
  assert.match(part(h, 'id="sm-panel"'), /<dt>PIN<\/dt>/);
  assert.match(part(h, 'id="sm-panel"'), /\$10,000\/月/);
});
test('従業員マスター：AM は担当の店の人だけ（カードと表の両方）。退職の手続き・復元のボタンはカードと同じ決まり', () => {
  const hs = staffCtx({ pc: false, role: 'am', amStores: ['F03'] }).renderStaffMaster();
  const hp = staffCtx({ pc: true, role: 'am', amStores: ['F03'] }).renderStaffMaster();
  assert.deepEqual(cardIds(hs), ['e1', 'e2'], '全店の人と、F03 を応援する人だけ（F02 の人は出ない）');
  assert.deepEqual(rowIds(hp), cardIds(hs));
  /* 退職した人：GM は手続きと復元、店長（sl）は手続きだけ（カードもパネルも） */
  const c = staffCtx({ pc: true, filter: 'resigned' }); c.empSmSel = 'e4';
  const panel = part(c.renderStaffMaster(), 'id="sm-panel"');
  assert.match(panel, /openOffboardingModal\('o1'\)/);
  assert.match(panel, /restoreEmployee\('e4'\)/);
  const cs = staffCtx({ pc: false, filter: 'resigned' }).renderStaffMaster();
  assert.match(cs, /openOffboardingModal\('o1'\)/);
  assert.match(cs, /restoreEmployee\('e4'\)/);
  const c2 = staffCtx({ pc: true, filter: 'resigned', role: 'sl' }); c2.empSmSel = 'e4';
  const h2 = c2.renderStaffMaster();
  assert.doesNotMatch(h2, /restoreEmployee/);
  assert.match(part(h2, 'id="sm-panel"'), /openOffboardingModal\('o1'\)/);
  assert.doesNotMatch(staffCtx({ pc: false, filter: 'resigned', role: 'sl' }).renderStaffMaster(), /restoreEmployee/);
});
test('従業員マスター（v1207）：本部（OFFICE・空白と小文字も）の人は全部の AM に出る（カードと表の両方）。前の本部の値（---）の人は応援が担当の店のときだけ', () => {
  const extra = [
    { id: 'e5', name: 'Oli Office', role: 'office', store: ' office ', emp: '正社員', status: '在籍', step: 0 },
    { id: 'e6', name: 'Hal Old', role: 'office', store: '---', emp: '正社員', status: '在籍', step: 0 },
  ];
  const hs = staffCtx({ pc: false, role: 'am', amStores: ['F03'], extra }).renderStaffMaster();
  const hp = staffCtx({ pc: true, role: 'am', amStores: ['F03'], extra }).renderStaffMaster();
  assert.deepEqual(cardIds(hs), ['e1', 'e2', 'e5'], '全店・F03 を応援する人・本部の人（--- の人は出ない）');
  assert.deepEqual(rowIds(hp), cardIds(hs));
  const other = staffCtx({ pc: false, role: 'am', amStores: ['F02'], extra }).renderStaffMaster();
  assert.ok(cardIds(other).includes('e5'), 'どの AM にも出る');
  assert.ok(!cardIds(other).includes('e6'));
});
test('従業員マスター：AM の担当の外の人は表にもパネルにも出ない（選んでも出さない）', () => {
  const c = staffCtx({ pc: true, role: 'am', amStores: ['F02'] });
  c.empSmSel = 'e2';
  const h = c.renderStaffMaster();
  const allowed = new Set([...h.matchAll(/data-eid="(e\d)"/g)].map(m => m[1]));
  /* empSmPick：表にある行だけ。表に無い人の id では何も描かない */
  const rows = [...allowed].map(id => ({ id, attr: {}, getAttribute(k) { return k === 'data-eid' ? id : this.attr[k]; }, setAttribute(k, v) { this.attr[k] = v; }, classList: { toggle() { } } }));
  const panel = { innerHTML: 'old' };
  c.document = { querySelector: s => (s.includes('sm-tbl') ? { querySelectorAll: () => rows } : null), getElementById: id => (id === 'sm-panel' ? panel : null) };
  c.empSmPick('e4');
  assert.equal(panel.innerHTML, 'old', '表に無い人（退職・担当の外）は出さない');
  c.empSmPick([...allowed][0]);
  assert.notEqual(panel.innerHTML, 'old');
});
test('従業員マスター：パネルの編集はその行の人の画面を開く・表の行はクリックで選ぶ／ダブルクリックと Enter で開く', () => {
  const h = staffCtx({ pc: true }).renderStaffMaster();
  assert.match(part(h, 'id="sm-panel"'), /data-eid="e1" onclick="openEmpModal\(this\.getAttribute\('data-eid'\)\)"/);
  const row = part(h, 'class="sm-row sel"', '</tr>');
  assert.match(row, /onclick="empSmPick\(this\.getAttribute\('data-eid'\)\)"/);
  assert.match(row, /ondblclick="openEmpModal\(this\.getAttribute\('data-eid'\)\)"/);
  assert.match(row, /event\.key==='Enter'/);
  assert.match(row, /tabindex="0"/);
});
test('従業員マスター：幅が 1024px をまたいだら、開いているときだけ描き直す（見張りは 1 つ・入力中と箱を開いているあいだは待つ）', () => {
  const c = staffCtx({ pc: false });
  c.renderStaffMaster(); c.renderStaffMaster(); c.renderStaffMaster();
  assert.equal(c._listeners.length, 1, '何度描いても見張りは 1 つ');
  const calls = [];
  let wrapV = 'sp', modalOpen = false, typing = false;
  c.renderPage = p => calls.push(p);
  c._empTyping = () => typing;
  c.document = {
    querySelector: s => (s === '.sm-wrap' ? { getAttribute: k => (k === 'data-v' ? wrapV : null) } : null),
    getElementById: id => (id === 'modal-overlay' ? { classList: { contains: n => n === 'open' && modalOpen } } : null),
  };
  const fire = () => c._listeners[0]();
  c.curPage = 'dashboard'; c._mq.matches = true; fire();
  assert.deepEqual(calls, [], 'ほかの画面では描き直さない');
  c.curPage = 'staff_master'; c._mq.matches = false; fire();
  assert.deepEqual(calls, [], '形が同じなら描き直さない');
  const timers = [];
  c.setTimeout = (fn, ms) => { timers.push([fn, ms]); return timers.length; }; c.clearTimeout = () => { };
  c._mq.matches = true; modalOpen = true; fire();
  typing = true; modalOpen = false; fire();
  assert.deepEqual(calls, [], '箱を開いている・入力中は待つ');
  assert.deepEqual(timers.map(x => x[1]), [1500, 1500], '待つあいだは 1.5 秒ごとに見直す');
  typing = false; timers[1][0]();
  assert.deepEqual(calls, ['staff_master'], '入力が終わったら描き直す（幅の変わる知らせを待たない）');
});
test('従業員マスター：CSS は 1024px 以上で表とパネルを横に並べる（片方を隠す決まりは無い。描き直すまでは縦に並ぶ）', () => {
  assert.doesNotMatch(CSS, /\.sm-pc \{ display:none; \}/);
  assert.doesNotMatch(CSS, /\.sm-sp \{ display:none; \}/);
  const at = CSS.indexOf('.sm-chk { display:grid;');
  assert.ok(at > 0);
  assert.match(CSS.slice(CSS.lastIndexOf('@media (min-width:1024px)', at)), /^@media \(min-width:1024px\) \{[\s\S]*?\.sm-wrap > \.sm-pc \{ display:grid;/);
  assert.match(CSS, /@media \(min-width:1024px\) \{ \.sm-pc > \.sm-panel \{ margin-top:0; position:sticky; top:64px; \} \}/);
  /* タッチの端末（iPad など）で表になっても行は 44px（マウスの PC は zoom 1.1 で 47px なので足さない） */
  assert.match(HTML, /@media \(pointer: coarse\) \{ \.sm-tbl tr\.sm-row > td \{ height:44px; \} \}/);
  assert.doesNotMatch(HTML, /@media \(hover: ?hover\)[^{]*\{[^}]*\.sm-tbl tr\.sm-row > td \{ height/);
});

/* ---------- #169 の Codex 6899952456 の P2：押す範囲で absolute・fixed・sticky の位置を変えない ---------- */
test('押す範囲：relative にするのは元が static のものだけ（散布図の点 .mn-pt などの absolute はそのまま）', () => {
  assert.ok(!/^\s*\[data-hit\]\s*\{\s*position:\s*relative;?\s*\}/m.test(CSS), 'すべての data-hit を relative にする決まりが残っていない');
  /* #169 の Codex 6900411328 の P3：印の決まりは強さ 0（:where）＝あとからクラスや幅の決まりで absolute・sticky になればそちらが効く */
  assert.match(CSS, /:where\(\[data-hit\]\[data-hitrel\]\)\s*\{\s*position:relative;\s*\}/);
  assert.doesNotMatch(CSS, /(^|[\s,}])\[data-hit\]\[data-hitrel\]\s*\{/, '強さのある印の決まりが残っていない');
  assert.match(LAYOUT, /if \(mk && pos === 'static'\) \{ if \(el\.hasAttribute\('data-hit'\)\) writes\.push\(\{ el: el \}\); return; \}/);
  assert.match(LAYOUT, /var stat = pos === 'static' \|\| \(mk && pos === 'relative'\);/);
  assert.match(LAYOUT, /var stuck = fresh\.filter\(function\(el\)\{ return W\.getComputedStyle\(el\)\.position === 'static'; \}\);\s*stuck\.forEach\(clearHit\);/);
  assert.match(LAYOUT, /writes\.push\(\{ el: el, e: e, rel: stat \}\)/);
  assert.match(LAYOUT, /function clearHit\(el\)\{ el\.removeAttribute\('data-hit'\); el\.removeAttribute\('data-hitrel'\);/);
  /* 本物のブラウザの CSS での確かめは tests/e2e-pcsp/hit-position-v1172.mjs（座標・computed の position・押したときの対象） */
});
test('押す範囲：印を付けたあとに absolute・sticky になったら印を外す（押す範囲は残す）。static を決めている要素には押す範囲を付けない', () => {
  /* a：前に印を付けた（元は static）が、いまはクラスで absolute。b：はじめから sticky。c：ほかの決まりが static を決めている（印を付けても relative にならない）。d：ふつうの static */
  const a = fakeEl(R(20, 100, 24, 24), { cs: { position: 'absolute' } }); a._a['data-hit'] = ''; a._a['data-hitrel'] = '';
  const b = fakeEl(R(120, 100, 24, 24), { cs: { position: 'sticky' } });
  const c = fakeEl(R(220, 100, 24, 24)); Object.defineProperty(c._cs, 'position', { get: () => 'static' });
  const d = fakeEl(R(320, 100, 24, 24));
  phoneRun([a, b, c, d]);
  assert.ok(a.hasAttribute('data-hit') && !a.hasAttribute('data-hitrel'), 'a：印を外し、押す範囲は残す');
  assert.ok(b.hasAttribute('data-hit') && !b.hasAttribute('data-hitrel'), 'b：sticky に印は付けない');
  assert.ok(!c.hasAttribute('data-hit') && !c.hasAttribute('data-hitrel'), 'c：relative にならないので押す範囲も印も外す');
  assert.ok(d.hasAttribute('data-hit') && d.hasAttribute('data-hitrel') && d._cs.position === 'relative', 'd：印を付けて relative');
  /* 2 回目の見直し：c はまた外す・a は印なしのまま */
  const c2 = fakeEl(R(220, 100, 24, 24)); Object.defineProperty(c2._cs, 'position', { get: () => 'static' }); c2._a['data-hit'] = ''; c2._a['data-hitrel'] = '';
  phoneRun([a, c2]);
  assert.ok(!c2.hasAttribute('data-hit') && !c2.hasAttribute('data-hitrel'), '印があるのに static のものは押す範囲を外す');
  assert.ok(a.hasAttribute('data-hit') && !a.hasAttribute('data-hitrel'));
});
