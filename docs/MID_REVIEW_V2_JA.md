# 中間レビュー v2（段階 4・UI案44 B案）の仕様

Moto さんの「追加修正プロンプト」（10/12）と UI案44 の回答（10/12 07:49 HST）で決まったこと。前の仕様（`docs/MID_REVIEW_JA.md` の段階 2）と食い違うときは、こちらが優先。店舗公開・通知は OFF のまま。

## 決まったこと（Moto さん）

- 画面は B案。1 枚のカードで「結果 → 担当者評価 → 対策 → 返信」。達成している項目もいつも全部出す。どの欄にも「必須」「任意」を出す。カードの色は達成＝緑・注意＝茶色・未達＝赤（当月の原価率は灰色の参考）。
- 流れは ① 前月の振り返り ② 今月の進捗 ③ 重点項目（Qコミット）④ 相談・支援依頼 ⑤ 確認・提出。
- PIN のログインで、全員が閲覧・入力・返信できる。担当・閲覧設定の変更（GM・CEO）だけはメールの認証。
- Head Chef・Corporate Chef は全店を見られる。見られる人は GM・CEO が設定で決める（最初は Chikayoshi Nishihara さん）。社員の表は候補を出すのと、外す（退職・役職が変わった）ためだけに使う。
- 重点項目は項目ごとの期限を持たない（中間レビューの提出期限を使う）。全項目が必須（進捗状態・実施したこと・残っていること・次の対応・担当）。
- 当月の判定不可（目標未設定・未取得）は必須にしない。
- 本番の Qコミットへの反映は、非公開のあいだはしない（デモで確かめる）。店舗公開のときに ON。

## 1. 人と入り方

| 役割（`mr_members.role`） | 誰 | 足し方 | 外れ方（サーバーが毎回確かめる） |
|---|---|---|---|
| `ceo`・`gm` | manager_auth の CEO・GM | 入れたときに自動・add-member | manager_auth で CEO・GM でなくなる（狭いほうの役職・v1068） |
| `am` | 社員の表で AM の人 | add-member（SQL） | 社員の表で AM でない・退職 |
| `chef` | Head Chef・Corporate Chef | GM・CEO が担当・閲覧設定で足す | 社員の表で退職・Head Chef／Corporate Chef（役職 chef か肩書き）でなくなる |
| `staff` | 入力担当に選んだ G3・G4 | GM・CEO が入力担当に選ぶと自動 | 社員の表で退職。どの店・月の入力担当でもなくなると何も見えない |

- 入り方は 2 つ。サーバーがどちらか一方を確かめ、`via`（`email`・`pin`）を決める（画面から送られた値は使わない）。
  - メール：今までどおり（Supabase Auth）。`actor` は Auth の利用者 ID。
  - PIN：auth-pin が PIN の照合に通ったときに返す「ログインの印」（`window._hwSession`）を本文の `pin_session` で送る。関数は印を確かめ（`verifyPin`：auth-pin と同じ鍵・形。auth-pin の中身はリポジトリに置かない）、印の人（社員）を `mr_members.emp_id` で引く。印が出るのは PIN を自分で設定した人だけ。
- PIN だけの人（chef・staff など Auth のアカウントが無い人）の `mr_members.user_id` は、作るときにサーバーが作る番号（Auth の利用者ではない）。メールのログインでは使われない。
- 社員 1 人に `mr_members` は 1 行（`emp_id` が同じ有効な行は 1 つまで）。
- 担当・閲覧設定の保存・デモを作る・非公開確認の ON／OFF は `via='email'` の GM・CEO だけ。PIN の GM・CEO はほかのこと（閲覧・返信・確認完了・期限の変更）はできる。

## 2. 見られる店・できること（実効の権限・`mr_can`）

店 `s`・月 `ym`・入力担当 `inp`（その月の指定。無ければ店の基本の入力担当）について：

- **閲覧**：デモの店は利用者全員。本番の店は、CEO・GM・chef は全店／AM は今までどおり（担当の写しと店舗マスターの AM 欄の両方）／店の「個人で足した閲覧者」（AM・chef のどれか）／その月の入力担当。
- **入力・提出**：その店・その月の入力担当（`mr_members.emp_id = inp`）。デモの店は利用者全員（体験。押した人の名前が残る）。本番の店は設定 `flags.live_input` が ON のときだけ（初期は OFF）。
- **管理側の返信**：閲覧できて、役割が chef・am・gm・ceo。入力担当でもこの役割なら返信できる（画面で「報告を書く」と「返信する」を分ける）。
- **補足**（入力担当が同じスレッドに書く）：入力ができる人。
- **確認完了・取り消し**：閲覧できる am・gm・ceo（chef はしない）。取り消しは gm・ceo。
- **期限の変更**：gm・ceo（PIN でもよい）。
- **担当・閲覧設定**：gm・ceo かつ `via='email'`。
- 入力担当が未設定の店は「入力担当：未設定」と出し、だれも入力できない（本番）。

## 3. 記録（本文 v2）

`mr_reviews.body`（`v: 2`）：

