# Funergy Growth OS 引き継ぎ（v772 → v773）

## 現在の状態

- `index.html` APP_VERSION = **773** / `sw.js` SW_BUILD = **773**（一致）
- CRLF 50,348 ・lone LF = 0 ・構文チェック OK
- 検証：`verify_v764` / `v767` / `v769` / `v770` / `v771` / `v772` / **`v773`** すべてPASS（合計 242項目）
- 監査：`audit_merge_coverage.js` は `spl_skills_st_` の1件のみMISS（既知の名残）／
  `audit_budget_month.js` は要確認3・解決済み7（**v772から変化なし**）

### 検証スクリプトの実行に前版ファイルが要る

`verify_v762` / `v763` / `v765` / `v766` / `v768` は、前版の `index_v76x_backup.html` を
読んで「修正前の症状」と比較する作りになっている。前回のzipに前版が入っていなかったため
ENOENT で実行できなかった（**製品の失敗ではなくハーネスの入力不足**）。

**次回のzipには、今回の `index.html` を `index_v773_backup.html` としてコピーして同梱すること。**
これが無いと `verify_v774` が同じ理由で動かない。

---

## ⚠️ デプロイ状況

| 版 | 状態 |
|---|---|
| 〜v772 | **本番反映済み。iPhoneで動作確認済み** |
| v773 | **未デプロイ** |

---

## Motoさんの手作業が必要なもの（未完・v772から変化なし）

| # | 内容 | 理由 |
|---|---|---|
| 1 | **Corporate Chef の従業員マスターで role を `chef` に変更** | これをしないと本部ログインの候補に出ない（v766） |
| 2 | **DOHチェック項目27件を実際の検査票と突き合わせ** | 既定値で入れてある。Motoさん・Chikaさんの確認が必要（v769） |
| 3 | **指標の目標値の初期設定** | 原価率・DOH適合率などの目標は本部(GM)が入力する（v768〜） |
| 4 | **Marujuu 7月の予算を入れ直す** | v761から持ち越し。自動では復元できない |
| 5 | 入れ直す前に**6月に見覚えのない数字が無いか確認** | v761から持ち越し |
| 6 | **他店舗の当月予算が意図した数字か確認** | v761から持ち越し |
| 7 | **Kaimuki / Piikoi のスキルレベルを一度保存し直す** | v761から持ち越し。1回上書きすれば以後正常 |
| 8 | **Career Score も一度保存し直す** | 同上 |
| 9 | v752 のスキル修正について**スタッフからの確認結果**を待ち | v761から持ち越し |

---

## このセッションでやったこと（v773）

### 優先タスク②「容量警告・自動pruneの撤去」

**根本原因（推測ではなくコード上の経路として確認した）**

1. 二重書きが続いているので localStorage は今も全キーを書き、実機で ~4.8MB のまま
2. `initApp()` が起動のたび `autoPruneIfCritical()` を**無条件で**実行（8327行）
3. 4.3MB超なので `_lsFreeOldLaborKeys(2)` → まだ超なら `_lsPrunableKeys()` を全削除
4. ただし v702 のホワイトリストで削除できるのは `tip_labor_` / `warnings_` / `reminded_` の
   3つだけ。残りは手入力データで保護されているため、**総量は4.3MBを下回らない**
5. その結果、起動直後には「整理可能 0.0MB」なのに `renderStorageCard()` は
   localStorage だけを 5MB で割るので**赤の95%のまま**
6. ボタンを押すと `_lsPrunableKeys()` が空 →「整理できるキャッシュはありません」

**赤くなる原因と、押しても何も起きない原因は同じだった**（自動pruneが起動時に消し切っている）。

**修正：判定を `_idbState` で分岐させた**

| `_idbState` | 自動prune | 容量カード |
|---|---|---|
| `ready` | **行わない** | IndexedDB基準の数字のみ。5MBメーター・赤・「上限に近づいたら」を撤去 |
| `init` | **行わない** | 「確認中…」 |
| `unavailable` | 従来どおり | 従来どおり（5MBメーター・赤） |

**`'ready'` ではなく `'unavailable'` で判定している理由（重要）**

`_idbBoot()` は `setTimeout(...,0)` の非同期（50287行）、`initApp()` は同期。
**起動時点で `_idbState` が `'ready'` である保証がない。**
`=== 'ready'` を条件にすると、判定が間に合わなかった起動では従来どおり削除してしまう。
**分からないうちは消さない**、が正しい。`verify_v773` のテスト3がこれを機械的に押さえている。

