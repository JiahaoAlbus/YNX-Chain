import type {WalletLocale} from "./i18n";
const COPY:Readonly<Record<WalletLocale,readonly [string,string,string,string]>>={
  "en": [
    "Retry prior local removals",
    "Retry only account removals already confirmed on this device. Saved accounts are retained. This does not revoke app sessions or confirm remote deletion. System biometrics are required.",
    "Review and retry",
    "Local retry finished. Original account state reloaded; remote cleanup is not confirmed."
  ],
  "zh-Hans": [
    "重试先前的本地移除",
    "仅重试您已在此设备确认的账户移除，保留仍已保存的账户。这不会撤销应用会话或确认远程删除。需要系统生物识别。",
    "审阅并重试",
    "本地重试已结束，已重新读取原账户状态；远程清理尚未确认。"
  ],
  "zh-Hant": [
    "重試先前的本機移除",
    "僅重試您已在此裝置確認的帳戶移除，保留仍已儲存的帳戶。這不會撤銷應用程式工作階段或確認遠端刪除。需要系統生物辨識。",
    "檢閱並重試",
    "本機重試已結束，已重新讀取原帳戶狀態；遠端清理尚未確認。"
  ],
  "ja": [
    "以前の端末内削除を再試行",
    "この端末で確認済みのアカウント削除のみ再試行します。保存済みアカウントは保持されます。アプリのセッション失効や遠隔削除の確認は行いません。システムの生体認証が必要です。",
    "確認して再試行",
    "端末内の再試行が終了し、元のアカウント状態を再読み込みしました。遠隔削除は未確認です。"
  ],
  "ko": [
    "이전 기기 내 삭제 재시도",
    "이 기기에서 이미 확인한 계정 삭제만 재시도합니다. 저장된 계정은 유지됩니다. 앱 세션을 취소하거나 원격 삭제를 확인하지 않습니다. 시스템 생체 인증이 필요합니다.",
    "검토 후 재시도",
    "기기 내 재시도가 끝나 원래 계정 상태를 다시 읽었습니다. 원격 정리는 확인되지 않았습니다."
  ],
  "es": [
    "Reintentar eliminaciones locales anteriores",
    "Solo se reintentan eliminaciones de cuentas ya confirmadas en este dispositivo. Se conservan las cuentas guardadas. No revoca sesiones ni confirma la eliminación remota. Se requiere biometría del sistema.",
    "Revisar y reintentar",
    "Reintento local terminado. Estado original de cuentas recargado; limpieza remota sin confirmar."
  ],
  "fr": [
    "Réessayer les suppressions locales antérieures",
    "Seules les suppressions déjà confirmées sur cet appareil sont réessayées. Les comptes enregistrés sont conservés. Aucune session révoquée ni suppression distante confirmée. Biométrie système requise.",
    "Vérifier et réessayer",
    "Nouvel essai local terminé. État initial des comptes rechargé ; nettoyage distant non confirmé."
  ],
  "de": [
    "Frühere lokale Entfernungen erneut versuchen",
    "Nur bereits auf diesem Gerät bestätigte Kontoentfernungen werden erneut versucht. Gespeicherte Konten bleiben erhalten. Keine Sitzungen werden widerrufen und keine entfernte Löschung bestätigt. Systembiometrie ist erforderlich.",
    "Prüfen und erneut versuchen",
    "Lokaler Versuch beendet. Ursprünglicher Kontostand neu geladen; entfernte Bereinigung nicht bestätigt."
  ],
  "pt": [
    "Repetir remoções locais anteriores",
    "Repete apenas remoções de contas já confirmadas neste dispositivo. As contas guardadas são mantidas. Não revoga sessões nem confirma exclusão remota. Exige biometria do sistema.",
    "Rever e repetir",
    "Tentativa local concluída. Estado original das contas recarregado; limpeza remota não confirmada."
  ],
  "ru": [
    "Повторить прежнее локальное удаление",
    "Повторяются только удаления аккаунтов, уже подтверждённые на этом устройстве. Сохранённые аккаунты остаются. Сеансы не отзываются, удалённое удаление не подтверждается. Нужна системная биометрия.",
    "Проверить и повторить",
    "Локальная попытка завершена. Исходное состояние аккаунтов перечитано; удалённая очистка не подтверждена."
  ],
  "ar": [
    "إعادة محاولة عمليات الإزالة المحلية السابقة",
    "تتم إعادة محاولة إزالة الحسابات التي أكدتها سابقاً على هذا الجهاز فقط. تبقى الحسابات المحفوظة. لا تُلغى جلسات التطبيقات ولا يُؤكد الحذف عن بُعد. يلزم التحقق الحيوي للنظام.",
    "المراجعة وإعادة المحاولة",
    "انتهت المحاولة المحلية وأعيد تحميل حالة الحسابات الأصلية؛ لم يتأكد التنظيف عن بُعد."
  ],
  "id": [
    "Coba lagi penghapusan lokal sebelumnya",
    "Hanya penghapusan akun yang sudah dikonfirmasi di perangkat ini yang dicoba lagi. Akun tersimpan dipertahankan. Tidak mencabut sesi aplikasi atau mengonfirmasi penghapusan jarak jauh. Biometrik sistem diperlukan.",
    "Tinjau dan coba lagi",
    "Percobaan lokal selesai. Status akun asli dimuat ulang; pembersihan jarak jauh belum dikonfirmasi."
  ]
};
export function pendingRemovalCopy(locale:WalletLocale){if(!Object.prototype.hasOwnProperty.call(COPY,locale))throw new Error("Unsupported Wallet locale");const [title,body,confirm,finished]=COPY[locale];return Object.freeze({title,body,confirm,finished})}
