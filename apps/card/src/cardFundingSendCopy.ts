import type {Locale} from './i18n';
export const cardFundingPlatformCopy:Record<Locale,string>={
  en:'Sending is unavailable on this platform. Use a supported secure browser with transaction recovery locking. No transaction has been requested.',
  'zh-CN':'当前平台暂不支持发送。请使用支持交易恢复锁的安全浏览器。未请求任何交易。',
  'zh-TW':'目前平台暫不支援發送。請使用支援交易復原鎖的安全瀏覽器。未請求任何交易。',
  ja:'この環境では送信できません。取引復旧ロック対応の安全なブラウザーを使用してください。取引は要求されていません。',
  ko:'이 환경에서는 전송할 수 없습니다. 거래 복구 잠금을 지원하는 보안 브라우저를 사용하세요. 거래는 요청되지 않았습니다.',
  es:'El envío no está disponible en esta plataforma. Usa un navegador seguro compatible con bloqueo de recuperación. No se ha solicitado ninguna transacción.',
  fr:'Envoi indisponible sur cette plateforme. Utilisez un navigateur sécurisé avec verrouillage de récupération. Aucune transaction demandée.',
  de:'Senden ist auf dieser Plattform nicht verfügbar. Verwenden Sie einen sicheren Browser mit Wiederherstellungssperre. Keine Transaktion angefordert.',
  pt:'Envio indisponível nesta plataforma. Use um navegador seguro com bloqueio de recuperação. Nenhuma transação foi solicitada.',
  ru:'Отправка недоступна на этой платформе. Используйте безопасный браузер с блокировкой восстановления. Транзакция не запрошена.',
  ar:'الإرسال غير متاح على هذه المنصة. استخدم متصفحاً آمناً يدعم قفل استعادة المعاملات. لم يتم طلب أي معاملة.',
  id:'Pengiriman tidak tersedia di platform ini. Gunakan browser aman yang mendukung kunci pemulihan. Tidak ada transaksi yang diminta.',
};
export const cardFundingSendCopy:Record<Locale,readonly [string,string,string,string,string,string,string]>={
  en:['Send this exact YNXT Testnet intent','Use approved YNX Wallet','Use approved MetaMask','Review then approve in wallet','Transaction returned. No Card credit yet.','Verify with Card API','Unavailable or unknown outcome. Connect the correct wallet; do not resend this intent.'],
  'zh-CN':['发送此精确 YNXT 测试网意向','使用已批准的 YNX 钱包','使用已批准的 MetaMask','核对后在钱包中批准','交易哈希已返回，Card 尚未入账。','通过 Card API 核验','暂不可用或结果未知。连接正确钱包；不要重发此意向。'],
  'zh-TW':['發送此精確 YNXT 測試網意向','使用已批准的 YNX 錢包','使用已批准的 MetaMask','核對後在錢包中批准','交易雜湊已返回，Card 尚未入帳。','透過 Card API 核驗','暫不可用或結果未知。連接正確錢包；勿重送此意向。'],
  ja:['この正確な YNXT テストネット要求を送信','承認済み YNX Wallet を使用','承認済み MetaMask を使用','確認してウォレットで承認','取引ハッシュが返りました。Card 入金は未確認です。','Card API で検証','利用不可または結果不明。正しいウォレットを接続し、この要求を再送しないでください。'],
  ko:['정확한 YNXT 테스트넷 요청 전송','승인된 YNX Wallet 사용','승인된 MetaMask 사용','검토 후 지갑에서 승인','거래 해시가 반환되었습니다. Card 입금은 미확인입니다.','Card API 검증','사용 불가 또는 결과 미확인. 올바른 지갑을 연결하고 재전송하지 마세요.'],
  es:['Enviar esta intención YNXT Testnet exacta','Usar YNX Wallet aprobado','Usar MetaMask aprobado','Revisar y aprobar en Wallet','Hash devuelto. Card aún no ha recibido crédito.','Verificar con Card API','No disponible o resultado desconocido. Conecta el Wallet correcto; no reenvíes esta intención.'],
  fr:['Envoyer cette intention YNXT Testnet exacte','Utiliser YNX Wallet autorisé','Utiliser MetaMask autorisé','Vérifier puis approuver dans Wallet','Hash reçu. Aucun crédit Card confirmé.','Vérifier avec Card API','Indisponible ou résultat inconnu. Connectez le bon Wallet ; ne renvoyez pas cette intention.'],
  de:['Diese genaue YNXT-Testnet-Absicht senden','Freigegebenes YNX Wallet nutzen','Freigegebenes MetaMask nutzen','Prüfen und im Wallet bestätigen','Hash erhalten. Noch keine Card-Gutschrift.','Mit Card API prüfen','Nicht verfügbar oder Ergebnis unbekannt. Richtiges Wallet verbinden; diese Absicht nicht erneut senden.'],
  pt:['Enviar esta intenção YNXT Testnet exata','Usar YNX Wallet aprovado','Usar MetaMask aprovado','Revisar e aprovar na Wallet','Hash recebido. Card ainda sem crédito confirmado.','Verificar com Card API','Indisponível ou resultado desconhecido. Conecte a Wallet correta; não reenvie esta intenção.'],
  ru:['Отправить точную заявку YNXT Testnet','Использовать одобренный YNX Wallet','Использовать одобренный MetaMask','Проверить и одобрить в Wallet','Хеш получен. Зачисление Card не подтверждено.','Проверить через Card API','Недоступно или результат неизвестен. Подключите нужный Wallet; не отправляйте эту заявку повторно.'],
  ar:['إرسال طلب YNXT التجريبي المطابق','استخدام YNX Wallet المعتمد','استخدام MetaMask المعتمد','المراجعة ثم الموافقة في المحفظة','تم إرجاع التجزئة. لم يؤكد إيداع Card بعد.','التحقق عبر Card API','غير متاح أو النتيجة مجهولة. اتصل بالمحفظة الصحيحة ولا تعد إرسال الطلب.'],
  id:['Kirim intent YNXT Testnet persis ini','Gunakan YNX Wallet disetujui','Gunakan MetaMask disetujui','Tinjau lalu setujui di Wallet','Hash diterima. Kredit Card belum dikonfirmasi.','Verifikasi dengan Card API','Tidak tersedia atau hasil tidak diketahui. Hubungkan Wallet yang benar; jangan kirim ulang intent ini.'],
};
