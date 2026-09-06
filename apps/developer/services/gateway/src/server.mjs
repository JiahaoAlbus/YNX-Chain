import { createActivityRegistry, guardRequests, createMaintenance, writeMaintenanceReceipt } from "./activity.mjs";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGateway } from "./gateway.mjs";
import { createWorkspaceRuntime } from "../../workspace-agent/src/runtime.mjs";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { runCppLanguageRequest } from "../../language-service/src/cpp-lsp.mjs";
import { runTypescriptLanguageRequest } from "../../language-service/src/typescript-lsp.mjs";
import { runPythonLanguageRequest } from "../../language-service/src/python-lsp.mjs";
import { runGoLanguageRequest } from "../../language-service/src/go-lsp.mjs";
import { runRustLanguageRequest } from "../../language-service/src/rust-lsp.mjs";
import { runSolidityLanguageRequest } from "../../language-service/src/solidity-lsp.mjs";
import { runJavaLanguageRequest } from "../../language-service/src/java-lsp.mjs";
import { createTerminalService } from "../../terminal-service/src/service.mjs";
import { createDebugService } from "../../debug-service/src/service.mjs";
import { createGitService } from "../../git-service/src/service.mjs";
import { createExtensionRegistry } from "../../extension-registry/src/service.mjs";
import { createModelRouter } from "../../model-router/src/router.mjs";
import { createAgentOrchestrator } from "../../agent-orchestrator/src/service.mjs";
import { createProjectMemory } from "../../project-memory/src/service.mjs";
import { createCollaborationService } from "../../collaboration-service/src/service.mjs";
import { createRuntimeProfileService } from "../../runtime-profile-service/src/service.mjs";
import { createChainService } from "../../chain-service/src/service.mjs";
import { createWalletReadinessService } from "../../wallet-readiness/src/service.mjs";
import { createEnvironmentService } from "../../environment-service/src/service.mjs";

if (process.env.NODE_ENV === "production" && !process.env.YNX_CODE_WORKSPACE_SESSION_KEY) throw new Error("YNX_CODE_WORKSPACE_SESSION_KEY is required in production.");
const port = Number(process.env.PORT || 4190),
  host = process.env.HOST || "127.0.0.1",
  staticRoot = process.env.YNX_CODE_STATIC_ROOT || fileURLToPath(new URL("../../../frontend/dist", import.meta.url)),
  stateDir = process.env.YNX_CODE_STATE_DIR || join(process.cwd(), ".ynx-code");
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const activity = createActivityRegistry();
let runtimeProfileService, runtime;
const routedLanguageRequest = (runner) => (request, context) => activity.operation("language", signal =>
  request.runtimeId
    ? runner(request, {
        signal,
        processFactory: (value) =>
          runtimeProfileService.openContainerLanguageProcess({
            owner: context.owner,
            runtimeId: request.runtimeId,
            projectId: request.projectId,
            files: value.files,
            config: value.config,
          }),
      })
    : runner(request, { signal }));
