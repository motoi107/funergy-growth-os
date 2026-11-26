# App Store 審査の準備（プライバシーポリシー・サポート・審査用デモアカウント）

依頼：Moto さん「App Store 審査に必要な次の 3 点」と、その答え（10 項目・iPhone 側の確認先・外部サービスと保存・決める 5 項目・追加の 2 点）。iPhone 版 Funergy+（App Store Connect の app 6831074913・Bundle ID `com.funergygroup.funergyplus.preview`）を、スタッフ向けの非掲載配布（Unlisted）で審査に出すため。

守ったこと：ログイン・保存の処理、Supabase の設定、CORS、JWT の確かめは変えていない。アカウントは作っていない。本番の DB に書いていない。鍵・PIN・パスワード・本物の人の情報は書いていない。対応日数は書いていない。施行日の日付は作っていない（公開した日。ページの印をマージの直前にハワイ時間の日付へ置き換える）。保存期間は、Moto さんが決めた業務・雇用・給与・税・会計の 5 年だけ書いた。

## 0. 印の読み方

| 印 | 意味 |
|---|---|
| 【コード】 | このリポジトリのコード・SQL で確かめた（本番に入っているかは別） |
| 【確認済み】 | Moto さんの確認、または公開の情報で確かめた |
| 【案】 | 会社が決める案（まだ決まっていない） |
| 【要確認】 | まだ確かめていない |

ページの中の印：<mark>[要確認: …]</mark>（黄）＝事実を確かめる・<mark>[案: …]</mark>（青）＝会社が決める文。**どちらも消してからマージ**（マージ＝公開）。

## 1. 作ったもの（PR 3 つ・どれもドラフト・マージと公開は Moto さん）

| ブランチ | 中身 | 版 | 順 |
|---|---|---|---|
| `claude/appstore-review-pages` | 4 ページ（`/privacy/`・`/privacy/ja/`・`/support/`・`/support/ja/`）・この文書・試験 `tests/appstore-pages.test.mjs` | アプリは変えない | 1 |
| `claude/sw-static-nav` | ④ Service Worker が静的ページをアプリの控えにしない（7 の節） | 1217 | 2 |
| `claude/app-privacy-link` | ③ アプリの中のリンク（ログインの画面の下・マイページの下・6 の節）。`claude/sw-static-nav` の上 | 1218 | 3 |

- 版：1216 は `claude/grade-unify-a23`（本番で確かめてからマージ）が使う。1217・1218 が先にマージされたら、a23 は 1219 以上に上げ直す（ぶつかるのは `APP_VERSION`・`SW_BUILD` の行だけ）。
- 3 つの PR の CI の段は別の場所に足したので、互いにぶつからない。

### 1-1. ページ

- ログインせずに全文を読める静的ページ（スクリプト・フォーム・ほかのサイトのファイル無し）。⑤ のとおり `noindex` は残す。`noindex` は検索に出さないだけで、URL を知っていればだれでも読める（アクセスの制限ではない）。
- 英語版と日本語版は同じ節・同じ数の印（試験が比べる）。
- 試験 `tests/appstore-pages.test.mjs`：4 ページがある・HTML の形と言語・スクリプトや外のファイルが無い・リンク先がある・英語と日本語の節と印の数がそろう・鍵らしい文字が無い。

### 1-2. 置き場所と公開

- 【確認済み】funergy-plus.com は GitHub Pages（`CNAME`・成功した Pages のデプロイ）。CDN・ドメインの登録の会社までは確かめていない。
- アプリのデータ（データベース・ログイン・ファイル）は Supabase。ページにも分けて書いた。
- `main` へのマージ＝公開。残っている `[要確認]` を消し、`[Publication date]` と `[公開日]` をハワイ時間の公開日に置き換えてからマージする。印が残ったまま `main` に push すると `tests/appstore-pages.test.mjs` が失敗する。

## 2. 10 項目の答えの反映

