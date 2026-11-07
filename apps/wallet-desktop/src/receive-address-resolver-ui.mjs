// Pure production view. Only Main's fixed codec/status API supplies a result.
// Matching a DATA shape here never creates Source/Root or ownership authority.
export function createAddressResolverUI({root,api,getContext,writeClipboard}){
 const doc=root.ownerDocument,translations=new Map(),translatedNodes=new Set();
 const text=(en,cn)=>{const pair=[en,cn];translations.set(en,pair);translations.set(cn,pair);return doc.documentElement?.lang?.startsWith('zh')?cn:en;};
 function refreshLanguage(){for(const node of translatedNodes){const pair=translations.get(node.textContent);if(pair)node.textContent=text(...pair);}}
 const make=(tag,content,cls)=>{const n=doc.createElement(tag);if(tag==='button')n.type='button';if(content){n.textContent=content;if(translations.has(content))translatedNodes.add(n);}if(cls)n.className=cls;return n;};
 root.classList.add('address-resolver-design');
 const title=make('h2',text('Address format conversion','地址格式转换')),description=make('p',text('Look up the supported format for this selected account.','查询当前账户支持的另一种地址格式。'),'resolver-description');
 const label=make('label',text('Address input','地址输入')),input=make('input');input.id='receive-resolver-input';input.autocomplete='off';input.spellcheck=false;label.htmlFor=input.id;
 const status=make('p');translatedNodes.add(status);status.id='receive-resolver-status';status.setAttribute('role','status');input.setAttribute('aria-describedby',status.id);
 const directions=make('div',null,'resolver-directions'),toEVM=make('button','YNX → EVM'),toYNX=make('button','EVM → YNX');directions.append(toEVM,toYNX);
 const result=make('dl',null,'resolver-result'),fields={};for(const [key,en,cn]of [['source','Original address','原始地址'],['target','Target address','目标地址'],['network','Network','网络'],['method','Conversion method','转换方式']]){const row=make('div'),term=make('dt',text(en,cn)),value=make('dd','—');row.append(term,value);result.append(row);fields[key]=value;if(key==='method')translatedNodes.add(value);}
 const actions=make('div',null,'resolver-actions'),query=make('button',text('Look up corresponding address','查询对应地址')),copy=make('button',text('Copy target address','复制目标地址'));query.classList.add('primary');actions.append(query,copy);
 const evidence=make('details',null,'resolver-evidence'),summary=make('summary',text('Technical details and validation','技术详情与校验依据')),explanation=make('p',text('The fixed YNX codec checks the address checksum and round trip. A result is shown only for the same currently selected account. This does not confirm balances, transactions or support on another chain.','固定 YNX 编码器校验地址格式、校验和与往返一致性；仅显示与当前所选账户一致的地址。不代表余额、交易或其他链支持已确认。'));evidence.append(summary,explanation);
 root.append(title,description,label,input,status,directions,result,actions,evidence);let epoch=0,held=null,direction='ynx-to-evm',closed=false;
 const ctx=()=>getContext(),same=(before,token)=>{const now=ctx();return !closed&&token===epoch&&before.open!==false&&now.open!==false&&before.account===now.account&&before.keyRevision===now.keyRevision&&before.networkId===now.networkId;};
 const valid=()=>direction==='ynx-to-evm'?/^ynx1[a-z0-9]{38}$/.test(input.value):/^0x[a-f0-9]{40}$/.test(input.value);
 function invalidate(){epoch++;held=null;copy.disabled=true;fields.target.textContent='—';fields.method.textContent='—';fields.source.textContent=input.value||'—';fields.network.textContent='YNX Testnet';root.dataset.resolverState='idle';root.setAttribute('aria-busy','false');status.textContent=text('Check this address again for the current account.','请重新查询当前账户的对应地址。');}
 function state(kind,message){root.dataset.resolverState=kind;status.textContent=message;input.setAttribute('aria-invalid',String(kind==='invalid'));root.setAttribute('aria-busy',String(kind==='loading'));}
 function edit(){invalidate();if(input.value.startsWith('0x'))direction='evm-to-ynx';else if(input.value.startsWith('ynx1'))direction='ynx-to-evm';updateDirection();query.disabled=!valid();state(input.value&&!valid()?'invalid':'idle',!input.value?text('Enter a complete address.','请输入完整地址。'):valid()?text('Format ready; checksum and account binding require a lookup.','格式待校验；请查询以核对校验和及账户对应关系。'):text('Unrecognized address format. Check the complete address.','无法识别地址格式，请检查完整地址。'));}
 function updateDirection(){toEVM.classList.toggle('primary',direction==='ynx-to-evm');toYNX.classList.toggle('primary',direction==='evm-to-ynx');toEVM.setAttribute('aria-pressed',String(direction==='ynx-to-evm'));toYNX.setAttribute('aria-pressed',String(direction==='evm-to-ynx'));}
 async function resolve(){
  invalidate();if(!valid()){state('invalid',text('Unrecognized address format.','无法识别地址格式。'));return;}
  const token=epoch,before={...ctx()},address=input.value,selectedDirection=direction;query.disabled=true;state('loading',text('Checking the corresponding address…','正在查询对应地址…'));
  try{
   if(typeof api?.resolveReceivingAddress!=='function')throw {code:'RECEIVE_RESOLVER_UNCONFIRMED'};
   const reply=await api.resolveReceivingAddress({address,direction:selectedDirection,networkId:'ynx_6423-1'});if(!same(before,token))return;
   if(reply?.ok!==true)throw reply?.error??{code:'RECEIVE_RESOLVER_UNCONFIRMED'};const v=reply.value;
   if(!v||v.source!==address||v.direction!==selectedDirection||v.networkId!=='ynx_6423-1'||v.method!=='same-account-encoding'||!/^0x[a-f0-9]{40}$/.test(v.canonicalOwner)||!(selectedDirection==='ynx-to-evm'?/^0x[a-f0-9]{40}$/.test(v.target):/^ynx1[a-z0-9]{38}$/.test(v.target)))throw {code:'RECEIVE_RESOLVER_UNCONFIRMED'};
   held={token,before,value:v};fields.target.textContent=v.target;fields.method.textContent=text('Same-account reversible encoding','同账户可逆编码');copy.disabled=false;state('ready',text('Address format and selected account match.','地址格式与当前所选账户一致。'));
  }catch(error){if(!same(before,token))return;const code=error?.code;state(code==='RECEIVE_RESOLVER_INVALID'?'invalid':code==='RECEIVE_RESOLVER_UNSUPPORTED'?'unsupported':'unconfirmed',code==='RECEIVE_RESOLVER_INVALID'?text('Invalid address format or checksum.','地址格式或校验和无效。'):code==='RECEIVE_RESOLVER_UNSUPPORTED'?text('This format conversion is not supported for the selected network.','当前网络不支持这种地址格式转换。'):text('Cannot confirm the corresponding address. No target address is shown.','无法确认对应地址，不显示猜测地址。'));}
  finally{if(same(before,token))query.disabled=!valid();}
 }
 async function copyTarget(){const original=held;if(!original||!same(original.before,original.token))return;await resolve();if(!held||held.value.target!==original.value.target||held.value.canonicalOwner!==original.value.canonicalOwner||typeof writeClipboard!=='function')return;const h=held;try{await writeClipboard(h.value.target,()=>held===h&&same(h.before,h.token));if(held===h&&same(h.before,h.token))state('ready',text('Target address copied.','目标地址已复制。'));}catch{if(held===h&&same(h.before,h.token))state('ready',text('Clipboard unavailable. Select the full target address to copy.','无法写入剪贴板，请选择完整目标地址复制。'));}}
 input.addEventListener('input',edit);query.addEventListener('click',resolve);copy.addEventListener('click',copyTarget);
 for(const [button,value]of [[toEVM,'ynx-to-evm'],[toYNX,'evm-to-ynx']])button.addEventListener('click',()=>{direction=value;invalidate();updateDirection();query.disabled=!valid();state(valid()?'idle':'invalid',text('Check the address for the selected direction.','请核对所选转换方向与地址。'));});
 edit();return Object.freeze({invalidate,resolve,copyTarget,refreshLanguage,destroy(){closed=true;invalidate();},input,root});
}
