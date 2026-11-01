import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sha256} from '@noble/hashes/sha2.js';
import {encodePQRegistrationIntent} from '../src/pq-wallet-authorization.js';
import {parsePQAccountAuthorization, preparePQClassicMigrationAuthorization} from '../src/pq-wallet-policy.js';
test('classic migration helper is fixed SHA256 full intent, refuses the post-activation branch', async () => {
  const v=JSON.parse(await readFile(new URL('../testdata/pq-wallet-wire-r1.json',import.meta.url)));
  const network={chainId:v.transfer.fields.chainId,nativeChainId:'6423',owner:v.transfer.fields.from};
  const base={owner:network.owner,executionHeight:'20',ledgerNonce:'11',algorithmVersion:'legacy',enabled:true,records:[],policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:network.chainId,enableAt:'10'};
  const intent={...v.registration.fields,priorRevision:'0',newRevision:'1',ledgerNonce:'12',activateAt:'30'};
  const prepared=preparePQClassicMigrationAuthorization(parsePQAccountAuthorization(base,network),intent);
  assert(Buffer.from(prepared.digest).equals(Buffer.from(sha256(encodePQRegistrationIntent(intent)))));
  const original=Buffer.from(prepared.digest);prepared.digest.fill(0);assert(Buffer.from(prepared.digest).equals(original));
  const active={...base,algorithmVersion:'YNX-BATCH/v0.1',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:network.owner,pkA:'00'.repeat(2592),pkB:'00'.repeat(64),revision:'1',registeredAt:'10',activeFrom:'20',ledgerNonce:'1'}]};
  assert.throws(()=>preparePQClassicMigrationAuthorization(parsePQAccountAuthorization(active,network),{...intent,priorRevision:'1',newRevision:'2'}),{code:'PQ_ACTIVE_ACCOUNT_LEGACY_ENTRY_REFUSED'});
});
