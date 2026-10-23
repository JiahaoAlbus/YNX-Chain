import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, access, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { copyFileSync } from 'node:fs';

const sourceCommit = 'a'.repeat(40), sourceTree = 'b'.repeat(40);
const valid = { schemaVersion: 1, productId: 'ynx-developer-v1', version: '0.2.0', sourceDirty: false,
  platform: `macos-${process.arch}`, sourceCommit, sourceTree, runtimeCheckpoint: sourceCommit };
async function copyParentControl(desktop) { await copyFile(new URL('./native-parent-control.mjs',import.meta.url),join(desktop,'native-parent-control.mjs')); }
async function launch(record, inspect, bundledTools = false) {
  const root = await mkdtemp(join(tmpdir(), 'ynx-desktop-provenance-'));
  try {
    const gateway = join(root, 'code/apps/developer/services/gateway/src');
    await mkdir(gateway, { recursive: true });
    await copyFile(new URL('./code-server.mjs', import.meta.url), join(root, 'code-server.mjs'));
    if (record !== undefined) await writeFile(join(root, 'build-provenance.json'), JSON.stringify(record));
    // Exercise the actual launcher through its normal bundled gateway import.
    // This stub observes startup inputs; it does not claim native runtime health.
    if (bundledTools) {
      const bin = join(root, 'code/apps/developer/node_modules/.bin'); await mkdir(bin, { recursive: true });
      await writeFile(join(bin, 'ynx-bundled-language-probe'), '#!/usr/bin/env node\nconsole.log("bundled-language-server-found");\n', { mode: 0o700 });
      await writeFile(join(gateway, 'server.mjs'), `import {execFileSync} from 'node:child_process';console.log(JSON.stringify({toolPath:process.env.PATH.split(':').slice(0,2),probe:execFileSync('ynx-bundled-language-probe',[],{encoding:'utf8'}).trim()}));`);
    } else await writeFile(join(gateway, 'server.mjs'), `console.log(JSON.stringify({sourceCommit:process.env.YNX_CODE_SOURCE_COMMIT,sourceTree:process.env.YNX_CODE_SOURCE_TREE,release:process.env.YNX_CODE_RELEASE,host:process.env.HOST}));`);
    const support = join(root, 'support');
    const result = spawnSync(process.execPath, [join(root, 'code-server.mjs')], { encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', YNX_CODE_DESKTOP_SUPPORT_DIR: support, YNX_CODE_SOURCE_COMMIT: 'c'.repeat(40),
        YNX_CODE_SOURCE_TREE: 'd'.repeat(40), YNX_CODE_RELEASE: 'spoofed' } });
    await inspect(result, support);
  } finally { await rm(root, { recursive: true, force: true }); }
}
test('actual bundled launcher binds source and release, overriding inherited labels', async () => {
  await launch(valid, async (result, support) => {
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { sourceCommit, sourceTree, release: `0.2.0-testnet-preview-${sourceCommit.slice(0,12)}`, host: '127.0.0.1' });
    assert.match((await readFile(join(support, 'workspace-session.key'), 'utf8')).trim(), /^[a-f0-9]{64}$/);
  });
});

