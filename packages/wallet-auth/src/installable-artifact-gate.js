import { WalletAuthError } from "./canonical.js";

export const INSTALLABLE_ARTIFACT_GATE_VERSION = "installableWalletArtifact@1.0.0-p0.0";
export const INSTALLABLE_ARTIFACT_PLATFORM = Object.freeze({ MACOS: "macos", WINDOWS: "windows", ANDROID: "android", WEB_PWA: "web-pwa" });

const INSTALLERS = Object.freeze({ macos: Object.freeze(["dmg"]), windows: Object.freeze(["exe", "msix"]), android: Object.freeze(["apk", "aab"]), "web-pwa": Object.freeze([]) });
const SHA256 = /^[0-9a-f]{64}$/;

export function verifyInstallableArtifactReleaseManifest(input) {
  if (!object(input) || input.version !== INSTALLABLE_ARTIFACT_GATE_VERSION || !Array.isArray(input.entries) || input.entries.length === 0) fail("INVALID_INSTALLER_MANIFEST", "Installable artifact manifest is invalid");
  const products = new Set(), entries = input.entries.map((entry) => verifyEntry(entry, products));
  return Object.freeze({ version: INSTALLABLE_ARTIFACT_GATE_VERSION, entries: Object.freeze(entries), publishable: true });
}

function verifyEntry(entry, products) {
  if (!object(entry) || typeof entry.productId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.productId) || !Object.values(INSTALLABLE_ARTIFACT_PLATFORM).includes(entry.platform) || products.has(`${entry.productId}:${entry.platform}`)) fail("INVALID_INSTALLER_ENTRY", "Installable artifact entry is invalid or duplicated");
  products.add(`${entry.productId}:${entry.platform}`);
  if (entry.platform === INSTALLABLE_ARTIFACT_PLATFORM.WEB_PWA) {
    if (entry.format !== "web-pwa" || entry.downloadUrl !== null || entry.sha256 !== null || entry.signingStatus !== "not-applicable" || entry.installVerified !== false) fail("WEB_PWA_MISREPRESENTED", "Web/PWA must not be presented as a desktop or mobile installer");
    return Object.freeze({ ...entry });
  }
  if (!INSTALLERS[entry.platform].includes(entry.format) || entry.format === "zip") fail("NON_INSTALLABLE_ARCHIVE", "ZIP or an unsupported format cannot be presented as an installer");
  if (typeof entry.downloadUrl !== "string" || !validHttps(entry.downloadUrl) || !SHA256.test(entry.sha256) || typeof entry.version !== "string" || !/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/.test(entry.version)) fail("INVALID_INSTALLER_IDENTITY", "Installer URL, version or SHA-256 is invalid");
  if (!object(entry.evidence) || entry.evidence.install !== true || entry.evidence.coldLaunch !== true || entry.evidence.secondLaunch !== true || entry.evidence.network !== true || entry.evidence.versionReadback !== entry.version || entry.evidence.sha256Readback !== entry.sha256 || entry.evidence.rollback !== true) fail("INSTALLER_EVIDENCE_INCOMPLETE", "Installer install, launch, network, version, digest or rollback evidence is incomplete");
  if (!object(entry.signing) || entry.signing.status !== entry.signingStatus || !["production-signed", "test-signed", "unsigned"].includes(entry.signingStatus) || typeof entry.signing.identity !== "string" || entry.signing.identity.length < 1) fail("INSTALLER_SIGNING_UNVERIFIED", "Installer signing status and identity must be explicit");
  if (entry.platform === INSTALLABLE_ARTIFACT_PLATFORM.MACOS && (entry.format !== "dmg" || entry.evidence.mountedDmg !== true || entry.evidence.appBundleLaunches !== 2)) fail("MACOS_DMG_GATE_FAILED", "macOS requires a mounted DMG containing an app that launches twice");
  if (entry.platform === INSTALLABLE_ARTIFACT_PLATFORM.WINDOWS && !["exe", "msix"].includes(entry.format)) fail("WINDOWS_INSTALLER_GATE_FAILED", "Windows requires EXE or MSIX");
  if (entry.platform === INSTALLABLE_ARTIFACT_PLATFORM.ANDROID && entry.format === "aab" && entry.distribution !== "store-upload") fail("ANDROID_AAB_NOT_DIRECT_INSTALL", "AAB is a store upload and cannot be published as a direct installer");
  if (entry.platform === INSTALLABLE_ARTIFACT_PLATFORM.ANDROID && entry.format === "apk" && entry.distribution !== "direct-download") fail("ANDROID_APK_DISTRIBUTION_INVALID", "Direct Android download requires APK");
  return Object.freeze({ ...entry, evidence: Object.freeze({ ...entry.evidence }), signing: Object.freeze({ ...entry.signing }) });
}

function validHttps(value) { try { const url = new URL(value); return url.protocol === "https:" && url.username === "" && url.password === "" && url.hash === ""; } catch { return false; } }
function object(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fail(code, message) { throw new WalletAuthError(code, message); }
