# Funergy+ 審査用デモ環境（App Store 審査・5-3 の案 A）

作成：2026-11-25 16:10〜16:25 HST（Pacific/Honolulu）
Supabase：**Funergy+ App Review Demo**（ref `wjujeonfmjwvliunotuc`・Funergy Group・us-east-1・月 $10 は Moto さん承認済み）
URL：`https://wjujeonfmjwvliunotuc.supabase.co`
公開の鍵（anon）：Supabase › Project Settings › API Keys（Legacy の anon）で見る。この README には書かない。

本番 `tgbhgxzehzeouopklhje` は**読むだけ**（表・列・RLS・関数・Edge Function のコードの形だけ）。行のデータ・名前・PIN・給与は一切写していない。本番には何も書いていない。

## 1. 中身

| 場所 | 内容 |
|---|---|
| `migrations/20261125160000_review_demo_01_tables.sql` | 75 表・19 シーケンス・制約・外部キー・索引（本番のカタログから作った DDL） |
| `migrations/20261125160100_review_demo_02_functions.sql`・`..._03_functions.sql` | DB 関数 358 本（本番の `pg_get_functiondef` のまま） |
| `migrations/20261125160300_review_demo_04_security.sql` | トリガー 43 本・RLS（75 表すべて ON）・ポリシー 24・表と関数の権限（本番と同じ）・realtime（app_state・sync_signal・chat_sig） |
| `functions/auth-pin`・`secure-state`・`device-login`・`work-requests` | Edge Function 4 本（本番で今動いている版。verify_jwt はすべて OFF＝本番と同じ） |
| `seed/01_demo_data.sql` | 架空のデータ（PIN なし）。このリポジトリにある |
| （このリポジトリの外）PIN の入れ方 | `seed/02_pins.template.sql` は置かない。値のひな形は箱の外に残す |
| （このリポジトリの外）curl の確かめ | `verify.sh` は置かない。PIN・鍵・印は表示しない手順も外に残す |
| `work/` | 範囲を決めた材料（`in_scope_*`・`out_of_scope_*`・`closure.py`・`graph.json`） |
| `credentials.txt`（chmod 600） | デモの PIN。**リポジトリに入れない**（`.gitignore` 済み）。App Store Connect の審査メモ欄にだけ書く |

## 2. 範囲の決め方

入口（アプリが直接使うもの）から、本番のカタログで「関数の本文が名前を出す表・関数」「表のトリガー」「ポリシーが使う関数」「外部キーの先」をたどって閉じた集合にした（`work/closure.py`・`graph.json`・`names.json`）。

- ログイン：店を選ぶ → 名前 → PIN（`index.html` `bootLogin` 22897・`loginPickLocation` 22963・`authPinCheck`→Edge Function `auth-pin` 23142）。ログインの前に `stores`・`employees` を公開の鍵で読む。
- ログイン後の取り込み：`supaPullAllMasters` 17680（stores・employees・ingredients・recipes・vendors・categories・app_settings）・`_kvPullRows` 17522（`app_state`・RPC `app_state_index`・`ss_secret_key`）・`ssPull`（`secure-state`）。`secure-state` は印の確かめに `work-requests`（whoami）を呼ぶ。
- マイページ・保存：`app_state`（`fav_<名前>` など・REST の upsert）・`shift_availability`・`shift_plans`・`tip_labor`、`secure-state`（pv・aff・cs4・gp など）、`work-requests`（申請・チャット）。
- 端末のログイン（パスキー・メールのコード）：`device-login`（`dl_*` 表）。PIN のログインには要らないが、ログインの画面が状態を聞くので置いた。

