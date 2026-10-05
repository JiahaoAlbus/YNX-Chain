import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { registerCppRun, sourceContext, executeAndWait } = require('./cpp-run.cjs');
const { createBuildTasks, createLaunchConfiguration, installedCompiler } = require('./build-tasks.cjs');
function emitter() { const listeners = new Set(); return { event: fn => { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; }, fire: event => { for (const fn of listeners) fn(event); }, count: () => listeners.size }; }
const runtimeRequire = createRequire(new URL('../../../runtime/theia/package.json', import.meta.url));
runtimeRequire('reflect-metadata');
const { Task, ProcessExecution } = runtimeRequire('@theia/plugin-ext/lib/plugin/types-impl');
async function fixture() {
 const root = await mkdtemp('/private/tmp/ynx-cpp-first-use-'), path = join(root, 'main.cpp');
 const document = { uri: { scheme: 'file', fsPath: path }, languageId: 'cpp', version: 1, isDirty: false, save: async () => true };
 const folder = { uri: { scheme: 'file', fsPath: root }, name: 'test' }, errors = [], output = [], commands = new Map(), end = emitter(), ended = emitter();
 const token = { isCancellationRequested: false, onCancellationRequested: emitter().event };
 const vscode = { Task, ProcessExecution, ProgressLocation: { Notification: 15 }, env: { language: 'en' }, debug: {}, workspace: { workspaceFolders: [folder], isTrusted: true },
 window: { activeTextEditor: { document }, showQuickPick: async items => { vscode.window.activeTextEditor = { document: { languageId: 'markdown' } }; return items[0]; },
 showInformationMessage: text => output.push(text), showErrorMessage: text => errors.push(text), withProgress: (_options, action) => action({}, token) },
 commands: { registerCommand: (id, handler) => { commands.set(id, handler); return { dispose() {} }; } },
 tasks: { onDidEndTaskProcess: end.event, onDidEndTask: ended.event, fetchTasks: async () => {
  const config = JSON.parse(await readFile(join(root, '.vscode/tasks.json'), 'utf8'));
  return config.tasks.map(item => new Task({ type: 'process' }, folder, item.label, 'Workspace', new ProcessExecution(item.command, item.args || [], item.options || {}), item.problemMatcher || []));
 }, executeTask: async task => {
  const execution = { task, terminate: () => child.kill('SIGTERM') };
  const child = spawn(task.execution.process, task.execution.args, { cwd: task.execution.options.cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', bytes => output.push(bytes.toString())); child.stderr.on('data', bytes => output.push(bytes.toString()));
  child.once('error', () => { end.fire({ execution, exitCode: undefined }); ended.fire({ execution }); });
  child.once('exit', code => { end.fire({ execution, exitCode: code }); ended.fire({ execution }); });
  return execution;
 } } };
 const env = { YNX_WORKSPACE_MODE: 'local', YNX_LOCAL_WORKSPACE: root, YNX_LOCAL_PROJECT_ID: '12345678-1234-1234-1234-123456789abc' };
 const context = { subscriptions: [] }; registerCppRun(vscode, context, env);
 return { root, path, document, folder, vscode, env, errors, output, commands, end, ended };
}
test('normal first-use command chooses actual compiler, captures source despite editor welcome focus, and repeats a fresh build', async () => {
 const f = await fixture(); await writeFile(f.path, '#include <iostream>\nint main(){std::cout << "YNX first 42";}\n');
 await f.commands.get('ynx.cpp.runActive')(); assert.deepEqual(f.errors, []); assert.ok(f.output.includes('YNX first 42'));
 const config = JSON.parse(await readFile(join(f.root, '.vscode/tasks.json'))); assert.ok(config.tasks[0].args.includes('-g')); assert.ok(config.tasks[0].args.includes('-O0')); assert.ok(config.tasks[0].args.includes('-isysroot'));
 f.vscode.window.activeTextEditor = { document: f.document }; f.document.version++; await writeFile(f.path, '#include <iostream>\nint main(){std::cout << "YNX repeat 43";}\n');
 await f.commands.get('ynx.cpp.runActive')(); assert.deepEqual(f.errors, []); assert.ok(f.output.includes('YNX repeat 43'));
});
test('a failed rebuild never runs the previous actual native executable', async () => {
 const f = await fixture(); await writeFile(f.path, '#include <iostream>\nint main(){std::cout << "NEVER REPLAY";}\n');
 await f.commands.get('ynx.cpp.runActive')(); const binary = await readFile(join(f.root, 'main')); f.output.length = 0;
 f.vscode.window.activeTextEditor = { document: f.document }; await writeFile(f.path, 'int main(){INVALID_CPP;}');
 await f.commands.get('ynx.cpp.runActive')(); assert.match(f.errors[0], /Build failed/); assert.ok(!f.output.includes('NEVER REPLAY')); assert.deepEqual(await readFile(join(f.root, 'main')), binary);
});
test('Theia task and launch priority preserves commented user configs and does not create a shadow VSCode config', async () => {
 const f = await fixture(); await mkdir(join(f.root, '.theia')); const tasks = '// keep comments\n{"tasks":[]}'; await writeFile(join(f.root, '.theia/tasks.json'), tasks);
 const result = await createBuildTasks(f.root, {}); assert.equal(result.path, join(f.root, '.theia/tasks.json')); assert.equal(result.created, false); assert.equal(await readFile(result.path, 'utf8'), tasks);
 const launch = '// user launch\n{"configurations":[]}'; await writeFile(join(f.root, '.theia/launch.json'), launch);
 const debug = await createLaunchConfiguration(f.root, result.path, 'cpp'); assert.equal(debug.created, false); assert.equal(await readFile(debug.path, 'utf8'), launch);
});
test('project trust and path guard reject foreign source without reading its contents', async () => {
 const f = await fixture(), foreign = await mkdtemp('/private/tmp/ynx-cpp-foreign-'); await writeFile(f.path, 'int main(){}'); await writeFile(join(foreign, 'other.cpp'), 'int main(){}');
 f.document.uri.fsPath = join(foreign, 'other.cpp'); await assert.rejects(sourceContext(f.vscode, f.env), /Select a saved/);
 f.document.uri.fsPath = f.path; f.vscode.workspace.isTrusted = false; await assert.rejects(sourceContext(f.vscode, f.env), /trusted/);
});
test('fast task completion before executeTask promise and unrelated tasks are handled by execution identity', async () => {
 const end = emitter(), ended = emitter(), execution = {}, token = { isCancellationRequested: false, onCancellationRequested: emitter().event };
 const vscode = { tasks: { onDidEndTaskProcess: end.event, onDidEndTask: ended.event, executeTask: async () => { end.fire({ execution: {}, exitCode: 9 }); end.fire({ execution, exitCode: 0 }); ended.fire({ execution }); return execution; } } };
 assert.equal(await executeAndWait(vscode, {}, token), 0); assert.equal(end.count(), 0); assert.equal(ended.count(), 0);
});
test('cancellation terminates only the owned task and waits for its terminal event', async () => {
 const end = emitter(), ended = emitter(), cancel = emitter(); let calls = 0;
 const execution = { terminate() { calls++; ended.fire({ execution }); } }, token = { isCancellationRequested: false, onCancellationRequested: cancel.event };
 const vscode = { tasks: { onDidEndTaskProcess: end.event, onDidEndTask: ended.event, executeTask: async () => execution } };
 const pending = executeAndWait(vscode, {}, token); await Promise.resolve(); token.isCancellationRequested = true; cancel.fire();
 assert.equal(await pending, undefined); assert.equal(calls, 1); assert.equal(cancel.count(), 0);
});
test('first debug configuration keeps the real task association and refuses replacing existing launch', async () => {
 const f = await fixture(), tool = await installedCompiler({ sysroot: '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk', language: 'cpp' });
 const tasks = await createBuildTasks(f.root, tool), launch = await createLaunchConfiguration(f.root, tasks.path, 'cpp');
 assert.equal(launch.configuration.type, 'lldb-dap'); assert.equal(launch.configuration.preLaunchTask, 'YNX: Build active C++');
 const bytes = await readFile(launch.path); assert.equal((await createLaunchConfiguration(f.root, tasks.path, 'cpp')).created, false); assert.deepEqual(await readFile(launch.path), bytes);
});

test('same-name user build with successful exit and no product is never classified as a generated compiler task', async () => {
 const f = await fixture(); await writeFile(f.path, '#include <iostream>\nint main(){std::cout << "STALE MUST NOT RUN";}\n');
 await f.commands.get('ynx.cpp.runActive')(); f.output.length = 0;
 const path = join(f.root, '.vscode/tasks.json'), config = JSON.parse(await readFile(path));
 config.tasks[0].command = '/usr/bin/true'; config.tasks[0].args = []; config.tasks[0].options.cwd = f.root; await writeFile(path, JSON.stringify(config));
 f.vscode.window.activeTextEditor = { document: f.document }; let explicitPicker = false;
 f.vscode.window.showQuickPick = async (items, options) => { explicitPicker = /existing project task/.test(options.title); return items[0]; };
 await f.commands.get('ynx.cpp.runActive')(); assert.equal(explicitPicker, true); assert.ok(!f.output.includes('STALE MUST NOT RUN'));
 assert.ok(f.output.some(text => /Project task/.test(text))); assert.deepEqual(f.errors, []);
});
