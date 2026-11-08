import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
function run(args){const p=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(p.status!==0)process.exit(p.status??1);}
run(['--experimental-vm-modules','scripts/test/shop-source-reference-product-scope.test.mjs']);
run(['packages/wallet-auth/node_modules/typescript/bin/tsc','--strict','--noEmit','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--types','node','--typeRoots','packages/wallet-auth/node_modules/@types','scripts/test/shop-source-reference-product-scope-types.mts']);
const scope=await import(new URL('../../packages/wallet-auth/src/original-shop-registered-client-holder-private.js',import.meta.url));
if(typeof scope.captureOriginalRegisteredClientReadHolderForProductSource!=='function'||typeof scope.readOriginalRegisteredClientSourceReferenceDATA!=='function')throw Error('PRIVATE_SCOPE_BODY_NOT_SUPPLIED');
let rejected=false;try{scope.captureOriginalRegisteredClientReadHolderForProductSource({},{});}catch{rejected=true;}if(!rejected)throw Error('UNBRANDED_SCOPE_ACCEPTED');
console.log('PRIVATE_SOURCE_REF_SCOPE_BODY_IMPORT_NO_ACQUISITION; strict=true skipLibCheck=false expectedNegativeTypes=6; NativeSlotEnabled=false Root/Source/Native=false');
