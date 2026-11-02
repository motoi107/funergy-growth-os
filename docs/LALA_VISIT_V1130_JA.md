# LaLa のメニュー出数・リピート率の復旧（アプリ v1130・hyper-worker v1130・Claude・ブランチ `claude/lala-visit-fix`）

## 1. 依頼

- Moto さん 11/02 10:41 HST の添付「Funergy+ LaLaのメニュー出数・リピート率の最優先復旧／ワークセンター全体のアップデート」の「0」。
  - 原因の特定・修正・データの復旧・実画面の確かめを済ませてから、①〜⑩（経費申請・ワークセンター・スキルマトリクス・評価変更申請）へ進む。
  - リピート率＝（RP＋SR）÷（FT＋RP＋SR）。期間で足してから割る。分母 0 は「対象データなし」。未同期・取得失敗を 0% にしない。
  - FT・RP・SR はメニューの出数・ランキングから外し、リピート率には使う。
- 画面は UI案67（Design・Moto さんの非公開の canvas・10/31〜11/01 に作った・数字は合成データ）のとおりにした。

## 2. 原因（本番を読むだけの SQL `db/lala-visit-diag.sql`・11/02 10:5x HST の結果）

数はリポジトリに書かない（Moto さんに直接）。

- **FT・RP・SR が 0**：hyper-worker は、Toast のメニューのグループ名がちょうど「Customers」のときだけ、その中の FT・RP・SR の商品を数えていた（`getCustomerCountItemGuids`）。LaLa の Toast のグループ名は「**Customer Property**」（レシピのカテゴリーに 3 品）なので見つからず、売上はあるのに FT・RP・SR が毎日 0 で保存されていた。
  - 4 つの状態のうち「未取得」（取り込みの段で来店区分が見つかっていない）。保存・集計・画面の不具合ではない。
- **式の確かめ（ToriTon・Tenkichi・直近 30 日）**：Customers の商品の出数と toast_sales を比べた。
  - FT の商品の数＝`first_time_count`（Tenkichi は丼のモディファイヤー由来の数を足すと一致）。
  - RP の商品＋SR の商品＝`repeat_count`。`super_regular_count`＝SR。
  - → アプリの率 `repeat_count ÷（first_time_count＋repeat_count）` は（RP＋SR）÷（FT＋RP＋SR）と同じ。数えるのは商品の数量。
- **メニューの表**：11/02 に LaLa のメニュー（toast_menu_items）が取り込まれた（Moto さんの操作・20 カテゴリー）。出数の行（toast_item_sales）も 10/20 から売上のある日はそろっている（11/02 に取り込み直し）。
- **もう 1 つの原因（運用・2 つ目の SQL `db/lala-visit-diag-2.sql`・11/02 11:18 HST の結果）**：LaLa の Toast には Customer Property の FT・RP・SR の商品があり、注文で押された日もある。ただし
  - 押されたのは 9/26〜10/21 の一部の日・一部の注文だけ（1 日の客数に比べてずっと少ない）。SR は一度も押されていない。
  - 10/22 から 11/01 まで、一度も押されていない（売上・客数はある）。
  - ToriTon・Tenkichi は 8/1 から毎日押されている。Tenkichi の Customers のグループには「Customer Type (Required)」という商品もある（押し忘れを防ぐ設定かもしれない・未確認）。
  - → hyper-worker を直して取り込み直しても、LaLa のリピート率が出るのは押された日の押された分だけ。10/22 からは「対象データなし」のまま（正しい表示）。押された日と押されていない日がまざる月は、タイルに「来店区分 0 の日 N 日」と出て、目標の達成・未達は出さない（UI案67 のまま）。
  - 毎日のリピート率を出すには、LaLa でも注文ごとに FT・RP・SR を押す運用が要る（Moto さんの判断）。

## 3. 直したもの

### 3.1 hyper-worker v1130（非公開の 1 ファイル・Moto さんに直接渡した・リポジトリに置かない）

