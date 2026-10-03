// Compile complete native screens, not only the host model or Swift parser.
// Builds unsigned temporary candidates; never launch, install or select Xcode.
import {openSync,closeSync,readFileSync,writeFileSync,mkdtempSync,readdirSync,statSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../../',import.meta.url)),out=mkdtempSync(join(tmpdir(),'ynx-creator-apple-native-'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const paths=execFileSync('git',['ls-tree','-r','--name-only',sourceCommit,'apps/creator-studio/ios'],{cwd:root,encoding:'utf8'}).trim().split('\n').map(p=>p.slice('apps/creator-studio/'.length)).concat(['scripts/build-apple-native.mjs']);
const sourcePins=paths.map(p=>{const path='apps/creator-studio/'+p,b=readFileSync(join(root,path));let gitExact=false;try{gitExact=execFileSync('git',['show',sourceCommit+':'+path],{cwd:root,stdio:['ignore','pipe','ignore']}).equals(b)}catch{}return{path,bytes:b.length,sha256:sha(b),gitExact}});
if(!sourcePins.every(x=>x.gitExact))throw Error('Creator build requires exact committed source');
function files(base,path=base){return readdirSync(path).flatMap(name=>{const p=join(path,name);return statSync(p).isDirectory()?files(base,p):[{path:relative(base,p),bytes:statSync(p).size,sha256:sha(readFileSync(p))}]})}
const candidates=[];
for(const [scheme,sdk,destination,product] of [['YNXCreator','iphonesimulator','generic/platform=iOS Simulator','Debug-iphonesimulator/YNXCreator.app'],['YNXCreatorMac','macosx',null,'Debug/YNXCreatorMac.app']]){
  const derived=join(out,scheme),log=join(out,scheme+'.log'),fd=openSync(log,'wx');
  const args=['-project','apps/creator-studio/ios/YNXCreator.xcodeproj','-scheme',scheme,'-configuration','Debug','-sdk',sdk,'-derivedDataPath',derived,'CODE_SIGNING_ALLOWED=NO'];if(destination)args.push('-destination',destination);args.push('build');
  let result,cleanupStatus=0;try{result=spawnSync('xcodebuild',args,{cwd:root,stdio:['ignore',fd,fd]})}finally{closeSync(fd);if(sdk==='macosx' && existsSync(join(derived,'Build/Products',product)))cleanupStatus=spawnSync('/System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister',['-u',join(derived,'Build/Products',product)],{stdio:'ignore'}).status}
  if(result.error||result.status!==0)throw Error(`Creator ${scheme} full compile failed; source and log retained at ${log}`);
  if(cleanupStatus!==0)throw Error(`Own temporary candidate LaunchServices cleanup failed for ${scheme}; no existing app touched`);
  const app=join(derived,'Build/Products',product);candidates.push({scheme,sdk,app,log,signed:false,installed:false,launched:false,files:files(app)});
}
const receipt={schema:'ynx.creator.apple.full-native-build.v1',sourceCommit,toolchain:execFileSync('xcodebuild',['-version'],{encoding:'utf8'}).trim(),sourcePins,candidates,actualWalletConsent:false,actualOSStorage:false,actualRenderedNativeUI:false,formalNativeV2Integration:false,shippedNativeSDKSource:"5c5e8a234206e306b6044deb6e938c1763ac7005"};
const path=join(out,'build-receipt.json');writeFileSync(path,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({path,out,sourceCommit,allSourcePinsGitExact:sourcePins.every(x=>x.gitExact),candidates:candidates.map(x=>({scheme:x.scheme,app:x.app,files:x.files.length}))}));
