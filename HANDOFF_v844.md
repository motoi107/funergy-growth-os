# Funergy Growth OS — 引き継ぎ v844

**v844：経理側（Marcia / Akane）の表示を統一し、ガソリン・経費・承認をすべてたどれるようにした。**

---

## 0. 最初にやること

```bash
unzip funergy_v844_handoff.zip
tar -xJf handoff_v844.tar.xz
cd handoff_v844
TZ=Pacific/Honolulu node run_verify.js
node make_preview.js        # → preview.html（管理コンソール）
```

**期待値**

```
合計 PASS=3805  FAIL=0  実行=68/83
合流ルールの未定義: 1        ← spl_skills_st_ の1件だけが既知
同期対象で未保護: 0
予算の対象月: 3 / 7
APP_VERSION=844 / SW_BUILD=844
CRLF=57486 / lone LF=0
```

**v836〜v844 とも未 push。**GitHub は md5 で突き合わせること。

---

## 1. 何が起きていたか

Marcia と Akane で本部の見え方が大きく違っていた。原因は**役職ごとに別のメニュー定義**：

| 人 | 役職 | 使っていた定義 | 見えるページ |
|---|---|---|---|
| Marcia | `office` | `ACCT_GROUPS`（6グループ） | 26 |
| Akane | `office_crew` | `OFFICE_CREW_GROUPS`（4グループ） | 8 |

さらに、**経理メニューが並べているのに `NAV_ITEMS` の `roles` で落ちて出てこないページが18件**あった。
`承認センター`（`approval`）と`事前経費申請`（`expense`）は**そもそもメニューに載っていなかった**。
`休暇申請`（`vacation`）は `roles:['sl','am']` で、経理からは開けなかった。

---

## 2. v844 でやったこと

### ① 経理を1つのメニュー定義にまとめた

`groupsForRole()` の1行だけ変更。`office_crew` も `ACCT_GROUPS` を使う。

```js
else if (curRole==='office_crew') groups = ACCT_GROUPS;   /* 旧: OFFICE_CREW_GROUPS */
```

**`OFFICE_CREW_GROUPS` は使われなくなったので定義ごと削除した**（死んだコードを残さない）。

### ② 承認・経費まわりをメニューに載せた

```
経理 申請  →  経理 申請・承認
  旧: 休暇申請 / ガソリン代 / 出力センター
  新: 承認センター / 事前経費申請 / ガソリン代 / 休暇申請 / 出力センター
```

マイページ（`mypage` / `mc_requests`）も追加。事務Crew 専用メニューにしか無かったので、
統一したときに失わないようにした。

### ③ 隠れていたページを開けた

`NAV_ITEMS` の `roles` に足したもの：

- **`office_crew`** … 28ページ（通知・タスク・経理出力・業者マスタ・食材マスタ・労務・原価・
  KPI管理・発注・ガソリン代・出力センター・人材・採用・設定 ほか）
- **`office`** … `vacation` / `approval` / `expense` / `mileage` / `mc_requests`

結果：**`office` も `office_crew` も、経理メニューが並べる31ページすべてが見える。隠れゼロ。**

### ④ キッチンは入れていない

`ACCT_GROUPS` には `menu` / `recipe` / `inventory` / `fv_variance` / `ing_transfer` / `cc_plan` を
1つも入れていない。`verify_v844` [3] で毎回確かめている。

**ただし `原価管理`（`foodcost`）と `食材マスタ`（`ingredient_master`）は残してある。**

- 原価 … 経理の予実で原価率を見るのに要る
- 食材マスタ … Invoice処理で仕入単価を更新するのに要る

キッチンのオペレーション画面ではないという判断。**不要なら1行で外せる**（`ACCT_GROUPS` から削るだけ）。

### ⑤ 権限は1つも変えていない

- `ROLE_CONFIG` の `office` / `office_crew` は無変更（`canApprove:false` のまま）
- `canApproveReimburse` は**元から `office` / `office_crew` の両方を許可**していた
  → 建て替え経費の承認は前から両方できる
- `canApproveExpense` は GM/CEO のみ（フォーム規定）のまま
- **見えるようになっただけで、できることは役職のまま**

### ⑥ GM / CEO の本部モードは変えていない

Kitchen 管理 / Kitchen 食材・原価 は GM・CEO には今までどおり出る。
ほかの役職（AM・店長・Crew・Corporate Chef・店舗共有ログイン）の見え方も
v843 と1文字も変わらないことを検証で固定した。

---

## 3. 未確認・保留

### ① 経理に残した2画面

`原価管理` と `食材マスタ` を経理に残してよいか。**不要なら `ACCT_GROUPS` から外すだけ**（1行）。

### ② 設定画面

統一の結果、事務Crew にも `設定`（`settings`）が見えるようになった。
外したい場合は `ga_set` から `settings` を外すか、`NAV_ITEMS` の `settings` から
`office_crew` を外す。**どちらでも1行。**

