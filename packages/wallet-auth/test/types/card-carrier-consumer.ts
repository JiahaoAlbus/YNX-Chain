import {type CardApplicationChallenge,type CardApplicationDetails,type CardProviderChallenge,type CardProviderDetails,createSignedCardApplicationApproval,createCardApplicationApprovalRequest,cardProviderRequestBindingHash,cardProviderDetailsHash} from '../../src/index.js';
declare const core:CardApplicationChallenge;declare const coreDetails:CardApplicationDetails;declare const provider:CardProviderChallenge;declare const providerDetails:CardProviderDetails;
const v1=createSignedCardApplicationApproval({accountSecret:'QA only',challenge:core,details:coreDetails});const oldVersion:'1'=v1.version;const originalLimit:string=v1.details.limitWei;
const v2=createSignedCardApplicationApproval({accountSecret:'QA only',challenge:provider,details:providerDetails});const version:'2'=v2.version;const binding:string=v2.challenge.requestBindingHash;
const pending=createCardApplicationApprovalRequest({}, {productId:'card',platform:'web',account:'',challenge:provider,details:providerDetails,requestId:'',state:''});const requestVersion:'2'=pending.version;cardProviderRequestBindingHash(pending);cardProviderDetailsHash(pending.details);
// @ts-expect-error Provider profile is explicit TEST only.
const live:CardProviderDetails={...providerDetails,environment:'LIVE'};
void oldVersion;void originalLimit;void version;void binding;void requestVersion;void live;
