import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";

// This gate runs local/isolated tests only. It never loads deployment env files,
// runs remote-smoke, changes DNS, signs a real account, or contacts Alpaca.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const options = {};
for (let i=2;i<process.argv.length;i+=2) {
  const name = process.argv[i];
  if (!["--wallet-worktree", "--wallet-commit", "--output"].includes(name) || options[name] || !process.argv[i+1]) throw new Error("usage: weekly-v3-local-check.mjs [--wallet-worktree <path> --wallet-commit <full-sha>] [--output <new-file>]");
  options[name] = process.argv[i+1];
}
if (Boolean(options["--wallet-worktree"]) !== Boolean(options["--wallet-commit"])) throw new Error("Wallet worktree and exact commit must be provided together");
const checks = [];
const git = (cwd, ...args) => execFileSync("git", args, {cwd, encoding: "utf8"}).trim();
const snapshot = cwd => ({commit: git(cwd, "rev-parse", "HEAD"), dirty: git(cwd,"status","--porcelain=v1") !== ""});
const networkBefore = snapshot(root);
let walletRoot = null;
if (options["--wallet-worktree"]) {
  walletRoot = fs.realpathSync(options["--wallet-worktree"]);
  const commit = options["--wallet-commit"];
  if (!/^[0-9a-f]{40}$/.test(commit) || git(walletRoot,"rev-parse","HEAD") !== commit) throw new Error("Wallet checkpoint does not match exact HEAD");
  git(walletRoot,"diff","--exit-code",commit,"--","packages/wallet-auth","apps/wallet","apps/wallet-web/src","apps/wallet-web/test");
  if (git(walletRoot,"ls-files","--others","--exclude-standard","packages/wallet-auth","apps/wallet/src")) throw new Error("Wallet proof source has uncommitted additions");
}
function run(name, command, args, cwd=root) {
  const started = Date.now();
  try {
    const output = execFileSync(command,args,{cwd,encoding:"utf8",timeout:300000,maxBuffer:32*1024*1024,stdio:["ignore","pipe","pipe"]});
    checks.push({name,passed:true,elapsedMs:Date.now()-started,outputSha256:createHash("sha256").update(output).digest("hex"),tail:output.slice(-1800)});
  } catch(error) {
    checks.push({name,passed:false,exitCode:error.status ?? null,error:String(error.stderr ?? error.message).slice(-4000),stdout:String(error.stdout ?? "").slice(-4000)});
    throw error;
  }
}
let success = false;
try {
  run("generated endpoint configuration",process.execPath,["scripts/ops/generate-testnet-endpoints.mjs","--check"]);
  run("endpoint and transport adversarial fixtures",process.execPath,["--test","scripts/verify/testnet-endpoint-migration-check.test.mjs","sdk/js/testnet-endpoints.test.mjs"]);
  run("Faucet multiuser, shared aliases and durable recovery race tests","go",["test","-race","-count=1","./internal/faucet","./cmd/ynx-faucetd"]);
  run("SDK backward compatibility and clean release consumers","bash",["scripts/verify/sdk-check.sh"]);
  run("chain metadata and Mainnet rejection","make",["chainlist-candidate-check"]);
  for (const file of ["scripts/deploy/deploy-testnet.sh","scripts/verify/sdk-remote-check.sh","scripts/verify/remote-smoke-test.sh"]) run(`shell syntax: ${file}`,"bash",["-n",file]);
  if (walletRoot) {
    run("Wallet approval cryptography and callback transport",process.execPath,["--test","packages/wallet-auth/test/finance-order-approval.test.mjs","packages/wallet-auth/test/finance-order-approval-transport.test.mjs"],walletRoot);
    run("Wallet extension network and legacy provider regression",process.execPath,["--test","apps/wallet-web/test/extension-rpc.test.js","apps/wallet-web/test/provider.test.js","apps/wallet-web/test/extension-manifest.test.js","apps/wallet-web/test/service-worker-policy.test.js"],walletRoot);
    const app = path.join(walletRoot,"apps/wallet");
    run("Wallet approval lifecycle, authority time and Faucet recovery",path.join(app,"node_modules/.bin/tsx"),["--test","src/protocol/financeOrderApprovalController.test.ts","src/protocol/authorityTime.test.ts","src/state/faucetFlow.test.ts","src/chain/faucetAdmission.test.ts","src/chain/faucetNativeSession.test.ts","src/chain/faucetClaim.test.ts","src/chain/faucetReceipt.test.ts"],app);
    if (git(walletRoot,"rev-parse","HEAD") !== options["--wallet-commit"]) throw new Error("Wallet checkpoint changed during tests");
    git(walletRoot,"diff","--exit-code",options["--wallet-commit"],"--","packages/wallet-auth","apps/wallet","apps/wallet-web/src","apps/wallet-web/test");
  }
  success = true;
} catch { process.exitCode = 1; }
finally {
  const networkAfter = snapshot(root);
  if (networkAfter.commit !== networkBefore.commit) {success=false;process.exitCode=1;}
  const output = JSON.stringify({schema:"ynx-weekly-v3-local-check/v1",generatedAt:new Date().toISOString(),scope:"network-package-and-optional-wallet-local-regression-not-full-weekly-acceptance",network:networkAfter,walletCommit:options["--wallet-commit"]??null,
    contractTested:success,officialSandboxVerified:false,publicDeployed:false,publicVerified:false,productionApproved:false,crossProductE2EVerified:false,
    remaining:[...(!walletRoot ? ["WALLET_CHECKPOINT_LOCAL_REGRESSION"] : []),"FINANCE_FULL_CHECKPOINT_AND_CROSS_PRODUCT_E2E","PUBLIC_ALIAS_AUTHORITY_AND_RUNTIME_VERIFICATION","OFFICIAL_SANDBOX_CREDENTIALS_AND_EXPLICIT_TEST_PERMISSION"],checks},null,2)+"\n";
  if(options["--output"]) fs.writeFileSync(path.resolve(options["--output"]),output,{flag:"wx"});
  process.stdout.write(output);
}
