import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
if (!process.env.YNX_QA_TOOLS_URL) throw Error('YNX_QA_TOOLS_URL must name the isolated native-tools fixture');
const browser = await chromium.launch({ headless: true }), errors = [];
let modelCalls = 0, saved, passed = false, revoked = false;
try {
  const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/runtime/native-tools/**', async route => {
    const path = new URL(route.request().url()).pathname, body = route.request().postDataJSON();
    let value, status = 200;
    if (revoked) { status = 401; value = { error: 'Wallet session changed. Sign in again.' }; }
    else if (path.endsWith('/context')) value = { csrf: 'fresh', account: 'account-A', projectId: 'project-A', expiresAt: Date.now() + 60000 };
    else if (path.endsWith('/proposals')) value = { ...body, csrf: 'approval', proposalId: 'reviewed', contextBytes: 5, model: 'qwen3:4b', wirePrompt: 'Exact reviewed model request', requestBytes: 28 };
    else if (path.endsWith('/approve')) {
      modelCalls++;
      saved = { id: '3428bfc8-c20a-4b6c-b738-a606d0d68278', status: 'completed', createdAt: '2026-10-02T15:30:00Z', updatedAt: '2026-10-02T15:30:01Z', model: 'qwen3:4b', prompt: 'Explain selected code', context: 'chosen', text: 'Saved private answer' };
      value = { text: saved.text, saved: true, conversationId: saved.id };
    } else if (path.endsWith('/delete')) { assert.equal(body.csrf, 'fresh'); saved = undefined; value = { deleted: true }; }
    else if (path.endsWith('/ai/conversations')) value = { conversations: saved ? [{ ...saved, prompt: undefined, context: undefined, text: undefined }] : [] };
    else if (path.endsWith('/' + saved?.id)) value = { conversation: saved };
    else value = {};
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  });
  await page.goto(process.env.YNX_QA_TOOLS_URL);
  await page.getByLabel('Request', { exact: true }).fill('Explain selected code');
  await page.getByLabel('Selected context', { exact: true }).fill('chosen');
  await page.getByRole('button', { name: 'Preview request' }).click();
  await page.getByText('Complete model request · 28 / 8000 bytes').click();
  await page.getByText('Exact reviewed model request', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Send reviewed context once' }).click();
  await page.getByText("Saved to this project's private AI requests.", { exact: true }).waitFor();
  await page.reload();
  await page.getByText('Saved AI requests', { exact: true }).click();
  await page.getByRole('button', { name: 'Load saved requests' }).click();
  await page.getByRole('button', { name: /Open .*completed/ }).click();
  await page.getByText('Saved private answer', { exact: true }).waitFor();
  assert.equal(modelCalls, 1, 'reloading and opening saved output must not regenerate');
  revoked = true;
  await page.getByRole('button', { name: 'Load saved requests' }).click();
  await page.getByRole('link', { name: 'Sign in with YNX Wallet' }).waitFor();
  assert.equal(await page.getByText('Saved private answer', { exact: true }).count(), 0);
  revoked = false; await page.reload();
  await page.getByText('Saved AI requests', { exact: true }).click();
  await page.getByRole('button', { name: 'Load saved requests' }).click();
  await page.getByRole('button', { name: /Open .*completed/ }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete saved request' }).click();
  await page.getByText('No saved requests yet.', { exact: true }).waitFor();
  assert.equal(saved, undefined);
  assert.equal(modelCalls, 1); assert.deepEqual(errors, []); passed = true;
} finally {
  await browser.close();
  if (process.env.YNX_QA_AI_HISTORY_RECEIPT) await writeFile(process.env.YNX_QA_AI_HISTORY_RECEIPT, JSON.stringify({ passed, modelCalls, errors, actualReact: true, actualChromium: true, backend: 'controlled routes; actual SQLite verified separately', realModel: false, public: false }, null, 2));
}
console.log(JSON.stringify({ passed, modelCalls, errors }));
