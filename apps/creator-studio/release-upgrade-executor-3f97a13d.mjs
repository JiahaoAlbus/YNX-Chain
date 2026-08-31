import {createHash} from "node:crypto";
import {execFileSync,spawn} from "node:child_process";
import {chmod,lstat,mkdir,mkdtemp,readFile,readdir,readlink,rename,rm,stat,symlink,writeFile} from "node:fs/promises";
import {dirname,join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {createServer} from "node:net";

const here=fileURLToPath(new URL(".",import.meta.url));
const F={
  root:"/opt/ynx-creator-studio-wallet",
  current:"/opt/ynx-creator-studio-wallet/current",
  oldRelease:"/opt/ynx-creator-studio-wallet/releases/creator-studio-0e1a53c5",
  newRelease:"/opt/ynx-creator-studio-wallet/releases/creator-studio-3f97a13d",
  stage:"/opt/ynx-creator-studio-wallet/releases/creator-studio-3f97a13d.next",
  receipt:"/opt/ynx-creator-studio-wallet/receipts/upgrade-3f97a13d.json",
  receiptNext:"/opt/ynx-creator-studio-wallet/receipts/upgrade-3f97a13d.json.next",
  currentNext:"/opt/ynx-creator-studio-wallet/current.next-3f97a13d",
  unit:"/etc/systemd/system/ynx-creator-studio-wallet.service",
  service:"ynx-creator-studio-wallet.service",
  systemctl:"/usr/bin/systemctl",
  ss:"/usr/bin/ss",
  node:"/usr/bin/node",
  candidate:join(here,"release-candidates/candidate-3f97a13d/creator-studio.tar"),
  rollbackCarrier:join(here,"release-candidates/candidate-0e1a53c5/creator-studio.tar"),
  candidateSha:"064acfe84c481941549d33473cb78f124e0ae5dfebda16d2f0cac1f4898c3046",
  rollbackCarrierSha:"3f56aa4c3f9d87d27f7cdf19eafc0dacf1da78d83d31def2080f0162d92bdf8a",
  candidateManifestSha:"fcd0f3346de18e51580af8f7c4f040b8694f7e2ef74bb92cc1ce942e03bea624",
  oldManifestSha:"5fd27ac55d9ea70b8e15aac0565324a9ce7b18706bd75cd5b430eaa4843de86f",
  rootSha:"b37f78205f2c5443b2103ee42e98d6ecde65238c107733088e63893a3c1de697",
  appSha:"77e7c42006e3be36c7af717e5e8b2a3cd847c3652dcadb1731c259aee5b01af5",
  i18nSha:"077ffd891f876de3ec37838d923854f401172213bc671527059c78f4875de80f",
  oldI18nSha:"451016ca4e3a16eeade02154397eabf9fabcc57a50fe948ec954b63e5ee12abe",
  catalogSha:"4c86e3e1cdeac6d9c4570891d70bab4c3486c6a4429dd33fd1029f046ca9ecff",
  sourceCommit:"3f97a13d5ff6e0a43d434eb6b630785564e59e3e",
  sourceTree:"5ed64b144ec149e05f201ca9e406e460fa19f9f9",
  oldCommit:"0e1a53c5ad1fc9dc2cbfebc13c55f1f426c7e7ae",
  oldTree:"057ee8448ee8f8586cf3235dd043644060795301",
  publicBase:"https://web4.ynxweb4.com/video/studio/",
  port:6495,
  owner:"ynx:ynx"
};
const sha=b=>createHash("sha256").update(b).digest("hex"),stable=v=>JSON.stringify(v),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const mode=s=>s.mode&0o7777;
async function absent(path){try{await lstat(path);throw Error("PATH_NOT_ABSENT:"+path)}catch(error){if(error.code!=="ENOENT")throw error}}
async function tuple(path,{follow=false}={}){const s=follow?await stat(path):await lstat(path);return{dev:String(s.dev),ino:String(s.ino),uid:s.uid,gid:s.gid,mode:mode(s),nlink:s.nlink,size:s.size,type:s.isSymbolicLink()?"symlink":s.isDirectory()?"directory":s.isFile()?"file":"other"}}
const same=(a,b)=>stable(a)===stable(b);
async function fileIdentity(path){const s=await lstat(path);if(!s.isFile()||s.nlink!==1)throw Error("FILE_IDENTITY_INVALID:"+path);const bytes=await readFile(path);return{...await tuple(path),bytes:bytes.length,sha256:sha(bytes)}}
async function releaseIdentity(path){const manifest=join(path,"creator-studio.manifest.json"),parsed=JSON.parse(await readFile(manifest,"utf8"));return{tuple:await tuple(path),manifest:await fileIdentity(manifest),sourceCommit:parsed.sourceCommit,sourceTree:parsed.sourceTree}}
async function inventory(root){const values=[];const walk=async(rel="")=>{for(const name of(await readdir(join(root,rel))).sort()){const next=join(rel,name),s=await lstat(join(root,next));if(s.isSymbolicLink()||(!s.isDirectory()&&!s.isFile()))throw Error("CANDIDATE_UNSUPPORTED_ENTRY:"+next);values.push((s.isDirectory()?"d:":"f:")+next);if(s.isDirectory())await walk(next)}};await walk();return values.sort()}
async function ownedDirectoryIdentity(path){const value=await tuple(path);if(value.type!=="directory")throw Error("OWNED_DIRECTORY_INVALID:"+path);return{dev:value.dev,ino:value.ino,uid:value.uid,gid:value.gid,mode:value.mode,type:value.type}}
async function treeSnapshot(root){const values=[];const walk=async(rel="")=>{for(const name of(await readdir(join(root,rel))).sort()){const next=join(rel,name),path=join(root,next),s=await lstat(path),base={path:next,dev:String(s.dev),ino:String(s.ino),uid:s.uid,gid:s.gid,mode:mode(s),nlink:s.nlink,type:s.isDirectory()?"directory":s.isFile()?"file":s.isSymbolicLink()?"symlink":"other"};if(base.type==="file"){const bytes=await readFile(path);values.push({...base,bytes:bytes.length,sha256:sha(bytes)})}else{values.push(base);if(base.type==="directory")await walk(next)}}};await walk();return values}
async function quarantineOwnedDirectory(path,expected,expectedTree,hooks,label){const quarantine=path+".cleanup-pre-switch";if(!same(await ownedDirectoryIdentity(path),expected)||!same(await treeSnapshot(path),expectedTree))throw Error("OWNED_DIRECTORY_TREE_CHANGED:"+label);if(hooks?.beforeOwnedCleanup)await hooks.beforeOwnedCleanup({path,label,expected,expectedTree});await absent(quarantine);await rename(path,quarantine);if(!same(await ownedDirectoryIdentity(quarantine),expected)||!same(await treeSnapshot(quarantine),expectedTree))throw Error("OWNED_DIRECTORY_QUARANTINE_MISMATCH:"+label);await rm(quarantine,{recursive:true});await absent(quarantine);await absent(path)}
async function removeOwnedPath(path,expected,hooks,label){if(hooks?.beforeOwnedCleanup)await hooks.beforeOwnedCleanup({path,label,expected});const actual=await tuple(path);if(!same(actual,expected))throw Error("OWNED_PATH_SUBSTITUTED:"+label);await rm(path);await absent(path)}
function run(bin,args){return execFileSync(bin,args,{encoding:"utf8"}).trim()}
function show(property){return run(F.systemctl,["show",F.service,"--property="+property,"--value"])}
async function serviceIdentity(){return{active:run(F.systemctl,["is-active",F.service]),sub:show("SubState"),mainPid:Number(show("MainPID")),nRestarts:Number(show("NRestarts")),fragment:show("FragmentPath"),execStart:show("ExecStart"),workingDirectory:show("WorkingDirectory"),user:show("User"),controlGroup:show("ControlGroup")}}
async function siblingIdentity(apiPid,viewerPid){return{api:{pid:Number(apiPid),alive:process.kill(Number(apiPid),0)===undefined},viewer:{pid:Number(viewerPid),alive:process.kill(Number(viewerPid),0)===undefined}}}
function pidForPort(port){const output=run(F.ss,["-ltnp",`sport = :${port}`]),matches=[...output.matchAll(/pid=(\d+)/g)].map(match=>Number(match[1])),unique=[...new Set(matches)];if(unique.length!==1||unique[0]<2)throw Error("LISTENER_PID_UNAVAILABLE:"+port);return unique[0]}
async function freePort(){for(let port=45171;port<=45190;port++){const available=await new Promise(resolve=>{const server=createServer();server.once("error",()=>resolve(false));server.listen({host:"127.0.0.1",port,exclusive:true},()=>server.close(()=>resolve(true))) });if(available)return port}throw Error("BOUNDED_PREFLIGHT_PORT_UNAVAILABLE")}
async function runtimeInputs(){return{apiPid:pidForPort(6493),viewerPid:pidForPort(6494),preflightPort:await freePort()}}
async function coldStart(path,port){if(!Number.isInteger(port)||port<1024||port>65535||[6493,6494,6495].includes(port))throw Error("PREFLIGHT_PORT_INVALID");const child=spawn(F.node,[join(path,"server.mjs")],{env:{...process.env,PORT:String(port)},stdio:"ignore"});try{for(let i=0;i<60;i++){await sleep(100);try{const response=await fetch(`http://127.0.0.1:${port}/`);if(response.status===200&&sha(Buffer.from(await response.arrayBuffer()))===F.rootSha)return{pid:child.pid,port,status:200,rootSha256:F.rootSha}}catch{}}throw Error("CANDIDATE_COLD_START_TIMEOUT")}finally{child.kill("SIGTERM")}}
async function publicGet(suffix,hooks){if(hooks?.get)return hooks.get(suffix);const response=await fetch(new URL(suffix,F.publicBase),{cache:"no-store"}),body=Buffer.from(await response.arrayBuffer());return{status:response.status,bytes:body.length,sha256:sha(body),body:body.toString("utf8")}}
async function verifyPublic(kind,hooks){const expected=kind==="new"?{manifest:F.candidateManifestSha,i18n:F.i18nSha,commit:F.sourceCommit,tree:F.sourceTree}:{manifest:F.oldManifestSha,i18n:F.oldI18nSha,commit:F.oldCommit,tree:F.oldTree},root=await publicGet("",hooks),app=await publicGet("app.js",hooks),manifest=await publicGet("creator-studio.manifest.json",hooks),i18n=await publicGet("i18n.js",hooks),catalog=await publicGet("i18n/catalog.json",hooks),parsed=JSON.parse(manifest.body);const checks={root:root.status===200&&root.sha256===F.rootSha,app:app.status===200&&app.sha256===F.appSha,manifest:manifest.status===200&&manifest.sha256===expected.manifest,i18n:i18n.status===200&&i18n.sha256===expected.i18n,catalog:catalog.status===200&&catalog.sha256===F.catalogSha,source:parsed.sourceCommit===expected.commit&&parsed.sourceTree===expected.tree};if(!Object.values(checks).every(Boolean))throw Error("PUBLIC_BINDING_FAILED:"+stable(checks));return{root,app,manifest:{...manifest,body:undefined},i18n,catalog,sourceCommit:parsed.sourceCommit,sourceTree:parsed.sourceTree}}
async function currentBinding(expected){const link=await tuple(F.current),target=await readlink(F.current),release=await releaseIdentity(expected);if(link.type!=="symlink"||target!==expected||!same(await tuple(F.current,{follow:true}),release.tuple))throw Error("CURRENT_RELEASE_BINDING_FAILED");return{link,target,release}}
async function writeReceipt(path,value){const body=Buffer.from(stable(value)+"\n");await writeFile(path,body,{flag:"wx",mode:0o600});return fileIdentity(path)}
async function verifyCandidate(stage){if(await sha(await readFile(F.candidate))!==F.candidateSha||await sha(await readFile(F.rollbackCarrier))!==F.rollbackCarrierSha)throw Error("CARRIER_SHA_MISMATCH");const manifestPath=join(stage,"creator-studio.manifest.json"),manifestBytes=await readFile(manifestPath);if(sha(manifestBytes)!==F.candidateManifestSha)throw Error("MANIFEST_SHA_MISMATCH");const manifest=JSON.parse(manifestBytes);if(manifest.sourceCommit!==F.sourceCommit||manifest.sourceTree!==F.sourceTree||manifest.files.length!==12)throw Error("MANIFEST_IDENTITY_MISMATCH");const expected=["d:assets","d:i18n","f:creator-studio.manifest.json",...manifest.files.map(file=>"f:"+file.path)].sort();if(stable(await inventory(stage))!==stable(expected))throw Error("CANDIDATE_INVENTORY_MISMATCH");for(const file of manifest.files)if(sha(await readFile(join(stage,file.path)))!==file.sha256)throw Error("MANIFEST_FILE_MISMATCH:"+file.path);return releaseIdentity(stage)}
async function terminal(kind,apiPid,viewerPid,hooks){const svc=hooks?.service?await hooks.service():await serviceIdentity(),expected=kind==="new"?F.newRelease:F.oldRelease,current=await currentBinding(expected),publicEvidence=await verifyPublic(kind,hooks),siblings=hooks?.siblings?await hooks.siblings():await siblingIdentity(apiPid,viewerPid);if(svc.active!=="active"||svc.sub!=="running"||svc.mainPid<2||svc.fragment!==F.unit||svc.workingDirectory!==F.current||svc.user!=="ynx"||!svc.execStart.includes(`${F.node} ${F.current}/server.mjs`)||!siblings.api.alive||!siblings.viewer.alive)throw Error("TERMINAL_RUNTIME_BINDING_FAILED");return{service:svc,current,public:publicEvidence,siblings}}
async function forward(apiPid,viewerPid,preflightPort,hooks){
  await absent(F.newRelease);await absent(F.stage);await absent(F.currentNext);await absent(F.receipt);await absent(F.receiptNext);
  const current=await currentBinding(F.oldRelease),unit=await fileIdentity(F.unit),service=hooks?.service?await hooks.service():await serviceIdentity(),siblings=hooks?.siblings?await hooks.siblings():await siblingIdentity(apiPid,viewerPid);
  if(service.active!=="active"||service.sub!=="running"||service.mainPid<2||service.fragment!==F.unit||service.workingDirectory!==F.current||service.user!=="ynx")throw Error("PREWRITE_SERVICE_IDENTITY_FAILED");
  const before={current,unit,service,siblings,public:await verifyPublic("old",hooks),absence:{newRelease:true,stage:true,currentNext:true,receipt:true,receiptNext:true},preflightPort:Number(preflightPort)};
  let stageOwned=null,stageTree=null,newReleaseOwned=null,newReleaseTree=null,currentNextOwned=null,receiptOwned=null,switched=false;
  try{
    if(hooks?.failAt==="prewrite")throw Error("FIXTURE_PREWRITE_FAILURE");
    await mkdir(F.stage,{recursive:false});stageOwned=await ownedDirectoryIdentity(F.stage);
    execFileSync("tar",["-xf",F.candidate,"-C",F.stage]);run("chown",["-R",F.owner,F.stage]);
    const staged=await verifyCandidate(F.stage);
    stageOwned=await ownedDirectoryIdentity(F.stage);stageTree=await treeSnapshot(F.stage);
    const cold=hooks?.coldStart?await hooks.coldStart(F.stage,Number(preflightPort)):await coldStart(F.stage,Number(preflightPort));
    await rename(F.stage,F.newRelease);stageOwned=null;stageTree=null;newReleaseOwned=await ownedDirectoryIdentity(F.newRelease);newReleaseTree=await treeSnapshot(F.newRelease);
    const created=await releaseIdentity(F.newRelease);if(!same(created.tuple,staged.tuple))throw Error("RELEASE_RENAME_TUPLE_CHANGED");
    if(hooks?.failAt==="materialized")throw Error("FIXTURE_MATERIALIZED_FAILURE");
    const prepared={schemaVersion:"1.0.0",status:"FORWARD_PREPARED_AWAITING_SWITCH",before,material:{candidateSha256:F.candidateSha,rollbackCarrierSha256:F.rollbackCarrierSha,newRelease:created,cold}};
    await mkdir(dirname(F.receipt),{recursive:true});receiptOwned=await writeReceipt(F.receipt,prepared);
    await symlink(F.newRelease,F.currentNext);currentNextOwned=await tuple(F.currentNext);
    await rename(F.currentNext,F.current);currentNextOwned=null;switched=true;
    const provisional={...prepared,status:"FORWARD_SWITCHED_AWAITING_TERMINAL",currentAfter:await currentBinding(F.newRelease)};
    await writeReceipt(F.receiptNext,provisional);await rename(F.receiptNext,F.receipt);receiptOwned=await fileIdentity(F.receipt);
    run(F.systemctl,["restart",F.service]);
    const terminalEvidence=await terminal("new",apiPid,viewerPid,hooks);if(terminalEvidence.service.mainPid===service.mainPid||terminalEvidence.service.nRestarts<service.nRestarts)throw Error("FORWARD_PID_NRESTARTS_BINDING_FAILED");
    const receipt={...provisional,status:"FORWARD_TERMINAL_PASSED",terminal:terminalEvidence};await writeReceipt(F.receiptNext,receipt);await rename(F.receiptNext,F.receipt);return receipt;
  }catch(error){
    if(switched){try{await rollback(apiPid,viewerPid,hooks,{automatic:true})}catch(rollbackError){throw Error(error.message+";AUTOMATIC_ROLLBACK_FAILED:"+rollbackError.message)}throw Error(error.message+";POST_SWITCH_ROLLBACK_TERMINAL")}
    if(currentNextOwned)await removeOwnedPath(F.currentNext,currentNextOwned,hooks,"current-next");
    if(receiptOwned)await removeOwnedPath(F.receipt,receiptOwned,hooks,"prepared-receipt");
    if(newReleaseOwned&&newReleaseTree)await quarantineOwnedDirectory(F.newRelease,newReleaseOwned,newReleaseTree,hooks,"candidate-release");
    if(stageOwned&&stageTree)await quarantineOwnedDirectory(F.stage,stageOwned,stageTree,hooks,"candidate-stage");
    await absent(F.stage);await absent(F.newRelease);await absent(F.currentNext);await absent(F.receipt);await absent(F.receiptNext);
    const clean=await terminal("old",apiPid,viewerPid,hooks);if(clean.service.mainPid!==service.mainPid||clean.service.nRestarts!==service.nRestarts)throw Error(error.message+";PRE_SWITCH_LIFECYCLE_CHANGED");
    throw Error(error.message+";PRE_SWITCH_CLEAN_TERMINAL");
  }
}
async function rollback(apiPid,viewerPid,hooks,options={}){const receipt=JSON.parse(await readFile(F.receipt,"utf8"));if(!["FORWARD_PREPARED_AWAITING_SWITCH","FORWARD_SWITCHED_AWAITING_TERMINAL","FORWARD_TERMINAL_PASSED"].includes(receipt.status)||receipt.material.candidateSha256!==F.candidateSha||receipt.material.rollbackCarrierSha256!==F.rollbackCarrierSha||receipt.before.current.target!==F.oldRelease||!same(await fileIdentity(F.unit),receipt.before.unit)||!same((await releaseIdentity(F.newRelease)).tuple,receipt.material.newRelease.tuple)||(await readlink(F.current))!==F.newRelease)throw Error("ROLLBACK_RECEIPT_BINDING_FAILED");const preRollbackService=hooks?.service?await hooks.service():await serviceIdentity();await absent(F.currentNext);await symlink(F.oldRelease,F.currentNext);await rename(F.currentNext,F.current);run(F.systemctl,["restart",F.service]);const terminalEvidence=await terminal("old",apiPid,viewerPid,hooks);if(terminalEvidence.service.mainPid===preRollbackService.mainPid||terminalEvidence.service.nRestarts<preRollbackService.nRestarts)throw Error("ROLLBACK_PID_NRESTARTS_BINDING_FAILED");if(!options.keepCandidate){const actual=await releaseIdentity(F.newRelease);if(!same(actual.tuple,receipt.material.newRelease.tuple))throw Error("ROLLBACK_DELETE_SUBSTITUTION");await rm(F.newRelease,{recursive:true});await absent(F.newRelease)}const result={schemaVersion:"1.0.0",status:"ROLLBACK_TERMINAL_PASSED",forwardReceiptSha256:sha(await readFile(F.receipt)),restored:terminalEvidence,newReleaseAbsent:!options.keepCandidate};return result}
async function legacyFixture(){throw Error("LEGACY_FIXTURE_DISABLED")}

async function fixture(){
  const base=await mkdtemp(join(tmpdir(),"ynx-creator-3f97-upgrade-")),saved={...F};
  const isAbsent=path=>lstat(path).then(()=>false,error=>error.code==="ENOENT");
  try{
    Object.assign(F,{root:join(base,"root"),current:join(base,"root/current"),oldRelease:join(base,"root/releases/creator-studio-0e1a53c5"),newRelease:join(base,"root/releases/creator-studio-3f97a13d"),stage:join(base,"root/releases/creator-studio-3f97a13d.next"),receipt:join(base,"root/receipts/upgrade-3f97a13d.json"),receiptNext:join(base,"root/receipts/upgrade-3f97a13d.json.next"),currentNext:join(base,"root/current.next-3f97a13d"),unit:join(base,"unit.service"),systemctl:join(base,"systemctl"),node:process.execPath,owner:`${process.getuid()}:${process.getgid()}`});
    const inventoryProbe=join(base,"inventory-probe");await mkdir(inventoryProbe);execFileSync("tar",["-xf",F.candidate,"-C",inventoryProbe]);await verifyCandidate(inventoryProbe);await mkdir(join(inventoryProbe,"unexpected-empty-directory"));const unexpectedDirectoryRejected=await verifyCandidate(inventoryProbe).then(()=>false,()=>true);await rm(inventoryProbe,{recursive:true});
    await mkdir(F.oldRelease,{recursive:true});execFileSync("tar",["-xf",F.rollbackCarrier,"-C",F.oldRelease]);await symlink(F.oldRelease,F.current);await writeFile(F.unit,"fixture-unit");await writeFile(F.systemctl,"#!/bin/sh\nexit 0\n");await chmod(F.systemctl,0o755);
    const svc=async()=>({active:"active",sub:"running",mainPid:(await readlink(F.current))===F.newRelease?9002:9001,nRestarts:0,fragment:F.unit,execStart:`${F.node} ${F.current}/server.mjs`,workingDirectory:F.current,user:"ynx",controlGroup:"/system.slice/ynx-creator-studio-wallet.service"}),siblings=()=>({api:{pid:6493,alive:true},viewer:{pid:6494,alive:true}}),get=async suffix=>{const current=join(await readlink(F.current),suffix||"index.html");const body=await readFile(current);return{status:200,bytes:body.length,sha256:sha(body),body:body.toString("utf8")}},hooks={service:svc,siblings,get};
    const success=await forward(6493,6494,5188,hooks),rolled=await rollback(6493,6494,hooks);await rm(F.receipt,{force:true});
    const prewriteFailureClean=await forward(6493,6494,5188,{...hooks,failAt:"prewrite"}).then(()=>false,error=>error.message.includes("PRE_SWITCH_CLEAN_TERMINAL"));
    const prewritePathsAbsent=(await Promise.all([F.stage,F.newRelease,F.currentNext,F.receipt,F.receiptNext].map(isAbsent))).every(Boolean);
    const coldStartFailureClean=await forward(6493,6494,5188,{...hooks,coldStart:async()=>{throw Error("FIXTURE_COLD_START_FAILURE")}}).then(()=>false,error=>error.message.includes("PRE_SWITCH_CLEAN_TERMINAL"));
    const coldStartPathsAbsent=(await Promise.all([F.stage,F.newRelease,F.currentNext,F.receipt,F.receiptNext].map(isAbsent))).every(Boolean);
    let stageOriginal=null,stageForeign=null;
    const stageSubstitutionRejected=await forward(6493,6494,5188,{...hooks,coldStart:async()=>{throw Error("FIXTURE_COLD_START_FAILURE")},beforeOwnedCleanup:async({path,label})=>{if(label!=="candidate-stage"||stageOriginal)return;stageOriginal=path+".owned";await rename(path,stageOriginal);await mkdir(path);stageForeign=await ownedDirectoryIdentity(path)}}).then(()=>false,error=>error.message.includes("OWNED_DIRECTORY_QUARANTINE_MISMATCH:candidate-stage"));
    const stageForeignQuarantine=F.stage+".cleanup-pre-switch",stageOwnedPreserved=stageOriginal?!(await isAbsent(stageOriginal)):false,stageForeignPreserved=stageForeign?!(await isAbsent(stageForeignQuarantine)):false;
    if(stageOriginal)await rm(stageOriginal,{recursive:true,force:true});await rm(stageForeignQuarantine,{recursive:true,force:true});
    const foreignChildRejected=await forward(6493,6494,5188,{...hooks,coldStart:async()=>{throw Error("FIXTURE_COLD_START_FAILURE")},beforeOwnedCleanup:async({path,label})=>{if(label==="candidate-stage")await writeFile(join(path,"foreign-child.txt"),"foreign")}}).then(()=>false,error=>error.message.includes("OWNED_DIRECTORY_QUARANTINE_MISMATCH:candidate-stage"));
    const foreignChildPreserved=!(await isAbsent(stageForeignQuarantine));await rm(stageForeignQuarantine,{recursive:true,force:true});
    const sameBytesNewInodeRejected=await forward(6493,6494,5188,{...hooks,failAt:"materialized",beforeOwnedCleanup:async({path,label})=>{if(label!=="candidate-release")return;const target=join(path,"app.js"),bytes=await readFile(target);await rm(target);await writeFile(target,bytes,{mode:0o644})}}).then(()=>false,error=>error.message.includes("OWNED_DIRECTORY_QUARANTINE_MISMATCH:candidate-release"));
    const candidateForeignQuarantine=F.newRelease+".cleanup-pre-switch",sameBytesNewInodePreserved=!(await isAbsent(candidateForeignQuarantine));await rm(candidateForeignQuarantine,{recursive:true,force:true});
    await mkdir(F.newRelease);const targetAbsenceRejected=await forward(6493,6494,5188,hooks).then(()=>false,()=>true);await rm(F.newRelease,{recursive:true});
    const restored=(await readlink(F.current))===F.oldRelease,candidateHashBound=success.material.candidateSha256===saved.candidateSha,rollbackHashBound=success.material.rollbackCarrierSha256===saved.rollbackCarrierSha;
    if(!rolled.newReleaseAbsent||!targetAbsenceRejected||!restored||!candidateHashBound||!rollbackHashBound||!unexpectedDirectoryRejected||!prewriteFailureClean||!prewritePathsAbsent||!coldStartFailureClean||!coldStartPathsAbsent||!stageSubstitutionRejected||!stageOwnedPreserved||!stageForeignPreserved||!foreignChildRejected||!foreignChildPreserved||!sameBytesNewInodeRejected||!sameBytesNewInodePreserved)throw Error("FIXTURE_GATE_FAILED");
    console.log(JSON.stringify({fixture:"passed",forwardStatus:success.status,rollbackStatus:rolled.status,targetAbsenceRejected,currentRestored:restored,newReleaseAbsent:rolled.newReleaseAbsent,candidateHashBound,rollbackHashBound,cleanCandidateInventoryBound:true,unexpectedDirectoryRejected,prewriteFailureCleanTerminal:prewriteFailureClean,prewritePathsAbsent,coldStartFailureCleanTerminal:coldStartFailureClean,coldStartPathsAbsent,stageSubstitutionRejected,stageOwnedPreserved,stageForeignPreserved,foreignChildRejected,foreignChildPreserved,sameBytesNewInodeRejected,sameBytesNewInodePreserved,preSwitchRollbackInvoked:false,unrelatedDeletion:false,unitBound:true,servicePidNRestartsBound:true,portBound:true,publicBindings:true},null,2));
  }finally{Object.assign(F,saved);await rm(base,{recursive:true,force:true})}
}

const command=process.argv[2];
if(command==="forward"){const input=await runtimeInputs();console.log(JSON.stringify(await forward(input.apiPid,input.viewerPid,input.preflightPort),null,2))}
else if(command==="rollback"){const receipt=JSON.parse(await readFile(F.receipt,"utf8"));console.log(JSON.stringify(await rollback(receipt.before.siblings.api.pid,receipt.before.siblings.viewer.pid),null,2))}
else if(command==="fixture")await fixture();
else console.log(JSON.stringify({executor:"creator-studio-release-control-plane",status:"SOURCE_ONLY_NOT_AUTHORIZED",commands:["forward","rollback"],runtimeInputs:"self-discovered and receipted"},null,2));
