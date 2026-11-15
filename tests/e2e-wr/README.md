# 本物のブラウザで経費の申請を通す（合成データ・本番にはつながない）

`world.mjs` は、このリポジトリの `index.html` を配り、Supabase のふりをする模擬の世界です。

- PostgREST・auth-pin などは `tests/perf/mock-api.mjs` のまね。
- 関数 work-requests だけは本物の handler と本物の SQL（本番と同じ順の migration・PGlite）。
- PIN のログインの印は `perf-session:<社員 ID>`（PIN を確かめるコードの代わり）。
- 作りものの人：G1 Cam Crew・G2 Lee Two・G3 Sam Three・G4 Mia Four・G5 Ami Area（AM）・G6 Gabe Gm（GM）・CEO Cora Ceo・経理 Ann Acct。

## 用意（1 回）

```
mkdir -p /tmp/e2e/vendor /tmp/e2e/cert
(cd /tmp/e2e/vendor && npm init -y && npm i @supabase/supabase-js@2 @tabler/icons-webfont@2.44.0)
(cd /tmp/e2e/cert && openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 30 -subj "/CN=localhost")
npm ci --prefix tests/runtime
```

Chrome（`/usr/bin/google-chrome`・`CHROME` で変えられる）と Playwright（`/opt/npm-tools/node_modules/playwright`）が要ります。443 番で待つので root で動かします。

## 流す

```
VENDOR_DIR=/tmp/e2e/vendor CERT_DIR=/tmp/e2e/cert node tests/e2e-wr/expense-paths.mjs
```

- `WR_FIX=0`：直す前の SQL（v1162 の本番と同じ・`20261125090000` を入れない）。
- `CONFIRM=0`：GM・CEO が「承認・閲覧の権限の確かめ」をまだしていない（G2〜G5 に写しが無い）。
- `APP_DIR=<フォルダ>`：ほかの版の `index.html` を配る。

## チャット改修（v1167・UI案79）

```
VENDOR_DIR=/tmp/e2e/vendor CERT_DIR=/tmp/e2e/cert SHOTS=/tmp/ui79shots node tests/e2e-chat/ui79-v1167.mjs
```

- 同じ模擬の世界（`world.mjs`）に、チャット・添付・UI案79 の SQL を足す（`WR_UI79=1`）。置き場所（Storage）は代わりの入れ物。
- auth-pin の PIN の確かめは 9999 を違う PIN として返す（ロックを続ける試験）。
- `SHOTS` を付けると画面の写真（PC のパネル・印・別ウィンドウ・スマホの半分の画面・拡大・申請のチャットを始める・ロック）。
- Document Picture-in-Picture は HeadlessChrome でも開く（`いつも前面`）。開けない Chrome ではふつうの別ウィンドウかパネルのまま（それも通る）。


## チャットの守り（v1168・暗証番号・グループのキー・プッシュ通知）

```
VENDOR_DIR=/tmp/e2e/vendor CERT_DIR=/tmp/e2e/cert SHOTS=/tmp/guardshots node tests/e2e-chat/guard-v1168.mjs
```

- `WR_UI79=1 WR_GUARD=1`（スクリプトが付ける）：v1167 の SQL のあとに守りの SQL を足す。関数 work-requests は本物の handler（プッシュの送り先とログインの PIN の確かめだけ代わり：ログインの PIN は 1234 が正しい）。
- 完了の条件 ④ の残り：暗証番号だけ・キーだけ・両方・両方オフ・キーを変えた・忘れた・ログアウト（サーバーの印）。サーバーが断る（423）ことも。
- プッシュは本物の Chrome の Service Worker（`serviceWorkers: 'allow'`）に CDP（`ServiceWorker.deliverPushMessage`）で中身つきの push を 3 つ届け、出た通知が「新着メッセージがあります」1 つだけかを見る（push の購読そのものは送り先のサーバーにつながらないので VM の試験で）。
- PC はパネルが画面に収まるか（`body{zoom:1.1}`・v1167 の直し）も見る。
