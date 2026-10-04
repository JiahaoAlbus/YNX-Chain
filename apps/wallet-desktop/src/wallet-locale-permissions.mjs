export const PERMISSION_STORE_NOTICE = "Wallet account permissions cannot be verified. Existing records were retained; account access and signing are blocked.";
const translations={
  en:PERMISSION_STORE_NOTICE,
  "zh-Hans":"无法验证 Wallet 账户授权。原有记录已保留；账户访问和签名已阻止。",
  "zh-Hant":"無法驗證 Wallet 帳戶授權。原有紀錄已保留；帳戶存取和簽名已阻止。",
  ja:"Wallet のアカウント権限を検証できません。既存の記録は保持され、アカウントへのアクセスと署名はブロックされています。",
  ko:"Wallet 계정 권한을 확인할 수 없습니다. 기존 기록은 보존되며 계정 접근과 서명은 차단됩니다.",
  es:"No se pueden verificar los permisos de la cuenta de Wallet. Los registros existentes se conservaron; el acceso a la cuenta y la firma están bloqueados.",
  fr:"Les autorisations du compte Wallet ne peuvent pas être vérifiées. Les enregistrements existants sont conservés ; l’accès au compte et la signature sont bloqués.",
  de:"Die Wallet-Kontoberechtigungen können nicht geprüft werden. Vorhandene Einträge bleiben erhalten; Kontozugriff und Signieren sind gesperrt.",
  pt:"Não foi possível verificar as permissões da conta Wallet. Os registros existentes foram preservados; o acesso à conta e a assinatura estão bloqueados.",
  ru:"Не удалось проверить разрешения аккаунта Wallet. Существующие записи сохранены; доступ к аккаунту и подписание заблокированы.",
  ar:"تعذر التحقق من أذونات حساب Wallet. تم الاحتفاظ بالسجلات الموجودة؛ تم حظر الوصول إلى الحساب والتوقيع.",
  id:"Izin akun Wallet tidak dapat diverifikasi. Catatan yang ada tetap disimpan; akses akun dan penandatanganan diblokir."
};
export const PERMISSION_COPY=Object.freeze(Object.fromEntries(Object.entries(translations).map(([locale,text])=>[locale,Object.freeze({[PERMISSION_STORE_NOTICE]:text})])));
