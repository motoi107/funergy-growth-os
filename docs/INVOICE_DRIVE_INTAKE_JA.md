# invoice の Google Drive 取込（invoice-intake）

仕様合意 2026-10-06（Hawaii）。この文書はコードと合成データでの検証結果の記録で、本番の稼働報告ではない。

**状態：サーバー側（DB・取込ワーカー・確認ルール・QuickBooks 送信台帳）と画面（アプリ v1052・UI案34 を Moto さんが 10/6 に承認）を実装し、合成データで検証済み。本番には未反映・未接続（未完了）。** SQL の適用・Edge Function の配備・cron・店舗フォルダの登録・ON にする操作はどれもまだ。

---

## 1 何をするか

店舗は自店の Google Drive の `00_Upload` に invoice を入れるだけ。サーバーが 5 分ごとに新着を確認し、AI で読み取り、次の条件をすべて満たすものだけ自動で仕入れに反映する。それ以外は理由つきで「要確認」にする。

- 原本は Drive に置いたまま。DB には読み取り結果・明細・価格履歴・照合・原本の ID/名前・変更履歴を持つ。
- 仕入れ処理・経理照合・原本の整理・QuickBooks 転送は別々の状態。「反映済み・未照合」は正常。
- アプリを開いていなくても動く（pg_cron → Edge Function。ブラウザのタイマーや端末の保存は使わない）。

## 2 ファイル

| 場所 | 中身 |
|---|---|
| `db/invoice-intake.sql`（= `supabase/migrations/20261007090000_invoice_intake.sql`） | 表・一意制約・RLS・RPC。service_role 専用。anon/authenticated は表も関数も使えない |
| `db/invoice-intake-schedule.sql` | 5 分ごとの起動（pg_cron + pg_net）。既定では何もしない |
| `supabase/functions/invoice-intake/handler.mjs`・`index.ts` | 取込ワーカーと、本部・経理の操作 API |
| `invoice/decimal.mjs` | 金額は整数セント、単価・数量は 10^-6 の整数（BigInt）。浮動小数点で判定しない |
| `invoice/units.mjs` | g/kg/lb/oz、ml/l/gal/qt/fl oz の明示定義。ケース・袋・本の換算は確認済みの対応表からだけ |
| `invoice/dates.mjs` | ハワイ日付。印字された日付を読み、AI の読みと食い違えば「日付が確定しない」 |
| `invoice/extract.mjs` | AI への依頼と応答の検査。文面はデータとして扱う。数字は印字のまま文字で受け取る |
| `invoice/rules.mjs` | 正規化と確認ルール（理由コード） |
| `invoice/dedupe.mjs` | 内容ハッシュ・invoice 番号の正規化・内容の署名・重複の分類 |
| `invoice/naming.mjs` | `業者名_YYYY-MM-DD_店舗名_INV-番号.ext` |
| `invoice/drive.mjs` | Drive API（一覧・取得・ダウンロード・名前変更/移動・フォルダ）。削除の機能は持たない |
| `tests/invoice-*.test.mjs` | 単体・結合（PGlite＋模擬 Drive/AI/メール）・アダプタ・ミューテーション |
| `index.html`・`sw.js`（v1052） | 画面：経理センター「Invoice取込」（一覧・要確認・照合・取込状況・設定）、店舗の Invoice管理の提出フォルダの案内、食材編集の「仕入れ履歴」。本体は `invIn*` 関数（`/* FUNERGY_INVOICE_INTAKE_BEGIN */` 〜 `END`） |

アプリの変更（v1052）は、上の画面を足したことと、既存の 7 関数に 1 行ずつ（Drive 取込の写しを旧画面で削除・承認・差し戻ししない／Invoice管理に案内／食材編集にボタン／経理センターの件数）と、PC で経理センターの大タブを折り返す CSS 1 行だけ。保存キー・同期・権限・価格の更新は変えていない。

## 3 流れ

