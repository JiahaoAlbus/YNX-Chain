import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const source=fs.readFileSync(new URL('../../../apps/wallet-desktop/native/original-auth-identity-node.mm',import.meta.url),'utf8');
const marker=source.indexOf('// Fixed Main-owned user-addon binding only.');assert.ok(marker>0);const include=source.slice(source.indexOf('#if defined(YNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING)',marker),source.indexOf('static napi_value Register(',marker));
const register=source.slice(source.indexOf('static napi_value Register('));const call=register.match(/#if defined\(YNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING\)\n if\(!RegisterOriginalArtifactPublisherBinding\(env,exports\)\)return nullptr;\n#endif/);assert.ok(call);
const compiler=process.platform==='darwin'?'/usr/bin/clang++':'/usr/bin/g++';
const mock=`// PUBLIC compile-contract fixture only; no NAPI, Source, keys or permission.
static bool RegisterOriginalArtifactPublisherBinding(napi_env env,napi_value value){calls++;return IDEWalletOriginal(env,value)&&IDEWalletCurrent(&owner,true)&&allow;}
`;
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-main-hook-public-'));const code=`using napi_env=void*;using napi_value=void*;
struct Original {bool live=true;};static Original owner;static int calls=0;static bool allow=true;
static Original*IDEWalletOriginal(napi_env,napi_value){return &owner;}
static bool IDEWalletCurrent(Original*p,bool bound){return p==&owner&&bound&&p->live;}
${include}
static napi_value actualRegistrationHook(napi_env env,napi_value exports){
${call[0]}
return exports;}
int main(){int token=0;auto p=&token;
if(actualRegistrationHook(p,p)!=p)return 1;
#if defined(YNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING)
if(calls!=1)return 2;allow=false;if(actualRegistrationHook(p,p)!=nullptr||calls!=2)return 3;allow=true;owner.live=false;if(actualRegistrationHook(p,p)!=nullptr||calls!=3)return 4;
#else
if(calls!=0)return 5;
#endif
return 0;}
`;const file=path.join(dir,'actual-guard.cpp'),binary=path.join(dir,'public-hook');fs.writeFileSync(file,code);return{dir,file,binary,close:()=>fs.rmSync(dir,{recursive:true,force:true})};}
function compile(f,flags=[],syntax=false){const r=spawnSync(compiler,['-std=c++17',...flags,...(syntax?['-fsyntax-only']:[]),f.file,...(syntax?[]:['-o',f.binary])],{encoding:'utf8',timeout:20000,maxBuffer:1048576});assert.ifError(r.error);assert.equal(r.signal,null);return r;}
test('actual Main hook stays after original opaque helpers and behind the original main-thread registration fence',()=>{
 assert.ok(source.indexOf('#include "original-ide-wallet-identity-source-owner.inc.mm"')<marker);assert.match(include,/#include "original-artifact-publisher-binding\.inc\.mm"/);assert.equal((source.match(/RegisterOriginalArtifactPublisherBinding\(env,exports\)/g)||[]).length,1);
 const body=register.slice(register.indexOf('{')+1).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'').trimStart();assert.ok(body.startsWith('if(!pthread_main_np())return Error(env,"AUTH_IDENTITY_ADDON_MAIN_THREAD_REQUIRED");'));
 assert.ok(register.indexOf('RegisterOriginalIDEWorkspaceProjectSelection')<register.indexOf(call[0]));assert.ok(register.indexOf(call[0])<register.indexOf('return RegisterOriginalIDEAuthIdentityBinding'));
});
test('actual guarded source compiles without Main files for base role and calls fixed Main registration only for explicit role',()=>{
 const f=fixture();try{const base=compile(f);assert.equal(base.status,0,base.stderr);let r=spawnSync(f.binary,[],{encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);
 fs.writeFileSync(path.join(f.dir,'original-artifact-publisher-binding.inc.mm'),mock);const main=compile(f,['-DYNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING=1']);assert.equal(main.status,0,main.stderr);r=spawnSync(f.binary,[],{encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);
 }finally{f.close();}
});
test('actual guarded source refuses a selected role without its original include or with an invalid compile role',()=>{
 const f=fixture();try{assert.notEqual(compile(f,['-DYNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING=1'],true).status,0);fs.writeFileSync(path.join(f.dir,'original-artifact-publisher-binding.inc.mm'),mock);for(const value of ['0','2']){const r=compile(f,['-DYNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING='+value],true);assert.notEqual(r.status,0);assert.match(r.stderr,/YNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING_REQUIRES_ONE/);}}finally{f.close();}
});
