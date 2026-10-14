import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('../../../services/language-service/node_modules/typescript/lib/typescript.js');
const { compile } = require('./ts-compile.cjs');
async function project(fn) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'ynx-ts-test-'));
  const file = path.join(root, 'hello.ts'), output = await fs.mkdtemp(path.join(root, '.ynx-ts-run-'));
  try { await fn({ root, file, output }); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
test('real retained compiler emits typed code, executes output and maps to original source', () => project(async ({ root, file, output }) => {
  await fs.writeFile(file, 'enum Answer { Value = 42 }; console.log(Answer.Value);\n');
  const emitted = compile(ts, root, file, output);
  assert.equal(execFileSync(process.execPath, [emitted], { encoding: 'utf8' }).trim(), '42');
  const map = JSON.parse(await fs.readFile(emitted + '.map', 'utf8'));
  assert.equal(path.resolve(output, map.sources[0]), file);
  assert.match(map.sourcesContent[0], /enum Answer/);
}));
test('actual tsconfig settings and imports are compiled without changing configured output', () => project(async ({ root, file, output }) => {
  await fs.writeFile(file, 'import { answer } from "./answer"; console.log(answer);');
  await fs.writeFile(path.join(root, 'answer.ts'), 'export const answer: number = 42;');
  const config = '{"compilerOptions":{"strict":true,"module":"CommonJS","outDir":"user-output"}}';
  await fs.writeFile(path.join(root, 'tsconfig.json'), config);
  const emitted = compile(ts, root, file, output);
  assert.equal(execFileSync(process.execPath, [emitted], { encoding: 'utf8' }).trim(), '42');
  assert.equal(await fs.readFile(path.join(root, 'tsconfig.json'), 'utf8'), config);
  await assert.rejects(fs.access(path.join(root, 'user-output')));
}));
test('type errors, noEmit and excluded entry never become runnable output', () => project(async ({ root, file, output }) => {
  await fs.writeFile(file, 'const answer: number = "bad";');
  assert.throws(() => compile(ts, root, file, output), /not assignable/);
  await fs.writeFile(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"noEmit":true}}');
  assert.throws(() => compile(ts, root, file, output), /does not emit/);
  await fs.writeFile(path.join(root, 'tsconfig.json'), '{"files":["other.ts"]}');
  await fs.writeFile(path.join(root, 'other.ts'), 'console.log(1)');
  assert.throws(() => compile(ts, root, file, output), /excluded/);
}));
test('project imports cannot read a symlinked source outside the workspace', () => project(async ({ root, file, output }) => {
  const outside = await fs.mkdtemp(path.join(tmpdir(), 'ynx-ts-outside-'));
  try {
    await fs.writeFile(path.join(outside, 'secret.ts'), 'export const secret = 42;');
    await fs.symlink(path.join(outside, 'secret.ts'), path.join(root, 'secret.ts'));
    await fs.writeFile(file, 'import {secret} from "./secret"; console.log(secret);');
    assert.throws(() => compile(ts, root, file, output), /Cannot find module/);
  } finally { await fs.rm(outside, { recursive: true, force: true }); }
}));
test('effective compiler default and nested NodeNext scopes stay runnable', () => project(async ({ root, file, output }) => {
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await fs.writeFile(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"target":"ES2022"}}');
  await fs.writeFile(file, 'export const answer: number = 42; console.log(answer);');
  assert.equal(execFileSync(process.execPath, [compile(ts, root, file, output)], { encoding: 'utf8' }).trim(), '42');
  const second = await fs.mkdtemp(path.join(root, '.ynx-ts-run-'));
  await fs.mkdir(path.join(root, 'nested'));
  await fs.writeFile(path.join(root, 'nested/package.json'), '{"type":"commonjs"}');
  await fs.writeFile(path.join(root, 'nested/answer.ts'), 'export const answer: number = 42;');
  await fs.writeFile(file, 'import {answer} from "./nested/answer.js"; console.log(answer);');
  await fs.writeFile(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"module":"NodeNext","target":"ES2022"}}');
  assert.equal(execFileSync(process.execPath, [compile(ts, root, file, second)], { encoding: 'utf8' }).trim(), '42');
}));
test('JSON package metadata import preserves its data and executes normally', () => project(async ({ root, file, output }) => {
  const metadata = { name: 'public-fixture', version: '1.2.3', custom: { answer: 42 } };
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(metadata));
  await fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'CommonJS', resolveJsonModule: true, esModuleInterop: true } }));
  await fs.writeFile(file, 'import metadata from "./package.json"; console.log(JSON.stringify(metadata));');
  const emitted = compile(ts, root, file, output);
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, [emitted], { encoding: 'utf8' })), metadata);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(output, 'package.json'), 'utf8')), metadata);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')), metadata);
}));
test('NodeNext declaration dependencies use their existing runtime package', () => project(async ({ root, file, output }) => {
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await fs.writeFile(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"module":"NodeNext","target":"ES2022"}}');
  const dependency = path.join(root, 'node_modules/public-answer');
  await fs.mkdir(dependency, { recursive: true });
  await fs.writeFile(path.join(dependency, 'package.json'), JSON.stringify({ name: 'public-answer', type: 'module', exports: { '.': { types: './index.d.ts', default: './index.js' } } }));
  await fs.writeFile(path.join(dependency, 'index.d.ts'), 'export declare const answer: number;');
  await fs.writeFile(path.join(dependency, 'index.js'), 'export const answer = 42;');
  await fs.writeFile(file, 'import {answer} from "public-answer"; console.log(answer);');
  const emitted = compile(ts, root, file, output);
  assert.equal(execFileSync(process.execPath, [emitted], { encoding: 'utf8' }).trim(), '42');
  await assert.rejects(fs.access(path.join(output, 'node_modules')));
}));
test('nested data-only package JSON does not control the importing CommonJS output', () => project(async ({ root, file, output }) => {
  const metadata = { type: 'module', version: '1.2.3', custom: { answer: 42 } };
  await fs.mkdir(path.join(root, 'fixtures'));
  await fs.writeFile(path.join(root, 'fixtures/package.json'), JSON.stringify(metadata));
  await fs.writeFile(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"module":"CommonJS","resolveJsonModule":true,"esModuleInterop":true}}');
  await fs.writeFile(file, 'import metadata from "./fixtures/package.json"; console.log(JSON.stringify(metadata));');
  const emitted = compile(ts, root, file, output);
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, [emitted], { encoding: 'utf8' })), metadata);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(output, 'fixtures/package.json'), 'utf8')), metadata);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'fixtures/package.json'), 'utf8')), metadata);
}));
test('conflicting imported metadata is diagnosed before writing output without changing user JSON', () => project(async ({ root, file, output }) => {
  const metadata = '{"type":"module","version":"1.2.3"}';
  await fs.writeFile(path.join(root, 'package.json'), metadata);
  await fs.writeFile(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"module":"CommonJS","resolveJsonModule":true,"esModuleInterop":true}}');
  await fs.writeFile(file, 'import metadata from "./package.json"; console.log(metadata.version);');
  assert.throws(() => compile(ts, root, file, output), /Imported package.json type conflicts/);
  assert.deepEqual(await fs.readdir(output), []);
  assert.equal(await fs.readFile(path.join(root, 'package.json'), 'utf8'), metadata);
}));
test('buffered emit still refuses to overwrite an existing run artifact', () => project(async ({ root, file, output }) => {
  await fs.writeFile(file, 'console.log(42);');
  const existing = path.join(output, 'hello.js');
  await fs.writeFile(existing, 'retained artifact');
  assert.throws(() => compile(ts, root, file, output), /EEXIST/);
  assert.equal(await fs.readFile(existing, 'utf8'), 'retained artifact');
}));
async function lifecycle(fn) {
  await project(async ({ root, file }) => {
    await fs.writeFile(file, 'console.log(42)');
    const uri = p => ({ scheme: 'file', fsPath: p });
    const document = { uri: uri(file), languageId: 'typescript', version: 1, isDirty: false, save: async () => true };
    const folder = { uri: uri(root) }, handlers = {}, calls = [], subscriptions = [], faults = {};
    const event = key => handler => { handlers[key] = handler; return { dispose() { delete handlers[key]; } }; };
    const emit = (key, value) => handlers[key]?.(value);
    // TEST_ONLY: actual Theia stopPlugin disposes subscriptions FIFO without awaiting them.
    const dispose = () => { for (const subscription of subscriptions) subscription.dispose(); };
    const api = { window: { activeTextEditor: { document } }, workspace: { isTrusted: true, getWorkspaceFolder: () => folder, saveAll: async () => true },
      extensions: { getExtension: () => ({ activate: async () => {} }) },
      ProcessExecution: class { constructor(command, args) { Object.assign(this, { command, args }); } },
      Task: class { constructor(definition, scope, name, source, execution) { Object.assign(this, { definition, scope, name, source, execution }); } },
      TaskRevealKind: { Always: 1 }, TaskPanelKind: { Shared: 1 },
      tasks: { onDidEndTaskProcess: event('process'), onDidEndTask: event('end'), executeTask: async task => {
        const execution = { task, terminate() { calls.push('terminate'); handlers.process({ execution, exitCode: 1 }); } };
        calls.push(execution); return execution;
      } },
      debug: { onDidStartDebugSession: event('start'), onDidTerminateDebugSession: event('debugEnd'),
        startDebugging: async (_, config) => { calls.push(config); handlers.start({ configuration: config }); return true; }, stopDebugging: async session => handlers.debugEnd(session) },
    };
    const module = { exports: {} }, filename = require.resolve('./ts-current-file.cjs');
    vm.runInNewContext(await fs.readFile(filename, 'utf8'), { module, process, __dirname: path.dirname(filename), require: id => id === 'node:fs/promises'
      ? { ...fs, rm: (...args) => faults.rm ? faults.rm(...args) : fs.rm(...args), access: name => name.includes('/runtime/typescript/') ? Promise.resolve() : fs.access(name) }
      : id === './guards.cjs' ? { ...require(id), assertWorkspacePath: async (...args) => {
        const result = await require(id).assertWorkspacePath(...args);
        faults.afterAdmission?.(...args);
        return result;
      } } : require(id) });
    const runner = module.exports.createTsCurrentFile(api, { subscriptions }, { YNX_WORKSPACE_MODE: 'local', YNX_LOCAL_WORKSPACE: root });
    const waitTask = async () => { for (let i = 0; i < 100 && !calls.length; i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(calls.length); return calls[0]; };
    try { await fn({ runner, api, handlers, calls, document, waitTask, emit, dispose, faults }); }
    finally { dispose(); }
  });
}
test('compile exit zero launches one matching mapped debugger and normal end cleans its artifacts', () => lifecycle(async f => {
  const running = f.runner.start(false), task = await f.waitTask();
  assert.equal(await f.runner.start(), false);
  const [root, file, output] = task.task.execution.args.slice(1);
  compile(ts, root, file, output);
  f.handlers.process({ execution: task, exitCode: 0 }); assert.equal(await running, true);
  const config = f.calls[1]; assert.equal(config.type, 'pwa-node'); assert.equal(config.console, 'integratedTerminal'); assert.equal(config.sourceMaps, true);
  f.handlers.debugEnd({ configuration: config });
  for (let i = 0; i < 100; i++) { try { await fs.access(output); } catch { return; } await new Promise(resolve => setImmediate(resolve)); }
  assert.fail('run artifacts remained after debugger end');
}));
test('cancel and late compile callback cannot launch a debugger or leave the run pending', () => lifecycle(async f => {
  const running = f.runner.start(), task = await f.waitTask(); f.runner.cancel();
  await assert.rejects(running, /cancelled/); assert.equal(f.calls[1], 'terminate');
  f.handlers.process({ execution: task, exitCode: 0 }); assert.equal(f.calls.length, 2);
}));
test('file switch during compilation prevents execution even after successful compiler exit', () => lifecycle(async f => {
  const running = f.runner.start(), task = await f.waitTask();
  f.api.window.activeTextEditor = undefined; f.handlers.process({ execution: task, exitCode: 0 });
  await assert.rejects(running, /active project or file changed/); assert.equal(f.calls.length, 1);
}));
test('debugger start rejection removes generated output and allows a retry', () => lifecycle(async f => {
  f.api.debug.startDebugging = async () => { throw Error('adapter unavailable'); };
  const running = f.runner.start(), task = await f.waitTask();
  const [root, file, output] = task.task.execution.args.slice(1); compile(ts, root, file, output);
  f.handlers.process({ execution: task, exitCode: 0 });
  await assert.rejects(running, /adapter unavailable/); await assert.rejects(fs.access(output));
  f.document.save = async () => false; assert.equal(await f.runner.start(), false);
}));
test('cancellation during debugger startup stops only the owned late session', () => lifecycle(async f => {
  let ready;
  f.api.debug.startDebugging = async (_, config) => {
    const session = { configuration: config }; f.calls.push(config);
    f.handlers.start(session);
    return new Promise(resolve => { ready = resolve; });
  };
  const running = f.runner.start(), task = await f.waitTask();
  const [root, file, output] = task.task.execution.args.slice(1); compile(ts, root, file, output);
  f.handlers.process({ execution: task, exitCode: 0 });
  for (let i = 0; i < 100 && !ready; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(ready); f.runner.cancel(); ready(true);
  await assert.rejects(running, /cancelled/); await assert.rejects(fs.access(output));
  assert.equal(f.calls.length, 2, 'one build and one owned launch, no unrelated execution');
}));

async function waitUntil(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('bounded TEST_ONLY lifecycle observation did not settle');
}
async function outputGone(output) { try { await fs.access(output); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } }
test('FIFO dispose during compilation waits for actual termination before removing artifacts', () => lifecycle(async f => {
  const running = f.runner.start(); const observed = running.then(() => 'resolved', e => e.message);
  const task = await f.waitTask(); const output = task.task.execution.args.at(-1);
  let terminations = 0; task.terminate = () => { terminations++; };
  f.dispose(); assert.equal(terminations, 1); await fs.access(output);
  f.emit('process', { execution: task, exitCode: 1 });
  let result; observed.then(value => { result = value; });
  await waitUntil(() => result !== undefined); assert.match(result, /cancelled/);
  await waitUntil(() => outputGone(output)); await waitUntil(() => Object.keys(f.handlers).length === 0);
  assert.equal(f.calls.length, 1, 'no debugger starts after disposal');
}));
test('FIFO dispose during launch stops exactly the owned late session and drains listeners', () => lifecycle(async f => {
  let config, complete; const stopped = [];
  f.api.debug.startDebugging = async (_, value) => { config = value; return new Promise(resolve => { complete = resolve; }); };
  f.api.debug.stopDebugging = async session => { stopped.push(session); f.emit('debugEnd', session); };
  const running = f.runner.start(); const observed = running.then(() => 'resolved', e => e.message);
  const task = await f.waitTask(); const [root, file, output] = task.task.execution.args.slice(1); compile(ts, root, file, output);
  f.emit('process', { execution: task, exitCode: 0 }); await waitUntil(() => complete);
  f.dispose(); const foreign = { configuration: { ynxTsRequest: 'foreign' } }; f.emit('start', foreign);
  const owned = { configuration: config }; f.emit('start', owned); complete(true);
  assert.match(await observed, /cancelled/); assert.deepEqual(stopped, [owned]);
  await waitUntil(() => outputGone(output)); await waitUntil(() => Object.keys(f.handlers).length === 0);
}));
test('FIFO dispose of active owned session retains termination listener until cleanup', () => lifecycle(async f => {
  let owned; const stopped = [];
  f.api.debug.startDebugging = async (_, config) => { owned = { configuration: config }; f.emit('start', owned); return true; };
  f.api.debug.stopDebugging = async session => { stopped.push(session); };
  const running = f.runner.start(), task = await f.waitTask(); const [root, file, output] = task.task.execution.args.slice(1); compile(ts, root, file, output);
  f.emit('process', { execution: task, exitCode: 0 }); assert.equal(await running, true);
  f.emit('start', { configuration: { ynxTsRequest: 'foreign' } }); f.dispose(); f.dispose();
  assert.deepEqual(stopped, [owned]); await fs.access(output); assert.ok(f.handlers.debugEnd);
  f.emit('debugEnd', owned); await waitUntil(() => outputGone(output)); await waitUntil(() => Object.keys(f.handlers).length === 0);
}));

test('cleanup rejection preserves the compilation cause and does not lock the next run', () => lifecycle(async f => {
  const cleanupError = Object.assign(Error('cleanup denied'), { code: 'EACCES' });
  f.faults.rm = async () => { throw cleanupError; };
  const running = f.runner.start(), task = await f.waitTask(); const output = task.task.execution.args.at(-1);
  f.emit('process', { execution: task, exitCode: 1 });
  await assert.rejects(running, error => /compilation failed/.test(error.message) && error.cleanupError === cleanupError);
  await fs.access(output);
  let saves = 0; f.document.save = async () => { saves++; return false; };
  assert.equal(await f.runner.start(), false); assert.equal(saves, 1, 'retry entered instead of returning from the stale pending gate');
}));

test('TypeScript saves only admitted project documents instead of the global save-all gate', () => lifecycle(async f => {
 const root=path.dirname(f.document.uri.fsPath),config=path.join(root,'tsconfig.json');await fs.writeFile(config,'{}');
 const saved=[];f.document.save=async()=>{saved.push('source');return true;};
 const projectConfig={uri:{scheme:'file',fsPath:config},version:1,isDirty:true,save:async()=>{saved.push('config');return false;}};
 const foreign={uri:{scheme:'file',fsPath:path.join(root,'..','outside.ts')},isDirty:true,save:async()=>{saved.push('foreign');throw Error('foreign document must not be saved');}};
 f.api.workspace.textDocuments=[f.document,projectConfig,foreign];f.api.workspace.saveAll=async()=>{saved.push('GLOBAL');return false;};
 assert.equal(await f.runner.start(),false);assert.deepEqual(saved,['source','config']);assert.equal(f.calls.length,0);
}));
test('cancel retires a pending TypeScript save before its reply and allows retry without late revival', () => lifecycle(async f => {
 let reply,result;const save=()=>new Promise(resolve=>reply=resolve);f.document.save=save;f.api.workspace.saveAll=save;
 const pending=f.runner.start().then(v=>{result=v;return v},e=>{result=e.message;return e.message});await waitUntil(()=>reply);f.runner.cancel();
 try{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));assert.match(result||'',/cancelled/);
  f.document.save=async()=>false;f.api.workspace.saveAll=async()=>false;assert.equal(await f.runner.start(),false);reply(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,0);
 }finally{reply(false);await pending;}
}));

