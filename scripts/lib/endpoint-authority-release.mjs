import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {buildEndpointAuthority,sha256} from '../ops/issue-endpoint-authority.mjs';
import {validateEndpointAuthority} from '../../sdk/js/endpoint-authority.js';

export async function loadEndpointAuthorityRelease(root,{current=false}={}){
  const pin=JSON.parse(fs.readFileSync(path.join(root,'chain-metadata/endpoint-authority/current.json')));
  assert(pin.schema==='ynx-endpoint-authority-pin/v1'&&/^chain-metadata\/endpoint-authority\/\d{8}\.\d+\.json$/.test(pin.manifestPath),'INVALID_AUTHORITY_PIN_PATH');
  const bytes=fs.readFileSync(path.join(root,pin.manifestPath));
  assert(sha256(bytes)===pin.fileSha256,'AUTHORITY_FILE_HASH_MISMATCH');
  const value=JSON.parse(bytes);
  const manifest=await validateEndpointAuthority(value,{trustedPin:pin,nowMs:current?Date.now():Date.parse(value.issuedAt),digestSHA256:sha256});
  const evidencePath=manifest.sourceEvidence?.path;
  assert(evidencePath===pin.manifestPath.replace(/\.json$/,'.evidence.json'),'INVALID_AUTHORITY_EVIDENCE_PATH');
  const evidenceBytes=fs.readFileSync(path.join(root,evidencePath));
  assert(sha256(evidenceBytes)===manifest.sourceEvidence.sha256,'AUTHORITY_EVIDENCE_HASH_MISMATCH');
  const rebuilt=buildEndpointAuthority({evidence:JSON.parse(evidenceBytes),evidencePath,evidenceSHA256:sha256(evidenceBytes),
    version:manifest.manifestVersion.replace('1.1.0-weekly-v3.',''),sourceCommit:manifest.sourceCommit,issuedAt:manifest.issuedAt,expiresAt:manifest.expiresAt});
  assert.deepEqual(manifest,rebuilt,'AUTHORITY_NOT_REPRODUCIBLE');
  return {pin,manifest};
}
