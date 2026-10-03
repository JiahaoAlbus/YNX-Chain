import {cardApplicationDetailsHash,type CardApplicationDetails} from '@ynx-chain/wallet-auth-card-provider-v2';
import type {CardApplicationView} from './cardBusinessClient';
import {coreCreationJournalKey,readCoreCreationJournal,type CoreCreationJournal,type CoreCreationIntent} from './providerApprovalJournal';
import type {ApprovalStorage} from './hostedCardApproval';
type Context={owner:string;contextKey:string};
export function createCoreCardCreationConsumer(options:{storage:ApprovalStorage;context:()=>Context|null;create:(details:CardApplicationDetails,key:string)=>Promise<CardApplicationView>;readBack:()=>Promise<unknown>;id:()=>string;now?:()=>Date}){
  const capture=()=>{const context=options.context();if(!context)throw Error('CARD_PRIVATE_SESSION_REQUIRED');return context};
  const valid=(context:Context)=>{const current=capture();if(current.owner!==context.owner||current.contextKey!==context.contextKey)throw Error('CARD_CREATION_CONTEXT_CHANGED')};
  const read=async(context:Context)=>{const journal=readCoreCreationJournal(await options.storage.getItem(coreCreationJournalKey(context.owner)),context.owner);valid(context);for(const entry of journal.entries)cardApplicationDetailsHash(entry.details);return journal};
  const save=async(journal:CoreCreationJournal,context:Context)=>{valid(context);const raw=JSON.stringify(journal);readCoreCreationJournal(raw,context.owner);await options.storage.setItem(coreCreationJournalKey(context.owner),raw);valid(context);if(await options.storage.getItem(coreCreationJournalKey(context.owner))!==raw)throw Error('CARD_CREATION_JOURNAL_NOT_SAVED');valid(context)};
  const execute=async(journal:CoreCreationJournal,entry:CoreCreationIntent,context:Context)=>{
    // Only invoked by a new explicit action or the separate exact-retry button.
    try{
      const application=await options.create(entry.details,entry.operationId);valid(context);
      if(application.owner!==context.owner||!application.id||cardApplicationDetailsHash(application.details as CardApplicationDetails)!==cardApplicationDetailsHash(entry.details))throw Error('CARD_CREATION_RECEIPT_INVALID');
      const confirmed:CoreCreationIntent={...entry,state:'confirmed',applicationId:application.id};
      const result={...journal,entries:journal.entries.map(item=>item.operationId===entry.operationId?confirmed:item)};
      await save(result,context);return {application,journal:result};
    }catch(error){valid(context);await save({...journal,entries:journal.entries.map(item=>item.operationId===entry.operationId?{...entry,state:'unknown' as const}:item)},context);throw error}
  };
  return Object.freeze({
    async recover(){return read(capture())}, // No network mutation or inference from similar records.
    async create(details:CardApplicationDetails){
      const context=capture(),journal=await read(context),active=journal.entries.find(entry=>entry.operationId===journal.activeOperationId);
      if(active&&active.state!=='confirmed')throw Error('CARD_CREATION_UNKNOWN_REVIEW_REQUIRED');
      cardApplicationDetailsHash(details);
      const entry:CoreCreationIntent={operationId:options.id(),owner:context.owner,originContextKey:context.contextKey,createdAt:(options.now?.()??new Date()).toISOString(),details:{...details},state:'prepared'};
      const pending={...journal,activeOperationId:entry.operationId,entries:[...journal.entries,entry]};
      await save(pending,context);return execute(pending,entry,context);
    },
    async retryExact(){
      const context=capture(),journal=await read(context),entry=journal.entries.find(item=>item.operationId===journal.activeOperationId);
      if(!entry||entry.state==='confirmed')throw Error('CARD_CREATION_RETRY_NOT_PENDING');
      await options.readBack();valid(context); // Current private proof, read only; no invented receipt.
      return execute(journal,entry,context); // Original immutable body and key, not edited form fields.
    },
    async startNewIntent(){const context=capture(),journal=await read(context);await options.readBack();valid(context);const result={...journal,activeOperationId:null};await save(result,context);return result}, // Keep every previous unknown request.
  });
}
