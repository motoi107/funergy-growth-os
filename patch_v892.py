# -*- coding: utf-8 -*-
"""v892 — v890 で入れた切り出し画面の不具合修正。
   ① 登録モーダルの中から openModal() を呼んでいたため、Invoice/Receipt登録フォーム
      （inv-vendor / ocr-result など19要素）を丸ごと上書きして壊していた。
      → 独立したオーバーレイに載せ替える。
   ② 背景タップで閉じると Promise が resolve されず処理が永久に止まっていた。
      → どの経路で閉じても必ず resolve する（写真全体で読み取る＝v889 と同じ動き）。
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


def rep_span(start_s, end_s, new_s, note):
    """start から end の直前までを置き換える。end 自体は残す。"""
    global d
    start, end = start_s.encode('utf-8'), end_s.encode('utf-8')
    assert d.count(start) == 1, 'start not unique: ' + note
    i = d.find(start)
    j = d.find(end, i)
    assert j > i, 'end not found after start: ' + note
    d = d[:i] + new_s.encode('utf-8') + d[j:]
    print('OK  ', note)


# ---------------------------------------------------------------- 1) CSS
rep(".modal-overlay.open { display: flex; }\r\n",
    ".modal-overlay.open { display: flex; }\r\n"
    "/* v892: 伝票の範囲確認は専用の層に出す。撮影ボタンが Invoice/Receipt登録モーダルの\r\n"
    "   中にあるため、modal-overlay を使い回すと登録フォームごと上書きされる（v890 の事故）。\r\n"
    "   z-index は modal-overlay(200) より上。 */\r\n"
    ".crop-overlay {\r\n"
    "  display: none;\r\n"
    "  position: fixed; inset: 0;\r\n"
    "  background: rgba(0,0,0,.82);\r\n"
    "  z-index: 300;\r\n"
    "  align-items: center;\r\n"
    "  justify-content: center;\r\n"
    "  padding: 16px;\r\n"
    "}\r\n"
    ".crop-overlay.open { display: flex; }\r\n"
    ".crop-sheet {\r\n"
    "  background: var(--surface);\r\n"
    "  border: 1px solid var(--border);\r\n"
    "  border-radius: 14px;\r\n"
    "  padding: 16px;\r\n"
    "  width: 100%;\r\n"
    "  max-width: 560px;\r\n"
    "  max-height: 92vh;\r\n"
    "  overflow-y: auto;\r\n"
    "}\r\n",
    "crop-overlay の CSS を追加")

# ---------------------------------------------------------------- 2) DOM
rep("<div class=\"modal-overlay\" id=\"modal-overlay\" onclick=\"closeModal(event)\">\r\n"
    "  <div class=\"modal\" id=\"modal-body\"></div>\r\n"
    "</div>\r\n",
    "<div class=\"modal-overlay\" id=\"modal-overlay\" onclick=\"closeModal(event)\">\r\n"
    "  <div class=\"modal\" id=\"modal-body\"></div>\r\n"
    "</div>\r\n"
    "\r\n"
    "<!-- v892: 伝票の範囲確認。登録モーダルの中から呼ばれるので、modal-body とは\r\n"
    "     別の層に置く。ここを modal-overlay に戻すと登録フォームが消える。 -->\r\n"
    "<div class=\"crop-overlay\" id=\"crop-overlay\" onclick=\"cropBackdrop(event)\">\r\n"
    "  <div class=\"crop-sheet\" id=\"crop-sheet\"></div>\r\n"
    "</div>\r\n",
    "crop-overlay の DOM を追加")

# ---------------------------------------------------------------- 3) 開閉と離脱
rep("/* ---- 範囲の確認画面 ---- */\r\n"
    "var _cropS=null, _CROP_H=13;\r\n",
    "/* ---- 範囲の確認画面 ---- */\r\n"
    "var _cropS=null, _CROP_H=13;\r\n"
    "/* v892: openModal() は使わない。撮影ボタンが Invoice/Receipt登録モーダルの中に\r\n"
    "   あるため、modal-body を書き換えると inv-vendor / ocr-result ごと消え、\r\n"
    "   読み取り結果の行き先が無くなって保存できなくなる（v890 の事故）。 */\r\n"
    "function _cropOpen(html){\r\n"
    "  var ov=document.getElementById('crop-overlay'), sh=document.getElementById('crop-sheet');\r\n"
    "  if(!ov||!sh) return false;\r\n"
    "  sh.innerHTML=html; ov.classList.add('open');\r\n"
    "  return true;\r\n"
    "}\r\n"
    "function _cropClose(){\r\n"
    "  var ov=document.getElementById('crop-overlay'), sh=document.getElementById('crop-sheet');\r\n"
    "  if(ov) ov.classList.remove('open');\r\n"
    "  if(sh) sh.innerHTML='';            /* canvas を残さない */\r\n"
    "}\r\n"
    "/* 背景タップ・×。どちらも「写真全体で読み取る」に倒す。\r\n"
    "   ここで resolve しないと await が返らず、撮影しても何も起きなくなる。 */\r\n"
    "function cropBackdrop(e){\r\n"
    "  if(e && e.target===document.getElementById('crop-overlay')) cropDismiss();\r\n"
    "}\r\n"
    "function cropDismiss(){\r\n"
    "  if(!_cropS){ _cropClose(); return; }\r\n"
    "  showToast(t('範囲を選ばずに閉じたので、写真全体で読み取ります',\r\n"
    "              'Closed without choosing an area — using the whole photo'),'warning');\r\n"
    "  cropApply(true);\r\n"
    "}\r\n",
    "専用オーバーレイの開閉と離脱経路を追加")

# ---------------------------------------------------------------- 4) cropApply
rep_span("function cropApply(useAll){\r\n", "/* 写真を受け取り、確認後のファイルを返す",
    "function cropApply(useAll){\r\n"
    "  var S=_cropS; if(!S) return;\r\n"
    "  /* 後始末と resolve は S.finish に一本化する。どこから抜けても必ず1回だけ返る。 */\r\n"
    "  if(useAll) return S.finish(S.file);\r\n"
    "  try{\r\n"
    "    var sx=Math.max(0, Math.round(S.box.x/S.scale));\r\n"
    "    var sy=Math.max(0, Math.round(S.box.y/S.scale));\r\n"
    "    var sw=Math.min(S.iw-sx, Math.round(S.box.w/S.scale));\r\n"
    "    var sh=Math.min(S.ih-sy, Math.round(S.box.h/S.scale));\r\n"
    "    if(sw<8||sh<8) return S.finish(S.file);\r\n"
    "    var cv=document.createElement('canvas'); cv.width=sw; cv.height=sh;\r\n"
    "    var cx=cv.getContext('2d');\r\n"
    "    cx.fillStyle='#fff'; cx.fillRect(0,0,sw,sh);\r\n"
    "    cx.drawImage(S.img, sx,sy,sw,sh, 0,0,sw,sh);\r\n"
    "    cv.toBlob(function(b){\r\n"
    "      if(!b){ showToast('切り出しに失敗したので全体を使います','warning'); return S.finish(S.file); }\r\n"
    "      var nm=String(S.file.name||'receipt').replace(/\\.[^.]+$/,'')+'_crop.jpg';\r\n"
    "      /* 縮小は入れない。長辺2400への調整は _invNormalizeJpeg が一手に引き受ける。 */\r\n"
    "      S.finish(new File([b], nm, {type:'image/jpeg'}));\r\n"
    "    }, 'image/jpeg', 0.95);\r\n"
    "  }catch(e){\r\n"
    "    console.warn('crop apply', e);\r\n"
    "    showToast('切り出しに失敗したので全体を使います','warning');\r\n"
    "    S.finish(S.file);\r\n"
    "  }\r\n"
    "}\r\n",
    "cropApply の後始末を finish に一本化")

# ---------------------------------------------------------------- 5) askInvoiceCrop
rep_span("function askInvoiceCrop(file){\r\n", "\r\nasync function realInvoiceOCR(input){",
    "function askInvoiceCrop(file){\r\n"
    "  return new Promise(function(resolve){\r\n"
    "    var url=null, settled=false;\r\n"
    "    /* v892: 抜け道を1つにする。× / 背景タップ / 例外 / 切り出し失敗のどれでも\r\n"
    "       ここを通り、必ず1回だけ resolve する。返せないと await が固まり、\r\n"
    "       撮影しても読み取りも保存も始まらない（v890 の事故）。 */\r\n"
    "    var finish=function(f){\r\n"
    "      if(settled) return; settled=true;\r\n"
    "      _cropS=null;\r\n"
    "      try{ _cropClose(); }catch(e){}\r\n"
    "      try{ if(url) URL.revokeObjectURL(url); }catch(e){}\r\n"
    "      resolve(f || file);\r\n"
    "    };\r\n"
    "    try{ url=URL.createObjectURL(file); }catch(e){ return finish(file); }\r\n"
    "    var img=new Image();\r\n"
    "    img.onerror=function(){ finish(file); };\r\n"
    "    img.onload=function(){\r\n"
    "      try{\r\n"
    "        var iw=img.naturalWidth||img.width, ih=img.naturalHeight||img.height;\r\n"
    "        if(!iw||!ih) throw new Error('size unknown');\r\n"
    "        /* 検出は長辺360pxで。iPhoneでも一瞬で終わる大きさ。 */\r\n"
    "        var ds=Math.min(1, 360/Math.max(iw,ih));\r\n"
    "        var dw=Math.max(20,Math.round(iw*ds)), dh=Math.max(20,Math.round(ih*ds));\r\n"
    "        var dcv=document.createElement('canvas'); dcv.width=dw; dcv.height=dh;\r\n"
    "        var dcx=dcv.getContext('2d',{willReadFrequently:true});\r\n"
    "        dcx.drawImage(img,0,0,dw,dh);\r\n"
    "        var auto=null;\r\n"
    "        try{ auto=detectDocRect(dcx.getImageData(0,0,dw,dh).data, dw, dh); }\r\n"
    "        catch(e){ console.warn('detectDocRect', e); }\r\n"
    "        /* プレビューは一度だけ描いて使い回す。指で動かすたびに元画像を\r\n"
    "           縮小し直すと、大きい写真でカクつくため。 */\r\n"
    "        var CW=Math.min(760, iw), scale=CW/iw, ch=Math.max(1,Math.round(ih*scale));\r\n"
    "        var base=document.createElement('canvas'); base.width=CW; base.height=ch;\r\n"
    "        base.getContext('2d').drawImage(img,0,0,CW,ch);\r\n"
    "        var ok=_cropOpen('<div class=\"modal-title\"><span><i class=\"ti ti-crop\" style=\"color:var(--accent)\"></i> '\r\n"
    "          + t('伝票の範囲を確認','Check the receipt area')+'</span>'\r\n"
    "          + '<button class=\"modal-close\" onclick=\"cropDismiss()\">\\u00d7</button></div>'\r\n"
    "          + '<div style=\"font-size:11.5px;color:var(--muted);margin-bottom:7px;line-height:1.6\">'\r\n"
    "          + (auto\r\n"
    "              ? '<i class=\"ti ti-sparkles\" style=\"color:var(--green)\"></i> '\r\n"
    "                + t('伝票らしい範囲を自動で囲みました。','Detected the receipt area.')\r\n"
    "              : '<i class=\"ti ti-alert-triangle\" style=\"color:var(--yellow)\"></i> '\r\n"
    "                + t('自動で見つけられませんでした。指で囲ってください。','Could not detect it — drag to set the area.'))\r\n"
    "          + '<br>' + t('読み取りも保存も、この枠の中だけになります。','Both OCR and the saved file use only this area.')\r\n"
    "          + '</div>'\r\n"
    "          + '<canvas id=\"crop-cv\" width=\"'+CW+'\" height=\"'+ch+'\" '\r\n"
    "          + 'style=\"width:100%;height:auto;border-radius:10px;display:block;touch-action:none;'\r\n"
    "          + 'background:var(--surface2);max-height:56vh;object-fit:contain\" '\r\n"
    "          + 'onpointerdown=\"cropDown(event)\" onpointermove=\"cropMove(event)\" '\r\n"
    "          + 'onpointerup=\"cropUp()\" onpointercancel=\"cropUp()\" onpointerleave=\"cropUp()\"></canvas>'\r\n"
    "          + '<div style=\"display:flex;align-items:center;gap:8px;margin-top:7px\">'\r\n"
    "          + '<span id=\"crop-info\" style=\"font-size:11px;color:var(--muted)\"></span>'\r\n"
    "          + '<button class=\"btn btn-secondary btn-sm\" style=\"margin-left:auto\" onclick=\"cropReset()\">'\r\n"
    "          + '<i class=\"ti ti-refresh\"></i> '+t('枠を戻す','Reset')+'</button></div>'\r\n"
    "          + '<div class=\"btn-row\">'\r\n"
    "          + '<button class=\"btn btn-secondary\" onclick=\"cropApply(true)\">'\r\n"
    "          + '<i class=\"ti ti-photo\"></i> '+t('全体を使う','Use whole photo')+'</button>'\r\n"
    "          + '<button class=\"btn btn-primary\" onclick=\"cropApply(false)\">'\r\n"
    "          + '<i class=\"ti ti-scan\"></i> '+t('この範囲で読み取る','Use this area')+'</button></div>');\r\n"
    "        var canvas=ok ? document.getElementById('crop-cv') : null;\r\n"
    "        if(!canvas) return finish(file);\r\n"
    "        _cropS={ canvas:canvas, base:base, img:img, url:url, file:file,\r\n"
    "                 iw:iw, ih:ih, scale:scale, auto:auto, drag:null,\r\n"
    "                 box: auto ? { x:auto.x*CW, y:auto.y*ch, w:auto.w*CW, h:auto.h*ch }\r\n"
    "                           : { x:CW*0.05, y:ch*0.05, w:CW*0.90, h:ch*0.90 },\r\n"
    "                 finish:finish };\r\n"
    "        _cropDraw(); _cropInfo();\r\n"
    "      }catch(e){\r\n"
    "        console.warn('askInvoiceCrop', e);\r\n"
    "        finish(file);\r\n"
    "      }\r\n"
    "    };\r\n"
    "    img.src=url;\r\n"
    "  });\r\n"
    "}\r\n",
    "askInvoiceCrop を専用オーバーレイ化し、必ず resolve する形に")

rep("const APP_VERSION = '891';", "const APP_VERSION = '892';", "APP_VERSION 891 -> 892")

open(P, 'wb').write(d)

d2 = open(P, 'rb').read()
crlf = d2.count(b'\r\n'); lf = d2.count(b'\n')
print('\nCRLF %d (was %d) / lone LF %d' % (crlf, orig_crlf, lf - crlf))
assert lf - crlf == 0, 'lone LF detected'

s = open('sw.js', 'rb').read()
assert s.count(b"const SW_BUILD = '891';") == 1
open('sw.js', 'wb').write(s.replace(b"const SW_BUILD = '891';", b"const SW_BUILD = '892';", 1))
print('OK   SW_BUILD 891 -> 892')
