// Stable Wallet error codes choose display guidance. Raw provider messages never
// enter the UI; protocol codes and transaction hashes remain unchanged.
const rows = [
  ["Enter a valid recipient and a positive YNXT amount (up to 18 decimals).", {
    "zh-CN":"请输入有效收款地址和正数 YNXT 金额（最多 18 位小数）。","zh-TW":"請輸入有效收款地址和正數 YNXT 金額（最多 18 位小數）。","ja":"有効な送金先と正の YNXT 金額（小数点以下 18 桁まで）を入力してください。","ko":"올바른 받는 주소와 양수 YNXT 금액(소수점 이하 최대 18자리)을 입력하세요。","es":"Introduce un destinatario válido y un importe positivo de YNXT (hasta 18 decimales).","fr":"Saisissez un destinataire valide et un montant YNXT positif (jusqu’à 18 décimales).","de":"Gültigen Empfänger und positiven YNXT-Betrag eingeben (bis zu 18 Nachkommastellen).","pt":"Digite um destinatário válido e um valor positivo de YNXT (até 18 casas decimais).","ru":"Укажите действительного получателя и положительную сумму YNXT (до 18 знаков после запятой).","ar":"أدخل مستلماً صالحاً ومبلغ YNXT موجباً (حتى 18 منزلة عشرية).","id":"Masukkan penerima yang valid dan jumlah YNXT positif (hingga 18 angka desimal).","hi":"मान्य प्राप्तकर्ता और धनात्मक YNXT राशि दर्ज करें (18 दशमलव स्थान तक)।"
  }],
  ["Insufficient YNXT for the amount and network fee. Reduce the amount or add Testnet funds.", {
    "zh-CN":"YNXT 不足以支付转账金额和网络费。请减少金额或领取测试网资金。","zh-TW":"YNXT 不足以支付轉帳金額和網路費。請減少金額或取得測試網資金。","ja":"送金額とネットワーク手数料を払う YNXT が不足しています。金額を減らすか、テストネット資金を追加してください。","ko":"이체 금액과 네트워크 수수료를 위한 YNXT가 부족합니다. 금액을 줄이거나 테스트넷 자금을 추가하세요。","es":"No hay YNXT suficiente para el importe y la comisión. Reduce el importe o añade fondos de Testnet.","fr":"Solde YNXT insuffisant pour le montant et les frais réseau. Réduisez le montant ou ajoutez des fonds Testnet.","de":"YNXT reicht für Betrag und Netzwerkgebühr nicht aus. Betrag verringern oder Testnet-Guthaben hinzufügen.","pt":"YNXT insuficiente para o valor e a taxa de rede. Reduza o valor ou adicione fundos da Testnet.","ru":"YNXT не хватает на сумму перевода и сетевую комиссию. Уменьшите сумму или пополните тестовый баланс.","ar":"رصيد YNXT لا يكفي للمبلغ ورسوم الشبكة. قلّل المبلغ أو أضف رصيداً على الشبكة التجريبية.","id":"YNXT tidak cukup untuk jumlah dan biaya jaringan. Kurangi jumlah atau tambahkan dana Testnet.","hi":"राशि और नेटवर्क शुल्क के लिए YNXT पर्याप्त नहीं है। राशि घटाएँ या टेस्टनेट फ़ंड जोड़ें।"
  }],
  ["This transfer supports positive whole YNXT amounts only. Enter a whole amount within the supported range.", {
    "zh-CN":"此转账仅支持正整数 YNXT。请输入支持范围内的整数金额。","zh-TW":"此轉帳僅支援正整數 YNXT。請輸入支援範圍內的整數金額。","ja":"この送金は正の整数 YNXT のみ対応しています。対応範囲内の整数を入力してください。","ko":"이 송금은 양의 정수 YNXT만 지원합니다. 지원 범위 내의 정수 금액을 입력하세요。","es":"Esta transferencia solo admite importes enteros positivos de YNXT. Introduce uno dentro del rango admitido.","fr":"Ce transfert accepte uniquement des montants YNXT entiers positifs. Saisissez un montant dans la plage autorisée.","de":"Diese Überweisung unterstützt nur positive ganze YNXT-Beträge. Einen Betrag im zulässigen Bereich eingeben.","pt":"Esta transferência aceita apenas valores inteiros positivos de YNXT. Digite um valor dentro do limite aceito.","ru":"Этот перевод поддерживает только положительные целые суммы YNXT. Укажите сумму в допустимом диапазоне.","ar":"يدعم هذا التحويل مبالغ YNXT الصحيحة الموجبة فقط. أدخل مبلغاً صحيحاً ضمن النطاق المدعوم.","id":"Transfer ini hanya mendukung jumlah YNXT bulat positif. Masukkan jumlah bulat dalam rentang yang didukung.","hi":"यह ट्रांसफ़र केवल धनात्मक पूर्ण YNXT राशि स्वीकार करता है। समर्थित सीमा में पूर्ण राशि दर्ज करें।"
  }],
  ["The request could not be completed. Check the error code and Wallet status before continuing.", {
    "zh-CN":"请求未能完成。继续前请查看错误码和钱包状态。","zh-TW":"要求未能完成。繼續前請檢查錯誤碼和錢包狀態。","ja":"リクエストを完了できませんでした。続行する前にエラーコードとウォレットの状態を確認してください。","ko":"요청을 완료하지 못했습니다. 계속하기 전에 오류 코드와 지갑 상태를 확인하세요。","es":"No se pudo completar la solicitud. Comprueba el código de error y el estado de la cartera antes de continuar.","fr":"La demande n’a pas abouti. Vérifiez le code d’erreur et l’état du portefeuille avant de continuer.","de":"Anfrage nicht abgeschlossen. Fehlercode und Wallet-Status vor dem Fortfahren prüfen.","pt":"A solicitação não foi concluída. Confira o código de erro e o estado da carteira antes de continuar.","ru":"Запрос не завершён. Перед продолжением проверьте код ошибки и состояние кошелька.","ar":"تعذر إكمال الطلب. تحقق من رمز الخطأ وحالة المحفظة قبل المتابعة.","id":"Permintaan tidak dapat diselesaikan. Periksa kode kesalahan dan status Wallet sebelum melanjutkan.","hi":"अनुरोध पूरा नहीं हुआ। आगे बढ़ने से पहले त्रुटि कोड और वॉलेट की स्थिति जाँचें।"
  }],
];
export const ERROR_MESSAGES = Object.freeze(Object.fromEntries(rows.map(([english, values]) => [english, Object.freeze({en:english,...values})])));

