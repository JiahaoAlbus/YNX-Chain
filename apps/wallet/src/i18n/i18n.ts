import type { SecureStorageAdapter } from "../storage/walletRepository";

export const SUPPORTED_LOCALES=["en","zh-Hans","zh-Hant","ja","ko","es","fr","de","pt","ru","ar","id"] as const;
export type WalletLocale=typeof SUPPORTED_LOCALES[number];
export const LOCALE_PREFERENCE_KEY="ynx.wallet.locale.v1";
const EN={languageName:"English",settingsTitle:"Language and accessibility",systemDefault:"Use system language",createWallet:"Create a new Wallet",importWallet:"Import recovery key",unlock:"Unlock with biometrics",signInTitle:"Sign in with YNX Wallet",approve:"Approve",reject:"Reject",permissions:"Permissions",purpose:"Purpose",expires:"Valid until",privacy:"Wallet never shares private keys or recovery material.",recovery:"Restore offline with the recovery key. Product sessions are not restored.",retry:"Retry",offline:"Offline. Stored accounts remain available; network data is unavailable.",unavailable:"Service unavailable",errorPrefix:"Security check failed",aiOutputLanguage:"AI output language",close:"Close",revoke:"Revoke approval",audit:"Authorization audit",requestingApp:"Requesting App",appIdentity:"App identity",network:"Network",account:"Account"} as const;
type BaseMessageKey=keyof typeof EN;
const MESSAGES:Record<WalletLocale,Record<BaseMessageKey,string>>={
  en:EN,
  "zh-Hans":{languageName:"简体中文",settingsTitle:"语言与辅助功能",systemDefault:"使用系统语言",createWallet:"创建新钱包",importWallet:"导入恢复密钥",unlock:"使用生物识别解锁",signInTitle:"使用 YNX Wallet 登录",approve:"批准",reject:"拒绝",permissions:"权限",purpose:"用途",expires:"有效期至",privacy:"Wallet 绝不会共享私钥或恢复材料。",recovery:"使用恢复密钥离线恢复。产品会话不会被恢复。",retry:"重试",offline:"当前离线。已存账户仍可使用，网络数据不可用。",unavailable:"服务不可用",errorPrefix:"安全检查失败",aiOutputLanguage:"AI 输出语言",close:"关闭",revoke:"撤销授权",audit:"授权审计",requestingApp:"请求 App",appIdentity:"App 身份",network:"网络",account:"账户"},
  "zh-Hant":{languageName:"繁體中文",settingsTitle:"語言與輔助功能",systemDefault:"使用系統語言",createWallet:"建立新錢包",importWallet:"匯入復原金鑰",unlock:"使用生物辨識解鎖",signInTitle:"使用 YNX Wallet 登入",approve:"核准",reject:"拒絕",permissions:"權限",purpose:"用途",expires:"有效期限",privacy:"Wallet 絕不會分享私鑰或復原資料。",recovery:"使用復原金鑰離線復原。產品工作階段不會復原。",retry:"重試",offline:"目前離線。已儲存帳戶仍可使用，網路資料無法取得。",unavailable:"服務無法使用",errorPrefix:"安全檢查失敗",aiOutputLanguage:"AI 輸出語言",close:"關閉",revoke:"撤銷授權",audit:"授權稽核",requestingApp:"要求 App",appIdentity:"App 身分",network:"網路",account:"帳戶"},
  ja:{languageName:"日本語",settingsTitle:"言語とアクセシビリティ",systemDefault:"システム言語を使用",createWallet:"新しいウォレットを作成",importWallet:"復元キーをインポート",unlock:"生体認証でロック解除",signInTitle:"YNX Wallet でサインイン",approve:"承認",reject:"拒否",permissions:"権限",purpose:"目的",expires:"有効期限",privacy:"Wallet が秘密鍵や復元情報を共有することはありません。",recovery:"復元キーでオフライン復元します。製品セッションは復元されません。",retry:"再試行",offline:"オフラインです。保存済みアカウントは利用できますが、ネットワークデータは取得できません。",unavailable:"サービスを利用できません",errorPrefix:"セキュリティ確認に失敗しました",aiOutputLanguage:"AI 出力言語",close:"閉じる",revoke:"承認を取り消す",audit:"認可監査",requestingApp:"要求元 App",appIdentity:"App ID",network:"ネットワーク",account:"アカウント"},
  ko:{languageName:"한국어",settingsTitle:"언어 및 접근성",systemDefault:"시스템 언어 사용",createWallet:"새 지갑 만들기",importWallet:"복구 키 가져오기",unlock:"생체 인증으로 잠금 해제",signInTitle:"YNX Wallet로 로그인",approve:"승인",reject:"거부",permissions:"권한",purpose:"목적",expires:"유효 기간",privacy:"Wallet은 개인 키나 복구 자료를 공유하지 않습니다.",recovery:"복구 키로 오프라인 복구합니다. 제품 세션은 복구되지 않습니다.",retry:"다시 시도",offline:"오프라인입니다. 저장된 계정은 사용할 수 있지만 네트워크 데이터는 사용할 수 없습니다.",unavailable:"서비스를 사용할 수 없음",errorPrefix:"보안 확인 실패",aiOutputLanguage:"AI 출력 언어",close:"닫기",revoke:"승인 취소",audit:"승인 감사",requestingApp:"요청 App",appIdentity:"App ID",network:"네트워크",account:"계정"},
  es:{languageName:"Español",settingsTitle:"Idioma y accesibilidad",systemDefault:"Usar idioma del sistema",createWallet:"Crear una Wallet nueva",importWallet:"Importar clave de recuperación",unlock:"Desbloquear con biometría",signInTitle:"Iniciar sesión con YNX Wallet",approve:"Aprobar",reject:"Rechazar",permissions:"Permisos",purpose:"Finalidad",expires:"Válido hasta",privacy:"Wallet nunca comparte claves privadas ni material de recuperación.",recovery:"Recupera sin conexión con la clave. Las sesiones de productos no se restauran.",retry:"Reintentar",offline:"Sin conexión. Las cuentas guardadas siguen disponibles; los datos de red no.",unavailable:"Servicio no disponible",errorPrefix:"Falló la comprobación de seguridad",aiOutputLanguage:"Idioma de salida de IA",close:"Cerrar",revoke:"Revocar autorización",audit:"Auditoría de autorizaciones",requestingApp:"App solicitante",appIdentity:"Identidad de la App",network:"Red",account:"Cuenta"},
  fr:{languageName:"Français",settingsTitle:"Langue et accessibilité",systemDefault:"Utiliser la langue du système",createWallet:"Créer un nouveau Wallet",importWallet:"Importer la clé de récupération",unlock:"Déverrouiller par biométrie",signInTitle:"Se connecter avec YNX Wallet",approve:"Approuver",reject:"Refuser",permissions:"Autorisations",purpose:"Finalité",expires:"Valable jusqu’au",privacy:"Wallet ne partage jamais les clés privées ni les éléments de récupération.",recovery:"Restaurez hors ligne avec la clé. Les sessions produit ne sont pas restaurées.",retry:"Réessayer",offline:"Hors ligne. Les comptes enregistrés restent disponibles, pas les données réseau.",unavailable:"Service indisponible",errorPrefix:"Échec du contrôle de sécurité",aiOutputLanguage:"Langue de sortie de l’IA",close:"Fermer",revoke:"Révoquer l’autorisation",audit:"Journal des autorisations",requestingApp:"App demandeuse",appIdentity:"Identité de l’App",network:"Réseau",account:"Compte"},
  de:{languageName:"Deutsch",settingsTitle:"Sprache und Barrierefreiheit",systemDefault:"Systemsprache verwenden",createWallet:"Neue Wallet erstellen",importWallet:"Wiederherstellungsschlüssel importieren",unlock:"Mit Biometrie entsperren",signInTitle:"Mit YNX Wallet anmelden",approve:"Genehmigen",reject:"Ablehnen",permissions:"Berechtigungen",purpose:"Zweck",expires:"Gültig bis",privacy:"Wallet gibt niemals private Schlüssel oder Wiederherstellungsdaten weiter.",recovery:"Offline mit dem Schlüssel wiederherstellen. Produktsitzungen werden nicht wiederhergestellt.",retry:"Erneut versuchen",offline:"Offline. Gespeicherte Konten bleiben verfügbar; Netzwerkdaten nicht.",unavailable:"Dienst nicht verfügbar",errorPrefix:"Sicherheitsprüfung fehlgeschlagen",aiOutputLanguage:"KI-Ausgabesprache",close:"Schließen",revoke:"Genehmigung widerrufen",audit:"Autorisierungsprotokoll",requestingApp:"Anfragende App",appIdentity:"App-Identität",network:"Netzwerk",account:"Konto"},
  pt:{languageName:"Português",settingsTitle:"Idioma e acessibilidade",systemDefault:"Usar idioma do sistema",createWallet:"Criar nova Wallet",importWallet:"Importar chave de recuperação",unlock:"Desbloquear com biometria",signInTitle:"Entrar com YNX Wallet",approve:"Aprovar",reject:"Rejeitar",permissions:"Permissões",purpose:"Finalidade",expires:"Válido até",privacy:"A Wallet nunca compartilha chaves privadas nem material de recuperação.",recovery:"Restaure offline com a chave. Sessões de produtos não são restauradas.",retry:"Tentar novamente",offline:"Offline. Contas salvas continuam disponíveis; dados de rede não.",unavailable:"Serviço indisponível",errorPrefix:"Falha na verificação de segurança",aiOutputLanguage:"Idioma de saída da IA",close:"Fechar",revoke:"Revogar autorização",audit:"Auditoria de autorizações",requestingApp:"App solicitante",appIdentity:"Identidade do App",network:"Rede",account:"Conta"},
  ru:{languageName:"Русский",settingsTitle:"Язык и специальные возможности",systemDefault:"Использовать язык системы",createWallet:"Создать новый Wallet",importWallet:"Импортировать ключ восстановления",unlock:"Разблокировать биометрией",signInTitle:"Войти через YNX Wallet",approve:"Разрешить",reject:"Отклонить",permissions:"Разрешения",purpose:"Назначение",expires:"Действительно до",privacy:"Wallet никогда не передает закрытые ключи или материалы восстановления.",recovery:"Восстановите офлайн с помощью ключа. Сеансы продуктов не восстанавливаются.",retry:"Повторить",offline:"Нет сети. Сохраненные аккаунты доступны, сетевые данные недоступны.",unavailable:"Сервис недоступен",errorPrefix:"Проверка безопасности не пройдена",aiOutputLanguage:"Язык ответа ИИ",close:"Закрыть",revoke:"Отозвать разрешение",audit:"Журнал авторизаций",requestingApp:"Запрашивающее приложение",appIdentity:"Идентификатор приложения",network:"Сеть",account:"Аккаунт"},
  ar:{languageName:"العربية",settingsTitle:"اللغة وإمكانية الوصول",systemDefault:"استخدام لغة النظام",createWallet:"إنشاء محفظة جديدة",importWallet:"استيراد مفتاح الاسترداد",unlock:"فتح القفل بالمقاييس الحيوية",signInTitle:"تسجيل الدخول باستخدام YNX Wallet",approve:"موافقة",reject:"رفض",permissions:"الأذونات",purpose:"الغرض",expires:"صالح حتى",privacy:"لا تشارك Wallet المفاتيح الخاصة أو مواد الاسترداد مطلقًا.",recovery:"استعد دون اتصال باستخدام المفتاح. لا تُستعاد جلسات المنتجات.",retry:"إعادة المحاولة",offline:"غير متصل. تبقى الحسابات المحفوظة متاحة، وبيانات الشبكة غير متاحة.",unavailable:"الخدمة غير متاحة",errorPrefix:"فشل فحص الأمان",aiOutputLanguage:"لغة إخراج الذكاء الاصطناعي",close:"إغلاق",revoke:"إلغاء التفويض",audit:"سجل التفويض",requestingApp:"التطبيق الطالب",appIdentity:"هوية التطبيق",network:"الشبكة",account:"الحساب"},
  id:{languageName:"Bahasa Indonesia",settingsTitle:"Bahasa dan aksesibilitas",systemDefault:"Gunakan bahasa sistem",createWallet:"Buat Wallet baru",importWallet:"Impor kunci pemulihan",unlock:"Buka dengan biometrik",signInTitle:"Masuk dengan YNX Wallet",approve:"Setujui",reject:"Tolak",permissions:"Izin",purpose:"Tujuan",expires:"Berlaku hingga",privacy:"Wallet tidak pernah membagikan kunci privat atau materi pemulihan.",recovery:"Pulihkan secara offline dengan kunci. Sesi produk tidak dipulihkan.",retry:"Coba lagi",offline:"Offline. Akun tersimpan tetap tersedia; data jaringan tidak tersedia.",unavailable:"Layanan tidak tersedia",errorPrefix:"Pemeriksaan keamanan gagal",aiOutputLanguage:"Bahasa keluaran AI",close:"Tutup",revoke:"Cabut persetujuan",audit:"Audit otorisasi",requestingApp:"App peminta",appIdentity:"Identitas App",network:"Jaringan",account:"Akun"},
};

