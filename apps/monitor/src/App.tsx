import { copy, formatDate, currentLocale } from "./copy";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { can, login, request, type Session } from "./api";
import { discoverWalletProviders, providerErrorCode, selectedAccount, type EIP1193Provider, type WalletProvider } from "./eip1193";
import { localeNames, locales, type Locale, useI18n } from "./i18n";
import { WalletDownloads } from "./WalletDownloads";
const ynxLogo = "/ynx-icon-96.png?v=brand-20260906-v2";
// The generated SDK helper is the canonical bounded EIP-3085/EIP-1193 chain
// switcher. It never requests accounts, signatures, or transactions by itself.
// @ts-expect-error The source-bound SDK has no declaration file.
import { ensureYNXTestnet } from "../../../sdk/js/wallet.js";

interface Probe {
  id: string;
  label: string;
  status: "healthy" | "unavailable";
  checkedAt: string;
  latencyMs?: number;
  httpStatus?: number;
  data?: any;
	errorCode?: string;
}
interface Alert {
  id: string;
  source: string;
  state: string;
  firstObservedAt: string;
  lastObservedAt: string;
  reason: string;
  evidenceUrl: string;
  acknowledgedBy?: string;
}
interface Incident {
  schemaVersion: number;
  id: string;
  title: string;
  severity: string;
  status: string;
  openedAt: string;
  source: string;
  evidence: string[];
  notes: string[];
  owner?: string;
  timeline?: Array<{
    id: string;
    at: string;
    actor: string;
    action: string;
    summary: string;
    evidence: string[];
  }>;
  postmortem?: {
    summary: string;
    rootCause: string;
    correctiveActions: string[];
    evidence: string[];
  };
}
interface Overview {
  checkedAt: string;
  probes: Probe[];
	network:{expectedValidatorCount:number;observedValidatorCount:number;validatorSetStatus:string;canonicalHeight:number|null;indexedHeight:number|null;indexLag:number|null;finality:{status:string;height:number|null};blockIntervalSeconds:number|null;tps:number|null;peerCount:number;validators:Record<string,unknown>[];consensus:{streamBFT:{status:string;active:boolean;statement:string}}};
  slo: { definition: string; passing: number; total: number };
  incidents: Incident[];
  alerts: Alert[];
  rollbackProposals: Record<string, unknown>[];
  backupRecords: Record<string, unknown>[];
}
interface Audit {
  id: string;
  at: string;
  actor: string;
  role: string;
  action: string;
  target: string;
  outcome: string;
}
interface PublicStatus {
  availability: "available";
  status: string;
  asOf: string;
  message?: string;
	services: Array<{ id: string; name: string; status: string; asOf: string; checkedAt:string; sourceCommit:string|null; release:string|null; startedAt:string|null; dependencies:Array<{id:string;status:string}>; message?: string }>;
	history:Array<{asOf:string;status:string;operational:number;degraded:number;outage:number;unknown:number;transition:string}>;
	historyPersistence:"process-scoped";
}
const views = [
  "Overview",
  "Nodes",
  "Validators",
  "Peers",
  "Releases",
  "SLO",
  "Incidents",
  "Alerts",
  "Logs",
  "Backups",
  "Rollback",
  "Audit",
];

