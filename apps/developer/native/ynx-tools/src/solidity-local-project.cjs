const fs = require('node:fs/promises'), path = require('node:path');
const { Worker } = require('node:worker_threads');
const { digest } = require('./guards.cjs');
const validUnit = unit => typeof unit === 'string' && unit.length <= 240 && unit.endsWith('.sol') && !/[\\:\u0000-\u001f\u007f]/.test(unit) && !unit.startsWith('/');
async function captureLocalSolidityProject(vscode, environment, document, compiler, options = {}) {
  const workspace = environment.YNX_LOCAL_WORKSPACE, projectId = environment.YNX_LOCAL_PROJECT_ID, folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspace || !/^[a-f0-9-]{36}$/.test(projectId || '') || vscode.workspace.workspaceFolders?.length !== 1 || !document || document.uri.scheme !== 'file' || environment.YNX_CORE_SESSION_ID || environment.YNX_CORE_WORKSPACE) throw Error('Local editing cannot use a canonical project session. Open one local Solidity project.');
  const root = await fs.realpath(workspace), folderKey = folder.toString();
  if (await fs.realpath(folder.fsPath) !== root) throw Error('Open the local project root before capturing sources.');
  function assertRuntime() {
    if (environment.YNX_WORKSPACE_MODE !== 'local' || environment.YNX_LOCAL_PROJECT_ID !== projectId || environment.YNX_LOCAL_WORKSPACE !== workspace || environment.YNX_CORE_SESSION_ID || environment.YNX_CORE_WORKSPACE || vscode.workspace.workspaceFolders?.length !== 1 || vscode.workspace.workspaceFolders[0].uri.toString() !== folderKey) throw Error('The project runtime changed. Capture its Solidity sources again.');
  }
  async function checked(file) {
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw Error('A Solidity import is outside this project workspace.');
    let current = root, stat;
    for (const component of relative.split(path.sep)) {
      current = path.join(current, component); stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw Error('Local Solidity imports cannot use symbolic links.');
      if (current !== file && !stat.isDirectory()) throw Error('A Solidity import directory is invalid.');
    }
    if (!stat.isFile() || await fs.realpath(file) !== file) throw Error('A Solidity import must be a canonical regular file.');
    return { ino: stat.ino, dev: stat.dev, size: stat.size, mtimeMs: stat.mtimeMs };
  }
  const entryFile = path.resolve(root, path.relative(folder.fsPath, document.uri.fsPath)), entryPath = path.relative(root, entryFile).split(path.sep).join('/');
  if (!validUnit(entryPath)) throw Error('The local Solidity entry path is invalid.');
  const currentDocument = file => vscode.workspace.textDocuments.find(row => row.uri.scheme === 'file' && !row.isClosed && path.resolve(root, path.relative(folder.fsPath, row.uri.fsPath)) === file);
  const configurationFile = path.join(root, 'remappings.txt'); let configuration, configurationSeen = false, remappings = [];
  try {
    const stat = await checked(configurationFile);
    configurationSeen = true;
    if (stat.size > 65536) throw Error('Solidity remappings.txt exceeds 64 KiB.');
    const current = currentDocument(configurationFile) || await vscode.workspace.openTextDocument(vscode.Uri.file(configurationFile)), content = current.getText();
    if (Buffer.byteLength(content) > 65536) throw Error('Solidity remappings.txt exceeds 64 KiB.');
    const diskDigest = digest(await fs.readFile(configurationFile));
    if (JSON.stringify(stat) !== JSON.stringify(await checked(configurationFile))) throw Error('Solidity remappings.txt changed during review.');
    remappings = content.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    if (remappings.length > 128) throw Error('Solidity remappings.txt exceeds 128 mappings.');
    for (const mapping of remappings) {
      const equals = mapping.indexOf('='), pattern = mapping.slice(0, equals), target = mapping.slice(equals + 1), colon = pattern.indexOf(':'), prefix = colon < 0 ? pattern : pattern.slice(colon + 1);
      if (equals <= 0 || mapping.length > 1024 || !prefix || /[\\\u0000-\u001f\u007f]/.test(mapping) || pattern.indexOf(':', colon + 1) >= 0 || target.includes(':') || path.isAbsolute(target)) throw Error('Use bounded local context:prefix=target mappings in remappings.txt.');
      const relative = path.relative(root, path.resolve(root, target));
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw Error('A Solidity remapping target is outside this project workspace.');
    }
    configuration = { document: current, stat, sha256: digest(content), version: current.version, diskDigest };
  } catch (error) { if (error.code !== 'ENOENT') throw error; if (configurationSeen) throw Error('Solidity remappings configuration disappeared during review.'); }
  // lib/ can contain project-owned callers. Only package-manager dependencies
  // and VCS internals are excluded; a large vendored lib fails explicitly.
  const excluded = new Set(['node_modules', '.git']);
  async function inventory() {
    const files = []; let entries = 0;
    async function visit(directory, depth) {
      if (depth > 32) throw Error('Project reference inventory exceeds 32 directory levels. Rename cannot be complete.');
      const directoryStat = await fs.lstat(directory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || await fs.realpath(directory) !== directory) throw Error('Project reference inventory cannot use symbolic links.');
      for await (const item of await fs.opendir(directory)) {
        if (++entries > 4096) throw Error('Project reference inventory exceeds 4096 entries. Rename cannot be complete.');
        if (excluded.has(item.name)) continue;
        const file = path.join(directory, item.name);
        if (item.isSymbolicLink()) throw Error('Project reference inventory cannot use symbolic links.');
        if (item.isDirectory()) await visit(file, depth + 1);
        else if (item.name.endsWith('.sol')) {
          await checked(file); files.push(file);
          if (files.length > 1024) throw Error('Project reference inventory exceeds 1024 files. Rename cannot be complete.');
        }
      }
    }
    await visit(root, 0); return files.sort();
  }
  const projectFiles = options.projectReferences ? await inventory() : undefined;
  const worker = new Worker(path.join(__dirname, 'solidity-imports-worker.cjs'), { workerData: { compiler: compiler || path.join(__dirname, '..', 'compiler') }, env: { YNX_IDE_SOLC_INPUT: path.join(compiler || path.join(__dirname, '..', 'compiler'), 'node_modules/solc') }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 32 } });
  let failure, waiting;
  worker.on('message', result => { if (result.error) failure = Error(result.error); if (waiting) { const callback = waiting; waiting = undefined; callback(result.error ? failure : undefined, result); } });
  worker.on('error', error => { failure = error; if (waiting) { const callback = waiting; waiting = undefined; callback(error); } });
  worker.on('exit', () => { failure ||= Error('The local import parser stopped.'); if (waiting) { const callback = waiting; waiting = undefined; callback(failure); } });
  const timer = setTimeout(() => { failure = Error('Local import discovery exceeded its time limit.'); void worker.terminate(); }, 15000);
  const receive = () => new Promise((resolve, reject) => { if (failure) return reject(failure); waiting = (error, value) => error ? reject(error) : resolve(value); });
  const sources = {}, documents = new Map(), records = [], missing = new Set(), bindings = new Map(), queue = [{ unit: entryPath, file: entryFile }, ...(projectFiles || []).map(file => ({ unit: path.relative(root, file).split(path.sep).join('/'), file }))], edges = new Map(); let total = 0;
  async function available(file) {
    try { return await checked(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; missing.add(file); if (missing.size > 4096) throw Error('Local Solidity missing import graph exceeds its boundary.'); return undefined; }
  }
  try {
    await receive();
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const { unit, file } = queue[cursor]; assertRuntime();
      if (!validUnit(unit)) throw Error('A compiler import path is invalid.');
      if (bindings.has(unit)) { if (bindings.get(unit) !== file) throw Error('A Solidity source unit has ambiguous file bindings.'); continue; }
      if (bindings.size >= (projectFiles ? 1024 : 128)) throw Error(projectFiles ? 'Project reference discovery exceeds 1024 source units. Rename cannot be complete.' : 'Local Solidity sources exceed 128 files.');
      const stat = await checked(file); bindings.set(unit, file);
      if (stat.size > 262144) throw Error('Local Solidity files exceed 256 KiB before opening.');
      const uri = vscode.Uri.file(file), open = currentDocument(file);
      const current = open || await vscode.workspace.openTextDocument(uri), content = current.getText();
      if (Buffer.byteLength(content) > 262144 || (total += Buffer.byteLength(content)) > (projectFiles ? 16777216 : 2097152)) throw Error(projectFiles ? 'Project reference discovery exceeds 256 KiB per file or 16 MiB total. Rename cannot be complete.' : 'Local Solidity sources exceed 256 KiB per file or 2 MiB total.');
      if (JSON.stringify(stat) !== JSON.stringify(await checked(file))) throw Error('A source path changed during review.');
      const row = { content, sha256: digest(content), documentVersion: current.version };
      Object.defineProperty(sources, unit, { value: row, enumerable: true, configurable: true }); documents.set(unit, current); records.push({ file, document: current, row, stat });
      const response = receive(); worker.postMessage({ unit, content, remappings }); const { imports } = await response;
      for (const imported of imports) {
        if (!validUnit(imported.unit) || typeof imported.file !== 'string' || /[\\:\u0000-\u001f\u007f]/.test(imported.file) || path.isAbsolute(imported.file)) throw Error('A Solidity import cannot leave its local project.');
        let target;
        if (!imported.remapped && (imported.file.startsWith('./') || imported.file.startsWith('../'))) target = path.resolve(path.dirname(file), imported.file);
        else {
          const candidates = imported.remapped ? [path.resolve(root, imported.unit)] : [path.resolve(root, imported.unit), path.resolve(root, 'node_modules', imported.unit)], existing = [];
          for (const candidate of candidates) if (await available(candidate)) existing.push(candidate);
          if (existing.length > 1) throw Error('A Solidity package import is ambiguous.');
          if (!existing.length) continue;
          target = existing[0];
        }
        if (!await available(target)) continue;
        if (!edges.has(file)) edges.set(file, new Set()); if (!edges.has(target)) edges.set(target, new Set());
        edges.get(file).add(target); edges.get(target).add(file);
        queue.push({ unit: imported.unit, file: target });
        if (queue.length > 4096) throw Error('Local Solidity import graph exceeds its boundary.');
      }
    }
  } finally { clearTimeout(timer); await worker.terminate(); }
  async function verify() {
    assertRuntime();
    if (projectFiles && JSON.stringify(await inventory()) !== JSON.stringify(projectFiles)) throw Error('Project source inventory changed. Capture references again.');
    for (const record of records) {
      const current = vscode.workspace.textDocuments.find(row => row.uri.toString() === record.document.uri.toString());
      if (current !== record.document || current.isClosed || current.version !== record.row.documentVersion || digest(current.getText()) !== record.row.sha256 || JSON.stringify(await checked(record.file)) !== JSON.stringify(record.stat)) throw Error('A Solidity source changed during review. Capture the project again.');
    }
    for (const file of missing) if (await available(file)) throw Error('A missing Solidity dependency appeared during review. Capture the project again.');
    let configurationStat;
    try { configurationStat = await checked(configurationFile); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!!configurationStat !== !!configuration) throw Error('Solidity remappings configuration appeared or disappeared during review. Capture the project again.');
    if (configuration && (JSON.stringify(configurationStat) !== JSON.stringify(configuration.stat) || digest(await fs.readFile(configurationFile)) !== configuration.diskDigest || JSON.stringify(await checked(configurationFile)) !== JSON.stringify(configuration.stat))) throw Error('Solidity remappings configuration changed during review. Capture the project again.');
    if (configuration && (currentDocument(configurationFile) !== configuration.document || configuration.document.isClosed || configuration.document.version !== configuration.version || digest(configuration.document.getText()) !== configuration.sha256)) throw Error('Solidity remappings configuration changed during review. Capture the project again.');
    if (projectFiles && JSON.stringify(await inventory()) !== JSON.stringify(projectFiles)) throw Error('Project source inventory changed. Capture references again.');
    for (const record of records) {
      const current = vscode.workspace.textDocuments.find(row => row.uri.toString() === record.document.uri.toString());
      if (current !== record.document || current.isClosed || current.version !== record.row.documentVersion || digest(current.getText()) !== record.row.sha256) throw Error('A Solidity source changed during review. Capture the project again.');
    }
    assertRuntime();
  }
  if (projectFiles) {
    const related = new Set([entryFile]), pending = [entryFile];
    for (let i = 0; i < pending.length; i++) for (const file of edges.get(pending[i]) || []) if (!related.has(file)) { related.add(file); pending.push(file); }
    for (const [unit, file] of bindings) if (!related.has(file)) { delete sources[unit]; documents.delete(unit); }
    if (Object.keys(sources).length > 128 || Object.values(sources).reduce((n, row) => n + Buffer.byteLength(row.content), 0) > 2097152) throw Error('Related Solidity project exceeds 128 files or 2 MiB. Rename cannot be complete.');
  }
  await verify(); return { referenceFingerprint: projectFiles ? digest(JSON.stringify(records.map(record => [record.file, record.row.sha256, record.row.documentVersion, record.stat]))) : undefined, snapshot: { protocol: 'ynx-solidity-local-project/v1', projectId, entryPath, sources, remappings, configurationSha256: configuration ? digest(JSON.stringify({ sha256: configuration.sha256, diskDigest: configuration.diskDigest, version: configuration.version, stat: configuration.stat })) : null }, documents, verify };
}
module.exports = { captureLocalSolidityProject };
