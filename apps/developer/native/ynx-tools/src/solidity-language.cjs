const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { existsSync } = require('node:fs');
const { captureSolidityProject } = require('./solidity-project.cjs');
const { byteOffset } = require('./solidity-diagnostics.cjs');
const { digest } = require('./guards.cjs');

function createSolidityLanguage(vscode, context, environment) {
  // Standard APIs are required; old test/host shims must not fake providers.
  if (!vscode.languages.registerDefinitionProvider || !vscode.languages.registerHoverProvider || !vscode.languages.registerReferenceProvider || !vscode.languages.registerDocumentSymbolProvider) return { dispose() {}, status: () => ({ registered: false, reason: 'language_api_unavailable' }) };
  const compiler = path.join(context.extensionPath || path.resolve(__dirname, '..'), 'compiler');
  const selector = { language: 'solidity', scheme: 'file' };
  let epoch = 0, pending, cache, disposed = false, phase = 'ready', lastError;
  const retire = () => { epoch++; cache = undefined; pending?.abort.abort(); };
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => { if (event.document.uri.fsPath.endsWith('.sol')) retire(); }), vscode.workspace.onDidCloseTextDocument(document => { if (document.uri.fsPath.endsWith('.sol')) retire(); }), vscode.workspace.onDidChangeWorkspaceFolders(retire));
  if (vscode.workspace.createFileSystemWatcher) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.sol');
    context.subscriptions.push(watcher, watcher.onDidCreate(retire), watcher.onDidChange(retire), watcher.onDidDelete(retire));
  }
  const cancelled = token => disposed || token?.isCancellationRequested;
  function analyze(snapshot, signal) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(compiler, 'compiler-worker.mjs'), { workerData: { mode: 'analysis', sourceName: snapshot.entryPath, sources: Object.fromEntries(Object.entries(snapshot.sources).map(([name, row]) => [name, { content: row.content }])) }, env: { YNX_IDE_SOLC_INPUT: path.join(compiler, 'node_modules/solc') }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 32 } });
      let finished = false;
      const finish = async (error, result) => {
        if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
        try { await worker.terminate(); } catch { error ||= Error('Solidity analysis cleanup failed.'); }
        if (error) reject(error); else resolve(result);
      };
      const abort = () => void finish(Error('The Solidity project changed.'));
      const timer = setTimeout(() => void finish(Error('Solidity analysis exceeded its time limit.')), 15000);
      signal.addEventListener('abort', abort, { once: true });
      worker.once('message', result => {
        if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024) return void finish(Error('Solidity analysis exceeds its result limit.'));
        void finish(undefined, result);
      });
      worker.once('error', () => void finish(Error('The reviewed Solidity language worker is unavailable.')));
      worker.once('exit', () => { if (!finished) void finish(Error('The Solidity language worker stopped.')); });
      if (signal.aborted) abort();
    });
  }
  async function current(document, token) {
    if (cancelled(token)) { phase = 'cancelled'; return undefined; }
    if (vscode.workspace.isTrusted === false) { phase = 'workspace_untrusted'; return undefined; }
    if (!existsSync(path.join(compiler, 'distribution.json'))) { phase = 'compiler_unavailable'; return undefined; }
    phase = 'capture';
    const capturedEpoch = epoch, reviewed = await captureSolidityProject(vscode, environment, document);
    if (capturedEpoch !== epoch || cancelled(token)) return undefined;
    const fingerprint = digest(JSON.stringify({ sessionId: reviewed.snapshot.sessionId, workspace: environment.YNX_CORE_WORKSPACE, sources: Object.entries(reviewed.snapshot.sources).sort(([a], [b]) => a.localeCompare(b)) }));
    if (cache?.fingerprint === fingerprint) { await reviewed.verify(); return cache; }
    // One worker per extension project, including all simultaneous provider
    // requests. A changed snapshot retires it; hold the slot until termination.
    if (pending && pending.fingerprint !== fingerprint) { pending.abort.abort(); await pending.promise.catch(() => {}); }
    if (capturedEpoch !== epoch || cancelled(token)) return undefined;
    if (!pending) {
      const abort = new AbortController(), task = { fingerprint, abort };
      task.promise = (async () => {
        phase = 'analyze';
        const result = await analyze(reviewed.snapshot, abort.signal);
        phase = 'verify';
        await reviewed.verify();
        if (capturedEpoch !== epoch || disposed || !result.ok || result.semantics?.protocol !== 'ynx-solidity-semantics/v1') { phase = result.ok ? 'retired' : 'source_analysis_failed'; lastError = result.code || 'compiler_diagnostics'; return undefined; }
        const documents = new Map(Object.keys(reviewed.snapshot.sources).map(name => [name, vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === path.join(environment.YNX_CORE_WORKSPACE, ...name.split('/')))]));
        if ([...documents.values()].some(doc => !doc || doc.isClosed)) return undefined;
        cache = { fingerprint, snapshot: reviewed.snapshot, semantics: result.semantics, documents, verify: reviewed.verify };
        phase = 'ready'; lastError = undefined;
        return cache;
      })().finally(() => { if (pending === task) pending = undefined; });
      pending = task;
    }
    const result = await pending.promise;
    if (capturedEpoch !== epoch || cancelled(token)) return undefined;
    await reviewed.verify(); return result;
  }
  function fileFor(state, document) { return [...state.documents].find(([, doc]) => doc === document)?.[0]; }
  function at(state, document, position) {
    const file = fileFor(state, document); if (!file) return undefined;
    const offset = Buffer.byteLength(document.getText().slice(0, document.offsetAt(position)));
    const reference = state.semantics.references.find(row => row.location.file === file && row.location.start <= offset && offset < row.location.end);
    const declaration = reference ? state.semantics.declarations.find(row => row.id === reference.targetId) : state.semantics.declarations.find(row => row.location.file === file && row.location.start <= offset && offset < row.location.end);
    return declaration ? { declaration, reference } : undefined;
  }
  function range(state, location) {
    const document = state.documents.get(location.file), content = state.snapshot.sources[location.file].content;
    return new vscode.Range(document.positionAt(byteOffset(content, location.start)), document.positionAt(byteOffset(content, location.end)));
  }
  const guarded = action => async (...args) => { try { return await action(...args); } catch (error) { lastError = error.code || error.name || 'analysis_error'; return undefined; } };
  context.subscriptions.push(vscode.languages.registerDefinitionProvider(selector, { provideDefinition: guarded(async (document, position, token) => {
    const state = await current(document, token); if (!state) return undefined;
    const symbol = at(state, document, position); if (!symbol) return undefined;
    await state.verify(); return new vscode.Location(state.documents.get(symbol.declaration.location.file).uri, range(state, symbol.declaration.location));
  }) }));
  context.subscriptions.push(vscode.languages.registerHoverProvider(selector, { provideHover: guarded(async (document, position, token) => {
    const state = await current(document, token); if (!state) return undefined;
    const symbol = at(state, document, position); if (!symbol) return undefined;
    const text = new vscode.MarkdownString(); text.appendCodeblock(symbol.reference?.type || symbol.declaration.type || `${symbol.declaration.kind}: ${symbol.declaration.name}`, 'solidity');
    await state.verify(); return new vscode.Hover(text, range(state, symbol.reference?.location || symbol.declaration.location));
  }) }));
  context.subscriptions.push(vscode.languages.registerReferenceProvider(selector, { provideReferences: guarded(async (document, position, options, token) => {
    const state = await current(document, token); if (!state) return undefined;
    const symbol = at(state, document, position); if (!symbol) return undefined;
    const locations = state.semantics.references.filter(row => row.targetId === symbol.declaration.id).map(row => row.location);
    if (options.includeDeclaration) locations.unshift(symbol.declaration.location);
    await state.verify(); return locations.map(location => new vscode.Location(state.documents.get(location.file).uri, range(state, location)));
  }) }));
  const kinds = { ContractDefinition: 'Class', FunctionDefinition: 'Function', ModifierDefinition: 'Method', VariableDeclaration: 'Variable', StructDefinition: 'Struct', EnumDefinition: 'Enum', EnumValue: 'EnumMember', EventDefinition: 'Event', ErrorDefinition: 'Function', UserDefinedValueTypeDefinition: 'TypeParameter' };
  context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(selector, { provideDocumentSymbols: guarded(async (document, token) => {
    const state = await current(document, token); if (!state) return undefined;
    const file = fileFor(state, document); await state.verify();
    return state.semantics.declarations.filter(row => row.location.file === file).map(row => new vscode.SymbolInformation(row.name, vscode.SymbolKind[kinds[row.kind]] || vscode.SymbolKind.Variable, '', new vscode.Location(document.uri, range(state, row.location))));
  }) }));
  const lifetime = { dispose() { disposed = true; retire(); }, status: () => ({ registered: true, compilerAvailable: existsSync(path.join(compiler, 'distribution.json')), active: pending ? 1 : 0, cached: !!cache, phase, ...(lastError ? { errorCode: lastError } : {}) }) }; context.subscriptions.push(lifetime); return lifetime;
}
module.exports = { createSolidityLanguage };
