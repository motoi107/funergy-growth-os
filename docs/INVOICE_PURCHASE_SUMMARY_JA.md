# 確認済み invoice の全店仕入れ集計・原価との連携（UI案48・アプリ v1077）

依頼：Moto さん 10/14 03:58 HST に添付した依頼書「Funergy+：確認済みinvoiceの全店仕入れ集計・原価画面連携」（ChatGPT が作った Claude 向けの実装依頼）。全店を最初から対象、経理確認済み＋QuickBooks 送信済みの invoice を店舗・業者・月で集計し、未反映の額と理由を見せ、棚卸・原価と連携する。

状態（10/14）：**実装と試験まで（ブランチ `claude/invoice-purchase-summary`）。本番には入れていない。** 入れ方は `deploy/invoice-purchase-v1077/手順.md`。実装したもの・試験・限界は 7〜10。1〜6 は実装の前の調査と決定（そのまま残す）。

## 1. 今の作り（調査・main `35dc7d1` 時点）

### サーバー（`db/invoice-intake.sql`・`supabase/functions/invoice-intake/handler.mjs`・`invoice/*.mjs`）
- invoice の 1 件は `invoice_docs.id`（uuid）。`version` は版の数え（楽観ロック）で、業務の改訂番号ではない。訂正は同じ行を `invoice_edit` で直す（`overrides` と `edited` の記録）か、別の書類で置き換える（旧は `superseded`・新は `relation='correction_of'`）。同じ Drive ファイルの中身が変わると `original_replaced` で必ず人の確認。
- 状態：`review` / `posted` / `superseded` / `duplicate` / `rejected`。反映済みは取り消せない（置き換えだけ）。`posting_kind` は invoice と credit_memo が `purchase`、statement などは `none`。
- 反映：人は `posted_mode='manual'`・`posted_by`・`posted_at`、自動は `posted_by='auto'`・`posted_mode='auto'`。反映のあとに訂正しても posted_* は変わらない。
- **経理の照合**：`invoice_reconcile`（ceo・gm・office・office_crew）。`recon_status`（unreconciled / discrepancy / reconciled）・`recon_by`・`recon_at`・`recon_note`。反映済みで日付・金額・明細の単価などを直すと `unreconciled` に戻る（`money_fields`・`touched_price`）。
- **QuickBooks の台帳** `invoice_qb_outbox`：ファイルの中身（`sha256`）と宛先ごと。`state` は pending / sending / sent / error / unknown（cancelled は使っていない）。送信成功は `state='sent'`・`sent_at`。書類ごとではなくファイルごと（1 ファイル 1 書類なら同じ）。訂正（`invoice_edit`）では中身が変わらないので送り直さない。
- 明細：`invoice_lines`（qty・unit・`amount_cents`・`line_discount_cents`・`ingredient_code`＝商品の対応表で確かめた商品コード）。**明細ごとの費用区分は無い**。書類には業者の区分 `food_kind`（food / nonfood）だけ。
- 見出しの金額：`subtotal_cents`・`discount_cents`（絶対値）・`tax_cents`・`shipping_cents`・`other_cents`・`other_charges`・`total_cents`。値引きの按分は未実装（`rules.discount_allocation` は空）。
- 店舗は置かれたフォルダで 1 つに決まる。**複数店舗への配賦は無い**（`multi_store` の印だけ）。
- 日付：`invoice_date`（印字が無ければ納品日）・`delivery_date`・`effective_date`（納品日が先）。締め（`rules.closed_through`）とアプリへの写しの `docDate` は `invoice_date`。
- クレジット：`doc_type='credit_memo'`。人の反映には元の invoice への紐づけ（`relation='credit_for'`）が要る。金額の符号は印字のまま（正で印字されたら正で入る）。
- 重複：sha が同じ・業者と番号が同じ・番号が無ければ業者・店舗・日付・金額。アプリの記録と同じ店・業者・`docDate`・金額なら `app_duplicate_candidate`（印だけ）。
- 権限：invoice のサーバーを読めるのは ceo・gm・office・office_crew（メールのログイン）だけ。全店が見える。
- 集計の関数は無い。`invoice_list` の `sum_cents` は全状態・クレジット込みの合計（一覧は 200 件ずつ）。

