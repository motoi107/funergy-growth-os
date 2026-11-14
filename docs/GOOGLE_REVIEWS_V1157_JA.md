# Google の口コミ v1157（UI案73）

会議の「Googleレビュー」のカードと、KPI の Google の欄（その月の平均・件数・総合評価）を、手入力から Google のデータに変える。Moto さんの答え（11/13 18:42 HST）：1 はい・2 はい「API 繋ぐまでは手入力」・3 はい「どの投稿も出してください」・4 はい。入れる手順：`deploy/google-reviews-v1157/手順.md`。

## 1. 決まり（UI案73 の答え）

| 番号 | 答え | 作り |
|---|---|---|
| 1 | 毎日取る | Business Profile の口コミを毎日 4:30（ハワイ）に取る（cron `30 14 * * *` UTC）。GM・CEO は「今すぐ取る」でも取れる |
| 2 | API をつなぐまでは手入力 | Business Profile で口コミを**初めて取り終えるまで**は、今までどおり KPI の手入力（gAvg・gCnt・reviewScore・gTotalCnt）。初めて取り終えたら、**その前の月（ハワイ）から**自動。それより前の月は手入力のまま |
| 3 | その月の口コミをすべて会議に | 星だけの口コミ・名前なしも含めて全部。新しい順。5 件より多いときは「すべて広げる」 |
| 4 | 設定は KPI設定の中 | KPI設定 ›「Google の口コミ」タブ。決める・つなぐのは GM・CEO だけ。ほかの人は見るだけ。店のタブレットには出さない |

## 2. Google の 2 つの API と決まり

- **Business Profile API**（自分の店のデータ）：口コミを全部取り、サーバーに残す（`gr_reviews`）。月は**ハワイ時間の投稿日**（UTC の 11/1 でもハワイで 10/31 なら 10 月）。会議の実績（その月の平均・件数）はここから。Google の審査（最大 14 日）が要る。審査が通るまでは「審査待ち」（つなぐことはできるが口コミは取れない＝手入力のまま）。
- **Places API（新）**：店の総合評価・件数・Google が返す最近の口コミ（最大 5 件）を、**見るときに取る**。Google の決まりで**残してよいのは place ID だけ**なので、評価・口コミはサーバーにも端末にも残さない（`gr_places` の列は店・place ID・決めた人と時刻だけ）。口コミを書いた人へのリンク（https だけ）と Google のリンクを出す。
- Business Profile に総合評価があるときは Places を呼ばない（Places は Google Cloud の請求に入る）。Places は 1 人 1 分 30 回まで。

## 3. サーバー

- SQL `supabase/migrations/20261122090000_google_reviews.sql`（ほかの SQL の前提なし。2 回流しても同じ・worker の鍵は変わらない）。
- 表 7：`gr_settings`（worker の鍵）・`gr_places`（店 → place ID）・`gr_bp`（Business Profile のつなぎ・1 つだけ・refresh token はサーバーだけ）・`gr_oauth`（ログインの state のハッシュ・10 分・1 回だけ）・`gr_bp_loc`（店 → Business Profile の店・総合評価・最後に取れた時刻・取り始めの月 `from_ym`）・`gr_reviews`（口コミ）・`gr_runs`（取り込みの記録）。
- どの表も RLS ON・公開の鍵（anon・authenticated）では読めない・書けない。関数 `gr_*` 19 個（どれも security invoker・サーバーの鍵だけ。PUBLIC にも出さない）。
- 取り始めの月 `from_ym`：その店の口コミを**最後まで取り終えたとき**（`done`）だけ、まだ無ければ入れる（前の月。読めない値・先の月は今の月）。結び直すと消える（新しい店はまた手入力から）。自動の店＝つながっていて `from_ym` がある店。
- 結び直し：前の店の口コミと総合評価は残さない。取っているあいだに結び直されたら、その店には何も書かない（`conflict`）。口コミの名前は結んだ店の下のものだけ。
- Edge Function `google-reviews`（`supabase/functions/google-reviews/handler.mjs`・依存なし）：
  - だれか：本文の PIN の印（`pin_session`）を関数 work-requests の whoami に確かめてもらう（PIN を確かめるコードは入れない）。確かめられない（503・通信の失敗）は 503、断られたら 401。店のタブレットは 401。
  - 頼み：`whoami`・`status`・`kpi`・`month`・`places_now`（だれでも）／`places_search`・`places_set`・`bp_connect`・`bp_locations`・`bp_link`・`bp_disconnect`・`sync_now`（GM・CEO）。
  - Google のログイン：PKCE（S256）・`access_type=offline`・スコープ `business.manage` と `userinfo.email`。戻り（GET）は state で照らし、アプリへ `?google_bp=ok|pending|denied|bad_state|scope_missing|no_refresh_token|…` で戻す。
  - 毎日の取り込み（`worker`）：鍵は `x-gr-worker-key`（`gr_settings.worker_key`）。初めての店は前の月の初め（ハワイ）から、そのあとは最後に取れた時刻の 3 日前から。新しく直された順にさかのぼり、さかのぼりきったら止める（1 店 20 ページ＝1,000 件まで）。
  - 鍵（Places の API キー・refresh token・クライアントの秘密）は答えに出さない。ほかのサイト（Origin）からは 403。

