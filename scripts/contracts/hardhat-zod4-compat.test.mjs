import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  conditionalUnionType,
  configurationVariableSchema,
  incompatibleFieldType,
  resolvedConfigurationVariableSchema,
  unionType,
  validateUserConfigZodType,
} from "@nomicfoundation/hardhat-zod-utils";
import { applyHardhatZod4Compat } from "./apply-hardhat-zod4-compat.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const installed = (name) => path.join(root, "node_modules", name, "package.json");
const metadata = (name) => JSON.parse(fs.readFileSync(installed(name), "utf8"));
const hash = (value) => createHash("sha256").update(value).digest("hex");

// Verbatim official @nomicfoundation/hardhat-zod-utils 3.0.5 dist/src/index.js,
// supplied in the integrity-checked npm tarball. Compression is DATA only; this
// independent original is never synthesized by reversing the adapter edits.
const originalUtils = () => {
  const raw = inflateSync(Buffer.from("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", "base64"));
  assert.equal(raw.length, 6172);
  assert.equal(hash(raw), "8e10e6327da319ea5491bad7fe686fa0653cfc6db270457743eaca800a84c04e");
  return raw;
};

// Child fixtures inherit no deployment credentials or public RPC selection.
// Hardhat's actual root config is still loaded, with only an explicit simulated
// connection selected. No HTTP server or compiler is started by these tests.
function childEnvironment() {
  const env = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR", "LOCALAPPDATA", "APPDATA", "XDG_CACHE_HOME"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, CI: "true", DO_NOT_TRACK: "1", HARDHAT_DISABLE_TELEMETRY_PROMPT: "true", YNX_HARDHAT_COMPAT_ROOT: root };
}

function runNode(args, timeout = 60000) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: childEnvironment(),
    encoding: "utf8",
    timeout,
    killSignal: "SIGKILL",
    maxBuffer: 2 << 20,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, "isolated compatibility child did not finish normally");
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

test("the actual Hardhat consumers resolve the fixed Zod 4 package", () => {
  for (const [name, version] of Object.entries({
    hardhat: "3.11.1",
    "@nomicfoundation/hardhat-ethers": "4.0.15",
    "@nomicfoundation/hardhat-zod-utils": "3.0.5",
    zod: "4.6.7",
    typescript: "5.9.3",
  })) {
    assert.equal(metadata(name).version, version, `${name} installed version differs`);
  }
  const zodPackage = fs.realpathSync(installed("zod"));
  for (const name of ["hardhat", "@nomicfoundation/hardhat-ethers", "@nomicfoundation/hardhat-zod-utils"]) {
    assert.equal(fs.realpathSync(createRequire(installed(name)).resolve("zod/package.json")), zodPackage);
  }
});