### アプリ（`index.html` v1076）
- Drive の invoice は、反映された時点で（照合・QuickBooks の前に）アプリの `spl_invoices_<店舗>` に写される（`src:'drive-intake'`・`docType:'Invoice'`・`total` は税・送料込み・明細の区分なし・用途は業者の区分で「仕入れ・仕込み」か「食材以外」）。写しは `mode.mirror` が ON・開始日時のあと・締め済みでない月だけ。
- **原価の計算は `foodCostOf`（L32892）1 か所**：仕入れ＝`monthInvoiceCostYm`（invoice を用途で絞り、`docDate` の月、Receipt を除く、複数店舗は等分）＋`monthPurchaseCostYm`（買い出し＝レシート `purchases_`）＋`monthTransferNetYm`（食材移動 入−出）。期末棚卸（`fc_monthly.endInv`）があれば 期首＋仕入れ−期末、無ければ仕入れだけ（暫定）。
- **予実管理の原価率**（日次進捗の KPI タイル `keyKpiStats` L31754）＝ `foodCostOf` の invoice＋買い出し＋食材移動 ÷ 売上（棚卸なし）。タップすると `fcBreakdownSub`（L19900・用途で絞らない合計）と業者別。`cumulativeToToday` の `costToToday` はスキャン日・用途で絞らない別の数え方（会議・管理コンソール）。
- 用途の設定 `fc_cost_purposes` は同期されない（端末ごと）。
- 棚卸：`inv_hist_<店舗>` に月ごとの確定（`grand`・`perClass`＝food / liquor / beverage / supply）。確定すると `fc_monthly.endInv = grand`（消耗品も入る）。月の途中の棚卸は別に持たない。
- 食材移動 `ingredient_transfers`：記録時の金額 `amount`。
- 締め：アプリには月を止める仕組みは無い（`isFrozenMonth` は表示だけ）。止まるのはサーバーの `closed_through`（写しを止める）。
- 区分：商品マスターの区分（`CLASSES`＝food / liquor / beverage / supply）。酒は免許の無い店では食材（v1014・`storeCostClass`）。

### 二重計上の危険（依頼書の最重要項目）
- 確認済みの集計を今の仕入れに**足すと二重**になる（Drive の invoice はもう写しで入っている）。
- Drive 以前・Drive 外の店のアプリ登録の invoice と、Drive の invoice の重なりは、サーバーの `app_duplicate_candidate`（印だけ）でしか分からない。
- 今の原価は invoice を業者の区分で丸ごと数える（食材の業者の invoice の消耗品も原価に入る）。棚卸の `grand` は消耗品も含む。

## 2. Moto さんの決定（10/14 04:0x HST・選択肢で回答）

1. **経理確認＝照合済み**（`recon_status='reconciled'`）。自動反映でも照合済みなら確認済み。直して未照合に戻ったら確認待ち。
2. **商品に対応していない明細は業者の区分で仮分類**（食材の業者→食材、食材以外の業者→原価対象外）。仮分類の額は別に見せる。
3. **税・送料・値引きは明細の金額の割合で按分**（食材だけの invoice は今と同じく全額が原価）。
4. **見られる人はアプリを使う人みんな・メール認証は要らない**（原文「だれでも見れるようにしてください　認証とかいらないです　数字は予実管理の原価と紐づけてください」）。
   - 作り：サーバーが店舗・月ごとの集計を共通データ（`app_state`）に書き、アプリは読むだけ。今の invoice の写しと同じ置き場所なので、アプリの URL と中身が分かる人なら読める点も同じ（毎回の注意事項：anon キーが画面にある）。
   - アプリの中では今の店舗の見える範囲（`getVisibleStores`）で絞る。サーバーへの書き込み（照合・訂正・締め）は今までどおりメールのログインと役職で守る。

## 3. 状態の分け方（依頼書 2 の A〜E をサーバーの項目に当てる）

