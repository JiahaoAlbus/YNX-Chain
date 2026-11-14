/** Display-only balance states. Never translates amounts or network data. */
const keys=["Checking YNX Testnet…","Balance unavailable. Try refreshing.","YNX Testnet · Updated {time}","Legacy whole-YNXT balance verified. Ethereum transfers are not enabled on this network."];
const rows={
  en:keys,
  "zh-Hans":["正在检查 YNX 测试网…","余额暂不可用。请重新刷新。","YNX 测试网 · 更新于 {time}","已验证旧版整额 YNXT 余额。此网络未启用以太坊转账。"],
  "zh-Hant":["正在檢查 YNX 測試網…","餘額暫時無法取得。請重新整理。","YNX 測試網 · 更新於 {time}","已驗證舊版整額 YNXT 餘額。此網路未啟用以太坊轉帳。"],
  ja:["YNX Testnet を確認中…","残高を取得できません。再読み込みしてください。","YNX Testnet · 更新 {time}","従来の整数 YNXT 残高を確認しました。このネットワークでは Ethereum 送金が有効ではありません。"],
  ko:["YNX Testnet 확인 중…","잔액을 확인할 수 없습니다. 새로고침하세요.","YNX Testnet · 업데이트 {time}","기존 정수 YNXT 잔액을 확인했습니다. 이 네트워크에서는 Ethereum 전송이 활성화되지 않았습니다."],
  es:["Comprobando YNX Testnet…","Saldo no disponible. Actualiza de nuevo.","YNX Testnet · Actualizado {time}","Saldo heredado de YNXT enteros verificado. Las transferencias de Ethereum no están habilitadas en esta red."],
  fr:["Vérification de YNX Testnet…","Solde indisponible. Réessayez l’actualisation.","YNX Testnet · Mis à jour {time}","Ancien solde en YNXT entiers vérifié. Les transferts Ethereum ne sont pas activés sur ce réseau."],
  de:["YNX Testnet wird geprüft…","Guthaben nicht verfügbar. Bitte erneut aktualisieren.","YNX Testnet · Aktualisiert {time}","Altes Guthaben in ganzen YNXT bestätigt. Ethereum-Überweisungen sind in diesem Netzwerk nicht aktiviert."],
  pt:["Verificando YNX Testnet…","Saldo indisponível. Tente atualizar novamente.","YNX Testnet · Atualizado {time}","Saldo legado em YNXT inteiros verificado. Transferências Ethereum não estão habilitadas nesta rede."],
  ru:["Проверка YNX Testnet…","Баланс недоступен. Попробуйте обновить.","YNX Testnet · Обновлено {time}","Прежний баланс в целых YNXT проверен. Переводы Ethereum в этой сети не включены."],
  ar:["جارٍ التحقق من YNX Testnet…","الرصيد غير متاح. حاول التحديث مجددًا.","YNX Testnet · تم التحديث {time}","تم التحقق من الرصيد القديم بوحدات YNXT الصحيحة. تحويلات Ethereum غير مفعلة على هذه الشبكة."],
  id:["Memeriksa YNX Testnet…","Saldo tidak tersedia. Coba segarkan lagi.","YNX Testnet · Diperbarui {time}","Saldo lama dalam YNXT bulat terverifikasi. Transfer Ethereum tidak diaktifkan di jaringan ini."]
};
keys.push('Update pending · Last updated {time}');
const pending={"zh-Hans":"更新待确认 · 上次更新 {time}","zh-Hant":"更新待確認 · 上次更新 {time}",ja:"更新を確認できません · 最終更新 {time}",ko:"업데이트 확인 대기 · 마지막 업데이트 {time}",es:"Actualización pendiente · Última actualización {time}",fr:"Actualisation en attente · Dernière mise à jour {time}",de:"Aktualisierung ausstehend · Zuletzt aktualisiert {time}",pt:"Atualização pendente · Última atualização {time}",ru:"Обновление ожидается · Последнее обновление {time}",ar:"التحديث قيد الانتظار · آخر تحديث {time}",id:"Pembaruan tertunda · Terakhir diperbarui {time}"};
for(const [locale,value] of Object.entries(pending))rows[locale].push(value);
const deadlineKeys=["Balance check timed out. The earlier request may still be running.","Balance checks are still waiting for earlier requests to finish. Try refreshing after they complete."];
const deadlineRows={
  "zh-Hans": [
    "余额查询超时，先前请求可能仍在运行。",
    "余额查询仍在等待先前请求结束，请在其完成后重新刷新。"
  ],
  "zh-Hant": [
    "餘額查詢逾時，先前請求可能仍在執行。",
    "餘額查詢仍在等待先前請求結束，請在其完成後重新整理。"
  ],
  "ja": [
    "残高照会がタイムアウトしました。以前の要求はまだ実行中の可能性があります。",
    "以前の残高照会の完了を待っています。完了後に再読み込みしてください。"
  ],
  "ko": [
    "잔액 조회 시간이 초과되었습니다. 이전 요청이 아직 실행 중일 수 있습니다.",
    "이전 잔액 요청이 끝나기를 기다리는 중입니다. 완료된 후 새로고침하세요."
  ],
  "es": [
    "La consulta del saldo agotó el tiempo. La solicitud anterior podría seguir activa.",
    "Las consultas de saldo esperan a que terminen solicitudes anteriores. Actualiza cuando finalicen."
  ],
  "fr": [
    "La consultation du solde a expiré. La demande précédente peut être encore en cours.",
    "Les consultations du solde attendent la fin des demandes précédentes. Actualisez après leur fin."
  ],
  "de": [
    "Die Guthabenabfrage hat das Zeitlimit erreicht. Die vorherige Anfrage läuft möglicherweise noch.",
    "Guthabenabfragen warten auf frühere Anfragen. Aktualisiere nach deren Abschluss."
  ],
  "pt": [
    "A consulta de saldo expirou. A solicitação anterior ainda pode estar em andamento.",
    "As consultas de saldo aguardam solicitações anteriores terminarem. Atualize após a conclusão."
  ],
  "ru": [
    "Время запроса баланса истекло. Предыдущий запрос может ещё выполняться.",
    "Запросы баланса ожидают завершения предыдущих запросов. Обновите после их завершения."
  ],
  "ar": [
    "انتهت مهلة فحص الرصيد. قد يظل الطلب السابق قيد التنفيذ.",
    "تنتظر فحوص الرصيد انتهاء الطلبات السابقة. حدّث بعد اكتمالها."
  ],
  "id": [
    "Pemeriksaan saldo melewati batas waktu. Permintaan sebelumnya mungkin masih berjalan.",
    "Pemeriksaan saldo menunggu permintaan sebelumnya selesai. Segarkan setelah selesai."
  ]
};
keys.push(...deadlineKeys);
for(const [locale,values] of Object.entries(deadlineRows))rows[locale].push(...values);
export const BALANCE_COPY=Object.freeze(Object.fromEntries(Object.entries(rows).map(([locale,values])=>{
  if(values.length!==keys.length||values.some(value=>!value))throw Error(`Incomplete balance copy: ${locale}`);
  return[locale,Object.freeze(Object.fromEntries(keys.map((key,index)=>[key,values[index]])))];
})));
