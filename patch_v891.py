# -*- coding: utf-8 -*-
"""v891 — ガソリン代を店舗側のメニューに載せ、申請できるグレードを G4以上 → G3以上 にする。
   Motoさん指示：ナビ追加とマイページ導線の両方（案3）＋ G3以上。
   事前経費（expense）は指示が無いので G4以上のまま。カードの中で分けて出す。
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
# 1) ナビに載せる。これが無いと roles をどう書いても画面に出ない。
# =====================================================================
rep("   children:['staff_master','hiring','shift_admin','tip','hr','vacation','totoya_docs','crew_handbook']},\r\n",
    "   /* v891: mileage を追加。NAV_ITEMS の roles には全役職が書いてあったのに、\r\n"
    "      children に載せているのが ACCT_GROUPS だけだったため、経理以外の誰の画面にも\r\n"
    "      ガソリン代のタブが出ていなかった（G1〜CEO すべて）。休暇申請の隣に置く。\r\n"
    "      ここに載せると、設定の「Grade別の非表示ページ」にも並ぶので、\r\n"
    "      G2 には出したくない等の調整は設定側でできる。 */\r\n"
    "   children:['staff_master','hiring','shift_admin','tip','hr','vacation','mileage','totoya_docs','crew_handbook']},\r\n",
    "人材管理(g_hr) に mileage を追加")

# =====================================================================
# 2) 申請できるグレードを G3以上へ
# =====================================================================
rep("function canSubmitMileage(){ return (typeof myGradeNum==='function'?myGradeNum():1) >= 4; }\r\n",
    "/* v891: G4以上 → G3以上（Motoさん指示）。シフトリーダーが申請できるようになる。\r\n"
    "   承認側（canApproveMileage）は変えていない。申請できるだけで、承認権限は従来のまま。 */\r\n"
    "function canSubmitMileage(){ return (typeof myGradeNum==='function'?myGradeNum():1) >= 3; }\r\n",
    "canSubmitMileage を G3以上に")

rep("  if(!canSubmitMileage()){ alert('ガソリン代の申請はG4以上が対象です'); return; }\r\n",
    "  if(!canSubmitMileage()){ alert('ガソリン代の申請はG3以上が対象です'); return; }\r\n",
    "弾いたときの文言を G3以上 に")

# =====================================================================
# 3) マイページ：ガソリン代と事前経費のゲートを分ける
# =====================================================================
rep("  // 9b. 申請（G4以上のみ・G3以下は対象外）— 経費申請 / ガソリン代\r\n"
    "  if ((typeof myGradeNum==='function' ? myGradeNum() : 1) >= 4) {\r\n"
    "    html += `<div class=\"card\"><div class=\"card-title\"><i class=\"ti ti-files\"></i>${t('申請','Requests')}</div>`;\r\n"
    "    var myExp = (typeof getExpenseRequests==='function') ? getExpenseRequests().filter(function(r){return r.employee===me;}) : [];\r\n"
    "    html += `<div style=\"display:flex;justify-content:space-between;align-items:center;padding:6px 0\">\r\n",
    "  /* v891: 事前経費とガソリン代を1つの >=4 でまとめて出していたため、\r\n"
    "     ガソリン代を G3 に開けると事前経費まで一緒に開いてしまう。\r\n"
    "     しきい値を書き直すのではなく、それぞれの判定関数に任せて中で分ける。\r\n"
    "     ・事前経費 canSubmitExpense() … G4以上（変更なし）\r\n"
    "     ・ガソリン代 canSubmitMileage() … G3以上（v891で変更）\r\n"
    "     こうしておくと、次にどちらかのグレードを動かしてもここは直さなくてよい。 */\r\n"
    "  var _mpExp = (typeof canSubmitExpense==='function') ? canSubmitExpense() : false;\r\n"
    "  var _mpMile = (typeof canSubmitMileage==='function') ? canSubmitMileage() : false;\r\n"
    "  if (_mpExp || _mpMile) {\r\n"
    "    html += `<div class=\"card\"><div class=\"card-title\"><i class=\"ti ti-files\"></i>${t('申請','Requests')}</div>`;\r\n"
    "    if (_mpExp) {\r\n"
    "    var myExp = (typeof getExpenseRequests==='function') ? getExpenseRequests().filter(function(r){return r.employee===me;}) : [];\r\n"
    "    html += `<div style=\"display:flex;justify-content:space-between;align-items:center;padding:6px 0\">\r\n",
    "マイページ：事前経費とガソリン代のゲートを分離")

rep("    var myMile = (typeof getMileageRequests==='function') ? getMileageRequests().filter(function(r){return r.employee===me;}) : [];\r\n"
    "    html += `<div style=\"display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-top:1px solid var(--border);margin-top:4px\">\r\n",
    "    }\r\n"
    "    if (_mpMile) {\r\n"
    "    var myMile = (typeof getMileageRequests==='function') ? getMileageRequests().filter(function(r){return r.employee===me;}) : [];\r\n"
    "    /* 事前経費が出ていないときは上の区切り線を出さない（先頭が線で始まらないように） */\r\n"
    "    html += `<div style=\"display:flex;justify-content:space-between;align-items:center;padding:6px 0${_mpExp?';border-top:1px solid var(--border);margin-top:4px':''}\">\r\n",
    "マイページ：ガソリン代の行を canSubmitMileage で出す")

rep("    if (myMile.length) {\r\n"
    "      myMile.slice(-2).reverse().forEach(function(r){\r\n",
    "    if (_mpMile && myMile.length) {\r\n"
    "      myMile.slice(-2).reverse().forEach(function(r){\r\n",
    "マイページ：ガソリン代の履歴も同じ条件に")

rep("      });\r\n"
    "    }\r\n"
    "    html += '</div>';\r\n"
    "  }\r\n"
    "\r\n"
    "  // 9. Growth Hub（My Page内に埋め込み）\r\n",
    "      });\r\n"
    "    }\r\n"
    "    }\r\n"
    "    html += '</div>';\r\n"
    "  }\r\n"
    "\r\n"
    "  // 9. Growth Hub（My Page内に埋め込み）\r\n",
    "マイページ：ガソリン代ブロックを閉じる")

rep("const APP_VERSION = '890';", "const APP_VERSION = '891';", "APP_VERSION 890 -> 891")

open(P, 'wb').write(d)

d2 = open(P, 'rb').read()
crlf = d2.count(b'\r\n'); lf = d2.count(b'\n')
print('\nCRLF %d (was %d) / lone LF %d' % (crlf, orig_crlf, lf - crlf))
assert lf - crlf == 0, 'lone LF detected'

s = open('sw.js', 'rb').read()
assert s.count(b"const SW_BUILD = '890';") == 1
open('sw.js', 'wb').write(s.replace(b"const SW_BUILD = '890';", b"const SW_BUILD = '891';", 1))
print('OK   SW_BUILD 890 -> 891')
