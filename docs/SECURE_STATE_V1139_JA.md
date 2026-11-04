# v1139：成長カルテ・賞与を公開の鍵から外す（段階 2b の 1 つ目）

全体アップデート指示（11/03）の段階 2b「機密を公開の鍵から外す」の 1 つ目。Claude が作成。ブランチ `claude/secure-state-1139`（v1138 の上）。

## 1. いまの問題

- アプリの中にある公開の鍵（anon）で、だれでも app_state を読み書きできる（画面を通らない）。
- どの端末も、ログインのたびに app_state を全部取る（役割で分けていない）。画面の権限は、描くかどうかだけを決めている。
- そのため、次のデータが全部の端末に届き、公開の鍵を知っていればだれでも読めて書けた。
  - 成長カルテ（`growth_karte`）：給与・ボーナスの履歴（金額）・面談の記録・目標
  - 賞与：査定（`bonus_eval`）、確定した支給額（`spl_bonus_q_<四半期>` の evSnap）、店の利益（`bonus_store_q`）、原資の表（`bonus_rules`）、特別原資（`bonus_pool_extra`）、グレードごとの基準額（`karte_bonus_config`）
  - 成長カルテの PIN（`karte_pin`）：平文。初期値は 1234。確かめは端末だけ。

## 2. 2b の進め方（この版はその 1 つ目）

1. **v1139（この版）**：成長カルテ・賞与のキー（下の 9 つ）を、関数 `secure-state` を通して読み書きする。公開の鍵では読めない・書けないようにする SQL も一緒に渡す（全部の端末を 1139 にしてから入れる）。
2. このあと：Career Score（`lss_emp_`・申請・履歴）・応募者（`applicants`・`reject_log`）・お悩み相談室（`growthhub`）・注意ログ（`warnings_`）・個人ごとの Tip（`tip_cf_`）・賞与の設定のうち本人の画面も使うもの（`bonus_eval_ovr`・`bonus_track`・`grade_hist`）・サーバーが信じている値（ガソリン代の単価 `mileage_config` など）・従業員の表の個人の欄（生年月日・カードの下 4 桁・保険の金額）。どれも「見てよい人」を店・本人で分けるので、関数の中で絞る。
3. 通知（全員分で 1 つの配列）は段階 5 で人ごとの受信箱にする（指示の段階表のとおり）。

「業務ごとに専用の表へ」（決めてほしいこと 11A）について：この版では行を app_state に置いたまま、読み書きの入口だけを関数にした。行を別の表へ移すと、そのあいだに前の版の端末が書いた分の扱い・移したあとの照合が要る（「本番データの無検証な一括移行をしない」）。入口を関数にしておけば、あとで表を移すときもアプリは変えなくてよい。

## 3. 対象のキー

`growth_karte`・`karte_pin`・`karte_bonus_config`・`bonus_q`（前の統合行）・`bonus_eval`・`bonus_store_q`・`bonus_rules`・`bonus_pool_extra`・`spl_bonus_q_<四半期>`。

関数の `ssIsKey`、アプリの `ssIsKey`、SQL の `ss_secret_key` は同じ決まり（試験で照らす）。

対象にしなかった賞与のキー（`bonus_eval_rule`・`bonus_eval_ovr`・`bonus_coef`・`bonus_coef_rng`・`bonus_track`・`grade_hist`・`cs_criteria`）：Career Score の「総合点 ／ 基準点」（v1100）や G3 の職種で、本人・リーダーの画面も読む。2b の次の段で、本人の分だけ返す形にする。

## 4. 関数 secure-state

`supabase/functions/secure-state/`（handler.mjs・index.ts）。Verify JWT は OFF（関数の中で確かめる）。このファイルのまま貼ってよい（非公開の部品は無い）。

### だれか

