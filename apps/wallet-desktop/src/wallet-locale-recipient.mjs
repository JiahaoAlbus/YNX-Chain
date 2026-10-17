const keys=["Paste address or receiving link","Reading recipient locally…","Recipient filled. Enter the amount, then review the address and fee.","Recipient unavailable. Use a YNX Testnet address, receiving link or its QR image."];
const rows={
en:keys.join("|"),
"zh-Hans":"粘贴地址或收款链接|正在本地读取收款地址…|收款地址已填入。请输入金额，再核对地址和手续费。|无法读取收款地址。请使用 YNX 测试网地址、收款链接或其二维码图片。",
"zh-Hant":"貼上地址或收款連結|正在本機讀取收款地址…|收款地址已填入。請輸入金額，再核對地址和手續費。|無法讀取收款地址。請使用 YNX 測試網地址、收款連結或其二維碼圖片。",
ja:"アドレスまたは受取リンクを貼り付け|送金先を端末内で読み取り中…|送金先を入力しました。金額を入力し、アドレスと手数料を確認してください。|送金先を読み取れません。YNX Testnet アドレス、受取リンク、またはその QR 画像を使ってください。",
ko:"주소 또는 수신 링크 붙여넣기|기기에서 받는 주소 읽는 중…|받는 주소가 입력되었습니다. 금액을 입력하고 주소와 수수료를 검토하세요.|받는 주소를 읽지 못했습니다. YNX Testnet 주소, 수신 링크 또는 해당 QR 이미지를 사용하세요.",
es:"Pegar dirección o enlace de recepción|Leyendo destinatario localmente…|Destinatario introducido. Escribe el importe y revisa la dirección y la comisión.|Destinatario no disponible. Usa una dirección de YNX Testnet, un enlace de recepción o su imagen QR.",
fr:"Coller une adresse ou un lien de réception|Lecture locale du destinataire…|Destinataire renseigné. Saisissez le montant, puis vérifiez l’adresse et les frais.|Destinataire indisponible. Utilisez une adresse YNX Testnet, un lien de réception ou son image QR.",
de:"Adresse oder Empfangslink einfügen|Empfänger wird lokal gelesen…|Empfänger eingetragen. Betrag eingeben, dann Adresse und Gebühr prüfen.|Empfänger nicht verfügbar. Verwenden Sie eine YNX-Testnet-Adresse, einen Empfangslink oder dessen QR-Bild.",
pt:"Colar endereço ou link de recebimento|Lendo destinatário localmente…|Destinatário preenchido. Insira o valor e revise o endereço e a taxa.|Destinatário indisponível. Use um endereço YNX Testnet, um link de recebimento ou sua imagem QR.",
ru:"Вставить адрес или ссылку получения|Локальное чтение получателя…|Получатель заполнен. Введите сумму и проверьте адрес и комиссию.|Получатель недоступен. Используйте адрес YNX Testnet, ссылку получения или её QR-изображение.",
ar:"لصق عنوان أو رابط استلام|جارٍ قراءة المستلم محليًا…|أُدخل المستلم. أدخل المبلغ ثم راجع العنوان والرسوم.|المستلم غير متاح. استخدم عنوان YNX Testnet أو رابط استلام أو صورة QR الخاصة به.",
id:"Tempel alamat atau tautan penerimaan|Membaca penerima secara lokal…|Penerima terisi. Masukkan jumlah, lalu tinjau alamat dan biaya.|Penerima tidak tersedia. Gunakan alamat YNX Testnet, tautan penerimaan, atau gambar QR-nya."
};
const evmKeys=['EVM recipient filled. Verify the selected network, enter an amount, then review.','EVM recipient unavailable. Use a QR image containing only a nonzero EVM address.'];
const evmRows={
en:evmKeys,
'zh-Hans':['EVM 收款地址已填入。请核对所选网络、输入金额，再审核。','无法读取 EVM 收款地址。请使用仅含非零 EVM 地址的二维码图片。'],
'zh-Hant':['EVM 收款位址已填入。請核對所選網路、輸入金額，再審核。','無法讀取 EVM 收款位址。請使用僅含非零 EVM 位址的二維碼圖片。'],
ja:['EVM 送金先を入力しました。選択したネットワークを確認し、金額を入力して確認してください。','EVM 送金先を読み取れません。ゼロ以外の EVM アドレスだけを含む QR 画像を使用してください。'],
ko:['EVM 수신 주소를 입력했습니다. 선택한 네트워크를 확인하고 금액을 입력한 뒤 검토하세요.','EVM 수신 주소를 읽을 수 없습니다. 0이 아닌 EVM 주소만 포함된 QR 이미지를 사용하세요.'],
es:['Destinatario EVM rellenado. Verifica la red seleccionada, introduce el importe y revisa.','Destinatario EVM no disponible. Usa una imagen QR que contenga solo una dirección EVM distinta de cero.'],
fr:['Destinataire EVM renseigné. Vérifiez le réseau sélectionné, saisissez le montant, puis vérifiez.','Destinataire EVM indisponible. Utilisez une image QR contenant uniquement une adresse EVM non nulle.'],
de:['EVM-Empfänger eingetragen. Gewähltes Netzwerk prüfen, Betrag eingeben und kontrollieren.','EVM-Empfänger nicht verfügbar. QR-Bild nur mit einer EVM-Adresse ungleich null verwenden.'],
pt:['Destinatário EVM preenchido. Verifique a rede selecionada, introduza o valor e reveja.','Destinatário EVM indisponível. Use uma imagem QR apenas com um endereço EVM diferente de zero.'],
ru:['Получатель EVM заполнен. Проверьте выбранную сеть, введите сумму и проверьте перевод.','Получатель EVM недоступен. Используйте QR-изображение только с ненулевым адресом EVM.'],
ar:['تم ملء عنوان مستلم EVM. تحقق من الشبكة المحددة وأدخل المبلغ ثم راجع.','عنوان مستلم EVM غير متاح. استخدم صورة QR تتضمن عنوان EVM غير صفري فقط.'],
id:['Penerima EVM diisi. Periksa jaringan yang dipilih, masukkan jumlah, lalu tinjau.','Penerima EVM tidak tersedia. Gunakan gambar QR yang hanya berisi alamat EVM bukan nol.']
};
const familyKeys=['{family} recipient filled. Verify the selected network, enter an amount, then review.','{family} recipient unavailable. Check the QR address, selected network and unresolved operations.'];
const familyRows={
en:familyKeys,
'zh-Hans':['{family} 收款地址已填入。请核对所选网络、输入金额，再审核。','无法读取 {family} 收款地址。请检查二维码地址、所选网络及未解决的操作记录。'],
'zh-Hant':['{family} 收款位址已填入。請核對所選網路、輸入金額，再審核。','無法讀取 {family} 收款位址。請檢查二維碼位址、所選網路及未解決的操作紀錄。'],
ja:['{family} 送金先を入力しました。選択したネットワークを確認し、金額を入力して確認してください。','{family} 送金先を読み取れません。QR アドレス、選択したネットワーク、未解決の操作を確認してください。'],
ko:['{family} 수신 주소를 입력했습니다. 선택한 네트워크를 확인하고 금액을 입력한 뒤 검토하세요.','{family} 수신 주소를 읽을 수 없습니다. QR 주소, 선택한 네트워크와 미해결 작업을 확인하세요.'],
es:['Destinatario {family} rellenado. Verifica la red seleccionada, introduce el importe y revisa.','Destinatario {family} no disponible. Comprueba la dirección QR, la red seleccionada y las operaciones pendientes.'],
fr:['Destinataire {family} renseigné. Vérifiez le réseau sélectionné, saisissez le montant, puis vérifiez.','Destinataire {family} indisponible. Vérifiez l’adresse QR, le réseau sélectionné et les opérations non résolues.'],
de:['{family}-Empfänger eingetragen. Gewähltes Netzwerk prüfen, Betrag eingeben und kontrollieren.','{family}-Empfänger nicht verfügbar. QR-Adresse, gewähltes Netzwerk und ungeklärte Vorgänge prüfen.'],
pt:['Destinatário {family} preenchido. Verifique a rede selecionada, introduza o valor e reveja.','Destinatário {family} indisponível. Verifique o endereço QR, a rede selecionada e as operações pendentes.'],
ru:['Получатель {family} заполнен. Проверьте выбранную сеть, введите сумму и проверьте перевод.','Получатель {family} недоступен. Проверьте QR-адрес, выбранную сеть и незавершённые операции.'],
ar:['تم ملء عنوان مستلم {family}. تحقق من الشبكة المحددة وأدخل المبلغ ثم راجع.','عنوان مستلم {family} غير متاح. تحقق من عنوان QR والشبكة المحددة والعمليات غير المحسومة.'],
id:['Penerima {family} diisi. Periksa jaringan yang dipilih, masukkan jumlah, lalu tinjau.','Penerima {family} tidak tersedia. Periksa alamat QR, jaringan yang dipilih, dan operasi yang belum selesai.']
};
export const RECIPIENT_COPY=Object.freeze(Object.fromEntries(Object.entries(rows).map(([locale,row])=>{
  const values=row.split("|");if(values.length!==keys.length||values.some(value=>!value))throw Error(`Incomplete recipient copy: ${locale}`);
  return[locale,Object.freeze({...Object.fromEntries(keys.map((key,index)=>[key,values[index]])),...Object.fromEntries(evmKeys.map((key,index)=>[key,evmRows[locale][index]])),...Object.fromEntries(familyKeys.map((key,index)=>[key,familyRows[locale][index]]))})];
})));
