// DATA validation inside the original protected operator approval path. This
// does not mint a permit, authenticate a new issuer, or infer an owner from a
// display name. The selected original files remain independently pinned inputs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {validatorRoles, validatorManifestRecordsByRole, assertNoSecretFields} from './owner-handover.mjs';
import {authoritativeIdentity, authoritativeRoleIdentities, caddySourceIdentity, operatorPreparationPin, validateAuthoritativeObservation} from './public-bft-native-source.mjs';

export const sameOwnerProfile = 'single-app-same-owner-inplace/v1';
export const isSameOwner = value => value?.custodyProfile === sameOwnerProfile;
const need = (ok, message) => {if (!ok) throw new Error(`same-owner cutover rejected: ${message}`);};
const closed = (v, keys) => need(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === [...keys].sort().join(), 'closed original fields required');
const hash = x => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x) && !/^0{64}$/.test(x);
const sha = raw => crypto.createHash('sha256').update(raw).digest('hex');
const id = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(x);
const time = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(x) && Number.isFinite(Date.parse(x));
const same = (a,b,label) => {try {assert.deepEqual(a,b);} catch {need(false,label);}};
const identity = s => ['dev','ino','mode','uid','gid','nlink','size','mtimeNs','ctimeNs'].map(k=>String(s[k])).join(':');

