// Codex review of PR #44, head 1979f7f. Synthetic data only; no external requests.
// These assertions express the expected behavior and fail on the reviewed head.
// Reuse only the setup preceding the PR's tests, with the real UI, handler and SQL.
// Adjusted by Claude for v2 (段階 4-2, v1069): the fixture now loads all three migrations (v1066, v1068 fixes, v2);
// R1 and R3 use the v2 fields; R2 and R4 are skipped because v2 removed those concepts (see each test).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const fixtureUrl = new URL('../mid-review-ui.test.mjs', import.meta.url);
let fixture = fs.readFileSync(fixtureUrl, 'utf8').split('\ntest(')[0];
fixture = fixture
  .replace("'../supabase/functions/mid-review/handler.mjs'", JSON.stringify(new URL('../supabase/functions/mid-review/handler.mjs', fixtureUrl).href))
  .replace("'./runtime/node_modules/@electric-sql/pglite/dist/index.js'", JSON.stringify(new URL('./runtime/node_modules/@electric-sql/pglite/dist/index.js', fixtureUrl).href))
  .replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href));
const { server, app, U, html, fillAll } = await import('data:text/javascript;base64,' + Buffer.from(fixture + '\nexport { server, app, U, html, fillAll };').toString('base64'));
const openStore = async (c, id) => {
  await c.show(); c.run(`mrOpenStore(${JSON.stringify(id)})`);
  c.renderPage(); await c.flush(); c.renderPage();
};
const reply = (c, target, reason) => {
  c.run(`mrRpSet(${JSON.stringify(target)}, 'decision', 'no_action', true)`);
  c.run(`mrRpIn({getAttribute:()=>${JSON.stringify(target + '|reason')},value:${JSON.stringify(reason)}})`);
};

test('R1: a response from a submitted store must not clear another store editor', async t => {
  const S = await server(); t.after(() => S.pg.close());
  const c = app(S); await openStore(c, 'D6'); c.run('mrStartInput()');
  // Adjusted by Claude for v2: fill every required v2 field (the v1 lines set consult and two focus statuses).
  fillAll(c);
  await c.flush();
  const originalFetch = c.fetch;
  let release, received;
  const ready = new Promise(r => { received = r; });
  c.fetch = async (url, init) => {
    const response = await originalFetch(url, init);
    if (JSON.parse(init.body).action === 'submit') {
      received(); await new Promise(r => { release = r; });
    }
    return response;
  };
  const submitting = c.run('mrSubmit()'); await ready;
  // Normal back buttons remain available while the submission response is delayed.
  c.run('mrBack(); mrBack()'); await openStore(c, 'D1'); c.run('mrStartInput()');
  // Adjusted by Claude for v2: a v2 field (v1 had focus as a list with notes).
  c.run("mrSetVal('cur.sales.comment','R1 new input in the other store')");
  const nextEditor = c.M().ed;
  assert.equal(nextEditor.state, 'dirty');
  release(); await submitting;
  const stored = await S.api('gm', {action:'get',env:'demo',ym:'2026-10',store_id:'D1'});
  t.diagnostic(JSON.stringify({submittedStore:'D6', currentStore:c.M().view?.id,
    editorRetained:c.M().ed === nextEditor, op:c.M().op,
    newTextSaved:stored.review.body.cur.sales.comment === 'R1 new input in the other store'}));
  assert.equal(c.M().ed === nextEditor, true, 'the D1 draft must survive the delayed D6 response');
});

// Skipped for v2: there are no reply drafts any more — each reply is sent at once with its own client_id (UI案44・spec §5).
test('R2: sending must check the draft set and versions shown on this tab', { skip: 'v2 removed reply drafts (each reply is posted at once with a client_id)' }, async t => {
  const S = await server(); t.after(() => S.pg.close());
  const a = app(S); await openStore(a, 'D1');
  reply(a, 'issue:i1', 'R2 text checked on tab A'); await a.flush();
  const b = app(S); await openStore(b, 'D1');
  reply(b, 'issue:i1', 'R2 replacement still being drafted on tab B');
  reply(b, 'kpi', 'R2 extra draft never seen on tab A'); await b.flush();
  assert.equal(a.M().rp.drafts['issue:i1'].data.reason, 'R2 text checked on tab A');
  assert.equal(a.M().rp.drafts.kpi, undefined);
  await a.run('mrRpSend(false)');
  const record = await S.api('gm', {action:'get',env:'demo',ym:'2026-10',store_id:'D1'});
  const sent = record.replies.filter(x => x.mine && x.state === 'sent');
  t.diagnostic(JSON.stringify({visibleCount:1, sentCount:sent.length,
    reasons:sent.map(x => x.data.reason), errors:a.toasts.filter(x => x[1] === 'error')}));
  assert.equal(sent.length, 0, 'a changed draft set must require reload/reconfirmation before sending');
});

