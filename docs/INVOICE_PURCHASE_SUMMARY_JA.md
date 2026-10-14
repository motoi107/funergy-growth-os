# 確認済み invoice の全店仕入れ集計・原価との連携（UI案48・調査と決定）

依頼：Moto さん 10/14 03:58 HST に添付した依頼書「Funergy+：確認済みinvoiceの全店仕入れ集計・原価画面連携」（ChatGPT が作った Claude 向けの実装依頼）。全店を最初から対象、経理確認済み＋QuickBooks 送信済みの invoice を店舗・業者・月で集計し、未反映の額と理由を見せ、棚卸・原価と連携する。

状態（10/14）：**調査・決定・UI案48 まで。コードの変更なし。** 実装は Moto さんの UI案48 の回答と、本番の状況（`db/invoice-purchase-status-check.sql` の結果）を聞いてから。

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

## 5. 決めてほしいこと（UI案48 と一緒に Moto さんへ）

1. 紐づけ A か B か。
2. 請求明細との照合（「この月の分はそろった」）は、業者ごとに記録する形でよいか。
3. 本番の状況：`db/invoice-purchase-status-check.sql`（読むだけ）の結果。とくに QuickBooks の台帳が使われているか（使われていなければ A は 0 で、全部 B になる）。

## 6. 実装の見込み（決まったあと）

- サーバー：集計の関数（全件を SQL で数える・ページの上限で欠けない）と、`app_state` への書き出し（worker の回ごと＋照合・反映・訂正・送信の結果のあと）。業者ごとの「そろった」の記録。書き出しの日時を持たせ、古いと画面に出す。
- アプリ：予実管理「仕入れ」タブ・業者・invoice の画面（日英・スマホ）、原価率への紐づけ（A か B）。
- 試験：依頼書 8 の 12 項目と計算の例（確認済み 1,100・対象外 200・純額 1,300・未転送 500・確認待ち 400・仕入率 11.0%・原価 1,350・13.5%）を合成データで。本番には書かない。
