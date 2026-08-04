# Funergy Growth OS — 引き継ぎ v847（SQL 差し替え済み）

**v847：シフト作成テスト用スタッフ15名を、設定画面から作成／削除できるようにした。**

**あわせて、v845 の SQL が型エラーで落ちていた件を直した（アプリ本体の変更なし）。**

---

## 0. 最初にやること

```bash
unzip funergy_v847_handoff.zip
tar -xJf handoff_v847.tar.xz
cd handoff_v847
TZ=Pacific/Honolulu node run_verify.js
```

**期待値**

```
合計 PASS=4047  FAIL=0  実行=71/86
合流ルールの未定義: 1
同期対象で未保護: 0
予算の対象月: 3 / 7
APP_VERSION=847 / SW_BUILD=847
CRLF=57721 / lone LF=0
```

**v836〜v847 とも未 push。**

---

## 1. 使い方

**設定 → 「シフト作成テスト用スタッフ」（GM / CEO のみ表示）**

- 「15名を作成」で作る。2回押しても増えない（足りない人だけ作り直す）
- 「まとめて削除」で全員消える。本物の従業員は消えない
- 名前はすべて **`TEST`** で始まる
- **全員 営業中の全店（9店）でシフトに入れられる**

### ⚠️ 消し忘れに注意

従業員マスターに入るので、**シフト以外にも出る**：
チップ配分・人件費・スキル評価・スタッフ一覧・ログイン画面。
試し終わったら削除すること。画面にも同じ警告を出してある。

他の端末へ反映するには **設定 → マスター一括投入**。
`m_employees` はクラウドから自動で pull されないので、ローカルで消せばその端末では終わり。

---

## 2. 15名の内訳（働き方をひととおり）

| # | 名前 | 肩書き | 等級 | 時給 | 想定 |
|---|---|---|---|---|---|
| 01 | TEST 01 Fulltime | Crew | G1 | $18 | 正社員・週5フル・L/D両方 |
| 02 | TEST 02 Lunch | Crew | G1 | $16 | ランチ専門・週3 |
| 03 | TEST 03 Dinner | Crew | G1 | $16.5 | ディナー専門・週4 |
| 04 | TEST 04 Prep AM | Prep Specialist | G1-P | $16 | 早朝Prep・ホールに出ない |
| 05 | TEST 05 CrewLeader | Crew Leader | G2 | $17 | 週5・新人フォロー |
| 06 | TEST 06 ServerLead | Server Leader | G3 | $18.5 | SL・ディナー中心・締め |
| 07 | TEST 07 KitchenLead | Kitchen Leader | G3 | $18.5 | SL・キッチン専任 |
| 08 | TEST 08 Weekend | Crew | G1 | $16 | 土日のみ・終日 |
| 09 | TEST 09 Weekday | Crew | G1 | $16 | 平日のみ・夕方から |
| 10 | TEST 10 ShortTime | Crew | G1 | $16 | 週2・1日4時間 |
| 11 | TEST 11 OpenClose | Crew | G1 | $17 | 開店/閉店どちらも |
| 12 | TEST 12 Prep PM | Prep Specialist | G1-P | $16 | 午後Prep・週2 |
| 13 | TEST 13 Helper | Crew | G1 | $16.5 | 複数店ヘルプ中心 |
| 14 | TEST 14 Newbie | Crew | G1 | $16 | 新人・スキル未評価 |
| 15 | TEST 15 OpsLeader | Operation Leader | G3 | $20 | 週5・全ポジション |

Prep 2名は `prep:true` なので Prep のシフト側に出る。ホールの候補には出ない。

---

## 3. 作りで気をつけたところ

### 全店でシフトに入れる仕組み

シフト候補は `atStore(e) = e.store===storeId || (e.support||[]).includes(storeId)` で決まる。
**`store:'ALL'` では1店舗も一致しない。**
そこで `support` に営業中の全店IDを入れてある（閉店店舗は除く）。

### リーダー職も role は 'crew'

シフト候補の絞り込みは `(e.role==='crew' || e.role==='office_crew')` で、
**`role:'sl'` にするとシフトに入れられなくなる**（最初 SL3名がここで落ちた）。

等級は `empGrade()` が `gradeOf(e.title)` を先に見るので、
**title だけで Server Leader=G3 / Crew Leader=G2 / Prep Specialist=G1-P** になる。
SL の数え方は `e.isSL || /Leader|Manager/.test(e.title)` なので、`isSL:true` を別に立ててある。

