import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const fixtureURL = process.env.YNX_QA_AGENT_URL;
if (!fixtureURL) throw new Error('YNX_QA_AGENT_URL is required');
const browser = await chromium.launch({ headless: true }), checks = [], errors = [];
let passed = false;
const now = '2026-10-03T08:00:00.000Z';
const operation = (status, action = 'generate-proposal', errorCode) => ({ status, action, startedAt: now, updatedAt: now, ...(errorCode ? { errorCode } : {}) });
function record(id = 'saved-1', status = 'plan_review') {
  return { runId: id, projectId: 'project', intent: `Saved intent ${id}`, status, provider: 'ynx-hosted', model: 'saved-model', workspaceRevision: 5, createdAt: now, updatedAt: now,
    operation: operation('finished', 'create'), plan: { summary: `Saved plan ${id}`, steps: [], contextPaths: ['current.ts'], createPaths: [], deletePaths: [] },
    approvedPaths: [], approvedCreatePaths: [], approvedDeletePaths: [], proposal: null, review: null, trash: [], deployment: null, gitOperation: null,
    usage: { reportedCalls: 1, unreportedCalls: 0, inputTokens: 12, outputTokens: 3, durationMs: 1, cost: { amount: null, currency: null, status: 'unreported-by-provider' } },
    permissions: [{ id: 'model-network', level: 'network', status: 'used', approval: 'model-request-once', uses: 1 }],
    events: [{ sequence: 1, event_type: 'planner.completed', payload: {}, created_at: now }] };
}
const answer = (route, value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
async function harness(initial = [record()]) {
  const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  let detailSeen; const detailReady = new Promise(resolve => { detailSeen = resolve; });
  const state = { runs: new Map(initial.map(value => [value.runId, value])), account: 'account-A', key: 'identity-A', generation: 1, revision: 5, activePath: 'current.ts', posts: [], gets: [], heldDetail: null, holdDetail: false, failNextPost: false, pageSize: 50 };
  await page.route('**/runtime/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (!path.startsWith('/runtime/')) return route.continue();
    if (request.method() === 'GET') state.gets.push(path + url.search);
    if (path === '/runtime/agent/projects') return answer(route, { account: state.account, generation: state.generation, identityKey: state.key, projects: [{ projectId: 'project', name: 'Owned project', revision: state.revision, activePath: state.activePath, storageMode: 'text-snapshot' }] });
    if (request.headers()['x-ynx-agent-identity'] !== state.key) return answer(route, { error: 'Session changed', code: 'core_consumer_identity_changed' }, 401);
    if (path === '/runtime/models') return answer(route, { hosted: { available: true, model: 'saved-model' }, bringYourOwnKey: [{ id: 'openai', label: 'OpenAI' }] });
    if (path.startsWith('/runtime/memory/')) return answer(route, { chunks: 0, revision: null, symbols: 0, relationships: 0, languages: [] });
    if (path === '/runtime/agent/runs' && request.method() === 'GET') {
      const cursor = Number((url.searchParams.get('cursor') || 'fixture-page-0').replace('fixture-page-', '')), rows = [...state.runs.values()].slice(cursor, cursor + state.pageSize);
      if (cursor > 0) rows.unshift([...state.runs.values()][0]);
      return answer(route, { runs: rows.map(value => ({ ...value, permissions: [], events: [], usage: { ...value.usage, reportedCalls: 0 } })), nextCursor: cursor + state.pageSize < state.runs.size ? `fixture-page-${cursor + state.pageSize}` : null });
    }
    if (path.startsWith('/runtime/agent/runs/') && request.method() === 'GET') {
      const value = state.runs.get(path.split('/').at(-1));
      if (state.holdDetail) { state.holdDetail = false; state.heldDetail = { route, value: structuredClone(value) }; detailSeen(); return; }
      return answer(route, value ? { run: value } : { error: 'Run not found' }, value ? 200 : 404);
    }
    if (path.startsWith('/runtime/agent/runs') && request.method() === 'POST') {
      const body = request.postDataJSON(); state.posts.push(body);
      const id = path.split('/')[4]; let value = id ? structuredClone(state.runs.get(id)) : record(`new-${state.posts.length}`);
      if (value.operation?.status === 'running') return answer(route, { error: 'This run is already executing an operation.', code: 'agent_run_busy' }, 409);
      if (body.action === 'apply') { value.status = 'applied'; value.workspaceRevision = ++state.revision; state.activePath = 'after-write.ts'; }
      if (body.action === 'run-test') value.status = 'tested';
      if (body.action === 'approve-plan') value.status = 'context_review';
      if (body.action === 'reconcile-git') {
        value.status = 'tested'; value.gitOperation = { ...value.gitOperation, executed: false, recovery: { state: 'pending-changes', head: 'verified-current-head', branch: 'main', pendingChanges: [{ path: 'current.ts', status: ' M' }], checkedAt: now, previousOutcome: 'unknown' } };
      }
      value.operation = operation('finished', body.action || 'create'); state.runs.set(value.runId, value);
      if (state.failNextPost) { state.failNextPost = false; return route.abort('failed'); }
      return answer(route, { run: value });
    }
    return answer(route, { error: `Unexpected route ${path}` }, 404);
  });
  return { page, state, async waitForHeldDetail() { let timeout; try { await Promise.race([detailReady, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Expected held detail GET did not arrive')), 10000); })]); } finally { clearTimeout(timeout); } }, async open() { await page.goto(fixtureURL); }, async close() { if (state.heldDetail) await answer(state.heldDetail.route, { run: state.heldDetail.value }).catch(() => {}); await page.close(); } };
}
try {
  {
    const h = await harness([{ ...record(), provider: 'openai' }]);
    try {
      await h.open(); await h.page.getByText('Saved plan saved-1', { exact: true }).waitFor();
      await h.page.getByText('12 input + 3 output tokens', { exact: false }).waitFor();
      await h.page.getByText('PERMISSIONS · 1 used', { exact: true }).waitFor();
      await h.page.getByLabel('Request-only API key', { exact: true }).fill('fixture-key-not-a-real-secret');
      await h.page.reload(); await h.page.getByText('Saved plan saved-1', { exact: true }).waitFor();
      assert.equal(h.state.posts.length, 0);
      assert.ok(h.state.gets.filter(path => path === '/runtime/agent/runs/saved-1').length >= 2);
      assert.equal(await h.page.getByLabel('AI model', { exact: true }).inputValue(), 'saved-model');
      assert.equal(await h.page.getByLabel('Request-only API key', { exact: true }).inputValue(), '');
      if (process.env.YNX_QA_AGENT_RECOVERY_SCREENSHOT) await h.page.screenshot({ path: process.env.YNX_QA_AGENT_RECOVERY_SCREENSHOT, fullPage: true });
      checks.push('Document reopen restores the saved run using authenticated detail, including real permissions and usage; no POST or model replay');
    } finally { await h.close(); }
  }
  {
    const value = record('pending', 'planning'); value.plan = null; value.operation = operation('running', 'create');
    const h = await harness([value]);
    try {
      await h.open(); await h.page.getByText('create is still running on the server.', { exact: false }).waitFor();
      assert.equal(await h.page.getByRole('button', { name: 'New request from this intent', exact: true }).isDisabled(), true);
      assert.equal(await h.page.getByRole('button', { name: 'Approve plan', exact: true }).count(), 0);
      h.state.runs.set('pending', { ...record('pending'), operation: operation('finished', 'create') });
      await h.page.getByRole('button', { name: 'Refresh saved state', exact: true }).click();
      await h.page.getByText('Saved plan pending', { exact: true }).waitFor();
      assert.equal(h.state.posts.length, 0);
      checks.push('Persisted planning/running has no approval actions; explicit GET refresh observes completion without repeating Planner');
    } finally { await h.close(); }
  }
  {
    const value = record('interrupted', 'planning'); value.plan = null; value.operation = operation('interrupted', 'create', 'agent_operation_interrupted');
    const h = await harness([value]);
    try {
      await h.open(); await h.page.getByText('Start a new request from this intent', { exact: false }).waitFor();
      await h.page.getByRole('button', { name: 'New request from this intent', exact: true }).click();
      assert.equal(await h.page.getByLabel('Software change', { exact: true }).inputValue(), value.intent);
      assert.equal(h.state.posts.length, 0);
      await h.page.getByRole('button', { name: 'Approve model request once · create plan', exact: true }).click();
      await h.page.getByText('Saved plan new-1', { exact: true }).waitFor();
      assert.equal(h.state.posts.length, 1); assert.equal(h.state.posts[0].approval, 'model-request-once');
      checks.push('Restart interruption restores the original intent but sends another Planner request only after a new explicit approval');
    } finally { await h.close(); }
  }
  {
    const h = await harness([]);
    try {
      await h.open(); await h.page.getByLabel('Software change', { exact: true }).fill('Create a saved plan'); h.state.failNextPost = true;
      await h.page.getByRole('button', { name: 'Approve model request once · create plan', exact: true }).click();
      await h.page.getByText('The request did not return a confirmed result.', { exact: false }).waitFor();
      assert.equal(await h.page.getByRole('button', { name: 'Approve model request once · create plan', exact: true }).isDisabled(), true);
      await h.page.getByLabel('Saved runs', { exact: true }).selectOption('new-1');
      await h.page.getByText('Saved plan new-1', { exact: true }).waitFor();
      assert.equal(h.state.posts.length, 1);
      checks.push('Lost create response offers the persisted run through a fresh list/detail read and requires a separate new-request choice before any retry');
    } finally { await h.close(); }
  }
  {
    const value = record('written', 'diff_review'); value.review = { approved: true, summary: 'Reviewed', findings: [] };
    const h = await harness([value]);
    try {
      await h.open(); await h.page.getByText('Saved plan written', { exact: true }).waitFor(); h.state.failNextPost = true;
      await h.page.getByRole('button', { name: 'Approve write once', exact: true }).click();
      await h.page.getByRole('button', { name: 'Approve build + test once', exact: true }).waitFor();
      assert.equal(h.state.posts.length, 1); assert.equal(h.state.posts[0].action, 'apply');
      await h.page.getByRole('button', { name: 'Approve build + test once', exact: true }).click();
      await h.page.getByText('Tester passed with sandbox evidence.', { exact: true }).waitFor();
      assert.equal(h.state.posts[1].activePath, 'after-write.ts');
      assert.equal(h.state.posts[1].approval, 'execute-once');
      checks.push('Lost apply response reads back the persisted write and refreshed project path; only the separately approved test follows');
    } finally { await h.close(); }
  }
  {
    const value = record('coder', 'proposal_generation'); value.operation = operation('running');
    const h = await harness([value]);
    try {
      await h.open(); await h.page.getByText('generate-proposal is still running', { exact: false }).waitFor();
      assert.equal(await h.page.getByRole('button', { name: 'Approve model request once · generate + review', exact: true }).isDisabled(), true);
      value.operation = operation('interrupted', 'generate-proposal', 'service_maintenance'); h.state.runs.set(value.runId, value);
      await h.page.getByRole('button', { name: 'Refresh saved state', exact: true }).click();
      await h.page.getByText('service_maintenance', { exact: false }).waitFor();
      assert.equal(await h.page.getByRole('button', { name: 'Approve model request once · generate + review', exact: true }).isEnabled(), true);
      assert.equal(h.state.posts.length, 0);
      checks.push('Running Coder blocks the old action; interrupted recovery exposes its saved stage and requires a fresh explicit approval');
    } finally { await h.close(); }
  }
  {
    const value = record('concurrent', 'proposal_generation'), h = await harness([value]);
    try {
      await h.open(); await h.page.getByText('Saved plan concurrent', { exact: true }).waitFor();
      value.operation = operation('running'); h.state.runs.set(value.runId, value);
      await h.page.getByRole('button', { name: 'Approve model request once · generate + review', exact: true }).click();
      await h.page.getByText('generate-proposal is still running', { exact: false }).waitFor();
      assert.equal(h.state.posts.length, 1);
      assert.equal(await h.page.getByRole('button', { name: 'Approve model request once · generate + review', exact: true }).isDisabled(), true);
      checks.push('A stale action rejected as agent_run_busy reads current running detail and never retries its POST');
    } finally { await h.close(); }
  }
  {
    const value = record('git', 'git_review'); value.operation = operation('interrupted', 'approve-git', 'agent_operation_interrupted');
    value.operation.recoveryEvidence = { recheckRequired: true };
    value.gitOperation = { branch: 'main', head: 'old-head', message: 'Reviewed commit', workspaceRevision: 5, previewDigest: 'reviewed-preview', files: [], boundary: 'local-only-no-network-no-credentials-no-hooks-no-signing', executed: false };
    const h = await harness([value]);
    try {
      await h.open(); await h.page.getByRole('button', { name: 'Check repository and recover', exact: true }).waitFor();
      assert.equal(h.state.posts.length, 0);
      assert.equal(await h.page.getByRole('button', { name: 'Approve local Git commit once', exact: true }).count(), 0);
      await h.page.getByRole('button', { name: 'Check repository and recover', exact: true }).click();
      await h.page.getByText('Current HEAD: verified-current-head', { exact: true }).waitFor();
      await h.page.getByText('1 pending changes.', { exact: false }).waitFor();
      await h.page.getByText("The prior operation's outcome is unknown.", { exact: false }).waitFor();
      assert.equal(h.state.posts.length, 1); assert.equal(h.state.posts[0].action, 'reconcile-git');
      assert.equal(h.state.posts[0].approval, undefined);
      assert.equal(await h.page.getByRole('button', { name: 'Prepare local Git commit review', exact: true }).isEnabled(), true);
      assert.equal(await h.page.getByText('Local commit created.', { exact: false }).count(), 0);
      if (process.env.YNX_QA_AGENT_GIT_RECOVERY_SCREENSHOT) await h.page.screenshot({ path: process.env.YNX_QA_AGENT_GIT_RECOVERY_SCREENSHOT, fullPage: true });
      checks.push('Interrupted Git requires an explicit read-only reconciliation and shows observed HEAD/pending paths without replaying commit or asserting its prior outcome');
    } finally { await h.close(); }
  }
  {
    const value = record('git-preflight', 'git_review'); value.operation = operation('interrupted', 'approve-git', 'git_commit_approval_required');
    value.gitOperation = { branch: 'main', head: 'old-head', message: 'Reviewed commit', workspaceRevision: 5, previewDigest: 'reviewed-preview', files: [], boundary: 'local-only-no-network-no-credentials-no-hooks-no-signing', executed: false };
    const h = await harness([value]);
    try {
      await h.open();
      assert.equal(await h.page.getByRole('button', { name: 'Check repository and recover', exact: true }).count(), 0);
      await h.page.getByRole('button', { name: 'Approve local Git commit once', exact: true }).click();
      await h.page.waitForFunction(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Approve local Git commit once')?.disabled === false);
      assert.equal(h.state.posts.length, 1); assert.equal(h.state.posts[0].action, 'approve-git');
      checks.push('A rejected preflight without a dispatched commit remains explicitly approvable and does not falsely require repository recovery');
    } finally { await h.close(); }
  }
  {
    const h = await harness([record('restored-source', 'restored')]);
    try {
      await h.open(); await h.page.getByRole('button', { name: 'Approve build + test once', exact: true }).click();
      await h.page.getByText('Tester passed with sandbox evidence.', { exact: true }).waitFor();
      assert.equal(h.state.posts.length, 1); assert.equal(h.state.posts[0].action, 'run-test');
      checks.push('Restored source requires a new explicit test and can continue the saved workflow without another model request');
    } finally { await h.close(); }
  }
  {
    const h = await harness([record('first'), record('second'), record('third')]); h.state.pageSize = 1;
    try {
      await h.open(); await h.page.getByText('Saved plan first', { exact: true }).waitFor();
      await h.page.getByRole('button', { name: 'Load more saved runs', exact: true }).click();
      await h.page.getByLabel('Saved runs', { exact: true }).selectOption('second');
      await h.page.getByText('Saved plan second', { exact: true }).waitFor();
      assert.equal(h.state.posts.length, 0);
      assert.ok(h.state.gets.some(path => path.includes('cursor=fixture-page-1')));
      assert.equal(await h.page.getByLabel('Saved runs', { exact: true }).locator('option[value="first"]').count(), 1);
      assert.ok(h.state.gets.includes('/runtime/agent/runs/second'));
      checks.push('Paged saved runs can be selected and each selection reads full detail rather than using the list summary');
    } finally { await h.close(); }
  }
  {
    const h = await harness();
    try {
      h.state.holdDetail = true; await h.open();
      await h.waitForHeldDetail();
      await h.page.getByText('Reading saved state…', { exact: true }).waitFor();
      h.state.account = 'account-B'; h.state.key = 'identity-B'; h.state.generation = 2; h.state.runs.clear();
      await h.page.getByRole('button', { name: 'Refresh Wallet projects', exact: true }).click();
      await h.page.getByText('account-B', { exact: true }).waitFor();
      await h.page.getByLabel('Software change', { exact: true }).waitFor();
      assert.ok(h.state.heldDetail);
      const held = h.state.heldDetail; h.state.heldDetail = null; await answer(held.route, { run: held.value });
      await h.page.getByRole('button', { name: 'Refresh saved state', exact: true }).click();
      await h.page.getByLabel('Software change', { exact: true }).waitFor();
      assert.equal(await h.page.getByText('Saved plan saved-1', { exact: true }).count(), 0);
      assert.equal(h.state.posts.length, 0);
      checks.push('A delayed saved-run detail cannot enter the new account after catalog identity changes');
    } finally { await h.close(); }
  }
  assert.deepEqual(errors, []); passed = true;
} finally {
  await browser.close();
  if (process.env.YNX_QA_AGENT_RECOVERY_RECEIPT) await writeFile(process.env.YNX_QA_AGENT_RECOVERY_RECEIPT, JSON.stringify({ passed, checks, errors, actualChromium: true, actualReact: true, backend: 'controlled browser HTTP responses', public: false }, null, 2));
}
console.log(JSON.stringify({ passed, checks, errors }));