そのかわり `_idbBoot()` に `finally` を足し、`unavailable` に確定したときだけ
`autoPruneIfCritical()` を1回呼ぶ。`unavailable` の確定は3経路（開けない／読めない／例外）
あるため `finally` でまとめた。

**あわせて直したもの**

- **整理できるキャッシュが0件のときはボタンを出さない**（押しても「ありません」しか出ず、
  混乱の元になっていた）。件数があるときはMB数もボタンに出す
- 「保存容量が上限」の文言4箇所を `_capacityCauseText()` に集約し、`_idbState` で出し分け
  （データ管理 / 勤怠診断 / スキル診断 / Invoice）。
  IndexedDB が使えている端末で容量を疑わせると、**整理しても直らない作業へスタッフを誘導する**

### 変更箇所

| 対象 | 内容 |
|---|---|
| `autoPruneIfCritical()` | `_lsPruneNeeded()` のゲートを追加（新設） |
| `_idbBoot()` | `finally` で unavailable 確定時に1回だけ prune |
| `renderStorageCard()` | `_idbState` で3分岐に作り替え |
| `_capacityCauseText()` | 新設。保存失敗時の原因説明 |
| `openStorageManager()` ほか3箇所 | 上記ヘルパへ差し替え |

**呼び出し元（`initApp` / 請求書の書き戻し）は据え置き。** ゲートは関数の中に置いた。

---

## 次回の優先タスク

1. **v773 をデプロイして実機で確認**
   - 設定＞保存容量が**緑・警告なし・IndexedDBの数字**になっているか
   - 「キャッシュを整理して空ける」ボタンが**消えている**か（整理可能0件のため）
   - 勤怠・チップ・予算がこれまでどおり出るか（pruneを止めたことによる副作用が無いか）
2. **二重書きの停止**（IDB移行の最終段階）— localStorage への書き込みをやめる。
   ここまで来ると localStorage は「IndexedDBが使えない端末の退避先」だけになる
3. **既存データとの連携** — 原価率を予実から、人員をシフトから、育成をスキルから自動取得
   （現在は手入力。二重入力になっている）
4. **商品開発フロー** — 提案→試作→試食→AM以上の最終承認→販売準備→販売後評価
5. 持ち越し：①全スタッフへの従業員ディスカウント証明カード（マイページ内新設）
   ②Tip入力権限の調査（v626でG1解放・v630でg2正規化済みにもかかわらず入力できないスタッフが存在）
6. HANDOFF_v747 から未着手：Qサマリー追加項目の判断、「翌月」問題の全画面点検、日次食材差異の初期設定

### 二重書きを止めるときの注意（先に書いておく）

- `_lsStoreGet()` は `_idbState==='ready'` でなければ **localStorage を見る**。
  二重書きを止めた後にIDBが使えなくなった端末は、痩せた localStorage を読むことになる。
  止める前に「IDBが後から落ちたときの扱い」を決めること
- v773 で prune を止めたので、localStorage は今後 IndexedDB とほぼ同じ内容を保つ。
  これは二重書き停止の前段として都合がよい

### Corporate Chef Management の全体計画

`CorporateChef_開発プロンプト_v2.md` に、既存構成に合わせた開発プロンプトがある。
**サーバー側の権限制御は RLS では実装できない**（`supaHeaders()` が全端末で同じ anon key を使うため
Supabaseから見ると全員同一ユーザー）。既存の `auth-pin` / `emp-private` / `ob-private` と同じ
**Edge Function 方式**（name+PIN をサーバーで照合してGradeを判定）で実装すること。

決定済み：**レシピのバージョン管理は行わない。** 上書き更新とし、履歴は変更ログと
最終承認記録で担保する（`lastEditNote(baseKey, id)` がそのまま使える）。

---

## 検証・監査スクリプト

| ファイル | 用途 |
|---|---|
| `verify_v762`〜`v772` | （前版ファイルが要るものは上記参照） |
| **`verify_v773.js`** | **容量警告・自動pruneの撤去。v772の症状を10観点32項目で再現・比較** |
| `audit_merge_coverage.js` | 手入力データの合流ルール網羅チェック。**MISSが `spl_skills_st_` の1件だけであること** |
| `audit_budget_month.js` | 予算まわりで対象月を解決していない関数の洗い出し |

**保存層・予算・スキル・Corporate Chef を触ったら、対応する検証と監査を必ず実行すること。**

