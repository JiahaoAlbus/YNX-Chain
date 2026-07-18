import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FinanceWalletGateway} from '../src/gateway.mjs';
import {signGatewayChallenge} from '@ynx-chain/wallet-auth';

const vector=JSON.parse(readFileSync(new URL('../../integration/wallet-auth/test-vector.json',import.meta.url),'utf8'));

test('canonical Finance Wallet approval creates a scoped revocable session',()=>{
  const times=['2026-07-18T08:01:30.000Z','2026-07-18T08:02:00.000Z','2026-07-18T08:02:10.000Z'];let index=0;
  const gateway=new FinanceWalletGateway({registry:vector.registryEntry,internalKey:'i'.repeat(32),now:()=>new Date(times[Math.min(index++,times.length-1)])});
  const challenge=gateway.begin({authorizationRequest:vector.request,walletApproval:vector.approval});
  assert.equal(challenge.requestDigest,vector.requestDigest);
  const completed=gateway.complete({authorizationRequest:vector.request,walletApproval:vector.approval,gatewayCompletion:signGatewayChallenge(challenge,'QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI')});
  const session=gateway.introspect(completed.token);
  assert.equal(session.verifierVersion,'wallet-auth-v1');
  assert.equal(session.productClientId,'ynx-finance-v1');
  assert.deepEqual(session.scopes,vector.registryEntry.scopes);
  gateway.revoke(completed.token);
  assert.throws(()=>gateway.introspect(completed.token),/missing/);
});

test('tamper and replay fail closed',()=>{
  const at=()=>new Date('2026-07-18T08:01:30.000Z');
  const gateway=new FinanceWalletGateway({registry:vector.registryEntry,internalKey:'i'.repeat(32),now:at});
  assert.throws(()=>gateway.begin({authorizationRequest:{...vector.request,bundleId:'evil.product'},walletApproval:vector.approval}));
  const challenge=gateway.begin({authorizationRequest:vector.request,walletApproval:vector.approval});
  const completion={authorizationRequest:vector.request,walletApproval:vector.approval,gatewayCompletion:signGatewayChallenge(challenge,'QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI')};
  gateway.complete(completion);
  assert.throws(()=>gateway.complete(completion),/consumed/);
});