```
{ v: 2,
  prev: { sales|guests|ppa|repeat|labor|fc: { eval: 1..5|null, comment: '', improve: '' } },
  cur:  { sales|guests|ppa|repeat|labor: { eval: 1..5|null, comment: '', measure: '', cause: '', investigating: false, inv_check: '', owner: '', due: '' } },
  focus: { <Qコミットのキー>: { status: 'ok'|'late'|'done'|'help'|'', done: '', remaining: '', next: '', owner: '' } },
  consult: 'yes'|'none'|'',
  issues: [ { id, what, ask, proposal, ask_by, severity: 'low'|'watch'|'high' } ] }
```

- 担当者評価は 1 問題あり・2 改善が必要・3 注意が必要・4 概ね問題なし・5 問題なし。最初は null（未選択）。実績の判定とは別に保存し、互いに決めない。
- 当月の原価率（`cur.fc`）は持たない（送られても捨てる）。
- 文の長さ：comment・measure・cause・done・remaining・next 400 字、improve・inv_check・ask・proposal 400 字、owner 60 字、what 200 字。日付は `YYYY-MM-DD`（20xx・実在する日）か空。

提出のときの数字（`snapshot`・v2）：画面が会議タブと同じ関数で作り、提出版に残す。

```
{ v: 2, period: { from, to }, updated,
  prev: { ym, state: 'final'|'prov'|'none', at, rows: { <6 KPI>: { act, tgt, unit, judge } } },
  cur:  { rows: { <5 KPI>: { act, tgt, unit, judge } }, fc_ref: { act, tgt, judge } | null },
  focus: { y, q, keys: [..], rows: { <key>: { label, mode: 'auto'|'manual', now, prev, unit, lower } } },
  thresholds: { <KPI>: { green, yellow } } }
```

`judge` は `ok`（達成）・`warn`（注意）・`miss`（未達）・`unset`（目標未設定）・`missing`（未取得）。

## 4. 提出に要るもの（サーバーと画面で同じ・`mr_missing_v2`）

- 前月（`prev.state = 'final'` のとき）：6 KPI のうち `judge` が ok・warn・miss のものは `eval` と `comment` が必須。unset・missing は「評価保留」。`state` が final でなければ 6 つとも評価保留。
- 当月：5 KPI のうち `judge = miss` は `eval` と `measure` が必須。ok・warn・unset・missing は任意。
- 重点：`snapshot.focus.keys` の全項目で `status`・`done`・`remaining`・`next`・`owner` が必須。キーが無い（Qコミット未設定）なら何も要らない。
- 相談：`consult` は yes か none。yes なら相談が 1 件以上、どの相談も `what` と `ask` が必須。
- 期限・任意の欄は空でよい。
- 足りないものの印：`prev:<kpi>:eval`・`prev:<kpi>:comment`・`cur:<kpi>:eval`・`cur:<kpi>:measure`・`focus:<key>:<欄>`・`consult`・`issue:<id>:what|ask`。
- 評価保留の数（`holds`）は確認側に出す。保留があるうちは「全項目レビュー済み」にしない。

## 5. 返信（スレッド）

- 対象：`prev:<kpi>`・`cur:<kpi>`・`focus:<key>`・`issue:<id>`・`review`（全体）。
- 1 件ずつすぐ送る（下書きは持たない）。同じ人が何件でも。前の返信は書き換えない・消さない（履歴）。
- 種類：`reply`（管理側：chef・am・gm・ceo）・`note`（入力担当の補足）・`done`（対策の実行完了：入力担当か管理側）。
- 欄：本文 1〜1000 字（必須）・対応・判断（任意：提案どおり／修正／追加確認／上位判断／個別相談／対応不要）・期限（任意）・どの提出版への返信か（`sub_no`）・書いた人・そのときの役割・日時。
- 二重送信を防ぐ：画面が作る `client_id`（UUID）。同じ `client_id` は 1 件だけ。
- 順番の決まりは無い（AM の前に GM も書ける）。返信の有無は提出・確認完了の条件にしない。返信で担当者の評価・コメントは変わらない。

## 6. 状態と期限

- 下書き → 提出済み（提出版 1, 2, …）→ 確認完了。確認完了までは入力担当が直して出し直せる（前の提出版と、そこへの返信は残る）。確認完了のあとは入力できない。gm・ceo が取り消せる。
- 確認完了は返信の有無・期限で止めない（評価保留・足りないものが残る提出版でも、確かめたうえで完了にできる。画面に数を出す）。
- 期限は `submit`・`reply` の 2 つ。どちらも任意・初期値なし。過ぎていて未提出（未返信）のときだけ「期限超過」。日付はハワイ時間。
- 前の版の項目（PL の 3 行・判断の予約・追加確認の待ちなど）は v2 では使わない。v1 の本文の店は「前の形の記録」として読むだけ。デモは作り直す。

## 7. 担当・閲覧設定（GM・CEO・メール）

- 店ごとの基本：入力担当（社員 1 人・G3／G4 の店の責任者・AM・GM から）・個人で足す閲覧者（AM・Head Chef／Corporate Chef から）。
- 月ごと：その月だけの入力担当（空なら基本どおり）。前の月の報告者・返信者の記録は変えない。
- Head Chef・Corporate Chef（全店）：足す・外す。候補は社員の表で役職 chef か肩書き Head Chef・Corporate Chef の在籍者。
- 選べる入力担当：社員の表の在籍者で、肩書きが Server Leader・Kitchen Leader・Operation Leader・Store Leader（G3）・Store Manager・Head Chef（G4）、または役職 am・gm（肩書き Area Manager・General Manager）。
- 画面に、店・月ごとに一人ひとりの実効の権限（閲覧／入力・提出／管理側返信／設定変更）と理由を出す（サーバーが計算）。

