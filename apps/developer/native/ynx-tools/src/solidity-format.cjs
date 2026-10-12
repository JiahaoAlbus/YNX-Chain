const path = require('node:path');
const { existsSync } = require('node:fs');
const { spawn } = require('node:child_process');
const { captureSolidityProject } = require('./solidity-project.cjs');

function createSolidityFormatting(vscode, context, environment) {
  const root = path.join(context.extensionPath || path.resolve(__dirname, '..'), 'formatter');
  if (!vscode.languages.registerDocumentFormattingEditProvider || !existsSync(path.join(root, 'distribution.json'))) return { available: false };
  const { createMessageConnection, StreamMessageReader, StreamMessageWriter } = require(path.join(root, 'node_modules/vscode-jsonrpc/node'));
  let pending, disposed = false;
  context.subscriptions.push({ dispose() { disposed = true; pending?.abort(); } });
  context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider({ language: 'solidity', scheme: 'file' }, {
    async provideDocumentFormattingEdits(document, options, token) {
      if (disposed || token?.isCancellationRequested || vscode.workspace.isTrusted === false) return undefined;
      const reviewed = await captureSolidityProject(vscode, environment, document);
      if (pending) throw Error('A Solidity formatting request is already running.');
      const controller = new AbortController(); pending = controller;
      const cancellation = token?.onCancellationRequested?.(() => controller.abort());
      const child = spawn(process.execPath, [path.join(root, 'node_modules/@nomicfoundation/solidity-language-server/out/index.js'), '--stdio'], {
        cwd: environment.YNX_CORE_WORKSPACE, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...Object.fromEntries(['PATH', 'TMPDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]])), OPENSSL_CONF: '/dev/null', NODE_OPTIONS: '--no-experimental-global-navigator --max-old-space-size=512' },
      });
      const stopped = new Promise(resolve => child.once('close', resolve));
      const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
      let lastError, killTimer, timeout;
      const kill = () => { try { process.platform === 'win32' ? child.kill('SIGTERM') : process.kill(-child.pid, 'SIGTERM'); } catch {} };
      const abort = () => { connection.dispose(); kill(); };
      controller.signal.addEventListener('abort', abort, { once: true });
      connection.onRequest('workspace/configuration', params => params.items.map(() => ({ formatter: 'prettier' })));
      connection.onNotification('window/logMessage', params => { if (/Error formatting document/.test(params.message)) lastError = 'The Solidity formatter could not parse the current source.'; });
      connection.onError(() => controller.abort());
      child.once('error', () => controller.abort());
      child.stderr.on('data', () => {});
      connection.listen();
      timeout = setTimeout(() => { lastError = 'Solidity formatting timed out.'; controller.abort(); }, 15000);
      let edits;
      try {
        await connection.sendRequest('initialize', { processId: null, rootUri: vscode.workspace.workspaceFolders[0].uri.toString(), workspaceFolders: [{ uri: vscode.workspace.workspaceFolders[0].uri.toString(), name: 'YNX project' }], capabilities: {}, initializationOptions: { telemetryEnabled: false, extensionName: 'YNX Developer', extensionConfig: { formatter: 'prettier' } } });
        await connection.sendNotification('initialized', {});
        await connection.sendNotification('textDocument/didOpen', { textDocument: { uri: document.uri.toString(), languageId: 'solidity', version: document.version, text: document.getText() } });
        const result = await connection.sendRequest('textDocument/formatting', { textDocument: { uri: document.uri.toString() }, options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces } });
        await reviewed.verify();
        if (disposed || token?.isCancellationRequested) return undefined;
        if (!Array.isArray(result) || result.length > 256) throw Error(lastError || 'The Solidity formatter returned no formatting result.');
        let bytes = 0;
        edits = result.map(row => {
          if (typeof row.newText !== 'string' || (bytes += Buffer.byteLength(row.newText)) > 1024 * 1024) throw Error('The Solidity formatting result exceeds its limit.');
          const position = value => {
            if (!Number.isInteger(value?.line) || value.line < 0 || !Number.isInteger(value.character) || value.character < 0) throw Error('Invalid Solidity formatting position.');
            const result = new vscode.Position(value.line, value.character);
            if (!document.positionAt(document.offsetAt(result)).isEqual(result)) throw Error('The Solidity formatting position is outside this document.');
            return result;
          };
          const start = position(row.range?.start), end = position(row.range?.end);
          if (start.isAfter(end)) throw Error('Invalid Solidity formatting range.');
          return vscode.TextEdit.replace(new vscode.Range(start, end), row.newText);
        });
      } finally {
        clearTimeout(timeout); cancellation?.dispose(); controller.signal.removeEventListener('abort', abort);
        killTimer = setTimeout(kill, 1200);
        const forced = setTimeout(() => { try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {} }, 2500);
        if (!controller.signal.aborted) { try { await connection.sendRequest('shutdown', null); await connection.sendNotification('exit'); } catch {} }
        connection.dispose();
        await stopped; clearTimeout(killTimer); clearTimeout(forced);
        if (pending === controller) pending = undefined;
      }
      await reviewed.verify();
      return disposed || token?.isCancellationRequested ? undefined : edits;
    },
  }));
  return { available: true };
}
module.exports = { createSolidityFormatting };
