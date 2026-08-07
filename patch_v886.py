# -*- coding: utf-8 -*-
"""v886 — 経理センターが描画できない原因（AC_TABS / _acCat / _acSub 未定義）の修正。
   透過置換。CRLF を保持し、アンカーは必ず 1 件だけであることを assert する。"""

P = 'index.html'
d = open(P, 'rb').read()
orig_crlf = d.count(b'\r\n')


def rep(old_s, new_s, note):
    """old_s / new_s は unicode。行末は \r\n で書くこと。"""
    global d
    old = old_s.encode('utf-8')
    new = new_s.encode('utf-8')
    n = d.count(old)
    assert n == 1, 'anchor count=%d (expected 1): %s' % (n, note)
    d = d.replace(old, new, 1)
    print('OK  ', note)


# ---------------------------------------------------------------- 1) AC_TABS 復元
BLOCK = (
"/* v886: AC_TABS と _acCat / _acSub の宣言がファイルから消えていた。\r\n"
"   renderAcctCenter() の1行目が AC_TABS.find(...) のため ReferenceError で落ち、\r\n"
"   el.innerHTML への代入自体が起きず、前の画面（Office管理）が残ったまま\r\n"
"   どのボタンも効かない状態になっていた。HANDOFF_v885 の記載どおりに復元する。\r\n"
"   守るべき約束ごと（ここを崩すと静かに壊れる）:\r\n"
"   ・sub.id は _acPend() が返す 'invoice','lost','gas','exp','vac' と一致させること。\r\n"
"     ずれると未処理バッジの飛び先（acSetSub）が存在しない中タブになる。\r\n"
"   ・sub.list は _acRows() が受け取る 'invoice','receipt','reimb','lost','gas' のみ。\r\n"
"   ・sub.fn / sub.more は window[名前]() で引数なしに呼ぶ。引数が要る関数は下の\r\n"
"     acDashBody / acErrBody のように包んでから載せること。 */\r\n"
"var _acCat = 'dash';\r\n"
"var _acSub = 'dash';\r\n"
"function acDashBody(){ return renderOfficeMgr(true); }   /* 帯なしで出す */\r\n"
"function acErrBody(){ return renderErrorCenter(true); }  /* 埋め込み表示 */\r\n"
"var AC_TABS = [\r\n"
"  { id:'dash', label:'経理ダッシュボード', icon:'ti-layout-dashboard', subs:[\r\n"
"      { id:'dash', label:'経理ダッシュボード', fn:'acDashBody' }\r\n"
"  ]},\r\n"
"  { id:'review', label:'経理レビュー', icon:'ti-file-check', subs:[\r\n"
"      { id:'invoice',  label:'Invoice',       list:'invoice', more:'renderInvoice' },\r\n"
"      { id:'receipt',  label:'レシート',       list:'receipt' },\r\n"
"      { id:'reimb',    label:'建て替え',       list:'reimb',   more:'renderReimburseCard' },\r\n"
"      { id:'lost',     label:'紛失届',         list:'lost',    more:'renderLostReceipt' },\r\n"
"      { id:'gas',      label:'ガソリン代',     list:'gas',     more:'renderMileage' },\r\n"
"      { id:'vac',      label:'休暇申請',       fn:'renderVacation' },\r\n"
"      { id:'exp',      label:'事前経費',       fn:'renderExpense' },\r\n"
"      { id:'purchase', label:'仕入明細',       fn:'renderPurchaseDetail' },\r\n"
"      { id:'vendor',   label:'業者マスター',   fn:'renderVendorMaster' },\r\n"
"      { id:'acctrev',  label:'区分・承認',     fn:'renderAcctReview' },\r\n"
"      { id:'err',      label:'エラーセンター', fn:'acErrBody' },\r\n"
"      { id:'task',     label:'タスク',         fn:'renderOfficeTasks' },\r\n"
"      { id:'appr',     label:'報告・承認',     fn:'renderApproval' }\r\n"
"  ]},\r\n"
"  { id:'tip', label:'Tip＆シフトリーダー', icon:'ti-coin', subs:[\r\n"
"      { id:'tip',   label:'Tip管理',        fn:'renderTipMgmt' },\r\n"
"      { id:'tipsl', label:'シフトリーダー', fn:'renderTipShiftLeader' }\r\n"
"  ]},\r\n"
"  { id:'export', label:'出力センター', icon:'ti-file-export', subs:[\r\n"
"      { id:'export', label:'棚卸・Tip', fn:'renderAcctExport' }\r\n"
"  ]},\r\n"
"  { id:'attend', label:'勤怠', icon:'ti-clock-hour-4', subs:[\r\n"
"      { id:'attend', label:'本部タイムカード', fn:'renderOfficeAttend' }\r\n"
"  ]},\r\n"
"  { id:'hr', label:'人材', icon:'ti-users', subs:[\r\n"
"      { id:'hr',     label:'人材', fn:'renderHR' },\r\n"
"      { id:'growth', label:'育成', fn:'renderGrowthHub' },\r\n"
"      { id:'hiring', label:'採用', fn:'renderHiring' }\r\n"
"  ]}\r\n"
"];\r\n"
)