1. 有効な店舗の `00_Upload` を一覧（ページング）。ファイルを台帳に記録（Drive file ID が鍵）。
2. 新しいファイル・内容が変わったファイルだけを取得し、SHA-256 を計算。同じ内容の読み取りが既にあれば AI を呼ばない。
3. 読み取り → 正規化 → 確認ルール → 重複判定 → 保存（invoice 単位で一括）。
4. 理由が 1 つもなく、店舗・業者・商品の自動反映がすべて ON、運用開始後のときだけ自動反映。DB 側でも同じ条件をもう一度確かめる。
5. 業者・請求日・店舗に疑いがなければ、原本を `{店舗}/{YYYY}/{MM}/未照合` へ移して改名。日付が決まらない・宛先が違う・複数の書類を含むものは `00_Upload` に残す。
6. 経理が「照合済み」にすると `照合済み` フォルダへ移す。移動の失敗は照合とは別に記録し、やり直す。
7. （設定 ON のとき）反映済みの invoice を既存アプリの `spl_invoices_<店舗>` に写し、今の Food Cost・仕入明細の計算をそのまま使う。
8. 送る担当（`qb.route`）が決まっていて台帳が ON のとき、QuickBooks へ送る原本を台帳に積む。`invoice-intake` なら送信手段（未接続）で送る。`external`（今の担当＝ChatGPT 側の転送）ならこのシステムは送らず、外部の転送が台帳を読み、結果を書き込む（11 節）。

## 4 状態

| 区分 | 値 |
|---|---|
| 仕入れ処理（ファイル） | pending 未処理 / processing 処理中 / review 要確認 / posted 反映済み / error エラー / duplicate 重複 / unsupported 形式不可 / archived 過去分（読まない） |
| 書類 | review / posted / superseded（訂正版に置換）/ duplicate / rejected |
| 経理照合 | unreconciled 未照合 / discrepancy 差異あり（メモ必須）/ reconciled 照合済み |
| 原本の整理 | none / pending / done / error（移動エラー・やり直し）/ Drive 側：missing・trashed・permission_lost・moved_store |
| QuickBooks 転送 | pending 未送信 / sending 送信中 / sent 送信済み / error 送信エラー / unknown 送信結果不明 |

「送信済み」はメールを送ったところまで。QuickBooks への登録・店舗への記帳・銀行照合の完了は表さない。結果不明は自動で送り直さない。

## 5 自動反映の条件と理由コード

自動反映は理由が 0 件のときだけ。AI の自信度は使わない（受け取らない）。

| 区分 | 理由コード |
|---|---|
| 読み取り | unreadable, ai_failed, ai_truncated, multiple_documents, missing_pages, no_lines |
| 書類の種類 | doc_type_unknown, statement（照合用・計上しない）, credit_memo（元 invoice との関連付けが必要）, receipt_route（会社カード・立替は既存の社員別管理） |
| 業者・店舗 | vendor_unknown（マスター名か登録した別名に完全一致のみ）, vendor_kind_unset, store_mismatch（自動で付け替えない）, ship_to_unrecognized, multi_store |
| 日付・番号・通貨 | date_missing, date_unreadable, date_disagree, delivery_date_invalid, invoice_no_missing, currency, closed_month |
| 金額 | total_missing, total_mismatch（明細＋税＋送料＋その他−値引き＝合計。許容差は設定・初期 $0.00）, discount_allocation（値引きの配り方が未設定）, mixed_tax |
| 明細 | line_value_missing, line_math（数量×単価−明細値引き＝金額。印字の丸めの 0.5 セントまで）, zero_price, negative_line, catch_weight |
| 商品 | unmapped（新商品）, map_ambiguous, map_unverified, unit_mismatch, unit_unverified, spec_changed（規格の変更は値上がりと区別）, no_price_ref, price_jump（同じ規格・基準単位で比べる。初期 ±15%） |
| 重複 | duplicate_certain, same_number_different, duplicate_candidate, app_duplicate_candidate |
| 運用 | mode_review_store / vendor / item（確認モード）, intake_not_started |

人が確定するとき：`duplicate_certain`・日付・業者不明・合計なし・明細の値なし・通貨などは直さないと確定できない。`line_math`・`total_mismatch` は理由を書いて明示的に認めたときだけ確定できる。それ以外は理由の記入が必要。AI が合計に合わせて数字を直すことはない（元の invoice_ocr は行合計に合わせて単価を補正していたが、新しい経路はしない）。

## 6 重複と再処理

