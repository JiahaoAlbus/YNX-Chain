// Build the exact A-frozen browser graph into a new owned candidate directory.
// This never writes shared source, production configuration or browser storage.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,join} from 'node:path';
import {createRequire} from 'node:module';
const [packageDirectory,outputDirectory,esbuildModule]=process.argv.slice(2);
if(!packageDirectory||!outputDirectory||!esbuildModule)throw Error('Usage: explicit-frozen-package new-output-directory cached-esbuild-module');
const base=resolve(packageDirectory),output=resolve(outputDirectory),sha=data=>createHash('sha256').update(data).digest('hex');
if(existsSync(output))throw Error('Candidate output must be new');
const manifestBytes=readFileSync(join(base,'freeze-manifest.json'));
if(sha(manifestBytes)!=='cb6a6262f1d0468e5f9192465c25d6d93480ca7ca7828895ad4f39b92ca6ef5a')throw Error('Wrong frozen complete16195 package');
const manifest=JSON.parse(manifestBytes);
for(const [name,pin] of Object.entries(manifest.files)){const data=readFileSync(join(base,name));if(data.length!==pin.bytes||sha(data)!==pin.sha256)throw Error('Frozen input changed: '+name)}
const source=join(base,'source'),sdk=join(source,'packages/wallet-auth');
const entry='export {createBrowserProductSessionClient} from "./src/product-session-browser.js";\nexport {ProductSessionGatewayFetchAdapter} from "./src/product-session-gateway-client.js";\nexport {encodeProductSessionWalletURL} from "./src/product-session-router.js";\nexport {WalletAuthError} from "./src/canonical.js";\n';
const esbuild=createRequire(import.meta.url)(resolve(esbuildModule));
const result=await esbuild.build({stdin:{contents:entry,sourcefile:'media-sdk-entry.js',resolveDir:sdk,loader:'js'},absWorkingDir:source,bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,write:false,metafile:true,logLevel:'silent',banner:{js:'// YNX Wallet/Auth browser SDK: 16195c6663525b0965725a922f46f38cf7b0a004'}});
const inputs=[];
for(const path of Object.keys(result.metafile.inputs)){
 if(path===relative(source,join(sdk,'media-sdk-entry.js')).replaceAll('\\','/'))continue;
 const absolute=resolve(source,path),name='source/'+relative(source,absolute).replaceAll('\\','/'),pin=manifest.files[name];
 if(!pin)throw Error('Unpinned browser graph input: '+name);
 const data=readFileSync(absolute);if(data.length!==pin.bytes||sha(data)!==pin.sha256)throw Error('Browser graph input changed: '+name);
 inputs.push({path:name,...pin});
}
mkdirSync(output,{recursive:true});
const bundle=result.outputFiles[0].contents;writeFileSync(join(output,'product-session-sdk.js'),bundle);
writeFileSync(join(output,'package.json'),JSON.stringify({type:'module',private:true})+'\n');
const metadata={schema:'ynx.media.frozen-browser-sdk-candidate.v1',sdkSourceCommit:'16195c6663525b0965725a922f46f38cf7b0a004',sdkSourceTree:'13c7016a8bbb13cc61912633f9787ef9fc9b69d2',frozenPackageManifestSHA256:sha(manifestBytes),entrySHA256:sha(entry),bundlerVersion:esbuild.version,bundlerModuleSHA256:sha(readFileSync(resolve(esbuildModule))),verifiedGraphInputs:inputs,output:{path:'product-session-sdk.js',bytes:bundle.length,sha256:sha(bundle)},securityLevel:'webcrypto-nonextractable',osProtected:false,hardwareBacked:false,actualWalletApprovalVerified:false,productionInstalled:false};
writeFileSync(join(output,'candidate-source.json'),JSON.stringify(metadata,null,2)+'\n');
console.log(JSON.stringify({inputs:inputs.length,bytes:bundle.length,sha256:sha(bundle),sdkSourceCommit:metadata.sdkSourceCommit,bundlerVersion:esbuild.version,productionInstalled:false}));
