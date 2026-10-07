'use strict';
const vscode=require('vscode');
const {createGoTasks}=require('./go-tasks.cjs');
const t=(message,...args)=>vscode.l10n?.t ? vscode.l10n.t(message,...args) : message.replace(/\{(\d+)\}/g,(match,index)=>args[index]===undefined?match:String(args[index]));
function activate(context) {
 const workflow=createGoTasks(vscode,context,process.env,t);
 for(const [id,method] of [['ynx.go.configure','configure'],['ynx.go.run','run'],['ynx.go.cancel','cancel']])context.subscriptions.push(vscode.commands.registerCommand(id,async()=>{
  try {
   const result=await workflow[method]();
   if(result?.unknown)await vscode.window.showWarningMessage(t('Go task ended without a process result. Check its task terminal before running again.'));
   else if(Number.isInteger(result?.exitCode) && result.exitCode!==0)await vscode.window.showWarningMessage(t('Go program exited with code {0}. See its task terminal output.',result.exitCode));
   return result;
  }catch(error){await vscode.window.showErrorMessage(t(error.message));}
 }));
}
module.exports={activate};
