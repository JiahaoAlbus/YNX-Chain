import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
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
  const { openBundledWalletAdmission, openBundledProjectContractClient,loadBundledContractMaterialBuilder } = await import(pathToFileURL(join(applicationRoot, 'desktop', 'wallet-admission-startup.mjs')));
  const walletAdmission = await openBundledWalletAdmission(import.meta.url);
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
  const workbench = await startLocalWorkbench({ payload: join(resources, 'composed-core'), supportRoot,
    projectDirectory: process.env.YNX_LOCAL_WORKSPACE || undefined,
    walletAdmission, aiTools, goToolchain,
    // The contract-specific Source selector is supplied independently of AI.
    // Until its fixed producer is connected, this remains locally unavailable.
    openProjectContracts:projectContext=>openBundledProjectContractClient({context:projectContext}),
    openPublication:async projectContext=>{const {createArtifactPublicationHost}=await import(pathToFileURL(join(applicationRoot,'desktop','artifact-publication-host.mjs')));return createArtifactPublicationHost({context:projectContext,admittedProject:walletAdmission?.admittedProject});},
    openDeployment:async projectContext=>{const {createProjectContractDeployment}=await import(pathToFileURL(join(applicationRoot,'desktop','project-contract-deployment.mjs')));return createProjectContractDeployment({context:projectContext,loadMaterialBuilder:()=>loadBundledContractMaterialBuilder()});},
    node: join(resources, 'runtime', 'node'), lockHelper: join(resources, 'runtime', 'ynx-local-workbench-lock'), port: Number(process.env.PORT || 0) }).catch(async error => {
      retireWallet();
      await finishWalletCleanup();
      retireTools();
      await finishToolsCleanup();
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
  const { createNativeParentControl } = await import(pathToFileURL(join(applicationRoot, 'desktop', 'native-parent-control.mjs')));
  const parentControl = createNativeParentControl({input:process.stdin,onError:error=>console.error('YNX_NATIVE_PARENT_CONTROL '+String(error?.message??error).slice(0,240))});
  let goChannel, originalServiceChannel, identityChannel;
  if(goStore&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(process.env.YNX_NATIVE_GO_INSTANCE||'')){
    const {attachOriginalServicePipe}=await import(pathToFileURL(join(applicationRoot,'desktop','original-service-pipe.mjs')));
    const {attachNativeIdentityChannel}=await import(pathToFileURL(join(applicationRoot,'desktop','native-identity-channel.mjs')));
    try{const instance=process.env.YNX_NATIVE_GO_INSTANCE;const directory=await goStore.controlDirectory(instance);
      goChannel=attachNativeGoSelectionChannel({control:parentControl,store:goStore,context,directory,onError:error=>console.error('YNX_GO_SELECTION_CONTROL '+String(error.message).slice(0,240))});
      // Bootstrap identity is independent of an admitted legacy four-op parent.
      // Only an explicit normal native action can start its lazy request.
      try{identityChannel=await attachNativeIdentityChannel({control:parentControl,instance,context,directory,runningBackendModuleURL:import.meta.url,onError:()=>console.error('YNX_NATIVE_IDENTITY_REQUEST_UNAVAILABLE')});}
      catch{console.error('YNX_NATIVE_IDENTITY_TRANSPORT_UNAVAILABLE');}
      // Register the route immediately; the same fixed admitted child becomes
      // usable only after installed/ACK and SDK readiness. Missing supply keeps
      // the existing unavailable response and never blocks local coding/Go.
      originalServiceChannel=await attachOriginalServicePipe({control:parentControl,instance,context,directory,runningBackendModuleURL:import.meta.url,onError:error=>console.error('YNX_ORIGINAL_SERVICE_CONTROL '+String(error?.message??error).slice(0,240))});
    }
    catch(error){console.error('YNX_GO_SELECTION_UNAVAILABLE '+String(error.message).slice(0,240));}
  }
  delete process.env.YNX_NATIVE_GO_INSTANCE;
  console.log('YNX_LOCAL_WORKBENCH ' + JSON.stringify({ url: workbench.url, projectId: workbench.id, workspace: workbench.workspace, profile: workbench.profile }));
  let stopping;
  const stop = () => {
    if (stopping) return stopping;
    parentControl.close(); goChannel?.close(); originalServiceChannel?.close(); identityChannel?.close(); retireWallet(); retireTools();
    stopping = (async () => {
      try { await workbench.stop(); }
      finally {
        const parentCleanup = await parentControl.finishCleanup();
        if (parentCleanup.complete !== true) process.exitCode = 1;
        // A channel's DATA cleanup result is not a rejected parent task. Keep
        // its retained failure (including falsy causes) in the process result.
        if (identityChannel && (await identityChannel.finishCleanup()).complete !== true) process.exitCode = 1;
        if (!await finishWalletCleanup()) process.exitCode = 1;
        if (!await finishToolsCleanup()) process.exitCode = 1;
      }
    })();
    return stopping;
  };
  const requestStop = () => { void stop().catch(() => { process.exitCode = 1; console.error('YNX_LOCAL_WORKBENCH_STOP_FAILED'); }); };
  const parent = process.ppid;
  const monitor = setInterval(() => { if (process.ppid !== parent) requestStop(); }, 250);
  process.once('SIGTERM', requestStop); process.once('SIGINT', requestStop);
  const result = await workbench.exited;
  clearInterval(monitor); await stop();
  process.exitCode = process.exitCode || (result.error ? 1 : result.code === null ? 0 : result.code);
} else {
const sessionKeyPath = join(supportRoot, "workspace-session.key");

await mkdir(supportRoot, { recursive: true, mode: 0o700 });
let sessionKey;
try {
  sessionKey = (await readFile(sessionKeyPath, "utf8")).trim();
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  const candidate = randomBytes(32).toString("hex");
  try { await writeFile(sessionKeyPath, `${candidate}\n`, { flag: "wx", mode: 0o600 }); }
  catch (writeError) { if (writeError?.code !== "EEXIST") throw writeError; }
  sessionKey = (await readFile(sessionKeyPath, "utf8")).trim();
}
if (!/^[0-9a-f]{64}$/.test(sessionKey)) throw new Error("Desktop workspace session key is invalid.");
await chmod(sessionKeyPath, 0o600);

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