### 保存先

既存の `m_employees` のみ。**新しいキーは作っていない。**

---

## 4. 未確認・保留

### ① まだ流していない SQL

**`tip_credit_adj_v848.sql`** — クレジットTip調整の8列。
本番の「調整の保存に失敗しました（DB書込エラー）」の第一候補。
切り分けは `check_tip_adj_v848.sql`（読み取りのみ）。

**v845 の SQL は型エラーで落ちていた。列は1つも作られていない。**（下の第3章）

### ② v846 の実機確認

- **Akane（事務Crew）**：承認を押すと「権限がありません。事務Crewは閲覧のみです」が出るか
- **Akane**：ガソリン代の精算（今月・個人別・過去ログ）が見えるか
- **申請者（店長）**：自分の申請に承認済みの合計が出るか

### ③ Management Console（v837〜v843）

**KPI目標と本部予算が未設定のため、人件費率・原価率・営業利益・客数・客単価が全8店で判定不可。**
KPI管理 → 店舗タブで目標を入れると判定が出る。

### ④ 経理の表示（v844）

`原価管理`・`食材マスタ` を経理に残してよいか、`設定` を事務Crew に見せてよいか。どちらも1行。

### ⑤ その他

- **`management_control_v815.sql` の流し直しが未実施**（v824 の chef 追加ぶん）
- 管理統括はまだ「整備中」表示中
- 昨対（2025年データ）… 枠だけ
- `_LS_PRUNABLE` が死んでいる（v836 で発見・未着手）
- `supabase/functions/` が未push、`hyper-worker` が未デプロイ
- **v839 の出どころ**（並行作業のもの。`HANDOFF_v840.md` 第3章）

---

## 3.5 v845 の SQL が落ちていた件（重要）

Moto さんが `tip_credit_adj_v845.sql` を流したら、こう出た：

```
ERROR: 42883: operator does not exist: name[] = text[]
```

**原因**：一意制約を確認する箇所で
`array_agg(a.attname)` は `name[]` を返す（`pg_attribute.attname` が `name` 型のため）。
これを `array['business_date','restaurant_guid']`（`text[]`）と比較していた。
PostgreSQL に `name[] = text[]` の演算子は無い。

**影響**：Supabase の SQL エディタは全体を1トランザクションで流すため、
**エラーの手前で成功していた `alter table` もすべてロールバックされた。**
→ **調整用の列は1つも作られていない。**

**直した版**：`tip_credit_adj_v848.sql` / `check_tip_adj_v848.sql`

- 両側を `::text` / `::text[]` に揃えた
- テーブルが無いときに何が悪いか分かるようにした
- 診断SQL（`check_`）は**列が無い状態でも最後まで流れる**ようにした
  （v845 版は最後の [6] が「列が無い」で ERROR になり、いちばん診断したい状態で止まっていた）
- 結果を最後に `adj_columns / expected / result` で出す

**今回は PostgreSQL 16 を立てて実際に流して確認した。**

| 試した状態 | 結果 |
|---|---|
| 列なし → 移行SQL | 8列できる・`data` に既定値が入る |
| もう一度同じSQL | 何も壊れない（全部 skipping） |
| 一意制約なし | 警告を出して止まらない |
| テーブルなし | 「public.tip_labor がありません」で分かる |
| 診断SQL（列なし／テーブルなし／正常） | 3状態とも ERROR なしで完走 |
| アプリと同じ upsert 3パターン | 既存行は勤怠を保持・行が無い日も作成できた |

**旧版（`tip_credit_adj_v845.sql` / `check_tip_adj.sql`）はバンドルから削除した。**
残しておくと、また落ちるほうを流してしまう。

---

## 5. 教訓

v807 ①〜⑤、v825 ⑥〜⑫、v835 ⑬〜⑱、v836 ⑲〜㉑、v837 ㉒〜㉔、v838 ㉕㉖、v840 ㉗、
v841 ㉘、v842 ㉙㉚、v843 ㉛㉜、v844 ㉝㉞㉟、v845 ㊱㊲㊳、v846 ㊴㊵㊶ は有効。追加分：

### ㊷ テストデータを入れるときは、消し方を先に作る

本番の従業員マスターに15名入れる作業。**作成より先に削除を書いた。**

