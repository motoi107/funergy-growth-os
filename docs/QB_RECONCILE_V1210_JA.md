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
- 照合を取り消すと、まだ始まっていない送信（pending・error）は止まる（`last_error = 'recon_cancelled'`）。台帳にまだ無い invoice は、照合し直すまで台帳に積まない。送っている途中（sending）・結果確認待ち（unknown）は「止めて」の印（`stop_requested_at`）を付け、送る直前の確かめで送らずに止める。もう送っていたら送信済みとして残す（事実の記録・取下げや訂正は QuickBooks の今までの手順で）。照合し直すと、また予定に入る（8 を見る）。
- 「照合済みだが未転送」（B-3-4）：理由が分かるもの（設定・名前を変える待ち・止めたもの など）と、記録が無く分からないもの（前の外部の転送で送ったかもしれない）を分けて出す。**一覧を開くだけでは何も送らない**。記録が無いことだけで「未送信」と決めない。過去の照合済みを一括で送り直す道は作っていない。
- 消さない：invoice・明細・単価・照合の記録・前の台帳の行は消さない・書き換えない（止めた行は state を cancelled にするだけ）。

## 2. サーバー（`supabase/migrations/20261216090000_invoice_qb_reconcile.sql`）

前提：`20261103090000_invoice_price_compare.sql` まで入っていること（無ければ何も変えずに止まる）。

- 置き換える関数 8：`invoice_qb_enqueue`・`invoice_qb_candidates`・`invoice_qb_send_context`・`invoice_qb_content_changed`・`invoice_qb_manual`・`invoice_reconcile`・`invoice_qb_result`・`invoice_qb_release`。
- 新しい関数 6：`invoice_qb_merges_of`（複数枚の invoice のページの順・見る invoice だけ・9）・`invoice_qb_merges`（同じものを全部）・`invoice_qb_ready`（今の条件で送れるか）・`invoice_qb_doc_states`（invoice ごとの 6 つの状態・200 件まで）・`invoice_qb_retry`（送り直し・送っていないことが確かなものだけ）・`invoice_qb_unsent`（照合済みだが未転送・読むだけ・照合の古い順に 200 件ずつ・9）。
- 台帳の索引 3：`invoice_qb_outbox_file`・`invoice_qb_outbox_sha`・`invoice_qb_outbox_parts`（9）。
- 台帳に列 `parts`（複数枚の invoice のページの原本 ID の並び）と `stop_requested_at`（照合を取り消したときに送っている途中だった行・8）。
- `invoice_reconcile` は `file_id`・`file_ids`（そのページの原本すべて）・`qb_stopped`・`qb_busy`・`qb_stop_requested`・`qb_kept_out` を返す。`stop_qb`（照合済み以外にするとき）で、まだ始まっていない行を止める。
- どの関数も security invoker・`search_path` 固定・service_role だけ（公開の鍵では読めない・呼べない）。確認の SQL `db/invoice-intake-postcheck.sql` は functions 126・`qb_reconcile` true。

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

- `tests/invoice-qb-reconcile.test.mjs`（14）：事務Crew・経理・GM の照合で送り始める／まとめて照合／複数枚の invoice を 1 つの PDF・1 通（ページの順）／二重に押しても 1 通／結果が分からないものを送り直さない／照合の取り消しで止まり、照合し直すと送る／送っていないことが確かなものだけ送り直せる／照合済みだが未転送の理由とページ分け（9）／前に単独で送ったページ・中身が変わったページで止まる／送っている途中・結果確認待ち・台帳に無いときの照合の取り消し（8）／送ったあとに 4 枚目が足された invoice（9）／入れる一式（SQL と確認の SQL は repository の写し・1 ファイルの関数は今のソースのまとめ・読み込むのは pdf-lib だけ・手順の順）。
- `tests/invoice-qb-reconcile-ui.test.mjs`（13）：画面のモジュールを VM で（選ぶ箱・まとめての結果の 6 つの数・一部の失敗・状態・送り直しの出し分け・未転送の一覧と「古い順に N 件だけ」の文・止まった行の記録の道）。
- わざと壊す：`tests/invoice-mutations.test.mjs` の B-3 の守り（サーバーと画面）。8 と 9 で足した 21 通り（止める印 6・画面 5・重さの直し 10）はすべて落ちる。
- 関数の 1 ファイル（esbuild）を handler の代わりに入れて、reconcile・qb-gmail・intake の試験。
- invoice の試験（mutations 以外）・`python3 scripts/check-static-release.py` pass/1210。

## 6. 入れる順と戻し方

`deploy/invoice-qb-reconcile-v1210/手順.md`：SQL → 確認の SQL（functions 126・qb_reconcile true）→ 関数（1 ファイル）→ アプリ v1210 → ふだんの照合の 1 件で確かめる。試しの invoice を作って本番の QuickBooks に送らない。戻すときは関数を `deploy/invoice-price-compare-v1123/3_関数_invoice-intake_index.ts` に（そのあいだ複数枚の invoice の行は送らずに止まる）。

## 7. 未確認・限界

