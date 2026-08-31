export type TaskResult = {
  protocolVersion: string;
  taskId: string;
  ok: boolean;
  code: number;
  language: string;
  output: string;
  durationMs: number;
  compiler: {
    executable: string;
    version: string;
    evidence?: Record<string, unknown>;
  };
  artifacts: {
    path: string;
    bytes: number;
    sha256: string;
    content?: string;
  }[];
  sandbox: { kind: string; network: false; writableRoot: string };
  truncated: boolean;
  environmentRevision?: number;
};
export type WorkspaceSnapshot = {
  revision: number;
  updatedAt: string;
  name: string;
  folders: string[];
  files: Record<string, string>;
  open: string[];
  active: string;
};
export type WorkspaceRevision = {
  revision: number;
  createdAt: string;
  source: "mutation" | "restore" | "legacy-backfill";
  restoredFrom: number | null;
  digest: string;
  name: string;
  files: number;
  bytes: number;
};
export type WorkspaceHistory = {
  revisions: WorkspaceRevision[];
  cursor: number;
  nextCursor: number | null;
  retention: {
    mode: "latest-revisions";
    maximumRevisions: number;
    retainedRevisions: number;
  };
};
type StreamEvent =
  | {
      type: "phase";
      phase: string;
      status: "started" | "completed";
      code?: number;
    }
  | {
      type: "output";
      phase: string;
      channel: "stdout" | "stderr";
      data: string;
    }
  | { type: "result"; value: TaskResult }
  | { type: "error"; error: string; code: string };

const READ_RETRY_DELAYS_MS = [0, 700, 1_800] as const;
const RETRYABLE_READ_STATUSES = new Set([502, 503, 504]);

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readableConnectionError(error: unknown) {
  if (error instanceof DOMException && error.name === "TimeoutError") return new Error("YNX Code connection timed out. Check the network and retry.");
  return new Error("YNX Code could not reach its workspace service. Your local edits are still available; retry the connection.", {
    cause: error,
  });
}

/**
 * Retries only idempotent reads. Build, terminal, Git, extension, AI, Wallet,
 * deploy and workspace writes deliberately continue to execute at most once.
 */
export async function boundedReadFetch(path: string, init: RequestInit = {}) {
  const method = String(init.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") throw new Error("boundedReadFetch accepts read-only requests only.");
  let lastError: unknown;
  for (let attempt = 0; attempt < READ_RETRY_DELAYS_MS.length; attempt += 1) {
    if (READ_RETRY_DELAYS_MS[attempt]) await wait(READ_RETRY_DELAYS_MS[attempt]);
    try {
      const timeout = AbortSignal.timeout(12_000),
        signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
        response = await fetch(path, {
          ...init,
          method,
          credentials: "same-origin",
          signal,
        });
      if (!RETRYABLE_READ_STATUSES.has(response.status) || attempt === READ_RETRY_DELAYS_MS.length - 1) return response;
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted) throw error;
      if (attempt === READ_RETRY_DELAYS_MS.length - 1) throw readableConnectionError(error);
    }
  }
  throw readableConnectionError(lastError);
}
export async function runActive(projectId: string, activePath: string, files: Record<string, string>, onEvent?: (event: StreamEvent) => void): Promise<TaskResult> {
  return streamWorkspaceTask(
    {
      protocolVersion: "ynx-code/v1",
      task: "build-run-active",
      projectId,
      activePath,
      files,
      approval: "execute-once",
    },
    onEvent,
  );
}
export async function runProjectTests(projectId: string, files: Record<string, string>, onEvent?: (event: StreamEvent) => void): Promise<TaskResult> {
  return streamWorkspaceTask(
    {
      protocolVersion: "ynx-code/v1",
      task: "test-project",
      projectId,
      files,
      approval: "test-once",
    },
    onEvent,
  );
}
async function streamWorkspaceTask(request: Record<string, unknown>, onEvent?: (event: StreamEvent) => void): Promise<TaskResult> {
  const body = JSON.stringify(request);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch("/runtime/tasks/stream", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body,
    });
    if (response.status === 401 && attempt === 0) {
      await runtimeHealth();
      continue;
    }
    if (!response.ok) {
      const value = await response.json().catch(() => ({ error: `Runtime returned HTTP ${response.status}` }));
      throw new Error(value.error || "Workspace task failed.");
    }
    if (!response.body) throw new Error("Workspace runtime did not provide an output stream.");
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let pending = "",
      result: TaskResult | undefined;
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as StreamEvent;
        onEvent?.(event);
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "result") result = event.value;
      }
      if (done) break;
    }
    if (!result) throw new Error("Workspace task ended without a signed result envelope.");
    return result;
  }
  throw new Error("Workspace session could not be established.");
}
export async function runtimeHealth() {
  const response = await boundedReadFetch("/runtime/health");
  if (!response.ok) throw new Error("Workspace runtime unavailable");
  return response.json();
}

export type RuntimeBuildIdentity = Readonly<{
  status: "source-bound" | "unbound" | "unavailable";
  detail: string;
  version: string | null;
  sourceCommit: string | null;
  sourceTree: string | null;
}>;

