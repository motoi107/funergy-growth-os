'use strict';

const OWNER = 'motoi107';
const REPO = 'funergy-growth-os';
const CONTEXT = 'Growth AI review gate';
const ALLOWED = new Set([
  'docs/AI_SHARED_MEMORY_JA.md',
  'docs/AI_BACKLOG_JA.md',
  'docs/AI_AUTOMATION_SETUP_JA.md',
]);
const apps = { codex: [1144995, 'chatgpt-codex-connector'], claude: [1236702, 'claude'] };
const fresh = c => c.created_at === c.updated_at;
const from = (c, agent) => c.user?.login === OWNER &&
  c.performed_via_github_app?.id === apps[agent][0] &&
  c.performed_via_github_app?.slug === apps[agent][1];
const mentions = (body, sha) => new RegExp(`(?<![a-f0-9])${sha}(?![a-f0-9])`, 'i').test(body || '');
const result = (state, description) => ({ state, description });

function evaluate({ pr, files, comments, reviews, modes }) {
  if (pr.state !== 'open' || pr.draft || pr.base.ref !== 'main' ||
      pr.head.repo?.full_name !== `${OWNER}/${REPO}`)
    return result('failure', 'Outside permitted PR scope');
  if (!files.length || files.some(f => !ALLOWED.has(f.filename) ||
      f.status !== 'modified' || f.previous_filename || modes[f.filename] !== '100644'))
    return result('failure', 'Manual release: files outside initial documentation scope');

  // A later submission by the same reviewer supersedes an earlier submission.
  const latestReviews = new Map();
  for (const r of reviews) if (r.user?.login && r.state !== 'PENDING') latestReviews.set(r.user.login, r);
  if ([...latestReviews.values()].some(r => r.state === 'CHANGES_REQUESTED'))
    return result('failure', 'Unresolved change request');

  const decisions = comments.filter(c => from(c, 'codex') &&
    c.body?.startsWith('<!-- growth-ai-decision: '));
  let chosen;
  for (const c of decisions.slice(-1)) {
    const line = c.body.split('\n')[0];
    const m = line.match(/^<!-- growth-ai-decision: (\{.*\}) -->$/);
    let d;
    try { d = m && JSON.parse(m[1]); } catch { /* Invalid evidence never passes. */ }
    if (d?.head_sha === pr.head.sha && d?.base_sha === pr.base.sha) chosen = { c, d };
  }
  if (!chosen) return result('pending', 'Waiting for Codex decision on current head and base');
  const { c, d } = chosen;
  if (!fresh(c)) return result('failure', 'Edited Codex decision requires a new review');
  if (d.version !== 1 || d.scope !== 'docs-only' || d.verdict !== 'pass')
    return result(d.verdict === 'waiting' ? 'pending' : 'failure', 'Codex decision is not a passing documentation review');
  const claude = comments.filter(x => from(x, 'claude') && mentions(x.body, pr.head.sha));
  const evidence = claude.at(-1);
  if (!evidence || !fresh(evidence) || evidence.id !== d.claude_comment_id ||
      evidence.created_at > c.created_at)
    return result('pending', 'Waiting for Codex to confirm the latest authentic Claude review');
  return result('success', 'Current Codex decision and Claude evidence match; documentation only');
}

async function run({ github, context, core }) {
  const repo = { owner: OWNER, repo: REPO };
  if (context.repo.owner !== OWNER || context.repo.repo !== REPO) throw Error('Wrong repository');
  // Concurrency can coalesce pending events. Recheck every open PR so an event
  // for another PR cannot leave a dropped event's previous passing status stale.
  const numbers = (await github.paginate(github.rest.pulls.list, { ...repo, state: 'open', base: 'main', per_page: 100 })).map(p => p.number);
  for (const number of numbers) {
    const pr = (await github.rest.pulls.get({ ...repo, pull_number: number })).data;
    if (pr.state !== 'open' || pr.head.repo?.full_name !== `${OWNER}/${REPO}`) continue;
    const files = await github.paginate(github.rest.pulls.listFiles, { ...repo, pull_number: number, per_page: 100 });
    const comments = await github.paginate(github.rest.issues.listComments, { ...repo, issue_number: number, per_page: 100 });
    const reviews = await github.paginate(github.rest.pulls.listReviews, { ...repo, pull_number: number, per_page: 100 });
    const commit = (await github.rest.git.getCommit({ ...repo, commit_sha: pr.head.sha })).data;
    const tree = (await github.rest.git.getTree({ ...repo, tree_sha: commit.tree.sha, recursive: '1' })).data;
    const modes = Object.fromEntries(tree.tree.map(e => [e.path, e.mode]));
    const decision = tree.truncated ? result('failure', 'Incomplete tree; manual verification required') :
      evaluate({ pr, files, comments, reviews, modes });
    const current = (await github.rest.pulls.get({ ...repo, pull_number: number })).data;
    if (current.state !== 'open' || current.head.sha !== pr.head.sha || current.base.sha !== pr.base.sha) {
      core.info(`PR #${number} moved; do not publish stale decision`);
      continue;
    }
    await github.rest.repos.createCommitStatus({ ...repo, sha: pr.head.sha, context: CONTEXT,
      ...decision, target_url: `https://github.com/${OWNER}/${REPO}/pull/${number}` });
    core.info(`PR #${number}: ${decision.state}: ${decision.description}`);
  }
}

module.exports = { evaluate, run };
