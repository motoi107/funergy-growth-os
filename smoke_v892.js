/* smoke_v892.js — v890 で壊した2点を、実際の DOM を組んで再現テストする。
   ① 切り出し画面を出しても Invoice/Receipt登録フォームが生き残るか
      （inv-vendor / ocr-result が消えると読み取り結果の行き先が無くなり保存できない）
   ② × / 背景タップ / 例外 のどの経路でも Promise が必ず resolve するか
      （返らないと撮影しても何も起きない）
   jsdom で本物の要素を作り、index.html から切り出した関数をそのまま動かす。 */
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

/* ---- 本体から切り出す（改変しない） ---- */
const parts = [
  grab(/function _dcOtsu\(hist, total\)\{[\s\S]*?\n\}/, '_dcOtsu'),
  grab(/function _dcLargestBox\(mask, W, H\)\{[\s\S]*?\n\}/, '_dcLargestBox'),
  grab(/function detectDocRect\(rgba, W, H\)\{[\s\S]*?\n\}/, 'detectDocRect'),
  grab(/var _cropS=null, _CROP_H=13;/, '_cropS'),
  grab(/function _cropOpen\(html\)\{[\s\S]*?\n\}/, '_cropOpen'),
  grab(/function _cropClose\(\)\{[\s\S]*?\n\}/, '_cropClose'),
  grab(/function cropBackdrop\(e\)\{[\s\S]*?\n\}/, 'cropBackdrop'),
  grab(/function cropDismiss\(\)\{[\s\S]*?\n\}/, 'cropDismiss'),
  grab(/function _cropDraw\(\)\{[\s\S]*?\n\}/, '_cropDraw'),
  grab(/function _cropInfo\(\)\{[\s\S]*?\n\}/, '_cropInfo'),
  grab(/function cropApply\(useAll\)\{[\s\S]*?\n\}/, 'cropApply'),
  grab(/function askInvoiceCrop\(file\)\{[\s\S]*?\n\}\r?\n/, 'askInvoiceCrop'),
].join('\n');

/* index.html の実際の DOM 構造を使う（crop-overlay もここから取る） */
const modalDom = grab(/<div class="modal-overlay" id="modal-overlay"[\s\S]*?<div class="crop-overlay"[\s\S]*?<\/div>\r?\n<\/div>/, 'モーダルDOM');

function makeEnv(imgOk) {
  const dom = new JSDOM(`<body>${modalDom}</body>`, { pretendToBeVisual: true });
  const w = dom.window, doc = w.document;

  /* Invoice/Receipt登録モーダルが開いている状態を再現 */
  doc.getElementById('modal-body').innerHTML =
    '<div class="modal-title">Invoice / Receipt登録</div>' +
    '<input id="inv-vendor" value="JFC">' +
    '<input id="inv-docdate" value="2026-08-08">' +
    '<div id="ocr-result"></div>' +
    '<input type="file" id="inv-photo">';
  doc.getElementById('modal-overlay').classList.add('open');

  /* canvas は jsdom に無いので prototype ごと差し替える。
     createElement を包むだけだと innerHTML で作られる crop-cv に効かない。 */
  w.HTMLCanvasElement.prototype.getContext = function () {
    return {
      drawImage() {}, clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {},
      moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {},
      getImageData: (x, y, ww, hh) => ({ data: new Uint8ClampedArray(ww * hh * 4) }),
      set fillStyle(v) {}, get fillStyle() { return '#000'; },
      set strokeStyle(v) {}, get strokeStyle() { return '#000'; },
      set lineWidth(v) {}, get lineWidth() { return 1; },
    };
  };
  w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb({ size: 10, type: 'image/jpeg' }); };

  const sandbox = {
    document: doc, window: w, console,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    File: class { constructor(p, n, o) { this.name = n; this.type = (o || {}).type; } },
    Image: class {
      constructor() { this.naturalWidth = 1200; this.naturalHeight = 1800; }
      set src(v) { setTimeout(() => imgOk ? this.onload && this.onload() : this.onerror && this.onerror(), 0); }
    },
    Math, Uint8Array, Uint8ClampedArray, Uint32Array, Int32Array, String, Number, Array, Object, JSON, Date,
    setTimeout, Promise, Error,
    t: (ja) => ja,
    escapeHtml: s => String(s == null ? '' : s),
    showToast: (m, k) => { sandbox._toasts.push(m); },
    _toasts: [],
  };
  sandbox.globalThis = sandbox;
  const fn = new w.Function('sb', `with(sb){ ${parts}
    return { askInvoiceCrop, cropApply, cropDismiss, cropBackdrop,
             get _cropS(){ return _cropS; } }; }`);
  return { api: fn(sandbox), doc, sandbox };
}