- 本物の Gmail・QuickBooks・本番の Supabase・実機（iPhone）では確かめていない。
- 「転送成功」は Gmail が受け取ったことだけ。QuickBooks 側の取り込み・登録は見ていない（前から）。
- 前の外部の転送（ChatGPT 側）が送ったかは、台帳に記録が無ければ分からない（「記録が無く分からない」と出す）。
- まとめての照合は 1 件ずつ送るので、件数が多いと時間がかかる（送る時間は測っていない。状態と一覧の重さは 9）。

## 8. 独立レビュー（Claude の別エージェント・作業を見ていない）の直し（2026-11-23）

指摘：P2 2・P3 いくつか。

- **P2-1：送っている途中・結果確認待ちで照合を取り消しても、そのまま送られた**（取り消しのあと、送る直前の確かめを通ってから送っていた・照合し直さなくても 1 通）。依頼の「照合を取り消した場合、未実行の転送は停止できるようにする」に合わない。
  - 直し（SQL だけ・関数のコードは変えない）：照合の取り消しで、送っている途中・結果確認待ちの行に「止めて」の印 `stop_requested_at` を付ける。送る直前の確かめ（`invoice_qb_send_context`）は印があれば `recon_cancelled` を返し、送らない。その結果（`invoice_qb_result` の error）と手放し（`invoice_qb_release`）で、印のある行は `cancelled`（`recon_cancelled`）になる。回数は使わない。結果確認待ちの行は、人が「送っていない」と確かめたら（`pending`）送らずに止める。もう送っていた行（`sent`）は送信済みのまま（事実の記録）。
  - 台帳にまだ行が無い invoice（名前を変える待ち・台帳 OFF など）は、取り消しのときに止めた行（`cancelled`・`recon_cancelled`）を入れて、照合し直すまで台帳に積まない（`invoice_qb_candidates` の今の決まり）。
  - 照合し直すと印を外し、止めた行は今までどおりまた予定に入る。「送り直す」（`invoice_qb_retry`）・予定に入れる（`invoice_qb_enqueue`）も印を外す。
  - 画面：取り消しの知らせは「もう送る途中です。まだ送っていなければ止めます。送り終わっていたら送信済みとして残ります（取下げ・訂正は QuickBooks で）」と、台帳に積まなかった件数。1 件の画面の状態の行にも印の説明。
  - 試験（`tests/invoice-qb-reconcile.test.mjs`・新しく 3）：送る直前の確かめのあいだに取り消す → 送らない・回数 0・照合し直すと 1 通／送り終わる直前に取り消す → 送信済みのまま／結果確認待ちで取り消す → 人が「送っていない」と確かめると止まる／Gmail の接続が切れた行を手放す → 止まる／台帳 OFF・差異あり・前の経路（external）。
- **P2-2：複数枚の invoice で、ページの中身が変わった行・5 回で止まった行に、「QuickBooks に入れた」で記録する道が出なかった**。
  - 直し（画面だけ）：`part_changed` と、5 回失敗して止まった行にも「QuickBooks に入れた」（`invoice_qb_manual`・前からの記録の道）を出す。止まった行は「自動ではもう送りません。原本を確かめて QuickBooks に手で入れたら記録してください」。`part_changed` の言葉も「要確認で新しい中身を確かめるか、手で入れたら記録」に。
- P3（記録だけ・直していない）：
  - まとめての結果の「転送成功」に、手で入れたと記録した行も入る。
  - 「照合済みだが未転送」で、台帳に無い・台帳 OFF の行を「原因が分かっている」に入れている。
  - `invoice_qb_merges`・`invoice_qb_ready` は件数が多いと遅くなるかもしれない（速さは測っていない）。→ 9 で直した。
  - id・日付の形が違うと 400 ではなく 500。
  - 写真（JPEG）の向き（EXIF）は見ていない（そのまま PDF に入れる）。
  - 送っているあいだに照合すると、1 回分の試行を使うことがある。
  - pdf-lib はいつも読み込む（複数枚の invoice が無くても）。
- わざと壊す：止める印の 6 通り（取り消しで印を付けない・送る直前の確かめが印を見ない・結果・手放しで止めない・台帳に無い invoice を止めない・照合し直しても印が残る）と画面の 5 通りを `tests/invoice-mutations.test.mjs` に足した。

## 9. ルーティンのレビュー（11/23）の重さの直し

指摘：`invoice_qb_doc_states`・`invoice_qb_unsent` が、invoice 1 件ごとに全部の invoice の合わせ方（`invoice_qb_merges`）と台帳を読む（件数 × 全件）。合成 3,000 件で約 25 秒／49 秒。

