# Funergy Growth OS — 引き継ぎ v825

前回の引き継ぎは v807。この期間で **v808 → v825** まで進めた。
中心は新機能「Management Control（管理統括）」の新設。
終盤で**実データの消失事故**が起き、その原因と修正まで含まれる。

---

## 0. 最初にやること

**展開**

```bash
unzip funergy_v825_handoff.zip
tar -xJf handoff_v825.tar.xz
cd handoff_v825
node run_verify.js
```

**期待値（これと違ったら、まず原因を確かめてから作業に入る）**

```
合計 PASS=2681  FAIL=0  実行=49/64
合流ルールの未定義: 1        ← spl_skills_st_ の1件だけが既知（v807 から変化なし）
同期対象で未保護: 11         ← 塞ぐたびに1つずつ下げる。増えたら新しい穴
予算の対象月: 3 / 7          ← 要確認3件は確認済みの偽陽性
APP_VERSION=825 / SW_BUILD=825
CRLF=55799 / lone LF=0
```

**時計に注意。** `verify_v814` の [5]「データの新しさ」は 2026-08-02（ハワイ）を前提に
日付を固定してある。UTC の日付が進んでいる環境ではここだけ2件落ちる。製品の問題ではない。

```bash
TZ=Pacific/Honolulu node run_verify.js
```

`実行=49/64` の残り15本は v761〜v781 のバックアップが手元に無いためスキップされる。
製品の問題ではない。v807 から本数も理由も変わっていない。

**次に、GitHub main と手元を突き合わせる。**

```bash
curl -sL -o /tmp/gh.html https://raw.githubusercontent.com/motoi107/funergy-growth-os/main/index.html
md5sum /tmp/gh.html index.html
```

一致しなければ、どちらが新しいか確認してから作業する。

**PostgreSQL があると検証が2本増える。** 無ければ自動で飛ばす（FAIL にはならない）。

```bash
apt-get update && apt-get install -y --no-install-recommends postgresql
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /tmp/pgdata -A trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgdata -o '-p 5433 -k /tmp' -l /tmp/pg.log start"
su postgres -c "psql -h /tmp -p 5433 -d postgres -c 'create role anon; create role authenticated;'"
```

`verify_v815`（エスカレーション）と `verify_v817`（後片付けSQL）が実際に DB で動く。
**サーバーはツール呼び出しをまたぐと落ちることがある。** 落ちていたら起動し直す。

---

## 1. この期間でやったこと

### Management Control（管理統括）— v808〜v814、v816〜v824

| 版 | 内容 |
|---|---|
| v808 | 管轄・権限の解決（`mc*()`）＋ DBスキーマ8表。画面なし |
| v809 | 画面の骨格。フィルター・サマリー・分野タブ。読み取りのみ |
| v810 | 保存と状態管理。version 楽観ロック・監査ログ・詳細シート |
| v811 | 店長通知・対応依頼・コメント。RPC `mc_notify`（通知とOutboxを1トランザクション） |
| v812 | 検知ルール本体（予実・人件費・原価・育成＋エラーセンター橋渡し）・基準タブ |
| v813 | 自動保存（700ms）・保存状態表示・複数端末同期（Realtime） |
| v814 | エスカレーション（JS版）・データの新しさカード |
| v815 | **エスカレーションを DB へ1本化**（RPC `mc_escalate` + pg_cron 15分ごと） |
| v816 | 検知追加（新規材料・仕入単価・内容量変更・仕入過多・客数・客単価） |
| v817 | 初回検知の事故対応（後述） |
| v818 | 数値の単位（件数を金額表示していた）・エラーセンター由来を注意どまりに |
| v819 | 再検知のたびの無駄な書き込みと監査ログを止める |
| v820 | 月初は予測を出さない（実績3日未満）・事務作業を緊急にしない |
| v821 | 値の見出しをルールごとに（「現在値 24.8%」が単価ではなく上昇率だった） |
| v822 | 期間を「対象月」で判定・勤怠とチップの混在を分離・説明を具体化 |
| v823 | **ワークセンターへ統合**・上部に「整備中」を大きく表示 |
| v824 | Head Chef を原価・仕入の担当として通知先に追加 |

