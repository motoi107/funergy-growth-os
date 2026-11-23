#!/usr/bin/env python3
"""Career Score 2026 Q4（新制度）の評価表マスターを、Moto さんの Excel から作る。

  python3 -I scripts/gen-cs-q4-master.py <Excel のパス>            → careerscore/cs-q4-v1.json を書く
  python3 -I scripts/gen-cs-q4-master.py <Excel のパス> --check    → 書かずに、今のファイルと同じかを確かめる

Excel（Funergy_評価制度_G_P_S (4).xlsx）はリポジトリに入れない（正本は Moto さんの手元）。
JSON に Excel の sha256 を残す。読み方の決まり（2026Q4 の指示書の 2）：
  - 結合セルは左上の値だけを読む（openpyxl は結合の中の隠れた値を捨てる。隠れた値があることは確かめる）
  - ID は書いてある文字列のまま（「OF-Q-01／HR-Q-01」は 1 項目）。欠番を埋めない
  - G は E 列＝画面の説明・G 列＝評価者向け詳細（G 列は 23 項目だけに書いてある）、S は D 列・F 列、Prep は D 列。見直しメモは別の欄（スタッフ向けの説明に混ぜない）
  - 見直しメモは JSON に入れない（このリポジトリは公開。Moto さん 11/22 の答え 8 A＝どこにも出さない）
  - 配点・基準点・最低条件は「配点・基準点案」の表（G 23〜35 行・S Chef 60〜66 行・S Office 70〜76 行・基準点 12〜18 行・最低条件 40〜46 行）
"""
import hashlib, json, os, re, sys

import openpyxl

OUT = os.path.join(os.path.dirname(__file__), '..', 'careerscore', 'cs-q4-v1.json')
VERSION = 'CAREER_2026_Q4_V1'

def txt(v):
    if v is None:
        return ''
    s = str(v).replace('\r\n', '\n').replace('\r', '\n')
    return s.strip()

def fail(msg):
    sys.exit('STOP: ' + msg)

def rows(ws, start):
    for r in range(start, ws.max_row + 1):
        yield r, [ws.cell(r, c).value for c in range(1, ws.max_column + 1)]

def header_row(ws, want):
    for r, v in rows(ws, 1):
        if [txt(x) for x in v[:len(want)]] == want:
            return r
    fail(f'{ws.title}: 見出し {want} が見つからない')

G_CATS = [
    ('PHILO', 'Funergy Philosophy', '理念'),
    ('BASIC', '基本業務スキル', '基本業務'),
    ('SERVICE', 'サービススキル', 'サービス'),
    ('KITCHEN', 'キッチン／プレップ', 'Kitchen'),
    ('MARKETING', 'マーケティング', 'Marketing'),
    ('MGMT', 'マネジメント', '管理'),
    ('NUMBERS', '数字管理', '数字'),
    ('DEVELOP', '人材育成', '指導・育成'),
]
PHILO_CLASSES = [('ENJOY', '楽しむ'), ('THANK', '感謝'), ('CARE', '思いやる'), ('GROW', '成長'), ('SINCERE', '誠実')]
CHEF_CATS = [
    ('PHILO', '理念', '理念'),
    ('TECH', '技術・専門実務', '技術実務'),
    ('HYGIENE', '衛生・安全', '衛生安全'),
    ('QUALITY', '品質・管理', '品質管理'),
    ('PRODUCT', '商品開発', '商品開発'),
    ('COST_DESIGN', '原価設計', '原価設計'),
    ('COST_IMPROVE', '原価改善', '原価改善'),
    ('EFFICIENCY', '効率・改善', '効率改善'),
    ('TEACH', '技術共有・育成', '指導・育成'),
]
OFFICE_CATS = [
    ('PHILO', '理念', '理念'),
    ('TECH', '技術・専門実務', '技術実務'),
    ('QUALITY', '品質・管理', '品質管理'),
    ('EFFICIENCY', '効率・改善', '効率改善'),
    ('TEACH', '技術共有・育成', '指導・育成'),
]
OFFICE_DOMAINS = [('OFFICE', 'Office', ('OF-T-',)), ('ACCOUNTING', '経理', ('AC-T-',)), ('HR', '人事', ('HR-T-',))]

def g_items(ws):
    hr = header_row(ws, ['ID', 'カテゴリー', '中項目', '評価項目', '表示する説明（確認の要点＋具体例）', '見直しメモ', '評価者向け詳細（等級・採点上の注意を含む）'])
    by_name = {name: key for key, name, _ in G_CATS}
    cls_by = {n: k for k, n in PHILO_CLASSES}
    items = []
    for r, v in rows(ws, hr + 1):
        iid = txt(v[0])
        if not iid:
            continue
        cat = by_name.get(txt(v[1])) or fail(f'G {r} 行：カテゴリー {v[1]!r}')
        it = {'id': iid, 'cat': cat, 'sub': txt(v[2]), 'name': txt(v[3]), 'desc': txt(v[4]), 'detail': txt(v[6]), 'memo': txt(v[5]), 'row': r}
        if cat == 'PHILO':
            it['cls'] = cls_by.get(it['sub']) or fail(f'G {r} 行：理念の分類 {it["sub"]!r}')
        items.append(it)
    return items