| # | 項目 | 状態 | ページ |
|---|---|---|---|
| 1 | 施行日 | 【確認済み】公開した日（即日）。日付は作らない | `[Publication date]`／`[公開日]`。マージの直前にハワイ時間の日付へ置き換える |
| 2 | 運営者 | 【確認済み】正式名称 Funergy Group Inc.。部屋番号は STE 203 | 会社名・STE 203・Honolulu を反映 |
| 3 | iPhone の SDK | 【要確認】iPhone は別のリポジトリ `motoi107/funergy-native`（`codex/iphone-personal-preview`）。**このセッションからは読めない**（GitHub のアクセスが無い・画面も開けない）。Moto さんが見た依存：Capacitor・App・Browser・Filesystem・Share・`@supabase/supabase-js` など | [要確認: 最終提出ビルドに広告・解析の SDK が無いこと]。ライブラリがあることだけで、その会社に送っているとは書かない |
| 4 | ホスティング | 【確認済み】GitHub Pages | 外部のサービスに 1 行（データは置かない） |
| 5 | リポジトリに無い関数 | 【要確認】名前から送り先を決めない | 関数の名前を並べて [要確認]（3-3） |
| 6 | そのほかの提供 | 【確認済み】コードに出る提供先だけ。販売しない。開示は法令に基づくときか同意があるときだけ | ページに書いた。それ以外の約束は書いていない |
| 7 | 保存・削除 | 【確認済み】業務・雇用・給与・税・会計の記録は 5 年。削除の依頼があっても残す。ほかの文は 3-4 のまま | 本番の SQL が入っているかは [要確認] のまま（11-2） |
| 8 | 依頼の窓口 | 【確認済み】office@funergygroup.com | 反映 |
| 9 | ポリシーの問い合わせ | 【確認済み】同上。住所は STE 203 | 反映 |
| 10 | サポートの問い合わせ | 【確認済み】同上 | 反映。対応日数は書いていない |

## 3. 根拠

### 3-1. ページに書いた情報（確かめたコード）

行は `main`（e0e20ce）の `index.html` のおおよその行。

