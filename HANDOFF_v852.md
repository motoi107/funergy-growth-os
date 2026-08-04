# Funergy Growth OS — 引き継ぎ v852

**v852：名前をキーにした同期キー（固定シフト／シフト最適化の個人設定）にテスト用スタッフを入れない。**
**あわせて v851 の不具合（開けない画面へ飛ばされる）を修正。**

---

## 0. ⚠️ 毎回のリマインド（Motoさん依頼）

**公開URLで配布しているため Supabase の anon キーがクライアントに露出しています。**
`tip_labor` の RLS ポリシー `tip_labor_anon_all` は anon に **ALL（qual=true / with_check=true）** を与えており、
**URLとソースを見た人なら誰でもチップ・勤怠データを読み書きできる**状態です。

恒久対策は「読みは anon／書きは認証済みのみ」または Edge Function 経由。今回も未着手です。

---

## 0.5 現在地（ひと目で）

| | 状態 |
|---|---|
| 現行版 | **v852**。**v849〜v852 が GitHub 未 push**（v848 までは push 済み） |
| 検証 | `PASS=4409 / FAIL=0 / 実行=76/91`。検証91本・バックアップ71件 |
| クラウドの状態 | `employees` は **0件 / 全152件**（掃除済み・本物は無傷） |
| **未確認** | **`shiftopt_mem_` に TEST が戻っていないか**（check SQL の③） |
| **Motoさん待ち①** | **v852 を先に入れてから**、③を確認 → 出たら cleanup を再実行 |
| **Motoさん待ち②** | ガソリン代の単価を $0.76 に（IRS 2026/7/1〜。現在 $0.70） |
| **Motoさん待ち③** | KPI管理で 人件費率・原価率の目標＋本部予算 |
| **Motoさん待ち④** | `management_control_v815.sql` の流し直し（v824 の chef 追加ぶん） |
| 積み残し（大） | **公開URL／anonキー**（第0章）・管理統括の「整備中」・昨対の2025年データ |

---

## 1. 最初にやること

```bash
unzip funergy_v852_handoff.zip
tar -xJf handoff_v852.tar.xz
cd handoff_v852
TZ=Pacific/Honolulu node run_verify.js
```

**期待値**

```
合計 PASS=4409  FAIL=0  実行=76/91
合流ルールの未定義: 1
同期対象で未保護: 0
予算の対象月: 3 / 7
APP_VERSION=852 / SW_BUILD=852
CRLF=58072 / lone LF=0
```

---

## 2. ⚠️ 実データで見つかった穴（v850 では足りなかった）

### 何が起きていたか

掃除SQLを流したあと、`check_test_staff_v850.sql` の③で **`shiftopt_mem_F04-P` に TEST が2件**出ました。
Piikoi でシフト最適化を試したときのものです。

`employees` は v850 で塞いだので0件でしたが、**名前をキーにした同期キーは塞いでいませんでした。**
前の版では「この2つは同期されるので気をつけてください」と**注意書きで済ませていました**。足りませんでした。

### なぜ SQL で消しても戻るのか

```js
'shiftopt_': { merge: mergeMapByTime, ... }

function mergeMapByTime(cloud, local){
  ...
  Object.keys(l).forEach(function(k){
    if(!(k in out)){ out[k]=l[k]; return; }   // ← ローカルにしか無い名前は無条件に足し戻す
```

**キーの和集合**です。さらに `opMergePush()` は合流結果を**ローカルにも書き戻します**。

つまり Piikoi を試した端末にその2名がローカルに残っていれば、
**次にその店の最適化設定を保存した瞬間、クラウドへ足し戻されます。**SQL の物理削除だけでは止まりません。

さらに、**画面から消す手段がありません。**`renderShiftOptConfig` は `staffForStore()` で回すので、
従業員マスターから消えた TEST は一覧に出ず、`shiftopt_mem_` の残骸だけが触れないまま残ります。

### 直し方：v849（スキル）と同じ形

**同期しないキーへ分けました。**

```js
var TEST_NAMEKEY_STORE = 'tst_namekey';   /* 同期対象外 */
function _isTestName(n){ return /^TEST\s/.test(String(n||'')); }
```

| | |
|---|---|
| 読み | `_readNameKeyMap()` … 同期キーから TEST を外し、テスト用キーから重ねて返す |
| 書き | `_writeNameKeyMap()` … 本物は同期キー、TEST はテスト用キーへ振り分ける |
| 後始末 | `purgeTestFromNameKeys()` … 全店の残骸を掃除。`removeTestStaff()` から呼ぶ |

**読み取りでは絶対に保存を書き換えません。**書くと押し上げ→合流→また TEST が戻る、が循環するためです。

**保存のたびに同期キー側から TEST が落ちるので、既存の残骸も自然に消えます。**
本物を1人保存するだけで、その店の残骸がクラウドへ行かなくなります。

対象は2つ。

- `shiftopt_mem_<店>`（`mergeMapByTime` ＝ 和集合。**墓標なし**）
- `shift_fixed_<店>`（`mergeMapStamped` ＝ 和集合。墓標はあるが**墓標にも名前が残る**）

