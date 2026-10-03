import {WalletOperationLifecycle} from "../security/operationLifecycle";

/** View ownership only. Never grants key access or replaces a reviewed runtime lease. */
export class WalletConnectViewOperations {
  private lifecycle:WalletOperationLifecycle;
  private scope;
  constructor(now:()=>number=Date.now){this.lifecycle=new WalletOperationLifecycle(now);this.scope=this.lifecycle.scope();}
  setAccount(account:string){if(this.lifecycle.selectedAccount()!==account){this.scope.cancel();this.lifecycle.setAccount(account);}}
  setAppState(state:string){this.lifecycle.setAppState(state);if(state==="background")this.scope.cancel();}
  cancel(){this.scope.cancel();this.lifecycle.invalidate();}
  captureCurrent(account:string){const generation=this.lifecycle.capture(),deadline=this.lifecycle.time()+120000;return()=>{try{this.lifecycle.assert(generation,account,false,deadline);return true;}catch{return false;}};}
  begin(account:string){return this.scope.begin({account,requireUnlocked:false});}
}