- 同じ Drive file ID：改名・移動は名前と場所の更新だけ。読み直さない。
- 同じ内容（SHA-256）：別名でアップロードされても「確実な重複」。AI も呼ばない。
- 撮り直し（バイトは違う）：業者・店舗・番号・請求日・合計・明細が同じなら「確実な重複」。番号が同じで内容が違えば「訂正版か別書類」として要確認。
- アプリで登録済みの invoice（番号を持たない）：店舗・業者・伝票日付・合計が一致すれば「候補」として要確認。
- 一意制約：同じ店舗・業者・種類・番号の反映は 1 件だけ／同じ内容ハッシュの反映は 1 件だけ／1 明細の有効な価格行は 1 つ／QuickBooks は内容ハッシュ×宛先で 1 回。リース（同時に 1 ワーカー）と行ロック・版番号で二重処理を防ぐ。
- 原本が消えた・権限がなくなった：エラーとして表示。仕入れデータは消さない。
- 訂正版の反映は「置き換える」と明示したときだけ。元の書類は superseded、価格行は無効化（履歴に残す）、アプリの写しは削除の印（tombstone）。

## 7 価格履歴と「最新」

- 店舗・業者・商品・規格・仕入単位ごと。元 invoice・明細・有効日・換算根拠・状態・作成者・理由を持つ。
- 有効日は納品日（なければ請求日）。アップロード日時は使わない。古い invoice が後から届いても最新は戻らない。
- 同じ有効日の順：請求日 → invoice 番号 → 登録順。
- 価格行を作るのは invoice だけ（credit memo・statement・receipt は作らない）。確認済みの対応表があり、明細に問題がない行だけ。
- 税抜の商品単価（明細の印字）を記録する。税・送料・値引きは別の項目。配り方は未設定なので単価には入れない（値引きがあれば要確認）。
- 反映後の訂正：古い価格行は無効化して残し、訂正後の値で作り直す。照合済みなら未照合に戻し、原本も `未照合` に戻す。締め済みの月は調整の明示がないと変更できない。

## 8 既存アプリとの関係（調査結果を含む）

- 今のアプリ：invoice は app_state `spl_invoices_<店舗>`、原本は Storage `invoices`（PDF 化したもの）、Drive は drive-sync（このリポジトリには無い。本文は Moto さんから受け取った。OAuth は `drive_oauth` 表・Drive 全体の権限）。保存のたびに新マスターの単価を最後の保存で上書き（保存日基準）。旧マスター（レシピ・棚卸の単価のもと）は移行モードで凍結。
- Food Cost＝期首＋当月 invoice（伝票日付・合計）＋買い出し±移動−期末。棚卸の単価＝月の手入力 > 店舗の最新仕入 > マスター、÷入数。確定した棚卸は `inv_hist_` に金額ごと保存。
- 新経路は旧マスター・新マスター・棚卸数・確定値を書き換えない（テスト 13 で確認）。最新単価は新しい価格履歴にだけ持つ。v1052 の食材編集「仕入れ履歴」で見られる（レシピ原価に使うかは未決定・表示だけ）。
- アプリへの写し（mirror）は既定 OFF。写した記録は `src:'drive-intake'`、`driveFileId` は空（旧画面の削除で Drive の原本を消さないため）、`reviewStatus:'Drive取込'`。v1052 で旧画面の経理レビュー（承認・差し戻し）と削除を写しに対して止めた（Invoice取込で扱う）。ON は開始日。締め済み月の invoice は写さない（held）。

## 9 権限と秘密情報

- DB の表・関数はすべて service_role 専用（RLS 有効・anon/authenticated から revoke）。
- 本部・経理：業務Bot と同じ Supabase Auth のメール認証。役割は `manager_auth`（ceo/gm/office/office_crew）。閲覧は 4 役割、修正・確定・照合は ceo/gm/office、設定・過去分・自動反映の ON は ceo/gm。
- 店舗スタッフ：この API は使わない（Drive に入れるだけ）。PIN ログインのままでは、サーバー側で本人と所属店舗を確かめる仕組みが無い。店舗の画面に自店の一覧を出すには、PIN 確認でサーバーが短時間の証明を出す等の最小対応が先に必要。
- ワーカー：`invoice_settings.worker.key`（DB 内・service_role のみ）を cron がヘッダーで送る。定数時間で比較。
- 秘密情報は Edge Function の secrets と service_role 専用の表だけ：`ANTHROPIC_API_KEY`（既存）。Google Drive は、関数の secrets（`GOOGLE_OAUTH_CLIENT_ID`・`GOOGLE_OAUTH_CLIENT_SECRET`・`GOOGLE_OAUTH_REFRESH_TOKEN`）があればそれを、無ければ drive-sync が既に保存している `public.drive_oauth`（id=1）を service_role で読んで使う（`invoice_drive_credentials`。表が無ければ「未接続」）。どちらもブラウザ・公開コード・ログに出さない（エラー文から鍵・トークンの語を伏せる。テストで確認）。
- 外部の転送の鍵（`invoice_settings.qb_external.key`）：DB 内・service_role のみ。画面にもイベントの履歴にも出さない（設定の保存は `enabled` だけ変えられ、返す値からも鍵を外す）。SQL エディタでだけ見る・入れ替える。
- invoice の文面は AI への指示として扱わない。応答は決まった形の値だけを受け取り、未知の項目は捨てる。ファイル名はマスターの業者名・確定した日付・設定の店名からだけ作る。

