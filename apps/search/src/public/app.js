import { locales, resolve, apply, text } from "./i18n.js";

const $ = selector => document.querySelector(selector);
const number = value => new Intl.NumberFormat(locale).format(value);
let page = 1;
let lastQuery = "";
let lastResult = null;
let aiController = null;
let aiSources = [];
let locale = resolve(localStorage.getItem("ynx-search-locale") || navigator.languages?.[0] || navigator.language);
let aiLocale = resolve(localStorage.getItem("ynx-search-ai-locale") || locale);

for (const select of [$("#locale"), $("#ai-locale")]) {
  for (const [value, label] of Object.entries(locales)) select.add(new Option(label, value));
}
$("#locale").value = locale;
$("#ai-locale").value = aiLocale;
apply(locale);

const states = {
  en: {
    initial: ["Search the reviewed index", "Results appear only when an authorized source contains a match."],
    loading: ["Searching authorized sources…", "Lexical retrieval is running. No AI inference is involved."],
    empty: ["No indexed match", "Try another phrase or broaden the filters. Empty means no approved source matched."],
    failure: ["Search is unavailable", "The index service did not return a usable response."],
    noSources: ["No sources are approved yet", "This index stays empty until an operator records source authorization and robots policy."],
    partial: "Some sources are not ready. Results may be incomplete within the authorized scope."
  },
  "zh-Hans": {initial:["搜索经审核的索引","只有已授权来源中存在匹配时才会显示结果。"],loading:["正在搜索已授权来源…","正在进行词法检索，不包含 AI 推断。"],empty:["没有索引匹配项","请尝试其他词语或放宽筛选。空结果表示没有获批来源匹配。"],failure:["搜索暂不可用","索引服务未返回可用响应。"],noSources:["尚无获批来源","只有运营方记录来源授权和 robots 策略后才会建立索引。"],partial:"部分来源尚未就绪；获授权范围内的结果可能不完整。"},
  "zh-Hant": {initial:["搜尋經審核的索引","只有已授權來源中存在相符項目時才會顯示結果。"],loading:["正在搜尋已授權來源…","正在進行詞彙擷取，不包含 AI 推論。"],empty:["沒有索引相符項目","請嘗試其他詞語或放寬篩選。空結果表示沒有獲准來源相符。"],failure:["搜尋暫時無法使用","索引服務未傳回可用回應。"],noSources:["尚無獲准來源","只有營運方記錄來源授權和 robots 政策後才會建立索引。"],partial:"部分來源尚未就緒；已授權範圍內的結果可能不完整。"},
  ja:{initial:["審査済み索引を検索","許可済みソースに一致がある場合のみ結果を表示します。"],loading:["許可済みソースを検索中…","字句検索を実行中です。AI 推論は含まれません。"],empty:["索引に一致なし","別の語句または広い絞り込みをお試しください。"],failure:["検索を利用できません","索引サービスから有効な応答がありません。"],noSources:["許可済みソースがありません","許可と robots 方針が記録されるまで索引は空です。"],partial:"一部のソースが未準備のため結果は不完全な場合があります。"},
  ko:{initial:["검토된 색인 검색","승인된 출처에 일치 항목이 있을 때만 결과가 표시됩니다."],loading:["승인된 출처 검색 중…","어휘 검색 중이며 AI 추론은 포함되지 않습니다."],empty:["색인 일치 항목 없음","다른 문구나 더 넓은 필터를 사용해 보세요."],failure:["검색을 사용할 수 없음","색인 서비스가 유효한 응답을 반환하지 않았습니다."],noSources:["승인된 출처 없음","출처 승인과 robots 정책이 기록될 때까지 색인은 비어 있습니다."],partial:"일부 출처가 준비되지 않아 결과가 불완전할 수 있습니다."},
  es:{initial:["Buscar en el índice revisado","Los resultados solo aparecen si coincide una fuente autorizada."],loading:["Buscando fuentes autorizadas…","Recuperación léxica en curso, sin inferencia de IA."],empty:["No hay coincidencias indexadas","Prueba otra frase o amplía los filtros."],failure:["La búsqueda no está disponible","El índice no devolvió una respuesta válida."],noSources:["Aún no hay fuentes aprobadas","El índice queda vacío hasta registrar autorización y política robots."],partial:"Algunas fuentes no están listas; los resultados pueden estar incompletos."},
  fr:{initial:["Rechercher dans l’index vérifié","Les résultats n’apparaissent que pour une source autorisée correspondante."],loading:["Recherche des sources autorisées…","Récupération lexicale en cours, sans inférence IA."],empty:["Aucune correspondance indexée","Essayez une autre expression ou élargissez les filtres."],failure:["Recherche indisponible","L’index n’a pas renvoyé de réponse exploitable."],noSources:["Aucune source approuvée","L’index reste vide jusqu’à l’enregistrement de l’autorisation et de la politique robots."],partial:"Certaines sources ne sont pas prêtes ; les résultats peuvent être incomplets."},
  de:{initial:["Geprüften Index durchsuchen","Ergebnisse erscheinen nur bei einem Treffer in einer autorisierten Quelle."],loading:["Autorisierte Quellen werden durchsucht…","Lexikalischer Abruf ohne KI-Schlussfolgerung."],empty:["Kein indexierter Treffer","Anderen Ausdruck oder weitere Filter versuchen."],failure:["Suche nicht verfügbar","Der Indexdienst lieferte keine nutzbare Antwort."],noSources:["Noch keine Quellen genehmigt","Der Index bleibt leer, bis Autorisierung und Robots-Regel erfasst sind."],partial:"Einige Quellen sind nicht bereit; Ergebnisse können unvollständig sein."},
  pt:{initial:["Pesquisar o índice revisado","Os resultados só aparecem quando uma fonte autorizada corresponde."],loading:["Pesquisando fontes autorizadas…","Recuperação lexical em andamento, sem inferência de IA."],empty:["Nenhuma correspondência indexada","Tente outra frase ou amplie os filtros."],failure:["Pesquisa indisponível","O índice não retornou uma resposta utilizável."],noSources:["Ainda não há fontes aprovadas","O índice fica vazio até registrar autorização e política robots."],partial:"Algumas fontes não estão prontas; os resultados podem estar incompletos."},
  ru:{initial:["Поиск по проверенному индексу","Результаты появляются только при совпадении в разрешённом источнике."],loading:["Поиск по разрешённым источникам…","Идёт лексический поиск без выводов ИИ."],empty:["Совпадений в индексе нет","Попробуйте другую фразу или расширьте фильтры."],failure:["Поиск недоступен","Сервис индекса не вернул пригодный ответ."],noSources:["Разрешённых источников пока нет","Индекс останется пустым до записи разрешения и robots-политики."],partial:"Некоторые источники не готовы; результаты могут быть неполными."},
  ar:{initial:["البحث في الفهرس المراجع","تظهر النتائج فقط عند وجود تطابق في مصدر مصرح به."],loading:["جارٍ بحث المصادر المصرح بها…","يعمل الاسترجاع اللفظي من دون استنتاج بالذكاء الاصطناعي."],empty:["لا توجد نتيجة مفهرسة","جرّب عبارة أخرى أو وسّع عوامل التصفية."],failure:["البحث غير متاح","لم تُرجع خدمة الفهرس استجابة صالحة."],noSources:["لا توجد مصادر معتمدة بعد","يبقى الفهرس فارغاً حتى تسجيل التفويض وسياسة robots."],partial:"بعض المصادر غير جاهزة؛ قد تكون النتائج غير مكتملة."},
  id:{initial:["Cari indeks yang ditinjau","Hasil hanya muncul jika sumber berizin memiliki kecocokan."],loading:["Mencari sumber berizin…","Pengambilan leksikal berjalan tanpa inferensi AI."],empty:["Tidak ada kecocokan terindeks","Coba frasa lain atau perluas filter."],failure:["Pencarian tidak tersedia","Layanan indeks tidak memberi respons yang dapat digunakan."],noSources:["Belum ada sumber disetujui","Indeks tetap kosong sampai izin sumber dan kebijakan robots dicatat."],partial:"Sebagian sumber belum siap; hasil mungkin tidak lengkap."}
};
const stateCopy = () => states[locale] || states.en;

