import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const sdk=fileURLToPath(new URL('../..',import.meta.url)),repo=path.resolve(sdk,'../..');
const out=path.join(repo,'AI_V6_SIGNED_RESPONSE_CARRIER_DATA');mkdirSync(out,{recursive:true});
const work=mkdtempSync(path.join(out,'public-')),fixtures=path.join(work,'fixtures');
function run(tool,args,env=process.env){const r=spawnSync(tool,args,{env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});if(r.error||r.status!==0)throw Error(JSON.stringify({tool,status:r.status,error:r.error?.code,stdout:r.stdout,stderr:r.stderr}));return r.stdout;}
const js=JSON.parse(run(process.execPath,[path.join(sdk,'test/ai-v6-response-carrier.test.mjs')],{...process.env,AI_CARRIER_FIXTURES:fixtures}));
const inherited=path.join(sdk,'native/ai-v6-codec/inherited'),native=path.join(sdk,'native/ai-v6-response-carrier'),binary=path.join(work,'carrier-control');
const argv=['-std=c++17','-Wall','-Wextra','-Werror','-I'+inherited,'-I'+native,path.join(native,'AIResponseOriginalsCarrierDATA.cpp'),path.join(inherited,'MobileCanonicalDATA.cpp'),path.join(sdk,'test/ai-v6-response-carrier.control.cpp'),'-o',binary];
run('/usr/bin/clang++',argv);
const rows=JSON.parse(readFileSync(path.join(fixtures,'manifest.json'),'utf8'));
for(const row of rows){const r=spawnSync(binary,[path.join(fixtures,row.index+'.bin')],{encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024});if(r.error||r.status!==(row.accept?0:2))throw Error('CARRIER_INTEROP_STATUS:'+row.name);if(row.accept&&r.stdout!==readFileSync(path.join(fixtures,row.index+'.expected'),'utf8'))throw Error('CARRIER_INTEROP_BYTES:'+row.name);}
const result={jsControls:js.tests,jsPassed:js.pass,cppInterop:rows.length,cppPassed:rows.length,cppWarningsAreErrors:true,onlyPublicDATA:true,NativeCompiled:false,RootAdmission:false,SourceAdmission:false,AppInstalled:false,realBusinessVerified:false};
writeFileSync(path.join(out,'RESULT.json'),JSON.stringify(result,null,2)+'\n');writeFileSync(path.join(out,'COMPILE_ARGV.json'),JSON.stringify({tool:'/usr/bin/clang++',argv},null,2)+'\n');console.log(JSON.stringify(result));
