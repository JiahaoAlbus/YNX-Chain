import {Platform} from 'react-native';
import {requireOptionalNativeModule} from 'expo-modules-core';
import {bindChallengeModule, type ChallengeModule} from './firstDeviceChallengeBridge';
export function loadFirstDeviceChallengeModule(): ChallengeModule | null {
  return Platform.OS === 'android' ? bindChallengeModule(requireOptionalNativeModule<ChallengeModule>('YNXSocialCryptoEngine')) : null;
}
