import {Platform} from 'react-native';
import {requireOptionalNativeModule} from 'expo-modules-core';
import type {AccountLoginModule} from './accountLogin';

export function loadAccountLoginModule(): AccountLoginModule | null {
  if (Platform.OS !== 'android') return null;
  const module = requireOptionalNativeModule<AccountLoginModule>('YNXSocialCryptoEngine');
  if (!module || typeof module.beginAccountLogin !== 'function' || typeof module.observeAccountLogin !== 'function' || typeof module.cancelAccountLogin !== 'function') return null;
  return Object.freeze({
    beginAccountLogin: (intent: 'A' | 'B' | 'C' | 'D') => module.beginAccountLogin(intent),
    observeAccountLogin: () => module.observeAccountLogin(),
    cancelAccountLogin: () => module.cancelAccountLogin(),
    ...(typeof module.readAccountLoginOriginal === 'function' ? {readAccountLoginOriginal: () => module.readAccountLoginOriginal!()} : {}),
    ...(typeof module.readAccountLoginFailureDiagnostic === 'function' ? {readAccountLoginFailureDiagnostic: () => module.readAccountLoginFailureDiagnostic!()} : {}),
    ...(typeof module.readAccountLoginDiagnostic === 'function' ? {readAccountLoginDiagnostic: () => module.readAccountLoginDiagnostic!()} : {}),
  });
}
