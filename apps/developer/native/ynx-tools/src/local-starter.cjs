const fs = require('node:fs/promises'), path = require('node:path');
const { assertWorkspaceDirectory } = require('./guards.cjs');
async function createLocalStarter(vscode, environment) {
  const workspace = environment.YNX_LOCAL_WORKSPACE, projectId = environment.YNX_LOCAL_PROJECT_ID;
  const root = vscode.workspace.workspaceFolders?.[0]?.uri, key = root?.toString();
  function assertRuntime() {
    if (environment.YNX_WORKSPACE_MODE !== 'local' || !workspace || !/^[a-f0-9-]{36}$/.test(projectId || '') ||
        environment.YNX_LOCAL_WORKSPACE !== workspace || environment.YNX_LOCAL_PROJECT_ID !== projectId ||
        environment.YNX_CORE_SESSION_ID || environment.YNX_CORE_WORKSPACE ||
        vscode.workspace.workspaceFolders?.length !== 1 || root?.scheme !== 'file' || vscode.workspace.workspaceFolders[0].uri.toString() !== key)
      throw Error('Open one local project root. Local starter creation cannot use a connected project session or a changed runtime.');
  }
  assertRuntime();
  async function checkedDirectory() {
    const checked = await assertWorkspaceDirectory(root.fsPath, workspace);
    if (path.resolve(workspace) !== checked.realWorkspace || path.resolve(root.fsPath) !== checked.realWorkspace || checked.realDirectory !== checked.realWorkspace)
      throw Error('Open the canonical local project root. Symbolic links and subfolders cannot receive this starter.');
    const stat = await fs.lstat(checked.realDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('The local project directory changed. Create the starter again.');
    return { ...checked, dev: stat.dev, ino: stat.ino };
  }
  const reviewed = await checkedDirectory(), target = vscode.Uri.joinPath(root, 'ynx-testnet-readonly.mjs');
  function assertDocuments() {
    if (vscode.workspace.textDocuments.some(document => !document.isClosed && document.uri.scheme === 'file' && path.resolve(document.uri.fsPath) === path.resolve(target.fsPath)))
      throw Error('The starter is already open. Preserve its editor contents; no files were changed.');
  }
  async function assertAbsent() {
    try { await fs.lstat(target.fsPath); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    throw Error('The starter already exists. No files were changed.');
  }
  assertDocuments(); await assertAbsent();
  // Revalidate after every asynchronous destination check before handing one
  // no-overwrite edit to VS Code. The file service handles a concurrent create.
  const current = await checkedDirectory();
  if (JSON.stringify(current) !== JSON.stringify(reviewed)) throw Error('The local project directory changed. Create the starter again.');
  assertRuntime(); assertDocuments();
  const edit = new vscode.WorkspaceEdit();
  edit.createFile(target, { overwrite: false, ignoreIfExists: false });
  edit.insert(target, new vscode.Position(0, 0), require('./template.cjs'));
  if (!await vscode.workspace.applyEdit(edit)) throw Error('The starter could not be created. Existing files are preserved.');
  await vscode.window.showTextDocument(target);
}
module.exports = { createLocalStarter };
