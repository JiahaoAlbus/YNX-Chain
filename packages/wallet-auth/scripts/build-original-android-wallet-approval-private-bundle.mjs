// Fixed Wallet Android approval bundle. The original Native host evaluates this closure.
import fs from'node:fs';import path from'node:path';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';
const tool=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(tool,'..'),args=process.argv.slice(2);if(args.length!==1||!args[0].startsWith('--out='))throw Error('SOURCE_ONLY_BUILD_FIXED_ARGUMENTS');const p=args[0].slice(6);if(!path.isAbsolute(p)||path.normalize(p)!==p)throw Error('SOURCE_ONLY_OUTPUT_ABSOLUTE');fs.mkdirSync(p,{recursive:true});
const esbuild=await import(root+'/node_modules/esbuild/lib/main.js'),finite=root+'/native/original-source-finite-product-registry.mjs',urlConsumers=new Set([root+'/src/product-session-v2.js',root+'/src/product-session-device-registration-v4.js']),registryConsumers=new Set([root+'/src/product-session-v2.js']);

const r=await esbuild.build({absWorkingDir:root,entryPoints:[root+'/native/original-android-wallet-approval-private.mjs'],bundle:true,platform:'browser',format:'iife',globalName:'walletApprovalModule',target:'es2020',inject:[root+'/native/original-source-private-utf8-inject.mjs'],metafile:true,write:false,legalComments:'none',plugins:[{name:'finite-original-product-binding-projection',setup(build){
 build.onResolve({filter:/^\.\/product-session-registry\.js$/},args=>registryConsumers.has(args.importer)?{path:finite}:undefined);
 build.onLoad({filter:/\/src\/(product-session-v2|product-session-device-registration-v4)\.js$/},args=>{if(!urlConsumers.has(args.path))throw Error('SOURCE_FINITE_URL_IMPORTER');return{contents:"import{SourceFiniteURLDataView as URL}from'../native/original-source-finite-product-registry.mjs';\n"+fs.readFileSync(args.path,'utf8'),resolveDir:path.dirname(args.path),loader:'js'};});
 }}]});
for(const o of Object.values(r.metafile.outputs))if(o.imports.length)throw Error('SOURCE_ONLY_UNRESOLVED_IMPORTS');
const bytes=Buffer.from('(function () {\n'+r.outputFiles[0].text+'\nreturn walletApprovalModule.default;\n})()\n');if(bytes.length>8388608)throw Error('SOURCE_ONLY_BUNDLE_MAX');fs.writeFileSync(p+'/ANDROID_WALLET_APPROVAL_PRIVATE.bundle.js',bytes);fs.writeFileSync(p+'/ANDROID_WALLET_APPROVAL_METAFILE.json',JSON.stringify(r.metafile,null,2)+'\n');
const rows=[];for(const name of Object.keys(r.metafile.inputs)){const q=path.resolve(root,name),b=fs.readFileSync(q);rows.push({path:q,relative:name,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});}
const output={entry:'native/original-android-wallet-approval-private.mjs',evaluatedValue:'(fixedWalletNativeHost)=>{prepare,read,attach}',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),inputs:rows,imports:[],globalsInstalled:[],lexicalUTF8Injection:'native/original-source-private-utf8-inject.mjs',finiteURLConsumers:[...urlConsumers],finiteRegistryConsumers:[...registryConsumers],NativePortContract:'fixed Wallet Android approval owner',NativeBodyExecuted:false,HermesVMExecuted:false,SourceAdmission:false};fs.writeFileSync(p+'/ANDROID_WALLET_APPROVAL_BUNDLE_RESULT.json',JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({bytes:bytes.length,sha256:output.sha256,inputs:rows.length,externalImports:0}));

const header = '#pragma once\n#include <cstddef>\n#include <cstdint>\n'
  + 'namespace ynx::wallet::android_approval_sdk {\n'
  + 'extern const std::uint8_t javascript[];\nextern const std::size_t javascriptSize;\n'
  + 'extern const char javascriptSHA256[65];\n}\n';
const rowsCPP = [];
for (let i = 0; i < bytes.length; i += 24) {
  rowsCPP.push('  ' + [...bytes.subarray(i, i + 24)].map(byte => '0x' + byte.toString(16).padStart(2, '0')).join(', ') + ',');
}
const cpp = '#include "AndroidWalletApprovalPrivateBundle.hpp"\n'
  + 'namespace ynx::wallet::android_approval_sdk {\n'
  + 'const std::uint8_t javascript[] = {\n' + rowsCPP.join('\n') + '\n};\n'
  + 'const std::size_t javascriptSize = sizeof(javascript);\n'
  + 'const char javascriptSHA256[65] = "' + output.sha256 + '";\n}\n';
fs.writeFileSync(p + '/AndroidWalletApprovalPrivateBundle.hpp', header);
fs.writeFileSync(p + '/AndroidWalletApprovalPrivateBundle.cpp', cpp);
