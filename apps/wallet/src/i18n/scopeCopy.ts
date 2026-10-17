import { SCOPE_EXPLANATIONS } from "../protocol/registry";
import type { WalletLocale } from "./i18n";

// Presentation only. The registry and controller still decide which scopes may
// be requested; translated text must never be used as an authorization key.
const scopes = [
  "account:read", "card:application:write", "card:controls:write",
  "card:dispute:write", "pay:case:create", "pay:settlement:submit", "profile:link",
] as const;
type Copy = readonly [string, string, string, string, string, string, string, string];
const fallback = "Share only this named permission with the displayed product and device. Review its purpose before approving.";
const messages: Readonly<Record<Exclude<WalletLocale, "en">, Copy>> = {
  "zh-Hans": [
    "共享此账户的公开 ynx1 地址。秘密信息和恢复材料不会离开 Wallet。",
    "仅创建或更新此账户的测试沙盒 Card 申请。",
    "经过单独审核后，仅管理此账户的 Card 控制设置。",
    "创建和更新此账户的 Card 争议申诉；此权限不能移动资金。",
    "为此账户创建 Pay 支持工单，不授权转账。",
    "提交结算请求，供 Pay 单独审核；Wallet 批准不等于支付签名。",
    "允许此指定 Social 设备将公开账户关联到其个人资料。",
    "仅向所显示的产品和设备授予此项具名权限。批准前请核对用途。",
  ],
  "zh-Hant": [
    "分享此帳戶的公開 ynx1 地址。秘密資訊和復原資料不會離開 Wallet。",
    "僅建立或更新此帳戶的測試沙盒 Card 申請。",
    "經過個別審核後，僅管理此帳戶的 Card 控制設定。",
    "建立和更新此帳戶的 Card 爭議申訴；此權限不能移動資金。",
    "為此帳戶建立 Pay 支援案件，不授權轉帳。",
    "提交結算請求，供 Pay 個別審核；Wallet 核准不等於付款簽章。",
    "允許此指定 Social 裝置將公開帳戶連結至其個人資料。",
    "僅向顯示的產品和裝置授予此項具名權限。核准前請確認用途。",
  ],
  ja: [
    "このアカウントの公開 ynx1 アドレスを共有します。秘密情報や復元情報が Wallet の外に出ることはありません。",
    "このアカウントのテスト用サンドボックス Card 申請のみを作成または更新します。",
    "個別の確認後に、このアカウントの Card 管理設定のみを変更します。",
    "このアカウントの Card 異議申し立てを作成・更新します。この権限で資金は移動できません。",
    "このアカウントの Pay サポート案件を作成します。送金は承認しません。",
    "Pay が別途確認する決済依頼を送信します。Wallet の承認は支払いへの署名ではありません。",
    "この特定の Social デバイスが公開アカウントをそのプロフィールに関連付けることを許可します。",
    "表示された製品とデバイスに、この名前の権限のみを与えます。承認前に目的を確認してください。",
  ],
  ko: [
    "이 계정의 공개 ynx1 주소를 공유합니다. 비밀 정보나 복구 자료는 Wallet 밖으로 나가지 않습니다.",
    "이 계정의 테스트 샌드박스 Card 신청만 만들거나 수정합니다.",
    "별도 검토 후 이 계정의 Card 제어 설정만 관리합니다.",
    "이 계정의 Card 이의 신청을 만들고 수정합니다. 이 권한으로 자금을 이동할 수 없습니다.",
    "이 계정의 Pay 지원 요청을 만듭니다. 송금을 승인하지 않습니다.",
    "Pay의 별도 검토를 위한 정산 요청을 제출합니다. Wallet 승인은 결제 서명이 아닙니다.",
    "이 특정 Social 기기가 공개 계정을 해당 프로필에 연결하도록 허용합니다.",
    "표시된 제품과 기기에 명시된 이 권한만 부여합니다. 승인 전에 용도를 확인하세요.",
  ],
  es: [
    "Comparte la dirección pública ynx1 de esta cuenta. Ningún secreto ni material de recuperación sale de Wallet.",
    "Crea o actualiza únicamente la solicitud de Card de esta cuenta en el entorno de pruebas.",
    "Gestiona solo los controles de Card de esta cuenta tras una revisión independiente.",
    "Crea y actualiza disputas de Card de esta cuenta; no permite mover fondos.",
    "Crea un caso de soporte de Pay para esta cuenta sin autorizar una transferencia.",
    "Envía una solicitud de liquidación para una revisión independiente de Pay; aprobar en Wallet no es firmar un pago.",
    "Permite que este dispositivo específico de Social vincule la cuenta pública a su perfil.",
    "Concede solo este permiso identificado al producto y dispositivo mostrados. Revisa su finalidad antes de aprobar.",
  ],
  fr: [
    "Partage l’adresse publique ynx1 de ce compte. Aucun secret ni élément de récupération ne quitte Wallet.",
    "Crée ou modifie uniquement la demande Card de ce compte dans l’environnement de test.",
    "Gère uniquement les paramètres de contrôle Card de ce compte après un examen distinct.",
    "Crée et modifie les contestations Card de ce compte ; ce droit ne permet pas de déplacer des fonds.",
    "Crée un dossier d’assistance Pay pour ce compte sans autoriser de transfert.",
    "Soumet une demande de règlement à un examen distinct par Pay ; l’approbation dans Wallet n’est pas une signature de paiement.",
    "Autorise cet appareil Social précis à associer le compte public à son profil.",
    "Accorde uniquement ce droit nommé au produit et à l’appareil affichés. Vérifiez son objet avant d’approuver.",
  ],
  de: [
    "Teilt die öffentliche ynx1-Adresse dieses Kontos. Geheimnisse und Wiederherstellungsdaten verlassen Wallet nicht.",
    "Erstellt oder aktualisiert nur den Card-Antrag dieses Kontos in der Testumgebung.",
    "Verwaltet nach einer gesonderten Prüfung nur die Card-Kontrolleinstellungen dieses Kontos.",
    "Erstellt und aktualisiert Card-Reklamationen dieses Kontos; diese Berechtigung kann keine Gelder bewegen.",
    "Erstellt einen Pay-Supportfall für dieses Konto, ohne eine Überweisung zu genehmigen.",
    "Reicht einen Abrechnungsantrag zur gesonderten Prüfung durch Pay ein; eine Wallet-Genehmigung ist keine Zahlungssignatur.",
    "Erlaubt genau diesem Social-Gerät, das öffentliche Konto mit seinem Profil zu verknüpfen.",
    "Gewährt dem angezeigten Produkt und Gerät nur diese benannte Berechtigung. Prüfen Sie vor der Genehmigung den Zweck.",
  ],
  pt: [
    "Partilha o endereço público ynx1 desta conta. Nenhum segredo ou material de recuperação sai da Wallet.",
    "Cria ou atualiza apenas a candidatura Card desta conta no ambiente de testes.",
    "Gere apenas os controlos Card desta conta após uma análise separada.",
    "Cria e atualiza contestações Card desta conta; esta permissão não permite movimentar fundos.",
    "Cria um pedido de suporte Pay para esta conta sem autorizar uma transferência.",
    "Envia um pedido de liquidação para análise separada pela Pay; a aprovação na Wallet não é uma assinatura de pagamento.",
    "Permite que este dispositivo Social específico associe a conta pública ao seu perfil.",
    "Concede apenas esta permissão identificada ao produto e dispositivo apresentados. Reveja a finalidade antes de aprovar.",
  ],
  ru: [
    "Передаёт публичный адрес ynx1 этого аккаунта. Секреты и данные восстановления не покидают Wallet.",
    "Создаёт или обновляет только заявку Card этого аккаунта в тестовой среде.",
    "Управляет только настройками контроля Card этого аккаунта после отдельной проверки.",
    "Создаёт и обновляет споры Card этого аккаунта; это разрешение не позволяет перемещать средства.",
    "Создаёт обращение в поддержку Pay для этого аккаунта без разрешения перевода.",
    "Отправляет запрос на расчёт для отдельной проверки Pay; одобрение в Wallet не является подписью платежа.",
    "Разрешает именно этому устройству Social связать публичный аккаунт со своим профилем.",
    "Предоставляет только это указанное разрешение показанным продукту и устройству. Перед одобрением проверьте цель.",
  ],
  ar: [
    "يشارك عنوان ynx1 العام لهذا الحساب. لا تغادر أي أسرار أو مواد استرداد Wallet.",
    "ينشئ أو يحدّث طلب Card لهذا الحساب فقط في بيئة الاختبار المعزولة.",
    "يدير إعدادات التحكم في Card لهذا الحساب فقط بعد مراجعة منفصلة.",
    "ينشئ ويحدّث اعتراضات Card لهذا الحساب؛ لا يتيح هذا الإذن نقل الأموال.",
    "ينشئ طلب دعم Pay لهذا الحساب دون تفويض تحويل أموال.",
    "يقدّم طلب تسوية لمراجعة منفصلة من Pay؛ الموافقة في Wallet ليست توقيعًا على دفعة.",
    "يسمح لجهاز Social المحدد هذا بربط الحساب العام بملفه الشخصي.",
    "يمنح هذا الإذن المسمّى فقط للمنتج والجهاز المعروضين. راجع الغرض قبل الموافقة.",
  ],
  id: [
    "Membagikan alamat ynx1 publik akun ini. Tidak ada rahasia atau materi pemulihan yang keluar dari Wallet.",
    "Hanya membuat atau memperbarui pengajuan Card akun ini di lingkungan uji coba.",
    "Hanya mengelola pengaturan kontrol Card akun ini setelah peninjauan terpisah.",
    "Membuat dan memperbarui sengketa Card akun ini; izin ini tidak dapat memindahkan dana.",
    "Membuat kasus dukungan Pay untuk akun ini tanpa mengizinkan transfer.",
    "Mengajukan permintaan penyelesaian untuk ditinjau secara terpisah oleh Pay; persetujuan Wallet bukan tanda tangan pembayaran.",
    "Mengizinkan perangkat Social tertentu ini menautkan akun publik ke profilnya.",
    "Hanya memberikan izin bernama ini kepada produk dan perangkat yang ditampilkan. Tinjau tujuannya sebelum menyetujui.",
  ],
};

export function scopeExplanation(locale: WalletLocale, scope: string): string {
  const index = (scopes as readonly string[]).indexOf(scope);
  if (locale === "en") return index < 0 ? fallback : SCOPE_EXPLANATIONS[scope]!;
  return messages[locale][index < 0 ? 7 : index]!;
}
