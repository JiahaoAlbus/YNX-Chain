// Desktop mirror of apps/wallet/src/chain/nativeContract.ts. Keep wire parsers,
// pinned identities and read bounds identical; only transport imports differ.
import { CANONICAL_RPC_URL as DEFAULT_CHAIN_API } from "./rpc.mjs";
import { createHash } from "node:crypto";
import { AbiCoder, id as abiSignatureID } from "ethers";
export class NativeContractError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = "NativeContractError";
    }
}
const fail = (code) => { throw new NativeContractError(code); };
const object = (value) => !!value && typeof value === "object" && !Array.isArray(value);
function text(value, max = 256) { if (typeof value !== "string" || !value || value.trim() !== value || value.length > max || /[\x00-\x1f\x7f]/.test(value))
    return fail("NATIVE_CONTRACT_INVALID_RESPONSE"); return value; }
function address(value) { const result = text(value); if (!/^0x[0-9a-f]{40}$/.test(result))
    return fail("NATIVE_CONTRACT_INVALID_ADDRESS"); return result; }
function hash(value) { const result = text(value); if (!/^[0-9a-f]{64}$/.test(result))
    return fail("NATIVE_CONTRACT_INVALID_ARTIFACT"); return result; }
function limitations(value) { if (value === undefined)
    return Object.freeze([]); if (!Array.isArray(value) || value.length > 32)
    return fail("NATIVE_CONTRACT_INVALID_RESPONSE"); return Object.freeze(value.map(item => text(item, 2048))); }
const digest = (value) => createHash("sha256").update(value, "utf8").digest("hex");
// Exact original consensus registry in internal/chain/bounded_contract.go.
// A new runtime/contract cannot become supported through a response status bit.
const BFT_PINNED_IDENTITIES = Object.freeze({
    SampleEVMWriteCounter: ["961d42cf02384dad28e18137d58f2b46c93dbd3a80ca078a3d96726d6d86191b", "bad6eaa7c1f17ed1e3073830127815b90b03ce1e0d15e113411f9ecdbb7d47a0"],
    SampleYNXTCompatibleERC20: ["344b1d80d8b2fec3d22a38aa98b28e2c6ab20429f26b6cef726da1e634cbb5c4", "b8604e8a14d38cff0b32d2bca4e768e7a7ea95eac231673e4ec9838c58aa7118"],
});
const BFT_READ_ABI = Object.freeze({
    SampleEVMWriteCounter: [["count()", "uint256", 0]],
    SampleYNXTCompatibleERC20: [["balanceOf(address)", "uint256", 1], ["decimals()", "uint8", 0], ["name()", "string", 0], ["symbol()", "string", 0], ["totalSupply()", "uint256", 0]],
});
export function bftNativeReadMethods(record) {
    parseBFTNativeContract(record, record.address);
    return Object.freeze(BFT_READ_ABI[record.name].map(([signature, _output, inputCount]) => Object.freeze({ name: signature.split("(")[0], signature, selector: abiSignatureID(signature).slice(0, 10), inputCount, stateMutability: "view", bytecodeSelectorMatched: true })));
}
function transactionHash(value) { const result = text(value); if (!/^0x[0-9a-f]{64}$/.test(result))
    return fail("NATIVE_CONTRACT_INVALID_ARTIFACT"); return result; }
function height(value) { if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    return fail("NATIVE_CONTRACT_INVALID_ARTIFACT"); return value; }
// Go encoding/json escapes these characters in strings. Metadata ordering below
// follows the original BFTContract struct; map keys are bounded ASCII and sorted.
const goJSON = (value) => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
function literal(value, max) { if (typeof value !== "string" || value.length > max)
    return fail("NATIVE_CONTRACT_INVALID_ARTIFACT"); return value; }
