export type ApprovalContinuation={owner:string;applicationId:string;operationId:string;resultOperationId:string};
export type ApprovalJournal={version:2;owner:string;activeApplicationId:string;entries:Record<string,ApprovalContinuation>};
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
export function approvalJournalKey(owner:string){
  if(!identifier(owner))throw Error('CARD_APPROVAL_OWNER_INVALID');
  return 'ynx.card.provider-approval.v2.'+Array.from(new TextEncoder().encode(owner),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export function readApprovalJournal(raw:string|null,owner:string):ApprovalJournal{
  if(raw===null)return {version:2,owner,activeApplicationId:'',entries:{}};
  let value:ApprovalJournal;try{value=JSON.parse(raw)}catch{throw Error('CARD_APPROVAL_JOURNAL_INVALID')}
  if(!value||value.version!==2||value.owner!==owner||typeof value.activeApplicationId!=='string'||!value.entries||typeof value.entries!=='object'||Array.isArray(value.entries)||Object.keys(value.entries).length>100)throw Error('CARD_APPROVAL_JOURNAL_INVALID');
  for(const [key,entry] of Object.entries(value.entries))if(!identifier(key)||!entry||entry.owner!==owner||entry.applicationId!==key||!identifier(entry.operationId)||!identifier(entry.resultOperationId))throw Error('CARD_APPROVAL_JOURNAL_INVALID');
  if(value.activeApplicationId&&!Object.hasOwn(value.entries,value.activeApplicationId))throw Error('CARD_APPROVAL_JOURNAL_INVALID');
  return value;
}
export function rememberApproval(journal:ApprovalJournal,entry:ApprovalContinuation):ApprovalJournal{
  const next={...journal,activeApplicationId:entry.applicationId,entries:{...journal.entries,[entry.applicationId]:entry}};
  return readApprovalJournal(JSON.stringify(next),journal.owner);
}
export function savedApproval(journal:ApprovalJournal,applicationId=journal.activeApplicationId){return Object.hasOwn(journal.entries,applicationId)?journal.entries[applicationId]!:null}