## 8. 一覧の数（混ぜない）

店ごとに：状態・入力担当・提出版・未達の KPI（当月）・担当者評価 1・2 の数・対策あり・相談・未返信の項目（未達・評価 1／2・重点の遅延／支援必要・相談のうち、最新の提出版のあと管理側の返信が 1 件も無いもの）・評価保留・Qコミット（順調・遅延・完了・支援必要の数）・期限超過。

## 9. 会議タブとのつながり

- 数字は会議タブと同じ関数（`keyKpiStats` → `_meetApplyPl` → `meetingBudgetKpi` → `_meetKpiRows`、判定は `_meetStatus` と会社の閾値、前月の確定は `_meetConfirmState`）。当月は前日までと同じ期間の進捗予算。
- 重点は Qコミット（`q_budgets` の店・四半期の `focusItems`）のキーで結ぶ。進み具合は `qcFocusRows`。
- 反映：提出版の重点の内容を、会議タブの重点の記録（`focusNotes[key]`）に 1 件足す形。**非公開のあいだはデモだけ**：中間レビューの画面に「会議タブの重点カード（デモ）」を会議タブと同じ作りで出し、反映を確かめる。本番の `q_budgets` には書かない。
- 各 KPI・重点から「会議タブで見る」で、その店・その月の会議タブを開く。

## 10. 入れ方（Moto さん・この版）

手順と貼るファイルは `deploy/mid-review-v2/`（`手順.md`）。本番に v1069 が入っている前提（10/12）。auth-pin（PIN の回数の制限を足した版）は 10/12 に入った。貼るものはすべて全文をそのまま。

1. `1_最初に確認.sql`（＝`db/mid-review-precheck.sql`）→ すべて OK。
2. 関数 `mid-review` を 1 ファイルで差し替え（PIN の印の確かめが入るので公開しない。Moto さんに直接渡す）。Verify JWT は OFF のまま。
3. `2_追加のSQL_v2.sql`（＝migration `20261015090000_mid_review_v2.sql`）。
4. `3_確認のSQL_読むだけ.sql`（＝`db/mid-review-postcheck.sql`）→ `mid-review v2 (20261015090000)` が OK。
5. PR #50 をマージ（アプリ v1072）。
6. GM・CEO がメールでログインして担当・閲覧設定（Head Chef・入力担当）を保存。デモを作り直す。

2〜5 のあいだは中間レビューの画面が使えない（ほかの画面は変わらない）。止めるときは画面で非公開確認を OFF、画面が開かないときは `db/mid-review-stop.sql`（＝`止める.sql`。記録・設定は消さない）。

## サーバーの実装（段階 4-1・ブランチ `claude/mid-review-v2`・本番未反映）

画面（`index.html`・`sw.js`）は変えていない（段階 4-2 で作る）。合成データだけで試した。

### 作ったもの

- migration `supabase/migrations/20261015090000_mid_review_v2.sql`：v1066・v1068 の上に流す。行が入っていても使え、2 回流しても同じ。社員の表に `title` が無いとき、同じ社員の有効な利用者が 2 行あるときは、何も変えずに止まる。
  - 利用者（`mr_members`）：役割に `chef`・`staff`。PIN だけの人の番号はサーバーが作る（Auth の利用者ではない）。社員 1 人に有効な行は 1 つ。
  - 外れ方（サーバーが毎回）：CEO・GM は v1068 の狭いほう、AM は今までどおり、chef は退職か Head Chef／Corporate Chef でなくなる（役職 chef も可）、staff は退職。
  - 店（`mr_stores`）：`input_emp`（入力担当）・`viewer_emps`（個人で足す閲覧者）。月（`mr_reviews`）：`input_emp`（その月だけ）・`confirmed_at`・`confirmed_by`。期限や月の入力担当だけを先に決めた月は、何も書いていない行（版 0・状態 `none`）になる。
  - 返信（`mr_replies`）：`kind`（reply・note・done）・`text`・`due`・`client_id`（同じ `client_id` は 1 件）。前の版の行は残るが v2 では読まない。
  - 設定 `flags.live_input`（本番の店の入力・初期は OFF）。店舗公開・通知は OFF のまま。
  - 実効の権限は 1 つの関数 `mr_can`（閲覧・入力・返信・補足・実行完了・確認完了・取り消し・期限・設定と、その理由）。すべての操作がこれを使う。
  - 提出に要るもの `mr_missing_v2`（§4 の印の順と評価保留の数）。同じ規則を `handler.mjs` の `missingV2` に置いた（画面はこれと同じものを使う）。
  - 前の版の返信・完了の関数 5 つ（`mr_reply_save`・`mr_reply_delete`・`mr_reply_send`・`mr_complete`・`mr_result_save`）は `gone` を返すだけにした。
