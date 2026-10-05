'use strict';
const { realpath, access } = require('node:fs/promises');
const { constants } = require('node:fs');
const { relative, isAbsolute, dirname, basename, join } = require('node:path');
const { installedCompiler, createBuildTasks, createLaunchConfiguration, existingConfiguration, taskConfiguration } = require('./build-tasks.cjs');
const { cppProjectRoot } = require('./project-root.cjs');
const TEXT = {
  project: ['Open one trusted local C/C++ project.', '请打开一个受信任的本地 C/C++ 项目。'],
  source: ['Select a saved C or C++ source file in this project.', '请选择本项目内已保存的 C 或 C++ 源文件。'],
  save: ['Save the source file before running.', '请先保存源文件，再运行。'],
  compiler: ['Select C/C++ compiler', '选择 C/C++ 编译器'],
  tool: ['Use the installed Apple Clang compiler and macOS SDK.', '使用已安装的 Apple Clang 编译器与 macOS SDK。'],
  tasks: ['Select the existing project task', '选择已有项目任务'],
  missing: ['The existing task configuration has no usable task. Open it to configure a build target.', '已有任务配置没有可用任务。请打开配置并设置构建目标。'],
  taskEnded: ['The task ended without an exit code. Check Terminal and Output.', '任务已结束但没有退出码，请查看终端和输出。'],
  failed: ['Build failed or was cancelled. The previous executable was not run.', '构建失败或已取消，未运行旧的可执行文件。'],
  debugger: ['C/C++ debugging needs the LLDB DAP extension and a working local lldb-dap executable.', 'C/C++ 调试需要 LLDB DAP 扩展与可用的本地 lldb-dap 可执行文件。'],
  launch: ['Select the existing project debug configuration', '选择已有项目调试配置'],
  launchMissing: ['No usable C/C++ launch target is configured. Existing files were preserved; configure a target in launch.json.', '尚未配置可用的 C/C++ 调试目标。已有文件已保留，请在 launch.json 中配置目标。'],
  launchFailed: ['The debugger did not start. Check Debug Console and Output.', '调试器未启动，请查看调试控制台和输出。'],
  busy: ['A C/C++ operation is already running in this project.', '本项目已有 C/C++ 操作正在运行。'],
  stopped: ['C/C++ operation stopped.', 'C/C++ 操作已停止。'],
  complete: ['C/C++ program exited with code {0}.', 'C/C++ 程序已退出，退出码为 {0}。'],
  custom: ['Run project task: {0}', '运行项目任务：{0}'],
  customExit: ['Project task {0} exited with code {1}.', '项目任务 {0} 已退出，退出码为 {1}。'],
  existing: ['Existing project configuration was preserved. Choose its target explicitly.', '已有项目配置已保留，请明确选择其中的目标。'],
};
const CPP_TRANSLATIONS = Object.fromEntries(Object.values(TEXT));
function translator(vscode) { return key => { const [en, zh] = TEXT[key]; return vscode.l10n?.t ? vscode.l10n.t(en) : /^zh\b/i.test(vscode.env.language || '') ? zh : en; }; }
async function sourceContext(vscode, env) {
  const root = cppProjectRoot(env), folders = vscode.workspace.workspaceFolders, document = vscode.window.activeTextEditor?.document;
  const t = translator(vscode);
  if (!root || !vscode.workspace.isTrusted || folders?.length !== 1 || folders[0].uri.scheme !== 'file' || await realpath(folders[0].uri.fsPath) !== root) throw Error(t('project'));
  if (!document || !['c', 'cpp'].includes(document.languageId) || document.uri.scheme !== 'file' || document.isUntitled) throw Error(t('source'));
  const path = await realpath(document.uri.fsPath), within = relative(root, path);
  if (!within || within === '..' || within.startsWith('../') || isAbsolute(within)) throw Error(t('source'));
  if (document.isDirty && !await document.save()) throw Error(t('save'));
  return { root, path, version: document.version, folder: folders[0], document, language: document.languageId };
}
// Subscribe before executeTask: short native tasks may finish before its RPC promise.
async function executeAndWait(vscode, task, token) {
  let execution, settled = false, resolveResult, rejectResult;
  const early = new Map(), endedEarly = new Set(), result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const end = vscode.tasks.onDidEndTaskProcess(event => { if (!execution) early.set(event.execution, event.exitCode); else if (event.execution === execution && !settled) { settled = true; resolveResult(event.exitCode); } });
  // A task can terminate before its process starts (launch error/cancel).
  const terminal = vscode.tasks.onDidEndTask(event => { if (!execution) endedEarly.add(event.execution); else if (event.execution === execution && !settled) { settled = true; resolveResult(undefined); } });
  const cancel = token.onCancellationRequested(() => { if (execution) execution.terminate(); });
  try {
    if (token.isCancellationRequested) return undefined;
    execution = await vscode.tasks.executeTask(task);
    if (token.isCancellationRequested) execution.terminate();
    if (!execution) throw Error('Task did not start. Check Output.');
    if (early.has(execution) || endedEarly.has(execution)) { settled = true; resolveResult(early.get(execution)); }
    return await result;
  } catch (error) { rejectResult(error); await result.catch(() => {}); throw error; }
  finally { end.dispose(); terminal.dispose(); cancel.dispose(); }
}
function registerCppRun(vscode, context, env) {
  const t = translator(vscode), active = new Map();
  if (vscode.debug.onDidTerminateDebugSession) context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(session => {
    const root = session.workspaceFolder?.uri?.fsPath, owner = root && active.get(root);
    if (owner?.kind === 'debug' && (!owner.sessionId || owner.sessionId === session.id)) active.delete(root);
  }));
  async function validateScope(scope) {
    const folders = vscode.workspace.workspaceFolders;
    if (!vscode.workspace.isTrusted || folders?.length !== 1 || folders[0].uri.scheme !== 'file' || await realpath(folders[0].uri.fsPath) !== scope.root || cppProjectRoot(env) !== scope.root)
      throw Error(t('project'));
    if (scope.document.isClosed || scope.document.isDirty || scope.document.version !== scope.version || await realpath(scope.document.uri.fsPath) !== scope.path) throw Error(t('save'));
  }
  async function setup(scope) {
    // Build configuration does not depend on Clangd being installed or started.
    const sysroot = env.YNX_IDE_CPP_SYSROOT || '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk';
    const existing = await existingConfiguration(scope.root, 'tasks');
    if (existing) return { path: existing, created: false };
    const tool = await installedCompiler({ sysroot, language: scope.language });
    const choice = await vscode.window.showQuickPick([{ label: scope.language === 'c' ? 'Apple Clang (C)' : 'Apple Clang (C++)', description: tool.compiler, detail: t('tool') }], { title: t('compiler') });
    if (!choice) return undefined;
    await validateScope(scope);
    return createBuildTasks(scope.root, tool);
  }
  async function generatedPair(scope, tasks) {
    const tool = await installedCompiler({ sysroot: env.YNX_IDE_CPP_SYSROOT || '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk', language: scope.language });
    const [expectedBuild, expectedRun] = taskConfiguration(tool).tasks;
    const matches = (task, expected) => task?.name === expected.label && task.execution instanceof vscode.ProcessExecution
      && task.execution.process === expected.command
      && JSON.stringify(task.execution.args) === JSON.stringify(expected.args || [])
      && task.execution.options?.cwd === expected.options.cwd && !Object.keys(task.execution.options?.env || {}).length;
    const scoped = tasks.filter(task => task.scope?.uri?.fsPath === scope.folder.uri.fsPath);
    const build = scoped.find(task => matches(task, expectedBuild)), run = scoped.find(task => matches(task, expectedRun));
    return build && run ? { build, run } : undefined;
  }
  async function chooseTask(scope, config) {
    const tasks = (await vscode.tasks.fetchTasks()).filter(task => task.scope?.uri?.fsPath === scope.folder.uri.fsPath);
    let pair; try { pair = await generatedPair(scope, tasks); } catch { /* Existing custom tools are selected explicitly. */ }
    if (pair) return { task: pair.run, generated: true };
    if (!tasks.length) { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(config.path))); throw Error(t('missing')); }
    const item = await vscode.window.showQuickPick(tasks.map(task => ({ label: task.name, description: task.source, detail: t('existing'), task })), { title: t('tasks') });
    return item && { task: item.task, generated: false };
  }
  async function buildCaptured(scope, token) {
    await validateScope(scope);
        const build = (await generatedPair(scope, await vscode.tasks.fetchTasks()))?.build;
    if (!build || !(build.execution instanceof vscode.ProcessExecution)) throw Error(t('missing'));
    const file = scope.path, folder = dirname(file), stem = basename(file).replace(/\.[^.]+$/, '');
    const substitute = value => String(value).replaceAll('${fileDirname}', folder).replaceAll('${fileBasenameNoExtension}', stem).replaceAll('${file}', file).replaceAll('${workspaceFolder}', scope.root);
    const version = scope.document.version;
    const concreteBuild = new vscode.Task(build.definition, scope.folder, build.name, build.source,
      new vscode.ProcessExecution(substitute(build.execution.process), build.execution.args.map(substitute), { ...build.execution.options, cwd: substitute(build.execution.options?.cwd || folder) }), build.problemMatchers);
    const built = await executeAndWait(vscode, concreteBuild, token);
    if (token.isCancellationRequested) return undefined;
    if (built !== 0) throw Error(t('failed'));
    if (scope.document.version !== version || scope.document.isDirty) throw Error(t('save'));
    const binary = join(folder, stem); await access(binary, constants.X_OK);
    return { binary, folder };
  }
  async function operation(debug) {
    const scope = await sourceContext(vscode, env);
    if (active.has(scope.root) || (debug && vscode.debug.activeDebugSession?.workspaceFolder?.uri?.fsPath === scope.folder.uri.fsPath)) { vscode.window.showInformationMessage(t('busy')); return; }
    active.set(scope.root, { kind: debug ? 'debug' : 'run' });
    let sessionAccepted = false;
    try {
      const config = await setup(scope); if (!config) return;
      if (!debug) {
        const choice = await chooseTask(scope, config); if (!choice) return; const { task } = choice;
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: choice.generated ? 'C/C++' : t('custom').replace('{0}', task.name), cancellable: true }, async (_progress, token) => {
          let code;
          const ownName = 'YNX: Run active ' + (scope.language === 'c' ? 'C' : 'C++');
          if (choice.generated) {
            const target = await buildCaptured(scope, token);
            if (!target) { vscode.window.showInformationMessage(t('stopped')); return; }
            const { binary, folder } = target;
            const run = new vscode.Task({ type: 'process' }, scope.folder, ownName, 'YNX C/C++', new vscode.ProcessExecution(binary, [], { cwd: folder }), []);
            code = await executeAndWait(vscode, run, token);
          } else { await validateScope(scope); code = await executeAndWait(vscode, task, token); }
          if (token.isCancellationRequested) vscode.window.showInformationMessage(t('stopped'));
          else if (code === undefined) throw Error(t('taskEnded'));
          else { const text = choice.generated ? t('complete').replace('{0}', String(code)) : t('customExit').replace('{0}', task.name).replace('{1}', String(code));
            if (code === 0) vscode.window.showInformationMessage(text); else vscode.window.showErrorMessage(text); }
        });
      } else {
        const extension = vscode.extensions.getExtension('llvm-vs-code-extensions.lldb-dap');
        if (!extension) throw Error(t('debugger'));
        const adapter = '/Library/Developer/CommandLineTools/usr/bin/lldb-dap';
        await extension.activate();
        const settings = vscode.workspace.getConfiguration('lldb-dap', scope.folder.uri);
        // Existing explicit user adapter choice stays authoritative and is validated.
        const selectedAdapter = settings.get('executable-path') || adapter;
        if (!isAbsolute(selectedAdapter)) throw Error(t('debugger'));
        try { await access(await realpath(selectedAdapter), constants.X_OK); } catch { throw Error(t('debugger')); }
        if (!settings.get('executable-path')) await settings.update('executable-path', adapter, vscode.ConfigurationTarget.WorkspaceFolder);
        const pair = await generatedPair(scope, await vscode.tasks.fetchTasks()).catch(() => undefined);
        if (!pair && !await existingConfiguration(scope.root, 'launch')) throw Error(t('launchMissing'));
        const launch = await createLaunchConfiguration(scope.root, config.path, scope.language);
        let selected = launch.configuration;
        if (!selected) {
          const configurations = vscode.workspace.getConfiguration('launch', scope.folder.uri).get('configurations', []).filter(item => item.type === 'lldb-dap');
          selected = (await vscode.window.showQuickPick(configurations.map(configuration => ({ label: configuration.name, configuration })), { title: t('launch') }))?.configuration;
          if (!configurations.length) { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(launch.path))); throw Error(t('launchMissing')); }
          if (!selected) return;
        }
        if (pair && selected.preLaunchTask === 'YNX: Build active ' + (scope.language === 'c' ? 'C' : 'C++') && selected.program === '${fileDirname}/${fileBasenameNoExtension}') {
          const target = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'C/C++', cancellable: true }, (_progress, token) => buildCaptured(scope, token));
          if (!target) { vscode.window.showInformationMessage(t('stopped')); return; }
          selected = { ...selected, program: target.binary, cwd: target.folder };
          delete selected.preLaunchTask; // Captured source was already built successfully.
        }
        await validateScope(scope);
        if (!await vscode.debug.startDebugging(scope.folder, selected)) throw Error(t('launchFailed'));
        sessionAccepted = true;
        const session = vscode.debug.activeDebugSession;
        if (session?.workspaceFolder?.uri?.fsPath === scope.folder.uri.fsPath && active.has(scope.root)) active.get(scope.root).sessionId = session.id;
      }
    } finally { if (!sessionAccepted) active.delete(scope.root); }
  }
  function command(id, callback) { context.subscriptions.push(vscode.commands.registerCommand(id, () => callback().catch(error => vscode.window.showErrorMessage(error.message)))); }
  command('ynx.cpp.runActive', () => operation(false));
  command('ynx.cpp.debugActive', () => operation(true));
  command('ynx.cpp.configureBuildTasks', async () => { const scope = await sourceContext(vscode, env), config = await setup(scope); if (config) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(config.path))); });
  return { active };
}
module.exports = { registerCppRun, sourceContext, executeAndWait, CPP_TRANSLATIONS };
