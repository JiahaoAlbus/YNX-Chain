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