// Hold each public original while reading and check the pathname again. No
// private key, HRS body, directory scan, alias or caller-selected executable.
export function readSameOwnerOriginal(file, expected, maximum=1<<20, restricted=true) {
  need(path.isAbsolute(file) && fs.realpathSync(file) === file, 'canonical public original required');
  const before = fs.lstatSync(file,{bigint:true});
  need(before.isFile() && before.nlink===1n && !(before.mode & (restricted ? 0o077n : 0o022n)) && before.size>0n && before.size<=BigInt(maximum), 'bounded private public-evidence file required');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try {
    need(identity(before)===identity(fs.fstatSync(fd,{bigint:true})), 'original changed before read');
    const chunks=[];let length=0;
    for (;;) {const part=Buffer.alloc(Math.min(65536,maximum+1-length));const n=fs.readSync(fd,part,0,part.length,null);if(!n)break;length+=n;need(length<=maximum,'original grew beyond bound');chunks.push(part.subarray(0,n));}
    const raw=Buffer.concat(chunks);
    need(BigInt(raw.length)===before.size && identity(before)===identity(fs.fstatSync(fd,{bigint:true})) && identity(before)===identity(fs.lstatSync(file,{bigint:true})), 'original changed during read');
    const digest=sha(raw);if(expected!==undefined)need(hash(expected)&&digest===expected,'independent original SHA256 differs');
    return {raw,sha256:digest};
  } finally {fs.closeSync(fd);}
}
function parseOriginalJSON(raw) {
  const text=raw.toString('utf8');need(Buffer.from(text).equals(raw),'invalid UTF-8 public original');
  let i=0;const ws=()=>{while(/\s/.test(text[i]||'')&&i<text.length)i++;};
  const string=()=>{const start=i++;while(i<text.length){const c=text[i++];if(c==='"')return JSON.parse(text.slice(start,i));if(c==='\\')i++;}need(false,'incomplete JSON string');};
  function value(depth){need(depth<=64,'public JSON depth bound');ws();const c=text[i];
    if(c==='{'){i++;ws();const seen=new Set();if(text[i]==='}'){i++;return;}for(;;){need(text[i]==='"','object field required');const key=string();need(!seen.has(key),'duplicate public JSON field');seen.add(key);ws();need(text[i++]===':','object colon required');value(depth+1);ws();const separator=text[i++];if(separator==='}')return;need(separator===',','object separator required');ws();}}
    if(c==='['){i++;ws();if(text[i]===']'){i++;return;}for(;;){value(depth+1);ws();const separator=text[i++];if(separator===']')return;need(separator===',','array separator required');}}
    if(c==='"'){string();return;}const start=i;while(i<text.length&&!/[\s,}\]]/.test(text[i]))i++;need(i>start,'JSON value required');JSON.parse(text.slice(start,i));
  }
  value(0);ws();need(i===text.length,'trailing public JSON bytes');return JSON.parse(text);
}
export const readSameOwnerJSON = file => parseOriginalJSON(readSameOwnerOriginal(path.resolve(file)).raw);
function reference(root,r,parse=true) {
  closed(r,['file','sha256']);need(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(r.file)&&hash(r.sha256),'bounded public basename and pin required');
  const original=readSameOwnerOriginal(path.join(root,r.file),r.sha256);
  if(!parse)return original.raw;
  const value=parseOriginalJSON(original.raw);assertNoSecretFields(value,'same-owner public original');return value;
}
const publicFields=['role','validatorAddress','consensusKeyType','consensusPubKey','consensusAddress','nodeId'];
function publicTuple(v,role) {
  need(v?.role===role && v.validatorAddress===`ynx_validator_${role.replaceAll('-','_')}` && v.consensusKeyType==='tendermint/PubKeyEd25519','original role/algorithm differs');
  const pub=Buffer.from(v.consensusPubKey||'','base64');
  need(pub.length===32&&pub.toString('base64')===v.consensusPubKey&&v.consensusAddress===sha(pub).slice(0,40).toUpperCase()&&/^[0-9a-f]{40}$/.test(v.nodeId),'full original Ed/P2P public identity differs');
  return Object.fromEntries(publicFields.map(k=>[k,v[k]]));
}
function manifest(v) {
  closed(v,['version','purpose','chainId','validators']);
  need(v.version===1&&v.purpose==='ynx-production-bft-candidate-public-keys-only'&&v.chainId==='ynx_6423-1','original validator manifest identity differs');
  const rows=validatorManifestRecordsByRole(v.validators);
  const result=validatorRoles.map(role=>{
    const r=rows.get(role);closed(r,[...publicFields,'privateP2PHost','p2pPort']);
    need(typeof r.privateP2PHost==='string'&&/^10\.[0-9.]+$/.test(r.privateP2PHost)&&Number.isInteger(r.p2pPort)&&r.p2pPort>0&&r.p2pPort<=65535,'original private P2P endpoint required');
    return {...publicTuple(r,role),privateP2PHost:r.privateP2PHost,p2pPort:r.p2pPort};
  });
  for(const key of ['nodeId','consensusAddress','validatorAddress'])need(new Set(result.map(r=>r[key])).size===4,'duplicate original identity');
  return result;
}
const recoveryTrue=['sourceReadOnly','sourceFilesUnchanged','backupBytesMatched','restoreBytesMatched','restoredIdentityMatched','restoredHRSConsistency','manifestMatched','isolatedRecoveryVerified','sameHost'];
const recoveryFalse=['offHostRecoveryVerified','hrsHistoryVerified','independentReview','authorityGranted','signingPerformed','liveRestorePerformed','serviceChanged','rotationVerified'];
function recovery(v,role,rolePin,record) {
  closed(v,['version','role','serviceUID','roleManifestSHA256','sourceDirectory','privateRecoveryDirectory','publicRecord',...recoveryTrue,...recoveryFalse]);
  need(v.version==='YNX-CONSENSUS-KEYCHECK-ISOLATED-RECOVERY/v1'&&v.role===role&&v.roleManifestSHA256===rolePin,'original normal recovery receipt required');
  need(Number.isSafeInteger(v.serviceUID)&&v.serviceUID>0&&v.sourceDirectory===`/etc/ynx/consensus-candidate/${role}`,'original nonroot custody owner/path required');
  need(typeof v.privateRecoveryDirectory==='string'&&path.isAbsolute(v.privateRecoveryDirectory)&&path.normalize(v.privateRecoveryDirectory)===v.privateRecoveryDirectory&&!v.privateRecoveryDirectory.startsWith(v.sourceDirectory+'/')&&v.privateRecoveryDirectory!==v.sourceDirectory&&!v.sourceDirectory.startsWith(v.privateRecoveryDirectory+'/'),'isolated original recovery required');
  need(recoveryTrue.every(k=>v[k]===true)&&recoveryFalse.every(k=>v[k]===false),'recovery/UNKNOWN/history boundary differs');
  closed(v.publicRecord,['version','purpose',...publicFields,'custodyBoundary']);
  need(v.publicRecord.version===1&&v.publicRecord.purpose==='ynx-production-bft-candidate-public-keys-only'&&v.publicRecord.custodyBoundary==='owner-controlled-host-local','original owner-local recovery record required');
  same(publicTuple(v.publicRecord,role),publicTuple(record,role),'recovery identity changed');
  return {role,serviceUID:v.serviceUID,sourceDirectory:v.sourceDirectory,publicRecord:v.publicRecord};
}
const operationFiles=['scripts/ops/public-bft-cutover-transaction.sh','scripts/ops/public-bft-production-driver.sh','scripts/ops/remote/public-bft-native-identity.py','scripts/ops/init-consensus-candidate-keys.sh'];
const evidenceKeys=['version','reviewSHA256','sourceCommit','originalValidatorManifestSHA256','validatorManifestSHA256','operatorPreparationPlanSHA256','runtimeManifestSHA256','exporterManifestSHA256','operationAuthorizationEvidenceSHA256','operationsSourceSHA256','roleEvidenceSHA256','handover','recovery','hrsHistoryVerified','pqRecoveryVerified'];
export function validateSameOwnerProjection(a,commit,release,preparation=false,{current=true}={}) {
  const common=['custodyProfile','schemaVersion','action','approved','approvalId','transactionId','commit','release','publicCutoverAuthorized','automaticRollbackRequired','custodyEvidence','sameOwnerEvidence','operationAuthorizationEvidence','validatorManifestSha256','operatorPreparationPlanSha256','runtimeManifestSha256','exporterManifestSha256','authoritativeCommit','authoritativeRelease','authoritativeBinarySha256','authoritativeSource','authoritativeRoles','expiresAt'];
  const allowed=[...common,...(preparation?['preparationOnly']:['operatorPlanSha256','snapshotSourceSha256','candidateGenesisTime'])];
  if(Object.hasOwn(a,'authoritativeSystemd'))allowed.push('authoritativeSystemd');
  if(!preparation&&Object.hasOwn(a,'caddySource'))allowed.push('caddySource');
  if(Object.hasOwn(a,'validated')){need(a.validated===true,'invalid normalized validation result');allowed.push('validated');}
  closed(a,allowed);
  need(isSameOwner(a)&&a.schemaVersion===1&&a.action==='ynx-public-bft-cutover'&&a.approved===true&&id(a.approvalId)&&id(a.transactionId)&&a.commit===commit&&a.release===release&&release===`ynx-bft-gateway-${commit}`,'original operation scope differs');
  need(a.publicCutoverAuthorized===true&&a.automaticRollbackRequired===true,'original explicit operation/rollback consent required');
  const e=a.sameOwnerEvidence;closed(e,evidenceKeys);
  need(e.version==='YNX-SAME-OWNER-INPLACE-CHECK/v1'&&/^[0-9a-f]{40}$/.test(e.sourceCommit)&&e.sourceCommit.slice(0,12)===commit,'same-source evidence required');
  for(const k of evidenceKeys.filter(k=>k.endsWith('SHA256')))need(hash(e[k]),'complete evidence pins required');
  need(e.handover==='not-applicable-same-owner-verified'&&e.recovery==='original-legacy-isolated-same-host'&&e.hrsHistoryVerified===false&&e.pqRecoveryVerified===false,'no fabricated handover/history/PQ recovery');
  need(a.custodyEvidence===`sha256:${e.reviewSHA256}`&&a.operationAuthorizationEvidence===`sha256:${e.operationAuthorizationEvidenceSHA256}`,'original operation/custody reference differs');
  for(const [x,y]of [['validatorManifestSha256','validatorManifestSHA256'],['operatorPreparationPlanSha256','operatorPreparationPlanSHA256'],['runtimeManifestSha256','runtimeManifestSHA256'],['exporterManifestSha256','exporterManifestSHA256']])need(a[x]===e[y],'independent approval source pin differs');
  authoritativeIdentity(a);need(Object.keys(authoritativeRoleIdentities(a).authoritativeRoles||{}).length===4,'all original native role identities required');
  caddySourceIdentity(a);operatorPreparationPin(a,preparation);
  need(time(a.expiresAt)&&(!current||(Date.parse(a.expiresAt)>Date.now()&&Date.parse(a.expiresAt)<=Date.now()+86400000)),'expired/invalid operation window');
  if(preparation)need(a.preparationOnly===true,'preparation scope required');
  else need(hash(a.operatorPlanSha256)&&hash(a.snapshotSourceSha256)&&time(a.candidateGenesisTime)&&Date.parse(a.candidateGenesisTime)<=Date.parse(a.expiresAt),'actual final state/plan/genesis pins required');
  const out={...a};delete out.validated;return out;
}
export function validateSameOwnerReview(file,commit,manifestPin) {
  const original=readSameOwnerOriginal(path.resolve(file));const v=parseOriginalJSON(original.raw),root=path.dirname(path.resolve(file));
  closed(v,['version','custodyProfile','reviewId','transactionId','sourceCommit','reviewedAt','expiresAt','sources','roles','operations']);
  need(v.version==='YNX-SAME-OWNER-INPLACE-CUSTODY/v1'&&isSameOwner(v)&&id(v.reviewId)&&id(v.transactionId)&&/^[0-9a-f]{40}$/.test(v.sourceCommit)&&v.sourceCommit.slice(0,12)===commit,'original same-owner source scope required');
  need(time(v.reviewedAt)&&time(v.expiresAt)&&Date.parse(v.reviewedAt)<=Date.now()+300000&&Date.parse(v.expiresAt)>Date.now()&&Date.parse(v.expiresAt)>Date.parse(v.reviewedAt)&&Date.parse(v.expiresAt)-Date.parse(v.reviewedAt)<=86400000,'current bounded review window required');
  closed(v.sources,['originalValidatorManifest','validatorManifest','operatorPreparationPlan','runtimeManifest','exporterManifest','operationAuthorization']);
  const old=manifest(reference(root,v.sources.originalValidatorManifest)),next=manifest(reference(root,v.sources.validatorManifest));
  same(old,next,'identity change requires original handover/rotation profile');need(v.sources.validatorManifest.sha256===manifestPin,'independent target manifest differs');
  const plan=reference(root,v.sources.operatorPreparationPlan);
  need(plan.version==='YNX-PRODUCTION-OPERATOR/v1'&&plan.preparationOnly===true&&plan.chainId==='ynx_6423-1'&&plan.validatorManifestSHA256===manifestPin&&!plan.pqSchedule&&!plan.pqScheduleHash,'only original native preparation plan without future PQ state');
  need(!Object.hasOwn(plan,'consensusGenesis')&&!Object.hasOwn(plan,'consensusGenesisSHA256')&&!Object.hasOwn(plan,'migrationStateHash'),'preparation cannot assert future genesis/migration');
  const planRoles=validatorManifestRecordsByRole(plan.roles);
  need(Array.isArray(v.roles)&&v.roles.length===4,'four original custody records required');
  const roleRows=validatorManifestRecordsByRole(v.roles);
  for(const [index,role]of validatorRoles.entries()){
    const row=roleRows.get(role);closed(row,['role','roleManifest','priorRecovery','currentRecovery','nativeObservation']);
    const roleManifest=reference(root,row.roleManifest);closed(roleManifest,['version','purpose','chainId','candidateRoot','genesisHash','migrationStateHash','node','privateValidatorKeyPath','nodeKeyPath']);need(roleManifest.version===1&&hash(roleManifest.genesisHash)&&hash(roleManifest.migrationStateHash)&&roleManifest.purpose==='ynx-production-bft-candidate-public-keys-only'&&roleManifest.chainId==='ynx_6423-1'&&roleManifest.node?.role===role,'original role manifest required');
    need(roleManifest.privateValidatorKeyPath===`/etc/ynx/consensus-candidate/${role}/priv_validator_key.json`&&roleManifest.nodeKeyPath===`/etc/ynx/consensus-candidate/${role}/node_key.json`,'original role custody paths differ');
    same(publicTuple(roleManifest.node,role),publicTuple(old[index],role),'original role manifest public tuple differs');
    const prior=recovery(reference(root,row.priorRecovery),role,row.roleManifest.sha256,old[index]);
    const now=recovery(reference(root,row.currentRecovery),role,row.roleManifest.sha256,next[index]);same(prior,now,'owner, custody or original key changed');
    const p=planRoles.get(role);need(p.legacyKeyPath===`${now.sourceDirectory}/priv_validator_key.json`&&p.legacyStatePath===`${now.sourceDirectory}/priv_validator_state.json`&&p.nodeKeyPath===`${now.sourceDirectory}/node_key.json`,'plan cannot replace/reset original key/HRS paths');
  }
  const runtime=reference(root,v.sources.runtimeManifest),exporter=reference(root,v.sources.exporterManifest);
  need(runtime.version==='YNX-PQ-LINUX-RUNTIME-CANDIDATE/v3'&&runtime.commit===v.sourceCommit&&runtime.platform==='linux/amd64'&&/^[1-9][0-9]*$/.test(runtime.runId)&&['runtimeStarted','publicDeployment','pqActivation'].every(k=>runtime[k]===false),'normal SOURCE v3 release provenance required');
  need(exporter.version==='YNX-PQ-OFFLINE-MIGRATION-TOOLS/v2'&&exporter.commit===v.sourceCommit&&exporter.platform==='linux/amd64'&&['runtimeStarted','deploymentReady','authorityGranted','executionReady'].every(k=>exporter[k]===false),'same-source normal exporter provenance required');
  need(Buffer.byteLength(reference(root,v.sources.operationAuthorization,false))>0,'original operation authorization evidence missing');
  closed(v.operations,operationFiles);
  const repo=path.resolve(import.meta.dirname,'../../..');
  for(const name of operationFiles){closed(v.operations[name],['bytes','sha256']);const raw=readSameOwnerOriginal(path.join(repo,name),undefined,1<<20,false).raw;need(v.operations[name].bytes===raw.length&&v.operations[name].sha256===sha(raw),'selected normal operations source changed');}
  // All originals are rechecked at the end; a failed read never emits a result.
  for(const r of Object.values(v.sources))reference(root,r,false);
  for(const row of v.roles)for(const k of ['roleManifest','priorRecovery','currentRecovery','nativeObservation'])reference(root,row[k],false);
  need(readSameOwnerOriginal(path.resolve(file)).sha256===original.sha256,'review changed during validation');
  const evidence={version:'YNX-SAME-OWNER-INPLACE-CHECK/v1',reviewSHA256:original.sha256,sourceCommit:v.sourceCommit,originalValidatorManifestSHA256:v.sources.originalValidatorManifest.sha256,validatorManifestSHA256:manifestPin,operatorPreparationPlanSHA256:v.sources.operatorPreparationPlan.sha256,runtimeManifestSHA256:v.sources.runtimeManifest.sha256,exporterManifestSHA256:v.sources.exporterManifest.sha256,operationAuthorizationEvidenceSHA256:v.sources.operationAuthorization.sha256,operationsSourceSHA256:sha(JSON.stringify(v.operations)),roleEvidenceSHA256:sha(JSON.stringify(v.roles)),handover:'not-applicable-same-owner-verified',recovery:'original-legacy-isolated-same-host',hrsHistoryVerified:false,pqRecoveryVerified:false};
  return {custodyProfile:sameOwnerProfile,status:'passed',sameOwnerEvidence:evidence,custodyEvidence:`sha256:${original.sha256}`,expiresAt:v.expiresAt};
}
export function validateSameOwnerApproval(a,reviewPath,commit,release,preparation) {
  const review=validateSameOwnerReview(reviewPath,commit,a.validatorManifestSha256);
  const normalized={...a,sameOwnerEvidence:review.sameOwnerEvidence};
  const packet=parseOriginalJSON(readSameOwnerOriginal(path.resolve(reviewPath),review.sameOwnerEvidence.reviewSHA256).raw);
  need(packet.transactionId===a.transactionId,'original transaction differs');
  for(const role of packet.roles)validateAuthoritativeObservation(reference(path.dirname(path.resolve(reviewPath)),role.nativeObservation),a,role.role,a.transactionId);
  need(!Object.hasOwn(a,'sameOwnerEvidence')&&!Object.hasOwn(a,'validated'),'raw approval cannot inject validator results');
  validateSameOwnerProjection(normalized,commit,release,preparation);
  need(Date.parse(a.expiresAt)<=Date.parse(review.expiresAt),'approval outlives original evidence');
  return normalized;
}

