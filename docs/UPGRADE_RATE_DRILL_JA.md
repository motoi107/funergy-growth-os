# Totoya のアップグレード率：カードから内訳へ（依頼 11/14・調べた結果と案）

依頼：Moto さん 11/14 の添付「アップグレード率の根拠を確認できる内訳」。画面を伴うので先に UI 案（UI案81・Design・Moto さんの非公開の canvas）。コードの変更はまだ無い（読むだけの SQL と試験だけ）。

## 1. 今の数え方（index.html を読んで確かめた）

| 項目 | 今 |
|---|---|
| 出る所 | 予実 › 日次進捗 ›「KPI 目標との差・前週比」（`budKpiCard`）。選んだ店がすべて Totoya（`isTotoyaStore`）で、率があるときだけ。押すと `openKpiDetail` の小さな内訳（`misoSub`：数・出所・日ごとの数） |
| 計算 | `keyKpiStats` → `totoyaScopeRates`（店ごとに `totoyaKpiCalc` を足す）。率＝分子 ÷ 分母（小数 1 桁） |
| 分子 | `toast_sales.miso_upgrade_count`（アプリでは日ごとの `misoUpgrade`）。Toast の取り込み（hyper-worker・非公開）が丼のモディファイヤーの名前で数える：crab・today・udon（味噌汁）と chazuke（v1154 から） |
| 分母 | `toast_sales.miso_total_count`（`misoTotal`）。上の 4 つ ＋ aosa（通常の味噌汁）。客数・会計数・丼の数ではない |
| 出どころの順 | KPI 設定の手入力（`tMisoAll`・`tMisoUp`）＞ Toast の日ごとの数 ＞ メニューの出数（`getTotoyaKpiCfg` の ID・キーワード） |
| 期間 | 選んだ月のその店の全部の日（`dSum` は月の日を全部足す）。今日の途中の数も入る。ほかの KPI は昨日まで |
| 複数の店 | 分子・分母をそれぞれ足して割る。目標は店ごとの目標の単純平均 |
| 目標 | `getStoreKpiTargets(店, offset, 月).misoUpgradeRate`（KPI 設定・月ごと・前の月から引き継ぐ） |
| 前週比 | このタイルには無い（バッジは空）。ほかの KPI は `wowStats`：直近 7 日（ハワイの昨日まで）とその前の 7 日・片方が無い日は両方から外す |
| 今の内訳の言葉 | `misoSub` が分子を「味噌汁を付けた数」、分母を「対象の丼数」と出す。実際は分子＝アップグレード・分母＝味噌汁と茶漬けの数（言葉の誤り） |

## 2. 元データ

- 日ごとの分母・分子：`toast_sales` にある。
- 丼 × モディファイヤーの日ごとの数（商品名・ID）：`toast_item_modifier_sales`（v961）。10/17 の時点では Marujuu だけに行があった。Totoya にあるかは `db/totoya-upgrade-check.sql`（読むだけ）で確かめる。
- 注文番号・時刻・取消：どこにも保存していない。依頼の「その日の注文・伝票番号」を出すには、取り込み（hyper-worker）に注文ごとの行を保存する表を足す（お客様の情報は保存しない・同じ注文は 1 行）。前の日は取り込み直すと入る。
- 取消・返金・Void の扱いと名前の当て方（部分一致か）：hyper-worker の中にあり、アプリからは見えない。最新の hyper-worker のソース（非公開）で確かめる。

## 3. 作る順番（案）

1. Moto さんが `db/totoya-upgrade-check.sql` を流す（表は Claude との会話にだけ）。
2. hyper-worker：注文ごとの行の表（SQL）と保存（非公開の 1 ファイル）。
3. アプリ：タイルに「内訳を見る」と前週比（今の `wowStats` と同じ決まり）・内訳の画面（UI案81）・`misoSub` の言葉の直し。数え方は変えない。
4. 実データで照合（依頼の 7 項目）。

## 4. 決めてほしいこと

- UI案81 の形でよいか。
- 期間に今日の途中の数を入れるか（推奨：昨日までにそろえる。KPI の決まりの変更なので Moto さんが決める）。
- 最新の hyper-worker のソースの添付（非公開）。
