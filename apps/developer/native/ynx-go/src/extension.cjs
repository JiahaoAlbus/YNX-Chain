'use strict';
const vscode=require('vscode');
const {createGoTasks}=require('./go-tasks.cjs');
const t=(message,...args)=>vscode.l10n?.t ? vscode.l10n.t(message,...args) : message.replace(/\{(\d+)\}/g,(match,index)=>args[index]===undefined?match:String(args[index]));
// A result notice is presentation, never part of task ownership or approval.
// Observe both sync and async UI failure without replacing the task result.
function notify(kind,message,...args) {
 try { Promise.resolve(vscode.window[kind](t(message,...args))).catch(()=>{}); }
 catch { /* The original task has already settled. */ }
}
function activate(context) {
 const workflow=createGoTasks(vscode,context,process.env,t);
 for(const [id,method] of [['ynx.go.configure','configure'],['ynx.go.run','run'],['ynx.go.test','test'],['ynx.go.cancel','cancel']])context.subscriptions.push(vscode.commands.registerCommand(id,async()=>{
  try {
   const result=await workflow[method]();
   if(result?.unknown)notify('showWarningMessage','Go task ended without a process result. Check its task terminal before running again.');
   else if(Number.isInteger(result?.exitCode) && result.exitCode!==0)notify('showWarningMessage',method==='test'?'Go tests failed with code {0}. See its task terminal output.':'Go program exited with code {0}. See its task terminal output.',result.exitCode);
   return result;
  }catch(error){
   let message='The Go command failed. Check the task terminal and project configuration, then retry.';
   try { const detail=error?.message;if(typeof detail==='string'&&detail.trim())message=detail; }
   catch { /* Keep a failed accessor from replacing the operation failure. */ }
   notify('showErrorMessage',message);
  }
 }));
}
module.exports={activate};
