import type { NativeJournalStore } from './native-action-journal';

/** Recheck the displayed review at the actual synchronous IDB write boundary. */
export function guardNativeReviewStore(store:NativeJournalStore,isCurrent:()=>boolean,asOf:string,deadlineUnix:unknown):NativeJournalStore {
  const check=()=>{
    if(!isCurrent())throw new Error('NATIVE_CONTEXT_CHANGED');
    const now=Date.now(),observed=Date.parse(asOf);
    if(!Number.isFinite(observed)||observed>now||now-observed>15_000||!Number.isSafeInteger(deadlineUnix)||Number(deadlineUnix)*1000<=now)throw new Error('NATIVE_REVIEW_EXPIRED');
  };
  return {update:(key,change)=>{check();return store.update(key,current=>{check();return change(current);});}};
}