export function parseBFTNativeContract(value, expectedAddress) {
    const required = ["address", "name", "deployer", "sourceHash", "deployedBytecodeHash", "deployedBytecode", "runtimeStorage", "runtimeMode", "blockHeight", "txHash", "lastUpdatedHeight", "auditHash"], optional = ["constructorArgs", "lastCallTxHash"];
    if (!object(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key)) ||
        address(value.address) !== address(expectedAddress) || value.runtimeMode !== "pinned-artifact-bounded-evm-subset")
        return fail("NATIVE_CONTRACT_INVALID_ARTIFACT");
    const bytecode = text(value.deployedBytecode, 12288);
    if (!/^0x(?:[0-9a-f]{2})+$/.test(bytecode) || digest("solc-deployed-bytecode\0" + bytecode + "\0") !== value.deployedBytecodeHash)
        return fail("NATIVE_CONTRACT_BYTECODE_MISMATCH");
    if (typeof value.name !== "string" || !Object.hasOwn(BFT_PINNED_IDENTITIES, value.name) ||
        BFT_PINNED_IDENTITIES[value.name][0] !== value.sourceHash || BFT_PINNED_IDENTITIES[value.name][1] !== value.deployedBytecodeHash)
        return fail("NATIVE_CONTRACT_UNSUPPORTED_RUNTIME");
    if (!object(value.runtimeStorage) || Object.keys(value.runtimeStorage).length > 128)
        return fail("NATIVE_CONTRACT_INVALID_ARTIFACT");
    const storage = Object.fromEntries(Object.keys(value.runtimeStorage).sort().map(key => {
        if (!/^[\x20-\x7e]{1,128}$/.test(key))
            return fail("NATIVE_CONTRACT_INVALID_ARTIFACT");
        return [key, literal(value.runtimeStorage[key], 4096)];
    }));
    let args;
    if (value.constructorArgs !== undefined) {
        if (!Array.isArray(value.constructorArgs) || value.constructorArgs.length < 1 || value.constructorArgs.length > 32)
            return fail("NATIVE_CONTRACT_INVALID_ARTIFACT");
        args = Object.freeze(value.constructorArgs.map(v => literal(v, 2048)));
    }
    const result = { address: expectedAddress, name: text(value.name), deployer: address(value.deployer), sourceHash: hash(value.sourceHash), deployedBytecodeHash: hash(value.deployedBytecodeHash), deployedBytecode: bytecode,
        ...(args ? { constructorArgs: args } : {}), runtimeStorage: Object.freeze(storage), runtimeMode: "pinned-artifact-bounded-evm-subset",
        blockHeight: height(value.blockHeight), txHash: transactionHash(value.txHash), lastUpdatedHeight: height(value.lastUpdatedHeight),
        ...(value.lastCallTxHash === undefined ? {} : { lastCallTxHash: transactionHash(value.lastCallTxHash) }), auditHash: hash(value.auditHash) };
    const sortedStorage = "{" + Object.keys(storage).sort().map(key => goJSON(key) + ":" + goJSON(storage[key])).join(",") + "}";
    const auditJSON = "{" + Object.entries({ ...result, auditHash: "" }).map(([key, item]) => goJSON(key) + ":" + (key === "runtimeStorage" ? sortedStorage : goJSON(item))).join(",") + "}";
    if (result.lastUpdatedHeight < result.blockHeight || result.address !== "0x" + digest(`YNX_BFT_CONTRACT_ADDRESS_V1|${result.deployer}|${result.txHash}`).slice(0, 40) ||
        result.auditHash !== digest("YNX_BFT_CONTRACT_AUDIT_V1|" + auditJSON))
        return fail("NATIVE_CONTRACT_RECORD_MISMATCH");
    return Object.freeze(result);
}
export function parseNativeContractArtifact(value, expectedAddress) {
    if (!object(value) || address(value.address) !== address(expectedAddress))
        return fail("NATIVE_CONTRACT_ADDRESS_MISMATCH");
    const kinds = { "source-analyzer-artifact": "deterministic-devnet-pure-view-runtime", "pinned-solc-bytecode-artifact": "hardhat-artifact-local-evm-opcode-staticcall-subset" };
    if (typeof value.artifactKind !== "string" || !Object.hasOwn(kinds, value.artifactKind) || value.runtimeMode !== kinds[value.artifactKind] ||
        value.functions !== undefined && !Array.isArray(value.functions))
        return fail("NATIVE_CONTRACT_UNSUPPORTED_RUNTIME");
    const rows = (value.functions ?? []);
    if (rows.length > 128)
        return fail("NATIVE_CONTRACT_INVALID_RESPONSE");
    const functions = rows.map(item => {
        if (!object(item) || !["pure", "view", "nonpayable", "payable"].includes(String(item.stateMutability)) ||
            item.inputs !== undefined && !Array.isArray(item.inputs) || item.bytecodeSelectorMatched !== undefined && typeof item.bytecodeSelectorMatched !== "boolean")
            return fail("NATIVE_CONTRACT_INVALID_RESPONSE");
        const name = text(item.name), signature = text(item.signature, 1024), selector = text(item.selector);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !signature.startsWith(name + "(") || !signature.endsWith(")") || !/^0x[0-9a-f]{8}$/.test(selector))
            return fail("NATIVE_CONTRACT_INVALID_RESPONSE");
        // Original chain.hashParts analyzer selectors are not Ethereum Keccak.
        const analyzer = value.artifactKind === "source-analyzer-artifact";
        const expectedSelector = analyzer ? "0x" + digest("evm-selector\0" + signature + "\0").slice(0, 8) : abiSignatureID(signature).slice(0, 10);
        const selectorSource = analyzer ? "local-deterministic-source-signature" : "hardhat-ethers-keccak-selector-metadata";
        if (selector !== expectedSelector || item.selectorSource !== undefined && item.selectorSource !== selectorSource || analyzer && item.bytecodeSelectorMatched === true)
            return fail("NATIVE_CONTRACT_INVALID_RESPONSE");
        return Object.freeze({ name, signature, selector, stateMutability: item.stateMutability, inputCount: item.inputs?.length ?? 0, bytecodeSelectorMatched: item.bytecodeSelectorMatched === true });
    });
    if (new Set(functions.map(row => row.signature)).size !== functions.length)
        return fail("NATIVE_CONTRACT_INVALID_RESPONSE");
    return Object.freeze({ address: expectedAddress, name: text(value.name), sourceHash: hash(value.sourceHash), artifactHash: hash(value.artifactHash), bytecodeHash: hash(value.bytecodeHash), deployedBytecodeHash: hash(value.deployedBytecodeHash),
        artifactKind: value.artifactKind, runtimeMode: String(value.runtimeMode), functions: Object.freeze(functions), limitations: limitations(value.limitations) });
}
function choose(artifact, input) {
    const value = text(input, 8192), hex = /^0x(?:[0-9a-f]{2}){4,}$/.test(value);
    const found = artifact.functions.filter(row => row.name === value || row.signature === value || row.selector === value || (hex && row.selector === value.slice(0, 10)));
    if (found.length !== 1)
        return fail("NATIVE_CONTRACT_FUNCTION_UNAVAILABLE");
    const row = found[0];
    if (!["pure", "view"].includes(row.stateMutability))
        return fail("NATIVE_CONTRACT_PURE_VIEW_ONLY");
    if (artifact.artifactKind === "pinned-solc-bytecode-artifact" && !row.bytecodeSelectorMatched)
        return fail("NATIVE_CONTRACT_SELECTOR_NOT_MATCHED");
    if (row.inputCount > 0 && (!hex || value.length === 10))
        return fail("NATIVE_CONTRACT_CALLDATA_REQUIRED");
    return row;
}
/** Uses the existing native contract API, not an invented Ethereum simulation.
 * Lookup + pure/view selection precedes its read-only POST; no caller key,
 * execution route, gas estimate, value transfer or transaction submission. */
