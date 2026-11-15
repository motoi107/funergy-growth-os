# PC・スマホの点検の道具（合成データ・模擬サーバー）

本番にはつながない。`tests/perf/server.mjs`（模擬サーバー）と `tests/perf/gen-data.mjs`（合成データ）を使う。

- 作業の場所：`PCSP_DIR`（初めは `/tmp/pcsp`）。`data.json`（gen-data の出力）・`names.json`・`modals.json`・`pages.txt` を置く（この 3 つは index.html v1171 から抜き出したもの・このフォルダに写しがある）。
- `crawl.mjs`：`WIDTH=1440 WHO=gm STORE=ALL PAGES=$(cat pages.txt) MODALS=1 node crawl.mjs` で、画面・タブ（2 段まで）・箱を開いて測る（幅・高さ・横のはみ出し・表・押すところ・文字）。
- `navprobe.mjs`：上のバー・グループのナビ・ページのナビ・チャットの丸いボタン・ログイン画面（GM・G3・G1 × 390・768・1440）。
- `analyze.mjs`：測った値を点検一覧の行にする。`mapmodals.mjs`：箱をどの画面から開くかをコードからたどる。`finalize.mjs`：共通の行・開いていない箱（未検証）を足して `inventory.csv` にする。
- `shot.mjs` と `proto.css`・`proto.js`：代表の画面の前・後の画像（案の CSS と箱の大きさを差し込む・試作）。
