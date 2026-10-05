const vscode = require('vscode');
const { LanguageClient } = require('vscode-languageclient/node');
const { spawn } = require('node:child_process');
const { realpath, access } = require('node:fs/promises');
const { isAbsolute } = require('node:path');
const { constants } = require('node:fs');
const { cppProjectRoot } = require('./project-root.cjs');
let client, child;

async function activate(context) {
  const folders = vscode.workspace.workspaceFolders;
  if (!vscode.workspace.isTrusted || folders?.length !== 1 || folders[0].uri.scheme !== 'file') return;
  const root = cppProjectRoot(process.env), entry = process.env.YNX_IDE_CLANGD_ENTRY;
  if (!root || !isAbsolute(root) || !entry || !isAbsolute(entry)) {
    vscode.window.showWarningMessage('C/C++ syntax is available. This workspace runtime has no configured Clangd language server.');
    return;
  }
  try {
    if (await realpath(root) !== root || await realpath(folders[0].uri.fsPath) !== root)
      throw Error('C/C++ language service refused a different workspace.');
    const executable = await realpath(entry);
    await access(executable, constants.X_OK);
    const output = vscode.window.createOutputChannel('YNX C/C++');
    context.subscriptions.push(output);
    const server = async () => {
      child = spawn(executable, ['--background-index=false', '--clang-tidy=false', '--header-insertion=never', '--log=error'], {
        cwd: root, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
        env: Object.fromEntries(['PATH', 'TMPDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]])),
      });
      child.stderr.on('data', chunk => output.append(String(chunk)));
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      return { reader: child.stdout, writer: child.stdin };
    };
    const sysroot = process.env.YNX_IDE_CPP_SYSROOT;
    if (sysroot && !isAbsolute(sysroot)) throw Error('C/C++ runtime SDK path must be absolute.');
    const fallbackFlags = sysroot ? ['-isysroot', sysroot] : [];
    // Standard string globs survive this host's selector bridge. Escape the
    // actual project directory so bracket/wildcard names cannot widen scope.
    const projectPattern = root.replaceAll('\\', '/').replace(/[?*\[\]{}]/g, '[$&]') + '/**/*';
    client = new LanguageClient('ynx-cpp', 'YNX C/C++', server, {
      documentSelector: ['c', 'cpp'].map(language => ({ scheme: 'file', language, pattern: projectPattern })),
      workspaceFolder: folders[0], outputChannel: output,
      initializationOptions: { fallbackFlags },
    });
    context.subscriptions.push({ dispose: () => { void deactivate(); } });
    await client.start();
  } catch (error) {
    await deactivate();
    vscode.window.showErrorMessage(`C/C++ language service could not start: ${error.message}`);
  }
}
async function deactivate() {
  const previous = client, processHandle = child;
  client = undefined; child = undefined;
  try { if (previous) await previous.stop(3000); }
  catch (error) { console.warn('YNX C/C++ shutdown:', error.message); }
  finally { if (processHandle && processHandle.exitCode === null && processHandle.signalCode === null) processHandle.kill('SIGTERM'); }
}
module.exports = { activate, deactivate };
