import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {declaredSDKRuntimeSources,relocateDesktopRuntimeSource} from '../scripts/release-provenance.mjs';
function fixture(t,files,entries){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-declared-runtime-public-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const base=path.join(root,'packages/wallet-auth');fs.mkdirSync(base,{recursive:true});fs.writeFileSync(path.join(base,'package.json'),JSON.stringify({files}));for(const[name,body]of Object.entries(entries)){const p=path.join(base,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,body);}const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'});git('init','-q');git('add','.');git('-c','user.name=PUBLIC fixture','-c','user.email=public@example.invalid','-c','commit.gpgsign=false','commit','-qm','PUBLIC runtime classification');return{root};}
test('an existing explicitly declared materialization Markdown document is source documentation, not a missing runtime module',t=>{
 const f=fixture(t,['scripts/NORMAL_RUNTIME_MATERIALIZATION.md','scripts/worker.mjs','native/types.h','scripts/api.d.ts'],{'scripts/NORMAL_RUNTIME_MATERIALIZATION.md':'# PUBLIC documentation\n','scripts/worker.mjs':'export const publicData=true;','native/types.h':'// PUBLIC header','scripts/api.d.ts':'export declare const publicData:boolean;'});
 assert.deepEqual(declaredSDKRuntimeSources(f.root,'HEAD'),['packages/wallet-auth/scripts/worker.mjs']);
});
test('document classification never allows an absent declared source, missing JavaScript, unsupported asset or escaped scope',t=>{
 for(const [declared,entries]of[['scripts/missing.md',{}],['scripts/missing.mjs',{}],['scripts/unknown.wasm',{'scripts/unknown.wasm':'PUBLIC'}],['scripts/../foreign.md',{'foreign.md':'PUBLIC'}]]){const f=fixture(t,[declared],entries);assert.throws(()=>declaredSDKRuntimeSources(f.root,'HEAD'));}
});
test('actual immutable A31 full selected runtime operands pass without editing supplier files or executing Native',{skip:!process.env.WALLET_ACTUAL_SOURCE_ROOT},()=>{
 const root=process.env.WALLET_ACTUAL_SOURCE_ROOT,git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:64<<20}).trim(),head=git('rev-parse','HEAD'),version=JSON.parse(git('show',head+':packages/wallet-auth/package.json')).version;assert.equal(version,'1.3.0-pq.3.32-auth.31');
 const names=[...new Set([...git('ls-tree','-r','--name-only',head,'--','apps/wallet-desktop/src','packages/wallet-auth/src').split('\n'),...declaredSDKRuntimeSources(root,head)].filter(n=>/\.(?:js|mjs|cjs|json)$/.test(n)&&!n.endsWith('.test.mjs')))];
 const packed=execFileSync('git',['cat-file','--batch'],{cwd:root,input:names.map(name=>head+':'+name+'\n').join(''),maxBuffer:64<<20});let at=0;const rows=[];
 for(const name of names){const end=packed.indexOf(10,at),match=/^[a-f0-9]{40} blob ([0-9]+)$/.exec(packed.subarray(at,end).toString());assert(match,name);const size=Number(match[1]),body=packed.subarray(end+1,end+1+size);at=end+size+2;assert(relocateDesktopRuntimeSource(name,body,version).bytes.equals(body),name);assert(fs.readFileSync(path.join(root,name)).equals(body),name);rows.push({path:name,bytes:size,sha256:createHash('sha256').update(body).digest('hex')});}
 assert.equal(at,packed.length);assert(rows.length>200);console.log('ACTUAL_A31_SELECTED_RUNTIME_OPERANDS',JSON.stringify({head,version,checked:rows.length,NativeExecuted:false,sourceBytesChanged:false}));
});
