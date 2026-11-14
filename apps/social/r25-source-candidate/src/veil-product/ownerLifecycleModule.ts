import {Platform} from 'react-native';
import {requireOptionalNativeModule} from 'expo-modules-core';
import type {OwnerLifecycleModule} from './ownerLifecycle';
export function loadOwnerLifecycleModule(): OwnerLifecycleModule | null {
  if (Platform.OS !== 'android') return null;
  const module = requireOptionalNativeModule<OwnerLifecycleModule>('YNXSocialCryptoEngine');
  if (!module || typeof module.closeLocalOwner !== 'function' || typeof module.observeLocalOwnerLifecycle !== 'function') return null;
  return Object.freeze({closeLocalOwner: () => module.closeLocalOwner(), observeLocalOwnerLifecycle: () => module.observeLocalOwnerLifecycle()});
}
