import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

// Normal optional Expo registration only. No retired Matrix module or fallback.
export type LocalOwnerModule = Readonly<{ readLocalOwnerState(): Promise<unknown> }>;
export function loadLocalOwnerModule(): LocalOwnerModule | null {
  if (Platform.OS !== 'android') return null;
  const module = requireOptionalNativeModule<LocalOwnerModule>('YNXSocialCryptoEngine');
  if (!module || typeof module.readLocalOwnerState !== 'function') return null;
  // Deliberately expose no closeLocalOwner or execute operation to the product.
  return Object.freeze({ readLocalOwnerState: () => module.readLocalOwnerState() });
}
