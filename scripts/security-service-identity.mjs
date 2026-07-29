#!/usr/bin/env node
/**
 * Service identity policy and local mTLS drill.
 *
 * The drill creates an ephemeral local CA plus server/client certificates in a
 * temporary directory, performs a real mutual-TLS handshake, verifies that an
 * untrusted client issuer is rejected at the TLS layer, executes fail-closed
 * identity vectors, records metadata-only evidence, and removes all generated
 * signing material before returning.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tls from "node:tls";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --name value pairs");
    args[key.slice(2)] = value;
  }
  return args;
}

function deny(errorCode, detail) {
  return { allow: false, errorCode, detail };
}

function asTime(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function validateServiceIdentity({ identity, peer, policy, request, replayCache = new Set(), now = new Date() }) {
  const requiredIdentityFields = [
    "serviceId",
    "productId",
    "environment",
    "workloadIdentity",
    "certificateSubject",
    "certificateIssuer",
    "trustDomain",
    "sanUri",
    "owner",
    "serialNumber",
    "notBefore",
    "expiresAt",
    "rotationDueAt",
  ];
  for (const field of requiredIdentityFields) {
    if (typeof identity?.[field] !== "string" || identity[field].trim() === "") return deny("SERVICE_IDENTITY_INVALID", `missing ${field}`);
  }
  if (!Array.isArray(identity.audiences) || !Array.isArray(identity.scopes)) return deny("SERVICE_IDENTITY_INVALID", "audiences and scopes are required");
  if (peer?.authorized !== true) return deny("SERVICE_IDENTITY_INVALID", "mTLS peer was not authorized");
  if (peer.serialNumber !== identity.serialNumber) return deny("SERVICE_IDENTITY_INVALID", "certificate serial does not match identity registry");
  if (peer.subjectCN !== identity.certificateSubject) return deny("SERVICE_IDENTITY_INVALID", "certificate subject does not match identity registry");
  if (peer.issuerCN !== identity.certificateIssuer) return deny("SERVICE_IDENTITY_INVALID", "certificate issuer does not match identity registry");
  if (!peer.subjectAltName?.split(/,\s*/).includes(`URI:${identity.sanUri}`)) return deny("SERVICE_IDENTITY_INVALID", "certificate SAN does not match identity registry");

  if (!policy.trustedIssuers.includes(identity.certificateIssuer)) return deny("CERTIFICATE_ISSUER_UNTRUSTED", "issuer is outside the environment trust set");
  if (identity.trustDomain !== policy.trustDomain) return deny("SERVICE_IDENTITY_INVALID", "trust domain mismatch");
  if (identity.environment !== policy.environment) return deny("SERVICE_ENVIRONMENT_MISMATCH", "environment binding mismatch");
  if (policy.expectedServiceId && identity.serviceId !== policy.expectedServiceId) return deny("SERVICE_IDENTITY_INVALID", "service id mismatch");
  if (policy.expectedProductId && identity.productId !== policy.expectedProductId) return deny("SERVICE_IDENTITY_INVALID", "product id mismatch");
  if (!identity.audiences.includes(request.audience)) return deny("SERVICE_AUDIENCE_MISMATCH", "audience is not allowed");
  for (const scope of request.requiredScopes ?? []) {
    if (!identity.scopes.includes(scope)) return deny("SERVICE_SCOPE_DENIED", `scope ${scope} is not allowed`);
  }

  const nowMs = now.getTime();
  const skewMs = policy.clockSkewSeconds * 1000;
  const notBefore = asTime(identity.notBefore);
  const expiresAt = asTime(identity.expiresAt);
  const rotationDueAt = asTime(identity.rotationDueAt);
  if (notBefore === null || expiresAt === null || rotationDueAt === null) return deny("SERVICE_IDENTITY_INVALID", "identity time metadata is invalid");
  if (notBefore > nowMs + skewMs) return deny("CERTIFICATE_NOT_YET_VALID", "certificate is outside allowed clock skew");
  if (expiresAt <= nowMs - skewMs) return deny("CERTIFICATE_EXPIRED", "certificate is expired");
  if (rotationDueAt <= nowMs) return deny("CERTIFICATE_STALE", "certificate rotation deadline has passed");
  if (identity.revoked === true || policy.revokedSerials.includes(identity.serialNumber)) return deny("CERTIFICATE_REVOKED", "certificate serial is revoked");

  if (typeof request.nonce !== "string" || request.nonce.length < 16) return deny("REPLAY_DETECTED", "nonce is missing or too short");
  const issuedAt = asTime(request.issuedAt);
  if (issuedAt === null) return deny("CLOCK_SKEW_EXCEEDED", "request issuedAt is invalid");
  if (issuedAt > nowMs + skewMs) return deny("CLOCK_SKEW_EXCEEDED", "request is too far in the future");
  if (issuedAt < nowMs - policy.replayWindowSeconds * 1000 - skewMs) return deny("REQUEST_STALE", "request is outside the replay window");
  const replayKey = `${identity.serialNumber}:${request.nonce}`;
  if (replayCache.has(replayKey)) return deny("REPLAY_DETECTED", "nonce was already consumed");
  replayCache.add(replayKey);

  return {
    allow: true,
    audit: {
      serviceId: identity.serviceId,
      productId: identity.productId,
      environment: identity.environment,
      workloadIdentity: identity.workloadIdentity,
      audience: request.audience,
      scopes: request.requiredScopes ?? [],
      serialNumber: identity.serialNumber,
      owner: identity.owner,
      decisionAt: now.toISOString(),
    },
  };
}

