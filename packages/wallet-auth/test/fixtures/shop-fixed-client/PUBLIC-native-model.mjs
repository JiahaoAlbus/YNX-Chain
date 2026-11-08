// PUBLIC Node MODEL only: no Native, Root, Source, session or service qualification.
export const control={loads:0,acquires:0,recognizes:0,gets:0,releases:0,joins:0,closes:0,retires:0,events:[],first:null,body:new TextEncoder().encode('{"transportOnly":true}'),status:200,method:'GET',path:null,contentType:'application/json',acquireError:null,readError:null,releaseError:null,releaseMode:'done',releasePendingCount:0,clientDone:false,responseDone:false,responseSelected:false,responseUnknown:false,clientSelected:false,clientUnknown:false,deferred:false,resolveRead:null,onCurrent:null,onRelease:null,identity:true,missingCustody:false};
const te=new TextEncoder();
function cause(v){return v&&Object.hasOwn(v,'error')?v.error:undefined;}
export const rawResponse={
 readOriginalTransportDATA(){control.events.push('copy');if(control.transportOverride)return control.transportOverride;return Object.freeze({status:control.status,methodOriginal:te.encode(control.method),pathOriginal:te.encode(control.path??'/v5/shop/source/shop.order/invoice-intents/ord_123'),contentTypeOriginal:te.encode(control.contentType),bodyOriginal:control.body});},
 release(){control.releases++;control.events.push('release');control.onRelease?.();if(control.releasePendingCount-->0){control.responseSelected=false;return Promise.reject(Object.assign(Error('PUBLIC_PENDING'),{code:'PUBLIC_PENDING'}));}control.responseSelected=true;if(control.releaseMode==='unknown'){control.responseUnknown=true;return Promise.reject(cause(control.releaseError));}control.responseDone=true;control.responseUnknown=false;return control.releaseError?Promise.reject(cause(control.releaseError)):Promise.resolve();},
 readOriginalCustodyDATA(){return Object.freeze({selected:control.responseSelected,unknown:control.responseUnknown,physicalDone:control.responseDone});}
};
export const rawClient={
 current(){control.events.push('current');control.onCurrent?.();},
 readOriginalScopeDATA(){return te.encode('{"untrustedScope":true}');},
 readOriginalShopInvoiceTransport(order,current){control.gets++;control.order=order;control.guard=current;control.events.push('get');const finish=()=>control.readPacketOverride??({owner:rawResponse,errorPresent:!!control.readError,...(control.readError?{error:cause(control.readError)}:{})});return control.deferred?new Promise(resolve=>{control.resolveRead=()=>resolve(finish());}):Promise.resolve(finish());},
 retire(){control.retires++;control.events.push('retire');},
 join(){control.joins++;control.events.push('join');return control.first?Promise.reject(cause(control.first)):Promise.resolve();},
 close(){control.closes++;control.events.push('close');control.clientSelected=true;if(control.clientPendingCount-->0){control.clientDone=false;return Promise.reject(Object.assign(Error('PUBLIC_PARENT_PENDING'),{code:'PUBLIC_PARENT_PENDING'}));}control.clientDone=true;return control.first?Promise.reject(cause(control.first)):Promise.resolve();},
 readOriginalCustodyDATA(){return Object.freeze({selected:control.clientSelected,unknown:control.clientUnknown,physicalDone:control.clientDone});}
};
export const image={
 acquireOriginalShopPrivateClient(){control.acquires++;if(control.missingCustody)delete rawClient.readOriginalCustodyDATA;return{owner:rawClient,errorPresent:!!control.acquireError,...(control.acquireError?{error:cause(control.acquireError)}:{})};},
 isOriginalShopPrivateClient(value){control.recognizes++;if(control.identityThrow)throw cause(control.identityThrow);return value===rawClient?control.identity:false;}
};
export function loadOriginalAuthIdentityNativeImage(){control.loads++;return image;}
