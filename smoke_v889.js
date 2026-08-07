/* smoke_v889.js — index.html に入った PDF 生成を実際に走らせ、
   出てきたバイト列が本物の PDF か外部ツール（qpdf / pdfinfo / pdftoppm）で確かめる。
   「文字列が入った」ではなく「経理が開けるファイルになっているか」を見る。 */
const fs = require('fs');
const cp = require('child_process');
const utf = fs.readFileSync('index.html', 'utf8');

function grab(re, name) {
  const m = utf.match(re);
  if (!m) { console.log('切り出し失敗: ' + name); process.exit(1); }
  return m[0];
}

const src = [
  grab(/function _pdfNum\(n\)\{.*?\}/, '_pdfNum'),
  grab(/function _pdfLatin1\(str\)\{[\s\S]*?\n\}/, '_pdfLatin1'),
  grab(/function _jpegToPdfBytes\(jpegBytes, iw, ih\)\{[\s\S]*?\n\}/, '_jpegToPdfBytes'),
  grab(/function _invIsPdf\(f\)\{[\s\S]*?\n\}/, '_invIsPdf'),
].join('\n');

const T = new Function(src + '\nreturn {_jpegToPdfBytes, _invIsPdf};')();

let bad = 0;
function is(name, got, want) {
  const ok = String(got) === String(want);
  if (!ok) bad++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + '  → ' + got + (ok ? '' : '  (期待 ' + want + ')'));
}
function sh(cmd) { try { return cp.execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString(); } catch (e) { return 'ERR:' + e.message; } }

/* 縦長レシート / 横長 / 正方形 / 極端に細長い の4形 */
const cases = [
  ['縦長レシート', '/tmp/receipt.jpg', 1200, 1800],
  ['横長', '/tmp/wide.jpg', 3000, 1000],
  ['正方形', '/tmp/square.jpg', 1500, 1500],
  ['細長い', '/tmp/tall.jpg', 800, 3000],
];

cases.forEach(([label, path, w, h]) => {
  const jpg = new Uint8Array(fs.readFileSync(path));
  const pdf = T._jpegToPdfBytes(jpg, w, h);
  const out = '/tmp/v889_' + label + '.pdf';
  fs.writeFileSync(out, Buffer.from(pdf));

  is(label + ': 先頭が %PDF', Buffer.from(pdf.slice(0, 5)).toString(), '%PDF-');
  is(label + ': qpdf が構文エラーを出さない', /No syntax or stream encoding errors/.test(sh('qpdf --check "' + out + '" 2>&1')), true);
  const info = sh('pdfinfo "' + out + '"');
  is(label + ': 1ページ', (info.match(/Pages:\s+(\d+)/) || [])[1], '1');
  is(label + ': Letter 612x792', /612 x 792 pts/.test(info), true);
  is(label + ': JPEG を再圧縮していない（元バイトが丸ごと入っている）',
    Buffer.from(pdf).includes(Buffer.from(jpg)), true);

  /* 描き戻して、中身が出るか・向きが変わっていないか */
  sh('rm -f /tmp/rr-*.png; pdftoppm -r 72 -png "' + out + '" /tmp/rr');
  const py = sh(`python3 -c "
from PIL import Image
im=Image.open('/tmp/rr-1.png').convert('L')
b=im.point(lambda v:0 if v>240 else 255).getbbox()
print('%d %d'%(b[2]-b[0], b[3]-b[1]))
"`).trim().split(/\s+/).map(Number);
  const ratio = py[0] / py[1], want = w / h;
  is(label + ': 縦横比が保たれる (' + ratio.toFixed(3) + ' vs ' + want.toFixed(3) + ')',
    Math.abs(ratio - want) < 0.05, true);
  is(label + ': 向きが変わっていない', (py[0] > py[1]) === (w > h), true);
});

/* 収まりきる（はみ出さない）こと */
const jpg = new Uint8Array(fs.readFileSync('/tmp/tall.jpg'));
fs.writeFileSync('/tmp/v889_fit.pdf', Buffer.from(T._jpegToPdfBytes(jpg, 800, 3000)));
const txt = sh('qpdf --qdf --object-streams=disable /tmp/v889_fit.pdf /tmp/v889_fit_q.pdf && cat /tmp/v889_fit_q.pdf')
  .match(/q\n([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/);
if (txt) {
  const [, dw, dh, dx, dy] = txt.map(Number);
  is('余白の内側に収まる（左右）', dx >= 18 - 0.01 && dx + dw <= 612 - 18 + 0.01, true);
  is('余白の内側に収まる（上下）', dy >= 18 - 0.01 && dy + dh <= 792 - 18 + 0.01, true);
} else { bad++; console.log('  FAIL  描画コマンドを取り出せなかった'); }

/* 拡張子判定 */
is('_invIsPdf: application/pdf', T._invIsPdf({ type: 'application/pdf', name: 'a' }), true);
is('_invIsPdf: 拡張子だけ', T._invIsPdf({ type: '', name: 'scan.PDF' }), true);
is('_invIsPdf: 画像は false', T._invIsPdf({ type: 'image/jpeg', name: 'a.jpg' }), false);

/* 配線チェック：保存・退避・ビューア・一括復旧が PDF を通るか */
function has(re) { return re.test(utf); }
is('保存が application/pdf で上がる', has(/'Content-Type':mime, 'x-upsert':'true'/) && has(/mime='application\/pdf'/), true);
is('拡張子が .pdf になる', has(/var up=file, ext='pdf', mime='application\/pdf'/), true);
is('退避キューにも PDF を渡している', (utf.match(/pimgQueue\(up, path, invId\)/g) || []).length, 2);
is('変換に失敗したら画像で保存する（伝票を失わない）', has(/falling back to image/), true);
is('元がPDFのときは元ファイルを保存', has(/window\._invoiceSourceFile = file;/), true);
is('ビューアが拡張子で出し分ける', has(/if\(\/\\\.pdf\$\/i\.test\(String\(inv\.imagePath\|\|''\)\)\) await _ivShowPdf/), true);
is('一括復旧が PDF を画像に戻す', has(/blob = await pdfToImageFile\(new File\(\[blob\], 'recover\.pdf'/), true);
is('メモ保存は触っていない', /function saveInvoiceMemo\(id\)\{[\s\S]*?inv\.memoUse=g\('iv-use'\); inv\.memoWho=g\('iv-who'\); inv\.memoNote=g\('iv-note'\);/.test(utf), true);
is('OCR に渡すものは画像のまま', /body: JSON\.stringify\(\{ image:b64, mediaType:file\.type\|\|'image\/jpeg', hint:hint \}\)/.test(utf), true);

console.log('\n' + (bad ? 'FAIL ' + bad + ' 件' : 'すべて PASS'));
process.exit(bad ? 1 : 0);
