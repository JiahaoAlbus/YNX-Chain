// Original Auth R241 Foundation controls, repo-portable CI paths only.
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url)),dir=await fs.mkdtemp(root+'.ci-evidence/auth-r241-namespace-'),parent=root+'scripts/ci/fixtures/auth-r241-namespace',actual=root+'packages/wallet-auth/native/original-auth-identity-joint-owner.mm';
const old=await fs.readFile(parent+'/original-auth-identity-joint-owner.mm','utf8');// Frozen parent reproduces the original defect; candidate is independently pinned below.
if(createHash('sha256').update(old).digest('hex')!=='ec6aafa361e2b79e9f3c06071a1a890390e3ac19af795631b2b442f9aefbc082')throw Error('AUTH37_PARENT_DIFFERS');
if(createHash('sha256').update(await fs.readFile(actual)).digest('hex')!=='de91b9b18cfab291c7bca0a3bdb88e16f911505be356ce3afc1da5a1d8d34ae5')throw Error('AUTH37_CANDIDATE_DIFFERS');
const selectorStart=old.indexOf('static NSURL *YNXOriginalIDERegistryResources(void)'),selectorEnd=old.indexOf('static BOOL YNXOriginalIDEProtectedAncestors',selectorStart),selectors=old.slice(selectorStart,selectorEnd);
const specs=[['wallet',true,true,false,false,false],['ide',false,true,false,false,false],['relay',false,true,true,false,false],['project',false,true,false,true,false],['control',false,true,false,false,true]];
for(const [phase,file]of [['red',parent+'/original-auth-identity-joint-owner.mm'],['fixed',actual]]){
 const body=await fs.readFile(file,'utf8'),capture=body.match(/NSURL \*resources=(_walletPQCatalog[^;]+);/),expected=body.match(/NSURL \*expectedRegistry=([^;]+);/);if(!capture||!expected)throw Error('actual normal selector expressions');
 let code='#import <Foundation/Foundation.h>\n#include <unistd.h>\n#include <cassert>\n#include "original-ide-public-originals.h"\n'+selectors+'\nint main(){@autoreleasepool{assert(getuid()!=0&&getuid()==geteuid()&&getgid()==getegid());\n';
 for(const [name,wallet,ide,relay,project,control]of specs){
  code+=`{BOOL _walletPQCatalog=${wallet?'YES':'NO'},_ideRegistry=${ide?'YES':'NO'},_contractRelay=${relay?'YES':'NO'},_projectAuthority=${project?'YES':'NO'},_projectControl=${control?'YES':'NO'};NSURL*resources=${capture[1]};NSURL*expectedRegistry=${expected[1]};\n`;
  for(const [flag,suffix]of [['_contractRelay','contract-relay'],['_projectAuthority','project-authority'],['_projectControl','project-control']])code+=`if(${flag}){resources=[resources URLByAppendingPathComponent:@"${suffix}" isDirectory:YES];expectedRegistry=[expectedRegistry URLByAppendingPathComponent:@"${suffix}" isDirectory:YES];}\n`;
  code+=`BOOL same=[resources.path isEqual:expectedRegistry.path];printf("${name}=%s\\n",same?"same":"MISMATCH");`;
  if(phase==='red'&&wallet)code+='assert(!same);';else code+='assert(same);';
  if(wallet)code+='assert(![resources.path isEqual:YNXOriginalIDERegistryResources().path]);assert([resources.path hasSuffix:@"/Wallet/PQHostCatalog"]);';else code+='assert(![resources.path isEqual:YNXOriginalWalletPQRegistryResources().path]);';code+='}\n';
 }
 code+='puts("protectedRegistryCreated=false;Root=false;nativeSourceAcquired=false");}return 0;}\n';
 const source=dir+'/'+phase+'.mm',image=dir+'/'+phase;await fs.writeFile(source,code);
 const c=spawnSync('/usr/bin/xcrun',['clang++','-x','objective-c++','-std=c++17','-fobjc-arc','-framework','Foundation','-I',root+'packages/wallet-auth/native',source,'-o',image],{encoding:'utf8',timeout:20000,maxBuffer:1<<20});for(const k of ['stdout','stderr'])await fs.writeFile(dir+'/'+phase+'.compile.'+k,c[k]??'');if(c.status!==0)throw Error(c.stderr);
 const r=spawnSync(image,[],{encoding:'utf8',timeout:5000,maxBuffer:1<<20});for(const k of ['stdout','stderr'])await fs.writeFile(dir+'/'+phase+'.run.'+k,r[k]??'');if(r.status!==0)throw Error(r.stderr);
 if(phase==='red'?!r.stdout.includes('wallet=MISMATCH'):r.stdout.includes('MISMATCH'))throw Error('actual namespace RED/PASS not reproduced');
}
await fs.writeFile(dir+'/RESULT.json',JSON.stringify({pass:true,actualFoundation:true,actualKernelUID:true,originalFunctionBodiesAndSelectorExpressions:true,oldWalletNamespaceMismatch:true,fixedFiveNamespaceChecks:true,crossNamespaceDenied:true,productionConstructorNotInvoked:true,protectedRegistryCreated:false,privateKeyRead:false,Root:false,Source:false,NativeModuleBuilt:false})+'\n');console.log(dir,'namespace RED -> fixed5 PASS; no protected registry/Native Source/key access');
