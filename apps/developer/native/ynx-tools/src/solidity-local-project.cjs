const fs = require('node:fs/promises'), path = require('node:path');
const { Worker } = require('node:worker_threads');
const { digest } = require('./guards.cjs');
const validUnit = unit => typeof unit === 'string' && unit.length <= 240 && unit.endsWith('.sol') && !/[\\:\u0000-\u001f\u007f]/.test(unit) && !unit.startsWith('/') && !unit.split('/').some(part => !part || part === '.' || part === '..');
async function captureLocalSolidityProject(vscode, environment, document, compiler) {
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
  const worker = new Worker(path.join(__dirname, 'solidity-imports-worker.cjs'), { workerData: { compiler: compiler || path.join(__dirname, '..', 'compiler') }, env: { YNX_IDE_SOLC_INPUT: path.join(compiler || path.join(__dirname, '..', 'compiler'), 'node_modules/solc') }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 32 } });
  let failure, waiting;
  worker.on('message', result => { if (result.error) failure = Error(result.error); if (waiting) { const callback = waiting; waiting = undefined; callback(result.error ? failure : undefined, result); } });
  worker.on('error', error => { failure = error; if (waiting) { const callback = waiting; waiting = undefined; callback(error); } });
  worker.on('exit', () => { failure ||= Error('The local import parser stopped.'); if (waiting) { const callback = waiting; waiting = undefined; callback(failure); } });
  const timer = setTimeout(() => { failure = Error('Local import discovery exceeded its time limit.'); void worker.terminate(); }, 15000);
  const receive = () => new Promise((resolve, reject) => { if (failure) return reject(failure); waiting = (error, value) => error ? reject(error) : resolve(value); });
  const sources = {}, documents = new Map(), records = [], missing = new Set(), bindings = new Map(), queue = [{ unit: entryPath, file: entryFile }]; let total = 0;
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
      if (bindings.size >= 128) throw Error('Local Solidity sources exceed 128 files.');
      const stat = await checked(file); bindings.set(unit, file);
      if (stat.size > 262144) throw Error('Local Solidity files exceed 256 KiB before opening.');
      const uri = vscode.Uri.file(file), open = vscode.workspace.textDocuments.find(row => row.uri.scheme === 'file' && !row.isClosed && path.resolve(root, path.relative(folder.fsPath, row.uri.fsPath)) === file);
      const current = open || await vscode.workspace.openTextDocument(uri), content = current.getText();
      if (Buffer.byteLength(content) > 262144 || (total += Buffer.byteLength(content)) > 2097152) throw Error('Local Solidity sources exceed 256 KiB per file or 2 MiB total.');
      if (JSON.stringify(stat) !== JSON.stringify(await checked(file))) throw Error('A source path changed during review.');
      const row = { content, sha256: digest(content), documentVersion: current.version };
      Object.defineProperty(sources, unit, { value: row, enumerable: true }); documents.set(unit, current); records.push({ file, document: current, row, stat });
      const response = receive(); worker.postMessage({ unit, content }); const { imports } = await response;
      for (const imported of imports) {
        if (!validUnit(imported.unit) || typeof imported.file !== 'string' || /[\\:\u0000-\u001f\u007f]/.test(imported.file) || path.isAbsolute(imported.file)) throw Error('A Solidity import cannot leave its local project.');
        let target;
        if (imported.file.startsWith('./') || imported.file.startsWith('../')) target = path.resolve(path.dirname(file), imported.file);
        else {
          const candidates = [path.resolve(root, imported.unit), path.resolve(root, 'node_modules', imported.unit)], existing = [];
          for (const candidate of candidates) if (await available(candidate)) existing.push(candidate);
          if (existing.length > 1) throw Error('A Solidity package import is ambiguous.');
          if (!existing.length) continue;
          target = existing[0];
        }
        if (!await available(target)) continue;
        queue.push({ unit: imported.unit, file: target });
        if (queue.length > 4096) throw Error('Local Solidity import graph exceeds its boundary.');
      }
    }
  } finally { clearTimeout(timer); await worker.terminate(); }
  async function verify() {
    assertRuntime();
    for (const record of records) {
      const current = vscode.workspace.textDocuments.find(row => row.uri.toString() === record.document.uri.toString());
      if (current !== record.document || current.isClosed || current.version !== record.row.documentVersion || digest(current.getText()) !== record.row.sha256 || JSON.stringify(await checked(record.file)) !== JSON.stringify(record.stat)) throw Error('A Solidity source changed during review. Capture the project again.');
    }
    for (const file of missing) if (await available(file)) throw Error('A missing Solidity dependency appeared during review. Capture the project again.');
    assertRuntime();
  }
  await verify(); return { snapshot: { protocol: 'ynx-solidity-local-project/v1', projectId, entryPath, sources }, documents, verify };
}
module.exports = { captureLocalSolidityProject };