- Edge Function `mid-review`（`handler.mjs`・`index.ts`）：メール（Supabase Auth）か PIN の印（本文の `pin_session` を `verifyPin` で確かめる）のどちらかで入る。`via` と利用者は関数が決める（本文の `via`・`actor` は使わない）。`index.ts` の `verifyPin` は null のまま（PIN の確かめは本番に貼る 1 ファイルにだけ入れる。下の「PIN の確かめ」）。
- `db/`：precheck（v1 が入っているか・title・同じ社員の 2 行）、postcheck（v2 の印・chef／staff の外れ・本番の入力の ON／OFF）、rollback（v2 の関数も消す・本番のレビューがあると止まる）、add-member（役割は am・gm・ceo のまま。同じ社員の PIN だけの行（staff）があれば止めてメールの行に置き換える。chef の行があるときは止まる）。

### 画面が使う API（段階 4-2）

POST で `{ action, ... }`。メールは `Authorization: Bearer <アクセスキー>`、PIN は `Authorization: Bearer <anon>` と本文の `pin_session`。

| action | 送るもの | 返るもの |
|---|---|---|
| `whoami` | `ym`（任意） | `role`・`via`・`emp_id`・`name`・`flags`・`demo`・`ym`・`today`・`perms`（settings・deadline・confirm・unconfirm・reply・all_live）・`live_stores` |
| `list` | `env`・`ym` | `stores[]`：`store_id`・`name`・`am_name`・`input`（emp_id・name・from＝month／store・unset）・`perms`・`review`（`status`＝none／draft／submitted／confirmed／legacy、`deadlines`、`overdue`（submit・reply）、`counts`） |
| `get` | `env`・`ym`・`store_id` | `store`・`perms`・`review`（`body` は入力できる人には作業中のもの、ほかの人には最新の提出版）・`submissions[]`（no・body・snapshot・at・by）・`replies[]`（v2 だけ）・`events[]` |
| `save` | 上と `expect_version`（何も書いていなければ 0）・`body` | `id`・`version`・`status` |
| `submit` | 上と `expect_version`・`snapshot` | `submitted_no`・`holds`。足りなければ 422 `incomplete` と `missing[]` |
| `post` | 上と `kind`・`target`・`text`（1〜1000 字）・`client_id`（UUID）・`decision`・`due`・`sub_no`（任意） | 1 件（`existing`＝同じ `client_id` で前に送ったもの） |
| `confirm` | 上と `expect_no`（見ている提出版） | `confirmed_at`・`confirmed_by`・`holds`・`missing`・`unanswered` |
| `unconfirm` | `env`・`ym`・`store_id`（GM・CEO） | `status`＝submitted |
| `deadline_save` | 上と `deadlines`（submit・reply。空は無し。GM・CEO、PIN でもよい） | `deadlines`・`overdue` |
| 設定（メールの GM・CEO だけ） | `settings_save`（`key: 'flags'`・`value`：private・live_input）・`access_get`（`ym`）・`access_save`（`stores[]`：store_id・input_emp・viewer_emps をまとめて上書き）・`month_input_save`（store_id・ym・input_emp）・`chef_save`（emp_id・on）・`stores_save`・`members_list`・`demo_reset` | `access_get`：店ごとの入力担当・閲覧者・その月の入力担当、chef、候補（input・viewer・chef）、店ごと・人ごとの `perms` |

- `perms.why` の印：`demo`・`all_stores`・`am_store`・`viewer`・`input`・`live_input_off`・`input_unset`・`email_required`・`no_view`（設定の表では `no_member`・`revoked`・`inactive` も）。
- `counts`：`miss_cur`・`eval_low`・`measures`・`consult`・`consult_high`・`needs_reply`・`unanswered`・`holds`・`missing`・`focus`（ok・late・done・help・none）。混ぜて足さない。
- 断るとき：401 unauthorized、403 forbidden・disabled・email_required、404 not_found、400 bad_value・bad_key・bad_candidate、409 conflict・locked・unchanged・new_version・legacy・not_submitted・not_confirmed・not_available・role_exists・member_stopped、410 gone（前の版の返信の操作）、422 incomplete。

### 決めたこと（仕様に書いていなかったところ）

- 閲覧者（`viewer_emps`）は利用者の行を作らない（入れない人は設定の表に `no_member` と出る）。入力担当だけ、行が無ければ staff の行を作る。
- `chef_save`：設定で作った staff の行は chef にできる（外すと、まだどこかの入力担当なら staff に戻し、そうでなければ止める）。CEO・GM・AM の行は変えない（`role_exists`）。SQL で止めた CEO・GM・AM は、ここからは戻さない（`member_stopped`）。
- 確認完了は見ている提出版の番号を送る（新しい提出版が来ていれば `new_version`）。
- 返信は提出のあとだけ。`sub_no` を送らなければ最新の提出版。確認完了のあとも書ける（対策の実行完了はあとで来る）。`note`・`done` は判断・期限を持たない。
- 返信の期限超過：返信期限を過ぎて、確認完了の前で、最新の提出版に管理側の返信（kind reply）が 1 件も無いとき。未返信の数は最新の提出版への返信だけで数える。
- 返信期限は提出期限より前にできない（両方あるとき）。
- 長すぎる文・正しくない日付は断る（切らない・空にしない）。相談は 10 件、重点のキーは 12 まで。
- `access_get`・`members_list`（設定の画面を読む）もメールの GM・CEO だけ。前の版の `schedule` の設定は v2 では使わない（期限の初期値は無い）。
- デモの入力担当は架空の番号（`DEMO-1`〜`DEMO-6`）で、名前はデモの中だけにある。

### 試験（合成データ）

