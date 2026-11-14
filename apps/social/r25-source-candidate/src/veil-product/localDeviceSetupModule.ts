import {Platform} from 'react-native';
import {requireOptionalNativeModule} from 'expo-modules-core';
import type {LocalDeviceSetupModule, LocalAuthenticationModule} from './localDeviceSetup';

export function loadLocalDeviceSetupModule():LocalDeviceSetupModule|null {
  if(Platform.OS!=='android') return null;
  const module=requireOptionalNativeModule<LocalDeviceSetupModule>('YNXSocialCryptoEngine');
  if(!module||typeof module.initializeLocalDevice!=='function') return null;
  return Object.freeze({initializeLocalDevice:(locale:'en'|'zh')=>module.initializeLocalDevice(locale)});
}

export function loadLocalAuthenticationModule(): LocalAuthenticationModule | null {
  if (Platform.OS !== 'android') return null;
  const module = requireOptionalNativeModule<LocalAuthenticationModule>('YNXSocialCryptoEngine');
  if (!module || typeof module.readLocalDeviceAuthenticationEligibility !== 'function' || typeof module.continueLocalDevice !== 'function' || typeof module.observeLocalDeviceAuthentication !== 'function') return null;
  return Object.freeze({readLocalDeviceAuthenticationEligibility: () => module.readLocalDeviceAuthenticationEligibility(),
    continueLocalDevice: (locale: 'en' | 'zh') => module.continueLocalDevice(locale),
    observeLocalDeviceAuthentication: () => module.observeLocalDeviceAuthentication()});
}
