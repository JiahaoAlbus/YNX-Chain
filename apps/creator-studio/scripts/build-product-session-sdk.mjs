import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const repository=execFileSync('git',['rev-parse','--show-toplevel'],{cwd:root,encoding:'utf8'}).trim();
const source='529471f3822d2bac43ea47a1ab8004fa2ae79885';
const bundler=process.argv[2];
if(!bundler)throw new Error('Pass the path to the recorded esbuild version. The SDK comes from its frozen Git object.');
const version=execFileSync(resolve(bundler),['--version'],{encoding:'utf8'}).trim();
const recorded=JSON.parse(readFileSync(join(root,'product-session-sdk-source.json'),'utf8'));
if(version!==recorded.bundlerVersion)throw new Error(`Use esbuild ${recorded.bundlerVersion}`);
const workspace=mkdtempSync(join(tmpdir(),'ynx-creator-sdk-'));
const temporary=join(workspace,'packages/wallet-auth');
try{
 const archive=execFileSync('git',['archive',source,'packages/wallet-auth','release/integration/wallet-product-session-router-migration.json'],{cwd:repository,maxBuffer:32*1024*1024});
 execFileSync('tar',['-x','-C',workspace],{input:archive});
 if(createHash('sha256').update(archive).digest('hex')!=='68a4d192c2a7d82d1ea3f69fe6fe6e7d9c670ce7e4ca29b06fea0341ca4e0e18')throw new Error('Full SDK handoff archive mismatch');
 execFileSync('npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:temporary,stdio:'inherit'});
 execFileSync('npm',['test'],{cwd:temporary,stdio:'inherit'});
 const entry=join(temporary,'entry.js');
 writeFileSync(entry,`export {WalletAuthError} from './src/canonical.js';\nexport {createBrowserProductSessionClient} from './src/product-session-browser.js';\nexport {ProductSessionGatewayFetchAdapter} from './src/product-session-gateway-client.js';\nexport {encodeProductSessionWalletURL} from './src/product-session-router.js';\n`);
 execFileSync(resolve(bundler),[entry,'--bundle','--format=esm','--platform=browser','--target=es2022','--minify',`--banner:js=// YNX Wallet/Auth browser SDK: ${source}`,`--outfile=${join(root,'product-session-sdk.js')}`,'--log-level=warning']);
 const bundle=readFileSync(join(root,'product-session-sdk.js'));
 const fullRegistry=JSON.parse(readFileSync(join(temporary,'product-session-registry.json'),'utf8'));
 const digest=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 for(const [directory,productId] of [[root,'creator-studio'],[resolve(root,'../video'),'video']]){
  writeFileSync(join(directory,'product-session-sdk.js'),bundle);
  const registry={...fullRegistry,products:fullRegistry.products.filter(item=>item.productId===productId)};
  writeFileSync(join(directory,'product-session-registry.json'),JSON.stringify(registry,null,2)+'\n');
  const metadata={sdkSourceCommit:source,sdkPackageTree:execFileSync('git',['rev-parse',`${source}:packages/wallet-auth`],{cwd:repository,encoding:'utf8'}).trim(),
   sourceArchive:digest(archive),packageLock:digest(readFileSync(join(temporary,'package-lock.json'))),
   authPublicSourceCommit:'8dad0bab8f6f711e6ca6037201eec5725f9a6a02',registrySubset:productId,bundlerVersion:version,
   files:['product-session-sdk.js','product-session-registry.json'].map(path=>({path,...digest(readFileSync(join(directory,path)))})),
   securityLevel:'webcrypto-nonextractable',osProtected:false,hardwareBacked:false,installedWalletApprovalVerified:false};
  writeFileSync(join(directory,'product-session-sdk-source.json'),JSON.stringify(metadata,null,2)+'\n');
 }
 // Run the upstream behavior suite against the exact delivered browser exports.
 // Authority/signature fixtures stay inside the temporary frozen package only.
 const upstream=readFileSync(join(temporary,'test/product-session-browser.test.mjs'),'utf8');
 const consumer=upstream.replace('canonicalJSON, createBrowserProductSessionClient, createProductSessionReturnURL,','canonicalJSON, createProductSessionReturnURL,')
  .replace('ProductSessionGatewayFetchAdapter, ProductSessionGatewayHttpHandler,','ProductSessionGatewayHttpHandler,')
  .replace('signProductSessionApproval, WalletAuthError,','signProductSessionApproval,')
  .replace('const registry =',`import {createBrowserProductSessionClient,ProductSessionGatewayFetchAdapter,encodeProductSessionWalletURL,WalletAuthError} from ${JSON.stringify(join(root,'product-session-sdk.js'))};\nconst registry =`);
 const launchTest=`\nfor (const localOffsetMs of [-600000, 400, 600000]) test('explicit Wallet launch serializes the fresh authority-timed request with local skew ' + localOffsetMs, async () => {\n const s=setup({localOffsetMs}),browser=await createBrowserProductSessionClient(s.config);\n const pending=await browser.client.begin({walletInstalled:false,schemeRegistered:false});\n const target=new URL(encodeProductSessionWalletURL(s.config.registry,pending.request,new Date(pending.request.issuedAt)));\n const registered=new URL(s.config.registry.wallet.authorizeCallback);\n assert.equal(target.origin,registered.origin);assert.equal(target.protocol,registered.protocol);assert.equal(target.pathname,registered.pathname);\n assert.deepEqual(JSON.parse(Buffer.from(target.searchParams.get('request'),'base64url')),pending.request);\n assert.equal(pending.request.issuedAt,NOW.toISOString());browser.close();\n});\n`;
 const recoveryTest=readFileSync(join(repository,'apps/video/recovery/shipped-bundle-fixture.txt'),'utf8').replace('RECOVERY_CONTROLLER_MODULE',JSON.stringify(join(repository,'apps/video/recovery/controller.js')));
 writeFileSync(join(temporary,'test/creator-shipped-bundle.test.mjs'),consumer+launchTest+recoveryTest);
 execFileSync('node',['--test','test/creator-shipped-bundle.test.mjs','test/product-session-gateway-client.test.mjs','test/product-session-recovery.test.mjs'],{cwd:temporary,stdio:'inherit'});
 console.log(`Creator and Video browser SDKs rebuilt and tested from complete package ${source}`);
}finally{rmSync(workspace,{recursive:true,force:true});}