- 来店区分のグループ＝名前が「customer」で始まるもの（`isCustGroupName`：Customers・Customer Property・Customer Type など。大文字小文字・前後の空白は見ない）。前は「customers」ちょうどだけ。
- 商品の名前の見分け（`custCountClass`）に日本語（初回・新規／リピ／常連）を足した。前の決まり（FT・RP・SR・first・repeat・super）はそのまま。
- 来店区分の診断も同じ決まり。見つけたグループと、商品ごとの見分け（ft・rp・sr・none）を返す。
- 変えていない：売上・客数・丼・Tip・出数・メニューの表・認可（v1061・v1085）・保存の形。ToriTon・Tenkichi は前の版と同じ商品を数える（非公開の試験：前の版と新しい版を同じメニューで比べた）。
- 基にしたのは Moto さんが 11/02 に添付した今のソース（v1085 の見出し）。

### 3.2 アプリ v1130（index.html・sw.js）

- `FUNERGY_VT`（本体の最後）：リピート率の数と取り込みの状態をどの画面でも同じ決まりで。
  - 日ごと：来店区分あり／取り込めたが区分 0（売上はあるのに FT・RP・SR が 0）／店休・売上 0／売上の行なし（未取込）。今日と先の日は状態に数えない。
  - 期間：ふつう／一部の日が未取込（途中の数字）／対象データなし（判定しない）／未取込（最後の読み込みの失敗も出す）。本当の 0%（FT があり RP・SR が 0）は 0% のまま判定する。
  - 数は `repeatStats` と同じ（試験で比べる）。FSP・WGS は前から手入力なので数えない。
- 画面：
  - ダッシュボード・予実の「KPI 目標との差」のリピート率のタイル（前はデータが無いと消えていた）。押すと内訳。
  - 内訳（UI案67 ①）：率と式・FT・RP・SR・合計・営業日ごとの状態・ランチ／ディナー・サーバーの行（toast_sales）と端末の数の日ごとの照合・最後に取り込めた時刻（ハワイ）・日ごとの表・「この期間を読み直す」（今までの `syncStoreActualsFromToast`）・GM・CEO・経理は「Toast から取り込み直す」（期間一括取り込み）。
  - 会議：率が出ないときは理由と内訳への入口。目標が無くても行を出す。
  - 同期センター：「店ごとの来店区分（FT/RP/SR）と出数の取り込み」（UI案67 ④・GM・CEO・経理・読むだけ）。数え方・FT・RP・SR・合計・率・売上の行・区分のある日・出数の行のある日・最後の取り込み。合計は足してから割る。
  - メニュー：出数の最後の日と取り込んだ時刻。来店区分のグループは customer で始まる名前（hyper-worker v1130 と同じ・`isVisitTypeCategory`）。
- 何も書かない画面（内訳・比べ）は GET だけ。「この期間を読み直す」は今までの取り込みと同じ保存（v1101 の保護を通る）。
- 読むだけの SQL：`db/lala-visit-diag.sql`・`db/lala-visit-diag-2.sql`。`db/menu-names-check.sql` の来店区分も同じ決まりに。

## 4. 試験（合成データ・本番に接続していない）

- `tests/repeat-vt-v1130.test.mjs` 12（repeatStats と同じ数・LaLa の今の形は対象データなし・本当の 0%・未取込と店休と今日・未取込の全期間と最後の失敗・複数店は足してから割る・FSP を数えない・サーバーの行との照合・同期センターの比べ・権限・画面のつなぎ・会議の行・Customer Property）。
- `tests/lala-visit-diag-sql.test.mjs` 1・`tests/lala-visit-diag2-sql.test.mjs` 1（PGlite）。
- 新しい決まりに合わせた：`tests/menu-visit-exclude.test.mjs`（Customer Type・Customer Property も来店区分）・`tests/menu-ui65.test.mjs`（文）。
- 関連：menu-ui65 21・menu-visit-exclude 2・menu-names-sql 1・repeat-rate-v1129 4・store-switch-v1129 6・ux-core 35・financial-web 86・fetch-status 13・mid-review-ui 45。next-v1090 の 1 件・meeting-sales の 4 件は main（`0b7200d`）でも落ちる（前から）。
- static release pass/1130。
- hyper-worker（非公開の試験・リポジトリに置かない）：前の版と新しい版を同じメニューで比べる（ToriTon・Tenkichi は同じ・LaLa の Customer Property は前 0 → 今 FT・RP・SR・下の階層・大文字・日本語・見分けられない商品は数えない・SR は repeat_count にも入る）。esbuild で全体を通した。
- Chromium（模擬サーバー・合成データ・1280／390px・日英・GM）：44 項目のうち 42（落ちた 2 つは会議の行＝目標の無い店で行が出ない → 直した）。ほかに見つけた 3 つ（未取込の日の 4 日目以降・英語のコロン・比べの表の言葉）も直した。直したあとはブラウザで流していない。

