# Management Dashboard — 設計と既存コードの突き合わせ

対象：v836（APP_VERSION=836）
目的：仕様を「新規に作るもの」と「既存の再利用」に切り分け、二重実装を防ぐ。

---

## 0. 結論（先に）

**仕様の約8割は、すでに管理統括（v808〜v824）として実装済み。**

権限判定・アラートの保存・楽観ロック・監査ログ・冪等キー・Outbox通知・
自動保存・店舗別しきい値・検知ルール——仕様の第2章・第8章・第9章・第11章が
要求しているものは、ほぼそのまま動く形で存在する。

**新しく作る必要があるのは、実質この3つだけ。**

| | 内容 | なぜ無いか |
|---|---|---|
| A | **判定層**（達成／未達／判定不可の3値） | 管理統括は「重要度（緊急・注意・確認）」で持っており、達成／未達の判定は持っていない |
| B | **必須KPI設定**（GMが店舗ごとに設定） | 概念自体が存在しない。新規の保存キーが要る |
| C | **PC幅レイアウト** | 現在は完全にモバイル前提。`@media` は `max-width:640px` 系のみ |

**そして、仕様が要求していてデータが存在しないものが1つある。→ 第3章①**

---

## 1. 仕様 → 既存コードの対応表（再利用するもの）

### 第2章「表示権限」→ ほぼ完成している

| 仕様の要求 | 既存の実装 |
|---|---|
| 役職と担当店舗から自動で表示範囲を変える | `mcRole()` / `mcScopeStores()` |
| 役職切替ボタンを置かない | 管理統括は元からそうなっている |
| Store Manager は自店舗のみ | `mcCanSeeStore(storeId)` |
| 店長をコードに固定しない | `mcIsStoreManagerEmp()` ＋ `MC_NON_SM_G4_TITLES` |
| Head Chef は原価・仕入中心 | `mcCanSeeCategory(cat)` / `mcStoreChefsOf()` |
| AM は管轄店舗のみ | `mcScopeStores()` が AM の管轄割り当てを見る |
| 管轄外の通知・承認を見せない | `mcVisibleAlerts()` / `mcCanResolve()` |
| 通知先をマスターから引く | `mcNotifyTargets(storeId, category)` |
| バックエンド側でも制限 | Supabase RLS（`management_control_v808.sql`）で適用済み |

**追加で要るのは CEO の扱いだけ。** `mcRole()` に ceo の分岐があるかを確認して、
無ければ「GM と同じ範囲・表示項目は絞る」を足す。

### 第5章「達成／未達の判定方法」→ 計算はすべて既存

仕様の核心は「月中の売上は月間予算総額ではなく、本日時点までの進捗予算と比較」。
**これは `cumulativeToToday()` がすでにやっている。**

```
cumulativeToToday(storeId, ym) が返すもの
  budToToday   … 本日時点までの進捗予算   ← 仕様が言う「進捗予算」そのもの
  actToToday   … 本日時点までの実績
  paceRate     … 進捗予算に対する達成率   ← 仕様の判定に直接使える
  budMonth / actMonth / monthRate
  costRate     … 実原価率
  laborRate    … 実人件費率
  daysPassed / daysWithActual … 判定不可の判断材料
```

| 仕様のKPI | 既存の計算 |
|---|---|
| 売上・達成率 | `cumulativeToToday().paceRate` |
| 原価率 | `foodCostOf(storeId, ym)` → `rate` / `provisionalRate`（確定・暫定の区別つき） |
| 人件費率 | `laborCoreForYm(storeId, ym)` → `cumulativeToToday().laborRate` |
| 営業利益 | 既存のPL関数（`profit` を返す。売上−原価−人件費−変動費−GET−固定費） |
| 前月比 | `monthStats(storeId, -1)` |
| 客数・客単価 | 予算側に `dow.lunch/dinner` の `guests` / `spend` がある |
| 店舗別しきい値 | `mcThr(code, storeId)`（`mc_thresholds` の store_id 上書き対応済み） |

**「数字の計算を新しく作らない」（v825第6章の確定事項）を守る。**
判定層はこれらを**呼ぶだけ**にして、自前で足し算をしない。

### 第8章「Work Center統合」→ データはすでに1つ

仕様は「DashboardとWork Centerで別々のアラート・対応データを作らないでください」と言うが、
**現状すでに1つ**。`management_alerts` を管理統括が読み書きしている。

| 仕様の分類 | 既存 |
|---|---|
| 要対応 | `MC_STATUS.open`（未対応） |
| 対応中 | `MC_STATUS.in_progress` ＋ `management_alert_actions` |
| 承認待ち | 既存の `approvals`（ワークセンターの承認タブ） |
| 定期管理 | 既存の `getDailyOps()` / `getTasks()` |

自動検知も揃っている：

```
mcDetectBudget    予算未登録・進捗遅れ・月末予測未達・売上未同期
mcDetectLabor     人件費率超過
mcDetectCost      原価率超過・期末棚卸未入力
mcDetectGrowth    スキル評価の長期未更新
mcDetectPurchase  新規材料・仕入価格上昇（45日/30日の窓）
mcDetectGuests    客数
mcDetectFromErrorCenter   既存エラーセンターからの取り込み
```

