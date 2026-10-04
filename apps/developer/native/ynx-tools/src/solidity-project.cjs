const path = require('node:path');
const { digest, assertWorkspacePath, assertWorkspaceDirectory } = require('./guards.cjs');
async function captureSolidityProject(vscode, environment, targetDocument) {
  const local = environment.YNX_WORKSPACE_MODE === 'local';
  const sessionId = local ? environment.YNX_LOCAL_PROJECT_ID : environment.YNX_CORE_SESSION_ID;
  const workspace = local ? environment.YNX_LOCAL_WORKSPACE : environment.YNX_CORE_WORKSPACE;
  if (local && (environment.YNX_CORE_SESSION_ID || environment.YNX_CORE_WORKSPACE)) throw Error('Local editing cannot use a canonical project session.');
  const folders = vscode.workspace.workspaceFolders, editor = targetDocument ? { document: targetDocument } : vscode.window.activeTextEditor;
  if (!/^[a-f0-9-]{36}$/.test(sessionId || '') || !workspace || folders?.length !== 1 || !editor || editor.document.uri.scheme !== 'file' || !editor.document.uri.fsPath.endsWith('.sol'))
    throw Error('Open a Solidity file in one active YNX project before capturing its sources.');
  const root = folders[0].uri, rootKey = root.toString();
  await assertWorkspaceDirectory(root.fsPath, workspace);
  const rootPath = await assertWorkspacePath(editor.document.uri.fsPath, workspace);
  const directory = await assertWorkspaceDirectory(root.fsPath, workspace);
  if (directory.realDirectory !== rootPath.realWorkspace) throw Error('Open the admitted project root before capturing Solidity sources.');
  const assertRuntime = () => {
    if ((environment.YNX_WORKSPACE_MODE === 'local') !== local || (local ? environment.YNX_LOCAL_PROJECT_ID : environment.YNX_CORE_SESSION_ID) !== sessionId || (local ? environment.YNX_LOCAL_WORKSPACE : environment.YNX_CORE_WORKSPACE) !== workspace || local && (environment.YNX_CORE_SESSION_ID || environment.YNX_CORE_WORKSPACE) || vscode.workspace.workspaceFolders?.length !== 1 || vscode.workspace.workspaceFolders[0].uri.toString() !== rootKey)
      throw Error('The project runtime changed. Capture its Solidity sources again.');
  };
  // A string glob avoids the framework's RelativePattern transport problem.
  // Every returned URI still requires canonical owner-root validation below.
  const uris = await vscode.workspace.findFiles('**/*.sol', '**/{node_modules,.git,.ynx-build}/**', 33);
  if (!uris.some(uri => uri.toString() === editor.document.uri.toString())) uris.push(editor.document.uri);
  if (!uris.length || uris.length > 32) throw Error('The Solidity source snapshot supports at most 32 files. No sources were copied.');
  const documents = [], sources = {}; let total = 0;
  const relative = uri => path.relative(root.fsPath, uri.fsPath).split(path.sep).join('/');
  for (const uri of uris) {
    assertRuntime();
    if (uri.scheme !== 'file') throw Error('Solidity sources must be files inside the admitted project.');
    const location = await assertWorkspacePath(uri.fsPath, workspace), key = relative(uri);
    if (!key.endsWith('.sol') || key.length > 240 || /[\\:\u0000-\u001f\u007f]/.test(key) || key.startsWith('/') || key.split('/').some(part => !part || part === '.' || part === '..') || Object.hasOwn(sources, key)) throw Error('A Solidity source path is invalid or duplicated.');
    const document = await vscode.workspace.openTextDocument(uri), content = document.getText();
    if (Buffer.byteLength(content) > 65536 || (total += Buffer.byteLength(content)) > 262144) throw Error('Solidity sources exceed 64 KiB per file or 256 KiB per snapshot. No sources were copied.');
    const row = { content, sha256: digest(content), documentVersion: document.version };
    Object.defineProperty(sources, key, { value: row, enumerable: true });
    documents.push({ document, uri, location, row });
  }
  const snapshot = { protocol: local ? 'ynx-solidity-local-project/v1' : 'ynx-solidity-project/v1', ...(local ? { projectId: sessionId } : { sessionId }), entryPath: relative(editor.document.uri), sources };
  async function verify() {
    assertRuntime();
    for (const { document, uri, location, row } of documents) {
      const current = vscode.workspace.textDocuments.find(item => item.uri.toString() === uri.toString());
      if (current !== document || current.isClosed || current.version !== row.documentVersion || digest(current.getText()) !== row.sha256)
        throw Error('A Solidity source changed during review. Capture the project again.');
      const checked = await assertWorkspacePath(uri.fsPath, workspace);
      if (checked.realWorkspace !== location.realWorkspace || checked.realFile !== location.realFile) throw Error('A Solidity source path changed during review. Capture the project again.');
    }
    for (const { document, uri, row } of documents) {
      const current = vscode.workspace.textDocuments.find(item => item.uri.toString() === uri.toString());
      if (current !== document || current.isClosed || current.version !== row.documentVersion || digest(current.getText()) !== row.sha256) throw Error('A Solidity source changed during review. Capture the project again.');
    }
    assertRuntime();
  }
  await verify(); return { snapshot, verify };
}
module.exports = { captureSolidityProject };
