const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
let snapshot = { paper: {}, strategies: {}, experiments: {}, audit: [] };
let snapshotRevision = 0;
let statefulPreview = false;
let publicExperiments = {};
let latestResearchMode = null;
let latestResearchResult = null;
let researchSubmitting = false;
let lastToastKey = null;
let lastToastSuffix = '';
const riskWrites = new Set();
const scheduleWrites = new Set(), scheduleUnconfirmed = new Set();
let pendingMandate = null;
let pendingOrder = null;
let previewRevision = 0;
let walletIdentity = "";
let portfolioRevision = 0;
let portfolio = null;
let portfolioStatus = "connectForPortfolio";
const tenantKey = "ynx.quant.tenant.v1";
let workspaceStorageAvailable = true, tenantId = null;
function readPreference(key) { try { return localStorage.getItem(key); } catch { return null; } }
function persistWorkspaceValue(key, value) {
  try { localStorage.setItem(key, value); if (localStorage.getItem(key) !== value) throw new Error('STORAGE_READBACK_MISMATCH'); }
  catch { workspaceStorageAvailable = false; statefulPreview = false; throw new Error(t('workspaceStorageUnavailable')); }
}
try {
  tenantId = localStorage.getItem(tenantKey);
  if (!/^[0-9a-f]{64}$/.test(tenantId || "")) tenantId = [...crypto.getRandomValues(new Uint8Array(32))].map((value) => value.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(tenantKey, tenantId);
  if (localStorage.getItem(tenantKey) !== tenantId) throw new Error('STORAGE_READBACK_MISMATCH');
} catch { tenantId = null; workspaceStorageAvailable = false; }
const paperPendingKey = `ynx.quant.paper.pending.v1:${tenantId}`;
let paperSubmitting = false, pendingPaperIntent = readPendingPaperIntent();
function readPendingPaperIntent() {
  if (!workspaceStorageAvailable) return null;
  try {
    const value = JSON.parse(localStorage.getItem(paperPendingKey) || "null");
    if (value && /^quant-paper-[0-9a-f-]{36}$/.test(value.IdempotencyKey) && /^[0-9a-f]{64}$/.test(value.StrategyHash) && ["buy", "sell"].includes(value.Side) && Number.isSafeInteger(value.Amount) && value.Amount > 0) return value;
  } catch {}
  try { localStorage.removeItem(paperPendingKey); } catch { workspaceStorageAvailable = false; }
  return null;
}
const supportedLocales = QuantI18n.locales;
let locale = readPreference("ynx.quant.locale") || "en";
if (!supportedLocales.includes(locale)) locale = "en";
const businessCopy = {
  en: {
    portfolio: "Portfolio", account: "Account", provider: "Wallet provider", balance: "Native balance", block: "Block", observed: "Observed", source: "Source", paperWorkspace: "This browser's Paper workspace", strategy: "Saved strategy", chooseStrategy: "Choose a saved strategy", strategyMissing: "Run a backtest to save a strategy before submitting a Paper signal.",
    portfolioLead: "YNX Testnet native balance reported by your selected wallet at a specific block. Exchange balances, strategy positions and Paper funds are not included.",
    paperWorkspaceLead: "This browser's Paper workspace is stored by the Quant service. It is independent of the connected wallet; changing wallets does not change or transfer its simulated funds.",
    executionUnavailable: "Testnet execution is unavailable: a Standard Wallet connection does not provide the native YNX mandate signature or a one-time Quant Product Session proof. Preview is read-only; no account authority is inferred.",
    connectForPortfolio: "Connect YNX Wallet or MetaMask to read its Testnet balance. Research and Paper remain available.", readingPortfolio: "Reading the selected wallet at a fixed block…", portfolioUnavailable: "Wallet balance is unavailable. Retry with Refresh; no balance was substituted.", portfolioReady: "Read-only balance from the selected wallet provider. No signature or transaction was requested.",
  },
  "zh-CN": {
    portfolio: "资产组合", account: "账户", provider: "钱包提供方", balance: "原生资产余额", block: "区块", observed: "读取时间", source: "数据来源", paperWorkspace: "此浏览器的模拟盘工作区", strategy: "已保存策略", chooseStrategy: "选择已保存策略", strategyMissing: "请先运行回测并保存策略，再提交模拟信号。",
    portfolioLead: "由所选钱包读取指定区块的 YNX 测试网原生余额；不包含 Exchange 余额、策略持仓或模拟资金。",
    paperWorkspaceLead: "此浏览器的模拟盘工作区保存在 Quant 服务中，与连接的钱包独立；切换钱包不会更改或转移模拟资金。",
    executionUnavailable: "测试网执行暂不可用：标准钱包连接不提供 YNX 原生授权签名或一次性 Quant 产品会话证明。预览只读，不据此授予账户权限。",
    connectForPortfolio: "连接 YNX Wallet 或 MetaMask 以读取测试网余额。研究与模拟盘仍可使用。", readingPortfolio: "正在读取所选钱包指定区块的余额…", portfolioUnavailable: "钱包余额不可用。请点击刷新重试；未使用替代余额。", portfolioReady: "余额只读，来自所选钱包提供方；未请求签名或交易。",
  },
  "zh-TW": {
    portfolio: "資產組合", account: "帳戶", provider: "錢包提供者", balance: "原生資產餘額", block: "區塊", observed: "讀取時間", source: "資料來源", paperWorkspace: "此瀏覽器的模擬交易工作區", strategy: "已儲存策略", chooseStrategy: "選擇已儲存策略", strategyMissing: "請先執行回測並儲存策略，再提交模擬訊號。",
    portfolioLead: "由所選錢包讀取指定區塊的 YNX 測試網原生餘額；不包含 Exchange 餘額、策略部位或模擬資金。",
    paperWorkspaceLead: "此瀏覽器的模擬工作區儲存在 Quant 服務中，與連線錢包獨立；切換錢包不會變更或轉移模擬資金。",
    executionUnavailable: "測試網執行暫不可用：標準錢包連線不提供 YNX 原生授權簽章或一次性 Quant 產品工作階段證明。預覽唯讀，不據此授予帳戶權限。",
    connectForPortfolio: "連線 YNX Wallet 或 MetaMask 以讀取測試網餘額。研究與模擬交易仍可使用。", readingPortfolio: "正在讀取所選錢包指定區塊的餘額…", portfolioUnavailable: "錢包餘額不可用。請重新整理重試；未使用替代餘額。", portfolioReady: "餘額唯讀，來自所選錢包提供者；未要求簽章或交易。",
  },
  ja: {
    portfolio: "ポートフォリオ", account: "アカウント", provider: "ウォレット", balance: "ネイティブ残高", block: "ブロック", observed: "取得日時", source: "データ提供元", paperWorkspace: "このブラウザーのペーパー取引", strategy: "保存済み戦略", chooseStrategy: "保存済み戦略を選択", strategyMissing: "ペーパーシグナルの送信前にバックテストを実行し、戦略を保存してください。",
    portfolioLead: "選択したウォレットが報告する特定ブロックの YNX テストネット残高です。Exchange 残高、戦略ポジション、仮想資金は含みません。",
    paperWorkspaceLead: "このブラウザーのペーパー取引は Quant サービスに保存され、接続ウォレットから独立しています。ウォレットを切り替えても仮想資金は変更・移転されません。",
    executionUnavailable: "テストネット実行は利用できません。標準ウォレットの接続だけでは YNX ネイティブ委任署名や Quant の一回限りのセッション証明は得られません。プレビューは読み取り専用です。",
    connectForPortfolio: "YNX Wallet または MetaMask を接続してテストネット残高を取得してください。研究とペーパー取引は利用できます。", readingPortfolio: "選択したウォレットの固定ブロック残高を取得中…", portfolioUnavailable: "ウォレット残高を取得できません。更新で再試行してください。代替残高は表示しません。", portfolioReady: "選択したウォレットから取得した読み取り専用残高です。署名や取引は要求していません。",
  },
  ko: {
    portfolio: "포트폴리오", account: "계정", provider: "지갑 제공자", balance: "기본 자산 잔액", block: "블록", observed: "조회 시각", source: "출처", paperWorkspace: "이 브라우저의 모의 거래 작업 공간", strategy: "저장된 전략", chooseStrategy: "저장된 전략 선택", strategyMissing: "모의 신호를 제출하기 전에 백테스트를 실행하고 전략을 저장하세요.",
    portfolioLead: "선택한 지갑이 특정 블록에서 조회한 YNX 테스트넷 기본 잔액입니다. Exchange 잔액, 전략 포지션 및 모의 자금은 포함하지 않습니다.",
    paperWorkspaceLead: "이 브라우저의 모의 작업 공간은 Quant 서비스에 저장되며 연결된 지갑과 독립적입니다. 지갑을 바꿔도 모의 자금은 변경되거나 이전되지 않습니다.",
    executionUnavailable: "테스트넷 실행을 사용할 수 없습니다. 표준 지갑 연결은 YNX 기본 위임 서명이나 일회용 Quant 제품 세션 증명을 제공하지 않습니다. 미리보기는 읽기 전용입니다.",
    connectForPortfolio: "테스트넷 잔액을 읽으려면 YNX Wallet 또는 MetaMask를 연결하세요. 연구와 모의 거래는 계속 사용할 수 있습니다.", readingPortfolio: "선택한 지갑의 고정 블록 잔액을 읽는 중…", portfolioUnavailable: "지갑 잔액을 읽을 수 없습니다. 새로 고침으로 재시도하세요. 대체 잔액은 표시하지 않습니다.", portfolioReady: "선택한 지갑에서 읽은 잔액입니다. 서명이나 거래를 요청하지 않았습니다.",
  },
  es: {
    portfolio: "Cartera", account: "Cuenta", provider: "Proveedor de wallet", balance: "Saldo nativo", block: "Bloque", observed: "Consultado", source: "Fuente", paperWorkspace: "Simulación de este navegador", strategy: "Estrategia guardada", chooseStrategy: "Elegir estrategia guardada", strategyMissing: "Ejecuta un backtest para guardar una estrategia antes de enviar una señal simulada.",
    portfolioLead: "Saldo nativo de YNX Testnet que comunica la wallet seleccionada en un bloque concreto. No incluye saldos de Exchange, posiciones de estrategias ni fondos simulados.",
    paperWorkspaceLead: "La simulación de este navegador se guarda en Quant y es independiente de la wallet conectada. Cambiar de wallet no modifica ni transfiere fondos simulados.",
    executionUnavailable: "La ejecución en Testnet no está disponible: conectar una wallet estándar no aporta la firma de mandato nativo YNX ni una prueba de sesión Quant de un solo uso. La vista previa es de solo lectura.",
    connectForPortfolio: "Conecta YNX Wallet o MetaMask para consultar su saldo Testnet. Investigación y simulación siguen disponibles.", readingPortfolio: "Consultando la wallet seleccionada en un bloque fijo…", portfolioUnavailable: "Saldo no disponible. Vuelve a intentar con Actualizar; no se ha sustituido por otro saldo.", portfolioReady: "Saldo de solo lectura de la wallet seleccionada. No se solicitó ninguna firma ni transacción.",
  },
  fr: {
    portfolio: "Portefeuille", account: "Compte", provider: "Fournisseur du wallet", balance: "Solde natif", block: "Bloc", observed: "Consulté le", source: "Source", paperWorkspace: "Simulation de ce navigateur", strategy: "Stratégie enregistrée", chooseStrategy: "Choisir une stratégie enregistrée", strategyMissing: "Exécutez un backtest pour enregistrer une stratégie avant de soumettre un signal simulé.",
    portfolioLead: "Solde natif YNX Testnet fourni par le wallet sélectionné à un bloc précis. Les soldes Exchange, positions des stratégies et fonds simulés sont exclus.",
    paperWorkspaceLead: "La simulation de ce navigateur est enregistrée dans Quant et reste indépendante du wallet connecté. Changer de wallet ne modifie ni ne transfère les fonds simulés.",
    executionUnavailable: "Exécution Testnet indisponible : une connexion wallet standard ne fournit ni signature de mandat natif YNX ni preuve de session Quant à usage unique. L'aperçu est en lecture seule.",
    connectForPortfolio: "Connectez YNX Wallet ou MetaMask pour consulter le solde Testnet. Recherche et simulation restent disponibles.", readingPortfolio: "Lecture du wallet sélectionné à un bloc fixe…", portfolioUnavailable: "Solde indisponible. Réessayez avec Actualiser ; aucun solde de remplacement n'est affiché.", portfolioReady: "Solde en lecture seule du wallet sélectionné. Aucune signature ni transaction demandée.",
  },
  de: {
    portfolio: "Portfolio", account: "Konto", provider: "Wallet-Anbieter", balance: "Natives Guthaben", block: "Block", observed: "Abgerufen", source: "Quelle", paperWorkspace: "Simulation dieses Browsers", strategy: "Gespeicherte Strategie", chooseStrategy: "Gespeicherte Strategie wählen", strategyMissing: "Führe einen Backtest aus und speichere eine Strategie, bevor du ein simuliertes Signal sendest.",
    portfolioLead: "Natives YNX-Testnet-Guthaben der ausgewählten Wallet für einen bestimmten Block. Exchange-Guthaben, Strategiepositionen und simulierte Mittel sind nicht enthalten.",
    paperWorkspaceLead: "Die Simulation dieses Browsers wird im Quant-Dienst gespeichert und ist von der verbundenen Wallet unabhängig. Ein Wallet-Wechsel ändert oder überträgt keine simulierten Mittel.",
    executionUnavailable: "Testnet-Ausführung nicht verfügbar: Eine Standard-Wallet-Verbindung liefert weder die native YNX-Mandatssignatur noch einen einmaligen Quant-Sitzungsnachweis. Die Vorschau ist schreibgeschützt.",
    connectForPortfolio: "Verbinde YNX Wallet oder MetaMask, um das Testnet-Guthaben abzurufen. Forschung und Simulation bleiben verfügbar.", readingPortfolio: "Guthaben der gewählten Wallet an einem festen Block wird gelesen…", portfolioUnavailable: "Wallet-Guthaben nicht verfügbar. Erneut aktualisieren; es wird kein Ersatzguthaben angezeigt.", portfolioReady: "Schreibgeschütztes Guthaben der gewählten Wallet. Keine Signatur oder Transaktion angefordert.",
  },
  pt: {
    portfolio: "Portfólio", account: "Conta", provider: "Provedor da carteira", balance: "Saldo nativo", block: "Bloco", observed: "Consultado", source: "Fonte", paperWorkspace: "Simulação deste navegador", strategy: "Estratégia salva", chooseStrategy: "Selecionar estratégia salva", strategyMissing: "Execute um backtest para salvar uma estratégia antes de enviar um sinal simulado.",
    portfolioLead: "Saldo nativo da YNX Testnet informado pela carteira selecionada em um bloco específico. Não inclui saldos da Exchange, posições de estratégias ou fundos simulados.",
    paperWorkspaceLead: "A simulação deste navegador é salva no serviço Quant e independe da carteira conectada. Trocar de carteira não altera nem transfere fundos simulados.",
    executionUnavailable: "Execução na Testnet indisponível: uma conexão de carteira padrão não fornece a assinatura de mandato nativo YNX nem a prova de sessão Quant de uso único. A prévia é somente leitura.",
    connectForPortfolio: "Conecte YNX Wallet ou MetaMask para consultar o saldo Testnet. Pesquisa e simulação continuam disponíveis.", readingPortfolio: "Consultando a carteira selecionada em um bloco fixo…", portfolioUnavailable: "Saldo indisponível. Tente Atualizar novamente; nenhum saldo foi substituído.", portfolioReady: "Saldo somente leitura da carteira selecionada. Nenhuma assinatura ou transação foi solicitada.",
  },
  ru: {
    portfolio: "Портфель", account: "Аккаунт", provider: "Провайдер кошелька", balance: "Нативный баланс", block: "Блок", observed: "Время чтения", source: "Источник", paperWorkspace: "Симуляция этого браузера", strategy: "Сохранённая стратегия", chooseStrategy: "Выберите сохранённую стратегию", strategyMissing: "Перед отправкой симулированного сигнала запустите бэктест и сохраните стратегию.",
    portfolioLead: "Нативный баланс YNX Testnet от выбранного кошелька на определённом блоке. Балансы Exchange, позиции стратегий и средства симуляции не включены.",
    paperWorkspaceLead: "Рабочая область симуляции этого браузера хранится в Quant независимо от подключённого кошелька. Смена кошелька не меняет и не переводит средства симуляции.",
    executionUnavailable: "Исполнение в Testnet недоступно: стандартное подключение кошелька не даёт нативную подпись мандата YNX или одноразовое доказательство сессии Quant. Предпросмотр доступен только для чтения.",
    connectForPortfolio: "Подключите YNX Wallet или MetaMask для чтения баланса Testnet. Исследования и симуляция остаются доступны.", readingPortfolio: "Чтение выбранного кошелька на фиксированном блоке…", portfolioUnavailable: "Баланс недоступен. Повторите обновление; подставной баланс не отображается.", portfolioReady: "Баланс выбранного кошелька только для чтения. Подпись или транзакция не запрашивались.",
  },
  ar: {
    portfolio: "المحفظة", account: "الحساب", provider: "مزود المحفظة", balance: "الرصيد الأصلي", block: "الكتلة", observed: "وقت القراءة", source: "المصدر", paperWorkspace: "مساحة المحاكاة لهذا المتصفح", strategy: "استراتيجية محفوظة", chooseStrategy: "اختر استراتيجية محفوظة", strategyMissing: "شغّل اختبارًا تاريخيًا لحفظ استراتيجية قبل إرسال إشارة محاكاة.",
    portfolioLead: "رصيد YNX Testnet الأصلي من المحفظة المختارة عند كتلة محددة. لا يشمل أرصدة Exchange أو مراكز الاستراتيجيات أو أموال المحاكاة.",
    paperWorkspaceLead: "تُحفظ مساحة محاكاة هذا المتصفح في خدمة Quant بشكل مستقل عن المحفظة المتصلة. تبديل المحفظة لا يغيّر أموال المحاكاة ولا ينقلها.",
    executionUnavailable: "التنفيذ على Testnet غير متاح: اتصال المحفظة القياسي لا يوفر توقيع تفويض YNX الأصلي أو إثبات جلسة Quant للاستخدام مرة واحدة. المعاينة للقراءة فقط.",
    connectForPortfolio: "اتصل بـ YNX Wallet أو MetaMask لقراءة رصيد Testnet. البحث والمحاكاة متاحان.", readingPortfolio: "قراءة المحفظة المختارة عند كتلة ثابتة…", portfolioUnavailable: "رصيد المحفظة غير متاح. أعد المحاولة بالتحديث؛ لم يُعرض رصيد بديل.", portfolioReady: "رصيد للقراءة فقط من المحفظة المختارة. لم يُطلب توقيع أو معاملة.",
  },
  id: {
    portfolio: "Portofolio", account: "Akun", provider: "Penyedia dompet", balance: "Saldo native", block: "Blok", observed: "Waktu pembacaan", source: "Sumber", paperWorkspace: "Ruang simulasi browser ini", strategy: "Strategi tersimpan", chooseStrategy: "Pilih strategi tersimpan", strategyMissing: "Jalankan backtest untuk menyimpan strategi sebelum mengirim sinyal simulasi.",
    portfolioLead: "Saldo native YNX Testnet dari dompet yang dipilih pada blok tertentu. Tidak termasuk saldo Exchange, posisi strategi, atau dana simulasi.",
    paperWorkspaceLead: "Ruang simulasi browser ini disimpan oleh layanan Quant dan terpisah dari dompet yang terhubung. Mengganti dompet tidak mengubah atau memindahkan dana simulasi.",
    executionUnavailable: "Eksekusi Testnet tidak tersedia: koneksi dompet standar tidak memberikan tanda tangan mandat native YNX atau bukti sesi Quant sekali pakai. Pratinjau hanya dapat dibaca.",
    connectForPortfolio: "Hubungkan YNX Wallet atau MetaMask untuk membaca saldo Testnet. Riset dan simulasi tetap tersedia.", readingPortfolio: "Membaca dompet yang dipilih pada blok tetap…", portfolioUnavailable: "Saldo dompet tidak tersedia. Coba lagi dengan Segarkan; tidak ada saldo pengganti.", portfolioReady: "Saldo baca-saja dari dompet yang dipilih. Tidak ada permintaan tanda tangan atau transaksi.",
  },
};
const paperSafetyCopy = {
  en: ["Enter a positive whole-number Paper amount.", "A previous Paper signal has an unknown outcome. Reload to restore its saved inputs and retry it before starting another signal."],
  "zh-CN": ["请输入正整数模拟数量。", "之前的模拟信号结果尚未确认。请重新加载以恢复已保存参数并重试，再开始新的信号。"],
  "zh-TW": ["請輸入正整數模擬數量。", "先前的模擬訊號結果尚未確認。請重新載入以恢復儲存參數並重試，再開始新的訊號。"],
  ja: ["正の整数でペーパー数量を入力してください。", "前のペーパーシグナルの結果が不明です。再読み込みで保存済み入力を復元し、再試行してから新しいシグナルを開始してください。"],
  ko: ["양의 정수로 모의 수량을 입력하세요.", "이전 모의 신호의 결과가 확인되지 않았습니다. 새로고침하여 저장된 입력을 복원하고 재시도한 후 새 신호를 시작하세요."],
  es: ["Introduce una cantidad simulada entera positiva.", "El resultado de una señal anterior es desconocido. Recarga para restaurar sus datos y reinténtala antes de iniciar otra."],
  fr: ["Saisissez une quantité simulée entière positive.", "Le résultat d'un signal précédent est inconnu. Rechargez pour restaurer ses données et réessayez avant de créer un autre signal."],
  de: ["Gib eine positive ganze simulierte Menge ein.", "Das Ergebnis eines früheren Signals ist unbekannt. Lade neu, stelle die gespeicherten Eingaben wieder her und versuche es erneut, bevor du ein neues Signal startest."],
  pt: ["Insira uma quantidade simulada inteira positiva.", "O resultado de um sinal anterior é desconhecido. Recarregue para restaurar os dados e tente novamente antes de iniciar outro sinal."],
  ru: ["Введите положительное целое количество для симуляции.", "Результат предыдущего сигнала неизвестен. Перезагрузите страницу, восстановите сохранённые параметры и повторите запрос до создания нового сигнала."],
  ar: ["أدخل كمية محاكاة صحيحة موجبة.", "نتيجة إشارة محاكاة سابقة غير مؤكدة. أعد تحميل الصفحة لاستعادة المدخلات المحفوظة وأعد المحاولة قبل بدء إشارة أخرى."],
  id: ["Masukkan jumlah simulasi berupa bilangan bulat positif.", "Hasil sinyal sebelumnya belum diketahui. Muat ulang untuk memulihkan input tersimpan dan coba lagi sebelum memulai sinyal baru."],
};
for (const [language, [paperInvalidAmount, paperPendingMismatch]] of Object.entries(paperSafetyCopy)) Object.assign(businessCopy[language], {paperInvalidAmount, paperPendingMismatch});
const storageCopy = {
  en:'Browser storage is unavailable. Public research remains usable; saved workspace and Paper writes require durable local recovery records.',
  'zh-CN':'浏览器存储不可用。公开研究仍可使用；保存工作区和模拟盘写入需要持久的本地恢复记录。',
  'zh-TW':'瀏覽器儲存不可用。公開研究仍可使用；儲存工作區與模擬盤寫入需要持久的本機復原記錄。',
  ja:'ブラウザー保存を利用できません。公開研究は利用できますが、保存ワークスペースとペーパー書き込みには永続的な復旧記録が必要です。',
  ko:'브라우저 저장소를 사용할 수 없습니다. 공개 연구는 사용 가능하지만 작업 공간 저장과 모의 거래 쓰기에는 지속적인 복구 기록이 필요합니다.',
  es:'Almacenamiento del navegador no disponible. La investigación pública sigue disponible; guardar y operar en Paper requiere registros duraderos de recuperación.',
  fr:'Stockage du navigateur indisponible. La recherche publique reste accessible ; les écritures sauvegardées et Paper exigent des données de reprise persistantes.',
  de:'Browserspeicher nicht verfügbar. Öffentliche Forschung bleibt nutzbar; gespeicherte Arbeitsbereiche und Paper-Schreibzugriffe benötigen dauerhafte Wiederherstellungsdaten.',
  pt:'Armazenamento do navegador indisponível. A pesquisa pública continua disponível; salvar e operar no Paper exige registros persistentes de recuperação.',
  ru:'Хранилище браузера недоступно. Публичные исследования доступны; сохранение и Paper-операции требуют постоянных записей восстановления.',
  ar:'تخزين المتصفح غير متاح. يبقى البحث العام متاحًا؛ تتطلب مساحة العمل المحفوظة وعمليات المحاكاة سجلات استعادة دائمة.',
  id:'Penyimpanan browser tidak tersedia. Riset publik tetap tersedia; ruang tersimpan dan penulisan Paper memerlukan catatan pemulihan persisten.'
};
for (const [language, workspaceStorageUnavailable] of Object.entries(storageCopy)) Object.assign(businessCopy[language], {workspaceStorageUnavailable});
const researchRequestCopy = {
  en:'Backtest request pending. No result is confirmed yet.',
  'zh-CN':'回测请求等待返回，尚未确认结果。',
  'zh-TW':'回測請求等待返回，尚未確認結果。',
  ja:'バックテスト要求の応答待ちです。結果はまだ確認されていません。',
  ko:'백테스트 요청 응답을 기다립니다. 결과는 아직 확인되지 않았습니다.',
  es:'Solicitud de backtest pendiente. Todavía no hay un resultado confirmado.',
  fr:'Demande de backtest en attente. Aucun résultat n’est encore confirmé.',
  de:'Backtest-Anfrage ausstehend. Noch kein Ergebnis bestätigt.',
  pt:'Solicitação de backtest pendente. Nenhum resultado confirmado ainda.',
  ru:'Запрос бэктеста ожидает ответа. Результат ещё не подтверждён.',
  ar:'طلب الاختبار التاريخي قيد الانتظار. لم تُؤكد أي نتيجة بعد.',
  id:'Permintaan backtest menunggu respons. Belum ada hasil terkonfirmasi.'
};
for (const [language, researchRequestPending] of Object.entries(researchRequestCopy)) Object.assign(businessCopy[language], {researchRequestPending});
const researchResultCopy = {
  en: ["Temporary result on this page only — not saved or audited. Reloading the page discards it.", "Experiment saved and audited in this browser's Paper workspace."],
  "zh-CN": ["仅本页临时结果，未保存、未审计；重新加载页面后消失。", "实验已保存并审计于此浏览器的模拟盘工作区。"],
  "zh-TW": ["僅本頁暫存結果，未儲存、未稽核；重新載入頁面後消失。", "實驗已儲存並稽核於此瀏覽器的模擬交易工作區。"],
  ja: ["このページだけの一時結果です。保存・監査はされず、ページの再読み込みで消えます。", "実験はこのブラウザーのペーパー取引領域に保存され、監査記録に追加されました。"],
  ko: ["이 페이지의 임시 결과입니다. 저장되거나 감사 기록에 남지 않으며 페이지를 다시 로드하면 사라집니다.", "실험이 이 브라우저의 모의 거래 작업 공간에 저장되고 감사 기록에 추가되었습니다."],
  es: ["Resultado temporal solo en esta página, sin guardar ni auditar. Se pierde al recargar la página.", "Experimento guardado y auditado en el espacio de simulación de este navegador."],
  fr: ["Résultat temporaire sur cette page uniquement, non enregistré et non audité. Il disparaît au rechargement de la page.", "Expérience enregistrée et auditée dans l'espace de simulation de ce navigateur."],
  de: ["Temporäres Ergebnis nur auf dieser Seite, nicht gespeichert oder protokolliert. Beim Neuladen der Seite geht es verloren.", "Experiment im Simulationsbereich dieses Browsers gespeichert und protokolliert."],
  pt: ["Resultado temporário apenas nesta página, não salvo nem auditado. É perdido ao recarregar a página.", "Experimento salvo e auditado no espaço de simulação deste navegador."],
  ru: ["Временный результат только на этой странице: не сохранён и не внесён в аудит. При перезагрузке страницы исчезнет.", "Эксперимент сохранён и внесён в аудит в рабочей области симуляции этого браузера."],
  ar: ["نتيجة مؤقتة في هذه الصفحة فقط، غير محفوظة وغير مسجلة في سجل التدقيق. تختفي عند إعادة تحميل الصفحة.", "تم حفظ التجربة وتسجيلها في سجل التدقيق ضمن مساحة المحاكاة لهذا المتصفح."],
  id: ["Hasil sementara hanya di halaman ini, tidak disimpan atau diaudit. Hasil hilang saat halaman dimuat ulang.", "Eksperimen disimpan dan diaudit di ruang simulasi browser ini."],
};
for (const [language, [researchTemporary, researchSaved]] of Object.entries(researchResultCopy)) Object.assign(businessCopy[language], {researchTemporary, researchSaved});
const accountPanelCopy = {
  en: ["Wallet & account", "Research is available without signing in", "Standard Wallet", "Browser identity", "Private account", "My existing Quant records"],
  "zh-CN": ["钱包与账户", "无需登录即可进行研究", "标准钱包", "浏览器身份", "私有账户", "我已有的 Quant 记录"],
  "zh-TW": ["錢包與帳戶", "無需登入即可進行研究", "標準錢包", "瀏覽器身分", "私人帳戶", "我現有的 Quant 紀錄"],
  ja: ["ウォレットとアカウント", "ログインせずに研究を利用できます", "標準ウォレット", "ブラウザーの本人確認", "プライベートアカウント", "自分の既存の Quant 記録"],
  ko: ["지갑 및 계정", "로그인하지 않고 연구할 수 있습니다", "표준 지갑", "브라우저 신원", "비공개 계정", "내 기존 Quant 기록"],
  es: ["Wallet y cuenta", "Puedes investigar sin iniciar sesión", "Wallet estándar", "Identidad del navegador", "Cuenta privada", "Mis registros existentes de Quant"],
  fr: ["Wallet et compte", "La recherche est disponible sans connexion", "Wallet standard", "Identité du navigateur", "Compte privé", "Mes données Quant existantes"],
  de: ["Wallet und Konto", "Forschung ist ohne Anmeldung verfügbar", "Standard-Wallet", "Browser-Identität", "Privates Konto", "Meine vorhandenen Quant-Daten"],
  pt: ["Wallet e conta", "A pesquisa está disponível sem iniciar sessão", "Wallet padrão", "Identidade do navegador", "Conta privada", "Meus registros existentes do Quant"],
  ru: ["Кошелёк и аккаунт", "Исследования доступны без входа", "Стандартный кошелёк", "Идентификация в браузере", "Личный аккаунт", "Мои существующие записи Quant"],
  ar: ["المحفظة والحساب", "البحث متاح دون تسجيل الدخول", "المحفظة القياسية", "هوية المتصفح", "الحساب الخاص", "سجلات Quant الحالية الخاصة بي"],
  id: ["Wallet dan akun", "Riset tersedia tanpa masuk", "Wallet standar", "Identitas browser", "Akun pribadi", "Catatan Quant saya yang sudah ada"],
};
for (const [language, [accountPanelTitle, accountPanelHint, standardWalletTitle, browserIdentityTitle, privateAccountTitle, existingRecordsTitle]] of Object.entries(accountPanelCopy)) Object.assign(businessCopy[language], {accountPanelTitle, accountPanelHint, standardWalletTitle, browserIdentityTitle, privateAccountTitle, existingRecordsTitle});
const paperRiskCopy = {
  en: ["Cash (simulated)", "Position (simulated)", "Reconciliation", "Kill switch", "ACTIVE", "Armed", "Activate the persistent paper/testnet kill switch?", "Kill switch active", "Reconciliation completed: zero difference"],
  "zh-CN": ["模拟现金", "模拟持仓", "对账", "熔断开关", "已激活", "待触发", "激活持久保存的模拟盘／测试网熔断开关？", "熔断开关已激活", "对账完成：差异为零"],
  "zh-TW": ["模擬現金", "模擬部位", "對帳", "熔斷開關", "已啟動", "待觸發", "啟動持續保存的模擬交易／測試網熔斷開關？", "熔斷開關已啟動", "對帳完成：差異為零"],
  ja: ["仮想現金", "仮想ポジション", "照合", "キルスイッチ", "作動中", "待機中", "保存されるペーパー取引・テストネットのキルスイッチを作動させますか？", "キルスイッチが作動しました", "照合完了：差異なし"],
  ko: ["모의 현금", "모의 포지션", "조정", "킬 스위치", "활성화됨", "대기 중", "지속 저장되는 모의 거래/테스트넷 킬 스위치를 활성화할까요?", "킬 스위치가 활성화되었습니다", "조정 완료: 차이 없음"],
  es: ["Efectivo simulado", "Posición simulada", "Conciliación", "Interruptor de emergencia", "ACTIVO", "Preparado", "¿Activar el interruptor de emergencia persistente de simulación/Testnet?", "Interruptor de emergencia activo", "Conciliación completada: diferencia cero"],
  fr: ["Liquidités simulées", "Position simulée", "Rapprochement", "Arrêt d'urgence", "ACTIF", "Prêt", "Activer l'arrêt d'urgence persistant de simulation/Testnet ?", "Arrêt d'urgence actif", "Rapprochement terminé : aucun écart"],
  de: ["Simuliertes Guthaben", "Simulierte Position", "Abstimmung", "Kill-Switch", "AKTIV", "Bereit", "Den dauerhaft gespeicherten Kill-Switch für Simulation/Testnet aktivieren?", "Kill-Switch aktiv", "Abstimmung abgeschlossen: keine Differenz"],
  pt: ["Caixa simulado", "Posição simulada", "Reconciliação", "Interruptor de emergência", "ATIVO", "Preparado", "Ativar o interruptor de emergência persistente da simulação/Testnet?", "Interruptor de emergência ativo", "Reconciliação concluída: diferença zero"],
  ru: ["Деньги в симуляции", "Позиция в симуляции", "Сверка", "Аварийный выключатель", "АКТИВЕН", "Готов", "Активировать сохраняемый аварийный выключатель симуляции/тестовой сети?", "Аварийный выключатель активен", "Сверка завершена: расхождений нет"],
  ar: ["النقد المحاكى", "المركز المحاكى", "المطابقة", "مفتاح الإيقاف", "مفعّل", "جاهز", "هل تريد تفعيل مفتاح الإيقاف الدائم للمحاكاة وشبكة الاختبار؟", "مفتاح الإيقاف مفعّل", "اكتملت المطابقة: لا يوجد فرق"],
  id: ["Kas simulasi", "Posisi simulasi", "Rekonsiliasi", "Sakelar penghentian", "AKTIF", "Siap", "Aktifkan sakelar penghentian tersimpan untuk simulasi/Testnet?", "Sakelar penghentian aktif", "Rekonsiliasi selesai: tidak ada selisih"],
};
for (const [language, [paperCash, paperPosition, paperReconciliation, paperKill, riskActive, riskArmed, confirmKill, killActive, reconciled]] of Object.entries(paperRiskCopy)) Object.assign(businessCopy[language], {paperCash, paperPosition, paperReconciliation, paperKill, riskActive, riskArmed, confirmKill, killActive, reconciled});
const riskReceiptCopy = {
  en:['Reconciliation recorded a difference; kill switch is active','Risk operation response is unconfirmed. No successful risk state is claimed.'],
  'zh-CN':['对账存在差额；停止开关已启用','风控操作响应未确认，不声明风控状态成功。'],
  'zh-TW':['對帳存在差額；停止開關已啟用','風控操作回應未確認，不宣稱風控狀態成功。'],
  ja:['照合に差額があります。キルスイッチは有効です','リスク操作の応答は未確認です。成功状態を主張しません。'],
  ko:['대사 차이가 기록되었습니다. 킬 스위치가 활성화되었습니다','위험 작업 응답이 확인되지 않았습니다. 성공 상태로 표시하지 않습니다.'],
  es:['Conciliación con diferencia; interruptor de emergencia activo','Respuesta de riesgo no confirmada. No se afirma un estado correcto.'],
  fr:['Écart de rapprochement enregistré ; arrêt d’urgence actif','Réponse de risque non confirmée. Aucun état réussi n’est affirmé.'],
  de:['Abstimmungsdifferenz erfasst; Kill-Switch aktiv','Risikoantwort unbestätigt. Kein erfolgreicher Zustand wird behauptet.'],
  pt:['Diferença de conciliação registrada; bloqueio de emergência ativo','Resposta de risco não confirmada. Nenhum estado de sucesso é afirmado.'],
  ru:['При сверке обнаружена разница; аварийная остановка активна','Ответ операции риска не подтверждён. Успешное состояние не заявляется.'],
  ar:['سُجل فرق في المطابقة؛ مفتاح الإيقاف نشط','استجابة عملية المخاطر غير مؤكدة. لا يُدّعى نجاح الحالة.'],
  id:['Selisih rekonsiliasi tercatat; kill switch aktif','Respons operasi risiko belum terkonfirmasi. Tidak ada klaim status berhasil.']
};
for(const [language,[reconcileDifference,riskReceiptUnconfirmed]] of Object.entries(riskReceiptCopy)) Object.assign(businessCopy[language],{reconcileDifference,riskReceiptUnconfirmed});
const runDetailsCopy = {
  en: ["Run details and formulas", "Data digest", "Strategy digest", "Fee model (bps)", "Slippage model (bps)", "Latency (bars)", "Volume participation (bps)", "Training split (bars)", "Walk-forward windows", "Random seed", "Formulas reported by the research service for this result."],
  "zh-CN": ["本次运行详情与公式", "数据摘要", "策略摘要", "手续费模型（基点）", "滑点模型（基点）", "延迟（根K线）", "成交量参与率（基点）", "训练分界（根K线）", "滚动验证窗口数", "随机种子", "研究服务为本次结果返回的计算公式。"],
  "zh-TW": ["本次執行詳情與公式", "資料摘要", "策略摘要", "手續費模型（基點）", "滑價模型（基點）", "延遲（根K線）", "成交量參與率（基點）", "訓練分界（根K線）", "滾動驗證窗口數", "隨機種子", "研究服務為本次結果回傳的計算公式。"],
  ja: ["実行詳細と計算式", "データのダイジェスト", "戦略のダイジェスト", "手数料モデル（bps）", "スリッページモデル（bps）", "遅延（足数）", "出来高参加率（bps）", "学習区間の境界（足数）", "ウォークフォワード窓数", "乱数シード", "この結果について研究サービスが返した計算式です。"],
  ko: ["실행 상세 및 공식", "데이터 다이제스트", "전략 다이제스트", "수수료 모델 (bps)", "슬리피지 모델 (bps)", "지연 (봉)", "거래량 참여율 (bps)", "학습 구간 경계 (봉)", "워크포워드 구간 수", "난수 시드", "이 결과에 대해 연구 서비스가 반환한 계산 공식입니다."],
  es: ["Detalles de ejecución y fórmulas", "Resumen de datos", "Resumen de estrategia", "Modelo de comisiones (bps)", "Modelo de deslizamiento (bps)", "Latencia (velas)", "Participación en volumen (bps)", "Límite de entrenamiento (velas)", "Ventanas walk-forward", "Semilla aleatoria", "Fórmulas que devuelve el servicio de investigación para este resultado."],
  fr: ["Détails de l'exécution et formules", "Empreinte des données", "Empreinte de la stratégie", "Modèle de frais (bps)", "Modèle de glissement (bps)", "Latence (bougies)", "Participation au volume (bps)", "Limite d'entraînement (bougies)", "Fenêtres walk-forward", "Graine aléatoire", "Formules renvoyées par le service de recherche pour ce résultat."],
  de: ["Laufdetails und Formeln", "Daten-Prüfsumme", "Strategie-Prüfsumme", "Gebührenmodell (bps)", "Slippage-Modell (bps)", "Latenz (Kerzen)", "Volumenbeteiligung (bps)", "Trainingsgrenze (Kerzen)", "Walk-forward-Fenster", "Zufalls-Seed", "Vom Forschungsdienst für dieses Ergebnis zurückgegebene Formeln."],
  pt: ["Detalhes da execução e fórmulas", "Resumo dos dados", "Resumo da estratégia", "Modelo de taxas (bps)", "Modelo de slippage (bps)", "Latência (velas)", "Participação no volume (bps)", "Limite de treino (velas)", "Janelas walk-forward", "Semente aleatória", "Fórmulas retornadas pelo serviço de pesquisa para este resultado."],
  ru: ["Параметры запуска и формулы", "Хеш данных", "Хеш стратегии", "Модель комиссии (б.п.)", "Модель проскальзывания (б.п.)", "Задержка (свечи)", "Доля участия в объёме (б.п.)", "Граница обучения (свечи)", "Окна walk-forward", "Зерно генератора", "Формулы, возвращённые исследовательским сервисом для этого результата."],
  ar: ["تفاصيل التشغيل والصيغ", "بصمة البيانات", "بصمة الاستراتيجية", "نموذج الرسوم (نقاط أساس)", "نموذج الانزلاق (نقاط أساس)", "زمن التأخير (شموع)", "المشاركة في الحجم (نقاط أساس)", "حد التدريب (شموع)", "نوافذ الاختبار المتقدم", "البذرة العشوائية", "الصيغ التي أعادتها خدمة البحث لهذه النتيجة."],
  id: ["Detail proses dan rumus", "Digest data", "Digest strategi", "Model biaya (bps)", "Model slippage (bps)", "Latensi (candle)", "Partisipasi volume (bps)", "Batas pelatihan (candle)", "Jendela walk-forward", "Seed acak", "Rumus yang dikembalikan layanan riset untuk hasil ini."],
};
for (const [language, [runDetails, runDataHash, runStrategyHash, runFee, runSlippage, runLatency, runParticipation, runTraining, runWindows, runSeed, runFormulaLead]] of Object.entries(runDetailsCopy)) Object.assign(businessCopy[language], {runDetails, runDataHash, runStrategyHash, runFee, runSlippage, runLatency, runParticipation, runTraining, runWindows, runSeed, runFormulaLead});
const runMetricLabels = {
  en:["OOS return","Buy/hold","Maximum drawdown","Sharpe × 1,000","Volatility (bps)"],
  "zh-CN":["样本外收益","买入持有","最大回撤","Sharpe × 1,000","波动率（基点）"],
  "zh-TW":["樣本外報酬","買入持有","最大回撤","Sharpe × 1,000","波動率（基點）"],
  ja:["学習外リターン","買い持ち","最大ドローダウン","Sharpe × 1,000","ボラティリティ（bps）"],
  ko:["표본 외 수익률","매수 후 보유","최대 낙폭","Sharpe × 1,000","변동성 (bps)"],
  es:["Retorno fuera de muestra","Comprar y mantener","Caída máxima","Sharpe × 1,000","Volatilidad (bps)"],
  fr:["Rendement hors échantillon","Achat et conservation","Perte maximale","Sharpe × 1,000","Volatilité (bps)"],
  de:["Rendite außerhalb der Stichprobe","Kaufen und Halten","Maximaler Rückgang","Sharpe × 1,000","Volatilität (bps)"],
  pt:["Retorno fora da amostra","Comprar e manter","Queda máxima","Sharpe × 1,000","Volatilidade (bps)"],
  ru:["Доходность вне обучающей выборки","Купить и держать","Максимальная просадка","Sharpe × 1,000","Волатильность (б.п.)"],
  ar:["العائد خارج العينة","الشراء والاحتفاظ","أقصى تراجع","Sharpe × 1,000","التقلب (نقاط أساس)"],
  id:["Imbal hasil di luar sampel","Beli dan tahan","Drawdown maksimum","Sharpe × 1,000","Volatilitas (bps)"],
};
for (const [language, [runReturn, runBuyHold, runDrawdown, runSharpe, runVolatility]] of Object.entries(runMetricLabels)) Object.assign(businessCopy[language], {runReturn, runBuyHold, runDrawdown, runSharpe, runVolatility});
const runPresentationCopy = {
  en:["Latest research result","Blue: measured strategy equity · Grey: buy/hold benchmark. All costs use the selected model, not promised returns."],
  "zh-CN":["最新研究结果","蓝色：测得的策略权益；灰色：买入持有基准。成本按本次模型计算，收益并无承诺。"],
  "zh-TW":["最新研究結果","藍色：測得的策略權益；灰色：買入持有基準。成本依本次模型計算，報酬並無承諾。"],
  ja:["最新の研究結果","青：計測した戦略の資産額。灰：買い持ちのベンチマーク。費用は実行時のモデルに基づき、リターンを保証しません。"],
  ko:["최신 연구 결과","파란색: 측정된 전략 자산. 회색: 매수 후 보유 기준. 비용은 실행 모델에 따르며 수익을 보장하지 않습니다."],
  es:["Último resultado de investigación","Azul: patrimonio medido de la estrategia. Gris: comprar y mantener. Los costes siguen el modelo de esta ejecución; no se prometen rendimientos."],
  fr:["Dernier résultat de recherche","Bleu : capital mesuré de la stratégie. Gris : achat et conservation. Les coûts suivent le modèle de cette exécution ; aucun rendement n'est promis."],
  de:["Neuestes Forschungsergebnis","Blau: gemessenes Strategieguthaben. Grau: Kaufen und Halten. Kosten folgen dem Modell dieses Laufs; Renditen sind nicht zugesichert."],
  pt:["Último resultado da pesquisa","Azul: patrimônio medido da estratégia. Cinza: comprar e manter. Os custos seguem o modelo desta execução; não há promessa de retorno."],
  ru:["Последний результат исследования","Синий: измеренный капитал стратегии. Серый: купить и держать. Издержки определены моделью этого запуска; доходность не гарантируется."],
  ar:["أحدث نتيجة بحث","الأزرق: قيمة الاستراتيجية المقاسة. الرمادي: معيار الشراء والاحتفاظ. تعتمد التكاليف على نموذج هذا التشغيل، ولا توجد عوائد موعودة."],
  id:["Hasil riset terbaru","Biru: ekuitas strategi terukur. Abu-abu: beli dan tahan. Biaya mengikuti model proses ini; imbal hasil tidak dijanjikan."],
};
for (const [language, [latestResearchTitle, runChartLead]] of Object.entries(runPresentationCopy)) Object.assign(businessCopy[language], {latestResearchTitle, runChartLead});
const paperRecordCopy = {
  en: ["Saved simulated orders", "Service records only. Price, requested quantity and filled quantity are integer micro-units. These are not Exchange orders or chain transfers.", "No recorded simulated orders.", "Records unavailable or unverified", "Order / strategy / time", "Side / status", "Price / requested / filled", "Source"],
  "zh-CN": ["已保存的模拟订单", "仅展示服务记录。价格、委托量和成交量为整数微单位；不是交易所订单或链上转账。", "暂无模拟订单记录。", "记录不可用或未经验证", "订单 / 策略 / 时间", "方向 / 状态", "价格 / 委托量 / 成交量", "来源"],
  "zh-TW": ["已儲存的模擬訂單", "僅顯示服務記錄。價格、委託量和成交量為整數微單位；不是交易所訂單或鏈上轉帳。", "尚無模擬訂單記錄。", "記錄不可用或未經驗證", "訂單 / 策略 / 時間", "方向 / 狀態", "價格 / 委託量 / 成交量", "來源"],
  ja: ["保存済み模擬注文", "サービス記録のみ。価格・注文量・約定量は整数マイクロ単位です。取引所注文や送金ではありません。", "模擬注文の記録はありません。", "記録が利用不可または未検証", "注文 / 戦略 / 時刻", "売買 / 状態", "価格 / 注文量 / 約定量", "提供元"],
  ko: ["저장된 모의 주문", "서비스 기록만 표시합니다. 가격·주문량·체결량은 정수 마이크로 단위이며 거래소 주문이나 온체인 전송이 아닙니다.", "모의 주문 기록이 없습니다.", "기록 사용 불가 또는 미검증", "주문 / 전략 / 시간", "방향 / 상태", "가격 / 주문량 / 체결량", "출처"],
  es: ["Órdenes simuladas guardadas", "Solo registros del servicio. Precio, cantidad solicitada y ejecutada en microunidades enteras; no son órdenes de Exchange ni transferencias.", "No hay órdenes simuladas registradas.", "Registros no disponibles o sin verificar", "Orden / estrategia / fecha", "Lado / estado", "Precio / solicitado / ejecutado", "Fuente"],
  fr: ["Ordres simulés enregistrés", "Registres du service uniquement. Prix, quantité demandée et exécutée en micro-unités entières ; ni ordres Exchange ni transferts blockchain.", "Aucun ordre simulé enregistré.", "Registres indisponibles ou non vérifiés", "Ordre / stratégie / date", "Sens / statut", "Prix / demandé / exécuté", "Source"],
  de: ["Gespeicherte simulierte Orders", "Nur Servicedaten. Preis, angeforderte und ausgeführte Menge in ganzzahligen Mikroeinheiten; keine Exchange-Orders oder Blockchain-Transfers.", "Keine simulierten Orders gespeichert.", "Datensätze nicht verfügbar oder ungeprüft", "Order / Strategie / Zeit", "Seite / Status", "Preis / angefordert / ausgeführt", "Quelle"],
  pt: ["Ordens simuladas guardadas", "Apenas registros do serviço. Preço, quantidade solicitada e executada em microunidades inteiras; não são ordens Exchange nem transferências.", "Nenhuma ordem simulada registrada.", "Registros indisponíveis ou não verificados", "Ordem / estratégia / data", "Lado / estado", "Preço / solicitado / executado", "Fonte"],
  ru: ["Сохранённые симулированные ордера", "Только записи сервиса. Цена, запрошенный и исполненный объём — целые микроединицы; это не биржевые ордера и не переводы.", "Симулированных ордеров нет.", "Записи недоступны или не проверены", "Ордер / стратегия / время", "Сторона / статус", "Цена / запрос / исполнение", "Источник"],
  ar: ["أوامر المحاكاة المحفوظة", "سجلات الخدمة فقط. السعر والكمية المطلوبة والمنفذة بوحدات ميكرو صحيحة؛ ليست أوامر بورصة أو تحويلات سلسلة.", "لا توجد أوامر محاكاة مسجلة.", "السجلات غير متاحة أو غير متحققة", "الأمر / الاستراتيجية / الوقت", "الاتجاه / الحالة", "السعر / المطلوب / المنفذ", "المصدر"],
  id: ["Order simulasi tersimpan", "Hanya catatan layanan. Harga, jumlah diminta dan terisi dalam mikrounit bilangan bulat; bukan order Exchange atau transfer blockchain.", "Belum ada catatan order simulasi.", "Catatan tidak tersedia atau belum terverifikasi", "Order / strategi / waktu", "Sisi / status", "Harga / diminta / terisi", "Sumber"],
};
for (const [language, values] of Object.entries(paperRecordCopy)) Object.assign(businessCopy[language], Object.fromEntries(["paperRecords", "paperRecordsLead", "paperRecordsEmpty", "paperRecordsUnknown", "paperRecordIdentity", "paperRecordStatus", "paperRecordAmounts", "paperRecordSource"].map((key, index) => [key, values[index]])));
const t = (key) => businessCopy[locale]?.[key] ?? businessCopy.en[key] ?? QuantI18n.t(locale, key);
const paperConfirmCopy = {
  en: ["Confirm this saved-strategy Paper signal?", "Simulation only; no Exchange or chain transaction. Amount is in integer micro-units. There is no executable price quote: the service reads the market at submission, limits fills to 10% of source volume and applies position/notional limits. The Paper engine does not deduct commission/gas or model slippage; this is not a cost-inclusive execution forecast.", "The preview changed. Review the current inputs again.", "Simulated order recorded"],
  "zh-CN": ["确认此已保存策略的模拟信号？", "仅模拟，不产生交易所或链上交易。数量为整数微单位。无可执行报价：服务在提交时读取行情，成交量受来源成交量的 10% 和持仓/名义金额限制。模拟引擎不扣佣金或 Gas，也不模拟滑点；不是包含成本的执行预测。", "预览已变化，请重新检查当前输入。", "模拟订单已记录"],
  "zh-TW": ["確認此已儲存策略的模擬訊號？", "僅模擬，不產生交易所或鏈上交易。數量為整數微單位。無可執行報價：服務於提交時讀取行情，成交量受來源成交量的 10% 和持倉/名義金額限制。模擬引擎不扣佣金或 Gas，也不模擬滑點；不是包含成本的執行預測。", "預覽已變更，請重新檢查目前輸入。", "模擬訂單已記錄"],
  ja: ["保存済み戦略のペーパーシグナルを確認しますか？", "シミュレーションのみ。取引所・チェーン注文は送信しません。量は整数マイクロ単位です。執行価格の見積りはなく、送信時の市場データ、出来高の10%、ポジション・想定元本上限を使います。手数料・ガス・スリッページはモデル化せず、費用込みの執行予測ではありません。", "プレビューが変更されました。入力を再確認してください。", "模擬注文を記録しました"],
  ko: ["저장된 전략의 모의 신호를 확인할까요?", "시뮬레이션 전용이며 거래소나 체인 주문을 보내지 않습니다. 수량은 정수 마이크로 단위입니다. 실행 가격 견적 없이 제출 시 시장 데이터, 원천 거래량의 10%, 포지션·명목 한도를 적용합니다. 수수료·가스·슬리피지를 모델링하지 않아 비용 포함 실행 예측이 아닙니다.", "미리보기가 변경되었습니다. 입력을 다시 검토하세요.", "모의 주문이 기록되었습니다"],
  es: ["¿Confirmar la señal simulada de esta estrategia guardada?", "Solo simulación, sin órdenes Exchange ni transacciones. Cantidad en microunidades enteras. Sin cotización ejecutable: el servicio lee el mercado al enviar, limita la ejecución al 10% del volumen fuente y aplica límites de posición y nominal. No descuenta comisión/gas ni modela deslizamiento; no es una previsión con costes.", "La vista previa cambió. Revisa las entradas actuales.", "Orden simulada registrada"],
  fr: ["Confirmer le signal simulé de cette stratégie enregistrée ?", "Simulation uniquement, sans ordre Exchange ni transaction. Quantité en micro-unités entières. Pas de cotation exécutable : marché lu à l’envoi, exécution limitée à 10 % du volume source et aux limites de position et de notionnel. Sans commission/gaz ni modèle de glissement ; ce n’est pas une prévision frais inclus.", "L’aperçu a changé. Vérifiez les entrées actuelles.", "Ordre simulé enregistré"],
  de: ["Paper-Signal dieser gespeicherten Strategie bestätigen?", "Nur Simulation, keine Exchange- oder Blockchain-Transaktion. Menge in ganzzahligen Mikroeinheiten. Kein ausführbarer Kurs: Marktdaten beim Absenden, Füllung auf 10% des Quellvolumens sowie Positions-/Nominalgrenzen beschränkt. Keine Provision/Gas oder Slippage-Modellierung; keine kosteninklusive Ausführungsprognose.", "Vorschau geändert. Aktuelle Eingaben erneut prüfen.", "Simulierte Order gespeichert"],
  pt: ["Confirmar o sinal simulado desta estratégia guardada?", "Apenas simulação, sem ordem Exchange ou transação. Quantidade em microunidades inteiras. Sem cotação executável: mercado lido ao enviar, execução limitada a 10% do volume fonte e aos limites de posição/nominal. Sem comissão/gás nem modelo de slippage; não é previsão com custos.", "A prévia mudou. Revise as entradas atuais.", "Ordem simulada registrada"],
  ru: ["Подтвердить Paper-сигнал сохранённой стратегии?", "Только симуляция, без биржевой или сетевой транзакции. Объём в целых микроединицах. Исполняемой котировки нет: рынок читается при отправке, исполнение ограничено 10% исходного объёма и лимитами позиции/номинала. Комиссия, газ и проскальзывание не моделируются; это не прогноз с учётом затрат.", "Предпросмотр изменился. Проверьте текущие данные.", "Симулированный ордер записан"],
  ar: ["تأكيد إشارة المحاكاة لهذه الاستراتيجية المحفوظة؟", "محاكاة فقط بلا أمر بورصة أو معاملة سلسلة. الكمية بوحدات ميكرو صحيحة. لا عرض سعر قابل للتنفيذ: تُقرأ السوق عند الإرسال وتُحد الكمية المنفذة إلى 10% من حجم المصدر وحدود المركز والقيمة الاسمية. لا تُخصم عمولة أو غاز ولا تُنمذج الانزلاقات؛ ليس توقع تنفيذ شامل التكاليف.", "تغيرت المعاينة. راجع المدخلات الحالية مجددًا.", "تم تسجيل أمر المحاكاة"],
  id: ["Konfirmasi sinyal Paper strategi tersimpan ini?", "Simulasi saja, tanpa order Exchange atau transaksi blockchain. Jumlah dalam mikrounit bilangan bulat. Tanpa kuotasi yang dapat dieksekusi: pasar dibaca saat pengiriman, pengisian dibatasi 10% volume sumber dan batas posisi/nosional. Tanpa komisi/gas atau model slippage; bukan prakiraan termasuk biaya.", "Pratinjau berubah. Tinjau kembali masukan saat ini.", "Order simulasi dicatat"],
};
for (const [language, [paperConfirm, paperExecutionBoundary, paperPreviewChanged, paperRecorded]] of Object.entries(paperConfirmCopy)) Object.assign(businessCopy[language], {paperConfirm, paperExecutionBoundary, paperPreviewChanged, paperRecorded});
const scheduleCopy = {
  en:["Schedules run saved Backtest research on the service, not Paper or Testnet orders. A saved schedule is not a completed run. Refresh to read the actual result and source failures.","Start 60s research","Stop schedule","Schedule request pending","Schedule unverified — refresh to read its actual state","Start persistent 60-second research with these assumptions? No Paper or Testnet order will be placed.","Stop this saved research schedule? This does not cancel Exchange orders or move funds.","Schedule inputs or strategy changed. Review again.","Research schedule saved; execution is not yet proved.","Research schedule stopped by the service.","Not scheduled"],
  "zh-CN":["定时任务在服务端运行已保存的 Backtest 研究，不提交模拟盘或测试网订单。保存任务不等于运行完成；刷新读取实际结果和数据源错误。","启动 60 秒研究","停止定时任务","定时请求处理中","定时状态未验证，请刷新读取实际状态","按这些假设启动持续的 60 秒研究？不会提交模拟盘或测试网订单。","停止此研究定时任务？不会取消交易所订单或移动资金。","定时输入或策略已变化，请重新检查。","研究定时任务已保存，执行尚未证实。","服务已停止研究定时任务。","未设置定时任务"],
  "zh-TW":["定時任務在服務端執行已儲存的 Backtest 研究，不提交模擬盤或測試網訂單。儲存任務不等於執行完成；重新整理讀取實際結果和資料來源錯誤。","啟動 60 秒研究","停止定時任務","定時請求處理中","定時狀態未驗證，請重新整理讀取實際狀態","按這些假設啟動持續的 60 秒研究？不會提交模擬盤或測試網訂單。","停止此研究定時任務？不會取消交易所訂單或移動資金。","定時輸入或策略已變更，請重新檢查。","研究定時任務已儲存，執行尚未證實。","服務已停止研究定時任務。","未設定定時任務"],
  ja:["保存済み Backtest 研究をサービスで定期実行します。Paper・Testnet 注文は送信しません。保存は実行完了ではありません。更新して実結果とデータ障害を確認してください。","60秒研究を開始","スケジュール停止","要求を処理中","未検証です。更新して実状態を確認","この仮定で60秒間隔の研究を開始しますか？Paper・Testnet注文は送信しません。","研究スケジュールを停止しますか？取引所注文の取消や送金は行いません。","入力か戦略が変更されました。再確認してください。","研究スケジュール保存。実行は未確認です。","サービスが研究スケジュールを停止しました。","未設定"],
  ko:["서비스에서 저장된 Backtest 연구를 예약 실행합니다. Paper·Testnet 주문을 보내지 않습니다. 저장은 실행 완료가 아닙니다. 새로고침하여 실제 결과와 데이터 오류를 확인하세요.","60초 연구 시작","예약 중지","예약 요청 처리 중","예약 미검증 — 새로고침하여 실제 상태 확인","이 가정으로 60초 연구를 시작할까요? Paper·Testnet 주문은 전송되지 않습니다.","연구 예약을 중지할까요? 거래소 주문 취소나 자금 이동은 하지 않습니다.","입력 또는 전략이 변경되었습니다. 다시 검토하세요.","연구 예약 저장됨. 실행은 아직 미확인입니다.","서비스가 연구 예약을 중지했습니다.","예약 없음"],
  es:["El servicio programa investigación Backtest guardada, sin órdenes Paper/Testnet. Guardar no prueba ejecución. Actualiza para leer resultados y errores de fuente.","Iniciar estudio cada 60s","Detener programación","Solicitud pendiente","Programación sin verificar — actualiza su estado","¿Iniciar investigación cada 60 segundos con estos supuestos? No enviará órdenes Paper/Testnet.","¿Detener esta investigación? No cancela órdenes Exchange ni mueve fondos.","Cambió la estrategia o la entrada. Revisa de nuevo.","Programación guardada; ejecución no probada.","El servicio detuvo la programación.","Sin programación"],
  fr:["Le service programme la recherche Backtest enregistrée, sans ordre Paper/Testnet. L’enregistrement ne prouve pas l’exécution. Actualisez pour lire les résultats et erreurs de source.","Recherche toutes les 60s","Arrêter la programmation","Demande en attente","Programmation non vérifiée — actualisez son état","Démarrer la recherche toutes les 60 secondes avec ces hypothèses ? Aucun ordre Paper/Testnet.","Arrêter cette recherche ? Aucun ordre Exchange annulé ni fonds déplacés.","Entrées ou stratégie modifiées. Vérifiez à nouveau.","Programmation enregistrée ; exécution non prouvée.","Programmation arrêtée par le service.","Non programmée"],
  de:["Der Dienst plant gespeicherte Backtest-Forschung, keine Paper/Testnet-Orders. Speichern beweist keine Ausführung. Aktualisieren zeigt reale Ergebnisse und Quelldatenfehler.","60s-Forschung starten","Zeitplan stoppen","Zeitplananfrage läuft","Zeitplan ungeprüft — Zustand aktualisieren","Forschung alle 60 Sekunden mit diesen Annahmen starten? Keine Paper/Testnet-Orders.","Forschungszeitplan stoppen? Keine Exchange-Orders storniert oder Gelder bewegt.","Eingaben oder Strategie geändert. Erneut prüfen.","Zeitplan gespeichert; Ausführung noch unbelegt.","Dienst hat den Forschungszeitplan gestoppt.","Nicht geplant"],
  pt:["O serviço agenda pesquisa Backtest guardada, sem ordens Paper/Testnet. Guardar não prova execução. Atualize para ler resultados e erros da fonte.","Iniciar pesquisa a cada 60s","Parar agenda","Solicitação pendente","Agenda não verificada — atualize o estado","Iniciar pesquisa a cada 60 segundos com estas hipóteses? Sem ordens Paper/Testnet.","Parar esta pesquisa? Não cancela ordens Exchange nem move fundos.","Entradas ou estratégia mudaram. Revise novamente.","Agenda guardada; execução não comprovada.","O serviço parou a agenda de pesquisa.","Sem agenda"],
  ru:["Сервис планирует сохранённые Backtest-исследования, без Paper/Testnet-ордеров. Сохранение не доказывает запуск. Обновите реальные результаты и ошибки источника.","Исследование каждые 60с","Остановить расписание","Запрос в ожидании","Расписание не проверено — обновите состояние","Начать исследование каждые 60 секунд с этими допущениями? Без Paper/Testnet-ордеров.","Остановить исследование? Биржевые ордера не отменяются, средства не перемещаются.","Входные данные или стратегия изменились. Проверьте снова.","Расписание сохранено; исполнение не доказано.","Сервис остановил расписание исследования.","Не запланировано"],
  ar:["يشغّل جدول الخدمة أبحاث Backtest المحفوظة وليس أوامر Paper أو Testnet. الحفظ لا يثبت اكتمال التشغيل. حدّث لقراءة النتائج الفعلية وأخطاء المصدر.","بدء البحث كل 60 ثانية","إيقاف الجدول","طلب الجدول قيد الانتظار","الجدول غير متحقق — حدّث لقراءة حالته","بدء بحث مستمر كل 60 ثانية بهذه الافتراضات؟ لن تُرسل أوامر Paper أو Testnet.","إيقاف جدول البحث؟ لن يلغي أوامر البورصة أو ينقل الأموال.","تغيرت المدخلات أو الاستراتيجية. راجع مجددًا.","حُفظ جدول البحث؛ التنفيذ غير مثبت بعد.","أوقفت الخدمة جدول البحث.","غير مجدول"],
  id:["Layanan menjadwalkan riset Backtest tersimpan, bukan order Paper/Testnet. Tersimpan bukan bukti selesai. Muat ulang untuk hasil nyata dan kegagalan sumber.","Mulai riset setiap 60d","Hentikan jadwal","Permintaan jadwal tertunda","Jadwal belum terverifikasi — muat ulang status","Mulai riset setiap 60 detik dengan asumsi ini? Tidak mengirim order Paper/Testnet.","Hentikan jadwal riset? Tidak membatalkan order Exchange atau memindahkan dana.","Masukan atau strategi berubah. Tinjau lagi.","Jadwal tersimpan; eksekusi belum terbukti.","Layanan menghentikan jadwal riset.","Tidak dijadwalkan"],
};
for (const [language, values] of Object.entries(scheduleCopy)) Object.assign(businessCopy[language], Object.fromEntries(["scheduleLead","scheduleStart","scheduleStop","schedulePending","scheduleUnknown","scheduleConfirmStart","scheduleConfirmStop","scheduleInvalid","scheduleConfigured","scheduleStopped","scheduleInactive"].map((key,index)=>[key,values[index]])));
for (const [language,scheduleObservation] of Object.entries({en:"Next / last run / experiment","zh-CN":"下次 / 上次运行 / 实验","zh-TW":"下次 / 上次執行 / 實驗",ja:"次回 / 最終実行 / 実験",ko:"다음 / 마지막 실행 / 실험",es:"Próxima / última ejecución / experimento",fr:"Prochaine / dernière exécution / expérience",de:"Nächster / letzter Lauf / Experiment",pt:"Próxima / última execução / experimento",ru:"Следующий / последний запуск / эксперимент",ar:"التالي / آخر تشغيل / التجربة",id:"Berikutnya / terakhir / eksperimen"})) Object.assign(businessCopy[language],{scheduleObservation});
function observedSchedule(strategy) {
  const runtime = strategy?.Runtime;
  if (!runtime || typeof runtime.enabled !== "boolean" || typeof runtime.running !== "boolean" || !Number.isSafeInteger(runtime.intervalSeconds) || runtime.intervalSeconds < 0) return null;
  if (runtime.enabled && (runtime.intervalSeconds < 60 || runtime.intervalSeconds > 86400 || typeof runtime.lastRunStatus !== "string" || !runtime.lastRunStatus || typeof runtime.nextRunAt !== "string" || !Number.isFinite(Date.parse(runtime.nextRunAt)) || runtime.nextRunAt.startsWith("0001-"))) return null;
  if (!runtime.enabled && runtime.running) return null;
  return runtime;
}
function scheduleTime(value) { return typeof value === "string" && !value.startsWith("0001-") && Number.isFinite(Date.parse(value)) ? localDate(value) : "—"; }

function verifiedPaperRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  if (typeof record.ID !== "string" || !/^paper-[0-9]+$/.test(record.ID) || typeof record.StrategyHash !== "string" || !/^[a-f0-9]{64}$/.test(record.StrategyHash)) return false;
  if (!["buy", "sell"].includes(record.Side) || !Number.isSafeInteger(record.Price) || record.Price <= 0 || !Number.isSafeInteger(record.Amount) || record.Amount <= 0 || !Number.isSafeInteger(record.Filled) || record.Filled < 0 || record.Filled > record.Amount) return false;
  if (record.Source !== "authoritative_market_adapter" || typeof record.CreatedAt !== "string" || !Number.isFinite(Date.parse(record.CreatedAt))) return false;
  return record.Status === "open" && record.Filled === 0 || record.Status === "partially_filled" && record.Filled > 0 && record.Filled < record.Amount || record.Status === "filled" && record.Filled === record.Amount;
}
function renderPaperRecords(paper) {
  const records = paper.Orders;
  const ids = new Set();
  const duplicates = new Set();
  if (Array.isArray(records)) for (const record of records) {
    if (ids.has(record?.ID)) duplicates.add(record?.ID);
    ids.add(record?.ID);
  }
  const valid = record => verifiedPaperRecord(record) && !duplicates.has(record.ID);
  const verified = Array.isArray(records) && records.length <= 100 && records.every(valid);
  $("#paper-record-status").textContent = !verified ? t("paperRecordsUnknown") : records.length === 0 ? t("paperRecordsEmpty") : "";
  const value = input => safe(typeof input === "string" || Number.isSafeInteger(input) ? String(input) : "—");
  $("#paper-record-rows").innerHTML = Array.isArray(records) ? records.map(record => {
    const row = record && typeof record === "object" ? record : {};
    return `<tr><td>${value(row.ID)}<small>${value(row.StrategyHash)}</small><small>${value(row.CreatedAt)}</small></td><td>${value(row.Side)} / ${value(row.Status)}${!valid(row) ? `<small class="danger">${safe(t("paperRecordsUnknown"))}</small>` : ""}</td><td>${value(row.Price)} / ${value(row.Amount)} / ${value(row.Filled)}</td><td>${value(row.Source)}</td></tr>`;
  }).join("") : "";
}
const localDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(locale, {dateStyle:"medium",timeStyle:"medium"}).format(new Date(value)) : "—";
const researchResultStatus = document.createElement("p");
researchResultStatus.id = "research-result-status";
researchResultStatus.role = "status";
$("#latest-result").append(researchResultStatus);
function renderResearchStatus() {
  researchResultStatus.textContent = latestResearchMode === null ? "" : t(latestResearchMode ? "researchSaved" : "researchTemporary");
}
function applyLocale() {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  $("#locale").value = locale;
  $$('[data-i18n]').forEach((element) => { element.textContent = t(element.dataset.i18n); });
  $$('[data-business-i18n]').forEach((element) => { element.textContent = t(element.dataset.businessI18n); });
  const active = $('nav button.active'); if (active) $('#view-title').textContent = active.textContent;
  renderPortfolio();
  renderResearchStatus();
  renderRunDetails();
  renderResearchRequestState();
  $('#workspace-storage-boundary').hidden = workspaceStorageAvailable;
  $('#workspace-storage-boundary').textContent = t('workspaceStorageUnavailable');
  renderRiskControls();
  if (lastToastKey) $("#toast").textContent = t(lastToastKey) + lastToastSuffix;
}
const api = async (path, opt = {}) => {
  const r = await fetch("/api" + path, {
    ...opt,
    headers: {
      "content-type": "application/json",
      ...(tenantId && workspaceStorageAvailable ? {"x-ynx-preview-mode": "local-paper", "x-ynx-tenant-id": tenantId} : {}),
      ...(opt.headers || {}),
    },
  });
  const b = await r.json();
  if (!r.ok) throw Object.assign(new Error(b.error || `HTTP ${r.status}`), {status: r.status});
  return b;
};
const toast = (m, key = null, suffix = '') => {
  lastToastKey = key;
  lastToastSuffix = suffix;
  const e = $("#toast");
  e.textContent = m;
  e.classList.add("show");
  setTimeout(() => e.classList.remove("show"), 3000);
};
async function refresh() {
  const revision = ++snapshotRevision;
  const next = await api("/v1/snapshot");
  if (revision !== snapshotRevision) return;
  snapshot = next;
  statefulPreview = workspaceStorageAvailable && snapshot.access?.statefulPreview === true;
  for (const id of scheduleUnconfirmed) if (Object.values(snapshot.strategies || {}).some(strategy => strategy.ID === id && observedSchedule(strategy))) scheduleUnconfirmed.delete(id);
  $("#workspace-boundary").hidden = statefulPreview;
  renderRiskControls();
  render();
}
function currentWalletIdentity(state) {
  if (state?.status !== "connected" || !/^0x[0-9a-f]{40}$/i.test(state.account || "") || state.chainId !== "0x1917" || !["metamask", "ynx-wallet"].includes(state.providerKind)) return "";
  return `${state.providerKind}:${state.account.toLowerCase()}:${state.chainId}`;
}
function clearSigningPreviews() {
  previewRevision++;
  pendingMandate = null;
  pendingOrder = null;
  for (const id of ["mandate-payload", "order-payload"]) {
    $("#" + id).hidden = true;
    $("#" + id).textContent = "";
  }
  for (const id of ["mandate-signature", "order-signature"]) $("#" + id).value = "";
}
function handleWalletState(state) {
  const identity = currentWalletIdentity(state);
  if (identity === walletIdentity) return;
  walletIdentity = identity;
  portfolioRevision++;
  portfolio = null;
  portfolioStatus = identity ? "readingPortfolio" : "connectForPortfolio";
  clearSigningPreviews();
  $("#mandate-account").value = "";
  $("#order-mandate").value = "";
  renderPortfolio();
  if (identity) void refreshPortfolio();
}
function balanceTokens(baseUnits) {
  const amount = BigInt(baseUnits), scale = 10n ** 18n;
  const whole = new Intl.NumberFormat(locale).format(amount / scale);
  const fraction = (amount % scale).toString().padStart(18, "0").replace(/0+$/, "");
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.1).find(part => part.type === "decimal")?.value || ".";
  return `${whole}${fraction ? decimal + fraction : ""} YNXT`;
}
function renderPortfolio() {
  $("#wallet-portfolio-status").textContent = t(portfolioStatus);
  $("#wallet-portfolio-refresh").disabled = !walletIdentity;
  $("#wallet-portfolio-account").textContent = portfolio?.account || "—";
  $("#wallet-portfolio-provider").textContent = portfolio ? (portfolio.providerKind === "metamask" ? "MetaMask" : "YNX Wallet") : "—";
  $("#wallet-portfolio-balance").textContent = portfolio ? balanceTokens(portfolio.balanceBaseUnits) : "—";
  $("#wallet-portfolio-block").textContent = portfolio?.blockNumber || "—";
  $("#wallet-portfolio-observed").textContent = portfolio ? localDate(portfolio.asOf) : "—";
  $("#wallet-portfolio-source").textContent = portfolio ? `${portfolio.source} · YNX Testnet · ${portfolio.chainId}` : "—";
}
async function refreshPortfolio() {
  const identity = walletIdentity, revision = ++portfolioRevision;
  portfolio = null;
  portfolioStatus = identity ? "readingPortfolio" : "connectForPortfolio";
  renderPortfolio();
  if (!identity) return;
  try {
    const result = await window.YNXQuantWallet.readPortfolio();
    if (revision !== portfolioRevision || identity !== walletIdentity) return;
    if (currentWalletIdentity({ ...result, status: "connected" }) !== identity || result?.asset !== "YNXT" || result?.decimals !== 18 || result?.source !== "selected-wallet-provider" || typeof result?.balanceBaseUnits !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(result.balanceBaseUnits) || typeof result?.blockNumber !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(result.blockNumber) || typeof result?.asOf !== "string" || !Number.isFinite(Date.parse(result.asOf))) throw new Error("Invalid wallet balance receipt");
    portfolio = result;
    portfolioStatus = "portfolioReady";
  } catch {
    if (revision !== portfolioRevision || identity !== walletIdentity) return;
    portfolioStatus = "portfolioUnavailable";
  }
  renderPortfolio();
}
function reusableResearchStrategy(strategy) {
  return typeof strategy?.ID === "string" && !!strategy.ID && strategy.Family === "transparent" && typeof strategy.Name === "string" && !!strategy.Name.trim() && strategy.Name.length <= 80 && /^[a-f0-9]{64}$/.test(strategy.StrategyHash || "") && Number.isSafeInteger(strategy.Seed) && Number.isSafeInteger(strategy.Params?.fast) && strategy.Params.fast >= 2 && Number.isSafeInteger(strategy.Params?.slow) && strategy.Params.slow >= 3 && Object.keys(strategy.Params).sort().join(",") === "fast,slow";
}
function researchSelectionKey(strategy) { return encodeURIComponent(strategy.ID) + ":" + strategy.StrategyHash; }
function renderResearchChoices(strategies) {
  const selection = $("#research-saved-strategy"), previous = selection.value;
  const candidates = strategies.filter(reusableResearchStrategy);
  const available = candidates.filter(strategy => candidates.filter(other => researchSelectionKey(other) === researchSelectionKey(strategy)).length === 1);
  selection.replaceChildren();
  const placeholder = document.createElement("option");placeholder.value = "";placeholder.textContent = t("chooseStrategy");selection.append(placeholder);
  for (const strategy of available) {
    const option = document.createElement("option");option.value = researchSelectionKey(strategy);option.textContent = `${strategy.Name} · ${strategy.StrategyHash.slice(0,12)}…`;selection.append(option);
  }
  selection.value = available.some(strategy => researchSelectionKey(strategy) === previous) ? previous : "";
  selection.disabled = researchSubmitting || available.length === 0;
  $("#research-reuse").disabled = researchSubmitting || !selection.value;
}
function renderPaperStrategies(strategies) {
  const selection = $("#paper-strategy"), previous = selection.value;
  const available = strategies.filter(strategy => /^[0-9a-f]{64}$/.test(strategy.StrategyHash || ""));
  selection.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = t("chooseStrategy");
  selection.append(placeholder);
  for (const strategy of available) {
    const option = document.createElement("option");
    option.value = strategy.StrategyHash;
    option.textContent = `${strategy.Name} · ${strategy.StrategyHash.slice(0, 12)}…`;
    selection.append(option);
  }
  const preferred = previous || pendingPaperIntent?.StrategyHash || "";
  selection.value = available.some(strategy => strategy.StrategyHash === preferred) ? preferred : "";
  selection.disabled = available.length === 0;
  $("#paper-submit").disabled = !statefulPreview || paperSubmitting || !selection.value;
  if (pendingPaperIntent && !previous) {
    $("#side").value = pendingPaperIntent.Side;
    $("#paper-amount").value = String(pendingPaperIntent.Amount);
  }
  $("#paper-strategy-status").textContent = available.length ? "" : t("strategyMissing");
}
function researchAmount(attribution, key) {
  const value = attribution?.[key];
  // The existing research engine returns integer test micro-units. Missing,
  // incompatible or imprecisely decoded amounts cannot stand in for zero.
  return attribution?.currency === "YUSD_TEST_MICRO" && Number.isSafeInteger(value)
    ? `${value} YUSD_TEST_MICRO` : "—";
}
function render() {
  const strategies = Object.values(snapshot.strategies || {}),
    experiments = [
      ...Object.values(snapshot.experiments || {}).map(experiment => ({experiment, temporary: false})),
      ...Object.values(publicExperiments).map(experiment => ({experiment, temporary: true})),
    ];
  $("#strategy-rows").innerHTML = strategies.length
    ? strategies
        .map(
          (s) => {
            const runtime = observedSchedule(s), enabled = runtime?.enabled === true, pending = scheduleWrites.has(s.ID), unknown = !runtime || scheduleUnconfirmed.has(s.ID);
            const usable = typeof s.ID === "string" && s.ID.length > 0 && typeof s.StrategyHash === "string" && /^[a-f0-9]{64}$/.test(s.StrategyHash) && (enabled || s.Stage === "Backtest");
            return `<tr><td>${safe(s.Name)}</td><td>${safe(s.Family)}</td><td>${safe(s.Stage || "Draft")}</td><td><code>${safe((s.StrategyHash || "").slice(0, 12))}…</code></td><td>${safe(s.License)}</td><td><strong>${safe(pending ? t("schedulePending") : unknown ? t("scheduleUnknown") : runtime.lastRunStatus || t("scheduleInactive"))}</strong><small>${safe(t("scheduleObservation"))}</small><small>${runtime ? safe(scheduleTime(runtime.nextRunAt)) + " / " + safe(scheduleTime(runtime.lastRunAt)) : "— / —"}</small><small>${safe(runtime?.lastExperiment || "—")}</small><button type="button" class="schedule-toggle" data-strategy-id="${encodeURIComponent(typeof s.ID === "string" ? s.ID : "")}" data-strategy-hash="${/^[a-f0-9]{64}$/.test(s.StrategyHash || "") ? s.StrategyHash : ""}" data-enabled="${!enabled}" aria-busy="${pending}" ${statefulPreview && usable && !unknown && !pending ? "" : "disabled"}>${safe(enabled ? t("scheduleStop") : t("scheduleStart"))}</button></td></tr>`;
          },
        )
        .join("")
    : `<tr><td colspan="6">${safe(t("emptyStrategy"))}</td></tr>`;
  $("#experiment-rows").innerHTML = experiments.length
    ? experiments
        .map(
          ({experiment: e, temporary}) => {
            // Saved readback must meet the same metric boundary as a new run.
            // Keep the bad row visible, but never display invented completion
            // or interpolate untrusted metric strings as HTML.
            if (!verifiedResearchResult(e)) return `<tr><td colspan="16">${safe(t("researchInvalid"))}</td></tr>`;
            return `<tr><td>${localDate(e.createdAt)}</td><td>${safe(e.strategy.Name)}${temporary ? `<small>${safe(t("researchTemporary"))}</small>` : ""}</td><td>${e.metrics.ReturnBPS} bps</td><td>${e.metrics.BuyHoldBPS} bps</td><td>${e.metrics.MaxDrawdownBPS} bps</td><td>${(e.metrics.SharpeMilli / 1000).toFixed(3)}</td><td>${e.metrics.VolatilityBPS} bps</td><td>${e.metrics.Trades}</td><td>${e.metrics.PartialFills}</td><td>${Number.isSafeInteger(e.sensitivitySpreadBPS) && e.sensitivitySpreadBPS >= 0 ? e.sensitivitySpreadBPS + " bps" : "—"}</td><td>${e.metrics.DataGaps}</td>${["userNetPnl", "userRealizedPnl", "userUnrealizedPnl", "tradingFee", "slippage"].map(key => `<td>${researchAmount(e.attribution, key)}</td>`).join("")}</tr>`;
          },
        )
        .join("")
    : `<tr><td colspan="16">${safe(t("emptyExperiment"))}</td></tr>`;
  const p = snapshot.paper || {};
  renderResearchChoices(strategies);
  renderPaperRecords(p);
  renderPaperStrategies(strategies);
  $("#paper-state").innerHTML =
    `<h3>${safe(t("paperWorkspace"))}</h3><dl><div><dt>${safe(t("paperCash"))}</dt><dd>${p.Cash ?? "—"}</dd></div><div><dt>${safe(t("paperPosition"))}</dt><dd>${p.Position ?? "—"}</dd></div><div><dt>${safe(t("paperReconciliation"))}</dt><dd>${p.ReconciliationDelta ?? "—"}</dd></div><div><dt>${safe(t("paperKill"))}</dt><dd class="${p.KillSwitch ? "danger" : ""}">${p.KillSwitch === true ? safe(t("riskActive")) : p.KillSwitch === false ? safe(t("riskArmed")) : "—"}</dd></div></dl>`;
  $("#audit-rows").innerHTML =
    (snapshot.audit || [])
      .slice()
      .reverse()
      .map(
        (a) =>
          `<li><time>${localDate(a.CreatedAt)}</time><strong>${safe(a.Action)} · ${safe(a.ObjectID)}</strong><code>${safe(a.Hash.slice(0, 16))}…</code></li>`,
      )
      .join("") || "<li>No audited actions yet.</li>";
  if (!$("#mandate-strategy").value && strategies.length) {
    $("#mandate-strategy").value = strategies[0].StrategyHash || "";
  }
  const executions = Object.values(snapshot.testnetOrders || {});
  $("#testnet-execution-rows").innerHTML = executions.length ? executions.map(order => `<tr><td><code>${safe(order.venueOrderId || "Pending")}</code></td><td>${safe(order.market)}</td><td>${safe(order.side)}</td><td>${safe(order.amount)}</td><td>${safe(order.venueStatus || "Outcome pending")}</td><td><code>${safe(order.authorizationDigest || "—")}</code></td></tr>`).join("") : '<tr><td colspan="6">No Wallet-authorized Testnet execution yet.</td></tr>';
}
$("#strategy-rows").addEventListener("click", async event => {
  const button = event.target.closest(".schedule-toggle");
  if (!button || !statefulPreview || button.disabled) return;
  const id = decodeURIComponent(button.dataset.strategyId);
  if (scheduleWrites.has(id) || scheduleUnconfirmed.has(id)) return;
  const enabled = button.dataset.enabled === "true";
  const strategy = Object.values(snapshot.strategies || {}).find(value => value.ID === id), runtime = observedSchedule(strategy);
  if (!runtime || strategy.StrategyHash !== button.dataset.strategyHash || runtime.enabled === enabled || enabled && strategy.Stage !== "Backtest") return;
  let sent = false;
  try {
    const assumptions = enabled ? {feeBPS:+$("#fee").value, slippageBPS:+$("#slippage").value, latencyBars:1, participationBPS:1000, seed:+$("#seed").value, trainEnd:24, walkForwardWindows:3} : {};
    if (enabled && (!Number.isSafeInteger(assumptions.feeBPS) || assumptions.feeBPS < 0 || !Number.isSafeInteger(assumptions.slippageBPS) || assumptions.slippageBPS < 0 || !Number.isSafeInteger(assumptions.seed))) throw Error(t("scheduleInvalid"));
    if (!confirm(`${t(enabled ? "scheduleConfirmStart" : "scheduleConfirmStop")}\n${id}\n${strategy.StrategyHash}${enabled ? `\n${t("runFee")}: ${assumptions.feeBPS}\n${t("runSlippage")}: ${assumptions.slippageBPS}\n${t("runSeed")}: ${assumptions.seed}` : ""}`)) return;
    const current = Object.values(snapshot.strategies || {}).find(value => value.ID === id);
    if (!statefulPreview || current?.StrategyHash !== strategy.StrategyHash || observedSchedule(current)?.enabled !== runtime.enabled || enabled && (current.Stage !== "Backtest" || +$("#fee").value !== assumptions.feeBPS || +$("#slippage").value !== assumptions.slippageBPS || +$("#seed").value !== assumptions.seed)) throw Error(t("scheduleInvalid"));
    scheduleWrites.add(id); snapshotRevision++; render(); sent = true;
    const receipt = await api(`/v1/strategies/${encodeURIComponent(id)}/schedule`, {method: "PUT", body: JSON.stringify({enabled, intervalSeconds: enabled ? 60 : 0, assumptions})});
    const confirmed = observedSchedule(receipt);
    if (receipt?.ID !== id || receipt.StrategyHash !== strategy.StrategyHash || receipt.Stage !== strategy.Stage || !confirmed || confirmed.enabled !== enabled || confirmed.running || confirmed.lastRunStatus !== (enabled ? "scheduled" : "stopped_by_user") || enabled && (confirmed.intervalSeconds !== 60 || Object.entries(assumptions).some(([key,value]) => confirmed.assumptions?.[key[0].toUpperCase()+key.slice(1)] !== value))) throw Error(t("scheduleUnknown"));
    const savedKey = Object.keys(snapshot.strategies).find(key => snapshot.strategies[key].ID === id && snapshot.strategies[key].StrategyHash === strategy.StrategyHash);
    if (!savedKey) throw Error(t("scheduleUnknown"));
    snapshotRevision++;
    snapshot.strategies = {...snapshot.strategies, [savedKey]:receipt};
    render();toast(t(enabled ? "scheduleConfigured" : "scheduleStopped"), enabled ? "scheduleConfigured" : "scheduleStopped");
    await refresh();
  } catch (error) { if (sent) { snapshotRevision++; scheduleUnconfirmed.add(id); } toast(error.message); }
  finally { scheduleWrites.delete(id); render(); }
});
function renderRunDetails() {
  const result = latestResearchResult, strategy = result?.strategy;
  $("#research-source").textContent = typeof strategy?.Source === "string" && strategy.Source.trim() ? strategy.Source : "—";
  for (const [id, key] of [["data", "DataHash"], ["strategy", "StrategyHash"]]) $("#research-" + id + "-hash").textContent = /^[0-9a-f]{64}$/i.test(strategy?.[key] || "") ? strategy[key] : "—";
  for (const [id, key] of [["fee", "FeeBPS"], ["slippage", "SlippageBPS"], ["latency", "LatencyBars"], ["participation", "ParticipationBPS"], ["training", "TrainEnd"], ["windows", "WalkForwardWindows"], ["seed", "Seed"]]) $("#research-" + id).textContent = Number.isSafeInteger(result?.assumptions?.[key]) ? String(result.assumptions[key]) : "—";
  const definitions = $("#research-metric-definitions");
  definitions.replaceChildren();
  for (const [key, label] of [["returnBPS", "runReturn"], ["buyHoldBPS", "runBuyHold"], ["maxDrawdownBPS", "runDrawdown"], ["sharpeMilli", "runSharpe"], ["volatilityBPS", "runVolatility"]]) {
    const row = document.createElement("div"), term = document.createElement("dt"), description = document.createElement("dd");
    term.textContent = t(label);
    description.textContent = typeof result?.metricDefinitions?.[key] === "string" && result.metricDefinitions[key].trim() ? result.metricDefinitions[key] : "—";
    row.append(term, description); definitions.append(row);
  }
}
const researchInvalidCopy = {
  en:"Research result is unconfirmed. No completed result was recorded in this view.",
  "zh-CN":"研究结果尚未确认，本页面未记录新的已完成结果。",
  "zh-TW":"研究結果尚未確認，本頁面未記錄新的已完成結果。",
  ja:"研究結果は未確認です。この画面に新しい完了結果は記録されていません。",
  ko:"연구 결과가 확인되지 않았습니다. 이 화면에 새 완료 결과가 기록되지 않았습니다.",
  es:"Resultado no confirmado. Esta vista no registró un nuevo resultado completado.",
  fr:"Résultat non confirmé. Aucun nouveau résultat terminé n’a été enregistré dans cette vue.",
  de:"Forschungsergebnis unbestätigt. In dieser Ansicht wurde kein neues abgeschlossenes Ergebnis erfasst.",
  pt:"Resultado não confirmado. Nenhum novo resultado concluído foi registrado nesta visualização.",
  ru:"Результат исследования не подтверждён. В этом представлении новый завершённый результат не записан.",
  ar:"نتيجة البحث غير مؤكدة. لم تُسجَّل نتيجة مكتملة جديدة في هذه الصفحة.",
  id:"Hasil riset belum terkonfirmasi. Tidak ada hasil selesai baru yang dicatat dalam tampilan ini."
};
for (const [language, researchInvalid] of Object.entries(researchInvalidCopy)) Object.assign(businessCopy[language], {researchInvalid});
const reuseResearchCopy = {
  en:["Saved research parameters","Use in research draft","Parameters copied to the draft. No run or order started; review fees and slippage before running."],
  "zh-CN":["已保存的研究参数","用于研究草稿","参数已填入草稿，未运行或下单；运行前请检查费用和滑点。"],
  "zh-TW":["已儲存的研究參數","用於研究草稿","參數已填入草稿，未執行或下單；執行前請檢查費用與滑點。"],
  ja:["保存済み研究パラメータ","研究下書きに使用","下書きにコピーしました。実行や注文は開始していません。手数料とスリッページを確認してください。"],
  ko:["저장된 연구 매개변수","연구 초안에 사용","초안에 복사했습니다. 실행이나 주문은 시작하지 않았습니다. 수수료와 슬리피지를 검토하세요."],
  es:["Parámetros de investigación guardados","Usar en borrador","Parámetros copiados. No se inició ejecución ni orden; revise comisiones y deslizamiento."],
  fr:["Paramètres de recherche enregistrés","Utiliser dans le brouillon","Paramètres copiés. Aucun calcul ni ordre lancé ; vérifiez les frais et le glissement."],
  de:["Gespeicherte Forschungsparameter","Im Entwurf verwenden","Parameter kopiert. Kein Lauf oder Auftrag gestartet; Gebühren und Slippage prüfen."],
  pt:["Parâmetros de pesquisa salvos","Usar no rascunho","Parâmetros copiados. Nenhuma execução ou ordem iniciada; revise taxas e slippage."],
  ru:["Сохранённые параметры исследования","Использовать в черновике","Параметры скопированы. Запуск и ордер не созданы; проверьте комиссии и проскальзывание."],
  ar:["معلمات البحث المحفوظة","استخدام في مسودة البحث","نُسخت المعلمات إلى المسودة. لم يبدأ تشغيل أو أمر؛ راجع الرسوم والانزلاق قبل التشغيل."],
  id:["Parameter riset tersimpan","Gunakan dalam draf","Parameter disalin ke draf. Tidak ada proses atau order dimulai; tinjau biaya dan slippage."],
};
for (const [language,[reuseSavedLabel,reuseSavedAction,reuseSavedDone]] of Object.entries(reuseResearchCopy)) Object.assign(businessCopy[language],{reuseSavedLabel,reuseSavedAction,reuseSavedDone});
function verifiedResearchResult(result) {
  return typeof result?.id === "string" && !!result.id.trim() && typeof result?.strategy?.Name === "string" && !!result.strategy.Name.trim() && ["ReturnBPS","BuyHoldBPS","MaxDrawdownBPS","SharpeMilli","VolatilityBPS","Trades","PartialFills","DataGaps"].every(key => Number.isSafeInteger(result?.metrics?.[key])) && ["MaxDrawdownBPS","VolatilityBPS","Trades","PartialFills","DataGaps"].every(key => result.metrics[key] >= 0);
}
function renderResult(result, savedWorkspace) {
  if (!verifiedResearchResult(result)) throw Error(t("researchInvalid"));
  const metrics = result.metrics;
  latestResearchMode = savedWorkspace;
  latestResearchResult = result;
  renderResearchStatus();
  renderRunDetails();
  $("#latest-result").hidden = false;
  for (const [id, key] of [["return","ReturnBPS"],["baseline","BuyHoldBPS"],["drawdown","MaxDrawdownBPS"],["volatility","VolatilityBPS"]]) $("#result-" + id).textContent = Number.isFinite(metrics[key]) ? `${metrics[key]} bps` : "—";
  $("#result-sharpe").textContent = Number.isFinite(metrics.SharpeMilli) ? (metrics.SharpeMilli / 1000).toFixed(3) : "—";
  const points = result.equityCurve || [];
  const valid = Array.isArray(points) && points.length > 1 && points.length <= 10000 && points.every(point => point && Number.isSafeInteger(point.equity) && Number.isSafeInteger(point.benchmarkEquity) && point.equity >= 0 && point.benchmarkEquity >= 0);
  $("#equity-figure").hidden = !valid;
  if (!valid) { $("#equity-chart").innerHTML = ""; return; }
  const values = points.flatMap(point => [point.equity, point.benchmarkEquity]);
  const low = Math.min(...values), span = Math.max(1, Math.max(...values) - low);
  const line = key => points.map((point,index) => `${(12 + index * 696 / (points.length - 1)).toFixed(2)},${(208 - (point[key] - low) * 196 / span).toFixed(2)}`).join(" ");
  $("#equity-chart").innerHTML = `<polyline class="benchmark-line" points="${line("benchmarkEquity")}"/><polyline class="equity-line" points="${line("equity")}"/>`;
}
function safe(v) {
  const e = document.createElement("span");
  e.textContent = String(v ?? "");
  return e.innerHTML;
}
$$("nav button").forEach(
  (b) =>
    (b.onclick = () => {
      $$("nav button").forEach((x) => x.classList.toggle("active", x === b));
      $$(".view").forEach((x) =>
        x.classList.toggle("active", x.id === b.dataset.view),
      );
      $("#view-title").textContent = b.textContent;
    }),
);
$("#refresh").onclick = () => Promise.all([refresh(), refreshPortfolio()]).catch((e) => toast(e.message));
$("#wallet-portfolio-refresh").onclick = refreshPortfolio;
$("#paper-strategy").onchange = () => { $("#paper-submit").disabled = !statefulPreview || paperSubmitting || !$("#paper-strategy").value; };
$("#research-saved-strategy").onchange = () => { $("#research-reuse").disabled = researchSubmitting || !$("#research-saved-strategy").value; };
$("#research-reuse").onclick = () => {
  if (researchSubmitting) return;
  const key = $("#research-saved-strategy").value;
  const matches = Object.values(snapshot.strategies || {}).filter(strategy => reusableResearchStrategy(strategy) && researchSelectionKey(strategy) === key);
  if (matches.length !== 1) { renderResearchChoices(Object.values(snapshot.strategies || {})); return; }
  const strategy = matches[0];
  for (const [id,value] of [["strategy",strategy.Name],["seed",strategy.Seed],["fast",strategy.Params.fast],["slow",strategy.Params.slow]]) $("#"+id).value = String(value);
  toast(t("reuseSavedDone"), "reuseSavedDone");
};
$("#locale").onchange = (e) => {
  locale = e.target.value;
  try { localStorage.setItem("ynx.quant.locale", locale); } catch {}
  applyLocale(); render();
};
$("#backtest").onsubmit = async (e) => {
  e.preventDefault();
  if (researchSubmitting) return;
  researchSubmitting = true;
  renderResearchChoices(Object.values(snapshot.strategies || {}));
  renderResearchRequestState();
  const savedWorkspace = statefulPreview;
  try {
    const body = {
      strategy: {
        id: "ma-" + crypto.randomUUID(),
        name: $("#strategy").value,
        family: "transparent",
        source: "quant://user/ma",
        sourceCommit: "local",
        license: "Apache-2.0",
        seed: +$("#seed").value,
        params: { fast: +$("#fast").value, slow: +$("#slow").value },
        limitations: t("historyWarning"),
      },
      assumptions: {
        feeBPS: +$("#fee").value,
        slippageBPS: +$("#slippage").value,
        latencyBars: 1,
        participationBPS: 1000,
        seed: +$("#seed").value,
        trainEnd: 24,
        walkForwardWindows: 3,
      },
    };
    const result = await api(savedWorkspace ? "/v1/backtests/from-market" : "/v1/public/research/backtests/from-market", { method: "POST", body: JSON.stringify(body) });
    renderResult(result, savedWorkspace);
    const resultMessage = savedWorkspace ? "researchSaved" : "researchTemporary";
    toast(t(resultMessage), resultMessage);
    if (savedWorkspace) await refresh();
    else { publicExperiments[result.id] = result; render(); }
  } catch (e) {
    toast(e.message);
  } finally {
    researchSubmitting = false;
    renderResearchChoices(Object.values(snapshot.strategies || {}));
    renderResearchRequestState();
  }
};
function renderResearchRequestState() {
  $('#research-submit').disabled = researchSubmitting;
  $('#backtest').ariaBusy = String(researchSubmitting);
  $('#research-request-status').hidden = !researchSubmitting;
  $('#research-request-status').textContent = researchSubmitting ? t('researchRequestPending') : '';
}
$("#paper-order").onsubmit = async (e) => {
  e.preventDefault();
  if (paperSubmitting || !statefulPreview) return;
  try {
    const strategyHash = $("#paper-strategy").value;
    if (!Object.values(snapshot.strategies || {}).some(strategy => strategy.StrategyHash === strategyHash) || !/^[0-9a-f]{64}$/.test(strategyHash)) throw new Error(t("strategyMissing"));
    const Side = $("#side").value, Amount = +$("#paper-amount").value;
    if (!["buy", "sell"].includes(Side) || !Number.isSafeInteger(Amount) || Amount <= 0) throw new Error(t("paperInvalidAmount"));
    const sameIntent = pendingPaperIntent?.StrategyHash === strategyHash && pendingPaperIntent.Side === Side && pendingPaperIntent.Amount === Amount;
    if (pendingPaperIntent && !sameIntent) throw new Error(t("paperPendingMismatch"));
    paperSubmitting = true;
    $("#paper-submit").disabled = true;
    if (!confirm(`${t("paperConfirm")}\n\nYNXT-YUSD_TEST\n${t("strategy")}: ${strategyHash}\n${t("paperRecordStatus")}: ${Side}\n${t("paperRecordAmounts")}: ${Amount}\n\n${t("paperExecutionBoundary")}`)) return;
    if (!statefulPreview || $("#paper-strategy").value !== strategyHash || $("#side").value !== Side || +$("#paper-amount").value !== Amount || !Object.values(snapshot.strategies || {}).some(strategy => strategy.StrategyHash === strategyHash)) throw new Error(t("paperPreviewChanged"));
    if (!pendingPaperIntent) {
      pendingPaperIntent = {StrategyHash: strategyHash, Side, Amount, IdempotencyKey: `quant-paper-${crypto.randomUUID()}`};
    }
    persistWorkspaceValue(paperPendingKey, JSON.stringify(pendingPaperIntent));
    paperSubmitting = true;
    $("#paper-submit").disabled = true;
    const submitted = pendingPaperIntent;
    const order = await api("/v1/paper/orders", {
      method: "POST",
      body: JSON.stringify(submitted),
    });
    if (!verifiedPaperRecord(order) || order.IdempotencyKey !== submitted.IdempotencyKey || order.StrategyHash !== submitted.StrategyHash || order.Side !== submitted.Side || order.Amount !== submitted.Amount) throw new Error(t("paperPendingMismatch"));
    pendingPaperIntent = null;
    try { localStorage.removeItem(paperPendingKey); } catch { workspaceStorageAvailable = false; statefulPreview = false; }
    toast(t("paperRecorded"), "paperRecorded");
    await refresh();
  } catch (e) {
    if (e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 409 && e.status !== 429) {
      pendingPaperIntent = null;
      try { localStorage.removeItem(paperPendingKey); } catch { workspaceStorageAvailable = false; statefulPreview = false; }
    }
    toast(e.message);
  } finally {
    paperSubmitting = false;
    $('#workspace-storage-boundary').hidden = workspaceStorageAvailable;
    $('#workspace-storage-boundary').textContent = t('workspaceStorageUnavailable');
    renderRiskControls();
    $("#paper-submit").disabled = !statefulPreview || !$("#paper-strategy").value;
  }
};
function quantDeviceId() {
  const key = "ynx.quant.public-device-id";
  let value = localStorage.getItem(key);
  if (!value) {
    value = `quant-web-${crypto.randomUUID()}`;
    localStorage.setItem(key, value);
  }
  return value;
}
function mandateDraft() {
  const strategyHash = $("#mandate-strategy").value.trim().toLowerCase();
  return {
    Account: $("#mandate-account").value.trim(),
    StrategyHash: strategyHash,
    Market: "YNXT-YUSD_TEST",
    ProductID: "ynx-quant-lab",
    BundleID: "com.ynxweb4.quant.web",
    DeviceID: quantDeviceId(),
    NonceDomain: "quant:" + strategyHash,
    Scope: "quant:testnet-execute",
    Nonce: Date.now(),
    MaxNotional: +$("#mandate-notional").value,
    MaxPosition: +$("#mandate-position").value,
    MaxDailyLoss: +$("#mandate-loss").value,
    MaxSlippageBPS: +$("#mandate-slippage").value,
    MaxGas: +$("#mandate-gas").value,
    MaxOrdersPerMinute: +$("#mandate-frequency").value,
    MaxLeverageBPS: +$("#mandate-leverage").value,
    MaxDrawdown: +$("#mandate-drawdown").value,
    MinLiquidity: +$("#mandate-liquidity").value,
    MaxVaR: +$("#mandate-var").value,
    MaxExpectedShortfall: +$("#mandate-es").value,
    MaxDepegBPS: +$("#mandate-depeg").value,
    MaxConcentrationBPS: +$("#mandate-concentration").value,
    MaxCancelRateBPS: +$("#mandate-cancel-rate").value,
    MaxConsecutiveAPIFailures: +$("#mandate-api-failures").value,
    ExpiresAt: new Date(Date.now() + +$("#mandate-expiry").value * 60000).toISOString(),
    TestnetOnly: true,
  };
}
$$('#mandate-form input:not(#mandate-signature)').forEach((input) => {
  input.addEventListener("input", clearSigningPreviews);
});
$$('#testnet-order-form input:not(#order-signature), #testnet-order-form select').forEach(input => input.addEventListener("input", clearSigningPreviews));
$("#preview-mandate").onclick = async () => {
  clearSigningPreviews();
  const revision = previewRevision;
  try {
    const draft = mandateDraft();
    const result = await api("/v1/testnet/signing-payloads/mandate", { method: "POST", body: JSON.stringify(draft) });
    if (revision !== previewRevision) return;
    pendingMandate = draft;
    $("#mandate-payload").textContent = `${result.payload}\n\nSHA-256 ${result.digest}`;
    $("#mandate-payload").hidden = false;
  } catch (e) {
    if (revision === previewRevision) toast(e.message);
  }
};
$("#mandate-form").onsubmit = async (e) => {
  e.preventDefault();
  if (!pendingMandate) return toast("Preview the exact mandate payload before signing");
  const revision = previewRevision, draft = pendingMandate;
  try {
    const productProof = await window.YNXQuantWallet.requireProof("quant:mandate:create");
    if (revision !== previewRevision || draft !== pendingMandate) return;
    const result = await api("/v1/testnet/mandates", {
      method: "POST",
      headers: { "x-ynx-quant-product-session-proof": productProof },
      body: JSON.stringify({ ...draft, WalletSignature: $("#mandate-signature").value.trim() }),
    });
    if (revision !== previewRevision) return;
    $("#order-mandate").value = result.Digest;
    toast("Wallet mandate verified by Exchange and registered");
    await refresh();
  } catch (e) {
    toast(e.message);
  }
};
function orderDraft() {
  return {
    Account: $("#mandate-account").value.trim(),
    Market: "YNXT-YUSD_TEST",
    Side: $("#order-side").value,
    Price: +$("#order-price").value,
    Amount: +$("#order-amount").value,
    IdempotencyKey: $("#order-key").value.trim(),
  };
}
$("#preview-order").onclick = async () => {
  clearSigningPreviews();
  const revision = previewRevision;
  try {
    const draft = orderDraft();
    const result = await api("/v1/testnet/signing-payloads/order", { method: "POST", body: JSON.stringify(draft) });
    if (revision !== previewRevision) return;
    pendingOrder = draft;
    $("#order-payload").textContent = `${result.payload}\n\nSHA-256 ${result.digest}`;
    $("#order-payload").hidden = false;
  } catch (e) {
    if (revision === previewRevision) toast(e.message);
  }
};
$("#testnet-order-form").onsubmit = async (e) => {
  e.preventDefault();
  const draft = orderDraft();
  if (!pendingOrder || JSON.stringify(draft) !== JSON.stringify(pendingOrder)) return toast("Preview the exact order payload before signing");
  const revision = previewRevision;
  try {
    const productProof = await window.YNXQuantWallet.requireProof("quant:mandate:execute");
    if (revision !== previewRevision || !pendingOrder) return;
    await api("/v1/testnet/orders", {
      method: "POST",
      headers: { "x-ynx-quant-product-session-proof": productProof },
      body: JSON.stringify({
        MandateDigest: $("#order-mandate").value.trim(),
        Side: draft.Side,
        Price: draft.Price,
        Amount: draft.Amount,
        IdempotencyKey: draft.IdempotencyKey,
        WalletSignature: $("#order-signature").value.trim(),
        Risk: {
          referencePrice: +$("#risk-reference").value,
          estimatedGas: +$("#risk-gas").value,
          observedDailyLoss: +$("#risk-loss").value,
          equity: +$("#risk-equity").value,
          grossExposure: +$("#risk-exposure").value,
          peakEquity: +$("#risk-peak").value,
          currentEquity: +$("#risk-current").value,
          availableLiquidity: +$("#risk-liquidity").value,
          depegBps: +$("#risk-depeg").value,
          concentrationBps: +$("#risk-concentration").value,
          ordersObserved: +$("#risk-orders").value,
          cancelsObserved: +$("#risk-cancels").value,
          consecutiveApiFailures: +$("#risk-api-failures").value,
          var: +$("#risk-var").value,
          expectedShortfall: +$("#risk-es").value,
          oracleAsOf: new Date().toISOString(),
          venueHealthy: true,
        },
      }),
    });
    if (revision !== previewRevision) return;
    toast("Wallet-authorized order submitted to YNX Testnet");
    pendingOrder = null;
    $("#order-signature").value = "";
    await refresh();
  } catch (e) {
    toast(e.message);
  }
};
function renderRiskControls() {
  for(const id of ['reconcile','kill']) { const button=$('#'+id); button.disabled=!statefulPreview||riskWrites.has(id); button.ariaBusy=String(riskWrites.has(id)); }
}
function confirmedRiskReceipt(value) {
  if(!value||!Number.isSafeInteger(value.Cash)||!Number.isSafeInteger(value.Position)||!Number.isSafeInteger(value.ReconciliationDelta)||value.ReconciliationDelta<0||typeof value.KillSwitch!=='boolean'||value.ReconciliationDelta>0&&!value.KillSwitch) throw Object.assign(new Error(t('riskReceiptUnconfirmed')), {localeKey:'riskReceiptUnconfirmed'});
  return value;
}
$("#reconcile").onclick = async () => {
  if (!statefulPreview || riskWrites.has('reconcile')) return;
  riskWrites.add('reconcile');renderRiskControls();
  try {
    const receipt=confirmedRiskReceipt(await api("/v1/paper/reconcile", {
      method: "POST",
      body: JSON.stringify({
        Cash: snapshot.paper.Cash,
        Position: snapshot.paper.Position,
      }),
    }));
    if(receipt.ReconciliationDelta===0) toast(t('reconciled'),'reconciled');
    else {const suffix=': '+String(receipt.ReconciliationDelta);toast(t('reconcileDifference')+suffix,'reconcileDifference',suffix)}
    await refresh();
  } catch (e) {
    toast(e.message,e.localeKey??null);
  } finally {
    riskWrites.delete('reconcile');renderRiskControls();
  }
};
$("#kill").onclick = async () => {
  if (!statefulPreview || riskWrites.has('kill')) return;
  if (!confirm(t("confirmKill"))) return;
  riskWrites.add('kill');renderRiskControls();
  try {
    const receipt=confirmedRiskReceipt(await api("/v1/risk/kill", {
      method: "POST",
      body: JSON.stringify({ reason: "operator user confirmation" }),
    }));
    if(!receipt.KillSwitch)throw Object.assign(new Error(t('riskReceiptUnconfirmed')),{localeKey:'riskReceiptUnconfirmed'});
    toast(t("killActive"), "killActive");
    await refresh();
  } catch (e) {
    toast(e.message,e.localeKey??null);
  } finally {
    riskWrites.delete('kill');renderRiskControls();
  }
};
applyLocale();
// A return URL only reveals the existing account controls. The private-session
// controller still validates the callback and grants no authority from this UI.
if (window.location?.pathname === "/wallet-auth/callback") $("#account-panel").open = true;
window.addEventListener("ynx:quant-wallet-state", event => handleWalletState(event.detail));
handleWalletState(window.YNXQuantWallet?.getStandardWalletState?.());
refresh().catch((e) => toast("Service unavailable: " + e.message));
