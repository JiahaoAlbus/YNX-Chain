const keys=['title','check','intent','risk','invalid'];
const rows={
 en:['Review request','Check approval requirements · no submission','Existing deposit intent ID','Not submitted. A separately approved command route is required. Cancel and withdrawal also require an exact native Wallet signature. Deposit credit requires indexed confirmations; withdrawal review is not broadcast; AI consent is not generation or execution.','Invalid request fields. Check amount, byte limits, record ownership and fee requirements.'],
 'zh-Hans':['审阅请求','检查授权要求 · 不提交','现有充值意图 ID','尚未提交。需要单独获准的命令路由。取消和提现还需精确原生钱包签名。充值入账需要索引确认；提现审阅不是广播；AI 同意不是生成或执行。','请求字段无效。检查金额、字节限制、记录归属和费用要求。'],
 'zh-Hant':['審閱請求','檢查授權要求 · 不提交','現有充值意圖 ID','尚未提交。需要單獨獲准的命令路由。取消和提款還需精確原生錢包簽名。充值入帳需要索引確認；提款審閱不是廣播；AI 同意不是生成或執行。','請求欄位無效。檢查金額、位元組限制、記錄歸屬及費用要求。'],
 ja:['リクエストを確認','承認条件を確認・送信なし','既存の入金意図 ID','未送信。個別承認済みコマンド経路が必要です。取消・出金には正確なネイティブ Wallet 署名も必要です。入金には索引確認が必要。出金確認は送信ではなく、AI 同意は生成・実行ではありません。','入力が無効です。金額、バイト制限、記録の所有者、手数料条件を確認してください。'],
 ko:['요청 검토','승인 조건 확인 · 제출 안 함','기존 입금 의도 ID','제출되지 않았습니다. 별도 승인된 명령 경로가 필요합니다. 취소와 출금에는 정확한 네이티브 Wallet 서명도 필요합니다. 입금은 인덱스 확인이 필요하며 출금 검토는 전송이 아니고 AI 동의는 생성이나 실행이 아닙니다.','요청 필드가 잘못되었습니다. 금액, 바이트 제한, 기록 소유권 및 수수료 조건을 확인하세요.'],
 es:['Revisar solicitud','Comprobar permisos · sin enviar','ID de intención de depósito existente','No enviada. Se requiere una ruta autorizada aparte. Cancelar y retirar también requieren firma nativa exacta. El depósito exige confirmaciones indexadas; revisar retiro no es transmitir; consentimiento IA no es generación ni ejecución.','Campos inválidos. Revisa importe, límites de bytes, titularidad y comisiones.'],
 fr:['Vérifier la demande','Vérifier les autorisations · sans envoi','ID de dépôt existant','Non envoyée. Une route autorisée séparément est requise. Annulation et retrait exigent aussi une signature native exacte. Le dépôt nécessite des confirmations indexées ; examen du retrait ne signifie pas diffusion ; consentement IA ne signifie pas génération ou exécution.','Champs invalides. Vérifiez montant, limites en octets, propriété et frais.'],
 de:['Anfrage prüfen','Berechtigungen prüfen · nicht senden','Bestehende Einzahlungsabsicht-ID','Nicht gesendet. Ein separat genehmigter Befehlsweg ist erforderlich. Stornierung und Auszahlung benötigen eine exakte native Signatur. Einzahlung erfordert indexierte Bestätigungen; Auszahlungsprüfung ist kein Versand; KI-Zustimmung ist keine Generierung oder Ausführung.','Ungültige Felder. Betrag, Byte-Grenzen, Eigentümer und Gebühren prüfen.'],
 pt:['Rever pedido','Verificar permissões · sem enviar','ID de intenção de depósito existente','Não enviado. É necessária uma rota autorizada separada. Cancelar e retirar também exigem assinatura nativa exata. Depósito exige confirmações indexadas; revisão não é transmissão; consentimento IA não é geração ou execução.','Campos inválidos. Verifique valor, limites de bytes, titularidade e taxas.'],
 ru:['Проверить запрос','Проверить разрешения · без отправки','ID существующего намерения депозита','Не отправлено. Нужен отдельно разрешённый маршрут команды. Отмена и вывод требуют точной нативной подписи. Депозит требует индексированных подтверждений; проверка вывода не является отправкой; согласие ИИ не означает генерацию или исполнение.','Неверные поля. Проверьте сумму, байтовые лимиты, владельца записи и комиссии.'],
 ar:['مراجعة الطلب','فحص التفويض · دون إرسال','معرّف نية الإيداع القائمة','لم يُرسل. يلزم مسار أمر معتمد منفصل. الإلغاء والسحب يتطلبان توقيع Wallet أصلياً دقيقاً. الإيداع يحتاج تأكيدات مفهرسة؛ مراجعة السحب ليست بثاً؛ موافقة الذكاء ليست توليداً أو تنفيذاً.','حقول غير صالحة. تحقق من المبلغ وحدود البايت وملكية السجل والرسوم.'],
 id:['Tinjau permintaan','Periksa izin · tanpa kirim','ID niat deposit yang ada','Belum dikirim. Diperlukan rute perintah yang disetujui terpisah. Pembatalan dan penarikan juga memerlukan tanda tangan native tepat. Deposit perlu konfirmasi terindeks; tinjauan penarikan bukan siaran; persetujuan AI bukan pembuatan atau eksekusi.','Kolom tidak valid. Periksa jumlah, batas byte, pemilik catatan dan biaya.']
};
export const commandLocales=Object.freeze(Object.keys(rows));
const senderPolicy={
 en:'Only transfers sent by your approved native account can be attributed to you. Third-party transfers have no verified beneficiary binding and cannot be claimed here.',
 'zh-Hans':'只有经批准的原生账户发送的转入才能归属于你。第三方转入没有已验证的受益人绑定，不能在此认领。',
 'zh-Hant':'只有經批准的原生帳戶發送的轉入才能歸屬於你。第三方轉入沒有已驗證的受益人綁定，不能在此認領。',
 ja:'承認済みネイティブ口座からの送金のみ本人に帰属します。第三者送金には検証済み受益者の紐付けがなく、ここでは申請できません。',
 ko:'승인된 네이티브 계정이 보낸 전송만 본인에게 귀속됩니다. 제삼자 전송에는 검증된 수익자 연결이 없어 여기서 청구할 수 없습니다.',
 es:'Solo se atribuyen transferencias enviadas por tu cuenta nativa aprobada. Las de terceros no tienen beneficiario verificado y no pueden reclamarse aquí.',
 fr:'Seuls les transferts de votre compte natif approuvé vous sont attribués. Ceux de tiers n’ont pas de bénéficiaire vérifié et ne peuvent être réclamés ici.',
 de:'Nur Übertragungen vom genehmigten nativen Konto werden Ihnen zugeordnet. Drittübertragungen haben keine verifizierte Empfängerbindung und können hier nicht beansprucht werden.',
 pt:'Só transferências da sua conta nativa aprovada podem ser atribuídas a você. Transferências de terceiros não têm beneficiário verificado e não podem ser reivindicadas aqui.',
 ru:'Вам зачисляются только переводы с вашего одобренного нативного счёта. Для переводов третьих лиц нет проверенной привязки получателя; здесь их заявить нельзя.',
 ar:'تُنسب إليك فقط التحويلات المرسلة من حسابك الأصلي المعتمد. تحويلات الغير لا تملك ارتباط مستفيد موثقاً ولا يمكن المطالبة بها هنا.',
 id:'Hanya transfer dari akun native Anda yang disetujui dapat diatribusikan kepada Anda. Transfer pihak ketiga tidak memiliki penerima terverifikasi dan tidak dapat diklaim di sini.'
};
export function commandText(locale,key){return key==='depositSender'?(senderPolicy[locale]??senderPolicy.en):(rows[locale]??rows.en)[keys.indexOf(key)]??key;}
