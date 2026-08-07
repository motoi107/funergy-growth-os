/* smoke_v890.js — index.html に入った検出器を実画素で動かして精度を測る。
   「関数がある」ではなく「伝票が欠けずに囲えているか」を見る。
   欠け（伝票の一部が枠外）は合計行を落とす事故に直結するので、
   IoU より先に「全部入っているか」を必ず確認する。 */
const fs = require('fs');
const utf = fs.readFileSync('index.html', 'utf8');

function grab(re, name) {
  const m = utf.match(re);
  if (!m) { console.log('切り出し失敗: ' + name); process.exit(1); }
  return m[0];
}
const src = [
  grab(/function _dcOtsu\(hist, total\)\{[\s\S]*?\n\}/, '_dcOtsu'),
  grab(/function _dcLargestBox\(mask, W, H\)\{[\s\S]*?\n\}/, '_dcLargestBox'),
  grab(/function detectDocRect\(rgba, W, H\)\{[\s\S]*?\n\}/, 'detectDocRect'),
].join('\n');
const T = new Function(src + '\nreturn {detectDocRect};')();

let bad = 0;
function mark(ok, line) { if (!ok) bad++; console.log((ok ? '  PASS  ' : '  FAIL  ') + line); }

const truth = JSON.parse(fs.readFileSync('/tmp/dc/truth.json', 'utf8'));
const W = 265, H = 360;

Object.keys(truth).sort().forEach(name => {
  const raw = new Uint8ClampedArray(fs.readFileSync('/tmp/dc/' + name + '.raw'));
  const r = T.detectDocRect(raw, W, H);
  const t = truth[name];

  if (t === null) {
    mark(r === null, name.padEnd(16) + '切らないのが正解 → ' + (r ? '切ってしまった' : '切らなかった'));
    return;
  }
  if (!r) { mark(false, name.padEnd(16) + '検出できず（全体になる）'); return; }

  const ax0 = r.x, ay0 = r.y, ax1 = r.x + r.w, ay1 = r.y + r.h;
  const bx0 = t[0], by0 = t[1], bx1 = t[0] + t[2], by1 = t[1] + t[3];
  const ix = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0));
  const iy = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0));
  const inter = ix * iy, iou = inter / (r.w * r.h + t[2] * t[3] - inter);
  const covered = ax0 <= bx0 + 0.01 && ay0 <= by0 + 0.01 && ax1 >= bx1 - 0.01 && ay1 >= by1 - 0.01;
  mark(covered, name.padEnd(16) + '伝票が枠に全部入る（欠けなし）');
  mark(iou > 0.80, name.padEnd(16) + '余分が少ない IoU ' + iou.toFixed(3));
});

/* 枠 → 元画像の切り出し座標。ここがずれると別の場所を切る */
function cropMath(box, scale, iw, ih) {
  const sx = Math.max(0, Math.round(box.x / scale));
  const sy = Math.max(0, Math.round(box.y / scale));
  return { sx, sy, sw: Math.min(iw - sx, Math.round(box.w / scale)), sh: Math.min(ih - sy, Math.round(box.h / scale)) };
}
const iw = 3024, ih = 4032, CW = 760, scale = CW / iw, ch = Math.round(ih * scale);
let c = cropMath({ x: 0, y: 0, w: CW, h: ch }, scale, iw, ih);
mark(c.sx === 0 && c.sy === 0 && Math.abs(c.sw - iw) <= 2 && Math.abs(c.sh - ih) <= 2,
  '全体を選ぶと元画像そのまま (' + c.sw + '×' + c.sh + ')');
c = cropMath({ x: CW * 0.25, y: ch * 0.25, w: CW * 0.5, h: ch * 0.5 }, scale, iw, ih);
mark(Math.abs(c.sw - iw * 0.5) < 5 && Math.abs(c.sh - ih * 0.5) < 5,
  '中央半分を選ぶと元画像の半分 (' + c.sw + '×' + c.sh + ')');
c = cropMath({ x: CW - 10, y: ch - 10, w: 200, h: 200 }, scale, iw, ih);
mark(c.sx + c.sw <= iw && c.sy + c.sh <= ih, '右下でも元画像からはみ出さない');

/* 配線 */
function has(re) { return re.test(utf); }
mark(has(/var use = await askInvoiceCrop\(file\);/), '撮影・選択の入口が範囲確認を通る');
mark(has(/var use = _invIsPdf\(file\) \? file : await askInvoiceCrop\(file\);/), 'もう一つの入口も同じ扱い');
mark((utf.match(/askInvoiceCrop\(/g) || []).length >= 3, '入口が取り残されていない');
mark(has(/window\._invoiceSourceFile = file;/), 'PDF入稿は従来どおり元PDFを保存（切らない）');
mark(/onpointerdown="cropDown\(event\)"/.test(utf) && /touch-action:none/.test(utf), '指で操作できる（pointer + touch-action）');
mark(has(/onclick="cropApply\(true\)"/) && has(/onclick="cropApply\(false\)"/), '［全体を使う］の逃げ道がある');
mark(has(/showToast\('切り出しに失敗したので全体を使います'/), '切り出し失敗時は全体にフォールバック');
mark((utf.match(/resolve\(file\)/g) || []).length >= 3, '異常時は必ず元ファイルを返す（写真を失わない）');

/* v889 の約束を壊していないこと */
mark(has(/var up=file, ext='pdf', mime='application\/pdf'/), '保存はPDFのまま');
mark(/inv\.memoUse=g\('iv-use'\); inv\.memoWho=g\('iv-who'\); inv\.memoNote=g\('iv-note'\);/.test(utf), 'メモ機能は無傷');

console.log('\n' + (bad ? 'FAIL ' + bad + ' 件' : 'すべて PASS'));
process.exit(bad ? 1 : 0);
