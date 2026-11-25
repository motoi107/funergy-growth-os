# App Store 審査の準備（プライバシーポリシー・サポートのページ・審査用デモアカウントの要件）

依頼：Moto さん「App Store 審査に必要な次の 3 点」。iPhone 版 Funergy+（App Store Connect の app 6831074913・Bundle ID `com.funergygroup.funergyplus.preview`）を、スタッフ向けの非掲載配布（Unlisted）で審査に出すため。

- 作業 1：プライバシーポリシーのページ（英語・日本語）
- 作業 2：サポートのページ（英語・日本語）
- 作業 3：審査用デモアカウントの要件（**作らない**。アカウント・パスワード・本番の DB への書き込みは無し）

守ったこと：アプリ（`index.html`・`sw.js`）・ログイン・保存・Supabase の設定・CORS・JWT の確かめは変えていない。日付・価格・約束・条件は足していない（コードから決まらないものは `[要確認]`）。鍵・パスワード・本物のアドレスは書いていない。

調べた土台：`main`（e0e20ce・#221 まで）。

## 1. 作ったもの

| URL（マージしたあと） | ファイル | 中身 |
|---|---|---|
| `https://funergy-plus.com/privacy/` | `privacy/index.html` | プライバシーポリシー（英語） |
| `https://funergy-plus.com/privacy/ja/` | `privacy/ja/index.html` | プライバシーポリシー（日本語） |
| `https://funergy-plus.com/support/` | `support/index.html` | サポート（英語） |
| `https://funergy-plus.com/support/ja/` | `support/ja/index.html` | サポート（日本語） |

- ログインせずに開ける静的なページ。スクリプト・フォーム・ほかのサイトのファイルは無い（アイコンだけ同じサイトの `/appicons/`）。暗い表示にも合わせた。
- 英語版と日本語版は同じ節（`id`）を持ち、互いにリンクする。`[要確認]` は黄色の印で目立たせた（埋めたら `<mark class="todo">` ごと消す）。
- `noindex`：アプリ（`index.html` の v794）と同じく検索に出さない。審査は URL が開ければよい。検索に出したいときは 2 行を消す。
- 確かめ：`tests/appstore-pages.test.mjs`（CI の「Check the App Store pages」）。4 ページがある・HTML の形と言語・スクリプトや外のファイルが無い・リンク先がある・英語と日本語の節と `[要確認]` の数がそろう・鍵らしい文字が無い。
- App Store Connect に入れる URL（案）：プライバシーポリシー＝`/privacy/`（日本語のローカライズがあれば `/privacy/ja/`）・サポート＝`/support/`（同じく `/support/ja/`）。

### 1-1. 置き場所と公開

- リポジトリの `CNAME`（funergy-plus.com）の置き方から、`main` のファイルがそのまま funergy-plus.com に出ると見ている（ホスティングの設定はリポジトリの外なので `[要確認]`）。**マージ＝公開**。`[要確認]` を埋めてからマージする。
- `/privacy/` は `privacy/index.html` を返す（フォルダーの index）。`/privacy`（最後の `/` なし）はホスティングが `/privacy/` に移す想定（公開後に確かめる）。

### 1-2. Service Worker（今回は変えていない）

- `sw.js` は画面の移動（navigate）をネットワーク優先で取り、取れた中身を `index.html` の控えとしてキャッシュに入れる（今の決まり）。
- そのため、アプリを入れたブラウザーで `/privacy/` を開くと、オフラインのときに出す控えが一時的にこのページになる。次にオンラインでアプリを開けば直る（ネットワーク優先のため）。ページの表示そのものは正しい。
- 「既存の処理を変えない」ため今回は触っていない。直すなら別の PR で、`/privacy/`・`/support/` を控えに入れない（`SW_BUILD` と `APP_VERSION` を上げる）。

## 2. `[要確認]` の一覧

