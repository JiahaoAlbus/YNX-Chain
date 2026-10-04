import {DEFAULT_CONTENT_FILTER,LocalContentDisplay} from '../../src/localContentDisplay.ts';

const preferenceKey='ynx.social.local-content-filter.enabled.v1';
// This mounts the display boundary, not a model admission. The production
// caller supplies no classifier until its actual local runtime is reviewed.
export function mountLocalContentFilter({root,settingsContainer,onChanged=()=>{},classifier,storage}){
 const document=root.ownerDocument,zh=document.documentElement?.lang?.startsWith('zh');
 const text=zh?{
  title:'内容与隐私',toggle:'开启 AI 内容审查（本地过滤）',off:'本设备过滤已关闭。',
  unavailable:'本地模型未安装或不可用。开启过滤时，未经检测的内容保持隐藏。',
  pending:'正在本设备检查内容…',folded:'内容已折叠。自动判断可能出错。',hidden:'内容未检测，已隐藏。',
  attachment:'未检测附件不能在过滤开启时下载。关闭过滤后可按原权限流程重试。',
 }:{
  title:'Content and privacy',toggle:'Enable AI content review (local filtering)',off:'Local filtering is off on this device.',
  unavailable:'Local model unavailable. Unchecked content stays hidden while filtering is on.',
  pending:'Checking content on this device…',folded:'Content folded. Automatic judgments can be wrong.',hidden:'Unchecked content hidden.',
  attachment:'Unchecked attachments are unavailable while filtering is on. Turn filtering off to retry through the original permission flow.',
 };
 let enabled=false;
 try{storage??=document.defaultView?.localStorage;enabled=storage?.getItem(preferenceKey)==='true'}catch{}
 const gates=new Map(['messages','moments'].map(scope=>[scope,new LocalContentDisplay(classifier)])),jobs=new Map(),nodes=new Map();
 const settings=document.createElement('fieldset'),legend=document.createElement('legend'),label=document.createElement('label'),checkbox=document.createElement('input'),status=document.createElement('p');
 legend.textContent=text.title;checkbox.type='checkbox';checkbox.checked=enabled;checkbox.name='ynxLocalContentFilter';
 checkbox.setAttribute('aria-label',text.toggle);label.append(checkbox,document.createTextNode(text.toggle));
 status.setAttribute('role','status');status.setAttribute('aria-live','polite');settings.dataset.localFilterSettings='true';
 settings.append(legend,label,status);(settingsContainer??root).append(settings);
 function configure(){for(const gate of gates.values())gate.configure({...DEFAULT_CONTENT_FILTER,enabled});status.textContent=enabled?text.unavailable:text.off;status.dataset.modelState=enabled?'unavailable':'off'}
 function cancel(scope){
  if(scope!==undefined&&!gates.has(scope))throw new Error('Unknown content display panel');
  for(const [job,owner] of jobs)if(scope===undefined||owner===scope){job.cancel();jobs.delete(job)}
  for(const [node,owner] of nodes)if(scope===undefined||owner===scope){node.textContent=text.hidden;nodes.delete(node)}
  for(const [owner,gate] of gates)if(scope===undefined||owner===scope)gate.configure({...DEFAULT_CONTENT_FILTER,enabled});
 }
 configure();
 checkbox.onchange=()=>{
  enabled=checkbox.checked===true;cancel();configure();
  try{storage?.setItem(preferenceKey,String(enabled))}catch{}
  onChanged();
 };
 function renderText(node,original,{id,assertCurrent,scope='messages'}){
  assertCurrent();
  const gate=gates.get(scope);if(!gate)throw new Error('Unknown content display panel');
  const bytes=new TextEncoder().encode(original),job=gate.begin(id,bytes,'text/plain');
  nodes.set(node,scope);jobs.set(job,scope);
  const show=decision=>{
   try{
    assertCurrent();
    node.textContent=gate.canDisplay(id,bytes,decision)?original:decision.status==='pending'?text.pending:decision.status==='folded'?text.folded:text.hidden;
    node.dataset.localFilterState=decision.status;
   }catch{/* A retired account/room/visibility has no display authority. */}
  };
  show(job.initial);
  void job.completed.then(show).finally(()=>{jobs.delete(job);bytes.fill(0)});
 }
 return Object.freeze({
  get enabled(){return enabled},
  renderText,
  preview(original){return enabled?text.hidden:original},
  assertAttachmentAllowed(){if(enabled)throw Object.assign(new Error(text.attachment),{code:'LOCAL_FILTER_UNAVAILABLE'})},
  cancel,
  destroy(){cancel();checkbox.onchange=null;settings.remove()},
 });
}
