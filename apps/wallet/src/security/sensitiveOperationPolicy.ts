export type SensitiveOperationAttempt=Readonly<{generation:number;binding:string}>;
export type SensitiveOperationCurrent=Readonly<{generation:number;binding:string;active:boolean}>;

export function assertSensitiveOperationActive(attempt:SensitiveOperationAttempt,current:SensitiveOperationCurrent):void{
  if(!current.active||attempt.generation!==current.generation)throw new Error("Sensitive Wallet operation was dismissed or moved to the background");
  if(attempt.binding!==current.binding)throw new Error("Sensitive Wallet operation binding changed");
}

export class ExclusiveAttemptGate{
  private active=false;
  tryBegin():(()=>void)|null{
    if(this.active)return null;
    this.active=true;let released=false;
    return()=>{if(released)return;released=true;this.active=false};
  }
}
