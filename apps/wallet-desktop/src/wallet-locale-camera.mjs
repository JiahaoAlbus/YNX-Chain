const keys=["Start camera","Stop camera","Opening camera…","Point the camera at a YNX receiving code.","Camera unavailable. Use a QR image or paste a receiving link.","Camera stopped.","Camera frames stay on this device. Scanning fills only the recipient."];
const rows={
en:keys.join("|"),
"zh-Hans":"开启相机|停止相机|正在开启相机…|将相机对准 YNX 收款码。|相机不可用。请选择二维码图片或粘贴收款链接。|相机已停止。|相机画面只在本机处理。扫码仅填写收款地址。",
"zh-Hant":"開啟相機|停止相機|正在開啟相機…|將相機對準 YNX 收款碼。|相機無法使用。請選擇二維碼圖片或貼上收款連結。|相機已停止。|相機畫面只在本機處理。掃碼僅填寫收款地址。",
ja:"カメラを開始|カメラを停止|カメラを起動中…|YNX の受取コードにカメラを向けてください。|カメラを利用できません。QR画像か受取リンクを使用してください。|カメラを停止しました。|映像は端末内で処理します。読み取りは送金先の入力のみです。",
ko:"카메라 시작|카메라 중지|카메라 여는 중…|YNX 수취 코드에 카메라를 맞추세요.|카메라를 사용할 수 없습니다. QR 이미지나 수취 링크를 사용하세요.|카메라가 중지되었습니다.|영상은 이 기기에서만 처리됩니다. 스캔은 수취인만 입력합니다.",
es:"Iniciar cámara|Detener cámara|Abriendo cámara…|Apunta al código de recepción YNX.|Cámara no disponible. Usa una imagen QR o pega un enlace de recepción.|Cámara detenida.|Las imágenes se procesan en este dispositivo. El escaneo solo rellena el destinatario.",
fr:"Démarrer la caméra|Arrêter la caméra|Ouverture de la caméra…|Visez un code de réception YNX.|Caméra indisponible. Utilisez une image QR ou un lien de réception.|Caméra arrêtée.|Les images restent sur cet appareil. Le scan remplit uniquement le destinataire.",
de:"Kamera starten|Kamera stoppen|Kamera wird geöffnet…|Richte die Kamera auf einen YNX-Empfangscode.|Kamera nicht verfügbar. Verwende ein QR-Bild oder einen Empfangslink.|Kamera gestoppt.|Kamerabilder bleiben auf diesem Gerät. Der Scan trägt nur den Empfänger ein.",
pt:"Iniciar câmera|Parar câmera|Abrindo câmera…|Aponte para um código de recebimento YNX.|Câmera indisponível. Use uma imagem QR ou cole um link de recebimento.|Câmera parada.|As imagens ficam neste dispositivo. A leitura preenche apenas o destinatário.",
ru:"Включить камеру|Остановить камеру|Открытие камеры…|Наведите камеру на код получения YNX.|Камера недоступна. Выберите QR-изображение или вставьте ссылку получения.|Камера остановлена.|Кадры обрабатываются на этом устройстве. Сканирование заполняет только получателя.",
ar:"بدء الكاميرا|إيقاف الكاميرا|جارٍ فتح الكاميرا…|وجّه الكاميرا إلى رمز استلام YNX.|الكاميرا غير متاحة. استخدم صورة QR أو الصق رابط استلام.|تم إيقاف الكاميرا.|تُعالج الصور على هذا الجهاز فقط. يملأ المسح المستلم فقط.",
id:"Mulai kamera|Hentikan kamera|Membuka kamera…|Arahkan kamera ke kode penerimaan YNX.|Kamera tidak tersedia. Gunakan gambar QR atau tempel tautan penerimaan.|Kamera dihentikan.|Gambar diproses di perangkat ini. Pemindaian hanya mengisi penerima.",
};
const familyKeys=['Point the camera at a {family} receiving code. Verify the selected network.','Camera unavailable. Use a QR image or enter the address.'];
const familyRows={
en:familyKeys,
'zh-Hans':['将相机对准 {family} 收款码，并核对所选网络。','相机不可用。请选择二维码图片或输入地址。'],
'zh-Hant':['將相機對準 {family} 收款碼，並核對所選網路。','相機無法使用。請選擇二維碼圖片或輸入位址。'],
ja:['{family} の受取コードにカメラを向け、選択したネットワークを確認してください。','カメラを利用できません。QR 画像を使うか、アドレスを入力してください。'],
ko:['{family} 수취 코드에 카메라를 맞추고 선택한 네트워크를 확인하세요.','카메라를 사용할 수 없습니다. QR 이미지나 주소 입력을 사용하세요.'],
es:['Apunta al código de recepción {family}. Verifica la red seleccionada.','Cámara no disponible. Usa una imagen QR o introduce la dirección.'],
fr:['Visez un code de réception {family}. Vérifiez le réseau sélectionné.','Caméra indisponible. Utilisez une image QR ou saisissez l’adresse.'],
de:['Kamera auf einen {family}-Empfangscode richten. Gewähltes Netzwerk prüfen.','Kamera nicht verfügbar. QR-Bild verwenden oder Adresse eingeben.'],
pt:['Aponte para um código de recebimento {family}. Verifique a rede selecionada.','Câmera indisponível. Use uma imagem QR ou introduza o endereço.'],
ru:['Наведите камеру на код получения {family}. Проверьте выбранную сеть.','Камера недоступна. Используйте QR-изображение или введите адрес.'],
ar:['وجّه الكاميرا إلى رمز استلام {family}. تحقق من الشبكة المحددة.','الكاميرا غير متاحة. استخدم صورة QR أو أدخل العنوان.'],
id:['Arahkan kamera ke kode penerimaan {family}. Periksa jaringan yang dipilih.','Kamera tidak tersedia. Gunakan gambar QR atau masukkan alamat.']
};
export const CAMERA_COPY=Object.freeze(Object.fromEntries(Object.entries(rows).map(([locale,row])=>[locale,Object.freeze({...Object.fromEntries(keys.map((key,index)=>[key,row.split("|")[index]])),...Object.fromEntries(familyKeys.map((key,index)=>[key,familyRows[locale][index]]))})])));