### 日次売上の消失事故 — v825

**8/2、Tenkichi の 7/1〜7/18 が全端末から消えた。**

原因：`daily_actuals_<店舗>` はクラウド同期対象なのに**合流ルールが無く「丸ごと上書き」**だった。
ログイン時の自動同期は `recentDays(14)` しか見ない。
14日ぶんしか持たない端末が押し上げ → クラウドが置き換わり → 全端末に伝播。

v825 で `OP_MERGE_PREFIX` に `'daily_actuals_': { merge: mergeMapByTime, covers: _coversMapByTime }`
を登録し、日付キーの和集合にした。合流関数自体は触っていない。

---

## 2. 未確認・保留（Motoさん待ち）

### ① 合流ルールが無いキーが、あと11個ある ← 最優先

```
help_requests_  ot_approvals_  shift_fixed_  fc_monthly_  dailyops_
orders_  warnings_  reminded_  shiftopt_  menu_mix_  labor_hours_
```

`verify_v825.js` と `audit_merge_coverage.js` を実行すると毎回この一覧が出る。隠れないようにしてある。

**【訂正】この一覧は当初「12個」で、先頭に `sl_manual_` が入っていた。誤りだった。**
`sl_manual_` は **v807 で既に保護されている**（`_opMergeDef` の先頭に直書きの分岐。
index.html 9210〜9211行 → `mergeMapByTime` / `_coversMapByTime`）。
当時の監査が `OP_MERGE_PREFIX` の宣言テキストしか見ておらず、直書きの分岐を拾えていなかった。
監査は修正済み（第2章②）。

**次に着手するのは `fc_monthly_`（原価）。**
ただし形が単一オブジェクトなので `mergeMapByTime` は使えない（下表）。

**必ず中身の形を確認してから登録すること。** 配列に `mergeMapByTime` を当てると壊れる。
確認済みの形：

| キー | 形 |
|---|---|
| `daily_actuals_<店>` | `{ '2026-07-01': {...} }` 日付キー（登録済み） |
| `sl_manual_<店>` | 日付キー（v807 で登録済み） |
| `labor_hours_<店>_<週>` | `{ 従業員名: {regular,ot,wage,source} }` 名前キー |
| `ot_approvals_<店>_<週>` | オブジェクト |
| `shift_fixed_<店>` | オブジェクト |
| `shiftopt_cfg_<店>` / `shiftopt_mem_<店>` | オブジェクト（キーは `shiftopt_` の後に用途名が入る） |
| `help_requests_<店>` | **配列** |
| `orders_<店>` | **配列** |
| `warnings_<店>` | **配列** |
| `reminded_<店>_<週>` | **配列** |
| `dailyops_complete_<店>` / `dailyops_template_<店>` | **配列**（`dailyops_` の後に用途名が入る） |
| `fc_monthly_<店>_<ym>` | **単一オブジェクト** `{beginInv,endInv,sales,beginAuto}` |
| `menu_mix_<店>_<期>` | **単一オブジェクト** `{items:{recipeId:qty}}` |

**単一オブジェクトの2つ（`fc_monthly_` / `menu_mix_`）に `mergeMapByTime` を当ててはいけない。**
項目名（`beginInv` 等）を日付キーだと誤解して壊れる。
形としては v750 の `_stDef()`（保存者・時刻の印で新しい方が勝つ）が合うが、
**既存データに印が入っているかを先に確認すること。**

### ② 既存監査の穴 ← **修正済み**

監査は2本あり、それぞれ**別の片肺**だった。

