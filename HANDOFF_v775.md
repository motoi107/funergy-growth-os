# Funergy Growth OS 引き継ぎ（v774 → v775）

## 現在の状態

- `index.html` APP_VERSION = **775** / `sw.js` SW_BUILD = **775**（一致）
- CRLF 50,536 ・lone LF = 0 ・構文チェック OK
- 検証：`v764` `v767` `v769` `v770` `v771` `v772` `v773` `v774` **`v775`** すべてPASS（合計 315項目）
- 監査：`audit_merge_coverage.js` MISS は `spl_skills_st_` の1件のみ／
  `audit_budget_month.js` 要確認3・解決済み7（**v772から変化なし**）

---

## ⚠️ デプロイ状況

| 版 | 状態 |
|---|---|
| 〜v772 | 本番反映済み・実機確認済み |
| v773 | **未デプロイ** 容量警告・自動pruneの撤去 |
| v774 | **未デプロイ** 本部目標の設定タブ |
| v775 | **未デプロイ** chef ロールの本部所属化 |

3版まとめて出すことになる。**v773 は保存層に関わるので、まず一周（設定＞保存容量が緑・警告なし／
勤怠・チップ・予算が通常どおり）を確認してから v774・v775 の確認へ進むこと。**

---

## このセッションでやったこと（v775）

### 目的：キッチン管理タブを Corporate Chef へ渡す

Chikayoshi Nishihara さん（`imp4`）を **キッチン一本**（経理は外す）で切り替える方針。
マスターは `role:'office'` / `perms:'finance'` / `title:'CC'` のままだったので、
`role:'chef'` にするだけでは4つの欠落が起きる状態だった。**先に器を直してから切り替える。**

| # | 欠落 | 症状 | 修正 |
|---|---|---|---|
| 1 | `ROLE_TO_PERM` に `chef` が無い | `permFromRole('chef')` が `'crew'` に落ちる | `chef:'manager'` を追加 |
| 2 | `myGradeKey()` の対応表に `chef` が無い | title が GRADE_TITLES に無い人は `Math.max(0,0)`→**G1**。`grade_hide` で画面が隠れる | `chef:4` を追加 |
| 3 | `officeMembers()` が office/office_crew のみ | 当日ボード・勤怠・**給与計算**・メンバー一覧から静かに外れる | `hqStaffMembers()` を新設して6箇所を差し替え |
| 4 | 組織図の本部スタッフも同じ絞り込み | 組織図に出ない | `chef` を追加 |

**2 が起きる条件**：`title` が `GRADE_TITLES` に載っていれば v774 でも G4 になる。
つまり `myGradeKey` の欠落は「title が未設定・未登録のとき」に効く安全網。
実際の登録は `title:'CC'` で、**CC はどのグレードにも一致しない**ため表面化していた。
`empGrade()` は G4 を返すのに `myGradeKey()` は G1 を返す、という食い違いがあった。

### 経理側は変えていない

`officeMembers()`（経理側の名簿）はそのまま。経理画面の「Officeメンバー早見」には
chef は出ない。**本部スタッフ全般が対象の画面（当日ボード・勤怠・メンバー・給与）だけ**
`hqStaffMembers()`（経理＋事務＋Chef）に切り替えた。

表示ラベルは `officeRoleLabel()` に集約（chef→`Chef` / office→`経理` / office_crew→`事務Crew`）。
直書きの三項演算子が4箇所に散っていたので、全部ヘルパへ寄せた。

### 確認済み（変更不要だったもの）

- 本部ログインの候補：`['ceo','gm','am','office','chef','office_crew']` に `chef` あり（v766のまま）
- `CHEF_GROUPS` の**15ページすべてが `OFFICE_OK_PAGES` に入っている**（本部ログインで開ける）
- `renderOfficeAttend` の打刻カードは chef にも出るようにした（本部所属のため）

### シードも合わせた

`DEFAULT_EMPLOYEES` の `imp4` を `role:'chef'` / `perms:'manager'` / `title:'Head Chef'` へ。
**これは新規インストール時のみ有効。実データの変更は下記の手作業が必要。**

---

## Motoさんの手作業（v775 デプロイ後・最優先）

