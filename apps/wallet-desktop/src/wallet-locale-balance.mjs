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
export const BALANCE_COPY=Object.freeze(Object.fromEntries(Object.entries(rows).map(([locale,values])=>{
  if(values.length!==keys.length||values.some(value=>!value))throw Error(`Incomplete balance copy: ${locale}`);
  return[locale,Object.freeze(Object.fromEntries(keys.map((key,index)=>[key,values[index]])))];
})));
