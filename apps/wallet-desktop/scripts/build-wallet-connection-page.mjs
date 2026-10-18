import {readFile,realpath,mkdir,copyFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const appDirectory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

// Normal browser asset build for the existing Wallet /connect/ route. Only
// original A executes builds/publishes. Never install packages or fall back to
// ambient tools, an internal SDK path, another origin or a replacement client.
export async function buildWalletConnectionPage(outputDirectory){
 if(typeof outputDirectory!=='string'||!path.isAbsolute(outputDirectory))throw Error('ABSOLUTE_NEW_OUTPUT_REQUIRED');
 const parent=await realpath(path.dirname(outputDirectory));if(path.join(parent,path.basename(outputDirectory))!==outputDirectory)throw Error('CANONICAL_OUTPUT_REQUIRED');
 const sdkDirectory=path.resolve(appDirectory,'../../packages/wallet-auth'),require=createRequire(path.join(sdkDirectory,'package.json'));
 require.resolve('@ynx-chain/wallet-auth/walletconnect-dapp-connection');
 const toolDirectory=await realpath(path.join(sdkDirectory,'node_modules/esbuild'));
 const metadata=JSON.parse(await readFile(path.join(toolDirectory,'package.json'),'utf8'));
 if(metadata.name!=='esbuild'||metadata.version!=='0.25.9')throw Error('ORIGINAL_PINNED_ESBUILD_REQUIRED');
 const {build}=require(path.join(toolDirectory,'lib/main.js'));
 await mkdir(outputDirectory); // EEXIST preserves any prior build and evidence.
 const result=await build({entryPoints:[path.join(appDirectory,'web-connect/entry.mjs')],outfile:path.join(outputDirectory,'walletconnect-consumer.js'),bundle:true,platform:'browser',format:'iife',target:'es2022',legalComments:'eof',metafile:true,sourcemap:false,logLevel:'silent'});
 for(const name of ['index.html','walletconnect-consumer.css'])await copyFile(path.join(appDirectory,'web-connect',name),path.join(outputDirectory,name));
 const files=[];for(const name of ['index.html','walletconnect-consumer.css','walletconnect-consumer.js']){const bytes=await readFile(path.join(outputDirectory,name));files.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
 const receipt={state:'BROWSER_ASSETS_BUILT_NOT_DEPLOYED_OR_CONNECTED',origin:'https://wallet.ynxweb4.com',route:'/connect/',files,inputs:Object.keys(result.metafile.inputs).sort(),sdkVersion:JSON.parse(await readFile(path.join(sdkDirectory,'package.json'),'utf8')).version,signing:false,broadcast:false,relayVerified:false};
 await writeFile(path.join(outputDirectory,'BUILD_RECEIPT.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return receipt;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const [output,...extra]=process.argv.slice(2);if(extra.length)throw Error('USAGE: build-wallet-connection-page.mjs ABSOLUTE_NEW_OUTPUT_DIRECTORY');console.log(JSON.stringify(await buildWalletConnectionPage(output)));}
