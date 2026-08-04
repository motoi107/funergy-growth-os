# Funergy Growth OS — 引き継ぎ v849

**v849：シフト振り分けの確認用スキルレベル（テスト用スタッフ専用）。本番のスキルには一切書かない。**

---

## 0. ⚠️ 毎回のリマインド（Motoさん依頼）

**公開URLで配布しているため Supabase の anon キーがクライアントに露出しています。**
`tip_labor` の RLS ポリシー `tip_labor_anon_all` は anon に **ALL（qual=true / with_check=true）** を与えており、
**URLとソースを見た人なら誰でもチップ・勤怠データを読み書きできる**状態です。

恒久対策は「読みは anon／書きは認証済みのみ」または Edge Function 経由。
着手するときは同期経路への影響範囲の洗い出しから。今回も未着手です。

---

## 0.5 現在地（ひと目で）

| | 状態 |
|---|---|
| 現行版 | **v849**（`index.html` / `sw.js`）。**v849 のみ GitHub 未 push** |
| 検証 | `PASS=4224 / FAIL=0 / 実行=73/88`。検証88本・バックアップ68件（v782〜v849） |
| 直近の大きな仕事 | テスト用スタッフ（v847）＋振り分け確認用スキルレベル（v849） |
| **Motoさん待ち①** | **ガソリン代の単価を $0.76 に直す**（IRS 2026/7/1〜。現在 $0.70 のまま＝支給不足の可能性） |
| **Motoさん待ち②** | **KPI管理で 人件費率・原価率の目標**＋**本部予算**（入るまで全8店が判定不可） |
| **Motoさん待ち③** | `management_control_v815.sql` の流し直し（v824 の chef 追加ぶん） |
| 確認待ち | v849 の実機（振り分け）／チップ調整の保存／事務Crewの権限／レシート一覧／月次CSV |
| 積み残し（大） | **公開URL／anonキー**（第0章）・管理統括の「整備中」・昨対の2025年データ |

### ⚠️ v848 の引き継ぎに1件まちがいがありました

`HANDOFF_v848.md` 第0.5章に「**v836〜v848 は GitHub 未 push**」とありましたが、
**実際は push 済みでした。**

`motoi107/funergy-growth-os` の main を落として md5 を取ったところ、
手元の v848 と**1バイト違わず一致**（`index.html` = `a6a246e8…` / `sw.js` = `2d52d95c…`、main 側も APP_VERSION=848）。
未 push なのは `supabase/functions/` だけ（`hyper-worker` / `cronSync` とも 404）。

**第10章の「引き継ぎの記述を信じない」はこのためにある。毎回 md5 で突き合わせること。**

---

## 1. 最初にやること

```bash
unzip funergy_v849_handoff.zip
tar -xJf handoff_v849.tar.xz
cd handoff_v849
TZ=Pacific/Honolulu node run_verify.js
```

**期待値**

```
合計 PASS=4224  FAIL=0  実行=73/88
合流ルールの未定義: 1
同期対象で未保護: 0
予算の対象月: 3 / 7
APP_VERSION=849 / SW_BUILD=849
CRLF=57982 / lone LF=0
```

---

## 2. v849 でやったこと

### なぜ必要だったか

**テスト用スタッフ15名（v847）にはスキルが1件も入っておらず、全員 Lv0 として扱われていました。**

振り分け（`optimizeShift` と各店の自動割り当て）は**等級を一切見ていません。**
見ているのは `positionLevelStore()` が返すレベルだけで、しかも `status==='承認'` でないと 0 です。

```
① メインポジションで Lv3（mainCap）
② Lv3 以上を必要数まで
③ Lv2 以上を必要数まで
④ 残りを人数まで
⑤ 同点ならレベルの高い順
```

全員 Lv0 では①〜③がまったく効かず、**振り分けの確認ができない状態**でした。

### ⚠️ 本番のスキルに入れなかった理由（重要）

`skills_v2` と `skills_st_<店>` は**どちらもクラウド同期の対象**です。
そして合流の `mergeSkillStore()` は**名前の和集合**を取ります。

