import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
function run(args){const p=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(p.status!==0)process.exit(p.status??1);}
run(['--experimental-vm-modules','scripts/test/shop-v4-get-fixed-holder.test.mjs']);
run(['packages/wallet-auth/node_modules/typescript/bin/tsc','--strict','--noEmit','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--types','node','--typeRoots','packages/wallet-auth/node_modules/@types','scripts/test/shop-v4-get-fixed-holder-types.mts']);
const module=await import(new URL('../../packages/wallet-auth/src/original-shop-registered-client-holder-private.js',import.meta.url));
if(typeof module.createOriginalRegisteredClientGETProof!=='function')throw Error('FIXED_GET_CALLEE_MISSING');
let refused=false;try{await module.createOriginalRegisteredClientGETProof({},'/PUBLIC/order');}catch{refused=true;}if(!refused)throw Error('FAKE_LOAN_ACCEPTED');
console.log('FIXED_GET_IMPORT_NO_ACQUISITION; strict=true skipLibCheck=false expectedNegativeTypes=3; SourceComparisonSupplied=false; Root/Source/Native=false');