test('dispose retires a pending save and releases listeners without waiting for its late reply', () => lifecycle(async f => {
 let reply;f.document.save=()=>new Promise(resolve=>reply=resolve);const running=f.runner.start();const observed=running.then(()=> 'unexpected',error=>error.message);await waitUntil(()=>reply);f.dispose();
 assert.match(await observed,/cancelled/);await waitUntil(()=>Object.keys(f.handlers).length===0);reply(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,0);
}));
test('closed or still dirty saved document blocks compilation and retry can enter the same runner', () => lifecycle(async f => {
 for(const state of ['closed','dirty']){
  f.document.isClosed=false;f.document.isDirty=false;f.document.save=async()=>{f.document.isClosed=state==='closed';f.document.isDirty=state==='dirty';return true;};
  await assert.rejects(f.runner.start(),/changed after saving/);assert.equal(f.calls.length,0);
 }
 f.document.isClosed=false;f.document.isDirty=false;f.document.save=async()=>false;assert.equal(await f.runner.start(),false);
}));
test('late reply from a cancelled save cannot release or cancel a newer compile', () => lifecycle(async f => {
 let reply;f.document.save=()=>new Promise(resolve=>reply=resolve);const first=f.runner.start().then(()=> 'unexpected',error=>error.message);await waitUntil(()=>reply);f.runner.cancel();assert.match(await first,/cancelled/);
 f.document.save=async()=>true;const retry=f.runner.start();const observed=retry.then(()=> 'unexpected',error=>error.message);const task=await f.waitTask();reply(true);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(await f.runner.start(),false,'new compile remains owned');assert.equal(f.calls.length,1);f.emit('process',{execution:task,exitCode:1});assert.match(await observed,/compilation failed/);
}));
test('saved source changing while another project document saves never starts compilation', () => lifecycle(async f => {
 const config=path.join(path.dirname(f.document.uri.fsPath),'tsconfig.json');await fs.writeFile(config,'{}');f.document.save=async()=>true;
 const other={uri:{scheme:'file',fsPath:config},version:1,isDirty:false,save:async()=>{f.document.version++;return true;}};f.api.workspace.textDocuments=[other];
 await assert.rejects(f.runner.start(),/changed after saving/);assert.equal(f.calls.length,0);
}));
test('trust or local project change during a save refuses continuation', () => lifecycle(async f => {
 f.document.save=async()=>{f.api.workspace.isTrusted=false;return true;};await assert.rejects(f.runner.start(),/trusted local TypeScript/);assert.equal(f.calls.length,0);
 f.api.workspace.isTrusted=true;f.document.save=async()=>{f.api.window.activeTextEditor=undefined;return true;};await assert.rejects(f.runner.start(),/active project or file changed/);assert.equal(f.calls.length,0);
}));
test('a symlinked document outside the admitted project is not saved', () => lifecycle(async f => {
 const root=path.dirname(f.document.uri.fsPath),outside=await fs.mkdtemp(path.join(tmpdir(),'ynx-ts-save-outside-'));try{
  await fs.writeFile(path.join(outside,'outside.ts'),'untouched');await fs.symlink(path.join(outside,'outside.ts'),path.join(root,'linked.ts'));let writes=0;
  f.api.workspace.textDocuments=[{uri:{scheme:'file',fsPath:path.join(root,'linked.ts')},version:1,isDirty:true,save:async()=>{writes++;return true;}}];
  await assert.rejects(f.runner.start(),/outside this project/);assert.equal(writes,0);assert.equal(f.calls.length,0);assert.equal(await fs.readFile(path.join(outside,'outside.ts'),'utf8'),'untouched');
 }finally{await fs.rm(outside,{recursive:true,force:true});}
}));