- `node --test tests/mid-review-server.test.mjs`：37/37（本物の SQL を PGlite で、本物の handler、メールと PIN は代わりのもの）。
- わざと壊した 95 通り（SQL 80・handler 15）：1 回目は 80 で落ちた。落ちなかった 15 のうち 14 は試験が足りなかった（2 か所で確かめているもののもう片方・試験の社員の並び）→ 試験を足した。1 つは壊し方が意味を変えていなかった（書き直した）。最後は 95/95 で落ちる。
- `tests/mid-review-ui.test.mjs` と `tests/review/pr44-mid-review-repro.mjs` は v1068 の画面と前の API のものなので落ちる（段階 4-2 で書き直した。下の「画面」）。
- `python3 scripts/check-static-release.py`：pass・1068（画面は変えていない）。

### 段階 4-2（画面）がすること

- 入り方：メール（今までどおり）か PIN（`pin_session` に `window._hwSession`）。権限は `perms` で出し分ける（画面の役割では決めない）。PIN の GM・CEO には設定の画面を出さない。
- 本文・数字：`normBody`・`normSnap` と同じ形と長さ、`missingV2` と同じ必須の印。数字は会議タブの関数で snapshot v2 を作る。デモは `demoSnapshot` と同じ数字を送る（サーバーが確かめる）。
- 提出の 422 は `missing` を出す。確認完了は `expect_no` を送る。返信は 1 件ずつ、`client_id` を作って送り、届かなければ同じ `client_id` で送り直す。
- 担当・閲覧設定は `access_get` の `perms`（理由つき）を出す。`access_save` は店の入力担当と閲覧者をまとめて上書きするので、閲覧者は全部送る。
- 前の形の記録（`legacy`）は読むだけ。

## 画面（段階 4-2・アプリ v1072・ブランチ `claude/mid-review-v2`・PR #50）

- 予実 › 中間レビュー：全店一覧（デモ／本番・状態・入力担当・数は混ぜない・期限）→ 店舗の 1 ページ → 担当・閲覧設定（メールの GM・CEO）。
- 店舗の 1 ページ（B案）：上に数字の一覧（会議タブと同じ。押すとそのカードへ）、① 前月の 6 KPI、② 今月の 5 KPI（未達 → 注意 → 達成 → 判定不可の順）と原価率の速報（参考・入力なし）、③ 重点（Qコミット）、④ 相談、⑤ 確認・提出（書く人）／確認・全体への返信（確かめる人）。どの KPI も 1 枚のカード（結果 → 担当者評価 → コメント・対策 → 返信）。達成している項目もいつも全部出す。
- 書く人：どの欄にも必須・任意の印、足りない欄は赤い枠、⑤ に足りないものの一覧（押すとその欄へ・サーバーと同じ）。1.2 秒止まると版つきで自動保存（ほかの人が先に保存していたら上書きせず知らせる）。提出で提出版にそのときの数字を固定。
- 確かめる人：項目の下に返信（1 件ずつすぐ送る・`client_id` で二重にしない。対応・判断と期限は任意）。左の欄で絞り込み（すべて・未達・評価 1・2・対策あり・相談・未返信・評価保留。数は混ぜない）。確認完了（AM・GM・CEO）と取り消し（GM・CEO）。期限は見出しの「期限を変える」（GM・CEO・確認完了の前）。
- 両方できる人は「報告を書く」と「確認して返信する」を切り替える（補足と返信は別）。
- スマホ（820px 以下）は 1 列・押すところ 44px 以上・短い言葉（上のチップ・手順・操作の切り替え。パンくずと年は出さない）。640px 以下は数字の一覧を出さない（数字は各カードにある）。
- デモの重点は「会議タブの重点カード（デモ）」で反映のされ方を見せる（本番の Qコミットには書かない）。本番の数字は会議タブと同じ関数。前の形の記録（v1）は読むだけ。

### PIN の確かめ（verifyPin）

- auth-pin が PIN の照合で返す印を auth-pin と同じ設定で確かめ、印の人の名前を返す。名前はデータベースが在籍の社員 1 人に結び、その人の利用者の行を引く（2 人以上・退職・止めた人は断る）。店舗のログイン・期限切れ・形の違う印は断る。
- auth-pin のソースと同じく、この確かめは公開のリポジトリに置かない。本番に貼る 1 ファイル（`handler.mjs` そのまま＋確かめ＋起動の行）にだけ入れて Moto さんに直接渡す。リポジトリの `index.ts` は `verifyPin = null`（このまま動かすと PIN は断り、メールだけ入れる）。
- 試験（Claude の手元・合成データ）：本物の auth-pin（v1067）が出した印で入れ、ほかの印（作り直したもの・期限切れ・未来の日付・店舗のログイン・壊れたもの）は断る（鍵の設定 2 通り）。中間レビューの関数が印の人を引く（同じ名前が 2 人なら断る・PIN の GM は設定を開けない）。貼る 1 ファイル全体を Deno で動かし、PIN とメールの両方で入る。4/4。

### 試験（段階 4-2・合成データ）

