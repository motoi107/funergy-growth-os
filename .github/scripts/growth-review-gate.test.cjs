'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('./growth-review-gate.cjs');
const head = 'a'.repeat(40), base = 'b'.repeat(40);
const path = 'docs/AI_SHARED_MEMORY_JA.md';
const user = { login: 'motoi107' };
function sample() {
  const claude = { id: 10, user, performed_via_github_app: { id: 1236702, slug: 'claude' },
    body: `Claude review ${head}`, created_at: '2026-09-07T01:00:00Z', updated_at: '2026-09-07T01:00:00Z' };
  const codex = { id: 11, user, performed_via_github_app: { id: 1144995, slug: 'chatgpt-codex-connector' },
    body: '<!-- growth-ai-decision: ' + JSON.stringify({ version: 1, head_sha: head, base_sha: base, verdict: 'pass', scope: 'docs-only', claude_comment_id: 10 }) + ' -->\nCodex review',
    created_at: '2026-09-07T01:01:00Z', updated_at: '2026-09-07T01:01:00Z' };
  return { pr: { state: 'open', draft: false, head: { sha: head, repo: { full_name: 'motoi107/funergy-growth-os' } }, base: { ref: 'main', sha: base } },
    files: [{ filename: path, status: 'modified' }], comments: [claude, codex], reviews: [], modes: { [path]: '100644' } };
}
test('current evidence from both verified apps passes docs-only changes', () => assert.equal(evaluate(sample()).state, 'success'));
const blocked = {
  'old head': s => { s.pr.head.sha = 'c'.repeat(40); },
  'old base': s => { s.pr.base.sha = 'c'.repeat(40); },
  'application edit': s => { s.files.push({ filename: 'index.html', status: 'modified' }); },
  'renamed file': s => { s.files[0].previous_filename = 'index.html'; },
  'symlink': s => { s.modes[path] = '120000'; },
  'fake Claude label': s => { s.comments[0].performed_via_github_app = null; },
  'fake Codex label': s => { s.comments[1].performed_via_github_app = null; },
  'untrusted author': s => { s.comments[1].user = { login: 'someone' }; },
  'edited decision': s => { s.comments[1].updated_at = '2026-09-07T01:02:00Z'; },
  'edited Claude evidence': s => { s.comments[0].updated_at = '2026-09-07T01:02:00Z'; },
  'missing Claude': s => { s.comments.shift(); },
  'newer Claude review not examined': s => { s.comments.push({ ...s.comments[0], id: 12 }); },
  'blocked verdict': s => { s.comments[1].body = s.comments[1].body.replace('"pass"', '"blocked"'); },
  'bad JSON': s => { s.comments[1].body = '<!-- growth-ai-decision: {bad} -->'; },
  'outstanding change request': s => { s.reviews = [{ user, state: 'CHANGES_REQUESTED' }]; },
  'draft': s => { s.pr.draft = true; },
  'fork': s => { s.pr.head.repo.full_name = 'someone/funergy-growth-os'; },
};
for (const [name, mutate] of Object.entries(blocked)) test(name + ' never passes', () => { const s = sample(); mutate(s); assert.notEqual(evaluate(s).state, 'success'); });
