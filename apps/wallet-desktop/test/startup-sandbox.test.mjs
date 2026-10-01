import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

// Execute the actual entrypoint through the first profile-dependent expression.
// A disabled sandbox must exit before this boundary, including an auto-injected
// launcher flag; the ordinary path must force sandboxing before reaching it.
const source = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
const prefix = source.slice(0, source.indexOf("function handleWalletIPC"))
  .replace(/^import .*;\n/gm, "")
  .replace("path.dirname(fileURLToPath(import.meta.url))", "selectProfileBoundary()");

test("actual startup refuses disabled sandbox before any Wallet setup", () => {
  const events = [], exited = new Error("native exit");
  assert.throws(() => runInNewContext(prefix, {
    app: { commandLine: { hasSwitch(name) { assert.equal(name, "no-sandbox"); return true; } },
      exit(code) { events.push(["exit", code]); throw exited; }, enableSandbox() { events.push(["enable"]); } },
    console: { error(message) { assert.match(message, /^YNX_WALLET_SANDBOX_REQUIRED:/); } },
    selectProfileBoundary() { events.push(["wallet-setup"]); }
  }), error => error === exited);
  assert.deepEqual(events, [["exit", 78]]);
});

test("a returning or failed exit cannot accidentally continue without sandbox", () => {
  let enabled = false, setup = false;
  assert.throws(() => runInNewContext(prefix, {
    app: { commandLine: { hasSwitch: () => true }, exit() {}, enableSandbox() { enabled = true; } },
    console: { error() {} }, selectProfileBoundary() { setup = true; }
  }), /YNX_WALLET_SANDBOX_REQUIRED/);
  assert.equal(enabled, false); assert.equal(setup, false);
});

test("normal startup forces sandbox before selecting a profile", () => {
  const events = [];
  runInNewContext(prefix, {
    app: { commandLine: { hasSwitch: () => false }, exit() { assert.fail("unexpected exit"); },
      enableSandbox() { events.push("sandbox"); } },
    selectProfileBoundary() { events.push("wallet-setup"); return "/synthetic"; }
  });
  assert.deepEqual(events, ["sandbox", "wallet-setup"]);
});

// Execute the existing profile selection without initializing Electron, opening
// a Wallet or touching a real profile. Session isolation must precede ready.
const profileStart=source.indexOf('const isolatedProfile = process.env.YNX_WALLET_PROFILE_PATH;');
const profileEnd=source.indexOf('// Canonical public RPC',profileStart);
assert.ok(profileStart>=0 && profileEnd>profileStart && profileEnd<source.indexOf('app.whenReady()'));
const profileSource=source.slice(profileStart,profileEnd);
function profileSetup(profile){
  const selected={userData:'/normal-profile',sessionData:'/normal-session'},calls=[];
  runInNewContext(profileSource,{process:{env:profile===undefined?{}:{YNX_WALLET_PROFILE_PATH:profile}},path:{isAbsolute:value=>value.startsWith('/')},app:{setPath(name,value){calls.push([name,value]);selected[name]=value;}}});
  return {selected,calls};
}
test('isolated QA profile selects both Wallet files and Electron Session before ready',()=>{
  const {selected,calls}=profileSetup('/synthetic/qa-wallet');
  assert.deepEqual(calls,[['userData','/synthetic/qa-wallet'],['sessionData','/synthetic/qa-wallet']]);
  assert.deepEqual(selected,{userData:'/synthetic/qa-wallet',sessionData:'/synthetic/qa-wallet'});
});
test('ordinary profile retains original Wallet and Session paths',()=>{
  for(const value of [undefined,'']){const {selected,calls}=profileSetup(value);assert.deepEqual(calls,[]);assert.deepEqual(selected,{userData:'/normal-profile',sessionData:'/normal-session'});}
});
test('relative QA profile fails before overriding either path',()=>{
  assert.throws(()=>profileSetup('relative-qa-wallet'),/must be an absolute path/);
});