- `node --test tests/mid-review-ui.test.mjs` 34/34（本物の画面のモジュールを VM で、本物の handler と SQL を PGlite で）。
- `node --test tests/mid-review-server.test.mjs` 38/38、`tests/mid-review-deploy.test.mjs` 4/4（v1069 の束は変えない・v2 の束の SQL は元のファイルと同じ・関数のファイルは置かない・止める SQL）。
- `tests/review/pr44-mid-review-repro.mjs`：R1・R3 は v2 の欄で通る、R2・R4 は v2 で無くなったので止める（R4 の役職の狭め方は server の「v1068 kept」）。`tests/review/pr45-mid-review-lock-order.test.mjs` 2/2（本物の PostgreSQL・v1069 の SQL とデモ）。
- Chromium（1440・390px、日本語・英語。通信は止め、中間レビューの呼び出しだけ本物の handler と PGlite）：一覧・書く・確かめる・絞り込み・設定・PIN の GM・本番の入力担当の 21 画面で pageerror 0・横スクロールなし・スマホの押すところ 44px 以上。クリックと入力だけで川沿い（デモ）の 19 の必須を埋める → 自動保存 → 提出 → 確かめるに切り替え → 未返信の項目に返信 → 確認完了、をスマホ（日本語）と PC（英語）で 20/20。
- わざと壊した server 95 通り（SQL 80・handler 15）：今のファイル（main の `20261013090000` の上）でもう一度流して 95/95 で落ちる。わざと壊した画面 45 通り：44 で落ちる（残り 1 つは同じ意味：確認完了で送る提出版の番号の取り方。画面の中では 2 つの値がいつも同じ）。1 回目は 41 で、落ちなかった 3 つに試験を足した（評価の形・同じログインの鍵を画面が取り替えたとき・閲覧者 2 人の保存）。
- `tests/*.test.mjs` をファイルごとに main `466f3a4` と比べた（invoice-mutations 以外）：失敗は同じ 23 件（bot-center 2・bot-database 2・ingredient-transfers 1・meeting-budget 14・meeting-sales 4。前からの失敗）。違うのは中間レビューの 3 つだけ（server 56 → 38・ui 55 → 34 は v1069 の試験を v2 の試験に置き換えたため。deploy 3 → 4）。
- 試験の乱数の直し：「ランダムな本文で画面・handler・SQL が同じ」の試験（server・ui）の乱数が、掛け算の丸めで下の桁を失い、2・4・8 で割った余りがほぼいつも 0 だった（評価・状態・相談の選び方が偏り、試したつもりの組み合わせが出ていなかった）。32 ビットで正しく計算し上の桁を使う形に直した。直したあとも 3 つは同じ答え。
- `python3 scripts/check-static-release.py`：pass・1072。

### 残り

- 独立レビュー（Claude の別エージェント）・Codex のレビュー：まだ。
- 入れる：§10（`deploy/mid-review-v2/手順.md`）。
- 店舗公開・通知は OFF のまま（別の段階）。本番の店の入力（`flags.live_input`）は GM・CEO が担当・閲覧設定で ON にする。

## 版（v1073・Codex のレビュー `685f49e` の P2）

Codex の指摘：担当・閲覧設定の画面は `access_get` の値を持ったまま、`access_save` がその店の入力担当と閲覧者を全部、`settings_save` が非公開確認と本番の入力の両方を、版を見ずに書き直していた。GM・CEO の 2 人が同じ店（同じスイッチ）を開いていると、あとから保存した画面が先の変更を黙って戻す。同じ画面の「本番の店舗と AM の担当」（`stores_save`）も全店をまとめて書き直していた（Codex の指摘には無いが同じこと。Moto さん 10/13「直す」）。

Moto さんの決定（10/13）：① 先に保存されていたら **B**（自分が変えた所だけをいまの設定に入れ直して、未保存で出す）② 「AM の設定というよりは、誰の管轄か」→「店舗の管轄（どの AM の店か）」として直す ③ 期限の変更と確認完了の取り消しは、GM・CEO なら PIN でも可のまま（変えない）。

### サーバー（migration `20261016090000_mid_review_v2_versions.sql`・handler）

- 版：`mr_settings.version`（キーごと）、`mr_stores.access_version`（店ごと・入力担当と閲覧者）、`mr_stores.am_version`（店ごと・管轄の AM・名前・並び・使う／使わない）。どれも 0 から（`stores_save` で新しく入る店は 1 から）。**値が変わったときだけ** 1 進む（トリガー。関数・止める SQL・手で書いた SQL のどれでも同じ。版だけを書き換える更新は無視）。同じ値の保存では進まない（ほかの人の画面を止めない）。その月だけの入力担当とデモでは店の版は進まない。
- 読む：`whoami` と `access_get` が `flags_version`、`access_get` の各店が `version`（担当・閲覧者）と `am_user`・`am_name`・`am_version`（管轄）を返す（非公開確認が OFF のあいだも `whoami` は版を返す。画面はそこから ON にする）。
- 保存：`settings_save` は `expect_version`、`access_save`・`stores_save` は各店に `expect_version` が要る（`stores_save` でまだ入っていない店は 0）。今の版と違えば 409 `conflict` で**何も書かない**（履歴・利用者の行も作らない）。何店かをまとめて送ったときは、1 店でも違えば全部書かない。同じ店を 2 回送ると 400。保存の答えに新しい版（`settings_save` は `version`、`access_save`・`stores_save` は `stores[]`：store_id・version）。
- 順番：保存は先に行を `FOR UPDATE` で押さえてから版を比べる（店は store_id の順）。2 つの保存が同時に来ると、あとのほうは先の保存のコミットを待ち、そのあと `conflict` になる。まだ入っていない店を 2 人が同時に入れても、あとのほうは `conflict`（本物の PostgreSQL で確かめた）。
- `expect_version` が無い（v1072 の画面）→ handler が 410 `gone`（画面には「前の版の画面の操作です。アプリを更新してください」）。整数でない・0 未満・10 桁以上 → 400。SQL も無い・形の違う版は `bad_value` で断る（handler だけに頼らない）。
- 変えていないもの：`month_input_save`・`chef_save`（1 つずつ決める操作で、ほかの人の別の変更を戻さない）・権限・管轄の決まり（有効な AM だけ・入力担当と閲覧者はそのまま）・ほかの操作。
- 入れる順：関数 → `20261016090000` → 確認の SQL → アプリ v1073（`deploy/mid-review-v1073/手順.md`）。関数を入れてからアプリが v1073 になるまで、v1072 の画面の設定の保存だけが 410 で断られる（見る・入力・返信・確認完了はそのまま）。`20261015090000` をあとから流し直すと v2 の保存（版を見ない）に戻るので、続けて `20261016090000` も流す（確認の SQL の `mid-review versions (20261016090000)` が NG になる）。

