import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
function run(args){const r=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);}
run(['--experimental-vm-modules','scripts/test/shop-registered-client-holder.test.mjs']);
run(['packages/wallet-auth/node_modules/typescript/bin/tsc','--strict','--noEmit','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--types','node','--typeRoots','packages/wallet-auth/node_modules/@types','scripts/test/shop-registered-client-holder-types.mts']);
const publicEntry=await import(new URL('../../packages/wallet-auth/src/product-wallet-connection-node.js',import.meta.url));
if('readOriginalProductWalletBusinessReadHolder' in publicEntry)throw new Error('PRIVATE_HOLDER_PUBLIC_EXPORT');
const {captureOriginalRegisteredClientReadHolder:capture}=await import(new URL('../../packages/wallet-auth/src/original-shop-registered-client-holder-private.js',import.meta.url));
let refused=false;try{capture({});}catch{refused=true;}if(!refused)throw new Error('MISSING_ORIGINAL_HOLDER_ACCEPTED');
console.log('NORMAL_IMPORT_NO_ACQUISITION_PASS; strict=true skipLibCheck=false expectedNegativeTypes=4; Root/Source/Native=false');