| | 対象範囲 | 判定方法 |
|---|---|---|
| `audit_merge_coverage.js` | `LS_NEVER_FREE`（手入力のみ）❌ | 実 `_opMergeDef` を通す ⭕️ |
| `verify_v825.js` [6] | `OP_SYNC_PREFIX`（同期対象すべて）⭕️ | 宣言テキストの文字列一致 ❌ |

前者は `daily_actuals_` を見ておらず事故を防げなかった。
後者は `_opMergeDef` の直書き分岐を見落とし `sl_manual_` を誤って未保護と数えていた。
**「対象範囲」と「判定方法」が別々の場所で二重に実装され、両方が欠けていた**のが根本原因。

**修正**：`merge_probe.js` を新設して1本化した。

- 判定は必ず実コードの `_opMergeDef` を通す（宣言テキストの一致で代用しない）
- 対象は `OP_SYNC_PREFIX` 全部（同期する以上は全部見る）＋従来の `LS_NEVER_FREE`
- 前方一致キーは**実際に保存される完全なキー名**へ展開してから判定する。
  見本が無いキーは推測せず**エラーで止まる**（黙って「保護済み」と誤報告しない）。
  同期対象のキーを増やしたら `merge_probe.js` の `SAMPLE` にも実キー名を足すこと
- `run_verify.js` に基準値「同期対象で未保護: 11」を追加。塞ぐたびに1つ下げる

### ③ Toast 同期まわり

- ログイン時の自動同期は **直近14日のみ**（`loginToastAutoSync` の `recentDays(14)`）
- 手動の「同期」ボタンは**画面で見ている月のみ**（`monthDays()` は `dailyMonthOffset` に従う）
- 月をまたいだ取り込みは **同期センター → 店舗選択 → 期間指定取り込み**（`doRangeImport`）が正規の手段
- `check_toast_sync.sql` で欠損日・GUID・cron の状況を切り分けられる

### ④ Management Control 側の残り

- **管理統括はまだ「整備中」表示中。** 完成したら `mcUnderConstructionHtml()` と
  `renderMgmtControl` 内の呼び出し1行を消す
- **理論消費と実消費の差**は未実装。`fv_variance` が Totoya 専用で、
  レシピ網羅率が店舗ごとに違うため全店に広げると誤検知になる
- **7月（前月）の検知結果を Moto さんがまだ見ていない。**
  「前月」タブを選んで再検知すると7月を検知する（過去月では通知しない）。
  そこで閾値の妥当性を実データで詰める予定だった
- 実機でのスマホ確認が未

### ⑤ v807 から持ち越し（未着手）

- **Tip入力権限の調査**（v626 でG1解放・v630でg2正規化済みなのに入力できない人がいる）。
  v792 の診断画面（チップ管理→入力権限）の結果待ち
- **AM の管轄割り当ての実データ確認**（v800 の画面）
- **LaLa**：Chika・Aya のロールが `chef` / `office_crew` になっているか
- **`supabase/functions/` が未push、`hyper-worker` が未デプロイ**。
  エスカレーションは v815 で SQL に移したので外れたが、
  **Shift Leader の自動判定と Toast同期後の自動検知**にはまだ必要

---

## 3. 適用が必要な SQL（順番どおり）

| ファイル | 内容 | 状態 |
|---|---|---|
| `management_control_v808.sql` | 8テーブル＋RLS | 適用済み |
| `management_control_v811.sql` | RPC `mc_notify` | 適用済み |
| `management_control_v815.sql` | RPC `mc_escalate` ＋ pg_cron | **v824 で chef を追加。流し直しが必要** |
| `management_control_v822_cleanup.sql` | 勤怠とチップの混在を作り直す後片付け | 適用済み |

`create or replace` なので何度実行しても壊れない。

**確認用（読み取りのみ）**

- `check_mc_v818.sql` — ルール別・店舗別の件数、通知の状況、検知の実行結果
- `check_toast_sync.sql` — Toast の取り込み状況、欠損日、pg_cron の実行結果
- `test_mc_escalate.sql` — エスカレーションの動作テスト（検証用DBで実行）

