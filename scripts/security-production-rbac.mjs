#!/usr/bin/env node
/**
 * Read-only authorization preflight for production release operators.
 *
 * Required checks are derived from the signed manifest and bounded runtime
 * reads. High-risk permissions are explicitly forbidden so a cluster-admin or
 * secret-reading identity cannot be used as the production deploy identity.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const modes = new Set(["initial", "blue-green", "rollback"]);
const kindResources = new Map([
  ["v1|ConfigMap", "configmaps"],
  ["v1|LimitRange", "limitranges"],
  ["v1|Namespace", "namespaces"],
  ["v1|ResourceQuota", "resourcequotas"],
  ["v1|ServiceAccount", "serviceaccounts"],
  ["apps/v1|Deployment", "deployments.apps"],
  ["autoscaling/v2|HorizontalPodAutoscaler", "horizontalpodautoscalers.autoscaling"],
  ["batch/v1|CronJob", "cronjobs.batch"],
  ["networking.istio.io/v1beta1|DestinationRule", "destinationrules.networking.istio.io"],
  ["networking.k8s.io/v1|Ingress", "ingresses.networking.k8s.io"],
  ["networking.k8s.io/v1|NetworkPolicy", "networkpolicies.networking.k8s.io"],
  ["policy/v1|PodDisruptionBudget", "poddisruptionbudgets.policy"],
  ["secrets-store.csi.x-k8s.io/v1|SecretProviderClass", "secretproviderclasses.secrets-store.csi.x-k8s.io"],
  ["security.istio.io/v1beta1|AuthorizationPolicy", "authorizationpolicies.security.istio.io"],
  ["security.istio.io/v1beta1|PeerAuthentication", "peerauthentications.security.istio.io"],
]);
const productionNamespace = "ynx-services";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runText(execFile, args, action) {
  try {
    return execFile("kubectl", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error(`${action} failed`);
  }
}

function parseJson(output, action) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${action} returned invalid JSON`);
  }
}

function documents(manifest) {
  if (typeof manifest !== "string" || manifest.trim() === "") {
    throw new Error("production RBAC manifest is required");
  }
  return manifest.split(/^---\s*$/m).filter((document) => document.trim());
}

function metadata(document, label) {
  const apiVersion = document.match(/^apiVersion:\s*([^\s]+)\s*$/m)?.[1];
  const kind = document.match(/^kind:\s*([A-Za-z0-9]+)\s*$/m)?.[1];
  const lines = document.split("\n");
  const metadataStart = lines.findIndex((line) => line === "metadata:");
  if (apiVersion === undefined || kind === undefined || metadataStart === -1) {
    throw new Error(`${label} resource is missing apiVersion, kind, or metadata`);
  }
  let name;
  let namespace = "";
  for (let index = metadataStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line !== "" && !line.startsWith(" ")) break;
    if (/^  name:\s*\S+\s*$/.test(line)) name = line.replace(/^  name:\s*/, "").trim();
    if (/^  namespace:\s*\S+\s*$/.test(line)) {
      namespace = line.replace(/^  namespace:\s*/, "").trim();
    }
  }
  if (name === undefined) throw new Error(`${label} resource is missing metadata.name`);
  const resource = kindResources.get(`${apiVersion}|${kind}`);
  if (resource === undefined) {
    throw new Error(`production RBAC does not allow manifest kind ${apiVersion}/${kind}`);
  }
  if (resource === "namespaces") {
    if (namespace !== "") throw new Error("Namespace resource cannot declare metadata.namespace");
  } else if (namespace === "") {
    throw new Error(`${apiVersion}/${kind}/${name} must declare metadata.namespace`);
  }
  return { apiVersion, kind, resource, name, namespace: namespace || null };
}

function checkKey(check) {
  return [
    check.effect,
    check.verb,
    check.resource,
    check.namespace ?? "",
  ].join("|");
}

function deduplicate(checks) {
  const values = new Map();
  for (const check of checks) values.set(checkKey(check), check);
  return [...values.values()].sort((left, right) => checkKey(left).localeCompare(checkKey(right)));
}

function required(verb, resource, namespace = null) {
  return { effect: "require", verb, resource, namespace };
}

function forbidden(verb, resource, namespace = null) {
  return { effect: "forbid", verb, resource, namespace };
}

