// Small callback-only closure: no chat SDK, storage, authority or network client.
import {handleMatrixLoginCallback} from './login.mjs';

const zhCopy=new Map([
 ['Return to YNX Social','返回 YNX Social'],
 ['Return to your conversation.','返回你的对话。'],
 ['Return to Social','返回 Social'],
 ['Sign-in returned to Social. You can close this window.','登录结果已返回 Social，可以关闭此窗口。'],
 ['This sign-in callback has already been used. Return to Social and retry.','此登录回调已使用。请返回 Social 重试。'],
 ['Matrix sign-in callback is unavailable or expired. Return to Social and retry.','Matrix 登录回调不可用或已过期。请返回 Social 重试。'],
 ['This sign-in callback is unavailable. Return to Social and retry.','此登录回调不可用。请返回 Social 重试。'],
 ['Sign-in could not return to Social. Return to Social and retry.','登录结果未能返回 Social。请返回 Social 重试。'],
]);

function callbackLocale(environment){
 // Inherit only the original, exact same-origin product window's DOM language.
 // Do not read storage, query language flags, cookies or third-party resources.
 try{
  const current=new URL(environment.location.href),opener=environment.opener;
  if(current.origin==='https://social.ynxweb4.com'&&opener&&new URL(opener.location.href).origin===current.origin){
   return /^zh(?:-|$)/i.test(opener.document?.documentElement?.lang??'')?'zh-CN':'en';
  }
 }catch{}
 return 'en';
}

export function runMatrixLoginCallbackPage({callbackHref,environment=globalThis}={}){
 const status=environment.document?.getElementById?.('callback-status');
 const locale=callbackLocale(environment),copy=text=>locale==='zh-CN'?(zhCopy.get(text)??text):text;
 if(environment.document?.documentElement)environment.document.documentElement.lang=locale;
 if(environment.document){environment.document.title=copy('Return to YNX Social');for(const [id,text] of [['callback-title','Return to your conversation.'],['callback-return','Return to Social']]){const node=environment.document.getElementById?.(id);if(node)node.textContent=copy(text)}}
 try{
  if(typeof callbackHref!=='string'||!handleMatrixLoginCallback({environment,callbackHref})){
   if(status)status.textContent=copy('This sign-in callback is unavailable. Return to Social and retry.');
   return false;
  }
  if(status)status.textContent=copy(status.textContent);
  return true;
 }catch{
  // Never include exception details, callback URLs or credentials in the UI/logs.
  if(status)status.textContent=copy('Sign-in could not return to Social. Return to Social and retry.');
  return false;
 }
}