| # | ページ（英語・日本語とも） | 中身 | コードで決められない理由 |
|---|---|---|---|
| 1 | プライバシー：最終更新日 | 施行日 | 日付は足さない決まり |
| 2 | プライバシー：はじめ | 運営者の正式名称と所在地 | コードにあるのは「Funergy Group」（入社の招待の文）だけ |
| 3 | プライバシー：使わないもの | iPhone アプリの本体（ネイティブ部分）に追加の SDK が無いこと | iPhone のプロジェクト（Capacitor）がリポジトリに無い。Web のコードには位置情報・連絡先・広告・分析が無い |
| 4 | プライバシー：外部のサービス | funergy-plus.com のホスティング事業者 | ホスティングの設定がリポジトリの外 |
| 5 | プライバシー：外部のサービス | リポジトリに無い関数が使う外部のサービス | 下の 3-3 の関数は中身を確かめられない（例：`invoice_ocr` の読み取りの会社） |
| 6 | プライバシー：外部のサービス | そのほかの第三者への提供（給与計算の委託先・法令に基づく開示・販売しないこと など） | 方針はコードから決まらない |
| 7 | プライバシー：保存する期間 | 保存期間と削除の方針 | 全体の期間を決めるコードは無い（コードで消している物は 3-2） |
| 8 | プライバシー：ご依頼 | 見たい・直したい・消したいときの依頼の方法と窓口 | 窓口はコードから決まらない |
| 9 | プライバシー：お問い合わせ | 問い合わせ先 | 同上 |
| 10 | サポート：お問い合わせ | 問い合わせ先 | Moto さんが埋める（依頼のとおり） |

## 3. ページに書いた情報の根拠（確かめたコード）

行は `main`（e0e20ce）の `index.html` のおおよその行。

| 書いたこと | 確かめた場所 |
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
| 位置情報・連絡先・広告・分析は使わない | `index.html` に `geolocation`・連絡先・広告／分析のタグが無い（検索で確かめた）。カメラは `<input type="file" capture>`（98442 ほか）だけ |
| 見られる範囲は役割で分ける | `ROLE_CONFIG`（7641）・`PAGE_GUARD`（8037）・`navGuardAllows`（8058）・secure-state の各段（`docs/SECURE_*`） |

### 3-1. 書かなかったこと

- 「安全のための取り組み」は、コードで分かること（ログインが要る・役割で範囲を分ける・HTTPS）だけ。暗号化の方式などは書いていない。
- 子ども・ポリシーの変え方・データの国外への移転などは、コードから決まらないので節を作っていない（要るなら足す）。

### 3-2. コードで自動で消しているもの（保存期間を決めるときの材料・ページには書いていない）

| 何 | いつ消す | 場所 |
|---|---|---|
| 変更の記録（`change_log`） | 1 年より前の行 | `20261118090000_change_signal.sql` 194 行 |
| チャットの添付で、メッセージに付かなかったもの | 1 日 | `20261124090000_chat_files.sql` 465 行 |
| チャットの鍵を開けた状態（`chat_sess`） | 2 時間使わなければ | `20261128090000_chat_guard.sql` 124 行 |
| Google・Gmail をつなぐときの一時的な値 | 10 分・1 日 | `20261122090000_google_reviews.sql` 165 行・`20261026090000_invoice_qb_gmail.sql` 186 行 |

ログインの記録（`dl_events`）・従業員・応募者・新しく入った人の情報を自動で消すコードは見つからなかった。

### 3-3. リポジトリに無い関数（中身を確かめられなかった）

`auth-pin`・`emp-private`・`ob-private`・`hyper-worker`・`invoice_ocr`・`check_ocr`・`discount-log`・`drive-sync`・`work-requests` の PIN の確かめの部分。ページは、アプリの側から見える送り先と項目で書いた。これらがさらに外のサービスに送っているかは `[要確認]`（2 の #5）。

## 4. App Store Connect の「App のプライバシー」の下書き（参考）

ページと同じ根拠からの下書き。Apple の区分の名前と説明は App Store Connect の画面で確かめてから答える。

| 集めるもの | 近い区分（案） | 本人と結びつく | トラッキング |
|---|---|---|---|
| 氏名・メール・電話・住所（新しく入る人） | 連絡先情報 | はい | いいえ |
| 給与・チップ | 財務情報（そのほかの財務情報） | はい | いいえ |
| 社員の ID・端末の印 | ID（ユーザー ID・デバイス ID） | はい | いいえ |
| 写真（レシート・チェック・添付） | ユーザーコンテンツ（写真） | はい | いいえ |
| チャットのメッセージ | ユーザーコンテンツ（メッセージ） | はい | いいえ |
| 生年月日・SSN・本人確認書類・評価など | そのほかのデータ | はい | いいえ |

