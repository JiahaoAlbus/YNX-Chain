// Closed normal package selection only; no runtime authority or native loading.
import {isDeepStrictEqual} from 'node:util';
import {desktopNative49C6Selected,desktopNative49C6Selection,verifyDesktopNative49C6ASAR,verifyDesktopNative49C6Runtime} from './desktop-native49-c6-pack.mjs';
import {DESKTOP_WALLET_CONTROL_MATCHED_METADATA_ROLE,desktopWalletControlMatchedSelected,desktopWalletControlMatchedSelection,verifyDesktopWalletControlMatchedASAR,verifyDesktopWalletControlMatchedRuntime} from './desktop-wallet-control-matched-pack.mjs';
const legacy=Object.freeze({selection:desktopNative49C6Selection,verifyASAR:verifyDesktopNative49C6ASAR,verifyRuntime:verifyDesktopNative49C6Runtime,matched:false});
const control=Object.freeze({selection:desktopWalletControlMatchedSelection,verifyASAR:verifyDesktopWalletControlMatchedASAR,verifyRuntime:verifyDesktopWalletControlMatchedRuntime,matched:true});
export function desktopPackageNativeComponent(metadata){
 if(metadata.ynxNativeComponent===DESKTOP_WALLET_CONTROL_MATCHED_METADATA_ROLE){if(!desktopWalletControlMatchedSelected(metadata))throw Error('CONTROL_PACKAGE_SELECTION_REQUIRED');return control;}
 return desktopNative49C6Selected(metadata)?legacy:null;
}
export function desktopPackageNativeOptions(metadata){const c=desktopPackageNativeComponent(metadata);return {native49C6:c!==null&&!c.matched,walletControlMatched:c?.matched===true};}
export function desktopPackageNativeIdentityComponent(selection){if(isDeepStrictEqual(selection,legacy.selection))return legacy;if(isDeepStrictEqual(selection,control.selection))return control;throw Error('SEPARATE_NATIVE_RUNTIME_SELECTION_DIFFERS');}
