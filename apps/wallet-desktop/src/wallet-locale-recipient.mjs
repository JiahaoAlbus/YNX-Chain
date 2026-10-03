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
export const RECIPIENT_COPY=Object.freeze(Object.fromEntries(Object.entries(rows).map(([locale,row])=>{
  const values=row.split("|");if(values.length!==keys.length||values.some(value=>!value))throw Error(`Incomplete recipient copy: ${locale}`);
  return[locale,Object.freeze(Object.fromEntries(keys.map((key,index)=>[key,values[index]])))];
})));
