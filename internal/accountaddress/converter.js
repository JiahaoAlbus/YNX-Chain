(function () {
  "use strict";
  const keys = ["title","intro","input","convert","privacy","native","compatibility","evm","copy","network","explore","explorer","faucet","docs","invalid","copied","copyFailed"];
  const rows = {
    en: ["Address converter","One account, two address formats. YNX uses ynx1 addresses by default; 0x is its EVM compatibility representation.","Paste a complete YNX or EVM address","Convert","Converted locally in this browser. No wallet connection, private key, or signature is needed.","YNX address · default","EVM compatibility address","Corresponding 0x address","Copy","This changes the address format only. It does not move funds or switch networks. Confirm YNX Testnet before receiving test tokens.","View this account in Explorer","Explorer","Testnet Faucet","Documentation","Enter a complete, valid address. Check its length, letter case and YNX checksum.","Address copied.","Copy was unavailable. Select the address and copy it manually."],
    "zh-CN": ["地址转换器","同一个账户，两种地址格式。YNX 默认使用 ynx1 地址，0x 是对应的 EVM 兼容格式。","粘贴完整的 YNX 或 EVM 地址","转换","转换在当前浏览器本地完成，无需连接钱包、私钥或签名。","YNX 地址 · 默认","EVM 兼容地址","对应的 0x 地址","复制","这里只转换地址格式，不转移资产，也不切换网络。领取测试币前，请确认使用 YNX Testnet。","在 Explorer 查看此账户","区块浏览器","测试网水龙头","文档","请输入完整有效的地址，检查长度、大小写及 YNX 校验码。","已复制地址。","暂时无法自动复制，请选中地址后手动复制。"],
    "zh-TW": ["地址轉換器","同一個帳戶，兩種地址格式。YNX 預設使用 ynx1 地址，0x 是對應的 EVM 相容格式。","貼上完整的 YNX 或 EVM 地址","轉換","轉換在目前瀏覽器本機完成，無需連接錢包、私鑰或簽章。","YNX 地址 · 預設","EVM 相容地址","對應的 0x 地址","複製","這裡只轉換地址格式，不轉移資產，也不切換網路。領取測試幣前，請確認使用 YNX Testnet。","在 Explorer 查看此帳戶","區塊瀏覽器","測試網水龍頭","文件","請輸入完整有效的地址，檢查長度、大小寫及 YNX 校驗碼。","已複製地址。","暫時無法自動複製，請選取地址後手動複製。"],
    ja: ["アドレス変換","同じアカウントを表す2つの形式です。YNX の標準は ynx1、0x は対応する EVM 互換形式です。","完全な YNX または EVM アドレスを貼り付け","変換","このブラウザー内で変換します。ウォレット接続、秘密鍵、署名は不要です。","YNX アドレス · 標準","EVM 互換アドレス","対応する 0x アドレス","コピー","アドレス形式のみを変換します。資産の移動やネットワークの切替は行いません。テストトークンの受取前に YNX Testnet を確認してください。","Explorer でこのアカウントを見る","ブロックエクスプローラー","テストネット Faucet","ドキュメント","完全で有効なアドレスを入力し、長さ、大文字と小文字、YNX チェックサムを確認してください。","アドレスをコピーしました。","自動コピーできません。アドレスを選択して手動でコピーしてください。"],
    ko: ["주소 변환기","같은 계정의 두 가지 주소 형식입니다. YNX는 ynx1을 기본으로 사용하며 0x는 해당 EVM 호환 형식입니다.","전체 YNX 또는 EVM 주소 붙여넣기","변환","이 브라우저에서 로컬로 변환합니다. 지갑 연결, 개인 키, 서명이 필요하지 않습니다.","YNX 주소 · 기본","EVM 호환 주소","대응하는 0x 주소","복사","주소 형식만 변환합니다. 자산을 이동하거나 네트워크를 변경하지 않습니다. 테스트 토큰 수령 전에 YNX Testnet인지 확인하세요.","Explorer에서 이 계정 보기","블록 탐색기","테스트넷 Faucet","문서","유효한 전체 주소를 입력하세요. 길이, 대소문자, YNX 체크섬을 확인하세요.","주소를 복사했습니다.","자동 복사를 사용할 수 없습니다. 주소를 선택하여 직접 복사하세요."],
    es: ["Conversor de direcciones","Una cuenta, dos formatos. YNX utiliza ynx1 de forma predeterminada; 0x es su representación compatible con EVM.","Pega una dirección YNX o EVM completa","Convertir","Conversión local en este navegador. No requiere conectar una cartera, clave privada ni firma.","Dirección YNX · predeterminada","Dirección compatible con EVM","Dirección 0x correspondiente","Copiar","Solo cambia el formato de la dirección. No transfiere fondos ni cambia de red. Confirma YNX Testnet antes de recibir tokens de prueba.","Ver esta cuenta en Explorer","Explorador","Faucet de prueba","Documentación","Introduce una dirección completa y válida. Revisa la longitud, las mayúsculas y la suma de comprobación YNX.","Dirección copiada.","No se pudo copiar. Selecciona la dirección y cópiala manualmente."],
    fr: ["Convertisseur d’adresses","Un compte, deux formats. YNX utilise ynx1 par défaut ; 0x est sa représentation compatible EVM.","Collez une adresse YNX ou EVM complète","Convertir","Conversion locale dans ce navigateur. Aucune connexion au portefeuille, clé privée ou signature nécessaire.","Adresse YNX · par défaut","Adresse compatible EVM","Adresse 0x correspondante","Copier","Seul le format de l’adresse change. Aucun transfert de fonds ni changement de réseau. Vérifiez YNX Testnet avant de recevoir des jetons de test.","Voir ce compte dans Explorer","Explorateur","Faucet de test","Documentation","Saisissez une adresse complète et valide. Vérifiez sa longueur, la casse et la somme de contrôle YNX.","Adresse copiée.","Copie indisponible. Sélectionnez l’adresse et copiez-la manuellement."],
    de: ["Adresskonverter","Ein Konto, zwei Formate. YNX verwendet standardmäßig ynx1; 0x ist die zugehörige EVM-kompatible Darstellung.","Vollständige YNX- oder EVM-Adresse einfügen","Umwandeln","Lokale Umwandlung in diesem Browser. Keine Wallet-Verbindung, privaten Schlüssel oder Signaturen erforderlich.","YNX-Adresse · Standard","EVM-kompatible Adresse","Zugehörige 0x-Adresse","Kopieren","Nur das Adressformat ändert sich. Es werden keine Guthaben übertragen oder Netzwerke gewechselt. Prüfe YNX Testnet vor dem Empfang von Test-Token.","Dieses Konto im Explorer ansehen","Explorer","Testnet-Faucet","Dokumentation","Gib eine vollständige, gültige Adresse ein. Prüfe Länge, Groß- und Kleinschreibung und YNX-Prüfsumme.","Adresse kopiert.","Kopieren nicht verfügbar. Wähle die Adresse aus und kopiere sie manuell."],
    pt: ["Conversor de endereços","Uma conta, dois formatos. A YNX usa ynx1 por padrão; 0x é a representação compatível com EVM.","Cole um endereço YNX ou EVM completo","Converter","Conversão local neste navegador. Não exige conexão à carteira, chave privada ou assinatura.","Endereço YNX · padrão","Endereço compatível com EVM","Endereço 0x correspondente","Copiar","Apenas o formato do endereço muda. Não transfere fundos nem muda de rede. Confirme a YNX Testnet antes de receber tokens de teste.","Ver esta conta no Explorer","Explorador","Faucet de teste","Documentação","Insira um endereço completo e válido. Verifique comprimento, maiúsculas e checksum YNX.","Endereço copiado.","Não foi possível copiar. Selecione o endereço e copie manualmente."],
    ru: ["Конвертер адресов","Один аккаунт, два формата. YNX по умолчанию использует ynx1; 0x — соответствующее представление для совместимости с EVM.","Вставьте полный адрес YNX или EVM","Преобразовать","Преобразование выполняется в браузере. Подключение кошелька, закрытый ключ и подпись не нужны.","Адрес YNX · основной","Адрес для совместимости с EVM","Соответствующий адрес 0x","Копировать","Меняется только формат адреса. Средства не переводятся, сеть не меняется. Перед получением тестовых токенов проверьте YNX Testnet.","Посмотреть аккаунт в Explorer","Обозреватель","Тестовый Faucet","Документация","Введите полный действительный адрес. Проверьте длину, регистр и контрольную сумму YNX.","Адрес скопирован.","Копирование недоступно. Выделите адрес и скопируйте вручную."],
    ar: ["محوّل العناوين","حساب واحد بصيغتين. تستخدم YNX عناوين ynx1 افتراضيًا، و0x هي الصيغة المقابلة المتوافقة مع EVM.","ألصق عنوان YNX أو EVM كاملًا","تحويل","يتم التحويل محليًا في هذا المتصفح. لا يلزم ربط محفظة أو مفتاح خاص أو توقيع.","عنوان YNX · الافتراضي","عنوان متوافق مع EVM","عنوان 0x المقابل","نسخ","يتغير تنسيق العنوان فقط. لا يتم نقل أموال أو تغيير الشبكة. تأكد من استخدام YNX Testnet قبل استلام رموز الاختبار.","عرض هذا الحساب في المستكشف","المستكشف","صنبور شبكة الاختبار","الوثائق","أدخل عنوانًا كاملًا وصحيحًا. تحقق من الطول وحالة الأحرف ومجموع التحقق YNX.","تم نسخ العنوان.","تعذر النسخ التلقائي. حدد العنوان وانسخه يدويًا."],
    id: ["Konverter alamat","Satu akun, dua format. YNX menggunakan ynx1 secara default; 0x adalah format kompatibilitas EVM yang bersesuaian.","Tempel alamat YNX atau EVM lengkap","Konversi","Dikonversi secara lokal di browser ini. Tidak perlu menghubungkan dompet, kunci privat, atau tanda tangan.","Alamat YNX · default","Alamat kompatibilitas EVM","Alamat 0x yang bersesuaian","Salin","Hanya format alamat yang berubah. Tidak memindahkan dana atau mengganti jaringan. Pastikan YNX Testnet sebelum menerima token uji.","Lihat akun ini di Explorer","Penjelajah","Faucet testnet","Dokumentasi","Masukkan alamat lengkap yang valid. Periksa panjang, huruf besar-kecil, dan checksum YNX.","Alamat disalin.","Tidak dapat menyalin otomatis. Pilih alamat lalu salin secara manual."]
  };
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const requested = params.get("lang") || navigator.language;
  let language = Object.hasOwn(rows, requested) ? requested : requested?.startsWith("zh") ? "zh-CN" : Object.hasOwn(rows, requested?.split("-")[0]) ? requested.split("-")[0] : "en";
  const t = key => rows[language][keys.indexOf(key)];
  let invalid = false;
  function translate() {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    document.title = "YNX · " + t("title");
    $("language").value = language;
    document.querySelectorAll("[data-text]").forEach(node => { node.textContent = t(node.dataset.text); });
    $("error").textContent = invalid ? t("invalid") : "";
    $("output").setAttribute("aria-label", t("title"));
    $("status").textContent = "";
  }
  function clearResult() {
    $("output").hidden = true;
    $("native").value = $("evm").value = "";
    $("explore").href = "https://explorer.ynxweb4.com";
    $("error").textContent = $("status").textContent = "";
    $("address").removeAttribute("aria-invalid");
    invalid = false;
  }
  function convert() {
    clearResult();
    try {
      const result = YNXAddress.normalizeYNXAddress($("address").value);
      $("native").value = result.ynxAddress;
      $("evm").value = result.evmAddress;
      $("explore").href = "https://explorer.ynxweb4.com/?address=" + encodeURIComponent(result.ynxAddress);
      $("output").hidden = false;
    } catch (_) {
      invalid = true;
      $("error").textContent = t("invalid");
      $("address").setAttribute("aria-invalid", "true");
    }
  }
  async function copy(id) {
    const input = $(id);
    if (!input.value || $("output").hidden) return;
    try { await navigator.clipboard.writeText(input.value); $("status").textContent = t("copied"); }
    catch (_) { input.focus(); input.select(); $("status").textContent = t("copyFailed"); }
  }
  $("language").addEventListener("change", event => { language = event.target.value; translate(); });
  $("convert").addEventListener("click", convert);
  $("address").addEventListener("keydown", event => { if (event.key === "Enter") convert(); });
  $("address").addEventListener("input", clearResult);
  $("copy-native").addEventListener("click", () => copy("native"));
  $("copy-evm").addEventListener("click", () => copy("evm"));
  translate();
  const initial = params.get("address");
  if (initial && initial.length <= 90) { $("address").value = initial; convert(); }
})();
