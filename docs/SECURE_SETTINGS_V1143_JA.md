# v1143：GM・CEO だけが変える賞与・Career Score の設定を、公開の鍵で書けなくする（段階 2b の 5 つ目）

依頼：Moto さん 11/03 の「Funergy+ 全体アップデート指示」の 2b（機密・権限に関わるデータを公開の鍵から外す）と、11/04 以降の「次へ次へどんどん進めてください」「続きお願いします」（11/09）。
v1141（PR #135）と同じ道（関数 `secure-state` の `put`・決めた人だけ・SQL の restrictive の決まり）に、8 つのキーを足すだけ。**だれが変えられるかは今の画面と同じ（GM・CEO）で、変えていない。**

## 1. なぜこの 8 つ

2b の残りのうち、公開の鍵（anon）で**書ける**キーで、画面では GM・CEO だけが変えるもの。どれもアプリが賞与・昇格・Career Score の計算と表示に使う（サーバーは読まない）。
公開の鍵はアプリの中にあるので、アプリを開ける人ならだれでも書き換えられた（例：自分の賞与の個人設定・係数・基準ラインを変える）。

| キー | 中身 | 画面で変える人 |
|---|---|---|
| `cs_criteria` | スコア基準（昇格の判定と賞与 ① の基準ライン） | GM・CEO |
| `bonus_coef`・`bonus_coef_rng` | グレード・職種の係数と、その幅（下限〜上限） | GM・CEO |
| `bonus_track` | その四半期に選んだ G3 の職種（「四半期|従業員」ごと） | GM・CEO |
| `bonus_eval_rule` | 賞与の 4 項目の設定（会社共通・グレード・職種） | GM・CEO |
| `bonus_eval_ovr` | 賞与の個人設定（「従業員|四半期」ごと） | GM・CEO（自分の分は画面が止める） |
| `cs_strength_rule` | 強みの決まり（表示だけ） | GM・CEO |
| `cs_guide` | 評価基準・例の文（言語ごと） | GM・CEO |

読むのは今までどおりでよい（どの端末も計算・表示に使う）。**書くのだけを止める。**

外さなかったもの：グレードの履歴（`grade_hist`）。新しく入った人の登録・昇格の承認・Leader の昇格でも書くため、だれが書いてよいかを決めてから別の版で（Moto さんに確かめる）。
`bonus_q`・`bonus_eval`・`bonus_store_q`・`bonus_pool_extra`・`karte_bonus_config`・`bonus_rules` は v1139 で関数だけ（読むのも）にしてある。

## 2. 作り

- **関数 secure-state（v1143）**：`SW2_KEYS`（8 つ）を `SW_WRITE` に足した（どれも **ceo・gm**）。v1141 の `swPut` と同じ道：
  - だれか：今までと同じ（PIN のログインの印は work-requests の whoami、メールのログインは manager_auth）。役割はサーバーが決める。端末の言う役割は使わない。退職した人は 401。
  - GM・CEO でない人：**クラウドと同じ値**（欄の順は問わない）なら書かずに通す（`same:true`）。違う値は 403。
  - 値の形（GM・CEO が書くとき）：全体が「キー → 記録（オブジェクトか null）」の地図・キーは 200 字まで・**600 万字まで**（本文の上限 800 万字の内側。変更の履歴を持つ評価基準・個人設定が大きくなっても止めない）。形の合わない記録は**クラウドにもうある同じ記録だけ**通す。外れれば 400。
  - `expect`（読んだ行の `updated_at`）があれば、そのときだけ書く（違えば 409）。
  - 読む（`get`）・取り込み（`pull`）には出さない（読むのは REST のまま）。答えにはいつも `sw2:1`（と書いた人の役割 `by`）。
- **アプリ v1143**：
  - `SW2_KEYS`・`sw2IsKey`。`swIsKey` は 10 のキー。`swRouted(key)` は、PIN かメールのログインがあり、関数が前の版と分かっていなければ、**書き込みだけ**を関数に頼む。
  - 関数が v1142 以前（答えに `sw2:1` が無い）なら、10 分はこの 8 つを今までどおり REST で書く（`_ss.sw2Old`。v1141 の 2 つは v1142 の関数でも関数で書く）。
  - 8 つとも **読んだ行が変わっていないときだけ書く**（`cas`。v1141 の Score管理と同じ。2 台の GM・CEO が同時に保存しても、両方の変更が残る。4 項目の設定・個人設定はアプリの本物の合流 `kevMergeMap` で部分ごとに合わせる）。
  - **クラウドがもう端末の値をすべて持っていれば書かない**（`def.covers`。10 のキーすべて）。合流で見た目だけが変わる（4 項目の設定・個人設定は合流で変更の履歴 `hist` が並び直る）と、GM・CEO でない端末の送り直しが「違う値」として 403 になり、送信待ちに残り続けるため。「設定 › 診断と記録」には「クラウドにもう入っているので書きませんでした」。
  - サーバーが断ったら（403・400）、そのことを出して送信待ちに残す。
  - どの道で書いたかを「設定 › 診断と記録」に残す（「〈設定の名前〉：サーバー（secure-state v1143）が書きました（役割 GM）」など）。手順の B-5 で使う。
  - 画面（だれが変えられるか）は変えていない。
- **SQL 20261112090000**：`ss_guard_key(k)` を 10 のキーに（v1141 の決まり `ss_guard_ins`・`ss_guard_upd`・`ss_guard_del` はそのまま使う）。v1141 の SQL がまだでも、この SQL だけで v1141 と同じになる（RLS が OFF なら ON にして ss_open。印は v1141 と同じ）。2 回流しても同じ。
  読む（select）の決まりは足さない（行の一覧 `app_state_index` にも今までどおり出る）。
  - 戻すのは `db/secure-settings-more-rollback.sql`（`ss_guard_key` を v1141 の 2 つに戻すだけ。v1141 の決まりが無ければ何もしない）。v1141 の戻す SQL を流すと 10 のキーすべてが書けるようになる。