**つまり第8章は「新規実装」ではなく「1画面に並べ直す」作業。**

### 第9章「店長通知」→ 完成している

| 仕様の要求 | 既存 |
|---|---|
| 店長名をコードに固定しない | `mcStoreManagersOf(storeId)` |
| 店長未設定なら AM・GM へ | `mcNotifyTargets()` が段階的に落とす |
| 未送信／送信済／未読／既読／確認済 | `mcNotifStatusLabel()` / `management_notifications` |
| 完了報告しても自動解決しない | `MC_TRANSITION` が GM/AM の確認を要求する |
| 重複通知を作らない | `dedupe_key` ＋ `MC_TOUCH_MIN`（180分） |
| 重要度上昇・悪化・未確認・再発のみ再通知 | `mcAlertChanged()` / `mcRenotify()` |
| Outboxパターン | `notification_outbox` ＋ RPC `mc_notify`（原子的に通知＋Outbox作成） |

### 第11章「保存・同期」→ 完成している

| 仕様の要求 | 既存 |
|---|---|
| localStorage を正としない | 管理統括は Supabase が正。localStorage は使っていない |
| updated_at / updated_by / version | `mcUpdateLocked(table, id, version, fields)` |
| 同時編集競合の検知 | 楽観ロック（version 不一致で `mcHandleConflict()`） |
| idempotency key | `mcIdemKey(kind, parts)` |
| 監査ログ | `management_alert_events` ＋ `mcLogEvent()` |
| 自動保存・保存中／保存済み／エラー／再保存 | `MC_SAVE_DEBOUNCE`(700ms) / `mcFieldFlush` / `mcSetSaveState` / `mcRetrySave`（3s・8s・20s） |
| 入力内容を消さない | `mcRowFor()` が保留中の値を保持 |
| 複数端末リアルタイム反映 | Supabase Realtime（v819） |

**第11章は追加実装ゼロ。**新画面も同じ関数を通せばよい。

---

## 2. 本当に無いもの（新規に作る）

### A. 判定層 — `mdVerdict()`

管理統括は「しきい値を超えたらアラート」で、**達成／未達／判定不可という3値を持っていない。**
仕様の第1章・第5章・第6章・第7章はすべてこの3値の上に乗っている。

**設計：既存の計算を包むだけの薄い層にする。**

```
mdVerdict(storeId, kpiCode, ym)
  → { state:'ok' | 'miss' | 'unknown',
      actual, target, diff, rate,
      dir:'up'|'down',        上限型か下限型か
      reason }                unknown のときだけ理由が入る
```

- `dir:'up'`（売上・客数・客単価・利益・スキル実施率）… 実績 >= 目標 で達成
- `dir:'down'`（人件費率・原価率・オーバーワーク）… 実績 <= 目標上限 で達成
- 目標は `mcThr(code, storeId)` から引く。**コードに固定しない**（仕様第5章）

**`unknown`（判定不可）の理由は必ず文字列で持たせる。**
仕様が挙げている6つに対応：予算未登録／目標未設定／データ未同期／期間データ不足／入力漏れ／計算エラー。

判定材料はすでに揃っている：

| 理由 | 判定に使う既存の値 |
|---|---|
| 予算未登録 | `c.budMonth === 0` |
| データ未同期・入力漏れ | `c.daysPassed - c.daysWithActual` |
| 対象期間のデータ不足 | `mcEnoughDays(c, storeId)`（v820で作った月初ガード） |
| 原価が暫定 | `foodCostOf().mode === 'provisional'`（期末棚卸未入力） |
| 目標未設定 | `mcThr()` が既定値しか返さない |

**月末予測は既存の `mcDetectBudget` の中にある。**
判定層に出すときは共通関数へ切り出して、検知側もそれを呼ぶようにする
（2か所に同じ計算を書かない ＝ v835の教訓⑬）。

### B. 必須KPI設定（GMが設定）— 新規の保存キー

仕様第5章「店舗全体の判定に使用するKPIは、GMが設定できるようにしてください」。
**この概念は存在しない。**

**保存キー：`md_primary_kpi_<店舗ID>`**

v836 の教訓がそのまま当てはまる。**手入力データなので、以下3点セットで入れる。**

1. `OP_SYNC_PREFIX` に追加（クラウド同期）
2. `OP_MERGE_PREFIX` に**合流ルール**を追加（単一オブジェクトなので項目ごとに `_at` を持つ ＝ `mergeFcMonthly` と同じ形）
3. `LS_NEVER_FREE` に追加（容量整理で消えないように）
4. `merge_probe.js` の `SAMPLE` に実キー名を追加

**この4つを同時にやること。**片方だけ入れるのが v832（`warnings_`）の事故の形。

初期値（GMが変えるまでの既定）：売上・人件費率・原価率・営業利益。

### C. PC幅レイアウト

現状の `@media`：

```
max-width:640px 系 … 3件
min-width:600px    … 1件
```

