const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
let snapshot = { paper: {}, strategies: {}, experiments: {}, audit: [] };
let snapshotRevision = 0;
let workspaceReadUnavailable = false;
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
const researchPendingKey = `ynx.quant.research.pending.v1:${tenantId}`;
let pendingResearchInvalid = false, pendingResearchIntent = readPendingResearchIntent();
function readPendingResearchIntent() {
  if (!workspaceStorageAvailable) return null;
  const raw = readPreference(researchPendingKey);
  if (raw === null) return null;
  try {
    if (raw.length > 65536) throw Error('INVALID_SAVED_RESEARCH_REQUEST');
    const value = JSON.parse(raw), strategy = value?.strategy, costs = value?.assumptions;
    if(Object.keys(strategy).sort().join(',')!=='family,id,license,limitations,name,params,seed,source,sourceCommit' || Object.keys(costs).sort().join(',')!=='feeBPS,latencyBars,participationBPS,seed,slippageBPS,trainEnd,walkForwardWindows' || strategy.source!=='quant://user/ma' || strategy.sourceCommit!=='local' || strategy.license!=='Apache-2.0' || typeof strategy.limitations!=='string')throw Error('INVALID_SAVED_RESEARCH_REQUEST');
    if (Object.keys(value).sort().join(',') !== 'assumptions,idempotencyKey,strategy' || !/^quant-research-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.idempotencyKey) || !/^ma-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(strategy?.id) || strategy.family !== 'transparent' || typeof strategy.name !== 'string' || !strategy.name.trim() || strategy.name.length > 80 || !Number.isSafeInteger(strategy.seed) || Object.keys(strategy.params).sort().join(',') !== 'fast,slow' || !Number.isSafeInteger(strategy.params.fast) || strategy.params.fast < 2 || !Number.isSafeInteger(strategy.params.slow) || strategy.params.slow <= strategy.params.fast || !Number.isSafeInteger(costs.feeBPS) || costs.feeBPS < 0 || !Number.isSafeInteger(costs.slippageBPS) || costs.slippageBPS < 0 || costs.seed !== strategy.seed || costs.latencyBars !== 1 || costs.participationBPS !== 1000 || costs.trainEnd !== 24 || costs.walkForwardWindows !== 3) throw Error('INVALID_SAVED_RESEARCH_REQUEST');
    return value;
  } catch { pendingResearchInvalid = true; return null; }
}
let paperSubmitting = false, pendingPaperInvalid = false, pendingPaperIntent = readPendingPaperIntent();
// A pending exact-key replay may retrieve an already committed receipt even
// after a kill. The service still rejects new execution under the kill switch.
function paperFreshIntentBlockKey() { return pendingPaperInvalid ? 'paperPendingUnreadable' : pendingPaperIntent ? null : workspaceReadUnavailable ? 'workspaceReadUnavailable' : snapshot.paper?.KillSwitch === true ? 'killActive' : null; }
function paperFreshIntentBlocked() { return paperFreshIntentBlockKey() !== null; }
function renderPaperSubmitControl() { $('#paper-submit').disabled = !statefulPreview || paperSubmitting || !$('#paper-strategy').value || paperFreshIntentBlocked(); renderPaperPendingState(); }
function readPendingPaperIntent() {
  if (!workspaceStorageAvailable) return null;
  try {
    const raw=localStorage.getItem(paperPendingKey);
    if(raw===null)return null;
    if(raw.length>65536)throw Error('INVALID_SAVED_PAPER_REQUEST');
    const value = JSON.parse(raw);
    // Our persisted envelope is always JSON.stringify output. A duplicate-key
    // or otherwise rewritten envelope must not silently become an exact replay.
    if(JSON.stringify(value)!==raw)throw Error('INVALID_SAVED_PAPER_REQUEST');
    if (value && Object.keys(value).sort().join(',')==='Amount,IdempotencyKey,Side,StrategyHash' && /^quant-paper-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.IdempotencyKey) && /^[0-9a-f]{64}$/.test(value.StrategyHash) && ["buy", "sell"].includes(value.Side) && Number.isSafeInteger(value.Amount) && value.Amount > 0) return value;
    throw Error('INVALID_SAVED_PAPER_REQUEST');
  } catch { pendingPaperInvalid=true; return null; }
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
// Translate only byte-exact definitions reported by the existing engine. An
// unknown historical/service formula must never be replaced by a guessed one.
const reportedMetricDefinitions = {
  returnBPS:"(ending equity - starting equity) / starting equity × 10,000",
  buyHoldBPS:"(ending close - starting close) / starting close × 10,000",
  maxDrawdownBPS:"maximum peak-to-trough equity loss / prior peak × 10,000",
  sharpeMilli:"mean OOS period return / sample standard deviation of OOS period returns × sqrt(number of periods) × 1,000; risk-free rate is assumed zero",
  volatilityBPS:"sample standard deviation of OOS period returns × 10,000; not annualized",
};
const metricFormulaCopy = {
  en:Object.values(reportedMetricDefinitions),
  "zh-CN":["（期末权益 − 期初权益）/ 期初权益 × 10,000","（期末收盘价 − 期初收盘价）/ 期初收盘价 × 10,000","权益从峰值到低谷的最大损失 / 此前峰值 × 10,000","样本外每期收益均值 / 样本外每期收益的样本标准差 × √期数 × 1,000；无风险利率假设为零","样本外每期收益的样本标准差 × 10,000；未年化"],
  "zh-TW":["（期末權益 − 期初權益）/ 期初權益 × 10,000","（期末收盤價 − 期初收盤價）/ 期初收盤價 × 10,000","權益從峰值到低谷的最大損失 / 先前峰值 × 10,000","樣本外每期報酬均值 / 樣本外每期報酬的樣本標準差 × √期數 × 1,000；無風險利率假設為零","樣本外每期報酬的樣本標準差 × 10,000；未年化"],
  ja:["（期末資産 − 期首資産）/ 期首資産 × 10,000","（期末終値 − 期首終値）/ 期首終値 × 10,000","資産のピークから谷までの最大損失 / 直前のピーク × 10,000","学習外の各期間リターンの平均 / その標本標準偏差 × √期間数 × 1,000；無リスク金利はゼロと仮定","学習外の各期間リターンの標本標準偏差 × 10,000；年率換算なし"],
  ko:["(기말 자산 − 기초 자산) / 기초 자산 × 10,000","(기말 종가 − 기초 종가) / 기초 종가 × 10,000","자산의 고점 대비 최대 하락액 / 이전 고점 × 10,000","표본 외 기간 수익률 평균 / 해당 수익률의 표본 표준편차 × √기간 수 × 1,000; 무위험 이자율은 0으로 가정","표본 외 기간 수익률의 표본 표준편차 × 10,000; 연율화하지 않음"],
  es:["(Patrimonio final − inicial) / patrimonio inicial × 10.000","(Cierre final − inicial) / cierre inicial × 10.000","Máxima pérdida del patrimonio de pico a valle / pico anterior × 10.000","Media del retorno por periodo fuera de muestra / desviación estándar muestral de esos retornos × √número de periodos × 1.000; tasa libre de riesgo supuesta cero","Desviación estándar muestral de los retornos por periodo fuera de muestra × 10.000; sin anualizar"],
  fr:["(Capital final − initial) / capital initial × 10 000","(Clôture finale − initiale) / clôture initiale × 10 000","Perte maximale du capital entre sommet et creux / sommet précédent × 10 000","Moyenne des rendements par période hors échantillon / écart-type d'échantillon de ces rendements × √nombre de périodes × 1 000 ; taux sans risque supposé nul","Écart-type d'échantillon des rendements par période hors échantillon × 10 000 ; non annualisé"],
  de:["(Endkapital − Anfangskapital) / Anfangskapital × 10.000","(Letzter Schlusskurs − erster Schlusskurs) / erster Schlusskurs × 10.000","Größter Kapitalverlust vom Hoch zum Tief / vorheriges Hoch × 10.000","Mittlere Periodenrendite außerhalb der Stichprobe / Stichprobenstandardabweichung dieser Renditen × √Periodenzahl × 1.000; risikofreier Zins als null angenommen","Stichprobenstandardabweichung der Periodenrenditen außerhalb der Stichprobe × 10.000; nicht annualisiert"],
  pt:["(Patrimônio final − inicial) / patrimônio inicial × 10.000","(Fechamento final − inicial) / fechamento inicial × 10.000","Perda máxima do patrimônio do pico ao vale / pico anterior × 10.000","Média do retorno por período fora da amostra / desvio padrão amostral desses retornos × √número de períodos × 1.000; taxa livre de risco assumida zero","Desvio padrão amostral dos retornos por período fora da amostra × 10.000; não anualizado"],
  ru:["(Конечный капитал − начальный капитал) / начальный капитал × 10 000","(Конечная цена закрытия − начальная) / начальная цена закрытия × 10 000","Максимальная потеря капитала от пика до минимума / предыдущий пик × 10 000","Средняя доходность периода вне обучающей выборки / выборочное стандартное отклонение этих доходностей × √число периодов × 1 000; безрисковая ставка принята равной нулю","Выборочное стандартное отклонение доходностей периода вне обучающей выборки × 10 000; без пересчёта в годовое значение"],
  ar:["(قيمة النهاية − قيمة البداية) / قيمة البداية × 10,000","(إغلاق النهاية − إغلاق البداية) / إغلاق البداية × 10,000","أقصى خسارة للقيمة من القمة إلى القاع / القمة السابقة × 10,000","متوسط عائد الفترة خارج العينة / الانحراف المعياري للعينة لهذه العوائد × √عدد الفترات × 1,000؛ معدل العائد الخالي من المخاطر مفترض صفرًا","الانحراف المعياري للعينة لعوائد الفترات خارج العينة × 10,000؛ غير محوّل إلى معدل سنوي"],
  id:["(Ekuitas akhir − awal) / ekuitas awal × 10.000","(Harga penutupan akhir − awal) / harga penutupan awal × 10.000","Kerugian ekuitas maksimum dari puncak ke lembah / puncak sebelumnya × 10.000","Rata-rata imbal hasil per periode di luar sampel / simpangan baku sampel imbal hasil tersebut × √jumlah periode × 1.000; suku bunga bebas risiko diasumsikan nol","Simpangan baku sampel imbal hasil per periode di luar sampel × 10.000; tidak disetahunkan"],
};
for (const [language, definitions] of Object.entries(metricFormulaCopy)) {
  Object.keys(reportedMetricDefinitions).forEach((key,index) => { businessCopy[language]['formula' + key[0].toUpperCase() + key.slice(1)] = definitions[index]; });
}
function researchMetricDefinition(result, key) {
  const text = result?.metricDefinitions?.[key];
  if (typeof text !== 'string' || !text.trim()) return '—';
  return text === reportedMetricDefinitions[key] ? t('formula' + key[0].toUpperCase() + key.slice(1)) : text;
}
const researchCostRoundingCopy = {
  en:["Cost rounding","For each fill, fee and slippage are separately rounded down to whole quote-asset micro-units, then added. Cash and cost attribution use that same total."],
  "zh-CN":["成本取整","每次成交的手续费和滑点分别向下取整为计价资产的整数微单位，再相加。现金扣款与成本归因使用同一总额。"],
  "zh-TW":["成本取整","每次成交的手續費與滑價分別向下取整為計價資產的整數微單位，再相加。現金扣款與成本歸因使用同一總額。"],
  ja:["費用の丸め","約定ごとに手数料とスリッページを建値資産の整数マイクロ単位へ個別に切り捨て、合算します。現金と費用内訳は同じ合計を使います。"],
  ko:["비용 반올림 규칙","체결마다 수수료와 슬리피지를 호가 자산의 정수 마이크로 단위로 각각 내림한 뒤 합산합니다. 현금 차감과 비용 귀속은 같은 합계를 사용합니다."],
  es:["Redondeo de costes","En cada ejecución, comisión y deslizamiento se redondean por separado hacia abajo a microunidades enteras del activo cotizado y se suman. Efectivo y desglose usan el mismo total."],
  fr:["Arrondi des coûts","À chaque exécution, frais et glissement sont arrondis séparément vers le bas en microunités entières de l'actif de cotation, puis additionnés. Trésorerie et attribution utilisent le même total."],
  de:["Kostenrundung","Je Ausführung werden Gebühren und Slippage getrennt auf ganze Mikroeinheiten des Kurswährungswerts abgerundet und dann addiert. Barmittel und Kostenaufteilung verwenden dieselbe Summe."],
  pt:["Arredondamento dos custos","Em cada execução, taxas e slippage são arredondados separadamente para baixo em microunidades inteiras do ativo de cotação e somados. Caixa e atribuição usam o mesmo total."],
  ru:["Округление издержек","Для каждого исполнения комиссия и проскальзывание отдельно округляются вниз до целых микроединиц актива котировки, затем складываются. Денежный баланс и разбивка затрат используют одну сумму."],
  ar:["تقريب التكاليف","لكل تنفيذ، تُقرّب الرسوم والانزلاق كل على حدة إلى الأسفل بوحدات ميكرو صحيحة لأصل التسعير ثم تُجمع. يستخدم النقد وتوزيع التكاليف المجموع نفسه."],
  id:["Pembulatan biaya","Untuk tiap eksekusi, biaya dan slippage dibulatkan ke bawah secara terpisah ke satuan mikro bulat aset kuotasi, lalu dijumlahkan. Kas dan atribusi biaya memakai total yang sama."],
};
for (const [language,[runCostRounding,runCostRoundingRule]] of Object.entries(researchCostRoundingCopy)) Object.assign(businessCopy[language],{runCostRounding,runCostRoundingRule});
function researchCostRoundingText(result) {
  return result?.attribution?.costRoundingPolicy === 'independent_cost_component_floor_micro_v1' ? t('runCostRoundingRule') : '—';
}
const researchIdleCopy = {
  en:['Average idle cash','Mean cash over recorded bars, including warmup and no-fill bars, truncated toward zero in micro-units. Not time-weighted; missing bars are not invented and no interest is modeled.'],
  'zh-CN':['平均闲置现金','按已记录的各根 K 线计算现金均值，包括预热和无成交时段，微单位向零截断。不是时间加权；不补造缺失 K 线，也不模拟利息。'],
  'zh-TW':['平均閒置現金','依已記錄的各根 K 線計算現金均值，包括預熱和無成交時段，微單位向零截斷。不是時間加權；不補造缺失 K 線，也不模擬利息。'],
  ja:['平均待機資金','記録済みバーの現金平均。準備期間と未約定バーも含み、マイクロ単位でゼロ方向に切り捨てます。時間加重ではなく、欠損バーや利息は作りません。'],
  ko:['평균 유휴 현금','준비 기간과 미체결 봉을 포함한 기록된 봉의 현금 평균을 마이크로 단위에서 0 방향으로 절삭합니다. 시간 가중이 아니며 누락 봉과 이자는 생성하지 않습니다.'],
  es:['Efectivo inactivo medio','Media de efectivo en barras registradas, incluidas preparación y barras sin ejecución; truncada hacia cero en microunidades. Sin ponderación temporal, barras inventadas ni intereses.'],
  fr:['Trésorerie inactive moyenne','Moyenne du cash des barres enregistrées, préparation et barres sans exécution incluses, tronquée vers zéro en microunités. Sans pondération temporelle, barres inventées ni intérêts.'],
  de:['Durchschnittlich freies Kapital','Barmittelmittelwert aller erfassten Balken einschließlich Vorlauf und Balken ohne Ausführung; auf Mikroeinheiten gegen null gekürzt. Keine Zeitgewichtung, erfundenen Balken oder Zinsen.'],
  pt:['Caixa ocioso médio','Média de caixa nas barras registradas, incluindo preparação e barras sem execução, truncada em direção a zero em microunidades. Sem ponderação temporal, barras inventadas ou juros.'],
  ru:['Средние свободные средства','Среднее денежных средств по записанным барам, включая прогрев и бары без сделок, с усечением к нулю в микроединицах. Без весов по времени, выдуманных баров и процентов.'],
  ar:['متوسط النقد الخامل','متوسط النقد عبر الشموع المسجلة، بما فيها التهيئة والشموع بلا تنفيذ، مع حذف الكسور نحو الصفر بوحدات ميكرو. ليس مرجحاً بالزمن؛ لا تُختلق شموع مفقودة ولا تُحاكى فوائد.'],
  id:['Rata-rata kas menganggur','Rata-rata kas pada bar tercatat, termasuk pemanasan dan bar tanpa eksekusi, dipotong menuju nol dalam satuan mikro. Bukan bobot waktu; tidak membuat bar hilang atau bunga.'],
};
for(const [language,[runIdleCash,runIdleCashRule]] of Object.entries(researchIdleCopy))Object.assign(businessCopy[language],{runIdleCash,runIdleCashRule});
function researchIdleCashRule(result){return result?.attribution?.idleCapitalSamplingPolicy==='observed_bar_cash_mean_truncate_micro_v1'?t('runIdleCashRule'):'—';}
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
const paperDailyLossCopy = {
  en: ['Daily marked loss / limit', 'Paper daily loss uses cash plus marked open positions. Baseline: first accepted market mark of each UTC day, not a midnight quote. Loss of 1000 YUSD_TEST blocks new signals for that day, even after price recovery or restart. No fees/slippage; old records have no historical baseline.'],
  'zh-CN': ['日内估值亏损 / 限额', '模拟日亏损按现金与持仓估值计算。基线为每个 UTC 日首次接受的行情，不是午夜报价。亏损达到 1000 YUSD_TEST 后当日禁止新信号，价格恢复或重启也不解除。不含费用或滑点；旧记录没有历史基线。'],
  'zh-TW': ['日內估值虧損 / 限額', '模擬日虧損按現金與持倉估值計算。基線為每個 UTC 日首次接受的行情，非午夜報價。虧損達 1000 YUSD_TEST 後當日禁止新訊號，價格恢復或重啟不解除。不含費用或滑點；舊記錄無歷史基線。'],
  ja: ['日次評価損 / 上限', '現金と保有評価額で計算。基準は UTC 日の最初の受理価格で、午前0時の価格ではありません。1000 YUSD_TEST の損失で当日の新規シグナルを停止し、価格回復・再起動でも解除しません。費用・滑りなし。旧記録に過去の基準はありません。'],
  ko: ['일일 평가손실 / 한도', '현금과 보유 평가액으로 계산합니다. 기준은 UTC 날짜의 첫 수락 가격이며 자정 가격이 아닙니다. 1000 YUSD_TEST 손실 시 당일 새 신호가 차단되며 가격 회복·재시작으로 해제되지 않습니다. 비용·슬리피지는 제외하며 이전 기록에는 과거 기준이 없습니다.'],
  es: ['Pérdida diaria valorada / límite', 'Efectivo más posiciones valoradas. Base: primer precio aceptado del día UTC, no precio de medianoche. Una pérdida de 1000 YUSD_TEST bloquea señales nuevas ese día, incluso tras recuperación o reinicio. Sin costes/deslizamiento; los registros antiguos no tienen base histórica.'],
  fr: ['Perte quotidienne valorisée / plafond', 'Trésorerie plus positions valorisées. Base : premier prix accepté du jour UTC, pas celui de minuit. Une perte de 1000 YUSD_TEST bloque les nouveaux signaux ce jour, même après reprise ou redémarrage. Sans frais/glissement ; anciens enregistrements sans base historique.'],
  de: ['Täglicher Bewertungsverlust / Limit', 'Bargeld plus bewertete Positionen. Basis: erster akzeptierter Kurs des UTC-Tags, kein Mitternachtskurs. 1000 YUSD_TEST Verlust sperrt neue Signale für den Tag, auch nach Kurserholung/Neustart. Ohne Gebühren/Slippage; alte Datensätze haben keine historische Basis.'],
  pt: ['Perda diária marcada / limite', 'Caixa mais posições avaliadas. Base: primeiro preço aceito do dia UTC, não preço da meia-noite. Perda de 1000 YUSD_TEST bloqueia novos sinais no dia, mesmo após recuperação/reinício. Sem custos/slippage; registros antigos não têm base histórica.'],
  ru: ['Дневной оценочный убыток / лимит', 'Деньги плюс оценка позиций. База — первая принятая цена дня UTC, не цена в полночь. Убыток 1000 YUSD_TEST блокирует новые сигналы до следующего дня, даже при восстановлении цены/перезапуске. Без комиссий/проскальзывания; старые записи без исторической базы.'],
  ar: ['الخسارة اليومية المقدرة / الحد', 'النقد مع قيمة المراكز. الأساس أول سعر مقبول في يوم UTC وليس سعر منتصف الليل. خسارة 1000 YUSD_TEST تمنع الإشارات الجديدة لذلك اليوم حتى بعد تعافي السعر أو إعادة التشغيل. بلا رسوم أو انزلاق؛ السجلات القديمة بلا أساس تاريخي.'],
  id: ['Kerugian harian bertanda / batas', 'Kas ditambah nilai posisi. Dasar: harga pertama yang diterima pada hari UTC, bukan harga tengah malam. Rugi 1000 YUSD_TEST memblokir sinyal baru hari itu, termasuk setelah pemulihan harga/restart. Tanpa biaya/slippage; catatan lama tidak memiliki dasar historis.'],
};
for (const [language, [paperDailyLoss, paperDailyLossLead]] of Object.entries(paperDailyLossCopy)) {
  Object.assign(businessCopy[language], {paperDailyLoss, paperDailyLossLead});
  businessCopy[language].paperExecutionBoundary += '\n' + paperDailyLossLead;
}
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
const scheduleStatusKeys = {scheduled:'scheduleQueued',running:'scheduleClaimed',completed:'scheduleCompleted',stopped_by_user:'scheduleStopped',cancelled_before_execution:'scheduleCancelled',failed_invalid_or_cancelled_configuration:'scheduleConfigurationFailed',failed_market_data_unavailable:'scheduleMarketFailed'};
const scheduleStatusCopy = {
  en:['Waiting for the next research run','Run claimed — completion not yet verified','Research run completed','Cancelled before execution','Configuration changed or invalid; review the strategy','Market data unavailable; retry at the next scheduled run'],
  'zh-CN':['等待下一次研究','任务已认领，完成尚未验证','研究运行完成','执行前已取消','配置已变化或无效，请检查策略','行情不可用，将在下一到期时间重试'],
  'zh-TW':['等待下一次研究','任務已認領，完成尚未驗證','研究執行完成','執行前已取消','設定已變更或無效，請檢查策略','行情不可用，將在下一到期時間重試'],
  ja:['次の研究を待機中','実行を確保済み・完了は未確認','研究が完了','実行前に取消','設定が変更または無効です。戦略を確認','市場データを取得できません。次回に再試行'],
  ko:['다음 연구 대기 중','실행 확보됨 — 완료 미확인','연구 실행 완료','실행 전에 취소됨','설정이 변경되었거나 유효하지 않습니다. 전략 확인','시장 데이터 없음. 다음 예약에 재시도'],
  es:['Esperando el próximo estudio','Ejecución reservada; finalización sin verificar','Estudio completado','Cancelado antes de ejecutar','Configuración cambiada o inválida; revisa la estrategia','Datos no disponibles; reintento en la próxima ejecución'],
  fr:['En attente de la prochaine recherche','Exécution réservée ; fin non vérifiée','Recherche terminée','Annulée avant exécution','Configuration modifiée ou invalide ; vérifiez la stratégie','Données indisponibles ; nouvel essai au prochain passage'],
  de:['Warten auf den nächsten Forschungslauf','Lauf reserviert — Abschluss nicht bestätigt','Forschungslauf abgeschlossen','Vor Ausführung abgebrochen','Konfiguration geändert oder ungültig; Strategie prüfen','Marktdaten fehlen; neuer Versuch beim nächsten Termin'],
  pt:['Aguardando a próxima pesquisa','Execução reservada; conclusão não verificada','Pesquisa concluída','Cancelada antes da execução','Configuração alterada ou inválida; revise a estratégia','Dados indisponíveis; nova tentativa na próxima execução'],
  ru:['Ожидание следующего исследования','Запуск закреплён; завершение не подтверждено','Исследование завершено','Отменено до выполнения','Настройки изменены или неверны; проверьте стратегию','Рыночные данные недоступны; повтор в следующий срок'],
  ar:['بانتظار البحث التالي','تم حجز التشغيل؛ الاكتمال غير مؤكد','اكتمل البحث','أُلغي قبل التنفيذ','الإعدادات تغيرت أو غير صالحة؛ راجع الاستراتيجية','بيانات السوق غير متاحة؛ إعادة المحاولة في الموعد التالي'],
  id:['Menunggu riset berikutnya','Proses dicadangkan — selesai belum terverifikasi','Riset selesai','Dibatalkan sebelum eksekusi','Konfigurasi berubah atau tidak valid; tinjau strategi','Data pasar tidak tersedia; coba lagi pada jadwal berikutnya']
};
for (const [language, values] of Object.entries(scheduleStatusCopy)) Object.assign(businessCopy[language],Object.fromEntries(['scheduleQueued','scheduleClaimed','scheduleCompleted','scheduleCancelled','scheduleConfigurationFailed','scheduleMarketFailed'].map((key,index)=>[key,values[index]])));
function scheduleStatusText(runtime) { return t(Object.hasOwn(scheduleStatusKeys,runtime?.lastRunStatus) ? scheduleStatusKeys[runtime.lastRunStatus] : runtime?.lastRunStatus ? 'scheduleUnknown' : 'scheduleInactive'); }
function observedSchedule(strategy) {
  const runtime = strategy?.Runtime;
  if (!runtime || typeof runtime.enabled !== "boolean" || typeof runtime.running !== "boolean" || !Number.isSafeInteger(runtime.intervalSeconds) || runtime.intervalSeconds < 0) return null;
  if (runtime.lastRunStatus && !Object.hasOwn(scheduleStatusKeys,runtime.lastRunStatus)) return null;
  if (runtime.enabled && (runtime.intervalSeconds < 60 || runtime.intervalSeconds > 86400 || typeof runtime.lastRunStatus !== "string" || !runtime.lastRunStatus || !auditTimeValid(runtime.nextRunAt) || runtime.nextRunAt.startsWith("0001-"))) return null;
  if (!runtime.enabled && runtime.running) return null;
  return runtime;
}
function scheduleTime(value) { return auditTimeValid(value) && !value.startsWith("0001-") ? localDate(value) : "—"; }

function verifiedPaperRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  if (typeof record.ID !== "string" || !/^paper-[0-9]+$/.test(record.ID) || typeof record.StrategyHash !== "string" || !/^[a-f0-9]{64}$/.test(record.StrategyHash)) return false;
  if (!["buy", "sell"].includes(record.Side) || !Number.isSafeInteger(record.Price) || record.Price <= 0 || !Number.isSafeInteger(record.Amount) || record.Amount <= 0 || !Number.isSafeInteger(record.Filled) || record.Filled < 0 || record.Filled > record.Amount) return false;
  if (record.Source !== "authoritative_market_adapter" || !auditTimeValid(record.CreatedAt)) return false;
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
const auditReadCopy = {
  en:['No audited actions yet.','Audit record unavailable. Refresh to read again; no action was inferred.'],
  'zh-CN':['尚无审计操作。','审计记录不可用。请刷新重读；未推断操作成功。'],
  'zh-TW':['尚無審計操作。','審計記錄無法讀取。請重新整理；未推斷操作成功。'],
  ja:['監査された操作はありません。','監査記録を確認できません。更新してください。操作の成功は推定しません。'],
  ko:['아직 감사 기록이 없습니다.','감사 기록을 확인할 수 없습니다. 새로 고침하세요. 작업 성공을 추정하지 않습니다.'],
  es:['Aún no hay acciones auditadas.','Registro de auditoría no disponible. Actualice; no se ha supuesto ninguna acción.'],
  fr:['Aucune action auditée pour le moment.','Journal indisponible. Actualisez ; aucune action n’est déduite.'],
  de:['Noch keine protokollierten Aktionen.','Prüfprotokoll nicht verfügbar. Aktualisieren; es wird keine Aktion angenommen.'],
  pt:['Ainda não há ações auditadas.','Registro indisponível. Atualize; nenhuma ação foi presumida.'],
  ru:['Пока нет записей аудита.','Запись аудита недоступна. Обновите; выполнение действия не предполагается.'],
  ar:['لا توجد إجراءات مدققة بعد.','سجل التدقيق غير متاح. حدّث للقراءة مجددًا؛ لا نفترض نجاح أي إجراء.'],
  id:['Belum ada tindakan yang diaudit.','Catatan audit tidak tersedia. Muat ulang; tidak ada tindakan yang diasumsikan.'],
};
for (const [language,[auditEmpty,auditUnavailable]] of Object.entries(auditReadCopy)) Object.assign(businessCopy[language],{auditEmpty,auditUnavailable});
function auditTimeValid(value) {
  if(typeof value!=='string')return false;
  const parts=/^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if(!parts||!Number.isFinite(Date.parse(value)))return false;
  const year=Number(parts[1]),month=Number(parts[2]),day=Number(parts[3]);
  return year>0&&month>=1&&month<=12&&day>=1&&day<=new Date(Date.UTC(year,month,0)).getUTCDate();
}
function renderAuditRecords(records) {
  const unavailable=`<li class="danger">${safe(t('auditUnavailable'))}</li>`;
  $('#audit-rows').innerHTML = !Array.isArray(records) ? unavailable : records.length===0 ? `<li>${safe(t('auditEmpty'))}</li>` : records.slice().reverse().map(a=>{
    if(!a||typeof a.Action!=='string'||!a.Action||typeof a.ObjectID!=='string'||!a.ObjectID||typeof a.Hash!=='string'||!/^[a-f0-9]{64}$/.test(a.Hash)||!auditTimeValid(a.CreatedAt))return unavailable;
    // This is source readback, not a claim of independently verifying the chain.
    return `<li><time>${localDate(a.CreatedAt)}</time><strong>${safe(a.Action)} · ${safe(a.ObjectID)}</strong><code title="${a.Hash}">${a.Hash.slice(0,16)}…</code></li>`;
  }).join('');
}
const researchResultStatus = document.createElement("p");
const paperRecoveryCopy={
  en:['Saved Paper request unreadable. Its outcome may be unknown. Refresh history before explicitly forgetting it; no new request is allowed.','Forget saved Paper request locally','Forget this saved Paper request on this browser? This does not cancel or delete a service order. A later submission is a separate order and may duplicate the earlier intent.','Saved Paper request forgotten locally; service records are unchanged.'],
  'zh-CN':['保存的模拟请求无法读取，结果可能未知。请刷新历史，再决定是否明确忘记；禁止新请求。','仅在本机忘记模拟请求','忘记此浏览器保存的模拟请求？这不会取消或删除服务订单。后续提交是独立订单，可能重复原意图。','本机已忘记模拟请求；服务记录不变。'],
  'zh-TW':['儲存的模擬請求無法讀取，結果可能未知。請重新整理歷史再決定是否忘記；禁止新請求。','僅在本機忘記模擬請求','忘記此瀏覽器儲存的模擬請求？不會取消或刪除服務訂單。後續提交是獨立訂單，可能重複原意圖。','本機已忘記模擬請求；服務紀錄不變。'],
  ja:['保存済みペーパー要求を読めません。結果は不明です。履歴を更新し、明示的に破棄するまで新規要求はできません。','保存済みペーパー要求をローカル破棄','このブラウザーの要求を破棄しますか？サービス注文は取消・削除されません。次の送信は別注文で、前の意図を重複する可能性があります。','ローカル要求を破棄しました。サービス記録は変更されません。'],
  ko:['저장된 모의 요청을 읽을 수 없습니다. 결과가 불명확할 수 있습니다. 기록을 새로 읽고 명시적으로 삭제하기 전에는 새 요청을 보낼 수 없습니다.','저장된 모의 요청만 로컬 삭제','이 브라우저의 요청을 삭제할까요? 서비스 주문은 취소되거나 삭제되지 않습니다. 다음 제출은 별도 주문이며 이전 의도를 중복할 수 있습니다.','로컬 요청 삭제 완료. 서비스 기록은 그대로입니다.'],
  es:['Solicitud simulada ilegible; el resultado puede ser desconocido. Actualice el historial antes de olvidarla explícitamente. No se permite otra solicitud.','Olvidar solicitud simulada local','¿Olvidar esta solicitud del navegador? No cancela ni borra la orden del servicio. El próximo envío será otra orden y podría duplicarla.','Solicitud local olvidada; registros del servicio intactos.'],
  fr:['Demande simulée illisible ; résultat peut-être inconnu. Actualisez l’historique avant de l’oublier explicitement. Nouvelle demande interdite.','Oublier la demande simulée locale','Oublier cette demande du navigateur ? Aucun ordre du service n’est annulé ou supprimé. Le prochain envoi sera distinct et peut faire doublon.','Demande locale oubliée ; registres du service inchangés.'],
  de:['Gespeicherte Paper-Anfrage unlesbar; Ergebnis möglicherweise unbekannt. Verlauf aktualisieren und ausdrücklich verwerfen. Keine neue Anfrage erlaubt.','Paper-Anfrage lokal verwerfen','Diese Browser-Anfrage verwerfen? Service-Aufträge bleiben bestehen. Ein späterer Auftrag ist separat und kann die ursprüngliche Absicht duplizieren.','Lokale Anfrage verworfen; Service-Daten unverändert.'],
  pt:['Solicitação simulada ilegível; resultado possivelmente desconhecido. Atualize o histórico antes de esquecê-la explicitamente. Nova solicitação bloqueada.','Esquecer solicitação simulada local','Esquecer esta solicitação do navegador? Não cancela nem apaga a ordem do serviço. O próximo envio será separado e poderá duplicá-la.','Solicitação local esquecida; registros do serviço intactos.'],
  ru:['Сохранённый запрос симуляции нечитаем; результат может быть неизвестен. Обновите историю перед явным удалением. Новый запрос запрещён.','Забыть локальный запрос симуляции','Забыть запрос в этом браузере? Ордер сервиса не отменяется и не удаляется. Следующий запрос создаст отдельный ордер и может повторить предыдущий.','Локальный запрос забыт; записи сервиса не изменены.'],
  ar:['تعذر قراءة طلب المحاكاة المحفوظ وقد تكون نتيجته مجهولة. حدّث السجل قبل نسيانه صراحةً؛ لا يُسمح بطلب جديد.','نسيان طلب المحاكاة محليًا','نسيان طلب هذا المتصفح؟ لا يلغي أو يحذف أمر الخدمة. الإرسال التالي أمر منفصل وقد يكرر الطلب السابق.','تم نسيان الطلب محليًا؛ سجلات الخدمة لم تتغير.'],
  id:['Permintaan simulasi tersimpan tidak terbaca; hasilnya mungkin belum diketahui. Muat ulang riwayat sebelum melupakannya secara eksplisit. Permintaan baru diblokir.','Lupakan permintaan simulasi lokal','Lupakan permintaan browser ini? Order layanan tidak dibatalkan atau dihapus. Pengiriman berikutnya terpisah dan dapat menduplikasi maksud sebelumnya.','Permintaan lokal dilupakan; catatan layanan tetap.']
};
for(const [language,values] of Object.entries(paperRecoveryCopy))Object.assign(businessCopy[language],Object.fromEntries(['paperPendingUnreadable','paperForget','paperForgetConfirm','paperForgotten'].map((key,index)=>[key,values[index]])));
const paperPendingStatus=document.createElement('p'),paperForgetButton=document.createElement('button');
paperPendingStatus.id='paper-pending-status';paperPendingStatus.role='status';
paperForgetButton.id='paper-forget-pending';paperForgetButton.type='button';
$('#paper-order').append(paperPendingStatus,paperForgetButton);
function renderPaperPendingState(){
  paperPendingStatus.hidden=!pendingPaperInvalid;paperPendingStatus.textContent=pendingPaperInvalid?t('paperPendingUnreadable'):'';
  paperForgetButton.hidden=!pendingPaperInvalid;paperForgetButton.disabled=paperSubmitting;paperForgetButton.textContent=t('paperForget');
}
paperForgetButton.onclick=()=>{
  if(paperSubmitting||!pendingPaperInvalid||!confirm(t('paperForgetConfirm')))return;
  try{
    localStorage.removeItem(paperPendingKey);
    if(localStorage.getItem(paperPendingKey)!==null)throw Error('STORAGE_READBACK_MISMATCH');
    pendingPaperInvalid=false;pendingPaperIntent=null;toast(t('paperForgotten'),'paperForgotten');renderPaperSubmitControl();
  }catch{workspaceStorageAvailable=false;statefulPreview=false;toast(t('workspaceStorageUnavailable'),'workspaceStorageUnavailable');renderPaperSubmitControl();}
};
const researchForgetButton = document.createElement('button');
researchForgetButton.type='button';researchForgetButton.id='research-forget-pending';
$('#backtest').append(researchForgetButton);
researchForgetButton.onclick=()=>{
  if(researchSubmitting || !confirm(t('researchForgetConfirm'))) return;
  try {
    localStorage.removeItem(researchPendingKey);
    if(localStorage.getItem(researchPendingKey)!==null) throw Error('STORAGE_READBACK_MISMATCH');
    pendingResearchIntent=null;pendingResearchInvalid=false;
    toast(t('researchForgotten'),'researchForgotten');renderResearchRequestState();
  } catch { workspaceStorageAvailable=false;statefulPreview=false;toast(t('workspaceStorageUnavailable'),'workspaceStorageUnavailable'); }
};
researchResultStatus.id = "research-result-status";
researchResultStatus.role = "status";
$("#latest-result").append(researchResultStatus);
function renderResearchStatus() {
  researchResultStatus.textContent = latestResearchMode === null ? "" : t(latestResearchMode ? "researchSaved" : "researchTemporary");
}
const workspaceReadCopy={
  en:'Workspace refresh unavailable. Shown records are the last confirmed read, not current. Use Refresh to read again; pending actions are retained.',
  'zh-CN':'工作区刷新不可用。显示的是上次确认记录，并非当前数据。请点击刷新重读；未确认操作已保留。',
  'zh-TW':'工作區重新整理失敗。顯示上次確認記錄，並非目前資料。請重新整理重讀；未確認操作已保留。',
  ja:'更新できません。表示は最後に確認した記録で、現在の状態ではありません。更新で再取得してください。未確認の操作は保持されています。',
  ko:'작업 공간을 새로 고칠 수 없습니다. 마지막 확인 기록이며 현재 상태가 아닙니다. 새로 고침으로 다시 읽으세요. 미확인 작업은 보존됩니다.',
  es:'No se puede actualizar. Se muestra la última lectura confirmada, no el estado actual. Pulsa Actualizar; las acciones pendientes se conservan.',
  fr:'Actualisation indisponible. Les données affichées sont la dernière lecture confirmée, pas l’état actuel. Actualisez ; les actions en attente sont conservées.',
  de:'Aktualisierung nicht verfügbar. Angezeigt wird der letzte bestätigte Stand, nicht der aktuelle. Erneut aktualisieren; offene Aktionen bleiben erhalten.',
  pt:'Atualização indisponível. Os registros são da última leitura confirmada, não do estado atual. Atualize novamente; ações pendentes são preservadas.',
  ru:'Обновление недоступно. Показаны последние подтверждённые записи, а не текущее состояние. Обновите снова; ожидающие действия сохранены.',
  ar:'تعذر التحديث. السجلات المعروضة هي آخر قراءة مؤكدة وليست الحالة الحالية. أعد التحديث؛ الإجراءات المعلقة محفوظة.',
  id:'Pembaruan tidak tersedia. Catatan adalah pembacaan terakhir yang terkonfirmasi, bukan keadaan terbaru. Muat ulang; tindakan tertunda tetap disimpan.'
};
for(const [language,workspaceReadUnavailable] of Object.entries(workspaceReadCopy))Object.assign(businessCopy[language],{workspaceReadUnavailable});
function renderWorkspaceReadStatus(){const element=$('#workspace-read-status');element.hidden=!workspaceReadUnavailable;element.textContent=workspaceReadUnavailable?t('workspaceReadUnavailable'):'';if(workspaceReadUnavailable)$$('.schedule-toggle[data-enabled="true"]').forEach(button=>{button.disabled=true});}
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
  renderPaperPendingState();
  $('#workspace-storage-boundary').hidden = workspaceStorageAvailable;
  $('#workspace-storage-boundary').textContent = t('workspaceStorageUnavailable');
  renderRiskControls();
  renderWorkspaceReadStatus();
  if (lastToastKey) $("#toast").textContent = t(lastToastKey) + lastToastSuffix;
}
// Product API transport only: no Wallet calls, automatic POST retry, or guessed
// success. The deadline includes response parsing; unknown writes retain intent.
const quantAPIErrorCopy={
  en:['The service rejected these inputs. Review the exact values before submitting again.','Access was rejected or expired. Refresh your workspace or authorization; a wallet connection alone does not grant this action.','The request conflicts with saved state. Refresh history and keep any pending exact request; no automatic retry occurred.','The service is unavailable or busy. The outcome is not confirmed. Refresh history before explicitly retrying a pending request.','The service returned an unrecognized failure. No success is confirmed. Refresh history; pending requests are retained.'],
  'zh-CN':['服务拒绝了输入。请检查精确数值后再提交。','权限被拒绝或已过期。请刷新工作区或授权；钱包连接不等于操作权限。','请求与已保存状态冲突。请刷新历史并保留原待处理请求；未自动重试。','服务不可用或繁忙，结果尚未确认。请刷新历史，再明确重试原请求。','服务返回未知失败，未确认成功。请刷新历史；待处理请求保留。'],
  'zh-TW':['服務拒絕輸入。請檢查精確數值後再提交。','權限被拒絕或已過期。請重新整理工作區或授權；錢包連線不等於操作權限。','請求與已儲存狀態衝突。請重新整理歷史並保留原待處理請求；未自動重試。','服務不可用或忙碌，結果未確認。請重新整理歷史再明確重試原請求。','服務回傳未知失敗，未確認成功。請重新整理歷史；待處理請求保留。'],
  ja:['サービスが入力を拒否しました。正確な値を確認して再送してください。','権限が拒否されたか期限切れです。ワークスペースや認可を更新してください。ウォレット接続だけでは許可されません。','保存状態と競合しています。履歴を更新し、未確認の元要求を保持してください。自動再送はありません。','サービスが利用不可または混雑しています。結果は未確認です。履歴を更新してから元要求を明示的に再送してください。','未知のサービスエラーです。成功は未確認です。履歴を更新してください。未確認要求は保持されています。'],
  ko:['서비스가 입력을 거부했습니다. 정확한 값을 검토한 후 다시 제출하세요.','권한이 거부되거나 만료되었습니다. 작업 공간이나 승인을 새로 확인하세요. 지갑 연결만으로는 권한이 없습니다.','저장된 상태와 충돌합니다. 기록을 새로 읽고 미확인 원본 요청을 유지하세요. 자동 재시도는 없습니다.','서비스가 불가하거나 혼잡합니다. 결과는 미확인입니다. 기록을 확인한 후 원본 요청을 명시적으로 재시도하세요.','알 수 없는 서비스 오류입니다. 성공이 확인되지 않았습니다. 기록을 새로 읽으세요. 미확인 요청은 유지됩니다.'],
  es:['El servicio rechazó los datos. Revise los valores exactos antes de reenviar.','Acceso rechazado o caducado. Actualice el espacio o la autorización; conectar una cartera no autoriza esta acción.','Conflicto con el estado guardado. Actualice el historial y conserve la solicitud pendiente exacta; no hubo reintento automático.','Servicio no disponible u ocupado. Resultado sin confirmar. Revise el historial antes de reintentar explícitamente la solicitud pendiente.','Fallo desconocido del servicio. No se confirma éxito. Actualice el historial; se conservan las solicitudes pendientes.'],
  fr:['Le service a refusé ces données. Vérifiez les valeurs exactes avant de renvoyer.','Accès refusé ou expiré. Actualisez l’espace ou l’autorisation ; une connexion au portefeuille ne suffit pas.','Conflit avec l’état enregistré. Actualisez l’historique et conservez la demande exacte en attente ; aucun renvoi automatique.','Service indisponible ou occupé. Résultat non confirmé. Consultez l’historique avant de réessayer explicitement la demande en attente.','Échec inconnu du service. Aucun succès confirmé. Actualisez l’historique ; les demandes en attente sont conservées.'],
  de:['Der Dienst hat die Eingaben abgelehnt. Prüfen Sie die genauen Werte vor erneutem Senden.','Zugriff abgelehnt oder abgelaufen. Arbeitsbereich oder Freigabe aktualisieren; Wallet-Verbindung allein berechtigt nicht.','Konflikt mit gespeichertem Zustand. Verlauf aktualisieren und genaue offene Anfrage behalten; kein automatischer Wiederholungsversuch.','Dienst nicht verfügbar oder ausgelastet. Ergebnis unbestätigt. Verlauf vor ausdrücklichem Wiederholen der offenen Anfrage prüfen.','Unbekannter Dienstfehler. Erfolg nicht bestätigt. Verlauf aktualisieren; offene Anfragen bleiben erhalten.'],
  pt:['O serviço rejeitou os dados. Revise os valores exatos antes de reenviar.','Acesso negado ou expirado. Atualize o espaço ou autorização; conectar a carteira não autoriza esta ação.','Conflito com o estado salvo. Atualize o histórico e preserve a solicitação pendente exata; sem repetição automática.','Serviço indisponível ou ocupado. Resultado não confirmado. Consulte o histórico antes de repetir explicitamente a solicitação pendente.','Falha desconhecida do serviço. Sucesso não confirmado. Atualize o histórico; solicitações pendentes preservadas.'],
  ru:['Сервис отклонил данные. Проверьте точные значения перед повторной отправкой.','Доступ отклонён или истёк. Обновите рабочую область или разрешение; подключение кошелька само по себе не даёт права.','Конфликт с сохранённым состоянием. Обновите историю и сохраните исходный ожидающий запрос; автоматического повтора нет.','Сервис недоступен или занят. Результат не подтверждён. Проверьте историю перед явным повтором ожидающего запроса.','Неизвестная ошибка сервиса. Успех не подтверждён. Обновите историю; ожидающие запросы сохранены.'],
  ar:['رفضت الخدمة المدخلات. راجع القيم الدقيقة قبل إعادة الإرسال.','رُفض الوصول أو انتهت صلاحيته. حدّث مساحة العمل أو التفويض؛ اتصال المحفظة وحده لا يمنح هذه الصلاحية.','تعارض مع الحالة المحفوظة. حدّث السجل واحتفظ بالطلب المعلق نفسه؛ لا إعادة تلقائية.','الخدمة غير متاحة أو مشغولة. النتيجة غير مؤكدة. راجع السجل قبل إعادة الطلب المعلق صراحةً.','فشل غير معروف من الخدمة. النجاح غير مؤكد. حدّث السجل؛ الطلبات المعلقة محفوظة.'],
  id:['Layanan menolak input. Periksa nilai tepat sebelum mengirim ulang.','Akses ditolak atau kedaluwarsa. Muat ulang ruang kerja atau izin; koneksi dompet saja tidak memberi kewenangan.','Konflik dengan status tersimpan. Muat ulang riwayat dan pertahankan permintaan tertunda yang sama; tidak ada pengulangan otomatis.','Layanan tidak tersedia atau sibuk. Hasil belum dikonfirmasi. Periksa riwayat sebelum mengulangi permintaan tertunda secara eksplisit.','Kegagalan layanan tidak dikenal. Keberhasilan belum dikonfirmasi. Muat ulang riwayat; permintaan tertunda dipertahankan.']
};
for(const [language,values] of Object.entries(quantAPIErrorCopy))Object.assign(businessCopy[language],Object.fromEntries(['apiInputsRejected','apiAccessRejected','apiStateConflict','apiServiceUnavailable','apiFailureUnknown'].map((key,index)=>[key,values[index]])));
function quantAPIErrorKey(status){return status===400||status===422?'apiInputsRejected':status===401||status===403?'apiAccessRejected':status===409?'apiStateConflict':status===408||status===429||status>=500?'apiServiceUnavailable':'apiFailureUnknown';}
async function quantResponseText(response,signal){
  const limit=8*1024*1024,invalid=()=>Object.assign(new Error('Invalid product API response'),{code:'QUANT_API_RESPONSE_INVALID',localeKey:'researchRequestUnconfirmed'});
  if(typeof response.body?.getReader!=='function'){
    // Legacy host/test adapters without a ReadableStream retain their bounded
    // text contract. Browser fetch Responses always take the streaming branch.
    const text=await response.text();if(new TextEncoder().encode(text).byteLength>limit)throw invalid();return text;
  }
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true}),parts=[];let bytes=0;
  const cancel=()=>{try{Promise.resolve(reader.cancel()).catch(()=>{})}catch{}};
  signal.addEventListener('abort',cancel,{once:true});
  try{
    while(true){
      if(signal.aborted)throw invalid();
      const {done,value}=await reader.read();if(done)break;
      if(!Number.isSafeInteger(value?.byteLength)||value.byteLength<0||value.byteLength>limit-bytes)throw invalid();
      bytes+=value.byteLength;parts.push(decoder.decode(value,{stream:true}));
    }
    parts.push(decoder.decode());return parts.join('');
  }catch{cancel();throw invalid();}
  finally{signal.removeEventListener('abort',cancel);try{reader.releaseLock()}catch{}}
}
async function quantHTTP(path, options, {fetchImpl = fetch, setTimer = setTimeout, clearTimer = clearTimeout} = {}) {
  const controller = new AbortController();
  let rejectDeadline;
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  const timeout = setTimer(() => {
    rejectDeadline(Object.assign(new Error('Request outcome is unconfirmed'), {code:'QUANT_API_TIMEOUT', localeKey:'researchRequestUnconfirmed'}));
    controller.abort();
  }, 30000);
  try {
    return await Promise.race([(async () => {
      const response = await fetchImpl('/api' + path, {...options, signal:controller.signal, credentials:'same-origin', redirect:'error', cache:'no-store'});
      if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '') || Number(response.headers.get('content-length')) > 8 * 1024 * 1024) throw Object.assign(new Error('Invalid product API response'), {code:'QUANT_API_RESPONSE_INVALID',localeKey:'researchRequestUnconfirmed'});
      const text = await quantResponseText(response,controller.signal);
      let body;try { body = JSON.parse(text); } catch { throw Object.assign(new Error('Invalid product API response'), {code:'QUANT_API_RESPONSE_INVALID',localeKey:'researchRequestUnconfirmed'}); }
      return {response,body};
    })(),deadline]);
  } finally { clearTimer(timeout);controller.abort(); }
}
const api = async (path, opt = {}) => {
  let result;
  try { result = await quantHTTP(path, {
    ...opt,
    headers: {
      "content-type": "application/json",
      ...(tenantId && workspaceStorageAvailable ? {"x-ynx-preview-mode": "local-paper", "x-ynx-tenant-id": tenantId} : {}),
      ...(opt.headers || {}),
    },
  }); } catch (error) {
    const key = error.localeKey || 'researchRequestUnconfirmed';
    throw Object.assign(new Error(t(key)), {code:error.code || 'QUANT_API_UNAVAILABLE',localeKey:key});
  }
  const {response:r,body:b} = result;
  if (!r.ok) {
    const researchError = r.status===400 && b?.error === "invalid_research_parameters" && /\/(?:backtests|research\/backtests|strategies\/[^/]+\/schedule)(?:\/|$)/.test(path);
    const dailyLossError = path === '/v1/paper/orders' && r.status === 403 && b?.error === 'paper_daily_loss_limit';
    const localeKey = dailyLossError ? 'paperDailyLossLead' : researchError ? 'researchInputInvalid' : quantAPIErrorKey(r.status);
    const knownStatus={invalid_request:400,invalid_json:400,single_json_value_required:400,forbidden:403,conflict:409,unavailable:503,request_cancelled:408};
    const code = dailyLossError ? 'paper_daily_loss_limit' : researchError ? 'invalid_research_parameters' : typeof b?.error==='string'&&Object.hasOwn(knownStatus,b.error)&&knownStatus[b.error]===r.status ? b.error : 'QUANT_API_REJECTED';
    throw Object.assign(new Error(t(localeKey)), {status: r.status, code, localeKey});
  }
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
  let next;
  try {
    next = await api("/v1/snapshot");
    if(revision!==snapshotRevision)return;
    const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
    if(!object(next)||['paper','strategies','experiments','access'].some(key=>next[key]!==undefined&&!object(next[key])))throw Object.assign(new Error(t('workspaceReadUnavailable')),{code:'QUANT_SNAPSHOT_INVALID',localeKey:'workspaceReadUnavailable'});
  } catch(error) {
    if(revision!==snapshotRevision)return;
    workspaceReadUnavailable=true;renderWorkspaceReadStatus();renderPaperSubmitControl();renderRiskControls();throw error;
  }
  if (revision !== snapshotRevision) return;
  snapshot = next;
  workspaceReadUnavailable=false;renderWorkspaceReadStatus();
  statefulPreview = workspaceStorageAvailable && snapshot.access?.statefulPreview === true;
  for (const id of scheduleUnconfirmed) if (Object.values(snapshot.strategies || {}).some(strategy => strategy?.ID === id && observedSchedule(strategy))) scheduleUnconfirmed.delete(id);
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
  return typeof strategy?.ID === "string" && !!strategy.ID && strategy.Family === "transparent" && typeof strategy.Name === "string" && !!strategy.Name.trim() && strategy.Name.length <= 80 && /^[a-f0-9]{64}$/.test(strategy.StrategyHash || "") && Number.isSafeInteger(strategy.Seed) && Number.isSafeInteger(strategy.Params?.fast) && strategy.Params.fast >= 2 && Number.isSafeInteger(strategy.Params?.slow) && strategy.Params.slow > strategy.Params.fast && Object.keys(strategy.Params).sort().join(",") === "fast,slow";
}
function researchSelectionKey(strategy) { return encodeURIComponent(strategy.ID) + ":" + strategy.StrategyHash; }
function readableSavedStrategy(strategy) {
  return !!strategy && !Array.isArray(strategy) && typeof strategy.ID==='string' && !!strategy.ID && typeof strategy.Name==='string' && !!strategy.Name.trim() && typeof strategy.StrategyHash==='string' && /^[a-f0-9]{64}$/.test(strategy.StrategyHash);
}
function paperStrategyHashAvailable(strategy) {
  return !!strategy && !Array.isArray(strategy) && typeof strategy.StrategyHash==='string' && /^[a-f0-9]{64}$/.test(strategy.StrategyHash);
}
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
  const available = strategies.filter(paperStrategyHashAvailable);
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
  renderPaperSubmitControl();
  if (pendingPaperIntent && !previous) {
    $("#side").value = pendingPaperIntent.Side;
    $("#paper-amount").value = String(pendingPaperIntent.Amount);
  }
  $("#paper-strategy-status").textContent = paperFreshIntentBlocked() ? t('killActive') : available.length ? "" : t("strategyMissing");
}
function researchAmount(attribution, key) {
  const value = attribution?.[key];
  // The existing research engine returns integer test micro-units. Missing,
  // incompatible or imprecisely decoded amounts cannot stand in for zero.
  return attribution?.currency === "YUSD_TEST_MICRO" && Number.isSafeInteger(value)
    ? `${value} YUSD_TEST_MICRO` : "—";
}
const executionReadCopy={
  en:['Execution record unavailable; no venue outcome is inferred.','Reserved request — outcome unknown; not a confirmed venue execution.','No Wallet-authorized Testnet execution yet.'],
  'zh-CN':['执行记录不可用；未推断交易场所结果。','请求已预留，结果未知；不是已确认的交易场所执行。','尚无钱包授权的测试网执行。'],
  'zh-TW':['執行紀錄無法讀取；未推定交易場所結果。','請求已預留，結果未知；不是已確認的交易場所執行。','尚無錢包授權的測試網執行。'],
  ja:['実行記録を確認できません。取引結果は推定しません。','リクエスト予約済み・結果不明。取引の実行は未確認です。','ウォレット承認済みTestnet実行はありません。'],
  ko:['실행 기록을 확인할 수 없습니다. 거래 결과를 추정하지 않습니다.','요청 예약됨 — 결과 미확인. 거래 실행이 확인되지 않았습니다.','지갑 승인 Testnet 실행이 없습니다.'],
  es:['Registro no disponible; no se supone ningún resultado.','Solicitud reservada; resultado desconocido, ejecución sin confirmar.','Aún no hay ejecución Testnet autorizada por Wallet.'],
  fr:['Exécution indisponible ; aucun résultat n’est déduit.','Demande réservée ; résultat inconnu, exécution non confirmée.','Aucune exécution Testnet autorisée par Wallet.'],
  de:['Ausführungsdatensatz fehlt; kein Ergebnis wird angenommen.','Anfrage reserviert — Ergebnis unbekannt, Ausführung unbestätigt.','Noch keine Wallet-autorisierte Testnet-Ausführung.'],
  pt:['Registro indisponível; nenhum resultado é presumido.','Pedido reservado; resultado desconhecido, execução não confirmada.','Nenhuma execução Testnet autorizada pela Wallet.'],
  ru:['Запись недоступна; результат не предполагается.','Запрос зарезервирован; результат неизвестен, исполнение не подтверждено.','Нет Testnet-исполнений с разрешением Wallet.'],
  ar:['سجل التنفيذ غير متاح؛ لا نفترض نتيجة للتداول.','طلب محجوز؛ النتيجة غير معروفة والتنفيذ غير مؤكد.','لا يوجد تنفيذ Testnet مصرح به من المحفظة.'],
  id:['Catatan tidak tersedia; hasil eksekusi tidak diasumsikan.','Permintaan dicadangkan; hasil belum diketahui, eksekusi belum dikonfirmasi.','Belum ada eksekusi Testnet yang diizinkan Wallet.']
};
for(const [language,[executionRecordsUnavailable,executionOutcomeUnknown,executionRecordsEmpty]] of Object.entries(executionReadCopy))Object.assign(businessCopy[language],{executionRecordsUnavailable,executionOutcomeUnknown,executionRecordsEmpty});
function renderTestnetExecutions(records){
  const unavailable=`<tr><td colspan="6">${safe(t('executionRecordsUnavailable'))}</td></tr>`;
  if(!records||typeof records!=='object'||Array.isArray(records)){$('#testnet-execution-rows').innerHTML=unavailable;return;}
  const rows=Object.values(records);
  $('#testnet-execution-rows').innerHTML=rows.length?rows.map(order=>{
    if(!order||typeof order!=='object'||!/^testnet-[0-9]+$/.test(order.id||'')||order.market!=='YNXT-YUSD_TEST'||!['buy','sell'].includes(order.side)||!Number.isSafeInteger(order.amount)||order.amount<=0)return unavailable;
    if(order.status==='reserved_outcome_unknown')return `<tr><td><code>${safe(order.id)}</code></td><td>${safe(order.market)}</td><td>${safe(order.side)}</td><td>${order.amount} YNXT_MICRO</td><td>${safe(t('executionOutcomeUnknown'))}</td><td>—</td></tr>`;
    if(order.status!=='submitted_testnet'||typeof order.venueOrderId!=='string'||!order.venueOrderId.trim()||!['open','partially_filled','filled'].includes(order.venueStatus)||typeof order.authorizationDigest!=='string'||!/^[a-f0-9]{64}$/i.test(order.authorizationDigest)||typeof order.brokerProof!=='string'||!order.brokerProof.trim())return unavailable;
    return `<tr><td><code>${safe(order.venueOrderId)}</code></td><td>${safe(order.market)}</td><td>${safe(order.side)}</td><td>${order.amount} YNXT_MICRO</td><td>${safe(order.venueStatus)}</td><td><code>${safe(order.authorizationDigest)}</code></td></tr>`;
  }).join(''):`<tr><td colspan="6">${safe(t('executionRecordsEmpty'))}</td></tr>`;
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
            if (!readableSavedStrategy(s)) return `<tr><td colspan="6" class="danger">${safe(t('scheduleUnknown'))}</td></tr>`;
            const runtime = observedSchedule(s), enabled = runtime?.enabled === true, pending = scheduleWrites.has(s.ID), unknown = !runtime || scheduleUnconfirmed.has(s.ID);
            const usable = typeof s.ID === "string" && s.ID.length > 0 && typeof s.StrategyHash === "string" && /^[a-f0-9]{64}$/.test(s.StrategyHash) && (enabled || s.Stage === "Backtest");
            return `<tr><td>${safe(s.Name)}</td><td>${safe(s.Family)}</td><td>${safe(s.Stage || "Draft")}</td><td><code>${safe((s.StrategyHash || "").slice(0, 12))}…</code></td><td>${safe(s.License)}</td><td><strong>${safe(pending ? t("schedulePending") : unknown ? t("scheduleUnknown") : scheduleStatusText(runtime))}</strong><small>${safe(t("scheduleObservation"))}</small><small>${runtime ? safe(scheduleTime(runtime.nextRunAt)) + " / " + safe(scheduleTime(runtime.lastRunAt)) : "— / —"}</small><small>${safe(runtime?.lastExperiment || "—")}</small><button type="button" class="schedule-toggle" data-strategy-id="${encodeURIComponent(typeof s.ID === "string" ? s.ID : "")}" data-strategy-hash="${/^[a-f0-9]{64}$/.test(s.StrategyHash || "") ? s.StrategyHash : ""}" data-enabled="${!enabled}" aria-busy="${pending}" ${statefulPreview && usable && !unknown && !pending ? "" : "disabled"}>${safe(enabled ? t("scheduleStop") : t("scheduleStart"))}</button></td></tr>`;
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
`<h3>${safe(t("paperWorkspace"))}</h3><dl><div><dt>${safe(t("paperCash"))}</dt><dd>${paperObservedInteger(p.Cash)}</dd></div><div><dt>${safe(t("paperPosition"))}</dt><dd>${paperObservedInteger(p.Position)}</dd></div><div><dt>${safe(t("paperReconciliation"))}</dt><dd>${paperObservedInteger(p.ReconciliationDelta, true)}</dd></div><div><dt>${safe(t("paperKill"))}</dt><dd class="${p.KillSwitch === true ? "danger" : ""}">${p.KillSwitch === true ? safe(t("riskActive")) : p.KillSwitch === false ? safe(t("riskArmed")) : "—"}</dd></div></dl>`;
  const daily = p.DailyRisk;
  const validDaily = daily?.Policy === 'utc_first_mark_equity_loss_micro_v1' && /^\d{4}-\d{2}-\d{2}$/.test(daily.Day) && Number.isSafeInteger(daily.Loss) && daily.Loss >= 0 && Number.isSafeInteger(daily.Limit) && daily.Limit > 0 && typeof daily.Breached === 'boolean';
  $('#paper-state').innerHTML += `<p>${safe(t('paperDailyLossLead'))}</p><dl><dt>${safe(t('paperDailyLoss'))}</dt><dd>${validDaily ? safe(`${daily.Day} UTC · ${daily.Loss} / ${daily.Limit} YUSD_TEST_MICRO · ${daily.Breached ? t('riskActive') : t('riskArmed')}`) : '—'}</dd></dl>`;
  renderAuditRecords(snapshot.audit);
  const firstReadableStrategy = strategies.find(readableSavedStrategy);
  if (!$("#mandate-strategy").value && firstReadableStrategy) {
    $("#mandate-strategy").value = firstReadableStrategy.StrategyHash;
  }
  renderTestnetExecutions(Object.hasOwn(snapshot,'testnetOrders')?snapshot.testnetOrders:{});
  renderWorkspaceReadStatus();
}
$("#strategy-rows").addEventListener("click", async event => {
  const button = event.target.closest(".schedule-toggle");
  if (!button || !statefulPreview || button.disabled) return;
  const id = decodeURIComponent(button.dataset.strategyId);
  if (scheduleWrites.has(id) || scheduleUnconfirmed.has(id)) return;
  const enabled = button.dataset.enabled === "true";
  if (enabled && workspaceReadUnavailable) { toast(t('workspaceReadUnavailable'),'workspaceReadUnavailable');return; }
  const strategy = Object.values(snapshot.strategies || {}).find(value => value?.ID === id), runtime = observedSchedule(strategy);
  if (!runtime || strategy.StrategyHash !== button.dataset.strategyHash || runtime.enabled === enabled || enabled && strategy.Stage !== "Backtest") return;
  let sent = false;
  try {
    const assumptions = enabled ? {feeBPS:researchIntegerInput("fee"), slippageBPS:researchIntegerInput("slippage"), latencyBars:1, participationBPS:1000, seed:researchIntegerInput("seed"), trainEnd:24, walkForwardWindows:3} : {};
    if (enabled && (!Number.isSafeInteger(assumptions.feeBPS) || assumptions.feeBPS < 0 || !Number.isSafeInteger(assumptions.slippageBPS) || assumptions.slippageBPS < 0 || !Number.isSafeInteger(assumptions.seed))) throw Error(t("scheduleInvalid"));
    if (!confirm(`${t(enabled ? "scheduleConfirmStart" : "scheduleConfirmStop")}\n${id}\n${strategy.StrategyHash}${enabled ? `\n${t("runFee")}: ${assumptions.feeBPS}\n${t("runSlippage")}: ${assumptions.slippageBPS}\n${t("runSeed")}: ${assumptions.seed}` : ""}`)) return;
    const current = Object.values(snapshot.strategies || {}).find(value => value?.ID === id);
    if (!statefulPreview || enabled && workspaceReadUnavailable || current?.StrategyHash !== strategy.StrategyHash || observedSchedule(current)?.enabled !== runtime.enabled || enabled && (current.Stage !== "Backtest" || researchIntegerInput("fee") !== assumptions.feeBPS || researchIntegerInput("slippage") !== assumptions.slippageBPS || researchIntegerInput("seed") !== assumptions.seed)) throw Error(t("scheduleInvalid"));
    scheduleWrites.add(id); snapshotRevision++; render(); sent = true;
    const receipt = await api(`/v1/strategies/${encodeURIComponent(id)}/schedule`, {method: "PUT", body: JSON.stringify({enabled, intervalSeconds: enabled ? 60 : 0, assumptions})});
    const confirmed = observedSchedule(receipt);
    if (receipt?.ID !== id || receipt.StrategyHash !== strategy.StrategyHash || receipt.Stage !== strategy.Stage || !confirmed || confirmed.enabled !== enabled || confirmed.running || confirmed.lastRunStatus !== (enabled ? "scheduled" : "stopped_by_user") || enabled && (confirmed.intervalSeconds !== 60 || Object.entries(assumptions).some(([key,value]) => confirmed.assumptions?.[key[0].toUpperCase()+key.slice(1)] !== value))) throw Error(t("scheduleUnknown"));
    const savedKey = Object.keys(snapshot.strategies).find(key => snapshot.strategies[key]?.ID === id && snapshot.strategies[key]?.StrategyHash === strategy.StrategyHash);
    if (!savedKey) throw Error(t("scheduleUnknown"));
    snapshotRevision++;
    snapshot.strategies = {...snapshot.strategies, [savedKey]:receipt};
    render();toast(t(enabled ? "scheduleConfigured" : "scheduleStopped"), enabled ? "scheduleConfigured" : "scheduleStopped");
    await refresh();
  } catch (error) {
    if (sent) { snapshotRevision++; scheduleUnconfirmed.add(id); }
    const key=error.localeKey==='researchInputInvalid'?'researchInputInvalid':sent?'scheduleUnknown':'scheduleInvalid';
    toast(t(key),key);
  }
  finally { scheduleWrites.delete(id); render(); }
});
function renderRunDetails() {
  const result = latestResearchResult, strategy = result?.strategy;
  $("#research-cost-rounding").textContent = researchCostRoundingText(result);
  $('#research-idle-cash').textContent = researchAmount(result?.attribution,'averageIdleCapital');
  $('#research-idle-cash-rule').textContent = researchIdleCashRule(result);
  $("#research-source").textContent = typeof strategy?.Source === "string" && strategy.Source.trim() ? strategy.Source : "—";
  for (const [id, key] of [["data", "DataHash"], ["strategy", "StrategyHash"]]) $("#research-" + id + "-hash").textContent = /^[0-9a-f]{64}$/i.test(strategy?.[key] || "") ? strategy[key] : "—";
  for (const [id, key] of [["fee", "FeeBPS"], ["slippage", "SlippageBPS"], ["latency", "LatencyBars"], ["participation", "ParticipationBPS"], ["training", "TrainEnd"], ["windows", "WalkForwardWindows"], ["seed", "Seed"]]) $("#research-" + id).textContent = Number.isSafeInteger(result?.assumptions?.[key]) ? String(result.assumptions[key]) : "—";
  const definitions = $("#research-metric-definitions");
  definitions.replaceChildren();
  for (const [key, label] of [["returnBPS", "runReturn"], ["buyHoldBPS", "runBuyHold"], ["maxDrawdownBPS", "runDrawdown"], ["sharpeMilli", "runSharpe"], ["volatilityBPS", "runVolatility"]]) {
    const row = document.createElement("div"), term = document.createElement("dt"), description = document.createElement("dd");
    term.textContent = t(label);
    description.textContent = researchMetricDefinition(result, key);
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
function researchRequestMatches(result, submitted) {
  // Check the immutable submitted parameters, not the user's next edited draft.
  // Source/data hashes are computed by the existing market-backed engine; this
  // check is a response consistency fence, not proof of engine/data authenticity.
  return verifiedResearchResult(result) && result.status === "completed_oos" &&
    (submitted.idempotencyKey === undefined || result.researchRequestKey === submitted.idempotencyKey) &&
    result.strategy.ID === submitted.strategy.id &&
    result.strategy.Name === submitted.strategy.name &&
    result.strategy.Family === submitted.strategy.family && result.strategy.Seed === submitted.strategy.seed &&
    result.strategy.Params && Object.keys(result.strategy.Params).sort().join(",") === "fast,slow" &&
    ["fast","slow"].every(key => result.strategy.Params[key] === submitted.strategy.params[key]) &&
    Object.entries(submitted.assumptions).every(([key,value]) => result.assumptions?.[key[0].toUpperCase()+key.slice(1)] === value);
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
  const times = Array.isArray(points) ? points.map(point => typeof point?.time === "string" ? Date.parse(point.time) : NaN) : [];
  const valid = Array.isArray(points) && points.length > 1 && points.length <= 10000 && points.every((point,index) => point && Number.isSafeInteger(point.equity) && Number.isSafeInteger(point.benchmarkEquity) && point.equity >= 0 && point.benchmarkEquity >= 0 && Number.isFinite(times[index]) && (index === 0 || times[index] > times[index - 1]));
  $("#equity-figure").hidden = !valid;
  if (!valid) { $("#equity-chart").innerHTML = ""; return; }
  const values = points.flatMap(point => [point.equity, point.benchmarkEquity]);
  const low = Math.min(...values), span = Math.max(1, Math.max(...values) - low);
  // Preserve actual observation gaps; never invent a uniform sampling cadence.
  const duration = times.at(-1) - times[0];
  const line = key => points.map((point,index) => `${(12 + (times[index] - times[0]) * 696 / duration).toFixed(2)},${(208 - (point[key] - low) * 196 / span).toFixed(2)}`).join(" ");
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
$("#paper-strategy").onchange = renderPaperSubmitControl;
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
const researchInputCopy = {
  en:"Enter a strategy name (1–80 characters) and safe whole-number parameters. Fast window must be at least 2 and smaller than slow; fees and slippage must be explicit and nonnegative.",
  "zh-CN":"请输入 1–80 字符的策略名称和可精确表示的整数参数。快窗口至少为 2 且小于慢窗口；费用与滑点须明确填写非负值。",
  "zh-TW":"請輸入 1–80 字元的策略名稱及可精確表示的整數參數。快視窗至少為 2 且小於慢視窗；費用與滑點須明確填寫非負值。",
  ja:"戦略名（1～80文字）と正確に表せる整数を入力してください。短期窓は2以上で長期窓未満、手数料とスリッページは明示的な非負値が必要です。",
  ko:"전략 이름(1~80자)과 정확히 표현 가능한 정수를 입력하세요. 빠른 구간은 2 이상이며 느린 구간보다 작아야 하고, 수수료와 슬리피지는 명시적 음이 아닌 값이어야 합니다.",
  es:"Introduzca un nombre de estrategia (1–80 caracteres) y enteros seguros. La ventana rápida debe ser al menos 2 y menor que la lenta; comisiones y deslizamiento deben ser explícitos y no negativos.",
  fr:"Saisissez un nom de stratégie (1–80 caractères) et des entiers exacts. La fenêtre rapide doit être au moins 2 et inférieure à la lente ; frais et glissement doivent être explicites et positifs ou nuls.",
  de:"Strategiename (1–80 Zeichen) und sichere Ganzzahlen eingeben. Das schnelle Fenster muss mindestens 2 und kleiner als das langsame sein; Gebühren und Slippage müssen ausdrücklich nichtnegativ sein.",
  pt:"Insira um nome de estratégia (1–80 caracteres) e inteiros seguros. A janela rápida deve ser pelo menos 2 e menor que a lenta; taxas e slippage devem ser explícitos e não negativos.",
  ru:"Введите название стратегии (1–80 символов) и точно представимые целые параметры. Быстрое окно — от 2 и меньше медленного; комиссии и проскальзывание задаются явно и неотрицательно.",
  ar:"أدخل اسم استراتيجية من 1 إلى 80 حرفًا ومعلمات صحيحة قابلة للتمثيل بدقة. النافذة السريعة لا تقل عن 2 وأصغر من البطيئة؛ يجب إدخال الرسوم والانزلاق صراحة بقيم غير سالبة.",
  id:"Masukkan nama strategi (1–80 karakter) dan bilangan bulat aman. Jendela cepat minimal 2 dan lebih kecil dari jendela lambat; biaya dan slippage harus diisi eksplisit dengan nilai nonnegatif."
};
for (const [language,researchInputInvalid] of Object.entries(researchInputCopy)) Object.assign(businessCopy[language],{researchInputInvalid});
const researchRecoveryCopy = {
  en:['Request outcome is unconfirmed. Refresh saved history; retry the same saved inputs without creating another request.','A previous research request is unconfirmed. Restore its original inputs before retrying.','Forget pending request locally','Forget this pending research request on this browser? The service may already have saved it. This does not cancel or delete server research; a later submission is a separate run.','Pending request forgotten locally. Server records are unchanged.'],
  'zh-CN':['请求结果未确认。请刷新已保存历史，并用原有输入重试，不要另建请求。','上次研究请求未确认。重试前请恢复原有输入。','仅在本地忘记待确认请求','要在此浏览器忘记待确认研究请求吗？服务端可能已保存。这不会取消或删除服务端研究；以后提交属于另一运行。','已在本地忘记请求，服务端记录未更改。'],
  'zh-TW':['請求結果未確認。請重新整理已儲存歷史，並用原有輸入重試，不要另建請求。','上次研究請求未確認。重試前請還原原有輸入。','僅在本機忘記待確認請求','要在此瀏覽器忘記待確認研究請求嗎？服務端可能已儲存。這不會取消或刪除服務端研究；以後提交屬於另一執行。','已在本機忘記請求，服務端紀錄未更改。'],
  ja:['リクエスト結果は未確認です。保存履歴を更新し、新規リクエストを作らず元の入力で再試行してください。','前の研究リクエストは未確認です。再試行前に元の入力を復元してください。','保留リクエストを端末だけで破棄','このブラウザの保留研究リクエストを破棄しますか？サーバーには保存済みかもしれません。サーバーの研究は取消・削除されず、次の送信は別の実行になります。','端末の保留リクエストを破棄しました。サーバー記録は未変更です。'],
  ko:['요청 결과가 확인되지 않았습니다. 저장된 기록을 새로 고치고 새 요청 없이 원래 입력으로 재시도하세요.','이전 연구 요청이 확인되지 않았습니다. 재시도 전에 원래 입력을 복원하세요.','이 브라우저의 대기 요청 삭제','이 브라우저의 대기 연구 요청을 지울까요? 서버에 이미 저장되었을 수 있습니다. 서버 연구는 취소되거나 삭제되지 않으며 다음 제출은 별도 실행입니다.','브라우저의 대기 요청을 지웠습니다. 서버 기록은 변경되지 않았습니다.'],
  es:['Resultado no confirmado. Actualice el historial y reintente las mismas entradas guardadas sin crear otra solicitud.','La investigación anterior no está confirmada. Restaure sus entradas antes de reintentar.','Olvidar solicitud solo aquí','¿Olvidar esta solicitud en este navegador? El servicio puede haberla guardado. No cancela ni borra la investigación del servidor; el siguiente envío será otra ejecución.','Solicitud olvidada localmente. Los registros del servidor no cambiaron.'],
  fr:['Résultat non confirmé. Actualisez l’historique et réessayez les mêmes données sauvegardées sans nouvelle demande.','La recherche précédente est non confirmée. Rétablissez ses données avant de réessayer.','Oublier la demande localement','Oublier cette demande dans ce navigateur ? Le service peut déjà l’avoir sauvegardée. Cela n’annule ni ne supprime la recherche serveur ; le prochain envoi sera distinct.','Demande oubliée localement. Les données serveur sont inchangées.'],
  de:['Ergebnis unbestätigt. Gespeicherten Verlauf aktualisieren und dieselben Eingaben ohne neue Anfrage erneut senden.','Die frühere Forschungsanfrage ist unbestätigt. Vor erneutem Senden ursprüngliche Eingaben wiederherstellen.','Anfrage nur lokal vergessen','Diese Anfrage in diesem Browser vergessen? Der Dienst könnte sie bereits gespeichert haben. Server-Forschung wird nicht gelöscht oder abgebrochen; die nächste Einsendung ist ein anderer Lauf.','Anfrage lokal vergessen. Serverdaten bleiben unverändert.'],
  pt:['Resultado não confirmado. Atualize o histórico e repita os mesmos dados salvos sem criar outro pedido.','A pesquisa anterior não foi confirmada. Restaure os dados originais antes de repetir.','Esquecer pedido apenas aqui','Esquecer este pedido neste navegador? O serviço pode já tê-lo salvo. Isso não cancela nem apaga a pesquisa no servidor; o próximo envio será outra execução.','Pedido esquecido localmente. Registros do servidor não mudaram.'],
  ru:['Результат не подтверждён. Обновите историю и повторите те же сохранённые данные без нового запроса.','Предыдущий запрос исследования не подтверждён. Восстановите исходные данные перед повтором.','Забыть запрос только локально','Забыть запрос в этом браузере? Сервис мог его сохранить. Это не отменяет и не удаляет исследование на сервере; следующая отправка — новый запуск.','Запрос забыт локально. Серверные записи не изменены.'],
  ar:['نتيجة الطلب غير مؤكدة. حدّث السجل وأعد المحاولة بالمدخلات المحفوظة نفسها دون إنشاء طلب جديد.','طلب البحث السابق غير مؤكد. استعد مدخلاته الأصلية قبل إعادة المحاولة.','نسيان الطلب محليًا فقط','هل تريد نسيان الطلب في هذا المتصفح؟ قد يكون الخادم حفظه بالفعل. لا يُلغى البحث ولا يُحذف من الخادم؛ الإرسال التالي تشغيل مستقل.','نُسي الطلب محليًا. سجلات الخادم لم تتغير.'],
  id:['Hasil belum terkonfirmasi. Segarkan riwayat dan ulangi masukan tersimpan yang sama tanpa membuat permintaan baru.','Permintaan riset sebelumnya belum terkonfirmasi. Pulihkan masukan awal sebelum mencoba lagi.','Lupakan permintaan hanya lokal','Lupakan permintaan di browser ini? Layanan mungkin telah menyimpannya. Riset server tidak dibatalkan atau dihapus; pengiriman berikutnya adalah proses terpisah.','Permintaan dilupakan secara lokal. Catatan server tidak berubah.'],
};
for(const [language,[researchRequestUnconfirmed,researchPendingMismatch,researchForget,researchForgetConfirm,researchForgotten]] of Object.entries(researchRecoveryCopy))Object.assign(businessCopy[language],{researchRequestUnconfirmed,researchPendingMismatch,researchForget,researchForgetConfirm,researchForgotten});
function researchIntegerInput(id) {
  const raw = $("#" + id).value;
  if (typeof raw !== "string" || !raw.trim() || !Number.isSafeInteger(Number(raw))) throw Error(t("researchInputInvalid"));
  return Number(raw);
}
function researchDraftInputs() {
  const name = $("#strategy").value;
  const values = {};
  for (const id of ["seed","fast","slow","fee","slippage"]) {
    values[id] = researchIntegerInput(id);
  }
  if (!name.trim() || name.length > 80 || values.fast < 2 || values.slow <= values.fast || values.fee < 0 || values.slippage < 0) throw Error(t("researchInputInvalid"));
  return {name,...values};
}
$("#backtest").onsubmit = async (e) => {
  e.preventDefault();
  if (researchSubmitting) return;
  researchSubmitting = true;
  renderResearchChoices(Object.values(snapshot.strategies || {}));
  renderResearchRequestState();
  const savedWorkspace = statefulPreview;
  try {
    const draft = researchDraftInputs();
    let body = {
      strategy: {
        id: "ma-" + crypto.randomUUID(),
        name: draft.name,
        family: "transparent",
        source: "quant://user/ma",
        sourceCommit: "local",
        license: "Apache-2.0",
        seed: draft.seed,
        params: { fast: draft.fast, slow: draft.slow },
        limitations: t("historyWarning"),
      },
      assumptions: {
        feeBPS: draft.fee,
        slippageBPS: draft.slippage,
        latencyBars: 1,
        participationBPS: 1000,
        seed: draft.seed,
        trainEnd: 24,
        walkForwardWindows: 3,
      },
    };
    if(pendingResearchInvalid || (pendingResearchIntent && !savedWorkspace)) throw Object.assign(Error(t('researchRequestUnconfirmed')),{localeKey:'researchRequestUnconfirmed'});
    if(savedWorkspace){
      if(pendingResearchIntent){
        const prior=pendingResearchIntent;
        if(prior.strategy.name!==draft.name || prior.strategy.seed!==draft.seed || prior.strategy.params.fast!==draft.fast || prior.strategy.params.slow!==draft.slow || prior.assumptions.feeBPS!==draft.fee || prior.assumptions.slippageBPS!==draft.slippage) throw Object.assign(Error(t('researchPendingMismatch')),{localeKey:'researchPendingMismatch'});
        body=prior;
      }else{
        body.idempotencyKey='quant-research-'+crypto.randomUUID();
        pendingResearchIntent=body;
        persistWorkspaceValue(researchPendingKey,JSON.stringify(body));
      }
    }
    const result = await api(savedWorkspace ? "/v1/backtests/from-market" : "/v1/public/research/backtests/from-market", { method: "POST", body: JSON.stringify(body) });
    if (!researchRequestMatches(result, body)) throw Error(t("researchInvalid"));
    if(savedWorkspace){
      try{
        localStorage.removeItem(researchPendingKey);
        if(localStorage.getItem(researchPendingKey)!==null)throw Error('STORAGE_READBACK_MISMATCH');
        pendingResearchIntent=null;
      }catch{workspaceStorageAvailable=false;statefulPreview=false;}
    }
    renderResult(result, savedWorkspace);
    const resultMessage = savedWorkspace ? "researchSaved" : "researchTemporary";
    toast(t(resultMessage), resultMessage);
    if (savedWorkspace) await refresh();
    else { publicExperiments[result.id] = result; render(); }
  } catch (e) {
    if(e.code!=='QUANT_API_REJECTED'&&e.status>=400&&e.status<500&&![408,409,429].includes(e.status)){
      try{localStorage.removeItem(researchPendingKey);if(localStorage.getItem(researchPendingKey)!==null)throw Error('STORAGE_READBACK_MISMATCH');pendingResearchIntent=null;}catch{workspaceStorageAvailable=false;statefulPreview=false;}
    }
    toast(e.message, e.localeKey ?? null);
  } finally {
    researchSubmitting = false;
    renderResearchChoices(Object.values(snapshot.strategies || {}));
    renderResearchRequestState();
  }
};
function renderResearchRequestState() {
  $('#research-submit').disabled = researchSubmitting;
  $('#backtest').ariaBusy = String(researchSubmitting);
  $('#research-request-status').hidden = !researchSubmitting && !pendingResearchIntent && !pendingResearchInvalid;
  $('#research-request-status').textContent = researchSubmitting ? t('researchRequestPending') : pendingResearchIntent || pendingResearchInvalid ? t('researchRequestUnconfirmed') : '';
  researchForgetButton.hidden=!pendingResearchIntent&&!pendingResearchInvalid;
  researchForgetButton.disabled=researchSubmitting;
  researchForgetButton.textContent=t('researchForget');
}
$("#paper-order").onsubmit = async (e) => {
  e.preventDefault();
  if (paperSubmitting || !statefulPreview) return;
  try {
    if (paperFreshIntentBlocked()) { const key=paperFreshIntentBlockKey();throw Object.assign(Error(t(key)),{localeKey:key}); }
    const strategyHash = $("#paper-strategy").value;
    if (!Object.values(snapshot.strategies || {}).some(strategy => paperStrategyHashAvailable(strategy) && strategy.StrategyHash === strategyHash) || !/^[0-9a-f]{64}$/.test(strategyHash)) throw new Error(t("strategyMissing"));
    const Side = $("#side").value, Amount = +$("#paper-amount").value;
    if (!["buy", "sell"].includes(Side) || !Number.isSafeInteger(Amount) || Amount <= 0) throw new Error(t("paperInvalidAmount"));
    const sameIntent = pendingPaperIntent?.StrategyHash === strategyHash && pendingPaperIntent.Side === Side && pendingPaperIntent.Amount === Amount;
    if (pendingPaperIntent && !sameIntent) throw new Error(t("paperPendingMismatch"));
    paperSubmitting = true;
    $("#paper-submit").disabled = true;
    if (!confirm(`${t("paperConfirm")}\n\nYNXT-YUSD_TEST\n${t("strategy")}: ${strategyHash}\n${t("paperRecordStatus")}: ${Side}\n${t("paperRecordAmounts")}: ${Amount}\n\n${t("paperExecutionBoundary")}`)) return;
    if (paperFreshIntentBlocked()) { const key=paperFreshIntentBlockKey();throw Object.assign(Error(t(key)),{localeKey:key}); }
    if (!statefulPreview || $("#paper-strategy").value !== strategyHash || $("#side").value !== Side || +$("#paper-amount").value !== Amount || !Object.values(snapshot.strategies || {}).some(strategy => paperStrategyHashAvailable(strategy) && strategy.StrategyHash === strategyHash)) throw new Error(t("paperPreviewChanged"));
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
    if (e.code !== 'QUANT_API_REJECTED' && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 409 && e.status !== 429) {
      pendingPaperIntent = null;
      try { localStorage.removeItem(paperPendingKey); } catch { workspaceStorageAvailable = false; statefulPreview = false; }
    }
    if(e.code === 'paper_daily_loss_limit') { try { await refresh(); } catch { /* Keep the precise rejection; no automatic order retry. */ } }
    toast(e.message,e.localeKey ?? null);
  } finally {
    paperSubmitting = false;
    $('#workspace-storage-boundary').hidden = workspaceStorageAvailable;
    $('#workspace-storage-boundary').textContent = t('workspaceStorageUnavailable');
    renderRiskControls();
    renderPaperSubmitControl();
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
  for(const id of ['reconcile','kill']) { const button=$('#'+id); button.disabled=!statefulPreview||riskWrites.size>0||(id==='reconcile'&&workspaceReadUnavailable); button.ariaBusy=String(riskWrites.has(id)); }
}
const reconciliationConfirmationCopy = {
  en: 'Confirm Paper reconciliation with the exact observed amounts below. A difference activates the persistent kill switch. Local simulation only; no wallet signature, chain transaction or network fee.',
  'zh-CN': '确认使用下列精确观测金额对账。差异将启用持久化紧急停止。仅本地模拟，不产生钱包签名、链上交易或网络费用。',
  'zh-TW': '確認使用下列精確觀測金額對帳。差異將啟用持久化緊急停止。僅本地模擬，不產生錢包簽名、鏈上交易或網路費用。',
  ja: '下記の正確な観測値で模擬状態を照合します。差異は永続的な緊急停止を有効にします。ローカルシミュレーションのみで、署名・オンチェーン取引・ネットワーク手数料はありません。',
  ko: '아래의 정확한 관측 금액으로 모의 상태를 조정합니다. 차이가 있으면 영구 비상 중지가 활성화됩니다. 로컬 시뮬레이션만 수행하며 서명, 온체인 거래, 네트워크 수수료는 없습니다.',
  es: 'Confirme la conciliación simulada con los importes exactos observados abajo. Una diferencia activa la parada persistente. Solo simulación local: sin firma, transacción en cadena ni comisión de red.',
  fr: 'Confirmez le rapprochement simulé avec les montants exacts observés ci-dessous. Un écart active l’arrêt persistant. Simulation locale uniquement : aucune signature, transaction sur chaîne ou commission réseau.',
  de: 'Paper-Abgleich mit den unten angezeigten exakten Werten bestätigen. Eine Abweichung aktiviert den dauerhaften Notstopp. Nur lokale Simulation: keine Signatur, Blockchain-Transaktion oder Netzwerkgebühr.',
  pt: 'Confirme a reconciliação simulada com os valores exatos observados abaixo. Uma diferença ativa a parada persistente. Apenas simulação local: sem assinatura, transação em cadeia ou taxa de rede.',
  ru: 'Подтвердите сверку симуляции с точными наблюдаемыми суммами ниже. Разница включает постоянную аварийную остановку. Только локальная симуляция: без подписи, транзакции в сети и сетевой комиссии.',
  ar: 'أكد مطابقة المحاكاة بالقيم المرصودة الدقيقة أدناه. أي فرق يفعّل الإيقاف الدائم. محاكاة محلية فقط، دون توقيع محفظة أو معاملة على الشبكة أو رسوم شبكة.',
  id: 'Konfirmasi rekonsiliasi simulasi dengan jumlah teramati yang tepat di bawah. Selisih mengaktifkan penghentian persisten. Hanya simulasi lokal: tanpa tanda tangan, transaksi on-chain, atau biaya jaringan.',
};
for (const [language, confirmReconciliation] of Object.entries(reconciliationConfirmationCopy)) Object.assign(businessCopy[language], {confirmReconciliation});
function confirmedRiskReceipt(value) {
  if(!value||!Number.isSafeInteger(value.Cash)||!Number.isSafeInteger(value.Position)||!Number.isSafeInteger(value.ReconciliationDelta)||value.ReconciliationDelta<0||typeof value.KillSwitch!=='boolean'||value.ReconciliationDelta>0&&!value.KillSwitch) throw Object.assign(new Error(t('riskReceiptUnconfirmed')), {localeKey:'riskReceiptUnconfirmed'});
  return value;
}
function paperObservedInteger(value, nonnegative = false) {
  return Number.isSafeInteger(value) && (!nonnegative || value >= 0) ? String(value) : '—';
}
function applyConfirmedRiskReceipt(receipt) {
  // A confirmed write is newer than reads admitted before its completion.
  // Keep that source receipt even if the subsequent snapshot transport fails.
  snapshotRevision++;
  snapshot.paper = receipt;
  render();
}
$("#reconcile").onclick = async () => {
  if (!statefulPreview || riskWrites.size>0) return;
  if (workspaceReadUnavailable) { toast(t('workspaceReadUnavailable'),'workspaceReadUnavailable');return; }
  let ownsRiskLane=false;
  try {
    if (!Number.isSafeInteger(snapshot.paper?.Cash) || !Number.isSafeInteger(snapshot.paper?.Position)) throw Object.assign(Error(t('riskReceiptUnconfirmed')),{localeKey:'riskReceiptUnconfirmed'});
    const observed={Cash:snapshot.paper.Cash,Position:snapshot.paper.Position},revision=snapshotRevision;
    if (!confirm(`${t('confirmReconciliation')}\n${t('paperCash')}: ${observed.Cash}\n${t('paperPosition')}: ${observed.Position}`)) return;
    if (!statefulPreview || workspaceReadUnavailable || riskWrites.size>0 || revision!==snapshotRevision || snapshot.paper?.Cash!==observed.Cash || snapshot.paper?.Position!==observed.Position) throw Object.assign(Error(t('riskReceiptUnconfirmed')),{localeKey:'riskReceiptUnconfirmed'});
    riskWrites.add('reconcile');ownsRiskLane=true;snapshotRevision++;renderRiskControls();
    const receipt=confirmedRiskReceipt(await api("/v1/paper/reconcile", {
      method: "POST",
      body: JSON.stringify(observed),
    }));
    applyConfirmedRiskReceipt(receipt);
    if(receipt.ReconciliationDelta===0) toast(t('reconciled'),'reconciled');
    else {const suffix=': '+String(receipt.ReconciliationDelta);toast(t('reconcileDifference')+suffix,'reconcileDifference',suffix)}
    await refresh();
  } catch (e) {
    toast(e.message,e.localeKey??null);
  } finally {
    if(ownsRiskLane)riskWrites.delete('reconcile');renderRiskControls();
  }
};
$("#kill").onclick = async () => {
  if (!statefulPreview || riskWrites.size>0) return;
  if (!confirm(t("confirmKill"))) return;
  riskWrites.add('kill');snapshotRevision++;renderRiskControls();
  try {
    const receipt=confirmedRiskReceipt(await api("/v1/risk/kill", {
      method: "POST",
      body: JSON.stringify({ reason: "operator user confirmation" }),
    }));
    if(!receipt.KillSwitch)throw Object.assign(new Error(t('riskReceiptUnconfirmed')),{localeKey:'riskReceiptUnconfirmed'});
    applyConfirmedRiskReceipt(receipt);
    toast(t("killActive"), "killActive");
    await refresh();
  } catch (e) {
    toast(e.message,e.localeKey??null);
  } finally {
    riskWrites.delete('kill');renderRiskControls();
  }
};
if(pendingResearchIntent){
  const previous=pendingResearchIntent;
  for(const [id,value] of Object.entries({strategy:previous.strategy.name,seed:previous.strategy.seed,fast:previous.strategy.params.fast,slow:previous.strategy.params.slow,fee:previous.assumptions.feeBPS,slippage:previous.assumptions.slippageBPS}))$('#'+id).value=String(value);
}
applyLocale();
// A return URL only reveals the existing account controls. The private-session
// controller still validates the callback and grants no authority from this UI.
if (window.location?.pathname === "/wallet-auth/callback") $("#account-panel").open = true;
window.addEventListener("ynx:quant-wallet-state", event => handleWalletState(event.detail));
handleWalletState(window.YNXQuantWallet?.getStandardWalletState?.());
refresh().catch((e) => toast(e.message,e.localeKey??null));
