// Public selected-extension capability only; never a caller-selected HTTP client.
export const artifactLimits = Object.freeze({ maxBytes: 128 * 1024 * 1024, maxStagingBytes: 512 * 1024 * 1024, timeoutMs: 120000, concurrency: 2 });
const token = /^[a-z0-9][a-z0-9-]{0,127}$/i;
const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const platforms = new Set(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64', 'universal']);
// Catalog-selected artifacts have both legacy universal and target-specific
// Open VSX routes. A target route binds the platform in the path AND filename.
export function captureOfficialArtifactLocation(value) {
  const url = new URL(value);
  if (url.origin !== 'https://open-vsx.org' || url.username || url.password || url.search || url.hash || url.href.length > 2048)
    throw Error('Selected artifact origin is not approved.');
  const parts = url.pathname.split('/').map(part => decodeURIComponent(part));
  const targeted = parts.length === 8;
  const revision = targeted ? 5 : 4, file = targeted ? 7 : 6;
  if ((!targeted && parts.length !== 7) || parts[0] !== '' || parts[1] !== 'api'
    || !token.test(parts[2]) || !token.test(parts[3]) || !version.test(parts[revision])
    || parts[revision + 1] !== 'file'
    || (targeted ? !platforms.has(parts[4]) || parts[file].toLowerCase() !== `${parts[2]}.${parts[3]}-${parts[revision]}@${parts[4]}.vsix`.toLowerCase()
      : !/^[a-z0-9][a-z0-9._-]{0,511}\.vsix$/i.test(parts[file])))
    throw Error('Selected artifact path does not match its extension.');
  return { url, parts, targeted, revision, file };
}
export function captureArtifactSelection(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join(',') !== 'name,namespace,targetPlatform,version'
    || typeof value.namespace !== 'string' || !token.test(value.namespace)
    || typeof value.name !== 'string' || !token.test(value.name)
    || typeof value.version !== 'string' || value.version.length > 128 || !version.test(value.version)
    || !platforms.has(value.targetPlatform)) throw Error('Invalid selected extension.');
  return Object.freeze({ namespace: value.namespace, name: value.name, version: value.version, targetPlatform: value.targetPlatform });
}
export function resolveSelectedArtifact(selection, catalog) {
  const captured = captureArtifactSelection(selection);
  if (!catalog || !Array.isArray(catalog.extensions)) throw Error('Selected extension metadata unavailable.');
  const matches = catalog.extensions.filter(row => row?.namespace?.toLowerCase() === captured.namespace.toLowerCase()
    && row?.name?.toLowerCase() === captured.name.toLowerCase() && row.version === captured.version
    && [captured.targetPlatform, 'universal', undefined].includes(row.targetPlatform));
  const exact = matches.filter(row => row.targetPlatform === captured.targetPlatform);
  const candidates = exact.length ? exact : matches;
  if (candidates.length !== 1) throw Error('Selected extension metadata is missing or ambiguous.');
  const metadata = candidates[0];
  const { url, parts, targeted, revision } = captureOfficialArtifactLocation(metadata.files?.download);
  if (parts[2].toLowerCase() !== captured.namespace.toLowerCase() || parts[3].toLowerCase() !== captured.name.toLowerCase()
    || parts[revision] !== captured.version || (targeted && parts[4] !== (metadata.targetPlatform || 'universal')))
    throw Error('Selected artifact path does not match its extension.');
  return Object.freeze({ url: url.href, selection: captured, publisher: metadata.namespace, name: metadata.name, version: metadata.version });
}
