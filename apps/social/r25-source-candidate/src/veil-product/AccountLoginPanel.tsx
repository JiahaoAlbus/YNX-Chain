import React, {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {AppState, Pressable, Text, View} from 'react-native';
import type {AccountEntryCase} from './accountEntry';
import {accountLoginGate} from './accountLogin';
import {productCopy, type VeilLocale} from './copy';
import {useProductTheme} from './useProductTheme';

const copy = {
  en: {
    begin: 'Sign in', create: 'Create account', observe: 'Check sign-in', cancel: 'Cancel sign-in', resume: 'Continue sign-in',
    checkSaved: 'Check saved sign-in', checkingSaved: 'Checking for a sign-in you can continue…',
    savedUnavailable: 'The saved sign-in could not be checked. Check again before starting another sign-in.',
    ready: 'Choose an account option to sign in.',
    original: 'Original sign-in', retained: 'This flow stays with its original case, including after cancellation or a return here. Switching requires a separate supported recovery flow.',
    UNAVAILABLE: 'Secure sign-in is not available in this build.',
    VERIFIED_CALLBACK_REQUIRED: 'The secure return link is not ready for this installation. Sign-in has not started.',
    AUTHORIZATION_OPENED: 'Continue in the secure browser, then return here.',
    AWAIT_CALLBACK: 'Waiting for your browser sign-in. No device access has been granted.',
    REVIEW_REQUIRED: 'The original sign-in needs review. It has not been replaced or retried.',
    ACCOUNT_OBSERVED: 'Your account was identified. Device approval is still required before messaging.',
    CANCELLED: 'Sign-in was cancelled locally. This does not confirm remote session revocation.',
    REFUSED: 'Sign-in could not continue. No device access has been granted.',
    BUSY: 'The original sign-in operation is still running.',
    OBSERVATION_PENDING: 'Still waiting for the original sign-in operation. It has not been restarted.',
    CLOSED: 'This sign-in attempt is closed. No device access has been granted.',
  },
  zh: {
    begin: '登录', create: '创建账号', observe: '查看登录进度', cancel: '取消登录', resume: '继续原登录',
    checkSaved: '检查登录记录', checkingSaved: '正在检查是否有可继续的登录…',
    savedUnavailable: '暂时无法检查原登录记录。请先重新检查，再继续登录。',
    ready: '请选择账户入口继续登录。',
    original: '原登录流程', retained: '此流程始终归属原入口，取消或返回此页面也不会切换。更换入口需另有受支持的恢复流程。',
    UNAVAILABLE: '当前构建的安全登录暂不可用。',
    VERIFIED_CALLBACK_REQUIRED: '此安装版本的安全返回链接尚未就绪，尚未发起登录。',
    AUTHORIZATION_OPENED: '请在安全浏览器中继续登录，然后返回这里。',
    AWAIT_CALLBACK: '正在等待浏览器登录结果，尚未授予设备访问权限。',
    REVIEW_REQUIRED: '原登录操作需要检查，未替换或重试。',
    ACCOUNT_OBSERVED: '已识别你的账户，聊天前仍需完成设备批准。',
    CANCELLED: '已在本地取消登录，这不代表远端会话已撤销。',
    REFUSED: '登录暂不能继续，未授予设备访问权限。',
    BUSY: '原登录操作仍在进行。',
    OBSERVATION_PENDING: '仍在等待原登录操作，未重新发起。',
    CLOSED: '此次登录已关闭，未授予设备访问权限。',
  },

'zh-Hant': {
    begin: '登入', create: '建立帳號', observe: '查看登入進度', cancel: '取消登入', resume: '繼續原登入',
    checkSaved: '檢查登入記錄', checkingSaved: '正在檢查是否有可繼續的登入…',
    savedUnavailable: '暫時無法檢查原登入記錄。請先重新檢查，再繼續登入。',
    ready: '請選擇帳戶入口繼續登入。',
    original: '原登入流程', retained: '此流程始終歸屬原入口，取消或返回此頁面也不會切換。更換入口需另有受支持的恢復流程。',
    UNAVAILABLE: '當前構建的安全登入暫不可用。',
    VERIFIED_CALLBACK_REQUIRED: '此安裝版本的安全返回連結尚未就緒，尚未發起登入。',
    AUTHORIZATION_OPENED: '請在安全瀏覽器中繼續登入，然後返回這裡。',
    AWAIT_CALLBACK: '正在等待瀏覽器登入結果，尚未授予裝置訪問權限。',
    REVIEW_REQUIRED: '原登入操作需要檢查，未替換或重試。',
    ACCOUNT_OBSERVED: '已識別你的帳戶，聊天前仍需完成裝置批准。',
    CANCELLED: '已在本地取消登入，這不代表遠端會話已撤銷。',
    REFUSED: '登入暫不能繼續，未授予裝置訪問權限。',
    BUSY: '原登入操作仍在進行。',
    OBSERVATION_PENDING: '仍在等待原登入操作，未重新發起。',
    CLOSED: '此次登入已關閉，未授予裝置訪問權限。',
  },
} as const;

export function AccountLoginPanel({intent, locale, disabled, controlsVisible = true}: {intent: AccountEntryCase; locale: VeilLocale; disabled: boolean; controlsVisible?: boolean}) {
  const {styles, colors} = useProductTheme();
  const [details, setDetails] = useState(false);
  const mounted = useRef(false);
  const presentation = useRef({disabled: disabled || !controlsVisible, intent});
  presentation.current = {disabled: disabled || !controlsVisible, intent};
  const attempt = useSyncExternalStore(accountLoginGate.subscribe, accountLoginGate.getSnapshot, accountLoginGate.getSnapshot);
  const run = (operation: 'begin' | 'observe' | 'cancel' | 'recover' | 'resume') => {
    if (!mounted.current || presentation.current.disabled || presentation.current.intent !== intent ||
      AppState.currentState !== 'active' || accountLoginGate.isPending()) return;
    const original = accountLoginGate.getSnapshot().intent;
    if (operation === 'recover') {void accountLoginGate.recoverOriginal(); return;}
    if (operation === 'resume') {
      const current = accountLoginGate.getSnapshot();
      if (original === null || original !== intent || current.originalState !== 'RETAINED' || current.status === 'CANCELLED' || current.status === 'CLOSED') return;
      void accountLoginGate.resumeOriginal(); return;
    }
    if (operation === 'begin' && (original !== null || !accountLoginGate.canSelectIntent(intent))) return;
    if (operation !== 'begin' && original === null) return;
    void accountLoginGate.execute(operation, original ?? intent);
  };
  useEffect(() => {
    mounted.current = true;
    const observe = () => {
      if (!mounted.current || AppState.currentState !== 'active') return;
      if (!accountLoginGate.isPending()) void accountLoginGate.recoverOriginal();
    };
    observe(); // Recover the actual native case before offering a new begin.
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') observe();
    });
    return () => { mounted.current = false; subscription.remove(); }; // Gate owns attempt/feedback beyond this panel.
  }, []);
  // The observer stays mounted across local navigation; hidden controls cannot
  // execute a retained callback or start a new login. Recovery remains read-only.
  if (!controlsVisible) return null;
  const text = copy[locale];
  const unavailable = disabled || attempt.pending;
  const hasOriginal = attempt.intent !== null;
  const resumeDisabled = unavailable || attempt.intent !== intent || attempt.originalState !== 'RETAINED' || attempt.status === 'CANCELLED' || attempt.status === 'CLOSED';
  return <View style={{gap: 14}}>
    {!hasOriginal && attempt.originalState !== 'ABSENT' && <Text accessibilityLiveRegion="polite" style={styles.caption}>{attempt.originalState === 'UNAVAILABLE' ? text.savedUnavailable : text.checkingSaved}</Text>}
    {hasOriginal && <Text style={styles.strong}>{text.original}: {productCopy(locale, attempt.intent!)}</Text>}
    {hasOriginal ? <Pressable accessibilityRole="button" accessibilityLabel={text.resume} disabled={resumeDisabled} accessibilityState={{disabled: resumeDisabled}}
      onPress={() => run('resume')} style={[styles.button, resumeDisabled && styles.buttonDisabled]}>
      <Text style={[styles.buttonText, resumeDisabled && styles.buttonDisabledText]}>{text.resume}</Text>
    </Pressable> : <Pressable accessibilityRole="button" accessibilityLabel={intent === 'newIdentityFirstDevice' ? text.create : text.begin}
      disabled={unavailable || !accountLoginGate.canSelectIntent(intent)} accessibilityState={{disabled: unavailable || !accountLoginGate.canSelectIntent(intent)}}
      onPress={() => run('begin')} style={[styles.button, (unavailable || !accountLoginGate.canSelectIntent(intent)) && styles.buttonDisabled]}>
      <Text style={[styles.buttonText, (unavailable || !accountLoginGate.canSelectIntent(intent)) && styles.buttonDisabledText]}>{intent === 'newIdentityFirstDevice' ? text.create : text.begin}</Text>
    </Pressable>}
    {hasOriginal && <View style={styles.supportLinks}>{(['observe', 'cancel'] as const).map(operation => <Pressable key={operation} accessibilityRole="button" accessibilityLabel={text[operation]} disabled={unavailable} accessibilityState={{disabled: unavailable}}
      onPress={() => run(operation)} style={styles.linkButton}><Text style={styles.linkText}>{text[operation]}</Text></Pressable>)}</View>}
    {attempt.intent === null && attempt.originalState === 'UNAVAILABLE' && <Pressable accessibilityRole="button" accessibilityLabel={text.checkSaved} disabled={disabled || attempt.pending} accessibilityState={{disabled: disabled || attempt.pending}} onPress={() => run('recover')} style={[styles.button, (disabled || attempt.pending) && styles.buttonDisabled]}><Text style={styles.buttonText}>{text.checkSaved}</Text></Pressable>}
    {attempt.intent !== null && attempt.status && <Text accessibilityLiveRegion="polite" style={styles.text}>{text[attempt.status]}</Text>}
    {(attempt.diagnostic || attempt.failureDiagnostic) && <>
      <Pressable accessibilityRole="button" onPress={() => setDetails(value => !value)}><Text style={styles.text}>{productCopy(locale, 'diagnostics')}</Text></Pressable>
      {details && <>
        {attempt.intent && <Text style={styles.caption}>{text.retained}</Text>}
        <Text style={styles.caption}>{(locale === 'zh-Hant' ? '僅顯示本進程記錄的首個診斷，不會重發請求；舊進程未保存的原因無法補回。返回連結通過不代表帳戶或裝置已授權。' : locale === 'zh' ? '仅显示本进程记录的首个诊断，不会重发请求；旧进程未保存的原因无法补回。返回链接通过不代表账户或设备已授权。' : 'First diagnostic recorded in this process only. No request is retried and missing details from an old process cannot be recovered. Passing return-link checks is not account or device approval.')}</Text>
        {attempt.diagnostic && <Text selectable style={styles.caption}>{(locale === 'zh-Hant' ? '返回連結' : locale === 'zh' ? '返回链接' : 'Return link')}: {attempt.diagnostic.state} ({attempt.diagnostic.completedChecks}/{attempt.diagnostic.totalChecks}) / {attempt.diagnostic.check} / {attempt.diagnostic.outcome}</Text>}
        {attempt.failureDiagnostic && <Text selectable style={styles.caption}>{(locale === 'zh-Hant' ? '原登入診斷' : locale === 'zh' ? '原登录诊断' : 'Original sign-in diagnostic')}: {attempt.failureDiagnostic.state} / {attempt.failureDiagnostic.operation} / {attempt.failureDiagnostic.reason} / HTTP {attempt.failureDiagnostic.httpStatus} / {(locale === 'zh-Hant' ? '遠端結果未知' : locale === 'zh' ? '远端结果未知' : 'Remote outcome unknown')}: {String(attempt.failureDiagnostic.remoteOutcomeUnknown)} / {attempt.failureDiagnostic.exception}</Text>}
      </>}
    </>}
  </View>;
}
