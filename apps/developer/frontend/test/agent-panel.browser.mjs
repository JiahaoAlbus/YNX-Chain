import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const fixtureURL = process.env.YNX_QA_AGENT_URL;
if (!fixtureURL) throw new Error('YNX_QA_AGENT_URL must name the isolated agent-panel fixture');
const browser = await chromium.launch({ headless: true }), checks = [], errors = [], captures = [];
let passed = false;
const catalog = { hosted: { model: 'qwen3:4b', available: true }, bringYourOwnKey: [{ id: 'openai', label: 'OpenAI', defaultModel: 'fixture-model' }] };
const projects = () => [
  { projectId: 'project-A', name: 'Wallet Alpha', revision: 5, activePath: 'owned-a.ts', storageMode: 'text-snapshot' },
  { projectId: 'project-B', name: 'Wallet Beta', revision: 7, activePath: 'owned-b.ts', storageMode: 'text-snapshot' },
  { projectId: 'native-project', name: 'Wallet Native', revision: 3, activePath: 'old-import.ts', storageMode: 'native-volume' },
];
function hold() {
  let release, seen;
  const wait = new Promise(resolve => release = resolve), ready = new Promise(resolve => seen = resolve);
  return { wait, ready, release, seen };
}
function runRecord(account, projectId, intent, sequence) {
  return { runId: `run-${sequence}`, projectId, intent, status: 'plan_review', provider: 'ynx-hosted', model: 'qwen3:4b', workspaceRevision: 5,
    plan: { summary: `private-plan-${account}-${projectId}`, steps: [{ title: 'Reviewed step', acceptance: 'Expected result' }], contextPaths: ['owned-a.ts'], createPaths: [], deletePaths: [] },
    approvedPaths: [], approvedCreatePaths: [], approvedDeletePaths: [], proposal: null, trash: [], review: null, gitOperation: null, deployment: null,
    usage: { inputTokens: 0, outputTokens: 0, durationMs: 1, reportedCalls: 0, unreportedCalls: 1, cost: { amount: null, currency: null, status: 'unreported-by-provider' } }, permissions: [] };
}
async function harness() {
  const page = await browser.newPage(), pending = [], runs = new Map(), owners = new Map();
  page.on('pageerror', error => errors.push(error.message));
  const state = { account: 'account-A', generation: 1, identityKey: 'identity-A-1', projects: projects(), projectsStatus: 200, modelStatus: 200, nextProjects: null, nextRun: null, nextMemory: null, projectReads: 0, modelReads: 0, healthReads: 0, runCalls: [], memoryCalls: [], deniedCalls: [], bindings: [] };
  await page.route('**/runtime/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (!path.startsWith('/runtime/')) { await route.continue(); return; }
    let value, status = 200, delayed;
    if (path !== '/runtime/agent/projects' && path !== '/runtime/health') {
      const identityKey = request.headers()['x-ynx-agent-identity'];
      state.bindings.push({ path, identityKey });
      if (identityKey !== state.identityKey) {
        state.deniedCalls.push({ path, identityKey });
        await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'developer_identity_changed', error: 'Wallet identity changed. Sign in again.' }) });
        return;
      }
    }
    if (path === '/runtime/agent/projects') {
      state.projectReads++; status = state.projectsStatus;
      value = status === 200 ? { account: state.account, generation: state.generation, identityKey: state.identityKey, projects: structuredClone(state.projects) } : { code: 'developer_identity_required', error: 'Wallet identity expired. Sign in again.' };
      delayed = state.nextProjects; state.nextProjects = null;
    } else if (path === '/runtime/models') {
      state.modelReads++; status = state.modelStatus;
      value = status === 200 ? catalog : { code: 'developer_identity_changed', error: 'Wallet identity changed. Sign in again.' };
    } else if (path.startsWith('/runtime/memory/')) {
      const projectId = decodeURIComponent(path.split('/').at(-1)); state.memoryCalls.push({ projectId, method: request.method() });
      value = { protocolVersion: 'ynx-code-memory/v1', projectId, chunks: state.account === 'account-A' ? 111 : 222, revision: 5, symbols: 0, relationships: 0, languages: [], results: [], facts: [] };
      delayed = state.nextMemory; state.nextMemory = null;
    } else if (path === '/runtime/agent/runs' && request.method() === 'GET') {
      value = { runs: [...runs.values()].filter(run => owners.get(run.runId) === state.account && run.projectId === url.searchParams.get('projectId')), nextCursor: null };
    } else if (path.startsWith('/runtime/agent/runs/') && request.method() === 'GET') {
      const id = path.split('/').at(-1);
      if (owners.get(id) !== state.account) { status = 404; value = { error: 'Run not found.' }; }
      else value = { run: runs.get(id) };
    } else if (path === '/runtime/agent/runs' || path.startsWith('/runtime/agent/runs/')) {
      const body = request.postDataJSON();
      state.runCalls.push({ projectId: body.projectId, action: body.action || 'create', approval: body.approval, activePath: body.activePath });
      let run;
      if (path === '/runtime/agent/runs') {
        run = runRecord(state.account, body.projectId, body.intent, runs.size + 1); runs.set(run.runId, run); owners.set(run.runId, state.account);
      } else {
        run = structuredClone(runs.get(path.split('/').at(-1)));
        if (body.action === 'approve-plan') run.status = 'context_review';
        if (body.action === 'approve-context') { run.status = 'proposal_generation'; run.approvedPaths = body.paths; }
        if (body.action === 'generate-proposal') { run.status = 'diff_review'; run.review = { approved: true, summary: 'reviewed', findings: [] }; }
        if (body.action === 'apply') { run.status = 'applied'; run.workspaceRevision++; state.projects.find(project => project.projectId === run.projectId).revision = run.workspaceRevision; }
        if (body.action === 'run-test') run.status = 'tested';
        if (body.action === 'prepare-git') run.status = 'git_review';
        if (body.action === 'approve-git') run.status = 'git_committed';
        runs.set(run.runId, run);
      }
      value = { run }; delayed = state.nextRun; state.nextRun = null;
    } else {
      if (path === '/runtime/health') state.healthReads++;
      status = 404; value = { error: `Unexpected fixture route ${path}` };
    }
    if (delayed) { pending.push(delayed); delayed.seen(); await delayed.wait; }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) }).catch(error => { if (!page.isClosed()) throw error; });
  });
  return { page, state, runs, async open() { await page.goto(fixtureURL); }, async close() { for (const item of pending) item.release(); await page.close(); captures.push({ projectReads: state.projectReads, modelReads: state.modelReads, healthReads: state.healthReads, runCalls: state.runCalls, memoryCalls: state.memoryCalls, deniedCalls: state.deniedCalls, bindings: state.bindings }); } };
}
const planButton = page => page.getByRole('button', { name: 'Approve model request once · create plan', exact: true });
async function createPlan(page) { await page.getByLabel('Software change', { exact: true }).fill('Explain the selected owned source'); await planButton(page).click(); }
async function advanceToApply(page) {
  await createPlan(page); await page.getByRole('button', { name: 'Approve plan', exact: true }).click();
  await page.getByRole('button', { name: /^Approve context once/ }).click();
  await page.getByRole('button', { name: 'Approve model request once · generate + review', exact: true }).click();
}

