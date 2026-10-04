import {mountLocalContentFilter} from './qa-local-filter.mjs';
const root=document.querySelector('main'),message=document.getElementById('message'),moment=document.getElementById('moment');
const current=()=>{};
const filter=mountLocalContentFilter({root,settingsContainer:document.getElementById('settings'),onChanged:()=>render()});
function render(){filter.renderText(message,'Approved ordinary message',{id:'qa-message',scope:'messages',assertCurrent:current});filter.renderText(moment,'Approved ordinary moment',{id:'qa-moment',scope:'moments',assertCurrent:current})}
document.getElementById('refresh').onclick=()=>{filter.cancel('messages');filter.renderText(message,'Refreshed ordinary message',{id:'qa-message',scope:'messages',assertCurrent:current})};
document.getElementById('render').onclick=render;
render();
