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
- `tests/e2e-pcsp/labor-ui83-v1173.mjs`（v1173）：予実 › 人件費・勤怠（UI案83）を模擬サーバーで確かめる（GM・1440 日本語・1024 英語・390 日英）。模擬サーバーを立ててから `node tests/e2e-pcsp/labor-ui83-v1173.mjs`。
- `boxes-v1177.mjs`（v1177）：点検一覧で「開いていない」だった箱 24 個を、画面を回って（無ければ式で直接・仕入れと結果報告は合成の値をそのページだけに入れて）開き、幅・小さい文字・箱の中のはみ出し・押すところを測る。`cd "$PCSP_DIR" && WIDTH=1440 node <repo>/tests/perf/pcsp/boxes-v1177.mjs boxes-1440.json`（390 も）。
- `tests/e2e-pcsp/ui85-v1177.mjs`（v1177）：予実の残り・ダッシュボード（UI案85）を模擬サーバーで確かめる（GM 1440 日本語・1024 英語・390 日英、G3 1440・390）。`SHOTS=<フォルダ>` で画像も撮る（確かめのあとで撮る。スマホの形で全体を撮ると Chrome の文字の自動拡大が効くため）。
- `tests/e2e-pcsp/loc-v1196.mjs`（v1196）：左上の店・1 つの木・経理センターの入口とログイン直後（`docs/UNIFIED_UI_V1191_JA.md` の 19）を、模擬サーバー（`SS_REAL=1`＝本物の関数 secure-state）で確かめる（GM・事務Crew・店の SL × 1440・390 × 日英、確かめていない経理）。合成データに確かめた所属（`aff_people`）とマスターの所属を足してから流す（手順はファイルの先頭）。`SHOTS=<フォルダ>` で画像も撮る。
- `tests/e2e-pcsp/acct-tabs-v1199.mjs`（v1199）：経理センターの 7 つの中タブ（`docs/UNIFIED_UI_V1191_JA.md` の 22）を、模擬サーバーで確かめる（事務Crew・経理・GM × 1440・390 × 日英。どの中タブも開ける・事務Crew に経理出力が無い・経理ホームの打刻と外した入口・「出勤中」のタイル）。データは loc-v1196.mjs と同じ。`SHOTS=<フォルダ>` で画像も撮る。
- `tests/e2e-pcsp/acct-list-v1200.mjs`（v1200）：経理レビュー › 確認する（1 つの一覧・`docs/UNIFIED_UI_V1191_JA.md` の 23）を、模擬サーバーで確かめる（経理・事務Crew・GM × 1440・390 × 日英。確認待ちで開く・前の画面の記録は初めは出さない・書類の行から確認の箱・区分・承認も今までどおり）。模擬サーバーには申請の関数が無いので申請の行は出ない（単体の試験で確かめる）。`SHOTS=<フォルダ>` で画像も撮る。
- `tests/e2e-pcsp/acct-intake-v1201.mjs`（v1201）：③ インボイス取り込みの明細・前の経路の書類と、経理センターの中の画面の描き直し（`docs/UNIFIED_UI_V1191_JA.md` の 24）。経理・事務Crew・GM × 1440・390 × 日英。`SHOTS=<フォルダ>` で画像も撮る。
- `tests/e2e-pcsp/mypage-v1203.mjs`（v1203）：マイページの 6 つの段（`docs/UNIFIED_UI_V1191_JA.md` の 27）を、模擬サーバーで確かめる（G1・G2・G3・G4・AM・GM・Head Chef・経理・事務Crew × 1440・390 × 日英。G1 は今のまま・段の順・PC の 2 列・帯の従業員証明・② の 1 つの申請のカード・公開済みのシフトの ① と ③・幅をまたいだ描き直し）。データは loc-v1196.mjs と同じ。`SHOTS=<フォルダ>` で画像も撮る。`ONLY=gm,sl` で人を絞れる。
- `tests/e2e-pcsp/mypage-punch-v1204.mjs`（v1204）：マイページ ① の本部の打刻（`docs/UNIFIED_UI_V1191_JA.md` の 27b）。Head Chef・経理・事務Crew（と出さない GM・AM・G3）× 1440・390 × 日英。押してもマイページのまま・サーバーの同じ記録・新しい端末でも 2 つ目の出勤を作らない・経理の端末で Head Chef の本部タイムカード。データは loc-v1196.mjs と同じ。
