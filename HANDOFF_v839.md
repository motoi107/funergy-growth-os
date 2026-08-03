# Funergy Growth OS — 引き継ぎ v839

前回は v838（必須KPI設定 ＋ KPI目標保存が他項目を消していた不具合の修正）。
この回は **v839：Management Dashboard の器（PC 2カラム・ヘッダー・全体判定）。**

**初めて画面が出る版。作り込む前に Moto さんに見てもらうところで止めてある。**
中身の3枠（上部KPI・店舗別・Work Center）はまだプレースホルダ。

---

## 0. 最初にやること

```bash
unzip funergy_v839_handoff.zip
tar -xJf handoff_v839.tar.xz
cd handoff_v839
TZ=Pacific/Honolulu node run_verify.js
```

**期待値**

```
合計 PASS=3407  FAIL=0  実行=63/78
合流ルールの未定義: 1        ← spl_skills_st_ の1件だけが既知
同期対象で未保護: 0
予算の対象月: 3 / 7
APP_VERSION=839 / SW_BUILD=839
CRLF=56876 / lone LF=0
```

**画面を見る**

```bash
node make_preview.js      # → preview.html。ブラウザで開くだけ
```

`index.html` の `<style>` と描画関数をそのまま使って、GM表示と店長表示を1枚に出す。
数字はサンプル。**ブラウザ幅を 1180px より狭めるとスマホ表示（1カラム）に切り替わる。**
v840 以降も、作り込む前にこれで見てもらうこと。

**GitHub との突き合わせ（引き継ぎの記述を信じない・教訓⑳）**

```bash
curl -sL -o /tmp/gh.html https://raw.githubusercontent.com/motoi107/funergy-growth-os/main/index.html
md5sum /tmp/gh.html index.html
```

**v836〜v839 とも未 push。**

---

## 1. この回でやったこと — v839

### 画面の登録

| | |
|---|---|
| ページID | `mgmt_dash` |
| 名前 | 管理ダッシュボード（Management Dashboard） |
| 場所 | メニュー「ダッシュボード」の**先頭** |
| 権限 | **G4以上**（店長・Head Chef・AM・GM・CEO） |

**権限の口は `mdCanOpen()` ＝ `mcRole() !== ''`。**
`mcCanOpen()`（管理統括用）は **AM以上** なので使えない。店長が入れなくなる。
NAV_ITEMS の `roles` だけでは足りないので、管理統括と同じく
`groupsForRole()` で `mdCanOpen()` を最終判定にしている。

### 器（PC優先）

```
┌──────────────────────────────────┐
│ ヘッダー（ユーザー・役職・表示対象・期間・売上最終同期） │ 全幅
├──────────────────────────────────┤
│ 整備中バナー                                       │ 全幅
├──────────────────────────────────┤
│ 全体判定（大きく）                                  │ 全幅
├────────────────────┬─────────────┤
│ 上部KPI（v840）          │ Work Center（v844）  │
│ 店舗別の達成状況（v841） │ 店長への依頼（v845） │
│ KPI詳細（v842）          │                      │
└────────────────────┴─────────────┘
```

**CSS は加算だけ。**`.md-*` を新設し、**640px以下の既存ルールには1行も触っていない**
（他画面のモバイル表示を壊さないため）。

**2カラムに切り替えるのは `min-width:1180px`。**
このアプリは PC で `body{zoom:1.1}` が掛かるので、実効幅は viewport の約 1/1.1。
1180px で実効 約1070px（サイド340px ＋ メイン約700px）。

### 全体判定

**色だけで判断させない。**必ず 文字＋アイコン＋色 の3つで出す（仕様§1）。

| 状態 | 文字 | アイコン | 色 |
|---|---|---|---|
| ok | 達成 | `ti-circle-check` | green |
| miss | 未達 | `ti-alert-triangle` | red |
| unknown | 判定不可 | `ti-help-circle` | muted |

**役職で数え方を変える（仕様§3の表示例どおり）。**

- GM／AM／Head Chef … `未達｜3 / 8 店舗達成` ＋ `主な未達：売上・人件費率・原価率`
- 店長 … `未達｜主要KPI 2 / 4 達成` ＋ `未達：売上・原価率`（店舗数では出さない）

**判定不可は別枠で出す。**`判定不可 1店（達成にも未達にも数えていません）`。
達成にも未達にも足さない（教訓㉔）。

### 期間

**今月／前月のみ動く。今日／今週は「準備中」と出して押せなくしてある。**
判定層（v837）が月単位なので、日単位は v840（今日の売上）で入れる。
**動かないタブを黙って置かない。**

