import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {runtimeModules,snapshotApplication} from './package-integrity.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2),macApp=args.includes('--mac-app');
const generation=args.includes('--r6')?'r6':'r5',moduleRoot=generation==='r6'?path.join(root,'r6'):root;
if(args.includes('--plan')){
 if(args.some(a=>!['--plan','--r6','--mac-app'].includes(a)))throw Error('Plan only accepts --r6 and --mac-app.');
 const names=[...runtimeModules[generation].map(name=>path.join(moduleRoot,name)),path.join(root,'README.md'),path.join(root,'scripts/build-qa.mjs'),path.join(root,'scripts/package-integrity.mjs'),...(macApp?[path.join(root,'macos/PayApp.swift'),path.join(root,'macos/PayReconnectState.swift'),path.join(root,'macos/PayStatusMessage.swift'),path.join(root,'scripts/install-mac-qa.mjs')]:[])];
 const inputs=[];for(const file of names){const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('QA plan input must be a regular file.');const raw=await fs.readFile(file);inputs.push({path:path.relative(root,file),bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')});}
 const node=await fs.realpath(process.execPath),nodeRaw=await fs.readFile(node);
 console.log(JSON.stringify({version:'ynx.pay.qa-build-plan/v1',head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),generation,macApp,inputs,node:{path:node,sha256:createHash('sha256').update(nodeRaw).digest('hex')},mainBridge:'NOT_SUPPLIED',authority:false,willWrite:false,installed:false},null,2));process.exit(0);
}
const manifestAt=args.indexOf('--main-runtime-manifest'),runtimeManifest=manifestAt>=0?args[manifestAt+1]:null;
const cometAt=args.indexOf('--comet-runtime-manifest'),cometManifest=cometAt>=0?args[cometAt+1]:null;
if(manifestAt>=0&&!runtimeManifest)throw Error('Original owner bridge manifest path required.');
if(cometAt>=0&&!cometManifest)throw Error('Original owner Comet runtime manifest path required.');
// The existing Wallet IPC is live-frame scoped, not a standalone process
// transport. Until its owner supplies the process and provider lifecycle,
// neither a relocation plan nor executable bytes qualify as a usable runtime.
if(cometAt>=0)throw Error('NATIVE_PAY_COMET_OWNER_LIFECYCLE_NOT_SUPPLIED');
const output=args.find((a,i)=>a!=='--mac-app'&&a!=='--r6'&&a!=='--main-runtime-manifest'&&(manifestAt<0||i!==manifestAt+1));
if(!output||!path.isAbsolute(output))throw Error('Explicit absolute QA output required.');
await fs.mkdir(path.dirname(output),{recursive:true});
await fs.mkdir(output); // A successor never overlays an existing r5/r6 cut.
await fs.mkdir(path.join(output,'bin'),{recursive:true});await fs.mkdir(path.join(output,'lib'),{recursive:true});
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const files=[];
for(const name of runtimeModules[generation]){const raw=await fs.readFile(path.join(moduleRoot,name));await fs.writeFile(path.join(output,'lib',name),raw);files.push({path:'lib/'+name,sha256:createHash('sha256').update(raw).digest('hex')});}
let runtimeConfig={runtime:null,reason:'NATIVE_PAY_NORMAL_MAIN_SOURCE_NOT_SUPPLIED'};
if(runtimeManifest){
 if(!path.isAbsolute(runtimeManifest))throw Error('Explicit absolute original owner bridge manifest required.');
 const manifest=JSON.parse(await fs.readFile(runtimeManifest,'utf8')),base=path.dirname(runtimeManifest),runtimeFiles=[];
 if(!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>512||typeof manifest.entry!=='string'||!manifest.files.some(f=>f.path===manifest.entry))throw Error('Complete original owner bridge source manifest required.');
 let total=0;const seen=new Set();
 for(const file of manifest.files){
  if(typeof file.path!=='string'||!/^[A-Za-z0-9_./-]+$/.test(file.path)||file.path.startsWith('/')||file.path.split('/').some(p=>!p||p==='.'||p==='..')||seen.has(file.path)||! /\.(mjs|cjs|js|json)$/.test(file.path)||! /^[0-9a-f]{64}$/.test(file.sha256))throw Error('Only pinned original IPC bridge JavaScript source may be included; no Native image/keys/profile.');
  seen.add(file.path);const from=path.join(base,file.path),stat=await fs.lstat(from);if(!stat.isFile()||stat.isSymbolicLink()||!(await fs.realpath(from)).startsWith((await fs.realpath(base))+path.sep))throw Error('Original bridge source path invalid.');
  const raw=await fs.readFile(from);total+=raw.length;if(total>16*1024*1024||createHash('sha256').update(raw).digest('hex')!==file.sha256)throw Error('Original bridge source digest/size differs.');
  const target=path.join(output,'lib','normal-runtime',file.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,raw);
  runtimeFiles.push({path:'normal-runtime/'+file.path,sha256:file.sha256});
 }
 const runtime='normal-runtime/'+manifest.entry;
 runtimeConfig={runtime,sha256:runtimeFiles.find(f=>f.path===runtime).sha256,runtimeFiles,originalOwnerInputs:manifest.originalOwnerInputs??null,authorityFromManifest:false};
}
await fs.writeFile(path.join(output,'lib','desktop-runtime.json'),JSON.stringify(runtimeConfig));
const originalNode=await fs.realpath(process.execPath);
if(process.platform==='darwin'){
 const linkage=execFileSync('otool',['-L',originalNode],{encoding:'utf8'});
 for(const match of linkage.matchAll(/@rpath\/(libnode\.[^\s/]+\.dylib)/g)){
  const name=match[1],source=path.resolve(path.dirname(originalNode),'../lib',name),raw=await fs.readFile(source);
  await fs.writeFile(path.join(output,'lib',name),raw);files.push({path:'lib/'+name,sha256:createHash('sha256').update(raw).digest('hex')});
 }
 await fs.writeFile(path.join(output,'NODE_LINKAGE.txt'),linkage);
}
await fs.copyFile(originalNode,path.join(output,'bin','node'));await fs.chmod(path.join(output,'bin','node'),0o755);
const nodeRaw=await fs.readFile(path.join(output,'bin','node'));files.push({path:'bin/node',sha256:createHash('sha256').update(nodeRaw).digest('hex')});
await fs.writeFile(path.join(output,'ynx-pay-native'),'#!/bin/sh\nset -eu\nclient_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$client_dir/bin/node" "$client_dir/lib/cli.mjs" "$@"\n',{mode:0o755});
await fs.copyFile(path.join(root,'README.md'),path.join(output,'README.md'));
let appFiles=null;
if(macApp){
 if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('The current QA app build supports darwin-arm64 only.');
 if(!process.env.TMPDIR||!process.env.CLANG_MODULE_CACHE_PATH||!process.env.SWIFT_MODULECACHE_PATH)throw Error('Explicit TMPDIR/CLANG_MODULE_CACHE_PATH/SWIFT_MODULECACHE_PATH required.');
 const app=path.join(output,'YNX Pay QA.app'),contents=path.join(app,'Contents'),resources=path.join(contents,'Resources');
 await fs.mkdir(path.join(contents,'MacOS'),{recursive:true});await fs.mkdir(path.join(resources,'client'),{recursive:true});
 for(const dir of ['bin','lib'])await fs.cp(path.join(output,dir),path.join(resources,'client',dir),{recursive:true});
 await fs.copyFile(path.join(root,'macos/PayApp.swift'),path.join(resources,'PayApp.swift'));
 await fs.copyFile(path.join(root,'macos/PayReconnectState.swift'),path.join(resources,'PayReconnectState.swift'));
 await fs.copyFile(path.join(root,'macos/PayStatusMessage.swift'),path.join(resources,'PayStatusMessage.swift'));
 await fs.writeFile(path.join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>YNXPay</string><key>CFBundleIdentifier</key><string>com.ynx.pay.localqa</string><key>CFBundleName</key><string>YNX Pay QA</string><key>CFBundleDisplayName</key><string>YNX Pay QA</string><key>CFBundleShortVersionString</key><string>0.1.0</string><key>CFBundleVersion</key><string>1</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>NSHighResolutionCapable</key><true/><key>NSPrincipalClass</key><string>NSApplication</string></dict></plist>`);
 const osTemp=execFileSync('/usr/bin/getconf',['DARWIN_USER_TEMP_DIR'],{encoding:'utf8'}).trim();
 if(!/^\/(?:private\/)?var\/folders\//.test(osTemp))throw Error('Original OS Swift driver temporary directory unavailable.');
 const swiftTemp=await fs.mkdtemp(path.join(osTemp,'p06-swift-'));
 try{
  const sdk=execFileSync('/usr/bin/xcrun',['--show-sdk-path'],{encoding:'utf8'}).trim();
  // Root's bounded exception: only the standard Swift driver's transient
  // files use this owned OS directory; caches, output and logs stay external.
  execFileSync('/usr/bin/xcrun',['swiftc','-parse-as-library','-swift-version','5','-target','arm64-apple-macos13.0','-sdk',sdk,'-O','-module-cache-path',process.env.SWIFT_MODULECACHE_PATH,'-framework','SwiftUI','-framework','AppKit',path.join(root,'macos/PayReconnectState.swift'),path.join(root,'macos/PayStatusMessage.swift'),path.join(root,'macos/PayApp.swift'),'-o',path.join(contents,'MacOS/YNXPay')],{env:{...process.env,TMPDIR:swiftTemp},stdio:'inherit'});
 }finally{await fs.rm(swiftTemp,{recursive:true,force:true});}
 await fs.copyFile(path.join(root,'scripts/install-mac-qa.mjs'),path.join(output,'install-mac-qa.mjs'));
 await fs.copyFile(path.join(root,'scripts/package-integrity.mjs'),path.join(output,'package-integrity.mjs'));
 await fs.writeFile(path.join(resources,'SOURCE.json'),JSON.stringify({head,kind:'local QA',nativeClientGeneration:generation,runtimeModules:runtimeModules[generation],originalMainRuntimeSupplied:!!runtimeConfig.runtime,originalOwnerInputs:runtimeConfig.originalOwnerInputs??null,originalSDKNativeImageSupplied:false,actualMainApproval:false,installed:false,productionFunds:false},null,2)+'\n');
 // Resource metadata is finalized before the final signature.
 execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});
 execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
 files.push({path:'YNX Pay QA.app/Contents/MacOS/YNXPay',sha256:createHash('sha256').update(await fs.readFile(path.join(contents,'MacOS/YNXPay'))).digest('hex')});
 appFiles=await snapshotApplication(app);
}
await fs.writeFile(path.join(output,'BUILD.json'),JSON.stringify({head,builtAt:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,entry:'ynx-pay-native',nativeClientGeneration:generation,runtimeModules:runtimeModules[generation],files,appFiles,kind:macApp?'macOS SwiftUI QA client and original native-service business module/CLI':'standalone native-service business QA module/CLI; not a mobile GUI installer',macApp:macApp?'YNX Pay QA.app':null,signature:macApp?'local ad-hoc QA only':null,sourceRuntimeBundled:!!runtimeConfig.runtime,normalRuntime:runtimeConfig,mainOrSDKImageBundled:false,privateKeys:false,productionFunds:false,installed:false,deployed:false},null,2)+'\n');
console.log(JSON.stringify({output,head,entry:path.join(output,'ynx-pay-native')}));
