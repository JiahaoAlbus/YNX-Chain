import type { WalletLocale } from "./i18n";

type NetworkCopy=Readonly<{interrupted:string;timeout:string;readFailed:string;receipt:string}>;
const COPY:Record<WalletLocale,NetworkCopy>={
  en:{interrupted:"Connection interrupted. Refresh to try again.",timeout:"The request timed out. Refresh to try again.",readFailed:"Unable to read network data{status}. Try again.",receipt:"The node's receipt could not be verified. The original transfer remains saved."},
  "zh-Hans":{interrupted:"网络连接已中断。请刷新后重试。",timeout:"请求已超时。请刷新后重试。",readFailed:"无法读取网络数据{status}。请重试。",receipt:"无法核验节点回执。原始转账仍已保存。"},
  "zh-Hant":{interrupted:"網路連線已中斷。請重新整理後重試。",timeout:"請求已逾時。請重新整理後重試。",readFailed:"無法讀取網路資料{status}。請重試。",receipt:"無法驗證節點回執。原始轉帳仍已儲存。"},
  ja:{interrupted:"接続が中断されました。更新して再試行してください。",timeout:"リクエストがタイムアウトしました。更新して再試行してください。",readFailed:"ネットワークデータを読み取れませんでした{status}。もう一度お試しください。",receipt:"ノードの取引レシートを検証できませんでした。元の送金データは保存されたままです。"},
  ko:{interrupted:"연결이 끊겼습니다. 새로 고침하여 다시 시도하세요.",timeout:"요청 시간이 초과되었습니다. 새로 고침하여 다시 시도하세요.",readFailed:"네트워크 데이터를 읽을 수 없습니다{status}. 다시 시도하세요.",receipt:"노드의 거래 영수증을 검증할 수 없습니다. 원래 전송 데이터는 저장된 상태로 유지됩니다."},
  es:{interrupted:"Se interrumpió la conexión. Actualiza para volver a intentarlo.",timeout:"La solicitud agotó el tiempo de espera. Actualiza para volver a intentarlo.",readFailed:"No se pudieron leer los datos de la red{status}. Vuelve a intentarlo.",receipt:"No se pudo verificar el recibo del nodo. La transferencia original sigue guardada."},
  fr:{interrupted:"La connexion a été interrompue. Actualisez pour réessayer.",timeout:"La requête a expiré. Actualisez pour réessayer.",readFailed:"Impossible de lire les données du réseau{status}. Réessayez.",receipt:"Le reçu du nœud n’a pas pu être vérifié. Le transfert initial reste enregistré."},
  de:{interrupted:"Die Verbindung wurde unterbrochen. Aktualisiere die Ansicht und versuche es erneut.",timeout:"Die Anfrage hat das Zeitlimit überschritten. Aktualisiere die Ansicht und versuche es erneut.",readFailed:"Netzwerkdaten konnten nicht gelesen werden{status}. Versuche es erneut.",receipt:"Der Beleg des Knotens konnte nicht überprüft werden. Die ursprüngliche Überweisung bleibt gespeichert."},
  pt:{interrupted:"A conexão foi interrompida. Atualize para tentar novamente.",timeout:"A solicitação excedeu o tempo limite. Atualize para tentar novamente.",readFailed:"Não foi possível ler os dados da rede{status}. Tente novamente.",receipt:"Não foi possível verificar o recibo do nó. A transferência original continua salva."},
  ru:{interrupted:"Соединение прервано. Обновите данные и повторите попытку.",timeout:"Время ожидания запроса истекло. Обновите данные и повторите попытку.",readFailed:"Не удалось прочитать данные сети{status}. Повторите попытку.",receipt:"Не удалось проверить квитанцию узла. Исходный перевод остаётся сохранённым."},
  ar:{interrupted:"انقطع الاتصال. حدّث البيانات وحاول مجددًا.",timeout:"انتهت مهلة الطلب. حدّث البيانات وحاول مجددًا.",readFailed:"تعذّرت قراءة بيانات الشبكة{status}. حاول مجددًا.",receipt:"تعذّر التحقق من إيصال العقدة. تظل بيانات التحويل الأصلي محفوظة."},
  id:{interrupted:"Koneksi terputus. Segarkan untuk mencoba lagi.",timeout:"Permintaan kehabisan waktu. Segarkan untuk mencoba lagi.",readFailed:"Data jaringan tidak dapat dibaca{status}. Coba lagi.",receipt:"Bukti transaksi dari node tidak dapat diverifikasi. Transfer asli tetap tersimpan."},
};

const READ_FAILURES=new Set([
  "The network is unavailable. Please refresh again.",
  "YNX chain response origin changed",
  "YNX chain response exceeds the supported size",
  "Authoritative account response is invalid",
  "Authoritative account identity does not match the selected ynx1 account",
  "Authoritative activity response is invalid",
  "Authoritative activity entry is invalid",
]);
const RECEIPT_INVALID="The node's local durability proof could not be verified. The original transfer remains stored.";

/** Translate known, complete error messages only. Unknown errors retain their exact text. */
export function networkRecoveryCopy(locale:WalletLocale,text:string):string{
  const copy=COPY[locale];if(!copy)return text;
  if(text==="The network connection was interrupted. Please refresh again.")return copy.interrupted;
  if(text==="The network request timed out. Please refresh again.")return copy.timeout;
  if(text===RECEIPT_INVALID)return copy.receipt;
  const http=/^The YNX node (?:is temporarily unavailable|could not complete this read) \(([1-5][0-9]{2})\)\. Please refresh again\.$/.exec(text)
    ??/^YNX chain returned non-JSON \(([1-5][0-9]{2})\)$/.exec(text);
  if(http)return copy.readFailed.replace("{status}",` (HTTP ${http[1]})`);
  if(READ_FAILURES.has(text))return copy.readFailed.replace("{status}","");
  return text;
}
