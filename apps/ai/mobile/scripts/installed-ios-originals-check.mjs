// Narrow OS-loan checks; no simulator launch, account, signing or installation.
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const app=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {values}=parseArgs({options:{'output-dir':{type:'string'}}});
if(!values['output-dir'])throw Error('Use --output-dir <fresh evidence directory>');
const out=resolve(values['output-dir']);if(existsSync(out))throw Error('FRESH_DIRECTORY_REQUIRED');mkdirSync(out,{recursive:true});
const include=join(app,'contracts/sdk-mobile-application-v6'),source=join(app,'native/installed-application/InstalledApplicationOriginal.ios.mm');
const manifest=JSON.parse(readFileSync(join(include,'PROVENANCE.json'),'utf8'));
for(const row of manifest.files){const raw=readFileSync(join(include,row.file));if(raw.length!==row.bytes||createHash('sha256').update(raw).digest('hex')!==row.sha256)throw Error('PRIVATE_HEADER_DRIFT');}
const results=[];
function run(name,args){const r=spawnSync('xcrun',args,{cwd:app,encoding:'utf8',maxBuffer:8<<20});writeFileSync(join(out,name+'.stdout'),r.stdout||'');writeFileSync(join(out,name+'.stderr'),r.stderr||'');results.push({name,command:['xcrun',...args],exitCode:r.status});if(r.error)throw r.error;if(r.status!==0)throw Error(`${name} failed; original output retained in ${out}`);return r.stdout.trim();}
const common=['clang++','-std=c++20','-fobjc-arc','-Wall','-Wextra','-Werror','-I',include];
try{
 for(const [sdk,target] of [['iphoneos','arm64-apple-ios16.4'],['iphonesimulator','arm64-apple-ios16.4-simulator']]){
  const sysroot=run(sdk+'-sysroot',['--sdk',sdk,'--show-sdk-path']);
  run(sdk+'-compile',['--sdk',sdk,...common,'-target',target,'-isysroot',sysroot,'-c',source,'-o',join(out,sdk+'.o')]);
 }
 // macOS CommonCrypto deprecation and iOS-only unused helpers are limited to
 // this PUBLIC host harness. Neither suppression applies to production builds.
 const binary=join(out,'installed-file.PUBLIC');
 run('host-controls-compile',[...common,'-Wno-deprecated-declarations','-Wno-unused-function','native/installed-application/installed-file.PUBLIC.mm','-framework','Foundation','-o',binary]);
 const r=spawnSync(binary,[],{cwd:app,encoding:'utf8'});writeFileSync(join(out,'host-controls.stdout'),r.stdout||'');writeFileSync(join(out,'host-controls.stderr'),r.stderr||'');results.push({name:'PUBLIC real-file controls',exitCode:r.status,signal:r.signal});if(r.error)throw r.error;if(r.status!==0)throw Error('PUBLIC_HOST_CONTROLS_FAILED');
}finally{writeFileSync(join(out,'RESULT.json'),JSON.stringify({results,scope:'actual iOS device/simulator source objects plus PUBLIC macOS real-file custody controls',installed:false,RootAdmission:false,SourceAdmission:false,realSigning:false,normalAppWiring:false},null,2)+'\n');}