- **確かめの SQL**：`db/secure-settings-more-precheck.sql`（読むだけ・13 行：8 つの件数・大きさ・形の合わない記録・GM・CEO のアカウント）、`db/secure-settings-more-postcheck.sql`（読むだけ・最後に rollback・17 行：決まり・キーの判定・anon と authenticated で書けない・ほかは書ける・形・決まりを通らない道・それぞれの最後の保存の日時）。

## 3. 入れる順番（`deploy/secure-settings-v1143/手順.md`）

① 確かめ → ② 関数 → v1141・v1142・v1143 の PR をマージ → 全部の端末を 1143 に → B-5（GM・CEO が強みの決まりを変えずに保存して「secure-state v1143 が書きました」）→ ③ SQL → ④ 確かめ。

## 4. 試験（合成データ・本番に接続していない）

- `tests/secure-settings-more-server.test.mjs`（8）：キーと役割・形（200 字のキー・600 万字・クラウドと同じ形の合わない記録）・GM・CEO は PIN でもメールでも書ける・ほかの役割は 403・退職した GM は 401・公開の鍵は 401・端末の言う役割は使わない・同じ値は書かずに通す・`expect` の 409・`get` と `pull` に出さない・PIN の確かめ先が落ちたら 503・v1141 の 2 つは変わらない。
- `tests/secure-settings-more-client.test.mjs`（9）：アプリの本物の送信と合流を vm で、本物の関数と合成のクラウドに：8 つは関数で書き REST で読む・GM と CEO が書くと「secure-state v1143 が書きました」（日英）・経理・AM・G4・Crew は 403 で止まりクラウドは変わらない・クラウドにもうある値・古い写しの送り直しは止まらない・関数が v1142 なら REST・SQL のあと PIN のログインなしは書けない・GM と CEO の同時の保存（スコア基準・個人設定は本物の `kevMergeMap`）・読んだあとにほかの端末が書いた・形の合わない記録は 400 でクラウドにもうある記録は止めない。
- `tests/secure-settings-more-rls.test.mjs`（7・PGlite）：v1141 のあと／v1139〜v1142 のあと／RLS OFF／ON から：anon・authenticated は 10 のキーを読めるが足す・上書き・直す・消す・名前を変えて入れる、ができない・グレードの履歴などほかは書ける・サーバーの鍵は書ける・行の一覧に出る・2 回流しても同じ・確かめの SQL（13 行・17 行）・穴があれば NG・決まりが無ければ NG・戻す SQL（2 回）・v1141 の戻す SQL・SQL と関数とアプリ（index.html）のキーの決まりが同じ（300 の乱数のキーも）・STOP・形の NG と info・決まりを通らない関数は CHECK。
- 変えた試験：`tests/secure-settings-server.test.mjs`（キーが 10）・`tests/secure-state-server.test.mjs`（答えに `sw2:1`）・`tests/secure-settings-client.test.mjs`（Score管理の同じ値の送り直しは「書かなかった（クラウドにもうある）」）・`tests/secure-settings-rls.test.mjs`（v1141 の SQL だけなら 2 つ）・`tests/secure-state-deploy.test.mjs`（v1142 の関数の 1 ファイルを sha256 で固定・v1143 の一式）・
  `tests/career-criteria.test.mjs`・`tests/cs-strengths.test.mjs`・`tests/karte-eval.test.mjs`・`tests/karte-settings.test.mjs`（合流の決まりの行に `cas: true`）。CI に v1142・v1143 の試験を足した。
- secure 一式（`tests/secure-*.test.mjs` 16 ファイル）214/214、v1142 の Codex の直し（#136 `7305c75`）を取り込んだあと 218/218。static release pass/1143。
- 全体（重い 2 つ以外・4 並列）：v1143 2,109 件・v1142（`b3ae79b`）2,041 件。落ちる試験は同じ（meeting-budget・meeting-sales・cooking-sake・bot-center・bot-database・approvals の forced tie・ingredient-transfers・invoice-migrations・next-v1090・perf-v1098・specialist-career＝前から）。違いは v1142 で重いときだけ落ちた invoice-intake の 1 件と、上の 4 ファイル（合流の行の `cas: true`。直した）。
- わざと壊す 34 通りのうち 33 で落ちる（関数 7・アプリ 13・SQL 8・戻す 3・確かめ 3）。1 回目は 31（「クラウドにもうある」の文・確かめの 3 行目のグレードの履歴は試験を足した）。残り 1 は同じ意味（直す決まりの with check を省くと using を使う）。

## 5. 残る限界・次

- 読むのは今までどおり公開の鍵で読める（個人設定には、だれの賞与の設定を変えたかが入る。名前ではなく社員 ID と四半期）。
- 従業員の表（役割・店・名前）は今も公開の鍵で書ける（2b の v1144・(b) の段階）。サーバーの役割は manager_auth と work-requests の whoami で決めるので、この 8 つの書き込みは従業員の表を書き換えても通らない。
- GM が自分の賞与の個人設定を変えることは、画面が止めている（`kevIsSelf`）。サーバーは止めない（GM・CEO なら書ける。v1142 以前の REST と同じ）。
- ③ の前に公開の鍵で書き換えられていたかは分からない（④ の 17 行目でそれぞれの最後の保存の日時を見る）。
- グレードの履歴（`grade_hist`）は次（だれが書いてよいかを Moto さんに確かめてから）。
- ③ のあと、1142 以前の端末はこの 8 つを保存できない（送信待ちに残る）。
