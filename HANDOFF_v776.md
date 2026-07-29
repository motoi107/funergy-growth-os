# Funergy Growth OS 引き継ぎ（v775 → v776）

## 現在の状態

- `index.html` APP_VERSION = **776** / `sw.js` SW_BUILD = **776**（一致）
- CRLF 50,545 ・lone LF = 0 ・構文チェック OK
- 検証：`v764` `v767` `v769`〜`v775` **`v776`** すべてPASS（合計 337項目）
- 監査：MISS は `spl_skills_st_` の1件のみ／要確認3・解決済み7（**v772から変化なし**）

## ⚠️ デプロイ状況

| 版 | 内容 | 状態 |
|---|---|---|
| 〜v772 | — | 本番反映済み |
| v773 | 容量警告・自動pruneの撤去 | **未デプロイ** |
| v774 | 本部目標の設定タブ | **未デプロイ** |
| v775 | chef ロールの本部所属化 | **未デプロイ** |
| v776 | Office ログインの反映と表記 | **未デプロイ** |

4版まとめて出すことになる。**v773 は保存層に関わるので、まず一周してから残りの確認へ進むこと。**

---

## このセッションでやったこと（v776）

### ① 配属店舗を Office にしてもログイン画面に出ない

**根本原因**：`loginPickLocation('OFFICE')` が **role だけで絞っていた**。

```
['ceo','gm','am','office','chef','office_crew'].includes(e.role)
```

一方、店舗側の一覧は `e.store===<店舗id>` で拾う。
そのため **`store='OFFICE'` かつ role が上記以外の人は、Office側にも店舗側にも出ず、
どこからもログインできない**状態だった。

**修正**：役職での所属（従来）と、配属店舗での所属（今回）の**和集合**にした。
退職・`osDisabled` の除外は従来どおり。店舗側の一覧は一切変えていない。

### ② ログイン画面の表記を Office へ

`t('本部','Head Office')` → `Office`（所属ボタンとスタッフ選択の見出しの2箇所）。
従業員登録の配属店舗の選択肢が既に `Office` 表記だったので、そちらに揃えた。

**メニュー内の「本部」表記（`OFFICE_GROUPS` / `CHEF_GROUPS` の `gc_home`）は変えていない。**
ログイン画面だけの指示だったため。揃えるなら次回。

---

## 訂正：ページが開けなくなる件は誤り（検証済み）

**当初「配属を Office にすると `curStore='OFFICE'` になり、`OFFICE_OK_PAGES` に無いページが
Office管理に差し替わる」と書いたが、これは確認せずに書いた推測で、事実と違った。**

ログインの2経路はどちらも、Office から入ったときは `curStore` を **`'ALL'`** にしている。

| 経路 | 該当行 | 処理 |
|---|---|---|
| `finishStaffLogin()` | 8054-8058 | `loginLocation==='OFFICE'` なら `curStore='ALL'` |
| もう一方 | 8191 | 同上 |

ページゲート（8538行）は `curStore==='OFFICE'` で判定するので、
**Office からログインした人はそもそもゲートに掛からない。**

`curStore='OFFICE'` になるのは店舗切替（`switchStore`）を使ったときだけで、
その切替に Office が出るのは `['ceo','gm','office','office_crew']` に限られる（8488行）。
**`chef` は含まれないので、Corporate Chef が `curStore='OFFICE'` になる経路は存在しない。**

`verify_v776.js` のテスト8で、この5点を機械チェックするようにした。

### したがって Office 配属で追加の対応は不要

役職に応じたメニューがそのまま開く。`getVisibleStores()` も `chef` は全権ブランチに落ちるので
全店が見える。

---

## Chikayoshi Nishihara の推奨設定

| 項目 | 値 | 理由 |
|---|---|---|
| `role` | **`chef`** | キッチン管理(`CHEF_GROUPS`)が出る。ログイン候補にも入る（v766） |
| `title` | **`Head Chef`** | `GRADE_TITLES` で G4。`Corporate Chef` は G5 なので使わない |
| 配属店舗 | **全店(ALL)** | `myStoreId()` は `e.store` をそのまま返す。`OFFICE` は実在する店舗IDではないため、店舗を引くところで実在しない店舗になる |

`role` が `g4` だと、Office側の候補（`ceo/gm/am/office/chef/office_crew`）にも
店舗側の候補（`e.store===<店舗id>` が必要）にも入らず、v775 以前ではどこにも出なかった。
**今回の「反映されない」はこれが原因の可能性が高い。**
v776 で `store==='OFFICE'` でも出るようになったが、`g4` のままだと
店舗向けメニューが出てしまうので、`chef` にすること。

`getVisibleStores()` は `chef` を全権ブランチで扱うので、配属が ALL でも OFFICE でも全店見える。
ログインも v776 でどちらでも通る。**差が出るのは `myStoreId()` だけ**なので ALL が安全。

---

## Motoさんの手作業

| # | 内容 |
|---|---|
| 1 | **Chikayoshi Nishihara の `role` を `chef`、`title` を `Head Chef` に変更＋PIN設定**（v775） |
| 2 | **Chikayoshi Nishihara の配属店舗を「全店(ALL)」に戻す**（下記の理由） |
| 3 | **設定タブで各店の原価目標％と G3・G2 の人数目標を入力**（v774。既定値なし） |
| 4 | **旧指標 `m_dev` を画面から削除**（`m_grand`/`m_seasonal` と重複） |
| 5 | **DOHチェック項目27件を実際の検査票と突き合わせ**（Chikaさんと） |
| 6 | **Marujuu 7月の予算を入れ直す**／6月に見覚えのない数字が無いか確認 |
| 7 | **他店舗の当月予算が意図した数字か確認** |
| 8 | **Kaimuki / Piikoi のスキルレベルと Career Score を一度保存し直す** |
| 9 | v752 のスキル修正について**スタッフからの確認結果**を待ち |

