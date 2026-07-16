export const locales = [
  "en",
  "zh-Hans",
  "zh-Hant",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "pt",
  "ru",
  "ar",
  "id",
] as const;
export type Locale = (typeof locales)[number];
export const localeNames: Record<Locale, string> = {
  en: "English",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
  ru: "Русский",
  ar: "العربية",
  id: "Bahasa Indonesia",
};
const en = {
  Language: "Language",
  "Use system language": "Use system language",
  "Sign in with YNX Wallet": "Sign in with YNX Wallet",
  "Private conversations, thoughtful moments, and people you choose.":
    "Private conversations, thoughtful moments, and people you choose.",
  "Social never creates, imports, or receives your recovery key.":
    "Social never creates, imports, or receives your recovery key.",
  "Restoring private Social session…": "Restoring private Social session…",
  People: "People",
  Messages: "Messages",
  Moments: "Moments",
  Alerts: "Alerts",
  Me: "Me",
  Private: "Private",
  Cancel: "Cancel",
  Retry: "Retry",
  Close: "Close",
  Save: "Save",
  Delete: "Delete",
  Block: "Block",
  Mute: "Mute",
  Accept: "Accept",
  Reject: "Reject",
  Withdraw: "Withdraw",
  Offline: "Offline",
  "Provider unavailable": "Provider unavailable",
  "No conversations yet": "No conversations yet",
  "Your circle starts here": "Your circle starts here",
  "Nothing new": "Nothing new",
  "No moments yet": "No moments yet",
  "Privacy & discovery": "Privacy & discovery",
  "Export my Social data": "Export my Social data",
  "Delete my Social data": "Delete my Social data",
  "Sign out": "Sign out",
  "AI privacy preview": "AI privacy preview",
  "Provider / model": "Provider / model",
  "Estimated cost": "Estimated cost",
  "Allow once": "Allow once",
  "Review before applying": "Review before applying",
  Apply: "Apply",
  "Correction / appeal": "Correction / appeal",
  "AI output language": "AI output language",
  "No Wallet sign-in request is pending":
    "No Wallet sign-in request is pending",
  "Wallet approval signature is invalid":
    "Wallet approval signature is invalid",
  "Wallet callback route or envelope fields are invalid":
    "Wallet callback route or envelope fields are invalid",
  "Contacts permission was not granted": "Contacts permission was not granted",
  "Photo access is required only for the image you choose":
    "Photo access is required only for the image you choose",
  "Camera access is used only while you scan a Social profile QR.":
    "Camera access is used only while you scan a Social profile QR.",
  "Allow camera for this scan": "Allow camera for this scan",
  "Camera permission is unavailable. Paste the QR payload instead.":
    "Camera permission is unavailable. Paste the QR payload instead.",
  "Wallet addresses cannot be used to add friends":
    "Wallet addresses cannot be used to add friends",
  "Social session is locked": "Social session is locked",
} as const;
type Message = keyof typeof en;
const zhs: Record<Message, string> = {
  Language: "语言",
  "Use system language": "跟随系统",
  "Sign in with YNX Wallet": "使用 YNX Wallet 登录",
  "Private conversations, thoughtful moments, and people you choose.":
    "与你选择的人私密交流，分享真诚动态。",
  "Social never creates, imports, or receives your recovery key.":
    "Social 绝不会创建、导入或接收你的恢复密钥。",
  "Restoring private Social session…": "正在恢复私密 Social 会话…",
  People: "联系人",
  Messages: "消息",
  Moments: "动态",
  Alerts: "通知",
  Me: "我的",
  Private: "私密",
  Cancel: "取消",
  Retry: "重试",
  Close: "关闭",
  Save: "保存",
  Delete: "删除",
  Block: "拉黑",
  Mute: "静音",
  Accept: "接受",
  Reject: "拒绝",
  Withdraw: "撤回",
  Offline: "离线",
  "Provider unavailable": "服务商不可用",
  "No conversations yet": "暂无对话",
  "Your circle starts here": "从这里建立你的联系人圈",
  "Nothing new": "暂无新通知",
  "No moments yet": "暂无动态",
  "Privacy & discovery": "隐私与发现",
  "Export my Social data": "导出我的 Social 数据",
  "Delete my Social data": "删除我的 Social 数据",
  "Sign out": "退出登录",
  "AI privacy preview": "AI 隐私预览",
  "Provider / model": "服务商 / 模型",
  "Estimated cost": "预计费用",
  "Allow once": "仅允许本次",
  "Review before applying": "应用前审核",
  Apply: "应用",
  "Correction / appeal": "更正 / 申诉",
  "AI output language": "AI 输出语言",
  "No Wallet sign-in request is pending": "没有待处理的 Wallet 登录请求",
  "Wallet approval signature is invalid": "Wallet 授权签名无效",
  "Wallet callback route or envelope fields are invalid":
    "Wallet 回调路由或信封字段无效",
  "Contacts permission was not granted": "未授予通讯录权限",
  "Photo access is required only for the image you choose":
    "只需授权访问你选择的图片",
  "Camera access is used only while you scan a Social profile QR.":
    "仅在扫描 Social 个人资料二维码时使用相机。",
  "Allow camera for this scan": "允许本次扫码使用相机",
  "Camera permission is unavailable. Paste the QR payload instead.":
    "相机权限不可用，请改为粘贴二维码内容。",
  "Wallet addresses cannot be used to add friends": "不能使用钱包地址添加好友",
  "Social session is locked": "Social 会话已锁定",
};
const zht: Record<Message, string> = {
  ...zhs,
  Language: "語言",
  "Use system language": "跟隨系統",
  "Sign in with YNX Wallet": "使用 YNX Wallet 登入",
  People: "聯絡人",
  Messages: "訊息",
  Moments: "動態",
  Alerts: "通知",
  Me: "我的",
  Cancel: "取消",
  Retry: "重試",
  Save: "儲存",
  Delete: "刪除",
  Block: "封鎖",
  Accept: "接受",
  Reject: "拒絕",
  "Privacy & discovery": "隱私與探索",
  "Sign out": "登出",
  "Estimated cost": "預估費用",
  "Allow once": "僅允許本次",
  "Review before applying": "套用前審核",
  Apply: "套用",
  "AI output language": "AI 輸出語言",
};
const ja: Record<Message, string> = {
  ...en,
  Language: "言語",
  "Use system language": "システム言語を使用",
  "Sign in with YNX Wallet": "YNX Walletでサインイン",
  "Private conversations, thoughtful moments, and people you choose.":
    "選んだ人と、プライベートな会話や投稿を。",
  "Social never creates, imports, or receives your recovery key.":
    "Socialが復元キーを作成、取り込み、受信することはありません。",
  "Restoring private Social session…": "非公開セッションを復元中…",
  People: "連絡先",
  Messages: "メッセージ",
  Moments: "モーメント",
  Alerts: "通知",
  Me: "自分",
  Private: "非公開",
  Cancel: "キャンセル",
  Retry: "再試行",
  Close: "閉じる",
  Save: "保存",
  Delete: "削除",
  Block: "ブロック",
  Mute: "ミュート",
  Accept: "承認",
  Reject: "拒否",
  Withdraw: "取り消す",
  Offline: "オフライン",
  "Provider unavailable": "プロバイダーを利用できません",
  "No conversations yet": "会話はまだありません",
  "Your circle starts here": "ここからつながりを作りましょう",
  "Nothing new": "新しい通知はありません",
  "No moments yet": "投稿はまだありません",
  "Privacy & discovery": "プライバシーと検索",
  "Export my Social data": "Socialデータを書き出す",
  "Delete my Social data": "Socialデータを削除",
  "Sign out": "サインアウト",
  "AI privacy preview": "AIプライバシープレビュー",
  "Provider / model": "プロバイダー / モデル",
  "Estimated cost": "推定コスト",
  "Allow once": "今回のみ許可",
  "Review before applying": "適用前に確認",
  Apply: "適用",
  "Correction / appeal": "修正 / 異議申立て",
  "AI output language": "AI出力言語",
  "No Wallet sign-in request is pending":
    "保留中のWalletサインイン要求はありません",
  "Wallet approval signature is invalid": "Wallet承認署名が無効です",
  "Wallet callback route or envelope fields are invalid":
    "Walletコールバックが無効です",
  "Contacts permission was not granted":
    "連絡先へのアクセスが許可されていません",
  "Photo access is required only for the image you choose":
    "選択した画像へのアクセスのみ必要です",
  "Wallet addresses cannot be used to add friends":
    "ウォレットアドレスで友達を追加できません",
  "Social session is locked": "Socialセッションはロックされています",
};
const ko: Record<Message, string> = {
  ...en,
  Language: "언어",
  "Use system language": "시스템 언어 사용",
  "Sign in with YNX Wallet": "YNX Wallet으로 로그인",
  People: "연락처",
  Messages: "메시지",
  Moments: "모먼트",
  Alerts: "알림",
  Me: "나",
  Private: "비공개",
  Cancel: "취소",
  Retry: "다시 시도",
  Close: "닫기",
  Save: "저장",
  Delete: "삭제",
  Block: "차단",
  Mute: "음소거",
  Accept: "수락",
  Reject: "거절",
  Withdraw: "철회",
  Offline: "오프라인",
  "Provider unavailable": "제공자를 사용할 수 없음",
  "No conversations yet": "아직 대화가 없습니다",
  "Your circle starts here": "여기서 인맥을 시작하세요",
  "Nothing new": "새 알림 없음",
  "No moments yet": "아직 모먼트가 없습니다",
  "Privacy & discovery": "개인정보 및 검색",
  "Export my Social data": "Social 데이터 내보내기",
  "Delete my Social data": "Social 데이터 삭제",
  "Sign out": "로그아웃",
  "AI privacy preview": "AI 개인정보 미리보기",
  "Provider / model": "제공자 / 모델",
  "Estimated cost": "예상 비용",
  "Allow once": "한 번 허용",
  "Review before applying": "적용 전 검토",
  Apply: "적용",
  "Correction / appeal": "수정 / 이의 제기",
  "AI output language": "AI 출력 언어",
  "No Wallet sign-in request is pending":
    "대기 중인 Wallet 로그인 요청이 없습니다",
  "Wallet approval signature is invalid":
    "Wallet 승인 서명이 유효하지 않습니다",
  "Wallet callback route or envelope fields are invalid":
    "Wallet 콜백이 유효하지 않습니다",
  "Contacts permission was not granted": "연락처 권한이 허용되지 않았습니다",
  "Photo access is required only for the image you choose":
    "선택한 사진에만 접근 권한이 필요합니다",
  "Wallet addresses cannot be used to add friends":
    "지갑 주소로 친구를 추가할 수 없습니다",
  "Social session is locked": "Social 세션이 잠겼습니다",
};
const es: Record<Message, string> = {
  ...en,
  Language: "Idioma",
  "Use system language": "Usar idioma del sistema",
  "Sign in with YNX Wallet": "Iniciar sesión con YNX Wallet",
  People: "Contactos",
  Messages: "Mensajes",
  Moments: "Momentos",
  Alerts: "Avisos",
  Me: "Yo",
  Private: "Privado",
  Cancel: "Cancelar",
  Retry: "Reintentar",
  Close: "Cerrar",
  Save: "Guardar",
  Delete: "Eliminar",
  Block: "Bloquear",
  Mute: "Silenciar",
  Accept: "Aceptar",
  Reject: "Rechazar",
  Withdraw: "Retirar",
  Offline: "Sin conexión",
  "Provider unavailable": "Proveedor no disponible",
  "No conversations yet": "Aún no hay conversaciones",
  "Your circle starts here": "Tu círculo empieza aquí",
  "Nothing new": "Nada nuevo",
  "No moments yet": "Aún no hay momentos",
  "Privacy & discovery": "Privacidad y descubrimiento",
  "Export my Social data": "Exportar mis datos de Social",
  "Delete my Social data": "Eliminar mis datos de Social",
  "Sign out": "Cerrar sesión",
  "AI privacy preview": "Vista previa de privacidad de IA",
  "Provider / model": "Proveedor / modelo",
  "Estimated cost": "Coste estimado",
  "Allow once": "Permitir una vez",
  "Review before applying": "Revisar antes de aplicar",
  Apply: "Aplicar",
  "Correction / appeal": "Corrección / apelación",
  "AI output language": "Idioma de salida de IA",
  "No Wallet sign-in request is pending":
    "No hay una solicitud de inicio de sesión pendiente",
  "Wallet approval signature is invalid": "La firma de aprobación no es válida",
  "Wallet callback route or envelope fields are invalid":
    "La devolución de Wallet no es válida",
  "Contacts permission was not granted":
    "No se concedió permiso para contactos",
  "Photo access is required only for the image you choose":
    "Solo se requiere acceso a la imagen elegida",
  "Wallet addresses cannot be used to add friends":
    "No se pueden usar direcciones de billetera para añadir amigos",
  "Social session is locked": "La sesión de Social está bloqueada",
};
const fr: Record<Message, string> = {
  ...es,
  Language: "Langue",
  "Use system language": "Utiliser la langue du système",
  "Sign in with YNX Wallet": "Se connecter avec YNX Wallet",
  People: "Contacts",
  Messages: "Messages",
  Moments: "Moments",
  Alerts: "Alertes",
  Me: "Moi",
  Private: "Privé",
  Cancel: "Annuler",
  Retry: "Réessayer",
  Close: "Fermer",
  Save: "Enregistrer",
  Delete: "Supprimer",
  Block: "Bloquer",
  Mute: "Masquer",
  Accept: "Accepter",
  Reject: "Refuser",
  Withdraw: "Retirer",
  Offline: "Hors ligne",
  "Provider unavailable": "Fournisseur indisponible",
  "No conversations yet": "Aucune conversation",
  "Your circle starts here": "Votre cercle commence ici",
  "Nothing new": "Rien de nouveau",
  "No moments yet": "Aucun moment",
  "Privacy & discovery": "Confidentialité et découverte",
  "Export my Social data": "Exporter mes données Social",
  "Delete my Social data": "Supprimer mes données Social",
  "Sign out": "Se déconnecter",
  "AI privacy preview": "Aperçu de confidentialité IA",
  "Provider / model": "Fournisseur / modèle",
  "Estimated cost": "Coût estimé",
  "Allow once": "Autoriser une fois",
  "Review before applying": "Vérifier avant application",
  Apply: "Appliquer",
  "Correction / appeal": "Correction / recours",
  "AI output language": "Langue de sortie IA",
  "No Wallet sign-in request is pending":
    "Aucune demande de connexion Wallet en attente",
  "Wallet approval signature is invalid": "La signature Wallet est invalide",
  "Wallet callback route or envelope fields are invalid":
    "Le retour Wallet est invalide",
  "Contacts permission was not granted": "Accès aux contacts non accordé",
  "Photo access is required only for the image you choose":
    "Seule l’image choisie nécessite un accès",
  "Wallet addresses cannot be used to add friends":
    "Impossible d’ajouter un ami par adresse de portefeuille",
  "Social session is locked": "La session Social est verrouillée",
};
const de: Record<Message, string> = {
  ...en,
  Language: "Sprache",
  "Use system language": "Systemsprache verwenden",
  "Sign in with YNX Wallet": "Mit YNX Wallet anmelden",
  People: "Kontakte",
  Messages: "Nachrichten",
  Moments: "Momente",
  Alerts: "Hinweise",
  Me: "Ich",
  Private: "Privat",
  Cancel: "Abbrechen",
  Retry: "Wiederholen",
  Close: "Schließen",
  Save: "Speichern",
  Delete: "Löschen",
  Block: "Blockieren",
  Mute: "Stummschalten",
  Accept: "Annehmen",
  Reject: "Ablehnen",
  Withdraw: "Zurückziehen",
  Offline: "Offline",
  "Provider unavailable": "Anbieter nicht verfügbar",
  "No conversations yet": "Noch keine Unterhaltungen",
  "Your circle starts here": "Dein Kreis beginnt hier",
  "Nothing new": "Nichts Neues",
  "No moments yet": "Noch keine Momente",
  "Privacy & discovery": "Datenschutz und Auffindbarkeit",
  "Export my Social data": "Meine Social-Daten exportieren",
  "Delete my Social data": "Meine Social-Daten löschen",
  "Sign out": "Abmelden",
  "AI privacy preview": "KI-Datenschutzvorschau",
  "Provider / model": "Anbieter / Modell",
  "Estimated cost": "Geschätzte Kosten",
  "Allow once": "Einmal erlauben",
  "Review before applying": "Vor Anwendung prüfen",
  Apply: "Anwenden",
  "Correction / appeal": "Korrektur / Einspruch",
  "AI output language": "KI-Ausgabesprache",
  "No Wallet sign-in request is pending": "Keine Wallet-Anmeldung ausstehend",
  "Wallet approval signature is invalid":
    "Wallet-Genehmigungssignatur ist ungültig",
  "Wallet callback route or envelope fields are invalid":
    "Wallet-Rückgabe ist ungültig",
  "Contacts permission was not granted": "Kontaktzugriff wurde nicht erlaubt",
  "Photo access is required only for the image you choose":
    "Zugriff ist nur für das gewählte Bild nötig",
  "Wallet addresses cannot be used to add friends":
    "Wallet-Adressen können nicht zum Hinzufügen verwendet werden",
  "Social session is locked": "Social-Sitzung ist gesperrt",
};
const pt: Record<Message, string> = {
  ...es,
  Language: "Idioma",
  "Use system language": "Usar idioma do sistema",
  "Sign in with YNX Wallet": "Entrar com YNX Wallet",
  People: "Contatos",
  Messages: "Mensagens",
  Moments: "Momentos",
  Alerts: "Alertas",
  Me: "Eu",
  Private: "Privado",
  Cancel: "Cancelar",
  Retry: "Tentar novamente",
  Close: "Fechar",
  Save: "Salvar",
  Delete: "Excluir",
  Block: "Bloquear",
  Mute: "Silenciar",
  Accept: "Aceitar",
  Reject: "Rejeitar",
  Withdraw: "Retirar",
  Offline: "Offline",
  "Provider unavailable": "Provedor indisponível",
  "No conversations yet": "Nenhuma conversa",
  "Your circle starts here": "Seu círculo começa aqui",
  "Nothing new": "Nada novo",
  "No moments yet": "Nenhum momento",
  "Privacy & discovery": "Privacidade e descoberta",
  "Export my Social data": "Exportar meus dados Social",
  "Delete my Social data": "Excluir meus dados Social",
  "Sign out": "Sair",
  "AI privacy preview": "Prévia de privacidade da IA",
  "Provider / model": "Provedor / modelo",
  "Estimated cost": "Custo estimado",
  "Allow once": "Permitir uma vez",
  "Review before applying": "Revisar antes de aplicar",
  Apply: "Aplicar",
  "Correction / appeal": "Correção / recurso",
  "AI output language": "Idioma de saída da IA",
  "No Wallet sign-in request is pending": "Não há login Wallet pendente",
  "Wallet approval signature is invalid": "Assinatura de aprovação inválida",
  "Wallet callback route or envelope fields are invalid":
    "Retorno da Wallet inválido",
  "Contacts permission was not granted": "Permissão de contatos não concedida",
  "Photo access is required only for the image you choose":
    "Só a imagem escolhida requer acesso",
  "Wallet addresses cannot be used to add friends":
    "Endereços de carteira não podem adicionar amigos",
  "Social session is locked": "Sessão Social bloqueada",
};
const ru: Record<Message, string> = {
  ...en,
  Language: "Язык",
  "Use system language": "Язык системы",
  "Sign in with YNX Wallet": "Войти через YNX Wallet",
  People: "Контакты",
  Messages: "Сообщения",
  Moments: "Публикации",
  Alerts: "Уведомления",
  Me: "Я",
  Private: "Личное",
  Cancel: "Отмена",
  Retry: "Повторить",
  Close: "Закрыть",
  Save: "Сохранить",
  Delete: "Удалить",
  Block: "Заблокировать",
  Mute: "Скрыть",
  Accept: "Принять",
  Reject: "Отклонить",
  Withdraw: "Отозвать",
  Offline: "Нет сети",
  "Provider unavailable": "Провайдер недоступен",
  "No conversations yet": "Диалогов пока нет",
  "Your circle starts here": "Ваш круг начинается здесь",
  "Nothing new": "Ничего нового",
  "No moments yet": "Публикаций пока нет",
  "Privacy & discovery": "Приватность и поиск",
  "Export my Social data": "Экспортировать данные Social",
  "Delete my Social data": "Удалить данные Social",
  "Sign out": "Выйти",
  "AI privacy preview": "Предпросмотр приватности ИИ",
  "Provider / model": "Провайдер / модель",
  "Estimated cost": "Оценка стоимости",
  "Allow once": "Разрешить один раз",
  "Review before applying": "Проверить перед применением",
  Apply: "Применить",
  "Correction / appeal": "Исправление / апелляция",
  "AI output language": "Язык ответа ИИ",
  "No Wallet sign-in request is pending": "Нет ожидающего входа Wallet",
  "Wallet approval signature is invalid": "Подпись Wallet недействительна",
  "Wallet callback route or envelope fields are invalid":
    "Возврат Wallet недействителен",
  "Contacts permission was not granted": "Доступ к контактам не разрешён",
  "Photo access is required only for the image you choose":
    "Нужен доступ только к выбранному фото",
  "Wallet addresses cannot be used to add friends":
    "Нельзя добавлять друзей по адресу кошелька",
  "Social session is locked": "Сеанс Social заблокирован",
};
const ar: Record<Message, string> = {
  ...en,
  Language: "اللغة",
  "Use system language": "استخدام لغة النظام",
  "Sign in with YNX Wallet": "تسجيل الدخول عبر YNX Wallet",
  People: "جهات الاتصال",
  Messages: "الرسائل",
  Moments: "اللحظات",
  Alerts: "التنبيهات",
  Me: "أنا",
  Private: "خاص",
  Cancel: "إلغاء",
  Retry: "إعادة المحاولة",
  Close: "إغلاق",
  Save: "حفظ",
  Delete: "حذف",
  Block: "حظر",
  Mute: "كتم",
  Accept: "قبول",
  Reject: "رفض",
  Withdraw: "سحب",
  Offline: "غير متصل",
  "Provider unavailable": "المزوّد غير متاح",
  "No conversations yet": "لا توجد محادثات بعد",
  "Your circle starts here": "تبدأ دائرتك هنا",
  "Nothing new": "لا جديد",
  "No moments yet": "لا توجد لحظات بعد",
  "Privacy & discovery": "الخصوصية والاكتشاف",
  "Export my Social data": "تصدير بيانات Social",
  "Delete my Social data": "حذف بيانات Social",
  "Sign out": "تسجيل الخروج",
  "AI privacy preview": "معاينة خصوصية الذكاء الاصطناعي",
  "Provider / model": "المزوّد / النموذج",
  "Estimated cost": "التكلفة المقدّرة",
  "Allow once": "السماح مرة واحدة",
  "Review before applying": "المراجعة قبل التطبيق",
  Apply: "تطبيق",
  "Correction / appeal": "تصحيح / استئناف",
  "AI output language": "لغة مخرجات الذكاء الاصطناعي",
  "No Wallet sign-in request is pending": "لا يوجد طلب دخول Wallet معلّق",
  "Wallet approval signature is invalid": "توقيع موافقة Wallet غير صالح",
  "Wallet callback route or envelope fields are invalid":
    "استجابة Wallet غير صالحة",
  "Contacts permission was not granted": "لم يُمنح إذن جهات الاتصال",
  "Photo access is required only for the image you choose":
    "يلزم الوصول إلى الصورة التي تختارها فقط",
  "Wallet addresses cannot be used to add friends":
    "لا يمكن استخدام عنوان المحفظة لإضافة صديق",
  "Social session is locked": "جلسة Social مقفلة",
};
const id: Record<Message, string> = {
  ...en,
  Language: "Bahasa",
  "Use system language": "Gunakan bahasa sistem",
  "Sign in with YNX Wallet": "Masuk dengan YNX Wallet",
  People: "Kontak",
  Messages: "Pesan",
  Moments: "Momen",
  Alerts: "Notifikasi",
  Me: "Saya",
  Private: "Privat",
  Cancel: "Batal",
  Retry: "Coba lagi",
  Close: "Tutup",
  Save: "Simpan",
  Delete: "Hapus",
  Block: "Blokir",
  Mute: "Bisukan",
  Accept: "Terima",
  Reject: "Tolak",
  Withdraw: "Tarik",
  Offline: "Luring",
  "Provider unavailable": "Penyedia tidak tersedia",
  "No conversations yet": "Belum ada percakapan",
  "Your circle starts here": "Lingkaran Anda dimulai di sini",
  "Nothing new": "Tidak ada yang baru",
  "No moments yet": "Belum ada momen",
  "Privacy & discovery": "Privasi dan penemuan",
  "Export my Social data": "Ekspor data Social saya",
  "Delete my Social data": "Hapus data Social saya",
  "Sign out": "Keluar",
  "AI privacy preview": "Pratinjau privasi AI",
  "Provider / model": "Penyedia / model",
  "Estimated cost": "Perkiraan biaya",
  "Allow once": "Izinkan sekali",
  "Review before applying": "Tinjau sebelum menerapkan",
  Apply: "Terapkan",
  "Correction / appeal": "Koreksi / banding",
  "AI output language": "Bahasa keluaran AI",
  "No Wallet sign-in request is pending": "Tidak ada permintaan masuk Wallet",
  "Wallet approval signature is invalid":
    "Tanda tangan persetujuan Wallet tidak valid",
  "Wallet callback route or envelope fields are invalid":
    "Respons Wallet tidak valid",
  "Contacts permission was not granted": "Izin kontak tidak diberikan",
  "Photo access is required only for the image you choose":
    "Akses hanya diperlukan untuk gambar pilihan",
  "Wallet addresses cannot be used to add friends":
    "Alamat dompet tidak dapat digunakan untuk menambah teman",
  "Social session is locked": "Sesi Social terkunci",
};
Object.assign(ko, {
  "Social never creates, imports, or receives your recovery key.":
    "Social은 복구 키를 생성하거나 가져오거나 수신하지 않습니다.",
});
Object.assign(es, {
  "Social never creates, imports, or receives your recovery key.":
    "Social nunca crea, importa ni recibe tu clave de recuperación.",
});
Object.assign(fr, {
  "Social never creates, imports, or receives your recovery key.":
    "Social ne crée, n’importe et ne reçoit jamais votre clé de récupération.",
});
Object.assign(de, {
  "Social never creates, imports, or receives your recovery key.":
    "Social erstellt, importiert oder empfängt niemals deinen Wiederherstellungsschlüssel.",
});
Object.assign(pt, {
  "Social never creates, imports, or receives your recovery key.":
    "O Social nunca cria, importa ou recebe sua chave de recuperação.",
});
Object.assign(ru, {
  "Social never creates, imports, or receives your recovery key.":
    "Social никогда не создаёт, не импортирует и не получает ключ восстановления.",
});
Object.assign(ar, {
  "Social never creates, imports, or receives your recovery key.":
    "لا ينشئ Social مفتاح الاسترداد ولا يستورده أو يستلمه أبداً.",
});
Object.assign(id, {
  "Social never creates, imports, or receives your recovery key.":
    "Social tidak pernah membuat, mengimpor, atau menerima kunci pemulihan Anda.",
});
Object.assign(zht, {
  "Camera access is used only while you scan a Social profile QR.": "相機只會在掃描 Social 個人資料 QR 碼時使用。",
  "Allow camera for this scan": "允許本次掃描使用相機",
  "Camera permission is unavailable. Paste the QR payload instead.": "相機權限不可用，請改為貼上 QR 內容。",
});
Object.assign(ja, {
  "Camera access is used only while you scan a Social profile QR.": "SocialプロフィールのQRを読み取る間だけカメラを使用します。",
  "Allow camera for this scan": "今回のスキャンでカメラを許可",
  "Camera permission is unavailable. Paste the QR payload instead.": "カメラ権限を利用できません。QRの内容を貼り付けてください。",
});
Object.assign(ko, {
  "Camera access is used only while you scan a Social profile QR.": "Social 프로필 QR을 스캔하는 동안에만 카메라를 사용합니다.",
  "Allow camera for this scan": "이번 스캔에 카메라 허용",
  "Camera permission is unavailable. Paste the QR payload instead.": "카메라 권한을 사용할 수 없습니다. QR 내용을 붙여 넣으세요.",
});
Object.assign(es, {
  "Camera access is used only while you scan a Social profile QR.": "La cámara solo se usa mientras escaneas un QR de perfil de Social.",
  "Allow camera for this scan": "Permitir cámara para este escaneo",
  "Camera permission is unavailable. Paste the QR payload instead.": "El permiso de cámara no está disponible. Pega el contenido del QR.",
});
Object.assign(fr, {
  "Camera access is used only while you scan a Social profile QR.": "La caméra est utilisée uniquement pendant le scan d’un QR de profil Social.",
  "Allow camera for this scan": "Autoriser la caméra pour ce scan",
  "Camera permission is unavailable. Paste the QR payload instead.": "L’autorisation caméra est indisponible. Collez le contenu du QR.",
});
Object.assign(de, {
  "Camera access is used only while you scan a Social profile QR.": "Die Kamera wird nur beim Scannen eines Social-Profil-QR-Codes verwendet.",
  "Allow camera for this scan": "Kamera für diesen Scan erlauben",
  "Camera permission is unavailable. Paste the QR payload instead.": "Die Kameraberechtigung ist nicht verfügbar. Füge den QR-Inhalt ein.",
});
Object.assign(pt, {
  "Camera access is used only while you scan a Social profile QR.": "A câmera é usada apenas ao ler um QR de perfil do Social.",
  "Allow camera for this scan": "Permitir câmera nesta leitura",
  "Camera permission is unavailable. Paste the QR payload instead.": "A permissão da câmera não está disponível. Cole o conteúdo do QR.",
});
Object.assign(ru, {
  "Camera access is used only while you scan a Social profile QR.": "Камера используется только во время сканирования QR профиля Social.",
  "Allow camera for this scan": "Разрешить камеру для этого сканирования",
  "Camera permission is unavailable. Paste the QR payload instead.": "Доступ к камере недоступен. Вставьте содержимое QR.",
});
Object.assign(ar, {
  "Camera access is used only while you scan a Social profile QR.": "تُستخدم الكاميرا فقط أثناء مسح رمز QR لملف Social.",
  "Allow camera for this scan": "السماح بالكاميرا لهذا المسح",
  "Camera permission is unavailable. Paste the QR payload instead.": "إذن الكاميرا غير متاح. الصق محتوى رمز QR بدلاً من ذلك.",
});
Object.assign(id, {
  "Camera access is used only while you scan a Social profile QR.": "Kamera hanya digunakan saat memindai QR profil Social.",
  "Allow camera for this scan": "Izinkan kamera untuk pemindaian ini",
  "Camera permission is unavailable. Paste the QR payload instead.": "Izin kamera tidak tersedia. Tempel isi QR sebagai gantinya.",
});
export const catalogs: Record<Locale, Record<Message, string>> = {
  en,
  "zh-Hans": zhs,
  "zh-Hant": zht,
  ja,
  ko,
  es,
  fr,
  de,
  pt,
  ru,
  ar,
  id,
};
let activeLocale: Locale = "en";
export function setActiveLocale(locale: Locale) {
  activeLocale = locale;
}
export function systemLocale(
  languageTag = Intl.DateTimeFormat().resolvedOptions().locale,
): Locale {
  const value = languageTag.toLowerCase();
  if (
    value.startsWith("zh-tw") ||
    value.startsWith("zh-hk") ||
    value.includes("hant")
  )
    return "zh-Hant";
  if (value.startsWith("zh")) return "zh-Hans";
  return locales.find((item) => value.startsWith(item.toLowerCase())) ?? "en";
}
export function translate(
  value: string,
  locale: Locale = activeLocale,
): string {
  return (catalogs[locale] as Record<string, string>)[value] ?? value;
}
export function formatDate(
  value: string | Date,
  locale: Locale = activeLocale,
) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
export function formatNumber(
  value: number,
  locale: Locale = activeLocale,
  options?: Intl.NumberFormatOptions,
) {
  return new Intl.NumberFormat(locale, options).format(value);
}
export function plural(
  value: number,
  forms: { one: string; other: string },
  locale: Locale = activeLocale,
) {
  return new Intl.PluralRules(locale).select(value) === "one"
    ? forms.one
    : forms.other;
}
