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

1. auth-pin（PIN の回数の制限を足した版）を入れる（中身は Moto さんに直接）。
2. 関数 `mid-review`（v2）を入れる。PIN の印を確かめる鍵は auth-pin と同じ設定を使う。
3. migration `20261015090000_mid_review_v2.sql` → postcheck。
4. PR をマージ（アプリ）。
5. GM・CEO がメールでログインして担当・閲覧設定（Head Chef・入力担当）を保存。デモを作り直す。

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
- Edge Function `mid-review`（`handler.mjs`・`index.ts`）：メール（Supabase Auth）か PIN の印（本文の `pin_session` を `verifyPin` で確かめる）のどちらかで入る。`via` と利用者は関数が決める（本文の `via`・`actor` は使わない）。`index.ts` の `verifyPin` はまだ null（PIN は 401）。
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
- `tests/mid-review-ui.test.mjs` と `tests/review/pr44-mid-review-repro.mjs` は v1068 の画面と前の API のものなので落ちる（段階 4-2 で書き直す）：UI は 55 のうち 16 が通り、36 が落ち、3 が止まる。再現は 4 つとも止まる（前の SQL だけを読み込むので、v2 の関数が無い）。
- `python3 scripts/check-static-release.py`：pass・1068（画面は変えていない）。

### 段階 4-2（画面）がすること

- 入り方：メール（今までどおり）か PIN（`pin_session` に `window._hwSession`）。権限は `perms` で出し分ける（画面の役割では決めない）。PIN の GM・CEO には設定の画面を出さない。
- 本文・数字：`normBody`・`normSnap` と同じ形と長さ、`missingV2` と同じ必須の印。数字は会議タブの関数で snapshot v2 を作る。デモは `demoSnapshot` と同じ数字を送る（サーバーが確かめる）。
- 提出の 422 は `missing` を出す。確認完了は `expect_no` を送る。返信は 1 件ずつ、`client_id` を作って送り、届かなければ同じ `client_id` で送り直す。
- 担当・閲覧設定は `access_get` の `perms`（理由つき）を出す。`access_save` は店の入力担当と閲覧者をまとめて上書きするので、閲覧者は全部送る。
- 前の形の記録（`legacy`）は読むだけ。

### 残り

- PIN の印を確かめる `verifyPin`（auth-pin と同じ鍵・形・期限）：auth-pin のソースが要る（Moto さんから。リポジトリには置かない）。それまで PIN は断る。
- 入れる順は §10 のとおり。関数 v2 から migration までのあいだ、v1068 の画面は動かない（返信は 410）。続けて入れる。
- 独立レビュー・Codex のレビューはまだ。