|---|---|
| 名前と PIN でログイン・PIN はサーバーが確かめる | `bootLogin`（22897）・`loginPickLocation`（22963）・`doStaffLogin`（23155）。サーバーは `auth-pin`（リポジトリに無い） |
| 一部の管理者・経理はメールとパスワード | `supabase/functions/device-login/handler.mjs`（v1185 `email_login`・`manager_auth` の ceo・gm・office） |
| パスキー・登録した端末（公開鍵・名前・日時） | `supabase/migrations/20261203090000_device_login.sql`（`dl_devices`）・`device-login/handler.mjs`（v1189） |
| メールに送るコードと招待 | `supabase/functions/device-login/mail.mjs`（会社の Gmail から送る） |
| ログインの記録（IP・ユーザーエージェント） | `dl_events`（`ip`・`ua`）・`device-login/handler.mjs` の 521 行あたり |
| スタッフの情報の欄 | `saveEmp`（65333）・`docs/SECURE_PII_V1144_JA.md` |
| 給与・メール・電話は権限のある人だけに届く | `getEmployees` の `emp-private`（9295 あたり・関数はリポジトリに無い）・`canViewWages`（10509）・`canViewIndividualWage`（10523） |
| 新しく入る人の情報（住所・SSN・本人確認書類・署名・I-9） | `_OB_SENSITIVE`（13787）・`stripObPII`・`obWizSubmit`（63934）。送り先は `ob-private`（リポジトリに無い） |
| 応募者の情報 | `saveApplicant`（62910） |
| Toast の出退勤・売上・支払い・チップ | `supabase/functions/ops-bot/handler.mjs`（`ws-api.toasttab.com`）・`hyper-worker`（Toast の取り込み・リポジトリに無い） |
| ガソリン代（出発地・目的地・距離）と Google マップ | `saveMileageRequest`（55071）・`ensureGoogleMaps`（54972）・`DistanceMatrixService` |
| 請求書・レシート（写真・PDF） | Storage の `invoices`（97683 ほか）・`supabase/functions/invoice-intake`・`invoice/drive.mjs`・`invoice/gmail.mjs` |
| 請求書を Claude API で読む | `invoice/extract.mjs` の `callModel`（`api.anthropic.com`）・`invoice-intake/handler.mjs` 77 行 |
| QuickBooks へメールで転送 | `invoice-intake/handler.mjs`・`docs/QB_IMMEDIATE_V1094_JA.md` |
| LINE へ業務の知らせ | `ops-bot/handler.mjs`（`api.line.me`） |
| 社員割引の利用 | `insertDiscountUse`（91902・`discount-log` はリポジトリに無い） |
| チャット（暗号はエンドツーエンドではない） | `supabase/migrations/20261121090000_chat.sql`・`20261124090000_chat_files.sql`・`docs/CHAT_GUARD_V1168_JA.md`（サーバーの鍵を持つ人は本文を読める） |
| 通知は中身なし・送り先だけ保存 | `chat_push_subs`（`20261128090000_chat_guard.sql`）・`work-requests/handler.mjs` の `webPush`・`pushOk`（122420） |
| 端末の印と種類・変更の記録 | `SG.device`（114219）・`SG.kind`・`fpActorHdr`（114260）・`change_log`（`20261118090000_change_signal.sql`） |
| 端末に保存する情報 | localStorage と IndexedDB（2401 あたりの v1104 の説明） |
| 当社の店の口コミ | `gr_reviews`（`20261122090000_google_reviews.sql`：投稿者・評価・コメント・日付） |
| QR コードのサービスに招待のリンク | `showInviteLink`（63063・`api.qrserver.com`） |
| Open-Meteo（店の緯度・経度） | 41765 あたり |
| jsDelivr・cdnjs | `index.html` 25–26 行・pdf.js（100980） |
| funergy-plus.com のファイルは GitHub Pages から | 【確認済み】`CNAME`（e0e20ce）と成功した Pages のデプロイ（Actions の run 45697789819・Moto さん） |
| 権限のある人はファイルに出力できる（チップ・手当・経費・棚卸し） | `renderAcctExport`（69398）の `exportTipCSV`・`exportSlPayrollCSV`・`exportAcctPayrollBook`・`exportInventoryCSV`。開ける人は `PAGE_GUARD.acct_export`（8037） |
| 位置情報・連絡先・広告・分析は使わない | `index.html` に `geolocation`・連絡先・広告／分析のタグが無い（検索で確かめた）。カメラは `<input type="file" capture>`（98442 ほか）だけ |
| 見られる範囲は役割で分ける | `ROLE_CONFIG`（7641）・`PAGE_GUARD`（8037）・`navGuardAllows`（8058）・secure-state の各段（`docs/SECURE_*`） |


### 3-2. 外部のサービス：業務・Funergy+ から渡すもの・方法

