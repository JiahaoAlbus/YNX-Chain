import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const run=(argv)=>{const p=spawnSync(process.execPath,argv,{cwd:root,stdio:'inherit'});if(p.error)throw p.error;if(p.status!==0)throw Error('WPR_MATERIALIZER_CONTROL_FAILED:'+p.status);};
// No native/old matrix/issuance/private IO is executed by this dedicated job.
run(['test/wpr-materializer-inert.test.mjs']);
run(['test/wpr-materializer.test.mjs']);
run(['node_modules/typescript/bin/tsc','--strict','--noEmit','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','test/wpr-materializer-types.ts']);
const source=readFileSync(path.join(root,'src/original-wallet-product-materializer-data.js'),'utf8');
if(/loadReleaseSelected|loadOriginalAuthSourceIssuanceService|loadOriginalAuthSourceCurrentService|importKeyMaterial|roleKeys|currentKeys|createRequire|node:fs/.test(source))throw Error('WPR_MATERIALIZER_SENSITIVE_LOADER_DEPENDENCY');
console.log(JSON.stringify({newDATAControls:18,strictLibraryCheck:true,negativeTypeControls:6,keysOpened:false,RootAdmission:false,SourceAdmission:false,NativeAdmission:false}));