### ⚠️ 順番が大事です

1. **先に v852 を入れる**（特に Piikoi を試した端末）
2. そのあと `check_test_staff_v850.sql` の③で確認
3. まだ出るなら `cleanup_test_staff_v850.sql` を流す

**逆の順番だと、掃除した直後に端末から押し戻されます。**

---

## 3. v851 の不具合を修正

`createTestStaff` / `removeTestStaff` / `setTestSkillLevels` が `renderPage('settings')` を呼んでいました。
v851 でカードをシフト画面へ移したので、**シフト画面から押すと、開けない設定画面へ飛ばされます。**
Head Chef と AM は設定画面のロールに入っていないので、そのまま行き止まりになります。

```js
renderPage((typeof curPage!=='undefined' && curPage) ? curPage : 'shift_admin');
```

**画面を移すときは、そこから呼ばれる関数の遷移先も見る**（教訓58）。

---

## 4. Motoさん待ち：③の確認

`check_test_staff_v850.sql` の**③だけ**を流してください（読み取りのみ）。

```sql
select key,
       (select count(*) from jsonb_object_keys(value) k where k like 'TEST %') as test_names
from public.app_state
where (key like 'shift_fixed_%' or key like 'shiftopt_mem_%')
  and jsonb_typeof(value) = 'object'
  and exists (select 1 from jsonb_object_keys(value) k where k like 'TEST %')
order by key;
```

- **0行** → もう戻っていません。v852 を入れれば以後は入りません
- **また出る** → すでに押し戻されています。v852 を入れてから `cleanup_test_staff_v850.sql` を再実行

なお ① は **0件 / 全152件**で確認済みです。掃除で本物を巻き込んでいません。

---

## 5. 未確認・保留

### ① v849〜v852 の実機確認（最優先）

- シフト作成 → 最適化タブの一番下にカードが出るか（設定画面からは消えています）
- Head Chef / AM で**見えるか**。SL で**見えないか**
- **「15名を作成」を押したあと、シフト画面のままか**（v852 で直したところ）
- Lv タグが出るか。Kaimuki / Piikoi で **Lv が4段**になるか
- 最適化プレビューで **Lv3 の4名が先に**選ばれるか
- **TEST 15 OpsLeader（G3・Lv0）が最後まで**選ばれないか
- メインポジション指定時、**TEST 02 が mainCap 枠に入らない**か

### ② 前の版からの持ち越し

- チップ調整の保存（`tip_credit_adj_v848.sql` 適用済み）。実機確認待ち
- Akane（事務Crew）：承認の拒否文言／ガソリン代の精算が見えるか
- Management Console：**KPI目標と本部予算が未設定のため全8店で判定不可**
- **`management_control_v815.sql` の流し直しが未実施**
- 管理統括はまだ「整備中」表示中
- 昨対（2025年データ）… 枠だけ
- `_LS_PRUNABLE` が死んでいる（v836 で発見・未着手）
- `supabase/functions/` が未push、`hyper-worker` が未デプロイ

---

## 6. 教訓

v807 ①〜⑤、v825 ⑥〜⑫、v835 ⑬〜⑱、v836 ⑲〜㉑、v837 ㉒〜㉔、v838 ㉕㉖、v840 ㉗、
v841 ㉘、v842 ㉙㉚、v843 ㉛㉜、v844 ㉝㉞㉟、v845 ㊱㊲㊳、v846 ㊴㊵㊶、v847 ㊷〜㊼、
v848 ㊽㊾㊿、v849 51〜53、v850/851 54〜57 は有効。追加分：

### 58 「注意書きで済ませた」ものは、いずれ実データで返ってくる

v849 で「`shiftopt_mem_` と `shift_fixed_` は同期されるので気をつけてください」と画面に書いた。
2版あとに、実際に `shiftopt_mem_F04-P` へ2件残っていた。

**注意書きは対策ではない。**人が気をつけ続けることを前提にした設計は、必ず破れる。
書いた時点で「これは塞げないのか」を必ず考える。

### 59 掃除する順番を間違えると、掃除が無効になる

クラウドを SQL で消しても、その名前を持ったままの端末が次に保存すれば戻る。
**先に「出さない」を配ってから、掃除する。**

一般化すると、**和集合で合流するデータは、送り手を止めてからでないと消えない。**

### 60 画面を移したら、そこから呼ばれる関数の遷移先も見る

v851 でカードを設定画面からシフト画面へ移したが、
ボタンの中の `renderPage('settings')` はそのままだった。
**移した先のロールでは開けない画面**へ飛ばしていた。

**移動は置き場所だけの話ではない。**入口を変えたら、出口も揃える。

---

## 7. 重要な設計上の決定（勝手に変えないこと）

