import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateCandidate} from '../../release/integration/candidates/perf-state-v13-anchor-order/check.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const bundle=path.join(root,'release/integration/candidates/perf-state-v13-anchor-order');
const sha=b=>createHash('sha256').update(b).digest('hex');
const manifest=fs.readFileSync(path.join(bundle,'SHA256SUMS'));
if(sha(manifest)!=='2f89f86b7c7a504b1f30b1aa83930cce298f02e0459c8cb0d69986e2fd42a33a')throw Error('fixed anchor-order bundle manifest differs');
for(const row of manifest.toString().trim().split('\n')){
 const match=row.match(/^([0-9a-f]{64})  ([A-Za-z0-9.-]+)$/);
 if(!match||sha(fs.readFileSync(path.join(bundle,match[2])))!==match[1])throw Error('fixed anchor-order candidate file differs');
}
console.log(JSON.stringify(validateCandidate({repository:root}),null,2));