- 直し（SQL）：
  - `invoice_qb_merges_of(heads)`：見る invoice（その最初の原本）だけの合わせ方を求める。`invoice_qb_ready`・`invoice_qb_doc_states`・`invoice_qb_send_context`・`invoice_reconcile` はこれを使う。`invoice_qb_merges()` は全部（`merges_of(null)`・前と同じ答え）。台帳に積む候補（`invoice_qb_candidates`）は全部の invoice を見るので `invoice_qb_merges()` のまま（1 回だけ求める）。
  - 台帳を見るのはどれも索引 1 回（内容の sha256・原本・複数枚の PDF のページ）。索引 3 つ（`invoice_qb_outbox_file`・`_sha`・`_parts`＝GIN）。
  - `invoice_qb_unsent`：照合の古い順に `limit` 件（初め 200・1〜500）。答えに `count`（全部の数）・`more`・`limit`。重い確かめ（`invoice_qb_ready` と履歴）はそのページの行だけ。
- 直し（関数）：`qb_unsent` が `limit` を渡す。1 ファイルの関数を作り直した。
- 直し（画面）：未転送の一覧で、全部を出していないときは「照合の古い順に N 件だけ出しています（全部で M 件）」。
- 速さ（合成データ・PGlite・1 回ずつ・この作業の環境（2 CPU・Node 22））：原本 3,000（複数枚の invoice 50）・台帳 2,486 行・照合済み 300。
  - 直す前（`ffa9193`）：`doc_states`（200 件）62,190 ms／`unsent` 86,656 ms／`unsent`（500 件）57,812 ms／`candidates` 2,079 ms／`merges()` 224 ms。
  - 直したあと：`doc_states`（200 件）1,110 ms／`unsent` 1,177 ms／`unsent`（500 件）918 ms／`candidates` 186 ms／`merges()` 116 ms／`merges_of`（1 件）12 ms。
  - 合成データの台帳に複数枚の PDF（`parts`）の行は入れていない。本番の件数・実機の時間は測っていない。
- 試験：`tests/invoice-qb-reconcile.test.mjs` の複数枚の試験で、1 件の合わせ方はその invoice だけ・ページは最初の原本ではない・全部は前の `invoice_qb_merges()` と同じ。未転送の一覧のページ分け（古い順・`count`・`more`・おかしな `limit` は 200）。送ったあとに 4 枚目が足された invoice（前の PDF の中のページは送らない・名前の変更待ち・結果確認待ちの PDF のページ・手での記録は 4 枚目だけ・状態は送信済み・未転送の一覧に出ない）。
- わざと壊す（10 通り・すべて落ちる）：上限なし・`more` を言わない・別の順・PDF の中で送ったページを未転送の一覧が見ない／合わせ方が見ない（送信済み・送っている途中）／名前の変更待ちで止めない／状態が見ない／1 件の合わせ方が全部を見る／画面が「N 件だけ」を言わない。
- 確認の SQL：functions 126・`qb_reconcile` true（新しい関数と索引も見る）。戻す SQL（`db/invoice-intake-rollback.sql`）に `invoice_qb_merges_of` を足した。

## 10. #217 の Codex の再レビュー（`0db4bff` まで・7134071689）の直し（Claude（Team・Claude Code）・11/24）

- #216 の P2 の直し（`37f6e32`・上限の失敗は サーバーが数えた太平洋時間の日で消す）を取り込んだ（`claude/google-places-1209` をマージ）。
- P3（Codex）：前の経路（external＝ChatGPT 側の転送）が予約して送っている途中の行は、送る前にこちらの確かめ（`invoice_qb_send_context`）を通らないので、止めの印（`stop_requested_at`）では止まらない。なのに照合取消の知らせ・1 件の状態の行が「まだ送っていなければ止めます」と言っていた。
- 直し：
  - SQL `invoice_reconcile`（migration・`db/invoice-intake.sql`・deploy の 1 の 3 つ）：印はこれまでどおり付ける（前の転送が失敗を返したら送り直さずに止める）。数は分ける：`qb_stop_requested`＝止まる行（このシステムの送信・人が確かめる結果確認待ち。前の経路の結果確認待ちも人が「送っていない」と確かめると止まる）、`qb_stop_external`＝前の経路が送っている途中の行。記録（`qb_cancelled`）に `external_sending`。
  - 画面：知らせは「N 件は前の転送（ChatGPT）が送っている途中です。ここからは止められません。送られたら送信済みとして残ります（取下げ・訂正は QuickBooks で）。送れなかったときは送り直しません」。1 件の状態の行も前の転送のときはそう言う。`qb_stop_requested` が無い前の SQL のときだけ `qb_busy` を使う（前と同じ）。
  - 手順.md の説明に前の転送のことを足した。関数（handler）は変えていない（3 の 1 ファイルも同じ）。
- 試験：`invoice-qb-reconcile` 14（前の経路の行：`qb_stop_requested` 0・`qb_stop_external` 1・印は付く・状態は external の sending・記録の数／前の経路の結果確認待ち：`qb_stop_requested` 1・人が「送っていない」と確かめると止まる）・`invoice-qb-reconcile-ui` 13（状態の行・知らせ 3 通り）。わざと壊す 3 つを足した（SQL が前の経路の行を止まる数に入れる・画面が数を分けない・状態の行が分けない）。
- 実機・本物の Gmail・前の転送（ChatGPT）・本番のデータでは確かめていない。Codex の再レビューはまだ。
