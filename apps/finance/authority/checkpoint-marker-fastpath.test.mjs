import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalAuthorityV2} from '../../../sdk/js/endpoint-authority-v2.js';
import {createNodeCheckpointStore} from './checkpoint-node.mjs';
const marker='ynx-finance-endpoint-authority-checkpoint/v1\n';
const anchor={rootVersion:2,sequence:0,payloadSha256:'a'.repeat(64)};
const next={...anchor,sequence:1,payloadSha256:'b'.repeat(64)};
const transition=file=>file+'.from-'+createHash('sha256').update(canonicalAuthorityV2(anchor)).digest('hex');
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.homedir(),'.ynx-marker-fastpath-'));await fs.chmod(dir,0o700);t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'checkpoint'),store=createNodeCheckpointStore({file,anchor,trustedClockMs:10});await store.read();assert.equal(await store.compareAndSwap(anchor,next),true);return{dir,file,store};}
test('complete durable journal inspection performs no writes and preserves bytes/inodes/highwater',async t=>{
 const {dir,file,store}=await fixture(t);const names=(await fs.readdir(dir)).sort();const before=await Promise.all(names.map(async n=>({name:n,ino:(await fs.lstat(path.join(dir,n))).ino,bytes:await fs.readFile(path.join(dir,n))})));
 const open=fs.open;let writeAttempts=0;fs.open=async function(p,flags,...rest){if(String(p).startsWith(dir+'/')&&((typeof flags==='number'&&(flags&(constants.O_WRONLY|constants.O_RDWR|constants.O_CREAT)))||(typeof flags==='string'&&/[wa+]/u.test(flags)))){writeAttempts++;throw new Error('QA_UNEXPECTED_WRITE');}return open.call(this,p,flags,...rest);};
 try{assert.deepEqual(await store.inspect(),{schemaVersion:'ynx-finance-endpoint-authority-checkpoint/v1',checkpoint:next,trustedClockHighWaterMs:10});await assert.rejects(createNodeCheckpointStore({file,anchor,trustedClockMs:9}).inspect(),/AUTHORITY_V2_CLOCK_ROLLBACK/);assert.equal(writeAttempts,0);}finally{fs.open=open;}
 assert.deepEqual((await fs.readdir(dir)).sort(),names);for(const e of before){assert.equal((await fs.lstat(path.join(dir,e.name))).ino,e.ino);assert.deepEqual(await fs.readFile(path.join(dir,e.name)),e.bytes);}
});
test('missing committed marker retains exclusive durable publication and rejects lost transition',async t=>{
 const {file,store}=await fixture(t);const target=transition(file)+'.committed';await fs.unlink(target);const open=fs.open;let syncs=0;fs.open=async function(...args){const h=await open.apply(this,args);const sync=h.sync.bind(h);h.sync=async()=>{syncs++;return sync();};return h;};
 try{assert.deepEqual((await store.inspect()).checkpoint,next);assert.ok(syncs>=2);}finally{fs.open=open;}
 assert.equal((await fs.lstat(target)).nlink,1);assert.equal(await fs.readFile(target,'utf8'),marker);await fs.unlink(transition(file));await assert.rejects(store.inspect(),/CHECKPOINT_LOST/);
});
test('existing marker content, size, symlink and unrecognized hardlink failures remain closed',async t=>{
 for(const kind of ['wrong','zero','oversize','symlink','hardlink'])await t.test(kind,async sub=>{
  const {dir,file,store}=await fixture(sub);const target=file+'.initialized';await fs.unlink(target);
  if(kind==='symlink'){await fs.writeFile(path.join(dir,'outside'),marker,{mode:0o600});await fs.symlink(path.join(dir,'outside'),target);}
  else{await fs.writeFile(target,kind==='wrong'?'invalid\n':kind==='zero'?'':kind==='oversize'?'x'.repeat(131073):marker,{mode:0o600});if(kind==='hardlink')await fs.link(target,path.join(dir,'unrecognized-link'));}
  await assert.rejects(store.inspect(),/CHECKPOINT_(?:MARKER_INVALID|IDENTITY_INVALID)/);
 });
});
test('original interrupted-link repair failure and ancestor identity drift are not swallowed',async t=>{
 await t.test('repair failure',async sub=>{const {dir,file,store}=await fixture(sub);const target=file+'.initialized',tmp=path.join(dir,'.checkpoint.initialized.123.qa.tmp');await fs.link(target,tmp);const unlink=fs.unlink;fs.unlink=async function(p){if(p===tmp)throw Object.assign(new Error('QA_REPAIR_DENIED'),{code:'EACCES'});return unlink.call(this,p);};try{await assert.rejects(store.inspect(),{code:'EACCES'});}finally{fs.unlink=unlink;}assert.equal((await fs.lstat(target)).nlink,2);});
 await t.test('directory binding drift',async sub=>{const {dir,file,store}=await fixture(sub);const open=fs.open,lstat=fs.lstat;let markerReads=0;fs.open=async function(p,...rest){if(p===file+'.initialized')markerReads++;return open.call(this,p,...rest);};fs.lstat=async function(p,...rest){const s=await lstat.call(this,p,...rest);if(p===dir&&markerReads>=2)return Object.assign(Object.create(Object.getPrototypeOf(s)),s,{ino:s.ino+1});return s;};try{await assert.rejects(store.inspect(),/CHECKPOINT_DIRECTORY_CHANGED/);}finally{fs.open=open;fs.lstat=lstat;}});
});
