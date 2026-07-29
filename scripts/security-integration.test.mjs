import test from "node:test";
import assert from "node:assert/strict";
import { validateRenderedManifest } from "./security-integration.mjs";

function manifest({ image = "ynx/worker:0.1.0-candidate", suspend = true, host = null } = {}) {
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker
spec:
  template:
    spec:
      securityContext:
        runAsNonRoot: true
      containers:
      - name: worker
        image: ${image}
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop:
            - ALL
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: backup
spec:
  schedule: "0 1 * * *"
  suspend: ${suspend}
  jobTemplate:
    spec:
      template:
        spec:
          securityContext:
            runAsNonRoot: true
          containers:
          - name: backup
            image: ynx/backup:0.1.0-candidate
            securityContext:
              allowPrivilegeEscalation: false
              readOnlyRootFilesystem: true
              capabilities:
                drop:
                - ALL
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: strict
spec:
  mtls:
    mode: STRICT
${host ? `---\napiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: public\nspec:\n  rules:\n  - host: ${host}\n` : ""}`;
}

test("rendered deployment candidate passes hardened workload gates", () => {
  const result = validateRenderedManifest({ environment: "production", manifest: manifest() });
  assert.equal(result.pass, true);
  assert.deepEqual(result.failures, []);
});

test("mutable image tags and active backup schedules fail closed", () => {
  const result = validateRenderedManifest({
    environment: "production",
    manifest: manifest({ image: "ynx/worker:latest", suspend: false }),
  });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes("mutable latest")));
  assert.ok(result.failures.some((failure) => failure.includes("must remain suspended")));
});

test("staging candidates reject public production hosts", () => {
  const result = validateRenderedManifest({
    environment: "staging",
    manifest: manifest({ host: "api.ynxweb4.com" }),
  });
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes("staging: public production host is forbidden"));
});

test("each workload container must carry the hardening controls", () => {
  const weak = manifest().replace("          readOnlyRootFilesystem: true\n", "");
  const result = validateRenderedManifest({ environment: "production", manifest: weak });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes("read-only root filesystem")));
});
