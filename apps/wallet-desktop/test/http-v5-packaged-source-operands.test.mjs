import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {relocateDesktopRuntimeSource,declaredSDKRuntimeSources} from '../scripts/release-provenance.mjs';
import {SDK49_NORMAL_VARIANT} from '../scripts/sdk49-normal-profile.mjs';
const root=fileURLToPath(new URL('../../..',import.meta.url)),version='1.3.0-pq.3.32-auth.49';
const own=['original-device-create-controller.mjs','original-device-query-controller.mjs','original-device-finalization-controller.mjs','original-runtime-image-preload.mjs'].map(f=>'apps/wallet-desktop/src/'+f);
test('normal current controller operands remain exact bytes and include the actual dynamic pre-load edge',()=>{
 for(const name of own){const raw=fs.readFileSync(path.join(root,name)),r=relocateDesktopRuntimeSource(name,raw,version,SDK49_NORMAL_VARIANT);assert(r.bytes.equals(raw));assert(r.operands.length>=1);}
 const r=relocateDesktopRuntimeSource(own[3],fs.readFileSync(path.join(root,own[3])),version,SDK49_NORMAL_VARIANT);assert.equal(r.operands[0].kind,'import');
});
test('unknown repository paths, duplicated edges and altered fixed imports still refuse',()=>{
 const name=own[3],raw=fs.readFileSync(path.join(root,name),'utf8'),edge="../../../packages/wallet-auth/src/original-auth-runtime-image-source-v1.js";
 assert.throws(()=>relocateDesktopRuntimeSource(name,Buffer.from(raw+"\nawait import('"+edge+"');"),version,SDK49_NORMAL_VARIANT),/operand count differs/);
 assert.throws(()=>relocateDesktopRuntimeSource(name,Buffer.from(raw.replace(edge,edge.replace('source-v1','foreign-v1'))),version,SDK49_NORMAL_VARIANT),/operand count differs/);
 assert.throws(()=>relocateDesktopRuntimeSource('apps/wallet-desktop/src/foreign.mjs',Buffer.from(raw),version,SDK49_NORMAL_VARIANT),/Unlisted repository operand/);
});
test('all current tracked Main and SDK src operands pass the closed source rules without source rewriting',()=>{
 const src=execFileSync('git',['ls-tree','-r','--name-only','HEAD','apps/wallet-desktop/src','packages/wallet-auth/src'],{cwd:root,encoding:'utf8'}).trim().split('\n');
 const names=[...new Set([...src,...declaredSDKRuntimeSources(root,'HEAD')])].filter(n=>/\.(mjs|js|cjs)$/.test(n)&&!n.endsWith('/operator-pq-identity.mjs'));
 for(const name of names){const raw=fs.readFileSync(path.join(root,name));assert(relocateDesktopRuntimeSource(name,raw,version,SDK49_NORMAL_VARIANT).bytes.equals(raw),name);}
 assert(names.length>590);
});
