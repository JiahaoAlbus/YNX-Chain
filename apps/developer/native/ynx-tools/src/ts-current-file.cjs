'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { assertWorkspacePath } = require('./guards.cjs');
function createTsCurrentFile(api, context, environment = process.env) {
  let pending, generation = 0, disposed = false;
  const sessions = new Map();
  const remove = job => fs.rm(job.output, { recursive: true, force: true });
  function cancel() {
    generation++;
    if (pending?.execution) pending.execution.terminate();
    if (pending?.session) void api.debug.stopDebugging(pending.session);
  }
  const ended = api.tasks.onDidEndTaskProcess(event => {
    const job = pending;
    if (job && event.execution.task.definition.ynxTsRequest === job.token) job.finish(event.exitCode);
  });
  const taskEnded = api.tasks.onDidEndTask(event => {
    const job = pending;
    if (job && event.execution.task.definition.ynxTsRequest === job.token) job.finish(undefined);
  });
  const debugEnded = api.debug.onDidTerminateDebugSession(session => {
    const token = session.configuration.ynxTsRequest, job = sessions.get(token);
    if (job) { sessions.delete(token); void remove(job); }
  });
  const debugStarted = api.debug.onDidStartDebugSession(session => {
    const job = sessions.get(session.configuration.ynxTsRequest);
    if (job) {
      job.session = session;
      if (disposed || generation !== job.epoch) void api.debug.stopDebugging(session);
    }
  });
  context.subscriptions.push(ended, taskEnded, debugEnded, debugStarted, { dispose() {
    disposed = true; cancel();
    for (const job of sessions.values()) if (job.session) void api.debug.stopDebugging(job.session);
  } });
  async function start(noDebug = false) {
    if (pending) return false;
    const epoch = ++generation;
    const document = api.window.activeTextEditor?.document;
    const folder = document && api.workspace.getWorkspaceFolder(document.uri);
    let version, job;
    const validate = () => {
      if (disposed || generation !== epoch) throw Error('TypeScript run was cancelled.');
      if (!api.workspace.isTrusted || environment.YNX_WORKSPACE_MODE !== 'local' || !folder || folder.uri.scheme !== 'file'
        || !document || document.isClosed || document.uri.scheme !== 'file'
        || !['typescript', 'typescriptreact'].includes(document.languageId) || !/\.(?:tsx?|mts|cts)$/i.test(document.uri.fsPath)) throw Error('Open a trusted local TypeScript file.');
      if (api.window.activeTextEditor?.document !== document || api.workspace.getWorkspaceFolder(document.uri) !== folder)
        throw Error('The active project or file changed. Run the intended TypeScript file again.');
      if (version !== undefined && (document.version !== version || document.isDirty)) throw Error('The TypeScript file changed after saving. Run it again.');
    };
    pending = {};
    try {
      validate(); if (!await api.workspace.saveAll(false)) return false;
      version = document.version; validate();
      const location = await assertWorkspacePath(document.uri.fsPath, folder.uri.fsPath);
      if (location.realWorkspace !== await fs.realpath(environment.YNX_LOCAL_WORKSPACE)) throw Error('TypeScript file belongs to a different project.');
      const compiler = path.resolve(__dirname, '../runtime/typescript/lib/typescript.js');
      await fs.access(compiler);
      const extension = api.extensions.getExtension('ms-vscode.js-debug');
      if (!extension) throw Error('Enable the JavaScript Debugger to run TypeScript.');
      await extension.activate(); validate();
      const output = await fs.mkdtemp(path.join(location.realWorkspace, '.ynx-ts-run-'));
      let resolve; const completion = new Promise(done => { resolve = done; }); let settled = false;
      job = { output, epoch, token: path.basename(output), finish(code) { if (!settled) { settled = true; resolve(code); } } };
      pending = job;
      validate();
      const task = new api.Task({ type: 'ynx-typescript', ynxTsRequest: job.token }, folder, 'Compile TypeScript File', 'YNX',
        new api.ProcessExecution(process.execPath, [path.join(__dirname, 'ts-compile.cjs'), location.realWorkspace, location.realFile, output], { cwd: location.realWorkspace }), ['$tsc']);
      task.presentationOptions = { reveal: api.TaskRevealKind.Always, panel: api.TaskPanelKind.Shared, clear: true, showReuseMessage: false };
      job.execution = await api.tasks.executeTask(task);
      if (generation !== epoch || disposed) job.execution.terminate();
      const exit = await completion; job.execution = undefined; validate();
      if (exit !== 0) throw Error('TypeScript compilation failed or was cancelled. Check the terminal and Problems, then retry.');
      const suffix = /\.mts$/i.test(document.uri.fsPath) ? '.mjs' : /\.cts$/i.test(document.uri.fsPath) ? '.cjs' : '.js';
      const program = path.join(output, path.relative(location.realWorkspace, location.realFile).replace(/\.(?:tsx?|mts|cts)$/i, suffix));
      await fs.access(program); validate();
      sessions.set(job.token, job);
      let started;
      try { started = await api.debug.startDebugging(folder, {
        type: 'pwa-node', request: 'launch', name: noDebug ? 'Run TypeScript File' : 'Debug TypeScript File',
        program, cwd: location.realWorkspace, console: 'integratedTerminal', sourceMaps: true,
        outFiles: [path.join(output, '**/*.js'), path.join(output, '**/*.mjs'), path.join(output, '**/*.cjs')],
        autoAttachChildProcesses: false, noDebug, ynxTsRequest: job.token,
      }, { noDebug }); } catch (error) {
        if (job.session) await api.debug.stopDebugging(job.session);
        else sessions.delete(job.token);
        throw error;
      }
      if (!started) { sessions.delete(job.token); throw Error('TypeScript launch failed or was cancelled. Retry from the source file.'); }
      if (disposed || generation !== epoch) {
        if (job.session) await api.debug.stopDebugging(job.session);
        throw Error('TypeScript run was cancelled.');
      }
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') throw Error('The packaged TypeScript compiler or selected source is unavailable. Repair the IDE installation and retry.');
      throw error;
    } finally {
      if (job && !sessions.has(job.token) && !job.execution) await remove(job);
      pending = undefined;
    }
  }
  return { start, cancel };
}
module.exports = { createTsCurrentFile };