---

## 次回の優先タスク

1. **v773〜v776 をデプロイして実機で一周**
2. **Chef での実ログイン確認** — キッチン管理15ページ・勤怠打刻・給与対象・グレードG4表示
4. **メニュー内の「本部」表記を Office に揃えるか**
5. **hq_goals（フリーテキストの本部目標）の整理** — 設定タブが本体になったので両方出ている
6. **指標ベースのカバー率** — 現在は `hq_goals` への紐づけを見ている。5と一緒に判断
7. **二重書きの停止**（IDB移行の最終段階）
8. **既存データとの連携** — 原価率を予実から、人員をシフトから、育成をスキルから自動取得
9. **商品開発フロー** — 提案→試作→試食→AM以上の最終承認→販売準備→販売後評価
10. 持ち越し：①従業員ディスカウント証明カード ②Tip入力権限の調査
11. HANDOFF_v747 から未着手：Qサマリー追加項目、「翌月」問題の全画面点検、日次食材差異の初期設定

---

## 検証・監査スクリプト

| ファイル | 用途 |
|---|---|
| `verify_v762`〜`v768` | 前版の `index_v76x_backup.html` が要る |
| `verify_v769`〜`v772` | グループ化・差の計算・承認後の固定・週次更新 |
| `verify_v773` | 容量警告・自動pruneの撤去 |
| `verify_v774` | 設定タブと目標の反映 |
| `verify_v775` | chef ロールの欠落4件 |
| **`verify_v776.js`** | **Officeログインの候補と表記。7観点22項目** |
| `audit_merge_coverage.js` / `audit_budget_month.js` | 合流ルール／予算の対象月 |

**次回のzipには `index_v776_backup.html` を同梱すること。**

---

## このセッションで学んだこと

1. **「所属」を2つの軸で持つと、片方しか見ない場所ができる。** 役職(`role`)と配属店舗(`store`)の
   両方が所属を表しているのに、ログインの Office 側は role だけ、店舗側は store だけを見ていた。
   その隙間に落ちた人は**どの画面にも出ない**
2. **入口を直したら、その先も通るか確かめる。** ログインできるようにしただけでは足りず、
   `curStore==='OFFICE'` のページゲートで6〜11ページが差し替わることが分かった。
   **症状の1つ手前と1つ先を必ず見る**
3. **画面に出す選択肢が、システムの想定と食い違っていないか。** 配属店舗に `Office` を出しておいて
   ログインに反映しないのは、UI が嘘をついている状態だった
4. **推測を書いたら、それは検証していないという印をつける。** 今回「Office 配属だとページが
   開けなくなる」と書いたが、`curStore` の決まり方を追わずに `OFFICE_OK_PAGES` の一覧だけを見た
   推測だった。実際は Office ログインで `curStore='ALL'` になるので掛からない。
   **一覧を見ただけで結論を出さず、値がどう決まるかを最後まで追う**

---

## ビルド手順（厳守）

1. Python で透過的置換。`open(newline='')` で CRLF 保持、アンカーは `assert count==1`
2. Node `new Function()` で構文チェック（`MINUTES_SEED`/`HANDBOOK_SEED` をフィルタしない）
3. `APP_VERSION` と `SW_BUILD` を**同時に**上げる
4. lone LF = 0 を確認
5. `/mnt/user-data/outputs/` へコピーして `present_files`
6. 危険な処理は実関数を切り出して Node でモック実行し、**修正前の症状を再現するテストを必ず入れる**
7. 大きな新規ブロックは別ファイル（LF）で作り、CRLFに変換してから差し込む

**Motoさんの開発方針：「憶測で修正しない」。根本原因を確認 → 設計 → 確認 → 実装を1ステップずつ。**

---

## 主要な定数・環境

- ロール/グレード：crew=G1, g2=G2, sl=G3, g4=G4, **chef=G4**, am=G5, gm=G6
  - `GRADE_TITLES`：**Head Chef=G4 / Corporate Chef=G5**
  - `empGrade()` は title 優先→role フォールバック。`myGradeKey()` は `Math.max(title, role)`
- ログイン候補：Office 側は **役職 ∪ 配属店舗=OFFICE**（v776）／店舗側は `store` と `support`
- ページゲート：`curStore==='OFFICE'` のとき `OFFICE_OK_PAGES` 以外は Office管理へ差し替え
- 本部のメニュー：CEO/GM = `OFFICE_GROUPS`／経理 = `ACCT_GROUPS`／Chef = `CHEF_GROUPS`
- 本部の名簿：経理側 = `officeMembers()`／本部スタッフ全般 = `hqStaffMembers()`（v775）
- 店舗：ToriTon(F01) / Tenkichi(F02) / FSP(F03) / Waikiki Garlic Shack(F03-G) /
  Totoya Kaimuki(F04-K)・Piikoi(F04-P)・Aiea(F04-A) / Marujuu(F05)
- Corporate Chef の目標：`ccScoreView()` が唯一の読み出し口
- 保存層：`ls` / `lsSet` / `lsKeys` / `_lsStoreGet` / `_lsRawStr` / `_lsRawDel` / `_lsWriteVerified`
  - **新しい保存経路を作らない**／自動pruneは `_lsPruneNeeded()` でしか走らない（v773）
- Supabase: `tgbhgxzehzeouopklhje` / Edge Function: `hyper-worker`, `auth-pin`, `emp-private`, `ob-private`
- GitHub: `motoi107/funergy-growth-os` → `funergy-plus.com`
