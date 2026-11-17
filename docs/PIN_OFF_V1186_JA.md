# v1186 GM・CEO・経理は PIN でログインしない（と #183 の Codex の P2 2 つ）

## 決まったこと（Moto さん 11/16 23:24 HST）

- 「ロックしなくていいです」：GM・CEO は、チャットで操作が無くてもロックしない。PIN で入った日も同じ（v1167 から今の作りのまま。コードは変えない）。
- 「PINでのログインやめます」：GM・CEO・経理は、名前を選んだあと**メールとパスワードだけ**で入る（v1185 の段）。ログインの画面に「PIN でログイン」を出さない。
- PIN が要るところ（割引・チャットの「続ける」・PIN を入れる画面など）は今までどおり。事務Crew・ほかの人は今までどおり PIN。
- UI案90 の答え（11/16 19:44 HST）はそのまま：開くたびに入れる（覚えない）・大事な操作の前に聞き直さない・新しい端末の知らせ・セキュアページはアプリの中から・経理もメールとパスワード。

## だれを止めるか

- 社員の表の役割（**列か中身のどちらか**）が ceo・gm・office の人。同じ名前の人が何人かいれば、そのだれかが当たれば止める（安全なほう）。
- manager_auth の役割では決めない（アプリがメールの段に回さない人を止めると、だれも入れなくなるため）。

## 止め方（3 か所で止める）

1. **データベース（SQL `20261206090000_top_pin_off.sql`）**
   - スイッチの表 `dl_flags`（`top_pin_off`）。SQL を流したときに入る。`PIN_を戻す.sql` で外す。
   - `dl_top_pin_off()`：スイッチが入っていて、**v1185 のメールのログイン（`dl_email_login`）があるときだけ** true。v1185 の `止める.sql` でメールのログインを外すと、PIN は自動で戻る。
   - `dl_pin_blocked(p)`：その人（社員の ID か名前）の PIN のログインを止めるか。auth-pin・emp-private が PIN を確かめたあとに聞く。
   - `dl_top_pin_info`：関数 device-login の `login_info`（ログインの画面が「PIN でログイン」を出すか）。人によらない。
   - `dl_emp`：止めているあいだは経理も「試せない人」（`top`）に入れる（ログインの試しの端末＋PIN で入れない）。
   - **先に止まる**：在籍の GM・CEO・経理で、メールのアカウント（manager_auth の ceo・gm・office）と結ばれていない人が 1 人でもいれば、何も変えずに STOP（名前と数）。
   - 新しい端末の知らせ（`dl_email_notice`）：足したあと時刻の順に並べてから 500 件にする（アプリ・secure-state と同じ）。
   - 表・関数はサーバーの鍵だけ。security invoker・search_path 固定。社員の表・manager_auth は読むだけ。
2. **auth-pin v1186（非公開の 1 ファイル・まだ作っていない＝今のソース待ち）**：PIN が合っても、止めている人には**ログインの印を出さず** `{ok:true, use_email:true}`。割引・チャットの「続ける」などは `ok:true` のままなので今までどおり。`dl_pin_blocked` が無い（404）＝SQL がまだ：止めない。
3. **emp-private v1186（非公開の 1 ファイル）**：止めている人には PIN では給与を渡さない（印なら渡す）。auth-pin が `use_email` と答えたときも断る。`dl_pin_blocked` が 404：止めない／そのほかの失敗：社員の表の役割が ceo・gm・office なら止める（安全なほう）。

## アプリ v1186

- `FUNERGY_ML`：ログインの画面を開くと device-login の `login_info` を聞く（`S.pinOff`：分からない／止めている／止めていない）。**止めていると分かったときだけ**「PIN でログイン」を出さない。分からない（通信が切れた・関数が前の版・SQL がまだ）ときは v1185 と同じ。
- `doStaffLogin`：止めている人は auth-pin を呼ぶ前にメールの段へ。auth-pin が `use_email` と答えたら（PIN は合っている）、印を捨ててメールの段へ（PIN では入らない）。アプリの名簿では GM・CEO・経理でない人（列と中身がずれている人など）でも、サーバーが `use_email` と答えた人は、その開いているあいだメールの段に回す（入れるかはサーバーが決める）。
- 給与（emp-private）：メールで入った人は印を先に使い、断られたら PIN（あれば）。PIN で入った人は PIN。
- **#183 の Codex（6941809468・`b91e73b`・blocked）の P2 2 つ**：
  - P2-1：30 分ごとの取り替えで、社員の ID か役割が変わっていたらログアウト（「権限が変わりました」）。前は止まった・退職のときだけだった。
  - P2-2：メールの段の途中で「戻る」（`hideStep`）を押したあと、遅れて届いた答えでログインしない（世代 `S.gen` を進める・押せる状態に戻す）。

