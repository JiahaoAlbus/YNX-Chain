'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { assertWorkspacePath } = require('./guards.cjs');
function createTsCurrentFile(api, context, environment = process.env) {
  let pending, generation = 0, disposed = false;
  const sessions = new Map(), failedCleanup = new Map();
  let activeRuns = 0, listenersReleased = false;
  const listeners = [];
  function releaseListeners() {
    if (!disposed || activeRuns || pending || sessions.size || listenersReleased) return;
    listenersReleased = true;
    for (const listener of listeners) listener.dispose();
  }
  function remove(job) {
    if (!job.cleanup) {
      job.cleanup = fs.rm(job.output, { recursive: true, force: true });
      job.cleanup.catch(error => { job.cleanupError = error; failedCleanup.set(job.token, job); });
    }
    return job.cleanup;
  }
  function stop(job) {
    if (!job.session || job.ended) return Promise.resolve();
    if (!job.stopRequested) {
      job.stopRequested = true;
      try { job.stop = Promise.resolve(api.debug.stopDebugging(job.session)); }
      catch (error) { job.stop = Promise.reject(error); }
      // Event/dispose callbacks cannot await. Keep ownership on failure, and
      // let an awaited caller observe the original error without an unhandled rejection.
      job.stop.catch(error => { job.stopError = error; });
    }
    return job.stop;
  }
  function cancel() {
    generation++;
    pending?.cancelSave?.();
    if (pending?.execution) pending.execution.terminate();
    if (pending?.session) void stop(pending);
  }
  function saveDocument(document, request, validate) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        if (request.cancelSave === cancelled) request.cancelSave = undefined;
        error ? reject(error) : resolve(value);
      };
      const cancelled = () => finish(Error('TypeScript run was cancelled.'));
      request.cancelSave = cancelled;
      Promise.resolve().then(() => {
        validate(); // A queued RPC must still belong to this original request.
        return document.save();
      }).then(value => finish(undefined, value), error => finish(error));
    });
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
    if (job && !job.ended) {
      job.ended = true;
      remove(job).then(() => { sessions.delete(token); releaseListeners(); }, error => { job.cleanupError = error; });
    }
  });
  const debugStarted = api.debug.onDidStartDebugSession(session => {
    const job = sessions.get(session.configuration.ynxTsRequest);
    if (job) {
      job.session = session;
      if (disposed || generation !== job.epoch) void stop(job);
    }
  });
  listeners.push(ended, taskEnded, debugEnded, debugStarted);
  // Theia disposes context subscriptions FIFO without awaiting them. This
  // composite owns its listeners until real compile/session termination drains.
  context.subscriptions.push({ dispose() {
    if (disposed) return;
    disposed = true; cancel();
    for (const job of sessions.values()) void stop(job);
    releaseListeners();
  } });
  function start(noDebug = false) {
    if (pending) return Promise.resolve(false);
    activeRuns++;
    const running = run(noDebug);
    const drained = () => { activeRuns--; releaseListeners(); };
    running.then(drained, drained);
    return running;
  }
  async function run(noDebug = false) {
    if (pending) return false;
    const epoch = ++generation;
    const document = api.window.activeTextEditor?.document;
    const folder = document && api.workspace.getWorkspaceFolder(document.uri);
    let version, job, failure;
    const request = { epoch }, savedDocuments = [];
    const originalFile = document?.uri?.fsPath, folderPath = folder?.uri?.fsPath, workspacePath = environment.YNX_LOCAL_WORKSPACE;
    const validate = () => {
      if (disposed || generation !== epoch) throw Error('TypeScript run was cancelled.');
      if (environment.YNX_LOCAL_WORKSPACE !== workspacePath || folder?.uri?.fsPath !== folderPath || document?.uri?.fsPath !== originalFile) throw Error('The active project or file changed. Run the intended TypeScript file again.');
      for (const saved of savedDocuments) if (saved.document.isClosed || saved.document.isDirty || saved.document.version !== saved.version || saved.document.uri.scheme !== 'file' || saved.document.uri.fsPath !== saved.path) throw Error('The TypeScript file changed after saving. Run it again.');
      if (!api.workspace.isTrusted || !path.isAbsolute(workspacePath || '') || environment.YNX_WORKSPACE_MODE !== 'local' || !folder || folder.uri.scheme !== 'file'
        || !document || document.isClosed || document.uri.scheme !== 'file'
        || !['typescript', 'typescriptreact'].includes(document.languageId) || !/\.(?:tsx?|mts|cts)$/i.test(document.uri.fsPath)) throw Error('Open a trusted local TypeScript file.');
      if (api.window.activeTextEditor?.document !== document || api.workspace.getWorkspaceFolder(document.uri) !== folder)
        throw Error('The active project or file changed. Run the intended TypeScript file again.');
      if (version !== undefined && (document.version !== version || document.isDirty)) throw Error('The TypeScript file changed after saving. Run it again.');
    };
    pending = request;
    try {
      validate();
      const location = await assertWorkspacePath(document.uri.fsPath, folderPath);
      if (location.realWorkspace !== await fs.realpath(workspacePath)) throw Error('TypeScript file belongs to a different project.');
      validate();
      // Save only admitted project files, including imported sources and config.
      // The global saveAll API also touches models from unrelated projects.
      const documents = new Set([document, ...(api.workspace.textDocuments || [])]);
      const within = (file, root) => {
        const relative = path.relative(root, file);
        return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
      };
      for (const candidate of documents) {
        if (candidate?.uri?.scheme !== 'file' || !within(candidate.uri.fsPath, folderPath) && !within(candidate.uri.fsPath, location.realWorkspace)) continue;
        validate();
        if (candidate.isClosed) throw Error('The TypeScript file changed after saving. Run it again.');
        const candidatePath = candidate.uri.fsPath;
        const validateCandidate = () => {
          validate();
          if (candidate.isClosed || candidate.uri.scheme !== 'file' || candidate.uri.fsPath !== candidatePath)
            throw Error('The TypeScript file changed after saving. Run it again.');
        };
        await assertWorkspacePath(candidatePath, folderPath);
        validateCandidate();
        const saved = await saveDocument(candidate, request, validateCandidate);
        if (candidate.isClosed) throw Error('The TypeScript file changed after saving. Run it again.');
        validate();
        if (!saved) return false;
        if (candidate.isClosed || candidate.isDirty || candidate.uri.fsPath !== candidatePath) throw Error('The TypeScript file changed after saving. Run it again.');
        // Fence compilation inputs; unrelated project notes may still be edited.
        if (candidate === document || /\.(?:[cm]?[jt]sx?|json)$/i.test(candidatePath))
          savedDocuments.push({ document: candidate, path: candidatePath, version: candidate.version });
      }
      version = document.version; validate();
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
        if (job.session) await stop(job);
        else sessions.delete(job.token);
        throw error;
      }
      if (!started) { sessions.delete(job.token); throw Error('TypeScript launch failed or was cancelled. Retry from the source file.'); }
      if (disposed || generation !== epoch) {
        if (job.session) await stop(job);
        throw Error('TypeScript run was cancelled.');
      }
      return true;
    } catch (error) {
      failure = error.code === 'ENOENT'
        ? Error('The packaged TypeScript compiler or selected source is unavailable. Repair the IDE installation and retry.') : error;
      throw failure;
    } finally {
      try {
        if (job && (!sessions.has(job.token) || job.ended) && !job.execution) await remove(job);
      } catch (cleanupError) {
        if (failure) failure.cleanupError = cleanupError;
        else throw cleanupError;
      } finally { if (pending === request || pending === job) pending = undefined; }
    }
  }
  return { start, cancel };
}
module.exports = { createTsCurrentFile };