| サービス | 業務 | Funergy+ から渡すもの | 方法 | コードで確かめたこと | 運用で確かめること |
|---|---|---|---|---|---|
| Supabase | アプリのデータの置き場所 | アプリのデータ全部 | 自動 | 【コード】全体 | — |
| GitHub Pages | Web 版のファイルを届ける | なし（ファイルを届けるだけ。通常の通信の情報は届く） | 自動 | 【確認済み】 | — |
| Toast（POS） | 勤怠・売上・支払い・チップ | なし（Toast から読む） | 自動（サーバー） | 【コード】`ops-bot`（`ws-api.toasttab.com`）。取り込みの `hyper-worker` はリポジトリに無い | — |
| Toast Payroll | 給与 | 【要確認】自動の連携はリポジトリのコードに無い。権限のある人が出力できるファイル：チップ（`exportTipCSV`）・シフトリーダー手当（`exportSlPayrollCSV`）・Payroll 別のガソリン代と立替経費（`exportAcctPayrollBook`）。入社の手続きの画面に「W-4 は Toast Payroll から本人が変える」の案内（63757） | 【要確認】担当者の出力・入力 | 【コード】上の出力と案内だけ | どの出力・情報を Toast Payroll に使うか・新しく入る人の情報を担当者が登録するか・リポジトリに無い関数に連携が無いこと |
| Intuit QuickBooks | 会計・請求書 | 請求書の原本のファイル（PDF など） | 自動：会社の Gmail から QuickBooks の受付のアドレスへメール（`invoice-intake`・v1094） | 【コード】`invoice-intake/handler.mjs`・`docs/QB_IMMEDIATE_V1094_JA.md` | 本番で自動の転送が動いているか（前は別の担当の転送） |
| LINE | 業務の知らせ | 知らせの文（店・スタッフの名前・勤務の内容を含むことがある） | 自動（`ops-bot`・請求書の知らせ） | 【コード】`ops-bot/handler.mjs`（`api.line.me`）・`invoice_qb_alerts` | どのグループに送るか（設定） |
| Gmail | ログインのコード・招待・知らせを送る／請求書を受け取り転送する | 宛先のメールアドレス・コード・招待のリンク／請求書 | 自動 | 【コード】`device-login/mail.mjs`・`invoice/gmail.mjs` | — |
| Google Drive | 請求書のファイルの保存 | 請求書のファイル | 自動 | 【コード】`invoice/drive.mjs` | — |
| Claude API（Anthropic） | 請求書の読み取り | 請求書の書類 | 自動 | 【コード】`invoice/extract.mjs`・`invoice-intake` 77 行 | — |
| Google Business Profile・Places | 店の口コミ・評価 | 店の情報（Google から読む） | 自動 | 【コード】`google-reviews` | — |
| Google Maps | ガソリン代の住所の検索と距離 | 入力した出発地・目的地 | 画面で押したとき | 【コード】`ensureGoogleMaps`・`DistanceMatrixService` | — |
| QR コード（api.qrserver.com） | 入社の招待の QR | 招待のリンク | 画面で出したとき | 【コード】`showInviteLink` | — |
| Open-Meteo | 天気 | 店の緯度・経度 | 自動 | 【コード】41765 あたり | — |
| jsDelivr・cdnjs | 部品・アイコン | 通常の通信の情報 | 開いたとき | 【コード】`index.html` 25–26・100980 | — |

### 3-3. リポジトリに無い関数（中身を確かめられない）

アプリから何を送っているかはコードで分かる。関数の中（保存の形・ほかへの送り先）は分からない。本番のコード・設定で確かめる。

| 関数 | アプリが送るもの | 確かめること |
|---|---|---|
| `auth-pin` | 名前と PIN・PIN の一覧とリセット・在籍に戻す | PIN の保存の形・ほかへの送り先・iPhone アプリ（`capacitor://localhost`）から呼べるか |
| `emp-private` | （読む）給与・メール・電話 | 保存の場所・見られる役割 |
| `ob-private` | 新しく入る人の住所・SSN・本人確認書類の画像・署名 | 保存の場所・保存期間・読める人・ほかへの送り先 |
| `hyper-worker` | Toast の取り込みの頼み | 何を保存するか・Toast のほかへの送り先 |
| `invoice_ocr`・`check_ocr` | レシート・請求書・チェックの画像 | 読み取りに使う外部のサービス |
| `discount-log` | 名前・PIN・店 | 保存するもの |
| `drive-sync` | Google Drive の連携の設定 | 何を Drive に置くか |
| `work-requests` の PIN の確かめの部分 | 名前と PIN | 保存の形 |

### 3-4. 保存と削除の整理

**アカウントの停止**【コード】：退職・OS の無効（`osDisabled`）にすると、PIN が使えない印になり、結びついた管理者のメールのアカウントは `suspended`、業務Bot の利用も止まる（`20261023090000_employee_resign_guard.sql`）。前の値は `employee_access_hold` に残り、在籍に戻すと元に戻る。

**データの削除**【コード】：アプリの従業員マスターの「削除」は退職にするだけ（`deleteEmp` 65454）。社員の行は消さない（公開の鍵では消せない）。消せるのは、チャットの自分のメッセージ（本文を消す）・請求書の画像（Storage）など一部。社員・応募者・新しく入った人の情報を消す手順は無い（消すならデータベースの管理者の作業）。

→ **停止と削除は別の手続き**。ページにもそう書いた。

**自動の削除**【コード・本番に入っているかは要確認】：