const UI_EN={welcome:"WELCOME · SELF-CUSTODY STARTS HERE",ownAccount:"Own your account.",recoverReplacement:"Recover on a replacement device",beforeBegin:"Before you begin",walletLocked:"WALLET LOCKED",checkingBiometrics:"Checking biometrics…",lostDeviceRecovery:"Lost-device recovery",nativeAccount:"NATIVE ACCOUNT",send:"Send",receive:"Receive",activity:"Activity",accountSafety:"Account safety",lockWallet:"Lock Wallet",createAnother:"Create another account",importAnother:"Import recovery key",authorizationLead:"Review every binding. Approval shares a public account proof only.",aiSecurity:"AI security explanation",aiCannotApprove:"AI cannot sign or approve."} as const;
type UIMessageKey=keyof typeof UI_EN;
export type MessageKey=BaseMessageKey|UIMessageKey;
const UI_MESSAGES:Record<WalletLocale,Record<UIMessageKey,string>>={
  en:UI_EN,
  "zh-Hans":{welcome:"欢迎 · 自托管从这里开始",ownAccount:"掌控你的账户。",recoverReplacement:"在替换设备上恢复",beforeBegin:"开始之前",walletLocked:"钱包已锁定",checkingBiometrics:"正在检查生物识别…",lostDeviceRecovery:"丢失设备恢复",nativeAccount:"原生账户",send:"发送",receive:"接收",activity:"活动",accountSafety:"账户安全",lockWallet:"锁定钱包",createAnother:"创建另一个账户",importAnother:"导入恢复密钥",authorizationLead:"逐项检查绑定。批准只会共享公开账户证明。",aiSecurity:"AI 安全说明",aiCannotApprove:"AI 无法签名或批准。"},
  "zh-Hant":{welcome:"歡迎 · 自我託管從這裡開始",ownAccount:"掌控你的帳戶。",recoverReplacement:"在替換裝置上復原",beforeBegin:"開始之前",walletLocked:"錢包已鎖定",checkingBiometrics:"正在檢查生物辨識…",lostDeviceRecovery:"遺失裝置復原",nativeAccount:"原生帳戶",send:"傳送",receive:"接收",activity:"活動",accountSafety:"帳戶安全",lockWallet:"鎖定錢包",createAnother:"建立另一個帳戶",importAnother:"匯入復原金鑰",authorizationLead:"逐項檢查綁定。核准只會分享公開帳戶證明。",aiSecurity:"AI 安全說明",aiCannotApprove:"AI 無法簽署或核准。"},
  ja:{welcome:"ようこそ · セルフカストディはここから",ownAccount:"自分のアカウントを管理。",recoverReplacement:"交換端末で復元",beforeBegin:"始める前に",walletLocked:"ウォレットはロック中",checkingBiometrics:"生体認証を確認中…",lostDeviceRecovery:"紛失端末から復元",nativeAccount:"ネイティブアカウント",send:"送信",receive:"受取",activity:"履歴",accountSafety:"アカウントの安全",lockWallet:"ウォレットをロック",createAnother:"別のアカウントを作成",importAnother:"復元キーをインポート",authorizationLead:"すべての紐付けを確認してください。承認で共有するのは公開アカウント証明だけです。",aiSecurity:"AI セキュリティ説明",aiCannotApprove:"AI は署名も承認もできません。"},
  ko:{welcome:"환영합니다 · 셀프 커스터디 시작",ownAccount:"내 계정을 직접 관리하세요.",recoverReplacement:"교체 기기에서 복구",beforeBegin:"시작하기 전에",walletLocked:"지갑 잠김",checkingBiometrics:"생체 인증 확인 중…",lostDeviceRecovery:"분실 기기 복구",nativeAccount:"네이티브 계정",send:"보내기",receive:"받기",activity:"활동",accountSafety:"계정 안전",lockWallet:"지갑 잠그기",createAnother:"다른 계정 만들기",importAnother:"복구 키 가져오기",authorizationLead:"모든 바인딩을 확인하세요. 승인은 공개 계정 증명만 공유합니다.",aiSecurity:"AI 보안 설명",aiCannotApprove:"AI는 서명하거나 승인할 수 없습니다."},
  es:{welcome:"BIENVENIDA · TU AUTOCUSTODIA EMPIEZA AQUÍ",ownAccount:"Controla tu cuenta.",recoverReplacement:"Recuperar en otro dispositivo",beforeBegin:"Antes de empezar",walletLocked:"WALLET BLOQUEADA",checkingBiometrics:"Comprobando biometría…",lostDeviceRecovery:"Recuperación por dispositivo perdido",nativeAccount:"CUENTA NATIVA",send:"Enviar",receive:"Recibir",activity:"Actividad",accountSafety:"Seguridad de la cuenta",lockWallet:"Bloquear Wallet",createAnother:"Crear otra cuenta",importAnother:"Importar clave de recuperación",authorizationLead:"Revisa cada vínculo. La aprobación solo comparte una prueba pública de la cuenta.",aiSecurity:"Explicación de seguridad con IA",aiCannotApprove:"La IA no puede firmar ni aprobar."},
  fr:{welcome:"BIENVENUE · L’AUTOGARDE COMMENCE ICI",ownAccount:"Gardez le contrôle de votre compte.",recoverReplacement:"Restaurer sur un appareil de remplacement",beforeBegin:"Avant de commencer",walletLocked:"WALLET VERROUILLÉ",checkingBiometrics:"Vérification biométrique…",lostDeviceRecovery:"Récupération après perte de l’appareil",nativeAccount:"COMPTE NATIF",send:"Envoyer",receive:"Recevoir",activity:"Activité",accountSafety:"Sécurité du compte",lockWallet:"Verrouiller Wallet",createAnother:"Créer un autre compte",importAnother:"Importer la clé de récupération",authorizationLead:"Vérifiez chaque liaison. L’approbation ne partage qu’une preuve publique du compte.",aiSecurity:"Explication de sécurité par IA",aiCannotApprove:"L’IA ne peut ni signer ni approuver."},
  de:{welcome:"WILLKOMMEN · SELBSTVERWAHRUNG BEGINNT HIER",ownAccount:"Behalte die Kontrolle über dein Konto.",recoverReplacement:"Auf einem Ersatzgerät wiederherstellen",beforeBegin:"Bevor du beginnst",walletLocked:"WALLET GESPERRT",checkingBiometrics:"Biometrie wird geprüft…",lostDeviceRecovery:"Wiederherstellung bei Geräteverlust",nativeAccount:"NATIVES KONTO",send:"Senden",receive:"Empfangen",activity:"Aktivität",accountSafety:"Kontosicherheit",lockWallet:"Wallet sperren",createAnother:"Weiteres Konto erstellen",importAnother:"Wiederherstellungsschlüssel importieren",authorizationLead:"Prüfe jede Bindung. Die Genehmigung teilt nur einen öffentlichen Kontonachweis.",aiSecurity:"KI-Sicherheitserklärung",aiCannotApprove:"KI kann weder signieren noch genehmigen."},
  pt:{welcome:"BOAS-VINDAS · A AUTOCUSTÓDIA COMEÇA AQUI",ownAccount:"Controle sua conta.",recoverReplacement:"Recuperar em um dispositivo substituto",beforeBegin:"Antes de começar",walletLocked:"WALLET BLOQUEADA",checkingBiometrics:"Verificando biometria…",lostDeviceRecovery:"Recuperação de dispositivo perdido",nativeAccount:"CONTA NATIVA",send:"Enviar",receive:"Receber",activity:"Atividade",accountSafety:"Segurança da conta",lockWallet:"Bloquear Wallet",createAnother:"Criar outra conta",importAnother:"Importar chave de recuperação",authorizationLead:"Revise cada vínculo. A aprovação compartilha apenas uma prova pública da conta.",aiSecurity:"Explicação de segurança por IA",aiCannotApprove:"A IA não pode assinar nem aprovar."},
  ru:{welcome:"ДОБРО ПОЖАЛОВАТЬ · САМОСТОЯТЕЛЬНОЕ ХРАНЕНИЕ",ownAccount:"Управляйте своим аккаунтом.",recoverReplacement:"Восстановить на новом устройстве",beforeBegin:"Перед началом",walletLocked:"WALLET ЗАБЛОКИРОВАН",checkingBiometrics:"Проверка биометрии…",lostDeviceRecovery:"Восстановление при потере устройства",nativeAccount:"НАТИВНЫЙ АККАУНТ",send:"Отправить",receive:"Получить",activity:"Активность",accountSafety:"Безопасность аккаунта",lockWallet:"Заблокировать Wallet",createAnother:"Создать другой аккаунт",importAnother:"Импортировать ключ восстановления",authorizationLead:"Проверьте каждую привязку. Разрешение передает только публичное подтверждение аккаунта.",aiSecurity:"Объяснение безопасности ИИ",aiCannotApprove:"ИИ не может подписывать или разрешать."},
  ar:{welcome:"مرحبًا · الحفظ الذاتي يبدأ هنا",ownAccount:"امتلك التحكم في حسابك.",recoverReplacement:"الاسترداد على جهاز بديل",beforeBegin:"قبل البدء",walletLocked:"المحفظة مقفلة",checkingBiometrics:"جارٍ التحقق من المقاييس الحيوية…",lostDeviceRecovery:"استرداد الجهاز المفقود",nativeAccount:"الحساب الأصلي",send:"إرسال",receive:"استلام",activity:"النشاط",accountSafety:"أمان الحساب",lockWallet:"قفل المحفظة",createAnother:"إنشاء حساب آخر",importAnother:"استيراد مفتاح الاسترداد",authorizationLead:"راجع كل ارتباط. لا تشارك الموافقة سوى إثبات حساب عام.",aiSecurity:"شرح أمان بالذكاء الاصطناعي",aiCannotApprove:"لا يمكن للذكاء الاصطناعي التوقيع أو الموافقة."},
  id:{welcome:"SELAMAT DATANG · SWAKUSTODI DIMULAI DI SINI",ownAccount:"Kendalikan akun Anda.",recoverReplacement:"Pulihkan di perangkat pengganti",beforeBegin:"Sebelum memulai",walletLocked:"WALLET TERKUNCI",checkingBiometrics:"Memeriksa biometrik…",lostDeviceRecovery:"Pemulihan perangkat hilang",nativeAccount:"AKUN NATIF",send:"Kirim",receive:"Terima",activity:"Aktivitas",accountSafety:"Keamanan akun",lockWallet:"Kunci Wallet",createAnother:"Buat akun lain",importAnother:"Impor kunci pemulihan",authorizationLead:"Tinjau setiap ikatan. Persetujuan hanya membagikan bukti akun publik.",aiSecurity:"Penjelasan keamanan AI",aiCannotApprove:"AI tidak dapat menandatangani atau menyetujui."},
};

