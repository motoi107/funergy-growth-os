# GitHub経由の共同開発・自動更新

## 目指す流れ

依頼を共有記録へ保存 → 一方のAIが作業ブランチで改修 → GitHubへ直接保存 → コード検証と他方のAIによるレビュー → 指摘を修正して最新版を再確認 → 条件を満たした変更をmainへ反映 → 既存のGitHub Pagesで公開 → 作業履歴を保存。

今回、アプリ本体・業務データ・公開先は変更しない。初期設定は共有記録と検証・レビューの接続を用意するもの。

## 初回に必要な接続

### Claude

1. 完了: Claude Code WebでGitHubを接続し、`motoi107/funergy-growth-os` を選択した。
2. 完了: Claude GitHub Appをこのリポジトリに接続した。
3. 完了: Claudeが `CLAUDE.md` と読み込み先の共有記録を実セッションで確認した。
4. Claude Routine「Growth OS：Claude自動レビュー」を作成済み。画面で確認したイベント設定は `All pull request events`、フィルターは `Base branch equals main` と `Is draft equals false`。指示で対象を未マージ・同一リポジトリのPRに限定し、同一SHAへの完了済みレビューを重複投稿しない。コード変更・マージ・公開は行わず、結果をPRに記録する。手動実行によるPR #2のレビュー投稿は確認済み。GitHubイベントによる自動起動と更新後の再レビューは本更新のpushで検証し、結果をPR #2に残す。
5. 同梱のGitHub Actions版レビューを代わりに使う場合、GitHub ActionsのSecretに次のいずれかを登録する。値はコードやPRへ書かない。
   - Claudeの契約を利用: `CLAUDE_CODE_OAUTH_TOKEN`。Claude Codeの `claude setup-token` または `/install-github-app` で準備する。
   - API利用: `ANTHROPIC_API_KEY`。この場合はRepository variable `GROWTH_CLAUDE_AUTH` を `api` にする。API利用料が発生する。
6. Actions版を使う場合だけ、Repository variable `GROWTH_CLAUDE_REVIEW_ENABLED` を `true` にする。未設定の間はClaudeジョブを実行しない。

代わりにClaude Codeのブラウザ版からPRを開き、Auto-fixを有効にして、CI失敗やレビュー指摘の修正を任せる方法もある。通常のチャットへのGitHub資料接続だけでは、コードの自動保存まで有効になったと扱わない。

### Codex

このチャットから対象リポジトリの読み書きができる。2026-09-07に再接続後、ブランチ作成、コミット、PR #1の作成とマージまで成功した。

GitHubのPRイベントから動くCodexの自動確認はまだ登録していない。

別の方法としてCodex cloudで同じリポジトリを設定し、Code review / Automatic reviewsを有効にできる。二重レビューを避けるため、常設するCodex側の自動確認は一つにする。特定の変更への手動依頼は `@codex review`。

## このリポジトリに追加する設定

- `AGENTS.md` と `CLAUDE.md`: 両AIが同じ記録を読む入口。
- `docs/AI_SHARED_MEMORY_JA.md`: 決定事項と構成。
- `docs/AI_BACKLOG_JA.md`: 未解決事項と次の作業。
- `.github/workflows/growth-checks.yml`: PRとmainの更新で、構文とバージョン整合を確認。
- `.github/workflows/growth-claude-review.yml`: 認証・有効化後に、同じリポジトリの作業ブランチをClaudeがレビュー。

両AIの常時稼働、全チャットの同期、データベースのバックアップをこれらのファイルだけで実現するものではない。

## 自動公開の有効化条件

この設定では自動マージを有効にしない。次の確認が済んだ後に、リポジトリ側の必要なチェックと公開条件を設定する。

1. 認証が実際に通り、両AIのレビューがPR上に残る。
2. 修正コミットが追加されたとき、以前のレビューを使い回さず最新コミットを再確認する。
3. CI成功だけでは公開許可にしない。AI処理が成功しても指摘が残る場合があり、レビュー未実施・省略・失敗は合格として扱わない。
4. 対象機能の動作確認を追加し、必要なチェックをGitHubのブランチ保護で実際に必須にする。
5. 条件を満たしたPRの自動マージと既存Pages公開を小さな変更で確認する。
6. 問題があれば直前のコードへ戻す手順を検証する。コードの差し戻しだけで業務データまで戻ったと扱わない。

日常の軽微な改善は、この一連の条件が整ってから自動公開へ進める。業務上の新しい仕様判断が必要なものは、何を決める必要があるかを短く報告する。コピペをユーザーへ戻さない。

## 公式資料（2026-09-06確認）

- Claude Code / GitHub Actions: https://code.claude.com/docs/en/github-actions
- Claude Code / ブラウザ版・Auto-fix: https://code.claude.com/docs/en/claude-code-on-the-web
- Claude Code / Routines: https://code.claude.com/docs/en/routines
- Claudeのプロジェクト記憶: https://code.claude.com/docs/en/memory
- Codex / GitHubレビュー: https://learn.chatgpt.com/docs/third-party/github
- GitHub / 自動マージ: https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request
