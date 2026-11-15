# two-claude-workflow：個人と Team の Claude 2 つで実装・Codex でレビューする開発フロー

- 目的：個人のワークスペースの Claude と、会社の Team ワークスペースの Claude が、同じ GitHub のリポジトリで Funergy+ を開発し、どちらでも作業を始められ・途中から引き継げるようにする。Codex は独立したレビューだけ。手順は `docs/DEV_WORKFLOW.md`、引き継ぎの記録の決まりは `docs/HANDOFF.md`。
- 担当 Claude：個人（推定・未確認。このセッションがどちらのワークスペースかは画面から確かめられない。Moto さんに確かめる）
- ブランチ：claude/two-claude-workflow　PR：（このコミットのあとに下書きで作る・base main）
- 基準コミット（main）：5e11a2bc3868024b141b899b1df1c7307a2be109（v1169）
- 保存済みコミット：（この記録と同じコミット。最初のコミットなので 1 つ前は無い）
- 状態：作業中（Moto さんの判断待ちがある。下の「次に行うこと」）

## 変更内容

- 新しい：`docs/DEV_WORKFLOW.md`（役割・どこに何があるか・環境・作業 ID とブランチと版の番号・作業開始・交代・同時の開発・PR の本文・Codex のレビュー・マージと本番と戻し方・記録・試し方 S1〜S4）。
- 新しい：`docs/HANDOFF.md`（引き継ぎの記録の決まりとひな形）。
- 新しい：`docs/handoff/two-claude-workflow.md`（この記録）。
- 新しい：`.env.example`（設定の名前だけ・値は空）。
- 変えた：`CLAUDE.md`（入口を短くし、`AGENTS.md` と `docs/DEV_WORKFLOW.md` を読む形に。大きな記録 2 つの丸ごとの読み込みをやめた＝Moto さんの判断 1）。
- 変えた：`AGENTS.md`（役割・大きな記録の読み方・作業開始と交代の参照・レビューの観点を足した）。
- 変えた：`docs/AI_AUTOMATION_SETUP_JA.md`（先頭に、今の流れは `docs/DEV_WORKFLOW.md` と書いた。中身は前のまま）。
- 変えた：`docs/AI_SHARED_MEMORY_JA.md`・`docs/AI_BACKLOG_JA.md`（先頭に 11/15 の節）。
- アプリ（index.html・sw.js）・SQL・関数・ワークフロー（`.github/`）・予定タスク（Claude のルーティン）・Codex の設定は変えていない。

## 未完了

- このセッションが個人か Team か（未確認）。
- Codex をどこから動かしているか（ChatGPT 側の設定。このリポジトリからは見えない）。
- 予定タスク「Growth OS：Claude自動レビュー」（2026-09-07 に作った）がどちらのワークスペースのものか（未確認）。
- Team の Owner がだれか・Team で GitHub の接続を有効にしたか（未確認）。
- iPhone のネイティブのアプリのリポジトリ（このセッションから見えるリポジトリには無い。未確認）。
- `funergy_supabase_client.js` が指す Supabase のプロジェクト（`index.html` が使う本番とは別。使っているかは未確認）。
- 検証の手順（`docs/DEV_WORKFLOW.md` の 12（S1〜S4））は、まだ 1 回も流していない。

## 検証結果

| 確かめたこと | コマンド・方法 | 結果 |
|---|---|---|
| 文書の空白・末尾の空行 | `git diff --cached --check` | 通った（2026-11-15・コミットの前） |
| アプリの版の一致 | `python3 scripts/check-static-release.py` | pass・1169（アプリは変えていない） |
| 個人 → Team → Codex → 直す → 再レビューの試し | `docs/DEV_WORKFLOW.md` の 12（S1〜S4） | 未実行 |
| 秘密の値・メールの混入 | 新しいファイルと CLAUDE.md・AGENTS.md を鍵・トークン・会社のメールの形で検索 | 見つからない |

## Codex の判定と対応

| 判定の head | 判定 | 指摘 | 対応コミット | 状態 |
|---|---|---|---|---|
| （まだ） | | | | |

## 本番反映

- アプリ：なし（文書だけ）
- SQL・関数・Secrets：なし
- 非公開ファイル：なし

## 次に行うこと

1. Moto さん：このセッションが個人か Team か（画面の左下の組織名）を Claude に。
2. Moto さんの判断：① `CLAUDE.md` から大きな記録 2 つの丸ごとの読み込みを外してよいか ② 非公開のファイル（auth-pin・hyper-worker・PIN の確かめの入った 1 ファイル）をどこに置くか ③ リポジトリを公開のままにするか ④ 予定タスク「Growth OS：Claude自動レビュー」を残すか ⑤ main の保護（任意）。
3. Codex：この PR（下書きを外したあと）の最新の head のレビュー。
4. そのあと：`docs/DEV_WORKFLOW.md` の 12（S1〜S4）（本番には何も入れない）。
