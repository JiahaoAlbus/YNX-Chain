import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const p=spawnSync(process.execPath,['--test','scripts/test/shop-holder-get-combined.test.mjs'],{cwd:root,stdio:'inherit'});
if(p.status!==0)process.exit(p.status??1);
console.log('SAME_PACKAGE_WRAPPER_AND_FIXED_GET_PASS; NativeAcquisition=false Root/Source/Native=false; previous15and13NotRerun=true');