test("the real adapter is idempotent and refuses dirty, unknown, linked and mixed installations", () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ynx-hardhat-zod4-boundary-")));
  try {
    for (const name of ["package.json", "package-lock.json"]) {
      fs.copyFileSync(path.join(root, name), path.join(directory, name), fs.constants.COPYFILE_EXCL);
    }
    for (const name of ["hardhat", "@nomicfoundation/hardhat-ethers", "@nomicfoundation/hardhat-zod-utils", "zod"]) {
      const destination = path.join(directory, "node_modules", name);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.cpSync(path.dirname(installed(name)), destination, { recursive: true, errorOnExist: true, force: false });
    }
    const snapshot = () => {
      const rows = [];
      function walk(parent) {
        for (const name of fs.readdirSync(parent).sort()) {
          const filename = path.join(parent, name), s = fs.lstatSync(filename, { bigint: true });
          rows.push([path.relative(directory, filename), s.dev.toString(), s.ino.toString(), s.mode.toString(), s.nlink.toString(), s.size.toString(), s.mtimeNs.toString(), s.ctimeNs.toString(), s.isFile() ? hash(fs.readFileSync(filename)) : s.isSymbolicLink() ? fs.readlinkSync(filename) : "directory"]);
          if (s.isDirectory()) walk(filename);
        }
      }
      walk(directory);
      return rows;
    };
    const before = snapshot();
    const result = applyHardhatZod4Compat(directory);
    assert.equal(result.status, "already-applied");
    assert.equal(result.classification, "compatibility-patch");
    assert.deepEqual(snapshot(), before, "idempotent validation changed installed bytes or file identities");
    const reject = (change, restore, pattern) => {
      try {
        change();
        const changed = snapshot();
        assert.throws(() => applyHardhatZod4Compat(directory), pattern);
        assert.deepEqual(snapshot(), changed, "refusal rewrote another dependency or partially repaired the fixture");
      } finally {
        restore();
      }
    };
    const runtime = path.join(directory, "node_modules/@nomicfoundation/hardhat-zod-utils/dist/src/index.js");
    const runtimeOriginal = fs.readFileSync(runtime);
    reject(() => fs.appendFileSync(runtime, "\n// unexpected local change\n"), () => fs.writeFileSync(runtime, runtimeOriginal), /unknown or modified dependency patch/);
    // This known original is genuine upstream DATA, not a reverse application
    // of replacement strings. The other two files stay actually patched.
    reject(() => fs.writeFileSync(runtime, originalUtils()), () => fs.writeFileSync(runtime, runtimeOriginal), /partial dependency patch group/);
    const packageFile = path.join(directory, "node_modules/hardhat/package.json");
    const packageOriginal = fs.readFileSync(packageFile);
    reject(() => fs.writeFileSync(packageFile, JSON.stringify({ ...JSON.parse(packageOriginal), version: "3.11.1-unknown" })), () => fs.writeFileSync(packageFile, packageOriginal), /fixed package identity mismatch/);
    const zod = path.join(directory, "node_modules/zod"), saved = path.join(directory, "saved-zod");
    reject(() => { fs.renameSync(zod, saved); fs.symlinkSync(saved, zod, process.platform === "win32" ? "junction" : "dir"); }, () => { if (fs.existsSync(zod) && fs.lstatSync(zod).isSymbolicLink()) fs.unlinkSync(zod); if (fs.existsSync(saved)) fs.renameSync(saved, zod); }, /unsafe dependency path/);
    const retained = path.join(path.dirname(runtime), ".ynx-zod4-compat-test-retained");
    reject(() => fs.writeFileSync(retained, "partial", { flag: "wx", mode: 0o600 }), () => fs.rmSync(retained, { force: true }), /partial dependency patch retained/);
    const restored = snapshot();
    assert.equal(applyHardhatZod4Compat(directory).status, "already-applied");
    assert.deepEqual(snapshot(), restored);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("real exported schemas preserve strict failures and callable resolved variables", () => {
  const choice = unionType([z.string(), z.number()], "string or number required");
  assert.equal(choice.safeParse("ok").success, true);
  assert.equal(choice.safeParse(false).success, false);
  const conditional = conditionalUnionType([
    [(value) => typeof value === "string", z.string().min(1)],
    [(value) => value !== null && typeof value === "object", z.strictObject({ enabled: z.boolean() })],
  ], "known configuration shape required");
  assert.equal(conditional.safeParse({ enabled: true }).success, true);
  const unknown = conditional.safeParse({ enabled: true, unexpected: true });
  assert.equal(unknown.success, false, "a strict upstream schema accepted an unknown field");
  assert.equal(unknown.error.issues.some((issue) => issue.code === "unrecognized_keys"), true);
  assert.equal(conditional.safeParse(null).success, false);

  const incompatible = z.object({ forbidden: incompatibleFieldType("field is incompatible") });
  assert.deepEqual(validateUserConfigZodType({}, incompatible), []);
  assert.deepEqual(validateUserConfigZodType({ forbidden: true }, incompatible), [
    { path: ["forbidden"], message: "field is incompatible" },
  ]);
  assert.equal(configurationVariableSchema.safeParse({ _type: "ConfigurationVariable", name: "COMPAT_ONLY" }).success, true);
  assert.equal(configurationVariableSchema.safeParse({ _type: "ConfigurationVariable", name: 17 }).success, false);

  const getters = { _type: "ResolvedConfigurationVariable", get: () => "raw", getUrl: () => "https://example.invalid", getBigInt: () => 17n, getHexString: () => "0x01" };
  const parsed = resolvedConfigurationVariableSchema.parse(getters);
  assert.equal(parsed.get(), "raw");
  assert.equal(parsed.getBigInt(), 17n);
  for (const field of ["get", "getUrl", "getBigInt", "getHexString"]) {
    for (const value of [undefined, null, false, 17, "not-a-function", {}]) {
      assert.equal(resolvedConfigurationVariableSchema.safeParse({ ...getters, [field]: value }).success, false, `${field} accepted a non-function`);
    }
  }
});

test("bounded oversized collections reject before any element work", () => {
  const maximum = 8;
  for (const kind of ["array", "set", "map"]) {
    let visits = 0;
    const element = z.string().superRefine(() => { visits++; });
    const collection = kind === "array" ? z.array(element).max(maximum)
      : kind === "set" ? z.set(element).max(maximum)
        : z.map(element, element).max(maximum);
    const values = (count) => Array.from({ length: count }, (_, i) => `v${i}`);
    const input = (count) => kind === "array" ? values(count)
      : kind === "set" ? new Set(values(count))
        : new Map(values(count).map((value) => [value, value]));
    const schema = z.object({ collection });
    assert.deepEqual(validateUserConfigZodType({ collection: input(maximum) }, schema), []);
    assert.equal(visits, maximum * (kind === "map" ? 2 : 1), `${kind} boundary skipped element validation`);
    visits = 0;
    const errors = validateUserConfigZodType({ collection: input(maximum + 1) }, schema);
    assert.equal(errors.length, 1, `${kind} oversized input was not rejected`);
    assert.deepEqual(errors[0].path, ["collection"]);
    assert.equal(typeof errors[0].message, "string");
    assert.equal(visits, 0, `${kind} did element work before rejecting its size`);
  }
});

const hardhatRuntimeCheck = String.raw`
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { HardhatError } from "@nomicfoundation/hardhat-errors";
import { createHardhatRuntimeEnvironment, importUserConfig } from "hardhat/hre";

const root = process.env.YNX_HARDHAT_COMPAT_ROOT;
const configPath = path.join(root, "hardhat.config.ts");
const original = await importUserConfig(configPath);
const memory = { type: "edr-simulated", chainType: "l1", chainId: 31337 };
const config = { ...original, networks: { ...original.networks, compatMemory: memory } };
const hre = await createHardhatRuntimeEnvironment(config, { config: configPath }, root);
assert.equal(hre.versions.hardhat, "3.11.1");
assert.equal(hre.config.paths.artifacts, path.join(root, "artifacts", "hardhat"));
assert.equal(hre.config.networks.ynxTestnet.type, "http");
assert.equal(hre.config.networks.ynxTestnet.chainId, 6423);
const require = createRequire(import.meta.url);
const hardhatRoot = path.dirname(require.resolve("hardhat/package.json"));
const { validateUserConfig } = await import(pathToFileURL(path.join(hardhatRoot, "dist/src/internal/core/config-validation.js")));
assert.deepEqual(await validateUserConfig(hre.hooks, config), []);
const knownHistory = { "31337": { name: "compat", chainType: "l1", hardforkHistory: { london: { blockNumber: 0 } } } };
const knownConfig = { ...config, chainDescriptors: knownHistory, networks: { ...config.networks, ynxTestnet: { ...config.networks.ynxTestnet, httpHeaders: { "x-ynx-compat": "public-test" } } } };
assert.deepEqual(await validateUserConfig(hre.hooks, knownConfig), []);
await createHardhatRuntimeEnvironment(knownConfig, { config: configPath }, root);

const negative = [
  ["plugin boolean", { ...config, networks: { ...config.networks, compatMemory: { ...memory, ethers: { waitForTransactionReceipt: "invalid" } } } }, "ethers"],
  ["network type", { ...config, networks: { ...config.networks, compatMemory: { type: "unknown-network-type" } } }, "networks"],
  ["account key", { ...config, networks: { ...config.networks, compatMemory: { ...memory, accounts: [{ privateKey: 17, balance: "1" }] } } }, "networks"],
  ["strict unknown field", { ...config, chainDescriptors: { "31337": { name: "compat", chainType: "l1", hardforkHistory: { london: { blockNumber: 0, unexpected: true } } } } }, "chainDescriptors"],
];
for (const [name, bad, firstPath] of negative) {
  const failures = await validateUserConfig(hre.hooks, bad);
  assert.ok(failures.length > 0, name + " accepted invalid config");
  assert.ok(failures.some((failure) => failure.path[0] === firstPath), name + " lost its config path");
  for (const failure of failures) {
    assert.ok(Array.isArray(failure.path));
    assert.ok(failure.path.every((part) => typeof part === "string" || typeof part === "number"));
    assert.equal(typeof failure.message, "string");
    assert.ok(failure.message.length > 0);
  }
  await assert.rejects(createHardhatRuntimeEnvironment(bad, { config: configPath }, root), (error) => {
    assert.equal(error instanceof TypeError, false, name + " crashed instead of reporting config validation");
    assert.equal(HardhatError.isHardhatError(error, HardhatError.ERRORS.CORE.GENERAL.INVALID_CONFIG), true);
    assert.match(error.message, /Config error in config\./);
    return true;
  });
}

const connections = [];
try {
  for (const method of ["create", "connect"]) {
    const connection = await hre.network[method]({ network: "compatMemory", chainType: "l1" });
    connections.push(connection);
    assert.equal(connection.networkName, "compatMemory");
    assert.equal(connection.networkConfig.type, "edr-simulated");
    assert.equal(connection.networkConfig.forking?.enabled ?? false, false);
    assert.equal(await connection.provider.request({ method: "eth_chainId" }), "0x7a69");
    const { ethers } = connection;
    const [signer] = await ethers.getSigners();
    assert.ok(signer);
    assert.equal((await ethers.provider.getNetwork()).chainId, 31337n);
    assert.ok(await ethers.provider.getBalance(await signer.getAddress()) > 0n);
    const artifact = await hre.artifacts.readArtifact("SampleEVMWriteCounter");
    assert.ok(artifact.bytecode.length > 100, "normal prior build artifact missing");
    const factory = await ethers.getContractFactory("SampleEVMWriteCounter", signer);
    const counter = await factory.deploy(4n);
    await counter.waitForDeployment();
    assert.equal(await counter.count(), 4n);
    await (await counter.increment(3n)).wait();
    assert.equal(await counter.count(), 7n);
  }
  assert.notEqual(connections[0].id, connections[1].id);
} finally {
  for (const connection of connections.reverse()) await connection.close();
}
console.log("YNX_HARDHAT_ZOD4_RUNTIME " + JSON.stringify({hardhat:"3.11.1",negativeConfigs:negative.length,connections:["create","connect"],ethersCounter:7,scope:"ephemeral EDR in-process only; no HTTP provider, server or public transaction"}));
`;

test("actual root Hardhat config rejects invalid inputs and create/connect use ethers in memory", { timeout: 65000 }, () => {
  const stdout = runNode(["--input-type=module", "--eval", hardhatRuntimeCheck]);
  const line = stdout.split("\n").filter((value) => value.startsWith("YNX_HARDHAT_ZOD4_RUNTIME "));
  assert.equal(line.length, 1, "actual runtime smoke did not complete");
  const result = JSON.parse(line[0].slice("YNX_HARDHAT_ZOD4_RUNTIME ".length));
  assert.equal(result.negativeConfigs, 4);
  assert.deepEqual(result.connections, ["create", "connect"]);
  assert.equal(result.ethersCounter, 7);
});

test("actual root config and exported Zod 4 schema declarations type-check with no emit", { timeout: 65000 }, () => {
  // Stay under this npm root for ordinary NodeNext resolution. The exclusive
  // temporary directory is the only test-owned write target; build artifacts
  // and the original root config are read in place and never copied/rewritten.
  const directory = fs.mkdtempSync(path.join(root, ".hardhat-zod4-types-"));
  try {
    const consumer = path.join(directory, "consumer.mts");
    fs.writeFileSync(consumer, String.raw`
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import { configVariable, defineConfig, type HardhatUserConfig } from "hardhat/config";
import { createHardhatRuntimeEnvironment } from "hardhat/hre";
import { z } from "zod";
import { configurationVariableSchema, resolvedConfigurationVariableSchema, sensitiveStringSchema, sensitiveUrlSchema, incompatibleFieldType, unionType, conditionalUnionType, validateUserConfigZodType } from "@nomicfoundation/hardhat-zod-utils";
const config: HardhatUserConfig = defineConfig({plugins:[hardhatEthers],networks:{local:{type:"edr-simulated",chainType:"l1",chainId:31337},remote:{type:"http",url:configVariable("COMPAT_RPC"),accounts:[configVariable("COMPAT_KEY")]}}});
const hre = await createHardhatRuntimeEnvironment(config);
const create = hre.network.create("local");
const connect = hre.network.connect({network:"local",chainType:"l1"});
void create; void connect;
type Variable = z.output<typeof configurationVariableSchema>;
const variable: Variable = {_type:"ConfigurationVariable",name:"COMPAT_ONLY"};
// @ts-expect-error configuration-variable names remain strings
const invalidName: Variable = {_type:"ConfigurationVariable",name:17};
// @ts-expect-error the original configuration-variable discriminator stays literal
const invalidKind: Variable = {_type:"Other",name:"COMPAT_ONLY"};
type Getter = z.output<typeof resolvedConfigurationVariableSchema>["get"];
const getter: Getter = (...args:unknown[]) => args.length;
const unknownResult: unknown = getter("argument");
// @ts-expect-error resolved getters do not widen to any
const stringResult: string = getter();
// @ts-expect-error resolved getter schema does not accept a number
const invalidGetter: Getter = 17;
const converted = z.object({count:z.string().transform((value)=>Number(value))});
const failures: {path:(string|number)[];message:string}[] = validateUserConfigZodType({count:"4"}, converted);
const choice = unionType([z.string(),z.number()],"known primitive required");
const conditional = conditionalUnionType([[(value)=>typeof value==="string",z.string()]],"string required");
choice.safeParse(1); conditional.safeParse("ok"); incompatibleFieldType().safeParse(undefined);
sensitiveStringSchema.safeParse(variable); sensitiveUrlSchema.safeParse(variable);
void failures; void unknownResult; void invalidName; void invalidKind; void stringResult; void invalidGetter;
`, { flag: "wx", mode: 0o600 });
    const project = path.join(directory, "tsconfig.json");
    fs.writeFileSync(project, JSON.stringify({
      compilerOptions: { noEmit: true, strict: true, skipLibCheck: false, module: "NodeNext", moduleResolution: "NodeNext", target: "ES2023", lib: ["ESNext"], types: ["node"], allowImportingTsExtensions: true },
      files: [path.join(root, "hardhat.config.ts"), consumer],
    }), { flag: "wx", mode: 0o600 });
    runNode([path.join(root, "node_modules", "typescript", "bin", "tsc"), "--project", project, "--pretty", "false", "--noEmit"]);
    assert.deepEqual(fs.readdirSync(directory).sort(), ["consumer.mts", "tsconfig.json"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
