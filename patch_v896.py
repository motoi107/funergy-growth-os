# -*- coding: utf-8 -*-
"""v896 — ②の仕上げ。
   ① _optPreview を window. 付きに統一（宣言の無い参照を消す）
   ② saveInvoice の window.event 依存をやめる（あわせてラベル復元の不具合も直す）
   透過置換・CRLF保持・アンカーは1件だけ。"""

P = 'index.html'
d = open(P, 'rb').read()
orig_crlf = d.count(b'\r\n')


def rep(old_s, new_s, note):
    global d
    old, new = old_s.encode('utf-8'), new_s.encode('utf-8')
    n = d.count(old)
    assert n == 1, 'anchor count=%d (expected 1): %s' % (n, note)
    d = d.replace(old, new, 1)
    print('OK  ', note)


# ---------------------------------------------------------------- 1) _optPreview
rep("  if (window._optPreview && _optPreview.storeId===storeId && _optPreview.week===getWeekStr()) {\r\n",
    "  /* v896: 代入は window._optPreview なのに参照だけ window. が抜けていた。\r\n"
    "     いまは window のプロパティが同名のグローバル変数として見えるので偶然動くが、\r\n"
    "     宣言としては存在しない。書き方を代入側に揃える。 */\r\n"
    "  if (window._optPreview && window._optPreview.storeId===storeId && window._optPreview.week===getWeekStr()) {\r\n",
    "_optPreview の参照を window. 付きに統一（判定）")

rep("    html += optPreviewHtml(_optPreview.res, storeId, getWeekStr());\r\n",
    "    html += optPreviewHtml(window._optPreview.res, storeId, getWeekStr());\r\n",
    "_optPreview の参照を window. 付きに統一（描画）")

# ---------------------------------------------------------------- 2) window.event 依存
rep("    var saveBtn = event && event.target ? event.target : null;\r\n"
    "    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '画像を保存中…'; }\r\n",
    "    /* v896: window.event に頼っていた。非標準で、ボタン以外（タイマーや\r\n"
    "       Promise の後続、プログラムからの呼び出し）から saveInvoice() を呼ぶと\r\n"
    "       undefined になり、二重押し防止が効かない。同じ関数の下で既に使っている\r\n"
    "       querySelector に揃える。 */\r\n"
    "    var saveBtn = document.querySelector('.modal .btn-primary');\r\n"
    "    /* 元のラベルを控える。ボタンは『保存・価格更新』または『申請する』で、\r\n"
    "       固定文字で戻すと失敗後に別のラベルへ化ける。 */\r\n"
    "    var saveBtnLabel = saveBtn ? saveBtn.textContent : '';\r\n"
    "    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '画像を保存中…'; }\r\n",
    "saveInvoice の window.event 依存を解消")

rep("  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '保存'; }\r\n",
    "  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = saveBtnLabel; }\r\n",
    "失敗後にボタンのラベルを元に戻す")

rep("const APP_VERSION = '895';", "const APP_VERSION = '896';", "APP_VERSION 895 -> 896")

open(P, 'wb').write(d)

d2 = open(P, 'rb').read()
crlf = d2.count(b'\r\n'); lf = d2.count(b'\n')
print('\nCRLF %d (was %d) / lone LF %d' % (crlf, orig_crlf, lf - crlf))
assert lf - crlf == 0, 'lone LF detected'

s = open('sw.js', 'rb').read()
assert s.count(b"const SW_BUILD = '895';") == 1
open('sw.js', 'wb').write(s.replace(b"const SW_BUILD = '895';", b"const SW_BUILD = '896';", 1))
print('OK   SW_BUILD 895 -> 896')
