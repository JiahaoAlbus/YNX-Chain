/** Display-only copy; never changes topics, origins, or revocation acknowledgements. */
const keys=["Connected apps could not be read. This is not confirmation that no sessions exist.","Try refreshing","No active WalletConnect sessions.","Disconnect and revoke","Session disconnected and local account permission revoked.","Disconnect did not return complete confirmation. Refresh connected apps before deciding whether to retry."];
const rows={
 en:keys,
 "zh-Hans":["无法读取连接应用。这不代表没有会话。","重新刷新","没有活跃的 WalletConnect 会话。","断开并撤销权限","会话已断开，本地账户权限已撤销。","断开操作未返回完整确认。请先刷新连接应用，再决定是否重试。"],
 "zh-Hant":["無法讀取連接應用。這不代表沒有工作階段。","重新整理","沒有活躍的 WalletConnect 工作階段。","中斷並撤銷權限","工作階段已中斷，本機帳戶權限已撤銷。","中斷操作未傳回完整確認。請先重新整理連接應用，再決定是否重試。"],
 ja:["接続アプリを取得できません。セッションがないとは限りません。","再読み込み","有効な WalletConnect セッションはありません。","切断して権限を取り消す","セッションを切断し、ローカルアカウント権限を取り消しました。","切断の完全な確認を取得できませんでした。接続アプリを再読み込みしてから再試行を判断してください。"],
 ko:["연결 앱을 읽을 수 없습니다. 세션이 없다는 확인은 아닙니다.","새로고침","활성 WalletConnect 세션이 없습니다.","연결 해제 및 권한 취소","세션 연결을 해제하고 로컬 계정 권한을 취소했습니다.","연결 해제의 완전한 확인을 받지 못했습니다. 연결 앱을 새로고침한 뒤 재시도 여부를 결정하세요."],
 es:["No se pudieron leer las apps conectadas. Esto no confirma que no existan sesiones.","Actualizar","No hay sesiones activas de WalletConnect.","Desconectar y revocar","Sesión desconectada y permiso local de la cuenta revocado.","La desconexión no devolvió una confirmación completa. Actualiza las apps conectadas antes de decidir si reintentar."],
 fr:["Impossible de lire les applications connectées. Cela ne confirme pas l’absence de sessions.","Actualiser","Aucune session WalletConnect active.","Déconnecter et révoquer","Session déconnectée et autorisation locale du compte révoquée.","La déconnexion n’a pas renvoyé de confirmation complète. Actualisez les applications connectées avant de décider de réessayer."],
 de:["Verbundene Apps konnten nicht gelesen werden. Das bestätigt nicht, dass keine Sitzungen bestehen.","Aktualisieren","Keine aktiven WalletConnect-Sitzungen.","Trennen und widerrufen","Sitzung getrennt und lokale Kontoberechtigung widerrufen.","Die Trennung lieferte keine vollständige Bestätigung. Aktualisieren Sie verbundene Apps, bevor Sie über einen erneuten Versuch entscheiden."],
 pt:["Não foi possível ler os apps conectados. Isso não confirma a ausência de sessões.","Atualizar","Nenhuma sessão ativa do WalletConnect.","Desconectar e revogar","Sessão desconectada e permissão local da conta revogada.","A desconexão não retornou confirmação completa. Atualize os apps conectados antes de decidir se tentará novamente."],
 ru:["Не удалось прочитать подключённые приложения. Это не подтверждает отсутствие сеансов.","Обновить","Нет активных сеансов WalletConnect.","Отключить и отозвать","Сеанс отключён, локальное разрешение аккаунта отозвано.","Отключение не вернуло полного подтверждения. Обновите подключённые приложения, прежде чем решать, повторять ли попытку."],
 ar:["تعذرت قراءة التطبيقات المتصلة. هذا لا يؤكد عدم وجود جلسات.","تحديث","لا توجد جلسات WalletConnect نشطة.","قطع الاتصال وإلغاء الإذن","قُطع اتصال الجلسة وأُلغي إذن الحساب المحلي.","لم يُرجع قطع الاتصال تأكيدًا كاملًا. حدّث التطبيقات المتصلة قبل اتخاذ قرار إعادة المحاولة."],
 id:["Aplikasi terhubung tidak dapat dibaca. Ini bukan konfirmasi bahwa tidak ada sesi.","Segarkan","Tidak ada sesi WalletConnect aktif.","Putuskan dan cabut izin","Sesi diputus dan izin akun lokal dicabut.","Pemutusan tidak mengembalikan konfirmasi lengkap. Segarkan aplikasi terhubung sebelum memutuskan untuk mencoba lagi."]
};
const waitingKeys=["WalletConnect not started","The Relay connection is not yet confirmed. Your wallet and accounts remain accessible."];
const waitingRows={
 en:waitingKeys,
 "zh-Hans":["WalletConnect 尚未启动","尚未确认 Relay 连接。你仍可使用钱包和账户。"],
 "zh-Hant":["WalletConnect 尚未啟動","尚未確認 Relay 連線。你仍可使用錢包和帳戶。"],
 ja:["WalletConnect は未起動です","Relay 接続はまだ確認されていません。ウォレットとアカウントは引き続き利用できます。"],
 ko:["WalletConnect가 아직 시작되지 않았습니다","Relay 연결이 아직 확인되지 않았습니다. 지갑과 계정은 계속 사용할 수 있습니다."],
 es:["WalletConnect no se ha iniciado","La conexión con Relay aún no está confirmada. Tu wallet y tus cuentas siguen accesibles."],
 fr:["WalletConnect n’a pas démarré","La connexion au Relay n’est pas encore confirmée. Votre portefeuille et vos comptes restent accessibles."],
 de:["WalletConnect wurde noch nicht gestartet","Die Relay-Verbindung ist noch nicht bestätigt. Wallet und Konten bleiben zugänglich."],
 pt:["WalletConnect ainda não iniciou","A conexão com o Relay ainda não foi confirmada. Sua carteira e suas contas continuam acessíveis."],
 ru:["WalletConnect ещё не запущен","Соединение с Relay ещё не подтверждено. Кошелёк и аккаунты остаются доступными."],
 ar:["لم يبدأ WalletConnect بعد","لم يتم تأكيد اتصال Relay بعد. تظل محفظتك وحساباتك متاحة."],
 id:["WalletConnect belum dimulai","Koneksi Relay belum dikonfirmasi. Dompet dan akun Anda tetap dapat diakses."]
};
const pairKeys=["Connecting… You can cancel this pairing attempt.","Pairing request submitted. Waiting for a connection proposal; you can cancel this attempt.","Connection proposal received. Review before approving.","Pairing canceled. Request a fresh QR code before retrying.","The pairing attempt did not finish. Request a fresh QR code before retrying.","WalletConnect status could not be confirmed. Refresh the connection status before trying again."];
const pairRows={
  "en": [
    "Connecting… You can cancel this pairing attempt.",
    "Pairing request submitted. Waiting for a connection proposal; you can cancel this attempt.",
    "Connection proposal received. Review before approving.",
    "Pairing canceled. Request a fresh QR code before retrying.",
    "The pairing attempt did not finish. Request a fresh QR code before retrying.",
    "WalletConnect status could not be confirmed. Refresh the connection status before trying again."
  ],
  "zh-Hans": [
    "正在连接…可以取消本次配对。",
    "配对请求已提交，正在等待连接提案；可以取消本次配对。",
    "已收到连接提案，请在批准前核对。",
    "配对已取消，请获取新的二维码后再试。",
    "配对未完成，请获取新的二维码后再试。",
    "无法确认 WalletConnect 状态，请先刷新连接状态再试。"
  ],
  "zh-Hant": [
    "正在連線…可以取消本次配對。",
    "配對請求已提交，正在等待連線提案；可以取消本次配對。",
    "已收到連線提案，請在批准前核對。",
    "配對已取消，請取得新的 QR 碼後再試。",
    "配對未完成，請取得新的 QR 碼後再試。",
    "無法確認 WalletConnect 狀態，請先重新整理連線狀態再試。"
  ],
  "ja": [
    "接続中…このペアリングはキャンセルできます。",
    "ペアリング要求を送信しました。接続提案を待っています。この操作はキャンセルできます。",
    "接続提案を受信しました。承認前に確認してください。",
    "ペアリングをキャンセルしました。新しい QR コードを取得してから再試行してください。",
    "ペアリングは完了しませんでした。新しい QR コードを取得してから再試行してください。",
    "WalletConnect の状態を確認できません。接続状態を更新してから再試行してください。"
  ],
  "ko": [
    "연결 중… 이 페어링을 취소할 수 있습니다.",
    "페어링 요청을 제출했습니다. 연결 제안을 기다리는 중이며 이 시도를 취소할 수 있습니다.",
    "연결 제안을 받았습니다. 승인하기 전에 검토하세요.",
    "페어링을 취소했습니다. 새 QR 코드를 받아 다시 시도하세요.",
    "페어링이 완료되지 않았습니다. 새 QR 코드를 받아 다시 시도하세요.",
    "WalletConnect 상태를 확인할 수 없습니다. 연결 상태를 새로고침한 후 다시 시도하세요."
  ],
  "es": [
    "Conectando… Puedes cancelar este emparejamiento.",
    "Solicitud de emparejamiento enviada. Esperando una propuesta de conexión; puedes cancelar este intento.",
    "Propuesta de conexión recibida. Revísala antes de aprobar.",
    "Emparejamiento cancelado. Solicita un nuevo código QR antes de reintentar.",
    "El emparejamiento no terminó. Solicita un nuevo código QR antes de reintentar.",
    "No se pudo confirmar el estado de WalletConnect. Actualiza el estado antes de reintentar."
  ],
  "fr": [
    "Connexion… Vous pouvez annuler cet appairage.",
    "Demande d’appairage envoyée. En attente d’une proposition de connexion ; vous pouvez annuler cette tentative.",
    "Proposition de connexion reçue. Vérifiez-la avant d’approuver.",
    "Appairage annulé. Demandez un nouveau code QR avant de réessayer.",
    "L’appairage n’a pas abouti. Demandez un nouveau code QR avant de réessayer.",
    "État WalletConnect non confirmé. Actualisez l’état de connexion avant de réessayer."
  ],
  "de": [
    "Verbindung wird hergestellt… Du kannst diese Kopplung abbrechen.",
    "Kopplungsanfrage gesendet. Ein Verbindungsvorschlag wird erwartet; du kannst diesen Versuch abbrechen.",
    "Verbindungsvorschlag erhalten. Vor der Bestätigung prüfen.",
    "Kopplung abgebrochen. Fordere vor einem erneuten Versuch einen neuen QR-Code an.",
    "Kopplung nicht abgeschlossen. Fordere vor einem erneuten Versuch einen neuen QR-Code an.",
    "WalletConnect-Status nicht bestätigt. Aktualisiere vor einem erneuten Versuch den Verbindungsstatus."
  ],
  "pt": [
    "Conectando… Você pode cancelar este pareamento.",
    "Solicitação de pareamento enviada. Aguardando uma proposta de conexão; você pode cancelar esta tentativa.",
    "Proposta de conexão recebida. Revise antes de aprovar.",
    "Pareamento cancelado. Solicite um novo código QR antes de tentar novamente.",
    "O pareamento não foi concluído. Solicite um novo código QR antes de tentar novamente.",
    "Não foi possível confirmar o estado do WalletConnect. Atualize o estado da conexão antes de tentar novamente."
  ],
  "ru": [
    "Подключение… Можно отменить это сопряжение.",
    "Запрос на сопряжение отправлен. Ожидается предложение подключения; эту попытку можно отменить.",
    "Получено предложение подключения. Проверьте его перед одобрением.",
    "Сопряжение отменено. Перед повторной попыткой запросите новый QR-код.",
    "Сопряжение не завершено. Перед повторной попыткой запросите новый QR-код.",
    "Не удалось подтвердить состояние WalletConnect. Обновите состояние подключения перед повторной попыткой."
  ],
  "ar": [
    "جارٍ الاتصال… يمكنك إلغاء محاولة الاقتران هذه.",
    "أُرسل طلب الاقتران. بانتظار اقتراح اتصال؛ يمكنك إلغاء هذه المحاولة.",
    "تم استلام اقتراح الاتصال. راجعه قبل الموافقة.",
    "أُلغي الاقتران. اطلب رمز QR جديدًا قبل إعادة المحاولة.",
    "لم يكتمل الاقتران. اطلب رمز QR جديدًا قبل إعادة المحاولة.",
    "تعذر تأكيد حالة WalletConnect. حدّث حالة الاتصال قبل إعادة المحاولة."
  ],
  "id": [
    "Menghubungkan… Anda dapat membatalkan pemasangan ini.",
    "Permintaan pemasangan dikirim. Menunggu proposal koneksi; Anda dapat membatalkan percobaan ini.",
    "Proposal koneksi diterima. Tinjau sebelum menyetujui.",
    "Pemasangan dibatalkan. Minta kode QR baru sebelum mencoba lagi.",
    "Pemasangan belum selesai. Minta kode QR baru sebelum mencoba lagi.",
    "Status WalletConnect tidak dapat dikonfirmasi. Segarkan status koneksi sebelum mencoba lagi."
  ]
};
const relayHelpKeys=["WalletConnect status unavailable","WalletConnect status could not be confirmed. Reopen Connections to refresh; existing sessions may still be active.","The Relay connection is not yet confirmed. Reopen Connections to check its status; existing sessions may still be active."];
const relayHelpRows={
  "en": [
    "WalletConnect status unavailable",
    "WalletConnect status could not be confirmed. Reopen Connections to refresh; existing sessions may still be active.",
    "The Relay connection is not yet confirmed. Reopen Connections to check its status; existing sessions may still be active."
  ],
  "zh-Hans": [
    "无法获取 WalletConnect 状态",
    "无法确认 WalletConnect 状态。请重新打开“连接”页面刷新；已有会话可能仍然有效。",
    "Relay 连接尚未确认。请重新打开“连接”页面查看状态；已有会话可能仍然有效。"
  ],
  "zh-Hant": [
    "無法取得 WalletConnect 狀態",
    "無法確認 WalletConnect 狀態。請重新開啟「連線」頁面重新整理；既有工作階段可能仍然有效。",
    "Relay 連線尚未確認。請重新開啟「連線」頁面查看狀態；既有工作階段可能仍然有效。"
  ],
  "ja": [
    "WalletConnect の状態を取得できません",
    "WalletConnect の状態を確認できません。「接続」を開き直して更新してください。既存のセッションは有効な可能性があります。",
    "Relay 接続はまだ確認されていません。「接続」を開き直して状態を確認してください。既存のセッションは有効な可能性があります。"
  ],
  "ko": [
    "WalletConnect 상태를 확인할 수 없음",
    "WalletConnect 상태를 확인할 수 없습니다. 연결 화면을 다시 열어 새로고침하세요. 기존 세션은 여전히 활성 상태일 수 있습니다.",
    "Relay 연결이 아직 확인되지 않았습니다. 연결 화면을 다시 열어 상태를 확인하세요. 기존 세션은 여전히 활성 상태일 수 있습니다."
  ],
  "es": [
    "Estado de WalletConnect no disponible",
    "No se pudo confirmar el estado de WalletConnect. Vuelve a abrir Conexiones para actualizarlo; las sesiones existentes podrían seguir activas.",
    "La conexión con Relay aún no está confirmada. Vuelve a abrir Conexiones para consultar el estado; las sesiones existentes podrían seguir activas."
  ],
  "fr": [
    "État WalletConnect indisponible",
    "L’état WalletConnect n’a pas pu être confirmé. Rouvrez Connexions pour l’actualiser ; les sessions existantes peuvent être encore actives.",
    "La connexion Relay n’est pas encore confirmée. Rouvrez Connexions pour vérifier son état ; les sessions existantes peuvent être encore actives."
  ],
  "de": [
    "WalletConnect-Status nicht verfügbar",
    "Der WalletConnect-Status konnte nicht bestätigt werden. Öffne Verbindungen erneut zum Aktualisieren; bestehende Sitzungen könnten noch aktiv sein.",
    "Die Relay-Verbindung ist noch nicht bestätigt. Öffne Verbindungen erneut, um den Status zu prüfen; bestehende Sitzungen könnten noch aktiv sein."
  ],
  "pt": [
    "Estado do WalletConnect indisponível",
    "Não foi possível confirmar o estado do WalletConnect. Reabra Conexões para atualizar; sessões existentes ainda podem estar ativas.",
    "A conexão com Relay ainda não foi confirmada. Reabra Conexões para verificar o estado; sessões existentes ainda podem estar ativas."
  ],
  "ru": [
    "Состояние WalletConnect недоступно",
    "Не удалось подтвердить состояние WalletConnect. Откройте раздел подключений заново для обновления; существующие сеансы могут оставаться активными.",
    "Соединение с Relay ещё не подтверждено. Откройте раздел подключений заново для проверки; существующие сеансы могут оставаться активными."
  ],
  "ar": [
    "حالة WalletConnect غير متاحة",
    "تعذر تأكيد حالة WalletConnect. أعد فتح صفحة الاتصالات للتحديث؛ قد تظل الجلسات الحالية نشطة.",
    "لم يُؤكّد اتصال Relay بعد. أعد فتح صفحة الاتصالات للتحقق من الحالة؛ قد تظل الجلسات الحالية نشطة."
  ],
  "id": [
    "Status WalletConnect tidak tersedia",
    "Status WalletConnect tidak dapat dikonfirmasi. Buka kembali Koneksi untuk menyegarkan; sesi yang ada mungkin masih aktif.",
    "Koneksi Relay belum dikonfirmasi. Buka kembali Koneksi untuk memeriksa status; sesi yang ada mungkin masih aktif."
  ]
};
export const SESSION_COPY=Object.freeze(Object.fromEntries(Object.entries(rows).map(([locale,values])=>{
 if(values.length!==keys.length||values.some(value=>!value))throw Error(`Incomplete session copy: ${locale}`);
 if(relayHelpRows[locale]?.length!==relayHelpKeys.length||relayHelpRows[locale].some(value=>!value))throw Error(`Incomplete Relay guidance: ${locale}`);
 if(pairRows[locale]?.length!==pairKeys.length||pairRows[locale].some(value=>!value))throw Error(`Incomplete pairing copy: ${locale}`);
 if(waitingRows[locale]?.length!==waitingKeys.length||waitingRows[locale].some(value=>!value))throw Error(`Incomplete Relay copy: ${locale}`);
 return[locale,Object.freeze(Object.fromEntries([...keys.map((key,index)=>[key,values[index]]),...waitingKeys.map((key,index)=>[key,waitingRows[locale][index]]),...pairKeys.map((key,index)=>[key,pairRows[locale][index]]),...relayHelpKeys.map((key,index)=>[key,relayHelpRows[locale][index]])]))];
})));
