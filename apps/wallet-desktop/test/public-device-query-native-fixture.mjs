// Explicit PUBLIC Source/Native model. No admission, OS key or private read.
import {canonicalJSON} from '@ynx-chain/wallet-auth';
import {readOriginalDeviceQuerySelectionDATA,recheckOriginalDeviceQuerySelection} from '../src/original-policy-supplier/device-query-selection.mjs';
let current;
export function configurePublicDeviceQuery(config){
 const events=[];let retired=false,childClosed=true;
 const child={assertCurrent(){if(retired)throw Error('PUBLIC retired');},async recheck(){events.push('recheck');await recheckOriginalDeviceQuerySelection(current.peer);await config.onRecheck?.();},readOriginalOutcomeDATA(){events.push('read');config.onRead?.();return config.outcome;},retire(){events.push('child-retire');},join(){events.push('child-join');},close(){events.push('child-close');if(config.closeError)throw config.closeError;childClosed=true;}};
 const source={assertCurrent(){if(retired)throw Error('PUBLIC retired');},readQueryScopeOriginalDATA(){return Buffer.from(canonicalJSON(config.scope));},captureOriginalQuerySelection(peer){events.push('capture');current.peer=peer;const data=readOriginalDeviceQuerySelectionDATA(peer);if(data.stableDeviceIdentity!==config.scope.stableDeviceIdentity)throw Error('PUBLIC binding');childClosed=false;return child;},retire(){events.push('source-retire');retired=true;},join(){if(!childClosed)throw Error('PUBLIC child first');events.push('source-join');},close(){events.push('source-close');}};
 current={config,events,source,child};return current;
}
export function acquireOriginalProductSessionDeviceV4QuerySourceStage(...args){if(args.length)throw Error('PUBLIC zero args');current.events.push('acquire');if(current.config.acquireError){Object.defineProperty(current.config.acquireError,'partial',{value:current.source});throw current.config.acquireError;}return current.source;}
