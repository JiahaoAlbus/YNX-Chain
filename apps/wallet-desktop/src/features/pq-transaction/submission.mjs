import {bindPQMigrationBroadcastRequest,assertPQMigrationBroadcastPermission} from './migration-permission-binding.mjs';
import {exactData} from './transfer-binding.mjs';
import {readPQSubmissionOriginal,bindPQTypedBroadcastRequest,assertPQTypedBroadcastPermission} from './typed-action-submission-binding.mjs';
import {projectPQTransactionProgress} from './progress-view.mjs';
import {types} from 'node:util';

const failure = code => Object.assign(Error(code), {code});
const transferFields = ['chainId','nativeChainId','from','to','amount','fee','nonce'];
export function pqBroadcastPermissionRequest(binding) {
  return Object.freeze({action:'broadcast', networkId:binding.chainId, nativeChainId:binding.nativeChainId,
    account:binding.account, operationId:binding.operationId, origin:'ynx-wallet:local-pq',
    transfer:Object.freeze(Object.fromEntries(transferFields.map(key => [key,binding[key]]))),
    requestDigest:binding.intentSha256, transportHash:binding.hash});
}
function assertPermissionBinding(resource, expected, originalBinding = null) {
  const actual = resource.readOriginal();
  exactData(actual, [...Object.keys(expected),'issuedAt','expiresAt',...(Object.hasOwn(actual ?? {},'policyRevision')?['policyRevision']:[])], 'PQ_TRANSACTION_PERMISSION_BINDING');
  exactData(actual.transfer, transferFields, 'PQ_TRANSACTION_PERMISSION_BINDING');
  if (!Object.isFrozen(actual) || !Object.isFrozen(actual.transfer) || originalBinding && originalBinding !== actual) throw failure('PQ_TRANSACTION_PERMISSION_BINDING');
  for (const time of [actual.issuedAt,actual.expiresAt]) if (typeof time !== 'string' || !Number.isFinite(Date.parse(time)) || new Date(time).toISOString() !== time) throw failure('PQ_TRANSACTION_PERMISSION_BINDING');
  const now = Date.now();
  if (Date.parse(actual.issuedAt) > now || now >= Date.parse(actual.expiresAt) || actual.issuedAt >= actual.expiresAt || Object.hasOwn(actual,'policyRevision') && (typeof actual.policyRevision !== 'string' || !/^[1-9][0-9]{0,19}$/.test(actual.policyRevision))) throw failure('PQ_TRANSACTION_PERMISSION_BINDING');
  for (const key of Object.keys(expected)) {
    if (key === 'transfer') {
      if (transferFields.some(field => actual.transfer[field] !== expected.transfer[field])) throw failure('PQ_TRANSACTION_PERMISSION_BINDING');
    } else if (actual[key] !== expected[key]) throw failure('PQ_TRANSACTION_PERMISSION_BINDING');
  }
  return actual;
}
function assertPaySourceBinding(resource,expected,prior=null){
  if(resource.assertCurrent()!==undefined)throw failure('PQ_PAY_SOURCE_CURRENT');
  const actual=resource.readOriginal();
  if(types.isProxy(actual)||!Object.isFrozen(actual))throw failure('PQ_PAY_SOURCE_BINDING');
  exactData(actual,['networkId','account','hash','memberHash','operationId','target'],'PQ_PAY_SOURCE_BINDING');
  if(types.isProxy(actual.target)||!Object.isFrozen(actual.target))throw failure('PQ_PAY_SOURCE_BINDING');
  exactData(actual.target,Object.keys(expected.target),'PQ_PAY_SOURCE_BINDING');
  if(prior&&prior!==actual||Object.keys(expected).some(k=>k!=='target'&&actual[k]!==expected[k])||Object.keys(expected.target).some(k=>actual.target[k]!==expected.target[k]))throw failure('PQ_PAY_SOURCE_BINDING');
  return actual;
}

/** Original-main consumer. The Auth owner supplies the real private factory
 * and recognizer; no renderer flag, identity proof, policy DATA, or local
 * marker can substitute for it. Transport is the fixed original node adapter.
 * Supplying these dependencies in a test is controlled testing only.
 *
 * Typed broadcast follows Main's 18-field builder and Auth R142's 19-field
 * resource/dual-hash completion. Actual private approval remains mandatory;
 * absent dependencies fail before journal/POST.
 * Migration has its own original Auth factory and recognizer. An ordinary
 * transfer/typed approval can never authorize an ACCOUNT-MIGRATION broadcast.
 */