function runOpenSsl(args, cwd) {
  execFileSync("openssl", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
}

function writeCertificateExtensions(path, lines) {
  writeFileSync(path, `[v3_req]\n${lines.join("\n")}\n`, { mode: 0o600 });
}

function generateCertificates(directory) {
  runOpenSsl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "trusted-ca-material.pem", "-out", "trusted-ca-cert.pem", "-subj", "/CN=YNX Local Test CA", "-days", "1"], directory);
  runOpenSsl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "untrusted-ca-material.pem", "-out", "untrusted-ca-cert.pem", "-subj", "/CN=Untrusted Local CA", "-days", "1"], directory);

  runOpenSsl(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "server-material.pem", "-out", "server-request.pem", "-subj", "/CN=security-gate.local"], directory);
  writeCertificateExtensions(resolve(directory, "server-ext.cnf"), [
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
    "extendedKeyUsage=serverAuth",
    "keyUsage=digitalSignature,keyEncipherment",
  ]);
  runOpenSsl(["x509", "-req", "-in", "server-request.pem", "-CA", "trusted-ca-cert.pem", "-CAkey", "trusted-ca-material.pem", "-CAcreateserial", "-out", "server-cert.pem", "-days", "1", "-extfile", "server-ext.cnf", "-extensions", "v3_req"], directory);

  runOpenSsl(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "client-material.pem", "-out", "client-request.pem", "-subj", "/CN=oracle-reporter"], directory);
  writeCertificateExtensions(resolve(directory, "client-ext.cnf"), [
    "subjectAltName=URI:spiffe://ynx.local/testnet/19-oracle/oracle-reporter",
    "extendedKeyUsage=clientAuth",
    "keyUsage=digitalSignature",
  ]);
  runOpenSsl(["x509", "-req", "-in", "client-request.pem", "-CA", "trusted-ca-cert.pem", "-CAkey", "trusted-ca-material.pem", "-CAcreateserial", "-out", "client-cert.pem", "-days", "1", "-extfile", "client-ext.cnf", "-extensions", "v3_req"], directory);

  runOpenSsl(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "untrusted-client-material.pem", "-out", "untrusted-client-request.pem", "-subj", "/CN=oracle-reporter"], directory);
  runOpenSsl(["x509", "-req", "-in", "untrusted-client-request.pem", "-CA", "untrusted-ca-cert.pem", "-CAkey", "untrusted-ca-material.pem", "-CAcreateserial", "-out", "untrusted-client-cert.pem", "-days", "1", "-extfile", "client-ext.cnf", "-extensions", "v3_req"], directory);
}

function peerMetadata(certificate) {
  return {
    authorized: true,
    serialNumber: certificate.serialNumber,
    subjectCN: certificate.subject?.CN ?? null,
    issuerCN: certificate.issuer?.CN ?? null,
    subjectAltName: certificate.subjectaltname ?? "",
    validFrom: certificate.valid_from,
    validTo: certificate.valid_to,
    fingerprint256: certificate.fingerprint256,
  };
}

