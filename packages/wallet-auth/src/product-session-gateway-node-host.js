import { createHash, randomBytes, randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { canonicalJSON, WalletAuthError } from "./canonical.js";
import { ProductSessionGatewayHttpHandler } from "./product-session-gateway-http.js";
import { parseProductSessionGatewaySnapshot } from "./product-session-gateway.js";
import { parseProductSessionRegistry } from "./product-session-registry.js";

const MAXIMUM_STATE_BYTES = 64 * 1024 * 1024;
const JSON_HEADERS = {"cache-control":"no-store","content-type":"application/json; charset=utf-8"};

export class PersistentProductSessionGatewayNodeHost {
  #registry; #registrySha256; #handler; #statePath; #now; #tokenFactory;
  constructor(registryInput, options) {
    if (!options || typeof options !== "object" || Array.isArray(options) || typeof options.statePath !== "string" || !options.statePath.startsWith("/")) fail("INVALID_CONFIG", "Product Session v2 state path must be absolute");
    this.#registry = parseProductSessionRegistry(registryInput);
    this.#registrySha256 = createHash("sha256").update(canonicalJSON(this.#registry)).digest("hex");
    this.#statePath = options.statePath; this.#now = options.now ?? (()=>new Date()); this.#tokenFactory = options.tokenFactory ?? (()=>randomBytes(32).toString("base64url"));
    privateDirectory(dirname(this.#statePath));
    const snapshot = load(this.#statePath, this.#registrySha256);
    this.#handler = new ProductSessionGatewayHttpHandler(this.#registry, this.#tokenFactory, snapshot);
    if (snapshot === undefined) persist(this.#statePath,{schemaVersion:1,registrySha256:this.#registrySha256,snapshot:this.#handler.snapshot()});
  }

  handler() { return async (request, response) => {
    const requestId = header(request.headers["x-request-id"]);
    try {
      const body = await boundedBody(request);
      const before = this.#handler.snapshot();
      const result = this.#handler.handle({requestId,method:request.method,path:request.url,contentType:request.headers["content-type"]??"",body,proofHeader:header(request.headers["x-ynx-product-session-proof-v2"]),networkAvailable:true},this.#now());
      try { this.#persist(); } catch (error) { this.#handler = new ProductSessionGatewayHttpHandler(this.#registry,this.#tokenFactory,before); throw error; }
      response.writeHead(result.status,result.headers); response.end(result.body);
    } catch (error) {
      const code=error instanceof WalletAuthError?error.code:"STATE_UNAVAILABLE", message=error instanceof WalletAuthError?error.message:"Product Session v2 state is unavailable";
      const safeId=/^req_[A-Za-z0-9_-]{12,80}$/.test(requestId??"")?requestId:"req_invalid_request_000";
      response.writeHead(503,{...JSON_HEADERS,"x-request-id":safeId}); response.end(canonicalJSON({error:{code,message},ok:false,requestId:safeId,schemaVersion:2}));
    }
  }; }

  snapshot(){return this.#handler.snapshot();}
  #persist(){if(load(this.#statePath,this.#registrySha256)===undefined)fail("STATE_UNAVAILABLE","Product Session v2 state disappeared at runtime");persist(this.#statePath,{schemaVersion:1,registrySha256:this.#registrySha256,snapshot:this.#handler.snapshot()});}
}

function privateDirectory(path){const value=lstatSync(path);if(!value.isDirectory()||value.isSymbolicLink()||(value.mode&0o777)!==0o700)fail("UNSAFE_STATE_PATH","Product Session v2 state directory must be a private mode-0700 directory");}
function load(path,registrySha256){let fd;try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(error){if(error?.code==="ENOENT")return undefined;fail("UNSAFE_STATE_PATH","Product Session v2 state file cannot be opened safely");}try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o777)!==0o600||stat.size<1||stat.size>MAXIMUM_STATE_BYTES)fail("UNSAFE_STATE_PATH","Product Session v2 state file metadata is unsafe");const text=readFileSync(fd,"utf8");let value;try{value=JSON.parse(text);}catch{fail("INVALID_GATEWAY_STORE","Product Session v2 state is not JSON");}if(canonicalJSON(value)!==text||Object.keys(value).sort().join("\n")!==["registrySha256","schemaVersion","snapshot"].sort().join("\n")||value.schemaVersion!==1||value.registrySha256!==registrySha256)fail("INVALID_GATEWAY_STORE","Product Session v2 state identity is invalid");return parseProductSessionGatewaySnapshot(value.snapshot);}finally{closeSync(fd);}}
function persist(path,value){const directory=dirname(path),temporary=join(directory,`.${basename(path)}.${randomUUID()}.tmp`);let fd;try{fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);writeFileSync(fd,canonicalJSON(value),"utf8");fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temporary,path);const dirfd=openSync(directory,constants.O_RDONLY);try{fsyncSync(dirfd);}finally{closeSync(dirfd);}}finally{if(fd!==undefined)closeSync(fd);if(existsSync(temporary))try{unlinkSync(temporary);}catch{}}}
async function boundedBody(request){const chunks=[];let bytes=0;for await(const chunk of request){bytes+=chunk.length;if(bytes>1_048_576)fail("BODY_TOO_LARGE","Product Session v2 body exceeds policy");chunks.push(chunk);}return Buffer.concat(chunks).toString("utf8");}
function header(value){return Array.isArray(value)?value[0]??null:value??null;}
function fail(code,message){throw new WalletAuthError(code,message);}
