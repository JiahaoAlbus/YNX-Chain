import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath, symlink, unlink, chmod, cp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { LOCAL_WORKSPACE_ALIASES, declareLocalWorkspaceAliases, verifyLocalWorkspaceAliases } from './normal-local-workspace-aliases.mjs';
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ynx-workspace-links-'))), source = join(root, 'source'), ts = join(root, 'typescript');
  await mkdir(source); await mkdir(join(ts, 'bin'), { recursive: true });
  await writeFile(join(ts, 'package.json'), '{"version":"5.9.3"}');
  await writeFile(join(ts, 'bin/tsserver'), 'PUBLIC TS wrapper'); await chmod(join(ts, 'bin/tsserver'), 0o755);
  await writeFile(join(source, '.gitignore'), 'node_modules/\n');
  for (const spec of LOCAL_WORKSPACE_ALIASES.filter(s => s.sourceRelative)) {
    await mkdir(join(source, spec.sourceRelative), { recursive: true });
    await writeFile(join(source, spec.sourceRelative, 'package.json'), JSON.stringify({ name: spec.path }));
  }
  const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: source, stdio: 'pipe' });
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=PUBLIC QA', '-c', 'user.email=public@example.invalid', 'commit', '-qm', 'controlled fixture');
  const declaration = await declareLocalWorkspaceAliases(source, ts), developer = join(source, 'apps/developer');
  for (const spec of LOCAL_WORKSPACE_ALIASES) {
    const file = join(developer, 'node_modules', spec.path); await mkdir(dirname(file), { recursive: true }); await symlink(spec.target, file);
  }
  const target = join(developer, 'services/language-service/node_modules/typescript'); await mkdir(dirname(target), { recursive: true }); await cp(ts, target, { recursive: true });
  return { root, source, ts, developer, declaration, git, verify: () => verifyLocalWorkspaceAliases(declaration, { source, typescriptRoot: ts }), close: () => rm(root, { recursive: true, force: true }) };
}
test('19 exact raw workspace aliases bind to fresh tracked source and full approved TS role', async () => {
  const f = await fixture(); try { const r = await f.verify(); assert.equal(r.aliases, 19); assert.equal(r.oldSourceTargetsUsed, false); assert.equal(r.remoteZipAdmissionChanged, false); } finally { await f.close(); }
});
test('old source, escaping raw link, extra scope and missing target are refused', async () => {
  for (const attack of ['old-source', 'escape', 'extra', 'missing']) {
    const f = await fixture(); try {
      if (attack === 'old-source') await assert.rejects(verifyLocalWorkspaceAliases(f.declaration, { source: f.source + '-old', typescriptRoot: f.ts }), /roots differ/);
      else {
        const link = join(f.developer, 'node_modules/@ynx-code/frontend');
        if (attack === 'escape') { await unlink(link); await symlink('/PUBLIC/old/frontend', link); }
        if (attack === 'extra') await symlink('../../frontend', join(f.developer, 'node_modules/@ynx-code/extra'));
        if (attack === 'missing') await rm(join(f.developer, 'frontend'), { recursive: true });
        await assert.rejects(f.verify());
      }
    } finally { await f.close(); }
  }
});
test('changed source generation, tracked byte or mode cannot reuse alias admission', async () => {
  for (const attack of ['generation', 'bytes', 'mode']) {
    const f = await fixture(); try {
      if (attack === 'generation') { await writeFile(join(f.source, 'new-generation'), 'PUBLIC'); f.git('add', '.'); f.git('-c', 'user.name=PUBLIC QA', '-c', 'user.email=public@example.invalid', 'commit', '-qm', 'next'); }
      if (attack === 'bytes') await writeFile(join(f.developer, 'frontend/package.json'), '{}');
      if (attack === 'mode') await chmod(join(f.developer, 'frontend/package.json'), 0o755);
      await assert.rejects(f.verify(), /clean|generation/);
    } finally { await f.close(); }
  }
});
test('full TS bytes and mode stay pinned and swapped declaration cannot change expected aliases', async () => {
  for (const attack of ['bytes', 'mode', 'declaration']) {
    const f = await fixture(); try {
      const file = join(f.developer, 'services/language-service/node_modules/typescript/bin/tsserver');
      if (attack === 'bytes') await writeFile(file, 'OTHER TS wrapper');
      if (attack === 'mode') await chmod(file, 0o644);
      if (attack === 'declaration') f.declaration.aliases[0].target = '../../frontend';
      await assert.rejects(f.verify(), /TypeScript|declaration/);
    } finally { await f.close(); }
  }
});
