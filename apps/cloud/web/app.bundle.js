(() => {
  // web/i18n.js
  var locales = ["en", "zh-CN", "zh-TW", "ja", "ko", "es", "fr", "de", "pt", "ru", "ar", "id"];
  var keys = ["app", "search", "signin", "newFolder", "upload", "files", "recent", "starred", "permissions", "trash", "audit", "private", "subtitle", "sync", "ai", "empty", "emptyDetail", "quota"];
  var rows = {
    en: ["YNX Cloud", "Search your authorized files", "Sign in with YNX Wallet", "New folder", "Upload", "Files", "Recent", "Starred", "Permissions", "Trash", "Audit", "Private workspace", "Only items your current YNX identity can access.", "Sync now", "AI workspace", "No files here", "Upload a bounded file or create a folder. File bodies stay off-chain.", "Bounded storage; not unlimited."],
    "zh-CN": ["YNX \u4E91\u76D8", "\u641C\u7D22\u5DF2\u83B7\u6388\u6743\u7684\u6587\u4EF6", "\u4F7F\u7528 YNX \u94B1\u5305\u767B\u5F55", "\u65B0\u5EFA\u6587\u4EF6\u5939", "\u4E0A\u4F20", "\u6587\u4EF6", "\u6700\u8FD1", "\u5DF2\u52A0\u661F\u6807", "\u6743\u9650", "\u56DE\u6536\u7AD9", "\u5BA1\u8BA1", "\u79C1\u6709\u5DE5\u4F5C\u533A", "\u4EC5\u663E\u793A\u5F53\u524D YNX \u8EAB\u4EFD\u83B7\u6743\u8BBF\u95EE\u7684\u9879\u76EE\u3002", "\u7ACB\u5373\u540C\u6B65", "AI \u5DE5\u4F5C\u533A", "\u6B64\u5904\u6CA1\u6709\u6587\u4EF6", "\u4E0A\u4F20\u53D7\u9650\u6587\u4EF6\u6216\u65B0\u5EFA\u6587\u4EF6\u5939\u3002\u6587\u4EF6\u6B63\u6587\u4FDD\u5B58\u5728\u94FE\u4E0B\u3002", "\u5B58\u50A8\u6709\u660E\u786E\u914D\u989D\uFF0C\u5E76\u975E\u65E0\u9650\u3002"],
    "zh-TW": ["YNX \u96F2\u7AEF\u786C\u789F", "\u641C\u5C0B\u5DF2\u7372\u6388\u6B0A\u7684\u6A94\u6848", "\u4F7F\u7528 YNX \u9322\u5305\u767B\u5165", "\u65B0\u589E\u8CC7\u6599\u593E", "\u4E0A\u50B3", "\u6A94\u6848", "\u6700\u8FD1", "\u5DF2\u52A0\u661F\u865F", "\u6B0A\u9650", "\u5783\u573E\u6876", "\u7A3D\u6838", "\u79C1\u4EBA\u5DE5\u4F5C\u5340", "\u50C5\u986F\u793A\u76EE\u524D YNX \u8EAB\u5206\u7372\u51C6\u5B58\u53D6\u7684\u9805\u76EE\u3002", "\u7ACB\u5373\u540C\u6B65", "AI \u5DE5\u4F5C\u5340", "\u9019\u88E1\u6C92\u6709\u6A94\u6848", "\u4E0A\u50B3\u53D7\u9650\u6A94\u6848\u6216\u65B0\u589E\u8CC7\u6599\u593E\u3002\u6A94\u6848\u5167\u5BB9\u4FDD\u5B58\u5728\u93C8\u4E0B\u3002", "\u5132\u5B58\u7A7A\u9593\u6709\u660E\u78BA\u914D\u984D\uFF0C\u4E26\u975E\u7121\u9650\u3002"],
    ja: ["YNX Cloud", "\u8A31\u53EF\u3055\u308C\u305F\u30D5\u30A1\u30A4\u30EB\u3092\u691C\u7D22", "YNX Wallet\u3067\u30B5\u30A4\u30F3\u30A4\u30F3", "\u65B0\u898F\u30D5\u30A9\u30EB\u30C0", "\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9", "\u30D5\u30A1\u30A4\u30EB", "\u6700\u8FD1", "\u30B9\u30BF\u30FC\u4ED8\u304D", "\u6A29\u9650", "\u30B4\u30DF\u7BB1", "\u76E3\u67FB", "\u30D7\u30E9\u30A4\u30D9\u30FC\u30C8\u30EF\u30FC\u30AF\u30B9\u30DA\u30FC\u30B9", "\u73FE\u5728\u306EYNX ID\u306B\u8A31\u53EF\u3055\u308C\u305F\u9805\u76EE\u306E\u307F\u8868\u793A\u3057\u307E\u3059\u3002", "\u4ECA\u3059\u3050\u540C\u671F", "AI\u30EF\u30FC\u30AF\u30B9\u30DA\u30FC\u30B9", "\u30D5\u30A1\u30A4\u30EB\u306F\u3042\u308A\u307E\u305B\u3093", "\u4E0A\u9650\u5185\u306E\u30D5\u30A1\u30A4\u30EB\u3092\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u3059\u308B\u304B\u30D5\u30A9\u30EB\u30C0\u3092\u4F5C\u6210\u3057\u307E\u3059\u3002\u672C\u6587\u306F\u30AA\u30D5\u30C1\u30A7\u30FC\u30F3\u3067\u3059\u3002", "\u4FDD\u5B58\u5BB9\u91CF\u306B\u306F\u4E0A\u9650\u304C\u3042\u308A\u3001\u7121\u5236\u9650\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002"],
    ko: ["YNX Cloud", "\uC2B9\uC778\uB41C \uD30C\uC77C \uAC80\uC0C9", "YNX Wallet\uB85C \uB85C\uADF8\uC778", "\uC0C8 \uD3F4\uB354", "\uC5C5\uB85C\uB4DC", "\uD30C\uC77C", "\uCD5C\uADFC", "\uBCC4\uD45C", "\uAD8C\uD55C", "\uD734\uC9C0\uD1B5", "\uAC10\uC0AC", "\uBE44\uACF5\uAC1C \uC791\uC5C5 \uACF5\uAC04", "\uD604\uC7AC YNX ID\uC5D0 \uD5C8\uC6A9\uB41C \uD56D\uBAA9\uB9CC \uD45C\uC2DC\uD569\uB2C8\uB2E4.", "\uC9C0\uAE08 \uB3D9\uAE30\uD654", "AI \uC791\uC5C5 \uACF5\uAC04", "\uD30C\uC77C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4", "\uC81C\uD55C \uBC94\uC704\uC758 \uD30C\uC77C\uC744 \uC62C\uB9AC\uAC70\uB098 \uD3F4\uB354\uB97C \uB9CC\uB4DC\uC138\uC694. \uBCF8\uBB38\uC740 \uC624\uD504\uCCB4\uC778\uC5D0 \uC800\uC7A5\uB429\uB2C8\uB2E4.", "\uC800\uC7A5 \uACF5\uAC04\uC5D0\uB294 \uD55C\uB3C4\uAC00 \uC788\uC73C\uBA70 \uBB34\uC81C\uD55C\uC774 \uC544\uB2D9\uB2C8\uB2E4."],
    es: ["YNX Cloud", "Buscar archivos autorizados", "Iniciar sesi\xF3n con YNX Wallet", "Nueva carpeta", "Subir", "Archivos", "Recientes", "Destacados", "Permisos", "Papelera", "Auditor\xEDa", "Espacio privado", "Solo se muestran los elementos autorizados para tu identidad YNX.", "Sincronizar", "Espacio de IA", "No hay archivos", "Sube un archivo limitado o crea una carpeta. El contenido permanece fuera de la cadena.", "El almacenamiento tiene cuota; no es ilimitado."],
    fr: ["YNX Cloud", "Rechercher vos fichiers autoris\xE9s", "Se connecter avec YNX Wallet", "Nouveau dossier", "Importer", "Fichiers", "R\xE9cents", "Favoris", "Autorisations", "Corbeille", "Audit", "Espace priv\xE9", "Seuls les \xE9l\xE9ments autoris\xE9s pour votre identit\xE9 YNX sont affich\xE9s.", "Synchroniser", "Espace IA", "Aucun fichier", "Importez un fichier limit\xE9 ou cr\xE9ez un dossier. Le contenu reste hors cha\xEEne.", "Le stockage est limit\xE9, pas illimit\xE9."],
    de: ["YNX Cloud", "Autorisierte Dateien suchen", "Mit YNX Wallet anmelden", "Neuer Ordner", "Hochladen", "Dateien", "Zuletzt", "Markiert", "Berechtigungen", "Papierkorb", "Audit", "Privater Arbeitsbereich", "Nur f\xFCr Ihre YNX-Identit\xE4t freigegebene Elemente werden angezeigt.", "Jetzt synchronisieren", "KI-Arbeitsbereich", "Keine Dateien", "Laden Sie eine begrenzte Datei hoch oder erstellen Sie einen Ordner. Inhalte bleiben off-chain.", "Speicher hat ein Kontingent und ist nicht unbegrenzt."],
    pt: ["YNX Cloud", "Pesquisar arquivos autorizados", "Entrar com YNX Wallet", "Nova pasta", "Carregar", "Arquivos", "Recentes", "Favoritos", "Permiss\xF5es", "Lixeira", "Auditoria", "Espa\xE7o privado", "Mostra apenas itens autorizados para sua identidade YNX.", "Sincronizar", "Espa\xE7o de IA", "Nenhum arquivo", "Carregue um arquivo limitado ou crie uma pasta. O conte\xFAdo fica fora da cadeia.", "O armazenamento tem cota; n\xE3o \xE9 ilimitado."],
    ru: ["YNX Cloud", "\u041F\u043E\u0438\u0441\u043A \u0440\u0430\u0437\u0440\u0435\u0448\u0451\u043D\u043D\u044B\u0445 \u0444\u0430\u0439\u043B\u043E\u0432", "\u0412\u043E\u0439\u0442\u0438 \u0447\u0435\u0440\u0435\u0437 YNX Wallet", "\u041D\u043E\u0432\u0430\u044F \u043F\u0430\u043F\u043A\u0430", "\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C", "\u0424\u0430\u0439\u043B\u044B", "\u041D\u0435\u0434\u0430\u0432\u043D\u0438\u0435", "\u0418\u0437\u0431\u0440\u0430\u043D\u043D\u044B\u0435", "\u0420\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u044F", "\u041A\u043E\u0440\u0437\u0438\u043D\u0430", "\u0410\u0443\u0434\u0438\u0442", "\u041B\u0438\u0447\u043D\u043E\u0435 \u043F\u0440\u043E\u0441\u0442\u0440\u0430\u043D\u0441\u0442\u0432\u043E", "\u041F\u043E\u043A\u0430\u0437\u0430\u043D\u044B \u0442\u043E\u043B\u044C\u043A\u043E \u043E\u0431\u044A\u0435\u043A\u0442\u044B, \u0440\u0430\u0437\u0440\u0435\u0448\u0451\u043D\u043D\u044B\u0435 \u0442\u0435\u043A\u0443\u0449\u0435\u0439 YNX-\u0443\u0447\u0451\u0442\u043D\u043E\u0439 \u0437\u0430\u043F\u0438\u0441\u0438.", "\u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u0442\u044C", "\u0420\u0430\u0431\u043E\u0447\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C \u0418\u0418", "\u0424\u0430\u0439\u043B\u043E\u0432 \u043D\u0435\u0442", "\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 \u0444\u0430\u0439\u043B \u0434\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u043E\u0433\u043E \u0440\u0430\u0437\u043C\u0435\u0440\u0430 \u0438\u043B\u0438 \u0441\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u043F\u0430\u043F\u043A\u0443. \u0421\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435 \u0445\u0440\u0430\u043D\u0438\u0442\u0441\u044F \u0432\u043D\u0435 \u0441\u0435\u0442\u0438.", "\u0425\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u043E \u043A\u0432\u043E\u0442\u043E\u0439."],
    ar: ["\u0633\u062D\u0627\u0628\u0629 YNX", "\u0627\u0628\u062D\u062B \u0641\u064A \u0645\u0644\u0641\u0627\u062A\u0643 \u0627\u0644\u0645\u0635\u0631\u0651\u062D \u0628\u0647\u0627", "\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0628\u0645\u062D\u0641\u0638\u0629 YNX", "\u0645\u062C\u0644\u062F \u062C\u062F\u064A\u062F", "\u0631\u0641\u0639", "\u0627\u0644\u0645\u0644\u0641\u0627\u062A", "\u0627\u0644\u0623\u062E\u064A\u0631\u0629", "\u0627\u0644\u0645\u0645\u064A\u0632\u0629", "\u0627\u0644\u0623\u0630\u0648\u0646\u0627\u062A", "\u0627\u0644\u0645\u0647\u0645\u0644\u0627\u062A", "\u0627\u0644\u062A\u062F\u0642\u064A\u0642", "\u0645\u0633\u0627\u062D\u0629 \u0639\u0645\u0644 \u062E\u0627\u0635\u0629", "\u062A\u0638\u0647\u0631 \u0641\u0642\u0637 \u0627\u0644\u0639\u0646\u0627\u0635\u0631 \u0627\u0644\u0645\u0635\u0631\u0651\u062D \u0644\u0647\u0648\u064A\u0629 YNX \u0627\u0644\u062D\u0627\u0644\u064A\u0629 \u0628\u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u064A\u0647\u0627.", "\u0627\u0644\u0645\u0632\u0627\u0645\u0646\u0629 \u0627\u0644\u0622\u0646", "\u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A", "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0644\u0641\u0627\u062A", "\u0627\u0631\u0641\u0639 \u0645\u0644\u0641\u064B\u0627 \u0636\u0645\u0646 \u0627\u0644\u062D\u062F \u0623\u0648 \u0623\u0646\u0634\u0626 \u0645\u062C\u0644\u062F\u064B\u0627. \u062A\u0628\u0642\u0649 \u0645\u062D\u062A\u0648\u064A\u0627\u062A \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u062E\u0627\u0631\u062C \u0627\u0644\u0633\u0644\u0633\u0644\u0629.", "\u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0645\u062D\u062F\u062F \u0628\u062D\u0635\u0629 \u0648\u0644\u064A\u0633 \u063A\u064A\u0631 \u0645\u062D\u062F\u0648\u062F."],
    id: ["YNX Cloud", "Cari file yang diizinkan", "Masuk dengan YNX Wallet", "Folder baru", "Unggah", "File", "Terbaru", "Berbintang", "Izin", "Sampah", "Audit", "Ruang kerja privat", "Hanya item yang diizinkan untuk identitas YNX saat ini yang ditampilkan.", "Sinkronkan", "Ruang kerja AI", "Tidak ada file", "Unggah file terbatas atau buat folder. Isi file tetap di luar rantai.", "Penyimpanan memiliki kuota, bukan tanpa batas."]
  };
  var t = (locale, key) => rows[locale]?.[keys.indexOf(key)] ?? rows.en[keys.indexOf(key)];
  var erasure = {
    en: { open: "Delete Cloud data", title: "Delete all Cloud data", intro: "Download your export first. A separate Wallet approval is required. Legal holds or active retention stop the entire deletion. Provider failures remain pending and are not reported as erased.", export: "Download verified export", authorize: "Authorize data deletion", confirm: "Type DELETE CLOUD DATA", erase: "Delete Cloud data", receipts: "Recover deletion receipts", complete: "Known provider deletions completed.", pending: "Logical deletion completed; provider deletion is still pending.", purpose: "Delete my YNX Cloud product data after exact confirmation." },
    "zh-CN": { open: "\u5220\u9664\u4E91\u76D8\u6570\u636E", title: "\u5220\u9664\u5168\u90E8\u4E91\u76D8\u6570\u636E", intro: "\u8BF7\u5148\u4E0B\u8F7D\u5BFC\u51FA\u6587\u4EF6\u3002\u6B64\u64CD\u4F5C\u9700\u8981\u5355\u72EC\u7684\u94B1\u5305\u6388\u6743\u3002\u6CD5\u5F8B\u4FDD\u7559\u6216\u6709\u6548\u4FDD\u7559\u671F\u4F1A\u963B\u6B62\u6574\u4E2A\u5220\u9664\u3002\u63D0\u4F9B\u5546\u5931\u8D25\u53EA\u4F1A\u6807\u4E3A\u5F85\u5904\u7406\u3002", export: "\u4E0B\u8F7D\u5DF2\u9A8C\u8BC1\u5BFC\u51FA", authorize: "\u6388\u6743\u5220\u9664\u6570\u636E", confirm: "\u8F93\u5165 DELETE CLOUD DATA", erase: "\u5220\u9664\u4E91\u76D8\u6570\u636E", receipts: "\u6062\u590D\u5220\u9664\u56DE\u6267", complete: "\u5DF2\u5B8C\u6210\u5DF2\u77E5\u63D0\u4F9B\u5546\u5220\u9664\u3002", pending: "\u903B\u8F91\u5220\u9664\u5DF2\u5B8C\u6210\uFF1B\u63D0\u4F9B\u5546\u5220\u9664\u4ECD\u5F85\u5904\u7406\u3002", purpose: "\u5728\u7CBE\u786E\u786E\u8BA4\u540E\u5220\u9664\u6211\u7684 YNX \u4E91\u76D8\u4EA7\u54C1\u6570\u636E\u3002" },
    "zh-TW": { open: "\u522A\u9664\u96F2\u7AEF\u8CC7\u6599", title: "\u522A\u9664\u5168\u90E8\u96F2\u7AEF\u8CC7\u6599", intro: "\u8ACB\u5148\u4E0B\u8F09\u532F\u51FA\u6A94\u3002\u6B64\u64CD\u4F5C\u9700\u8981\u7368\u7ACB\u7684\u9322\u5305\u6388\u6B0A\u3002\u6CD5\u5F8B\u4FDD\u7559\u6216\u6709\u6548\u4FDD\u7559\u671F\u6703\u963B\u6B62\u6574\u500B\u522A\u9664\uFF1B\u4F9B\u61C9\u5546\u5931\u6557\u53EA\u6703\u6A19\u793A\u70BA\u5F85\u8655\u7406\u3002", export: "\u4E0B\u8F09\u5DF2\u9A57\u8B49\u532F\u51FA", authorize: "\u6388\u6B0A\u522A\u9664\u8CC7\u6599", confirm: "\u8F38\u5165 DELETE CLOUD DATA", erase: "\u522A\u9664\u96F2\u7AEF\u8CC7\u6599", receipts: "\u5FA9\u539F\u522A\u9664\u56DE\u57F7", complete: "\u5DF2\u5B8C\u6210\u5DF2\u77E5\u4F9B\u61C9\u5546\u522A\u9664\u3002", pending: "\u908F\u8F2F\u522A\u9664\u5DF2\u5B8C\u6210\uFF1B\u4F9B\u61C9\u5546\u522A\u9664\u4ECD\u5F85\u8655\u7406\u3002", purpose: "\u5728\u7CBE\u78BA\u78BA\u8A8D\u5F8C\u522A\u9664\u6211\u7684 YNX \u96F2\u7AEF\u7522\u54C1\u8CC7\u6599\u3002" },
    ja: { open: "Cloud\u30C7\u30FC\u30BF\u3092\u524A\u9664", title: "Cloud\u30C7\u30FC\u30BF\u3092\u3059\u3079\u3066\u524A\u9664", intro: "\u5148\u306B\u30A8\u30AF\u30B9\u30DD\u30FC\u30C8\u3092\u4FDD\u5B58\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u5225\u306EWallet\u627F\u8A8D\u304C\u5FC5\u8981\u3067\u3059\u3002\u6CD5\u7684\u4FDD\u7559\u307E\u305F\u306F\u6709\u52B9\u306A\u4FDD\u6301\u671F\u9593\u304C\u3042\u308B\u5834\u5408\u3001\u524A\u9664\u5168\u4F53\u3092\u505C\u6B62\u3057\u307E\u3059\u3002\u30D7\u30ED\u30D0\u30A4\u30C0\u30FC\u969C\u5BB3\u306F\u4FDD\u7559\u3068\u3057\u3066\u8868\u793A\u3055\u308C\u307E\u3059\u3002", export: "\u691C\u8A3C\u6E08\u307F\u30A8\u30AF\u30B9\u30DD\u30FC\u30C8", authorize: "\u30C7\u30FC\u30BF\u524A\u9664\u3092\u627F\u8A8D", confirm: "DELETE CLOUD DATA \u3068\u5165\u529B", erase: "Cloud\u30C7\u30FC\u30BF\u3092\u524A\u9664", receipts: "\u524A\u9664\u30EC\u30B7\u30FC\u30C8\u3092\u5FA9\u65E7", complete: "\u65E2\u77E5\u306E\u30D7\u30ED\u30D0\u30A4\u30C0\u30FC\u524A\u9664\u304C\u5B8C\u4E86\u3057\u307E\u3057\u305F\u3002", pending: "\u8AD6\u7406\u524A\u9664\u306F\u5B8C\u4E86\u3057\u307E\u3057\u305F\u304C\u3001\u30D7\u30ED\u30D0\u30A4\u30C0\u30FC\u524A\u9664\u306F\u4FDD\u7559\u4E2D\u3067\u3059\u3002", purpose: "\u6B63\u78BA\u306A\u78BA\u8A8D\u5F8C\u306BYNX Cloud\u88FD\u54C1\u30C7\u30FC\u30BF\u3092\u524A\u9664\u3057\u307E\u3059\u3002" },
    ko: { open: "Cloud \uB370\uC774\uD130 \uC0AD\uC81C", title: "\uBAA8\uB4E0 Cloud \uB370\uC774\uD130 \uC0AD\uC81C", intro: "\uBA3C\uC800 \uB0B4\uBCF4\uB0B4\uAE30\uB97C \uC800\uC7A5\uD558\uC138\uC694. \uBCC4\uB3C4\uC758 Wallet \uC2B9\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4. \uBC95\uC801 \uBCF4\uC874 \uB610\uB294 \uD65C\uC131 \uBCF4\uC874 \uAE30\uAC04\uC740 \uC804\uCCB4 \uC0AD\uC81C\uB97C \uC911\uB2E8\uD569\uB2C8\uB2E4. \uACF5\uAE09\uC790 \uC2E4\uD328\uB294 \uB300\uAE30 \uC0C1\uD0DC\uB85C \uD45C\uC2DC\uB429\uB2C8\uB2E4.", export: "\uAC80\uC99D\uB41C \uB0B4\uBCF4\uB0B4\uAE30 \uB2E4\uC6B4\uB85C\uB4DC", authorize: "\uB370\uC774\uD130 \uC0AD\uC81C \uC2B9\uC778", confirm: "DELETE CLOUD DATA \uC785\uB825", erase: "Cloud \uB370\uC774\uD130 \uC0AD\uC81C", receipts: "\uC0AD\uC81C \uC601\uC218\uC99D \uBCF5\uAD6C", complete: "\uC54C\uB824\uC9C4 \uACF5\uAE09\uC790 \uC0AD\uC81C\uAC00 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4.", pending: "\uB17C\uB9AC \uC0AD\uC81C\uB294 \uC644\uB8CC\uB410\uC9C0\uB9CC \uACF5\uAE09\uC790 \uC0AD\uC81C\uB294 \uB300\uAE30 \uC911\uC785\uB2C8\uB2E4.", purpose: "\uC815\uD655\uD788 \uD655\uC778\uD55C \uD6C4 YNX Cloud \uC81C\uD488 \uB370\uC774\uD130\uB97C \uC0AD\uC81C\uD569\uB2C8\uB2E4." },
    es: { open: "Eliminar datos de Cloud", title: "Eliminar todos los datos de Cloud", intro: "Descarga primero tu exportaci\xF3n. Se requiere una autorizaci\xF3n separada de Wallet. La retenci\xF3n legal o activa bloquea toda la eliminaci\xF3n. Los fallos del proveedor quedan pendientes.", export: "Descargar exportaci\xF3n verificada", authorize: "Autorizar eliminaci\xF3n", confirm: "Escribe DELETE CLOUD DATA", erase: "Eliminar datos de Cloud", receipts: "Recuperar recibos", complete: "Se completaron las eliminaciones conocidas del proveedor.", pending: "La eliminaci\xF3n l\xF3gica termin\xF3; la del proveedor sigue pendiente.", purpose: "Eliminar mis datos de YNX Cloud tras la confirmaci\xF3n exacta." },
    fr: { open: "Supprimer les donn\xE9es Cloud", title: "Supprimer toutes les donn\xE9es Cloud", intro: "T\xE9l\xE9chargez d\u2019abord votre export. Une autorisation Wallet distincte est requise. Une conservation l\xE9gale ou active bloque toute la suppression. Les \xE9checs fournisseur restent en attente.", export: "T\xE9l\xE9charger l\u2019export v\xE9rifi\xE9", authorize: "Autoriser la suppression", confirm: "Saisissez DELETE CLOUD DATA", erase: "Supprimer les donn\xE9es Cloud", receipts: "R\xE9cup\xE9rer les re\xE7us", complete: "Les suppressions fournisseur connues sont termin\xE9es.", pending: "Suppression logique termin\xE9e ; suppression fournisseur en attente.", purpose: "Supprimer mes donn\xE9es YNX Cloud apr\xE8s confirmation exacte." },
    de: { open: "Cloud-Daten l\xF6schen", title: "Alle Cloud-Daten l\xF6schen", intro: "Laden Sie zuerst den Export herunter. Eine separate Wallet-Freigabe ist erforderlich. Rechtliche oder aktive Aufbewahrung blockiert die gesamte L\xF6schung. Providerfehler bleiben ausstehend.", export: "Gepr\xFCften Export laden", authorize: "Datenl\xF6schung freigeben", confirm: "DELETE CLOUD DATA eingeben", erase: "Cloud-Daten l\xF6schen", receipts: "L\xF6schbelege abrufen", complete: "Bekannte Providerl\xF6schungen abgeschlossen.", pending: "Logische L\xF6schung abgeschlossen; Providerl\xF6schung ausstehend.", purpose: "Meine YNX Cloud-Daten nach exakter Best\xE4tigung l\xF6schen." },
    pt: { open: "Excluir dados do Cloud", title: "Excluir todos os dados do Cloud", intro: "Baixe primeiro a exporta\xE7\xE3o. \xC9 necess\xE1ria autoriza\xE7\xE3o separada da Wallet. Reten\xE7\xE3o legal ou ativa bloqueia toda a exclus\xE3o. Falhas do provedor ficam pendentes.", export: "Baixar exporta\xE7\xE3o verificada", authorize: "Autorizar exclus\xE3o", confirm: "Digite DELETE CLOUD DATA", erase: "Excluir dados do Cloud", receipts: "Recuperar recibos", complete: "Exclus\xF5es conhecidas do provedor conclu\xEDdas.", pending: "Exclus\xE3o l\xF3gica conclu\xEDda; exclus\xE3o do provedor pendente.", purpose: "Excluir meus dados YNX Cloud ap\xF3s confirma\xE7\xE3o exata." },
    ru: { open: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435 Cloud", title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0432\u0441\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 Cloud", intro: "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0441\u043A\u0430\u0447\u0430\u0439\u0442\u0435 \u044D\u043A\u0441\u043F\u043E\u0440\u0442. \u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u0435 Wallet. \u042E\u0440\u0438\u0434\u0438\u0447\u0435\u0441\u043A\u043E\u0435 \u0438\u043B\u0438 \u0434\u0435\u0439\u0441\u0442\u0432\u0443\u044E\u0449\u0435\u0435 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435 \u0431\u043B\u043E\u043A\u0438\u0440\u0443\u0435\u0442 \u0432\u0441\u0451 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u0435. \u041E\u0448\u0438\u0431\u043A\u0438 \u043F\u0440\u043E\u0432\u0430\u0439\u0434\u0435\u0440\u0430 \u043E\u0441\u0442\u0430\u044E\u0442\u0441\u044F \u0432 \u043E\u0436\u0438\u0434\u0430\u043D\u0438\u0438.", export: "\u0421\u043A\u0430\u0447\u0430\u0442\u044C \u043F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043D\u044B\u0439 \u044D\u043A\u0441\u043F\u043E\u0440\u0442", authorize: "\u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u044C \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u0435", confirm: "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 DELETE CLOUD DATA", erase: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435 Cloud", receipts: "\u0412\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u043A\u0432\u0438\u0442\u0430\u043D\u0446\u0438\u0438", complete: "\u0418\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0435 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u0443 \u043F\u0440\u043E\u0432\u0430\u0439\u0434\u0435\u0440\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u044B.", pending: "\u041B\u043E\u0433\u0438\u0447\u0435\u0441\u043A\u043E\u0435 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u043E; \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u0435 \u0443 \u043F\u0440\u043E\u0432\u0430\u0439\u0434\u0435\u0440\u0430 \u043E\u0436\u0438\u0434\u0430\u0435\u0442\u0441\u044F.", purpose: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u043C\u043E\u0438 \u0434\u0430\u043D\u043D\u044B\u0435 YNX Cloud \u043F\u043E\u0441\u043B\u0435 \u0442\u043E\u0447\u043D\u043E\u0433\u043E \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u044F." },
    ar: { open: "\u062D\u0630\u0641 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0633\u062D\u0627\u0628\u0629", title: "\u062D\u0630\u0641 \u062C\u0645\u064A\u0639 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0633\u062D\u0627\u0628\u0629", intro: "\u0646\u0632\u0651\u0644 \u0646\u0633\u062E\u0629 \u0627\u0644\u062A\u0635\u062F\u064A\u0631 \u0623\u0648\u0644\u0627\u064B. \u064A\u0644\u0632\u0645 \u062A\u0641\u0648\u064A\u0636 \u0645\u0646\u0641\u0635\u0644 \u0645\u0646 \u0627\u0644\u0645\u062D\u0641\u0638\u0629. \u064A\u0645\u0646\u0639 \u0627\u0644\u062D\u062C\u0632 \u0627\u0644\u0642\u0627\u0646\u0648\u0646\u064A \u0623\u0648 \u0627\u0644\u0627\u062D\u062A\u0641\u0627\u0638 \u0627\u0644\u0633\u0627\u0631\u064A \u0639\u0645\u0644\u064A\u0629 \u0627\u0644\u062D\u0630\u0641 \u0643\u0627\u0645\u0644\u0629. \u062A\u0628\u0642\u0649 \u0625\u062E\u0641\u0627\u0642\u0627\u062A \u0627\u0644\u0645\u0632\u0648\u062F \u0645\u0639\u0644\u0651\u0642\u0629.", export: "\u062A\u0646\u0632\u064A\u0644 \u0627\u0644\u062A\u0635\u062F\u064A\u0631 \u0627\u0644\u0645\u062A\u062D\u0642\u0642", authorize: "\u062A\u0641\u0648\u064A\u0636 \u062D\u0630\u0641 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A", confirm: "\u0627\u0643\u062A\u0628 DELETE CLOUD DATA", erase: "\u062D\u0630\u0641 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0633\u062D\u0627\u0628\u0629", receipts: "\u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0625\u064A\u0635\u0627\u0644\u0627\u062A \u0627\u0644\u062D\u0630\u0641", complete: "\u0627\u0643\u062A\u0645\u0644\u062A \u0639\u0645\u0644\u064A\u0627\u062A \u062D\u0630\u0641 \u0627\u0644\u0645\u0632\u0648\u062F \u0627\u0644\u0645\u0639\u0631\u0648\u0641\u0629.", pending: "\u0627\u0643\u062A\u0645\u0644 \u0627\u0644\u062D\u0630\u0641 \u0627\u0644\u0645\u0646\u0637\u0642\u064A\u061B \u062D\u0630\u0641 \u0627\u0644\u0645\u0632\u0648\u062F \u0645\u0627 \u0632\u0627\u0644 \u0645\u0639\u0644\u0642\u064B\u0627.", purpose: "\u062D\u0630\u0641 \u0628\u064A\u0627\u0646\u0627\u062A \u0645\u0646\u062A\u062C YNX Cloud \u0628\u0639\u062F \u0627\u0644\u062A\u0623\u0643\u064A\u062F \u0627\u0644\u062F\u0642\u064A\u0642." },
    id: { open: "Hapus data Cloud", title: "Hapus semua data Cloud", intro: "Unduh ekspor terlebih dahulu. Otorisasi Wallet terpisah diperlukan. Penahanan hukum atau retensi aktif memblokir seluruh penghapusan. Kegagalan penyedia tetap berstatus tertunda.", export: "Unduh ekspor terverifikasi", authorize: "Izinkan penghapusan", confirm: "Ketik DELETE CLOUD DATA", erase: "Hapus data Cloud", receipts: "Pulihkan tanda terima", complete: "Penghapusan penyedia yang diketahui selesai.", pending: "Penghapusan logis selesai; penghapusan penyedia masih tertunda.", purpose: "Hapus data produk YNX Cloud saya setelah konfirmasi tepat." }
  };
  var erasureT = (locale, key) => erasure[locale]?.[key] ?? erasure.en[key];
  function selectedLocale() {
    const requested = new URLSearchParams(location.search).get("locale") || localStorage.getItem("ynx.cloud.locale") || navigator.language;
    return locales.includes(requested) ? requested : requested.startsWith("zh-TW") ? "zh-TW" : requested.startsWith("zh") ? "zh-CN" : locales.find((x) => requested.startsWith(x)) || "en";
  }
  function applyLocale(locale) {
    localStorage.setItem("ynx.cloud.locale", locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    const selectors = { app: ".brand span", search: "#search", signin: "#wallet", newFolder: "#new-folder", upload: ".upload", files: '[data-view="files"]', recent: '[data-view="recent"]', starred: '[data-view="starred"]', permissions: '[data-view="shared"]', trash: '[data-view="trash"]', audit: '[data-view="audit"]', private: ".workspace-head .eyebrow", subtitle: "#view-subtitle", sync: "#sync", ai: "#ai-open", empty: "#empty h2", emptyDetail: "#empty p", quota: ".quota small", viewTitle: "#view-title" };
    for (const [key, selector] of Object.entries(selectors)) {
      const node = document.querySelector(selector);
      if (!node) continue;
      if (key === "search") node.placeholder = t(locale, key);
      else if (key === "signin") {
        if (node.dataset.connected !== "true") node.textContent = t(locale, key);
      } else if (key === "viewTitle") node.textContent = t(locale, "files");
      else if (key === "upload") {
        const input = node.querySelector("input");
        node.textContent = t(locale, key);
        node.append(input);
      } else node.textContent = t(locale, key);
    }
    for (const [id, key] of Object.entries({ "erase-open": "open", "erase-title": "title", "erase-intro": "intro", "erase-export": "export", "erase-authorize": "authorize", "erase-confirm-label": "confirm", "erase-submit": "erase", "erase-receipts": "receipts" })) {
      const node = document.getElementById(id);
      if (node) node.textContent = erasureT(locale, key);
    }
    const select = document.querySelector("#locale");
    if (select) select.value = locale;
  }

  // ../../packages/dapp-connect-sdk/src/constants.js
  var YNX_TESTNET = Object.freeze({
    cosmosChainId: "ynx_6423-1",
    evmChainId: 6423,
    evmChainHex: "0x1917",
    nativeAsset: "YNXT",
    externalAccountFormat: "0x-prefixed EVM account only"
  });
  var WALLET_PROTOCOL_REFERENCE = Object.freeze({
    version: "p0-wallet-connection-v1",
    sourceCommit: "66003e76e804da16d472255efde50cb879055b96",
    contractPath: "packages/wallet-auth/integration/p0-wallet-connectivity-candidate.json"
  });
  var EIP1193_METHODS = Object.freeze({
    accounts: "eth_requestAccounts",
    chainId: "eth_chainId",
    addChain: "wallet_addEthereumChain",
    switchChain: "wallet_switchEthereumChain",
    sign: "personal_sign",
    signTypedData: "eth_signTypedData_v4",
    sendTransaction: "eth_sendTransaction"
  });

  // ../../packages/dapp-connect-sdk/src/errors.js
  var EIP1193_CODES = /* @__PURE__ */ new Map([
    [4001, "WALLET_USER_REJECTED"],
    [4100, "WALLET_UNAUTHORIZED"],
    [4200, "WALLET_UNSUPPORTED_METHOD"],
    [4900, "WALLET_DISCONNECTED"],
    [4901, "WALLET_CHAIN_DISCONNECTED"]
  ]);
  var PROTOCOL_CODES = /* @__PURE__ */ new Set(["UNKNOWN_OR_MISSING_FIELD", "NON_CANONICAL_JSON", "INVALID_JSON", "INVALID_FIELD", "INVALID_PROOF_HEADER"]);
  var DEVICE_CODES = /* @__PURE__ */ new Set(["INVALID_DEVICE_PROOF", "INVALID_DEVICE_KEY", "DEVICE_MISMATCH", "SESSION_BINDING_MISMATCH"]);
  var EXPIRY_CODES = /* @__PURE__ */ new Set(["EXPIRED", "INVALID_EXPIRY", "INVALID_TIME", "ISSUED_IN_FUTURE"]);
  var GATEWAY_STATUSES = /* @__PURE__ */ new Set([502, 503, 504]);
  var DAppConnectError = class extends Error {
    constructor(code, message, { cause, requestId, traceId, errorId, details } = {}) {
      super(message, { cause });
      this.name = "DAppConnectError";
      this.code = code;
      this.requestId = requestId;
      this.traceId = traceId;
      this.errorId = errorId;
      this.details = details;
    }
  };
  function classifyWalletError(error) {
    const status2 = Number(error?.status ?? error?.response?.status);
    const serverCode = error?.code ?? error?.response?.data?.code;
    const correlation = { requestId: error?.requestId ?? error?.response?.headers?.["x-request-id"], traceId: error?.traceId ?? error?.response?.headers?.["x-trace-id"], errorId: error?.errorId ?? error?.response?.headers?.["x-error-id"] };
    if (EIP1193_CODES.has(Number(serverCode))) return new DAppConnectError(EIP1193_CODES.get(Number(serverCode)), error?.message || "Wallet request failed", { cause: error, ...correlation });
    if (DEVICE_CODES.has(serverCode)) return new DAppConnectError("PRODUCT_SESSION_DEVICE_PROOF_REJECTED", error?.message || "Product Session device proof was rejected", { cause: error, ...correlation });
    if (PROTOCOL_CODES.has(serverCode)) return new DAppConnectError("PRODUCT_SESSION_PROTOCOL_REJECTED", error?.message || "Product Session protocol was rejected", { cause: error, ...correlation });
    if (EXPIRY_CODES.has(serverCode)) return new DAppConnectError("PRODUCT_SESSION_EXPIRED_OR_CLOCK_SKEW", error?.message || "Product Session expired or clock is incorrect", { cause: error, ...correlation });
    if (GATEWAY_STATUSES.has(status2) || error?.name === "AbortError" || error?.network === true) return new DAppConnectError("PRODUCT_SESSION_GATEWAY_UNREACHABLE", error?.message || "Product Session gateway is unreachable", { cause: error, ...correlation });
    return new DAppConnectError(serverCode || "WALLET_CONNECTION_FAILED", error?.message || "Wallet connection failed", { cause: error, ...correlation });
  }

  // ../../packages/dapp-connect-sdk/src/provider.js
  function validAddress(value) {
    return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
  }
  function assertProvider(provider) {
    if (!provider || typeof provider.request !== "function") throw new DAppConnectError("PROVIDER_REQUIRED", "A standard EIP-1193 wallet provider is required.");
  }
  var StandardWalletConnection = class {
    constructor(provider, { chain = YNX_TESTNET } = {}) {
      assertProvider(provider);
      this.provider = provider;
      this.chain = chain;
      this.account = null;
      this.chainId = null;
    }
    async connect() {
      try {
        const accounts = await this.provider.request({ method: EIP1193_METHODS.accounts });
        if (!Array.isArray(accounts) || !validAddress(accounts[0])) throw new DAppConnectError("INVALID_EVM_ACCOUNT", "Wallet did not return an approved 0x EVM account.");
        this.account = accounts[0];
        this.chainId = await this.provider.request({ method: EIP1193_METHODS.chainId });
        return { account: this.account, chainId: this.chainId, state: "STANDARD_CONNECTED" };
      } catch (error) {
        throw classifyWalletError(error);
      }
    }
    async ensureYNXTestnet({ addChain } = {}) {
      try {
        const current = await this.provider.request({ method: EIP1193_METHODS.chainId });
        if (String(current).toLowerCase() === this.chain.evmChainHex) return { chainId: current, switched: false };
        try {
          await this.provider.request({ method: EIP1193_METHODS.switchChain, params: [{ chainId: this.chain.evmChainHex }] });
        } catch (error) {
          if (Number(error?.code) !== 4902 || !addChain) throw error;
          await this.provider.request({ method: EIP1193_METHODS.addChain, params: [addChain] });
        }
        this.chainId = await this.provider.request({ method: EIP1193_METHODS.chainId });
        if (String(this.chainId).toLowerCase() !== this.chain.evmChainHex) throw new DAppConnectError("WRONG_CHAIN", "Wallet did not switch to YNX Testnet.");
        return { chainId: this.chainId, switched: true };
      } catch (error) {
        throw classifyWalletError(error);
      }
    }
    async signMessage(message, account = this.account) {
      if (!validAddress(account)) throw new DAppConnectError("ACCOUNT_REQUIRED", "Connect an EVM account before signing.");
      try {
        return await this.provider.request({ method: EIP1193_METHODS.sign, params: [message, account] });
      } catch (error) {
        throw classifyWalletError(error);
      }
    }
    async signTypedData(typedData, account = this.account) {
      if (!validAddress(account)) throw new DAppConnectError("ACCOUNT_REQUIRED", "Connect an EVM account before signing.");
      try {
        return await this.provider.request({ method: EIP1193_METHODS.signTypedData, params: [account, JSON.stringify(typedData)] });
      } catch (error) {
        throw classifyWalletError(error);
      }
    }
    async sendTransaction(transaction) {
      if (!this.account) throw new DAppConnectError("ACCOUNT_REQUIRED", "Connect an EVM account before sending a transaction.");
      try {
        return await this.provider.request({ method: EIP1193_METHODS.sendTransaction, params: [{ ...transaction, from: transaction.from || this.account }] });
      } catch (error) {
        throw classifyWalletError(error);
      }
    }
    on(event, listener) {
      if (typeof this.provider.on !== "function") throw new DAppConnectError("PROVIDER_EVENTS_UNSUPPORTED", "Wallet provider does not expose EIP-1193 events.");
      this.provider.on(event, listener);
      return () => this.provider.removeListener?.(event, listener);
    }
  };

  // ../../packages/dapp-connect-sdk/src/discovery.js
  async function discoverEIP6963(windowLike, { timeoutMs = 250 } = {}) {
    if (!windowLike?.addEventListener || !windowLike?.dispatchEvent) throw new DAppConnectError("DISCOVERY_ENVIRONMENT_REQUIRED", "EIP-6963 discovery requires a browser event target.");
    const providers = /* @__PURE__ */ new Map();
    const receive = (event) => {
      const detail = event?.detail;
      if (detail?.info?.uuid && detail?.provider?.request) providers.set(detail.info.uuid, detail);
    };
    windowLike.addEventListener("eip6963:announceProvider", receive);
    windowLike.dispatchEvent(new Event("eip6963:requestProvider"));
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    windowLike.removeEventListener("eip6963:announceProvider", receive);
    return [...providers.values()];
  }

  // web/app.js
  var $ = (q) => document.querySelector(q);
  var $$ = (q) => [...document.querySelectorAll(q)];
  var state = { token: "", erasureToken: "", authMode: "normal", standardWallet: null, objects: [], selected: /* @__PURE__ */ new Set(), current: null, view: "files", parentId: "" };
  var apiBase = YNX_CLOUD_RUNTIME.apiBase;
  function status(message, error = false) {
    $("#status").textContent = message;
    $("#status").classList.toggle("danger", error);
  }
  function bytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1048576).toFixed(1)} MB`;
  }
  async function api(path, options = {}) {
    const { token = state.token, ...request } = options, headers = { ...request.headers || {} };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (request.body && !(request.body instanceof FormData)) headers["Content-Type"] = "application/json";
    const response = await fetch(`${apiBase}${path}`, { ...request, headers });
    const type = response.headers.get("content-type") || "";
    const body = type.includes("json") ? await response.json() : await response.blob();
    if (!response.ok) {
      const e = new Error(body.error || `Request failed: ${response.status}`);
      e.status = response.status;
      e.body = body;
      throw e;
    }
    return body;
  }
  async function signIn(mode = "normal") {
    state.authMode = mode;
    $("#auth-dialog").showModal();
    $("#auth-state").textContent = state.standardWallet ? "Standard Wallet remains connected. Private Cloud Product Session v2 is unavailable; no local session was created." : mode === "erasure" ? erasureT(selectedLocale(), "authorize") : "Connect a standard EVM Wallet. Private Cloud files remain closed until a separate Product Session v2 is available.";
  }
  async function walletProviders() {
    const providers = await discoverEIP6963(window, { timeoutMs: 220 });
    if (window.ethereum?.request && !providers.some((entry) => entry.provider === window.ethereum)) providers.push({ info: { uuid: "legacy-injected", name: window.ethereum.isMetaMask ? "MetaMask" : "Injected wallet" }, provider: window.ethereum });
    return providers;
  }
  async function startWallet(metaMaskOnly = false) {
    const auth = $("#auth-state");
    try {
      const providers = await walletProviders(), selected = (metaMaskOnly ? providers.find((entry) => /metamask/i.test(entry.info?.name || "")) : providers.find((entry) => /ynx/i.test(entry.info?.name || ""))) || providers[0];
      if (!selected) throw new Error("No compatible Wallet detected. Download YNX Wallet or install MetaMask.");
      const connection = new StandardWalletConnection(selected.provider, { chain: YNX_TESTNET }), connected = await connection.connect();
      await connection.ensureYNXTestnet({ addChain: { chainId: "0x1917", chainName: "YNX Testnet", nativeCurrency: { name: "YNX Testnet", symbol: "YNXT", decimals: 18 }, rpcUrls: [YNX_CLOUD_RUNTIME.evmRpc], blockExplorerUrls: [YNX_CLOUD_RUNTIME.explorer] } });
      state.standardWallet = connection;
      $("#wallet").dataset.connected = "true";
      $("#wallet").textContent = `${connected.account.slice(0, 8)}\u2026${connected.account.slice(-6)}`;
      auth.textContent = "Standard Wallet connected on 0x1917. Private Cloud files, uploads, sharing and deletion remain unavailable until Product Session v2 is active. No local or canned session was created.";
      status("Standard Wallet connected. Public Cloud information remains available; private service is degraded.");
    } catch (e) {
      auth.textContent = e.message;
      auth.classList.add("danger");
    }
  }
  async function load() {
    if (!state.token) {
      status("Sign in to load your authorized workspace.");
      $("#empty").hidden = false;
      return;
    }
    try {
      if (state.view === "audit") {
        const events = await api("/audit");
        renderAudit(events);
        await loadQuota();
        status(`${events.length} authorized audit events`);
        return;
      }
      const query = new URLSearchParams({ limit: "200" });
      if (state.parentId) query.set("parentId", state.parentId);
      if (state.view !== "files" && state.view !== "shared") query.set("view", state.view);
      const q = $("#search").value.trim();
      if (q) query.set("q", q);
      const page = await api(`/objects?${query}`);
      state.objects = page.items;
      render();
      await loadQuota();
      $("#wallet").textContent = "Wallet connected";
      status(`${state.objects.length} authorized item${state.objects.length === 1 ? "" : "s"}${page.nextCursor ? " \xB7 More available through paged API" : ""} \xB7 Synced ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`);
    } catch (e) {
      if (e.status === 401) {
        state.token = "";
        delete $("#wallet").dataset.connected;
        $("#wallet").textContent = "Sign in with YNX Wallet";
      }
      status(e.message, true);
    }
  }
  function renderAudit(events) {
    const root = $("#files");
    root.replaceChildren();
    $("#empty").hidden = events.length !== 0;
    for (const e of events) {
      const row = document.createElement("article");
      row.className = "file";
      const title = document.createElement("strong");
      title.textContent = e.action;
      const meta = document.createElement("span");
      meta.className = "file-meta";
      meta.textContent = `${new Date(e.at).toLocaleString()} \xB7 ${e.actor}${e.objectId ? ` \xB7 ${e.objectId}` : ""}`;
      row.append(title, meta);
      root.append(row);
    }
  }
  async function checkSharedIntent() {
    const token = new URLSearchParams(location.search).get("share");
    if (!token) return;
    try {
      const response = await fetch(`${apiBase}/shares/${encodeURIComponent(token)}`);
      const object = await response.json();
      if (!response.ok) throw new Error(object.error || "Share link unavailable");
      const root = $("#files");
      root.replaceChildren();
      $("#empty").hidden = true;
      const card = document.createElement("article");
      card.className = "file";
      const title = document.createElement("strong");
      title.textContent = object.name;
      const meta = document.createElement("span");
      meta.className = "file-meta";
      meta.textContent = `Time-bounded view link \xB7 ${object.kind} \xB7 v${object.version}`;
      const preview = document.createElement("button");
      preview.className = "quiet";
      preview.textContent = "Open shared preview";
      preview.onclick = () => window.open(`${apiBase}/shares/${encodeURIComponent(token)}/content`, "_blank", "noopener");
      const request = document.createElement("button");
      request.className = "quiet";
      request.textContent = "Request ongoing access";
      request.onclick = async () => {
        if (!state.token) return signIn();
        try {
          await api(`/objects/${object.id}/access-requests`, { method: "POST", body: JSON.stringify({ role: "viewer", message: "Requested from a time-bounded share link" }) });
          status("Access request sent. The owner must approve it explicitly.");
        } catch (e) {
          status(e.message, true);
        }
      };
      card.append(title, meta, preview, request);
      root.append(card);
      $("#view-title").textContent = "Shared item";
      $("#view-subtitle").textContent = "The link expires and can be revoked. Ongoing access requires owner approval.";
    } catch (e) {
      status(e.message, true);
    }
  }
  function render() {
    const root = $("#files");
    root.replaceChildren();
    $("#empty").hidden = state.objects.length !== 0;
    for (const o of state.objects) {
      const b = document.createElement("button");
      b.className = "file" + (state.selected.has(o.id) ? " selected" : "");
      b.dataset.id = o.id;
      b.setAttribute("aria-pressed", state.selected.has(o.id));
      b.innerHTML = `<span class="file-name"></span><span class="file-kind">${o.kind}</span><span class="file-size">${o.kind === "folder" ? "\u2014" : bytes(o.size)}</span><span class="file-meta">v${o.version || 0} \xB7 ${new Date(o.updatedAt).toLocaleString()}${o.starred ? " \xB7 Starred" : ""}</span>`;
      b.querySelector(".file-name").textContent = o.name;
      b.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey) {
          state.selected.has(o.id) ? state.selected.delete(o.id) : state.selected.add(o.id);
          render();
          updateAIContext();
        } else if (o.kind === "folder") {
          state.parentId = o.id;
          load();
        } else {
          openDetails(o);
        }
      });
      root.append(b);
    }
  }
  async function loadQuota() {
    const q = await api("/quota");
    $("#quota-used").textContent = bytes(q.usedBytes);
    $("#quota-limit").textContent = ` / ${bytes(q.limitBytes)}`;
    $("#quota-bar").value = Math.min(100, q.usedBytes / q.limitBytes * 100);
  }
  async function createFolder() {
    if (!state.token) return signIn();
    const name = prompt("Folder name");
    if (!name) return;
    try {
      await api("/objects", { method: "POST", body: JSON.stringify({ kind: "folder", name, parentId: state.parentId, content: "" }) });
      await load();
    } catch (e) {
      status(e.message, true);
    }
  }
  function syncDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("ynx-cloud-sync", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("uploads", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function queueUpload(file) {
    const db = await syncDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("uploads", "readwrite");
      tx.objectStore("uploads").put({ id: crypto.randomUUID(), name: file.name, mime: file.type || "application/octet-stream", parentId: state.parentId, blob: file, queuedAt: (/* @__PURE__ */ new Date()).toISOString() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }
  async function uploadOne(file, parentId = state.parentId) {
    const content = await file.arrayBuffer();
    let binary = "";
    const bytes2 = new Uint8Array(content);
    for (let i = 0; i < bytes2.length; i += 32768) binary += String.fromCharCode(...bytes2.subarray(i, i + 32768));
    await api("/objects", { method: "POST", body: JSON.stringify({ kind: "file", name: file.name, mime: file.type || "application/octet-stream", parentId, content: btoa(binary), encryption: { clientSide: false } }) });
  }
  async function directUploadOne(file, parentId = state.parentId) {
    const content = await file.arrayBuffer(), digest = new Uint8Array(await crypto.subtle.digest("SHA-256", content)), hash = [...digest].map((x) => x.toString(16).padStart(2, "0")).join("");
    const initiated = await api("/direct-uploads", { method: "POST", body: JSON.stringify({ name: file.name, mime: file.type || "application/octet-stream", parentId, expectedSize: file.size, expectedHash: hash, encryption: { clientSide: false } }) }), id = initiated.upload.id, plan = initiated.plan;
    try {
      const response = await fetch(plan.url, { method: plan.method, headers: plan.headers, body: file });
      if (!response.ok) throw new Error(`object provider upload failed: ${response.status}`);
      await api(`/direct-uploads/${id}/complete`, { method: "POST" });
    } catch (e) {
      try {
        await api(`/direct-uploads/${id}`, { method: "DELETE" });
      } catch {
      }
      throw e;
    }
  }
  async function upload(files) {
    for (const file of files) {
      if (file.size > 67108864) {
        status(`${file.name} exceeds this browser client's 64 MB verified-upload limit. Use the API/SDK after a production provider is configured.`, true);
        continue;
      }
      try {
        if (!navigator.onLine) {
          await queueUpload(file);
          status(`${file.name} queued locally for explicit sync.`);
        } else {
          file.size <= 8388608 ? await uploadOne(file) : await directUploadOne(file);
          status(`Uploaded ${file.name}`);
        }
      } catch (e) {
        status(`${file.name}: ${e.message}`, true);
      }
    }
    if (navigator.onLine) await load();
  }
  async function syncQueued() {
    if (!navigator.onLine || !state.token) return;
    const db = await syncDB();
    const queued = await new Promise((resolve, reject) => {
      const r = db.transaction("uploads").objectStore("uploads").getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    for (const item of queued) {
      try {
        const file = new File([item.blob], item.name, { type: item.mime });
        file.size <= 8388608 ? await uploadOne(file, item.parentId) : await directUploadOne(file, item.parentId);
        await new Promise((resolve, reject) => {
          const tx = db.transaction("uploads", "readwrite");
          tx.objectStore("uploads").delete(item.id);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      } catch (e) {
        status(`Sync paused at ${item.name}: ${e.message}`, true);
        break;
      }
    }
    db.close();
    if (queued.length) await load();
  }
  async function openDetails(o) {
    state.current = o;
    $("#details").hidden = false;
    $("#detail-name").textContent = o.name;
    $("#metadata").innerHTML = `<dt>Owner</dt><dd>${o.owner}</dd><dt>Version</dt><dd>${o.version}</dd><dt>Integrity</dt><dd>${o.hash || "folder metadata only"}</dd><dt>Encryption</dt><dd>${o.encryption.clientSide ? "Client-side; server has no key" : "Server-readable within explicit permissions"}</dd><dt>Scan</dt><dd>${o.scanStatus || "not applicable"}</dd>`;
    $("#star").textContent = o.starred ? "Unstar" : "Star";
    $("#trash").textContent = o.trashedAt ? "Restore" : "Move to trash";
    $("#delete").hidden = !o.trashedAt;
    $("#preview").textContent = "Loading verified preview\u2026";
    try {
      if (o.mime?.startsWith("text/") || o.kind === "doc") {
        const blob = await api(`/objects/${o.id}/content`);
        $("#preview").textContent = (await blob.text()).slice(0, 6e3) || "Empty file";
      } else {
        $("#preview").textContent = "Preview is bounded to safe text in this client. Download verifies the content hash.";
      }
    } catch (e) {
      $("#preview").textContent = e.message;
    }
  }
  async function permanentDelete() {
    if (!state.current?.trashedAt) return;
    const confirmation = prompt(`Type DELETE to permanently remove ${state.current.name}. This cannot be undone.`);
    if (confirmation !== "DELETE") {
      status("Permanent deletion canceled.");
      return;
    }
    try {
      await api(`/objects/${state.current.id}`, { method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }) });
      $("#details").hidden = true;
      status("Object deleted. Content-addressed blob retention follows the operator policy.");
      await load();
    } catch (e) {
      status(e.message, true);
    }
  }
  async function mutate(path, body) {
    try {
      await api(path, { method: "POST", body: body ? JSON.stringify(body) : void 0 });
      $("#details").hidden = true;
      await load();
    } catch (e) {
      status(e.message, true);
    }
  }
  async function download() {
    const o = state.current;
    if (!o) return;
    try {
      const blob = await api(`/objects/${o.id}/content`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = o.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1e3);
    } catch (e) {
      status(e.message, true);
    }
  }
  async function exportData() {
    if (!state.token) return signIn();
    try {
      status("Building a verified portable export\u2026");
      const blob = await api("/export");
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url;
      a.download = `ynx-cloud-export-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1e3);
      status("Portable export downloaded. Keep it private: it contains every owned version and permission metadata.");
    } catch (e) {
      status(e.message, true);
    }
  }
  function openErasure() {
    $("#erase-confirm").value = "";
    $("#erase-submit").disabled = true;
    $("#erase-export").disabled = !state.token;
    $("#erase-result").textContent = "";
    $("#erase-receipts").disabled = !state.erasureToken;
    $("#erase-dialog").showModal();
  }
  async function eraseData() {
    if ($("#erase-confirm").value !== "DELETE CLOUD DATA" || !state.erasureToken) return;
    try {
      const receipt = await api("/account-data", { token: state.erasureToken, method: "DELETE", body: JSON.stringify({ confirm: "DELETE CLOUD DATA" }) });
      state.token = "";
      state.erasureToken = "";
      state.objects = [];
      state.selected.clear();
      render();
      delete $("#wallet").dataset.connected;
      $("#wallet").textContent = erasureT(selectedLocale(), "complete");
      $("#erase-submit").disabled = true;
      $("#erase-receipts").disabled = true;
      $("#erase-result").textContent = `${receipt.pendingBlobs ? erasureT(selectedLocale(), "pending") : erasureT(selectedLocale(), "complete")} ${receipt.id}`;
    } catch (e) {
      $("#erase-result").textContent = e.message;
    }
  }
  async function recoverErasureReceipts() {
    if (!state.erasureToken) return signIn("erasure");
    try {
      const receipts = await api("/account-data/erasures", { token: state.erasureToken });
      $("#erase-result").textContent = receipts.length ? receipts.map((x) => `${x.id} \xB7 ${x.pendingBlobs ? erasureT(selectedLocale(), "pending") : erasureT(selectedLocale(), "complete")}`).join("\n") : "\u2014";
    } catch (e) {
      $("#erase-result").textContent = e.message;
    }
  }
  async function showVersions() {
    const list = await api(`/objects/${state.current.id}/versions`);
    $("#detail-panel").innerHTML = "<h3>Version history</h3>" + list.map((v) => `<div class="grant-row">v${v.number} \xB7 ${bytes(v.size)} \xB7 ${new Date(v.createdAt).toLocaleString()}<br><button data-restore="${v.number}" class="quiet">Restore as new version</button></div>`).join("");
    $$("[data-restore]").forEach((b) => b.onclick = () => mutate(`/objects/${state.current.id}/versions/${b.dataset.restore}/restore`));
  }
  async function showShare() {
    if (!state.current) return;
    $("#share-dialog").showModal();
    try {
      const [grants, links] = await Promise.all([api(`/objects/${state.current.id}/grants`), api(`/objects/${state.current.id}/links`)]);
      $("#grant-list").innerHTML = grants.map((g) => `<div class="grant-row">${g.principal}<br>${g.role}${g.expiresAt ? ` \xB7 expires ${new Date(g.expiresAt).toLocaleString()}` : ""}${g.revokedAt ? " \xB7 revoked" : ` <button data-revoke="${g.id}">Revoke</button>`}</div>`).join("") + links.map((l) => `<div class="grant-row">View link \xB7 expires ${new Date(l.expiresAt).toLocaleString()}${l.revokedAt ? " \xB7 revoked" : ` <button data-link-revoke="${l.id}">Revoke link</button>`}</div>`).join("") || '<p class="callout">No additional grants or links.</p>';
      $$("[data-revoke]").forEach((b) => b.onclick = async () => {
        await api(`/objects/${state.current.id}/grants/${b.dataset.revoke}`, { method: "DELETE" });
        showShare();
      });
      $$("[data-link-revoke]").forEach((b) => b.onclick = async () => {
        await api(`/objects/${state.current.id}/links/${b.dataset.linkRevoke}`, { method: "DELETE" });
        showShare();
      });
    } catch (e) {
      $("#grant-list").textContent = e.message;
    }
  }
  async function grant() {
    try {
      const expires = $("#share-expiry").value ? new Date($("#share-expiry").value).toISOString() : null;
      await api(`/objects/${state.current.id}/grants`, { method: "POST", body: JSON.stringify({ principal: $("#share-account").value, role: $("#share-role").value, expiresAt: expires }) });
      showShare();
    } catch (e) {
      status(e.message, true);
    }
  }
  async function createLink() {
    try {
      const r = await api(`/objects/${state.current.id}/links`, { method: "POST", body: JSON.stringify({ role: "viewer", expiresAt: new Date(Date.now() + 864e5).toISOString() }) });
      await navigator.clipboard?.writeText(`${location.origin}${apiBase}/shares/${r.token}`);
      status("A 24-hour view link was created and copied. It can be revoked from the API audit surface.");
    } catch (e) {
      status(e.message, true);
    }
  }
  function updateAIContext() {
    const chosen = state.objects.filter((o) => state.selected.has(o.id) && o.kind !== "folder");
    $("#ai-context").textContent = chosen.length ? chosen.map((o) => `${o.name} \xB7 ${o.id}@v${o.version}`).join("\n") : "No files selected.";
  }
  async function runAI() {
    const chosen = state.objects.filter((o) => state.selected.has(o.id) && o.kind !== "folder");
    if (!$("#ai-consent").checked) {
      $("#ai-result").textContent = "Explicit selected-context consent is required.";
      return;
    }
    try {
      const provider = await api("/ai/status");
      $("#ai-result").textContent = `Provider: ${provider.provider} / ${provider.model}. ${provider.available ? "Queued with cancel control\u2026" : "Unavailable; no canned answer will be substituted."}`;
      let job = await api("/ai/jobs", { method: "POST", body: JSON.stringify({ mode: $("#ai-mode").value, instruction: $("#ai-instruction").value, objectIds: chosen.map((x) => x.id), versions: chosen.map((x) => x.version), consent: true }) });
      const cancel = document.createElement("button");
      cancel.className = "quiet";
      cancel.textContent = "Cancel generation";
      cancel.onclick = () => api(`/ai/jobs/${job.id}/cancel`, { method: "POST" });
      $("#ai-result").append(document.createElement("br"), cancel);
      while (job.status === "queued" || job.status === "running") {
        await new Promise((r) => setTimeout(r, 250));
        job = await api(`/ai/jobs/${job.id}`);
        $("#ai-result").firstChild.textContent = `${job.status} \xB7 estimated ${job.estimatedUnits} resource units`;
      }
      $("#ai-result").replaceChildren(document.createTextNode(job.status === "review" ? `${job.result}

Citations: ${job.citations.join(", ")}` : `${job.status}: ${job.error}`));
      if (job.status === "review") {
        for (const decision of ["applied", "rejected"]) {
          const b = document.createElement("button");
          b.className = "quiet";
          b.textContent = decision === "applied" ? "Accept result" : "Reject result";
          b.onclick = async () => {
            job = await api(`/ai/jobs/${job.id}/review`, { method: "POST", body: JSON.stringify({ decision }) });
            $("#ai-result").textContent = `Result ${job.status}; source files were unchanged.`;
          };
          $("#ai-result").append(document.createElement("br"), b);
        }
      }
    } catch (e) {
      $("#ai-result").textContent = e.message;
    }
  }
  function setView(view, button) {
    state.view = view;
    state.parentId = "";
    $$("[data-view]").forEach((x) => x.removeAttribute("aria-current"));
    button.setAttribute("aria-current", "page");
    $("#view-title").textContent = button.textContent;
    load();
  }
  applyLocale(selectedLocale());
  $("#locale").onchange = (e) => applyLocale(e.target.value);
  $("#erase-open").onclick = openErasure;
  $("#erase-export").onclick = exportData;
  $("#erase-authorize").onclick = () => {
    $("#erase-dialog").close();
    signIn("erasure");
  };
  $("#erase-confirm").oninput = (e) => $("#erase-submit").disabled = e.target.value !== "DELETE CLOUD DATA" || !state.erasureToken;
  $("#erase-submit").onclick = eraseData;
  $("#erase-receipts").onclick = recoverErasureReceipts;
  $("#wallet").onclick = signIn;
  $("#auth-start").onclick = startWallet;
  $("#new-folder").onclick = createFolder;
  $("#upload").onchange = (e) => upload(e.target.files);
  $("#export-data").onclick = exportData;
  $("#search").oninput = () => {
    clearTimeout(window.searchTimer);
    window.searchTimer = setTimeout(load, 250);
  };
  $$("[data-view]").forEach((b) => b.onclick = () => setView(b.dataset.view, b));
  $("#sync").onclick = syncQueued;
  $("#details-close").onclick = () => $("#details").hidden = true;
  $("#download").onclick = download;
  $("#star").onclick = () => mutate(`/objects/${state.current.id}/star`, { starred: !state.current.starred });
  $("#trash").onclick = () => mutate(`/objects/${state.current.id}/${state.current.trashedAt ? "restore" : "trash"}`);
  $("#delete").onclick = permanentDelete;
  $("#versions").onclick = showVersions;
  $("#share").onclick = showShare;
  $("#share-save").onclick = grant;
  $("#link-create").onclick = createLink;
  $("#ai-open").onclick = () => {
    $("#ai-panel").hidden = false;
    updateAIContext();
  };
  $("#ai-close").onclick = () => $("#ai-panel").hidden = true;
  $("#ai-run").onclick = runAI;
  window.addEventListener("offline", () => $("#offline").hidden = false);
  window.addEventListener("online", () => {
    $("#offline").hidden = true;
    syncQueued();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      $("#search").focus();
    }
  });
  load().then(syncQueued).then(checkSharedIntent);
  $("#auth-start").onclick = () => startWallet(false);
  $("#auth-metamask").onclick = () => startWallet(true);
})();