| # | 内容 |
|---|---|
| 1 | **従業員管理で Chikayoshi Nishihara の `role` を `office` → `chef` に変更** |
| 2 | **`title` を `CC` → `Head Chef` に変更** |
| 3 | **PIN を設定**（本部ログインは名前＋PINのサーバー照合） |

### title の注意

`GRADE_TITLES` では **`Corporate Chef` は G5**、`Head Chef` が G4。
8/1のG4昇格に合わせるなら **`Head Chef`** が正しい。`Corporate Chef` にすると G5 になる。

### 切り替えで失うもの（合意済み）

経理メニュー（`ACCT_GROUPS`）と `perms:'finance'`。role は1人1つで排他のため。
経理画面の「Officeメンバー早見」からも外れる。

### 月間行動計画のタイミング

8月分の提出期限は **7/25**、承認期限は **7/28**（`CC_SUBMIT_DAY=25` / `CC_APPROVE_DAY=28`）で
どちらも過ぎている。期限は表示のみで提出はブロックされないので、8月分を今から出すことも、
9月分から回すこともできる。

---

## そのほか未完（v774から持ち越し）

| # | 内容 |
|---|---|
| 1 | **設定タブで各店の原価目標％を入力**（既定値なし） |
| 2 | **G3・G2 の人数目標を店舗ごとに入力** |
| 3 | **旧指標 `m_dev`（新メニュー・シーズナル進捗）を画面から削除**（`m_grand`/`m_seasonal` と重複） |
| 4 | **DOHチェック項目27件を実際の検査票と突き合わせ**（Chikaさんと） |
| 5 | **Marujuu 7月の予算を入れ直す**／入れ直す前に6月に見覚えのない数字が無いか確認 |
| 6 | **他店舗の当月予算が意図した数字か確認** |
| 7 | **Kaimuki / Piikoi のスキルレベルと Career Score を一度保存し直す**（1回上書きすれば以後正常） |
| 8 | v752 のスキル修正について**スタッフからの確認結果**を待ち |

---

## 次回の優先タスク

1. **v773・v774・v775 をデプロイして実機で一周**
2. **Chef での実ログイン確認** — キッチン管理の15ページが開くか、勤怠の打刻が出るか、
   給与計算の対象に入っているか、グレードが G4 と表示されるか
3. **hq_goals（フリーテキストの本部目標）の整理** — 設定タブが目標の本体になったので、
   いまは両方が「本部目標」として画面に出る。残すか廃止するかを運用してから決める
4. **指標ベースのカバー率** — 現在のカバー率は `hq_goals` への紐づけを見ている。3と一緒に判断
5. **二重書きの停止**（IDB移行の最終段階）
6. **既存データとの連携** — 原価率を予実から、人員をシフトから、育成をスキルから自動取得
   （目標側は設定タブで自動化済み。次は実績側）
7. **商品開発フロー** — 提案→試作→試食→AM以上の最終承認→販売準備→販売後評価
8. 持ち越し：①全スタッフへの従業員ディスカウント証明カード（マイページ内新設）
   ②Tip入力権限の調査（v626でG1解放・v630でg2正規化済みにもかかわらず入力できないスタッフが存在）
9. HANDOFF_v747 から未着手：Qサマリー追加項目の判断、「翌月」問題の全画面点検、日次食材差異の初期設定

---

## 検証・監査スクリプト

| ファイル | 用途 |
|---|---|
| `verify_v762`〜`v768` | 前版の `index_v76x_backup.html` が要る（同梱していないと ENOENT） |
| `verify_v769`〜`v772` | グループ化・差の計算・承認後の固定・週次更新 |
| `verify_v773` | 容量警告・自動pruneの撤去 |
| `verify_v774` | 設定タブと目標の反映 |
| **`verify_v775.js`** | **chef ロールの欠落4件。9観点35項目。v774の症状を再現・比較** |
| `audit_merge_coverage.js` | 合流ルール網羅チェック |
| `audit_budget_month.js` | 予算まわりで対象月を解決していない関数の洗い出し |

**次回のzipには `index_v775_backup.html`（今回の index.html のコピー）を同梱すること。**

---

## このセッションで学んだこと