---

## 4. ビルド手順（厳守・v807 から変更なし）

1. `cp index.html index_vNNN_backup.html`（必ず変更前に）
2. Python の透過置換。`open(newline='')` で CRLF を保つ。アンカーは `assert count == 1`
3. 新規の大きいブロックは別ファイル（LF）で作り、`replace('\n','\r\n')` して差し込む
4. `APP_VERSION` と `SW_BUILD` を同時に上げる
5. Node で構文チェック（`new Function()`）
6. `lone LF = 0` を確認
7. `node run_verify.js` で全体
8. `/mnt/user-data/outputs/` へコピー → `present_files`

**MINUTES_SEED と HANDBOOK_SEED は grep -v で除外する。**

**改行の一括正規化をしたら、必ず差分を取って意図した範囲だけか確かめる**（v819 で実施）。

```python
import difflib
la, lb = prev.split('\r\n'), now.split('\r\n')
sm = difflib.SequenceMatcher(None, la, lb, autojunk=False)
print([op for op in sm.get_opcodes() if op[0] != 'equal'])
```

---

## 5. この期間の失敗から得た教訓

v807 の教訓①〜⑤はそのまま有効。以下は今回追加分。

### ⑥ 検証は「その版のビルド」と比べる（教訓①の具体形）

v808 の検証を `index.html`（＝常に最新版）と比べて書いたため、
v809 が正当にタブを足した瞬間に4件落ちた。

**「この版が何を変えなかったか」は `index_vNNN_backup.html` と比べる。**

```js
const src = fs.existsSync('index_vNNN_backup.html')
  ? fs.readFileSync('index_vNNN_backup.html', 'utf8') : _cur;
function unchangedIn(ver, fn) { ... }
```

SW_BUILD の一致確認も `src === _cur` のときだけ行う。

### ⑦ 環境が理由で動かないものを FAIL にしない（教訓②の具体形）

`verify_v815` が PostgreSQL を使う。サーバーが落ちていると FAIL に見えた。
**psql の有無だけでなく、接続できるかまで見て、駄目なら「飛ばす」。**

### ⑧ 単位と見出しは、値が入っているかとは別に確認する

v809 から10版ぶん、現在値・目標値・月末予測を**すべて `fmtMoney()` に通していた**。
件数9件が「$9.00」、人件費率34%が「$34.00」、客数700人が「$700.00」。
検証は「値が入っているか」しか見ておらず、**単位が正しいかを見ていなかった**。

さらに単位を直した次の版で、今度は**見出しが合っていない**ことが分かった
（「現在値 24.8%」は単価ではなく上昇率）。
**数字は「値・単位・見出し」の3つが揃って初めて意味を持つ。**

これは Moto さんが実画面を見て指摘するまで出てこなかった。**机上の検証の限界。**

### ⑨ 分類を統合するときは、統合後も区別が要るかを確かめる

エラーセンターの「勤怠」と「チップ」を同じ分野（`labor`）に割り当てたため、
同じ店舗で1件に混ざり、**タイトルは先に見つかったほうの名前**になっていた。
「勤怠の不備 9件」の中にチップの不備が入っていた。

### ⑩ 「再生成できる」は「自動で戻る」ではない

`daily_actuals_` を合流ルールの対象外にした理由は「Toast から再生成できるから」。
しかし再生成には**人が期間一括取り込みを回す必要があり**、
誰かが気づくまで全端末からデータが消えたままだった。

**消えて困るデータは、戻し方が自動かどうかで判断する。**

### ⑪ 初回投入は件数と通知の桁を先に見積もる

v812 の初回検知で **103件のアラートと約300通の通知**が一度に飛んだ。
仕様§9「毎回新しい通知を大量に作らない」に反していた。

v817 で ①確認レベルは個別通知しない ②1回の検知で個別通知は10件まで（緊急は例外）
を入れた。**新機能を実データに当てる前に、件数の桁を見積もる。**

