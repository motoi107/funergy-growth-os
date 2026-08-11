# -*- coding: utf-8 -*-
"""v907: 中間MTG 第1層 — 目標を固定表示する

  ねらい: スクロールして数字を追っているときに「何が目標だったか」を見失わない。

  作り: 各店カードの先頭に KPI 帯を置き、position:sticky で貼り付ける。
    ・カードごとに1本。その店のカードを見ている間はその店の帯が出て、
      次の店のカードに入ると自然に入れ替わる（CSSだけで成立する）
    ・スクロール監視や IntersectionObserver は使わない。
      renderPage() は innerHTML で丸ごと差し替えるため、リスナーを足すと
      画面を移動したあとに残って積み上がる（掃除の口が無い）
    ・top:52px は既存の作法（.ac-nav と同じ＝トップバーの直下。v883）

  横1行に収めて横スクロールにする。縦に積むと帯だけで画面が埋まり、
  下の実績カードが見えなくなる（案1でMotoさん確認済み：固定は1店ぶん）。

  金額は帯の中だけ短縮表記（$96.8k）。全角の数字はカード本体に出ているので、
  帯は「目標に対して今どこか」が分かれば足りる。
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

BLOCK = r"""/* v907: 固定表示するKPI帯。判定は既存の _meetStatus / _meetStatColor をそのまま使う
   （帯とカード本体で判定が食い違わないようにするため、新しいしきい値を作らない）。 */
function _meetPinShort(v, money, unit){
  if (v == null) return '—';
  if (!money) return (Math.round(v*10)/10) + (unit||'');
  var a = Math.abs(v);
  /* 帯は横1行なので短縮する。全額はカード本体に出ている。 */
  if (a >= 1000) return '$' + (Math.round(v/100)/10) + 'k';
  return '$' + (Math.round(v*10)/10);
}
function _meetPinHtml(store, rows, sts, paceBudget, isCurrent){
  var items = [];
  rows.forEach(function(it, i){
    var st = sts[i];
    var act = it.isSales ? it.act : it.act;
    var tgt = it.isSales ? paceBudget : it.tgt;
    items.push({ label:it.label, act:act, tgt:tgt, st:st,
                 money:!!it.money, unit:it.unit||'', isSales:!!it.isSales });
  });
  if (!items.length) return '';
  /* 未達を先頭へ。横スクロールの右端に隠れないようにする。 */
  items.sort(function(a,b){
    var r = function(x){ return x.st==='miss' ? 0 : (x.st==='warn' ? 1 : (x.st==='none' ? 3 : 2)); };
    return r(a) - r(b);
  });
  var h = '<div style="position:sticky;top:52px;z-index:30;background:var(--surface);'
    +     'margin:0 0 9px;padding:6px 0 7px;border-bottom:1px solid var(--border);'
    +     'display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch">';
  items.forEach(function(x){
    var col = (x.st==='none') ? 'var(--muted)' : _meetStatColor(x.st);
    var tint = (x.st==='none') ? 'var(--surface2)' : _meetStatTint(x.st);
    h += '<div style="flex:0 0 auto;background:'+tint+';border:1px solid '
      +  ((x.st==='miss')?'var(--red)':'var(--border)')+';border-radius:9px;padding:4px 9px;white-space:nowrap">'
      +  '<div style="font-size:9px;color:var(--muted);font-weight:700">'+escapeHtml(x.label)+'</div>'
      +  '<div style="font-size:12.5px;font-weight:800;color:'+col+';margin-top:1px">'
      +  _meetPinShort(x.act, x.money, x.unit)
      +  '<span style="font-size:9.5px;color:var(--muted);font-weight:700"> / '
      +  _meetPinShort(x.tgt, x.money, x.unit)+'</span></div></div>';
  });
  return h + '</div>';
}
"""

src = rep(src,
    "/* v904: 差分の原因を描く。計算は _meetGapBreakdown(v903) が持つ。ここは表示だけ。 */",
    BLOCK + "/* v904: 差分の原因を描く。計算は _meetGapBreakdown(v903) が持つ。ここは表示だけ。 */",
    u'_meetPinHtml の追加')

# カードタイトルの直後に帯を差し込む。paceBudget / _sts は既に算出済み。
src = rep(src,
    "    +'<span class=\"tag '+(missCount===0?'tag-green':(missCount<=1?'tag-yellow':'tag-red'))+'\" style=\"margin-left:auto\">'+(missCount===0?t('全KPI達成','All met'):(missCount+t('件 未達',' missed')))+'</span></div>';",
    "    +'<span class=\"tag '+(missCount===0?'tag-green':(missCount<=1?'tag-yellow':'tag-red'))+'\" style=\"margin-left:auto\">'+(missCount===0?t('全KPI達成','All met'):(missCount+t('件 未達',' missed')))+'</span></div>';\n"
    "  /* v907: 目標の固定表示。スクロールしても「何が目標か」が消えないようにする。 */\n"
    "  try { h += _meetPinHtml(store, rows, _sts, paceBudget, isCurrent); } catch(e){}",
    u'カードへの帯の差し込み')

src = rep(src, "const APP_VERSION = '906';", "const APP_VERSION = '907';", u'APP_VERSION')

assert src.count('\n') - src.count('\r\n') == 0, u'lone LF が残っている'
wr('index.html', src)
sw = rd('sw.js')
wr('sw.js', rep(sw, "const SW_BUILD = '906';", "const SW_BUILD = '907';", u'SW_BUILD'))
print('OK')