## 10 Drive のフォルダと共有（推奨・要検証）

- 既存の `Invoices` ルートと店舗フォルダの ID を設定に登録して使う。年・月・未照合・照合済みは「同じ名前が無ければ作る」。同じ名前が 2 つあれば止めて知らせる。
- ワーカーは設定した店舗フォルダの中だけを動かす（外にあるファイルは移さない）。削除・ごみ箱は一切しない。
- 推奨：共有ドライブ「Invoices」。本部・経理とワーカー用アカウントはコンテンツ管理者、店舗スタッフはメンバーにせず、自店の `00_Upload` フォルダだけを共有（投稿者相当）。ルートを店舗に共有しない。
- ワーカー用は専用の Google アカウント（Invoices 以外にアクセスを持たない）を推奨。今の drive-sync の OAuth は Drive 全体の権限。
- 個人の My Drive の場合、店舗がアップロードしたファイルの所有者は店舗側に残り、移動・改名ができないことがある。共有ドライブが使えるか、実アカウントで確認が必要。
- Moto さん（10/6）：Drive 連携は Moto さんの会社の Google アカウント、共有ドライブは使える。店舗フォルダの URL は Aiea・Piikoi・Kaimuki・ToriTon・Tenkichi の 5 店分を受け取った（LaLa は作成待ち）。**フォルダ ID はこの公開リポジトリには書かない**（画面の「設定」で入れる）。今のフォルダが My Drive か共有ドライブか、中に `00_Upload` があるかは、配備後に「フォルダを確かめる」で見る（まだ見ていない）。
- 00_Upload の用意（`folder_setup`）：店舗フォルダの中を名前で探す。1 つなら記録、無ければ GM・CEO が押したときだけ作る、2 つ以上や別のフォルダが記録済みなら止めて知らせる（自動で選ばない・切り替えない）。
- 店舗の Invoice管理の案内：GM・CEO が「出す」にした店舗だけ、店舗マスター（`stores.data.invoiceUploadFolderId`）に 00_Upload の ID を入れる。店舗マスターは anon キーで読める表なので、フォルダ ID は見えるが、開けるかどうかは Drive の共有で決まる。

## 11 QuickBooks

- 要件：2026-09-29（ハワイ日付）以降に保存された全店舗の invoice・receipt 原本を `funergy+expenses@assist.intuit.com` へ、重複なしで送る。宛先は設定で変更できない（転送先であり認証情報ではない）。
- 送る担当（`qb.route`）は 1 つだけ：未決定（既定）/ `invoice-intake` / `external`。`invoice-intake` 以外では台帳に積まない。
- 重複（確実な重複・同じ内容）は送らない。過去分（backfill）は送らない。読取の例外があっても原本の転送は独立。
- 結果不明は自動で送り直さない。送信側の記録で確認できたら送信済み、無ければ人が「再送待ち」に戻す（ceo/gm/office）。
- 送信の手段（メールの送り方）は未接続。Moto さん（10/6）：今の転送は ChatGPT 側が行っている → 初期の運用は `route='external'`（このシステムは送らない）。
- **外部の転送（ChatGPT 側）と台帳を共有する口**（`x-invoice-qb-key` ヘッダーで鍵を送る。`qb_external.enabled=true` のときだけ。人のメール認証では使えない）：
  - `qb_external_list`：送る対象（`route='external'`・未送信か送信エラーで、やり直しの時刻を過ぎたもの）。行ごとに `id`・`attempt_key`（同じ原本×宛先で一意）・`sha256`・`to_address`・Drive の `drive_file_id`・`original_url`・店舗・名前。
  - `qb_external_reserve {id}`：その行を「送信中」にする（1 行を 1 回だけ。2 回目は 409）。
  - `qb_external_result {id, state:'sent'|'error'|'unknown', message_id?, error?, note?}`：予約した自分の行だけ。`pending`（再送待ち）には戻せない（人が確かめて戻す）。15 分たっても結果が無い予約は「結果不明」。
  - 二重送信を防ぐには、外部の転送が **Drive から入った原本はこの台帳を見て送る**（台帳に無いもの・送信済みのものは送らない）ことが前提。今の転送がどこから原本を拾っているかは未確認（16 節）。