def s_items(ws, cats, label):
    hr = header_row(ws, ['ID', '分野', '評価項目', '画面表示用（確認の要点＋例）', '見直しメモ', '評価者向け詳細（等級・採点上の注意を含む）'])
    by_name = {name: key for key, name, _ in cats}
    cls_by = {n: k for k, n in PHILO_CLASSES}
    items = []
    for r, v in rows(ws, hr + 1):
        iid = txt(v[0])
        if not iid:
            continue
        field = txt(v[1])
        it = {'id': iid, 'field': field, 'name': txt(v[2]), 'desc': txt(v[3]), 'detail': txt(v[5]), 'memo': txt(v[4]), 'row': r}
        m = re.fullmatch(r'理念：(.+)', field)
        if m:
            it['cat'] = 'PHILO'
            it['cls'] = cls_by.get(m.group(1)) or fail(f'{label} {r} 行：理念の分類 {field!r}')
        else:
            it['cat'] = by_name.get(field) or fail(f'{label} {r} 行：分野 {field!r}')
        if label == 'S_OFFICE' and it['cat'] == 'TECH':
            dom = [k for k, _, pre in OFFICE_DOMAINS if iid.startswith(pre)]
            if len(dom) != 1:
                fail(f'{label} {r} 行：技術・専門実務の {iid} の領域が決まらない')
            it['domain'] = dom[0]
        items.append(it)
    return items

def prep(ws):
    hr = header_row(ws, ['ID', '区分', '評価項目', '表示する説明（確認の要点＋具体例）', '見直しメモ'])
    cat = {'理念': 'PHILO', '衛生安全': 'HYGIENE', '基本': 'BASIC'}
    items = []
    for r, v in rows(ws, hr + 1):
        iid = txt(v[0])
        if not re.fullmatch(r'(PH|H|B)\d+', iid):
            if items:
                break
            continue
        items.append({'id': iid, 'cat': cat.get(txt(v[1])) or fail(f'Prep {r} 行：区分 {v[1]!r}'), 'catName': txt(v[1]), 'name': txt(v[2]), 'desc': txt(v[3]), 'memo': txt(v[4]), 'row': r})
    qh = header_row(ws, ['項目', '確認する品質', '判断の目安・具体例'])
    quality = []
    for r in range(qh + 1, qh + 4):
        quality.append({'id': txt(ws.cell(r, 1).value), 'name': txt(ws.cell(r, 2).value), 'desc': txt(ws.cell(r, 3).value), 'row': r})
    if [q['id'] for q in quality] != ['Q1', 'Q2', 'Q3']:
        fail('Prep：品質確認 Q1〜Q3 が並んでいない')
    ph = header_row(ws, ['段階', '時給USD', 'スピード下限', '下限の扱い', '習得範囲の最低', '説明'])
    pay = []
    for r in range(ph + 1, ph + 7):
        rule = txt(ws.cell(r, 4).value)
        if rule.startswith('以上'):
            incl = True
        elif rule.startswith('超'):
            incl = False
        else:
            fail(f'Prep {r} 行：下限の扱い {rule!r}')
        pay.append({'step': txt(ws.cell(r, 1).value), 'wageUsd': ws.cell(r, 2).value, 'speedMin': ws.cell(r, 3).value, 'speedInclusive': incl,
                    'rangeMin': ws.cell(r, 5).value, 'note': txt(ws.cell(r, 6).value), 'row': r})
    if [p['step'] for p in pay] != ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']:
        fail('Prep：P1〜P6 が並んでいない')
    notes = {}
    for r, v in rows(ws, ph + 7):
        t = txt(v[0])
        if t.startswith('スピード＝'):
            notes['speed'] = t
        elif t.startswith('習得範囲＝'):
            notes['range'] = t
    for k in ('speed', 'range'):
        if k not in notes:
            fail(f'Prep：{k} の決め方の文が見つからない')
    return items, quality, pay, notes

def table(ws, header, nrows, keys, label):
    hr = header_row(ws, header)
    out = []
    for r in range(hr + 1, hr + 1 + nrows):
        v = [ws.cell(r, c).value for c in range(1, len(header) + 1)]
        out.append((r, v))
    return hr, out

