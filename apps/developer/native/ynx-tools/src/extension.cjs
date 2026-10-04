const vscode = require('vscode');
const { capture, validateChanges, assertWorkspacePath, assertWorkspaceDirectory } = require('./guards.cjs');
function activate(context) {
  const previewChange = require('./review-preview.cjs').createReviewPreview(vscode, context);
  // The host context menu lives outside Monaco's scoped DOM context. Publish
  // our own selection state through the extension API so both hosts can render
  // the same conditional menu without changing the upstream context service.
  const updateSelectionContext = () => {
    const editor = vscode.window.activeTextEditor;
    void vscode.commands.executeCommand('setContext', 'ynx.hasSelection',
      !!editor && editor.document.uri.scheme === 'file' && !editor.selection.isEmpty).catch(() => {});
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateSelectionContext),
    vscode.window.onDidChangeTextEditorSelection(updateSelectionContext));
  updateSelectionContext();
  const entries = [ ['Chain · Wallet · AI review', 'ynx.openTools'], ['Compile Solidity project', 'ynx.copySolidityProject'], ['Review selection with AI', 'ynx.reviewSelection'], ['Testnet SDK starter', 'ynx.createTemplate'], ['Apply reviewed changes', 'ynx.applyReviewedDiff'] ];
  context.subscriptions.push(vscode.window.registerTreeDataProvider('ynx.tools', {
    getChildren: item => item ? [] : entries,
    getTreeItem: ([label, command]) => ({ label, command: { command, title: label } })
  }));
  const register = (name, action) => context.subscriptions.push(vscode.commands.registerCommand(name, async () => { try { await action(); } catch (error) { vscode.window.showErrorMessage(error.message); } }));
  register('ynx.openTools', async () => {
    const id = process.env.YNX_CORE_SESSION_ID;
    if (!/^[a-f0-9-]{36}$/.test(id || '')) throw Error('This editor is not connected to a YNX project runtime.');
    // Only an opaque session locator. No context or credentials in the URL.
    await vscode.env.openExternal(vscode.Uri.parse(`https://developer.ynxweb4.com/native-tools?sessionId=${encodeURIComponent(id)}`));
  });
  const copyContext = async () => {
    const editor = vscode.window.activeTextEditor; if (!editor || editor.selection.isEmpty) throw Error('Select the text you want to review first.');
    const sessionId = process.env.YNX_CORE_SESSION_ID, workspace = process.env.YNX_CORE_WORKSPACE;
    if (!/^[a-f0-9-]{36}$/.test(sessionId || '') || !workspace) throw Error('Open this selection from an active YNX project runtime.');
    const reviewedPath = await assertWorkspacePath(editor.document.uri.fsPath, workspace);
    const text = editor.document.getText(editor.selection); if (Buffer.byteLength(text) > 64 * 1024) throw Error('Select at most 64 KiB.');
    const selected = { ...capture(editor.document, text), sessionId };
    if (await vscode.window.showWarningMessage('Copy this selection to the clipboard? Choose Use copied selection on YNX Tools, then preview and approve the request before sending it to AI.', { modal: true }, 'Copy selection') !== 'Copy selection') return;
    const assertSelection = () => {
      const current = vscode.workspace.textDocuments.find(document => document.uri.toString() === selected.uri);
      if (current !== editor.document || current.isClosed || current.version !== selected.version ||
        capture(current, text).fullTextDigest !== selected.fullTextDigest)
        throw Error('The document changed while reviewing. Select and review it again.');
      if (process.env.YNX_CORE_SESSION_ID !== sessionId || process.env.YNX_CORE_WORKSPACE !== workspace)
        throw Error('The active project runtime changed. Select and review again.');
    };
    assertSelection();
    const currentPath = await assertWorkspacePath(editor.document.uri.fsPath, workspace);
    if (currentPath?.realWorkspace !== reviewedPath?.realWorkspace || currentPath?.realFile !== reviewedPath?.realFile)
      throw Error('The selected file or workspace path changed. Select and review again.');
    assertSelection();
    await vscode.env.clipboard.writeText(JSON.stringify(selected, null, 2));
    assertSelection();
    return selected;
  };
  register('ynx.copyContext', copyContext);
  register('ynx.reviewSelection', async () => {
    const selected = await copyContext();
    if (!selected) return;
    // The explicit copy approval precedes opening Tools. No selected text,
    // document path or credentials enter the URL, and opening never sends AI.
    await vscode.env.openExternal(vscode.Uri.parse(`https://developer.ynxweb4.com/native-tools?sessionId=${encodeURIComponent(selected.sessionId)}#ai`));
  });
  register('ynx.copySolidityProject', async () => {
    const reviewed = await require('./solidity-project.cjs').captureSolidityProject(vscode, process.env);
    const count = Object.keys(reviewed.snapshot.sources).length;
    if (await vscode.window.showInformationMessage(`Copy a snapshot of ${count} Solidity file(s) for local compilation? Unsaved editor text is included. Review the exact sources on YNX Tools before compiling.`, { modal: true }, 'Copy project sources') !== 'Copy project sources') return;
    await reviewed.verify();
    await vscode.env.clipboard.writeText(JSON.stringify(reviewed.snapshot, null, 2));
    await vscode.env.openExternal(vscode.Uri.parse(`https://developer.ynxweb4.com/native-tools?sessionId=${encodeURIComponent(reviewed.snapshot.sessionId)}#compile`));
  });
  register('ynx.createTemplate', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri; if (!root) throw Error('Open a project first.');
    const sessionId = process.env.YNX_CORE_SESSION_ID, workspace = process.env.YNX_CORE_WORKSPACE, rootKey = root.toString();
    if (!/^[a-f0-9-]{36}$/.test(sessionId || '') || !workspace) throw Error('Create this starter from an active YNX project runtime.');
    const reviewedFolder = await assertWorkspaceDirectory(root.fsPath, workspace);
    const target = vscode.Uri.joinPath(root, 'ynx-testnet-readonly.mjs');
    try { await vscode.workspace.fs.stat(target); throw Error('The starter already exists. No files were changed.'); } catch (error) { if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error; }
    if (await vscode.window.showInformationMessage(`Create the read-only YNX Testnet SDK starter at ${target.fsPath}? This does not install libraries, sign or deploy.`, { modal: true }, 'Create starter') !== 'Create starter') return;
    const currentFolder = await assertWorkspaceDirectory(root.fsPath, workspace);
    if (currentFolder.realWorkspace !== reviewedFolder.realWorkspace || currentFolder.realDirectory !== reviewedFolder.realDirectory ||
      process.env.YNX_CORE_SESSION_ID !== sessionId || process.env.YNX_CORE_WORKSPACE !== workspace || vscode.workspace.workspaceFolders?.[0]?.uri.toString() !== rootKey)
      throw Error('The selected project folder or runtime changed. Review the starter destination again.');
    const edit = new vscode.WorkspaceEdit(); edit.createFile(target, { overwrite: false, ignoreIfExists: false });
    edit.insert(target, new vscode.Position(0, 0), require('./template.cjs'));
    if (!await vscode.workspace.applyEdit(edit)) throw Error('The starter could not be created. Existing files are preserved.');
    await vscode.window.showTextDocument(target);
  });
  register('ynx.applyReviewedDiff', async () => {
    const sessionId = process.env.YNX_CORE_SESSION_ID, workspace = process.env.YNX_CORE_WORKSPACE;
    const assertRuntime = () => {
      if (!/^[a-f0-9-]{36}$/.test(sessionId || '') || !workspace || process.env.YNX_CORE_SESSION_ID !== sessionId || process.env.YNX_CORE_WORKSPACE !== workspace)
        throw Error('The active project runtime changed. Review the changes again.');
    };
    assertRuntime();
    const input = await vscode.window.showQuickPick([
      { label: 'Use copied changes', description: 'Read the suggestion copied from YNX Tools', source: 'clipboard' },
      { label: 'Paste review JSON', description: 'Open a downloaded or saved review', source: 'paste' },
    ], { title: 'Review suggested changes', placeHolder: 'Choose where to read the suggestion', ignoreFocusOut: true });
    if (!input) return;
    const text = input.source === 'clipboard' ? await vscode.env.clipboard.readText() :
      await vscode.window.showInputBox({ title: 'Paste suggested changes', ignoreFocusOut: true });
    if (!text) { if (input.source === 'clipboard') throw Error('Copy suggested changes from YNX Tools first.'); return; }
    if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw Error('The suggested changes are too large. Copy a smaller suggestion from YNX Tools.');
    assertRuntime();
    let value;
    try { value = JSON.parse(text); }
    catch { throw Error('No readable suggested changes were found. Copy them from YNX Tools, or paste a saved review.'); }
    const documents = new Map(vscode.workspace.textDocuments.map(doc => [doc.uri.toString(), doc]));
    const changes = validateChanges(value, documents, sessionId), paths = new Map();
    for (const change of changes) paths.set(change.uri, await assertWorkspacePath(documents.get(change.uri).uri.fsPath, workspace));
    assertRuntime();
    // Open previews before the modal approval; no edits happen during preview.
    for (const change of changes) { const preview = await previewChange(change, documents.get(change.uri)); await vscode.commands.executeCommand('vscode.diff', documents.get(change.uri).uri, preview.uri, 'YNX suggested change — review'); }
    if (await vscode.window.showWarningMessage('Apply these reviewed text changes? This does not execute commands or sign transactions.', { modal: true }, 'Apply reviewed changes') !== 'Apply reviewed changes') return;
    assertRuntime();
    const currentDocuments = new Map(vscode.workspace.textDocuments.map(doc => [doc.uri.toString(), doc]));
    validateChanges(value, currentDocuments, sessionId);
    for (const change of changes) {
      const currentPath = await assertWorkspacePath(currentDocuments.get(change.uri).uri.fsPath, workspace), reviewedPath = paths.get(change.uri);
      if (currentPath?.realWorkspace !== reviewedPath?.realWorkspace || currentPath?.realFile !== reviewedPath?.realFile)
        throw Error('The reviewed file or workspace path changed. Preserve both versions and review again.');
    }
    assertRuntime();
    const finalDocuments = new Map(vscode.workspace.textDocuments.map(doc => [doc.uri.toString(), doc]));
    const finalChanges = validateChanges(value, finalDocuments, sessionId);
    const edit = new vscode.WorkspaceEdit(); for (const change of finalChanges) { const doc = finalDocuments.get(change.uri); edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), change.text); }
    if (!await vscode.workspace.applyEdit(edit)) throw Error('The document changed while applying. Review again; do not overwrite.');
  });
}
module.exports = { activate };
