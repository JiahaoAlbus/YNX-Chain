import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {lstat,readFile,readdir,readlink,stat} from "node:fs/promises";
import {dirname,join} from "node:path";

const P=Object.freeze({
  control:"/opt/ynx-release-control-plane/creator-studio-3f97a13d",
  candidate:"/opt/ynx-creator-studio-wallet/releases/creator-studio-3f97a13d",
  old:"/opt/ynx-creator-studio-wallet/releases/creator-studio-0e1a53c5",
  current:"/opt/ynx-creator-studio-wallet/current",
  receipt:"/opt/ynx-creator-studio-wallet/receipts/upgrade-3f97a13d.json",
  unit:"/etc/systemd/system/ynx-creator-studio-wallet.service",
  service:"ynx-creator-studio-wallet.service",
  publicBase:"https://web4.ynxweb4.com/video/studio/"
});
const E=Object.freeze({
  currentTuple:"64770:1483933:0:0:777:1:63:symbolic link",
  receiptSha256:"37c0866d535f25ce59d27e66143410a7ec1c2130a1dbe91da6aecb799eba7d0d",
  candidateTuple:"64770:1483917:995:986:755:4:directory",
  controlTuple:"64770:1483830:0:0:700:3:directory",
  unitSha256:"06a55f91bf5530952c347db146daa827510cc72f161d999943da7d5737b8c006",
  candidateCommit:"3f97a13d5ff6e0a43d434eb6b630785564e59e3e",
  candidateTree:"5ed64b144ec149e05f201ca9e406e460fa19f9f9",
  candidateManifestSha256:"fcd0f3346de18e51580af8f7c4f040b8694f7e2ef74bb92cc1ce942e03bea624",
  candidateCarrierSha256:"064acfe84c481941549d33473cb78f124e0ae5dfebda16d2f0cac1f4898c3046",
  oldManifestSha256:"5fd27ac55d9ea70b8e15aac0565324a9ce7b18706bd75cd5b430eaa4843de86f",
  controlTree:["f:placement.receipt.json","f:release-upgrade-executor-3f97a13d.mjs","d:release-candidates","d:release-candidates/candidate-0e1a53c5","f:release-candidates/candidate-0e1a53c5/creator-studio.tar","d:release-candidates/candidate-3f97a13d","f:release-candidates/candidate-3f97a13d/creator-studio.tar"].sort(),
  controlObjects:{
    "release-upgrade-executor-3f97a13d.mjs":{bytes:29114,sha256:"69ae3a6e75310dfbb00a9b93c22476e07075c092dbe0ca54d81f29573337d1e2"},
    "release-candidates/candidate-3f97a13d/creator-studio.tar":{bytes:133120,sha256:"064acfe84c481941549d33473cb78f124e0ae5dfebda16d2f0cac1f4898c3046"},
    "release-candidates/candidate-0e1a53c5/creator-studio.tar":{bytes:159232,sha256:"3f56aa4c3f9d87d27f7cdf19eafc0dacf1da78d83d31def2080f0162d92bdf8a"}
  },
  public:{"":"b37f78205f2c5443b2103ee42e98d6ecde65238c107733088e63893a3c1de697","app.js":"77e7c42006e3be36c7af717e5e8b2a3cd847c3652dcadb1731c259aee5b01af5","creator-studio.manifest.json":"5fd27ac55d9ea70b8e15aac0565324a9ce7b18706bd75cd5b430eaa4843de86f","i18n.js":"451016ca4e3a16eeade02154397eabf9fabcc57a50fe948ec954b63e5ee12abe","i18n/catalog.json":"4c86e3e1cdeac6d9c4570891d70bab4c3486c6a4429dd33fd1029f046ca9ecff"}
});
const sha=body=>createHash("sha256").update(body).digest("hex");
const stable=value=>JSON.stringify(value);
const mode=value=>value.mode&0o7777;
async function tuple(path,{follow=false}={}){const value=follow?await stat(path):await lstat(path);return`${value.dev}:${value.ino}:${value.uid}:${value.gid}:${mode(value).toString(8)}:${value.nlink}:${value.size}:${value.isSymbolicLink()?"symbolic link":value.isDirectory()?"directory":value.isFile()?"regular file":"other"}`}
async function file(path){const value=await lstat(path);if(!value.isFile()||value.isSymbolicLink()||value.nlink!==1)throw Error("FILE_IDENTITY_INVALID:"+path);const body=await readFile(path);return{tuple:await tuple(path),bytes:body.length,sha256:sha(body),body}}
async function treeIdentity(root){const out=[];const walk=async(relative="")=>{for(const name of(await readdir(join(root,relative))).sort()){const next=join(relative,name),path=join(root,next),value=await lstat(path);if(value.isSymbolicLink()||(!value.isDirectory()&&!value.isFile())||(value.isFile()&&value.nlink!==1))throw Error("TREE_OBJECT_UNSAFE:"+next);const record={path:next,tuple:await tuple(path),type:value.isDirectory()?"directory":"file"};if(value.isFile()){const body=await readFile(path);out.push({...record,bytes:body.length,sha256:sha(body)})}else{out.push(record);await walk(next)}}};await walk();return out}
async function rawTreeIdentity(root){const out=[];const walk=async(relative="")=>{for(const name of(await readdir(join(root,relative))).sort()){const next=join(relative,name),path=join(root,next),value=await lstat(path),type=value.isSymbolicLink()?"symlink":value.isDirectory()?"directory":value.isFile()?"file":"other",record={path:next,tuple:await tuple(path),type};if(type==="file"){const body=await readFile(path);out.push({...record,bytes:body.length,sha256:sha(body)})}else if(type==="symlink")out.push({...record,target:await readlink(path)});else{out.push(record);if(type==="directory")await walk(next)}}};await walk();return out}
function inventory(identity){return identity.map(value=>(value.type==="directory"?"d:":"f:")+value.path).sort()}
function parseJson(body){try{return JSON.parse(body)}catch{return null}}
function candidateComparison(actual){return{rootTuple:actual.tuple===E.candidateTuple,manifestType:actual.manifest.type==="file"&&actual.manifest.nlink===1,manifestSha256:actual.manifest.sha256===E.candidateManifestSha256,sourceCommit:actual.manifest.parsed?.sourceCommit===E.candidateCommit,sourceTree:actual.manifest.parsed?.sourceTree===E.candidateTree,fileCount:actual.manifest.parsed?.files?.length===12,completeSafeInventory:actual.safeInventory===true,payloadHashes:actual.payloadHashes===true}}
async function candidateRaw(){const root=await lstat(P.candidate),manifestPath=join(P.candidate,"creator-studio.manifest.json"),manifestStat=await lstat(manifestPath),manifestType=manifestStat.isSymbolicLink()?"symlink":manifestStat.isFile()?"file":manifestStat.isDirectory()?"directory":"other",manifestBody=manifestType==="file"?await readFile(manifestPath):Buffer.alloc(0),parsed=parseJson(manifestBody),identity=await rawTreeIdentity(P.candidate),expectedInventory=parsed?.files instanceof Array?["d:assets","d:i18n","f:creator-studio.manifest.json",...parsed.files.map(value=>"f:"+value.path)].sort():[],actualInventory=inventory(identity),safeInventory=identity.every(value=>(value.type==="directory")||(value.type==="file"&&Number(value.tuple.split(":")[5])===1))&&stable(actualInventory)===stable(expectedInventory);let payloadHashes=parsed?.files instanceof Array;for(const record of parsed?.files||[]){const actual=identity.find(value=>value.path===record.path);if(!actual||actual.type!=="file"||actual.sha256!==record.sha256)payloadHashes=false}return{tuple:await tuple(P.candidate),type:root.isDirectory()?"directory":root.isSymbolicLink()?"symlink":root.isFile()?"file":"other",manifest:{tuple:await tuple(manifestPath),type:manifestType,nlink:manifestStat.nlink,bytes:manifestBody.length,sha256:sha(manifestBody),rawBase64:manifestBody.toString("base64"),parsed},treeIdentity:identity,actualInventory,expectedInventory,safeInventory,payloadHashes}}
function system(binary,args){return execFileSync(binary,args,{encoding:"utf8"}).trim()}
function service(){const raw=system("/usr/bin/systemctl",["show",P.service,"--property=LoadState,ActiveState,SubState,MainPID,NRestarts,FragmentPath,WorkingDirectory,User","--no-pager"]),result={};for(const line of raw.split("\n")){const at=line.indexOf("=");if(at>0)result[line.slice(0,at)]=line.slice(at+1)}return result}
function portPid(port){const raw=system("/usr/bin/ss",["-H","-ltnp",`sport = :${port}`]),pids=[...raw.matchAll(/pid=(\d+)/g)].map(value=>Number(value[1])),unique=[...new Set(pids)];if(unique.length!==1)throw Error("LISTENER_PID_AMBIGUOUS:"+port);return unique[0]}
async function publicState(){const out={};for(const [suffix,expected] of Object.entries(E.public)){const response=await fetch(new URL(suffix,P.publicBase),{cache:"no-store",headers:{"cache-control":"no-cache","pragma":"no-cache"}}),body=Buffer.from(await response.arrayBuffer());out[suffix||"root"]={status:response.status,bytes:body.length,sha256:sha(body),contentType:response.headers.get("content-type")||"",cacheControl:response.headers.get("cache-control")||""};if(response.status!==200||out[suffix||"root"].sha256!==expected)throw Error("PUBLIC_OLD_RUNTIME_DRIFT:"+(suffix||"root"))}return out}
async function absent(path){try{await lstat(path);return false}catch(error){if(error.code!=="ENOENT")throw error;return true}}
async function main(){
  const rawCandidate=await candidateRaw(),candidateChecks=candidateComparison(rawCandidate);
  process.stdout.write(stable({schemaVersion:"1.0.0",inspection:"CREATOR_P0315_CANDIDATE_RAW_FIRST_ZERO_WRITE",mutationCount:0,candidate:rawCandidate})+"\n");
  process.stdout.write(stable({schemaVersion:"1.0.0",inspection:"CREATOR_P0315_CANDIDATE_COMPARISON",mutationCount:0,comparison:candidateChecks,allMatch:Object.values(candidateChecks).every(Boolean)})+"\n");
  if(!Object.values(candidateChecks).every(Boolean)){process.exitCode=1;return}
  const currentTuple=await tuple(P.current),currentTarget=await readlink(P.current),oldReleaseTuple=await tuple(P.current,{follow:true});
  if(currentTuple!==E.currentTuple||currentTarget!==P.old)throw Error("CURRENT_BINDING_DRIFT");
  const oldManifest=await file(join(P.old,"creator-studio.manifest.json"));if(oldManifest.sha256!==E.oldManifestSha256)throw Error("OLD_MANIFEST_DRIFT");
  const receiptFile=await file(P.receipt),receipt=JSON.parse(receiptFile.body);if(receiptFile.sha256!==E.receiptSha256||receipt.status!=="FORWARD_SWITCHED_AWAITING_TERMINAL"||receipt.material?.candidateSha256!==E.candidateCarrierSha256||receipt.before?.current?.target!==P.old)throw Error("FORWARD_RECEIPT_DRIFT");
  const candidateTuple=rawCandidate.tuple,candidateTreeIdentity=await treeIdentity(P.candidate),candidateManifestFile=await file(join(P.candidate,"creator-studio.manifest.json")),candidateManifest=rawCandidate.manifest.parsed;
  const expectedCandidateInventory=["d:assets","d:i18n","f:creator-studio.manifest.json",...candidateManifest.files.map(value=>"f:"+value.path)].sort();if(stable(inventory(candidateTreeIdentity))!==stable(expectedCandidateInventory))throw Error("CANDIDATE_INVENTORY_DRIFT");for(const record of candidateManifest.files){const actual=await file(join(P.candidate,record.path));if(actual.sha256!==record.sha256)throw Error("CANDIDATE_FILE_DRIFT:"+record.path)}
  const controlTuple=await tuple(P.control),controlTreeIdentity=await treeIdentity(P.control),placementFile=await file(join(P.control,"placement.receipt.json")),placement=JSON.parse(placementFile.body);if(controlTuple!==E.controlTuple||stable(inventory(controlTreeIdentity))!==stable(E.controlTree)||placement.status!=="PLACED_AWAITING_FORWARD"||placement.root!==P.control)throw Error("CONTROL_BINDING_DRIFT");
  for(const [name,expected] of Object.entries(E.controlObjects)){const actual=await file(join(P.control,name)),record=placement.objects?.[name];if(actual.bytes!==expected.bytes||actual.sha256!==expected.sha256||record?.bytes!==expected.bytes||record?.sha256!==expected.sha256||record?.dev!==actual.tuple.split(":")[0]||record?.ino!==actual.tuple.split(":")[1])throw Error("CONTROL_OBJECT_DRIFT:"+name)}
  const unit=await file(P.unit);if(unit.sha256!==E.unitSha256)throw Error("UNIT_DRIFT");
  const runtimeService=service(),listeners={6493:portPid(6493),6494:portPid(6494),6495:portPid(6495)};if(runtimeService.LoadState!=="loaded"||runtimeService.ActiveState!=="active"||runtimeService.SubState!=="running"||runtimeService.FragmentPath!==P.unit||runtimeService.WorkingDirectory!==P.current||runtimeService.User!=="ynx"||Number(runtimeService.MainPID)!==listeners[6495])throw Error("SERVICE_BINDING_DRIFT");
  const parents={};for(const path of [P.receipt,P.candidate,P.control])parents[path]={path:dirname(path),tuple:await tuple(dirname(path))};
  const absence={currentNext:await absent(P.current+".next-3f97a13d"),receiptNext:await absent(P.receipt+".next"),candidateNext:await absent(P.candidate+".next"),candidatePreSwitchQuarantine:await absent(P.candidate+".cleanup-pre-switch"),candidatePostSwitchQuarantine:await absent(P.candidate+".cleanup-post-switch"),controlNext:await absent(P.control+".next"),controlQuarantine:await absent(P.control+".cleanup-pre-switch")};if(!Object.values(absence).every(Boolean))throw Error("RESIDUE_NEXT_OR_QUARANTINE_PRESENT");
  const output={schemaVersion:"1.0.0",inspection:"CREATOR_P0315_TERMINAL_CLEANUP_PREWRITE_ZERO_WRITE",mutationCount:0,current:{tuple:currentTuple,target:currentTarget,oldReleaseTuple},oldManifest:{tuple:oldManifest.tuple,bytes:oldManifest.bytes,sha256:oldManifest.sha256},service:runtimeService,listeners,unit:{tuple:unit.tuple,bytes:unit.bytes,sha256:unit.sha256},receipt:{tuple:receiptFile.tuple,bytes:receiptFile.bytes,sha256:receiptFile.sha256,status:receipt.status,candidateSha256:receipt.material.candidateSha256,beforeCurrentTarget:receipt.before.current.target},candidate:{tuple:candidateTuple,treeIdentity:candidateTreeIdentity,manifest:{tuple:candidateManifestFile.tuple,bytes:candidateManifestFile.bytes,sha256:candidateManifestFile.sha256,sourceCommit:candidateManifest.sourceCommit,sourceTree:candidateManifest.sourceTree,fileCount:candidateManifest.files.length}},control:{tuple:controlTuple,treeIdentity:controlTreeIdentity,placementReceipt:{tuple:placementFile.tuple,bytes:placementFile.bytes,sha256:placementFile.sha256,status:placement.status,root:placement.root}},parents,absence,public:await publicState()};
  process.stdout.write(stable(output)+"\n");
}
if(process.argv[2]==="selftest"){
  const base={tuple:E.candidateTuple,manifest:{type:"file",nlink:1,sha256:E.candidateManifestSha256,parsed:{sourceCommit:E.candidateCommit,sourceTree:E.candidateTree,files:Array.from({length:12},(_,index)=>({path:`f${index}`,sha256:"x"}))}},safeInventory:true,payloadHashes:true},fields={rootTuple:"tuple",manifestType:"manifestType",manifestSha256:"manifestSha256",sourceCommit:"sourceCommit",sourceTree:"sourceTree",fileCount:"fileCount",completeSafeInventory:"safeInventory",payloadHashes:"payloadHashes"},singleFieldDrifts={};
  for(const [field,kind] of Object.entries(fields)){const value=structuredClone(base);if(kind==="tuple")value.tuple="drift";else if(kind==="manifestType")value.manifest.type="symlink";else if(kind==="manifestSha256")value.manifest.sha256="drift";else if(kind==="sourceCommit")value.manifest.parsed.sourceCommit="drift";else if(kind==="sourceTree")value.manifest.parsed.sourceTree="drift";else if(kind==="fileCount")value.manifest.parsed.files=[];else value[kind]=false;const comparison=candidateComparison(value),failed=Object.entries(comparison).filter(([,matched])=>!matched).map(([name])=>name);singleFieldDrifts[field]=failed.length===1&&failed[0]===field}
  if(!Object.values(candidateComparison(base)).every(Boolean)||!Object.values(singleFieldDrifts).every(Boolean))throw Error("SELFTEST_DRIFT_CLASSIFICATION_FAILED");
  process.stdout.write(stable({inspector:"creator-p0315-candidate-raw-first-zero-write",readOnlyImports:true,mutationApisImported:false,rawOutputBeforeComparison:true,singleFieldDrifts,expectedCandidateFileCount:12,expectedControlEntries:E.controlTree.length,publicResourceCount:Object.keys(E.public).length})+"\n");
}
else await main();
