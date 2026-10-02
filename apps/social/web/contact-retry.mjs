// Local reviewed intents only. Retrying is always an explicit user action.
export class ContactRetry{
  constructor(workspace,publish=()=>{}){this.workspace=workspace;this.publish=publish;this.pending=null;this.archived=[];this.running=null}
  get current(){
	this.archived=this.archived.filter(intent=>intent.guard());
    if(this.pending&&!this.pending.guard()){this.pending=null;this.archived=[];this.publish();return null}
    if(this.pending&&this.running!==this.pending&&!this.workspace.isContactPreviewCurrent(this.pending.preview)){this.archived.push(this.pending);this.pending=null;this.publish();return null}
    return this.pending;
  }
  retain(preview,message){
    if(!this.workspace.isContactPreviewCurrent(preview))throw new Error('Review this person again before sending');
    const prior=this.current;if(prior)this.archived.push(prior);
    this.pending=Object.freeze({preview,message:message.trim(),guard:this.workspace.contactContextGuard()});this.publish();
  }
  reviewAgain(){const current=this.current;if(current){this.archived.push(current);this.workspace.cancelContactPreview(current.preview)}this.pending=null;this.publish()}
  async attempt(){
    const intent=this.current;if(!intent)throw new Error('No current reviewed request is available to retry');
    if(this.running===intent)throw new Error('This exact request is already being sent');
    this.running=intent;this.publish();
    try{await this.workspace.confirmContact(intent.preview,intent.message);if(this.pending===intent)this.pending=null}
    finally{if(this.running===intent)this.running=null;this.publish()}
  }
}
