import type {WalletLocale} from './i18n';
import type {MobileProductSessionRequest} from '../protocol/productSessionController';
const copy: Readonly<Record<WalletLocale,readonly [string,string,string]>> = {
  "en": [
    "Approve before",
    "Service access until",
    "Only the listed permissions, until this fixed deadline. Logout, revocation or account changes restrict access. No automatic Wallet signatures, transfers or deadline extension."
  ],
  "ja": [
    "承認期限",
    "サービス利用期限",
    "記載した権限のみ、この期限まで有効です。ログアウト、取消、アカウント変更で利用を制限します。自動署名、送金、期限延長はありません。"
  ],
  "ko": [
    "승인 기한",
    "서비스 이용 기한",
    "표시된 권한만 이 기한까지 승인합니다. 로그아웃, 취소, 계정 변경 시 접근이 제한됩니다. 자동 서명, 송금, 기한 연장은 없습니다."
  ],
  "es": [
    "Aprobar antes de",
    "Acceso al servicio hasta",
    "Solo los permisos indicados, hasta este límite fijo. Cerrar sesión, revocar o cambiar la cuenta limita el acceso. Sin firmas, transferencias ni prórrogas automáticas."
  ],
  "fr": [
    "Approuver avant",
    "Accès au service jusqu’au",
    "Uniquement les permissions indiquées jusqu’à cette échéance fixe. Déconnexion, révocation ou changement de compte limitent l’accès. Aucune signature, transaction ni prolongation automatique."
  ],
  "de": [
    "Genehmigen vor",
    "Dienstzugriff bis",
    "Nur die aufgeführten Rechte bis zu diesem festen Zeitpunkt. Abmelden, Widerruf oder Kontowechsel beschränken den Zugriff. Keine automatischen Signaturen, Überweisungen oder Verlängerungen."
  ],
  "pt": [
    "Aprovar antes de",
    "Acesso ao serviço até",
    "Apenas as permissões indicadas, até este prazo fixo. Sair, revogar ou mudar de conta limita o acesso. Sem assinaturas, transferências ou prorrogações automáticas."
  ],
  "ru": [
    "Подтвердить до",
    "Доступ к сервису до",
    "Только указанные разрешения до фиксированного срока. Выход, отзыв или смена аккаунта ограничивают доступ. Без автоматических подписей, переводов и продления."
  ],
  "ar": [
    "الموافقة قبل",
    "الوصول إلى الخدمة حتى",
    "الأذونات المذكورة فقط حتى هذا الموعد الثابت. تسجيل الخروج أو الإلغاء أو تغيير الحساب يقيّد الوصول. لا توقيعات أو تحويلات أو تمديد تلقائي."
  ],
  "id": [
    "Setujui sebelum",
    "Akses layanan hingga",
    "Hanya izin yang tercantum sampai batas tetap ini. Keluar, pencabutan, atau perubahan akun membatasi akses. Tanpa tanda tangan, transfer, atau perpanjangan otomatis."
  ],
  "zh-Hans": [
    "请在此时间前批准",
    "服务授权截止",
    "仅批准所列权限至此固定截止时间。退出、撤销或切换账户会限制访问；不会自动签名、转账或延长。"
  ],
  "zh-Hant": [
    "請在此時間前核准",
    "服務授權截止",
    "僅核准所列權限至此固定截止時間。登出、撤銷或切換帳戶會限制存取；不會自動簽名、轉帳或延長。"
  ]
};
// Display the exact signed deadline; localization never changes protocol fields.
export function finiteServiceReview(locale:WalletLocale,request:MobileProductSessionRequest):string|null {
  if(!request.serviceConsent)return null;
  const [before,until,terms]=copy[locale];
  return before+': '+request.expiresAt+'\n'+until+': '+request.serviceConsent.expiresAt+'\n'+terms;
}