| 区分 | 条件 |
|---|---|
| A 集計対象 | `posted`・`posting_kind='purchase'`・`recon_status='reconciled'`・同じ file と sha の `invoice_qb_outbox.state='sent'`・保留の理由なし |
| B 確認済み・未転送 | A の条件で QuickBooks だけ未送信（pending / sending / error / unknown / 台帳に無い）。内訳を出す |
| C 確認待ち | `review`、または `posted` で `unreconciled` / `discrepancy` |
| D 除外 | `rejected` / `duplicate` / `superseded`（履歴で見られる） |
| E 集計保留 | `multi_store`（配賦が無い）・`invoice_date` が無い・`total_cents` が無い（金額未確定）・通貨が USD でない |

- 金額が無いものは 0 と数えず「金額未確定」。1 件は 1 つの区分にだけ数える（理由が重なっても二重に足さない）。
- 計上月は `invoice_date`（今の原価・締め・写しと同じ。印字が無ければ納品日）。月の判定はハワイ時間。
- クレジットは原価からマイナス（印字が正でも `-abs`）。

## 4. UI案48（Design・Moto さんの非公開の canvas・架空の店と業者・数字は依頼書の例）

- 予実管理に「仕入れ」タブ（PC 全店／スマホ 1 店）：確認済み仕入れ（原価対象・原本の純額・対象外・仮分類）、未転送・確認待ち・保留の件数と額、仕入率（棚卸未反映）、原価（棚卸反映後：期首＋仕入れ＋移動入−移動出−期末・暫定の理由）、店舗別、業者別（請求明細と照合して「そろった」を記録）。
- 業者 → invoice 一覧（状態・保留の理由）→ 明細（区分・按分・照合と送信の日時・原本）。
- **予実管理の原価率との紐づけ 2 案**：A 原価率の数字は今のまま、内訳に「確認済み・未転送・未照合」を出す／B 原価率を確認済み（原価対象）＋買い出し＋食材移動で出す（会議・ダッシュボード・成長カルテの原価も変わる）。

## 5. 決めてほしいこと（UI案48 と一緒に Moto さんへ）→ 回答（10/14）

1. 紐づけ A か B か → **B**（「① B」）。予実管理の原価率を確認済みで出す。会議・ダッシュボード・PL・成長カルテの原価も同じ `foodCostOf` なので変わる。
2. 請求明細との照合を業者ごとに → **はい**（「②はい」）。店舗・業者・月ごとに記録する。
3. 本番の状況（`db/invoice-purchase-status-check.sql` の結果）：QuickBooks の台帳は 10/13 7:00 HST から動いている。それより前に Drive に入った原本は台帳に載っていない。
   → **照合済みなら確認済みに入れる**（選択肢で回答）。画面には「台帳の前の原本（送信の記録なし）」と出す。
4. いつから原価率を切り替えるか → **2026 年 10 月から**（選択肢で回答）。経理の照合が進むまで 10 月の原価率は低く出る。9 月以前は今までのまま。

## 6. 実装の見込み（決まる前に書いたもの）

- サーバー：集計の関数（全件を SQL で数える・ページの上限で欠けない）と、`app_state` への書き出し（worker の回ごと＋照合・反映・訂正・送信の結果のあと）。業者ごとの「そろった」の記録。書き出しの日時を持たせ、古いと画面に出す。
- アプリ：予実管理「仕入れ」タブ・業者・invoice の画面（日英・スマホ）、原価率への紐づけ（A か B）。
- 試験：依頼書 8 の 12 項目と計算の例（確認済み 1,100・対象外 200・純額 1,300・未転送 500・確認待ち 400・仕入率 11.0%・原価 1,350・13.5%）を合成データで。本番には書かない。

## 7. 実装したもの（v1077）

### サーバー（migration `20261019090000_invoice_purchase_summary.sql`・`db/invoice-intake.sql` は全体の写し）
- 表 2 つ：`invoice_purchase_checks`（請求明細との照合の記録・店舗・業者・月・`complete` / `missing` / `none`・メモ・請求明細の合計・だれ・いつ。消さずに足していく）、`invoice_purchase_published`（月ごとの書き出した中身・hash・締めて書いたか・書いた時刻・確かめた時刻）。どちらも service_role だけ（RLS・anon / authenticated は読めない）。
- 関数 4 つ（service_role だけ）：
  - `invoice_purchase_classes(text[])`：商品コード → 区分。商品の `cls` → カテゴリー（`categories` の表、無ければアプリと同じ既定：20000〜24000 お酒・30000 / 31000 飲料・40000 消耗品・ほかは食材。6100〜6300 は 6000、14000 は 11000 にまとめる）。
  - `invoice_purchase_month(ym, cls)`：1 か月分を全件 SQL で数える（一覧のページの上限で欠けない）。
  - `invoice_purchase_publish(p)`：`app_state` に書き出す（下）。
  - `invoice_purchase_check(p)`：照合の記録（ceo・gm・office・office_crew・締め済みの月は不可・`missing` はメモが要る・未来の月は不可）。
