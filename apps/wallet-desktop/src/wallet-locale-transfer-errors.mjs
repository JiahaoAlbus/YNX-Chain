/** Display-only known native balance refusals. No wire or remote text changes. */
export const TRANSFER_ERROR_KEYS=Object.freeze([
  'Insufficient YNXT for this amount. Add Testnet funds before sending.',
  'Insufficient YNXT to cover the amount and network fee',
  'Insufficient YNXT to cover this transaction and its maximum network fee'
]);
export const POLICY_UNAVAILABLE_KEY='Unable to verify the current account transaction policy. Check the network and try again.';
export const POLICY_UNAVAILABLE_COPY=Object.freeze({
 en:POLICY_UNAVAILABLE_KEY,
 'zh-Hans':'无法验证当前账户的交易策略。请检查网络后重试。',
 'zh-Hant':'無法驗證目前帳戶的交易策略。請檢查網路後重試。',
 ja:'現在のアカウントの取引ポリシーを確認できません。ネットワークを確認して再試行してください。',
 ko:'현재 계정의 거래 정책을 확인할 수 없습니다. 네트워크를 확인하고 다시 시도하세요.',
 es:'No se puede verificar la política de transacciones de la cuenta. Comprueba la red e inténtalo de nuevo.',
 fr:'Impossible de vérifier la politique de transaction du compte. Vérifiez le réseau et réessayez.',
 de:'Die Transaktionsrichtlinie des Kontos kann nicht geprüft werden. Netzwerk prüfen und erneut versuchen.',
 pt:'Não foi possível verificar a política de transações da conta. Verifique a rede e tente novamente.',
 ru:'Не удалось проверить политику транзакций аккаунта. Проверьте сеть и повторите попытку.',
 ar:'تعذر التحقق من سياسة معاملات الحساب الحالي. تحقق من الشبكة وحاول مرة أخرى.',
 id:'Kebijakan transaksi akun saat ini tidak dapat diverifikasi. Periksa jaringan dan coba lagi.'
});
const rows={
 en:TRANSFER_ERROR_KEYS,
 'zh-Hans':['YNXT 余额不足以支付此金额。发送前请先领取测试网资产。','YNXT 余额不足以支付金额和网络手续费。','YNXT 余额不足以支付此交易和最高网络手续费。'],
 'zh-Hant':['YNXT 餘額不足以支付此金額。傳送前請先領取測試網資產。','YNXT 餘額不足以支付金額和網路手續費。','YNXT 餘額不足以支付此交易和最高網路手續費。'],
 ja:['この金額に必要な YNXT が不足しています。送信前にテストネット資産を受け取ってください。','金額とネットワーク手数料に必要な YNXT が不足しています。','この取引とネットワーク手数料の上限に必要な YNXT が不足しています。'],
 ko:['이 금액을 지불할 YNXT가 부족합니다. 보내기 전에 테스트넷 자산을 받으세요.','금액과 네트워크 수수료를 지불할 YNXT가 부족합니다.','이 거래와 최대 네트워크 수수료를 지불할 YNXT가 부족합니다.'],
 es:['YNXT insuficiente para este importe. Obtén fondos de Testnet antes de enviar.','YNXT insuficiente para el importe y la comisión de red.','YNXT insuficiente para esta transacción y su comisión máxima de red.'],
 fr:['Solde YNXT insuffisant pour ce montant. Obtenez des fonds Testnet avant l’envoi.','Solde YNXT insuffisant pour le montant et les frais réseau.','Solde YNXT insuffisant pour cette transaction et ses frais réseau maximaux.'],
 de:['Nicht genug YNXT für diesen Betrag. Vor dem Senden Testnet-Guthaben beziehen.','Nicht genug YNXT für Betrag und Netzwerkgebühr.','Nicht genug YNXT für diese Transaktion und ihre maximale Netzwerkgebühr.'],
 pt:['YNXT insuficiente para este valor. Obtenha fundos de Testnet antes de enviar.','YNXT insuficiente para o valor e a taxa de rede.','YNXT insuficiente para esta transação e sua taxa máxima de rede.'],
 ru:['Недостаточно YNXT для этой суммы. Перед отправкой получите средства Testnet.','Недостаточно YNXT для суммы и сетевой комиссии.','Недостаточно YNXT для этой транзакции и её максимальной сетевой комиссии.'],
 ar:['رصيد YNXT غير كافٍ لهذا المبلغ. احصل على أصول Testnet قبل الإرسال.','رصيد YNXT غير كافٍ للمبلغ ورسوم الشبكة.','رصيد YNXT غير كافٍ لهذه المعاملة والحد الأقصى لرسوم الشبكة.'],
 id:['YNXT tidak cukup untuk jumlah ini. Dapatkan dana Testnet sebelum mengirim.','YNXT tidak cukup untuk jumlah dan biaya jaringan.','YNXT tidak cukup untuk transaksi ini dan biaya jaringan maksimumnya.']
};
export const TRANSFER_ERROR_COPY=Object.freeze(Object.fromEntries(Object.entries(rows).map(([locale,values])=>{
 if(values.length!==TRANSFER_ERROR_KEYS.length||values.some(value=>!value))throw Error(`Incomplete transfer error copy: ${locale}`);
 return[locale,Object.freeze(Object.fromEntries(TRANSFER_ERROR_KEYS.map((key,index)=>[key,values[index]])))];
})));
