// Freeze only already-built known images. No Go tool, node, port or workload starts.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd();
const artifacts=path.join(root,'artifacts/chain-performance-20261017');
const old=JSON.parse(fs.readFileSync(path.join(root,'docs/performance/evidence/ready-block-scan-preparation-20261017.json')));
const cached=JSON.parse(fs.readFileSync(path.join(root,'docs/performance/evidence/replay-facts-preparation-20261017.json')));
async function hash(file){const before=fs.statSync(file,{bigint:true});const h=createHash('sha256');for await(const bytes of fs.createReadStream(file,{highWaterMark:256*1024}))h.update(bytes);const after=fs.statSync(file,{bigint:true});if(before.ino!==after.ino||before.dev!==after.dev||before.size!==after.size||before.mtimeNs!==after.mtimeNs)throw Error('image changed while hashing: '+file);return h.digest('hex')}
if(old.binaries.client.sha256!=='72a3904601321263cb8f7a1b932944e4bffda40f74e81fdd759bfba26b8f09b8'||cached.binaries.client.sha256!=='c6f5b051ce53a97afd89f2abacc8e5c211c50b941b37603174dfee3db4c4a212')throw Error('comparison client identity differs from fixed baseline/cached images');
const shared={fixture:old.binaries.fixture,app:old.binaries.app,comet:old.binaries.comet,host:{path:path.join(artifacts,'ynx-consensus-perf-host-pressure'),sha256:'3025b7f5bac1220e18cac1e9e14051553d918348df07873f392f33c700ba3cc6'}};
for(const image of [...Object.values(shared),old.binaries.client,cached.binaries.client]){fs.accessSync(image.path,fs.constants.X_OK);if(await hash(image.path)!==image.sha256)throw Error('known image digest mismatch: '+image.path)}
const stat=fs.statfsSync(artifacts);const freeBytes=Number(stat.bavail)*Number(stat.bsize);
if(freeBytes<1024**3+425*1024**2+32*1024**2)throw Error('preparation disk below original floor/reserve/data bound');
const frozen=fs.mkdtempSync(path.join(artifacts,'same-control-comparison-'));
const runtime=path.join(frozen,'runtime');fs.mkdirSync(runtime,{mode:0o700});
const helpers=[];
for(const name of ['consensus-local-window.mjs','native-resource-probe.mjs','native-resource-sample.mjs']){const source=path.join(root,'scripts/loadtest',name),destination=path.join(runtime,name);fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);helpers.push({name,path:destination,sha256:await hash(destination)});if(helpers.at(-1).sha256!==await hash(source))throw Error('runtime source changed during freeze')}
const common=['--comet-bin',shared.comet.path,'--count','256','--rounds','4','--offered-rate','512','--state-layout','block-journal','--sender-mode','ready-pool','--inclusion-mode','block-scan'];
const variants=[];
for(const[name,client]of [['before',old.binaries.client],['cached',cached.binaries.client]]){
 const bin=path.join(frozen,name);fs.mkdirSync(bin,{mode:0o700});const binaries={};
 for(const[key,file]of Object.entries({fixture:shared.fixture,app:shared.app,client,host:shared.host})){
  const names={fixture:'ynx-consensus-perf-fixture',app:'ynx-abci',client:'ynx-consensus-perf-client',host:'ynx-consensus-perf-host'};
  const destination=path.join(bin,names[key]);fs.copyFileSync(file.path,destination,fs.constants.COPYFILE_EXCL|fs.constants.COPYFILE_FICLONE);
  const sha256=await hash(destination);if(sha256!==file.sha256)throw Error('copied image digest mismatch');binaries[key]={path:destination,sha256,sourceCommit:file.sourceCommit??null};
 }
 variants.push({name,binaries,argvPrepareOnly:[path.join(runtime,'consensus-local-window.mjs'),'--bin-dir',bin,...common],terminalStream:false,reuseResultSlots:false});
}
const result={schema:1,status:'frozen_known_images_only_no_build_or_network',preparedAt:new Date().toISOString(),directory:frozen,freeBytes,runner:helpers,comet:shared.comet,variants,conditions:{accounts:256,cycles:4,uniqueSignedBusinessInputs:1024,configuredMaxOfferRate:512,stateLayout:'block-journal',senderMode:'ready-pool',inclusionMode:'block-scan',terminalStream:false,reuseResultSlots:false,activeMs:45000,cleanupMs:15000,clientTimeout:'10s',ownedRSSBytes:1024**3,dataBytes:32*1024**2,threads:320,longLivedChildren:9,GOMAXPROCS:1,GOGC:100,GOMEMLIMIT:'off'},interpretation:'Both variants use identical new controller/helpers/native monitor/node app/Comet and the same configured workload policy. Fresh random isolated fixtures differ per execution, so byte-identical inputs or stable sustained capacity are not claimed. This compares known fff2ff67 client with a8bf5177 shared-native-facts client only; later c686 slot feature CLI requires a separately scheduled build/run. Historical RWY2KW/failed1ZsLDk windows are not a new matched pair. Each variant --execute needs its own fresh Root grant; no auto retry or second execution.'};
fs.writeFileSync(path.join(frozen,'preparation.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(result,null,2));