function storedSession() {
  try {
    const parsed = JSON.parse(
      sessionStorage.getItem("ynx-monitor-session") || "null",
    ) as Session | null;
    return parsed && typeof parsed.token === "string" && typeof parsed.csrfToken === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}
function short(value?: string, size = 12) {
  return value ? `${value.slice(0, size)}…` : copy("Unavailable");
}
function roleLabel(role: string) {
  return role
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function App() {
  const { locale, aiLanguage, setLocale, setAILanguage, t, date } = useI18n();
  const [online, setOnline] = useState(navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<any>();
  const [session, setSession] = useState<Session | null>(storedSession);
  const [view, setView] = useState("Overview");
  const [overview, setOverview] = useState<Overview>();
  const [audit, setAudit] = useState<Audit[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState<Incident>();
  const [walletProviders, setWalletProviders] = useState<WalletProvider[]>([]);
  const [walletProviderId, setWalletProviderId] = useState(() => sessionStorage.getItem("ynx-monitor-wallet-provider") || "");
  const activeWalletProvider = walletProviders.find((provider) => provider.id === walletProviderId);
  async function refresh() {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      const [data, a] = await Promise.all([
        request<Overview>("/ops/overview", session),
        request<{ audit: Audit[] }>("/ops/audit", session),
      ]);
      setOverview(data);
      setAudit(a.audit);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [session]);
  useEffect(() => {
    const on = () => setOnline(true),
      off = () => setOnline(false),
      install = (event: Event) => {
        event.preventDefault();
        setInstallPrompt(event);
      };
    addEventListener("online", on);
    addEventListener("offline", off);
    addEventListener("beforeinstallprompt", install);
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
      removeEventListener("beforeinstallprompt", install);
    };
  }, []);
  useEffect(() => discoverWalletProviders(setWalletProviders), []);
  useEffect(() => {
    if (!session || !session.principal.username.startsWith("wallet:") || !activeWalletProvider?.provider.on) return;
    const expectedAccount = sessionStorage.getItem("ynx-monitor-wallet-account")?.toLowerCase();
    const invalidate = () => logout();
    const accountsChanged = (accounts: unknown) => {
      if (!expectedAccount || !Array.isArray(accounts) || !accounts.some((account) => typeof account === "string" && account.toLowerCase() === expectedAccount)) invalidate();
    };
    const chainChanged = (chainId: unknown) => { if (chainId !== "0x1917") invalidate(); };
    activeWalletProvider.provider.on("accountsChanged", accountsChanged);
    activeWalletProvider.provider.on("chainChanged", chainChanged);
    activeWalletProvider.provider.on("disconnect", invalidate);
    void activeWalletProvider.provider.request({ method: "eth_accounts" }).then(accountsChanged).catch(invalidate);
    return () => {
      activeWalletProvider.provider.removeListener?.("accountsChanged", accountsChanged);
      activeWalletProvider.provider.removeListener?.("chainChanged", chainChanged);
      activeWalletProvider.provider.removeListener?.("disconnect", invalidate);
    };
  }, [session, activeWalletProvider]);
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, [session]);
  function onLogin(next: Session, provider?: WalletProvider, account?: string) {
    sessionStorage.setItem("ynx-monitor-session", JSON.stringify(next));
    if (provider) sessionStorage.setItem("ynx-monitor-wallet-provider", provider.id);
    if (account) sessionStorage.setItem("ynx-monitor-wallet-account", account.toLowerCase());
    setSession(next);
    if (provider) setWalletProviderId(provider.id);
  }
  function logout() {
    sessionStorage.removeItem("ynx-monitor-session");
    sessionStorage.removeItem("ynx-monitor-wallet-provider");
    sessionStorage.removeItem("ynx-monitor-wallet-account");
    setSession(null);
    setWalletProviderId("");
    setOverview(undefined);
  }
  if (!session)
    return (
      <Login
        onLogin={onLogin}
        locale={locale}
        aiLanguage={aiLanguage}
        setLocale={setLocale}
        setAILanguage={setAILanguage}
        t={t}
        walletProviders={walletProviders}
      />
    );
  const role = session.principal.role;
  const probes = overview?.probes ?? [];
  const node = probes.find((x) => x.id === "node");
  const identity = probes.find((x) => x.id === "identity");
  const validators =
    probes.find((x) => x.id === "validators")?.data?.validators ?? [];
  const peers = probes.find((x) => x.id === "peers")?.data?.peers ?? [];
  const sync =
    probes.find((x) => x.id === "peer-sync")?.data?.peerSync ??
    probes.find((x) => x.id === "peer-sync")?.data?.records ??
    [];
  const viewLabel = (item: string) =>
    t(item.toLowerCase() as Parameters<typeof t>[0]);
  return (
    <div className="monitor-app">
      <aside className="rail">
        <div className="monitor-brand">
          <img src={ynxLogo} alt="" />
          <div>
            YNX<strong>MONITOR</strong>
          </div>
        </div>
        <nav aria-label={copy("Monitor views")}>
          {views.map((item) => (
            <button
              key={item}
              className={view === item ? "active" : ""}
              onClick={() => setView(item)}
            >
              <i aria-hidden="true" />
              {viewLabel(item)}
              {item === "Alerts" &&
              overview?.alerts.filter((a) => a.state === "firing").length ? (
                <b>
                  {overview.alerts.filter((a) => a.state === "firing").length}
                </b>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="rail-foot">
          <span>{session.principal.username}</span>
          <strong>{copy(roleLabel(role))}</strong>
          <button onClick={logout}>{t("signOut")}</button>
        </div>
      </aside>
      <main className="workspace">
        <header className="commandbar">
          <div>
            <p>{copy("OPERATIONS /")} {copy(view)}</p>
            <h1>{copy(view)}</h1>
          </div>
          <div className="command-actions">
            <span className={`role ${role}`}>{copy(role)}</span>
            <button onClick={refresh} disabled={loading}>
              {copy(loading ? "Probing…" : "Refresh evidence")}
            </button>
          </div>
        </header>
        <div className="locale-bar">
          <label>
            {t("language")}
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
            >
              {locales.map((x) => (
                <option key={x} value={x}>
                  {localeNames[x]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("aiLanguage")}
            <select
              value={aiLanguage}
              onChange={(e) => setAILanguage(e.target.value as Locale)}
            >
              {locales.map((x) => (
                <option key={x} value={x}>
                  {localeNames[x]}
                </option>
              ))}
            </select>
          </label>
          {installPrompt && (
            <button
              onClick={async () => {
                await installPrompt.prompt();
                setInstallPrompt(undefined);
              }}
            >
              {t("install")}
            </button>
          )}
        </div>
        {!online && (
          <div className="banner error" role="status">
            {t("offline")}
          </div>
        )}
        {error && (
          <div className="banner error" role="alert">
            <strong>{copy("Control plane unavailable")}</strong>
            <span>{copy(error)}</span>
            <button onClick={refresh}>{t("retry")}</button>
          </div>
        )}
        {!overview && !error && (
          <div
            className="loading-grid"
            aria-label={copy("Loading operational evidence")}
          > {copy("Probing authenticated upstreams…")} </div>
        )}
        {overview && (
          <>
            <div className="evidence-clock">
              <span className="live-dot" /> {copy("Bounded probe completed")} <time>{date(overview.checkedAt)}</time>
              <span>{copy("No historical uptime inferred")}</span>
            </div>
            {view === "Overview" && (
              <OverviewView
                overview={overview}
                node={node}
                identity={identity}
                setView={setView}
              />
            )}
            {view === "Nodes" && (
              <ProbeView
                title={copy("Node surfaces")}
                probes={probes.filter((x) =>
				  ["node", "explorer", "indexer", "faucet", "gateway"].includes(x.id),
                )}
              />
            )}
            {view === "Validators" && (
              <DataTable
                title={copy("Validator evidence")}
                empty={copy("No validator records returned")}
                rows={validators}
              />
            )}
            {view === "Peers" && (
              <>
                <DataTable
                  title={copy("Peer discovery")}
                  empty={copy("No peer records returned")}
                  rows={peers}
                />
                <DataTable
                  title={copy("Peer sync")}
                  empty={copy("No peer-sync records returned")}
                  rows={sync}
                />
              </>
            )}
            {view === "Releases" && <ReleaseView identity={identity} />}
            {view === "SLO" && <SloView overview={overview} />}
            {view === "Incidents" && (
              <IncidentView
                incidents={overview.incidents}
                role={role}
                session={session}
                onRefresh={refresh}
                onSelect={setSelectedIncident}
              />
            )}
            {view === "Alerts" && (
              <AlertView
                alerts={overview.alerts}
                role={role}
                session={session}
                onRefresh={refresh}
              />
            )}
            {view === "Logs" && <LogsView session={session} />}
            {view === "Backups" && (
              <BackupView
                records={overview.backupRecords}
                role={role}
                session={session}
                onRefresh={refresh}
              />
            )}
            {view === "Rollback" && (
              <RollbackView
                proposals={overview.rollbackProposals}
                role={role}
                session={session}
                identity={identity}
                onRefresh={refresh}
              />
            )}
            {view === "Audit" && <AuditView rows={audit} />}
          </>
        )}
      </main>
      {selectedIncident && (
        <IncidentAI
          incident={selectedIncident}
          session={session}
          language={localeNames[aiLanguage]}
          onClose={() => setSelectedIncident(undefined)}
        />
      )}
    </div>
  );
}

function Login({
  onLogin,
  locale,
  aiLanguage,
  setLocale,
  setAILanguage,
  t,
  walletProviders,
}: {
  onLogin: (s: Session, provider?: WalletProvider, account?: string) => void;
  locale: Locale;
  aiLanguage: Locale;
  setLocale: (x: Locale) => void;
  setAILanguage: (x: Locale) => void;
  t: (key: any) => string;
  walletProviders: WalletProvider[];
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [publicStatus, setPublicStatus] = useState<PublicStatus>();
  const [publicStatusError, setPublicStatusError] = useState("");
  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    let inFlight = false;
    const refreshStatus = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 10_000);
      try {
        const response = await fetch("/status", { headers: { accept: "application/json" }, signal: controller.signal, cache: "no-store" });
        const body = await response.json();
        if (!response.ok || body.availability !== "available") throw new Error(body.error || `HTTP ${response.status}`);
        if (active) { setPublicStatus(body as PublicStatus); setPublicStatusError(""); }
      } catch (reason) {
        if (active) {
          setPublicStatus(undefined);
          setPublicStatusError(controller.signal.aborted ? "public_status_unavailable" : reason instanceof Error ? reason.message : "public_status_unavailable");
        }
      } finally { clearTimeout(timeout); inFlight = false; }
    };
    void refreshStatus();
    const timer = setInterval(() => void refreshStatus(), 30_000);
    return () => { active = false; clearInterval(timer); controller?.abort(); };
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(await login(username, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-shell">
      <section className="login-context">
        <div className="monitor-brand large">
          <img src={ynxLogo} alt="" />
          <div>
            YNX<strong>MONITOR</strong>
          </div>
        </div>
        <p className="kicker">{t("restricted")}</p>
        <h1>{t("evidenceBefore")}</h1>
        <p> {copy("Authenticate to inspect nodes, validators, alerts, incidents, release identity and audit. Operator actions require an explicit approval phrase.")} </p>
        <ul>
          <li>{copy("Viewer: inspect current evidence")}</li>
          <li>{copy("Operator: record and approve bounded workflow state")}</li>
          <li>{copy("Infrastructure execution remains outside this product")}</li>
        </ul>
        <section className="public-status-panel" aria-live="polite">
          <div className="public-status-heading"><span>{copy("PUBLIC TESTNET STATUS")}</span><strong className={`public-service ${publicStatus?.status || "unknown"}`}>{copy(publicStatus?.status || (publicStatusError ? "unavailable" : "checking"))}</strong></div>
          {publicStatus ? (
            <>
              <p>{copy(publicStatus.message || "Current approved public probe projection.")}</p>
              <details className="public-details"><summary>{copy("Service details")} <span>({publicStatus.services.length})</span></summary><div className="public-service-list">
				{publicStatus.services.map((service) => <details key={service.id} className="public-service-row"><summary><span>{copy(service.name)}</span><strong className={`public-service ${service.status}`}>{copy(service.status)}</strong></summary><dl><div><dt>{copy("Source")}</dt><dd>{service.sourceCommit ? short(service.sourceCommit,12) : copy("Unavailable")}</dd></div><div><dt>{copy("Release")}</dt><dd>{service.release || copy("Unavailable")}</dd></div><div><dt>{copy("Started")}</dt><dd>{service.startedAt ? formatDate(service.startedAt) : copy("Unavailable")}</dd></div><div><dt>{copy("Checked")}</dt><dd>{formatDate(service.checkedAt)}</dd></div><div><dt>{copy("Dependencies")}</dt><dd>{service.dependencies.length ? service.dependencies.map((dependency) => `${copy(dependency.id)}: ${copy(dependency.status)}`).join(" · ") : copy("None declared")}</dd></div></dl></details>)}
              </div>
			  <div className="public-trend" aria-label={copy("Process-scoped service trend")}>{publicStatus.history.map((sample,index)=><span key={`${sample.asOf}-${index}`} className={sample.status} title={`${new Date(sample.asOf).toLocaleString(currentLocale())} · ${copy(sample.status)} · ${copy(sample.transition)}`} style={{height:`${Math.max(8,12+(sample.outage+sample.degraded)*6)}px`}} />)}</div>
              <small>{copy("As of")} {formatDate(publicStatus.asOf)} {copy("· process health and owner facts remain separate.")}</small>
			  <small>{copy("Trend retention:")} {copy(publicStatus.historyPersistence)}{copy("; failure and recovery transitions use accepted signed snapshots only.")}</small></details>
            </>
          ) : <p>{copy(publicStatusError || "Loading signed, approved public evidence…")}</p>}
        </section>
		<p className="boundary">{copy("Consensus status: StreamBFT is a shadow/candidate and is not reported as active consensus.")}</p>
      </section>
      <form className="login-card" onSubmit={submit}>
        <div className="login-mobile-brand monitor-brand"><img src={ynxLogo} alt="" /><div>YNX<strong>MONITOR</strong></div></div>
        <div className="login-locales">
          <label>{t("language")}<select
            aria-label={t("language")}
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            {locales.map((x) => (
              <option key={x} value={x}>
                {localeNames[x]}
              </option>
            ))}
          </select></label>
          <label>{t("aiLanguage")}<select
            aria-label={t("aiLanguage")}
            value={aiLanguage}
            onChange={(e) => setAILanguage(e.target.value as Locale)}
          >
            {locales.map((x) => (
              <option key={x} value={x}>
                {localeNames[x]}
              </option>
            ))}
          </select></label>
        </div>
        <p className="kicker">{t("signIn")}</p>
        <h2>{copy("Operator identity")}</h2>
        <label>
          {t("username")}
          <input
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label>
          {t("password")}
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {copy(error)}
          </p>
        )}
        <button disabled={busy}>{busy ? copy("Authenticating…") : t("enter")}</button>
        <WalletLogin onLogin={onLogin} label={t("signIn")} walletProviders={walletProviders} t={t} />
        <small>{t("privacy")}</small>
      </form>
    </main>
  );
}

function WalletLogin({
  onLogin,
  label,
  walletProviders,
  t,
}: {
  onLogin: (s: Session, provider?: WalletProvider, account?: string) => void;
  label: string;
  walletProviders: WalletProvider[];
  t: (key: any) => string;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function begin(wallet: WalletProvider) {
    setError("");
    setBusy(true);
    try {
      const account = selectedAccount(await wallet.provider.request({ method: "eth_requestAccounts" }));
      const network = await ensureYNXTestnet(wallet.provider as EIP1193Provider);
      if (network.chainId !== "0x1917") throw new Error("Wallet did not select YNX Testnet (0x1917).");
      const next = await request<any>("/ops/wallet/challenges", undefined, {
        method: "POST",
        body: JSON.stringify({ accountHint: account }),
      });
      const signedPayload = JSON.stringify(next);
      const signature = await wallet.provider.request({ method: "personal_sign", params: [signedPayload, account] });
      if (typeof signature !== "string" || !/^0x[0-9a-f]{130}$/i.test(signature)) throw new Error("Wallet returned an invalid challenge signature.");
      onLogin(await request<Session>("/ops/wallet/sessions", undefined, {
        method: "POST",
        body: JSON.stringify({ challengeId: next.challengeId, nonce: next.nonce, signature, signedPayload }),
      }), wallet, account);
    } catch (e) {
      setError(t(providerErrorCode(e) === "wallet_rejected" ? "walletRejected" : "walletRequestFailed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="wallet-login">
      <p>{t("walletGuidance")}</p>
      {walletProviders.length ? walletProviders.map((wallet) => (
        <button type="button" key={wallet.id} disabled={busy} onClick={() => void begin(wallet)} aria-label={`${label} · ${wallet.name}`}>
          {wallet.icon ? <img src={wallet.icon} alt="" width="20" height="20" referrerPolicy="no-referrer" /> : null}
          {`${busy ? t("walletConnecting") : label} · ${wallet.name}`}
        </button>
      )) : <p role="status">{t("walletNotFound")}</p>}
      {error && (
        <p className="form-error" role="alert">
          {copy(error)}
        </p>
      )}
      <WalletDownloads />
    </div>
  );
}

function OverviewView({
  overview,
  node,
  identity,
  setView,
}: {
  overview: Overview;
  node?: Probe;
  identity?: Probe;
  setView: (x: string) => void;
}) {
  const firing = overview.alerts.filter((a) => a.state === "firing").length;
  return (
    <>
      <section className="ops-kpis">
        <article>
          <span>{copy("Current probes")}</span>
          <strong>
            {overview.slo.passing}/{overview.slo.total}
          </strong>
          <small>{copy("Passing now")}</small>
        </article>
        <article>
          <span>{copy("Firing alerts")}</span>
          <strong className={firing ? "danger" : ""}>{firing}</strong>
          <small>{copy("Observed failures only")}</small>
        </article>
        <article>
          <span>{copy("Open incidents")}</span>
          <strong>
            {overview.incidents.filter((i) => !["resolved", "postmortem_complete"].includes(i.status)).length}
          </strong>
          <small>{copy("Persisted operator records")}</small>
        </article>
        <article>
          <span>{copy("Source height")}</span>
          <strong>
            {node?.data?.height ?? node?.data?.latestHeight ?? "—"}
          </strong>
          <small>{copy("From /status")}</small>
        </article>
      </section>
      <section className="ops-grid">
        <div className="ops-panel span2">
          <PanelTitle
            eyebrow={copy("Current service evidence")}
            title={copy("Probe matrix")}
            action={
              <button onClick={() => setView("Nodes")}>{copy("Inspect nodes →")}</button>
            }
          />
          <ProbeRows probes={overview.probes} />
        </div>
        <div className="ops-panel">
          <PanelTitle eyebrow={copy("Release control")} title={copy("Identity")} />
          <KeyValue
            data={{
			  release: identity?.data?.release,
			  commit: identity?.data?.sourceCommit,
			  startedAt: identity?.data?.startedAt,
            }}
          />
        </div>
		<div className="ops-panel">
		  <PanelTitle eyebrow={copy("Canonical network evidence")} title={copy("Finality & throughput")} />
		  <KeyValue data={{canonicalHeight:overview.network.canonicalHeight,indexedHeight:overview.network.indexedHeight,indexLag:overview.network.indexLag,finality:overview.network.finality.status,finalityHeight:overview.network.finality.height,blockIntervalSeconds:overview.network.blockIntervalSeconds,tps:overview.network.tps,peerCount:overview.network.peerCount,validators:`${overview.network.observedValidatorCount}/${overview.network.expectedValidatorCount}`}} />
		  <p className="boundary">{copy(overview.network.consensus.streamBFT.statement)}</p>
		</div>
        <div className="ops-panel">
          <PanelTitle eyebrow={copy("Attention queue")} title={copy("Incidents & alerts")} />
          <div className="attention">
            <button onClick={() => setView("Alerts")}>
              <strong>{firing}</strong>
              <span>{copy("Firing alerts")}</span>
            </button>
            <button onClick={() => setView("Incidents")}>
              <strong>{overview.incidents.length}</strong>
              <span>{copy("Total incidents")}</span>
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
function ProbeRows({ probes }: { probes: Probe[] }) {
  return (
    <div className="probe-rows">
      {probes.map((p) => (
        <div key={p.id}>
          <span className={`health ${p.status}`}>{copy(p.status)}</span>
          <strong>{copy(p.label)}</strong>
		  <code>{copy("Bounded configured endpoint")}</code>
          <span>{p.latencyMs === undefined ? "—" : `${p.latencyMs} ms`}</span>
          <time>{formatDate(p.checkedAt, true)}</time>
        </div>
      ))}
    </div>
  );
}
function ProbeView({ title, probes }: { title: string; probes: Probe[] }) {
  return (
    <section className="ops-panel">
      <PanelTitle eyebrow={copy("Authenticated live probes")} title={copy(title)} />
      <ProbeRows probes={probes} />
    </section>
  );
}
function DataTable({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: Record<string, unknown>[];
}) {
  const keys = useMemo(
    () => Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).slice(0, 7),
    [rows],
  );
  return (
    <section className="ops-panel data-panel">
      <PanelTitle eyebrow={copy("Upstream response")} title={copy(title)} />
      {!rows.length ? (
        <Unavailable
          title={empty}
          detail={copy("The current authenticated upstream returned an empty collection.")}
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {keys.map((k) => (
                  <th key={k}>{copy(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={String(row.id ?? row.address ?? i)}>
                  {keys.map((k) => (
                    <td key={k}>
                      {typeof row[k] === "object"
                        ? JSON.stringify(row[k])
                        : String(row[k] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
function ReleaseView({ identity }: { identity?: Probe }) {
  return (
    <section className="ops-panel">
      <PanelTitle
        eyebrow={copy("Non-secret binary identity")}
        title={copy("Release evidence")}
      />
      <KeyValue
        data={{
		  source: identity?.id,
          status: identity?.status,
          httpStatus: identity?.httpStatus,
		  commit: identity?.data?.sourceCommit,
		  release: identity?.data?.release,
		  startedAt: identity?.data?.startedAt,
        }}
      />
      <p className="boundary"> {copy("This view reports upstream identity. It does not infer that a release was independently audited or deployed everywhere.")} </p>
    </section>
  );
}
function SloView({ overview }: { overview: Overview }) {
  return (
    <section className="ops-panel">
      <PanelTitle
        eyebrow={copy("Truthful service-level evidence")}
        title={copy("Current SLO checks")}
      />
      <div className="slo-score">
        <strong>
          {overview.slo.passing}/{overview.slo.total}
        </strong>
        <span>{copy("bounded probes passing at the recorded check time")}</span>
      </div>
      <p className="boundary">{copy(overview.slo.definition)}</p>
      <ProbeRows probes={overview.probes} />
    </section>
  );
}
function IncidentView({
  incidents,
  role,
  session,
  onRefresh,
  onSelect,
}: {
  incidents: Incident[];
  role: string;
  session: Session;
  onRefresh: () => void;
  onSelect: (i: Incident) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="ops-panel">
      <PanelTitle
        eyebrow={copy("Operator-owned case log")}
        title={copy("Incidents")}
        action={
          can(session, "incident:create") ? (
            <button onClick={() => setOpen(true)}>{copy("Record incident")}</button>
          ) : undefined
        }
      />
      {open && (
        <IncidentForm
          session={session}
          done={() => {
            setOpen(false);
            onRefresh();
          }}
        />
      )}
      {!incidents.length ? (
        <Unavailable
          title={copy("No incidents recorded")}
          detail={copy("No incident is created from a template or synthetic alert. Operators may record one with exact source evidence.")}
        />
      ) : (
        <div className="incident-list">
          {incidents.map((i) => (
            <article key={i.id}>
              <span className={`severity ${i.severity}`}>{copy(i.severity)}</span>
              <div>
                <h3>{i.title}</h3>
                <p>
                  {i.source} · {formatDate(i.openedAt)}
                  {i.owner ? ` · ${copy("Owner")}: ${i.owner}` : ` · ${copy("Unassigned")}`}
                </p>
              </div>
              <span>{copy(i.status)}</span>
              <button onClick={() => onSelect(i)}>{copy("AI evidence summary")}</button>
              <IncidentLifecycleControls
                incident={i}
                session={session}
                onRefresh={onRefresh}
              />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
const incidentNextAction: Record<string, { action: string; label: string } | undefined> = {
  open: { action: "acknowledge", label: "Acknowledge incident" },
  acknowledged: { action: "investigate", label: "Start investigation" },
  investigating: { action: "mitigate", label: "Record mitigation" },
  mitigated: { action: "begin_recovery", label: "Begin recovery verification" },
  recovery_verifying: { action: "verify_recovery", label: "Verify recovery" },
  resolved: { action: "reopen", label: "Reopen incident" },
  postmortem_complete: { action: "reopen", label: "Reopen incident" },
};

function IncidentLifecycleControls({
  incident,
  session,
  onRefresh,
}: {
  incident: Incident;
  session: Session;
  onRefresh: () => void;
}) {
  const [owner, setOwner] = useState(incident.owner || "");
  const [summary, setSummary] = useState("");
  const [evidence, setEvidence] = useState("");
  const [postmortemSummary, setPostmortemSummary] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [postmortemEvidence, setPostmortemEvidence] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const next = incidentNextAction[incident.status];
  const mayTransition =
    next &&
    (next.action === "verify_recovery"
      ? can(session, "incident:recovery_verify")
      : can(session, "incident:manage"));

  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await task();
      setSummary("");
      setEvidence("");
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Incident action failed");
    } finally {
      setBusy(false);
    }
  }

  async function assign(e: FormEvent) {
    e.preventDefault();
    await run(() =>
      request(`/ops/incidents/${encodeURIComponent(incident.id)}/assign`, session, {
        method: "POST",
        body: JSON.stringify({ owner, evidence: evidence ? [evidence] : [] }),
      }),
    );
  }

  async function transition(e: FormEvent) {
    e.preventDefault();
    if (!next) return;
    await run(() =>
      request(
        `/ops/incidents/${encodeURIComponent(incident.id)}/actions/${next.action}`,
        session,
        {
          method: "POST",
          body: JSON.stringify({
            summary,
            evidence: evidence ? [evidence] : [],
          }),
        },
      ),
    );
  }

  async function completePostmortem(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request(
        `/ops/incidents/${encodeURIComponent(incident.id)}/postmortem`,
        session,
        {
          method: "POST",
          body: JSON.stringify({
            summary: postmortemSummary,
            rootCause,
            correctiveActions: [correctiveAction],
            evidence: [postmortemEvidence],
          }),
        },
      );
      setPostmortemSummary("");
      setRootCause("");
      setCorrectiveAction("");
      setPostmortemEvidence("");
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Postmortem failed");
    } finally {
      setBusy(false);
    }
  }

  async function exportEvidence() {
    setBusy(true);
    setError("");
    try {
      const data = await request<Record<string, unknown>>(
        `/ops/incidents/${encodeURIComponent(incident.id)}/export`,
        session,
      );
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${incident.id}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="incident-lifecycle">
      <div className="incident-meta">
        <span>{copy("Schema v")}{incident.schemaVersion}</span>
        <span>{incident.timeline?.length || 0} {copy("timeline entries")}</span>
        <button type="button" onClick={exportEvidence} disabled={busy}> {copy("Export evidence")} </button>
      </div>
      {can(session, "incident:manage") && (
        <form className="incident-action" onSubmit={assign}>
          <label> {copy("Owner")} <input
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              placeholder={copy("On-call owner")}
              required
            />
          </label>
          <button disabled={busy || owner === incident.owner}>{copy("Assign")}</button>
        </form>
      )}
      {mayTransition && next && (
        <form className="incident-action" onSubmit={transition}>
          <label> {copy("Transition summary")} <input
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              required
              placeholder={copy("What changed and why")}
            />
          </label>
          <label> {copy("Evidence")} <input
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
              required={next.action === "verify_recovery"}
              placeholder={copy("URL, hash or audit reference")}
            />
          </label>
          <button disabled={busy}>{copy(next.label)}</button>
        </form>
      )}
      {incident.status === "resolved" && can(session, "incident:postmortem") && (
        <form className="incident-postmortem" onSubmit={completePostmortem}>
          <label> {copy("Postmortem summary")} <textarea
              value={postmortemSummary}
              onChange={(event) => setPostmortemSummary(event.target.value)}
              required
            />
          </label>
          <label> {copy("Root cause")} <textarea
              value={rootCause}
              onChange={(event) => setRootCause(event.target.value)}
              required
            />
          </label>
          <label> {copy("Corrective action")} <input
              value={correctiveAction}
              onChange={(event) => setCorrectiveAction(event.target.value)}
              required
            />
          </label>
          <label> {copy("Evidence")} <input
              value={postmortemEvidence}
              onChange={(event) => setPostmortemEvidence(event.target.value)}
              required
            />
          </label>
          <button disabled={busy}>{copy("Complete postmortem")}</button>
        </form>
      )}
      {error && <span className="form-error" role="alert">{copy(error)}</span>}
    </div>
  );
}

function IncidentForm({
  session,
  done,
}: {
  session: Session;
  done: () => void;
}) {
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await request("/ops/incidents", session, {
        method: "POST",
        body: JSON.stringify({ title, source, severity, evidence: [source] }),
      });
      done();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <label> {copy("Title")} <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </label>
      <label> {copy("Severity")} <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="low">{copy("low")}</option>
          <option value="medium">{copy("medium")}</option>
          <option value="high">{copy("high")}</option>
          <option value="critical">{copy("critical")}</option>
        </select>
      </label>
      <label> {copy("Evidence source")} <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          required
          placeholder={copy("URL or audit reference")}
        />
      </label>
      {error && <span role="alert">{copy(error)}</span>}
      <button>{copy("Record with audit")}</button>
    </form>
  );
}
function AlertView({
  alerts,
  role,
  session,
  onRefresh,
}: {
  alerts: Alert[];
  role: string;
  session: Session;
  onRefresh: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  async function ack(id: string) {
    setActionBusy(true); setActionError("");
    try {
    await request(
      `/ops/alerts/${encodeURIComponent(id)}/acknowledge`,
      session,
      { method: "POST", body: JSON.stringify({ approvalPhrase: confirm }) },
    );
    setConfirm("");
    onRefresh();
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Unavailable"); }
    finally { setActionBusy(false); }
  }
  return (
    <section className="ops-panel">
      <PanelTitle eyebrow={copy("Probe-derived attention")} title={copy("Alerts")} />
      {!alerts.length ? (
        <Unavailable
          title={copy("No alerts observed")}
          detail={copy("Alerts appear only after a real upstream probe fails. Empty is a healthy, honest state.")}
        />
      ) : (
        <div className="alert-list">
          {alerts.map((a) => (
            <article key={a.id}>
              <span
                className={`health ${a.state === "firing" ? "unavailable" : "healthy"}`}
              >
                {copy(a.state)}
              </span>
              <div>
                <h3>{a.source}</h3>
                <p>{copy(a.reason)}</p>
                <a href={a.evidenceUrl}>{a.evidenceUrl}</a>
              </div>
              <time>{formatDate(a.lastObservedAt)}</time>
              {can(session, "alert:acknowledge") && a.state === "firing" && (
                <div className="approval">
                  <input
                    aria-label={`${copy("Approval phrase for")} ${a.source}`}
                    placeholder={copy("Type ACKNOWLEDGE")}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                  <button
                    disabled={actionBusy || confirm !== "ACKNOWLEDGE"}
                    onClick={() => ack(a.id)}
                  > {copy("Acknowledge")} </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {actionError && <p className="form-error boundary" role="alert">{copy(actionError)}</p>}
    </section>
  );
}
function BackupView({
  records,
  role,
  session,
  onRefresh,
}: {
  records: Record<string, unknown>[];
  role: string;
  session: Session;
  onRefresh: () => void;
}) {
  return (
    <section className="ops-panel">
      <PanelTitle eyebrow={copy("Evidence register")} title={copy("Backups")} />
      <p className="boundary"> {copy("Monitor records verified backup evidence; it does not claim or execute a backup.")} </p>
      {can(session, "backup:record") && (
        <div className="backup-required">
          <h3>{copy("Backup details required")}</h3>
          <p>{copy("Record creation is unavailable until the artifact, digest, size, retention, encryption, recovery targets and evidence are supplied.")}</p>
          <button disabled aria-disabled="true">{copy("Record evidence")}</button>
        </div>
      )}
      <RawRecords records={records} empty={copy("No backup evidence recorded")} />
    </section>
  );
}
function RollbackView({
  proposals,
  role,
  session,
  identity,
  onRefresh,
}: {
  proposals: Record<string, unknown>[];
  role: string;
  session: Session;
  identity?: Probe;
  onRefresh: () => void;
}) {
  const [reason, setReason] = useState("");
  const [phrase, setPhrase] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  async function propose() {
    setActionBusy(true); setActionError("");
    try {
    await request("/ops/rollback-proposals", session, {
      method: "POST",
      body: JSON.stringify({
		release: identity?.data?.release || "unknown-current-release",
        reason,
        approvalPhrase: phrase,
      }),
    });
    setReason("");
    setPhrase("");
    onRefresh();
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Unavailable"); }
    finally { setActionBusy(false); }
  }
  return (
    <section className="ops-panel rollback">
      <PanelTitle
        eyebrow={copy("Human approval boundary")}
        title={copy("Rollback proposals")}
      />
      <div className="boundary strong"> {copy("A proposal never executes rollback. Central infrastructure ownership remains required after explicit operator approval.")} </div>
      {can(session, "rollback:propose") && (
        <div className="approval-stack">
          <label> {copy("Reason")} <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label> {copy("Explicit phrase")} <input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="APPROVE ROLLBACK PROPOSAL"
            />
          </label>
          <button
            disabled={actionBusy || !reason || phrase !== "APPROVE ROLLBACK PROPOSAL"}
            onClick={propose}
          > {copy("Approve proposal only")} </button>
        </div>
      )}
      <RawRecords records={proposals} empty={copy("No rollback proposal recorded")} />
      {actionError && <p className="form-error boundary" role="alert">{copy(actionError)}</p>}
    </section>
  );
}
function AuditView({ rows }: { rows: Audit[] }) {
  return (
    <section className="ops-panel">
      <PanelTitle eyebrow={copy("Append-first operator evidence")} title={copy("Audit")} />
      {!rows.length ? (
        <Unavailable
          title={copy("No audit events")}
          detail={copy("Authenticated activity will appear here.")}
        />
      ) : (
        <div className="audit-list">
          {rows.map((row) => (
            <div key={row.id}>
              <time>{formatDate(row.at)}</time>
              <strong>{copy(row.action)}</strong>
              <code>{row.target}</code>
              <span>
                {row.actor} · {copy(row.role)}
              </span>
              <b className={`audit-outcome ${row.outcome}`}>{copy(row.outcome)}</b>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
function LogsView({ session }: { session: Session }) {
  const [data, setData] = useState<{
    status: string;
    sources: string[];
    lines: string[];
    source?: string;
    truncated?: boolean;
  }>();
  const [error, setError] = useState("");
  async function load(source?: string) {
    setError("");
    try {
      setData(
        await request(
          `/ops/logs${source ? `?source=${encodeURIComponent(source)}` : ""}`,
          session,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Log source failed");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="ops-panel">
      <PanelTitle eyebrow={copy("Bounded and redacted")} title={copy("Service logs")} />
      {error && (
        <div className="banner error" role="alert">
          {copy(error)}
        </div>
      )}
      {data?.sources.length ? (
        <>
          <div className="log-sources">
            {data.sources.map((source) => (
              <button key={source} onClick={() => load(source)}>
                {source}
              </button>
            ))}
          </div>
          {data.lines.length ? (
            <pre className="log-output">{data.lines.join("\n")}</pre>
          ) : (
            <Unavailable
              title={copy("Select a configured log source")}
              detail={copy("Only server-side allowlisted sources can be read.")}
            />
          )}
        </>
      ) : (
        <Unavailable
          title={copy("No log sources configured")}
          detail={copy("Set the server-side YNX_MONITOR_LOG_SOURCES allowlist. No browser-side placeholder logs are generated.")}
        />
      )}
    </section>
  );
}
function IncidentAI({
  incident,
  session,
  language,
  onClose,
}: {
  incident: Incident;
  session: Session;
  language: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<"preview" | "streaming" | "review">(
    "preview",
  );
  const [output, setOutput] = useState("");
  async function run() {
    setState("streaming");
    setOutput("");
    try {
      const response = await fetch(`/ops/incidents/${incident.id}/ai`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.token}`,
          "X-YNX-CSRF-Token": session.csrfToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ language }),
      });
      if (!response.ok || !response.body)
        throw new Error(
          (await response.json()).error || `HTTP ${response.status}`,
        );
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split("\n"))
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              setOutput((x) => x + (parsed.token ?? parsed.content ?? ""));
            } catch {}
          }
      }
      setState("review");
    } catch (e) {
      setOutput(e instanceof Error ? e.message : "AI unavailable");
      setState("review");
    }
  }
  return (
    <aside className="ai-drawer">
      <button
        className="close"
        onClick={onClose}
        aria-label={copy("Close AI incident summary")}
      >
        ×
      </button>
      <p className="kicker">{copy("YNX AI · advisory only")}</p>
      <h2>{incident.title}</h2>
      <section className="context-preview">
        <h3>{copy("Selected context")}</h3>
        <code>{incident.id}</code>
        <p>{incident.source}</p>
        {incident.evidence.map((e) => (
          <a key={e} href={e}>
            {e}
          </a>
        ))}
      </section>
      <dl>
        <dt>{copy("Provider")}</dt>
        <dd>{copy("Permissioned YNX AI Gateway")}</dd>
        <dt>{copy("Estimated cost")}</dt>
        <dd>{copy("One bounded incident summary")}</dd>
        <dt>{copy("Authority")}</dt>
        <dd> {copy("No acknowledge, restart, key rotation, rollback or state mutation")} </dd>
      </dl>
      {state === "preview" && (
        <button className="primary" onClick={run}> {copy("Allow context once & stream")} </button>
      )}
      {state === "streaming" && (
        <div className="banner">{copy("Streaming evidence-grounded proposal…")}</div>
      )}
      {state === "review" && (
        <>
          <pre>{output}</pre>
          <p className="boundary"> {copy("Proposed runbook steps require independent operator review and the existing approval boundary. Nothing was executed.")} </p>
          <button onClick={() => setState("preview")}>{copy("Retry")}</button>
          <button onClick={onClose}>{copy("Reject result")}</button>
        </>
      )}
    </aside>
  );
}
function PanelTitle({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="panel-title">
      <div>
        <p>{copy(eyebrow)}</p>
        <h2>{copy(title)}</h2>
      </div>
      {action}
    </header>
  );
}
function KeyValue({ data }: { data: Record<string, unknown> }) {
  return (
    <dl className="key-value">
      {Object.entries(data).map(([k, v]) => (
        <div key={k}>
          <dt>{copy(k)}</dt>
          <dd>{v == null ? copy("Unavailable") : ["status", "finality", "validatorSetStatus"].includes(k) ? copy(String(v)) : k.endsWith("At") && typeof v === "string" ? formatDate(v) : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}
function Unavailable({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="unavailable">
      <span>∅</span>
      <strong>{copy(title)}</strong>
      <p>{copy(detail)}</p>
    </div>
  );
}
function RawRecords({
  records,
  empty,
}: {
  records: Record<string, unknown>[];
  empty: string;
}) {
  return records.length ? (
    <div className="raw-records">
      {records.map((r, i) => (
        <pre key={String(r.id ?? i)}>{JSON.stringify(r, null, 2)}</pre>
      ))}
    </div>
  ) : (
    <Unavailable
      title={empty}
      detail={copy("No record is fabricated for presentation.")}
    />
  );
}
