import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
function run(args){const p=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(p.status!==0)process.exit(p.status??1);}
run(['--experimental-vm-modules','--test','scripts/test/shop-registered-read-node-loader.test.mjs']);
run(['packages/wallet-auth/node_modules/typescript/bin/tsc','--strict','--noEmit','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--types','node','--typeRoots','packages/wallet-auth/node_modules/@types','scripts/test/shop-registered-read-node-loader-types.mts']);
const ns=await import(new URL('../../packages/wallet-auth/src/original-shop-registered-read-node-loader-private.js',import.meta.url));
const names=['startOriginalShopRegisteredReadNodeLoadV1','isOriginalShopRegisteredReadNamespaceImportDATA','consumeOriginalShopRegisteredReadNamespaceImportDATA'];
if(Object.keys(ns).sort().join(',')!==names.sort().join(','))throw Error('SHOP_LOADER_EXPORT_SET_CHANGED');
if(ns.isOriginalShopRegisteredReadNamespaceImportDATA({},{}))throw Error('FAKE_IMPORT_EVIDENCE');
console.log('SHOP_PRIVATE_NODE_LOADER_NORMAL_IMPORT_NO_ACQUISITION; strict=true skipLibCheck=false expectedNegativeTypes=4; NativeSlotEnabled=false Root/Source/Native=false');
