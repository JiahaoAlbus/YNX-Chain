import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateCandidate} from '../../release/integration/candidates/perf-state-v13/check.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const bundle=path.join(root,'release/integration/candidates/perf-state-v13');
const sha=b=>createHash('sha256').update(b).digest('hex');
const manifest=fs.readFileSync(path.join(bundle,'SHA256SUMS'));
if(sha(manifest)!=='3834e2d9151065eae328f90964689e3aed42bb39460eb845343b36308d3c3e10')throw Error('fixed original V13 bundle manifest differs');
for(const row of manifest.toString('utf8').trim().split('\n')){
 const match=row.match(/^([0-9a-f]{64})  ([A-Za-z0-9.-]+)$/);
 if(!match||sha(fs.readFileSync(path.join(bundle,match[2])))!==match[1])throw Error('fixed V13 candidate file differs');
}
// The supplied checker verifies immutable d47 objects; bind this actual checkout
// too, so a future runtime cannot pass by pointing at an older successful source.
const map=JSON.parse(fs.readFileSync(path.join(bundle,'source-map.json'),'utf8'));
for(const [relative,pin] of Object.entries(map.files)){
 const raw=fs.readFileSync(path.join(root,relative));
 if(raw.length!==pin.bytes||sha(raw)!==pin.sha256)throw Error('current runtime/source differs from fixed V13 candidate: '+relative);
}
console.log(JSON.stringify({...validateCandidate({repository:root}),currentSourceFilesMatched:Object.keys(map.files).length,profile:'unpublished-perf-v13'},null,2));
