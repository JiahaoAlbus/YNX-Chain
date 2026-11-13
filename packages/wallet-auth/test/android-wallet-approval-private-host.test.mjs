import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { canonicalJSON } from '../src/canonical.js';
import { registrationPUBLICFixture } from './fixtures/device-v4-registration-portable.PUBLIC.mjs';

const fixture = registrationPUBLICFixture();
try {
  const bundle = readFileSync(process.argv[2], 'utf8');
  const sandbox = createContext({});
  runInContext(`Date = class extends Date {
    constructor(...args) { super(...(args.length ? args : [${+fixture.at}])); }
    static now() { return ${+fixture.at}; }
  }`, sandbox);
  const keys = Reflect.ownKeys(sandbox);
  const factory = runInContext(bundle, sandbox);
  assert.deepEqual(Reflect.ownKeys(sandbox), keys);
  assert.throws(() => factory({}), { code: 'ANDROID_APPROVAL_HOST_REQUIRED' });
  const owner = {};
  let live = true;
  const review = runInContext('JSON.parse(' + JSON.stringify(JSON.stringify({
    requestOriginal: canonicalJSON(fixture.request),
    registrationOriginal: fixture.registrationOriginal,
    account: fixture.identity.account,
    expiresAt: fixture.approval.expiresAt,
  })) + ')', sandbox);
  const host = {
    isOriginalApprovalOwner: ref => ref === owner,
    assertOriginalApprovalCurrent() { if (!live) throw Error('PUBLIC_OWNER_REVOKED'); },
    readOriginalApprovalReviewDATA: () => review,
    readOriginalApprovalPolicyDATA: () => canonicalJSON(fixture.policyOriginal),
  };
  const caller = factory(host);
  assert.throws(() => caller.prepare({}), { code: 'ANDROID_APPROVAL_OWNER_NOT_CURRENT' });
  const ref = caller.prepare(owner);
  assert.throws(() => factory(host).read(ref), { code: 'ANDROID_APPROVAL_PLAN_REQUIRED' });
  const plan = caller.read(ref);
  assert.equal(plan.unsignedOriginal, canonicalJSON(Object.fromEntries(
    Object.entries(fixture.approval).filter(([key]) => key !== 'walletProof'))));
  const sign = index => {
    const bytes = fixture.sign(index, plan.purpose, Buffer.from(plan.message));
    return runInContext('Uint8Array.from(' + JSON.stringify([...bytes]) + ')', sandbox);
  };
  assert.throws(() => caller.attach(ref, sign(1)), { code: 'PQ_SESSION_MEMBER_BINDING_MISMATCH' });
  const member = sign(0);
  const result = caller.attach(ref, member);
  assert.equal(result.signatureVerified, true);
  assert.equal(result.authorized, false);
  assert.equal(Object.hasOwn(result, 'committed'), false);
  assert.throws(() => caller.prepare(owner), { code: 'ANDROID_APPROVAL_OWNER_ALREADY_SELECTED' });
  live = false;
  assert.throws(() => caller.attach(ref, member), /PUBLIC_OWNER_REVOKED/);
  console.log('PASS bundled Wallet approval: private realm, original owner, exact E5, foreign Member and revoked owner refused');
} finally {
  fixture.close();
}
