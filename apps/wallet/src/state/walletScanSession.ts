import {WalletOperationLifecycle} from "../security/operationLifecycle";
import type {WalletScanResult} from "./walletScan";

/** A camera result is input only, scoped to the account that opened it. */
export class WalletScanSession {
  private opened:Readonly<{generation:number;account:string}>|null=null;
  constructor(private readonly operations:WalletOperationLifecycle){}
  open(account:string):void {
    if(!this.operations.isActive()||!this.operations.isUnlocked()||this.operations.selectedAccount()!==account)throw new Error("Wallet must be active and unlocked to scan");
    this.opened=Object.freeze({generation:this.operations.capture(),account});
  }
  cancel():void {this.opened=null}
  accept(result:WalletScanResult,route:(result:WalletScanResult)=>void):boolean {
    const opened=this.opened;this.opened=null;
    if(!opened||opened.generation!==this.operations.capture()||opened.account!==this.operations.selectedAccount()||!this.operations.isActive()||!this.operations.isUnlocked())return false;
    route(result);return true;
  }
}
