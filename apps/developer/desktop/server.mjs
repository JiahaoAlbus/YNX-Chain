import { createServer } from "node:http";
import { readFile, stat, lstat, mkdir, writeFile, readdir, access, rename } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("./web/", import.meta.url));
const port = Number(process.env.PORT || 4177);
const upstreams = { "/chain": process.env.YNX_DEVELOPER_CHAIN_URL || "https://developer.ynxweb4.com/chain", "/compiler": process.env.YNX_DEVELOPER_COMPILER_URL || "https://developer.ynxweb4.com/compiler", "/ai-build": process.env.YNX_DEVELOPER_AI_BUILD_URL || "https://developer.ynxweb4.com/ai-build", "/ai-gateway": process.env.YNX_DEVELOPER_AI_URL || "https://developer.ynxweb4.com/ai-gateway", "/app-gateway": process.env.YNX_DEVELOPER_APP_GATEWAY_URL || "https://developer.ynxweb4.com/app-gateway" };
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ttf": "font/ttf", ".webmanifest": "application/manifest+json" };
const workspaceRoot = join(homedir(), ".ynx-developer", "workspaces");
const adapterStorePath = join(homedir(), ".ynx-developer", "toolchain-adapters.json");
const runtimeNode = process.execPath;
const npmCLI = process.env.YNX_DEVELOPER_NPM_CLI || join(dirname(process.execPath), "npm", "node_modules", "npm", "bin", "npm-cli.js");
let activeTasks = 0; const taskQueue = []; const MAX_ACTIVE_TASKS = 2; const MAX_QUEUED_TASKS = 16;
const TOOLCHAIN_ADAPTERS = Object.freeze({
  ".c": { id:"c", executable:"clang", installHint:"Install LLVM/Clang", args:(file)=>["-std=c17","-Wall","-Wextra","-fsyntax-only",file] },
  ".h": { id:"c", executable:"clang", installHint:"Install LLVM/Clang", args:(file)=>["-std=c17","-Wall","-Wextra","-fsyntax-only","-x","c-header",file] },
  ".cc": { id:"cpp", executable:"clang++", args:(file)=>["-std=c++20","-Wall","-Wextra","-fsyntax-only",file] },
  ".cpp": { id:"cpp", executable:"clang++", args:(file)=>["-std=c++20","-Wall","-Wextra","-fsyntax-only",file] },
  ".cxx": { id:"cpp", executable:"clang++", args:(file)=>["-std=c++20","-Wall","-Wextra","-fsyntax-only",file] },
  ".hpp": { id:"cpp", executable:"clang++", installHint:"Install LLVM/Clang", args:(file)=>["-std=c++20","-Wall","-Wextra","-fsyntax-only","-x","c++-header",file] },
  ".m": { id:"objective-c", executable:"clang", installHint:"Install LLVM/Clang with Objective-C support", args:(file)=>["-fsyntax-only","-x","objective-c",file] },
  ".mm": { id:"objective-cpp", executable:"clang++", installHint:"Install LLVM/Clang with Objective-C++ support", args:(file)=>["-fsyntax-only","-x","objective-c++",file] },
  ".js": { id:"javascript", executable:"$node", args:(file)=>["--check",file] },
  ".mjs": { id:"javascript", executable:"$node", args:(file)=>["--check",file] },
  ".cjs": { id:"javascript", executable:"$node", args:(file)=>["--check",file] },
  ".ts": { id:"typescript", executable:"$project-typescript", projectPackage:"typescript@5.9.0", installHint:"Install typescript@5.9.0 in this project", args:(file)=>["--noEmit","--pretty","false","--allowJs","false",file] },
  ".tsx": { id:"typescript-react", executable:"$project-typescript", projectPackage:"typescript@5.9.0", installHint:"Install typescript@5.9.0 in this project", args:(file)=>["--noEmit","--pretty","false","--jsx","react-jsx",file] },
  ".py": { id:"python", executable:"python3", args:(file)=>["-m","py_compile",file] },
  ".java": { id:"java", executable:"javac", args:(file)=>["-d",".ynx-build",file] },
  ".go": { id:"go", executable:"go", args:(file)=>["build","-o",".ynx-build/ynx-go-output",file] },
  ".rs": { id:"rust", executable:"rustc", args:(file)=>["--emit=metadata","-o",".ynx-build/ynx-rust-output.rmeta",file] },
  ".rb": { id:"ruby", executable:"ruby", args:(file)=>["-c",file] },
  ".php": { id:"php", executable:"php", args:(file)=>["-l",file] },
  ".swift": { id:"swift", executable:"swiftc", args:(file)=>["-typecheck",file] },
  ".kt": { id:"kotlin", executable:"kotlinc", args:(file)=>[file,"-d",".ynx-build/ynx-kotlin-output.jar"] },
  ".kts": { id:"kotlin-script", executable:"kotlinc", installHint:"Install the Kotlin compiler", args:(file)=>["-script",file] },
  ".cs": { id:"csharp", executable:"csc", installHint:"Install .NET SDK or Mono C# compiler", args:(file)=>["-nologo","-target:library","-out:.ynx-build/ynx-csharp-output.dll",file] },
  ".fs": { id:"fsharp", executable:"fsharpc", installHint:"Install the F# compiler", args:(file)=>["--target:library","-o:.ynx-build/ynx-fsharp-output.dll",file] },
  ".vb": { id:"visual-basic", executable:"vbc", installHint:"Install .NET Visual Basic compiler", args:(file)=>["-nologo","-target:library","-out:.ynx-build/ynx-vb-output.dll",file] },
  ".dart": { id:"dart", executable:"dart", installHint:"Install the Dart SDK", args:(file)=>["analyze",file] },
  ".scala": { id:"scala", executable:"scalac", installHint:"Install Scala", args:(file)=>["-d",".ynx-build",file] },
  ".groovy": { id:"groovy", executable:"groovyc", installHint:"Install Groovy", args:(file)=>["-d",".ynx-build",file] },
  ".lua": { id:"lua", executable:"luac", installHint:"Install Lua", args:(file)=>["-p",file] },
  ".pl": { id:"perl", executable:"perl", installHint:"Install Perl", args:(file)=>["-c",file] },
  ".r": { id:"r", executable:"Rscript", installHint:"Install R", args:(file)=>["--vanilla","-e",`parse(file=${JSON.stringify(file)})`] },
  ".hs": { id:"haskell", executable:"ghc", installHint:"Install GHC", args:(file)=>["-fno-code","-outputdir",".ynx-build",file] },
  ".ex": { id:"elixir", executable:"elixirc", installHint:"Install Elixir", args:(file)=>["-o",".ynx-build",file] },
  ".exs": { id:"elixir", executable:"elixirc", installHint:"Install Elixir", args:(file)=>["-o",".ynx-build",file] },
  ".erl": { id:"erlang", executable:"erlc", installHint:"Install Erlang/OTP", args:(file)=>["-o",".ynx-build",file] },
  ".ml": { id:"ocaml", executable:"ocamlc", installHint:"Install OCaml", args:(file)=>["-c","-o",".ynx-build/ynx-ocaml-output.cmo",file] },
  ".zig": { id:"zig", executable:"zig", installHint:"Install Zig", args:(file)=>["build-obj",file,"-femit-bin=.ynx-build/ynx-zig-output.o"] },
  ".nim": { id:"nim", executable:"nim", installHint:"Install Nim", args:(file)=>["check","--hints:off",file] },
  ".d": { id:"d", executable:"dmd", installHint:"Install a D compiler", args:(file)=>["-o-",file] },
  ".f": { id:"fortran", executable:"gfortran", installHint:"Install GFortran", args:(file)=>["-fsyntax-only",file] },
  ".f90": { id:"fortran", executable:"gfortran", installHint:"Install GFortran", args:(file)=>["-fsyntax-only",file] },
  ".pas": { id:"pascal", executable:"fpc", installHint:"Install Free Pascal", args:(file)=>["-Cn","-FE.ynx-build",file] },
  ".asm": { id:"assembly", executable:"nasm", installHint:"Install NASM", args:(file)=>["-f","elf64","-o",".ynx-build/ynx-assembly-output.o",file] },
  ".cu": { id:"cuda", executable:"nvcc", installHint:"Install the NVIDIA CUDA Toolkit", args:(file)=>["-c","-o",".ynx-build/ynx-cuda-output.o",file] },
  ".jl": { id:"julia", executable:"julia", installHint:"Install Julia", args:(file)=>["--startup-file=no","--history-file=no","-e",`Meta.parseall(read(${JSON.stringify(file)}, String))`] },
  ".raku": { id:"raku", executable:"raku", installHint:"Install Rakudo", args:(file)=>["-c",file] },
  ".cob": { id:"cobol", executable:"cobc", installHint:"Install GnuCOBOL", args:(file)=>["-fsyntax-only",file] },
  ".adb": { id:"ada", executable:"gnatmake", installHint:"Install GNAT", args:(file)=>["-gnatc","-D",".ynx-build",file] },
  ".cr": { id:"crystal", executable:"crystal", installHint:"Install Crystal", args:(file)=>["build","--no-codegen",file] },
  ".vala": { id:"vala", executable:"valac", installHint:"Install Vala", args:(file)=>["-C","-d",".ynx-build",file] },
  ".sh": { id:"shell", executable:"bash", args:(file)=>["-n",file] },
  ".zsh": { id:"zsh", executable:"zsh", installHint:"Install Zsh", args:(file)=>["-n",file] },
  ".fish": { id:"fish", executable:"fish", installHint:"Install Fish", args:(file)=>["-n",file] },
  ".ps1": { id:"powershell", executable:"pwsh", installHint:"Install PowerShell", args:(file)=>["-NoLogo","-NoProfile","-NonInteractive","-Command",`[void][System.Management.Automation.Language.Parser]::ParseFile(${JSON.stringify(file)},[ref]$null,[ref]$null)`] }
});
let customAdaptersLoaded = false;
const customAdapters = new Map();
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  if (pathname === "/runtime/health" && request.method === "GET") { json(response, 200, { ok: true, runtime: "desktop-project-sandbox", platform: process.platform, packageInstall: true, lifecycleScripts: false, maxConcurrent: MAX_ACTIVE_TASKS, maxQueued: MAX_QUEUED_TASKS, active: activeTasks, queued: taskQueue.length }); return; }
  if (pathname === "/runtime/toolchains" && request.method === "GET") { json(response, 200, { ok:true, platform:process.platform, model:"vscode-style-editing-extensions-plus-local-toolchain-adapters", extensible:true, installScope:"user-managed-or-project-local", compilationTruth:"ready only when the matching compiler or interpreter is installed", adapters:await toolchainStatus() }); return; }
  if (pathname === "/runtime/toolchains/register" && request.method === "POST") {
    let body; try { body = JSON.parse((await readBody(request, 64 * 1024)).toString("utf8")); }
    catch (error) { json(response, error.status || 400, { error:error.message || "Invalid toolchain adapter." }); return; }
    try { const adapter=await registerCustomAdapter(body);json(response,201,{ok:true,adapter,security:{shell:false,network:false,approvalRequiredPerCompile:true,persistence:"current-user"}}); }
    catch(error){json(response,error.status||400,{error:error.message||"Toolchain adapter rejected.",code:error.code||"adapter_invalid"});}return;
  }
  if (pathname === "/runtime/toolchains/remove" && request.method === "POST") {
    let body;try{body=JSON.parse((await readBody(request,16*1024)).toString("utf8"));const removed=await removeCustomAdapter(body);json(response,200,{ok:true,removed});}catch(error){json(response,error.status||400,{error:error.message||"Toolchain adapter removal failed.",code:error.code||"adapter_removal_failed"});}return;
  }
  if (pathname === "/runtime/task" && request.method === "POST") { let body; try { body = JSON.parse((await readBody(request, 3 * 1024 * 1024)).toString("utf8")); } catch (error) { json(response, error.status || 400, { error: error.message || "Invalid runtime task." }); return; } await scheduleTask(response, body); return; }
  const prefix = Object.keys(upstreams).find((value) => pathname === value || pathname.startsWith(`${value}/`));
  if (prefix) { await proxy(request, response, upstreams[prefix], request.url.slice(prefix.length) || "/"); return; }
  const target = normalize(join(root, pathname === "/" ? "index.html" : pathname.slice(1)));
  if (!target.startsWith(root)) { response.writeHead(403).end("Forbidden"); return; }
  try {
    if (!(await stat(target)).isFile()) throw new Error("not file");
    response.writeHead(200, { "content-type": types[extname(target)] || "application/octet-stream", "cache-control": pathname.startsWith("/monaco/") ? "public, max-age=31536000, immutable" : "no-store", "content-security-policy": "default-src 'self'; connect-src 'self' http://127.0.0.1:* https:; worker-src 'self' blob:; style-src 'self'; script-src 'self'; img-src 'self' data:; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff" });
    response.end(await readFile(target));
  } catch { response.writeHead(404).end("Not found"); }
});
server.listen(port, "127.0.0.1");
const parentPID = process.ppid;
setInterval(() => { if (process.ppid !== parentPID || process.ppid === 1) server.close(() => process.exit(0)); }, 500);