function setState(kind, detail) {
  const state = $("#state");
  const [heading, defaultDetail] = stateCopy()[kind] || stateCopy().initial;
  state.className = `state ${kind}`;
  state.hidden = false;
  state.replaceChildren();
  const title = document.createElement("h3");
  title.textContent = heading;
  const body = document.createElement("p");
  body.textContent = detail || defaultDetail;
  state.append(title, body);
  if (kind === "failure") state.append(retryButton());
}

function clearResults() {
  $("#results").replaceChildren();
  $("#pages").replaceChildren();
  $("#summary").textContent = "";
  $("#ai-entry").replaceChildren();
}

function freshness(value) {
  if (!value) return "Published date unavailable";
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 86400000));
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day");
}

async function loadStatus({ open = false } = {}) {
  try {
    const response = await fetch("/api/index/status");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const current = $("#source").value;
    $("#source").replaceChildren(new Option(text(locale, "allSources"), ""), ...data.sources.map(source => new Option(source.label, source.id)));
    $("#source").value = current;
    $("#status-list").replaceChildren(...data.sources.map(source => {
      const item = document.createElement("div");
      item.className = "status-item";
      const strong = document.createElement("strong");
      strong.textContent = `${source.label} · ${source.indexingStatus}`;
      const detail = document.createElement("span");
      detail.textContent = `${number(source.documentCount)} ${text(locale, "documents")} · ${source.lastIndexedAt ? `${freshness(source.lastIndexedAt)}` : text(locale, "notIndexed")}`;
      item.append(strong, detail);
      return item;
    }));
    if (!data.sources.length) setState("noSources");
    if (open) $("#status-dialog").showModal();
    return data;
  } catch (error) {
    if (open) showNotice(`${text(locale, "indexUnavailable")} ${error.message}`);
    return null;
  }
}