### ③ Management Console（v837〜v843）

- **KPI目標と本部予算が未設定のため、人件費率・原価率・営業利益・客数・客単価が全8店で判定不可。**
  KPI管理 → 店舗タブで目標を入れると判定が出る。画面に「どこを直すか」を出してある
- v845 以降：役職別の作り込み／Work Center の本統合／管理統括の「整備中」を外す

### ④ 管理統括

- **`management_control_v815.sql` の流し直しが未実施**（v824 の chef 追加ぶん）
- 7月（前月）の検知結果を Moto さんがまだ見ていない

### ⑤ その他

- 昨対（2025年データ）… 枠だけ。`doRangeImport` で実機確認から
- `_LS_PRUNABLE` が死んでいる（v836 で発見・未着手）
- `supabase/functions/` が未push、`hyper-worker` が未デプロイ
- **v839 の出どころ**（並行作業のもの。`HANDOFF_v840.md` 第3章）

---

## 4. 教訓

v807 ①〜⑤、v825 ⑥〜⑫、v835 ⑬〜⑱、v836 ⑲〜㉑、v837 ㉒〜㉔、v838 ㉕㉖、v840 ㉗、
v841 ㉘、v842 ㉙㉚、v843 ㉛㉜ は有効。追加分：

### ㉝ メニューに載せただけでは出ない。roles と二重になっている

このアプリは **①グループ定義（`ACCT_GROUPS` 等）に並べる** と
**②`NAV_ITEMS` の `roles` にその役職が入っている** の**両方**が必要。
片方だけだと、並べたのに出ない。

v843 時点で `ACCT_GROUPS` は `vacation` を並べていたのに、
`roles:['sl','am']` だったため経理からは開けなかった。**気づきにくい。**

**メニューを触ったら、機械で「並べたのに隠れているページ」を数えること。**
`verify_v844` [2] がそれをやっている。

### ㉞ 定義を消したら、それを掴んでいる検証を探す

`OFFICE_CREW_GROUPS` を消したら `verify_v792` が例外で止まり **PASS=0** になった。
v807 の教訓④（ReferenceError で PASS=0）と同じ形。

**消す前に `grep -l '<消す名前>' verify_*.js audit_*.js` を打つこと。**

### ㉟ ハーネスを直すときは、元の探し方に合わせる

`verify_v792` を「存在する定義だけ取り込む」ように直したが、
`const ... = [` だけを探す実装にしたため、**`var` で宣言されている `NO_CASHTIP_STORES` が落ちて**
現金チップの対象店舗が全部「対象外」になり、17件が落ちた。

元の `arrDecl` は `(?:const|var)` の両方を見ていた。

**ハーネスに手を入れるときは、既存のヘルパーと同じ規則を使う。**
自分で書き直すと、こういう取りこぼしが出る。

---

## 5. 重要な設計上の決定（勝手に変えないこと）

- **経理は office / office_crew で同じメニューを見せる。**片方だけ足さない
- **メニューに足したら `NAV_ITEMS` の `roles` にも足す**（教訓㉝）
- **キッチンのオペレーション画面は経理に出さない**
- **見える範囲を広げても、権限（`canApprove` 等）は別物として扱う**
- 数字の計算を新しく作らない。新しく見える集計は既存定義との一致を検証で示す
- 判定不可は 0 ではない。実測は `ref`（参考値）として別に持ち「参考」と明示
- 3値を扱うところで二択の `? :` を書かない
- ランキングを作らない。順位番号も付けない
- 640px以下の既存CSSに触らない
- **呼ばれなくなった定義は消す。ただし検証が掴んでいないか先に確認する**（教訓㉞）

---

## 6. 同梱ファイル（追加・変更ぶん）

| ファイル | 用途 |
|---|---|
| `index.html` / `sw.js` | **v844 本体（GitHub 未 push）** |
| `verify_v844.js` | **新設**。経理の表示統一・隠れページゼロ・権限不変の検証（PASS=60） |
| `index_v844_backup.html` | **新設**。次版の検証が「修正前」として使う |
| `verify_v792.js` | 消えた定義に耐えるよう修正（教訓㉞㉟） |
| `preview.html` / `make_preview.js` | 管理コンソールのプレビュー |
| `DESIGN_management_dashboard.md` | 仕様16章 → 既存コードの対応表 |
| `HANDOFF_v843.md` 〜 `HANDOFF_v807.md` | 過去の引き継ぎ |

---

## 7. 次のセッションの入り方

1. `TZ=Pacific/Honolulu node run_verify.js` → 第0章の期待値と一致するか
2. GitHub main を md5 で突き合わせる
3. **Marcia と Akane に実際にログインしてもらい、同じ画面が出るか確認**
4. v845（役職別の作り込み）へ

**Motoさんは実画面を見て的確に指摘する。**本番に上げたら早めに画面を見てもらうこと。
