// INTERNAL DATA algorithm only. Not wired into a production Source getter.
// No Native method, provider, signer, target grant or network effect is created.
import {types} from 'node:util';
import {inspectOriginalIDECloudGETRequestDATA} from './original-ide-cloud-get-request.js';
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const reason=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'reason').get;
const fail=c=>{throw Object.assign(Error(c),{code:c});};
function record(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('IDE_READ_STATE_EXACT_DATA');const d=Object.getOwnPropertyDescriptors(v),k=Reflect.ownKeys(d);if(k.length!==keys.length||k.some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable))fail('IDE_READ_STATE_EXACT_DATA');return Object.fromEntries(keys.map(k=>[k,d[k].value]));}
function context(opts){const o=record(opts,['originalRequestContext']),c=o.originalRequestContext,s=record(c,['signal']);if(!Object.isFrozen(c)||types.isProxy(s.signal))fail('IDE_READ_STATE_CONTEXT');try{aborted.call(s.signal)}catch{fail('IDE_READ_STATE_CONTEXT')}return c;}
function outcome(v,field){const r=record(v,[field,'errorPresent','error']);if(typeof r[field]!=='boolean'||typeof r.errorPresent!=='boolean')fail('IDE_READ_STATE_OUTCOME');return r;}
const flags=Object.freeze({dataOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,receiverAccepted:false,dispatch:false});
/** Memory-only oracle for caller integration. Outcome DATA is not provenance:
 * production adapter must obtain true only from actual same-owner Go finish.
 * Passing a JS true to this helper cannot create a Native Source or grant. */
export function createIDEFiniteGETReadStateDATA(){
 const rows=new WeakMap();let last=null,retired=false,ordinal=0,sequenceSelection=null;
 const known=t=>{const r=rows.get(t);if(!r)fail('IDE_READ_STATE_ORIGINAL_TICKET_REQUIRED');return r};
 const same=(r,c)=>{if(c!==r.context)fail('IDE_READ_STATE_SAME_CONTEXT_REQUIRED')};
 const remember=(r,e)=>{if(!r.firstCausePresent){r.firstCausePresent=true;r.firstCause=e}r.unknown=true};
 const next=()=>!retired&&(!last||last.finishKnown&&last.joinComplete&&last.closeComplete&&!last.unknown&&!last.firstCausePresent);
 const live=(r,c)=>{same(r,c);if(retired||r.retired)fail('IDE_READ_STATE_RETIRED');if(aborted.call(r.context.signal)){const e=reason.call(r.context.signal);remember(r,e);throw e}};
 function status(t){const r=known(t);return Object.freeze({ordinal:r.ordinal,request:r.request,completionSelected:r.completionSelected,finishObserved:r.finishObserved,knownOutcomeDATA:r.finishKnown,unknown:r.unknown,retired:r.retired,joinComplete:r.joinComplete,closeComplete:r.closeComplete,cleanupDebt:!r.joinComplete||!r.closeComplete,firstCausePresent:r.firstCausePresent,firstCause:r.firstCause,canBeginNewReadDATA:next(),...flags})}
 return Object.freeze({
  beginReadDATA(request,expected,opts){if(!next())fail(retired?'IDE_READ_STATE_RETIRED':'IDE_READ_STATE_ORIGINAL_PENDING_NO_REPLAY');const c=context(opts);if(aborted.call(c.signal))throw reason.call(c.signal);const req=record(request,['method','path','url','operationRequestId']),exp=record(expected,['serviceOrigin','operationRequestId']);const captured=inspectOriginalIDECloudGETRequestDATA(req,exp).request;if(sequenceSelection&&(sequenceSelection.serviceOrigin!==exp.serviceOrigin||sequenceSelection.operationRequestId!==exp.operationRequestId))fail('IDE_READ_STATE_SELECTION_CHANGED');sequenceSelection??=Object.freeze(exp);const t=Object.freeze({}),r={ordinal:++ordinal,request:captured,context:c,completionSelected:false,finishObserved:false,finishKnown:false,unknown:false,retired:false,joinComplete:false,closeComplete:false,firstCausePresent:false,firstCause:undefined};rows.set(t,r);last=r;return t;},
  originalContextDATA(t){return known(t).context;},
  selectCompletionDATA(t,c){const r=known(t);same(r,c);if(r!==last||r.completionSelected)fail('IDE_READ_STATE_COMPLETION_ALREADY_SELECTED');r.completionSelected=true;return status(t);},
  observeGoFinishDATA(t,c,value){const r=known(t);same(r,c);if(!r.completionSelected)fail('IDE_READ_STATE_COMPLETION_NOT_SELECTED');const o=outcome(value,'knownComplete');r.finishObserved=true;if(o.errorPresent)remember(r,o.error);if(!o.knownComplete)r.unknown=true;r.finishKnown=o.knownComplete&&!o.errorPresent;return status(t);},
  observeChildJoinDATA(t,c,value){const r=known(t);same(r,c);const o=outcome(value,'physicalComplete');if(o.errorPresent)remember(r,o.error);if(o.physicalComplete)r.joinComplete=true;return status(t);},
  observeChildCloseDATA(t,c,value){const r=known(t);same(r,c);if(!r.joinComplete)fail('IDE_READ_STATE_JOIN_BEFORE_CLOSE');const o=outcome(value,'physicalComplete');if(o.errorPresent)remember(r,o.error);if(o.physicalComplete)r.closeComplete=true;return status(t);},
  retainUnknownDATA(t,c,cause){const r=known(t);same(r,c);remember(r,cause);return status(t);},
  retireReadDATA(t,c){const r=known(t);same(r,c);r.retired=true;return status(t);},
  retireSourceDATA(){retired=true;if(last)last.retired=true;return Object.freeze({retired:true,canBeginNewReadDATA:false,...flags});},
  statusDATA:status,
 });
}
