import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  buildProductionRbacPlan,
  verifyProductionOperatorRbac,
} from "./security-production-rbac.mjs";

const context = "ynx-production";
const manifest = `apiVersion: v1
kind: Namespace
metadata:
  name: ynx-services
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: quant-worker
  namespace: ynx-services
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: nginx-ingress-waf-config
  namespace: ingress-nginx
`;

function fixture({
  deniedRequired = null,
  allowedForbidden = null,
  username = "system:serviceaccount:release-operators:ynx-production-deployer",
  groups = ["system:serviceaccounts", "system:authenticated"],
} = {}) {
  const calls = [];
  const execFile = (command, args) => {
    calls.push({ command, args });
    if (command !== "kubectl") throw new Error("unexpected command");
    if (args.includes("whoami")) {
      return JSON.stringify({ status: { userInfo: { username, groups } } });
    }
    if (args.includes("can-i")) {
      const verb = args[args.indexOf("can-i") + 1];
      const resource = args[args.indexOf("can-i") + 2];
      const namespaceIndex = args.indexOf("--namespace");
      const namespace = args.includes("--all-namespaces")
        ? "ALL"
        : (namespaceIndex === -1 ? null : args[namespaceIndex + 1]);
      const key = `${verb}|${resource}|${namespace ?? ""}`;
      const forbidden = verb === "*"
        || resource === "*"
        || verb === "impersonate"
        || resource === "secrets"
        || resource.startsWith("secrets/")
        || resource === "clusterrolebindings.rbac.authorization.k8s.io"
        || resource === "customresourcedefinitions.apiextensions.k8s.io"
        || resource === "persistentvolumes"
        || (namespace === "default" && resource === "configmaps" && ["patch", "update", "delete"].includes(verb))
        || (verb === "delete" && resource === "namespaces");
      if (key === deniedRequired) return "no";
      if (key === allowedForbidden) return "yes";
      return forbidden ? "no" : "yes";
    }
    throw new Error(`unexpected args ${args.join(" ")}`);
  };
  return { calls, execFile };
}

test("initial plan derives named manifest permissions and a bounded Lease permission", () => {
  const plan = buildProductionRbacPlan({ manifest, mode: "initial" });
  assert.ok(plan.checks.some((check) => (
    check.effect === "require"
    && check.verb === "create"
    && check.resource === "deployments.apps"
    && check.namespace === "ynx-services"
  )));
  assert.ok(plan.checks.some((check) => (
    check.effect === "require"
    && check.verb === "patch"
    && check.resource === "configmaps/nginx-ingress-waf-config"
    && check.namespace === "ingress-nginx"
  )));
  assert.ok(plan.checks.some((check) => (
    check.effect === "require"
    && check.verb === "update"
    && check.resource === "leases.coordination.k8s.io/ynx-production-release-lock"
    && check.namespace === "default"
  )));
  assert.ok(plan.checks.some((check) => (
    check.effect === "require"
    && check.verb === "create"
    && check.resource === "configmaps"
    && check.namespace === "default"
  )));
  assert.ok(plan.checks.some((check) => (
    check.effect === "forbid"
    && check.verb === "delete"
    && check.resource === "configmaps"
    && check.namespace === "default"
  )));
});

test("the complete production Kustomize inventory maps to explicit RBAC resources", () => {
  const rendered = execFileSync("kubectl", ["kustomize", "infra/k8s/overlays/production"], {
    encoding: "utf8",
  });
  const secretProvider = `---
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: ynx-production-secrets
  namespace: ynx-services
`;
  const plan = buildProductionRbacPlan({
    manifest: `${rendered.trim()}\n${secretProvider}`,
    mode: "initial",
  });
  assert.ok(plan.resources.length >= 20);
  assert.ok(plan.resources.some((item) => (
    item.resource === "secretproviderclasses.secrets-store.csi.x-k8s.io"
  )));
  assert.equal(plan.resources.some((item) => item.resource === "secrets"), false);
});

test("blue-green plan adds green create and delete without broad Secret access", () => {
  const plan = buildProductionRbacPlan({ manifest, mode: "blue-green" });
  assert.ok(plan.checks.some((check) => (
    check.effect === "require"
    && check.verb === "delete"
    && check.resource === "deployments.apps/quant-worker-green"
  )));
  assert.equal(plan.checks.some((check) => (
    check.effect === "require" && check.resource === "secrets"
  )), false);
  assert.ok(plan.checks.some((check) => (
    check.effect === "forbid"
    && check.verb === "get"
    && check.resource === "secrets/ynx-tls-cert"
  )));
});

test("RBAC verifier accepts exact permissions and hashes operator identity", () => {
  const cluster = fixture();
  const result = verifyProductionOperatorRbac({
    context,
    manifest,
    mode: "rollback",
    execFile: cluster.execFile,
  });
  assert.equal(result.pass, true);
  assert.equal(result.mode, "rollback");
  assert.ok(result.requiredPassed > 0);
  assert.ok(result.forbiddenPassed > 0);
  assert.match(result.operatorUsernameSha256, /^[0-9a-f]{64}$/);
  assert.equal(cluster.calls.filter((call) => call.args.includes("whoami")).length, 1);
});

test("missing a required named permission fails closed", () => {
  const cluster = fixture({
    deniedRequired: "patch|deployments.apps/quant-worker|ynx-services",
  });
  assert.throws(
    () => verifyProductionOperatorRbac({
      context,
      manifest,
      mode: "initial",
      execFile: cluster.execFile,
    }),
    /require:patch:deployments\.apps\/quant-worker:ynx-services/,
  );
});

test("wildcard, Secret, and cluster-wide dangerous permissions fail closed", () => {
  for (const allowedForbidden of [
    "*|*|ynx-services",
    "get|secrets|ynx-services",
    "impersonate|users|",
    "create|clusterrolebindings.rbac.authorization.k8s.io|",
  ]) {
    const cluster = fixture({ allowedForbidden });
    assert.throws(
      () => verifyProductionOperatorRbac({
        context,
        manifest,
        mode: "blue-green",
        execFile: cluster.execFile,
      }),
      /forbid:/,
    );
  }
});

test("anonymous and system:masters identities are rejected before can-i checks", () => {
  for (const identity of [
    { username: "system:anonymous", groups: ["system:unauthenticated"] },
    { username: "admin", groups: ["system:masters", "system:authenticated"] },
  ]) {
    const cluster = fixture(identity);
    assert.throws(
      () => verifyProductionOperatorRbac({
        context,
        manifest,
        mode: "initial",
        execFile: cluster.execFile,
      }),
      /anonymous, malformed, or cluster-admin/,
    );
    assert.equal(cluster.calls.filter((call) => call.args.includes("can-i")).length, 0);
  }
});

test("unknown manifest kinds and duplicate identities are rejected", () => {
  assert.throws(
    () => buildProductionRbacPlan({
      manifest: `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: forbidden
`,
      mode: "initial",
    }),
    /does not allow manifest kind/,
  );
  assert.throws(
    () => buildProductionRbacPlan({
      manifest: `${manifest}---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: quant-worker
  namespace: ynx-services
`,
      mode: "rollback",
    }),
    /duplicate resource identities/,
  );
});
