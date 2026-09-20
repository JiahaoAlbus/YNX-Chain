import type { WalletLocale } from "./i18n";

type RecoveryCopy = Readonly<{ paused: string; reload: string }>;
const COPY: Record<WalletLocale, RecoveryCopy> = {
  en: { paused: "Request paused. Reload the saved request to continue. Nothing will be sent.", reload: "Reload saved request" },
  "zh-Hans": { paused: "请求已暂停。重新读取已存请求即可继续，此操作不会发送请求。", reload: "重新读取已存请求" },
  "zh-Hant": { paused: "請求已暫停。重新讀取已儲存的請求即可繼續，此操作不會傳送請求。", reload: "重新讀取已儲存的請求" },
  ja: { paused: "リクエストを一時停止しました。保存済みリクエストを再読み込みして続けてください。送信は行いません。", reload: "保存済みリクエストを再読み込み" },
  ko: { paused: "요청이 일시 중지되었습니다. 저장된 요청을 다시 불러와 계속하세요. 요청은 전송되지 않습니다.", reload: "저장된 요청 다시 불러오기" },
  es: { paused: "Solicitud en pausa. Vuelve a cargar la solicitud guardada para continuar. No se enviará nada.", reload: "Cargar solicitud guardada" },
  fr: { paused: "Demande en pause. Rechargez la demande enregistrée pour continuer. Rien ne sera envoyé.", reload: "Recharger la demande enregistrée" },
  de: { paused: "Anfrage pausiert. Lade die gespeicherte Anfrage erneut, um fortzufahren. Es wird nichts gesendet.", reload: "Gespeicherte Anfrage neu laden" },
  pt: { paused: "Solicitação pausada. Recarregue a solicitação salva para continuar. Nada será enviado.", reload: "Recarregar solicitação salva" },
  ru: { paused: "Запрос приостановлен. Загрузите сохранённый запрос, чтобы продолжить. Ничего не будет отправлено.", reload: "Загрузить сохранённый запрос" },
  ar: { paused: "تم إيقاف الطلب مؤقتًا. أعد تحميل الطلب المحفوظ للمتابعة. لن يتم إرسال أي شيء.", reload: "إعادة تحميل الطلب المحفوظ" },
  id: { paused: "Permintaan dijeda. Muat ulang permintaan tersimpan untuk melanjutkan. Tidak ada yang akan dikirim.", reload: "Muat ulang permintaan tersimpan" },
};

export function faucetRecoveryCopy(locale: WalletLocale): RecoveryCopy { return COPY[locale]; }
