import {bindPQMigrationBroadcastRequest,assertPQMigrationBroadcastPermission} from './migration-permission-binding.mjs';
import {exactData} from './transfer-binding.mjs';
import {readPQSubmissionOriginal,bindPQTypedBroadcastRequest,assertPQTypedBroadcastPermission} from './typed-action-submission-binding.mjs';
import {projectPQTransactionProgress} from './progress-view.mjs';

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
  isOriginalWalletMigrationBroadcastPermission = null, transport = null, readTypedOriginal = null}) {
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
    await attempt(async () => {if (await resource.join() !== undefined) throw failure('PQ_TRANSACTION_CLEANUP_UNKNOWN'); joined = true;});
    if (joined) await attempt(() => resource.close());
    if (failed) throw cause;
    resources.delete(resource);
  }
  const publicProgress = async (plan, guard, afterEffect = false) => {
    const assert = () => afterEffect ? guard.assertEffectCurrent() : guard.assert();
    assert();
    return projectPQTransactionProgress(await intentStore.readPQProgress(guard.account, plan.binding.hash, assert), {account:guard.account, hash:plan.binding.hash, kind:plan.binding.kind});
  };
  return Object.freeze({
    async broadcast(hash, guard, typedBroadcastRequest = null) {
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
        if (typeof transport?.[plan.typed?'submitTypedAction':plan.migration?'submitMigration':'submitTransfer'] !== 'function') throw failure('PQ_TRANSACTION_TRANSPORT_NOT_SUPPLIED');
        if (!plan.typed && !plan.migration && typedBroadcastRequest !== null) throw failure('PQ_TRANSACTION_PERMISSION_BINDING');
        const before = await intentStore.readPQProgress(guard.account, hash, () => guard.assert());
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
        let resource, permissionBinding, entered = false, submitted = false, returned = false, completed = false, failed = false, cause, result, transportCause, transportFailed = false;
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
          const marker = await intentStore.beginPQSubmission(guard.account, hash, () => {assertBeforeSubmit();resource.assertCurrent();});
          if (marker.created !== true) throw failure('PQ_TRANSACTION_ALREADY_ENTERED');
          entered = true;
          assertBeforeSubmit();
          if (await resource.recheck() !== undefined) throw failure('PQ_TRANSACTION_PERMISSION_CURRENT');
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
              };
              const received=await (plan.typed?transport.submitTypedAction(plan.typed.review,plan.typed.raw,plan.typed.original,assertCurrent):plan.migration?transport.submitMigration(plan.request,assertCurrent):transport.submitTransfer(plan.request,assertCurrent));
              if(plan.migration){returned=true;await intentStore.savePQMigrationSubmissionResult(guard.account,hash,received);}
              return received;
            } catch (error) {transportFailed = true; transportCause = error; throw error;}
          });
          returned = true;
          // The journal captures the complete result before any late-lock,
          // current, completion, cleanup, or public-DTO check can reject it.
          if(!plan.migration)await intentStore.savePQSubmissionResult(guard.account, hash, plan.typed?{phase:'submission',response}:{phase:'submission',statusCode:response?.status,text:response?.text});
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
