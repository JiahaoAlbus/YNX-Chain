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
export const SESSION_COPY=Object.freeze(Object.fromEntries(Object.entries(rows).map(([locale,values])=>{
 if(values.length!==keys.length||values.some(value=>!value))throw Error(`Incomplete session copy: ${locale}`);
 return[locale,Object.freeze(Object.fromEntries(keys.map((key,index)=>[key,values[index]])))];
})));
