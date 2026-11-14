import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { YNXCloudClient } from '../sdk/index.js';

// Real SDK multipart transport with PUBLIC opaque proof/signature bytes.
// This does not verify cryptography, approve a resource or execute a project.
const hash = b => createHash('sha256').update(b).digest('hex');
const artifact = Buffer.from("console.log('PUBLIC');\n");
const binding = { byteSize: artifact.length, contentDigest: hash(artifact), projectId: 'PUBLIC_PROJECT', publishPurpose: 'deploy', targetEnvironment: 'PUBLIC_ENV', version: '1' };
const manifest = JSON.stringify(binding);
const requestId = 'PUBLIC_bound_original_123456';

test('original SDK transports complete approval larger than 64KiB without reencoding', async t => {
  const approval = JSON.stringify({ requestOriginal: 'PUBLIC_REQUEST', proofOriginal: 'P'.repeat(80000), invocationOriginal: manifest, signatureOriginal: 'S'.repeat(80000), actualApprovalRef: 'PUBLIC_NOT_APPROVAL' });
  let received = null;
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const request = new Request('http://public.invalid/upload', { method: req.method, headers: req.headers, body: Buffer.concat(chunks) });
      const form = await request.formData();
      received = { approval: await form.get('approval').text(), manifest: await form.get('manifest').text(), artifact: Buffer.from(await form.get('artifact').arrayBuffer()) };
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ requestId, binding, manifestSHA256: hash(manifest), approvalSHA256: hash(approval), publisherId: 'PUBLIC_PUBLISHER', resourceId: 'PUBLIC_RESOURCE', state: 'running', deploymentId: 'PUBLIC_CONTAINER', runtimeUrl: 'https://public.invalid/runtime', logs: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    } catch (err) { res.writeHead(500); res.end(String(err)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const client = new YNXCloudClient({ endpoint: `http://127.0.0.1:${server.address().port}`, product: 'cloud', getDeploymentRequestHeaders: () => ({ 'X-PUBLIC-TEST-PROOF': 'NOT_REAL' }) });
  const op = await client.submitIDEDeployment({ requestId, manifest, artifact, approval });
  assert.equal(op.approvalSHA256, hash(approval));
  assert.equal(received.approval, approval); assert.equal(received.manifest, manifest); assert.deepEqual(received.artifact, artifact);
});

test('approval exceeding original Auth 1MiB cap is refused before any network send', async () => {
  let sends = 0;
  const client = new YNXCloudClient({ endpoint: 'http://127.0.0.1:1', product: 'cloud', getDeploymentRequestHeaders: () => ({ 'X-PUBLIC-TEST-PROOF': 'NOT_REAL' }), fetch: () => { sends++; throw new Error('must not send oversized approval'); } });
  await assert.rejects(client.submitIDEDeployment({ requestId, manifest, artifact, approval: 'X'.repeat(1048577) }));
  assert.equal(sends, 0);
});
