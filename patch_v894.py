# -*- coding: utf-8 -*-
"""v894 — AM のダッシュボードの店舗別KPIを全店表示にする（Motoさん指示）。
   予実・発注などの他画面は従来どおり管轄店舗のみ。
   getVisibleStores() は触らない（触ると全画面に波及する）。
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
# 1) ダッシュボード専用のスコープ
# =====================================================================
HELPERS = (
"/* ===== v894: ダッシュボードの店舗別KPIだけ AM にも全店を出す =====\r\n"
"   Motoさん指示：GM と同じ見え方にする。ただしダッシュボードだけ。\r\n"
"   getVisibleStores() を広げると予実・発注・タスク・出力など全画面に波及するので、\r\n"
"   あの関数には絶対に手を入れない。ここで別のスコープを作って、\r\n"
"   ダッシュボードの表示だけがこちらを使う。\r\n"
"   ・数字は全店見える\r\n"
"   ・管轄外の店には入れない（下の dashCanEnter で遷移を塞ぐ）\r\n"
"   ・優先アクション／本日のタスクは管轄店舗のまま。入れない店の警告を出しても動けない。 */\r\n"
"function dashScopeStores(){\r\n"
"  if(curRole!=='am') return getVisibleStores();\r\n"
"  /* 上部で店舗を1つ選んでいるときは、GM と同じくその店だけに絞る。 */\r\n"
"  var out=(curStore==='ALL'||curStore==='OFFICE')\r\n"
"    ? activeStores()\r\n"
"    : activeStores().filter(function(s){ return s.id===curStore; });\r\n"
"  return sortByLoginOrder(out);\r\n"
"}\r\n"
"/* AM が実際に入ってよい店か。管轄外は数字を見せるだけで、画面遷移はさせない。\r\n"
"   ここを緩めると、予実など管轄外の店の中身が開けてしまう。 */\r\n"
"function dashCanEnter(id){\r\n"
"  if(curRole!=='am') return true;\r\n"
"  try{\r\n"
"    var ids=myAmStores().concat(mySupportStores());\r\n"
"    return ids.indexOf(id)>=0;\r\n"
"  }catch(e){ return false; }\r\n"
"}\r\n"
)
rep("function renderDashboard() {\r\n", HELPERS + "function renderDashboard() {\r\n",
    "dashScopeStores / dashCanEnter を追加")

# =====================================================================
# 2) 表示は全店・アラートは管轄のみ
# =====================================================================
# 同じ1行が renderLaborOverview() にもある。人件費画面は管轄のままなので、
# renderDashboard 側だけを狙って前後を含めた一意なアンカーにする。
rep("  if (!rc.financial) return canSeeDashboard() ? renderSlFunergyNow() : renderMypage();\r\n"
    "  var stores = sortByLoginOrder(getVisibleStores()).map(s => storeData(s.id));\r\n",
    "  if (!rc.financial) return canSeeDashboard() ? renderSlFunergyNow() : renderMypage();\r\n"
    "  /* v894: 表示するKPIは dashScopeStores()（AM は全店）。\r\n"
    "     同じ行が renderLaborOverview() にもあるが、あちらは管轄店舗のまま。 */\r\n"
    "  var stores = sortByLoginOrder(dashScopeStores()).map(s => storeData(s.id));\r\n",
    "店舗別KPIの対象を全店に（ダッシュボードのみ）")

rep("  var danger = stores.filter(s=>s.status==='danger');\r\n"
    "  var laborOver = stores.filter(s=>s.labor>32);\r\n"
    "  var fcOver = stores.filter(s=>s.fc>34);\r\n",
    "  /* v894: 優先アクションは管轄店舗のみに絞る。全店の警告を出しても、\r\n"
    "     AM は管轄外の店に入れないので動きようがない（押しても遷移しない）。 */\r\n"
    "  var actionable = stores.filter(function(s){ return dashCanEnter(s.id); });\r\n"
    "  var danger = actionable.filter(s=>s.status==='danger');\r\n"
    "  var laborOver = actionable.filter(s=>s.labor>32);\r\n"
    "  var fcOver = actionable.filter(s=>s.fc>34);\r\n",
    "優先アクションは管轄店舗のみに限定")

rep("  var scopeLabel = curRole==='am' ? t('管轄店舗','My stores') : t('全店','All stores');\r\n",
    "  /* v894: AM も全店を見るようになったので表示を合わせる。 */\r\n"
    "  var scopeLabel = t('全店','All stores');\r\n",
    "見出しのスコープ表示を全店に")

# =====================================================================
# 3) 管轄外の店には入れないようにする
# =====================================================================
rep("        html += `<div class=\"store-row\">\r\n"
    "          <div class=\"store-dot\" style=\"background:${s.color}\"></div>\r\n"
    "          <div style=\"flex:1\" onclick=\"switchStore('${s.id}');go('budget')\">\r\n"
    "            <div style=\"display:flex;align-items:center;justify-content:space-between;\">\r\n"
    "              <div class=\"store-name\">${s.name}</div>\r\n"
    "              <span class=\"tag ${statusTag(s.status)}\">${s.sp}%</span>\r\n"
    "            </div>\r\n",
    "        /* v894: 管轄外の店は数字だけ。タップしても中には入れない。 */\r\n"
    "        var _canEnter = dashCanEnter(s.id);\r\n"
    "        html += `<div class=\"store-row\">\r\n"
    "          <div class=\"store-dot\" style=\"background:${s.color}\"></div>\r\n"
    "          <div style=\"flex:1${_canEnter?'':';cursor:default'}\" "
    "${_canEnter?`onclick=\"switchStore('${s.id}');go('budget')\"`:''}>\r\n"
    "            <div style=\"display:flex;align-items:center;justify-content:space-between;\">\r\n"
    "              <div class=\"store-name\">${s.name}${_canEnter?'':` <span class=\"tag tag-gray\" "
    "style=\"font-size:9.5px;vertical-align:middle\">${t('管轄外','Other')}</span>`}</div>\r\n"
    "              <span class=\"tag ${statusTag(s.status)}\">${s.sp}%</span>\r\n"
    "            </div>\r\n",
    "管轄外の店は遷移させず「管轄外」を明示")

rep("          <button class=\"btn btn-secondary btn-sm\" style=\"margin-left:8px\" onclick=\"event.stopPropagation();switchStore('${s.id}');openStoreCmd()\"><i class=\"ti ti-building-store\"></i></button>\r\n",
    "          ${_canEnter?`<button class=\"btn btn-secondary btn-sm\" style=\"margin-left:8px\" "
    "onclick=\"event.stopPropagation();switchStore('${s.id}');openStoreCmd()\">"
    "<i class=\"ti ti-building-store\"></i></button>`:''}\r\n",
    "管轄外の店には店舗コマンドのボタンを出さない")

# =====================================================================
# 4) Funergy Now も同じスコープに揃える
# =====================================================================
rep("  return sortByLoginOrder(getVisibleStores());\r\n"
    "}\r\n",
    "  /* v894: ダッシュボードの Funergy Now も店舗別KPIと同じスコープにする。\r\n"
    "     片方だけ全店だと、同じ画面で見えている店の数が食い違って混乱する。\r\n"
    "     dashScopeStores() は AM 以外では getVisibleStores() をそのまま返すので、\r\n"
    "     GM・CEO・SL・crew の見え方は変わらない。 */\r\n"
    "  return sortByLoginOrder((typeof dashScopeStores==='function') ? dashScopeStores() : getVisibleStores());\r\n"
    "}\r\n",
    "Funergy Now のスコープを店舗別KPIに揃える")

rep("const APP_VERSION = '893';", "const APP_VERSION = '894';", "APP_VERSION 893 -> 894")

open(P, 'wb').write(d)

d2 = open(P, 'rb').read()
crlf = d2.count(b'\r\n'); lf = d2.count(b'\n')
print('\nCRLF %d (was %d) / lone LF %d' % (crlf, orig_crlf, lf - crlf))
assert lf - crlf == 0, 'lone LF detected'

s = open('sw.js', 'rb').read()
assert s.count(b"const SW_BUILD = '893';") == 1
open('sw.js', 'wb').write(s.replace(b"const SW_BUILD = '893';", b"const SW_BUILD = '894';", 1))
print('OK   SW_BUILD 893 -> 894')
