export type LocalAuthorizationAttempt=Readonly<{generation:number}>;

export class LocalAuthorizationAttemptCoordinator{
  private generation=0;
  private nextPrompt=0;
  private activePrompt:number|null=null;

  begin():LocalAuthorizationAttempt{return Object.freeze({generation:this.generation})}
  assertActive(attempt:LocalAuthorizationAttempt):void{
    if(attempt.generation!==this.generation)throw new Error("Biometric authorization was cancelled by Wallet lifecycle");
  }
  beginPrompt(attempt:LocalAuthorizationAttempt):number{
    this.assertActive(attempt);
    const prompt=++this.nextPrompt;
    this.activePrompt=prompt;
    return prompt;
  }
  finishPrompt(prompt:number):void{if(this.activePrompt===prompt)this.activePrompt=null}
  cancel():boolean{
    this.generation+=1;
    const hadActivePrompt=this.activePrompt!==null;
    this.activePrompt=null;
    return hadActivePrompt;
  }
}
