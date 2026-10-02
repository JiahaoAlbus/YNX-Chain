const copy={
  "en": [
    "Approve before",
    "Service access until",
    "Only the listed permissions, until this fixed deadline. Logout, revocation or account changes restrict access. No automatic Wallet signatures, transfers or deadline extension."
  ],
  "zh-CN": [
    "请在此时间前批准",
    "服务授权截止",
    "仅批准所列权限至此固定截止时间。退出、撤销或切换账户会限制访问；不会自动签名、转账或延长。"
  ],
  "zh-TW": [
    "請在此時間前核准",
    "服務授權截止",
    "僅核准所列權限至此固定截止時間。登出、撤銷或切換帳戶會限制存取；不會自動簽名、轉帳或延長。"
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
  ]
};
const initial={
  "en": "Approve these permissions for up to 2 hours from the new request. Review the exact deadline in Wallet before approving.",
  "zh-CN": "新请求可授予这些权限最长 2 小时。批准前请在钱包核对准确截止时间。",
  "zh-TW": "新要求可授予這些權限最長 2 小時。核准前請在錢包核對確切截止時間。",
  "ja": "新しいリクエストから最大2時間、これらの権限を承認します。承認前にウォレットで正確な期限を確認してください。",
  "ko": "새 요청 시점부터 최대 2시간 동안 이 권한을 승인합니다. 승인 전에 지갑에서 정확한 만료 시간을 확인하세요.",
  "es": "Autoriza estos permisos por hasta 2 horas desde la nueva solicitud. Revisa el plazo exacto en Wallet antes de aprobar.",
  "fr": "Autorisez ces permissions pour 2 heures au maximum à partir de la nouvelle demande. Vérifiez l’échéance exacte dans Wallet avant d’approuver.",
  "de": "Diese Berechtigungen gelten höchstens 2 Stunden ab der neuen Anfrage. Prüfen Sie vor der Zustimmung die genaue Frist im Wallet.",
  "pt": "Autorize estas permissões por até 2 horas após o novo pedido. Confira o prazo exato na Wallet antes de aprovar.",
  "ru": "Разрешите эти действия максимум на 2 часа с момента нового запроса. Перед подтверждением проверьте точный срок в Wallet.",
  "ar": "وافق على هذه الأذونات لمدة لا تزيد عن ساعتين من الطلب الجديد. راجع الموعد النهائي الدقيق في المحفظة قبل الموافقة.",
  "id": "Izinkan akses ini hingga 2 jam sejak permintaan baru. Periksa batas waktu yang tepat di Wallet sebelum menyetujui."
};
export function privateFiniteConsentText(locale,requestOrSession,isRequest=false){
 const language=Object.hasOwn(copy,locale)?locale:'en',parts=copy[language],value=requestOrSession?.serviceConsent;
 if(!value)return initial[language]+' '+parts[2];
 const before=isRequest?parts[0]+': '+requestOrSession.expiresAt+'\n':'';
 return before+parts[1]+': '+value.expiresAt+'\n'+parts[2];
}