export class NativeContractClient {
    fetcher;
    timeoutMs;
    now;
    origin;
    sequence = 0;
    constructor(origin = DEFAULT_CHAIN_API, fetcher = fetch, timeoutMs = 8000, now = () => new Date()) {
        this.fetcher = fetcher;
        this.timeoutMs = timeoutMs;
        this.now = now;
        this.origin = contractOrigin(origin);
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 8000)
            fail("NATIVE_CONTRACT_INVALID_TIMEOUT");
    }
    /** New BFT wire is explicitly separate from legacy {function}. Never retry
     * a failed call by guessing another schema or sending a write transaction. */
    async lookupBFT(target, guard) {
        address(target);
        guard();
        await this.verifyChain(guard);
        return parseBFTNativeContract(await this.request("GET", "/ide/contracts/" + target, undefined, guard), target);
    }
    async readBFT(target, calldata, guard) {
        guard();
        address(target);
        if (typeof calldata !== "string" || calldata.length > 8194 || !/^0x(?:[0-9a-f]{2}){4,}$/.test(calldata))
            return fail("NATIVE_CONTRACT_CALLDATA_REQUIRED");
        const artifact = await this.lookupBFT(target, guard);
        const result = await this.request("POST", "/ide/call", { address: target, calldata }, guard);
        if (!object(result) || Object.keys(result).sort().join(",") !== "address,encodedResult,opcodeStepCount,runtimeMode" || result.address !== target || result.runtimeMode !== artifact.runtimeMode ||
            typeof result.encodedResult !== "string" || result.encodedResult.length > 65538 || !/^0x(?:[0-9a-f]{2})*$/.test(result.encodedResult) ||
            typeof result.opcodeStepCount !== "number" || !Number.isSafeInteger(result.opcodeStepCount) || result.opcodeStepCount < 1 || result.opcodeStepCount > 2048)
            return fail("NATIVE_CONTRACT_READ_BINDING_MISMATCH");
        const after = parseBFTNativeContract(await this.request("GET", "/ide/contracts/" + target, undefined, guard), target);
        if (after.auditHash !== artifact.auditHash)
            return fail("NATIVE_CONTRACT_CHANGED_REVIEW_AGAIN");
        await this.verifyChain(guard);
        guard();
        const known = BFT_READ_ABI[artifact.name].find(([signature, _output, count]) => abiSignatureID(signature).slice(0, 10) === calldata.slice(0, 10) && calldata.length === 10 + 64 * count);
        let returnValue = null;
        if (known) {
            try {
                returnValue = String(AbiCoder.defaultAbiCoder().decode([known[1]], result.encodedResult)[0]);
                if (returnValue.length > 32768)
                    throw new Error();
            }
            catch {
                return fail("NATIVE_CONTRACT_READ_BINDING_MISMATCH");
            }
        }
        return Object.freeze({ artifact, encodedResult: result.encodedResult, opcodeStepCount: result.opcodeStepCount, returnValue, origin: this.origin, asOf: this.now().toISOString(), truthfulStatus: "bft-bounded-static-read-no-sign-no-broadcast" });
    }
    async lookup(target, guard) {
        address(target);
        guard();
        await this.verifyChain(guard);
        const value = await this.request("GET", "/contracts/" + target, undefined, guard);
        return parseNativeContractArtifact(value, target);
    }
    async read(target, requested, guard) {
        guard();
        address(target);
        text(requested, 8192);
        const artifact = await this.lookup(target, guard), selected = choose(artifact, requested);
        guard();
        const value = await this.request("POST", "/ide/call", { address: target, function: requested }, guard);
        if (!object(value) || value.address !== target || value.function !== selected.name || value.signature !== selected.signature || value.selector !== selected.selector ||
            value.artifactKind !== artifact.artifactKind || value.runtimeMode !== artifact.runtimeMode || typeof value.returnValue !== "string" || value.returnValue.length > 32768 ||
            typeof value.encodedResult !== "string" || value.encodedResult.length > 65538 || !/^0x(?:[0-9a-f]{2})*$/.test(value.encodedResult) || typeof value.bytecodeSelectorMatched !== "boolean" ||
            artifact.artifactKind === "source-analyzer-artifact" && value.bytecodeSelectorMatched ||
            ["transactionHash", "stateTransition", "storageWrites", "executionLogs", "logCount"].some(key => Object.hasOwn(value, key)))
            return fail("NATIVE_CONTRACT_READ_BINDING_MISMATCH");
        const status = text(value.executionStatus);
        const allowed = artifact.artifactKind === "source-analyzer-artifact" ? ["source_analyzer_literal_return"] : ["hardhat_abi_selector_matched_deployed_bytecode_staticcall_subset", "evm_opcode_interpreter_staticcall_subset"];
        if (!allowed.includes(status) || artifact.artifactKind === "pinned-solc-bytecode-artifact" && !value.bytecodeSelectorMatched)
            return fail("NATIVE_CONTRACT_UNSUPPORTED_EXECUTION");
        const engine = value.executionEngine === undefined ? null : text(value.executionEngine);
        const steps = value.opcodeStepCount === undefined ? null : value.opcodeStepCount;
        if (status === "evm_opcode_interpreter_staticcall_subset" && (engine !== "local-bounded-evm-opcode-interpreter" || !Number.isSafeInteger(steps) || Number(steps) <= 0) ||
            status !== "evm_opcode_interpreter_staticcall_subset" && (engine !== null || steps !== null))
            return fail("NATIVE_CONTRACT_UNSUPPORTED_EXECUTION");
        const after = parseNativeContractArtifact(await this.request("GET", "/contracts/" + target, undefined, guard), target);
        if (JSON.stringify(after) !== JSON.stringify(artifact))
            return fail("NATIVE_CONTRACT_CHANGED_REVIEW_AGAIN");
        await this.verifyChain(guard);
        guard();
        return Object.freeze({ artifact, function: selected, returnValue: value.returnValue, encodedResult: value.encodedResult, executionStatus: status, executionEngine: engine,
            opcodeStepCount: steps, bytecodeSelectorMatched: value.bytecodeSelectorMatched, limitations: limitations(value.limitations), origin: this.origin, asOf: this.now().toISOString(), truthfulStatus: "native-local-pure-view-read-no-sign-no-broadcast" });
    }
    async verifyChain(guard) {
        const id = ++this.sequence, value = await this.request("POST", "/evm", { jsonrpc: "2.0", id, method: "eth_chainId", params: [] }, guard);
        if (!object(value) || value.jsonrpc !== "2.0" || value.id !== id || value.result !== "0x1917" || Object.hasOwn(value, "error"))
            fail("NATIVE_CONTRACT_CHAIN_MISMATCH");
    }
    async request(method, route, body, guard) {
        guard();
        const abort = new AbortController();
        let reject;
        const stopped = new Promise((_, stop) => { reject = stop; });
        const timer = setTimeout(() => { reject(new NativeContractError("NATIVE_CONTRACT_READ_TIMEOUT")); abort.abort(); }, this.timeoutMs);
        try {
            const value = await Promise.race([(async () => {
                    const url = this.origin + route, response = await this.fetcher(url, { method, redirect: "error", credentials: "omit", signal: abort.signal, headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
                    if (!response.ok || response.redirected || response.url && response.url !== url)
                        fail("NATIVE_CONTRACT_READ_UNAVAILABLE");
                    const raw = await response.text();
                    if (raw.length > 131072)
                        fail("NATIVE_CONTRACT_RESPONSE_TOO_LARGE");
                    try {
                        return JSON.parse(raw);
                    }
                    catch {
                        return fail("NATIVE_CONTRACT_INVALID_RESPONSE");
                    }
                })(), stopped]);
            guard();
            return value;
        }
        catch (error) {
            guard();
            if (error instanceof NativeContractError)
                throw error;
            return fail("NATIVE_CONTRACT_READ_UNAVAILABLE");
        }
        finally {
            clearTimeout(timer);
            abort.abort();
        }
    }
}
function contractOrigin(value) { const parsed = new URL(value); if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/" && parsed.pathname !== "")
    fail("NATIVE_CONTRACT_INVALID_ORIGIN"); if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["127.0.0.1", "localhost", "10.0.2.2"].includes(parsed.hostname)))
    fail("NATIVE_CONTRACT_INVALID_ORIGIN"); return parsed.origin; }

