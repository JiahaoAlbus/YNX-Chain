const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const PROTOCOL = 'ynx-code-chain/v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const MAX_RECORD = 256 * 1024, MAX_HISTORY = 128;
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = (message, code) => Object.assign(new Error(message), { code });
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === keys.sort().join();
function projectConfiguration(environment) {
  if (!['local', 'testnet'].includes(environment)) throw fail('Choose Local or YNX Testnet.', 'chain_configuration_invalid');
  return { schemaVersion: 1, environment, readContract: PROTOCOL,
    network: environment === 'testnet' ? { name: 'YNX Testnet', chainId: 6423, nativeCurrency: 'YNXT',
      endpoints: { rest: 'https://rpc.ynxweb4.com/', evm: 'https://rpc.ynxweb4.com/evm', nativeRpc: null, webSocket: null, explorer: null } } : null };
}
function validateConfiguration(value) {
  // Compare semantic objects, so normal formatting/key order remains editable.
  if (!exact(value, ['schemaVersion','environment','readContract','network']) || value.schemaVersion !== 1 || value.readContract !== PROTOCOL ||
      !['local','testnet'].includes(value.environment) || JSON.stringify(sort(value.network)) !== JSON.stringify(sort(projectConfiguration(value.environment).network)))
    throw fail('The Chain project configuration is invalid. Existing files are preserved.', 'chain_configuration_invalid');
  return value;
}
function sort(value) { return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])) : value; }
function validateOperation(operation) {
  if (!operation || !['status','compiler','balance','transaction'].includes(operation.kind) ||
      !exact(operation, operation.kind === 'balance' ? ['kind','address'] : operation.kind === 'transaction' ? ['kind','hash'] : ['kind']))
    throw fail('Choose a supported read-only Chain action.', 'chain_action_invalid');
  if (operation.kind === 'transaction' && !HASH.test(operation.hash || '')) throw fail('Enter a 0x-prefixed 32-byte transaction hash.', 'chain_hash_invalid');
  if (operation.kind === 'balance' && !/^0x[0-9a-fA-F]{40}$/.test(operation.address || '')) throw fail('Enter a 0x-prefixed 20-byte account address.', 'chain_address_invalid');
}
function createChainProject(vscode, environment, { connectionForProject } = {}) {
  const root = environment.YNX_LOCAL_WORKSPACE, projectId = environment.YNX_LOCAL_PROJECT_ID;
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri, folderKey = folder?.toString();
  let rootIdentity, disposed = false, active;
  const controllers = new Set();
  function assertRuntime() {
    if (disposed || environment.YNX_WORKSPACE_MODE !== 'local' || !UUID.test(projectId || '') || !path.isAbsolute(root || '') ||
        environment.YNX_LOCAL_WORKSPACE !== root || environment.YNX_LOCAL_PROJECT_ID !== projectId || environment.YNX_CORE_SESSION_ID || environment.YNX_CORE_WORKSPACE ||
        folder?.scheme !== 'file' || vscode.workspace.workspaceFolders?.length !== 1 || vscode.workspace.workspaceFolders[0].uri.toString() !== folderKey)
      throw fail('The local project changed. Reopen its Chain tools.', 'chain_project_changed');
  }
  async function scope() {
    assertRuntime();
    if (await fs.realpath(root) !== root || folder.fsPath !== root) throw fail('Open the canonical local project root.', 'chain_project_changed');
    const stat = await fs.lstat(root), identity = `${stat.dev}:${stat.ino}`;
    if (!stat.isDirectory() || stat.isSymbolicLink() || (rootIdentity && rootIdentity !== identity)) throw fail('The local project directory changed.', 'chain_project_changed');
    rootIdentity ||= identity; assertRuntime();
    return { projectId, workspace: root };
  }
  async function directory(parts, create = false) {
    await scope(); let current = root;
    for (const part of parts) {
      current = path.join(current, part);
      if (create) { try { await fs.mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(current) !== current) throw fail('Chain project storage cannot use symbolic links.', 'chain_storage_path_invalid');
    }
    await scope(); return current;
  }
  async function readJson(file, limit) {
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit) throw fail('Chain project data exceeds its file boundary.', 'chain_storage_invalid');
      const raw = await handle.readFile(); if (raw.length > limit) throw fail('Chain project data exceeds its file boundary.', 'chain_storage_invalid');
      let value; try { value = JSON.parse(raw.toString('utf8')); } catch { throw fail('Chain project data is damaged. The existing file was preserved.', 'chain_storage_invalid'); }
      return { value, digest: sha(raw) };
    } finally { await handle.close(); }
  }
  async function configuration() {
    await scope();
    if (vscode.workspace.textDocuments.some(doc=>!doc.isClosed&&doc.isDirty&&doc.uri.scheme==='file'&&doc.uri.fsPath===path.join(root,'ynx-chain-project.json')))
      throw fail('The Chain configuration is already open. Preserve its editor contents.', 'chain_configuration_open');
    try { const record = await readJson(path.join(root,'ynx-chain-project.json'), 8192); validateConfiguration(record.value); await scope(); return record; }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function publish(file, value, verify = async()=>scope()) {
    const raw = JSON.stringify(value,null,2)+'\n'; if (Buffer.byteLength(raw) > MAX_RECORD) throw fail('The Chain observation exceeds 256 KiB.', 'chain_result_too_large');
    const temp = path.join(path.dirname(file), `.chain-${randomUUID()}.tmp`); let handle;
    try {
      handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(raw); await handle.sync(); await handle.close(); handle=undefined;
      await verify();
      // A hard-link publish is atomic and cannot overwrite user data or another writer.
      await fs.link(temp,file); await fs.unlink(temp);
    } finally { if(handle)await handle.close(); await fs.unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;}); }
  }
  async function configure(selected) {
    await scope(); const existing = await configuration(); if (existing) return { created:false, configuration:existing.value };
    if (vscode.workspace.isTrusted !== true) throw fail('Trust this local project before adding Chain configuration.', 'chain_project_untrusted');
    const value = projectConfiguration(selected);
    const file = path.join(root,'ynx-chain-project.json');
    if (vscode.workspace.textDocuments.some(doc=>!doc.isClosed&&doc.uri.scheme==='file'&&doc.uri.fsPath===file)) throw fail('The Chain configuration is already open. Preserve its editor contents.', 'chain_configuration_open');
    await publish(file,value); return { created:true,configuration:value };
  }
  async function history() {
    await scope(); let dir;
    try { dir=await directory(['.ynx','chain-history']); } catch(error) { if(error.code==='ENOENT')return [];throw error; }
    const names=(await fs.readdir(dir)).filter(name=>UUID.test(name.slice(0,-5))&&name.endsWith('.json'));
    if(names.length>MAX_HISTORY)throw fail('The Chain history exceeds 128 records. Existing records are preserved.', 'chain_history_full');
    const records=[];
    for(const name of names) {
      const {value}=await readJson(path.join(dir,name),MAX_RECORD);
      if(!exact(value,['schemaVersion','id','projectId','workspace','savedAt','operation','evidence','source','submittedByIDE'])||value.schemaVersion!==1||value.id+'.json'!==name||value.projectId!==projectId||value.workspace!==root||!Number.isFinite(Date.parse(value.savedAt))||value.submittedByIDE!==false)
        throw fail('Saved Chain history does not match this local project. The file was preserved.', 'chain_history_project_mismatch');
      validateOperation(value.operation); records.push(value);
    }
    await scope();return records.sort((a,b)=>a.savedAt.localeCompare(b.savedAt));
  }
  async function saveRecord(operation,evidence,source,verify) {
    await history(); const dir=await directory(['.ynx','chain-history'],true);
    if((await history()).length>=MAX_HISTORY)throw fail('The Chain history exceeds 128 records. Existing records are preserved.', 'chain_history_full');
    const id=randomUUID(),record={schemaVersion:1,id,projectId,workspace:root,savedAt:new Date().toISOString(),operation,evidence,source,submittedByIDE:false};
    await publish(path.join(dir,id+'.json'),record,async()=>{await directory(['.ynx','chain-history']);await verify();});return record;
  }
  async function trackTransaction(hash) {
    validateOperation({kind:'transaction',hash});await scope();
    if(vscode.workspace.isTrusted!==true)throw fail('Trust this local project before recording Chain results.', 'chain_project_untrusted');
    return saveRecord({kind:'transaction',hash},null,{kind:'user-supplied-query-reference',verified:false},scope);
  }
  async function query(operation,approve,{signal}={}) {
    validateOperation(operation);await scope();
    if(active)throw fail('A Chain read is already running for this project.', 'chain_read_busy');
    if(vscode.workspace.isTrusted!==true)throw fail('Trust this local project before querying Chain services.', 'chain_project_untrusted');
    const config=await configuration();if(!config||config.value.environment!=='testnet')throw fail('Configure YNX Testnet for this project before querying.', 'chain_configuration_required');
    if(typeof connectionForProject!=='function')throw fail('The approved Chain identity and read transport are not connected. No request was sent.', 'chain_admission_unavailable');
    const controller=new AbortController(); controllers.add(controller); active=controller;
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const timer=setTimeout(abort,15000);
    function cancelled(){if(controller.signal.aborted)throw fail('The Chain read was cancelled or timed out. No result was saved.', 'chain_read_cancelled');}
    try {
      // Supplied only by trusted application code, never read from project JSON,
      // environment credentials, a discovered command, endpoint or user module.
      const connection=await race(connectionForProject(await scope(),{signal:controller.signal}),controller.signal);cancelled();
      // service is a source label, not an endpoint or network permission. This
      // module cannot fetch it; the admitted owner supplies the shared reader.
      const publicRead=connection?.protocolVersion==='ynx-code-chain-public/v1'&&connection.access==='public-read';
      if(!connection||!(connection.protocolVersion===PROTOCOL&&!connection.access||publicRead)||connection.projectId!==projectId||connection.workspace!==root||!connection.reader||typeof connection.assertCurrent!=='function'||typeof connection.sourceVersion!=='string'||!connection.sourceVersion||connection.sourceVersion.length>160||typeof connection.service!=='string'||!/^https:\/\/developer\.ynxweb4\.com\/runtime\/chain$/.test(connection.service))
        throw fail('The approved Chain connection does not match this project.', 'chain_admission_mismatch');
      const check=async()=>{cancelled();await scope();if(vscode.workspace.isTrusted!==true)throw fail('Project trust was revoked during the Chain read.', 'chain_project_untrusted');
        if((await configuration())?.digest!==config.digest)throw fail('Chain configuration changed. Approve a new read.', 'chain_configuration_changed');
        const current=await race(connection.assertCurrent(),controller.signal);
        // Reuse the owner's assertion semantics: void success or explicit true.
        // false/null/other values reject; local IDs never supply a session.
        if(current!==true&&current!==undefined)throw fail('The approved Chain identity changed or expired.', 'chain_identity_changed');cancelled();};
      await check();
      const approved=await race(Promise.resolve(approve({operation,projectId,workspace:root,service:connection.service,sourceVersion:connection.sourceVersion})),controller.signal);
      if(approved!==true)return null;await check();
      // The shared reader preserves status/capability/receipt contract checks.
      const reader=connection.reader;
      const status=await race(reader.status({signal:controller.signal}),controller.signal);await check();
      if(!status||Number(status.chainId)!==6423||status.nativeCurrencySymbol!=='YNXT'||status.network!=='YNX Testnet'||status.publicNetwork!==true)throw fail('Connected endpoint is not the canonical YNX Testnet.', 'chain_identity_mismatch');
      let evidence=status;
      if(operation.kind==='compiler')evidence=await race(reader.compiler({signal:controller.signal}),controller.signal);
      if(operation.kind==='balance')evidence={address:operation.address,value:await race(reader.rpc('eth_getBalance',[operation.address,'latest'],{signal:controller.signal}),controller.signal),unit:'base-unit',symbol:'YNXT'};
      if(operation.kind==='transaction')evidence=await race(reader.transaction(operation.hash,{signal:controller.signal}),controller.signal);
      await check();
      return await saveRecord(operation,evidence,{kind:publicRead?'public-chain-read':'admitted-chain-read',protocolVersion:connection.protocolVersion,service:connection.service,sourceVersion:connection.sourceVersion,...publicRead?{access:'public-read',rest:'https://rpc.ynxweb4.com',evm:'https://evm.ynxweb4.com'}:{},networkCheckedAt:new Date().toISOString()},check);
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);controllers.delete(controller);if(active===controller)active=undefined;}
  }
  return {configuration,configure,history,trackTransaction,query,scope,
    admissionAvailable:()=>typeof connectionForProject==='function',
    dispose(){disposed=true;for(const controller of controllers)controller.abort();}};
}
function race(value,signal){if(signal.aborted)return Promise.reject(fail('The Chain read was cancelled or timed out. No result was saved.','chain_read_cancelled'));return new Promise((resolve,reject)=>{const abort=()=>{cleanup();reject(fail('The Chain read was cancelled or timed out. No result was saved.','chain_read_cancelled'));},cleanup=()=>signal.removeEventListener('abort',abort);signal.addEventListener('abort',abort,{once:true});Promise.resolve(value).then(result=>{cleanup();resolve(result);},error=>{cleanup();reject(error);});});}
module.exports={createChainProject,projectConfiguration,PROTOCOL};
