import React, {useEffect, useState, useSyncExternalStore} from 'react';
import {AppState, Pressable, Text, View} from 'react-native';
import {ownerLifecycleGate} from './ownerLifecycle';
import {LocalRecoveryPanel} from './LocalRecoveryPanel';
import {useProductTheme} from './useProductTheme';
const copy = {
  en: {title:'Local operation and closing', detail:'Check retained local work before closing. Closing is not sign-out, device revocation, or permission to update. No data or keys are deleted.', close:'Request local close', confirm:'Confirm closing this local owner', observe:'Check original receipt', pending:'Waiting for the original receipt. Do not force-stop or replace this operation.', failed:'The receipt could not be read. Original ownership remains unresolved.', NOT_SELECTED:'No close receipt in this process. After a restart this does not prove earlier work was released.', NOT_OPENED:'No local owner was open for this close. This does not prove durable work is resolved.', CLOSED_LOCAL_ONLY:'This local owner reports closed. Account, device and durable update compatibility still require separate checks.', PENDING_RECONCILIATION_REQUIRED:'Local work must be reconciled; this owner has not closed. Retained checks remain observable; unavailable recovery must not be bypassed.', CLOSE_RECEIPT_FAILED:'Closing failed. The original owner and failure remain retained.', OBSERVATION_PENDING:'The original close receipt is still pending.', diagnostics:'Technical details'},
  zh: {title:'本机操作与关闭', detail:'关闭前检查原本机操作。关闭不等于退出账号、撤销设备或允许更新，不会删除数据或密钥。', close:'请求本机关闭', confirm:'确认关闭此本机 owner', observe:'查看原回执', pending:'正在等待原回执，请勿强停或替换此操作。', failed:'无法读取回执，原操作所有权仍未解决。', NOT_SELECTED:'本进程没有关闭回执。重启后这不证明先前操作已释放。', NOT_OPENED:'本次关闭没有已打开的本机 owner，不证明持久操作已解决。', CLOSED_LOCAL_ONLY:'此本机 owner 报告已关闭；账号、设备及持久状态更新兼容性仍需单独检查。', PENDING_RECONCILIATION_REQUIRED:'原操作仍需核对，本机 owner 尚未关闭。可观察已有检查；不能绕过缺失的恢复能力。', CLOSE_RECEIPT_FAILED:'关闭失败，原 owner 与失败原因仍保留。', OBSERVATION_PENDING:'原关闭回执仍在等待。', diagnostics:'技术详情'},

'zh-Hant': {title:'本機操作與關閉', detail:'關閉前檢查原本機操作。關閉不等於退出帳號、撤銷裝置或允許更新，不會刪除資料或金鑰。', close:'請求本機關閉', confirm:'確認關閉此本機 owner', observe:'查看原回執', pending:'正在等待原回執，請勿強停或替換此操作。', failed:'無法讀取回執，原操作所有權仍未解決。', NOT_SELECTED:'本進程沒有關閉回執。重啟後這不證明先前操作已釋放。', NOT_OPENED:'本次關閉沒有已打開的本機 owner，不證明持久操作已解決。', CLOSED_LOCAL_ONLY:'此本機 owner 報告已關閉；帳號、裝置及持久狀態更新兼容性仍需單獨檢查。', PENDING_RECONCILIATION_REQUIRED:'原操作仍需核對，本機 owner 尚未關閉。可觀察已有檢查；不能繞過缺失的恢復能力。', CLOSE_RECEIPT_FAILED:'關閉失敗，原 owner 與失敗原因仍保留。', OBSERVATION_PENDING:'原關閉回執仍在等待。', diagnostics:'技術詳情'},
} as const;
export function OwnerLifecyclePanel({locale, disabled}: {locale:'en' | 'zh' | 'zh-Hant'; disabled:boolean}) {
  const {styles, colors} = useProductTheme();
  const state=useSyncExternalStore(ownerLifecycleGate.subscribe,ownerLifecycleGate.getSnapshot,ownerLifecycleGate.getSnapshot);
  const [confirm,setConfirm]=useState(false), [details,setDetails]=useState(false);
  useEffect(() => {void ownerLifecycleGate.observe(); const sub=AppState.addEventListener('change', value => {if(value==='active') void ownerLifecycleGate.observe();}); return () => sub.remove();},[]);
  const t=copy[locale];
  const button=(label:string, blocked:boolean, action:()=>void) => <Pressable accessibilityRole="button" disabled={blocked} accessibilityState={{disabled:blocked}} onPress={action} style={[styles.button,blocked && styles.buttonDisabled]}><Text style={[styles.buttonText,blocked && styles.buttonDisabledText]}>{label}</Text></Pressable>;
  return <View style={styles.card}>
    <Text style={styles.strong}>{t.title}</Text><Text style={styles.text}>{t.detail}</Text>
    <LocalRecoveryPanel locale={locale} disabled={disabled || state.pending} />
    {button(confirm?t.confirm:t.close,disabled || state.pending || state.selected || (!!state.result && state.result.closeStatus!=='NOT_SELECTED'),() => {if(!confirm)setConfirm(true);else void ownerLifecycleGate.closeOriginal();})}
    {button(t.observe,state.pending,() => {void ownerLifecycleGate.observe();})}
    <Text accessibilityLiveRegion="polite" style={styles.text}>{state.pending?t.pending:state.observationFailed?t.failed:state.result?t[state.result.closeStatus]:''}</Text>
    <Pressable accessibilityRole="button" onPress={() => setDetails(v=>!v)}><Text style={styles.caption}>{t.diagnostics}</Text></Pressable>
    {details && state.result && <Text selectable style={styles.caption}>{JSON.stringify(state.result)}</Text>}
  </View>;
}
