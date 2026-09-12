import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repository=process.argv[2];
if(!repository)throw new Error('Usage: node apps/ai/scripts/build-wallet-sdk.mjs <Wallet source repository>');
const authority='673522fe126b5b87f91c6790ca7bea0eb574f2e8';
const dependencyRequire=createRequire(path.join(path.resolve(repository),'packages/wallet-auth/package.json'));
const {build,version}=dependencyRequire('esbuild');
const files={};
const result=await build({
 stdin:{contents:"export { StandardWalletConnection } from 'ynx-sdk/standard-wallet-connection.js'; export { discoverWalletProviders } from 'ynx-sdk/wallet-provider-discovery.js';",loader:'js'},
 bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,
 plugins:[{name:'pinned-wallet-source',setup(builder){
  builder.onResolve({filter:/^ynx-sdk\//},args=>({path:args.path.slice(8),namespace:'wallet-source'}));
  builder.onResolve({filter:/^\./,namespace:'wallet-source'},args=>({path:path.posix.normalize(path.posix.join(path.posix.dirname(args.importer),args.path)),namespace:'wallet-source'}));
  builder.onResolve({filter:/^@noble\//,namespace:'wallet-source'},args=>({path:dependencyRequire.resolve(args.path)}));
  builder.onLoad({filter:/.*/,namespace:'wallet-source'},args=>{
   const sourcePath='packages/wallet-auth/src/'+args.path;
   const contents=execFileSync('git',['-C',repository,'show',authority+':'+sourcePath],{encoding:'utf8'});
   files[sourcePath]=createHash('sha256').update(contents).digest('hex');
   return {contents,loader:'js'};
  });
 }}],
});
const output=result.outputFiles[0].contents;
const destination=fileURLToPath(new URL('../web/wallet-sdk.mjs',import.meta.url));
writeFileSync(destination,output);
writeFileSync(new URL('../integration/wallet-sdk-source.json',import.meta.url),JSON.stringify({
 authority,package:'@ynx-chain/wallet-auth',exports:['StandardWalletConnection','discoverWalletProviders'],
 esbuild:version,files,bundleSHA256:createHash('sha256').update(output).digest('hex'),
 boundary:'Standard EIP-1193 connection only. No AI private session or canonical registry acceptance.',
},null,2)+'\n');
