import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { bindEnrollmentModule, FirstDeviceEnrollmentGate } from './firstDeviceEnrollment';
import { veilProductController } from './productController';
import {accountLoginGate} from './accountLogin';
import {localAuthenticationGate} from './localDeviceSetup';
export const firstDeviceEnrollmentGate = new FirstDeviceEnrollmentGate(async () =>
  Platform.OS === 'android' ? bindEnrollmentModule(requireOptionalNativeModule('YNXSocialCryptoEngine')) : null,
  // The normal root consumes this invalidation through readNativeProductSnapshot.
  // Enrollment observations never install an authorized view or enable sending.
  () => veilProductController.invalidate(),
  () => {
    const login = accountLoginGate.getSnapshot();
    if (login.pending || login.intent !== 'newIdentityFirstDevice' || login.status !== 'ACCOUNT_OBSERVED') return 'ORIGINAL_A_LOGIN_REQUIRED';
    const local = localAuthenticationGate.getSnapshot();
    return !local.pending && local.result?.status === 'LOCAL_KEYS_AUTHENTICATED' ? null : 'LOCAL_KEYS_REQUIRED';
  },
  () => ({login: accountLoginGate.getSnapshot(), local: localAuthenticationGate.getSnapshot()}));
