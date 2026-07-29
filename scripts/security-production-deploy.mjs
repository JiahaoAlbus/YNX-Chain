#!/usr/bin/env node
/**
 * Operator-controlled initial production deployment.
 *
 * The runtime accepts only a cryptographically verified production release,
 * binds an explicit Kubernetes context and cluster UID, performs server-side
 * dry-run and reconciliation, verifies live security controls, then probes the
 * signed public endpoint policy. Updates are refused here and must use the
 * separate blue-green path.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bindProductionReleaseApproval,
  consumeProductionApproval,
} from "./security-production-approval.mjs";
import {
  deliverProductionChangeAlert,
  preflightProductionAlertInputs,
} from "./security-production-alert.mjs";
import { acquireProductionLease } from "./security-production-lease.mjs";
import { bindProductionOperationExecution } from "./security-production-operation-binding.mjs";
import { verifyProductionOperatorRbac } from "./security-production-rbac.mjs";
import { verifyProductionReleaseBundle } from "./security-production-release.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const namespace = "ynx-services";
const fieldManager = "ynx-security-platform-production";
const expectedTlsHosts = new Set([
  "rpc.ynxweb4.com",
  "evm.ynxweb4.com",
  "rest.ynxweb4.com",
  "faucet.ynxweb4.com",
  "indexer.ynxweb4.com",
  "explorer.ynxweb4.com",
  "ai.ynxweb4.com",
  "web4.ynxweb4.com",
]);

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("arguments must be --name value pairs");
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:@/-]{3,256}$/.test(value)) {
    throw new Error(`${label} must be a safe identifier`);
  }
  return value;
}

function repositoryPath(relativePath, label) {
  if (typeof relativePath !== "string" || relativePath === "") throw new Error(`${label} is required`);
  const absolute = resolve(root, relativePath);
  if (!absolute.startsWith(`${root}/`)) throw new Error(`${label} must stay inside the repository`);
  return absolute;
}

function runText(execFile, command, args, action, input, maxBuffer = 16 * 1024 * 1024) {
  try {
    return execFile(command, args, {
      cwd: root,
      encoding: "utf8",
      input,
      maxBuffer,
      stdio: input === undefined
        ? ["ignore", "pipe", "pipe"]
        : ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error(`${action} failed`);
  }
}

function runJson(execFile, command, args, action) {
  const output = runText(execFile, command, args, action);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${action} returned invalid JSON`);
  }
}

function writeEvidence(relativePath, value) {
  const output = repositoryPath(relativePath, "evidencePath");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function clusterPreflight(execFile, context, expectedClusterUid) {
  safeIdentifier(context, "context");
  safeIdentifier(expectedClusterUid, "expectedClusterUid");
  const currentContext = runText(
    execFile,
    "kubectl",
    ["config", "current-context"],
    "Kubernetes current-context inspection",
  );
  if (currentContext !== context) throw new Error("active Kubernetes context does not match the acknowledged context");
  const systemNamespace = runJson(execFile, "kubectl", [
    "--context", context, "get", "namespace", "kube-system", "-o", "json",
  ], "Kubernetes cluster identity inspection");
  if (systemNamespace.metadata?.uid !== expectedClusterUid) {
    throw new Error("kube-system UID does not match the acknowledged production cluster");
  }
  const version = runJson(execFile, "kubectl", [
    "--context", context, "version", "-o", "json",
  ], "Kubernetes server version inspection");
  if (typeof version.serverVersion?.gitVersion !== "string") {
    throw new Error("Kubernetes server version is missing");
  }
  const existing = runText(execFile, "kubectl", [
    "--context", context, "get", "deployment", "quant-worker",
    "-n", namespace,
    "--ignore-not-found=true",
    "-o", "json",
  ], "existing production release inspection");
  if (existing !== "") {
    throw new Error("existing production release requires the blue-green update runtime");
  }
  return {
    serverVersion: version.serverVersion.gitVersion,
    contextSha256: sha256(context),
    clusterUidSha256: sha256(expectedClusterUid),
  };
}

export function preflightProductionDeployment({
  context,
  expectedClusterUid,
  execFile = execFileSync,
  verifyRelease = verifyProductionReleaseBundle,
  authorize = verifyProductionOperatorRbac,
  now = new Date(),
  ...releaseOptions
}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("production deployment clock is invalid");
  }
  const release = verifyRelease({
    ...releaseOptions,
    execFile,
    now,
  });
  if (
    release.receipt?.productionSigned !== true
    || release.receipt?.deployedPublic !== false
    || typeof release.manifest !== "string"
    || release.manifest.trim() === ""
  ) {
    throw new Error("production release preflight did not return a signed deployable manifest");
  }
  const cluster = clusterPreflight(execFile, context, expectedClusterUid);
  if (typeof authorize !== "function") throw new Error("production RBAC verifier is required");
  const operatorAuthorization = authorize({
    context,
    manifest: release.manifest,
    mode: "initial",
    execFile,
  });
  if (operatorAuthorization?.pass !== true) {
    throw new Error("production operator RBAC preflight did not pass");
  }
  const dryRun = runText(execFile, "kubectl", [
    "--context", context,
    "apply",
    "--server-side",
    "--dry-run=server",
    `--field-manager=${fieldManager}`,
    "-f", "-",
  ], "production server-side dry-run", release.manifest);
  if (dryRun === "") throw new Error("production server-side dry-run returned no receipt");
  return {
    ...release,
    receipt: {
      ...release.receipt,
      action: "production-deployment-preflight",
      asOf: now.toISOString(),
      confidence: "cryptographic-release-and-direct-cluster-preflight",
      environment: "production",
      namespace,
      contextSha256: cluster.contextSha256,
      clusterUidSha256: cluster.clusterUidSha256,
      serverVersion: cluster.serverVersion,
      operatorAuthorization,
      serverDryRunPassed: true,
      serverDryRunOutputSha256: sha256(dryRun),
      mutationPerformed: false,
      deployedPublic: false,
    },
  };
}

export function verifyProductionReadiness(execFile, context, release) {
  const releaseAsOf = Date.parse(release.receipt?.asOf);
  if (!Number.isFinite(releaseAsOf)) throw new Error("production release readiness time is invalid");
  const namespaceState = runJson(execFile, "kubectl", [
    "--context", context, "get", "namespace", namespace, "-o", "json",
  ], "production namespace verification");
  const deployments = runJson(execFile, "kubectl", [
    "--context", context, "get", "deployment", "-n", namespace, "-o", "json",
  ], "production deployment verification");
  const pods = runJson(execFile, "kubectl", [
    "--context", context, "get", "pods", "-n", namespace, "-o", "json",
  ], "production pod verification");
  const policies = runJson(execFile, "kubectl", [
    "--context", context, "get", "networkpolicy", "-n", namespace, "-o", "json",
  ], "production network-policy verification");
  const peerAuthentications = runJson(execFile, "kubectl", [
    "--context", context, "get", "peerauthentication", "-n", namespace, "-o", "json",
  ], "production mTLS verification");
  const cronJobs = runJson(execFile, "kubectl", [
    "--context", context, "get", "cronjob", "-n", namespace, "-o", "json",
  ], "production backup schedule verification");
  const secretProviders = runJson(execFile, "kubectl", [
    "--context", context, "get", "secretproviderclass", "-n", namespace, "-o", "json",
  ], "production secret-provider verification");
  const ingress = runJson(execFile, "kubectl", [
    "--context", context, "get", "ingress", "ynx-public-services",
    "-n", namespace, "-o", "json",
  ], "production ingress verification");
  const quota = runJson(execFile, "kubectl", [
    "--context", context, "get", "resourcequota", "services-quota",
    "-n", namespace, "-o", "json",
  ], "production quota verification");
  const hpa = runJson(execFile, "kubectl", [
    "--context", context, "get", "hpa", "ai-gateway-hpa",
    "-n", namespace, "-o", "json",
  ], "production autoscaling verification");
  const waf = runJson(execFile, "kubectl", [
    "--context", context, "get", "configmap", "nginx-ingress-waf-config",
    "-n", "ingress-nginx", "-o", "json",
  ], "production WAF verification");
  const certificate = runJson(execFile, "kubectl", [
    "--context", context, "get", "certificate", "ynx-tls-cert",
    "-n", namespace, "-o", "json",
  ], "production TLS certificate verification");

  const allowedImageDigests = new Set(release.attestation.images.map((image) => (
    image.reference.match(/@sha256:([0-9a-f]{64})$/)?.[1]
  )));
  const deploymentItems = deployments.items ?? [];
  const quantWorker = deploymentItems.find((item) => item.metadata?.name === "quant-worker");
  const podItems = (pods.items ?? []).filter((pod) => pod.metadata?.labels?.app === "quant-worker");
  const ingressTlsHosts = new Set((ingress.spec?.tls ?? []).flatMap((entry) => entry.hosts ?? []));
  const annotations = ingress.metadata?.annotations ?? {};
  const checks = [
    {
      id: "namespace-production",
      pass: namespaceState.metadata?.labels?.environment === "production",
    },
    {
      id: "quant-worker-ready",
      pass: quantWorker !== undefined
        && Number(quantWorker.spec?.replicas ?? 0) >= 3
        && Number(quantWorker.status?.observedGeneration ?? -1) >= Number(quantWorker.metadata?.generation ?? 0)
        && Number(quantWorker.status?.availableReplicas ?? 0) >= Number(quantWorker.spec?.replicas ?? 3)
        && quantWorker.metadata?.labels?.["security.ynx/source-commit"] === release.receipt.sourceCommit,
    },
    {
      id: "quant-worker-pods-ready",
      pass: podItems.length >= 3 && podItems.every((pod) => (
        pod.status?.conditions?.some((condition) => condition.type === "Ready" && condition.status === "True")
        && (pod.status?.containerStatuses ?? []).length > 0
        && (pod.status?.containerStatuses ?? []).every((status) => (
          status.ready === true
          && status.restartCount === 0
          && allowedImageDigests.has(status.imageID?.match(/@sha256:([0-9a-f]{64})$/)?.[1])
        ))
      )),
    },
    {
      id: "default-deny-network-policy",
      pass: (policies.items ?? []).some((item) => item.metadata?.name === "default-deny-all"),
    },
    {
      id: "strict-mtls",
      pass: (peerAuthentications.items ?? []).some((item) => item.spec?.mtls?.mode === "STRICT"),
    },
    {
      id: "active-backups",
      pass: (cronJobs.items ?? []).length > 0 && (cronJobs.items ?? []).every((item) => (
        item.spec?.suspend === false
        && item.metadata?.labels?.["security.ynx/source-commit"] === release.receipt.sourceCommit
      )),
    },
    {
      id: "secret-provider-installed",
      pass: (secretProviders.items ?? []).some((item) => item.metadata?.name === "ynx-production-secrets"),
    },
    {
      id: "public-ingress-tls",
      pass: ingress.spec?.ingressClassName === "nginx"
        && expectedTlsHosts.size === ingressTlsHosts.size
        && [...expectedTlsHosts].every((host) => ingressTlsHosts.has(host))
        && annotations["cert-manager.io/cluster-issuer"] === "letsencrypt-production"
        && annotations["nginx.ingress.kubernetes.io/ssl-redirect"] === "true"
        && annotations["nginx.ingress.kubernetes.io/enable-modsecurity"] === "true",
    },
    {
      id: "resource-quota",
      pass: quota.spec?.hard?.pods === "50"
        && quota.spec?.hard?.["services.loadbalancers"] === "3",
    },
    {
      id: "bounded-autoscaling",
      pass: Number(hpa.spec?.minReplicas ?? 0) >= 3
        && Number(hpa.spec?.maxReplicas ?? 0) <= 10,
    },
    {
      id: "waf-config-active",
      pass: waf.data?.["enable-modsecurity"] === "true"
        && waf.data?.["enable-owasp-modsecurity-crs"] === "true",
    },
    {
      id: "tls-certificate-ready",
      pass: certificate.spec?.secretName === "ynx-tls-cert"
        && certificate.spec?.issuerRef?.kind === "ClusterIssuer"
        && certificate.spec?.issuerRef?.name === "letsencrypt-production"
        && certificate.spec?.issuerRef?.group === "cert-manager.io"
        && certificate.status?.conditions?.some((condition) => (
          condition.type === "Ready" && condition.status === "True"
        ))
        && Number.isFinite(Date.parse(certificate.status?.notBefore))
        && Date.parse(certificate.status.notBefore) <= releaseAsOf + (5 * 60 * 1000)
        && Number.isFinite(Date.parse(certificate.status?.notAfter))
        && Date.parse(certificate.status.notAfter) >= releaseAsOf + (24 * 60 * 60 * 1000),
    },
  ];
  return {
    pass: checks.every((check) => check.pass),
    checks,
    deployments: deploymentItems.length,
    quantWorkerPods: podItems.length,
    cronJobs: (cronJobs.items ?? []).length,
    secretProviders: (secretProviders.items ?? []).length,
  };
}

function curlJson(execFile, url, policy, action) {
  const output = runText(execFile, "curl", [
    "--silent",
    "--show-error",
    "--fail-with-body",
    "--proto", "=https",
    "--tlsv1.2",
    "--connect-timeout", String(policy.connectTimeoutSeconds),
    "--max-time", String(policy.totalTimeoutSeconds),
    "--max-filesize", String(policy.maxResponseBytes),
    "--header", "Accept: application/json",
    url,
  ], action, undefined, policy.maxResponseBytes + 1024);
  if (Buffer.byteLength(output) > policy.maxResponseBytes) throw new Error(`${action} exceeded response limit`);
  try {
    return { value: JSON.parse(output), bytes: Buffer.byteLength(output), sha256: sha256(output) };
  } catch {
    throw new Error(`${action} returned invalid JSON`);
  }
}

function validProbeTimestamp(value, probedAt) {
  const timestamp = Date.parse(value);
  const reference = probedAt.getTime();
  return Number.isFinite(timestamp)
    && timestamp >= reference - (10 * 60 * 1000)
    && timestamp <= reference + (30 * 1000);
}

export function verifyProductionPublicEndpoints(execFile, release, probedAt) {
  const policy = release.publicProbePolicy;
  const tls = [];
  for (const host of policy.tlsHosts) {
    const output = runText(execFile, "curl", [
      "--silent",
      "--show-error",
      "--output", "/dev/null",
      "--proto", "=https",
      "--tlsv1.2",
      "--connect-timeout", String(policy.connectTimeoutSeconds),
      "--max-time", String(policy.totalTimeoutSeconds),
      "--write-out", "%{http_code}|%{ssl_verify_result}|%{remote_ip}",
      `https://${host}/`,
    ], `public TLS probe for ${host}`);
    const [httpCode, sslVerify, remoteIp] = output.split("|");
    if (!/^[1-5][0-9]{2}$/.test(httpCode) || sslVerify !== "0" || remoteIp === "") {
      throw new Error(`public TLS probe failed for ${host}`);
    }
    tls.push({
      hostSha256: sha256(host),
      httpCode: Number(httpCode),
      remoteIpSha256: sha256(remoteIp),
    });
  }

  const services = [];
  for (const service of policy.services) {
    const health = curlJson(
      execFile,
      `https://${service.host}${service.healthPath}`,
      policy,
      `public health probe for ${service.name}`,
    );
    const version = curlJson(
      execFile,
      `https://${service.host}${service.versionPath}`,
      policy,
      `public version probe for ${service.name}`,
    );
    if (
      health.value.status !== "ok"
      || health.value.environment !== "production"
      || health.value.source !== service.name
      || health.value.sourceCommit !== release.receipt.sourceCommit
      || health.value.version !== release.receipt.version
      || !validProbeTimestamp(health.value.asOf, probedAt)
      || version.value.environment !== "production"
      || version.value.source !== service.name
      || version.value.sourceCommit !== release.receipt.sourceCommit
      || version.value.version !== release.receipt.version
      || !validProbeTimestamp(version.value.asOf, probedAt)
    ) {
      throw new Error(`public response identity failed for ${service.name}`);
    }
    services.push({
      name: service.name,
      hostSha256: sha256(service.host),
      healthResponseSha256: health.sha256,
      healthResponseBytes: health.bytes,
      versionResponseSha256: version.sha256,
      versionResponseBytes: version.bytes,
    });
  }
  return {
    pass: true,
    tls,
    services,
    probedAt: probedAt.toISOString(),
    probePolicySha256: release.receipt.publicProbePolicySha256,
  };
}

export function deployProduction({
  context,
  expectedClusterUid,
  operatorId,
  changeId,
  acknowledge,
  evidencePath,
  rolloutTimeoutSeconds = 600,
  execFile = execFileSync,
  verifyRelease = verifyProductionReleaseBundle,
  authorize = verifyProductionOperatorRbac,
  approvalBinder = bindProductionReleaseApproval,
  approvalConsumer = consumeProductionApproval,
  alertDispatcher = deliverProductionChangeAlert,
  alertInputPreflight = preflightProductionAlertInputs,
  alertOptions,
  operatorBundlePreflight = null,
  leaseFactory = acquireProductionLease,
  leaseDurationSeconds = 600,
  now = () => new Date(),
  ...releaseOptions
}) {
  if (acknowledge !== "apply-production-release") {
    throw new Error("production deployment requires acknowledge=apply-production-release");
  }
  safeIdentifier(operatorId, "operatorId");
  safeIdentifier(changeId, "changeId");
  repositoryPath(evidencePath, "evidencePath");
  if (!Number.isInteger(rolloutTimeoutSeconds) || rolloutTimeoutSeconds < 60 || rolloutTimeoutSeconds > 1800) {
    throw new Error("rolloutTimeoutSeconds must be between 60 and 1800");
  }
  if (
    typeof now !== "function"
    || typeof leaseFactory !== "function"
    || typeof approvalBinder !== "function"
    || typeof approvalConsumer !== "function"
    || typeof alertDispatcher !== "function"
    || typeof alertInputPreflight !== "function"
  ) {
    throw new Error("production deployment clock, approval, and Lease dependencies are required");
  }
  const startedAt = now();
  const preflight = preflightProductionDeployment({
    ...releaseOptions,
    context,
    expectedClusterUid,
    execFile,
    verifyRelease,
    authorize,
    now: startedAt,
  });
  const changeApproval = approvalBinder({
    release: preflight,
    action: "production-deployment",
    operatorId,
    changeId,
    expectedClusterUid,
    now: startedAt,
  });
  if (changeApproval?.bound !== true) throw new Error("production change approval did not bind");
  const alertPreflight = alertInputPreflight({
    ...alertOptions,
    execFile,
    sourceCommit: preflight.receipt.runtimeSourceCommit,
    checkedAt: startedAt,
  });
  if (
    alertPreflight?.ready !== true
    || alertPreflight.alertDeliveryPerformed !== false
    || alertPreflight.productionMutationPerformed !== false
    || alertPreflight.sourceCommit !== preflight.receipt.runtimeSourceCommit
    || alertPreflight.credentialBinding?.bound !== true
    || !/^[0-9a-f]{64}$/.test(
      alertPreflight.credentialBinding.credentialIdentitySha256 ?? "",
    )
  ) {
    throw new Error("production alert external input preflight failed");
  }
  const operatorBundleBinding = operatorBundlePreflight === null
    ? null
    : bindProductionOperationExecution({
      preflight: operatorBundlePreflight,
      expectedOperation: "initial-deployment",
      runtimeSourceCommit: preflight.receipt.runtimeSourceCommit,
      changeApproval,
      alertInputPreflight: alertPreflight,
    });
  const productionLease = leaseFactory({
    context,
    operatorId,
    changeId,
    action: "production-deployment",
    durationSeconds: leaseDurationSeconds,
    execFile,
    now,
  });
  if (productionLease?.receipt == null || typeof productionLease.renew !== "function" || typeof productionLease.release !== "function") {
    throw new Error("production Lease factory returned an invalid handle");
  }
  const leaseRenewals = [];
  const intent = {
    ...preflight.receipt,
    action: "production-deployment",
    operatorId,
    changeId,
    startedAt: startedAt.toISOString(),
    state: "apply-not-confirmed",
    productionLease: productionLease.receipt,
    productionLeaseRenewals: leaseRenewals,
    productionLeaseRelease: null,
    productionLeaseReleased: false,
    changeApproval,
    approvalConsumption: null,
    approvalConsumptionAttempted: false,
    alertDelivery: null,
    alertDeliveryAttempted: false,
    alertInputPreflight: alertPreflight,
    operatorBundleBinding,
  };
  writeEvidence(evidencePath, intent);

  let applyOutput;
  let approvalConsumption = null;
  let approvalConsumptionAttempted = false;
  let alertDelivery = null;
  let alertDeliveryAttempted = false;
  try {
    leaseRenewals.push(productionLease.renew());
    alertDeliveryAttempted = true;
    alertDelivery = alertDispatcher({
      approval: changeApproval,
      operatorId,
      expectedClusterUid,
      ...alertOptions,
      execFile,
      sourceCommit: preflight.receipt.runtimeSourceCommit,
    });
    if (alertDelivery?.delivered !== true) {
      throw new Error("production change alert was not delivered");
    }
    if (
      alertDelivery.credentialBinding?.credentialIdentitySha256
      !== alertPreflight.credentialBinding.credentialIdentitySha256
    ) {
      throw new Error("production alert credential changed after external input preflight");
    }
    approvalConsumptionAttempted = true;
    approvalConsumption = approvalConsumer({
      context,
      approval: changeApproval,
      execFile,
    });
    if (approvalConsumption?.consumed !== true) {
      throw new Error("production change approval was not consumed");
    }
    applyOutput = runText(execFile, "kubectl", [
      "--context", context,
      "apply",
      "--server-side",
      `--field-manager=${fieldManager}`,
      "-f", "-",
    ], "production server-side apply", preflight.manifest);
    if (applyOutput === "") throw new Error("production server-side apply returned no receipt");
    const liveDiff = runText(execFile, "kubectl", [
      "--context", context,
      "diff",
      "--server-side",
      `--field-manager=${fieldManager}`,
      "-f", "-",
    ], "production live manifest reconciliation", preflight.manifest);
    if (liveDiff !== "") throw new Error("production live resources differ from the applied manifest");
    const rollout = runText(execFile, "kubectl", [
      "--context", context,
      "rollout", "status", "deployment", "--all",
      "-n", namespace,
      `--timeout=${rolloutTimeoutSeconds}s`,
    ], "production rollout verification");
    if (rollout === "") throw new Error("production rollout returned no receipt");
    const readiness = verifyProductionReadiness(execFile, context, preflight);
    if (!readiness.pass) {
      throw new Error(`production readiness failed: ${readiness.checks.filter((check) => !check.pass).map((check) => check.id).join(",")}`);
    }
    leaseRenewals.push(productionLease.renew());
    const probedAt = now();
    const probes = verifyProductionPublicEndpoints(execFile, preflight, probedAt);
    const completedAt = now();
    let productionLeaseRelease = null;
    let productionLeaseReleaseFailure = null;
    try {
      productionLeaseRelease = productionLease.release();
    } catch (leaseError) {
      productionLeaseReleaseFailure = leaseError.message;
    }
    const result = {
      ...intent,
      completedAt: completedAt.toISOString(),
      releasedAt: completedAt.toISOString(),
      state: productionLeaseRelease === null
        ? "deployed-public-verified-lease-release-pending"
        : "deployed-public-verified",
      applyOutputSha256: sha256(applyOutput),
      applyOutputBytes: Buffer.byteLength(applyOutput),
      liveManifestReconciled: true,
      rolloutOutputSha256: sha256(rollout),
      rolloutVerified: true,
      readiness,
      publicProbes: probes,
      productionLeaseRenewals: leaseRenewals,
      productionLeaseRelease,
      productionLeaseReleaseFailure,
      productionLeaseReleased: productionLeaseRelease !== null,
      changeApproval,
      approvalConsumption,
      approvalConsumptionAttempted,
      alertDelivery,
      alertDeliveryAttempted,
      alertInputPreflight: alertPreflight,
      operatorBundleBinding,
      productionSigned: true,
      mutationPerformed: true,
      deployedPublic: true,
    };
    writeEvidence(evidencePath, result);
    return result;
  } catch (error) {
    const failedAt = now();
    let productionLeaseRelease = null;
    let productionLeaseReleaseFailure = null;
    try {
      productionLeaseRelease = productionLease.release();
    } catch (leaseError) {
      productionLeaseReleaseFailure = leaseError.message;
    }
    const result = {
      ...intent,
      failedAt: failedAt.toISOString(),
      state: applyOutput === undefined ? "apply-not-confirmed" : "apply-completed-verification-failed",
      failure: error.message,
      applyOutputSha256: applyOutput === undefined ? null : sha256(applyOutput),
      applyOutputBytes: applyOutput === undefined ? null : Buffer.byteLength(applyOutput),
      productionLeaseRenewals: leaseRenewals,
      productionLeaseRelease,
      productionLeaseReleaseFailure,
      productionLeaseReleased: productionLeaseRelease !== null,
      changeApproval,
      approvalConsumption,
      approvalConsumptionAttempted,
      alertDelivery,
      alertDeliveryAttempted,
      alertInputPreflight: alertPreflight,
      operatorBundleBinding,
      productionSigned: true,
      mutationPerformed: alertDeliveryAttempted || approvalConsumptionAttempted || applyOutput !== undefined,
      deployedPublic: false,
    };
    writeEvidence(evidencePath, result);
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const args = parseArgs(process.argv.slice(3));
    const releaseOptions = {
      stagingInput: JSON.parse(readFileSync(resolve(args["staging-input"]), "utf8")),
      productionInput: JSON.parse(readFileSync(resolve(args["production-input"]), "utf8")),
      stagingEvidencePath: args["staging-evidence"],
      stagingEvidenceSha256: args["staging-evidence-sha256"],
      runtimeSourceCommit: args["runtime-source-commit"],
      version: args.version,
      imageEvidence: JSON.parse(readFileSync(resolve(args["image-evidence"]), "utf8")),
      approval: JSON.parse(readFileSync(resolve(args.approval), "utf8")),
      trustedSignerFingerprint: args["trusted-signer-fingerprint"],
      signerPolicyPath: args["signer-policy"],
      signerPolicySha256: args["signer-policy-sha256"],
      publicProbePolicyPath: args["public-probe-policy"],
      publicProbePolicySha256: args["public-probe-policy-sha256"],
      attestationPath: args.attestation,
      attestationSha256: args["attestation-sha256"],
      signaturePath: args.signature,
      signatureSha256: args["signature-sha256"],
    };
    const common = {
      ...releaseOptions,
      context: args.context,
      expectedClusterUid: args["cluster-uid"],
    };
    let result;
    if (command === "preflight") {
      ({ receipt: result } = preflightProductionDeployment(common));
    } else if (command === "deploy") {
      result = deployProduction({
        ...common,
        operatorId: args["operator-id"],
        changeId: args["change-id"],
        acknowledge: args.acknowledge,
        evidencePath: args.evidence,
        alertOptions: {
          endpoint: args["alert-endpoint"],
          expectedHost: args["alert-expected-host"],
          credentialHeaderFile: args["alert-credential-header-file"],
          credentialVersionFile: args["alert-credential-version-file"],
          credentialSecretInventory: JSON.parse(readFileSync(
            resolve(args["alert-secret-inventory"]),
            "utf8",
          )),
          trustedCredentialSecretInventorySha256: args["alert-secret-inventory-sha256"],
        },
        rolloutTimeoutSeconds: Number(args["rollout-timeout-seconds"] ?? 600),
        leaseDurationSeconds: Number(args["lease-duration-seconds"] ?? 600),
      });
    } else {
      throw new Error("usage: security-production-deploy.mjs preflight|deploy [signed release flags] --context NAME --cluster-uid UID [--alert-endpoint URL --alert-expected-host HOST --alert-credential-header-file /run/secrets/ynx/NAME --alert-credential-version-file /run/secrets/ynx/NAME.version-id --alert-secret-inventory PATH --alert-secret-inventory-sha256 SHA256] [deployment flags]");
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
