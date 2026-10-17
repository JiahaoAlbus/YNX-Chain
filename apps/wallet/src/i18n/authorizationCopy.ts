import type { WalletLocale } from "./i18n";

// Labels only: show the original protocol values without translating or
// shortening an origin, callback, device ID, or network identifier.
const en = {
  origin: "Origin", callback: "Return to product", device: "Product device",
  evm: "EVM compatibility", closeRequest: "Close request", retryReturn: "Retry return to product",
} as const;
type AuthorizationCopy = Record<keyof typeof en, string>;
const messages: Readonly<Record<WalletLocale, AuthorizationCopy>> = {
  en,
  "zh-Hans": {
    origin: "请求来源", callback: "返回产品的地址", device: "产品设备",
    evm: "EVM 兼容网络", closeRequest: "关闭请求", retryReturn: "重新尝试返回产品",
  },
  "zh-Hant": {
    origin: "要求來源", callback: "返回產品的位址", device: "產品裝置",
    evm: "EVM 相容網路", closeRequest: "關閉要求", retryReturn: "重新嘗試返回產品",
  },
  ja: {
    origin: "リクエスト元", callback: "製品への戻り先", device: "製品のデバイス",
    evm: "EVM 互換ネットワーク", closeRequest: "リクエストを閉じる", retryReturn: "製品への復帰を再試行",
  },
  ko: {
    origin: "요청 출처", callback: "제품으로 돌아갈 주소", device: "제품 기기",
    evm: "EVM 호환 네트워크", closeRequest: "요청 닫기", retryReturn: "제품으로 돌아가기 재시도",
  },
  es: {
    origin: "Origen", callback: "Dirección de retorno al producto", device: "Dispositivo del producto",
    evm: "Compatibilidad EVM", closeRequest: "Cerrar solicitud", retryReturn: "Reintentar el retorno al producto",
  },
  fr: {
    origin: "Origine", callback: "Adresse de retour au produit", device: "Appareil du produit",
    evm: "Compatibilité EVM", closeRequest: "Fermer la demande", retryReturn: "Réessayer le retour au produit",
  },
  de: {
    origin: "Herkunft", callback: "Rückkehradresse zum Produkt", device: "Produktgerät",
    evm: "EVM-Kompatibilität", closeRequest: "Anfrage schließen", retryReturn: "Rückkehr zum Produkt erneut versuchen",
  },
  pt: {
    origin: "Origem", callback: "Endereço de regresso ao produto", device: "Dispositivo do produto",
    evm: "Compatibilidade EVM", closeRequest: "Fechar pedido", retryReturn: "Tentar regressar ao produto novamente",
  },
  ru: {
    origin: "Источник", callback: "Адрес возврата в продукт", device: "Устройство продукта",
    evm: "Совместимость с EVM", closeRequest: "Закрыть запрос", retryReturn: "Повторить возврат в продукт",
  },
  ar: {
    origin: "مصدر الطلب", callback: "عنوان العودة إلى المنتج", device: "جهاز المنتج",
    evm: "توافق EVM", closeRequest: "إغلاق الطلب", retryReturn: "إعادة محاولة العودة إلى المنتج",
  },
  id: {
    origin: "Asal permintaan", callback: "Alamat kembali ke produk", device: "Perangkat produk",
    evm: "Kompatibilitas EVM", closeRequest: "Tutup permintaan", retryReturn: "Coba kembali ke produk lagi",
  },
};

export function authorizationCopy(locale: WalletLocale, key: keyof AuthorizationCopy): string {
  return messages[locale][key];
}
