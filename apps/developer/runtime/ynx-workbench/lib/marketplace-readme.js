'use strict';
// Read-only public description capability. The isolated backend supplies an
// extension identity, never headers, credentials, a destination or a local path.
const { failureEnvelope } = require('./marketplace-diagnostics');
const platforms = new Set(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64', 'universal']);
const installed = new WeakSet();
const MAX_README_BYTES = 512 * 1024;
function captureReadmeSelection(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join(',') !== 'filename,name,namespace,targetPlatform,version'
    || !['namespace', 'name'].every(key => typeof value[key] === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/i.test(value[key]))
    || typeof value.version !== 'string' || value.version.length > 128 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value.version)
    || !(value.targetPlatform === null || platforms.has(value.targetPlatform))
    || typeof value.filename !== 'string' || value.filename.length > 128 || !/^(?:readme|readme(?:[._-][a-z0-9-]+)*\.(?:md|markdown|txt))$/i.test(value.filename))
    throw Error('Selected extension readme is not approved.');
  return Object.freeze({ namespace: value.namespace, name: value.name, version: value.version, targetPlatform: value.targetPlatform, filename: value.filename });
}
function readmeURL(value) {
  const selected = captureReadmeSelection(value);
  return `https://open-vsx.org/api/${[selected.namespace, selected.name, ...selected.targetPlatform === null ? [] : [selected.targetPlatform], selected.version, 'file', selected.filename].map(encodeURIComponent).join('/')}`;
}
function selectionFromReadmeURL(value) {
  const url = new URL(value), parts = url.pathname.split('/').map(decodeURIComponent), targeted = parts.length === 8;
  if (url.origin !== 'https://open-vsx.org' || url.username || url.password || url.search || url.hash || url.href.length > 2048
    || (!targeted && parts.length !== 7) || parts[0] !== '' || parts[1] !== 'api' || parts[targeted ? 6 : 5] !== 'file')
    throw Error('Selected extension readme is not approved.');
  return captureReadmeSelection({ namespace: parts[2], name: parts[3], targetPlatform: targeted ? parts[4] : null, version: parts[targeted ? 5 : 4], filename: parts[targeted ? 7 : 6] });
}
function officialReadmeRedirect(source, location) {
  const selected = selectionFromReadmeURL(source), target = new URL(location, source);
  const parts = new URL(readmeURL(selected)).pathname.split('/');
  const revision = selected.targetPlatform === null ? 4 : 5;
  const exact = `/${parts.slice(2, revision + 1).join('/')}/${parts.at(-1)}`;
  const flat = `/${parts[2]}/${parts[3]}/${parts[revision]}/${parts.at(-1)}`;
  if (target.origin !== 'https://openvsx.eclipsecontent.org' || target.username || target.password || target.search || target.hash || ![exact, flat].includes(target.pathname))
    throw Error('Official readme redirect identity rejected.');
  return target.href;
}
function decodeReadme(bytes, type) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_README_BYTES || !/^(?:text\/(?:plain|markdown|x-markdown)|application\/octet-stream)(?:\s*;|$)/i.test(type || ''))
    throw Error('Extension description response rejected.');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
function installReadmeTransport(prototype, catalog) {
  if (installed.has(prototype)) return;
  installed.add(prototype);
  prototype.fetchReadme = async function (url) {
    try { return await catalog.request('readme', selectionFromReadmeURL(url)); }
    catch (cause) {
      const error = failureEnvelope(cause), detail = [error.category, ...error.codes].join(',');
      try { this.logger?.warn(`YNX_MARKETPLACE operation=readme codes=${detail}`); } catch {}
      // The framework renders a missing description as an empty page. Show an
      // explicit product status instead, without pretending this is publisher content.
      return `# Extension description unavailable\n\nYNX could not load the publisher's README (${detail}). Reopen this extension to retry. Installation status is shown separately.`;
    }
  };
}
module.exports = { MAX_README_BYTES, captureReadmeSelection, readmeURL, selectionFromReadmeURL, officialReadmeRedirect, decodeReadme, installReadmeTransport };