### ⑫ 同じ漢字の書き間違いを2回した

`轄`（U+8F44）を `辖`（U+8F96・簡体字）と書いた。2回とも検証で捕まえた。
**日本語をコード内に書くときは `\uXXXX` で書かず、ファイル全体を走査して確認する。**

```python
assert open('index.html',encoding='utf-8').read().count('\u8f96') == 0
```

### ⑬ 監査は「対象範囲」と「判定方法」が揃って初めて機能する

合流ルールの監査が2本あり、片方は範囲が狭く、もう片方は判定が雑だった。
どちらも「監査している」ように見えていたので、
**穴が2種類あることに、事故が起きるまで誰も気づかなかった。**

- 範囲の欠け → `daily_actuals_` が対象外 → 7月前半が消えた
- 判定の欠け → `sl_manual_` を未保護と誤報告 → 直っているものを直そうとしていた

**宣言テキストの文字列一致で、実コードの判定を代用しない。**
コードは直書きの分岐・前方一致・別関数への委譲で結論を変える。
監査は必ず実関数を呼ぶ。呼べる形に切り出す。

そして**同じ判定を2か所に書かない。** 片方だけ直すと必ず食い違う。
（v815 で「エスカレーションの判定を DB に1本化」したのと同じ理屈。）

**⑧と同じ形の失敗でもある。** ⑧は「値は見ていたが単位を見ていなかった」。
⑬は「保護の有無は見ていたが、判定経路を見ていなかった」。
**確かめたつもりの範囲の外に、いつも穴がある。**

---

## 6. 重要な設計上の決定（次回、勝手に変えないこと）

### 権限（v808・確定）

- **権限はアプリ層で判定する（案A・Motoさん確認済み）。** Supabase は anon キー1本、
  RLS は anon 許可のポリシー1本のみ。＝バックエンドでは防いでいない。既存の全画面と同じ水準
- **管轄は店舗マスターの `am` 欄が正**（v799 の決定を踏襲）
- **店長は role では決まらない。** `role='g4'` の人と `role='sl'+title='Store Manager'` の人が両方いる。
  かつ `GRADE_TITLES` の G4 には `Accountant` / `Office Manager` / `Head Chef` も入っている。
  **Grade だけで判定すると経理が店長になる。** `mcIsStoreManagerEmp()` が唯一の判定口
- **`ROLE_ALIAS = {g4:'am'}` により店長の `curRole` は `am` になる。**
  NAV の roles だけでは塞げない。`mcCanOpen()` を必ず通す（二層）
- **AM は管轄内なら解決まで実行可**（Motoさん確認済み）
- **店長の完了報告ではアラートを解決しない。** GM / 管轄AM が確認して初めて解決

### Head Chef（v824・Motoさん確認済み）

- **G4 なので表示は店長と同じ。** 管理統括タブは出ない。対応依頼から入る
- **担当は原価・仕入のみ。** その分野のときだけ通知先に入る
- Head Chef しかいない店舗は、**原価・仕入では「店長未設定」にしない**。それ以外はする
- Corporate Chef（Chika、`role='chef'`、全店）は別枠。管理統括タブが出て、原価・仕入分野のみ見える

### 検知（v812・v816・v820）

- **数字の計算を新しく作らない。** 予実 = `cumulativeToToday()` / 原価 = `foodCostOf()` /
  人件費 = `laborCoreForYm()` / 目標 = `getStoreKpiTargets()` / 不備 = `ecCollect()`
- **検知は純粋な関数。** 保存も通知もしない。`mcRunDetection()` だけが書き込む
- **判定基準をコードに固定しない。** `management_thresholds` → 既定。GM が「基準」タブで変更できる
- **検知しなくなっても自動で解決にしない**（「見えなくなった＝直った」ではない）
- **月初は予測を出さない**（実績3日未満）。ただし棚卸で確定した原価率は日数に関係なく出す
- **影響額を持つのは3ルールだけ**（月末売上の不足・人件費の超過・原価の超過）。
  客数・客単価・進捗の遅れ・仕入過多は内訳なので合算しない

