# -*- coding: utf-8 -*-
"""v889 — 伝票の保存形式を画像から PDF にする（Motoさん依頼：経理が扱いやすいため）。
   メモ機能は一切触らない。OCR に渡すものも今までどおり画像のまま。
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


# =====================================================================
# 1) PDF 生成本体 ＋ 変換
# =====================================================================
BUILDER = (
"/* ===== v889: 伝票は PDF で保存する =====\r\n"
"   Motoさん依頼：経理が扱うなら画像より PDF。メモ機能はそのまま。\r\n"
"   決めごと:\r\n"
"   ・OCR に渡すものは今までどおり画像。読み取り精度に影響を出さない。\r\n"
"     保存する実体だけを PDF にする。\r\n"
"   ・PDF 化は自前で組む。CDN のライブラリに頼ると、電波の悪い現場\r\n"
"     （v873 で退避キューを作った理由そのもの）で変換できず形式が混ざる。\r\n"
"   ・元から PDF で届いたものは、その PDF をそのまま保存する。\r\n"
"     pdfToImageFile() で潰すと3ページ目以降が消えるため。\r\n"
"   ・既存の .jpg は変換しない。ビューアが拡張子で出し分ける。\r\n"
"   ・変換に失敗したら元の画像で保存する。形式より伝票が残ることを優先する。 */\r\n"
"function _pdfNum(n){ return String(Math.round(n*100)/100); }\r\n"
"function _pdfLatin1(str){\r\n"
"  var out=new Uint8Array(str.length);\r\n"
"  for(var i=0;i<str.length;i++) out[i]=str.charCodeAt(i)&0xff;\r\n"
"  return out;\r\n"
"}\r\n"
"/* JPEG をそのまま /DCTDecode で埋める。再圧縮しないので、ここで画質は落ちない。\r\n"
"   ページは必ず Letter。伝票ごとに紙のサイズが変わると経理が印刷・保管しにくい。 */\r\n"
"function _jpegToPdfBytes(jpegBytes, iw, ih){\r\n"
"  var PW=612, PH=792, M=18;                       /* Letter 72dpi・余白0.25in */\r\n"
"  var s=Math.min((PW-M*2)/iw, (PH-M*2)/ih);\r\n"
"  var dw=iw*s, dh=ih*s, dx=(PW-dw)/2, dy=(PH-dh)/2;\r\n"
"  var parts=[], len=0, offs=[];\r\n"
"  function push(u8){ parts.push(u8); len+=u8.length; }\r\n"
"  function pushStr(str){ push(_pdfLatin1(str)); }\r\n"
"  function obj(n, head, stream){\r\n"
"    offs[n]=len;\r\n"
"    pushStr(n+' 0 obj\\n'+head+'\\n');\r\n"
"    if(stream){ pushStr('stream\\n'); push(stream); pushStr('\\nendstream\\n'); }\r\n"
"    pushStr('endobj\\n');\r\n"
"  }\r\n"
"  var content='q\\n'+_pdfNum(dw)+' 0 0 '+_pdfNum(dh)+' '+_pdfNum(dx)+' '+_pdfNum(dy)+' cm\\n/Im0 Do\\nQ\\n';\r\n"
"  var cb=_pdfLatin1(content);\r\n"
"  pushStr('%PDF-1.4\\n');\r\n"
"  obj(1, '<</Type/Catalog/Pages 2 0 R>>');\r\n"
"  obj(2, '<</Type/Pages/Kids[3 0 R]/Count 1>>');\r\n"
"  obj(3, '<</Type/Page/Parent 2 0 R/MediaBox[0 0 '+PW+' '+PH+']'\r\n"
"       + '/Resources<</XObject<</Im0 4 0 R>>>>/Contents 5 0 R>>');\r\n"
"  obj(4, '<</Type/XObject/Subtype/Image/Width '+iw+'/Height '+ih\r\n"
"       + '/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length '\r\n"
"       + jpegBytes.length+'>>', jpegBytes);\r\n"
"  obj(5, '<</Length '+cb.length+'>>', cb);\r\n"
"  var xref=len, N=6;\r\n"
"  var x='xref\\n0 '+N+'\\n0000000000 65535 f \\n';\r\n"
"  for(var i=1;i<N;i++) x+=String(offs[i]).padStart(10,'0')+' 00000 n \\n';\r\n"
"  x+='trailer\\n<</Size '+N+'/Root 1 0 R>>\\nstartxref\\n'+xref+'\\n%%EOF\\n';\r\n"
"  pushStr(x);\r\n"
"  var out=new Uint8Array(len), p=0;\r\n"
"  parts.forEach(function(u){ out.set(u,p); p+=u.length; });\r\n"
"  return out;\r\n"
"}\r\n"
"/* canvas を通して JPEG に揃える。ここには2つ意味がある。\r\n"
"   ① iPhone の写真は EXIF に回転が入っている。生のまま PDF に埋めると横倒しになる。\r\n"
"      canvas に描くとブラウザが回転を適用した状態になるので、必ず正しい向きで入る。\r\n"
"   ② 4〜12MB の写真を 2400px に抑える。送信が重いこと自体が\r\n"
"      7月のレシート消失（アップロード失敗の握り潰し）の背景でもあった。 */\r\n"
"function _invNormalizeJpeg(file){\r\n"
"  return new Promise(function(res, rej){\r\n"
"    var url;\r\n"
"    try{ url=URL.createObjectURL(file); }catch(e){ return rej(e); }\r\n"
"    var img=new Image();\r\n"
"    img.onload=function(){\r\n"
"      try{\r\n"
"        var MAX=2400;\r\n"
"        var w=img.naturalWidth||img.width, h=img.naturalHeight||img.height;\r\n"
"        if(!w || !h){ throw new Error('size unknown'); }\r\n"
"        var sc=Math.min(1, MAX/Math.max(w,h));\r\n"
"        var cw=Math.max(1,Math.round(w*sc)), ch=Math.max(1,Math.round(h*sc));\r\n"
"        var cv=document.createElement('canvas'); cv.width=cw; cv.height=ch;\r\n"
"        var cx=cv.getContext('2d');\r\n"
"        cx.fillStyle='#fff'; cx.fillRect(0,0,cw,ch);   /* 透過PNG が黒くならないように */\r\n"
"        cx.drawImage(img,0,0,cw,ch);\r\n"
"        cv.toBlob(function(b){\r\n"
"          try{ URL.revokeObjectURL(url); }catch(e){}\r\n"
"          if(!b) return rej(new Error('toBlob failed'));\r\n"
"          b.arrayBuffer().then(function(ab){\r\n"
"            res({ bytes:new Uint8Array(ab), w:cw, h:ch });\r\n"
"          }, rej);\r\n"
"        }, 'image/jpeg', 0.9);\r\n"
"      }catch(e){ try{ URL.revokeObjectURL(url); }catch(_){} rej(e); }\r\n"
"    };\r\n"
"    img.onerror=function(){ try{ URL.revokeObjectURL(url); }catch(_){} rej(new Error('image decode failed')); };\r\n"
"    img.src=url;\r\n"
"  });\r\n"
"}\r\n"
"function _invIsPdf(f){\r\n"
"  return !!f && ((f.type==='application/pdf') || /\\.pdf$/i.test(f.name||''));\r\n"
"}\r\n"
"async function invoiceToPdfFile(file){\r\n"
"  if(!file) return null;\r\n"
"  if(_invIsPdf(file)) return file;               /* 元がPDFならそのまま残す */\r\n"
"  var n=await _invNormalizeJpeg(file);\r\n"
"  var bytes=_jpegToPdfBytes(n.bytes, n.w, n.h);\r\n"
"  var nm=String(file.name||'invoice').replace(/\\.[^.]+$/,'')+'.pdf';\r\n"
"  return new File([bytes], nm, {type:'application/pdf'});\r\n"
"}\r\n"
)

rep("async function uploadInvoiceImage(file, storeName, invId){\r\n"
    "  if(!file) return null;\r\n"
    "  window._invPendingImgId = null;\r\n"
    "  var path = '';\r\n"
    "  try{\r\n"
    "    var d=new Date(); var ym=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');\r\n"
    "    var ext=(file.type&&file.type.indexOf('png')>=0)?'png':'jpg';\r\n"
    "    path=saniStore(storeName)+'/'+ym+'/inv_'+Date.now()+'.'+ext;\r\n"
    "    var r=await fetch(SUPABASE_URL+'/storage/v1/object/invoices/'+encodeURI(path), {\r\n"
    "      method:'POST',\r\n"
    "      headers:{ apikey:SUPABASE_ANON, Authorization:'Bearer '+SUPABASE_ANON, 'Content-Type':file.type||'image/jpeg', 'x-upsert':'true' },\r\n"
    "      body:file\r\n"
    "    });\r\n",
    BUILDER +
    "async function uploadInvoiceImage(file, storeName, invId){\r\n"
    "  if(!file) return null;\r\n"
    "  window._invPendingImgId = null;\r\n"
    "  window._invPdfFallback = '';\r\n"
    "  var path = '';\r\n"
    "  /* v889: 保存する実体を PDF にする。元がPDFで届いていればそれを優先する。 */\r\n"
    "  var up=file, ext='pdf', mime='application/pdf';\r\n"
    "  try{\r\n"
    "    up = await invoiceToPdfFile(window._invoiceSourceFile || file);\r\n"
    "    if(!up) throw new Error('convert returned null');\r\n"
    "  }catch(e){\r\n"
    "    /* 変換できなくても伝票は必ず残す。形式より、写真が失われないことが優先。 */\r\n"
    "    console.warn('invoice pdf convert failed, falling back to image', e);\r\n"
    "    window._invPdfFallback = String((e&&e.message)||e||'convert failed');\r\n"
    "    up=file;\r\n"
    "    ext=(file.type&&file.type.indexOf('png')>=0)?'png':'jpg';\r\n"
    "    mime=file.type||'image/jpeg';\r\n"
    "  }\r\n"
    "  try{\r\n"
    "    var d=new Date(); var ym=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');\r\n"
    "    path=saniStore(storeName)+'/'+ym+'/inv_'+Date.now()+'.'+ext;\r\n"
    "    var r=await fetch(SUPABASE_URL+'/storage/v1/object/invoices/'+encodeURI(path), {\r\n"
    "      method:'POST',\r\n"
    "      headers:{ apikey:SUPABASE_ANON, Authorization:'Bearer '+SUPABASE_ANON, 'Content-Type':mime, 'x-upsert':'true' },\r\n"
    "      body:up\r\n"
    "    });\r\n",
    "PDF生成を追加し、uploadInvoiceImage を PDF 保存に切り替え")

# 退避キューにも PDF を渡す（file → up）
rep("      window._invPendingImgId = await pimgQueue(file, path, invId);\r\n"
    "      return null;\r\n",
    "      window._invPendingImgId = await pimgQueue(up, path, invId);   /* v889: PDFのまま退避 */\r\n"
    "      return null;\r\n",
    "退避キュー（HTTPエラー時）も PDF を保持")

rep("    try{ window._invPendingImgId = await pimgQueue(file, path, invId); }catch(e2){ window._invPendingImgId = null; }\r\n",
    "    try{ window._invPendingImgId = await pimgQueue(up, path, invId); }catch(e2){ window._invPendingImgId = null; }\r\n",
    "退避キュー（通信断時）も PDF を保持")

# =====================================================================
# 2) 元が PDF なら、そのファイルを保存対象として覚えておく
# =====================================================================
rep("async function runInvoiceOCR(file){\r\n  if(!file) return;\r\n  window._invoicePhotoFile = file;\r\n",
    "async function runInvoiceOCR(file){\r\n  if(!file) return;\r\n  window._invoicePhotoFile = file;\r\n"
    "  /* v889: 既定は「画像から作ったPDF」。元がPDFのときだけ呼び出し側が上書きする。 */\r\n"
    "  window._invoiceSourceFile = null;\r\n",
    "runInvoiceOCR で保存元をリセット")

rep("      var img=await pdfToImageFile(file);\r\n      await runInvoiceOCR(img);\r\n",
    "      var img=await pdfToImageFile(file);\r\n"
    "      await runInvoiceOCR(img);\r\n"
    "      /* v889: OCR には画像を渡すが、保存するのは元のPDF。\r\n"
    "         pdfToImageFile() は3ページまでしか使わないので、潰すとページが消える。 */\r\n"
    "      window._invoiceSourceFile = file;\r\n",
    "PDF入稿は元のPDFをそのまま保存")

# =====================================================================
# 3) ビューア：PDF は pdf.js で描く（メモ側は触らない）
# =====================================================================
VIEWER = (
"/* v889: PDF は <img> では出せないので、1ページ目から順に描く。\r\n"
"   署名URLを直接 pdf.js に渡さず、いったん自分で取ってから渡す。\r\n"
"   一括復旧と同じ取り方にして、CORS の当たり方を1本に揃えるため。\r\n"
"   描けないとき（オフライン等）は［別タブで開く］に案内する。 */\r\n"
"async function _ivShowPdf(box, url){\r\n"
"  try{\r\n"
"    var lib=await ensurePdfJs(); if(!lib) throw new Error('pdfjs unavailable');\r\n"
"    var res=await fetch(url); if(!res.ok) throw new Error('HTTP '+res.status);\r\n"
"    var buf=await res.arrayBuffer();\r\n"
"    var pdf=await lib.getDocument({data:buf}).promise;\r\n"
"    var total=pdf.numPages||1, n=Math.min(total,3);\r\n"
"    box.innerHTML=''; box.style.display='block'; box.style.background='transparent';\r\n"
"    for(var p=1;p<=n;p++){\r\n"
"      var page=await pdf.getPage(p);\r\n"
"      var base=page.getViewport({scale:1});\r\n"
"      var sc=Math.min(2, 900/(base.width||600));\r\n"
"      var vp=page.getViewport({scale:sc});\r\n"
"      var c=document.createElement('canvas');\r\n"
"      c.width=Math.ceil(vp.width); c.height=Math.ceil(vp.height);\r\n"
"      c.style.cssText='max-width:100%;height:auto;border-radius:9px;display:block;'\r\n"
"        +'margin-bottom:6px;border:1px solid var(--border);background:#fff';\r\n"
"      box.appendChild(c);\r\n"
"      await page.render({canvasContext:c.getContext('2d'), viewport:vp}).promise;\r\n"
"    }\r\n"
"    if(total>n){\r\n"
"      var more=document.createElement('div');\r\n"
"      more.style.cssText='font-size:10.5px;color:var(--muted);text-align:center;padding:2px 0 4px';\r\n"
"      more.textContent='ほか '+(total-n)+' ページ（別タブで全部見られます）';\r\n"
"      box.appendChild(more);\r\n"
"    }\r\n"
"  }catch(e){\r\n"
"    console.warn('pdf preview', e);\r\n"
"    box.innerHTML='<div style=\"padding:16px;text-align:center;font-size:12px;color:var(--muted)\">'\r\n"
"      +'<i class=\"ti ti-file-type-pdf\" style=\"font-size:30px;color:var(--red);display:block;margin-bottom:7px\"></i>'\r\n"
"      +escapeHtml(t('PDFのプレビューを出せませんでした','Could not preview the PDF'))+'<br>'\r\n"
"      +escapeHtml(t('［別タブで開く］から確認してください','Use Open instead'))+'</div>';\r\n"
"  }\r\n"
"}\r\n"
"function _ivEsc(s){ return escapeHtml(String(s==null?'':s)); }\r\n"
)
rep("function _ivEsc(s){ return escapeHtml(String(s==null?'':s)); }\r\n", VIEWER,
    "ビューアに PDF 描画を追加")

rep("          box.innerHTML='<img src=\"'+SUPABASE_URL+'/storage/v1'+j.signedURL+'\" '\r\n"
    "            + 'style=\"max-width:100%;max-height:60vh;border-radius:9px;display:block\">';\r\n",
    "          var _u=SUPABASE_URL+'/storage/v1'+j.signedURL;\r\n"
    "          /* v889: 拡張子で出し分ける。既存の .jpg はこれまでどおり <img>。 */\r\n"
    "          if(/\\.pdf$/i.test(String(inv.imagePath||''))) await _ivShowPdf(box, _u);\r\n"
    "          else box.innerHTML='<img src=\"'+_u+'\" '\r\n"
    "            + 'style=\"max-width:100%;max-height:60vh;border-radius:9px;display:block\">';\r\n",
    "ビューアを拡張子で出し分け")

# =====================================================================
# 4) 一括復旧：OCR に渡す前に PDF を画像へ戻す（これが無いと PDF 分が漏れる）
# =====================================================================
rep("      var blob=await imgRes.blob();\r\n",
    "      var blob=await imgRes.blob();\r\n"
    "      /* v889: 保存形式が PDF になったので、OCR に渡す前に画像へ戻す。\r\n"
    "         ここを飛ばすと、PDFで保存した伝票が一括復旧から丸ごと漏れる。 */\r\n"
    "      if((blob.type==='application/pdf') || /\\.pdf$/i.test(String(tg.path||''))){\r\n"
    "        blob = await pdfToImageFile(new File([blob], 'recover.pdf', {type:'application/pdf'}));\r\n"
    "      }\r\n",
    "一括復旧で PDF を画像に戻してから OCR")

rep("    else { showToast('画像を開けませんでした','danger'); }\r\n"
    "  }catch(e){ showToast('画像を開けませんでした','danger'); }\r\n",
    "    else { showToast('ファイルを開けませんでした','danger'); }\r\n"
    "  }catch(e){ showToast('ファイルを開けませんでした','danger'); }\r\n",
    "別タブで開く失敗時の文言を形式に依存しない表現へ")

rep("const APP_VERSION = '888';", "const APP_VERSION = '889';", "APP_VERSION 888 -> 889")

open(P, 'wb').write(d)

d2 = open(P, 'rb').read()
crlf = d2.count(b'\r\n'); lf = d2.count(b'\n')
print('\nCRLF %d (was %d) / lone LF %d' % (crlf, orig_crlf, lf - crlf))
assert lf - crlf == 0, 'lone LF detected'

s = open('sw.js', 'rb').read()
assert s.count(b"const SW_BUILD = '888';") == 1
open('sw.js', 'wb').write(s.replace(b"const SW_BUILD = '888';", b"const SW_BUILD = '889';", 1))
print('OK   SW_BUILD 888 -> 889')
