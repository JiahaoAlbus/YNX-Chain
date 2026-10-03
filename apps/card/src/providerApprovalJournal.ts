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
// Hosted RPC continuations live in the original journal namespace, separately
// from native launch hints. No token, private key, or locally minted approval.
export type HostedApprovalJournalEntry={
  schemaVersion:1;owner:string;contextKey:string;applicationId:string;
  operationId:string;resultOperationId:string;recordBinding:string;
  request:import('@ynx-chain/wallet-auth-card-provider-v2').CardApplicationApprovalRequest;
  walletURL:string;transportAccount:string;
  state:'pending'|'approved'|'rejected'|'failed';returnURL?:string;failure?:string;
};
export const hostedApprovalJournalKey=(owner:string,applicationId:string)=>
  'ynx.card.provider-approval.v2.'+Array.from(new TextEncoder().encode(owner),byte=>byte.toString(16).padStart(2,'0')).join('')+'.hosted.'+encodeURIComponent(applicationId);
export function readHostedApprovalJournal(raw:string|null,owner:string,applicationId:string):HostedApprovalJournalEntry|null{
  if(raw===null)return null;
  if(raw.length>100000)throw Error('CARD_APPROVAL_JOURNAL_INVALID');
  const value=JSON.parse(raw) as HostedApprovalJournalEntry;
  if(!value||value.schemaVersion!==1||value.owner!==owner||value.applicationId!==applicationId||typeof value.contextKey!=='string'||!value.contextKey||typeof value.operationId!=='string'||!value.operationId||typeof value.resultOperationId!=='string'||!value.resultOperationId||typeof value.recordBinding!=='string'||typeof value.transportAccount!=='string'||!value.transportAccount||typeof value.walletURL!=='string'||value.walletURL.length>24000||!value.request||!['pending','approved','rejected','failed'].includes(value.state)||((value.state==='approved'||value.state==='rejected')&&typeof value.returnURL!=='string')||(value.returnURL!==undefined&&(typeof value.returnURL!=='string'||value.returnURL.length>24576)))throw Error('CARD_APPROVAL_JOURNAL_INVALID');
  return value;
}
export type CoreCreationIntent={operationId:string;owner:string;originContextKey:string;createdAt:string;details:import('@ynx-chain/wallet-auth-card-provider-v2').CardApplicationDetails;state:'prepared'|'unknown'|'confirmed';applicationId?:string};
export type CoreCreationJournal={schemaVersion:1;owner:string;activeOperationId:string|null;entries:CoreCreationIntent[]};
export const coreCreationJournalKey=(owner:string)=>'ynx.card.provider-approval.v2.'+Array.from(new TextEncoder().encode(owner),byte=>byte.toString(16).padStart(2,'0')).join('')+'.core-create';
export function readCoreCreationJournal(raw:string|null,owner:string):CoreCreationJournal{
  if(raw===null)return {schemaVersion:1,owner,activeOperationId:null,entries:[]};
  if(raw.length>100000)throw Error('CARD_CREATION_JOURNAL_INVALID');
  const value=JSON.parse(raw) as CoreCreationJournal;
  if(!value||value.schemaVersion!==1||value.owner!==owner||!Array.isArray(value.entries)||value.entries.length>100||(value.activeOperationId!==null&&typeof value.activeOperationId!=='string'))throw Error('CARD_CREATION_JOURNAL_INVALID');
  const ids=new Set<string>();
  for(const entry of value.entries){if(!entry||entry.owner!==owner||typeof entry.operationId!=='string'||!entry.operationId||ids.has(entry.operationId)||typeof entry.originContextKey!=='string'||!entry.originContextKey||!Number.isFinite(Date.parse(entry.createdAt))||!['prepared','unknown','confirmed'].includes(entry.state)||!entry.details||(entry.state==='confirmed'&&(typeof entry.applicationId!=='string'||!entry.applicationId)))throw Error('CARD_CREATION_JOURNAL_INVALID');ids.add(entry.operationId)}
  if(value.activeOperationId!==null&&!ids.has(value.activeOperationId))throw Error('CARD_CREATION_JOURNAL_INVALID');
  return value;
}