### 画面（アプリ v1073）

- 担当・閲覧者：下書きは読んだときの設定（入力担当・閲覧者・版）を持ち、その版で保存する。先に保存されていたら（`conflict`）読み直して **B**：自分が変えた所だけをいまの設定に入れ直し、変えていない所はいまの設定のまま。閲覧者は 1 人ずつ（自分が足した人は足し、外した人は外す。ほかの人が足した人は残す）。入力担当を 2 人とも変えていたら下書きは自分のほうで、帯に両方の名前（「やめる（いまの設定に戻す）」でいまの設定）。自分の変更がもう入っていたら「保存しなくて大丈夫」。何も変えていない画面が保存して断られたら、いまの設定を出すだけ。未保存の閲覧者・入力担当には「（未保存）」。別の店へ移ると帯は消える。
- ON・OFF：版で保存。先に変えられていたら帯（いまの状態を出す。押した操作は反映していない。もう同じ状態なら「押さなくて大丈夫」）。非公開確認が OFF の画面（「非公開確認を ON にする」）も同じ。
- 店舗の管轄（どの AM の店か）：「本番の店舗と AM の担当」をこの名前のいつも開いたカードにした（決まりは同じ：有効な AM だけ・AM のいない店は「GM の直轄」・まだ入っていない店は店舗マスターの AM 欄と名前が完全に同じ AM が 1 人だけのとき案）。保存するのは、変えた店と、まだ入っていない店・店舗マスターで名前・並び・使う／使わないが変わった店だけ（ほかの店の変更は送らないので、ぶつからない）。同じ店が先に保存されていたら B（自分の変えた店だけを入れ直す・ほかの人の変更は帯に出す・同じ店を 2 人とも変えていたら両方の名前）。AM でなくなった人が管轄のままの店は「AM でなくなった：選び直して保存」と出し、その店を送るときは画面で止める。左の店の一覧（「管轄 Yuki・入力担当 …」／「GM の直轄・…」）と店のカード（「管轄：Yuki（AM）」「管轄を変える ↓」）にも出す。サーバーの更新（20261016090000）の前（`am_version` が無い）は、管轄を変えられないと出す（推測で出さない）。管轄は `access_get` から読む（前の `list` の呼び出しは要らなくなった）。
- 読み込み中で止まる不具合（Moto さん 10/13「担当閲覧設定が読み込み中から進まない（できる時もある）」）：一度読んだ画面に戻る（設定を開き直す・設定の月を戻す・一覧のデモ／本番や月を戻す・同じ店をもう一度開く）と、読み込みの印が「済み」のまま中身だけ捨てていたので、二度目は読みに行かず「読み込み中…」のまま止まった。中身を捨てるときは印も消し、読み込みの関数も「済み」の印で止まらないようにした（読み終えた直後に何度も続くときだけ止めて「更新」を案内）。
- 保存していない設定・管轄があるときに一覧へ戻る・ログアウトすると聞く。
- APP_VERSION・SW_BUILD は 1073。

### 試験（合成データ・本番に接続していない）

- `tests/mid-review-server.test.mjs`：Codex の再現（GM・CEO の 2 画面で同じ店の別の項目・別のスイッチ）・版の必須と形・何店かのうち 1 店だけ古い・版が進む場合と進まない場合（止める SQL を含む）・管轄の 2 画面・まだ入っていない店・v2 が無いと止まる・入れる前と後の確認。
- `tests/mid-review-versions-pg.test.mjs`：本物の PostgreSQL 16 の 2 セッション（担当・閲覧者／スイッチ／押さえる順番の割り込み／まだ入っていない店を同時に／同じ新しい店 2 つを逆の順で（直す前は deadlock）／保存済みの同じ店の管轄）。v2 の SQL だけだと、担当・閲覧者とスイッチは待ったあとに先の変更を戻す。
- わざと壊した：画面 61 通りのうち 56、サーバー 43 通りのうち 42 で試験が落ちる（残りは同じ意味の二重の守り）。
- `tests/mid-review-ui.test.mjs`：画面（index.html の本体）と本物の handler・SQL で、2 画面の B（入力担当・閲覧者 1 人ずつ・2 人とも変えた・もう入っている・何も変えていない）・スイッチ（設定と OFF の画面）・管轄（変えた店だけ・まだ入っていない店・名前の変更・AM でなくなった・2 画面）・読み込み中で止まらない・保存していない設定から離れるとき・サーバーの更新前。
- `tests/mid-review-deploy.test.mjs`：`deploy/mid-review-v1073/` の SQL が元のファイルの写しで、関数のファイルを置かず、手順の順番が正しいこと。v2 の束は渡したときのまま（sha256）。

