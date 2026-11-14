# v1160：期間一括取り込みの失敗した日（理由・もう一度取る・失敗した日だけ取り込み直す）

## 1. 依頼

Moto さん 11/13 23:04 HST：Totoya（Aiea）の期間一括取り込み 8/15〜11/13 で「45日取得 / 失敗46」。CHAZUKE は数えているのに、取り込みの状況でエラーが出る。

## 2. 前の作り（v1159）

- `syncToastDay` は hyper-worker の答えを `res.json()` で読むだけ。JSON でない答え（502 の HTML・関数の上限など）や通信の切れは投げ、`fetchToastRange` は理由を残さずに「失敗」を 1 つ数えた。
- 失敗した日は取り直さない。日と日のあいだは 250ms 固定（Toast に断られても同じ間で続けた）。
- 画面は「N日取得 / 失敗M」だけ（どの日が・なぜ、は出ない）。失敗した日があっても、L/D 列の注意が無ければ 1.8 秒で画面を閉じた。
- 失敗した日だけを取り直す道が無い（期間をまた全部取る）。

hyper-worker の側の原因（1 日ごとに Toast にログインし直す・メニューを毎回読む → Toast の回数の制限）は hyper-worker v1160（非公開）で直した（共有記録の 11/14 の節）。この版はアプリの側。

## 3. 直したこと（アプリだけ・SQL と関数は変えない）

- `syncToastDay`：通信の切れは `{ ok:false, error:'network: …' }`、JSON でない答えは `{ ok:false, error:'HTTP 502: …', _http:502 }`。答えが 200 以外なら `_http` を付ける。投げない（ほかの呼び出し元は今までどおり `r.ok` を見る）。
- 理由を分ける `toastFailKind`：
  - `limit`＝Toast の回数の制限（429・rate limit。`auth_failed` の detail が HTTP 429 のときも）
  - `auth`＝Toast にログインできない（`auth_failed`・toast login）
  - `session`＝アプリのログインを確かめられない（session_required・session_expired・（inactive）・unauthorized・forbidden・403）
  - `server`＝サーバーの一時的なエラー（5xx・WORKER_LIMIT・timeout・db_unavailable）
  - `network`＝通信が切れた
  - `db`＝DB 保存エラー（`dbError`）
  - `other`＝そのほか
- `fetchToastRange`：
  - 失敗した日ごとに理由と言葉（160 字まで）を残し、`failures: [{ date, kind, msg, skipped }]`・`retried`・`recovered` を返す（前からの `ok`・`fail`・`total`・`sumSales`・`ldMissing`・`dbError` もそのまま）。
  - Toast に断られたら（limit・auth・server・network）日と日のあいだを空ける（250ms → 3 秒 → 6 秒 → … 15 秒まで）。取れたら半分に戻す（250ms まで）。
  - アプリのログインが切れたら（session）残りの日は呼ばない（失敗・`skipped` にする）。
  - 最後に、失敗した日を 1 回だけ取り直す（limit・auth があれば 15 秒、ほかは 5 秒待ってから・1.2 秒より短い間はあけない）。session・db は取り直さない。取り直しで取れた日は成功に数える。
  - `opts.dates` を渡すと、範囲の中のその日だけを取る。`opts.noRetry` で取り直さない。
  - L/D 列が無い日（`ldSaved:false`）は日ごとに 1 回だけ数える（取り直しても 2 回にならない）。
  - 進み具合 `onProgress(done, total, ok, fail, info)`：取り直しのあいだは `info = { phase:'wait'|'retry', i, n }`（ほかの呼び出し元は 2 つ目までしか使わないので変わらない）。
- `doRangeImport`（期間一括取り込みの画面）：
  - 店ごとに「N日取得 / 失敗M（失敗した日のうち K 日は、もう一度取って取れました）」と、理由ごとの日数・失敗した日（12 日まで・ほか N 日）・最初の失敗の言葉。
  - 失敗した日が残ったら［失敗した日だけ取り込み直す（N日）］。押すと、その店のその日だけを取る（session・db の日は入れない）。
  - アプリのログインが切れたときは「ログアウトしてログインし直してから」と出す（ボタンは出さない）。
  - 失敗した日があるときは画面を自動で閉じない。
  - L/D 列の注意に SQL の場所（GitHub の `db/toast-sales-ld-columns.sql`）を足した。説明の「1日あたり約0.3秒」を「1日あたり数秒…」に。
- 版 1160（APP_VERSION・SW_BUILD）。

財務の保存の守り（FUNERGY_FINANCIAL_SAVE）は今までどおり `fetchToastRange` を 1 つの保存として包む（取り直しのあいだも同じ）。決まりは変えていない。

## 4. 任意の SQL（L/D 列）

`db/toast-sales-ld-columns.sql`：toast_sales にランチ・ディナー別の来店区分の列 6 つを足す（`add column if not exists`・既定 0・2 回流しても同じ・行は変えない）。最後の行で 6 と出れば OK。足したあと、使いたい期間を取り込み直すと数が入る。

## 5. 試験（合成データ・本物の Toast・Supabase には触れない）

- `tests/range-import-v1160.test.mjs` 10：本物のアプリの関数を VM で・偽の hyper-worker（日ごとの答えの列）。
  - 断られた日をもう一度取って保存する（v1159 は 2 日を理由なしで落とす＝fcf0502 の本物のコードと比べる）
  - JSON でない答え・通信の切れでも投げずに理由（v1159 は投げる）
  - アプリのログインが切れたら残りの日を呼ばない・取り直さない・画面の文
  - 取り直しでも失敗した日の理由・日付・ボタン → 押すとその日だけ取る → 画面を閉じる
  - DB 保存エラーは取り直さない・画面に出す
  - 理由の分け方 13 通り
  - L/D 列の日を 1 回だけ数える
  - `opts.dates` は範囲の中だけ
  - 間のあけ方（3000 → 6000 → 3000 → 1500 → 750）
  - L/D 列の SQL（PGlite で 2 回・行は変わらない・消す・直す文が無い）
- `tests/financial-web-callers.test.mjs` 8（取り出す関数に `toastFailSummaryHtml` を足しただけ）・`financial-web-save` 66。
- わざと壊す 16 通りすべてで落ちる（取り直しを外す・ログインの切れで止めない・間をあけない・理由の分け方・DB を取り直す・JSON で投げる・日の絞り込み・L/D の数え方・失敗でも閉じる・ボタン・session の日をボタンに入れる・取れた日を失敗のまま・待ちを短く・429 を見分けない・理由を出さない・通信で投げる）。
- static release pass/1160。CI に足した。
- ブラウザ・実機では見ていない（画面の文は試験で HTML を確かめただけ）。

## 6. 限界

- 理由は hyper-worker が返す言葉で分ける。v1154 以前の hyper-worker は理由の詳しさが足りないことがある（「そのほか」になる）。v1160 の hyper-worker を入れると、Toast の HTTP の番号が入る。
- 取り直しは 1 回だけ。ずっと断られる日はボタンで取り直す。
- 画面を閉じると「失敗した日だけ」の覚えは消える（メモリだけ。期間をもう一度取れば同じ日がまた出る）。
- 取り直しのぶん、取り込みの時間は長くなる（失敗した日の数 × 1.2 秒以上と、待ち 5〜15 秒）。