async function proxy(request, response, upstream, path) {
  try {
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 2 * 1024 * 1024) { response.writeHead(413).end("Request too large"); return; } chunks.push(chunk); }
    const headers = { accept: request.headers.accept || "application/json" };
    if (request.headers["content-type"]) headers["content-type"] = request.headers["content-type"];
    for (const name of ["x-ynx-ai-key", "x-ynx-ai-provider", "x-ynx-ai-model"]) if (request.headers[name]) headers[name] = request.headers[name];
    const result = await fetch(`${upstream.replace(/\/$/, "")}${path}`, { method: request.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
    const outgoing = {}; for (const name of ["content-type", "cache-control", "x-request-id", "x-ynx-network", "x-ynx-truthful-status"]) { const value = result.headers.get(name); if (value) outgoing[name] = value; }
    response.writeHead(result.status, outgoing); if (result.body) Readable.fromWeb(result.body).pipe(response); else response.end();
  } catch { response.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: "Configured YNX upstream is unavailable." })); }
}

function json(response, status, value, headers = {}) { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers }); response.end(JSON.stringify(value)); }
async function readBody(request, limit) { const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>limit)throw Object.assign(new Error("Request too large."),{status:413});chunks.push(chunk);}return Buffer.concat(chunks); }

async function scheduleTask(response, body) {
  if(activeTasks>=MAX_ACTIVE_TASKS&&taskQueue.length>=MAX_QUEUED_TASKS){json(response,503,{error:"Desktop task queue is full. Retry shortly."},{"retry-after":"2"});return;}
  await new Promise((resolve)=>{taskQueue.push({response,body,resolve});pumpTasks();});
}
function pumpTasks(){while(activeTasks<MAX_ACTIVE_TASKS&&taskQueue.length){const task=taskQueue.shift();activeTasks+=1;runTask(task.body).then((value)=>json(task.response,200,value),(error)=>json(task.response,error.status||400,{error:error.message||"Desktop task failed.",code:error.code||"desktop_task_failed"})).finally(()=>{activeTasks-=1;task.resolve();pumpTasks();});}}