- 関数 `invoice-intake`：5 分ごとの動き（取込 OFF でも）と、人の操作（反映・訂正・付け替え・対象外・関連・照合・QuickBooks の結果・業者・店舗・設定）と外部の転送の「送った」のあとに書き出す。人の操作のあとは、触った invoice の月だけ（業者・店舗・設定は全部の月）。書き出しに失敗しても操作は取り消さない。

### A〜E の決め方（1 件は 1 つにだけ数える）

| 区分 | 条件（上から順に） |
|---|---|
| D 除外 | `rejected`・`duplicate`・`superseded` |
| E 集計保留（写し） | アプリの写しが消された（`deleted_in_app`）・写しを作らない設定（`mode.mirror` OFF で写しが無い：`no_copy`）・取込の開始より前に入った（`before_start`）→ アプリでの登録で数える |
| C 確認待ち | `review`（反映待ち） |
| E 集計保留 | 複数店舗（`multi_store`）・USD でない・締め済みの月の調整・未分類の額がある・金額が無い |
| C 確認待ち | 照合済みでない（`unreconciled` / `discrepancy`） |
| A 確認済み | QuickBooks の台帳（`qb.to` の宛先）に `sent` がある、または台帳の前に Drive に入った原本（`qb.since` より前） |
| B 確認済み・未転送 | それ以外（順番待ち・送信中・失敗・不明・台帳に無い） |

- 月：`invoice_date`（無ければ `effective_date`、それも無ければ取込の日）。ハワイ時間。
- 按分：明細の金額（正の明細があれば正の明細だけ）の割合で、合計 − 明細の合計（税・送料・値引き・その他）を整数のセントで分ける（切り捨てのあと端数の大きい順・同じなら行の順）。明細に乗らない額は業者の区分。
- 区分：商品の対応がある明細は商品の区分、無ければ業者の区分（仮分類・額を別に出す）、業者の区分も無ければ未分類（E）。原価対象＝食材・お酒・飲料。
- クレジット：`credit_memo` はマイナス（印字が正でも）。

### 書き出し（`app_state`・アプリは読むだけ）
- `invoice_purchase_<月>`：店舗ごとの A〜E の件数・額・原価対象・対象外・仮分類・理由別、区分別、クレジット、台帳の前、アプリと同じかも、業者ごと（照合の記録とそのあとに増えた件数）、invoice ごと（番号・業者・日付・状態・理由・照合・送信・反映・関連・原本）。
- `invoice_purchase_lines_<月>_<店舗>`：明細（区分・按分後の額）。開いたときだけ読む。その月に invoice が無くなった店は空の行にする（古い明細を残さない）。
- `invoice_purchase_status`：月の一覧（書いた時刻 `at`・確かめた時刻・締めたか）。止めたときは `off:true`。
- 中身が変わった月だけ書く（hash）。締め済みの月は、締めたときに 1 回書き直して（`closed:true`）そのあとは変えない（締めを戻すとまた書く・`force` で書き直せる）。外から書き換えられた・消された行は、5 分ごとに書いた中身で書き戻す（版 `generated_at` は変えない）。
- 止める：`db/invoice-purchase-stop.sql`（`purchase.off`）。再開は `db/invoice-purchase-start.sql`。

