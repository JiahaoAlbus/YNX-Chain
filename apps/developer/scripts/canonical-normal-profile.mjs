import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function canonicalNormalProfileTestPath(record){
 if(record.sdkVersion==='1.3.0-pq.3.32-auth.39'&&record.sdkCommit==='74a44b86f27456685f4a153dfdd8f4e51aaa0cc8')return 'scripts/sdk39-normal-profile.test.mjs';
 if(record.sdkVersion==='1.3.0-pq.3.32-auth.46'&&record.sdkCommit==='59a3797ea3421129171565e37870568e424ec085')return 'scripts/sdk46-normal-profile.test.mjs';
 if(record.sdkVersion==='1.3.0-pq.3.32-auth.47'&&record.sdkCommit==='5763b31b0e8d595bf2ed2cae2d4adf7fc5cdcadf')return 'scripts/sdk47-normal-profile.test.mjs';
 if(record.sdkVersion==='1.3.0-pq.3.32-auth.48'&&record.sdkCommit==='632af166d0b374c618bb226f63aefdcba223247c')return 'scripts/sdk48-normal-profile.test.mjs';
 throw Error('No normal package profile for the exact canonical SDK source.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {canonicalInputs}=await import('./package-identity-admission-source.mjs');
 console.log(canonicalNormalProfileTestPath(await canonicalInputs()));
}

