import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const raw=await readFile(new URL('./fixtures/sdk39-canonical-source.json',import.meta.url));
if(createHash('sha256').update(raw).digest('hex')!=='6c8b33efc832f4deccc2974657f300cb8e26e84167a5d84d0dc11413cfbf6971')throw Error('Historical SDK39 regression selection differs.');
export const sdk39RegressionInputs=JSON.parse(raw);
const leaves={"5fa0cf4d3bbbae12d9e0e7ab560d50d3c48dee6f820dea969fab2b2da3fa1173": "projection-receipt.json", "68c2ea13ef32e61fcf9c2154a627d8901ae79f71539563cba787b43afa3653a1": "finite-policy.json", "fd172e84b92d3eecd14c3865ca59e3e8d74678cf3ac8569f4f709375309a5d5b": "package.json", "cfad91babe6f5e6d5baa4fbcdacc29d0cb0dc2a800e315b2cb6797fedbaa84d6": "build-record.json"};
export async function sdk39RegressionJSON(pin){
 const leaf=leaves[pin.sha256];if(!leaf)throw Error('Historical SDK39 regression role not declared.');
 const bytes=await readFile(new URL('./fixtures/sdk39-regression-data/'+leaf,import.meta.url));
 if(bytes.length!==pin.bytes||createHash('sha256').update(bytes).digest('hex')!==pin.sha256)throw Error('Historical SDK39 regression leaf differs.');
 return JSON.parse(bytes);
}
export const sdk39RegressionRecordRoot=fileURLToPath(new URL('./fixtures/sdk39-record-root/',import.meta.url));
