import {parseWalletDownloadManifest, selectWalletDownload} from './product-session-sdk.js';

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
    if (artifact.status !== 'published' || artifact.browser === 'firefox') return false;
    const evidence = preview.artifacts.find(row => row.id === artifact.id);
    return evidence?.published === true && evidence.publicDownloadVerified === true &&
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