**実質モバイル専用。**仕様の「左：全体・店舗・KPI ／ 右：Work Center」は新規。

**設計：既存CSSを壊さず、加算だけで作る。**

- `@media (min-width:1024px)` を新設し、Management Dashboard のコンテナにだけ効かせる
- 640px 以下の既存ルールには一切触らない（全画面のモバイル表示を壊さないため）
- スマホは仕様どおり「緊急確認・コメント・承認・対応状況変更」の1カラムに落とす

---

## 3. 重大な問題（着手前に判断が要るもの）

仕様は「重大な権限・データ構造上の問題以外は止めずに進めてください」とあるので、
**該当する1件だけ**を挙げる。

### ① 昨対（前年同月比）のデータが存在しない ← 判断待ち

仕様は第1章・第4章・第5章・第7章で繰り返し「昨対」を要求しているが、

```
ソース全体で "2025-" の出現：0件
ソース内に現れる年：2026 のみ（23件）
```

**アプリは2026年のデータしか持っていない。**予算も `BUDGET_MONTHLY` が2026年のみ、
日次実績も2026年のみ。したがって昨対は**計算できない**。

前月比は `monthStats(storeId, -1)` で今すぐ出せる。昨対だけが出せない。

**選択肢は3つ。**

1. **2025年をToastから取り込む** — 同期センター → 店舗選択 → 期間指定取り込み（`doRangeImport`）で
   2025年を引けるかを実機で確認する。引けるなら昨対は成立する。
   ただし全店×12か月ぶんの取り込みになるので、容量と時間の見積もりが要る
2. **昨対は当面「判定不可」と表示する** — 枠だけ作っておき、データが入ったら自動で出る
3. **昨対を仕様から外し、前月比で代替する** — 今すぐ全部出せる

**推奨は2。** 枠を作るコストはほぼゼロで、あとから1のデータが入れば何もせず出る。
1を先にやると Management Dashboard の着手が止まる。

---

## 4. 判断が要るが、既定値を決めて進められるもの

止めずに進める。以下の既定で作り、違えば後から変える。

| | 既定として採用するもの |
|---|---|
| 店舗全体判定の必須KPI | 売上・人件費率・原価率・営業利益（GMが変更可） |
| 日中の売上判定 | 時間帯別予算は**存在しない**。ただし予算は曜日×ランチ/ディナーで持っているので、**L/D単位の進捗予算**で判定する。「時間帯別」より粗いが、既存データで正確に出せる |
| 本日の着地予測 | 過去4週の同曜日・同L/Dの構成比から推計。現在進捗と着地予測は仕様どおり分けて表示 |
| CEO の表示範囲 | GM と同じデータ範囲・表示項目のみ絞る |
| AI Help | Phase 2。Phase 1 では入口だけ置いて非表示 |

---

## 5. 版の割り方（Phase 1）

**1版1目的。各版で `run_verify.js` を通す。**

| 版 | 内容 | 画面変更 |
|---|---|---|
| v837 | **判定層 `mdVerdict()`** ＋ 判定不可の理由 ＋ 月末予測の共通化 | なし（純粋な追加） |
| v838 | **必須KPI設定** ＋ 保存キー4点セット ＋ GM設定画面 | 設定のみ |
| v839 | Management Dashboard の器（PC 2カラム・ヘッダー・全体判定） | 新画面 |
| v840 | 上部KPI 3項目（今日の売上・今月の着地予測・要対応） | |
| v841 | 店舗別の確認表（**ランキングなし**・未達優先の初期表示） | |
| v842 | KPI詳細パネル ＋ 既存分析画面への遷移 | |
| v843 | 役職別UI（SM / Head Chef / AM / GM / CEO） | |
| v844 | Work Center の統合表示（既存 `management_alerts` を並べ直す） | |
| v845 | 店長通知の画面連結（`mcRequestToSm` 等は既存を呼ぶだけ） | |

**v837 から始めるのが安全。**画面を一切変えずに判定ロジックだけを入れ、
検証で「上限型・下限型・判定不可・境界値」を先に固める。
v839 以降の画面は、この判定層を表示するだけになる。

**管理統括の「整備中」バナーは、v844 で Work Center 統合が終わるまで残す。**

---

## 6. 守ること（既存の確定事項・変えない）

`HANDOFF_v836.md` 第6章より、この作業に効くもの：

- **数字の計算を新しく作らない**（`cumulativeToToday` / `foodCostOf` / `laborCoreForYm` / `ecCollect`）
- 権限はアプリ層で判定する（案A・確認済み）＋ RLS でも制限
- 店長は role では決まらない。`mcIsStoreManagerEmp()` が唯一の判定口
- Head Chef は原価・仕入のみ。その分野のときだけ通知先に入る
- 更新は必ず `version` を条件に入れる。競合しても押し切らない
- 宛先は毎回マスターから引く。通知を破棄しない
- **手入力データの新キーは「合流ルール＋LS_NEVER_FREE＋SAMPLE」を同時に入れる**（v832・v836の教訓）
- **同じ判定を2か所に書かない**（v835 教訓⑬）
