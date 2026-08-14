export type SensitiveOperationAttempt=Readonly<{generation:number;binding:string}>;
export type SensitiveOperationCurrent=Readonly<{generation:number;binding:string;active:boolean}>;

export function assertSensitiveOperationActive(attempt:SensitiveOperationAttempt,current:SensitiveOperationCurrent):void{
  if(!current.active||attempt.generation!==current.generation)throw new Error("Sensitive Wallet operation was dismissed or moved to the background");
  if(attempt.binding!==current.binding)throw new Error("Sensitive Wallet operation binding changed");
}
