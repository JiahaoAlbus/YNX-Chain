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
let runtimeProfileService, runtime;
const routedLanguageRequest = (runner) => (request, context) =>
  request.runtimeId
    ? runner(request, {
        processFactory: (value) =>
          runtimeProfileService.openContainerLanguageProcess({
            owner: context.owner,
            runtimeId: request.runtimeId,
            projectId: request.projectId,
            files: value.files,
            config: value.config,
          }),
      })
    : runner(request);
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
  workspaceStore,
  ownerForRequest: (request) => runtime.ownerForRequest(request),
  containerTerminalBroker: runtimeProfileService,
  environmentService,
});
const server = createServer(
  createGateway({
    staticRoot,
    runtime,
    handlers: [collaborationService.handler, runtimeProfileService.handler, environmentService.handler, terminalService.handler, chainService.handler, walletReadinessService.handler, gitService.handler, extensionRegistry.handler, modelRouter.handler, agentOrchestrator.handler, projectMemory.handler],
  }),
);
const debugService = createDebugService({
  workspaceStore,
  ownerForRequest: (request) => runtime.ownerForRequest(request),
  containerDebugBroker: runtimeProfileService,
});
server.on("upgrade", (request, socket, head) => {
  if (collaborationService.handleUpgrade(request, socket, head) || terminalService.handleUpgrade(request, socket, head) || debugService.handleUpgrade(request, socket, head)) return;
  socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  socket.destroy();
});
server.listen(port, host, () => console.log(`YNX Code Gateway http://${host}:${port}`));
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadline = setTimeout(() => process.exit(1), 4_000);
  deadline.unref();
  server.close();
  server.closeIdleConnections?.();
  await Promise.allSettled([terminalService.close(), debugService.close(), collaborationService.close()]);
  server.closeAllConnections?.();
  runtimeProfileService.close();
  environmentService.close();
  extensionRegistry.close();
  agentOrchestrator.close();
  projectMemory.close();
  workspaceStore.close();
  clearTimeout(deadline);
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void shutdown());
