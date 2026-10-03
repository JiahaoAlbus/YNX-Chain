const keys=['connectBuyer','connectSeller','active','retry','openBuyer','openSeller','openMerchant','continueSeller'];
const rows={
 en:['Connect private Shop service','Connect private Seller service','Private session active','Retry private sign-out','Open YNX Wallet to review Shop approval','Open YNX Wallet to review Seller approval','Open YNX Wallet to review Merchant approval','Continue to Seller Console'],
 'zh-CN':['连接商城私有服务','连接卖家私有服务','私有会话已激活','重试退出私有会话','打开 YNX Wallet 审核商城授权','打开 YNX Wallet 审核卖家授权','打开 YNX Wallet 审核商户授权','继续前往卖家控制台'],
 'zh-TW':['連線商城私有服務','連線賣家私有服務','私有工作階段已啟用','重試登出私有工作階段','開啟 YNX Wallet 審核商城授權','開啟 YNX Wallet 審核賣家授權','開啟 YNX Wallet 審核商戶授權','繼續前往賣家控制台'],
 ja:['Shopのプライベートサービスに接続','販売者のプライベートサービスに接続','プライベートセッション有効','サインアウトを再試行','YNX WalletでShopの承認を確認','YNX Walletで販売者の承認を確認','YNX Walletで加盟店の承認を確認','販売者コンソールへ進む'],
 ko:['Shop 비공개 서비스 연결','판매자 비공개 서비스 연결','비공개 세션 활성','비공개 로그아웃 재시도','YNX Wallet에서 Shop 승인 검토','YNX Wallet에서 판매자 승인 검토','YNX Wallet에서 가맹점 승인 검토','판매자 콘솔로 이동'],
 es:['Conectar servicio privado de Shop','Conectar servicio privado del vendedor','Sesión privada activa','Reintentar cerrar sesión privada','Abrir YNX Wallet para revisar la autorización de Shop','Abrir YNX Wallet para revisar la autorización del vendedor','Abrir YNX Wallet para revisar la autorización del comercio','Continuar a la consola del vendedor'],
 fr:['Connecter le service privé Shop','Connecter le service privé vendeur','Session privée active','Réessayer la déconnexion privée','Ouvrir YNX Wallet pour examiner l’autorisation Shop','Ouvrir YNX Wallet pour examiner l’autorisation vendeur','Ouvrir YNX Wallet pour examiner l’autorisation marchand','Continuer vers la console vendeur'],
 de:['Privaten Shop-Dienst verbinden','Privaten Verkäuferdienst verbinden','Private Sitzung aktiv','Private Abmeldung wiederholen','YNX Wallet zur Prüfung der Shop-Freigabe öffnen','YNX Wallet zur Prüfung der Verkäuferfreigabe öffnen','YNX Wallet zur Prüfung der Händlerfreigabe öffnen','Zur Verkäuferkonsole weiter'],
 pt:['Conectar serviço privado do Shop','Conectar serviço privado do vendedor','Sessão privada ativa','Tentar sair da sessão privada novamente','Abrir YNX Wallet para revisar a autorização do Shop','Abrir YNX Wallet para revisar a autorização do vendedor','Abrir YNX Wallet para revisar a autorização do comerciante','Continuar para o console do vendedor'],
 ru:['Подключить частный сервис Shop','Подключить частный сервис продавца','Частная сессия активна','Повторить выход из частной сессии','Открыть YNX Wallet для проверки разрешения Shop','Открыть YNX Wallet для проверки разрешения продавца','Открыть YNX Wallet для проверки разрешения магазина','Перейти в консоль продавца'],
 ar:['ربط خدمة المتجر الخاصة','ربط خدمة البائع الخاصة','الجلسة الخاصة نشطة','إعادة محاولة تسجيل الخروج الخاص','فتح YNX Wallet لمراجعة تفويض المتجر','فتح YNX Wallet لمراجعة تفويض البائع','فتح YNX Wallet لمراجعة تفويض التاجر','المتابعة إلى لوحة البائع'],
 id:['Hubungkan layanan privat Shop','Hubungkan layanan privat penjual','Sesi privat aktif','Coba lagi keluar dari sesi privat','Buka YNX Wallet untuk meninjau izin Shop','Buka YNX Wallet untuk meninjau izin penjual','Buka YNX Wallet untuk meninjau izin merchant','Lanjutkan ke konsol penjual']
};
export function privateCopy(key,locale=globalThis.document?.documentElement?.lang||'en'){
 const language=locale.startsWith('zh-Hant')?'zh-TW':locale.startsWith('zh-Hans')?'zh-CN':locale;
 const index=keys.indexOf(key);if(index<0)throw new TypeError('Unknown private session label.');
 return (rows[language]||rows[language.split('-')[0]]||rows.en)[index];
}
