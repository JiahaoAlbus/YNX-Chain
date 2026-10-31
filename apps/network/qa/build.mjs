#!/usr/bin/env node
// Local QA only. No signing, notarization, installation or existing App/data writes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const args=process.argv.slice(2);
function option(name){const i=args.indexOf(name);return i<0?undefined:args[i+1];}
const plan=args.includes('--plan'),out=option('--out-dir'),expected=option('--expect-head');
const allowed=new Set(['--plan','--out-dir','--expect-head']);
for(let i=0;i<args.length;i++){if(!allowed.has(args[i]))throw Error('Unknown QA builder option');if(args[i]!=='--plan'){if(!args[++i])throw Error('Option value required');}}
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function run(command,argv,opts={}){const r=spawnSync(command,argv,{cwd:root,encoding:'utf8',maxBuffer:48<<20,env:{...process.env,GOMAXPROCS:'2',GOOS:'darwin',GOARCH:'arm64',CGO_ENABLED:'0',GOFLAGS:'',GOWORK:'off'},...opts});if(r.error||r.status!==0)throw Error(`${command} failed: ${r.error?.message??r.stderr?.slice(-4000)}`);return r.stdout.trim();}
function jsonStream(raw){let start=-1,depth=0,quoted=false,escape=false;const values=[];for(let i=0;i<raw.length;i++){const c=raw[i];if(start<0){if(c==='{'){start=i;depth=1;}continue;}if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue;}if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&!--depth){values.push(JSON.parse(raw.slice(start,i+1)));start=-1;}}if(start>=0)throw Error('Incomplete dependency graph');return values;}
function snapshot(){
  const head=run('git',['rev-parse','HEAD']);if(!/^[0-9a-f]{40}$/.test(head)||expected&&head!==expected)throw Error('Exact source HEAD does not match');
  const status=run('git',['status','--porcelain=v1','--untracked-files=all']);
  const files=new Set(['go.mod','go.sum','apps/network/qa/build.mjs','apps/network/qa/launcher.m']);
  const packages=jsonStream(run('go',['list','-mod=readonly','-deps','-json','./cmd/ynx-network-helper','./cmd/ynx-consensus-proof-verify']));
  for(const p of packages){if(!p.Dir||!(p.Dir===root||p.Dir.startsWith(root+path.sep)))continue;for(const field of ['GoFiles','CgoFiles','CFiles','CXXFiles','MFiles','HFiles','SFiles','SysoFiles','EmbedFiles'])for(const name of p[field]??[]){const relative=path.relative(root,path.join(p.Dir,name));if(!relative.startsWith('..'))files.add(relative);}if(p.Module?.GoMod&&p.Module.GoMod.startsWith(root+path.sep))files.add(path.relative(root,p.Module.GoMod));}
  const inputs=[...files].sort().map(name=>({path:name,bytes:fs.statSync(path.join(root,name)).size,sha256:sha(fs.readFileSync(path.join(root,name)))}));
  const identity={head,inputs};return {head,branch:run('git',['branch','--show-current']),dirty:status!=='',dirtyPaths:status.split('\n').filter(Boolean),inputs,inputSHA256:sha(JSON.stringify(identity)),goVersion:run('go',['version'])};
}
const source=snapshot();
if(plan){process.stdout.write(JSON.stringify({kind:'YNX-NETWORK-QA-BUILD-PLAN/v1',target:'darwin/arm64',source,publisherSigned:false,installed:false},null,2)+'\n');process.exit(0);}
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('This QA builder requires a native macOS ARM64 host');
if(source.dirty)throw Error('QA package source is dirty; preserve changes and build after the owner commits the complete candidate. --plan records the dirty source without packaging it.');
if(!out||!path.isAbsolute(out)||path.resolve(out)!==out||out==='/Applications'||out.startsWith('/Applications/'))throw Error('An absolute independent QA output directory is required');
fs.mkdirSync(out,{recursive:true,mode:0o700});
const identity=sha(JSON.stringify({head:source.head,input:source.inputSHA256}));
const name=`ynx-network-qa-macos-arm64-${source.head.slice(0,12)}-${identity.slice(0,8)}`;
const destination=path.join(out,name);if(fs.existsSync(destination))throw Error('Existing versioned QA output is preserved; choose a new output parent');
const staging=fs.mkdtempSync(path.join(out,'.network-qa-build-'));
const app=path.join(staging,'YNX Network QA.app'),contents=path.join(app,'Contents');
for(const dir of ['MacOS','Helpers','Resources'])fs.mkdirSync(path.join(contents,dir),{recursive:true,mode:0o755});
const helper=path.join(contents,'Helpers','ynx-network-helper'),proof=path.join(contents,'Helpers','ynx-consensus-proof-verify');
run('go',['build','-mod=readonly','-trimpath','-buildvcs=false','-p','1','-ldflags',`-X main.sourceRevision=${source.head}`,'-o',helper,'./cmd/ynx-network-helper']);
run('go',['build','-mod=readonly','-trimpath','-buildvcs=false','-p','1','-o',proof,'./cmd/ynx-consensus-proof-verify']);
const sdk=run('xcrun',['--sdk','macosx','--show-sdk-path']);
const launcher=path.join(contents,'MacOS','ynx-network-qa');
run('xcrun',['--sdk','macosx','clang','-arch','arm64','-mmacosx-version-min=12.0','-isysroot',sdk,'-fobjc-arc','-Wno-deprecated-declarations','-framework','Cocoa','-framework','WebKit',path.join(here,'launcher.m'),'-o',launcher],{env:process.env});
const version=run(helper,['--version']);if(!version.includes(source.head))throw Error('Helper build identity does not match source');
for(const executable of [launcher,helper,proof]){fs.chmodSync(executable,0o755);if(!run('lipo',['-archs',executable],{env:process.env}).split(/\s+/).includes('arm64'))throw Error('QA executable architecture mismatch');}
const config={version:'YNX-NETWORK-LOCAL-QA/v1',buildID:`qa-${identity.slice(0,16)}`,sourceRevision:source.head,sourceInputSHA256:source.inputSHA256,helperSHA256:sha(fs.readFileSync(helper)),proofSHA256:sha(fs.readFileSync(proof)),defaultRPC:'https://rpc.ynxweb4.com',publisherSigned:false,notarized:false,installed:false};
fs.writeFileSync(path.join(contents,'Resources','qa-build.json'),JSON.stringify(config,null,2)+'\n');
const plist=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>ynx-network-qa</string><key>CFBundleIdentifier</key><string>dev.ynx.network.qa.h${identity.slice(0,16)}</string><key>CFBundleName</key><string>YNX Network QA</string><key>CFBundleDisplayName</key><string>YNX Network QA</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.3.0</string><key>CFBundleVersion</key><string>0.3.1</string><key>LSMinimumSystemVersion</key><string>12.0</string><key>NSHighResolutionCapable</key><true/><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/><key>NSAllowsArbitraryLoadsInWebContent</key><true/></dict></dict></plist>`;
fs.writeFileSync(path.join(contents,'Info.plist'),plist);run('plutil',['-lint',path.join(contents,'Info.plist')],{env:process.env});
fs.writeFileSync(path.join(staging,'START.command'),'#!/bin/sh\nset -eu\nqa_bundle_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$qa_bundle_dir/YNX Network QA.app/Contents/MacOS/ynx-network-qa" "$@"\n',{mode:0o755});
fs.writeFileSync(path.join(staging,'START_HERE.txt'),`YNX Network local QA candidate\nSource: ${source.head}\nNormal entry: open YNX Network QA.app, or double-click START.command.\nCLI service: ./START.command --headless\nNative readback: ./START.command --native-status\nVersion: ./START.command --version\nThe displayed one-use code pairs receipt.read/receipt.verify, node.read and read-only native.status. Quit stops only the helper launched by this app.\nPrivate version-specific data: ~/.ynx-network-qa/${config.buildID}/\nNo original source/trust context is supplied by this package. Receipt queries remain RPC_ONLY without independently configured original context. The original proof executable is included under Contents/Helpers.\nThis is an independent QA bundle, not formally publisher signed, notarized or installed. It does not replace an installed app, formal download or existing user directory.\n`);
const final=snapshot();if(final.head!==source.head||final.inputSHA256!==source.inputSHA256||final.dirty)throw Error('Source changed during build; staging preserved, no candidate published');
const signatureObservations=[launcher,helper,proof].map(file=>{const r=spawnSync('codesign',['--display','--verbose=4',file],{encoding:'utf8'});return {path:path.relative(staging,file),exit:r.status,display:(r.stderr??'').trim()};});
const outputFiles=[];function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else outputFiles.push({path:path.relative(staging,file),bytes:fs.statSync(file).size,sha256:sha(fs.readFileSync(file))});}}walk(staging);
fs.writeFileSync(path.join(staging,'source-manifest.json'),JSON.stringify({kind:'YNX-NETWORK-QA-PROVENANCE/v1',builtAt:new Date().toISOString(),target:'darwin/arm64',source,helperVersion:version,toolchain:{go:source.goVersion,clang:run('xcrun',['clang','--version'],{env:process.env}),macOSSDK:sdk},buildArguments:{go:'-mod=readonly -trimpath -buildvcs=false -p1; sourceRevision exact HEAD',native:'system clang, Cocoa/WebKit, arm64, minimum macOS12'},embeddedWeb:source.inputs.filter(x=>x.path.startsWith('apps/network/web/')),dataDirectory:`~/.ynx-network-qa/${config.buildID}`,publisherSigned:false,notarized:false,installed:false,signatureObservations,outputs:outputFiles},null,2)+'\n');
fs.renameSync(staging,destination);process.stdout.write(JSON.stringify({bundle:destination,app:path.join(destination,'YNX Network QA.app'),source:source.head,buildID:config.buildID,publisherSigned:false,installed:false})+'\n');
