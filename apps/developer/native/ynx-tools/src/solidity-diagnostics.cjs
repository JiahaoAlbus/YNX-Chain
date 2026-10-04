const path = require('node:path');
const {digest,assertWorkspacePath,assertWorkspaceDirectory}=require('./guards.cjs');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.sort().join();
const validPath=name=>typeof name==='string'&&name.length<=240&&name.endsWith('.sol')&&!/[\\:\u0000-\u001f\u007f]/.test(name)&&!name.startsWith('/')&&!name.split('/').some(part=>!part||part==='.'||part==='..');
function byteOffset(content,offset){
 const bytes=Buffer.from(content);if(!Number.isSafeInteger(offset)||offset<0||offset>bytes.length||(offset<bytes.length&&(bytes[offset]&0xc0)===0x80))throw Error('A compiler source location is invalid.');
 return bytes.subarray(0,offset).toString('utf8').length;
}
function parseDiagnostics(text,sessionId){
 if(typeof text!=='string'||Buffer.byteLength(text)>4*1024*1024)throw Error('Copy a smaller compiler diagnostics review from YNX Tools.');
 let value;try{value=JSON.parse(text);}catch{throw Error('Copy compiler diagnostics from YNX Tools first.');}
 const s=value?.snapshot;
 if(!exact(value,['protocol','snapshot','diagnostics'])||value.protocol!=='ynx-solidity-diagnostics/v1'||!exact(s,['protocol','sessionId','entryPath','sources'])||s.protocol!=='ynx-solidity-project/v1'||!sessionId||s.sessionId!==sessionId||!validPath(s.entryPath)||!s.sources||typeof s.sources!=='object'||Array.isArray(s.sources)||!Array.isArray(value.diagnostics)||value.diagnostics.length>256)throw Error('Use compiler diagnostics from this editor project session.');
 const sources=Object.entries(s.sources);if(!sources.length||sources.length>32||!Object.hasOwn(s.sources,s.entryPath))throw Error('The compiler source review is invalid.');
 let total=0;
 for(const [name,row]of sources){if(!validPath(name)||!exact(row,['content','sha256','documentVersion'])||typeof row.content!=='string'||Buffer.byteLength(row.content)>65536||(total+=Buffer.byteLength(row.content))>262144||!Number.isSafeInteger(row.documentVersion)||row.documentVersion<0||digest(row.content)!==row.sha256)throw Error('The compiler source review changed or exceeds its limits.');}
 for(const d of value.diagnostics){
  if(!exact(d,['file','start','end','severity','message','code'])||!validPath(d.file)||!Object.hasOwn(s.sources,d.file)||!['error','warning','info'].includes(d.severity)||typeof d.message!=='string'||!d.message.length||Buffer.byteLength(d.message)>8192||typeof d.code!=='string'||!/^\d{0,12}$/.test(d.code)||!Number.isSafeInteger(d.start)||!Number.isSafeInteger(d.end))throw Error('A compiler diagnostic is invalid.');
  if(d.start===-1&&d.end===-1)continue;
  if(d.end<d.start)throw Error('A compiler source location is invalid.');byteOffset(s.sources[d.file].content,d.start);byteOffset(s.sources[d.file].content,d.end);
 }
 return value;
}
function createSolidityDiagnostics(vscode,context,environment){
 const collection=vscode.languages.createDiagnosticCollection('YNX Solidity');let epoch=0,tracked=new Set(),binding;
 function clear(){epoch++;tracked=new Set();binding=undefined;collection.clear();}
 function changed(document){epoch++;if(tracked.has(document.uri.toString())){tracked=new Set();binding=undefined;collection.clear();}}
 context.subscriptions.push(collection,vscode.workspace.onDidChangeTextDocument(event=>changed(event.document)),vscode.workspace.onDidCloseTextDocument(changed),vscode.workspace.onDidChangeWorkspaceFolders(clear),vscode.window.onDidChangeActiveTextEditor(()=>{if(binding&&(binding.sessionId!==environment.YNX_CORE_SESSION_ID||binding.workspace!==environment.YNX_CORE_WORKSPACE))clear();}),{dispose:()=>{epoch++;}});
 async function importCopied(){
  const captured=++epoch,sessionId=environment.YNX_CORE_SESSION_ID,workspace=environment.YNX_CORE_WORKSPACE,folders=vscode.workspace.workspaceFolders;
  if(!/^[a-f0-9-]{36}$/.test(sessionId||'')||!workspace||folders?.length!==1)throw Error('Open one active YNX project before importing compiler diagnostics.');
  const root=folders[0].uri,rootKey=root.toString();
  const assertCurrent=()=>{if(captured!==epoch||sessionId!==environment.YNX_CORE_SESSION_ID||workspace!==environment.YNX_CORE_WORKSPACE||vscode.workspace.workspaceFolders?.length!==1||vscode.workspace.workspaceFolders[0].uri.toString()!==rootKey)throw Error('The project changed while importing diagnostics. Compile its current sources again.');};
  let text;try{text=await vscode.env.clipboard.readText();}catch{throw Error('Clipboard access is unavailable. Copy compiler diagnostics from YNX Tools first.');}assertCurrent();
  const value=parseDiagnostics(text,sessionId),directory=await assertWorkspaceDirectory(root.fsPath,workspace);assertCurrent();if(directory.realDirectory!==directory.realWorkspace)throw Error('Open the admitted project root before importing diagnostics.');
  const documents=new Map(),locations=new Map();
  for(const [name,row]of Object.entries(value.snapshot.sources)){
   const uri=vscode.Uri.file(path.join(root.fsPath,...name.split('/'))),location=await assertWorkspacePath(uri.fsPath,workspace);assertCurrent();
   const document=await vscode.workspace.openTextDocument(uri);assertCurrent();
   if(document.isClosed||document.version!==row.documentVersion||digest(document.getText())!==row.sha256)throw Error('A compiled source changed. Compile the current editor project again.');
   documents.set(name,document);locations.set(name,location);
  }
  const assertDocuments=()=>{for(const [name,document]of documents){const row=value.snapshot.sources[name],current=vscode.workspace.textDocuments.find(d=>d.uri.toString()===document.uri.toString());if(current!==document||document.isClosed||document.version!==row.documentVersion||digest(document.getText())!==row.sha256)throw Error('A compiled source changed. Compile the current editor project again.');}};
  const rows=new Map([...documents].map(([name,document])=>[name,[document.uri,[]]]));
  for(const d of value.diagnostics){const document=documents.get(d.file),content=value.snapshot.sources[d.file].content,start=d.start===-1?0:byteOffset(content,d.start),end=d.end===-1?0:byteOffset(content,d.end);const diagnostic=new vscode.Diagnostic(new vscode.Range(document.positionAt(start),document.positionAt(end)),d.message,{error:vscode.DiagnosticSeverity.Error,warning:vscode.DiagnosticSeverity.Warning,info:vscode.DiagnosticSeverity.Information}[d.severity]);diagnostic.source='YNX Solidity';if(d.code)diagnostic.code=d.code;rows.get(d.file)[1].push(diagnostic);}
  for(const [name,document]of documents){const current=await assertWorkspacePath(document.uri.fsPath,workspace),reviewed=locations.get(name);assertCurrent();if(current.realWorkspace!==reviewed.realWorkspace||current.realFile!==reviewed.realFile)throw Error('A compiled source path changed. Compile the project again.');}
  assertCurrent();assertDocuments();
  collection.set([...rows.values()]);tracked=new Set([...documents.values()].map(document=>document.uri.toString()));binding={sessionId,workspace};
  return value.diagnostics.length;
 }
 return {importCopied};
}
module.exports={parseDiagnostics,byteOffset,createSolidityDiagnostics};