rep("function acSetCat(id){\r\n",
    BLOCK + "function acSetCat(id){\r\n",
    "AC_TABS / _acCat / _acSub / acDashBody / acErrBody を復元")

# ------------------------------------------- 2) コールドスタート中も経理センターを描く
rep("var SKEL_LIGHT_PAGES = { settings:1, mypage:1, crew_handbook:1, notifications:1, biz_guide:1, required:1, goals:1 };\r\n",
    "/* v886: acct_center を追加。ここに無いページはコールドスタート中スケルトンを出して\r\n"
    "   return するため、起動直後・強制リロード直後だけボタンが効かない状態になっていた。 */\r\n"
    "var SKEL_LIGHT_PAGES = { settings:1, mypage:1, crew_handbook:1, notifications:1, biz_guide:1, required:1, goals:1, acct_center:1 };\r\n",
    "SKEL_LIGHT_PAGES に acct_center を追加")

# ------------------------------------------- 3) 描画失敗を画面に出す（前の画面を残さない）
rep("case 'acct_center':  el.innerHTML = renderAcctCenter(); break;\r\n",
    "case 'acct_center':\r\n"
    "      /* v886: 描画関数が例外を投げると el.innerHTML への代入自体が起きず、前の画面が\r\n"
    "         残ってボタンも効かない。v885 で実際にこれが起きた（AC_TABS 未定義）。\r\n"
    "         「何も変わらない」ではなく「落ちた事実」が画面に出るようにする。 */\r\n"
    "      try { el.innerHTML = renderAcctCenter(); }\r\n"
    "      catch(e){\r\n"
    "        try{ console.error('renderAcctCenter', e); }catch(_){}\r\n"
    "        el.innerHTML = '<div class=\"alert alert-warning\" style=\"padding:12px 14px\">'\r\n"
    "          + '<i class=\"ti ti-alert-triangle\"></i><div style=\"font-size:12.5px\">'\r\n"
    "          + '<b>' + t('経理センターの描画に失敗しました','Failed to render the accounting center') + '</b><br>'\r\n"
    "          + escapeHtml(String(e && e.message || e)) + '</div></div>';\r\n"
    "      }\r\n"
    "      break;\r\n",
    "case 'acct_center' を try/catch で包む")

# ------------------------------------------- 4) バージョン
rep("const APP_VERSION = '885';", "const APP_VERSION = '886';", "APP_VERSION 885 -> 886")

open(P, 'wb').write(d)

# ---- 事後検証 ----
d2 = open(P, 'rb').read()
crlf = d2.count(b'\r\n')
lf = d2.count(b'\n')
print('\nCRLF %d (was %d) / lone LF %d' % (crlf, orig_crlf, lf - crlf))
assert lf - crlf == 0, 'lone LF detected'

s = open('sw.js', 'rb').read()
assert s.count(b"const SW_BUILD = '885';") == 1
s = s.replace(b"const SW_BUILD = '885';", b"const SW_BUILD = '886';", 1)
open('sw.js', 'wb').write(s)
print('OK   SW_BUILD 885 -> 886')
