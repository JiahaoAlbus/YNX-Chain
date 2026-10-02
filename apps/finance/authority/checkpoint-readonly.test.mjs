import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {canonicalAuthorityV2} from '../../../sdk/js/endpoint-authority-v2.js';
const source=await fs.readFile(new URL('./checkpoint-readonly.py',import.meta.url),'utf8');
// The production reader is fixed UID995. This local non-privileged fixture
// replaces only that assertion; actual FD/owner/mode/nlink guards still run.
assert.equal(source.split('assert uid==995').length,2);
const qaSource=source.replace('assert uid==995','assert uid==os.geteuid()');
const base=path.resolve('apps/finance/.readonly-root-anchor-qa-'+process.pid);
const schema='ynx-finance-endpoint-authority-checkpoint/v1',marker=Buffer.from(schema+'\n');
const old={rootVersion:2,sequence:54,payloadSha256:'a'.repeat(64)},next={...old,rootVersion:3};
const name=previous=>'checkpoint.from-'+createHash('sha256').update(canonicalAuthorityV2(previous)).digest('hex');
test('existing-only readonly journal accepts exact root upgrade and never creates or repairs markers',async t=>{
 await fs.mkdir(base,{mode:0o700});t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const run=()=>spawnSync('/usr/bin/python3',['-c',qaSource,path.join(base,'checkpoint'),'100'],{encoding:'utf8'});
 assert.notEqual(run().status,0);assert.deepEqual(await fs.readdir(base),[]);
 const write=(n,v)=>fs.writeFile(path.join(base,n),typeof v==='object'&&!Buffer.isBuffer(v)?canonicalAuthorityV2(v)+'\n':v,{mode:0o600});
 await write('checkpoint.genesis',{schemaVersion:'ynx-finance-endpoint-authority-checkpoint-genesis/v1',anchor:old,trustedClockHighWaterMs:0});await write('checkpoint.initialized',marker);
 const row={schemaVersion:'ynx-finance-endpoint-authority-checkpoint-transition/v1',previous:old,next,trustedClockHighWaterMs:90};
 await write(name(old),row);const before=(await fs.readdir(base)).sort();assert.notEqual(run().status,0);assert.deepEqual((await fs.readdir(base)).sort(),before);
 await write(name(old)+'.committed',marker);const good=run();assert.equal(good.status,0,good.stderr);assert.deepEqual(JSON.parse(good.stdout),next);
 for(const change of [x=>x.next.rootVersion=2,x=>x.next.rootVersion=1,x=>x.next.payloadSha256='b'.repeat(64),x=>x.next.sequence=53,x=>x.trustedClockHighWaterMs=-1]){
  const bad=structuredClone(row);change(bad);await write(name(old),bad);assert.notEqual(run().status,0);
 }
 await write(name(old),row);assert.equal(run().status,0);
 const bytes=await fs.readFile(path.join(base,name(old)));const tooEarly=spawnSync('/usr/bin/python3',['-c',qaSource,path.join(base,'checkpoint'),'89'],{encoding:'utf8'});assert.notEqual(tooEarly.status,0);assert.deepEqual(await fs.readFile(path.join(base,name(old))),bytes);
});