1. **ロールを1つ足すと、そのロールを知らない場所が全部欠落する。** v766 は `chef` を
   ログイン候補・メニュー・`empGrade()` に足したが、`ROLE_TO_PERM`・`myGradeKey()`・
   `officeMembers()`・組織図の4箇所が取り残されていた。**新しいロールを足したら、
   既存ロールを列挙している箇所を機械的に洗い出す**
2. **同じことを2つの関数が別々に判定していると、いつか食い違う。** `empGrade()` は G4、
   `myGradeKey()` は G1 を返していた。今回は片方を直したが、本来は1本にすべき
3. **「名簿」は用途で分ける。** `officeMembers()` は経理側の名簿と、本部スタッフ全般の
   両方に使われていた。分けないと、ロールを変えた瞬間に給与計算の対象から静かに外れる
4. **アンカーが外れたら、それは検出であって失敗ではない。** 今回 `assert count==1` が
   ラベル置換で止まり、実際には同じ行が2箇所（当日ボードとメンバー一覧）にあって
   後続行だけが違うと分かった。**曖昧なまま置換していたら片方を壊していた**
5. **再現テストの前提が実態とずれていると、通っても意味がない。** 最初のテストは
   `title:'Head Chef'` で書いていたが、実際の登録は `title:'CC'`。前者では症状が出ない。
   v774 のときと同じ失敗をした（**モックは実データに合わせる**）

---

## ビルド手順（厳守）

1. Python で透過的置換。`open(newline='')` で CRLF 保持、アンカーは `assert count==1`
2. Node `new Function()` で構文チェック（先頭 `<script>` を抽出）
   - `MINUTES_SEED` / `HANDBOOK_SEED` を `grep -v` で落とすと構文が壊れる。**フィルタせず検査する**
3. `APP_VERSION` と `SW_BUILD` を**同時に**上げる
4. lone LF = 0 を確認
5. `/mnt/user-data/outputs/` へコピーして `present_files`
6. 危険な処理は実関数を切り出して Node でモック実行し、**修正前の症状を再現するテストを必ず入れる**
7. 大きな新規ブロックは別ファイル（LF）で作り、CRLFに変換してから差し込む

**Motoさんの開発方針：「憶測で修正しない」。根本原因を確認 → 設計 → 確認 → 実装を1ステップずつ。**

---

## 主要な定数・環境

- ロール/グレード：crew=G1, g2=G2, sl=G3, g4=G4, **chef=G4（Corporate Chef）**, am=G5, gm=G6
  - `ROLE_ALIAS = {g2:'sl', g4:'am'}` はログイン権限のエイリアスのみ
  - `empGrade()` は title 優先→role フォールバック。`myGradeKey()` は `Math.max(title, role)`
  - `GRADE_TITLES`：**Head Chef=G4 / Corporate Chef=G5**
- 本部のメニュー：CEO/GM = `OFFICE_GROUPS`／経理 = `ACCT_GROUPS`／Chef = `CHEF_GROUPS`
- 本部の名簿：経理側 = `officeMembers()`／**本部スタッフ全般 = `hqStaffMembers()`（v775）**
- 店舗：ToriTon(F01) / Tenkichi(F02) / FSP(F03) / Waikiki Garlic Shack(F03-G) /
  Totoya Kaimuki(F04-K)・Piikoi(F04-P)・Aiea(F04-A) / Marujuu(F05)
- Kaimuki / Piikoi のみスキル**7軸・Lv0〜4**（他店は Lv0〜3）
- Corporate Chef の目標：`ccScoreView()` が唯一の読み出し口。**生の `ccScore()` を表示に使わない**
- 保存層：`ls` / `lsSet` / `lsKeys` / `_lsStoreGet` / `_lsRaw` / `_lsRawStr` / `_lsRawDel` / `_lsWriteVerified`
  - **新しい保存経路を作らない**／自動pruneは `_lsPruneNeeded()` でしか走らない（v773）
- Supabase: `tgbhgxzehzeouopklhje` / Edge Function: `hyper-worker`, `auth-pin`, `emp-private`, `ob-private`
- GitHub: `motoi107/funergy-growth-os` → `funergy-plus.com`