- PIN のログインの印（本文の `pin_session`）があれば、それを work-requests の `whoami` に送って確かめてもらう（PIN を確かめるコードは公開しないので、この関数には入れない）。役割は `wr_actor`：CEO・GM・経理・事務Crew は manager_auth（社員 ID）、ほかは GM・CEO が確かめた写し（`wr_people`）。退職した人は断られる。同じ印は 60 秒覚える。
- PIN の印が無く、メールのログイン（Authorization の Bearer）があれば、Auth の利用者 → manager_auth（役割と社員 ID）。退職・停止は断る。管理者ページ（成長カルテ）はこちら。
- 両方あるときは PIN（その端末の前にいる人）。PIN の印が断られたら、メールには落ちない。
- work-requests を呼べない（無い・PIN を確かめられない）：503 `auth_unavailable`（アプリは今までどおり REST）。

### 返すもの（level）

| level | だれ | 返すもの | 書く |
|---|---|---|---|
| full | CEO・GM | 9 つのキーの行（`karte_pin` を除く） | できる |
| proj | ほかの在籍の人（社員と結ばれた印） | `growth_karte` → 全員の入社日（`hireDate`）と「次期の目標」（終わっていないもの）。目標は本人、AM は担当の店と自分の店の人、G4 以上は自分の店の人。`karte_bonus_config` → 査定の四半期（`quarter`）だけ | できない |
| none | 社員と結ばれていない人（店舗のログイン・社員の ID の無いメールのアカウント） | なし | できない |

proj の中身は、今の画面が CEO・GM 以外に見せているものだけ：
- Career Score の強みのカードの「伸ばしていること」（v1108・`cssGrow`：成長カルテの次期の目標から 1 つ）
- グレードの区間・HR の福利厚生の入社日（`ghHire`：従業員の表に無いときだけ成長カルテの入社日）
- Career Score の基準点の四半期（v1100・`csvQ`：成長カルテで選んでいる査定の四半期）

試験で、この 3 つが全部の値と見せる形で同じになることを確かめる。

### 動き

- `pull`：`have`（端末が持っている行の印）と違う行だけ返す。印は `app_state_index`（v1098・md5）。無ければ中身から作る。
- `get`：1 つのキー。
- `put`：書く。`expect` が無ければ今までの upsert と同じ。`expect.exists=false` は行が無いときだけ、`expect.exists=true` は読んだ `updated_at` と同じときだけ（書く時刻は読んだ時刻より後の次のミリ秒以降：v1097 と同じ）。`karte_pin` は書けない。
- `pin_check`・`pin_set`：成長カルテの PIN（4 桁）。サーバーで確かめる。保存は PBKDF2（15 万回・塩 16 バイト）の印。前の版の平文・行が無い（初期値 1234）も確かめられ、合えば印に置き換える。5 回まちがえると 10 分止める（その人だけ）。CEO・GM だけ。

## 5. アプリ v1139

- 取り込み（`_kvPullRows`）：行の一覧と並べて関数に `pull` を頼む。関数が答えたら、対象のキーは REST で取らない（一覧からも、全部取るときの条件からも外す）。
  - full：関数の行を、今までと同じ合流（`_applyKvRows`）で取り込む。印は `_ss_seen`（端末だけ）。
  - proj：見せる形をそのまま置く（合流しない・送らない）。ほかの対象のキーの写しは端末から消す。
  - none：対象のキーの写しを端末から消す。
  - 送れていない変更のあるキーは消さない（`_lsCloudPending`）。
  - proj・none のあとで full になった端末は、見せる形の写しを消してから全部の値を取り込む（見せる形を全部の値に合流させない）。
- 送る（`syncMasterToSupabase`・`opMergePush`・`supaUpsert`・`_opCasWrite`）・1 つのキーの読み込み（`_fetchOpValue`・`_fetchOpRow`・`pullOpKey`）：対象のキーは関数で。合流の決まり・照合・送信待ちは今までと同じ。読み込みに失敗したら、端末の値で丸ごと書く道には行かない（送らずに送信待ちに残す）。
- proj・none と分かっている端末は、対象のキーを送らない（送信待ちにも入れない）。
- 成長カルテの PIN（`karteTryUnlock`・`karteChangePin`）：関数で確かめる・変える。端末に PIN を置かない。
- 一度きりの「端末のデータをクラウドへ」（`migrateUploadLocalOps`）：対象のキーは送らない。

