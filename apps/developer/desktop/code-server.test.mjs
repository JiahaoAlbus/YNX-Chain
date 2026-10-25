import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, access, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { copyFileSync } from 'node:fs';
import {pathToFileURL} from 'node:url';

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
test('normal server refuses the legacy AI project mapping before any publication capture',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'ynx-publication-normal-caller-空 格-')));
  try{
    const desktop=join(root,'code/apps/developer/desktop'),sdk=join(root,'code/packages/wallet-auth'),workspace=join(root,'project');
    await mkdir(desktop,{recursive:true});await mkdir(sdk,{recursive:true});await mkdir(workspace);
    const artifact=join(workspace,'server.mjs');await writeFile(artifact,"console.log('PUBLIC artifact');\n");
    await copyParentControl(desktop);await copyFile(new URL('./code-server.mjs',import.meta.url),join(root,'server.mjs'));
    for(const name of ['artifact-publication-host.mjs','artifact-publication-client.mjs','original-publication-project.mjs','publication-result-originals.mjs'])await copyFile(new URL('./'+name,import.meta.url),join(desktop,name));
    await writeFile(join(root,'build-provenance.json'),JSON.stringify(valid));
    await writeFile(join(desktop,'local-go-selection.mjs'),'export async function createLocalGoSelectionStore(){throw Error("PUBLIC no Go");}export function attachNativeGoSelectionChannel(){}');
    await writeFile(join(desktop,'native-tools-client.mjs'),'export function createNativeToolsClient(){return null;}');
    await writeFile(join(desktop,'admitted-local-project.mjs'),'export function createAdmittedLocalProjectMapping(){return null;}');
    const state={owner:'PUBLIC-owner',workspaceOwner:'PUBLIC-owner',account:'PUBLIC-account',generation:1,identityReference:'PUBLIC-ref',localProjectId:'PUBLIC-project',workspace,launch:'PUBLIC-launch',sessionId:'PUBLIC-session',expiresAt:Date.now()+60000};
    await writeFile(join(desktop,'wallet-admission-startup.mjs'),`export async function openBundledWalletAdmission(){return {admittedProject:{assertCurrent:async()=>(${JSON.stringify(state)})}};}`);
    // Controlled DATA SDK doubles prove the normal loader/callback route only;
    // they do not qualify Native, a product session or an actual publisher.
    await writeFile(join(sdk,'package.json'),JSON.stringify({name:'@ynx-chain/wallet-auth',type:'module',exports:{'./original-ide-admission':{node:'./original.mjs'},'./ide-artifact-manifest':'./codec.mjs'}}));
    await writeFile(join(sdk,'codec.mjs'),'export const encodeIDEArtifactManifestData=input=>new TextEncoder().encode(JSON.stringify(input));');
    await writeFile(join(sdk,'original.mjs'),`let original;export function captureOriginalIDEPublicationArtifact(manifest,bytes){console.log('PUBLIC_CAPTURE');return original={manifest,bytes};}export function readOriginalIDEPublicationArtifactManifest(ref){if(ref!==original)throw Error('wrong ref');console.log('PUBLIC_READ');return ref.manifest;}export function closeOriginalIDEPublicationArtifact(ref){if(ref!==original)throw Error('wrong ref');console.log('PUBLIC_CLOSE');return true;}export function acquireOriginalIDEProtectedPublicationKeyCall(){throw Error('Preview must not select a key request');}`);
    const profile=join(root,'profile');await mkdir(profile,{mode:0o700});
    await writeFile(join(desktop,'local-workbench.mjs'),`export async function localProjectContext(){return {id:'PUBLIC-project',workspace:${JSON.stringify(workspace)},profile:${JSON.stringify(profile)}};}export async function startLocalWorkbench({openPublication}){const owner=await openPublication(await localProjectContext());let missing=false;try{await owner.preview({artifactURI:${JSON.stringify(pathToFileURL(artifact).href)},version:'0.1.0',publishPurpose:'PUBLIC-purpose',targetEnvironment:'PUBLIC-environment'});}catch(error){if(error.code!=='IDE_PUBLICATION_PROJECT_UNAVAILABLE')throw error;missing=true;}if(!missing)throw Error('Legacy AI mapping must not become a publication project');await owner.close();console.log('PUBLIC_PUBLICATION_NOT_SUPPLIED');return {exited:Promise.resolve({code:0}),stop:async()=>{}};}`);
    const result=spawnSync(process.execPath,[join(root,'server.mjs')],{encoding:'utf8',timeout:5000,env:{PATH:'/usr/bin:/bin',YNX_DEVELOPER_DESKTOP_MODE:'local-workbench',YNX_CODE_DESKTOP_SUPPORT_DIR:join(root,'support')}});
    assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/PUBLIC_PUBLICATION_NOT_SUPPLIED/);assert.doesNotMatch(result.stdout,/PUBLIC_CAPTURE|PUBLIC_READ|PUBLIC_CLOSE|PUBLIC_PREVIEW_COMPLETE/);
  }finally{await rm(root,{recursive:true,force:true});}
});
for(const outcome of ['canonical-preview','source-missing','publisher-missing'])test(`normal server original workspace selector ${outcome}`,async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'ynx-normal-workspace-selector-空 格-')));
 try{
  const desktop=join(root,'code/apps/developer/desktop'),sdk=join(root,'code/packages/wallet-auth'),workspace=join(root,'project'),profile=join(root,'profile');
  for(const directory of [desktop,sdk,workspace,profile])await mkdir(directory,{recursive:true,mode:0o700});
  const context={workspace,profile,id:'PUBLIC-local-uuid'},artifact=join(workspace,'server.mjs');await writeFile(artifact,"console.log('PUBLIC artifact');\n");
  await copyParentControl(desktop);await copyFile(new URL('./code-server.mjs',import.meta.url),join(root,'server.mjs'));
  for(const name of ['artifact-publication-host.mjs','artifact-publication-client.mjs','original-publication-project.mjs','publication-result-originals.mjs'])await copyFile(new URL('./'+name,import.meta.url),join(desktop,name));
  await writeFile(join(root,'build-provenance.json'),JSON.stringify(valid));
  await writeFile(join(desktop,'local-go-selection.mjs'),'export async function createLocalGoSelectionStore(){throw Error("PUBLIC no Go");}export function attachNativeGoSelectionChannel(){}');
  await writeFile(join(desktop,'native-tools-client.mjs'),'export function createNativeToolsClient(){return null;}');
  await writeFile(join(desktop,'admitted-local-project.mjs'),'export function createAdmittedLocalProjectMapping(){return null;}');
  await writeFile(join(desktop,'wallet-admission-startup.mjs'),`export async function openBundledWalletAdmission(){return {admittedProject:{assertCurrent(){throw Error('Legacy AI mapping must never be read');}}};}`);
  await writeFile(join(sdk,'package.json'),JSON.stringify({name:'@ynx-chain/wallet-auth',type:'module',exports:{'./original-ide-admission':{node:'./original.mjs'},'./ide-artifact-manifest':'./codec.mjs'}}));
  await writeFile(join(sdk,'codec.mjs'),'export const encodeIDEArtifactManifestData=input=>new TextEncoder().encode(JSON.stringify(input));');
  // Controlled contract doubles route the real server and fixed bundled
  // loader. They are not Native, signed Source, a registered publisher or QA.
  await writeFile(join(sdk,'original.mjs'),`
const context=${JSON.stringify(context)},mode=${JSON.stringify(outcome)},selector={},authority={},artifact={},expiresMS=Date.now()+60000;
const principal={account:'PUBLIC-account',deviceId:'PUBLIC-device',sessionRef:'PUBLIC-session',currentRef:'PUBLIC-current',accountGeneration:'1',sessionGeneration:'2',expiresMS};
const project={projectId:'PUBLIC-canonical-project',ownerAccount:'PUBLIC-owner',runtimeOrigin:'',currentReference:'PUBLIC-project-current',projectRevision:'3',catalogRevision:'4',read:false,publish:true,runtime:false,expiresMS};
const publisher={account:'PUBLIC-account',projectId:project.projectId,publisherId:'PUBLIC-publisher',keyRole:'ide-artifact-publisher',publicOriginal:'PUBLIC-original',publicSHA256:'PUBLIC-digest',registrationRef:'PUBLIC-registration',revision:'5',expiresMS,revoked:false};
export function acquireOriginalIDEWorkspaceProjectSelection(workspace,profile,localID){if(workspace!==context.workspace||profile!==context.profile||localID!==context.id)throw Error('Wrong original launch context');console.log('PUBLIC_SELECTOR_CAPTURE');if(mode==='source-missing')throw Object.assign(Error('PUBLIC original Source missing'),{code:'IDE_PROJECT_ORIGINAL_SOURCE_NOT_SUPPLIED'});return selector;}
export function readOriginalIDEWorkspaceProjectSelection(ref){if(ref!==selector)throw Error('Wrong selector ref');return Object.freeze({projectId:project.projectId,publisherId:mode==='publisher-missing'?null:publisher.publisherId,projectRevision:project.projectRevision,catalogRevision:project.catalogRevision,expiresMS});}
export function closeOriginalIDEWorkspaceProjectSelection(ref){if(ref!==selector)throw Error('Wrong selector close');console.log('PUBLIC_SELECTOR_CLOSE');}
export function acquireOriginalIDEProjectAuthority(){console.log('PUBLIC_PROJECT_CAPTURE');return authority;}
export function readOriginalIDECurrentProject(ref,id){if(ref!==authority||id!==project.projectId)throw Error('Local UUID was used as canonical identity');return {principal,project,expiresMS};}
export function readOriginalIDECurrentPublisher(ref,id,publisherID){if(ref!==authority||id!==project.projectId||publisherID!==publisher.publisherId)throw Error('Wrong canonical publisher');return {principal,project,publisher,publisherOriginal:new Uint8Array([1,2,3]),expiresMS};}
export function closeOriginalIDEProjectAuthority(ref){if(ref!==authority)throw Error('Wrong authority close');console.log('PUBLIC_PROJECT_CLOSE');}
export function captureOriginalIDEPublicationArtifact(manifest,bytes){const data=JSON.parse(manifest);if(data.projectId!==project.projectId||'localProjectId'in data||!bytes.length)throw Error('Wrong canonical artifact');artifact.manifest=manifest;console.log('PUBLIC_ARTIFACT_CAPTURE');return artifact;}
export function readOriginalIDEPublicationArtifactManifest(ref){if(ref!==artifact)throw Error('Wrong artifact ref');return artifact.manifest;}
export function closeOriginalIDEPublicationArtifact(ref){if(ref!==artifact)throw Error('Wrong artifact close');console.log('PUBLIC_ARTIFACT_CLOSE');return true;}
export function acquireOriginalIDEProtectedPublicationKeyCall(){console.log('PUBLIC_KEY_INVOKED');throw Error('Must not select a key during preview');}
`);
  await writeFile(join(desktop,'local-workbench.mjs'),`
export async function localProjectContext(){return ${JSON.stringify(context)};}
export async function startLocalWorkbench({openPublication}){
 const owner=await openPublication(await localProjectContext());console.log('PUBLIC_HOST_CREATED_LAZILY');
 try{const result=await owner.preview({artifactURI:${JSON.stringify(pathToFileURL(artifact).href)},version:'0.1.0',publishPurpose:'PUBLIC-purpose',targetEnvironment:'testnet'});
 if(${JSON.stringify(outcome)}!=='canonical-preview'||result.binding.projectId!=='PUBLIC-canonical-project'||result.signingApproved||result.deploymentApproved)throw Error('Wrong publication result');console.log('PUBLIC_CANONICAL_PREVIEW');
 }catch(cause){const expected=${JSON.stringify(outcome==='source-missing'?'IDE_PROJECT_ORIGINAL_SOURCE_NOT_SUPPLIED':outcome==='publisher-missing'?'IDE_PUBLICATION_PUBLISHER_UNAVAILABLE':null)};if(!expected||cause?.code!==expected)throw cause;console.log('PUBLIC_EXPECTED_'+expected);}
 await owner.close();await owner.close();return{exited:Promise.resolve({code:0}),stop:async()=>{}};
}`);
  const result=spawnSync(process.execPath,[join(root,'server.mjs')],{encoding:'utf8',timeout:5000,env:{PATH:'/usr/bin:/bin',YNX_DEVELOPER_DESKTOP_MODE:'local-workbench',YNX_CODE_DESKTOP_SUPPORT_DIR:join(root,'support')}});
  assert.equal(result.status,0,result.stderr);assert.doesNotMatch(result.stdout,/PUBLIC_KEY_INVOKED/);assert.ok(result.stdout.indexOf('PUBLIC_HOST_CREATED_LAZILY')<result.stdout.indexOf('PUBLIC_SELECTOR_CAPTURE'));
  if(outcome==='canonical-preview'){assert.match(result.stdout,/PUBLIC_CANONICAL_PREVIEW/);for(const token of ['PUBLIC_PROJECT_CAPTURE','PUBLIC_ARTIFACT_CAPTURE','PUBLIC_ARTIFACT_CLOSE','PUBLIC_PROJECT_CLOSE','PUBLIC_SELECTOR_CLOSE'])assert.equal(result.stdout.split(token).length-1,1,token);}
  else{assert.doesNotMatch(result.stdout,/PUBLIC_PROJECT_CAPTURE|PUBLIC_ARTIFACT_CAPTURE/);assert.match(result.stdout,/PUBLIC_EXPECTED_IDE_/);assert.equal(result.stdout.split('PUBLIC_SELECTOR_CLOSE').length-1,outcome==='publisher-missing'?1:0);}
 }finally{await rm(root,{recursive:true,force:true});}
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
    for(const file of ['wallet-admission-startup.mjs','wallet-admission-delivery.mjs','private-payload-pump.mjs','native-tools-client.mjs','admitted-local-project.mjs','project-contract-runtime.mjs','wallet-contract-client.mjs','wallet-contract-reference-journal.mjs','contract-relay-scope.mjs','project-contract-deployment.mjs','project-contract-execution.mjs'])await copyFile(new URL('./'+file,import.meta.url),join(desktop,file));
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