function validProjectId(value){return typeof value==="string"&&/^[A-Za-z0-9_-]{1,160}$/.test(value);}
function safeRelativePath(value){return typeof value==="string"&&value.length<=240&&!value.startsWith("/")&&!value.includes("..")&&/^[A-Za-z0-9_./ -]+$/.test(value);}
async function prepareWorkspace(body){
  if(!validProjectId(body.projectId)||!body.files||typeof body.files!=="object"||Array.isArray(body.files))throw Object.assign(new Error("A valid project and file map are required."),{code:"invalid_project"});
  const entries=Object.entries(body.files);if(entries.length<1||entries.length>256)throw Object.assign(new Error("Project must contain 1-256 files."),{code:"invalid_project"});
  const key=createHash("sha256").update(body.projectId).digest("hex").slice(0,32);const project=join(workspaceRoot,key);await Promise.all([mkdir(join(project,".tmp"),{recursive:true,mode:0o700}),mkdir(join(project,".npm-cache"),{recursive:true,mode:0o700})]);let total=0;
  for(const [path,content] of entries){if(!safeRelativePath(path)||typeof content!=="string")throw Object.assign(new Error(`Unsafe project path: ${path}`),{code:"invalid_project_path"});total+=Buffer.byteLength(content);if(total>2*1024*1024)throw Object.assign(new Error("Project source exceeds 2 MiB."),{code:"project_too_large"});await assertNoSymlink(project,path);const target=join(project,path);await mkdir(dirname(target),{recursive:true,mode:0o700});await writeFile(target,content,{mode:0o600,flag:"w"});}
  return project;
}
async function assertNoSymlink(project,relative){let current=project;for(const part of relative.split("/")){current=join(current,part);try{if((await lstat(current)).isSymbolicLink())throw Object.assign(new Error("Project paths may not traverse symbolic links."),{code:"project_symlink_rejected"});}catch(error){if(error.code!=="ENOENT")throw error;}}}
async function runTask(body){
  const project=await prepareWorkspace(body);let args;let allowNetwork=false;
  if(body.task==="install"){
    const spec=String(body.packageSpec||"");if(!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[0-9]+(?:\.[0-9]+){0,2})?$/i.test(spec))throw Object.assign(new Error("Package must be one npm name with an optional exact numeric version."),{code:"package_spec_invalid"});
    try{await stat(npmCLI);}catch{throw Object.assign(new Error("Bundled npm runtime is unavailable."),{status:503,code:"npm_runtime_unavailable"});}
    args=[npmCLI,"install","--ignore-scripts","--save-exact","--no-audit","--no-fund",spec];allowNetwork=true;
  }else if(body.task==="test"){
    const tests=(await collectFiles(join(project,"test"))).filter((path)=>path.endsWith(".test.js")||path.endsWith(".test.mjs"));if(!tests.length)throw Object.assign(new Error("No test/*.test.js or .mjs files were found."),{code:"tests_missing"});let output="";for(const file of tests){const result=await executeBounded(project,[file],false);output+=result.output;if(result.code!==0)return{...result,task:"test",workspace:keyFor(project)};}return{ok:true,code:0,task:"test",workspace:keyFor(project),output:output||`Ran ${tests.length} test files.\n`,persistence:"per-user-local-workspace",lifecycleScripts:false};
  }else if(body.task==="compile-active"){
    const file=String(body.activePath||"");if(!safeRelativePath(file)||!Object.hasOwn(body.files,file))throw Object.assign(new Error("Compile requires one active project file."),{code:"active_file_invalid"});
    const adapter=await adapterForExtension(extname(file).toLowerCase());if(!adapter)throw Object.assign(new Error(`No installed compile adapter is registered for ${extname(file)||"this file"}.`),{code:"toolchain_adapter_missing"});
    let command=await resolveToolchain(adapter.executable),toolArgs=adapter.args(file);if(adapter.executable==="$project-typescript"){const compiler=join(project,"node_modules","typescript","bin","tsc");try{await access(compiler,fsConstants.R_OK);command=runtimeNode;toolArgs=[compiler,...toolArgs];}catch{command=null;}}
    if(!command)throw Object.assign(new Error(adapter.projectPackage?`${adapter.id} compiler is not installed in this project. Install exact package ${adapter.projectPackage}, then compile again.`:`${adapter.id} toolchain is not installed on this desktop. ${adapter.installHint || "Install the matching compiler for your user"}, then refresh toolchains.`),{status:503,code:"toolchain_unavailable"});
    await mkdir(join(project,".ynx-build"),{recursive:true,mode:0o700});const result=await executeToolchainBounded(project,command,toolArgs);return{ok:result.code===0,...result,task:"compile-active",language:adapter.id,activePath:file,toolchain:{command,verifiedInstalled:true,projectPackage:adapter.projectPackage||null},workspace:keyFor(project),network:false,bounded:true};
  }else if(body.task==="check"){
    const files=(await collectFiles(project)).filter((path)=>/\.(?:js|mjs|cjs)$/.test(path)&&!path.includes(`${join(project,"node_modules")}/`)).slice(0,128);if(!files.length)throw Object.assign(new Error("No JavaScript files were found to check."),{code:"check_files_missing"});let output="";for(const file of files){const result=await executeBounded(project,["--check",file],false);output+=result.output;if(result.code!==0)return{...result,task:"check",workspace:keyFor(project)};}return{ok:true,code:0,task:"check",workspace:keyFor(project),output:output||`Checked ${files.length} JavaScript files.\n`};
  }else throw Object.assign(new Error("Only install, compile-active, test, and check tasks are allowlisted."),{code:"command_not_allowed"});
  const result=await executeBounded(project,args,allowNetwork);return{ok:result.code===0,...result,task:body.task,workspace:keyFor(project),persistence:"per-user-local-workspace",lifecycleScripts:false};
}
function keyFor(project){return project.split(/[\\/]/).pop();}
async function collectFiles(root){let entries;try{entries=await readdir(root,{withFileTypes:true});}catch{return [];}const output=[];for(const entry of entries){if(entry.name==="node_modules"||entry.name.startsWith("."))continue;const path=join(root,entry.name);if(entry.isDirectory())output.push(...await collectFiles(path));else if(entry.isFile())output.push(path);}return output;}
function executeBounded(project,args,allowNetwork){
  return new Promise((resolve,reject)=>{let command=runtimeNode;let finalArgs=allowNetwork?args:["--permission","--allow-fs-read=.","--allow-fs-write=.",...args];
    if(process.platform==="darwin"){
      const escape=(value)=>value.replaceAll("\\","\\\\").replaceAll('"','\\"');const network=allowNetwork?"":"(deny network*)";const profile=`(version 1)\n(allow default)\n${network}\n(deny file-write*)\n(allow file-write* (subpath \"${escape(project)}\") (subpath \"/private/tmp\") (subpath \"/dev\"))`;command="/usr/bin/sandbox-exec";finalArgs=["-p",profile,runtimeNode,...finalArgs];
    }
    const child=spawn(command,finalArgs,{cwd:project,env:{PATH:dirname(runtimeNode),HOME:project,TMPDIR:join(project,".tmp"),npm_config_cache:join(project,".npm-cache")},shell:false,stdio:["ignore","pipe","pipe"]});let output="";const append=(chunk)=>{if(output.length<1024*1024)output+=String(chunk).slice(0,1024*1024-output.length);};child.stdout.on("data",append);child.stderr.on("data",append);const timer=setTimeout(()=>child.kill("SIGKILL"),bodyTimeout(args));child.once("error",reject);child.once("close",(code,signal)=>{clearTimeout(timer);resolve({code:code??124,signal,output:output||"Task completed without output.\n"});});
  });
}
function bodyTimeout(args){return args.includes("install")?120_000:30_000;}

