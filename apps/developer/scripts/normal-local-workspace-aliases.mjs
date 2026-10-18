// Exact local npm workspace links. Remote ZIP alias admission is unchanged.
import { lstat, readFile, readlink, readdir, realpath, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const services = ['agent-orchestrator', 'chain-service', 'collaboration-service', 'debug-service', 'environment-service',
  'extension-registry', 'gateway', 'git-service', 'language-service', 'model-router', 'project-memory',
  'runtime-profile-service', 'terminal-service', 'wallet-readiness', 'workspace-agent', 'workspace-manager'];
export const LOCAL_WORKSPACE_ALIASES = Object.freeze([
  ...services.map(name => ({ path: '@ynx-code/' + name, target: '../../services/' + name, sourceRelative: 'apps/developer/services/' + name })),
  ...['frontend', 'protocol'].map(name => ({ path: '@ynx-code/' + name, target: '../../' + name, sourceRelative: 'apps/developer/' + name })),
  { path: '.bin/tsserver', target: '../../services/language-service/node_modules/typescript/bin/tsserver', typescriptRelative: 'bin/tsserver' },
]);
const sha = b => createHash('sha256').update(b).digest('hex');
const git = (root, ...args) => execFileSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
function sourceIdentity(source) {
  if (git(source, 'status', '--porcelain', '--untracked-files=no').trim()) throw Error('Workspace alias source must have clean tracked files');
  return { head: git(source, 'rev-parse', 'HEAD').trim(), tree: git(source, 'rev-parse', 'HEAD^{tree}').trim() };
}
async function canonical(path) {
  if (resolve(path) !== path || await realpath(path) !== path) throw Error('Workspace alias target contains a linked or noncanonical parent');
}
async function runtimeInventory(root) {
  await canonical(root); const rows = [];
  async function walk(prefix = '') {
    for (const name of (await readdir(join(root, prefix))).sort()) {
      const relative = prefix ? prefix + '/' + name : name, file = join(root, relative), s = await lstat(file);
      if (s.isSymbolicLink() || !s.isFile() && !s.isDirectory()) throw Error('TypeScript role contains unsupported link or entry');
      if (s.isDirectory()) { rows.push({ path: relative, mode: s.mode & 0o777, kind: 'directory' }); await walk(relative); }
      else { const bytes = await readFile(file); rows.push({ path: relative, mode: s.mode & 0o777, kind: 'file', bytes: bytes.length, sha256: sha(bytes) }); }
    }
  }
  await walk();
  if (JSON.parse(await readFile(join(root, 'package.json'))).version !== '5.9.3' || !rows.some(r => r.path === 'bin/tsserver' && r.mode === 0o755))
    throw Error('Exact TypeScript 5.9.3 executable role required');
  return rows;
}
export async function declareLocalWorkspaceAliases(source, typescriptRoot) {
  await canonical(source); const identity = sourceIdentity(source), aliases = [];
  for (const spec of LOCAL_WORKSPACE_ALIASES) {
    if (!spec.sourceRelative) { aliases.push({ ...spec }); continue; }
    const tree = git(source, 'rev-parse', 'HEAD:' + spec.sourceRelative).trim();
    const files = git(source, 'ls-tree', '-r', '-z', 'HEAD', '--', spec.sourceRelative).split('\0').filter(Boolean).map(line => {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
      if (!match) throw Error('Workspace source contains an unsupported tracked entry');
      return { path: match[3], mode: match[1] === '100755' ? 0o755 : 0o644, gitBlob: match[2] };
    });
    if (!files.length || !files.some(row => row.path === spec.sourceRelative + '/package.json')) throw Error('Workspace target has no tracked package');
    aliases.push({ ...spec, gitTree: tree, files });
  }
  const typescript = await runtimeInventory(typescriptRoot);
  return { nativeMode: 'canonical-local', source, ...identity, aliases, typescriptRoot, typescript,
    typescriptInventorySha256: sha(JSON.stringify(typescript)), remoteZipAdmissionChanged: false };
}
export async function verifyLocalWorkspaceAliases(declaration, { source, typescriptRoot }) {
  if (source !== declaration.source || typescriptRoot !== declaration.typescriptRoot) throw Error('Workspace alias roots differ from this build');
  await canonical(source);
  if (declaration.nativeMode !== 'canonical-local' || JSON.stringify(sourceIdentity(source)) !== JSON.stringify({ head: declaration.head, tree: declaration.tree }))
    throw Error('Workspace source generation differs');
  // Re-derive the closed list from this commit and the approved TS role; caller
  // data cannot add links, replace pins, change mode, or choose an old source.
  const expected = await declareLocalWorkspaceAliases(source, declaration.typescriptRoot);
  if (JSON.stringify(declaration) !== JSON.stringify(expected)) throw Error('Workspace alias declaration differs');
  const developer = join(source, 'apps/developer'), modules = join(developer, 'node_modules');
  await canonical(modules);
  await canonical(join(modules, '@ynx-code'));
  const names = (await readdir(join(modules, '@ynx-code'))).sort();
  if (JSON.stringify(names) !== JSON.stringify(services.concat('frontend', 'protocol').sort())) throw Error('Workspace alias scope differs');
  for (const spec of declaration.aliases) {
    const link = join(modules, spec.path);
    await canonical(dirname(link));
    if (!(await lstat(link)).isSymbolicLink() || await readlink(link) !== spec.target) throw Error('Workspace alias raw target differs');
    const target = resolve(dirname(link), spec.target);
    const exact = spec.sourceRelative ? join(source, spec.sourceRelative) : join(developer, 'services/language-service/node_modules/typescript', spec.typescriptRelative);
    if (target !== exact) throw Error('Workspace alias escaped fresh candidate');
    await canonical(target);
    if (spec.sourceRelative) {
      for (const row of spec.files) {
        const file = join(source, row.path); await canonical(file);
        const s = await lstat(file), bytes = await readFile(file);
        const oid = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
        if (!s.isFile() || (s.mode & 0o777) !== row.mode || oid !== row.gitBlob) throw Error('Workspace target bytes or mode differ');
      }
    }
  }
  const actualTS = await runtimeInventory(join(developer, 'services/language-service/node_modules/typescript'));
  if (JSON.stringify(actualTS) !== JSON.stringify(declaration.typescript)) throw Error('Materialized TypeScript role differs');
  return { state: 'EXACT_LOCAL_WORKSPACE_ALIASES_VERIFIED', head: declaration.head, tree: declaration.tree, aliases: 19,
    typescriptInventorySha256: declaration.typescriptInventorySha256, oldSourceTargetsUsed: false, remoteZipAdmissionChanged: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, sourceOrDeclaration, typescriptRoot, output] = process.argv.slice(2);
  if (action === '--declare') {
    const declaration = await declareLocalWorkspaceAliases(sourceOrDeclaration, typescriptRoot);
    await writeFile(output, JSON.stringify(declaration, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ aliases: declaration.aliases.length, head: declaration.head, tree: declaration.tree, output }));
  } else if (action === '--verify') console.log(JSON.stringify(await verifyLocalWorkspaceAliases(JSON.parse(await readFile(sourceOrDeclaration)), { source: typescriptRoot, typescriptRoot: output })));
  else throw Error('Use --declare SOURCE APPROVED_TS_ROOT FRESH_OUTPUT or --verify DECLARATION SOURCE APPROVED_TS_ROOT');
}
