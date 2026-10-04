const failureText = code => ({
  NATIVE_CONTRACT_CHAIN_MISMATCH: "This endpoint is not the expected YNX Testnet. Nothing was signed or submitted.",
  NATIVE_CONTRACT_UNSUPPORTED_RUNTIME: "This contract runtime is not supported by the existing chain capability.",
  NATIVE_CONTRACT_CHANGED_REVIEW_AGAIN: "The contract changed during this read. Look it up again.",
  NATIVE_CONTRACT_PURE_VIEW_ONLY: "Only pure and view methods can be read here.",
  NATIVE_CONTRACT_CALLDATA_REQUIRED: "Enter complete hex calldata including the method selector and arguments.",
  NATIVE_CONTRACT_READ_TIMEOUT: "The read timed out. You can try again; no transaction was submitted.",
})[code] ?? "The contract response could not be verified. Nothing was signed or submitted. Check the address and try again.";

// Detach existing public Main DTOs, not a new contract proof or interpreter.
// Original producer bounds: functions128, storage128, result hex65538 chars.
function snapshotPublic(value){
  let visits=0;const memo=new WeakMap(),active=new WeakSet();
  function copy(value,depth=0){
    if(++visits>8192||depth>12)throw Error("Oversized contract display");
    if(value===null||typeof value==="boolean")return value;
    if(typeof value==="string"){if(value.length>65538)throw Error("Oversized contract display");return value;}
    if(typeof value==="number"&&Number.isFinite(value))return value;
    if(!value||typeof value!=="object"||active.has(value))throw Error("Invalid contract display");
    if(memo.has(value))return memo.get(value);
    const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
    if(array?prototype!==Array.prototype:![Object.prototype,null].includes(prototype))throw Error("Invalid contract display");
    const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
    if(keys.some(key=>typeof key!=="string"||!Object.hasOwn(descriptors[key],"value")))throw Error("Invalid contract display");
    const length=array?descriptors.length?.value:null;
    if(array?(!Number.isSafeInteger(length)||length<0||length>128||keys.length!==length+1):keys.length>256)throw Error("Invalid contract display");
    if(array)for(let index=0;index<length;index++)if(!Object.hasOwn(descriptors,index))throw Error("Invalid contract display");
    const result=array?new Array(length):Object.create(prototype);memo.set(value,result);active.add(value);
    for(const key of keys){if(array&&key==="length")continue;Object.defineProperty(result,key,{value:copy(descriptors[key].value,depth+1),enumerable:true,writable:true,configurable:true});}
    active.delete(value);return Object.freeze(result);
  }
  return copy(value);
}

/** Close, editing, account changes and Wallet lock cancel old public results. */
export function createNativeContractUI({getContext, request, render}) {
  let revision = 0;
  function clear() { revision++; render({busy: false, result: null, error: null}); }
  async function run(input) {
    const before = getContext();
    if (!before.open) return;
    const current = ++revision;
    const active = () => {
      const after = getContext();
      return current === revision && after.open && before.account === after.account && before.keyRevision === after.keyRevision;
    };
    render({busy: true, result: null, error: null});
    try {
      const dispatched=snapshotPublic(input);
      if(!["bft","legacy"].includes(dispatched.mode)||!["lookup","read"].includes(dispatched.action)||typeof dispatched.address!=="string"||!/^0x[0-9a-f]{40}$/.test(dispatched.address)||
        Object.keys(dispatched).sort().join(",")!==(dispatched.action==="lookup"?"action,address,mode":"action,address,function,mode")||dispatched.action==="read"&&(typeof dispatched.function!=="string"||!dispatched.function||dispatched.function.length>8194))throw Error("Invalid contract request");
      if(!active())return;
      const received = await request(dispatched);
      if (!active()) return;
      const response = snapshotPublic(received);
      if (!active()) return;
      if (response?.ok !== true) throw Object.assign(new Error(), {code: response?.ok === false ? response?.error?.code : undefined});
      const result = response.value;
      if (result?.action !== dispatched.action || result.mode !== dispatched.mode ||
          (result.artifact ?? result.read?.artifact)?.address !== dispatched.address ||
          dispatched.action === "read" && result.read?.truthfulStatus !== (dispatched.mode === "bft" ? "bft-bounded-static-read-no-sign-no-broadcast" : "native-local-pure-view-read-no-sign-no-broadcast")) {
        throw new Error("Unverified read");
      }
      render({busy: false, result, error: null});
    } catch (error) {
      if (active()) render({busy: false, result: null, error: failureText(error?.code)});
    }
  }
  return {clear, run};
}
