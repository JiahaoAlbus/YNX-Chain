import {canonicalJSON,evmAddressFromYNX,parseProductSession} from "@ynx-chain/wallet-auth";
import {CANONICAL_RPC_URL} from "./rpc.mjs";
import {assertDesktopPaySession,prepareDesktopSignedPayTransfer} from "./wallet-pay-prepare.mjs";
import {parseDesktopPaySettlementResponse,desktopPayIdempotencyKey} from "./wallet-pay-settlement.mjs";
const fail=code=>{throw Object.assign(new Error(code),{code})};
const queues=new WeakMap();
function serialized(store,action){const result=(queues.get(store)??Promise.resolve()).then(action);queues.set(store,result.catch(()=>{}));return result}
/** Protected main-process factory. The existing app must deliberately compose
 * A's admitted policy, canonical live authority and authenticated settlement
 * transport. Renderer props/globals, public GET, parsed sessions, test fixtures
 * and caller-chosen endpoints never turn this feature on. No default adapter.
 * All signing remains inside the EXISTING lifecycle and encrypted vault.
 */
export function createProtectedDesktopPayFlow({store,lifecycle,vault,client,policy,authorityForReview,authorityForOriginal,settlementTransport,now=Date.now,assertCurrent=()=>{}}){
  if(!policy||typeof policy.resolve!=="function"||typeof lifecycle?.run!=="function"||typeof vault?.withSecret!=="function"||
    typeof store?.signedPayProgress!=="function"||client?.origin!==CANONICAL_RPC_URL||typeof client?.broadcast!=="function"||typeof client?.checkTransferDurability!=="function"||
    typeof authorityForReview!=="function"||typeof authorityForOriginal!=="function"||typeof settlementTransport?.submitOriginal!=="function"||typeof settlementTransport?.readOriginal!=="function")fail("PAY_PROTECTED_INTEGRATION_REQUIRED");
  const load=async(account,guard)=>{
    guard.assert();if(guard.account!==evmAddressFromYNX(account))fail("PAY_PROTECTED_IDENTITY_MISMATCH");
    const entry=await store.signedPayProgress(account,policy,guard.assert);guard.assert();if(!entry)fail("PAY_SIGNED_ORIGINAL_REQUIRED");return entry;
  };
  const originalAuthority=async(record,guard,{captured=false}={})=>{
    guard.assert();const authority=await authorityForOriginal(structuredClone(record));guard.assert();
    if(typeof authority?.assertCurrent!=="function"||typeof authority?.refresh!=="function"||typeof authority?.verifyOriginalBinding!=="function")fail("PAY_CURRENT_AUTHORITY_REQUIRED");
    const session=parseProductSession(authority.session),snapshot=canonicalJSON(session);
    // A fresh full same-account session may READ the old receipt. It must not
    // replace the captured original intent/session or authorize another submit.
    assertDesktopPaySession(session,captured?record.intent:{...record.intent,sessionBinding:session.sessionBinding,quoteIssuedAt:session.issuedAt,quoteExpiresAt:session.expiresAt},record.account);
    if(captured&&snapshot!==canonicalJSON(record.session))fail("PAY_CURRENT_SESSION_CHANGED");
    const current=()=>{guard.assertEffectCurrent();authority.assertCurrent();const at=now();
      if(canonicalJSON(parseProductSession(authority.session))!==snapshot)fail("PAY_CURRENT_SESSION_CHANGED");
      if(!Number.isFinite(at)||at<Date.parse(session.issuedAt)||at>=Date.parse(session.expiresAt))fail("PAY_CURRENT_AUTHORITY_EXPIRED")};
    current();const fresh=await authority.refresh();current();if(canonicalJSON(parseProductSession(fresh))!==snapshot)fail("PAY_CURRENT_SESSION_CHANGED");
    await authority.verifyOriginalBinding(structuredClone(record),current);current();return {authority,current,session};
  };
  const run=operation=>serialized(store,()=>lifecycle.run(operation,{assertCurrent}));
  return Object.freeze({
    async restore(account){return run(async guard=>{
      guard.assert();if(guard.account!==evmAddressFromYNX(account))fail("PAY_PROTECTED_IDENTITY_MISMATCH");
      const entry=await store.signedPayProgress(account,policy,guard.assert);guard.assert();
      return entry?Object.freeze({entry,state:entry.settlement?"settled":entry.settlementAttempted?"settlement_unknown":entry.evidence?"settlement_pending":"transfer_unconfirmed",currentAuthorityVerified:false,consensusFinality:false}):null;
    })},
    async approve(request){
      const captured=structuredClone({rawInvoice:request?.rawInvoice,rawIntent:request?.rawIntent,reviewedIntentDigest:request?.reviewedIntentDigest,review:request?.review});
      return run(async guard=>{
        guard.assert();const account=captured.review?.account;
        if(guard.account!==evmAddressFromYNX(account))fail("PAY_PROTECTED_IDENTITY_MISMATCH");
        if(await store.signedPayProgress(account,policy,guard.assert))fail("PAY_SIGNED_ORIGINAL_REQUIRES_REVIEW");
        if((await store.payHistory(account,policy,guard.assert)).some(entry=>entry.record.invoice.id===captured.rawInvoice?.id))fail("PAY_INVOICE_ALREADY_PAID");
        const authority=await authorityForReview(structuredClone(captured));guard.assert();
        const prepared=await prepareDesktopSignedPayTransfer({...captured,policy,authority,vault,client,guard,now});guard.assert();
        const record={version:2,account,origin:CANONICAL_RPC_URL,invoice:prepared.invoice,intent:prepared.intent,paymentResult:prepared.paymentResult,session:prepared.session,
          transfer:{payload:prepared.payload,hash:prepared.hash,transaction:prepared.transaction}};
        // Immutable original first, full readback, then durable attempt marker.
        // No late ACK, lost response or restart can reopen a signing/POST path.
        await store.retainSignedPayment(record,policy,guard.assert,{forBroadcast:true});guard.assert();
        const {current}=await originalAuthority(record,guard,{captured:true});
        if(now()>=Date.parse(record.intent.quoteExpiresAt))fail("PAY_CURRENT_AUTHORITY_EXPIRED");
        await authority.verifyInvoicePayable(record.invoice,record.intent);current();
        await store.claimSignedPayBroadcast(account,record.transfer.hash,policy,current);current();
        if(now()>=Date.parse(record.intent.quoteExpiresAt))fail("PAY_CURRENT_AUTHORITY_EXPIRED");
        // The lifecycle marks the outward effect before entering the adapter.
        // Admission ACK is NOT mined, settled or Done.
        const admission=await guard.submit(()=>{current();return client.broadcast(record.transfer.payload,record.transfer.transaction,record.transfer.hash)});
        current();return Object.freeze({record:structuredClone(record),admission,durabilityConfirmed:false,settlementVerified:false,consensusFinality:false});
      });
    },
    async checkOriginal(account){return run(async guard=>{
      const entry=await load(account,guard),{current}=await originalAuthority(entry.record,guard);
      const result=await client.checkTransferDurability(entry.record.transfer.transaction,entry.record.transfer.hash,current);current();
      if(result.status==="durable"){
        // Keep the first verified checkpoint fact; subsequent reads cannot
        // demote it or overwrite it with an unrelated later checkpoint.
        if(!entry.evidence)await store.saveSignedPayEvidence(account,entry.record.transfer.hash,result.evidence,policy,current);
      }
      current();return store.signedPayProgress(account,policy,current);
    })},
    async settleOriginal(account){return run(async guard=>{
      const entry=await load(account,guard);if(!entry.evidence)fail("PAY_ORIGINAL_DURABILITY_REQUIRED");
      if(entry.settlement)return entry;
      const {current,session}=await originalAuthority(entry.record,guard,{captured:true});
      await store.claimSignedPaySettlement(account,entry.record.transfer.hash,policy,current);current();
      const body={intent:entry.record.intent,result:entry.record.paymentResult,idempotencyKey:desktopPayIdempotencyKey(entry.record)};
      const response=await guard.deliver(()=>{current();return settlementTransport.submitOriginal({record:structuredClone(entry.record),session,body:structuredClone(body),guard:current})});
      // An authenticated late receipt remains a historical fact even if the
      // foreground lease was revoked during the outward effect. Never publish
      // an unlocked UI result or reinterpret it as fresh consent.
      const settlement=parseDesktopPaySettlementResponse(response,entry.record,entry.evidence,policy,()=>{});
      await store.saveSignedPaySettlement(account,entry.record.transfer.hash,settlement,policy,()=>{});
      current();return store.signedPayProgress(account,policy,current);
    })},
    async readOriginalReceipt(account){return run(async guard=>{
      const entry=await load(account,guard);if(!entry.evidence)fail("PAY_ORIGINAL_DURABILITY_REQUIRED");
      const {current,session}=await originalAuthority(entry.record,guard);
      const response=await settlementTransport.readOriginal({record:structuredClone(entry.record),session,idempotencyKey:desktopPayIdempotencyKey(entry.record),guard:current});
      const settlement=parseDesktopPaySettlementResponse(response,entry.record,entry.evidence,policy,()=>{});
      await store.saveSignedPaySettlement(account,entry.record.transfer.hash,settlement,policy,()=>{});current();
      return store.signedPayProgress(account,policy,current);
    })},
    async done(account,expectedHash){return run(async guard=>{
      guard.assert();if(guard.account!==evmAddressFromYNX(account))fail("PAY_PROTECTED_IDENTITY_MISMATCH");
      const entry=await store.signedPayProgress(account,policy,guard.assert);guard.assert();
      if(!entry){
        const prior=(await store.payHistory(account,policy,guard.assert)).find(value=>value.record.transfer.hash===expectedHash);
        if(!prior)fail("PAY_SIGNED_ORIGINAL_REQUIRED");await originalAuthority(prior.record,guard);return prior;
      }
      if(expectedHash!==undefined&&expectedHash!==entry.record.transfer.hash)fail("PAY_SIGNED_ORIGINAL_BINDING_MISMATCH");
      const {current}=await originalAuthority(entry.record,guard);
      if(!entry.evidence||!entry.settlement)fail("PAY_ORIGINAL_SETTLEMENT_REQUIRED");
      return store.archiveSignedPay(account,entry.record.transfer.hash,policy,current);
    })},
    async history(account){return run(async guard=>{guard.assert();if(guard.account!==evmAddressFromYNX(account))fail("PAY_PROTECTED_IDENTITY_MISMATCH");return store.payHistory(account,policy,guard.assert)})},
  });
}
