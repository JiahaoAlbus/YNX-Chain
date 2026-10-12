import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runtimeTreeDigest, verifyDerivedRuntime } from '../src/derived-runtime.mjs';

test('reviewed derived entry binds exact helper, including when an otherwise self-consistent tree is supplied', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ynx-workbench-provenance-'));
  const entry = 'out/vs/code/browser/workbench/workbench.html', upstream = { sha256: 'a'.repeat(64), commit: 'official-reviewed-commit' };
  const helper = await readFile(new URL('../../../native/ynx-brand/workbench-activity.js', import.meta.url), 'utf8');
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  await mkdir(join(root, 'out/vs/code/browser/workbench'), { recursive: true });
  await writeFile(join(root, entry), `<head><script data-ynx-workbench-activity="v1">${helper}</script></head>`);
  const manifest = { upstreamArchiveSha256: upstream.sha256, upstreamCommit: upstream.commit,
    workbenchActivity: { version: 1, entry, sourceSha256: sha(helper) } };
  async function save() { manifest.treeSha256 = await runtimeTreeDigest(root); const bytes = JSON.stringify(manifest); await writeFile(join(root, 'YNX-DERIVED-RUNTIME.json'), bytes); return sha(bytes); }
  await verifyDerivedRuntime(root, await save(), upstream);
  await writeFile(join(root, entry), `<head><script data-ynx-workbench-activity="v1">${helper.replace('event.isTrusted', 'true')}</script></head>`);
  await assert.rejects(verifyDerivedRuntime(root, await save(), upstream), { code: 'core_upstream_mismatch' });
});

test('derived titlebar binds original graphic and refuses substituted brand even with updated tree/style hashes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ynx-workbench-brand-'));
  const entry = 'out/vs/code/browser/workbench/workbench.html', upstream = { sha256: 'a'.repeat(64), commit: 'official-reviewed-commit' };
  const logo = await readFile(new URL('../../../native/ynx-brand/ynx-logo.png', import.meta.url));
  const css = await readFile(new URL('../../../native/ynx-brand/workbench-brand.css', import.meta.url), 'utf8');
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const style = css.replace('__YNX_ORIGINAL_LOGO_DATA_URL__', `data:image/png;base64,${logo.toString('base64')}`);
  await mkdir(join(root, 'out/vs/code/browser/workbench'), { recursive: true });
  const manifest = { upstreamArchiveSha256: upstream.sha256, upstreamCommit: upstream.commit,
    workbenchBrand: { version: 1, entry, logoSha256: sha(logo), styleSha256: sha(style) } };
  async function save(content) {
    await writeFile(join(root, entry), `<head><style data-ynx-workbench-brand="v1">${content}</style></head>`);
    manifest.treeSha256 = await runtimeTreeDigest(root);
    const bytes = JSON.stringify(manifest); await writeFile(join(root, 'YNX-DERIVED-RUNTIME.json'), bytes); return sha(bytes);
  }
  await verifyDerivedRuntime(root, await save(style), upstream);
  const substituted = style.replace(logo.toString('base64'), Buffer.from('substituted logo').toString('base64'));
  manifest.workbenchBrand.styleSha256 = sha(substituted);
  await assert.rejects(verifyDerivedRuntime(root, await save(substituted), upstream), { code: 'core_upstream_mismatch' });
});
