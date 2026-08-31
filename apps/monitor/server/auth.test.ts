// @vitest-environment node
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createApp } from "./app.js";
import { hashPassword } from "./auth.js";
import { OpsStore } from "./store.js";
const expect = (actual: unknown) => ({
  toBe: (expected: unknown) => assert.equal(actual, expected),
});
const operatorOrigin = "https://monitor.test";
const users = [
  {
    username: "view",
    role: "viewer" as const,
    passwordHash: hashPassword("view-pass"),
  },
  {
    username: "op",
    role: "operator" as const,
    passwordHash: hashPassword("op-pass"),
  },
];
const servers: Server[] = [];
after(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});
async function fixture(extra: Record<string, unknown> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "ynx-monitor-"));
  const store = new OpsStore(join(dir, "state.json"));
  await store.load();
  await store.observeFailure(
    "node",
    "connection refused",
    "http://127.0.0.1:1/status",
  );
  const app = await createApp({
    store,
    secret: "test-session-secret-with-32-bytes",
    users,
    allowedOrigins: [operatorOrigin],
    rpcUrl: "http://127.0.0.1:1",
    explorerUrl: "http://127.0.0.1:1",
    indexerUrl: "http://127.0.0.1:1",
    aiUrl: "http://127.0.0.1:1",
    ...extra,
  });
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("test server did not bind");
  return { base: `http://127.0.0.1:${address.port}`, store };
}
async function call(base: string, path: string, init: RequestInit = {}) {
  const response = await fetch(base + path, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  return { status: response.status, body: (await response.json()) as any };
}
async function token(base: string, username: string, password: string) {
  const response = await call(base, "/ops/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  expect(response.status).toBe(200);
  return response.body as { token: string; csrfToken: string };
}
function sessionHeaders(session: { token: string; csrfToken: string }) {
  return {
    Authorization: `Bearer ${session.token}`,
    Origin: operatorOrigin,
    "X-YNX-CSRF-Token": session.csrfToken,
  };
}
describe("Monitor authorization and approval boundaries", () => {
  it("rejects missing and invalid authentication", async () => {
    const { base } = await fixture();
    expect((await call(base, "/ops/me")).status).toBe(401);
    expect(
      (
        await call(base, "/ops/login", {
          method: "POST",
          body: JSON.stringify({ username: "op", password: "wrong" }),
        })
      ).status,
    ).toBe(401);
  });
  it("rejects missing, untrusted, and invalid mutation protection", async () => {
    const { base } = await fixture();
    const op = await token(base, "op", "op-pass");
    const path = "/ops/rollback-proposals";
    const body = JSON.stringify({
      release: "release-a",
      reason: "origin test",
      approvalPhrase: "APPROVE ROLLBACK PROPOSAL",
    });
    const authorization = { Authorization: `Bearer ${op.token}` };

    const missingOrigin = await call(base, path, {
      method: "POST",
      headers: { ...authorization, "X-YNX-CSRF-Token": op.csrfToken },
      body,
    });
    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.body.error).toBe("origin_required");

    const untrustedOrigin = await call(base, path, {
      method: "POST",
      headers: { ...authorization, Origin: "https://attacker.test", "X-YNX-CSRF-Token": op.csrfToken },
      body,
    });
    expect(untrustedOrigin.status).toBe(403);
    expect(untrustedOrigin.body.error).toBe("origin_not_allowed");

    const missingCsrf = await call(base, path, {
      method: "POST",
      headers: { ...authorization, Origin: operatorOrigin },
      body,
    });
    expect(missingCsrf.status).toBe(403);
    expect(missingCsrf.body.error).toBe("csrf_token_required");

    const invalidCsrf = await call(base, path, {
      method: "POST",
      headers: { ...authorization, Origin: operatorOrigin, "X-YNX-CSRF-Token": "invalid" },
      body,
    });
    expect(invalidCsrf.status).toBe(403);
    expect(invalidCsrf.body.error).toBe("csrf_token_invalid");
  });
  it("allows viewers to inspect and read bounded logs but forbids acknowledgement", async () => {
    const { base } = await fixture();
    const viewer = await token(base, "view", "view-pass");
    const headers = sessionHeaders(viewer);
    expect((await call(base, "/ops/audit", { headers })).status).toBe(200);
    const logs = await call(base, "/ops/logs", { headers });
    expect(logs.status).toBe(200);
    expect(logs.body.status).toBe("not_configured");
    expect(
      (
        await call(base, "/ops/alerts/upstream%3Anode/acknowledge", {
          method: "POST",
          headers,
          body: JSON.stringify({ approvalPhrase: "ACKNOWLEDGE" }),
        })
      ).status,
    ).toBe(403);
  });
	it("projects required network services and StreamBFT candidate truth without internal endpoints",async()=>{
	  const {base}=await fixture();
	  const viewer=await token(base,"view","view-pass");
	  const overview=await call(base,"/ops/overview",{headers:sessionHeaders(viewer)});
	  expect(overview.status).toBe(200);
	  for(const id of ["node","validators","peers","peer-sync","explorer","indexer","faucet","gateway"])assert(overview.body.probes.some((probe:{id:string})=>probe.id===id),`missing ${id} probe`);
	  const text=JSON.stringify(overview.body);
	  for(const secret of ["127.0.0.1","connection refused","/private/","/etc/"])assert.equal(text.includes(secret),false,`overview leaked ${secret}`);
	  assert.equal(overview.body.network.expectedValidatorCount,4);
	  assert.equal(overview.body.network.consensus.streamBFT.status,"shadow/candidate");
	  assert.equal(overview.body.network.consensus.streamBFT.active,false);
	  assert.equal(overview.body.alerts.every((alert:{evidenceUrl:string})=>alert.evidenceUrl==="/ops/overview"),true);
	});
	it("projects only dependency status when an upstream includes transport metadata",async()=>{
	  const rpcServer=createServer((_request,response)=>response.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify({ok:true,status:"available",height:10,dependencies:{chainRpc:{status:"operational",upstreamUrl:"http://127.0.0.1:6420/status",configPath:"/etc/ynx/private.env",authorization:"Bearer should-not-leak"}}})));
	  rpcServer.listen(0,"127.0.0.1");servers.push(rpcServer);await new Promise<void>(resolve=>rpcServer.once("listening",resolve));
	  const address=rpcServer.address();if(!address||typeof address==="string")throw new Error("probe fixture did not bind");
	  const {base}=await fixture({rpcUrl:`http://127.0.0.1:${address.port}`});
	  const viewer=await token(base,"view","view-pass");const overview=await call(base,"/ops/overview",{headers:sessionHeaders(viewer)});
	  const text=JSON.stringify(overview.body);for(const secret of ["127.0.0.1","/etc/ynx","Bearer should-not-leak"])assert.equal(text.includes(secret),false,`overview leaked ${secret}`);
	  const node=overview.body.probes.find((probe:{id:string})=>probe.id==="node");assert.deepEqual(node.data.dependencies,{chainRpc:{status:"operational"}});
	});
	it("redacts internal-looking operation record fields from the browser overview",async()=>{
	  const {base}=await fixture();const op=await token(base,"op","op-pass");const headers=sessionHeaders(op);
	  const backup=await call(base,"/ops/backups",{method:"POST",headers,body:JSON.stringify({kind:"configuration",service:"monitor",artifactRef:"/private/ynx/backup.tar",digest:"a".repeat(64),sizeBytes:1,createdAt:"2026-08-31T00:00:00.000Z",retentionClass:"test",retentionUntil:"2026-09-01T00:00:00.000Z",storageLocation:"s3://token:Bearer should-not-leak@backup.example/private",encryption:"encrypted",rpoTargetSeconds:1,rtoTargetSeconds:1,evidence:["/etc/ynx/secret.env"]})});
	  assert.equal(backup.status,201);const overview=await call(base,"/ops/overview",{headers});const text=JSON.stringify(overview.body);
	  for(const secret of ["/private/ynx","Bearer should-not-leak","/etc/ynx"])assert.equal(text.includes(secret),false,`overview leaked ${secret}`);
	  assert.equal(overview.body.backupRecords[0].artifactRef,"redacted-internal-evidence");
	});
	it("reports finality unavailable unless both canonical and indexer probes are healthy",async()=>{
	  const rpcServer=createServer((_request,response)=>response.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify({height:10})));
	  let indexerHealthy=false;
	  const indexerServer=createServer((request,response)=>{
		const body=request.url?.startsWith("/health")?{ok:indexerHealthy,lastIndexedHeight:9}:{blocks:[]};
		response.writeHead(request.url?.startsWith("/health")&&!indexerHealthy?503:200,{"content-type":"application/json"}).end(JSON.stringify(body));
	  });
	  for(const server of [rpcServer,indexerServer]){
		server.listen(0,"127.0.0.1");servers.push(server);await new Promise<void>((resolve)=>server.once("listening",resolve));
	  }
	  const rpcAddress=rpcServer.address(),indexerAddress=indexerServer.address();
	  if(!rpcAddress||typeof rpcAddress==="string"||!indexerAddress||typeof indexerAddress==="string")throw new Error("probe fixture did not bind");
	  const {base}=await fixture({rpcUrl:`http://127.0.0.1:${rpcAddress.port}`,indexerUrl:`http://127.0.0.1:${indexerAddress.port}`});
	  const viewer=await token(base,"view","view-pass"),headers=sessionHeaders(viewer);
	  const unavailable=await call(base,"/ops/overview",{headers});
	  assert.equal(unavailable.body.network.finality.status,"unavailable");
	  assert.equal(unavailable.body.network.finality.height,null);
	  indexerHealthy=true;
	  const healthy=await call(base,"/ops/overview",{headers});
	  assert.equal(healthy.body.network.finality.status,"canonical-indexed");
	  assert.equal(healthy.body.network.finality.height,9);
	});
  it("requires exact operator approval and writes audit", async () => {
    const { base } = await fixture();
    const op = await token(base, "op", "op-pass");
    const headers = sessionHeaders(op);
    expect(
      (
        await call(base, "/ops/alerts/upstream%3Anode/acknowledge", {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
    ).toBe(409);
    const ack = await call(base, "/ops/alerts/upstream%3Anode/acknowledge", {
      method: "POST",
      headers,
      body: JSON.stringify({ approvalPhrase: "ACKNOWLEDGE" }),
    });
    expect(ack.status).toBe(200);
    expect(ack.body.acknowledgedBy).toBe("op");
    const audit = await call(base, "/ops/audit", { headers });
    expect(
      audit.body.audit.some(
        (x: { action: string }) => x.action === "alert.acknowledge",
      ),
    ).toBe(true);
  });
  it("records rollback approval without executing infrastructure", async () => {
    const { base } = await fixture();
    const op = await token(base, "op", "op-pass");
    const response = await call(base, "/ops/rollback-proposals", {
      method: "POST",
      headers: sessionHeaders(op),
      body: JSON.stringify({
        release: "release-a",
        reason: "failed probe",
        approvalPhrase: "APPROVE ROLLBACK PROPOSAL",
      }),
    });
    expect(response.status).toBe(201);
    expect(response.body.status).toBe("approved-not-executed");
    expect(response.body.executionBoundary).toBe(
      "central infrastructure owner",
    );
  });
  it("accepts a centrally verified wallet once and rejects replay", async () => {
    const { base } = await fixture({
      walletOrigin: "https://monitor.example",
      walletRoles: { ynx1viewer: "viewer" },
      walletVerifier: async (input: { origin: string; chainId: number }) => {
        assert.equal(input.origin, "https://monitor.example");
        assert.equal(input.chainId, 6423);
        return { account: "ynx1viewer" };
      },
    });
    const issued = await call(base, "/ops/wallet/challenges", {
      method: "POST",
      body: "{}",
    });
    expect(issued.status).toBe(201);
    const signed = {
      challengeId: issued.body.challengeId,
      nonce: issued.body.nonce,
      signature: "verified-by-central-gateway",
      signedPayload: JSON.stringify(issued.body),
    };
    const session = await call(base, "/ops/wallet/sessions", {
      method: "POST",
      body: JSON.stringify(signed),
    });
    expect(session.status).toBe(200);
    expect(session.body.principal.role).toBe("viewer");
    const replay = await call(base, "/ops/wallet/sessions", {
      method: "POST",
      body: JSON.stringify(signed),
    });
    expect(replay.status).toBe(409);
  });
});