**写さなかったもの（範囲外）**
- 表 85：invoice_* 26・gr_*（Google レビュー）・bot_*・management_*・mr_*（中間レビュー）・toast_*（売上）・pe_*（給与の経費）・bc_*（賞与の締め）・times_*・drive_oauth・onboarding_private・kv_store など（一覧 `work/out_of_scope_tables.txt`）
- DB 関数 369（`work/out_of_scope_functions.txt`）
- Edge Function 24：hyper-worker・hyper-service（Toast）・drive-sync・emp-private・ob-private・ops-bot・invoice-intake・invoice_ocr・check_ocr・mid-review・bonus-close・google-reviews・payroll-expense・discount-log・fetch-product・times-*・hq-bot-trial・bot-user-setup-once・native-*（本人用アプリ）
- 本番の別 schema（native_atomic_private・financial_web_private・native_financial_private）と、それを呼ぶトリガー 26 本（本人用アプリの記録・財務の書き込みの見張り）
- Storage のバケット（invoices など）・pg_cron のジョブ・Supabase Auth のユーザー（メールのログイン・manager_auth）

## 3. 本番の版から変えたところ

- `auth-pin`：本番のコードに書いてある**実在の店の初期 PIN の表（`DEFAULT_STORE_PINS`）を空にした**。ほかは 1 文字も変えていない。デモの店の PIN は `auth_pins` に入れてある。
- それ以外の 3 本は本番と同じ（許可の一覧に `https://funergy-plus.com` と `capacitor://localhost` が入っている版）。

## 4. Edge Function の秘密（Secrets）

`SUPABASE_URL`・`SUPABASE_ANON_KEY`・`SUPABASE_SERVICE_ROLE_KEY` は Supabase が自動で入れる。ほかは**どれも入れなくても PIN のログイン・保存は動く**（確かめ済み）。本番の値は写していない。

| 秘密 | 使う関数 | 入れないとき | ダミーでよいか |
|---|---|---|---|
| `FUNERGY_SESSION_SECRET` | auth-pin・work-requests・device-login | service role の鍵で印を作る（今この状態で動いている） | 入れるなら**新しい乱数**を 3 本に同じ値で。本番の値は使わない |
| `SS_ALLOWED_ORIGINS`・`WR_ALLOWED_ORIGINS`・`DL_ALLOWED_ORIGINS` | 各関数 | コードの既定（funergy-plus.com・capacitor://localhost）だけ | 不要 |
| `SS_WR_URL` | secure-state | 同じプロジェクトの work-requests | 不要 |
| `CHAT_VAPID_PUBLIC`・`CHAT_VAPID_PRIVATE`・`CHAT_VAPID_SUBJECT` | work-requests | チャットのプッシュ通知が出ないだけ | 入れない（審査では不要） |
| `DL_APP_URL`・`DL_MAIL_CLIENT_ID`・`DL_MAIL_CLIENT_SECRET`・`DL_MAIL_REDIRECT_URI`・`GMAIL_OAUTH_CLIENT_ID`・`GMAIL_OAUTH_CLIENT_SECRET` | device-login | メールのコード・招待のメールが送れないだけ | 入れない（ダミーだと送信を試して失敗する） |

## 5. 架空のデータ

- 店：`D01` **Demo Store (審査用)**（brand Demo）
- スタッフ：Alex Demo（g4・Store Manager）・Riley Sample（sl・Server Leader）・Jordan Example（crew）・**App Reviewer（crew・審査用）**
- PIN：全員 0000 以外の乱数（`credentials.txt`）。店の共有端末の PIN も同じ。
- サンプル：シフトの希望（11/29・12/6 の週・空の枠とメモ）・お気に入り（`fav_Alex Demo`）

やり直すとき：このリポジトリの `seed/01_demo_data.sql` をデモのプロジェクトで流す。PIN の入れ方（`02_pins.template.sql`）と確かめ（`verify.sh`）はリポジトリの外に置き、`credentials.txt` の値はそこへだけ入れる。

## 6. アプリをこの環境につなぐのに要る変更（v1219 で 1〜5 を入れた。6 は未）

`index.html` 3507–3508 の `const SUPABASE_URL` / `SUPABASE_ANON` が 132 か所から使われる 1 か所なので、ここを切り替えれば REST・RPC・Edge Function・Auth が全部デモに向く。