test('editing project notes during compilation does not invalidate the saved TypeScript inputs', () => lifecycle(async f => {
 const root=path.dirname(f.document.uri.fsPath),note=path.join(root,'README.md');await fs.writeFile(note,'notes');
 const readme={uri:{scheme:'file',fsPath:note},version:1,isDirty:false,save:async()=>true};f.api.workspace.textDocuments=[readme];
 const running=f.runner.start(),task=await f.waitTask();const [workspace,file,output]=task.task.execution.args.slice(1);compile(ts,workspace,file,output);
 readme.version++;readme.isDirty=true;f.emit('process',{execution:task,exitCode:0});assert.equal(await running,true);f.emit('debugEnd',{configuration:f.calls[1]});
}));

test('a project document moving during admission is never saved under its new path', () => lifecycle(async f => {
 const root=path.dirname(f.document.uri.fsPath),config=path.join(root,'tsconfig.json');await fs.writeFile(config,'{}');let writes=0;
 const other={uri:{scheme:'file',fsPath:config},version:1,isDirty:true,save:async()=>{writes++;return true;}};f.api.workspace.textDocuments=[other];
 f.faults.afterAdmission=file=>{if(file===config)other.uri.fsPath=path.join(root,'..','foreign.json');};
 await assert.rejects(f.runner.start(),/changed after saving/);assert.equal(writes,0);assert.equal(f.calls.length,0);
}));