async function startMtlsServer(directory) {
  const sockets = new Set();
  const tlsClientErrors = [];
  const server = tls.createServer({
    key: readFileSync(resolve(directory, "server-material.pem")),
    cert: readFileSync(resolve(directory, "server-cert.pem")),
    ca: readFileSync(resolve(directory, "trusted-ca-cert.pem")),
    requestCert: true,
    rejectUnauthorized: true,
    minVersion: "TLSv1.3",
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("tlsClientError", (error) => {
    tlsClientErrors.push(error.code ?? error.message);
  });
  server.on("secureConnection", (socket) => {
    socket.end("YNX_MTLS_OK");
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  return { server, sockets, tlsClientErrors };
}

async function connectMtls({ directory, server, trustedClient }) {
  const address = server.address();
  return new Promise((resolveConnect) => {
    const socket = tls.connect({
      host: "127.0.0.1",
      port: address.port,
      servername: "localhost",
      key: readFileSync(resolve(directory, trustedClient ? "client-material.pem" : "untrusted-client-material.pem")),
      cert: readFileSync(resolve(directory, trustedClient ? "client-cert.pem" : "untrusted-client-cert.pem")),
      ca: readFileSync(resolve(directory, "trusted-ca-cert.pem")),
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
    });
    let settled = false;
    let response = "";
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveConnect(result);
    };
    socket.setEncoding("utf8");
    socket.setTimeout(3000, () => finish({ connected: false, error: "timeout" }));
    socket.once("secureConnect", () => {
      if (!socket.authorized) finish({ connected: false, error: socket.authorizationError ?? "unauthorized" });
    });
    socket.on("data", (chunk) => {
      response += chunk;
      if (response.includes("YNX_MTLS_OK")) finish({ connected: true });
    });
    socket.once("error", (error) => finish({ connected: false, error: error.code ?? error.message }));
    socket.once("close", () => {
      if (!settled) finish({ connected: false, error: "closed-before-server-acceptance" });
    });
  });
}

async function capturePeer(directory, server) {
  return new Promise((resolvePeer, rejectPeer) => {
    const onConnection = (socket) => {
      try {
        const metadata = peerMetadata(socket.getPeerCertificate(true));
        server.off("secureConnection", onConnection);
        resolvePeer(metadata);
      } catch (error) {
        rejectPeer(error);
      }
    };
    server.on("secureConnection", onConnection);
    connectMtls({ directory, server, trustedClient: true }).then((result) => {
      if (!result.connected) rejectPeer(new Error(`trusted mTLS connection failed: ${result.error}`));
    });
  });
}

async function closeMtlsServer(runtime) {
  if (!runtime) return;
  for (const socket of runtime.sockets) socket.destroy();
  await Promise.race([
    new Promise((resolveClose) => runtime.server.close(resolveClose)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 1000)),
  ]);
}

function vector(id, result, expectedErrorCode = null) {
  const pass = expectedErrorCode === null ? result.allow === true : result.allow === false && result.errorCode === expectedErrorCode;
  return { id, pass, observed: result.allow ? "allow" : result.errorCode, expected: expectedErrorCode ?? "allow" };
}

export async function runLocalMtlsDrill({ sourceCommit, evidencePath, now = new Date() }) {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error("sourceCommit must be a full Git SHA");
  const directory = mkdtempSync(resolve(tmpdir(), "ynx-mtls-drill-"));
  const startedAt = new Date();
  let runtime;
  try {
    generateCertificates(directory);
    runtime = await startMtlsServer(directory);
    const peer = await capturePeer(directory, runtime.server);
    const untrusted = await connectMtls({ directory, server: runtime.server, trustedClient: false });

    const identity = {
      serviceId: "oracle-reporter",
      productId: "19-oracle",
      environment: "testnet",
      workloadIdentity: "spiffe://ynx.local/testnet/19-oracle/oracle-reporter",
      certificateSubject: "oracle-reporter",
      certificateIssuer: "YNX Local Test CA",
      trustDomain: "ynx.local",
      sanUri: "spiffe://ynx.local/testnet/19-oracle/oracle-reporter",
      audiences: ["data-fabric"],
      scopes: ["market-data:publish"],
      notBefore: new Date(now.getTime() - 60_000).toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      rotationDueAt: new Date(now.getTime() + 1_800_000).toISOString(),
      serialNumber: peer.serialNumber,
      revoked: false,
      owner: "19-oracle",
    };
    const policy = {
      environment: "testnet",
      trustDomain: "ynx.local",
      trustedIssuers: ["YNX Local Test CA"],
      expectedServiceId: "oracle-reporter",
      expectedProductId: "19-oracle",
      clockSkewSeconds: 60,
      replayWindowSeconds: 300,
      revokedSerials: [],
    };
    const baseRequest = {
      audience: "data-fabric",
      requiredScopes: ["market-data:publish"],
      issuedAt: now.toISOString(),
      nonce: randomUUID(),
    };
    const fresh = () => ({ ...baseRequest, nonce: randomUUID() });
    const replayCache = new Set();
    const vectors = [];
    vectors.push(vector("valid-service-identity", validateServiceIdentity({ identity, peer, policy, request: fresh(), replayCache, now })));
    vectors.push(vector("wrong-service", validateServiceIdentity({ identity, peer, policy: { ...policy, expectedServiceId: "bridge-relayer" }, request: fresh(), replayCache, now }), "SERVICE_IDENTITY_INVALID"));
    vectors.push(vector("wrong-environment", validateServiceIdentity({ identity, peer, policy: { ...policy, environment: "production" }, request: fresh(), replayCache, now }), "SERVICE_ENVIRONMENT_MISMATCH"));
    vectors.push(vector("wrong-audience", validateServiceIdentity({ identity, peer, policy, request: { ...fresh(), audience: "treasury" }, replayCache, now }), "SERVICE_AUDIENCE_MISMATCH"));
    vectors.push(vector("least-privilege-scope", validateServiceIdentity({ identity, peer, policy, request: { ...fresh(), requiredScopes: ["market-data:publish", "treasury:write"] }, replayCache, now }), "SERVICE_SCOPE_DENIED"));
    vectors.push(vector("revoked-certificate", validateServiceIdentity({ identity: { ...identity, revoked: true }, peer, policy, request: fresh(), replayCache, now }), "CERTIFICATE_REVOKED"));
    vectors.push(vector("stale-certificate", validateServiceIdentity({ identity: { ...identity, rotationDueAt: new Date(now.getTime() - 1).toISOString() }, peer, policy, request: fresh(), replayCache, now }), "CERTIFICATE_STALE"));
    vectors.push(vector("untrusted-issuer-policy", validateServiceIdentity({ identity: { ...identity, certificateIssuer: "Untrusted Local CA" }, peer: { ...peer, issuerCN: "Untrusted Local CA" }, policy, request: fresh(), replayCache, now }), "CERTIFICATE_ISSUER_UNTRUSTED"));
    const replayRequest = fresh();
    validateServiceIdentity({ identity, peer, policy, request: replayRequest, replayCache, now });
    vectors.push(vector("replay", validateServiceIdentity({ identity, peer, policy, request: replayRequest, replayCache, now }), "REPLAY_DETECTED"));
    vectors.push(vector("clock-skew", validateServiceIdentity({ identity, peer, policy, request: { ...fresh(), issuedAt: new Date(now.getTime() + 120_000).toISOString() }, replayCache, now }), "CLOCK_SKEW_EXCEEDED"));

    const completedAt = new Date();
    const result = {
      schemaVersion: 1,
      scenario: "local-ephemeral-ca-mtls-and-service-identity-policy",
      sourceCommit,
      environment: "local",
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      result: untrusted.connected === false && vectors.every((entry) => entry.pass) ? "passed-local" : "failed",
      tls: {
        minimumVersion: "TLSv1.3",
        mutualAuthentication: true,
        trustedClientConnected: true,
        untrustedIssuerRejected: untrusted.connected === false,
        serverRejectedClientErrors: runtime.tlsClientErrors.length,
        peer: {
          subjectCN: peer.subjectCN,
          issuerCN: peer.issuerCN,
          subjectAltName: peer.subjectAltName,
          serialNumber: peer.serialNumber,
          fingerprint256: peer.fingerprint256,
        },
      },
      vectors,
      privateMaterialPersisted: false,
      limitations: [
        "ephemeral local CA only",
        "no production certificate authority",
        "no external revocation service",
        "no production rotation automation",
        "no central workload identity acceptance",
      ],
    };
    if (evidencePath) {
      const output = resolve(root, evidencePath);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    }
    if (result.result !== "passed-local") throw new Error("local mTLS drill failed");
    return result;
  } finally {
    await closeMtlsServer(runtime);
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const args = parseArgs(process.argv.slice(3));
    if (command !== "local-drill") throw new Error("usage: security-service-identity.mjs local-drill --source-commit SHA [--evidence PATH]");
    const result = await runLocalMtlsDrill({ sourceCommit: args["source-commit"], evidencePath: args.evidence });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
