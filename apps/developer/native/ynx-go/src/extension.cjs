'use strict';
const vscode=require('vscode');
const {createGoTasks}=require('./go-tasks.cjs');
function activate(context) {
 const workflow=createGoTasks(vscode,context,process.env);
 for(const [id,method] of [['ynx.go.configure','configure'],['ynx.go.run','run'],['ynx.go.cancel','cancel']])context.subscriptions.push(vscode.commands.registerCommand(id,async()=>{
  try {
   const result=await workflow[method]();
   if(result?.unknown)await vscode.window.showWarningMessage('Go task ended without a process result. Check its task terminal before running again.');
   else if(Number.isInteger(result?.exitCode) && result.exitCode!==0)await vscode.window.showWarningMessage('Go program exited with code '+result.exitCode+'. See its task terminal output.');
   return result;
  }catch(error){await vscode.window.showErrorMessage(error.message);}
 }));
}
module.exports={activate};