for (const outcome of ['normal-exit', 'startup-failure']) test(`PUBLIC inherited admission normal server retires and finishes ${outcome}`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ynx-public-admission-normal-caller-'));
  const desktop = join(root, 'code/apps/developer/desktop');
  const events = [], oldMode = process.env.YNX_DEVELOPER_DESKTOP_MODE, oldSupport = process.env.YNX_CODE_DESKTOP_SUPPORT_DIR;
  const oldExit = process.exitCode;
  try {
    await mkdir(desktop, { recursive: true });
    await copyParentControl(desktop);
    // Optional source path is ONLY a PUBLIC parent behavioral control in this
    // test. It never selects the production supplier, authority or App entry.
    copyFileSync(process.env.YNX_PUBLIC_PARENT_CONTROL_SOURCE || new URL('./code-server.mjs', import.meta.url), join(root, 'server.mjs'));
    await writeFile(join(root, 'build-provenance.json'), JSON.stringify(valid));
    globalThis.__ynxPublicAdmissionEvents = events;
    await writeFile(join(desktop, 'local-go-selection.mjs'), 'export async function createLocalGoSelectionStore(){return {async load(){return null;}}} export function attachNativeGoSelectionChannel(){}');
    await writeFile(join(desktop, 'wallet-admission-startup.mjs'), `let retired=false;export async function openBundledWalletAdmission(){return {assertCurrent(){if(retired)throw Error('PUBLIC_RETIRED');},close(){if(!retired){retired=true;globalThis.__ynxPublicAdmissionEvents.push('retire');}},async finishCleanup(){if(!retired)throw Error('PUBLIC_NOT_RETIRED');globalThis.__ynxPublicAdmissionEvents.push('finish');return {complete:true};}};}`);
    await writeFile(join(desktop, 'native-tools-client.mjs'), 'export function createNativeToolsClient(){return null;}');
    await writeFile(join(desktop, 'admitted-local-project.mjs'), 'export function createAdmittedLocalProjectMapping(){return null;}');
    await writeFile(join(desktop, 'local-workbench.mjs'), `export async function localProjectContext(){return {id:'PUBLIC',workspace:'/PUBLIC'};}export async function startLocalWorkbench({walletAdmission}){await walletAdmission.assertCurrent();globalThis.__ynxPublicAdmissionEvents.push('start');${outcome === 'startup-failure' ? "throw Error('PUBLIC_STARTUP_FAILURE');" : "return {exited:Promise.resolve({code:0}),async stop(){globalThis.__ynxPublicAdmissionEvents.push('stop');await Promise.resolve();await Promise.resolve().then(()=>walletAdmission.assertCurrent()).then(()=>{throw Error('PUBLIC_LATE_CAPABILITY');},()=>{});}};"}}`);
    process.env.YNX_DEVELOPER_DESKTOP_MODE = 'local-workbench'; process.env.YNX_CODE_DESKTOP_SUPPORT_DIR = join(root, 'PUBLIC-support');
    const call = import(new URL('file://' + join(root, 'server.mjs')).href);
    if (outcome === 'startup-failure') await assert.rejects(call, /PUBLIC_STARTUP_FAILURE/); else await call;
    assert.deepEqual(events, outcome === 'startup-failure' ? ['start', 'retire', 'finish'] : ['start', 'retire', 'stop', 'finish']);
  } finally {
    if (oldMode === undefined) delete process.env.YNX_DEVELOPER_DESKTOP_MODE; else process.env.YNX_DEVELOPER_DESKTOP_MODE = oldMode;
    if (oldSupport === undefined) delete process.env.YNX_CODE_DESKTOP_SUPPORT_DIR; else process.env.YNX_CODE_DESKTOP_SUPPORT_DIR = oldSupport;
    process.exitCode = oldExit; delete globalThis.__ynxPublicAdmissionEvents;
    await rm(root, { recursive: true, force: true });
  }
});
test('Finder-like minimal PATH discovers bundled language tools and their exact Node interpreter', async () => {
  await launch(valid, async (result, support) => {
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { toolPath: [dirname(process.execPath), join(await realpath(dirname(support)), 'code/apps/developer/node_modules/.bin')], probe: 'bundled-language-server-found' });
  }, true);
});
for (const [name, record] of [
  ['missing metadata', undefined], ['historical checkpoint', { ...valid, runtimeCheckpoint: 'c'.repeat(40) }],
  ['inexact commit', { ...valid, sourceCommit: 'abc' }], ['inexact tree', { ...valid, sourceTree: null }],
  ['wrong product', { ...valid, productId: 'another-product' }], ['dirty source', { ...valid, sourceDirty: true }],
  ['wrong architecture', { ...valid, platform: 'linux-x64' }], ['wrong schema', { ...valid, schemaVersion: 2 }],
]) test(`${name} fails before creating user state`, async () => {
  await launch(record, async (result, support) => {
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    await assert.rejects(access(support), { code: 'ENOENT' });
  });
});
for (const supplied of [true,false]) test('normal local launcher ' + (supplied ? 'injects independent supply and closes it' : 'keeps local development available with malformed AI supply'), async () => {
  const root=await mkdtemp(join(tmpdir(),'ynx-public-native-tools-startup-'));
  try {
    const desktop=join(root,'code/apps/developer/desktop');await mkdir(desktop,{recursive:true});await copyParentControl(desktop);
    await copyFile(new URL('./code-server.mjs',import.meta.url),join(root,'code-server.mjs'));
    await copyFile(new URL('./native-tools-client.mjs',import.meta.url),join(desktop,'native-tools-client.mjs'));
    await copyFile(new URL('./admitted-local-project.mjs',import.meta.url),join(desktop,'admitted-local-project.mjs'));
    await writeFile(join(root,'build-provenance.json'),JSON.stringify(valid));
    await writeFile(join(desktop,'local-go-selection.mjs'),'export async function createLocalGoSelectionStore(){throw Error("PUBLIC no Go selection");} export function attachNativeGoSelectionChannel(){}');
    await writeFile(join(desktop,'wallet-admission-startup.mjs'),`const deadline=Date.now()+60000;const canonical={owner:'a'.repeat(64),workspaceOwner:'a'.repeat(64),account:'PUBLIC',generation:1,identityReference:'a'.repeat(43),localProjectId:'PUBLIC-canonical',workspace:'/PUBLIC/project',launch:'22222222-1234-1234-1234-123456789abc',sessionId:'22222222-1234-1234-1234-123456789abc',expiresAt:deadline};export async function openBundledWalletAdmission(){return {assertCurrent(){throw Error('four-op must not authorize tools');},admittedProject:{assertCurrent:async()=>canonical,request(){throw Error('Tools authority must own dispatch');},close(){console.log('PUBLIC_PROJECT_CLOSED');}},nativeTools:{async openProject(binding){if(binding.projectId!=='PUBLIC-canonical')throw Error('Local id must not be used as canonical');return {assertCurrent:async()=>({...canonical,generation:'1'}),request:async request=>{console.log('PUBLIC_ROUTE '+request.path);return {};},close(){console.log('PUBLIC_CLOSED');}};}}};}`);
    if (!supplied) await writeFile(join(desktop,'wallet-admission-startup.mjs'),`export async function openBundledWalletAdmission(){return {nativeTools:{}};}`);
    await writeFile(join(desktop,'local-workbench.mjs'),`export async function localProjectContext(){return {id:'PUBLIC-project',workspace:'/PUBLIC/project'};} export async function startLocalWorkbench({aiTools}){if(!aiTools){console.log('PUBLIC_AI_UNAVAILABLE');return {exited:Promise.resolve({code:0}),stop:async()=>{}};}await aiTools.assertCurrent({projectId:'PUBLIC-project',workspace:'/PUBLIC/project',launch:'12345678-1234-1234-1234-123456789abc'});await aiTools.request('context',{});return {url:'http://127.0.0.1:0',id:'PUBLIC-project',workspace:'/PUBLIC/project',exited:Promise.resolve({code:0}),stop:async()=>{}};}`);
    const result=spawnSync(process.execPath,[join(root,'code-server.mjs')],{encoding:'utf8',timeout:10000,env:{PATH:'/usr/bin:/bin',YNX_DEVELOPER_DESKTOP_MODE:'local-workbench',YNX_CODE_DESKTOP_SUPPORT_DIR:join(root,'support')}});
    assert.equal(result.status,0,result.stderr);if(!supplied){assert.match(result.stdout,/PUBLIC_AI_UNAVAILABLE/);assert.match(result.stderr,/YNX_AI_NATIVE_TOOLS_NOT_SUPPLIED/);assert.doesNotMatch(result.stdout,/PUBLIC_ROUTE/);return;}assert.match(result.stdout,/PUBLIC_ROUTE \/runtime\/native-tools\/context\?sessionId=/);assert.match(result.stdout,/PUBLIC_CLOSED/);
  } finally {await rm(root,{recursive:true,force:true});}
});

