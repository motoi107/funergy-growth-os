# -*- coding: utf-8 -*-
"""v888 — グループの children に入っているのに NAV_ITEMS.roles で塞がれていた4項目を直す。
   Motoさん指示：tip / vacation / inventory / invoice の4つだけ。
   roles は「そのページを children に持つグループの roles の和集合」を満たす形にする。
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


NOTE = (
"  /* v888: グループは出すと言っているのに項目側の roles が塞いでいた4件を直す。\r\n"
"     roles は「そのページを children に持つグループの roles」を満たしていないと、\r\n"
"     画面からは『そのページが無い』のと見分けがつかない（buildNav が黙って外す）。\r\n"
"     権限そのものは変えていない。見えるだけで、できることは各機能側の判定のまま。 */\r\n"
)

# tip: MENU_GROUPS/人材管理(ceo,gm,office,am,sl) と ACCT_GROUPS/経理 予実・労務(office,office_crew)
rep("  {id:'tip',         label:'チップ管理',   icon:'ti-coin',             roles:['am','sl']},\r\n",
    NOTE +
    "  {id:'tip',         label:'チップ管理',   icon:'ti-coin',             roles:['ceo','gm','office','office_crew','am','sl']},\r\n",
    "tip に ceo/gm/office/office_crew を追加")

# vacation: MENU_GROUPS/人材管理 と ACCT_GROUPS/経理 申請・承認
rep("  {id:'vacation',    label:'休暇申請',    icon:'ti-beach',            roles:['sl','am','office','office_crew']},\r\n",
    "  {id:'vacation',    label:'休暇申請',    icon:'ti-beach',            roles:['ceo','gm','office','office_crew','am','sl']},\r\n",
    "vacation に ceo/gm を追加")

# inventory: MENU_GROUPS/食材管理(ceo,gm,office,am,sl) と CHEF_GROUPS/食材管理(chef)
rep("  {id:'inventory',   label:'棚卸し',   icon:'ti-box',              roles:['am','sl']},\r\n",
    "  {id:'inventory',   label:'棚卸し',   icon:'ti-box',              roles:['ceo','gm','office','chef','am','sl']},\r\n",
    "inventory に ceo/gm/office/chef を追加")

# invoice: MENU_GROUPS/食材管理 と ACCT_GROUPS/経理 請求・仕訳(office,office_crew)
rep("{id:'invoice',     label:'Invoice管理',     icon:'ti-file-invoice',     roles:['am','sl']},\r\n",
    "{id:'invoice',     label:'Invoice管理',     icon:'ti-file-invoice',     roles:['ceo','gm','office','office_crew','am','sl']},\r\n",
    "invoice に ceo/gm/office/office_crew を追加")

rep("const APP_VERSION = '887';", "const APP_VERSION = '888';", "APP_VERSION 887 -> 888")

open(P, 'wb').write(d)

d2 = open(P, 'rb').read()
crlf = d2.count(b'\r\n'); lf = d2.count(b'\n')
print('\nCRLF %d (was %d) / lone LF %d' % (crlf, orig_crlf, lf - crlf))
assert lf - crlf == 0, 'lone LF detected'

s = open('sw.js', 'rb').read()
assert s.count(b"const SW_BUILD = '887';") == 1
open('sw.js', 'wb').write(s.replace(b"const SW_BUILD = '887';", b"const SW_BUILD = '888';", 1))
print('OK   SW_BUILD 887 -> 888')
