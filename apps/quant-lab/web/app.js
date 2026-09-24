const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
let snapshot = { paper: {}, strategies: {}, experiments: {}, audit: [] };
let statefulPreview = false;
let publicExperiments = {};
let pendingMandate = null;
let pendingOrder = null;
let previewRevision = 0;
let walletIdentity = "";
let portfolioRevision = 0;
let portfolio = null;
let portfolioStatus = "connectForPortfolio";
const tenantKey = "ynx.quant.tenant.v1";
let tenantId = localStorage.getItem(tenantKey);
if (!/^[0-9a-f]{64}$/.test(tenantId || "")) {
  tenantId = [...crypto.getRandomValues(new Uint8Array(32))].map((value) => value.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(tenantKey, tenantId);
}
const paperPendingKey = `ynx.quant.paper.pending.v1:${tenantId}`;
let paperSubmitting = false, pendingPaperIntent = readPendingPaperIntent();
function readPendingPaperIntent() {
  try {
    const value = JSON.parse(localStorage.getItem(paperPendingKey) || "null");
    if (value && /^quant-paper-[0-9a-f-]{36}$/.test(value.IdempotencyKey) && /^[0-9a-f]{64}$/.test(value.StrategyHash) && ["buy", "sell"].includes(value.Side) && Number.isSafeInteger(value.Amount) && value.Amount > 0) return value;
  } catch {}
  localStorage.removeItem(paperPendingKey);
  return null;
}
const supportedLocales = QuantI18n.locales;
let locale = localStorage.getItem("ynx.quant.locale") || "en";
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
const t = (key) => businessCopy[locale]?.[key] ?? businessCopy.en[key] ?? QuantI18n.t(locale, key);
const localDate = (value) => new Intl.DateTimeFormat(locale, {dateStyle:"medium",timeStyle:"medium"}).format(new Date(value));
function applyLocale() {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  $("#locale").value = locale;
  $$('[data-i18n]').forEach((element) => { element.textContent = t(element.dataset.i18n); });
  $$('[data-business-i18n]').forEach((element) => { element.textContent = t(element.dataset.businessI18n); });
  const active = $('nav button.active'); if (active) $('#view-title').textContent = active.textContent;
  renderPortfolio();
}
const api = async (path, opt = {}) => {
  const r = await fetch("/api" + path, {
    ...opt,
    headers: {
      "content-type": "application/json",
      "x-ynx-preview-mode": "local-paper",
      "x-ynx-tenant-id": tenantId,
      ...(opt.headers || {}),
    },
  });
  const b = await r.json();
  if (!r.ok) throw Object.assign(new Error(b.error || `HTTP ${r.status}`), {status: r.status});
  return b;
};
const toast = (m) => {
  const e = $("#toast");
  e.textContent = m;
  e.classList.add("show");
  setTimeout(() => e.classList.remove("show"), 3000);
};
async function refresh() {
  snapshot = await api("/v1/snapshot");
  statefulPreview = snapshot.access?.statefulPreview === true;
  if (!statefulPreview) snapshot.experiments = publicExperiments;
  $("#workspace-boundary").hidden = statefulPreview;
  for (const id of ["reconcile", "kill"]) $("#" + id).disabled = !statefulPreview;
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
function render() {
  const strategies = Object.values(snapshot.strategies || {}),
    experiments = Object.values(snapshot.experiments || {});
  $("#strategy-rows").innerHTML = strategies.length
    ? strategies
        .map(
          (s) => {
            const runtime = s.Runtime || {}, enabled = runtime.enabled === true;
            return `<tr><td>${safe(s.Name)}</td><td>${safe(s.Family)}</td><td>${safe(s.Stage || "Draft")}</td><td><code>${safe((s.StrategyHash || "").slice(0, 12))}…</code></td><td>${safe(s.License)}</td><td><strong>${enabled ? safe(runtime.lastRunStatus || "Scheduled") : "Stopped"}</strong><small>${enabled && runtime.nextRunAt ? safe(localDate(runtime.nextRunAt)) : "No automatic execution"}</small><button type="button" class="schedule-toggle" data-strategy-id="${safe(s.ID)}" data-enabled="${!enabled}" ${statefulPreview ? "" : "disabled"}>${enabled ? "Stop schedule" : "Start 60s research"}</button></td></tr>`;
          },
        )
        .join("")
    : `<tr><td colspan="6">${safe(t("emptyStrategy"))}</td></tr>`;
  $("#experiment-rows").innerHTML = experiments.length
    ? experiments
        .map(
          (e) =>
            `<tr><td>${localDate(e.createdAt)}</td><td>${safe(e.strategy.Name)}</td><td>${e.metrics.ReturnBPS} bps</td><td>${e.metrics.BuyHoldBPS} bps</td><td>${e.metrics.MaxDrawdownBPS} bps</td><td>${Number.isFinite(e.metrics.SharpeMilli) ? (e.metrics.SharpeMilli / 1000).toFixed(3) : "—"}</td><td>${e.metrics.VolatilityBPS ?? "—"} bps</td><td>${e.metrics.Trades}</td><td>${e.metrics.PartialFills}</td><td>${e.sensitivitySpreadBPS} bps</td><td>${e.metrics.DataGaps}</td><td>${e.attribution?.userNetPnl ?? 0}</td><td>${e.attribution?.userRealizedPnl ?? 0}</td><td>${e.attribution?.userUnrealizedPnl ?? 0}</td><td>${e.attribution?.tradingFee ?? 0}</td><td>${e.attribution?.slippage ?? 0}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="16">${safe(t("emptyExperiment"))}</td></tr>`;
  const p = snapshot.paper || {};
  renderPaperStrategies(strategies);
  $("#paper-state").innerHTML =
    `<h3>${safe(t("paperWorkspace"))}</h3><dl><div><dt>Cash (simulated)</dt><dd>${p.Cash ?? "—"}</dd></div><div><dt>Position (simulated)</dt><dd>${p.Position ?? "—"}</dd></div><div><dt>Reconciliation</dt><dd>${p.ReconciliationDelta ?? "—"}</dd></div><div><dt>Kill switch</dt><dd class="${p.KillSwitch ? "danger" : ""}">${p.KillSwitch === true ? "ACTIVE" : p.KillSwitch === false ? "Armed" : "—"}</dd></div></dl>`;
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
  const enabled = button.dataset.enabled === "true";
  if (enabled && !confirm("Start persistent 60-second research? No Paper or Testnet orders will be placed.")) return;
  button.disabled = true;
  try {
    await api(`/v1/strategies/${encodeURIComponent(button.dataset.strategyId)}/schedule`, {method: "PUT", body: JSON.stringify({enabled, intervalSeconds: enabled ? 60 : 0, assumptions: enabled ? {feeBPS:+$("#fee").value, slippageBPS:+$("#slippage").value, latencyBars:1, participationBPS:1000, seed:+$("#seed").value, trainEnd:24, walkForwardWindows:3} : {}})});
    await refresh();
  } catch (error) { toast(error.message); button.disabled = false; }
});
function renderResult(result) {
  const metrics = result.metrics;
  if (!metrics) return;
  $("#latest-result").hidden = false;
  for (const [id, key] of [["return","ReturnBPS"],["baseline","BuyHoldBPS"],["drawdown","MaxDrawdownBPS"],["volatility","VolatilityBPS"]]) $("#result-" + id).textContent = Number.isFinite(metrics[key]) ? `${metrics[key]} bps` : "—";
  $("#result-sharpe").textContent = Number.isFinite(metrics.SharpeMilli) ? (metrics.SharpeMilli / 1000).toFixed(3) : "—";
  const points = result.equityCurve || [];
  const valid = points.length > 1 && points.length <= 10000 && points.every(point => Number.isFinite(point.equity) && Number.isFinite(point.benchmarkEquity));
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
$("#locale").onchange = (e) => {
  locale = e.target.value;
  localStorage.setItem("ynx.quant.locale", locale);
  applyLocale(); render();
};
$("#backtest").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const body = {
      strategy: {
        id: "ma-" + Date.now(),
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
    const result = await api(statefulPreview ? "/v1/backtests/from-market" : "/v1/public/research/backtests/from-market", { method: "POST", body: JSON.stringify(body) });
    renderResult(result);
    toast(statefulPreview ? "Out-of-sample experiment completed and audited" : "Stateless research completed. This result is not a saved strategy or funded account.");
    if (statefulPreview) await refresh();
    else { publicExperiments[result.id] = result; snapshot.experiments = publicExperiments; render(); }
  } catch (e) {
    toast(e.message);
  }
};
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
    if (!pendingPaperIntent) {
      pendingPaperIntent = {StrategyHash: strategyHash, Side, Amount, IdempotencyKey: `quant-paper-${crypto.randomUUID()}`};
    }
    localStorage.setItem(paperPendingKey, JSON.stringify(pendingPaperIntent));
    paperSubmitting = true;
    $("#paper-submit").disabled = true;
    const submitted = pendingPaperIntent;
    const order = await api("/v1/paper/orders", {
      method: "POST",
      body: JSON.stringify(submitted),
    });
    if (!/^paper-[0-9]+$/.test(order?.ID) || order.IdempotencyKey !== submitted.IdempotencyKey || order.StrategyHash !== submitted.StrategyHash || order.Side !== submitted.Side || order.Amount !== submitted.Amount) throw new Error(t("paperPendingMismatch"));
    pendingPaperIntent = null;
    localStorage.removeItem(paperPendingKey);
    toast("Simulated order recorded");
    await refresh();
  } catch (e) {
    if (e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 409 && e.status !== 429) {
      pendingPaperIntent = null;
      localStorage.removeItem(paperPendingKey);
    }
    toast(e.message);
  } finally {
    paperSubmitting = false;
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
$("#reconcile").onclick = async () => {
  try {
    await api("/v1/paper/reconcile", {
      method: "POST",
      body: JSON.stringify({
        Cash: snapshot.paper.Cash,
        Position: snapshot.paper.Position,
      }),
    });
    toast("Reconciliation completed: zero difference");
    await refresh();
  } catch (e) {
    toast(e.message);
  }
};
$("#kill").onclick = async () => {
  if (!confirm("Activate the persistent paper/testnet kill switch?")) return;
  try {
    await api("/v1/risk/kill", {
      method: "POST",
      body: JSON.stringify({ reason: "operator user confirmation" }),
    });
    toast("Kill switch active");
    await refresh();
  } catch (e) {
    toast(e.message);
  }
};
applyLocale();
window.addEventListener("ynx:quant-wallet-state", event => handleWalletState(event.detail));
handleWalletState(window.YNXQuantWallet?.getStandardWalletState?.());
refresh().catch((e) => toast("Service unavailable: " + e.message));