const workspaceStore = createWorkspaceStore({ filename: join(stateDir, "workspaces.sqlite") });
const environmentService = createEnvironmentService({
  filename: join(stateDir, "environments.sqlite"),
  ownerForRequest: (request) => runtime?.ownerForRequest(request) || null,
});
runtime = createWorkspaceRuntime({
  workspaceStore,
  environmentResolver: (owner, projectId) => environmentService.resolve(owner, projectId),
  languageRequests: {
    cpp: routedLanguageRequest(runCppLanguageRequest),
    typescript: routedLanguageRequest(runTypescriptLanguageRequest),
    python: routedLanguageRequest(runPythonLanguageRequest),
    go: routedLanguageRequest(runGoLanguageRequest),
    rust: routedLanguageRequest(runRustLanguageRequest),
    solidity: routedLanguageRequest(runSolidityLanguageRequest),
    java: routedLanguageRequest(runJavaLanguageRequest),
  },
});
const gitService = createGitService({
  workspaceStore,
  ownerForRequest: (request) => runtime.ownerForRequest(request),
  root: join(stateDir, "git"),
});
const extensionRegistry = createExtensionRegistry({
  filename: join(stateDir, "extensions.sqlite"),
  ownerForRequest: (request) => runtime.ownerForRequest(request),
});
const modelRouter = createModelRouter({
  activity,
  ownerForRequest: (request) => runtime.ownerForRequest(request),
});
const projectMemory = createProjectMemory({
  filename: join(stateDir, "memory.sqlite"),
  ownerForRequest: (request) => runtime.ownerForRequest(request),
  workspaceStore,
});
const agentOrchestrator = createAgentOrchestrator({
  filename: join(stateDir, "agent.sqlite"),
  ownerForRequest: (request) => runtime.ownerForRequest(request),
  workspaceStore,
  modelRouter,
  projectMemory,
  workspaceRuntime: runtime,
  gitService,
});
const collaborationService = createCollaborationService({
  filename: join(stateDir, "collaboration.sqlite"),
  ownerForRequest: (request) => runtime.ownerForRequest(request),
  workspaceStore,
});
runtimeProfileService = createRuntimeProfileService({
  filename: join(stateDir, "runtime-profiles.sqlite"),
  ownerForRequest: (request) => runtime.ownerForRequest(request),
  environmentResolver: (owner, projectId) => environmentService.resolve(owner, projectId),
});
const chainService = createChainService({
  ownerForRequest: (request) => runtime.ownerForRequest(request),
});
const walletReadinessService = createWalletReadinessService({
  ownerForRequest: (request) => runtime.ownerForRequest(request),
});
const terminalService = createTerminalService({
  root: join(stateDir, "terminal-workspaces"),
  workspaceStore,
  ownerForRequest: (request) => runtime.ownerForRequest(request),
  containerTerminalBroker: runtimeProfileService,
  environmentService,
});
const server = createServer(
  guardRequests(activity, createGateway({
    activity,
    staticRoot,
    runtime,
    handlers: [collaborationService.handler, runtimeProfileService.handler, environmentService.handler, terminalService.handler, chainService.handler, walletReadinessService.handler, gitService.handler, extensionRegistry.handler, modelRouter.handler, agentOrchestrator.handler, projectMemory.handler],
  })),
);
const debugService = createDebugService({
  workspaceStore,
  ownerForRequest: (request) => runtime.ownerForRequest(request),
  containerDebugBroker: runtimeProfileService,
});
server.on("upgrade", (request, socket, head) => {
  if (!activity.accepting()) {
    socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 30\r\nContent-Length: 0\r\n\r\n");
    return;
  }
  try {
    if (collaborationService.handleUpgrade(request, socket, head) || terminalService.handleUpgrade(request, socket, head) || debugService.handleUpgrade(request, socket, head)) return;
  } catch {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    return;
  }
  socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  socket.destroy();
});
server.listen(port, host, () => console.log(`YNX Code Gateway http://${host}:${port}`));
// Requests remain registered through handler settlement, including work that
// survives a disconnected response. Interactive startup and final persistence
// have independent counters and are closed before SQLite stores.
activity.observe("compile", () => ({ active: runtime.status().active, queued: runtime.status().queued }));
activity.observe("ai", () => ({ active: modelRouter.catalog().active, queued: modelRouter.catalog().queued }));
activity.observe("git", () => ({ active: gitService.status().activeRepositories }));
activity.observe("runtimeCommands", () => runtimeProfileService.commandStatus());
activity.observe("remoteRecovery", () => ({ recoveryRequired: runtimeProfileService.recoveryCount() }));
for (const [name, service] of [["terminal", terminalService], ["debug", debugService], ["collaboration", collaborationService]]) {
  activity.observe(name, () => {
    const value = service.status();
    return { active: value.active ?? value.connections, starting: value.starting, finishing: value.finishing, cleanupFailures: value.cleanupFailures, recoveryRequired: value.recoveryRequired || 0 };
  });
}
const maintain = createMaintenance({
  activity,
  stopInteractive: async () => {
    const results = await Promise.allSettled([terminalService.close(), debugService.close(), collaborationService.drain()]);
    if (results.some(value => value.status === "rejected")) throw new Error("Interactive cleanup failed after all session cleanups settled.");
  },
  cancelWork: () => runtime.cancelAll(),
  closeStores: async () => {
    await collaborationService.close();
    runtimeProfileService.close(); environmentService.close(); extensionRegistry.close();
    agentOrchestrator.close(); projectMemory.close(); workspaceStore.close();
  },
  checkpoint: value => writeMaintenanceReceipt(join(stateDir, "maintenance.json"), { ...value, at: new Date().toISOString(), sourceCommit: process.env.YNX_CODE_SOURCE_COMMIT || null }),
  drainTimeoutMs: maintenanceDuration("YNX_CODE_DRAIN_TIMEOUT_MS", 30_000),
  cancelTimeoutMs: maintenanceDuration("YNX_CODE_CANCEL_TIMEOUT_MS", 10_000),
});
function maintenanceDuration(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 10 || value > 120_000) throw new Error(`${name} must be between 10 and 120000 ms.`);
  return value;
}
let exiting = false;
async function shutdown(signal) {
  if (exiting) return;
  exiting = true;
  const result = await maintain(signal);
  server.close(); server.closeIdleConnections?.(); server.closeAllConnections?.();
  process.exit(result.exitCode);
}
// Explicit, one-way operator maintenance. No unauthenticated public mutation
// endpoint exists. Read-only health/readiness stay available until restart.
process.on("SIGUSR2", () => void maintain("operator_maintenance"));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void shutdown(signal));