export function desktopErrorText(result, t) {
  const error=result?.error;
  const code=typeof error?.code==="string"&&/^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)?error.code:null;
  const stage=typeof error?.storageStage==="string"&&/^[a-z][a-z0-9-]{0,39}$/.test(error.storageStage)?error.storageStage:null;
  const key=error?.outcomeUnknown?"The transaction outcome could not be checked. Keep its hash and try checking again."
    : code==="PASSWORD_VAULT_UNLOCK_FAILED"?"The password is incorrect or this encrypted Wallet changed. It remains locked."
    : code==="PASSWORD_VAULT_FILE_CHANGED"?"The stored Wallet changed. Reopen it before continuing; its previous files were retained."
    : code==="PASSWORD_VAULT_STORAGE_FAILED"?"Wallet storage cannot be read. Existing files are retained; reopen Wallet before continuing."
    : code==="ACCOUNT_NOT_CREATED"?"Create or import an account first"
    : code==="ACCOUNT_CHANGED"?"Your selected account changed. Connect again from the app."
    : code==="INVALID_TRANSFER"?rows[0][0]
    : code==="INSUFFICIENT_FUNDS"?rows[1][0]
    : code==="RPC_AMOUNT_UNSUPPORTED"?rows[2][0]
    : code==="RPC_UNAVAILABLE"||code==="RPC_TIMEOUT"?"The network is unavailable. Your accounts and backups remain accessible. Try again to refresh balances or send."
    : rows[3][0];
  const hash=typeof error?.transactionHash==="string"&&/^0x[0-9a-fA-F]{64}$/.test(error.transactionHash)?error.transactionHash:null;
  return `${t(key)}${code?` (${code}${stage?` · ${stage}`:""})`:""}${hash?` · ${t("Transaction hash")}: ${hash}`:""}`;
}