- 名前を `TEST` で始める（どの画面でも見分けがつく）
- `isTest:true` の印を持たせる（機械でまとめて選べる）
- 「まとめて削除」を同じ画面に置く
- **どこに影響するかを画面に書く**（チップ配分・人件費・評価・ログイン）

消し方が無いテストデータは、いつか本番の数字に混ざる。

### ㊸ 「全店で使える」は store:'ALL' ではない

`atStore(e) = e.store===storeId || support.includes(storeId)` なので、
**`store:'ALL'` は1店舗も一致しない。**`support` に全店IDを入れるのが正しい。

**判定式を読んでから値を決めること。**「ALL と書けば全部だろう」は通らない。

### ㊺ SQL は書いたら流す。書きっぱなしで渡さない

`tip_credit_adj_v845.sql` を一度も実行せずに渡し、Moto さんの環境で型エラーになった。
しかも Supabase は全体を1トランザクションで流すので、**列の追加ごと全部ロールバック**され、
「SQLを流したのに直らない」という一番たちの悪い状態になった。

**この回は PostgreSQL 16 をその場で立てて、5パターン試してから渡した。**
`apt-get install postgresql` は通る。SQL を書いたら必ず動かす。

### ㊻ 診断用SQLは「壊れている状態」で流して確かめる

`check_tip_adj.sql` は、**列が無いと最後の [6] で ERROR になった。**
列が無い状態こそ診断したい状態なので、そこで止まっては意味がない。

**診断は、正常系ではなく異常系で試すこと。**
動的SQL（`execute`）で組み立てれば、無い列・無いテーブルでも最後まで流れる。

### ㊼ 時刻が「変わったこと」をテストしない

`verify_v804` が3回に1回落ちていた。原因は
`updated_at !== 前回の updated_at`。**作成と編集が同じミリ秒に入ると同じ値になる。**

不安定な検証は基準値そのものを信用できなくする（FAIL=0 が偶然かもしれない）。
**時刻は「入っていること・巻き戻っていないこと」で見る。**

### ㊹ 役職（role）と肩書き（title）は別。シフトは role で絞られる

リーダーを `role:'sl'` で作ったら、シフト候補の絞り込み
`(e.role==='crew'||e.role==='office_crew')` に引っかかって**シフトに入れられなかった**。

このアプリでは
- **等級** … `title` が先（`gradeOf(title)`）、無ければ `role`
- **シフト候補** … `role`
- **SL の数え方** … `isSL` または title の Leader 判定

**3つが別々の項目を見ている。**人を作るときは3つとも確認する。

---

## 6. 適用が必要な SQL

| ファイル | 状態 |
|---|---|
| `management_control_v808/811.sql` | 適用済み |
| `management_control_v815.sql` | **v824 で chef 追加。流し直しが必要** |
| `management_control_v822_cleanup.sql` | 適用済み |
| **`tip_credit_adj_v848.sql`** | **未適用。v845 版は型エラーで全ロールバックされている** |

**確認用（読み取りのみ）**：`check_tip_adj_v848.sql` / `check_mc_v818.sql` / `check_toast_sync.sql`

---

## 7. 同梱ファイル（追加・変更ぶん）

| ファイル | 用途 |
|---|---|
| `index.html` / `sw.js` | **v847 本体（GitHub 未 push）** |
| `verify_v847.js` | **新設**。15名・全店シフト可・偏りなし・削除の検証（PASS=97） |
| `index_v847_backup.html` | **新設** |
| **`tip_credit_adj_v848.sql`** | **クレジットTip調整の列。PostgreSQL 16 で実行確認済み** |
| **`check_tip_adj_v848.sql`** | **原因の切り分け。壊れた状態でも最後まで流れる** |
| `HANDOFF_v846.md` 〜 `HANDOFF_v807.md` | 過去の引き継ぎ |

---

## 8. 次のセッションの入り方

1. `TZ=Pacific/Honolulu node run_verify.js` → 第0章の期待値と一致するか
2. GitHub main を md5 で突き合わせる
3. **`tip_credit_adj_v848.sql` を流す** → `check_tip_adj_v848.sql` で確認 → 実機で調整を保存
4. v846 の実機確認（事務Crewの権限・ガソリン代の精算）
4. 続きへ

**Motoさんは実画面を見て的確に指摘する。**
