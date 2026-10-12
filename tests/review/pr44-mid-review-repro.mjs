// Codex review of PR #44, head 1979f7f. Synthetic data only; no external requests.
// These assertions express the expected behavior and fail on the reviewed head.
// Reuse only the setup preceding the PR's tests, with the real UI, handler and SQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const fixtureUrl = new URL('../mid-review-ui.test.mjs', import.meta.url);
let fixture = fs.readFileSync(fixtureUrl, 'utf8').split('\ntest(')[0];
fixture = fixture
  .replace("'../supabase/functions/mid-review/handler.mjs'", JSON.stringify(new URL('../supabase/functions/mid-review/handler.mjs', fixtureUrl).href))
  .replace("'./runtime/node_modules/@electric-sql/pglite/dist/index.js'", JSON.stringify(new URL('./runtime/node_modules/@electric-sql/pglite/dist/index.js', fixtureUrl).href))
  .replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href));
const { server, app, U, html } = await import('data:text/javascript;base64,' + Buffer.from(fixture + '\nexport { server, app, U, html };').toString('base64'));
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
  c.run("mrSetVal('consult','none'); mrSetVal('focus.0.status','ok'); mrSetVal('focus.1.status','ok')");
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
  c.run("mrSetVal('focus.0.note','R1 new input in the other store')");
  const nextEditor = c.M().ed;
  assert.equal(nextEditor.state, 'dirty');
  release(); await submitting;
  const stored = await S.api('gm', {action:'get',env:'demo',ym:'2026-10',store_id:'D1'});
  t.diagnostic(JSON.stringify({submittedStore:'D6', currentStore:c.M().view?.id,
    editorRetained:c.M().ed === nextEditor, mode:c.M().view?.mode,
    newTextSaved:stored.review.body.focus[0].note === 'R1 new input in the other store'}));
  assert.equal(c.M().ed === nextEditor, true, 'the D1 draft must survive the delayed D6 response');
});

test('R2: sending must check the draft set and versions shown on this tab', async t => {
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
  c.run("mrSetVal('focus.0.note','R3 before refresh')");
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

test('R4: a CEO changed to GM in manager_auth must not retain CEO-only decisions', async t => {
  const S = await server(); t.after(() => S.pg.close());
  await S.pg.exec('reset role');
  await S.pg.query('update manager_auth set role=$1 where user_id=$2', ['gm', U.ceo]);
  await S.pg.exec('set role service_role');
  const who = await S.api('ceo', {action:'whoami'});
  const payload = {env:'demo',ym:'2026-10',store_id:'D3',expect_no:1};
  await S.api('ceo', {...payload,action:'reply_save',target:'issue:i2',expect_version:null,
    decision:'no_action',data:{reason:'R4 decision after role downgrade'}});
  const sent = await S.api('ceo', {...payload,action:'reply_send'});
  const record = await S.api('ceo', {...payload,action:'get'});
  const escalation = record.replies.find(x => x.target === 'issue:i2' && x.decision === 'escalate');
  t.diagnostic(JSON.stringify({managerAuthRole:'gm', returnedRole:who.role,
    sent:sent.sent, ceoEscalationResolved:escalation.data.resolved === true}));
  assert.notEqual(escalation.data.resolved, true, 'a current GM cannot resolve an item reserved for the CEO');
});
