import { loadWorkspaceSessionKey } from '../services/workspace-agent/src/session-key.mjs';
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const resources = dirname(fileURLToPath(import.meta.url));
// The package producer records the clean checkout that supplied this runtime.
// Validate it before touching user state; inherited shell values are not build
// provenance and must never label a different package as the released source.
const provenance = JSON.parse(await readFile(join(resources, "build-provenance.json"), "utf8"));
if (provenance?.schemaVersion !== 1 || provenance.productId !== "ynx-developer-v1"
  || provenance.version !== "0.2.0" || provenance.sourceDirty !== false
  || provenance.platform !== `macos-${process.arch}`
  || typeof provenance.sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(provenance.sourceCommit)
  || typeof provenance.sourceTree !== "string" || !/^[0-9a-f]{40}$/.test(provenance.sourceTree)
  || provenance.runtimeCheckpoint !== provenance.sourceCommit) {
  throw new Error("Desktop bundled build provenance is invalid.");
}
const applicationRoot = join(resources, "code", "apps", "developer");
// An optional producer-sealed compiler is measured before any user state is
// touched. It supplies compiler bytes, never canonical project admission.
const compilerInput = join(applicationRoot, 'compiler-runtime', 'node_modules', 'solc');
let hasBundledCompiler = false;
try { await readFile(join(applicationRoot, 'compiler-runtime', 'distribution.json')); hasBundledCompiler = true; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (hasBundledCompiler) {
  const { compilerReadiness, COMPILER_CLOSURE_SHA256 } = await import(pathToFileURL(join(applicationRoot, 'scripts', 'compiler-pin.mjs')));
  const state = compilerReadiness(compilerInput);
  if (!state.available || state.closureSha256 !== COMPILER_CLOSURE_SHA256) throw Error('Desktop bundled compiler input is invalid.');
  process.env.YNX_IDE_SOLC_INPUT = compilerInput;
}
const supportRoot = process.env.YNX_CODE_DESKTOP_SUPPORT_DIR || join(homedir(), "Library", "Application Support", "YNXDeveloper");
// A local OS workspace never supplies canonical identity to the gateway.
if (process.env.YNX_DEVELOPER_DESKTOP_MODE === 'local-workbench') {
  // Inherited shell metadata never grants a toolchain read capability.
  for (const name of ['YNX_IDE_GO_ENTRY','YNX_IDE_GO_ROOT','YNX_IDE_GO_VERSION','YNX_IDE_GO_SHA']) delete process.env[name];
  const { startLocalWorkbench, localProjectContext } = await import(pathToFileURL(join(applicationRoot, 'desktop', 'local-workbench.mjs')));
  const context=await localProjectContext({supportRoot,projectDirectory:process.env.YNX_LOCAL_WORKSPACE||undefined});
  const {createLocalGoSelectionStore,attachNativeGoSelectionChannel}=await import(pathToFileURL(join(applicationRoot,'desktop','local-go-selection.mjs')));
  let goStore,goToolchain;
  try{goStore=await createLocalGoSelectionStore({supportRoot,context,pathIdentityHelper:join(resources,'runtime','workspace-path-identity')});goToolchain=await goStore.load();}
  catch(error){console.error('YNX_GO_SELECTION_UNAVAILABLE '+String(error.message).slice(0,240));}
  const { openBundledWalletAdmission } = await import(pathToFileURL(join(applicationRoot, 'desktop', 'wallet-admission-startup.mjs')));
  const walletAdmission = await openBundledWalletAdmission(import.meta.url);
  const {createBundledProjectContractRuntime}=await import(pathToFileURL(join(applicationRoot,'desktop','bundled-contract-runtime.mjs')));
  const contractRuntime=await createBundledProjectContractRuntime({context,serverModuleURL:import.meta.url});
  // Retire service capability before child shutdown; late four-op results may
  // not reopen a cancelled native parent epoch. This is separate from Tools.
  const retireWallet = () => { walletAdmission.close?.(); };
  const finishWalletCleanup = async () => {
    try { const status = await walletAdmission.finishCleanup?.();
      if (status && status.complete !== true) throw Error('Wallet cleanup incomplete');
    } catch { console.error('YNX_WALLET_ADMISSION_CLEANUP_INCOMPLETE'); return false; }
    return true;
  };
  const { createNativeToolsClient } = await import(pathToFileURL(join(applicationRoot, 'desktop', 'native-tools-client.mjs')));
  const { createAdmittedLocalProjectMapping } = await import(pathToFileURL(join(applicationRoot, 'desktop', 'admitted-local-project.mjs')));
  let aiTools, admittedProject, cleanupOwner;
  const retireTools = () => { aiTools?.close(); cleanupOwner?.close(); };
  const finishToolsCleanup = async () => {
    if (!cleanupOwner) return true;
    try {
      const status = await cleanupOwner.finishCleanup();
      if (status.complete) return true;
    } catch { /* Preserve the startup/exit error; cleanup remains incomplete. */ }
    console.error('YNX_AI_CLEANUP_INCOMPLETE');
    return false;
  };
  try {
    admittedProject = createAdmittedLocalProjectMapping({ context, canonicalProject: walletAdmission?.admittedProject, nativeTools: walletAdmission?.nativeTools });
    cleanupOwner = admittedProject;
    aiTools = createNativeToolsClient({ supply: admittedProject });
    if (!admittedProject) console.error('YNX_AI_NATIVE_TOOLS_NOT_SUPPLIED');
  }
  catch (error) {
    cleanupOwner = admittedProject || error?.cleanupOwner;
    retireTools();
    console.error('YNX_AI_NATIVE_TOOLS_NOT_SUPPLIED');
  }
  const startupCancellation = new AbortController();
  const cancelStartup = () => startupCancellation.abort();
  process.once('SIGTERM', cancelStartup); process.once('SIGINT', cancelStartup);
  const workbench = await startLocalWorkbench({ payload: join(resources, 'composed-core'), supportRoot,
    projectDirectory: process.env.YNX_LOCAL_WORKSPACE || undefined,
    signal: startupCancellation.signal, walletAdmission, aiTools, contractRuntime, goToolchain, node: join(resources, 'runtime', 'node'), lockHelper: join(resources, 'runtime', 'ynx-local-workbench-lock'), port: Number(process.env.PORT || 0) }).catch(async error => {
      process.removeListener('SIGTERM', cancelStartup); process.removeListener('SIGINT', cancelStartup);
      let contractCleanupFailed=false,contractCleanupError;
      try{await contractRuntime.close();}catch(cause){contractCleanupFailed=true;contractCleanupError=cause;}
      retireWallet();
      await finishWalletCleanup();
      retireTools();
      await finishToolsCleanup();
      if(contractCleanupFailed)throw new AggregateError([error,contractCleanupError],'Original project startup cleanup remains uncertain.',{cause:error});
      // startLocalWorkbench has already stopped its own child before rejecting.
      // Preserve the lock refusal across the launcher/native-host boundary.
      if (error.code === 'YNX_LOCAL_PROJECT_ALREADY_OPEN') {
        console.error(error.message);
        process.exit(73);
      }
      if (error.pluginPreparationSpace === true && (error.code === 'ENOSPC' || error.code === 'YNX_PLUGIN_COPY_SPACE')) {
        console.error(error.message);
        process.exit(74);
      }
      throw error;
    });
  // Transfer signals synchronously once the child exists: subsequent module
  // imports/control-directory I/O must not leave a live child unowned.
  let stopping, parentControl, goChannel, originalServiceChannel;
  const stop = () => {
    if (stopping) return stopping;
    parentControl?.close(); goChannel?.close(); originalServiceChannel?.close(); workbench.retireProjectServices(); retireTools();
    stopping = (async () => {
      try { await workbench.stop(); }
      finally {
        const parentCleanup = await parentControl?.finishCleanup();
        if (parentCleanup?.firstFailure) process.exitCode = 1;
        try {
          await workbench.finishProjectServicesCleanup();
          retireWallet();
          if (!await finishWalletCleanup()) process.exitCode = 1;
        } catch { process.exitCode=1;console.error('YNX_PROJECT_SERVICES_CLEANUP_INCOMPLETE'); }
        if (!await finishToolsCleanup()) process.exitCode = 1;
      }
    })();
    return stopping;
  };
  const requestStop = () => { void stop().catch(() => { process.exitCode = 1; console.error('YNX_LOCAL_WORKBENCH_STOP_FAILED'); }); };
  const parent = process.ppid;
  const monitor = setInterval(() => { if (process.ppid !== parent) requestStop(); }, 250);
  process.on('SIGTERM', requestStop); process.on('SIGINT', requestStop);
  process.removeListener('SIGTERM', cancelStartup); process.removeListener('SIGINT', cancelStartup);
  if (startupCancellation.signal.aborted) requestStop();
  let result;
  try {
    await (async () => {
      if (stopping) return;
      const { createNativeParentControl, attachUnavailableOriginalServiceChannel } = await import(pathToFileURL(join(applicationRoot, 'desktop', 'native-parent-control.mjs')));
      if (stopping) return;
      parentControl = createNativeParentControl({input:process.stdin,onError:error=>console.error('YNX_NATIVE_PARENT_CONTROL '+String(error.message).slice(0,240))});
      if(goStore&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(process.env.YNX_NATIVE_GO_INSTANCE||'')){
        try{const instance=process.env.YNX_NATIVE_GO_INSTANCE;const directory=await goStore.controlDirectory(instance);
          if (stopping) return;
          goChannel=attachNativeGoSelectionChannel({control:parentControl,store:goStore,context,directory,onError:error=>console.error('YNX_GO_SELECTION_CONTROL '+String(error.message).slice(0,240))});
          // The fixed original service producer is still absent. This channel only
          // reports pre-entry unavailability, without blocking local coding/Go.
          originalServiceChannel=attachUnavailableOriginalServiceChannel({control:parentControl,instance,context,directory,onError:error=>console.error('YNX_ORIGINAL_SERVICE_CONTROL '+String(error.message).slice(0,240))});
        }
        catch(error){console.error('YNX_GO_SELECTION_UNAVAILABLE '+String(error.message).slice(0,240));}
      }
      delete process.env.YNX_NATIVE_GO_INSTANCE;
      console.log('YNX_LOCAL_WORKBENCH ' + JSON.stringify({ url: workbench.url, projectId: workbench.id, workspace: workbench.workspace, profile: workbench.profile }));
    })();
    result = await workbench.exited;
  } finally {
    clearInterval(monitor);
    try { await stop(); } finally {
      process.removeListener('SIGTERM', requestStop); process.removeListener('SIGINT', requestStop);
    }
  }
  process.exitCode = process.exitCode || (result.error ? 1 : result.code === null ? 0 : result.code);
} else {
const sessionKeyPath = join(supportRoot, "workspace-session.key");

await mkdir(supportRoot, { recursive: true, mode: 0o700 });
const sessionKey = await loadWorkspaceSessionKey(sessionKeyPath);

process.env.NODE_ENV = "production";
process.env.HOST = "127.0.0.1";
process.env.YNX_CODE_RELEASE = `${provenance.version}-testnet-preview-${provenance.sourceCommit.slice(0, 12)}`;
process.env.YNX_CODE_SOURCE_COMMIT = provenance.sourceCommit;
process.env.YNX_CODE_SOURCE_TREE = provenance.sourceTree;
process.env.YNX_CODE_WORKSPACE_SESSION_KEY = sessionKey;
process.env.YNX_CODE_STATE_DIR = join(supportRoot, "code-state");
process.env.YNX_CODE_STATIC_ROOT = join(applicationRoot, "frontend", "dist");
// Finder supplies a minimal PATH. Discover the verified bundled Node and
// language servers before inherited host tools, without an install or a
// workspace-selected executable path.
process.env.PATH = [dirname(process.execPath), join(applicationRoot, "node_modules", ".bin"),
  process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin"].join(":");
process.chdir(applicationRoot);

await import(pathToFileURL(join(applicationRoot, "services", "gateway", "src", "server.mjs")).href);

// Cocoa may be terminated by the operating system without delivering the
// application delegate's graceful callback. Never leave a re-parented IDE
// runtime behind after its only trusted native host disappears.
const desktopParent = process.ppid;
const parentMonitor = setInterval(() => {
  if (process.ppid !== desktopParent) process.kill(process.pid, "SIGTERM");
}, 250);
parentMonitor.unref();
}