**スキルには墓標（論理削除）の仕組みがありません。**
つまり普通にスキルを入れると、**テスト用スタッフを削除してもクラウドから復活します。**
本番のスキルデータに TEST の名前が残り続け、成長カルテやスキル一覧にも出続けます。

`shift_fixed_` は同じ問題を墓標で解決していますが（`_deleted:true` を残す）、スキルにはそれがありません。

### やったこと

**読み取りの入口1か所だけで分けました。**

`positionLevelStore()` は**シフト系のレベル読み取りが全部通る1か所**です（呼び出し元23か所）。
最適化・各店のビルダー・自動割り当て・Lv表示、すべてここを通ります。

```js
function positionLevelStore(name, pos, storeId) {
  var _t = testSkillLevel(name, pos, storeId);   /* v849 */
  if(_t !== null) return _t;
  var sk = getEmpSkillsStore(name, storeId);
  var s = sk[pos];
  return (s && s.status==='承認') ? (s.level||0) : 0;
}
```

- 保存先は **`tst_skill_lv` の1キーだけ**。**同期対象外**（`OP_SYNC_KEYS` にも `OP_SYNC_PREFIX` にも当たらない）
- 持つのは「入れたかどうか」だけ。レベルは `TEST_SKILL_ORDER` の並び順から計算する
- 削除は**このキーを消すだけ**。復活しない
- `testSkillLevel()` は**先に名前で弾く**ので、本物のスタッフは保存を読みにも行かない（ループの中で呼ばれるため）

### レベル配分（Motoさん確認済み）

**等級とわざと逆順**にしてあります。振り分けが等級ではなくスキルで動いていることが結果で分かります。

| スキル順 | スタッフ | 等級 | 上限3の店 | Kaimuki/Piikoi |
|---|---|---|---|---|
| 1 | TEST 14 Newbie | G1 | 3 | 4 |
| 2 | TEST 10 ShortTime | G1 | 3 | 4 |
| 3 | TEST 02 Lunch | G1 | 3 | 4 |
| 4 | TEST 09 Weekday | G1 | 3 | 3 |
| 5 | TEST 05 CrewLeader | G2 | 2 | 3 |
| 6 | TEST 13 Helper | G1 | 2 | 3 |
| 7 | TEST 03 Dinner | G1 | 2 | 2 |
| 8 | TEST 07 KitchenLead | **G3** | 2 | 2 |
| 9 | TEST 11 OpenClose | G1 | 1 | 2 |
| 10 | TEST 01 Fulltime | G1 | 1 | 1 |
| 11 | TEST 06 ServerLead | **G3** | 1 | 1 |
| 12 | TEST 08 Weekend | G1 | 1 | 1 |
| 13 | TEST 04 Prep AM | G1-P | 0 | 0 |
| 14 | TEST 12 Prep PM | G1-P | 0 | 0 |
| 15 | TEST 15 OpsLeader | **G3** | 0 | 0 |

**TEST 02 Lunch だけ、メインポジションのレベルを Lv2 に落としてあります。**
「Lv3 は持っているのに `mainCap` が付かない」人を1名作り、メイン必須の判定が効いているか確認するためです。
上限4の店でも Lv2 まで落とします（Lv3 だと `>=3` で mainCap が付いてしまうため）。
メインポジションを指定していない店では落としません。

### 使い方

**設定 → 「シフト作成テスト用スタッフ」（GM / CEO のみ）**

- 「15名を作成」で**スキルレベルも一緒に入る**
- 「スキルレベルを外す／入れる」で切り替えられる（スキル無しの状態も試せる）
- 一覧は**レベルの高い順**に並び、`Lv3` などのタグが付く
- タグは**今選んでいる店舗の値**（画面に店名を出しています）
- 「まとめて削除」で**レベルも一緒に消える**

---

## 3. ⚠️ 振り分けを試す前に：Availability が要ります

`canWork()` は `avail_<店>_<週>` に登録が無いと **false** を返します。
**Availability が空だと、スキルを入れても振り分け結果はゼロです。**

Motoさんが自分で入れる、で今回は合意しています。カードにも1行出してあります。

