import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { YNXCloudClient, YNXCloudDeploymentUnknownError } from '../sdk/index.js';

// PUBLIC response controls only. Hash equality is byte identity, not trusted
// Source, approval, signature verification or proof of deployed execution.
const hash = value => createHash('sha256').update(value).digest('hex');
function input() {
  const artifact = new Uint8Array(Buffer.from('PUBLIC immutable artifact'));
  const binding = { projectId: 'PUBLIC_PROJECT', version: '1', contentDigest: hash(artifact), publishPurpose: 'deploy', targetEnvironment: 'PUBLIC_ENV', byteSize: artifact.length };
  return { requestId: 'PUBLIC_receipt_request_123456', artifact, manifest: JSON.stringify(binding), approval: new Uint8Array([0, 255, 1, 128, 80]), binding };
}
function receipt(i) {
  return { requestId: i.requestId, binding: i.binding, manifestSHA256: hash(i.manifest), approvalSHA256: hash(i.approval), publisherId: 'PUBLIC_PUBLISHER', resourceId: 'PUBLIC_RESOURCE', state: 'running', deploymentId: 'PUBLIC_CONTAINER', runtimeUrl: 'https://public.invalid/runtime' };
}
function client(fetch) {
  return new YNXCloudClient({ endpoint: 'https://public.invalid', product: 'cloud', getDeploymentRequestHeaders: () => ({ 'X-PUBLIC': 'NOT_AUTHORITY' }), fetch, maxRetries: 5 });
}

for (const field of ['manifestSHA256', 'approvalSHA256']) {
  test(`different ${field} is UNKNOWN even when all six approved selection fields match`, async () => {
    const i = input(), result = receipt(i), requests = [];
    result[field] = field === 'manifestSHA256' ? hash(JSON.stringify(i.binding, null, 2)) : hash('PUBLIC different approval');
    const c = client(async (url, options) => {
      requests.push({ url, method: options.method });
      return Response.json(result);
    });
    await assert.rejects(c.submitIDEDeployment(i), error => error instanceof YNXCloudDeploymentUnknownError && error.operationRequestId === i.requestId && error.state === 'unknown');
    await assert.rejects(c.submitIDEDeployment(i), YNXCloudDeploymentUnknownError);
    assert.deepEqual(requests.map(request => request.method), ['POST']);
    // Recovery queries the original request, never posts again or selects a
    // new request just because the receipt was not trustworthy.
    await c.getIDEDeploymentStatus(i.requestId);
    assert.deepEqual(requests.map(request => request.method), ['POST', 'GET']);
    assert.ok(requests[1].url.endsWith('/' + i.requestId));
  });
  test(`missing ${field} cannot be treated as a submitted deployment receipt`, async () => {
    const i = input(), result = receipt(i);
    delete result[field];
    let sends = 0;
    const c = client(async () => { sends++; return Response.json(result); });
    await assert.rejects(c.submitIDEDeployment(i), YNXCloudDeploymentUnknownError);
    assert.equal(sends, 1);
  });
}

test('exact opaque approval and original manifest bytes bind the response without reencoding', async () => {
  const i = input(), expected = receipt(i), originalApproval = new Uint8Array(i.approval), originalArtifact = new Uint8Array(i.artifact);
  let sends = 0;
  const c = client(async (_, options) => {
    sends++;
    // Changing caller-owned buffers after dispatch cannot change the snapshotted
    // multipart body or the expected receipt hashes held by this submission.
    i.approval.fill(3); i.artifact.fill(7);
    const sentManifest = new Uint8Array(await options.body.get('manifest').arrayBuffer());
    const sentApproval = new Uint8Array(await options.body.get('approval').arrayBuffer());
    const sentArtifact = new Uint8Array(await options.body.get('artifact').arrayBuffer());
    assert.equal(hash(sentManifest), expected.manifestSHA256);
    assert.equal(hash(sentApproval), expected.approvalSHA256);
    assert.deepEqual(sentApproval, originalApproval); assert.deepEqual(sentArtifact, originalArtifact);
    return Response.json(expected);
  });
  const result = await c.submitIDEDeployment(i);
  assert.equal(result.approvalSHA256, expected.approvalSHA256);
  assert.equal(result.manifestSHA256, expected.manifestSHA256); assert.equal(sends, 1);
});