| 何 | いつ | 場所 |
|---|---|---|
| 変更の記録（`change_log`） | 約 1 年より前 | `20261118090000_change_signal.sql` 194 行 |
| メッセージに付かなかったチャットの添付 | 1 日 | `20261124090000_chat_files.sql` 465 行 |
| チャットの鍵を開けた状態 | 2 時間使わなければ | `20261128090000_chat_guard.sql` 124 行 |
| Google・Gmail をつなぐときの一時的な値 | 10 分・1 日 | `20261122090000_google_reviews.sql` 165 行・`20261026090000_invoice_qb_gmail.sql` 186 行 |

ログインの記録（`dl_events`）・社員・応募者を自動で消すコードは無い。新しく入った人の書類（`ob-private`）は分からない。

**残す記録**【確認済み・5 年】：業務・雇用・給与・税・会計の記録（給与・勤怠・チップ・賞与、雇用の手続き、請求書・レシート・経費、変更の記録を含む）。3-4 の「必要なあいだ保存する」という文はそのまま。

**削除の対象にできそうな情報**【案】：不採用の応募者、登録した端末とパスキー、通知の宛先、ログインの記録（期間を決めて）、チャット（本人が消せる）、端末の中の控え（端末の側）。

**ページに入れた文**（英語・日本語とも同じ）：

1. 【確認済み】業務に必要なあいだ保存する。業務・雇用・給与・税・会計の記録は 5 年。
2. 【コード】停止と削除は別。停止で PIN とメールのログインは止まり、記録は残る（＋[要確認: 本番に退職の守りが入っていること]）。
3. 【コード】自動で消すもの（上の表）（＋[要確認: 本番に入っていること]）。
4. 【要確認】そのほかの情報（ログインの記録・スタッフの情報・応募者・本人確認書類など）の保存期間と削除の方法。
5. 【確認済み】依頼は office@funergygroup.com。削除の依頼があっても、5 年残す記録は残す。

「退職後○年で自動削除」「依頼があればすぐ全部消す」とは書いていない。

## 4. App Store Connect の「App のプライバシー」の下書き（参考）

Apple の区分の名前と説明は App Store Connect の画面で確かめてから答える。iPhone の最終ビルドの中身（3 の項目）が分かってから決める。

| 集めるもの | 近い区分（案） | 本人と結びつく | トラッキング |
|---|---|---|---|
| 氏名・メール・電話・住所（新しく入る人） | 連絡先情報 | はい | いいえ |
| 給与・チップ | 財務情報（そのほかの財務情報） | はい | いいえ |
| 社員の ID・端末の印 | ID（ユーザー ID・デバイス ID） | はい | いいえ |
| 写真（レシート・チェック・添付） | ユーザーコンテンツ（写真） | はい | いいえ |
| チャットのメッセージ | ユーザーコンテンツ（メッセージ） | はい | いいえ |
| 生年月日・SSN・本人確認書類・評価など | そのほかのデータ | はい | いいえ |

## 5. 審査用デモアカウント（①②・追加の 2 点）

Apple（【確認済み】App Review のヘルプ・ガイドライン 2.1(a)）：ログインが要るアプリは、審査のときに使えるデモアカウントを出す。管理者と一般の利用者のように種類があるときは、種類ごとのログイン情報をメモの欄に書く。機微な情報を扱うときは、デモ用のデータで全部の機能を見せるデモモードでもよい（ガイドライン 2.1(a) では、法や安全の理由でデモアカウントを出せないときのデモモードは Apple の事前の承認が要る）。

### 5-1. 権限のしくみ【コード】

- ログイン：所属（店か Office）→ 名前 → PIN。ログインの前に、選んだ所属のスタッフの名前と役割が並ぶ（`loginPickLocation` 22963）。店の一覧は止めた店も含めて全部（`bootLogin` 22897）。店の共有の端末は「この店舗としてログイン」（役割 `sl`＋`curStoreLogin`）。
- 役割（`ROLE_CONFIG` 7641）：ceo・gm・office・office_crew・am（G5）・chef・g4・sl（G3）・g2・crew（G1）。
- 画面：`CREW_GROUPS`（7838）・`STORE_GROUPS`（7848）・`PAGE_GUARD`（8037）・`CREW_EXTRA_PAGES`（8052）・`navGuardAllows`（8058）。「画面の表示」の個人の例外は、G1 では大タブとマイページのカードだけ（押して行ける画面は隠せない）。
- 給与：G1 は合計も個人の額も画面に出ない（`canViewWages` 10509・`canViewIndividualWage` 10523）。個人の欄（生年月日など）は G1 には返さない（secure-state `pii_get`）。採用は G1 は開けない。

