const { randomUUID } = require('node:crypto');
const { createChainProject } = require('./chain-project.cjs');
const CHAIN_PROJECT_TRANSLATIONS = Object.freeze({
  'Chain project tools':'项目 Chain 工具',
  'Open a local project to configure its Chain tools.':'请打开本地项目以配置 Chain 工具。',
  'Read transport not connected':'只读通道未连接',
  'Configure Chain for this project':'配置当前项目 Chain',
  'Local; no node or network is started':'本地；不会启动节点或网络',
  'YNX Testnet · 6423 · YNXT':'YNX 测试网 · 6423 · YNXT',
  'Configuration does not authorize a connection':'配置不授予连接权限',
  'Create public Chain configuration in this project? No credentials are stored and no request is sent.':'在当前项目中创建公开 Chain 配置？不会存储凭据或发送请求。',
  'Create configuration':'创建配置',
  'Existing Chain configuration was preserved. Edit it explicitly if needed.':'现有 Chain 配置已保留。如需修改，请明确编辑该文件。',
  'Inspect network identity':'查询网络身份',
  'Inspect contract capabilities':'查询合约能力',
  'Read account balance':'读取账户余额',
  'Query a transaction':'查询一笔交易',
  'Remember a transaction reference':'记录交易查询引用',
  'Open saved observations':'打开已保存的观察结果',
  'Approved identity and read transport are not connected; no requests are sent.':'获准身份和只读通道尚未接通；不会发送请求。',
  'Local configuration is editable data, not identity or connection permission.':'本地配置是可编辑数据，不是身份或连接权限。',
  'Account address (public; no private key)':'账户地址（公开信息，不是私钥）',
  'Transaction hash (query reference only)':'交易哈希（仅作为查询引用）',
  'Read-only Chain query':'Chain 只读查询',
  'Approve one read':'批准本次只读查询',
  'Read {0} for this project using {1}? This cannot sign, deploy or submit a transaction.':'通过 {1} 为当前项目读取 {0}？此操作不能签名、部署或提交交易。',
  'No saved Chain observations for this project.':'当前项目尚无保存的 Chain 观察结果。',
  'Open saved observation':'打开保存的观察结果',
  'Query the same reference again':'重新查询同一引用',
  'Saved observation; not current chain proof':'保存的观察结果；不是当前链状态证明',
  'Local history files are editable. Their contents never authorize a connection or prove this project deployed a contract.':'本地历史文件可编辑，其内容不能授予连接权限，也不能证明当前项目部署过合约。',
  'Recorded a query reference only. No transaction was submitted by the IDE.':'仅记录了查询引用，IDE 未提交任何交易。',
  'Chain query failed. Existing project data is preserved.':'Chain 查询失败，现有项目数据已保留。',
  'The approved Chain identity and read transport are not connected. No request was sent.':'获准的 Chain 身份和只读通道尚未接通，未发送请求。',
  'The local project changed. Reopen its Chain tools.':'本地项目已变化，请重新打开 Chain 工具。',
  'Choose Local or YNX Testnet.':'请选择本地或 YNX 测试网。',
  'The Chain project configuration is invalid. Existing files are preserved.':'Chain 项目配置无效，现有文件已保留。',
  'Choose a supported read-only Chain action.':'请选择受支持的 Chain 只读操作。',
  'Enter a 0x-prefixed 32-byte transaction hash.':'请输入以 0x 开头的 32 字节交易哈希。',
  'Enter a 0x-prefixed 20-byte account address.':'请输入以 0x 开头的 20 字节账户地址。',
  'Open the canonical local project root.':'请打开本地项目的真实根目录。',
  'The local project directory changed.':'本地项目目录已变化。',
  'Chain project storage cannot use symbolic links.':'Chain 项目存储不能使用符号链接。',
  'Chain project data exceeds its file boundary.':'Chain 项目数据超过文件边界。',
  'Chain project data is damaged. The existing file was preserved.':'Chain 项目数据已损坏，现有文件已保留。',
  'The Chain observation exceeds 256 KiB.':'Chain 观察结果超过 256 KiB。',
  'Trust this local project before adding Chain configuration.':'添加 Chain 配置前，请信任当前本地项目。',
  'The Chain configuration is already open. Preserve its editor contents.':'Chain 配置已打开，请保留编辑器中的内容。',
  'The Chain history exceeds 128 records. Existing records are preserved.':'Chain 历史超过 128 条，现有记录已保留。',
  'Saved Chain history does not match this local project. The file was preserved.':'保存的 Chain 历史不属于当前本地项目，文件已保留。',
  'Trust this local project before recording Chain results.':'记录 Chain 结果前，请信任当前本地项目。',
  'A Chain read is already running for this project.':'当前项目已有正在进行的 Chain 只读查询。',
  'Trust this local project before querying Chain services.':'查询 Chain 服务前，请信任当前本地项目。',
  'Configure YNX Testnet for this project before querying.':'查询前，请为当前项目配置 YNX 测试网。',
  'The Chain read was cancelled or timed out. No result was saved.':'Chain 查询已取消或超时，未保存结果。',
  'The approved Chain connection does not match this project.':'获准的 Chain 连接不属于当前项目。',
  'Project trust was revoked during the Chain read.':'Chain 查询期间，项目的信任已被撤销。',
  'Chain configuration changed. Approve a new read.':'Chain 配置已变化，请重新批准查询。',
  'The approved Chain identity changed or expired.':'获准的 Chain 身份已变化或过期。',
  'Connected endpoint is not the canonical YNX Testnet.':'连接的服务不是正确的 YNX 测试网。',
  'Saved query reference has no chain evidence yet':'保存的查询引用尚无链观察结果',
  'Execution, indexing and source verification remain separate':'执行、索引和源码验证是独立状态',
});
function createChainProjectUI(vscode,context,environment,t,options={}) {
  const project=createChainProject(vscode,environment,options),previews=new Map();let busy=false;
  context.subscriptions.push({dispose(){project.dispose();previews.clear();}});
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('ynx-chain-observation',{
    provideTextDocumentContent:uri=>{const value=previews.get(uri.toString());if(value===undefined)throw Error(t('Chain query failed. Existing project data is preserved.'));return value;},
  }));
  async function display(record) {
    if(previews.size>=128)previews.delete(previews.keys().next().value);
    const uri=vscode.Uri.parse(`ynx-chain-observation:/${randomUUID()}/observation.json`);
    const content={notice:t('Saved observation; not current chain proof'),boundary:t('Local history files are editable. Their contents never authorize a connection or prove this project deployed a contract.'),
      transactionMeaning:record.evidence?t('Execution, indexing and source verification remain separate'):t('Saved query reference has no chain evidence yet'),...record};
    previews.set(uri.toString(),JSON.stringify(content,null,2));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri),{preview:false});
  }
  async function configure() {
    const existing=await project.configuration();
    if(!existing){
      const selected=await vscode.window.showQuickPick([{label:t('Local; no node or network is started'),environment:'local'},
        {label:t('YNX Testnet · 6423 · YNXT'),description:t('Configuration does not authorize a connection'),environment:'testnet'}],{title:t('Configure Chain for this project'),ignoreFocusOut:true});
      if(!selected)return;
      if(await vscode.window.showInformationMessage(t('Create public Chain configuration in this project? No credentials are stored and no request is sent.'),{modal:true},t('Create configuration'))!==t('Create configuration'))return;
      await project.configure(selected.environment);
    }else void vscode.window.showInformationMessage(t('Existing Chain configuration was preserved. Edit it explicitly if needed.'));
    const scope=await project.scope();await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(require('node:path').join(scope.workspace,'ynx-chain-project.json'))));
  }
  async function read(operation) {
    return vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:t('Read-only Chain query'),cancellable:true},async(progress,token)=>{
      const controller=new AbortController(),cancel=token.onCancellationRequested(()=>controller.abort());if(token.isCancellationRequested)controller.abort();
      try {const record=await project.query(operation,async approved=>await vscode.window.showWarningMessage(t('Read {0} for this project using {1}? This cannot sign, deploy or submit a transaction.',approved.operation.kind,approved.service),{modal:true},t('Approve one read'))===t('Approve one read'),{signal:controller.signal});if(record){options.onObservationSaved?.();await display(record);}}
      finally {cancel.dispose();}
    });
  }
  async function input(kind) {
    const key=kind==='balance'?'Account address (public; no private key)':'Transaction hash (query reference only)';
    const value=await vscode.window.showInputBox({title:t(key),ignoreFocusOut:true,validateInput:text=>(kind==='balance'?/^0x[0-9a-fA-F]{40}$/:/^0x[0-9a-fA-F]{64}$/).test(text)?undefined:t(kind==='balance'?'Enter a 0x-prefixed 20-byte account address.':'Enter a 0x-prefixed 32-byte transaction hash.')});
    if(value===undefined)return;
    if(kind==='track'){const record=await project.trackTransaction(value);options.onObservationSaved?.();void vscode.window.showInformationMessage(t('Recorded a query reference only. No transaction was submitted by the IDE.'));return display(record);}
    return read(kind==='balance'?{kind,address:value}:{kind:'transaction',hash:value});
  }
  async function saved() {
    const records=await project.history();if(!records.length){void vscode.window.showInformationMessage(t('No saved Chain observations for this project.'));return;}
    const selected=await vscode.window.showQuickPick(records.map(record=>({label:record.operation.hash||record.operation.address||record.operation.kind,description:record.savedAt,record})),{title:t('Open saved observations'),ignoreFocusOut:true});if(!selected)return;
    const action=await vscode.window.showQuickPick([{label:t('Open saved observation'),action:'open'},{label:t('Query the same reference again'),action:'query'}],{title:t('Saved observation; not current chain proof'),ignoreFocusOut:true});if(!action)return;
    await project.scope();if(action.action==='open')return display(selected.record);return read(selected.record.operation);
  }
  async function guarded(action) {
    if(busy)return;busy=true;
    try {await action();}catch(error){
      // Do not print raw upstream errors, URLs, headers or credential material.
      const text=error.code?.startsWith('chain_')&&Object.hasOwn(CHAIN_PROJECT_TRANSLATIONS,error.message)?error.message:'Chain query failed. Existing project data is preserved.';
      void vscode.window.showErrorMessage(t(text));
    }finally{busy=false;}
  }
  async function open() {
    await project.scope();
    const selected=await vscode.window.showQuickPick([
      {label:t('Configure Chain for this project'),action:'configure'},
      {label:t('Inspect network identity'),action:'status'},
      {label:t('Inspect contract capabilities'),action:'compiler'},
      {label:t('Read account balance'),action:'balance'},
      {label:t('Query a transaction'),action:'transaction'},
      {label:t('Remember a transaction reference'),action:'track'},
      {label:t('Open saved observations'),action:'saved'},
    ],{title:t('Chain project tools'),ignoreFocusOut:true,placeHolder:project.admissionAvailable()?t('Local configuration is editable data, not identity or connection permission.'):t('Approved identity and read transport are not connected; no requests are sent.')});
    if(!selected)return;
    if(selected.action==='configure')return configure();if(selected.action==='saved')return saved();
    if(['balance','transaction','track'].includes(selected.action))return input(selected.action);
    return read({kind:selected.action});
  }
  async function openObservation(reference) {
    const scope=await project.scope();
    if(!reference || reference.projectId!==scope.projectId || reference.workspace!==scope.workspace ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(reference.id||''))
      throw Error(t('The local project changed. Reopen its Chain tools.'));
    // Reload validated disk history; callers cannot supply evidence or paths.
    const record=(await project.history()).find(row=>row.id===reference.id);
    await project.scope();
    if(!record)throw Error(t('Chain query failed. Existing project data is preserved.'));
    return display(record);
  }
  return {open:()=>guarded(open),configure:()=>guarded(configure),saved:()=>guarded(saved),track:()=>guarded(()=>input('track')),
    observations:()=>project.history(),openObservation:reference=>guarded(()=>openObservation(reference))};
}
module.exports={createChainProjectUI,CHAIN_PROJECT_TRANSLATIONS};