async function resolveToolchain(name){
  if(name==="$node")return runtimeNode;
  const directories=String(process.env.PATH||"").split(process.platform==="win32"?";":":").filter(Boolean);
  if(process.platform==="darwin")directories.unshift("/opt/homebrew/bin","/usr/local/bin","/usr/bin","/bin","/usr/sbin");
  const suffixes=process.platform==="win32"?[".exe",".cmd",""]:[""];
  for(const directory of [...new Set(directories)])for(const suffix of suffixes){const candidate=join(directory,`${name}${suffix}`);try{await access(candidate,fsConstants.X_OK);return candidate;}catch{}}
  return null;
}
async function toolchainStatus(){
  await loadCustomAdapters();const grouped=new Map();for(const [extension,adapter] of allAdapters()){if(!grouped.has(adapter.id))grouped.set(adapter.id,{id:adapter.id,executable:adapter.executable,projectPackage:adapter.projectPackage||null,installHint:adapter.installHint||null,custom:Boolean(adapter.custom),extensions:[]});grouped.get(adapter.id).extensions.push(extension);}
  return Promise.all([...grouped.values()].map(async(item)=>{const command=item.projectPackage?null:await resolveToolchain(item.executable);return{...item,available:Boolean(command),command:command||null,availabilityScope:item.projectPackage?"project":"device"};}));
}