### 5-2. 調べてわかったこと（重要）

1. **G1 でも本物のデータが端末に届く**【コード】。ログインのたびに、役割によらず次を取り込む（`supaPullAllMasters` 17680・`_kvPullRows` 17522）：
   - 店・従業員（全員の行。名前・役割・店など。給与・メール・電話は除く）・食材・レシピ・業者・カテゴリー
   - `app_settings` の全部
   - `app_state` の全部のキー（成長カルテ・賞与・Career Score・採用・個人の欄など「秘密のキー」を除く）。全店のシフト・勤怠・チップ・承認・Daily Operations などが入る
   - REST の読み込みは、だれのログインでも公開の鍵で行う（`supaHeaders` は `SUPABASE_ANON`）。これらの行は公開の鍵で読める決まり（`ss_open`）のまま。**画面を隠しても、データは端末に届く**（同じ理由で、ログインの外からも読める。今の作り・段階 2b の続きの話）。
2. **審査用の店を集計から外す仕組みは無い**【コード】。
   - 店を「止める」（`active:false`）と、CEO・GM の集計（`activeStores()`・42 か所）からは外れるが、G1 の画面も `activeStores()` から店を選ぶ（`getVisibleStores` 26251）ので、**審査用の G1 が自分の店を開けなくなる**。
   - 店を「動かす」と、全店の集計・店の数・平均・帳票に入る（売上 0 でも数や平均が変わる）。`STORES`（止めた店も含む）を使う所も 24 か所ある。
   - 従業員に「集計・給与から外す」印は無い。審査用のスタッフはチップの出力・従業員マスター・Career Score の一覧などに出る。
3. **申請は本物の人が見る**【コード】：CEO・GM・経理・事務Crew はすべての申請を見られる（`wr_visible`・`20261104090000_work_requests.sql` 277 行）。休暇は経理の画面・給与の流れにつながる。審査メモに「申請しないで」と書いても止められない。
4. **Daily Operations**：店ごと・日ごとのキー（`dailyops_<店>_<日付>`）に書くので、ほかの店の行は変えない。ただし共有の `app_state` に入り、全員の端末に届き、全店を見る画面に出うる。

→ **結論：本番の共有のデータベースのままでは、要件（実データが届かない・集計と給与から外れる・申請が本物に流れない）を満たせない**。G1 を 1 人作るだけでは足りない。

### 5-3. 案（比べる・まだ決めていない）

| | A. 審査用の別の環境（おすすめ） | B. アプリの中だけのデモモード | C. 本番の DB のまま直す |
|---|---|---|---|
| 形 | 別の Supabase のプロジェクトに架空のデータ。アプリに「審査用（デモ）」の入口を作り、選ぶとその環境につなぐ | サーバーにつながず、端末の中の架空のデータで動く | 店・人に「審査用」の印を足し、集計・給与・申請・読み込みのすべてで外す |
| 実データが届かない | ○（つなぐ先が別） | ○ | ×（読み込みを店ごと・役割ごとにサーバーで絞る大きな作り直しが要る） |
| 集計・給与・申請から外れる | ○ | ○ | △（多くの場所を直す・漏れの危険） |
| アカウントの種類 | ○ 架空の店長・本部の人も作れる | △ 種類ごとの架空データを作る | × 本物のデータが見える役割は出せない |
| 保存の確かめ | ○ 本物と同じ流れ | △ 端末の中だけ | ○ |
| 要る変更 | 新しいプロジェクト・SQL を全部流す・関数（リポジトリに無いものも）を置く・架空のデータ・`index.html` の入口と接続先の切り替え・審査のあいだ動かしておく | `index.html` の大きな変更（関数を使う画面の作り物）。Apple の事前の承認が要る場合がある | `index.html`・SQL・関数の広い変更 |
| 影響 | 環境を 2 つ持つ手間・関数を両方に置く | 「全部の機能」を見せるのが難しい | 本番への影響が大きい |

