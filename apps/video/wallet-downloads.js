import {parseWalletDownloadManifest, selectWalletDownload} from './product-session-sdk.js';

// Publisher-confirmed GHSA-7g7r-gx96-252g holds. Keep exact file identities
// blocked even if an older immutable catalog is replayed. Other packages keep
// their existing preview limitations; this is not a general security approval.
const securityHeldSHA256 = new Set([
  'dcaf1372b29e6d3cb58f9a37d3db3b6fcb45aa9e13feff1c7c247bf283cd9893',
  '5664be113dea0e06862fcc8e6d1918de86a60197d7ca1906bbb30e8e5b3c4183',
  '3ba16d0372021471e13733425eaa39b155c122175e5bdcbc0e39b2554c199b00',
  '66dde56c9f8da969e9916d72c8929add581b1a0ea0695cd70a2e9fcb3c960a72',
]);

// Only a published artifact with matching publisher evidence becomes a link.
// Device hints select UI defaults; they confer no installation or account rights.
export function verifiedWalletDownloads(input, preview) {
  const manifest = parseWalletDownloadManifest(input);
  if (preview?.schemaVersion !== 1 || preview.product !== 'YNX Wallet' || !Array.isArray(preview.artifacts)) throw new Error('Wallet preview metadata unavailable');
  const ids = new Set();
  for (const row of preview.artifacts) {
    if (!row?.id || ids.has(row.id)) throw new Error('Ambiguous Wallet preview metadata');
    ids.add(row.id);
  }
  return manifest.artifacts.filter(artifact => {
    if (artifact.status !== 'published' || artifact.browser === 'firefox' || securityHeldSHA256.has(artifact.sha256)) return false;
    const evidence = preview.artifacts.find(row => row.id === artifact.id);
    return evidence?.published === true && evidence.publicDownloadVerified === true && evidence.securityHold !== true &&
      ['url', 'sha256', 'bytes', 'sourceCommit', 'filename', 'platform', 'architecture', 'installation', 'browser', 'mimeType'].every(key => evidence[key] === artifact[key]);
  }).map(artifact => {
    const result = selectWalletDownload(manifest, {
      platform: artifact.platform, architecture: artifact.architecture,
      browser: artifact.browser, installation: artifact.installation,
    });
    if (result.status !== 'download' || result.artifact.id !== artifact.id) throw new Error('Wallet download selection disagrees with the release');
    return result.artifact;
  });
}

export function suggestedWalletDownload(artifacts, device = {}) {
  const ua = String(device.userAgent || ''), platform = String(device.platform || '');
  const ios = /iPhone|iPad|iPod/.test(ua) || /Mac/.test(platform) && Number(device.maxTouchPoints) > 1;
  if (ios) return null;
  const native = /Android/.test(ua) ? 'android' : /Mac/i.test(platform + ua) ? 'macos' : /Win/i.test(platform + ua) ? 'windows' : /Linux/i.test(platform + ua) ? 'linux' : null;
  const matches = artifacts.filter(row => row.platform === native);
  const universal = matches.find(row => row.architecture === 'universal');
  if (universal) return universal.id;
  if (matches.length === 1) return matches[0].id;
  // Architecture and Linux package format cannot reliably be inferred from UA.
  if (native) return null;
  return /Chrome|Chromium|Edg\//.test(ua) ? artifacts.find(row => row.browser === 'chromium')?.id || null : null;
}
