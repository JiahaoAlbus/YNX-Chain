import type {OriginalAITaskV6LookupPortPrivate,OriginalAITaskV6OutcomePortPrivate} from '../src/original-ai-task-action-v6-client-private.js';
const child={retire(){},async join(){},async close(){},readOriginalOperationId(){return 'original'},readOriginalEvidence(){return new Uint8Array([1])}};
const lookup:OriginalAITaskV6LookupPortPrivate={async assertOriginalAITaskActionV6LookupCurrent(){},async lookupOriginalAITaskActionV6(){return {owner:child,errorPresent:false}}};
const sync:OriginalAITaskV6LookupPortPrivate={assertOriginalAITaskActionV6LookupCurrent(){},async lookupOriginalAITaskActionV6(){return {owner:child,errorPresent:true,error:false}}};
// @ts-expect-error naked owner is not the formal explicit acquisition outcome
const naked:OriginalAITaskV6LookupPortPrivate['lookupOriginalAITaskActionV6']=async()=>child;
// @ts-expect-error a boolean result is not void current acknowledgement
const bool:OriginalAITaskV6LookupPortPrivate['assertOriginalAITaskActionV6LookupCurrent']=async()=>true;
// @ts-expect-error missing explicit errorPresent is not successful acquisition
const missing:OriginalAITaskV6LookupPortPrivate['lookupOriginalAITaskActionV6']=async()=>({owner:child});
const outcomeCurrent:OriginalAITaskV6OutcomePortPrivate['assertOriginalAITaskActionV6OutcomeCurrent']=async()=>{};
void [lookup,sync,naked,bool,missing,outcomeCurrent];