A のとき、審査用の入口は隠さない（だれが押しても架空のデータだけ）。リポジトリに無い関数を審査用の環境にも置けるかが前提。

### 5-4. アカウントの種類（A のときの案）

iPhone の提出ビルドで見られる機能によって決める。今の Web と同じなら、種類は「店のスタッフ（G1）」「店の共有の端末」「店長（G4）」「本部（GM 相当）」。どれも審査用の環境の架空の人・架空の店。本物の GM のアカウント・本物のスタッフの給与やチャットは出さない。どこまで出すかは会社が決める（11-1）。

### 5-5. 審査メモの下書き（App Review Notes・英語・案が決まってから直す）

```
Funergy+ is an internal app for the staff of our restaurants. Accounts are created by the company; there is no sign-up.
The demo accounts below use a demo environment that contains sample data only.

To sign in: tap "[審査用の入口]", then the store, then the name, and enter the PIN.
- Staff account: [店] / [名前] (PIN in the Password field)
- [ほかの種類のアカウント]

Privacy Policy: https://funergy-plus.com/privacy/   Support: https://funergy-plus.com/support/
```

PIN・パスワードはこの文書・PR に書かない。App Store Connect の欄にだけ入れる。

## 6. ③ アプリの中のリンク（`claude/app-privacy-link`・v1218）

- ログインの画面の下（ログインの前・店の共有の端末も）と、マイページの下（どの形でも）に「プライバシーポリシー・サポート」。日本語なら `/privacy/ja/`・`/support/ja/`、English なら `/privacy/`・`/support/`。新しいタブ。
- iPhone アプリ（`capacitor://localhost`）では相対の URL がアプリの中を指すので、公開のサイトの URL（`https://funergy-plus.com/...`）を書いた。
- 確かめた：試験 `tests/app-privacy-link-v1218.test.mjs`、Chromium でログインの画面（日本語→English で行き先が変わる）。
- 【要確認】**Web の直しが iPhone の提出ビルドに入るか**：`funergy-native` が Web のファイルをビルドに写すのか（Capacitor の `webDir`）、サイトを開くのか（`server.url`）、別の画面なのか（`@supabase/supabase-js` が依存にある）。このセッションからは読めない。
- 【要確認】iPhone アプリの中で `target="_blank"` の外の URL がどう開くか（Safari・アプリの中のブラウザー・何も起きない）。実機で確かめる。開かないなら、Browser のプラグインで開く直しを `funergy-native` 側か Web 側に足す。

## 7. ④ Service Worker（`claude/sw-static-nav`・v1217）

- 再現した（Chromium・ローカルのサーバー）：アプリを開く → `/privacy/` を開く → オフラインでアプリを開くと、**プライバシーポリシーが出た**（直す前の `sw.js`）。
- 直したあと：同じ手順でアプリ（Funergy+）が出る。オフラインの `/privacy/` はブラウザーの「つながらない」表示（控えを作らない）。
- 直し：`index.html` の控えにするのはアプリ本体（SW の範囲の先頭・`index.html`・`?onboard=` などの問い合わせや `#` 付き）だけ。静的ページはネットワークだけ。
- 試験 `tests/sw-static-nav-v1217.test.mjs`（直す前の `sw.js` では 3 件が失敗）。アプリの試験 315 件も通った。

## 8. ⑤ noindex

`noindex` は残す（アプリと同じ）。4 ページはログインなしで全文を読める（試験がスクリプトやログインに頼らないことを確かめる）。

## 9. 初期 PIN のまま使える在籍者の確かめ方（追加の 1 点目）

