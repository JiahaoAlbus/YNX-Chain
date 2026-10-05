const vscode = require('vscode');
const t = (message, ...args) => vscode.l10n?.t ? vscode.l10n.t(message, ...args) : message.replace(/\{(\d+)\}/g, (match, index) => args[index] === undefined ? match : String(args[index]));
const { capture, validateChanges, assertWorkspacePath, assertWorkspaceDirectory } = require('./guards.cjs');
function activate(context) {
  const solidityLanguage = require('./solidity-language.cjs').createSolidityLanguage(vscode, context, process.env);
  require('./solidity-format.cjs').createSolidityFormatting(vscode, context, process.env);
  const compilerDiagnostics = require('./solidity-diagnostics.cjs').createSolidityDiagnostics(vscode, context, process.env);
  const previewChange = require('./review-preview.cjs').createReviewPreview(vscode, context);
  let localReviewPanel;
  const openLocalReview = capture => {
    if (process.env.YNX_WORKSPACE_MODE !== 'local') throw Error(t('Open a local project to review local changes.'));
    localReviewPanel ||= require('./local-review-panel.cjs').createLocalReviewPanel(vscode, context, process.env, previewChange);
    return localReviewPanel.open(capture);
  };
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
  const entries = [
    { label: t('Project'), children: [
      { label: t('Create Counter.sol'), command: 'ynx.createSolidityTemplate' },
      { label: t('Compile Solidity project'), command: 'ynx.compileSolidity' },
      { label: t('Import compiler diagnostics'), command: 'ynx.importSolidityDiagnostics' },
      { label: t('Solidity language status'), command: 'ynx.solidityAnalysisStatus' },
      { label: t('Configure Python for this project'), command: 'ynx.configurePython' },
    ] },
    { label: t('Network'), children: [
      { label: t('YNX Testnet · 6423 · YNXT'), description: t('Configured; not live checked'), command: 'ynx.testnetConfiguration' },
      { label: t('Create read-only SDK starter'), command: 'ynx.createTemplate' },
      { label: t('Deployment unavailable'), description: t('No admitted signing connection'), tooltip: t('Local compilation does not submit a transaction. No deployment is performed.') },
    ] },
    { label: t('Wallet and AI'), children: [
      { label: t('Wallet not connected'), tooltip: t('This editor has no verified Wallet signing connection.') },
      { label: t('AI not connected'), tooltip: t('No verified online model-provider connection is exposed by this local editor.') },
      { label: t('Open local change review'), command: 'ynx.openLocalReview' },
      { label: t('Review selected text'), command: 'ynx.reviewSelection' },
      { label: t('Apply reviewed text changes'), command: 'ynx.applyReviewedDiff' },
    ] },
  ];
  context.subscriptions.push(vscode.window.registerTreeDataProvider('ynx.tools', {
    getChildren: item => item ? item.children || [] : entries,
    getTreeItem: item => ({ label: item.label, description: item.description, tooltip: item.tooltip,
      collapsibleState: item.children ? 2 : 0,
      ...(item.command ? { command: { command: item.command, title: item.label } } : {}) })
  }));
  const register = (name, action) => context.subscriptions.push(vscode.commands.registerCommand(name, async () => { try { await action(); } catch (error) { vscode.window.showErrorMessage(t(error.message)); } }));
  register('ynx.configurePython', () => require('./python-setup.cjs').configurePython(vscode, process.env, t));
  register('ynx.solidityAnalysisStatus', async () => { void vscode.window.showInformationMessage(t('Solidity language: {0}', JSON.stringify(solidityLanguage.status()))); });
  register('ynx.openLocalReview', () => openLocalReview(false));
  register('ynx.importSolidityDiagnostics', async () => {
    const count = await compilerDiagnostics.importCopied();
    void vscode.window.showInformationMessage(t('{0} compiler diagnostic(s) imported. Open Problems to jump to their source locations.', count));
  });
  register('ynx.openTools', async () => {
    const id = process.env.YNX_CORE_SESSION_ID;
    if (!/^[a-f0-9-]{36}$/.test(id || '')) {
      await vscode.commands.executeCommand('ynx.tools.focus');
      return;
    }
    // Only an opaque session locator. No context or credentials in the URL.
    await vscode.env.openExternal(vscode.Uri.parse(`https://developer.ynxweb4.com/native-tools?sessionId=${encodeURIComponent(id)}`));
  });
  register('ynx.testnetConfiguration', async () => {
    await vscode.window.showInformationMessage(t('Configured YNX Testnet: chain ID 6423, currency YNXT, RPC https://rpc.ynxweb4.com/evm. This is the retained read-only starter configuration; current network availability has not been checked. No request, signing or deployment is performed.'));
  });
  register('ynx.createSolidityTemplate', () => createSolidityTemplate(vscode, process.env));
  const copyContext = async () => {
    const editor = vscode.window.activeTextEditor; if (!editor || editor.selection.isEmpty) throw Error(t('Select the text you want to review first.'));
    const sessionId = process.env.YNX_CORE_SESSION_ID, workspace = process.env.YNX_CORE_WORKSPACE;
    if (!/^[a-f0-9-]{36}$/.test(sessionId || '') || !workspace) throw Error(t('Open this selection from an active YNX project runtime.'));
    const reviewedPath = await assertWorkspacePath(editor.document.uri.fsPath, workspace);
    const text = editor.document.getText(editor.selection); if (Buffer.byteLength(text) > 64 * 1024) throw Error(t('Select at most 64 KiB.'));
    const selected = { ...capture(editor.document, text), sessionId };
    if (await vscode.window.showWarningMessage('Copy this selection to the clipboard? Choose Use copied selection on YNX Tools, then preview and approve the request before sending it to AI.', { modal: true }, 'Copy selection') !== 'Copy selection') return;
    const assertSelection = () => {
      const current = vscode.workspace.textDocuments.find(document => document.uri.toString() === selected.uri);
      if (current !== editor.document || current.isClosed || current.version !== selected.version ||
        capture(current, text).fullTextDigest !== selected.fullTextDigest)
        throw Error(t('The document changed while reviewing. Select and review it again.'));
      if (process.env.YNX_CORE_SESSION_ID !== sessionId || process.env.YNX_CORE_WORKSPACE !== workspace)
        throw Error(t('The active project runtime changed. Select and review again.'));
    };
    assertSelection();
    const currentPath = await assertWorkspacePath(editor.document.uri.fsPath, workspace);
    if (currentPath?.realWorkspace !== reviewedPath?.realWorkspace || currentPath?.realFile !== reviewedPath?.realFile)
      throw Error(t('The selected file or workspace path changed. Select and review again.'));
    assertSelection();
    await vscode.env.clipboard.writeText(JSON.stringify(selected, null, 2));
    assertSelection();
    return selected;
  };
  register('ynx.copyContext', copyContext);
  register('ynx.reviewSelection', async () => {
    if (process.env.YNX_WORKSPACE_MODE === 'local') return openLocalReview(true);
    const selected = await copyContext();
    if (!selected) return;
    // The explicit copy approval precedes opening Tools. No selected text,
    // document path or credentials enter the URL, and opening never sends AI.
    await vscode.env.openExternal(vscode.Uri.parse(`https://developer.ynxweb4.com/native-tools?sessionId=${encodeURIComponent(selected.sessionId)}#ai`));
  });
  register('ynx.compileSolidity', () => solidityLanguage.compileProject());
  register('ynx.copySolidityProject', async () => {
    if (process.env.YNX_WORKSPACE_MODE === 'local') throw Error(t('Use Compile Solidity Project for local builds. Online Tools requires a connected YNX project.'));
    const reviewed = await require('./solidity-project.cjs').captureSolidityProject(vscode, process.env);
    if (reviewed.snapshot.protocol !== 'ynx-solidity-project/v1') throw Error(t('Use Compile Solidity Project for local builds. Online Tools requires a connected YNX project.'));
    const count = Object.keys(reviewed.snapshot.sources).length;
    if (await vscode.window.showInformationMessage(`Copy a snapshot of ${count} Solidity file(s) for local compilation? Unsaved editor text is included. Review the exact sources on YNX Tools before compiling.`, { modal: true }, 'Copy project sources') !== 'Copy project sources') return;
    await reviewed.verify();
    await vscode.env.clipboard.writeText(JSON.stringify(reviewed.snapshot, null, 2));
    await vscode.env.openExternal(vscode.Uri.parse(`https://developer.ynxweb4.com/native-tools?sessionId=${encodeURIComponent(reviewed.snapshot.sessionId)}#compile`));
  });
  register('ynx.createTemplate', async () => {
    if (process.env.YNX_WORKSPACE_MODE === 'local') return require('./local-starter.cjs').createLocalStarter(vscode, process.env);
    const root = vscode.workspace.workspaceFolders?.[0]?.uri; if (!root) throw Error(t('Open a project first.'));
    const sessionId = process.env.YNX_CORE_SESSION_ID, workspace = process.env.YNX_CORE_WORKSPACE, rootKey = root.toString();
    if (!/^[a-f0-9-]{36}$/.test(sessionId || '') || !workspace) throw Error(t('Create this starter from an active YNX project runtime.'));
    const reviewedFolder = await assertWorkspaceDirectory(root.fsPath, workspace);
    const target = vscode.Uri.joinPath(root, 'ynx-testnet-readonly.mjs');
    try { await vscode.workspace.fs.stat(target); throw Error(t('The starter already exists. No files were changed.')); } catch (error) { if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error; }
    if (await vscode.window.showInformationMessage(`Create the read-only YNX Testnet SDK starter at ${target.fsPath}? This does not install libraries, sign or deploy.`, { modal: true }, 'Create starter') !== 'Create starter') return;
    const currentFolder = await assertWorkspaceDirectory(root.fsPath, workspace);
    if (currentFolder.realWorkspace !== reviewedFolder.realWorkspace || currentFolder.realDirectory !== reviewedFolder.realDirectory ||
      process.env.YNX_CORE_SESSION_ID !== sessionId || process.env.YNX_CORE_WORKSPACE !== workspace || vscode.workspace.workspaceFolders?.[0]?.uri.toString() !== rootKey)
      throw Error(t('The selected project folder or runtime changed. Review the starter destination again.'));
    const edit = new vscode.WorkspaceEdit(); edit.createFile(target, { overwrite: false, ignoreIfExists: false });
    edit.insert(target, new vscode.Position(0, 0), require('./template.cjs'));
    if (!await vscode.workspace.applyEdit(edit)) throw Error(t('The starter could not be created. Existing files are preserved.'));
    await vscode.window.showTextDocument(target);
  });
  register('ynx.applyReviewedDiff', async () => {
    if (process.env.YNX_WORKSPACE_MODE === 'local') return openLocalReview(false);
    const sessionId = process.env.YNX_CORE_SESSION_ID, workspace = process.env.YNX_CORE_WORKSPACE;
    const assertRuntime = () => {
      if (!/^[a-f0-9-]{36}$/.test(sessionId || '') || !workspace || process.env.YNX_CORE_SESSION_ID !== sessionId || process.env.YNX_CORE_WORKSPACE !== workspace)
        throw Error(t('The active project runtime changed. Review the changes again.'));
    };
    assertRuntime();
    const input = await vscode.window.showQuickPick([
      { label: t('Use copied changes'), description: t('Read the suggestion copied from YNX Tools'), source: 'clipboard' },
      { label: t('Paste review JSON'), description: t('Open a downloaded or saved review'), source: 'paste' },
    ], { title: 'Review suggested changes', placeHolder: 'Choose where to read the suggestion', ignoreFocusOut: true });
    if (!input) return;
    const text = input.source === 'clipboard' ? await vscode.env.clipboard.readText() :
      await vscode.window.showInputBox({ title: 'Paste suggested changes', ignoreFocusOut: true });
    if (!text) { if (input.source === 'clipboard') throw Error(t('Copy suggested changes from YNX Tools first.')); return; }
    if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw Error(t('The suggested changes are too large. Copy a smaller suggestion from YNX Tools.'));
    assertRuntime();
    let value;
    try { value = JSON.parse(text); }
    catch { throw Error(t('No readable suggested changes were found. Copy them from YNX Tools, or paste a saved review.')); }
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
        throw Error(t('The reviewed file or workspace path changed. Preserve both versions and review again.'));
    }
    assertRuntime();
    const finalDocuments = new Map(vscode.workspace.textDocuments.map(doc => [doc.uri.toString(), doc]));
    const finalChanges = validateChanges(value, finalDocuments, sessionId);
    const edit = new vscode.WorkspaceEdit(); for (const change of finalChanges) { const doc = finalDocuments.get(change.uri); edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), change.text); }
    if (!await vscode.workspace.applyEdit(edit)) throw Error(t('The document changed while applying. Review again; do not overwrite.'));
  });
}
async function createSolidityTemplate(api, environment) {
  const fs = require('node:fs/promises'), path = require('node:path');
  const workspace = environment.YNX_LOCAL_WORKSPACE, projectId = environment.YNX_LOCAL_PROJECT_ID;
  const root = api.workspace.workspaceFolders?.[0]?.uri, key = root?.toString();
  const target = root && api.Uri.joinPath(root, 'Counter.sol');
  function assertRuntime() {
    if (environment.YNX_WORKSPACE_MODE !== 'local' || !workspace || !/^[a-f0-9-]{36}$/.test(projectId || '') ||
      environment.YNX_LOCAL_WORKSPACE !== workspace || environment.YNX_LOCAL_PROJECT_ID !== projectId ||
      environment.YNX_CORE_SESSION_ID || environment.YNX_CORE_WORKSPACE ||
      api.workspace.workspaceFolders?.length !== 1 || root?.scheme !== 'file' || api.workspace.workspaceFolders[0].uri.toString() !== key)
      throw Error(t('Open one canonical local project root to create a Solidity contract.'));
  }
  async function directory() {
    const checked = await assertWorkspaceDirectory(root.fsPath, workspace);
    if (checked.realDirectory !== checked.realWorkspace || path.resolve(root.fsPath) !== checked.realWorkspace || path.resolve(workspace) !== checked.realWorkspace)
      throw Error(t('Symbolic links and subfolders cannot receive this contract template.'));
    const stat = await fs.lstat(checked.realDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error(t('The local project directory changed.'));
    return { directory: checked.realDirectory, dev: stat.dev, ino: stat.ino };
  }
  function assertDocuments() {
    if (api.workspace.textDocuments.some(doc => !doc.isClosed && doc.uri.scheme === 'file' && path.resolve(doc.uri.fsPath) === path.resolve(target.fsPath)))
      throw Error(t('Counter.sol is already open. Existing editor contents are preserved.'));
  }
  async function assertAbsent() {
    try { await fs.lstat(target.fsPath); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    throw Error(t('Counter.sol already exists. No files were changed.'));
  }
  assertRuntime(); const before = await directory(); assertDocuments(); await assertAbsent();
  const after = await directory(); assertRuntime(); assertDocuments();
  if (before.directory !== after.directory || before.dev !== after.dev || before.ino !== after.ino)
    throw Error(t('The local project directory changed. Create the contract again.'));
  const edit = new api.WorkspaceEdit();
  edit.createFile(target, { overwrite: false, ignoreIfExists: false });
  edit.insert(target, new api.Position(0, 0), '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\ncontract Counter {\n    uint256 public count;\n\n    function increment() public {\n        count += 1;\n    }\n}\n');
  if (!await api.workspace.applyEdit(edit)) throw Error(t('The contract could not be created. Existing files are preserved.'));
  await api.window.showTextDocument(target);
  // No direct write/save: retain the normal editor dirty state and Save command.
}
module.exports = { activate, createSolidityTemplate };