async function search(nextPage = 1) {
  const query = $("#query").value.trim();
  if (!query) return;
  lastQuery = query;
  page = nextPage;
  clearResults();
  setState("loading");
  const params = new URLSearchParams({ q: query, page: String(page) });
  if ($("#source").value) params.set("source", $("#source").value);
  if ($("#freshness").value) params.set("freshnessDays", $("#freshness").value);
  if ($("#type").value) params.set("type", $("#type").value);
  let response;
  let data;
  try {
    response = await fetch(`/api/search?${params}`);
    data = await response.json();
  } catch {
    setState("failure");
    return;
  }
  if (!response.ok) {
    setState("failure", data.error);
    return;
  }
  lastResult = data;
  const unfinished = data.indexStatus.filter(source => source.indexingStatus !== "ready" && source.indexingStatus !== "disabled");
  if (unfinished.length) showNotice(stateCopy().partial);
  else if (navigator.onLine) hideNotice();
  if (!data.results.length) {
    setState(data.indexStatus.length ? "empty" : "noSources");
    return;
  }
  $("#state").hidden = true;
  $("#summary").textContent = `${number(data.total)} results · page ${number(data.page)} of ${number(data.totalPages)} · lexical retrieval over authorized indexed sources`;
  const aiButton = document.createElement("button");
  aiButton.type = "button";
  aiButton.className = "secondary";
  aiButton.textContent = text(locale, "answerAI");
  aiButton.onclick = prepareAi;
  $("#ai-entry").replaceChildren(aiButton);
  $("#results").replaceChildren(...data.results.map(result => {
    const article = document.createElement("article");
    article.className = "result";
    const retrieval = document.createElement("div");
    retrieval.className = "retrieval";
    retrieval.textContent = `${text(locale, "retrieval")} · ${text(locale, "inference")}: no`;
    const source = document.createElement("div");
    source.className = "source";
    const label = document.createElement("strong");
    label.textContent = result.sourceLabel;
    const url = document.createElement("span");
    url.className = "source-url";
    url.textContent = result.sourceUrl;
    const fresh = document.createElement("span");
    fresh.className = "fresh";
    fresh.textContent = `${text(locale, "fetched")} ${freshness(result.freshness.fetchedAt)}`;
    source.append(label, url, fresh);
    const heading = document.createElement("h3");
    const link = document.createElement("a");
    link.href = result.sourceUrl;
    link.rel = "noopener noreferrer";
    link.textContent = result.title;
    heading.append(link);
    const snippet = document.createElement("p");
    snippet.textContent = result.snippet;
    const meta = document.createElement("div");
    meta.className = "result-meta";
    meta.textContent = `Score ${number(result.score)} · ${result.contentType} · receipt ${result.indexReceiptDigest?.slice(0, 12) || "unavailable"}`;
    article.append(retrieval, source, heading, snippet, meta);
    return article;
  }));
  const pages = [];
  for (let index = 1; index <= Math.min(data.totalPages, 20); index++) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = number(index);
    button.setAttribute("aria-label", `Page ${number(index)}`);
    if (index === data.page) button.setAttribute("aria-current", "page");
    button.onclick = () => search(index);
    pages.push(button);
  }
  $("#pages").replaceChildren(...pages);
}

