/* smoke_v893.js — 向きの補正を実バイト・実DOMで確かめる。
   EXIF は8方向あり、さらに「ブラウザが自動で回すか」で挙動が二分される。
   16通りすべてで、最終的にまっすぐ（元の見た目と同じ向き）になるかを見る。 */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const utf = fs.readFileSync('index.html', 'utf8');

function grab(re, name) {
  const m = utf.match(re);
  if (!m) { console.log('切り出し失敗: ' + name); process.exit(1); }
  return m[0];
}
let bad = 0;
function mark(ok, line) { if (!ok) bad++; console.log((ok ? '  PASS  ' : '  FAIL  ') + line); }

const parts = [
  grab(/function _exifOrientation\(bytes\)\{[\s\S]*?\n\}/, '_exifOrientation'),
  grab(/function _orientTransform\(ori, w, h\)\{[\s\S]*?\n\}/, '_orientTransform'),
].join('\n');
const T = new Function(parts + '\nreturn {_exifOrientation,_orientTransform};')();

/* ---------- ① タグを実ファイルから読めるか ---------- */
for (let o = 1; o <= 8; o++) {
  const b = new Uint8Array(fs.readFileSync('/tmp/ori/o' + o + '.jpg'));
  mark(T._exifOrientation(b) === o, 'EXIF orientation=' + o + ' を読める');
}
mark(T._exifOrientation(new Uint8Array(fs.readFileSync('/tmp/ori/none.jpg'))) === 1, 'EXIFなしは 1 として扱う');
[[], [0xFF], [0xFF, 0xD8], [0xFF, 0xD8, 0xFF, 0xE1, 0, 4], [1, 2, 3]].forEach((a, i) => {
  let r; try { r = T._exifOrientation(new Uint8Array(a)); } catch (e) { r = 'EX'; }
  mark(r === 1, '壊れた入力' + i + ' でも落ちず 1 を返す');
});

/* ---------- ② 変換行列が本当にまっすぐにするか ---------- */
/* 元画像の「左上」がどこへ行くかで判定する。
   まっすぐ＝変換後も左上(0,0)側に来ること。 */
function applyTf(tf, x, y) { return [tf[0] * x + tf[2] * y + tf[4], tf[1] * x + tf[3] * y + tf[5]]; }
const W = 900, H = 600;
for (let o = 1; o <= 8; o++) {
  const r = T._orientTransform(o, W, H);
  /* EXIF の定義上、変換後の (0,0) には「元画像で表示上の左上に来るべき点」が来る。
     4隅がすべて出力範囲に収まり、面積が保たれていれば行列は正しい。 */
  const corners = [[0, 0], [W, 0], [0, H], [W, H]].map(p => applyTf(r.tf, p[0], p[1]));
  const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
  const fits = Math.min(...xs) > -0.01 && Math.max(...xs) < r.cw + 0.01
    && Math.min(...ys) > -0.01 && Math.max(...ys) < r.ch + 0.01;
  const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  mark(fits && Math.abs(area - W * H) < 1,
    'ori=' + o + ' の変換が ' + r.cw + '×' + r.ch + ' に過不足なく収まる');
}
mark(T._orientTransform(6, 900, 600).cw === 600 && T._orientTransform(6, 900, 600).ch === 900,
  '右90度で縦横が入れ替わる');
mark(T._orientTransform(3, 900, 600).cw === 900, '180度では縦横が変わらない');

/* ---------- ③ invUprightFile を実DOMで16通り走らせる ---------- */
const upSrc = [
  parts,
  grab(/function _invIsPdf\(f\)\{[\s\S]*?\n\}/, '_invIsPdf'),
  grab(/var _exifAutoRotate=null;/, '_exifAutoRotate'),
  grab(/function _detectExifAutoRotate\(\)\{[\s\S]*?\n\}/, '_detectExifAutoRotate'),
  grab(/async function invUprightFile\(file\)\{[\s\S]*?\n\}/, 'invUprightFile'),
].join('\n');