### アプリ（index.html・sw.js v1077）
- 予実管理 ›「仕入れ」タブ：見える店だけ（`getVisibleStores`。本部の人には、その月に invoice がある閉店した店も）。確認済み（原価対象・純額・対象外・仮分類・クレジット・台帳の前）・未転送・確認待ち・保留・仕入率（棚卸未反映）・原価（棚卸反映後・暫定の理由）・店舗別・業者別・アプリで登録した invoice。業者 → invoice → 明細と原本。請求明細との照合の記録（経理・事務Crew・GM・CEO・Invoice取込と同じメール認証）。日英・スマホ。
- `foodCostOf`：2026 年 10 月から、集計の一覧に載っている月・Drive の取込の店では invoice＝確認済み（原価対象）＋アプリで登録した invoice（Drive の写しを除く）。Drive の写しは足さない（二重にしない）。日別の原価（`_invDayCostMap`）も同じ（写しを除き、確認済みを請求日に）。予実管理の KPI の内訳（`fcBreakdownSub`）に確認済み・アプリ・買い出し・移動と、まだ入っていない額・今までの数え方の額。10 月からは取込の外の店も原価率と同じ数え方。
- 今までの数え方のまま：9 月以前・集計の一覧に載っていない月・Drive の取込の外の店・止めたとき。
- 読み方：ログインのまとめ取りには集計を入れない（行が多いため）。一覧を 10 分ごとに読み直し、月の集計は端末の版が一覧の版と違うときだけ取る。成長カルテの査定の確定の前にも読み直す。集計の中身は形を確かめて読む（店の鍵・理由・区分。`__proto__` などで動きを変えられない）。文字は escapeHtml。

## 8. 試験（合成データ・本番に接続していない）
- `tests/invoice-purchase-summary.test.mjs`（本物の SQL を PGlite で・本物の handler）：依頼書の計算の例、按分、A〜E の各理由、月・台帳の前・開始の前・写しを作らない設定・別の宛先への送信、名前の変更・送り直し・訂正・対象外・重複・クレジット、230 件、ランダムな 160 件を独立に書いた規則と比べる、区分、書き出し（締め・締めたあと・締めを戻す・書き戻し・空の行・触った月だけ・止める）、照合の記録の権限、人の操作・外部の転送・worker、照合の表、入れる一式。
- `tests/invoice-purchase-ui.test.mjs`（本物の SQL の書き出しを本物のアプリのコードで VM に）：依頼書の例（仕入率 11.0%・原価 $1,350・13.5%・暫定）、二重にしないこと・今までの数え方に戻る場合、日別の原価、タブ・業者・明細・すべての文字の escape、照合の記録、古い集計の注意、一覧に無い月、締め、`__proto__`、版の確かめ、描き直し、英語に日本語の句読点が無い、ログインのまとめ取り、成長カルテの読み直し。
- わざと壊す試験（`tests/invoice-mutations.test.mjs` の `purchases:`・`app:`）。この試験は入れる一式の確かめ（ソースの hash）を外して、動きだけで気づくかを見る。

## 9. 限界・気をつけること
- 集計は `app_state` にある（Moto さん「だれでも見れるように・認証とかいらない」）。アプリの鍵を知っている人は読めるし、技術的には書き換えもできる（書き換えは 5 分以内に書き戻す）。業者名・invoice 番号・照合した人の名前・照合のメモが入る。
- 棚卸（期首・期末）は今までどおり店の棚卸の金額（消耗品も入る）。仕入れは消耗品を除いた額なので、消耗品の在庫が増減した月は、その分が原価に出る（**Moto さんに確認：棚卸から消耗品を外すか、このままか**）。
- 10 月の原価率は、経理が照合し QuickBooks へ送るまで低く出る（未転送・確認待ち・保留は「まだ入っていない」に出す）。
- 「送った」はメールを送ったところまで（QuickBooks の記帳の完了ではない）。
- 複数店舗の 1 枚・USD 以外・未分類は保留（配賦・換算・分類を決めるまで原価に入らない）。
- 取込の開始より前に入った原本・写しが消されたもの・写しを作らない設定のものは保留にして、アプリでの登録で数える（二重にしない）。アプリで登録した invoice と Drive の invoice が同じかもしれないもの（`app_duplicate_candidate`）は件数と額を出す（自動では外さない）。

## 10. 照合の報告
- `db/invoice-purchase-report.sql`（読むだけ）：店舗・月ごとに、集計（A〜E・クレジット・台帳の前）と、アプリの invoice（Drive の写し・アプリでの登録）・期末棚卸を並べ、今までの数え方と新しい数え方の差を出す。名前・明細・鍵は出さない。本番で流した結果で報告を作る。