export function buildProductionRbacPlan({ manifest, mode }) {
  if (!modes.has(mode)) throw new Error("production RBAC mode is invalid");
  const resources = documents(manifest).map((document, index) => metadata(document, `manifest[${index}]`));
  const identities = resources.map((item) => `${item.resource}/${item.namespace ?? ""}/${item.name}`);
  if (new Set(identities).size !== identities.length) {
    throw new Error("production RBAC manifest contains duplicate resource identities");
  }
  const checks = [];
  for (const item of resources) {
    const named = `${item.resource}/${item.name}`;
    checks.push(required("get", named, item.namespace));
    checks.push(required("patch", named, item.namespace));
    if (mode === "initial") checks.push(required("create", item.resource, item.namespace));
  }

  checks.push(
    required("get", "namespaces/kube-system"),
    required("get", `namespaces/${productionNamespace}`),
    required("get", "deployments.apps/quant-worker", productionNamespace),
    required("list", "deployments.apps", productionNamespace),
    required("watch", "deployments.apps", productionNamespace),
    required("list", "pods", productionNamespace),
    required("watch", "pods", productionNamespace),
    required("list", "networkpolicies.networking.k8s.io", productionNamespace),
    required("list", "peerauthentications.security.istio.io", productionNamespace),
    required("list", "cronjobs.batch", productionNamespace),
    required("list", "secretproviderclasses.secrets-store.csi.x-k8s.io", productionNamespace),
    required("get", "ingresses.networking.k8s.io/ynx-public-services", productionNamespace),
    required("get", "resourcequotas/services-quota", productionNamespace),
    required("get", "horizontalpodautoscalers.autoscaling/ai-gateway-hpa", productionNamespace),
    required("get", "configmaps/nginx-ingress-waf-config", "ingress-nginx"),
    required("get", "certificates.cert-manager.io/ynx-tls-cert", productionNamespace),
    required("get", "leases.coordination.k8s.io/ynx-production-release-lock", "default"),
    required("create", "leases.coordination.k8s.io", "default"),
    required("update", "leases.coordination.k8s.io/ynx-production-release-lock", "default"),
    required("create", "configmaps", "default"),
    forbidden("patch", "configmaps", "default"),
    forbidden("update", "configmaps", "default"),
    forbidden("delete", "configmaps", "default"),
  );
  if (mode === "blue-green") {
    checks.push(
      required("create", "deployments.apps", productionNamespace),
      required("get", "deployments.apps/quant-worker-green", productionNamespace),
      required("patch", "deployments.apps/quant-worker-green", productionNamespace),
      required("delete", "deployments.apps/quant-worker-green", productionNamespace),
    );
  } else {
    checks.push(required("get", "deployments.apps/quant-worker-green", productionNamespace));
  }

  for (const namespace of ["default", "ingress-nginx", "kube-system", productionNamespace]) {
    checks.push(
      forbidden("*", "*", namespace),
      forbidden("get", "secrets", namespace),
      forbidden("list", "secrets", namespace),
    );
  }
  checks.push(
    forbidden("*", "*", "ALL"),
    forbidden("get", "secrets/ynx-tls-cert", productionNamespace),
    forbidden("impersonate", "users"),
    forbidden("impersonate", "groups"),
    forbidden("impersonate", "serviceaccounts"),
    forbidden("create", "clusterrolebindings.rbac.authorization.k8s.io"),
    forbidden("create", "customresourcedefinitions.apiextensions.k8s.io"),
    forbidden("create", "persistentvolumes"),
    forbidden("delete", "namespaces"),
  );
  return {
    schemaVersion: 1,
    mode,
    resources,
    checks: deduplicate(checks),
  };
}

function canIArgs(context, check) {
  const args = ["--context", context, "auth", "can-i", check.verb, check.resource];
  if (check.namespace === "ALL") args.push("--all-namespaces");
  else if (check.namespace !== null) args.push("--namespace", check.namespace);
  return args;
}

export function verifyProductionOperatorRbac({
  context,
  manifest,
  mode,
  execFile = execFileSync,
}) {
  if (typeof context !== "string" || !/^[A-Za-z0-9._:@/-]{3,256}$/.test(context)) {
    throw new Error("production RBAC context must be a safe identifier");
  }
  if (typeof execFile !== "function") throw new Error("production RBAC execFile is required");
  const identity = parseJson(runText(
    execFile,
    ["--context", context, "auth", "whoami", "-o", "json"],
    "production operator identity inspection",
  ), "production operator identity inspection");
  const username = identity.status?.userInfo?.username;
  const groups = identity.status?.userInfo?.groups;
  if (
    typeof username !== "string"
    || username === ""
    || username === "system:anonymous"
    || !Array.isArray(groups)
    || groups.some((group) => (
      typeof group !== "string" || group === "" || group === "system:masters"
    ))
  ) {
    throw new Error("production operator identity is anonymous, malformed, or cluster-admin");
  }
  const plan = buildProductionRbacPlan({ manifest, mode });
  const failures = [];
  for (const check of plan.checks) {
    const answer = runText(
      execFile,
      canIArgs(context, check),
      `production RBAC ${check.effect} check`,
    );
    if (answer !== "yes" && answer !== "no") {
      throw new Error("production RBAC can-i returned an invalid decision");
    }
    if (
      (check.effect === "require" && answer !== "yes")
      || (check.effect === "forbid" && answer !== "no")
    ) {
      failures.push({
        effect: check.effect,
        verb: check.verb,
        resource: check.resource,
        namespace: check.namespace,
      });
    }
  }
  if (failures.length > 0) {
    throw new Error(`production operator RBAC boundary failed: ${failures.map((failure) => (
      `${failure.effect}:${failure.verb}:${failure.resource}:${failure.namespace ?? "cluster"}`
    )).join(",")}`);
  }
  const normalized = JSON.stringify(plan.checks);
  return {
    schemaVersion: 1,
    mode,
    source: "kubectl auth whoami and exact can-i decisions",
    operatorUsernameSha256: sha256(username),
    operatorGroupsSha256: sha256([...groups].sort().join("\n")),
    resourceCount: plan.resources.length,
    authorizationCheckCount: plan.checks.length,
    authorizationPlanSha256: sha256(normalized),
    requiredPassed: plan.checks.filter((check) => check.effect === "require").length,
    forbiddenPassed: plan.checks.filter((check) => check.effect === "forbid").length,
    pass: true,
  };
}