## 12 設定（初期値）

| キー | 初期値 | 意味 |
|---|---|---|
| worker.enabled | false | cron から起動しても何もしない |
| mode.intake / auto_post / organize / mirror | false | 取込・自動反映・整理・アプリへの写し |
| mode.start_at | null | 運用開始日時（これ以前は自動反映しない） |
| mode.pilot_stores | [] | 試験する店舗（空＝有効な全店） |
| rules.price_jump_pct | 15 | 単価変動の確認（仮。確認モードの結果で調整） |
| rules.total_tolerance_cents | 0 | 合計の許容差 |
| rules.closed_through | null | 締め済みの月（YYYY-MM） |
| rules.currency_when_absent | null | 通貨の印字が無いとき（null＝要確認） |
| rules.discount_allocation | null | 値引きの配り方（null＝要確認） |
| rules.batch / max_file_mb | 5 / 20 | 1 回に読む件数 / 上限サイズ |
| qb.route / enabled | null / false | 送る担当（null＝未決定・`external`＝今の外部の転送・`invoice-intake`＝このシステム）／台帳に積むか |
| qb_external.enabled | false | 外部の転送が台帳を読み書きする口を開けるか（鍵は SQL でだけ見る） |

店舗：`invoice_stores`（店名ラベル・店舗フォルダ ID・00_Upload ID・宛名と住所の別名・担当・自動反映）。業者：`invoice_vendor_rules`（マスター名・別名・食材/食材以外・自動反映）。商品：`invoice_item_maps`（業者コード or 別名＋規格＋仕入単位 → 食材マスターのコード、入数・基準単位）。`vendor_seed`・`map_seed` は候補を作るだけで、すべて確認モード・未確認から始まる（LaLa の業者コード付き品目を対象）。

## 13 本番に入れる順番（すべて未実施）

1. Moto の確認（10/6 回答済み：転送は ChatGPT 側・Drive は Moto さんの会社のアカウント・共有ドライブ可・店舗フォルダ 5 店分の URL。LaLa は作成待ち）。残り：今の転送が原本をどこから拾うか、各店で Drive に上げる人の Google アカウント、`pg_policies`。
2. SQL を適用（`supabase/migrations/20261007090000_invoice_intake.sql`）。既存の表は変更しない。
3. Edge Function `invoice-intake` を配備（Verify JWT は OFF。関数内で認証する）。Drive は drive-sync の保存済みの連携をそのまま使う（secrets は不要。分けたいときだけ `GOOGLE_OAUTH_*` を入れる）。`ANTHROPIC_API_KEY` は既存。
4. アプリ v1052 を貼る（`index.html`・`sw.js`）。経理センター「Invoice取込」→ メール認証（業務Bot と同じ）。
5. 「設定」で店舗ごとに店舗フォルダの URL を入れる（Aiea・Piikoi・Kaimuki・ToriTon・Tenkichi。LaLa はフォルダができてから）→「フォルダを確かめる（作らない）」→ 00_Upload が無い店は GM・CEO が「この内容で作る・記録する」。店舗のスタッフには 00_Upload だけを共有。「店舗の画面」で「出す」にした店だけ、Invoice管理に提出フォルダが出る。
6. 業者・対応表の候補を作る（マスターから・すべて確認モード・未確認から）。
7. `worker.enabled=true`、cron を登録（`db/invoice-intake-schedule.sql`）。画面の「設定」で取込を ON、試験する店舗を 1 店に、自動反映は OFF のまま確認モードで数日。
8. 結果を見て、業者・商品ごとに自動反映を ON。開始日時を決める。アプリへの写し（Food Cost・仕入明細）は開始日に ON（旧画面で写しを消せないようにしたのは v1052）。
9. QuickBooks：今の転送（ChatGPT 側）が台帳を見るようにできたら `route='external'`・台帳 ON・外部の口 ON。このシステムから送るのは、今の転送を止めて送信手段をつないでから `route='invoice-intake'`。

