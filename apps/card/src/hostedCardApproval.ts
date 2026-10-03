import {
  encodeCardApplicationApprovalWalletURL,parseCardApplicationApprovalWalletURL,
  type CardApplicationApprovalRequest,type CardApplicationApprovalResult,
} from '@ynx-chain/wallet-auth-card-provider-v2';
import {hostedApprovalJournalKey,readHostedApprovalJournal,type HostedApprovalJournalEntry} from './providerApprovalJournal';
import {verifyPendingCardApplicationCallback} from './providerCallback';

export type HostedCardApprovalReservation=Readonly<{
  account:string;assertCurrent():void;request(url:string):Promise<unknown>;
}>;
export type HostedCardApprovalTransport=Readonly<{
  reserveCardApplicationApproval():Promise<HostedCardApprovalReservation>;
}>;
export type ApprovalStorage={getItem(key:string):Promise<string|null>;setItem(key:string,value:string):Promise<void>};
type Context={owner:string;contextKey:string};
type Options={registry:unknown;storage:ApprovalStorage;context:()=>Context|null;now?:()=>Date};
function fail(code:string):never{throw Error(code)}
const recordBinding=(input:unknown,applicationId:string)=>{
  if(!input||typeof input!=='object')return fail('CARD_APPROVAL_RECORD_INVALID');
  const record=input as Record<string,unknown>;
  if(record.id!==applicationId)return fail('CARD_APPROVAL_RECORD_INVALID');
  // Ignore progress/status fields, not the exact application or funding terms.
  return JSON.stringify(['id','owner','details','challenge','productCardId','provider','programId','environment','nickname','testSpendingLimitMinor','cardAccountCurrency','minorUnitDigits','fundingSourceId'].map(key=>[key,record[key]??null]));
};
export function createHostedCardApprovalConsumer(options:Options){
  const now=()=>options.now?.()??new Date();
  const capture=()=>options.context()??fail('CARD_PRIVATE_SESSION_REQUIRED');
  const assertContext=(expected:Context)=>{const actual=capture();if(actual.owner!==expected.owner||actual.contextKey!==expected.contextKey)fail('CARD_APPROVAL_CONTEXT_CHANGED')};
  const read=async(context:Context,id:string,historical=false)=>{
    const entry=readHostedApprovalJournal(await options.storage.getItem(hostedApprovalJournalKey(context.owner,id)),context.owner,id);
    assertContext(context);if(entry&&entry.contextKey!==context.contextKey&&!historical)fail('CARD_APPROVAL_CONTEXT_CHANGED');return entry;
  };
  const save=async(entry:HostedApprovalJournalEntry,context:Context)=>{
    assertContext(context);const key=hostedApprovalJournalKey(context.owner,entry.applicationId),raw=JSON.stringify(entry);
    readHostedApprovalJournal(raw,context.owner,entry.applicationId);
    await options.storage.setItem(key,raw);assertContext(context);
    if(await options.storage.getItem(key)!==raw)fail('CARD_APPROVAL_JOURNAL_NOT_SAVED');assertContext(context);
  };
  const verify=(entry:HostedApprovalJournalEntry)=>{
    const pending=parseCardApplicationApprovalWalletURL(options.registry,entry.walletURL,now());
    if(JSON.stringify(pending)!==JSON.stringify(entry.request)||pending.account!==entry.owner||pending.challenge.applicationId!==entry.applicationId||pending.challenge.owner!==entry.owner)fail('CARD_APPLICATION_APPROVAL_REQUEST_INVALID');
    return verifyPendingCardApplicationCallback(options.registry,entry.returnURL??'',pending,now());
  };
  return Object.freeze({
    async review(input:{applicationId:string;transport:HostedCardApprovalTransport|null;readRecord():Promise<unknown>;prepare():Promise<CardApplicationApprovalRequest>;operationId:string;resultOperationId:string}):Promise<{entry:HostedApprovalJournalEntry;result:CardApplicationApprovalResult}>{
      const context=capture();if(!input.transport)fail('CARD_WEB_APPLICATION_APPROVAL_TRANSPORT_UNAVAILABLE');
      // Invoke reserve synchronously before any journal or backend await.
      const reserved=input.transport.reserveCardApplicationApproval();
      const reservation=await reserved;assertContext(context);reservation.assertCurrent();
      const old=await read(context,input.applicationId,true);
      if(old?.contextKey===context.contextKey&&old.state==='pending'&&Date.parse(old.request.expiresAt)>now().getTime())fail('CARD_APPROVAL_ALREADY_PENDING');
      if(old){
        // Explicit fresh review archives, rather than erases, the old context.
        // History is never read as current authority or replayed to Wallet.
        if(typeof old.request.requestId!=='string'||old.request.requestId.length>160)fail('CARD_APPROVAL_JOURNAL_INVALID');
        const historyKey=hostedApprovalJournalKey(context.owner,input.applicationId)+'.history.'+encodeURIComponent(old.request.requestId),raw=JSON.stringify(old);
        await options.storage.setItem(historyKey,raw);assertContext(context);
        if(await options.storage.getItem(historyKey)!==raw)fail('CARD_APPROVAL_JOURNAL_NOT_SAVED');assertContext(context);
      }
      const record=await input.readRecord();assertContext(context);reservation.assertCurrent();
      const binding=recordBinding(record,input.applicationId);
      const request=await input.prepare();assertContext(context);reservation.assertCurrent();
      if(request.platform!=='web'||request.account!==context.owner||request.challenge.owner!==context.owner||request.challenge.applicationId!==input.applicationId)fail('CARD_APPLICATION_APPROVAL_REQUEST_INVALID');
      const walletURL=encodeCardApplicationApprovalWalletURL(options.registry,request,now());
      const entry:HostedApprovalJournalEntry={schemaVersion:1,...context,applicationId:input.applicationId,operationId:request.version==='2'?request.details.idempotencyKey:input.operationId,resultOperationId:input.resultOperationId,recordBinding:binding,request,walletURL,transportAccount:reservation.account,state:'pending'};
      await save(entry,context);reservation.assertCurrent();
      try{
        const returned=await reservation.request(walletURL);assertContext(context);reservation.assertCurrent();
        if(!returned||typeof returned!=='object')fail('CARD_APPLICATION_APPROVAL_RETURN_INVALID');
        const carrier=returned as Record<string,unknown>;
        if(carrier.kind!=='card-application-approval'||carrier.version!==request.version||typeof carrier.returnUrl!=='string')fail('CARD_APPLICATION_APPROVAL_RETURN_INVALID');
        const result=verifyPendingCardApplicationCallback(options.registry,carrier.returnUrl as string,request,now());
        const terminal:HostedApprovalJournalEntry={...entry,state:result.status,returnURL:carrier.returnUrl as string};
        // Durable terminal correlation precedes any backend result acceptance.
        await save(terminal,context);
        const current=await input.readRecord();assertContext(context);
        if(recordBinding(current,input.applicationId)!==binding)fail('CARD_APPROVAL_RECORD_CHANGED');
        return {entry:terminal,result};
      }catch(error){
        // Never overwrite a verified terminal result after a backend read failed.
        const saved=await read(context,input.applicationId);
        if(saved?.state==='pending')await save({...entry,state:'failed',failure:error instanceof Error?error.message:'CARD_APPROVAL_UNKNOWN'},context);
        throw error;
      }
    },
    async recover(applicationId:string,readRecord?:()=>Promise<unknown>){
      const context=capture(),entry=await read(context,applicationId);
      if(!entry)return null;
      if(entry.state==='pending'||entry.state==='failed')return {entry,result:null};
      if(readRecord){const record=await readRecord();assertContext(context);if(recordBinding(record,applicationId)!==entry.recordBinding)fail('CARD_APPROVAL_RECORD_CHANGED')}
      return {entry,result:verify(entry)}; // No launch, signature, or automatic submit.
    },
    async acceptCallback(applicationId:string,returnURL:string){
      const context=capture(),entry=await read(context,applicationId);
      if(!entry||entry.state==='failed')fail('CARD_APPROVAL_PENDING_REQUIRED');
      const result=verify({...entry,returnURL});
      const terminal={...entry,state:result.status,returnURL};await save(terminal,context);return {entry:terminal,result};
    },
    async beforeSubmit(applicationId:string,readRecord:()=>Promise<unknown>){
      const context=capture(),entry=await read(context,applicationId);
      if(!entry||entry.state!=='approved')fail('CARD_APPROVAL_REQUIRED');
      const result=verify(entry);if(result.status!=='approved')fail('CARD_APPROVAL_REQUIRED');
      const record=await readRecord();assertContext(context);
      if(recordBinding(record,applicationId)!==entry.recordBinding)fail('CARD_APPROVAL_RECORD_CHANGED');
      if((record as Record<string,unknown>).status!=='APPROVAL_REQUIRED')fail('CARD_APPROVAL_STATE_CHANGED');
      return {entry,approval:result.approval};
    },
  });
}