### 保存（v810・v813・v819）

- **更新は必ず `version` を条件に入れる。** 0件が返れば競合＝上書きしない
- **競合しても押し切らない。** 最新を読み直して知らせ、**入力中の文字は消さない**
- **入力中に画面を作り直さない**（カーソルが外れて日本語入力が途切れる）。状態表示だけ書き換える
- **中身が変わっていなければ書き込まない。** 監査ログも変わったときだけ
  （毎回43件更新＋43行のログが出ていた）

### 通知（v811・v815・v817）

- **宛先は毎回マスターから引く。** 名前をコードに固定しない
- **通知を破棄しない。** 店長不在なら AM と GM へ。設定の不備自体をアラートにする
- **通知本体と Outbox は1トランザクション**（RPC `mc_notify`）
- **無い連携に仮の送信処理を作らない。** アプリ内通知は行が入った時点で送信完了
- **エスカレーションの判定は DB に1本化**（`mc_escalate`）。JS に書き戻さない
- **宛先はマスターを引き直さず、そのアラートに既に届いている通知から採る**
  （SQL で店長判定をやり直すと `mcIsStoreManagerEmp()` と必ず食い違う）

---

## 7. 同梱ファイル

| ファイル | 用途 |
|---|---|
| `index.html` / `sw.js` | v825 本体 |
| `run_verify.js` | 検証と監査の一括実行 |
| `verify_v762`〜`v825.js` | 各版の検証 |
| `index_v782`〜`v825_backup.html` | 検証が「修正前」として使う |
| `merge_probe.js` | 合流ルール判定の共通部品（実 `_opMergeDef` を通す・第2章②） |
| `audit_merge_coverage.js` | 合流ルールの網羅チェック（手入力＋同期対象すべて） |
| `audit_budget_month.js` | 予算の対象月チェック |
| `management_control_v808.sql` | 8テーブル＋RLS |
| `management_control_v811.sql` | RPC `mc_notify` |
| `management_control_v815.sql` | RPC `mc_escalate` ＋ pg_cron（**要・流し直し**） |
| `management_control_v817_cleanup.sql` | 後片付け（v817・適用済み。`verify_v817` が参照するので消さない） |
| `management_control_v822_cleanup.sql` | 後片付け（v822・こちらが最新。勤怠とチップの分離用） |
| `test_mc_escalate.sql` | エスカレーションの動作テスト |
| `check_mc_v818.sql` | 管理統括の現状確認（読み取りのみ） |
| `check_toast_sync.sql` | Toast 同期の切り分け（読み取りのみ） |
| `hyper-worker_index.ts` | Edge Function（未デプロイ・v807 から変化なし） |
| `verify_edge.mjs` | Edge Function の検証 |
| `HANDOFF_v807.md` | 前回の引き継ぎ（教訓①〜⑤はそのまま有効） |

---

## 8. 次のセッションの入り方

1. `node run_verify.js` → 第0章の期待値と一致するか
2. GitHub main と md5 を突き合わせ
3. **`node audit_merge_coverage.js` の第2部（同期対象で未保護11個）を確認**
4. 第2章の未確認事項を Motoさんに確認
5. 作業に入る

**最初に着手すべきは第2章①（`fc_monthly_` の合流ルール）。**
日次売上と同じ事故が、原価データで起きうる状態がまだ残っている。
形が単一オブジェクトなので、`mergeMapByTime` ではなく印による判定が要る。

**Motoさんの進め方**：「憶測で修正しない」。原因を確かめ、
設計 → 確認 → 実装 を一歩ずつ。分からないことは推測で埋めず聞く。

**Motoさんは実画面を見て的確に指摘する。** 今回も
「仕入単価の現在値が％表示ってなに？」「これの意味がわからない」から
重大なバグが3つ見つかった。**画面を見せてもらう機会を作ること。**
