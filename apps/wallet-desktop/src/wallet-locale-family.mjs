const keys = ["Show receiving address","Checking account…","Receiving address","A receiving address does not verify the network or balance. Never send assets on another network."];
const rows = {
  "en": [
    "Show receiving address",
    "Checking account…",
    "Receiving address",
    "A receiving address does not verify the network or balance. Never send assets on another network."
  ],
  "zh-Hans": [
    "显示收款地址",
    "正在核对账户…",
    "收款地址",
    "收款地址不代表网络或余额已验证。请勿通过其他网络发送资产。"
  ],
  "zh-Hant": [
    "顯示收款地址",
    "正在核對帳戶…",
    "收款地址",
    "收款地址不代表網路或餘額已驗證。請勿透過其他網路傳送資產。"
  ],
  "ja": [
    "受取アドレスを表示",
    "アカウントを確認中…",
    "受取アドレス",
    "受取アドレスはネットワークや残高の確認を意味しません。別のネットワークで資産を送らないでください。"
  ],
  "ko": [
    "받는 주소 표시",
    "계정 확인 중…",
    "받는 주소",
    "받는 주소만으로 네트워크나 잔액이 확인되지는 않습니다. 다른 네트워크로 자산을 보내지 마세요."
  ],
  "es": [
    "Mostrar dirección de recepción",
    "Comprobando cuenta…",
    "Dirección de recepción",
    "Una dirección de recepción no verifica la red ni el saldo. No envíes activos por otra red."
  ],
  "fr": [
    "Afficher l’adresse de réception",
    "Vérification du compte…",
    "Adresse de réception",
    "Une adresse de réception ne vérifie ni le réseau ni le solde. N’envoyez pas d’actifs sur un autre réseau."
  ],
  "de": [
    "Empfangsadresse anzeigen",
    "Konto wird geprüft…",
    "Empfangsadresse",
    "Eine Empfangsadresse bestätigt weder Netzwerk noch Guthaben. Senden Sie keine Vermögenswerte über ein anderes Netzwerk."
  ],
  "pt": [
    "Mostrar endereço de recebimento",
    "Verificando conta…",
    "Endereço de recebimento",
    "Um endereço de recebimento não verifica a rede nem o saldo. Não envie ativos por outra rede."
  ],
  "ru": [
    "Показать адрес получения",
    "Проверка аккаунта…",
    "Адрес получения",
    "Адрес получения не подтверждает сеть или баланс. Не отправляйте активы через другую сеть."
  ],
  "ar": [
    "عرض عنوان الاستلام",
    "جارٍ التحقق من الحساب…",
    "عنوان الاستلام",
    "عنوان الاستلام لا يؤكد الشبكة أو الرصيد. لا ترسل الأصول عبر شبكة أخرى."
  ],
  "id": [
    "Tampilkan alamat penerimaan",
    "Memeriksa akun…",
    "Alamat penerimaan",
    "Alamat penerimaan tidak memverifikasi jaringan atau saldo. Jangan kirim aset melalui jaringan lain."
  ]
};
const tokenImport = {en: 'Import TRC20 token', 'zh-Hans': '导入 TRC20 代币', 'zh-Hant': '匯入 TRC20 代幣', ja: 'TRC20 トークンを追加', ko: 'TRC20 토큰 가져오기', es: 'Importar token TRC20', fr: 'Importer un jeton TRC20', de: 'TRC20-Token importieren', pt: 'Importar token TRC20', ru: 'Импортировать токен TRC20', ar: 'استيراد رمز TRC20', id: 'Impor token TRC20'};
const removalKey='Removing a token only hides it from this local catalog. It does not transfer or burn assets.';
const removalCopy={en:removalKey,'zh-Hans':'移除代币只会将它从本地目录隐藏，不会转移或销毁资产。','zh-Hant':'移除代幣只會將它從本機目錄隱藏，不會轉移或銷毀資產。',ja:'トークンの削除はローカル一覧から非表示にするだけです。資産の送金や焼却は行いません。',ko:'토큰 제거는 로컬 목록에서 숨기기만 합니다. 자산을 전송하거나 소각하지 않습니다.',es:'Eliminar un token solo lo oculta de esta lista local. No transfiere ni quema activos.',fr:'Retirer un jeton le masque seulement dans cette liste locale. Cela ne transfère ni ne détruit les actifs.',de:'Das Entfernen eines Tokens blendet ihn nur in dieser lokalen Liste aus. Es überträgt oder verbrennt keine Vermögenswerte.',pt:'Remover um token apenas o oculta nesta lista local. Não transfere nem queima ativos.',ru:'Удаление токена лишь скрывает его из локального списка. Активы не переводятся и не сжигаются.',ar:'إزالة الرمز تخفيه من هذه القائمة المحلية فقط. لا يتم نقل الأصول أو حرقها.',id:'Menghapus token hanya menyembunyikannya dari daftar lokal ini. Aset tidak ditransfer atau dibakar.'};
const transferKeys=['Fee rate','Unsigned preview only. No signing or broadcasting.'];
const transferRows={en:transferKeys,'zh-Hans':['费率','仅未签名预览。不签名、不广播。'],'zh-Hant':['費率','僅未簽名預覽。不簽名、不廣播。'],ja:['手数料率','未署名のプレビューのみ。署名や送信は行いません。'],ko:['수수료율','서명 전 미리보기만 제공하며 서명하거나 전송하지 않습니다.'],es:['Tasa de comisión','Solo vista previa sin firmar. No firma ni transmite.'],fr:['Taux de frais','Aperçu non signé uniquement. Aucune signature ni diffusion.'],de:['Gebührenrate','Nur unsignierte Vorschau. Keine Signatur oder Übertragung.'],pt:['Taxa de tarifa','Somente prévia não assinada. Sem assinatura ou transmissão.'],ru:['Ставка комиссии','Только неподписанный просмотр. Без подписи и отправки.'],ar:['معدل الرسوم','معاينة غير موقعة فقط. لا توقيع ولا بث.'],id:['Tarif biaya','Hanya pratinjau tanpa tanda tangan. Tidak menandatangani atau menyiarkan.']};
const signKeys=['Sign only','Signing does not submit a transaction.'];
const tronKeys=['TRON energy fee limit','TRON budgets are conservative node estimates, not guaranteed fees.'];
const tronRows={en:tronKeys,'zh-Hans':['TRON 能量费用上限','TRON 预算是节点数据的保守估计，不保证实际费用。'],'zh-Hant':['TRON 能量費用上限','TRON 預算是節點資料的保守估計，不保證實際費用。'],ja:['TRON エネルギー手数料上限','TRON の予算はノード情報に基づく保守的な見積りで、実際の手数料を保証しません。'],ko:['TRON 에너지 수수료 한도','TRON 예산은 노드 데이터의 보수적 추정치이며 실제 수수료를 보장하지 않습니다.'],es:['Límite de tarifa de energía TRON','Los presupuestos TRON son estimaciones conservadoras del nodo, no tarifas garantizadas.'],fr:['Plafond des frais d’énergie TRON','Les budgets TRON sont des estimations prudentes du nœud, sans garantie des frais réels.'],de:['TRON-Energiegebührenlimit','TRON-Budgets sind konservative Knotenschätzungen, keine garantierten Gebühren.'],pt:['Limite da tarifa de energia TRON','Os orçamentos TRON são estimativas conservadoras do nó, não tarifas garantidas.'],ru:['Лимит комиссии энергии TRON','Бюджеты TRON — консервативные оценки узла, а не гарантированные комиссии.'],ar:['حد رسوم الطاقة في TRON','ميزانيات TRON تقديرات متحفظة من العقدة وليست رسوماً مضمونة.'],id:['Batas biaya energi TRON','Anggaran TRON adalah perkiraan konservatif dari node, bukan biaya yang dijamin.']};
const signRows={en:signKeys,'zh-Hans':['仅签名','签名不会提交交易。'],'zh-Hant':['僅簽名','簽名不會提交交易。'],ja:['署名のみ','署名では取引は送信されません。'],ko:['서명만','서명은 거래를 제출하지 않습니다.'],es:['Solo firmar','Firmar no envía la transacción.'],fr:['Signer uniquement','Signer ne soumet pas la transaction.'],de:['Nur signieren','Signieren sendet keine Transaktion.'],pt:['Apenas assinar','Assinar não envia a transação.'],ru:['Только подписать','Подпись не отправляет транзакцию.'],ar:['توقيع فقط','التوقيع لا يرسل المعاملة.'],id:['Tanda tangani saja','Penandatanganan tidak mengirim transaksi.']};
export const FAMILY_COPY = Object.freeze(Object.fromEntries(Object.entries(rows).map(([locale, values]) => [locale, Object.freeze({...Object.fromEntries(keys.map((key, index) => [key, values[index]])), 'Import TRC20 token': tokenImport[locale],[removalKey]:removalCopy[locale],...Object.fromEntries(transferKeys.map((key,index)=>[key,transferRows[locale][index]])),...Object.fromEntries(tronKeys.map((key,index)=>[key,tronRows[locale][index]])),...Object.fromEntries(signKeys.map((key,index)=>[key,signRows[locale][index]]))})])));
