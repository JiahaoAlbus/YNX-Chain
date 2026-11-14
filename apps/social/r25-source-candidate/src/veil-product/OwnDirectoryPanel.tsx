import React,{useEffect,useSyncExternalStore} from 'react';
import {AppState,Pressable,Text,View} from 'react-native';
import {ownDirectoryGate} from './ownDirectory';
import {useProductTheme} from './useProductTheme';
import type {VeilLocale} from './copy';
export function OwnDirectoryPanel({account,scope,locale}:{account:string|null;scope:string|null;locale:VeilLocale}){
 const {styles}=useProductTheme();
 const snapshot=useSyncExternalStore(ownDirectoryGate.subscribe,ownDirectoryGate.getSnapshot,ownDirectoryGate.getSnapshot);
 useEffect(()=>{
  ownDirectoryGate.select(scope,account);
  if(AppState.currentState==='active')ownDirectoryGate.observeCurrent();
  return()=>{if(ownDirectoryGate.getSnapshot().scope===scope)ownDirectoryGate.select(null,null);};
 },[scope,account]);
 const result=snapshot.scope===scope?snapshot.result:null;
 const active=!!scope&&!!account&&snapshot.scope===scope;
 const en=locale==='en',traditional=locale==='zh-Hant';
 const t=(english:string,chinese:string,other=chinese)=>en?english:traditional?other:chinese;
 const state=result?.state??'NOT_REQUESTED';
 const detail={
  NOT_REQUESTED:t('The device directory has not been read.','尚未读取设备目录。','尚未讀取裝置目錄。'),
  OBSERVED:t('Directory data was read for this account.','已读取此账户的目录数据。','已讀取此帳戶的目錄資料。'),
  RETAINED:t('The original read could not be confirmed. Check its state or close it; it has not been restarted.','原读取暂时无法确认。可查看原状态或关闭；不会重新发起。','原讀取暫時無法確認。可查看原狀態或關閉；不會重新發起。'),
  CLOSING:t('The original read is still being closed. Its references are retained.','原读取仍在关闭中，引用保持保留。','原讀取仍在關閉中，引用保持保留。'),
  CLOSED:t('The local read was closed.','本地读取已关闭。','本地讀取已關閉。'),
  CLOSED_ERROR:t('The local read was released with its original failure retained.','本地读取引用已释放，原失败记录仍保留。','本地讀取引用已釋放，原失敗記錄仍保留。'),
  UNAVAILABLE:t('The account’s device directory is currently unavailable.','当前无法读取此账户的设备目录。','目前無法讀取此帳戶的裝置目錄。'),
 }[state];
 const run=(action:'read'|'observe'|'close')=>{if(active&&AppState.currentState==='active'&&ownDirectoryGate.getSnapshot().scope===scope)void ownDirectoryGate.run(action);};
 return <View style={{gap:10}}>
  <Text style={styles.strong}>{t('Device directory','设备目录','裝置目錄')}</Text>
  <Text accessibilityLiveRegion="polite" style={styles.caption}>{snapshot.pending?t('Waiting for the same original read…','正在等待同一原读取…','正在等待同一原讀取…'):detail}</Text>
  {!active&&<Text style={styles.caption}>{t('Sign in and authorize this device to read the account’s directory.','登录并完成此设备授权后，可读取账户目录。','登入並完成此裝置授權後，可讀取帳戶目錄。')}</Text>}
  <View style={styles.wrapRow}>
   <Pressable accessibilityRole="button" accessibilityLabel={t('Read device directory','读取设备目录','讀取裝置目錄')} disabled={!active||snapshot.pending||(state!=='NOT_REQUESTED'&&state!=='UNAVAILABLE')} onPress={()=>run('read')}><Text style={styles.strong}>{t('Read device directory','读取设备目录','讀取裝置目錄')}</Text></Pressable>
   <Pressable accessibilityRole="button" accessibilityLabel={t('Check original directory read','查看原目录读取','查看原目錄讀取')} disabled={!active||snapshot.pending} onPress={()=>run('observe')}><Text style={styles.strong}>{t('Check state','查看状态','查看狀態')}</Text></Pressable>
   <Pressable accessibilityRole="button" accessibilityLabel={t('Close directory read','关闭目录读取','關閉目錄讀取')} disabled={!active||snapshot.pending||state==='NOT_REQUESTED'||state==='CLOSED'||state==='CLOSED_ERROR'} onPress={()=>run('close')}><Text style={styles.strong}>{t(state==='CLOSING'?'Continue closing':'Close read',state==='CLOSING'?'继续关闭':'关闭读取',state==='CLOSING'?'繼續關閉':'關閉讀取')}</Text></Pressable>
  </View>
  {active&&state==='OBSERVED'&&result?.accountViewRef===account&&result.data?.devices.map(row=><View key={row.device+':'+row.generation} style={styles.wrapRow}><Text selectable style={[styles.text,styles.grow]}>{row.device}</Text><Text style={styles.caption}>{row.state==='committed'?t('Registered','已登记','已登記'):t('Removed','已移除','已移除')}</Text></View>)}
  <Text style={styles.caption}>{t('Directory registration is separate from device approval and secure chat. Removal here does not confirm that every message session has been revoked.','目录登记与设备授权、安全聊天分别确认。此处移除记录不代表所有消息会话均已撤销。','目錄登記與裝置授權、安全聊天分別確認。此處移除紀錄不代表所有訊息會話均已撤銷。')}</Text>
 </View>;
}
