const vscode = require('vscode');
const { capture, validateChanges, assertWorkspacePath } = require('./guards.cjs');
function activate(context) {
  const entries = [ ['Chain · Wallet · AI review', 'ynx.openTools'], ['Copy selected context', 'ynx.copyContext'], ['Testnet SDK starter', 'ynx.createTemplate'], ['Apply reviewed changes', 'ynx.applyReviewedDiff'] ];
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
  register('ynx.copyContext', async () => {
    const editor = vscode.window.activeTextEditor; if (!editor || editor.selection.isEmpty) throw Error('Select the text you want to review first.');
    const text = editor.document.getText(editor.selection); if (Buffer.byteLength(text) > 64 * 1024) throw Error('Select at most 64 KiB.');
    const selected = { ...capture(editor.document, text), sessionId: process.env.YNX_CORE_SESSION_ID };
    if (await vscode.window.showWarningMessage('Copy this selection to the clipboard? Paste and approve it on the YNX Tools page before sending it to AI.', { modal: true }, 'Copy selection') !== 'Copy selection') return;
    if (editor.document.version !== selected.version) throw Error('The document changed while reviewing. Select and review it again.');
    await vscode.env.clipboard.writeText(JSON.stringify(selected, null, 2));
  });
  register('ynx.createTemplate', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri; if (!root) throw Error('Open a project first.');
    const target = vscode.Uri.joinPath(root, 'ynx-testnet-readonly.mjs');
    try { await vscode.workspace.fs.stat(target); throw Error('The starter already exists. No files were changed.'); } catch (error) { if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error; }
    if (await vscode.window.showInformationMessage('Create a new read-only YNX Testnet SDK starter? This does not install libraries, sign or deploy.', { modal: true }, 'Create starter') !== 'Create starter') return;
    const edit = new vscode.WorkspaceEdit(); edit.createFile(target, { overwrite: false, ignoreIfExists: false });
    edit.insert(target, new vscode.Position(0, 0), require('./template.cjs'));
    if (!await vscode.workspace.applyEdit(edit)) throw Error('The starter could not be created. Existing files are preserved.');
    await vscode.window.showTextDocument(target);
  });
  register('ynx.applyReviewedDiff', async () => {
    const text = await vscode.window.showInputBox({ title: 'Paste a reviewed ynx-reviewed-text/v1 change bundle', ignoreFocusOut: true }); if (!text) return;
    const value = JSON.parse(text), documents = new Map(vscode.workspace.textDocuments.map(doc => [doc.uri.toString(), doc]));
    const changes = validateChanges(value, documents, process.env.YNX_CORE_SESSION_ID);
    for (const change of changes) await assertWorkspacePath(documents.get(change.uri).uri.fsPath, process.env.YNX_CORE_WORKSPACE);
    // Open previews before the modal approval; no edits happen during preview.
    for (const change of changes) { const preview = await vscode.workspace.openTextDocument({ content: change.text, language: documents.get(change.uri).languageId }); await vscode.commands.executeCommand('vscode.diff', documents.get(change.uri).uri, preview.uri, 'YNX suggested change — review'); }
    if (await vscode.window.showWarningMessage('Apply these reviewed text changes? This does not execute commands or sign transactions.', { modal: true }, 'Apply reviewed changes') !== 'Apply reviewed changes') return;
    validateChanges(value, new Map(vscode.workspace.textDocuments.map(doc => [doc.uri.toString(), doc])), process.env.YNX_CORE_SESSION_ID);
    for (const change of changes) await assertWorkspacePath(documents.get(change.uri).uri.fsPath, process.env.YNX_CORE_WORKSPACE);
    validateChanges(value, documents, process.env.YNX_CORE_SESSION_ID);
    const edit = new vscode.WorkspaceEdit(); for (const change of changes) { const doc = documents.get(change.uri); edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), change.text); }
    if (!await vscode.workspace.applyEdit(edit)) throw Error('The document changed while applying. Review again; do not overwrite.');
  });
}
module.exports = { activate };
