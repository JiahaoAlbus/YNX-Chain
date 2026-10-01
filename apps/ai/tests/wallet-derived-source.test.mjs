import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../../..');
const manifest=JSON.parse(fs.readFileSync(new URL('../web/vendor/wallet-connection-ai039-shared1a8.json',import.meta.url)));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('current consumer loads the exact reviewed AI039/shared1a8 derived bytes',()=>{
 const bytes=fs.readFileSync(path.join(root,manifest.output));
 assert.equal(bytes.length,562596);assert.equal(manifest.bytes,bytes.length);
 assert.equal(sha(bytes),'9b55c017830bbfdf67bf4715a00f15f172d596b0a2b22468e8ce4de32ffa1865');assert.equal(manifest.sha256,sha(bytes));
 assert.match(fs.readFileSync(new URL('../web/wallet-client.mjs',import.meta.url),'utf8'),/import\('\.\/vendor\/wallet-connection-ai039-shared1a8\.mjs'\)/);
 assert.equal(manifest.publicAccepted,false);assert.equal(manifest.privateApproved,false);
});
test('complete derived input graph binds every source blob to its immutable commit',()=>{
 assert.equal(manifest.inputs.length,784);const sources=manifest.inputs.filter(value=>value.sourceCommit);assert.equal(sources.length,25);
 for(const input of sources){assert.equal(input.sourceCommit,input.path===manifest.entry?manifest.aiEntryCommit:manifest.sharedCommit);const bytes=execFileSync('git',['show',input.sourceCommit+':'+input.path],{cwd:root});assert.equal(bytes.length,input.bytes);assert.equal(sha(bytes),input.sha256,input.path);}
 assert.equal(manifest.lockInputs.length,2);for(const lock of manifest.lockInputs){const bytes=execFileSync('git',['show',lock.sourceCommit+':'+lock.path],{cwd:root});assert.equal(sha(bytes),lock.sha256);}
 assert.equal(manifest.aiEntryCommit,'039b1b09465c99ccb1b02d57cee3a0fd875bda37');assert.equal(manifest.sharedCommit,'1a8daf15c92602283c37c975f338fb16b596bb23');
});
