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
