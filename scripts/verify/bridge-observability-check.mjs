import fs from "node:fs";

const rules = fs.readFileSync("infra/monitoring/ynx-bridge-alerts.yml", "utf8");
const server = fs.readFileSync("internal/bridgegateway/server.go", "utf8");
const operations = fs.readFileSync("docs/bridge/OPERATIONS.md", "utf8");
const dashboardRaw = fs.readFileSync("infra/monitoring/grafana-bridge-dashboard.json", "utf8");
const dashboard = JSON.parse(dashboardRaw);

const requiredAlerts = [
  "YNXBridgeUnavailable",
  "YNXBridgeUnexpectedExternalSubmission",
  "YNXBridgePaused",
  "YNXBridgeRouteExposureHigh",
  "YNXBridgeReconciliationImbalance",
  "YNXBridgeReconciliationStale",
  "YNXBridgeRateLimitAbuse",
];
for (const alert of requiredAlerts) {
  if (!rules.includes(`alert: ${alert}`)) throw new Error(`missing bridge alert ${alert}`);
}
const referenced = [...new Set(rules.match(/ynx_bridge_[a-z_]+/g) ?? [])];
for (const metric of referenced) {
  if (!server.includes(metric)) throw new Error(`alert references unexported metric ${metric}`);
}
if (dashboard.uid !== "ynx-bridge-safety" || dashboard.panels?.length < 7) {
  throw new Error("bridge dashboard identity or required panel coverage is missing");
}
const dashboardMetrics = [...new Set(dashboardRaw.match(/ynx_bridge_[a-z_]+/g) ?? [])];
for (const metric of dashboardMetrics) {
  if (!server.includes(metric)) throw new Error(`dashboard references unexported metric ${metric}`);
}
for (const anchor of ["## Incident response", "## Pause and resume", "## Reconciliation"]) {
  if (!operations.includes(anchor)) throw new Error(`missing runbook section ${anchor}`);
}
if (/api[_ -]?key|recipient|sender|tx[_ -]?hash|evidence[_ -]?ref/i.test(rules)) {
  throw new Error("bridge alert rules contain a sensitive or high-cardinality identity");
}
console.log(`bridge observability check passed: ${requiredAlerts.length} alerts and ${dashboard.panels.length} dashboard panels reference exported metrics with bounded labels`);
