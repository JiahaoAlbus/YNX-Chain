const keys = ["Show receiving address","Checking account…","Receiving address","A receiving address does not verify the network or balance. Never send assets on another network."];
const rows = {
  "en": [
    "Show receiving address",
    "Checking account…",
    "Receiving address",
    "A receiving address does not verify the network or balance. Never send assets on another network."
  ],
  "zh-Hans": [
    "显示收款地址",
    "正在核对账户…",
    "收款地址",
    "收款地址不代表网络或余额已验证。请勿通过其他网络发送资产。"
  ],
  "zh-Hant": [
    "顯示收款地址",
    "正在核對帳戶…",
    "收款地址",
    "收款地址不代表網路或餘額已驗證。請勿透過其他網路傳送資產。"
  ],
  "ja": [
    "受取アドレスを表示",
    "アカウントを確認中…",
    "受取アドレス",
    "受取アドレスはネットワークや残高の確認を意味しません。別のネットワークで資産を送らないでください。"
  ],
  "ko": [
    "받는 주소 표시",
    "계정 확인 중…",
    "받는 주소",
    "받는 주소만으로 네트워크나 잔액이 확인되지는 않습니다. 다른 네트워크로 자산을 보내지 마세요."
  ],
  "es": [
    "Mostrar dirección de recepción",
    "Comprobando cuenta…",
    "Dirección de recepción",
    "Una dirección de recepción no verifica la red ni el saldo. No envíes activos por otra red."
  ],
  "fr": [
    "Afficher l’adresse de réception",
    "Vérification du compte…",
    "Adresse de réception",
    "Une adresse de réception ne vérifie ni le réseau ni le solde. N’envoyez pas d’actifs sur un autre réseau."
  ],
  "de": [
    "Empfangsadresse anzeigen",
    "Konto wird geprüft…",
    "Empfangsadresse",
    "Eine Empfangsadresse bestätigt weder Netzwerk noch Guthaben. Senden Sie keine Vermögenswerte über ein anderes Netzwerk."
  ],
  "pt": [
    "Mostrar endereço de recebimento",
    "Verificando conta…",
    "Endereço de recebimento",
    "Um endereço de recebimento não verifica a rede nem o saldo. Não envie ativos por outra rede."
  ],
  "ru": [
    "Показать адрес получения",
    "Проверка аккаунта…",
    "Адрес получения",
    "Адрес получения не подтверждает сеть или баланс. Не отправляйте активы через другую сеть."
  ],
  "ar": [
    "عرض عنوان الاستلام",
    "جارٍ التحقق من الحساب…",
    "عنوان الاستلام",
    "عنوان الاستلام لا يؤكد الشبكة أو الرصيد. لا ترسل الأصول عبر شبكة أخرى."
  ],
  "id": [
    "Tampilkan alamat penerimaan",
    "Memeriksa akun…",
    "Alamat penerimaan",
    "Alamat penerimaan tidak memverifikasi jaringan atau saldo. Jangan kirim aset melalui jaringan lain."
  ]
};
const tokenImport = {en: 'Import TRC20 token', 'zh-Hans': '导入 TRC20 代币', 'zh-Hant': '匯入 TRC20 代幣', ja: 'TRC20 トークンを追加', ko: 'TRC20 토큰 가져오기', es: 'Importar token TRC20', fr: 'Importer un jeton TRC20', de: 'TRC20-Token importieren', pt: 'Importar token TRC20', ru: 'Импортировать токен TRC20', ar: 'استيراد رمز TRC20', id: 'Impor token TRC20'};
export const FAMILY_COPY = Object.freeze(Object.fromEntries(Object.entries(rows).map(([locale, values]) => [locale, Object.freeze({...Object.fromEntries(keys.map((key, index) => [key, values[index]])), 'Import TRC20 token': tokenImport[locale]})])));
