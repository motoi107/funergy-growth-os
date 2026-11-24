# 照合済みの invoice を QuickBooks へ（B-3・v1210）

Moto さん 2026-11-23 の依頼（統合実装プロンプトの B-3）。作業：Claude（ブランチ `claude/acct-payroll-1210`）。入れる一式は `deploy/invoice-qb-reconcile-v1210/`。

## 1. 依頼と決めたこと

- 事務Crew・経理リーダー・経理マネージャー（manager_auth の `office_crew`・`office`）と GM・CEO が、照合待ちの invoice を **1 件でもまとめてでも「照合済み」** にしたら、今までと同じ条件で QuickBooks への転送の予定に入れる。GM は今までどおり。
- 権限はサーバーが manager_auth で決める（画面から送られた役割の名前では決めない）。照合の関数 `invoice_reconcile` が役割と版を確かめる（前から）。
- 送る条件は今までと同じ（反映済み・名前を変え終わった・送り始め `qb.since` より後・送る担当・台帳 ON）。この条件を変えたり、旧経路（外部の転送・route external）の決まりを外したりはしない。ChatGPT 側の定期タスクも変えない。
- 複数枚で 1 つの invoice（UI案50 の 5）は 1 つの invoice として送る：ページの順に **1 つの PDF・1 通**・台帳は 1 行（`invoice_qb_outbox.parts`）。旧経路では今までどおり台帳に出さない。
- 二重送信をしない（2 回押す・送り直し・5 分ごとの取込が重なっても）。送る前に Gmail の送信済みを探し、原本の中身（sha256）を確かめる（前から）。
- 状態は 6 つ：**未転送／転送待ち／処理中／転送成功／転送失敗／結果確認待ち**。「転送成功」は Gmail が受け取ったという意味（QuickBooks に登録されたかは見ていない）。
- 送り直しは、送っていないことが確かなもの・失敗したものだけ（`invoice_qb_retry`）。結果が分からないもの（時間切れなど）は「結果確認待ち」で、自動では送り直さない（前から）。
- 照合を取り消すと、まだ始まっていない送信（pending・error）は止まる（`last_error = 'recon_cancelled'`）。照合し直すと、また予定に入る。始まっている送信・結果確認待ちは止めない。
- 「照合済みだが未転送」（B-3-4）：理由が分かるもの（設定・名前を変える待ち・止めたもの など）と、記録が無く分からないもの（前の外部の転送で送ったかもしれない）を分けて出す。**一覧を開くだけでは何も送らない**。記録が無いことだけで「未送信」と決めない。過去の照合済みを一括で送り直す道は作っていない。
- 消さない：invoice・明細・単価・照合の記録・前の台帳の行は消さない・書き換えない（止めた行は state を cancelled にするだけ）。

## 2. サーバー（`supabase/migrations/20261216090000_invoice_qb_reconcile.sql`）

前提：`20261103090000_invoice_price_compare.sql` まで入っていること（無ければ何も変えずに止まる）。

- 置き換える関数 6：`invoice_qb_enqueue`・`invoice_qb_candidates`・`invoice_qb_send_context`・`invoice_qb_content_changed`・`invoice_qb_manual`・`invoice_reconcile`。
- 新しい関数 5：`invoice_qb_merges`（複数枚の invoice のページの順）・`invoice_qb_ready`（今の条件で送れるか）・`invoice_qb_doc_states`（invoice ごとの 6 つの状態・200 件まで）・`invoice_qb_retry`（送り直し・送っていないことが確かなものだけ）・`invoice_qb_unsent`（照合済みだが未転送・読むだけ）。
- 台帳に列 `parts`（複数枚の invoice のページの原本 ID の並び）。
- `invoice_reconcile` は `file_id`・`file_ids`（そのページの原本すべて）・`qb_stopped`・`qb_busy` を返す。`stop_qb`（照合済み以外にするとき）で、まだ始まっていない行を止める。
- どの関数も security invoker・`search_path` 固定・service_role だけ（公開の鍵では読めない・呼べない）。確認の SQL `db/invoice-intake-postcheck.sql` は functions 125・`qb_reconcile` true。

## 3. 関数 invoice-intake（`handler.mjs`・`invoice/pdfjoin.mjs`・`index.ts`）