### v1073 の直し（Codex のレビュー `3fbd9dd` の P2・migration `20261017090000_mid_review_stores_save_fix.sql`）

- 指摘：`mr_stores_save` は保存する店の行を `FOR UPDATE` で押さえてから版を比べるが、押さえられるのはそのときある行だけ。まだ無い店（版 0）を比べ終えたあと、書く前に別の保存がその店を入れてコミットすると、書くときに「ある店」として見つけ、版を見ずに UPDATE していた（先の保存を書き直し、409 にならない）。
- 直し：書く UPDATE にも `am_version = 読んだ版` を条件にし、1 行も書けなければ `conflict`（何も書かない）。関数 1 つの置き換えだけ。アプリ・関数（Edge Function）は変えない。
- 試験：本物の PostgreSQL 16 の 2 セッション（A が F01 と新しい F07 を保存して F01 を書いているあいだに、B が F07 だけを保存してコミット → A は conflict・B が残る）と、PGlite で「比べたあと・書く前に行が現れる」を作る試験。どちらも直す前は落ちる（A が B の F07 を書き直す）。
- 入れ方：`deploy/mid-review-v1073-fix/`（SQL 1 つ → 確認の SQL）。`20261016090000` を流し直したときは、続けてこれも流す（確認の SQL の `mid-review stores_save fix (20261017090000)` で分かる）。


## 店舗の管轄に GM も選べる（v1076・migration `20261018090000_mid_review_scope_gm.sql`・ブランチ `claude/mid-review-scope-gm`）

Moto さんの依頼（10/14 02:44 HST）「店舗管轄の選択を GM・AM のどちらか選べる様にしてください」と回答：GM も **名前で選ぶ**／GM を選んだ店の権限は **今までどおり**（GM・CEO は全店を見て、返信・確認完了ができる。担当として GM の名前が出る）／**「未設定」も選べる**。

- 選べるもの：「未設定（GM・CEO みんなで見る）」・GM の名前・AM の名前（画面は GM・AM のグループに分ける）。CEO・chef・staff は選べない。
- サーバー：`mr_stores_save` が管轄に GM も受ける。決まりは「いまの役割」（`mr_member_role`）が `am` か `gm`（AM は社員の表でいまも AM、GM は manager_auth でいまも GM。v1068 の決まりどおり、manager_auth で CEO にした GM は GM のまま＝選べる。manager_auth から外した・ここで止めた GM は選べない）。20261017090000 の直し（書くときも読んだ版が条件）はそのまま写した。`mr_row_v2`（一覧の行）に担当の役割 `am_role`（`gm`・`am`。いまの役割が無ければ空）。表・行・権限（`mr_can`）・ほかの関数は変えない。関数（Edge Function）も変えない（答えをそのまま渡す）。
- 権限は変えない：GM を管轄にした店は、前にその店の管轄だった AM には見えなくなる（AM が見られるのは管轄の店と、個人で足した閲覧者になった店）。GM・CEO・chef は今までどおり全店。
- 画面（アプリ v1076）：店舗の管轄のカードの名前「店舗の管轄（どの GM・AM の店か）」・説明・選ぶ所（未設定 → GM → AM）。「GM の直轄」は「未設定」に。左の一覧・店のカードの管轄、全店一覧の「担当：名前（GM）」「担当：名前（AM）」「管轄 未設定」。GM・AM でなくなった人は「（GM・AM でなくなった）」「選び直して保存」で、その店を送る保存は止める（前と同じ決まり）。
- 前の版の端末（v1075 以前）：GM を管轄にした店は「AM でなくなった」と出て、その店の管轄を保存できない → GM・CEO の端末を v1076 にそろえる。新しい SQL の前に v1076 の画面で GM を選ぶと、保存はエラー（何も書かない）。
- 確認の SQL：`mid-review scope GM (20261018090000)`（27 行）。`20261016090000`・`20261017090000`・v2 の SQL を流し直したときは NG になるので、続けてこれをもう一度流す。
- 試験（合成データ・本番に接続していない）：server 48（GM を保存・一覧の役割・GM／CEO は全店で返信・確認完了・前の AM には見えない・CEO と chef は選べない・manager_auth で CEO にした GM は選べる・外した／止めた GM は選べない・未設定と AM に戻す・確認の SQL の流し直し・前の SQL が無ければ何も変えない）、ui 44（選ぶ所の並び・保存は変えた店だけ・左の一覧・カード・全店一覧・前の AM の一覧から消える・GM でなくなった人の選び直し）、本物の PostgreSQL 7（20261017090000 の 2 セッションの試験が新しい関数で通る）、deploy 7（v1073 の直しの束は sha256 で固定）。
- 入れ方：`deploy/mid-review-v1076/`（SQL 1 つ → 確認の SQL → マージ → 管轄を選ぶ）。
