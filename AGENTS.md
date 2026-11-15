# Growth OS: shared instructions for coding agents

Follow `docs/DEV_WORKFLOW.md` for starting work, handing over, parallel work, PR contents and the Codex review loop. When continuing a task, read `docs/handoff/<task-id>.md` first (template and rules: `docs/HANDOFF.md`).

`docs/AI_SHARED_MEMORY_JA.md` and `docs/AI_BACKLOG_JA.md` are very large. Do not load them in full: read their newest sections at the top and search them for terms related to the task. Update them when a decision, verified result, or next step changes. Read the relevant existing handoff and verification files for the area being changed; version numbers in their filenames do not establish the current release.

## Roles

- Implementation: Claude, from either Moto's personal workspace or the company Team workspace. Either one may start a task or take it over at a handover point. The Claude currently in charge of a branch also fixes Codex's findings on that PR.
- Review: Codex reviews the PR head and re-reviews after fixes. In this workflow Codex does not commit, open fix PRs, merge, or change repository settings.
- Decisions, merging and production changes (SQL, Edge Functions, Secrets, devices): Moto.
- Every actor appears on GitHub as `motoi107`. Identify the Claude that wrote a commit with a `Claude-Workspace: personal` or `Claude-Workspace: team` trailer, and state it in the PR body and the handoff record.

## Project boundaries

- This repository is the GitHub edition of Growth OS, published with GitHub Pages at the domain in `CNAME`. Its current application is `index.html` with `sw.js` and `appicons/`.
- A separate Growth OS project exists in ChatGPT Sites. It has a different source history and architecture. Never overwrite one edition with the other, change their data connections, or switch the production domain as an incidental part of synchronization.
- Start from the current remote commit, work in one feature branch per task, and push commits directly through the authorized integration. Do not ask Moto to copy generated code into GitHub.
- Assign one editing Claude (personal or Team) per branch at a time. Codex reviews the committed head. Fetch again before a handoff; do not force-push over someone else's work. Do not keep long-lived per-account branches.

## Shared memory

- GitHub contains shared specifications, decisions, work status, test evidence and code history. It does not automatically synchronize either product's private chat memory.
- Record the exact commit reviewed, actual reviewer, findings, test results and unresolved items. Never describe a Codex-only review as a Claude review, or treat an old review as approval of a new commit.
- This repository is public. Keep shared notes about the software and its behavior. Do not add credentials, customer or applicant records, staff compensation, private chats, or production database exports.
- Task-specific instructions from Moto take precedence. Do not manufacture new approvals or change business rules as part of performance work.

## Validation and release

- Run `python3 scripts/check-static-release.py` for application or service-worker changes. It checks JavaScript syntax and matching release markers and reports source size. It does not prove correct business behavior or actual loading speed.
- Also exercise the affected behavior with suitable non-production data; include the commands and outcomes in the PR. Keep existing, relevant verification scripts.
- Keep `APP_VERSION` and `SW_BUILD` aligned when releasing application changes. Preserve the update mechanism that lets users finish editing before switching versions.
- Review the exact latest PR head again after fixes. A successful AI workflow, a skipped run, or a comment with no findings is not automatically a GitHub approval or a passing product test.
- The initial integration setup does not enable automatic merging. Complete the connection and release checks in `docs/AI_AUTOMATION_SETUP_JA.md` before enabling unattended publication.

## Code Review Rules

### Findings that matter

Prioritize findings that can lose or corrupt saved data, let one user see or change another's data, produce wrong money, hours, tips or payroll figures, break login or offline updates, or make production steps unsafe. Give each finding a concrete reproduction or the exact code path. State what was not checked.

### Store and employee data separation

Check that a store, role or grade cannot read or write another store's or another employee's records through the app, the public key, or an Edge Function, and that the server, not only the screen, enforces it.

### Database compatibility

Check that SQL can run twice safely, stops without changing anything when its preconditions are missing, keeps existing rows and grants, and stays compatible with app versions that are still installed on devices.

### PC, smartphone and the installed iPhone app

Check affected screens at PC and smartphone widths, in the iPhone home-screen app (the same PWA), and in Japanese and English when both exist.

### Data and permissions

Check that saved edits remain durable, concurrent updates do not overwrite each other, and existing access and business approval behavior is preserved. Do not validate by writing to production data.

### Performance

Distinguish source-size evidence from measured user-visible latency. Check initial script execution, unnecessary requests, repeated loading, and cache behavior without removing needed data or weakening authorization.

### Release compatibility

Check that the main HTML, service worker, release marker, and offline update behavior remain compatible. Review both Japanese and English flows when an affected feature has both.
