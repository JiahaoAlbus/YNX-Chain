const vscode = require('vscode');
const { LanguageClient } = require('vscode-languageclient/node');
const { spawn } = require('node:child_process');
const { realpath, access } = require('node:fs/promises');
const { isAbsolute } = require('node:path');
const { constants } = require('node:fs');
const { cppProjectRoot } = require('./project-root.cjs');
const { installedCompiler, createBuildTasks } = require('./build-tasks.cjs');
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
    context.subscriptions.push(vscode.commands.registerCommand('ynx.cpp.configureBuildTasks', async () => {
      const zh = /^zh\b/i.test(vscode.env.language || '');
      const text = (en, cn) => zh ? cn : en;
      try {
        if (!vscode.workspace.isTrusted || vscode.workspace.workspaceFolders?.length !== 1 ||
          await realpath(vscode.workspace.workspaceFolders[0].uri.fsPath) !== root)
          throw Error(text('Open one trusted project to configure C/C++ tasks.', '请打开一个受信任的项目，再配置 C/C++ 任务。'));
        const language = vscode.window.activeTextEditor?.document.languageId === 'c' ? 'c' : 'cpp';
        const tool = await installedCompiler({ clangd: entry, sysroot: process.env.YNX_IDE_CPP_SYSROOT, language });
        const chosen = await vscode.window.showQuickPick([{ label: language === 'c' ? 'Apple Clang (C)' : 'Apple Clang (C++)',
          description: tool.compiler, detail: text('Build and run the active source file. Existing tasks.json is preserved.', '构建并运行当前源文件；保留已有 tasks.json。') }],
          { title: text('Select C/C++ compiler', '选择 C/C++ 编译器'), placeHolder: text('Installed local compiler', '已安装的本地编译器') });
        if (!chosen) return;
        const result = await createBuildTasks(root, tool);
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(result.path)));
        vscode.window.showInformationMessage(result.created
          ? text('Tasks created. Return to your C/C++ source file and save it, then choose Run Task → YNX: Run active C/C++.', '任务已创建。切回 C/C++ 源文件并保存，再选择运行任务 → YNX: Run active C/C++。')
          : text('Existing tasks.json opened; your tasks were preserved.', '已打开现有 tasks.json，原任务未被覆盖。'));
      } catch (error) { vscode.window.showErrorMessage(error.message); }
    }));
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
