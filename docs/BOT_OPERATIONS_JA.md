# Funergy＋業務Bot

経理センター → 業務Bot。管理者メール認証後に共有案件を表示。既存の管理者用画面にも同じBotタブを置く。取得済みデータのローカル下書きは既存判定を直接使用する。

## 実装と運用

- ops-bot Edge Function。通常操作はSupabase Authのユーザー確認と既存manager_authの役割で認可。PINやクライアントのroleだけでは共有データを返さない。
- bot_* テーブルのみへ保存。RLSと権限剥奪でanon/authenticatedの直接アクセスを拒否。service-only SECURITY INVOKER RPCで案件更新と監査記録を同一トランザクションにする。
- LINE受信は生の本文バイトでHMAC署名検証。受信イベントIDで重複を防ぐ。未知グループはIDのみ登録し、会話は取り込まない。GM/CEOが店舗へ紐付けたグループで、先頭「発注依頼」「/order」「order request」のテキスト、またはB-…案件番号付き返信だけを取り込む。画像・音声・一般会話の自動理解は含まない。
- 修正返信はverifyへ移動し、完了にはしない。Toast GUIDを直接取得し、既存判定、同一従業員の同日の新しい打刻、重複、手動補正を照合。移動・削除・欠落・未退勤・異常継続は自動完了しない。経理の確認による完了は理由必須で別イベント。
- LINE送信はGM/CEO/経理が宛先と本文を確認して押したときだけ。outboxとX-Line-Retry-Keyで不明結果の再確認を同じ送信として行う。23時間超過や結果不明はLINE履歴で人が確認し、記録して解除。送信受付は既読・配達確認とは異なる。
- 発注依頼には商品ページURLと数量を保存し、権限者が承認。商品ページへ移動し、人が注文後に注文番号を記録する。Amazonカート作成・自動注文は未対応（Amazonアカウント/連携方式は経理確認待ち）。
- 新規Toast取得は既存hyper-workerと集計テーブルを変更しない。時刻判定は生成コピー。Toast直接取得では従業員GUIDで集約し、氏名の部分一致はしない。これにより既存画面の名寄せ結果とは異なる場合がある。時間クリップ・Tip分割はshifts自体を変更しないことをソースで確認した。手動補正は削除せず警告し、自動完了を止める。端末内の未同期補正までサーバーから確認できる保証はない。
- 勤務中の可能性を残す未退勤は「勤務継続か打刻漏れか確認」として案件化。退勤漏れと断定しない。既存の確実/疑い判定・12時間・Hawaii -10h・判定順序は維持。
- 全体のclock設定はGM/CEOが既存の設定を確認して初回適用する。公開後はアプリも同じ設定を読み、変更は認証してサーバーへ保存後に反映。匿名経路に公開するのはこの4設定だけ。
- 自動取得は初期OFF。GM/CEOが有効にすると毎日08:40から店舗を1分ずらして前営業日の勤怠/Voidを取得し、修正報告済み勤怠を最大10件/店で再確認。トークンはDBのservice-only設定で保持し、cronから参照。自動送信はない。店舗追加時はschedule SQL再適用が必要。
- 一覧は最新200案件、案件履歴は最新100イベント。古いデータは削除しない。

## LINE接続の残る手作業

SupabaseのEdge Functions → SecretsへLINE_CHANNEL_SECRETとLINE_CHANNEL_ACCESS_TOKENを設定する。既に画面で共有されたChannel secretは再発行した値を使用。チャット、公開リポジトリ、ブラウザコードへ値を書かない。

Webhook URL:
https://tgbhgxzehzeouopklhje.supabase.co/functions/v1/ops-bot?route=line

LINE Developersで上記URLを設定し、Webhook検証、Webhook利用、再送を有効にする。テストグループにBotを追加し、Funergy＋でグループを店舗に紐付ける。接続情報の存在だけでは、Webhook設定や配達成功の証拠にはならない。

## 検証・公開

node --test tests/bot-center.test.mjs tests/bot-server.test.mjs
npm ci --prefix tests/runtime
node --test tests/bot-database.test.mjs
python3 scripts/check-static-release.py

DBテストはローカルPGliteの合成データのみ。bot SQLを適用し、重複・ロール・楽観ロック・同時返信・承認条件・再確認を実行する。本番検証で業務データを書き換えない。

デプロイ順: DB schema → ops-bot（JWTゲートOFF、関数内でユーザーJWT/LINE署名/worker keyを個別検証）→ cron（初期OFF）→ index.html/sw.js。verify_jwtをOFFにするのは署名付きLINE webhookを受けるためで、アプリ操作の認証は省略しない。
