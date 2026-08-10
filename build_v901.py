# -*- coding: utf-8 -*-
"""v901: 日次進捗に日毎の人件費率を表示する（案1: 人件費 ÷ 実績）

  ・分子は画面の「人件費」列そのもの（時給×時間 ＋ 給与税17% ＋ 月給/保険の日割り）
  ・分母は同じ行の「実績」（dayAct）
  ・実績が無い日・人件費が0の日は '—'
  ・集計（全店）モードでも出す。総額÷総売上の加重値になり、既存の全体値の考え方と一致
  ・信号色は付けない。日別は残業割増を含まず低めに出るため、
    月次KPIのしきい値（28/31%）で色を付けると誤誘導になる。チップ率と同じ扱い。
"""
import io

def rd(p):
    with io.open(p, 'r', newline='', encoding='utf-8') as f: return f.read()
def wr(p, s):
    with io.open(p, 'w', newline='', encoding='utf-8') as f: f.write(s)
def _crlf(t): return t.replace('\r\n', '\n').replace('\n', '\r\n')
def rep(s, old, new, why):
    if '\r\n' in s: old, new = _crlf(old), _crlf(new)
    n = s.count(old); assert n == 1, u'アンカーが %d 件: %s' % (n, why)
    return s.replace(old, new)

src = rd('index.html')

# ① ヘッダーに1列足す。* は表下の注記への参照。
src = rep(src,
    "<th>${t('労働h','Labor h')}</th><th>${t('人件費','Labor $')}</th>",
    "<th>${t('労働h','Labor h')}</th><th>${t('人件費','Labor $')}</th><th>${t('人件費率*','Labor %*')}</th>",
    u'日次進捗テーブルのヘッダー')

# ② 率の算出。チップ率と同じ位置・同じ形。
src = rep(src,
    "    cumB += dayBud; cumA += (hasAct?dayAct:0);",
    "    /* v901: 日別の人件費率＝人件費 ÷ 実績。\n"
    "       分子の dayLaborCost は残業割増を含まない（週40h超の判定は週単位でしか出せない）ため、\n"
    "       laborCoreForYm を使う月次KPIの人件費率とは一致しない。表下に注記あり。 */\n"
    "    var dayLaborRate = (hasAct && dayAct>0 && dayLaborCost>0) ? dayLaborCost/dayAct*100 : null;\n"
    "    cumB += dayBud; cumA += (hasAct?dayAct:0);",
    u'人件費率の算出')

# ③ 人件費セルの直後に率のセル。
src = rep(src,
    "      <td style=\"font-size:11px;color:var(--muted)\">${dayLaborCost>0?fmtUSD2(dayLaborCost):'—'}</td>",
    "      <td style=\"font-size:11px;color:var(--muted)\">${dayLaborCost>0?fmtUSD2(dayLaborCost):'—'}</td>\n"
    "      <td style=\"font-size:11px\">${dayLaborRate!=null?`<span title=\"${fmtUSD2(dayLaborCost)} ÷ ${fmtUSD2(dayAct)}\">${dayLaborRate.toFixed(1)}%</span>`:'—'}</td>",
    u'人件費率のセル')

# ④ 表の下に注記。月次KPIとズレる理由をここでしか説明しない。
src = rep(src,
    "  html += '</tbody></table>';",
    "  html += '</tbody></table>';\n"
    "  /* v901: 月次KPIとの差の理由。ここを消すと日別と月次のズレが説明されないまま残る。 */\n"
    "  html += `<p style=\"font-size:11px;color:var(--muted);margin-top:6px\">${t('* 人件費率＝人件費 ÷ 実績。日別は週40時間超の残業割増を含まないため、上部の月次KPIの人件費率とは一致しません。','* Labor % = Labor $ ÷ Actual. Daily values exclude the weekly overtime premium, so they do not match the monthly Labor % KPI above.')}</p>`;",
    u'表下の注記')

# ⑤ 版
src = rep(src, "const APP_VERSION = '900';", "const APP_VERSION = '901';", u'APP_VERSION')

assert src.count('\n') - src.count('\r\n') == 0, u'lone LF が残っている'
wr('index.html', src)

sw = rd('sw.js')
wr('sw.js', rep(sw, "const SW_BUILD = '900';", "const SW_BUILD = '901';", u'SW_BUILD'))
print('OK')