### 関数を使わない（今までどおり REST）とき

- 関数がまだ無い（404）・関数の答えでない・関数が work-requests を呼べない（503）：v1138 と同じ。10 分たったら試し直す。
- PIN のログインの印が無い（初期 PIN のまま）CEO・GM：v1138 と同じ。
- PIN のログインの印が無い、CEO・GM でない人：対象のキーを取らない・端末の写しを消す（SQL のあとは REST でも読めないので、同じ動きにした）。

## 6. SQL（全部の端末を 1139 にしたあと）

`supabase/migrations/20261108090000_secure_state_rls.sql`。

- `ss_secret_key(text)`（対象のキーか）を足す。
- app_state の RLS が OFF なら ON にし、今までと同じ決まり `ss_open`（anon・authenticated・すべて）を足す。ON なら今の決まりのまま。
- 対象のキーの行だけを外す決まり `ss_secret`（restrictive）を足す。anon・authenticated は読めない・書けない・消せない。サーバーの鍵は通る。
- `app_state_index`（security invoker）も anon には対象のキーを返さない。
- 行・値は変えない。2 回流しても同じ。戻す：`db/secure-state-rls-rollback.sql`（OFF だった表は OFF に戻す）。
- 読むだけの確かめ：前 `db/secure-state-precheck.sql`、あと `db/secure-state-postcheck.sql`（anon として読んで確かめ、最後に rollback）。

## 7. 決めたこと（Moto さんに伝える・違えば直す）

- CEO・GM の PIN のログインでも全部を読める（今と同じ。成長カルテ・賞与の設定・Career Score の Score管理・グレードの変更の G3 職種は、PIN のログインの画面でも使う）。ボーナスの締め（bonus-close）は今までどおりメールだけ。
- 経理（office）は成長カルテを開けないので、ほかの人と同じ見せる形（本人の目標・入社日・四半期）。
- G4 以上が見る目標は「自分の店の人」（画面は G4 以下のグレードに絞っているが、関数はグレードを見ない）。
- 社員と結ばれていない CEO・GM のメールのアカウント（manager_auth の emp_id が空）：管理者ページ（メール）では全部を読める。PIN のログインでは、その人の役割が manager_auth から分からないので見せる形になる（前の確かめ `db/secure-state-precheck.sql` の 7 で数える）。

## 8. 限界・残ること

- SQL を入れるまでは、前の版の端末・公開の鍵では今までどおり読める（関数を使う端末が REST で取らないだけ）。
- SQL のあと、1138 以前の CEO・GM の端末は成長カルテ・賞与を読めない・送れない（送信待ちに残る）。先に全部の端末を 1139 に。
- SQL のあと、PIN が初期のままの CEO・GM は、PIN のログインの画面で賞与の設定などを読めない（管理者ページ（メール）は使える）。先に PIN を変える。
- 成長カルテの PIN の印は、SQL を入れるまでは公開の鍵で読める（4 桁なので印から割り出せる）。守りは SQL から。
- 前の版の端末は、関数が印に置き換えた PIN（`karte_pin` が文字でなくなる）で成長カルテの PIN の画面を開けない（その画面はメニューに無く、管理者ページは PIN を聞かない）。
- 関数の印の覚え（60 秒）・PIN の止め（10 分）は関数の 1 つの起動の中だけ（起動が分かれると数え直す）。
- 実機（iPhone）・本番のデータ・本物の Supabase の RLS と Realtime では確かめていない。

## 9. 試験（合成データ）

- `tests/secure-state-server.test.mjs`：関数（だれか・level・見せる形・書き込みの照合・PIN）。
- `tests/secure-state-client.test.mjs`：アプリの本物の取り込み・送信・読み込みを vm で動かし、本物の関数と合成のクラウドにつなぐ（公開の鍵で渡った対象のキーの行を数える）。
- `tests/secure-state-rls.test.mjs`：SQL を PGlite で（RLS が OFF の表・ON の表・確認の SQL・戻す SQL・決まりの一致）。
- 結果・わざと壊す試験・独立レビューは共有記録に書く。
