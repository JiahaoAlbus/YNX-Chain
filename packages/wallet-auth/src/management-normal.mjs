// PRIVATE original server composition, no provider setter/runtime path. Live
// selection remains empty until independent review of this proposed contract.
import{acquireOriginalTaskGrantAuthorityInputs}from'./original-task-grant-source.js';
import{fetchOriginalNativeAuthorization}from'../native/original-ide-auth-proof-dispatch.mjs';
import{parsePQAccountAuthorization,inspectPQAuthorizationView}from'./pq-wallet-policy.js';
import{canonicalJSON}from'./canonical.js';
import{OriginalTaskGrantAuthorityServiceKernel}from'./original-task-grant-service.js';
import{encodeBoundGrant,encodeGrantEffect}from'@ynx-chain/open-protocol/bound-grant';
import{inspectManagementRequestDATA,verifyOriginalManagementProofDATA,exact}from'./management-proof-proposal.mjs';
const reviewedOriginalManagementReleases=Object.freeze([]);
 const fault=c=>Object.assign(Error(c),{code:c}),method=(v,n)=>{if(typeof v?.[n]!=='function')throw fault('GRANT_MANAGEMENT_ORIGINAL_'+n+'_NOT_SUPPLIED');return v[n].bind(v)};
async function checked(v,n,...args){if(await method(v,n)(...args)!==undefined)throw fault('GRANT_MANAGEMENT_VOID_RESULT')}
function inspectRelease(r){
 exact(r,['version','ownerRef','issuerAccount','callerAccount','issuerEpoch','policyRevision','sourceRef','networkId','node','expiresMS']);exact(r.node,['origin','spki','nativeChainId']);exact(r.sourceRef,['realm','tenant','kind','id','rev']);
 inspectManagementRequestDATA({action:'list',ownerRef:r.ownerRef,grantRef:null,expectedRevision:null,afterId:'',limit:1});
 for(const n of['issuerEpoch','policyRevision'])if(typeof r[n]!=='string'||!/^[1-9][0-9]{0,19}$/.test(r[n])||BigInt(r[n])>18446744073709551615n)throw fault('GRANT_MANAGEMENT_REVIEWED_SOURCE_REQUIRED');
 for(const k of['realm','tenant','kind','id'])if(typeof r.sourceRef[k]!=='string'||!r.sourceRef[k]||r.sourceRef[k].length>256)throw fault('GRANT_MANAGEMENT_REVIEWED_SOURCE_REQUIRED');
 if(!/^[1-9][0-9]{0,19}$/.test(r.sourceRef.rev)||r.sourceRef.realm!==r.ownerRef.realm||r.sourceRef.tenant!==r.ownerRef.tenant||!/^0x[0-9a-f]{40}$/.test(r.issuerAccount)||!/^[0-9a-f]{64}$/.test(r.networkId)||typeof r.expiresMS!=='string'||!/^([1-9][0-9]{0,15})$/.test(r.expiresMS)||BigInt(r.expiresMS)>BigInt(Number.MAX_SAFE_INTEGER))throw fault('GRANT_MANAGEMENT_REVIEWED_SOURCE_REQUIRED');
 const url=new URL(r.node.origin);if(url.protocol!=='https:'||url.origin!==r.node.origin||url.username||url.password||!/^[0-9a-f]{64}$/.test(r.node.spki)||!/^[1-9][0-9]{0,19}$/.test(r.node.nativeChainId))throw fault('GRANT_MANAGEMENT_REVIEWED_SOURCE_REQUIRED');
}
export async function openOriginalDesktopGrantManagement(){
 if(arguments.length)throw fault('GRANT_MANAGEMENT_ZERO_INPUT');
 if(reviewedOriginalManagementReleases.length!==1)return Object.freeze({owner:null,errorPresent:true,error:fault('GRANT_MANAGEMENT_REVIEWED_RELEASE_NOT_SUPPLIED')});
 const acquired=await acquireOriginalTaskGrantAuthorityInputs();return openOriginalDesktopGrantManagementFromOriginalAuthority(acquired,reviewedOriginalManagementReleases[0]);
}
// Internal normal-constructor boundary (not exported in package API). Inputs
// are original registered Source+sameSQLite+fixed caller resolver, not request
// JSON. PUBLIC tests call this in isolation and cannot populate normal rows.
export async function openOriginalDesktopGrantManagementFromOriginalAuthority(acquired,release,clock=Date.now,readCurrent=fetchOriginalNativeAuthorization){
 let parent=acquired?.owner,inputs,issueService,first,retired=false,closing;const pending=new Set();let last=0;const selected=structuredClone(release);
 const now=()=>{const at=clock();if(!Number.isSafeInteger(at)||at<last)throw fault('GRANT_MANAGEMENT_CLOCK');last=at;return at};
 const live=()=>{if(retired)throw fault('GRANT_MANAGEMENT_RETIRED');if(first)throw first.cause;if(now()>=Number(selected.expiresMS))throw fault('GRANT_MANAGEMENT_RELEASE_EXPIRED')};
 const sourceCurrent=async()=>{live();await checked(parent,'assertCurrent');live()};
 async function currentIssuer(){await sourceCurrent();const raw=await readCurrent(selected.node,selected.issuerAccount);const view=parsePQAccountAuthorization(raw,{chainId:selected.networkId,nativeChainId:selected.node.nativeChainId,owner:selected.issuerAccount});const current=inspectPQAuthorizationView(view);if(!current.activeRecord||!view.enabled||current.authorizationStatus==='revoked'||current.activeRecord.revision!==selected.issuerEpoch)throw fault('GRANT_MANAGEMENT_ISSUER_REVOKED');await sourceCurrent();return view}
 const owner=Object.freeze({
  // Normal daemon supplies the ORIGINAL accepted request to its existing
  // fixed resolver. Callers cannot mint ctx from request JSON or Owner DATA.
  async executeOriginalRequest(req,request,proof){const work=(async()=>{let caller,result,error;try{await sourceCurrent();caller=await method(inputs.callerResolver,'acquireOriginalTaskCaller')(req);await sourceCurrent();result=await owner.execute(caller,request,proof);await sourceCurrent()}catch(cause){error={cause}}finally{if(caller)try{await checked(inputs.callerResolver,'releaseOriginalTaskCaller',caller)}catch(cause){error??={cause}}}if(error)return Object.freeze({ok:false,code:'UNKNOWN',error:error.cause,original:['pause','revoke'].includes(request?.action)?result?.value??result?.original??null:null,recoveryOnly:!!result});return result})();pending.add(work);try{return await work}finally{pending.delete(work)}},
  async create(ctx,body){let result;const work=(async()=>{await sourceCurrent();if(canonicalJSON(body?.grant?.issuer)!==canonicalJSON(selected.ownerRef)||body.grant.issuerEpoch!==selected.issuerEpoch||ctx?.account!==selected.callerAccount)throw fault('GRANT_MANAGEMENT_ISSUER');result=await issueService.issue(ctx,body);await sourceCurrent();return result})();pending.add(work);try{return await work}catch(error){return Object.freeze({ok:false,code:result?'UNKNOWN':error?.code??'DENIED',error,original:result??null})}finally{pending.delete(work)}},
  async execute(ctx,request,proof){let retained,mutating=false;const work=(async()=>{const r=inspectManagementRequestDATA(request);mutating=['pause','revoke'].includes(r.action);await sourceCurrent();await checked(inputs.source,'assertTaskCaller',ctx,{action:'management',value:r.ownerRef});if(ctx.realm!==selected.ownerRef.realm||ctx.tenant!==selected.ownerRef.tenant||ctx.account!==selected.callerAccount||canonicalJSON(r.ownerRef)!==canonicalJSON(selected.ownerRef))throw fault('GRANT_MANAGEMENT_CALLER');
   const registration=await currentIssuer(),facts=verifyOriginalManagementProofDATA(proof,r,selected,registration,now());await sourceCurrent();const after=await currentIssuer();if(canonicalJSON(after)!==canonicalJSON(registration))throw fault('GRANT_MANAGEMENT_CURRENT_CHANGED');
   // Synchronous actual Source fence runs on SAME authority connection. Native
   // registry observation is bounded and rechecked after commit, not called
   // under SQLite lock or misrepresented as global chain atomicity.
   const fence=expected=>{live();if(now()>=Number(facts.expiresMS))throw fault('GRANT_MANAGEMENT_PROOF_EXPIRED');const result=method(parent,'assertOriginalManagementAuthorityAtCommit')({sourceRef:selected.sourceRef,issuerAccount:selected.issuerAccount,issuerEpoch:selected.issuerEpoch,policyRevision:selected.policyRevision,caller:ctx,expected});if(result!==undefined)throw fault('GRANT_MANAGEMENT_SYNC_FENCE_REQUIRED');live()};
   retained=inputs.store.taskGrants.manageOriginal({owner:r.ownerRef,action:r.action,grantId:r.grantRef?.id??null,grantRefRevision:r.grantRef?.rev??null,expectedRevision:r.expectedRevision,afterId:r.afterId,limit:r.limit,nonce:facts.nonce,proofBinding:facts.proofBinding,at:now(),assertCurrent:fence});
   await sourceCurrent();const final=await currentIssuer();if(canonicalJSON(final)!==canonicalJSON(registration)||now()>=Number(facts.expiresMS))throw fault('GRANT_MANAGEMENT_POST_CURRENT_UNKNOWN');return Object.freeze({ok:true,value:retained});
  })();pending.add(work);try{return await work}catch(error){return Object.freeze({ok:false,code:retained?'UNKNOWN':error?.code??'DENIED',error,original:mutating?retained??null:null,recoveryOnly:!!retained})}finally{pending.delete(work)}},
  async current(){await sourceCurrent();await currentIssuer()},
  retire(){retired=true;issueService?.retire();parent?.retire()},async join(){if(!retired)throw fault('GRANT_MANAGEMENT_RETIRE_REQUIRED');await Promise.allSettled([...pending]);if(parent)await checked(parent,'join')},
  close(){return closing??=(async()=>{owner.retire();await owner.join();if(parent)await checked(parent,'close')})()}
 });
 try{if(!acquired||typeof acquired.errorPresent!=='boolean')throw fault('GRANT_MANAGEMENT_PARTIAL_STATUS');if(acquired.errorPresent)throw acquired.error;inspectRelease(selected);if(selected.version!=='AUTH-GRANT-MANAGEMENT-REVIEWED-PROPOSAL/v1')throw fault('GRANT_MANAGEMENT_REVIEWED_SOURCE_REQUIRED');await sourceCurrent();inputs=await method(parent,'readOriginalTaskGrantServiceInputs')();if(!inputs?.store?.taskGrants?.manageOriginal||!inputs.source)throw fault('GRANT_MANAGEMENT_ORIGINAL_INPUTS_REQUIRED');method(parent,'assertOriginalManagementAuthorityAtCommit');issueService=new OriginalTaskGrantAuthorityServiceKernel(inputs.source,inputs.store,{encodeBoundGrant,encodeGrantEffect},clock);await currentIssuer();return Object.freeze({owner,errorPresent:false,error:null})}catch(cause){first={cause};return Object.freeze({owner,errorPresent:true,error:cause})}
}
