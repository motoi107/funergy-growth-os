# 計測の結果（measure.mjs の JSON）を、直す前と直したあとで並べる。中央値と回数を出す。
# python3 summarize.py <before のフォルダ> <after のフォルダ>
import json, os, sys, statistics as st

B, A = sys.argv[1], sys.argv[2]
def load(d, f):
    p = os.path.join(d, f)
    return json.load(open(p)) if os.path.exists(p) else None
def med(rs, k):
    v = [r[k] for r in rs if r.get(k) is not None]
    return (st.median(v), len(v), min(v), max(v)) if v else None
def sec(x): return '—' if x is None else f'{x[0]/1000:.2f} 秒（{x[1]} 回・{x[2]/1000:.2f}〜{x[3]/1000:.2f}）'
def netm(rs, k):
    if not rs: return None
    return (st.median([r[k]['n'] for r in rs]), st.median([r[k]['bytes'] for r in rs]) / 1e6, st.median([r[k]['raw'] for r in rs]) / 1e6)
def nets(x): return '—' if x is None else f'{x[0]:.0f} 件・{x[1]:.2f}MB（圧縮前 {x[2]:.1f}MB）'

for f, label in [('gm-cold-p1.json', 'GM・初めての端末・P1'), ('gm-warm-p1.json', 'GM・2 回目から・P1'), ('gm-warm-p1-noindex.json', 'GM・2 回目から・P1・SQL の関数なし'),
                 ('gm-cold-p2-cpu4.json', 'GM・初めての端末・P2（遅い回線・CPU 4 倍遅く）'), ('gm-warm-p2-cpu4.json', 'GM・2 回目から・P2（遅い回線・CPU 4 倍遅く）')]:
    rb, ra = load(B, f.replace('-noindex', '')) if 'noindex' in f else load(B, f), load(A, f)
    if not rb and not ra: continue
    print(f'\n### {label}\n')
    print('| 区間 | 直す前 | 直したあと |\n|---|---|---|')
    for k, n in [('t1_login_screen', '① ログイン画面が押せるまで'), ('t2_auth', '② ログイン → PIN の確認'), ('t3a_first_screen', '③ ログイン → 最初の画面が出て押せるまで'),
                 ('t3b_heavy', '③ ログイン → 骨組みの表示が外れるまで（取り込み終わりか 8 秒）'), ('t3c_net_idle', '③ ログイン → 通信が止まるまで'), ('t3d_data', '③ ログイン → 一括の行が端末に入るまで（初めての端末）')]:
        print(f'| {n} | {sec(med(rb or [], k))} | {sec(med(ra or [], k))} |')
    print(f"| ログインのあとの通信 | {nets(netm(rb, 'net3'))} | {nets(netm(ra, 'net3'))} |")
    print(f"| 開いてからログイン画面までの通信 | {nets(netm(rb, 'net1'))} | {nets(netm(ra, 'net1'))} |")
    if rb and ra:
        print(f"| 読み込み直し（初めての端末） | {sum(1 for r in rb if r.get('reloaded'))}/{len(rb)} 回 | {sum(1 for r in ra if r.get('reloaded'))}/{len(ra)} 回 |")

for f, label in [('gm-warm-pages.json', 'GM'), ('crew-warm-pages.json', 'G1（スタッフ）'), ('sl-warm-pages.json', 'G3（店舗）')]:
    rb, ra = load(B, f), load(A, f)
    if not rb and not ra: continue
    print(f'\n### ページを初めて開いたときの描画（{label}・2 回目からの端末・P1・中央値・ms）\n')
    pages = []
    for rs in (rb or []) + (ra or []):
        for p in rs['pages']:
            if p not in pages: pages.append(p)
    def pm(rs, p, key='ms'):
        v = [r['pages'][p][key] for r in (rs or []) if p in r['pages'] and r['pages'][p].get(key) is not None and r['pages'][p].get('ms', 0) >= 0]
        return st.median(v) if v else None
    def rv(rs, p):
        v = [r['revisit'][p] for r in (rs or []) if p in r.get('revisit', {})]
        return st.median(v) if v else None
    rows = []
    for p in pages:
        b, a = pm(rb, p), pm(ra, p)
        rows.append((b or 0, p, b, a, pm(rb, p, 'n'), pm(ra, p, 'n'), rv(rb, p), rv(ra, p)))
    rows.sort(reverse=True)
    print('| ページ | 直す前 | 直したあと | 開いて始まった通信（前→後） | 戻ったとき（前→後） |\n|---|---|---|---|---|')
    fmt = lambda x: '—' if x is None else f'{x:.0f}'
    for _, p, b, a, nb, na, vb, va in rows:
        print(f'| {p} | {fmt(b)} | {fmt(a)} | {fmt(nb)} → {fmt(na)} 件 | {fmt(vb)} → {fmt(va)} |')
    tb = sum(r[2] or 0 for r in rows); ta = sum(r[3] or 0 for r in rows)
    print(f'| **合計（{len(rows)} ページ）** | **{tb/1000:.1f} 秒** | **{ta/1000:.1f} 秒** | | |')
    print(f"\n回数：直す前 {len(rb or [])} 回・直したあと {len(ra or [])} 回。ページの例外：前 {sum(len(r.get('errors', [])) for r in (rb or []))}・後 {sum(len(r.get('errors', [])) for r in (ra or []))}")
