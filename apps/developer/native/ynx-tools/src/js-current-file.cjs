'use strict';
const path = require('node:path');
const { realpath } = require('node:fs/promises');
const { assertWorkspacePath } = require('./guards.cjs');
const { waitForSignal } = require('./capture-cancellation.cjs');
// Discovery for the bundled official js-debug extension. Execution, DAP and
// process supervision remain owned by that extension and the local host.
function createJsCurrentFile(vscode, environment = process.env, context) {
  let starting = false, disposed = false, pending;
  context?.subscriptions.push({ dispose() {
    if (disposed) return; disposed = true;
    pending?.abort(Error('JavaScript run owner was retired.'));
  } });
  return async function start(noDebug = false) {
    if (starting || disposed) return false;
    starting = true;
    const request = new AbortController(); pending = request;
    try {
      const document = vscode.window.activeTextEditor?.document;
      const folder = document && vscode.workspace.getWorkspaceFolder(document.uri);
      let savedVersion, saved = false;
      const validate = () => {
        if (disposed) throw Error('JavaScript run owner was retired.');
        request.signal.throwIfAborted();
        if (saved && (document.version !== savedVersion || document.isDirty)) throw Error('The file changed after saving. Save and run it again.');
        if (!vscode.workspace.isTrusted) throw Error('Trust this project before running JavaScript.');
        if (!document || document.isClosed || document.uri.scheme !== 'file' || document.languageId !== 'javascript' || !/\.(?:js|mjs|cjs)$/i.test(document.uri.fsPath)) throw Error('Open a saved JavaScript file (.js, .mjs or .cjs).');
        if (vscode.window.activeTextEditor?.document !== document) throw Error('The active file changed. Run the intended JavaScript file again.');
        if (environment.YNX_WORKSPACE_MODE !== 'local' || !folder || folder.uri.scheme !== 'file' ||
            vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString() !== folder.uri.toString() ||
            !path.isAbsolute(environment.YNX_LOCAL_WORKSPACE || '')) throw Error('Open this file in its active local project before running it.');
      };
      validate();
      if (!await waitForSignal(() => { validate(); return document.save(); }, request.signal)) return false;
      savedVersion = document.version; saved = true;
      validate();
      const location = await assertWorkspacePath(document.uri.fsPath, folder.uri.fsPath);
      if (location.realWorkspace !== await realpath(environment.YNX_LOCAL_WORKSPACE)) throw Error('This file belongs to another local project.');
      validate();
      const extension = vscode.extensions.getExtension('ms-vscode.js-debug');
      if (!extension) throw Error('Install and enable the JavaScript Debugger extension before running this file.');
      await waitForSignal(() => { validate(); return extension.activate(); }, request.signal);
      validate();
      const started = await vscode.debug.startDebugging(folder, {
        type: 'pwa-node', request: 'launch', name: noDebug ? 'Run JavaScript File' : 'Debug JavaScript File',
        program: document.uri.fsPath, cwd: folder.uri.fsPath,
        console: 'integratedTerminal', autoAttachChildProcesses: false, noDebug,
      }, { noDebug });
      if (!started) throw Error('JavaScript launch was cancelled or failed. Check the debug output and retry.');
      return true;
    } finally { if (pending === request) pending = undefined; starting = false; }
  };
}
module.exports = { createJsCurrentFile };
