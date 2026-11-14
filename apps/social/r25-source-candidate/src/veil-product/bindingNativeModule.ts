import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { NativeBindingHttpModule } from './bindingNativeAdapter';
/** Exact FINAL-CALLER-CONTRACT. Main owns normal Expo registration. */
export function loadNativeBindingModule():NativeBindingHttpModule|null {
  if(Platform.OS!=='android')return null;
  const module=requireOptionalNativeModule<NativeBindingHttpModule>('YNXSocialAccountBindingHttp');
  if(!module||!['readBindingHttpEpoch','reserveBindingHttp','sendBindingHttp','cancelBindingHttp','advanceBindingHttpContext'].every(key=>typeof (module as unknown as Record<string,unknown>)[key]==='function'))return null;
  return module;
}