function env(autoRotate) {
  const dom = new JSDOM('<body></body>');
  const w = dom.window;
  const calls = [];
  w.HTMLCanvasElement.prototype.getContext = function () {
    const self = this;
    return {
      drawImage(img, x, y, dw, dh) { calls.push({ cw: self.width, ch: self.height, dw, dh }); },
      fillRect() {}, setTransform(a, b, c, d, e, f) { calls.push({ tf: [a, b, c, d, e, f] }); },
      set fillStyle(v) {}, get fillStyle() { return '#fff'; },
    };
  };
  w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb({ size: 99, type: 'image/jpeg' }); };
  const sb = {
    document: w.document, console, Math, Promise, Error, Uint8Array, String, Number, JSON,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    File: class { constructor(p, n, o) { this.name = n; this.type = (o || {}).type; this._made = true; } },
    Image: class {
      constructor() { this._w = 0; this._h = 0; }
      get naturalWidth() { return this._w; } get naturalHeight() { return this._h; }
      set src(v) {
        if (String(v).startsWith('data:')) {          /* 端末判定のプローブ */
          this._w = autoRotate ? 1 : 2; this._h = autoRotate ? 2 : 1;
        } else {                                       /* 実写真 */
          const sw = autoRotate && sb._ori >= 5 && sb._ori <= 8;
          this._w = sw ? 600 : 900; this._h = sw ? 900 : 600;
        }
        setTimeout(() => this.onload && this.onload(), 0);
      }
    },
    setTimeout, _calls: calls, _ori: 1,
  };
  sb.globalThis = sb;
  const api = new w.Function('sb', `with(sb){ ${upSrc} return { invUprightFile }; }`)(sb);
  return { api, sb, calls };
}

(async () => {
  for (const autoRotate of [false, true]) {
    const label = autoRotate ? '自動で回す端末' : '自動で回さない端末';
    for (let o = 1; o <= 8; o++) {
      const { api, sb, calls } = env(autoRotate);
      sb._ori = o;
      const bytes = fs.readFileSync('/tmp/ori/o' + o + '.jpg');
      const file = { name: 'p.jpg', type: 'image/jpeg', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
      const out = await api.invUprightFile(file);
      const draws = calls.filter(c => c.cw);
      const swap = (o >= 5 && o <= 8);

      if (autoRotate) {
        if (o === 1) {
          mark(out === file, label + ' / ori=1 は何もしない');
        } else {
          /* すでに立っているので回さないが、EXIF を落とすために焼き直す。
             タグを残すと OCR や PDF 埋め込みなど「タグを見ない相手」で倒れる。 */
          const c = draws[0] || {};
          const okSize = swap ? (c.cw === 600 && c.ch === 900) : (c.cw === 900 && c.ch === 600);
          mark(out && out._made && okSize,
            label + ' / ori=' + o + ' → 回さずEXIFだけ落とす（' + c.cw + '×' + c.ch + '）');
        }
      } else if (o === 1) {
        mark(out === file, label + ' / ori=1 は何もしない');
      } else {
        const c = draws[0] || {};
        const okSize = swap ? (c.cw === 600 && c.ch === 900) : (c.cw === 900 && c.ch === 600);
        mark(out && out._made && okSize,
          label + ' / ori=' + o + ' → ' + c.cw + '×' + c.ch + ' のまっすぐな JPEG を作る');
      }
    }
  }

  /* 例外時に写真を失わないこと */
  {
    const { api } = env(false);
    const broken = { name: 'x.jpg', type: 'image/jpeg', arrayBuffer: async () => { throw new Error('read fail'); } };
    const out = await api.invUprightFile(broken);
    mark(out === broken, '読めない写真でも元ファイルをそのまま返す（失わない）');
    const pdf = { name: 'a.pdf', type: 'application/pdf' };
    mark((await api.invUprightFile(pdf)) === pdf, 'PDF は触らない');
  }

  /* ---------- ④ 配線 ---------- */
  const has = re => re.test(utf);
  mark(has(/var up = await invUprightFile\(file\);/), 'ファイル選択の入口で向きを立てる');
  mark(has(/var up = _invIsPdf\(file\) \? file : await invUprightFile\(file\);/), '撮影の入口で向きを立てる');
  mark(has(/var use = await askInvoiceCrop\(up\);/) && has(/var use = _invIsPdf\(up\) \? up : await askInvoiceCrop\(up\);/),
    '切り出しには向きを立てた画像が渡る');
  mark(!/canvas に描くとブラウザが回転を適用/.test(utf), '古い「canvasが回転を適用する」前提のコメントが残っていない');

  /* ---------- ⑤ 業者名の自動化 ---------- */
  mark(has(/placeholder="写真から自動で入ります"/), '業者名の入力を促さない表示になっている');
  mark(has(/入力は不要です。写真を撮ると読み取って入ります/), '自動で入る旨の案内がある');
  mark(has(/if\(vEl && \(!vEl\.value \|\| vEl\.dataset\.auto==='1'\)\)/), '撮り直しで業者名を入れ直せる');
  mark(has(/function invVendorTouched\(\)/) && has(/oninput="invVendorTouched\(\)/), '手で直した値は上書きしない');
  mark(has(/vEl\.dataset\.auto='1'/), '自動で入れた印を付けている');

  console.log('\n' + (bad ? 'FAIL ' + bad + ' 件' : 'すべて PASS'));
  process.exit(bad ? 1 : 0);
})();
