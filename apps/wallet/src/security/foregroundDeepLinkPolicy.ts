export class ForegroundDeepLinkGate {
  private pending:string|null=null;
  private ambiguous=false;
  private failed=false;

  constructor(private readonly handle:(url:string)=>void,private readonly reject:(error:Error)=>void){}

  receive(url:string,state:string|null):void{
    if(this.failed)return;
    if(state==="active"){
      if(this.pending!==null||this.ambiguous){this.reject(new Error("Wallet authorization link lifecycle is ambiguous"));this.pending=null;this.ambiguous=false;return}
      this.handle(url);return;
    }
    if(state!=="inactive"&&state!=="background"){this.reject(new Error("Wallet authorization links require a known application lifecycle"));return}
    if(this.pending!==null){this.pending=null;this.ambiguous=true;this.reject(new Error("Wallet authorization link lifecycle is ambiguous"));return}
    if(!this.ambiguous)this.pending=url;
  }

  stateChanged(state:string|null):void{
    if(this.failed||state!=="active")return;
    if(this.ambiguous){this.ambiguous=false;return}
    const pending=this.pending;this.pending=null;
    if(pending!==null)this.handle(pending);
  }

  fail():void{this.failed=true;this.pending=null;this.ambiguous=false}
}
