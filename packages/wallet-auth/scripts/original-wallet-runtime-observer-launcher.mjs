import {originalWalletRuntimeObserverSelection} from './original-wallet-runtime-observer-native-selection.mjs';
import {createOriginalWalletServiceRuntimeObserver} from '../src/original-wallet-service-runtime-observer.js';
import {captureOriginalRecoveryJSON} from '../src/original-operation-recovery-state.js';
import {exactFields} from '../src/canonical.js';
// Called only from the original daemon's actual listen callback, retaining the
// same Host brand and exact intrinsic listener. Null is NOT_CONFIGURED, not ready.
export function openOriginalWalletRuntimeObserverAfterListen(hostSource,server){
 if(originalWalletRuntimeObserverSelection===null)return null;
 const selected=captureOriginalRecoveryJSON(originalWalletRuntimeObserverSelection);
 exactFields(selected,['instanceSource','roleBinding'],'Original daemon runtime selection');
 return createOriginalWalletServiceRuntimeObserver({hostSource,server,instanceSource:selected.instanceSource,roleBinding:selected.roleBinding,originalNow:()=>Date.now()});
}