const EXACT_GIT_OBJECT = /^[0-9a-f]{40}$/;

/**
 * Treat the public gateway identity as untrusted input. A displayed version is
 * source-bound only when the same response supplies both exact Git objects and
 * the version contains the corresponding commit marker. This is deliberately a
 * read-only diagnostic; it never establishes a Wallet or workspace session.
 */
export function parseRuntimeBuildIdentity(value: unknown): RuntimeBuildIdentity {
  if (!value || typeof value !== "object") return Object.freeze({ status: "unavailable", detail: "RUNTIME_HEALTH_MALFORMED", version: null, sourceCommit: null, sourceTree: null });
  const health = value as { version?: unknown; sourceCommit?: unknown; sourceTree?: unknown };
  const version = typeof health.version === "string" && health.version.length <= 160 ? health.version : null;
  const sourceCommit = typeof health.sourceCommit === "string" && EXACT_GIT_OBJECT.test(health.sourceCommit) ? health.sourceCommit : null;
  const sourceTree = typeof health.sourceTree === "string" && EXACT_GIT_OBJECT.test(health.sourceTree) ? health.sourceTree : null;
  if (!version) return Object.freeze({ status: "unavailable", detail: "RUNTIME_VERSION_MISSING", version: null, sourceCommit, sourceTree });
  if (!sourceCommit && !sourceTree) return Object.freeze({ status: "unbound", detail: "RUNTIME_SOURCE_IDENTITY_MISSING", version, sourceCommit: null, sourceTree: null });
  if (!sourceCommit || !sourceTree) return Object.freeze({ status: "unbound", detail: "RUNTIME_SOURCE_IDENTITY_INCOMPLETE", version, sourceCommit, sourceTree });
  if (!version.includes(sourceCommit.slice(0, 12))) return Object.freeze({ status: "unbound", detail: "RUNTIME_VERSION_SOURCE_MISMATCH", version, sourceCommit, sourceTree });
  return Object.freeze({ status: "source-bound", detail: "RUNTIME_SOURCE_IDENTITY_VERIFIED", version, sourceCommit, sourceTree });
}