## 気をつけること・限界

- **端末を 1186 にしてから SQL**。1185 以前のアプリのまま SQL と auth-pin v1186 を入れると、GM・CEO・経理が PIN を押したとき「通った」ように見えて画面は開くが、印が無いので給与・成長カルテなどが読めない。アプリを更新してメールとパスワードで入り直す。
- **auth-pin v1186 を入れないまま SQL を流すと、止まるのは画面だけ**（1186 のアプリはボタンを出さないが、前のアプリや直接の呼び出しでは PIN でまだ印が出る。給与だけは emp-private v1186 が PIN では渡さない）。
- 列と中身の役割が違う人（例：列は crew・中身は gm）は止める。アプリが PIN の段に回しても、auth-pin v1186 が `use_email` と答えてメールの段に回す（auth-pin v1186 が入るまでは、その人は PIN で入れる）。
- 経理のログインの試しの端末は、SQL のあと使えなくなる（メールとパスワードで入る）。
- 戻すのは `PIN_を戻す.sql`（スイッチだけ・2 回流しても同じ）。もう一度止めるときは SQL をもう一度。

## 試験（合成データ・架空の名前。本番にはつながない）

- `tests/pin-off-v1186.test.mjs` 6：本物の SQL（PGlite で v1183 → v1185 → v1186）と本物の handler。先に止まる（3 人・2 人・v1185 がまだ）・スイッチと v1185 を外したとき・経理の `top`・`login_info`（SQL の前は false）・経理のメールのログイン・知らせの並びと 500 件・公開の鍵で読めない／呼べない・3 回流しても同じ・invoker と search_path。
- `tests/pin-off-deploy-v1186.test.mjs` 4：2 の SQL は migration と同じ・①（STOP・名前・まだメールで入っていない人・列と中身・経理の試し）・③（NG なし・2 回・公開の鍵・definer・スイッチ・並べ替え・入れる前は 6 つ NG）・`PIN_を戻す.sql`（入れる前は STOP・戻す → 入れ直す・v1185 の `止める.sql` で PIN も戻る）。v1186 のあとも v1183・v1185 の ③ は NG なし（v1183 の ③ の関数の数から v1186 の 4 つを外した）。
- `tests/email-login-app.test.mjs` 19（v1186 の 6 を足した）：「PIN でログイン」を出す／出さない・分からないときは v1185 と同じ・本物の `doStaffLogin`（止めていると分かっている／auth-pin の `use_email`／Crew と店のログインは今までどおり／名簿がずれている人はメールの段へ）・役割が変わったらログアウト・`hideStep` のあとログインしない・知らせ・給与は印を先に。
- e2e（本物の Chrome・合成データ）`tests/e2e-login/pin-off-v1186.mjs` 19/19：SQL の前は v1185 と同じ → SQL のあと GM（390px）・経理（英語・PC）は PIN のボタンなし・画面の外から PIN の段に切り替えても出ない・GM はメールで入り給与は印で・Crew は PIN・名簿のずれた人は PIN が合ってもメールの段へ → メールで入る → `PIN_を戻す.sql` で GM がまた PIN で入る・pageerror 0・device-login の 500 なし。auth-pin・emp-private は v1186 と同じ決まりの代わり（本物の SQL の `dl_pin_blocked`）。v1183・v1185 の e2e（52/52・36/36）も流し直した（模擬の関数が無い関数に 404 を返すように直し、`login_info` を device-login の呼び出しの数から外した）。
- わざと壊す：アプリ・SQL 29/29・入れる一式 11/11。
- 非公開の試験（Claude の手元）：emp-private v1186（SQL の前は PIN で読める → SQL のあと PIN では断る・印では読める → 戻すと PIN でも）・device-login v1186（`login_info`）・device-login の印を emp-private が受ける。
- 関連：device-login-server・app・deploy、email-login-server・deploy、chat-ui79-app-v1167、ux-core、pin-admin-email、toast-session、invoice-signin-keep。static release pass/1186。
- 実機・本番・auth-pin v1186 は未確認。
