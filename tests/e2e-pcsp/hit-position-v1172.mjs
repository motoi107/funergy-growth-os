// v1172（#169 の Codex 6899952456 の P2）：スマホ・タッチの端末で押す範囲を広げても、
// absolute・fixed・sticky の要素の位置を変えないこと（メニュー分析「出数 vs 売価」の散布図の点 .mn-pt など）を本物のブラウザ（Chromium）の CSS で確かめる。
// index.html の <style> と FUNERGY_LAYOUT をそのまま白紙のページに入れ、合成の点・ボタンを置いて L.run() の前後を比べる（本番・模擬サーバーにはつながない）。
// 使い方：node tests/e2e-pcsp/hit-position-v1172.mjs   （INDEX=ほかの index.html で前の版と比べられる）
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const HTML = fs.readFileSync(process.env.INDEX || new URL('../../index.html', import.meta.url), 'utf8');
const styles = [...HTML.slice(0, HTML.indexOf('</head>')).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
const A = HTML.indexOf('/* ==== FUNERGY_LAYOUT start'), B = HTML.indexOf('/* ==== FUNERGY_LAYOUT end ==== */');
if (!(A > 0 && B > A)) throw new Error('FUNERGY_LAYOUT が見つからない');
const LAYOUT = HTML.slice(A, B);

const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

/* 散布図の点（.mn-pt：24×24・absolute・left/top だけ inline）は、今の画面と同じ作り。近い 2 つ（p3・p4）はとなりの決まりも見る */
const PTS = [[40, 40], [160, 60], [250, 150], [280, 168], [90, 200]];
const DOM = `<div class="main"><div id="main-content">
  <div id="plot" style="position:relative;width:340px;height:240px;margin:20px auto;border:1px solid #ccc">
    ${PTS.map(([x, y], i) => `<button type="button" class="mn-pt" id="p${i}" style="left:${x}px;top:${y}px" onclick="window.__hit='p${i}'"><span style="background:#c2410c"></span></button>`).join('')}
  </div>
  <p style="margin:24px 16px"><button type="button" id="st" style="padding:2px 6px;font-size:12px" onclick="window.__hit='st'">小さいボタン</button></p>
  <div style="height:400px"></div>
  <button type="button" id="fx" style="position:fixed;right:12px;bottom:12px;width:24px;height:24px;padding:0" onclick="window.__hit='fx'">F</button>
</div></div>
<div id="modal-overlay" class="modal-overlay"><div id="modal-body" class="modal"></div></div>`;

const browser = await chromium.launch({ headless: true });
for (const W of [390, 1024]) {   /* 390＝スマホ、1024＝タッチの iPad（pointer: coarse） */
  const ctx = await browser.newContext({ viewport: { width: W, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e.message || e)));
  await page.setContent(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body>${DOM}<script>${LAYOUT}<\/script></body></html>`);
  const snap = () => page.evaluate(() => {
    const one = id => { const el = document.getElementById(id), r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return { id, x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1), w: Math.round(r.width), h: Math.round(r.height), pos: cs.position, hit: el.hasAttribute('data-hit'), rel: el.hasAttribute('data-hitrel'),
        ht: el.style.getPropertyValue('--ht'), hb: el.style.getPropertyValue('--hb') }; };
    return [...document.querySelectorAll('.mn-pt')].map(p => one(p.id)).concat([one('st'), one('fx')]);
  });
  const before = await snap();
  await page.evaluate(() => window.FUNERGY_LAYOUT.run());
  const after1 = await snap();
  await page.evaluate(() => window.FUNERGY_LAYOUT.run());   /* 2 回目（見直し）でも同じ */
  const after = await snap();
  const by = (arr, id) => arr.find(x => x.id === id);
  const tag = W + 'px';
  ok(tag + '：touch の決まりが効いている（matchMedia）', await page.evaluate(() => matchMedia('(max-width:767px), (pointer: coarse)').matches));
  for (const b of before.filter(x => x.id.startsWith('p'))) {
    const a = by(after, b.id), a1 = by(after1, b.id);
    ok(`${tag}：点 ${b.id} は absolute のまま`, a.pos === 'absolute' && a1.pos === 'absolute', a.pos);
    ok(`${tag}：点 ${b.id} の中心の座標が変わらない`, Math.abs(a.x - b.x) < 0.6 && Math.abs(a.y - b.y) < 0.6 && Math.abs(a1.x - b.x) < 0.6 && Math.abs(a1.y - b.y) < 0.6, { before: [b.x, b.y], after: [a.x, a.y] });
    ok(`${tag}：点 ${b.id} に押す範囲が付く（data-hit）・relative の印は付かない`, a.hit && !a.rel, { hit: a.hit, rel: a.rel });
  }
  /* 押す：点の中心と、点の外（押す範囲の中）を押すと、その点の onclick が動く */
  for (const id of ['p0', 'p1', 'p4']) {
    const a = by(after, id);
    for (const [dx, dy, label] of [[0, 0, '中心'], [0, 17, '下 17px（点の外・押す範囲の中）']]) {
      await page.evaluate(() => { window.__hit = ''; });
      await page.mouse.click(a.x + dx, a.y + dy);
      const got = await page.evaluate(() => window.__hit);
      ok(`${tag}：点 ${id} の${label}を押すとその点`, got === id, got);
    }
  }
  /* となり：近い 2 つの点（p2・p3）は、間を半分ずつ分ける。それぞれの中心を押すとその点 */
  for (const id of ['p2', 'p3']) {
    const a = by(after, id); await page.evaluate(() => { window.__hit = ''; });
    await page.mouse.click(a.x, a.y);
    ok(`${tag}：近い点 ${id} の中心を押すとその点`, await page.evaluate(() => window.__hit) === id);
  }
  const st0 = by(before, 'st'), st = by(after, 'st');
  ok(`${tag}：元が static の小さいボタンは relative にして押す範囲を付ける（位置は変わらない）`, st.hit && st.rel && st.pos === 'relative' && Math.abs(st.x - st0.x) < 0.6 && Math.abs(st.y - st0.y) < 0.6, { pos: st.pos, rel: st.rel });
  await page.evaluate(() => { window.__hit = ''; }); await page.mouse.click(st.x, st.y + Math.min(15, st.h / 2 + 8));
  ok(`${tag}：小さいボタンの下の押す範囲を押すとそのボタン`, await page.evaluate(() => window.__hit) === 'st');
  const fx0 = by(before, 'fx'), fx = by(after, 'fx');
  ok(`${tag}：fixed のボタンは fixed のまま・位置も同じ`, fx.pos === 'fixed' && !fx.rel && Math.abs(fx.x - fx0.x) < 0.6 && Math.abs(fx.y - fx0.y) < 0.6, { pos: fx.pos });
  ok(`${tag}：ページのエラーなし`, errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}
await browser.close();
const ng = results.filter(r => !r.ok).length;
console.log(`\n${results.length - ng}/${results.length} OK`);
process.exit(ng ? 1 : 0);
