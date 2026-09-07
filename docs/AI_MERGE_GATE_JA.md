# 自動レビューと条件付きマージ

## 運用状態と役割

Claude RoutineはPR更新イベントから起動し、PR #2の324897afを実際に再レビューした。根拠はPR #2のコメント5574215507。Codexは実装・検証記録を残し、Claudeの指摘を修正した。これは自動マージの有効化とは別である。

2026-09-07、Work側に「Growth OS Codexレビュー」を登録した。対象はこのリポジトリのPR作成・更新・レビュー・会話コメント。CodexはClaudeが作った変更もレビューする。PRへの実投稿を確認するまでは、登録済みと実行確認済みを区別する。イベントには配信制限があり、未実行やレビュー待ちは合格として扱わない。

役割は、Claudeが独自の実レビューを残し、Codexが差分を自分でも確認した上でClaudeの指摘と検証結果を照合する形。実装担当による確認を独立した別AIのレビューと偽らない。

## 機械チェック

`Growth AI review gate` はGitHubのコミットステータス。通常のワークフロージョブの緑色とは異なる。次の条件を全て確認する。

- main向け、open、非draft、同じリポジトリのPR。
- 変更は `docs/AI_SHARED_MEMORY_JA.md`、`docs/AI_BACKLOG_JA.md`、`docs/AI_AUTOMATION_SETUP_JA.md` の既存の通常ファイルの更新だけ。アプリ本体、指示入口、Actions、判定コード、改名、symlinkは初期の自動マージ対象外。
- 投稿者motoi107、Codex App ID 1144995 / slug chatgpt-codex-connectorから届いた最新の決定コメントが、現在のheadとbaseのSHAについてpass / docs-onlyと明記する。
- その決定が引用するClaudeコメントが、Claude App ID 1236702 / slug claudeによる同じ投稿者の実投稿で、最新headを明記し、Codexが確認した後に新しいClaudeレビューが追加されていない。
- 決定コメントとClaudeの証拠コメントは投稿後に編集されていない。修正は新しいコメントで行う。
- 未解決のREQUEST_CHANGESがない。

これはコメントの内容を理解する別のAIではない。Claudeの自由文の結論・残課題・必要なテストはCodexが実際に読み、判定する。ステータス判定コードは投稿元・SHA・証拠ID・対象ファイルを機械的に照合する。既存CIの成功は別の必須チェックとする。Codexが必要なCIを確認するとき、`Growth AI review gate` 自体は入力にしない（決定コメントを待つため循環する）。

ワークフローはmainの判定コードだけを実行し、PRのコードを取得して実行しない。PR本文やコメントをシェルへ渡さない。権限は参照とコミットステータス書き込みだけで、マージ・設定変更は行わない。

## 所有者によるGitHub設定

確認時点でリポジトリの `allow_auto_merge` はfalse、Rulesets一覧は空。この連携には管理権限がなく、従来のbranch protectionの参照も403だった。従来ルールが存在しないとは断定できない。ルールを弱めたり別経路で管理権限を代用しない。

所有者がGitHubのSettingsで以下を設定する。既存ルールがある場合は確認して追加する。

1. Rules → Rulesets → New branch ruleset。名前 `Growth OS reviewed changes`、EnforcementはActive、対象はmain、Bypass listは空。
2. Require a pull request before mergingを有効にする。AIは所有者名義でコメントするため、これを別人の正式なApprove件数と数えない。初期設定の必要Approve件数は0とし、以下の機械チェックを必須にする。既存の必要承認者がいれば削減しない。
3. Require status checks to passを有効にし、`Static release validation`、`Review gate policy tests`、`Growth AI review gate` を追加。発行元はGitHub Actions。Require branches to be up to date before mergingも有効にする。
4. Block force pushesとRestrict deletionsを有効にする。
5. General → Pull Requests → Allow auto-mergeを有効にする。

設定後にこの連携でRulesetのactive状態・mainへの対象条件・必須チェック・bypassなしを再確認する。それまではPRのauto-mergeを有効にしない。条件が確認できた後、対象PRの最新レビューとCIを確認してからGitHub標準のauto-mergeを設定する。直接mergeでチェック待ちを回避しない。

## 検証と対象拡大

`.github/scripts/growth-review-gate.test.cjs` は古いhead/base、偽のAI署名、証拠欠落、レビュー後の変更、symlink、範囲外のアプリ変更、未解決指摘が合格にならないことを確認する。

初回の判定コード導入は、Actionsの権限と機械チェックそのものを変えるため、自動マージ対象外。両AIの実レビューと試験後に担当セッションで取り込む。続く共有記録だけのPRで、Codex自動起動・両AIの実投稿・必須チェック・条件付きマージを実地確認する。

アプリ本体は、保存・権限・日英・対象機能などの試験を追加し、その試験が必須になることを確認してから自動マージ範囲を別PRで拡大する。構文検査だけでアプリ全体の自動公開を有効にしない。

公式資料:
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
