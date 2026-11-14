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