1. **切り替え（3507 の直前）**：`localStorage` の印（例 `fg_env==='review'`）を読み、デモなら URL を `https://wjujeonfmjwvliunotuc.supabase.co`、鍵をデモの anon に。定数のままにする（ほかは変えない）。
2. **入口（`bootLogin` 22904 の Office のカードの隣。v1221 からはログインの画面のいちばん下、プライバシーポリシー・サポートの下の「Review (Demo) / 審査用（デモ）」）**：「審査用（デモ）／Demo for App Review」のカード。押すと確認 → 端末の控えを消す → 印を立てて再読み込み。デモの中ではログインの画面の上に「審査用（デモ）・架空のデータ」の帯と「本番に戻る」。
3. **端末の控えを混ぜない**：`m_employees`・`m_stores`・app_state の写し・IndexedDB・送信待ち（outbox）は本番とデモで共有になる。切り替えるときに消す（送信待ちが残っていたら切り替えさせない）か、キーに接頭辞を付ける。
4. **組み込みの既定値を出さない**：`DEFAULT_EMPLOYEES`（8979〜・実在の名前）・`DEFAULT_STORES`（4226）・`DEFAULT_VENDORS`（8943）は、雲から読めないときの代わりに出る。デモでは空の配列にする（読めなかったときに実在の名前がログインの画面に出ないように）。
5. **デモに無い関数を使う画面**：上の範囲外の Edge Function は 404 になる（Toast 売上・請求書・中間レビュー・賞与・Google レビューなど）。デモでは入口を隠すか、エラーのままにするかを決める。
6. **iPhone アプリ側**：`funergy-native` が `native/config.js` などで接続先を別に持っているなら、そこもデモの値を選べるようにする（このセッションからは中を読めない）。

このブランチ（`claude/review-demo-entry`・v1219）で 1〜5 を入れた。印は `fg_env==='review'`。帯の文言は `Demo / 審査用 — fake data`、戻るボタンは `Return to production / 本番に戻る`。送信待ち（outbox・従業員の未送信・シフトの未送信・業者の未送信・送信中）があると切り替えない。デモでは `DEFAULT_STORES`・`DEFAULT_VENDORS`・`DEFAULT_EMPLOYEES` を空にする。隠す画面はダッシュボード・人件費・勤怠・請求・経理・仕入明細・中間レビュー・従業員割引・採用（デモに無い Edge Function の入口）。会議の中の Google 口コミなど、画面ごとには隠していないボタンは 404 のまま。6 の iPhone 側は変えていない。anon 鍵は `index.html` だけ（この README には書かない）。スキーマ・関数のコード・PIN はこのリポジトリに置かない。

## 7. 確かめたこと（2026-11-25 16:23 HST。確かめの手順 `verify.sh` はこのリポジトリの外）

- OPTIONS：secure-state・device-login・work-requests は `capacitor://localhost` と `https://funergy-plus.com` をそのまま返す。関係のないサイトには secure-state・work-requests は何も返さない。device-login は `https://funergy-plus.com` を返す（本番と同じ作り・ブラウザーは通さない）。auth-pin は `*`（本番と同じ）。
- ログインの前：stores 1 行・employees 4 行（架空だけ）。`auth_pins` は公開の鍵で 0 行（読めない）。
- auth-pin：まちがった PIN は `{"ok":false}`。正しい PIN は `ok:true` と印（153 文字）。店の共有端末も `ok:true`。
- work-requests whoami：`emp demo9・App Reviewer・staff・grade 1・stores [D01]`。secure-state pull：HTTP 200・`level proj`。
- 保存：`app_state` の `fav_App Reviewer` と `shift_availability` を REST で upsert（HTTP 201）→ 印を捨ててログインし直したあと、同じ値（時刻の印つき）が読めた。`app_state_index` にも出た。
