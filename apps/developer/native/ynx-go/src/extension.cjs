'use strict';
const vscode=require('vscode');
const {createGoTasks}=require('./go-tasks.cjs');
const t=(message,...args)=>vscode.l10n?.t ? vscode.l10n.t(message,...args) : message.replace(/\{(\d+)\}/g,(match,index)=>args[index]===undefined?match:String(args[index]));
function activate(context) {
 const workflow=createGoTasks(vscode,context,process.env,t);
 const notice=(method,message,...args)=>{
  // Informational UI completion is not task execution or cleanup authority.
  try {Promise.resolve(vscode.window[method](t(message,...args))).catch(()=>undefined);}
  catch { /* A disposed notification cannot replace the task result. */ }
 };
 for(const [id,method] of [['ynx.go.configure','configure'],['ynx.go.run','run'],['ynx.go.test','test'],['ynx.go.cancel','cancel']])context.subscriptions.push(vscode.commands.registerCommand(id,async()=>{
  try {
   const result=await workflow[method]();
   if(result?.unknown)notice('showWarningMessage','Go task ended without a process result. Check its task terminal before running again.');
   else if(Number.isInteger(result?.exitCode) && result.exitCode!==0)notice('showWarningMessage',method==='test'?'Go tests failed with code {0}. See its task terminal output.':'Go program exited with code {0}. See its task terminal output.',result.exitCode);
   return result;
  }catch(error){
   let message='The Go command failed. Check the task terminal and project configuration, then retry.';
   try {if(typeof error?.message==='string'&&error.message)message=error.message;}catch{}
   notice('showErrorMessage',message);
  }
 }));
}
module.exports={activate};
