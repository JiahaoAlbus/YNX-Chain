import type {WalletLocale} from './i18n';
const LOCALES=["en", "zh-Hans", "zh-Hant", "ja", "ko", "es", "fr", "de", "pt", "ru", "id", "ar"] as const;
const ROWS={
  "clipboardUnavailable": [
    "Clipboard unavailable. Open Receive and copy the address manually.",
    "暂时无法复制。请打开收款页面并手动复制地址。",
    "暫時無法複製。請開啟收款頁面並手動複製地址。",
    "コピーできません。受取画面を開き、アドレスを手動でコピーしてください。",
    "복사할 수 없습니다. 받기 화면을 열어 주소를 직접 복사하세요.",
    "No se puede copiar. Abre Recibir y copia la dirección manualmente.",
    "Copie indisponible. Ouvrez Recevoir et copiez l’adresse manuellement.",
    "Kopieren nicht verfügbar. Öffne Empfangen und kopiere die Adresse manuell.",
    "Não é possível copiar. Abra Receber e copie o endereço manualmente.",
    "Копирование недоступно. Откройте получение и скопируйте адрес вручную.",
    "Tidak dapat menyalin. Buka Terima dan salin alamat secara manual.",
    "النسخ غير متاح. افتح الاستلام وانسخ العنوان يدويًا."
  ],
  "scan": [
    "Scan QR code",
    "扫一扫",
    "掃描 QR 碼",
    "QRコードを読み取る",
    "QR 코드 스캔",
    "Escanear QR",
    "Scanner un QR code",
    "QR-Code scannen",
    "Ler código QR",
    "Сканировать QR-код",
    "Pindai kode QR",
    "مسح رمز QR"
  ],
  "contracts": [
    "Read native contracts",
    "查询原生合约",
    "查詢原生合約",
    "ネイティブコントラクトを照会",
    "네이티브 계약 조회",
    "Consultar contratos nativos",
    "Consulter les contrats natifs",
    "Native Verträge abfragen",
    "Consultar contratos nativos",
    "Просмотреть нативные контракты",
    "Baca kontrak native",
    "عرض العقود الأصلية"
  ],
  "confirmedHistory": [
    "Confirmed transfer history",
    "已确认转账记录",
    "已確認轉帳紀錄",
    "確認済み送金履歴",
    "확정된 전송 내역",
    "Transferencias confirmadas",
    "Transferts confirmés",
    "Bestätigte Überweisungen",
    "Transferências confirmadas",
    "Подтверждённые переводы",
    "Riwayat transfer terkonfirmasi",
    "سجل التحويلات المؤكدة"
  ],
  "payReceipts": [
    "Pay payment receipts",
    "Pay 付款收据",
    "Pay 付款收據",
    "Payの支払い明細",
    "Pay 결제 영수증",
    "Recibos de pago Pay",
    "Reçus de paiement Pay",
    "Pay-Zahlungsbelege",
    "Recibos de pagamento Pay",
    "Квитанции Pay",
    "Tanda terima pembayaran Pay",
    "إيصالات الدفع Pay"
  ]
} as const;
export type WalletDashboardMessage=keyof typeof ROWS;
for(const row of Object.values(ROWS))Object.freeze(row);Object.freeze(ROWS);
export function walletDashboardCopy(locale:WalletLocale,message:WalletDashboardMessage):string{
 const index=(LOCALES as readonly string[]).indexOf(locale);
 if(index<0||!Object.prototype.hasOwnProperty.call(ROWS,message))throw Error('Unsupported Wallet dashboard copy');
 return ROWS[message][index]!;
}
