# PC・スマホの点検の道具（合成データ・模擬サーバー）

本番にはつながない。`tests/perf/server.mjs`（模擬サーバー）と `tests/perf/gen-data.mjs`（合成データ）を使う。

## 外へのつながり

- Chromium の名前の決まり（`--host-resolver-rules`）で、本番の Supabase・jsdelivr・open-meteo の名前を 127.0.0.1（模擬サーバー）に向ける。
- それ以外の名前（googleapis・accounts.google.com・drive.google.com・api.qrserver.com など）は、v1172 から引けないようにした（`MAP * ~NOTFOUND`・localhost と 127.0.0.1 は除く）。外には出ない。
- プロキシの環境変数は外して流す。Supabase のホストの名前を変えたら `crawl.mjs`・`shot.mjs`・`navprobe.mjs` の `ARGS` も直す。

## 置き場所

- 作業の場所：`PCSP_DIR`（初めは `/tmp/pcsp`）。
- そこに置くもの：`data.json`（gen-data の出力）・`names.json`・`modals.json`・`pages.txt`。後の 3 つは index.html から抜き出したもの（このフォルダに写しがある）。
- Playwright は `/opt/npm-tools/node_modules/playwright/index.mjs` を直接読む（この環境だけ）。ほかの環境ではこの行を直す。

## 流す順番

`finalize.mjs`・`mapmodals.mjs` はいまのフォルダで読み書きする。そのため `cd "$PCSP_DIR"` してから、リポジトリの道具を絶対パスで流す。リポジトリの中には何も書かない。

1. 模擬サーバー：`node tests/perf/server.mjs`（`APP_DIR` に index.html と sw.js）。
2. `crawl.mjs`：`WIDTH=1440 WHO=gm STORE=ALL PAGES=$(cat pages.txt) MODALS=1 node <repo>/tests/perf/pcsp/crawl.mjs gm-1440-ALL.json`
   - 画面・タブ（2 段まで）・箱を開いて測る（幅・高さ・横のはみ出し・表・押すところ・文字）。
   - `TOUCH=1` でタッチの端末（iPad など）。
   - 書きながら進むので、終わったかはログの最後の行で見る。
3. `navprobe.mjs`：上のバー・グループのナビ・ページのナビ・チャットの丸いボタン・ログイン画面（GM・G3・G1 × 390・768・1440）。`nav.json` に書く。
4. `analyze.mjs <1440 の json> <390 の json> …`：測った値を点検一覧の行にする。標準出力を `rows.json` にする。
5. `mapmodals.mjs`：箱をどの画面から開くかをコードからたどる（`modal_pages.json`）。
6. `finalize.mjs`：共通の行・開いていない箱（未検証）を足して `inventory.csv` にする。

## 前・後と更新

- `shot.mjs` と `proto.css`・`proto.js`：代表の画面の前・後の画像。UI案82 の試作で、案の CSS と箱の大きさを差し込む。
- `update_v1172.mjs <今の CSV> <1440 の json> <390 の json>`：v1172 のあとに流し直した GM の結果で、点検一覧の「現状の問題」「対応状況」「検証結果」を書き直す（標準出力に新しい CSV）。
- `navcheck.mjs`（v1172）：ナビの印（端がうすいか）・今の場所が見えるか・押せる高さ（`--ht`・`--hb` を足した高さ）・上の店の切り替え（GM・G3・G1 × 390・768・1440。390・768 はタッチ）。`cd "$PCSP_DIR" && node <repo>/tests/perf/pcsp/navcheck.mjs` → `navcheck.json`。
- `update_v1172.mjs` の決まり：「文章・短いフォーム」の画面（`index.html` の WIDE・STD に無い画面）の幅 900px は共通の決まり 1 どおりなので問題に数えない。入力も表も無い箱の「スマホ用の小さな箱」も数えない。名前の列を固定しない表（結合したセル・最初の列が枠の 45% より広い）は検証結果に書く。
- `tests/e2e-pcsp/hit-position-v1172.mjs`：押す範囲を広げても absolute・fixed・sticky の位置が変わらないこと（散布図の点など）を本物の Chromium の CSS で確かめる。模擬サーバーは要らない（index.html の `<style>` と FUNERGY_LAYOUT を白紙のページに入れる）。