for (const scenario of ['incomplete', 'async-close', 'missing-tools', 'launch-failure', 'cleanup-failure', 'launch-and-cleanup-failure']) test(`normal local launcher retains cleanup through ${scenario}`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ynx-public-cleanup-launcher-'));
  try {
    const desktop = join(root, 'code/apps/developer/desktop');
    await mkdir(desktop, { recursive: true });
    await copyParentControl(desktop);
    await copyFile(new URL('./code-server.mjs', import.meta.url), join(root, 'code-server.mjs'));
    for (const file of ['native-tools-client.mjs', 'admitted-local-project.mjs']) await copyFile(new URL(`./${file}`, import.meta.url), join(desktop, file));
    await writeFile(join(root, 'build-provenance.json'), JSON.stringify(valid));
    await writeFile(join(desktop, 'local-go-selection.mjs'), 'export async function createLocalGoSelectionStore(){throw Error("PUBLIC no Go selection");} export function attachNativeGoSelectionChannel(){}');
    // Public fixture at the normal supplier boundary. The actual launcher and
    // mapping must observe original cleanup, even when startup fails or Tools
    // is absent. This is source integration, not native App acceptance.
    await writeFile(join(desktop, 'wallet-admission-startup.mjs'), `
      let closes=0;
      const project={assertCurrent(){throw Error('not used by this fixture');},request(){throw Error('no dispatch');},
        close(){if(++closes!==1)throw Error('PUBLIC_DUPLICATE_CLOSE');console.log('PUBLIC_CLOSE');
          ${scenario === 'async-close' ? "return Promise.resolve().then(()=>{console.log('PUBLIC_ASYNC_OBSERVED');return {complete:true};});" : 'return {complete:false,outstanding:1,errors:[]};'}},
        async finishCleanup(){console.log('PUBLIC_FINISH');${scenario.includes('cleanup-failure') ? "throw Error('PUBLIC_CLEANUP_FAILURE');" : 'return {complete:true,outstanding:0,errors:[]};'}}};
      export async function openBundledWalletAdmission(){return {admittedProject:project${scenario === 'missing-tools' ? '' : ',nativeTools:{openProject(){throw Error("not entered");}}'}};}
    `);
    await writeFile(join(desktop, 'local-workbench.mjs'), `
      export async function localProjectContext(){return {id:'PUBLIC-project',workspace:'/PUBLIC/project'};}
      export async function startLocalWorkbench(){${scenario.startsWith('launch-') ? "throw Object.assign(Error('PUBLIC_PRIMARY_LAUNCH_FAILURE'),{code:'PUBLIC_PRIMARY'});" : "return {exited:Promise.resolve({code:0}),stop:async()=>{console.log('PUBLIC_STOP');}};"}}
    `);
    const result = spawnSync(process.execPath, [join(root, 'code-server.mjs')], {encoding:'utf8',timeout:10000,
      env:{PATH:'/usr/bin:/bin',YNX_DEVELOPER_DESKTOP_MODE:'local-workbench',YNX_CODE_DESKTOP_SUPPORT_DIR:join(root,'support')}});
    assert.equal(result.error, undefined);
    if (scenario.startsWith('launch-')) { assert.notEqual(result.status,0); assert.match(result.stderr,/PUBLIC_PRIMARY_LAUNCH_FAILURE/); }
    else assert.equal(result.status,scenario.includes('cleanup-failure') ? 1 : 0,result.stderr);
    assert.equal(result.stdout.split('PUBLIC_CLOSE').length-1,1,result.stdout);
    assert.match(result.stdout, scenario === 'async-close' ? /PUBLIC_ASYNC_OBSERVED/ : /PUBLIC_FINISH/);
    if (scenario === 'async-close') assert.doesNotMatch(result.stdout,/PUBLIC_FINISH/);
    if (scenario.includes('cleanup-failure')) assert.match(result.stderr,/YNX_AI_CLEANUP_INCOMPLETE/);
    else assert.doesNotMatch(result.stderr,/YNX_AI_CLEANUP_INCOMPLETE/);
    assert.doesNotMatch(result.stderr,/PUBLIC_DUPLICATE_CLOSE/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

for (const cleanup of ['false-rejection','incomplete-result','clean']) test('P2 repair actual normal startup and server retain partial cleanup ' + cleanup, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ynx-public-partial-owner-'));
  const oldMode=process.env.YNX_DEVELOPER_DESKTOP_MODE, oldSupport=process.env.YNX_CODE_DESKTOP_SUPPORT_DIR, oldExit=process.exitCode, oldError=console.error;
  const events=[], logs=[]; globalThis.__ynxP2Events=events;
  try {
    const desktop=join(root,'code/apps/developer/desktop'), vendor=join(root,'code/packages/wallet-auth/scripts');
    await mkdir(desktop,{recursive:true});await mkdir(vendor,{recursive:true});
    await copyFile(new URL('./code-server.mjs',import.meta.url),join(root,'server.mjs'));
    for(const file of ['wallet-admission-startup.mjs','wallet-admission-delivery.mjs','private-payload-pump.mjs','native-tools-client.mjs','admitted-local-project.mjs','project-contract-runtime.mjs','wallet-contract-client.mjs','wallet-contract-reference-journal.mjs','contract-relay-scope.mjs','project-contract-deployment.mjs'])await copyFile(new URL('./'+file,import.meta.url),join(desktop,file));
    await copyParentControl(desktop);
    await writeFile(join(root,'build-provenance.json'),JSON.stringify(valid));
    await writeFile(join(desktop,'local-go-selection.mjs'),"export async function createLocalGoSelectionStore(){throw Error('PUBLIC no Go');}export function attachNativeGoSelectionChannel(){}");
    await writeFile(join(vendor,'ynx-ide-service-admission-supplier.mjs'),
      "export function acquireOriginalIDEAdmissionParentDelivery(){return {descriptor:4,assertCurrent(){throw Error('PUBLIC_FIRST');},close(){globalThis.__ynxP2Events.push('close');"+(cleanup==='false-rejection'?"return Promise.reject(false);":cleanup==='incomplete-result'?"return {complete:false};":"")+"}};}export function openOriginalIDEServiceAdmissionSupplier(){throw Error('must not reacquire');}");
    await writeFile(join(desktop,'local-workbench.mjs'),"export function localProjectContext(){return {id:'PUBLIC',workspace:'/PUBLIC'};}export async function startLocalWorkbench({walletAdmission}){try{walletAdmission.assertCurrent();throw Error('must refuse');}catch(e){if(e.message!=='PUBLIC_FIRST')throw e;}globalThis.__ynxP2Events.push('local');return {exited:Promise.resolve({code:0}),stop(){globalThis.__ynxP2Events.push('stop');}};}");
    console.error=(...a)=>logs.push(a.join(' '));process.env.YNX_DEVELOPER_DESKTOP_MODE='local-workbench';process.env.YNX_CODE_DESKTOP_SUPPORT_DIR=join(root,'support');
    await import(new URL('file://'+join(root,'server.mjs')).href);
    assert.equal(events.filter(x=>x==='close').length,1);assert.ok(events.includes('local'));assert.ok(events.includes('stop'));
    assert.equal(process.exitCode,cleanup==='clean'?0:1);
    assert.equal(logs.some(s=>s.includes('YNX_WALLET_ADMISSION_CLEANUP_INCOMPLETE')),cleanup!=='clean');
  } finally {
    console.error=oldError;process.exitCode=oldExit;delete globalThis.__ynxP2Events;
    if(oldMode===undefined)delete process.env.YNX_DEVELOPER_DESKTOP_MODE;else process.env.YNX_DEVELOPER_DESKTOP_MODE=oldMode;
    if(oldSupport===undefined)delete process.env.YNX_CODE_DESKTOP_SUPPORT_DIR;else process.env.YNX_CODE_DESKTOP_SUPPORT_DIR=oldSupport;
    await rm(root,{recursive:true,force:true});
  }
});