- **公開URL／anonキーの件は毎回リマインドする**（第0章）
- **GitHub main は毎回 md5 で突き合わせる。引き継ぎの記述を信じない**（v848 で実際に食い違った）
- **テストデータはクラウドに出さない**（教訓55）。push も pull も塞ぐ
- **和集合で合流するキーには、テストデータを入れない**（教訓58・59）
- **テストデータは作るより先に消し方を作る**（教訓㊷）
- 事務Crew（office_crew）は閲覧のみ。決める操作は `denyViewOnly()` で止める
- 「見える」と「できる」を別のゲートにする
- **DBの列を使うコードを書いたら、同じ版で SQL を同梱し、実際に流して確かめる**
- **外部の基準値は発効日つきの表で持ち、過去は動かさない**（教訓㊿）
- 数字の計算を新しく作らない。判定不可は 0 ではない。ランキングを作らない
- 640px以下の既存CSSに触らない

---

## 8. 適用が必要な SQL

| ファイル | 状態 |
|---|---|
| `check_test_staff_v850.sql` | ①は確認済み（0/152）。**③がまだ** |
| `cleanup_test_staff_v850.sql` | 1回実行済み。**③が出るなら v852 を入れてから再実行** |
| `management_control_v815.sql` | **v824 で chef 追加。流し直しが必要** |
| `tip_credit_adj_v848.sql` | 適用済み（8列 OK・確認済み） |
| `management_control_v808/811/v822_cleanup.sql` | 適用済み |

**v852 で新しく必要な SQL はありません。**

---

## 9. 同梱ファイル（追加・変更ぶん）

| ファイル | 用途 |
|---|---|
| `index.html` / `sw.js` | **v852 本体（GitHub 未 push）** |
| `verify_v850.js` | クラウドへ出さない検証（PASS=52） |
| `verify_v851.js` | G4開放・置き場所・文言の検証（PASS=62） |
| `verify_v852.js` | **新設**。名前キーの分離・後始末・遷移先の検証（PASS=74） |
| `check_test_staff_v850.sql` / `cleanup_test_staff_v850.sql` | クラウドの確認と後始末 |
| `index_v850〜852_backup.html` | 各版のバックアップ |

---

## 10. 作業のしかた（この環境でのメモ）

### ビルド

1. `cp index.html index_v<今の版>_backup.html`（変更**前**に）
2. Python の透過置換。**`rep()` は old / new とも CRLF に寄せてから使う**
3. `APP_VERSION` と `SW_BUILD` を同時に上げる
4. Node の `new Function()` で構文チェック
5. **書き出し前に `assert lone LF == 0`**
6. 前版と差分を取り、意図した範囲だけかを目で見る
7. `TZ=Pacific/Honolulu node run_verify.js`
8. 最後に `cp index.html index_v<新版>_backup.html`

### PostgreSQL を立てる

`apt-get update` が **nodesource のリポジトリで 403 になり失敗**する。先に外すこと。

```bash
mkdir -p /tmp/aptoff && mv /etc/apt/sources.list.d/nodesource.sources /tmp/aptoff/
apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends postgresql
export PGBIN=/usr/lib/postgresql/16/bin
mkdir -p /tmp/pgdata && chown -R postgres /tmp/pgdata
su postgres -c "$PGBIN/initdb -D /tmp/pgdata -U postgres"
su postgres -c "$PGBIN/pg_ctl -D /tmp/pgdata -l /tmp/pg.log -o '-k /tmp -p 5433' start"
su postgres -c "$PGBIN/psql -h /tmp -p 5433 -U postgres --single-transaction -v ON_ERROR_STOP=1 -f your.sql"
```

**`--single-transaction` を使うなら SQL 側に `begin;/commit;` を書かない。**

### この環境から出られる先

`api.github.com` / `raw.githubusercontent.com` / npm / PyPI などは通る。
**Supabase（`*.supabase.co`）は通らない**（`x-deny-reason: host_not_allowed`）。
クラウドの中身を見る必要があるときは、SQL を書いて Motoさんに流してもらう。

**Supabase の SQL Editor は、複数文を流すと最後の結果しか出さない。**
確認用SQLは**1文ずつ流してもらう**か、1文にまとめる。

### 気をつけること

- 検証が落ちたら、**まず検証を疑う**（v851・v852 とも検証側の間違いだった）
- **定義を消す前に `grep -l '<名前>' verify_*.js` を打つ**
- 各 `verify_vNNN.js` は `index_vNNN_backup.html` に固定されている。
  **今の `index.html` を見ているのは最新版の検証だけ**
- **同じコンテナで並行作業が走っていたことがある**（v839）。作業前に `APP_VERSION` と md5 を確認する

---

## 11. 次のセッションの入り方

1. **第0章（公開URL／anonキー）のリマインドを伝える**
2. `TZ=Pacific/Honolulu node run_verify.js` → 第1章の期待値と一致するか
3. **GitHub main を md5 で突き合わせる**（`https://raw.githubusercontent.com/motoi107/funergy-growth-os/main/index.html`）
4. 第0.5章の「Motoさん待ち」を確認する（**まず check SQL の③**）
5. 第5章①（v849〜v852 の実機確認）へ

**Motoさんの進め方**：「憶測で修正しない」。原因を確かめ、設計 → 確認 → 実装。
分からないことは推測で埋めず聞く。**実画面を見て的確に指摘するので、作り込む前に見てもらうこと。**
