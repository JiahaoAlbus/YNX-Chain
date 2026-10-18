import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateCandidate} from '../../release/integration/candidates/perf-state-v13-fee-chunks/check.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const bundle=path.join(root,'release/integration/candidates/perf-state-v13-fee-chunks');
const sha=b=>createHash('sha256').update(b).digest('hex');
const manifest=fs.readFileSync(path.join(bundle,'SHA256SUMS'));
if(sha(manifest)!=='a41c76fb3eec2213da2aaa2d9baa51fb2a5a8b16333783816fc1b3ba8c002824')throw Error('fixed V13 fee-chunks bundle manifest differs');
for(const row of manifest.toString('utf8').trim().split('\n')){
 const match=row.match(/^([0-9a-f]{64})  ([A-Za-z0-9.-]+)$/);
 if(!match||sha(fs.readFileSync(path.join(bundle,match[2])))!==match[1])throw Error('fixed V13 fee-chunks candidate file differs');
}
// The supplied checker verifies immutable 2db objects; bind this actual checkout
// too, so a future runtime cannot pass by pointing at an older successful source.
const map=JSON.parse(fs.readFileSync(path.join(bundle,'source-map.json'),'utf8'));
for(const [relative,pin] of Object.entries(map.files)){
 const raw=fs.readFileSync(path.join(root,relative));
 if(raw.length!==pin.bytes||sha(raw)!==pin.sha256)throw Error('current runtime/source differs from fixed V13 fee-chunks candidate: '+relative);
}
for(const [relative,pin] of Object.entries(map.kernelDerivation.kernelFiles)){
 const raw=fs.readFileSync(path.join(root,relative));
 if(raw.length!==pin.bytes||sha(raw)!==pin.sha256)throw Error('current kernel/source differs from fixed V13 fee-chunks candidate: '+relative);
}
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},stdio:['ignore','pipe','pipe']});
if(git('rev-parse','HEAD:internal').trim()!==map.internalTree)throw Error('current complete internal tree differs from fixed V13 fee-chunks candidate');
git('diff','--quiet',map.sourceCommit,'--','internal');
if(git('ls-files','--others','--exclude-standard','--','internal').trim())throw Error('untracked fixed internal inputs cannot qualify V13 candidate');
console.log(JSON.stringify({...validateCandidate({repository:root}),currentSourceFilesMatched:Object.keys(map.files).length,profile:'unpublished-perf-v13-fee-chunks'},null,2));
