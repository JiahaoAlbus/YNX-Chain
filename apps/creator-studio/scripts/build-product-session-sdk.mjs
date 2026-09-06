import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const repository=execFileSync('git',['rev-parse','--show-toplevel'],{cwd:root,encoding:'utf8'}).trim();
const source='b3e4b5269d665ee5c8e2542454191cfc6ff53ecb';
const bundler=process.argv[2];
if(!bundler)throw new Error('Pass the path to the recorded esbuild version. The SDK comes from its frozen Git object.');
const version=execFileSync(resolve(bundler),['--version'],{encoding:'utf8'}).trim();
const recorded=JSON.parse(readFileSync(join(root,'product-session-sdk-source.json'),'utf8'));
if(version!==recorded.bundlerVersion)throw new Error(`Use esbuild ${recorded.bundlerVersion}`);
const temporary=mkdtempSync(join(tmpdir(),'ynx-creator-sdk-'));
try{
 const archive=execFileSync('git',['archive',source,'packages/wallet-auth/src','packages/wallet-auth/package.json','packages/wallet-auth/package-lock.json','packages/wallet-auth/product-session-registry.json'],{cwd:repository,maxBuffer:8*1024*1024});
 execFileSync('tar',['-x','-C',temporary,'--strip-components=2'],{input:archive});
 execFileSync('npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:temporary,stdio:'inherit'});
 const entry=join(temporary,'entry.js');
 writeFileSync(entry,`export {createBrowserProductSessionClient} from './src/product-session-browser.js';\nexport {ProductSessionGatewayFetchAdapter} from './src/product-session-gateway-client.js';\nexport {encodeProductSessionWalletURL} from './src/product-session-router.js';\n`);
 execFileSync(resolve(bundler),[entry,'--bundle','--format=esm','--platform=browser','--target=es2022','--minify',`--banner:js=// YNX Wallet/Auth browser SDK: ${source}`,`--outfile=${join(root,'product-session-sdk.js')}`,'--log-level=warning']);
 const registry=JSON.parse(readFileSync(join(temporary,'product-session-registry.json'),'utf8'));registry.products=registry.products.filter(item=>item.productId==='creator-studio');
 writeFileSync(join(root,'product-session-registry.json'),JSON.stringify(registry,null,2)+'\n');
 console.log(`Creator browser SDK rebuilt from ${source}`);
}finally{rmSync(temporary,{recursive:true,force:true});}
