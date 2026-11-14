import React, {useEffect, useRef, useSyncExternalStore} from 'react';
import {AppState, Pressable, Text, View} from 'react-native';
import {firstDeviceChallengeGate as gate, challengeCopy} from './firstDeviceChallenge';
import {accountLoginGate} from './accountLogin';
import {localAuthenticationGate} from './localDeviceSetup';
import {productCopy, type VeilLocale} from './copy';
import {useProductTheme} from './useProductTheme';
import {firstDeviceEnrollmentGate} from './firstDeviceEnrollmentModule';
import {PeerDeviceRegistrationController} from './peerDeviceRegistration';

// The normal root already mounts this panel. Keep one physical operation across
// renders/remounts and use only the existing Native challenge/enrollment gates.
const registration = new PeerDeviceRegistrationController(gate, firstDeviceEnrollmentGate);

export function FirstDeviceChallengePanel({locale, disabled}: {locale: VeilLocale; disabled: boolean}) {
  const {styles} = useProductTheme();
  const state = useSyncExternalStore(registration.subscribe, registration.getSnapshot, registration.getSnapshot);
  const login = useSyncExternalStore(accountLoginGate.subscribe, accountLoginGate.getSnapshot, accountLoginGate.getSnapshot);
  const keys = useSyncExternalStore(localAuthenticationGate.subscribe, localAuthenticationGate.getSnapshot, localAuthenticationGate.getSnapshot);
  const t = (key: Parameters<typeof productCopy>[1]) => productCopy(locale, key);
  const live = useRef({mounted: false, disabled});
  live.current.disabled = disabled;
  useEffect(() => {
    live.current.mounted = true;
    const observe = () => { if (AppState.currentState === 'active' && !registration.getSnapshot().pending) void registration.observeOriginal(); };
    observe(); // mounting or prerequisite changes NEVER Issue/cancel
    const subscription = AppState.addEventListener('change', value => { if (value === 'active') observe(); });
    const timer = setInterval(() => {
      observe();
    }, 5000);
    return () => { live.current.mounted = false; clearInterval(timer); subscription.remove(); }; // retain original gates/call
  }, [login.status, keys.result?.status]);
  const offered = state.action;
  const usable = () => live.current.mounted && !live.current.disabled && AppState.currentState === 'active';
  return <View style={styles.card}>
    <Text style={styles.strong}>{t('registrationTitle')}</Text>
    <Text style={styles.text}>{t('registrationDetail')}</Text>
    <View style={styles.wrapRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('registrationContinue')} disabled={disabled || offered === null} accessibilityState={{disabled: disabled || offered === null}} style={[styles.button, (disabled || offered === null) && styles.buttonDisabled]} onPress={() => { if (usable() && offered !== null && registration.getSnapshot().action === offered) void registration.registerPeerDevice(offered); }}><Text style={styles.buttonText}>{t('registrationContinue')}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('registrationObserve')} disabled={state.pending} accessibilityState={{disabled: state.pending}} style={[styles.button, state.pending && styles.buttonDisabled]} onPress={() => { if (live.current.mounted && AppState.currentState === 'active') void registration.observeOriginal(); }}><Text style={styles.buttonText}>{t('registrationObserve')}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('registrationCancel')} disabled={disabled || !state.canCancel} accessibilityState={{disabled: disabled || !state.canCancel}} style={[styles.button, (disabled || !state.canCancel) && styles.buttonDisabled]} onPress={() => { if (usable() && registration.getSnapshot().canCancel) void registration.cancelOriginal(); }}><Text style={styles.buttonText}>{t('registrationCancel')}</Text></Pressable>
    </View>
    <Text accessibilityLiveRegion="polite" style={styles.text}>{t(state.pending ? 'registrationPending' : state.status ? challengeCopy[state.status] : 'registrationReady')}</Text>
    {state.cancelUnconfirmed && <Text style={styles.caption}>{t('registrationCancelUnconfirmed')}</Text>}
</View>;
}