/** Fetches the public, same-origin release identity without creating a session. */
export async function loadRuntimeBuildIdentity(): Promise<RuntimeBuildIdentity> {
  try {
    const response = await boundedReadFetch("/healthz", { cache: "no-store" });
    if (!response.ok) return Object.freeze({ status: "unavailable", detail: `RUNTIME_HEALTH_HTTP_${response.status}`, version: null, sourceCommit: null, sourceTree: null });
    return parseRuntimeBuildIdentity(await response.json().catch(() => null));
  } catch {
    return Object.freeze({ status: "unavailable", detail: "RUNTIME_HEALTH_UNAVAILABLE", version: null, sourceCommit: null, sourceTree: null });
  }
}
export type RuntimeProfiles = {
  protocolVersion: string;
  container: {
    engine: string;
    installed: boolean;
    ready: boolean;
    storagePools: number;
    profile: boolean;
  };
  leases: Array<{
    runtimeId: string;
    projectId: string;
    image: string;
    status: string;
    createdAt: string;
  }>;
  sshProfiles: Array<{
    profileId: string;
    label: string;
    host: string;
    port: number;
    user: string;
    fingerprint: string;
    createdAt: string;
  }>;
};
export type EnvironmentEntry = { key: string; kind: "literal"; value: string } | { key: string; kind: "secret-reference"; reference: string };
export type ProjectEnvironment = {
  revision: number;
  updatedAt: string | null;
  entries: EnvironmentEntry[];
};
export type TerminalSession = {
  sessionId: string;
  projectId: string;
  runtimeId?: string;
  status: "attached" | "detached";
  startedAt: string;
  lastActivityAt: string;
  replayBytes: number;
  environmentRevision: number;
};
export type TaskActivity = {
  taskId: string;
  projectId: string;
  kind: "build-run-active" | "test-project";
  status: "queued" | "running" | "stopping";
  queuedAt: string;
  startedAt: string | null;
  environmentRevision: number | null;
};
async function profileFetch(path: string, options: RequestInit = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const init = {
      ...options,
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
    };
    const response = options.method && options.method !== "GET" ? await fetch(path, { credentials: "same-origin", ...init }) : await boundedReadFetch(path, init);
    if (response.status === 401 && attempt === 0) {
      await runtimeHealth();
      continue;
    }
    const value = await response.json().catch(() => ({
      error: `Runtime profile returned HTTP ${response.status}`,
    }));
    if (!response.ok) throw new Error(value.error || "Runtime profile operation failed.");
    return value;
  }
  throw new Error("Workspace session could not be established.");
}
export function loadRuntimeProfiles(): Promise<RuntimeProfiles> {
  return profileFetch("/runtime/profiles");
}
export async function loadProjectEnvironment(projectId: string): Promise<ProjectEnvironment> {
  const value = await profileFetch(`/runtime/projects/${encodeURIComponent(projectId)}/environment`);
  return value.environment;
}
export async function saveProjectEnvironment(projectId: string, expectedRevision: number, entries: EnvironmentEntry[]): Promise<ProjectEnvironment> {
  const value = await profileFetch(`/runtime/projects/${encodeURIComponent(projectId)}/environment`, {
    method: "PUT",
    body: JSON.stringify({
      protocolVersion: "ynx-code-environment/v1",
      approval: "update-environment-once",
      expectedRevision,
      entries,
    }),
  });
  return value.environment;
}
export async function loadTerminalSessions(projectId: string): Promise<TerminalSession[]> {
  const value = await profileFetch(`/runtime/terminals?projectId=${encodeURIComponent(projectId)}`);
  return value.terminals;
}
export async function loadTaskActivities(projectId: string): Promise<TaskActivity[]> {
  const value = await profileFetch("/runtime/tasks/active");
  return value.tasks.filter((task: TaskActivity) => task.projectId === projectId);
}
export function stopTaskActivity(taskId: string) {
  return profileFetch(`/runtime/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
}
export function stopTerminalSession(sessionId: string) {
  return profileFetch(`/runtime/terminals/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}
export function createContainerLease(projectId: string) {
  return profileFetch("/runtime/profiles/lxd/leases", {
    method: "POST",
    body: JSON.stringify({
      protocolVersion: "ynx-code-runtime/v1",
      approval: "create-container-once",
      projectId,
      image: "ubuntu-24.04",
    }),
  });
}
export function removeContainerLease(runtimeId: string) {
  return profileFetch(`/runtime/profiles/lxd/leases/${encodeURIComponent(runtimeId)}`, { method: "DELETE" });
}
export function runContainerActive(runtimeId: string, projectId: string, activePath: string, files: Record<string, string>): Promise<TaskResult> {
  return profileFetch(`/runtime/profiles/lxd/leases/${encodeURIComponent(runtimeId)}/tasks`, {
    method: "POST",
    body: JSON.stringify({
      protocolVersion: "ynx-code-runtime/v1",
      approval: "execute-container-once",
      projectId,
      activePath,
      files,
    }),
  });
}
export type PackageInstallResult = {
  protocolVersion: string;
  ok: true;
  packageSpec: string;
  manager: "npm";
  scripts: false;
  scope: "project-container";
  bytes: number;
  output: string;
  packageJson: string;
  packageLock: string;
  durationMs: number;
  network: { temporary: true; restored: true };
};
export function installContainerPackage(runtimeId: string, projectId: string, packageSpec: string, files: Record<string, string>): Promise<PackageInstallResult> {
  const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
  return profileFetch(`/runtime/profiles/lxd/leases/${encodeURIComponent(runtimeId)}/packages`, {
    method: "POST",
    body: JSON.stringify({
      protocolVersion: "ynx-code-runtime/v1",
      approval: "install-package-once",
      projectId,
      packageSpec,
      packageJson: files["package.json"],
      workspaceBytes: Object.values(files).reduce((total, value) => total + bytes(value), 0),
      workspaceFileCount: Object.keys(files).length,
      previousPackageJsonBytes: bytes(files["package.json"] || ""),
      previousPackageLockBytes: bytes(files["package-lock.json"] || ""),
      hasPackageJson: Object.hasOwn(files, "package.json"),
      hasPackageLock: Object.hasOwn(files, "package-lock.json"),
    }),
  });
}
export type PythonPackageInstallResult = {
  protocolVersion: string;
  ok: true;
  packageSpec: string;
  manager: "pip";
  buildScripts: false;
  binaryOnly: true;
  scope: "project-container";
  bytes: number;
  output: string;
  requirementsLock: string;
  durationMs: number;
  network: { temporary: true; restored: true };
};
export function installContainerPythonPackage(runtimeId: string, projectId: string, packageSpec: string, files: Record<string, string>): Promise<PythonPackageInstallResult> {
  const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
  return profileFetch(`/runtime/profiles/lxd/leases/${encodeURIComponent(runtimeId)}/packages`, {
    method: "POST",
    body: JSON.stringify({
      protocolVersion: "ynx-code-runtime/v1",
      approval: "install-package-once",
      ecosystem: "python",
      projectId,
      packageSpec,
      requirementsLock: files["requirements.ynx.lock"],
      workspaceBytes: Object.values(files).reduce((total, value) => total + bytes(value), 0),
      workspaceFileCount: Object.keys(files).length,
      previousRequirementsBytes: bytes(files["requirements.ynx.lock"] || ""),
      hasRequirementsLock: Object.hasOwn(files, "requirements.ynx.lock"),
    }),
  });
}
export type PortPreviewGrant = {
  previewId: string;
  runtimeId: string;
  projectId: string;
  port: number;
  url: string;
  expiresAt: string;
  sandbox: "opaque-origin";
  network: "container-loopback-only";
  maximumResponseBytes: number;
};
export async function createPortPreview(runtimeId: string, projectId: string, port: number): Promise<PortPreviewGrant> {
  const value = await profileFetch(`/runtime/profiles/lxd/leases/${encodeURIComponent(runtimeId)}/previews`, {
    method: "POST",
    body: JSON.stringify({
      protocolVersion: "ynx-code-runtime/v1",
      approval: "preview-port-once",
      projectId,
      port,
    }),
  });
  return value.preview;
}
export function revokePortPreview(runtimeId: string, previewId: string) {
  return profileFetch(`/runtime/profiles/lxd/leases/${encodeURIComponent(runtimeId)}/previews/${encodeURIComponent(previewId)}`, { method: "DELETE" });
}
export function inspectSshTarget(host: string, port: number, user: string) {
  return profileFetch("/runtime/profiles/ssh/inspect", {
    method: "POST",
    body: JSON.stringify({
      protocolVersion: "ynx-code-runtime/v1",
      host,
      port,
      user,
    }),
  });
}
export function saveSshProfile(value: { host: string; port: number; user: string; label: string; reviewedHostKey: string; privateKey: string }) {
  return profileFetch("/runtime/profiles/ssh", {
    method: "POST",
    body: JSON.stringify({
      protocolVersion: "ynx-code-runtime/v1",
      approval: "connect-ssh-once",
      ...value,
    }),
  });
}
export function removeSshProfile(profileId: string) {
  return profileFetch(`/runtime/profiles/ssh/${encodeURIComponent(profileId)}`, { method: "DELETE" });
}
export type ChainStatus = {
  chainId: number;
  network: string;
  nativeCurrencySymbol: string;
  height: number;
  latestBlockHash: string;
  latestBlockTime: string;
  catchingUp: boolean;
  validatorCount: number;
  readyValidatorCount: number;
  pendingTxCount: number;
  publicNetwork: boolean;
  build?: { commit: string; release: string; buildTime: string };
};
async function chainFetch(path: string, options: RequestInit = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const init = {
      ...options,
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
    };
    const response =
      options.method && options.method !== "GET"
        ? await fetch(`/runtime/chain${path}`, {
            credentials: "same-origin",
            ...init,
          })
        : await boundedReadFetch(`/runtime/chain${path}`, init);
    if (response.status === 401 && attempt === 0) {
      await runtimeHealth();
      continue;
    }
    const value = await response.json().catch(() => ({ error: `Chain tools returned HTTP ${response.status}` }));
    if (!response.ok) throw new Error(value.error || "YNX Chain request failed.");
    return value;
  }
  throw new Error("Workspace session could not be established.");
}
export async function loadChainStatus(): Promise<ChainStatus> {
  return (await chainFetch("/status")).status;
}
export async function chainRpc(method: string, params: unknown[] = []) {
  return (
    await chainFetch("/rpc", {
      method: "POST",
      body: JSON.stringify({
        protocolVersion: "ynx-code-chain/v1",
        method,
        params,
      }),
    })
  ).result;
}
export function debugChainTransaction(hash: string) {
  return chainFetch(`/transactions/${encodeURIComponent(hash)}`);
}
export function debugChainBlock(id: string) {
  return chainFetch(`/blocks/${encodeURIComponent(id)}`);
}
export async function loadChainCompiler() {
  return (await chainFetch("/compiler")).compiler;
}
export type WalletReadiness = {
  protocolVersion: "ynx-code-wallet-readiness/v1";
  gateway: {
    reachable: boolean;
    remoteDeployed: boolean;
    runtimeReady: boolean;
    publicDeploymentReady: boolean;
    build: null | { sourceCommit: string; release: string; buildTime: string };
  };
  developerBinding: {
    productClientId: "ynx-developer-v1";
    bundleId: "com.ynxweb4.developer.testnetpreview";
    callback: "ynxdeveloper://wallet-auth/callback";
    scopes: ["account:read", "developer:deploy"];
    attested: boolean;
    registrySha256: string | null;
    reason: string;
  };
};
export async function loadWalletReadiness(): Promise<WalletReadiness> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await boundedReadFetch("/runtime/wallet/readiness");
    if (response.status === 401 && attempt === 0) {
      await runtimeHealth();
      continue;
    }
    const value = await response.json().catch(() => ({
      error: `Wallet readiness returned HTTP ${response.status}`,
    }));
    if (!response.ok) throw new Error(value.error || "Wallet readiness is unavailable.");
    return value;
  }
  throw new Error("Workspace session could not be established.");
}
export type DeveloperWalletSession = {
  sessionBinding: string;
  productClientId: "ynx-developer-v1";
  bundleId: "com.ynxweb4.developer.testnetpreview";
  productDeviceAlgorithm: "p256-sha256";
  productDeviceKey: string;
  account: string;
  scopes: ["account:read", "developer:deploy"];
  expiresAt: string;
  issuedAt: string;
};
export async function completeDeveloperWalletSession(canonicalBody: string): Promise<DeveloperWalletSession> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch("/runtime/wallet/sessions/complete", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: canonicalBody,
    });
    if (response.status === 401 && attempt === 0) {
      await runtimeHealth();
      continue;
    }
    const value = await response.json().catch(() => ({
      error: `Wallet completion returned HTTP ${response.status}`,
    }));
    if (!response.ok) throw new Error(value.error || "Wallet session completion was rejected.");
    if (value?.session?.productClientId !== "ynx-developer-v1" || value.session.bundleId !== "com.ynxweb4.developer.testnetpreview" || !/^[0-9a-f]{64}$/.test(value.session.sessionBinding || "") || !/^[A-Za-z0-9_-]{44}$/.test(value.session.productDeviceKey || "") || typeof value.session.issuedAt !== "string" || typeof value.session.expiresAt !== "string") throw new Error("Wallet Gateway returned an invalid Developer session binding.");
    return value.session;
  }
  throw new Error("Workspace session could not be established.");
}
export async function introspectDeveloperWalletSession(canonicalProofBody: string): Promise<DeveloperWalletSession> {
  const response = await fetch("/runtime/wallet/sessions/introspect", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: canonicalProofBody,
  });
  const value = await response.json().catch(() => ({
    error: `Wallet introspection returned HTTP ${response.status}`,
  }));
  if (!response.ok) throw new Error(value.error || "Developer Wallet session is inactive.");
  if (value?.introspection?.active !== true || value.introspection.session?.productClientId !== "ynx-developer-v1") throw new Error("Wallet Gateway did not return an active Developer session.");
  return value.introspection.session;
}
export async function broadcastDeveloperDeployment(canonicalBody: string): Promise<{
  transactionHash: string;
  artifactDigest: string;
  account: string;
  confirmed: true;
  receipt: Record<string, unknown>;
}> {
  const response = await fetch("/runtime/wallet/deployments/broadcast", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: canonicalBody,
    }),
    value = await response.json().catch(() => ({
      error: `Deployment broadcast returned HTTP ${response.status}`,
    }));
  if (!response.ok) throw new Error(value.error || "YNX deployment was not confirmed.");
  if (value?.deployment?.confirmed !== true || !/^0x[0-9a-f]{64}$/.test(value.deployment.transactionHash || "") || value.deployment.receipt?.status !== "0x1") throw new Error("YNX Chain did not return a confirmed deployment receipt.");
  return value.deployment;
}
export async function loadWorkspace(projectId: string): Promise<WorkspaceSnapshot | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await boundedReadFetch(`/runtime/workspaces/${encodeURIComponent(projectId)}`);
    if (response.status === 401 && attempt === 0) {
      await runtimeHealth();
      continue;
    }
    if (response.status === 404) return null;
    const value = await response.json().catch(() => ({ error: `Workspace returned HTTP ${response.status}` }));
    if (!response.ok) throw new Error(value.error || "Workspace could not be loaded.");
    return value.workspace;
  }
  throw new Error("Workspace session could not be established.");
}
export async function saveWorkspace(projectId: string, expectedRevision: number, workspace: Omit<WorkspaceSnapshot, "revision" | "updatedAt">): Promise<WorkspaceSnapshot> {
  const response = await fetch(`/runtime/workspaces/${encodeURIComponent(projectId)}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code/v1",
      expectedRevision,
      idempotencyKey: crypto.randomUUID(),
      workspace,
    }),
  });
  const value = await response.json().catch(() => ({ error: `Workspace returned HTTP ${response.status}` }));
  if (!response.ok) throw Object.assign(new Error(value.error || "Workspace could not be saved."), { code: value.code, currentRevision: value.currentRevision });
  return value.workspace;
}
export async function loadWorkspaceHistory(projectId: string, cursor = 0): Promise<WorkspaceHistory> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await boundedReadFetch(`/runtime/workspaces/${encodeURIComponent(projectId)}?view=history&cursor=${cursor}&limit=20`);
    if (response.status === 401 && attempt === 0) {
      await runtimeHealth();
      continue;
    }
    const value = await response.json().catch(() => ({
      error: `Workspace history returned HTTP ${response.status}`,
    }));
    if (!response.ok) throw new Error(value.error || "Workspace history could not be loaded.");
    return value.history;
  }
  throw new Error("Workspace session could not be established.");
}
export async function loadWorkspaceSnapshot(projectId: string, revision: number): Promise<WorkspaceSnapshot> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await boundedReadFetch(`/runtime/workspaces/${encodeURIComponent(projectId)}?view=snapshot&revision=${revision}`);
    if (response.status === 401 && attempt === 0) {
      await runtimeHealth();
      continue;
    }
    const value = await response.json().catch(() => ({
      error: `Workspace revision returned HTTP ${response.status}`,
    }));
    if (!response.ok) throw new Error(value.error || "Workspace revision could not be loaded.");
    return value.workspace;
  }
  throw new Error("Workspace session could not be established.");
}
export async function restoreWorkspaceRevision(projectId: string, expectedRevision: number, sourceRevision: number): Promise<WorkspaceSnapshot> {
  const response = await fetch(`/runtime/workspaces/${encodeURIComponent(projectId)}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code/v1",
      action: "restore",
      approval: "restore-workspace-once",
      approvalId: crypto.randomUUID(),
      expectedRevision,
      sourceRevision,
      idempotencyKey: crypto.randomUUID(),
    }),
  });
  const value = await response.json().catch(() => ({
    error: `Workspace restore returned HTTP ${response.status}`,
  }));
  if (!response.ok) throw Object.assign(new Error(value.error || "Workspace revision could not be restored."), { code: value.code, currentRevision: value.currentRevision });
  return value.workspace;
}
export type LanguageOperation = "completion" | "definition" | "references" | "rename" | "format" | "diagnostics" | "documentSymbols";
export async function languageRequest(language: "cpp" | "typescript" | "python" | "go" | "rust" | "java" | "solidity", files: Record<string, string>, activePath: string, operation: LanguageOperation, position?: { line: number; character: number }, newName?: string, context?: { projectId: string; runtimeId?: string }) {
  const body = JSON.stringify({
    protocolVersion: "ynx-code/v1",
    files,
    activePath,
    operation,
    position,
    newName,
    projectId: context?.projectId,
    runtimeId: context?.runtimeId,
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`/runtime/language/${language}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body,
    });
    if (response.status === 401 && attempt === 0) {
      await runtimeHealth();
      continue;
    }
    const value = await response.json().catch(() => ({
      error: `Language service returned HTTP ${response.status}`,
    }));
    if (!response.ok) throw new Error(value.error || "Language request failed.");
    return value;
  }
  throw new Error("Workspace session could not be established.");
}
export function cppLanguageRequest(files: Record<string, string>, activePath: string, operation: LanguageOperation, position?: { line: number; character: number }, newName?: string, context?: { projectId: string; runtimeId?: string }) {
  return languageRequest("cpp", files, activePath, operation, position, newName, context);
}

export type GitChange = {
  path: string;
  status: string;
  indexStatus: string;
  worktreeStatus: string;
  originalPath?: string;
};
export type GitCommit = {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
};
export type GitBranch = {
  name: string;
  hash: string;
  shortHash: string;
  date: string | null;
};
export type GitStatus = {
  protocolVersion: string;
  initialized: boolean;
  branch: string | null;
  head?: string | null;
  changes: GitChange[];
  commits: GitCommit[];
  branches: GitBranch[];
  workspace?: { revision: number; updatedAt: string; replayed: boolean };
  replayed?: boolean;
};
export type GitRemotePreview = {
  protocolVersion: string;
  initialized: true;
  remoteIntent: {
    operation: "pull" | "push" | "create-pr";
    remoteUrl: string;
    branch: string;
    targetBranch: string | null;
  };
  previewDigest: string;
  executable: false;
  boundary: "server-side-credential-broker-required";
  message: string;
};
export async function gitStatus(projectId: string): Promise<GitStatus> {
  return gitFetch(projectId);
}
export async function gitMutation(projectId: string, body: Record<string, unknown>): Promise<GitStatus> {
  return gitFetch(projectId, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ protocolVersion: "ynx-code-git-v1", ...body }),
  });
}
export async function gitRemotePreview(projectId: string, body: Record<string, unknown>): Promise<GitRemotePreview> {
  return gitFetch(projectId, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code-git-v1",
      action: "remote-preview",
      ...body,
    }),
  });
}
export async function gitDiff(projectId: string, path: string, scope: "working" | "staged") {
  const query = new URLSearchParams({ view: "diff", path, scope }),
    value = await gitFetch(projectId, {}, query);
  return String(value.diff || "");
}
async function gitFetch(projectId: string, init: RequestInit = {}, query?: URLSearchParams): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const path = `/runtime/git/${encodeURIComponent(projectId)}${query ? `?${query}` : ""}`,
      response = init.method && init.method !== "GET" ? await fetch(path, { credentials: "same-origin", ...init }) : await boundedReadFetch(path, init);
    if (response.status === 401 && attempt === 0) {
      await runtimeHealth();
      continue;
    }
    const value = await response.json().catch(() => ({ error: `Git service returned HTTP ${response.status}` }));
    if (!response.ok) throw new Error(value.error || "Git operation failed.");
    return value;
  }
  throw new Error("Workspace session could not be established.");
}

export type ExtensionManifest = {
  apiVersion: "ynx-code-extension/v1";
  kind: "declarative-web";
  publisher: string;
  name: string;
  displayName: string;
  version: string;
  description?: string;
  contributes: {
    languages: Array<{ id: string; aliases: string[]; extensions: string[] }>;
    snippets: Array<{
      language: string;
      label: string;
      prefix: string;
      body: string[];
      description: string;
    }>;
    themes: Array<{
      id: string;
      label: string;
      type: "light" | "dark";
      colors: Record<string, string>;
    }>;
  };
};
export type InstalledExtension = {
  id: string;
  version: string;
  digest: string;
  manifest: ExtensionManifest;
  installedAt: string;
  enabled: boolean;
  source: "local-manifest";
  trust: "validated-declarative-only";
};
export async function loadExtensions(): Promise<InstalledExtension[]> {
  const value = await extensionFetch();
  return value.extensions || [];
}
export async function installExtension(manifest: unknown): Promise<InstalledExtension> {
  const value = await extensionFetch({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code-extension/v1",
      manifest,
    }),
  });
  return value.extension;
}
export async function setExtensionEnabled(id: string, expectedDigest: string, enabled: boolean): Promise<InstalledExtension> {
  const value = await extensionFetch({
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code-extension/v1",
      id,
      expectedDigest,
      enabled,
    }),
  });
  return value.extension;
}
export async function uninstallExtension(id: string, expectedDigest: string): Promise<void> {
  await extensionFetch(
    { method: "DELETE" },
    new URLSearchParams({
      id,
      expectedDigest,
      approval: "uninstall-extension-once",
    }),
  );
}
async function extensionFetch(init: RequestInit = {}, query?: URLSearchParams): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const path = `/runtime/extensions${query ? `?${query}` : ""}`,
      response = init.method && init.method !== "GET" ? await fetch(path, { credentials: "same-origin", ...init }) : await boundedReadFetch(path, init);
    if (response.status === 401 && attempt === 0) {
      await runtimeHealth();
      continue;
    }
    const value = await response.json().catch(() => ({
      error: `Extension registry returned HTTP ${response.status}`,
    }));
    if (!response.ok) throw new Error(value.error || "Extension operation failed.");
    return value;
  }
  throw new Error("Workspace session could not be established.");
}

export type ModelCatalog = {
  hosted: { model: string; available: boolean };
  bringYourOwnKey: Array<{ id: string; label: string; defaultModel: string }>;
};
export type AgentRun = {
  runId: string;
  projectId: string;
  intent: string;
  status: string;
  provider: string;
  model: string;
  workspaceRevision: number;
  plan: {
    summary: string;
    steps: Array<{ title: string; acceptance: string }>;
    contextPaths: string[];
    createPaths: string[];
    deletePaths: string[];
  } | null;
  approvedPaths: string[];
  approvedCreatePaths: string[];
  approvedDeletePaths: string[];
  proposal: {
    summary: string;
    files: Array<{
      path: string;
      content: string;
      operation: "edit" | "create" | "delete";
    }>;
  } | null;
  trash: Array<{
    path: string;
    content: string;
    digest: string;
    deletedRevision: number;
  }>;
  review: { approved: boolean; summary: string; findings: string[] } | null;
  gitOperation: {
    projectId: string;
    workspaceRevision: number;
    initialized: boolean;
    branch: string | null;
    head: string | null;
    message: string;
    files: Array<{
      path: string;
      operation: "add" | "update" | "delete";
      gitStatus: string;
      digest: string;
      bytes: number;
    }>;
    testEvidenceHash: string;
    previewDigest: string;
    preparedAt: string;
    executable: boolean;
    executed?: boolean;
    boundary: "local-only-no-network-no-credentials-no-hooks-no-signing";
    approval?: "git-local-commit-once";
    committedAt?: string;
    commit?: string;
  } | null;
  deployment: {
    target: "ynx-testnet" | "web-preview";
    workspaceRevision: number;
    files: Array<{ path: string; digest: string; bytes: number }>;
    testEvidenceHash: string;
    preparedAt: string;
    executable: false;
    requires: string[];
    boundary: "review-only-no-network-no-signing";
    approval?: "deployment-review-once";
    approvedAt?: string;
  } | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    reportedCalls: number;
    unreportedCalls: number;
    cost: {
      amount: null;
      currency: null;
      status: "unreported-by-provider";
    };
  };
  permissions: Array<{
    id: string;
    level: string;
    status: "available" | "locked" | "used" | "disabled";
    approval: string | null;
    uses: number;
    boundary?: string;
  }>;
};
export async function loadModelCatalog(): Promise<ModelCatalog> {
  return agentFetch("/runtime/models");
}
export async function createAgentRun(body: Record<string, unknown>): Promise<AgentRun> {
  const value = await agentFetch("/runtime/agent/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ protocolVersion: "ynx-code-agent/v1", ...body }),
  });
  return value.run;
}
export async function agentAction(runId: string, body: Record<string, unknown>): Promise<AgentRun> {
  const value = await agentFetch(`/runtime/agent/runs/${encodeURIComponent(runId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ protocolVersion: "ynx-code-agent/v1", ...body }),
  });
  return value.run;
}
async function agentFetch(path: string, init: RequestInit = {}): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = init.method && init.method !== "GET" ? await fetch(path, { credentials: "same-origin", ...init }) : await boundedReadFetch(path, init);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw new Error("AI request was cancelled.");
      throw new Error("AI service connection was interrupted. Your request was not automatically retried; retry it manually.");
    }
    if (response.status === 401 && attempt === 0) {
      await runtimeHealth();
      continue;
    }
    const value = await response.json().catch(() => ({
      error: `Agent service returned HTTP ${response.status}`,
    }));
    if (!response.ok) throw new Error(value.error || "Agent operation failed.");
    return value;
  }
  throw new Error("Workspace session could not be established.");
}
export async function indexProjectMemory(projectId: string, expectedRevision: number) {
  return agentFetch(`/runtime/memory/${encodeURIComponent(projectId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code-memory/v1",
      action: "rebuild",
      expectedRevision,
    }),
  });
}
export type ProjectMemoryStatus = {
  protocolVersion: "ynx-code-memory/v1";
  projectId: string;
  chunks: number;
  revision: number | null;
  dimensions: number;
  indexedAt: string | null;
  embeddingModel: string;
  retention: {
    mode: "current-index-only";
    revisionsRetained: 1;
    expiresAutomatically: false;
    deleteTriggers: string[];
  };
  coverage: "text-vectors-declarations-and-file-relations";
  facts: number;
  symbols: number;
  relationships: number;
  languages: string[];
  embeddedChunks?: number;
  reusedChunks?: number;
  indexedFacts?: number;
};
export async function loadProjectMemory(projectId: string): Promise<ProjectMemoryStatus> {
  return agentFetch(`/runtime/memory/${encodeURIComponent(projectId)}`);
}
export type ProjectMemoryFact = {
  revision: number;
  path: string;
  type: "file" | "symbol" | "relation";
  name: string;
  kind: string;
  targetPath: string | null;
  line: number;
  digest: string;
  indexedAt: string;
};
export async function loadProjectMemoryFacts(projectId: string, expectedRevision: number): Promise<ProjectMemoryFact[]> {
  const query = new URLSearchParams({
    view: "facts",
    cursor: "0",
    limit: "50",
    expectedRevision: String(expectedRevision),
  });
  const page = await agentFetch(`/runtime/memory/${encodeURIComponent(projectId)}?${query}`);
  return page.facts;
}
export async function clearProjectMemory(projectId: string, expectedRevision: number | null) {
  return agentFetch(
    `/runtime/memory/${encodeURIComponent(projectId)}?${new URLSearchParams({
      expectedRevision: String(expectedRevision),
      approval: "clear-memory-once",
    })}`,
    { method: "DELETE" },
  );
}
export async function exportProjectMemory(projectId: string) {
  const chunks: unknown[] = [],
    facts: unknown[] = [];
  let cursor: number | null = 0,
    project: ProjectMemoryStatus | undefined,
    exportedAt = "",
    expectedRevision: number | null | undefined;
  while (cursor !== null) {
    const query = new URLSearchParams({
      view: "export",
      cursor: String(cursor),
      limit: "100",
    });
    if (expectedRevision !== undefined) query.set("expectedRevision", String(expectedRevision));
    const page = await agentFetch(`/runtime/memory/${encodeURIComponent(projectId)}?${query}`);
    project = page.project;
    expectedRevision = project?.revision;
    exportedAt = page.exportedAt;
    chunks.push(...page.chunks);
    cursor = page.nextCursor;
  }
  cursor = 0;
  while (cursor !== null) {
    const query = new URLSearchParams({
      view: "facts",
      cursor: String(cursor),
      limit: "100",
      expectedRevision: String(expectedRevision),
    });
    const page = await agentFetch(`/runtime/memory/${encodeURIComponent(projectId)}?${query}`);
    facts.push(...page.facts);
    cursor = page.nextCursor;
  }
  return {
    protocolVersion: "ynx-code-memory/v1",
    exportedAt,
    project,
    chunks,
    facts,
  };
}
export async function searchProjectMemory(projectId: string, query: string) {
  return agentFetch(`/runtime/memory/${encodeURIComponent(projectId)}?${new URLSearchParams({ q: query, limit: "8" })}`);
}

export type CollaborationRole = "owner" | "editor" | "reviewer" | "viewer" | "terminal";
export type CollaborationAccess = {
  protocolVersion: string;
  roomId: string;
  projectId: string;
  role: CollaborationRole;
  members?: CollaborationMember[];
};
export type CollaborationMember = {
  subjectId: string;
  role: CollaborationRole;
  grantedAt: string;
};
export async function createCollaborationRoom(projectId: string): Promise<CollaborationAccess> {
  return collaborationFetch("/runtime/collaboration/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
}
export async function collaborationAccess(roomId: string): Promise<CollaborationAccess> {
  return collaborationFetch(`/runtime/collaboration/rooms/${encodeURIComponent(roomId)}`);
}
export async function createCollaborationInvite(
  roomId: string,
  role: Exclude<CollaborationRole, "owner">,
  expiresMinutes = 60,
): Promise<{
  token: string;
  role: CollaborationRole;
  expiresAt: string;
  singleUse: true;
}> {
  return collaborationFetch("/runtime/collaboration/invites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId, role, expiresMinutes }),
  });
}
export async function redeemCollaborationInvite(token: string): Promise<CollaborationAccess> {
  return collaborationFetch("/runtime/collaboration/invites/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
}
export async function revokeCollaborationMember(roomId: string, subjectId: string): Promise<{ members: CollaborationMember[] }> {
  return collaborationFetch(`/runtime/collaboration/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(subjectId)}?approval=revoke-member-once`, { method: "DELETE" });
}
async function collaborationFetch(path: string, init: RequestInit = {}): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = init.method && init.method !== "GET" ? await fetch(path, { credentials: "same-origin", ...init }) : await boundedReadFetch(path, init);
    if (response.status === 401 && attempt === 0) {
      await runtimeHealth();
      continue;
    }
    const value = await response.json().catch(() => ({
      error: `Collaboration service returned HTTP ${response.status}`,
    }));
    if (!response.ok) throw Object.assign(new Error(value.error || "Collaboration operation failed."), { code: value.code, status: response.status });
    return value;
  }
  throw new Error("Workspace session could not be established.");
}
