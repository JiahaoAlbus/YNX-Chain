import {Platform} from 'react-native';
import {requireOptionalNativeModule} from 'expo-modules-core';
import type {RecoveryModule} from './localRecovery';

export function loadLocalRecoveryModule(): RecoveryModule | null {
  if (Platform.OS !== 'android') return null;
  const module = requireOptionalNativeModule<RecoveryModule>('YNXSocialCryptoEngine');
  if (!module || typeof module.beginLocalRecoveryCheck !== 'function' || typeof module.observeLocalRecoveryCheck !== 'function') return null;
  return Object.freeze({beginLocalRecoveryCheck: () => module.beginLocalRecoveryCheck(), observeLocalRecoveryCheck: () => module.observeLocalRecoveryCheck()});
}
