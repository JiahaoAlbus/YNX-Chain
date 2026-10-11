import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, access, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const sourceCommit = 'a'.repeat(40), sourceTree = 'b'.repeat(40);
const valid = { schemaVersion: 1, productId: 'ynx-developer-v1', version: '0.2.0', sourceDirty: false,
  platform: `macos-${process.arch}`, sourceCommit, sourceTree, runtimeCheckpoint: sourceCommit };
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
    const desktop=join(root,'code/apps/developer/desktop');await mkdir(desktop,{recursive:true});
    await copyFile(new URL('./code-server.mjs',import.meta.url),join(root,'code-server.mjs'));
    await copyFile(new URL('./native-tools-client.mjs',import.meta.url),join(desktop,'native-tools-client.mjs'));
    await writeFile(join(root,'build-provenance.json'),JSON.stringify(valid));
    await writeFile(join(desktop,'local-go-selection.mjs'),'export async function createLocalGoSelectionStore(){throw Error("PUBLIC no Go selection");} export function attachNativeGoSelectionChannel(){}');
    await writeFile(join(desktop,'wallet-admission-startup.mjs'),`export async function openBundledWalletAdmission(){return {assertCurrent(){throw Error('four-op must not authorize tools');},nativeTools:{async openProject(binding){return {assertCurrent:async()=>({localProjectId:binding.projectId,workspace:binding.workspace,launch:binding.launch,sessionId:'22222222-1234-1234-1234-123456789abc',generation:'PUBLIC-generation',expiresAt:Date.now()+60000}),request:async request=>{console.log('PUBLIC_ROUTE '+request.path);return {};},close(){console.log('PUBLIC_CLOSED');}};}}};}`);
    if (!supplied) await writeFile(join(desktop,'wallet-admission-startup.mjs'),`export async function openBundledWalletAdmission(){return {nativeTools:{}};}`);
    await writeFile(join(desktop,'local-workbench.mjs'),`export async function localProjectContext(){return {id:'PUBLIC-project',workspace:'/PUBLIC/project'};} export async function startLocalWorkbench({aiTools}){if(!aiTools){console.log('PUBLIC_AI_UNAVAILABLE');return {exited:Promise.resolve({code:0}),stop:async()=>{}};}await aiTools.assertCurrent({projectId:'PUBLIC-project',workspace:'/PUBLIC/project',launch:'12345678-1234-1234-1234-123456789abc'});await aiTools.request('context',{});return {url:'http://127.0.0.1:0',id:'PUBLIC-project',workspace:'/PUBLIC/project',exited:Promise.resolve({code:0}),stop:async()=>{}};}`);
    const result=spawnSync(process.execPath,[join(root,'code-server.mjs')],{encoding:'utf8',timeout:10000,env:{PATH:'/usr/bin:/bin',YNX_DEVELOPER_DESKTOP_MODE:'local-workbench',YNX_CODE_DESKTOP_SUPPORT_DIR:join(root,'support')}});
    assert.equal(result.status,0,result.stderr);if(!supplied){assert.match(result.stdout,/PUBLIC_AI_UNAVAILABLE/);assert.match(result.stderr,/YNX_AI_NATIVE_TOOLS_NOT_SUPPLIED/);assert.doesNotMatch(result.stdout,/PUBLIC_ROUTE/);return;}assert.match(result.stdout,/PUBLIC_ROUTE \/runtime\/native-tools\/context\?sessionId=/);assert.match(result.stdout,/PUBLIC_CLOSED/);
  } finally {await rm(root,{recursive:true,force:true});}
});
