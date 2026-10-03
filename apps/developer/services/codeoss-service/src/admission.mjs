import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { OPENVSCODE, OPENVSCODE_X64 } from "./upstream.mjs";
import { fault } from "./central-identity.mjs";
import { validateRuntimeArtifact, sameRuntimeArtifact } from './composed-runtime.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const PROJECT = /^[A-Za-z0-9_-]{1,160}$/;

// Called only by A's protected operator module with its already admitted driver.
// Routing is deterministic across restarts. The durable broker remains the sole
// session/owner/project authority; a valid hostname alone grants no admission.
export function createDeveloperCoreAdmission({ driver, executionDomain, architecture, runtimeArtifact } = {}) {
  if (typeof executionDomain !== "string" || executionDomain.length > 190 ||
      executionDomain !== executionDomain.toLowerCase() ||
      !executionDomain.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      executionDomain.split(".").length < 2 || /^\d+(?:\.\d+){3}$/.test(executionDomain) ||
      executionDomain === "ynxweb4.com" || executionDomain.endsWith(".ynxweb4.com") ||
      /\.(?:localhost|local|internal)$/.test(executionDomain))
    throw new TypeError("An independently admitted, canonical execution DNS domain is required.");
  const pin = architecture === "linux-x64" ? OPENVSCODE_X64 : architecture === "linux-arm64" ? OPENVSCODE : null;
  const artifact = runtimeArtifact ? validateRuntimeArtifact(runtimeArtifact) : null;
  if (!driver || ["start", "stop", "connect"].some(name => typeof driver[name] !== "function") ||
      (!artifact && driver.runtimeArtifact) ||
      (artifact ? artifact.architecture !== architecture || !sameRuntimeArtifact(driver.runtimeArtifact, artifact)
        : !pin || ["architecture", "version", "commit", "sha256"].some(name => driver.upstream?.[name] !== pin[name])))
    throw new TypeError("The operator must provide an admitted driver with the exact architecture and upstream pin.");
  if (driver.projectsRoot !== undefined && !canonicalPath(driver.projectsRoot))
    throw new TypeError("The admitted persistent project root must be an exact absolute path.");

  const originForSession = sessionId => {
    if (!UUID.test(sessionId || "")) throw fault("Native IDE session route is invalid.", "core_proxy_origin_invalid", 403);
    return `https://${sessionId}.${executionDomain}/`;
  };
  const sessionForHost = host => {
    if (typeof host !== "string") return null;
    const suffix = `.${executionDomain}`;
    if (!host.endsWith(suffix)) return null;
    const sessionId = host.slice(0, -suffix.length);
    return UUID.test(sessionId) && new URL(originForSession(sessionId)).host === host ? sessionId : null;
  };
  const checkedDriver = {
    ...driver,
    ...(artifact ? { runtimeArtifact: artifact } : {}),
    async start(context) {
      checkContext(context);
      const result = await driver.start(context);
      if (result?.running !== true || result.runtimeId !== context.runtimeId)
        throw fault("Native IDE start did not confirm the exact runtime.", "core_start_unconfirmed", 503);
      return result;
    },
    async stop(context) {
      checkContext(context);
      const result = await driver.stop(context);
      if (result?.stopped !== true || result.runtimeId !== context.runtimeId || result.identityDigest !== context.identityDigest)
        throw fault("Native IDE stop did not confirm the exact runtime.", "core_processes_unconfirmed", 503);
      return result;
    },
    async connect(context) {
      checkContext(context);
      const result = await driver.connect(context);
      if (result?.tokenMode !== "private-loopback-without-connection-token" || typeof result.socket?.destroy !== "function") {
        result?.socket?.destroy?.();
        throw fault("Native IDE private listener mode is invalid.", "core_isolation_invalid", 503);
      }
      return result;
    },
  };
  function checkContext(context) {
    validateRuntimeContext(context);
    if ((artifact && !sameRuntimeArtifact(context.image, artifact)) || (!artifact && context.image?.kind === 'ynx-theia'))
      throw fault('This session belongs to another runtime artifact. Preserve its recovery driver.', 'core_artifact_mismatch', 503);
  }
  for (const name of ["prepareProjectDirectory", "inspect"])
    if (typeof driver[name] === "function") checkedDriver[name] = context => { checkContext(context); return driver[name](context); };
  return Object.freeze({ driver: Object.freeze(checkedDriver), originForSession, sessionForHost,
    launchURL: ({ sessionId }) => originForSession(sessionId) });
}

function canonicalPath(path) { return typeof path === "string" && isAbsolute(path) && resolve(path) === path && !path.includes("\0"); }
export function validateRuntimeContext(context) {
  if (!context || !UUID.test(context.sessionId || "") || !UUID.test(context.runtimeId || "") ||
      !/^[a-f0-9]{64}$/.test(context.owner || "") || !PROJECT.test(context.projectId || "") ||
      !canonicalPath(context.directory) || !canonicalPath(context.projectDirectory) ||
      context.identityDigest !== createHash("sha256").update(`${context.owner}\n${context.projectId}\n${context.runtimeId}\n${context.sessionId}`).digest("hex"))
    throw fault("Native IDE runtime context changed.", "core_context_invalid", 403);
}
