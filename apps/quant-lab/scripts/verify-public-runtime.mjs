import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {QUANT_RUNTIME_WEB_ASSETS} from './verify-versioned-assets.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifyPublicRuntime(manifest, request = fetch) {
  if (manifest?.schemaVersion !== 1 || manifest.productId !== 'ynx-quant-lab' ||
      !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || !/^[a-f0-9]{40}$/.test(manifest.sourceTree) ||
      manifest.release !== `ynx-quant-lab-${manifest.sourceCommit.slice(0,12)}` || !Array.isArray(manifest.entries)) {
    throw new Error('INVALID_CANDIDATE_MANIFEST');
  }
  const prefix = `${manifest.release}/apps/quant-lab/web/`;
  const assets = manifest.entries.filter(entry => entry.path?.startsWith(prefix));
  if (assets.length !== QUANT_RUNTIME_WEB_ASSETS.length ||
      new Set(assets.map(entry=>entry.path)).size !== assets.length ||
      QUANT_RUNTIME_WEB_ASSETS.some(name=>!assets.some(entry=>entry.path===prefix+name)) ||
      assets.some(entry=>!Number.isSafeInteger(entry.bytes) || entry.bytes<1 || !/^[a-f0-9]{64}$/.test(entry.sha256))) {
    throw new Error('INVALID_ASSET_INVENTORY');
  }
  const receipts = [];
  async function read(route) {
    const url = `https://quant.ynxweb4.com${route}`;
    const response = await request(url, {method:'GET',redirect:'manual',signal:AbortSignal.timeout(15000)});
    const bytes = Buffer.from(await response.arrayBuffer());
    const receipt = {url,status:response.status,bytes:bytes.length,sha256:digest(bytes),contentType:response.headers.get('content-type')};
    receipts.push(receipt);
    if (response.status!==200) throw new Error(`PUBLIC_HTTP_MISMATCH:${route}`);
    return {bytes,receipt};
  }
  for (const route of ['/api/version','/api/health']) {
    const {bytes,receipt} = await read(route);
    if (!receipt.contentType?.startsWith('application/json')) throw new Error(`PUBLIC_MIME_MISMATCH:${route}`);
    const value = JSON.parse(bytes);
    if (value.productId!==manifest.productId || value.commit!==manifest.sourceCommit) throw new Error(`PUBLIC_SOURCE_MISMATCH:${route}`);
    if (route==='/api/health' && (value.status!=='ok' || value.liveFundsEnabled!==false ||
        (value.ready===true && value.storage?.multiInstance===false))) throw new Error('PUBLIC_HEALTH_CONTRACT_MISMATCH');
  }
  for (const asset of assets) {
    const name = asset.path.slice(prefix.length);
    const {receipt} = await read(name==='index.html'?'/':`/${name}?v=${asset.sha256}`);
    if (receipt.bytes!==asset.bytes || receipt.sha256!==asset.sha256) throw new Error(`PUBLIC_ASSET_MISMATCH:${name}`);
  }
  return {sourceCommit:manifest.sourceCommit,sourceTree:manifest.sourceTree,publicBytesMatch:true,receipts,
    walletApprovalVerified:false,installedVerified:false,transactionsVerified:false};
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const [archive,commit,...extra] = process.argv.slice(2);
    if (!archive || !/^[a-f0-9]{40}$/.test(commit??'') || extra.length) throw new Error('usage: verify-public-runtime.mjs <frozen-archive> <exact-source-commit>');
    const manifest = JSON.parse(execFileSync('/usr/bin/tar',['-xOf',archive,`ynx-quant-lab-${commit.slice(0,12)}/BUNDLE_MANIFEST.json`],{maxBuffer:1048576}));
    if(manifest.sourceCommit!==commit) throw new Error('CANDIDATE_SOURCE_MISMATCH');
    console.log(JSON.stringify(await verifyPublicRuntime(manifest),null,2));
  } catch(error) {
    console.error(JSON.stringify({publicBytesMatch:false,error:error.message}));
    process.exitCode=1;
  }
}
