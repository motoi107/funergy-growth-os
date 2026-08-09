# -*- coding: utf-8 -*-
"""v893 — ① 伝票の向きを取り込み時に必ず立てる（Motoさん報告：文字の向きが勝手に変わる）
          ② 業者名は手入力せず、写真から自動で入れる
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


# 2x1 / EXIF orientation=6 の見本。回転が適用されると 1x2 になる。
PROBE = ("/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAA0J"
         "CgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//"
         "2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09P"
         "T09PT0//wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA"
         "AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJico"
         "KSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm"
         "p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEB"
         "AQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEI"
         "FEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0"
         "dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk"
         "5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD06iiigD//2Q==")

BLOCK = (
"/* ===== v893: 伝票の向きを取り込み時に必ず立てる =====\r\n"
"   Motoさん報告：文字の向きが勝手に変わる。原因は EXIF の回転タグ。\r\n"
"   iPhone の写真は画素を回さず「回して表示してね」というタグだけ付ける。\r\n"
"   さらに厄介なのは、そのタグを自動で適用するかがブラウザ実装で違うこと。\r\n"
"   決め打ちすると端末ごとに向きが変わる（＝勝手に変わって見える）。\r\n"
"   なので:\r\n"
"   ① タグを自分で読む\r\n"
"   ② この端末が自動適用するかを、見本を1枚デコードして実測する\r\n"
"   ③ 自動適用されない端末でだけ自分で回す\r\n"
"   ④ 結果を EXIF の無い JPEG に焼き直す\r\n"
"   ここから先（切り出し・OCR・PDF）は向きを一切考えなくてよくなる。\r\n"
"   向きの扱いはこの1か所だけが持つ。 */\r\n"
"function _exifOrientation(bytes){\r\n"
"  try{\r\n"
"    if(!bytes || bytes.length<4) return 1;\r\n"
"    if(bytes[0]!==0xFF || bytes[1]!==0xD8) return 1;        /* SOI でなければ JPEG でない */\r\n"
"    var p=2, len=bytes.length;\r\n"
"    while(p+3<len){\r\n"
"      if(bytes[p]!==0xFF){ p++; continue; }\r\n"
"      var marker=bytes[p+1];\r\n"
"      if(marker===0xD8 || marker===0x01 || (marker>=0xD0 && marker<=0xD7)){ p+=2; continue; }\r\n"
"      if(marker===0xDA || marker===0xD9) break;             /* 画像データに入ったら終わり */\r\n"
"      var size=(bytes[p+2]<<8)|bytes[p+3];\r\n"
"      if(size<2) break;\r\n"
"      if(marker===0xE1 && p+9<len && bytes[p+4]===0x45 && bytes[p+5]===0x78\r\n"
"         && bytes[p+6]===0x69 && bytes[p+7]===0x66 && bytes[p+8]===0x00){   /* Exif\\0\\0 */\r\n"
"        var tiff=p+10;\r\n"
"        if(tiff+8>len) return 1;\r\n"
"        var be;\r\n"
"        if(bytes[tiff]===0x4D && bytes[tiff+1]===0x4D) be=true;\r\n"
"        else if(bytes[tiff]===0x49 && bytes[tiff+1]===0x49) be=false;\r\n"
"        else return 1;\r\n"
"        var u16=function(o){ return be?((bytes[o]<<8)|bytes[o+1]):((bytes[o+1]<<8)|bytes[o]); };\r\n"
"        var u32=function(o){\r\n"
"          return be ? (((bytes[o]<<24)|(bytes[o+1]<<16)|(bytes[o+2]<<8)|bytes[o+3])>>>0)\r\n"
"                    : (((bytes[o+3]<<24)|(bytes[o+2]<<16)|(bytes[o+1]<<8)|bytes[o])>>>0);\r\n"
"        };\r\n"
"        if(u16(tiff+2)!==42) return 1;\r\n"
"        var ifd=tiff+u32(tiff+4);\r\n"
"        if(ifd+2>len) return 1;\r\n"
"        var n=u16(ifd);\r\n"
"        for(var i=0;i<n;i++){\r\n"
"          var e=ifd+2+i*12;\r\n"
"          if(e+12>len) break;\r\n"
"          if(u16(e)===0x0112){ var v=u16(e+8); return (v>=1&&v<=8)?v:1; }\r\n"
"        }\r\n"
"        return 1;\r\n"
"      }\r\n"
"      p+=2+size;\r\n"
"    }\r\n"
"  }catch(e){}\r\n"
"  return 1;\r\n"
"}\r\n"
"/* 向き→canvas 変換。(w,h) は回転前の見た目サイズ。 */\r\n"
"function _orientTransform(ori, w, h){\r\n"
"  var swap=(ori>=5 && ori<=8);\r\n"
"  var tf;\r\n"
"  switch(ori){\r\n"
"    case 2: tf=[-1,0,0,1,w,0]; break;      /* 左右反転 */\r\n"
"    case 3: tf=[-1,0,0,-1,w,h]; break;     /* 180度 */\r\n"
"    case 4: tf=[1,0,0,-1,0,h]; break;      /* 上下反転 */\r\n"
"    case 5: tf=[0,1,1,0,0,0]; break;       /* 転置 */\r\n"
"    case 6: tf=[0,1,-1,0,h,0]; break;      /* 右90度 */\r\n"
"    case 7: tf=[0,-1,-1,0,h,w]; break;     /* 転置+180 */\r\n"
"    case 8: tf=[0,-1,1,0,0,w]; break;      /* 左90度 */\r\n"
"    default: tf=[1,0,0,1,0,0];\r\n"
"  }\r\n"
"  return { cw: swap?h:w, ch: swap?w:h, tf: tf };\r\n"
"}\r\n"
"/* この端末が EXIF の回転を自動で適用するか。1度だけ実測して覚える。 */\r\n"
"var _exifAutoRotate=null;\r\n"
"function _detectExifAutoRotate(){\r\n"
"  if(_exifAutoRotate!==null) return Promise.resolve(_exifAutoRotate);\r\n"
"  return new Promise(function(res){\r\n"
"    var done=function(v){ _exifAutoRotate=v; res(v); };\r\n"
"    try{\r\n"
"      var im=new Image();\r\n"
"      /* 2x1 に orientation=6。自動適用されるなら 1x2 になって返る。 */\r\n"
"      im.onload=function(){ done(im.naturalWidth===1 && im.naturalHeight===2); };\r\n"
"      im.onerror=function(){ done(false); };\r\n"
"      im.src='data:image/jpeg;base64," + PROBE + "';\r\n"
"    }catch(e){ done(false); }\r\n"
"  });\r\n"
"}\r\n"
"/* 取り込んだ写真を「まっすぐ・EXIFなし」の JPEG にして返す。\r\n"
"   何かあれば元のファイルをそのまま返す（写真を失わないことを優先）。 */\r\n"
"async function invUprightFile(file){\r\n"
"  try{\r\n"
"    if(!file || _invIsPdf(file)) return file;\r\n"
"    var buf=await file.arrayBuffer();\r\n"
"    var ori=_exifOrientation(new Uint8Array(buf));\r\n"
"    var auto=await _detectExifAutoRotate();\r\n"
"    /* 自動適用する端末では、img はすでに立っている。二重に回さない。 */\r\n"
"    var need = auto ? 1 : ori;\r\n"
"    if(need===1 && ori===1) return file;      /* 回転タグ自体が無い＝そのまま */\r\n"
"    return await new Promise(function(res){\r\n"
"      var url;\r\n"
"      try{ url=URL.createObjectURL(file); }catch(e){ return res(file); }\r\n"
"      var img=new Image();\r\n"
"      img.onerror=function(){ try{URL.revokeObjectURL(url);}catch(e){} res(file); };\r\n"
"      img.onload=function(){\r\n"
"        try{\r\n"
"          var w=img.naturalWidth||img.width, h=img.naturalHeight||img.height;\r\n"
"          if(!w||!h) throw new Error('size unknown');\r\n"
"          var o=_orientTransform(need, w, h);\r\n"
"          var cv=document.createElement('canvas'); cv.width=o.cw; cv.height=o.ch;\r\n"
"          var cx=cv.getContext('2d');\r\n"
"          cx.fillStyle='#fff'; cx.fillRect(0,0,o.cw,o.ch);\r\n"
"          cx.setTransform(o.tf[0],o.tf[1],o.tf[2],o.tf[3],o.tf[4],o.tf[5]);\r\n"
"          cx.drawImage(img,0,0,w,h);\r\n"
"          cx.setTransform(1,0,0,1,0,0);\r\n"
"          cv.toBlob(function(b){\r\n"
"            try{ URL.revokeObjectURL(url); }catch(e){}\r\n"
"            if(!b) return res(file);\r\n"
"            var nm=String(file.name||'photo').replace(/\\.[^.]+$/,'')+'.jpg';\r\n"
"            res(new File([b], nm, {type:'image/jpeg'}));\r\n"
"          }, 'image/jpeg', 0.95);\r\n"
"        }catch(e){\r\n"
"          console.warn('invUprightFile draw', e);\r\n"
"          try{ URL.revokeObjectURL(url); }catch(_){}\r\n"
"          res(file);\r\n"
"        }\r\n"
"      };\r\n"
"      img.src=url;\r\n"
"    });\r\n"
"  }catch(e){ console.warn('invUprightFile', e); return file; }\r\n"
"}\r\n"
)

rep("/* ---- 範囲の確認画面 ---- */\r\n", BLOCK + "/* ---- 範囲の確認画面 ---- */\r\n",
    "EXIF の向き読み取り・端末判定・向き補正を追加")

# ------------------------------------------------- 入口2つで必ず向きを立てる
rep("  } else {\r\n"
    "    /* v890: 伝票の範囲を確認してから読み取る。使うのは枠の中だけ。 */\r\n"
    "    var use = await askInvoiceCrop(file);\r\n"
    "    await runInvoiceOCR(use || file);\r\n"
    "  }\r\n",
    "  } else {\r\n"
    "    /* v893: 先に向きを立てる。ここから先は EXIF を持たない画像しか流れない。\r\n"
    "       切り出しの座標計算も、向きが揺れていると別の場所を切ってしまう。 */\r\n"
    "    var up = await invUprightFile(file);\r\n"
    "    /* v890: 伝票の範囲を確認してから読み取る。使うのは枠の中だけ。 */\r\n"
    "    var use = await askInvoiceCrop(up);\r\n"
    "    await runInvoiceOCR(use || up);\r\n"
    "  }\r\n",
    "ファイル選択の入口で向きを補正")

rep("  /* v890: こちらの入口も同じ扱いにする。片方だけ切れる状態を作らない。 */\r\n"
    "  var use = _invIsPdf(file) ? file : await askInvoiceCrop(file);\r\n"
    "  await runInvoiceOCR(use || file);\r\n",
    "  /* v893: 撮影の入口。ここが一番 EXIF の回転タグが付く経路。 */\r\n"
    "  var up = _invIsPdf(file) ? file : await invUprightFile(file);\r\n"
    "  /* v890: こちらの入口も同じ扱いにする。片方だけ切れる状態を作らない。 */\r\n"
    "  var use = _invIsPdf(up) ? up : await askInvoiceCrop(up);\r\n"
    "  await runInvoiceOCR(use || up);\r\n",
    "撮影の入口で向きを補正")

# ------------------------------------------------- 二重補正を避ける
rep("/* canvas を通して JPEG に揃える。ここには2つ意味がある。\r\n"
    "   ① iPhone の写真は EXIF に回転が入っている。生のまま PDF に埋めると横倒しになる。\r\n"
    "      canvas に描くとブラウザが回転を適用した状態になるので、必ず正しい向きで入る。\r\n"
    "   ② 4〜12MB の写真を 2400px に抑える。送信が重いこと自体が\r\n"
    "      7月のレシート消失（アップロード失敗の握り潰し）の背景でもあった。 */\r\n",
    "/* canvas を通して JPEG に揃える。\r\n"
    "   v893: 向きの補正はここではやらない。invUprightFile() が取り込み時に済ませており、\r\n"
    "   ここに来る画像は EXIF を持たない。二重に回すと逆に倒れる。\r\n"
    "   残る役割は、4〜12MB の写真を 2400px に抑えること。送信が重いこと自体が\r\n"
    "   7月のレシート消失（アップロード失敗の握り潰し）の背景でもあった。 */\r\n",
    "_invNormalizeJpeg のコメントを実態に合わせる")

# ------------------------------------------------- 業者名は自動で入れる
rep("      <input class=\"form-input\" id=\"inv-vendor\" list=\"inv-vendor-list\" placeholder=\"業者名を入力or選択\" oninput=\"checkVendorRegistered();invKindRefresh()\">\r\n",
    "      <input class=\"form-input\" id=\"inv-vendor\" list=\"inv-vendor-list\" "
    "placeholder=\"写真から自動で入ります\" oninput=\"invVendorTouched();checkVendorRegistered();invKindRefresh()\">\r\n"
    "      <div style=\"font-size:10.5px;color:var(--muted);margin-top:3px\">"
    "<i class=\"ti ti-sparkles\" style=\"color:var(--green)\"></i> 入力は不要です。写真を撮ると読み取って入ります（違うときだけ直してください）</div>\r\n",
    "業者名を「写真から自動」に変更")

rep("    if(data && data.vendor){\r\n"
    "      var vEl=document.getElementById('inv-vendor');\r\n"
    "      if(vEl && !vEl.value){\r\n",
    "    if(data && data.vendor){\r\n"
    "      var vEl=document.getElementById('inv-vendor');\r\n"
    "      /* v893: 自動で入れた値は撮り直しで上書きする。手で直した値は尊重する。\r\n"
    "         空のときだけ入れる作りだと、撮り直しても前の業者名が残り続ける。 */\r\n"
    "      if(vEl && (!vEl.value || vEl.dataset.auto==='1')){\r\n",
    "撮り直しでも業者名を入れ直せるように")

rep("        if(typeof checkVendorRegistered==='function') checkVendorRegistered();\r\n"
    "      }\r\n"
    "    }\r\n",
    "        try{ vEl.dataset.auto='1'; }catch(e){}   /* 自動で入れた印 */\r\n"
    "        if(typeof checkVendorRegistered==='function') checkVendorRegistered();\r\n"
    "        if(typeof invKindRefresh==='function') invKindRefresh();\r\n"
    "      }\r\n"
    "    }\r\n",
    "自動入力の印を付け、食材判定も更新")

rep("function checkVendorRegistered() {\r\n",
    "/* v893: 手で触ったら自動上書きの対象から外す。 */\r\n"
    "function invVendorTouched(){\r\n"
    "  try{ var el=document.getElementById('inv-vendor'); if(el) el.dataset.auto='0'; }catch(e){}\r\n"
    "}\r\n"
    "function checkVendorRegistered() {\r\n",
    "手入力を検出する invVendorTouched を追加")

rep("const APP_VERSION = '892';", "const APP_VERSION = '893';", "APP_VERSION 892 -> 893")

open(P, 'wb').write(d)

d2 = open(P, 'rb').read()
crlf = d2.count(b'\r\n'); lf = d2.count(b'\n')
print('\nCRLF %d (was %d) / lone LF %d' % (crlf, orig_crlf, lf - crlf))
assert lf - crlf == 0, 'lone LF detected'

s = open('sw.js', 'rb').read()
assert s.count(b"const SW_BUILD = '892';") == 1
open('sw.js', 'wb').write(s.replace(b"const SW_BUILD = '892';", b"const SW_BUILD = '893';", 1))
print('OK   SW_BUILD 892 -> 893')