/* 1つのシナリオを走らせて、フォームが生きているか＆resolve したかを見る */
async function run(label, act, imgOk = true) {
  const { api, doc, sandbox } = makeEnv(imgOk);
  const file = { name: 'photo.jpg', type: 'image/jpeg' };
  let resolved = false, got = null;
  const p = api.askInvoiceCrop(file).then(f => { resolved = true; got = f; });

  await new Promise(r => setTimeout(r, 10));
  const shownDuring = doc.getElementById('crop-overlay').classList.contains('open');
  const formDuring = !!doc.getElementById('inv-vendor') && !!doc.getElementById('ocr-result');
  const vendorDuring = (doc.getElementById('inv-vendor') || {}).value;

  act(api, doc);
  await Promise.race([p, new Promise(r => setTimeout(r, 300))]);

  const formAfter = !!doc.getElementById('inv-vendor') && !!doc.getElementById('ocr-result');
  const overlayAfter = doc.getElementById('crop-overlay').classList.contains('open');
  return { label, shownDuring, formDuring, vendorDuring, formAfter, overlayAfter, resolved, got, toasts: sandbox._toasts };
}

(async () => {
  /* --- ① 登録フォームが壊れないか --- */
  let r = await run('この範囲で読み取る', api => api.cropApply(false));
  mark(r.shownDuring, '切り出し画面が専用オーバーレイに出る');
  mark(r.formDuring, '★ 切り出し中も登録フォームが残っている（inv-vendor / ocr-result）');
  mark(r.vendorDuring === 'JFC', '★ 入力済みの業者名が消えていない');
  mark(r.formAfter, '★ 切り出し後も登録フォームが残っている');
  mark(!r.overlayAfter, '切り出し画面は閉じる');
  mark(r.resolved, 'resolve される');
  mark(r.got && /_crop\.jpg$/.test(r.got.name), '切り出したファイルが返る');

  /* --- ② どの経路でも必ず返るか --- */
  const cases = [
    ['全体を使う', api => api.cropApply(true), true],
    ['× ボタン', api => api.cropDismiss(), true],
    ['背景タップ', (api, doc) => api.cropBackdrop({ target: doc.getElementById('crop-overlay') }), true],
    ['画像が読めない', () => {}, false],
  ];
  for (const [label, act, imgOk] of cases) {
    r = await run(label, act, imgOk);
    mark(r.resolved, '★ ' + label + ' でも必ず resolve する（await が固まらない）');
    mark(r.formAfter, label + ' の後も登録フォームが残っている');
    mark(!r.overlayAfter, label + ' で切り出し画面が閉じる');
    if (label === '× ボタン' || label === '背景タップ') {
      mark(r.got && r.got.name === 'photo.jpg', label + ' は写真全体で読み取る（v889 と同じ動き）');
      mark(r.toasts.some(m => /写真全体/.test(m)), label + ' で何が起きたか通知が出る');
    }
  }

  /* --- 二重 resolve しないこと --- */
  const { api, doc } = makeEnv(true);
  let count = 0;
  const pr = api.askInvoiceCrop({ name: 'a.jpg', type: 'image/jpeg' }).then(() => count++);
  await new Promise(r2 => setTimeout(r2, 10));
  api.cropApply(true);
  api.cropDismiss();
  api.cropBackdrop({ target: doc.getElementById('crop-overlay') });
  await pr; await new Promise(r2 => setTimeout(r2, 30));
  mark(count === 1, '連打しても resolve は1回だけ');

  /* --- 静的: openModal を使っていないこと（再発防止） --- */
  const body = grab(/function askInvoiceCrop\(file\)\{[\s\S]*?\n\}\r?\n/, 'askInvoiceCrop');
  mark(!/openModal\(/.test(body), '★ askInvoiceCrop が openModal を使っていない');
  mark(!/closeModalDirect\(/.test(grab(/function cropApply\(useAll\)\{[\s\S]*?\n\}/, 'cropApply')),
    '★ cropApply が closeModalDirect を使っていない');
  mark(/id="crop-overlay"/.test(utf) && /z-index: 300/.test(utf), '専用オーバーレイが modal より上の層にある');

  console.log('\n' + (bad ? 'FAIL ' + bad + ' 件' : 'すべて PASS'));
  process.exit(bad ? 1 : 0);
})();
