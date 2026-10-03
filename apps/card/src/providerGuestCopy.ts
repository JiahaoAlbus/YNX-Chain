import type {Locale} from './i18n';

type Key='title'|'permission'|'authorize'|'revoke'|'unavailable';
const copy:Readonly<Record<Locale,Readonly<Record<Key,string>>>>={
  en:{title:'Provider TEST Card',permission:'A separate Wallet Product Session is required. A Standard EVM connection does not grant Card access.',authorize:'Authorize Card TEST session',revoke:'Revoke Card session',unavailable:'Card private services are unavailable. Standard Wallet and guest exploration remain independent.'},
  'zh-CN':{title:'服务商 TEST 卡',permission:'需要单独的钱包 Product Session；标准 EVM 连接不授予 Card 权限。',authorize:'授权 Card TEST 会话',revoke:'撤销 Card 会话',unavailable:'Card 私有服务暂不可用。标准钱包和访客探索仍独立可用。'},
  'zh-TW':{title:'服務商 TEST 卡',permission:'需要獨立的錢包 Product Session；標準 EVM 連線不會授予 Card 權限。',authorize:'授權 Card TEST 工作階段',revoke:'撤銷 Card 工作階段',unavailable:'Card 私有服務暫時無法使用。標準錢包與訪客探索仍可獨立使用。'},
  ja:{title:'プロバイダー TEST カード',permission:'個別の Wallet Product Session が必要です。標準 EVM 接続だけでは Card へのアクセス権は付与されません。',authorize:'Card TEST セッションを承認',revoke:'Card セッションの権限を取り消す',unavailable:'Card の非公開サービスは利用できません。標準ウォレットとゲスト機能は独立して利用できます。'},
  ko:{title:'제공업체 TEST 카드',permission:'별도의 Wallet Product Session이 필요합니다. 표준 EVM 연결만으로는 Card 접근 권한이 부여되지 않습니다.',authorize:'Card TEST 세션 승인',revoke:'Card 세션 권한 철회',unavailable:'Card 비공개 서비스를 사용할 수 없습니다. 표준 지갑과 게스트 탐색은 독립적으로 유지됩니다.'},
  es:{title:'Tarjeta TEST del proveedor',permission:'Se requiere una Product Session de Wallet independiente. Una conexión EVM estándar no concede acceso a Card.',authorize:'Autorizar sesión TEST de Card',revoke:'Revocar sesión de Card',unavailable:'Los servicios privados de Card no están disponibles. La Wallet estándar y la exploración como invitado siguen siendo independientes.'},
  fr:{title:'Carte TEST du fournisseur',permission:'Une Product Session Wallet distincte est nécessaire. Une connexion EVM standard ne donne pas accès à Card.',authorize:'Autoriser la session TEST Card',revoke:'Révoquer la session Card',unavailable:'Les services privés de Card sont indisponibles. Le Wallet standard et la navigation en mode invité restent indépendants.'},
  de:{title:'TEST-Karte des Anbieters',permission:'Eine separate Wallet Product Session ist erforderlich. Eine Standard-EVM-Verbindung gewährt keinen Card-Zugriff.',authorize:'Card-TEST-Sitzung autorisieren',revoke:'Card-Sitzung widerrufen',unavailable:'Private Card-Dienste sind nicht verfügbar. Standard-Wallet und Gastzugang bleiben unabhängig.'},
  pt:{title:'Cartão TEST do fornecedor',permission:'É necessária uma Product Session da Wallet separada. Uma conexão EVM padrão não concede acesso ao Card.',authorize:'Autorizar sessão TEST do Card',revoke:'Revogar sessão do Card',unavailable:'Os serviços privados do Card estão indisponíveis. A Wallet padrão e a exploração como visitante continuam independentes.'},
  ru:{title:'TEST-карта провайдера',permission:'Требуется отдельная Product Session Wallet. Стандартное EVM-подключение не предоставляет доступ к Card.',authorize:'Разрешить TEST-сессию Card',revoke:'Отозвать сессию Card',unavailable:'Закрытые сервисы Card недоступны. Стандартный кошелёк и гостевой режим остаются независимыми.'},
  ar:{title:'بطاقة TEST لدى المزوّد',permission:'يلزم توفر Product Session منفصلة في Wallet. اتصال EVM القياسي لا يمنح صلاحية الوصول إلى Card.',authorize:'تفويض جلسة Card TEST',revoke:'إلغاء تفويض جلسة Card',unavailable:'خدمات Card الخاصة غير متاحة. اتصال المحفظة القياسي واستكشاف الضيف مستقلان.'},
  id:{title:'Kartu TEST penyedia',permission:'Diperlukan Product Session Wallet terpisah. Koneksi EVM standar tidak memberikan akses Card.',authorize:'Otorisasi sesi TEST Card',revoke:'Cabut sesi Card',unavailable:'Layanan privat Card tidak tersedia. Wallet standar dan penjelajahan tamu tetap independen.'},
};

export function providerGuestText(locale:Locale='en',key:Key):string{return copy[locale][key]}

export function providerGuestErrorText(locale:Locale,error:unknown):string{
  const safeCode=typeof error==='string'&&/^[A-Z0-9_]{3,80}$/.test(error)?error:null;
  const message=providerGuestText(locale,'unavailable');
  return safeCode?`${message} (${safeCode})`:message;
}