// This existing custody-packet writer branch only retains validated public
// originals. It never fills an approval, grants authority, or edits a source.
export function publishSameOwnerReview(input, inputPin, destination) {
  const source=readSameOwnerOriginal(input,inputPin),value=parseOriginalJSON(source.raw);
  const result=validateSameOwnerReview(input,value.sourceCommit?.slice(0,12),value.sources?.validatorManifest?.sha256);
  need(path.isAbsolute(destination)&&path.normalize(destination)===destination&&fs.realpathSync(path.dirname(destination))===path.dirname(destination),'exclusive canonical output required');
  const parent=fs.lstatSync(path.dirname(destination));need(parent.isDirectory()&&(parent.mode&0o7777)===0o700,'existing private output parent required');
  need(!fs.existsSync(destination),'existing packet/UNKNOWN must be retained');
  const entries=[...Object.values(value.sources),...value.roles.flatMap(row=>['roleManifest','priorRecovery','currentRecovery','nativeObservation'].map(k=>row[k]))];
  const files=new Map();
  for(const ref of entries){need(!['review.json','intent.json'].includes(ref.file),'reserved output name');if(files.has(ref.file))need(files.get(ref.file)===ref.sha256,'conflicting original reference');files.set(ref.file,ref.sha256);}
  fs.mkdirSync(destination,{mode:0o700});
  const syncDir=dir=>{const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
  syncDir(path.dirname(destination));
  const write=(name,raw)=>{const fd=fs.openSync(path.join(destination,name),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
  write('intent.json',Buffer.from(JSON.stringify({version:'YNX-SAME-OWNER-PUBLIC-PACKET/v1',inputSHA256:inputPin,status:'unknown',automaticRetry:false})+'\n'));
  syncDir(destination);
  for(const [name,pin]of files){const raw=readSameOwnerOriginal(path.join(path.dirname(input),name),pin).raw;write(name,raw);readSameOwnerOriginal(path.join(destination,name),pin);}
  syncDir(destination);
  need(readSameOwnerOriginal(input,inputPin).sha256===source.sha256,'source changed before publication');
  // The original packet bytes are the final commit record, never re-encoded.
  write('review.json',source.raw);syncDir(destination);
  const held=validateSameOwnerReview(path.join(destination,'review.json'),value.sourceCommit.slice(0,12),value.sources.validatorManifest.sha256);
  same(held,result,'retained packet differs');
  return {version:'YNX-SAME-OWNER-PUBLIC-PACKET/v1',reviewPath:path.join(destination,'review.json'),reviewSHA256:source.sha256,publicFiles:files.size+1,publicDataOnly:true,operationAuthorized:false,deploymentVerified:false};
}
