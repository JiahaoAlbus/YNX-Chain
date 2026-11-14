import React, {useSyncExternalStore} from 'react';
import {Pressable, Text, View} from 'react-native';
import {localRecoveryGate, type RecoveryStatus} from './localRecovery';
import {useProductTheme} from './useProductTheme';

const messages: Record<'en' | 'zh' | 'zh-Hant', Record<RecoveryStatus, string>> = {
  en: {
    NO_ORIGINAL_OPERATION: 'No original local setup operation is available to inspect. To begin setup, use the first-device setup entry. This check created no keys and granted no device access.',
    CIPHERTEXT_HELD_UNVERIFIED: 'Existing local ciphertext is held but unverified. Recovery is not complete; device authorization and chat access remain unavailable.',
    UNKNOWN_RETAINED: 'The outcome is unknown. The original operation is retained; no replacement or automatic retry.',
    REFUSED_RETAINED: 'The check was refused. The original operation remains retained.',
    RECOVERY_REQUIRED: 'The original operation needs further recovery. No device authorization was granted.',
    UNAVAILABLE: 'The retained local operation or required native interface is unavailable. No new operation was created.',
    OBSERVATION_PENDING: 'Still observing the same local check. Waiting does not cancel or retry it.',
  },
  zh: {
    NO_ORIGINAL_OPERATION: '当前没有可检查的原本机设置操作。首次设置请使用设备初始化入口。本次检查没有创建密钥或授予设备权限。',
    CIPHERTEXT_HELD_UNVERIFIED: '已有本机密文被保留，但尚未验证。恢复未完成，设备未获授权，聊天未解锁。',
    UNKNOWN_RETAINED: '结果未知，原操作继续保留；不会替换或自动重试。',
    REFUSED_RETAINED: '检查被拒绝，原操作仍被保留。',
    RECOVERY_REQUIRED: '原操作仍需恢复处理；没有授予设备权限。',
    UNAVAILABLE: '原本机操作或必要原生接口不可用，没有创建新操作。',
    OBSERVATION_PENDING: '仍在观察同一次本机检查。等待不会取消或重试它。',
  },

'zh-Hant': {
    NO_ORIGINAL_OPERATION: '當前沒有可檢查的原本機設定操作。首次設定請使用裝置初始化入口。本次檢查沒有創建金鑰或授予裝置權限。',
    CIPHERTEXT_HELD_UNVERIFIED: '已有本機密文被保留，但尚未驗證。恢復未完成，裝置未獲授權，聊天未解鎖。',
    UNKNOWN_RETAINED: '結果未知，原操作繼續保留；不會替換或自動重試。',
    REFUSED_RETAINED: '檢查被拒絕，原操作仍被保留。',
    RECOVERY_REQUIRED: '原操作仍需恢復處理；沒有授予裝置權限。',
    UNAVAILABLE: '原本機操作或必要原生接口不可用，沒有創建新操作。',
    OBSERVATION_PENDING: '仍在觀察同一次本機檢查。等待不會取消或重試它。',
  },
};
export function LocalRecoveryPanel({locale, disabled}: {locale: 'en' | 'zh' | 'zh-Hant'; disabled: boolean}) {
  const {styles, colors} = useProductTheme();
  const state = useSyncExternalStore(localRecoveryGate.subscribe, localRecoveryGate.getSnapshot, localRecoveryGate.getSnapshot);
  const terminal = state.result !== null && state.result.status !== 'OBSERVATION_PENDING';
  const blocked = disabled || state.pending || terminal;
  return <View style={styles.card}>
    <Text style={styles.strong}>{(locale === 'zh-Hant' ? '本機恢復檢查' : locale === 'zh' ? '本机恢复检查' : 'Local recovery check')}</Text>
    <Text style={styles.text}>{(locale === 'zh-Hant' ? '僅檢查原本機操作，不登入帳號、不批准裝置，也不會生成新金鑰。' : locale === 'zh' ? '仅检查原本机操作，不登录账号、不批准设备，也不会生成新密钥。' : 'Inspect only the original local operation. This does not sign in, approve a device, or generate new keys.')}</Text>
    <Pressable accessibilityRole="button" disabled={blocked} accessibilityState={{disabled: blocked}} style={[styles.button, blocked && styles.buttonDisabled]}
      onPress={() => { void localRecoveryGate.inspect(); }}>
      <Text style={[styles.buttonText, blocked && styles.buttonDisabledText]}>{(locale === 'zh-Hant' ? (state.started ? '觀察原檢查' : '檢查原本機操作') : locale === 'zh' ? (state.started ? '观察原检查' : '检查原本机操作') : (state.started ? 'Observe original check' : 'Check original local operation'))}</Text>
    </Pressable>
    {(state.pending || state.result) && <Text accessibilityLiveRegion="polite" style={styles.text}>{messages[locale][state.pending ? 'OBSERVATION_PENDING' : state.result!.status]}</Text>}
  </View>;
}
