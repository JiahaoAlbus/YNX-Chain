import assert from 'node:assert/strict';
import {readFileSync,lstatSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const hash=b=>createHash('sha256').update(b).digest('hex');
const m=JSON.parse(readFileSync('apps/finance/evidence/financial-owner-release-inputs-20261003.json','utf8'));
assert.equal(m.inventory.length,76);
assert.equal(m.mismatches.length,12);
assert.equal(m.gates.deployable,false);
assert.equal(m.gates.goalComplete,false);
const paths=new Set();
for(const f of m.inventory){
 assert.match(f.path,/^apps\/(finance|exchange|quant-lab)\/web\//);
 assert.ok(!f.path.split('/').includes('..')); assert.ok(!paths.has(f.path)); paths.add(f.path);
 assert.ok(lstatSync(f.path).isFile()&&!lstatSync(f.path).isSymbolicLink());
 const b=readFileSync(f.path); assert.equal(b.length,f.bytes); assert.equal(hash(b),f.sha256);
 assert.equal(execFileSync('git',['rev-parse',m.reviewedSource.commit+':'+f.path],{encoding:'utf8'}).trim(),f.blob);
}
for(const f of m.mismatches){assert.equal(m.inventory.find(i=>i.path===f.path)?.sha256,f.expected);assert.notEqual(f.declared,f.expected);}
let binariesVerified=0;
for(const f of m.builds){
 assert.equal(f.installed,false); assert.equal(f.published,false);
 if(!existsSync(f.path))continue;
 assert.ok(lstatSync(f.path).isFile()&&!lstatSync(f.path).isSymbolicLink());
 const b=readFileSync(f.path); assert.equal(b.length,f.bytes); assert.equal(hash(b),f.sha256);
 assert.equal(b.subarray(0,4).toString('hex'),'7f454c46');assert.equal(b[4],2);assert.equal(b.readUInt16LE(18),62);binariesVerified++;
}
console.log(JSON.stringify({trackedInputsVerified:paths.size,directPageBindingDiscrepancies:m.mismatches.length,binariesVerified,deployable:false,publicSourceBound:false}));