## 5. 入れる順・過去の分

1. Moto さん：hyper-worker を v1130 の 1 ファイルに差し替え（SQL 不要）。
2. 来店区分の診断（LaLa）を、押された日（例 10/21）で：「Customersグループ検出」に Customer Property、「注文で照合したFT_RP_SR」に数が入るか。押されていない日（10/22 から）は 0 が正しい。
3. 済（11/02）：`db/lala-visit-diag-2.sql` で、注文で押されているかを見た（2 の運用の原因）。
4. 期間一括取り込み（LaLa・開店日 9/19〜昨日）。同じ日の行を上書きする（restaurant_guid と business_date で upsert・二重にならない）。ほかの店は触らない。
5. `db/lala-visit-after-check.sql`（読むだけ）で、注文の商品と保存した数を 1 日ずつ照らし合わせる（一致／違う／保存の行なし／来店区分なし／休み・月と全期間のリピート率は足してから割る）。
6. アプリ v1130 をマージ → 端末を 1130 に → 内訳（サーバーの行と端末の数の日ごとの照合）と同期センターの比べで、5 と画面の数が同じか。

## 5b. 取り込み直したあとの照合（`db/lala-visit-after-check.sql`・11/02 13:07 HST の結果・数はリポジトリに書かない）

- 済（Moto さん）：4（9/1〜11/02 の期間一括取り込み・10/30〜11/02 の取り込み直し）と 5。
- 10 月：来店区分のある日はすべて「一致」（注文の商品の FT・RP・SR と、保存した数が同じ）。ただし押されたのは一部の日の一部の注文だけで、押された数は来店した人数のごく一部。率は代表値ではない（画面は「来店区分 0 の日 N 日」を出し、目標の判定をしない）。
- 9/22〜9/25（4 日）：保存した FT があるのに、注文の商品には来店区分が無い（「違う」）。9/26 からは一致。
  - 照合の SQL は商品の行（toast_item_sales）しか見ない。hyper-worker はモディファイヤーで押された来店区分も数えるので、その時期はモディファイヤーで押されていた可能性が高い（未確認）。
  - 確かめ方：同期センターの「来店区分の診断」（LaLa・9/23）の「モディファイア由来」。
  - 確かめるまで、この 4 日は取り込み直さない。
- 11/01：来店区分なし（「対象データなし」）。
- 取込の時刻の列：toast_sales の fetched_at は、最初にその日の行を作った時刻のまま（hyper-worker の売上の保存が fetched_at を入れない。コードで確かめた）。アプリの「最後に取り込めた時刻」は、端末がサーバーの行を読めた時刻（端末の記録）なので、この影響は受けない。DB の列も新しくするなら、次に hyper-worker を直すとき売上の保存に fetched_at を足す。

## 6. まだ

- 本番の照合の残り：5 の 6（v1130 をマージして画面と照合）・9/22〜9/25 の確かめ（5b）・実機（iPhone）。
- LaLa の運用（注文ごとに FT・RP・SR を押すか・Toast で押し忘れを防ぐ設定にするか）：Moto さんの判断。
- ランチ・ディナー別の来店区分：toast_sales に列が無い（hyper-worker の見出しの SQL で足せる・Moto さんの判断）。
- 独立レビュー・Codex のレビュー。
