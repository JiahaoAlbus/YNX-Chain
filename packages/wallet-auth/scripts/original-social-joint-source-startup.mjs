// Fixed normal startup custody for the original Social Source. No caller can
// select a Source, factory, path, row, credential or approval.
import {acquireOriginalSocialJointSourceService,isOriginalSocialJointSourceService} from '../native/original-social-joint-profile-source-service-private.mjs';
const states=new WeakMap();
const fail=code=>{throw Object.assign(Error(code),{code})};
const state=ref=>{const s=states.get(ref);if(!s)fail('SOCIAL_SOURCE_STARTUP_ORIGINAL_REQUIRED');return s};
export async function openOriginalSocialJointSourceBeforeHost(){
 if(arguments.length)fail('SOCIAL_SOURCE_STARTUP_ZERO_INPUT');
 const ref=Object.freeze({}),s={owner:null,configured:false,firstPresent:false,first:undefined,closeSelected:false,closePromise:null,drainPromise:null,closed:false};states.set(ref,s);
 try{const outcome=await acquireOriginalSocialJointSourceService();s.owner=outcome?.owner??null;if(!s.owner||!isOriginalSocialJointSourceService(s.owner))fail('SOCIAL_SOURCE_STARTUP_OWNER_REQUIRED');if(outcome.errorPresent!==false){s.firstPresent=true;s.first=outcome.error;return ref;}s.configured=true;}
 catch(error){if(!s.firstPresent){s.firstPresent=true;s.first=error;}}
 return ref;
}
export function originalSocialJointSourceForHost(ref){const s=state(ref);return s.configured&&!s.closeSelected?s.owner:null;}
export function retireOriginalSocialJointSource(ref){const s=state(ref);if(s.owner)s.owner.retire();}
export function originalSocialJointSourceStartupStatus(ref){const s=state(ref);return Object.freeze({configured:s.configured,firstCausePresent:s.firstPresent,firstCause:s.first,closeSelected:s.closeSelected,closed:s.closed,RootAdmission:false,SourceAdmission:false});}
async function drain(s){
 if(!s.owner){s.closed=true;return;}
 try{s.owner.retire();await s.owner.join();await s.owner.close();}
 catch(error){if(!['SOCIAL_SOURCE_HELPER_ORIGINAL_QUERY_PENDING','SOCIAL_SOURCE_RESPONSE_PARENT_DEBT_PENDING'].includes(error?.code)&&!s.firstPresent){s.firstPresent=true;s.first=error;}throw error;}
 finally{s.closed=s.owner.isClosed()===true;}
}
function drainSameOriginal(s){
 if(s.drainPromise)return s.drainPromise;
 const p=Promise.resolve().then(()=>drain(s));s.drainPromise=p;p.then(()=>{if(s.drainPromise===p)s.drainPromise=null},()=>{if(s.drainPromise===p)s.drainPromise=null});return p;
}
export function closeOriginalSocialJointSourceAfterHost(ref){
 const s=state(ref);if(s.closeSelected)return s.closePromise;s.closeSelected=true;
 s.closePromise=(async()=>{try{await drainSameOriginal(s);}catch(error){throw s.firstPresent?s.first:error;}if(s.firstPresent)throw s.first;})();return s.closePromise;
}
export function drainOriginalSocialJointSourcePartial(ref){
 const s=state(ref);if(!s.closeSelected)fail('SOCIAL_SOURCE_STARTUP_CLOSE_NOT_SELECTED');if(s.drainPromise)return s.drainPromise;
 if(s.closed)return Promise.resolve();return drainSameOriginal(s);
}
