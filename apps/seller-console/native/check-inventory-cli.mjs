import {createRequire} from 'node:module';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {prepareCurrentWalletSDK} from '../scripts/current-wallet-sdk.mjs';

// Build/test tools only; the official byte-pinned supplier is unchanged.
const dependencies=resolve(process.argv[2]),require=createRequire(join(dependencies,'inventory-check.cjs'));
const esbuild=require('esbuild');
if(esbuild.version!=='0.25.9')throw Error('Original Native compiler mismatch');
const supplier=await prepareCurrentWalletSDK({dependencies}),root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=await mkdtemp(join(tmpdir(),'ynx-shop-inventory-cli-'));
const tests=['inventory-batch-cli','mutation-intents'].map(name=>join(output,name+'.mjs'));
for(const [index,name] of ['inventory-batch-cli','mutation-intents'].entries()){
 await esbuild.build({entryPoints:[join(root,'test',name+'.test.mjs')],outfile:tests[index],bundle:true,format:'esm',platform:'node',target:'node22',...supplier.buildOptions});
}
console.log('Inventory CLI official SDK pin',supplier.provenance.sha256);
execFileSync(process.execPath,['--test',...tests],{stdio:'inherit'});
if(process.argv[3])await esbuild.build({entryPoints:[join(root,'test','inventory-batch-http.mjs')],outfile:resolve(process.argv[3]),bundle:true,format:'esm',platform:'node',target:'node22',...supplier.buildOptions});