- 広告・分析の仕組みは Web のコードに無い（iPhone の本体は `[要確認]`）。
- 位置情報：端末の位置は使わない。ガソリン代の住所は人が入れる文字（区分は画面で確かめる）。

## 5. 審査用デモアカウントの要件（提案・作らない）

### 5-1. 権限のしくみ（コードで確かめた）

- **ログイン**：所属（店か Office）→ 名前 → PIN。店の共有の端末は「この店舗としてログイン」（店舗 PIN・役割は `sl`＋`curStoreLogin`・23180 あたり）。
  - ログインの前に、選んだ所属のスタッフの名前と役割が並ぶ（`loginPickLocation`）。ログインの画面は今回変えない。
  - 店の一覧は止めた店も含めて全部出る（`bootLogin`「だれもロックアウトしないよう全店表示」）。
- **役割**（`ROLE_CONFIG` 7641）：ceo・gm・office（経理）・office_crew（事務Crew）・am（G5）・chef（Head Chef）・g4・sl（G3）・g2・crew（G1）。
- **画面**：`NAV_ITEMS` の roles（7659）・G1 の木 `CREW_GROUPS`（7838：マイページ・Handbook・シフト・スキル・チップ・店舗オペレーション・チャット）・店のタブレットの木 `STORE_GROUPS`（7848：店舗オペレーション・シフト作成・棚卸し・休暇承認）・`PAGE_GUARD`（8037）・G1 が押して行ける画面 `CREW_EXTRA_PAGES`（8052）・`navGuardAllows`（8058）。
  - 「画面の表示」（`FUNERGY_PV`・`docs/PAGE_VIEW_V1193_JA.md`）：G1 は大タブの表示・非表示とマイページのカード（`times`・`exp`＝事前経費）だけ。**個人の例外**（継承／表示／非表示）がある。G1 が押して行ける画面（`CREW_EXTRA_PAGES`）は、この設定では隠せない（`decide` の G1 の道・118150 あたり）。保存は GM・CEO がパソコンかタブレットで。
- **給与**：G1 は合計も個人の額も見られない（`canViewWages` 10509・`canViewIndividualWage` 10523＝CEO・GM だけ）。給与・メール・電話は `emp-private` から権限のある人だけ（コメントの説明・関数はリポジトリに無い）。
- **個人の欄**（生年月日・カード・保険）：G1・店のタブレットは何も読めない（secure-state `pii_get`・`docs/SECURE_PII_V1144_JA.md` の 2）。
- **採用**：G1 は開けない（`renderHiring` 62687）。
- **Career Score**：G1 は自分の分だけ（`secure-state/handler.mjs` の 64 行あたりの説明）。G2 は自分の店の G1 の点が見える。
- **チャット**：G1 も在籍の全社員と DM・グループを作れる（`docs/CHAT_V1156_JA.md` の 3A）。相手を選ぶときに全社員の名前が出る。
- **申請**：経費・休暇などは承認する人（本物の店長・GM など）に届く。ガソリン代は G3 以上（`canSubmitMileage` 54969）。

### 5-2. 提案：審査用の店の G1（crew）を 1 人

| 項目 | 案 | 理由 |
|---|---|---|
| 役割 | **G1（crew）** | 給与（合計・個人）・個人の欄・採用・ほかの人の評価が見えない。見えるのは自分と自分の店の業務 |
| 所属 | **審査用の店を 1 つ新しく作る** | 本物の店に入れると、その店のスタッフのシフト・日報・チップが見える |
| 審査用の店 | 名前は審査用と分かるもの。Toast の GUID・Google の店・AM・Chef は空。業務Bot（LINE）の宛先・請求書の店には入れない | 本物のデータ・外のサービスとつながらない |
| スタッフ | 架空の名前を 1 人。社員番号・メール・電話・生年月日・カード・保険・時給は空。Toast の別名なし | 本物の人の情報を持たない |
| PIN | 0000 以外を Moto さんが決める。App Store Connect の審査情報の欄にだけ書く（リポジトリ・PR には書かない） | 審査担当だけが使う |
| 隠す画面（個人の例外） | チャット（G1 の大タブ `g_chat`）・マイページの事前経費のカード（`exp`） | チャットは全社員の名前が出て、本物の人に送れる。経費の申請は本物の承認者に届く |
| 残す画面 | マイページ・Handbook・シフト・スキル（キャリア・育成）・チップ（店の Tip Rate）・店舗オペレーション | 主な業務の画面 |
| 保存の確かめ | 店舗オペレーションの Daily Operations のチェック（押すと保存・`toggleDailyOp` 102692） | 審査用の店の日ごとの行（`dailyops_<店>_<日付>`）にだけ書く。新しい店は初めの項目（`DEFAULT_DAILYOPS`）が出る |
| 審査のあと | スタッフを OS 停止か退職にする。店は止める（止めてもログインの画面には出る） | 使われ続けない |

