import { FormEvent, useEffect, useMemo, useState } from "react";
import { login, request, type Session } from "./api";
import { localeNames, locales, type Locale, useI18n } from "./i18n";

interface Probe {
  id: string;
  label: string;
  url: string;
  status: "healthy" | "unavailable";
  checkedAt: string;
  latencyMs?: number;
  httpStatus?: number;
  data?: any;
  error?: string;
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
  id: string;
  title: string;
  severity: string;
  status: string;
  openedAt: string;
  source: string;
  evidence: string[];
  notes: string[];
}
interface Overview {
  checkedAt: string;
  probes: Probe[];
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
    return JSON.parse(
      sessionStorage.getItem("ynx-monitor-session") || "null",
    ) as Session | null;
  } catch {
    return null;
  }
}
function short(value?: string, size = 12) {
  return value ? `${value.slice(0, size)}…` : "Unavailable";
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
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, [session]);
  function onLogin(next: Session) {
    sessionStorage.setItem("ynx-monitor-session", JSON.stringify(next));
    setSession(next);
  }
  function logout() {
    sessionStorage.removeItem("ynx-monitor-session");
    setSession(null);
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
          <span>Y</span>
          <div>
            YNX<strong>MONITOR</strong>
          </div>
        </div>
        <nav aria-label="Monitor views">
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
          <strong>{t(role)}</strong>
          <button onClick={logout}>{t("signOut")}</button>
        </div>
      </aside>
      <main className="workspace">
        <header className="commandbar">
          <div>
            <p>OPERATIONS / {view.toUpperCase()}</p>
            <h1>{view}</h1>
          </div>
          <div className="command-actions">
            <span className={`role ${role}`}>{role}</span>
            <button onClick={refresh} disabled={loading}>
              {loading ? "Probing…" : "Refresh evidence"}
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
            <strong>Control plane unavailable</strong>
            <span>{error}</span>
            <button onClick={refresh}>{t("retry")}</button>
          </div>
        )}
        {!overview && !error && (
          <div
            className="loading-grid"
            aria-label="Loading operational evidence"
          >
            Probing authenticated upstreams…
          </div>
        )}
        {overview && (
          <>
            <div className="evidence-clock">
              <span className="live-dot" />
              Bounded probe completed <time>{date(overview.checkedAt)}</time>
              <span>No historical uptime inferred</span>
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
                title="Node surfaces"
                probes={probes.filter((x) =>
                  ["node", "explorer", "indexer", "ai"].includes(x.id),
                )}
              />
            )}
            {view === "Validators" && (
              <DataTable
                title="Validator evidence"
                empty="No validator records returned"
                rows={validators}
              />
            )}
            {view === "Peers" && (
              <>
                <DataTable
                  title="Peer discovery"
                  empty="No peer records returned"
                  rows={peers}
                />
                <DataTable
                  title="Peer sync"
                  empty="No peer-sync records returned"
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
}: {
  onLogin: (s: Session) => void;
  locale: Locale;
  aiLanguage: Locale;
  setLocale: (x: Locale) => void;
  setAILanguage: (x: Locale) => void;
  t: (key: any) => string;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
          <span>Y</span>
          <div>
            YNX<strong>MONITOR</strong>
          </div>
        </div>
        <p className="kicker">{t("restricted")}</p>
        <h1>{t("evidenceBefore")}</h1>
        <p>
          Authenticate to inspect nodes, validators, alerts, incidents, release
          identity and audit. Operator actions require an explicit approval
          phrase.
        </p>
        <ul>
          <li>Viewer: inspect current evidence</li>
          <li>Operator: record and approve bounded workflow state</li>
          <li>Infrastructure execution remains outside this product</li>
        </ul>
      </section>
      <form className="login-card" onSubmit={submit}>
        <div className="login-locales">
          <select
            aria-label={t("language")}
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            {locales.map((x) => (
              <option key={x} value={x}>
                {localeNames[x]}
              </option>
            ))}
          </select>
          <select
            aria-label={t("aiLanguage")}
            value={aiLanguage}
            onChange={(e) => setAILanguage(e.target.value as Locale)}
          >
            {locales.map((x) => (
              <option key={x} value={x}>
                {localeNames[x]}
              </option>
            ))}
          </select>
        </div>
        <p className="kicker">{t("signIn")}</p>
        <h2>Operator identity</h2>
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
            {error}
          </p>
        )}
        <button disabled={busy}>{busy ? "Authenticating…" : t("enter")}</button>
        <WalletLogin onLogin={onLogin} label={t("walletSignIn")} />
        <small>{t("privacy")}</small>
      </form>
    </main>
  );
}

