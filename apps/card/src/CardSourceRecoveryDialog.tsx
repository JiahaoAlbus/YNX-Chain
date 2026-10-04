import React,{useEffect,useState} from 'react';
import {Modal,Pressable,StyleSheet,View} from 'react-native';
import {CardText as Text} from './cardTypography';
import type {Locale} from './i18n';
import {isRTL} from './i18n';
import {privateServiceText} from './privateServiceCopy';

const copy:Record<Locale,readonly[string,string,string,string,string,string]>={
 en:['Card service verification','Continue as guest','Reload Card page','Unsaved form edits may be lost when reloading. Stored records are not cleared. Reloading does not approve Wallet access or create a Card.','Confirm page reload','Keep this page'],
 'zh-CN':['Card 服务验证','继续访客浏览','重新加载 Card 页面','重新加载可能丢失尚未保存的表单编辑，已存储记录不会被清除。重载不会批准钱包访问或创建卡。','确认重新加载','保留当前页面'],
 'zh-TW':['Card 服務驗證','繼續訪客瀏覽','重新載入 Card 頁面','重新載入可能遺失尚未儲存的表單編輯，已儲存紀錄不會被清除。重載不會批准錢包存取或建立卡。','確認重新載入','保留目前頁面'],
 ja:['Card サービス確認','ゲストとして続ける','Card ページを再読み込み','再読み込みで未保存の編集が失われる場合があります。保存済み記録は削除しません。ウォレット承認やカード作成は行いません。','再読み込みを確認','このページを保持'],
 ko:['Card 서비스 확인','게스트로 계속','Card 페이지 새로 고침','새로 고침 시 저장하지 않은 편집 내용이 사라질 수 있습니다. 저장된 기록은 삭제하지 않습니다. 지갑 승인을 하거나 카드를 생성하지 않습니다.','새로 고침 확인','현재 페이지 유지'],
 es:['Verificación del servicio Card','Continuar como invitado','Recargar página Card','La recarga puede perder cambios no guardados. No borra registros guardados, autoriza Wallet ni crea una Card.','Confirmar recarga','Conservar esta página'],
 fr:['Vérification du service Card','Continuer en invité','Recharger la page Card','Les modifications non enregistrées peuvent être perdues. Les données enregistrées restent conservées. Aucun accès Wallet ni création Card ne sera approuvé.','Confirmer le rechargement','Garder cette page'],
 de:['Card-Service prüfen','Als Gast fortfahren','Card-Seite neu laden','Ungespeicherte Eingaben können verloren gehen. Gespeicherte Daten bleiben erhalten. Kein Wallet-Zugriff und keine Card-Erstellung wird genehmigt.','Neuladen bestätigen','Seite behalten'],
 pt:['Verificação do serviço Card','Continuar como visitante','Recarregar página Card','Edições não salvas podem ser perdidas. Registros salvos não são apagados. Nenhum acesso Wallet ou criação de Card será aprovado.','Confirmar recarga','Manter esta página'],
 ru:['Проверка сервиса Card','Продолжить как гость','Обновить страницу Card','Несохранённые изменения могут потеряться. Сохранённые записи не удаляются. Доступ Wallet и создание Card не подтверждаются.','Подтвердить обновление','Оставить страницу'],
 ar:['التحقق من خدمة Card','المتابعة كضيف','إعادة تحميل صفحة Card','قد تفقد تعديلات النموذج غير المحفوظة. لن تُحذف السجلات المحفوظة. لا تُعتمد صلاحيات المحفظة ولا تُنشأ بطاقة.','تأكيد إعادة التحميل','الإبقاء على الصفحة'],
 id:['Verifikasi layanan Card','Lanjut sebagai tamu','Muat ulang halaman Card','Edit yang belum tersimpan dapat hilang. Catatan tersimpan tidak dihapus. Akses Wallet dan pembuatan Card tidak disetujui.','Konfirmasi muat ulang','Pertahankan halaman'],
};
export function CardSourceRecoveryDialog({locale,code,onClose,onGuest,onReload}:{locale:Locale;code?:string;onClose:()=>void;onGuest:()=>void;onReload?:()=>void}){
 const[confirmReload,setConfirmReload]=useState(false);
 useEffect(()=>{setConfirmReload(false)},[code]);
 if(code!=='CARD_API_SOURCE_MISMATCH'&&code!=='CARD_API_SOURCE_UNAVAILABLE')return null;
 const labels=copy[locale],rtl=isRTL(locale);
 return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
  <View style={s.backdrop}><View accessibilityViewIsModal accessibilityLabel={labels[0]} style={[s.panel,rtl&&s.rtl]}>
   <Text accessibilityRole="header" style={s.title}>{labels[0]}</Text>
   <Text style={s.body}>{privateServiceText(locale,code)}</Text>
   {confirmReload?<Text accessibilityLiveRegion="polite" style={s.warning}>{labels[3]}</Text>:null}
   <View style={s.actions}>
    <Pressable accessibilityRole="button" onPress={confirmReload?()=>setConfirmReload(false):onClose} style={s.secondary}><Text style={s.secondaryText}>{labels[5]}</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={onGuest} style={s.secondary}><Text style={s.secondaryText}>{labels[1]}</Text></Pressable>
    {onReload?<Pressable accessibilityRole="button" onPress={()=>{if(confirmReload)onReload();else setConfirmReload(true)}} style={s.primary}><Text style={s.primaryText}>{labels[confirmReload?4:2]}</Text></Pressable>:null}
   </View>
  </View></View>
 </Modal>;
}
const s=StyleSheet.create({backdrop:{flex:1,backgroundColor:'rgba(23,26,34,0.42)',justifyContent:'center',alignItems:'center',padding:20},panel:{width:'100%',maxWidth:520,backgroundColor:'#FFFFFF',borderRadius:20,padding:24,gap:18},rtl:{direction:'rtl'},title:{fontSize:24,fontWeight:'700',color:'#171A22'},body:{fontSize:16,lineHeight:25,color:'#414957'},warning:{fontSize:16,lineHeight:25,color:'#171A22',backgroundColor:'#F4F7FF',padding:16,borderRadius:10},actions:{gap:10},secondary:{minHeight:48,justifyContent:'center',alignItems:'center',padding:12,borderWidth:1,borderColor:'#DFE3EA',borderRadius:10},secondaryText:{fontSize:16,fontWeight:'600',color:'#002FA7'},primary:{minHeight:48,justifyContent:'center',alignItems:'center',padding:12,backgroundColor:'#002FA7',borderRadius:10},primaryText:{fontSize:16,fontWeight:'600',color:'#FFFFFF'}});