export function createPQTransactionSubmission({intentStore, networkId,
  acquireOriginalWalletTransactionPermission = null,
  isOriginalWalletTransactionPermission = null,
  acquireOriginalWalletMigrationBroadcastPermission = null,
  isOriginalWalletMigrationBroadcastPermission = null, transport = null, readTypedOriginal = null,
  acquireOriginalPaySource = null, isOriginalPaySource = null, inspectPayResponse = null,onOriginalPayOwnerJoined=null}) {
  const active = new Set(), resources = new Set();
  let closing = false;
  const requirePermission = () => {
    if (typeof acquireOriginalWalletTransactionPermission !== 'function' || typeof isOriginalWalletTransactionPermission !== 'function') throw failure('PQ_TRANSACTION_PERMISSION_NOT_SUPPLIED');
  };
  const requireMigrationPermission = () => {
    if(typeof acquireOriginalWalletMigrationBroadcastPermission!=='function'||typeof isOriginalWalletMigrationBroadcastPermission!=='function')throw failure('PQ_MIGRATION_PERMISSION_NOT_SUPPLIED');
  };
  async function exclusive(guard, action) {
    if (closing) throw failure('PQ_TRANSACTION_CLOSING');
    if (typeof guard?.account !== 'string' || typeof guard.assert !== 'function') throw failure('PQ_TRANSACTION_ORIGINAL_BINDING');
    guard.assert();
    if (active.has(guard.account)) throw failure('PQ_TRANSACTION_IN_PROGRESS');
    active.add(guard.account);
    try { return await action(); } finally { active.delete(guard.account); }
  }
  async function closeResource(resource) {
    let failed = false, cause, joined = false;
    const attempt = async action => {try {if (await action() !== undefined) throw failure('PQ_TRANSACTION_CLEANUP_UNKNOWN');} catch (error) {if (!failed) {failed = true; cause = error;}}};
    await attempt(() => resource.retire());
    await attempt(async () => {if (await resource.join() !== undefined) throw failure('PQ_TRANSACTION_CLEANUP_UNKNOWN'); joined = true;if(onOriginalPayOwnerJoined&&onOriginalPayOwnerJoined(resource)!==undefined)throw failure('PQ_PAY_JOIN_OBSERVER_RESULT');});
    if (joined) await attempt(() => resource.close());
    if (failed) throw cause;
    resources.delete(resource);
  }
  const publicProgress = async (plan, guard, afterEffect = false) => {
    const assert = () => afterEffect ? guard.assertEffectCurrent() : guard.assert();
    assert();
    return projectPQTransactionProgress(await intentStore.readPQProgress(guard.account, plan.binding.hash, assert), {account:guard.account, hash:plan.binding.hash, kind:plan.binding.kind});
  };
  async function queryOriginalPay(plan,guard,prior){
    if(resources.size)throw failure('PQ_TRANSACTION_CLEANUP_PENDING');
    if(!plan.typed||typeof acquireOriginalPaySource!=='function'||typeof isOriginalPaySource!=='function'||['beginPQPayQuery','savePQPayQueryPacket','readPQPayQueryPacket','savePQPayQueryFailure','withPQReadObservation'].some(k=>typeof intentStore[k]!=='function'))throw failure('PQ_PAY_QUERY_SOURCE_NOT_SUPPLIED');
    if(prior.status!=='submission-unknown')throw failure('PQ_TRANSACTION_NOT_ENTERED');
    const hash=plan.binding.hash,target=await intentStore.readPQPaySubmissionTarget(guard.account,hash,()=>guard.assert());if(!target)throw failure('PQ_PAY_TARGET_REQUIRED');
    return intentStore.withPQReadObservation(guard.account,hash,()=>guard.assert(),async()=>{
      let source,binding,entered=false,failed=false,cause,result;
      const expected={networkId,account:guard.account,hash,memberHash:plan.typed.local.memberHash,operationId:plan.binding.operationId,target};
      const assertCurrent=()=>{if(closing)throw failure('PQ_TRANSACTION_CLOSING');guard.assert();binding=assertPaySourceBinding(source,expected,binding);};
      try{
        try{source=await acquireOriginalPaySource(Object.freeze({request:null,original:plan.original,target}));}
        catch(error){const d=error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'partial'):null;if(d&&Object.hasOwn(d,'value')&&d.value){source=d.value;resources.add(source);}throw error;}
        if(source===null||!['object','function'].includes(typeof source))throw failure('PQ_PAY_QUERY_SOURCE_NOT_SUPPLIED');
        resources.add(source);guard.assert();
        if(isOriginalPaySource(source)!==true)throw failure('PQ_PAY_QUERY_SOURCE_NOT_SUPPLIED');
        for(const k of ['readOriginal','assertCurrent','recheck','retire','join','close',target.kind==='invoice_terms'?'readInvoiceIntentPacket':'readInvoicePacket'])if(typeof source[k]!=='function')throw failure('PQ_PAY_QUERY_SOURCE_NOT_SUPPLIED');
        assertCurrent();if(await source.recheck()!==undefined)throw failure('PQ_PAY_SOURCE_CURRENT');assertCurrent();
        const query=await intentStore.beginPQPayQuery(guard.account,hash,assertCurrent);entered=true;
        if(!query.stored){
          assertCurrent();if(await source.recheck()!==undefined)throw failure('PQ_PAY_SOURCE_CURRENT');assertCurrent();
          const response=await (target.kind==='invoice_terms'?source.readInvoiceIntentPacket(target.intentId,assertCurrent):source.readInvoicePacket(target.merchant,target.invoiceId,assertCurrent));
          await intentStore.savePQPayQueryPacket(guard.account,hash,response);
          // SDK's current parser is POST-only. GET remains original DATA and
          // UNKNOWN; it cannot be cast to a POST/Core receipt or payment proof.
        }
        const saved=await intentStore.readPQPayQueryPacket(guard.account,hash);
        if(saved.method!==query.request.method||saved.requestPath!==query.request.requestPath)throw failure('PQ_PAY_QUERY_RESPONSE_BINDING');
        assertCurrent();result=await publicProgress(plan,guard);
      }catch(error){failed=true;cause=error;if(entered)try{await intentStore.savePQPayQueryFailure(guard.account,hash,error);}catch{/* original query/storage causes retained */}}
      finally{if(source)try{await closeResource(source);}catch(error){if(!failed){failed=true;cause=error;}}}
      if(failed)throw cause;return result;
    });
  }
  return Object.freeze({
    async broadcast(hash, guard, typedBroadcastRequest = null, payTarget = null) {
      if(typeof acquireOriginalWalletMigrationBroadcastPermission!=='function'||typeof isOriginalWalletMigrationBroadcastPermission!=='function')requirePermission();
      if (resources.size) throw failure('PQ_TRANSACTION_CLEANUP_PENDING');
      if (typeof guard?.submit !== 'function' || typeof guard?.assertEffectCurrent !== 'function') throw failure('PQ_TRANSACTION_EFFECT_GUARD_REQUIRED');
      return exclusive(guard, async () => {
        const plan = await readPQSubmissionOriginal(intentStore, hash, {account:guard.account, networkId, guard});
        // Initial birth has a distinct Main/Auth permission contract. A transfer
        // capsule or typed request can never authorize its broadcast.
        if(plan.initial)throw failure('PQ_ACCOUNT_INITIAL_BROADCAST_PERMISSION_REQUIRED');
        if(plan.migration)requireMigrationPermission();else requirePermission();
        const acquire=plan.migration?acquireOriginalWalletMigrationBroadcastPermission:acquireOriginalWalletTransactionPermission;
        const recognized=plan.migration?isOriginalWalletMigrationBroadcastPermission:isOriginalWalletTransactionPermission;
        const pay=payTarget!==null;
        if(pay&&(!plan.typed||typeof acquireOriginalPaySource!=='function'||typeof isOriginalPaySource!=='function'||typeof inspectPayResponse!=='function'||typeof intentStore.savePQPaySubmissionPacket!=='function'||typeof intentStore.readPQPaySubmissionPacket!=='function'))throw failure('PQ_PAY_DISPATCH_SOURCE_NOT_SUPPLIED');
        if (!pay&&typeof transport?.[plan.typed?'submitTypedAction':plan.migration?'submitMigration':'submitTransfer'] !== 'function') throw failure('PQ_TRANSACTION_TRANSPORT_NOT_SUPPLIED');
        if (!plan.typed && !plan.migration && typedBroadcastRequest !== null) throw failure('PQ_TRANSACTION_PERMISSION_BINDING');
        const before = await intentStore.readPQProgress(guard.account, hash, () => guard.assert());
        if(before.submissionService==='pay'&&!pay)throw failure('PQ_PAY_DISPATCH_SOURCE_NOT_SUPPLIED');
        let target=null;
        if(pay){
          if(before.submissionService!=='pay'||types.isProxy(payTarget)||!Object.isFrozen(payTarget))throw failure('PQ_PAY_TARGET_REQUIRED');
          target=await intentStore.readPQPaySubmissionTarget(guard.account,hash,()=>guard.assert());
          if(!target)throw failure('PQ_PAY_TARGET_CONFLICT');
          exactData(payTarget,Object.keys(target),'PQ_PAY_TARGET_CONFLICT');
          if(Object.keys(target).some(k=>target[k]!==payTarget[k]))throw failure('PQ_PAY_TARGET_CONFLICT');
        }
        if (before.status !== 'signed-unsubmitted') throw failure('PQ_TRANSACTION_ALREADY_ENTERED');
        if(plan.migration&&typeof intentStore.savePQMigrationSubmissionResult!=='function')throw failure('PQ_MIGRATION_RESPONSE_CUSTODY_REQUIRED');
        const request = plan.typed?bindPQTypedBroadcastRequest(plan,typedBroadcastRequest):plan.migration?bindPQMigrationBroadcastRequest(plan,typedBroadcastRequest):pqBroadcastPermissionRequest(plan.binding);
        const assertBinding = plan.typed?assertPQTypedBroadcastPermission:plan.migration?assertPQMigrationBroadcastPermission:assertPermissionBinding;
        const completion = outcome => ({outcome,transportHash:hash,...(plan.typed?{memberHash:plan.typed.local.memberHash}:plan.migration?{abciTransactionHash:plan.binding.abciTransactionHash}:{})});
        // Closing can start while an approval, journal write or node preflight
        // is awaiting. Fence each later effect boundary, but keep custody of
        // a POST already started and its returned response/cleanup obligation.
        const assertOpen = () => {if (closing) throw failure('PQ_TRANSACTION_CLOSING');};
        const assertBeforeSubmit = () => {assertOpen(); guard.assert();};
        let resource, permissionBinding, payResource, payBinding, entered = false, submitted = false, returned = false, completed = false, failed = false, cause, result, transportCause, transportFailed = false;
        const assertPayBinding=()=>{
          if(!pay)return;
          const expected={networkId,account:guard.account,hash,memberHash:plan.typed.local.memberHash,operationId:plan.binding.operationId,target};
          payBinding=assertPaySourceBinding(payResource,expected,payBinding);
        };
        try {
          assertBeforeSubmit();
          try {resource = await acquire(request);} catch (error) {
            const partial = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'partial') : null;
            if (partial && Object.hasOwn(partial,'value') && partial.value) {resource = partial.value; resources.add(resource);}
            throw error;
          }
          // Retain foreign ownership before post-await lock/brand checks.
          resources.add(resource); assertBeforeSubmit();
          if (recognized(resource) !== true) throw failure(plan.migration?'PQ_MIGRATION_PERMISSION_NOT_SUPPLIED':'PQ_TRANSACTION_PERMISSION_NOT_SUPPLIED');
          for (const name of ['readOriginal','assertCurrent','recheck','enterBroadcast','complete','retire','join','close']) if (typeof resource?.[name] !== 'function') throw failure('PQ_TRANSACTION_PERMISSION_NOT_SUPPLIED');
          if (resource.assertCurrent() !== undefined) throw failure('PQ_TRANSACTION_PERMISSION_CURRENT');
          permissionBinding = assertBinding(resource, request);
          if (await resource.recheck() !== undefined) throw failure('PQ_TRANSACTION_PERMISSION_CURRENT');
          assertBeforeSubmit(); assertBinding(resource, request, permissionBinding);
          if(pay){
            try{payResource=await acquireOriginalPaySource(Object.freeze({request,original:plan.original,target}));}
            catch(error){const partial=error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'partial'):null;if(partial&&Object.hasOwn(partial,'value')&&partial.value){payResource=partial.value;resources.add(payResource);}throw error;}
            if(payResource===null||!['object','function'].includes(typeof payResource))throw failure('PQ_PAY_DISPATCH_SOURCE_NOT_SUPPLIED');
            resources.add(payResource);assertBeforeSubmit();
            if(payResource===resource||isOriginalPaySource(payResource)!==true)throw failure('PQ_PAY_DISPATCH_SOURCE_NOT_SUPPLIED');
            for(const name of ['readOriginal','assertCurrent','recheck','retire','join','close',target.kind==='invoice_terms'?'submitMerchantMemberPacket':target.kind==='invoice_settle'?'submitSettlementPacket':'submitRefundPacket'])if(typeof payResource?.[name]!=='function')throw failure('PQ_PAY_DISPATCH_SOURCE_NOT_SUPPLIED');
            assertPayBinding();if(await payResource.recheck()!==undefined)throw failure('PQ_PAY_SOURCE_CURRENT');assertBeforeSubmit();assertPayBinding();
          }
          const marker = await intentStore.beginPQSubmission(guard.account, hash, () => {assertBeforeSubmit();resource.assertCurrent();assertPayBinding();},target);
          if (marker.created !== true) throw failure('PQ_TRANSACTION_ALREADY_ENTERED');
          entered = true;
          assertBeforeSubmit();
          if (await resource.recheck() !== undefined) throw failure('PQ_TRANSACTION_PERMISSION_CURRENT');
          if(pay&&await payResource.recheck()!==undefined)throw failure('PQ_PAY_SOURCE_CURRENT');
          assertPayBinding();
          assertBeforeSubmit(); assertBinding(resource, request, permissionBinding);
          if (await resource.enterBroadcast() !== undefined) throw failure('PQ_TRANSACTION_PERMISSION_ENTRY_UNKNOWN');
          assertBeforeSubmit();
          const response = await guard.submit(async () => {
            assertOpen();
            guard.assertEffectCurrent();
            if (resource.assertCurrent() !== undefined) throw failure('PQ_TRANSACTION_PERMISSION_CURRENT');
            submitted = true;
            try {
              const assertCurrent = () => {
                assertOpen();
                guard.assertEffectCurrent();
                if (resource.assertCurrent() !== undefined) throw failure('PQ_TRANSACTION_PERMISSION_CURRENT');
                assertBinding(resource, request, permissionBinding);
                assertPayBinding();
              };
              const received=await (pay?target.kind==='invoice_terms'?payResource.submitMerchantMemberPacket(target.intentId,plan.typed.local.member,assertCurrent):target.kind==='invoice_settle'?payResource.submitSettlementPacket(target.merchant,target.invoiceId,plan.typed.local.member,assertCurrent):payResource.submitRefundPacket(target.merchant,target.invoiceId,plan.typed.local.member,assertCurrent):plan.typed?transport.submitTypedAction(plan.typed.review,plan.typed.raw,plan.typed.original,assertCurrent):plan.migration?transport.submitMigration(plan.request,assertCurrent):transport.submitTransfer(plan.request,assertCurrent));
              if(pay){returned=true;await intentStore.savePQPaySubmissionPacket(guard.account,hash,received);}
              if(plan.migration){returned=true;await intentStore.savePQMigrationSubmissionResult(guard.account,hash,received);}
              return received;
            } catch (error) {transportFailed = true; transportCause = error; throw error;}
          });
          returned = true;
          // The journal captures the complete result before any late-lock,
          // current, completion, cleanup, or public-DTO check can reject it.
          if(!pay&&!plan.migration)await intentStore.savePQSubmissionResult(guard.account, hash, plan.typed?{phase:'submission',response}:{phase:'submission',statusCode:response?.status,text:response?.text});
          if(pay){
            const packet=await intentStore.readPQPaySubmissionPacket(guard.account,hash);
            // This is SDK DATA math only, after acknowledged durable custody.
            // Its service observation never changes UNKNOWN or grants a send.
            const observation=inspectPayResponse(plan.typed.original.signingSnapshot,{member:plan.typed.local.member,originals:plan.typed.local.originals},target.kind==='invoice_terms'?{intentId:target.intentId}:{},packet);
            if(!observation||types.isPromise(observation)||observation.outcome!=='UNKNOWN'||observation.observationOnly!==true||observation.dataOnly!==true||observation.memberHash!==plan.typed.local.memberHash||observation.envelopeHash!==hash||['paid','submitted','permission','consensusFinality','canRetry','clearsOriginal','SourceAdmission','NativeAdmission'].some(k=>observation[k]!==false))throw failure('PQ_PAY_RESPONSE_OBSERVATION_INVALID');
          }
          completed = true;
          if (await resource.complete(completion('returned')) !== undefined) throw failure('PQ_TRANSACTION_COMPLETION_UNKNOWN');
          guard.assertEffectCurrent();
          result = await publicProgress(plan, guard, true);
        } catch (error) {
          failed = true; cause = transportFailed ? transportCause : error;
          if (entered) {
            try {await intentStore.savePQSubmissionFailure(guard.account,hash,cause);} catch { /* original store retains both causes and raw result */ }
          }
          if (resource && submitted && !completed) {
            completed = true;
            try {await resource.complete(completion(returned?'returned':'unknown'));} catch { /* first cause wins; resource cleanup is still required */ }
          }
        } finally {
          if(payResource&&payResource!==resource)try{await closeResource(payResource);}catch(error){if(!failed){failed=true;cause=error;}}
          if (resource) try {await closeResource(resource);} catch (error) {if (!failed) {failed = true; cause = error;}}
        }
        if (failed) {
          if (submitted && !returned) throw Object.assign(failure('PQ_TRANSACTION_OUTCOME_UNKNOWN'), {cause, data:{code:'PQ_TRANSACTION_OUTCOME_UNKNOWN',transactionHash:hash,outcomeUnknown:true}});
          throw cause;
        }
        return result;
      });
    },
    async reconcile(hash, guard) {
      return exclusive(guard, async () => {
        const plan = await readPQSubmissionOriginal(intentStore,hash,{account:guard.account,networkId,guard});
        const prior = await intentStore.readPQProgress(guard.account,hash,()=>guard.assert());
        if(['finalized-succeeded','finalized-rejected'].includes(prior.status))return publicProgress(plan,guard);
        if(prior.submissionService==='pay')return queryOriginalPay(plan,guard,prior);
        if(typeof (plan.typed?readTypedOriginal:transport?.readOriginal)!=='function')throw failure('PQ_TRANSACTION_TRANSPORT_NOT_SUPPLIED');
        if (!plan.typed && prior.status === 'signed-unsubmitted') throw failure('PQ_TRANSACTION_NOT_ENTERED');
        if(typeof intentStore.withPQReadObservation!=='function')throw failure('PQ_TRANSACTION_JOURNAL_READ_GUARD_REQUIRED');
        guard.assert();
        return intentStore.withPQReadObservation(guard.account,hash,()=>guard.assert(),async()=>{
        try {
          if(plan.typed){
            const t=plan.typed;let captured=false;
            await readTypedOriginal(t.review,t.raw,t.original,()=>guard.assert(),async response=>{
              if(captured)throw failure('PQ_TRANSACTION_CAPTURE_DUPLICATE');captured=true;
              await intentStore.savePQTypedReadResult(guard.account,hash,response);
            });
            if(!captured)throw failure('PQ_TRANSACTION_CAPTURE_REQUIRED');
          }else{
            const response = await transport.readOriginal(hash);
            await intentStore.savePQSubmissionResult(guard.account,hash,{phase:'read',statusCode:response?.status,text:response?.text});
          }
          guard.assert();
          return await publicProgress(plan,guard);
        } catch (error) {
          // The original store updates an existing progress record only. With
          // no marker it keeps the local cause and refuses to invent a marker.
          try {await intentStore.savePQSubmissionFailure(guard.account,hash,error);} catch { /* retained by original store */ }
          throw error;
        }
        });
      });
    },
    assertSafeToClose() {
      closing = true;
      if (active.size || resources.size) throw failure('PQ_TRANSACTION_CLEANUP_PENDING');
    },
  });
}