`audit_budget_month.js` の「要確認3件」（`_doSubmitBudget` / `renderBudgetBuilder` / `renderApproval`）は
**実害なしを確認済みの恒久的な偽陽性**。予算を次に触るとき、検出パターンに
`budRationale(b, ym)` 形式と `b.months[<ym変数>]` 直読みを足すとよい。

---

## このセッションで学んだこと

1. **非同期で決まる状態を同期のコードで条件にしない。** `_idbBoot()` は `setTimeout(...,0)`、
   `initApp()` は同期。`'ready'` を条件にすると「まだ分からない」を「使えない」と
   同じ扱いにしてしまう。**肯定条件ではなく否定条件（`unavailable` のときだけ消す）で書く**
2. **「危険な表示」と「打つ手なし」が同時に出たら、原因は1つのことが多い。**
   赤いメーターと空のボタンは、どちらも自動pruneが消し切っていたせい。
   別々の不具合として直そうとすると両方とも直らない
3. **後段を作る前に前段を止める。** 二重書きを止める（次回）前に prune を止めておくと、
   localStorage が IndexedDB と同じ内容に揃い、退避先として意味を持つ
4. **文言も機能。** 「保存容量が上限」と出すと、スタッフは整理という**直らない作業**をする。
   原因説明は1箇所（`_capacityCauseText`）に集約し、状態で出し分ける
5. **検証が落ちたら、まず製品かハーネスかを切り分ける。** 今回 `verify_v762` 等が落ちたのは
   前版ファイルが無かったからで、製品は無関係だった（前回の学び②の再確認）
6. **ハーネスの前提も実機に合わせる。** 最初 `verify_v773` のテスト1が落ちたのは、
   モックの「保護データ:勤怠キャッシュ」の比率が実機と違い、pruneすると閾値を
   下回ってしまったため。**症状を再現できない再現テストは、通っても意味がない**

---

## ビルド手順（厳守）

1. Python で透過的置換。`open(newline='')` で CRLF 保持、アンカーは `assert count==1`
2. Node `new Function()` で構文チェック（先頭 `<script>` を抽出）
   - **`MINUTES_SEED` / `HANDBOOK_SEED` の行だけを `grep -v` で落とすと構文が壊れる**
     （宣言が複数行にまたがるため）。**フィルタせずそのまま検査する**
3. `APP_VERSION` と `SW_BUILD` を**同時に**上げる
4. lone LF = 0 を確認
5. `/mnt/user-data/outputs/` へコピーして `present_files`
6. 危険な処理は実関数を切り出して Node でモック実行し、**修正前の症状を再現するテストを必ず入れる**
7. 大きな新規ブロックは別ファイル（LF）で作り、CRLFに変換してから差し込む

**Motoさんの開発方針：「憶測で修正しない」。根本原因を確認 → 設計 → 確認 → 実装を1ステップずつ。**

---

## 主要な定数・環境

- ロール/グレード：crew=G1, g2=G2, sl=G3, g4=G4, **chef=G4（Corporate Chef）**, am=G5, gm=G6
  - `ROLE_ALIAS = {g2:'sl', g4:'am'}` はログイン権限のエイリアスのみ。実際の `e.role` は `g2`/`g4` のまま
  - `empGrade()` は `Math.max(titleGrade, roleGrade)` の下限
- 本部のメニュー：CEO/GM = `OFFICE_GROUPS`（全部）／経理 = `ACCT_GROUPS`／Chef = `CHEF_GROUPS`
- 店舗：ToriTon(F01) / Tenkichi(F02) / FSP(F03) / Waikiki Garlic Shack(F03-G) /
  Totoya Kaimuki(F04-K)・Piikoi(F04-P)・Aiea(F04-A) / Marujuu(F05)
- Kaimuki / Piikoi のみスキル**7軸・Lv0〜4**（他店は Lv0〜3）
- 保存層：`ls` / `lsSet` / `lsKeys` / `_lsStoreGet` / `_lsRaw` / `_lsRawStr` / `_lsRawDel` / `_lsWriteVerified`
  - **新しい保存経路（`localStorage`/`IndexedDB`/`fetch` の直接呼び出し）を作らない**
  - **自動pruneは `_lsPruneNeeded()`（= `_idbState==='unavailable'`）でしか走らない（v773）**
- Supabase: `tgbhgxzehzeouopklhje` / Edge Function: `hyper-worker`, `auth-pin`, `emp-private`, `ob-private`
- GitHub: `motoi107/funergy-growth-os` → `funergy-plus.com`