## 14 切り戻し

- 止める：`mode.intake=false`（または `worker.enabled=false`、`select cron.unschedule('invoice-intake')`）。データは消えない。
- 自動反映だけ止める：`mode.auto_post=false`。整理だけ止める：`mode.organize=false`。写しだけ止める：`mode.mirror=false`。
- QuickBooks：`qb.route` を null に戻す（新しく積まない）・`qb_external.enabled=false`（外部の口を閉じる）。送信履歴は残る。
- 画面：v1051 に戻す（`index.html`・`sw.js`）。サーバーのデータは残る。店舗マスターに入れた提出フォルダ（`invoiceUploadFolderId`）は v1051 では使われないだけ。
- 新しく作った記録は消さない（追跡できるように残す）。Drive の原本は移動・改名だけで、消していない。

## 14b 画面（v1052・UI案34）

| 画面 | 誰が | すること |
|---|---|---|
| 一覧 | 経理・事務Crew・GM・CEO | 店舗・業者・期間・番号・金額・商品名・状態で探す。仕入れ処理・経理照合・原本の整理・QuickBooks 転送を別々の列で表示。原本は Drive のリンク |
| 要確認 | 見る：4 役割／直す・反映：経理・GM・CEO | 原本（Drive のプレビュー）と AI の読み・今の値を並べて直す。直した所だけ送る（数字は文字のまま）。保存するとサーバーが理由を作り直す。反映は理由が必須。数量×単価・合計の不一致は「原本で確かめた」のチェック、締め済みは「経理の調整」のチェックが要る。重複（候補の中から選ぶ）・対象外。Credit memo は元の invoice に紐づけ。新しい商品は対応表をその場で登録 |
| 照合 | 同上 | 反映済み・未照合と差異ありの一覧。差異ありはメモ必須。照合済みで原本は照合済みフォルダへ。スマホは原本／明細の切り替え |
| 取込状況 | 4 役割（やり直し・結果不明の処理は経理・GM・CEO） | 最終の正常取込・未処理・要確認・エラー・Drive 接続、店舗ごとの数、エラーの案内（HEIC・パスワード付き PDF など）、QuickBooks 台帳の件数と結果不明の処理（確かめた内容が必須） |
| 設定 | 見る：4 役割／変える：GM・CEO（業者・対応表の編集と確認は経理も可。自動反映の ON は GM・CEO） | 運用のスイッチ・開始日時・試験する店舗、確認のルール、店舗と Drive のフォルダ、店舗の画面への案内、業者・対応表（候補づくり）、送る担当・台帳・外部の口 |
| 店舗の Invoice管理 | 店舗のスタッフ（案内を出した店だけ） | 提出フォルダを開くボタンと手順（1 件 1 ファイル・名前はそのまま・撮り直しは追加・HEIC は互換性優先）。会社カード・立替は今までどおり。Drive が使えないときはアプリから |
| 食材編集の仕入れ履歴 | 4 役割 | 最新単価（納品日→請求日→番号の順）・履歴（原本とページ）・その食材を使うレシピの原価を最新単価で計算した場合（表示だけ。レシピ原価・棚卸・締めた月は書き換えない） |

## 15 検証（2026-10-07 HST・合成データ・本番データ不使用）

| コマンド | 結果 |
|---|---|
| `node --test tests/invoice-rules.test.mjs` | 11/11 |
| `node --test tests/invoice-intake.test.mjs` | 22/22（§14 の 1〜14 ＋訂正版・訂正後の再照合・初期候補・文面の指示＋外部の転送の台帳・00_Upload の用意・仕入れ履歴・設定と問題の一覧・Drive の連携の読み方） |
| `node --test tests/invoice-adapters.test.mjs` | 4/4（Drive・Anthropic・PostgREST・HTTP 入口） |
| `node --test tests/invoice-mutations.test.mjs` | 22/22（守りを 21 か所外すと、どれもテストが落ちることを確認。外部の転送の鍵・自分の行だけ・ここから送らない・鍵を画面に出さない・00_Upload を勝手に作らない／切り替えない を含む） |
| `deno check supabase/functions/invoice-intake/index.ts`・`deno test` | 成功（Edge Runtime と同じ Deno 2 で 18 件） |
| `python3 scripts/check-static-release.py` | 成功（v1052・APP_VERSION と SW_BUILD が一致） |
| アプリの検証（handoff の `verify_v1052.js`） | 78/78（変えた既存関数は 7 本で各 1 行・同期と保存の仕組みは同じ・escapeHtml・金額は整数セント・役割・旧画面の境目） |
| 本物の画面（handoff の `render/check_invin_v1052.py`） | 49/49・pageerror 0。本物の handler と SQL を PGlite で動かし、ブラウザから メール認証→一覧→要確認（反映・業者を直す・対象外）→照合（原本が照合済みフォルダへ）→取込状況（HEIC・結果不明）→設定（スイッチ・00_Upload の作成・店舗の画面への案内）→店舗の Invoice管理（日英）→仕入れ履歴→スマホ（390px）。事務Crew は閲覧だけ |

