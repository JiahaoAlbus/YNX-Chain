import { createServer } from "node:http";
import { readFile, stat, lstat, mkdir, writeFile, readdir } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("./web/", import.meta.url));
const port = Number(process.env.PORT || 4177);
const upstreams = { "/chain": process.env.YNX_DEVELOPER_CHAIN_URL || "https://developer.ynxweb4.com/chain", "/compiler": process.env.YNX_DEVELOPER_COMPILER_URL || "https://developer.ynxweb4.com/compiler", "/ai-build": process.env.YNX_DEVELOPER_AI_BUILD_URL || "https://developer.ynxweb4.com/ai-build", "/ai-gateway": process.env.YNX_DEVELOPER_AI_URL || "https://developer.ynxweb4.com/ai-gateway", "/app-gateway": process.env.YNX_DEVELOPER_APP_GATEWAY_URL || "https://developer.ynxweb4.com/app-gateway" };
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const workspaceRoot = join(homedir(), ".ynx-developer", "workspaces");
const runtimeNode = process.execPath;
const npmCLI = process.env.YNX_DEVELOPER_NPM_CLI || join(dirname(process.execPath), "npm", "node_modules", "npm", "bin", "npm-cli.js");
let activeTasks = 0; const taskQueue = []; const MAX_ACTIVE_TASKS = 2; const MAX_QUEUED_TASKS = 16;
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  if (pathname === "/runtime/health" && request.method === "GET") { json(response, 200, { ok: true, runtime: "desktop-project-sandbox", platform: process.platform, packageInstall: true, lifecycleScripts: false, maxConcurrent: MAX_ACTIVE_TASKS, maxQueued: MAX_QUEUED_TASKS, active: activeTasks, queued: taskQueue.length }); return; }
  if (pathname === "/runtime/task" && request.method === "POST") { let body; try { body = JSON.parse((await readBody(request, 3 * 1024 * 1024)).toString("utf8")); } catch (error) { json(response, error.status || 400, { error: error.message || "Invalid runtime task." }); return; } await scheduleTask(response, body); return; }
  const prefix = Object.keys(upstreams).find((value) => pathname === value || pathname.startsWith(`${value}/`));
  if (prefix) { await proxy(request, response, upstreams[prefix], request.url.slice(prefix.length) || "/"); return; }
  const target = normalize(join(root, pathname === "/" ? "index.html" : pathname.slice(1)));
  if (!target.startsWith(root)) { response.writeHead(403).end("Forbidden"); return; }
  try {
    if (!(await stat(target)).isFile()) throw new Error("not file");
    response.writeHead(200, { "content-type": types[extname(target)] || "application/octet-stream", "cache-control": "no-store", "content-security-policy": "default-src 'self'; connect-src 'self' http://127.0.0.1:* https:; style-src 'self'; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff" });
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
  }else if(body.task==="check"){
    const files=(await collectFiles(project)).filter((path)=>/\.(?:js|mjs|cjs)$/.test(path)&&!path.includes(`${join(project,"node_modules")}/`)).slice(0,128);if(!files.length)throw Object.assign(new Error("No JavaScript files were found to check."),{code:"check_files_missing"});let output="";for(const file of files){const result=await executeBounded(project,["--check",file],false);output+=result.output;if(result.code!==0)return{...result,task:"check",workspace:keyFor(project)};}return{ok:true,code:0,task:"check",workspace:keyFor(project),output:output||`Checked ${files.length} JavaScript files.\n`};
  }else throw Object.assign(new Error("Only install, test, and check tasks are allowlisted."),{code:"command_not_allowed"});
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
