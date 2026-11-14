import {NATIVE_AMOUNT_RANGE_KEY} from './native-amount-draft-ui.mjs';
export {NATIVE_AMOUNT_RANGE_KEY};
/** Display-only known native balance refusals. No wire or remote text changes. */
export const TRANSFER_ERROR_KEYS=Object.freeze([
  'Insufficient YNXT for this amount. Add Testnet funds before sending.',
  'Insufficient YNXT to cover the amount and network fee',
  'Insufficient YNXT to cover this transaction and its maximum network fee'
]);
export const NATIVE_AMOUNT_DRAFT_KEY="This native transfer accepts positive whole YNXT only (for example 1), without decimals, exponents or leading zeroes. The amount is never converted or rounded.";
export const NATIVE_AMOUNT_DRAFT_COPY=Object.freeze({
  "en": "This native transfer accepts positive whole YNXT only (for example 1), without decimals, exponents or leading zeroes. The amount is never converted or rounded.",
  "zh-Hans": "当前原生转账仅接受正整数 YNXT（例如 1），不接受小数、指数或前导零；不会转换或舍入金额。",
  "zh-Hant": "目前原生轉帳僅接受正整數 YNXT（例如 1），不接受小數、指數或前導零；不會轉換或捨入金額。",
  "ja": "現在のネイティブ送金は正の整数 YNXT（例：1）のみ受け付けます。小数、指数表記、先頭のゼロは使えず、金額の変換や丸めは行いません。",
  "ko": "현재 네이티브 전송은 양의 정수 YNXT(예: 1)만 허용합니다. 소수, 지수 표기, 앞의 0은 사용할 수 없으며 금액을 변환하거나 반올림하지 않습니다.",
  "es": "Esta transferencia nativa solo admite YNXT enteros positivos (por ejemplo, 1), sin decimales, exponentes ni ceros iniciales. El importe no se convierte ni redondea.",
  "fr": "Ce transfert natif accepte uniquement un nombre entier positif de YNXT (par exemple 1), sans décimales, exposant ni zéro initial. Le montant n’est ni converti ni arrondi.",
  "de": "Diese native Übertragung akzeptiert nur positive ganze YNXT (zum Beispiel 1), ohne Dezimalstellen, Exponenten oder führende Nullen. Der Betrag wird weder umgerechnet noch gerundet.",
  "pt": "Esta transferência nativa aceita apenas YNXT inteiros positivos (por exemplo, 1), sem decimais, expoentes ou zeros à esquerda. O valor não é convertido nem arredondado.",
  "ru": "Для этого нативного перевода допустимо только положительное целое число YNXT (например, 1), без дробной части, экспоненты и начальных нулей. Сумма не преобразуется и не округляется.",
  "ar": "يقبل هذا التحويل الأصلي أعداد YNXT الصحيحة الموجبة فقط (مثل 1)، دون كسور أو صيغة أسية أو أصفار بادئة. لا يُحوَّل المبلغ ولا يُقرَّب.",
  "id": "Transfer native ini hanya menerima YNXT bilangan bulat positif (misalnya 1), tanpa desimal, eksponen, atau nol di depan. Jumlah tidak dikonversi atau dibulatkan."
});
export const POLICY_FAILURE_KEYS=Object.freeze(["The trusted policy source is not supplied. Contact the Wallet provider. No transaction was signed or sent.","The account authorization endpoint returned HTTP 405. Contact the Wallet provider to check endpoint compatibility. No transaction was signed or sent.","The policy source connection failed. Check your connection and try again. No transaction was signed or sent.","The policy source identity could not be verified. Contact the Wallet provider; do not bypass verification. No transaction was signed or sent."]);
const policyFailureRows={
  "en": [
    "The trusted policy source is not supplied. Contact the Wallet provider. No transaction was signed or sent.",
    "The account authorization endpoint returned HTTP 405. Contact the Wallet provider to check endpoint compatibility. No transaction was signed or sent.",
    "The policy source connection failed. Check your connection and try again. No transaction was signed or sent.",
    "The policy source identity could not be verified. Contact the Wallet provider; do not bypass verification. No transaction was signed or sent."
  ],
  "zh-Hans": [
    "可信策略来源未供给，请联系 Wallet 提供方。此次没有签名或发送交易。",
    "账户授权接口返回 HTTP 405，请联系 Wallet 提供方检查接口兼容性。此次没有签名或发送交易。",
    "策略来源连接失败，请检查网络后重试。此次没有签名或发送交易。",
    "无法验证策略来源身份，请联系 Wallet 提供方；不要绕过验证。此次没有签名或发送交易。"
  ],
  "zh-Hant": [
    "可信策略來源未提供，請聯絡 Wallet 提供方。此次沒有簽名或傳送交易。",
    "帳戶授權介面回傳 HTTP 405，請聯絡 Wallet 提供方檢查介面相容性。此次沒有簽名或傳送交易。",
    "策略來源連線失敗，請檢查網路後重試。此次沒有簽名或傳送交易。",
    "無法驗證策略來源身分，請聯絡 Wallet 提供方；不要繞過驗證。此次沒有簽名或傳送交易。"
  ],
  "ja": [
    "信頼できるポリシーソースが提供されていません。Wallet の提供元に連絡してください。署名や送信は行われていません。",
    "アカウント認可エンドポイントが HTTP 405 を返しました。互換性について Wallet の提供元に連絡してください。署名や送信は行われていません。",
    "ポリシーソースへの接続に失敗しました。接続を確認して再試行してください。署名や送信は行われていません。",
    "ポリシーソースの身元を確認できません。Wallet の提供元に連絡し、検証を回避しないでください。署名や送信は行われていません。"
  ],
  "ko": [
    "신뢰할 수 있는 정책 소스가 제공되지 않았습니다. Wallet 제공자에게 문의하세요. 서명이나 전송은 없었습니다.",
    "계정 승인 엔드포인트가 HTTP 405를 반환했습니다. Wallet 제공자에게 호환성을 문의하세요. 서명이나 전송은 없었습니다.",
    "정책 소스 연결에 실패했습니다. 연결을 확인하고 다시 시도하세요. 서명이나 전송은 없었습니다.",
    "정책 소스의 신원을 확인할 수 없습니다. Wallet 제공자에게 문의하고 검증을 우회하지 마세요. 서명이나 전송은 없었습니다."
  ],
  "es": [
    "No se proporcionó la fuente de políticas fiable. Contacta con el proveedor de Wallet. No se firmó ni envió ninguna transacción.",
    "El endpoint de autorización de cuenta devolvió HTTP 405. Consulta la compatibilidad con el proveedor de Wallet. No se firmó ni envió ninguna transacción.",
    "Falló la conexión con la fuente de políticas. Comprueba la conexión e inténtalo de nuevo. No se firmó ni envió ninguna transacción.",
    "No se pudo verificar la identidad de la fuente de políticas. Contacta con el proveedor de Wallet; no evites la verificación. No se firmó ni envió ninguna transacción."
  ],
  "fr": [
    "La source de politique fiable n’est pas fournie. Contactez le fournisseur Wallet. Aucune transaction n’a été signée ou envoyée.",
    "Le point d’autorisation du compte a renvoyé HTTP 405. Contactez le fournisseur Wallet pour vérifier la compatibilité. Aucune transaction n’a été signée ou envoyée.",
    "La connexion à la source de politique a échoué. Vérifiez la connexion et réessayez. Aucune transaction n’a été signée ou envoyée.",
    "L’identité de la source de politique n’a pas pu être vérifiée. Contactez le fournisseur Wallet ; ne contournez pas la vérification. Aucune transaction n’a été signée ou envoyée."
  ],
  "de": [
    "Die vertrauenswürdige Richtlinienquelle wurde nicht bereitgestellt. Wende dich an den Wallet-Anbieter. Es wurde keine Transaktion signiert oder gesendet.",
    "Der Kontoautorisierungs-Endpunkt antwortete mit HTTP 405. Bitte den Wallet-Anbieter um eine Kompatibilitätsprüfung. Es wurde keine Transaktion signiert oder gesendet.",
    "Die Verbindung zur Richtlinienquelle ist fehlgeschlagen. Prüfe die Verbindung und versuche es erneut. Es wurde keine Transaktion signiert oder gesendet.",
    "Die Identität der Richtlinienquelle konnte nicht geprüft werden. Wende dich an den Wallet-Anbieter und umgehe die Prüfung nicht. Es wurde keine Transaktion signiert oder gesendet."
  ],
  "pt": [
    "A fonte confiável de política não foi fornecida. Contate o provedor da Wallet. Nenhuma transação foi assinada ou enviada.",
    "O endpoint de autorização da conta retornou HTTP 405. Consulte o provedor da Wallet sobre a compatibilidade. Nenhuma transação foi assinada ou enviada.",
    "A conexão com a fonte de política falhou. Verifique a conexão e tente novamente. Nenhuma transação foi assinada ou enviada.",
    "Não foi possível verificar a identidade da fonte de política. Contate o provedor da Wallet e não ignore a verificação. Nenhuma transação foi assinada ou enviada."
  ],
  "ru": [
    "Доверенный источник политики не предоставлен. Обратитесь к поставщику Wallet. Транзакция не подписана и не отправлена.",
    "Конечная точка авторизации аккаунта вернула HTTP 405. Обратитесь к поставщику Wallet для проверки совместимости. Транзакция не подписана и не отправлена.",
    "Ошибка подключения к источнику политики. Проверьте соединение и повторите попытку. Транзакция не подписана и не отправлена.",
    "Не удалось проверить подлинность источника политики. Обратитесь к поставщику Wallet и не обходите проверку. Транзакция не подписана и не отправлена."
  ],
  "ar": [
    "لم يُقدَّم مصدر السياسة الموثوق. اتصل بمزوّد Wallet. لم تُوقّع معاملة ولم تُرسل.",
    "أرجعت نقطة تفويض الحساب HTTP 405. اتصل بمزوّد Wallet للتحقق من توافق الواجهة. لم تُوقّع معاملة ولم تُرسل.",
    "فشل الاتصال بمصدر السياسة. تحقق من الاتصال وحاول مجددًا. لم تُوقّع معاملة ولم تُرسل.",
    "تعذر التحقق من هوية مصدر السياسة. اتصل بمزوّد Wallet ولا تتجاوز التحقق. لم تُوقّع معاملة ولم تُرسل."
  ],
  "id": [
    "Sumber kebijakan tepercaya tidak tersedia. Hubungi penyedia Wallet. Tidak ada transaksi yang ditandatangani atau dikirim.",
    "Endpoint otorisasi akun mengembalikan HTTP 405. Hubungi penyedia Wallet untuk memeriksa kompatibilitas. Tidak ada transaksi yang ditandatangani atau dikirim.",
    "Koneksi ke sumber kebijakan gagal. Periksa koneksi dan coba lagi. Tidak ada transaksi yang ditandatangani atau dikirim.",
    "Identitas sumber kebijakan tidak dapat diverifikasi. Hubungi penyedia Wallet dan jangan lewati verifikasi. Tidak ada transaksi yang ditandatangani atau dikirim."
  ]
};
export const POLICY_FAILURE_COPY=Object.freeze(Object.fromEntries(Object.entries(policyFailureRows).map(([locale,values])=>[locale,Object.freeze(Object.fromEntries(POLICY_FAILURE_KEYS.map((key,index)=>[key,values[index]])))])));
export const NATIVE_AMOUNT_RANGE_COPY=Object.freeze({en:NATIVE_AMOUNT_RANGE_KEY,...{
  "zh-Hans": "最高转账金额为 9223372036854775806 YNXT；加上固定手续费 1 YNXT 后，总额不能超过 9223372036854775807 YNXT。",
  "zh-Hant": "最高轉帳金額為 9223372036854775806 YNXT；加上固定手續費 1 YNXT 後，總額不能超過 9223372036854775807 YNXT。",
  "ja": "送金額の上限は 9223372036854775806 YNXT です。固定手数料 1 YNXT を含む合計は 9223372036854775807 YNXT を超えられません。",
  "ko": "최대 전송 금액은 9223372036854775806 YNXT입니다. 고정 수수료 1 YNXT를 포함한 총액은 9223372036854775807 YNXT를 초과할 수 없습니다.",
  "es": "Importe máximo: 9223372036854775806 YNXT. El total, incluida la comisión fija de 1 YNXT, no puede superar 9223372036854775807 YNXT.",
  "fr": "Montant maximal : 9223372036854775806 YNXT. Le total, incluant les frais fixes de 1 YNXT, ne peut pas dépasser 9223372036854775807 YNXT.",
  "de": "Höchstbetrag: 9223372036854775806 YNXT. Die Summe einschließlich der festen Gebühr von 1 YNXT darf 9223372036854775807 YNXT nicht überschreiten.",
  "pt": "Valor máximo: 9223372036854775806 YNXT. O total, incluindo a taxa fixa de 1 YNXT, não pode exceder 9223372036854775807 YNXT.",
  "ru": "Максимальная сумма: 9223372036854775806 YNXT. Общая сумма с фиксированной комиссией 1 YNXT не может превышать 9223372036854775807 YNXT.",
  "ar": "الحد الأقصى للمبلغ هو 9223372036854775806 YNXT. لا يمكن أن يتجاوز الإجمالي، بما في ذلك الرسوم الثابتة البالغة 1 YNXT، مقدار 9223372036854775807 YNXT.",
  "id": "Jumlah maksimum: 9223372036854775806 YNXT. Total termasuk biaya tetap 1 YNXT tidak boleh melebihi 9223372036854775807 YNXT."
}});
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
