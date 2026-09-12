// Product guidance, not claims of deployed service availability.
export const guides = {
  'zh-Hant': {
    name: '繁體中文', title: '寫作、審閱與恢復',
    headings: ['新手入門', '離線與衝突恢復', '開發者', 'API 參考', '白皮書與語言覆蓋'],
    paragraphs: [
      '閱讀指南不必連接錢包。開啟編輯器，在 YNX 錢包中確認 Docs 權限後建立文件。不要輸入助記詞或私鑰。服務可用且授權成功後才能存取文件。',
      '離開前查看儲存狀態。離線草稿只留在目前裝置；若伺服器已有新版，先比較，再將草稿另存新文件或選用伺服器版本。版本恢復必須明確確認。評論引用特定版本；在線狀態不代表即時共同編輯。',
      'Docs 產品會話與標準錢包連線分開。僅偵測到 MetaMask 不能建立 YNX 私有授權。缺少授權橋或使用者拒絕時可以重試。AI 僅在同意後接收選中的文件版本，結果需審閱後套用。',
      '下列是編輯器使用的相對路徑，不代表公網服務已上線。文件請求需服務端授權；401 要求重新授權，版本衝突須比較恢復。憑據只放在 Authorization 標頭，不放進網址或日誌。',
      '尚未配置權威白皮書下載。本指南提供 12 種語言，包括阿拉伯語從右至左排版。Web 編輯器目前為英文；指南語言覆蓋不代表所有產品畫面均已翻譯。'
    ]
  },
  ja: {
    name: '日本語', title: '書く、確認する、復元する',
    headings: ['はじめに', 'オフラインと競合の復旧', '開発者向け', 'API リファレンス', 'ホワイトペーパーと言語'],
    paragraphs: [
      'ガイドの閲覧にウォレット接続は不要です。エディターを開き、YNX Wallet で Docs の権限を確認して文書を作成します。復元フレーズや秘密鍵を入力しないでください。文書へのアクセスには認可とサービスの稼働が必要です。',
      'ページを離れる前に保存状態を確認してください。オフライン下書きはこの端末だけに残ります。サーバーに新しい版がある場合は比較してから、下書きを新規文書に保存するかサーバー版を選びます。復元には明示的な確認が必要です。コメントは特定の版を参照し、在席表示はリアルタイム共同編集ではありません。',
      'Docs のセッションと標準ウォレット接続は別です。MetaMask の検出だけでは YNX の専用認可を作成できません。ブリッジがない場合や要求を拒否した場合は再試行できます。AI には同意後に選択した版だけが送られ、結果は確認してから適用します。',
      '以下はエディターが使用する相対パスであり、公開 API の稼働を示すものではありません。サーバーの認可が必要です。401 では再認可し、版の競合は比較して復旧します。認証情報は Authorization ヘッダーで送り、URL やログに含めないでください。',
      '正式なホワイトペーパーのダウンロードは未設定です。このガイドはアラビア語の右から左の表示を含む12言語に対応しています。Web エディターは現在英語であり、ガイドの翻訳は全画面の翻訳完了を意味しません。'
    ]
  },
  ko: {
    name: '한국어', title: '작성, 검토, 복구',
    headings: ['시작하기', '오프라인 및 충돌 복구', '개발자 안내', 'API 참고', '백서와 언어'],
    paragraphs: [
      '가이드를 읽는 데 지갑 연결은 필요하지 않습니다. 편집기를 열고 YNX Wallet에서 Docs 권한을 확인한 후 문서를 만드세요. 복구 문구나 개인 키를 입력하지 마세요. 문서 접근에는 승인과 사용 가능한 서비스가 필요합니다.',
      '페이지를 떠나기 전에 저장 상태를 확인하세요. 오프라인 초안은 현재 기기에만 남습니다. 서버에 새 버전이 있으면 비교 후 초안을 새 문서로 저장하거나 서버 버전을 선택하세요. 복원에는 명시적 확인이 필요합니다. 댓글은 특정 버전을 참조하며 접속 표시는 실시간 공동 편집이 아닙니다.',
      'Docs 세션은 표준 지갑 연결과 별개입니다. MetaMask 감지만으로 YNX 전용 승인을 만들 수 없습니다. 브리지가 없거나 요청을 거절한 경우 다시 시도할 수 있습니다. AI에는 동의 후 선택한 문서 버전만 보내며 결과는 검토 후 적용합니다.',
      '아래는 편집기가 사용하는 상대 경로이며 공개 API가 운영 중이라는 뜻은 아닙니다. 서버 승인이 필요합니다. 401이면 다시 승인하고 버전 충돌은 비교 후 복구하세요. 인증 정보는 Authorization 헤더에만 넣고 URL이나 로그에 남기지 마세요.',
      '공식 백서 다운로드는 아직 설정되지 않았습니다. 이 가이드는 아랍어 오른쪽에서 왼쪽 표시를 포함한 12개 언어를 제공합니다. Web 편집기는 현재 영어이며 가이드 번역은 모든 화면의 번역 완료를 뜻하지 않습니다.'
    ]
  },
  es: {
    name: 'Español', title: 'Escribir, revisar y recuperar',
    headings: ['Primeros pasos', 'Borradores y conflictos', 'Desarrolladores', 'Referencia de API', 'Libro blanco e idiomas'],
    paragraphs: [
      'No necesita conectar una cartera para leer esta guía. Abra el editor, revise los permisos de Docs en YNX Wallet y cree un documento. Nunca introduzca frases de recuperación ni claves privadas. El acceso requiere autorización y un servicio disponible.',
      'Compruebe el estado de guardado antes de salir. Los borradores sin conexión permanecen en este dispositivo. Si existe una versión más reciente, compare ambas y guarde el borrador como documento nuevo o elija la versión del servidor. Confirme las restauraciones. Los comentarios citan una versión; la presencia no implica edición simultánea.',
      'La sesión de Docs es independiente de la conexión estándar de cartera. Detectar MetaMask no crea una autorización privada de YNX. Puede reintentar si falta el puente o rechaza la solicitud. La IA recibe únicamente la versión seleccionada tras su consentimiento; revise el resultado antes de aplicarlo.',
      'Las rutas relativas siguientes son las utilizadas por el editor, no una prueba de disponibilidad pública. El servidor debe autorizar el acceso. Un 401 requiere nueva autorización; los conflictos requieren comparación. Envíe las credenciales en Authorization, nunca en direcciones URL ni registros.',
      'No hay una descarga oficial del libro blanco configurada. Esta guía ofrece 12 idiomas, con lectura de derecha a izquierda para árabe. El editor web sigue en inglés; traducir la guía no equivale a traducir todas las pantallas.'
    ]
  },
  fr: {
    name: 'Français', title: 'Écrire, relire et récupérer',
    headings: ['Bien démarrer', 'Brouillons et conflits', 'Développeurs', 'Référence API', 'Livre blanc et langues'],
    paragraphs: [
      'La lecture de ce guide ne nécessite aucun portefeuille. Ouvrez l’éditeur, vérifiez les droits Docs dans YNX Wallet puis créez un document. Ne saisissez jamais de phrase de récupération ni de clé privée. L’accès nécessite une autorisation et un service disponible.',
      'Vérifiez l’enregistrement avant de quitter la page. Les brouillons hors ligne restent sur cet appareil. Si une version plus récente existe, comparez les textes puis créez un document avec le brouillon ou choisissez la version du serveur. Confirmez toute restauration. Les commentaires citent une version ; la présence ne signifie pas une édition simultanée.',
      'La session Docs est distincte de la connexion standard du portefeuille. Détecter MetaMask ne crée pas d’autorisation privée YNX. Réessayez si le pont manque ou après un refus. L’IA reçoit uniquement la version choisie après consentement ; relisez sa réponse avant de l’appliquer.',
      'Les chemins relatifs ci-dessous sont utilisés par l’éditeur et ne prouvent pas la disponibilité d’une API publique. Le serveur contrôle l’accès. Un 401 exige une nouvelle autorisation ; un conflit nécessite une comparaison. Placez les identifiants dans Authorization, jamais dans les URL ou les journaux.',
      'Aucun téléchargement officiel du livre blanc n’est configuré. Ce guide propose 12 langues et une présentation de droite à gauche en arabe. L’éditeur web reste en anglais ; le guide traduit ne signifie pas que tous les écrans le sont.'
    ]
  },
  de: {
    name: 'Deutsch', title: 'Schreiben, prüfen, wiederherstellen',
    headings: ['Erste Schritte', 'Entwürfe und Konflikte', 'Entwicklung', 'API-Referenz', 'Whitepaper und Sprachen'],
    paragraphs: [
      'Zum Lesen ist keine Wallet-Verbindung nötig. Öffnen Sie den Editor, prüfen Sie die Docs-Berechtigungen in YNX Wallet und erstellen Sie ein Dokument. Geben Sie niemals Wiederherstellungswörter oder private Schlüssel ein. Der Zugriff erfordert eine Autorisierung und einen verfügbaren Dienst.',
      'Prüfen Sie vor dem Verlassen den Speicherstatus. Offline-Entwürfe bleiben auf diesem Gerät. Gibt es eine neuere Serverversion, vergleichen Sie beide und speichern den Entwurf als neues Dokument oder wählen die Serverversion. Bestätigen Sie Wiederherstellungen ausdrücklich. Kommentare beziehen sich auf eine Version; die Präsenzanzeige bedeutet keine gleichzeitige Bearbeitung.',
      'Die Docs-Sitzung ist von der Standard-Wallet-Verbindung getrennt. Das Erkennen von MetaMask erstellt keine private YNX-Autorisierung. Bei fehlender Bridge oder abgelehnter Anfrage können Sie es erneut versuchen. Die KI erhält nur die gewählte Version nach Zustimmung; prüfen Sie das Ergebnis vor der Anwendung.',
      'Die folgenden relativen Pfade werden vom Editor verwendet und belegen keine öffentliche API-Verfügbarkeit. Der Server muss den Zugriff erlauben. Bei 401 ist eine neue Autorisierung nötig, bei Versionskonflikten ein Vergleich. Zugangsdaten gehören in Authorization, niemals in URLs oder Protokolle.',
      'Ein offizieller Whitepaper-Download ist noch nicht eingerichtet. Dieser Leitfaden bietet 12 Sprachen einschließlich rechtsläufiger Leserichtung von rechts nach links für Arabisch. Der Web-Editor ist derzeit englisch; übersetzte Hilfen bedeuten nicht, dass alle Ansichten übersetzt sind.'
    ]
  },
  pt: {
    name: 'Português', title: 'Escrever, revisar e recuperar',
    headings: ['Primeiros passos', 'Rascunhos e conflitos', 'Desenvolvedores', 'Referência da API', 'Whitepaper e idiomas'],
    paragraphs: [
      'Não é preciso conectar uma carteira para ler este guia. Abra o editor, confira as permissões de Docs na YNX Wallet e crie um documento. Nunca informe frases de recuperação ou chaves privadas. O acesso exige autorização e serviço disponível.',
      'Confira o estado de salvamento antes de sair. Rascunhos offline ficam neste dispositivo. Se houver uma versão mais recente no servidor, compare os textos e salve o rascunho como novo documento ou escolha a versão do servidor. Confirme restaurações. Comentários citam uma versão; presença não significa edição simultânea.',
      'A sessão Docs é independente da conexão padrão da carteira. Detectar MetaMask não cria autorização privada YNX. Tente novamente se a ponte estiver ausente ou após recusar um pedido. A IA recebe somente a versão selecionada após consentimento; revise o resultado antes de aplicar.',
      'Os caminhos relativos abaixo são usados pelo editor e não comprovam uma API pública disponível. O servidor autoriza o acesso. Um 401 exige nova autorização; conflitos de versão exigem comparação. Envie credenciais em Authorization, nunca em URLs ou registros.',
      'Não há download oficial de whitepaper configurado. Este guia oferece 12 idiomas, com direção da direita para a esquerda em árabe. O editor web permanece em inglês; o guia traduzido não significa que todas as telas estejam traduzidas.'
    ]
  },
  ru: {
    name: 'Русский', title: 'Пишите, проверяйте, восстанавливайте',
    headings: ['Начало работы', 'Черновики и конфликты', 'Разработчикам', 'Справочник API', 'Белая книга и языки'],
    paragraphs: [
      'Для чтения руководства кошелёк не нужен. Откройте редактор, проверьте разрешения Docs в YNX Wallet и создайте документ. Никогда не вводите фразу восстановления или закрытый ключ. Доступ требует авторизации и работающего сервиса.',
      'Перед уходом проверьте состояние сохранения. Офлайн-черновики остаются на этом устройстве. Если на сервере есть новая версия, сравните тексты и сохраните черновик как новый документ либо выберите серверную версию. Подтвердите восстановление. Комментарии относятся к конкретной версии; присутствие не означает одновременное редактирование.',
      'Сеанс Docs отделён от стандартного подключения кошелька. Обнаружение MetaMask не создаёт частную авторизацию YNX. При отсутствии моста или отказе можно повторить запрос. ИИ получает лишь выбранную версию после согласия; проверьте результат перед применением.',
      'Ниже указаны относительные пути редактора, а не подтверждение доступности публичного API. Доступ проверяет сервер. Код 401 требует повторной авторизации, конфликт версий — сравнения. Передавайте учётные данные в Authorization, не в URL или журналах.',
      'Официальная загрузка белой книги ещё не настроена. Руководство доступно на 12 языках, включая арабский с направлением справа налево. Веб-редактор пока на английском; перевод руководства не означает перевод всех экранов.'
    ]
  },
  ar: {
    name: 'العربية', title: 'اكتب وراجع واستعد مستنداتك',
    headings: ['البدء', 'المسودات والتعارضات', 'للمطورين', 'مرجع الواجهة البرمجية', 'الورقة البيضاء واللغات'],
    paragraphs: [
      'لا تحتاج إلى ربط محفظة لقراءة الدليل. افتح المحرر وراجع أذونات Docs في YNX Wallet ثم أنشئ مستنداً. لا تدخل عبارة الاسترداد أو المفتاح الخاص مطلقاً. يتطلب الوصول تفويضاً وخدمة متاحة.',
      'تحقق من حالة الحفظ قبل المغادرة. تبقى المسودات غير المتصلة على هذا الجهاز فقط. إذا وجدت نسخة أحدث على الخادم، قارن النصين ثم احفظ المسودة كمستند جديد أو اختر نسخة الخادم. أكد الاستعادة صراحة. تشير التعليقات إلى نسخة محددة، ولا يعني ظهور المستخدمين تحريراً متزامناً.',
      'جلسة Docs منفصلة عن اتصال المحفظة القياسي. اكتشاف MetaMask وحده لا ينشئ تفويض YNX الخاص. يمكنك إعادة المحاولة عند غياب الجسر أو بعد رفض الطلب. لا يتلقى الذكاء الاصطناعي إلا النسخة المختارة بعد موافقتك، وراجع النتيجة قبل تطبيقها.',
      'المسارات النسبية التالية يستخدمها المحرر ولا تثبت توفر واجهة عامة. يتحقق الخادم من صلاحية الوصول. تتطلب حالة 401 تفويضاً جديداً، وتتطلب تعارضات النسخ المقارنة والاستعادة. أرسل بيانات الاعتماد في ترويسة Authorization، وليس في الروابط أو السجلات.',
      'لم يُضبط تنزيل رسمي للورقة البيضاء بعد. يقدم هذا الدليل 12 لغة مع عرض العربية من اليمين إلى اليسار. المحرر على الويب باللغة الإنجليزية حالياً؛ ترجمة الدليل لا تعني ترجمة جميع الشاشات.'
    ]
  },
  id: {
    name: 'Bahasa Indonesia', title: 'Tulis, tinjau, dan pulihkan',
    headings: ['Mulai di sini', 'Draf dan konflik', 'Pengembang', 'Referensi API', 'Whitepaper dan bahasa'],
    paragraphs: [
      'Anda tidak perlu menghubungkan dompet untuk membaca panduan. Buka editor, tinjau izin Docs di YNX Wallet, lalu buat dokumen. Jangan pernah memasukkan frasa pemulihan atau kunci pribadi. Akses memerlukan otorisasi dan layanan yang tersedia.',
      'Periksa status penyimpanan sebelum pergi. Draf offline hanya tersimpan di perangkat ini. Jika server memiliki versi lebih baru, bandingkan teks lalu simpan draf sebagai dokumen baru atau pilih versi server. Konfirmasikan pemulihan. Komentar merujuk versi tertentu; indikator kehadiran bukan penyuntingan serentak.',
      'Sesi Docs terpisah dari koneksi dompet standar. Mendeteksi MetaMask tidak membuat otorisasi privat YNX. Coba lagi jika penghubung tidak tersedia atau permintaan ditolak. AI hanya menerima versi terpilih setelah persetujuan; tinjau hasil sebelum menerapkannya.',
      'Jalur relatif berikut dipakai editor dan bukan bukti API publik tersedia. Server harus mengizinkan akses. Status 401 memerlukan otorisasi ulang; konflik versi memerlukan perbandingan. Kirim kredensial melalui Authorization, bukan URL atau log.',
      'Unduhan whitepaper resmi belum dikonfigurasi. Panduan ini menyediakan 12 bahasa, termasuk arah kanan ke kiri untuk bahasa Arab. Editor web masih berbahasa Inggris; panduan yang diterjemahkan tidak berarti semua layar sudah diterjemahkan.'
    ]
  }
};
export const guideLocales = ['en', 'zh-Hans', ...Object.keys(guides)];
export function guideLocale(value = '') {
  if (guideLocales.includes(value)) return value;
  if (/^zh-(Hant|TW|HK|MO)/i.test(value)) return 'zh-Hant';
  if (/^zh/i.test(value)) return 'zh-Hans';
  return guideLocales.find((locale) => locale === value.split('-')[0]) || 'en';
}
