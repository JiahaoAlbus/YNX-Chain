import type {Locale} from './i18n';
const copy:Record<Locale,string>={
 en:'New TEST actions are unavailable until the Card backend supports original-key recovery. Saved records remain readable and pending requests are retained. Do not resend with a new key.',
 'zh-CN':'Card 后端支持原幂等键恢复前，新测试操作不可用。已保存记录仍可读取，待定请求保持原样；请勿换新键重发。',
 'zh-TW':'Card 後端支援原冪等鍵恢復前，新測試操作不可用。已儲存紀錄仍可讀取，待定請求保持原樣；請勿換新鍵重送。',
 ja:'Card バックエンドが元のキーでの復旧に対応するまで新しいテスト操作は利用できません。保存済み記録と保留中の要求は保持されます。新しいキーで再送しないでください。',
 ko:'Card 백엔드가 원래 키 복구를 지원할 때까지 새 테스트 작업을 사용할 수 없습니다. 저장된 기록과 대기 요청은 유지됩니다. 새 키로 다시 보내지 마세요.',
 es:'Las nuevas acciones TEST no están disponibles hasta que Card permita recuperar la clave original. Los registros y solicitudes pendientes se conservan. No reenvíes con una clave nueva.',
 fr:'Les nouvelles actions TEST attendent la récupération par clé originale du serveur Card. Les données restent lisibles et les demandes en attente sont conservées. Ne renvoyez pas avec une nouvelle clé.',
 de:'Neue TEST-Aktionen erfordern die Wiederherstellung mit dem Originalschlüssel im Card-Backend. Daten bleiben lesbar und ausstehende Anfragen erhalten. Nicht mit einem neuen Schlüssel erneut senden.',
 pt:'Novas ações TEST aguardam recuperação pela chave original no backend Card. Registros permanecem legíveis e pedidos pendentes são preservados. Não reenvie com uma chave nova.',
 ru:'Новые действия TEST недоступны до поддержки восстановления исходного ключа сервером Card. Записи доступны, ожидающие запросы сохранены. Не отправляйте повторно с новым ключом.',
 ar:'إجراءات TEST الجديدة غير متاحة حتى يدعم خادم Card الاستعادة بالمفتاح الأصلي. تبقى السجلات قابلة للقراءة والطلبات المعلقة محفوظة. لا تُعد الإرسال بمفتاح جديد.',
 id:'Tindakan TEST baru menunggu dukungan pemulihan kunci asli pada backend Card. Catatan tetap dapat dibaca dan permintaan tertunda dipertahankan. Jangan kirim ulang dengan kunci baru.',
};
export function cardOperationAvailabilityText(locale:Locale):string{return copy[locale]}

const otherCard:Record<Locale,string>={
 en:'This pending request belongs to another card. Open the original card to recover it; do not start a replacement request.',
 'zh-CN':'待定请求属于另一张卡。请打开原卡恢复，勿创建替代请求。',
 'zh-TW':'待定請求屬於另一張卡。請開啟原卡恢復，勿建立替代請求。',
 ja:'保留中の要求は別のカードに属します。元のカードを開いて復旧してください。代替要求を作成しないでください。',
 ko:'대기 요청은 다른 카드에 속합니다. 원래 카드를 열어 복구하세요. 대체 요청을 만들지 마세요.',
 es:'La solicitud pendiente pertenece a otra tarjeta. Abre la tarjeta original para recuperarla; no crees otra solicitud.',
 fr:'Cette demande concerne une autre carte. Ouvrez la carte originale pour la récupérer, sans créer de remplacement.',
 de:'Diese Anfrage gehört zu einer anderen Karte. Zur Wiederherstellung die ursprüngliche Karte öffnen; keinen Ersatz anlegen.',
 pt:'O pedido pendente pertence a outro cartão. Abra o cartão original para recuperar; não crie um substituto.',
 ru:'Ожидающий запрос относится к другой карте. Откройте исходную карту для восстановления; не создавайте замену.',
 ar:'الطلب المعلق يخص بطاقة أخرى. افتح البطاقة الأصلية لاستعادته ولا تنشئ طلباً بديلاً.',
 id:'Permintaan tertunda milik kartu lain. Buka kartu asli untuk memulihkan; jangan buat permintaan pengganti.',
};
const localWrite:Record<Locale,string>={
 en:'Local recovery storage could not be confirmed. The pending reference is retained. Do not start a new request; restore storage access before reloading.',
 'zh-CN':'无法确认本地恢复记录已保存。待定引用已保留。请勿发起新请求；恢复存储访问后再重新加载。',
 'zh-TW':'無法確認本地恢復記錄已儲存。待定引用已保留。請勿發起新請求；恢復儲存存取後再重新載入。',
 ja:'復旧情報のローカル保存を確認できません。保留参照は保持されています。新しい要求を開始せず、保存先へのアクセスを復旧してから再読み込みしてください。',
 ko:'로컬 복구 저장을 확인할 수 없습니다. 대기 참조는 유지됩니다. 새 요청을 시작하지 말고 저장소 접근을 복구한 뒤 새로고침하세요.',
 es:'No se pudo confirmar el almacenamiento local de recuperación. Se conserva la referencia pendiente. No inicies otra solicitud; restaura el acceso antes de recargar.',
 fr:'La sauvegarde locale de récupération ne peut pas être confirmée. La référence est conservée. Ne créez pas de demande; rétablissez le stockage avant de recharger.',
 de:'Lokale Wiederherstellung nicht bestätigt. Die offene Referenz bleibt erhalten. Keine neue Anfrage starten; Speicherzugriff vor dem Neuladen wiederherstellen.',
 pt:'Não foi possível confirmar o armazenamento local. A referência pendente foi mantida. Não inicie outro pedido; restaure o acesso antes de recarregar.',
 ru:'Локальное сохранение восстановления не подтверждено. Ссылка на запрос сохранена. Не создавайте новый запрос; восстановите доступ к хранилищу перед перезагрузкой.',
 ar:'تعذر تأكيد حفظ الاستعادة محلياً. مرجع الطلب محفوظ. لا تبدأ طلباً جديداً؛ استعد الوصول إلى التخزين قبل إعادة التحميل.',
 id:'Penyimpanan pemulihan lokal belum terkonfirmasi. Referensi tertunda dipertahankan. Jangan mulai permintaan baru; pulihkan akses penyimpanan sebelum memuat ulang.',
};
export function cardPendingOtherCardText(locale:Locale):string{return otherCard[locale]}
export function cardLocalRecoveryWriteText(locale:Locale):string{return localWrite[locale]}
