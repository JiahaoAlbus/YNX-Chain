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
  const diagnostics = vscode.languages.createDiagnosticCollection && vscode.Diagnostic ? vscode.languages.createDiagnosticCollection('YNX Solidity Live') : undefined;
  let epoch = 0, pending, completionPending, renameAbort, compileAbort, diagnosticTimer, cache, disposed = false, phase = 'ready', lastError;
  function scheduleDiagnostics() {
    clearTimeout(diagnosticTimer);
    if (!diagnostics || disposed) return;
    diagnosticTimer = setTimeout(() => {
      const document = vscode.window?.activeTextEditor?.document || vscode.workspace.textDocuments.find(doc => doc.uri.fsPath.endsWith('.sol') && !doc.isClosed);
      if (document?.uri.fsPath.endsWith('.sol')) void current(document).catch(error => { lastError = error.code || 'analysis_error'; });
    }, 450);
  }
  const retire = () => { epoch++; cache = undefined; pending?.abort.abort(); renameAbort?.abort(); completionPending?.abort.abort(); diagnostics?.clear(); scheduleDiagnostics(); };
  const affectsSources = document => document.uri.fsPath.endsWith('.sol') || environment.YNX_WORKSPACE_MODE === 'local' && path.basename(document.uri.fsPath) === 'remappings.txt';
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => { if (affectsSources(event.document)) retire(); }), vscode.workspace.onDidCloseTextDocument(document => { if (affectsSources(document)) retire(); }), vscode.workspace.onDidChangeWorkspaceFolders(retire));
  if (vscode.workspace.createFileSystemWatcher) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.sol');
    context.subscriptions.push(watcher, watcher.onDidCreate(retire), watcher.onDidChange(retire), watcher.onDidDelete(retire));
    const remappings = vscode.workspace.createFileSystemWatcher('remappings.txt'), localRetire = () => { if (environment.YNX_WORKSPACE_MODE === 'local') retire(); };
    context.subscriptions.push(remappings, remappings.onDidCreate(localRetire), remappings.onDidChange(localRetire), remappings.onDidDelete(localRetire));
  }
  const cancelled = token => disposed || token?.isCancellationRequested;
  function analyze(snapshot, signal, mode = 'analysis', name) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(compiler, 'compiler-worker.mjs'), { workerData: { mode, name, sourceName: snapshot.entryPath, ...(snapshot.protocol === 'ynx-solidity-local-project/v1' ? { localRemappings: snapshot.remappings || [] } : {}), sources: Object.fromEntries(Object.entries(snapshot.sources).map(([name, row]) => [name, { content: row.content }])) }, env: { YNX_IDE_SOLC_INPUT: path.join(compiler, 'node_modules/solc') }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 32 } });
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
    const capturedEpoch = epoch, reviewed = await captureSolidityProject(vscode, environment, document, { compiler });
    if (capturedEpoch !== epoch || cancelled(token)) return undefined;
    const fingerprint = digest(JSON.stringify({ protocol: reviewed.snapshot.protocol, projectId: reviewed.snapshot.projectId, sessionId: reviewed.snapshot.sessionId, remappings: reviewed.snapshot.remappings, configurationSha256: reviewed.snapshot.configurationSha256, workspace: environment.YNX_WORKSPACE_MODE === 'local' ? environment.YNX_LOCAL_WORKSPACE : environment.YNX_CORE_WORKSPACE, sources: Object.entries(reviewed.snapshot.sources).sort(([a], [b]) => a.localeCompare(b)) }));
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
        if (capturedEpoch !== epoch || disposed) return undefined;
        const workspace = environment.YNX_WORKSPACE_MODE === 'local' ? environment.YNX_LOCAL_WORKSPACE : environment.YNX_CORE_WORKSPACE;
        const documents = reviewed.documents || new Map(Object.keys(reviewed.snapshot.sources).map(name => [name, vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === path.join(workspace, ...name.split('/')))]));
        if ([...documents.values()].some(doc => !doc || doc.isClosed)) return undefined;
        if (diagnostics) {
          const rows = new Map([...documents.values()].map(doc => [doc, []]));
          for (const row of (result.diagnostics || []).slice(0, 256)) {
            const location = row.sourceLocation, doc = documents.get(location?.file);
            if (!doc || !Number.isSafeInteger(location.start) || !Number.isSafeInteger(location.end) || location.start < 0 || location.end < location.start) continue;
            const content = reviewed.snapshot.sources[location.file].content;
            const range = new vscode.Range(doc.positionAt(byteOffset(content, location.start)), doc.positionAt(byteOffset(content, location.end)));
            const diagnostic = new vscode.Diagnostic(range, row.message, vscode.DiagnosticSeverity[row.severity === 'error' ? 'Error' : row.severity === 'warning' ? 'Warning' : 'Information']);
            diagnostic.source = 'YNX Solidity'; diagnostic.code = row.errorCode;
            rows.get(doc).push(diagnostic);
          }
          diagnostics.set([...rows].map(([doc, items]) => [doc.uri, items]));
        }
        if (!result.ok || result.semantics?.protocol !== 'ynx-solidity-semantics/v1') { phase = result.ok ? 'retired' : 'source_analysis_failed'; lastError = result.code || 'compiler_diagnostics'; return undefined; }
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
    // A caret immediately after a word still targets that word, as standard
    // editor rename/navigation does. Prefer a token containing the caret first.
    const locate = rows => rows.find(row => row.location.file === file && row.location.start <= offset && offset < row.location.end)
      || rows.find(row => row.location.file === file && row.location.end === offset);
    const reference = locate(state.semantics.references);
    const declaration = reference ? state.semantics.declarations.find(row => row.id === reference.targetId) : locate(state.semantics.declarations);
    return declaration ? { declaration, reference } : undefined;
  }
  function range(state, location) {
    const document = state.documents.get(location.file), content = state.snapshot.sources[location.file].content;
    return new vscode.Range(document.positionAt(byteOffset(content, location.start)), document.positionAt(byteOffset(content, location.end)));
  }
  const guarded = action => async (...args) => { try { return await action(...args); } catch (error) { lastError = error.code || error.name || 'analysis_error'; return undefined; } };
  if (vscode.languages.registerCompletionItemProvider) {
    const { completionSymbols } = require('./solidity-completion.cjs');
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(selector, {
      provideCompletionItems: guarded(async (document, position, token) => {
        if (cancelled(token) || vscode.workspace.isTrusted === false || !existsSync(path.join(compiler, 'distribution.json'))) return undefined;
        const capturedEpoch = epoch, reviewed = await captureSolidityProject(vscode, environment, document, { compiler });
        if (capturedEpoch !== epoch || cancelled(token)) return undefined;
        const content = document.getText(), cursor = document.offsetAt(position);
        // Do not propose source identifiers inside comments or string literals.
        const literals = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)/g;
        for (const match of content.matchAll(literals)) if (match.index < cursor && cursor < match.index + match[0].length) return undefined;
        const prefix = content.slice(0, cursor).match(/[A-Za-z_$][A-Za-z0-9_$]*$/)?.[0] || '';
        const start = cursor - prefix.length, suffix = content.slice(cursor).match(/^[A-Za-z0-9_$]*/)[0], end = cursor + suffix.length;
        const beforeMember = content.slice(0, start), receiverMatch = beforeMember.match(/([A-Za-z_$][A-Za-z0-9_$]*(?:\s*\.\s*[A-Za-z_$][A-Za-z0-9_$]*)*)\s*\.\s*$/);
        // A call/index expression needs typed expression resolution. Do not
        // mistake its trailing name for an imported namespace.
        if (receiverMatch && /\.$/.test(beforeMember.slice(0, receiverMatch.index).trimEnd())) return undefined;
        if (!receiverMatch && /\.\s*$/.test(beforeMember)) return undefined;
        const receiver = receiverMatch?.[1]?.replace(/\s/g, '');
        const sources = { ...reviewed.snapshot.sources }, file = reviewed.snapshot.entryPath;
        // Replace only the unfinished identifier in an ephemeral compiler input.
        // Parsing deliberately does not require a partially typed name to resolve.
        sources[file] = { ...sources[file], content: content.slice(0, start) + '__ynx_completion' + content.slice(end) };
        if (completionPending) { completionPending.abort.abort(); await completionPending.promise.catch(() => {}); }
        if (capturedEpoch !== epoch || cancelled(token)) return undefined;
        const abort = new AbortController(), task = { abort };
        const cancellation = token?.onCancellationRequested?.(() => abort.abort());
        task.promise = (async () => {
          let result = await analyze({ ...reviewed.snapshot, sources }, abort.signal, 'completion');
          if (!result.ok && /^\s*(?:}|$)/.test(content.slice(end))) {
            sources[file] = { ...sources[file], content: content.slice(0, start) + '__ynx_completion;' + content.slice(end) };
            result = await analyze({ ...reviewed.snapshot, sources }, abort.signal, 'completion');
          }
          await reviewed.verify();
          if (!result.ok || capturedEpoch !== epoch || cancelled(token)) return undefined;
          const symbols = completionSymbols(result.semantics, file, Buffer.byteLength(content.slice(0, start)), receiver);
          const kinds = { ContractDefinition: 'Class', FunctionDefinition: 'Function', ModifierDefinition: 'Method', VariableDeclaration: 'Variable', StructDefinition: 'Struct', EnumDefinition: 'Enum', EnumValue: 'EnumMember', EventDefinition: 'Event', ErrorDefinition: 'Function' };
          const items = symbols.filter(row => row.name.startsWith(prefix)).map(row => {
            const item = new vscode.CompletionItem(row.name, vscode.CompletionItemKind[kinds[row.kind]] || vscode.CompletionItemKind.Variable);
            item.detail = row.type || row.typeName || row.kind;
            item.range = new vscode.Range(document.positionAt(start), document.positionAt(end));
            return item;
          });
          return new vscode.CompletionList(items, true);
        })().finally(() => { cancellation?.dispose(); if (completionPending === task) completionPending = undefined; });
        completionPending = task;
        return task.promise;
      }),
    }, '.'));
  }
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
  if (vscode.languages.registerRenameProvider) {
    function renameTarget(state, document, position) {
      const symbol = at(state, document, position);
      if (!symbol) throw Error('Place the cursor on a Solidity symbol.');
      const declaration = symbol.declaration;
      const locations = [declaration.location, ...state.semantics.references.filter(row => row.targetId === declaration.id).map(row => row.location)];
      const unique = [...new Map(locations.map(location => [`${location.file}:${location.start}:${location.end}`, location])).values()];
      // Import aliases and qualified type spans need their own binding edits.
      // Never replace an entire expression or a different alias with a name.
      if (unique.some(location => Buffer.from(state.snapshot.sources[location.file].content).subarray(location.start, location.end).toString() !== declaration.name)) throw Error('This symbol has an alias or qualified reference that cannot be renamed safely yet.');
      return { declaration, locations: unique, selection: symbol.reference?.location || declaration.location };
    }
    context.subscriptions.push(vscode.languages.registerRenameProvider(selector, {
      prepareRename: async (document, position, token) => {
        const state = await current(document, token); if (!state) throw Error('Fix the current Solidity errors before renaming.');
        const target = renameTarget(state, document, position); await state.verify();
        if (cancelled(token)) return undefined;
        return { range: range(state, target.selection), placeholder: target.declaration.name };
      },
      provideRenameEdits: async (document, position, newName, token) => {
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(newName) || newName.length > 128) throw Error('Enter a valid Solidity identifier.');
        const state = await current(document, token); if (!state) throw Error('Fix the current Solidity errors before renaming.');
        const capturedEpoch = epoch, target = renameTarget(state, document, position);
        if (state.semantics.declarations.some(row => row.id !== target.declaration.id && row.name === newName && row.scopeId === target.declaration.scopeId)) throw Error('That name already exists in this Solidity scope.');
        const sources = {};
        for (const [file, row] of Object.entries(state.snapshot.sources)) {
          let content = row.content;
          for (const location of target.locations.filter(location => location.file === file).sort((a, b) => b.start - a.start)) {
            const start = byteOffset(row.content, location.start), end = byteOffset(row.content, location.end);
            content = content.slice(0, start) + newName + content.slice(end);
          }
          sources[file] = { ...row, content };
        }
        // Check the complete proposed project without writing or saving a file.
        // The editor receives one ordinary, undoable WorkspaceEdit only after
        // the compiler accepts it and all captured buffers are still current.
        if (renameAbort) throw Error('Another Solidity rename is still being checked.');
        const abort = new AbortController(); renameAbort = abort;
        const cancellation = token?.onCancellationRequested?.(() => abort.abort());
        try {
          const result = await analyze({ ...state.snapshot, sources }, abort.signal);
          await state.verify();
          if (capturedEpoch !== epoch || cancelled(token)) return undefined;
          if (!result.ok) throw Error('The proposed rename would break the Solidity project. Choose another name.');
          const moved = location => {
            let start = location.start, end = location.end;
            for (const changed of target.locations.filter(row => row.file === location.file)) {
              const delta = Buffer.byteLength(newName) - (changed.end - changed.start);
              if (changed.end <= location.start) start += delta;
              if (changed.end <= location.end) end += delta;
            }
            return { file: location.file, start, end };
          };
          const sameLocation = (a, b) => a.file === b.file && a.start === b.start && a.end === b.end;
          const mappedDeclarations = new Map(state.semantics.declarations.map(row => [row.id, result.semantics.declarations.find(next => sameLocation(next.location, moved(row.location)))?.id]));
          // A valid compilation alone can still hide an accidental change in
          // which declaration an identifier refers to (name shadowing).
          for (const reference of state.semantics.references) {
            const next = result.semantics.references.find(row => sameLocation(row.location, moved(reference.location)));
            if (!next || next.targetId !== mappedDeclarations.get(reference.targetId)) throw Error('The proposed rename would change another Solidity symbol binding. Choose another name.');
          }
          const edit = new vscode.WorkspaceEdit();
          for (const location of target.locations) edit.replace(state.documents.get(location.file).uri, range(state, location), newName);
          return edit;
        } finally { cancellation?.dispose(); if (renameAbort === abort) renameAbort = undefined; }
      },
    }));
  }
  const kinds = { ContractDefinition: 'Class', FunctionDefinition: 'Function', ModifierDefinition: 'Method', VariableDeclaration: 'Variable', StructDefinition: 'Struct', EnumDefinition: 'Enum', EnumValue: 'EnumMember', EventDefinition: 'Event', ErrorDefinition: 'Function', UserDefinedValueTypeDefinition: 'TypeParameter' };
  context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(selector, { provideDocumentSymbols: guarded(async (document, token) => {
    const state = await current(document, token); if (!state) return undefined;
    const file = fileFor(state, document); await state.verify();
    return state.semantics.declarations.filter(row => row.location.file === file).map(row => new vscode.SymbolInformation(row.name, vscode.SymbolKind[kinds[row.kind]] || vscode.SymbolKind.Variable, '', new vscode.Location(document.uri, range(state, row.location))));
  }) }));
  if (diagnostics) {
    context.subscriptions.push(diagnostics);
    if (vscode.workspace.onDidOpenTextDocument) context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => { if (document.uri.fsPath.endsWith('.sol')) scheduleDiagnostics(); }));
    if (vscode.window?.onDidChangeActiveTextEditor) context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => { if (editor?.document.uri.fsPath.endsWith('.sol')) scheduleDiagnostics(); }));
    scheduleDiagnostics();
  }
  async function compileProject() {
    const document = vscode.window.activeTextEditor?.document;
    if (!document?.uri.fsPath.endsWith('.sol')) throw Error('Open a Solidity file to compile its project.');
    if (disposed || vscode.workspace.isTrusted === false) throw Error('Trust this project before compiling its Solidity sources.');
    // A save notification can retire the language-query cache even though the
    // current text is unchanged. Builds capture and verify their own buffers,
    // so Save followed immediately by Compile does not cancel a valid build.
    const state = await captureSolidityProject(vscode, environment, document, { compiler }), file = state.snapshot.entryPath;
    if (compileAbort) throw Error('A Solidity build is already running.');
    const abort = new AbortController(); compileAbort = abort;
    const task = async (_progress, token) => {
      const cancellation = token?.onCancellationRequested?.(() => abort.abort());
      try {
        const analysis = await analyze(state.snapshot, abort.signal);
        await state.verify();
        if (!analysis.ok) throw Error('Fix the Solidity errors shown in Problems before building.');
        const contracts = analysis.semantics.declarations.filter(row => row.location.file === file && row.kind === 'ContractDefinition');
        if (!contracts.length) throw Error('The active Solidity file has no contract or library to build.');
        const chosen = contracts.length === 1 ? { label: contracts[0].name } : await vscode.window.showQuickPick(contracts.map(row => ({ label: row.name })), { placeHolder: 'Choose the contract or library to compile' });
        if (!chosen || token?.isCancellationRequested) return;
        await state.verify();
        const result = await analyze({ ...state.snapshot, entryPath: file }, abort.signal, 'compile', chosen.label);
        await state.verify();
        if (disposed || token?.isCancellationRequested) return;
        if (!result.ok) throw Error(result.error || 'Solidity compilation failed.');
        // Open a normal artifact document. No clipboard, browser round trip,
        // source execution or Wallet request is needed for local compilation.
        const artifact = await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(result, null, 2) + '\n' });
        await vscode.window.showTextDocument(artifact, { preview: false });
        return result;
      } finally { cancellation?.dispose(); if (compileAbort === abort) compileAbort = undefined; }
    };
    return vscode.window.withProgress ? vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Compiling Solidity project', cancellable: true }, task) : task();
  }
  const lifetime = { compileProject, dispose() { disposed = true; retire(); compileAbort?.abort(); clearTimeout(diagnosticTimer); }, status: () => ({ registered: true, compilerAvailable: existsSync(path.join(compiler, 'distribution.json')), active: (pending ? 1 : 0) + (completionPending ? 1 : 0) + (renameAbort ? 1 : 0) + (compileAbort ? 1 : 0), cached: !!cache, phase, ...(lastError ? { errorCode: lastError } : {}) }) }; context.subscriptions.push(lifetime); return lifetime;
}
module.exports = { createSolidityLanguage };