`avail_` は同期対象外なのでローカルで作れますが、
**pull が失敗したときだけ push される経路が1つあります**（`maybePullShift` の `.then(function(ok){ if(!ok) pushAvailability(...) })`）。

---

## 4. 未確認・保留

### ① v849 の実機確認（これが最優先）

- 設定 → テスト用スタッフのカードに **Lv タグ**が出るか
- 店舗を Kaimuki / Piikoi にすると **Lv が4段**になるか
- シフト作成 → 最適化プレビューで、**Lv3 の4名が先に選ばれる**か
- **TEST 15 OpsLeader（G3・Lv0）が最後まで選ばれない**か
- メインポジションを指定したとき、**TEST 02 が mainCap 枠に入らない**か

### ② 前の版からの持ち越し

- チップ調整の保存（`tip_credit_adj_v848.sql` は適用済み・8列 OK）。実機で保存できたかの確認待ち
- Akane（事務Crew）：承認を押すと「権限がありません。事務Crewは閲覧のみです」が出るか／ガソリン代の精算が見えるか
- Management Console：**KPI目標と本部予算が未設定のため全8店で判定不可**
- **`management_control_v815.sql` の流し直しが未実施**（v824 の chef 追加ぶん）
- 管理統括はまだ「整備中」表示中
- 経理に `原価管理`・`食材マスタ` を残してよいか／`設定` を事務Crew に見せてよいか（各1行）
- 昨対（2025年データ）… 枠だけ
- `_LS_PRUNABLE` が死んでいる（v836 で発見・未着手）
- `supabase/functions/` が未push、`hyper-worker` が未デプロイ

---

## 5. 教訓

v807 ①〜⑤、v825 ⑥〜⑫、v835 ⑬〜⑱、v836 ⑲〜㉑、v837 ㉒〜㉔、v838 ㉕㉖、v840 ㉗、
v841 ㉘、v842 ㉙㉚、v843 ㉛㉜、v844 ㉝㉞㉟、v845 ㊱㊲㊳、v846 ㊴㊵㊶、v847 ㊷〜㊼、v848 ㊽㊾㊿ は有効。追加分：

### 51 テストデータを入れる先は「消せるか」で決める

スキルを本番の `skills_v2` に入れれば実装は3行で済んだ。
だが合流が**名前の和集合**で墓標が無いため、**消しても復活する**。
本番のスキルデータにテスト名が永久に残っていた。

**書く前に、その保存先の合流ルールを読む。**
和集合で墓標が無いところにテストデータを入れてはいけない。

### 52 読み取りが1か所に集まっているなら、そこで分けるのが一番安い

シフトのレベル読み取りは呼び出し元が23か所あるが、**すべて `positionLevelStore()` を通っていた。**
ここ1か所に分岐を入れるだけで、最適化・各店のビルダー・自動割り当て・表示のすべてに効いた。

**作る前に呼び出し元を数える。**23か所を触るのと1か所を触るのでは、壊す確率がまるで違う。

### 53 ループの中で呼ばれる関数は、判定の順番で保存を読む回数が変わる

`positionLevelStore()` は 人数 × ポジション × 曜日 で呼ばれる。
「有効か」を先に見ると本物のスタッフでも毎回 localStorage を読む。
**先に名前で弾けば、本物は保存に一切さわらない。**

安いほうの判定を先に置く。

---

## 6. 重要な設計上の決定（勝手に変えないこと）

- **公開URL／anonキーの件は毎回リマインドする**（第0章）
- **GitHub main は毎回 md5 で突き合わせる。引き継ぎの記述を信じない**（v848 で実際に食い違った）
- **テストデータは本番の同期キーに書かない**（教訓51）
- **テストデータは作るより先に消し方を作る**（教訓㊷）
- 事務Crew（office_crew）は閲覧のみ。決める操作は `denyViewOnly()` で止める
- 「見える」と「できる」を別のゲートにする
- **DBの列を使うコードを書いたら、同じ版で SQL を同梱し、実際に流して確かめる**
- **失敗の文言は「次の一手」まで書く**
- **一覧に上限を入れたら、その先へ行く手段を用意する**（教訓㊾）
- **外部の基準値は発効日つきの表で持ち、過去は動かさない**（教訓㊿）
- 数字の計算を新しく作らない。判定不可は 0 ではない。ランキングを作らない
- 640px以下の既存CSSに触らない