### この版で作っていないもの

- 数字の計算（判定は v837 の `mdScopeVerdict()` を呼ぶだけ）
- 保存（**新しい保存キーはゼロ。同期対象も増やしていない**）
- 上部KPI・店舗別一覧・Work Center 統合・店長依頼（v840〜v845）

---

## 2. Management Dashboard の進み具合

詳細は同梱の **`DESIGN_management_dashboard.md`**。

| 版 | 内容 | 状態 |
|---|---|---|
| v837 | 判定層（達成／未達／判定不可） | 完了 |
| v838 | 必須KPI設定（GM） | 完了 |
| v839 | **器（PC 2カラム・ヘッダー・全体判定）** | **完了・要レビュー** |
| v840 | 上部KPI 3項目（今日の売上・今月の着地予測・要対応）＋ 今日／今週タブ | 次 |
| v841 | 店舗別の確認表（**ランキングなし**・未達優先） | |
| v842 | KPI詳細パネル ＋ 既存分析画面への遷移 | |
| v843 | 役職別UI（SM / Head Chef / AM / GM / CEO の出し分け） | |
| v844 | Work Center の統合表示 ＋ 管理統括の「整備中」を外す | |
| v845 | 店長通知の画面連結（既存関数を呼ぶだけ） | |

### 使える判定層の口

```
mdVerdict(store, code, ym)   KPI1件 → {state, actual, target, diff, rate, reason, note}
mdStoreVerdict(store, ym)    店舗全体 → {state, okCount, total, misses, unknowns}
mdScopeVerdict(stores, ym)   全社・管轄 → {state, okCount, total, topMissLabels}
mdPrimaryKpis(store)         必須KPI（GM設定を反映）
mdForecastFrom(c)            月末売上予測
```

**画面側は数字を計算しないこと。**この5つを呼ぶだけにする。

### v840 で最初に見ること（性能）

`mdScopeVerdict` は 店舗数 × 必須KPI数 だけ
`cumulativeToToday` / `foodCostOf` / `plComputeStore` を呼ぶ。
GM の8〜11店だと既存の予実画面と同程度の重さになるはず**だが、実測していない。**

**v840 で実データを載せたら、まず iPhone で開いて体感を見ること。**
遅ければキャッシュを入れる。**測る前に先回りして最適化しない**（憶測で修正しない）。

### 役職別の出し分け（v843 の下ごしらえ）

- `mcRole()` は **ceo を gm に畳んでいる**。データ範囲は同じで、表示項目だけ絞る。
  `mcRole()` は触らない（管理統括全体に波及する）
- **Head Chef は MENU_GROUPS の `g_dash` に入っていない**（CHEF_GROUPS を見るため）。
  `mdCanOpen()` は通るので画面は開けるが、**メニューに入口が出ない。**
  v843 で CHEF_GROUPS への追加が要る

---

## 3. 未確認・保留

### ① 管理統括の残り（v836 から持ち越し）

- **`management_control_v815.sql` の流し直しが未実施**（v824 の chef 追加ぶん）。
  `create or replace` なので何度流しても壊れない。SQL のみ・製品変更なし
- 管理統括はまだ「整備中」表示中。v844 で Management Dashboard と一緒に外す
- **7月（前月）の検知結果を Moto さんがまだ見ていない**
- 理論消費と実消費の差は未実装（`fv_variance` が Totoya 専用のため）

### ② `_LS_PRUNABLE` が死んでいる（v836 で発見・未着手）

`lsIsPrunable` は関数内の `_REGENERABLE`（`tip_labor_` と `reminded_` だけ）で判定しており、
`_LS_PRUNABLE` はどこからも使われていない。v827/v828 のコメントは現状では事実と違う。
**掃除するときは第4章㉓の地雷リストを見ること。**

### ③ 昨対（2025年データ）

「枠だけ作り判定不可表示」で確定。`MD_KPI.yoy_sales` に `pending: true` が付いており、
設定画面の選択肢にも出さない。入れるなら 同期センター → 期間指定取り込み（`doRangeImport`）で
2025年を引けるか実機確認するところから。

### ④ v807 から持ち越し（未着手）

- Tip入力権限の調査（v792 の診断画面の結果待ち）
- AM の管轄割り当ての実データ確認（v800 の画面）
- LaLa：Chika・Aya のロールが `chef` / `office_crew` になっているか
- `supabase/functions/` が未push、`hyper-worker` が未デプロイ

---

## 4. 教訓

