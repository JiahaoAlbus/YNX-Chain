// Presentation fields only. Main's original SDK is the sole action validator,
// canonical encoder and signer. This form never supplies owner/nonce/policy.
const row=(kind,label,fee,fields,unavailable=null)=>Object.freeze({kind,label,fee,fields:Object.freeze(fields.split(' ').filter(Boolean)),unavailable});
export const PQ_TYPED_ACTION_FORM=Object.freeze([
 row('stake','质押 / Stake','0','amount'),
 row('resource_delegation_create','资源委托 / Resource delegation','0','provider beneficiary amountYNXT policyHash idempotencyKey requestHash'),
 row('resource_rental_create','资源租赁 / Resource rental','0','address provider bandwidth compute aiCredits trustCredits quoteID quoteExpiresAt policyHash maxPriceYNXT idempotencyKey requestHash'),
 row('dex_asset_create','创建原生资产 / Create native asset','1','assetID symbol name decimals maxSupply initialSupply'),
 row('dex_asset_mint','增发原生资产 / Mint native asset','1','assetID amount'),
 row('dex_asset_transfer','转移原生资产 / Transfer native asset','1','assetID recipient amount'),
 row('dex_pool_create','创建原生交易池 / Create native pool','1','poolID asset0 asset1 feeBps'),
 row('dex_liquidity_add','增加流动性 / Add liquidity','1','poolID amount0 amount1 minShares deadlineUnix'),
 row('dex_liquidity_remove','移除流动性 / Remove liquidity','1','poolID shares minAmount0 minAmount1 deadlineUnix'),
 row('dex_swap_exact_input','按输入兑换 / Exact input swap','1','poolID assetIn amountIn minAmountOut deadlineUnix'),
 row('dex_swap_exact_output','按输出兑换 / Exact output swap','1','poolID assetOut amountOut maxAmountIn deadlineUnix'),
 row('contract_execute','调用已支持示例合约 / Execute supported sample contract','2','name target sourceHash deployedBytecodeHash compilerConfigHash expectedStorageCommitment calldata value'),
 row('contract_deploy','部署合约 / Deploy contract','10','','等待完整部署材料编码 / Original deployment material required'),
 row('stake_delegate','委托验证者 / Delegate validator','1','','等待原质押凭据 / Original staking witness required'),
 row('stake_unbond','解除委托 / Unbond','1','','等待原质押凭据 / Original staking witness required'),
 row('stake_withdraw','提取质押 / Withdraw stake','1','','等待原质押凭据 / Original staking witness required'),
]);
const labels={amount:'金额（整数 YNXT 或资产原子单位） / Amount (whole YNXT or asset base units)',amountYNXT:'整数 YNXT / Whole YNXT',provider:'提供方 / Provider',beneficiary:'受益方 / Beneficiary',address:'租赁账户 / Rental account',name:'名称 / Name',decimals:'精度（0–18） / Decimals',feeBps:'费用基点（1–1000） / Fee basis points',deadlineUnix:'截止时间（Unix 秒） / Deadline (Unix seconds)',quoteExpiresAt:'报价到期时间（UTC） / Quote expiry (UTC)',value:'原生附带金额（当前必须为 0） / Native value (must be 0)'};
export function createPQTypedActionReviewUI({api,getKeyState,document:doc=document}){
 const details=doc.createElement('details'),summary=doc.createElement('summary'),help=doc.createElement('p'),form=doc.createElement('form'),selector=doc.createElement('select'),kindLabel=doc.createElement('label'),fields=doc.createElement('div'),fee=doc.createElement('p'),button=doc.createElement('button'),result=doc.createElement('p');
 details.id='pq-typed-action-panel';summary.textContent='高级 YNX 原生操作（PQ） / Advanced YNX native actions (PQ)';
 help.textContent='YNX Testnet：此处只准备完整签名审查，不自动签名或发送。提交需要另行批准；合约调用仅支持既有示例类型。 / Prepare a full signing review only. Broadcast requires separate approval; contract execution is limited to supported samples.';
 selector.id='pq-typed-action-kind';kindLabel.setAttribute('for',selector.id);kindLabel.textContent='操作类型 / Action';
 for(const spec of PQ_TYPED_ACTION_FORM){const option=doc.createElement('option');option.value=spec.kind;option.disabled=!!spec.unavailable;option.textContent=spec.label+(spec.unavailable?' — '+spec.unavailable:'');selector.append(option);}
 selector.value='stake';button.type='submit';button.disabled=true;button.textContent='审查原操作（仅签名并本地保存） / Review action (sign and save only)';result.setAttribute('role','status');
 form.append(kindLabel,selector,fields,fee,button);details.append(summary,help,form,result);doc.querySelector('#send-sheet').append(details);
 let busy=false,generation=0,inputs=new Map();
 const spec=()=>PQ_TYPED_ACTION_FORM.find(s=>s.kind===selector.value);
 function renderFields(){
  generation++;result.textContent='';fields.replaceChildren();inputs=new Map();const selected=spec();
  fee.textContent=selected?'协议固定费用：'+selected.fee+' YNXT / Fixed protocol fee: '+selected.fee+' YNXT':'';
  for(const name of selected?.fields??[]){
   const contractName=name==='name'&&selected.kind==='contract_execute';
   const label=doc.createElement('label'),input=doc.createElement(contractName?'select':'input');input.id='pq-action-'+name;input.autocomplete='off';input.spellcheck=false;input.required=true;input.maxLength=512;label.setAttribute('for',input.id);label.textContent=labels[name]??name;
   if(contractName){for(const value of ['SampleEVMWriteCounter','SampleYNXTCompatibleERC20']){const option=doc.createElement('option');option.value=value;option.textContent=value;input.append(option);}input.value='SampleEVMWriteCounter';}
   if(name==='value'){input.value='0';input.readOnly=true;}
   input.addEventListener('input',()=>{generation++;result.textContent='';});fields.append(label,input);inputs.set(name,input);
  }
 }
 function render(){const s=getKeyState();button.disabled=busy||s.locked||s.authenticating||!spec()||!!spec().unavailable;selector.disabled=busy;}
 selector.addEventListener('change',()=>{renderFields();render();});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;const before={...getKeyState()},selected=spec(),token=generation;
  if(before.locked||before.authenticating||!selected||selected.unavailable)return;
  const payload={};for(const [name,input]of inputs){const value=input.value.trim();if(!value){result.textContent='请填写全部字段 / Complete all fields.';return;}if(['decimals','feeBps'].includes(name)){if(!/^(0|[1-9][0-9]{0,3})$/.test(value)){result.textContent='请输入规范整数 / Enter canonical integers.';return;}payload[name]=Number(value);}else payload[name]=value;}
  const current=()=>{const s=getKeyState();return token===generation&&s.account===before.account&&s.revision===before.revision&&!s.locked&&!s.authenticating;};
  busy=true;render();
  try{
   const response=await api.preparePQTypedAction({kind:selected.kind,fee:selected.fee,payload});if(!current())return;
   result.textContent=response?.ok===true&&typeof response.value?.requestId==='string'&&response.value.submitted===false?'请在原批准窗口核对操作、费用和全部字段。尚未签名或发送。 / Review all action fields and fees in the original approval window. Nothing signed or sent.':'原操作未获完整审查条件；未自动签名或发送。 / Original action review unavailable; no automatic signature or send.';
  }catch{if(current())result.textContent='审查通道不可用；不自动重试。 / Review unavailable; no automatic retry.';}
  finally{busy=false;render();}
 });
 function invalidate(){generation++;result.textContent='';render();}
 for(const event of ['close','cancel'])doc.querySelector('#send-sheet').addEventListener(event,invalidate);
 renderFields();return Object.freeze({render,invalidate});
}