export function translate(locale:WalletLocale,key:MessageKey):string{return key in UI_MESSAGES[locale]?UI_MESSAGES[locale][key as UIMessageKey]:MESSAGES[locale][key as BaseMessageKey]}
export function isRTL(locale:WalletLocale):boolean{return locale==="ar"}
export function detectLocale(systemLocale:string|undefined):WalletLocale{const normalized=(systemLocale??"").replace("_","-").toLowerCase();if(normalized.startsWith("zh-hant")||normalized.includes("-tw")||normalized.includes("-hk"))return"zh-Hant";if(normalized.startsWith("zh"))return"zh-Hans";return SUPPORTED_LOCALES.find((item)=>normalized===item.toLowerCase()||normalized.startsWith(`${item.toLowerCase()}-`))??"en"}
export async function loadLocale(storage:SecureStorageAdapter,systemLocale=Intl.DateTimeFormat().resolvedOptions().locale):Promise<WalletLocale>{const saved=await storage.getItem(LOCALE_PREFERENCE_KEY);return saved!==null&&SUPPORTED_LOCALES.includes(saved as WalletLocale)?saved as WalletLocale:detectLocale(systemLocale)}
export async function saveLocale(storage:SecureStorageAdapter,locale:WalletLocale):Promise<void>{if(!SUPPORTED_LOCALES.includes(locale))throw new Error("Unsupported Wallet locale");await storage.setItem(LOCALE_PREFERENCE_KEY,locale)}
export function formatDateTime(locale:WalletLocale,value:string|Date):string{return new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"}).format(new Date(value))}
export function formatNumber(locale:WalletLocale,value:number):string{return new Intl.NumberFormat(locale,{maximumFractionDigits:8}).format(value)}
export function formatYNXT(locale:WalletLocale,value:number):string{return `${formatNumber(locale,value)} YNXT`}
export function plural(locale:WalletLocale,count:number,forms:{one:string;other:string}):string{return new Intl.PluralRules(locale).select(count)==="one"?forms.one:forms.other}
export function allMessages():Readonly<Record<WalletLocale,Readonly<Record<MessageKey,string>>>>{return Object.fromEntries(SUPPORTED_LOCALES.map((locale)=>[locale,{...MESSAGES[locale],...UI_MESSAGES[locale]}])) as Record<WalletLocale,Record<MessageKey,string>>}
export function localizeError(locale:WalletLocale,value:unknown):string{const detail=value instanceof Error?value.message:String(value);return `${translate(locale,"errorPrefix")}: ${detail}`}

const PRODUCT_AUTH_CANCELLED:Readonly<Record<WalletLocale,string>>={
  en:"Authentication cancelled. Review this request and tap Approve to try again.",
  "zh-Hans":"已取消身份验证。检查此请求后，点击“批准”重试。",
  "zh-Hant":"已取消身分驗證。檢查此要求後，點選「核准」重試。",
  ja:"認証をキャンセルしました。このリクエストを確認し、「承認」で再試行してください。",
  ko:"인증이 취소되었습니다. 이 요청을 확인한 뒤 승인을 눌러 다시 시도하세요.",
  es:"Autenticación cancelada. Revisa esta solicitud y toca Aprobar para intentarlo de nuevo.",
  fr:"Authentification annulée. Vérifiez cette demande et appuyez sur Approuver pour réessayer.",
  de:"Authentifizierung abgebrochen. Prüfe diese Anfrage und tippe auf Genehmigen, um es erneut zu versuchen.",
  pt:"Autenticação cancelada. Revise esta solicitação e toque em Aprovar para tentar novamente.",
  ru:"Проверка личности отменена. Проверьте этот запрос и нажмите «Разрешить», чтобы повторить попытку.",
  ar:"تم إلغاء التحقق من الهوية. راجع هذا الطلب واضغط على «موافقة» للمحاولة مجددًا.",
  id:"Autentikasi dibatalkan. Tinjau permintaan ini lalu ketuk Setujui untuk mencoba lagi.",
};

/** Presentation only: the controller remains authoritative for replay and retry.
 * Match the pinned native cancellation reasons, not generic cancelled/expired
 * errors that may occur after a request was consumed or its return was signed. */
export function localizeProductSessionError(locale:WalletLocale,value:unknown,action:"approve"|"reject"|"retryReturn",hasSignedReturn:boolean):string {
  if(action!=="approve"||hasSignedReturn||!(value instanceof Error))return localizeError(locale,value);
  const detail=value.message;
  const legacyCancelled=detail==="Biometric authorization was cancelled";
  const nativeReason=detail
    .replace(/^Call to function 'ExpoSecureStore\.(?:getValueWithKeyAsync|setValueWithKeyAsync)' has been rejected\.\s*→ Caused by: /,"")
    .replace(/^Calling the '(?:getValueWithKeyAsync|setValueWithKeyAsync)' function has failed\s*→ Caused by: /,"");
  const nativeCancelled=/^Could not Authenticate the user: User canceled the authentication(?:\.|$)/.test(nativeReason)||
    (nativeReason==="User canceled the operation."&&nativeReason!==detail);
  return legacyCancelled||nativeCancelled?PRODUCT_AUTH_CANCELLED[locale]:localizeError(locale,value);
}

// Expanded account/session UI coverage is currently translated for these two
// locales. Other locales retain their existing English fallback explicitly.
const DETAIL_MESSAGES={
  "Paste address or receiving link":["粘贴地址或收款链接","لصق العنوان أو رابط الاستلام"],
  "Reading clipboard…":["正在读取剪贴板…","جارٍ قراءة الحافظة…"],
  "Copy a receiving link from a QR code, then paste it here.":["复制收款二维码中的链接，然后粘贴到这里。","انسخ رابط الاستلام من رمز QR ثم الصقه هنا."],
  "Recipient added. Enter an amount and review the transfer.":["已填入收款地址。请输入金额并检查转账信息。","أُضيف عنوان المستلم. أدخل المبلغ ثم راجع التحويل."],
  "Use a valid native ynx1 address or YNX Testnet receiving link.":["请使用有效的原生 ynx1 地址或 YNX 测试网收款链接。","استخدم عنوان ynx1 أصليًا صالحًا أو رابط استلام لشبكة YNX التجريبية."],
  "This receiving link is for a different network or asset.":["此收款链接使用了其他网络或资产。","رابط الاستلام هذا لشبكة أو أصل مختلف."],
  "Clipboard could not be read. Paste the native address manually.":["无法读取剪贴板。请手动粘贴原生地址。","تعذرت قراءة الحافظة. الصق العنوان الأصلي يدويًا."],
  "Recipient ynx1 address":["收款人的 ynx1 地址","عنوان المستلم ynx1"],
  "Whole YNXT amount":["YNXT 整数金额","مبلغ YNXT بعدد صحيح"],
  "Review transfer":["检查转账","مراجعة التحويل"],
  "This account is already stored in Wallet":["此账户已保存在钱包中","هذا الحساب محفوظ في المحفظة بالفعل"],
  "Confirm below to restore key protection for this exact existing account. Its label, account list and app sessions will not be replaced.":["请在下方确认，为此已有账户恢复密钥保护。其名称、账户列表和应用会话不会被替换。","أكد أدناه لاستعادة حماية المفتاح لهذا الحساب الموجود تحديدًا. لن يُستبدل اسمه أو قائمة الحسابات أو جلسات التطبيقات."],
  "Ordinary import cannot replace this account's protected key. Open account recovery and enter the offline key again to review an explicit restoration.":["普通导入不能替换此账户的受保护密钥。请打开账户恢复，重新输入离线密钥，检查并确认恢复操作。","لا يمكن للاستيراد العادي استبدال المفتاح المحمي لهذا الحساب. افتح استرداد الحساب وأدخل المفتاح المحفوظ دون اتصال مجددًا لمراجعة الاسترداد وتأكيده."],
  "Restore key protection for this existing account":["恢复此已有账户的密钥保护","استعادة حماية المفتاح لهذا الحساب الموجود"],
  "Open account recovery":["打开账户恢复","فتح استرداد الحساب"],
  "Key protection needs recovery":["需要恢复密钥保护","يجب استرداد حماية المفتاح"],
  "Your public account is still stored. Restore its protected key with the matching offline recovery key. App sessions are not restored or revoked by this action.":["你的公开账户仍保存在钱包中。请使用匹配的离线恢复密钥，恢复受保护的密钥。此操作不会恢复或撤销应用会话。","لا يزال حسابك العام محفوظًا. استعد مفتاحه المحمي باستخدام مفتاح الاسترداد المطابق المحفوظ دون اتصال. لا يستعيد هذا الإجراء جلسات التطبيقات ولا يلغيها."],
  "This account's protected key is unavailable or biometric enrollment changed. Restore it with its offline recovery key; the public account has been retained.":["此账户的受保护密钥不可用，或生物识别登记已更改。请使用其离线恢复密钥恢复；公开账户已保留。","المفتاح المحمي لهذا الحساب غير متاح أو تغيّر تسجيل المقاييس الحيوية. استعده بمفتاح الاسترداد المحفوظ دون اتصال؛ لقد تم الاحتفاظ بالحساب العام."],
  "Recover Wallet":["恢复钱包","استرداد المحفظة"],
  "Import account":["导入账户","استيراد حساب"],
  "Imported account":["导入的账户","الحساب المستورد"],
  "Replacement-device recovery restores only the native account. Connected Apps, sessions, device approvals and audit history must be re-created.":["在替换设备上恢复时，仅恢复原生账户。应用连接、会话、设备授权和审计历史需要重新建立。","يستعيد الاسترداد على جهاز بديل الحساب الأصلي فقط. يجب إنشاء اتصالات التطبيقات والجلسات وموافقات الأجهزة وسجل التدقيق من جديد."],
  "Enter a 64-character YNX recovery key. Import requires system biometrics and does not restore product device sessions.":["输入 64 个字符的 YNX 恢复密钥。导入需要系统生物识别，不会恢复产品的设备会话。","أدخل مفتاح استرداد YNX المكوّن من 64 حرفًا. يتطلب الاستيراد المقاييس الحيوية للنظام ولا يستعيد جلسات أجهزة المنتجات."],
  "Account label":["账户名称","اسم الحساب"],
  "Recovery key":["恢复密钥","مفتاح الاسترداد"],
  "Recover into secure storage":["恢复到安全存储","الاسترداد إلى التخزين الآمن"],
  "Import into secure storage":["导入到安全存储","الاستيراد إلى التخزين الآمن"],
  "Close and reopen Wallet":["完全关闭并重新打开钱包","أغلق المحفظة تمامًا ثم أعد فتحها"],
  "Wallet could not confirm a secure storage write. Open system app settings, force stop Wallet, then reopen it to check the saved account state.":["钱包无法确认安全存储是否写入成功。请打开系统应用设置，强行停止钱包，再重新打开，检查已保存的账户状态。","تعذر على المحفظة تأكيد الكتابة إلى التخزين الآمن. افتح إعدادات التطبيق في النظام، وأوقف المحفظة إجباريًا، ثم أعد فتحها للتحقق من حالة الحساب المحفوظة."],
  "Open system app settings":["打开系统应用设置","فتح إعدادات التطبيق في النظام"],
  "Open Settings, choose Apps, then YNX Wallet and Force stop. Reopen Wallet afterward.":["请打开系统设置，依次选择“应用”“YNX Wallet”和“强行停止”，然后重新打开钱包。","افتح الإعدادات، ثم التطبيقات، ثم YNX Wallet واختر الإيقاف الإجباري. أعد فتح المحفظة بعد ذلك."],
  "Wallet could not confirm a secure storage write. Fully close the app from recent apps, then reopen it to check the saved account state.":["钱包无法确认安全存储是否写入成功。请从最近使用的应用中完全关闭钱包，再重新打开，检查已保存的账户状态。","تعذر على المحفظة تأكيد الكتابة إلى التخزين الآمن. أغلق التطبيق تمامًا من التطبيقات الأخيرة، ثم أعد فتحه للتحقق من حالة الحساب المحفوظة."],
  "Do not clear app data or reinstall. Keep your offline recovery key. The last change may not have been saved.":["请勿清除应用数据或重新安装。请保管好离线恢复密钥；最后一次更改可能尚未保存。","لا تمسح بيانات التطبيق ولا تعِد تثبيته. احتفظ بمفتاح الاسترداد دون اتصال؛ ربما لم يُحفظ التغيير الأخير."],
  "Wallet Center":["钱包中心","مركز المحفظة"],
  "ASSETS / ACTIVITY":["资产 / 活动","الأصول / النشاط"],
  "YNXT · loading":["YNXT · 加载中","YNXT · جارٍ التحميل"],
  "YNXT · no account record":["YNXT · 暂无账户记录","YNXT · لا يوجد سجل للحساب"],
  "YNXT · unavailable":["YNXT · 暂不可用","YNXT · غير متاح"],
  "Loading balance and nonce…":["正在加载余额和交易序号…","جارٍ تحميل الرصيد ورقم المعاملة…"],
  "This address has no on-chain account record yet. Receive testnet YNXT to get started. Balance and nonce are not available yet.":["此地址尚无链上账户记录。接收测试网 YNXT 后即可开始使用。目前无法确认余额和交易序号。","لا يوجد سجل على السلسلة لهذا العنوان بعد. استلم YNXT على شبكة الاختبار للبدء. الرصيد ورقم المعاملة غير متاحين بعد."],
  "Balance unavailable":["余额暂不可用","الرصيد غير متاح"],
  "Authoritative nonce {nonce} on ynx_6423-1.":["ynx_6423-1 已确认的交易序号：{nonce}。","رقم المعاملة المؤكد على ynx_6423-1: {nonce}."],
  "Activity · loading":["活动 · 加载中","النشاط · جارٍ التحميل"],
  "Loading recent chain transactions…":["正在加载最近的链上交易…","جارٍ تحميل المعاملات الأخيرة على السلسلة…"],
  "Activity · unavailable":["活动 · 暂不可用","النشاط · غير متاح"],
  "Recent transactions could not be loaded.":["无法加载最近的交易。","تعذر تحميل المعاملات الأخيرة."],
  "Activity · empty":["活动 · 暂无记录","النشاط · لا توجد سجلات"],
  "No matching account activity appears in the latest 25 chain transactions.":["最近 25 笔链上交易中没有此账户的活动记录。","لا يظهر نشاط لهذا الحساب ضمن آخر 25 معاملة على السلسلة."],
  "Received":["已接收","مستلم"],
  "Sent":["已发送","مرسل"],
  "fee {fee} · nonce {nonce}":["费用 {fee} · 交易序号 {nonce}","الرسوم {fee} · رقم المعاملة {nonce}"],
  "Refresh balance and activity":["刷新余额和活动","تحديث الرصيد والنشاط"],
  "Open Authorization Audit":["打开授权审计","فتح سجل التفويض"],
  "RECOVERY / SECURITY / NETWORK":["恢复 / 安全 / 网络","الاسترداد / الأمان / الشبكة"],
  "Recovery":["账户恢复","الاسترداد"],
  "Your offline key restores this account. Each app still needs its own sign-in approval. You can review existing app sessions above.":["离线密钥可恢复此账户。每个应用仍需单独批准登录。你可以在上方查看现有应用会话。","يستعيد مفتاحك المحفوظ دون اتصال هذا الحساب. لا يزال كل تطبيق بحاجة إلى موافقة تسجيل دخول مستقلة. يمكنك مراجعة جلسات التطبيقات الحالية أعلاه."],
  "Security":["安全","الأمان"],
  "Wallet locks in the background. Viewing app sessions, revoking a session and using a private key each require system biometrics.":["钱包进入后台时会锁定。查看应用会话、撤销会话和使用私钥均需要系统生物识别。","تُقفل المحفظة في الخلفية. يتطلب عرض جلسات التطبيقات وإلغاء جلسة واستخدام مفتاح خاص المقاييس الحيوية للنظام في كل مرة."],
  "YNX testnet · ynx_6423-1 · native YNXT · rpc.ynxweb4.com. EVM chain ID 6423 is available in the compatibility view.":["YNX 测试网 · ynx_6423-1 · 原生 YNXT · rpc.ynxweb4.com。EVM 兼容视图使用链 ID 6423。","شبكة اختبار YNX · ynx_6423-1 · YNXT الأصلي · rpc.ynxweb4.com. يتوفر معرّف سلسلة EVM رقم 6423 في عرض التوافق."],
  "CONNECTED APPS / SESSIONS / DEVICES":["已连接应用 / 会话 / 设备","التطبيقات المتصلة / الجلسات / الأجهزة"],
  "Connected Apps, Sessions and Devices":["已连接应用、会话和设备","التطبيقات المتصلة والجلسات والأجهزة"],
  "Wallet account":["钱包账户","حساب المحفظة"],
  "Session revoked":["会话已撤销","تم إلغاء الجلسة"],
  "Review session revocation":["确认要撤销的会话","مراجعة إلغاء الجلسة"],
  "App":["应用","التطبيق"],
  "Device":["设备","الجهاز"],
  "Session":["会话","الجلسة"],
  "Issued / expires":["创建 / 到期时间","تاريخ الإنشاء / الانتهاء"],
  "Auth confirmed this session was already revoked":["Auth 已确认此会话此前已撤销","أكد Auth أن هذه الجلسة أُلغيت سابقًا"],
  "Auth confirmed revocation":["Auth 已确认撤销","أكد Auth الإلغاء"],
  "Confirmed at {asOf}. This session can no longer authorize app requests. Other sessions keep their own status.":["确认时间：{asOf}。此会话无法再授权应用请求。其他会话的状态保持独立。","تم التأكيد في {asOf}. لم يعد بإمكان هذه الجلسة تفويض طلبات التطبيق. تحتفظ الجلسات الأخرى بحالتها المستقلة."],
  "Revoke this app session":["撤销此应用会话","إلغاء جلسة هذا التطبيق"],
  "After your biometric confirmation, Wallet will sign a request to revoke only the session shown above. Other app sessions and your assets are unaffected.":["通过生物识别确认后，钱包将签署请求，仅撤销上方显示的会话。其他应用会话和你的资产不受影响。","بعد التأكيد بالمقاييس الحيوية، ستوقّع المحفظة طلبًا لإلغاء الجلسة المعروضة أعلاه فقط. لن تتأثر جلسات التطبيقات الأخرى أو أصولك."],
  "Revocation is not confirmed. Retry this same session to check the outcome.":["撤销尚未确认。请对同一会话重试，以确认结果。","لم يتم تأكيد الإلغاء. أعد المحاولة للجلسة نفسها للتحقق من النتيجة."],
  "Confirming with Auth…":["正在等待 Auth 确认…","جارٍ التأكيد مع Auth…"],
  "Retry this session revocation":["重试撤销此会话","إعادة محاولة إلغاء هذه الجلسة"],
  "Confirm session revocation":["确认撤销会话","تأكيد إلغاء الجلسة"],
  "Back to Connected Apps":["返回已连接应用","العودة إلى التطبيقات المتصلة"],
  "View your connected apps":["查看已连接的应用","عرض تطبيقاتك المتصلة"],
  "Use your fingerprint or Face ID to let Wallet sign a request for this account's app sessions. This does not grant any app permission to use your assets.":["使用指纹或面容 ID，让钱包签署此账户的应用会话查询请求。这不会授予任何应用使用你资产的权限。","استخدم بصمتك أو Face ID للسماح للمحفظة بتوقيع طلب لعرض جلسات تطبيقات هذا الحساب. لا يمنح ذلك أي تطبيق إذنًا لاستخدام أصولك."],
  "Connected Apps · loading":["已连接应用 · 加载中","التطبيقات المتصلة · جارٍ التحميل"],
  "Confirm system biometrics, then wait for Auth to return this account's sessions.":["完成系统生物识别后，请等待 Auth 返回此账户的会话。","أكد المقاييس الحيوية للنظام، ثم انتظر أن يعيد Auth جلسات هذا الحساب."],
  "Connected Apps · unavailable":["已连接应用 · 暂不可用","التطبيقات المتصلة · غير متاحة"],
  "Auth could not confirm your sessions. Try again.":["Auth 无法确认你的会话，请重试。","تعذر على Auth تأكيد جلساتك. أعد المحاولة."],
  "Last checked with Auth":["上次经 Auth 确认","آخر تحقق مع Auth"],
  "{count} sessions · {devices} app devices":["会话：{count} · 应用设备：{devices}","الجلسات: {count} · أجهزة التطبيقات: {devices}"],
  "No connected app sessions":["暂无已连接的应用会话","لا توجد جلسات تطبيقات متصلة"],
  "Auth returned no app sessions for this account at the time shown above.":["在上方所示时间，Auth 返回此账户没有应用会话。","لم يُرجع Auth أي جلسات تطبيقات لهذا الحساب في الوقت الموضح أعلاه."],
  "Active at last check":["上次确认时有效","نشطة عند آخر تحقق"],
  "Inactive at last check":["上次确认时无效","غير نشطة عند آخر تحقق"],
  "Expires {expiresAt}":["到期时间：{expiresAt}","تنتهي في {expiresAt}"],
  "Review {name} session":["查看 {name} 的会话","مراجعة جلسة {name}"],
  "Loading Connected Apps…":["正在加载已连接应用…","جارٍ تحميل التطبيقات المتصلة…"],
  "Retry Connected Apps":["重试加载已连接应用","إعادة محاولة تحميل التطبيقات المتصلة"],
  "Refresh Connected Apps":["刷新已连接应用","تحديث التطبيقات المتصلة"],
  "Show Connected Apps":["查看已连接应用","إظهار التطبيقات المتصلة"],
  "Device revoked":["设备已撤销","تم إلغاء الجهاز"],
  "Device sessions signed out":["设备会话已退出","تم تسجيل الخروج من جلسات الجهاز"],
  "Account access revoked":["账户访问已撤销","تم إلغاء الوصول إلى الحساب"],
  "Expired":["已到期","منتهية الصلاحية"],
  "Not yet active":["尚未生效","لم تصبح نشطة بعد"],
  "System language is detected on first launch. A manual choice is stored locally and survives restart.":["首次启动时会检测系统语言。手动选择会保存在此设备上，重启后仍然有效。","تُكتشف لغة النظام عند التشغيل لأول مرة. يُحفظ الاختيار اليدوي محليًا ويبقى بعد إعادة التشغيل."],
  "Text follows the device font scale.":["文字大小跟随设备字体设置。","يتبع حجم النص إعداد حجم الخط في الجهاز."],
  "High contrast":["高对比度","تباين مرتفع"],
  "System contrast":["系统对比度","تباين النظام"],
  "reduced motion":["减少动态效果","حركة مخفضة"],
  "standard motion":["标准动态效果","حركة قياسية"],
  "dark appearance":["深色外观","مظهر داكن"],
  "light appearance":["浅色外观","مظهر فاتح"],
  "Klein blue and white appearance":["克莱因蓝与白色外观","مظهر أزرق كلاين وأبيض"],
  "Accessibility state":["辅助功能状态","حالة إمكانية الوصول"],
  "Biometric authorization was cancelled":["已取消生物识别授权","أُلغي التفويض بالمقاييس الحيوية"],
  "Biometric authorization failed":["生物识别授权失败","فشل التفويض بالمقاييس الحيوية"],
  "Auth timed out. Review and retry when it is available.":["Auth 请求超时。请在服务可用时检查并重试。","انتهت مهلة طلب Auth. راجع الطلب وأعد المحاولة عندما تتاح الخدمة."],
  "Auth is unavailable. Check your connection and retry.":["Auth 暂不可用。请检查网络连接后重试。","Auth غير متاح. تحقق من اتصالك وأعد المحاولة."],
  "The Auth response was interrupted. Retry to obtain a confirmed result.":["Auth 响应中断。请重试以获取已确认的结果。","انقطعت استجابة Auth. أعد المحاولة للحصول على نتيجة مؤكدة."],
  "Auth has not confirmed the outcome. This session may still be connected. Retry this same session to confirm its revocation.":["Auth 尚未确认结果，此会话可能仍处于连接状态。请对同一会话重试，以确认撤销结果。","لم يؤكد Auth النتيجة بعد. قد تظل هذه الجلسة متصلة. أعد المحاولة للجلسة نفسها لتأكيد إلغائها."],
  "Auth could not complete the request ({code}). Review and retry.":["Auth 无法完成请求（{code}）。请检查后重试。","تعذر على Auth إكمال الطلب ({code}). راجع الطلب وأعد المحاولة."],
  "Check transaction status":["检查交易状态", "التحقق من حالة المعاملة"],
  "This mined transfer is covered by the node’s verified local snapshot checkpoint. This is not a consensus finality claim. Done acknowledges this result before another transfer can be signed.":["这笔已入块转账已纳入经核验的节点本地快照检查点。这不代表共识最终确认。点击“完成”确认结果后才可签署另一笔转账。", "هذا التحويل المُدرج في كتلة مشمول بنقطة تحقق موثقة للقطة المحلية للعقدة. لا يعني ذلك نهائية الإجماع. اضغط «تم» للإقرار بالنتيجة قبل توقيع تحويل آخر."],
  "Awaiting a mined block":["等待入块确认", "بانتظار الإدراج في كتلة"],
  "The node has saved the pending transfer locally. It has not confirmed mined inclusion. Keep this transaction and check again.":["节点已在本地保存待处理转账，但尚未确认入块。请保留这笔交易并再次检查。", "حفظت العقدة التحويل المعلق محليًا، لكنها لم تؤكد إدراجه في كتلة. احتفظ بهذه المعاملة وتحقق مجددًا."],
  "Local durability unavailable":["本地持久确认不可用", "تأكيد الحفظ المحلي غير متاح"],
  "This node only reports memory state. The original transfer remains unconfirmed and stored.":["此节点仅报告内存状态。原交易仍未确认并继续保留。", "تعرض هذه العقدة حالة الذاكرة فقط. تبقى المعاملة الأصلية محفوظة وغير مؤكدة."],
  "Transaction not observed by this node":["此节点未观察到交易", "لم ترصد هذه العقدة المعاملة"],
  "Not found does not prove rejection or allow a replacement transaction. Keep the original and check again.":["未找到不代表交易被拒绝，也不能据此创建替代交易。请保留原交易并再次检查。", "عدم العثور على المعاملة لا يثبت رفضها ولا يسمح باستبدالها. احتفظ بالأصل وتحقق مجددًا."],
  "Durability capability unavailable":["持久确认能力不可用", "قدرة تأكيد الحفظ غير متاحة"],
  "This node does not provide the required versioned durability capability. The original transfer stays unconfirmed.":["此节点不提供所需版本的持久确认能力。原交易继续保持未确认状态。", "لا توفر هذه العقدة الإصدار المطلوب من قدرة تأكيد الحفظ. تبقى المعاملة الأصلية غير مؤكدة."],
  "Review stored transfer":["查看已存转账", "مراجعة التحويل المحفوظ"],
  "Reload stored transfer":["重新读取已存转账", "إعادة تحميل التحويل المحفوظ"],
  "Transfer durably confirmed":["转账已确认持久保存", "تم تأكيد حفظ التحويل بشكل دائم"],
  "Stored transfer needs confirmation":["已存转账等待确认", "التحويل المحفوظ يحتاج إلى تأكيد"],
  "Checking the stored transfer before allowing a new signature.":["正在检查已存转账，确认后才允许新的签名。", "جارٍ التحقق من التحويل المحفوظ قبل السماح بتوقيع جديد."],
  "The matching transaction has a verified durable confirmation. Done acknowledges this result before another transfer can be signed.":["已核验此交易的持久确认凭据。点击“完成”确认结果后，才可签署另一笔转账。", "تم التحقق من التأكيد الدائم لهذه المعاملة. اضغط «تم» للإقرار بالنتيجة قبل توقيع تحويل آخر."],
  "The node reported this exact transfer as accepted. Durable confirmation is still unavailable. Keep this original transaction; do not create a replacement.":["节点已报告接收这笔确切转账，但尚无可核验的持久确认。请保留原交易，不要创建替代交易。", "أبلغت العقدة عن قبول هذا التحويل بعينه. التأكيد الدائم غير متاح بعد. احتفظ بالمعاملة الأصلية ولا تنشئ بديلة."],
  "The signed transfer was saved before sending. Closing Wallet preserves it. Review and authorize sending these same bytes.":["已在发送前保存签名后的转账，关闭钱包仍会保留。请查看并授权发送这份原始交易。", "حُفظ التحويل الموقّع قبل الإرسال، وسيبقى محفوظًا عند إغلاق المحفظة. راجع وأذن بإرسال البيانات الأصلية نفسها."],
  "This transfer may already have reached the node. Its outcome is not durably confirmed. Closing or restarting Wallet preserves the original transaction.":["这笔转账可能已到达节点，其结果尚未得到持久确认。关闭或重启钱包都会保留原交易。", "قد يكون هذا التحويل قد وصل إلى العقدة. لم تُؤكد نتيجته بشكل دائم. يبقى محفوظًا عند إغلاق المحفظة أو إعادة تشغيلها."],
  "Retry the original transaction":["重试原交易", "إعادة محاولة المعاملة الأصلية"],
  "After system biometric confirmation, Wallet resends only the stored signed request. It does not sign again or change its amount, recipient or nonce.":["通过系统生物识别后，钱包仅重发已保存的签名请求，不会重新签名，也不会修改金额、收款人或序号。", "بعد التأكيد بالمقاييس الحيوية للنظام، تعيد المحفظة إرسال الطلب الموقّع المحفوظ فقط، دون توقيع جديد أو تغيير المبلغ أو المستلم أو الرقم المتسلسل."],
  "Waiting for the original transaction…":["正在等待原交易结果…", "جارٍ انتظار نتيجة المعاملة الأصلية…"],
  "Authorize and resend original transaction":["授权并重发原交易", "تفويض وإعادة إرسال المعاملة الأصلية"],
  "Close and keep transfer":["关闭并保留转账", "إغلاق مع الاحتفاظ بالتحويل"],
  "The result could not be verified. Review and retry.":["无法验证结果。请检查后重试。","تعذر التحقق من النتيجة. راجع الطلب وأعد المحاولة."],
  // Dashboard copy keeps unknown chain state and sensitive action labels explicit.
  "Switch Wallet account":["切换钱包账户","تبديل حساب المحفظة"],
  "Native asset · authoritative testnet":["原生资产 · 测试网权威数据","الأصل الأصلي · بيانات شبكة الاختبار المعتمدة"],
  "Sending becomes available after balance and nonce are confirmed.":["确认余额和交易序号后才可发送。","يتاح الإرسال بعد تأكيد الرصيد ورقم المعاملة."],
  "Nonce {nonce}":["交易序号 {nonce}","رقم المعاملة {nonce}"],
  "{count} matching transactions in the latest 25 chain transactions":["最近 25 笔链上交易中有 {count} 笔属于此账户","عدد المعاملات المطابقة لهذا الحساب ضمن أحدث 25 معاملة على السلسلة: {count}"],
  "Offline backup confirmed. System biometrics protect unlock, authorization, recovery viewing and deletion.":["已确认离线备份。系统生物识别保护解锁、授权、查看恢复密钥和删除账户。","تم تأكيد النسخة الاحتياطية المحفوظة دون اتصال. تحمي المقاييس الحيوية للنظام فتح القفل والتفويض وعرض مفتاح الاسترداد وحذف الحساب."],
  "Backup is not confirmed. Do not receive assets until the recovery key is stored offline.":["备份尚未确认。请离线保存恢复密钥，在此之前不要接收资产。","لم تُؤكَّد النسخة الاحتياطية. لا تستلم أصولًا قبل حفظ مفتاح الاسترداد دون اتصال."],
  "Copy native ynx1 address":["复制原生 ynx1 地址","نسخ عنوان ynx1 الأصلي"],
  "Native ynx1 address copied":["已复制原生 ynx1 地址","نُسخ عنوان ynx1 الأصلي"],
  "Rename account":["重命名账户","إعادة تسمية الحساب"],
  "View offline recovery key":["查看离线恢复密钥","عرض مفتاح الاسترداد المحفوظ دون اتصال"],
  "0x EVM compatibility and contract simulation":["0x EVM 兼容与合约模拟","توافق 0x EVM ومحاكاة العقود"],
  // Faucet request/receipt facts remain separate from balance or consensus finality.
  "Test YNXT":["测试 YNXT","YNXT التجريبي"],
  "Test YNXT requests are not available in this version.":["此版本暂未开放测试 YNXT 请求。","طلبات YNXT التجريبية غير متاحة في هذا الإصدار."],
  "View saved request":["查看已存请求","عرض الطلب المحفوظ"],
  "Reading saved request…":["正在读取已存请求…","جارٍ قراءة الطلب المحفوظ…"],
  "Saved request unavailable. Sending is paused.":["无法读取已存请求。发送已暂停。","تعذرت قراءة الطلب المحفوظ. تم إيقاف الإرسال مؤقتًا."],
  "Review test YNXT request":["检查测试 YNXT 请求","مراجعة طلب YNXT التجريبي"],
  "Recipient account":["收款账户","حساب المستلم"],
  "Requested amount":["请求数量","المبلغ المطلوب"],
  "Not sent":["未发送","لم يُرسل"],
  "Submit this request":["提交这笔请求","إرسال هذا الطلب"],
  "Sending this request…":["正在提交这笔请求…","جارٍ إرسال هذا الطلب…"],
  "Result not confirmed":["结果待确认","لم تُؤكَّد النتيجة"],
  "This request may already have been processed. Keep its original ID and amount.":["此请求可能已被处理。请保留原请求编号和数量。","ربما تمت معالجة هذا الطلب بالفعل. احتفظ بمعرّفه ومبلغه الأصليين."],
  "Review and retry original request":["检查并重试原请求","مراجعة الطلب الأصلي وإعادة المحاولة"],
  "Too many requests. Retry the original request manually later.":["请求过于频繁。请稍后手动重试原请求。","طلبات كثيرة جدًا. أعد محاولة الطلب الأصلي يدويًا لاحقًا."],
  "Request received":["已接收请求","تم استلام الطلب"],
  "The request was received. Your balance has not been verified.":["请求已被接收，余额尚未核对。","تم استلام الطلب. لم يتم التحقق من رصيدك بعد."],
  "Check block receipt":["核对区块收据","التحقق من إيصال الكتلة"],
  "Saved receipt copy — check again":["保存的收据副本，请重新核对","نسخة محفوظة من الإيصال — تحقّق مجددًا"],
  "The node saved the pending request. No block receipt has been verified yet.":["节点已保存待处理请求，尚未核对到区块收据。","حفظت العقدة الطلب المعلّق. لم يُتحقق من إيصال الكتلة بعد."],
  "Block receipt checked":["区块收据已核对","تم التحقق من إيصال الكتلة"],
  "The node's local snapshot covers this transaction. Balance and consensus finality have not been verified.":["节点的本地快照涵盖此交易；余额和共识最终性尚未核验。","تشمل اللقطة المحلية للعقدة هذه المعاملة. لم يُتحقق من الرصيد أو نهائية الإجماع."],
  "Confirm receipt reviewed":["确认已查看收据","تأكيد مراجعة الإيصال"],
  "Close and keep request":["关闭并保留请求","إغلاق مع الاحتفاظ بالطلب"],
  "The original request does not match the service record. Keep it for review.":["原请求与服务记录不一致，请保留以便核查。","لا يطابق الطلب الأصلي سجل الخدمة. احتفظ به للمراجعة."],
  "The service cannot verify the original receipt yet. Keep this request.":["服务暂时无法核对原收据，请保留此请求。","لا تستطيع الخدمة التحقق من الإيصال الأصلي بعد. احتفظ بهذا الطلب."],
  "Request ID":["请求编号","معرّف الطلب"],
  "Transaction hash":["交易哈希","تجزئة المعاملة"],
  "Request nonce":["请求序号","الرقم المتسلسل للطلب"],
  "Block number":["区块高度","رقم الكتلة"],
  "Block hash":["区块哈希","تجزئة الكتلة"],
  "Snapshot block number":["快照区块高度","رقم كتلة اللقطة"],
  "Snapshot block hash":["快照区块哈希","تجزئة كتلة اللقطة"],
  "Snapshot integrity":["快照完整性校验值","بصمة سلامة اللقطة"],
  "RPC origin":["RPC 来源","مصدر RPC"],
  "Receipt details":["收据详情","تفاصيل الإيصال"],
  "No saved request":["没有已存请求","لا يوجد طلب محفوظ"],
  "Request amount will be shown when this service becomes available.":["服务可用后将显示请求数量。","سيظهر المبلغ المطلوب عندما تصبح هذه الخدمة متاحة."],
  "Receipt review saved.":["已保存收据查看记录。","تم حفظ سجل مراجعة الإيصال."],
  "This is a testnet request. Test YNXT has no monetary value.":["这是测试网请求。测试 YNXT 没有货币价值。","هذا طلب على شبكة الاختبار. لا توجد قيمة مالية لعملات YNXT التجريبية."],
  "No block receipt has been verified yet.":["尚未核对到区块收据。","لم يتم التحقق من أي إيصال كتلة بعد."],
  "This request is still pending verification.":["此请求仍待核验。","لا يزال هذا الطلب قيد التحقق."],
  "Network":["网络","الشبكة"],
  "Network fee":["网络费用","رسوم الشبكة"],
  "Close and reopen this request to continue.":["请关闭后重新打开此请求，再继续操作。","أغلق هذا الطلب ثم أعد فتحه للمتابعة."],
  "The request could not be checked. Keep the original request and try again manually.":["无法核对此请求。请保留原请求，并手动重试。","تعذر التحقق من الطلب. احتفظ بالطلب الأصلي وأعد المحاولة يدويًا."],
  "Preparing request…":["正在准备请求…","جارٍ إعداد الطلب…"],
  "Checking block receipt…":["正在核对区块收据…","جارٍ التحقق من إيصال الكتلة…"],
  "Saving receipt review…":["正在保存收据查看记录…","جارٍ حفظ سجل مراجعة الإيصال…"],
} as const;
export type WalletDetailMessage=keyof typeof DETAIL_MESSAGES;
export function walletCopy(locale:WalletLocale,text:WalletDetailMessage,values:Readonly<Record<string,string|number>>={}):string{
  const template=locale==="zh-Hans"?DETAIL_MESSAGES[text][0]:locale==="ar"?DETAIL_MESSAGES[text][1]:text;
  return template.replace(/\{([a-zA-Z]+)\}/g,(token,key:string)=>Object.prototype.hasOwnProperty.call(values,key)?String(values[key]):token);
}
export function walletDetailError(locale:WalletLocale,error:string):string{
  if(error in DETAIL_MESSAGES)return walletCopy(locale,error as WalletDetailMessage);
  const rejected=/^Auth could not complete the request \(([A-Z][A-Z0-9_]{2,63})\)\. Review and retry\.$/.exec(error);
  if(rejected)return walletCopy(locale,"Auth could not complete the request ({code}). Review and retry.",{code:rejected[1]!});
  // Keep the original diagnostic available without treating an unverified result
  // as an empty inventory or a completed revocation.
  return `${walletCopy(locale,"The result could not be verified. Review and retry.")}\n${error}`;
}
export function walletAccessibilitySummary(locale:WalletLocale,summary:string):string{
  return summary.split(" · ").map(part=>part in DETAIL_MESSAGES?walletCopy(locale,part as WalletDetailMessage):part).join(" · ");
}