function WalletLogin({
  onLogin,
  label,
}: {
  onLogin: (s: Session) => void;
  label: string;
}) {
  const [challenge, setChallenge] = useState<any>();
  const [signature, setSignature] = useState("");
  const [payload, setPayload] = useState("");
  const [error, setError] = useState("");
  async function begin() {
    setError("");
    try {
      const next = await request<any>("/ops/wallet/challenges", undefined, {
        method: "POST",
        body: "{}",
      });
      setChallenge(next);
      setPayload(JSON.stringify(next));
      location.href = `ynx-wallet://authorize?challenge=${encodeURIComponent(JSON.stringify(next))}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet unavailable");
    }
  }
  async function complete() {
    try {
      onLogin(
        await request<Session>("/ops/wallet/sessions", undefined, {
          method: "POST",
          body: JSON.stringify({
            challengeId: challenge.challengeId,
            nonce: challenge.nonce,
            signature,
            signedPayload: payload,
          }),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet verification failed");
    }
  }
  return (
    <div className="wallet-login">
      <button type="button" onClick={begin}>
        {label}
      </button>
      {challenge && (
        <>
          <p>
            Challenge expires{" "}
            {new Date(challenge.expiresAt).toLocaleTimeString()}. Complete
            signing in the wallet, then paste its signature.
          </p>
          <textarea
            aria-label="Signed wallet payload"
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
          />
          <input
            aria-label="Wallet signature"
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="Wallet signature"
          />
          <button
            type="button"
            disabled={!signature || !payload}
            onClick={complete}
          >
            Verify signed challenge
          </button>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
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
          <span>Current probes</span>
          <strong>
            {overview.slo.passing}/{overview.slo.total}
          </strong>
          <small>Passing now</small>
        </article>
        <article>
          <span>Firing alerts</span>
          <strong className={firing ? "danger" : ""}>{firing}</strong>
          <small>Observed failures only</small>
        </article>
        <article>
          <span>Open incidents</span>
          <strong>
            {overview.incidents.filter((i) => i.status !== "resolved").length}
          </strong>
          <small>Persisted operator records</small>
        </article>
        <article>
          <span>Source height</span>
          <strong>
            {node?.data?.height ?? node?.data?.latestHeight ?? "—"}
          </strong>
          <small>From /status</small>
        </article>
      </section>
      <section className="ops-grid">
        <div className="ops-panel span2">
          <PanelTitle
            eyebrow="Current service evidence"
            title="Probe matrix"
            action={
              <button onClick={() => setView("Nodes")}>Inspect nodes →</button>
            }
          />
          <ProbeRows probes={overview.probes} />
        </div>
        <div className="ops-panel">
          <PanelTitle eyebrow="Release control" title="Identity" />
          <KeyValue
            data={{
              release: identity?.data?.build?.release,
              commit: identity?.data?.build?.commit,
              buildTime: identity?.data?.build?.buildTime,
              replicationMode: identity?.data?.replicationMode,
            }}
          />
        </div>
        <div className="ops-panel">
          <PanelTitle eyebrow="Attention queue" title="Incidents & alerts" />
          <div className="attention">
            <button onClick={() => setView("Alerts")}>
              <strong>{firing}</strong>
              <span>Firing alerts</span>
            </button>
            <button onClick={() => setView("Incidents")}>
              <strong>{overview.incidents.length}</strong>
              <span>Total incidents</span>
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
          <span className={`health ${p.status}`}>{p.status}</span>
          <strong>{p.label}</strong>
          <code>{p.url}</code>
          <span>{p.latencyMs === undefined ? "—" : `${p.latencyMs} ms`}</span>
          <time>{new Date(p.checkedAt).toLocaleTimeString()}</time>
        </div>
      ))}
    </div>
  );
}
function ProbeView({ title, probes }: { title: string; probes: Probe[] }) {
  return (
    <section className="ops-panel">
      <PanelTitle eyebrow="Authenticated live probes" title={title} />
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
      <PanelTitle eyebrow="Upstream response" title={title} />
      {!rows.length ? (
        <Unavailable
          title={empty}
          detail="The current authenticated upstream returned an empty collection."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {keys.map((k) => (
                  <th key={k}>{k}</th>
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
        eyebrow="Non-secret binary identity"
        title="Release evidence"
      />
      <KeyValue
        data={{
          source: identity?.url,
          status: identity?.status,
          httpStatus: identity?.httpStatus,
          commit: identity?.data?.build?.commit,
          release: identity?.data?.build?.release,
          buildTime: identity?.data?.build?.buildTime,
          validatorAddress: identity?.data?.validatorAddress,
          replicationMode: identity?.data?.replicationMode,
        }}
      />
      <p className="boundary">
        This view reports upstream identity. It does not infer that a release
        was independently audited or deployed everywhere.
      </p>
    </section>
  );
}
function SloView({ overview }: { overview: Overview }) {
  return (
    <section className="ops-panel">
      <PanelTitle
        eyebrow="Truthful service-level evidence"
        title="Current SLO checks"
      />
      <div className="slo-score">
        <strong>
          {overview.slo.passing}/{overview.slo.total}
        </strong>
        <span>bounded probes passing at the recorded check time</span>
      </div>
      <p className="boundary">{overview.slo.definition}</p>
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
        eyebrow="Operator-owned case log"
        title="Incidents"
        action={
          role === "operator" ? (
            <button onClick={() => setOpen(true)}>Record incident</button>
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
          title="No incidents recorded"
          detail="No incident is created from a template or synthetic alert. Operators may record one with exact source evidence."
        />
      ) : (
        <div className="incident-list">
          {incidents.map((i) => (
            <article key={i.id}>
              <span className={`severity ${i.severity}`}>{i.severity}</span>
              <div>
                <h3>{i.title}</h3>
                <p>
                  {i.source} · {new Date(i.openedAt).toLocaleString()}
                </p>
              </div>
              <span>{i.status}</span>
              <button onClick={() => onSelect(i)}>AI evidence summary</button>
            </article>
          ))}
        </div>
      )}
    </section>
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
      <label>
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </label>
      <label>
        Severity
        <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option>low</option>
          <option>medium</option>
          <option>high</option>
          <option>critical</option>
        </select>
      </label>
      <label>
        Evidence source
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          required
          placeholder="URL or audit reference"
        />
      </label>
      {error && <span role="alert">{error}</span>}
      <button>Record with audit</button>
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
  async function ack(id: string) {
    await request(
      `/ops/alerts/${encodeURIComponent(id)}/acknowledge`,
      session,
      { method: "POST", body: JSON.stringify({ approvalPhrase: confirm }) },
    );
    setConfirm("");
    onRefresh();
  }
  return (
    <section className="ops-panel">
      <PanelTitle eyebrow="Probe-derived attention" title="Alerts" />
      {!alerts.length ? (
        <Unavailable
          title="No alerts observed"
          detail="Alerts appear only after a real upstream probe fails. Empty is a healthy, honest state."
        />
      ) : (
        <div className="alert-list">
          {alerts.map((a) => (
            <article key={a.id}>
              <span
                className={`health ${a.state === "firing" ? "unavailable" : "healthy"}`}
              >
                {a.state}
              </span>
              <div>
                <h3>{a.source}</h3>
                <p>{a.reason}</p>
                <a href={a.evidenceUrl}>{a.evidenceUrl}</a>
              </div>
              <time>{new Date(a.lastObservedAt).toLocaleString()}</time>
              {role === "operator" && a.state === "firing" && (
                <div className="approval">
                  <input
                    aria-label={`Approval phrase for ${a.source}`}
                    placeholder="Type ACKNOWLEDGE"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                  <button
                    disabled={confirm !== "ACKNOWLEDGE"}
                    onClick={() => ack(a.id)}
                  >
                    Acknowledge
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
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
  const [evidence, setEvidence] = useState("");
  async function record() {
    await request("/ops/backup-records", session, {
      method: "POST",
      body: JSON.stringify({ evidence }),
    });
    setEvidence("");
    onRefresh();
  }
  return (
    <section className="ops-panel">
      <PanelTitle eyebrow="Evidence register" title="Backups" />
      <p className="boundary">
        Monitor records verified backup evidence; it does not claim or execute a
        backup.
      </p>
      {role === "operator" && (
        <div className="approval">
          <input
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="Backup artifact hash or verified location"
          />
          <button disabled={!evidence} onClick={record}>
            Record evidence
          </button>
        </div>
      )}
      <RawRecords records={records} empty="No backup evidence recorded" />
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
  async function propose() {
    await request("/ops/rollback-proposals", session, {
      method: "POST",
      body: JSON.stringify({
        release: identity?.data?.build?.release || "unknown-current-release",
        reason,
        approvalPhrase: phrase,
      }),
    });
    setReason("");
    setPhrase("");
    onRefresh();
  }
  return (
    <section className="ops-panel rollback">
      <PanelTitle
        eyebrow="Human approval boundary"
        title="Rollback proposals"
      />
      <div className="boundary strong">
        A proposal never executes rollback. Central infrastructure ownership
        remains required after explicit operator approval.
      </div>
      {role === "operator" && (
        <div className="approval-stack">
          <label>
            Reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label>
            Explicit phrase
            <input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="APPROVE ROLLBACK PROPOSAL"
            />
          </label>
          <button
            disabled={!reason || phrase !== "APPROVE ROLLBACK PROPOSAL"}
            onClick={propose}
          >
            Approve proposal only
          </button>
        </div>
      )}
      <RawRecords records={proposals} empty="No rollback proposal recorded" />
    </section>
  );
}
function AuditView({ rows }: { rows: Audit[] }) {
  return (
    <section className="ops-panel">
      <PanelTitle eyebrow="Append-first operator evidence" title="Audit" />
      {!rows.length ? (
        <Unavailable
          title="No audit events"
          detail="Authenticated activity will appear here."
        />
      ) : (
        <div className="audit-list">
          {rows.map((row) => (
            <div key={row.id}>
              <time>{new Date(row.at).toLocaleString()}</time>
              <strong>{row.action}</strong>
              <code>{row.target}</code>
              <span>
                {row.actor} · {row.role}
              </span>
              <b>{row.outcome}</b>
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
      <PanelTitle eyebrow="Bounded and redacted" title="Service logs" />
      {error && (
        <div className="banner error" role="alert">
          {error}
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
              title="Select a configured log source"
              detail="Only server-side allowlisted sources can be read."
            />
          )}
        </>
      ) : (
        <Unavailable
          title="No log sources configured"
          detail="Set the server-side YNX_MONITOR_LOG_SOURCES allowlist. No browser-side placeholder logs are generated."
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
        aria-label="Close AI incident summary"
      >
        ×
      </button>
      <p className="kicker">YNX AI · advisory only</p>
      <h2>{incident.title}</h2>
      <section className="context-preview">
        <h3>Selected context</h3>
        <code>{incident.id}</code>
        <p>{incident.source}</p>
        {incident.evidence.map((e) => (
          <a key={e} href={e}>
            {e}
          </a>
        ))}
      </section>
      <dl>
        <dt>Provider</dt>
        <dd>Permissioned YNX AI Gateway</dd>
        <dt>Estimated cost</dt>
        <dd>One bounded incident summary</dd>
        <dt>Authority</dt>
        <dd>
          No acknowledge, restart, key rotation, rollback or state mutation
        </dd>
      </dl>
      {state === "preview" && (
        <button className="primary" onClick={run}>
          Allow context once & stream
        </button>
      )}
      {state === "streaming" && (
        <div className="banner">Streaming evidence-grounded proposal…</div>
      )}
      {state === "review" && (
        <>
          <pre>{output}</pre>
          <p className="boundary">
            Proposed runbook steps require independent operator review and the
            existing approval boundary. Nothing was executed.
          </p>
          <button onClick={() => setState("preview")}>Retry</button>
          <button onClick={onClose}>Reject result</button>
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
        <p>{eyebrow}</p>
        <h2>{title}</h2>
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
          <dt>{k}</dt>
          <dd>{String(v ?? "Unavailable")}</dd>
        </div>
      ))}
    </dl>
  );
}
function Unavailable({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="unavailable">
      <span>∅</span>
      <strong>{title}</strong>
      <p>{detail}</p>
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
      detail="No record is fabricated for presentation."
    />
  );
}