test('R3: refreshing the same account must preserve the editor and pending input', async t => {
  const S = await server(); t.after(() => S.pg.close());
  const c = app(S); await openStore(c, 'D6'); c.run('mrStartInput()');
  // Use the actual shared session refresh function. Only the token endpoint and
  // remember-on-device persistence are mocked; all review traffic uses the real handler.
  const start = html.indexOf('var _invInRefreshing = null;');
  const end = html.indexOf('/* Supabase', start);
  assert.ok(start >= 0 && end > start);
  c.invInRtFor = s => s.refresh_token; c.invInKeepRefresh = () => {};
  c.run(html.slice(start, end));
  const originalFetch = c.fetch; let expired = true;
  c.fetch = async (url, init) => {
    if (url.includes('/auth/v1/token?grant_type=refresh_token'))
      return {ok:true, status:200, json:async()=>({access_token:'tok-gm', refresh_token:'refreshed-gm'})};
    if (expired && JSON.parse(init.body).action === 'save') {
      expired = false; return {ok:false, status:401, json:async()=>({error:'unauthorized'})};
    }
    return originalFetch(url, init);
  };
  // Adjusted by Claude for v2: a v2 field (v1 had focus as a list with notes).
  c.run("mrSetVal('prev.sales.comment','R3 before refresh')");
  assert.equal(await c.run('mrSaveNow()'), true);
  const editor = c.M().ed;
  // Adjusted by Claude for the v1068 fix: the original line asserted that the review kept the old session object
  // (true on 1979f7f). The fix follows the rotation, so only check that the refresh actually happened.
  assert.equal(c._botSession.refresh_token, 'refreshed-gm', 'the refresh happened');
  // Choosing a radio option normally triggers a rerender immediately.
  c.run("mrIn({getAttribute:k=>k==='data-p'?'consult':'1',type:'radio',value:'yes'})");
  t.diagnostic(JSON.stringify({sameAccount:'gm', editorRetained:c.M().ed === editor,
    view:c.M().view, selectedValue:editor.body.consult}));
  assert.equal(c.M().ed === editor, true, 'same-user token rotation must not act as a different-account login');
});

// Skipped for v2: there are no CEO-only decisions or escalation waits any more — replies have an optional response
// and never decide the review; 確認完了 is AM / GM / CEO and its undo GM / CEO, checked by the server's mr_can (spec §2, §5).
test('R4: a CEO changed to GM in manager_auth must not retain CEO-only decisions', { skip: 'v2 removed CEO-only decisions (replies carry an optional response; permissions come from mr_can). The narrowing itself is tested in mid-review-server.test.mjs (“v1068 kept”)' }, async t => {
  const S = await server(); t.after(() => S.pg.close());
  await S.pg.exec('reset role');
  await S.pg.query('update manager_auth set role=$1 where user_id=$2', ['gm', U.ceo]);
  await S.pg.exec('set role service_role');
  const who = await S.api('ceo', {action:'whoami'});
  const payload = {env:'demo',ym:'2026-10',store_id:'D3',expect_no:1};
  await S.api('ceo', {...payload,action:'reply_save',target:'issue:i2',expect_version:null,
    decision:'no_action',data:{reason:'R4 decision after role downgrade'}});
  // Adjusted by Claude for v1068: send the drafts this screen shows (without them v1068 refuses every send
  // with drafts_changed, which would let this test pass without exercising R4).
  const shown = (await S.api('ceo', {...payload,action:'get'})).replies.filter(x => x.mine && x.state === 'draft').map(x => ({id:x.id, version:x.version}));
  const sent = await S.api('ceo', {...payload,action:'reply_send',drafts:shown});
  assert.equal(sent.error, 'incomplete', 'refused because the item waits for the CEO, not for another reason');
  const record = await S.api('ceo', {...payload,action:'get'});
  const escalation = record.replies.find(x => x.target === 'issue:i2' && x.decision === 'escalate');
  t.diagnostic(JSON.stringify({managerAuthRole:'gm', returnedRole:who.role,
    sent:sent.sent, ceoEscalationResolved:escalation.data.resolved === true}));
  assert.notEqual(escalation.data.resolved, true, 'a current GM cannot resolve an item reserved for the CEO');
});