- 【コード】従業員マスター › 「PIN一覧」（`renderStaffMaster` 64905・`openPinListModal` 19806）。開けるのはメールで認証した GM・CEO だけ。サーバー（`auth-pin`）から読み、端末には保存しない。
- 自分の PIN を決めていない人は、その欄に初期の値が出る（`_staffPinView`）。止めた人は「停止中」。
- 画面で見るだけにし、写真・メモ・コピーで残さない。初期のままの人がいたら、同じ画面の「リセット」で変えるか、本人にマイページの「PIN設定」で変えてもらう。
- 結果（だれが初期のままか）は、公開の PR・文書に書かない。

## 10. 申請・保存が本番に流れないこと（追加の 2 点目）

5-2 のとおり、本番の共有のデータベースでは、審査用のアカウントの申請は CEO・GM・経理・事務Crew に見え、休暇は給与の流れにつながる。審査メモでは防げない。5-3 の A（別の環境）なら、申請・Daily Operations・チャットはすべて架空の環境の中で終わる。チャットや給与のカードを隠すこととデータに届かないことは別なので、A か B でなければ要件を満たせない。

## 11. 公開の前に残っていること

### 11-1. 会社側で決めるもの

| # | 決めること | 関係するところ |
|---|---|---|
| 1 | 済（Moto さん）：施行日は公開した日（即日）。日付は作らない。`[Publication date]`／`[公開日]` を、マージの直前にハワイ時間の日付へ置き換える | ページ |
| 2 | 済（Moto さん）：部屋番号は STE 203 | ページ |
| 3 | 済（Moto さん）：窓口は office@funergygroup.com | ページ |
| 4 | 済（Moto さん）：業務・雇用・給与・税・会計の記録は 5 年。ほかの文は 3-4 の【案】のまま | ページ |
| 5 | 済（Moto さん）：コードに出る提供先だけ。販売しない。開示は法令に基づくときか同意があるときだけ。それ以外の約束は書かない | ページ |
| 6 | 済（Moto さん）：提供先には、このポリシーと同等の保護を求める（Apple 5.1.1(i)） | ページ |
| 7 | 済（Moto さん）：削除の依頼があっても、残さなければならない記録がある | ページ |
| 8 | デモの形（5-3 の A・B・C）と、出すアカウントの種類（5-4） | ① ② |
| 9 | 審査用の環境を作るか・だれが作り、審査のあいだ動かしておくか（A のとき） | ① ② |
| 10 | 3 つの PR をマージする順と時期（pages → v1217 → v1218・a23 との版） | 1 の節 |

### 11-2. コード・設定・実機で確かめるもの

| # | 確かめること | どこで |
|---|---|---|
| 1 | 最終提出ビルドに広告・解析の SDK が無いこと・依存（Capacitor・App・Browser・Filesystem・Share・supabase-js）の使い道 | `funergy-native`（`codex/iphone-personal-preview`）の `package.json`・`Package.swift`・ビルド |
| 2 | iPhone アプリが Web のファイルを写すのか・サイトを開くのか・別の画面か（③ の直しが提出ビルドに入るか） | `funergy-native` の Capacitor の設定 |
| 3 | カメラ・写真の許可の文（写真の添付を使うため） | `funergy-native` の `Info.plist` |
| 4 | リポジトリに無い関数の送り先・保存の形（3-3） | 本番の Supabase の関数 |
| 5 | Toast Payroll に直接の連携が無いこと・担当者が使う出力 | 本番の関数・運用 |
| 6 | QuickBooks への自動の転送が本番で動いているか | 本番の関数・設定 |
| 7 | 自動の削除の SQL と退職の守りの SQL が本番に入っていること | 本番のデータベース |
| 8 | iPhone アプリで PIN のログイン・保存ができるか（リポジトリに無い関数が `capacitor://localhost` を受けるか） | 実機 |
| 9 | iPhone アプリの中でリンク（`target="_blank"`）が開くか | 実機 |
| 10 | 初期 PIN のまま使える在籍者がいないこと | 本番の「PIN一覧」（GM・CEO） |
| 11 | パスキー・通知が iPhone アプリの中で動くか（動かないなら審査で押されても困らない形か） | 実機 |
| 12 | 公開のあと、4 ページがログインなしで開けること・`/privacy`（最後の `/` なし）が `/privacy/` に移ること | 公開後の funergy-plus.com |