## 4. アプリ（v1157）

- モジュール `FUNERGY_GR`（index.html・チャットのあと）。ログインの 3.5 秒あとに `kpi` を読む（10 分は聞き直さない）。読めたら会議を裏で描き直す。
- 会議のカード（`_meetGoogleCard` の先頭）：
  - 自動の店・月：「自動（Google）」・その月の平均（会議の実績）・Business Profile の総合評価・**その月の口コミすべて**（文字として描く・返信済み・星だけ・名前なし）。「入力する」は出さない。
  - Business Profile の無い店：今までどおり手入力の値と「入力する」。place ID を選んであれば Places の総合評価と最近の口コミ（その場で取る）。
  - 取り始めの前の月：手入力。
- KPI の行・年の表：自動の店・月は Google の平均（`grMonthOf`）。手入力の欄（KPI設定 › 実績入力）は自動の月だけ Google の 4 つを出さない（ほかの手入力 KPI は残す）。
- KPI設定 ›「Google の口コミ」：つなぎ方（① Places・② Business Profile・状態・最後に取れた時刻）と店ごとの表（Google の店・Business Profile の店・総合評価・今月の平均）。スマホ（820px 以下）は各欄に名前を付けて 2 列。
- この端末には何も残さない（localStorage・IndexedDB・共通データに書かない）。ログアウトで捨てる（世代 `G.gen`。遅れて届いた前の人の答えは使わず、操作の答えなら「途中で別の人のログインに変わったので止めました」）。
- Google のログインから戻ったとき：アドレスの結果を 1 回だけ読んで消し、PIN でログインしたあとに知らせる。GM・CEO は「Google の口コミ」タブへ。

## 5. 試験（合成データ・本番に接続していない・Google は偽物）

- `tests/google-reviews-server-v1157.test.mjs` 8：本物の SQL（PGlite）と本物の handler。SQL 2 回・公開の鍵で表も 19 の関数も使えない／だれか（代わり・本物の work-requests の道：503・通信の失敗・401・200）／Places（ID だけ残す・最大 5 件・https のリンクだけ・1 分 30 回・鍵を出さない）／ログイン（PKCE・state 1 回・10 分・断られた・refresh token なし・許可が足りない）／毎日の取り込み（ハワイの月・全ページ・2 回目は同じ・3 日前から・審査待ち・取り消された・鍵）／自動になるとき（取り終えてから・前の月から・途中まででは決めない・先の月は今の月・結び直し・切る）／取っているあいだの結び直し（何も書かない）。
- `tests/google-reviews-app-v1157.test.mjs` 8：index.html の FUNERGY_GR を VM で動かし、本物の handler と PGlite につなぐ。つなぐまでは手入力・初めて取り終えた前の月から自動／カードに口コミすべて（エスケープ）／Places はその場だけ／KPI設定（GM・Crew・店のタブレット）／ログインからの戻り／ログアウトのあとの答え／関数・SQL がまだ。
- `tests/google-reviews-deploy-v1157.test.mjs` 5：入れる一式の SQL と関数が元と同じ・鍵が入っていない／①②③ の初めての流れと 2 回目／① の STOP／③ が RLS・権限・security definer・関数・表の欠けに気づく／⑤ の cron（4:30 HST・鍵を表から）と止める SQL。
- わざと壊す（コピーした木で 1 つずつ）44 通りのうち 41 で落ちる。残り 3 は二重の守り：`from_ym` を毎回送る（SQL がまだ無いときだけ入れる）・アプリの書いた人のリンクの確かめ（サーバーが https だけにする）・アプリのログインの URL の確かめ（サーバーが Google の URL を作る）。
- 画面の形（Chrome・本物の index.html の CSS と合成の口コミ）：390・360・1280px で横スクロールなし・枠からはみ出す要素なし（長い英字・長いリンク・長い名前も折り返す）。

## 6. 限界

- Business Profile の審査が通るまで（最大 14 日）口コミは取れない。そのあいだは手入力のまま。
- 自動になるのは初めて取り終えた月の**前の月**から。それより前の月は手入力のまま（前の月の初めより前に投稿・直された口コミは取らない）。
- 口コミが消された・非公開にされたことは、さかのぼる範囲（最後に取れた時刻の 3 日前から）の外では気づかない（数が残ることがある）。
- Places の総合評価・口コミはその場で取るだけ（Google の決まり）。開くたびに Google に聞く（費用・1 人 1 分 30 回まで）。
- つなぐ Google アカウントは 1 つ（すべての店をそのアカウントで管理している前提）。
- 実機（iPhone）・本物の Google・本番のデータでは確かめていない。