- `reconcile`：保存できたら、送る担当が「このシステム」（invoice-intake）のとき `qbAfterPost(files, ctx, 'reconcile')` で送り始める（答えは待たせない・`waitUntil`）。名前を変える設定のときは名前を作り直す（同じなら Drive は変えない）。
- 複数枚の invoice：ページの原本をすべて Drive から読み、それぞれの sha256 を確かめてから pdf-lib（`npm:pdf-lib@1.17.1`）で 1 つの PDF にする（`invoice/pdfjoin.mjs`）。前に単独で送ったページがあれば PDF にせず `part_already_sent` で止める（人が手で記録）。ページの並びが変わったら `merge_changed`、中身が変わったら `content_changed` で止める。
- 新しい頼み：`qb_doc_states`（6 つの状態）・`qb_retry`（送り直し）・`qb_unsent`（照合済みだが未転送）。どれも SQL が役割を確かめる。
- 旧経路（external）：照合で台帳に載るだけ（今まで通り）。外部の口（`qb_external_*`）の決まりは変えていない。

## 4. 画面（アプリ v1210）

- 照合待ちを表に：照合済みにしてよい行（反映済み・未照合）を選ぶ箱・選んだ件数と合計・「選んだ N 件を照合済みにする」。差異ありの行は選べない（1 件ずつ開く）。
- まとめての照合は 1 件ずつ、開いたときの版でサーバーの `reconcile` に送る（版が変わった行は保存しない）。結果は **選択件数／保存成功／転送待ち／転送成功／転送失敗／結果確認待ち** と、保存できなかった行（理由つき）。一部だけ失敗しても、成功した行はそのまま。
- 一覧・照合の一覧・1 件の画面に 6 つの状態（サーバーが台帳から決める）。読めないときは前のチップ。
- 1 件の画面：反映（経理の確認）と QuickBooks への転送を分けて出す・理由・「送り直す」（送っていないことが確かなもの・失敗したものだけ）。
- 取込状況：「照合済みだが未転送」のカード（理由が分かるもの／記録が無く分からないものを分けて・開くだけでは送らない）。
- 編集できる人（`invInCanEdit`）は経理・事務Crew・GM・CEO。事務Crew に GM の役割を付けてはいない。GM 専用の画面・ボーナス・給与の権限は足していない。

## 5. 試験（合成データ・本物の DB・Google・QuickBooks にはつながない）

- `tests/invoice-qb-reconcile.test.mjs`（10）：事務Crew・経理・GM の照合で送り始める／まとめて照合／複数枚の invoice を 1 つの PDF・1 通（ページの順）／二重に押しても 1 通／結果が分からないものを送り直さない／照合の取り消しで止まり、照合し直すと送る／送っていないことが確かなものだけ送り直せる／照合済みだが未転送の理由／前に単独で送ったページ・中身が変わったページで止まる／入れる一式（SQL と確認の SQL は repository の写し・1 ファイルの関数は今のソースのまとめ・読み込むのは pdf-lib だけ・手順の順）。
- `tests/invoice-qb-reconcile-ui.test.mjs`：画面のモジュールを VM で（選ぶ箱・まとめての結果の 6 つの数・一部の失敗・状態・送り直しの出し分け・未転送の一覧）。
- わざと壊す：`tests/invoice-mutations.test.mjs` の B-3 の画面の守り 14 通りすべてで落ちる。
- 関数の 1 ファイル（esbuild）を handler の代わりに入れて、reconcile・qb-gmail・intake の試験 136/136。
- invoice の試験（mutations 以外）355/355・`python3 scripts/check-static-release.py` pass/1210。

## 6. 入れる順と戻し方

`deploy/invoice-qb-reconcile-v1210/手順.md`：SQL → 確認の SQL（functions 125・qb_reconcile true）→ 関数（1 ファイル）→ アプリ v1210 → ふだんの照合の 1 件で確かめる。試しの invoice を作って本番の QuickBooks に送らない。戻すときは関数を `deploy/invoice-price-compare-v1123/3_関数_invoice-intake_index.ts` に（そのあいだ複数枚の invoice の行は送らずに止まる）。

## 7. 未確認・限界

- 本物の Gmail・QuickBooks・本番の Supabase・実機（iPhone）では確かめていない。
- 「転送成功」は Gmail が受け取ったことだけ。QuickBooks 側の取り込み・登録は見ていない（前から）。
- 前の外部の転送（ChatGPT 側）が送ったかは、台帳に記録が無ければ分からない（「記録が無く分からない」と出す）。
- まとめての照合は 1 件ずつ送るので、件数が多いと時間がかかる（速さは測っていない）。
