import type { WalletLocale } from "./i18n";

const keys = ["title", "sandbox", "application", "nickname", "useCase", "limit", "risk", "terms", "accepted", "approve"] as const;
type Key = typeof keys[number];
type Copy = readonly [string, string, string, string, string, string, string, string, string, string];
const messages: Readonly<Record<WalletLocale, Copy>> = {
  en: ["Approve Testnet Card application", "This approves a sandbox application only. Test YNXT has no payment value. No funds are transferred and no mainnet payment card is issued.", "Application", "Card name", "Intended use", "Test YNXT limit", "Testnet risk acceptance", "Terms version", "Accepted in this application", "Approve this application"],
  "zh-Hans": ["批准测试网 Card 申请", "仅批准沙盒申请。测试 YNXT 没有支付价值，不会转移资金，也不会发行主网支付卡。", "申请编号", "卡片名称", "使用用途", "测试 YNXT 限额", "测试网风险确认", "条款版本", "此申请已确认", "批准此申请"],
  "zh-Hant": ["核准測試網 Card 申請", "僅核准沙盒申請。測試 YNXT 沒有支付價值，不會轉移資金，也不會發行主網支付卡。", "申請編號", "卡片名稱", "使用用途", "測試 YNXT 限額", "測試網風險確認", "條款版本", "此申請已確認", "核准此申請"],
  ja: ["テストネット Card 申請を承認", "サンドボックス申請のみを承認します。テスト YNXT に支払い価値はありません。資金移動やメインネットの決済カード発行は行いません。", "申請番号", "カード名", "利用目的", "テスト YNXT 上限", "テストネットリスクの確認", "規約バージョン", "この申請で確認済み", "この申請を承認"],
  ko: ["테스트넷 Card 신청 승인", "샌드박스 신청만 승인합니다. 테스트 YNXT는 결제 가치가 없습니다. 자금 이체나 메인넷 결제 카드 발급은 이루어지지 않습니다.", "신청 번호", "카드 이름", "사용 목적", "테스트 YNXT 한도", "테스트넷 위험 확인", "약관 버전", "이 신청에서 확인됨", "이 신청 승인"],
  es: ["Aprobar solicitud de Card de testnet", "Solo se aprueba una solicitud de prueba. YNXT de prueba no tiene valor de pago. No se transfieren fondos ni se emite una tarjeta de pago de mainnet.", "Solicitud", "Nombre de la tarjeta", "Uso previsto", "Límite de YNXT de prueba", "Aceptación del riesgo de testnet", "Versión de los términos", "Aceptado en esta solicitud", "Aprobar esta solicitud"],
  fr: ["Approuver la demande Card de testnet", "Cette approbation concerne uniquement une demande de test. Le YNXT de test n’a aucune valeur de paiement. Aucun fonds n’est transféré et aucune carte de paiement mainnet n’est émise.", "Demande", "Nom de la carte", "Utilisation prévue", "Limite de YNXT de test", "Acceptation du risque testnet", "Version des conditions", "Accepté dans cette demande", "Approuver cette demande"],
  de: ["Testnet-Card-Antrag genehmigen", "Dies genehmigt nur einen Sandbox-Antrag. Test-YNXT hat keinen Zahlungswert. Es werden weder Mittel übertragen noch Mainnet-Zahlungskarten ausgegeben.", "Antrag", "Kartenname", "Verwendungszweck", "Test-YNXT-Limit", "Bestätigung des Testnet-Risikos", "Version der Bedingungen", "In diesem Antrag bestätigt", "Diesen Antrag genehmigen"],
  pt: ["Aprovar solicitação de Card de testnet", "Esta aprovação vale apenas para uma solicitação de teste. YNXT de teste não tem valor de pagamento. Nenhum fundo é transferido e nenhum cartão de pagamento da mainnet é emitido.", "Solicitação", "Nome do cartão", "Uso pretendido", "Limite de YNXT de teste", "Aceitação do risco de testnet", "Versão dos termos", "Aceito nesta solicitação", "Aprovar esta solicitação"],
  ru: ["Одобрить заявку Card в тестовой сети", "Одобряется только тестовая заявка. Тестовый YNXT не имеет платёжной ценности. Средства не переводятся, платёжная карта основной сети не выпускается.", "Заявка", "Название карты", "Назначение", "Лимит тестового YNXT", "Принятие риска тестовой сети", "Версия условий", "Подтверждено в этой заявке", "Одобрить эту заявку"],
  ar: ["الموافقة على طلب Card التجريبي", "تقتصر الموافقة على طلب تجريبي. لا تحمل YNXT التجريبية قيمة للدفع. لن تُحوّل أموال ولن تُصدر بطاقة دفع للشبكة الرئيسية.", "الطلب", "اسم البطاقة", "الغرض من الاستخدام", "حد YNXT التجريبية", "قبول مخاطر الشبكة التجريبية", "إصدار الشروط", "تم القبول في هذا الطلب", "الموافقة على هذا الطلب"],
  id: ["Setujui pengajuan Card testnet", "Persetujuan ini hanya untuk pengajuan sandbox. YNXT uji tidak memiliki nilai pembayaran. Tidak ada dana yang ditransfer atau kartu pembayaran mainnet yang diterbitkan.", "Pengajuan", "Nama kartu", "Tujuan penggunaan", "Batas YNXT uji", "Penerimaan risiko testnet", "Versi ketentuan", "Diterima dalam pengajuan ini", "Setujui pengajuan ini"],
};
export function cardApprovalCopy(locale: WalletLocale, key: Key): string {
  // Key is restricted to the ten tuple positions declared above.
  return messages[locale][keys.indexOf(key)]!;
}

/** Decimal string only: no rounding of uint256 wei limits in the approval UI. */
export function cardApprovalLimitYNXT(wei: string): string {
  if (!/^[1-9][0-9]{0,77}$/.test(wei) || BigInt(wei) > 2n ** 256n - 1n) throw new Error("Invalid Card approval limit");
  const padded = wei.padStart(19, "0");
  const fractional = padded.slice(-18).replace(/0+$/, "");
  return padded.slice(0, -18) + (fractional ? "." + fractional : "");
}