try {
  {
    const h = await harness();
    try {
      await h.open(); await h.page.getByText('account-A', { exact: true }).waitFor();
      await createPlan(h.page); await h.page.getByText('private-plan-account-A-project-A', { exact: true }).waitFor();
      assert.equal(h.state.runCalls[0].projectId, 'project-A');
      assert.ok(h.state.memoryCalls.every(call => !call.projectId.includes('guest')));
      await h.page.getByLabel('AI provider', { exact: true }).selectOption('openai');
      await h.page.getByLabel('Request-only API key', { exact: true }).fill('fixture-only-not-a-real-key');
      await h.page.getByLabel('Wallet project', { exact: true }).selectOption('project-B');
      await h.page.getByLabel('Software change', { exact: true }).waitFor();
      assert.equal(await h.page.getByText('private-plan-account-A-project-A', { exact: true }).count(), 0);
      assert.equal(await h.page.getByLabel('Software change', { exact: true }).inputValue(), '');
      await h.page.getByLabel('AI provider', { exact: true }).selectOption('openai');
      assert.equal(await h.page.getByLabel('Request-only API key', { exact: true }).inputValue(), '');
      await h.page.getByLabel('Wallet project', { exact: true }).selectOption('native-project');
      await h.page.getByText("This project's current files live in the native editor.", { exact: false }).waitFor();
      assert.equal(await h.page.getByLabel('Software change', { exact: true }).count(), 0);
      assert.ok(h.state.memoryCalls.every(call => call.projectId !== 'native-project'));
      checks.push('Wallet-owned catalog replaces guest props; project switch clears run/draft/key; native-volume does not read old snapshot');
    } finally { await h.close(); }
  }
  {
    const h = await harness();
    try {
      await h.open(); await h.page.getByLabel('Software change', { exact: true }).waitFor();
      const delayed = hold(); h.state.nextRun = delayed; await createPlan(h.page); await delayed.ready;
      await h.page.getByLabel('Wallet project', { exact: true }).selectOption('project-B');
      h.runs.set('run-1', { ...h.runs.get('run-1'), plan: { ...h.runs.get('run-1').plan, summary: 'Fresh saved state from explicit GET' } });
      await h.page.getByLabel('Wallet project', { exact: true }).selectOption('project-A');
      const settled = h.page.waitForResponse(response => new URL(response.url()).pathname === '/runtime/agent/runs'); delayed.release(); await settled;
      await h.page.getByRole('button', { name: 'Retry models', exact: true }).click();
      await h.page.getByText('Fresh saved state from explicit GET', { exact: true }).waitFor();
      assert.equal(await h.page.getByText('private-plan-account-A-project-A', { exact: true }).count(), 0);
      checks.push('A to B to A retires the original pending model result while permitting freshly authenticated saved-state GET');
    } finally { await h.close(); }
  }
  {
    const h = await harness();
    try {
      await h.open(); await advanceToApply(h.page);
      const delayed = hold(); h.state.nextRun = delayed;
      await h.page.getByRole('button', { name: 'Approve write once', exact: true }).click(); await delayed.ready;
      await h.page.getByLabel('Wallet project', { exact: true }).selectOption('project-B');
      await h.page.getByLabel('Software change', { exact: true }).waitFor();
      const reads = h.state.projectReads, settled = h.page.waitForResponse(response => new URL(response.url()).pathname.startsWith('/runtime/agent/runs/'));
      delayed.release(); await settled;
      await h.page.getByRole('button', { name: 'Retry models', exact: true }).click();
      assert.equal(h.state.projectReads, reads, 'retired apply must not refresh project metadata');
      assert.deepEqual(await h.page.evaluate(() => window.__agentGuestApplied), [], 'private apply must never invoke guest parent callback');
      assert.deepEqual(h.state.runCalls.map(call => call.approval), ['model-request-once', undefined, 'context-read-once', 'model-request-once', 'write-once']);
      checks.push('Existing plan/context/model/write approvals preserved; late apply does not mutate selected project or guest parent');
    } finally { await h.close(); }
  }
  {
    const h = await harness();
    try {
      const oldMemory = hold(); h.state.nextMemory = oldMemory; await h.open(); await oldMemory.ready;
      await createPlan(h.page); await h.page.getByText('private-plan-account-A-project-A', { exact: true }).waitFor();
      h.state.account = 'account-B'; h.state.generation = 2; h.state.identityKey = 'identity-B-2';
      await h.page.getByRole('button', { name: 'Refresh Wallet projects', exact: true }).click();
      await h.page.getByText('account-B', { exact: true }).waitFor();
      await h.page.getByText('PROJECT MEMORY · 222 chunks', { exact: true }).waitFor();
      const settled = h.page.waitForResponse(response => new URL(response.url()).pathname === '/runtime/memory/project-A'); oldMemory.release(); await settled;
      await h.page.getByRole('button', { name: 'Retry models', exact: true }).click();
      assert.equal(await h.page.getByText('private-plan-account-A-project-A', { exact: true }).count(), 0);
      assert.equal(await h.page.getByText('PROJECT MEMORY · 111 chunks', { exact: true }).count(), 0);
      await h.page.getByText('PROJECT MEMORY · 222 chunks', { exact: true }).waitFor();
      checks.push('Account/generation change retires old plan and delayed memory even when projectId is unchanged');
    } finally { await h.close(); }
  }
  {
    const h = await harness();
    try {
      await h.open(); await createPlan(h.page); await h.page.getByText('private-plan-account-A-project-A', { exact: true }).waitFor();
      const before = h.state.modelReads; h.state.modelStatus = 401;
      await h.page.getByRole('button', { name: 'Retry models', exact: true }).click();
      await h.page.getByRole('link', { name: 'Sign in with YNX Wallet', exact: true }).waitFor();
      assert.equal(h.state.modelReads, before + 1, '401 must not silently retry model catalog with a guest bootstrap');
      assert.equal(h.state.healthReads, 0);
      assert.equal(await h.page.getByText('private-plan-account-A-project-A', { exact: true }).count(), 0);
      assert.equal(await h.page.getByLabel('Wallet project', { exact: true }).count(), 0);
      await h.page.getByRole('link', { name: 'Sign in with YNX Wallet', exact: true }).waitFor();
      checks.push('Current 401 retires entire private panel without guest rebootstrap');
    } finally { await h.close(); }
  }
  {
    const h = await harness();
    try {
      h.state.projects = []; await h.open();
      await h.page.getByText('This Wallet has no projects yet.', { exact: false }).waitFor();
      assert.equal(await h.page.getByLabel('Software change', { exact: true }).count(), 0); assert.equal(h.state.modelReads, 0);
      checks.push('Empty Wallet catalog guides explicit existing project import and never falls back to guest AI');
    } finally { await h.close(); }
  }
  {
    const h = await harness();
    try {
      await h.open(); await advanceToApply(h.page);
      const reads = h.state.projectReads;
      await h.page.getByRole('button', { name: 'Approve write once', exact: true }).click();
      await h.page.getByRole('button', { name: 'Approve build + test once', exact: true }).click();
      assert.equal(h.state.projectReads, reads + 1, 'current apply refreshes only Wallet metadata');
      assert.deepEqual(await h.page.evaluate(() => window.__agentGuestApplied), []);
      assert.equal(h.state.runCalls.at(-1).activePath, 'owned-a.ts');
      assert.equal(h.state.runCalls.at(-1).approval, 'execute-once');
      await h.page.getByRole('button', { name: 'Prepare local Git commit review', exact: true }).click();
      await h.page.getByRole('button', { name: 'Approve local Git commit once', exact: true }).click();
      assert.equal(h.state.runCalls.at(-1).approval, 'git-local-commit-once');
      await h.page.getByText('Local commit created.', { exact: false }).waitFor();
      if (process.env.YNX_QA_AGENT_SCREENSHOT) await h.page.screenshot({ path: process.env.YNX_QA_AGENT_SCREENSHOT, fullPage: true });
      assert.ok(h.state.bindings.every(call => call.identityKey === 'identity-A-1'));
      checks.push('Current apply preserves the run across Wallet refresh and continues owned-path test and Git one-use approvals');
    } finally { await h.close(); }
  }
  {
    const h = await harness();
    try {
      await h.open(); await h.page.getByLabel('Software change', { exact: true }).fill('Draft owned by account A');
      h.state.account = 'account-B'; h.state.generation = 2; h.state.identityKey = 'identity-B-2';
      await planButton(h.page).click();
      await h.page.getByRole('link', { name: 'Sign in with YNX Wallet', exact: true }).waitFor();
      assert.deepEqual(h.state.runCalls, [], 'old displayed actor must never submit an effective run as the new cookie actor');
      assert.deepEqual(h.state.deniedCalls, [{ path: '/runtime/agent/runs', identityKey: 'identity-A-1' }]);
      checks.push('Cookie identity changes before click: request remains bound to displayed identity and 401 removes all private UI');
    } finally { await h.close(); }
  }
  {
    const h = await harness();
    try {
      await h.open(); await h.page.getByLabel('Software change', { exact: true }).fill('Retain same-identity draft');
      const delayed = hold(); h.state.nextProjects = delayed;
      await h.page.getByRole('button', { name: 'Refresh Wallet projects', exact: true }).click(); await delayed.ready;
      assert.equal(await planButton(h.page).isDisabled(), true);
      assert.equal(await h.page.getByLabel('Wallet project', { exact: true }).isDisabled(), true);
      delayed.release(); await h.page.getByRole('button', { name: 'Refresh Wallet projects', exact: true }).waitFor();
      await planButton(h.page).click(); await h.page.getByText('private-plan-account-A-project-A', { exact: true }).waitFor();
      assert.equal(h.state.runCalls.length, 1);
      checks.push('Catalog refresh immediately disables all private operations and re-enables preserved same-identity draft only after success');
    } finally { await h.close(); }
  }
  assert.deepEqual(errors, []); passed = true;
} finally {
  await browser.close();
  if (process.env.YNX_QA_AGENT_RECEIPT) await writeFile(process.env.YNX_QA_AGENT_RECEIPT, JSON.stringify({ passed, checks, errors, captures, actualChromium: true, actualReact: true, backend: 'controlled browser HTTP responses', public: false }, null, 2));
}
console.log(JSON.stringify({ passed, checks, errors }));