---

## 7. 適用が必要な SQL

| ファイル | 状態 |
|---|---|
| `management_control_v808/811.sql` | 適用済み |
| `management_control_v815.sql` | **v824 で chef 追加。流し直しが必要** |
| `management_control_v822_cleanup.sql` | 適用済み |
| `tip_credit_adj_v848.sql` | 適用済み（8列 OK・確認済み） |

**v849 で必要な SQL はありません。**（DBの列を1つも使っていない）

**確認用（読み取りのみ）**：`check_tip_adj_v848.sql` / `check_mc_v818.sql` / `check_toast_sync.sql`

---

## 8. 同梱ファイル（追加・変更ぶん）

| ファイル | 用途 |
|---|---|
| `index.html` / `sw.js` | **v849 本体（GitHub 未 push）** |
| `verify_v849.js` | **新設**。配分・逆順・mainCap・非同期・削除の検証（PASS=87） |
| `index_v849_backup.html` | **新設** |
| `HANDOFF_v848.md` 〜 `HANDOFF_v807.md` | 過去の引き継ぎ |

---

## 9. 作業のしかた（この環境でのメモ）

### ビルド

1. `cp index.html index_v<今の版>_backup.html`（変更**前**に）
2. Python の透過置換。**`rep()` は old / new とも CRLF に寄せてから使う**
3. 新規の大きいブロックは LF で書いて `crlf()` を通す
4. `APP_VERSION` と `SW_BUILD` を同時に上げる
5. Node の `new Function()` で構文チェック
6. **書き出し前に `assert lone LF == 0`**
7. 前版と差分を取り、意図した範囲だけかを目で見る
8. `TZ=Pacific/Honolulu node run_verify.js`
9. 最後に `cp index.html index_v<新版>_backup.html`
10. `/mnt/user-data/outputs/` へコピー → `present_files`

### SQL は必ず実行してから渡す（v845 の反省）

```bash
apt-get update -qq && apt-get install -y --no-install-recommends postgresql
export PGBIN=/usr/lib/postgresql/16/bin
mkdir -p /tmp/pgdata && chown -R postgres /tmp/pgdata
su postgres -c "$PGBIN/initdb -D /tmp/pgdata -U postgres"
su postgres -c "$PGBIN/pg_ctl -D /tmp/pgdata -l /tmp/pg.log -o '-k /tmp -p 5433' start"
su postgres -c "$PGBIN/psql -h /tmp -p 5433 -U postgres -f your.sql"
```

**Supabase の SQL エディタは全体を1トランザクションで流す。**`--single-transaction` で同じ条件を再現すること。

### 気をつけること

- 検証が落ちたら、**まず検証を疑う**
- **定義を消す前に `grep -l '<名前>' verify_*.js` を打つ**
- 検証に**日付や時刻の「変化」を書かない**
- 各 `verify_vNNN.js` は `index_vNNN_backup.html` に固定されている。
  **今の `index.html` を見ているのは最新版の検証だけ**（この点は v847/v848 を触っても落ちない理由でもある）
- **同じコンテナで並行作業が走っていたことがある**（v839）。作業前に `APP_VERSION` と md5 を確認する

---

## 10. 次のセッションの入り方

1. **第0章（公開URL／anonキー）のリマインドを伝える**
2. `TZ=Pacific/Honolulu node run_verify.js` → 第1章の期待値と一致するか
3. **GitHub main を md5 で突き合わせる**（`https://raw.githubusercontent.com/motoi107/funergy-growth-os/main/index.html`）
4. 第0.5章の「Motoさん待ち」を確認する
5. 第4章①（v849 の実機確認）へ

**Motoさんの進め方**：「憶測で修正しない」。原因を確かめ、設計 → 確認 → 実装。
分からないことは推測で埋めず聞く。**実画面を見て的確に指摘するので、作り込む前に見てもらうこと。**
