import {Platform} from 'react-native';
import {requireOptionalNativeModule} from 'expo-modules-core';
import type {OwnDirectoryModule} from './ownDirectory';
export function loadOwnDirectoryModule():OwnDirectoryModule|null{
 if(Platform.OS!=='android')return null;
 const module=requireOptionalNativeModule<OwnDirectoryModule>('YNXSocialCryptoEngine');
 return module&&typeof module.observeOwnDeviceDirectory==='function'?{observeOwnDeviceDirectory:action=>module.observeOwnDeviceDirectory(action)}:null;
}