既存の他のテスト（bot-center 2・bot-database 2・cooking-sake 4・ingredient-transfers 1・meeting-budget 14・meeting-sales 4）の失敗は、変更前の main でも同じ件数（今回の変更とは無関係）。

## 16 未完了・未確認

- 本番 DB・Edge Function・cron・アプリ v1052：どれも未反映。
- Google Drive：受け取った 5 店の店舗フォルダが My Drive か共有ドライブか、中に 00_Upload があるか、店舗のアカウントでの権限分離は未確認（配備後に「フォルダを確かめる」で見る）。LaLa のフォルダは作成待ち。drive-sync の保存済みの連携（Drive 全体の権限）をそのまま使う前提。
- drive-sync：Moto さんにもらった本文から、①anon キーだけで任意の Drive ファイルを移動・完全削除できる、②設定済みの連携を anon キーで上書きできる、③`push` が `subfolder` を使わない（チェック・建て替えも未登録のフォルダに入る）、を確認した。直した版（Funergy のフォルダ内だけ・削除はごみ箱・上書きは GM/CEO の認証）は、作業中に本文が手元から失われたため未作成。もう一度ファイルでもらってから作る。
- QuickBooks：今の転送は ChatGPT 側（10/6）。その転送が原本をどこから拾っているか（Drive のどのフォルダか、メールか）は未確認。台帳を見ずに Drive から拾っていると二重に送るおそれがあるので、`route='external'` と外部の口を ON にする前に合わせる必要がある。このシステムの送信手段は未接続。
- AI：実際の invoice での読み取り精度は未確認（模擬で検証）。HEIC は読めない（形式エラーとして案内）。
- アプリへの写し（Food Cost・仕入明細）：既定 OFF。旧画面で写しを削除・承認・差し戻しできないようにした（v1052）。ON にするのは開始日。
- 店舗スタッフのアプリ内一覧：PIN 認証のままでは安全に出せない（9 の最小対応が先）。v1052 の店舗向けは提出フォルダの案内だけ。
- 締め：アプリに「締めた月」の確定値は無い（チェックリストと棚卸確定のみ）。`rules.closed_through` を経理が設定する運用が必要。
- レシピ原価・棚卸に取込の最新単価を使うか：未決定（仕入れ履歴に「最新単価で計算した場合」を表示するだけ）。

## 17 店舗向け・経理向けの説明（案）と実装の一致

店舗向け（UI案34-6）：
1. 1 件の invoice は 1 つのファイル（複数ページは 1 つの PDF）→ 複数の書類が 1 ファイルなら要確認（実装どおり）。
2. ファイル名はそのままで OK → 改名は本部側（実装どおり）。
3. 撮り直したら同じフォルダにもう一度・前のファイルは消さない → 同じ内容は確実な重複として計上しない。前の不鮮明な写真は「読めない」として要確認に残るので、経理が対象外にする（実装どおり）。
4. 会社カード・立替のレシートは今までどおりアプリから → このフォルダに入ると receipt_route で要確認（実装どおり）。
5. 追記が必要：iPhone の HEIC 写真は読めない。「カメラ → フォーマット → 互換性優先」にするか、ファイルアプリの「書類をスキャン」で PDF にする。

経理向け（UI案34-1〜5）：照合済みにすると原本が照合済みフォルダへ移る／Drive で手で移しても照合済みにはならない／照合は支払・銀行照合・QuickBooks の記帳とは別／「送信済み」は記帳完了ではない／結果不明は送信側で確認してから操作する → いずれも実装どおり。