ほかの案（とらない理由）：

- 店のタブレット（「この店舗としてログイン」）：シフト作成・棚卸し・休暇の承認が出る。休暇の承認は人の申請を扱う画面で、審査用には広い。
- G2 以上：自分の店の G1 の評価・チップの配分など、人ごとの情報が増える。

### 5-3. 影響と注意（作る前に Moto さんに見てほしいこと）

1. 審査用の店は、店の一覧・全店の合計（予実・人件費など）・エラーセンターなどに、売上 0 の店や「Toast の GUID が無い」として出る可能性がある。止めた店でどこまで消えるかはドライランで見る。
2. ログインの画面で審査担当がほかの店を選ぶと、その店のスタッフの名前と役割が見える（今の作り）。
3. アプリはログインのたびに従業員の表（名前・役割・店など。生年月日などは v1144 から別）を端末に取り込む（`docs/SECURE_PII_V1144_JA.md` の 1）。画面に出なくても端末には届く。
4. G1 が押して行ける画面（`CREW_EXTRA_PAGES`：休暇・目標・ランチチャレンジ・通知・Daily Ops など）は「画面の表示」で隠せない。ドライランで中身を 1 つずつ見る。休暇の申請は承認する人に届く（審査メモで「申請は送らないで」と書くかは Moto さんが決める）。
5. iPhone アプリ（Origin `capacitor://localhost`）：リポジトリの関数は #221 で受けるようにした。リポジトリに無い関数（`auth-pin` など）が受けるかは分からない。**iPhone アプリで PIN のログインと保存ができるか**を実機で確かめる。

### 5-4. 作る手順（案・すべて Moto さんが本番で行う）

1. 店舗マスター：審査用の店を作る（5-2 の設定）。
2. 従業員マスター：審査用の店の G1 を 1 人（5-2 の設定）。
3. PIN を設定する（0000 以外）。
4. 設定 › 承認・閲覧設定 › 画面の表示：審査用のスタッフに個人の例外（チャット・事前経費のカードを非表示）。
5. iPhone アプリでドライラン：ログイン → 各画面を開く → Daily Operations を 1 つ押して保存 → ログアウトして入り直し、残っているか。給与・ほかの人の個人の情報・チャットが出ないこと。
6. App Store Connect の「App Review に関する情報」：サインインが必要・ユーザー名（店と名前）・パスワード（PIN）・メモ（下の 5-5）。

### 5-5. 審査メモの下書き（App Review Notes・英語）

```
Funergy+ is an internal app for the staff of our restaurants. Accounts are created by the company; there is no sign-up.

To sign in:
1. Tap the store "[審査用の店の名前]".
2. Tap the name "[審査用のスタッフの名前]".
3. Enter the PIN given in the Password field.

This is a regular staff account in a demo store that contains sample data only.
Main screens: My Page, Store Operations (tap a Daily Operations item to save it), Shift, Skills, Handbook.

Privacy Policy: https://funergy-plus.com/privacy/
Support: https://funergy-plus.com/support/
```

## 6. 審査の前に確かめておくこと（iPhone のプロジェクトがリポジトリに無いため）

- **アプリの中からプライバシーポリシーを開ける導線**：私の知る範囲では、Apple の審査ガイドライン（5.1.1）はアプリの中にもリンクを求める。今の `index.html` には無い。足すなら `index.html` の変更なので別の PR（ログインの画面の下やマイページなど・場所は Moto さんが決める）。
- **カメラ・写真の許可の文**（`Info.plist` の説明）：写真の添付（`<input type="file" capture>`）を使うため、iPhone アプリの本体に要る。
- **パスキー・通知**：WebView の中で動くか。動かないなら審査で押されても困らない形か。
- **アカウントの削除**：アプリでだれでも作れるアカウントは無い。私の知る範囲では、自分で作れるアカウントが無いアプリは削除の機能を求められないが、App Store Connect の説明で確かめる。