def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    check = '--check' in sys.argv[2:]
    raw = open(path, 'rb').read()
    wb = openpyxl.load_workbook(path, data_only=True)
    want_sheets = ['G評価項目', 'Prep評価項目', 'S Chef項目', 'S Office・経理・人事項目', '配点・基準点案', 'GM実装仕様']
    if wb.sheetnames != want_sheets:
        fail(f'シートの並びが違う：{wb.sheetnames}')

    g = g_items(wb['G評価項目'])
    chef = s_items(wb['S Chef項目'], CHEF_CATS, 'S_CHEF')
    office = s_items(wb['S Office・経理・人事項目'], OFFICE_CATS, 'S_OFFICE')
    p_items, p_quality, p_pay, p_notes = prep(wb['Prep評価項目'])

    ws = wb['配点・基準点案']
    # G の配点（23〜35 行）
    gh, grow = table(ws, ['等級', '担当型', '理念', '基本業務', 'サービス', 'Kitchen', 'Marketing', '管理', '数字', '指導・育成', '合計'], 12, None, 'G')
    if gh != 23:
        fail(f'G の配点の見出しが 23 行ではない（{gh}）')
    g_weights = {}
    for r, v in grow:
        grade, typ = txt(v[0]), txt(v[1])
        w = dict(zip([k for k, _, _ in G_CATS], v[2:10]))
        if sum(w.values()) != 100 or v[10] != 100:
            fail(f'G {r} 行：合計が 100 ではない')
        g_weights.setdefault(grade, {})[typ] = {'weights': w, 'row': r}
    # S Chef（60〜66 行）・S Office（70〜76 行）
    ch, crow = table(ws, ['等級', '理念', '技術実務', '衛生安全', '品質管理', '商品開発', '原価設計', '原価改善', '効率改善', '指導・育成', '合計'], 6, None, 'C')
    oh, orow = table(ws, ['等級', '理念', '技術実務', '品質管理', '効率改善', '指導・育成', '合計'], 6, None, 'O')
    if (ch, oh) != (60, 70):
        fail(f'S の配点の見出しの行が違う（{ch}, {oh}）')
    def s_weights(rws, cats):
        out = {}
        for r, v in rws:
            w = dict(zip([k for k, _, _ in cats], v[1:1 + len(cats)]))
            if sum(w.values()) != 100 or v[1 + len(cats)] != 100:
                fail(f'S {r} 行：合計が 100 ではない')
            out[txt(v[0])] = {'weights': w, 'row': r}
        return out
    chef_w, office_w = s_weights(crow, CHEF_CATS), s_weights(orow, OFFICE_CATS)
    # 基準点（12〜18 行）
    bh, brow = table(ws, ['段階', 'G基準点', 'S基準点', 'G必要平均', 'S必要平均'], 6, None, 'B')
    if bh != 12:
        fail('基準点の見出しが 12 行ではない')
    base = {'G': {}, 'S': {}}
    for r, v in brow:
        base['G'][str(v[0])] = v[1]
        base['S'][str(v[0])] = v[2]
    # 最低条件（40〜46 行）
    mh, mrow = table(ws, ['段階', '理念5分類の各平均', '基本業務', 'G主担当', 'G他部門', 'Chef衛生', 'S品質管理'], 6, None, 'M')
    if mh != 40:
        fail('最低条件の見出しが 40 行ではない')
    minimum = {}
    for r, v in mrow:
        minimum[str(v[0])] = {'philoClass': v[1], 'basic': v[2], 'gMain': v[3], 'gOther': v[4], 'chefHygiene': v[5], 'sQuality': v[6], 'row': r}
    r47 = txt(ws.cell(47, 1).value)
    for must in ('G2以上・S2以上の指定項目01-13・01-14・01-09・01-16は対象各2点以上',):
        if must not in r47:
            fail('最低条件の指定項目（47 行）の文が変わった')
    r67 = txt(ws.cell(67, 1).value)

    data = {
        'version': VERSION,
        'note': 'Career Score 2026 Q4（新制度）の評価表マスター。scripts/gen-cs-q4-master.py が Excel から作る。手で直さない。',
        'source': {'file': 'Funergy_評価制度_G_P_S (4).xlsx', 'sha256': hashlib.sha256(raw).hexdigest(), 'sheets': want_sheets},
        'period': {'tz': 'Pacific/Honolulu', 'quarter': '2026-Q4', 'start': '2026-10-01', 'endExclusive': '2027-01-01'},
        'scale': {'0': 'できていない', '1': '支援が必要・不安定', '2': '合意した担当範囲で自立して安定実行', '3': '安定実行に加えて改善・指導・周囲への良い影響を継続'},
        'philoClasses': [{'key': k, 'name': n} for k, n in PHILO_CLASSES],
        'systems': {
            'G': {
                'name': 'G', 'unassigned': True,
                'categories': [{'key': k, 'name': n, 'short': s} for k, n, s in G_CATS],
                'items': g,
                'weights': g_weights,
                'mainMap': {
                    'Kitchen中心': {'main': ['KITCHEN'], 'other': ['SERVICE']},
                    'Server中心': {'main': ['SERVICE'], 'other': ['KITCHEN']},
                },
                'mainMapNote': '両部門育成・店長・管轄責任・全社責任の「G主担当」「G他部門」の対象カテゴリーは資料に書いていない（Moto さんに確かめる。決まるまでその 2 つの最低条件は判定を保留）',
            },
            'S_CHEF': {
                'name': 'S Chef', 'unassigned': False,
                'categories': [{'key': k, 'name': n, 'short': s} for k, n, s in CHEF_CATS],
                'items': chef,
                'weights': chef_w,
                'sourceNotes': {'row67': r67, 'applied': 'CF-32 は等級で自動除外しない（指示書 5-1・GM実装仕様が優先）'},
            },
            'S_OFFICE': {
                'name': 'S Office・経理・人事', 'unassigned': False,
                'categories': [{'key': k, 'name': n, 'short': s} for k, n, s in OFFICE_CATS],
                'domains': [{'key': k, 'name': n, 'prefixes': list(p)} for k, n, p in OFFICE_DOMAINS],
                'items': office,
                'weights': office_w,
            },
            'PREP': {
                'name': 'Prep', 'unassigned': False,
                'items': p_items,
                'quality': p_quality,
                'pay': p_pay,
                'payNotes': p_notes,
            },
        },
        'base': base,
        'minimum': minimum,
        'minimumItems': {'fromGrade': 2, 'ids': ['01-13', '01-14', '01-09', '01-16'], 'min': 2, 'systems': ['G', 'S_CHEF', 'S_OFFICE']},
    }

    # 照合（指示書の 2・検証の 4）
    def ids(items):
        return [i['id'] for i in items]
    for label, items, n in (('G', g, 122), ('Prep', p_items, 11), ('S Chef', chef, 52), ('S Office', office, 46)):
        if len(items) != n:
            fail(f'{label}：{len(items)} 項目（{n} のはず）')
        if len(set(ids(items))) != n:
            fail(f'{label}：同じ ID がある')
        for it in items:
            if not it['name'] or not it['desc']:
                fail(f'{label} {it["id"]}：評価項目か説明が空')
            if label in ('S Chef', 'S Office') and not it['detail']:
                fail(f'{label} {it["id"]}：評価者向け詳細が空')
    cnt = lambda items, cat: sum(1 for i in items if i['cat'] == cat)
    if [cnt(g, k) for k, _, _ in G_CATS] != [16, 13, 12, 20, 13, 21, 15, 12]:
        fail('G のカテゴリーごとの件数が指示書と違う')
    if cnt(chef, 'PHILO') != 16 or cnt(office, 'PHILO') != 15:
        fail('S の理念の件数が違う')
    for must in ('06-16', '06-17', '06-18', '06-19', '06-20', '06-21', '07-13', '07-14', '07-15', '08-12', '08-11'):
        if must not in ids(g):
            fail(f'G に {must} が無い')
    for absent in ('02-06', '05-07'):
        if absent in ids(g):
            fail(f'G に {absent} がある（欠番のはず）')
    if '01-04' in ids(office):
        fail('S Office の理念に 01-04 がある（欠番のはず）')
    if 'CF-32' not in ids(chef):
        fail('S Chef に CF-32 が無い')
    if 'OF-Q-01／HR-Q-01' not in ids(office):
        fail('S Office の共通 ID が分かれている')
    if sorted(g_weights) != ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'] or sorted(chef_w) != ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'] or sorted(office_w) != sorted(chef_w):
        fail('配点の等級が足りない')
    if base['G'] != {'1': 55, '2': 65, '3': 75, '4': 85, '5': 90, '6': 95} or base['S'] != {'1': 65, '2': 70, '3': 75, '4': 85, '5': 90, '6': 95}:
        fail('基準点が指示書の表と違う')

    # 見直しメモは公開の JSON に入れない（Moto さん 11/22 の答え 8 A）
    for sysdef in data['systems'].values():
        for key in ('items', 'quality'):
            for it in sysdef.get(key, []):
                it.pop('memo', None)
    out = json.dumps(data, ensure_ascii=False, indent=1) + '\n'
    if '"memo"' in out:
        fail('見直しメモが JSON に残っている')
    if check:
        cur = open(OUT, encoding='utf-8').read()
        if cur != out:
            fail('careerscore/cs-q4-v1.json が Excel と合わない（もう一度作る）')
        print('same', len(g), len(p_items), len(chef), len(office))
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w', encoding='utf-8').write(out)
    print('wrote', OUT, len(out), 'bytes', len(g), len(p_items), len(chef), len(office))

if __name__ == '__main__':
    main()
