// Actual normal C++ bodies only; no PUBLIC replacements or extra Go archive.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),own=root+'/native/ai-agent';
const pins=JSON.parse(fs.readFileSync(own+'/INPUT_PINS.json')),auth=pins.captureIncludeRoot;
const common='/Volumes/西部数据/YNX-large-work/wallet-pq-native-v01-20261025/evidence/mobile-ai-native-binding-final-20261107-ACXrC7/module';
const rn='/Users/huangjiahao/.codex/worktrees/d386/YNX Chain/apps/wallet/node_modules/react-native';
const link=JSON.parse(fs.readFileSync(common+'/LINK_PINS.json')),codecs=JSON.parse(fs.readFileSync(common+'/CODEC_PINS.json'));
const stage=fs.mkdtempSync('/Volumes/西部数据/YNX-large-work/wallet-pq-native-v01-20261025/evidence/mobile-ai-agent-normal-composition-20261107-'),runs=[],reused=[];
function pin(p){const b=fs.readFileSync(p);return{path:p,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};}
function run(name,exe,args){const start=new Date().toISOString(),r=spawnSync(exe,args,{encoding:'utf8',maxBuffer:8<<20});runs.push({name,exe,args,start,end:new Date().toISOString(),exit:r.status,signal:r.signal});fs.writeFileSync(stage+'/RUNS.json',JSON.stringify(runs,null,2));fs.writeFileSync(stage+'/'+name+'.log',(r.stdout??'')+(r.stderr??''));if(r.status!==0){process.stdout.write(r.stderr??'');throw Error(name);}return r.stdout??'';}
function headers(dir){const out=[];for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())out.push(...headers(p));else if(/\.(h|hpp)$/.test(e.name))out.push(p);}return out.sort();}
try{
 if(!pins.actualFixedMathH||!pins.pairedCaptureGetter)throw Error('MATCHED_SOURCE_REQUIRED');
 for(const p of Object.values(pins).filter(p=>p&&typeof p==='object'&&p.path)){const a=pin(p.path);if(a.sha256!==p.sha256||a.bytes!==p.bytes)throw Error('PIN_DRIFT:'+p.path);}
 const sources=[...fs.readdirSync(common+'/native').filter(s=>s.endsWith('.cpp')).map(s=>common+'/native/'+s),own+'/AgentOperation.cpp',own+'/RegisteredAgentResource.cpp',...fs.readdirSync(auth).filter(s=>s.endsWith('.cpp')).map(s=>auth+'/'+s),...['MobileCanonicalDATA.cpp','MobileHeldOriginals.cpp'].map(s=>pins.normalAuxiliaryIncludeRoots[0]+'/'+s),pins.actualFixedMathCodec.path,codecs.header.implementation.path,pins.actualFixedMathBody.path,...['ai-mobile-v6-transport.cpp','ai-mobile-v6-transport-wire.cpp','ide-finite-get-wire.cpp'].map(n=>link.files.find(p=>p.path.endsWith('/'+n)).path)];
 const include=[own,root+'/native',common+'/native',auth,...pins.normalAuxiliaryIncludeRoots,path.dirname(pins.actualFixedMathCodec.path),path.dirname(pins.actualFixedMathBody.path),path.dirname(link.files.find(p=>p.path.endsWith('/bridge.h')).path),'/opt/homebrew/opt/openssl@3/include',rn+'/ReactCommon',rn+'/ReactCommon/jsi',rn+'/ReactCommon/callinvoker',rn+'/ReactCommon/react/nativemodule/core'];
 const flags=['-std=c++20','-Wall','-Wextra','-Werror','-Wno-missing-field-initializers','-mmacosx-version-min=13.0',...include.map(p=>'-I'+p)];
 const baseline=process.env.YNX_AI_AGENT_NORMAL_BASELINE;let oldInputs=[],oldRuns=[],oldAuth='',headersEqual=false;
 if(baseline){
  if(!JSON.parse(fs.readFileSync(baseline+'/RESULT.json')).passed)throw Error('BASELINE_NOT_GREEN');
  oldInputs=JSON.parse(fs.readFileSync(baseline+'/INPUTS.json'));oldRuns=JSON.parse(fs.readFileSync(baseline+'/RUNS.json'));
  oldAuth=path.dirname(oldInputs.find(p=>p.path.endsWith('/MobileAITaskClient.cpp')).path);
  const signature=dir=>headers(dir).map(p=>[path.relative(dir,p),pin(p).sha256]);
  headersEqual=JSON.stringify(signature(auth))===JSON.stringify(signature(oldAuth));
  fs.writeFileSync(stage+'/HEADER_COMPARISON.json',JSON.stringify({oldAuth,auth,equal:headersEqual,before:signature(oldAuth),after:signature(auth)},null,2));
 }
 const objects=[];
 for(let i=0;i<sources.length;i++){
  const object=stage+'/'+i+'.o',args=[...flags,'-c',sources[i],'-o',object],before=oldInputs[i],previous=oldRuns.find(r=>r.name==='compile-'+i);
  // Native-owned headers changed during the module: always compile both owning
  // TUs and the sole thin adapter that consumes RequiredOriginalAgentPorts.hpp.
  const owning=sources[i].startsWith(own+'/')||sources[i]===pins.actualFixedMathBody.path;
  const normalized=xs=>xs.map(s=>s.replaceAll(oldAuth,auth)).slice(0,-1);
  if(baseline&&headersEqual&&!owning&&before&&previous&&previous.exit===0&&pin(sources[i]).sha256===before.sha256&&JSON.stringify(normalized(previous.args))===JSON.stringify(args.slice(0,-1))){
   const oldObject=previous.args.at(-1);fs.copyFileSync(oldObject,object);reused.push({index:i,source:pin(sources[i]),originalSource:before,originalRun:previous,object:pin(oldObject),copied:pin(object)});
  }else run('compile-'+i,'clang++',args);
  objects.push(object);
 }
 fs.writeFileSync(stage+'/REUSED.json',JSON.stringify({baseline:baseline??null,headersEqual,objects:reused},null,2));
 run('relocatable-normal','clang++',['-r','-nostdlib','-mmacosx-version-min=13.0',...objects,'-o',stage+'/normal-agent-composition.o']);
 const defined=run('defined','nm',['-gU',stage+'/normal-agent-composition.o']),unresolved=run('unresolved','nm',['-u',stage+'/normal-agent-composition.o']);
 for(const n of ['acquire','sign_once','read','retire','join','close','release_closed'])if(!defined.includes(' _ynx_ai_mobile_agent_operation_'+n+'_v6\n'))throw Error('MISSING_AGENT7:'+n);
 if(/U .*signOriginalAITaskActionV6/.test(unresolved)||/U .*captureOriginalAgentBinding/.test(unresolved)||/_ynx_ai_mobile_agent_operation_/.test(unresolved))throw Error('OWN_CODE_NOT_RESOLVED');
 if(!unresolved.includes('_YNXAITaskActionAgentFixedSignV6'))throw Error('EXPECTED_REAL_SOLE_CABI_GATE_MISSING');
 fs.writeFileSync(stage+'/INPUTS.json',JSON.stringify(sources.map(pin),null,2));
 fs.writeFileSync(stage+'/HEADERS.json',JSON.stringify([...headers(own),...headers(auth)].map(pin),null,2));
 fs.writeFileSync(stage+'/STRONG_UNRESOLVED.txt',unresolved);
 fs.writeFileSync(stage+'/RESULT.json',JSON.stringify({passed:true,normalNoPUBLICMacros:true,normalTUs:sources.length,compiledNow:sources.length-reused.length,reusedObjects:reused.length,Agent7Resolved:true,NativeResourceResolved:true,actualAuthPairedCaptureResolved:true,actualSoleFixedMathCppResolved:true,requiredCABI:'YNXAITaskActionAgentFixedSignV6',actualNewOneGoArchive:false,wholeMobileImage:false,RootAdmission:false,realKeyOrSign:false,installed:false},null,2));
 console.log(stage);
}catch(e){fs.writeFileSync(stage+'/RESULT.json',JSON.stringify({passed:false,first:String(e)},null,2));console.error(stage);throw e;}