v807 ①〜⑤、v825 ⑥〜⑫、v835 ⑬〜⑱、v836 ⑲〜㉑、v837 ㉒〜㉔、v838 ㉕〜㉖ は有効。追加分：

### ㉗ 「〜を出さない」検証は、自分が書いた方針文にも当たる

`verify_v839` の「ランキングを出さない」が落ちた。原因は製品ではなく検証：
プレースホルダに書いた **「ランキングは作りません（順位ではなく未達の確認表）」**
という方針文そのものが「ランキング」「順位」に一致していた。

**「〜が無いこと」を確かめるときは、見る範囲を実際に出力している部分に絞る。**
画面全体を haystack にすると、説明文・注記・コメントを拾う。
直したあとは判定表示（ヘッダー＋全体判定）だけを見ている。

### ㉖（v838）置換文字列の改行は長さに関係なく `\r\n`

大きいブロックは `crlf()` を通すのに、1〜2行の差し込みでは素の `\n` を書きがち。
v838 で `lone LF = 2` を出して戻してやり直した。

### ㉓（v837）識別子を素の indexOf で探す検証は、コメントに同じ語が出ただけで壊れる

残っている地雷：

| ファイル | 素で探している語 |
|---|---|
| `verify_v775` / `verify_v777` | `OFFICE_OK_PAGES` |
| `verify_v784` | `TORITON_SHIFT_STORES` |
| `verify_v788` | `TOTOYA_STORE_IDS` |
| `verify_v827` / `verify_v828` | `_LS_PRUNABLE` |
| `verify_v764` | `_IDB_MEM` |

落ちたら製品ではなく検証を疑うこと（教訓⑲）。

---

## 5. 重要な設計上の決定（勝手に変えないこと）

- **数字の計算を新しく作らない**（`cumulativeToToday` / `foodCostOf` / `laborCoreForYm` /
  `plComputeStore` / `ecCollect`）。判定層も画面も**呼ぶだけ**
- **同じ判定・同じ式を2か所に書かない**
- **判定不可は 0 ではない。**数値は `null`、理由を必ず持たせる
- **未達ゼロでも判定不可が残っていれば「達成」と言い切らない**
- **達成／未達を色だけで表さない。**文字＋アイコン＋色の3つ
- **ランキングを作らない。**順位ではなく「未達の確認表」
- **動かないタブを黙って置かない**（今日／今週は「準備中」と出す）
- **CSS は加算だけ。640px以下の既存ルールに触らない**
- 権限はアプリ層で判定する＋ RLS でも制限。`mcIsStoreManagerEmp()` が店長の唯一の判定口
- Head Chef は原価・仕入のみ。その分野のときだけ通知先に入る
- 更新は必ず `version` を条件に入れる。宛先は毎回マスターから引く
- **新キーは既存キーに相乗りを優先。ただし相乗り先の既存の書き手を必ず読む**（教訓㉕）
- 同期対象からキーを外しても `merge_probe.js` の `SAMPLE` からは外さない（教訓㉑）

---

## 6. 同梱ファイル（追加・変更ぶん）

| ファイル | 用途 |
|---|---|
| `index.html` / `sw.js` | **v839 本体（GitHub 未 push）** |
| `make_preview.js` | **新設**。`node make_preview.js` → `preview.html`。見た目の確認用 |
| `preview.html` | **新設**。v839 の画面（GM表示・店長表示） |
| `DESIGN_management_dashboard.md` | 仕様16章 → 既存コードの対応表 |
| `verify_v839.js` | **新設**。器と権限と CSS の検証（PASS=82） |
| `index_v839_backup.html` | **新設**。次版の検証が「修正前」として使う |
| `verify_v838.js` / `verify_v837.js` | 必須KPI設定 / 判定層 |
| `HANDOFF_v838.md` 〜 `HANDOFF_v807.md` | それ以前 |

---

## 7. 次のセッションの入り方

1. `TZ=Pacific/Honolulu node run_verify.js` → 第0章の期待値と一致するか
2. GitHub main を md5 で突き合わせる（**引き継ぎの記述を信じない**）
3. `node make_preview.js` で画面を見る
4. **Moto さんのレビュー結果を反映してから** v840 へ進む

**Motoさんの進め方**：「憶測で修正しない」。原因を確かめ、設計 → 確認 → 実装。
分からないことは推測で埋めず聞く。

**v839 は Moto さんのレビュー待ち。**
器の形（2カラムの配置・全体判定の出し方・期間タブ）を先に確定させてから
中身を作らないと、v840〜v845 をまとめて作り直すことになる。
