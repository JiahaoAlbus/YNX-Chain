#!/usr/bin/env node
// Source-only controls. All approvals, metadata and receipts below are public
// synthetic DATA. No Caddy, SSH, service, ledger or real approval is exercised.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {caddySourceIdentity} from "./lib/public-bft-native-source.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ynx-caddy-source-controls-")));
const profile = "single-app-gateway/v1", fullCommit = "0123456789abcdef0123456789abcdef01234567";
const commit = fullCommit.slice(0, 12), release = `ynx-bft-gateway-${commit}`;
const roles = ["primary", "singapore", "silicon-valley", "seoul"];
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const encode = value => Buffer.from(`${JSON.stringify(value)}\n`);
const hash = char => char.repeat(64);
const dropin = "[Service]\nExecStart=\nExecStart=/usr/bin/caddy run --environ --config /etc/caddy/ynx-chain.json\nExecReload=\nExecReload=/usr/bin/caddy reload --config /etc/caddy/ynx-chain.json --force\n";
const bindingProgram = path.join(repo, "scripts/verify/public-bft-candidate-binding.mjs");
const evidenceProgram = path.join(repo, "scripts/verify/validate-public-bft-cutover-approval-evidence.mjs");
const approvalProgram = path.join(repo, "scripts/verify/validate-public-bft-cutover-approval.mjs");
let cases = 0, serial = 0;
function check(name, action) {
  try { action(); cases++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
}
function write(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  fs.writeFileSync(file, Buffer.isBuffer(value) ? value : encode(value), {flag: "wx", mode: 0o600});
  return file;
}
function snapshot(files) {
  return files.map(file => { const s=fs.lstatSync(file,{bigint:true});return [file,fs.readFileSync(file),s.ino,s.mtimeNs,s.mode]; });
}
function unchanged(saved) {
  for (const [file,raw,inode,mtime,mode] of saved) {
    const s=fs.lstatSync(file,{bigint:true});
    assert.deepEqual(fs.readFileSync(file),raw,`original bytes changed: ${file}`);
    assert.equal(s.ino,inode);assert.equal(s.mtimeNs,mtime);assert.equal(s.mode,mode);
  }
}
function cli(program, args, accepted = true, env = {}) {
  const p=spawnSync(process.execPath,[program,...args],{cwd:repo,env:{...process.env,NODE_OPTIONS:"",...env},encoding:"utf8",timeout:15000,maxBuffer:2<<20});
  assert.ifError(p.error);assert.equal(p.signal,null);
  if(accepted)assert.equal(p.status,0,p.stderr);else assert.notEqual(p.status,0,`rejected input accepted: ${p.stdout}`);
  return p;
}
function fixture() {
  const directory=path.join(root,`case-${++serial}`), transaction=path.join(directory,"caddy-source-fixture");
  fs.mkdirSync(directory,{mode:0o700});
  const now=Math.floor(Date.now()/1000)*1000, time=ms=>new Date(ms).toISOString().replace(".000Z","Z");
  const recordedAt=time(now),genesis=time(now+600000),expiresAt=time(now+3600000);
  const validator=write(path.join(directory,"validators.json"),{version:1,validators:roles.map(role=>({role}))});
  const plan={version:"YNX-PRODUCTION-OPERATOR/v1",chainId:"ynx_6423-1",stateLayout:"atomic-json",consensusGenesisSHA256:hash("a"),originalGenesisHash:hash("b"),migrationStateHash:hash("c"),roles:roles.map(role=>({role}))};
  const planPath=write(path.join(directory,"operator.json"),plan),planPin=sha(fs.readFileSync(planPath));
  const snapshotValue={height:41,lastBlockHash:hash("d"),stateHash:hash("c"),accounts:[]};
  const migration=write(path.join(transaction,"final-snapshot/migration.json"),snapshotValue);
  const remote=write(path.join(transaction,"final-snapshot/remote-evidence.json"),{transactionId:path.basename(transaction),commit,bftRelease:release,authoritativeRelease:`ynx-chain-${commit}`,
    ...snapshotValue,sha256:sha(fs.readFileSync(migration)),recordedAt,validated:true,pauseVerified:true,mutationFreezeVerified:true,sourceUnchanged:true,exporterCommit:fullCommit,snapshotSourceSha256:hash("e"),exporterManifestSha256:hash("f")});
  const witness=inode=>({uid:"0",gid:"0",mode:"600",nlink:"1",device:"64770",inode,mtimeNs:"1792780753533647655",ctimeNs:"1792780753533647655"});
  const manifest={version:"YNX-CADDY-JSON-INGRESS-SOURCE/v1",transactionId:path.basename(transaction),commit,operatorPlanSHA256:planPin,runtimeCommit:fullCommit,runtimeSOURCEsha256:hash("9"),gatewaySHA256:hash("8"),
    source:{path:"/var/tmp/ynx-caddy-original/source.json",bytes:"4242",sha256:hash("7"),witness:witness("101")},
    secondRead:{path:"/var/tmp/ynx-caddy-original/second.json",bytes:"4242",sha256:hash("7"),witness:witness("102")},
    originalProcess:{pid:"1432803",startTicks:"1557106000",argv:["/usr/bin/caddy","run","--environ","--config","/etc/caddy/Caddyfile"]},
    originalUnit:{path:"/usr/lib/systemd/system/caddy.service",sha256:hash("6")},
    baseline:{configPath:"/etc/caddy/ynx-chain.json",configSHA256:hash("7"),semanticSHA256:hash("5"),candidateSemanticSHA256:hash("4"),dropInPath:"/etc/systemd/system/caddy.service.d/ynx-chain-json.conf",dropInSHA256:sha(dropin)},
    rpcUpstreams:["rpc-testnet.ynxweb4.com","rpc.ynxweb4.com"].map((host,index)=>({pointer:`/apps/http/servers/main/routes/${index}/handle/0/upstreams/0/dial`,host,from:"127.0.0.1:6420",to:"127.0.0.1:27620"}))};
  const manifestFile=write(path.join(directory,"manifest.json"),manifest);
  const caddySource={manifestPath:"/var/lib/ynx-chain/caddy-source/manifest.json",manifestSha256:sha(fs.readFileSync(manifestFile))};
  const approval={custodyProfile:profile,schemaVersion:1,action:"ynx-public-bft-cutover",approved:true,approvalId:"caddy-source-data-fixture",approver:"transaction fixture",custodyReviewer:"custody fixture",custodyEvidence:`sha256:${hash("1")}`,
    owner:"owner fixture",ownerHandoverReviewer:"handover fixture",ownerHandoverInventoryDigest:`sha256:${hash("2")}`,ownerHandoverInventoryEvidence:`sha256:${hash("3")}`,ownerHandoverReceiptEvidence:`sha256:${hash("4")}`,
    commit,release,publicCutoverAuthorized:true,automaticRollbackRequired:true,validatorKeyRecoveryVerified:true,ownerHandoverVerified:true,rotationProcedureVerified:true,
    validatorManifestSha256:sha(fs.readFileSync(validator)),operatorPlanSha256:planPin,runtimeManifestSha256:hash("9"),snapshotSourceSha256:hash("e"),exporterManifestSha256:hash("f"),candidateGenesisTime:genesis,expiresAt,caddySource};
  const approvalFile=write(path.join(transaction,"approval.json"),approval);
  const packageRoot=path.join(directory,"package"),packageFile=write(path.join(packageRoot,"package-manifest.json"),{operatorProfile:"YNX-PRODUCTION-OPERATOR/v1",operatorPlanHash:planPin,genesisTime:genesis,chainId:"ynx_6423-1",roles,genesisHash:hash("a"),migrationStateHash:hash("c")});
  const args=[transaction,commit,release,validator,genesis,planPath,planPin,fullCommit,hash("9"),packageRoot];
  const binding=JSON.parse(cli(bindingProgram,args).stdout),bindingFile=write(path.join(directory,"binding.json"),binding);
  const files=[validator,planPath,migration,remote,manifestFile,approvalFile,packageFile,bindingFile];
  return {directory,transaction,manifest,manifestFile,approval,approvalFile,validator,planPin,genesis,expiresAt,args,binding,bindingFile,files};
}
function receipt(f, operation="switch", dry=false, json=true) {
  const b=f.binding,m=f.manifest;
  return {version:"YNX-SINGLE-APP-GATEWAY-INGRESS/v1",mode:json?"single-app-gateway-json":"single-app-gateway",transactionId:b.transactionId,commit:b.commit,bftRelease:b.bftRelease,
    operatorPlanSHA256:b.operatorPlanSha256,runtimeCommit:b.runtimeCommit,runtimeSOURCEsha256:b.runtimeManifestSha256,gatewaySHA256:m.gatewaySHA256,
    rpcOnly:true,ecosystemContinuityVerified:false,dryRun:dry,ingress:operation==="switch"?"bft":"authoritative",publicIngressChanged:operation==="switch"&&!dry,publicCutoverReady:operation==="switch"&&!dry,
    authoritativeChecksumsSha256:hash("a"),candidateChecksumsSha256:hash("b"),sourceTestOnly:dry,
    ...(json?{caddySourceManifestSHA256:b.caddySource.manifestSha256,sourceSHA256:m.source.sha256,baselineSemanticSHA256:m.baseline.semanticSHA256,candidateSemanticSHA256:m.baseline.candidateSemanticSHA256,dropInSHA256:m.baseline.dropInSHA256}:{})};
}
function variant(f, label, value) {return write(path.join(f.directory,`${label}-${++serial}.json`),value);}
function ingress(f, value, operation, dry, accepted=true, binding=f.bindingFile, metadata=f.manifestFile) {
  return cli(bindingProgram,["--ingress-check",binding,variant(f,"receipt",value),operation,dry?"1":"0",f.manifest.gatewaySHA256,...(metadata?[metadata]:[])],accepted);
}
const driverSource=fs.readFileSync(path.join(repo,"scripts/ops/public-bft-production-driver.sh"),"utf8");
function driverFunction(name) {
  const marker=`\n${name}() {\n`,start=driverSource.indexOf(marker),end=driverSource.indexOf("\n}\n",start+marker.length);
  assert.ok(start>=0&&end>start,`original driver function missing: ${name}`);
  return driverSource.slice(start+1,end+3);
}
function driverFixture(f,json,corrupt=false) {
  const directory=path.join(f.directory,`driver-${++serial}`);fs.mkdirSync(directory,{mode:0o700});
  const approval=structuredClone(f.approval),binding=structuredClone(f.binding);
  if(!json){delete approval.caddySource;delete binding.caddySource;}
  const approvalFile=write(path.join(directory,"approval.json"),approval),bindingFile=write(path.join(directory,"binding.json"),binding);
  const badManifest=structuredClone(f.manifest);badManifest.transactionId="unapproved-transaction";
  const manifestFile=write(path.join(directory,"remote-metadata-data.json"),corrupt?badManifest:f.manifest);
  const log=write(path.join(directory,"calls.txt"),Buffer.alloc(0)),transaction=path.join(directory,"transaction-data");
  const stubs=[
    "set -Eeuo pipefail",
    `prepare_candidate_package(){ printf 'STUB:prepare\\n' >>"$FIX_LOG"; }`,
    `dependency_context(){ dependency_remote_root=/fixture/original-remote-evidence; }`,
    `validated_gateway_start(){ printf 'STUB:start\\n' >>"$FIX_LOG"; }`,
    `validated_candidate_result(){ printf 'STUB:candidate\\n' >>"$FIX_LOG"; }`,
    `validated_continuity_result(){ printf 'STUB:continuity\\n' >>"$FIX_LOG"; }`,
    `node(){ printf 'NODE:%s\\n' "$*" >>"$FIX_LOG"; "$FIX_NODE" "$@"; }`,
    `ynx_ops_copy(){ printf 'COPY:%s -> %s\\n' "$5" "$6" >>"$FIX_LOG"; }`,
    `ynx_ops_ssh(){ local command="$5"; printf 'SSH:%s\\n' "$command" >>"$FIX_LOG"; case "$command" in *"sudo head -c 65537"*) cat "$FIX_MANIFEST";; *"umask 077; mkdir -m 0700"*) :;; *"sudo bash "*) :;; *) echo 'unexpected synthetic SSH boundary' >&2; return 91;; esac; }`,
    driverFunction("ingress_context"),driverFunction("validated_ingress_result"),driverFunction("gateway_ingress_phase"),
    "gateway_ingress_phase switch"
  ].join("\n");
  const env={...process.env,NODE_OPTIONS:"",FIX_LOG:log,FIX_NODE:process.execPath,FIX_MANIFEST:manifestFile,
    candidate_transaction_dir:transaction,candidate_transaction_id:binding.transactionId,candidate_binding:bindingFile,candidate_approval:approvalFile,
    commit,candidate_bft_release:release,candidate_operator_pin:f.planPin,CONSENSUS_CANDIDATE_RUNTIME_COMMIT:fullCommit,
    CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256:f.approval.runtimeManifestSha256,gateway_binary_sha:f.manifest.gatewaySHA256,
    PRIMARY_NODE_USER:"fixture-user",PRIMARY_NODE_HOST:"fixture.invalid",PRIMARY_NODE_SSH_KEY:"/fixture/no-key",PUBLIC_BFT_PRODUCTION_INGRESS_APPROVED:"yes",DEPLOY_DRY_RUN:"1"};
  const run=()=>{const p=spawnSync("bash",["-s"],{cwd:repo,env,input:stubs,encoding:"utf8",timeout:15000,maxBuffer:2<<20});assert.ifError(p.error);assert.equal(p.signal,null);return p;};
  return {run,log,transaction,binding,files:[approvalFile,bindingFile,manifestFile]};
}

try {
  check("typed absence and explicit original identity preserve approved material",()=>{
    assert.deepEqual(caddySourceIdentity({}),{});
    assert.deepEqual(caddySourceIdentity({custodyProfile:profile}),{});
    const value={custodyProfile:profile,caddySource:{manifestPath:"/original/manifest.json",manifestSha256:hash("a")},approved:true,approvalId:"typed-data-fixture"};
    const saved=structuredClone(value);Object.freeze(value.caddySource);Object.freeze(value);
    assert.deepEqual(caddySourceIdentity(value),{caddySource:saved.caddySource});assert.deepEqual(value,saved);
  });
  for(const value of [null,undefined,false,"manifest",[],{}, {manifestPath:"/a",manifestSha256:hash("a"),extra:true}, {manifestPath:"/a"}, {manifestSha256:hash("a")}])
    check("typed closed source rejects missing and unknown fields",()=>assert.throws(()=>caddySourceIdentity({custodyProfile:profile,caddySource:value})));
  for(const manifestPath of ["relative.json","/a//manifest.json","/a/./manifest.json","/a/../manifest.json","/a/manifest.json/","/a space/manifest.json","/a/manifest.json\n","/a/manifest.json\0",42])
    check("typed noncanonical source path rejected",()=>assert.throws(()=>caddySourceIdentity({custodyProfile:profile,caddySource:{manifestPath,manifestSha256:hash("a")}})));
  for(const manifestSha256 of ["0".repeat(64),"A".repeat(64),"a".repeat(63),"g".repeat(64),42,null])
    check("typed noncanonical source digest rejected",()=>assert.throws(()=>caddySourceIdentity({custodyProfile:profile,caddySource:{manifestPath:"/a/manifest.json",manifestSha256}})));
  check("legacy cannot opt into JSON source",()=>assert.throws(()=>caddySourceIdentity({caddySource:{manifestPath:"/a/manifest.json",manifestSha256:hash("a")}})));

  const f=fixture(),saved=snapshot(f.files);
  check("normal actual binding and approval evidence carry exact original source",()=>{
    assert.deepEqual(f.binding.caddySource,f.approval.caddySource);
    const approved=JSON.parse(cli(evidenceProgram,[f.approvalFile,commit,release]).stdout);
    assert.deepEqual(approved.caddySource,f.approval.caddySource);
    assert.equal(approved.owner,f.approval.owner);assert.equal(approved.custodyEvidence,f.approval.custodyEvidence);
    unchanged(saved);
  });

  // Exercise the actual approval CLI; only its already-covered custody child
  // boundary is doubled. This does not qualify custody or confer approval.
  const reviewFile=variant(f,"custody-review-data",{fixtureOnly:true});
  const reviewed={custodyProfile:profile,reviewer:f.approval.custodyReviewer,custodyEvidence:f.approval.custodyEvidence,
    owner:f.approval.owner,ownerHandoverReviewer:f.approval.ownerHandoverReviewer,ownerHandoverInventoryDigest:f.approval.ownerHandoverInventoryDigest,
    ownerHandoverInventoryEvidence:f.approval.ownerHandoverInventoryEvidence,ownerHandoverReceiptEvidence:f.approval.ownerHandoverReceiptEvidence,
    validatorManifestSha256:f.approval.validatorManifestSha256,operatorPlanSha256:f.planPin,runtimeManifestSha256:f.approval.runtimeManifestSha256,expiresAt:f.expiresAt};
  const custodyProgram=path.join(repo,"scripts/verify/validate-production-custody-review.mjs");
  const hook=write(path.join(f.directory,"custody-child-only.cjs"),Buffer.from(`const assert=require('node:assert/strict');const cp=require('node:child_process');cp.execFileSync=(command,args,options)=>{assert.equal(command,process.execPath);assert.deepEqual(args,${JSON.stringify([custodyProgram,reviewFile,commit,f.approval.validatorManifestSha256])});assert.equal(options.encoding,'utf8');return ${JSON.stringify(JSON.stringify(reviewed)+"\n")};};require('node:module').syncBuiltinESMExports();\n`));
  const approvalEnv={NODE_OPTIONS:`--require=${hook}`};
  check("normal actual approval CLI carries source without mutating materials",()=>{
    const value=JSON.parse(cli(approvalProgram,[f.approvalFile,commit,release,reviewFile],true,approvalEnv).stdout);
    assert.deepEqual(value.caddySource,f.approval.caddySource);assert.equal(value.owner,f.approval.owner);unchanged(saved);
  });
  check("future full Caddy authority refused during native preparation",()=>{
    const full="65efa82e06158f9616172144c3c9efdd8088f227";
    const prepare={...f.approval,preparationOnly:true,operatorPreparationPlanSha256:f.planPin,authoritativeCommit:full,authoritativeRelease:`ynx-network-surgical-${full.slice(0,12)}`,authoritativeBinarySha256:hash("a"),
      authoritativeSource:{statePath:"/var/lib/ynx-chain/testnet/devnet-state.json",integrityMarkerPath:"/var/lib/ynx-chain/testnet/devnet-state.integrity-version",pauseMarkerPath:"/var/lib/ynx-chain/block-production-pause.json",mutationMarkerPath:"/var/lib/ynx-chain/mutation-freeze.json"}};
    delete prepare.snapshotSourceSha256;delete prepare.operatorPlanSha256;delete prepare.candidateGenesisTime;
    const bad=variant(f,"prepare-future-caddy",prepare),without=structuredClone(prepare);delete without.caddySource;
    const good=variant(f,"prepare-without-future",without);
    cli(evidenceProgram,[good,commit,release,"--prepare-native"]);
    cli(evidenceProgram,[bad,commit,release,"--prepare-native"],false);
    cli(approvalProgram,[good,commit,release,reviewFile,"--prepare-native"],true,approvalEnv);
    cli(approvalProgram,[bad,commit,release,reviewFile,"--prepare-native"],false,approvalEnv);
  });

  check("actual closed metadata CLI qualifies only independent original manifest",()=>{
    cli(bindingProgram,["--caddy-source-check",f.bindingFile,f.manifestFile,f.manifest.gatewaySHA256]);unchanged(saved);
    const b=structuredClone(f.binding);b.caddySource.manifestSha256=hash("f");
    cli(bindingProgram,["--caddy-source-check",variant(f,"wrong-approved-pin",b),f.manifestFile,f.manifest.gatewaySHA256],false);
  });
  const manifestMutations=[
    ["unknown",m=>{m.extra=true;}],["missing",m=>{delete m.baseline.candidateSemanticSHA256;}],
    ["transaction",m=>{m.transactionId="different-transaction";}],["operator",m=>{m.operatorPlanSHA256=hash("f");}],
    ["runtime",m=>{m.runtimeCommit="f".repeat(40);}],["source-bytes",m=>{m.source.bytes="04242";}],
    ["unequal-reads",m=>{m.secondRead.sha256=hash("f");}],["same-inode",m=>{m.secondRead.witness.inode=m.source.witness.inode;}],
    ["different-owner",m=>{m.secondRead.witness.uid="99";}],["different-parent",m=>{m.secondRead.path="/different/second.json";}],
    ["wrong-dropin",m=>{m.baseline.dropInSHA256=hash("f");}],["same-projection",m=>{m.baseline.candidateSemanticSHA256=m.baseline.semanticSHA256;}],
    ["unknown-rpc-host",m=>{m.rpcUpstreams[1].host="unrelated.ynxweb4.com";}],["duplicate-pointer",m=>{m.rpcUpstreams[1].pointer=m.rpcUpstreams[0].pointer;}]
  ];
  for(const [name,mutate] of manifestMutations)check(`re-pinned malformed metadata ${name} rejected`,()=>{
    const m=structuredClone(f.manifest);mutate(m);const file=variant(f,`manifest-${name}`,m);
    const b=structuredClone(f.binding);b.caddySource.manifestSha256=sha(fs.readFileSync(file));
    cli(bindingProgram,["--caddy-source-check",variant(f,`binding-${name}`,b),file,f.manifest.gatewaySHA256],false);
  });
  check("duplicate manifest keys rejected after independent pin matches bytes",()=>{
    const raw=Buffer.from(JSON.stringify(f.manifest).replace('{','{"version":"YNX-CADDY-JSON-INGRESS-SOURCE/v1",')+"\n"),file=variant(f,"duplicate-manifest",raw);
    const b=structuredClone(f.binding);b.caddySource.manifestSha256=sha(raw);
    cli(bindingProgram,["--caddy-source-check",variant(f,"duplicate-binding",b),file,f.manifest.gatewaySHA256],false);
  });
  check("manifest original file boundaries reject symlink and permissive mode",()=>{
    const link=path.join(f.directory,"linked-manifest.json");fs.symlinkSync(f.manifestFile,link);
    cli(bindingProgram,["--caddy-source-check",f.bindingFile,link,f.manifest.gatewaySHA256],false);
    const loose=variant(f,"loose-manifest",f.manifest);fs.chmodSync(loose,0o644);
    cli(bindingProgram,["--caddy-source-check",f.bindingFile,loose,f.manifest.gatewaySHA256],false);
  });
  for(const operation of ["switch","rollback"])for(const dry of [false,true])check(`actual JSON ingress ${operation} dry=${dry} carries all source pins`,()=>{
    ingress(f,receipt(f,operation,dry),operation,dry);unchanged(saved);
  });
  for(const key of ["caddySourceManifestSHA256","sourceSHA256","baselineSemanticSHA256","candidateSemanticSHA256","dropInSHA256"])check(`actual receipt rejects swapped ${key}`,()=>{
    const value=receipt(f);value[key]=hash("f");ingress(f,value,"switch",false,false);
  });
  check("dry run cannot claim real ingress mutation",()=>{
    const value=receipt(f,"switch",true);value.publicIngressChanged=true;value.publicCutoverReady=true;
    ingress(f,value,"switch",true,false);ingress(f,receipt(f),"switch",false,false,f.bindingFile,null);
  });
  check("legacy has no JSON receipt or extra metadata authority",()=>{
    const legacy=structuredClone(f.binding);delete legacy.caddySource;const file=variant(f,"legacy-binding",legacy);
    ingress(f,receipt(f,"switch",false,false),"switch",false,true,file,null);
    ingress(f,receipt(f),"switch",false,false,file,null);
    ingress(f,receipt(f,"switch",false,false),"switch",false,false,file,f.manifestFile);
    cli(bindingProgram,["--caddy-source-check",file,f.manifestFile,f.manifest.gatewaySHA256],false);unchanged(saved);
  });
  for(const json of [true,false])check(`normal driver uses ${json?"JSON":"legacy"} fixed helper and actual receipt validation`,()=>{
    const d=driverFixture(f,json),inputs=snapshot(d.files),p=d.run();assert.equal(p.status,0,p.stderr);
    const log=fs.readFileSync(d.log,"utf8"),lines=log.split("\n"),remote=`/tmp/ynx-ingress-${f.binding.transactionId}-switch`;
    const copies=lines.filter(line=>line.startsWith("COPY:"));
    assert.deepEqual(copies,[`COPY:scripts/ops/remote/public-bft-ingress.sh -> ${remote}/helper.sh`,...(json?[`COPY:scripts/ops/remote/public-bft-caddy-json.py -> ${remote}/public-bft-caddy-json.py`]:[])]);
    const execute=lines.findIndex(line=>line.startsWith("SSH:")&&line.includes("sudo bash "));
    assert.ok(execute>=0);assert.ok(lines[execute].includes(sha(fs.readFileSync(path.join(repo,"scripts/ops/remote/public-bft-ingress.sh")))));
    assert.ok(lines[execute].includes(`'${json?"single-app-gateway-json":"single-app-gateway"}'`));
    if(json){
      const qualified=lines.findIndex(line=>line.startsWith("NODE:")&&line.includes(" --caddy-source-check "));
      const reserve=lines.findIndex(line=>line.startsWith("SSH:umask 077; mkdir"));
      assert.ok(qualified>=0&&reserve>qualified&&execute>reserve,"metadata must qualify before any remote staging/switch");
      assert.ok(lines[execute].includes(sha(fs.readFileSync(path.join(repo,"scripts/ops/remote/public-bft-caddy-json.py")))));
      assert.ok(lines[execute].includes(`'${f.approval.caddySource.manifestPath}' '${f.approval.caddySource.manifestSha256}'`));
    }else assert.equal(lines.some(line=>line.includes(" --caddy-source-check ")||line.startsWith("COPY:")&&line.includes("caddy-json.py")),false);
    assert.ok(lines.findIndex(line=>line.startsWith("NODE:")&&line.includes(" --ingress-check "))>execute);
    const resultFile=path.join(d.transaction,"ingress/switch-result.json"),result=JSON.parse(fs.readFileSync(resultFile));
    assert.equal(result.mode,json?"single-app-gateway-json":"single-app-gateway");assert.equal(result.dryRun,true);
    assert.equal(result.publicIngressChanged,false);assert.equal(result.publicCutoverReady,false);
    assert.equal(Object.hasOwn(result,"caddySourceManifestSHA256"),json);
    if(json)assert.equal(result.caddySourceManifestSHA256,f.approval.caddySource.manifestSha256);
    const retained=snapshot([resultFile,path.join(d.transaction,"ingress/switch-attempt/intent.json")]);
    const beforeRetry=fs.readFileSync(d.log,"utf8"),again=d.run();assert.notEqual(again.status,0,"existing UNKNOWN/result must not retry");
    assert.equal(fs.readFileSync(d.log,"utf8").slice(beforeRetry.length).includes("SSH:"),false);
    unchanged(retained);unchanged(inputs);unchanged(saved);
  });
  check("normal driver rejects copied wrong metadata before reservation or helper copy",()=>{
    const d=driverFixture(f,true,true),p=d.run();assert.notEqual(p.status,0);
    const log=fs.readFileSync(d.log,"utf8");assert.ok(log.includes(" --caddy-source-check "));
    assert.equal(log.includes("SSH:umask 077; mkdir"),false);assert.equal(log.includes("COPY:"),false);
    assert.equal(log.includes("sudo bash "),false);unchanged(saved);
  });
  check("public readback and recovery reuse the same ingress source validator",()=>{
    for(const name of ["verify_public_phase","gateway_recovery_phase"]){
      assert.match(driverFunction(name),/validated_ingress_result switch "\$ingress_root\/switch-result\.json"/);
      assert.doesNotMatch(driverFunction(name),/node scripts\/verify\/public-bft-candidate-binding\.mjs --ingress-check/);
    }
  });
  console.log(`PUBLIC_BFT_CADDY_JSON_SOURCE_CONTROLS_DATA_ONLY cases=${cases}; public fixtures, custody-child double, no service/SSH/Root authority`);
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
