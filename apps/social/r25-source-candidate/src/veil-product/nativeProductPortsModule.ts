import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { ProductPortModule } from './nativeProductPorts';
export function loadProductPortModule():ProductPortModule|null {
  if(Platform.OS!=='android')return null;
  const value=requireOptionalNativeModule<ProductPortModule>('YNXSocialCryptoEngine');
  if(!value||typeof value.readNativeProductState!=='function'||typeof value.subscribeNativeProductInvalidation!=='function'||typeof value.unsubscribeNativeProductInvalidation!=='function')return null;
  const normal = typeof value.readNativeProductSnapshot === 'function' && typeof value.executeNativeProductCommand === 'function';
  return Object.freeze({
    readNativeProductState: () => value.readNativeProductState(),
    subscribeNativeProductInvalidation: () => value.subscribeNativeProductInvalidation(),
    unsubscribeNativeProductInvalidation: () => value.unsubscribeNativeProductInvalidation(),
    ...(normal ? {
      readNativeProductSnapshot: (context: string) => value.readNativeProductSnapshot!(context),
      executeNativeProductCommand: (command: string, context: string) => value.executeNativeProductCommand!(command, context),
    } : {}),
  });
}