function allAdapters(){return [...Object.entries(TOOLCHAIN_ADAPTERS),...customAdapters.entries()];}
async function adapterForExtension(extension){await loadCustomAdapters();return customAdapters.get(extension)||TOOLCHAIN_ADAPTERS[extension]||null;}
function validateCustomAdapter(value){
  if(!value||value.schemaVersion!==1||!/^[a-z][a-z0-9-]{1,31}$/.test(value.id||""))throw Object.assign(new Error("Adapter requires schemaVersion 1 and a safe id."),{code:"adapter_identity_invalid"});
  if(new Set(Object.values(TOOLCHAIN_ADAPTERS).map((item)=>item.id)).has(value.id))throw Object.assign(new Error("A custom adapter id may not impersonate a built-in adapter."),{code:"adapter_identity_invalid"});
  if(!Array.isArray(value.extensions)||value.extensions.length<1||value.extensions.length>12)throw Object.assign(new Error("Adapter requires 1-12 extensions."),{code:"adapter_extensions_invalid"});
  const extensions=[...new Set(value.extensions.map((item)=>String(item).toLowerCase()))];if(extensions.some((item)=>!/^\.[a-z0-9][a-z0-9+_-]{0,15}$/.test(item)))throw Object.assign(new Error("Extensions must be safe."),{code:"adapter_extensions_invalid"});
  const executable=String(value.executable||"");if(!/^(?:\$node|[A-Za-z0-9_.+-]{1,80})$/.test(executable))throw Object.assign(new Error("Executable must be one installed command name without a path."),{code:"adapter_executable_invalid"});
  if(!Array.isArray(value.args)||value.args.length<1||value.args.length>32)throw Object.assign(new Error("Adapter requires 1-32 argument tokens."),{code:"adapter_args_invalid"});
  const args=value.args.map(String);if(args.some((item)=>item.length>160||!/^(?:\$\{file\}|\$\{build\}|[A-Za-z0-9_./:=+@%,-]+)$/.test(item)))throw Object.assign(new Error("Arguments may contain safe literal tokens plus ${file} or ${build}; shell syntax is rejected."),{code:"adapter_args_invalid"});
  return{id:value.id,extensions,executable,args};
}
function hydrateCustomAdapter(record){return{id:record.id,executable:record.executable,custom:true,manifestArgs:[...record.args],args:(file)=>record.args.map((item)=>item==="${file}"?file:item==="${build}"?".ynx-build":item)};}
async function loadCustomAdapters(){
  if(customAdaptersLoaded)return;customAdaptersLoaded=true;let values=[];try{values=JSON.parse(await readFile(adapterStorePath,"utf8"));}catch{}
  if(!Array.isArray(values))return;for(const value of values.slice(0,32))try{const record=validateCustomAdapter(value);for(const extension of record.extensions)customAdapters.set(extension,hydrateCustomAdapter(record));}catch{}
}
async function registerCustomAdapter(body){
  if(body.approval!=="register-local-toolchain-once")throw Object.assign(new Error("Explicit one-time adapter registration approval is required."),{status:403,code:"adapter_approval_required"});
  const record=validateCustomAdapter(body.adapter);await loadCustomAdapters();const existing=[];const seen=new Set();for(const [extension,adapter] of customAdapters){if(seen.has(adapter.id))continue;seen.add(adapter.id);existing.push({schemaVersion:1,id:adapter.id,extensions:[...customAdapters.entries()].filter(([,item])=>item.id===adapter.id).map(([ext])=>ext),executable:adapter.executable,args:adapter.manifestArgs});}
  const next=[...existing.filter((item)=>item.id!==record.id),{schemaVersion:1,...record}].slice(-32);await mkdir(dirname(adapterStorePath),{recursive:true,mode:0o700});const temporary=`${adapterStorePath}.tmp`;await writeFile(temporary,`${JSON.stringify(next,null,2)}\n`,{mode:0o600});await rename(temporary,adapterStorePath);customAdapters.clear();customAdaptersLoaded=false;await loadCustomAdapters();
  const command=await resolveToolchain(record.executable);return{id:record.id,extensions:record.extensions,executable:record.executable,available:Boolean(command),command:command||null,custom:true};
}
async function removeCustomAdapter(body){
  if(body.approval!=="remove-local-toolchain-once")throw Object.assign(new Error("Explicit one-time adapter removal approval is required."),{status:403,code:"adapter_removal_approval_required"});
  const id=String(body.id||"");if(!/^[a-z][a-z0-9-]{1,31}$/.test(id))throw Object.assign(new Error("A valid custom adapter id is required."),{code:"adapter_identity_invalid"});await loadCustomAdapters();
  const records=[];const seen=new Set();for(const [,adapter] of customAdapters){if(seen.has(adapter.id)||adapter.id===id)continue;seen.add(adapter.id);records.push({schemaVersion:1,id:adapter.id,extensions:[...customAdapters.entries()].filter(([,item])=>item.id===adapter.id).map(([extension])=>extension),executable:adapter.executable,args:adapter.manifestArgs});}
  if(records.length===[...new Set([...customAdapters.values()].map((item)=>item.id))].length)throw Object.assign(new Error("Custom adapter was not found; built-in adapters cannot be removed."),{status:404,code:"adapter_not_found"});
  await mkdir(dirname(adapterStorePath),{recursive:true,mode:0o700});const temporary=`${adapterStorePath}.tmp`;await writeFile(temporary,`${JSON.stringify(records,null,2)}\n`,{mode:0o600});await rename(temporary,adapterStorePath);customAdapters.clear();customAdaptersLoaded=false;await loadCustomAdapters();return{id};
}
function executeToolchainBounded(project,command,args){
  return new Promise((resolve,reject)=>{let finalCommand=command,finalArgs=args;
    if(process.platform==="darwin"){const escape=(value)=>value.replaceAll("\\","\\\\").replaceAll('"','\\"');const profile=`(version 1)\n(allow default)\n(deny network*)\n(deny file-write*)\n(allow file-write* (subpath "${escape(project)}") (subpath "/private/tmp") (subpath "/dev"))`;finalCommand="/usr/bin/sandbox-exec";finalArgs=["-p",profile,command,...args];}
    const child=spawn(finalCommand,finalArgs,{cwd:project,env:{PATH:process.env.PATH||dirname(command),HOME:project,TMPDIR:join(project,".tmp")},shell:false,stdio:["ignore","pipe","pipe"]});let output="";const append=(chunk)=>{if(output.length<1024*1024)output+=String(chunk).slice(0,1024*1024-output.length);};child.stdout.on("data",append);child.stderr.on("data",append);const timer=setTimeout(()=>child.kill("SIGKILL"),30_000);child.once("error",reject);child.once("close",(code,signal)=>{clearTimeout(timer);resolve({code:code??124,signal,output:output||"Compiler completed without diagnostics.\n"});});
  });
}
