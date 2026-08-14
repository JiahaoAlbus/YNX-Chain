export class StartupDeepLinkGate {
  private phase:"restoring"|"ready"|"failed"="restoring";
  private pending:string|null=null;
  private ambiguous=false;

  constructor(private readonly handle:(url:string)=>void){}

  receive(url:string):void{
    if(this.phase==="failed")return;
    if(this.phase==="ready"){this.handle(url);return;}
    if(this.pending!==null){this.pending=null;this.ambiguous=true;return;}
    if(!this.ambiguous)this.pending=url;
  }

  ready():void{
    if(this.phase!=="restoring")return;
    this.phase="ready";
    const pending=this.ambiguous?null:this.pending;
    this.pending=null;
    if(pending!==null)this.handle(pending);
  }

  fail():void{
    this.phase="failed";
    this.pending=null;
  }
}
