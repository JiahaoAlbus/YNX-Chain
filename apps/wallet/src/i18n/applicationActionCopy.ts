import type { WalletLocale } from "./i18n";

// Labels and explanations only. Protocol values remain unchanged in the review.
const en = {
  title: "Sign DEX action",
  unverifiedOrigin: "The request claims this origin. Wallet has not authenticated the sending app.",
  signOnly: "Signing allows this exact action to be submitted. No transaction is sent by this screen.",
  action: "Action", fee: "Fee", nonce: "Nonce", payload: "Action data", sign: "Sign this action",
  units: "Amounts are native asset base units, not EVM wei. Check the pool and limits.",
  swapInput: "Swap with exact input", swapOutput: "Swap with exact output",
  addLiquidity: "Add liquidity", removeLiquidity: "Remove liquidity",
} as const;
type ApplicationActionCopy = Record<keyof typeof en, string>;
const messages: Readonly<Record<WalletLocale, ApplicationActionCopy>> = {
  en,
  "zh-Hans": {
    title: "签署 DEX 操作",
    unverifiedOrigin: "这是请求声称的来源。Wallet 尚未验证发起应用的身份。",
    signOnly: "签名允许提交这项确切的操作。此页面不会发送交易。",
    action: "操作", fee: "手续费", nonce: "Nonce（防重放序号）", payload: "操作数据", sign: "签署此操作",
    units: "金额使用原生资产的基本单位，不是 EVM wei。请核对流动性池和限额。",
    swapInput: "兑换（固定输入数量）", swapOutput: "兑换（固定输出数量）",
    addLiquidity: "添加流动性", removeLiquidity: "移除流动性",
  },
  "zh-Hant": {
    title: "簽署 DEX 操作",
    unverifiedOrigin: "這是請求聲稱的來源。Wallet 尚未驗證發起應用程式的身分。",
    signOnly: "簽名允許提交這項確切的操作。此頁面不會傳送交易。",
    action: "操作", fee: "手續費", nonce: "Nonce（防重放序號）", payload: "操作資料", sign: "簽署此操作",
    units: "金額使用原生資產的基本單位，不是 EVM wei。請核對流動性池和限額。",
    swapInput: "兌換（固定輸入數量）", swapOutput: "兌換（固定輸出數量）",
    addLiquidity: "新增流動性", removeLiquidity: "移除流動性",
  },
  ja: {
    title: "DEX 操作に署名",
    unverifiedOrigin: "これはリクエストが申告した送信元です。Wallet は送信アプリの身元を認証していません。",
    signOnly: "署名すると、この内容の操作を送信できるようになります。この画面からトランザクションは送信されません。",
    action: "操作", fee: "手数料", nonce: "Nonce（リプレイ防止番号）", payload: "操作データ", sign: "この操作に署名",
    units: "金額はネイティブ資産の基本単位であり、EVM の wei ではありません。プールと制限値を確認してください。",
    swapInput: "入力数量を固定してスワップ", swapOutput: "出力数量を固定してスワップ",
    addLiquidity: "流動性を追加", removeLiquidity: "流動性を引き出す",
  },
  ko: {
    title: "DEX 작업 서명",
    unverifiedOrigin: "요청이 이 출처를 주장합니다. Wallet은 요청을 보낸 앱의 신원을 인증하지 않았습니다.",
    signOnly: "서명하면 이 작업을 이 내용 그대로 제출할 수 있습니다. 이 화면에서는 트랜잭션을 전송하지 않습니다.",
    action: "작업", fee: "수수료", nonce: "Nonce（재전송 방지 번호）", payload: "작업 데이터", sign: "이 작업에 서명",
    units: "금액은 네이티브 자산의 기본 단위이며 EVM wei가 아닙니다. 풀과 한도를 확인하세요.",
    swapInput: "입력 수량을 고정하여 스왑", swapOutput: "출력 수량을 고정하여 스왑",
    addLiquidity: "유동성 추가", removeLiquidity: "유동성 제거",
  },
  es: {
    title: "Firmar acción DEX",
    unverifiedOrigin: "La solicitud declara este origen. Wallet no ha autenticado la aplicación que la envía.",
    signOnly: "La firma permite enviar esta acción exacta. Esta pantalla no envía ninguna transacción.",
    action: "Acción", fee: "Comisión", nonce: "Nonce", payload: "Datos de la acción", sign: "Firmar esta acción",
    units: "Los importes están en unidades base del activo nativo, no en wei de EVM. Comprueba el pool y los límites.",
    swapInput: "Intercambio con entrada exacta", swapOutput: "Intercambio con salida exacta",
    addLiquidity: "Añadir liquidez", removeLiquidity: "Retirar liquidez",
  },
  fr: {
    title: "Signer une action DEX",
    unverifiedOrigin: "La requête déclare cette origine. Wallet n’a pas authentifié l’application émettrice.",
    signOnly: "La signature permet de soumettre cette action précise. Cet écran n’envoie aucune transaction.",
    action: "Action", fee: "Frais", nonce: "Nonce", payload: "Données de l’action", sign: "Signer cette action",
    units: "Les montants sont exprimés en unités de base de l’actif natif, et non en wei EVM. Vérifiez le pool et les limites.",
    swapInput: "Échange avec montant d’entrée exact", swapOutput: "Échange avec montant de sortie exact",
    addLiquidity: "Ajouter de la liquidité", removeLiquidity: "Retirer de la liquidité",
  },
  de: {
    title: "DEX-Aktion signieren",
    unverifiedOrigin: "Die Anfrage gibt diese Herkunft an. Wallet hat die sendende App nicht authentifiziert.",
    signOnly: "Die Signatur erlaubt die Einreichung genau dieser Aktion. Dieser Bildschirm sendet keine Transaktion.",
    action: "Aktion", fee: "Gebühr", nonce: "Nonce", payload: "Aktionsdaten", sign: "Diese Aktion signieren",
    units: "Beträge sind in Basiseinheiten des nativen Assets angegeben, nicht in EVM-Wei. Prüfen Sie den Pool und die Grenzwerte.",
    swapInput: "Tausch mit exaktem Eingabebetrag", swapOutput: "Tausch mit exaktem Ausgabebetrag",
    addLiquidity: "Liquidität hinzufügen", removeLiquidity: "Liquidität entfernen",
  },
  pt: {
    title: "Assinar ação DEX",
    unverifiedOrigin: "A solicitação declara esta origem. A Wallet não autenticou o aplicativo que a enviou.",
    signOnly: "A assinatura permite enviar exatamente esta ação. Nenhuma transação é enviada por esta tela.",
    action: "Ação", fee: "Taxa", nonce: "Nonce", payload: "Dados da ação", sign: "Assinar esta ação",
    units: "Os valores estão em unidades base do ativo nativo, não em wei da EVM. Confira o pool e os limites.",
    swapInput: "Troca com entrada exata", swapOutput: "Troca com saída exata",
    addLiquidity: "Adicionar liquidez", removeLiquidity: "Retirar liquidez",
  },
  ru: {
    title: "Подписать действие DEX",
    unverifiedOrigin: "Этот источник указан в запросе. Wallet не проверял подлинность отправившего приложения.",
    signOnly: "Подпись позволяет отправить именно это действие. С этого экрана транзакция не отправляется.",
    action: "Действие", fee: "Комиссия", nonce: "Nonce", payload: "Данные действия", sign: "Подписать это действие",
    units: "Суммы указаны в базовых единицах нативного актива, а не в wei EVM. Проверьте пул и ограничения.",
    swapInput: "Обмен с точной входной суммой", swapOutput: "Обмен с точной выходной суммой",
    addLiquidity: "Добавить ликвидность", removeLiquidity: "Удалить ликвидность",
  },
  ar: {
    title: "توقيع إجراء DEX",
    unverifiedOrigin: "يذكر الطلب أن هذا هو مصدره. لم تتحقق Wallet من هوية التطبيق المُرسِل.",
    signOnly: "يتيح التوقيع تقديم هذا الإجراء المحدد. لا تُرسل أي معاملة من هذه الشاشة.",
    action: "الإجراء", fee: "الرسوم", nonce: "Nonce (رقم منع إعادة الاستخدام)", payload: "بيانات الإجراء", sign: "توقيع هذا الإجراء",
    units: "المبالغ بوحدات الأصل الأصلي الأساسية، وليست بوحدة wei في EVM. تحقق من مجمّع السيولة والحدود.",
    swapInput: "مبادلة بمبلغ إدخال محدد", swapOutput: "مبادلة بمبلغ إخراج محدد",
    addLiquidity: "إضافة سيولة", removeLiquidity: "سحب السيولة",
  },
  id: {
    title: "Tandatangani tindakan DEX",
    unverifiedOrigin: "Permintaan ini mengklaim asal ini. Wallet belum mengautentikasi aplikasi pengirim.",
    signOnly: "Tanda tangan mengizinkan pengajuan tindakan ini persis sesuai isinya. Layar ini tidak mengirim transaksi.",
    action: "Tindakan", fee: "Biaya", nonce: "Nonce", payload: "Data tindakan", sign: "Tandatangani tindakan ini",
    units: "Jumlah menggunakan satuan dasar aset native, bukan wei EVM. Periksa pool dan batasnya.",
    swapInput: "Swap dengan jumlah input pasti", swapOutput: "Swap dengan jumlah output pasti",
    addLiquidity: "Tambah likuiditas", removeLiquidity: "Tarik likuiditas",
  },
};

export function applicationActionCopy(locale: WalletLocale, key: keyof ApplicationActionCopy): string {
  return messages[locale][key];
}