async function prepareAi() {
  const filters = { sourceId: $("#source").value || null, freshnessDays: $("#freshness").value ? Number($("#freshness").value) : null, contentType: $("#type").value || null };
  let response;
  let data;
  try {
    response = await fetch("/api/ai/prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: lastQuery, filters, model: "default", outputLocale: aiLocale }) });
    data = await response.json();
    if (!response.ok) throw new Error(data.error);
  } catch (error) {
    showNotice(`${text(locale, "providerUnavailable")} ${error.message}`);
    return;
  }
  aiSources = data.sources || [];
  $("#ai-preview").textContent = `Provider: ${data.providerStatus}\nModel: ${data.model}\nOutput: ${locales[aiLocale]}\nContext: ${number(aiSources.length)} current result snippets\nSent: source URL, title, snippet and fetched time\nExcluded: browsing history, Wallet identity, private content and unrelated tabs\nEstimated maximum: ${number(data.estimate.maximum)} snippets; monetary cost is provider-dependent.`;
  $("#ai-approve").disabled = data.providerStatus !== "configured";
  $("#ai-output").textContent = data.providerStatus === "configured" ? "Ready after explicit permission." : text(locale, "providerUnavailable");
  $("#ai-review").hidden = true;
  $("#ai-dialog").showModal();
}

$("#search-form").onsubmit = event => { event.preventDefault(); search(1); };
for (const selector of ["#source", "#freshness", "#type"]) $(selector).onchange = () => lastQuery && search(1);
$("#status-button").onclick = () => loadStatus({ open: true });
$("#locale").onchange = () => { locale = $("#locale").value; localStorage.setItem("ynx-search-locale", locale); apply(locale); if ($("#source").options.length) $("#source").options[0].textContent = text(locale, "allSources"); if (!lastResult) setState("initial"); else search(page); };
$("#ai-locale").onchange = () => { aiLocale = $("#ai-locale").value; localStorage.setItem("ynx-search-ai-locale", aiLocale); };

const savedTheme = localStorage.getItem("ynx-search-theme") || "system";
if (savedTheme !== "system") document.documentElement.dataset.theme = savedTheme;
$("#theme-button").onclick = () => {
  const current = document.documentElement.dataset.theme || "system";
  const next = current === "system" ? "dark" : current === "dark" ? "light" : "system";
  if (next === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  localStorage.setItem("ynx-search-theme", next);
  $("#theme-button").title = `Appearance: ${next}`;
};

let caseKind = "correction";
document.querySelectorAll("[data-case]").forEach(button => button.onclick = () => {
  caseKind = button.dataset.case;
  $("#case-title").textContent = text(locale, caseKind);
  $("#case-parent-row").hidden = caseKind !== "appeal";
  $("#case-parent").required = caseKind === "appeal";
  $("#case-result").textContent = "";
  $("#case-dialog").showModal();
});
$("#case-close").onclick = () => $("#case-dialog").close();
$("#case-form").onsubmit = async event => {
  event.preventDefault();
  const evidenceUrls = $("#case-evidence").value.split(/\r?\n/).map(value => value.trim()).filter(Boolean).slice(0, 10);
  const payload = { sourceUrl: $("#case-url").value, reason: $("#case-reason").value, evidenceUrls };
  if (caseKind === "appeal") payload.parentCaseId = $("#case-parent").value.trim();
  $("#case-submit").disabled = true;
  try {
    const response = await fetch(`/api/${caseKind}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    $("#case-result").textContent = `${data.case.kind} case ${data.case.id} · ${data.case.status} · Trust: ${data.trustStatus}`;
    $("#case-form").reset();
  } catch (error) {
    $("#case-result").textContent = `${text(locale, "error")}: ${error.message}`;
  } finally {
    $("#case-submit").disabled = false;
  }
};

$("#ai-close").onclick = () => $("#ai-dialog").close();
$("#ai-approve").onclick = async () => {
  aiController = new AbortController();
  $("#ai-output").textContent = "Connecting to YNX AI Gateway…\n";
  try {
    const filters = { sourceId: $("#source").value || null, freshnessDays: $("#freshness").value ? Number($("#freshness").value) : null, contentType: $("#type").value || null };
    const response = await fetch("/api/ai/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: lastQuery, filters, model: "default", outputLocale: aiLocale, consent: { approved: true, reviewer: "user" } }), signal: aiController.signal });
    if (!response.ok) { const data = await response.json(); throw new Error(data.error); }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    $("#ai-output").textContent = "";
    while (true) { const { done, value } = await reader.read(); if (done) break; $("#ai-output").textContent += decoder.decode(value, { stream: true }); }
    $("#ai-review").hidden = false;
  } catch (error) {
    $("#ai-output").textContent = error.name === "AbortError" ? "Generation cancelled. Retry uses the same visible context." : `Provider unavailable: ${error.message}`;
  }
};
$("#ai-cancel").onclick = () => aiController?.abort();
document.querySelectorAll("[data-review]").forEach(button => button.onclick = async () => {
  await fetch("/api/ai/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: button.dataset.review, sourceUrls: aiSources.map(source => source.sourceUrl) }) });
  $("#ai-dialog").close();
});

function retryButton() { const button = document.createElement("button"); button.type = "button"; button.className = "secondary"; button.textContent = text(locale, "retry"); button.onclick = () => search(page); return button; }
function showNotice(message) { $("#network").textContent = message; $("#network").hidden = false; }
function hideNotice() { $("#network").hidden = true; $("#network").textContent = ""; }

async function deviceKey() {
  const database = await new Promise((resolveDb, reject) => { const request = indexedDB.open("ynx-search-device", 1); request.onupgradeneeded = () => request.result.createObjectStore("keys"); request.onsuccess = () => resolveDb(request.result); request.onerror = () => reject(request.error); });
  const transaction = database.transaction("keys", "readwrite");
  const store = transaction.objectStore("keys");
  let pair = await new Promise(resolveKey => { const request = store.get("wallet-p256"); request.onsuccess = () => resolveKey(request.result); });
  if (!pair) { pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]); store.put(pair, "wallet-p256"); }
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const compressed = new Uint8Array(33);
  compressed[0] = raw[64] & 1 ? 3 : 2;
  compressed.set(raw.slice(1, 33), 1);
  return btoa(String.fromCharCode(...compressed)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
$("#wallet-button").onclick = async () => {
  try {
    const response = await fetch("/api/wallet/prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceKey: await deviceKey() }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    location.href = data.deepLink;
  } catch (error) { showNotice(`Wallet unavailable: ${error.message}. No session was created.`); }
};
if (location.pathname === "/auth/callback") {
  const encoded = new URLSearchParams(location.search).get("response");
  if (encoded) try {
    const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const value = JSON.parse(atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)));
    fetch("/api/wallet/callback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }).then(async response => { const data = await response.json(); showNotice(data.message || data.error); history.replaceState({}, "", "/"); });
  } catch { showNotice("Wallet callback rejected: malformed response"); }
}
$("#clear-private").onclick = async () => {
  const response = await fetch("/api/privacy/clear", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ walletChallenges: true, aiAudit: true }) });
  const data = await response.json();
  showNotice(response.ok ? `Cleared sign-in and AI audit data. Retained: ${data.retained.join(", ")}.` : data.error);
};
function network() { if (navigator.onLine) hideNotice(); else showNotice(text(locale, "offline")); }
addEventListener("online", () => showNotice(text(locale, "online")));
addEventListener("offline", network);
network();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
await loadStatus();
const initial = new URLSearchParams(location.search).get("q");
if (initial) { $("#query").value = initial; search(); }
